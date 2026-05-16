/**
 * planos — /planos-plan command tests (plain Node, zero dependencies).
 *
 * Covers US-020 acceptance:
 *  - AC-15 (partially [H]): slash command file exists, has valid frontmatter,
 *    accepts $ARGUMENTS/topic, contains required Socratic interview instructions.
 *  - AC-17 (self-containment layer): command contains NO reference to external
 *    skills /deep-interview or /grill-me.
 *  - bin/planos regression: dispatcher still routes enter/exit and handles
 *    unknown subcommands gracefully (no crash, exit 0).
 *
 * AC-15 manual smoke (must be run in a real Claude Code session — see docs/notes/planos-plan-command.md):
 *   Scenario A: /planos-plan "some topic" → one Q at a time → summary → block doc → browser
 *   Scenario B: /planos-plan (no arg)    → same flow
 *   Scenario C: type "skip" → graceful fallback → browser opens
 *
 * Run: node tests/planos-plan-command.test.mjs
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
const COMMAND_PATH = resolve(ROOT, "plugin/commands/planos-plan.md");

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

test("plugin/commands/planos-plan.md exists", () => {
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

test("frontmatter 'name' is 'planos-plan'", () => {
  const fm = parseFrontmatter(readCommand());
  assert.equal(
    fm && fm.name,
    "planos-plan",
    `Expected name='planos-plan', got '${fm && fm.name}'`
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
  // Must distinguish between a provided topic and no topic
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
  // Match the Phase 2 section heading specifically (not the frontmatter description line)
  const authoringIdx = src.search(/^##\s+PHASE 2|^##\s+Phase 2|Structured Block Authoring/m);
  assert.ok(summaryIdx !== -1, "No crystallized intent mention found");
  assert.ok(authoringIdx !== -1, "No block authoring / Phase 2 section heading found");
  assert.ok(
    summaryIdx < authoringIdx,
    "Crystallized intent summary must appear before block authoring instructions"
  );
});

// ---------------------------------------------------------------------------
// 6. Block authoring handoff
// ---------------------------------------------------------------------------

console.log("\n── Block authoring handoff ──");

test("command instructs the agent to author a structured block document", () => {
  const src = readCommand();
  const authoring =
    src.includes("block document") ||
    src.includes("block plan") ||
    src.includes("block doc");
  assert.ok(
    authoring,
    "Command must instruct the agent to author a structured block document"
  );
});

test("command references the v1 block schema or block kinds", () => {
  const src = readCommand();
  // Must mention at least some v1 kinds so the agent knows the schema
  const kindsPresent =
    src.includes("section") &&
    src.includes("task") &&
    src.includes("openQuestion");
  assert.ok(
    kindsPresent,
    "Command must reference v1 block kinds (section, task, openQuestion at minimum)"
  );
});

test("command instructs calling ExitPlanMode after authoring", () => {
  const src = readCommand();
  assert.ok(
    src.includes("ExitPlanMode"),
    "Command must instruct the agent to call ExitPlanMode after authoring the block document"
  );
});

// ---------------------------------------------------------------------------
// 7. Graceful degradation / interruption fallback
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
// 8. Self-containment (AC-17) — no external skill dependency
// ---------------------------------------------------------------------------

console.log("\n── Self-containment (AC-17) ──");

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
  // Skill invocations look like /oh-my-claudecode:something or /omc:something
  const hasOmcInvocation =
    /\/oh-my-claudecode:[a-z]/.test(src) || /\/omc:[a-z]/.test(src);
  assert.ok(
    !hasOmcInvocation,
    "Command must not invoke oh-my-claudecode skills (self-contained requirement)"
  );
});

// ---------------------------------------------------------------------------
// 9. bin/planos regression — dispatcher still works
// ---------------------------------------------------------------------------

console.log("\n── bin/planos dispatcher regression ──");

const PLANOS_BIN = resolve(ROOT, "plugin/bin/planos");

test("bin/planos exists", () => {
  assert.ok(existsSync(PLANOS_BIN), `Expected ${PLANOS_BIN} to exist`);
});

test("bin/planos with unknown subcommand exits 0 (graceful stub)", () => {
  const result = spawnSync(
    process.execPath,
    [PLANOS_BIN, "planos-plan"],
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
    [PLANOS_BIN, "planos-plan"],
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
  console.log("\n  MANUAL SMOKE TESTS (AC-15 [M]) — not automated:");
  console.log("  See docs/notes/planos-plan-command.md for the three scenarios.");
  process.exit(1);
} else {
  console.log("\n  MANUAL SMOKE TESTS (AC-15 [M]) — not automated:");
  console.log("  See docs/notes/planos-plan-command.md for the three scenarios.");
  console.log("  All automated checks passed.");
  process.exit(0);
}
