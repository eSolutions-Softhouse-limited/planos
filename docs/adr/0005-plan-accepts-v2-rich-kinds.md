# ADR 0005 — Plan documents accept v2 rich kinds (reverses ADR-0002 D5(i))

- Status: **ACCEPTED** — `type:"plan"` documents now accept v1∪v2 kinds
  (`phase, tradeoff, fileChange, code, table, diagram`), identical to
  `type:"prd"`. `type:"diff-review"` is unchanged (still v1∪v3, v2 rejected).
- Date: 2026-05-17
- Deciders: user sign-off in the planos-prd field-test follow-up session
  (chose "Keep planos-plan, also enrich it" — widen the v1 plan schema so
  plans get mermaid/tables too, explicitly accepting the D5(i) reversal)
- Supersedes: **ADR-0002 D5(i)** ("v2 kinds are REJECTED in `type:"plan"`
  documents and accepted only for `type:"prd"` … the plan-mode v1 contract
  stays tight"). D5(ii) (table row/column hard error) and D5(iii)
  (`phase.taskIds` agent-authored, no referential check) are UNCHANGED and
  still in force.
- Raw evidence: `tests/v2-schema.test.mjs` (AC-P2 flipped: a `type:"plan"`
  doc ACCEPTS every v2 kind; plan invalid-kind message now `v1∪v2`),
  `tests/v3-schema.test.mjs` (AC-R2 unchanged: diff-review still rejects v2,
  message reworded), `tests/schema.test.mjs` (AC-6 invalid-kind message now
  `v1∪v2` for a plan), `src/schema/validate.mjs` (plan ∪ prd → `PRD_KIND_LIST`;
  v2 rejected only when `isDiffReview`)

## Context

ADR-0002 D5(i) deliberately kept `type:"plan"` documents v1-only so the
plan-mode contract stayed minimal while PRD mode (v2) was introduced. In
practice, a user reviewing a real plan in the browser SPA wanted the same
one-glance visual approvability that v2 affords — Mermaid diagrams, tables,
fileChange lists, code blocks — but the validator rejected those kinds in a
`type:"plan"` document even though the SPA editor already renders all 13
block kinds.

The original "keep the v1 plan contract tight" rationale was a
risk-reduction stance during Phase 2, not a product requirement. With v2
shipped, validated, and rendered, the tightness no longer buys safety — it
only blocks plans from being as expressive as PRDs.

## Decision

`type:"plan"` accepts **v1∪v2** kinds, exactly like `type:"prd"`. The two
document types are now kind-equivalent. `type:"diff-review"` is untouched:
it remains **v1∪v3**, and v2 kinds are still a field-level rejection there
(R7 — v2 PRD/plan kinds are not meaningful in a diff review).

Validator shape after this ADR:

| docType        | accepted kinds |
|----------------|----------------|
| `plan`         | v1 ∪ v2        |
| `prd`          | v1 ∪ v2        |
| `diff-review`  | v1 ∪ v3        |

## Decision Drivers

- User explicitly wants visually-approvable plans (mermaid/tables) — the
  field-test feedback that triggered this work.
- The SPA editor already renders all 13 kinds; the validator was the only
  thing scoping v2 out of plans. No renderer work needed.
- Plan and PRD authoring already share the same Socratic-interview →
  structured-block pipeline; divergent schemas were an artificial split.

## Alternatives Considered

1. **Route richness through PRD mode only** (keep D5(i)). Rejected by the
   user: they want `/planos-plan` itself enriched, not replaced by
   `/planos-prd`.
2. **Editor-only "visual summary" panel**, no schema change. Rejected: does
   not let the agent author real diagrams/tables into a plan.
3. **New net-new block kinds.** Unnecessary — the v2 kinds already cover
   diagrams, tables, code, tradeoffs, and file-change lists.

## Consequences

- **Positive:** plans are now as expressive and visually approvable as PRDs;
  one fewer schema asymmetry to reason about; `planos-plan` can instruct rich
  artifact authoring.
- **Neutral:** `planToDocument`/degrade paths are unaffected (degrade still
  emits a single v1 `prose` block, valid in both plan and prd).
- **Cost:** D5(i)'s "tight v1 plan" invariant is gone; three test
  assertions that encoded it were deliberately flipped (not silently
  broken) and now assert the inverse. AC-17 blocking-path import graph is
  unchanged (no new imports; `src/schema/validate.mjs` was already a
  blocking root).
- **Boundary preserved:** `diff-review` v2 rejection (R7) is intact and
  re-verified; the only message wording changed ("v2 PRD-only kind" →
  "v2 plan/PRD kind").
