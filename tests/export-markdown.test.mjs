/**
 * planos — Q0 markdown-export serializer contract tests (plain Node, zero deps).
 *
 * Covers Phase 4 Milestone Q0 acceptance:
 *  - AC-Q4:  src/export/markdown.mjs serializes a document containing ALL 14
 *            v1∪v2∪v3 kinds (section/prose/objective/task/decision/risk/
 *            openQuestion + phase/tradeoff/fileChange/code/table/diagram +
 *            diff) to deterministic, byte-stable markdown — every kind has a
 *            defined rendering; same input → byte-identical output ×2; an
 *            empty/degraded doc serializes WITHOUT throwing.
 *  - AC-Q5:  the markdown.mjs source contains ZERO imports and no
 *            child_process / require( / dynamic import( / fetch / node:
 *            reference (static-purity scan, mirroring the src/review/
 *            ingest.mjs purity test, comment-stripped).
 *
 * Mirrors tests/review-ingest.test.mjs style.
 * Run: node tests/export-markdown.test.mjs   (or via node --test)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeMarkdown } from "../src/export/markdown.mjs";

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

// ───────────────────────────── fixtures ──────────────────────────────────

/** A document exercising ALL 14 v1∪v2∪v3 block kinds. */
const ALL_KINDS_DOC = {
  schemaVersion: 1,
  type: "prd",
  id: "doc-all-kinds-1",
  title: "Everything Document",
  meta: {
    status: "in-review",
    createdAt: "2026-05-16T00:00:00Z",
    revision: 7,
    branch: "feature/x",
  },
  blocks: [
    { id: "s1", kind: "section", title: "Overview", level: 2 },
    { id: "s2", kind: "section", title: "Too Deep", level: 99 },
    { id: "p1", kind: "prose", md: "Some **markdown** prose.\nSecond line." },
    {
      id: "o1",
      kind: "objective",
      text: "Ship the serializer",
      successCriteria: ["byte-stable", "all 14 kinds", "never throws"],
    },
    {
      id: "t1",
      kind: "task",
      title: "Write the module",
      detail: "pure, zero imports",
      status: "doing",
      deps: ["t0"],
      acceptance: ["AC-Q4 green", "AC-Q5 green"],
      estimate: "2h",
    },
    {
      id: "t2",
      kind: "task",
      title: "Done task",
      status: "done",
      deps: [],
      acceptance: [],
    },
    {
      id: "t3",
      kind: "task",
      title: "Cut task",
      status: "cut",
      deps: [],
      acceptance: [],
    },
    {
      id: "d1",
      kind: "decision",
      question: "Which serializer boundary?",
      options: [
        { label: "pure module", pros: ["AC-17 clean"], cons: ["none"] },
        { label: "inside handler", pros: [], cons: ["expands audited surface"] },
      ],
      chosen: "pure module",
      rationale: "Phase-3-R1 doctrine applied post-server.",
    },
    {
      id: "r1",
      kind: "risk",
      description: "Export placed in blocking path",
      likelihood: "M",
      impact: "H",
      mitigation: "negative AC-17 assertion (AC-Q12)",
    },
    {
      id: "q1",
      kind: "openQuestion",
      question: "Is the CLI surface in?",
      answer: "Yes — out-of-blocking-path.",
    },
    {
      id: "q2",
      kind: "openQuestion",
      question: "Unanswered question?",
    },
    {
      id: "ph1",
      kind: "phase",
      title: "Phase Q0",
      taskIds: ["t1", "t2"],
    },
    {
      id: "tr1",
      kind: "tradeoff",
      axis: "serializer boundary",
      options: [
        { label: "pure", score: 9, note: "best" },
        { label: "coupled", score: 2, note: "rejected" },
      ],
    },
    {
      id: "fc1",
      kind: "fileChange",
      path: "src/export/markdown.mjs",
      action: "add",
      rationale: "the canonical serializer",
    },
    {
      id: "c1",
      kind: "code",
      lang: "js",
      content: "export function serializeMarkdown(doc) {}",
      filename: "markdown.mjs",
    },
    {
      id: "tb1",
      kind: "table",
      columns: ["Kind", "Output"],
      rows: [
        ["section", "ATX heading"],
        ["pipe|cell", "escaped"],
      ],
    },
    {
      id: "dg1",
      kind: "diagram",
      mermaid: "graph TD; A-->B;",
    },
    {
      id: "df1",
      kind: "diff",
      path: "src/auth.js",
      status: "modified",
      hunks: [
        {
          header: "@@ -1,3 +1,4 @@ function login()",
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [
            { op: " ", text: "function login() {" },
            { op: "-", text: "  return a;" },
            { op: "+", text: "  const t = mint();" },
            { op: "+", text: "  return a, t;" },
          ],
          hunkId: "df1-h1",
        },
      ],
      comments: [
        { commentId: "df1-c1", hunkId: "df1-h1", text: "looks good", verdict: "accept" },
        { commentId: "df1-c2", hunkId: null, text: "file-level note", verdict: "comment" },
      ],
    },
    {
      id: "df2",
      kind: "diff",
      path: "logo.png",
      status: "binary",
      hunks: [],
      comments: [],
    },
    {
      id: "df3",
      kind: "diff",
      path: "new/name.js",
      oldPath: "old/name.js",
      status: "renamed",
      hunks: [],
      comments: [],
    },
  ],
};

/** A degraded doc: one prose block, meta.degraded (the fallback shape). */
const DEGRADED_DOC = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-degraded-1",
  title: "Unstructured Plan",
  meta: {
    status: "draft",
    createdAt: "2026-05-16T00:00:00Z",
    revision: 1,
    degraded: true,
  },
  blocks: [{ id: "b1", kind: "prose", md: "raw unstructured text" }],
};

// ───────────────────────────── tests ─────────────────────────────────────

test("AC-Q4 document title → H1 + meta header line", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.startsWith("# Everything Document\n"), "title is an H1");
  assert.ok(
    md.includes("_revision 7 · status: in-review · branch: feature/x_"),
    "meta header rendered",
  );
  assert.ok(md.endsWith("\n"), "trailing newline (POSIX-clean)");
});

test("AC-Q4 section → ATX heading; level clamped 1–6", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("\n## Overview\n"), "level 2 → ##");
  assert.ok(md.includes("\n###### Too Deep\n"), "level 99 clamped → ######");
});

test("AC-Q4 prose → md verbatim", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("Some **markdown** prose.\nSecond line."));
});

test("AC-Q4 objective → bold text + success-criteria list", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**Ship the serializer**"));
  assert.ok(md.includes("- byte-stable"));
  assert.ok(md.includes("- all 14 kinds"));
  assert.ok(md.includes("- never throws"));
});

test("AC-Q4 task → checkbox states + detail/deps/acceptance/estimate", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("- [ ] Write the module"), "doing → [ ]");
  assert.ok(md.includes("- [x] Done task"), "done → [x]");
  assert.ok(
    md.includes("- [~] ~~Cut task~~"),
    "cut → [~] + strikethrough title",
  );
  assert.ok(md.includes("pure, zero imports"), "detail rendered");
  assert.ok(md.includes("- Deps: `t0`"), "deps rendered");
  assert.ok(md.includes("- Acceptance:"), "acceptance label");
  assert.ok(md.includes("    - AC-Q4 green"), "acceptance items nested");
  assert.ok(md.includes("- Estimate: 2h"), "estimate rendered");
});

test("AC-Q4 decision → ADR-style block with chosen option highlighted", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**Decision:** Which serializer boundary?"));
  assert.ok(md.includes("**Options:**"));
  assert.ok(
    md.includes("- **pure module** ✓ (chosen)"),
    "chosen option highlighted",
  );
  assert.ok(md.includes("  - Pro: AC-17 clean"));
  assert.ok(md.includes("  - Con: expands audited surface"));
  assert.ok(
    md.includes("**Rationale:** Phase-3-R1 doctrine applied post-server."),
  );
});

test("AC-Q4 risk → GFM single-row table", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("| Risk | Likelihood | Impact | Mitigation |"));
  assert.ok(md.includes("| --- | --- | --- | --- |"));
  assert.ok(
    md.includes(
      "| Export placed in blocking path | M | H | negative AC-17 assertion (AC-Q12) |",
    ),
  );
});

test("AC-Q4 openQuestion → > **Q:** / > **A:** blockquote", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("> **Q:** Is the CLI surface in?"));
  assert.ok(md.includes("> **A:** Yes — out-of-blocking-path."));
  assert.ok(
    md.includes("> **Q:** Unanswered question?"),
    "unanswered Q still rendered",
  );
});

test("AC-Q4 phase → heading + ordered list of taskIds (verbatim, not resolved)", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("### Phase Q0"));
  assert.ok(md.includes("1. `t1`"));
  assert.ok(md.includes("2. `t2`"));
});

test("AC-Q4 tradeoff → axis + GFM table of options", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**Tradeoff:** serializer boundary"));
  assert.ok(md.includes("| Option | Score | Note |"));
  assert.ok(md.includes("| pure | 9 | best |"));
  assert.ok(md.includes("| coupled | 2 | rejected |"));
});

test("AC-Q4 fileChange → action badge + inline-code path + rationale", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**[ADD]** `src/export/markdown.mjs`"));
  assert.ok(md.includes("the canonical serializer"));
});

test("AC-Q4 code → fenced block with lang + bold filename line", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**`markdown.mjs`**"), "filename as bold line");
  assert.ok(
    md.includes("```js\nexport function serializeMarkdown(doc) {}\n```"),
    "fenced code block with lang",
  );
});

test("AC-Q4 table → GFM table from columns/rows; pipes escaped", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("| Kind | Output |"));
  assert.ok(md.includes("| --- | --- |"));
  assert.ok(md.includes("| section | ATX heading |"));
  assert.ok(
    md.includes("| pipe\\|cell | escaped |"),
    "pipe inside a cell is escaped",
  );
});

test("AC-Q4 diagram → fenced ```mermaid block", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("```mermaid\ngraph TD; A-->B;\n```"));
});

test("AC-Q4 diff → file header + fenced ```diff hunk + comments list", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**`src/auth.js`** (modified)"), "file header");
  assert.ok(md.includes("```diff\n@@ -1,3 +1,4 @@ function login()"), "diff fence + header");
  assert.ok(md.includes(" function login() {"), "context line op+text");
  assert.ok(md.includes("-  return a;"), "removed line op+text");
  assert.ok(md.includes("+  const t = mint();"), "added line op+text");
  assert.ok(md.includes("**Comments:**"), "comments label");
  assert.ok(
    md.includes("- **accept** _(hunk `df1-h1`)_: looks good"),
    "hunk-anchored comment with verdict",
  );
  assert.ok(
    md.includes("- **comment** _(file-level)_: file-level note"),
    "file-level comment (hunkId null)",
  );
});

test("AC-Q4 diff → binary file note (empty hunks)", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**`logo.png`** (binary)"));
  assert.ok(md.includes("_binary file_"));
});

test("AC-Q4 diff → renamed header + rename note (empty hunks)", () => {
  const md = serializeMarkdown(ALL_KINDS_DOC);
  assert.ok(md.includes("**`old/name.js` → `new/name.js`** (renamed)"));
  assert.ok(md.includes("_renamed old/name.js → new/name.js_"));
});

test("AC-Q4 all 14 kinds have a non-empty defined rendering", () => {
  // Each kind in isolation must produce non-empty output (totality).
  const kinds = [
    { id: "x", kind: "section", title: "T", level: 1 },
    { id: "x", kind: "prose", md: "m" },
    { id: "x", kind: "objective", text: "o", successCriteria: ["c"] },
    { id: "x", kind: "task", title: "t", status: "todo", deps: [], acceptance: [] },
    { id: "x", kind: "decision", question: "q", options: [], chosen: "" },
    { id: "x", kind: "risk", description: "d", likelihood: "L", impact: "L", mitigation: "m" },
    { id: "x", kind: "openQuestion", question: "q" },
    { id: "x", kind: "phase", title: "p", taskIds: [] },
    { id: "x", kind: "tradeoff", axis: "a", options: [] },
    { id: "x", kind: "fileChange", path: "p", action: "modify", rationale: "r" },
    { id: "x", kind: "code", lang: "", content: "" },
    { id: "x", kind: "table", columns: ["A"], rows: [] },
    { id: "x", kind: "diagram", mermaid: "" },
    { id: "x", kind: "diff", path: "p", status: "modified", hunks: [], comments: [] },
  ];
  assert.equal(kinds.length, 14, "exactly 14 v1∪v2∪v3 kinds covered");
  for (const b of kinds) {
    const md = serializeMarkdown({ title: "T", blocks: [b] });
    // Body after the H1 + separators must be non-empty for every kind.
    const body = md.slice(md.indexOf("\n\n") + 2).trim();
    assert.ok(body.length > 0, `kind '${b.kind}' must render non-empty output`);
  }
});

test("AC-Q4 DETERMINISM: same input ⇒ byte-identical output ×2", () => {
  const a = serializeMarkdown(ALL_KINDS_DOC);
  const b = serializeMarkdown(ALL_KINDS_DOC);
  assert.equal(a, b, "string equality (byte-identical)");
  assert.deepEqual(a, b, "deep-equal across two calls");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "stable serialization");
});

test("AC-Q4 degraded doc (1 prose + meta.degraded) serializes without throwing", () => {
  let md;
  assert.doesNotThrow(() => {
    md = serializeMarkdown(DEGRADED_DOC);
  }, "degraded doc must not throw");
  assert.equal(typeof md, "string");
  assert.ok(md.includes("# Unstructured Plan"));
  assert.ok(md.includes("degraded"), "degraded flag surfaced in meta header");
  assert.ok(md.includes("raw unstructured text"));
});

test("AC-Q4 empty / malformed docs serialize without throwing (degrade, never crash)", () => {
  for (const bad of [
    {},
    { title: "Empty", blocks: [] },
    { title: "X", blocks: [{ kind: "unknownKind", weird: 1 }] },
    { title: "X", blocks: [null, 42, "str"] },
    null,
    undefined,
    42,
    "not a doc",
    { title: "X", blocks: "not-an-array" },
  ]) {
    let md;
    assert.doesNotThrow(() => {
      md = serializeMarkdown(bad);
    }, `must not throw on ${JSON.stringify(bad)}`);
    assert.equal(typeof md, "string", "always returns a string");
    assert.ok(md.length > 0, "always non-empty (at least the H1)");
  }
  // Unknown kind degrades to a fenced JSON dump, never crashes.
  const unk = serializeMarkdown({
    title: "X",
    blocks: [{ kind: "unknownKind", weird: 1 }],
  });
  assert.ok(unk.includes("```json"), "unknown kind → fenced JSON fallback");
});

test("AC-Q5 (static-purity) markdown.mjs source has ZERO imports / no impure refs", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/export/markdown.mjs", import.meta.url)),
    "utf8",
  );
  // Strip block & line comments so the purity-contract prose (which mentions
  // child_process / network / node: by NAME to document their ABSENCE) does
  // not cause a false positive — we assert on the executable source only.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [
    "child_process",
    "node:",
    "node:net",
    "node:dns",
    "node:http",
    "node:https",
    "node:fs",
    "require(",
    "import(",
    "fetch(",
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `markdown.mjs executable source must not reference ${forbidden} (AC-Q5 purity)`,
    );
  }
  // ZERO import statements at all (pure, node:-free — like ingest.mjs).
  assert.ok(
    !/^\s*import\s/m.test(code),
    "markdown.mjs must have ZERO import statements (pure, no node: at all)",
  );
});

console.log("");
console.log(
  `Q0 markdown-export serializer tests: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
