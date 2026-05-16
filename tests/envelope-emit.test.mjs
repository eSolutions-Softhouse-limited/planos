/**
 * planos — SPA FeedbackEnvelope emission tests (plain Node, zero deps).
 *
 * Covers US-017 / Step 3.2 (AC-9): the browser SPA builds a structurally
 * valid `FeedbackEnvelope` from accumulated editor state where every `ops[]`
 * entry matches the docs/design.md §4 `Edit` union, and that envelope
 * round-trips through serialization into the canonical SERVER-SIDE validator
 * (`src/schema/envelope.mjs` — US-015) without loss.
 *
 * The pure builder lives in `src/editor/envelope.impl.mjs` (zero toolchain) so
 * this harness imports it directly; `src/editor/envelope.ts` re-exports it for
 * the typed React call sites.
 *
 * Run: node tests/envelope-emit.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';

import { buildEnvelope } from '../src/editor/envelope.impl.mjs';
import {
  validateEnvelope,
  EDIT_OPS,
  ENVELOPE_DECISIONS,
} from '../src/schema/envelope.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err && err.message}`);
  }
}

// ---------------------------------------------------------------------------
// A representative document + a representative editor state.
//
//   - a task edit            (title + status patch on `task-build`)
//   - an openQuestion answer (`oq-cut`)
//   - two per-block comments  (`prose-intro`, `risk-perf`)
//   - a global comment
// ---------------------------------------------------------------------------

const DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'plan-emit-fixture-001',
  title: 'Emission fixture',
  meta: { branch: 'main', status: 'in-review', createdAt: 'x', revision: 7 },
  blocks: [
    { id: 'sec-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'prose-intro', kind: 'prose', md: 'intro' },
    {
      id: 'task-build',
      kind: 'task',
      title: 'Build it',
      status: 'todo',
      deps: [],
      acceptance: ['compiles'],
    },
    {
      id: 'risk-perf',
      kind: 'risk',
      description: 'slow',
      likelihood: 'M',
      impact: 'H',
      mitigation: 'cache',
    },
    { id: 'oq-cut', kind: 'openQuestion', question: 'Allow cut status?' },
  ],
};

const STATE = {
  edits: {
    'task-build': { title: 'Build it well', status: 'doing' },
  },
  answers: {
    'oq-cut': 'Yes, reviewers may set cut.',
  },
  comments: {
    'prose-intro': 'Tighten this intro.',
    'risk-perf': 'Quantify the latency budget.',
  },
  globalComment: 'Overall: ship after the perf note is resolved.',
};

// ---------------------------------------------------------------------------

test('decision/documentId/baseRevision are taken from the doc', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  assert.equal(env.decision, 'revise');
  assert.ok(ENVELOPE_DECISIONS.includes(env.decision));
  assert.equal(env.documentId, 'plan-emit-fixture-001');
  assert.equal(env.baseRevision, 7);
  assert.equal(typeof env.baseRevision, 'number');
  assert.ok(Number.isInteger(env.baseRevision));
});

test('approve decision routes through with same op mapping', () => {
  const env = buildEnvelope('approve', DOC, STATE);
  assert.equal(env.decision, 'approve');
  assert.ok(ENVELOPE_DECISIONS.includes(env.decision));
});

test('representative state -> PASSES src/schema/envelope.mjs validateEnvelope', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const res = validateEnvelope(env);
  assert.ok(
    res.ok,
    `expected valid envelope, got errors:\n${
      res.ok ? '' : res.errors.join('\n')
    }`
  );
});

test('every op matches the design.md §4 Edit union discriminant', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  assert.ok(Array.isArray(env.ops));
  for (const op of env.ops) {
    assert.ok(
      EDIT_OPS.includes(op.op),
      `op ${JSON.stringify(op.op)} not in Edit union`
    );
  }
});

test('task edit -> editBlock with the exact patch', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const edit = env.ops.find(
    (o) => o.op === 'editBlock' && o.blockId === 'task-build'
  );
  assert.ok(edit, 'expected an editBlock op for task-build');
  assert.deepEqual(edit.patch, { title: 'Build it well', status: 'doing' });
});

test('openQuestion answer -> answer op (not editBlock)', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const ans = env.ops.find((o) => o.blockId === 'oq-cut');
  assert.ok(ans, 'expected an op for oq-cut');
  assert.equal(ans.op, 'answer');
  assert.equal(ans.answer, 'Yes, reviewers may set cut.');
  assert.ok(
    !env.ops.some((o) => o.op === 'editBlock' && o.blockId === 'oq-cut'),
    'openQuestion answer must not become an editBlock'
  );
});

test('per-block comments -> comment ops with text', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const c1 = env.ops.find(
    (o) => o.op === 'comment' && o.blockId === 'prose-intro'
  );
  const c2 = env.ops.find(
    (o) => o.op === 'comment' && o.blockId === 'risk-perf'
  );
  assert.ok(c1 && c2, 'expected both comment ops');
  assert.equal(c1.text, 'Tighten this intro.');
  assert.equal(c2.text, 'Quantify the latency budget.');
});

test('global comment flows through verbatim', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  assert.equal(
    env.globalComment,
    'Overall: ship after the perf note is resolved.'
  );
});

test('ops are emitted in document block order', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const ids = env.ops.map((o) => o.blockId);
  // doc order: prose-intro, task-build, risk-perf, oq-cut
  assert.deepEqual(ids, [
    'prose-intro',
    'task-build',
    'risk-perf',
    'oq-cut',
  ]);
});

test('lossless JSON round-trip: serialize -> parse -> still valid + identical', () => {
  const env = buildEnvelope('revise', DOC, STATE);
  const wire = JSON.stringify(env);
  const back = JSON.parse(wire);
  // Server-side validator (US-015) accepts the round-tripped form.
  const res = validateEnvelope(back);
  assert.ok(
    res.ok,
    `round-tripped envelope failed validation:\n${
      res.ok ? '' : res.errors.join('\n')
    }`
  );
  // Deep equality proves zero loss across serialization.
  assert.deepEqual(back, env);
  // And re-serializing is byte-identical (stable shape, no drift).
  assert.equal(JSON.stringify(back), wire);
});

test('empty state -> valid envelope with zero ops, no globalComment', () => {
  const env = buildEnvelope('approve', DOC, {});
  const res = validateEnvelope(env);
  assert.ok(res.ok, res.ok ? '' : res.errors.join('\n'));
  assert.deepEqual(env.ops, []);
  assert.ok(!('globalComment' in env));
});

// ---------------------------------------------------------------------------
// AC-R12 (SPA-emit half) — a per-hunk accept/reject/comment serializes into
// the EXISTING `editBlock` op as a `patch.comments[]` of
// `BlockComment{commentId, hunkId, text, verdict}` (R5: NO new op
// discriminant; `src/schema/envelope.mjs` unchanged). It round-trips through
// `validateEnvelope` (the proven looksLikeBareEnvelope path) intact.
// ---------------------------------------------------------------------------

const DIFF_DOC = {
  schemaVersion: 1,
  type: 'diff-review',
  id: 'diff-emit-fixture-001',
  title: 'Diff emission fixture',
  meta: { branch: 'main', status: 'in-review', createdAt: 'x', revision: 3 },
  blocks: [
    { id: 's0', kind: 'section', title: 'Review', level: 1 },
    {
      id: 'dr-1',
      kind: 'diff',
      path: 'src/a.ts',
      status: 'modified',
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          hunkId: 'dr-1-h1',
          lines: [{ op: ' ', text: 'a' }],
        },
        {
          header: '@@ -10,1 +10,2 @@',
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          hunkId: 'dr-1-h2',
          lines: [{ op: '+', text: 'b' }],
        },
      ],
      comments: [],
    },
  ],
};

test('AC-R12 SPA-emit: per-hunk verdict → editBlock patch of comments[] (NO new op)', () => {
  const env = buildEnvelope('revise', DIFF_DOC, {
    reviewVerdicts: {
      'dr-1': {
        'dr-1-h1': { verdict: 'reject', text: 'Mint the token lazily.' },
        'dr-1-h2': { verdict: 'accept', text: '' },
      },
    },
  });
  // No new op discriminant — only the existing editBlock op.
  for (const op of env.ops) {
    assert.ok(EDIT_OPS.includes(op.op), `op ${op.op} not in Edit union`);
  }
  const edit = env.ops.find(
    (o) => o.op === 'editBlock' && o.blockId === 'dr-1'
  );
  assert.ok(edit, 'expected an editBlock op for the diff block dr-1');
  // BlockComment shape exactly as src/hook/review.mjs deriveReviewResult reads
  // it: { commentId, hunkId, text, verdict }, deterministic commentId in doc
  // hunk order.
  assert.deepEqual(edit.patch.comments, [
    {
      commentId: 'dr-1-c1',
      hunkId: 'dr-1-h1',
      text: 'Mint the token lazily.',
      verdict: 'reject',
    },
    {
      commentId: 'dr-1-c2',
      hunkId: 'dr-1-h2',
      text: '',
      verdict: 'accept',
    },
  ]);
  // Round-trips through the canonical server-side validator unchanged.
  const res = validateEnvelope(env);
  assert.ok(res.ok, res.ok ? '' : res.errors.join('\n'));
  // Stable / byte-identical re-emission (deterministic commentId minting).
  const again = buildEnvelope('revise', DIFF_DOC, {
    reviewVerdicts: {
      'dr-1': {
        'dr-1-h2': { verdict: 'accept', text: '' },
        'dr-1-h1': { verdict: 'reject', text: 'Mint the token lazily.' },
      },
    },
  });
  assert.equal(JSON.stringify(again), JSON.stringify(env));
});

test('AC-R12 SPA-emit: neutral comment verdict with no text emits nothing', () => {
  const env = buildEnvelope('revise', DIFF_DOC, {
    reviewVerdicts: { 'dr-1': { 'dr-1-h1': { verdict: 'comment', text: '' } } },
  });
  assert.deepEqual(env.ops, []);
  const res = validateEnvelope(env);
  assert.ok(res.ok, res.ok ? '' : res.errors.join('\n'));
});

test('whitespace-only / empty values are not emitted as ops', () => {
  const env = buildEnvelope('revise', DOC, {
    edits: { 'task-build': {} },
    comments: { 'prose-intro': '' },
    answers: { 'oq-cut': '' },
    globalComment: '   ',
  });
  const res = validateEnvelope(env);
  assert.ok(res.ok, res.ok ? '' : res.errors.join('\n'));
  assert.deepEqual(env.ops, []);
  assert.ok(!('globalComment' in env));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `FeedbackEnvelope emission tests (US-017 / Step 3.2): ${passed} passed, ${failed} failed`
);
console.log('');

if (failed > 0) process.exit(1);
