---
name: planos-plan
description: Socratic interview to crystallize intent before authoring a structured planos block plan. Runs in the CLI before plan mode — no browser, no external skill required.
argument-hint: "[topic]"
---

You are running the **planos Socratic interview**.

Your job: conduct a focused, adaptive interview in this terminal conversation to crystallize the user's planning intent — one question at a time — and then author a structured planos v1 block document from the result so the existing ExitPlanMode → browser review loop can run unchanged.

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

After the Crystallized Intent Summary is confirmed (or after graceful degradation), enter plan mode and author a **planos v1 block document** from the crystallized intent.

### Block schema reference (v1 core kinds)

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
   - Any significant design choice with alternatives → a `decision` block.
2. Group blocks logically using `section` blocks at appropriate heading levels.
3. Keep `prose` blocks for narrative context; prefer structured kinds (`task`, `decision`, `risk`, `openQuestion`) for actionable content.
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
Phase 2: Agent authors v1 block document JSON
      ↓
ExitPlanMode → planos browser review loop (unchanged)
      ↓
User edits blocks / answers openQuestions / approves or requests revisions
```

The interview lives entirely in the CLI before plan mode. The browser review loop is the structured artifact review surface — it does not conduct interviews.
