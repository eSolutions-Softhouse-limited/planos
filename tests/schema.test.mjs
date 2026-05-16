/**
 * planos — v1 schema contract tests (plain Node, zero dependencies).
 *
 * Covers US-004 acceptance:
 *  - AC-6: validator accepts a hand-written valid v1 doc (all 7 kinds),
 *          rejects malformed docs with specific field-level error substrings
 *          (bad kind, missing required field, bad enum).
 *  - AC-7: degradeToProse produces exactly one prose block + meta.degraded=true,
 *          revision 1, deterministic shape.
 *
 * Run: node tests/schema.test.mjs
 */

import assert from "node:assert/strict";
import { validateDocument, V1_KINDS } from "../src/schema/validate.mjs";
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

/** A hand-written valid v1 document exercising all 7 core kinds. */
const validDoc = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-abc-123",
  title: "Ship the auth rewrite",
  meta: {
    branch: "feat/auth",
    status: "in-review",
    createdAt: "2026-05-16T00:00:00.000Z",
    revision: 3,
  },
  blocks: [
    { id: "s1", kind: "section", title: "Overview", level: 1, collapsed: false },
    { id: "p1", kind: "prose", md: "We are replacing the legacy session store." },
    {
      id: "o1",
      kind: "objective",
      text: "Zero-downtime migration",
      successCriteria: ["no 5xx spike", "p99 < 200ms"],
    },
    {
      id: "t1",
      kind: "task",
      title: "Build dual-write layer",
      detail: "Write to old + new store behind a flag",
      status: "doing",
      deps: ["o1"],
      acceptance: ["both stores consistent under load test"],
      estimate: "3d",
    },
    {
      id: "d1",
      kind: "decision",
      question: "Token format?",
      options: [
        { label: "JWT", pros: ["stateless"], cons: ["revocation"] },
        { label: "opaque" },
      ],
      chosen: "JWT",
      rationale: "stateless scaling wins",
    },
    {
      id: "r1",
      kind: "risk",
      description: "Cache stampede on cutover",
      likelihood: "M",
      impact: "H",
      mitigation: "request coalescing + warmup",
    },
    {
      id: "q1",
      kind: "openQuestion",
      question: "Do we keep the legacy endpoint for one release?",
    },
  ],
};

// ---- AC-6: accept valid ----

test("AC-6 accepts a valid v1 doc covering all 7 core kinds", () => {
  const res = validateDocument(validDoc);
  assert.equal(res.ok, true, `expected ok:true, got ${JSON.stringify(res)}`);
  assert.ok(res.doc, "expected res.doc on success");
  // sanity: all 7 kinds present in fixture
  const kinds = new Set(validDoc.blocks.map((b) => b.kind));
  for (const k of V1_KINDS) {
    assert.ok(kinds.has(k), `fixture should exercise kind '${k}'`);
  }
});

test("AC-6 accepts valid doc with status 'draft' and minimal optional fields", () => {
  const res = validateDocument({
    schemaVersion: 1,
    type: "plan",
    id: "d2",
    title: "Minimal",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks: [{ id: "p", kind: "prose", md: "" }],
  });
  assert.equal(res.ok, true, JSON.stringify(res));
});

// ---- AC-6: reject malformed with specific field-level errors ----

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

test("AC-6 rejects unknown block kind with field-level error naming the path + valid kinds", () => {
  const bad = structuredClone(validDoc);
  bad.blocks[3] = { id: "x", kind: "tsk", title: "oops" };
  expectError(
    bad,
    "blocks[3].kind 'tsk' is not a valid v1∪v2 kind (expected one of section|prose|objective|task|decision|risk|openQuestion|phase|tradeoff|fileChange|code|table|diagram)",
    "bad kind",
  );
});

test("AC-6 rejects task missing required 'acceptance' with field-level error", () => {
  const bad = structuredClone(validDoc);
  delete bad.blocks[3].acceptance;
  expectError(
    bad,
    "blocks[3] (task 'Build dual-write layer') missing required field 'acceptance' (string[])",
    "missing acceptance",
  );
});

test("AC-6 rejects task missing required 'status' and 'deps'", () => {
  const bad = structuredClone(validDoc);
  delete bad.blocks[3].status;
  delete bad.blocks[3].deps;
  const res = validateDocument(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("missing required field 'status'")));
  assert.ok(res.errors.some((e) => e.includes("missing required field 'deps'")));
});

test("AC-6 rejects bad task status enum value", () => {
  const bad = structuredClone(validDoc);
  bad.blocks[3].status = "blocked";
  expectError(
    bad,
    "blocks[3].status 'blocked' is not a valid task status (expected one of todo|doing|done|cut)",
    "bad task status",
  );
});

test("AC-6 rejects bad risk likelihood enum value", () => {
  const bad = structuredClone(validDoc);
  bad.blocks[5].likelihood = "high";
  expectError(
    bad,
    "blocks[5].likelihood 'high' is not a valid value (expected one of L|M|H)",
    "bad likelihood",
  );
});

test("AC-6 rejects bad meta.status enum value", () => {
  const bad = structuredClone(validDoc);
  bad.meta.status = "pending";
  expectError(
    bad,
    "meta.status 'pending' is not a valid value (expected one of draft|in-review|approved)",
    "bad meta status",
  );
});

test("AC-6 rejects wrong schemaVersion", () => {
  const bad = structuredClone(validDoc);
  bad.schemaVersion = 2;
  expectError(bad, "schemaVersion must be the integer 1", "bad schemaVersion");
});

test("AC-6 rejects missing block id with stability-hint error", () => {
  const bad = structuredClone(validDoc);
  delete bad.blocks[1].id;
  expectError(
    bad,
    "blocks[1].id is required and must be a non-empty string (stable across revisions)",
    "missing block id",
  );
});

test("AC-6 rejects objective with non-string-array successCriteria", () => {
  const bad = structuredClone(validDoc);
  bad.blocks[2].successCriteria = "fast";
  expectError(
    bad,
    "blocks[2].successCriteria (objective.successCriteria) must be a string[] but is 'fast'",
    "bad successCriteria",
  );
});

test("AC-6 rejects non-object document", () => {
  const res = validateDocument("not a doc");
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("document must be a JSON object")));
});

// ---- AC-7: deterministic single-prose fallback ----

test("AC-7 degradeToProse produces exactly one prose block + meta.degraded=true", () => {
  const doc = degradeToProse("# My Plan\n\nDo the thing.\n");
  assert.equal(doc.blocks.length, 1, "expected exactly one block");
  assert.equal(doc.blocks[0].kind, "prose", "the single block must be prose");
  assert.equal(doc.blocks[0].md, "# My Plan\n\nDo the thing.\n", "raw text preserved verbatim");
  assert.equal(doc.meta.degraded, true, "meta.degraded must be true");
  assert.equal(doc.meta.revision, 1, "degraded doc is revision 1");
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.meta.status, "draft");
  assert.equal(doc.title, "My Plan", "title derived from first heading");
});

test("AC-7 degradeToProse output itself passes validateDocument", () => {
  const doc = degradeToProse("arbitrary unstructured agent text with no heading");
  const res = validateDocument(doc);
  assert.equal(res.ok, true, `degraded doc must validate, got ${JSON.stringify(res)}`);
  assert.equal(doc.title, "arbitrary unstructured agent text with no heading");
});

test("AC-7 degradeToProse is deterministic in shape with injected id/createdAt", () => {
  const a = degradeToProse("same text", { id: "fixed", createdAt: "2026-01-01T00:00:00Z" });
  const b = degradeToProse("same text", { id: "fixed", createdAt: "2026-01-01T00:00:00Z" });
  assert.deepEqual(a, b, "same input + injected id/createdAt must yield identical docs");
  assert.equal(a.id, "fixed");
  assert.equal(a.blocks[0].id, "fixed-prose-1");
});

test("AC-7 degradeToProse handles empty string", () => {
  const doc = degradeToProse("");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].md, "");
  assert.equal(doc.meta.degraded, true);
  assert.equal(validateDocument(doc).ok, true);
});

console.log("");
console.log(`Schema contract tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
