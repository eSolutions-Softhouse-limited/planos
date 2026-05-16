---
name: planos-prd
description: Socratic interview to crystallize intent before authoring a structured planos v2 PRD block document. Runs in the CLI before the blocking server — no browser, no external skill required.
argument-hint: "[topic]"
---

You are running the **planos PRD Socratic interview**.

Your job: conduct a focused, adaptive interview in this terminal conversation to crystallize the user's product requirements intent — one question at a time — and then author a structured planos v2 PRD block document from the result so the `bin/planos prd` blocking server round-trip can run.

**Topic (if provided):** $ARGUMENTS

---

## PHASE 1 — Socratic Interview

### Rules (non-negotiable)

1. **One question at a time.** Never list multiple questions in a single turn. Ask one, wait for the answer, then decide the next.
2. **Adaptive follow-ups.** Each answer may reveal a gap, an assumption, or a contradiction — pursue it before moving on.
3. **Expose assumptions explicitly.** When you detect an unstated assumption in an answer, surface it: "You seem to be assuming X — is that correct?" Then resolve it before continuing.
4. **Targeted, not exhaustive.** Do not ask about every possible dimension. Focus on the questions whose answers would materially change the PRD's structure or priorities.
5. **No leading questions.** Do not suggest the answer inside the question. Keep questions open or neutrally binary.
6. **Graceful interruption / early-exit (mandatory).** See the dedicated section below — this rule is load-bearing for AC-P6.

### Graceful interruption / early-exit (AC-P6 — load-bearing)

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

OPEN QUESTIONS (unresolved, require human input in the PRD)
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

If `$ARGUMENTS` is empty, begin with: "What product requirement are we specifying? Describe the goal or change in one or two sentences — don't worry about being precise yet."

### Interview closure trigger

Stop the interview and move to Phase 2 when **all** of the following hold:
- The core goal is stated and unambiguous.
- The key constraints or non-goals are known.
- The main deliverables or phases are identified (at least at a coarse level).
- Material design trade-offs and file-level changes are surfaced where known.
- No open assumption with material PRD impact remains unresolved.

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
- [deliverable or phase]
- ...

OPEN QUESTIONS (unresolved, require human input in the PRD)
- [question, or "none"]

ASSUMPTIONS LOCKED IN
- [assumption surfaced and confirmed, or "none"]
===
```

Present this summary to the user and ask: "Does this capture the intent accurately? Any corrections?" Incorporate any corrections, then proceed to Phase 2.

---

## PHASE 2 — Structured Block Authoring

After the Crystallized Intent Summary is confirmed (or after graceful degradation), author a **planos v2 PRD block document** from the crystallized intent.

### Block schema reference (v1 core kinds + v2 PRD kinds)

Every block must have a stable `id` (a short, descriptive, kebab-case slug, e.g. `"goal-auth-rewrite"`) and a `kind`. The document wraps all blocks.

```jsonc
Document {
  schemaVersion: 1,
  type: "prd",
  id: "<document-slug>",        // stable across revisions — revision-chain key
  title: "<PRD title>",
  meta: {
    branch: "<git branch or null>",
    status: "draft",
    createdAt: "<ISO timestamp>",
    revision: 1
  },
  blocks: [ /* Block[] */ ]
}

// v1 block kinds (accepted in type:"prd" documents):

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

// v2 block kinds (PRD-scoped — only valid in type:"prd" documents):

phase          { id, kind: "phase", title: "<phase name>",
                 taskIds: ["<block-id>", ...] }
                 // taskIds lists ids of task blocks belonging to this phase.
                 // Referential integrity is agent-authored (like task.deps in v1)
                 // — no hard validator check.

tradeoff       { id, kind: "tradeoff", axis: "<decision axis>",
                 options: [{ label: "<option label>",
                              score?: <number>,
                              note?: "<note>" }, ...] }
                 // At least one option required. score is optional (0-10 or any number).

fileChange     { id, kind: "fileChange", path: "<file path>",
                 action: "add"|"modify"|"delete",
                 rationale: "<why this file changes>" }

code           { id, kind: "code", lang: "<language>", content: "<code text>",
                 filename?: "<optional filename>" }
                 // content may be empty string (placeholder). lang must be non-empty.

table          { id, kind: "table", columns: ["<col>", ...],
                 rows: [["<cell>", ...], ...] }
                 // columns must be non-empty string array.
                 // Each row must be a string array with exactly columns.length cells.

diagram        { id, kind: "diagram", mermaid: "<mermaid source>" }
                 // mermaid must be a non-empty string. Rendered as a Mermaid diagram
                 // in the SPA (bundled renderer — fully offline, no CDN).
```

### Worked v2 PRD example

```json
{
  "schemaVersion": 1,
  "type": "prd",
  "id": "prd-auth-overhaul",
  "title": "Auth Layer Overhaul — v2 PRD",
  "meta": {
    "branch": "feat/auth-v2",
    "status": "draft",
    "createdAt": "2026-05-16T10:00:00.000Z",
    "revision": 1
  },
  "blocks": [
    {
      "id": "obj-auth-overhaul",
      "kind": "objective",
      "text": "Replace session-cookie auth with JWT-based stateless auth to unblock horizontal scaling.",
      "successCriteria": [
        "All API endpoints accept valid JWTs",
        "Session cookies rejected at the gateway",
        "Token refresh flow implemented and tested"
      ]
    },
    {
      "id": "phase-foundation",
      "kind": "phase",
      "title": "Foundation",
      "taskIds": ["task-jwt-middleware", "task-token-refresh"]
    },
    {
      "id": "task-jwt-middleware",
      "kind": "task",
      "title": "Wire JWT middleware",
      "detail": "Add express-jwt or equivalent; verify on all protected routes.",
      "status": "todo",
      "deps": [],
      "acceptance": ["All protected routes return 401 without a valid JWT"],
      "estimate": "2d"
    },
    {
      "id": "task-token-refresh",
      "kind": "task",
      "title": "Implement token refresh endpoint",
      "detail": "POST /auth/refresh; sliding-window expiry.",
      "status": "todo",
      "deps": ["task-jwt-middleware"],
      "acceptance": ["Refresh returns a new access token; expired refresh → 401"],
      "estimate": "1d"
    },
    {
      "id": "tradeoff-token-lifetime",
      "kind": "tradeoff",
      "axis": "Access token lifetime",
      "options": [
        { "label": "15 min", "score": 9, "note": "Short window limits blast radius on leak" },
        { "label": "1 hour", "score": 6, "note": "Fewer refreshes; wider leak window" },
        { "label": "24 hours", "score": 2, "note": "Simple; unacceptable security profile" }
      ]
    },
    {
      "id": "fc-auth-middleware",
      "kind": "fileChange",
      "path": "src/middleware/auth.ts",
      "action": "add",
      "rationale": "New JWT validation middleware replaces the session-cookie check."
    },
    {
      "id": "code-jwt-verify",
      "kind": "code",
      "lang": "typescript",
      "filename": "src/middleware/auth.ts",
      "content": "import jwt from 'jsonwebtoken';\nexport function verifyJwt(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.sendStatus(401);\n  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {\n    if (err) return res.sendStatus(401);\n    req.user = decoded;\n    next();\n  });\n}"
    },
    {
      "id": "table-route-coverage",
      "kind": "table",
      "columns": ["Route", "Auth required", "Notes"],
      "rows": [
        ["/api/plan", "yes", "JWT in Authorization header"],
        ["/api/prd", "yes", "JWT in Authorization header"],
        ["/health", "no", "Public liveness probe"]
      ]
    },
    {
      "id": "diagram-auth-flow",
      "kind": "diagram",
      "mermaid": "sequenceDiagram\n  Client->>API: POST /auth/login\n  API-->>Client: access_token + refresh_token\n  Client->>API: GET /api/plan (Authorization: Bearer <token>)\n  API-->>Client: 200 OK\n  Client->>API: POST /auth/refresh (refresh_token expired)\n  API-->>Client: 401 Unauthorized"
    },
    {
      "id": "risk-jwt-secret-leak",
      "kind": "risk",
      "description": "JWT_SECRET leaked via env dump or log",
      "likelihood": "L",
      "impact": "H",
      "mitigation": "Store in a secrets manager; rotate on any suspected leak; never log env."
    },
    {
      "id": "oq-refresh-storage",
      "kind": "openQuestion",
      "question": "Where should refresh tokens be stored on the client — httpOnly cookie or localStorage?",
      "answer": null
    }
  ]
}
```

### ID rules (critical for stability across revisions)

- Assign a short, descriptive, kebab-case `id` to every block (e.g. `"task-wire-auth-hook"`, `"risk-db-migration"`, `"phase-foundation"`).
- IDs must be **unique within the document**.
- When revising this document later: **REUSE the `id` of any block whose intent is unchanged**. Only mint a new `id` for a genuinely new block. Never renumber existing blocks.
- The document-level `id` (e.g. `"prd-auth-overhaul"`) is the **revision-chain key** — it must never change across revisions of the same PRD. The `meta.revision` integer increments; the document `id` stays fixed.

### Authoring instructions

1. Translate the Crystallized Intent Summary directly into blocks:
   - The GOAL → one `objective` block (with success criteria derived from the interview).
   - Each delivery phase or milestone → a `phase` block listing the relevant `task` block ids.
   - Each MAIN DELIVERABLE / concrete task → a `task` block (under the appropriate `phase`).
   - Each KEY CONSTRAINT / NON-GOAL → a `prose` block under a "Constraints & Non-Goals" section.
   - Each OPEN QUESTION → an `openQuestion` block (leave `answer: null` for the human to fill in the browser UI).
   - Material risks surfaced during the interview → `risk` blocks.
   - Any significant design choice with alternatives and scores → a `tradeoff` block.
   - Any file that will be created, modified, or deleted → a `fileChange` block.
   - Significant code snippets or scaffolding → `code` blocks.
   - Comparison or matrix data → `table` blocks.
   - Architecture or flow diagrams → `diagram` blocks (Mermaid source).
2. Group blocks logically using `section` blocks at appropriate heading levels.
3. Keep `prose` blocks for narrative context; prefer structured v2 kinds (`phase`, `tradeoff`, `fileChange`, `code`, `table`, `diagram`) for structured content where they add clarity.
4. Emit the document as valid JSON inside a fenced code block:

```json
{
  "schemaVersion": 1,
  "type": "prd",
  ...
}
```

5. After emitting the v2 PRD block document JSON, **pipe it into `bin/planos prd` via stdin** to boot the blocking server and open the browser review UI. Run this exact shell invocation (replacing the JSON with your authored document):

```sh
echo '<your-authored-v2-prd-json>' | node bin/planos prd
```

Or equivalently, use a heredoc for multi-line JSON:

```sh
node bin/planos prd << 'PLANOS_PRD_EOF'
{
  "schemaVersion": 1,
  "type": "prd",
  ...
}
PLANOS_PRD_EOF
```

The `bin/planos prd` command reads the JSON document from stdin (D4 — stdin handoff), validates it as a v2 PRD, boots the blocking server, opens the browser review UI, and blocks until the reviewer approves or requests revisions. Do NOT call `ExitPlanMode` — PRD mode reaches the server directly via this CLI invocation, not through the ExitPlanMode hook.

### Graceful fallback (interruption path)

If Phase 1 was interrupted (see the "Graceful interruption / early-exit" section above), proceed here unconditionally with the best-effort Crystallized Intent Summary already synthesized. Do NOT loop back to ask more questions.

- If a goal was partially established, translate it into blocks as best you can.
- If almost nothing was established, emit a minimal document with at least one `openQuestion` block asking the user to describe their goal — the browser review loop is the recovery surface for all remaining gaps.
- Always emit a valid JSON block document and always run `bin/planos prd` via stdin. Never fail; never crash; never refuse to proceed; always reach the server boot step.

---

## Summary of the flow

```
/planos-prd [topic]
      ↓
Phase 1: Socratic interview (CLI, this conversation, one Q at a time)
      ↓
Crystallized Intent Summary (confirmed with user)
      ↓
Phase 2: Agent authors v2 PRD block document JSON
      ↓
Agent pipes JSON into: node bin/planos prd  (via stdin)
      ↓
bin/planos prd → blocking server boots → browser review UI opens
      ↓
User edits blocks / answers openQuestions / approves or requests revisions
```

The interview lives entirely in the CLI before the server boots. The browser review loop is the structured artifact review surface — it does not conduct interviews.
