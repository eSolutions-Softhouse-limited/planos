/**
 * planos — /planos-review command tests (plain Node, zero dependencies).
 *
 * Covers AC-R5 (partially [H]): slash command file exists, has valid frontmatter,
 * accepts $ARGUMENTS (PR# / git range / empty), contains the required brief
 * scope-grounding interview instructions, embeds the v3 diff-review schema
 * (diff/Hunk/DiffLine/BlockComment + v1 core kinds, v2 PRD kinds rejected),
 * a worked v3 example, ID-stability rules, and the exact stdin bin/planos review
 * invocation (R4). Also asserts self-containment (no external skill refs) AND the
 * gh/git-pre-server-not-blocking-path boundary (R1 Option A — AC-R5/AC-R6
 * boundary invariant; mirrors how planos-prd-command tests assert the AC-17
 * boundary).
 *
 * AC-R5 manual smoke (must be run in a real Claude Code session — see docs/notes/planos-review-command.md):
 *   Scenario A: /planos-review <PR#>     → one Q at a time → gh pr diff → v3 doc → browser
 *   Scenario B: /planos-review <range>   → same flow with git diff
 *   Scenario C: type "skip" → graceful fallback → browser opens
 *
 * Run: node tests/planos-review-command.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

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
    console.log(`        ${err && err.message ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMMAND_PATH = resolve(ROOT, "plugin/commands/planos-review.md");

function readCommand() {
  return readFileSync(COMMAND_PATH, "utf8");
}

/**
 * Parse YAML-style frontmatter from a markdown file.
 * Returns an object of key:value pairs (values as raw strings).
 */
function parseFrontmatter(src) {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return fm;
}

// ---------------------------------------------------------------------------
// 1. File existence
// ---------------------------------------------------------------------------

console.log("\n── File existence ──");

test("plugin/commands/planos-review.md exists", () => {
  assert.ok(
    existsSync(COMMAND_PATH),
    `Expected ${COMMAND_PATH} to exist`
  );
});

// ---------------------------------------------------------------------------
// 2. Frontmatter validity
// ---------------------------------------------------------------------------

console.log("\n── Frontmatter ──");

test("file has a frontmatter block (--- delimiters)", () => {
  const src = readCommand();
  assert.ok(
    /^---\r?\n[\s\S]*?\r?\n---/.test(src),
    "No valid frontmatter block found (missing --- delimiters)"
  );
});

test("frontmatter has 'name' field", () => {
  const fm = parseFrontmatter(readCommand());
  assert.ok(fm && fm.name, "frontmatter missing 'name' field");
});

test("frontmatter 'name' is 'planos-review'", () => {
  const fm = parseFrontmatter(readCommand());
  assert.equal(
    fm && fm.name,
    "planos-review",
    `Expected name='planos-review', got '${fm && fm.name}'`
  );
});

test("frontmatter has 'description' field", () => {
  const fm = parseFrontmatter(readCommand());
  assert.ok(fm && fm.description, "frontmatter missing 'description' field");
});

test("frontmatter has 'argument-hint' field (PR# | git range)", () => {
  const fm = parseFrontmatter(readCommand());
  assert.ok(
    fm && fm["argument-hint"],
    "frontmatter missing 'argument-hint' field"
  );
  assert.ok(
    fm["argument-hint"].includes("PR") || fm["argument-hint"].includes("range"),
    `Expected 'argument-hint' to mention PR/range, got '${fm["argument-hint"]}'`
  );
});

// ---------------------------------------------------------------------------
// 3. $ARGUMENTS — PR# / git range / empty handling
// ---------------------------------------------------------------------------

console.log("\n── $ARGUMENTS / PR# vs git range vs empty ──");

test("command body references $ARGUMENTS", () => {
  const src = readCommand();
  assert.ok(
    src.includes("$ARGUMENTS"),
    "Command body must reference $ARGUMENTS so the argument is available"
  );
});

test("command handles a PR-number argument (gh pr diff)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("PR number") && src.includes("gh pr diff"),
    "Command must describe handling a PR-number argument via gh pr diff"
  );
});

test("command handles a git-range argument (git diff)", () => {
  const src = readCommand();
  assert.ok(
    (src.includes("git range") || src.includes("git-range")) &&
      src.includes("git diff"),
    "Command must describe handling a git-range argument via git diff"
  );
});

test("command handles empty $ARGUMENTS (asks which PR or range)", () => {
  const src = readCommand();
  const hasEmpty =
    src.includes("empty") &&
    (src.includes("Which PR or git range") ||
      src.includes("which PR or range") ||
      src.includes("Ask the user"));
  assert.ok(
    hasEmpty,
    "Command must describe asking the user which PR or range when $ARGUMENTS is empty"
  );
});

test("command detects argument shape (PR# vs range) like planos-prd empty-vs-topic", () => {
  const src = readCommand();
  const hasShapeDetect =
    /shape/i.test(src) &&
    (src.includes("planos-prd") ||
      src.includes("empty-vs-topic") ||
      src.includes("branches on"));
  assert.ok(
    hasShapeDetect,
    "Command must detect the argument shape, mirroring planos-prd empty-vs-topic branching"
  );
});

// ---------------------------------------------------------------------------
// 4. Brief scope-grounding interview — one question at a time
// ---------------------------------------------------------------------------

console.log("\n── Scope-grounding interview structure ──");

test("command instructs one question at a time", () => {
  const src = readCommand();
  const oneQ =
    src.includes("one question at a time") ||
    src.includes("One question at a time");
  assert.ok(
    oneQ,
    "Command must instruct the agent to ask only one question at a time"
  );
});

test("command mandates the AskUserQuestion tool for interview questions", () => {
  const src = readCommand();
  assert.ok(
    src.includes("AskUserQuestion"),
    "Command must mandate the AskUserQuestion tool so the scope-grounding interview is clickable, not flat plain-prose Q&A (regression guard for the interview-UX fix)"
  );
});

test("command instructs adaptive follow-ups", () => {
  const src = readCommand();
  assert.ok(
    src.includes("adaptive follow-up") ||
      src.includes("Adaptive follow-up") ||
      src.includes("adaptive"),
    "Command must instruct adaptive follow-up questions"
  );
});

test("command instructs exposing / surfacing assumptions", () => {
  const src = readCommand();
  assert.ok(
    src.includes("assumption") || src.includes("Assumption"),
    "Command must instruct the agent to surface/expose assumptions"
  );
});

test("command keeps the interview brief / targeted (not exhaustive)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("brief") || src.includes("Brief") ||
      src.includes("short and targeted") || src.includes("Targeted, not exhaustive"),
    "Command must keep the scope interview brief and targeted"
  );
});

// ---------------------------------------------------------------------------
// 5. Review scope summary precedes authoring
// ---------------------------------------------------------------------------

console.log("\n── Review scope summary ──");

test("command produces a review scope summary", () => {
  const src = readCommand();
  assert.ok(
    src.includes("REVIEW SCOPE SUMMARY") ||
      src.includes("Review Scope Summary") ||
      src.includes("review scope summary"),
    "Command must produce a review scope summary before authoring"
  );
});

test("scope summary precedes block authoring (textual order)", () => {
  const src = readCommand();
  const summaryIdx = src.search(/review scope summary/i);
  const authoringIdx = src.search(
    /^##\s+PHASE 2|^##\s+Phase 2|Structured v3 diff-review block authoring/m
  );
  assert.ok(summaryIdx !== -1, "No review scope summary mention found");
  assert.ok(authoringIdx !== -1, "No Phase 2 / block authoring section heading found");
  assert.ok(
    summaryIdx < authoringIdx,
    "Review scope summary must appear before block authoring instructions"
  );
});

// ---------------------------------------------------------------------------
// 6. v3 diff-review schema — diff kind + nested shapes
// ---------------------------------------------------------------------------

console.log("\n── v3 diff-review schema — diff kind ──");

test("command schema specifies type:\"diff-review\" for the document", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"diff-review"') || src.includes('type: "diff-review"'),
    'Command must specify type:"diff-review" in the v3 document schema'
  );
});

test("command schema contains v3 kind 'diff'", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"diff"') || src.includes('kind: "diff"'),
    "Command must reference v3 kind 'diff' in the schema block"
  );
});

test("diff kind schema includes 'path' field", () => {
  const src = readCommand();
  assert.ok(src.includes("path"), "Command schema must include 'path' for 'diff'");
});

test("diff kind schema includes 'hunks' field", () => {
  const src = readCommand();
  assert.ok(src.includes("hunks"), "Command schema must include 'hunks' for 'diff'");
});

test("diff kind schema includes 'comments' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("comments"),
    "Command schema must include 'comments' for 'diff'"
  );
});

test("diff kind schema includes 'status' enum (added/modified/deleted/renamed/binary)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("status") &&
      src.includes('"binary"') &&
      src.includes('"renamed"'),
    "Command schema must include a 'status' enum with binary/renamed for 'diff'"
  );
});

test("Hunk shape includes header/oldStart/oldLines/newStart/newLines/lines/hunkId", () => {
  const src = readCommand();
  for (const f of [
    "header",
    "oldStart",
    "oldLines",
    "newStart",
    "newLines",
    "lines",
    "hunkId",
  ]) {
    assert.ok(src.includes(f), `Command schema must include Hunk field '${f}'`);
  }
});

test("DiffLine shape includes 'op' enum (' ' | '+' | '-') and 'text'", () => {
  const src = readCommand();
  assert.ok(
    src.includes("op") && src.includes("text") &&
      (src.includes('" "') || src.includes("context")) &&
      src.includes('"+"') && src.includes('"-"'),
    "Command schema must include DiffLine 'op' enum and 'text'"
  );
});

test("BlockComment shape includes commentId/hunkId/text/verdict", () => {
  const src = readCommand();
  for (const f of ["commentId", "hunkId", "verdict"]) {
    assert.ok(
      src.includes(f),
      `Command schema must include BlockComment field '${f}'`
    );
  }
  assert.ok(
    src.includes('"accept"') && src.includes('"reject"') && src.includes('"comment"'),
    "BlockComment 'verdict' must enumerate accept/reject/comment"
  );
});

// ---------------------------------------------------------------------------
// 7. v1 core kinds allowed, v2 PRD kinds rejected (R7: v1∪v3)
// ---------------------------------------------------------------------------

console.log("\n── diff-review allowed kinds (R7: v1∪v3) ──");

test("command schema contains v1 kind 'section'", () => {
  const src = readCommand();
  assert.ok(src.includes("section"), "Command must reference v1 kind 'section'");
});

test("command schema contains v1 kind 'prose'", () => {
  const src = readCommand();
  assert.ok(src.includes("prose"), "Command must reference v1 kind 'prose'");
});

test("command schema contains v1 kind 'openQuestion'", () => {
  const src = readCommand();
  assert.ok(
    src.includes("openQuestion"),
    "Command must reference v1 kind 'openQuestion'"
  );
});

test("command states v2 PRD kinds are REJECTED in a diff-review doc (R7)", () => {
  const src = readCommand();
  const hasReject =
    (src.includes("REJECTED") || src.includes("rejected")) &&
    src.includes("fileChange");
  assert.ok(
    hasReject,
    "Command must state v2 PRD kinds (incl. fileChange) are rejected in a diff-review doc"
  );
});

// ---------------------------------------------------------------------------
// 8. Worked v3 diff-review example present
// ---------------------------------------------------------------------------

console.log("\n── Worked v3 diff-review example ──");

test("command contains a worked example JSON block with type:diff-review", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"type": "diff-review"') || src.includes('"type":"diff-review"'),
    'Command must contain a worked example with "type": "diff-review"'
  );
});

test("worked example includes at least one diff kind block", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"kind": "diff"'),
    "Worked example must include at least one diff kind block"
  );
});

test("worked example includes a binary/rename empty-hunks stub (R6)", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"status": "binary"') &&
      src.includes('"hunks": []'),
    "Worked example must show a binary/rename empty-hunks stub (R6)"
  );
});

// ---------------------------------------------------------------------------
// 9. ID-stability rules present
// ---------------------------------------------------------------------------

console.log("\n── ID-stability / revision-chain rules ──");

test("command describes ID reuse rule (reuse IDs across revisions)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("REUSE the") ||
      src.includes("reuse the") ||
      src.includes("Reuse the") ||
      src.includes("REUSE"),
    "Command must describe the ID reuse rule across revisions"
  );
});

test("command states IDs must be unique within the document", () => {
  const src = readCommand();
  assert.ok(
    src.includes("unique within"),
    "Command must state that IDs must be unique within the document"
  );
});

test("command describes stable opaque hunkId minting", () => {
  const src = readCommand();
  assert.ok(
    src.includes("hunkId") &&
      (src.includes("opaque") || src.includes("stable") || src.includes("deterministic")),
    "Command must describe stable opaque hunkId minting"
  );
});

test("command mentions revision-chain key (document id stable across revisions)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("revision-chain key") ||
      src.includes("stable across revisions") ||
      src.includes("never change across revisions"),
    "Command must mention the document-level id as the revision-chain key"
  );
});

// ---------------------------------------------------------------------------
// 10. stdin bin/planos review invocation (R4)
// ---------------------------------------------------------------------------

console.log("\n── stdin bin/planos review invocation (R4) ──");

test("command instructs running bin/planos review to boot the server", () => {
  const src = readCommand();
  assert.ok(
    src.includes("bin/planos review") || src.includes("planos review"),
    "Command must instruct the agent to run bin/planos review to boot the server"
  );
});

test("command specifies stdin as the handoff mechanism (pipe / stdin / heredoc)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("stdin") ||
      src.includes("pipe") ||
      src.includes("| node") ||
      src.includes("<<"),
    "Command must specify that the authored JSON is piped into bin/planos review via stdin (R4)"
  );
});

test("command does NOT instruct calling ExitPlanMode for diff-review mode", () => {
  const src = readCommand();
  const idx = src.indexOf("ExitPlanMode");
  if (idx !== -1) {
    const surrounding = src.slice(Math.max(0, idx - 40), idx + 40).toLowerCase();
    const inNegativeContext =
      surrounding.includes("not") ||
      surrounding.includes("do not") ||
      surrounding.includes("no ");
    assert.ok(
      inNegativeContext,
      "Command must NOT instruct calling ExitPlanMode — diff-review uses bin/planos review directly. " +
        `Context: '${surrounding}'`
    );
  }
});

test("command instructs the agent to author a v3 diff-review block document", () => {
  const src = readCommand();
  assert.ok(
    src.includes("block document") || src.includes("diff-review block"),
    "Command must instruct the agent to author a structured v3 diff-review block document"
  );
});

// ---------------------------------------------------------------------------
// 11. Ingestion mechanism — src/review/ingest.mjs pure parser
// ---------------------------------------------------------------------------

console.log("\n── Ingestion mechanism (src/review/ingest.mjs) ──");

test("command references src/review/ingest.mjs as a pure parser option", () => {
  const src = readCommand();
  assert.ok(
    src.includes("src/review/ingest.mjs"),
    "Command must reference src/review/ingest.mjs as the recommended ingestion parser"
  );
});

test("command describes both ingestion paths (parser + direct authoring)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("ingest.mjs") &&
      (src.includes("author the") || src.includes("authoring the") || src.includes("directly")),
    "Command must describe both shelling to the parser AND authoring blocks directly"
  );
});

test("command recommends the ingest parser for fidelity", () => {
  const src = readCommand();
  assert.ok(
    src.includes("prefer the parser") ||
      src.includes("Recommended") ||
      src.includes("recommended"),
    "Command must recommend using the ingest parser for fidelity"
  );
});

// ---------------------------------------------------------------------------
// 12. gh/git pre-server boundary — NOT inside blocking bin/planos review
// ---------------------------------------------------------------------------

console.log("\n── gh/git pre-server boundary (R1 Option A — AC-R5/AC-R6) ──");

test("command places gh/git ingestion in the agent's OWN CLI tool use", () => {
  const src = readCommand();
  const hasOwnToolUse =
    /own (cli )?tool use/i.test(src) || src.includes("its own tool use") ||
    src.includes("YOUR OWN CLI TOOL USE");
  assert.ok(
    hasOwnToolUse,
    "Command must state gh/git ingestion is the agent's own CLI tool use"
  );
});

test("command states gh/git runs BEFORE the server boots (pre-server)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("pre-server") ||
      src.includes("before the server boots") ||
      src.includes("before the blocking server"),
    "Command must state gh/git ingestion runs pre-server"
  );
});

test("command FORBIDS gh/git inside the blocking bin/planos review path (R1 boundary)", () => {
  const src = readCommand();
  // The boundary text must explicitly say gh/git is NEVER invoked from inside
  // bin/planos review (AC-R5/AC-R6 boundary invariant — mirrors how
  // planos-prd-command tests assert the AC-17 boundary).
  const hasNever =
    /NEVER (invoked )?from inside `?bin\/planos review`?/i.test(src) ||
    /never .*bin\/planos review/i.test(src) ||
    (src.includes("NEVER") && src.includes("bin/planos review"));
  assert.ok(
    hasNever,
    "Command must explicitly forbid gh/git inside the blocking bin/planos review path"
  );
});

test("command asserts the blocking path is network/model/spawn-free", () => {
  const src = readCommand();
  const hasFree =
    (src.includes("network-free") || src.includes("network egress")) &&
    (src.includes("model-free") || src.includes("model invocation")) &&
    (src.includes("spawn-free") || src.includes("agent spawn"));
  assert.ok(
    hasFree,
    "Command must assert the blocking path is network/model/spawn-free (AC-17 posture)"
  );
});

// ---------------------------------------------------------------------------
// 13. Graceful degradation / interruption fallback
// ---------------------------------------------------------------------------

console.log("\n── Graceful degradation ──");

test("command describes graceful fallback when interview is interrupted", () => {
  const src = readCommand();
  assert.ok(
    src.includes("graceful") || src.includes("skip") || src.includes("interrupted"),
    "Command must describe graceful fallback behaviour if the interview is interrupted"
  );
});

test("command guarantees loop is always reachable (never block / never fail)", () => {
  const src = readCommand();
  assert.ok(
    src.includes("Never fail") ||
      src.includes("never fail") ||
      src.includes("never crash") ||
      src.includes("always reach") ||
      src.includes("always reachable"),
    "Command must guarantee the loop is always reachable (never block, never fail)"
  );
});

// ---------------------------------------------------------------------------
// 14. Self-containment (AC-R5) — no external skill dependency
// ---------------------------------------------------------------------------

console.log("\n── Self-containment (AC-R5) ──");

test("command does NOT reference /deep-interview", () => {
  const src = readCommand();
  assert.ok(
    !src.includes("/deep-interview"),
    "Command must not reference external skill /deep-interview (self-contained requirement)"
  );
});

test("command does NOT reference /grill-me", () => {
  const src = readCommand();
  assert.ok(
    !src.includes("/grill-me"),
    "Command must not reference external skill /grill-me (self-contained requirement)"
  );
});

test("command does NOT hard-depend on any oh-my-claudecode skill invocation", () => {
  const src = readCommand();
  const hasOmcInvocation =
    /\/oh-my-claudecode:[a-z]/.test(src) || /\/omc:[a-z]/.test(src);
  assert.ok(
    !hasOmcInvocation,
    "Command must not invoke oh-my-claudecode skills (self-contained requirement)"
  );
});

test("command states the interruption fallback is self-contained", () => {
  const src = readCommand();
  assert.ok(
    src.includes("Self-contained") ||
      src.includes("self-contained") ||
      src.includes("entirely handled by these instructions"),
    "Command must state the fallback is self-contained (no external skill)"
  );
});

// ---------------------------------------------------------------------------
// 15. bin/planos regression — dispatcher still works
// ---------------------------------------------------------------------------

console.log("\n── bin/planos dispatcher regression ──");

const PLANOS_BIN = resolve(ROOT, "plugin/bin/planos");

test("bin/planos exists", () => {
  assert.ok(existsSync(PLANOS_BIN), `Expected ${PLANOS_BIN} to exist`);
});

test("bin/planos with unknown subcommand exits 0 (graceful stub)", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN, "planos-review"],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.equal(
    result.status,
    0,
    `Expected exit code 0 for unknown subcommand, got ${result.status}. stderr: ${result.stderr}`
  );
});

test("bin/planos with no subcommand exits 1 (usage error)", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.equal(
    result.status,
    1,
    `Expected exit code 1 for no subcommand, got ${result.status}`
  );
});

test("bin/planos usage lists the 'review' subcommand", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.ok(
    result.stderr && result.stderr.includes("review"),
    "bin/planos usage must list the 'review' subcommand"
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n── Results ──`);
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n  MANUAL SMOKE TESTS (AC-R5 [M]) — not automated:");
  console.log("  See docs/notes/planos-review-command.md for the scenarios.");
  process.exit(1);
} else {
  console.log("\n  MANUAL SMOKE TESTS (AC-R5 [M]) — not automated:");
  console.log("  See docs/notes/planos-review-command.md for the scenarios.");
  console.log("  All automated checks passed.");
  process.exit(0);
}
