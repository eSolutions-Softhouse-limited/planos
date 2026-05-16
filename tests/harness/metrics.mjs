// tests/harness/metrics.mjs
//
// AC-19 metrics. The Phase 1 exit gate is THREE SEPARATELY-REPORTED,
// SEPARATELY-GATED metric groups. This module NEVER collapses them into a
// single number — `computeMetrics()` returns three distinct top-level fields
// plus an explicitly-ungated `firstTryValidRate`.
//
//   (i)   deterministicCorrectness — pass/fail, must be 100%
//   (ii)  cannedFixture            — ID≥0.95, conv≥0.90, gate-ready iff n≥30
//   (iii) liveRun                  — ID≥0.95 over ≥5 runs, no regression
//   +     firstTryValidRate        — REPORTED, gated:false
//
// FROZEN bars (plan AC-19 / AC-12 / AC-18 — never tuned at runtime):
export const FROZEN_BARS = Object.freeze({
  idPreservation: 0.95, // groups (ii) and (iii)
  convergenceWithin2: 0.9, // group (ii)
  cannedMinN: 30, // group (ii) gate-readiness (AC-19 ii)
  liveMinRuns: 5, // group (iii) tripwire (AC-19 iii)
});

/**
 * AC-12 mechanical ID-preservation denominator.
 *
 *   rate = |preserved ∩ expected| / |expected|
 *
 * PURE set-intersection, zero runtime human judgment. `expected` is taken
 * verbatim from FROZEN fixture data (authored once at fixture-design time);
 * it is NEVER inferred at runtime. By definition |expected|=0 yields rate 1
 * (vacuously preserved — there was nothing required to preserve).
 *
 * @param {Iterable<string>} preservedIds  IDs the revised doc actually kept
 * @param {Iterable<string>} expectedIds   FROZEN expected-preserved set
 * @returns {{ rate: number, intersection: number, denominator: number }}
 */
export function idPreservationRate(preservedIds, expectedIds) {
  const expected = new Set(expectedIds);
  const preserved = new Set(preservedIds);
  let intersection = 0;
  for (const id of expected) {
    if (preserved.has(id)) intersection += 1;
  }
  const denominator = expected.size;
  return {
    rate: denominator === 0 ? 1 : intersection / denominator,
    intersection,
    denominator,
  };
}

/**
 * Compute the three AC-19 metric groups as DISTINCT fields. Designed so an
 * empty/zero-fixture run still returns the full structured shape with every
 * group present-but-empty and `firstTryValidRate` flagged not-gated.
 *
 * @param {object} input
 * @param {{ gracefulDegradation: boolean, offline: boolean }} [input.deterministic]
 * @param {Array<{ idResult: {rate:number}, convergedWithin2: boolean }>} [input.cannedResults]
 * @param {Array<{ idResult: {rate:number} }>} [input.liveResults]
 * @param {{ valid: number, total: number }} [input.firstTry]
 * @returns {object} structured result with three separate groups
 */
export function computeMetrics(input = {}) {
  return {
    // ---- group (i): deterministic correctness — boolean pass/fail, 100% ----
    deterministicCorrectness: deterministicGroup(input.deterministic),

    // ---- group (ii): canned-fixture regression protection -----------------
    cannedFixture: cannedGroup(input.cannedResults ?? []),

    // ---- group (iii): live runs — the only true §6 falsifier --------------
    liveRun: liveGroup(input.liveResults ?? []),

    // ---- reported, explicitly NOT gated -----------------------------------
    firstTryValidRate: firstTryGroup(input.firstTry),
  };
}

function deterministicGroup(d) {
  const gracefulDegradation = d?.gracefulDegradation === true;
  const offline = d?.offline === true;
  // Empty run: no checks executed yet -> evaluated:false, pass:false (not 100%).
  const evaluated = d != null;
  return {
    gracefulDegradation,
    offline,
    evaluated,
    // Group (i) must be 100%: BOTH checks true AND actually evaluated.
    pass: evaluated && gracefulDegradation && offline,
    gated: true,
  };
}

function cannedGroup(results) {
  const n = results.length;
  const idRates = results.map((r) => r.idResult?.rate ?? 0);
  const convCount = results.filter((r) => r.convergedWithin2 === true).length;
  const idPreservationRate = n === 0 ? null : mean(idRates);
  const convergenceWithin2Rate = n === 0 ? null : convCount / n;
  const gateReady = n >= FROZEN_BARS.cannedMinN; // AC-19(ii): requires n≥30
  return {
    idPreservationRate,
    convergenceWithin2Rate,
    n,
    gateReady,
    bars: {
      idPreservation: FROZEN_BARS.idPreservation,
      convergenceWithin2: FROZEN_BARS.convergenceWithin2,
      minN: FROZEN_BARS.cannedMinN,
    },
    // pass requires gate-readiness AND both frozen bars cleared.
    pass:
      gateReady &&
      idPreservationRate !== null &&
      convergenceWithin2Rate !== null &&
      idPreservationRate >= FROZEN_BARS.idPreservation &&
      convergenceWithin2Rate >= FROZEN_BARS.convergenceWithin2,
    gated: true,
  };
}

function liveGroup(results) {
  const runs = results.length;
  const idRates = results.map((r) => r.idResult?.rate ?? 0);
  const idPreservationRate = runs === 0 ? null : mean(idRates);
  // zero-regression tripwire: EVERY run must individually clear the bar.
  const anyRegression =
    runs > 0 && idRates.some((r) => r < FROZEN_BARS.idPreservation);
  const enoughRuns = runs >= FROZEN_BARS.liveMinRuns; // AC-19(iii): ≥5 runs
  return {
    idPreservationRate,
    runs,
    anyRegression,
    enoughRuns,
    bars: {
      idPreservation: FROZEN_BARS.idPreservation,
      minRuns: FROZEN_BARS.liveMinRuns,
    },
    pass:
      enoughRuns &&
      idPreservationRate !== null &&
      idPreservationRate >= FROZEN_BARS.idPreservation &&
      !anyRegression,
    gated: true,
  };
}

function firstTryGroup(ft) {
  const total = ft?.total ?? 0;
  const valid = ft?.valid ?? 0;
  return {
    rate: total === 0 ? null : valid / total,
    valid,
    total,
    // Explicitly REPORTED but NEVER part of the exit gate (AC-19).
    gated: false,
    note: "reported only — the deny→revise loop absorbs bad first-tries",
  };
}

function mean(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
