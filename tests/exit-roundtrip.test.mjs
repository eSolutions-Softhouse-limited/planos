/**
 * planos — ExitPlanMode REAL-SPA round-trip tests (plain Node, zero deps).
 *
 * Covers US-014 / Step 2f.3 — AC-3, AC-4, AC-5 (the production browser path,
 * as opposed to the US-008 scripted thin loop):
 *
 *   - Real-SPA mode (NO decisionProvider) serves the prebuilt single-file
 *     editor at `GET /` with the canonical doc inlined as
 *     `window.__PLANOS_DOC__`.
 *   - `GET /api/plan` returns the canonical doc (loader's 2nd resolution
 *     branch); `/api/plan/versions` + `/api/plan/version?v=N` surface the
 *     revision selector inputs (US-014 read-only handlers).
 *   - The open-browser seam is INJECTABLE: a no-op is injected so the harness
 *     NEVER spawns a real browser (AC-17).
 *   - The server BLOCKS on `decisionPromise`; a programmatic loopback HTTP
 *     client (node:http, no fetch) POSTs to /api/approve or /api/deny exactly
 *     as the SPA's envelope transport would (approve→/api/approve,
 *     revise→/api/deny — see src/editor/envelope.ts ENVELOPE_ENDPOINTS).
 *   - AC-4: approve POST → stdout decision behavior:"allow", exit 0, with the
 *     flush-then-exit-0 ordering observable (stdout JSON complete AND exit 0).
 *   - AC-5: deny POST with a structurally-valid FeedbackEnvelope →
 *     behavior:"deny" + message = tuned directive preamble
 *       + human-readable ops rendering
 *       + (id,kind,title) echo table
 *       + canonical JSON of the current document.
 *   - AC-17: zero non-loopback network egress during the blocking exit path
 *     (net.Socket.prototype.connect spied at the lowest practical boundary —
 *     mirrors exit-production / exit-thinloop).
 *
 * The scripted/decisionProvider seam is NOT exercised here (that is
 * tests/exit-thinloop.test.mjs); this suite drives the REAL-SPA mode
 * (decisionProvider omitted) that US-014 added, proving the production path.
 *
 * Run: node tests/exit-roundtrip.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  buildSpaHtml,
  buildPlanApiHandlers,
  handleExit,
} from '../src/hook/exit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXIT_MOD = join(__dirname, '../src/hook/exit.mjs');
const SPA_HTML_PATH = resolve(__dirname, '../plugin/dist/index.html');

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
// Fixtures
// ---------------------------------------------------------------------------

/** A small but complete valid v1 plan document (current canonical revision). */
const VALID_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'roundtrip-demo-2026-05-16',
  title: 'Round-trip Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 2 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the real-SPA ExitPlanMode round-trip.' },
    {
      id: 't-build-spa',
      kind: 'task',
      title: 'Wire the real SPA round-trip',
      status: 'todo',
      deps: [],
      acceptance: ['browser POST resolves the blocking decision'],
    },
    { id: 'q-id-scheme', kind: 'openQuestion', question: 'Which ID scheme do we adopt?' },
  ],
};

/** The prior revision, surfaced to the SPA revision selector (diff base). */
const PREVIOUS_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'roundtrip-demo-2026-05-16',
  title: 'Round-trip Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T11:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Earlier draft of the round-trip prose.' },
  ],
};

/**
 * A structurally-valid FeedbackEnvelope the SPA would POST to /api/deny on
 * "revise" (src/editor/envelope.ts shape; round-trips through the schema's
 * validateEnvelope). baseRevision === doc.meta.revision (2) so the race guard
 * does NOT trip and the ops are rendered into the deny message (AC-5).
 */
const REVISE_ENVELOPE = {
  decision: 'revise',
  documentId: 'roundtrip-demo-2026-05-16',
  baseRevision: 2,
  ops: [
    {
      op: 'editBlock',
      blockId: 't-build-spa',
      patch: { title: 'Wire AND verify the real SPA round-trip' },
    },
    { op: 'answer', blockId: 'q-id-scheme', answer: 'Opaque IDs, decided in Milestone 1.' },
    { op: 'comment', blockId: 'p-context', text: 'Clarify which loop this proves.' },
  ],
  globalComment: 'Tighten the task acceptance before approval.',
};

/** Helper: HTTP POST (node:http, no fetch). Resolves the status code. */
function post(port, path, payload = {}) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (r) => { r.resume(); r.on('end', () => res(r.statusCode)); },
    );
    req.on('error', rej);
    req.end(body);
  });
}

// ---------------------------------------------------------------------------
// Pure unit checks — the real-SPA serving + read-only API handler builders.
// ---------------------------------------------------------------------------

await test('buildSpaHtml serves the committed single-file editor with the doc inlined', () => {
  const fileHtml = readFileSync(SPA_HTML_PATH, 'utf8');
  const html = buildSpaHtml(VALID_DOC);
  assert.ok(html.length > fileHtml.length, 'inlined HTML is the built bundle + the doc seam');
  assert.ok(
    html.includes('window.__PLANOS_DOC__='),
    'doc is inlined as the loader window seam',
  );
  assert.ok(
    html.includes('"roundtrip-demo-2026-05-16"'),
    'the canonical doc id is embedded',
  );
  // The </script> sequence inside the JSON must be neutralized so the inline
  // <script> is not prematurely closed.
  assert.ok(!/<\/script>\s*;<\/script>/i.test(html), 'no raw </script> injected from the doc');
});

await test('buildPlanApiHandlers exposes read-only /api/plan*, current + previous revisions', () => {
  const handlers = buildPlanApiHandlers(VALID_DOC, PREVIOUS_DOC);

  const plan = handlers['GET /api/plan']({ url: '/api/plan' });
  assert.equal(plan.json.plan.id, VALID_DOC.id, 'GET /api/plan returns the current doc');
  assert.equal(plan.json.origin, 'planos');
  assert.equal(plan.json.previousPlan.meta.revision, 1, 'previous revision surfaced');
  assert.equal(plan.json.versionInfo.revision, 2, 'current revision reported');

  const versions = handlers['GET /api/plan/versions']({ url: '/api/plan/versions' });
  assert.equal(versions.json.versions.length, 2, 'two revisions listed');

  const v1 = handlers['GET /api/plan/version']({ url: '/api/plan/version?v=1' });
  assert.equal(v1.json.plan.meta.revision, 1, 'version selector fetches revision 1');
  const vMissing = handlers['GET /api/plan/version']({ url: '/api/plan/version?v=99' });
  assert.equal(vMissing.status, 404, 'unknown revision → 404 (selector handles it)');
});

// ---------------------------------------------------------------------------
// Real-SPA mode child-process round-trip. The child runs `handleExit` with NO
// decisionProvider (→ REAL-SPA mode), an injected NO-OP browser opener (AC-17:
// the harness never spawns a real browser), and a programmatic loopback HTTP
// client that GETs / and /api/plan then POSTs the browser decision exactly as
// the SPA's envelope transport would. The child writes the decision JSON to
// stdout via the server's finish() — proving flush-then-exit-0 ordering.
// ---------------------------------------------------------------------------

/**
 * @param {object} doc            current canonical doc (tool_input.plan)
 * @param {object|null} prevDoc   prior revision (or null)
 * @param {'approve'|'deny'} kind which endpoint the simulated browser hits
 * @param {object} [postPayload]  body the simulated browser POSTs (e.g. an
 *                                envelope for the deny/revise path)
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runRealSpaExit(doc, prevDoc, kind, postPayload = {}) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const childScript = `
import http from 'node:http';
import { handleExit } from '${EXIT_MOD}';

const kind = ${JSON.stringify(kind)};
const postPayload = ${JSON.stringify(postPayload)};

// REAL-SPA mode: NO decisionProvider. The injected openBrowser is a no-op
// (AC-17 — the harness must never spawn a real browser); in its place a
// programmatic loopback client drives the browser POST after first GETting
// the SPA + /api/plan exactly as a real browser/loader would.
await handleExit({
  stdinText: ${JSON.stringify(hookStdin)},
  previousDoc: ${prevDoc ? JSON.stringify(prevDoc) : 'undefined'},
  openBrowser: (url) => {
    const u = new URL(url);
    const port = Number(u.port);
    // 1. GET / (the SPA HTML the real browser would load).
    const r1 = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'GET' },
      (res) => {
        let html = '';
        res.on('data', (d) => { html += d.toString(); });
        res.on('end', () => {
          if (!html.includes('window.__PLANOS_DOC__=')) {
            process.stderr.write('SPA HTML missing doc seam\\n');
          }
          // 2. GET /api/plan (the loader's 2nd resolution branch).
          const r2 = http.request(
            { host: '127.0.0.1', port, path: '/api/plan', method: 'GET' },
            (res2) => {
              let body = '';
              res2.on('data', (d) => { body += d.toString(); });
              res2.on('end', () => {
                try {
                  const parsed = JSON.parse(body);
                  if (!parsed || !parsed.plan || parsed.plan.id !== ${JSON.stringify(doc.id)}) {
                    process.stderr.write('/api/plan did not return the doc\\n');
                  }
                } catch {
                  process.stderr.write('/api/plan body not JSON\\n');
                }
                // 3. POST the browser decision (envelope) exactly as the SPA
                //    transport would: approve→/api/approve, revise→/api/deny.
                const path = kind === 'approve' ? '/api/approve' : '/api/deny';
                const payload = JSON.stringify(postPayload);
                const r3 = http.request(
                  { host: '127.0.0.1', port, path, method: 'POST',
                    headers: { 'Content-Type': 'application/json',
                               'Content-Length': Buffer.byteLength(payload) } },
                  (res3) => { res3.resume(); },
                );
                r3.end(payload);
              });
            },
          );
          r2.end();
        });
      },
    );
    r1.end();
  },
});
`.trim();

  return new Promise((res) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(childScript);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => res({ stdout, stderr, code }));
  });
}

await test('AC-3/AC-4: real-SPA mode — GET / serves SPA, GET /api/plan returns doc, approve POST → allow, exit 0, flush-then-exit', async () => {
  const { stdout, stderr, code } = await runRealSpaExit(
    VALID_DOC,
    PREVIOUS_DOC,
    'approve',
    { source: 'real-spa-browser' },
  );
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  // The child writes a diagnostic to stderr if GET / or GET /api/plan did not
  // serve the SPA / doc — assert it stayed clean.
  assert.ok(
    !stderr.includes('SPA HTML missing doc seam'),
    'GET / served the SPA with the inlined doc',
  );
  assert.ok(
    !stderr.includes('/api/plan did not return the doc') &&
      !stderr.includes('/api/plan body not JSON'),
    'GET /api/plan returned the canonical doc',
  );
  assert.ok(stdout.trim().length > 0, 'stdout non-empty');
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');
  // Flush-then-exit-0 ordering: the decision JSON is complete (ends with '}')
  // AND the process exited 0 — the ordering invariant (AC-3), not a literal ms.
  assert.ok(
    stdout.trim().endsWith('}') && code === 0,
    'flush-then-exit-0 ordering confirmed (stdout complete AND exit 0)',
  );
});

await test('AC-5: real-SPA mode — deny POST with a FeedbackEnvelope → behavior:"deny" + directive + ops + echo table + canonical JSON', async () => {
  const { stdout, stderr, code } = await runRealSpaExit(
    VALID_DOC,
    PREVIOUS_DOC,
    'deny',
    REVISE_ENVELOPE,
  );
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
  assert.equal(decision.behavior, 'deny', 'revise → behavior:"deny"');
  const msg = decision.message;
  assert.ok(typeof msg === 'string' && msg.length > 0, 'deny carries a message');

  // (a) Tuned directive preamble (design.md §2 strong-directive deny).
  assert.ok(msg.includes('YOUR PLAN WAS NOT APPROVED'), 'tuned directive preamble present');
  assert.ok(
    msg.includes('re-call ExitPlanMode'),
    'directive instructs re-calling ExitPlanMode',
  );

  // (b) Human-readable ops rendering (the part deferred from US-008, AC-5).
  assert.ok(
    msg.includes('## Requested changes (apply EVERY item below)'),
    'rendered ops section header present',
  );
  assert.ok(
    msg.includes('EDIT block `t-build-spa`'),
    'editBlock op rendered human-readably',
  );
  assert.ok(
    msg.includes('ANSWER openQuestion block `q-id-scheme`'),
    'answer op rendered human-readably',
  );
  assert.ok(
    msg.includes('COMMENT on block `p-context`'),
    'comment op rendered human-readably',
  );
  assert.ok(
    msg.includes('Tighten the task acceptance before approval.'),
    'globalComment threaded into the rendered ops',
  );

  // (c) (id,kind,title) echo table — design.md §6 mechanism #2, every block.
  assert.ok(msg.includes('| id | kind | title |'), 'echo table header present');
  assert.ok(msg.includes('REUSE'), 'echo table carries the REUSE directive');
  for (const b of VALID_DOC.blocks) {
    assert.ok(msg.includes(b.id), `echo table missing block id '${b.id}'`);
    assert.ok(msg.includes(b.kind), `echo table missing block kind '${b.kind}'`);
  }

  // (d) Canonical JSON of the CURRENT document (revise-from-this-exact-JSON).
  assert.ok(msg.includes('```json'), 'canonical JSON fenced block present');
  const jsonStart = msg.indexOf('```json');
  const fence = msg.slice(jsonStart + 7);
  const jsonText = fence.slice(0, fence.indexOf('```')).trim();
  const roundTripped = JSON.parse(jsonText);
  assert.deepEqual(
    roundTripped,
    VALID_DOC,
    'canonical JSON round-trips the exact current document (AC-5/AC-9 no loss)',
  );

  // Flush-then-exit-0 ordering (AC-3) on the deny path too.
  assert.ok(
    stdout.trim().endsWith('}') && code === 0,
    'flush-then-exit-0 ordering confirmed on the revise path',
  );
});

await test('AC-5: real-SPA deny — stale baseRevision trips the race guard (ops NOT applied, re-render signaled)', async () => {
  // The SPA edited against revision 1 but the canonical doc is revision 2 →
  // the race guard (AC-10) must NOT apply the stale ops; the message carries
  // the STALE directive + echo table + canonical JSON, no rendered ops.
  const staleEnvelope = { ...REVISE_ENVELOPE, baseRevision: 1 };
  const { stdout, stderr, code } = await runRealSpaExit(
    VALID_DOC,
    PREVIOUS_DOC,
    'deny',
    staleEnvelope,
  );
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
  assert.equal(decision.behavior, 'deny');
  const msg = decision.message;
  assert.ok(
    msg.includes('race guard'),
    'stale ops → race-guard STALE directive emitted',
  );
  assert.ok(
    !msg.includes('## Requested changes (apply EVERY item below)'),
    'stale ops are NOT rendered (would mislead the agent into applying them)',
  );
  for (const b of VALID_DOC.blocks) {
    assert.ok(msg.includes(b.id), `stale-path echo table missing '${b.id}'`);
  }
});

// ---------------------------------------------------------------------------
// AC-17 — zero non-loopback network egress during the REAL-SPA blocking path.
// Spied at the lowest practical boundary (net.Socket.prototype.connect), like
// exit-production / exit-thinloop. The only permitted sockets are the server's
// own loopback listen + the in-proc loopback client; a non-loopback host would
// also require DNS, so connect-interception transitively proves no external
// resolution. Browser-open is the injected NO-OP here (real OS-opener spawn is
// out of scope of this in-proc spy — and is itself NOT egress from this
// process, see the openBrowserReal AC-17 boundary note in src/hook/exit.mjs).
// ---------------------------------------------------------------------------

await test('AC-17: zero external network egress during the real-SPA exit (socket connect spied)', async () => {
  const net = await import('node:net');

  const egress = [];
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    let host;
    const a0 = args[0];
    if (a0 && typeof a0 === 'object') host = a0.host;
    else if (typeof args[1] === 'string') host = args[1];
    const isLoopback =
      host == null ||
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1';
    if (!isLoopback) egress.push(`connect:${host}`);
    return origConnect.apply(this, args);
  };

  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  process.exit = () => { /* swallowed for in-proc test */ };
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  try {
    await handleExit({
      stdinText: JSON.stringify({ tool_input: { plan: JSON.stringify(VALID_DOC) } }),
      previousDoc: PREVIOUS_DOC,
      // REAL-SPA mode: NO decisionProvider. Injected no-op browser opener
      // (AC-17 — never spawn a real browser); a loopback-only client drives
      // the decision in its place.
      openBrowser: (url) => {
        const port = Number(new URL(url).port);
        post(port, '/api/approve', { source: 'in-proc-real-spa' }).catch(() => {});
      },
    });
  } finally {
    net.Socket.prototype.connect = origConnect;
    process.exit = origExit;
    process.stdout.write = origWrite;
  }

  assert.deepEqual(
    egress,
    [],
    `unexpected network egress during real-SPA exit: ${egress.join(', ')}`,
  );
  const parsed = JSON.parse(emitted.trim());
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'decision still emitted offline (real-SPA, zero egress)',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `ExitPlanMode real-SPA round-trip tests (US-014 / Step 2f.3 — AC-3, AC-4, AC-5): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
