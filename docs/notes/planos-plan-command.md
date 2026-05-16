# `/planos-plan` Command — AC-17 Boundary Note

**US-020 / Milestone 4, Step 4.1**  
**Related:** `plugin/commands/planos-plan.md`, `docs/design.md §5`, consensus plan Step 4.1, AC-15, AC-17.

---

## What the command does

`/planos-plan [topic]` is a Claude Code slash command that instructs the **live agent** in the
terminal to run a Socratic interview before entering plan mode. It is a prompt asset — a
markdown file with YAML frontmatter — that Claude Code loads and presents to the agent when the
user types the command.

The command has two phases:

1. **Phase 1 — Socratic interview (CLI):** The agent asks one question at a time, follows up
   adaptively, surfaces assumptions, and produces a Crystallized Intent Summary when intent is
   clear.
2. **Phase 2 — Block authoring:** The agent authors a planos v1 block document from the
   crystallized summary, then calls `ExitPlanMode` so the existing browser review loop runs.

---

## AC-17 boundary: what is inside vs outside the blocking path

### The invariant (from consensus plan AC-17)

> **No model call inside the blocking `ExitPlanMode` hook path.**

The blocking path is: `bin/planos exit` → `src/hook/exit.mjs` → server bootstrap → decision
promise → stdout flush → `exit(0)`. This path must contain zero network egress, zero agent
invocation, and zero agent-SDK imports in its transitive module graph.

### Where `/planos-plan` sits

```
User types /planos-plan
      ↓
Claude Code loads plugin/commands/planos-plan.md
      ↓
Live agent conducts Socratic interview IN THE TERMINAL  ← OUTSIDE the blocking path
      ↓
Agent authors block document JSON                       ← OUTSIDE the blocking path
      ↓
Agent calls ExitPlanMode  ──────────────────────────────┐
                                                        │ blocking path begins here
      ↓                                                 │
bin/planos exit fires (PermissionRequest hook)          │
      ↓                                                 │
src/hook/exit.mjs: parse stdin, validate, start server  │  no model call here
      ↓                                                 │
Browser opens, user reviews blocks                      │  no model call here
      ↓                                                 │
User POSTs approve or revise                            │  no model call here
      ↓                                                 │
Decision JSON written to stdout, process exits 0        │
                                                        └─ blocking path ends here
```

The `/planos-plan` interview's live-agent calls are **explicitly allowed** — they run in the
CLI before plan mode, initiated by the user, and are never invoked from `bin/planos exit` or
any module in its transitive import graph. They are out of scope of the AC-17 invariant.

### What is forbidden

Any model invocation reachable from:
- `bin/planos exit` (the PermissionRequest hook entrypoint)
- `src/hook/exit.mjs` and all modules it imports
- `src/schema/` (validator, fallback)
- `src/diff/` (structural diff)
- `src/server/` (blocking server)

This is enforced by two AC-17 test layers:
1. **Runtime assertion:** during `bin/planos exit`, a network/process-spawn interceptor asserts
   zero outbound `fetch`/`http(s).request` and zero `child_process` spawn of an agent or
   agent-SDK.
2. **Static import-graph walk:** a real module-graph reachability walk over the transitive
   imports of the blocking-path entrypoint; asserts no agent-SDK or model-client module is in
   that set.

### Self-containment requirement

The `/planos-plan` command must work with no external skill installed. It must not hard-depend
on `/deep-interview`, `/grill-me`, or any other skill from oh-my-claudecode or any third party.
The entire Socratic interview logic is defined inline in `plugin/commands/planos-plan.md`.

---

## Manual smoke test (AC-15 — `[M]` criterion)

AC-15 is a manual acceptance criterion. Run these two scenarios in a real Claude Code session
with the plugin installed (`claude --plugin-dir ./plugin`):

### Scenario A — with topic argument

1. Type `/planos-plan "migrate the auth layer to JWT"`.
2. Verify the agent asks exactly **one** question and waits for an answer.
3. Answer the question. Verify the next turn contains exactly one adaptive follow-up question.
4. Continue until the agent produces the **Crystallized Intent Summary** block.
5. Confirm or correct the summary.
6. Verify the agent emits a v1 block document JSON and calls `ExitPlanMode`.
7. Verify the planos browser review UI opens with the structured block document.

**Pass criteria:** one question per turn throughout; summary produced before block authoring;
browser opens; no crash; no reference to `/deep-interview` or `/grill-me` in any agent turn.

### Scenario B — empty argument (no topic)

1. Type `/planos-plan` (no argument).
2. Verify the agent opens with the empty-argument prompt ("What are we planning?...").
3. Provide a brief answer. Continue the interview to completion.
4. Verify the same flow: summary → block document JSON → browser opens.

**Pass criteria:** same as Scenario A.

### Scenario C — graceful interruption (AC-16 degradation path)

This scenario covers the US-022 / AC-16 requirement: interview interrupted → graceful fallback
to plain authoring → loop still reachable → no crash, no loop, no refusal.

**Sub-scenario C1 — explicit "skip":**
1. Type `/planos-plan "some topic"`.
2. After the first question, type "skip".
3. Verify the agent stops asking questions immediately (no follow-up, no re-prompt).
4. Verify the agent emits a reduced-clarity Crystallized Intent Summary (may be minimal).
5. Verify the agent states it is proceeding with reduced clarity (one sentence), then moves
   directly to Phase 2 without asking the user to confirm the summary.
6. Verify `ExitPlanMode` is called and the browser opens (possibly with a minimal document
   containing at least one `openQuestion` block).

**Pass criteria C1:** no hang; no crash; browser opens; loop is reachable; agent did NOT
re-prompt or loop; no reference to `/deep-interview` or `/grill-me`.

**Sub-scenario C2 — "just build it":**
1. Type `/planos-plan "add rate limiting to the API"`.
2. After the first question, type "just build it".
3. Verify identical behaviour to C1 above — agent stops, synthesizes a minimal summary,
   proceeds to Phase 2 authoring, calls `ExitPlanMode`, browser opens.

**Pass criteria C2:** same as C1.

**Sub-scenario C3 — one-word / dismissal answer:**
1. Type `/planos-plan "refactor the database layer"`.
2. After the first question, type a single word such as "yes" or "whatever".
3. Verify the agent treats this as an early-exit signal (or at most asks one more clarifying
   question, then if the pattern continues, exits immediately).
4. Verify the browser opens with a valid (possibly minimal) block document.

**Pass criteria C3:** browser opens; no infinite loop; no crash.

---

## Why there is no bin/planos dispatch for this command

Slash commands in Claude Code are loaded from `plugin/commands/*.md` and presented directly to
the live agent — they are not shell commands routed through `bin/planos`. The existing
`bin/planos` dispatcher handles only hook subcommands (`enter`, `exit`). Unknown subcommands
already fall through to a graceful stub (`default` case). No dispatch change is needed for
`/planos-plan`; the `.md` file is the complete deliverable.

---

## File ownership

| File | Owner | Purpose |
|------|-------|---------|
| `plugin/commands/planos-plan.md` | US-020 / US-022 | The slash command definition and self-contained prompt |
| `docs/notes/planos-plan-command.md` | US-020 / US-022 | This boundary note |
| `tests/planos-plan-command.test.mjs` | US-020 | Automated assertions (file existence, frontmatter, content invariants, bin/planos regression) |
| `tests/planos-plan-interrupt.test.mjs` | US-022 | Automated assertions for the AC-16 graceful interruption / early-exit path |
