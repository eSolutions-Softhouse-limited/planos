// tests/live-driver.test.mjs
//
// US-010 / Step 1.2 / AC-18 — OFFLINE proof that the live thin-loop driver is
// correctly wired. It exercises the REAL `bin/planos enter` injection and the
// REAL src/hook/exit.mjs forced-revise round-trip (child processes, no
// network, no model — exactly the seam tests/exit-thinloop.test.mjs uses),
// with the `claude` agent replaced by a deterministic injected fake. This
// proves the orchestration + the frozen-at-author-time ID-preservation
// denominator WITHOUT spending `claude`. Real billed live runs go through
// tests/harness/run-live.mjs (out of band).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEnterContext,
  exitForcedRevise,
  runLiveFixture,
} from './harness/live-driver.mjs';

const FIXTURE = {
  name: 'wiring-fixture',
  initialPrompt:
    'Add CSV export to the reports page: a background job, a download ' +
    'endpoint, and an exports history list.',
};

// A deterministic, schema-valid v1 author document (the "agent" mints ids).
const AUTHOR_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'plan-csv-export',
  title: 'CSV export for reports',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    {
      id: 'obj-export',
      kind: 'objective',
      text: 'Let users export report data as CSV',
      successCriteria: ['async job', 'download endpoint', 'history list'],
    },
    {
      id: 'task-job',
      kind: 'task',
      title: 'Background CSV generation job',
      status: 'todo',
      deps: [],
      acceptance: ['streams rows', 'writes to object storage'],
    },
    {
      id: 'task-download',
      kind: 'task',
      title: 'Signed download endpoint',
      status: 'todo',
      deps: ['task-job'],
      acceptance: ['expiring URL'],
    },
    {
      id: 'task-history',
      kind: 'task',
      title: 'Exports history list',
      status: 'todo',
      deps: ['task-job'],
      acceptance: ['shows status + link'],
    },
    {
      id: 'risk-large',
      kind: 'risk',
      description: 'Very large exports could time out',
      likelihood: 'M',
      impact: 'M',
      mitigation: 'stream + paginate',
    },
  ],
};

test('getEnterContext returns the real injected schema context', async () => {
  const ctx = await getEnterContext('semantic-slug');
  assert.ok(ctx.includes('v1 Block Schema'), 'schema summary present');
  assert.ok(
    ctx.includes('ID Preservation') || ctx.includes('REUSE'),
    'ID-preservation rules injected',
  );
  const ctxOpaque = await getEnterContext('opaque');
  assert.ok(ctxOpaque.length > 0, 'opaque strategy context emitted');
});

test('exitForcedRevise drives the REAL exit hook → deny.message w/ echo table', async () => {
  const msg = await exitForcedRevise(JSON.stringify(AUTHOR_DOC), 'semantic-slug');
  assert.ok(typeof msg === 'string' && msg.length > 0, 'deny message produced');
  // The REAL buildReviseMessage emits the (id,kind,title) echo table + JSON.
  for (const b of AUTHOR_DOC.blocks) {
    assert.ok(msg.includes(b.id), `echo table missing id ${b.id}`);
  }
  assert.ok(msg.includes('REUSE'), 'echo-table reuse directive present');
});

test('runLiveFixture: id-preserving agent → rate 1, converged, not degraded', async () => {
  // Fake agent: authors AUTHOR_DOC, then on revise returns the same doc
  // (every id reused) — a perfectly compliant agent.
  const agent = async (_prompt, opts) => ({
    text: JSON.stringify(AUTHOR_DOC),
    sessionId: opts && opts.resume ? opts.resume : 'sess-1',
  });
  const r = await runLiveFixture(FIXTURE, { strategy: 'semantic-slug', agent });
  assert.equal(r.error, undefined, `no error: ${r.error}`);
  assert.equal(r.firstTryValid, true);
  assert.equal(r.valid, true);
  assert.equal(r.convergedWithin2, true);
  assert.equal(r.degraded, false);
  assert.equal(r.idResult.denominator, AUTHOR_DOC.blocks.length);
  assert.equal(r.idResult.rate, 1, 'all author ids preserved → 1.0');
});

test('runLiveFixture: renumbering agent → measured rate drops (falsifier works)', async () => {
  let turn = 0;
  const agent = async (_prompt, opts) => {
    turn += 1;
    if (turn === 1) return { text: JSON.stringify(AUTHOR_DOC), sessionId: 's' };
    // Revise: renumber every id (the §6 failure mode) — still schema-valid.
    const renum = {
      ...AUTHOR_DOC,
      meta: { ...AUTHOR_DOC.meta, revision: 2 },
      blocks: AUTHOR_DOC.blocks.map((b, i) => ({ ...b, id: `b${i}` })),
    };
    return { text: JSON.stringify(renum), sessionId: opts.resume || 's' };
  };
  const r = await runLiveFixture(FIXTURE, { strategy: 'opaque', agent });
  assert.equal(r.error, undefined);
  assert.equal(r.valid, true, 'revised doc still schema-valid');
  assert.equal(r.convergedWithin2, true);
  assert.equal(
    r.idResult.rate,
    0,
    'every id renumbered → 0 preserved (denominator frozen at author time)',
  );
});

test('runLiveFixture: degraded revise (non-JSON) → not converged, rate 0', async () => {
  let turn = 0;
  const agent = async (_p, o) => {
    turn += 1;
    if (turn === 1) return { text: JSON.stringify(AUTHOR_DOC), sessionId: 's' };
    return { text: 'Sorry, here is a prose plan instead.', sessionId: o.resume };
  };
  const r = await runLiveFixture(FIXTURE, { strategy: 'semantic-slug', agent });
  assert.equal(r.valid, false, 'non-JSON revise does not validate');
  assert.equal(r.convergedWithin2, false);
  assert.equal(r.degraded, true);
  assert.equal(r.idResult.rate, 0);
});
