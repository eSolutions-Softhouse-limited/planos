/**
 * planos — M4 ("rich interactive editing") working-doc model + round-trip
 * tests (plain Node, zero dependencies).
 *
 * Two layers, both here:
 *
 *   (A) PURE MODEL: deriveWorkingDoc folds back per-kind field edits for ALL
 *       v2 PRD kinds, plus id-stable addBlock / deleteBlock, and the working
 *       doc it produces is schema-valid (validateDocument). Existing block ids
 *       are NEVER renumbered; added blocks get deterministic collision-free
 *       ids; the no-edit path is still a byte no-op.
 *
 *   (B) ROUND-TRIP: a multi-kind edit + add + delete round-trips through the
 *       FULL production approve path (handlePrd → selectApproveDoc →
 *       saveRevision) via a child process; the ON-DISK persisted revision's
 *       canonical content equals the reviewer's M4-edited working doc.
 *
 * WHY (B) IS NOT TAUTOLOGICAL: it drives the real blocking path and asserts
 * the persisted r002 canonical content equals the deriveWorkingDoc output for
 * a 4-way change set (objective edit, table cell add via row, a NEW code
 * block, a DELETED risk block). A model regression that drops adds/deletes or
 * mis-folds a non-task kind makes loadRevision(...,2) diverge from the
 * expected edited doc and the canonical-equality assertion fails. (A) pins the
 * id-stability + schema-validity independently so (B) cannot pass by accident.
 *
 * Run: node --test tests/workingdoc-m4.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  deriveWorkingDoc,
  mintAddedBlockId,
} from '../src/editor/workingDoc.impl.mjs';
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
// Fixture — a v2 PRD touching every kind family the M4 modals edit.
// ---------------------------------------------------------------------------

const BASE = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-m4-richedit-demo-2026-05-17',
  title: 'PRD M4 Rich-Edit Demo',
  meta: { status: 'draft', createdAt: '2026-05-17T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'b2', kind: 'objective', text: 'Ship M4', successCriteria: ['offline gate green'] },
    {
      id: 'b3',
      kind: 'task',
      title: 'Build modals',
      status: 'todo',
      deps: [],
      acceptance: ['per-kind forms'],
    },
    {
      id: 'b4',
      kind: 'table',
      columns: ['Step', 'Owner'],
      rows: [['A', 'X']],
    },
    {
      id: 'b5',
      kind: 'risk',
      description: 'TipTap balloons bundle',
      likelihood: 'M',
      impact: 'H',
      mitigation: 'in-house fallback',
    },
    { id: 'b6', kind: 'diagram', mermaid: 'graph TD\n  A --> B' },
  ],
};

// ---------------------------------------------------------------------------
// (A) PURE MODEL
// ---------------------------------------------------------------------------

test('M4 (A1): no-edit deriveWorkingDoc is a byte no-op (canonical-equal to base)', () => {
  const wd = deriveWorkingDoc(BASE, {});
  assert.equal(canonicalize(wd), canonicalize(BASE), 'no-op must not differ');
  // base untouched
  assert.equal(BASE.blocks.length, 6);
});

test('M4 (A2): folds back a field edit for EVERY non-task v2/v1 kind', () => {
  const edits = {
    b1: { title: 'Overview (edited)', level: 2 }, // section
    b2: { text: 'Ship M4 fully', successCriteria: ['a', 'b'] }, // objective
    b4: { columns: ['Step', 'Owner', 'Done'], rows: [['A', 'X', 'yes']] }, // table
    b5: { mitigation: 'shipped in-house markdown editor' }, // risk
    b6: { mermaid: 'graph LR\n  X --> Y' }, // diagram
  };
  const wd = deriveWorkingDoc(BASE, { edits });
  const by = Object.fromEntries(wd.blocks.map((b) => [b.id, b]));
  assert.equal(by.b1.title, 'Overview (edited)');
  assert.equal(by.b1.level, 2);
  assert.equal(by.b2.text, 'Ship M4 fully');
  assert.deepEqual(by.b2.successCriteria, ['a', 'b']);
  assert.deepEqual(by.b4.columns, ['Step', 'Owner', 'Done']);
  assert.deepEqual(by.b4.rows, [['A', 'X', 'yes']]);
  assert.equal(by.b5.mitigation, 'shipped in-house markdown editor');
  assert.equal(by.b6.mermaid, 'graph LR\n  X --> Y');
  // ids unchanged; order unchanged
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
  );
  assert.equal(validateDocument(wd).ok, true, 'edited doc must be schema-valid');
});

test('M4 (A3): addBlock is id-stable, positioned, and never renumbers', () => {
  const wd = deriveWorkingDoc(BASE, {
    adds: [
      { afterId: 'b3', block: { kind: 'code', lang: 'ts', content: 'const x=1;' } },
      { afterId: null, block: { kind: 'prose', md: 'Lead-in.' } },
    ],
  });
  const ids = wd.blocks.map((b) => b.id);
  // Ids are minted in adds-array order (deterministic): the b3-anchored code
  // block is entry[0] → b7; the prepended prose is entry[1] → b8. Positioning
  // is independent of mint order: prepend lands first, code right after b3.
  assert.equal(ids[0], 'b8', 'prepended add gets a deterministic minted id');
  assert.deepEqual(ids.slice(1, 4), ['b1', 'b2', 'b3']);
  const codeIdx = ids.indexOf('b3') + 1;
  assert.equal(wd.blocks[codeIdx].kind, 'code');
  assert.equal(wd.blocks[codeIdx].id, 'b7', 'code block mint is deterministic');
  // every original id intact, none renumbered
  for (const id of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
    assert.ok(ids.includes(id), `${id} preserved`);
  }
  assert.equal(validateDocument(wd).ok, true, 'added doc is schema-valid');
});

test('M4 (A4): deleteBlock drops only the listed id; nothing else renumbers', () => {
  const wd = deriveWorkingDoc(BASE, { deletes: ['b5'] });
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    ['b1', 'b2', 'b3', 'b4', 'b6']
  );
  assert.equal(validateDocument(wd).ok, true);
});

test('M4 (A5): caller-supplied add id is honoured; mintAddedBlockId seeds past existing', () => {
  const wd = deriveWorkingDoc(BASE, {
    adds: [{ afterId: 'b1', block: { id: 'custom-id', kind: 'prose', md: 'x' } }],
  });
  assert.ok(wd.blocks.some((b) => b.id === 'custom-id'));
  assert.equal(
    mintAddedBlockId(['b1', 'b2', 'b9']),
    'b10',
    'minted id seeds past the highest b<n>'
  );
});

// ---------------------------------------------------------------------------
// (B) ROUND-TRIP through the real approve path.
// ---------------------------------------------------------------------------

// A 4-way M4 change set: objective edit + table grow + NEW code block +
// DELETED risk. This is exactly what App's state → deriveWorkingDoc produces.
const M4_EDITS = {
  edits: {
    b2: { text: 'Ship M4 fully', successCriteria: ['offline gate green', 'modals work'] },
    b4: { columns: ['Step', 'Owner'], rows: [['A', 'X'], ['B', 'Y']] },
  },
  deletes: ['b5'],
  adds: [
    {
      afterId: 'b3',
      block: { id: 'b7', kind: 'code', lang: 'ts', content: 'export const ok = true;' },
    },
  ],
};

const EDITED_DOC = deriveWorkingDoc(BASE, M4_EDITS);

const APPROVE_WITH_M4 = {
  decision: 'approve',
  documentId: BASE.id,
  baseRevision: 1,
  ops: [
    { op: 'editBlock', blockId: 'b2', patch: M4_EDITS.edits.b2 },
    { op: 'deleteBlock', blockId: 'b5' },
    { op: 'addBlock', afterBlockId: 'b3', block: M4_EDITS.adds[0].block },
  ],
  globalComment: 'Approved with M4 structural edits.',
  editedDocument: EDITED_DOC,
};

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-m4-test-'));
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

await test('M4 (B): a multi-kind edit+add+delete round-trips through approve → persisted revision == the M4 edited doc', async () => {
  const rootDir = makeTempRoot();
  try {
    // Seed r001.
    const seed = await runScripted(BASE, 'approve', rootDir);
    assert.equal(seed.code, 0, `seed exits 0; stderr: ${seed.stderr}`);
    assert.equal(loadLatest(rootDir, BASE.id).revision, 1, 'seed → r001');

    const { stdout, stderr, code } = await runScripted(
      BASE,
      'approve',
      rootDir,
      APPROVE_WITH_M4
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const prd = JSON.parse(stdout.trim()).hookSpecificOutput.prd;
    assert.equal(prd.revision, 2, 'M4-edited approve → revision 2');
    assert.equal(prd.persisted, true);
    assert.equal(prd.source, 'reviewer-edited');
    assert.equal(prd.noop, false);

    const onDisk = loadRevision(rootDir, BASE.id, 2);
    const expected = { ...EDITED_DOC, meta: { ...EDITED_DOC.meta, revision: 2 } };
    assert.equal(
      canonicalize(onDisk),
      canonicalize(expected),
      'persisted r002 canonical content == the M4 deriveWorkingDoc output'
    );

    // Spell out the load-bearing pieces so a partial regression is obvious.
    const ids = onDisk.blocks.map((b) => b.id);
    assert.ok(!ids.includes('b5'), 'deleted risk block is gone from r002');
    assert.ok(ids.includes('b7'), 'added code block persisted with stable id');
    const b7 = onDisk.blocks.find((b) => b.id === 'b7');
    assert.equal(b7.kind, 'code');
    assert.equal(b7.content, 'export const ok = true;');
    const b2 = onDisk.blocks.find((b) => b.id === 'b2');
    assert.equal(b2.text, 'Ship M4 fully', 'objective edit stuck');
    assert.equal(validateDocument(onDisk).ok, true, 'persisted doc is schema-valid');

    // Chain integrity.
    const revs = listRevisions(rootDir, BASE.id).map((x) => x.revision);
    assert.deepEqual(revs, [2, 1], 'r002 chained off r001 (append-only)');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

console.log('');
console.log(
  `workingDoc M4 (rich interactive editing) tests: ${passed} passed, ${failed} failed`
);
console.log('');

if (failed > 0) process.exit(1);
