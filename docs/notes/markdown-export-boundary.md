# Markdown Export — Out-of-Blocking-Path / AC-17 Boundary Note

**Phase 4 / Milestone Q5, Step Q5.2**  
**Related:** `src/export/markdown.mjs`, `src/hook/export.mjs`, `plugin/bin/planos` (`export` case), `src/editor/export.tsx`, `docs/design.md §9`, `docs/design.md §10`, phase4 plan §3.2 (the export surfaces), §3.5 (`bin/planos export` out-of-blocking-path CLI), §4 (the AC-17 boundary analysis — THE Phase-4 crux), §6 (AC-Q4, AC-Q5, AC-Q6, AC-Q12), §10 Q3 (markdown-export boundary, Resolved), Resolved Decision Q3 (pure serializer, SPA-download + out-of-blocking-path CLI, NEVER imported by a blocking handler). Parallel to: `docs/notes/planos-review-command.md` (the Phase-3-R1 doctrine this mirrors).

---

## What the export surfaces are

Phase 4 adds a markdown-export feature with **two consumption surfaces and zero
blocking-path surface**:

1. **`src/export/markdown.mjs`** — a PURE `(doc) → string` serializer. It
   imports **NOTHING** (not even a `node:` builtin), makes zero subprocess /
   network / clock / filesystem calls. It is total over all 14 v1∪v2∪v3 block
   kinds, deterministic (same input → byte-identical output), and never throws
   (an unknown kind degrades to a fenced JSON block). This is the EXACT purity
   posture of `src/review/ingest.mjs` (the Phase-3 pure unified-diff parser).
2. **SPA-side download (`src/editor/export.tsx`)** — a browser-side
   "Download .md" button that calls `serializeMarkdown` in-page and produces a
   client-side `Blob` download, plus a "Print / Save as PDF" button that calls
   `window.print()` against an inlined `@media print` stylesheet. This is
   browser TSX bundled into the committed single-file
   `plugin/dist/index.html` — it never executes Node-side, exactly like the
   bundled offline mermaid renderer (ADR-0002 D3).
3. **`bin/planos export` (`src/hook/export.mjs`)** — an out-of-blocking-path
   CLI subcommand. It reuses `readStdin`/`extractPlan` from
   `src/hook/roundtrip.mjs` byte-for-byte, calls
   `serializeMarkdown` from `src/export/markdown.mjs`, writes the markdown to
   stdout, and exits 0. It boots **NO server** (it does NOT import
   `src/server/` and never calls `startServer`), opens **NO decision
   round-trip**, **NEVER blocks**, and imports **NO blocking handler**
   (`src/hook/{exit,prd,review}.mjs`). Its ONLY imports are `./roundtrip.mjs`
   and `../export/markdown.mjs`.

---

## The markdown-export vs AC-17 boundary — THE crux of Phase 4 (Q3, the Phase-3-R1 analogue)

### The invariant (from consensus plan AC-17, RE-ASSERTED for Phase 4 by a NEGATIVE proof)

> **No model call / network egress / agent spawn inside the blocking
> `bin/planos exit|prd|review` path.**

The blocking path is: `bin/planos {exit|prd|review}` → `src/hook/{exit,prd,review}.mjs`
→ `src/server/` → `src/schema/` → `src/diff/` (→ `src/prd/store.mjs` for prd,
→ `src/review/ingest.mjs` for review) → stdout flush → `exit(0)`. This path
must contain zero network egress, zero agent invocation, zero agent-SDK
imports, and zero subprocess spawn (except the existing documented
browser-opener — ADR-0002, filesystem/OS-opener ≠ network/model) in its
transitive module graph.

### Phase 4's posture: the export feature is structurally OUTSIDE the blocking path

Phase 4 adds **NO new entry mode and NO new blocking-path engine work**. The
markdown serializer has **zero reason to run while the user is blocked** in a
96h round-trip — export is something the agent or the user does to a document
that already exists, *before or after* the blocking decision, never *during*
it. Placing serialization inside a blocking handler's success path would be
the Phase-4 equivalent of Phase-3's rejected "Position B" (the blocking path
itself shelling out to `gh`): it needlessly expands the audited surface for a
feature that has no business running mid-block. It is rejected for exactly
that reason.

So the export surfaces are, by construction:

- `src/export/markdown.mjs` — PURE, consumed (a) SPA-side and (b) by
  `bin/planos export`. **Never imported by a blocking handler.**
- `src/hook/export.mjs` — the out-of-blocking-path CLI. Boots no server,
  imports no blocking handler, never blocks. A sibling CLI surface exactly
  like the **pre-server `gh`/`git` agent tool use** of Phase 3 R1 Option A —
  legitimate, strictly outside the blocking path. The only structural
  difference vs the Phase-3 pre-server surface is that export is a *post*-server
  CLI surface rather than a *pre*-server one; the doctrine is identical
  (out-of-blocking-path CLI is out of AC-17 scope).
- `src/editor/{export.tsx,theme.ts}` — SPA-only browser modules, bundled into
  `plugin/dist/index.html`, never executed Node-side.

```
            ┌─ OUT-OF-BLOCKING-PATH (AC-17-irrelevant by construction) ─┐
            │                                                            │
SPA "Download .md" / "Print"  →  serializeMarkdown (pure, in-browser)    │  no server
            │                                                            │  no block
bin/planos export  →  src/hook/export.mjs  →  serializeMarkdown          │  no round-trip
            │           (reads stdin/arg, writes stdout, exit 0)         │  no egress
            └────────────────────────────────────────────────────────────┘
            ┌─ BLOCKING PATH (the AC-17-audited closure — UNCHANGED) ─────┐
            │                                                             │
bin/planos {exit|prd|review} → src/hook/{exit,prd,review}.mjs →           │  NO export
  src/server/ → src/schema/ → src/diff/ (→ store / ingest)                │  module here
            │            ↓                                                │  (proven by
  browser opens; user decides; decision JSON → stdout; exit(0)            │   AC-Q12)
            └─────────────────────────────────────────────────────────────┘
```

`plugin/bin/planos` is a single multi-subcommand **dispatcher**: it has a
`case 'export'` that reaches `src/hook/export.mjs` via the SAME provable
`import(resolve(__dirname, '<literal>'))` unwrap it uses for the `exit` / `prd`
/ `review` cases. The dispatcher routing the `export` subcommand is **expected
and fine** — it is the router doing its job, not a blocking handler reaching
export. The crux is the stronger property: **no BLOCKING HANDLER (`exit` /
`prd` / `review`) can reach the export modules**, even though the shared
dispatcher (which also routes the non-blocking `export` subcommand) trivially
can.

### Why a NEGATIVE proof is stronger than an audited-root inclusion

Phase 2 added the prd modules and Phase 3 added the review modules to the
AC-17-audited blocking closure (`ac17Roots()` gained `src/hook/prd.mjs` /
`src/hook/review.mjs` + their transitive sets), proving "the new blocking
entrypoint is *also* model-free". Phase 4 does the **opposite and stronger**
thing: it proves the export modules are **ABSENT from the blocking closure
entirely** — no blocking handler can even reach them. This is *stronger* than
adding them as audited roots:

- An audited-root inclusion proves "export, if run, is model-free".
- The negative proof proves "export **cannot run** during a blocking
  round-trip at all" — the blocking path is byte-for-byte as in Phase 3 AND
  provably cannot reach export.

This RE-ASSERTS AC-17 by proving the polish surface is strictly outside it —
exactly mirroring how Phase 3 R1 proved `gh`/`git` absent from the blocking
transitive set (`docs/notes/planos-review-command.md`), now applied to a
post-server CLI surface + a SPA-side serializer instead of a pre-server one.

### `ac17Roots()` is UNCHANGED

`tests/harness/import-graph.mjs` `ac17Roots()` is **NOT** extended for Phase 4.
The export modules are deliberately **NOT** added as blocking roots — they are
not `bin/planos exit|prd|review` roots and are never imported by one. Adding
them would *weaken* the re-assertion (turn the strong negative proof into a
weaker audited-root inclusion). `ac17Roots()` stays exactly the Phase-1
(`exit`) + Phase-2 (`prd` + `roundtrip` + `prd/store`) + Phase-3 (`review` +
`review/ingest`) + dispatcher + schema + diff root set. `node
tests/harness/import-graph.mjs` stays **VERDICT CLEAN** (the dispatcher
reaching `export` via the provable-literal unwrap is a clean static edge — no
agent-SDK / model-client / unprovable-dynamic import is introduced).

### What is forbidden

Any model invocation, network egress, agent spawn, or markdown/PDF
serialization reachable from:

- `bin/planos exit` (the `ExitPlanMode` blocking entrypoint)
- `bin/planos prd` (the PRD blocking entrypoint)
- `bin/planos review` (the diff-review blocking entrypoint)
- `src/hook/{exit,prd,review}.mjs` and all modules they import
- `src/server/` (blocking server), `src/schema/`, `src/diff/`,
  `src/prd/store.mjs`, `src/review/ingest.mjs`

Specifically: `src/export/markdown.mjs` and `src/hook/export.mjs` must be
**absent from the transitive import closure of the blocking handlers**.

This is RE-ASSERTED by the extended AC-17 static layer (Milestone Q5 / AC-Q12):

1. **Negative static assertion (LAYER 1b — Q5):** `tests/ac17-invariant.test.mjs`
   computes the closure of the blocking-handler roots (`ac17Roots()` MINUS the
   `plugin/bin/planos` dispatcher) and asserts `src/export/markdown.mjs` +
   `src/hook/export.mjs` (and the SPA-only `src/editor/theme.ts` +
   `src/editor/export.tsx`) are **ABSENT** from it. It also asserts
   `ac17Roots()` is byte-exactly the Phase-1/2/3 root set (no export/theme
   root silently added) and that the blocking-handler closure is non-vacuous
   (still contains exit/prd/review + server + schema + diff + ingest — a real
   reachability walk, not an empty set).
2. **Positive static assertion (LAYER 1b — unchanged):** the existing
   `walkImportGraph(ac17Roots())` over the full UNCHANGED root set (dispatcher
   included) stays VERDICT CLEAN.
3. **Runtime assertions (LAYER 2 / 2b / 2c — unchanged, intact):** the
   `handleExit` / `handlePrd` / `handleReview` no-egress/no-spawn runtime
   tests are untouched and still green — the blocking path is byte-for-byte as
   in Phase 3.

### Purity of `src/export/markdown.mjs` (independent of the negative proof)

`src/export/markdown.mjs` is a **pure document→string serializer**: it imports
nothing (not even a `node:` builtin), makes zero subprocess calls (zero
`node:child_process`), zero network egress, zero clock/filesystem access. Its
purity is asserted independently by `tests/export-markdown.test.mjs`
(comment-stripped static-purity scan, mirroring the `src/review/ingest.mjs`
purity test). The negative proof above is the *separate, stronger* AC-17
property: even though the serializer is pure, it is additionally proven
**unreachable from the blocking path** so it cannot run mid-block at all.

### Self-containment / zero-dep requirement

The export feature adds **zero runtime dependency**. PDF is `window.print()`
(a browser API — zero Node-side surface, zero new `package.json` dependency).
The serializer is hand-rolled with no library. `package.json.dependencies`
stays empty/absent — the zero-runtime-dep-in-blocking-path invariant
(ADR-0000/0002/0003) is intact and, for the export path, irrelevant by
construction (export is out of the blocking path entirely).

---

## Manual smoke test (AC-Q3 / AC-Q7 / AC-Q8 — `[M]` criteria)

AC-Q3 (theme visual), AC-Q7 (SPA "Download .md"), and AC-Q8 (SPA "Print /
Save as PDF") have a **live-session** dimension that is `[M]`
manual/interactive-only — the SPA/interactive surfaces do not fire under
`claude -p`, exactly as Phase 1's, Phase 2's, and Phase 3's live-session
smokes were documented as manual `[M]`. The non-visual click→Blob path,
zero-network export-path scan, and `@media print` chrome-hiding are
harness-asserted offline in `tests/editor-render.test.mjs`; the visual
round-trip is the documented manual smoke. Run in a real Claude Code session
with the plugin installed (`claude --plugin-dir ./plugin`):

### Scenario A — theme toggle (AC-Q3)

1. Drive any entry mode (`/planos-plan`, `/planos-prd`, or `/planos-review`)
   to the point the SPA opens in the browser.
2. Verify the SPA renders under `light` (default — visually identical to
   Phase 3) and that the OS `prefers-color-scheme: dark` default is honoured.
3. Toggle the theme; verify every tokenized surface (blocks, markdown,
   mermaid, badges, shells, decision/comment affordances) re-styles, with no
   hard-coded color leaking through.

### Scenario B — markdown download (AC-Q7)

1. With the SPA open, click **Download .md**.
2. Verify a `.md` file downloads client-side (no network request — observable
   in DevTools Network: zero requests), and that its content is the
   `serializeMarkdown` output for the current document (all kinds rendered).

### Scenario C — print / save as PDF (AC-Q8)

1. With the SPA open, click **Print / Save as PDF** (or the OS print
   shortcut).
2. Verify the print preview hides all interactive chrome (header controls,
   history browser, global comment box, decision bar — everything marked
   `[data-planos-screen-only]`) and lays the document out for paper.
3. Save as PDF; verify the document content is present and readable.

**Pass criteria:** light default visually identical to Phase 3; theme toggle
re-styles every surface; Download .md produces correct markdown with zero
network; Print hides interactive chrome and produces a clean PDF; no crash; no
new runtime dependency.

---

## Why export uses a `bin/planos` subcommand instead of a hook

Export is not plan mode — there is no `ExitPlanMode` tool call to intercept,
and nothing to block on. The `PermissionRequest`/`ExitPlanMode` hook in
`plugin/hooks/hooks.json` is plan-mode-only and stays untouched. Export
reaches `src/hook/export.mjs` through the `bin/planos export` subcommand (the
`export` case in `plugin/bin/planos`'s switch), via the SAME provable
`resolve(__dirname, '<lit>')` import unwrap as the `prd`/`review` cases — but,
unlike those, `src/hook/export.mjs` boots **no server** and runs **no
round-trip**: it reads a doc, serializes, writes stdout, exits. The dispatcher
routing this subcommand is a clean static edge in the import graph (no
agent-SDK / unprovable-dynamic import introduced — `node
tests/harness/import-graph.mjs` stays VERDICT CLEAN).

---

## File ownership

| File | Owner | Purpose |
|------|-------|---------|
| `src/export/markdown.mjs` | Phase 4 / Q0.1 | The PURE zero-import `(doc) → string` serializer (total over all 14 v1∪v2∪v3 kinds, deterministic, degraded-doc-safe) |
| `src/hook/export.mjs` | Phase 4 / Q1.1 | The out-of-blocking-path `bin/planos export` CLI (reads stdin/arg, serializes, stdout, exit 0 — NO server, NO round-trip, NO block) |
| `plugin/bin/planos` (`export` case) | Phase 4 / Q1.2 | Dispatcher routing for the `export` subcommand (same provable `resolve(__dirname,'<lit>')` pattern as `prd`/`review`) |
| `src/editor/export.tsx` | Phase 4 / Q3.1 | SPA-only "Download .md" + "Print / Save as PDF" affordances + `@media print` stylesheet (browser TSX, bundled, never Node-side) |
| `src/editor/theme.ts` | Phase 4 / Q2.1 | SPA-only theme token layer (browser TS, bundled, never Node-side) |
| `docs/notes/markdown-export-boundary.md` | Phase 4 / Q5.2 | This out-of-blocking-path / AC-17 boundary note |
| `tests/ac17-invariant.test.mjs` (Q5 negative LAYER 1b) | Phase 4 / Q5.1 | The AC-Q12 negative assertion: export + SPA-only modules ABSENT from the blocking-handler closure; `ac17Roots()` UNCHANGED |
| `tests/export-markdown.test.mjs` | Phase 4 / Q0.2 | Serializer round-trip + all-14-kinds totality + determinism + degraded-doc + comment-stripped static-purity scan |
| `tests/export-cli.test.mjs` | Phase 4 / Q1.3 | Child-process: markdown on stdout + immediate exit 0 + no server bind; static AC-Q12 pre-stage import assertion |
