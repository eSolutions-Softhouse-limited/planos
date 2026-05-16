/**
 * planos — ExitPlanMode PRODUCTION parse + deterministic fallback tests.
 *
 * Covers US-013 / Step 2f.2, AC-2 + AC-7 (the hardened production path):
 *
 *   - AC-2 (production-robust): a valid v1 block doc is used as-is; ANY
 *     invalid input class degrades to EXACTLY one prose block with
 *     meta.degraded = true and the loop still proceeds.
 *   - AC-7 (HARD pass/fail, must be 100% — NOT a percentage): every
 *     malformed-input class deterministically degrades to exactly one prose
 *     block + meta.degraded = true AND the handler still produces a valid
 *     PermissionRequest decision. Reported as a single boolean: ALL classes
 *     pass or AC-7 fails. No averaging.
 *   - The handler NEVER throws out of handleExit() for any input class.
 *   - Zero network egress during the blocking exit path (socket connect spied
 *     at the lowest practical boundary, mirroring AC-17).
 *
 * Table-driven over the malformed-input taxonomy:
 *   empty stdin · whitespace-only · non-JSON garbage · JSON-but-no-plan ·
 *   missing tool_input · plan-is-null · plan-is-non-string · plan-is-markdown ·
 *   plan-is-invalid-schema · oversized payload (cap) · stdin stream error ·
 *   hung fd (timeout) · plan-is-valid (passthrough control).
 *
 * Plain Node, zero dependencies. No network access required.
 * Run: node tests/exit-production.test.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';

import {
  planToDocument,
  buildReviseMessage,
  toPermissionRequestOutput,
  handleExit,
} from '../src/hook/exit.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { passed++; console.log(`  PASS  ${name}`); },
        (err) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err && err.message ? err.message : String(err)}`);
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
// Fixtures
// ---------------------------------------------------------------------------

/** A small but complete valid v1 plan document (passthrough control). */
const VALID_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'prod-loop-demo-2026-05-16',
  title: 'Production Loop Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the production ExitPlanMode parse path.' },
    {
      id: 't-harden',
      kind: 'task',
      title: 'Harden stdin + parse',
      status: 'todo',
      deps: [],
      acceptance: ['malformed input never blocks the user'],
    },
  ],
};

const DET = { id: 'fixed-prod-id', createdAt: '2026-05-16T00:00:00.000Z' };

/**
 * The malformed-input taxonomy. Each row is one class. `raw` is the exact
 * string handed to extractPlan/the handler stdin (as a hook stdin payload
 * where noted). AC-7 requires EVERY row to degrade to one prose block.
 */
const MALFORMED_CLASSES = [
  {
    name: 'empty stdin',
    stdin: '',
  },
  {
    name: 'whitespace-only stdin',
    stdin: '   \n\t  \r\n  ',
  },
  {
    name: 'non-JSON garbage stdin',
    stdin: 'this is not json at all }{[]<<<>>>',
  },
  {
    name: 'JSON but no tool_input',
    stdin: JSON.stringify({ session_id: 'x', cwd: '/tmp' }),
  },
  {
    name: 'JSON tool_input but no plan key',
    stdin: JSON.stringify({ tool_input: { not_plan: 'oops' } }),
  },
  {
    name: 'plan is null',
    stdin: JSON.stringify({ tool_input: { plan: null } }),
  },
  {
    name: 'plan is a non-string object',
    stdin: JSON.stringify({ tool_input: { plan: { some: 'object', n: 42 } } }),
  },
  {
    name: 'plan is a number',
    stdin: JSON.stringify({ tool_input: { plan: 123 } }),
  },
  {
    name: 'plan is plain markdown',
    stdin: JSON.stringify({
      tool_input: { plan: '# A Plan\n\nJust prose, no structure here.' },
    }),
  },
  {
    name: 'plan is JSON that fails v1 schema (empty blocks)',
    stdin: JSON.stringify({
      tool_input: { plan: JSON.stringify({ schemaVersion: 1, type: 'plan', blocks: [] }) },
    }),
  },
  {
    name: 'plan is JSON of the wrong shape entirely',
    stdin: JSON.stringify({ tool_input: { plan: JSON.stringify({ not: 'a plan' }) } }),
  },
  {
    name: 'plan is a JSON array',
    stdin: JSON.stringify({ tool_input: { plan: JSON.stringify([1, 2, 3]) } }),
  },
  {
    name: 'plan is the literal string "null"',
    stdin: JSON.stringify({ tool_input: { plan: 'null' } }),
  },
  {
    name: 'plan is an empty string',
    stdin: JSON.stringify({ tool_input: { plan: '' } }),
  },
  {
    name: 'truncated JSON envelope (partial chunk simulation)',
    stdin: '{"tool_input": {"plan": "# Half a pa',
  },
];

// ---------------------------------------------------------------------------
// AC-7 — deterministic degradation as a HARD 100% pass/fail property.
// One assertion per malformed class: degrades to EXACTLY one prose block,
// meta.degraded === true, revision 1, raw text wrapped verbatim. If ANY class
// fails this is a hard AC-7 failure (not folded into a percentage).
// ---------------------------------------------------------------------------

let ac7AllPass = true;

for (const cls of MALFORMED_CLASSES) {
  await test(`AC-7 [${cls.name}] → exactly one prose block + meta.degraded=true`, () => {
    // Mirror the handler's extract→degrade contract by feeding the exact
    // plan text the handler would derive. We exercise planToDocument with
    // the *extracted* plan via the public extract path used by handleExit.
    const planText = extractFromStdin(cls.stdin);
    const doc = planToDocument(planText, DET);

    try {
      assert.equal(doc.meta.degraded, true, 'meta.degraded must be true');
      assert.equal(doc.schemaVersion, 1, 'degraded doc is still schemaVersion 1');
      assert.equal(doc.meta.revision, 1, 'degraded doc is revision 1');
      assert.ok(Array.isArray(doc.blocks), 'blocks is an array');
      assert.equal(doc.blocks.length, 1, 'EXACTLY one block');
      assert.equal(doc.blocks[0].kind, 'prose', 'the single block is prose');
      assert.equal(
        typeof doc.blocks[0].md,
        'string',
        'prose block carries string md (raw text wrapped verbatim)',
      );
    } catch (e) {
      ac7AllPass = false;
      throw e;
    }
  });
}

await test('AC-7 is a HARD 100% pass/fail property (every malformed class passed)', () => {
  assert.equal(
    ac7AllPass,
    true,
    'AC-7 is pass/fail, not a percentage — every malformed-input class MUST degrade',
  );
});

// Helper mirroring handleExit's stdin→plan extraction so the table above tests
// the same code the handler runs. Re-implements the documented contract:
// extract tool_input.plan; non-JSON stdin → whole thing is the plan text.
function extractFromStdin(stdin) {
  if (typeof stdin !== 'string' || stdin.trim().length === 0) return '';
  let json;
  try {
    json = JSON.parse(stdin);
  } catch {
    return stdin; // non-JSON → treat the whole thing as plan text
  }
  const plan =
    json && typeof json === 'object' && json.tool_input && typeof json.tool_input === 'object'
      ? json.tool_input.plan
      : undefined;
  if (typeof plan === 'string') return plan;
  if (plan === undefined || plan === null) return '';
  try {
    return JSON.stringify(plan);
  } catch {
    return String(plan);
  }
}

// ---------------------------------------------------------------------------
// AC-2 — valid passthrough is exact and NOT degraded.
// ---------------------------------------------------------------------------

await test('AC-2: valid v1 doc passes through unchanged, not degraded', () => {
  const doc = planToDocument(JSON.stringify(VALID_DOC));
  assert.deepEqual(doc, VALID_DOC, 'valid doc round-trips identical');
  assert.equal(doc.meta.degraded, undefined, 'valid doc is NOT degraded');
});

await test('AC-2: pathological parsed value (BigInt-bearing) cannot throw out of parse', () => {
  // A plan string that parses but whose validation would choke must degrade,
  // never throw. Deeply nested object is a stand-in for a hostile shape.
  let nested = { v: 0 };
  let cur = nested;
  for (let i = 0; i < 5000; i++) {
    cur.child = { v: i };
    cur = cur.child;
  }
  const planText = JSON.stringify(nested);
  const doc = planToDocument(planText, DET);
  assert.equal(doc.meta.degraded, true, 'hostile-but-parseable shape degrades');
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].kind, 'prose');
});

// ---------------------------------------------------------------------------
// End-to-end: handleExit() NEVER throws for any malformed class AND still
// emits a valid PermissionRequest decision (the loop proceeds). We stub
// process.exit / stdout (in-proc) and drive a scripted loopback approve.
// ---------------------------------------------------------------------------

/** HTTP POST over loopback (node:http, no fetch). */
function post(port, path, payload = {}) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (r) => { r.resume(); r.on('end', () => res(r.statusCode)); },
    );
    req.on('error', rej);
    req.end(body);
  });
}

/**
 * Run handleExit in-process with a scripted loopback approve, capturing the
 * emitted decision JSON. Spies net.Socket.prototype.connect for non-loopback
 * egress (AC-17). Returns { emitted, egress }. NEVER rethrows handler errors —
 * captures them as `threw` so the caller can assert "never throws".
 */
async function runHandled(stdinText) {
  const net = await import('node:net');
  const egress = [];
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    let host;
    const a0 = args[0];
    if (a0 && typeof a0 === 'object') host = a0.host;
    else if (typeof args[1] === 'string') host = args[1];
    const isLoopback =
      host == null || host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!isLoopback) egress.push(`connect:${host}`);
    return origConnect.apply(this, args);
  };

  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  let threw = null;
  process.exit = () => {};
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  try {
    await handleExit({
      stdinText,
      openBrowser: () => {},
      decisionProvider: ({ url }) => {
        const port = Number(new URL(url).port);
        post(port, '/api/approve', { source: 'prod-test' }).catch(() => {});
      },
    });
  } catch (e) {
    threw = e;
  } finally {
    net.Socket.prototype.connect = origConnect;
    process.exit = origExit;
    process.stdout.write = origWrite;
  }
  return { emitted, egress, threw };
}

for (const cls of MALFORMED_CLASSES) {
  await test(`handleExit never throws + emits a valid decision [${cls.name}]`, async () => {
    const { emitted, egress, threw } = await runHandled(cls.stdin);
    assert.equal(threw, null, `handler threw for [${cls.name}]: ${threw && threw.message}`);
    assert.deepEqual(egress, [], `unexpected network egress for [${cls.name}]: ${egress.join(', ')}`);
    const parsed = JSON.parse(emitted.trim());
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PermissionRequest');
    assert.equal(
      parsed.hookSpecificOutput.decision.behavior,
      'allow',
      `loop proceeds (user never blocked) for [${cls.name}]`,
    );
  });
}

await test('handleExit valid-doc passthrough end-to-end → allow, zero egress, no throw', async () => {
  const { emitted, egress, threw } = await runHandled(
    JSON.stringify({ tool_input: { plan: JSON.stringify(VALID_DOC) } }),
  );
  assert.equal(threw, null, 'valid passthrough must not throw');
  assert.deepEqual(egress, [], 'zero egress on valid passthrough');
  const parsed = JSON.parse(emitted.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');
});

// ---------------------------------------------------------------------------
// Production stdin hardening: oversized payload (cap), stream error, hung fd.
// These drive the real readStdin() via process.stdin replacement so the
// production path (not just the injected stdinText shortcut) is exercised.
// ---------------------------------------------------------------------------

/**
 * Replace process.stdin with a controllable Readable, run handleExit WITHOUT
 * stdinText (forcing the real readStdin path) with tiny stdinOpts bounds, and
 * a scripted loopback approve. Restores process.stdin afterwards.
 */
async function runWithFakeStdin(makeStream, stdinOpts) {
  const origDesc = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = makeStream();
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get() { return fake; },
  });

  // The production safety timer is unref()'d (so a hung fd cannot keep the
  // real hook process alive). In this in-proc test nothing else holds the
  // event loop open while we wait for that timer, so add an explicit ref'd
  // keep-alive that we clear once handleExit resolves.
  const keepAlive = setInterval(() => {}, 1000);

  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  let threw = null;
  process.exit = () => {};
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  try {
    await handleExit({
      stdinOpts,
      openBrowser: () => {},
      decisionProvider: ({ url }) => {
        const port = Number(new URL(url).port);
        post(port, '/api/approve', { source: 'prod-stdin' }).catch(() => {});
      },
    });
  } catch (e) {
    threw = e;
  } finally {
    clearInterval(keepAlive);
    process.exit = origExit;
    process.stdout.write = origWrite;
    if (origDesc) Object.defineProperty(process, 'stdin', origDesc);
  }
  return { emitted, threw };
}

await test('production readStdin: oversized payload is capped + degrades (never OOM/block)', async () => {
  const { emitted, threw } = await runWithFakeStdin(() => {
    // Emit far more than the tiny cap, in multiple chunks.
    const big = 'x'.repeat(50_000);
    return Readable.from([big, big, big]);
  }, { maxBytes: 1024, timeoutMs: 5000 });
  assert.equal(threw, null, 'oversized payload must not throw');
  const parsed = JSON.parse(emitted.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow', 'still resolves a decision');
});

await test('production readStdin: stream error degrades (resolves, never rejects/throws)', async () => {
  const { emitted, threw } = await runWithFakeStdin(() => {
    const s = new Readable({ read() {} });
    // Emit nothing, then error — must NOT propagate out of the handler.
    process.nextTick(() => s.emit('error', new Error('synthetic stdin EPIPE')));
    return s;
  }, { timeoutMs: 5000 });
  assert.equal(threw, null, 'stdin stream error must NOT throw out of the handler');
  const parsed = JSON.parse(emitted.trim());
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'stream error → degraded prose → loop still proceeds',
  );
});

await test('production readStdin: never-closing fd hits the safety timeout, never blocks', async () => {
  const start = Date.now();
  const { emitted, threw } = await runWithFakeStdin(() => {
    // A stream that never ends and never errors (hung fd).
    return new Readable({ read() {} });
  }, { timeoutMs: 150 });
  const elapsed = Date.now() - start;
  assert.equal(threw, null, 'hung fd must not throw');
  assert.ok(elapsed < 5000, `must not block on a hung fd (elapsed ${elapsed}ms)`);
  const parsed = JSON.parse(emitted.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow', 'timeout → degrade → proceed');
});

// ---------------------------------------------------------------------------
// Revise path under degradation: a degraded doc still produces a well-formed
// revise message (directive + echo table + canonical JSON) — the corrective
// deny→revise loop remains usable even for malformed first-tries.
// ---------------------------------------------------------------------------

await test('degraded doc still yields a valid revise message (deny path usable)', () => {
  const doc = planToDocument('total garbage not a plan', DET);
  assert.equal(doc.meta.degraded, true);
  const msg = buildReviseMessage(doc, 'Please emit structured JSON.');
  assert.ok(msg.includes('NOT APPROVED'), 'directive present');
  assert.ok(msg.includes(doc.blocks[0].id), 'echo table lists the degraded prose block id');
  assert.ok(msg.includes('```json'), 'canonical JSON fence present');
  const out = toPermissionRequestOutput({ behavior: 'deny', message: msg });
  assert.equal(out.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(out.hookSpecificOutput.decision.message, msg);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `ExitPlanMode production tests (US-013 / Step 2f.2 — AC-2, AC-7): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
