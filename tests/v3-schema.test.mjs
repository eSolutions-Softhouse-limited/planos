/**
 * planos — v3 diff-review schema contract tests (plain Node, zero deps).
 *
 * Covers Phase 3 Milestone R0 acceptance:
 *  - AC-R1: validator ACCEPTS a well-formed `diff` block (path, hunks:Hunk[],
 *           comments:BlockComment[], optional status/oldPath, incl. an
 *           empty-hunks binary/renamed stub — R6) with valid nested
 *           Hunk/DiffLine/BlockComment shapes, and REJECTS each malformed
 *           shape (bad `op` enum, non-integer `oldStart`, missing `hunkId`,
 *           bad `verdict` enum, non-string `text`) with a field-level error
 *           string suitable for the deny→revise preamble (asserts on the
 *           exact error-path text). Mirrors tests/v2-schema.test.mjs.
 *  - AC-R2: doc-type gating — a type:"plan" OR type:"prd" doc containing a
 *           `diff` block is REJECTED; a type:"diff-review" doc accepts the
 *           v1∪v3 allowed-kind set (R7) and REJECTS v2 PRD kinds.
 *  - AC-R3: degradeToProse still produces exactly ONE prose block +
 *           meta.degraded=true for malformed diff-review input, with `type`
 *           preserved as "diff-review" (degradeOpts.type).
 *
 * Run: node tests/v3-schema.test.mjs
 */

import assert from "node:assert/strict";
import {
  validateDocument,
  V2_KINDS,
  V3_KINDS,
} from "../src/schema/validate.mjs";
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

/** Wrap a list of blocks in a minimal valid type:"diff-review" document. */
function reviewDoc(blocks) {
  return {
    schemaVersion: 1,
    type: "diff-review",
    id: "review-abc-123",
    title: "Review PR #42",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks,
  };
}

/** A well-formed Hunk with one of each DiffLine op. */
const validHunk = {
  header: "@@ -1,3 +1,4 @@ function login(user)",
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [
    { op: " ", text: "function login(user) {" },
    { op: "-", text: "  return auth(user);" },
    { op: "+", text: "  const t = mintToken(user);" },
    { op: "+", text: "  return auth(user, t);" },
    { op: " ", text: "}" },
    { op: " ", text: "" },
  ],
  hunkId: "blk-1-h0",
};

/** A hand-written valid type:"diff-review" doc exercising v3 + v1 kinds. */
const validReview = reviewDoc([
  { id: "s0", kind: "section", title: "Review of PR #42", level: 1 },
  { id: "p0", kind: "prose", md: "Overall the change looks reasonable." },
  {
    id: "blk-1",
    kind: "diff",
    path: "src/auth/login.mjs",
    status: "modified",
    hunks: [validHunk],
    comments: [
      {
        commentId: "blk-1-c0",
        hunkId: "blk-1-h0",
        text: "Token minting should be wrapped in try/catch.",
        verdict: "comment",
      },
      {
        commentId: "blk-1-c1",
        hunkId: null,
        text: "File-level: rename this module to session.mjs eventually.",
        verdict: "accept",
      },
    ],
  },
  {
    id: "blk-2",
    kind: "diff",
    path: "assets/logo.png",
    status: "binary",
    hunks: [],
    comments: [],
  },
  {
    id: "blk-3",
    kind: "diff",
    path: "src/auth/session.mjs",
    status: "renamed",
    oldPath: "src/auth/sess.mjs",
    hunks: [],
    comments: [],
  },
  { id: "q0", kind: "openQuestion", question: "Is the token TTL configurable?" },
]);

// ---------------------------------------------------------------------------
// AC-R1: accept valid v3 shapes
// ---------------------------------------------------------------------------

test("AC-R1 accepts a valid type:'diff-review' doc covering v3 + v1 kinds", () => {
  const res = validateDocument(validReview);
  assert.equal(res.ok, true, `expected ok:true, got ${JSON.stringify(res)}`);
  assert.ok(res.doc, "expected res.doc on success");
  const kinds = new Set(validReview.blocks.map((b) => b.kind));
  for (const k of V3_KINDS) {
    assert.ok(kinds.has(k), `fixture should exercise v3 kind '${k}'`);
  }
});

test("AC-R1 accepts an empty-hunks binary stub (R6)", () => {
  const res = validateDocument(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "img/x.png",
        status: "binary",
        hunks: [],
        comments: [],
      },
    ]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-R1 accepts an empty-hunks renamed stub with oldPath (R6)", () => {
  const res = validateDocument(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "src/new.mjs",
        status: "renamed",
        oldPath: "src/old.mjs",
        hunks: [],
        comments: [],
      },
    ]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-R1 accepts a diff with NO status/oldPath (both optional)", () => {
  const res = validateDocument(
    reviewDoc([
      { id: "b", kind: "diff", path: "a.txt", hunks: [validHunk], comments: [] },
    ]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-R1 accepts each diff status enum value", () => {
  for (const status of ["added", "modified", "deleted", "renamed", "binary"]) {
    const res = validateDocument(
      reviewDoc([
        { id: "b", kind: "diff", path: "a.txt", status, hunks: [], comments: [] },
      ]),
    );
    assert.equal(res.ok, true, `status '${status}' must be valid`);
  }
});

test("AC-R1 accepts a DiffLine with empty text (isString, not nonEmpty)", () => {
  const res = validateDocument(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@ -1 +1 @@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            lines: [{ op: " ", text: "" }],
            hunkId: "b-h0",
          },
        ],
        comments: [],
      },
    ]),
  );
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("AC-R1 accepts each BlockComment verdict enum value", () => {
  for (const verdict of ["accept", "reject", "comment"]) {
    const res = validateDocument(
      reviewDoc([
        {
          id: "b",
          kind: "diff",
          path: "a.txt",
          hunks: [],
          comments: [
            { commentId: "c0", hunkId: null, text: "note", verdict },
          ],
        },
      ]),
    );
    assert.equal(res.ok, true, `verdict '${verdict}' must be valid`);
  }
});

// ---------------------------------------------------------------------------
// AC-R1: reject each malformed v3 shape with a field-level error string
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

test("AC-R1 rejects diff missing required 'path'", () => {
  expectError(
    reviewDoc([{ id: "b", kind: "diff", hunks: [], comments: [] }]),
    "blocks[0].path is required and must be a non-empty string",
    "diff missing path",
  );
});

test("AC-R1 rejects diff missing required 'hunks'", () => {
  expectError(
    reviewDoc([{ id: "b", kind: "diff", path: "a.txt", comments: [] }]),
    "blocks[0] (diff) missing required field 'hunks' (Hunk[], may be empty for a binary/rename stub) — got undefined",
    "diff missing hunks",
  );
});

test("AC-R1 rejects diff missing required 'comments'", () => {
  expectError(
    reviewDoc([{ id: "b", kind: "diff", path: "a.txt", hunks: [] }]),
    "blocks[0] (diff) missing required field 'comments' (BlockComment[], may be empty) — got undefined",
    "diff missing comments",
  );
});

test("AC-R1 rejects diff with invalid status enum", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        status: "moved",
        hunks: [],
        comments: [],
      },
    ]),
    "blocks[0].status 'moved' is not a valid value (expected one of added|modified|deleted|renamed|binary)",
    "diff bad status",
  );
});

test("AC-R1 rejects diff with non-string oldPath", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        oldPath: 7,
        hunks: [],
        comments: [],
      },
    ]),
    "blocks[0] (diff) optional field 'oldPath' must be a string when present but is 7",
    "diff bad oldPath",
  );
});

test("AC-R1 rejects Hunk missing required 'header'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: [], hunkId: "h0" },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].header is required and must be a non-empty string",
    "hunk missing header",
  );
});

test("AC-R1 rejects Hunk with non-integer 'oldStart'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: "1",
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            lines: [],
            hunkId: "h0",
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].oldStart is required and must be an integer but is '1'",
    "hunk non-integer oldStart",
  );
});

test("AC-R1 rejects Hunk with negative 'oldLines' (must be >= 0)", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: 1,
            oldLines: -2,
            newStart: 1,
            newLines: 0,
            lines: [],
            hunkId: "h0",
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].oldLines must be an integer >= 0 but is -2",
    "hunk negative oldLines",
  );
});

test("AC-R1 rejects Hunk missing required 'hunkId'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            lines: [],
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].hunkId is required and must be a non-empty string (the stable per-hunk anchor) but is undefined",
    "hunk missing hunkId",
  );
});

test("AC-R1 rejects Hunk missing required 'lines'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            hunkId: "h0",
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0] (Hunk) missing required field 'lines' (DiffLine[]) — got undefined",
    "hunk missing lines",
  );
});

test("AC-R1 rejects DiffLine with invalid 'op' enum", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            lines: [{ op: "~", text: "x" }],
            hunkId: "h0",
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].lines[0].op '~' is not a valid value (expected one of  |+|-)",
    "diffline bad op",
  );
});

test("AC-R1 rejects DiffLine with non-string 'text'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [
          {
            header: "@@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 0,
            lines: [{ op: " ", text: 42 }],
            hunkId: "h0",
          },
        ],
        comments: [],
      },
    ]),
    "blocks[0].hunks[0].lines[0] (DiffLine) missing required field 'text' (string, may be empty) — got 42",
    "diffline non-string text",
  );
});

test("AC-R1 rejects BlockComment missing 'commentId'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [],
        comments: [{ hunkId: null, text: "x", verdict: "accept" }],
      },
    ]),
    "blocks[0].comments[0].commentId is required and must be a non-empty string (stable) but is undefined",
    "comment missing commentId",
  );
});

test("AC-R1 rejects BlockComment with non-string non-null 'hunkId'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [],
        comments: [{ commentId: "c0", hunkId: 9, text: "x", verdict: "accept" }],
      },
    ]),
    "blocks[0].comments[0].hunkId is required and must be a string (the Hunk.hunkId) or null (file-level comment) but is 9",
    "comment bad hunkId",
  );
});

test("AC-R1 rejects BlockComment missing 'text'", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [],
        comments: [{ commentId: "c0", hunkId: null, verdict: "accept" }],
      },
    ]),
    "blocks[0].comments[0].text is required and must be a non-empty string",
    "comment missing text",
  );
});

test("AC-R1 rejects BlockComment with invalid 'verdict' enum", () => {
  expectError(
    reviewDoc([
      {
        id: "b",
        kind: "diff",
        path: "a.txt",
        hunks: [],
        comments: [
          { commentId: "c0", hunkId: null, text: "x", verdict: "approve" },
        ],
      },
    ]),
    "blocks[0].comments[0].verdict 'approve' is not a valid value (expected one of accept|reject|comment)",
    "comment bad verdict",
  );
});

// ---------------------------------------------------------------------------
// AC-R2: v3 `diff` is diff-review-scoped (R7, mirror of D5(i))
// ---------------------------------------------------------------------------

function planWith(blocks) {
  return {
    schemaVersion: 1,
    type: "plan",
    id: "plan-1",
    title: "Plan that smuggles a diff",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks,
  };
}

function prdWith(blocks) {
  return {
    schemaVersion: 1,
    type: "prd",
    id: "prd-1",
    title: "PRD that smuggles a diff",
    meta: { status: "draft", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
    blocks,
  };
}

test("AC-R2 a type:'plan' doc containing a 'diff' block is REJECTED", () => {
  const res = validateDocument(
    planWith([{ id: "x", kind: "diff", path: "a.txt", hunks: [], comments: [] }]),
  );
  assert.equal(res.ok, false, "diff must be rejected in a plan");
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes("blocks[0].kind 'diff' is a v3 diff-review-only kind") &&
        e.includes("type:'plan'") &&
        e.includes("the 'diff' kind requires type:'diff-review'"),
    ),
    `expected a diff-review-scoping field-level error, got: ${res.errors.join(
      " || ",
    )}`,
  );
});

test("AC-R2 a type:'prd' doc containing a 'diff' block is REJECTED", () => {
  const res = validateDocument(
    prdWith([{ id: "x", kind: "diff", path: "a.txt", hunks: [], comments: [] }]),
  );
  assert.equal(res.ok, false, "diff must be rejected in a prd");
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes("blocks[0].kind 'diff' is a v3 diff-review-only kind") &&
        e.includes("type:'prd'") &&
        e.includes("the 'diff' kind requires type:'diff-review'"),
    ),
    `expected a diff-review-scoping field-level error, got: ${res.errors.join(
      " || ",
    )}`,
  );
});

test("AC-R2 a type:'diff-review' doc REJECTS every v2 PRD kind (R7)", () => {
  for (const kind of V2_KINDS) {
    const res = validateDocument(reviewDoc([{ id: "x", kind }]));
    assert.equal(
      res.ok,
      false,
      `v2 kind '${kind}' must be rejected in a diff-review doc`,
    );
    assert.ok(
      res.errors.some(
        (e) =>
          e.includes(`blocks[0].kind '${kind}' is a v2 PRD-only kind`) &&
          e.includes("type:'diff-review'") &&
          e.includes("v2 kinds require type:'prd'"),
      ),
      `expected a v2-rejection field-level error for '${kind}', got: ${res.errors.join(
        " || ",
      )}`,
    );
  }
});

test("AC-R2 a type:'diff-review' doc accepts v1 ∪ v3 kinds", () => {
  const v1InReview = reviewDoc([
    { id: "s1", kind: "section", title: "Summary", level: 1 },
    { id: "p1", kind: "prose", md: "narrative" },
    { id: "q1", kind: "openQuestion", question: "ship it?" },
    {
      id: "t1",
      kind: "task",
      title: "Address comment",
      status: "todo",
      deps: [],
      acceptance: ["fixed"],
    },
  ]);
  assert.equal(
    validateDocument(v1InReview).ok,
    true,
    "type:'diff-review' must accept v1 kinds",
  );
  assert.equal(
    validateDocument(validReview).ok,
    true,
    "type:'diff-review' accepts v1∪v3",
  );
});

test("AC-R2 invalid-kind message reflects v1∪v3 for type:'diff-review'", () => {
  const res = validateDocument(reviewDoc([{ id: "x", kind: "totallyBogus" }]));
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes(
          "blocks[0].kind 'totallyBogus' is not a valid v1∪v3 kind",
        ) &&
        e.includes("section") &&
        e.includes("diff"),
    ),
    `expected a v1∪v3 invalid-kind message, got: ${res.errors.join(" || ")}`,
  );
});

test("AC-R2 plan-mode v1 + PRD v1∪v2 unaffected (no Phase-1/2 regression)", () => {
  const plan = planWith([{ id: "p", kind: "prose", md: "still works" }]);
  assert.equal(validateDocument(plan).ok, true, "v1 plan must still validate");
  const prd = prdWith([
    { id: "p", kind: "prose", md: "prd prose" },
    { id: "ph", kind: "phase", title: "P1", taskIds: [] },
  ]);
  assert.equal(
    validateDocument(prd).ok,
    true,
    "type:'prd' must still accept v1∪v2",
  );
  // v3 diff still rejected in a PRD (the PRD invalid path message stays v1∪v2).
  const res = validateDocument(prdWith([{ id: "z", kind: "bogusXYZ" }]));
  assert.ok(
    res.errors.some((e) =>
      e.includes("blocks[0].kind 'bogusXYZ' is not a valid v1∪v2 kind"),
    ),
    `PRD invalid-kind message must stay v1∪v2, got: ${res.errors.join(" || ")}`,
  );
});

// ---------------------------------------------------------------------------
// AC-R3: degradeToProse on malformed diff-review input (type preserved)
// ---------------------------------------------------------------------------

test("AC-R3 degradeToProse on malformed diff-review input ⇒ 1 prose + degraded, type preserved", () => {
  const doc = degradeToProse(
    "## Review of PR #42\n\n{ malformed not-a-doc v3 garbage",
    { type: "diff-review" },
  );
  assert.equal(doc.blocks.length, 1, "exactly one block");
  assert.equal(doc.blocks[0].kind, "prose", "the single block must be prose");
  assert.equal(doc.meta.degraded, true, "meta.degraded must be true");
  assert.equal(doc.meta.revision, 1, "degraded doc is revision 1");
  assert.equal(
    doc.type,
    "diff-review",
    "type must be preserved as 'diff-review' (degradeOpts.type)",
  );
  assert.equal(
    validateDocument(doc).ok,
    true,
    "degraded diff-review fallback must itself validate (prose is v1, allowed)",
  );
});

test("AC-R3 degradeToProse is deterministic for the diff-review path", () => {
  const a = degradeToProse("bad review text", {
    id: "fixed",
    createdAt: "2026-01-01T00:00:00Z",
    type: "diff-review",
  });
  const b = degradeToProse("bad review text", {
    id: "fixed",
    createdAt: "2026-01-01T00:00:00Z",
    type: "diff-review",
  });
  assert.deepEqual(a, b, "same input + injected id/createdAt ⇒ identical docs");
});

console.log("");
console.log(`v3 diff-review schema contract tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
