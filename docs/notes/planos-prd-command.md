# `/planos-prd` Command — AC-17 Boundary Note

**Phase 2 / Milestone P3, Step P3.2**  
**Related:** `plugin/commands/planos-prd.md`, `docs/design.md §3`, `docs/design.md §5`, phase2 plan §4 (entry topology), §6 (AC-P5, AC-P6), §7 P3, Resolved Decisions D4 (stdin handoff). Parallel to: `docs/notes/planos-plan-command.md`.

---

## What the command does

`/planos-prd [topic]` is a Claude Code slash command that instructs the **live agent** in the
terminal to run a Socratic interview before authoring a v2 PRD block document and booting the
blocking server. It is a prompt asset — a markdown file with YAML frontmatter — that Claude Code
loads and presents to the agent when the user types the command.

The command has two phases:

1. **Phase 1 — Socratic interview (CLI):** The agent asks one question at a time, follows up
   adaptively, surfaces assumptions, and produces a Crystallized Intent Summary when intent is
   clear.
2. **Phase 2 — Block authoring + server boot:** The agent authors a planos v2 PRD block document
   from the crystallized summary, then pipes it into `bin/planos prd` via stdin so the blocking
   server boots and the browser review UI opens. This is NOT an `ExitPlanMode` call — PRD mode
   reaches the server directly via the CLI subcommand (design.md §3 line 105).

---

## AC-17 boundary: what is inside vs outside the blocking path

### The invariant (from consensus plan AC-17, RE-ASSERTED for PRD mode)

> **No model call inside the blocking `bin/planos prd` path.**

The blocking path is: `bin/planos prd` → `src/hook/prd.mjs` → `src/server/` → `src/schema/` →
`src/diff/` → `src/prd/store.mjs` → stdout flush → `exit(0)`. This path must contain zero
network egress, zero agent invocation, and zero agent-SDK imports in its transitive module graph.
`src/prd/store.mjs` is filesystem-only (`node:fs`/`node:path`) — its filesystem writes are
explicitly in-scope-allowed (filesystem ≠ network/model, same boundary logic as the browser-
opener note in `src/hook/exit.mjs`).

### Where `/planos-prd` sits

```
User types /planos-prd
      ↓
Claude Code loads plugin/commands/planos-prd.md
      ↓
Live agent conducts Socratic interview IN THE TERMINAL  ← OUTSIDE the blocking path
      ↓
Agent authors v2 PRD block document JSON               ← OUTSIDE the blocking path
      ↓
Agent runs: node bin/planos prd  (stdin pipe) ─────────┐
                                                        │ blocking path begins here
      ↓                                                 │
bin/planos prd fires (direct CLI subcommand,            │
  NOT an ExitPlanMode / PermissionRequest hook)         │
      ↓                                                 │
src/hook/prd.mjs: read stdin, validate, start server    │  no model call here
      ↓                                                 │
Browser opens, user reviews v2 PRD blocks               │  no model call here
      ↓                                                 │
User POSTs approve or revise                            │  no model call here
      ↓                                                 │
On approve: saveRevision persists new revision          │  no model call here
      ↓                                                 │
Decision JSON written to stdout, process exits 0        │
                                                        └─ blocking path ends here
```

The `/planos-prd` interview's live-agent calls are **explicitly allowed** — they run in the CLI
before the server boots, initiated by the user, and are never invoked from `bin/planos prd` or
any module in its transitive import graph. They are out of scope of the AC-17 invariant.

This is the **identical posture** to `/planos-plan` (`docs/notes/planos-plan-command.md` lines
61-63): the interview + authoring are the legitimate pre-server live-agent surface; the blocking
path is model-free. The only structural difference is the entry mechanism — `ExitPlanMode` hook
for plan mode vs direct `bin/planos prd` stdin invocation for PRD mode (design.md §3; Resolved
Decision D4).

### What is forbidden

Any model invocation reachable from:
- `bin/planos prd` (the PRD subcommand entrypoint)
- `src/hook/prd.mjs` and all modules it imports
- `src/schema/` (validator, fallback, envelope)
- `src/diff/` (structural diff, reanchor)
- `src/server/` (blocking server)
- `src/prd/store.mjs` (persistence layer — filesystem-only by construction)

This is enforced by two AC-17 test layers (extended for the PRD entrypoint in
`tests/ac17-invariant.test.mjs` — Milestone P5):
1. **Runtime assertion:** during `bin/planos prd`, a network/process-spawn interceptor asserts
   zero outbound `fetch`/`http(s).request` and zero `child_process` spawn of an agent or
   agent-SDK.
2. **Static import-graph walk:** a real module-graph reachability walk over the transitive
   imports of the blocking-path entrypoint (`src/hook/prd.mjs`); asserts no agent-SDK or
   model-client module is in that set. `src/prd/store.mjs` is in-scope-allowed (filesystem
   operations are not network/model egress).

### Self-containment requirement

The `/planos-prd` command must work with no external skill installed. It must not hard-depend
on `/deep-interview`, `/grill-me`, or any other skill from oh-my-claudecode or any third party.
The entire Socratic interview logic and v2 schema reference are defined inline in
`plugin/commands/planos-prd.md`.

---

## Manual smoke test (AC-P5 / AC-P6 — `[M]` criteria)

AC-P5 and AC-P6 are manual acceptance criteria. Run these scenarios in a real Claude Code session
with the plugin installed (`claude --plugin-dir ./plugin`):

### Scenario A — with topic argument (AC-P5)

1. Type `/planos-prd "migrate the auth layer to JWT"`.
2. Verify the agent asks exactly **one** question and waits for an answer.
3. Answer the question. Verify the next turn contains exactly one adaptive follow-up question.
4. Continue until the agent produces the **Crystallized Intent Summary** block.
5. Confirm or correct the summary.
6. Verify the agent emits a v2 PRD block document JSON (with `type: "prd"`) and runs
   `node bin/planos prd` via stdin.
7. Verify the planos browser review UI opens with the structured v2 block document.

**Pass criteria:** one question per turn throughout; summary produced before block authoring;
browser opens; no crash; no reference to `/deep-interview` or `/grill-me` in any agent turn.

### Scenario B — empty argument (no topic) (AC-P5)

1. Type `/planos-prd` (no argument).
2. Verify the agent opens with the empty-argument prompt ("What product requirement are we specifying?...").
3. Provide a brief answer. Continue the interview to completion.
4. Verify the same flow: summary → v2 PRD block document JSON → browser opens.

**Pass criteria:** same as Scenario A.

### Scenario C — graceful interruption (AC-P6 degradation path)

This scenario covers the AC-P6 requirement: interview interrupted → graceful fallback to plain
authoring → loop still reachable → no crash, no loop, no refusal.

**Sub-scenario C1 — explicit "skip":**
1. Type `/planos-prd "some topic"`.
2. After the first question, type "skip".
3. Verify the agent stops asking questions immediately (no follow-up, no re-prompt).
4. Verify the agent emits a reduced-clarity Crystallized Intent Summary (may be minimal).
5. Verify the agent states it is proceeding with reduced clarity (one sentence), then moves
   directly to Phase 2 without asking the user to confirm the summary.
6. Verify `node bin/planos prd` is invoked and the browser opens (possibly with a minimal
   document containing at least one `openQuestion` block).

**Pass criteria C1:** no hang; no crash; browser opens; loop is reachable; agent did NOT
re-prompt or loop; no reference to `/deep-interview` or `/grill-me`.

**Sub-scenario C2 — "just build it":**
1. Type `/planos-prd "add rate limiting to the API"`.
2. After the first question, type "just build it".
3. Verify identical behaviour to C1 above — agent stops, synthesizes a minimal summary,
   proceeds to Phase 2 authoring, runs `node bin/planos prd`, browser opens.

**Pass criteria C2:** same as C1.

**Sub-scenario C3 — one-word / dismissal answer:**
1. Type `/planos-prd "refactor the database layer"`.
2. After the first question, type a single word such as "yes" or "whatever".
3. Verify the agent treats this as an early-exit signal (or at most asks one more clarifying
   question, then if the pattern continues, exits immediately).
4. Verify the browser opens with a valid (possibly minimal) v2 PRD block document.

**Pass criteria C3:** browser opens; no infinite loop; no crash.

---

## Why PRD mode uses `bin/planos prd` instead of `ExitPlanMode`

PRD authoring is NOT plan mode — there is no `ExitPlanMode` tool call to intercept. The
`PermissionRequest`/`ExitPlanMode` hook in `plugin/hooks/hooks.json` is plan-mode-only and stays
untouched. PRD mode reaches the same `startServer()` round-trip through a new `bin/planos prd`
subcommand (the `prd` case in `plugin/bin/planos`'s switch). The agent is instructed to pipe the
authored JSON directly into this subcommand via stdin (Resolved Decision D4).

Slash commands in Claude Code are loaded from `plugin/commands/*.md` and presented directly to
the live agent — they are not shell commands routed through `bin/planos`. The `.md` file is the
complete deliverable for the command definition; the `bin/planos` dispatcher handles the
subcommand routing.

---

## File ownership

| File | Owner | Purpose |
|------|-------|---------|
| `plugin/commands/planos-prd.md` | Phase 2 / P3.1 | The slash command definition and self-contained prompt |
| `docs/notes/planos-prd-command.md` | Phase 2 / P3.2 | This boundary note |
| `tests/planos-prd-command.test.mjs` | Phase 2 / P3.3 | Automated assertions (file existence, frontmatter, content invariants, v2 schema presence, stdin invocation) |
| `tests/planos-prd-interrupt.test.mjs` | Phase 2 / P3.3 | Automated assertions for the AC-P6 graceful interruption / early-exit path |
