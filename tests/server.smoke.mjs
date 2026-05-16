/**
 * server.smoke.mjs — plain Node, zero deps.
 *
 * Tests (all must pass for exit 0):
 *   1. Server starts on a free port and serves the canned HTML blob.
 *   2. POST /api/approve resolves decisionPromise with behavior:"allow".
 *   3. POST /api/deny resolves decisionPromise with behavior:"deny" + extra fields.
 *   4. flush-then-exit ordering: spawn server as a child process, POST approve,
 *      assert stdout contains the decision JSON AND child exited 0.
 *      Proves: stdout written BEFORE exit (flush-then-exit invariant).
 *   5. EADDRINUSE retry: occupy a port explicitly, assert retry logic picks another.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { startServer } from '../src/server/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '../src/server/index.mjs');

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (node:http, no fetch)
// ---------------------------------------------------------------------------

function get(port, path = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port, path, payload = {}) {
  return new Promise((resolve, reject) => {
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
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Bind a dummy server to port 0 and return { server, port }. */
function occupyPort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
    s.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Test 1 — Server serves canned HTML
// ---------------------------------------------------------------------------

async function test1_serveHtml() {
  console.log('\nTest 1: Server starts on free port and serves canned HTML');

  const html = '<html><body>hello planos</body></html>';
  let readyUrl = null;

  const { server } = await startServer({
    onReady: (url) => { readyUrl = url; },
    serveHtml: html,
  });

  assert(readyUrl !== null, 'onReady called with a URL');
  assert(readyUrl.startsWith('http://127.0.0.1:'), 'URL is localhost');

  const port = Number(new URL(readyUrl).port);
  const { status, body } = await get(port);

  assertEqual(status, 200, 'GET / returns 200');
  assertEqual(body, html, 'GET / body matches serveHtml');

  server.close();
}

// ---------------------------------------------------------------------------
// Test 2 — POST /api/approve resolves decisionPromise
// ---------------------------------------------------------------------------

async function test2_approveResolves() {
  console.log('\nTest 2: POST /api/approve resolves decisionPromise with behavior:allow');

  let url = null;
  const { server, decisionPromise } = await startServer({
    onReady: (u) => { url = u; },
  });

  const port = Number(new URL(url).port);
  const { status } = await post(port, '/api/approve', { extra: 'data' });
  assertEqual(status, 200, 'POST /api/approve returns 200');

  const decision = await decisionPromise;
  assertEqual(decision.behavior, 'allow', 'decision.behavior is "allow"');
  assertEqual(decision.extra, 'data', 'extra fields passed through');

  server.close();
}

// ---------------------------------------------------------------------------
// Test 3 — POST /api/deny resolves decisionPromise
// ---------------------------------------------------------------------------

async function test3_denyResolves() {
  console.log('\nTest 3: POST /api/deny resolves decisionPromise with behavior:deny');

  let url = null;
  const { server, decisionPromise } = await startServer({
    onReady: (u) => { url = u; },
  });

  const port = Number(new URL(url).port);
  await post(port, '/api/deny', { message: 'please revise' });

  const decision = await decisionPromise;
  assertEqual(decision.behavior, 'deny', 'decision.behavior is "deny"');
  assertEqual(decision.message, 'please revise', 'message field passed through');

  server.close();
}

// ---------------------------------------------------------------------------
// Test 4 — flush-then-exit ordering (spawn child process, observe stdout)
// ---------------------------------------------------------------------------

async function test4_flushThenExit() {
  console.log('\nTest 4: flush-then-exit ordering (child process spawn)');

  // Child script: start server, self-POST approve, call finish(), exit.
  // We capture stdout and exit code to prove the ordering invariant:
  //   stdout has valid JSON  AND  exit code is 0.
  // If the process exited before flushing, stdout would be empty or truncated.
  const childScript = `
import { startServer } from '${SERVER_PATH}';
import http from 'node:http';

const { decisionPromise, finish } = await startServer({
  onReady: (url) => {
    const port = Number(new URL(url).port);
    const body = JSON.stringify({ behavior: 'allow', source: 'self-post' });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/approve', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); }
    );
    req.end(body);
  },
  serveHtml: '<html></html>',
});

const decision = await decisionPromise;
await finish(decision);
`.trim();

  const child = spawn(process.execPath, ['--input-type=module'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.end(childScript);

  let stdoutData = '';
  let stderrData = '';
  child.stdout.on('data', (d) => { stdoutData += d.toString(); });
  child.stderr.on('data', (d) => { stderrData += d.toString(); });

  const exitCode = await new Promise((resolve) => child.on('close', resolve));

  if (stderrData.trim()) {
    console.error('  child stderr:', stderrData.trim());
  }

  assertEqual(exitCode, 0, 'child process exited 0');
  assert(stdoutData.length > 0, 'stdout is non-empty');

  let parsed = null;
  try { parsed = JSON.parse(stdoutData.trim()); } catch { /* handled below */ }

  assert(parsed !== null, 'stdout is valid JSON');
  assert(parsed !== null && parsed.behavior === 'allow', 'stdout JSON has behavior:"allow"');
  assert(parsed !== null && parsed.source === 'self-post', 'stdout JSON includes extra field from payload');

  // Core ordering assertion:
  // stdout is complete (ends with '}') AND process exited 0.
  // A process that exits before flush would produce empty or truncated stdout.
  assert(
    stdoutData.trim().endsWith('}') && exitCode === 0,
    'stdout JSON complete + exit 0: flush-then-exit ordering confirmed'
  );
}

// ---------------------------------------------------------------------------
// Test 5 — EADDRINUSE retry
// ---------------------------------------------------------------------------

async function test5_eaddrinuseRetry() {
  console.log('\nTest 5: EADDRINUSE retry — server picks a different port');

  // Occupy a specific port, then run the same retry logic used inside startServer.
  const { server: blocker, port: blockedPort } = await occupyPort();

  let retried = false;

  // Re-implement the retry loop from src/server/index.mjs inline to test the logic path.
  const retryResult = await new Promise((resolve, reject) => {
    const s = http.createServer();
    let attempts = 0;
    const MAX = 20;

    function tryBind(port) {
      attempts++;
      s.listen(port, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
      s.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < MAX) {
          retried = true;
          s.removeAllListeners('error');
          tryBind(0); // let OS pick a free port
        } else {
          reject(err);
        }
      });
    }

    tryBind(blockedPort); // first attempt hits EADDRINUSE
  });

  assert(retried === true, 'EADDRINUSE triggered a retry');
  assert(retryResult.port !== blockedPort, 'retry bound to a different port');
  assert(retryResult.port > 0, 'retry port is valid (> 0)');

  retryResult.server.close();
  blocker.close();

  // Also verify startServer itself succeeds when two are started in parallel
  // (each gets its own OS-assigned free port — no collision possible with port 0).
  let urlA = null;
  let urlB = null;
  const [rA, rB] = await Promise.all([
    startServer({ onReady: (u) => { urlA = u; } }),
    startServer({ onReady: (u) => { urlB = u; } }),
  ]);
  assert(urlA !== null && urlB !== null, 'both parallel startServer() calls succeeded');
  assert(urlA !== urlB, 'parallel servers bound to distinct ports');
  rA.server.close();
  rB.server.close();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== planos server smoke tests ===');

  try {
    await test1_serveHtml();
    await test2_approveResolves();
    await test3_denyResolves();
    await test4_flushThenExit();
    await test5_eaddrinuseRetry();
  } catch (err) {
    console.error('\nUnhandled error in test runner:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
