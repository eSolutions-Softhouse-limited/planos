// tests/harness/run-live.mjs
//
// US-010 / US-023 / AC-18 / AC-19(iii) — the BILLED, out-of-band live runner.
// This is the ONLY entry point that actually spends `claude`. It is NOT part
// of the offline `node --test` suite (which must stay 100% offline per
// AC-19(i)); the offline suite proves the wiring with an injected fake agent
// (tests/live-driver.test.mjs).
//
// Usage:
//   node tests/harness/run-live.mjs <semantic-slug|opaque> [maxFixtures] [--approve]
//
// Drives the REAL thin loop (real bin/planos enter context → real `claude`
// author → real src/hook/exit.mjs forced revise with the (id,kind,title) echo
// table → real `claude` resumed revise) for every fixture (or the first
// maxFixtures), under the given ID strategy. Writes the per-run results +
// the three AC-19 groups (computed by the same metrics module) to
// .omc/research/live-<strategy>.json and prints a summary.
//
// Frozen-at-author-time mechanical denominator (AC-12 spirit) — see
// tests/harness/live-driver.mjs header.

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runLiveFixture } from './live-driver.mjs';
import { computeMetrics, FROZEN_BARS } from './metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FIXTURES_DIR = join(HERE, '..', 'fixtures');
const RESEARCH_DIR = join(REPO_ROOT, '.omc', 'research');

async function loadFixtures() {
  const entries = (await readdir(FIXTURES_DIR)).sort();
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.fixture.json')) continue;
    const data = JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'));
    out.push({ name: data.name ?? name, data });
  }
  return out;
}

async function main() {
  const strategy = process.argv[2];
  if (strategy !== 'semantic-slug' && strategy !== 'opaque') {
    console.error(
      'Usage: node tests/harness/run-live.mjs <semantic-slug|opaque> [maxFixtures] [--approve]',
    );
    process.exit(2);
  }
  const maxArg = process.argv[3];
  const max =
    maxArg && !maxArg.startsWith('--') ? Number(maxArg) : Infinity;
  const approve = process.argv.includes('--approve');

  const fixtures = (await loadFixtures()).slice(
    0,
    Number.isFinite(max) ? max : undefined,
  );
  console.error(
    `[run-live] strategy=${strategy} fixtures=${fixtures.length} ` +
      `approve=${approve}`,
  );

  const results = [];
  let i = 0;
  for (const f of fixtures) {
    i += 1;
    const t0 = Date.now();
    const r = await runLiveFixture(f.data, { strategy, approve });
    const ms = Date.now() - t0;
    results.push({ ...r, ms });
    console.error(
      `[run-live] (${i}/${fixtures.length}) ${r.name} ` +
        `rate=${r.idResult.rate.toFixed(3)} ` +
        `den=${r.idResult.denominator} valid=${r.valid} ` +
        `conv=${r.convergedWithin2} firstTry=${r.firstTryValid} ` +
        `${ms}ms${r.error ? ' ERROR=' + r.error : ''}`,
    );
  }

  // Same metrics module as the offline harness — no bespoke math, no tuning.
  const liveResults = results.map((r) => ({
    idResult: r.idResult,
    convergedWithin2: r.convergedWithin2,
  }));
  const firstTry = {
    valid: results.filter((r) => r.firstTryValid).length,
    total: results.length,
  };
  const metrics = computeMetrics({ liveResults, firstTry });

  await mkdir(RESEARCH_DIR, { recursive: true });
  const outPath = join(RESEARCH_DIR, `live-${strategy}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        strategy,
        generatedAt: new Date().toISOString(),
        frozenBars: FROZEN_BARS,
        runs: results,
        liveGroup: metrics.liveRun,
        firstTryValidRate: metrics.firstTryValidRate,
      },
      null,
      2,
    ),
  );

  const lg = metrics.liveRun;
  console.error(
    `\n[run-live] DONE strategy=${strategy}\n` +
      `  live group (iii): runs=${lg.runs} ` +
      `idPreservation=${lg.idPreservationRate?.toFixed(4)} ` +
      `bar=${lg.bars.idPreservation} minRuns=${lg.bars.minRuns}\n` +
      `  anyRegression=${lg.anyRegression} enoughRuns=${lg.enoughRuns} ` +
      `PASS=${lg.pass}\n` +
      `  firstTryValidRate=${metrics.firstTryValidRate.rate?.toFixed(3)} ` +
      `(reported, NOT gated)\n` +
      `  written: ${outPath}`,
  );
}

main().catch((e) => {
  console.error('[run-live] fatal:', e);
  process.exit(1);
});
