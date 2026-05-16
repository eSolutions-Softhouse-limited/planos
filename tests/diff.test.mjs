/**
 * planos — structural diff engine tests (plain Node, zero dependencies).
 *
 * Covers US-018 / AC-14:
 *  - Outer pass classifies EVERY block as exactly one of
 *    added/removed/moved/modified/unchanged by ID-set + position.
 *  - Inner pass word-diffs the text-bearing fields of modified blocks.
 *  - Asserted against a forced-revise fixture pair with KNOWN expected
 *    classifications, covering every status incl. move+modify and kind-change.
 *  - Determinism: byte-identical output across repeated runs.
 *
 * Run: node tests/diff.test.mjs
 */

import assert from "node:assert/strict";
import {
  diffDocuments,
  wordDiff,
  DIFF_STATUS,
} from "../src/diff/structural.mjs";

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
// Forced-revise fixture pair with KNOWN expected classifications.
//
//   u1  unchanged  — identical block, identical position.
//   m1  modified   — prose.md text changed in place.
//   m2  modified   — task: moved AND detail changed (move+modify ⇒ modified).
//   mv1 moved       — section: identical content, position index changed.
//   r1  removed     — risk present in prev, absent in next.
//   a1  added       — openQuestion present in next, absent in prev.
//   k1  kind-change — id reused with a different kind ⇒ removed + added,
//                     NEVER modified.
// ---------------------------------------------------------------------------

const prevDoc = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-1",
  title: "Auth rewrite",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
  blocks: [
    { id: "u1", kind: "prose", md: "Stable narrative that does not change." },
    { id: "m1", kind: "prose", md: "The quick brown fox jumps over the dog." },
    {
      id: "m2",
      kind: "task",
      title: "Build dual-write layer",
      detail: "Write to old store only.",
      status: "todo",
      deps: [],
      acceptance: ["passes ci"],
    },
    { id: "mv1", kind: "section", title: "Rollout", level: 2 },
    {
      id: "r1",
      kind: "risk",
      description: "Migration may drop rows.",
      likelihood: "M",
      impact: "H",
      mitigation: "Dual-write + reconciliation job.",
    },
    {
      id: "k1",
      kind: "prose",
      md: "Originally a prose block — same id, different kind next.",
    },
  ],
};

const nextDoc = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-1",
  title: "Auth rewrite",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 2 },
  blocks: [
    // mv1 moved to the top (position index 3 -> 0), content identical.
    { id: "mv1", kind: "section", title: "Rollout", level: 2 },
    { id: "u1", kind: "prose", md: "Stable narrative that does not change." },
    {
      id: "m1",
      kind: "prose",
      md: "The quick brown fox leaps over the lazy dog.",
    },
    {
      // m2 moved (index 2 -> 4) AND detail changed ⇒ modified.
      id: "m2",
      kind: "task",
      title: "Build dual-write layer",
      detail: "Write to old and new store behind a flag.",
      status: "todo",
      deps: [],
      acceptance: ["passes ci"],
    },
    {
      id: "a1",
      kind: "openQuestion",
      question: "Which region cuts over first?",
    },
    {
      // Same id k1, kind changed prose -> objective ⇒ removed + added.
      id: "k1",
      kind: "objective",
      text: "Now an objective, not prose.",
      successCriteria: ["measurable"],
    },
  ],
};

/** Build {id: status} map from a diff result for compact assertions. */
function statusMap(result) {
  const map = {};
  for (const e of result.blocks) {
    // Kind-change yields two entries for k1 (added + removed). Collapse to a
    // set under the id so we can assert both halves explicitly below.
    if (map[e.id] === undefined) map[e.id] = [];
    map[e.id].push(e.status);
  }
  return map;
}

test("AC-14 outer pass classifies every block exactly per known fixture", () => {
  const result = diffDocuments(prevDoc, nextDoc);
  const m = statusMap(result);

  assert.deepEqual(m.u1, [DIFF_STATUS.UNCHANGED], "u1 must be unchanged");
  assert.deepEqual(m.m1, [DIFF_STATUS.MODIFIED], "m1 must be modified");
  assert.deepEqual(
    m.m2,
    [DIFF_STATUS.MODIFIED],
    "m2 (move+modify) must classify as modified, not moved",
  );
  assert.deepEqual(m.mv1, [DIFF_STATUS.MOVED], "mv1 must be moved");
  assert.deepEqual(m.r1, [DIFF_STATUS.REMOVED], "r1 must be removed");
  assert.deepEqual(m.a1, [DIFF_STATUS.ADDED], "a1 must be added");

  // k1: id reused with a different kind ⇒ exactly one ADDED + one REMOVED,
  // never MODIFIED.
  const k1Statuses = m.k1.slice().sort();
  assert.deepEqual(
    k1Statuses,
    [DIFF_STATUS.ADDED, DIFF_STATUS.REMOVED].sort(),
    "k1 kind-change must be removed+added, never modified",
  );
  for (const e of result.blocks) {
    if (e.id === "k1") {
      assert.notEqual(
        e.status,
        DIFF_STATUS.MODIFIED,
        "k1 must never be classified modified",
      );
    }
  }
});

test("AC-14 every result entry has exactly one valid status", () => {
  const result = diffDocuments(prevDoc, nextDoc);
  const valid = new Set(Object.values(DIFF_STATUS));
  for (const e of result.blocks) {
    assert.ok(
      valid.has(e.status),
      `block ${e.id} has invalid status ${e.status}`,
    );
  }
  // 6 next-side entries (u1,m1,m2,mv1,a1,k1-added) + 2 removed (r1,k1-removed).
  assert.equal(result.blocks.length, 8, "expected 8 classified entries");
});

test("AC-14 byId indexes surviving/next entries (removed never clobbers)", () => {
  const result = diffDocuments(prevDoc, nextDoc);
  assert.equal(result.byId.u1.status, DIFF_STATUS.UNCHANGED);
  assert.equal(result.byId.m1.status, DIFF_STATUS.MODIFIED);
  assert.equal(result.byId.a1.status, DIFF_STATUS.ADDED);
  assert.equal(result.byId.r1.status, DIFF_STATUS.REMOVED);
  // k1 has both an added and removed entry; byId must keep the next/added one.
  assert.equal(
    result.byId.k1.status,
    DIFF_STATUS.ADDED,
    "byId[k1] must be the surviving next-side entry, not removed",
  );
});

test("AC-14 inner word-diff on modified prose (m1) tags equal/added/removed", () => {
  const result = diffDocuments(prevDoc, nextDoc);
  const m1 = result.byId.m1;
  assert.ok(m1.fieldDiffs, "m1 must carry fieldDiffs");
  const mdDiff = m1.fieldDiffs.find((f) => f.field === "md");
  assert.ok(mdDiff, "m1 must have a word-diff for the 'md' field");

  // "The quick brown fox jumps over the dog."
  //   -> "The quick brown fox leaps over the lazy dog."
  const runs = mdDiff.runs;
  // Reconstructing each side from the runs must reproduce the originals.
  const prevText = runs
    .filter((r) => r.type !== "added")
    .map((r) => r.value)
    .join("");
  const nextText = runs
    .filter((r) => r.type !== "removed")
    .map((r) => r.value)
    .join("");
  assert.equal(prevText, "The quick brown fox jumps over the dog.");
  assert.equal(nextText, "The quick brown fox leaps over the lazy dog.");

  // "jumps" removed, "leaps" added; "lazy " added before "dog.".
  const removed = runs
    .filter((r) => r.type === "removed")
    .map((r) => r.value)
    .join("");
  const added = runs
    .filter((r) => r.type === "added")
    .map((r) => r.value)
    .join("");
  assert.ok(removed.includes("jumps"), "removed runs must include 'jumps'");
  assert.ok(added.includes("leaps"), "added runs must include 'leaps'");
  assert.ok(added.includes("lazy"), "added runs must include 'lazy'");
  assert.ok(
    runs.some((r) => r.type === "equal" && r.value.includes("brown")),
    "shared prefix must be an equal run",
  );
});

test("AC-14 inner word-diff on modified task (m2) diffs detail not unchanged title", () => {
  const result = diffDocuments(prevDoc, nextDoc);
  const m2 = result.byId.m2;
  assert.ok(m2.fieldDiffs, "m2 must carry fieldDiffs");
  // title is unchanged → must NOT appear; detail changed → must appear.
  assert.ok(
    !m2.fieldDiffs.some((f) => f.field === "title"),
    "unchanged title must be omitted from fieldDiffs",
  );
  const detail = m2.fieldDiffs.find((f) => f.field === "detail");
  assert.ok(detail, "changed detail must be present in fieldDiffs");
  const added = detail.runs
    .filter((r) => r.type === "added")
    .map((r) => r.value)
    .join("");
  assert.ok(
    added.includes("new") && added.includes("flag"),
    "detail word-diff must mark the inserted words",
  );
});

test("AC-14 empty prev ⇒ all next blocks added", () => {
  const result = diffDocuments(null, nextDoc);
  assert.equal(result.blocks.length, nextDoc.blocks.length);
  for (const e of result.blocks) {
    assert.equal(e.status, DIFF_STATUS.ADDED, `${e.id} must be added`);
  }
});

test("AC-14 empty next ⇒ all prev blocks removed", () => {
  const result = diffDocuments(prevDoc, { blocks: [] });
  assert.equal(result.blocks.length, prevDoc.blocks.length);
  for (const e of result.blocks) {
    assert.equal(e.status, DIFF_STATUS.REMOVED, `${e.id} must be removed`);
  }
});

test("AC-14 both empty ⇒ no blocks", () => {
  const result = diffDocuments(undefined, undefined);
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(Object.keys(result.byId), []);
});

test("AC-14 pure reorder (no content change) ⇒ moved, not modified", () => {
  // A 2-element transposition is a single move: the LCS keeps one element
  // stable and flags exactly the other as `moved` (minimal, deterministic).
  // Neither side may be `modified` (content is unchanged).
  const a = {
    blocks: [
      { id: "x", kind: "prose", md: "alpha" },
      { id: "y", kind: "prose", md: "beta" },
    ],
  };
  const b = {
    blocks: [
      { id: "y", kind: "prose", md: "beta" },
      { id: "x", kind: "prose", md: "alpha" },
    ],
  };
  const r = diffDocuments(a, b);
  for (const id of ["x", "y"]) {
    assert.notEqual(
      r.byId[id].status,
      DIFF_STATUS.MODIFIED,
      `${id} content unchanged → never modified`,
    );
    assert.ok(
      r.byId[id].status === DIFF_STATUS.MOVED ||
        r.byId[id].status === DIFF_STATUS.UNCHANGED,
      `${id} must be moved or unchanged`,
    );
  }
  const movedCount = ["x", "y"].filter(
    (id) => r.byId[id].status === DIFF_STATUS.MOVED,
  ).length;
  assert.equal(
    movedCount,
    1,
    "a transposition is one move (one side stable, one moved)",
  );

  // A 3-block move where one block (q) is inserted at the front and the rest
  // keep their relative order: only q is moved, p and s stay unchanged.
  const c = {
    blocks: [
      { id: "p", kind: "prose", md: "1" },
      { id: "q", kind: "prose", md: "2" },
      { id: "s", kind: "prose", md: "3" },
    ],
  };
  const d = {
    blocks: [
      { id: "q", kind: "prose", md: "2" },
      { id: "p", kind: "prose", md: "1" },
      { id: "s", kind: "prose", md: "3" },
    ],
  };
  const r2 = diffDocuments(c, d);
  // The deterministic LCS keeps the [q,s] subsequence stable and flags p as
  // the single relocated block (minimal move; q,s relative order preserved).
  assert.equal(r2.byId.q.status, DIFF_STATUS.UNCHANGED, "q relative order kept");
  assert.equal(r2.byId.s.status, DIFF_STATUS.UNCHANGED, "s relative order kept");
  assert.equal(r2.byId.p.status, DIFF_STATUS.MOVED, "only p was relocated");
  // Whatever the LCS tie-break, the invariants hold: no content modified, and
  // exactly one of the three is the single move.
  for (const id of ["p", "q", "s"]) {
    assert.notEqual(r2.byId[id].status, DIFF_STATUS.MODIFIED);
  }
  assert.equal(
    ["p", "q", "s"].filter((id) => r2.byId[id].status === DIFF_STATUS.MOVED)
      .length,
    1,
    "exactly one relocated block for a single front-insertion reorder",
  );
});

test("AC-14 key-order-only object difference ⇒ unchanged (canonical compare)", () => {
  const a = { blocks: [{ id: "z", kind: "task", title: "T", status: "todo", deps: [], acceptance: ["a"] }] };
  const b = { blocks: [{ acceptance: ["a"], deps: [], status: "todo", title: "T", kind: "task", id: "z" }] };
  const r = diffDocuments(a, b);
  assert.equal(
    r.byId.z.status,
    DIFF_STATUS.UNCHANGED,
    "reordered keys must not count as a modification",
  );
});

test("AC-14 determinism: byte-identical output across repeated runs", () => {
  const r1 = diffDocuments(prevDoc, nextDoc);
  const r2 = diffDocuments(prevDoc, nextDoc);
  assert.equal(
    JSON.stringify(r1),
    JSON.stringify(r2),
    "same inputs must yield byte-identical output",
  );
  // Also stable under independent re-parse of the fixtures.
  const r3 = diffDocuments(
    JSON.parse(JSON.stringify(prevDoc)),
    JSON.parse(JSON.stringify(nextDoc)),
  );
  assert.equal(JSON.stringify(r1), JSON.stringify(r3));
});

test("wordDiff is reversible and deterministic for arbitrary text", () => {
  const a = "alpha   beta gamma";
  const b = "alpha delta  gamma epsilon";
  const runs = wordDiff(a, b);
  const left = runs.filter((r) => r.type !== "added").map((r) => r.value).join("");
  const right = runs.filter((r) => r.type !== "removed").map((r) => r.value).join("");
  assert.equal(left, a, "removing added runs must reproduce prev exactly");
  assert.equal(right, b, "removing removed runs must reproduce next exactly");
  assert.equal(
    JSON.stringify(wordDiff(a, b)),
    JSON.stringify(runs),
    "wordDiff must be deterministic",
  );
});

// ---------------------------------------------------------------------------
// AC-P4 (Phase 2 / Milestone P0): structural diff classifies v2 blocks.
//
//   v2u   unchanged  — identical diagram block, identical position.
//   v2m   modified   — fileChange.rationale text changed (TEXT_FIELDS word
//                      diff over a v2 text-bearing field).
//   v2nt  modified   — tradeoff.options[].score (a NON-text v2 field) changed
//                      ⇒ modified via structural equality, NO fieldDiffs.
//   v2tbl modified   — table.rows changed; `table` is OMITTED from
//                      TEXT_FIELDS, so structural equality classifies it
//                      modified with NO word-diff (correct for tables).
//   v2mv  moved       — code block, identical content, relative order changed.
// ---------------------------------------------------------------------------

const prevPrd = {
  schemaVersion: 1,
  type: "prd",
  id: "prd-1",
  title: "v2 diff fixture",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
  blocks: [
    { id: "v2u", kind: "diagram", mermaid: "graph TD; A-->B;" },
    {
      id: "v2m",
      kind: "fileChange",
      path: "src/prd/store.mjs",
      action: "add",
      rationale: "Initial append-only persistence layer.",
    },
    {
      id: "v2nt",
      kind: "tradeoff",
      axis: "Storage backend",
      options: [
        { label: "Postgres", score: 7 },
        { label: "SQLite", score: 5 },
      ],
    },
    {
      id: "v2tbl",
      kind: "table",
      columns: ["Field", "Type"],
      rows: [["id", "string"]],
    },
    { id: "v2mv", kind: "code", lang: "js", content: "const x = 1;\n" },
  ],
};

const nextPrd = {
  schemaVersion: 1,
  type: "prd",
  id: "prd-1",
  title: "v2 diff fixture",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 2 },
  blocks: [
    // v2mv moved to the top (index 4 -> 0), content identical.
    { id: "v2mv", kind: "code", lang: "js", content: "const x = 1;\n" },
    { id: "v2u", kind: "diagram", mermaid: "graph TD; A-->B;" },
    {
      // rationale text changed ⇒ modified with a word-diff over `rationale`.
      id: "v2m",
      kind: "fileChange",
      path: "src/prd/store.mjs",
      action: "add",
      rationale: "Revised append-only persistence layer with locking.",
    },
    {
      // Only a non-text field (score) changed ⇒ modified, NO fieldDiffs.
      id: "v2nt",
      kind: "tradeoff",
      axis: "Storage backend",
      options: [
        { label: "Postgres", score: 9 },
        { label: "SQLite", score: 5 },
      ],
    },
    {
      // rows changed; table omitted from TEXT_FIELDS ⇒ modified, no word-diff.
      id: "v2tbl",
      kind: "table",
      columns: ["Field", "Type"],
      rows: [
        ["id", "string"],
        ["title", "string"],
      ],
    },
  ],
};

test("AC-P4 v2 blocks classify correctly (text/non-text/table/move)", () => {
  const r = diffDocuments(prevPrd, nextPrd);

  assert.equal(r.byId.v2u.status, DIFF_STATUS.UNCHANGED, "v2u unchanged");
  assert.equal(r.byId.v2mv.status, DIFF_STATUS.MOVED, "v2mv moved (code)");
  assert.equal(r.byId.v2m.status, DIFF_STATUS.MODIFIED, "v2m modified");
  assert.equal(
    r.byId.v2nt.status,
    DIFF_STATUS.MODIFIED,
    "non-text v2 field change ⇒ modified via structural equality",
  );
  assert.equal(
    r.byId.v2tbl.status,
    DIFF_STATUS.MODIFIED,
    "table.rows change ⇒ modified (structural equality, table omitted)",
  );
});

test("AC-P4 v2 text-bearing field gets a word-diff (fileChange.rationale)", () => {
  const r = diffDocuments(prevPrd, nextPrd);
  const v2m = r.byId.v2m;
  assert.ok(v2m.fieldDiffs, "v2m must carry fieldDiffs");
  const rationale = v2m.fieldDiffs.find((f) => f.field === "rationale");
  assert.ok(rationale, "fileChange.rationale must be word-diffed");
  // `path` is unchanged → must NOT appear in fieldDiffs.
  assert.ok(
    !v2m.fieldDiffs.some((f) => f.field === "path"),
    "unchanged fileChange.path must be omitted from fieldDiffs",
  );
  const added = rationale.runs
    .filter((x) => x.type === "added")
    .map((x) => x.value)
    .join("");
  assert.ok(
    added.includes("Revised") && added.includes("locking"),
    "rationale word-diff must mark the inserted words",
  );
});

test("AC-P4 non-text v2 field change carries NO word-diff (tradeoff.score)", () => {
  const r = diffDocuments(prevPrd, nextPrd);
  const v2nt = r.byId.v2nt;
  // tradeoff TEXT_FIELDS is ["axis"]; axis unchanged ⇒ fieldDiffs empty.
  assert.deepEqual(
    v2nt.fieldDiffs,
    [],
    "score-only change ⇒ modified via structural equality, no fieldDiffs",
  );
});

test("AC-P4 table change carries NO word-diff (table omitted from TEXT_FIELDS)", () => {
  const r = diffDocuments(prevPrd, nextPrd);
  const v2tbl = r.byId.v2tbl;
  assert.deepEqual(
    v2tbl.fieldDiffs,
    [],
    "table is intentionally omitted from TEXT_FIELDS — structural equality only",
  );
});

test("AC-P4 v2 diff is deterministic (byte-identical across runs)", () => {
  const a = diffDocuments(prevPrd, nextPrd);
  const b = diffDocuments(
    JSON.parse(JSON.stringify(prevPrd)),
    JSON.parse(JSON.stringify(nextPrd)),
  );
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// AC-R4 (Phase 3 / Milestone R0): structural diff classifies v3 `diff` blocks.
//
//   v3u   unchanged  — identical diff block, identical position.
//   v3m   modified   — a hunk LINE changed in place; `diff` TEXT_FIELDS is
//                      ["path"] (path unchanged) so it is modified via
//                      structural equality with NO word-diff (hunks/comments
//                      are structural, like `table`).
//   v3cm  modified   — only a BlockComment's verdict/text changed ⇒ modified
//                      via structural equality, NO fieldDiffs.
//   v3pm  modified   — the `path` (a TEXT_FIELD) changed ⇒ modified WITH a
//                      word-diff over `path`.
//   v3mv  moved       — identical diff block, relative order changed.
//   v3a   added       — a new file diff present only in next.
// ---------------------------------------------------------------------------

const hunkA = {
  header: "@@ -1,2 +1,2 @@",
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 2,
  lines: [
    { op: " ", text: "const a = 1;" },
    { op: "-", text: "const b = 2;" },
    { op: "+", text: "const b = 3;" },
  ],
  hunkId: "v3m-h0",
};

const prevReview = {
  schemaVersion: 1,
  type: "diff-review",
  id: "review-1",
  title: "v3 diff fixture",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
  blocks: [
    {
      id: "v3u",
      kind: "diff",
      path: "src/unchanged.mjs",
      status: "modified",
      hunks: [
        {
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [{ op: " ", text: "stable" }],
          hunkId: "v3u-h0",
        },
      ],
      comments: [],
    },
    {
      id: "v3m",
      kind: "diff",
      path: "src/changed.mjs",
      status: "modified",
      hunks: [hunkA],
      comments: [],
    },
    {
      id: "v3cm",
      kind: "diff",
      path: "src/commented.mjs",
      status: "modified",
      hunks: [],
      comments: [
        { commentId: "v3cm-c0", hunkId: null, text: "looks fine", verdict: "accept" },
      ],
    },
    {
      id: "v3pm",
      kind: "diff",
      path: "src/old/name.mjs",
      status: "renamed",
      oldPath: "src/old/sename.mjs",
      hunks: [],
      comments: [],
    },
    {
      id: "v3mv",
      kind: "diff",
      path: "src/moved.mjs",
      status: "added",
      hunks: [],
      comments: [],
    },
  ],
};

const nextReview = {
  schemaVersion: 1,
  type: "diff-review",
  id: "review-1",
  title: "v3 diff fixture",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 2 },
  blocks: [
    {
      id: "v3u",
      kind: "diff",
      path: "src/unchanged.mjs",
      status: "modified",
      hunks: [
        {
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [{ op: " ", text: "stable" }],
          hunkId: "v3u-h0",
        },
      ],
      comments: [],
    },
    {
      // v3mv moved BEFORE v3m: relative order changed, content identical.
      id: "v3mv",
      kind: "diff",
      path: "src/moved.mjs",
      status: "added",
      hunks: [],
      comments: [],
    },
    {
      id: "v3m",
      kind: "diff",
      path: "src/changed.mjs",
      status: "modified",
      hunks: [
        {
          ...hunkA,
          // A hunk LINE changed in place (3 → 4). hunks are structural.
          lines: [
            { op: " ", text: "const a = 1;" },
            { op: "-", text: "const b = 2;" },
            { op: "+", text: "const b = 4;" },
          ],
        },
      ],
      comments: [],
    },
    {
      id: "v3cm",
      kind: "diff",
      path: "src/commented.mjs",
      status: "modified",
      hunks: [],
      comments: [
        // verdict + text changed (a structural change; comments not TEXT_FIELDS).
        {
          commentId: "v3cm-c0",
          hunkId: null,
          text: "needs a test",
          verdict: "reject",
        },
      ],
    },
    {
      id: "v3pm",
      kind: "diff",
      // `path` (a TEXT_FIELD) changed ⇒ modified WITH a word-diff.
      path: "src/new/name.mjs",
      status: "renamed",
      oldPath: "src/old/sename.mjs",
      hunks: [],
      comments: [],
    },
    {
      // A genuinely-new file diff present only in next ⇒ added.
      id: "v3a",
      kind: "diff",
      path: "src/brandnew.mjs",
      status: "added",
      hunks: [],
      comments: [],
    },
  ],
};

test("AC-R4 v3 diff blocks classify correctly (unchanged/modified/moved/added)", () => {
  const r = diffDocuments(prevReview, nextReview);
  assert.equal(r.byId.v3u.status, DIFF_STATUS.UNCHANGED, "v3u unchanged");
  assert.equal(
    r.byId.v3m.status,
    DIFF_STATUS.MODIFIED,
    "v3m modified (hunk line change ⇒ structural inequality)",
  );
  assert.equal(
    r.byId.v3cm.status,
    DIFF_STATUS.MODIFIED,
    "v3cm modified (comment verdict/text change ⇒ structural inequality)",
  );
  assert.equal(
    r.byId.v3pm.status,
    DIFF_STATUS.MODIFIED,
    "v3pm modified (path change)",
  );
  assert.equal(r.byId.v3mv.status, DIFF_STATUS.MOVED, "v3mv moved");
  assert.equal(r.byId.v3a.status, DIFF_STATUS.ADDED, "v3a added");
});

test("AC-R4 v3 hunk/comment change carries NO word-diff (structural only)", () => {
  const r = diffDocuments(prevReview, nextReview);
  assert.deepEqual(
    r.byId.v3m.fieldDiffs,
    [],
    "hunks are structural (diff TEXT_FIELDS is ['path']) — no word-diff",
  );
  assert.deepEqual(
    r.byId.v3cm.fieldDiffs,
    [],
    "comments are structural — no word-diff on a verdict/text change",
  );
});

test("AC-R4 v3 path change DOES carry a word-diff (path is a TEXT_FIELD)", () => {
  const r = diffDocuments(prevReview, nextReview);
  const fd = r.byId.v3pm.fieldDiffs;
  assert.ok(
    Array.isArray(fd) && fd.length > 0,
    `expected a path word-diff, got ${JSON.stringify(fd)}`,
  );
  const pathFd = fd.find((f) => f.field === "path");
  assert.ok(pathFd, "the word-diff must be over the 'path' field");
  const added = pathFd.runs
    .filter((x) => x.type !== "removed")
    .map((x) => x.value)
    .join("");
  assert.equal(added, "src/new/name.mjs", "next path reconstructs from runs");
});

test("AC-R4 v3 diff is deterministic (byte-identical across runs)", () => {
  const a = diffDocuments(prevReview, nextReview);
  const b = diffDocuments(
    JSON.parse(JSON.stringify(prevReview)),
    JSON.parse(JSON.stringify(nextReview)),
  );
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

console.log("");
console.log(`Structural diff tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
