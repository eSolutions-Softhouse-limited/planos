/**
 * planos — R1 diff-ingestion parser contract tests (plain Node, zero deps).
 *
 * Covers Phase 3 Milestone R1 acceptance:
 *  - AC-R9:  src/review/ingest.mjs parses real unified-diff text (single &
 *            multi-file, multi-hunk, added/deleted/renamed/binary) into
 *            correct `diff` blocks — file path + status + per-hunk integer
 *            range fields + per-line op classification; deterministic
 *            `hunkId` minting (`<blockId>-h<n>`); binary/rename → empty-hunks
 *            block with the right status (R6); omitted-count hunk header →
 *            count defaults to 1; section heading after the 2nd `@@`;
 *            `\ No newline at end of file` folded away; oversized hunk →
 *            elision marker, parser does NOT throw. Re-ingesting the SAME
 *            diff yields deep-equal blocks (determinism). EVERY produced
 *            block validates clean inside a type:"diff-review" doc.
 *  - AC-R10 (static-purity half): the ingest.mjs source contains no
 *            child_process / require( / dynamic import( / fetch /
 *            node:net|dns|http reference.
 *
 * Mirrors tests/v3-schema.test.mjs / tests/v2-schema.test.mjs style.
 * Run: node tests/review-ingest.test.mjs   (or via node --test)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateDocument } from "../src/schema/validate.mjs";
import {
  ingestUnifiedDiff,
  MAX_LINES_PER_HUNK,
} from "../src/review/ingest.mjs";

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

/** Assert every block validates clean inside a type:"diff-review" doc (AC-R9). */
function assertAllValidate(blocks, label) {
  const res = validateDocument(reviewDoc(blocks));
  assert.equal(
    res.ok,
    true,
    `${label}: blocks must validate in a diff-review doc — errors: ${
      res.ok ? "" : JSON.stringify(res.errors)
    }`,
  );
}

// ───────────────────────────── fixtures ──────────────────────────────────

const SINGLE_FILE_MODIFY = `diff --git a/src/auth.js b/src/auth.js
index 1111111..2222222 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -1,4 +1,5 @@ function login(user)
 function login(user) {
-  return auth(user);
+  const t = mintToken(user);
+  return auth(user, t);
 }
`;

const MULTI_FILE_MULTI_HUNK = `diff --git a/a.js b/a.js
index aaa..bbb 100644
--- a/a.js
+++ b/a.js
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
 const b = 3;
@@ -10,3 +10,4 @@ section two
 line ten
 line eleven
+inserted line
 line twelve
diff --git a/b.py b/b.py
index ccc..ddd 100644
--- a/b.py
+++ b/b.py
@@ -5,2 +5,3 @@
 keep
+added
 keep2
`;

const ADDED_FILE = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+first new line
+second new line
`;

const DELETED_FILE = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index e69de29..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old line one
-old line two
`;

const RENAMED_NO_CONTENT = `diff --git a/old/name.js b/new/name.js
similarity index 100%
rename from old/name.js
rename to new/name.js
`;

const RENAMED_WITH_CONTENT = `diff --git a/old/path.js b/new/path.js
similarity index 87%
rename from old/path.js
rename to new/path.js
index 1234567..89abcde 100644
--- a/old/path.js
+++ b/new/path.js
@@ -1,3 +1,3 @@
 unchanged
-was this
+now this
 unchanged2
`;

const BINARY_FILE = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`;

// Both sides omit the ,count: git means count = 1 for each (`@@ -3 +3 @@`).
const OMITTED_COUNT = `diff --git a/single.txt b/single.txt
index 1111111..2222222 100644
--- a/single.txt
+++ b/single.txt
@@ -3 +3 @@
-only line
+only line changed
`;

const SECTION_HEADING = `diff --git a/big.c b/big.c
index 1111111..2222222 100644
--- a/big.c
+++ b/big.c
@@ -42,3 +42,4 @@ int compute_total(struct ctx *c)
 	int sum = 0;
+	int extra = 1;
 	for (int i = 0; i < c->n; i++)
 		sum += c->v[i];
`;

const NO_NEWLINE_EOF = `diff --git a/eof.txt b/eof.txt
index 1111111..2222222 100644
--- a/eof.txt
+++ b/eof.txt
@@ -1,2 +1,2 @@
 keep
-old last line
\\ No newline at end of file
+new last line
\\ No newline at end of file
`;

// ───────────────────────────── tests ─────────────────────────────────────

test("AC-R9 single-file single-hunk modify: path/status/integers/ops", () => {
  const blocks = ingestUnifiedDiff(SINGLE_FILE_MODIFY);
  assert.equal(blocks.length, 1);
  const b = blocks[0];
  assert.equal(b.id, "dr-1");
  assert.equal(b.kind, "diff");
  assert.equal(b.path, "src/auth.js");
  assert.equal(b.status, "modified");
  assert.deepEqual(b.comments, []);
  assert.equal(b.oldPath, undefined, "no oldPath unless renamed");
  assert.equal(b.hunks.length, 1);
  const h = b.hunks[0];
  assert.equal(h.header, "@@ -1,4 +1,5 @@ function login(user)");
  assert.equal(h.oldStart, 1);
  assert.equal(h.oldLines, 4);
  assert.equal(h.newStart, 1);
  assert.equal(h.newLines, 5);
  assert.equal(h.hunkId, "dr-1-h1");
  assert.deepEqual(
    h.lines.map((l) => l.op),
    [" ", "-", "+", "+", " "],
  );
  assert.equal(h.lines[1].text, "  return auth(user);");
  assert.equal(h.lines[2].text, "  const t = mintToken(user);");
  assertAllValidate(blocks, "single-file modify");
});

test("AC-R9 multi-file multi-hunk modify: per-file blocks + hunkIds", () => {
  const blocks = ingestUnifiedDiff(MULTI_FILE_MULTI_HUNK);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].path, "a.js");
  assert.equal(blocks[0].status, "modified");
  assert.equal(blocks[0].hunks.length, 2);
  assert.equal(blocks[0].hunks[0].hunkId, "dr-1-h1");
  assert.equal(blocks[0].hunks[1].hunkId, "dr-1-h2");
  assert.equal(
    blocks[0].hunks[1].header,
    "@@ -10,3 +10,4 @@ section two",
  );
  assert.equal(blocks[0].hunks[1].oldStart, 10);
  assert.equal(blocks[0].hunks[1].newLines, 4);
  assert.equal(blocks[1].path, "b.py");
  assert.equal(blocks[1].id, "dr-2");
  assert.equal(blocks[1].hunks[0].hunkId, "dr-2-h1");
  assertAllValidate(blocks, "multi-file multi-hunk");
});

test("AC-R9 added file (new file mode) ⇒ status:'added'", () => {
  const blocks = ingestUnifiedDiff(ADDED_FILE);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, "new.txt");
  assert.equal(blocks[0].status, "added");
  assert.equal(blocks[0].hunks.length, 1);
  assert.deepEqual(
    blocks[0].hunks[0].lines.map((l) => l.op),
    ["+", "+"],
  );
  assertAllValidate(blocks, "added file");
});

test("AC-R9 deleted file (deleted file mode) ⇒ status:'deleted', old path", () => {
  const blocks = ingestUnifiedDiff(DELETED_FILE);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, "gone.txt");
  assert.equal(blocks[0].status, "deleted");
  assert.equal(blocks[0].hunks.length, 1);
  assert.deepEqual(
    blocks[0].hunks[0].lines.map((l) => l.op),
    ["-", "-"],
  );
  assertAllValidate(blocks, "deleted file");
});

test("AC-R9 renamed file, no content change ⇒ oldPath + status:'renamed', empty hunks", () => {
  const blocks = ingestUnifiedDiff(RENAMED_NO_CONTENT);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].status, "renamed");
  assert.equal(blocks[0].path, "new/name.js");
  assert.equal(blocks[0].oldPath, "old/name.js");
  assert.deepEqual(blocks[0].hunks, [], "rename w/o content → empty hunks (R6)");
  assertAllValidate(blocks, "renamed no content");
});

test("AC-R9 renamed file WITH content change ⇒ oldPath + hunks present", () => {
  const blocks = ingestUnifiedDiff(RENAMED_WITH_CONTENT);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].status, "renamed");
  assert.equal(blocks[0].path, "new/path.js");
  assert.equal(blocks[0].oldPath, "old/path.js");
  assert.equal(blocks[0].hunks.length, 1);
  assert.equal(blocks[0].hunks[0].hunkId, "dr-1-h1");
  assert.deepEqual(
    blocks[0].hunks[0].lines.map((l) => l.op),
    [" ", "-", "+", " "],
  );
  assertAllValidate(blocks, "renamed with content");
});

test("AC-R9 binary file (Binary files differ) ⇒ status:'binary', empty hunks", () => {
  const blocks = ingestUnifiedDiff(BINARY_FILE);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, "logo.png");
  assert.equal(blocks[0].status, "binary");
  assert.deepEqual(blocks[0].hunks, [], "binary → empty hunks (R6)");
  assert.equal(blocks[0].oldPath, undefined);
  assertAllValidate(blocks, "binary file");
});

test("AC-R9 hunk header with omitted ,count ⇒ count defaults to 1", () => {
  const blocks = ingestUnifiedDiff(OMITTED_COUNT);
  const h = blocks[0].hunks[0];
  assert.equal(h.oldStart, 3);
  assert.equal(h.oldLines, 1, "omitted old ,count ⇒ 1");
  assert.equal(h.newStart, 3);
  assert.equal(h.newLines, 1, "omitted new ,count ⇒ 1");
  assertAllValidate(blocks, "omitted count");
});

test("AC-R9 section heading after 2nd @@ preserved verbatim in header", () => {
  const blocks = ingestUnifiedDiff(SECTION_HEADING);
  const h = blocks[0].hunks[0];
  assert.equal(
    h.header,
    "@@ -42,3 +42,4 @@ int compute_total(struct ctx *c)",
  );
  assert.equal(h.oldStart, 42);
  assert.equal(h.newLines, 4);
  // tab-indented body lines keep their content (minus the op char) verbatim
  assert.equal(h.lines[0].text, "\tint sum = 0;");
  assert.equal(h.lines[1].op, "+");
  assert.equal(h.lines[1].text, "\tint extra = 1;");
  assertAllValidate(blocks, "section heading");
});

test("AC-R9 '\\ No newline at end of file' folded away (not a DiffLine)", () => {
  const blocks = ingestUnifiedDiff(NO_NEWLINE_EOF);
  const h = blocks[0].hunks[0];
  // 3 real source lines only; the two `\ No newline` markers are folded.
  assert.deepEqual(
    h.lines.map((l) => l.op),
    [" ", "-", "+"],
  );
  assert.equal(h.lines[1].text, "old last line");
  assert.equal(h.lines[2].text, "new last line");
  assert.ok(
    !h.lines.some((l) => l.text.includes("No newline")),
    "no DiffLine carries the '\\ No newline' marker",
  );
  assertAllValidate(blocks, "no-newline EOF");
});

test("AC-R9 R6 size cap: oversized hunk ⇒ elision marker, no throw", () => {
  const cap = 5;
  const body = [];
  for (let i = 0; i < 50; i++) body.push(`+line ${i}`);
  const huge =
    `diff --git a/huge.txt b/huge.txt\n` +
    `new file mode 100644\n` +
    `index 0000000..aaaaaaa\n` +
    `--- /dev/null\n` +
    `+++ b/huge.txt\n` +
    `@@ -0,0 +1,50 @@\n` +
    body.join("\n") +
    `\n`;
  let blocks;
  assert.doesNotThrow(() => {
    blocks = ingestUnifiedDiff(huge, { maxLinesPerHunk: cap });
  }, "parser must NOT throw on an oversized hunk");
  const h = blocks[0].hunks[0];
  assert.equal(h.lines.length, cap + 1, "cap lines + 1 elision marker");
  const marker = h.lines[cap];
  assert.equal(marker.op, " ");
  assert.equal(
    marker.text,
    `… 45 lines elided (hunk exceeds cap of ${cap}) …`,
  );
  assertAllValidate(blocks, "oversized hunk elision");
});

test("AC-R9 default MAX_LINES_PER_HUNK is the documented sane default", () => {
  assert.equal(MAX_LINES_PER_HUNK, 2000);
});

test("AC-R9 custom idPrefix threads into block id + hunkId minting", () => {
  const blocks = ingestUnifiedDiff(SINGLE_FILE_MODIFY, { idPrefix: "rev7" });
  assert.equal(blocks[0].id, "rev7-1");
  assert.equal(blocks[0].hunks[0].hunkId, "rev7-1-h1");
  assertAllValidate(blocks, "custom idPrefix");
});

test("AC-R9 empty / non-string input ⇒ [] (degrade, never throw)", () => {
  assert.deepEqual(ingestUnifiedDiff(""), []);
  assert.deepEqual(ingestUnifiedDiff(undefined), []);
  assert.deepEqual(ingestUnifiedDiff(null), []);
  assert.deepEqual(ingestUnifiedDiff(42), []);
  assert.deepEqual(ingestUnifiedDiff("not a diff at all\njust text"), []);
});

test("AC-R9 DETERMINISM: re-ingesting the SAME diff ⇒ deep-equal blocks", () => {
  const a = ingestUnifiedDiff(MULTI_FILE_MULTI_HUNK);
  const b = ingestUnifiedDiff(MULTI_FILE_MULTI_HUNK);
  assert.deepEqual(a, b, "same diff ⇒ byte-identical (content-independent ids)");
  // also stable JSON serialization (byte-identical)
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("AC-R9 every block across ALL fixtures validates in a diff-review doc", () => {
  const all = [
    SINGLE_FILE_MODIFY,
    MULTI_FILE_MULTI_HUNK,
    ADDED_FILE,
    DELETED_FILE,
    RENAMED_NO_CONTENT,
    RENAMED_WITH_CONTENT,
    BINARY_FILE,
    OMITTED_COUNT,
    SECTION_HEADING,
    NO_NEWLINE_EOF,
  ];
  for (const fx of all) {
    const blocks = ingestUnifiedDiff(fx);
    assert.ok(blocks.length >= 1, "each fixture yields ≥1 block");
    assertAllValidate(blocks, "combined fixture");
  }
  // a single ingestion of the concatenated diff also validates as one doc
  const combined = ingestUnifiedDiff(all.join(""));
  assertAllValidate(combined, "concatenated multi-file diff");
});

test("AC-R10 (static-purity half) ingest.mjs source has no impure references", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/review/ingest.mjs", import.meta.url)),
    "utf8",
  );
  // Strip block & line comments so the purity-contract prose (which mentions
  // child_process / network by NAME to document their ABSENCE) does not cause
  // a false positive — we assert on the executable source only.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [
    "child_process",
    "node:net",
    "node:dns",
    "node:http",
    "node:https",
    "require(",
    "import(",
    "fetch(",
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `ingest.mjs executable source must not reference ${forbidden} (AC-R10 purity)`,
    );
  }
  // ZERO import statements at all (pure, node:-free — like structural.mjs).
  assert.ok(
    !/^\s*import\s/m.test(code),
    "ingest.mjs must have ZERO import statements (pure, no node: at all)",
  );
});

console.log("");
console.log(
  `R1 diff-ingestion parser tests: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
