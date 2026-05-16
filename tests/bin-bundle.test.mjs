/**
 * planos — bundled bin/planos drift + self-containment gate (node:test).
 *
 * The shipped `plugin/bin/planos` is an esbuild bundle of the SOURCE
 * dispatcher `src/bin/planos-entry.mjs` (npm run build:bin → esbuild.bin.mjs).
 * AC-17 audits the SOURCE closure via the import-graph walk; THIS test is the
 * other half of the safety composition (mirrors editor-render.test.mjs AC-P17
 * for the SPA): it proves the committed artifact is byte-identical to a fresh
 * deterministic rebuild of exactly those sources, and that the bundle is
 * genuinely self-contained (zero non-node: imports, no dynamic import) so it
 * runs from the ./plugin package boundary with NO src/ present.
 *
 * Run: node --test tests/bin-bundle.test.mjs
 * Deterministic, offline. No network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BIN = join(ROOT, 'plugin', 'bin', 'planos');
const SRC_ENTRY = join(ROOT, 'src', 'bin', 'planos-entry.mjs');

// Capture COMMITTED bytes BEFORE rebuild (AC-P17 committed-artifact pattern).
const committedBytes = existsSync(BIN) ? readFileSync(BIN) : null;

test('AC-DIST-0 the SOURCE dispatcher entry exists (esbuild input)', () => {
  assert.equal(
    existsSync(SRC_ENTRY),
    true,
    'src/bin/planos-entry.mjs must exist — it is the AC-17-audited bundle source',
  );
});

test('AC-DIST-1 committed plugin/bin/planos is byte-identical to a fresh build:bin (drift check)', () => {
  assert.notEqual(
    committedBytes,
    null,
    'plugin/bin/planos must be committed (none found before rebuild)',
  );
  execFileSync('npm', ['run', 'build:bin'], { cwd: ROOT, stdio: 'inherit' });
  const rebuilt = readFileSync(BIN);
  assert.ok(
    committedBytes.equals(rebuilt),
    `committed plugin/bin/planos drifted from a fresh rebuild ` +
      `(committed ${committedBytes.length} B vs rebuilt ${rebuilt.length} B) ` +
      `— rebuild and re-commit: npm run build:bin`,
  );
});

test('AC-DIST-1b bundle is self-contained: shebang, node: externals only, no dynamic import', () => {
  const src = readFileSync(BIN, 'utf8');
  assert.ok(
    src.startsWith('#!/usr/bin/env node'),
    'bundle must keep the node shebang (it is an executable CLI)',
  );
  // Strip line comments + block comments so JSDoc `import("./types")` in
  // inlined source does not produce false positives (matches the import-graph
  // walker's comment-stripping intent).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Every surviving import/export-from/dynamic-import specifier must be a
  // node: builtin. No bare third-party, no relative (src/ is NOT shipped),
  // no unresolved dynamic import().
  const specifiers = [
    ...code.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  for (const s of specifiers) {
    assert.ok(
      s.startsWith('node:'),
      `bundle must only import node: builtins — found non-node specifier "${s}" ` +
        `(bundle is not self-contained; src/ is never shipped in ./plugin)`,
    );
  }
  // No NON-literal dynamic import survived (would be unprovable + unbundled).
  assert.ok(
    !/\bimport\s*\(\s*[^"')]/.test(code),
    'bundle must contain no non-literal dynamic import() (must be fully inlined)',
  );
});
