/**
 * planos — PRD-mode round-trip handler tests (plain Node, zero deps).
 *
 * Phase 2 / Milestone P2 gate. Reuses the SCRIPTED decisionProvider seam +
 * child-process pattern from tests/exit-thinloop.test.mjs (fully offline — no
 * SPA, no browser, no live agent). The PRD persistence root is ALWAYS a fresh
 * mkdtemp dir — the repo's real prds/ is never touched.
 *
 * Coverage:
 *
 *   AC-P7  — bin/planos prd round-trip: reads the authored doc, validates /
 *            degrades, boots startServer, blocks on decisionPromise; on approve
 *            persists a revision + emits success JSON; on revise emits
 *            buildReviseMessage output (directive + echo table + canonical
 *            JSON); honors flush-then-exit-0.
 *   AC-P8  — baseRevision race guard fires on the PRD round-trip identically to
 *            the plan loop (stale ops rejected, re-render signaled).
 *   AC-P10 — round-trip half: two successive approves → r001 + r002 with
 *            monotonic meta.revision, shared doc id, correct diffDocuments.
 *   AC-P12 — buildPrdApiHandlers serves the FULL persisted chain via
 *            /api/prd/versions + /api/prd/version?v=N (read-only, zero egress).
 *
 * Run: node --test tests/prd-roundtrip.test.mjs   (or: node tests/prd-roundtrip.test.mjs)
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildPrdApiHandlers } from '../src/hook/prd.mjs';
import {
  loadRevision,
  listRevisions,
  loadLatest,
} from '../src/prd/store.mjs';
import { diffDocuments, DIFF_STATUS } from '../src/diff/structural.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRD_MOD = join(__dirname, '../src/hook/prd.mjs');

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
// Fixtures — valid v2 PRD documents (D5: type:"prd" accepts v1∪v2 kinds).
// ---------------------------------------------------------------------------

/** A small but complete valid v2 PRD document (authored revision 1). */
const PRD_DOC = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-roundtrip-demo-2026-05-16',
  title: 'PRD Round-trip Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the PRD-mode blocking round-trip.' },
    {
      id: 'ph-build',
      kind: 'phase',
      title: 'Build phase',
      taskIds: ['t-impl'],
    },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement the PRD handler',
      status: 'todo',
      deps: [],
      acceptance: ['round-trip persists a revision'],
    },
    {
      id: 'fc-prd',
      kind: 'fileChange',
      path: 'src/hook/prd.mjs',
      action: 'add',
      rationale: 'New PRD-mode round-trip handler.',
    },
  ],
};

/** A revised version of PRD_DOC (same id) the agent would re-author. */
const PRD_DOC_REVISED = {
  ...PRD_DOC,
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the PRD-mode blocking round-trip (revised).' },
    {
      id: 'ph-build',
      kind: 'phase',
      title: 'Build and verify phase',
      taskIds: ['t-impl', 't-test'],
    },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement the PRD handler',
      status: 'todo',
      deps: [],
      acceptance: ['round-trip persists a revision'],
    },
    {
      id: 't-test',
      kind: 'task',
      title: 'Test the PRD handler',
      status: 'todo',
      deps: ['t-impl'],
      acceptance: ['AC-P7 green'],
    },
    {
      id: 'fc-prd',
      kind: 'fileChange',
      path: 'src/hook/prd.mjs',
      action: 'add',
      rationale: 'New PRD-mode round-trip handler.',
    },
  ],
};

/**
 * A structurally-valid FeedbackEnvelope the SPA would POST to /api/deny on
 * "revise". baseRevision === the round-trip's persisted revision (1) so the
 * race guard does NOT trip (ops are rendered into the deny message).
 */
const REVISE_ENVELOPE = {
  decision: 'revise',
  documentId: 'prd-roundtrip-demo-2026-05-16',
  baseRevision: 1,
  ops: [
    {
      op: 'editBlock',
      blockId: 'p-context',
      patch: { md: 'Proving the PRD-mode blocking round-trip (revised).' },
    },
    { op: 'comment', blockId: 's-overview', text: 'Add a goals subsection.' },
  ],
  globalComment: 'Expand the build phase before approval.',
};

// ---------------------------------------------------------------------------
// Helper: HTTP POST (node:http, no fetch).
// ---------------------------------------------------------------------------

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-prd-roundtrip-test-'));
}

// ---------------------------------------------------------------------------
// AC-P12 — buildPrdApiHandlers serves the FULL persisted chain (pure unit).
// ---------------------------------------------------------------------------

await test('AC-P12: buildPrdApiHandlers exposes the full persisted chain (read-only)', () => {
  const r1 = { ...PRD_DOC, meta: { ...PRD_DOC.meta, revision: 1 } };
  const r2 = { ...PRD_DOC_REVISED, meta: { ...PRD_DOC.meta, revision: 2 } };
  const r3 = { ...PRD_DOC_REVISED, meta: { ...PRD_DOC.meta, revision: 3 } };
  // current = r3; chain holds r1 + r2 (the persisted predecessors).
  const handlers = buildPrdApiHandlers(r3, [r1, r2]);

  const root = handlers['GET /api/prd']({ url: '/api/prd' });
  assert.equal(root.json.plan.meta.revision, 3, 'current revision served');
  assert.equal(root.json.origin, 'planos-prd');
  assert.equal(root.json.previousPlan.meta.revision, 2, 'immediate predecessor is the diff base');
  assert.equal(root.json.versionInfo.previousRevision, 2);

  const versions = handlers['GET /api/prd/versions']({ url: '/api/prd/versions' });
  assert.equal(versions.json.versions.length, 3, 'FULL chain (r1+r2+r3), not just current+prev');
  assert.deepEqual(
    versions.json.versions.map((x) => x.revision),
    [1, 2, 3],
    'chain is ascending + complete',
  );

  const v1 = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=1' });
  assert.equal(v1.json.plan.meta.revision, 1, 'ANY earlier revision is fetchable');
  const v2 = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=2' });
  assert.equal(v2.json.plan.meta.revision, 2);
  const vMissing = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=99' });
  assert.equal(vMissing.status, 404, 'unknown revision → 404');
});

// ---------------------------------------------------------------------------
// Child-process round-trip. The child runs handlePrd with an injected SCRIPTED
// decisionProvider that POSTs approve/deny, an injected NO-OP browser opener,
// and the tmpdir rootDir. The child writes the success/decision JSON to stdout
// via the server's finish() — proving flush-then-exit-0 ordering.
// ---------------------------------------------------------------------------

/**
 * @param {object} doc            authored PRD doc (tool_input.plan)
 * @param {'approve'|'deny'} kind which endpoint the scripted driver hits
 * @param {string} rootDir        tmpdir PRD persistence root
 * @param {object} [postPayload]  body the scripted driver POSTs (e.g. envelope)
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runScriptedPrd(doc, kind, rootDir, postPayload) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const payload =
    postPayload !== undefined
      ? postPayload
      : kind === 'approve'
        ? { source: 'scripted-prd-harness' }
        : { feedback: 'Scripted PRD forced-revise.' };
  const childScript = `
import http from 'node:http';
import { handlePrd } from '${PRD_MOD}';

const kind = ${JSON.stringify(kind)};
const postPayload = ${JSON.stringify(payload)};

await handlePrd({
  stdinText: ${JSON.stringify(hookStdin)},
  rootDir: ${JSON.stringify(rootDir)},
  openBrowser: () => {},                       // no-op seam (no SPA in harness)
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const path = kind === 'approve' ? '/api/approve' : '/api/deny';
    const body = JSON.stringify(postPayload);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); },
    );
    req.end(body);
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

// ---------------------------------------------------------------------------
// AC-P7 — approve persists a revision + emits success JSON; flush-then-exit-0.
// ---------------------------------------------------------------------------

await test('AC-P7: scripted approve → persists r001 + success JSON, exit 0, flush-then-exit', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, stderr, code } = await runScriptedPrd(PRD_DOC, 'approve', rootDir);
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    assert.ok(stdout.trim().length > 0, 'stdout non-empty');
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PrdRoundTrip');
    assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(parsed.hookSpecificOutput.prd.documentId, PRD_DOC.id);
    assert.equal(parsed.hookSpecificOutput.prd.revision, 1, 'first round-trip → revision 1');
    assert.equal(parsed.hookSpecificOutput.prd.persisted, true, 'revision persisted');

    // The revision file actually landed in the tmpdir (D1 layout).
    const onDisk = loadRevision(rootDir, PRD_DOC.id, 1);
    assert.ok(onDisk, 'r001.json written to the tmpdir prds/ tree');
    assert.equal(onDisk.id, PRD_DOC.id, 'persisted doc id matches');
    assert.equal(onDisk.meta.revision, 1);
    const latest = loadLatest(rootDir, PRD_DOC.id);
    assert.equal(latest.revision, 1, 'latest.json points at r001');

    // Flush-then-exit-0 ordering (PRD path): stdout JSON complete AND exit 0.
    assert.ok(
      stdout.trim().endsWith('}') && code === 0,
      'flush-then-exit-0 ordering confirmed on the approve path',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

await test('AC-P7: scripted revise → buildReviseMessage output (directive + echo table + canonical JSON), no persistence', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, stderr, code } = await runScriptedPrd(PRD_DOC, 'deny', rootDir);
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'deny', 'revise → behavior:"deny"');
    const msg = decision.message;
    assert.ok(typeof msg === 'string' && msg.length > 0, 'deny carries a message');

    // (a) Tuned directive preamble (reused verbatim from the plan loop).
    assert.ok(msg.includes('YOUR PLAN WAS NOT APPROVED'), 'tuned directive preamble present');
    // (b) Reviewer feedback threaded.
    assert.ok(msg.includes('Scripted PRD forced-revise.'), 'reviewer feedback threaded');
    // (c) (id,kind,title) echo table — every block id + kind.
    assert.ok(msg.includes('| id | kind | title |'), 'echo table header present');
    assert.ok(msg.includes('REUSE'), 'echo table carries the REUSE directive');
    for (const b of PRD_DOC.blocks) {
      assert.ok(msg.includes(b.id), `echo table missing block id '${b.id}'`);
      assert.ok(msg.includes(b.kind), `echo table missing block kind '${b.kind}'`);
    }
    // (d) Canonical JSON of the current document (revise-from-this-exact-JSON).
    assert.ok(msg.includes('```json'), 'canonical JSON fenced block present');
    const jsonStart = msg.indexOf('```json');
    const fence = msg.slice(jsonStart + 7);
    const jsonText = fence.slice(0, fence.indexOf('```')).trim();
    const roundTripped = JSON.parse(jsonText);
    assert.equal(roundTripped.id, PRD_DOC.id, 'canonical JSON round-trips the PRD doc');
    assert.equal(roundTripped.type, 'prd', 'PRD document type preserved');

    // Revise must NOT persist a revision.
    assert.equal(listRevisions(rootDir, PRD_DOC.id).length, 0, 'revise persists nothing');

    // Flush-then-exit-0 ordering on the revise path too.
    assert.ok(
      stdout.trim().endsWith('}') && code === 0,
      'flush-then-exit-0 ordering confirmed on the revise path',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

await test('AC-P7: malformed PRD input → degraded prose (type:"prd"), still resolves + persists + exits 0', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, code } = await runScriptedPrd(
      /** not a valid doc */ { not: 'a prd' },
      'approve',
      rootDir,
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.equal(
      parsed.hookSpecificOutput.decision.behavior,
      'allow',
      'user never blocked by malformed PRD input',
    );
    assert.equal(parsed.hookSpecificOutput.prd.persisted, true, 'degraded PRD still persisted');
    // The persisted degraded doc is a valid type:"prd" document (AC-P3 / D5).
    const docId = parsed.hookSpecificOutput.prd.documentId;
    const onDisk = loadRevision(rootDir, docId, 1);
    assert.ok(onDisk, 'degraded PRD revision persisted');
    assert.equal(onDisk.type, 'prd', 'degraded PRD stays type:"prd"');
    assert.equal(onDisk.meta.degraded, true, 'degraded flag set');
    assert.equal(onDisk.blocks.length, 1, 'exactly one prose block');
    assert.equal(onDisk.blocks[0].kind, 'prose');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-P8 — baseRevision race guard fires identically to the plan loop.
// ---------------------------------------------------------------------------

await test('AC-P8: stale baseRevision trips the race guard (ops NOT applied, re-render signaled)', async () => {
  const rootDir = makeTempRoot();
  try {
    // Seed a persisted r001 so the next round-trip's canonical revision is 2.
    const seed = await runScriptedPrd(PRD_DOC, 'approve', rootDir);
    assert.equal(seed.code, 0, 'seed approve persisted r001');
    assert.equal(loadLatest(rootDir, PRD_DOC.id).revision, 1);

    // Second round-trip: canonical doc is now revision 2 (prior + 1). The SPA
    // edited against revision 1 → the race guard MUST NOT apply the stale ops.
    const staleEnvelope = { ...REVISE_ENVELOPE, baseRevision: 1 };
    const { stdout, stderr, code } = await runScriptedPrd(
      PRD_DOC_REVISED,
      'deny',
      rootDir,
      staleEnvelope,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'deny');
    const msg = decision.message;
    assert.ok(msg.includes('race guard'), 'stale ops → race-guard STALE directive emitted');
    assert.ok(
      !msg.includes('## Requested changes (apply EVERY item below)'),
      'stale ops are NOT rendered (would mislead the agent into applying them)',
    );
    for (const b of PRD_DOC_REVISED.blocks) {
      assert.ok(msg.includes(b.id), `stale-path echo table missing '${b.id}'`);
    }
    // No new revision persisted by a revise.
    assert.equal(
      listRevisions(rootDir, PRD_DOC.id).length,
      1,
      'race-guarded revise persists nothing (still only r001)',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

await test('AC-P8: fresh baseRevision matches → ops applied (rendered into the deny message)', async () => {
  const rootDir = makeTempRoot();
  try {
    // First round-trip → canonical revision 1; envelope.baseRevision === 1.
    const { stdout, stderr, code } = await runScriptedPrd(
      PRD_DOC,
      'deny',
      rootDir,
      REVISE_ENVELOPE,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'deny');
    const msg = decision.message;
    assert.ok(
      msg.includes('## Requested changes (apply EVERY item below)'),
      'matching baseRevision → ops rendered into the deny message',
    );
    assert.ok(!msg.includes('race guard'), 'no stale directive when baseRevision matches');
    assert.ok(
      msg.includes('Expand the build phase before approval.'),
      'globalComment threaded into the rendered ops',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-P10 (round-trip half) — two successive approves → r001 + r002 monotonic,
// shared id, correct structural diff between them.
// ---------------------------------------------------------------------------

await test('AC-P10: two successive approves → r001 + r002 monotonic, shared id, correct diffDocuments', async () => {
  const rootDir = makeTempRoot();
  try {
    // Round-trip 1: author PRD_DOC, approve → r001 (revision 1).
    const rt1 = await runScriptedPrd(PRD_DOC, 'approve', rootDir);
    assert.equal(rt1.code, 0, 'round-trip 1 exits 0');
    const p1 = JSON.parse(rt1.stdout.trim()).hookSpecificOutput.prd;
    assert.equal(p1.revision, 1, 'first approve → revision 1');

    // Round-trip 2: author the revised PRD (same id), approve → r002 (rev 2).
    const rt2 = await runScriptedPrd(PRD_DOC_REVISED, 'approve', rootDir);
    assert.equal(rt2.code, 0, 'round-trip 2 exits 0');
    const p2 = JSON.parse(rt2.stdout.trim()).hookSpecificOutput.prd;
    assert.equal(p2.revision, 2, 'second approve → revision 2 (monotonic)');
    assert.equal(p2.documentId, p1.documentId, 'shared doc id across revisions');

    // Both revision files exist on disk with monotonic meta.revision.
    const r1 = loadRevision(rootDir, PRD_DOC.id, 1);
    const r2 = loadRevision(rootDir, PRD_DOC.id, 2);
    assert.ok(r1 && r2, 'both r001.json + r002.json persisted');
    assert.equal(r1.meta.revision, 1);
    assert.equal(r2.meta.revision, 2);
    assert.equal(r1.id, r2.id, 'shared id on disk');
    const revs = listRevisions(rootDir, PRD_DOC.id).map((x) => x.revision);
    assert.deepEqual(revs, [2, 1], 'listRevisions newest-first: [2, 1]');
    assert.equal(loadLatest(rootDir, PRD_DOC.id).revision, 2, 'latest.json → r002');

    // The existing structural diff engine computes a correct diff r001 → r002.
    const diff = diffDocuments(r1, r2);
    const byId = new Map(diff.blocks.map((b) => [b.id, b.status]));
    // p-context md changed → modified; ph-build taskIds changed → modified;
    // t-test is brand new → added; unchanged blocks → unchanged.
    assert.equal(byId.get('p-context'), DIFF_STATUS.MODIFIED, 'edited prose → modified');
    assert.equal(byId.get('ph-build'), DIFF_STATUS.MODIFIED, 'edited phase → modified');
    assert.equal(byId.get('t-test'), DIFF_STATUS.ADDED, 'new task → added');
    assert.equal(byId.get('s-overview'), DIFF_STATUS.UNCHANGED, 'untouched section → unchanged');
    assert.ok(
      [...byId.values()].some((s) => s === DIFF_STATUS.ADDED),
      'diff reports at least one added block',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

await test('AC-P10: append-only invariant — the persisted chain is immutable across round-trips', async () => {
  const rootDir = makeTempRoot();
  try {
    await runScriptedPrd(PRD_DOC, 'approve', rootDir);
    const r1First = JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1));
    await runScriptedPrd(PRD_DOC_REVISED, 'approve', rootDir);
    const r1After = JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1));
    assert.equal(r1First, r1After, 'r001 is byte-identical after r002 lands (append-only)');
    assert.ok(existsSync(join(rootDir, 'prds', PRD_DOC.id, 'r002.json')), 'r002 added, not overwritten');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `PRD-mode round-trip tests (Phase 2 / Milestone P2 — AC-P7, AC-P8, AC-P10, AC-P12): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
