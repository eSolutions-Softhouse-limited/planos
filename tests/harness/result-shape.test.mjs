// tests/harness/result-shape.test.mjs
//
// Step 0.5 acceptance test. Zero runtime deps — node:test only.
//
// Asserts:
//   1. An empty/zero-fixture harness run returns the structured result with
//      ALL THREE AC-19 groups present-but-empty, and `firstTryValidRate`
//      explicitly flagged not-gated.
//   2. Canned mode performs NO network / browser access (zero egress, and the
//      injected null seam is never touched).
//   3. The three groups are SEPARATE fields — never a single number.
//   4. AC-12 mechanical denominator is pure |preserved ∩ expected| / |expected|.
//   5. Live mode is an honest stub ("live mode not yet wired").

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runHarness,
  loadFixtures,
  liveAgentDriver,
  DEFAULT_FIXTURES_DIR,
} from "./runner.mjs";
import { idPreservationRate, computeMetrics } from "./metrics.mjs";
import { createNullServerSeam } from "./seams.mjs";

test("empty-fixture run returns all three AC-19 groups present-but-empty", async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), "planos-empty-"));
  const result = await runHarness({ fixturesDir: emptyDir });

  assert.equal(result.fixtureCount, 0, "empty dir => zero fixtures");
  const m = result.metrics;

  // Three SEPARATE top-level groups, plus the ungated report field.
  assert.ok("deterministicCorrectness" in m, "group (i) present");
  assert.ok("cannedFixture" in m, "group (ii) present");
  assert.ok("liveRun" in m, "group (iii) present");
  assert.ok("firstTryValidRate" in m, "first-try rate present");

  // The result must NOT be a single collapsed number.
  assert.notEqual(typeof m, "number");

  // (i) empty => not evaluated, not passing (must be 100% only when checked).
  assert.equal(m.deterministicCorrectness.evaluated, false);
  assert.equal(m.deterministicCorrectness.pass, false);
  assert.equal(m.deterministicCorrectness.gated, true);

  // (ii) empty => null rates, n=0, not gate-ready (needs n>=30).
  assert.equal(m.cannedFixture.idPreservationRate, null);
  assert.equal(m.cannedFixture.convergenceWithin2Rate, null);
  assert.equal(m.cannedFixture.n, 0);
  assert.equal(m.cannedFixture.gateReady, false);
  assert.equal(m.cannedFixture.bars.minN, 30);

  // (iii) empty => null rate, 0 runs, not enough runs (needs >=5).
  assert.equal(m.liveRun.idPreservationRate, null);
  assert.equal(m.liveRun.runs, 0);
  assert.equal(m.liveRun.enoughRuns, false);
  assert.equal(m.liveRun.anyRegression, false);

  // first-try rate REPORTED but explicitly NOT gated.
  assert.equal(m.firstTryValidRate.gated, false);
  assert.equal(m.firstTryValidRate.rate, null);
});

test("canned mode performs zero network / browser egress", async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), "planos-egress-"));
  const seam = createNullServerSeam();
  const result = await runHarness({
    fixturesDir: emptyDir,
    mode: "canned",
    serverSeam: () => seam,
  });
  assert.equal(result.egressCount, 0, "no egress in canned mode");
  assert.equal(seam.egressCount, 0, "null seam never touched");
});

test("canned run over the example fixture stays offline and degrades nothing", async () => {
  const seam = createNullServerSeam();
  const result = await runHarness({
    mode: "canned",
    serverSeam: () => seam,
  });
  assert.ok(result.fixtureCount >= 1, "example fixture loaded");
  assert.equal(result.egressCount, 0, "still zero egress with real fixtures");
  // Example fixture is well-formed => deterministic group sees graceful path.
  assert.equal(result.metrics.deterministicCorrectness.offline, true);
});

test("AC-12: ID-preservation is pure set-intersection over the FROZEN set", () => {
  // |{a,b} ∩ {a,b,c,d}| / |{a,b,c,d}| = 2/4 = 0.5
  const r = idPreservationRate(["a", "b", "x"], ["a", "b", "c", "d"]);
  assert.equal(r.denominator, 4, "denominator = |expected| (frozen)");
  assert.equal(r.intersection, 2, "only a,b intersect");
  assert.equal(r.rate, 0.5);

  // Extra preserved ids outside `expected` never inflate the rate.
  const r2 = idPreservationRate(["a", "b", "c", "d", "e"], ["a", "b"]);
  assert.equal(r2.rate, 1, "all expected preserved => 1");

  // Empty expected set => vacuously 1, denominator 0.
  const r3 = idPreservationRate(["anything"], []);
  assert.equal(r3.denominator, 0);
  assert.equal(r3.rate, 1);
});

test("the example fixture exercises real renumbering pressure (not trivial)", async () => {
  const fixtures = await loadFixtures(DEFAULT_FIXTURES_DIR);
  const ex = fixtures.find((f) => f.name === "example-search-indexing-feature");
  assert.ok(ex, "example fixture present");
  const d = ex.data;

  // Frozen expected set must be a proper subset of authored block ids.
  const authoredIds = new Set(d.cannedAuthorResponse.blocks.map((b) => b.id));
  for (const id of d.expectedPreservedIds)
    assert.ok(authoredIds.has(id), `expected id ${id} exists in author resp`);
  assert.ok(
    d.expectedPreservedIds.length < authoredIds.size,
    "fixture must NOT expect every id preserved (renumbering pressure)",
  );

  // AC-13 slots present and well-formed.
  assert.ok(d.idChangedButCorresponding?.oldId);
  assert.ok(d.idChangedButCorresponding?.newId);
  assert.ok(
    !d.expectedPreservedIds.includes(d.idChangedButCorresponding.oldId),
    "id-changed block must NOT be in expectedPreservedIds",
  );
  assert.ok(d.decoy?.id && d.decoy?.resemblesOldId);
  const revisedIds = new Set(
    d.cannedForcedReviseResponse.blocks.map((b) => b.id),
  );
  assert.ok(
    !authoredIds.has(d.decoy.id) && revisedIds.has(d.decoy.id),
    "decoy must be genuinely NEW (only in revised response)",
  );
});

test("liveAgentDriver is not a per-phase mock (US-010 wired contract)", () => {
  // The Step 0.5 "not yet wired" stub is superseded by US-010. The live thin
  // loop is stateful, so the canned per-phase mock contract does NOT extend to
  // live; calling liveAgentDriver per-phase is an explicit usage error.
  assert.throws(() => liveAgentDriver(), /not a per-phase mock/);
});

test("live mode wires the real thin loop (offline, injected fake runner)", async () => {
  // US-010 / AC-18: mode:"live" drives the live group (iii) via an injectable
  // runner. The offline suite injects a deterministic fake so it proves the
  // WIRING (per-fixture live runs populate liveRun) without spending `claude`.
  const calls = [];
  const fakeRunner = async (fixture, o) => {
    calls.push({ name: fixture.name, strategy: o.strategy });
    return {
      name: fixture.name,
      strategy: o.strategy,
      idResult: { rate: 1, intersection: 3, denominator: 3 },
      convergedWithin2: true,
      degraded: false,
      valid: true,
      firstTryValid: true,
    };
  };
  const result = await runHarness({
    mode: "live",
    strategy: "semantic-slug",
    liveRunner: fakeRunner,
  });
  assert.equal(result.mode, "live");
  assert.ok(result.fixtureCount >= 1, "fixtures loaded");
  assert.equal(
    calls.length,
    result.fixtureCount,
    "live runner invoked once per fixture",
  );
  assert.equal(calls[0].strategy, "semantic-slug", "strategy threaded through");
  // The live group (iii) is now populated and gate-evaluated separately.
  assert.equal(result.metrics.liveRun.runs, result.fixtureCount);
  assert.equal(result.metrics.liveRun.idPreservationRate, 1);
  assert.equal(result.metrics.liveRun.anyRegression, false);
  // Canned group (ii) still computed from frozen fixtures, offline, no egress.
  assert.equal(result.egressCount, 0);
  assert.ok(result.metrics.cannedFixture.n >= 1);
});

test("computeMetrics never collapses groups into a single number", () => {
  const m = computeMetrics();
  assert.equal(typeof m, "object");
  assert.notEqual(typeof m, "number");
  assert.ok(m.deterministicCorrectness && m.cannedFixture && m.liveRun);
  assert.equal(m.firstTryValidRate.gated, false);
});
