# ADR 0008 — Rich interactive editor (M2–M5)

- Status: **ACCEPTED** — the rich interactive editor is delivered and shipped on
  `feat/prd-only-rich-editor`. All milestones M2–M5 are complete.
- Date: 2026-05-17
- Deciders: user sign-off (`.omc/plans/prd-only-rich-editor.md` "Decision (user,
  explicit)" + per-milestone autonomous tech decisions)
- Supersedes: none. Extends ADR-0007 (PRD-only consolidation) with the
  post-consolidation editor decisions.
- Raw evidence: `tests/workingdoc-m4.test.mjs` (6 passed), `tests/workingdoc-m5.test.mjs`
  (7 passed), `tests/prd-approve-edits.test.mjs`, `tests/prd-approve-feedback.test.mjs`,
  `tests/prose-richedit-roundtrip.test.mjs`, `tests/editor-render.test.mjs` (13 passed),
  `tests/spa-inline-injection.test.mjs` (AC-8 offline self-contained), full suite 35/35
  green, `npx tsc --noEmit` clean, bundle 3.88 MB (cap 7 MB).

## Context

After PRD-only consolidation (ADR-0007, M1), the SPA editor retained the basic
review affordances from the pre-consolidation codebase: comment blocks, a global
comment box, and an Approve/Revise decision button. Three defects existed:

1. **Approve dropped feedback.** Reviewer comments and the global verdict were
   discarded on Approve — only `decision:"approve"` was sent. Agents received no
   advisory context after approval, and the persisted revision was always the
   raw agent-authored document regardless of reviewer edits.
2. **No direct editing.** Reviewers could annotate blocks but not edit their
   content. All structural changes required sending a Revise with a comment and
   waiting for the agent to re-emit.
3. **No rich prose editing.** `prose` blocks were editable only as raw markdown
   text in a plain textarea. No block add/delete. No block reorder.

The user decision (plan file §"Decision") was to build a "big-bang rich
interactive editor": drag-and-drop, per-kind edit modals, diagrams instead of raw
markdown, comments that actually work. Hard constraints: offline, no CDN, single
self-contained bin bundle, AC-17 preserved.

## Decisions

### M2 — Advisory feedback on Approve

**Decision:** On Approve, reviewer `comment` ops and `globalComment` are forwarded
to the agent as advisory context in the server's `POST /api/approve` response,
rather than discarded. A transport race was closed: the server now ACKs the POST
before resolving the blocking promise, guaranteeing feedback is captured before
the process exits.

**Rationale:** Feedback being silently dropped on Approve was a defect, not a
design choice. The `comment` / `globalComment` fields are advisory — they are NOT
structural document content and are NOT applied to the persisted revision — but
they are valuable context for the agent's next action after approval. Forwarding
them on Approve costs nothing and fixes a real user expectation.

**What this is NOT:** Advisory comments do not mutate the persisted Document.
They are never passed through `deriveWorkingDoc`. A reviewer who Approves with
comments gets those comments forwarded to the agent; the persisted revision is the
`deriveWorkingDoc`-derived working document (see M3), not the comment text.

### M3 — Edited-revision persistence; `deriveWorkingDoc` working-doc transport

**Decision:** On Approve, the server applies the full editor state received from
the browser (`edits`, `answers`, `deletes`, `adds`, `order`) via
`deriveWorkingDoc(baseDoc, editorState)` and persists the resulting working
document as the next immutable PRD revision. The raw agent-authored document is
NOT persisted directly.

**Rationale:** Reviewer edits made in the SPA (field patches, openQuestion
answers, block additions/deletions, reordering) represent deliberate human choices
about the document. Discarding them on Approve and persisting only the agent
output was a defect: the reviewer's work was lost. The fix is to make the
reviewer's working document the canonical next revision.

**`deriveWorkingDoc` is the single fold-back site** for all editor interaction
state into a canonical Document. It is:
- PURE: no React, no clock, no network — a `(baseDoc, editorState) → Document` fn.
- Implemented in plain `.mjs` (zero toolchain) so the Node test harness can import
  it directly.
- ADDITIVE over M2: comments/globalComment stay advisory and are NOT applied here.
- Zero runtime dependencies; ES module.

The full compose contract is documented in `docs/design.md §4b`.

### M4 — Per-kind edit modals; editable table grid; Mermaid diagram editor; add/delete blocks

**Decision:** All 13 block kinds (`section`, `prose`, `objective`, `task`,
`decision`, `risk`, `openQuestion`, `phase`, `tradeoff`, `fileChange`, `code`,
`table`, `diagram`) get dedicated edit modals that produce structured field patches
applied via `deriveWorkingDoc`. The `table` kind gets an inline editable grid
(cell-by-cell editing). The `diagram` kind gets a modal with a Mermaid source
editor and live preview. Add/delete blocks are supported with id-stable semantics:
`mintAddedBlockId` deterministically mints a `b<n>` id seeded past the highest
existing `b<n>`, so a fresh add never collides with or renumbers an agent-authored
id.

**Rationale:** Per-kind modals make the editing model explicit and type-safe: a
`task` editor shows status/deps/acceptance fields, not a raw JSON blob. The table
grid and Mermaid modal are the natural UI for their respective kinds. Add/delete
at arbitrary positions with stable ids enables reviewers to propose document
structure changes that survive the revision chain.

### M4b — TipTap/ProseMirror as build dependency for WYSIWYG prose editing

**Decision:** TipTap (built on ProseMirror) is added as a **build-time dependency
only** for WYSIWYG rich text editing of `prose` blocks. It is bundled fully into
`plugin/dist/index.html` at build time. It is never fetched at runtime, never
loaded from a CDN, and is entirely absent from the Node-side blocking path.

**AC-17 boundary:** TipTap/ProseMirror is SPA-only. It is bundled into the
committed single-file SPA exactly like the offline Mermaid renderer (ADR-0002 D3)
and the theme layer (ADR-0004 Q2). It is not imported by `src/hook/*`,
`src/server/`, `src/schema/`, `src/diff/`, or `src/prd/`; it does not appear in
`ac17Roots()` and is absent from the blocking transitive closure. The no-CDN /
offline / AC-8 invariants are enforced by `tests/spa-inline-injection.test.mjs`
and `tests/editor-render.test.mjs` (AC-8 "offline self-contained" assertion).

**Alternatives considered:**
- **Plain textarea for prose blocks** — rejected: provides no structure/formatting
  guidance; reviewer edits are harder to read and validate.
- **Quill** — not chosen; TipTap has a cleaner ProseMirror integration and better
  headless/SSR story for the Node test harness.
- **tldraw / Excalidraw for diagrams** — rejected: both fetch fonts/WASM at
  runtime, which breaks the no-CDN / AC-17 invariant. Mermaid is already bundled
  (ADR-0002) and sufficient.

### M5 — Native HTML5 drag-drop block reorder; keyboard a11y

**Decision:** Block reorder is implemented using the browser's native HTML5
drag-and-drop API (`draggable`, `dragstart`, `dragover`, `drop`). Keyboard
accessibility (arrow keys + Space/Enter for reorder) is implemented alongside. The
reordered sequence is captured as `editorState.order` (an array of block ids) and
applied as a pure permutation by `deriveWorkingDoc` as its last pass.

**`order` compose contract (pure permutation, applied LAST):**
- `order` is applied to the post-(delete+add)-splice block list, so a freshly-added
  block can be reordered by listing its minted id in `order`.
- Live blocks whose id appears in `order` are emitted in `order`'s sequence (first
  occurrence wins; duplicate ids ignored).
- A live block id NOT in `order` is never dropped — it is re-appended keeping its
  original post-splice relative position, after the ordered ones. A partial `order`
  of just the moved ids works; an empty/absent `order` is a byte no-op.
- An id in `order` that is not live (deleted, or never existed) is skipped —
  `deletes` always wins over `order`.

**Alternative considered — dnd-kit:** dnd-kit was listed in the plan as the
primary candidate. Native HTML5 DnD was chosen instead because: (1) it requires
no additional bundle weight, (2) it has no dependency on the build toolchain or
any npm package, and (3) it satisfies the hard no-CDN / no-runtime-dep constraint
without any carve-out. Keyboard a11y is implemented alongside to cover the
accessibility gap native DnD has on its own.

## AC-17 Safety Argument

The rich editor (M2–M5) adds zero surface to the blocking path:

- `deriveWorkingDoc` (`src/editor/workingDoc.impl.mjs`) is plain `.mjs` with zero
  imports. It is called by the server's Approve handler — but it is a pure
  synchronous function that performs no I/O, no network egress, no subprocess
  spawn, and no model call. It is not an agent-SDK import; it is arithmetic over
  plain JS objects.
- TipTap/ProseMirror is SPA-only (browser bundle); it is never imported Node-side.
- Native HTML5 DnD and the per-kind modals are SPA-side browser code; they are
  never imported Node-side.
- The feedback envelope shape (`FeedbackEnvelope`) is unchanged in transport; the
  server's Approve handler now calls `deriveWorkingDoc` before `prd-store.persist`
  — a pure synchronous step with no new I/O boundary.
- `ac17Roots()` in `tests/harness/import-graph.mjs` is **UNCHANGED** for M2–M5.
  No new blocking root; no new allowed-boundary carve-out. `node
  tests/harness/import-graph.mjs` stays VERDICT CLEAN.
- The full AC-17 gate (`tests/ac17-invariant.test.mjs`) is green.

## Consequences

- **Positive:** Reviewers can edit any field of any block kind, add/delete blocks,
  reorder blocks, and have all edits survive Approve as the next immutable
  revision. Advisory comments are forwarded on Approve. The editing model is
  explicit, type-safe, and fully offline.
- **Positive:** `deriveWorkingDoc` is a single, pure, zero-dependency fold-back
  site — easily tested in isolation (Node test harness, no toolchain) and easily
  reasoned about.
- **Positive:** AC-17 / offline / no-CDN / single-file bundle invariants are
  intact and re-asserted by the full test suite.
- **Neutral:** TipTap/ProseMirror adds to the build-time bundle. The committed
  `plugin/dist/index.html` is ~3.88 MB (well under the 7 MB cap). This is a
  development concern only; end users use the committed pre-built SPA.
- **Neutral:** The `order` array in `editorState` is a pure M5 extension point:
  it requires no schema change and no transport change — the existing
  `FeedbackEnvelope` carries it as part of the editor state payload.
- **No regression:** All 35 tests pass; `tsc --noEmit` clean; both bundles build
  clean; offline gate green.
