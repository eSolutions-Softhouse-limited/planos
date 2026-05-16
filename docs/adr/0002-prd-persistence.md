# ADR 0002 — PRD persistence layout, v2 schema scoping, and the Phase-2 ID waiver

- Status: **ACCEPTED** — `src/prd/store.mjs` wired to the chosen layout
- Date: 2026-05-16
- Deciders: Phase 2 user sign-off (`.omc/plans/planos-phase2-plan.md`
  "Resolved Decisions (user sign-off 2026-05-16)"); Phase 2 / Milestone P5
- Plan: `.omc/plans/planos-phase2-plan.md` §5 (persistence), §6 (AC-P9, AC-P10,
  AC-P16, AC-P18), §7 P1/P5, Open Decisions D1/D3/D5/D6 + their resolutions
- Supersedes: the Open-Decision D1/D3/D5/D6 placeholders in the Phase 2 plan
- Raw evidence: `tests/prd-store.test.mjs`, `tests/prd-roundtrip.test.mjs`,
  `tests/harness/prd-smoke.mjs`, `tests/ac17-invariant.test.mjs` (PRD layer);
  Phase 1 live evidence reused: `docs/adr/0001-block-id-scheme.md`,
  `.omc/research/live-opaque.json`, `.omc/research/phase1-exit-gate.json`

## Context

Phase 2 adds PRD mode: a `/planos-prd` command that boots the blocking server
directly (command → blocking CLI, NOT an `ExitPlanMode` hook), the full v2
block vocabulary, and **persisted multi-revision history**. Phase 1 already
proved the structured-artifact loop and falsified-clear the §6 block-ID
risk (`opaque` is the production default, ADR-0001 ACCEPTED). Persisting an
append-only revision chain to disk introduced four genuine decisions that the
Phase 2 plan surfaced as Open Decisions requiring human sign-off before
execution: the on-disk layout / git disposition (D1), `diagram` rendering
(D3), v2 schema scoping / strictness (D5), and the Phase-2 gating rigor (D6).
This ADR records the signed-off resolutions and the AC-P18 reasoned waiver.

## Decision

### D1 — PRD persistence layout & git disposition → **Option A (committed)**

PRD documents persist at:

```
prds/<doc-id>/rNNN.json    NNN = zero-padded 3-digit meta.revision
prds/<doc-id>/latest.json   always the most-recently-written revision
```

**committed to git**, append-only, with **canonical JSON** (recursively
key-sorted via the same `canonicalize` ordering as `src/diff/structural.mjs`,
so per-revision diffs are byte-stable) and **path-traversal-safe** keys
(`prdPath()` rejects empty / absolute / `..` / path-separator `docId`s before
touching the filesystem). One directory per PRD keyed by the stable document
`id` (the §4 revision-chain key, already enforced as a non-empty string by
`validate.mjs`); one immutable JSON file per revision (`r001.json`,
`r002.json`, …); `latest.json` for a fast "current" pointer. `meta.revision`
is monotonic and the persisted chain — not the agent-authored advisory value —
is the source of truth for monotonicity (`src/hook/prd.mjs` normalises the new
doc's `meta.revision` to `prior + 1`). `saveRevision` refuses to overwrite an
existing `rNNN.json` (the append-only invariant the multi-revision history
browser depends on). The layer is pure `node:fs` / `node:path` and never reads
the system clock (timestamps pass through the doc's own `meta.createdAt`).

The rejected alternatives: **Option B** (same layout, gitignored / local-only)
loses history on a clean checkout and is not shareable in review — undercutting
planos's core thesis that the structured artifact IS the reviewable
deliverable; **Option C** (single append-only `.jsonl`) is more compact but far
less human-diffable per revision in a PR than discrete files. Option A's only
real cost — PRD JSON noise in git history — is mitigated (PRDs are revised in
bursts, not continuously; `code`/`diagram` blocks are bounded; canonical JSON
keeps per-revision diffs minimal) and is an org-specific tolerance the user
explicitly accepted in favour of PR-visible reviewable PRD history.

### D3 — `diagram.mermaid` rendering → **bundle mermaid at build time**

A mermaid renderer is bundled into the single-file SPA **at build time** so
`diagram` blocks render visually. Constraints, all upheld: the runtime stays
fully offline (the renderer is inlined into `plugin/dist/index.html` — no CDN,
no network); the artifact size grows within a documented/asserted cap (drift
check AC-P17); and the renderer is **SPA-side ONLY**. It is NOT reachable from
`bin/planos exit` or `bin/planos prd` — the AC-17 import-graph walk over the
blocking roots (including the new prd roots) stays VERDICT CLEAN, re-verified
after the build.

### D5 — v2 schema scoping & strictness → **(i) reject / (ii) hard / (iii) agent-authored**

- **(i)** v2 kinds (`phase, tradeoff, fileChange, code, table, diagram`) are
  REJECTED in `type:"plan"` documents and accepted only for `type:"prd"`
  documents — the plan-mode v1 contract stays tight (AC-P2).
- **(ii)** A `table` block whose `rows` length does not match `columns` length
  is a **hard validator error** (a field-level error string the deny→revise
  preamble can surface), not a soft note.
- **(iii)** `phase.taskIds` referential integrity is **agent-authored**, NOT
  validator-enforced — exactly mirroring v1 `task.deps`. No referential graph
  check runs in the blocking path (consistent with AC-17: the blocking path
  does no model-/graph-reasoning work the agent is responsible for).

### D6 — Phase-2 gating rigor → **lighter-but-rigorous, no new frozen bar**

Phase 1 froze numeric ID-stability bars because ID stability was the
make-or-break unfalsifiable risk. Phase 2's risk profile is different (no new
ID-generation surface; the §6 falsifier already passed at 1.000). The Phase 2
exit gate is therefore the **18-AC harness/doc/manual set** of plan §6, plus:
the full offline test suite green, `tsc --noEmit` clean, the AC-17
import-graph CLEAN **including the new prd roots**, and the concrete
deterministic `tests/harness/prd-smoke.mjs` persistence proof. There is **NO
new frozen numeric bar** and **NO Milestone-1-style live ID re-measurement**
(see the AC-P18 waiver below). This lighter-but-rigorous gate was explicitly
signed off as acceptable for Phase 2.

## AC-P18 — No-Phase-2-ID-re-measurement (reasoned waiver, NOT an omission)

Phase 2 does **NOT** re-run the Milestone-1 ID-stability gate, and this is a
documented, reasoned waiver:

1. **`opaque` was chosen *for* exactly this case.** ADR-0001's tie-break
   rationale #2 ("Rename / growth stability") explicitly names "Phase 2+ PRD
   mode" title edits: opaque tokens have no coupling to block text, so
   revisions that heavily churn titles (the PRD case) cannot induce slug drift
   or slug collisions. The production default was selected *specifically*
   because it survives Phase-2 title churn.
2. **The §6 falsifier already passed at 1.000.** ADR-0001 records 6/6 live
   runs per scheme at 1.000 ID-preservation with the full mechanism set
   (instruction injection + the always-on `(id,kind,title)` deny-echo table +
   the proven hook loop). The make-or-break risk is falsified-clear.
3. **v2 introduces no new ID-generation surface.** IDs remain agent-minted
   opaque tokens; `src/hook/prd.mjs` reuses Phase 1's `buildDecision` /
   `renderEchoTable` VERBATIM and the echo table is kind-agnostic, so the v2
   vocabulary adds zero new ID-minting or ID-preservation code paths.
4. **The PRD round-trip + agent authoring were already proven live.**
   `src/hook/prd.mjs` reuses Phase 1's `readStdin` / `extractPlan` /
   `planToDocument` / `buildDecision` / `buildReviseMessage` /
   `renderEchoTable` / `startServer` byte-for-byte; Phase 2 adds only the
   entry path and the deterministic filesystem persistence — both exercised
   offline by `tests/prd-roundtrip.test.mjs` + `tests/harness/prd-smoke.mjs`.
   Spending `claude` to re-measure model behaviour Phase 1 already measured
   would be redundant, not more rigorous.
5. **The only unmeasured risk is moot.** ADR-0001's noted follow-up — that
   semantic-slug's title-churn weakness was *not* stressed by the
   intent-preserving Phase-1 forced revise — applies ONLY to semantic-slug.
   semantic-slug is NOT the production default and is not reconsidered in
   Phase 2; opaque's residual weakness was the one fully exercised and proven
   absorbed. The unmeasured risk is therefore irrelevant unless semantic-slug
   is reconsidered (it is not).

Conclusion: re-running the Milestone-1 ID gate in Phase 2 would re-measure an
already-falsified-clear risk against the very scheme that was chosen to
neutralise it, on code paths reused verbatim. The waiver is principled and
recorded; it is not an omission.

## Consequences

- `src/prd/store.mjs` is the single persistence authority: append-only,
  path-safe, canonical-JSON, `node:fs`-only. Its filesystem writes are
  explicitly **in-scope-allowed** under AC-17 (filesystem ≠ network/model —
  the SAME boundary logic as the `src/hook/exit.mjs` browser-opener note;
  `node:child_process` is the documented allowed boundary, `node:fs` likewise).
- AC-17 is **RE-ASSERTED, not weakened**, for the new `bin/planos prd`
  entrypoint: `tests/harness/import-graph.mjs ac17Roots()` now lists
  `src/hook/prd.mjs`, `src/hook/roundtrip.mjs`, `src/prd/store.mjs` explicitly
  (the dispatcher already reaches `prd.mjs` via the same provable
  `resolve(__dirname,'<lit>')` unwrap as `exit.mjs`; the explicit roots make
  the re-assertion dispatcher-independent), and `tests/ac17-invariant.test.mjs`
  adds a second runtime no-egress/no-spawn layer driving `handlePrd` plus the
  extended static module-set assertion. The walk stays VERDICT CLEAN.
- PR reviewers see PRD revision history as committed, human-diffable JSON;
  the multi-revision browser scans the per-PRD directory and relies on the
  append-only invariant.
- The Phase-2 exit gate is the §6 18-AC set + offline suite + `tsc` + AC-17
  CLEAN + the deterministic prd-smoke proof. No frozen numeric bar; no live ID
  re-measurement. Phase 1 is not regressed (the exit gate
  `tests/harness/verify-exit-gate.mjs` and all `exit-*.test.mjs` stay green).
- Follow-up (unchanged from ADR-0001, out of Phase-2 scope): if semantic-slug
  is ever reconsidered, re-measure it under a title-churning forced revise —
  the gate Phase 1 intentionally did not stress. Not triggered by Phase 2.
