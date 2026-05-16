// tests/harness/verify-exit-gate.mjs
//
// US-023 (AC-18) + US-024 (AC-19) — Phase-1 exit-gate verification.
//
// Reports the THREE AC-19 metric groups SEPARATELY (never a single collapsed
// number), against the FROZEN bars (asserted unmodified — no tuning), for the
// chosen scheme (opaque, per docs/adr/0001) and the validated alternative
// (semantic-slug). Group (i)+(ii) are recomputed offline from the 32-fixture
// suite; group (iii) is read from the billed live-run artifacts in
// .omc/research/. Writes .omc/research/phase1-exit-gate.json and exits non-zero
// if the chosen scheme does not clear every gated group.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runHarness } from './runner.mjs';
import { computeMetrics, FROZEN_BARS } from './metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RESEARCH = join(REPO, '.omc', 'research');

// Frozen bars are a CONTRACT. Assert the in-code values are the plan's bars;
// if this ever fails, the gate was tuned — that is a hard stop, not a pass.
const EXPECTED_FROZEN = {
  idPreservation: 0.95,
  convergenceWithin2: 0.9,
  cannedMinN: 30,
  liveMinRuns: 5,
};
for (const [k, v] of Object.entries(EXPECTED_FROZEN)) {
  if (FROZEN_BARS[k] !== v) {
    console.error(
      `FATAL: FROZEN_BARS.${k}=${FROZEN_BARS[k]} != plan ${v} — bars were ` +
        `tuned. Phase-1 gate is void. Halt + escalate (do NOT proceed).`,
    );
    process.exit(2);
  }
}

async function loadLive(scheme) {
  try {
    const j = JSON.parse(
      await readFile(join(RESEARCH, `live-${scheme}.json`), 'utf8'),
    );
    return j;
  } catch (e) {
    return { error: `missing/unreadable .omc/research/live-${scheme}.json: ${e.message}` };
  }
}

const canned = await runHarness({ mode: 'canned' });
const groupI = canned.metrics.deterministicCorrectness;
const groupII = canned.metrics.cannedFixture;
const firstTryCanned = canned.metrics.firstTryValidRate;

const schemes = {};
for (const scheme of ['opaque', 'semantic-slug']) {
  const live = await loadLive(scheme);
  let groupIII = null;
  let firstTryLive = null;
  if (!live.error) {
    // Recompute group (iii) from the raw runs with the SAME metrics module —
    // no bespoke math, no trust in the artifact's own summary.
    const liveResults = live.runs.map((r) => ({
      idResult: r.idResult,
      convergedWithin2: r.convergedWithin2,
    }));
    const ft = {
      valid: live.runs.filter((r) => r.firstTryValid).length,
      total: live.runs.length,
    };
    const m = computeMetrics({ liveResults, firstTry: ft });
    groupIII = m.liveRun;
    firstTryLive = m.firstTryValidRate;
  }
  schemes[scheme] = { live, groupIII, firstTryLive };
}

// AC-18: ≥30 canned + ≥5 live, none regress, real thin loop, realistic fixtures.
const ac18 = {
  cannedFixtures: groupII.n,
  cannedMinMet: groupII.n >= FROZEN_BARS.cannedMinN,
  liveRunsPerScheme: Object.fromEntries(
    Object.entries(schemes).map(([s, v]) => [s, v.groupIII?.runs ?? 0]),
  ),
  liveMinMet: Object.values(schemes).every(
    (v) => (v.groupIII?.runs ?? 0) >= FROZEN_BARS.liveMinRuns,
  ),
  noLiveRegression: Object.values(schemes).every(
    (v) => v.groupIII && v.groupIII.anyRegression === false,
  ),
  realThinLoop: true, // live-driver drives real bin/planos enter + src/hook/exit.mjs
};

const CHOSEN = 'opaque'; // docs/adr/0001-block-id-scheme.md
const chosen = schemes[CHOSEN];
const chosenVerdict = {
  scheme: CHOSEN,
  groupI_deterministicCorrectness: { pass: groupI.pass, ...groupI },
  groupII_cannedFixture: { pass: groupII.pass, ...groupII },
  groupIII_liveRun: chosen.groupIII
    ? { pass: chosen.groupIII.pass, ...chosen.groupIII }
    : { pass: false, error: chosen.live.error },
  firstTryValidRate: {
    canned: firstTryCanned,
    live: chosen.firstTryLive,
    note: 'reported only — NOT gated (AC-19)',
  },
};
const PASS =
  groupI.pass &&
  groupII.pass &&
  !!chosen.groupIII &&
  chosen.groupIII.pass &&
  ac18.cannedMinMet &&
  ac18.liveMinMet &&
  ac18.noLiveRegression;

const out = {
  generatedAt: new Date().toISOString(),
  frozenBars: FROZEN_BARS,
  frozenBarsUntampered: true,
  ac18,
  chosenScheme: CHOSEN,
  chosenVerdict,
  alternativeScheme: {
    scheme: 'semantic-slug',
    groupIII_liveRun: schemes['semantic-slug'].groupIII,
    note: 'validated equal-measured-merit alternative; not the default',
  },
  threeGroupsReportedSeparately: true,
  singleCollapsedNumber: false,
  PHASE1_EXIT_GATE: PASS ? 'PASS' : 'FAIL',
};

await mkdir(RESEARCH, { recursive: true });
await writeFile(
  join(RESEARCH, 'phase1-exit-gate.json'),
  JSON.stringify(out, null, 2),
);

console.log(JSON.stringify(out, null, 2));
console.log(
  `\n=== PHASE 1 EXIT GATE: ${out.PHASE1_EXIT_GATE} ===\n` +
    `(i) deterministic correctness: ${groupI.pass ? 'PASS' : 'FAIL'}  ` +
    `(ii) canned n=${groupII.n} id=${groupII.idPreservationRate} ` +
    `conv=${groupII.convergenceWithin2Rate}: ${groupII.pass ? 'PASS' : 'FAIL'}  ` +
    `(iii) live[${CHOSEN}] runs=${chosen.groupIII?.runs} ` +
    `id=${chosen.groupIII?.idPreservationRate} ` +
    `noRegression=${chosen.groupIII ? !chosen.groupIII.anyRegression : 'n/a'}: ` +
    `${chosen.groupIII?.pass ? 'PASS' : 'FAIL'}\n` +
    `alt[semantic-slug] live id=${schemes['semantic-slug'].groupIII?.idPreservationRate} ` +
    `runs=${schemes['semantic-slug'].groupIII?.runs} ` +
    `pass=${schemes['semantic-slug'].groupIII?.pass}  ` +
    `first-try (reported, NOT gated) canned=${firstTryCanned.rate} ` +
    `live=${chosen.firstTryLive?.rate}`,
);
process.exit(PASS ? 0 : 1);
