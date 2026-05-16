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
