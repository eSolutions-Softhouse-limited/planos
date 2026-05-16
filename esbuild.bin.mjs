// Build the single-file, self-contained `plugin/bin/planos`.
//
// Mirrors the vite.config.mjs single-file-artifact precedent for the SPA.
// Bundles src/bin/planos-entry.mjs + its entire static `src/` closure into
// ONE ESM file with every `node:` builtin left external and ZERO runtime
// dependencies. The committed output is proven byte-identical to a fresh
// run of this script by tests/bin-bundle.test.mjs (AC-P17-style drift gate).
//
// Determinism: the input graph is pure first-party `.mjs` (no third-party,
// no dependency-version nondeterminism), minify is off (stable, reviewable
// diff), so esbuild output is byte-stable across runs.

import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTFILE = path.resolve(__dirname, 'plugin/bin/planos');

await build({
  entryPoints: [path.resolve(__dirname, 'src/bin/planos-entry.mjs')],
  outfile: OUTFILE,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'], // every node: builtin stays external
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  minify: false, // readable, stable diff; CLI size is irrelevant
  sourcemap: false,
  charset: 'utf8',
});

// esbuild does not set the executable bit; the dispatcher must stay runnable.
chmodSync(OUTFILE, 0o755);
