/**
 * planos — PRD persistence layer tests (plain Node, zero dependencies).
 *
 * Covers Milestone P1 / AC-P9 + AC-P10 (diff half):
 *
 *   AC-P9:
 *     - saveRevision writes the D1 layout (rNNN.json + latest.json).
 *     - loadLatest / loadRevision / listRevisions round-trip byte-stable
 *       canonical JSON.
 *     - Append-only invariant: refuses to overwrite an existing revision number.
 *     - Path-traversal rejected for hostile docId ('..', separators, absolute).
 *
 *   AC-P10 (diff half):
 *     - Two successive saveRevision calls produce r001 + r002 with monotonic
 *       meta.revision and a shared doc id.
 *     - diffDocuments between the two revisions classifies blocks correctly via
 *       the existing structural diff engine.
 *
 * Uses mkdtemp for rootDir — never writes into the repo's real prds/ dir.
 *
 * Run: node --test tests/prd-store.test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  prdPath,
  loadLatest,
  loadRevision,
  listRevisions,
  saveRevision,
} from "../src/prd/store.mjs";

import { diffDocuments, DIFF_STATUS } from "../src/diff/structural.mjs";

// ---------------------------------------------------------------------------
// Test harness (mirrors diff.test.mjs / schema.test.mjs pattern)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
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
// Fixtures — minimal valid PRD documents for testing
// ---------------------------------------------------------------------------

/** Revision 1 of a PRD document. */
const DOC_R1 = {
  schemaVersion: 1,
  type: "prd",
  id: "prd-store-test-2026-05-16",
  title: "PRD Store Test",
  meta: {
    status: "draft",
    createdAt: "2026-05-16T10:00:00.000Z",
    revision: 1,
  },
  blocks: [
    {
      id: "blk-intro",
      kind: "prose",
      md: "Initial PRD content for the persistence test.",
    },
    {
      id: "blk-phase1",
      kind: "prose",
      md: "Phase one of the plan.",
    },
  ],
};

/** Revision 2 of the same PRD — same id, incremented revision, block modified. */
const DOC_R2 = {
  schemaVersion: 1,
  type: "prd",
  id: "prd-store-test-2026-05-16",
  title: "PRD Store Test",
  meta: {
    status: "draft",
    createdAt: "2026-05-16T11:00:00.000Z",
    revision: 2,
  },
  blocks: [
    {
      id: "blk-intro",
      kind: "prose",
      md: "Revised PRD content — updated after first review.",
    },
    {
      id: "blk-phase1",
      kind: "prose",
      md: "Phase one of the plan.",
    },
    {
      id: "blk-new",
      kind: "prose",
      md: "Newly added block in revision 2.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper: create a fresh temp directory as rootDir; clean up after each test.
// ---------------------------------------------------------------------------

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), "planos-prd-store-test-"));
}

function cleanTempRoot(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// AC-P9 — path-traversal rejection
// ---------------------------------------------------------------------------

test("prdPath: rejects docId with '..' component", () => {
  assert.throws(
    () => prdPath("/some/root", "../escape"),
    /\.\./,
    "should throw for '..' in docId",
  );
});

test("prdPath: rejects docId with forward slash", () => {
  assert.throws(
    () => prdPath("/some/root", "sub/dir"),
    /path separator/i,
    "should throw for '/' in docId",
  );
});

test("prdPath: rejects docId with backslash", () => {
  assert.throws(
    () => prdPath("/some/root", "sub\\dir"),
    /path separator/i,
    "should throw for '\\' in docId",
  );
});

test("prdPath: rejects absolute docId", () => {
  assert.throws(
    () => prdPath("/some/root", "/absolute/id"),
    /absolute/i,
    "should throw for absolute docId",
  );
});

test("prdPath: rejects empty docId", () => {
  assert.throws(
    () => prdPath("/some/root", ""),
    /non-empty/i,
    "should throw for empty docId",
  );
});

test("prdPath: accepts a valid flat docId", () => {
  const result = prdPath("/my/root", "some-prd-2026");
  assert.ok(
    result.endsWith("prds/some-prd-2026") ||
      result.endsWith("prds\\some-prd-2026"),
    `expected path ending with prds/some-prd-2026, got ${result}`,
  );
});

// ---------------------------------------------------------------------------
// AC-P9 — read from a missing dir returns null / []
// ---------------------------------------------------------------------------

test("loadLatest: returns null when the PRD dir does not exist", () => {
  const root = makeTempRoot();
  try {
    const result = loadLatest(root, "nonexistent-prd");
    assert.equal(result, null, "expected null for missing PRD dir");
  } finally {
    cleanTempRoot(root);
  }
});

test("loadRevision: returns null when the revision file does not exist", () => {
  const root = makeTempRoot();
  try {
    const result = loadRevision(root, "nonexistent-prd", 1);
    assert.equal(result, null, "expected null for missing revision file");
  } finally {
    cleanTempRoot(root);
  }
});

test("listRevisions: returns [] when the PRD dir does not exist", () => {
  const root = makeTempRoot();
  try {
    const result = listRevisions(root, "nonexistent-prd");
    assert.deepEqual(result, [], "expected [] for missing PRD dir");
  } finally {
    cleanTempRoot(root);
  }
});

// ---------------------------------------------------------------------------
// AC-P9 — saveRevision writes D1 layout + round-trip byte-stable canonical JSON
// ---------------------------------------------------------------------------

test("saveRevision: writes rNNN.json and latest.json with canonical JSON", () => {
  const root = makeTempRoot();
  try {
    const writtenPath = saveRevision(root, DOC_R1);

    // Written path should end with r001.json
    assert.ok(
      writtenPath.endsWith("r001.json"),
      `expected written path to end with r001.json, got ${writtenPath}`,
    );

    // Both r001.json and latest.json should exist and be parseable.
    const dir = prdPath(root, DOC_R1.id);
    const r001Raw = readFileSync(join(dir, "r001.json"), "utf8");
    const latestRaw = readFileSync(join(dir, "latest.json"), "utf8");

    // Both files must contain identical content.
    assert.equal(r001Raw, latestRaw, "r001.json and latest.json must be identical");

    // Must parse back to an object with matching id and revision.
    const r001Doc = JSON.parse(r001Raw);
    assert.equal(r001Doc.id, DOC_R1.id, "round-tripped id matches");
    assert.equal(r001Doc.meta.revision, 1, "round-tripped revision is 1");

    // Canonical JSON: writing the same doc a second time (in a fresh temp dir)
    // must yield byte-identical output — key order invariance.
    const root2 = makeTempRoot();
    try {
      saveRevision(root2, DOC_R1);
      const dir2 = prdPath(root2, DOC_R1.id);
      const r001Raw2 = readFileSync(join(dir2, "r001.json"), "utf8");
      assert.equal(
        r001Raw,
        r001Raw2,
        "canonical JSON is byte-identical across two writes of the same doc",
      );
    } finally {
      cleanTempRoot(root2);
    }
  } finally {
    cleanTempRoot(root);
  }
});

test("saveRevision: byte-stable even when source object has different key order", () => {
  const root = makeTempRoot();
  try {
    // Construct a version of DOC_R1 with deliberately shuffled key order.
    const shuffled = {
      blocks: DOC_R1.blocks,
      title: DOC_R1.title,
      id: DOC_R1.id,
      meta: { revision: DOC_R1.meta.revision, createdAt: DOC_R1.meta.createdAt, status: DOC_R1.meta.status },
      schemaVersion: DOC_R1.schemaVersion,
      type: DOC_R1.type,
    };

    const root2 = makeTempRoot();
    try {
      saveRevision(root, DOC_R1);
      saveRevision(root2, shuffled);

      const dir1 = prdPath(root, DOC_R1.id);
      const dir2 = prdPath(root2, shuffled.id);
      const raw1 = readFileSync(join(dir1, "r001.json"), "utf8");
      const raw2 = readFileSync(join(dir2, "r001.json"), "utf8");

      assert.equal(
        raw1,
        raw2,
        "canonical JSON is byte-identical regardless of source key order",
      );
    } finally {
      cleanTempRoot(root2);
    }
  } finally {
    cleanTempRoot(root);
  }
});

// ---------------------------------------------------------------------------
// AC-P9 — append-only invariant
// ---------------------------------------------------------------------------

test("saveRevision: throws if the same revision number already exists", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    assert.throws(
      () => saveRevision(root, DOC_R1),
      /append-only/i,
      "should throw with an append-only message on duplicate revision",
    );
  } finally {
    cleanTempRoot(root);
  }
});

// ---------------------------------------------------------------------------
// AC-P9 — loadLatest + loadRevision + listRevisions after a write
// ---------------------------------------------------------------------------

test("loadLatest: returns { doc, revision } after saveRevision", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    const result = loadLatest(root, DOC_R1.id);
    assert.ok(result !== null, "expected non-null result from loadLatest");
    assert.equal(result.revision, 1, "revision should be 1");
    assert.equal(result.doc.id, DOC_R1.id, "id round-trips correctly");
    assert.equal(result.doc.meta.revision, 1, "meta.revision is 1");
  } finally {
    cleanTempRoot(root);
  }
});

test("loadRevision: retrieves a specific revision by number", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    const doc = loadRevision(root, DOC_R1.id, 1);
    assert.ok(doc !== null, "expected non-null from loadRevision(1)");
    assert.equal(doc.id, DOC_R1.id);
    assert.equal(doc.meta.revision, 1);
  } finally {
    cleanTempRoot(root);
  }
});

test("loadRevision: returns null for a revision number that does not exist", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    const doc = loadRevision(root, DOC_R1.id, 99);
    assert.equal(doc, null, "expected null for nonexistent revision 99");
  } finally {
    cleanTempRoot(root);
  }
});

test("listRevisions: returns newest-first after two saves", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    saveRevision(root, DOC_R2);
    const revs = listRevisions(root, DOC_R1.id);
    assert.equal(revs.length, 2, "expected 2 revisions");
    assert.equal(revs[0].revision, 2, "newest first — revision 2");
    assert.equal(revs[1].revision, 1, "second entry — revision 1");
    assert.equal(
      revs[0].createdAt,
      DOC_R2.meta.createdAt,
      "createdAt from doc.meta.createdAt",
    );
    assert.equal(revs[1].createdAt, DOC_R1.meta.createdAt);
  } finally {
    cleanTempRoot(root);
  }
});

test("loadLatest: returns revision 2 after two saves", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    saveRevision(root, DOC_R2);
    const result = loadLatest(root, DOC_R2.id);
    assert.ok(result !== null);
    assert.equal(result.revision, 2, "latest should be revision 2");
    assert.equal(result.doc.meta.revision, 2);
  } finally {
    cleanTempRoot(root);
  }
});

// ---------------------------------------------------------------------------
// AC-P10 (diff half) — structural diff between r001 and r002
// ---------------------------------------------------------------------------

test("AC-P10: two revisions share doc id, meta.revision is monotonic", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    saveRevision(root, DOC_R2);

    const r1 = loadRevision(root, DOC_R1.id, 1);
    const r2 = loadRevision(root, DOC_R2.id, 2);

    assert.ok(r1 !== null, "r001 loads");
    assert.ok(r2 !== null, "r002 loads");

    // Same stable doc id.
    assert.equal(r1.id, r2.id, "both revisions share the same doc id");

    // Monotonic: r2.meta.revision > r1.meta.revision.
    assert.ok(
      r2.meta.revision > r1.meta.revision,
      `revision 2 (${r2.meta.revision}) should be > revision 1 (${r1.meta.revision})`,
    );
  } finally {
    cleanTempRoot(root);
  }
});

test("AC-P10: diffDocuments between r001 and r002 classifies blocks correctly", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    saveRevision(root, DOC_R2);

    const r1 = loadRevision(root, DOC_R1.id, 1);
    const r2 = loadRevision(root, DOC_R2.id, 2);

    const { blocks, byId } = diffDocuments(r1, r2);

    // blk-intro: content changed → modified.
    assert.ok(byId["blk-intro"] !== undefined, "blk-intro present in diff");
    assert.equal(
      byId["blk-intro"].status,
      DIFF_STATUS.MODIFIED,
      "blk-intro is modified (md text changed)",
    );

    // blk-phase1: identical content, same position → unchanged.
    assert.ok(byId["blk-phase1"] !== undefined, "blk-phase1 present in diff");
    assert.equal(
      byId["blk-phase1"].status,
      DIFF_STATUS.UNCHANGED,
      "blk-phase1 is unchanged",
    );

    // blk-new: added in r2, absent in r1 → added.
    assert.ok(byId["blk-new"] !== undefined, "blk-new present in diff");
    assert.equal(
      byId["blk-new"].status,
      DIFF_STATUS.ADDED,
      "blk-new is added",
    );

    // Total: 3 blocks in next (2 carried + 1 added) + 0 removed.
    const statuses = blocks.map((b) => b.status);
    assert.equal(
      statuses.filter((s) => s === DIFF_STATUS.ADDED).length,
      1,
      "one added block",
    );
    assert.equal(
      statuses.filter((s) => s === DIFF_STATUS.MODIFIED).length,
      1,
      "one modified block",
    );
    assert.equal(
      statuses.filter((s) => s === DIFF_STATUS.UNCHANGED).length,
      1,
      "one unchanged block",
    );
    assert.equal(
      statuses.filter((s) => s === DIFF_STATUS.REMOVED).length,
      0,
      "zero removed blocks",
    );
  } finally {
    cleanTempRoot(root);
  }
});

test("AC-P10: fieldDiffs on the modified block cover the changed prose.md field", () => {
  const root = makeTempRoot();
  try {
    saveRevision(root, DOC_R1);
    saveRevision(root, DOC_R2);

    const r1 = loadRevision(root, DOC_R1.id, 1);
    const r2 = loadRevision(root, DOC_R2.id, 2);

    const { byId } = diffDocuments(r1, r2);
    const modified = byId["blk-intro"];

    assert.ok(
      Array.isArray(modified.fieldDiffs) && modified.fieldDiffs.length > 0,
      "modified block has fieldDiffs",
    );
    const mdDiff = modified.fieldDiffs.find((fd) => fd.field === "md");
    assert.ok(
      mdDiff !== undefined,
      "fieldDiffs includes the 'md' text-bearing field",
    );
    // The word diff must produce both removed and added runs.
    const types = mdDiff.runs.map((r) => r.type);
    assert.ok(types.includes("removed"), "word diff has 'removed' runs");
    assert.ok(types.includes("added"), "word diff has 'added' runs");
  } finally {
    cleanTempRoot(root);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log(
  `PRD persistence layer tests (Milestone P1 — AC-P9 + AC-P10 diff half): ${passed} passed, ${failed} failed`,
);
console.log("");

if (failed > 0) process.exit(1);
