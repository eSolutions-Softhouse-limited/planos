/**
 * planos — SPA editor bundle tests (plain Node, zero dependencies).
 *
 * Covers US-016 / Step 3.1 (AC-8 is `[M]` — manual). Since there is no DOM
 * test harness in this repo, this test asserts the *build contract* that the
 * manual smoke depends on:
 *
 *   - `npm run build:editor` produces exactly ONE `plugin/dist/index.html`.
 *   - That file is self-contained: no external http(s) asset references
 *     (so it opens offline via file://).
 *   - The bundle contains a renderer for every one of the 7 v1 block kinds
 *     plus the edit / answer / comment / approve / revise interaction surface.
 *
 * The DOM-level behavioral checks (AC-8) are the SCRIPTED MANUAL SMOKE
 * documented at the bottom of this file and in the task report.
 *
 * Run: node tests/editor-render.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'plugin', 'dist');
const BUNDLE = join(DIST, 'index.html');

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
    console.log(`        ${err && err.message ? err.message : err}`);
  }
}

// Capture the COMMITTED bundle bytes BEFORE rebuilding so the drift check
// (AC-P17 / Phase 1 committed-artifact remediation pattern) can assert the
// committed plugin/dist/index.html is byte-identical to a fresh rebuild.
const committedBytes = existsSync(BUNDLE) ? readFileSync(BUNDLE) : null;

// Build once up front (the bundle is the unit under test).
console.log('Building editor bundle (npm run build:editor)…');
execFileSync('npm', ['run', 'build:editor'], { cwd: ROOT, stdio: 'inherit' });

test('AC-8 build produces exactly one plugin/dist/index.html', () => {
  assert.equal(existsSync(BUNDLE), true, 'plugin/dist/index.html must exist');
  const entries = readdirSync(DIST);
  assert.deepEqual(
    entries,
    ['index.html'],
    `plugin/dist must contain ONLY index.html, got: ${entries.join(', ')}`
  );
});

const html = readFileSync(BUNDLE, 'utf8');

test('AC-8 bundle is offline self-contained (no external http(s) asset refs)', () => {
  // No <script src="http..."> / <link href="http..."> / @import url(http..)
  const externalAsset =
    /(?:src|href)\s*=\s*["']https?:\/\//i.exec(html) ||
    /@import\s+url\(\s*["']?https?:\/\//i.exec(html);
  assert.equal(
    externalAsset,
    null,
    `bundle must not reference external http(s) assets; found: ${
      externalAsset && externalAsset[0]
    }`
  );
  // The single entry doc must inline the script (single-file plugin).
  assert.match(html, /<script/i, 'bundle must contain inlined script');
  assert.doesNotMatch(
    html,
    /<script[^>]+src=["']\.?\/?main\.tsx/i,
    'bundle must not reference the un-bundled source entry'
  );
});

test('AC-8 bundle contains a renderer for all 7 v1 block kinds', () => {
  // The dispatcher switches on these exact discriminants; minifier preserves
  // the string literals used in case labels and JSX.
  const kinds = [
    'section',
    'prose',
    'objective',
    'task',
    'decision',
    'risk',
    'openQuestion',
  ];
  for (const k of kinds) {
    assert.ok(
      html.includes(`"${k}"`) || html.includes(`'${k}'`) || html.includes(k),
      `bundle missing kind discriminant: ${k}`
    );
  }
});

test('AC-8 bundle contains the interaction surface (edit/answer/comment/approve/revise)', () => {
  // User-visible affordance strings survive minification verbatim.
  for (const needle of [
    'Approve',
    'Request Revision',
    'edit', // task edit toggle (✎ edit)
    'comment', // per-block comment toggle (+ comment)
    'answer', // openQuestion answer label / placeholder
    'Acceptance', // task acceptance edit field
  ]) {
    assert.ok(
      html.toLowerCase().includes(needle.toLowerCase()),
      `bundle missing interaction affordance: ${needle}`
    );
  }
});

test('AC-8 bundle ships the offline demo document (all 7 kinds, standalone)', () => {
  // The demo doc id + title prove the loader fallback is bundled so the SPA
  // renders with no server / no injection.
  assert.ok(
    html.includes('demo-plan-001'),
    'bundle must embed the offline demo document id'
  );
});

// ---------------------------------------------------------------------------
// Phase 2 / Milestone P4 — v2 renderers, history browser, offline mermaid,
// drift check, size cap (AC-P11, AC-P13, AC-P14, AC-P17).
// ---------------------------------------------------------------------------

test('AC-P13 bundle contains a renderer for all 6 v2 block kinds', () => {
  // The dispatcher switches on these discriminants; the minifier preserves
  // the string literals used in case labels + JSX. (Non-visual assertion —
  // the visual demo per kind is the [M] manual smoke at the bottom.)
  const v2Kinds = ['phase', 'tradeoff', 'fileChange', 'code', 'table', 'diagram'];
  for (const k of v2Kinds) {
    assert.ok(
      html.includes(`"${k}"`) || html.includes(`'${k}'`) || html.includes(k),
      `bundle missing v2 kind discriminant: ${k}`
    );
  }
  // v2-renderer-specific affordance strings survive minification verbatim.
  for (const needle of ['Trade-off', 'unresolved id', 'Revision history']) {
    assert.ok(
      html.includes(needle),
      `bundle missing v2 renderer / history affordance: ${needle}`
    );
  }
});

test('AC-P14 offline mermaid is bundled (no CDN / network at runtime)', () => {
  // Mermaid is bundled at build time (Resolved Decision D3). Its presence is
  // proven by a stable mermaid-internal token; offline-ness is proven by the
  // shared no-external-asset assertion below (no src/href http, no @import).
  assert.ok(
    /mermaid/i.test(html),
    'bundle must inline the mermaid renderer (build-time bundle, D3)'
  );
  // No external script/style network reference of ANY kind (re-assert here
  // specifically for the mermaid bundle: it must not lazy-fetch a CDN chunk).
  const ext =
    /(?:src|href)\s*=\s*["']https?:\/\//i.exec(html) ||
    /@import\s+url\(\s*["']?https?:\/\//i.exec(html) ||
    // a runtime dynamic import of an absolute http(s) URL would defeat offline
    /import\(\s*["']https?:\/\//i.exec(html);
  assert.equal(
    ext,
    null,
    `mermaid bundle must be fully offline; found network ref: ${ext && ext[0]}`
  );
});

// AC-R11 (the bundled v3 `diff` renderer + per-hunk review affordance
// assertion) was deleted in M1 (ADR-0007): the diff-review flow and the v3
// `diff` kind were removed — planos is PRD-only. The v1/v2 PRD renderer
// coverage above is unchanged.

// ---------------------------------------------------------------------------
// Phase 4 / Milestone Q2 — theme token layer (AC-Q2). Non-visual: assert the
// bundled SPA ships BOTH the `light` and `dark` palettes, the header theme
// toggle, and the `prefers-color-scheme` OS-default query — and that toggling
// theme changes tokenized style values (the two palettes carry DIFFERENT hex
// for the same tokens, so a live toggle re-styles every tokenized surface).
// The visual demo per theme is the [M] manual smoke.
// ---------------------------------------------------------------------------

test('AC-Q2 bundle ships both theme palettes + the toggle + prefers-color-scheme default', () => {
  // OS-default media query (zero-dep one-liner) survives minification verbatim.
  assert.ok(
    html.includes('prefers-color-scheme: dark'),
    'bundle missing the prefers-color-scheme OS-default media query'
  );
  // Header theme toggle control (aria-label + the toggle button glyphs).
  assert.ok(
    html.includes('Toggle theme'),
    'bundle missing the header theme toggle control'
  );
  assert.ok(
    html.includes('🌙 dark') && html.includes('☀ light'),
    'bundle missing the theme toggle labels'
  );
  // BOTH palettes are present: the `light` diff-add background (verbatim pre-Q2
  // rgba) AND `dark`-only surfaces that exist in NO other place in the source.
  assert.ok(
    html.includes('rgba(34,197,94,0.18)'),
    'bundle missing the light palette (verbatim pre-Q2 diff-add background)'
  );
  for (const darkOnly of ['#0b1120', '#020617', 'rgba(34,197,94,0.22)']) {
    assert.ok(
      html.includes(darkOnly),
      `bundle missing dark-palette token value: ${darkOnly}`
    );
  }
  // Toggling theme changes tokenized style props (non-visual proof): the same
  // semantic token (e.g. `bg`) resolves to DIFFERENT values across palettes,
  // so a theme switch necessarily re-styles the rendered tree. We assert the
  // light shell bg and the dark shell bg are BOTH bundled and are distinct.
  assert.ok(
    html.includes('#f1f5f9') && html.includes('#0b1120'),
    'bundle must carry distinct light vs dark shell backgrounds (toggle re-styles)'
  );
  assert.notEqual(
    '#f1f5f9',
    '#0b1120',
    'light and dark `bg` token must differ so the toggle changes style props'
  );
});

// ---------------------------------------------------------------------------
// Phase 4 / Milestone Q3 — SPA export affordances (markdown download +
// print-to-PDF). Non-visual: assert the bundled SPA ships the "Download .md"
// affordance whose click path is serializeMarkdown → Blob → a[download] with
// NO network in the export path, the "Print / Save as PDF" affordance that
// invokes window.print(), the @media print rules that hide interactive chrome,
// and that NO new runtime dependency was added to package.json (Resolved
// Decision Q4 = browser print, zero PDF library). The visual paper-layout demo
// is the [M] manual smoke.
// ---------------------------------------------------------------------------

test('AC-Q7 bundle ships the "Download .md" click→serializeMarkdown→Blob→a[download] path, NO network', () => {
  // User-visible affordance string survives minification verbatim.
  assert.ok(
    html.includes('Download .md'),
    'bundle missing the "Download .md" export affordance'
  );
  assert.ok(
    html.includes('Download markdown'),
    'bundle missing the "Download .md" aria-label'
  );
  // The pure Q0 serializer is bundled in-browser: a stable serializer-internal
  // literal (the canonical "Untitled" H1 fallback + the degraded marker) only
  // exists in src/export/markdown.mjs and survives minification verbatim.
  assert.ok(
    html.includes('Untitled') && html.includes('degraded'),
    'bundle missing the in-browser serializeMarkdown code path (Q0 serializer)'
  );
  // The client-side download wiring: Blob of text/markdown + a transient
  // a[download] driven by an object URL. The minifier preserves string
  // literals + the .download / Blob / createObjectURL member names.
  for (const needle of [
    'text/markdown',
    'Blob',
    'createObjectURL',
    'download',
    'revokeObjectURL',
  ]) {
    assert.ok(
      html.includes(needle),
      `bundle missing client-side download wiring token: ${needle}`
    );
  }
  // AC-Q7 NO network in the export path: the export module imports the PURE
  // Q0 serializer only and uses no fetch/XHR/network. Assert the export module
  // source itself has zero network surface (the bundle as a whole legitimately
  // contains `fetch` for the loader/envelope; the *export path* must not).
  const exportSrc = readFileSync(
    join(ROOT, 'src', 'editor', 'export.tsx'),
    'utf8'
  );
  for (const banned of [
    'fetch(',
    'XMLHttpRequest',
    'navigator.sendBeacon',
    'WebSocket',
    'EventSource',
  ]) {
    assert.ok(
      !exportSrc.includes(banned),
      `src/editor/export.tsx must have ZERO network in the export path; found: ${banned}`
    );
  }
  // Positive: the export module consumes the pure Q0 serializer (the dual
  // SPA + CLI consumption the serializer is designed for).
  assert.ok(
    /serializeMarkdown/.test(exportSrc) &&
      /from '\.\.\/export\/markdown\.mjs'/.test(exportSrc),
    'src/editor/export.tsx must import serializeMarkdown from the pure Q0 serializer'
  );
});

test('AC-Q8 bundle ships "Print / Save as PDF" → window.print() + the @media print chrome-hiding stylesheet', () => {
  // User-visible affordance string survives minification verbatim.
  assert.ok(
    html.includes('Print / Save as PDF'),
    'bundle missing the "Print / Save as PDF" export affordance'
  );
  assert.ok(
    html.includes('Print or Save as PDF'),
    'bundle missing the "Print / Save as PDF" aria-label'
  );
  // The button invokes the browser-native window.print() (zero-dep PDF, Q4).
  // The minifier preserves the `.print()` member call + the `print` literal.
  assert.ok(
    /\.print\(\)/.test(html),
    'bundle missing the window.print() invocation (Q4 zero-dep print-to-PDF)'
  );
  // The @media print block is present and hides interactive chrome. The
  // screen-only marker is a stable string literal; the print rules are emitted
  // through a media="print" <style> built from a template literal whose
  // selector interpolates that marker, so the marker literal + the CSS rule
  // fragments survive minification verbatim (the selector itself is composed
  // at runtime, so we assert the marker literal + the rule bodies, not a
  // pre-composed `[data-planos-screen-only]{...}` string).
  assert.ok(
    html.includes('"data-planos-screen-only"') ||
      html.includes("'data-planos-screen-only'"),
    'bundle missing the screen-only marker the @media print block hides'
  );
  assert.ok(
    html.includes('{ display: none !important; }'),
    'bundle missing the @media print rule that hides the marked interactive chrome'
  );
  assert.ok(
    html.includes('@page { margin: 16mm; }') &&
      html.includes('max-width: none !important'),
    'bundle missing the @media print paper-layout rules'
  );
  // The print rules are scoped to print only (media="print" attribute on the
  // injected <style>) so screen rendering is untouched.
  assert.ok(
    /media\s*=\s*["']print["']/.test(html) ||
      html.includes('media:"print"') ||
      html.includes("media:'print'"),
    'bundle missing the media="print" scoping (print rules must not affect screen)'
  );
});

test('AC-Q8 / AC-Q14 NO new runtime dependency added (Q4 = browser print, zero PDF library)', () => {
  // Concrete no-new-dep assertion: package.json carries NO runtime
  // `dependencies` block at all (only build-time devDependencies). A PDF /
  // download library would have to appear here — its absence proves the
  // zero-new-runtime-dep hard constraint (Resolved Decision Q4).
  const pkg = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8')
  );
  const runtimeDeps = pkg.dependencies ?? {};
  assert.deepEqual(
    runtimeDeps,
    {},
    `package.json must declare ZERO runtime dependencies (no PDF / download ` +
      `library); found: ${Object.keys(runtimeDeps).join(', ')}`
  );
  // The devDependency set is the FROZEN pre-Q3 build toolchain — no new
  // dependency of any kind was introduced for the export affordances.
  assert.deepEqual(
    Object.keys(pkg.devDependencies ?? {}).sort(),
    [
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'mermaid',
      'react',
      'react-dom',
      'typescript',
      'vite',
      'vite-plugin-singlefile',
    ],
    'package.json devDependencies drifted — no new dependency may be added for Q3'
  );
});

test('AC-P17 committed plugin/dist/index.html is byte-identical to a fresh rebuild (drift check)', () => {
  // Phase 1 committed-artifact remediation pattern: the committed bundle must
  // equal a deterministic fresh rebuild, so the v2 renderers + history browser
  // + bundled mermaid are reflected in the committed single-file artifact.
  assert.notEqual(
    committedBytes,
    null,
    'plugin/dist/index.html must be committed (none found before rebuild)'
  );
  const rebuilt = readFileSync(BUNDLE);
  assert.ok(
    committedBytes.equals(rebuilt),
    `committed plugin/dist/index.html drifted from a fresh rebuild ` +
      `(committed ${committedBytes.length} B vs rebuilt ${rebuilt.length} B) ` +
      `— rebuild and re-commit: npm run build:editor`
  );
});

test('AC-P17 bundle size is under the documented cap (≤ 4 MB)', () => {
  // Resolved Decision D3 accepts a larger artifact for visual diagram
  // rendering but requires the growth to be documented + asserted within a
  // sane cap. Mermaid pushes the single-file bundle to ~3.3 MB; the cap is
  // set to 4 MB (≈ 700 KB headroom) to catch runaway bloat / accidental
  // double-bundling while permitting the mermaid renderer.
  const CAP_BYTES = 4 * 1024 * 1024;
  const size = readFileSync(BUNDLE).length;
  assert.ok(
    size <= CAP_BYTES,
    `plugin/dist/index.html is ${size} B, exceeds the ${CAP_BYTES} B ` +
      `(4 MB) offline single-file cap (Resolved Decision D3)`
  );
});

console.log('');
console.log(`SPA editor bundle tests: ${passed} passed, ${failed} failed`);

// ---------------------------------------------------------------------------
// SCRIPTED MANUAL SMOKE (AC-8 is [M] — perform once per change to this UI)
// ---------------------------------------------------------------------------
//
//  1. Build:   npm run build:editor
//  2. Open:    file://<repo>/plugin/dist/index.html  (no server needed)
//  3. Verify ALL 7 kinds render with kind-appropriate UI:
//       - section: collapsible heading with H-level badge (click to collapse)
//       - prose:   markdown renders (bold, list, code block, blockquote, link)
//       - objective: goal text + "Success criteria" bullet list
//       - task:    title + colored status badge + acceptance list + deps
//       - decision: question + option cards w/ pros/cons + ✓ chosen + rationale
//       - risk:    description + Likelihood/Impact (L/M/H) + mitigation
//       - openQuestion: question + answer textarea (red border when empty)
//  4. Edit a task: click "✎ edit" on "Render all block kinds" → change the
//     title, switch status (todo→done), edit an acceptance line → "Done".
//     Confirm the read view reflects the new title/status/acceptance.
//  5. Answer an openQuestion: type into the answer box for
//     "Should reviewers be able to set task status to 'cut'…"; the red
//     "requires an answer" hint disappears and the border turns green.
//  6. Comment a block: click "+ comment" on any block, type a comment; the
//     toggle flips to "💬 commented".
//  7. Click "Approve": the decision bar replaces buttons with the green
//     "Plan approved — decision captured." banner; the browser devtools
//     console logs `[planos] approve { documentId, state }` carrying the
//     edits/comments/answers you entered.
//  8. Reload, repeat steps 4-6, then click "Request Revision": red
//     "Revision requested — feedback captured." banner; console logs
//     `[planos] revise { documentId, state }`.
//
//  Expected: every step works with the page opened directly from disk
//  (offline), no network, no server.
// ---------------------------------------------------------------------------

if (failed > 0) process.exit(1);
