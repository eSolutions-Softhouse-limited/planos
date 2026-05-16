/**
 * planos — AC-17 invariant enforcement (the load-bearing test).
 *
 * Contract: consensus plan AC-17, Step 4.2; docs/design.md §5;
 * docs/notes/ac17-invariant.md.
 *
 * AC-17 (narrow, enforced form): NO model call inside the blocking
 * `ExitPlanMode` hook path. Block IDs are authored by the nondeterministic
 * agent BEFORE the hook (design.md §4) — that authoring is legitimate and out
 * of scope. The enforced invariant is: the path that turns agent output into
 * the canonical artifact and serializes the decision contains no model call.
 *
 * Two enforcement layers, both here:
 *
 *   1. STATIC import-graph walk (tests/harness/import-graph.mjs): a real
 *      module-reachability walk from `bin/planos` (exit path), `src/hook/
 *      exit.mjs`, `src/schema/`, `src/diff/`. Asserts the transitive set
 *      contains NO agent-SDK / model-client / network-client module, and
 *      FAILS CLOSED on any unprovable dynamic import in the reachable set.
 *      Walker correctness (real walk, fail-closed semantics, forbidden-match)
 *      is unit-proven here against synthetic inputs so the suite cannot
 *      silently rot into a no-op.
 *
 *   2. RUNTIME no-egress assertion: spawn `handleExit` in REAL-SPA mode with a
 *      scripted thin decision, with low-level interceptors installed at the
 *      process/socket boundary — node:net connect, node:dns lookup,
 *      node:child_process spawn/exec/fork, global fetch, http(s).request.
 *      Assert ZERO non-loopback egress and ZERO agent/process spawn. The OS
 *      browser-opener is allowed ONLY via the injected no-op (asserted: no
 *      real opener spawn on the test path). Loopback (the local blocking
 *      server) is distinguished from external egress and permitted.
 *
 * Run: node tests/ac17-invariant.test.mjs
 * No network access required. No external dependencies. Plain Node.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as pResolve } from 'node:path';

// CJS handles for the modules we must monkey-patch: an `await import('node:x')`
// ESM namespace is a frozen Module object (its props are read-only), so the
// interceptors are installed on the mutable CommonJS module objects instead.
const require = createRequire(import.meta.url);

import {
  walkImportGraph,
  ac17Roots,
  extractEdges,
  resolveDynamicArg,
  matchForbidden,
} from './harness/import-graph.mjs';
import { handleExit } from '../src/hook/exit.mjs';
import { handlePrd } from '../src/hook/prd.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = pResolve(__dirname, '..');
const rel = (p) => p.replace(`${REPO}/`, '');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => {
          passed++;
          console.log(`  PASS  ${name}`);
        },
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

// A small but complete valid v1 plan document (the canonical artifact the
// blocking exit path turns the agent's authored JSON into).
const VALID_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'ac17-demo-2026-05-16',
  title: 'AC-17 Invariant Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the blocking path makes zero model calls.' },
    {
      id: 't-prove',
      kind: 'task',
      title: 'Prove no egress',
      status: 'todo',
      deps: [],
      acceptance: ['No non-loopback socket', 'No agent spawn'],
    },
    { id: 'q-scheme', kind: 'openQuestion', question: 'Which ID scheme wins?' },
  ],
};

// A small but complete valid v2 PRD document (the canonical artifact the
// blocking `bin/planos prd` path turns the agent's authored JSON into). The
// PRD path is the Phase 2 / Milestone P5 (AC-P15) RE-ASSERTION of AC-17 for the
// NEW blocking entrypoint — it must be just as model/network/spawn-free as the
// exit path, including the src/prd/store.mjs filesystem persistence layer.
const VALID_PRD_DOC = {
  schemaVersion: 1,
  type: 'prd',
  id: 'ac17-prd-demo-2026-05-16',
  title: 'AC-17 PRD Invariant Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    { id: 'p-context', kind: 'prose', md: 'Proving the PRD blocking path makes zero model calls.' },
    { id: 'ph-build', kind: 'phase', title: 'Build phase', taskIds: ['t-prove'] },
    {
      id: 't-prove',
      kind: 'task',
      title: 'Prove no egress on the PRD path',
      status: 'todo',
      deps: [],
      acceptance: ['No non-loopback socket', 'No agent spawn', 'fs writes allowed'],
    },
    {
      id: 'fc-store',
      kind: 'fileChange',
      path: 'src/prd/store.mjs',
      action: 'add',
      rationale: 'Filesystem-only persistence — in-scope-allowed (fs ≠ network/model).',
    },
  ],
};

// ===========================================================================
// LAYER 1a — import-graph walker is a REAL graph walk (not a flat grep) and
// FAILS CLOSED. Proven against synthetic inputs so the assertion is genuine.
// ===========================================================================

await test('walker: extractEdges finds static, require, and dynamic edges', () => {
  const src = `
import { a } from './a.mjs';
export { b } from './b.mjs';
const c = require('./c.cjs');
const d = await import('./d.mjs');
import 'side-effect';
`;
  const edges = extractEdges(src);
  const specs = edges.map((e) => e.specifier);
  assert.ok(specs.includes('./a.mjs'), 'static import edge captured');
  assert.ok(specs.includes('./b.mjs'), 'export-from edge captured');
  assert.ok(specs.includes('./c.cjs'), 'require edge captured');
  assert.ok(specs.includes('./d.mjs'), 'dynamic import literal captured');
  assert.ok(specs.includes('side-effect'), 'bare side-effect import captured');
});

await test('walker: comments and string contents never produce phantom edges', () => {
  const src = `
// import { fake } from 'commented-out';
/* require('also-commented') */
const s = "this string mentions import('not-real') but is data";
import { real } from './real.mjs';
`;
  const specs = extractEdges(src).map((e) => e.specifier);
  assert.ok(specs.includes('./real.mjs'), 'the real edge is found');
  assert.ok(!specs.includes('commented-out'), 'commented import is NOT an edge');
  assert.ok(!specs.includes('also-commented'), 'commented require is NOT an edge');
  assert.ok(!specs.includes('not-real'), 'string-literal import text is NOT an edge');
});

await test('walker: balanced-paren scan unwraps the dispatcher resolve() form', () => {
  const src = `const m = await import(resolve(__dirname, '../../src/hook/exit.mjs'));`;
  const edges = extractEdges(src);
  const dyn = edges.find((e) => e.kind === 'dynamic');
  assert.ok(dyn, 'dynamic edge present');
  assert.equal(
    dyn.specifier,
    '../../src/hook/exit.mjs',
    'resolve(__dirname, "<lit>") is provable → literal segment extracted',
  );
});

await test('walker: resolveDynamicArg returns null for a NON-literal specifier (fail-closed trigger)', () => {
  assert.equal(resolveDynamicArg("'./ok.mjs'"), './ok.mjs', 'pure literal → provable');
  assert.equal(resolveDynamicArg('resolve(__dirname, x)'), null, 'variable arg → unprovable');
  assert.equal(resolveDynamicArg('someVar'), null, 'bare identifier → unprovable');
  assert.equal(resolveDynamicArg('`./` + name'), null, 'template concat → unprovable');
});

await test('walker: a reachable UNPROVABLE dynamic import fails the graph CLOSED', () => {
  // Synthetic root that imports a module which performs a non-literal dynamic
  // import. The walker must reach it and flag unprovable-dynamic-import.
  const fixtureDir = join(__dirname, 'fixtures');
  const evilRoot = join(fixtureDir, '__ac17_tmp_root.mjs');
  const evilDep = join(fixtureDir, '__ac17_tmp_dep.mjs');
  fs.writeFileSync(evilRoot, `import './__ac17_tmp_dep.mjs';\n`);
  fs.writeFileSync(
    evilDep,
    `const n = process.env.MOD; const m = await import(n);\nexport const x = 1;\n`,
  );
  try {
    const result = walkImportGraph([evilRoot]);
    assert.equal(result.clean, false, 'graph with unprovable dynamic import is DIRTY');
    const v = result.violations.find((x) => x.reason === 'unprovable-dynamic-import');
    assert.ok(v, 'an unprovable-dynamic-import violation is reported');
    assert.ok(
      result.modules.some((m) => m.endsWith('__ac17_tmp_dep.mjs')),
      'the walk actually REACHED the offending module (real graph walk, not grep)',
    );
  } finally {
    fs.unlinkSync(evilRoot);
    fs.unlinkSync(evilDep);
  }
});

await test('walker: a reachable forbidden agent-SDK import is detected', () => {
  const fixtureDir = join(__dirname, 'fixtures');
  const root = join(fixtureDir, '__ac17_tmp_sdk_root.mjs');
  const dep = join(fixtureDir, '__ac17_tmp_sdk_dep.mjs');
  fs.writeFileSync(root, `import './__ac17_tmp_sdk_dep.mjs';\n`);
  fs.writeFileSync(dep, `import Anthropic from '@anthropic-ai/sdk';\nexport const y = 1;\n`);
  try {
    const result = walkImportGraph([root]);
    assert.equal(result.clean, false, 'graph importing an agent SDK is DIRTY');
    const v = result.violations.find((x) => x.reason === 'forbidden-module');
    assert.ok(v, 'forbidden-module violation reported');
    assert.ok(v.detail.includes('@anthropic-ai/sdk'), 'names the offending module');
  } finally {
    fs.unlinkSync(root);
    fs.unlinkSync(dep);
  }
});

await test('walker: matchForbidden covers scoped, bare, subpath, and clean specs', () => {
  assert.ok(matchForbidden('@anthropic-ai/sdk'), 'scoped exact');
  assert.ok(matchForbidden('@anthropic-ai/claude-agent-sdk'), 'scoped agent sdk');
  assert.ok(matchForbidden('openai'), 'bare model client');
  assert.ok(matchForbidden('openai/resources'), 'model client subpath');
  assert.ok(matchForbidden('@ai-sdk/openai'), 'scoped-prefix family');
  assert.ok(matchForbidden('axios'), 'network client wrapper');
  assert.equal(matchForbidden('node:http'), null, 'node builtin is NOT forbidden');
  assert.equal(matchForbidden('./schema/index.mjs'), null, 'local path is NOT forbidden');
  assert.equal(matchForbidden('node:child_process'), null, 'child_process is the allowed boundary');
});

// ===========================================================================
// LAYER 1b — the REAL AC-17 static assertion over the actual repo roots.
// ===========================================================================

await test('AC-17 STATIC: blocking/artifact/ID transitive set is model-free (real graph walk)', () => {
  const result = walkImportGraph(ac17Roots());

  // The walk must be real: bin/planos's resolve(__dirname,'<lit>') dynamic
  // imports must have been followed into the hook modules, and enter.mjs's
  // `await import('../schema/index.mjs')` literal dynamic import too.
  const names = result.modules.map(rel);
  for (const expected of [
    'plugin/bin/planos',
    'src/hook/exit.mjs',
    'src/hook/enter.mjs',
    'src/server/index.mjs',
    'src/schema/index.mjs',
    'src/schema/validate.mjs',
    'src/schema/fallback.mjs',
    'src/schema/envelope.mjs',
    'src/schema/id-strategy.mjs',
    'src/diff/structural.mjs',
    'src/diff/reanchor.mjs',
    // Phase 2 / Milestone P5 (AC-P15) — the NEW bin/planos prd blocking
    // entrypoint + its transitive set MUST be in the audited closure. The
    // bin/planos dispatcher reaches prd.mjs via the same provable
    // resolve(__dirname,'<lit>') unwrap as exit.mjs, and ac17Roots() now also
    // lists these explicitly so the re-assertion is dispatcher-independent.
    'src/hook/prd.mjs',
    'src/hook/roundtrip.mjs',
    'src/prd/store.mjs',
  ]) {
    assert.ok(
      names.includes(expected),
      `transitive set must include ${expected} (proves a real reachability walk, not a grep)`,
    );
  }

  assert.deepEqual(
    result.violations,
    [],
    `AC-17 static violations: ${result.violations
      .map((v) => `[${v.reason}] ${rel(v.from)}: ${v.detail}`)
      .join(' | ')}`,
  );
  assert.equal(result.clean, true, 'AC-17 import-graph verdict must be CLEAN');

  // Print the transitive set + verdict for the run log (acceptance evidence).
  console.log('');
  console.log(`        AC-17 transitive module set (${result.modules.length}):`);
  for (const m of names) console.log(`          - ${m}`);
  console.log(`        edges walked: ${result.edges.length}`);
  console.log('        VERDICT: CLEAN (model-free, fail-closed on dynamic specifiers)');
});

// ===========================================================================
// LAYER 2 — RUNTIME no-egress / no-spawn assertion during `bin/planos exit`.
//
// Interceptors are installed at the lowest practical process/socket boundary
// (locked decision #5 / Step 4.2 executor guidance): node:net connect,
// node:dns lookup/resolve, node:child_process spawn/exec/fork, global fetch,
// and http(s).request. Loopback (the local blocking server + the scripted
// loopback POST) is distinguished from external egress and permitted; the OS
// browser-opener is allowed ONLY via the injected no-op (asserted: it is
// never the real opener on the test path).
// ===========================================================================

await test('AC-17 RUNTIME: zero external egress + zero agent/process spawn during real-SPA exit', async () => {
  // Mutable CJS handles (ESM namespaces are frozen — see top-of-file note).
  const net = require('node:net');
  const dns = require('node:dns');
  const cp = require('node:child_process');
  const http = require('node:http');
  const https = require('node:https');

  const egress = [];
  const spawns = [];
  const dnsLookups = [];

  const isLoopbackHost = (host) =>
    host == null ||
    host === '' ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0';

  // --- node:net connect (the lowest socket boundary; a non-loopback hostname
  //     would additionally require DNS, so this also transitively proves no
  //     external resolution path was taken to completion). -------------------
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    let host;
    const a0 = args[0];
    if (a0 && typeof a0 === 'object') host = a0.host ?? a0.path;
    else if (typeof args[1] === 'string') host = args[1];
    if (!isLoopbackHost(host)) egress.push(`net.connect:${host}`);
    return origConnect.apply(this, args);
  };

  // --- node:dns — any external name resolution is forbidden (loopback names
  //     do not need DNS; a lookup of anything else is an egress signal). The
  //     net.connect spy above is the LOAD-BEARING boundary (an external
  //     connect cannot complete without it); these dns spies are a
  //     defense-in-depth layer. Patching is best-effort: if a runtime froze
  //     the property we skip it rather than fail — the socket boundary still
  //     proves the invariant. -------------------------------------------------
  const origLookup = dns.lookup;
  const origPromisesLookup = dns.promises && dns.promises.lookup;
  const safeSet = (obj, key, value) => {
    try {
      obj[key] = value;
      return obj[key] === value;
    } catch {
      return false;
    }
  };
  function spyLookup(hostname, ...rest) {
    if (!isLoopbackHost(hostname)) {
      dnsLookups.push(`dns.lookup:${hostname}`);
      egress.push(`dns.lookup:${hostname}`);
    }
    return origLookup.call(dns, hostname, ...rest);
  }
  const lookupPatched = safeSet(dns, 'lookup', spyLookup);
  let promisesLookupPatched = false;
  if (dns.promises && origPromisesLookup) {
    promisesLookupPatched = safeSet(
      dns.promises,
      'lookup',
      function spyPromisesLookup(hostname, ...rest) {
        if (!isLoopbackHost(hostname)) {
          dnsLookups.push(`dns.promises.lookup:${hostname}`);
          egress.push(`dns.promises.lookup:${hostname}`);
        }
        return origPromisesLookup.call(dns.promises, hostname, ...rest);
      },
    );
  }

  // --- node:child_process — ANY spawn/exec/fork during the blocking path is
  //     a violation here. The real OS browser-opener is the documented
  //     allowed boundary, but the test injects a NO-OP opener, so on the test
  //     path there must be ZERO process creation at all. -----------------------
  const cpMethods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const origCp = {};
  for (const meth of cpMethods) {
    origCp[meth] = cp[meth];
    cp[meth] = function blockedSpawn(cmd) {
      spawns.push(`child_process.${meth}:${String(cmd)}`);
      // Do NOT actually spawn — record and throw a benign, swallowed marker so
      // the blocking path's fire-and-forget opener degrades gracefully (it
      // never should reach here because the opener is the injected no-op).
      const e = new Error(`AC-17: child_process.${meth} blocked in test`);
      e.code = 'AC17_BLOCKED';
      throw e;
    };
  }

  // --- global fetch + http(s).request — high-level egress surfaces. The
  //     blocking server's OWN loopback request (the scripted browser POST to
  //     127.0.0.1) is permitted; any non-loopback target is an egress. ------
  const origFetch = globalThis.fetch;
  if (typeof origFetch === 'function') {
    globalThis.fetch = function spyFetch(input, init) {
      let host;
      try {
        host = new URL(typeof input === 'string' ? input : input.url).hostname;
      } catch {
        host = String(input);
      }
      if (!isLoopbackHost(host)) egress.push(`fetch:${host}`);
      return origFetch.call(globalThis, input, init);
    };
  }
  const wrapRequest = (mod, name) => {
    const orig = mod.request;
    mod.request = function spyRequest(opts, ...rest) {
      let host;
      if (typeof opts === 'string') {
        try {
          host = new URL(opts).hostname;
        } catch {
          host = opts;
        }
      } else if (opts && typeof opts === 'object') {
        host = opts.host ?? opts.hostname;
      }
      if (!isLoopbackHost(host)) egress.push(`${name}.request:${host}`);
      return orig.call(mod, opts, ...rest);
    };
    return () => {
      mod.request = orig;
    };
  };
  const restoreHttp = wrapRequest(http, 'http');
  const restoreHttps = wrapRequest(https, 'https');

  // Stub process.exit so finish() does not kill this runner; capture stdout.
  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  process.exit = () => {};
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  let realOpenerSpawned = false;
  try {
    // REAL-SPA mode: NO decisionProvider (production path — the prebuilt
    // editor is served and the browser drives the decision). The browser is
    // simulated by the injected NO-OP-replacing opener: instead of spawning a
    // real OS opener (AC-17 — the harness MUST NOT spawn one), it performs
    // the loopback GET/POST a real browser/loader would, so the blocking
    // promise resolves deterministically. Its ONLY socket is loopback.
    await handleExit({
      stdinText: JSON.stringify({ tool_input: { plan: JSON.stringify(VALID_DOC) } }),
      openBrowser: (url) => {
        realOpenerSpawned = false; // explicit: no real OS opener was spawned
        const port = Number(new URL(url).port);
        const body = JSON.stringify({ source: 'ac17-runtime' });
        // node:http to 127.0.0.1 — the SOLE permitted (loopback) socket.
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/approve',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (r) => r.resume(),
        );
        req.on('error', () => {});
        req.end(body);
      },
    });
  } finally {
    net.Socket.prototype.connect = origConnect;
    if (lookupPatched) safeSet(dns, 'lookup', origLookup);
    if (promisesLookupPatched) safeSet(dns.promises, 'lookup', origPromisesLookup);
    for (const meth of cpMethods) cp[meth] = origCp[meth];
    if (typeof origFetch === 'function') globalThis.fetch = origFetch;
    restoreHttp();
    restoreHttps();
    process.exit = origExit;
    process.stdout.write = origWrite;
  }

  assert.deepEqual(
    egress,
    [],
    `AC-17 VIOLATION — non-loopback network egress during exit: ${egress.join(', ')}`,
  );
  assert.deepEqual(
    dnsLookups,
    [],
    `AC-17 VIOLATION — external DNS resolution during exit: ${dnsLookups.join(', ')}`,
  );
  assert.deepEqual(
    spawns,
    [],
    `AC-17 VIOLATION — process/agent spawn during exit (the injected no-op opener must NOT spawn): ${spawns.join(', ')}`,
  );
  assert.equal(realOpenerSpawned, false, 'the real OS browser-opener was never invoked on the test path');

  const parsed = JSON.parse(emitted.trim());
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'the decision is still emitted offline with zero egress + zero spawn',
  );
});

// ===========================================================================
// LAYER 2b — RUNTIME no-egress / no-spawn assertion during `bin/planos prd`
// (Phase 2 / Milestone P5 — AC-P15: AC-17 RE-ASSERTED for the NEW blocking
// entrypoint). Mirrors LAYER 2 EXACTLY — same lowest-boundary interceptors
// (node:net connect, node:dns lookup, node:child_process spawn/exec/fork,
// global fetch, http(s).request) — but drives `handlePrd` (the bin/planos prd
// dispatch target) instead of `handleExit`. Asserts ZERO non-loopback egress
// and ZERO agent/process spawn through the prd → server → schema → diff →
// src/prd/store.mjs path. The src/prd/store.mjs `node:fs` revision writes are
// explicitly in-scope-allowed (filesystem ≠ network/model — the SAME boundary
// logic as the exit.mjs browser-opener note); they happen against a private
// mkdtemp root so the repo's real prds/ tree is never touched. The SCRIPTED
// decisionProvider seam keeps it fully offline (no SPA, loopback POST only).
// ===========================================================================

await test('AC-17 RUNTIME (PRD): zero external egress + zero agent/process spawn during scripted bin/planos prd', async () => {
  // Mutable CJS handles (ESM namespaces are frozen — see top-of-file note).
  const net = require('node:net');
  const dns = require('node:dns');
  const cp = require('node:child_process');
  const http = require('node:http');
  const https = require('node:https');

  const egress = [];
  const spawns = [];
  const dnsLookups = [];

  const isLoopbackHost = (host) =>
    host == null ||
    host === '' ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0';

  // --- node:net connect (the lowest socket boundary; LOAD-BEARING). ---------
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    let host;
    const a0 = args[0];
    if (a0 && typeof a0 === 'object') host = a0.host ?? a0.path;
    else if (typeof args[1] === 'string') host = args[1];
    if (!isLoopbackHost(host)) egress.push(`net.connect:${host}`);
    return origConnect.apply(this, args);
  };

  // --- node:dns (defense-in-depth; best-effort patch). ----------------------
  const origLookup = dns.lookup;
  const origPromisesLookup = dns.promises && dns.promises.lookup;
  const safeSet = (obj, key, value) => {
    try {
      obj[key] = value;
      return obj[key] === value;
    } catch {
      return false;
    }
  };
  function spyLookup(hostname, ...rest) {
    if (!isLoopbackHost(hostname)) {
      dnsLookups.push(`dns.lookup:${hostname}`);
      egress.push(`dns.lookup:${hostname}`);
    }
    return origLookup.call(dns, hostname, ...rest);
  }
  const lookupPatched = safeSet(dns, 'lookup', spyLookup);
  let promisesLookupPatched = false;
  if (dns.promises && origPromisesLookup) {
    promisesLookupPatched = safeSet(
      dns.promises,
      'lookup',
      function spyPromisesLookup(hostname, ...rest) {
        if (!isLoopbackHost(hostname)) {
          dnsLookups.push(`dns.promises.lookup:${hostname}`);
          egress.push(`dns.promises.lookup:${hostname}`);
        }
        return origPromisesLookup.call(dns.promises, hostname, ...rest);
      },
    );
  }

  // --- node:child_process — ANY spawn/exec/fork on the prd blocking path is a
  //     violation here (the test injects a NO-OP opener, so ZERO process
  //     creation must occur). -------------------------------------------------
  const cpMethods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const origCp = {};
  for (const meth of cpMethods) {
    origCp[meth] = cp[meth];
    cp[meth] = function blockedSpawn(cmd) {
      spawns.push(`child_process.${meth}:${String(cmd)}`);
      const e = new Error(`AC-17: child_process.${meth} blocked in test`);
      e.code = 'AC17_BLOCKED';
      throw e;
    };
  }

  // --- global fetch + http(s).request — high-level egress surfaces. The
  //     scripted loopback POST (127.0.0.1) is permitted; non-loopback = egress.
  const origFetch = globalThis.fetch;
  if (typeof origFetch === 'function') {
    globalThis.fetch = function spyFetch(input, init) {
      let host;
      try {
        host = new URL(typeof input === 'string' ? input : input.url).hostname;
      } catch {
        host = String(input);
      }
      if (!isLoopbackHost(host)) egress.push(`fetch:${host}`);
      return origFetch.call(globalThis, input, init);
    };
  }
  const wrapRequest = (mod, name) => {
    const orig = mod.request;
    mod.request = function spyRequest(opts, ...rest) {
      let host;
      if (typeof opts === 'string') {
        try {
          host = new URL(opts).hostname;
        } catch {
          host = opts;
        }
      } else if (opts && typeof opts === 'object') {
        host = opts.host ?? opts.hostname;
      }
      if (!isLoopbackHost(host)) egress.push(`${name}.request:${host}`);
      return orig.call(mod, opts, ...rest);
    };
    return () => {
      mod.request = orig;
    };
  };
  const restoreHttp = wrapRequest(http, 'http');
  const restoreHttps = wrapRequest(https, 'https');

  // Stub process.exit so finish() does not kill this runner; capture stdout.
  const origExit = process.exit;
  const origWrite = process.stdout.write;
  let emitted = '';
  process.exit = () => {};
  process.stdout.write = function spy(chunk, enc, cb) {
    emitted += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };

  // Private persistence root — the repo's real prds/ tree is NEVER touched;
  // src/prd/store.mjs fs writes land here (in-scope-allowed: fs ≠ egress).
  const prdRoot = mkdtempSync(join(tmpdir(), 'planos-ac17-prd-'));

  let realOpenerSpawned = false;
  try {
    // SCRIPTED mode: a decisionProvider is injected (no SPA, no /api/prd
    // handlers). It performs the SOLE permitted socket — a loopback POST to
    // 127.0.0.1/api/approve — exactly as a real browser/loader would, so the
    // blocking promise resolves deterministically and src/prd/store.mjs
    // persists r001 to the tmpdir. NO real OS opener is ever spawned.
    await handlePrd({
      stdinText: JSON.stringify({
        tool_input: { plan: JSON.stringify(VALID_PRD_DOC) },
      }),
      rootDir: prdRoot,
      openBrowser: () => {
        realOpenerSpawned = false; // explicit: no real OS opener was spawned
      },
      decisionProvider: ({ url }) => {
        const port = Number(new URL(url).port);
        const body = JSON.stringify({ source: 'ac17-prd-runtime' });
        // node:http to 127.0.0.1 — the SOLE permitted (loopback) socket.
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/approve',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (r) => r.resume(),
        );
        req.on('error', () => {});
        req.end(body);
      },
    });
  } finally {
    net.Socket.prototype.connect = origConnect;
    if (lookupPatched) safeSet(dns, 'lookup', origLookup);
    if (promisesLookupPatched) safeSet(dns.promises, 'lookup', origPromisesLookup);
    for (const meth of cpMethods) cp[meth] = origCp[meth];
    if (typeof origFetch === 'function') globalThis.fetch = origFetch;
    restoreHttp();
    restoreHttps();
    process.exit = origExit;
    process.stdout.write = origWrite;
    rmSync(prdRoot, { recursive: true, force: true });
  }

  assert.deepEqual(
    egress,
    [],
    `AC-17 VIOLATION — non-loopback network egress during bin/planos prd: ${egress.join(', ')}`,
  );
  assert.deepEqual(
    dnsLookups,
    [],
    `AC-17 VIOLATION — external DNS resolution during bin/planos prd: ${dnsLookups.join(', ')}`,
  );
  assert.deepEqual(
    spawns,
    [],
    `AC-17 VIOLATION — process/agent spawn during bin/planos prd (filesystem persistence must NOT spawn): ${spawns.join(', ')}`,
  );
  assert.equal(realOpenerSpawned, false, 'the real OS browser-opener was never invoked on the prd test path');

  const parsed = JSON.parse(emitted.trim());
  assert.equal(
    parsed.hookSpecificOutput.hookEventName,
    'PrdRoundTrip',
    'the PRD round-trip emitted its decision offline',
  );
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'the PRD decision is still emitted offline with zero egress + zero spawn',
  );
  assert.equal(
    parsed.hookSpecificOutput.prd.persisted,
    true,
    'src/prd/store.mjs persisted the revision via node:fs (filesystem write is in-scope-allowed: fs ≠ network/model)',
  );
});

// ===========================================================================
// LAYER 3 — the allow/deny boundary doc exists and crisply states the rule.
// ===========================================================================

await test('AC-17 BOUNDARY DOC: docs/notes/ac17-invariant.md states the allow/deny boundary', () => {
  const docPath = join(REPO, 'docs/notes/ac17-invariant.md');
  let body;
  try {
    body = fs.readFileSync(docPath, 'utf8');
  } catch {
    assert.fail(`docs/notes/ac17-invariant.md is missing — the allow/deny boundary must be documented`);
  }
  // Legitimate (allowed): pre-plan-mode live-agent interview.
  assert.match(body, /interview/i, 'doc names the interview');
  assert.match(body, /before plan mode|pre-plan-mode|before the blocking hook/i, 'doc places the interview BEFORE the blocking hook');
  assert.match(body, /legitimate|allowed|out of scope/i, 'doc marks the interview as legitimate / out of scope');
  // Forbidden: any model call reachable from the blocking exit / artifact / ID set.
  assert.match(body, /bin\/planos exit|ExitPlanMode/i, 'doc names the blocking entrypoint');
  assert.match(body, /forbidden|must not|no model call/i, 'doc states what is forbidden');
  assert.match(body, /agent-?minted ID|agent loop before|authored.*before the/i, 'doc states authoring (incl. agent-minted IDs) happens BEFORE the hook');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`AC-17 invariant tests (US-021 / Step 4.2): ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
