---
name: planos-review
description: Brief scope-grounding interview, then ingest a GitHub PR or local git range diff and author a structured planos v3 diff-review block document for per-hunk review. Runs in the CLI before the blocking server — no browser, no external skill required.
argument-hint: "[PR# | git range]"
---

You are running the **planos diff-review ingestion + authoring command**.

Your job: ground the review scope with a brief interview in this terminal conversation, then run `gh pr diff <PR#>` OR `git diff <range>` **as your own CLI tool use**, normalize the resulting unified-diff text into a structured planos **v3 diff-review block document**, and pipe it into `bin/planos review` so the blocking server round-trip can run and the per-hunk review UI opens.

**Argument (if provided):** $ARGUMENTS

---

## Argument shape detection (PR# vs git range vs empty)

Detect what `$ARGUMENTS` is **by its shape**, exactly as the planos PRD command branches on empty-vs-topic `$ARGUMENTS`:

- **A PR number** — `$ARGUMENTS` is a bare integer (`123`), a hash-prefixed integer (`#123`), or a GitHub pull-request URL (`https://github.com/<owner>/<repo>/pull/123`). → This is a **PR review**. In Phase 1b you will run `gh pr diff <PR#>` (extract the integer from `#123` / the URL).
- **A git range** — `$ARGUMENTS` looks like a git revision range or revspec: contains `..` (`main..HEAD`, `abc123..def456`), is a `HEAD~N` form (`HEAD~3`), a single ref/sha, or any other `git diff`-acceptable argument that is not a PR number. → This is a **local range review**. In Phase 1b you will run `git diff <range>`.
- **Empty** — `$ARGUMENTS` is empty. → Ask the user, as the very first interview question: "Which PR or git range should I review? Give me a PR number (e.g. `123`) or a git range (e.g. `main..HEAD`)." Once they answer, re-apply the shape detection above to their reply.

If the shape is genuinely ambiguous (e.g. a value that could be a branch name or a PR slug), ask exactly one clarifying question: "Is `<value>` a GitHub PR number or a git range?" — then proceed. Do not loop on this.

Both sources are supported. The downstream parser is source-agnostic: `gh pr diff` and `git diff` both emit unified-diff text.

---

## PHASE 1 — Brief scope-grounding interview

The diff is concrete, so this interview is **short and targeted** — not the open-ended product discovery of a PRD. Its only purpose is to ground *what to focus the review on*.

### Rules (non-negotiable)

1. **One question at a time.** Never list multiple questions in a single turn. Ask one, wait for the answer, then decide the next.
2. **Adaptive follow-ups.** An answer may reveal a focus area, a risk, or a constraint worth one more question — pursue it before moving on.
3. **Targeted, not exhaustive.** Keep it to the **minimum** needed to scope the review. Two or three questions is typical; one is often enough. Do not interrogate.
4. **Expose assumptions explicitly.** If an answer carries an unstated assumption that would change the review's focus, surface it: "You seem to be assuming X — is that the scope you want?" Then resolve it.
5. **No leading questions.** Keep questions open or neutrally binary.
6. **Graceful interruption / early-exit (mandatory).** See the dedicated section below — this rule is load-bearing for AC-R6.
7. **Ask every question via the `AskUserQuestion` tool — never plain prose.** See the dedicated section below — this rule is load-bearing for the interview UX.

### How to ask each question (AskUserQuestion — load-bearing)

Every interview question MUST be asked through the `AskUserQuestion` tool — never as free prose in the conversation body. A plain-text question is the single most common reason this interview feels flat: the tool is what gives the user the rich, clickable, one-question-at-a-time experience with suggested answers (the same experience a first-class Socratic interview provides).

Rules for each `AskUserQuestion` call:

1. **Exactly one question per call.** One `AskUserQuestion`, one question object — this is how "one question at a time" is enforced mechanically. Never batch.
2. **Always offer 2–4 concrete, contextual options.** Derive them from `$ARGUMENTS` and the diff/PR context. They must be specific and mutually exclusive — real candidate review focuses (e.g. `Correctness`, `Security`, a named subsystem, `General pass`) — not a generic "Yes / No / Maybe". The user can always pick "Other" and free-type (and attach notes), so options never trap the answer; they accelerate it.
3. **Give every option a one-line `description`** stating what choosing it implies for the review focus.
4. **Use a ≤12-char `header`** naming the dimension being probed (e.g. `Focus`, `Source`, `Scope`, `Risk`).
5. **Adapt from the answer.** Any follow-up `AskUserQuestion` must target the weakest or most ambiguous dimension the last answer exposed — keep it to the minimum needed to scope the review.
6. **Early-exit still applies.** If the chosen option or free-text is an interruption signal (see below), stop immediately and follow the graceful-degradation path — do not ask another `AskUserQuestion`.

The interruption fallback path is the one place you may proceed WITHOUT an `AskUserQuestion` (you stop asking entirely). The single argument-shape disambiguation question must also go through `AskUserQuestion`. Every other question in this phase — including the opening focus question and the final "does this capture the review scope?" confirmation — goes through `AskUserQuestion`.

### Graceful interruption / early-exit (AC-R6 — load-bearing)

This section applies at ANY point during Phase 1 — even on the very first turn.

**Interruption signals.** Treat any of the following as an unconditional early-exit trigger:
- The user types "skip", "stop", "enough", "done", "exit", "abort", or any close variant.
- The user types "just review it", "just do it", "go ahead", "proceed", or any similar instruction to skip the interview and move on.
- The user provides a one-word or one-sentence answer that makes clear they do not want to continue the interview (e.g. "yes", "no", "whatever", a single noun).
- The user stops answering and gives no meaningful reply.
- The user's message is clearly off-topic or is a dismissal of the current question.

**Required behaviour on any interruption signal:**

1. **Stop asking questions immediately.** Do not ask a follow-up. Do not loop. Do not re-prompt for clarification about whether they really want to stop. (The one allowed exception is the single argument-shape disambiguation question above, if the source is still unknown — you cannot run `gh`/`git` without knowing the source. After at most one such question, proceed regardless.)
2. **Synthesize a best-effort Review Scope Summary** from whatever has been gathered so far — even if that is only the argument from `$ARGUMENTS`, a single answer, or nothing at all. Use this reduced-clarity template:

```
=== REVIEW SCOPE SUMMARY (reduced clarity — interview cut short) ===

SOURCE
[PR #<n> via `gh pr diff`  |  git range `<range>` via `git diff`  |  "Unknown — see openQuestion block"]

REVIEW FOCUS
[Best-effort focus from whatever was gathered, or "General correctness review — focus unspecified; see openQuestion block"]

KNOWN CONSTRAINTS / CALLOUTS
- [Any gathered, or "None established"]

OPEN QUESTIONS (unresolved, require human input in the review UI)
- [Anything unresolved, always include at least one if scope is unclear]
===
```

3. **State explicitly** (one sentence) that you are proceeding with reduced clarity due to the interrupted interview, then continue immediately to Phase 1b.
4. **Do not ask the user to confirm the summary** when the interview was interrupted — proceed directly. (Contrast with the full-interview flow where you ask "Does this capture the review scope?" — skip that confirmation step on interruption.)
5. **Never refuse. Never crash. Never loop.** Proceed to Phase 1b ingestion and Phase 2 authoring unconditionally. The browser review loop MUST always be reachable — it is the recovery surface for any scope gaps left by the interrupted interview.
6. **Self-contained.** This fallback is entirely handled by these instructions. Do not invoke any external skill or slash command to conduct or resume the interview.

### Interview opening

If `$ARGUMENTS` is a PR number, begin with a grounding question such as: "What should I focus on while reviewing **PR #<n>** — correctness, security, a specific subsystem, or a general pass?"

If `$ARGUMENTS` is a git range, begin with: "What should I focus on while reviewing **`<range>`** — correctness, security, a specific subsystem, or a general pass?"

If `$ARGUMENTS` is empty, begin with the source question from the argument-shape section ("Which PR or git range should I review?").

### Interview closure trigger

Stop the interview and move to Phase 1b when **all** of the following hold:
- The review source (PR# or git range) is known and unambiguous.
- The review focus is clear at least at a coarse level (or the user explicitly wants a general pass).
- No open assumption that would materially change the review's focus remains unresolved.

You may also stop if the user signals readiness (see graceful interruption above).

Before ending Phase 1, produce a **Review Scope Summary** in this exact format:

```
=== REVIEW SCOPE SUMMARY ===

SOURCE
[PR #<n> via `gh pr diff`  |  git range `<range>` via `git diff`]

REVIEW FOCUS
[1–3 sentences: what to concentrate the review on and why]

KNOWN CONSTRAINTS / CALLOUTS
- [constraint or specific area to flag]
- ...

OPEN QUESTIONS (unresolved, require human input in the review UI)
- [question, or "none"]
===
```

Present this summary and ask: "Does this capture the review scope? Any corrections?" Incorporate any corrections, then proceed to Phase 1b.

---

## PHASE 1b — Ingest the diff (YOUR OWN CLI TOOL USE — pre-server)

**This step is your own tool use in this CLI agent loop, BEFORE the blocking server boots.** It is the exact mirror of the Socratic interview itself: a legitimate pre-server live-agent action. `gh pr diff` makes a network call to GitHub; `git diff` reads the local repo. Both are run **by you, here, as a normal Bash tool call** — they are NEVER invoked from inside `bin/planos review` and NEVER from any module in its blocking transitive import graph. The blocking path stays model-free, network-free, and spawn-free (the planos AC-17 invariant). Do not, under any circumstance, instruct or arrange for `gh`/`git` to run inside `bin/planos review`.

Run exactly one of the following, based on the detected argument shape, as a Bash tool call:

- **PR review:** `gh pr diff <PR#>` (use the integer extracted from `123` / `#123` / the PR URL). Capture its stdout — this is the unified-diff text.
- **Git-range review:** `git diff <range>` (e.g. `git diff main..HEAD`, `git diff HEAD~3`, `git diff abc123..def456`). Capture its stdout — this is the unified-diff text.

If the command fails (no `gh` auth, unknown PR, bad range, not a git repo), do **not** crash or abort the flow:
- Capture the error text.
- Proceed to Phase 2 and author a **minimal valid v3 diff-review document** containing a `prose` block describing what was attempted and the error, plus at least one `openQuestion` block asking the user to supply a reachable PR/range or fix auth. Still pipe it to `bin/planos review` (the review UI is the recovery surface). Never refuse; never crash; never loop.

---

## PHASE 2 — Structured v3 diff-review block authoring

After ingestion, normalize the unified-diff text into a **planos v3 diff-review block document** (`type: "diff-review"`).

You have two equivalent ways to produce the `diff` blocks; **prefer the parser for fidelity**:

1. **Recommended — shell to the repo's pure ingest parser.** `src/review/ingest.mjs` is a pure text→blocks parser (zero `node:child_process`, zero network — it only transforms text). Feed it the captured diff text and emit deterministic, schema-correct `diff` blocks (with stable per-hunk `hunkId`s). For example, from the repo root, with the diff text in a file `/tmp/planos-review.diff`:

   ```sh
   node -e 'import("./src/review/ingest.mjs").then(async m => { const fs=await import("node:fs"); const t=fs.readFileSync("/tmp/planos-review.diff","utf8"); process.stdout.write(JSON.stringify(m.ingestUnifiedDiff(t, { idPrefix: "dr" }))); })'
   ```

   `ingestUnifiedDiff(diffText, { idPrefix?, maxLinesPerHunk? })` returns an array of v3 `diff` blocks: one block per file, with `path`, `status`, `hunks[]` (each with a deterministic opaque `hunkId`), and `comments: []`. Binary/rename files come back with empty `hunks: []` and the right `status`. Oversized hunks are elided with an explicit "N lines elided" marker (R6 — degrade, never block). This invocation is still your own pre-server CLI tool use; `src/review/ingest.mjs` only transforms text and runs no subprocess.

2. **Alternative — author the `diff` blocks directly** following the embedded schema below. Use this if the parser is unavailable. Mint hunk/comment ids as opaque, stable tokens per the ID rules.

Wrap the `diff` blocks (plus review narrative) in a v3 diff-review document and add the review framing.

### v3 diff-review block schema reference (v1 core kinds ∪ v3 `diff`)

A `type: "diff-review"` document accepts the **v1 core kinds** (`section`, `prose`, `objective`, `task`, `decision`, `risk`, `openQuestion`) plus the **v3 `diff`** kind. v2 PRD kinds (`phase`, `tradeoff`, `fileChange`, `code`, `table`, `diagram`) are **REJECTED** in a diff-review document — `fileChange` in particular is deliberately excluded (a *planned* change with a rationale is semantically distinct from a *concrete* `diff` block holding actual hunks).

Every block must have a stable opaque `id` and a `kind`. The document wraps all blocks.

```jsonc
Document {
  schemaVersion: 1,
  type: "diff-review",
  id: "<document-slug>",          // stable across revisions — revision-chain key
  title: "<review title>",
  meta: {
    branch: "<git branch or null>",
    status: "draft",
    createdAt: "<ISO timestamp>",
    revision: 1
  },
  blocks: [ /* Block[] */ ]
}

// v1 core block kinds (accepted in type:"diff-review" documents):

section        { id, kind: "section", title, level: 1|2|3, collapsed?: false }
prose          { id, kind: "prose", md: "<markdown text>" }
objective      { id, kind: "objective", text: "<review goal>",
                 successCriteria: ["<criterion>", ...] }
task           { id, kind: "task", title, detail?: "<description>",
                 status: "todo"|"doing"|"done"|"cut",
                 deps: ["<block-id>", ...],
                 acceptance: ["<criterion>", ...],
                 estimate?: "<rough estimate>" }
decision       { id, kind: "decision", question: "<decision prompt>",
                 options: [{ label, pros?: ["..."], cons?: ["..."] }],
                 chosen?: "<label>", rationale?: "<why>" }
risk           { id, kind: "risk", description: "<risk>",
                 likelihood: "L"|"M"|"H",
                 impact: "L"|"M"|"H",
                 mitigation: "<mitigation>" }
openQuestion   { id, kind: "openQuestion", question: "<question>",
                 answer?: null }

// v3 block kind (diff-review-scoped — only valid in type:"diff-review" documents):

diff           { id, kind: "diff",
                 path: "<file path>",                       // required, non-empty
                 status?: "added"|"modified"|"deleted"|"renamed"|"binary",
                 oldPath?: "<old path>",                     // present only when status==="renamed"
                 hunks: Hunk[],                              // required; may be [] for binary/rename
                 comments: BlockComment[] }                  // required; [] at ingestion (human fills in UI)

Hunk           { header: "<the @@ -a,b +c,d @@ line, may carry a section heading>",
                 oldStart: <integer>,
                 oldLines: <integer ≥ 0>,
                 newStart: <integer>,
                 newLines: <integer ≥ 0>,
                 lines: DiffLine[],
                 hunkId: "<non-empty, opaque, stable within the block>" }
                 // hunkId is the per-hunk anchor for accept/reject/comment.
                 // Mint it deterministically (e.g. "<blockId>-h<n>"); opaque
                 // and stable across revisions exactly like a block id.

DiffLine       { op: " " | "+" | "-",                       // context | added | removed
                 text: "<line content WITHOUT the leading op char; may be empty>" }

BlockComment   { commentId: "<non-empty, stable>",
                 hunkId: "<the Hunk.hunkId this anchors to>" | null,  // null = file-level comment
                 text: "<non-empty comment text>",
                 verdict: "accept" | "reject" | "comment" }
                 // The per-hunk review verdict carried alongside the comment.
                 // At ingestion comments[] is ALWAYS []; the human adds
                 // accept/reject/comment in the review UI.
```

### Worked v3 diff-review example

```json
{
  "schemaVersion": 1,
  "type": "diff-review",
  "id": "review-pr-482",
  "title": "Review — PR #482: rate-limit middleware",
  "meta": {
    "branch": "feat/rate-limit",
    "status": "draft",
    "createdAt": "2026-05-16T10:00:00.000Z",
    "revision": 1
  },
  "blocks": [
    {
      "id": "sec-overview",
      "kind": "section",
      "title": "Review scope",
      "level": 1
    },
    {
      "id": "prose-scope",
      "kind": "prose",
      "md": "Reviewing PR #482 (`gh pr diff 482`). Focus: correctness of the token-bucket math and that the limiter fails open, not closed, on Redis errors."
    },
    {
      "id": "dr-1",
      "kind": "diff",
      "path": "src/middleware/rateLimit.ts",
      "status": "added",
      "hunks": [
        {
          "header": "@@ -0,0 +1,7 @@",
          "oldStart": 0,
          "oldLines": 0,
          "newStart": 1,
          "newLines": 7,
          "hunkId": "dr-1-h1",
          "lines": [
            { "op": "+", "text": "export function rateLimit(key, max, windowMs) {" },
            { "op": "+", "text": "  const now = Date.now();" },
            { "op": "+", "text": "  const bucket = buckets.get(key) ?? { tokens: max, ts: now };" },
            { "op": "+", "text": "  const refill = ((now - bucket.ts) / windowMs) * max;" },
            { "op": "+", "text": "  bucket.tokens = Math.min(max, bucket.tokens + refill);" },
            { "op": "+", "text": "  bucket.ts = now;" },
            { "op": "+", "text": "  return bucket.tokens-- >= 1;" }
          ]
        }
      ],
      "comments": []
    },
    {
      "id": "dr-2",
      "kind": "diff",
      "path": "assets/logo.png",
      "status": "binary",
      "hunks": [],
      "comments": []
    },
    {
      "id": "oq-failmode",
      "kind": "openQuestion",
      "question": "On a Redis connection error, should the limiter fail open (allow) or fail closed (deny)? The diff does not handle this path.",
      "answer": null
    }
  ]
}
```

### ID rules (critical for stability across revisions)

- Assign a short, descriptive, opaque, kebab-case `id` to every block (e.g. `"prose-scope"`, `"dr-1"`, `"oq-failmode"`). When using the ingest parser, the parser mints stable `diff` block ids (`dr-1`, `dr-2`, …) and stable `hunkId`s (`dr-1-h1`, …) for you — reuse them verbatim.
- IDs must be **unique within the document**. `hunkId`s must be unique within their `diff` block; `commentId`s unique within the document.
- When revising this document later: **REUSE the `id` of any block whose intent is unchanged**, and reuse `hunkId`/`commentId` for any hunk/comment that still anchors the same content. Only mint a new id for a genuinely new block/hunk/comment. Never renumber existing blocks.
- The document-level `id` (e.g. `"review-pr-482"`) is the **revision-chain key** — it must never change across revisions of the same review. The `meta.revision` integer increments; the document `id` stays fixed.

### Authoring instructions

1. Emit the `diff` blocks — one per changed file — from the ingest parser output (recommended) or authored directly per the schema above. Preserve every file, including binary/rename stubs with empty `hunks: []`.
2. Add review framing around the diff blocks:
   - A `section` block titled e.g. "Review scope" and a `prose` block restating the Review Scope Summary (source + focus).
   - Each unresolved OPEN QUESTION from the scope summary → an `openQuestion` block (leave `answer: null` for the human to fill in the review UI).
   - Material correctness/security concerns you can already see in the diff → `risk` blocks (optional; the human refines them and adds per-hunk verdicts in the UI).
3. Leave every `diff` block's `comments` array as `[]`. Per-hunk accept/reject/comment is the human's job in the review UI; the structured review envelope carries those verdicts back to you afterward.
4. Emit the document as valid JSON inside a fenced code block:

```json
{
  "schemaVersion": 1,
  "type": "diff-review",
  ...
}
```

5. After emitting the v3 diff-review block document JSON, **pipe it into `bin/planos review` via stdin** to boot the blocking server and open the per-hunk review UI. Run this exact shell invocation (replacing the JSON with your authored document):

```sh
echo '<your-authored-v3-diff-review-json>' | node ${CLAUDE_PLUGIN_ROOT}/bin/planos review
```

Or equivalently, use a heredoc for multi-line JSON (from the repo root, `node bin/planos review` works too):

```sh
node ${CLAUDE_PLUGIN_ROOT}/bin/planos review << 'PLANOS_REVIEW_EOF'
{
  "schemaVersion": 1,
  "type": "diff-review",
  ...
}
PLANOS_REVIEW_EOF
```

The `bin/planos review` command reads the JSON document from stdin (R4 — stdin handoff), validates it as a v3 diff-review document, boots the blocking server, opens the browser review UI with per-hunk accept/reject/comment affordances, and blocks until the reviewer approves or requests revisions. It performs NO `gh`/`git` call, NO network egress, NO model invocation, NO agent spawn — ingestion already happened in Phase 1b as your own pre-server CLI tool use. Do NOT call `ExitPlanMode` — diff-review mode reaches the server directly via this CLI invocation, not through the ExitPlanMode hook.

### Graceful fallback (interruption path)

If Phase 1 was interrupted (see the "Graceful interruption / early-exit" section above) — or if Phase 1b ingestion failed — proceed here unconditionally with the best-effort Review Scope Summary already synthesized. Do NOT loop back to ask more questions.

- If the diff was ingested, emit the `diff` blocks plus a minimal `prose`/`openQuestion` framing.
- If ingestion failed or almost nothing was established, emit a **minimal valid v3 diff-review document** with at least one `prose` block describing what was attempted and at least one `openQuestion` block asking the user to clarify the source/scope — the browser review loop is the recovery surface for all remaining gaps.
- Always emit a valid JSON block document and always run `bin/planos review` via stdin. Never fail; never crash; never refuse to proceed; always reach the server boot step.

---

## Summary of the flow

```
/planos-review [PR# | git range]
      ↓
Argument-shape detection (PR# → gh pr diff | range → git diff | empty → ask)
      ↓
Phase 1: Brief scope-grounding interview (CLI, this conversation, one Q at a time)
      ↓
Review Scope Summary (confirmed with user)
      ↓
Phase 1b: Agent runs gh pr diff <PR#> / git diff <range>  ← agent's OWN pre-server CLI tool use
      ↓
Phase 2: Agent normalizes unified-diff → v3 diff-review block document JSON
      ↓   (via src/review/ingest.mjs pure parser — recommended — or direct authoring)
Agent pipes JSON into: node bin/planos review  (via stdin)
      ↓
bin/planos review → blocking server boots → per-hunk review UI opens
      ↓   (NO gh/git/network/model/spawn inside this blocking path)
User accepts/rejects/comments per hunk / answers openQuestions / approves or requests revisions
```

The interview AND the `gh`/`git` ingestion both live entirely in the CLI before the server boots — the exact mirror of authoring a PRD before piping to `bin/planos prd`. The browser review loop is the structured artifact review surface — it does not conduct interviews and it never shells out to `gh`/`git`.
