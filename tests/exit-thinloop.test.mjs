/**
 * planos — ExitPlanMode thin-loop tests (plain Node, zero dependencies).
 *
 * Covers US-008 / Step 2-thin.2:
 *   - AC-2: valid block doc → used unchanged; invalid / plain-markdown input
 *           → exactly one prose block + meta.degraded = true.
 *   - AC-3: server boots a free port, scripted resolve, decision JSON on
 *           stdout, flush-then-exit-0 ordering (spawn as child, assert stdout
 *           complete + exit 0).
 *   - AC-4: scripted approve → stdout decision behavior:"allow", exit 0.
 *   - Revise path → behavior:"deny" AND the message contains the
 *     (id, kind, title) echo table for every block id in the doc.
 *   - A full thin cycle simulation: enter → (canned author doc) → exit →
 *     (canned forced-revise: renumber-pressure doc) → exit, asserting the
 *     echo table is present in the revise message. (Canned/offline — no live
 *     agent; live runs are the user's Milestone 1 gate.)
 *   - Zero network egress during exit (the blocking path is spied: any
 *     outbound socket/DNS attempt fails the test).
 *
 * Run: node tests/exit-thinloop.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  planToDocument,
  renderEchoTable,
  buildReviseMessage,
  toPermissionRequestOutput,
  handleExit,
} from '../src/hook/exit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXIT_MOD = join(__dirname, '../src/hook/exit.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { passed++; console.log(`  PASS  ${name}`); },
        (err) => { failed++; console.log(`  FAIL  ${name}`); console.log(`        ${err && err.message ? err.message : String(err)}`); },
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

/** A small but complete valid v1 plan document. */
const VALID_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'thin-loop-demo-2026-05-16',
  title: 'Thin Loop Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'We are proving the thin ExitPlanMode round-trip.' },
    {
      id: 't-build-loop',
      kind: 'task',
      title: 'Build the thin loop',
      status: 'todo',
      deps: [],
      acceptance: ['enter→exit round-trip works offline'],
    },
    { id: 'q-id-scheme', kind: 'openQuestion', question: 'Which ID scheme do we adopt?' },
  ],
};

/** A "renumber-pressure" revision of VALID_DOC (canned forced-revise input). */
const RENUMBER_PRESSURE_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'thin-loop-demo-2026-05-16',
  title: 'Thin Loop Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 2 },
  blocks: [
    { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'b2', kind: 'prose', md: 'We are proving the thin ExitPlanMode round-trip.' },
    {
      id: 'b3',
      kind: 'task',
      title: 'Build the thin loop',
      status: 'todo',
      deps: [],
      acceptance: ['enter→exit round-trip works offline'],
    },
    { id: 'b4', kind: 'openQuestion', question: 'Which ID scheme do we adopt?' },
  ],
};

/** Helper: HTTP POST (node:http, no fetch). */
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

// ---------------------------------------------------------------------------
// AC-2 — plan → canonical document (pure, no server)
// ---------------------------------------------------------------------------

await test('AC-2: valid v1 block doc is passed through unchanged', () => {
  const doc = planToDocument(JSON.stringify(VALID_DOC));
  assert.deepEqual(doc, VALID_DOC, 'valid doc should round-trip identical');
  assert.equal(doc.meta.degraded, undefined, 'valid doc must NOT be marked degraded');
  assert.equal(doc.blocks.length, 4, 'all blocks preserved');
});

await test('AC-2: plain-markdown input → exactly one prose block + meta.degraded=true', () => {
  const md = '# Just markdown\n\nThis is not a structured plan, just prose.';
  const doc = planToDocument(md, { id: 'fixed-id', createdAt: '2026-05-16T00:00:00.000Z' });
  assert.equal(doc.meta.degraded, true, 'degraded flag must be true');
  assert.equal(doc.blocks.length, 1, 'must be exactly one block');
  assert.equal(doc.blocks[0].kind, 'prose', 'the single block must be prose');
  assert.equal(doc.blocks[0].md, md, 'raw text wrapped verbatim');
  assert.equal(doc.meta.revision, 1, 'degraded doc is revision 1');
});

await test('AC-2: JSON that fails v1 validation → degraded prose (not blocked)', () => {
  const broken = JSON.stringify({ schemaVersion: 1, type: 'plan', blocks: [] });
  const doc = planToDocument(broken, { id: 'fixed-id', createdAt: '2026-05-16T00:00:00.000Z' });
  assert.equal(doc.meta.degraded, true, 'invalid JSON doc must degrade');
  assert.equal(doc.blocks.length, 1, 'exactly one prose block');
  assert.equal(doc.blocks[0].kind, 'prose');
  assert.equal(doc.blocks[0].md, broken, 'original text wrapped verbatim');
});

await test('AC-2: empty / missing plan → degraded prose (never blocks)', () => {
  const doc = planToDocument('', { id: 'fixed-id', createdAt: '2026-05-16T00:00:00.000Z' });
  assert.equal(doc.meta.degraded, true);
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].kind, 'prose');
});

// ---------------------------------------------------------------------------
// Revise (id, kind, title) echo table — design.md §6 mechanism #2
// ---------------------------------------------------------------------------

await test('echo table contains every block id, kind, and a title cell', () => {
  const table = renderEchoTable(VALID_DOC);
  for (const b of VALID_DOC.blocks) {
    assert.ok(table.includes(b.id), `echo table missing id '${b.id}'`);
    assert.ok(table.includes(b.kind), `echo table missing kind '${b.kind}'`);
  }
  assert.ok(table.includes('| id | kind | title |'), 'echo table header present');
  assert.ok(table.includes('REUSE'), 'echo table carries the REUSE directive');
});

await test('revise deny.message = directive + echo table + canonical JSON', () => {
  const msg = buildReviseMessage(VALID_DOC, 'Please split the build task.');
  assert.ok(msg.includes('NOT APPROVED'), 'tuned directive preamble present');
  assert.ok(msg.includes('Please split the build task.'), 'reviewer feedback included');
  for (const b of VALID_DOC.blocks) {
    assert.ok(msg.includes(b.id), `revise message missing block id '${b.id}'`);
  }
  assert.ok(msg.includes('```json'), 'canonical JSON fenced block present');
  assert.ok(msg.includes('"schemaVersion": 2'.replace('2', '1')), 'canonical JSON included');
});

await test('toPermissionRequestOutput: allow shape matches design.md §3', () => {
  const out = toPermissionRequestOutput({ behavior: 'allow' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(out.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(out.hookSpecificOutput.decision.message, undefined, 'allow carries no message');
});

await test('toPermissionRequestOutput: deny shape carries the message', () => {
  const out = toPermissionRequestOutput({ behavior: 'deny', message: 'revise this' });
  assert.equal(out.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(out.hookSpecificOutput.decision.message, 'revise this');
});

// ---------------------------------------------------------------------------
// AC-3 + AC-4 — child-process round-trip (spawn, scripted resolve, stdout,
// flush-then-exit-0 ordering).
// ---------------------------------------------------------------------------

/**
 * Spawn `node plugin/bin/planos exit` with a child wrapper that drives the
 * scripted decision. The wrapper imports handleExit directly so it can inject
 * a decisionProvider that POSTs approve/deny; it asserts ordering by writing
 * the decision JSON to stdout via the server's finish() (flush-then-exit-0).
 *
 * @param {object} doc          plan doc to feed as tool_input.plan
 * @param {'approve'|'deny'} kind
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runScriptedExit(doc, kind) {
  const hookStdin = JSON.stringify({ tool_input: { plan: JSON.stringify(doc) } });
  const childScript = `
import http from 'node:http';
import { handleExit } from '${EXIT_MOD}';

await handleExit({
  stdinText: ${JSON.stringify(hookStdin)},
  openBrowser: () => {},                       // no-op seam (no SPA in thin loop)
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const path = '${kind}' === 'approve' ? '/api/approve' : '/api/deny';
    const payload = '${kind}' === 'approve'
      ? { source: 'scripted-harness' }
      : { feedback: 'Scripted forced-revise.' };
    const body = JSON.stringify(payload);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); },
    );
    req.end(body);
  },
});
`.trim();

  return new Promise((res) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(childScript);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => res({ stdout, stderr, code }));
  });
}

await test('AC-4: scripted approve → stdout behavior:"allow", exit 0, flush-then-exit', async () => {
  const { stdout, stderr, code } = await runScriptedExit(VALID_DOC, 'approve');
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  assert.ok(stdout.trim().length > 0, 'stdout non-empty');
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow');
  // Ordering invariant: stdout JSON complete (ends with '}') AND exit 0.
  assert.ok(stdout.trim().endsWith('}') && code === 0, 'flush-then-exit-0 ordering confirmed');
});

await test('AC-3: server boots free port + scripted deny → behavior:"deny", echo table, exit 0', async () => {
  const { stdout, stderr, code } = await runScriptedExit(VALID_DOC, 'deny');
  assert.equal(code, 0, `exit 0 expected, got ${code}. stderr: ${stderr}`);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'deny');
  const msg = parsed.hookSpecificOutput.decision.message;
  assert.ok(typeof msg === 'string' && msg.length > 0, 'deny carries a message');
  for (const b of VALID_DOC.blocks) {
    assert.ok(msg.includes(b.id), `deny message missing echo-table id '${b.id}'`);
    assert.ok(msg.includes(b.kind), `deny message missing echo-table kind '${b.kind}'`);
  }
  assert.ok(msg.includes('Scripted forced-revise.'), 'reviewer feedback threaded into message');
  assert.ok(stdout.trim().endsWith('}') && code === 0, 'flush-then-exit-0 ordering confirmed');
});

await test('AC-3: invalid plan via the round-trip → degraded prose, still resolves + exits 0', async () => {
  const { stdout, code } = await runScriptedExit(
    /** not a valid doc */ { not: 'a plan' },
    'approve',
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow', 'user never blocked by malformed input');
});

// ---------------------------------------------------------------------------
// Full thin cycle simulation (CANNED, offline):
//   enter → (canned author doc) → exit → (canned forced-revise: renumber-
//   pressure doc) → exit, asserting the echo table is present in the revise
//   message. Live-agent runs are explicitly deferred to the user's Milestone 1.
// ---------------------------------------------------------------------------

await test('thin cycle (canned): enter→author→exit(deny)→forced-revise→exit, echo table present', async () => {
  // Leg 1: agent "authors" VALID_DOC; reviewer hits revise.
  const leg1 = await runScriptedExit(VALID_DOC, 'deny');
  assert.equal(leg1.code, 0, 'leg 1 exits 0');
  const m1 = JSON.parse(leg1.stdout.trim()).hookSpecificOutput.decision;
  assert.equal(m1.behavior, 'deny');
  for (const b of VALID_DOC.blocks) {
    assert.ok(m1.message.includes(b.id), `leg-1 echo table missing '${b.id}'`);
  }

  // Leg 2: agent "revises" but applies renumber pressure (b1..b4). The thin
  // loop must STILL emit the echo table for the (now-renumbered) doc so
  // Milestone 1's ID-preservation measurement sees the full mechanism set.
  const leg2 = await runScriptedExit(RENUMBER_PRESSURE_DOC, 'deny');
  assert.equal(leg2.code, 0, 'leg 2 exits 0');
  const m2 = JSON.parse(leg2.stdout.trim()).hookSpecificOutput.decision;
  assert.equal(m2.behavior, 'deny');
  for (const b of RENUMBER_PRESSURE_DOC.blocks) {
    assert.ok(m2.message.includes(b.id), `leg-2 echo table missing '${b.id}'`);
  }
  assert.ok(m2.message.includes('NOT APPROVED'), 'leg-2 carries the tuned directive');
});

// ---------------------------------------------------------------------------
// AC-17 — zero network egress during the blocking exit path.
//
// We spy the socket layer at the lowest practical boundary (locked decision
// #5): net.Socket.prototype.connect. Any outbound TCP connect to a
// non-loopback address during handleExit() fails the test. A non-loopback
// hostname would also require a DNS lookup, so the same connect interception
// transitively proves no external resolution occurred. (The server's own
// loopback listen + the scripted provider's 127.0.0.1 POST are the only
// permitted sockets — both loopback, in-process.)
// ---------------------------------------------------------------------------

await test('AC-17: zero external network egress during exit (socket connect spied)', async () => {
  const net = await import('node:net');

  const egress = [];
  const origConnect = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function patched(...args) {
    // Inspect the connect options for a non-loopback host.
    let host;
    const a0 = args[0];
    if (a0 && typeof a0 === 'object') host = a0.host;
    else if (typeof args[1] === 'string') host = args[1];
    const isLoopback =
      host == null ||
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1';
    if (!isLoopback) egress.push(`connect:${host}`);
    return origConnect.apply(this, args);
  };

  // Stub process.exit so finish() does not kill this test runner; capture the
  // emitted decision via a stdout spy instead.
  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  process.exit = () => { /* swallowed for in-proc test */ };
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  try {
    await handleExit({
      stdinText: JSON.stringify({ tool_input: { plan: JSON.stringify(VALID_DOC) } }),
      openBrowser: () => {},
      decisionProvider: ({ url }) => {
        const port = Number(new URL(url).port);
        // loopback-only POST — the sole permitted socket.
        post(port, '/api/approve', { source: 'in-proc' }).catch(() => {});
      },
    });
  } finally {
    net.Socket.prototype.connect = origConnect;
    process.exit = origExit;
    process.stdout.write = origWrite;
  }

  assert.deepEqual(egress, [], `unexpected network egress during exit: ${egress.join(', ')}`);
  const parsed = JSON.parse(emitted.trim());
  assert.equal(parsed.hookSpecificOutput.decision.behavior, 'allow', 'decision still emitted offline');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`ExitPlanMode thin-loop tests (US-008 / Step 2-thin.2): ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
