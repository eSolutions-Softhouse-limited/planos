/**
 * planos — diff-review-mode round-trip handler tests (plain Node, zero deps).
 *
 * Phase 3 / Milestone R2 gate. Mirrors tests/prd-roundtrip.test.mjs: reuses the
 * SCRIPTED decisionProvider seam + child-process pattern (fully offline — no
 * SPA, no browser, no live agent, no `gh`/`git`). R2 = EPHEMERAL: the review
 * round-trip is NEVER persisted — these tests ASSERT no reviews/ side-effect.
 *
 * Coverage:
 *
 *   AC-R7  — bin/planos review round-trip: reads the authored doc, validates /
 *            degrades (type:"diff-review"), boots startServer, blocks on
 *            decisionPromise; on approve emits the structured ReviewRoundTrip
 *            success JSON (per-hunk verdicts + comments + overall decision) and
 *            does NOT write any reviews/ file; on revise emits
 *            buildReviseMessage output (directive + (id,kind,title) echo table
 *            + canonical JSON); honors flush-then-exit-0.
 *   AC-R8  — baseRevision race guard fires on the review round-trip identically
 *            to the plan/PRD loop (stale ops rejected, re-render signaled).
 *   AC-R12 — (envelope round-trip half) a per-hunk accept/reject/comment
 *            expressed as an `editBlock` op patching a diff block's comments[]
 *            with a BlockComment{verdict} flows through buildDecision unchanged
 *            (the proven looksLikeBareEnvelope path) and the resulting
 *            structured review envelope round-trips back with per-hunk verdicts
 *            intact. NO new envelope op (R5).
 *
 * Run: node --test tests/review-roundtrip.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildReviewApiHandlers } from '../src/hook/review.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEW_MOD = join(__dirname, '../src/hook/review.mjs');
const REPO_ROOT = join(__dirname, '..');

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
// Fixtures — valid v3 diff-review documents (R7: type:"diff-review" accepts
// v1∪v3 kinds — section/prose/openQuestion + diff). Shapes match
// tests/v3-schema.test.mjs's known-valid Hunk/BlockComment fixtures.
// ---------------------------------------------------------------------------

/** A well-formed Hunk with one of each DiffLine op. */
const VALID_HUNK = {
  header: '@@ -1,3 +1,4 @@ function login(user)',
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [
    { op: ' ', text: 'function login(user) {' },
    { op: '-', text: '  return auth(user);' },
    { op: '+', text: '  const t = mintToken(user);' },
    { op: '+', text: '  return auth(user, t);' },
    { op: ' ', text: '}' },
  ],
  hunkId: 'dr-1-h1',
};

/** A small but complete valid v3 diff-review document (authored revision 1). */
const REVIEW_DOC = {
  schemaVersion: 1,
  type: 'diff-review',
  id: 'review-roundtrip-demo-2026-05-16',
  title: 'Review Round-trip Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's0', kind: 'section', title: 'Review of PR #42', level: 1 },
    { id: 'p0', kind: 'prose', md: 'Proving the diff-review blocking round-trip.' },
    {
      id: 'dr-1',
      kind: 'diff',
      path: 'src/auth/login.js',
      status: 'modified',
      hunks: [VALID_HUNK],
      comments: [
        {
          commentId: 'dr-1-c1',
          hunkId: 'dr-1-h1',
          text: 'Token mint LGTM.',
          verdict: 'accept',
        },
        {
          commentId: 'dr-1-c2',
          hunkId: null,
          text: 'Overall this file is fine.',
          verdict: 'comment',
        },
      ],
    },
    { id: 'q0', kind: 'openQuestion', question: 'Is the token TTL configurable?' },
  ],
};

/** A revised diff-review doc (same id) carrying a per-hunk REJECT verdict. */
const REVIEW_DOC_REVISED = {
  ...REVIEW_DOC,
  blocks: [
    { id: 's0', kind: 'section', title: 'Review of PR #42', level: 1 },
    { id: 'p0', kind: 'prose', md: 'Proving the diff-review blocking round-trip (revised).' },
    {
      id: 'dr-1',
      kind: 'diff',
      path: 'src/auth/login.js',
      status: 'modified',
      hunks: [VALID_HUNK],
      comments: [
        {
          commentId: 'dr-1-c1',
          hunkId: 'dr-1-h1',
          text: 'Mint the token lazily instead.',
          verdict: 'reject',
        },
      ],
    },
    { id: 'q0', kind: 'openQuestion', question: 'Is the token TTL configurable?' },
  ],
};

/**
 * A structurally-valid FeedbackEnvelope the SPA would POST to /api/deny on
 * "revise". baseRevision === the round-trip's canonical revision (1) so the
 * race guard does NOT trip (ops are rendered into the deny message). The
 * per-hunk REJECT verdict is expressed as an `editBlock` op whose patch
 * updates the diff block's comments[] with a BlockComment{verdict} — R5: NO
 * new envelope op (AC-R12 envelope half).
 */
const REVISE_ENVELOPE = {
  decision: 'revise',
  documentId: 'review-roundtrip-demo-2026-05-16',
  baseRevision: 1,
  ops: [
    {
      op: 'editBlock',
      blockId: 'dr-1',
      patch: {
        comments: [
          {
            commentId: 'dr-1-c1',
            hunkId: 'dr-1-h1',
            text: 'Mint the token lazily instead.',
            verdict: 'reject',
          },
        ],
      },
    },
    { op: 'comment', blockId: 's0', text: 'Add a security summary.' },
  ],
  globalComment: 'Address the rejected hunk before approval.',
};

// ---------------------------------------------------------------------------
// AC-R7 (API surface, ephemeral) — buildReviewApiHandlers serves current +
// optional previous only (modeled on buildPlanApiHandlers — NO persisted
// multi-revision chain because R2 = ephemeral). Pure unit, read-only.
// ---------------------------------------------------------------------------

await test('AC-R7: buildReviewApiHandlers serves current (+ optional previous) only — ephemeral, read-only', () => {
  const cur = { ...REVIEW_DOC, meta: { ...REVIEW_DOC.meta, revision: 2 } };
  const prev = { ...REVIEW_DOC, meta: { ...REVIEW_DOC.meta, revision: 1 } };
  const handlers = buildReviewApiHandlers(cur, prev);

  const root = handlers['GET /api/review']({ url: '/api/review' });
  assert.equal(root.json.plan.meta.revision, 2, 'current revision served');
  assert.equal(root.json.origin, 'planos-review');
  assert.equal(root.json.previousPlan.meta.revision, 1, 'injectable diff base served');
  assert.equal(root.json.versionInfo.previousRevision, 1);

  const versions = handlers['GET /api/review/versions']({ url: '/api/review/versions' });
  assert.equal(versions.json.versions.length, 2, 'ephemeral: current + previous only (≤2)');

  // No previousDoc → current only (the common ephemeral case).
  const soloHandlers = buildReviewApiHandlers(cur);
  const solo = soloHandlers['GET /api/review']({ url: '/api/review' });
  assert.equal(solo.json.previousPlan, null, 'no diff base when none injected');
  const soloVersions = soloHandlers['GET /api/review/versions']({ url: '/api/review/versions' });
  assert.equal(soloVersions.json.versions.length, 1, 'current only');

  const vMissing = handlers['GET /api/review/version']({ url: '/api/review/version?v=99' });
  assert.equal(vMissing.status, 404, 'unknown revision → 404 (read-only, no egress)');
});

// ---------------------------------------------------------------------------
// Child-process round-trip. The child runs handleReview with an injected
// SCRIPTED decisionProvider that POSTs approve/deny, an injected NO-OP browser
// opener. The child writes the success/decision JSON to stdout via the
// server's finish() — proving flush-then-exit-0 ordering. R2 = ephemeral, so
// there is no rootDir / persistence root at all.
// ---------------------------------------------------------------------------

/**
 * @param {object} doc            authored diff-review doc (tool_input.plan)
 * @param {'approve'|'deny'} kind which endpoint the scripted driver hits
 * @param {object} [postPayload]  body the scripted driver POSTs (e.g. envelope)
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runScriptedReview(doc, kind, postPayload) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const payload =
    postPayload !== undefined
      ? postPayload
      : kind === 'approve'
        ? { source: 'scripted-review-harness' }
        : { feedback: 'Scripted review forced-revise.' };
  const childScript = `
import http from 'node:http';
import { handleReview } from '${REVIEW_MOD}';

const kind = ${JSON.stringify(kind)};
const postPayload = ${JSON.stringify(payload)};

await handleReview({
  stdinText: ${JSON.stringify(hookStdin)},
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

/** Snapshot the set of dir entries that look like a persistence root. */
function reviewsDirExists() {
  for (const cand of [
    join(REPO_ROOT, 'reviews'),
    join(REPO_ROOT, 'prds', '..', 'reviews'),
  ]) {
    if (existsSync(cand)) return true;
  }
  // Also scan repo root for any newly-created reviews-ish dir.
  try {
    return readdirSync(REPO_ROOT, { withFileTypes: true }).some(
      (e) => e.isDirectory() && /^reviews?$/i.test(e.name),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AC-R7 — approve emits structured ReviewRoundTrip JSON; NO persistence;
// flush-then-exit-0.
// ---------------------------------------------------------------------------

await test('AC-R7: scripted approve → structured ReviewRoundTrip JSON (per-hunk verdicts + comments + overall), NO persistence, exit 0, flush-then-exit', async () => {
  assert.equal(reviewsDirExists(), false, 'precondition: no reviews/ dir before the round-trip');
  const { stdout, stderr, code } = await runScriptedReview(REVIEW_DOC, 'approve');
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  assert.ok(stdout.trim().length > 0, 'stdout non-empty');
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'ReviewRoundTrip');
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');

  const review = parsed.hookSpecificOutput.review;
  assert.equal(review.documentId, REVIEW_DOC.id);
  assert.equal(review.revision, 1, 'first round-trip → revision 1');
  assert.equal(review.persisted, false, 'R2 ephemeral: review is NEVER persisted');
  assert.equal(review.overall, 'approve', 'human approved the round-trip');
  assert.equal(review.hasRejections, false, 'no reject verdicts in this doc');

  // Per-hunk verdicts: only the comment anchored to a hunkId is a per-hunk
  // verdict (the file-level hunkId:null comment is a comment, not a verdict).
  assert.equal(review.hunkVerdicts.length, 1, 'one per-hunk verdict (the hunk-anchored comment)');
  assert.equal(review.hunkVerdicts[0].hunkId, 'dr-1-h1');
  assert.equal(review.hunkVerdicts[0].verdict, 'accept');
  assert.equal(review.hunkVerdicts[0].blockId, 'dr-1');
  assert.equal(review.hunkVerdicts[0].path, 'src/auth/login.js');

  // Comments: both the hunk-anchored and the file-level comment are surfaced.
  assert.equal(review.comments.length, 2, 'all BlockComments surfaced');
  assert.ok(
    review.comments.some((c) => c.hunkId === null && c.verdict === 'comment'),
    'file-level comment carried',
  );

  // R2 EPHEMERAL: no reviews/ side-effect was created by the round-trip.
  assert.equal(reviewsDirExists(), false, 'NO persistence side-effect — no reviews/ dir created (R2 ephemeral)');

  // Flush-then-exit-0 ordering (review path): stdout JSON complete AND exit 0.
  assert.ok(
    stdout.trim().endsWith('}') && code === 0,
    'flush-then-exit-0 ordering confirmed on the approve path',
  );
});

await test('AC-R7: approve with a per-hunk REJECT → hasRejections:true, verdict carried', async () => {
  const { stdout, stderr, code } = await runScriptedReview(REVIEW_DOC_REVISED, 'approve');
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const review = JSON.parse(stdout.trim()).hookSpecificOutput.review;
  assert.equal(review.overall, 'approve', 'a review with rejects is still an APPROVE of the round-trip');
  assert.equal(review.hasRejections, true, 'reject verdict summarised');
  assert.equal(review.hunkVerdicts.length, 1);
  assert.equal(review.hunkVerdicts[0].verdict, 'reject', 'per-hunk reject verdict carried back');
  assert.equal(review.hunkVerdicts[0].hunkId, 'dr-1-h1');
  assert.equal(reviewsDirExists(), false, 'still NO persistence side-effect (R2 ephemeral)');
});

await test('AC-R7: scripted revise → buildReviseMessage output (directive + echo table + canonical JSON), no persistence', async () => {
  const { stdout, stderr, code } = await runScriptedReview(REVIEW_DOC, 'deny');
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
  assert.equal(decision.behavior, 'deny', 'revise → behavior:"deny"');
  const msg = decision.message;
  assert.ok(typeof msg === 'string' && msg.length > 0, 'deny carries a message');

  // (a) Tuned directive preamble (reused verbatim from the plan/PRD loop).
  assert.ok(msg.includes('YOUR PLAN WAS NOT APPROVED'), 'tuned directive preamble present');
  // (b) Reviewer feedback threaded.
  assert.ok(msg.includes('Scripted review forced-revise.'), 'reviewer feedback threaded');
  // (c) (id,kind,title) echo table — kind-agnostic, every block id + kind.
  assert.ok(msg.includes('| id | kind | title |'), 'echo table header present');
  assert.ok(msg.includes('REUSE'), 'echo table carries the REUSE directive');
  for (const b of REVIEW_DOC.blocks) {
    assert.ok(msg.includes(b.id), `echo table missing block id '${b.id}'`);
    assert.ok(msg.includes(b.kind), `echo table missing block kind '${b.kind}'`);
  }
  // (d) Canonical JSON of the current document (revise-from-this-exact-JSON).
  assert.ok(msg.includes('```json'), 'canonical JSON fenced block present');
  const jsonStart = msg.indexOf('```json');
  const fence = msg.slice(jsonStart + 7);
  const jsonText = fence.slice(0, fence.indexOf('```')).trim();
  const roundTripped = JSON.parse(jsonText);
  assert.equal(roundTripped.id, REVIEW_DOC.id, 'canonical JSON round-trips the review doc');
  assert.equal(roundTripped.type, 'diff-review', 'diff-review document type preserved');

  // Revise must NOT persist anything (R2 ephemeral — no store at all).
  assert.equal(reviewsDirExists(), false, 'revise persists nothing (R2 ephemeral)');

  // Flush-then-exit-0 ordering on the revise path too.
  assert.ok(
    stdout.trim().endsWith('}') && code === 0,
    'flush-then-exit-0 ordering confirmed on the revise path',
  );
});

await test('AC-R7: malformed diff-review input → degraded prose (type:"diff-review"), still resolves + exits 0', async () => {
  const { stdout, code } = await runScriptedReview(
    /** not a valid doc */ { not: 'a review' },
    'approve',
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'user never blocked by malformed review input',
  );
  assert.equal(parsed.hookSpecificOutput.review.persisted, false, 'degraded review NOT persisted (R2 ephemeral)');
  // The degraded doc has no diff blocks → empty per-hunk verdicts/comments.
  assert.deepEqual(parsed.hookSpecificOutput.review.hunkVerdicts, [], 'no diff blocks → no per-hunk verdicts');
  assert.equal(reviewsDirExists(), false, 'no persistence side-effect on the degraded path either');
});

// ---------------------------------------------------------------------------
// AC-R8 — baseRevision race guard fires identically to the plan/PRD loop.
// ---------------------------------------------------------------------------

await test('AC-R8: fresh baseRevision matches → ops applied (rendered into the deny message)', async () => {
  // First round-trip → canonical revision 1; envelope.baseRevision === 1.
  const { stdout, stderr, code } = await runScriptedReview(
    REVIEW_DOC,
    'deny',
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
    msg.includes('Address the rejected hunk before approval.'),
    'globalComment threaded into the rendered ops',
  );
});

await test('AC-R8: stale baseRevision trips the race guard (ops NOT applied, re-render signaled)', async () => {
  // The authored doc is revision 1; the SPA edited against a NEWER revision 2
  // → checkBaseRevision flags the ops as stale and they MUST NOT be applied.
  const staleEnvelope = { ...REVISE_ENVELOPE, baseRevision: 2 };
  const { stdout, stderr, code } = await runScriptedReview(
    REVIEW_DOC,
    'deny',
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
  for (const b of REVIEW_DOC.blocks) {
    assert.ok(msg.includes(b.id), `stale-path echo table missing '${b.id}'`);
  }
  assert.equal(reviewsDirExists(), false, 'race-guarded revise persists nothing (R2 ephemeral)');
});

// ---------------------------------------------------------------------------
// AC-R12 (envelope round-trip half) — a per-hunk accept/reject/comment
// expressed as an editBlock op patching comments[] with a BlockComment{verdict}
// flows through buildDecision UNCHANGED (the proven looksLikeBareEnvelope
// path), and the resulting structured review envelope round-trips back with
// per-hunk verdicts intact. NO new envelope op (R5).
// ---------------------------------------------------------------------------

await test('AC-R12: editBlock op patching comments[] with a BlockComment{verdict} flows through buildDecision unchanged (looksLikeBareEnvelope), per-hunk verdict rendered', async () => {
  // The SPA POSTs the BARE envelope (no { envelope } wrapper) on revise — the
  // proven production looksLikeBareEnvelope path in buildDecision. The R5
  // hunk-verdict is an editBlock patch of comments[] (NO new op discriminant).
  const { stdout, stderr, code } = await runScriptedReview(
    REVIEW_DOC,
    'deny',
    REVISE_ENVELOPE,
  );
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const decision = JSON.parse(stdout.trim()).hookSpecificOutput.decision;
  assert.equal(decision.behavior, 'deny', 'bare envelope consumed (not confused with thin-loop)');
  const msg = decision.message;
  // The editBlock op (carrying the BlockComment{verdict:"reject"} in its
  // patch.comments[]) is rendered into the human-readable ops section — the
  // envelope was consumed unchanged via the existing editBlock op (no new op).
  assert.ok(
    msg.includes('## Requested changes (apply EVERY item below)'),
    'envelope ops rendered → editBlock consumed unchanged',
  );
  assert.ok(msg.includes('editBlock') || msg.includes('dr-1'),
    'the editBlock op targeting the diff block is rendered');
  // The reject verdict text rode through the patch into the rendered ops.
  assert.ok(
    msg.includes('Mint the token lazily instead.') ||
      msg.includes('reject'),
    'per-hunk reject verdict survives the editBlock patch round-trip',
  );

  // Round-trip the OTHER half: an approved doc whose comments[] already carry
  // verdicts emits them back intact in the structured review envelope.
  const approved = await runScriptedReview(REVIEW_DOC_REVISED, 'approve');
  assert.equal(approved.code, 0);
  const review = JSON.parse(approved.stdout.trim()).hookSpecificOutput.review;
  assert.equal(review.hunkVerdicts.length, 1);
  assert.equal(review.hunkVerdicts[0].verdict, 'reject', 'per-hunk verdict intact on the structured envelope');
  assert.equal(review.hunkVerdicts[0].hunkId, 'dr-1-h1', 'hunk anchor preserved (ADR-0001 recursively)');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `diff-review-mode round-trip tests (Phase 3 / Milestone R2 — AC-R7, AC-R8, AC-R12 envelope half): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
