/**
 * planos — diff-review envelope-shape smoke (Phase 3 / Milestone R5, D6 cheap
 * gate).
 *
 * Contract: planos-phase3-plan.md "Resolved Decisions" R2 → Option A
 * (EPHEMERAL — a diff review is NOT persisted; no reviews/ dir, no
 * src/review/store.mjs, no saveRevision; the review round-trip emits a
 * structured review envelope back to the agent and exits) and R5 → hunk-level
 * verdict carried in a `BlockComment{commentId,hunkId,text,verdict}`, NO new
 * envelope op. §6 AC-R7 + AC-R12, §7 Milestone R5.3.
 * docs/adr/0003-diff-review.md AC-R-WAIVER section (D6 lighter-but-rigorous
 * gate — NO new frozen numeric bar, NO Milestone-1-style ID re-measurement).
 *
 * What this is (and is NOT):
 *   - It is the EPHEMERAL-path analogue of `tests/harness/prd-smoke.mjs`. The
 *     prd-smoke proves PERSISTENCE (r001/r002 on disk). R2 = ephemeral, so a
 *     diff review is NEVER persisted — there is nothing on disk to assert.
 *     Instead this is a CHEAP, DETERMINISTIC, REPEATABLE concrete proof of the
 *     STRUCTURED REVIEW ENVELOPE SHAPE: it drives the REAL `bin/planos review`
 *     round-trip via the SCRIPTED decision seam (the exact seam tests/
 *     review-roundtrip.test.mjs uses) against an authored v3 diff-review doc
 *     whose `diff` blocks carry per-hunk `BlockComment{verdict}` accept /
 *     reject / comment annotations, and asserts the emitted `ReviewRoundTrip`
 *     structured envelope has the correct shape — per-hunk verdicts + comments
 *     + overall decision + `persisted:false` — is byte-deterministic across two
 *     identical round-trips, AND that NO `reviews/` directory is ever created
 *     (the R2 = ephemeral invariant — there is no persistence side-effect).
 *   - It is NOT a frozen numeric gate and spends NO `claude`. The diff-review
 *     round-trip + agent authoring reuse Phase 1/2 machinery VERBATIM
 *     (readStdin/extractPlan/planToDocument/buildDecision/buildReviseMessage/
 *     renderEchoTable/startServer); Phase 3 adds only the review entry path +
 *     the pure src/review/ingest.mjs parser, both deterministic and exercised
 *     here offline. Re-measuring model behaviour would be redundant per the D6
 *     / AC-R-WAIVER reasoned waiver (mirrors Phase 2's AC-P18).
 *
 * Exit code: 0 = all assertions passed; non-zero = a regression.
 *
 * Run: node tests/harness/review-smoke.mjs
 * No network. No `claude`. No external dependencies. Plain Node.
 */

'use strict';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');
const REVIEW_MOD = join(__dirname, '../../src/hook/review.mjs');

// ---------------------------------------------------------------------------
// One authored v3 diff-review document (R7: type:"diff-review" accepts v1∪v3 —
// section/prose/openQuestion + diff). The `diff` block carries per-hunk
// BlockComment verdicts (R5: accept / reject / comment) so the structured
// envelope has a non-trivial shape to assert. Shapes match
// tests/v3-schema.test.mjs / tests/review-roundtrip.test.mjs known-valid
// Hunk/BlockComment fixtures (DiffLine.op is the literal unified-diff marker
// ' ' / '+' / '-').
// ---------------------------------------------------------------------------

const DOC_ID = 'review-smoke-2026-05-16';

const REVIEW_DOC = {
  schemaVersion: 1,
  type: 'diff-review',
  id: DOC_ID,
  title: 'Diff-Review Envelope-Shape Smoke',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's0', kind: 'section', title: 'Review of PR #99', level: 1 },
    { id: 'p0', kind: 'prose', md: 'Proving the ephemeral diff-review envelope shape.' },
    {
      id: 'dr-1',
      kind: 'diff',
      path: 'src/auth/session.js',
      status: 'modified',
      hunks: [
        {
          header: '@@ -10,4 +10,5 @@ function renew(session)',
          oldStart: 10,
          oldLines: 4,
          newStart: 10,
          newLines: 5,
          lines: [
            { op: ' ', text: 'function renew(session) {' },
            { op: '-', text: '  return session.token;' },
            { op: '+', text: '  const t = rotate(session);' },
            { op: '+', text: '  return t;' },
            { op: ' ', text: '}' },
          ],
          hunkId: 'dr-1-h1',
        },
      ],
      comments: [
        {
          commentId: 'dr-1-c1',
          hunkId: 'dr-1-h1',
          text: 'Token rotation looks correct — accept.',
          verdict: 'accept',
        },
        {
          commentId: 'dr-1-c2',
          hunkId: null,
          text: 'Overall this file change is reasonable.',
          verdict: 'comment',
        },
      ],
    },
    {
      id: 'dr-2',
      kind: 'diff',
      path: 'src/auth/legacy.js',
      status: 'modified',
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          lines: [
            { op: '-', text: 'var legacy = true;' },
            { op: '+', text: 'var legacy = false;' },
          ],
          hunkId: 'dr-2-h1',
        },
      ],
      comments: [
        {
          commentId: 'dr-2-c1',
          hunkId: 'dr-2-h1',
          text: 'Do not flip this flag here — reject.',
          verdict: 'reject',
        },
      ],
    },
    { id: 'q0', kind: 'openQuestion', question: 'Is the rotation cadence configurable?' },
  ],
};

// ---------------------------------------------------------------------------
// Drive the REAL bin/planos review round-trip once via the SCRIPTED seam (the
// exact pattern tests/review-roundtrip.test.mjs uses — no SPA, no browser, no
// `claude`, fully offline; the only socket is a loopback approve POST). R2 =
// ephemeral, so there is NO rootDir / persistence root at all.
// ---------------------------------------------------------------------------

function runScriptedReviewApprove(doc) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const childScript = `
import http from 'node:http';
import { handleReview } from ${JSON.stringify(REVIEW_MOD)};

await handleReview({
  stdinText: ${JSON.stringify(hookStdin)},
  openBrowser: () => {},                       // no-op seam (no SPA, no opener)
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const body = JSON.stringify({ source: 'review-smoke' });
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
      cwd: REPO_ROOT,
    });
    child.stdin.end(childScript);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => res({ stdout, stderr, code }));
  });
}

/** True iff any reviews-ish persistence directory exists at the repo root. */
function reviewsDirExists() {
  for (const cand of [
    join(REPO_ROOT, 'reviews'),
    join(REPO_ROOT, 'prds', '..', 'reviews'),
  ]) {
    if (existsSync(cand)) return true;
  }
  try {
    return readdirSync(REPO_ROOT, { withFileTypes: true }).some(
      (e) => e.isDirectory() && /^reviews?$/i.test(e.name),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The smoke: two IDENTICAL real round-trips for ONE doc → assert the structured
// review envelope SHAPE is correct, byte-deterministic, and EPHEMERAL.
// ---------------------------------------------------------------------------

async function main() {
  // R2 = ephemeral precondition: no reviews/ dir before the round-trip.
  assert.equal(
    reviewsDirExists(),
    false,
    'precondition: no reviews/ dir before the round-trip (R2 = ephemeral)',
  );

  // --- Round-trip 1: author REVIEW_DOC, scripted approve ------------------
  const rt1 = await runScriptedReviewApprove(REVIEW_DOC);
  assert.equal(rt1.code, 0, `round-trip 1 must exit 0 (stderr: ${rt1.stderr})`);
  const out1 = JSON.parse(rt1.stdout.trim());
  assert.equal(
    out1.hookSpecificOutput.hookEventName,
    'ReviewRoundTrip',
    'emits a ReviewRoundTrip envelope',
  );
  assert.equal(
    out1.hookSpecificOutput.decision.behavior,
    'allow',
    'approve → allow',
  );
  const review = out1.hookSpecificOutput.review;

  // --- Structured envelope SHAPE (R5: per-hunk verdicts + comments + overall)
  assert.equal(review.documentId, DOC_ID, 'documentId === doc id');
  assert.equal(review.revision, 1, 'first round-trip → revision 1');
  assert.equal(review.persisted, false, 'R2 ephemeral: persisted === false');
  assert.equal(review.overall, 'approve', 'overall decision = approve (human approved)');
  assert.equal(
    review.hasRejections,
    true,
    'dr-2-h1 carries a reject verdict → hasRejections === true',
  );

  // Per-hunk verdicts: ONLY hunk-anchored comments are per-hunk verdicts; the
  // file-level (hunkId:null) comment is a comment, not a per-hunk verdict.
  assert.equal(
    review.hunkVerdicts.length,
    2,
    'two per-hunk verdicts (dr-1-h1 accept + dr-2-h1 reject)',
  );
  const byHunk = new Map(review.hunkVerdicts.map((h) => [h.hunkId, h]));
  assert.ok(byHunk.has('dr-1-h1') && byHunk.has('dr-2-h1'), 'both hunk anchors present');
  assert.equal(byHunk.get('dr-1-h1').verdict, 'accept', 'dr-1-h1 → accept');
  assert.equal(byHunk.get('dr-1-h1').blockId, 'dr-1', 'dr-1-h1 anchored to block dr-1');
  assert.equal(byHunk.get('dr-1-h1').path, 'src/auth/session.js', 'dr-1-h1 carries file path');
  assert.equal(byHunk.get('dr-2-h1').verdict, 'reject', 'dr-2-h1 → reject');
  assert.equal(byHunk.get('dr-2-h1').blockId, 'dr-2', 'dr-2-h1 anchored to block dr-2');
  assert.equal(byHunk.get('dr-2-h1').path, 'src/auth/legacy.js', 'dr-2-h1 carries file path');

  // Comments: every BlockComment surfaced (2 hunk-anchored + 1 file-level).
  assert.equal(review.comments.length, 3, 'all 3 BlockComments surfaced');
  assert.ok(
    review.comments.some((c) => c.hunkId === null && c.verdict === 'comment'),
    'file-level (hunkId:null) comment carried with verdict comment',
  );
  assert.ok(
    review.comments.every(
      (c) => typeof c.commentId === 'string' && c.commentId.length > 0,
    ),
    'every surfaced comment carries a stable commentId',
  );

  // --- R2 EPHEMERAL: NO reviews/ side-effect created by the round-trip ----
  assert.equal(
    reviewsDirExists(),
    false,
    'R2 ephemeral: NO reviews/ dir created by the round-trip (no persistence)',
  );

  // --- Round-trip 2: IDENTICAL input → byte-deterministic envelope --------
  const rt2 = await runScriptedReviewApprove(REVIEW_DOC);
  assert.equal(rt2.code, 0, `round-trip 2 must exit 0 (stderr: ${rt2.stderr})`);
  const review2 = JSON.parse(rt2.stdout.trim()).hookSpecificOutput.review;
  assert.equal(
    JSON.stringify(review2),
    JSON.stringify(review),
    'identical input → byte-identical structured review envelope (deterministic)',
  );
  assert.equal(
    reviewsDirExists(),
    false,
    'R2 ephemeral: still NO reviews/ dir after the second round-trip',
  );

  console.log('Diff-review envelope-shape smoke — REAL bin/planos review round-trip x2 (scripted seam, offline, no claude)');
  console.log('  R2 = ephemeral: NO rootDir, NO reviews/ dir created (no persistence side-effect)');
  console.log(`  documentId=${review.documentId} revision=${review.revision} persisted=${review.persisted}`);
  console.log(`  overall=${review.overall} hasRejections=${review.hasRejections}`);
  console.log('  per-hunk verdicts: dr-1-h1=accept (src/auth/session.js) dr-2-h1=reject (src/auth/legacy.js)');
  console.log('  comments: 3 surfaced (2 hunk-anchored + 1 file-level hunkId:null)');
  console.log('  deterministic: identical input → byte-identical structured review envelope ×2');
  console.log('REVIEW SMOKE: PASS (deterministic envelope-shape proof; D6 lighter-but-rigorous gate — no frozen bar, no ID re-measurement; R2 ephemeral — no persistence)');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('REVIEW SMOKE: FAIL');
    console.error(`  ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
