/**
 * planos — packaging / metadata JSON-validity tests (plain Node, zero deps).
 *
 * Phase 4 / Milestone Q4 gate (AC-Q9). Pure metadata/docs hardening — this
 * suite asserts the distribution manifests are schema-valid JSON, carry the
 * agreed metadata fields at version 1.0.0, that package.json stays runtime-dep
 * free, and that `plugin/bin/planos` still dispatches every subcommand (no
 * regression). Mirrors the plain-Node test() harness used by
 * tests/export-cli.test.mjs.
 *
 * Plugin-manifest + marketplace-manifest field names verified against the
 * CURRENT Claude Code docs:
 *   - https://code.claude.com/docs/en/plugins-reference  (Plugin manifest
 *     schema: name [required], version, description, author [object],
 *     homepage, repository, license, keywords)
 *   - https://code.claude.com/docs/en/plugin-marketplaces  (Marketplace
 *     schema: required top-level name + owner{name}, plugins[] with required
 *     name + source)
 *
 * Run: node --test tests/packaging.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const MARKETPLACE_JSON = join(REPO_ROOT, '.claude-plugin/marketplace.json');
const PLUGIN_JSON = join(REPO_ROOT, 'plugin/.claude-plugin/plugin.json');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const PLANOS_BIN = join(REPO_ROOT, 'plugin/bin/planos');

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
    console.log(`        ${err && err.message ? err.message : String(err)}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// marketplace.json — valid JSON + Claude Code marketplace schema
// ---------------------------------------------------------------------------

test('.claude-plugin/marketplace.json parses as valid JSON', () => {
  const m = readJson(MARKETPLACE_JSON);
  assert.equal(typeof m, 'object');
  assert.ok(m !== null);
});

test('marketplace.json carries required top-level name + owner{name}', () => {
  const m = readJson(MARKETPLACE_JSON);
  assert.equal(typeof m.name, 'string');
  assert.ok(m.name.length > 0, 'marketplace name must be non-empty');
  assert.equal(typeof m.owner, 'object');
  assert.ok(m.owner !== null);
  assert.equal(typeof m.owner.name, 'string');
  assert.ok(m.owner.name.length > 0, 'owner.name must be non-empty');
});

test('marketplace.json plugins[] entry has required name + source (minimal)', () => {
  const m = readJson(MARKETPLACE_JSON);
  assert.ok(Array.isArray(m.plugins));
  assert.equal(m.plugins.length, 1);
  const entry = m.plugins[0];
  assert.equal(entry.name, 'planos');
  assert.equal(entry.source, './plugin');
  // Listing richness lives in plugin.json — the marketplace entry stays minimal.
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['name', 'source'],
    'marketplace plugin entry must stay minimal: only name + source',
  );
});

// ---------------------------------------------------------------------------
// plugin/.claude-plugin/plugin.json — valid JSON + agreed metadata @ 1.0.0
// ---------------------------------------------------------------------------

test('plugin/.claude-plugin/plugin.json parses as valid JSON', () => {
  const p = readJson(PLUGIN_JSON);
  assert.equal(typeof p, 'object');
  assert.ok(p !== null);
});

test('plugin.json version === "1.0.0" (Q8 final-phase bump)', () => {
  const p = readJson(PLUGIN_JSON);
  assert.equal(p.version, '1.0.0');
});

test('plugin.json carries the agreed verified-valid metadata fields', () => {
  const p = readJson(PLUGIN_JSON);

  assert.equal(p.name, 'planos', 'name (only required field) must be planos');

  assert.equal(typeof p.description, 'string');
  assert.ok(p.description.length > 0, 'description must be non-empty');

  // author is an object per the plugin-manifest schema (name/email/url).
  assert.equal(typeof p.author, 'object');
  assert.ok(p.author !== null);
  assert.equal(typeof p.author.name, 'string');
  assert.ok(p.author.name.length > 0, 'author.name must be non-empty');

  assert.equal(typeof p.homepage, 'string');
  assert.ok(p.homepage.length > 0, 'homepage must be non-empty');

  assert.equal(typeof p.repository, 'string');
  assert.ok(p.repository.length > 0, 'repository must be non-empty');

  assert.equal(typeof p.license, 'string');
  assert.ok(p.license.length > 0, 'license must be non-empty');

  assert.ok(Array.isArray(p.keywords));
  assert.ok(p.keywords.length > 0, 'keywords must be a non-empty array');
  for (const kw of p.keywords) {
    assert.equal(typeof kw, 'string');
  }
});

test('plugin.json uses ONLY schema-supported metadata fields (no invented fields)', () => {
  const p = readJson(PLUGIN_JSON);
  const ALLOWED = new Set([
    '$schema',
    'name',
    'version',
    'description',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
  ]);
  for (const key of Object.keys(p)) {
    assert.ok(
      ALLOWED.has(key),
      `plugin.json carries unsupported/invented field "${key}" — only the verified plugin-manifest metadata fields are allowed`,
    );
  }
});

// ---------------------------------------------------------------------------
// package.json — version bumped, runtime deps still empty/unchanged
// ---------------------------------------------------------------------------

test('package.json version === "1.0.0" (Q8 final-phase bump)', () => {
  const pkg = readJson(PACKAGE_JSON);
  assert.equal(pkg.version, '1.0.0');
});

test('package.json declares NO runtime dependencies (zero-dep invariant)', () => {
  const pkg = readJson(PACKAGE_JSON);
  // dependencies must remain absent or empty — only the version string changed.
  if (Object.prototype.hasOwnProperty.call(pkg, 'dependencies')) {
    assert.deepEqual(
      pkg.dependencies,
      {},
      'package.json.dependencies must stay empty (no new runtime dependency)',
    );
  }
});

// ---------------------------------------------------------------------------
// plugin/bin/planos — dispatch intact (no regression)
// ---------------------------------------------------------------------------

test('plugin/bin/planos still dispatches prd|export (PRD-only, ADR-0007)', () => {
  const bin = readFileSync(PLANOS_BIN, 'utf8');
  for (const sub of ['prd', 'export']) {
    // plugin/bin/planos is now an esbuild bundle of src/bin/planos-entry.mjs
    // (ADR-0006); esbuild normalizes string literals to double quotes, so the
    // dispatch is `case "<sub>":`. Quote-agnostic assertion keeps the
    // "every subcommand dispatched" contract intact across the bundling.
    assert.ok(
      new RegExp(`case ["']${sub}["']:`).test(bin),
      `bin/planos must still dispatch the "${sub}" subcommand`,
    );
  }
});

test('src/bin/planos-entry.mjs is the static-import SOURCE dispatcher (bundle input)', () => {
  const entry = join(REPO_ROOT, 'src/bin/planos-entry.mjs');
  assert.ok(
    existsSync(entry),
    'src/bin/planos-entry.mjs must exist — it is the AC-17-audited esbuild input',
  );
  const src = readFileSync(entry, 'utf8');
  for (const fn of ['handlePrd', 'handleExport']) {
    assert.ok(
      new RegExp(`import \\{ ${fn} \\} from '\\.\\./hook/`).test(src),
      `source dispatcher must STATICALLY import ${fn} (no dynamic import — bundleable)`,
    );
  }
  // Strip comments first — the header prose intentionally mentions the OLD
  // `import(resolve(__dirname,...))` form it replaced.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/\bimport\s*\(/.test(code),
    'source dispatcher must contain NO dynamic import() (fully static for esbuild)',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(
  `packaging tests (Phase 4 / Milestone Q4 — AC-Q9): ${passed} passed, ${failed} failed`,
);
console.log('');

if (failed > 0) process.exit(1);
