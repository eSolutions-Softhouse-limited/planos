/**
 * planos — regression tests for the independent code-review defects on
 * feat/prd-only-rich-editor (zero dependencies, plain Node; mirrors the
 * tests/workingdoc-m and tests/prd-approve test patterns; no real server,
 * scripted child-process round-trip only).
 *
 * Covered:
 *  - [HIGH] Duplicate block ids can be produced, validated, and persisted.
 *      (1) validateDocument REJECTS a duplicate-id document (field-level err).
 *      (2) deriveWorkingDoc Pass 2 re-mints a SUPPLIED id that collides with a
 *          live id (never clobbers an existing block).
 *      (3) a scripted two-adds-before-rerender style fold through
 *          deriveWorkingDoc + handlePrd→selectApproveDoc→saveRevision persists
 *          a revision with all-unique ids (or safely falls back).
 *  - [MEDIUM-1] Reviewer-edited approve echo table reflects the PERSISTED
 *      edited doc's ids, not the pre-edit set.
 *  - [MEDIUM-2] PRD history exposes the FULL persisted revision chain (every
 *      earlier rNNN.json is retrievable via GET /api/prd/version?v=<old>).
 *
 * Run: node tests/dup-id-and-echo-regression.test.mjs
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocument } from '../src/schema/validate.mjs';
import {
  assemblePriorChain,
  buildPrdApiHandlers,
} from '../src/hook/prd.mjs';
import {
  deriveWorkingDoc,
  mintAddedBlockId,
} from '../src/editor/workingDoc.impl.mjs';
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
          console.log(
            `        ${err && err.message ? err.message : String(err)}`,
          );
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
// Fixtures
// ---------------------------------------------------------------------------

const BASE = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-dup-id-regression-2026-05-17',
  title: 'Duplicate-id + echo-table regression PRD',
  meta: { status: 'draft', createdAt: '2026-05-17T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'b2', kind: 'prose', md: 'Context paragraph.' },
  ],
};

// ---------------------------------------------------------------------------
// [HIGH] (1) validateDocument rejects a duplicate-id document.
// ---------------------------------------------------------------------------

test('[HIGH] validateDocument REJECTS a doc with two blocks sharing an id', () => {
  const dup = {
    ...BASE,
    blocks: [
      { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
      { id: 'b1', kind: 'prose', md: 'Collides with the section above.' },
    ],
  };
  const res = validateDocument(dup);
  assert.equal(res.ok, false, 'duplicate-id doc MUST fail validation');
  assert.ok(
    Array.isArray(res.errors) &&
      res.errors.some(
        (e) =>
          typeof e === 'string' &&
          e.includes("blocks[1].id 'b1'") &&
          /duplicate/i.test(e),
      ),
    `expected a field-level duplicate-id error, got: ${JSON.stringify(
      res.errors,
    )}`,
  );
});

test('[HIGH] validateDocument still ACCEPTS the same doc with unique ids', () => {
  const res = validateDocument(BASE);
  assert.equal(res.ok, true, `unique-id doc must pass: ${JSON.stringify(res)}`);
});

// ---------------------------------------------------------------------------
// [HIGH] (2) deriveWorkingDoc Pass 2 re-mints a colliding SUPPLIED id.
// ---------------------------------------------------------------------------

test('[HIGH] deriveWorkingDoc re-mints a SUPPLIED add id that collides with a live block', () => {
  // A reviewer add that (buggily) carries an id already taken by base block b1.
  const wd = deriveWorkingDoc(BASE, {
    adds: [
      {
        afterId: 'b1',
        block: { id: 'b1', kind: 'prose', md: 'Added but id collides.' },
      },
    ],
  });
  const ids = wd.blocks.map((b) => b.id);
  const uniq = new Set(ids);
  assert.equal(
    ids.length,
    uniq.size,
    `all ids must be unique after fold, got ${JSON.stringify(ids)}`,
  );
  // The original b1 (section) is untouched; the colliding add was re-minted.
  const b1 = wd.blocks.find((b) => b.id === 'b1');
  assert.equal(b1.kind, 'section', 'original b1 not clobbered by the add');
  const added = wd.blocks.find((b) => b.md === 'Added but id collides.');
  assert.ok(added && added.id !== 'b1', 'colliding add got a fresh minted id');
  assert.equal(
    validateDocument(wd).ok,
    true,
    'folded doc with re-minted id is schema-valid (no duplicate)',
  );
});

// ---------------------------------------------------------------------------
// [HIGH] (3) two-adds-before-rerender → all-unique ids end to end.
// ---------------------------------------------------------------------------

/**
 * The App.tsx bug: `mintAddedBlockId(liveIds)` keyed off the un-re-derived
 * useMemo workingDoc mints the SAME bN for two back-to-back adds. The fix mints
 * against an adds-aware taken-set. This reproduces that exact taken-set logic
 * (Set of workingDoc ids ∪ pending adds ids), folds through deriveWorkingDoc,
 * then drives the real handlePrd→selectApproveDoc→saveRevision path.
 */
const TWO_ADDS = (() => {
  const adds = [];
  // Add #1 — taken-set = base ids ∪ (no pending adds yet).
  let taken = new Set([...BASE.blocks.map((b) => b.id), ...adds.map((a) => a.block.id)]);
  adds.push({
    afterId: 'b1',
    block: { id: mintAddedBlockId(taken), kind: 'prose', md: 'First add.' },
  });
  // Add #2 BEFORE a re-render — taken-set MUST include add #1's id.
  taken = new Set([...BASE.blocks.map((b) => b.id), ...adds.map((a) => a.block.id)]);
  adds.push({
    afterId: 'b2',
    block: { id: mintAddedBlockId(taken), kind: 'prose', md: 'Second add.' },
  });
  return adds;
})();

test('[HIGH] adds-aware mint: two back-to-back adds get distinct ids', () => {
  const ids = TWO_ADDS.map((a) => a.block.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    `two back-to-back adds must mint distinct ids, got ${JSON.stringify(ids)}`,
  );
});

const TWO_ADD_DOC = deriveWorkingDoc(BASE, { adds: TWO_ADDS });

test('[HIGH] deriveWorkingDoc(two adds) yields an all-unique, schema-valid doc', () => {
  const ids = TWO_ADD_DOC.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `unique ids: ${JSON.stringify(ids)}`);
  assert.equal(validateDocument(TWO_ADD_DOC).ok, true, 'folded two-add doc is valid');
});

// ---------------------------------------------------------------------------
// Scripted child-process round-trip (mirrors prd-approve-edits runScripted).
// ---------------------------------------------------------------------------

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'planos-dup-id-regression-test-'));
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

await test('[HIGH] two-adds-before-rerender folds through approve → persisted revision has all-unique ids', async () => {
  const rootDir = makeTempRoot();
  try {
    const seed = await runScripted(BASE, 'approve', rootDir);
    assert.equal(seed.code, 0, `seed exits 0; stderr: ${seed.stderr}`);
    assert.equal(loadLatest(rootDir, BASE.id).revision, 1, 'seed → r001');

    const approveWithEdits = {
      decision: 'approve',
      documentId: BASE.id,
      baseRevision: 1,
      ops: [],
      globalComment: 'Approved with two added blocks.',
      editedDocument: TWO_ADD_DOC,
    };
    const { stdout, stderr, code } = await runScripted(
      BASE,
      'approve',
      rootDir,
      approveWithEdits,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const prd = JSON.parse(stdout.trim()).hookSpecificOutput.prd;
    assert.equal(prd.revision, 2, 'two-add approve → revision 2');
    assert.equal(prd.persisted, true, 'a new revision persisted');
    assert.equal(prd.source, 'reviewer-edited', "reviewer's doc persisted");

    const onDisk = loadRevision(rootDir, BASE.id, 2);
    assert.ok(onDisk, 'r002.json written');
    const ids = onDisk.blocks.map((b) => b.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `persisted r002 has all-unique ids, got ${JSON.stringify(ids)}`,
    );
    assert.equal(
      validateDocument(onDisk).ok,
      true,
      'persisted r002 passes validation (no duplicate ids survived)',
    );
    assert.equal(onDisk.blocks.length, 4, 'base 2 + 2 adds = 4 blocks');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// [MEDIUM-1] Reviewer-edited approve echo table reflects the PERSISTED doc.
// ---------------------------------------------------------------------------

await test('[MEDIUM-1] reviewer-edited approve echo table reflects the PERSISTED edited doc ids (not the pre-edit set)', async () => {
  const rootDir = makeTempRoot();
  try {
    // Agent-authored doc with THREE blocks so the reviewer's add mints a
    // clearly-distinct id (past the highest live b<n>) and the deleted id
    // ('mid') is unambiguous.
    const authored = {
      ...BASE,
      blocks: [
        { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
        { id: 'mid', kind: 'prose', md: 'Middle block (reviewer will delete).' },
        { id: 'b2', kind: 'prose', md: 'Tail block.' },
      ],
    };
    // Seed r001 (the agent-authored doc).
    const seed = await runScripted(authored, 'approve', rootDir);
    assert.equal(seed.code, 0, `seed exits 0; stderr: ${seed.stderr}`);

    // Reviewer edits: ADD a new block (minted past b2 → b3) and DELETE 'mid'.
    const edited = deriveWorkingDoc(authored, {
      deletes: ['mid'],
      adds: [
        {
          afterId: 'b1',
          block: { kind: 'prose', md: 'Reviewer-added prose.' },
        },
      ],
    });
    const editedIds = edited.blocks.map((b) => b.id);
    assert.ok(!editedIds.includes('mid'), 'mid deleted in the edited doc');
    const addedId = edited.blocks.find((b) => b.md === 'Reviewer-added prose.').id;
    assert.ok(
      addedId && !['b1', 'b2', 'mid'].includes(addedId),
      `a fresh distinct id was minted for the add, got '${addedId}'`,
    );

    // globalComment alone triggers the approve-with-feedback message path
    // (envelopeHasFeedback) so the echo table is rendered; the structural
    // edits ride on editedDocument and become the persisted revision.
    const approveWithEdits = {
      decision: 'approve',
      documentId: BASE.id,
      baseRevision: 1,
      ops: [],
      globalComment: 'Approved with my structural edits folded in.',
      editedDocument: edited,
    };
    const { stdout, stderr, code } = await runScripted(
      BASE,
      'approve',
      rootDir,
      approveWithEdits,
    );
    assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
    const out = JSON.parse(stdout.trim());
    const decision = out.hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow');
    const msg = decision.message;
    assert.ok(typeof msg === 'string' && msg.length > 0, 'allow carries a message');
    assert.ok(
      msg.includes('REUSE THESE IDS'),
      'the echo table is present on the approve-with-feedback message',
    );

    // THE LOAD-BEARING ASSERTION: the echo table row for the deleted block
    // 'mid' must be GONE, and the newly-minted added id must be PRESENT — i.e.
    // the table describes the PERSISTED edited doc, not the pre-edit agent doc.
    const tableSection = msg.slice(msg.indexOf('REUSE THESE IDS'));
    assert.ok(
      !tableSection.includes('| mid |'),
      `echo table must NOT list the DELETED 'mid' (stale pre-edit row). msg:\n${msg}`,
    );
    assert.ok(
      tableSection.includes(`| ${addedId} |`),
      `echo table MUST list the reviewer-added id '${addedId}' (persisted doc). msg:\n${msg}`,
    );
    assert.ok(
      tableSection.includes('| b1 |'),
      'echo table still lists the surviving b1',
    );

    // Sanity: what actually persisted is the edited doc.
    const onDisk = loadRevision(rootDir, BASE.id, 2);
    assert.equal(out.hookSpecificOutput.prd.source, 'reviewer-edited');
    assert.deepEqual(
      onDisk.blocks.map((b) => b.id).sort(),
      editedIds.slice().sort(),
      'persisted r002 ids == the edited working doc ids',
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// [MEDIUM-2] The FULL persisted chain is retrievable (not just head+prev).
// ---------------------------------------------------------------------------

// (a) PURE UNIT: assemblePriorChain reads EVERY persisted rNNN.json, not just
//     the immediate predecessor. The defect passed `previousDoc ? [previousDoc]
//     : []`; reverting assemblePriorChain to that one-liner makes this fail
//     (only r3 would be returned for a 3-revision chain).
await test('[MEDIUM-2] assemblePriorChain returns the FULL persisted chain (not just head+prev)', async () => {
  const rootDir = makeTempRoot();
  try {
    for (let r = 1; r <= 3; r++) {
      const doc = {
        ...BASE,
        title: `${BASE.title} rev ${r}`,
        meta: { ...BASE.meta, revision: r },
        blocks: [
          ...BASE.blocks,
          { id: `extra-r${r}`, kind: 'prose', md: `Added in rev ${r}.` },
        ],
      };
      const res = await runScripted(doc, 'approve', rootDir);
      assert.equal(res.code, 0, `rev ${r} approve exits 0; stderr: ${res.stderr}`);
    }
    const onDisk = listRevisions(rootDir, BASE.id).map((x) => x.revision).sort();
    assert.deepEqual(onDisk, [1, 2, 3], 'three revisions persisted on disk');

    const prev = loadLatest(rootDir, BASE.id).doc; // the immediate predecessor
    const chain = assemblePriorChain(rootDir, BASE.id, prev);
    const chainRevs = chain.map((d) => d.meta.revision).sort();
    assert.deepEqual(
      chainRevs,
      [1, 2, 3],
      `assemblePriorChain must yield the FULL chain, got ${JSON.stringify(
        chainRevs,
      )}`,
    );
    // Each chain entry is the ACTUAL persisted doc (titles per revision).
    const titleByRev = Object.fromEntries(
      chain.map((d) => [d.meta.revision, d.title]),
    );
    assert.equal(titleByRev[1], `${BASE.title} rev 1`, 'r1 content preserved');
    assert.equal(titleByRev[3], `${BASE.title} rev 3`, 'r3 content preserved');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// (b) COMPOSED: assemblePriorChain → buildPrdApiHandlers (the exact wiring
//     handlePrd uses) makes EVERY old revision retrievable via
//     GET /api/prd/version?v=<old>. Under the defect (only [prev] passed) the
//     handler 404s v=1; with the full-chain fix v=1..v=3 all return 200.
await test('[MEDIUM-2] composed handlers serve every earlier revision (v=1 was a 404 under the defect)', async () => {
  const rootDir = makeTempRoot();
  try {
    for (let r = 1; r <= 3; r++) {
      const doc = {
        ...BASE,
        title: `${BASE.title} rev ${r}`,
        meta: { ...BASE.meta, revision: r },
        blocks: [
          ...BASE.blocks,
          { id: `extra-r${r}`, kind: 'prose', md: `Added in rev ${r}.` },
        ],
      };
      const res = await runScripted(doc, 'approve', rootDir);
      assert.equal(res.code, 0, `rev ${r} approve exits 0; stderr: ${res.stderr}`);
    }

    // Current authored doc = revision 4 (as handlePrd would normalise it).
    const current = { ...BASE, meta: { ...BASE.meta, revision: 4 } };
    const prev = loadLatest(rootDir, BASE.id).doc;
    const chain = assemblePriorChain(rootDir, BASE.id, prev);
    const handlers = buildPrdApiHandlers(current, chain);

    const versions = handlers['GET /api/prd/versions']({
      url: '/api/prd/versions',
    });
    const advertised = versions.json.versions
      .map((x) => x.revision)
      .sort();
    assert.deepEqual(
      advertised,
      [1, 2, 3, 4],
      `/versions advertises the FULL chain + current, got ${JSON.stringify(
        advertised,
      )}`,
    );

    const v1 = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=1' });
    const v2 = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=2' });
    const v3 = handlers['GET /api/prd/version']({ url: '/api/prd/version?v=3' });
    assert.notEqual(v1.status, 404, 'v=1 must NOT 404 (defect: only [prev] passed)');
    assert.notEqual(v2.status, 404, 'v=2 must NOT 404');
    assert.notEqual(v3.status, 404, 'v=3 must NOT 404');
    assert.equal(
      v1.json.plan.title,
      `${BASE.title} rev 1`,
      'v=1 returns the ACTUAL persisted r001 doc',
    );
    assert.equal(
      v2.json.plan.title,
      `${BASE.title} rev 2`,
      'v=2 returns the ACTUAL persisted r002 doc',
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
  `dup-id + echo-table regression tests (HIGH dup-id, MEDIUM-1 echo, MEDIUM-2 full chain): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
