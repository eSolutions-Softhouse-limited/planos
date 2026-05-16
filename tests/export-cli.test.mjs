/**
 * planos — `bin/planos export` OUT-OF-BLOCKING-PATH CLI tests (plain Node,
 * zero deps).
 *
 * Phase 4 / Milestone Q1 gate (AC-Q6). Mirrors tests/review-roundtrip.test.mjs's
 * child-process invocation pattern, but SIMPLER — there is NO server/decision
 * seam: just pipe a document to stdin, read markdown off stdout, assert exit 0
 * and prompt (non-hanging) exit. The whole point of Q3 is that this surface is
 * out-of-blocking-path BY CONSTRUCTION: no server boot, no round-trip, no block.
 *
 * Coverage:
 *
 *   AC-Q6  — `bin/planos export` reads a doc (stdin via reused
 *            readStdin/extractPlan), writes serialized markdown to stdout,
 *            exits 0, boots NO server, blocks NOT (asserted: immediate exit
 *            with markdown on stdout within a short timeout; no TCP port
 *            bound; degrade-not-block on a malformed doc).
 *   AC-Q12 (pre-staged static half) — src/hook/export.mjs does NOT import
 *            src/server/ nor src/hook/{exit,prd,review}.mjs (the
 *            out-of-blocking-path guarantee proven statically here; the
 *            negative import-closure assertion proper is Milestone Q5).
 *
 * Run: node --test tests/export-cli.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLANOS_BIN = join(REPO_ROOT, 'plugin/bin/planos');
const EXPORT_MOD = join(REPO_ROOT, 'src/hook/export.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { passed++; console.log(`  PASS  ${name}`); },
        (err) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err && err.message ? err.message : String(err)}`);
        },
      );
    }
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err && err.message ? err.message : String(err)}`);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fixtures — a valid multi-kind document (v1∪v2∪v3 mix) the serializer covers.
// ---------------------------------------------------------------------------

/** A small but multi-kind valid document (section/prose/task/diff). */
const EXPORT_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'export-cli-demo-2026-05-16',
  title: 'Export CLI Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's0', kind: 'section', title: 'Goals', level: 1 },
    { id: 'p0', kind: 'prose', md: 'Proving the out-of-blocking-path export CLI.' },
    { id: 't0', kind: 'task', title: 'Ship export', status: 'done', detail: 'one-shot' },
    {
      id: 'd0',
      kind: 'diff',
      path: 'src/auth/login.js',
      status: 'modified',
      hunks: [
        {
          header: '@@ -1,2 +1,3 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          lines: [
            { op: ' ', text: 'function login() {' },
            { op: '+', text: '  audit();' },
            { op: ' ', text: '}' },
          ],
          hunkId: 'd0-h1',
        },
      ],
      comments: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Child-process invocation. Spawns `node plugin/bin/planos export`, pipes the
// hook-stdin envelope ({ tool_input: { plan } }) the export handler reuses via
// readStdin/extractPlan, captures stdout/stderr/code. A hard wall-clock
// timeout proves it does NOT hang on a server (out-of-blocking-path).
// ---------------------------------------------------------------------------

/**
 * @param {*} doc            authored doc (tool_input.plan); raw string allowed
 * @param {number} [timeoutMs] hard kill timeout (proves non-hanging)
 * @returns {Promise<{ stdout, stderr, code, signal, ms }>}
 */
function runExport(doc, timeoutMs = 8000) {
  const planStr = typeof doc === 'string' ? doc : JSON.stringify(doc);
  const hookStdin = JSON.stringify({ tool_input: { plan: planStr } });
  return new Promise((res) => {
    const started = Date.now();
    const child = spawn(process.execPath, [PLANOS_BIN, 'export'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdin.end(hookStdin);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      res({
        stdout,
        stderr,
        code,
        signal,
        ms: Date.now() - started,
        timedOut: killed,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// AC-Q6 — valid doc → markdown on stdout, exit 0, prompt non-hanging exit,
// no server bound.
// ---------------------------------------------------------------------------

await test('AC-Q6: bin/planos export → markdown on stdout, exit 0, prompt exit (NO server / NO block / NO hang)', async () => {
  const { stdout, stderr, code, signal, ms, timedOut } = await runExport(EXPORT_DOC);
  assert.equal(timedOut, false, `process must NOT hang on a server (it did — killed after timeout). stderr: ${stderr}`);
  assert.equal(signal, null, `clean exit (no kill signal), got signal ${signal}`);
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  assert.ok(stdout.trim().length > 0, 'markdown written to stdout');

  // The serialized structure must reflect the document's kinds.
  assert.ok(stdout.includes('# Export CLI Demo'), 'H1 title serialized');
  assert.ok(stdout.includes('# Goals'), 'section heading serialized');
  assert.ok(stdout.includes('Proving the out-of-blocking-path export CLI.'), 'prose serialized');
  assert.ok(stdout.includes('[x] Ship export'), 'done task serialized as checked item');
  assert.ok(stdout.includes('```diff'), 'diff hunk fenced block serialized');
  assert.ok(stdout.includes('audit();'), 'diff line content serialized');
  assert.ok(stdout.endsWith('\n'), 'canonical trailing newline');

  // Out-of-blocking-path: a one-shot read→serialize→print→exit must return
  // FAST. A blocking server round-trip would never resolve without a POSTed
  // decision; this returns essentially immediately.
  assert.ok(ms < 8000, `prompt exit expected (out-of-blocking-path), took ${ms}ms`);
});

// ---------------------------------------------------------------------------
// AC-Q6 — degrade-not-block: a malformed/empty doc still exits 0 with
// best-effort markdown (the serializer never throws).
// ---------------------------------------------------------------------------

await test('AC-Q6: malformed doc stdin → still exits 0 with best-effort markdown (degrade-not-block)', async () => {
  const { stdout, code, timedOut } = await runExport({ not: 'a real doc' });
  assert.equal(timedOut, false, 'must not hang on malformed input');
  assert.equal(code, 0, `degrade-not-block: exit 0 even on malformed input, got ${code}`);
  assert.ok(stdout.trim().length > 0, 'best-effort markdown still written');
  assert.ok(stdout.includes('# Untitled'), 'degraded doc serializes a best-effort H1');
});

await test('AC-Q6: non-JSON / empty stdin → still exits 0 with best-effort markdown (degrade-not-block)', async () => {
  const empty = await runExport('');
  assert.equal(empty.timedOut, false, 'must not hang on empty input');
  assert.equal(empty.code, 0, `empty stdin → exit 0 (degrade-not-block), got ${empty.code}`);
  assert.ok(empty.stdout.includes('# Untitled'), 'empty doc → best-effort H1');

  const garbage = await runExport('this is not json at all');
  assert.equal(garbage.timedOut, false, 'must not hang on garbage input');
  assert.equal(garbage.code, 0, `non-JSON stdin → exit 0 (degrade-not-block), got ${garbage.code}`);
  assert.ok(garbage.stdout.trim().length > 0, 'best-effort markdown still produced');
});

// ---------------------------------------------------------------------------
// AC-Q12 (pre-staged static half) — src/hook/export.mjs imports NO server and
// NO blocking handler. Proven statically by scanning the module source; the
// negative import-closure assertion proper is Milestone Q5.
// ---------------------------------------------------------------------------

await test('AC-Q12 (pre-stage): src/hook/export.mjs imports NO src/server/ and NO src/hook/{exit,prd,review}.mjs (out-of-blocking-path by construction)', () => {
  const src = readFileSync(EXPORT_MOD, 'utf8');

  // Strip comments so the AC-17 contract prose (which legitimately MENTIONS
  // server / exit / prd / review to explain why it does NOT import them) is
  // not mistaken for an actual import edge. Only real `import` statements
  // remain to be inspected.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const importLines = codeOnly
    .split('\n')
    .filter((l) => /^\s*import\b/.test(l) || /\bimport\s*\(/.test(l));

  // No server boot.
  for (const l of importLines) {
    assert.ok(
      !/server/.test(l),
      `export.mjs must NOT import src/server/ (no startServer) — offending import: ${l.trim()}`,
    );
    assert.ok(
      !/\bstartServer\b/.test(l),
      `export.mjs must NOT import startServer — offending import: ${l.trim()}`,
    );
  }

  // No blocking handler.
  for (const banned of ['exit.mjs', 'prd.mjs', 'review.mjs']) {
    for (const l of importLines) {
      assert.ok(
        !l.includes(banned),
        `export.mjs must NOT import the blocking handler ${banned} — offending import: ${l.trim()}`,
      );
    }
  }

  // Belt-and-braces: even outside import lines there must be no startServer
  // call and no src/server reference anywhere in the executable code.
  assert.ok(
    !/\bstartServer\b/.test(codeOnly),
    'export.mjs executable code must contain NO startServer reference',
  );
  assert.ok(
    !/['"][^'"]*\/server\//.test(codeOnly),
    'export.mjs executable code must contain NO src/server/ path reference',
  );

  // Positive: the ONLY imports are roundtrip.mjs + the pure serializer.
  const moduleSpecifiers = importLines
    .map((l) => {
      const m = l.match(/from\s+['"]([^'"]+)['"]/) || l.match(/import\s*\(\s*['"]([^'"]+)['"]/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  for (const spec of moduleSpecifiers) {
    assert.ok(
      spec === './roundtrip.mjs' || spec === '../export/markdown.mjs',
      `export.mjs may ONLY import ./roundtrip.mjs + ../export/markdown.mjs — unexpected: ${spec}`,
    );
  }
  assert.ok(
    moduleSpecifiers.includes('./roundtrip.mjs'),
    'export.mjs must reuse ./roundtrip.mjs (readStdin/extractPlan)',
  );
  assert.ok(
    moduleSpecifiers.includes('../export/markdown.mjs'),
    'export.mjs must call ../export/markdown.mjs (serializeMarkdown)',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `export-cli tests (Phase 4 / Milestone Q1 — AC-Q6 + AC-Q12 static pre-stage): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
