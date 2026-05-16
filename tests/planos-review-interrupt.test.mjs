/**
 * planos — /planos-review graceful interruption tests (plain Node, zero deps).
 *
 * Covers AC-R6 (degradation path):
 *   - The command file contains an explicit early-exit / interruption block.
 *   - On interruption, the agent MUST proceed to ingestion + block authoring
 *     (not abort), still piping a minimal valid v3 diff-review doc to
 *     bin/planos review.
 *   - The command MUST NOT loop, MUST NOT refuse, MUST NOT crash.
 *   - The command is self-contained (no /deep-interview, /grill-me, external skill refs).
 *   - The gh/git ingestion stays in the agent's pre-server CLI tool use, NOT
 *     inside the blocking bin/planos review path (R1 Option A boundary invariant).
 *
 * Regression guard: re-runs all planos-review-command.test.mjs assertions
 * in-process to confirm the graceful-interruption additions did not break any
 * prior passing test.
 *
 * Run: node tests/planos-review-interrupt.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// 1. Interruption instruction block exists
// ---------------------------------------------------------------------------

console.log("\n── Interruption instruction block exists ──");

test("command file contains an explicit early-exit / interruption section", () => {
  const src = readCommand();
  const hasSection =
    src.includes("Graceful interruption") ||
    src.includes("graceful interruption") ||
    src.includes("early-exit") ||
    src.includes("early exit");
  assert.ok(
    hasSection,
    "Command must contain a dedicated graceful interruption / early-exit section"
  );
});

test("command names explicit interruption signals: 'skip'", () => {
  const src = readCommand();
  assert.ok(
    src.includes("skip"),
    "Command must name 'skip' as an interruption signal"
  );
});

test("command names 'just review it' / 'go ahead' / 'proceed' as an interruption signal", () => {
  const src = readCommand();
  const hasJust =
    src.includes("just review it") ||
    src.includes("just do it") ||
    src.includes("go ahead") ||
    src.includes("proceed");
  assert.ok(
    hasJust,
    "Command must name 'just review it' / 'go ahead' / 'proceed' as an interruption signal"
  );
});

test("command names one-word / one-sentence answer as an interruption signal", () => {
  const src = readCommand();
  const hasOneWord =
    src.includes("one-word") ||
    src.includes("one word") ||
    src.includes("single word") ||
    src.includes("one-sentence");
  assert.ok(
    hasOneWord,
    "Command must identify one-word or one-sentence answers as early-exit signals"
  );
});

// ---------------------------------------------------------------------------
// 2. On interruption: proceed to ingestion + authoring (not abort)
// ---------------------------------------------------------------------------

console.log("\n── On interruption: must proceed to ingestion + authoring ──");

test("command instructs stopping questions immediately on interruption", () => {
  const src = readCommand();
  const hasStop =
    src.includes("Stop asking questions immediately") ||
    src.includes("stop asking questions immediately") ||
    src.includes("stop immediately") ||
    src.includes("Stop immediately");
  assert.ok(
    hasStop,
    "Command must instruct stopping questions immediately when an interruption signal is detected"
  );
});

test("command instructs synthesizing a best-effort scope summary on interruption", () => {
  const src = readCommand();
  assert.ok(
    src.includes("best-effort") ||
      src.includes("best effort") ||
      src.includes("synthesize"),
    "Command must instruct synthesizing a best-effort scope summary from whatever was gathered"
  );
});

test("command instructs stating it is proceeding with reduced clarity", () => {
  const src = readCommand();
  assert.ok(
    src.includes("reduced clarity") ||
      src.includes("proceeding with reduced") ||
      src.includes("proceed with reduced"),
    "Command must instruct stating that it is proceeding with reduced clarity on interruption"
  );
});

test("command instructs continuing to Phase 1b / Phase 2 after interruption", () => {
  const src = readCommand().toLowerCase();
  const hasContinue =
    src.includes("continue immediately to phase 1b") ||
    src.includes("proceed to phase 1b") ||
    src.includes("proceed to phase 2") ||
    src.includes("continue to phase 2") ||
    (src.includes("phase 2") && src.includes("unconditionally"));
  assert.ok(
    hasContinue,
    "Command must explicitly instruct continuing to ingestion / Phase 2 after an interruption"
  );
});

test("command's interruption path still reaches the server boot step (bin/planos review)", () => {
  const src = readCommand();
  const interruptIdx = src.search(/graceful interruption|early.exit/i);
  const bootIdx = src.lastIndexOf("bin/planos review");
  assert.ok(interruptIdx !== -1, "No interruption section found");
  assert.ok(bootIdx !== -1, "bin/planos review invocation not found in command");
  assert.ok(
    bootIdx > interruptIdx,
    "bin/planos review invocation must appear after the interruption section (loop always reachable)"
  );
});

// ---------------------------------------------------------------------------
// 3. Forbidden: looping, refusing, crashing
// ---------------------------------------------------------------------------

console.log("\n── Forbidden behaviours (loop / refuse / crash) ──");

test("command forbids looping on interruption (must not re-prompt)", () => {
  const src = readCommand();
  const forbidsLoop =
    src.includes("never loop") ||
    src.includes("Never loop") ||
    src.includes("Do not loop") ||
    src.includes("do not loop") ||
    src.includes("do not re-prompt") ||
    src.includes("Do not re-prompt");
  assert.ok(
    forbidsLoop,
    "Command must explicitly forbid looping / re-prompting after an interruption signal"
  );
});

test("command forbids refusing to proceed on interruption", () => {
  const src = readCommand();
  const forbidsRefuse =
    src.includes("Never refuse") ||
    src.includes("never refuse") ||
    src.includes("do not refuse") ||
    src.includes("Do not refuse");
  assert.ok(
    forbidsRefuse,
    "Command must explicitly forbid refusing to proceed after an interruption"
  );
});

test("command forbids crashing on interruption / ingestion failure", () => {
  const src = readCommand();
  assert.ok(
    src.includes("never crash") || src.includes("Never crash"),
    "Command must explicitly forbid crashing after an interruption / ingestion failure"
  );
});

test("command guarantees loop is always reachable after interruption", () => {
  const src = readCommand();
  const alwaysReachable =
    src.includes("always reach") ||
    src.includes("Always reach") ||
    src.includes("always reachable") ||
    src.includes("MUST always be reachable") ||
    src.includes("must always be reachable") ||
    src.includes("always be reachable");
  assert.ok(
    alwaysReachable,
    "Command must guarantee the browser review loop is always reachable after an interruption"
  );
});

// ---------------------------------------------------------------------------
// 4. Self-containment — no external skill invocation in interruption path
// ---------------------------------------------------------------------------

console.log("\n── Self-containment (interruption path) ──");

test("command does NOT reference /deep-interview (anywhere)", () => {
  const src = readCommand();
  assert.ok(
    !src.includes("/deep-interview"),
    "Command must not reference /deep-interview — interruption fallback must be self-contained"
  );
});

test("command does NOT reference /grill-me (anywhere)", () => {
  const src = readCommand();
  assert.ok(
    !src.includes("/grill-me"),
    "Command must not reference /grill-me — interruption fallback must be self-contained"
  );
});

test("interruption section explicitly states self-containment (no external skill)", () => {
  const src = readCommand();
  const hasSelfContained =
    src.includes("Self-contained") ||
    src.includes("self-contained") ||
    src.includes("no external skill") ||
    src.includes("entirely handled by these instructions");
  assert.ok(
    hasSelfContained,
    "Interruption section must state the fallback is self-contained (no external skill)"
  );
});

test("command does NOT invoke oh-my-claudecode skills", () => {
  const src = readCommand();
  const hasOmcInvocation =
    /\/oh-my-claudecode:[a-z]/.test(src) || /\/omc:[a-z]/.test(src);
  assert.ok(
    !hasOmcInvocation,
    "Command must not invoke oh-my-claudecode skills (self-contained requirement)"
  );
});

// ---------------------------------------------------------------------------
// 5. Minimal valid v3 diff-review doc on interruption path
// ---------------------------------------------------------------------------

console.log("\n── Minimal valid v3 diff-review doc on interruption path ──");

test("command's interruption fallback produces a minimal valid JSON block document", () => {
  const src = readCommand();
  const hasFallbackDoc =
    src.includes("minimal document") ||
    src.includes("minimal valid") ||
    src.includes("emit a minimal") ||
    src.includes("minimal v3") ||
    src.includes("valid JSON block document");
  assert.ok(
    hasFallbackDoc,
    "Command must instruct emitting a minimal valid v3 diff-review JSON document on interruption"
  );
});

test("interruption fallback uses openQuestion for unknown scope (recovery surface)", () => {
  const src = readCommand();
  const hasOpenQuestion =
    src.includes("openQuestion") &&
    (src.includes("recovery") ||
      src.includes("minimal") ||
      src.includes("interrupted") ||
      src.includes("clarify"));
  assert.ok(
    hasOpenQuestion,
    "Command must use openQuestion blocks as recovery when scope is unclear after interruption"
  );
});

test("interruption fallback still pipes the doc to bin/planos review via stdin", () => {
  const src = readCommand();
  // Graceful-fallback section must direct the agent back to the stdin pipe.
  const fallbackIdx = src.search(/graceful fallback|interruption path/i);
  assert.ok(fallbackIdx !== -1, "No graceful-fallback section found");
  const tail = src.slice(fallbackIdx);
  assert.ok(
    tail.includes("bin/planos review") &&
      (tail.includes("stdin") || tail.includes("pipe") || tail.includes("via stdin")),
    "Graceful fallback must still pipe the doc to bin/planos review via stdin"
  );
});

test("interruption fallback still keeps gh/git as pre-server tool use (boundary held)", () => {
  const src = readCommand();
  // Even on the failure/interruption path, gh/git ingestion stays the agent's
  // own pre-server CLI tool use — never moved into bin/planos review.
  const hasBoundary =
    (src.includes("pre-server") || src.includes("before the server boots")) &&
    (src.includes("NEVER") || src.includes("never")) &&
    src.includes("bin/planos review");
  assert.ok(
    hasBoundary,
    "Command must keep gh/git pre-server (never inside bin/planos review) even on the fallback path"
  );
});

// ---------------------------------------------------------------------------
// 6. Regression guard — re-run planos-review-command.test.mjs
// ---------------------------------------------------------------------------

console.log("\n── Regression guard (re-run planos-review-command.test.mjs) ──");

test("planos-review-command.test.mjs still passes with zero failures", () => {
  const result = spawnSync(
    process.execPath,
    ["--test", "tests/planos-review-command.test.mjs"],
    { cwd: ROOT, encoding: "utf8", timeout: 15000 }
  );
  assert.equal(
    result.status,
    0,
    `planos-review-command.test.mjs reported failures:\n${result.stdout}\n${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n── Results ──`);
console.log(`  ${passed} passed, ${failed} failed`);

console.log("\n  MANUAL SMOKE (AC-R6 [M]) — document only, not automated:");
console.log("  Start /planos-review <PR#>, interrupt mid-interview with 'just review it',");
console.log("  confirm: agent stops questions, runs gh pr diff as its own tool use,");
console.log("  states reduced clarity, proceeds to Phase 2 authoring, pipes JSON into");
console.log("  node bin/planos review, browser opens. No crash.");
console.log("  See docs/notes/planos-review-command.md Scenario C for full steps.");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n  All automated interruption checks passed.");
  process.exit(0);
}
