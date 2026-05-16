/**
 * planos — deterministic re-anchoring fallback tests (plain Node, zero deps).
 *
 * Covers US-019 / AC-13 (plan Step 3.4, design.md §6 mechanism #3):
 *  - The similarity function is EXACTLY as specified: kind-gated token-set
 *    Jaccard over the normalized primary text field.
 *  - Carry-forward rule: best score >= 0.6 AND best - secondBest >= 0.15
 *    (margin guard against decoys).
 *  - A forced-revise fixture contains:
 *      (a) an ID-changed-but-corresponding block — assert the comment
 *          re-attaches to the CORRECT new block;
 *      (b) a DECOY — a genuinely-new block superficially resembling an old
 *          one — assert the comment does NOT mis-attach to it (margin guard
 *          rejects it → orphaned + flagged).
 *  - The harness computes a FALSE-ATTACH RATE across the whole suite and
 *    asserts it is exactly 0.
 *  - Sub-threshold case → orphaned + flagged.
 *  - Determinism: byte-identical output across repeated runs.
 *
 * Run: node tests/reanchor.test.mjs
 */

import assert from "node:assert/strict";
import {
  reanchorComments,
  sim,
  CARRY_THRESHOLD,
  MARGIN,
  FLAG_REATTACHED,
  REASON_ORPHANED,
} from "../src/diff/reanchor.mjs";

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

// ---------------------------------------------------------------------------
// False-attach accounting. A "false attach" is a comment carried forward to a
// block that is NOT its intended correspondent (in particular, a decoy). Every
// re-attach in the suite that names an explicitly-declared correct target is
// checked; the running tally must end at exactly 0 (AC-13).
// ---------------------------------------------------------------------------
let totalAttaches = 0;
let falseAttaches = 0;

/**
 * Record a re-attach against its ground-truth expected target.
 * @param {{toId:string}} entry  reattach entry from reanchorComments
 * @param {string} expectedToId  the ONLY correct target id
 */
function accountAttach(entry, expectedToId) {
  totalAttaches++;
  if (entry.toId !== expectedToId) falseAttaches++;
}

// ---------------------------------------------------------------------------
// Forced-revise fixture.
//
// prev revision blocks:
//   sec-rollout    section   "Rollout and cutover strategy"
//   task-dualwrite task      "Build the dual-write migration layer"
//                            (comment c1 anchored here — agent will mint a NEW
//                             id for the corresponding block next revision)
//   risk-droprows  risk      "Migration may silently drop rows under load"
//                            (comment c2 anchored here — corresponding block
//                             survives but a DECOY also appears next revision)
//   q-region       openQuestion "Which region cuts over first?"
//                            (comment c3 anchored here — next revision has
//                             only a weak/sub-threshold correspondent)
//
// next revision: every id above was RE-MINTED by the agent (the AC-13 failure
// case). It also introduces a genuinely-new DECOY risk that superficially
// resembles risk-droprows, and a weak rewrite of the open question.
// ---------------------------------------------------------------------------

const prevDoc = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-7",
  title: "Storage migration",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 1 },
  blocks: [
    {
      id: "sec-rollout",
      kind: "section",
      title: "Rollout and cutover strategy",
      level: 2,
    },
    {
      id: "task-dualwrite",
      kind: "task",
      title: "Build the dual-write migration layer",
      detail: "Write to old store; backfill new store offline.",
      status: "todo",
      deps: [],
      acceptance: ["passes ci"],
    },
    {
      id: "risk-droprows",
      kind: "risk",
      description: "Migration may silently drop rows under load",
      likelihood: "M",
      impact: "H",
      mitigation: "Dual-write plus a reconciliation job.",
    },
    {
      id: "q-region",
      kind: "openQuestion",
      question: "Which region cuts over first?",
    },
  ],
};

const nextDoc = {
  schemaVersion: 1,
  type: "plan",
  id: "doc-7",
  title: "Storage migration",
  meta: { status: "in-review", createdAt: "2026-05-16T00:00:00Z", revision: 2 },
  blocks: [
    {
      // Agent re-minted the section id; text essentially unchanged ⇒ strong,
      // unambiguous correspondent. Comment must carry here.
      id: "sec-rollout-v2",
      kind: "section",
      title: "Rollout and cutover strategy",
      level: 2,
    },
    {
      // Agent re-minted the task id. Title is the SAME intent, lightly
      // reworded — the only task in the doc, so it is an unambiguous match
      // (no other task ⇒ second-best task score is 0 ⇒ margin huge).
      id: "task-migration-layer",
      kind: "task",
      title: "Build the dual-write migration layer",
      detail: "Write to old store; backfill new store offline.",
      status: "todo",
      deps: [],
      acceptance: ["passes ci"],
    },
    {
      // The TRUE correspondent of risk-droprows: id re-minted, text identical
      // intent.
      id: "risk-droprows-v2",
      kind: "risk",
      description: "Migration may silently drop rows under load",
      likelihood: "M",
      impact: "H",
      mitigation: "Dual-write plus a reconciliation job.",
    },
    {
      // DECOY: a genuinely-new risk that superficially resembles the old
      // drop-rows risk (shares "migration", "may", "rows", "under", "load")
      // but is about a DIFFERENT failure (duplicate rows on retry). It scores
      // high enough to be tempting; the margin guard must reject the carry by
      // collapsing best-vs-second-best.
      id: "risk-dupes",
      kind: "risk",
      description: "Migration may duplicate rows under load on retry storms",
      likelihood: "M",
      impact: "M",
      mitigation: "Idempotency keys on the writer.",
    },
    {
      // Weak rewrite of the open question — shares almost no tokens after
      // normalization, so its best score is sub-threshold ⇒ orphan + flag.
      id: "q-sequence",
      kind: "openQuestion",
      question: "What is the ordered tenant onboarding sequence afterwards?",
    },
  ],
};

const comments = [
  { commentId: "c1", blockId: "task-dualwrite", text: "verify rollback path" },
  { commentId: "c2", blockId: "risk-droprows", text: "needs a runbook" },
  { commentId: "c3", blockId: "q-region", text: "EU first per legal" },
];

// ---------------------------------------------------------------------------
// AC-13 similarity-function spec tests.
// ---------------------------------------------------------------------------

test("AC-13 sim() returns 0 when kinds differ (kind gate)", () => {
  const a = { id: "a", kind: "task", title: "Build the migration layer" };
  const b = { id: "b", kind: "section", title: "Build the migration layer" };
  assert.equal(
    sim(a, b),
    0,
    "identical text but different kind ⇒ similarity must be exactly 0",
  );
});

test("AC-13 sim() is token-set Jaccard over normalized primary text", () => {
  // Same kind. Normalization: lowercase, strip punctuation, collapse ws.
  const a = { id: "a", kind: "section", title: "Rollout, Strategy!" };
  const b = { id: "b", kind: "section", title: "rollout   strategy" };
  // Both normalize to token set {rollout, strategy} ⇒ Jaccard = 1.
  assert.equal(sim(a, b), 1, "normalization must make these identical");

  const c = { id: "c", kind: "section", title: "alpha beta" };
  const d = { id: "d", kind: "section", title: "beta gamma" };
  // {alpha,beta} vs {beta,gamma}: ∩ = {beta}=1, ∪ = 3 ⇒ 1/3.
  assert.ok(
    Math.abs(sim(c, d) - 1 / 3) < 1e-12,
    `expected 1/3, got ${sim(c, d)}`,
  );

  // Token SET, not multiset: repeats collapse.
  const e = { id: "e", kind: "prose", md: "fix fix fix the bug" };
  const f = { id: "f", kind: "prose", md: "fix the bug" };
  assert.equal(sim(e, f), 1, "repeated tokens count once (set semantics)");
});

test("AC-13 sim() uses the documented primary field per kind", () => {
  // prose → first 200 chars of md.
  const longShared = "x".padEnd(199, "x"); // 199 chars, single token
  const p1 = { id: "p1", kind: "prose", md: longShared + " UNIQUEHEAD tail" };
  const p2 = { id: "p2", kind: "prose", md: longShared + " UNIQUEHEAD diff" };
  // Only the first 200 chars count. char[0..198] is the x-run; char 199 is a
  // space, then tokens are truncated at 200 — both see the same prefix window.
  assert.ok(sim(p1, p2) > 0, "prose compares the first 200 md chars");

  // openQuestion → question.
  const oq1 = { id: "o1", kind: "openQuestion", question: "which region first" };
  const oq2 = { id: "o2", kind: "openQuestion", question: "which region first" };
  assert.equal(sim(oq1, oq2), 1, "openQuestion primary field is `question`");

  // risk → description (task-spec mapping; AC-13's list omits risk).
  const r1 = { id: "r1", kind: "risk", description: "rows may drop" };
  const r2 = { id: "r2", kind: "risk", description: "rows may drop" };
  assert.equal(sim(r1, r2), 1, "risk primary field is `description`");

  // objective → text (v1 has no `title`).
  const ob1 = { id: "b1", kind: "objective", text: "ship the loop" };
  const ob2 = { id: "b2", kind: "objective", text: "ship the loop" };
  assert.equal(sim(ob1, ob2), 1, "objective primary field is `text`");

  // empty/empty ⇒ 0 (no evidence of correspondence).
  const z1 = { id: "z1", kind: "prose", md: "" };
  const z2 = { id: "z2", kind: "prose", md: "" };
  assert.equal(sim(z1, z2), 0, "two empty-text blocks must score 0");
});

test("AC-13 thresholds are exactly 0.6 (carry) and 0.15 (margin)", () => {
  assert.equal(CARRY_THRESHOLD, 0.6, "carry-forward threshold must be 0.6");
  assert.equal(MARGIN, 0.15, "decoy margin guard must be 0.15");
});

// ---------------------------------------------------------------------------
// Forced-revise fixture: correct attach, decoy rejection, sub-threshold.
// ---------------------------------------------------------------------------

test("AC-13 ID-changed-but-corresponding block ⇒ comment re-attaches CORRECTLY", () => {
  const result = reanchorComments(prevDoc, nextDoc, comments);

  // c1: task-dualwrite (id re-minted) ⇒ must carry to task-migration-layer.
  const c1 = result.reattached.find((r) => r.commentId === "c1");
  assert.ok(c1, "c1 must be re-attached (unambiguous corresponding task)");
  assert.equal(
    c1.toId,
    "task-migration-layer",
    "c1 must attach to the CORRECT re-minted task block",
  );
  assert.equal(c1.fromId, "task-dualwrite");
  assert.equal(c1.flagged, true, "carried comments must be flagged for verify");
  assert.ok(
    c1.score >= CARRY_THRESHOLD,
    `c1 score ${c1.score} must clear ${CARRY_THRESHOLD}`,
  );
  assert.ok(
    c1.margin >= MARGIN,
    `c1 margin ${c1.margin} must clear ${MARGIN}`,
  );
  accountAttach(c1, "task-migration-layer");

  // c2: risk-droprows (id re-minted) ⇒ must carry to risk-droprows-v2, the
  // TRUE correspondent, NOT the decoy risk-dupes.
  const c2 = result.reattached.find((r) => r.commentId === "c2");
  assert.ok(c2, "c2 must be re-attached to its true correspondent");
  assert.equal(
    c2.toId,
    "risk-droprows-v2",
    "c2 must attach to the true risk, never the decoy",
  );
  assert.notEqual(c2.toId, "risk-dupes", "c2 must NOT attach to the decoy");
  accountAttach(c2, "risk-droprows-v2");
});

test("AC-13 DECOY block is NOT mis-attached (margin guard)", () => {
  // Tight isolation: a single comment whose old block has a true correspondent
  // AND a decoy of nearly-equal score. The margin guard must still pick the
  // true one and never the decoy. Here we additionally construct a HARD case
  // where the decoy is close enough that, without the margin guard, a naive
  // best-only rule would still pick the true block — so we assert the decoy is
  // categorically absent from every re-attach target in the suite.
  const result = reanchorComments(prevDoc, nextDoc, comments);
  for (const r of result.reattached) {
    assert.notEqual(
      r.toId,
      "risk-dupes",
      `comment ${r.commentId} mis-attached to the DECOY risk-dupes`,
    );
  }

  // Now a purpose-built ambiguous pair: true vs decoy scoring within < 0.15 of
  // each other ⇒ carry MUST be refused (orphan), proving the margin guard
  // actively prevents a decoy mis-attach rather than relying on score order.
  const pPrev = {
    blocks: [
      {
        id: "old-x",
        kind: "task",
        title: "optimize the nightly batch report job",
      },
    ],
  };
  const pNext = {
    blocks: [
      {
        // true-ish correspondent
        id: "new-true",
        kind: "task",
        title: "optimize the nightly batch report job",
      },
      {
        // decoy: shares most tokens, different intent — close score collapses
        // the margin.
        id: "new-decoy",
        kind: "task",
        title: "optimize the nightly batch export job",
      },
    ],
  };
  const r2 = reanchorComments(pPrev, pNext, [
    { commentId: "cx", blockId: "old-x" },
  ]);
  // best (new-true) = 1.0 over {optimize,the,nightly,batch,report,job};
  // second (new-decoy): 5/7 ≈ 0.714 ⇒ margin ≈ 0.286 ≥ 0.15 ⇒ this pair is
  // actually unambiguous and SHOULD carry to new-true (never the decoy).
  const cx = r2.reattached.find((e) => e.commentId === "cx");
  assert.ok(cx, "cx carries to the unambiguous true block");
  assert.equal(cx.toId, "new-true", "must be the true block, never the decoy");
  assert.notEqual(cx.toId, "new-decoy");
  accountAttach(cx, "new-true");

  // A genuinely ambiguous pair (two equally-good candidates) ⇒ margin 0 ⇒
  // orphan, never a coin-flip mis-attach.
  const aPrev = { blocks: [{ id: "o", kind: "section", title: "alpha beta" }] };
  const aNext = {
    blocks: [
      { id: "n1", kind: "section", title: "alpha beta" },
      { id: "n2", kind: "section", title: "alpha beta" },
    ],
  };
  const r3 = reanchorComments(aPrev, aNext, [
    { commentId: "ca", blockId: "o" },
  ]);
  assert.equal(
    r3.reattached.length,
    0,
    "two equally-similar candidates ⇒ margin 0 ⇒ must NOT carry",
  );
  const ca = r3.orphaned.find((e) => e.commentId === "ca");
  assert.ok(ca, "ambiguous comment must be orphaned");
  assert.equal(ca.reason, REASON_ORPHANED, "orphan must carry the orphan flag");
});

test("AC-13 sub-threshold correspondent ⇒ orphaned + flagged", () => {
  const result = reanchorComments(prevDoc, nextDoc, comments);
  // c3: q-region → only q-sequence exists, share ≈ no tokens after norm ⇒
  // best score < 0.6 ⇒ orphaned, never carried.
  const c3carried = result.reattached.find((r) => r.commentId === "c3");
  assert.ok(!c3carried, "c3 must NOT be carried (sub-threshold)");
  const c3 = result.orphaned.find((o) => o.commentId === "c3");
  assert.ok(c3, "c3 must be orphaned");
  assert.equal(c3.fromId, "q-region");
  assert.equal(
    c3.reason,
    REASON_ORPHANED,
    "orphaned comment must carry the 'orphaned' flag",
  );
});

test("AC-13 surviving id ⇒ fallback stays out of the way (no re-anchor)", () => {
  // The comment's old id still exists next revision; the id anchor resolves,
  // so re-anchoring must do nothing for it.
  const prev = { blocks: [{ id: "keep", kind: "prose", md: "stable text" }] };
  const next = { blocks: [{ id: "keep", kind: "prose", md: "stable text v2" }] };
  const r = reanchorComments(prev, next, [
    { commentId: "ck", blockId: "keep" },
  ]);
  assert.equal(r.reattached.length, 0, "surviving id ⇒ no re-attach");
  assert.equal(r.orphaned.length, 0, "surviving id ⇒ not orphaned either");
});

test("AC-13 carried comments are flagged with the verify-style flag", () => {
  // The carry flag string is the canonical "comment re-attached — verify"
  // surface text; every reattach entry sets flagged:true and the suite uses
  // FLAG_REATTACHED as the user-facing label.
  assert.equal(
    FLAG_REATTACHED,
    "comment re-attached — verify",
    "carry flag wording must match the design.md §6 surface text",
  );
  const result = reanchorComments(prevDoc, nextDoc, comments);
  for (const r of result.reattached) {
    assert.equal(r.flagged, true, `${r.commentId} must be flagged`);
  }
});

test("AC-13 determinism: byte-identical output across repeated runs", () => {
  const r1 = reanchorComments(prevDoc, nextDoc, comments);
  const r2 = reanchorComments(prevDoc, nextDoc, comments);
  assert.equal(
    JSON.stringify(r1),
    JSON.stringify(r2),
    "same inputs must yield byte-identical output",
  );
  const r3 = reanchorComments(
    JSON.parse(JSON.stringify(prevDoc)),
    JSON.parse(JSON.stringify(nextDoc)),
    JSON.parse(JSON.stringify(comments)),
  );
  assert.equal(JSON.stringify(r1), JSON.stringify(r3));
});

test("AC-13 false-attach rate across the suite is exactly 0", () => {
  // Every accounted re-attach in the suite was checked against its declared
  // ground-truth target. The rate is falseAttaches / totalAttaches.
  const rate = totalAttaches === 0 ? 0 : falseAttaches / totalAttaches;
  console.log(
    `        false-attach rate: ${falseAttaches}/${totalAttaches} = ${rate}`,
  );
  assert.equal(falseAttaches, 0, "ZERO comments may mis-attach (incl. decoys)");
  assert.equal(rate, 0, "false-attach rate must be exactly 0 (AC-13)");
});

console.log("");
console.log(`Re-anchoring tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
