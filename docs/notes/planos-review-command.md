# `/planos-review` Command — gh/git vs AC-17 Boundary Note

**Phase 3 / Milestone R3, Step R3.2**  
**Related:** `plugin/commands/planos-review.md`, `docs/design.md §3`, `docs/design.md §4`, phase3 plan §4.1 (topology), §4.3 (the gh/git-vs-AC-17 boundary analysis — THE crux), §6 (AC-R5, AC-R6, AC-R13), §7 R3, Resolved Decisions R1 (Option A — pre-server CLI), R3 (both sources), R4 (stdin handoff). Parallel to: `docs/notes/planos-prd-command.md`.

---

## What the command does

`/planos-review [PR# | git range]` is a Claude Code slash command that instructs the
**live agent** in the terminal to (1) run a brief scope-grounding interview, (2) run
`gh pr diff <PR#>` or `git diff <range>` **as its own CLI tool use**, and (3) author a
v3 diff-review block document before booting the blocking server. It is a prompt asset —
a markdown file with YAML frontmatter — that Claude Code loads and presents to the agent
when the user types the command.

The command has three phases:

1. **Phase 1 — Brief scope-grounding interview (CLI):** The agent asks one question at a
   time (short and targeted, since the diff is concrete), surfaces assumptions, and
   produces a Review Scope Summary when scope is clear.
2. **Phase 1b — Diff ingestion (CLI, the agent's own tool use):** The agent runs
   `gh pr diff <PR#>` (PR number / `#123` / PR URL) OR `git diff <range>`
   (`main..HEAD`, `HEAD~3`, `abc..def`) as a normal Bash tool call in its own agent loop,
   **before the server boots**. The source is detected by argument shape (R3: both
   supported), exactly as `/planos-prd` branches on empty-vs-topic `$ARGUMENTS`.
3. **Phase 2 — Block authoring + server boot:** The agent normalizes the unified-diff
   text into a v3 diff-review block document (via the pure `src/review/ingest.mjs` parser —
   recommended — or by authoring blocks directly), then pipes it into `bin/planos review`
   via stdin so the blocking server boots and the per-hunk review UI opens. This is NOT an
   `ExitPlanMode` call — diff-review mode reaches the server directly via the CLI
   subcommand (design.md §3; plan §4.2).

---

## The gh/git vs AC-17 boundary — THE crux of Phase 3 (R1 Option A)

### The invariant (from consensus plan AC-17, RE-ASSERTED for diff-review mode)

> **No model call / network egress / agent spawn inside the blocking `bin/planos review` path.**

The blocking path is: `bin/planos review` → `src/hook/review.mjs` → `src/server/` →
`src/schema/` → `src/diff/` → `src/review/ingest.mjs` → stdout flush → `exit(0)`. This
path must contain zero network egress, zero agent invocation, zero agent-SDK imports, and
zero subprocess spawn (except the existing documented browser-opener — ADR-0002,
filesystem/OS-opener ≠ network/model) in its transitive module graph.

### Phase 3's new wrinkle: `gh` and `git` are network/repo subprocesses

Phase 1 + Phase 2 established two documented allowed boundaries: `node:fs` (store) and
`node:child_process` for the OS URL opener (ADR-0002) — filesystem ≠ network/model;
spawning the OS opener ≠ spawning an agent (and the opener makes **no egress from the
planos process**, proven by the AC-17 socket spy).

Phase 3 introduces a genuinely different subprocess: **`gh pr diff` makes a network call
to GitHub**, and **`git diff` reads the repo**. *Where they run is decisive.* If they ran
inside the blocking path, `gh` would cause network egress **attributable to the blocking
round-trip**, forcing the runtime no-egress interceptor to be loosened — directly
weakening the invariant the whole architecture protects (plan §4.3 Position B, rejected).

### Resolved: R1 Option A — `gh`/`git` run in the pre-server CLI agent loop

```
User types /planos-review [PR# | git range]
      ↓
Claude Code loads plugin/commands/planos-review.md
      ↓
Live agent runs the scope-grounding interview IN THE TERMINAL   ← OUTSIDE the blocking path
      ↓
Live agent runs `gh pr diff <PR#>` / `git diff <range>`         ← OUTSIDE the blocking path
  AS ITS OWN Bash TOOL CALL (network/repo touch happens HERE)      (pre-server live-agent)
      ↓
Agent normalizes diff text → v3 diff-review block document JSON  ← OUTSIDE the blocking path
  (optionally shelling to src/review/ingest.mjs — a PURE            (ingest.mjs only
   text→blocks parser: zero node:child_process, zero network)        transforms text)
      ↓
Agent runs: node bin/planos review  (stdin pipe) ──────────────┐
                                                                │ blocking path begins here
      ↓                                                         │
bin/planos review fires (direct CLI subcommand,                 │
  NOT an ExitPlanMode / PermissionRequest hook)                 │
      ↓                                                         │
src/hook/review.mjs: read stdin, validate as diff-review,       │  no gh/git here
  start server                                                  │  no network egress here
      ↓                                                         │  no model call here
Browser opens; user does per-hunk accept/reject/comment         │  no agent spawn here
      ↓                                                         │
User POSTs approve or revise                                    │  no model call here
      ↓                                                         │
On approve: structured review envelope emitted to the agent     │  (R2 = ephemeral —
  (per-hunk verdicts + comments + overall decision)             │   nothing persisted)
      ↓                                                         │
Decision JSON written to stdout, process exits 0                │
                                                                └─ blocking path ends here
```

The `gh pr diff` / `git diff` calls are **explicitly allowed**: they run in the CLI
before the server boots, initiated by the user via the command, and are NEVER invoked
from `bin/planos review` or any module in its transitive import graph. They are the
agent's own tool use — the **exact mirror** of the Socratic interview and of the agent
authoring a PRD before piping to `bin/planos prd` (`docs/notes/planos-prd-command.md`).
The only structural difference vs `/planos-prd` is that the pre-server live-agent surface
additionally includes a `gh`/`git` subprocess; that subprocess is still strictly
pre-server and out of scope of the AC-17 invariant.

`src/review/ingest.mjs` is a **pure text→blocks parser**: it imports nothing (not even a
`node:` builtin), makes zero subprocess calls (zero `node:child_process`), zero network
egress, zero clock/filesystem access. It joins the AC-17-audited transitive set as a
pure-logic leaf, exactly like `src/diff/structural.mjs`. The agent may shell to it in the
pre-server loop as a deterministic helper, but `ingest.mjs` itself never produces the
diff — it only consumes already-captured text.

### What is forbidden

Any model invocation, network egress, agent spawn, or `gh`/`git` subprocess reachable
from:
- `bin/planos review` (the diff-review subcommand entrypoint)
- `src/hook/review.mjs` and all modules it imports
- `src/schema/` (validator, fallback, envelope)
- `src/diff/` (structural diff, reanchor)
- `src/server/` (blocking server)
- `src/review/ingest.mjs` (the pure text→blocks parser — zero `node:child_process` by
  construction)

This is RE-ASSERTED by the two AC-17 test layers (extended for the review entrypoint in
`tests/ac17-invariant.test.mjs` — Milestone R5):
1. **Runtime assertion (LAYER 2c):** during `handleReview`, a network/process-spawn
   interceptor asserts zero outbound `fetch`/`http(s).request`, zero non-loopback
   `node:net`/`node:dns`, and zero `child_process` spawn of any subprocess (so `gh`/`git`
   are proven absent from the blocking round-trip).
2. **Static import-graph walk (LAYER 1b):** a real module-graph reachability walk over
   the transitive imports of `src/hook/review.mjs` and `src/review/ingest.mjs`; asserts
   no agent-SDK / model-client / `node:child_process` module is in that set. The
   `ac17Roots()` list gains the review roots explicitly (dispatcher-independent
   re-assertion, verbatim the Phase-2 P5 reasoning).

### Self-containment requirement

The `/planos-review` command must work with no external skill installed. It must not
hard-depend on `/deep-interview`, `/grill-me`, or any other skill from oh-my-claudecode
or any third party. The entire scope-interview logic, the gh/git ingestion instructions,
and the v3 diff-review schema reference are defined inline in
`plugin/commands/planos-review.md`.

---

## Manual smoke test (AC-R5 / AC-R6 — `[M]` criteria)

AC-R5 and AC-R6 are manual acceptance criteria. Run these scenarios in a real Claude Code
session with the plugin installed (`claude --plugin-dir ./plugin`):

### Scenario A — PR-number argument (AC-R5)

1. Type `/planos-review 482` (or `/planos-review #482`, or a PR URL).
2. Verify the agent asks exactly **one** brief scope question and waits for an answer.
3. Answer it. Verify at most one or two targeted follow-ups, then a Review Scope Summary.
4. Confirm the summary.
5. Verify the agent runs `gh pr diff 482` **as its own Bash tool call** (visible in the
   transcript) — NOT inside `bin/planos review`.
6. Verify the agent emits a v3 diff-review block document JSON (`type: "diff-review"`,
   one `diff` block per file, binary/rename files as empty-`hunks` stubs) and runs
   `node bin/planos review` via stdin.
7. Verify the planos browser review UI opens with the per-hunk accept/reject/comment
   affordances.

**Pass criteria:** one question per turn; short interview; `gh pr diff` runs as the
agent's own pre-server tool use; summary produced before authoring; browser opens; no
crash; no reference to `/deep-interview` or `/grill-me`.

### Scenario B — git-range argument (AC-R5)

1. Type `/planos-review main..HEAD` (or `HEAD~3`, or `abc123..def456`).
2. Verify the same brief-interview flow.
3. Verify the agent runs `git diff main..HEAD` **as its own Bash tool call** (pre-server),
   NOT inside `bin/planos review`.
4. Verify: summary → v3 diff-review block document JSON → `node bin/planos review` via
   stdin → browser opens.

**Pass criteria:** same as Scenario A, with `git diff <range>` as the source.

### Scenario C — graceful interruption (AC-R6 degradation path)

This scenario covers AC-R6: interview interrupted → graceful fallback to reduced-scope
review → loop still reachable → no crash, no loop, no refusal.

**Sub-scenario C1 — explicit "skip":**
1. Type `/planos-review 482`.
2. After the first question, type "skip".
3. Verify the agent stops asking questions immediately (no follow-up, no re-prompt).
   (At most one argument-shape disambiguation question is allowed if the source is still
   unknown — it cannot run `gh`/`git` without a source.)
4. Verify the agent still runs `gh pr diff 482` (pre-server tool use), emits a
   reduced-clarity Review Scope Summary, states it is proceeding with reduced clarity
   (one sentence), then moves directly to Phase 2 without asking the user to confirm.
5. Verify a **minimal valid v3 diff-review document** (the `diff` blocks plus at least
   one `openQuestion`) is piped into `node bin/planos review` and the browser opens.

**Pass criteria C1:** no hang; no crash; browser opens; loop reachable; agent did NOT
re-prompt/loop; no reference to `/deep-interview` or `/grill-me`.

**Sub-scenario C2 — "just review it":**
1. Type `/planos-review main..HEAD`.
2. After the first question, type "just review it".
3. Verify identical behaviour to C1 — agent stops, runs `git diff main..HEAD`,
   synthesizes a minimal scope summary, proceeds to Phase 2 authoring, runs
   `node bin/planos review`, browser opens.

**Pass criteria C2:** same as C1.

**Sub-scenario C3 — one-word / dismissal answer:**
1. Type `/planos-review 991`.
2. After the first question, type a single word such as "yes" or "whatever".
3. Verify the agent treats it as an early-exit signal, runs `gh pr diff 991`, and emits a
   valid (possibly minimal) v3 diff-review document with at least one `openQuestion`.
4. Verify the browser opens.

**Pass criteria C3:** browser opens; no infinite loop; no crash.

**Sub-scenario C4 — ingestion failure (no auth / bad ref):**
1. Type `/planos-review 999999` with a non-existent PR (or `gh` unauthenticated).
2. Verify the agent does NOT crash or abort; it captures the error, authors a minimal
   diff-review document with a `prose` block describing the failure and an `openQuestion`
   asking the user to supply a reachable PR/range, and still pipes to
   `node bin/planos review`.

**Pass criteria C4:** browser opens with the minimal recovery document; no crash; no loop.

---

## Why diff-review mode uses `bin/planos review` instead of `ExitPlanMode`

Diff review is NOT plan mode — there is no `ExitPlanMode` tool call to intercept. The
`PermissionRequest`/`ExitPlanMode` hook in `plugin/hooks/hooks.json` is plan-mode-only and
stays untouched (it declares only `EnterPlanMode` PreToolUse + `ExitPlanMode`
PermissionRequest). Diff-review mode reaches the same `startServer()` round-trip through
the `bin/planos review` subcommand (the `review` case in `plugin/bin/planos`'s switch),
via the SAME provable `resolve(__dirname, '<lit>')` import unwrap as the `prd` case. The
agent is instructed to pipe the authored JSON directly into this subcommand via stdin
(Resolved Decision R4).

Slash commands in Claude Code are loaded from `plugin/commands/*.md` and presented
directly to the live agent — they are not shell commands routed through `bin/planos`. The
`.md` file is the complete deliverable for the command definition; the `bin/planos`
dispatcher handles the subcommand routing.

---

## File ownership

| File | Owner | Purpose |
|------|-------|---------|
| `plugin/commands/planos-review.md` | Phase 3 / R3.1 | The slash command definition and self-contained prompt |
| `docs/notes/planos-review-command.md` | Phase 3 / R3.2 | This gh/git-vs-AC-17 boundary note |
| `tests/planos-review-command.test.mjs` | Phase 3 / R3.3 | Automated assertions (file existence, frontmatter, content invariants, v3 schema presence, stdin invocation, gh/git-pre-server-not-blocking-path boundary) |
| `tests/planos-review-interrupt.test.mjs` | Phase 3 / R3.3 | Automated assertions for the AC-R6 graceful interruption / early-exit path |
