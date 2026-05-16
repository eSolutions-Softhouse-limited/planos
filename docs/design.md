# planos — Design Doc (Structured Rich Plan/PRD Plugin)

> **planos** is a Claude Code plugin that makes the agent author plans, PRDs, and diff
> reviews as a **structured block document** rendered as a rich, editable browser UI — the
> common ground between LLM-native serialization and human-native review.
>
> Status: **DESIGN — pre-implementation.** Authored in markdown deliberately; the tool does
> not yet exist to bootstrap itself.
> Distribution: **standalone plugin repo** (this repo — `esolutions.gr/planos`).

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

```
┌─ EnterPlanMode (PreToolUse, fast) ──────────────────────────────┐
│  inject block schema + authoring example as additionalContext   │
└─────────────────────────────────────────────────────────────────┘
                              │ agent authors structured doc
                              ▼
        agent calls ExitPlanMode (tool_input.plan = our JSON or markdown)
                              │
┌─ ExitPlanMode (PermissionRequest, 96h timeout) ─────────────────┐
│  1. read hook JSON from stdin                                   │
│  2. parse tool_input.plan:                                      │
│       valid block doc → use it                                  │
│       invalid/plain md → deterministic wrap in single prose blk  │
│  3. load previous version → compute structural diff             │
│  4. render single-file SPA, boot localhost server, open browser │
│  5. BLOCK on decisionPromise (up to 96h)                         │
│  6. user edits blocks / answers questions / comments / approves  │
│  7. browser POSTs structured feedback envelope                   │
│  8. resolve → emit PermissionRequest decision JSON on stdout:    │
│       approve → behavior:"allow"                                 │
│       revise  → behavior:"deny", message = directive + envelope  │
│  9. sleep(1500) → server.stop() → exit(0)                        │
└─────────────────────────────────────────────────────────────────┘
                              │ deny.message
                              ▼
        agent revises structured doc, re-calls ExitPlanMode → loop
```

**Three entry modes, one engine:**

| Mode | Trigger | Hook vs command | Notes |
|---|---|---|---|
| **Plan** | Native plan mode | `ExitPlanMode` hook (auto) | The flagship loop above. |
| **PRD** | `/planos-prd [topic]` slash command | Command → blocking CLI | Not plan-mode; richer block vocab; persists to a `prds/`-style dir. |
| **Diff review** | `/planos-review [PR# \| git range]` | Command → blocking CLI | `gh`/`git` fetch → diff blocks; comment/accept/reject per hunk. |

All three share: block schema, SPA editor, local-server round-trip, structured feedback,
structural diff. Only the *source* of the initial document and the *block subset* differ.

---

## 4. The Block Schema (the contract)

The schema **is** the product. It must be: small enough that an LLM reliably emits it,
expressive enough to be worth the structure, and stable across revisions.

```jsonc
Document {
  schemaVersion: 1,
  type: "plan" | "prd" | "diff-review",
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

Block kinds (v3 — Diff review):
  diff           { id, kind, path, hunks: Hunk[], comments: BlockComment[] }
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

## 5. Authoring Model — Decided

**Decision: native structured authoring via injected schema instructions, with a
deterministic (non-LLM) prose-block fallback.** Rejected: post-hoc LLM markdown→blocks
conversion, and LLM-driven hybrid.

### Why (evidence-based)

- **plannotator precedent:** the `EnterPlanMode` PreToolUse hook reliably injects authoring
  context (`additionalContext`); their opt-in "PFM reminder" shows agents *do* follow injected
  format guidance. Same mechanism, stricter target.
- **Post-hoc LLM conversion is the worst option here.** It (1) adds a non-deterministic model
  call *inside the user-blocking hook*, (2) produces different block IDs across iterations —
  which breaks revision chaining, annotation anchoring, and structural diff (the exact things
  structure exists to provide), and (3) means the agent never sees the structure it
  "authored." plannotator's entire architecture exists to avoid a conversion layer; we keep
  that discipline.
- **Pure native authoring alone is fragile** — `tool_input.plan` is a free-text field; the
  agent will occasionally emit prose. We discover this *inside* the blocked hook.

### The fallback is a parser, not a model

If `tool_input.plan` fails schema validation: wrap the raw text in a single
`{ kind: "prose", md: <raw> }` block, mark `meta.degraded = true`, render normally. The user
is **never blocked by malformed output**; the UI shows a "this plan wasn't structured —
ask the agent to re-emit" affordance. Deterministic, fast, ID-stable. This is the defensible
middle ground — a hybrid whose seam is deterministic, not LLM-driven.

### Reinforcement at two layers (mirrors plannotator's two-hook split)

1. **Proactive** — `EnterPlanMode` PreToolUse injects the schema + a worked example as
   `additionalContext`.
2. **Corrective** — on validation failure, the `deny.message` names exactly which blocks were
   malformed and how to fix them, reusing the proven deny→revise loop. The agent converges on
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

This is the single biggest design risk and the area to prototype first (see §9 Phase 1 exit
criteria). plannotator dodges it entirely by never having IDs; we cannot.

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
│   ├── hooks/hooks.json          # EnterPlanMode (inject) + ExitPlanMode (block)
│   ├── commands/
│   │   ├── planos-prd.md
│   │   └── planos-review.md
│   ├── bin/planos                # CLI entrypoint (hook + command dispatch)
│   └── dist/index.html           # prebuilt single-file SPA (committed)
├── src/
│   ├── server/                   # local blocking server (Node http)
│   ├── schema/                   # block schema + validator (the contract)
│   ├── diff/                     # structural diff
│   └── editor/                   # React SPA (Vite + viteSingleFile)
├── docs/
│   └── design.md                 # this document
└── tests/
```

### Tech stack decision

- **Runtime: Node 20+** (not Bun). Rationale: Node is more universally present on
  contributors'/users' machines than Bun; Node's built-in `http` server covers the
  round-trip with zero runtime deps. plannotator chose Bun for a compiled single binary +
  installer; we trade that for **lower install friction** (prebuilt HTML committed, CLI is a
  plain Node script). Revisit Bun in Phase 4 if a single binary is wanted.
- **SPA: React 19 + Vite + `vite-plugin-singlefile`.** Built at dev time, output
  (`plugin/dist/index.html`) committed so install needs no build step.
- **Schema validation: Zod** (or a hand-rolled validator if we want zero deps in the
  blocking path — decide in Phase 1).

---

## 9. Phasing & Exit Criteria

### Phase 1 — Prove the loop + de-risk ID stability  *(highest priority)*

Plan mode only. Core block kinds (`section, prose, objective, task, decision, risk,
openQuestion`). Native authoring + deterministic fallback. `EnterPlanMode` injection +
`ExitPlanMode` blocking hook + localhost round-trip + structural diff on revision.

**Exit criteria (must all hold):**
- Agent authors a valid block doc from injected schema on first try ≥ ~70% of realistic
  prompts; malformed output degrades gracefully (never blocks the user).
- Edit a task, answer an openQuestion, comment a block, hit "revise" → agent receives
  structured feedback → revises → **block IDs preserved**, structural diff highlights exactly
  what changed.
- Approve → `behavior:"allow"`, agent proceeds normally.
- Full loop works offline, no external network.

### Phase 2 — PRD mode

`/planos-prd` command, full v2 block vocab (`phase, tradeoff, fileChange, code, table,
diagram`), persistence to a PRD directory, multi-revision history browser.

### Phase 3 — Diff review

`/planos-review` command, `diff` block kind, `gh` PR + local git range ingestion,
per-hunk comment/accept/reject, structured review envelope.

### Phase 4 — Polish & distribution

Themes, markdown/PDF export, optional Bun single-binary, optional encrypted local share
(plannotator-style, opt-in), marketplace listing.

---

## 10. Risks & Open Questions

| Risk / question | Disposition |
|---|---|
| **Block-ID stability** (§6) | Top risk. Phase 1 exit criteria gate it. If instruction-based preservation proves unreliable, escalate the deterministic re-anchoring layer before adding modes. |
| Agent emits prose despite injection | Covered by deterministic fallback; corrective deny loop converges it. Measure first-try valid rate. |
| Schema too rigid → agent fights it | Keep v1 vocab minimal; `prose` is always a valid escape hatch. |
| Schema too loose → no value over markdown | The structured task/decision/risk/openQuestion blocks are the value; prose is fallback only. |
| 96h blocking hook UX | Inherited from plannotator; acceptable, well-trodden. |
| Node vs Bun | Decided Node for friction; revisit Phase 4. |
| Name | **Resolved — `planos`.** |
| Repo location | **Resolved — `esolutions.gr/planos`, git-initialised, branch `main`.** |
| Coexistence with plannotator installed (hook matcher collision on `ExitPlanMode`) | **Open — investigate Claude Code multi-plugin hook behavior in Phase 1.** |

---

## 11. Summary

We are not cloning plannotator. We are **inverting its core decision**: structure becomes the
artifact instead of an overlay on markdown. plannotator's plumbing (hook topology, blocking
local server, single-file build, deny-loop revision) is proven and reused; its data model,
diff engine, and feedback envelope are deliberately *not* reused because they exist to cope
with the absence of structure we are introducing. The authoring model is settled by evidence:
native structured authoring with a deterministic fallback, never an LLM converter in the
blocking path. The make-or-break technical risk is block-ID stability across agent revisions,
and Phase 1 exists primarily to prove it.
