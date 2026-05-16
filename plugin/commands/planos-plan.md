---
name: planos-plan
description: Socratic interview to crystallize intent before authoring a structured planos block plan. Runs in the CLI before plan mode — no browser, no external skill required.
argument-hint: "[topic]"
---

You are running the **planos Socratic interview**.

Your job: conduct a focused, adaptive interview in this terminal conversation to crystallize the user's planning intent — one question at a time — and then author a structured planos block document (v1 core ∪ v2 rich kinds — ADR-0005) from the result so the existing ExitPlanMode → browser review loop can run unchanged.

**Topic (if provided):** $ARGUMENTS

---

## PHASE 1 — Socratic Interview

### Rules (non-negotiable)

1. **One question at a time.** Never list multiple questions in a single turn. Ask one, wait for the answer, then decide the next.
2. **Adaptive follow-ups.** Each answer may reveal a gap, an assumption, or a contradiction — pursue it before moving on.
3. **Expose assumptions explicitly.** When you detect an unstated assumption in an answer, surface it: "You seem to be assuming X — is that correct?" Then resolve it before continuing.
4. **Targeted, not exhaustive.** Do not ask about every possible dimension. Focus on the questions whose answers would materially change the plan's structure or priorities.
5. **No leading questions.** Do not suggest the answer inside the question. Keep questions open or neutrally binary.
6. **Graceful interruption / early-exit (mandatory).** See the dedicated section below — this rule is load-bearing for AC-16.
7. **Ask every question via the `AskUserQuestion` tool — never plain prose.** See the dedicated section below — this rule is load-bearing for the interview UX.

### How to ask each question (AskUserQuestion — load-bearing)

Every interview question MUST be asked through the `AskUserQuestion` tool — never as free prose in the conversation body. A plain-text question is the single most common reason this interview feels flat: the tool is what gives the user the rich, clickable, one-question-at-a-time experience with suggested answers (the same experience a first-class Socratic interview provides).

Rules for each `AskUserQuestion` call:

1. **Exactly one question per call.** One `AskUserQuestion`, one question object — this is how "one question at a time" is enforced mechanically. Never batch.
2. **Always offer 2–4 concrete, contextual options.** Derive them from `$ARGUMENTS` and the answers so far. They must be specific, opinionated, and mutually exclusive — real candidate goals, scopes, or trade-offs — not a generic "Yes / No / Maybe". The user can always pick "Other" and free-type (and attach notes), so options never trap the answer; they accelerate it.
3. **Give every option a one-line `description`** stating what choosing it implies for the resulting plan.
4. **Use a ≤12-char `header`** naming the dimension being probed (e.g. `Goal`, `Scope`, `Constraints`, `Trade-off`, `Risk`).
5. **Adapt from the answer.** The next `AskUserQuestion` must target the weakest or most ambiguous dimension the last answer exposed — do not walk a fixed script.
6. **Early-exit still applies.** If the chosen option or free-text is an interruption signal (see below), stop immediately and follow the graceful-degradation path — do not ask another `AskUserQuestion`.

The interruption fallback path is the one place you may proceed WITHOUT an `AskUserQuestion` (you stop asking entirely). Every other question in this phase — including the opening question and the final "does this capture the intent?" confirmation — goes through `AskUserQuestion`.

### Graceful interruption / early-exit (AC-16 — load-bearing)

This section applies at ANY point during Phase 1 — even on the very first turn.

**Interruption signals.** Treat any of the following as an unconditional early-exit trigger:
- The user types "skip", "stop", "enough", "done", "exit", "abort", or any close variant.
- The user types "just build it", "just do it", "go ahead", "proceed", or any similar instruction to skip the interview and move on.
- The user provides a one-word or one-sentence answer that makes clear they do not want to continue the interview (e.g. "yes", "no", "whatever", a single noun).
- The user stops answering and gives no meaningful reply.
- The user's message is clearly off-topic or is a dismissal of the current question.

**Required behaviour on any interruption signal:**

1. **Stop asking questions immediately.** Do not ask a follow-up. Do not loop. Do not re-prompt for clarification about whether they really want to stop.
2. **Synthesize a best-effort Crystallized Intent Summary** from whatever has been gathered so far — even if that is only the topic argument from `$ARGUMENTS`, a single answer, or nothing at all. Use this reduced-clarity template:

```
=== CRYSTALLIZED INTENT SUMMARY (reduced clarity — interview cut short) ===

GOAL
[Best-effort goal from whatever was gathered, or "Not yet stated — see openQuestion block"]

KEY CONSTRAINTS / NON-GOALS
- [Any gathered, or "None established"]

MAIN DELIVERABLES
- [Any gathered, or "None established — to be filled in the browser UI"]

OPEN QUESTIONS (unresolved, require human input in the plan)
- [Anything unresolved, always include at least one if intent is unclear]

ASSUMPTIONS LOCKED IN
- [Any confirmed, or "None"]
===
```

3. **State explicitly** (one sentence) that you are proceeding with reduced clarity due to the interrupted interview, then continue immediately to Phase 2.
4. **Do not ask the user to confirm the summary** when the interview was interrupted — proceed directly. (Contrast with the full-interview flow where you ask "Does this capture the intent accurately?" — skip that confirmation step on interruption.)
5. **Never refuse. Never crash. Never loop.** Proceed to Phase 2 block authoring unconditionally. The browser review loop MUST always be reachable — it is the recovery surface for gaps left by the interrupted interview.
6. **Self-contained.** This fallback is entirely handled by these instructions. Do not invoke any external skill or slash command to conduct or resume the interview.

### Interview opening

If `$ARGUMENTS` is non-empty, begin with a grounding question about the stated topic. For example: "What does success look like for **$ARGUMENTS** — what would be true when this is done that isn't true today?"

If `$ARGUMENTS` is empty, begin with: "What are we planning? Describe the goal or change in one or two sentences — don't worry about being precise yet."

### Interview closure trigger

Stop the interview and move to Phase 2 when **all** of the following hold:
- The core goal is stated and unambiguous.
- The key constraints or non-goals are known.
- The main deliverables or milestones are identified (at least at a coarse level).
- No open assumption with material planning impact remains unresolved.

You may also stop if the user signals readiness (see graceful degradation above).

Before ending Phase 1, produce a **Crystallized Intent Summary** in this exact format:

```
=== CRYSTALLIZED INTENT SUMMARY ===

GOAL
[1–3 sentences: what we are building/changing and why]

KEY CONSTRAINTS / NON-GOALS
- [constraint or explicit non-goal]
- ...

MAIN DELIVERABLES
- [deliverable or milestone]
- ...

OPEN QUESTIONS (unresolved, require human input in the plan)
- [question, or "none"]

ASSUMPTIONS LOCKED IN
- [assumption surfaced and confirmed, or "none"]
===
```

Present this summary to the user and ask: "Does this capture the intent accurately? Any corrections?" Incorporate any corrections, then proceed to Phase 2.

---

## PHASE 2 — Structured Block Authoring

After the Crystallized Intent Summary is confirmed (or after graceful degradation), enter plan mode and author a **planos block document (v1 core ∪ v2 rich kinds)** from the crystallized intent.

### Block schema reference (v1 core kinds + v2 rich kinds)

Every block must have a stable `id` (a short, descriptive slug, e.g. `"goal-auth-rewrite"`) and a `kind`. The document wraps all blocks.

```jsonc
Document {
  schemaVersion: 1,
  type: "plan",
  id: "<document-slug>",        // stable across revisions — revision-chain key
  title: "<plan title>",
  meta: {
    branch: "<git branch or null>",
    status: "draft",
    createdAt: "<ISO timestamp>",
    revision: 1
  },
  blocks: [ /* Block[] */ ]
}

// v1 block kinds:

section        { id, kind: "section", title, level: 1|2|3, collapsed?: false }
prose          { id, kind: "prose", md: "<markdown text>" }
objective      { id, kind: "objective", text: "<goal statement>",
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

// v2 rich kinds (valid in type:"plan" too — ADR-0005). Use these to make
// the plan VISUALLY APPROVABLE in one glance, not a wall of prose:

phase          { id, kind: "phase", title: "<phase name>",
                 taskIds: ["<block-id>", ...] }
                 // taskIds lists ids of task blocks belonging to this phase.
                 // Referential integrity is agent-authored (like task.deps).

tradeoff       { id, kind: "tradeoff", axis: "<decision axis>",
                 options: [{ label: "<option label>",
                              score?: <number>,
                              note?: "<note>" }, ...] }
                 // At least one option required. score optional (any number).

fileChange     { id, kind: "fileChange", path: "<file path>",
                 action: "add"|"modify"|"delete",
                 rationale: "<why this file changes>" }

code           { id, kind: "code", lang: "<language>", content: "<code text>",
                 filename?: "<optional filename>" }
                 // content may be empty string (placeholder). lang non-empty.

table          { id, kind: "table", columns: ["<col>", ...],
                 rows: [["<cell>", ...], ...] }
                 // columns non-empty string array. Each row length must
                 // equal columns.length.

diagram        { id, kind: "diagram", mermaid: "<mermaid source>" }
                 // mermaid non-empty. Rendered as a Mermaid diagram in the
                 // SPA (bundled renderer — fully offline, no CDN).
```

### ID rules (critical for stability across revisions)

- Assign a short, descriptive, kebab-case `id` to every block (e.g. `"task-wire-auth-hook"`, `"risk-db-migration"`).
- IDs must be **unique within the document**.
- When revising this document later: **REUSE the `id` of any block whose intent is unchanged**. Only mint a new `id` for a genuinely new block. Never renumber existing blocks.

### Authoring instructions

1. Translate the Crystallized Intent Summary directly into blocks:
   - The GOAL → one `objective` block (with success criteria derived from the interview).
   - Each MAIN DELIVERABLE → a `section` + one or more `task` blocks.
   - Each KEY CONSTRAINT / NON-GOAL → a `prose` block under a "Constraints & Non-Goals" section.
   - Each OPEN QUESTION → an `openQuestion` block (leave `answer: null` for the human to fill in the browser UI).
   - Material risks surfaced during the interview → `risk` blocks.
   - Any significant design choice with alternatives → a `decision` block; if the choice has weighted/scored options along one axis, prefer a `tradeoff` block.
   - Every file you expect to add/modify/delete → a `fileChange` block (one per path) so the reviewer sees the blast radius at a glance.
   - Architecture, control flow, sequence, or state transitions → a `diagram` block (Mermaid source) — this is the single highest-value block for one-glance human approval.
   - Comparison/matrix data (option grids, before/after, coverage) → a `table` block.
   - Important scaffolding or signature-level snippets → a `code` block.
   - Delivery milestones → `phase` blocks listing their `task` block ids.
2. Group blocks logically using `section` blocks at appropriate heading levels.
3. **Author for visual approvability.** A reviewer should be able to approve or request changes by *scanning*, not deep-reading. Lead with a `diagram` and/or `table` where one would replace a paragraph; keep `prose` for genuine narrative only; prefer structured kinds (`task`, `decision`, `tradeoff`, `fileChange`, `risk`, `openQuestion`) over prose for anything actionable or comparative.
4. Emit the document as valid JSON inside a fenced code block:

```json
{
  "schemaVersion": 1,
  "type": "plan",
  ...
}
```

5. After emitting the block document JSON, call `ExitPlanMode` so the existing planos browser review loop opens. The user will then edit blocks, answer open questions, and approve or request revisions — all in the browser UI.

### Graceful fallback (interruption path)

If Phase 1 was interrupted (see the "Graceful interruption / early-exit" section above), proceed here unconditionally with the best-effort Crystallized Intent Summary already synthesized. Do NOT loop back to ask more questions.

- If a goal was partially established, translate it into blocks as best you can.
- If almost nothing was established, emit a minimal document with at least one `openQuestion` block asking the user to describe their goal — the browser review loop is the recovery surface for all remaining gaps.
- Always emit a valid JSON block document and always call `ExitPlanMode`. Never fail; never crash; never refuse to proceed; always reach `ExitPlanMode`.

---

## Summary of the flow

```
/planos-plan [topic]
      ↓
Phase 1: Socratic interview (CLI, this conversation, one Q at a time)
      ↓
Crystallized Intent Summary (confirmed with user)
      ↓
Phase 2: Agent authors block document JSON (v1 ∪ v2 rich kinds)
      ↓
ExitPlanMode → planos browser review loop (unchanged)
      ↓
User edits blocks / answers openQuestions / approves or requests revisions
```

The interview lives entirely in the CLI before plan mode. The browser review loop is the structured artifact review surface — it does not conduct interviews.
