/**
 * planos — installed-package execution gate (node:test).
 *
 * Proves the ORIGINAL packaging defect is fixed: the marketplace ships only
 * `./plugin`, so an install has NO `src/` and NO repo package.json. The old
 * `plugin/bin/planos` did `import(resolve(__dirname,'../../src/...'))` and
 * therefore could not import any handler when installed. The bundled
 * `plugin/bin/planos` (+ plugin/package.json type:module) must run with ONLY
 * `plugin/` present.
 *
 * This is the second half of the AC-17 safety composition (with
 * tests/bin-bundle.test.mjs drift): audit src/ via the import-graph walk +
 * prove the byte-identical bundle actually runs self-contained.
 *
 * Run: node --test tests/packaging-no-src.test.mjs   (offline, deterministic)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLUGIN = join(ROOT, 'plugin');

function withPluginOnly(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'planos-nosrc-'));
  try {
    // Copy ONLY ./plugin — explicitly NOT src/, NOT the repo package.json.
    cpSync(PLUGIN, join(tmp, 'plugin'), { recursive: true });
    assert.equal(
      existsSync(join(tmp, 'src')),
      false,
      'sanity: the isolated layout must NOT contain src/',
    );
    assert.equal(
      existsSync(join(tmp, 'package.json')),
      false,
      'sanity: the isolated layout must NOT contain the repo package.json',
    );
    fn(join(tmp, 'plugin', 'bin', 'planos'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function run(bin, args, input) {
  return execFileSync('node', [bin, ...args], {
    input: input ?? '',
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('AC-DIST-2 bundled bin/planos runs `enter` with NO src/ present (defect fixed)', () => {
  withPluginOnly((bin) => {
    const out = run(bin, ['enter'], '{}');
    const json = JSON.parse(out);
    assert.equal(
      json.hookSpecificOutput.hookEventName,
      'PreToolUse',
      'enter must emit the PreToolUse hook JSON from the self-contained bundle',
    );
  });
});

test('AC-DIST-2 bundled bin/planos runs `export` with NO src/ present', () => {
  withPluginOnly((bin) => {
    const doc = JSON.stringify({
      schemaVersion: 1,
      type: 'plan',
      id: 'pkg-nosrc',
      title: 'No-src packaging proof',
      meta: { status: 'draft', createdAt: '2026-05-17T00:00:00Z', revision: 1 },
      blocks: [{ id: 'p', kind: 'prose', md: 'shipped self-contained' }],
    });
    // export uses the SAME extractPlan handoff as exit/prd: it reads
    // tool_input.plan from the hook stdin envelope (roundtrip.mjs:165).
    const stdin = JSON.stringify({ tool_input: { plan: doc } });
    const out = run(bin, ['export'], stdin);
    assert.ok(
      out.includes('No-src packaging proof'),
      `export must serialize the doc to markdown from the bundle; got: ${out.slice(0, 200)}`,
    );
  });
});

test('AC-DIST-2 bundled bin/planos usage error (no subcommand) exits non-zero with NO src/', () => {
  withPluginOnly((bin) => {
    let threw = false;
    try {
      run(bin, [], '');
    } catch (err) {
      threw = true;
      assert.ok(
        String(err.stderr || '').includes('Usage: planos'),
        `usage error must come from the bundled dispatcher; got: ${err.stderr}`,
      );
      assert.ok(
        !String(err.stderr || '').includes('ERR_MODULE_NOT_FOUND') &&
          !String(err.stderr || '').includes("Cannot find module"),
        'must NOT fail with a module-resolution error (the original defect)',
      );
    }
    assert.ok(threw, 'no-subcommand must exit non-zero (usage error)');
  });
});
