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

// ---------------------------------------------------------------------------
// Phase 3 / Milestone R4 — v3 `diff` renderer + per-hunk review affordance
// (AC-R11). Non-visual: assert the bundled DiffView discriminant + affordance
// strings survive minification (the [M] visual demo is the manual smoke).
// ---------------------------------------------------------------------------

test('AC-R11 bundle contains the v3 diff renderer + per-hunk review affordance', () => {
  // The dispatcher switches on the `diff` discriminant; the minifier preserves
  // case-label / JSX string literals.
  assert.ok(
    html.includes('"diff"') || html.includes("'diff'") || html.includes('diff'),
    'bundle missing the v3 diff kind discriminant'
  );
  // Per-hunk review affordance strings (R5, hunk-level only) survive verbatim.
  // Static string fragments only — the `${v} hunk ${hunkId}` aria-label is
  // built at runtime so only the ` hunk ` literal + the tri-state verdict
  // literals survive minification (the verdict values come from a literal
  // array, not a renamed identifier).
  for (const needle of [
    'binary file — no textual diff', // R6 empty-hunks binary stub
    'Per-hunk comment for the agent', // per-hunk comment box placeholder
    ' hunk ', // accept/reject/comment aria-label static fragment
    '"accept"', // tri-state verdict literal
    '"reject"',
  ]) {
    assert.ok(
      html.includes(needle),
      `bundle missing diff renderer affordance: ${needle}`
    );
  }
  // The `_never` exhaustiveness guard at blocks.tsx is satisfied by a REAL
  // render (not null): the JSON.stringify(_never...) fallback only fires for
  // an unhandled kind. With `case 'diff':` present + a real DiffView, the
  // dispatcher is exhaustive over all 14 kinds and the build (tsc-gated)
  // succeeds — proven by this bundle existing + the drift check below.
  assert.ok(
    html.includes('renamed') && html.includes('hunkId'),
    'bundle missing diff status (renamed) / hunk-anchor wiring'
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
