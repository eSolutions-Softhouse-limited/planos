# ADR 0003 — Diff review mode, v3 `diff` block, the gh/git/AC-17 boundary, and the Phase-3 ID waiver

- Status: **ACCEPTED** — `bin/planos review` wired; `src/review/ingest.mjs`
  pure-parser leaf; R2 = ephemeral (no `src/review/store.mjs`)
- Date: 2026-05-16
- Deciders: Phase 3 user sign-off (`.omc/plans/planos-phase3-plan.md`
  "Resolved Decisions (user sign-off 2026-05-16)"); Phase 3 / Milestone R5
- Plan: `.omc/plans/planos-phase3-plan.md` §4 (the AC-17 boundary analysis —
  §4.3 the crux, §4.4 the re-assertion mechanism), §5 (persistence decision
  surface), §6 (AC-R1…AC-R16 + AC-R-WAIVER), §7 R0–R5, Open Decisions R1–R7
  + their resolutions
- Supersedes: the Open-Decision R1–R7 placeholders in the Phase 3 plan
- Raw evidence: `tests/v3-schema.test.mjs`, `tests/diff.test.mjs`,
  `tests/reanchor.test.mjs`, `tests/review-ingest.test.mjs`,
  `tests/review-roundtrip.test.mjs`, `tests/planos-review-command.test.mjs`,
  `tests/planos-review-interrupt.test.mjs`, `tests/editor-render.test.mjs`,
  `tests/envelope-emit.test.mjs`, `tests/ac17-invariant.test.mjs` (review
  LAYER 1b + LAYER 2c), `tests/harness/import-graph.mjs` (review roots),
  `tests/harness/review-smoke.mjs`; Phase 1/2 live evidence reused:
  `docs/adr/0001-block-id-scheme.md`, `docs/adr/0002-prd-persistence.md`,
  `.omc/research/live-opaque.json`, `.omc/research/phase1-exit-gate.json`

## Context

Phase 3 adds the **third planos entry mode**: a `/planos-review` command that
boots the blocking server directly (command → blocking CLI, NOT an
`ExitPlanMode` hook — the exact mirror of Phase 2's `/planos-prd`), a v3 `diff`
block kind, ingestion of a GitHub PR diff (`gh pr diff <PR#>`) or a local git
range (`git diff <range>`) into v3 `diff` blocks, per-hunk
accept/reject/comment, and a structured review envelope returned to the agent.
Phase 1 proved the structured-artifact loop and falsified-clear the §6
block-ID risk (`opaque` is the production default, ADR-0001 ACCEPTED). Phase 2
added PRD mode + persisted revision history and re-asserted AC-17 for the new
`bin/planos prd` entrypoint (ADR-0002 ACCEPTED). Phase 3's genuinely new
wrinkle is **`gh` and `git` are subprocesses that touch the network (`gh`) and
the repo (`git`)** — *where* they run is decisive for AC-17. That, plus six
further design questions, were surfaced as Open Decisions R1–R7 requiring
human sign-off before execution. This ADR records the signed-off resolutions
and the AC-R-WAIVER reasoned waiver.

## Decision

### R1 — the gh/git/AC-17 boundary → **Position A (pre-server CLI ingestion)** (the headline)

`gh pr diff <PR#>` / `git diff <range>` runs in the **pre-server CLI agent
loop** — the agent's OWN tool use, before it pipes the authored v3
diff-review JSON into `bin/planos review` via stdin. `src/review/ingest.mjs`
is a **PURE text→blocks parser with ZERO `node:child_process`** (in fact ZERO
imports at all — a regex/line-scan unified-diff parser, exactly the purity
posture of `src/diff/structural.mjs`). The blocking path

```
bin/planos review → src/hook/review.mjs → src/server/ → src/schema/ →
                    src/diff/ → src/review/ingest.mjs
```

stays **byte-for-byte as model/network/spawn-free as Phases 1+2**, with **no
new allowed-boundary carve-out**. This is the EXACT mirror of the Phase 1/2
pre-server-live-agent doctrine: the live agent does its network/tool work
*before* the blocking server boots, identical to the Socratic interview and to
the agent authoring a PRD before piping to `bin/planos prd`.

The rejected alternatives (plan §4.3):

- **Position B** (the blocking path itself shells out to `gh`/`git`) is
  rejected because it would require a THIRD documented allowed-boundary
  carve-out, and critically `gh pr diff` **makes a network call to GitHub**.
  That is materially different from the browser-opener boundary (the opener
  makes NO egress *from the planos process* — the AC-17 socket spy proves it).
  A `gh` subprocess spawned from the blocking path WOULD cause network egress
  attributable to the blocking round-trip, forcing the runtime no-egress
  interceptor to be **loosened** to allow a `gh` spawn — directly weakening the
  invariant the whole architecture exists to protect. Rejected.
- **Position C** (blocking path shells out to `git` ONLY, never `gh`) is
  documented as the only conceivable fallback if a future need ever forced
  git-plumbing inside the binary. `git diff` is local (no network), so a
  narrowly-scoped `node:child_process` carve-out for `git` is *arguable*, but
  it still expands the allowed-boundary surface, complicates the runtime spy
  (must distinguish an allowed `git` spawn from a forbidden agent spawn by
  fragile argv inspection), and gains nothing Position A does not already
  deliver (the agent can run `git diff` in the CLI just as easily as
  `gh pr diff`). Not recommended; not used.

Position A is the unique position that keeps the blocking path byte-for-byte
as clean as Phases 1+2, adds no new carve-out, reuses the proven
pre-server-live-agent doctrine verbatim, and keeps the AC-17 import-graph +
runtime layers CLEAN with the minimum change.

### R2 — does a diff review persist? → **Option A (ephemeral, NOT persisted)**

A diff review is **NOT persisted**. The review round-trip emits a structured
review envelope back to the agent and exits; there is **no `reviews/`
directory, no `src/review/store.mjs`, no `saveRevision`**, no review-store
test suite, and no multi-revision history browser for reviews. Milestone
R1.2/R1.3 store work units and the R2.1 persistence path were DROPPED;
`tests/harness/review-smoke.mjs` proves the **structured review envelope
shape** instead of on-disk persistence. `ac17Roots()` does **NOT** gain a
store root (there is no store module).

Rationale: a PR review's durable home is the PR itself (GitHub) and the
agent's subsequent actions, not a planos-local file; the diff is a *snapshot
of an externally-owned moving artifact* (the PR/range can change underneath)
that planos does not own — a committed `reviews/` tree would rot.
Decisively, **`docs/design.md` §9 omits persistence from the Phase 3 scope
sentence while explicitly naming it for Phase 2** ("persistence to a PRD
directory, multi-revision history browser") — a strong, deliberate signal
that Phase 3 persistence is out of scope. Ephemeral is the smallest correct
surface: it removes an entire module + an ADR sub-decision + a test suite.
Option B (committed append-only `reviews/<doc-id>/rNNN.json`) and Option C
(gitignored local-only) were both rejected for the snapshot-rot reason and
because they reintroduce the surface the §9 omission deliberately excludes.

### R3 — ingestion sources → **both `gh pr diff` and `git diff <range>`**

`/planos-review` supports a PR-number arg (`gh pr diff <PR#>`) and a git-range
arg (`git diff <range>`); the command detects which by argument shape (PR# /
`#123` / PR URL → `gh pr diff`; `main..HEAD` / `HEAD~3` / `sha..sha` →
`git diff`; empty → ask) — mirroring `/planos-prd`'s empty-vs-topic branching.
`src/review/ingest.mjs` is source-agnostic: both `gh` and `git` yield
unified-diff text, parsed by the one pure parser.

### R4 — agent → blocking handoff → **stdin**

`/planos-review` instructs the agent to pipe the authored v3 diff-review JSON
into `bin/planos review` via **stdin**, reusing `readStdin`/`extractPlan`
from `src/hook/roundtrip.mjs` byte-for-byte (identical to Phase 2's D4).

### R5 — per-hunk verdict semantics → **hunk-level only, NO new envelope op**

A hunk verdict is a `BlockComment{commentId, hunkId, text,
verdict:"accept"|"reject"|"comment"}` carried in the `diff` block's
`comments[]`, mutated via the EXISTING `editBlock` op patch.
`src/schema/envelope.mjs` `EDIT_OPS` + `buildDecision` are reused **unchanged**
(no new envelope discriminant — `src/schema/envelope.mjs` is byte-unchanged).
There is no line-level commenting in Phase 3. The structured `ReviewRoundTrip`
envelope flattens every `BlockComment` across every `diff` block, surfacing
per-hunk verdicts (hunk-anchored comments), all comments, an overall decision
(`approve` — the human approved the round-trip), and a `hasRejections` summary
flag so the agent can branch without re-scanning.

### R6 — large / binary / rename handling → **degrade, never block**

Binary / rename / mode-only files become a `diff` block with
`status:"binary"|"renamed"`, **empty `hunks:[]`**, and a descriptive header
(the validator allows empty `hunks` for these statuses; renames carry
`oldPath`). A configurable per-hunk size cap in `src/review/ingest.mjs`
(`maxLinesPerHunk`, default 2000) **elides** oversized hunk bodies with an
explicit `… N lines elided …` context marker rather than throwing or
blocking. This is the Phase-1 `readStdin` degrade-not-block doctrine: the
user is never blocked, the artifact always materialises.

### R7 — diff-review allowed-kinds → **v1 ∪ v3**

A `type:"diff-review"` document accepts the v1 core kinds
(`section`/`prose`/`objective`/`task`/`decision`/`risk`/`openQuestion`) plus
`diff` (v3). The v2 PRD kinds
(`phase`/`tradeoff`/`fileChange`/`code`/`table`/`diagram`) are **REJECTED**
(consistent with ADR-0002 D5-i per-doc-type tightness; `fileChange` is
deliberately excluded as semantically distinct from a concrete `diff`). This
is the third doc-type tier in `validateBlock` (`isDiffReview`), mirroring the
two-tier plan/PRD gate Phase 2 established.

## AC-R-WAIVER — No-Phase-3-ID-re-measurement (reasoned waiver, NOT an omission)

Phase 3 does **NOT** re-run the Milestone-1 ID-stability gate, and this is a
documented, reasoned waiver — recorded identically to ADR-0002's AC-P18:

1. **`opaque` was chosen *for* exactly this kind of churn.** ADR-0001's
   tie-break rationale #2 ("Rename / growth stability") explicitly names the
   Phase 2+ title-edit case; opaque tokens have no coupling to block text, so
   document revisions that churn titles/paths cannot induce slug drift or
   collisions. The production default was selected *specifically* to survive
   this.
2. **The §6 falsifier already passed at 1.000.** ADR-0001 records 6/6 live
   runs per scheme at 1.000 ID-preservation with the full mechanism set
   (instruction injection + the always-on `(id,kind,title)` deny-echo table +
   the proven hook loop). The make-or-break risk is falsified-clear.
3. **v3 introduces NO new *agent-minted* ID surface.** Block IDs remain
   agent-minted opaque tokens. `Hunk.hunkId` and `BlockComment.commentId` are
   **DETERMINISTICALLY ingestion-minted**, NOT agent-recalled — minted by
   `src/review/ingest.mjs` as content-independent position-indexed tokens
   (`<blockId>-h<n>` / `<blockId>-c<n>`) exactly like the opaque scheme. The
   §6 falsifier measures *agent renumbering on regeneration*; because hunk and
   comment IDs are never agent-recalled, that falsifier **structurally does not
   apply** to them. There is no new ID-preservation code path to measure.
4. **The kind-agnostic deny-echo table is reused verbatim.** `renderEchoTable`
   is kind-agnostic; `src/hook/review.mjs` reuses `buildDecision` /
   `buildReviseMessage` / `renderEchoTable` / `startServer` /
   `readStdin`/`extractPlan` byte-for-byte from `prd.mjs`/`exit.mjs`. The v3
   `diff` vocabulary adds zero new ID-minting or ID-preservation code.
5. **The round-trip + agent authoring were already proven live.** The blocking
   round-trip is reused byte-for-byte from `prd.mjs`/`exit.mjs`; Phase 3 adds
   only the review entry path + the deterministic pure
   `src/review/ingest.mjs` parser, both exercised offline by
   `tests/review-roundtrip.test.mjs` + `tests/review-ingest.test.mjs` +
   `tests/harness/review-smoke.mjs`. Spending `claude` to re-measure model
   behaviour Phase 1 already measured would be redundant, not more rigorous.
6. **The only unmeasured residual risk is moot.** ADR-0001's noted follow-up
   (semantic-slug's title-churn weakness was not stressed by the Phase-1
   forced revise) applies ONLY to semantic-slug, which is NOT the production
   default and is not reconsidered in Phase 3; opaque's residual weakness was
   fully exercised and proven absorbed. Irrelevant unless semantic-slug is
   reconsidered (it is not).

Conclusion: re-running the Milestone-1 ID gate in Phase 3 would re-measure an
already-falsified-clear risk against the very scheme chosen to neutralise it,
on code paths reused verbatim, for ID surfaces that are deterministically
ingestion-minted (not agent-recalled) and so structurally outside the §6
falsifier. The waiver is principled and recorded; it is not an omission.

## Consequences

- `src/review/ingest.mjs` is the **new audited leaf**: a PURE zero-import
  unified-diff text→blocks parser. It joins the AC-17-audited transitive set
  as a pure-logic leaf exactly like `src/diff/structural.mjs`; it makes ZERO
  subprocess / network / clock / filesystem calls (the R1 Option A purity
  contract). The `gh`/`git` subprocess that PRODUCES the unified-diff text
  runs in the pre-server CLI agent loop, NEVER in the blocking path.
- **No store boundary**: R2 = ephemeral, so there is NO `src/review/store.mjs`
  and NO filesystem-write boundary to document for the review path at all
  (unlike ADR-0002's `node:fs` store note). `src/hook/review.mjs` reads stdin
  + serves loopback only; the review result is the returned structured
  envelope only — nothing is persisted.
- AC-17 is **RE-ASSERTED, not weakened**, for the new `bin/planos review`
  entrypoint: `tests/harness/import-graph.mjs ac17Roots()` now lists
  `src/hook/review.mjs` + `src/review/ingest.mjs` explicitly (the dispatcher
  already reaches `review.mjs` via the same provable
  `resolve(__dirname,'<lit>')` unwrap as `exit.mjs`/`prd.mjs`; the explicit
  roots make the re-assertion dispatcher-independent — VERBATIM the Phase-2 P5
  reasoning), with **NO store root** (R2 ephemeral). The walk stays VERDICT
  CLEAN. `tests/ac17-invariant.test.mjs` adds **LAYER 2c** — a runtime
  no-egress/no-spawn test mirroring LAYER 2b EXACTLY, driving `handleReview`
  via the scripted seam (no tmpdir root — R2 ephemeral), asserting ZERO
  non-loopback egress, ZERO agent/process spawn, **and that `gh`/`git` are
  absent from the blocking transitive set** (the R1 crux) — plus the extended
  LAYER 1b static module-set assertion.
- Phase 1 and Phase 2 are **NOT regressed**: the FROZEN Phase-1 exit gate
  `tests/harness/verify-exit-gate.mjs` exits 0 (FROZEN_BARS /
  `tests/harness/metrics.mjs` untouched), all `exit-*.test.mjs` stay green,
  and the Phase-2 `prd-*` suites + `tests/harness/prd-smoke.mjs` stay green.
- The Phase-3 exit gate is the §6 16-AC-R set + AC-R-WAIVER + the offline
  suite green + `tsc --noEmit` clean + the AC-17 import-graph CLEAN
  **including the new review roots** + the deterministic
  `tests/harness/review-smoke.mjs` envelope-shape proof. There is **NO new
  frozen numeric bar** and **NO Milestone-1-style live ID re-measurement**
  (the D6 lighter-but-rigorous precedent, AC-R-WAIVER above).
- The **live-session smoke** (`/planos-review <PR#>` and `/planos-review <git
  range>` run end-to-end via `claude --plugin-dir ./plugin`, per-hunk
  accept/reject/comment, approve → confirm the structured review envelope
  reaches the agent) is **`[M]` manual/interactive-only**: the
  PermissionRequest / interactive command surfaces do not fire under
  `claude -p`, exactly as Phase 1's and Phase 2's live-session smokes were
  documented as manual `[M]`. It is the documented manual smoke; it is NOT
  run by the offline gate and does NOT spend `claude` in CI.
- Follow-up (unchanged from ADR-0001/0002, out of Phase-3 scope): if
  semantic-slug is ever reconsidered, re-measure it under a title/path-churning
  forced revise — the gate Phase 1 intentionally did not stress. Not triggered
  by Phase 3. Plannotator hook-collision coexistence remains Phase 4
  (detect-and-refuse posture unchanged).
