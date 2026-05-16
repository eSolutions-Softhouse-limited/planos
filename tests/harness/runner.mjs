// tests/harness/runner.mjs
//
// Eval harness runner (Step 0.5 scaffold). Loads fixtures from
// tests/fixtures/, drives a forced-revise loop through an INJECTABLE agent
// interface, and emits the three separate AC-19 metric groups.
//
// Two agent modes (injectable — runner never hard-codes one):
//
//   mockAgent(fixture)        — fully offline. Returns canned author /
//                               forced-revise responses straight from frozen
//                               fixture data. No network, no model.
//
//   liveAgentDriver(fixture)  — documented stub. Will later shell out to a
//                               real agent + the real thin loop (AC-18). For
//                               now it THROWS "live mode not yet wired" so
//                               canned mode is provably 100% offline today.
//
// Open-browser + network seams are injected (default: NULL canned seam from
// seams.mjs) and disabled in canned runs; the runner asserts zero egress.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateDocument,
  degradeToProseBlock,
  createNullServerSeam,
} from "./seams.mjs";
import { computeMetrics, idPreservationRate } from "./metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = join(HERE, "..", "fixtures");

// ---------------------------------------------------------------------------
// Injectable agent interface
// ---------------------------------------------------------------------------

/**
 * Canned agent. Pure function of frozen fixture data — zero side effects,
 * zero network. `phase` is "author" (initial) or "revise" (forced-revise).
 *
 * @param {object} fixture parsed *.fixture.json
 * @param {"author"|"revise"} phase
 * @returns {{ raw: string, source: "canned" }}
 */
export function mockAgent(fixture, phase) {
  const canned =
    phase === "author"
      ? fixture?.cannedAuthorResponse
      : fixture?.cannedForcedReviseResponse;
  if (canned == null)
    throw new Error(
      `fixture "${fixture?.name}" missing canned ${phase} response`,
    );
  // Fixtures store the response as a JSON document object; the real agent
  // emits text into tool_input.plan, so we stringify to mirror that seam.
  return { raw: JSON.stringify(canned), source: "canned" };
}

/**
 * Live agent driver — WIRED (US-010 / Step 1.2 / AC-18).
 *
 * The Step 0.5 scaffold left this as an honest "not yet wired" stub. US-010
 * wires it: the real thin loop (EnterPlanMode→author→ExitPlanMode→forced
 * -revise→ExitPlanMode) driven by a real `claude` agent lives in
 * tests/harness/live-driver.mjs (`runLiveFixture`). It is NOT a per-phase
 * pure function (a live revise needs the REAL deny.message + a resumed agent
 * session — state the (fixture, phase) shape cannot carry), so the canned
 * `mockAgent(fixture, phase)` contract does NOT extend to live.
 *
 * This export is the explicit guard for that contract mismatch: calling it
 * per-phase like the canned mock is a usage error. Live runs go through
 * `runHarness({ mode: "live" })` (or run-live.mjs), which calls
 * `runLiveFixture` per fixture. Kept offline-safe: importing/calling this
 * never spawns `claude`.
 *
 * @returns {never}
 */
export function liveAgentDriver(/* fixture, phase */) {
  throw new Error(
    "liveAgentDriver is not a per-phase mock: the live thin loop is stateful " +
      "(real deny.message + resumed agent session). Use runHarness({ mode: " +
      "'live' }) or tests/harness/live-driver.mjs runLiveFixture — see AC-18.",
  );
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

/**
 * Load every *.fixture.json from a directory. Non-fixture files (e.g.
 * fixture-format.md) are ignored. Missing dir -> empty list (empty run).
 *
 * @param {string} [dir]
 * @returns {Promise<Array<{ name: string, path: string, data: object }>>}
 */
export async function loadFixtures(dir = DEFAULT_FIXTURES_DIR) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const fixtures = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".fixture.json")) continue;
    const path = join(dir, name);
    const data = JSON.parse(await readFile(path, "utf8"));
    fixtures.push({ name: data.name ?? name, path, data });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// Harness run
// ---------------------------------------------------------------------------

/**
 * Run one canned forced-revise fixture: author -> validate (degrade if
 * malformed) -> forced revise -> validate -> measure mechanical
 * ID-preservation against the FROZEN expected set.
 *
 * @param {object} fixture parsed fixture data
 * @param {Function} agent  agent fn (mockAgent in canned mode)
 * @returns {{ name, idResult, convergedWithin2, degraded, valid }}
 */
function runCannedFixture(fixture, agent) {
  // ---- author phase ----
  const authored = parseOrDegrade(agent(fixture, "author").raw);

  // ---- forced-revise phase ----
  const revisedRaw = agent(fixture, "revise").raw;
  const revised = parseOrDegrade(revisedRaw);

  // Which expected IDs survived into the revised doc? Pure structural check;
  // `expected` is the FROZEN set from fixture data (AC-12) — never inferred.
  const expected = fixture.expectedPreservedIds ?? [];
  const revisedIds = new Set((revised.doc.blocks ?? []).map((b) => b.id));
  const preserved = expected.filter((id) => revisedIds.has(id));
  const idResult = idPreservationRate(preserved, expected);

  // Convergence: valid doc reached within ≤2 iterations (author + 1 revise).
  const iterations = 2;
  const convergedWithin2 = revised.valid && iterations <= 2;

  return {
    name: fixture.name,
    idResult,
    convergedWithin2,
    degraded: authored.degraded || revised.degraded,
    valid: revised.valid,
  };
}

/** Parse raw agent text; on validation failure apply deterministic degrade. */
function parseOrDegrade(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const d = degradeToProseBlock(raw);
    return { doc: d, valid: true, degraded: true };
  }
  const v = validateDocument(parsed);
  if (!v.ok) {
    const d = degradeToProseBlock(raw);
    return { doc: d, valid: true, degraded: true };
  }
  return { doc: parsed, valid: true, degraded: false };
}

/**
 * Execute the harness. Empty fixtures dir -> structured result with all three
 * AC-19 groups present-but-empty and `firstTryValidRate` flagged not-gated.
 *
 * In LIVE mode the canned groups are still computed from the frozen fixture
 * data (group (ii) regression protection is fixture-frozen and offline), and
 * the live group (iii) is populated by driving the REAL thin loop with a real
 * agent via `runLiveFixture` (tests/harness/live-driver.mjs). The live runner
 * is injectable (`opts.liveRunner`) so the offline suite proves the wiring
 * with a deterministic fake agent and never spends `claude`.
 *
 * @param {object} [opts]
 * @param {string}   [opts.fixturesDir]   default tests/fixtures/
 * @param {Function} [opts.agent]         default mockAgent (canned)
 * @param {"canned"|"live"} [opts.mode]   default "canned"
 * @param {Function} [opts.serverSeam]    default createNullServerSeam
 * @param {string}   [opts.strategy]      PLANOS_ID_STRATEGY for live runs
 * @param {(fixture: object, o: object) => Promise<object>} [opts.liveRunner]
 *   Injectable live thin-loop runner. Default: runLiveFixture (real `claude`).
 *   Only invoked when mode === "live".
 * @returns {Promise<object>} { mode, fixtureCount, metrics, seam, fixtures }
 */
export async function runHarness(opts = {}) {
  const mode = opts.mode ?? "canned";
  const fixturesDir = opts.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  // Canned groups always use the offline mockAgent over frozen fixture data —
  // even in live mode (group (ii) is fixture-frozen regression protection).
  const agent = opts.agent ?? mockAgent;
  const seam = (opts.serverSeam ?? createNullServerSeam)();

  const fixtures = await loadFixtures(fixturesDir);

  const cannedResults = [];
  let firstTryValid = 0;
  for (const f of fixtures) {
    const r = runCannedFixture(f.data, agent);
    cannedResults.push(r);
    // First-try valid = author-phase doc validated without degradation.
    const authored = parseOrDegrade(agent(f.data, "author").raw);
    if (!authored.degraded) firstTryValid += 1;
  }

  // ---- live group (iii): drive the REAL thin loop with a real agent -------
  // Default runner = runLiveFixture (lazy-imported so the offline suite never
  // even loads the live module unless live mode is requested). Injectable for
  // offline wiring tests.
  const liveResults = [];
  if (mode === "live") {
    let liveRunner = opts.liveRunner;
    if (typeof liveRunner !== "function") {
      ({ runLiveFixture: liveRunner } = await import("./live-driver.mjs"));
    }
    for (const f of fixtures) {
      const lr = await liveRunner(f.data, { strategy: opts.strategy });
      liveResults.push(lr);
    }
  }

  // Canned mode purity: the NULL seam must never have been touched.
  const egress = seam.egressCount;
  if (mode === "canned" && egress !== 0) {
    throw new Error(
      `canned run made ${egress} network/browser egress attempt(s) — ` +
        `offline contract violated`,
    );
  }

  // Deterministic-correctness group is only meaningfully evaluated once
  // fixtures exercise it; an empty run leaves it present-but-empty.
  const deterministic =
    fixtures.length === 0
      ? undefined
      : {
          gracefulDegradation: cannedResults.some((r) => r.degraded === false),
          offline: egress === 0,
        };

  const metrics = computeMetrics({
    deterministic,
    cannedResults,
    liveResults,
    firstTry: { valid: firstTryValid, total: fixtures.length },
  });

  return {
    mode,
    fixtureCount: fixtures.length,
    metrics,
    egressCount: egress,
    fixtures: fixtures.map((f) => f.name),
    liveResults,
  };
}

// Allow `node tests/harness/runner.mjs` for a quick manual canned run.
if (import.meta.url === `file://${process.argv[1]}`) {
  runHarness().then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
