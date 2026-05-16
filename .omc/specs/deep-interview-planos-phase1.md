# Deep Interview Spec: planos — Phase 1 (Prove the Loop + De-risk Block-ID Stability)

## Metadata
- Interview ID: planos-phase1-2026-05-16
- Rounds: 7
- Final Ambiguity Score: 9.3%
- Type: greenfield (empty repo + canonical `docs/design.md`)
- Generated: 2026-05-16
- Threshold: 20%
- Initial Context Summarized: yes (design.md treated as canonical input, summarized into state)
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.91 | 0.40 | 0.364 |
| Constraint Clarity | 0.91 | 0.30 | 0.273 |
| Success Criteria | 0.90 | 0.30 | 0.270 |
| **Total Clarity** | | | **0.907** |
| **Ambiguity** | | | **0.093** |

## Topology
Six Phase 1 top-level components are active; none deferred. Packaging was merged into the hook component (minimal-for-Phase-1, polish → Phase 4 per design.md §4/§9). Block-ID stability was split out from structural diff per design.md §6/§10 (it is the make-or-break risk and warrants an isolated prototype + exit gate). **Component #6 (CLI Socratic interview command) was added in rounds 5–7** to satisfy a new user requirement; it was deliberately designed to NOT disturb components #1–#5 or design.md's foundation (see Assumptions).

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 1. Hook topology + blocking server + minimal packaging | active | EnterPlanMode inject, ExitPlanMode PermissionRequest block, localhost round-trip, decision JSON, just-enough plugin scaffold to install & test | Coexistence with plannotator isolated (clean env) + investigation spike; full collision handling → Phase 4 |
| 2. Block schema + validator + deterministic prose fallback | active | Versioned JSON block schema (v1 core kinds), validator, non-LLM prose-block fallback on validation failure | Validator: zero-dep hand-rolled recommended (blocking path); see Assumptions |
| 3. Single-file React SPA block editor | active | Render blocks; edit task/decision/answer openQuestion; comment; approve/revise; emit structured feedback envelope | Verified by manual demo + harness assertions on envelope shape |
| 4. Block-ID stability mechanisms | active | Instruction-based preservation, deny-message ID echo, deterministic re-anchoring fallback, baseRevision race guard | **ID scheme chosen empirically via Phase 1 spike** (semantic-slug vs opaque) measured by the eval harness |
| 5. Structural diff | active | ID-keyed outer pass (added/removed/moved/modified/unchanged) + intra-block word diff inner pass + revision selector render | Correctness asserted by eval harness on forced-revise fixtures |
| 6. CLI Socratic interview command (`/planos-plan`) | active | planos-owned slash command that runs a `/deep-interview`-style Socratic loop **in the CLI** (live agent, before plan mode), crystallizes intent, then instructs the agent to author the structured block plan from it and opens the browser review | Self-contained (no external skill dependency); pre-plan-mode so **zero LLM in the blocking path** — reconciles with §5. Independent of the #4 ID-stability spike; sequenced after the core loop (Milestone 4). |

## Goal
Build Phase 1 of the **planos** Claude Code plugin: a structured-block plan-authoring loop where `EnterPlanMode` (PreToolUse) injects the block schema + a worked example as `additionalContext`; the agent authors a JSON block document; `ExitPlanMode` (PermissionRequest, 96h timeout) blocks on a localhost server round-trip; the user edits blocks / answers `openQuestion`s / comments in a single-file React SPA; a structured feedback envelope flows back; on `revise` the `deny.message` carries the tuned directive + a human-readable rendering of the ops + the canonical JSON; a block-ID-keyed structural diff shows what the agent changed. Phase 1 exists primarily to **empirically prove block-ID stability survives agent revisions**, gated by an automated eval harness producing a hard, repeatable number.

Additionally, planos owns a CLI Socratic interview command (`/planos-plan [topic]`): an agent-driven `/deep-interview`-style loop conducted **in the terminal before plan mode**, which crystallizes the user's intent and then drives the agent to author the structured block plan (after which the existing ExitPlanMode→browser review loop runs unchanged). The interview surface is the CLI; the browser remains a deterministic structured-block *review* surface. This deliberately avoids any LLM in the blocking path and leaves design.md's hook foundation intact.

## Constraints
- Runtime: Node 20+, built-in `http` server, zero runtime deps in the blocking path where feasible.
- SPA: React 19 + Vite + `vite-plugin-singlefile`; `plugin/dist/index.html` prebuilt and committed (install needs no build step).
- Phase 1 runs in an **isolated/clean environment** — planos installed alone; eval harness runs isolated. plannotator coexistence is NOT solved in Phase 1.
- Hook topology reused conceptually from plannotator (proven): `PermissionRequest`/`ExitPlanMode` block with `deny.message` re-entry; `PreToolUse`/`EnterPlanMode` fast schema injection; blocking local server with unresolved decision promise, `onReady`→open browser, POST resolves, `sleep(1500)`→stop→exit(0), EADDRINUSE retry.
- Data model, annotation anchoring, diff engine, feedback envelope are built NEW (block-ID-addressed), NOT reused from plannotator.
- v1 block vocabulary only: `section, prose, objective, task, decision, risk, openQuestion`. `prose` is always the valid escape hatch.
- Deterministic (non-LLM) fallback only: on schema-validation failure wrap raw text in a single `prose` block, mark `meta.degraded=true`, never block the user, never call a model inside the blocking hook.
- Offline: full loop must work with no external network.
- The CLI interview (Component #6) runs **before** plan mode, conducted by the live agent in the terminal — it is NOT in the blocking hook path, introduces no LLM into the artifact/ID path, and does not alter the hook topology. The browser never conducts the interview.
- Component #6 is self-contained (planos ships its own interview command + prompt); it must not hard-depend on `/deep-interview`, `/grill-me`, or any external skill being installed.

## Non-Goals
- No plannotator hook-collision resolution (Phase 4).
- No PRD mode, no diff-review mode, no v2/v3 block kinds (Phases 2–3).
- No hosted service, cloud, upload, or share links.
- No multi-user / real-time collaboration.
- No Bun single-binary / installer (revisit Phase 4).
- No markdown/PDF export, themes (Phase 4).
- LLM-driven markdown→blocks conversion is explicitly rejected (would break ID stability).
- A **live in-browser Socratic interviewer** (AI generating questions in real time while the browser is open) is explicitly rejected for Phase 1 — it would require an LLM in/around the blocking path and contradicts design.md §5. The interview lives in the CLI instead.
- Reusing the suspended planning agent to drive a live browser interview is rejected — mechanically impossible under the PermissionRequest blocking-hook contract without abandoning design.md's proven foundation.

## Acceptance Criteria
- [ ] `EnterPlanMode` PreToolUse hook injects the v1 block schema + a worked example as `additionalContext` (fast, <5s budget).
- [ ] `ExitPlanMode` PermissionRequest hook reads stdin JSON, parses `tool_input.plan`: valid block doc → use it; invalid/plain markdown → deterministic single-`prose`-block wrap with `meta.degraded=true`.
- [ ] Blocking localhost server boots on a free port, opens browser, blocks on the decision promise, resolves on POST, then `sleep(1500)`→stop→`exit(0)`; EADDRINUSE retry works.
- [ ] SPA renders all v1 block kinds; user can edit a `task`, answer an `openQuestion` inline, comment a block, and hit Approve or Revise.
- [ ] Approve → stdout `behavior:"allow"`; agent proceeds normally.
- [ ] Revise → stdout `behavior:"deny"` with `message` = tuned directive preamble + human-readable ops rendering + `(id,kind,title)` echo table + canonical JSON.
- [ ] Structured `FeedbackEnvelope` (decision, documentId, baseRevision, ops[], globalComment?) is correctly produced by the SPA and serialized into the deny message.
- [ ] `baseRevision` race guard: if the agent revised while the human was editing, mismatch is detected and the UI re-renders rather than applying stale ops.
- [ ] Structural diff: outer pass classifies blocks by ID (added/removed/moved/modified/unchanged); inner pass word-diffs modified text fields; revision selector renders.
- [ ] `/planos-plan [topic]` CLI command runs a Socratic interview loop (adaptive follow-ups; one question at a time), crystallizes the result into an intent summary, then instructs the agent to author a structured v1 block document from it and triggers the ExitPlanMode→browser review loop. No LLM runs in the blocking path; the command works without any external skill installed.
- [ ] Harness fixture verifies the handoff: a crystallized interview summary reliably yields a schema-valid block doc, and the command degrades gracefully (falls back to plain plan authoring) if the interview is interrupted.
- [ ] **ID-scheme spike (Phase 1 milestone 1, runs first):** prototype semantic-slug vs opaque IDs; the eval harness measures ID-preservation rate across forced revisions; data selects the scheme; decision recorded as an ADR.
- [ ] **Eval harness:** fixture suite of N realistic planning prompts driving EnterPlanMode→author→ExitPlanMode→forced-revise→ExitPlanMode, with mocked/canned agent responses + a few live runs. Asserts: schema-valid-first-try rate, ID-preservation rate across revise, structural-diff correctness, graceful prose fallback. Emits a single hard number gating the §9 exit.
- [ ] **Phase 1 exit gate (re-calibrated, supersedes design.md's first-try ≥70% bar):** (a) block-ID preservation rate across a forced revise ≥ 95%; (b) deny→revise loop reaches a valid doc within ≤ 2 iterations ≥ 90% of fixtures; (c) malformed output degrades gracefully and never blocks; (d) full loop works offline. First-try valid rate is **tracked as a reported metric, not a gate** (rationale: §5 designed the corrective deny→revise loop specifically to tolerate bad first-tries; ID stability has no safety net and is the true make-or-break). Exact numeric bars may be tuned from Milestone 1 spike data before the gate is declared.
- [ ] Plugin is installable enough to run the loop end-to-end in a real Claude Code session (`marketplace.json`, `plugin.json`, `hooks.json`, `bin/planos` dispatch, committed `dist/index.html`).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "Prove the loop" can be eyeballed manually | How is the make-or-break ID-stability risk falsified without regression protection? | **Automated eval harness** producing a hard repeatable number; manual demo insufficient for the §6 risk. |
| plannotator coexistence must be handled in Phase 1 | §10 leaves hook-matcher collision OPEN; solving it in the riskiest phase bloats scope | **Isolate Phase 1** (clean env) + a short investigation spike to document Claude Code multi-plugin hook behavior; resolution deferred to Phase 4. |
| ID scheme can be pre-decided by design | Every robustness property hinges on it; wrong pick = silent mis-anchor | **Empirical Phase 1 spike** (semantic-slug vs opaque) measured by the harness; data picks; aligns with design.md §6 "prototype first". |
| Validator library is a blocking decision | §8 leaves Zod vs hand-rolled to Phase 1 | Low-stakes; spec recommends **zero-dep hand-rolled validator** for the blocking path (no runtime deps, full control of error messages feeding the corrective deny loop). Revisit only if schema grows. |
| Phase 1 should gate on first-try valid rate ≥70% (design.md §9) | Contrarian: the deny→revise loop was explicitly built to converge bad first-tries — gating on first-try rate gates on a metric the architecture tolerates failures in | **Re-calibrated gate:** ID-preservation ≥95% across forced revise + convergence ≤2 iterations ≥90% become the hard gates; first-try rate is tracked, not gated. The true unfalsifiable risk (ID stability) drives the gate. |
| The "interview in the browser" is just the existing `openQuestion` blocks | User wants a real Socratic loop, then escalated to a live in-browser LLM interviewer | Surfaced the mechanical reality: a suspended agent behind a blocking hook cannot stream interview turns; a live browser LLM reopens §5. **Resolved cleanly:** interview runs in the **CLI before plan mode** (live agent), crystallized intent → block authoring → existing browser review. New Component #6, planos-owned thin command, foundation untouched. |
| In-browser AI could just edit blocks directly for best UX | That is exactly design.md §5's prohibited path (nondeterministic model minting IDs/artifact) | Rejected. Interview output is mediated by the human and by the deterministic authoring step; no model in the artifact/ID path. |

## Technical Context
Greenfield repo `esolutions.gr/planos` (branch `main`, git-initialised, single `Initial commit`). Only `README.md` + `docs/design.md` present. `docs/design.md` is the canonical, evidence-based design (full source analysis of `github.com/backnotprop/plannotator`). Target plugin repo structure (design.md §8):

```
planos/
├── .claude-plugin/marketplace.json
├── plugin/{.claude-plugin/plugin.json, hooks/hooks.json, commands/, bin/planos, dist/index.html}
├── src/{server/, schema/, diff/, editor/}
├── docs/design.md
└── tests/   ← eval harness lives here
```

Reused-conceptually plannotator mechanisms (proven, low-risk): plan-mode interception, schema/context injection channel, blocking local-server round-trip lifecycle, single-file SPA build, slug+on-disk version history (keyed by document ID instead of heading slug), strong-directive deny preamble. Built-new (because the artifact is structured): JSON block schema, block-ID annotation anchoring, structured edit envelope, ID-keyed structural diff, native structured authoring.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Document | core domain | schemaVersion, type, id, title, meta{branch,status,createdAt,revision}, blocks[] | has many Block; identified by stable `id` (revision-chain key) |
| Block | core domain | id (stable), kind, kind-specific fields | belongs to Document; v1 kinds: section/prose/objective/task/decision/risk/openQuestion |
| Annotation/Comment | core domain | blockId, text, anchor?{start,end} | anchored to Block by id |
| FeedbackEnvelope | core domain | decision, documentId, baseRevision, ops[], globalComment? | produced by SPA, consumed by hook→agent |
| Edit (Op) | core domain | op, blockId, patch/answer/text/block | element of FeedbackEnvelope.ops |
| Revision | core domain | revision int, prior Document | chains Documents by Document.id |
| Hook | external system | EnterPlanMode (PreToolUse, inject), ExitPlanMode (PermissionRequest, block) | bridges agent ↔ server |
| Server | external system | localhost port, decisionPromise lifecycle | bridges SPA ↔ Hook |
| EvalFixture | supporting | prompt, canned agent responses, expected assertions | drives Hook+Server+Document in the harness |
| InterviewCommand | core domain | slug (`/planos-plan`), topic, Socratic loop, crystallized intent summary | precedes plan mode; produces input that the agent turns into a Document |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 9 | 9 | - | - | N/A |
| 2 | 9 | 0 | 0 | 9 | 100% |
| 3 | 9 | 0 | 0 | 9 | 100% |
| 4 | 9 | 0 | 0 | 9 | 100% |
| 5 | 9 | 0 | 0 | 9 | 100% |
| 6 | 9 | 0 | 0 | 9 | 100% |
| 7 | 10 | 1 | 0 | 9 | 90% |

Domain model was stable from Round 1 (design.md already crystallized it). Rounds 5–7 explored the new in-browser-interview requirement without destabilizing the model; only one entity (`InterviewCommand`) was added in Round 7 once the requirement resolved to a CLI command. Final stability 90% (9 stable + 1 new) — convergence confirmed.

## Interview Transcript
<details>
<summary>Full Q&A (3 rounds + Round 0)</summary>

### Round 0 — Topology
**Q:** Confirm the 5-component Phase 1 topology (hook+server+packaging, schema+validator+fallback, SPA editor, ID-stability, structural diff)?
**A:** "I have no opinion because I am no expert. Do your own research." → Resolved from design.md evidence: packaging merged into hook (minimal-for-Phase-1); ID-stability split from diff (§6/§10 top risk). Topology locked.

### Round 1
**Q:** How should Phase 1 success — especially block-ID stability — be proven (automated harness / manual demo / hybrid)?
**A:** Automated eval harness (Recommended).
**Ambiguity:** 24.9% (Goal 0.85, Constraints 0.65, Criteria 0.72)

### Round 2
**Q:** How should Phase 1 treat plannotator hook-matcher coexistence (§10 OPEN)?
**A:** Isolate now, solve in Phase 4 (Recommended).
**Ambiguity:** 19.0% (Goal 0.87, Constraints 0.80, Criteria 0.74)

### Round 3
**Q:** How should block IDs be generated (the §6 make-or-break mechanism)?
**A:** Decide via Phase 1 spike — prototype semantic-slug vs opaque against the harness, data picks.
**Ambiguity:** 11.8% (Goal 0.90, Constraints 0.88, Criteria 0.86)

### Round 4 — 🔴 Contrarian mode
**Q:** What if first-try ≥70% is the wrong gate, since the deny→revise loop converges bad output anyway? Which metric should gate Phase 1?
**A:** Convergence, not first-try — gate on ID-preservation ≥95% across forced revise + convergence ≤2 iterations ≥90%; first-try tracked not gated.
**Ambiguity:** 8.3% (Goal 0.92, Constraints 0.90, Criteria 0.93)

### Round 5 — New requirement surfaced
**Q:** "Is an in-browser deep-interview/grill-me requirement in the spec?" → What interview model do you want (agent pre-bakes / agent-side adaptive / live browser LLM)?
**A:** Live Socratic interviewer in the browser (LLM in-loop). [Flagged: reopens design.md §5.]

### Round 6 — Constraint: AI provenance
**Q:** Where does the in-browser interviewer's AI run and what may it touch?
**A:** "Same blocked agent drives it." [Flagged: mechanically impossible under blocking-hook contract without redesign.]

### Round 7 — Foundation reconciliation
**Q:** A vs B foundation (deny→revise-as-interview vs abandon blocking hook)?
**A:** User reframed: "do the Socratic interview in the CLI like now, then present the plan in the browser — easier?" → Yes. Then: planos owns a thin `/planos-plan` interview command. **Resolved:** Component #6, CLI interview pre-plan-mode, foundation untouched, §5 preserved.
**Ambiguity:** 9.3% (Goal 0.91, Constraints 0.91, Criteria 0.90)

</details>

## Recommended Phase 1 Execution Order (sequencing of the make-or-break risk first)
1. **Milestone 0 — Scaffold:** repo structure, `plugin.json`, `hooks.json`, `bin/planos` dispatch, Node http server skeleton, Vite singlefile SPA shell, schema module + hand-rolled validator. Just enough to install in a clean Claude Code session.
2. **Milestone 1 — ID-scheme spike (DE-RISK FIRST, design.md §6):** implement schema with both candidate ID strategies behind a flag; build the eval harness with the forced-revise fixture; measure ID-preservation rate; pick the scheme; write the ADR. **Gate: this must produce a number before building the rest.**
3. **Milestone 2 — The loop:** EnterPlanMode injection + ExitPlanMode blocking round-trip + deterministic prose fallback + deny-message envelope serialization + baseRevision race guard.
4. **Milestone 3 — SPA + structural diff:** block rendering/editing/commenting/answer/approve/revise, FeedbackEnvelope emission, ID-keyed structural diff + revision selector.
5. **Milestone 4 — CLI interview command (Component #6):** `/planos-plan [topic]` Socratic loop (self-contained, no external skill dep) → crystallized intent → drives structured block authoring → existing browser review loop. Independent of the ID-stability spike; depends on Milestones 2–3 (the loop + authoring) being solid. Graceful fallback to plain plan authoring if interrupted.
6. **Milestone 5 — Exit gate:** full harness run; confirm/tune the re-calibrated gate (ID-preservation ≥95% across forced revise + convergence ≤2 iterations ≥90%; first-try tracked not gated); verify graceful degradation + offline; verify the interview→authoring handoff fixture; live-session smoke test. All Phase 1 exit criteria green.
