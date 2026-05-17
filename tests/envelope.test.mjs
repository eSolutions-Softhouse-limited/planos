/**
 * planos — FeedbackEnvelope contract tests (plain Node, zero dependencies).
 *
 * Covers US-015 / Step 2f.4 acceptance:
 *  - AC-9: validateEnvelope accepts a structurally valid envelope per the
 *          design.md §4 `Edit` union, rejects each malformed variant with a
 *          field-level error substring; the envelope round-trips through
 *          serialization into the deny message + canonical JSON without loss.
 *  - AC-5: buildDecision deny.message = tuned directive preamble + each op
 *          rendered human-readably + (id,kind,title) echo table + canonical
 *          JSON of the current document.
 *  - AC-10: baseRevision race guard — match → ops applied path; mismatch →
 *           stale ops rejected + re-render signaled (NOT mutated).
 *
 * Run: node tests/envelope.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';

import {
  validateEnvelope,
  checkBaseRevision,
  renderOpsHuman,
  ENVELOPE_DECISIONS,
  EDIT_OPS,
} from '../src/schema/envelope.mjs';
import { buildDecision, buildReviseMessage } from '../src/hook/prd-runtime.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err && err.message ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Canonical current document, revision 3. */
const DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'envelope-demo-2026-05-16',
  title: 'Envelope Demo',
  meta: { status: 'in-review', createdAt: '2026-05-16T12:00:00.000Z', revision: 3 },
  blocks: [
    { id: 's1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p1', kind: 'prose', md: 'Original narrative.' },
    {
      id: 't1',
      kind: 'task',
      title: 'Build the loop',
      status: 'todo',
      deps: [],
      acceptance: ['round-trip works'],
    },
    { id: 'q1', kind: 'openQuestion', question: 'Which scheme?' },
  ],
};

/** A structurally valid envelope exercising every Edit-union variant. */
const VALID_ENVELOPE = {
  decision: 'revise',
  documentId: 'envelope-demo-2026-05-16',
  baseRevision: 3,
  ops: [
    { op: 'editBlock', blockId: 't1', patch: { title: 'Build the full loop' } },
    { op: 'deleteBlock', blockId: 'p1' },
    { op: 'moveBlock', blockId: 't1', afterBlockId: 's1' },
    { op: 'moveBlock', blockId: 'q1', afterBlockId: null },
    { op: 'comment', blockId: 's1', text: 'Tighten this heading.' },
    { op: 'comment', blockId: 'p1', text: 'partial', anchor: { start: 0, end: 7 } },
    { op: 'answer', blockId: 'q1', answer: 'Use semantic-slug.' },
    {
      op: 'addBlock',
      afterBlockId: 't1',
      block: { id: 'r1', kind: 'risk', description: 'Scope creep', likelihood: 'M', impact: 'H', mitigation: 'Freeze v1.' },
    },
    {
      op: 'addBlock',
      afterBlockId: null,
      block: { id: 's0', kind: 'section', title: 'Preamble', level: 1 },
    },
  ],
  globalComment: 'Overall: split the build task and answer the open question.',
};

// ---------------------------------------------------------------------------
// AC-9 — envelope validation (valid + per-variant invalid w/ field errors)
// ---------------------------------------------------------------------------

test('AC-9: a structurally valid envelope (all Edit variants) validates ok', () => {
  const r = validateEnvelope(VALID_ENVELOPE);
  assert.equal(r.ok, true, r.ok ? '' : `unexpected errors: ${(r.errors || []).join('; ')}`);
  assert.equal(r.envelope.decision, 'revise');
  assert.equal(r.envelope.ops.length, 9);
});

test('AC-9: constants expose the exact decisions + Edit ops', () => {
  assert.deepEqual([...ENVELOPE_DECISIONS], ['approve', 'revise']);
  assert.deepEqual(
    [...EDIT_OPS],
    ['editBlock', 'deleteBlock', 'moveBlock', 'comment', 'answer', 'addBlock'],
  );
});

test('AC-9: non-object envelope → field error', () => {
  const r = validateEnvelope('nope');
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('FeedbackEnvelope must be a JSON object'));
});

test('AC-9: bad decision → field error naming the allowed set', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, decision: 'maybe' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('decision') && e.includes('approve|revise')));
});

test('AC-9: missing documentId → field error', () => {
  const e = { ...VALID_ENVELOPE };
  delete e.documentId;
  const r = validateEnvelope(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('documentId') && m.includes('non-empty string')));
});

test('AC-9: non-integer baseRevision → field error (the race-guard key)', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, baseRevision: '3' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('baseRevision') && m.includes('integer')));
});

test('AC-9: ops not an array → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: {} });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('ops') && m.includes('array of Edit')));
});

test('AC-9: globalComment non-string when present → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, globalComment: 42 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('globalComment')));
});

// Per Edit-union-variant invalid cases.

test('AC-9: editBlock missing patch → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'editBlock', blockId: 't1' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('editBlock') && m.includes('patch')));
});

test('AC-9: editBlock missing blockId → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'editBlock', patch: {} }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('ops[0].blockId')));
});

test('AC-9: deleteBlock missing blockId → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'deleteBlock' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('ops[0].blockId')));
});

test('AC-9: moveBlock missing afterBlockId key → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'moveBlock', blockId: 't1' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('moveBlock') && m.includes('afterBlockId')));
});

test('AC-9: moveBlock afterBlockId null IS valid (move to top)', () => {
  const r = validateEnvelope({
    ...VALID_ENVELOPE,
    ops: [{ op: 'moveBlock', blockId: 't1', afterBlockId: null }],
  });
  assert.equal(r.ok, true, r.ok ? '' : (r.errors || []).join('; '));
});

test('AC-9: moveBlock afterBlockId non-string non-null → field error', () => {
  const r = validateEnvelope({
    ...VALID_ENVELOPE,
    ops: [{ op: 'moveBlock', blockId: 't1', afterBlockId: 7 }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('afterBlockId')));
});

test('AC-9: comment missing text → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'comment', blockId: 's1' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('comment') && m.includes('text')));
});

test('AC-9: comment anchor with non-integer offsets → field error', () => {
  const r = validateEnvelope({
    ...VALID_ENVELOPE,
    ops: [{ op: 'comment', blockId: 's1', text: 'x', anchor: { start: 'a', end: 2 } }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('anchor.start')));
});

test('AC-9: answer missing answer → field error', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'answer', blockId: 'q1' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('answer') && m.includes("requires 'answer'")));
});

test('AC-9: addBlock missing block → field error', () => {
  const r = validateEnvelope({
    ...VALID_ENVELOPE,
    ops: [{ op: 'addBlock', afterBlockId: 't1' }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('addBlock') && m.includes("requires 'block'")));
});

test('AC-9: addBlock block missing id/kind → field errors', () => {
  const r = validateEnvelope({
    ...VALID_ENVELOPE,
    ops: [{ op: 'addBlock', afterBlockId: null, block: {} }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => m.includes('block.id')));
  assert.ok(r.errors.some((m) => m.includes('block.kind')));
});

test('AC-9: unknown op discriminant → field error naming the union', () => {
  const r = validateEnvelope({ ...VALID_ENVELOPE, ops: [{ op: 'frobnicate', blockId: 'x' }] });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some(
      (m) =>
        m.includes('is not a valid Edit op') &&
        m.includes('editBlock|deleteBlock|moveBlock|comment|answer|addBlock'),
    ),
  );
});

// ---------------------------------------------------------------------------
// AC-10 — baseRevision race guard (pure)
// ---------------------------------------------------------------------------

test('AC-10: matching revisions → not stale, action "apply"', () => {
  const g = checkBaseRevision(3, 3);
  assert.equal(g.stale, false);
  assert.equal(g.action, 'apply');
  assert.equal(g.canonicalRevision, 3);
  assert.equal(g.baseRevision, 3);
});

test('AC-10: differing revisions → stale, action "re-render"', () => {
  const g = checkBaseRevision(4, 3);
  assert.equal(g.stale, true);
  assert.equal(g.action, 're-render');
});

// ---------------------------------------------------------------------------
// AC-5 — deny.message: directive + rendered ops + echo table + canonical JSON
// ---------------------------------------------------------------------------

test('AC-5: renderOpsHuman spells out every op variant human-readably', () => {
  const txt = renderOpsHuman(VALID_ENVELOPE);
  assert.ok(txt.includes('EDIT block `t1`'), 'editBlock rendered');
  assert.ok(txt.includes('DELETE block `p1`'), 'deleteBlock rendered');
  assert.ok(txt.includes('MOVE block `t1` to immediately AFTER block `s1`'), 'moveBlock(after) rendered');
  assert.ok(txt.includes('MOVE block `q1` to the TOP'), 'moveBlock(null) rendered');
  assert.ok(txt.includes('COMMENT on block `s1`'), 'comment rendered');
  assert.ok(txt.includes('chars 0-7'), 'comment anchor rendered');
  assert.ok(txt.includes('ANSWER openQuestion block `q1`'), 'answer rendered');
  assert.ok(txt.includes('ADD a new `risk` block (id `r1`) AFTER block `t1`'), 'addBlock(after) rendered');
  assert.ok(txt.includes('ADD a new `section` block (id `s0`) at the TOP'), 'addBlock(top) rendered');
  assert.ok(txt.includes('### Global comment'), 'global comment section present');
  assert.ok(txt.includes('split the build task'), 'global comment text present');
});

test('AC-5: buildDecision (envelope, baseRevision match) → deny w/ all 4 parts', () => {
  const d = buildDecision(DOC, { behavior: 'deny', envelope: VALID_ENVELOPE });
  assert.equal(d.behavior, 'deny');
  assert.equal(d.guard.stale, false, 'guard reports applied path');
  const m = d.message;
  // 1. tuned directive preamble
  assert.ok(m.includes('YOUR PRD WAS NOT APPROVED'), 'tuned directive preamble');
  // 2. each op rendered human-readably
  assert.ok(m.includes('EDIT block `t1`'));
  assert.ok(m.includes('DELETE block `p1`'));
  assert.ok(m.includes('ANSWER openQuestion block `q1`'));
  // 3. (id,kind,title) echo table for every block
  assert.ok(m.includes('| id | kind | title |'), 'echo table header');
  for (const b of DOC.blocks) {
    assert.ok(m.includes(b.id), `echo table missing id '${b.id}'`);
    assert.ok(m.includes(b.kind), `echo table missing kind '${b.kind}'`);
  }
  // 4. canonical JSON of the current document
  assert.ok(m.includes('```json'), 'canonical JSON fence');
});

test('AC-5/AC-10: stale envelope → STALE directive, NO rendered ops, re-render signaled', () => {
  const staleEnv = { ...VALID_ENVELOPE, baseRevision: 1 }; // doc is rev 3
  const d = buildDecision(DOC, { behavior: 'deny', envelope: staleEnv });
  assert.equal(d.behavior, 'deny');
  assert.equal(d.guard.stale, true, 'guard reports stale');
  assert.equal(d.guard.action, 're-render');
  const m = d.message;
  assert.ok(m.includes('STALE'), 'stale directive present');
  assert.ok(m.includes('Re-emit the FULL v2 block document below UNCHANGED'), 're-render instruction');
  // Stale ops MUST NOT be rendered (would mislead the agent into mutating).
  assert.ok(!m.includes('EDIT block `t1`'), 'stale ops NOT rendered');
  assert.ok(!m.includes('DELETE block `p1`'), 'stale ops NOT rendered');
  // Echo table + canonical JSON still present so the agent re-renders cleanly.
  assert.ok(m.includes('| id | kind | title |'), 'echo table still present');
  assert.ok(m.includes('```json'), 'canonical JSON still present');
});

test('AC-5: malformed envelope → never blocks; degrades w/ field errors surfaced', () => {
  const bad = { behavior: 'deny', envelope: { decision: 'revise', ops: 'x' } };
  const d = buildDecision(DOC, bad);
  assert.equal(d.behavior, 'deny');
  assert.ok(Array.isArray(d.envelopeErrors) && d.envelopeErrors.length > 0, 'errors surfaced');
  assert.ok(d.message.includes('malformed'), 'message explains the degrade');
  assert.ok(d.message.includes('| id | kind | title |'), 'echo table still present');
  assert.ok(d.message.includes('```json'), 'canonical JSON still present');
});

test('AC-5: approve / no-deny resolved → behavior allow (envelope ignored)', () => {
  assert.deepEqual(buildDecision(DOC, { behavior: 'allow' }), { behavior: 'allow' });
  assert.deepEqual(buildDecision(DOC, undefined), { behavior: 'allow' });
});

test('backward-compat: buildDecision with no envelope → US-008 thin-loop path', () => {
  const d = buildDecision(DOC, { behavior: 'deny', feedback: 'Split the task.' });
  assert.equal(d.behavior, 'deny');
  assert.equal(d.guard, undefined, 'no guard when no envelope');
  assert.ok(d.message.includes('Split the task.'), 'free-text feedback threaded');
  assert.ok(d.message.includes('| id | kind | title |'), 'echo table present');
  assert.ok(!d.message.includes('## Requested changes'), 'no ops section without an envelope');
});

test('backward-compat: buildReviseMessage(doc, feedback) 2-arg shape unchanged', () => {
  const m = buildReviseMessage(DOC, 'feedback only');
  assert.ok(m.includes('YOUR PRD WAS NOT APPROVED'));
  assert.ok(m.includes('feedback only'));
  assert.ok(m.includes('| id | kind | title |'));
  assert.ok(!m.includes('## Requested changes'), 'no ops rendering without envelope arg');
});

// ---------------------------------------------------------------------------
// AC-9 — lossless round-trip through the deny message + canonical JSON.
//
// The envelope's ops are recoverable from the rendered directive section AND
// the exact current document is recoverable verbatim from the fenced JSON
// block. We assert the canonical document round-trips byte-for-byte and that
// every op's identifying tokens survive into the human rendering.
// ---------------------------------------------------------------------------

test('AC-9: canonical document round-trips losslessly via the deny message', () => {
  const d = buildDecision(DOC, { behavior: 'deny', envelope: VALID_ENVELOPE });
  const m = d.message;
  // Extract the fenced ```json ... ``` block and parse it back.
  const start = m.indexOf('```json');
  assert.ok(start >= 0, 'json fence found');
  const after = m.indexOf('\n', start) + 1;
  const end = m.indexOf('```', after);
  assert.ok(end > after, 'json fence closed');
  const recovered = JSON.parse(m.slice(after, end).trim());
  assert.deepEqual(recovered, DOC, 'canonical document recovered without loss');
});

test('AC-9: every envelope op is recoverable from the rendered ops section', () => {
  const d = buildDecision(DOC, { behavior: 'deny', envelope: VALID_ENVELOPE });
  const m = d.message;
  // Each op contributes an identifying, human-readable token; assert all survive.
  const required = [
    'EDIT block `t1`',
    'DELETE block `p1`',
    'MOVE block `t1` to immediately AFTER block `s1`',
    'MOVE block `q1` to the TOP',
    'COMMENT on block `s1`',
    'COMMENT on block `p1` (chars 0-7)',
    'ANSWER openQuestion block `q1`',
    'ADD a new `risk` block (id `r1`) AFTER block `t1`',
    'ADD a new `section` block (id `s0`) at the TOP',
    'split the build task and answer the open question',
  ];
  for (const tok of required) {
    assert.ok(m.includes(tok), `op token not recoverable from message: ${tok}`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`FeedbackEnvelope tests (US-015 / Step 2f.4): ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
