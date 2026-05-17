# planos — Design Doc (Structured Rich PRD Plugin)

> **planos** is a Claude Code plugin that makes the agent author a **PRD** as a
> **structured block document** rendered as a rich, editable browser UI — the
> common ground between LLM-native serialization and human-native review.
>
> Status: **DESIGN.** Distribution: **standalone plugin repo** (this repo —
> `esolutions.gr/planos`).

> **⚠ ADR-0007 — PRD-only consolidation (M1).** planos was reduced to a SINGLE
> flow: **PRD**. The plan flow (the `ExitPlanMode`/`EnterPlanMode` roundtrip)
> and the diff-review flow were **removed** (no ExitPlanMode/EnterPlanMode
> hooks, no `diff` block kind, no `diff-review` document type). The PRD is
> invoked by the `/planos-prd` command running `planos prd` via the CLI over
> stdin — **NOT** via a Claude Code hook. Sections below that still describe
> the plan-mode interception, the two-hook split, the diff-review mode, or the
> v3 `diff` kind are **historical context** (kept to explain WHY the
> single-flow shape was chosen); the authoritative current behaviour is
> PRD-only. See `docs/adr/0007-consolidate-prd-only.md`.
>
> **Rich editor (M2–M5).** After consolidation, the SPA editor was substantially
> extended: M2 — advisory reviewer feedback forwarded on Approve; M3 — reviewer
> edits become the persisted revision (working-doc transport); M4 — per-kind edit
> modals for all 13 block kinds, editable table grid, Mermaid diagram editor,
> add/delete blocks, TipTap/ProseMirror WYSIWYG prose editor (M4b, bundled
> offline); M5 — native HTML5 drag-drop block reorder with keyboard a11y. The
> single fold-back site is `src/editor/workingDoc.impl.mjs`
> `deriveWorkingDoc(baseDoc, {edits, answers, deletes, adds, order})`. See §4b
> for the full compose contract.

---

## 1. Problem & Vision

Markdown is a serialization format optimized for LLMs. It is what `ExitPlanMode` emits, what
PRDs degrade into, what every agent produces by default. Humans reviewing a plan do not want
to read a wall of markdown — they want **structured artifacts they can see and manipulate**:
task lists with status, decision cards with chosen options, risk tables, dependency graphs,
inline questions they can answer directly.

plannotator's answer is: keep the artifact as markdown, render it richly, let humans annotate
*on top of* the text. It is excellent, but it treats structure as a rendering concern.

**Our thesis:** the structured representation should *be the artifact*. The agent authors a
constrained block document; the human edits the blocks directly in a browser; structured edits
flow back. Markdown becomes an export format, not the source of truth.

This is the inversion of plannotator's design, and it relocates complexity from *rendering
unstructured text* to *the authoring contract*. The rest of this document is about managing
that relocation responsibly.

### Non-goals

- Not a general document editor or Notion clone. The block vocabulary is deliberately small
  and plan/PRD/review-shaped.
- Not multi-user real-time collaboration (v1). Single reviewer, local.
- Not a hosted service. No cloud, no upload, no share links in v1 (revisit in Phase 4).
- Not a replacement for the agent's reasoning — it shapes *output format*, not *thinking*.

---

## 2. What We Reuse From plannotator vs. Build New

Evidence base: full source analysis of `github.com/backnotprop/plannotator` (Bun monorepo;
plugin published from `apps/hook/`).

### Reuse conceptually (proven, low-risk)

| Mechanism | plannotator reference | Why reuse |
|---|---|---|
| **Plan-mode interception** | `PermissionRequest` matcher `ExitPlanMode`, 96h timeout, bare command | The correct, proven hook event. `deny.message` re-enters the agent loop and drives revision. |
| **Schema/context injection** | `PreToolUse` matcher `EnterPlanMode`, 5s, `improve-context` injecting `additionalContext` | This is the channel that delivers our block schema to the agent *before* it authors. Load-bearing for native authoring. |
| **Blocking local-server round-trip** | `Bun.serve` random localhost port, unresolved `decisionPromise`, `onReady`→open browser, `POST /api/approve\|deny` resolves, `sleep(1500)`→`stop()`→`exit(0)`, EADDRINUSE retry | The browser→blocked-hook channel. Lifecycle copied wholesale. |
| **Single-file SPA build** | `viteSingleFile()`, `cssCodeSplit:false`, `inlineDynamicImports:true`; HTML served as one static blob | Clean, dependency-light, offline. Keep. |
| **Slug + on-disk version history** | slug = first heading + date; prior version loaded for diff; "do not change title" stability rule | Revision chaining. We key by document ID instead of heading slug (more robust). |
| **Strong-directive deny preamble** | `prompts.ts:41-42` "YOUR PLAN WAS NOT APPROVED. You MUST revise…" | Empirically tuned; soft phrasing was ignored by agents. Keep the firmness. |

### Build new (because the artifact is structured)

| Concern | plannotator approach | Our approach |
|---|---|---|
| **Data model** | Ephemeral regex `Block[]`, self-described "demo" parser, never serialized | A real, versioned **JSON block schema** that is the canonical artifact, with stable IDs and validation. |
| **Annotation anchoring** | Verbatim `originalText` substring match against rendered markdown | Anchor to **block ID** (+ optional intra-block offset). Strictly more robust *iff* IDs are stable across revisions (see §6 — the hard problem). |
| **Feedback envelope** | Flattened to a prose markdown report | A **structured edit envelope** (block-addressed ops) serialized into a clear instruction block for the agent. |
| **Diff engine** | Two-pass line+word markdown text diff with sentinel atomization (~600 LOC of complexity) | **Structural diff** keyed by block ID (added/removed/moved/modified). Reuse only their inner `diffWordsWithSpace` for intra-block text changes. |
| **Authoring** | None — agent emits free markdown | **Native structured authoring** via injected schema + deterministic fallback (§5). |

---

## 3. Architecture Overview

> **Historical context — plan-mode loop (removed, ADR-0007):** The original
> design intercepted `ExitPlanMode` via a `PermissionRequest` hook. This is kept
> here to explain the design lineage; it no longer exists in the codebase.
>
> ```
> ┌─ EnterPlanMode (PreToolUse, fast) ──────────────────────────────┐
> │  inject block schema + authoring example as additionalContext   │
> └─────────────────────────────────────────────────────────────────┘
>                               │ agent authors structured doc
>                               ▼
>         agent calls ExitPlanMode (tool_input.plan = our JSON or markdown)
>                               │
> ┌─ ExitPlanMode (PermissionRequest, 96h timeout) ─────────────────┐
> │  1. read hook JSON from stdin                                   │
> │  2. parse + validate / prose-fallback                           │
> │  3. load previous version → compute structural diff             │
> │  4. render SPA, boot localhost server, open browser             │
> │  5. BLOCK on decisionPromise                                    │
> │  6. user edits / approves / revises                             │
> │  7. browser POSTs feedback envelope                             │
> │  8. emit PermissionRequest decision JSON on stdout              │
> │  9. sleep(1500) → server.stop() → exit(0)                       │
> └─────────────────────────────────────────────────────────────────┘
>                               │ deny.message → agent revises → loop
> ```

**Current architecture — PRD-only (ADR-0007):**

```
User types /planos-prd [topic]
      ↓
Live agent: Socratic interview in the terminal        ← OUTSIDE blocking path
      ↓
Agent authors v2 PRD block document JSON              ← OUTSIDE blocking path
      ↓
Agent pipes JSON to: node bin/planos prd ─────────────┐ blocking path begins
      ↓                                               │
src/hook/prd.mjs: read stdin, validate, start server  │  no model call
      ↓                                               │
Browser opens — SPA editor renders working doc         │  no model call
      ↓                                               │
User edits blocks (per-kind modals, TipTap prose,     │  no model call
  table grid, Mermaid editor, add/delete, reorder)    │
      ↓                                               │
Browser POSTs feedback envelope (approve or revise)   │  no model call
      ↓                                               │
  approve → deriveWorkingDoc applied → working doc    │
            persisted as next revision (M3)           │
            advisory feedback forwarded (M2)          │
  revise  → deny message = directive + envelope       │
      ↓                                               │
server.stop() → exit(0) ──────────────────────────────┘ blocking path ends
      ↓
Agent revises structured doc, re-pipes → loop
```

**One entry mode, one engine (ADR-0007 — PRD-only):**

| Mode | Trigger | Hook vs command | Notes |
|---|---|---|---|
| **PRD** | `/planos-prd [topic]` slash command | Command → blocking CLI (`planos prd`, stdin) | Richer v2 block vocab; persists immutable revisions to a `prds/`-style dir. |

The PRD flow uses: the block schema (v1∪v2), the SPA editor, the local-server
round-trip, the structured feedback envelope, and the structural revision-diff.
The plan-mode (`ExitPlanMode`/`EnterPlanMode`) and diff-review modes shown in
the historical sections below were removed in M1.

---

## 4. The Block Schema (the contract)

The schema **is** the product. It must be: small enough that an LLM reliably emits it,
expressive enough to be worth the structure, and stable across revisions.

```jsonc
Document {
  schemaVersion: 1,
  type: "plan" | "prd",   // ADR-0007: "diff-review" removed; PRD uses "prd"
  id: string,            // stable across revisions — the revision chain key
  title: string,
  meta: { branch?, status: "draft"|"in-review"|"approved", createdAt, revision: int },
  blocks: Block[]
}

// Block is a discriminated union on `kind`. EVERY block has:
//   id: string   — stable, agent-assigned, MUST persist across revisions (see §6)
//   kind: string

Block kinds (v1 core — Plan):
  section        { id, kind, title, level, collapsed? }      // structural grouping
  prose          { id, kind, md }                             // narrative; rich-text editable
  objective      { id, kind, text, successCriteria: string[] }
  task           { id, kind, title, detail?, status: "todo"|"doing"|"done"|"cut",
                   deps: id[], acceptance: string[], estimate? }
  decision       { id, kind, question, options: {label,pros?,cons?}[],
                   chosen?: label, rationale? }               // ADR-style card
  risk           { id, kind, description, likelihood: L|M|H, impact: L|M|H, mitigation }
  openQuestion   { id, kind, question, answer?: string }      // REQUIRES human input inline

Block kinds (v2 — PRD + richer):
  phase          { id, kind, title, taskIds: id[] }
  tradeoff       { id, kind, axis, options: {label, score?, note?}[] }
  fileChange     { id, kind, path, action: add|modify|delete, rationale }
  code           { id, kind, lang, content, filename? }
  table          { id, kind, columns: string[], rows: string[][] }
  diagram        { id, kind, mermaid: string }

// Block kinds (v3 — Diff review): REMOVED in M1 (ADR-0007). The `diff` kind
// and the `diff-review` document type no longer exist — planos is PRD-only.
```

### Feedback envelope (browser → agent)

```jsonc
FeedbackEnvelope {
  decision: "approve" | "revise",
  documentId: string,
  baseRevision: int,                 // revision the human edited against (race guard)
  ops: Edit[],                       // structured, block-addressed
  globalComment?: string
}

Edit =
  | { op: "editBlock",   blockId, patch: Partial<Block> }
  | { op: "deleteBlock", blockId }
  | { op: "moveBlock",   blockId, afterBlockId | null }
  | { op: "comment",     blockId, text, anchor?: {start,end} }
  | { op: "answer",      blockId, answer }          // for openQuestion
  | { op: "addBlock",    afterBlockId, block }       // human-initiated insert
```

On `revise`, the hook serializes this envelope into the `deny.message`: the tuned directive
preamble + a human-readable rendering of the ops + the current canonical JSON. The agent at
the other end is still text-in/text-out, so we **do not assume it can diff JSON itself** — we
spell out the changes *and* hand it the structure.

---

## 4b. Working-Document Compose Contract (`deriveWorkingDoc`)

The SPA accumulates reviewer interactions into an **editor state** and folds them back into a
single canonical working document at the moment of Approve or Revise. This is done by
`deriveWorkingDoc(baseDoc, editorState)` in `src/editor/workingDoc.impl.mjs` — the **single
fold-back site** for all editor interaction state.

```
deriveWorkingDoc(baseDoc, {
  edits?,    // Record<blockId, Partial<Block>> — field patches for any kind
  answers?,  // Record<blockId, string>         — openQuestion answer field
  deletes?,  // string[] | Set<string>          — block ids to remove
  adds?,     // Array<{ afterId: string|null, block }> — positional inserts
  order?,    // string[]                        — desired block sequence (M5)
}) → Document   // new Document; baseDoc is untouched
```

**Compose contract (applied in this order):**

1. **edits** — field patches are merged shallowly over any block of any kind. An empty patch
   is a no-op (the block passes through byte-unchanged, so a review with no structural edits
   yields a working doc canonically equal to the base — the no-op correctness the PRD path
   relies on to skip a spurious revision).
2. **answers** — applied only to `openQuestion` blocks: sets the `answer` field. A stray
   answer keyed at a non-openQuestion block is ignored — it rides the advisory envelope, never
   corrupts the structural doc.
3. **deletes** — listed block ids are dropped. Nothing else renumbers. `deletes` takes priority
   over `order` (a deleted id listed in `order` is skipped, never resurrected).
4. **adds** — each entry is spliced in after `afterId` (`null` → prepend; unknown id →
   append; never silently dropped). Added blocks are id-stable: a caller-supplied non-empty
   string id is honoured verbatim; otherwise `mintAddedBlockId(existingIds)` deterministically
   mints a collision-free `b<n>` id seeded past the highest existing `b<n>`, so a fresh add
   never collides with — and never renumbers — an agent-authored id. Ordering of multiple adds
   at the same anchor preserves insertion order.
5. **order** (M5) — applied LAST, as a pure permutation of the post-(delete+add) block list.
   Rules:
   - Live blocks whose id appears in `order` are emitted in `order`'s sequence (first
     occurrence wins; duplicate ids ignored).
   - A live block id NOT in `order` is never dropped — it is re-appended keeping its original
     post-splice relative position, after the ordered ones. So a partial `order` of just the
     moved ids works; an empty/absent `order` is a byte no-op.
   - An id in `order` that is not live (deleted, or never existed) is skipped.
   - A pure reorder yields the SAME block objects (id-stable, byte-equal per block) in a new
     sequence; the produced doc stays `validateDocument`-clean and canonical.

**M2 advisory feedback seam:** `comment` ops and `globalComment` in the envelope are
advisory — they are NOT applied by `deriveWorkingDoc` and do NOT become structural document
content. On Approve they are forwarded to the agent as context; they never block approval.

**M3 edited-revision persistence seam:** on Approve, the server calls `deriveWorkingDoc` with
the full editor state received from the browser and persists the resulting working document as
the next immutable revision (not the raw agent-authored doc). This means reviewer edits made
in the SPA survive Approve and become the canonical next revision.

---

## 5. Authoring Model — Decided

**Decision: native structured authoring via injected schema instructions, with a
deterministic (non-LLM) prose-block fallback.** Rejected: post-hoc LLM markdown→blocks
conversion, and LLM-driven hybrid.

### Why (evidence-based)

- **plannotator precedent:** plannotator's `EnterPlanMode` PreToolUse hook (historical,
  removed in ADR-0007) reliably injected authoring context; their opt-in "PFM reminder"
  showed agents *do* follow injected format guidance. The PRD command (`/planos-prd`) achieves
  the same effect via the command prompt itself, which delivers the v2 block schema and a
  worked example to the agent as part of the slash-command instruction.
- **Post-hoc LLM conversion is the worst option here.** It (1) adds a non-deterministic model
  call *inside the user-blocking path*, (2) produces different block IDs across iterations —
  which breaks revision chaining, annotation anchoring, and structural diff (the exact things
  structure exists to provide), and (3) means the agent never sees the structure it
  "authored." plannotator's entire architecture exists to avoid a conversion layer; we keep
  that discipline.
- **Pure native authoring alone is fragile** — the agent will occasionally emit prose. The
  deterministic fallback handles this without blocking the user.

### The fallback is a parser, not a model

If the piped JSON fails schema validation: wrap the raw text in a single
`{ kind: "prose", md: <raw> }` block, mark `meta.degraded = true`, render normally. The user
is **never blocked by malformed output**; the UI shows a "this PRD wasn't structured —
ask the agent to re-emit" affordance. Deterministic, fast, ID-stable.

### Reinforcement at two layers

1. **Proactive** — the `/planos-prd` command prompt delivers the v2 block schema + a worked
   example so the agent authors valid structure on the first attempt.
2. **Corrective** — on validation failure, the `deny.message` names exactly which blocks were
   malformed and how to fix them, reusing the deny→revise loop. The agent converges on
   valid structure over iterations with zero conversion model.

---

## 6. The Hard Problem: Block-ID Stability Across Revisions

Everything good about the structured approach (precise annotation anchoring, clean structural
diff, race-safe edits) depends on **block IDs surviving agent revisions**. The agent
regenerates the whole document each iteration; if it renumbers blocks, every anchor breaks.

Mitigations, in order of reliance:

1. **Instruct ID preservation explicitly.** Injected schema rules: "When revising, REUSE the
   `id` of any block whose intent is unchanged. Only mint new IDs for genuinely new blocks.
   Never renumber." Reuse plannotator's "do not change the title" firmness, applied to IDs.
2. **Echo prior IDs in the deny message.** On revise, the structured feedback includes the
   current `(id, kind, title)` table so the agent has the exact IDs to reuse — it is not
   recalling from memory.
3. **Deterministic re-anchoring fallback.** If the agent mints a new ID for an
   obviously-corresponding block, match by `(kind, normalized title/text)` similarity to carry
   forward comments. Heuristic, last resort, surfaced to the user ("comment re-attached —
   verify").
4. **Race guard.** `baseRevision` in the envelope: if the agent revised while the human was
   editing, detect mismatch and re-render rather than apply stale ops.

This was the single biggest design risk. It was validated in the initial implementation
milestone: `opaque` IDs (ADR-0001) proved stable at 100% preservation across realistic
prompts. plannotator dodges it entirely by never having IDs; we cannot.

---

## 7. Structural Diff

Replaces plannotator's ~600 LOC text-diff engine with a small structural one:

- **Outer pass (by ID):** classify each block as `added` / `removed` / `moved` / `modified` /
  `unchanged` by comparing block ID sets and positions between revisions.
- **Inner pass (modified blocks only):** for text-bearing fields (`prose.md`,
  `task.detail`, …) reuse plannotator's `diffWordsWithSpace` idea for an inline word diff.
- **Render:** revision selector; modified blocks expandable to word-level; moved blocks
  flagged; the human reviews *what the agent changed in response to feedback* — the core trust
  mechanic.

---

## 8. Plugin Repo Structure & Distribution

Standalone repo (this one), marketplace-installable like plannotator.

```
planos/
├── .claude-plugin/
│   └── marketplace.json          # { plugins: [{ name, source: "./plugin" }] }
├── plugin/
│   ├── .claude-plugin/plugin.json
│   ├── commands/
│   │   └── planos-prd.md         # /planos-prd slash command (no hooks.json — PRD-only)
│   ├── bin/planos                # CLI entrypoint (prd + export dispatch)
│   └── dist/index.html           # prebuilt single-file SPA (committed)
├── src/
│   ├── server/                   # local blocking server (Node http)
│   ├── schema/                   # block schema + validator (the contract)
│   ├── diff/                     # structural diff
│   ├── prd/                      # PRD persistence (immutable revision store)
│   ├── export/                   # markdown serializer (out-of-blocking-path)
│   └── editor/                   # React + TipTap SPA (Vite + viteSingleFile)
│       └── workingDoc.impl.mjs   # deriveWorkingDoc — single fold-back site
├── docs/
│   └── design.md                 # this document
└── tests/
```

### Tech stack decision

- **Runtime: Node 20+** (not Bun). Node's built-in `http` server covers the round-trip with
  zero runtime deps. The committed `plugin/dist/index.html` and `plugin/bin/planos` script
  mean no build step for end users. Bun single-binary is deferred post-1.0.0 (ADR-0004 Q5).
- **SPA: React 19 + Vite + `vite-plugin-singlefile` + TipTap/ProseMirror (M4b).** Built at
  dev time, output (`plugin/dist/index.html`) committed so install needs no build step.
  TipTap is a build-time dependency only — fully bundled offline, no CDN at runtime.
- **Schema validation: hand-rolled validator** (`src/schema/validate.mjs`) — zero runtime
  dependencies on the blocking path (ADR-0000).

---

## 9. Phasing & Delivered State

> **Note:** The phasing below describes the original design plan. Phases 1–4 are COMPLETE.
> Following consolidation (ADR-0007, M1), only the PRD flow exists; the plan-mode and
> diff-review flows (Phases 1 and 3 below) were excised. The rich editor (M2–M5) was
> delivered on top of Phase 2 (PRD mode). The current delivered state is documented here for
> historical context.

### Phase 1 — Prove the loop + de-risk ID stability *(HISTORICAL — plan mode removed)*

> Plan mode (`ExitPlanMode` hook) was prototyped and then excised in ADR-0007. The ID
> stability risk was validated: `opaque` IDs (ADR-0001) proved stable at 100% preservation.
> The localhost round-trip, structural diff, deterministic fallback, and deny→revise loop
> were all proven and carried forward into the PRD flow.

### Phase 2 — PRD mode *(DELIVERED)*

`/planos-prd` command, full v2 block vocab (`phase, tradeoff, fileChange, code, table,
diagram`), persistence to a PRD revision store, multi-revision history browser. AC-17
re-asserted for `bin/planos prd` (ADR-0002).

### Phase 2 extension — Rich interactive editor *(DELIVERED, M2–M5)*

- **M2** — Advisory feedback forwarded on Approve; `baseRevision` race guard.
- **M3** — Reviewer edits persist as next revision (`deriveWorkingDoc` working-doc transport).
- **M4** — Per-kind edit modals for all 13 block kinds; editable table grid; Mermaid diagram
  editor; add/delete blocks (id-stable, `mintAddedBlockId`).
- **M4b** — TipTap/ProseMirror WYSIWYG prose editor bundled offline (no CDN).
- **M5** — Native HTML5 drag-drop block reorder with keyboard a11y; `order` compose contract
  (pure permutation, applied last, deletes-wins, partial-order safe, byte-no-op preserved).

### Phase 3 — Diff review *(HISTORICAL — removed in ADR-0007)*

> The `diff` block kind, `diff-review` document type, `gh`/`git` ingestion, and
> `/planos-review` command were built and then excised in ADR-0007 (an explicit non-goal).
> The v3 `diff` kind no longer exists.

### Phase 4 — Polish & distribution *(DELIVERED)*

Themes (light/dark/OS-auto), markdown export (SPA download + `bin/planos export` CLI, AC-17
negative proof), PDF via `window.print()`, marketplace listing, `version` 1.0.0. Bun
single-binary deferred (Q5). Encrypted local share deferred (Q6). Plannotator coexistence
formally closed as infeasible-without-CC-primitive (Q7, ADR-0004).

---

## 10. Risks & Open Questions

| Risk / question | Disposition |
|---|---|
| **Block-ID stability** (§6) | **Resolved.** `opaque` IDs (ADR-0001) proved stable at 100% preservation across realistic prompts. The deterministic re-anchoring fallback exists but was not needed in practice. |
| Agent emits prose despite injection | Covered by deterministic fallback; corrective deny loop converges it. |
| Schema too rigid → agent fights it | `prose` is always a valid escape hatch; v2 vocab proven sufficient. |
| Schema too loose → no value over markdown | The structured task/decision/risk/openQuestion/phase/tradeoff/table/diagram blocks are the value; prose is fallback only. |
| Node vs Bun | **Resolved — Node.** Bun single-binary deferred post-1.0.0 (ADR-0004 Q5). |
| Name | **Resolved — `planos`.** |
| Repo location | **Resolved — `esolutions.gr/planos`, branch `main`.** |
| Coexistence with plannotator (hook matcher collision on `ExitPlanMode`) | **Resolved (ADR-0004 Q7) — moot for the PRD-only flow (no hooks). The coexistence guard in `src/hook/coexistence.mjs` was removed along with the plan-mode hook path (ADR-0007).** |
| Plan-mode / diff-review scope | **Resolved (ADR-0007) — excised. PRD is the single flow.** |
| Rich editor transport race (M2) | **Resolved — `baseRevision` race guard in the feedback envelope; advisory comments forwarded on Approve, never blocking.** |

---

## 11. Summary

We are not cloning plannotator. We are **inverting its core decision**: structure becomes the
artifact instead of an overlay on markdown. plannotator's plumbing (blocking local server,
single-file build, deny-loop revision) is proven and reused; its data model, diff engine, and
feedback envelope are deliberately *not* reused because they exist to cope with the absence of
structure we are introducing. The authoring model is native structured authoring with a
deterministic fallback, never an LLM converter in the blocking path. The make-or-break
technical risk — block-ID stability across agent revisions — was validated: `opaque` IDs are
the production default and proved stable at 100% preservation. The design is complete and
delivered as a PRD-only single flow with a rich interactive editor (M2–M5).
