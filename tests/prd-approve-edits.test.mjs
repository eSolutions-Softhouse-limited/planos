/**
 * planos — M3 ("edits actually stick"): the reviewer's structural edits BECOME
 * the persisted document (plain Node, zero deps).
 *
 * M1 = PRD-only. M2 = reviewer feedback survives Approve as ADVISORY TEXT.
 * M3 = on Approve, the reviewer's edited WORKING document (transmitted on the
 * FeedbackEnvelope as `editedDocument`) is persisted as the NEXT revision via
 * the existing prd-store revision chain, and the allow `decision.message`
 * names that revision + carries the M2 change summary.
 *
 * Reuses the SCRIPTED decisionProvider + child-process pattern from
 * tests/prd-roundtrip.test.mjs (fully offline — no SPA, no browser, no live
 * agent; tmpdir PRD root so the repo's real prds/ is never touched).
 *
 * WHY (a) IS NOT TAUTOLOGICAL: the first test drives the FULL production path
 * (handlePrd → selectApproveDoc → saveRevision) via a child process and
 * asserts the ON-DISK persisted revision's canonical content equals the
 * reviewer's edited document (NOT the agent-authored one) AND that it chains
 * off the prior revision (r002 after a seeded r001, append-only r001 intact).
 * A mutation that drops the persist of the edited doc — e.g. reverting to
 * `saveRevision(rootDir, doc)` (the agent-authored doc) — FAILS this: the
 * persisted r002 would then carry the agent's title, not the reviewer's edit,
 * so `loadRevision(...,2).blocks` would not match the edited content and the
 * canonical-equality assertion fails. The no-op test (c) independently pins
 * that an edit-free approve does NOT mint a spuriously-differing revision, so
 * the fix cannot pass (a) by "always bump the revision" either.
 *
 * Run: node --test tests/prd-approve-edits.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadRevision,
  loadLatest,
  listRevisions,
  canonicalize,
} from '../src/prd/store.mjs';

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
// Fixtures — a valid v2 PRD document (authored revision 1).
// ---------------------------------------------------------------------------

const PRD_DOC = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-approve-edits-demo-2026-05-17',
  title: 'PRD Approve-with-Structural-Edits Demo',
  meta: { status: 'draft', createdAt: '2026-05-17T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Original context paragraph.' },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement the thing',
      status: 'todo',
      deps: [],
      acceptance: ['it works'],
    },
  ],
};

/**
 * The reviewer's edited WORKING document — same id, but a structural edit:
 * t-impl's title + status changed, p-context prose tightened. This is what the
 * SPA derives via deriveWorkingDoc and POSTs as editedDocument on Approve.
 * meta.revision is whatever the SPA had (1) — the server normalises it.
 */
const EDITED_DOC = {
  ...PRD_DOC,
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Tightened context (reviewer edit).' },
    {
      id: 't-impl',
      kind: 'task',
      title: 'Implement the thing — reviewer-revised',
      status: 'doing',
      deps: [],
      acceptance: ['it works', 'reviewer added this'],
    },
  ],
};

/** APPROVE envelope carrying the reviewer's edited working document (M3). */
const APPROVE_WITH_EDITS = {
  decision: 'approve',
  documentId: PRD_DOC.id,
  baseRevision: 1,
  ops: [
    {
      op: 'editBlock',
      blockId: 't-impl',
      patch: {
        title: 'Implement the thing — reviewer-revised',
        status: 'doing',
      },
    },
  ],
  globalComment: 'Approved with my edits folded in.',
  editedDocument: EDITED_DOC,
};

/**
 * APPROVE envelope where the editedDocument is canonically IDENTICAL to the
 * agent-authored doc (no structural edits) — must NOT mint a differing
 * revision (no-op correctness).
 */
const APPROVE_NO_EDITS = {
  decision: 'approve',
  documentId: PRD_DOC.id,
  baseRevision: 1,
  ops: [],
  editedDocument: { ...PRD_DOC },
};

// ---------------------------------------------------------------------------
// Child-process round-trip (mirrors tests/prd-roundtrip.test.mjs runScriptedPrd).
// ---------------------------------------------------------------------------

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-prd-approve-edits-test-'));
}

function runScripted(doc, kind, rootDir, postPayload) {
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
  openBrowser: () => {},
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
// (a) Approve WITH structural edits → a NEW revision whose canonical content
//     == the edited working doc, chained off the prior revision.
// ---------------------------------------------------------------------------

await test('M3 (a): approve-with-edits persists a NEW revision == the edited doc, chained off the prior', async () => {
  const rootDir = makeTempRoot();
  try {
    // Seed r001 (a clean approve of the agent-authored doc).
    const seed = await runScripted(PRD_DOC, 'approve', rootDir);
    assert.equal(seed.code, 0, `seed exits 0; stderr: ${seed.stderr}`);
    assert.equal(loadLatest(rootDir, PRD_DOC.id).revision, 1, 'seed → r001');
    const r1Before = JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1));

    // Round-trip 2: the agent re-authors PRD_DOC, but the reviewer EDITS it in
    // the UI and Approves — the edited working doc must become r002.
    const { stdout, stderr, code } = await runScripted(
      PRD_DOC,
      'approve',
      rootDir,
      APPROVE_WITH_EDITS,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const parsed = JSON.parse(stdout.trim());
    const prd = parsed.hookSpecificOutput.prd;

    assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(prd.revision, 2, 'reviewer-edited approve → revision 2');
    assert.equal(prd.persisted, true, 'a new revision was persisted');
    assert.equal(prd.source, 'reviewer-edited', "persisted the reviewer's doc");
    assert.equal(prd.noop, false, 'a real structural edit is not a no-op');

    // THE NON-TAUTOLOGICAL ASSERTION: the ON-DISK r002 canonical content
    // equals the reviewer's edited working doc (normalised to revision 2) —
    // NOT the agent-authored doc. Dropping the M3 persist of the edited doc
    // (reverting to saveRevision(rootDir, agentDoc)) makes this fail: r002
    // would carry the agent's title, not 'Implement the thing — reviewer-revised'.
    const onDisk = loadRevision(rootDir, PRD_DOC.id, 2);
    assert.ok(onDisk, 'r002.json written');
    const expected = {
      ...EDITED_DOC,
      meta: { ...EDITED_DOC.meta, revision: 2 },
    };
    assert.equal(
      canonicalize(onDisk),
      canonicalize(expected),
      'persisted r002 canonical content == the reviewer edited working doc',
    );
    // Spell out the load-bearing edit so a partial regression is obvious.
    const tImpl = onDisk.blocks.find((b) => b.id === 't-impl');
    assert.equal(
      tImpl.title,
      'Implement the thing — reviewer-revised',
      "reviewer's edited task title stuck (not the agent-authored title)",
    );
    assert.equal(tImpl.status, 'doing', "reviewer's status edit stuck");

    // Chain integrity: r001 is byte-identical (append-only) and r002 links it.
    assert.equal(
      JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1)),
      r1Before,
      'r001 is byte-identical after r002 lands (append-only chain)',
    );
    assert.equal(loadLatest(rootDir, PRD_DOC.id).revision, 2, 'latest → r002');
    const revs = listRevisions(rootDir, PRD_DOC.id).map((x) => x.revision);
    assert.deepEqual(revs, [2, 1], 'chain is [2,1] — r002 chained off r001');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) The allow decision.message names the persisted revision + carries the
//     M2 change summary.
// ---------------------------------------------------------------------------

await test('M3 (b): allow decision.message names the persisted revision + carries the M2 change summary', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, stderr, code } = await runScripted(
      PRD_DOC,
      'approve',
      rootDir,
      APPROVE_WITH_EDITS,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow');
    const msg = decision.message;
    assert.ok(typeof msg === 'string' && msg.length > 0, 'allow carries a message');

    // Names the persisted revision (id + number + path).
    assert.ok(
      msg.includes('Persisted document (work from THIS revision)'),
      'persistence section present',
    );
    assert.ok(msg.includes('revision 1'), 'the persisted revision number is named');
    assert.ok(
      msg.includes(`prds`) && msg.includes(PRD_DOC.id),
      'the on-disk path (prds/<id>/...) is named',
    );

    // M2 change summary still rides along (approve directive + rendered ops +
    // echo table — reused verbatim from M2 buildApproveFeedbackMessage).
    assert.ok(
      msg.includes('YOUR PRD WAS APPROVED'),
      'M2 approve directive carried (not a rejection)',
    );
    assert.ok(
      msg.includes('## Requested changes (apply EVERY item below)'),
      'M2 rendered ops summary carried',
    );
    assert.ok(
      msg.includes('Approved with my edits folded in.'),
      'M2 globalComment carried',
    );
    assert.ok(msg.includes('| id | kind | title |'), 'M2 echo table carried');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) Approve with NO structural edits does NOT create a spuriously-differing
//     revision (matches the store dedupe contract: append-only + monotonic,
//     no content-dedupe of its own → we must skip the persist ourselves).
// ---------------------------------------------------------------------------

await test('M3 (c): approve with NO structural edits does not mint a spuriously-differing revision', async () => {
  const rootDir = makeTempRoot();
  try {
    // Seed r001.
    await runScripted(PRD_DOC, 'approve', rootDir);
    assert.equal(loadLatest(rootDir, PRD_DOC.id).revision, 1, 'seed → r001');
    const r1Before = JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1));

    // Re-approve with an editedDocument that canonicalizes EQUAL to r001's
    // content — the reviewer opened the UI and approved without editing.
    const { stdout, stderr, code } = await runScripted(
      PRD_DOC,
      'approve',
      rootDir,
      APPROVE_NO_EDITS,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const prd = JSON.parse(stdout.trim()).hookSpecificOutput.prd;

    // No new revision: still only r001; latest unchanged; r001 byte-identical.
    assert.equal(prd.noop, true, 'reported as a no-op');
    assert.equal(prd.persisted, false, 'nothing persisted');
    assert.equal(prd.revision, 1, 'current revision stays 1');
    assert.equal(
      listRevisions(rootDir, PRD_DOC.id).length,
      1,
      'still exactly one revision (no spurious r002)',
    );
    assert.equal(
      JSON.stringify(loadRevision(rootDir, PRD_DOC.id, 1)),
      r1Before,
      'r001 untouched (append-only + content-dedupe honoured)',
    );
    // The agent is still told the current revision explicitly (state change to
    // communicate — "you approved, nothing new was created").
    assert.ok(
      typeof JSON.parse(stdout.trim()).hookSpecificOutput.decision.message ===
        'string',
      'no-op approve still names the current revision for the agent',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) Deny / request-changes still round-trips unchanged (M2 contract intact —
//     no editedDocument is honoured on the deny path; the re-author loop is
//     exactly as before).
// ---------------------------------------------------------------------------

await test('M3 (d): deny/request-changes round-trips unchanged (no editedDocument honoured, re-author loop intact)', async () => {
  const rootDir = makeTempRoot();
  try {
    // A deny payload that ALSO (maliciously/accidentally) carries an
    // editedDocument — it MUST be ignored: deny never persists.
    const denyEnvelope = {
      decision: 'revise',
      documentId: PRD_DOC.id,
      baseRevision: 1,
      ops: [
        { op: 'comment', blockId: 's-overview', text: 'Needs a goals subsection.' },
      ],
      globalComment: 'Not yet — expand it.',
      editedDocument: EDITED_DOC,
    };
    const { stdout, stderr, code } = await runScripted(
      PRD_DOC,
      'deny',
      rootDir,
      denyEnvelope,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'deny', 'revise → deny');
    const msg = decision.message;
    assert.ok(
      msg.includes('YOUR PRD WAS NOT APPROVED'),
      'tuned revise directive present (re-author loop intact)',
    );
    assert.ok(
      msg.includes('## Requested changes (apply EVERY item below)'),
      'reviewer ops rendered into the deny message (M2 unchanged)',
    );
    assert.ok(msg.includes('Not yet — expand it.'), 'globalComment threaded');
    assert.ok(msg.includes('| id | kind | title |'), 'echo table present');
    // The canonical JSON in the deny message is the AGENT-authored doc, NOT
    // the smuggled editedDocument — deny never adopts a client doc.
    const jsonStart = msg.indexOf('```json');
    const fence = msg.slice(jsonStart + 7);
    const jsonText = fence.slice(0, fence.indexOf('```')).trim();
    const roundTripped = JSON.parse(jsonText);
    const tImpl = roundTripped.blocks.find((b) => b.id === 't-impl');
    assert.equal(
      tImpl.title,
      'Implement the thing',
      'deny re-renders the AGENT doc — the smuggled editedDocument is ignored',
    );

    // Deny persists NOTHING.
    assert.equal(
      listRevisions(rootDir, PRD_DOC.id).length,
      0,
      'deny/request-changes persists nothing (re-author loop)',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `PRD approve-with-structural-edits (M3 — edits actually stick): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
