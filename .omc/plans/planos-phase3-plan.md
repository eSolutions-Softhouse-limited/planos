# Work Plan: planos — Phase 3 (Diff Review Mode + v3 `diff` Block Kind + gh/git Ingestion + Structured Review Envelope)

- Plan ID: planos-phase3-plan
- Generated: 2026-05-16
- Revision: 1 (planning only — pending approval; not yet consensus-reviewed)
- Status: PLANNING ONLY — no implementation
- Sources of truth: `docs/design.md` (§3 three-entry-modes/one-engine, §4 schema incl. v3 `diff` block at lines 151-153 + `Edit` union, §7 doc-revision structural diff, §9 Phase 3 scope, §10 risks), `docs/adr/0000-validator-choice.md`, `docs/adr/0001-block-id-scheme.md`, `docs/adr/0002-prd-persistence.md`, `.omc/plans/planos-phase2-plan.md` (structure mirrored EXACTLY), `docs/notes/plannotator-coexistence-spike.md` (refuse-on-collision posture, Phase-4 scope), and the real Phase 1+2 source under `src/`, `plugin/`, `tests/`
- Mode: standard plan (RALPLAN-DR not run — this is a draft for human sign-off + consensus pass)
- Repo: Phase 1 (plan-mode loop + ADR-0001 ID de-risk) and Phase 2 (PRD mode + v2 vocab + persisted revisions) COMPLETE, verified, committed; HEAD `b4dd894`, branch `main`, tree clean

---

## 1. Context

Phase 1 proved the structured-artifact loop and falsified-clear the §6 block-ID-stability risk (ADR-0001: `opaque` is `PRODUCTION_DEFAULT_STRATEGY`, 1.000 live preservation). Phase 2 added the **second** of the three design.md §3 entry modes — PRD mode — via a command→blocking-CLI seam (`bin/planos prd`), the full v2 block vocabulary, and append-only persisted multi-revision history, with AC-17 RE-ASSERTED for the new entrypoint (ADR-0002). Phase 3 adds the **third and final** entry mode — **Diff Review mode** — without disturbing the plan-mode hook loop or the PRD command path.

Phase 3 delivers exactly what design.md §9 scopes: a `/planos-review [PR# | git range]` slash **command** that boots the blocking server **directly** (command → blocking CLI, the EXACT mirror of Phase 2's `bin/planos prd`, NOT an `ExitPlanMode` PermissionRequest hook), the new **v3 `diff` block kind** (design.md §4 lines 151-153: `diff { id, kind, path, hunks: Hunk[], comments: BlockComment[] }`), **`gh` PR + local `git` range ingestion** that turns a code diff into `diff` blocks, **per-hunk comment/accept/reject** in the SPA, and a **structured review envelope** back to the agent.

The architectural seam is fully proven and present three times over: `src/hook/exit.mjs handleExit()` (plan mode), `src/hook/prd.mjs handlePrd()` (PRD mode), and now a fourth caller of the same `startServer()` round-trip reached from the `bin/planos` `review` subcommand. Every reuse point Phase 2 established is reused again: `src/hook/roundtrip.mjs` (`readStdin`/`extractPlan`), `planToDocument`/`buildDecision`/`buildReviseMessage`/`renderEchoTable`/`toPermissionRequestOutput`/`buildSpaHtml`/`openBrowserReal`/`startServer` from `exit.mjs`, the structural-diff + reanchor engines, the FeedbackEnvelope validator + `baseRevision` race guard, the opaque ID scheme + §6 mechanisms, the single-file SPA build, and the `BlockShell`-wrapped `BlockRenderer` exhaustiveness guard.

**The "is there a model in the blocking path" question (AC-17) recurs here and is the single most important design question of Phase 3.** Phases 1 and 2 answered it the same way: the pre-server interview/authoring is a *legitimate live-agent CLI surface that runs before the server boots*. Phase 3 introduces a genuinely new wrinkle: **`gh` and `git` are subprocesses that touch the network and the repository.** The diff must be ingested somewhere. Resolving precisely where ingestion runs — in the pre-server CLI agent loop (like the Socratic interview) versus inside the blocking `bin/planos review` path — is treated as the **headline Open Decision (R1)** with a recommended option and full rationale (§4, §10). AC-17 is RE-ASSERTED for the new `bin/planos review` entrypoint, not weakened.

The detect-and-refuse plannotator posture (`src/hook/coexistence.mjs`, ADR/spike) is unchanged and **not extended**: it guards the `ExitPlanMode` PermissionRequest hook only; the `review` command path, like the `prd` command path, never touches that hook. Phase-4 coexistence work stays out of scope.

---

## 2. Reused from Phase 1/2 vs Genuinely New for Phase 3

### REUSED AS-IS (zero or near-zero change)

| Asset | File(s) | Why reusable unchanged |
|---|---|---|
| Hand-rolled validator engine + error-string discipline + `V1_KINDS`/`V2_KINDS`/`KIND_VALIDATORS`/`DOC_TYPES` | `src/schema/validate.mjs` | ADR-0000 anticipated growth ("revisit only if the schema grows materially in Phase 2+"); the v2 expansion already proved the pattern. `KIND_VALIDATORS` (line 136) and the per-kind helpers (`requireString`/`checkEnum`/`checkStringArray`/`checkNumber`) are the open extension point. `DOC_TYPES` (line 47) **already includes `"diff-review"`**. The `validateBlock` doc-type-scoped gate (lines 457-505) is already a two-tier (v1 / v1∪v2) mechanism — Phase 3 adds a third tier. |
| Command→blocking-CLI round-trip handler shape | `src/hook/prd.mjs` (the EXACT pattern to mirror) | Phase 2's `handlePrd()` is the proven template: SCRIPTED vs REAL-SPA seam, `readStdin`/`extractPlan` ingestion, `planToDocument`, `startServer`, `buildDecision`, `toPermissionRequestOutput`, flush-then-exit-0. Phase 3's `handleReview()` is the same shape with a review-specific decision payload and (decision R2) optional persistence. |
| Shared stdin internals | `src/hook/roundtrip.mjs` (`readStdin`, `extractPlan`) | Already extracted VERBATIM in Phase 2 P2; reused unchanged for the review handler's stdin handoff (R4 = stdin, mirrors D4). |
| `handleExit` engine internals: `planToDocument`, `degradeToProse` (via barrel), `buildDecision`, `buildReviseMessage`, `renderEchoTable`, `toPermissionRequestOutput`, `buildSpaHtml`, `openBrowserReal`, `startServer` | `src/hook/exit.mjs`, `src/server/index.mjs`, `src/schema/index.mjs` | All exported and pure. `buildDecision` already handles the bare-envelope POST, malformed-envelope degrade, and the `baseRevision` race guard kind-agnostically — the review envelope rides the same path. |
| Structural doc-revision diff engine (outer ID pass + inner word diff + LCS move) | `src/diff/structural.mjs` | This is design.md §7's **document-revision** diff (added/removed/moved/modified blocks across revisions). It is kind-agnostic; only `TEXT_FIELDS` (line 38) needs a `diff`-kind entry. **It is NOT the code-diff that the v3 `diff` block holds** — that hunk data is opaque to this engine and diffs correctly via canonical structural equality. |
| Deterministic re-anchoring fallback | `src/diff/reanchor.mjs` | Defence-in-depth; AC-13 mechanism unchanged. Only its `PRIMARY_FIELD` map (line 92) needs a `diff`-kind entry. |
| FeedbackEnvelope validator + ops renderer + `baseRevision` race guard | `src/schema/envelope.mjs` | The §4 `Edit` union (`editBlock`/`deleteBlock`/`moveBlock`/`comment`/`answer`/`addBlock`) is block-kind-agnostic; `comment` carries `{blockId, text, anchor?}`. Whether accept/reject needs a new op variant is **Open Decision R5** (recommended: reuse `comment`/`editBlock`, NO new op). |
| Opaque ID scheme + §6 mechanisms + AC-17 two-layer enforcement | `src/schema/id-strategy.mjs`, `src/hook/exit.mjs:renderEchoTable`, `tests/harness/import-graph.mjs`, `tests/ac17-invariant.test.mjs` | ADR-0001 ACCEPTED; `opaque` rename-stable. NO Phase-3 ID re-measurement (AC-R-WAIVER, mirrors AC-P18). The `ac17Roots()` + two-layer test are the proven re-assertion mechanism (Phase 2 added prd roots; Phase 3 adds review roots identically). |
| Single-file SPA build (Vite + `vite-plugin-singlefile`, committed `plugin/dist/index.html` ≈3.25 MB, cap 4 MB) | `vite.config.*`, `src/editor/main.tsx`, `package.json` (`build:editor`) | Build pipeline unchanged. The new `diff` renderer compiles into the same single artifact. Byte-identical drift check (AC-P17 pattern) re-run on the SPA change. Bundled offline mermaid (D3) is unaffected. |
| `BlockShell` comment affordance + `BlockRenderer` switch + exhaustiveness guard | `src/editor/blocks.tsx` (line 856 switch, line 908 `_never` guard), `src/editor/types.ts`, `src/schema/types.d.ts` | The `_never: never` guard at `blocks.tsx:908` will force a compile error until a `case 'diff':` is added — a built-in completeness gate. The `Block` union in both type files gains a `DiffBlock` member. |
| PRD persistence layer (pattern only, if R2=persist) | `src/prd/store.mjs` (append-only, path-traversal-safe, canonical-JSON, `node:fs`-only) | If R2 decides reviews persist, a `src/review/store.mjs` mirrors this module's exact shape (`reviews/<doc-id>/rNNN.json` + `latest.json`). If R2 = ephemeral (recommended), no store module is built. |
| `/planos-prd` self-contained command + AC-17 boundary note + interrupt test pattern | `plugin/commands/planos-prd.md`, `docs/notes/planos-prd-command.md`, `tests/planos-prd-command.test.mjs`, `tests/planos-prd-interrupt.test.mjs` | `/planos-review` mirrors this verbatim two-phase structure: PR/range-grounding interview → ingest+author → pipe to `bin/planos review` via stdin. The boundary note mirrors `planos-prd-command.md` exactly. |
| AC-17 enforcement harness (static walk + runtime layers + smoke) | `tests/harness/import-graph.mjs` (`ac17Roots()`), `tests/ac17-invariant.test.mjs` (LAYER 2/2b), `tests/harness/prd-smoke.mjs` (deterministic gate pattern), `tests/harness/verify-exit-gate.mjs` (Phase-1 FROZEN gate, untouched) | Phase 3 extends `ac17Roots()` with the review entrypoint + transitive set, adds a LAYER 2c runtime test mirroring LAYER 2b, and adds `tests/harness/review-smoke.mjs` mirroring `prd-smoke.mjs`. FROZEN_BARS in `tests/harness/metrics.mjs` are NOT touched; the Phase-1 exit gate keeps passing. |

### GENUINELY NEW for Phase 3

| New asset | Proposed location | Purpose |
|---|---|---|
| v3 `diff` block kind in the validator | `src/schema/validate.mjs` (extend `KIND_VALIDATORS`, add `V3_KINDS`, add diff-review doc-type tier to `validateBlock`) | `diff { id, kind, path, hunks: Hunk[], comments: BlockComment[] }` + `Hunk` + `BlockComment` field validation |
| v3 schema type surface | `src/schema/types.d.ts`, mirrored in `src/editor/types.ts` | `DiffBlock`, `Hunk`, `BlockComment` interfaces + `Block` union extension + `type:"diff-review"` document |
| `/planos-review` slash command | `plugin/commands/planos-review.md` | Two-phase PR/range-grounding interview → `gh`/`git` ingestion → v3 diff-review block authoring → pipes to `bin/planos review` via stdin |
| Diff-review-mode handler (boots server directly, not via `ExitPlanMode`) | `src/hook/review.mjs` (NEW), dispatched by `plugin/bin/planos` (`review` subcommand) | The command → blocking CLI round-trip; reuses `startServer` + `buildDecision` + envelope; emits the structured review envelope |
| Diff-ingestion module (location decided by R1) | `src/review/ingest.mjs` (NEW) — see R1: SPA-side/agent-side normalizer vs blocking-path subprocess | Parses unified-diff text (from `gh pr diff` / `git diff <range>`) into `diff` blocks (path + hunks). **Recommended (R1): the pure unified-diff PARSER is in `src/review/ingest.mjs` and is text-in/blocks-out (no subprocess); the `gh`/`git` SUBPROCESS invocation lives in the command/agent layer, NOT the blocking path.** |
| v3 SPA `diff` renderer + per-hunk accept/reject/comment affordance | `src/editor/blocks.tsx` (1 new `DiffView` component + dispatcher case + exhaustiveness-guard satisfaction) | Render `diff` blocks: file path header, per-hunk unified-diff view, per-hunk accept/reject toggle + per-hunk comment |
| Review envelope emission from the SPA | `src/editor/envelope.ts` / `src/editor/envelope.impl.mjs` (extend; NO new op if R5=reuse) | Serialize per-hunk accept/reject + comments into the existing `FeedbackEnvelope` `ops[]` so `buildDecision` consumes it unchanged |
| Structured review envelope shape (handler output) | `src/hook/review.mjs` (a `ReviewRoundTrip` hookSpecificOutput, mirroring `PrdRoundTrip`) | The agent-facing structured review result: per-file/per-hunk verdicts + comments + overall decision |
| Review persistence layer (ONLY if R2 = persist) | `src/review/store.mjs` (NEW, mirrors `src/prd/store.mjs`) | `reviews/<doc-id>/rNNN.json` + `latest.json`, append-only, path-safe — built ONLY if R2 resolves to persist |
| `/planos-review` AC-17 boundary note | `docs/notes/planos-review-command.md` | Mirrors `docs/notes/planos-prd-command.md`; documents the gh/git-vs-AC-17 boundary explicitly |
| Phase 3 ADR | `docs/adr/0003-diff-review.md` | Records R1 (the gh/git/AC-17 boundary), R2 (persistence), R3 (ingestion mechanism), R4 (handoff), R5 (accept/reject semantics), R6 (large/binary handling), R7 (diff-review allowed-kinds), and the AC-R-WAIVER once signed off |
| Phase 3 test suites | `tests/v3-schema.test.mjs`, `tests/review-ingest.test.mjs`, `tests/review-roundtrip.test.mjs`, `tests/planos-review-command.test.mjs`, `tests/planos-review-interrupt.test.mjs`, `tests/harness/review-smoke.mjs`; extend `tests/diff.test.mjs`, `tests/reanchor.test.mjs`, `tests/editor-render.test.mjs`, `tests/ac17-invariant.test.mjs` | v3 validation, ingestion parsing, round-trip, command, interrupt, AC-17 re-assertion |

---

## 3. v3 `diff` Block Schema (precise — per design.md §4 lines 151-153)

design.md §4 only sketches `diff { id, kind, path, hunks: Hunk[], comments: BlockComment[] }`. This section specifies the precise field shapes (the schema IS the product — design.md §4). Every v3 block, like v1/v2, has `id: string` (stable, opaque per ADR-0001) and `kind: string`. Validator additions go in `src/schema/validate.mjs` as a new `KIND_VALIDATORS.diff` entry plus a `V3_KINDS` frozen list; the document validator accepts the `diff` kind **only** when `type: "diff-review"` (third gating tier — see R7 for which v1/v2 kinds are also allowed in a diff-review doc).

### 3.1 Precise field shapes

**`diff` block:**

| Field | Type | Required | Validator rule (mirrors `validate.mjs` style) |
|---|---|---|---|
| `id` | `string` (non-empty) | yes | existing `isNonEmptyString(block.id)` (validate.mjs:466) |
| `kind` | `"diff"` | yes | dispatched via `KIND_VALIDATORS` |
| `path` | `string` (non-empty) | yes | `requireString(b, "path", path, errors)` |
| `hunks` | `Hunk[]` (array, may be empty for a pure rename/binary stub) | yes | `Array.isArray`; each element validated as a `Hunk` (below); empty array allowed (binary/rename — R6) |
| `comments` | `BlockComment[]` | yes (may be empty `[]`) | `Array.isArray`; each element validated as a `BlockComment` (below); empty allowed |
| `status` | `"added"\|"modified"\|"deleted"\|"renamed"\|"binary"` | optional | when present, `checkEnum`; classifies the file-level change (parsed from the diff header; R6 covers binary/rename) |
| `oldPath` | `string` | optional | present only when `status==="renamed"`; `isString` when present |

**`Hunk` (nested object, validated by a `validateHunk(h, path, errors)` helper):**

| Field | Type | Required | Validator rule |
|---|---|---|---|
| `header` | `string` (the `@@ -a,b +c,d @@` line, may carry a section heading) | yes | `requireString` |
| `oldStart` | integer | yes | `isInteger` (field-level error if not) |
| `oldLines` | integer (≥0) | yes | `isInteger` and `>= 0` |
| `newStart` | integer | yes | `isInteger` |
| `newLines` | integer (≥0) | yes | `isInteger` and `>= 0` |
| `lines` | `DiffLine[]` (array, ≥0) | yes | `Array.isArray`; each element a `DiffLine` |
| `hunkId` | `string` (non-empty, stable within the block — the per-hunk anchor for accept/reject/comment) | yes | `isNonEmptyString`; **agent-/ingestion-minted, opaque, stable across revisions** exactly like block `id` (ADR-0001 mechanism applies recursively — see §3.4) |

**`DiffLine` (nested object, validated by `validateDiffLine`):**

| Field | Type | Required | Validator rule |
|---|---|---|---|
| `op` | `" "` (context) \| `"+"` (added) \| `"-"` (removed) | yes | `checkEnum(line, "op", [" ","+","-"], ...)` |
| `text` | `string` (the line content WITHOUT the leading op char; may be empty) | yes | `isString` (allow empty — `isString` not `isNonEmptyString`, mirrors `code.content` at validate.mjs:402) |

**`BlockComment` (nested object, validated by `validateBlockComment`):**

| Field | Type | Required | Validator rule |
|---|---|---|---|
| `commentId` | `string` (non-empty, stable) | yes | `isNonEmptyString` |
| `hunkId` | `string` (the `Hunk.hunkId` this comment anchors to) \| `null` (file-level comment) | yes | `isString` or `null` (file-level when null) |
| `text` | `string` (non-empty) | yes | `requireString` |
| `verdict` | `"accept"\|"reject"\|"comment"` | yes | `checkEnum(c, "verdict", ["accept","reject","comment"], ...)` — the per-hunk review verdict carried alongside the comment text (R5: reuse this shape; NO new envelope op) |

> Rationale for embedding `verdict` inside `BlockComment` rather than minting a new `Edit` op (R5, recommended): the FeedbackEnvelope `comment` op already carries `{blockId, text, anchor?}`. A hunk-level accept/reject is modeled as an `editBlock` op whose `patch` updates `comments` (adding/updating a `BlockComment` with the chosen `verdict`), so `src/schema/envelope.mjs` and `buildDecision` are reused **with zero new op discriminant**. The optional intra-block `anchor:{start,end}` on the `comment` op is repurposed as the line-range within a hunk if line-level (not just hunk-level) commenting is in scope (R5 sub-decision).

### 3.2 Validator extension points (exact)

- `src/schema/validate.mjs:38` — add `export const V3_KINDS = Object.freeze(["diff"]);` after `V2_KINDS` (line 31-38); keep `V1_KINDS`/`V2_KINDS` intact.
- `src/schema/validate.mjs:42` — add `const DIFF_REVIEW_KIND_LIST = V1_KINDS.concat(V3_KINDS).join("|");` (or v1∪v3, per R7) alongside `PRD_KIND_LIST`.
- `src/schema/validate.mjs:136` — add a `diff(b, path, errors)` entry to `KIND_VALIDATORS` plus three nested helpers (`validateHunk`, `validateDiffLine`, `validateBlockComment`) following the existing `decision`/`tradeoff` options-array pattern (validate.mjs:232-282 / 341-383). New helper code expected: a `checkIntegerField` (none exists; `isInteger` exists at line 54 but there is no `requireInteger`-style pusher — add one, ~8 lines, mirroring `checkNumber` at 121-133).
- `src/schema/validate.mjs:457` — `validateBlock` currently has a two-tier `isPrd` gate (lines 459-492). Add a third tier: `isDiffReview = docType === "diff-review"`; `validKindList` and the V3-kind-in-wrong-doc rejection (mirroring the `V2_KIND_SET` reject at lines 483-492) so `diff` is REJECTED outside `type:"diff-review"` and v2 kinds are REJECTED inside `type:"diff-review"` unless R7 widens it. Update the invalid-kind message (lines 494-502) to reflect the active tier.
- `src/schema/validate.mjs:572` — `DOC_TYPES` already contains `"diff-review"` (line 47); no change to `validateDocument` doc-type check needed. `validateMeta` is unchanged (`diff-review` docs carry the same `meta`).
- `src/diff/structural.mjs:38` — add `diff: ["path"]` to `TEXT_FIELDS` (only `path` is a stable text-bearing identity field; `hunks`/`comments` are structural — `table` precedent at line 46-48: structural equality is the correct change detector for nested array content). A revision that changes hunk content is correctly classified `modified` via `blocksEqual` canonical comparison.
- `src/diff/reanchor.mjs:92` — add `diff: ["path"]` to `PRIMARY_FIELD` (the file path is the most stable identity signal for a `diff` block, exactly mirroring the `fileChange: ["path"]` choice at line 106).
- `src/schema/types.d.ts` + `src/editor/types.ts` — add `DiffBlock`, `Hunk`, `DiffLine`, `BlockComment` interfaces; extend the `Block` union (currently 13 kinds → 14). The `_never` exhaustiveness guard at `blocks.tsx:908` force-compile-errors until `case 'diff':` is added — the built-in completeness gate.
- `src/schema/envelope.mjs` — **no change** (R5 recommended): `editBlock`/`comment` carry opaque `patch`/`text`; the envelope never enumerates block kinds. (If R5 sub-decision adds a dedicated op, this file gains one `EDIT_OPS` entry + one validator branch — surfaced in R5.)

### 3.3 `type:"diff-review"` document gating (mirror of D5-i)

- v3 `diff` kind is accepted **only** in `type:"diff-review"` documents (mirrors D5-i: v2 PRD-only). A `type:"plan"` or `type:"prd"` doc containing a `diff` block is REJECTED with a field-level error (the deny→revise preamble surfaces it).
- **Which v1/v2 kinds are also allowed in a diff-review doc — Open Decision R7.** Recommended: a diff-review doc accepts **v1∪v3** — `section` and `prose` for the review narrative/summary, `openQuestion` for reviewer questions back to the agent, plus `diff` blocks; v2 PRD kinds (`phase`, `tradeoff`, `fileChange`, `code`, `table`, `diagram`) are NOT meaningful in a code review and stay rejected (keeps each doc-type's contract tight, consistent with the D5-i philosophy). `fileChange` is deliberately excluded despite surface similarity: it is a *planned* change with a rationale, semantically distinct from a *concrete* `diff` block holding actual hunks.

### 3.4 Hunk-ID stability (ADR-0001 mechanism applied recursively)

`Hunk.hunkId` and `BlockComment.commentId` are stable opaque identifiers exactly like block `id` (ADR-0001). They are minted at ingestion (deterministically, `node:`-pure — e.g. `<blockId>-h<n>` / `<blockId>-c<n>`, content-independent like the opaque scheme) so a re-ingested or agent-revised diff-review document preserves per-hunk comment anchors across revisions. **No new ID-stability measurement is required** (AC-R-WAIVER, §6): ingestion-minted hunk IDs are deterministic (not agent-recalled), so the §6 falsifier (agent renumbering on regeneration) does not apply to them; block IDs remain agent-minted opaque tokens proven at 1.000 in ADR-0001, and the kind-agnostic `renderEchoTable` deny-echo table is reused verbatim. The reasoned-waiver argument is the AC-P18 argument, recorded identically (§10 AC-R-WAIVER).

---

## 4. The `/planos-review` Entry Path (command → blocking CLI) + the AC-17 Boundary Analysis (the crux)

### 4.1 Topology (mirrors `/planos-prd` two-phase, design.md §3 line 106)

```
User types /planos-review [PR# | git range]
      ↓
Claude Code loads plugin/commands/planos-review.md  (self-contained prompt asset)
      ↓
Phase 1: Brief PR/range-grounding interview IN THE CLI (live agent)   ← legitimate live-agent
      ↓   (scope-of-review questions; AC-17-allowed, mirrors planos-prd)   surface, pre-server
Phase 1b: Agent runs `gh pr diff <PR#>` OR `git diff <range>` IN THE CLI ← SUBPROCESS that
      ↓   (the agent's own tool use, before the server boots)              touches net/repo
Phase 2: Agent normalizes the unified-diff text into a v3 diff-review     ← still in the agent
      ↓   block document JSON (using src/review/ingest.mjs as a PURE        loop, pre-server
      ↓   text→blocks parser, OR authoring the blocks directly)
Agent pipes the authored doc into:  node bin/planos review  (via stdin)   ← NEW dispatch; boots
      ↓                                                                      server DIRECTLY
src/hook/review.mjs handleReview():                                       (NO ExitPlanMode)
   - read authored doc from stdin (reuse readStdin/extractPlan — R4)
   - validate as v3 diff-review (degradeToProse fallback reused, type:"diff-review")
   - (R2) load prior persisted review revision for diff base — OR ephemeral
   - startServer() → real SPA + per-hunk accept/reject/comment + /api/review* handlers
   - BLOCK on decisionPromise
   - approve → emit ReviewRoundTrip success (structured review envelope) [+ persist if R2]
     revise  → buildReviseMessage (reused) directive + (id,kind,title) echo + canonical JSON
   - flush-then-exit-0 (reused server.finish())
```

### 4.2 Why a command, not a hook (design.md §3 line 106 is explicit)

Diff review is NOT plan mode — there is no `ExitPlanMode` tool call to intercept. The `PermissionRequest`/`ExitPlanMode` hook in `plugin/hooks/hooks.json` is plan-mode-only and stays untouched (verified: hooks.json declares only `EnterPlanMode` PreToolUse + `ExitPlanMode` PermissionRequest). Diff-review mode reaches the same `startServer()` round-trip through a new `bin/planos review` subcommand — added to the `switch` in `plugin/bin/planos` (currently `enter`/`exit`/`prd`/`default`, lines 20-49), via the SAME `import(resolve(__dirname, '../../src/hook/review.mjs'))` provable-literal pattern as the `prd` case (lines 37-43). The `import-graph.mjs` walker already recognizes this `resolve(__dirname,'<lit>')` unwrap as provable (its documented allowed exception), so the new edge does not trip fail-closed.

### 4.3 The AC-17 boundary analysis — THE crux of Phase 3

The Phase 1 invariant is **"no model call / network egress / agent spawn inside the blocking server-round-trip path."** Phase 2 (ADR-0002) established that `node:fs` (store.mjs) and `node:child_process` (browser-opener) are documented *allowed boundaries* — filesystem ≠ network/model; spawning the OS URL opener ≠ spawning an agent. Phase 3's new wrinkle: **`gh` and `git` are subprocesses that DO touch the network (gh) and the repo (git).** Where they run is decisive.

**Three positions, analyzed:**

- **Position A (RECOMMENDED — R1 Option A): `gh`/`git` ingestion runs in the pre-server CLI agent loop; the blocking path receives only already-ingested unified-diff/JSON via stdin; `src/review/ingest.mjs` is a PURE text→blocks parser (no subprocess, no `node:child_process`).**
  - Exactly the AC-17 posture of Phases 1 and 2: the live agent does its network/tool work *before* `bin/planos review` boots, identical to the Socratic interview and to the agent authoring the doc. `gh pr diff` / `git diff` is the agent's own tool use in the CLI — the legitimate pre-server live-agent surface. The blocking path (`bin/planos review` → `src/hook/review.mjs` → `src/server/` → `src/schema/` → `src/diff/` → `src/review/ingest.mjs` [+ `src/review/store.mjs` if R2]) makes ZERO subprocess calls except the existing documented browser-opener, ZERO network egress, ZERO agent spawn.
  - `src/review/ingest.mjs` imports **no `node:child_process`** — it is a pure unified-diff string parser (regex/line-scan, like the existing `tokenize`/`canonicalize` helpers). It joins the AC-17-audited transitive set as a pure-logic leaf, exactly like `src/diff/structural.mjs`.
  - The AC-17 import-graph walk over the review roots stays **VERDICT CLEAN** with zero new allowed-boundary carve-outs. This is the cheapest, most defensible position and preserves the existing two-tier boundary doctrine without expansion.
- **Position B (NOT recommended): the blocking `bin/planos review` path itself shells out to `gh`/`git`.**
  - This would require a THIRD documented allowed-boundary carve-out (`node:child_process` spawning `gh` — which performs network egress to GitHub — and `git` — which reads the repo). Critically, `gh pr diff` **makes a network call to GitHub**. That is materially different from the browser-opener boundary (the opener makes NO egress *from the planos process*; the AC-17 socket spy proves it). A `gh` subprocess spawned from the blocking path WOULD cause network egress attributable to the blocking round-trip. The runtime no-egress interceptor (LAYER 2-style `child_process` spy) would have to be **loosened** to allow a `gh` spawn — directly weakening the invariant the whole architecture protects. Rejected.
- **Position C (fallback only): blocking path shells out to `git` ONLY (local, no network), never `gh`.**
  - `git diff <range>` is local and makes no network call, so a narrowly-scoped `node:child_process` carve-out for `git` (analogous to the browser-opener) is *arguable*. But it still expands the allowed-boundary surface, complicates the runtime spy (must distinguish an allowed `git` spawn from a forbidden agent spawn by argv inspection — fragile), and gains nothing Position A doesn't already deliver (the agent can run `git diff` in the CLI just as easily as `gh pr diff`). Documented as the only conceivable fallback if R3 ever needs git-plumbing inside the binary; not recommended.

**Recommendation: Position A (R1 Option A).** It is the unique position that (1) keeps the blocking path byte-for-byte as model/network/spawn-free as Phases 1+2, (2) adds no new allowed-boundary carve-out, (3) reuses the proven pre-server-live-agent doctrine verbatim, and (4) keeps the AC-17 import-graph + runtime layers CLEAN with the minimum change. The agent running `gh`/`git` in the CLI before piping the result to `bin/planos review` via stdin is the EXACT mirror of the agent authoring a PRD before piping to `bin/planos prd`.

### 4.4 AC-17 RE-ASSERTION for the review entrypoint (mechanism, identical to Phase 2 P5)

- `tests/harness/import-graph.mjs ac17Roots()` (lines 583-604) gains three explicit roots after the prd roots: `src/hook/review.mjs`, `src/review/ingest.mjs`, and (if R2=persist) `src/review/store.mjs`. The dispatcher already reaches `review.mjs` via the same provable `resolve(__dirname,'<lit>')` unwrap as `prd.mjs`; the explicit roots make the re-assertion dispatcher-independent (verbatim the Phase-2 reasoning in the existing comment at lines 566-579).
- `tests/ac17-invariant.test.mjs` gains a **LAYER 2c** runtime test mirroring **LAYER 2b** (lines 539-770) EXACTLY: same lowest-boundary interceptors (`node:net` connect / `node:dns` lookup / `node:child_process` spawn|exec|fork / global `fetch` / `http(s).request`), driving `handleReview` (scripted seam, tmpdir root if R2) instead of `handlePrd`. Asserts ZERO non-loopback egress, ZERO agent/process spawn through the review→server→schema→diff→ingest[→store] path. The static LAYER-1b assertion's `expected` module list (lines 271-296) gains `src/hook/review.mjs` + `src/review/ingest.mjs` (+ `src/review/store.mjs` if R2).
- `src/review/ingest.mjs` is asserted pure-text-parser by construction (zero `node:child_process` import) — the static walk proves it; the runtime LAYER 2c proves no spawn at run time.

---

## 5. Persistence Decision Surface (does review persist? — Open Decision R2)

### What is fixed vs what is an Open Decision

**Fixed by design.md + Phase 1/2 mechanics:**
- If a review persists, it MUST use the SAME append-only, path-traversal-safe, canonical-JSON, `node:fs`-only pattern as `src/prd/store.mjs` (ADR-0002), keyed by the document `id` + `meta.revision`. No new persistence doctrine is invented.
- The persistence layer, if built, is pure `node:fs`/`node:path` (AC-17-clean, in-scope-allowed exactly like `src/prd/store.mjs`).
- design.md §9 Phase 3 scope does NOT mention persistence (contrast §9 Phase 2 which explicitly says "persistence to a PRD directory, multi-revision history browser"). Phase 3's scope line is: "/planos-review command, diff block kind, gh PR + local git range ingestion, per-hunk comment/accept/reject, structured review envelope." **Persistence is conspicuously absent from the Phase 3 scope sentence** — a strong signal it is not required.

**OPEN DECISION R2 (recommended option stated; needs human sign-off):** does a diff review persist to disk?

- **Option A (RECOMMENDED): ephemeral — a code review of a PR/range is NOT persisted.** The review round-trip produces a structured review envelope back to the agent and exits; nothing is written to a `reviews/` directory. Rationale: a PR review's durable home is the PR itself (GitHub) and the agent's subsequent actions, not a planos-local file; the diff is a snapshot of an external artifact (the PR/range) that planos does not own; design.md §9 omits persistence from Phase 3 scope while explicitly naming it for Phase 2; no multi-revision history browser is in Phase 3 scope. This is the smallest correct surface and removes an entire module + ADR sub-decision + test suite.
- **Option B: persist append-only at `reviews/<doc-id>/rNNN.json` + `latest.json`, committed**, mirroring ADR-0002 D1 Option A exactly (a `src/review/store.mjs` clone of `src/prd/store.mjs`). Rationale for: a reviewed-and-annotated diff becomes a reviewable, PR-visible artifact (the planos thesis); the agent's revisions to the review are diffable via the existing `diffDocuments`. Cost: a snapshot of an external PR is a moving target (the PR can change underneath), so a committed `reviews/` tree can rot; adds a module, an ADR sub-decision, the `store`-mirror test suite, and a `review-smoke.mjs` persistence proof.
- **Option C: persist gitignored / local-only** (ADR-0002 D1 Option B analog). Rejected for the same reason ADR-0002 rejected it: undercuts the reviewable-artifact thesis without removing the rot risk.

Recommended: **Option A, ephemeral.** It matches design.md §9's deliberate omission, minimizes the new surface, and avoids persisting a snapshot of an externally-owned moving artifact. If R2 → B, Milestone R1 gains a `src/review/store.mjs` work unit + `tests/review-store.test.mjs` + `tests/harness/review-smoke.mjs` and `ac17Roots()` gains the store root (all mechanically mirrored from Phase 2 P1/P5).

---

## 6. Acceptance Criteria ([H] harness / [M] manual / [D] doc)

Mirrors Phase 1/2 rigor and tag discipline. Verification strategy is the same: harness-asserted where mechanizable, doc artifacts for decisions, scripted manual smoke for live-agent/browser surfaces.

### v3 schema (validator + diff + types)
- **AC-R1** `[H]` Validator accepts a well-formed `diff` block (`path`, `hunks:Hunk[]`, `comments:BlockComment[]`, optional `status`/`oldPath`) with valid nested `Hunk`/`DiffLine`/`BlockComment` shapes, and rejects each malformed shape (bad `op` enum, non-integer `oldStart`, missing `hunkId`, bad `verdict` enum, non-string `text`) with a field-level error string suitable for the deny→revise preamble (new `tests/v3-schema.test.mjs`, asserting exact error-path text; mirrors `tests/v2-schema.test.mjs`).
- **AC-R2** `[H]` Doc-type gating: a `type:"plan"` OR `type:"prd"` document containing a `diff` block is REJECTED; a `type:"diff-review"` document accepts the diff-review allowed-kind set (v1∪v3 per R7) and REJECTS v2 PRD kinds. (Pending R7.)
- **AC-R3** `[H]` `degradeToProse` fallback still produces exactly one `prose` block + `meta.degraded=true` for malformed diff-review input, with `type` preserved as `"diff-review"` (AC-7/AC-P3 property re-asserted for the review path via `degradeOpts.type="diff-review"`, mirroring `prd.mjs` line 232; deterministic, 100%).
- **AC-R4** `[H]` Structural doc-revision diff classifies `diff` blocks correctly: a hunk-content or comment change → `modified` (via canonical structural equality, `path` in `TEXT_FIELDS` gives a word-diff on path renames); reorder of `diff` blocks → `moved`; new file → `added` (extends `tests/diff.test.mjs` with a forced-revise v3 fixture). Reanchor `PRIMARY_FIELD.diff=["path"]` carries a hunk comment forward on an agent-re-minted block id (extends `tests/reanchor.test.mjs`).

### `/planos-review` command + review round-trip
- **AC-R5** `[M]` `/planos-review <PR#>` and `/planos-review <git range>` run a brief scope-grounding interview in the CLI, the agent runs `gh pr diff`/`git diff` (its own CLI tool use), normalizes to a valid v3 diff-review doc, boots the blocking server (no `ExitPlanMode`), opens the browser. Verified with a PR-number arg and a git-range arg (mirrors `planos-prd-command.md` Scenario A/B; documented in `docs/notes/planos-review-command.md`).
- **AC-R6** `[M]` Graceful interruption ("skip"/"just review it"/one-word) → reduced-scope review → minimal valid v3 diff-review doc (at least the diff blocks + one `openQuestion`) → server still boots, browser opens, no crash/loop (mirrors AC-P6 / Scenario C; `tests/planos-review-interrupt.test.mjs` static invariants).
- **AC-R7** `[H]` `bin/planos review` round-trip: reads the authored doc, validates/degrades (`type:"diff-review"`), boots `startServer`, blocks on `decisionPromise`; on approve emits the structured `ReviewRoundTrip` success JSON (per-hunk verdicts + comments + overall decision) [+ persists if R2]; on revise emits `buildReviseMessage` output (directive + `(id,kind,title)` echo table + canonical JSON); honors flush-then-exit-0 (new `tests/review-roundtrip.test.mjs`, SCRIPTED decision-provider seam reused — mirrors `tests/prd-roundtrip.test.mjs`).
- **AC-R8** `[H]` `baseRevision` race guard fires on the review round-trip identically to the plan/PRD loop (reuses `checkBaseRevision` via `buildDecision`; assert stale-ops rejection + re-render signal — same assertion as AC-P8).

### Ingestion (R1 / R3)
- **AC-R9** `[H]` `src/review/ingest.mjs` parses real unified-diff text (multi-file, multi-hunk, added/deleted/renamed/binary files) into correct `diff` blocks: file path + `status` + per-hunk `header`/`oldStart`/`oldLines`/`newStart`/`newLines`/`lines[]` with correct `op` classification; deterministic `hunkId` minting; binary/rename files → empty-`hunks` block with the right `status` (R6) (new `tests/review-ingest.test.mjs` with fixture diffs covering each case).
- **AC-R10** `[H]` `src/review/ingest.mjs` is a PURE text→blocks parser: zero `node:child_process` import (asserted by the AC-17 static walk including `src/review/ingest.mjs` in the audited closure) and zero subprocess at runtime (LAYER 2c). The `gh`/`git` subprocess is NEVER invoked from the blocking path (R1 Option A enforced by AC-R13).

### SPA v3 renderer + review envelope
- **AC-R11** `[M]` SPA renders a `diff` block with file-path header, per-hunk unified-diff view (add/remove/context line styling), and a per-hunk accept/reject toggle + per-hunk comment box, inside the existing `BlockShell` (block-level comment affordance still works). Manual demo; extends `tests/editor-render.test.mjs` for non-visual assertions (the `_never` guard at `blocks.tsx:908` is satisfied by the new `case 'diff':`).
- **AC-R12** `[H]` Per-hunk accept/reject/comment serializes into the existing `FeedbackEnvelope` `ops[]` (R5: `editBlock` patch updating `comments[]` with `verdict`, NO new op) and `buildDecision` consumes it unchanged through the proven `looksLikeBareEnvelope` path; the structured review envelope round-trips back to the agent with per-hunk verdicts intact (extends `tests/envelope-emit.test.mjs` + asserted in `tests/review-roundtrip.test.mjs`).

### Invariant + verification
- **AC-R13** `[H]` AC-17 RE-ASSERTED for the new blocking entrypoint: `tests/ac17-invariant.test.mjs` extended (LAYER 2c runtime + LAYER 1b static module-set) so `bin/planos review` → `src/hook/review.mjs` → `src/server/` → `src/schema/` → `src/diff/` → `src/review/ingest.mjs` [+ `src/review/store.mjs` if R2] has zero network egress, zero agent spawn, zero agent-SDK import; `ac17Roots()` lists the review roots explicitly; walk stays VERDICT CLEAN. `gh`/`git` proven absent from the blocking transitive set (the crux, R1 Option A).
- **AC-R14** `[H]` Phase-1 exit gate NOT regressed: `tests/harness/verify-exit-gate.mjs` exits 0, FROZEN_BARS asserted untampered (`tests/harness/metrics.mjs` unchanged), all `exit-*.test.mjs` + Phase-2 `prd-*` suites green between every milestone.
- **AC-R15** `[H]` Committed-artifact drift check (AC-P17 pattern): rebuild `plugin/dist/index.html` and assert byte-identical-after-commit once the `DiffView` renderer lands; size stays under the 4 MB cap (currently 3,410,165 B ≈3.25 MB; the diff renderer adds negligible bytes — no new runtime dep, plain React like `CodeView`).
- **AC-R16** `[D]` `docs/adr/0003-diff-review.md` records R1 (the gh/git/AC-17 boundary — the headline), R2 (persistence), R3 (ingestion mechanism), R4 (handoff), R5 (accept/reject semantics), R6 (large/binary handling), R7 (diff-review allowed-kinds), once signed off (mirrors ADR-0002 structure).
- **AC-R-WAIVER** `[D]` No-Phase-3-ID-re-measurement reasoned waiver recorded in ADR-0003: `opaque` is the production default proven 1.000 (ADR-0001); v3 introduces no new *agent-minted* ID surface (block IDs stay agent-minted opaque tokens; `hunkId`/`commentId` are *deterministically ingestion-minted*, not agent-recalled, so the §6 falsifier — agent renumbering on regeneration — structurally does not apply to them); the kind-agnostic `renderEchoTable` deny-echo table is reused verbatim; the round-trip machinery is reused byte-for-byte from `prd.mjs`/`exit.mjs`. Re-running the Milestone-1 ID gate would re-measure an already-falsified-clear risk against the very scheme chosen to neutralize it, on reused code paths. Documented reasoned waiver, mirroring AC-P18 — NOT an omission.

> 16 criteria + 1 waiver: 11 `[H]`, 2 `[D]` (+1 `[D]` waiver), 2 `[M]`. ≥80% concrete/testable, mirroring Phase 1/2's ratio.

### Verification strategy (consistent with Phase 1/2 §6)
1. Per-milestone harness gate; the v3 schema milestone is the first HARD GATE (everything downstream depends on the validator + types).
2. Acceptance traceability: every AC → `[H]` assertion, `[D]` artifact, or scripted `[M]` smoke.
3. AC-17 re-assertion is a distinct verification pass (separate lane — not self-approved by the authoring context), per the global "separate review pass" rule.
4. Offline verification: full review round-trip with network disabled; assert zero egress from `bin/planos review`; assert `src/review/ingest.mjs` never spawns.
5. Live-session smoke: install via `claude --plugin-dir ./plugin`, run `/planos-review <PR#>` and `/planos-review <range>` end-to-end, per-hunk accept/reject/comment, approve → confirm the structured review envelope reaches the agent.
6. **No ID re-measurement** (AC-R-WAIVER reasoned waiver) — explicitly NOT re-running the Milestone-1 gate.
7. Phase-1 FROZEN exit gate (`verify-exit-gate.mjs`) + Phase-2 `prd-*` suites + `prd-smoke.mjs` re-run green between every milestone (no regression to either prior phase).

---

## 7. Milestones (strict dependency order, file-level work units)

One commit per milestone. Between every milestone the verify gate runs: full suite (`node --test tests/*.test.mjs tests/harness/*.test.mjs`) + `npx tsc --noEmit` exit 0 + `node tests/harness/import-graph.mjs` VERDICT CLEAN + `node tests/harness/verify-exit-gate.mjs` exit 0 (Phase-1) + `node tests/harness/prd-smoke.mjs` exit 0 (Phase-2) + AC-17 CLEAN.

### Milestone R0 — v3 schema engine (HARD GATE — everything depends on it)
- **R0.1** Extend `src/schema/validate.mjs`: add `V3_KINDS`, `DIFF_REVIEW_KIND_LIST`, the `diff` `KIND_VALIDATORS` entry + `validateHunk`/`validateDiffLine`/`validateBlockComment` helpers + a `requireInteger`-style pusher (~8 lines), the third doc-type tier in `validateBlock` (`isDiffReview`, V3-kind-wrong-doc rejection, updated invalid-kind message), per R7.
- **R0.2** Extend `src/schema/types.d.ts` + `src/editor/types.ts`: `DiffBlock`, `Hunk`, `DiffLine`, `BlockComment` interfaces + `Block` union (13→14) + ensure `type:"diff-review"` flows.
- **R0.3** Extend `src/diff/structural.mjs` `TEXT_FIELDS` (`diff:["path"]`) and `src/diff/reanchor.mjs` `PRIMARY_FIELD` (`diff:["path"]`).
- **R0.4** Tests: `tests/v3-schema.test.mjs` (mirror `tests/v2-schema.test.mjs`), extend `tests/diff.test.mjs` + `tests/reanchor.test.mjs` with v3 fixtures.
- Gate: AC-R1, AC-R2, AC-R3, AC-R4.

### Milestone R1 — diff-ingestion parser (pure text→blocks; + review store ONLY if R2=B)
- **R1.1** Create `src/review/ingest.mjs`: pure unified-diff string parser → `diff` blocks (path, `status`, hunks with `header`/`oldStart`/`oldLines`/`newStart`/`newLines`/`lines[]`/deterministic `hunkId`, `comments:[]`). Handles multi-file, multi-hunk, added/deleted/renamed/binary (R6). ZERO `node:child_process` (R1 Option A). Pure `node:`-free logic (like `structural.mjs`).
- **R1.2** (ONLY if R2 → Option B) Create `src/review/store.mjs` mirroring `src/prd/store.mjs` exactly (`reviews/<doc-id>/rNNN.json` + `latest.json`, append-only, path-traversal-safe, canonical JSON, `node:fs`-only).
- **R1.3** Tests: `tests/review-ingest.test.mjs` (fixture diffs per case); (if R2=B) `tests/review-store.test.mjs` mirroring `tests/prd-store.test.mjs`.
- Gate: AC-R9, AC-R10 (static-purity half), (if R2=B) AC-R7 persistence half.

### Milestone R2 — diff-review round-trip handler (boots server directly)
- **R2.1** Create `src/hook/review.mjs` `handleReview()`: mirror `src/hook/prd.mjs` shape verbatim — reuse `readStdin`/`extractPlan` (roundtrip.mjs), `planToDocument` with `degradeOpts.type="diff-review"`, `startServer`, `buildDecision`, `buildReviseMessage`, `renderEchoTable`, `toPermissionRequestOutput`, `buildSpaHtml`, `openBrowserReal`; SCRIPTED vs REAL-SPA seam identical to `handlePrd`; emit a `ReviewRoundTrip` hookSpecificOutput (per-hunk verdicts + comments + overall decision) on approve [+ `saveRevision` if R2=B]; add `buildReviewApiHandlers` (read-only) mirroring `buildPrdApiHandlers`.
- **R2.2** Add `review` case to `plugin/bin/planos` switch (same `import(resolve(__dirname,'../../src/hook/review.mjs'))` provable-literal pattern as the `prd` case; update the usage string line 16 to include `review`).
- **R2.3** Tests: `tests/review-roundtrip.test.mjs` (SCRIPTED decision-provider seam reused; child-process pattern from `tests/prd-roundtrip.test.mjs`).
- Gate: AC-R7, AC-R8, AC-R12 (envelope round-trip half).

### Milestone R3 — `/planos-review` command (self-contained)
- **R3.1** Create `plugin/commands/planos-review.md`: two-phase prompt (brief PR/range scope interview → run `gh pr diff`/`git diff` as the agent's own CLI tool → normalize to v3 diff-review doc via the `src/review/ingest.mjs` parser or direct authoring → pipe to `bin/planos review` via stdin), self-contained, graceful-interruption section, v3 schema reference + worked diff-review example (mirror `planos-prd.md` structure verbatim, swap v2→v3 schema block + the ingestion step).
- **R3.2** Create `docs/notes/planos-review-command.md` AC-17 boundary note (mirror `planos-prd-command.md`; the gh/git-vs-AC-17 boundary section is the centerpiece — R1 Option A spelled out).
- **R3.3** Tests: `tests/planos-review-command.test.mjs`, `tests/planos-review-interrupt.test.mjs` (mirror the `planos-prd-*` command/interrupt tests — static invariants, stdin-invocation present, no external-skill dependency, ingestion-in-CLI-not-blocking-path asserted).
- Gate: AC-R5, AC-R6.

### Milestone R4 — SPA v3 `diff` renderer + per-hunk review affordance
- **R4.1** Add a `DiffView` component + `case 'diff':` dispatcher arm in `src/editor/blocks.tsx` (satisfies the `_never` exhaustiveness guard at line 908): file-path header, per-hunk unified-diff rendering (add/remove/context styling like `CodeView`'s `<pre>`, zero new deps), per-hunk accept/reject toggle + per-hunk comment box; flow mutations up through callbacks (extend the `EditorState`/callback surface in `src/editor/types.ts` minimally — a `reviewVerdicts` / `hunkComments` map alongside `edits`/`comments`/`answers`).
- **R4.2** Extend `src/editor/envelope.ts` / `src/editor/envelope.impl.mjs` to serialize per-hunk verdict+comment into `ops[]` as `editBlock` patches updating `comments[]` (R5: NO new op discriminant; `src/schema/envelope.mjs` unchanged).
- **R4.3** Rebuild + commit `plugin/dist/index.html`; assert byte-identical-after-commit + under 4 MB cap (AC-R15).
- **R4.4** Tests: extend `tests/editor-render.test.mjs` (non-visual `DiffView` assertions); drift check; extend `tests/envelope-emit.test.mjs`.
- Gate: AC-R11, AC-R12, AC-R15.

### Milestone R5 — AC-17 re-assertion + Phase 3 exit gate
- **R5.1** Extend `tests/harness/import-graph.mjs ac17Roots()` with `src/hook/review.mjs`, `src/review/ingest.mjs` (+ `src/review/store.mjs` if R2=B), after the prd roots (mirror the Phase-2 P5 comment block at lines 566-579).
- **R5.2** Extend `tests/ac17-invariant.test.mjs`: LAYER 1b static module-set `expected` list gains the review modules; add LAYER 2c runtime test mirroring LAYER 2b exactly, driving `handleReview` (scripted seam, tmpdir root if R2=B), asserting zero egress / zero spawn / `gh`/`git` absent.
- **R5.3** Create `tests/harness/review-smoke.mjs` mirroring `tests/harness/prd-smoke.mjs` (deterministic, no `claude`, real `bin/planos review` round-trip via scripted seam; if R2=B: r001/r002 persistence + diff proof; if R2=A: structured review envelope shape proof).
- **R5.4** Full Phase 3 harness run; offline verification; live-session smoke (PR# + git-range, per-hunk accept/reject/comment, approve → envelope reaches agent).
- **R5.5** Write `docs/adr/0003-diff-review.md` (R1–R7 resolutions + AC-R-WAIVER), mirroring ADR-0002 structure.
- Gate: AC-R13, AC-R14, AC-R16, AC-R-WAIVER; all 16 AC green; Phase 1 + Phase 2 NOT regressed.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`gh`/`git` ingestion accidentally placed inside the blocking path → AC-17 weakened (network egress from the round-trip)** | M | **H** | **The headline risk.** R1 Option A (recommended) keeps ingestion in the pre-server CLI agent loop; `src/review/ingest.mjs` is a pure text→blocks parser with ZERO `node:child_process`. AC-R13 LAYER 2c runtime spy + LAYER 1b static walk PROVE `gh`/`git` are absent from the blocking transitive set. Position B explicitly rejected (§4.3) precisely because `gh` causes network egress attributable to the round-trip. This is a first-class Open Decision (R1) requiring sign-off before R1 implements. |
| v3 schema (nested `Hunk`/`DiffLine`/`BlockComment`) strains the agent's first-try valid rate | M | M | Reuse the proven deny→revise loop (kind-agnostic `buildReviseMessage`/echo table); `prose` remains a valid escape hatch; the `src/review/ingest.mjs` parser does the heavy structural lifting deterministically so the agent mostly assembles, not hand-authors, hunks. First-try tracked, not gated (Phase 1/2 precedent). |
| Sharing `exit.mjs`/`prd.mjs` internals with `review.mjs` regresses the plan or PRD loop | L | H | `review.mjs` only IMPORTS already-extracted pure functions (roundtrip.mjs + exit.mjs exports); ZERO behavior change to existing modules. `exit-*.test.mjs` + `prd-*.test.mjs` + `verify-exit-gate.mjs` + `prd-smoke.mjs` are the regression guard, green before R2 merges. Authoring vs verification kept as separate passes. |
| Large diff (hundreds of files/thousands of hunks) bloats the inlined SPA doc / slows the round-trip | M | M | R6 Open Decision: ingestion caps/elides very large hunks (configurable, with an explicit "truncated — N hunks elided" `prose`/comment marker like the `readStdin` MAX_STDIN_BYTES degrade pattern); the `diff` block can carry an empty-`hunks` summary stub. The user is never blocked; the review still boots. |
| Binary / rename / mode-only files have no textual hunks | L | M | R6: such files become a `diff` block with `status:"binary"\|"renamed"`, empty `hunks:[]`, and a descriptive header; the `DiffView` renders a "binary file — no textual diff" / "renamed A → B" affordance. Validator allows empty `hunks` for these `status` values (§3.1). |
| Review persistence is the wrong call (built when not needed, or omitted when wanted) | M | M | R2 surfaced as an explicit Open Decision with a recommended option (A = ephemeral, matching design.md §9's deliberate omission); ADR-0003 records the signed-off choice before R1 implements; if B, the store is a mechanical `src/prd/store.mjs` clone (low-risk, fully precedented). |
| New `Edit` op for accept/reject expands the envelope surface unnecessarily | L | M | R5 recommended: reuse `editBlock`/`comment` with a `verdict` field inside `BlockComment` — NO new `EDIT_OPS` entry, `src/schema/envelope.mjs` + `buildDecision` unchanged. A new op is a sub-decision only if line-level (not hunk-level) verdicts are required. |
| Committed `plugin/dist/index.html` drifts / exceeds the 4 MB cap after the diff renderer | L | L | AC-R15 byte-identical rebuild check (AC-P17 pattern); `DiffView` adds no runtime dep (plain React `<pre>` like `CodeView`) — measured headroom ≈0.75 MB under cap; mermaid bundle (D3) unaffected. |
| Scope creep into Phase 4 (plannotator coexistence / hosted share) | L | M | Coexistence stays detect-and-refuse (`src/hook/coexistence.mjs` unchanged — it guards only the `ExitPlanMode` hook, which the `review` command never touches); Phase 4 items (themes, export, Bun, share) are explicit Non-Goals. |
| Re-measuring ID stability for v3 wastefully (or skipping unsafely) | L | M | AC-R-WAIVER documents the reasoned waiver (mirrors AC-P18): `opaque` chosen FOR rename/growth stability; §6 falsifier passed 1.000; v3 adds no new *agent-minted* ID surface (`hunkId`/`commentId` are deterministically ingestion-minted); round-trip reused verbatim. Reasoned waiver, not omission. |

---

## 9. Non-Goals (Phase 3)

No re-implementation of plan mode or PRD mode (both COMPLETE, verified, committed — Phase 1/2); no change to the `ExitPlanMode` hook or `plugin/hooks/hooks.json`; no plannotator coexistence/hook-collision resolution (still Phase 4 — detect-and-refuse posture unchanged); no `gh`/`git` invocation inside the blocking `bin/planos review` path (R1 Option A — the crux); no LLM / model call / network egress / agent spawn in the blocking path (AC-R13); no live in-browser interviewer; no hosted service / cloud / upload / share links; no multi-user/real-time collab; no Bun single-binary; no markdown/PDF export or themes; no GitHub write-back (the review envelope returns to the *agent*, which may act on it — planos does not post review comments to GitHub itself); no inline syntax highlighting of diff content (zero-dep constraint — plain `<pre>` like `CodeView`); **no re-running the Milestone-1 ID gate** (AC-R-WAIVER); no new frozen numeric bar (lighter-but-rigorous gate, D6 precedent); no review persistence unless R2 → B (recommended A = ephemeral).

---

## 10. Open Decisions for the User (require sign-off before execution)

**R1 — The gh/git ingestion vs AC-17 boundary (THE HEADLINE DECISION).** Where does `gh pr diff` / `git diff <range>` actually run?
- **Option A (RECOMMENDED): ingestion runs in the pre-server CLI agent loop** (the agent runs `gh`/`git` as its own tool use, before piping the result to `bin/planos review` via stdin); `src/review/ingest.mjs` is a PURE text→blocks parser with ZERO `node:child_process`; the blocking path stays byte-for-byte as model/network/spawn-free as Phases 1+2; AC-17 import-graph + runtime stay CLEAN with no new allowed-boundary carve-out. **Rationale: the EXACT mirror of the Phase 1/2 pre-server-live-agent doctrine; `gh` causes network egress, so running it inside the blocking path would force loosening the runtime no-egress interceptor — directly weakening the invariant the whole architecture protects (Position B, rejected §4.3).**
- Option B: blocking path shells out to `gh`/`git` (rejected — `gh` = network egress from the round-trip; requires a third allowed-boundary carve-out + loosened runtime spy).
- Option C: blocking path shells out to `git` only, never `gh` (fallback only — local, no network, but still expands the boundary surface and a fragile argv-inspecting runtime spy; no benefit over A).
- **Recommended: Option A.** Blocks Milestone R1 (the `src/review/ingest.mjs` purity contract) and R5 (AC-R13 re-assertion). The single most important Phase-3 design question — treat as first-class.

**R2 — Does a diff review persist to disk?** (Recommended: Option A = ephemeral; B = append-only `reviews/<doc-id>/rNNN.json`+`latest.json` committed, mirroring ADR-0002 D1; C = gitignored local-only.) The genuine call: is a reviewed/annotated diff a planos-owned reviewable artifact worth committing, or an ephemeral snapshot of an externally-owned moving PR? design.md §9 omits persistence from the Phase 3 scope sentence while explicitly naming it for Phase 2 — a strong signal for A. **Recommended: Option A (ephemeral).** Blocks Milestone R1.2/R1.3 (whether `src/review/store.mjs` + its tests exist), R2.1 (whether `handleReview` persists), R5.3 (`review-smoke.mjs` shape).

**R3 — Ingestion mechanism: `gh` CLI vs `git` plumbing vs both.** Which source(s) does `/planos-review` support — `gh pr diff <PR#>` for PR numbers, `git diff <range>` for local ranges, or both? Recommended: **both** (a PR-number argument → `gh pr diff`; a git-range argument → `git diff`; the command detects which by argument shape, exactly as `/planos-prd` branches on empty-vs-topic `$ARGUMENTS`). The `src/review/ingest.mjs` parser is source-agnostic (both produce unified-diff text). Blocks the `plugin/commands/planos-review.md` argument-handling logic (R3.1).

**R4 — Doc handoff mechanism from the command to `bin/planos review`.** Stdin pipe (mirrors D4 / the hook stdin contract, reuses `readStdin`/`extractPlan` from `roundtrip.mjs`), temp-file path arg, or env var? Recommended: **stdin** (maximizes Phase 1/2 reuse; identical to D4; the command instructs the agent to `echo '<json>' | node bin/planos review` or use a heredoc, verbatim the `planos-prd.md` pattern at lines 329-347). Blocks `plugin/commands/planos-review.md` + `src/hook/review.mjs` ingestion (R2.1, R3.1).

**R5 — Accept/reject semantics in the review envelope.** Does per-hunk accept/reject need new `Edit` op variants, or reuse `comment`/`editBlock`? Recommended: **reuse — NO new op.** A hunk verdict is a `BlockComment{commentId, hunkId, text, verdict:"accept"|"reject"|"comment"}` carried in the `diff` block's `comments[]`, mutated via an `editBlock` op patch; `src/schema/envelope.mjs` `EDIT_OPS` + `buildDecision` reused unchanged (zero new discriminant). Sub-decision: is commenting **hunk-level only** (recommended — anchor by `hunkId`) or also **line-level** (would repurpose the `comment` op's optional `anchor:{start,end}` as a line range, adding SPA + validator complexity)? Recommended: hunk-level only for Phase 3. Blocks §3.1 `BlockComment` shape, `src/editor/envelope.*` (R4.2), `tests/review-roundtrip.test.mjs`.

**R6 — Large-diff / binary-file handling.** How are very large diffs and non-textual files handled? Recommended: (i) binary/rename/mode-only files → a `diff` block with `status:"binary"|"renamed"`, empty `hunks:[]`, descriptive header (validator allows empty `hunks` for these statuses, §3.1); (ii) a configurable per-file/per-hunk size cap in `src/review/ingest.mjs` that elides oversized hunk bodies with an explicit "N lines elided" marker (mirrors the `readStdin` MAX_STDIN_BYTES degrade-not-block doctrine) so the SPA doc never bloats unboundedly and the user is never blocked. Blocks `src/review/ingest.mjs` (R1.1) + `DiffView` (R4.1).

**R7 — diff-review document allowed-kinds.** Which v1/v2 kinds (besides `diff`) are valid in a `type:"diff-review"` document? Recommended: **v1∪v3** — `section`/`prose` (review narrative/summary), `openQuestion` (reviewer→agent questions), all v1 core kinds, plus `diff` (v3); v2 PRD kinds (`phase`/`tradeoff`/`fileChange`/`code`/`table`/`diagram`) REJECTED (not meaningful in a code review; keeps the contract tight, consistent with D5-i's per-doc-type-tightness philosophy; `fileChange` deliberately excluded as semantically distinct from a concrete `diff`). Blocks `src/schema/validate.mjs` `validateBlock` third tier (R0.1) + AC-R2.

---

## Resolved Decisions (user sign-off 2026-05-16)

- **R1 → Option A (pre-server CLI).** `gh pr diff` / `git diff <range>` runs in
  the pre-server CLI agent loop (the agent's own tool use, before piping to
  `bin/planos review` via stdin). `src/review/ingest.mjs` is a PURE
  text→blocks parser with ZERO `node:child_process`. The blocking path stays
  byte-for-byte as model/network/spawn-free as Phases 1+2; no new
  allowed-boundary carve-out. AC-17 import-graph + runtime stay CLEAN. Position
  B/C rejected (§4.3).
- **R2 → Option A (ephemeral).** A diff review is NOT persisted. The review
  round-trip emits a structured review envelope back to the agent and exits;
  no `reviews/` directory, no `src/review/store.mjs`, no review-store/smoke
  persistence tests. Milestone R1.2/R1.3 store work units, R2.1 persistence,
  and the R5.3 persistence-proof variant are DROPPED; `review-smoke.mjs`
  proves the structured review envelope shape instead. `ac17Roots()` does NOT
  gain a store root.
- **R3 → both sources.** `/planos-review` supports a PR-number arg
  (`gh pr diff <PR#>`) and a git-range arg (`git diff <range>`); the command
  detects which by argument shape (mirrors `/planos-prd` empty-vs-topic
  branching). `src/review/ingest.mjs` is source-agnostic (both yield
  unified-diff text).
- **R4 → stdin.** `/planos-review` instructs the agent to pipe the authored v3
  diff-review JSON into `bin/planos review` via stdin, reusing
  `readStdin`/`extractPlan` from `roundtrip.mjs` (identical to D4).
- **R5 → hunk-level only, NO new envelope op.** A hunk verdict is a
  `BlockComment{commentId, hunkId, text, verdict:"accept"|"reject"|"comment"}`
  in the `diff` block's `comments[]`, mutated via an `editBlock` op patch;
  `src/schema/envelope.mjs` `EDIT_OPS` + `buildDecision` reused unchanged. No
  line-level commenting in Phase 3.
- **R6 → binary/rename stubs + size-cap elision.** Binary/rename/mode-only
  files → a `diff` block with `status:"binary"|"renamed"`, empty `hunks:[]`,
  descriptive header (validator allows empty `hunks` for these statuses). A
  configurable per-file/per-hunk size cap in `src/review/ingest.mjs` elides
  oversized hunk bodies with an explicit "N lines elided" marker
  (degrade-not-block doctrine). User is never blocked.
- **R7 → v1∪v3.** A `type:"diff-review"` document accepts the v1 core kinds
  (`section`/`prose`/`objective`/`task`/`decision`/`risk`/`openQuestion`) plus
  `diff` (v3); v2 PRD kinds (`phase`/`tradeoff`/`fileChange`/`code`/`table`/
  `diagram`) are REJECTED (consistent with D5-i per-doc-type tightness;
  `fileChange` deliberately excluded as semantically distinct from a concrete
  `diff`).

Execution may proceed on these. Milestone order per §7 (R2-driven store work
units DROPPED since R2=ephemeral); verify gate (full suite + tsc + AC-17
import-graph CLEAN + Phase-1 exit gate + Phase-2 prd-smoke) between every
milestone; one commit per milestone; keep the single-file offline build
invariant and the AC-17 invariant RE-ASSERTED-not-weakened for the new
`bin/planos review` entrypoint.

---

This plan's Open Decisions (R1–R7) are signed off above. Execution proceeds in strict milestone order R0→R5 (v3 schema engine is the HARD GATE first), one commit per milestone, verify gate (full suite + tsc + AC-17 import-graph CLEAN + Phase-1 exit gate + Phase-2 prd-smoke) between every milestone, keeping the single-file offline build invariant and the AC-17 invariant RE-ASSERTED-not-weakened for the new `bin/planos review` entrypoint.

---

**Key file references used to make this plan file-level precise** (all absolute):
- `/Users/ggiak/www/esolutions.gr/planos/.omc/plans/planos-phase2-plan.md` — the structural template mirrored exactly
- `/Users/ggiak/www/esolutions.gr/planos/docs/design.md` — §3 line 106 (review entry mode), §4 lines 151-153 (v3 `diff` sketch) + §4 `Edit` union, §7 (doc-revision diff, distinct from the v3 code diff), §9 Phase 3 scope (note: persistence omitted)
- `/Users/ggiak/www/esolutions.gr/planos/src/schema/validate.mjs` — `V1_KINDS`/`V2_KINDS`/`KIND_VALIDATORS` (line 136), the two-tier `validateBlock` doc-type gate (lines 457-505) Phase 3 extends to a third tier, `DOC_TYPES` already includes `"diff-review"` (line 47)
- `/Users/ggiak/www/esolutions.gr/planos/src/hook/prd.mjs` — the EXACT command→blocking-CLI handler pattern `review.mjs` mirrors (SCRIPTED/REAL-SPA seam, `buildPrdApiHandlers`, `PrdRoundTrip` output, `degradeOpts.type`)
- `/Users/ggiak/www/esolutions.gr/planos/src/hook/roundtrip.mjs` — `readStdin`/`extractPlan` reused verbatim (R4 stdin handoff)
- `/Users/ggiak/www/esolutions.gr/planos/src/hook/exit.mjs` — `planToDocument`/`buildDecision`/`buildReviseMessage`/`renderEchoTable`/`toPermissionRequestOutput`/`buildSpaHtml`/`openBrowserReal` reused
- `/Users/ggiak/www/esolutions.gr/planos/src/prd/store.mjs` — the append-only/path-safe/canonical-JSON/`node:fs`-only pattern `src/review/store.mjs` clones if R2=B
- `/Users/ggiak/www/esolutions.gr/planos/src/diff/structural.mjs` (`TEXT_FIELDS` line 38) + `/Users/ggiak/www/esolutions.gr/planos/src/diff/reanchor.mjs` (`PRIMARY_FIELD` line 92) — single-line v3 extension points
- `/Users/ggiak/www/esolutions.gr/planos/src/editor/blocks.tsx` — `BlockRenderer` switch (line 856) + `_never` exhaustiveness guard (line 908, force-errors until `case 'diff':` added)
- `/Users/ggiak/www/esolutions.gr/planos/src/editor/types.ts` + `/Users/ggiak/www/esolutions.gr/planos/src/schema/types.d.ts` — `Block` union (13→14 kinds)
- `/Users/ggiak/www/esolutions.gr/planos/plugin/bin/planos` — subcommand switch (lines 20-49); add `review` via the same `import(resolve(__dirname,'<lit>'))` provable pattern as the `prd` case
- `/Users/ggiak/www/esolutions.gr/planos/plugin/commands/planos-prd.md` + `/Users/ggiak/www/esolutions.gr/planos/docs/notes/planos-prd-command.md` — templates for `planos-review.md` + its boundary note
- `/Users/ggiak/www/esolutions.gr/planos/tests/harness/import-graph.mjs` (`ac17Roots()` lines 583-604) + `/Users/ggiak/www/esolutions.gr/planos/tests/ac17-invariant.test.mjs` (LAYER 1b lines 264-313, LAYER 2b lines 539-770) — the AC-17 re-assertion mechanism extended for the review entrypoint
- `/Users/ggiak/www/esolutions.gr/planos/tests/harness/prd-smoke.mjs` + `/Users/ggiak/www/esolutions.gr/planos/tests/harness/verify-exit-gate.mjs` — the verify-gate pattern; FROZEN_BARS untouched
- SPA size measured: `/Users/ggiak/www/esolutions.gr/planos/plugin/dist/index.html` = 3,410,165 bytes (≈3.25 MB, ≈0.75 MB headroom under the 4 MB cap)
