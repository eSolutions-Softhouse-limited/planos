/**
 * planos — M5 ("drag-and-drop reordering") working-doc model + round-trip
 * tests (plain Node, zero dependencies).
 *
 * Two layers, both here:
 *
 *   (A) PURE MODEL: deriveWorkingDoc accepts a new `order: string[]` state and
 *       applies it at the SAME single fold-back site as a PURE PERMUTATION —
 *       it never mints/renumbers an id, never adds/drops a block, composes
 *       correctly with adds (an added block can be reordered by its minted id)
 *       and deletes (a deleted id in `order` is skipped — deletes wins), and
 *       the reordered doc is schema-valid (validateDocument) and canonical.
 *
 *   (B) ROUND-TRIP: a pure reorder round-trips through the FULL production
 *       approve path (handlePrd → selectApproveDoc → saveRevision) via a child
 *       process; the ON-DISK persisted revision's block ORDER == the reviewer's
 *       reordered sequence (same ids, no renumber).
 *
 * WHY (B) IS NOT TAUTOLOGICAL: it drives the real blocking path and asserts the
 * persisted r002 block-id sequence equals the reviewer-reordered sequence — a
 * NON-trivial permutation of r001's order. A model regression that ignores
 * `order` (e.g. drops Pass 3) leaves the persisted order == the base order, so
 * the sequence-equality assertion fails. A NEGATIVE control in the same test
 * recomputes the expected doc from a deriveWorkingDoc that was fed NO `order`
 * and asserts it does NOT match the on-disk doc — proving the assertion only
 * passes because `order` actually reordered. (A) pins id-stability +
 * schema-validity + compose-with-adds/deletes independently so (B) cannot pass
 * by accident.
 *
 * Run: node --test tests/workingdoc-m5.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveWorkingDoc } from '../src/editor/workingDoc.impl.mjs';
import { validateDocument } from '../src/schema/index.mjs';
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
        () => {
          passed++;
          console.log(`  PASS  ${name}`);
        },
        (err) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err && err.message ? err.message : String(err)}`);
        }
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
// Fixture — a v2 PRD with a stable 6-block order.
// ---------------------------------------------------------------------------

const BASE = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-m5-reorder-demo-2026-05-17',
  title: 'PRD M5 Reorder Demo',
  meta: { status: 'draft', createdAt: '2026-05-17T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'b2', kind: 'objective', text: 'Ship M5', successCriteria: ['dnd works'] },
    {
      id: 'b3',
      kind: 'task',
      title: 'Native DnD',
      status: 'todo',
      deps: [],
      acceptance: ['vertical list'],
    },
    { id: 'b4', kind: 'prose', md: 'Reorder is a pure permutation.' },
    {
      id: 'b5',
      kind: 'risk',
      description: 'DnD collides with TipTap',
      likelihood: 'L',
      impact: 'M',
      mitigation: 'outer-layer isolation',
    },
    { id: 'b6', kind: 'diagram', mermaid: 'graph TD\n  A --> B' },
  ],
};

// ---------------------------------------------------------------------------
// (A) PURE MODEL
// ---------------------------------------------------------------------------

test('M5 (A1): empty/absent order is a byte no-op (canonical-equal to base)', () => {
  assert.equal(canonicalize(deriveWorkingDoc(BASE, {})), canonicalize(BASE));
  assert.equal(
    canonicalize(deriveWorkingDoc(BASE, { order: [] })),
    canonicalize(BASE)
  );
  // order == the current sequence is also a no-op.
  assert.equal(
    canonicalize(
      deriveWorkingDoc(BASE, { order: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] })
    ),
    canonicalize(BASE)
  );
  assert.equal(BASE.blocks.length, 6, 'base untouched');
});

test('M5 (A2): a full reorder permutes blocks, is id-stable, schema-valid', () => {
  const order = ['b6', 'b1', 'b5', 'b2', 'b4', 'b3'];
  const wd = deriveWorkingDoc(BASE, { order });
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    order,
    'blocks emitted in the reviewer order'
  );
  // Per-block identity is preserved byte-for-byte (pure permutation — no
  // mint, no renumber, no field change).
  for (const id of order) {
    const before = BASE.blocks.find((b) => b.id === id);
    const after = wd.blocks.find((b) => b.id === id);
    assert.equal(JSON.stringify(after), JSON.stringify(before), `${id} unchanged`);
  }
  assert.equal(BASE.blocks.length, 6, 'base array length unchanged');
  assert.equal(validateDocument(wd).ok, true, 'reordered doc is schema-valid');
});

test('M5 (A3): a PARTIAL order moves only the listed ids; the rest keep relative position', () => {
  // Reviewer only dragged b5 to the front. Everything else stays in order
  // AFTER the listed ones.
  const wd = deriveWorkingDoc(BASE, { order: ['b5'] });
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    ['b5', 'b1', 'b2', 'b3', 'b4', 'b6'],
    'unlisted ids keep their original relative order, appended after listed'
  );
  assert.equal(validateDocument(wd).ok, true);
});

test('M5 (A4): order composes with adds — an added block reorders by its minted id', () => {
  // Add a code block after b3 (mints b7), then put it first via `order`.
  const wd = deriveWorkingDoc(BASE, {
    adds: [{ afterId: 'b3', block: { id: 'b7', kind: 'code', lang: 'ts', content: 'x' } }],
    order: ['b7', 'b1'],
  });
  const ids = wd.blocks.map((b) => b.id);
  assert.equal(ids[0], 'b7', 'the freshly-added block was reordered to the front');
  assert.equal(ids[1], 'b1');
  // All originals + the add are still present exactly once (no drop/dupe).
  assert.deepEqual(
    [...ids].sort(),
    ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
    'no block dropped or duplicated by the reorder'
  );
  assert.equal(validateDocument(wd).ok, true);
});

test('M5 (A5): deletes WINS over order — a deleted id listed in order is skipped, never resurrected', () => {
  const wd = deriveWorkingDoc(BASE, {
    deletes: ['b3'],
    order: ['b3', 'b6', 'b1'], // b3 was deleted — must be skipped
  });
  const ids = wd.blocks.map((b) => b.id);
  assert.ok(!ids.includes('b3'), 'deleted block is NOT resurrected by order');
  assert.deepEqual(
    ids,
    ['b6', 'b1', 'b2', 'b4', 'b5'],
    'order applied over the surviving ids; deletes honoured'
  );
  assert.equal(validateDocument(wd).ok, true);
});

test('M5 (A6): unknown / duplicate ids in order are ignored (never throws, never drops)', () => {
  const wd = deriveWorkingDoc(BASE, {
    order: ['nope', 'b2', 'b2', 'b1'],
  });
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    ['b2', 'b1', 'b3', 'b4', 'b5', 'b6'],
    'unknown id skipped; duplicate b2 applied once; rest keep order'
  );
  assert.equal(validateDocument(wd).ok, true);
});

// ---------------------------------------------------------------------------
// (B) ROUND-TRIP through the real approve path.
// ---------------------------------------------------------------------------

// A pure reorder — no edits, no adds, no deletes. Reviewer dragged the diagram
// to the top and the task to the bottom.
const REORDER = { order: ['b6', 'b1', 'b2', 'b4', 'b5', 'b3'] };
const EDITED_DOC = deriveWorkingDoc(BASE, REORDER);

const APPROVE_WITH_REORDER = {
  decision: 'approve',
  documentId: BASE.id,
  baseRevision: 1,
  ops: [],
  globalComment: 'Approved with the blocks reordered.',
  editedDocument: EDITED_DOC,
};

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-m5-test-'));
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
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => res({ stdout, stderr, code }));
  });
}

await test('M5 (B): a pure reorder round-trips through approve → persisted revision block order == the reviewer order', async () => {
  const rootDir = makeTempRoot();
  try {
    // Seed r001 (the agent-authored base order).
    const seed = await runScripted(BASE, 'approve', rootDir);
    assert.equal(seed.code, 0, `seed exits 0; stderr: ${seed.stderr}`);
    assert.equal(loadLatest(rootDir, BASE.id).revision, 1, 'seed → r001');
    const r1 = loadRevision(rootDir, BASE.id, 1);
    assert.deepEqual(
      r1.blocks.map((b) => b.id),
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      'r001 has the base order'
    );

    const { stdout, stderr, code } = await runScripted(
      BASE,
      'approve',
      rootDir,
      APPROVE_WITH_REORDER
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const prd = JSON.parse(stdout.trim()).hookSpecificOutput.prd;
    assert.equal(prd.revision, 2, 'reordered approve → revision 2');
    assert.equal(prd.persisted, true);
    assert.equal(prd.source, 'reviewer-edited');
    assert.equal(prd.noop, false, 'a real reorder is not a no-op');

    const onDisk = loadRevision(rootDir, BASE.id, 2);

    // THE LOAD-BEARING ASSERTION: persisted r002's block-id SEQUENCE equals
    // the reviewer-reordered sequence (a non-trivial permutation of r001).
    assert.deepEqual(
      onDisk.blocks.map((b) => b.id),
      REORDER.order,
      'persisted r002 block order == the reviewer drag order'
    );

    // Canonical content equals the deriveWorkingDoc output (normalised rev).
    const expected = { ...EDITED_DOC, meta: { ...EDITED_DOC.meta, revision: 2 } };
    assert.equal(
      canonicalize(onDisk),
      canonicalize(expected),
      'persisted r002 canonical content == the M5 reordered working doc'
    );

    // Id-stable: same id SET as r001, just resequenced — nothing renumbered,
    // nothing added/dropped.
    assert.deepEqual(
      [...onDisk.blocks.map((b) => b.id)].sort(),
      [...r1.blocks.map((b) => b.id)].sort(),
      'same id set as r001 (pure permutation — no mint/renumber/add/drop)'
    );

    // NEGATIVE CONTROL — proves the assertion above is non-tautological: a
    // deriveWorkingDoc fed NO `order` (the regression shape) yields the BASE
    // order, which does NOT match the on-disk reordered doc. If Pass 3 were
    // dropped, the on-disk doc would equal `noReorder` and (B) would fail.
    const noReorder = deriveWorkingDoc(BASE, {});
    assert.notDeepEqual(
      onDisk.blocks.map((b) => b.id),
      noReorder.blocks.map((b) => b.id),
      'sanity: the persisted order is NOT the base order (order actually applied)'
    );
    assert.notEqual(
      canonicalize(onDisk),
      canonicalize({ ...noReorder, meta: { ...noReorder.meta, revision: 2 } }),
      'sanity: persisted doc differs from the no-reorder doc'
    );

    // Chain integrity (append-only).
    const revs = listRevisions(rootDir, BASE.id).map((x) => x.revision);
    assert.deepEqual(revs, [2, 1], 'r002 chained off r001 (append-only)');
    assert.equal(validateDocument(onDisk).ok, true, 'persisted doc schema-valid');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

console.log('');
console.log(
  `workingDoc M5 (drag-and-drop reordering) tests: ${passed} passed, ${failed} failed`
);
console.log('');

if (failed > 0) process.exit(1);
