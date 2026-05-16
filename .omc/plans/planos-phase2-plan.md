# Work Plan: planos — Phase 2 (PRD Mode + Full v2 Block Vocab + Persisted Revision History)

- Plan ID: planos-phase2-plan
- Generated: 2026-05-16
- Revision: 1 (planning only — pending approval; not yet consensus-reviewed)
- Status: PLANNING ONLY — no implementation
- Sources of truth: `docs/design.md` (§3 architecture, §4 schema incl. v2 block kinds, §7 diff, §9 Phase 2 scope, §10 risks), `docs/adr/0000-validator-choice.md`, `docs/adr/0001-block-id-scheme.md`, `.omc/plans/planos-phase1-consensus.md` (structure mirrored), and the real Phase 1 source under `src/`, `plugin/`, `tests/`
- Mode: standard plan (RALPLAN-DR not run — this is a draft for human sign-off + consensus pass)
- Repo: Phase 1 foundation complete and green (ADR-0001 ACCEPTED, `opaque` wired as production default); branch `main`

---

## 1. Context

Phase 1 proved the structured-artifact loop and falsified-clear the §6 block-ID-stability risk (ADR-0001: both ID schemes hit 1.000 live preservation; `opaque` wired as `PRODUCTION_DEFAULT_STRATEGY` in `src/schema/id-strategy.mjs:54`). Phase 2 adds the **second of the three design.md §3 entry modes — PRD mode** — without disturbing the plan-mode hook loop.

Phase 2 delivers exactly what design.md §9 scopes: a `/planos-prd [topic]` slash **command** that boots the blocking server **directly** (command → blocking CLI round-trip, NOT an `ExitPlanMode` PermissionRequest hook), the **full v2 block vocabulary** (`phase, tradeoff, fileChange, code, table, diagram`), **persistence to a PRD directory with multi-revision history**, and a **multi-revision history browser in the SPA**.

The architectural seam is already present: `src/hook/exit.mjs:823 handleExit()` is a two-mode engine ("SCRIPTED" via injected `decisionProvider` vs "REAL-SPA"). Phase 2 adds a third caller of the same `startServer()` round-trip that is reached from a command, not the `ExitPlanMode` hook. The validator (`src/schema/validate.mjs`), structural diff (`src/diff/structural.mjs`), envelope (`src/schema/envelope.mjs`), and SPA renderers (`src/editor/blocks.tsx`) are extended for v2 kinds — every one of them already has an explicit "v1 only / keep in sync with §4" extension point.

**The v1 vs v2 question of "is there a model in the blocking path" (AC-17) recurs here and is answered the same way:** the `/planos-prd` command's pre-server interview is a *live-agent CLI surface that runs before the server boots*, exactly mirroring `/planos-plan` (`docs/notes/planos-plan-command.md`). The blocking path (server boot → decision → flush → exit) stays model-free. AC-17 is RE-ASSERTED for the new `bin/planos prd` entrypoint and its transitive module graph, not weakened.

---

## 2. Reused from Phase 1 vs Genuinely New for Phase 2

### REUSED AS-IS (zero or near-zero change)

| Asset | File(s) | Why reusable unchanged |
|---|---|---|
| Hand-rolled validator engine + error-string discipline | `src/schema/validate.mjs` | ADR-0000 anticipated this exact growth ("revisit only if the schema grows materially in Phase 2+"). The per-kind `KIND_VALIDATORS` map (line 100) is an open extension point. `DOC_TYPES` already includes `"prd"` (line 30). |
| Blocking server lifecycle | `src/server/index.mjs` (`startServer`, `bindFreePort`, flush-then-exit) | Mode-agnostic. PRD mode is a third caller; no server changes needed for the round-trip itself. |
| `handleExit` engine internals: stdin parse, `planToDocument`, `degradeToProse`, `buildDecision`, `buildReviseMessage`, `renderEchoTable`, `toPermissionRequestOutput`, `buildPlanApiHandlers` | `src/hook/exit.mjs` | All exported and pure. PRD mode reuses the round-trip + envelope + race-guard machinery; only the *entry path* and *persistence* differ. |
| Structural diff engine (outer ID pass + inner word diff + LCS move detection) | `src/diff/structural.mjs` | Outer pass is kind-agnostic. Only `TEXT_FIELDS` (line 38) needs v2 entries; `canonicalize`/`blocksEqual` already handle arbitrary nested fields, so non-text v2 fields diff correctly as modified/unchanged with zero changes. |
| Deterministic re-anchoring fallback | `src/diff/reanchor.mjs` | Defence-in-depth; AC-13 mechanism unchanged. v2 needs its primary-text-field map extended only. |
| FeedbackEnvelope validator + ops renderer + baseRevision race guard | `src/schema/envelope.mjs` | The §4 `Edit` union is block-kind-agnostic (`editBlock`/`addBlock` carry an opaque `block`/`patch`). Reused unchanged for v2 round-trips. |
| Opaque ID scheme + §6 mechanisms (instruction inject, deny-echo table, re-anchor, baseRevision guard) + AC-17 invariant | `src/schema/id-strategy.mjs`, `src/hook/exit.mjs:renderEchoTable`, `tests/ac17-invariant.test.mjs` | ADR-0001 ACCEPTED; `opaque` is production default and rename-stable (explicitly chosen because it survives heavy title edits — exactly the Phase 2 PRD churn case). NO Phase 2 ID re-measurement required (see §5). |
| Single-file SPA build (Vite + viteSingleFile, committed `plugin/dist/index.html`) | `vite.config.*`, `src/editor/main.tsx`, `package.json` | Build pipeline unchanged. New renderers + history browser compile into the same single artifact. |
| `BlockShell` comment affordance + envelope emission + `loadDocument`/`loadPreviousDocument` seams | `src/editor/blocks.tsx`, `src/editor/App.tsx`, `src/editor/envelope.ts`, `src/editor/loader.ts` | The `BlockShell` wrapper and per-block dispatcher (`BlockRenderer` switch, line 521) are the extension point for new renderers. `/api/plan/versions` + `/api/plan/version?v=N` (`buildPlanApiHandlers`, exit.mjs:725) already expose a versions list — the multi-revision browser builds on this existing API shape. |
| `/planos-plan` self-contained command pattern + AC-17 boundary note | `plugin/commands/planos-plan.md`, `docs/notes/planos-plan-command.md` | `/planos-prd` mirrors this two-phase (interview → author) structure verbatim, swapping the v1 schema block for v2 and adding the persistence/boot step. |

### GENUINELY NEW for Phase 2

| New asset | Proposed location | Purpose |
|---|---|---|
| v2 block kinds in the validator | `src/schema/validate.mjs` (extend `KIND_VALIDATORS`, add `V2_KINDS`) | `phase, tradeoff, fileChange, code, table, diagram` field validation |
| v2 schema type surface | `src/schema/types.d.ts`, mirrored in `src/editor/types.ts` | TS types for the 6 new kinds + `type: "prd"` document |
| `/planos-prd` slash command | `plugin/commands/planos-prd.md` | Two-phase PRD interview → v2 block authoring → boots blocking server |
| PRD-mode handler (boots server directly, not via `ExitPlanMode`) | `src/hook/prd.mjs` (NEW), dispatched by `plugin/bin/planos` (`prd` subcommand) | The command → blocking CLI round-trip; reuses `startServer` + `buildDecision` + envelope |
| PRD persistence layer | `src/prd/store.mjs` (NEW) | On-disk PRD dir, per-topic revision chaining keyed by document `id` + `meta.revision` |
| v2 SPA renderers | `src/editor/blocks.tsx` (6 new `*View` components + dispatcher cases) | Render `phase/tradeoff/fileChange/code/table/diagram` |
| Mermaid rendering decision + impl | `src/editor/` (TBD — see Open Decision D3) | `diagram.mermaid` rendering (or escape-hatch) |
| Multi-revision history browser UI | `src/editor/history.tsx` (NEW) + `App.tsx` wiring | Browse/select all persisted revisions of a PRD, diff any pair |
| PRD versions API | extend `buildPlanApiHandlers` or new `buildPrdApiHandlers` in `src/hook/prd.mjs` | Serve the full persisted revision chain (not just current+prev) |
| v2 EnterPlanMode-equivalent injection | new `src/hook/prd.mjs` schema-injection text (NOT a hook — embedded in the command prompt) | v2 schema + worked example + ID rules for the PRD interview |
| Phase 2 ADR(s) | `docs/adr/0002-prd-persistence.md` (+ `0003-*` if needed) | Records the persistence-layout decision once signed off |
| Phase 2 test suites | `tests/prd-*.test.mjs`, `tests/v2-schema.test.mjs`, fixtures under `tests/fixtures/` | v2 validation, persistence, round-trip, history browser, AC-17 re-assertion |

---

## 3. v2 Block Schemas (precise — per design.md §4 lines 143-149)

Every v2 block, like v1, has `id: string` (stable, opaque per ADR-0001) and `kind: string`. Validator additions go in `src/schema/validate.mjs` as new entries in `KIND_VALIDATORS` plus a `V2_KINDS` frozen list; the document validator accepts v1∪v2 kinds when `type: "prd"`.

| kind | Required fields | Optional | Validator rule (mirrors validate.mjs style) | Diff `TEXT_FIELDS` | SPA renderer |
|---|---|---|---|---|---|
| `phase` | `id`, `kind`, `title: string`, `taskIds: id[]` (string[] of block ids) | — | `requireString(title)`; `checkStringArray(taskIds)`; (soft) referential note that ids should resolve to `task` blocks — NOT a hard validator error (agent authors ids; mirror v1 `task.deps` which is also unchecked) | `["title"]` | `PhaseView`: title + ordered list of referenced task titles (resolve via `byId`) |
| `tradeoff` | `id`, `kind`, `axis: string`, `options: {label: string, score?: number, note?: string}[]` (≥1) | — | `requireString(axis)`; array non-empty; per option `label` non-empty string, `score` integer-or-number when present, `note` string when present (mirror v1 `decision.options` validation, validate.mjs:210) | `["axis"]` | `TradeoffView`: axis + option cards with score bar |
| `fileChange` | `id`, `kind`, `path: string`, `action: "add"\|"modify"\|"delete"`, `rationale: string` | — | `requireString(path)`; `checkEnum(action, ["add","modify","delete"])`; `requireString(rationale)` | `["path","rationale"]` | `FileChangeView`: action badge + path (mono) + rationale |
| `code` | `id`, `kind`, `lang: string`, `content: string` | `filename?: string` | `requireString(lang)`; `content` must be string (allow empty — `isString` not `isNonEmptyString`); `filename` string when present | `["content"]` (word-diff over code text) | `CodeView`: `<pre>` block, optional filename header, lang label; NO syntax-highlight dep (zero-dep constraint) |
| `table` | `id`, `kind`, `columns: string[]`, `rows: string[][]` | — | `checkStringArray(columns)`; `rows` is array; each row is `string[]`; **recommended soft check**: each row length == columns length surfaced as a field-level error string (agent-correctable via deny loop) — see Open Decision D5 | none (structural equality handles it) | `TableView`: HTML table |
| `diagram` | `id`, `kind`, `mermaid: string` | — | `requireString(mermaid)` | `["mermaid"]` | `DiagramView`: see Open Decision D3 (render vs escape-hatch) |

### Schema engine extension points (exact)

- `src/schema/validate.mjs:16` — add `export const V2_KINDS = Object.freeze([...])`; keep `V1_KINDS` intact.
- `src/schema/validate.mjs:100` — add 6 entries to `KIND_VALIDATORS` (same `(b, path, errors)` signature, same `requireString`/`checkEnum`/`checkStringArray` helpers — zero new helper code expected except a `checkNumber` if `tradeoff.score` needs it).
- `src/schema/validate.mjs:312` — `validateBlock` already looks up `KIND_VALIDATORS[block.kind]`; new kinds are picked up automatically. Update the "not a valid v1 kind" message to reflect v1∪v2 when `type==="prd"`.
- `src/schema/validate.mjs:389` — `DOC_TYPES` already contains `"prd"`; add a gate so v2 kinds are only accepted for `type:"prd"` documents (plan-mode v1 docs must NOT silently accept v2 kinds — keeps the plan loop's contract tight). This is a deliberate scoping rule, surfaced as Open Decision D5.
- `src/diff/structural.mjs:38` — add 6 entries to `TEXT_FIELDS` (only kinds with text-bearing fields; `table` intentionally omitted — structural equality is correct for it).
- `src/diff/reanchor.mjs` — extend its primary-text-field map for the 6 v2 kinds (same pattern as `id-strategy.mjs PRIMARY_TEXT_FIELD`, line 107).
- `src/editor/types.ts` + `src/schema/types.d.ts` — add the 6 interfaces + extend the `Block` union; `BlockRenderer` switch (`blocks.tsx:521`) gets 6 new cases (the `_never` exhaustiveness guard at line 549 will force-compile-error until all 6 are added — a built-in correctness gate).
- `src/schema/envelope.mjs` — **no change**: `editBlock`/`addBlock` carry opaque `patch`/`block`; the envelope never enumerates kinds.

---

## 4. The `/planos-prd` Entry Path (command → blocking CLI, NOT a hook)

### Topology (mirrors `/planos-plan` two-phase, design.md §3 line 105)

```
User types /planos-prd [topic]
      ↓
Claude Code loads plugin/commands/planos-prd.md  (self-contained prompt asset)
      ↓
Phase 1: Socratic PRD interview IN THE CLI (live agent)   ← legitimate live-agent surface
      ↓                                                      (mirrors planos-plan; AC-17-allowed)
Phase 2: Agent authors a v2 PRD block document JSON        ← still in the agent loop, pre-server
      ↓
Agent runs the blocking round-trip via:  bin/planos prd    ← NEW dispatch; boots server DIRECTLY
      ↓                                                       (NO ExitPlanMode, NO PermissionRequest)
src/hook/prd.mjs handlePrd():
   - read authored doc (stdin or arg — see D4 handoff mechanism)
   - validate as v2 PRD (degradeToProse fallback reused)
   - load prior persisted revision for diff base
   - startServer() → real SPA + history browser + /api/prd* handlers
   - BLOCK on decisionPromise
   - approve → persist new revision, emit success; revise → buildReviseMessage (reused)
   - flush-then-exit-0 (reused server.finish())
```

### Why a command, not a hook (design.md §3 line 105 is explicit)

PRD authoring is NOT plan mode — there is no `ExitPlanMode` tool call to intercept. The `PermissionRequest`/`ExitPlanMode` hook in `plugin/hooks/hooks.json` is plan-mode-only and stays untouched. PRD mode reaches the same `startServer()` round-trip through a new `bin/planos prd` subcommand (added to the `switch` in `plugin/bin/planos`, currently lines with `enter`/`exit`/`default`).

### AC-17 invariant for PRD mode (RE-ASSERTED, not weakened)

The Phase 1 invariant is **"no model call inside the blocking server-round-trip path."** It applies identically here:

- **Allowed (live-agent, pre-server):** the `/planos-prd` Phase 1 Socratic interview and Phase 2 authoring run in the CLI agent loop *before* `bin/planos prd` boots the server — identical posture to `/planos-plan` (`docs/notes/planos-plan-command.md` lines 61-63). This is the legitimate live-agent surface.
- **Forbidden (blocking path):** `bin/planos prd` → `src/hook/prd.mjs` → `src/server/` → `src/schema/` → `src/diff/` → `src/prd/store.mjs` must contain zero network egress, zero agent spawn, zero agent-SDK in the transitive import graph. `src/prd/store.mjs` is filesystem-only (`node:fs`/`node:path`) — it joins the AC-17-audited transitive set.
- **Verification:** `tests/ac17-invariant.test.mjs` is extended with a second entrypoint (`bin/planos prd`) for both the runtime network/spawn interceptor and the static import-graph walk. The persistence layer's `node:fs` writes are explicitly in-scope-allowed (filesystem ≠ network/model, same boundary logic as the browser-opener note in `exit.mjs:601-617`).

---

## 5. PRD Persistence (on-disk, per-topic revision chaining)

### What is fixed vs what is an Open Decision

**Fixed by design.md + Phase 1 mechanics:**
- Revision chaining is keyed by the document `id` (the §4 "revision-chain key", already enforced as a stable non-empty string by `validate.mjs:397`) plus `meta.revision: int` (monotonic, already validated `validate.mjs:344`). This is the SAME chaining model the plan loop already uses for its current/previous diff base (`buildPlanApiHandlers`, exit.mjs:725) — Phase 2 generalizes 2-revision to N-revision.
- Each approved round-trip writes a new immutable revision record; `meta.revision` increments; prior revisions are never mutated (append-only history — the multi-revision browser depends on this).
- The persistence layer is pure `node:fs`/`node:path` (AC-17-clean).

**OPEN DECISION D1 (recommended option stated; needs human sign-off):** exact on-disk location, file format, and git disposition.

- **Option A (RECOMMENDED): `prds/<doc-id>/rNNN.json` + `prds/<doc-id>/latest.json`, committed to git.**
  - One directory per PRD (keyed by stable doc `id`), one JSON file per revision (`r001.json`, `r002.json`, …), `latest.json` (or a symlink-free pointer file) for fast "current". Canonical JSON via the existing `canonicalize` ordering (`structural.mjs:60`) for stable diffs.
  - Pros: human-diffable in PR review (the whole point of planos is reviewable artifacts); revision history survives in version control; trivially serves the multi-revision browser by directory scan; mirrors design.md §8's `prds/`-style dir and plannotator's on-disk version-history precedent (design.md §2). 
  - Cons: PRD JSON in git history can be noisy; large `code`/`diagram` blocks bloat the repo over many revisions.
- **Option B: same layout but gitignored (local-only, like plannotator's local version store).**
  - Pros: no repo noise; matches design.md §1 non-goal "no cloud/upload in v1".
  - Cons: history is lost on clean checkout / not shareable in review — undercuts the "structured artifact as the reviewable deliverable" thesis.
- **Option C: single append-only `prds/<doc-id>.jsonl` (one revision per line).**
  - Pros: one file per PRD, atomic append, compact.
  - Cons: less human-diffable per-revision; harder to eyeball in a PR than discrete files.

Recommended: **Option A, committed**, because planos's core value is a reviewable structured artifact and PR-visible PRD history maximizes that; the bloat con is mitigated (PRDs are revised in bursts, not continuously, and `code` blocks are bounded). D1 is a genuine human call (repo-noise tolerance is org-specific).

### Persistence module API (proposed, `src/prd/store.mjs`)

- `prdPath(rootDir, docId)` → resolved per-PRD dir (path-traversal-safe: reject `..`/absolute in `docId`).
- `loadLatest(rootDir, docId)` → `{ doc, revision } | null`.
- `loadRevision(rootDir, docId, n)` → `doc | null`.
- `listRevisions(rootDir, docId)` → `[{ revision, createdAt }]` (newest-first).
- `saveRevision(rootDir, doc)` → writes `r<NNN>.json` (NNN = `doc.meta.revision`) + updates `latest.json`; refuses to overwrite an existing revision number (append-only invariant); returns the written path. Pure fs; no clock except passing through the doc's own `createdAt`.

---

## 6. Acceptance Criteria ([H] harness / [M] manual / [D] doc)

Mirrors Phase 1 rigor and tag discipline. Verification strategy is the same: harness-asserted where mechanizable, doc artifacts for decisions, scripted manual smoke for live-agent/browser surfaces.

### v2 schema (validator + diff + types)
- **AC-P1** `[H]` Validator accepts every v2 kind (`phase, tradeoff, fileChange, code, table, diagram`) with valid field shapes and rejects each malformed shape with a field-level error string suitable for the deny→revise preamble (extends `tests/schema.test.mjs` pattern, asserting on the exact error path text).
- **AC-P2** `[H]` A `type:"plan"` document containing a v2 kind is REJECTED (v2 kinds are PRD-scoped — keeps the plan loop contract tight); a `type:"prd"` document accepts v1∪v2 kinds. (Pending D5.)
- **AC-P3** `[H]` `degradeToProse` fallback still produces exactly one `prose` block + `meta.degraded=true` for malformed PRD input (AC-7 property re-asserted for the PRD path; deterministic, 100%).
- **AC-P4** `[H]` Structural diff classifies v2 blocks correctly: text-field changes → `modified` with word-diff over the v2 `TEXT_FIELDS`; non-text v2 field changes (e.g. `tradeoff.options[].score`, `table.rows`) → `modified` via structural equality; reorder → `moved`. Asserted against a forced-revise v2 fixture with known classifications (extends `tests/diff.test.mjs`).

### `/planos-prd` command + PRD round-trip
- **AC-P5** `[M]` `/planos-prd [topic]` runs a one-question-at-a-time Socratic PRD interview in the CLI, produces a crystallized PRD intent summary, authors a valid v2 PRD doc, boots the blocking server (no `ExitPlanMode`), opens the browser. Verified with topic arg and empty arg (mirrors `planos-plan-command.md` Scenario A/B).
- **AC-P6** `[M]` Graceful interruption ("skip"/"just build it"/one-word) → reduced-clarity summary → minimal valid v2 PRD doc → server still boots, browser opens, no crash/loop (mirrors AC-16 / Scenario C).
- **AC-P7** `[H]` `bin/planos prd` round-trip: reads the authored doc, validates/degrades, boots `startServer`, blocks on `decisionPromise`, on approve persists a revision and emits success JSON, on revise emits `buildReviseMessage` output (directive + echo table + canonical JSON), honors flush-then-exit-0 (extends `tests/exit-roundtrip.test.mjs` pattern with an injected decision provider — the SCRIPTED seam is reused).
- **AC-P8** `[H]` `baseRevision` race guard fires on the PRD round-trip identically to the plan loop (reuses `checkBaseRevision`; assert stale-ops rejection + re-render signal).

### Persistence + multi-revision history
- **AC-P9** `[H]` `saveRevision` writes the chosen layout (per D1); `loadLatest`/`loadRevision`/`listRevisions` round-trip byte-stable canonical JSON; append-only invariant enforced (refuses to overwrite an existing revision number); path-traversal rejected for hostile `docId`.
- **AC-P10** `[H]` Two successive approved PRD round-trips for the same topic produce `r001`+`r002` with monotonic `meta.revision`, shared doc `id`, and a correct structural diff between them computed by the existing `diffDocuments`.
- **AC-P11** `[M]` Multi-revision history browser: the SPA lists all persisted revisions, lets the reviewer select any revision as the view and any earlier revision as the diff base, and renders the structural diff (extends the existing `/api/plan/versions` + revision-selector shape; scope per Open Decision D2).
- **AC-P12** `[H]` `/api/prd/versions` returns the full persisted chain (not just current+prev) and `/api/prd/version?v=N` serves any revision; read-only, no egress.

### SPA v2 renderers
- **AC-P13** `[M]` SPA renders all 6 v2 kinds with kind-appropriate UI inside the existing `BlockShell` (comment affordance works on every v2 block); manual demo per kind (extends `tests/editor-render.test.mjs` for the non-visual assertions).
- **AC-P14** `[H]`/`[M]` `diagram` rendering behaves per the D3 decision (asserted: if escape-hatch, the raw mermaid is shown in a `<pre>` and never crashes the SPA; if rendered, the offline/zero-dep constraint is documented as satisfied or explicitly waived).

### Invariant + verification
- **AC-P15** `[H]` AC-17 RE-ASSERTED for the new blocking entrypoint: `tests/ac17-invariant.test.mjs` extended so `bin/planos prd` → `src/hook/prd.mjs` → `src/prd/store.mjs` + transitive set has zero network egress, zero agent spawn, zero agent-SDK import (runtime interceptor + static import-graph walk, same two layers as Phase 1). Filesystem writes are explicitly in-scope-allowed.
- **AC-P16** `[D]` `docs/adr/0002-prd-persistence.md` records the D1 persistence-layout decision (chosen option, rationale, consequences, git disposition) once signed off. Additional ADRs for any D3/D5 resolution that warrants one.
- **AC-P17** `[H]` Committed-artifact drift check (Phase 1 AC-20 remediation pattern, consensus plan §5 last row): rebuild `plugin/dist/index.html` and assert byte-identical to committed after the v2 renderers + history browser land.
- **AC-P18** `[D]` No-Phase-2-ID-re-measurement justification recorded: ADR-0001 chose `opaque` *specifically* because it is rename-stable under heavy title churn (ADR-0001 rationale #2 explicitly names "Phase 2+ PRD mode" title edits); the §6 falsifier already passed at 1.000 with the full mechanism set. v2 introduces no new ID-generation surface (IDs remain agent-minted opaque tokens; the deny-echo table in `renderEchoTable` is kind-agnostic). Therefore Phase 2 does NOT re-run the Milestone-1 ID gate. Semantic-slug's untested title-churn risk is irrelevant unless semantic-slug is reconsidered (it is not). This is a documented reasoned waiver, not an omission.

> 18 criteria: 11 `[H]`, 2 `[D]`, 4 `[M]`, 1 mixed `[H]/[M]`. ≥80% concrete/testable, mirroring Phase 1's ratio.

### Verification strategy (consistent with Phase 1 §6)
1. Per-milestone harness gate; v2 schema milestone is the first hard gate (everything downstream depends on the validator).
2. Acceptance traceability: every AC → `[H]` assertion, `[D]` artifact, or scripted `[M]` smoke.
3. AC-17 re-assertion is a distinct verification pass (separate lane — not self-approved by the authoring context), per the global "separate review pass" rule.
4. Offline verification: full PRD round-trip with network disabled; assert zero egress from `bin/planos prd`.
5. Live-session smoke: install via marketplace, run `/planos-prd` end-to-end, approve → confirm a persisted revision file appears in the chosen layout, run again → confirm `r002` + diff.
6. **No ID re-measurement** (AC-P18 reasoned waiver) — explicitly NOT re-running Milestone 1.

---

## 7. Milestones (dependency order, file-level work units)

### Milestone P0 — v2 schema engine (HARD GATE — everything depends on it)
- **P0.1** Extend `src/schema/validate.mjs`: add `V2_KINDS`, 6 `KIND_VALIDATORS` entries, `type:"prd"` gating for v2 kinds (D5), updated invalid-kind message. Add `checkNumber` helper only if `tradeoff.score` needs it.
- **P0.2** Extend `src/schema/types.d.ts` + `src/editor/types.ts`: 6 interfaces + `Block` union + `type:"prd"`.
- **P0.3** Extend `src/diff/structural.mjs` `TEXT_FIELDS` and `src/diff/reanchor.mjs` primary-text map for v2.
- **P0.4** Tests: `tests/v2-schema.test.mjs`, extend `tests/diff.test.mjs` + `tests/reanchor.test.mjs` with v2 fixtures.
- Gate: AC-P1, AC-P2, AC-P3, AC-P4.

### Milestone P1 — PRD persistence layer
- **P1.1** Create `src/prd/store.mjs` (D1 layout; append-only; path-safe). Pure `node:fs`.
- **P1.2** Tests: `tests/prd-store.test.mjs`.
- Gate: AC-P9, AC-P10 (diff half).

### Milestone P2 — PRD round-trip handler (boots server directly)
- **P2.1** Create `src/hook/prd.mjs` `handlePrd()`: reuse `readStdin`/`extractPlan`/`planToDocument`/`degradeToProse`/`startServer`/`buildDecision`/`buildReviseMessage`/`renderEchoTable` from `exit.mjs` (refactor shared internals into an importable module if needed — minimal, no behavior change); add persistence on approve; add `buildPrdApiHandlers` (full chain).
- **P2.2** Add `prd` case to `plugin/bin/planos` switch.
- **P2.3** Tests: `tests/prd-roundtrip.test.mjs` (SCRIPTED decision-provider seam reused).
- Gate: AC-P7, AC-P8, AC-P10 (round-trip half), AC-P12.

### Milestone P3 — `/planos-prd` command (self-contained)
- **P3.1** Create `plugin/commands/planos-prd.md`: two-phase prompt (Socratic PRD interview → v2 authoring → invoke `bin/planos prd`), self-contained, graceful-interruption section (mirror `planos-plan.md` verbatim structure, swap v1→v2 schema block + add the boot step).
- **P3.2** Create `docs/notes/planos-prd-command.md` AC-17 boundary note (mirror `planos-plan-command.md`).
- **P3.3** Tests: `tests/planos-prd-command.test.mjs`, `tests/planos-prd-interrupt.test.mjs`.
- Gate: AC-P5, AC-P6.

### Milestone P4 — SPA v2 renderers + multi-revision history browser
- **P4.1** Add 6 `*View` components + dispatcher cases in `src/editor/blocks.tsx` (exhaustiveness guard forces completeness). Resolve `diagram` per D3.
- **P4.2** Create `src/editor/history.tsx` + wire into `App.tsx` (revision list, view-selector, diff-base-selector) on the existing `loadDocument`/`loadPreviousDocument` + versions-API shape, generalized to N revisions (D2 scope).
- **P4.3** Rebuild + commit `plugin/dist/index.html`.
- **P4.4** Tests: extend `tests/editor-render.test.mjs`; drift check.
- Gate: AC-P11, AC-P13, AC-P14, AC-P17.

### Milestone P5 — AC-17 re-assertion + exit gate
- **P5.1** Extend `tests/ac17-invariant.test.mjs` for `bin/planos prd` (runtime + static layers).
- **P5.2** Full Phase 2 harness run; offline verification; live-session smoke (persist → re-run → diff).
- **P5.3** Write `docs/adr/0002-prd-persistence.md` (+ any D3/D5 ADR); record AC-P18 waiver.
- Gate: AC-P15, AC-P16, AC-P18; all 18 AC green.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Larger v2 schema strains the agent's first-try valid rate | M | M | Reuse the proven deny→revise corrective loop (kind-agnostic `buildReviseMessage`/echo table); `prose` remains a valid escape hatch; v2 worked example in the command prompt. First-try tracked, not gated (Phase 1 precedent). |
| Sharing `exit.mjs` internals with `prd.mjs` causes regression in the plan loop | M | H | Refactor shared pure functions into an importable module with ZERO behavior change; existing `tests/exit-*.test.mjs` are the regression guard and must stay green before P2 merges. Authoring vs verification kept as separate passes. |
| AC-17 accidentally violated by the new `bin/planos prd` path | L | H | AC-P15 extends the existing two-layer interceptor + import-graph walk to the new entrypoint; `src/prd/store.mjs` is fs-only by construction; filesystem-vs-network boundary documented (same logic as the exit.mjs browser-opener note). |
| `diagram.mermaid` rendering pulls a runtime dep, breaking zero-dep/offline | M | M | D3 default = escape-hatch (`<pre>` raw mermaid), zero new deps; full rendering only if a bundled-at-build-time (not runtime) path is proven and signed off. |
| Persistence layout wrong / churns the repo (D1) | M | M | D1 surfaced as an explicit Open Decision with a recommended option; ADR-0002 records the signed-off choice before P1 implements; append-only + canonical-JSON keeps diffs minimal. |
| PRD revision chain corrupted by overwrite/race | L | H | `saveRevision` is append-only and refuses to overwrite an existing revision number; `baseRevision` race guard (AC-P8) reused from Phase 1. |
| Committed `plugin/dist/index.html` drifts after new renderers | M | L | AC-P17 byte-identical rebuild check (Phase 1 remediation pattern) in the harness + before release. |
| Scope creep into Phase 3 (diff-review / `diagram` overlap with `diff` kind) | L | M | Phase 3 (`/planos-review`, v3 `diff` kind) is an explicit Non-Goal here; `diagram` is v2-only and unrelated to the v3 `diff` block. |
| Re-measuring ID stability for v2 wastefully (or skipping it unsafely) | L | M | AC-P18 documents the reasoned waiver: `opaque` was chosen *for* Phase 2 title churn (ADR-0001 rationale #2); no new ID surface; falsifier already passed at 1.000. Reasoned waiver, not omission. |

---

## 9. Non-Goals (Phase 2)

No `/planos-review` / diff-review mode; no v3 `diff` block kind; no `gh`/git PR ingestion; no hosted service / cloud / upload / share links; no multi-user/real-time collab; no Bun single-binary; no markdown/PDF export or themes; no plannotator hook-collision resolution (still deferred to Phase 4); no LLM in the blocking path; no live in-browser interviewer; **no re-running the Milestone-1 ID gate** (AC-P18 waiver); no change to the plan-mode `ExitPlanMode` hook.

---

## 10. Open Decisions for the User (require sign-off before execution)

**D1 — PRD persistence layout & git disposition.** (Recommended: Option A — `prds/<doc-id>/rNNN.json` + `latest.json`, committed to git; Option B = gitignored local-only; Option C = single `.jsonl` append-log.) The genuine call: how much PRD-revision noise in git history is acceptable for this org vs. the value of PR-visible reviewable PRD history. Blocks Milestone P1.

**D2 — Multi-revision history browser UX scope.** Minimum viable = revision list + pick-view + pick-diff-base + render existing structural diff (reuses everything). Richer options (timeline visualization, side-by-side full-doc compare, per-block revision blame, revision annotations/notes) are real scope expansions. Which scope ships in Phase 2? Affects Milestone P4 size.

**D3 — `diagram.mermaid` rendering.** Options: (a) escape-hatch — render raw mermaid source in a `<pre>` (zero-dep, offline, RECOMMENDED default); (b) bundle a mermaid renderer at build time into the single-file SPA (heavier artifact, must prove offline + size acceptable); (c) defer actual rendering to Phase 4 polish, validate+store the field now. Affects zero-dep/offline guarantee and `plugin/dist` size.

**D4 — PRD doc handoff mechanism from the command to `bin/planos prd`.** How does the agent-authored v2 JSON reach the blocking handler — via stdin pipe (mirrors the hook's stdin contract, reuses `readStdin`/`extractPlan`), a temp file path argument, or an env var? Stdin is the lowest-friction reuse but the command must instruct the agent to invoke `bin/planos prd` correctly. Affects `plugin/commands/planos-prd.md` + `src/hook/prd.mjs` ingestion. (Recommended: stdin, to maximize Phase 1 reuse — but the exact agent-invocation instruction needs human review since it is a new agent-driven shell invocation pattern.)

**D5 — v2 schema scoping & strictness ambiguities.** Three sub-decisions: (i) Are v2 kinds REJECTED in `type:"plan"` documents (recommended — keeps the plan loop contract tight) or allowed everywhere? (ii) Is `table` row/column-length mismatch a hard validator error or a soft surfaced note? (iii) Is `phase.taskIds` referential integrity (ids resolve to real `task` blocks) validator-enforced or left agent-authored like v1 `task.deps` (recommended — mirror existing v1 behavior, no runtime graph check in the blocking path)? Affects `src/schema/validate.mjs` and AC-P2.

**D6 — Gating rigor for v2 (optional but recommended to confirm).** Phase 1 froze numeric ID-stability bars because ID stability was the make-or-break unfalsifiable risk. Phase 2's risk profile is different (no new ID surface; the falsifier already passed). Confirm: Phase 2's exit gate is the 18-AC harness/doc/manual set in §6 with NO new frozen numeric bar and NO ID re-measurement (AC-P18 waiver). Sign-off requested that this lighter-but-rigorous gate is acceptable for Phase 2, or specify any additional numeric bar desired.

---

## Resolved Decisions (user sign-off 2026-05-16)

- **D1 → Option A (committed).** PRD docs persist at `prds/<doc-id>/rNNN.json`
  (zero-padded revision) + `prds/<doc-id>/latest.json`, **committed to git**.
  Reviewable, PR-visible PRD history; revision number tracks `meta.revision`.
  (User: "go ahead and investigate" → take the recommended reviewable layout.)
- **D2 → Minimal.** Revision list + pick-to-view + pick-diff-base, reusing the
  Phase-1 `src/diff/structural.mjs` engine. No timeline/blame/side-by-side.
- **D3 → Bundle mermaid.** Bundle a mermaid renderer at SPA build time so
  `diagram` blocks render visually. Constraints: runtime stays fully offline
  (no CDN/network — renderer is inlined into the single-file `plugin/dist`),
  `plugin/dist/index.html` size grows (documented + asserted within a sane
  cap), and it is SPA-side ONLY — NOT reachable from `bin/planos exit|prd`
  blocking path, so AC-17 import-graph stays CLEAN (re-verify after build).
- **D4 → stdin.** `/planos-prd` instructs the agent to pipe the authored v2
  JSON into `bin/planos prd` via stdin, reusing `readStdin`/`extractPlan`.
- **D5 → (i) reject v2 kinds in `type:"plan"` docs; (ii) `table` row/column
  mismatch = hard validator error; (iii) `phase.taskIds` agent-authored like
  v1 `task.deps` (no blocking-path referential graph check).**
- **D6 → Lighter-but-rigorous gate.** Phase 2 exit = the 18-AC harness/doc/
  manual set + full offline suite green + `tsc` clean + AC-17 import-graph
  CLEAN. NO new frozen numeric bar, NO live ID re-measurement (AC-P18 waiver:
  opaque IDs already proven; no new ID surface).

Execution may proceed on these. Milestone order per §7; verify (suite + tsc +
AC-17) between milestones; keep the single-file offline build invariant.
