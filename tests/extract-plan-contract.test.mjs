/**
 * planos — extractPlan stdin-contract regression (node:test, zero deps).
 *
 * The /planos-prd, /planos-plan and /planos-review skills document piping the
 * BARE authored document JSON to `bin/planos <cmd>` (NOT the ExitPlanMode
 * `{tool_input:{plan}}` hook envelope). Before the defensive fallback,
 * extractPlan returned '' for a bare doc → degradeToProse silently discarded
 * the authored content (the "plan came back empty / failed" symptom). This
 * guards: bare Document ⇒ used as-is; the hook envelope ⇒ still works;
 * non-document JSON ⇒ still '' (degrade path intact); precedence preserved.
 *
 * Run: node --test tests/extract-plan-contract.test.mjs   (offline)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlan } from '../src/hook/roundtrip.mjs';

const DOC = {
  schemaVersion: 1,
  type: 'prd',
  id: 'extract-contract',
  title: 'Authored Title Survives',
  meta: { status: 'draft', createdAt: '2026-05-17T00:00:00Z', revision: 1 },
  blocks: [{ id: 'o', kind: 'objective', text: 'g', successCriteria: ['x'] }],
};

test('BARE authored Document JSON (the skill-documented pipe) is used as the plan', () => {
  const raw = JSON.stringify(DOC);
  const plan = extractPlan(raw);
  assert.notEqual(plan, '', 'bare authored doc must NOT degrade to empty');
  assert.ok(
    plan.includes('Authored Title Survives'),
    'the authored content must be preserved verbatim',
  );
  assert.equal(plan, raw, 'bare doc: extractPlan returns the raw text as-is');
});

test('plan-type bare Document also passes (type is not hardcoded to prd)', () => {
  const planDoc = { ...DOC, type: 'plan', id: 'p1' };
  assert.equal(extractPlan(JSON.stringify(planDoc)), JSON.stringify(planDoc));
});

test('ExitPlanMode hook envelope {tool_input:{plan}} still works (no regression)', () => {
  const raw = JSON.stringify({ tool_input: { plan: JSON.stringify(DOC) } });
  const plan = extractPlan(raw);
  assert.ok(
    plan.includes('Authored Title Survives'),
    'wrapped hook envelope must still extract the inner plan',
  );
});

test('tool_input.plan still takes precedence over the bare-doc fallback', () => {
  // Pathological: a doc-shaped object that ALSO carries tool_input.plan.
  const raw = JSON.stringify({ ...DOC, tool_input: { plan: 'WINS' } });
  assert.equal(
    extractPlan(raw),
    'WINS',
    'an explicit tool_input.plan string must win over the doc-shape fallback',
  );
});

test('non-document JSON with no tool_input still returns "" (degrade path intact)', () => {
  assert.equal(extractPlan(JSON.stringify({ foo: 1, bar: 2 })), '');
  assert.equal(extractPlan(JSON.stringify({ schemaVersion: 1 })), '', 'partial shape is NOT a document');
  assert.equal(extractPlan(JSON.stringify({ tool_input: {} })), '', 'envelope without plan still ""');
});

test('non-JSON stdin is still returned verbatim (existing behavior)', () => {
  assert.equal(extractPlan('just some plain text plan'), 'just some plain text plan');
  assert.equal(extractPlan(''), '');
  assert.equal(extractPlan('   '), '');
});
