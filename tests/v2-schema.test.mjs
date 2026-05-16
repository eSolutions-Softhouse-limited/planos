/**
 * planos — v2 PRD schema contract tests (plain Node, zero dependencies).
 *
 * Covers Phase 2 Milestone P0 acceptance:
 *  - AC-P1: validator ACCEPTS every v2 kind (phase, tradeoff, fileChange,
 *           code, table, diagram) with valid field shapes, and REJECTS each
 *           malformed shape with a field-level error string suitable for the
 *           deny→revise preamble (asserts on the exact error path text).
 *  - AC-P2: a type:"plan" document containing a v2 kind is REJECTED; a
 *           type:"prd" document accepts v1∪v2 kinds.
 *  - AC-P3: degradeToProse still produces exactly ONE prose block +
 *           meta.degraded=true for malformed PRD input (deterministic).
 *
 * Run: node tests/v2-schema.test.mjs
 */

import assert from "node:assert/strict";
import { validateDocument, V2_KINDS } from "../src/schema/validate.mjs";
import { degradeToProse } from "../src/schema/fallback.mjs";

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

/** Wrap a list of blocks in a minimal valid type:"prd" document. */
function prdDoc(blocks) {
  return {
    schemaVersion: 1,
    type: "prd",
    id: "prd-abc-123",
    title: "Ship the PRD engine",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks,
  };
}

/** A hand-written valid type:"prd" doc exercising ALL 6 v2 kinds + a v1 kind. */
const validPrd = prdDoc([
  { id: "p0", kind: "prose", md: "PRD context. v1 kinds remain valid in PRD." },
  { id: "ph1", kind: "phase", title: "Phase 1 — foundation", taskIds: ["t1", "t2"] },
  {
    id: "tr1",
    kind: "tradeoff",
    axis: "Storage backend",
    options: [
      { label: "Postgres", score: 8, note: "mature, relational" },
      { label: "SQLite", score: 5 },
      { label: "flat files" },
    ],
  },
  {
    id: "fc1",
    kind: "fileChange",
    path: "src/prd/store.mjs",
    action: "add",
    rationale: "New append-only persistence layer.",
  },
  {
    id: "cd1",
    kind: "code",
    lang: "js",
    content: "export const x = 1;\n",
    filename: "example.mjs",
  },
  {
    id: "tb1",
    kind: "table",
    columns: ["Field", "Type", "Required"],
    rows: [
      ["id", "string", "yes"],
      ["title", "string", "yes"],
    ],
  },
  { id: "dg1", kind: "diagram", mermaid: "graph TD; A-->B;" },
]);

// ---------------------------------------------------------------------------
// AC-P1: accept every valid v2 shape
// ---------------------------------------------------------------------------

test("AC-P1 accepts a valid type:'prd' doc covering all 6 v2 kinds + v1", () => {
  const res = validateDocument(validPrd);
  assert.equal(res.ok, true, `expected ok:true, got ${JSON.stringify(res)}`);
  assert.ok(res.doc, "expected res.doc on success");
  const kinds = new Set(validPrd.blocks.map((b) => b.kind));
  for (const k of V2_KINDS) {
    assert.ok(kinds.has(k), `fixture should exercise v2 kind '${k}'`);
  }
});

test("AC-P1 accepts code with empty content and no filename (optional)", () => {
  const res = validateDocument(
    prdDoc([{ id: "c", kind: "code", lang: "txt", content: "" }]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-P1 accepts tradeoff option with no score/note (only label required)", () => {
  const res = validateDocument(
    prdDoc([
      { id: "tr", kind: "tradeoff", axis: "X", options: [{ label: "only" }] },
    ]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-P1 accepts phase with empty taskIds (agent-authored, unchecked)", () => {
  const res = validateDocument(
    prdDoc([{ id: "ph", kind: "phase", title: "Empty phase", taskIds: [] }]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  // D5(iii): NO referential check — non-resolving ids are still valid.
  const res2 = validateDocument(
    prdDoc([
      { id: "ph", kind: "phase", title: "Dangling", taskIds: ["nope-no-such"] },
    ]),
  );
  assert.equal(res2.ok, true, "phase.taskIds must NOT be referentially checked");
});

test("AC-P1 accepts each fileChange action enum value", () => {
  for (const action of ["add", "modify", "delete"]) {
    const res = validateDocument(
      prdDoc([
        { id: "fc", kind: "fileChange", path: "a.txt", action, rationale: "r" },
      ]),
    );
    assert.equal(res.ok, true, `action '${action}' must be valid`);
  }
});

// ---------------------------------------------------------------------------
// AC-P1: reject each malformed v2 shape with a field-level error string
// ---------------------------------------------------------------------------

function expectError(doc, substring, label) {
  const res = validateDocument(doc);
  assert.equal(res.ok, false, `${label}: expected ok:false`);
  const joined = res.errors.join(" || ");
  assert.ok(
    res.errors.some((e) => e.includes(substring)),
    `${label}: expected an error containing ${JSON.stringify(
      substring,
    )}\n        got: ${joined}`,
  );
}

test("AC-P1 rejects phase missing required 'title'", () => {
  expectError(
    prdDoc([{ id: "ph", kind: "phase", taskIds: [] }]),
    "blocks[0].title is required and must be a non-empty string",
    "phase missing title",
  );
});

test("AC-P1 rejects phase missing required 'taskIds'", () => {
  expectError(
    prdDoc([{ id: "ph", kind: "phase", title: "T" }]),
    "blocks[0] (phase) missing required field 'taskIds' (id[] — string[] of task block ids)",
    "phase missing taskIds",
  );
});

test("AC-P1 rejects phase taskIds containing a non-string", () => {
  expectError(
    prdDoc([{ id: "ph", kind: "phase", title: "T", taskIds: [1] }]),
    "blocks[0].taskIds[0] (phase.taskIds) must be a string but is 1",
    "phase taskIds non-string",
  );
});

test("AC-P1 rejects tradeoff missing required 'axis'", () => {
  expectError(
    prdDoc([{ id: "tr", kind: "tradeoff", options: [{ label: "a" }] }]),
    "blocks[0].axis is required and must be a non-empty string",
    "tradeoff missing axis",
  );
});

test("AC-P1 rejects tradeoff with empty options array", () => {
  expectError(
    prdDoc([{ id: "tr", kind: "tradeoff", axis: "X", options: [] }]),
    "blocks[0].options (tradeoff) must contain at least one option",
    "tradeoff empty options",
  );
});

test("AC-P1 rejects tradeoff option missing 'label'", () => {
  expectError(
    prdDoc([{ id: "tr", kind: "tradeoff", axis: "X", options: [{ score: 3 }] }]),
    "blocks[0].options[0].label is required and must be a non-empty string",
    "tradeoff option missing label",
  );
});

test("AC-P1 rejects tradeoff option with non-number score", () => {
  expectError(
    prdDoc([
      {
        id: "tr",
        kind: "tradeoff",
        axis: "X",
        options: [{ label: "a", score: "high" }],
      },
    ]),
    "blocks[0].options[0].score optional field must be a finite number when present but is 'high'",
    "tradeoff option bad score",
  );
});

test("AC-P1 rejects tradeoff option with non-string note", () => {
  expectError(
    prdDoc([
      {
        id: "tr",
        kind: "tradeoff",
        axis: "X",
        options: [{ label: "a", note: 5 }],
      },
    ]),
    "blocks[0].options[0].note optional field must be a string when present but is 5",
    "tradeoff option bad note",
  );
});

test("AC-P1 rejects fileChange missing 'path'", () => {
  expectError(
    prdDoc([{ id: "fc", kind: "fileChange", action: "add", rationale: "r" }]),
    "blocks[0].path is required and must be a non-empty string",
    "fileChange missing path",
  );
});

test("AC-P1 rejects fileChange with invalid action enum", () => {
  expectError(
    prdDoc([
      {
        id: "fc",
        kind: "fileChange",
        path: "a.txt",
        action: "rename",
        rationale: "r",
      },
    ]),
    "blocks[0].action 'rename' is not a valid value (expected one of add|modify|delete)",
    "fileChange bad action",
  );
});

test("AC-P1 rejects fileChange missing 'rationale'", () => {
  expectError(
    prdDoc([{ id: "fc", kind: "fileChange", path: "a.txt", action: "add" }]),
    "blocks[0].rationale is required and must be a non-empty string",
    "fileChange missing rationale",
  );
});

test("AC-P1 rejects code missing 'lang'", () => {
  expectError(
    prdDoc([{ id: "c", kind: "code", content: "x" }]),
    "blocks[0].lang is required and must be a non-empty string",
    "code missing lang",
  );
});

test("AC-P1 rejects code with non-string content", () => {
  expectError(
    prdDoc([{ id: "c", kind: "code", lang: "js", content: 42 }]),
    "blocks[0] (code) missing required field 'content' (string, may be empty) — got 42",
    "code bad content",
  );
});

test("AC-P1 rejects code with non-string filename", () => {
  expectError(
    prdDoc([{ id: "c", kind: "code", lang: "js", content: "", filename: 7 }]),
    "blocks[0] (code) optional field 'filename' must be a string when present but is 7",
    "code bad filename",
  );
});

test("AC-P1 rejects table with non-string-array columns", () => {
  expectError(
    prdDoc([{ id: "tb", kind: "table", columns: "a,b", rows: [] }]),
    "blocks[0].columns (table.columns) must be a string[] but is 'a,b'",
    "table bad columns",
  );
});

test("AC-P1 rejects table missing 'rows'", () => {
  expectError(
    prdDoc([{ id: "tb", kind: "table", columns: ["a"] }]),
    "blocks[0] (table) missing required field 'rows' (string[][]) — got undefined",
    "table missing rows",
  );
});

test("AC-P1 rejects table row with non-string cell", () => {
  expectError(
    prdDoc([
      { id: "tb", kind: "table", columns: ["a"], rows: [[1]] },
    ]),
    "blocks[0].rows[0][0] (table.row) must be a string but is 1",
    "table non-string cell",
  );
});

test("AC-P1 rejects table row/column length mismatch as a HARD error (D5(ii))", () => {
  expectError(
    prdDoc([
      {
        id: "tb",
        kind: "table",
        columns: ["A", "B", "C"],
        rows: [["1", "2", "3"], ["short", "row"]],
      },
    ]),
    "blocks[0].rows[1] (table) has 2 cell(s) but the table declares 3 column(s) — every row length must equal columns.length",
    "table row length mismatch",
  );
});

test("AC-P1 rejects diagram missing 'mermaid'", () => {
  expectError(
    prdDoc([{ id: "dg", kind: "diagram" }]),
    "blocks[0].mermaid is required and must be a non-empty string",
    "diagram missing mermaid",
  );
});

// ---------------------------------------------------------------------------
// AC-P2: v2 kinds are PRD-scoped (D5(i))
// ---------------------------------------------------------------------------

test("AC-P2 a type:'plan' doc containing a v2 kind is REJECTED", () => {
  for (const kind of V2_KINDS) {
    const planWithV2 = {
      schemaVersion: 1,
      type: "plan",
      id: "plan-1",
      title: "Plan that smuggles a v2 kind",
      meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
      blocks: [{ id: "x", kind }],
    };
    const res = validateDocument(planWithV2);
    assert.equal(res.ok, false, `v2 kind '${kind}' must be rejected in a plan`);
    assert.ok(
      res.errors.some(
        (e) =>
          e.includes(`blocks[0].kind '${kind}' is a v2 PRD-only kind`) &&
          e.includes("type:'plan'") &&
          e.includes("v2 kinds require type:'prd'"),
      ),
      `expected a PRD-scoping field-level error for '${kind}', got: ${res.errors.join(
        " || ",
      )}`,
    );
  }
});

test("AC-P2 a type:'prd' doc accepts v1 ∪ v2 kinds", () => {
  // Pure-v1 blocks in a PRD doc are accepted.
  const v1InPrd = prdDoc([
    { id: "s1", kind: "section", title: "Overview", level: 1 },
    { id: "p1", kind: "prose", md: "narrative" },
    {
      id: "t1",
      kind: "task",
      title: "Do it",
      status: "todo",
      deps: [],
      acceptance: ["done"],
    },
  ]);
  assert.equal(
    validateDocument(v1InPrd).ok,
    true,
    "type:'prd' must accept v1 kinds",
  );
  // The all-6-v2 + v1 mixed doc (already asserted valid above) is the ∪ case.
  assert.equal(validateDocument(validPrd).ok, true, "type:'prd' accepts v1∪v2");
});

test("AC-P2 plan-mode v1 doc is unaffected (no Phase-1 regression)", () => {
  const plan = {
    schemaVersion: 1,
    type: "plan",
    id: "plan-ok",
    title: "Plain v1 plan",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks: [{ id: "p", kind: "prose", md: "still works" }],
  };
  assert.equal(validateDocument(plan).ok, true, "v1 plan must still validate");
});

test("AC-P2 invalid-kind message reflects v1∪v2 for type:'prd'", () => {
  const res = validateDocument(
    prdDoc([{ id: "x", kind: "totallyBogus" }]),
  );
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes("blocks[0].kind 'totallyBogus' is not a valid v1∪v2 kind") &&
        e.includes("phase") &&
        e.includes("diagram"),
    ),
    `expected a v1∪v2 invalid-kind message, got: ${res.errors.join(" || ")}`,
  );
});

test("AC-P2 invalid-kind message stays v1-only for type:'plan'", () => {
  const res = validateDocument({
    schemaVersion: 1,
    type: "plan",
    id: "plan-1",
    title: "P",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks: [{ id: "x", kind: "totallyBogus" }],
  });
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes("blocks[0].kind 'totallyBogus' is not a valid v1 kind") &&
        !e.includes("phase"),
    ),
    `expected a v1-only invalid-kind message, got: ${res.errors.join(" || ")}`,
  );
});

// ---------------------------------------------------------------------------
// AC-P3: degradeToProse on malformed PRD input
// ---------------------------------------------------------------------------

test("AC-P3 degradeToProse on malformed PRD input ⇒ 1 prose block + degraded", () => {
  // Simulate the PRD path receiving unstructured / malformed text.
  const doc = degradeToProse(
    "## PRD: thing\n\n{ malformed not-a-doc v2 garbage",
  );
  assert.equal(doc.blocks.length, 1, "exactly one block");
  assert.equal(doc.blocks[0].kind, "prose", "the single block must be prose");
  assert.equal(doc.meta.degraded, true, "meta.degraded must be true");
  assert.equal(doc.meta.revision, 1, "degraded doc is revision 1");
  // The degraded doc itself must validate.
  assert.equal(
    validateDocument(doc).ok,
    true,
    "degraded PRD fallback must itself validate",
  );
});

test("AC-P3 degradeToProse is deterministic for the PRD path", () => {
  const a = degradeToProse("bad prd text", {
    id: "fixed",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const b = degradeToProse("bad prd text", {
    id: "fixed",
    createdAt: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(a, b, "same input + injected id/createdAt ⇒ identical docs");
});

console.log("");
console.log(`v2 PRD schema contract tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
