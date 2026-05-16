/**
 * planos — dual block-ID strategy tests (plain Node, zero dependencies).
 *
 * Covers US-009 / plan Step 1.1 / Decision 2 acceptance:
 *  - Both strategies mint VALID, STABLE ids (a re-mint of the same logical
 *    block at the same position yields the same id).
 *  - Collision-disambiguation works for BOTH strategies.
 *  - The SAME logical document round-trips (authors + validates) under EITHER
 *    strategy, selected purely via the PLANOS_ID_STRATEGY flag — no code
 *    change at the call site.
 *  - The injected authoring-instruction text DIFFERS per strategy and ALWAYS
 *    contains the strategy-invariant never-renumber rule.
 *  - No scheme is hardwired as the production winner (the decision is the
 *    user's Milestone 1 live gate; the env default is DEV-ONLY).
 *
 * Run: node tests/id-strategy.test.mjs
 */

import assert from "node:assert/strict";
import {
  validateDocument,
  ID_STRATEGIES,
  ID_STRATEGY_ENV,
  DEV_DEFAULT_STRATEGY,
  getStrategy,
  makeIdFactory,
  idPreservationInstruction,
  activeIdStrategy,
} from "../src/schema/index.mjs";

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

/**
 * One logical plan, expressed as strategy-agnostic block templates (no `id`).
 * The same templates are run through whichever strategy the flag selects, so
 * the document is provably authorable/validatable under EITHER scheme.
 */
const BLOCK_TEMPLATES = [
  { kind: "section", title: "Auth rewrite", level: 1 },
  { kind: "prose", md: "Replace the legacy session store." },
  {
    kind: "objective",
    text: "Zero downtime migration",
    successCriteria: ["no 5xx spike", "p99 < 200ms"],
  },
  {
    kind: "task",
    title: "Build dual-write layer",
    status: "doing",
    deps: [],
    acceptance: ["both stores consistent under load"],
  },
  {
    kind: "decision",
    question: "Token format?",
    options: [{ label: "JWT" }, { label: "opaque" }],
  },
  {
    kind: "risk",
    description: "Cache stampede on cutover",
    likelihood: "M",
    impact: "H",
    mitigation: "request coalescing",
  },
  { kind: "openQuestion", question: "Keep the legacy endpoint one release?" },
];

/** Author a full v1 document for a given strategy via the public flag path. */
function authorDocument(strategy) {
  const factory = makeIdFactory(strategy);
  const seen = new Set();
  const blocks = BLOCK_TEMPLATES.map((tpl) => {
    const id = factory.mint(tpl, seen);
    seen.add(id);
    return { id, ...tpl };
  });
  return {
    schemaVersion: 1,
    type: "plan",
    id: `doc-${strategy}`,
    title: "Auth rewrite",
    meta: {
      status: "in-review",
      createdAt: "2026-05-16T00:00:00.000Z",
      revision: 1,
    },
    blocks,
  };
}

// ---- strategy registry / flag resolution ----

test("US-009 exactly the two candidate strategies are registered", () => {
  assert.deepEqual([...ID_STRATEGIES].sort(), ["opaque", "semantic-slug"]);
});

test("US-009 getStrategy honors the PLANOS_ID_STRATEGY flag both ways", () => {
  assert.equal(
    getStrategy({ [ID_STRATEGY_ENV]: "opaque" }),
    "opaque",
    "flag must select opaque",
  );
  assert.equal(
    getStrategy({ [ID_STRATEGY_ENV]: "semantic-slug" }),
    "semantic-slug",
    "flag must select semantic-slug",
  );
});

test("US-009 unknown/unset flag falls back to the DEV-ONLY default", () => {
  assert.equal(getStrategy({}), DEV_DEFAULT_STRATEGY);
  assert.equal(getStrategy({ [ID_STRATEGY_ENV]: "bogus" }), DEV_DEFAULT_STRATEGY);
  // The DEV default must itself be a real strategy, but this is NOT a
  // production winner — the decision is deferred to the Milestone 1 live gate.
  assert.ok(ID_STRATEGIES.includes(DEV_DEFAULT_STRATEGY));
});

// ---- both strategies mint valid, stable ids ----

for (const strategy of ID_STRATEGIES) {
  test(`US-009 [${strategy}] mints non-empty string ids that pass v1 validation`, () => {
    const doc = authorDocument(strategy);
    for (const b of doc.blocks) {
      assert.equal(typeof b.id, "string", `id must be a string for ${b.kind}`);
      assert.ok(b.id.length > 0, `id must be non-empty for ${b.kind}`);
    }
    const res = validateDocument(doc);
    assert.equal(
      res.ok,
      true,
      `doc under ${strategy} must validate, got ${JSON.stringify(res)}`,
    );
  });

  test(`US-009 [${strategy}] ids are stable: re-authoring the same doc yields identical ids`, () => {
    const a = authorDocument(strategy).blocks.map((b) => b.id);
    const b = authorDocument(strategy).blocks.map((x) => x.id);
    assert.deepEqual(a, b, "same logical doc must produce same ids");
  });

  test(`US-009 [${strategy}] ids are unique within a document`, () => {
    const ids = authorDocument(strategy).blocks.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  });
}

// ---- collision-disambiguation, both strategies ----

test("US-009 [semantic-slug] collisions disambiguate with -2 / -3 suffixes", () => {
  const f = makeIdFactory("semantic-slug");
  const seen = new Set();
  const dup = { kind: "task", title: "Refactor the parser" };
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = f.mint(dup, seen);
    seen.add(id);
    ids.push(id);
  }
  assert.equal(ids[0], "task-refactor-the-parser");
  assert.equal(ids[1], "task-refactor-the-parser-2");
  assert.equal(ids[2], "task-refactor-the-parser-3");
  assert.equal(new Set(ids).size, 3);
});

test("US-009 [semantic-slug] disambiguates against PRE-EXISTING agent ids", () => {
  const f = makeIdFactory("semantic-slug");
  const existing = new Set(["task-do-it"]);
  const id = f.mint({ kind: "task", title: "Do it" }, existing);
  assert.equal(id, "task-do-it-2", "must skip the id the agent already used");
});

test("US-009 [semantic-slug] empty/symbol-only primary text falls back to kind prefix", () => {
  const f = makeIdFactory("semantic-slug");
  const seen = new Set();
  const a = f.mint({ kind: "prose", md: "" }, seen);
  seen.add(a);
  const b = f.mint({ kind: "prose", md: "!!!" }, seen);
  assert.equal(a, "prose");
  assert.equal(b, "prose-2", "second empty-slug prose must disambiguate");
});

test("US-009 [opaque] mints monotonic b<n> tokens with no semantic coupling", () => {
  const f = makeIdFactory("opaque");
  const seen = new Set();
  const ids = [];
  for (const tpl of BLOCK_TEMPLATES) {
    const id = f.mint(tpl, seen);
    seen.add(id);
    ids.push(id);
  }
  ids.forEach((id) => assert.match(id, /^b\d+$/, `opaque id shape: ${id}`));
  assert.deepEqual(ids, ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
  // No semantic coupling: differently-titled blocks still get plain bN.
  const g = makeIdFactory("opaque");
  assert.equal(g.mint({ kind: "task", title: "totally different" }, new Set()), "b1");
});

test("US-009 [opaque] never reissues an id already present (collision-safe)", () => {
  const f = makeIdFactory("opaque");
  const existing = new Set(["b1", "b2", "b5"]);
  const id = f.mint({ kind: "task", title: "x" }, existing);
  assert.ok(!existing.has(id), `must not collide, got ${id}`);
  assert.match(id, /^b\d+$/);
  assert.ok(
    Number(id.slice(1)) > 5,
    `must seed past the highest existing token, got ${id}`,
  );
});

// ---- same logical doc round-trips under EITHER strategy via the flag ----

test("US-009 same logical document is authorable + validatable under BOTH strategies", () => {
  for (const flag of ["semantic-slug", "opaque"]) {
    const { strategy, idFactory } = activeIdStrategy({
      [ID_STRATEGY_ENV]: flag,
    });
    assert.equal(strategy, flag, "flag must drive the active strategy");
    assert.equal(idFactory.strategy, flag);

    const doc = authorDocument(strategy);
    const res = validateDocument(doc);
    assert.equal(
      res.ok,
      true,
      `[${flag}] doc must validate, got ${JSON.stringify(res)}`,
    );
    // Block COUNT, kinds, and order are strategy-invariant; only ids differ.
    assert.equal(doc.blocks.length, BLOCK_TEMPLATES.length);
    assert.deepEqual(
      doc.blocks.map((b) => b.kind),
      BLOCK_TEMPLATES.map((t) => t.kind),
    );
  }
});

test("US-009 the two strategies produce DIFFERENT ids for the same logical doc", () => {
  const slug = authorDocument("semantic-slug").blocks.map((b) => b.id);
  const opaque = authorDocument("opaque").blocks.map((b) => b.id);
  assert.notDeepEqual(slug, opaque, "schemes must be observably distinct");
  assert.ok(slug.some((id) => id.includes("-")), "slug ids are semantic");
  assert.ok(opaque.every((id) => /^b\d+$/.test(id)), "opaque ids are tokens");
});

// ---- injected authoring-instruction text ----

const NEVER_RENUMBER_NEEDLE = "NEVER renumber";

test("US-009 instruction always contains the never-renumber rule (both strategies)", () => {
  for (const strategy of ID_STRATEGIES) {
    const txt = idPreservationInstruction(strategy);
    assert.ok(
      txt.includes(NEVER_RENUMBER_NEEDLE),
      `[${strategy}] must carry the never-renumber rule`,
    );
    assert.ok(
      /REUSE the `id`/.test(txt),
      `[${strategy}] must carry the REUSE-unchanged-id rule`,
    );
    assert.ok(
      /genuinely new blocks/.test(txt),
      `[${strategy}] must carry the only-mint-for-new rule`,
    );
  }
});

test("US-009 instruction text DIFFERS per strategy (strategy-specific guidance)", () => {
  const slug = idPreservationInstruction("semantic-slug");
  const opaque = idPreservationInstruction("opaque");
  assert.notEqual(slug, opaque, "per-strategy guidance must differ");
  assert.ok(/<kind>-<short-slug>|slug/.test(slug), "slug guidance present");
  assert.ok(/b<number>|opaque token/.test(opaque), "opaque guidance present");
  // The invariant rule is byte-identical across strategies (shared prefix).
  assert.ok(slug.includes(NEVER_RENUMBER_NEEDLE));
  assert.ok(opaque.includes(NEVER_RENUMBER_NEEDLE));
});

test("US-009 activeIdStrategy bundles strategy + factory + instruction from the flag", () => {
  const a = activeIdStrategy({ [ID_STRATEGY_ENV]: "opaque" });
  assert.equal(a.strategy, "opaque");
  assert.equal(a.idFactory.strategy, "opaque");
  assert.ok(a.authoringInstruction.includes(NEVER_RENUMBER_NEEDLE));
  assert.equal(
    a.authoringInstruction,
    idPreservationInstruction("opaque"),
    "bundled instruction must match the strategy",
  );
});

test("US-009 unknown strategy is rejected loudly (no silent winner pick)", () => {
  assert.throws(() => makeIdFactory("best"), /unknown id strategy/);
  assert.throws(
    () => idPreservationInstruction("best"),
    /unknown id strategy/,
  );
});

console.log("");
console.log(`ID-strategy tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
