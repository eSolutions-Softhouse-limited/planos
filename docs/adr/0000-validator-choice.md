# ADR 0000 — Schema validator: Zod vs. hand-rolled

- Status: Accepted
- Date: 2026-05-16
- Context: planos Phase 1, Milestone 0, Step 0.4 (US-004). Authoritative source:
  `.omc/plans/planos-phase1-consensus.md` Step 0.4; `docs/design.md` §4–§5, §8.

## Decision

We validate the v1 block schema with a **zero-dependency hand-rolled validator**
(`src/schema/validate.mjs`), not Zod. *Zod* offers a mature, terse schema DSL
with good type inference, but it is a runtime dependency that would sit in (or
be transitively reachable from) the blocking `ExitPlanMode` hook path, its error
messages are shaped for developers rather than for the corrective deny→revise
preamble, and it conflicts with the zero-runtime-dependency / offline-by-default
constraint and the AC-17 import-graph invariant. The hand-rolled validator gives
us zero runtime deps in the blocking path, full control over field-level error
strings that are tuned to feed the deny→revise preamble (AC-6), and a validator
that is trivially auditable in the AC-17 import-graph walk; the cost is more code
to write and exhaustive per-v1-kind checks to hand-maintain. The blocking-path
zero-dep + offline constraints and corrective-error-message control dominate, so
**hand-rolled is chosen**; we revisit only if the schema grows materially in
Phase 2+ (PRD/diff-review vocab).
