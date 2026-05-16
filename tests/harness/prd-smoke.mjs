/**
 * planos — PRD persistence smoke (Phase 2 / Milestone P5, D6 cheap gate).
 *
 * Contract: planos-phase2-plan.md §6 (AC-P10), §7 P5, "Resolved Decisions" D1
 * (prds/<doc-id>/rNNN.json + latest.json, committed, append-only) and D6
 * (LIGHTER-but-rigorous gate — NO new frozen numeric bar, NO Milestone-1-style
 * ID re-measurement). docs/adr/0002-prd-persistence.md AC-P18 section.
 *
 * What this is (and is NOT):
 *   - It is a CHEAP, DETERMINISTIC, REPEATABLE concrete persistence proof: it
 *     drives the REAL `bin/planos prd` round-trip TWICE for the SAME document
 *     id through the SCRIPTED decision seam (the exact seam tests/
 *     prd-roundtrip.test.mjs uses) against a private mkdtemp prds/ root, and
 *     asserts r001 then r002 persisted with monotonic meta.revision, a shared
 *     id, and a correct structural diff between them via the existing
 *     diffDocuments engine.
 *   - It is NOT a frozen numeric gate and spends NO `claude`. The PRD
 *     round-trip + agent authoring were already proven LIVE in Phase 1's loop
 *     which src/hook/prd.mjs reuses VERBATIM (readStdin/extractPlan/
 *     planToDocument/buildDecision/buildReviseMessage/renderEchoTable/
 *     startServer); Phase 2 adds only the entry path + filesystem persistence,
 *     both of which are deterministic and exercised here offline. Re-measuring
 *     model behaviour would be redundant per the D6 / AC-P18 reasoned waiver.
 *
 * Exit code: 0 = all assertions passed; non-zero = a regression.
 *
 * Run: node tests/harness/prd-smoke.mjs
 * No network. No `claude`. No external dependencies. Plain Node.
 */

'use strict';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadRevision,
  loadLatest,
  listRevisions,
} from '../../src/prd/store.mjs';
import { diffDocuments, DIFF_STATUS } from '../../src/diff/structural.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRD_MOD = join(__dirname, '../../src/hook/prd.mjs');

// ---------------------------------------------------------------------------
// Two revisions of ONE PRD document (shared id — the revision-chain key).
// ---------------------------------------------------------------------------

const DOC_ID = 'prd-smoke-2026-05-16';

/** Authored revision 1 — a small valid v2 PRD document. */
const PRD_R1 = {
  schemaVersion: 1,
  type: 'prd',
  id: DOC_ID,
  title: 'PRD Persistence Smoke',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'First authored revision of the PRD.' },
    { id: 'ph-build', kind: 'phase', title: 'Build phase', taskIds: ['t-impl'] },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement persistence',
      status: 'todo',
      deps: [],
      acceptance: ['r001 persisted'],
    },
  ],
};

/** Authored revision 2 — same id, edited prose + a new task (forces a diff). */
const PRD_R2 = {
  ...PRD_R1,
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Second authored revision of the PRD (revised).' },
    { id: 'ph-build', kind: 'phase', title: 'Build and verify phase', taskIds: ['t-impl', 't-test'] },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement persistence',
      status: 'todo',
      deps: [],
      acceptance: ['r001 persisted'],
    },
    {
      id: 't-test',
      kind: 'task',
      title: 'Test persistence',
      status: 'todo',
      deps: ['t-impl'],
      acceptance: ['r002 persisted', 'diff correct'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Drive the REAL bin/planos prd round-trip once via the SCRIPTED seam (the
// exact pattern tests/prd-roundtrip.test.mjs uses — no SPA, no browser, no
// `claude`, fully offline; the only socket is a loopback approve POST).
// ---------------------------------------------------------------------------

function runScriptedPrdApprove(doc, rootDir) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const childScript = `
import http from 'node:http';
import { handlePrd } from ${JSON.stringify(PRD_MOD)};

await handlePrd({
  stdinText: ${JSON.stringify(hookStdin)},
  rootDir: ${JSON.stringify(rootDir)},
  openBrowser: () => {},                       // no-op seam (no SPA, no opener)
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const body = JSON.stringify({ source: 'prd-smoke' });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/approve', method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); },
    );
    req.on('error', () => {});
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
// The smoke: two real round-trips for ONE doc id → r001 + r002.
// ---------------------------------------------------------------------------

async function main() {
  const rootDir = mkdtempSync(join(tmpdir(), 'planos-prd-smoke-'));
  try {
    // --- Round-trip 1: author PRD_R1, scripted approve → r001 ---------------
    const rt1 = await runScriptedPrdApprove(PRD_R1, rootDir);
    assert.equal(rt1.code, 0, `round-trip 1 must exit 0 (stderr: ${rt1.stderr})`);
    const p1 = JSON.parse(rt1.stdout.trim()).hookSpecificOutput.prd;
    assert.equal(p1.documentId, DOC_ID, 'round-trip 1 documentId');
    assert.equal(p1.revision, 1, 'first approve → meta.revision 1');
    assert.equal(p1.persisted, true, 'r001 persisted');

    // --- Round-trip 2: author PRD_R2 (same id), scripted approve → r002 -----
    const rt2 = await runScriptedPrdApprove(PRD_R2, rootDir);
    assert.equal(rt2.code, 0, `round-trip 2 must exit 0 (stderr: ${rt2.stderr})`);
    const p2 = JSON.parse(rt2.stdout.trim()).hookSpecificOutput.prd;
    assert.equal(p2.documentId, DOC_ID, 'round-trip 2 documentId');
    assert.equal(p2.revision, 2, 'second approve → meta.revision 2 (monotonic)');
    assert.equal(p2.persisted, true, 'r002 persisted');
    assert.equal(p2.documentId, p1.documentId, 'shared doc id across revisions');

    // --- On-disk shape (D1 layout: prds/<doc-id>/rNNN.json + latest.json) ---
    const r1 = loadRevision(rootDir, DOC_ID, 1);
    const r2 = loadRevision(rootDir, DOC_ID, 2);
    assert.ok(r1, 'r001.json present on disk');
    assert.ok(r2, 'r002.json present on disk');
    assert.equal(r1.meta.revision, 1, 'r001 meta.revision === 1');
    assert.equal(r2.meta.revision, 2, 'r002 meta.revision === 2 (monotonic)');
    assert.equal(r1.id, r2.id, 'shared id on disk');
    assert.equal(r1.id, DOC_ID, 'on-disk id === doc id');
    assert.ok(
      r2.meta.revision > r1.meta.revision,
      'meta.revision strictly monotonic across the chain',
    );
    assert.deepEqual(
      listRevisions(rootDir, DOC_ID).map((x) => x.revision),
      [2, 1],
      'listRevisions newest-first: [2, 1]',
    );
    assert.equal(loadLatest(rootDir, DOC_ID).revision, 2, 'latest.json → r002');
    assert.ok(
      existsSync(join(rootDir, 'prds', DOC_ID, 'r001.json')) &&
        existsSync(join(rootDir, 'prds', DOC_ID, 'r002.json')) &&
        existsSync(join(rootDir, 'prds', DOC_ID, 'latest.json')),
      'D1 layout on disk: r001.json + r002.json + latest.json',
    );

    // --- Append-only: r001 is byte-identical after r002 lands --------------
    const r1Again = JSON.stringify(loadRevision(rootDir, DOC_ID, 1));
    assert.equal(
      r1Again,
      JSON.stringify(r1),
      'r001 is immutable after r002 is written (append-only invariant)',
    );

    // --- Correct structural diff r001 → r002 via the existing engine -------
    const diff = diffDocuments(r1, r2);
    const byId = new Map(diff.blocks.map((b) => [b.id, b.status]));
    assert.equal(
      byId.get('p-context'),
      DIFF_STATUS.MODIFIED,
      'edited prose → modified',
    );
    assert.equal(
      byId.get('ph-build'),
      DIFF_STATUS.MODIFIED,
      'edited phase (title + taskIds) → modified',
    );
    assert.equal(
      byId.get('t-test'),
      DIFF_STATUS.ADDED,
      'brand-new task → added',
    );
    assert.equal(
      byId.get('s-overview'),
      DIFF_STATUS.UNCHANGED,
      'untouched section → unchanged',
    );
    assert.equal(
      byId.get('t-impl'),
      DIFF_STATUS.UNCHANGED,
      'untouched task → unchanged',
    );

    console.log('PRD persistence smoke — REAL bin/planos prd round-trip x2 (scripted seam, offline, no claude)');
    console.log(`  rootDir: ${rootDir} (private mkdtemp; repo prds/ untouched)`);
    console.log(`  r001 persisted: revision=${r1.meta.revision} id=${r1.id}`);
    console.log(`  r002 persisted: revision=${r2.meta.revision} id=${r2.id} (monotonic, shared id)`);
    console.log('  diff r001→r002 correct: p-context=modified ph-build=modified t-test=added s-overview=unchanged');
    console.log('  append-only: r001 byte-identical after r002 landed');
    console.log('PRD SMOKE: PASS (deterministic; D6 lighter-but-rigorous gate — no frozen bar, no ID re-measurement)');
    return 0;
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('PRD SMOKE: FAIL');
    console.error(`  ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
