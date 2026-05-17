# ADR 0007 — Consolidate planos to a single flow: PRD-only

- Status: **ACCEPTED** — planos is reduced to ONE flow: **PRD**. The plan flow
  (the `ExitPlanMode` PermissionRequest roundtrip + the `EnterPlanMode`
  PreToolUse schema injection) and the diff-review flow are **removed**. The
  PRD is invoked by the `/planos-prd` command running `planos prd` via the CLI
  over stdin — NOT via a Claude Code hook. There are no hooks at all
  (`plugin/hooks/hooks.json` deleted).
- Date: 2026-05-17
- Deciders: user sign-off (deliberate, user-approved destructive refactor —
  Milestone M1).
- Supersedes (in part): ADR-0003 (diff-review — the `diff` kind, the
  `diff-review` document type, `gh`/`git` ingestion, per-hunk review) is
  withdrawn. ADR-0005 (plans accept v2 rich kinds) is retained only for the
  v2 PRD document — the plan ExitPlanMode loop it described is gone. ADR-0001
  (block-ID scheme), ADR-0002 (PRD persistence), ADR-0004 (offline /
  distribution), ADR-0006 (single-file bin bundle) are unaffected and still
  hold for the PRD path.
- Raw evidence: `tests/ac17-invariant.test.mjs` (LAYER 1 static walk + LAYER 2
  RUNTIME no-egress over the PRD path; `ac17Roots()` updated to the PRD-only
  blocking surface), `tests/harness/import-graph.mjs` VERDICT CLEAN,
  `tests/prd-roundtrip.test.mjs` + `tests/prd-store.test.mjs` (PRD round-trip +
  persistence GREEN), `tests/bin-bundle.test.mjs` (committed `plugin/bin/planos`
  byte-identical to a fresh `build:bin` of the PRD-only dispatcher),
  `tests/packaging*.test.mjs` (self-contained, dispatches `prd|export` only),
  `npm run build:editor` + `npm run build:bin` succeed, full
  `node --test` suite GREEN.

## Context

planos shipped three entry modes — Plan (ExitPlanMode roundtrip), PRD (command
→ blocking CLI), and Diff review (`gh`/`git` → diff blocks). The plan flow's
`ExitPlanMode` PermissionRequest interception proved fragile in practice: it
depends on Claude Code dispatching the hook with a usable `tool_input.plan`
stdin envelope, on no second plugin colliding on the same matcher, and on a
96h blocking server surviving a host that may replace a backgrounded process's
stdin. The diff-review flow added a whole second schema layer (the v3 `diff`
kind, `Hunk`/`DiffLine`/`BlockComment`, per-hunk reanchoring) and a `gh`/`git`
pre-server ingestion surface for a use case that is no longer a goal. The PRD
flow — a plain command that authors a v2 structured document and pipes it to
`planos prd` over stdin — is the robust, hook-free path, and it already carries
the richest block vocabulary and immutable revision persistence.

## Decision

Excise the plan and diff-review flows entirely and keep PRD as the single
flow:

- Delete `src/hook/{enter,exit,review}.mjs`, `src/hook/coexistence.mjs`,
  `src/review/ingest.mjs`, `src/diff/reanchor.mjs`, and the
  `plugin/commands/planos-{plan,review}.md` commands.
- Extract the pure, model-free helpers the PRD round-trip still needs out of
  the deleted `exit.mjs` into a new `src/hook/prd-runtime.mjs`
  (`planToDocument`, the deny/revise decision machinery, the (id,kind,title)
  echo table, `buildSpaHtml`/`buildDegradedHtml`, the documented
  `child_process` browser-opener AC-17 boundary). `src/hook/prd.mjs` imports
  from it — a zero-behaviour-change relocation for the PRD flow.
- Reduce the `bin/planos` dispatcher (`src/bin/planos-entry.mjs`) to `prd` +
  `export`; rebuild the committed single-file bundle.
- Delete `plugin/hooks/hooks.json` (no hooks remain); the plugin manifest
  carries no `hooks` reference, so it stays valid.
- Remove the v3 `diff` kind and the `diff-review` document type from
  `src/schema/validate.mjs` + `src/schema/types.d.ts`; remove the diff-hunk
  editor UI (`DiffView`, `HunkReview`, `reviewVerdicts`) from
  `src/editor/*`. KEEP every v1 core kind, every v2 PRD kind, and the v2
  document type. The `coexistence` guard was used **solely** by the removed
  `handleExit` path (verified: `src/hook/prd.mjs` does not import it), so it is
  removed with the exit flow.
- Update `ac17Roots()` to the PRD-only blocking surface and the
  `ac17-invariant` test to assert AC-17 over `bin/planos prd` (the only
  remaining blocking round-trip).

## Decision Drivers

- The `ExitPlanMode` roundtrip was the single fragile, host-coupled surface;
  the command → stdin PRD path has none of that coupling.
- The diff-review flow is an explicit Non-Goal; carrying its schema + ingestion
  surface is pure complexity with no consumer.
- A single flow is a far smaller, more navigable, more testable surface — and
  every AC-17 / offline / single-file invariant is preserved for PRD.

## Alternatives Considered

1. **Keep all three, just fix the plan flow** — leaves the diff-review schema
   and the hook-collision surface in place; does not reduce the surface.
2. **Keep plan, drop only diff-review** — still carries the fragile
   `ExitPlanMode`/`EnterPlanMode` hooks. Rejected: the user wants the single
   robust path.
3. **Delete `exit.mjs` wholesale without relocating its helpers** — would break
   the kept PRD flow (it imported `planToDocument`/`buildDecision`/
   `buildSpaHtml`/`openBrowserReal` from `exit.mjs`). Rejected in favour of the
   verbatim relocation into `prd-runtime.mjs`.

## AC-17 Safety Argument

The blocking path is now exactly `bin/planos prd` → `src/hook/prd.mjs` →
`src/hook/prd-runtime.mjs` → `src/server/` → `src/schema/` →
`src/diff/structural.mjs` → `src/prd/store.mjs`. `ac17Roots()` was updated to
this exact set; the import-graph walk over it is VERDICT CLEAN (no agent-SDK /
model-client / network-client / unprovable-dynamic edge). The relocated
helpers are byte-identical pure logic plus the SAME documented
`child_process` OS-URL-opener boundary that was already AC-17-allowed in the
deleted `exit.mjs` (filesystem ≠ network/model; the opener is the injectable
seam, no-op in tests). The RUNTIME no-egress assertion now drives `handlePrd`
(the only blocking round-trip) with the lowest-boundary interceptors and
asserts zero non-loopback egress and zero agent/process spawn. The single-file
bundle drift gate (`tests/bin-bundle.test.mjs`) and the no-src packaging gate
still compose the "shipped artifact ≡ audited source" guarantee.

## Consequences

- **Positive:** dramatically smaller, single-flow surface; no fragile
  `ExitPlanMode`/`EnterPlanMode` hook coupling; no `gh`/`git` ingestion or v3
  diff schema to maintain; AC-17 preserved and re-asserted for the only
  blocking path.
- **Neutral:** the deny/revise + SPA-HTML helpers moved verbatim from
  `exit.mjs` to `prd-runtime.mjs`; `envelope.test.mjs` /
  `spa-inline-injection.test.mjs` import from the new module. The deny
  directive wording is now PRD-accurate ("YOUR PRD WAS NOT APPROVED" / "re-emit
  the FULL v2 block document"); tests that asserted the old plan-loop wording
  were adjusted minimally.
- **Removed capability:** there is no longer a plan-mode interception or a
  code-diff review mode. This is intentional and user-approved.
- **Boundary preserved:** offline / zero non-loopback egress / no-CDN /
  single-file bundle invariants (enforced by `ac17-invariant`,
  `spa-inline-injection`, `packaging-no-src`) are intact.
