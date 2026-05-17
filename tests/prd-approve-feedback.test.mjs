/**
 * planos — M2 Defect 1 regression: approve-with-feedback must NOT be silently
 * discarded (plain Node, zero deps).
 *
 * THE BUG (pre-M2): the PRD round-trip rendered reviewer feedback (per-block
 * comments, structured edits, answers, globalComment) ONLY on the
 * deny/request-changes path. The approve path returned a bare
 * `{ behavior: 'allow' }` and `toPermissionRequestOutput` emitted no message on
 * allow — so a reviewer who left comments AND clicked Approve had every note
 * silently dropped: the agent proceeded with the approved PRD never seeing the
 * feedback.
 *
 * THE FIX (M2): on approve, when the FeedbackEnvelope carries ops or a
 * non-empty globalComment, buildDecision renders them (reusing renderOpsHuman +
 * the (id,kind,title) echo table) into the allow's `message`, and the PRD
 * handler carries that message onto the PrdRoundTrip allow decision. A clean
 * approve (no ops, no globalComment) STAYS a bare allow with no message — no
 * noise.
 *
 * Reuses the SCRIPTED decisionProvider + child-process pattern from
 * tests/prd-roundtrip.test.mjs (fully offline — no SPA, no browser, no live
 * agent; tmpdir PRD root so the repo's prds/ is never touched).
 *
 * WHY THIS IS NOT TAUTOLOGICAL: it drives the FULL production path
 * (handlePrd → buildDecision → toPermissionRequestOutput / prd.mjs approve
 * branch) via a child process and asserts the rendered ops/comments/global
 * comment appear in the emitted `decision.message`. If Defect 1 is reintroduced
 * (approve returns a bare `{behavior:'allow'}`, or the allow message is
 * dropped) the first test FAILS because `decision.message` is then undefined /
 * missing the rendered feedback. The second test independently pins that a
 * clean approve still produces NO message, so the fix cannot "fix" the bug by
 * always attaching a message (which would be the lazy tautological patch).
 *
 * Run: node --test tests/prd-approve-feedback.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadRevision } from '../src/prd/store.mjs';

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
  id: 'prd-approve-feedback-demo-2026-05-17',
  title: 'PRD Approve-with-Feedback Demo',
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
 * The SPA POSTs the BARE FeedbackEnvelope object to /api/approve on Approve.
 * baseRevision === the round-trip's canonical revision (1) so this is a
 * clean (non-stale) approve carrying genuine reviewer feedback:
 *   - an editBlock op (a structured edit to p-context)
 *   - a comment op (a per-block comment on s-overview)
 *   - a globalComment
 */
const APPROVE_ENVELOPE_WITH_FEEDBACK = {
  decision: 'approve',
  documentId: PRD_DOC.id,
  baseRevision: 1,
  ops: [
    {
      op: 'editBlock',
      blockId: 'p-context',
      patch: { md: 'Tightened context paragraph (reviewer edit).' },
    },
    {
      op: 'comment',
      blockId: 's-overview',
      text: 'Please add a goals subsection before you start.',
    },
  ],
  globalComment: 'Approved — but fold in the note above as you implement.',
};

/** A clean approve: a structurally valid envelope with NO feedback at all. */
const APPROVE_ENVELOPE_CLEAN = {
  decision: 'approve',
  documentId: PRD_DOC.id,
  baseRevision: 1,
  ops: [],
};

// ---------------------------------------------------------------------------
// Child-process round-trip (mirrors tests/prd-roundtrip.test.mjs runScriptedPrd).
// The child runs handlePrd with an injected SCRIPTED decisionProvider that
// POSTs the given payload to /api/approve, an injected NO-OP browser opener,
// and the tmpdir rootDir. The child writes the success/decision JSON to stdout
// via the server's finish() — the full production decision path.
// ---------------------------------------------------------------------------

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-prd-approve-feedback-test-'));
}

function runScriptedApprove(doc, rootDir, postPayload) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const childScript = `
import http from 'node:http';
import { handlePrd } from '${PRD_MOD}';

const postPayload = ${JSON.stringify(postPayload)};

await handlePrd({
  stdinText: ${JSON.stringify(hookStdin)},
  rootDir: ${JSON.stringify(rootDir)},
  openBrowser: () => {},                       // no-op seam (no SPA in harness)
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const body = JSON.stringify(postPayload);
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/approve', method: 'POST',
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
// M2 Defect 1 — approve WITH feedback round-trips into the allow output.
// ---------------------------------------------------------------------------

await test('M2 Defect 1: approve + envelope (comments + editBlock + globalComment) → feedback rendered into the allow decision.message', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, stderr, code } = await runScriptedApprove(
      PRD_DOC,
      rootDir,
      APPROVE_ENVELOPE_WITH_FEEDBACK,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const parsed = JSON.parse(stdout.trim());

    // Approve semantics intact: it IS an allow, the PRD IS persisted.
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PrdRoundTrip');
    const decision = parsed.hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow', 'approve stays an allow');
    assert.equal(
      parsed.hookSpecificOutput.prd.persisted,
      true,
      'approve still persists the revision (approve semantics intact)',
    );
    const onDisk = loadRevision(rootDir, PRD_DOC.id, 1);
    assert.ok(onDisk, 'r001.json persisted on approve');

    // THE DEFECT 1 ASSERTION: the feedback is NOT silently discarded — it
    // rides along on the allow decision.message.
    const msg = decision.message;
    assert.ok(
      typeof msg === 'string' && msg.length > 0,
      'approve-with-feedback MUST carry a decision.message (Defect 1: it was dropped)',
    );

    // (a) Approve directive — the agent is told it is approved, NOT rejected.
    assert.ok(
      msg.includes('YOUR PRD WAS APPROVED'),
      'approve directive present (not a rejection)',
    );
    assert.ok(
      !msg.includes('YOUR PRD WAS NOT APPROVED'),
      'must NOT carry the deny/revise directive on an approve',
    );

    // (b) The structured editBlock op is rendered (reuses renderOpsHuman).
    assert.ok(
      msg.includes('## Requested changes (apply EVERY item below)'),
      'rendered ops section present (renderOpsHuman reused)',
    );
    assert.ok(
      msg.includes('EDIT block `p-context`'),
      'the editBlock op is spelled out for the agent',
    );
    assert.ok(
      msg.includes('Tightened context paragraph (reviewer edit).'),
      'the edit patch content reached the agent',
    );

    // (c) The per-block comment reached the agent.
    assert.ok(
      msg.includes('COMMENT on block `s-overview`'),
      'the per-block comment op is rendered',
    );
    assert.ok(
      msg.includes('Please add a goals subsection before you start.'),
      'the comment text reached the agent',
    );

    // (d) The globalComment reached the agent.
    assert.ok(
      msg.includes('Approved — but fold in the note above as you implement.'),
      'the globalComment reached the agent',
    );

    // (e) The (id,kind,title) echo table is present so the agent has the
    //     exact ids it may touch.
    assert.ok(msg.includes('| id | kind | title |'), 'echo table present');
    for (const b of PRD_DOC.blocks) {
      assert.ok(msg.includes(b.id), `echo table missing block id '${b.id}'`);
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Clean approve stays a BARE allow (no noise) — guards against the lazy
// "always attach a message" anti-fix that would make the first test pass
// tautologically.
// ---------------------------------------------------------------------------

await test('clean approve (empty envelope: no ops, no globalComment) → bare allow, NO message (no noise)', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, stderr, code } = await runScriptedApprove(
      PRD_DOC,
      rootDir,
      APPROVE_ENVELOPE_CLEAN,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const parsed = JSON.parse(stdout.trim());
    const decision = parsed.hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow', 'clean approve is an allow');
    assert.ok(
      !('message' in decision) || decision.message === undefined,
      'clean approve must stay a BARE allow — no message, no noise',
    );
    assert.equal(
      parsed.hookSpecificOutput.prd.persisted,
      true,
      'clean approve still persists the revision',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// Sanity: the scripted-harness {source} payload (no envelope at all) is also a
// bare clean allow — confirms the existing AC-P7 scripted-approve contract is
// unbroken by the Defect 1 change.
await test('scripted approve with no envelope ({source}) → still a bare clean allow', async () => {
  const rootDir = makeTempRoot();
  try {
    const { stdout, code } = await runScriptedApprove(
      PRD_DOC,
      rootDir,
      { source: 'scripted-prd-harness' },
    );
    assert.equal(code, 0);
    const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow');
    assert.ok(
      !('message' in decision) || decision.message === undefined,
      'no-envelope scripted approve stays bare (backward compatible)',
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
  `PRD approve-with-feedback regression (M2 Defect 1): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
