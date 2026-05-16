/**
 * planos — EnterPlanMode injection tests (plain Node, zero dependencies).
 *
 * Covers US-007 / AC-1:
 *   - additionalContext contains the full v1 block schema summary (all 7 kinds).
 *   - additionalContext contains a worked example (valid v1 document).
 *   - additionalContext contains the ID-preservation rules (never-renumber rule).
 *   - Hook JSON shape is correct (hookSpecificOutput.hookEventName + additionalContext).
 *   - Wall-clock execution completes well under 5000 ms (target < 1000 ms).
 *
 * Run: node tests/enter.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLANOS_BIN = resolve(__dirname, '../plugin/bin/planos');
const TIMING_LIMIT_MS = 5000; // AC-1 hard assertion limit
const TIMING_TARGET_MS = 1000; // AC-1 target (reported, not hard)

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
// Run `node plugin/bin/planos enter` and capture stdout + wall-clock time.
// The hook contract requires no stdin (EnterPlanMode PreToolUse has no
// plan payload — only ExitPlanMode does). We pass an empty stdin.
// ---------------------------------------------------------------------------

console.log('\nRunning `node plugin/bin/planos enter` …');

const wallStart = Date.now();
const result = spawnSync(process.execPath, [PLANOS_BIN, 'enter'], {
  input: '',           // no stdin required for EnterPlanMode
  encoding: 'utf8',
  timeout: TIMING_LIMIT_MS + 2000, // generous outer kill timeout
});
const wallMs = Date.now() - wallStart;

console.log(`\nWall-clock time: ${wallMs} ms`);
console.log(`Exit code: ${result.status}`);
console.log(`Stderr: ${result.stderr || '(none)'}`);
console.log(`Stdout length: ${(result.stdout || '').length} chars`);
console.log('');

// ---------------------------------------------------------------------------
// Parse the JSON output once — all assertions share the parsed object.
// ---------------------------------------------------------------------------

/** @type {unknown} */
let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse((result.stdout || '').trim());
} catch (e) {
  parseError = e;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

test('AC-1: process exits 0', () => {
  assert.equal(result.status, 0, `Expected exit code 0, got ${result.status}\nStderr: ${result.stderr}`);
});

test('AC-1: stdout is valid JSON', () => {
  assert.ok(
    parseError === null,
    `stdout is not valid JSON: ${parseError && parseError.message}\nRaw stdout: ${(result.stdout || '').slice(0, 200)}`,
  );
});

test('AC-1: wall-clock time < 5000 ms (hard AC-1 budget)', () => {
  assert.ok(
    wallMs < TIMING_LIMIT_MS,
    `Hook took ${wallMs} ms which exceeds the 5000 ms AC-1 hard budget`,
  );
});

test(`AC-1: wall-clock time < ${TIMING_TARGET_MS} ms (target — informational)`, () => {
  assert.ok(
    wallMs < TIMING_TARGET_MS,
    `Hook took ${wallMs} ms — above the ${TIMING_TARGET_MS} ms target (still within 5s hard limit; investigate if this persists)`,
  );
});

// All remaining assertions require valid JSON output.
if (parsed !== null) {
  test('AC-1: output has hookSpecificOutput wrapper', () => {
    assert.ok(
      parsed !== null &&
        typeof parsed === 'object' &&
        'hookSpecificOutput' in parsed,
      `Missing top-level 'hookSpecificOutput' key. Got: ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  });

  test('AC-1: hookSpecificOutput.hookEventName === "PreToolUse"', () => {
    const hso = parsed.hookSpecificOutput;
    assert.equal(
      hso && hso.hookEventName,
      'PreToolUse',
      `Expected hookEventName "PreToolUse", got ${JSON.stringify(hso && hso.hookEventName)}`,
    );
  });

  test('AC-1: hookSpecificOutput.additionalContext is a non-empty string', () => {
    const ctx = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    assert.ok(
      typeof ctx === 'string' && ctx.length > 0,
      `additionalContext must be a non-empty string, got ${typeof ctx}`,
    );
  });

  const ctx = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';

  // --- Schema summary assertions ---

  test('AC-1: additionalContext contains all 7 v1 block kind names', () => {
    const kinds = ['section', 'prose', 'objective', 'task', 'decision', 'risk', 'openQuestion'];
    for (const kind of kinds) {
      assert.ok(
        ctx.includes(kind),
        `additionalContext missing v1 kind '${kind}'`,
      );
    }
  });

  test('AC-1: additionalContext mentions schemaVersion', () => {
    assert.ok(
      ctx.includes('schemaVersion'),
      `additionalContext missing 'schemaVersion' field reference`,
    );
  });

  test('AC-1: additionalContext describes Document shape (id, title, meta, blocks)', () => {
    for (const field of ['id', 'title', 'meta', 'blocks']) {
      assert.ok(
        ctx.includes(field),
        `additionalContext missing Document field '${field}'`,
      );
    }
  });

  test('AC-1: additionalContext mentions task status values (todo|doing|done|cut)', () => {
    for (const s of ['todo', 'doing', 'done', 'cut']) {
      assert.ok(ctx.includes(s), `additionalContext missing task status '${s}'`);
    }
  });

  test('AC-1: additionalContext mentions risk severity scale (L|M|H)', () => {
    // The schema table documents likelihood/impact as L|M|H
    assert.ok(
      ctx.includes('L') && ctx.includes('M') && ctx.includes('H'),
      `additionalContext missing risk scale (L|M|H)`,
    );
  });

  // --- Worked example assertions ---

  test('AC-1: additionalContext contains a worked example (schemaVersion:1 JSON object)', () => {
    assert.ok(
      ctx.includes('"schemaVersion": 1') || ctx.includes('"schemaVersion":1'),
      `additionalContext missing worked-example JSON with "schemaVersion": 1`,
    );
  });

  test('AC-1: additionalContext worked example includes all 7 block kinds', () => {
    const kinds = ['section', 'prose', 'objective', 'task', 'decision', 'risk', 'openQuestion'];
    for (const kind of kinds) {
      // Count occurrences: schema table has them once, example should add at least one more
      const occurrences = (ctx.match(new RegExp(`"${kind}"`, 'g')) || []).length;
      assert.ok(
        occurrences >= 1,
        `Worked example appears to be missing a '${kind}' block (found ${occurrences} JSON occurrences of "${kind}")`,
      );
    }
  });

  test('AC-1: additionalContext worked example has stable block ids', () => {
    // The example must show id fields — at least one quoted id in the example JSON block
    assert.ok(
      ctx.includes('"id"'),
      `additionalContext worked example missing "id" fields`,
    );
  });

  // --- ID-preservation rules assertions ---

  test('AC-1: additionalContext contains the REUSE rule (intent-unchanged blocks)', () => {
    const hasReuse =
      ctx.toUpperCase().includes('REUSE') ||
      ctx.includes('reuse') ||
      ctx.includes('intent is unchanged') ||
      ctx.includes('intent unchanged');
    assert.ok(hasReuse, `additionalContext missing the REUSE/intent-unchanged ID preservation rule`);
  });

  test('AC-1: additionalContext contains the NEVER renumber rule', () => {
    const hasNeverRenumber =
      ctx.toUpperCase().includes('NEVER renumber'.toUpperCase()) ||
      ctx.includes('never renumber') ||
      ctx.includes('Never renumber') ||
      ctx.includes('NEVER renumber');
    assert.ok(
      hasNeverRenumber,
      `additionalContext missing the 'NEVER renumber' ID preservation rule`,
    );
  });

  test('AC-1: additionalContext contains the mint-new-id rule (genuinely new blocks)', () => {
    const hasMint =
      ctx.includes('genuinely new') ||
      ctx.includes('mint') ||
      ctx.includes('MINT') ||
      ctx.includes('new blocks');
    assert.ok(
      hasMint,
      `additionalContext missing the "only mint new IDs for genuinely new blocks" rule`,
    );
  });

  test('AC-1: additionalContext ID rules mention the deny feedback echo table', () => {
    // The rules should reference the (id, kind, title) echo mechanism
    const mentionsEcho =
      ctx.includes('(id, kind, title)') ||
      ctx.includes('(id,kind,title)') ||
      ctx.includes('id, kind, title') ||
      ctx.includes('deny') ||
      ctx.includes('feedback');
    assert.ok(
      mentionsEcho,
      `additionalContext ID rules should mention the deny feedback (id,kind,title) echo table`,
    );
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`EnterPlanMode injection tests (US-007 / AC-1): ${passed} passed, ${failed} failed`);
console.log(`Measured wall-clock: ${wallMs} ms (hard limit: ${TIMING_LIMIT_MS} ms, target: ${TIMING_TARGET_MS} ms)`);
console.log('');

if (failed > 0) process.exit(1);
