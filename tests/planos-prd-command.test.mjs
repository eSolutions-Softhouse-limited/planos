/**
 * planos — /planos-prd command tests (plain Node, zero dependencies).
 *
 * Covers AC-P5 (partially [H]): slash command file exists, has valid frontmatter,
 * accepts $ARGUMENTS/topic, contains required Socratic interview instructions,
 * embeds the v2 schema (all 6 v2 kinds + v1 kinds), a worked v2 example,
 * ID-stability rules, and the exact stdin bin/planos prd invocation (D4).
 * Also asserts self-containment (no external skill refs).
 *
 * AC-P5 manual smoke (must be run in a real Claude Code session — see docs/notes/planos-prd-command.md):
 *   Scenario A: /planos-prd "some topic" → one Q at a time → summary → v2 PRD doc → browser
 *   Scenario B: /planos-prd (no arg)    → same flow
 *   Scenario C: type "skip" → graceful fallback → browser opens
 *
 * Run: node tests/planos-prd-command.test.mjs
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

/** Read the command file once. */
const COMMAND_PATH = resolve(ROOT, "plugin/commands/planos-prd.md");

function readCommand() {
  return readFileSync(COMMAND_PATH, "utf8");
}

/**
 * Parse YAML-style frontmatter from a markdown file.
 * Returns an object of key:value pairs (values as raw strings).
 * Supports only simple scalar values (no block scalars / nested YAML).
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

test("plugin/commands/planos-prd.md exists", () => {
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

test("frontmatter 'name' is 'planos-prd'", () => {
  const fm = parseFrontmatter(readCommand());
  assert.equal(
    fm && fm.name,
    "planos-prd",
    `Expected name='planos-prd', got '${fm && fm.name}'`
  );
});

test("frontmatter has 'description' field", () => {
  const fm = parseFrontmatter(readCommand());
  assert.ok(fm && fm.description, "frontmatter missing 'description' field");
});

test("frontmatter has 'argument-hint' field (accepts optional [topic])", () => {
  const fm = parseFrontmatter(readCommand());
  assert.ok(
    fm && fm["argument-hint"],
    "frontmatter missing 'argument-hint' field"
  );
  assert.ok(
    fm["argument-hint"].includes("topic"),
    `Expected 'argument-hint' to mention 'topic', got '${fm["argument-hint"]}'`
  );
});

// ---------------------------------------------------------------------------
// 3. $ARGUMENTS / topic handling
// ---------------------------------------------------------------------------

console.log("\n── $ARGUMENTS / topic ──");

test("command body references $ARGUMENTS", () => {
  const src = readCommand();
  assert.ok(
    src.includes("$ARGUMENTS"),
    "Command body must reference $ARGUMENTS so the topic argument is available"
  );
});

test("command describes different opening behaviour for non-empty vs empty argument", () => {
  const src = readCommand();
  const hasIfArg =
    src.includes("$ARGUMENTS") &&
    (src.includes("non-empty") ||
      src.includes("If `$ARGUMENTS` is non-empty") ||
      src.includes("If $ARGUMENTS is non-empty") ||
      src.includes("empty"));
  assert.ok(
    hasIfArg,
    "Command must describe different opening behaviour when $ARGUMENTS is provided vs empty"
  );
});

// ---------------------------------------------------------------------------
// 4. Socratic interview — one question at a time
// ---------------------------------------------------------------------------

console.log("\n── Socratic interview structure ──");

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
    "Command must mandate the AskUserQuestion tool so the Socratic interview is clickable, not flat plain-prose Q&A (regression guard for the interview-UX fix)"
  );
});

test("command instructs adaptive follow-ups", () => {
  const src = readCommand();
  const adaptive =
    src.includes("adaptive follow-up") ||
    src.includes("Adaptive follow-up") ||
    src.includes("adaptive");
  assert.ok(
    adaptive,
    "Command must instruct adaptive follow-up questions"
  );
});

test("command instructs exposing / surfacing assumptions", () => {
  const src = readCommand();
  const assumptions =
    src.includes("assumption") || src.includes("Assumption");
  assert.ok(
    assumptions,
    "Command must instruct the agent to surface/expose assumptions"
  );
});

// ---------------------------------------------------------------------------
// 5. Crystallized intent summary
// ---------------------------------------------------------------------------

console.log("\n── Crystallized intent summary ──");

test("command produces a crystallized intent summary", () => {
  const src = readCommand();
  const hasSummary =
    src.includes("crystallized intent") ||
    src.includes("Crystallized Intent") ||
    src.includes("CRYSTALLIZED INTENT");
  assert.ok(
    hasSummary,
    "Command must produce a crystallized intent summary before authoring"
  );
});

test("crystallized summary precedes block authoring (textual order)", () => {
  const src = readCommand();
  const summaryIdx = src.search(/crystallized intent/i);
  const authoringIdx = src.search(/^##\s+PHASE 2|^##\s+Phase 2|Structured Block Authoring/m);
  assert.ok(summaryIdx !== -1, "No crystallized intent mention found");
  assert.ok(authoringIdx !== -1, "No block authoring / Phase 2 section heading found");
  assert.ok(
    summaryIdx < authoringIdx,
    "Crystallized intent summary must appear before block authoring instructions"
  );
});

// ---------------------------------------------------------------------------
// 6. v2 schema — all 6 v2 kinds present
// ---------------------------------------------------------------------------

console.log("\n── v2 schema — v2 kinds ──");

const V2_KINDS = ["phase", "tradeoff", "fileChange", "code", "table", "diagram"];

for (const kind of V2_KINDS) {
  test(`command schema contains v2 kind '${kind}'`, () => {
    const src = readCommand();
    assert.ok(
      src.includes(`"${kind}"`) || src.includes(`kind: "${kind}"`),
      `Command must reference v2 kind '${kind}' in the schema block`
    );
  });
}

// ---------------------------------------------------------------------------
// 7. v2 schema — v1 kinds also present (type:"prd" accepts v1∪v2)
// ---------------------------------------------------------------------------

console.log("\n── v2 schema — v1 kinds also present ──");

test("command schema contains v1 kind 'section'", () => {
  const src = readCommand();
  assert.ok(src.includes("section"), "Command must reference v1 kind 'section'");
});

test("command schema contains v1 kind 'task'", () => {
  const src = readCommand();
  assert.ok(src.includes("task"), "Command must reference v1 kind 'task'");
});

test("command schema contains v1 kind 'openQuestion'", () => {
  const src = readCommand();
  assert.ok(src.includes("openQuestion"), "Command must reference v1 kind 'openQuestion'");
});

test("command schema specifies type:\"prd\" for the document", () => {
  const src = readCommand();
  assert.ok(
    src.includes('"prd"') || src.includes("type: \"prd\""),
    "Command must specify type:\"prd\" in the v2 document schema"
  );
});

// ---------------------------------------------------------------------------
// 8. v2 schema — required fields for each v2 kind
// ---------------------------------------------------------------------------

console.log("\n── v2 schema — v2 kind required fields ──");

test("phase kind schema includes 'taskIds' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("taskIds"),
    "Command schema must include 'taskIds' for the 'phase' kind"
  );
});

test("tradeoff kind schema includes 'axis' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("axis"),
    "Command schema must include 'axis' for the 'tradeoff' kind"
  );
});

test("tradeoff kind schema includes 'options' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("options"),
    "Command schema must include 'options' for the 'tradeoff' kind"
  );
});

test("fileChange kind schema includes 'path' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("path"),
    "Command schema must include 'path' for the 'fileChange' kind"
  );
});

test("fileChange kind schema includes 'action' field with add/modify/delete", () => {
  const src = readCommand();
  assert.ok(
    src.includes("action") &&
    (src.includes('"add"') || src.includes('"modify"') || src.includes('"delete"')),
    "Command schema must include 'action' with add/modify/delete for the 'fileChange' kind"
  );
});

test("fileChange kind schema includes 'rationale' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("rationale"),
    "Command schema must include 'rationale' for the 'fileChange' kind"
  );
});

test("code kind schema includes 'lang' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("lang"),
    "Command schema must include 'lang' for the 'code' kind"
  );
});

test("code kind schema includes 'content' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("content"),
    "Command schema must include 'content' for the 'code' kind"
  );
});

test("table kind schema includes 'columns' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("columns"),
    "Command schema must include 'columns' for the 'table' kind"
  );
});

test("table kind schema includes 'rows' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("rows"),
    "Command schema must include 'rows' for the 'table' kind"
  );
});

test("diagram kind schema includes 'mermaid' field", () => {
  const src = readCommand();
  assert.ok(
    src.includes("mermaid"),
    "Command schema must include 'mermaid' for the 'diagram' kind"
  );
});

// ---------------------------------------------------------------------------
// 9. Worked v2 PRD example present
// ---------------------------------------------------------------------------

console.log("\n── Worked v2 PRD example ──");

test("command contains a worked v2 PRD example (JSON code block with type:prd)", () => {
  const src = readCommand();
  // Must have a JSON code block that is a valid-looking v2 PRD doc
  const hasExample =
    src.includes('"type": "prd"') || src.includes('"type":"prd"');
  assert.ok(
    hasExample,
    "Command must contain a worked v2 PRD example JSON block with \"type\": \"prd\""
  );
});

test("worked example includes at least one v2 kind block", () => {
  const src = readCommand();
  // The worked example should use at least one v2 kind
  const hasV2Block = V2_KINDS.some((k) => src.includes(`"kind": "${k}"`));
  assert.ok(
    hasV2Block,
    "Worked example must include at least one v2 kind block"
  );
});

// ---------------------------------------------------------------------------
// 10. ID-stability rules present
// ---------------------------------------------------------------------------

console.log("\n── ID-stability / revision-chain rules ──");

test("command describes ID reuse rule (reuse IDs across revisions)", () => {
  const src = readCommand();
  const hasIdReuse =
    src.includes("REUSE the") ||
    src.includes("reuse the") ||
    src.includes("Reuse the") ||
    src.includes("REUSE");
  assert.ok(
    hasIdReuse,
    "Command must describe the ID reuse rule: reuse the id of unchanged blocks"
  );
});

test("command states IDs must be unique within the document", () => {
  const src = readCommand();
  const hasUnique =
    src.includes("unique within") ||
    src.includes("unique within the document");
  assert.ok(
    hasUnique,
    "Command must state that IDs must be unique within the document"
  );
});

test("command mentions revision-chain key (document id stable across revisions)", () => {
  const src = readCommand();
  const hasRevChain =
    src.includes("revision-chain key") ||
    src.includes("stable across revisions") ||
    src.includes("never change across revisions");
  assert.ok(
    hasRevChain,
    "Command must mention the document-level id as the revision-chain key"
  );
});

// ---------------------------------------------------------------------------
// 11. stdin bin/planos prd invocation (D4)
// ---------------------------------------------------------------------------

console.log("\n── stdin bin/planos prd invocation (D4) ──");

test("command instructs running bin/planos prd to boot the server", () => {
  const src = readCommand();
  const hasBinPlanosPrd =
    src.includes("bin/planos prd") ||
    src.includes("planos prd");
  assert.ok(
    hasBinPlanosPrd,
    "Command must instruct the agent to run bin/planos prd to boot the server"
  );
});

test("command specifies stdin as the handoff mechanism (pipe / stdin)", () => {
  const src = readCommand();
  const hasStdin =
    src.includes("stdin") ||
    src.includes("pipe") ||
    src.includes("| node bin/planos prd") ||
    src.includes("<<");
  assert.ok(
    hasStdin,
    "Command must specify that the authored JSON is piped into bin/planos prd via stdin (D4)"
  );
});

test("command does NOT instruct calling ExitPlanMode for PRD mode", () => {
  const src = readCommand();
  // PRD mode must NOT call ExitPlanMode — it uses bin/planos prd directly
  // The only allowed mention is in a clarifying "do NOT call ExitPlanMode" note
  const exitPlanModeIdx = src.indexOf("ExitPlanMode");
  if (exitPlanModeIdx !== -1) {
    // If ExitPlanMode appears, it must be in a "do NOT" / "not" context
    const surrounding = src.slice(Math.max(0, exitPlanModeIdx - 40), exitPlanModeIdx + 40);
    const inNegativeContext =
      surrounding.toLowerCase().includes("not") ||
      surrounding.toLowerCase().includes("do not") ||
      surrounding.toLowerCase().includes("no ");
    assert.ok(
      inNegativeContext,
      "Command must NOT instruct calling ExitPlanMode — PRD mode uses bin/planos prd directly. " +
      `Context around ExitPlanMode: '${surrounding}'`
    );
  }
  // If ExitPlanMode is absent entirely, that's fine too
});

test("command instructs the agent to author a v2 PRD block document", () => {
  const src = readCommand();
  const authoring =
    src.includes("block document") ||
    src.includes("block doc") ||
    src.includes("PRD block");
  assert.ok(
    authoring,
    "Command must instruct the agent to author a structured v2 PRD block document"
  );
});

// ---------------------------------------------------------------------------
// 12. Graceful degradation / interruption fallback
// ---------------------------------------------------------------------------

console.log("\n── Graceful degradation ──");

test("command describes graceful fallback when interview is interrupted", () => {
  const src = readCommand();
  const graceful =
    src.includes("graceful") ||
    src.includes("skip") ||
    src.includes("interrupted");
  assert.ok(
    graceful,
    "Command must describe graceful fallback behaviour if the interview is interrupted"
  );
});

test("command guarantees loop is always reachable (never block / never fail)", () => {
  const src = readCommand();
  const neverFail =
    src.includes("Never fail") ||
    src.includes("Never block") ||
    src.includes("never block") ||
    src.includes("never fail") ||
    src.includes("always reach") ||
    src.includes("Always continue") ||
    src.includes("always continue");
  assert.ok(
    neverFail,
    "Command must guarantee the loop is always reachable (never block, never fail)"
  );
});

// ---------------------------------------------------------------------------
// 13. Self-containment (AC-P5) — no external skill dependency
// ---------------------------------------------------------------------------

console.log("\n── Self-containment (AC-P5) ──");

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

// ---------------------------------------------------------------------------
// 14. bin/planos regression — dispatcher still works
// ---------------------------------------------------------------------------

console.log("\n── bin/planos dispatcher regression ──");

const PLANOS_BIN = resolve(ROOT, "plugin/bin/planos");

test("bin/planos exists", () => {
  assert.ok(existsSync(PLANOS_BIN), `Expected ${PLANOS_BIN} to exist`);
});

test("bin/planos with unknown subcommand exits 0 (graceful stub)", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN, "planos-prd"],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.equal(
    result.status,
    0,
    `Expected exit code 0 for unknown subcommand, got ${result.status}. stderr: ${result.stderr}`
  );
});

test("bin/planos with unknown subcommand writes to stdout (not empty)", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN, "planos-prd"],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.ok(
    result.stdout && result.stdout.length > 0,
    "Expected bin/planos to write to stdout for unknown subcommand"
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n── Results ──`);
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n  MANUAL SMOKE TESTS (AC-P5 [M]) — not automated:");
  console.log("  See docs/notes/planos-prd-command.md for the three scenarios.");
  process.exit(1);
} else {
  console.log("\n  MANUAL SMOKE TESTS (AC-P5 [M]) — not automated:");
  console.log("  See docs/notes/planos-prd-command.md for the three scenarios.");
  console.log("  All automated checks passed.");
  process.exit(0);
}
