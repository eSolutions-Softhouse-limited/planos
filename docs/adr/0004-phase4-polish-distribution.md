# ADR 0004 — Phase 4 polish & distribution, the markdown-export AC-17 boundary, the §10 plannotator closure, and the Phase-4 ID waiver

- Status: **ACCEPTED** — themes (light/dark/OS-auto, no localStorage); pure
  `src/export/markdown.mjs` serializer (SPA download + out-of-blocking-path
  `bin/planos export` CLI); PDF via `window.print()` (zero-dep); marketplace
  listing + `version` 1.0.0; AC-17 RE-ASSERTED by **negative proof**
  (`ac17Roots()` UNCHANGED); design.md §10 plannotator row formally CLOSED;
  Bun (Q5) + encrypted share (Q6) DEFERRED with recorded rationale
- Date: 2026-05-16
- Deciders: Phase 4 user sign-off (`.omc/plans/planos-phase4-plan.md`
  "Resolved Decisions (user sign-off 2026-05-16)" — Q1–Q8); Phase 4 /
  Milestone Q5; project memory (*"don't care about plannotator coexistence;
  refuse-on-collision is fine"*)
- Plan: `.omc/plans/planos-phase4-plan.md` §3 (the seven workstreams, §3.5
  the `bin/planos export` CLI, §3.7 the plannotator infeasibility analysis —
  the §10 closure rationale), §4 (the AC-17 negative-proof crux — the export
  modules ABSENT from the blocking closure; `ac17Roots()` UNCHANGED), §5
  (AC-Q1…AC-Q15 + AC-Q-WAIVER), §6 Milestone Q0–Q5, Open Decisions Q1–Q8 +
  their resolutions
- Supersedes: the Open-Decision Q1–Q8 placeholders in the Phase 4 plan; the
  design.md §10 plannotator coexistence "Open — investigate in Phase 1" row;
  the `docs/notes/plannotator-coexistence-spike.md` "RESOLVED for Phase 1"
  framing
- Raw evidence: `tests/export-markdown.test.mjs`, `tests/export-cli.test.mjs`,
  `tests/theme.test.mjs`, `tests/editor-render.test.mjs` (theme + export
  button + print css non-visual), `tests/packaging.test.mjs`,
  `tests/ac17-invariant.test.mjs` (the Q5 negative LAYER 1b + intact LAYER
  2/2b/2c), `tests/harness/import-graph.mjs` (`ac17Roots()` lines 601-631,
  UNCHANGED), `tests/harness/verify-exit-gate.mjs` (FROZEN Phase-1 gate),
  `tests/harness/prd-smoke.mjs`, `tests/harness/review-smoke.mjs`,
  `tests/coexistence.test.mjs` (UNCHANGED — Q7 keep-refuse),
  `docs/notes/markdown-export-boundary.md`,
  `docs/notes/plannotator-coexistence-spike.md`; Phase 1/2/3 live evidence
  reused: `docs/adr/0001-block-id-scheme.md`,
  `docs/adr/0002-prd-persistence.md`, `docs/adr/0003-diff-review.md`,
  `.omc/research/live-opaque.json`, `.omc/research/phase1-exit-gate.json`

## Context

Phase 4 is the **FINAL phase**: polish & distribution. Phase 1 proved the
structured-artifact loop and falsified-clear the §6 block-ID risk (`opaque`
is the production default, ADR-0001 ACCEPTED). Phase 2 added PRD mode +
persisted revision history and re-asserted AC-17 for the new `bin/planos prd`
entrypoint (ADR-0002 ACCEPTED). Phase 3 added the third and final entry mode —
diff-review (`bin/planos review`, v3 `diff` kind, ephemeral) — and re-asserted
AC-17 for `bin/planos review` (ADR-0003 ACCEPTED). **All three design.md §3
entry modes ship.** Phase 4 adds **NO new entry mode and NO new blocking-path
engine work** — it delivers exactly what design.md §9 scopes for Phase 4:
themes, markdown/PDF export, optional Bun single-binary, optional encrypted
local share, marketplace listing, and the DEFERRED full plannotator
hook-collision coexistence resolution (today: detect-and-refuse,
`src/hook/coexistence.mjs`).

Several Phase-4 workstreams are explicitly "optional" in design.md, and the
user had already descoped caring about plannotator coexistence through Phase 3
(project memory: *"don't care about plannotator coexistence; refuse-on-collision
is fine"*). The headline decision (Q1) was therefore **which workstreams are
IN vs. deferred**, plus seven further design questions (Q2–Q8) surfaced as Open
Decisions requiring human sign-off before execution. This ADR records the
signed-off resolutions, the AC-Q-WAIVER reasoned waiver, the AC-17
negative-proof re-assertion, and the formal closure of the design.md §10
plannotator coexistence row.

The single architectural constant across all four phases — AC-17 (*no model
call / network egress / agent spawn inside the blocking server round-trip*) —
recurs here and is answered the same way, by a **negative proof**: Phase 4's
surfaces are SPA-side or pre/post-server CLI surfaces, structurally OUTSIDE the
blocking path, and proven so.

## Decision

### Q1 — the Phase-4 scope cut (the headline) → **minimal set**

**IN:** themes (light/dark/OS-auto toggle); markdown export — pure serializer
consumed SPA-side **and** via an out-of-blocking-path `bin/planos export` CLI;
PDF via `window.print()`; marketplace listing hardening + `version` 1.0.0;
**formally CLOSE the design.md §10 plannotator coexistence row**.

**DEFERRED with recorded rationale:** Bun single-binary (Q5), encrypted local
share (Q6), graceful plannotator coexistence (Q7 → keep detect-and-refuse).

Rationale: the IN set is exactly the non-optional design.md §9 Phase-4 scope
plus the cheap, fully-precedented export-CLI surface; the DEFERRED set is the
three explicitly-optional / explicitly-unwanted items. This is the smallest
correct surface that ships all three §3 entry modes at 1.0.0 with the design
COMPLETE. The deferred workstreams' milestones are struck (recorded here),
exactly as Phase 3 struck the R2-driven store work units (ADR-0003 R2).

### Q2 — theme scope → **light + dark + toggle + OS-auto, NO localStorage**

`src/editor/theme.ts` (SPA-only) exports a closed token set; `THEMES.light`
reproduces the EXACT pre-Phase-4 hex values for every tokenized surface (so the
default render is byte-identical to Phase 3); `THEMES.dark` is a distinct
palette; `preferredTheme()` reads `window.matchMedia('(prefers-color-scheme:
dark)')` with a `light` fallback. There is **NO `localStorage`** persistence
(out of Q2 scope — a deliberate minimal cut). `App.tsx`/`blocks.tsx`/
`markdown.tsx`/`mermaid.tsx` carry no remaining hard-coded tokenized hex; all
route through `theme.*`. `src/editor/theme.ts` is **SPA-side only** — NEVER
imported by `src/hook/*` or `bin/planos`; it is bundled into
`plugin/dist/index.html` exactly like the offline mermaid renderer (ADR-0002
D3) and is absent from the AC-17 audited closure entirely.

### Q3 — markdown-export boundary & surfaces → **pure serializer, SPA download + out-of-blocking-path CLI, negative AC-17 proof**

`src/export/markdown.mjs` is a **PURE `(doc) → string` serializer**: ZERO
imports (not even a `node:` builtin), total over all 14 v1∪v2∪v3 kinds,
deterministic (byte-stable: same input → byte-identical output), and never
throws (unknown kind → fenced JSON). This is the EXACT purity posture of
`src/review/ingest.mjs` (Phase 3). It is consumed (a) SPA-side (the
"Download .md" client-side `Blob` path — zero network) and (b) by the
**out-of-blocking-path** `bin/planos export` CLI (`src/hook/export.mjs`:
reuses `readStdin`/`extractPlan` from `roundtrip.mjs`, calls
`serializeMarkdown`, writes stdout, exits 0 — boots **NO server**, imports
**NO** `src/server/`, opens **NO** round-trip, **NEVER blocks**, imports **NO**
blocking handler).

The crux assertion (AC-Q12) is a **NEGATIVE proof** — the Phase-4 analogue of
Phase 3 R1 Option A: prove `src/export/markdown.mjs` + `src/hook/export.mjs`
(and the SPA-only `src/editor/theme.ts` + `src/editor/export.tsx`) are
**ABSENT from the transitive import closure of the blocking handlers
`bin/planos exit|prd|review`**. This is *stronger* than adding them as audited
roots (the way Phase 2 added prd + Phase 3 added review modules): instead of
proving "export, if run, is model-free", it proves "no blocking handler can
even reach export — the export feature cannot run during a blocking
round-trip". The blocking path stays **byte-for-byte as in Phase 3**, with **no
new allowed-boundary carve-out**.

The rejected alternative (the Position-B analogue): putting markdown
serialization *inside* a blocking handler's success path is rejected for the
same reason Phase 3 rejected blocking-path `gh` — it needlessly expands the
audited surface for a feature that has zero reason to run while the user is
blocked in a 96h round-trip. Export is something done to a document that
already exists, before or after the blocking decision, never during it.

`ac17Roots()` in `tests/harness/import-graph.mjs` is **UNCHANGED** — the
export modules are deliberately NOT added as blocking roots (they are not
`bin/planos exit|prd|review` roots and are never imported by one; adding them
would *weaken* the re-assertion). `node tests/harness/import-graph.mjs` stays
**VERDICT CLEAN** over the full UNCHANGED root set: the `plugin/bin/planos`
dispatcher reaching `src/hook/export.mjs` via its `case 'export'` (the SAME
provable `resolve(__dirname,'<lit>')` unwrap it uses for exit/prd/review) is a
clean static edge — the dispatcher routing the non-blocking `export`
subcommand is expected and fine; the negative proof is over the blocking
HANDLER roots (`ac17Roots()` MINUS the dispatcher), not over the shared
multi-subcommand dispatcher. See `docs/notes/markdown-export-boundary.md`.

### Q4 — PDF mechanism → **`window.print()` (zero dependency)**

The SPA "Print / Save as PDF" button calls `window.print()` against an inlined
`@media print` stylesheet that hides all interactive chrome (header controls,
history browser, global comment box, decision bar — everything marked
`[data-planos-screen-only]`) and lays the document out for paper. There is
**NO Node-side PDF library and NO new `package.json` dependency**
(`dependencies` stays empty/absent). `window.print()` is a browser API — zero
Node-side surface, zero AC-17 impact.

### Q5 — Bun single-binary → **DEFERRED (recorded rationale)**

A Bun `--compile` single binary is **DEFERRED**, not built. design.md §8 makes
it explicitly optional ("Revisit Bun in Phase 4 *if a single binary is
wanted*"); the committed Node `bin/planos` script + committed
`plugin/dist/index.html` are the zero-build default install path and fully
satisfy the distribution requirement. A Bun binary would be a build/release
artifact only — it does not change the runtime blocking path, the AC-17 graph,
or any handler — so it is pure additive packaging with no architectural
content and no user demand expressed. Deferring it removes a toolchain
dependency (Bun) from the critical path for zero functional loss. Re-openable
post-1.0.0 if a single-binary distribution is ever wanted; nothing in the
codebase precludes it.

### Q6 — encrypted local share → **DEFERRED (recorded rationale)**

The optional encrypted local share is **DEFERRED**, not built. design.md §1
keeps "no hosted service / cloud / upload / share links" as a v1 non-goal;
design.md §9 lists encrypted *local* share as explicitly "optional". It would
be a SPA-side WebCrypto (`crypto.subtle`) local-file-only surface with zero
network by construction — but it is an additive convenience the user did not
request and that adds a non-trivial crypto correctness/security surface for no
expressed need. Deferring it keeps the 1.0.0 surface minimal and correct. If
ever built it MUST remain local-file-only (the design.md §1 "no upload"
non-goal is permanent — there is to be no fetch/upload code path); that
constraint is recorded here so a future implementer inherits it.

### Q7 — plannotator coexistence → **KEEP detect-and-refuse; formally CLOSE design.md §10**

Graceful plannotator coexistence is **NOT built**. The Phase-1 coexistence
spike established the hard Claude Code multi-plugin dispatch facts: all
matching `ExitPlanMode` `PermissionRequest` hooks fire **in parallel** (no
first-wins, no priority, no namespacing), reconciliation is a **deny-wins
conjunction**, and `PermissionRequest` does **not** fire under `claude -p` (so
the collision cannot even be observed headlessly). "Full coexistence
resolution" — two plugins each wanting to own a blocking 96h `ExitPlanMode`
round-trip cooperating instead of double-booting two servers/browsers — would
require **cross-plugin coordination Claude Code provides no primitive for**:
no leader election, no shared lock channel, no defined ordering. The only
available mechanisms are the one already used (pure local-fs sibling
detection) plus speculative, fragile inter-process coordination (a lockfile
race between two independently-spawned hook processes with no defined ordering
— itself a new correctness/security surface in a shared directory).
**Graceful coexistence is arguably infeasible without a Claude Code
cross-plugin coordination primitive that does not exist, and the user has
explicitly stated they do not want it.**

Therefore: **keep the detect-and-refuse posture verbatim** and formally close
the lingering design.md §10 "Open" row. Concretely:

- `src/hook/coexistence.mjs` and `tests/coexistence.test.mjs` (7 tests) are
  **UNCHANGED** (Q7 = keep-refuse — no code change). The escape hatch
  `PLANOS_ALLOW_COEXIST=1` is unchanged. The guard scans siblings of
  `CLAUDE_PLUGIN_ROOT` for any other plugin declaring a `PermissionRequest`
  `ExitPlanMode` matcher on the production path only; on positive detection it
  refuses without booting the server or emitting a stdout decision. It is pure
  local-fs (the AC-17 import-graph stays CLEAN) and defensive (any error → "no
  collision", never spuriously blocks a clean env). It guards ONLY the
  `ExitPlanMode` `PermissionRequest` hook; the `prd`/`review`/`export` command
  paths never touch it.
- The **design.md §10 plannotator coexistence row** is updated from
  *"Open — investigate Claude Code multi-plugin hook behavior in Phase 1"* to
  the final closed disposition: *"Resolved — refuse-on-collision is the
  accepted permanent posture; full coexistence is infeasible without a Claude
  Code cross-plugin coordination primitive that does not exist, and is
  explicitly out of scope (user-descoped); ADR-0004."*
- `docs/notes/plannotator-coexistence-spike.md` status line is updated from
  *"RESOLVED for Phase 1 (descoped to refuse-on-collision …)"* to
  *"RESOLVED — final (Phase 4): refuse-on-collision is the permanent posture"*
  with a short closure paragraph referencing this ADR. The dispatch findings
  are unchanged (they remain the authoritative documented semantics).

The alternative (Q7 = build a best-effort cooperative posture, e.g. a
`PLANOS_COEXIST_PRIORITY` ordering + a local advisory lock) is high
complexity, fragile (no CC ordering guarantee), security-adjacent (lockfile in
a shared dir), and explicitly unwanted by the user. NOT recommended; NOT used.
This converts a lingering "Open" into a principled, recorded closed decision —
the genuine Phase-4 deliverable for this item.

### Q8 — final `version` + gating rigor → **`version` 1.0.0, D6 lighter-but-rigorous gate**

`plugin/.claude-plugin/plugin.json` and `package.json` are bumped to
**`1.0.0`** (final phase — all three design.md §3 entry modes ship; the design
is COMPLETE). `package.json` adds no `dependencies` key (the
zero-runtime-dep invariant is intact — the diff is exactly the version line).
`.claude-plugin/marketplace.json` + `plugin/.claude-plugin/plugin.json` carry
only schema-supported metadata fields (verified against current Claude Code
plugin/marketplace docs; a packaging-validity test enforces no invented
fields). The Phase-4 exit gate is the §5 active-AC set + full offline suite
green + `tsc --noEmit` clean + AC-17 import-graph VERDICT CLEAN (UNCHANGED
`ac17Roots()` + the AC-Q12 negative assertion) + the FROZEN Phase-1 gate +
Phase-2 `prd-smoke` + Phase-3 `review-smoke` all green, with **NO new frozen
numeric bar** and **NO Milestone-1-style live ID re-measurement** (the D6
lighter-but-rigorous precedent, AC-Q-WAIVER below). This mirrors the Phase-3
D6 confirmation verbatim.

## AC-Q-WAIVER — No-Phase-4-ID-re-measurement (reasoned waiver, NOT an omission)

Phase 4 does **NOT** re-run the Milestone-1 ID-stability gate, and this is a
documented, reasoned waiver — recorded identically to ADR-0002's AC-P18 and
ADR-0003's AC-R-WAIVER:

1. **Phase 4 introduces ZERO new ID-minting surface.** Themes, markdown
   export (SPA + CLI), PDF-via-print, marketplace listing, and the §10
   coexistence closure all *read* existing already-validated documents and
   **never mint or preserve an ID**. There is no new ID-preservation code path
   to measure — no Phase-4 surface touches block-ID, hunk-ID, or comment-ID
   generation at all.
2. **`opaque` was chosen *for* exactly this kind of read-only churn, and the
   §6 falsifier already passed at 1.000.** ADR-0001's tie-break rationale
   (rename/growth stability) and its 6/6 live runs per scheme at 1.000
   ID-preservation make the make-or-break risk falsified-clear; `opaque` is
   the proven production default. Phase 4 does not even read IDs in a way that
   could induce drift — it serializes a document as-is.
3. **The round-trip + agent authoring are reused byte-for-byte and
   untouched.** `src/hook/{exit,prd,review}.mjs`, `src/hook/roundtrip.mjs`,
   `src/schema/*`, `src/diff/*`, `src/prd/store.mjs`, `src/review/ingest.mjs`,
   `src/schema/envelope.mjs` are all byte-unchanged in Phase 4. The export
   serializer is a new *pure read-only consumer*, not a new authoring or
   ID-minting path. Re-measuring model behaviour Phase 1 already measured, on
   code paths Phase 4 does not touch, would be redundant, not more rigorous.
4. **No new frozen numeric bar.** Consistent with the Phase-3 D6
   lighter-but-rigorous precedent: Phase 4 adds no new frozen numeric bar; the
   `FROZEN_BARS` / `tests/harness/metrics.mjs` are untouched and the FROZEN
   Phase-1 exit gate still exits 0.

Conclusion: re-running the Milestone-1 ID gate in Phase 4 would re-measure an
already-falsified-clear risk against the very scheme chosen to neutralise it,
on code paths reused verbatim, for a phase that introduces zero new
ID-minting/ID-preservation surface. The waiver is principled and recorded; it
is not an omission.

## Consequences

- **AC-17 is RE-ASSERTED by a NEGATIVE proof, never weakened.** The Q5
  extension to `tests/ac17-invariant.test.mjs` LAYER 1b computes the closure
  of the blocking-handler roots (`ac17Roots()` MINUS the `plugin/bin/planos`
  dispatcher) and asserts `src/export/markdown.mjs` + `src/hook/export.mjs`
  (and the SPA-only `src/editor/theme.ts` + `src/editor/export.tsx`) are
  **ABSENT** from it — the export feature provably cannot run during a
  blocking round-trip. It also asserts `ac17Roots()` is byte-exactly the
  Phase-1/2/3 root set (no export/theme root silently added) and that the
  blocking-handler closure is non-vacuous (still contains exit/prd/review +
  server + schema + diff + ingest — a real reachability walk). The existing
  positive LAYER 1b (full `ac17Roots()`, dispatcher included) stays VERDICT
  CLEAN, and LAYER 2/2b/2c runtime no-egress/no-spawn tests are intact and
  green. This mirrors EXACTLY how Phase 3 R1 proved `gh`/`git` absent from the
  blocking transitive set, applied to a post-server CLI + SPA-side surface.
- **`ac17Roots()` is UNCHANGED.** No new blocking root; no new
  allowed-boundary carve-out. `tests/harness/import-graph.mjs` (lines 601-631)
  is byte-unchanged. The export modules are provably OUTSIDE the blocking
  closure — stronger than an audited-root inclusion.
- **The export modules are out-of-blocking-path by construction.**
  `src/export/markdown.mjs` is PURE zero-import; `src/hook/export.mjs` boots
  no server, imports no blocking handler, never blocks; the
  `plugin/bin/planos` dispatcher routing the `export` subcommand is a clean
  static edge (no agent-SDK/unprovable-dynamic import — walk stays CLEAN).
  Documented in `docs/notes/markdown-export-boundary.md` (mirrors
  `docs/notes/planos-review-command.md`).
- **Phases 1 + 2 + 3 are NOT regressed.** The FROZEN Phase-1 exit gate
  `tests/harness/verify-exit-gate.mjs` exits 0 (FROZEN_BARS /
  `tests/harness/metrics.mjs` untouched), all `exit-*.test.mjs` stay green,
  `tests/harness/prd-smoke.mjs` PASS (Phase-2), `tests/harness/review-smoke.mjs`
  PASS (Phase-3), and the full offline suite is green. No blocking handler,
  schema, diff, server, store, ingest, envelope, or `plugin/hooks/hooks.json`
  is changed.
- **`src/hook/coexistence.mjs` and `tests/coexistence.test.mjs` are
  UNCHANGED** (Q7 = keep-refuse). The design.md §10 plannotator coexistence
  row is formally CLOSED (Resolved — refuse-on-collision is the accepted
  permanent posture; full coexistence infeasible without a CC cross-plugin
  coordination primitive; user-descoped), and
  `docs/notes/plannotator-coexistence-spike.md` is updated to
  "RESOLVED — final (Phase 4)".
- **The live-session smoke is `[M]` manual/interactive-only.** The
  end-to-end real `claude --plugin-dir ./plugin` round-trip with theme toggle
  + markdown download + print-to-PDF in the interactive SPA is documented as
  `[M]` manual (the SPA/interactive surfaces do not fire under `claude -p`,
  exactly as Phase 1's, Phase 2's, and Phase 3's live-session smokes were
  documented as manual `[M]`). It is the documented manual smoke; it is NOT
  run by the offline gate and does NOT spend `claude` in CI. The non-visual
  click→Blob path, zero-network export-path scan, and `@media print`
  chrome-hiding are harness-asserted offline in `tests/editor-render.test.mjs`.
- **planos v1.0.0 ships all three design.md §3 entry modes.** Plan mode
  (`bin/planos exit`, Phase 1), PRD mode (`bin/planos prd`, Phase 2), and
  diff-review mode (`bin/planos review`, Phase 3) all ship, plus the
  out-of-blocking-path `bin/planos export` polish surface and themes/PDF.
  **The design is COMPLETE; all four phases are done.**
- The Phase-4 exit gate is the §5 active-AC set + AC-Q-WAIVER + the offline
  suite green + `tsc --noEmit` clean + the AC-17 import-graph CLEAN
  (UNCHANGED `ac17Roots()` + the AC-Q12 negative assertion) + the FROZEN
  Phase-1 gate + Phase-2 `prd-smoke` + Phase-3 `review-smoke` all green. There
  is **NO new frozen numeric bar** and **NO Milestone-1-style live ID
  re-measurement** (the D6 lighter-but-rigorous precedent, AC-Q-WAIVER).
- Deferred (recorded, out of 1.0.0 scope): the Bun single-binary (Q5) and the
  encrypted local share (Q6) — re-openable post-1.0.0; nothing precludes
  them; the §1 "no upload / local-file-only" constraint on any future share is
  permanent. Graceful plannotator coexistence (Q7) is closed as
  infeasible-without-a-CC-primitive and explicitly unwanted — not a deferral
  but a principled permanent decision.
