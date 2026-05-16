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
import { handleReview } from '../src/hook/review.mjs';
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

// A small but complete valid v3 diff-review document (the canonical artifact
// the blocking `bin/planos review` path turns the agent's authored JSON into).
// The review path is the Phase 3 / Milestone R5 (AC-R13) RE-ASSERTION of AC-17
// for the NEW blocking entrypoint — it must be just as model/network/spawn-free
// as the exit AND prd paths, INCLUDING that `gh`/`git` are absent from the
// blocking transitive set (the R1 crux: ingestion runs in the pre-server CLI
// agent loop; src/review/ingest.mjs is a pure zero-import parser). R2 =
// ephemeral, so there is NO persistence layer — the review result is the
// returned structured envelope only.
const VALID_REVIEW_DOC = {
  schemaVersion: 1,
  type: 'diff-review',
  id: 'ac17-review-demo-2026-05-16',
  title: 'AC-17 Diff-Review Invariant Demo',
  meta: { status: 'draft', createdAt: '2026-05-16T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 's-overview', kind: 'section', title: 'Overview', level: 1 },
    {
      id: 'p-context',
      kind: 'prose',
      md: 'Proving the diff-review blocking path makes zero model calls and never spawns gh/git.',
    },
    {
      id: 'dr-1',
      kind: 'diff',
      path: 'src/example.mjs',
      status: 'modified',
      hunks: [
        {
          hunkId: 'dr-1-h1',
          header: '@@ -1,3 +1,4 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [
            { op: ' ', text: 'const a = 1;' },
            { op: '+', text: 'const b = 2;' },
            { op: ' ', text: 'export { a };' },
          ],
        },
      ],
      comments: [
        {
          commentId: 'dr-1-c1',
          hunkId: 'dr-1-h1',
          text: 'Looks correct — accept this hunk.',
          verdict: 'accept',
        },
      ],
    },
    {
      id: 'q-scope',
      kind: 'openQuestion',
      question: 'Is the diff scope correct for this PR?',
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
  // The walk must be real over the ACTUAL dispatcher source-of-truth. The
  // shipped plugin/bin/planos is now an esbuild bundle of
  // src/bin/planos-entry.mjs (the static-import SOURCE dispatcher) — the
  // bundled file is edgeless, so the real reachability walk follows the
  // dispatcher's enter/exit/prd/review/export edges via the SOURCE entry
  // instead (and enter.mjs's `await import('../schema/index.mjs')` literal
  // dynamic import too). This adds ONE extra walk root; ac17Roots() itself
  // stays byte-frozen — the deepEqual below + the AC-Q12 negative proof remain
  // intact, both deriving from the UNCHANGED ac17Roots() (ADR-0004 / ADR-0006).
  const result = walkImportGraph([
    ...ac17Roots(),
    pResolve(REPO, 'src/bin/planos-entry.mjs'),
  ]);

  const names = result.modules.map(rel);
  for (const expected of [
    'plugin/bin/planos',
    'src/bin/planos-entry.mjs',
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
    // Phase 3 / Milestone R5 (AC-R13) — the NEW bin/planos review blocking
    // entrypoint + its transitive set MUST be in the audited closure. The
    // bin/planos dispatcher reaches review.mjs via the same provable
    // resolve(__dirname,'<lit>') unwrap as exit.mjs/prd.mjs, and ac17Roots()
    // now also lists these explicitly so the re-assertion is
    // dispatcher-independent. src/review/ingest.mjs is the PURE zero-import
    // unified-diff parser (R1 Option A — gh/git run pre-server, never in the
    // blocking path). NO src/review/store.mjs: R2 = ephemeral.
    'src/hook/review.mjs',
    'src/review/ingest.mjs',
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
// LAYER 1b (Phase 4 / Milestone Q5 — AC-Q12): the AC-17 NEGATIVE re-assertion.
//
// Phase 4 adds polish/distribution surfaces (themes, markdown export SPA+CLI,
// PDF-via-window.print, marketplace listing) but NO new entry mode and NO new
// blocking-path engine work. Its headline AC-17 work is a NEGATIVE proof: the
// markdown-export feature can NEVER run during a blocking round-trip because
// its modules are ABSENT from the transitive import closure of the blocking
// roots `bin/planos exit|prd|review`.
//
// This is *stronger* than adding `src/export/markdown.mjs` / `src/hook/
// export.mjs` as audited roots (the way Phase 2 added prd + Phase 3 added
// review modules to the blocking closure): instead of proving "the export
// path is also model-free", it proves "no blocking handler can even reach
// export" — the polish surface is strictly OUTSIDE the audited blocking set.
// It mirrors EXACTLY how Phase 3 R1 (Option A) proved `gh`/`git` absent from
// the blocking transitive set (the pre-server-CLI doctrine), now applied to a
// post-server CLI surface (`bin/planos export`) + a SPA-side serializer.
//
// Crucially `ac17Roots()` in tests/harness/import-graph.mjs is UNCHANGED —
// the export modules are deliberately NOT added as blocking roots (they are
// not `bin/planos exit|prd|review` roots and are never imported by one). This
// test asserts that fact directly, two ways:
//
//   1. `ac17Roots()` still lists EXACTLY the Phase-1/2/3 blocking + schema +
//      diff roots — no export/theme root was silently added (a regression that
//      did so would defeat the negative re-assertion by turning it into a
//      weaker audited-root inclusion).
//
//   2. The negative proof is over the closure of the BLOCKING HANDLER roots
//      `src/hook/exit.mjs`, `src/hook/prd.mjs`, `src/hook/review.mjs` (+ their
//      transitive sets — schema/diff/roundtrip/store/ingest, exactly the
//      ac17Roots() set MINUS the `plugin/bin/planos` dispatcher). The
//      dispatcher is deliberately EXCLUDED from THIS sub-walk: `plugin/bin/
//      planos` has a `case 'export'` that reaches `src/hook/export.mjs` via
//      the SAME provable `resolve(__dirname,'<lit>')` unwrap it uses for
//      exit/prd/review — that is the dispatcher routing to the legitimately
//      OUT-OF-BLOCKING-PATH `bin/planos export` subcommand and is expected and
//      fine. AC-Q12 (plan §4, §6) is precisely "export ABSENT from the closure
//      of `bin/planos exit|prd|review`" — the blocking HANDLERS, not the
//      multi-subcommand dispatcher. The crux: no BLOCKING handler can reach
//      export, even though the shared dispatcher (which also routes the
//      non-blocking `export` subcommand) trivially can.
//
// `node tests/harness/import-graph.mjs` stays VERDICT CLEAN over the full
// UNCHANGED `ac17Roots()` (proven by the LAYER 1b positive test above — same
// closure, same roots, dispatcher included).
// ===========================================================================

await test('AC-17 STATIC (Q5/AC-Q12 NEGATIVE): export + SPA-only modules are ABSENT from the bin/planos exit|prd|review blocking closure', () => {
  // (a) ac17Roots() is UNCHANGED — no export/theme root was silently added.
  //     The root set is EXACTLY the dispatcher + Phase-1 (exit) + Phase-2 (prd
  //     + roundtrip + prd/store) + Phase-3 (review + review/ingest) + schema +
  //     diff roots. Phase 4 adds ZERO root — that is the whole point of the
  //     negative proof. Asserting the exact set here makes a regression that
  //     adds an export root to ac17Roots() FAIL loudly (it would defeat the
  //     negative re-assertion by turning it into a weaker audited-root
  //     inclusion).
  const roots = ac17Roots();
  const rootNames = roots.map((r) => rel(pResolve(r)));
  assert.deepEqual(
    [...rootNames].sort(),
    [
      'plugin/bin/planos',
      'src/diff/reanchor.mjs',
      'src/diff/structural.mjs',
      'src/hook/exit.mjs',
      'src/hook/prd.mjs',
      'src/hook/review.mjs',
      'src/hook/roundtrip.mjs',
      'src/prd/store.mjs',
      'src/review/ingest.mjs',
      'src/schema/envelope.mjs',
      'src/schema/fallback.mjs',
      'src/schema/id-strategy.mjs',
      'src/schema/index.mjs',
      'src/schema/validate.mjs',
    ],
    'ac17Roots() must be UNCHANGED — Phase 4 adds NO blocking root (the negative ' +
      'proof, AC-Q12: export modules are proven OUTSIDE the closure, never added to it)',
  );

  // The negative proof is over the closure of the BLOCKING HANDLER roots —
  // ac17Roots() MINUS the `plugin/bin/planos` dispatcher. The dispatcher is a
  // multi-subcommand router: it reaches `src/hook/export.mjs` via the SAME
  // provable `resolve(__dirname,'<lit>')` unwrap it uses for exit/prd/review
  // (the `case 'export'` in plugin/bin/planos), i.e. it routes the
  // legitimately OUT-OF-BLOCKING-PATH `bin/planos export` subcommand — that is
  // expected and fine. AC-Q12 (plan §4, §6) asserts export is absent from the
  // closure of the BLOCKING HANDLERS `exit|prd|review`, NOT from the shared
  // dispatcher that also routes the non-blocking `export` subcommand. Computed
  // by filtering ac17Roots() (UNCHANGED) — NOT by changing the harness.
  const dispatcher = pResolve(roots[0]);
  assert.equal(
    rel(dispatcher),
    'plugin/bin/planos',
    'sanity: ac17Roots()[0] is the bin/planos dispatcher (excluded from the ' +
      'blocking-handler sub-walk; the dispatcher legitimately routes the ' +
      'non-blocking export subcommand too)',
  );
  const blockingHandlerRoots = roots.filter(
    (r) => pResolve(r) !== dispatcher,
  );
  const result = walkImportGraph(blockingHandlerRoots);
  const names = result.modules.map(rel);

  // The blocking-handler closure must STILL contain the real blocking path
  // (proves this is a genuine reachability walk over the handlers, not a
  // vacuous empty set) — exit/prd/review handlers + server + schema + diff +
  // roundtrip + store + ingest, exactly as LAYER 1b's positive set minus the
  // dispatcher-only `plugin/bin/planos` + `src/hook/enter.mjs` entries.
  for (const expected of [
    'src/hook/exit.mjs',
    'src/hook/prd.mjs',
    'src/hook/review.mjs',
    'src/server/index.mjs',
    'src/schema/index.mjs',
    'src/diff/structural.mjs',
    'src/review/ingest.mjs',
  ]) {
    assert.ok(
      names.includes(expected),
      `the blocking-handler closure must include ${expected} (proves a real ` +
        `reachability walk over exit|prd|review, not a vacuous set)`,
    );
  }

  // (b) The negative proof (AC-Q12): the markdown-export modules are ABSENT
  //     from the blocking transitive closure — no blocking handler (exit /
  //     prd / review) can reach them. `src/export/markdown.mjs` is a PURE
  //     zero-import serializer; `src/hook/export.mjs` is the out-of-blocking-
  //     path `bin/planos export` CLI (boots NO server, imports NO blocking
  //     handler). The export feature provably cannot run during a blocking
  //     round-trip.
  const exportModulesOutOfClosure = [
    'src/export/markdown.mjs',
    'src/hook/export.mjs',
  ];
  for (const m of exportModulesOutOfClosure) {
    assert.ok(
      !names.includes(m),
      `AC-Q12 NEGATIVE PROOF VIOLATED: ${m} is REACHABLE from the blocking ` +
        `bin/planos exit|prd|review closure — the export feature must be ` +
        `strictly OUT-OF-BLOCKING-PATH (it must never run during a blocking ` +
        `round-trip). Blocking closure: ${names.join(', ')}`,
    );
  }

  // (c) Defensive: the SPA-only surfaces (theme token layer + the SPA export
  //     affordances) are likewise ABSENT from the blocking closure. They are
  //     browser-side TSX/TS the build bundles into plugin/dist/index.html and
  //     are NEVER imported by any Node-side `bin/planos *` path — exactly like
  //     the bundled offline mermaid renderer (ADR-0002 D3). The walker only
  //     resolves .mjs/.js/.cjs/.ts (not .tsx) and these are unreachable from
  //     the blocking roots regardless; asserting it makes the SPA-only
  //     boundary an enforced invariant, not just a convention.
  const spaOnlyModules = [
    'src/editor/theme.ts',
    'src/editor/export.tsx',
  ];
  for (const m of spaOnlyModules) {
    assert.ok(
      !names.includes(m),
      `AC-Q12 NEGATIVE PROOF VIOLATED: ${m} is SPA-only and must be ABSENT ` +
        `from the blocking bin/planos exit|prd|review closure (it is browser-` +
        `side, bundled into plugin/dist/index.html, never imported by a Node ` +
        `blocking path — like the bundled mermaid renderer). Blocking ` +
        `closure: ${names.join(', ')}`,
    );
  }

  // (d) The blocking closure itself is still CLEAN with the UNCHANGED roots —
  //     the negative proof does not weaken the positive invariant; both hold.
  assert.equal(
    result.clean,
    true,
    'the UNCHANGED-roots blocking closure stays VERDICT CLEAN (AC-17 ' +
      're-asserted, never weakened — the negative proof is additive)',
  );

  console.log('');
  console.log('        AC-Q12 NEGATIVE PROOF (Phase 4 / Milestone Q5):');
  console.log('          ac17Roots() UNCHANGED — 14 Phase-1/2/3 blocking roots, ZERO export root');
  console.log('          ABSENT from blocking closure (proven unreachable):');
  for (const m of [...exportModulesOutOfClosure, ...spaOnlyModules]) {
    console.log(`            - ${m}`);
  }
  console.log('          VERDICT: CLEAN — AC-17 RE-ASSERTED by negative proof, ac17Roots() UNCHANGED');
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
// LAYER 2c — RUNTIME no-egress / no-spawn assertion during `bin/planos review`
// (Phase 3 / Milestone R5 — AC-R13: AC-17 RE-ASSERTED for the NEW blocking
// entrypoint). Mirrors LAYER 2b EXACTLY — same lowest-boundary interceptors
// (node:net connect, node:dns lookup, node:child_process spawn/exec/fork,
// global fetch, http(s).request) — but drives `handleReview` (the bin/planos
// review dispatch target) instead of `handlePrd`. Asserts ZERO non-loopback
// egress and ZERO agent/process spawn through the review → server → schema →
// diff → src/review/ingest.mjs path, AND that `gh`/`git` are absent from the
// blocking transitive set (the R1 crux — Option A keeps the gh/git ingestion
// subprocess in the pre-server CLI agent loop; the blocking path makes ZERO
// child_process calls at all here because the no-op opener is injected). R2 =
// ephemeral, so unlike LAYER 2b there is NO tmpdir persistence root — there is
// no src/review/store.mjs and nothing is written to disk; the review result is
// the returned structured envelope only. The SCRIPTED decisionProvider seam
// keeps it fully offline (no SPA, loopback POST only).
// ===========================================================================

await test('AC-17 RUNTIME (REVIEW): zero external egress + zero agent/process spawn (incl. gh/git) during scripted bin/planos review', async () => {
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

  // --- node:child_process — ANY spawn/exec/fork on the review blocking path
  //     is a violation here. The R1 crux: `gh`/`git` ingestion runs in the
  //     pre-server CLI agent loop, NEVER in this blocking path, and the test
  //     injects a NO-OP opener, so ZERO process creation must occur. The
  //     captured cmd string also lets us assert `gh`/`git` were never spawned.
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

  // R2 = ephemeral: there is NO src/review/store.mjs and NO persistence root —
  // unlike LAYER 2b (PRD) there is deliberately no mkdtemp here. Nothing is
  // written to disk; the review result is the returned structured envelope.

  let realOpenerSpawned = false;
  try {
    // SCRIPTED mode: a decisionProvider is injected (no SPA, no /api/review
    // handlers). It performs the SOLE permitted socket — a loopback POST to
    // 127.0.0.1/api/approve — exactly as a real browser/loader would, so the
    // blocking promise resolves deterministically and the structured review
    // envelope is derived from the approved doc. NO real OS opener is ever
    // spawned; NO gh/git subprocess is ever invoked from this blocking path.
    await handleReview({
      stdinText: JSON.stringify({
        tool_input: { plan: JSON.stringify(VALID_REVIEW_DOC) },
      }),
      openBrowser: () => {
        realOpenerSpawned = false; // explicit: no real OS opener was spawned
      },
      decisionProvider: ({ url }) => {
        const port = Number(new URL(url).port);
        const body = JSON.stringify({ source: 'ac17-review-runtime' });
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
    `AC-17 VIOLATION — non-loopback network egress during bin/planos review: ${egress.join(', ')}`,
  );
  assert.deepEqual(
    dnsLookups,
    [],
    `AC-17 VIOLATION — external DNS resolution during bin/planos review: ${dnsLookups.join(', ')}`,
  );
  assert.deepEqual(
    spawns,
    [],
    `AC-17 VIOLATION — process/agent spawn during bin/planos review (the R1 crux: gh/git must run pre-server, NEVER in the blocking path): ${spawns.join(', ')}`,
  );
  // The R1 crux, asserted explicitly: NO `gh` and NO `git` subprocess is ever
  // spawned from the blocking review path (Option A — ingestion is the agent's
  // pre-server CLI tool use; src/review/ingest.mjs is a pure zero-import
  // parser). `spawns` is already proven empty above; this asserts the stronger
  // human-readable property directly so a regression names the offender.
  const ghGitSpawns = spawns.filter((s) => /[:\s/](gh|git)\b/.test(s));
  assert.deepEqual(
    ghGitSpawns,
    [],
    `AC-17 VIOLATION — gh/git subprocess spawned from the blocking bin/planos review path (R1 Option A forbids this — ingestion is strictly pre-server): ${ghGitSpawns.join(', ')}`,
  );
  assert.equal(realOpenerSpawned, false, 'the real OS browser-opener was never invoked on the review test path');

  const parsed = JSON.parse(emitted.trim());
  assert.equal(
    parsed.hookSpecificOutput.hookEventName,
    'ReviewRoundTrip',
    'the diff-review round-trip emitted its decision offline',
  );
  assert.equal(
    parsed.hookSpecificOutput.decision.behavior,
    'allow',
    'the review decision is still emitted offline with zero egress + zero spawn',
  );
  assert.equal(
    parsed.hookSpecificOutput.review.persisted,
    false,
    'R2 = ephemeral: the review is NEVER persisted (no src/review/store.mjs, no reviews/ dir)',
  );
  // The per-hunk verdict authored in VALID_REVIEW_DOC round-tripped intact —
  // proving the structured envelope shape survives the offline blocking path.
  assert.ok(
    Array.isArray(parsed.hookSpecificOutput.review.hunkVerdicts) &&
      parsed.hookSpecificOutput.review.hunkVerdicts.some(
        (h) => h.hunkId === 'dr-1-h1' && h.verdict === 'accept',
      ),
    'the per-hunk verdict round-tripped through the offline blocking path',
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
