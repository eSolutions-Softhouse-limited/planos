# Work Plan: planos — Phase 1 (Prove the Loop + De-risk Block-ID Stability)

- Plan ID: planos-phase1-consensus
- Generated: 2026-05-16
- Revision: 3 (post-approval non-blocking merges)
- Status: pending approval (consensus reached — Architect SOUND-WITH-CONCERNS [non-blocking], Critic APPROVED, 1 iteration)
- Sources of truth: `.omc/specs/deep-interview-planos-phase1.md` (scope/decisions, ambiguity 9.3%, PASSED) and `docs/design.md` (architecture, block schema, hook topology, §5 authoring decision, §6 ID-stability hard problem)
- Mode: consensus (RALPLAN-DR included) — SHORT (default; not flagged `--deliberate`)
- Repo: greenfield (`README.md` + `docs/design.md` only), branch `main`

---

## 1. Context

planos is a Claude Code plugin that inverts plannotator's design: the **structured block document is the artifact**, not a markdown overlay. Phase 1's sole strategic purpose is to **empirically prove block-ID stability survives agent revisions** (design.md §6 — the single make-or-break risk), gated by an automated eval harness measured against a real EnterPlanMode/ExitPlanMode loop with live agents.

The loop: `EnterPlanMode` (PreToolUse) injects the v1 block schema + worked example as `additionalContext` → agent authors a JSON block document → `ExitPlanMode` (PermissionRequest, 96h timeout) blocks on a localhost server round-trip → user edits blocks / answers `openQuestion`s / comments in a single-file React SPA → a structured `FeedbackEnvelope` flows back → on `revise`, `deny.message` carries the tuned directive + human-readable ops rendering + `(id,kind,title)` echo table + canonical JSON → a block-ID-keyed structural diff shows what the agent changed.

**Block IDs are authored by the nondeterministic agent** — design.md §4 specifies IDs are agent-assigned, and §6 exists precisely because the authoring agent minting every initial ID across revisions is the unfalsifiable risk. planos does not own ID generation; the §6 mechanisms (instruction, deny-echo, deterministic re-anchoring, race guard) exist to make agent-minted IDs survive. The testable invariant Phase 1 enforces is therefore narrower and exact: **no model call inside the blocking `ExitPlanMode` hook path** (the path that turns agent output into the canonical artifact and serializes the decision). The interview's legitimate pre-plan-mode live-agent use is NOT a violation of this; only invocation from inside `bin/planos exit` and its transitive artifact/ID modules is forbidden.

A planos-owned CLI Socratic interview command (`/planos-plan [topic]`) runs **before** plan mode, in the terminal, conducted by the live agent — crystallizing intent then driving structured block authoring. This keeps **no model call inside the blocking ExitPlanMode hook path** (reconciles with design.md §5).

The hook topology, blocking-server lifecycle, single-file SPA build, and strong-directive deny preamble are **reused conceptually** from plannotator (proven). The data model, annotation anchoring, feedback envelope, and structural diff are **built new** (block-ID-addressed).

---

## 2. Requirements Summary

| # | Component | Requirement |
|---|-----------|-------------|
| 1 | Hook topology + blocking server + minimal packaging | `EnterPlanMode` PreToolUse injects schema+example; `ExitPlanMode` PermissionRequest blocks on localhost round-trip; decision JSON on stdout; just-enough plugin scaffold to install & run in a clean Claude Code session. |
| 2 | Block schema + validator + deterministic prose fallback | Versioned JSON block schema (v1 core kinds only); zero-dep hand-rolled validator; on validation failure wrap raw text in a single `prose` block, `meta.degraded=true`, never block, never call a model in the hook. |
| 3 | Single-file React SPA block editor | Render all v1 block kinds; edit `task`, answer `openQuestion` inline, comment a block, approve/revise; emit a structured `FeedbackEnvelope`. |
| 4 | Block-ID stability mechanisms | Instruction-based preservation; deny-message `(id,kind,title)` echo; deterministic re-anchoring fallback (defined similarity fn + threshold); `baseRevision` race guard. **ID scheme chosen empirically in Milestone 1 against the real thin loop** (semantic-slug vs opaque). |
| 5 | Structural diff | ID-keyed outer pass (added/removed/moved/modified/unchanged) + intra-block word-diff inner pass + revision selector. |
| 6 | CLI Socratic interview command `/planos-plan` | planos-owned slash command running a Socratic loop in the CLI (live agent, one question at a time, adaptive follow-ups) before plan mode; crystallizes intent; instructs the agent to author the structured block doc; then the existing ExitPlanMode→browser loop runs unchanged. Self-contained (no external skill dependency). Graceful fallback to plain authoring if interrupted. |

**Locked decisions honored by this plan:**
1. Automated eval harness measured against the REAL thin loop with live agents (not a hand-built fixture loop), reporting three separately-gated metrics (see AC-19). Canned fixtures supplement but do not replace live runs.
2. **Frozen exit gate (no tuning permitted):** block-ID preservation ≥95% across forced revise AND deny→revise convergence ≤2 iterations ≥90%. These bars are FROZEN now; if Milestone 1 cannot clear them for either ID scheme, Phase 1 FAILS and re-scoping is escalated for explicit sign-off — never auto-adjusted. First-try valid rate is TRACKED, not gated.
3. Block-ID scheme decided empirically in Milestone 1, measured against the real thin loop (Milestone 0 → 2-thin → 1).
4. plannotator coexistence: Phase 1 isolated (clean env) + an early investigation spike (Milestone 0/1) documenting Claude Code multi-plugin hook behavior, feeding Milestone 2's server-lifecycle / stdout-ownership design; full resolution deferred to Phase 4.
5. Component #6 interview runs in the CLI BEFORE plan mode — NO model call inside the blocking ExitPlanMode hook path (IDs are agent-authored by design; see §1).
6. Tech: Node 20+, Node built-in `http`, React 19 + Vite + `vite-plugin-singlefile`, zero-dep hand-rolled validator, committed `plugin/dist/index.html`.

**Non-Goals (honored — explicitly NOT in scope):** no plannotator hook-collision resolution; no PRD mode / diff-review mode; no v2/v3 block kinds; no hosted service / cloud / upload / share links; no multi-user/real-time collab; no Bun single-binary/installer; no markdown/PDF export or themes; no LLM-driven markdown→blocks conversion; no live in-browser Socratic interviewer; no reuse of the suspended planning agent to drive a browser interview.

---

## 3. Acceptance Criteria (testable, mirrors the spec)

Each criterion is verified by the eval harness (`tests/`) or a documented manual step. `[H]`=harness-asserted, `[M]`=manual/smoke, `[D]`=document/ADR artifact.

### Hook + server (Component 1)
- **AC-1** `[H]` `EnterPlanMode` PreToolUse hook emits `additionalContext` containing the full v1 block schema + a worked example; total hook execution completes well under the 5s budget (assert harness-measured wall time < 5000ms; target < 1000ms).
- **AC-2** `[H]` `ExitPlanMode` PermissionRequest hook reads stdin JSON, parses `tool_input.plan`: a valid block doc is used as-is; invalid/plain-markdown input is wrapped in exactly one `prose` block with `meta.degraded=true`.
- **AC-3** `[H]` Server boots on a free port, opens browser (mockable open hook), blocks on the decision promise, resolves on POST, writes the decision JSON to stdout, and **exits 0 only after stdout is observably flushed** (assert the flush-then-exit ordering, NOT a literal 1500ms delay — the delay is an implementation detail to permit flush); an EADDRINUSE on the first port triggers a retry on a new port and still succeeds.
- **AC-4** `[H]` Approve POST → stdout JSON with `behavior:"allow"`; process exits 0.
- **AC-5** `[H]` Revise POST → stdout JSON with `behavior:"deny"` and `message` = tuned directive preamble + human-readable ops rendering + `(id,kind,title)` echo table + canonical JSON of the current document.

### Schema + fallback (Component 2)
- **AC-6** `[H]` Hand-rolled validator accepts every v1 kind (`section, prose, objective, task, decision, risk, openQuestion`) with valid field shapes and rejects malformed ones with a field-level error message string suitable for the corrective deny loop.
- **AC-7** `[H]` On validation failure the document degrades to a single `prose` block + `meta.degraded=true`; the loop continues and the user is never blocked. This is reported as a pass/fail deterministic-correctness check (must be 100%), not folded into any percentage.

### SPA editor (Component 3)
- **AC-8** `[M]` SPA renders all 7 v1 block kinds with kind-appropriate UI; manual demo: edit a `task` (title/status/acceptance), answer an `openQuestion` inline, comment a block, click Approve and (separately) Revise.
- **AC-9** `[H]` SPA produces a structurally valid `FeedbackEnvelope` (`decision, documentId, baseRevision, ops[], globalComment?`) where `ops[]` entries match the design.md §4 `Edit` union; the envelope round-trips through serialization into the deny message without loss.
- **AC-10** `[H]` `baseRevision` race guard: when the canonical doc's `meta.revision` differs from the envelope's `baseRevision`, the server/UI rejects applying stale ops and signals a re-render instead.

### ID stability (Component 4)
- **AC-11** `[D]` Milestone 1 ADR exists at `docs/adr/0001-block-id-scheme.md` recording: both candidate schemes prototyped against the real thin loop with live agents, the harness ID-preservation numbers for each, the chosen scheme, rationale, and (if neither cleared the frozen bar) the explicit failure/escalation record.
- **AC-12** `[H]` **Mechanical denominator.** Each forced-revise fixture commits, as frozen fixture data at fixture-design time, the explicit set of block IDs `expected` to be preserved (the intent-unchanged blocks, decided once when the fixture is authored, never at runtime). ID-preservation rate = `|preserved ∩ expected| / |expected|`, pure set-intersection, zero runtime human judgment. Across the frozen forced-revise fixture suite the chosen scheme achieves **≥95%** (frozen bar; see AC-19). Canned *revised* responses MUST model realistic agent revision behavior (including plausible renumbering pressure) and must NOT be authored to trivially preserve IDs; group (ii) is regression protection, while group (iii) live runs remain the authoritative §6 falsifier.
- **AC-13** `[H]` Deterministic re-anchoring fallback. Similarity function: `sim(a,b) = 1` iff `a.kind == b.kind`, else `0`, multiplied by token-set Jaccard over the normalized (lowercased, whitespace-collapsed, punctuation-stripped) primary text field (`title` for section/task/decision/objective, `question` for openQuestion, first 200 chars of `md` for prose). Carry a comment forward iff the best candidate's score `≥ 0.6` AND it exceeds the second-best by `≥ 0.15` (margin guard against decoys); otherwise leave the comment orphaned and flagged. The forced-revise fixture includes (a) an ID-changed-but-corresponding block and (b) a **decoy** — a genuinely-new block superficially resembling an old one. Harness asserts the comment re-attaches to the CORRECT block, does NOT mis-attach to the decoy, and reports the false-attach rate (must be 0 across the suite).

### Structural diff (Component 5)
- **AC-14** `[H]` Outer pass classifies every block as exactly one of added/removed/moved/modified/unchanged by ID-set + position comparison; inner pass word-diffs modified text-bearing fields; revision selector renders and switches base revisions. Asserted against a forced-revise fixture with known expected classifications.

### CLI interview (Component 6)
- **AC-15** `[M]` `/planos-plan [topic]` runs a Socratic loop in the CLI (one question at a time, adaptive follow-ups), produces a crystallized intent summary, then triggers structured block authoring → the unchanged ExitPlanMode→browser review loop. Verified with `topic` argument and with empty argument.
- **AC-16** `[H]` Handoff fixture: a canned crystallized interview summary reliably yields a schema-valid v1 block doc; if the interview is interrupted, the command degrades gracefully to plain plan authoring (no crash, loop still reachable).
- **AC-17** `[H]` **Invariant: no model call inside the blocking `ExitPlanMode` hook path.** Block IDs are authored by the nondeterministic agent (design.md §4) — that is *why* the §6 mechanisms exist; planos does not and cannot make ID generation deterministic. The enforced, testable invariant is narrower: the blocking path that turns agent output into the canonical artifact and serializes the decision contains no model call.
  - **Primary test (runtime):** during `bin/planos exit`, assert zero network egress and zero agent invocation — no outbound `fetch`/`http(s).request`, no `child_process`/`spawn`/`exec` of an agent or agent-SDK, no agent-SDK import being exercised. Harness wraps the blocking-path process with network and process-spawn interceptors and fails if any fire. *Executor guidance:* install the interceptor at the lowest practical layer of the `bin/planos exit` process — wrapping the process/socket boundary (e.g. the net/dns/child_process module surface), not just `fetch`/`http` — so it cannot be bypassed by a higher-level call site. Invariant unchanged.
  - **Static layer:** an import-graph walk over modules transitively imported by `bin/planos exit`, `src/schema/`, and `src/diff/` (a real reachability walk of the module graph, NOT a flat text grep); assert no agent-SDK / model-client module is in that transitive set.
  - **Allow/deny boundary (explicit):** the `/planos-plan` interview's pre-plan-mode live-agent calls are LEGITIMATE and out of scope of this invariant — they run in the CLI before plan mode, never from `bin/planos exit`. Forbidden is any model invocation reachable from the blocking ExitPlanMode entrypoint or the artifact/ID transitive module set. Authoring the document (including agent-minted IDs) happens in the agent loop *before* the blocking hook, not inside it.
  - Command works with no external skill (`/deep-interview`, `/grill-me`) installed.

### Harness + exit gate
- **AC-18** `[H]` Eval harness drives the **real thin loop** (`EnterPlanMode→author→ExitPlanMode→forced-revise→ExitPlanMode`), not a hand-built fixture loop. "Realistic fixture" = a forced-revise fixture whose initial prompt is a plausible end-user planning request (a feature/refactor/investigation ask, ≥3 distinct deliverables, expressed the way a real user types it — not a synthetic minimal stub), with frozen expected data (see AC-12). The harness reports the three metric groups in AC-19 **separately** — there is no "single hard number"; each group is gated independently.
- **AC-19** `[H]` **Phase 1 exit gate — three separately-reported, separately-gated metric groups (all must pass; bars FROZEN, no tuning):**
  - **(i) Deterministic correctness — pass/fail, must be 100%.** Graceful degradation (malformed output → single `prose` block, `meta.degraded=true`, never blocks) AND full loop works offline (no external network). Reported as boolean pass/fail per check; NOT folded into any percentage. Any failure → Phase 1 fails.
  - **(ii) Canned-fixture ID-preservation & convergence — gated at the frozen bar.** Over **≥30 forced-revise canned fixtures** (justification: with N=30, a true 90% convergence rate is rejected when the observed pass count is ≤24/30 — observed ≤80% — giving a clear separation between the 90% bar and a materially-worse true rate; a true 95% ID-preservation rate likewise separates cleanly from ≤87% observed at this N), assert: block-ID preservation (mechanical denominator per AC-12) **≥95%** AND deny→revise reaches a valid doc within **≤2 iterations for ≥90%** of fixtures.
  - **(iii) Live-run ID-preservation — separately gated (the only component that actually falsifies the §6 risk).** Over **≥5 live agent runs** of the forced-revise loop (real model, no canned responses), block-ID preservation **≥95%** measured by the same mechanical denominator, and **no single live run may regress** (none below the bar). The ≥5 runs function as a zero-regression tripwire (every run must clear the bar), not a statistically-powered point estimator. This group is gated independently of (ii); passing canned fixtures does NOT substitute for it.
  - First-try valid rate is reported but **NOT gated** (the deny→revise loop is designed to absorb bad first-tries).
  - **No tuning.** If any group fails for the chosen ID scheme (and, at Milestone 1, for BOTH schemes), Phase 1 FAILS — re-scoping is escalated for explicit sign-off; bars are never auto-adjusted.
- **AC-20** `[M]` Plugin installs and runs the loop end-to-end in a real Claude Code session via `marketplace.json` + `plugin.json` + `hooks.json` + `bin/planos` dispatch + committed `dist/index.html`.
- **AC-21** `[D]` Coexistence investigation spike note exists (`docs/notes/plannotator-coexistence-spike.md`) documenting observed Claude Code multi-plugin `ExitPlanMode` hook-matcher behavior (esp. whether Claude Code dispatches `ExitPlanMode` to ALL matching plugins or one); produced in Milestone 0/1 and its findings feed Milestone 2's server-lifecycle / stdout-decision-ownership design. Full resolution explicitly deferred to Phase 4.

> 21 acceptance criteria; 16 are harness-asserted (`[H]`), 2 are document artifacts (`[D]`), 3 are scripted manual smoke (`[M]`). ≥90% concrete/testable with explicit metrics.

---

## 4. Implementation Steps

File paths follow the design.md §8 repo structure. No source is written by this plan — these are the work units for the executor.

**Re-sequenced milestone order (Architect concern #3):** Milestone 0 → **Milestone 2-thin** → Milestone 1 (ID spike against the real thin loop) → Milestone 2-full → 3 → 4 → 5. Rationale: the ID spike must be measured against a REAL EnterPlanMode/ExitPlanMode round-trip with live agents, not a hand-built fixture loop that presupposes the answer (a canned "revised" doc would bake in the result it is supposed to measure). Building a minimal thin loop first means the loop is built once, not twice, and the spike's number is credible. All Milestone-0/2-full/3/4/5 work units are preserved; this is a reordering plus a thin/full split of Milestone 2.

### Milestone 0 — Scaffold

**Step 0.1 — Plugin packaging skeleton.** Create `.claude-plugin/marketplace.json` (`{ plugins: [{ name: "planos", source: "./plugin" }] }`), `plugin/.claude-plugin/plugin.json` (name/version/description), `plugin/hooks/hooks.json` (PreToolUse matcher `EnterPlanMode` → `bin/planos enter`; PermissionRequest matcher `ExitPlanMode`, 96h timeout → `bin/planos exit`), `plugin/bin/planos` (Node shebang dispatcher routing `enter`/`exit`/command subcommands), placeholder `plugin/dist/index.html`.
- Acceptance: `claude --plugin-dir ./plugin` loads without error; `bin/planos` dispatches each subcommand to a stub.

**Step 0.2 — Node http server skeleton.** Create `src/server/` (server bootstrap: free-port bind with EADDRINUSE retry, `onReady`→open-browser seam (injectable for tests), unresolved `decisionPromise`, `POST` handler stubs for approve/deny, lifecycle: resolve → write decision JSON to stdout → **flush stdout** → `stop()` → `exit(0)`). The ordering invariant is "process exits 0 only after the decision JSON is fully flushed to stdout"; the `sleep(1500)` from plannotator is an implementation detail to allow flush, not the contract — the asserted behavior is the flush-then-exit ordering, not a literal millisecond delay. Built-in `node:http` only, zero runtime deps.
- Acceptance: server starts on a random free port, serves the static SPA blob, resolves a stub promise on POST, emits the decision JSON, and exits 0 ONLY after stdout is observably flushed (assert ordering, not a fixed ms); EADDRINUSE path retries.

**Step 0.3 — SPA shell.** Create `src/editor/` (React 19 + Vite + `vite-plugin-singlefile`, `cssCodeSplit:false`, `inlineDynamicImports:true`) producing a single `plugin/dist/index.html`; add the build script. Commit the built artifact.
- Acceptance: `vite build` emits one self-contained `plugin/dist/index.html`; opens offline; renders a placeholder document.

**Step 0.4 — Schema module + hand-rolled validator.** Create `src/schema/` (Document + Block discriminated union for v1 kinds; zero-dep hand-rolled validator returning typed field-level errors; deterministic prose-fallback wrapper).
- Validator choice (decided, recorded as a one-paragraph note in the ADR dir): **Zod vs hand-rolled.** *Zod* — pros: mature, terse schema declaration, good inference; cons: a runtime dependency in (or transitively reachable from) the blocking path, error messages shaped for developers not for the corrective deny-loop preamble, conflicts with the zero-runtime-dep / offline-by-default constraint and the import-graph invariant (AC-17). *Hand-rolled* — pros: zero runtime deps in the blocking path, full control of field-level error strings tuned to feed the deny→revise preamble (AC-6), trivially auditable in the AC-17 import-graph walk; cons: more code to write and maintain, must hand-write exhaustive v1-kind checks. **Chosen: hand-rolled** — the blocking-path zero-dep + offline constraints and corrective-error-message control dominate; revisit only if the schema grows materially (Phase 2+).
- Acceptance: validator accepts a hand-written valid v1 doc and rejects a malformed one with a specific field error; fallback wraps arbitrary text in one `prose` block + `meta.degraded=true`.

**Step 0.5 — Test harness scaffold.** Create `tests/` with a runner, a fixture-loading convention, an injectable mock-agent, a live-agent driver mode, and the open-browser/network seams stubbed for offline runs. Fixture format includes the frozen `expected`-preserved-ID set (AC-12) and decoy-block slots (AC-13).
- Acceptance: an empty harness run executes and reports a structured result object with the three separate metric groups (AC-19) wired but empty; no network access required for canned mode.

**Step 0.6 — plannotator coexistence investigation spike (early — feeds Milestone 2).** Stand up two plugins each declaring an `ExitPlanMode` PermissionRequest matcher in a Claude Code session (no built loop required — stub hooks suffice) and observe dispatch behavior: does Claude Code invoke ALL matching plugins, the first, or error? Write `docs/notes/plannotator-coexistence-spike.md`. This is intentionally early so its findings (especially if `ExitPlanMode` is dispatched to all matching plugins) constrain Milestone 2's server-lifecycle and stdout-decision-ownership design BEFORE that is built. Full resolution remains a Phase 4 Non-Goal.
- Acceptance: AC-21; findings explicitly cited as inputs to Step 2-thin.2 and Step 2f.3.

### Milestone 2-thin — Minimal real round-trip (built BEFORE the spike)

A minimal, hardcoded, no-SPA EnterPlanMode/ExitPlanMode round-trip so the ID spike measures against a REAL loop with live agents.

**Step 2-thin.1 — Minimal EnterPlanMode injection.** In `bin/planos enter` + `src/schema/`, emit `additionalContext` = v1 schema + worked example + explicit ID-preservation rules ("REUSE the `id` of any block whose intent is unchanged; only mint new IDs for genuinely new blocks; never renumber").
- Acceptance: AC-1 (injected content + sub-5s budget).

**Step 2-thin.2 — Minimal ExitPlanMode round-trip (no SPA).** In `bin/planos exit` + `src/server/` + `src/schema/`: read stdin JSON, parse/validate `tool_input.plan` (valid → use; invalid → prose degrade), boot the server, auto-resolve with a scripted decision (no browser/SPA — a harness POST or canned approve/revise), emit PermissionRequest decision JSON, flush-then-exit-0. Apply the coexistence-spike findings (Step 0.6) to the stdout-decision-ownership design here.
- **Required:** the thin loop's `revise` `deny.message` MUST include the `(id,kind,title)` echo table (design.md §6 mechanism #2) so Milestone 1 measures ID-preservation with the full mechanism set enabled, not a degraded subset. Only the human-readable ops rendering and full SPA `FeedbackEnvelope` serialization defer to Milestone 2-full. Rationale: omitting the echo table would make the spike under-measure ID-preservation and could force a false escalation.
- Acceptance: AC-2, AC-3, AC-4, a real `EnterPlanMode→author→ExitPlanMode→forced-revise→ExitPlanMode` cycle runs end-to-end with a live agent through this thin loop, with the `(id,kind,title)` echo table present in the revise message.

### Milestone 1 — ID-scheme spike (DE-RISK — measured against the real thin loop; HARD GATE)

**Step 1.1 — Dual ID strategies behind a flag.** In `src/schema/`, implement BOTH candidate ID strategies (semantic-slug vs opaque) selectable by a flag/env. Schema and injected authoring instructions parametrized over the strategy.
- Acceptance: the same document can be authored/validated under either strategy via the flag.

**Step 1.2 — Forced-revise fixtures with frozen expected-ID sets + measurement against the thin loop.** In `tests/`, build the forced-revise fixture suite. Each fixture commits its frozen `expected`-preserved-ID set at design time (AC-12) plus the AC-13 decoy/ID-changed blocks. Drive the **real thin loop** (Milestone 2-thin) with both canned responses AND live agents; measure ID-preservation as `|preserved ∩ expected| / |expected|` (pure set-intersection, no runtime judgment) for BOTH strategies over ≥30 canned fixtures + ≥5 live runs.
- Acceptance: harness emits, per strategy, the three AC-19 metric groups computed against the real loop.

**Step 1.3 — Pick the scheme + write the ADR (FROZEN bars, no tuning).** Compare measured numbers against the **frozen** bars (ID-preservation ≥95%, convergence ≤2 iter ≥90%, live-run group passing, deterministic correctness 100%). Select the scheme that clears the frozen bars. Record `docs/adr/0001-block-id-scheme.md` (candidates, per-strategy numbers, decision, rationale, consequences). The bars are NOT adjusted to fit the data under any circumstance.
- **Milestone 1 failure branch (explicit):** if **neither** ID scheme clears the frozen bars, Phase 1 **FAILS**. Do not proceed to Milestone 2-full. Do not lower the bars. Escalate to the human/architect with the measured numbers and a re-scoping proposal (e.g., escalate the deterministic re-anchoring layer, or revisit the structured-artifact thesis) for explicit sign-off. Resumption requires signed-off re-scoping, not an auto-adjusted gate.
- Acceptance: AC-11 satisfied; if a scheme passes, it is wired as default and a hard number exists before any further build; if not, the failure/escalation is recorded and the build halts.

### Milestone 2-full — The loop (completed)

**Step 2f.1 — Harden EnterPlanMode injection.** Finalize `additionalContext` content using the chosen ID scheme; confirm AC-1 budget under the real loop.
- Acceptance: AC-1.

**Step 2f.2 — ExitPlanMode parse + fallback (production path).** Production-quality stdin parse, validate, deterministic prose-block degrade.
- Acceptance: AC-2, AC-7.

**Step 2f.3 — Full blocking round-trip + decision JSON.** Render the real SPA, boot server, block on `decisionPromise`, resolve on browser POST, emit PermissionRequest decision JSON (allow / deny+message), flush-then-exit-0 ordering. Incorporate coexistence-spike findings into stdout-decision-ownership.
- Acceptance: AC-3, AC-4, AC-5.

**Step 2f.4 — Deny-message envelope serialization + baseRevision race guard.** Serialize `FeedbackEnvelope` into `deny.message` (tuned directive preamble + human-readable ops + `(id,kind,title)` echo table + canonical JSON). Implement `baseRevision` mismatch detection.
- Acceptance: AC-5, AC-9, AC-10.

### Milestone 3 — SPA + structural diff

**Step 3.1 — Block render + edit/comment/answer.** In `src/editor/`, render all 7 v1 kinds; implement task edit, `openQuestion` inline answer, per-block comment, approve/revise actions.
- Acceptance: AC-8.

**Step 3.2 — FeedbackEnvelope emission.** SPA constructs the envelope from user actions (`editBlock`/`deleteBlock`/`moveBlock`/`comment`/`answer`/`addBlock`) with correct `documentId` + `baseRevision`.
- Acceptance: AC-9.

**Step 3.3 — Structural diff + revision selector.** In `src/diff/`, implement ID-keyed outer pass (added/removed/moved/modified/unchanged) + inner word-diff for text-bearing fields (reuse `diffWordsWithSpace` idea only) + revision selector in `src/editor/`.
- Acceptance: AC-14.

**Step 3.4 — Re-anchoring fallback (defined similarity fn + threshold).** In `src/diff/`, implement the AC-13 similarity function exactly: kind-gated token-set Jaccard over the normalized primary text field, carry-forward iff best score `≥ 0.6` AND margin over second-best `≥ 0.15`; otherwise orphan + flag "comment re-attached — verify". Add the decoy + ID-changed-but-corresponding fixtures and assert correct attach + zero decoy mis-attach + reported false-attach rate.
- Acceptance: AC-13.

### Milestone 4 — CLI `/planos-plan` interview command (Component #6)

**Step 4.1 — Slash command + self-contained Socratic prompt.** Create `plugin/commands/planos-plan.md` and a planos-owned prompt asset (no dependency on `/deep-interview` or `/grill-me`): one question at a time, adaptive follow-ups, terminates on a crystallized intent summary. Runs in the CLI, before plan mode, driven by the live agent.
- Acceptance: AC-15; AC-17 (no external skill required).

**Step 4.2 — Crystallized-intent → block authoring handoff.** The command instructs the agent to author a structured v1 block document from the crystallized summary, then the existing EnterPlanMode→ExitPlanMode→browser loop runs unchanged. The interview's live-agent calls happen in the CLI before plan mode (legitimate); no model call is reachable from `bin/planos exit` or the artifact/ID transitive module set.
- Acceptance: AC-16 (handoff fixture); AC-17 (runtime no-egress/no-spawn assertion in `bin/planos exit` + import-graph walk; allow/deny boundary explicit).

**Step 4.3 — Graceful interruption fallback.** If the interview is interrupted, degrade to plain plan authoring (loop still reachable, no crash).
- Acceptance: AC-16.

### Milestone 5 — Exit gate

**Step 5.1 — Full harness run.** Run the complete fixture suite end to end through the full loop including forced revise: ≥30 canned forced-revise fixtures + ≥5 live agent runs (none may regress).
- Acceptance: AC-18.

**Step 5.2 — Verify the frozen gate (no tuning).** Confirm all three AC-19 groups against the FROZEN bars: (i) deterministic correctness pass/fail = 100% (graceful degradation + offline); (ii) canned-fixture ID-preservation ≥95% AND convergence ≤2 iter ≥90% over ≥30 fixtures; (iii) live-run ID-preservation ≥95% over ≥5 runs with no regression. Report (not gate) first-try valid rate. **Bars are not finalized or tuned here — they were frozen at plan time and at Milestone 1; any shortfall triggers the failure/escalation branch, not adjustment.**
- Acceptance: AC-19.

**Step 5.3 — Handoff fixture + degradation + offline verification.** Verify the interview→authoring handoff fixture and graceful-degradation/offline paths green.
- Acceptance: AC-16, AC-7, AC-19(i).

**Step 5.4 — Live-session smoke test.** Install via `marketplace.json` in a real Claude Code session; run the loop end to end. (The plannotator-coexistence spike was already done in Step 0.6; here just confirm the documented findings still hold in the smoke environment.)
- Acceptance: AC-20; AC-21 reconfirmed.

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Block-ID instability across revisions** (the make-or-break risk, design.md §6) | M | H | Milestone 1 measured against the REAL thin loop with live agents; 4-layer defense (instruction, deny-echo, deterministic re-anchoring, race guard); FROZEN ≥95% gate; explicit failure/escalation branch if neither scheme clears it. |
| Agent emits prose despite injection | M | M | Deterministic non-LLM prose fallback (AC-7); corrective deny→revise loop converges it; first-try rate tracked (not gated) because the architecture tolerates bad first-tries. |
| Model call accidentally introduced inside the blocking `ExitPlanMode` hook path | L | H | AC-17 runtime assertion (zero network egress / no agent spawn during `bin/planos exit`) + import-graph walk over the blocking/artifact/ID transitive module set; explicit allow/deny boundary so the interview's legitimate pre-plan-mode live-agent use is not conflated. Note: agent-minted IDs are authored in the agent loop *before* the hook by design (§4) — that is why §6 mechanisms exist; the invariant is "no model call inside the blocking hook", not "deterministic IDs". |
| plannotator hook-matcher collision on `ExitPlanMode` | M | M | Phase 1 isolated to a clean env; investigation spike done EARLY (Step 0.6) so its findings constrain the Milestone 2 server-lifecycle / stdout-ownership design before it is built; full resolution deferred to Phase 4 (Non-Goal). |
| Schema too rigid (agent fights it) / too loose (no value) | L | M | v1 vocab minimal; `prose` is always a valid escape hatch; structured task/decision/risk/openQuestion carry the value. |
| Hand-rolled validator error messages too weak for the corrective loop | L | M | Validator must return field-level error strings (AC-6) explicitly designed to feed the deny→revise preamble; revisit only if schema grows. |
| Frozen exit bars prove unreachable | M | H | Bars are frozen at plan time, NOT tuned. If Milestone 1 cannot clear them for either scheme, the explicit Milestone 1 failure branch halts the build and escalates a re-scoping proposal for human/architect sign-off — the gate is never auto-adjusted to fit the data. |
| Stale-ops application during a concurrent agent revision | L | H | `baseRevision` race guard (AC-10) detects mismatch and re-renders rather than applying stale ops. |
| Committed `dist/index.html` drifts from source | M | L | Build script + commit step in Milestone 0; live-session smoke test (AC-20) detects drift. Remediation: a `tests/` check rebuilds the SPA and asserts the committed `plugin/dist/index.html` is byte-identical to fresh output (fail + regenerate-and-recommit instruction if not), run in the harness and before any tagged release. |

---

## 6. Verification Steps

1. **Per-milestone harness gate.** Run `tests/` after each milestone; Milestone 1 is a HARD gate measured against the real thin loop — no further build proceeds until a passing scheme exists and the ADR is written, OR the failure/escalation branch is recorded and the build halts.
2. **Acceptance traceability.** Every AC maps to a harness assertion (`[H]`), a committed document (`[D]`), or a scripted manual smoke (`[M]`); Step 5.2 confirms all 21 green.
3. **Exit gate computation (three separate groups, no single number).** Verify independently: (i) deterministic correctness pass/fail = 100% (graceful degradation + offline, NOT a percentage); (ii) canned-fixture ID-preservation ≥95% AND convergence ≤2 iter ≥90% over ≥30 fixtures; (iii) live-run ID-preservation ≥95% over ≥5 runs, no regression. First-try rate reported, not gated. Frozen bars; shortfall → escalation, never tuning.
4. **Offline verification.** Run the full loop with network disabled; assert no external egress and no agent invocation inside the blocking `bin/planos exit` path (AC-17 runtime assertion).
5. **Live-session smoke.** Fresh Claude Code session, install via marketplace, author→review→revise→approve end to end (AC-20).
6. **Separate review pass.** Authoring and verification are separate lanes — the eval harness (built by the author) is exercised, but the exit-gate sign-off is a distinct verification pass, not self-approved in the authoring context.
7. **Non-Goal audit.** Confirm no PRD/diff-review mode, no v2/v3 blocks, no hosted service, no live in-browser interviewer, no LLM in the blocking path shipped.

---

## 7. RALPLAN-DR Summary

### Principles (4)
1. **De-risk the unfalsifiable first.** Block-ID stability has no safety net; it is sequenced (against a real thin loop with live agents) and frozen-gated before the full build (Milestone 1 hard gate with an explicit failure/escalation branch).
2. **No model call inside the blocking ExitPlanMode hook path.** Block IDs are agent-authored by design (§4) and §6 mechanisms exist precisely because that is nondeterministic — planos does not claim deterministic IDs. The hard, testable invariant (§5) is that no model call is reachable from `bin/planos exit` or the artifact/ID transitive module set; the interview's pre-plan-mode live-agent use is explicitly allowed and out of that boundary.
3. **Reuse proven plumbing, build new only where structure demands it.** Hook topology, blocking-server lifecycle, single-file build, deny-loop are reused conceptually; data model, anchoring, envelope, diff are new.
4. **Gate on what the architecture cannot tolerate, track the rest.** ID-preservation + convergence are hard gates; first-try valid rate is tracked because the deny→revise loop was built to absorb bad first-tries.

### Decision Drivers (top 3)
1. **Falsifiability of the make-or-break risk against a real loop** — Phase 1 exists primarily to prove ID stability with hard, repeatable, separately-gated metrics measured on the real EnterPlanMode/ExitPlanMode loop with live agents; live-run ID-preservation is the component that actually falsifies the §6 risk.
2. **Install friction & offline guarantee** — Node 20 + built-in `http` + committed single-file SPA + hand-rolled validator → zero runtime deps, no build step on install, full offline loop.
3. **Foundation preservation** — Component #6 must satisfy the new interview requirement without disturbing components #1–#5 or design.md §5 (no model in the blocking path).

### Decision 1 — How to prove Phase 1 success
- **Option A — Automated eval harness with three separately-gated metric groups, measured on the real thin loop with live agents (CHOSEN).** Pros: repeatable, regression-protected, falsifies the §6 risk via a separately-gated live-run group, deterministic correctness kept as boolean pass/fail. Cons: harness + thin-loop build cost; requires ≥30 canned fixtures and ≥5 live runs.
- **Option B — Manual demo / eyeballing.** Pros: cheap, fast. Cons: **invalidated** — cannot falsify or regression-protect the make-or-break ID-stability risk; spec Assumption explicitly rejects it as insufficient for the §6 risk.
- Resolution: A. B invalidated because the strategic purpose of Phase 1 (proving an unfalsifiable risk) is impossible to satisfy with manual inspection.

### Decision 2 — Block-ID generation scheme
- **Option A — Semantic-slug IDs.** Pros: human-readable, may anchor agent recall. Cons: collision/rename instability if titles change.
- **Option B — Opaque IDs.** Pros: rename-stable, no semantic coupling. Cons: agent has no semantic hook to recall them; relies more on deny-echo.
- Resolution: **deferred to empirical measurement (Milestone 1), against the real thin loop with live agents, vs FROZEN bars** — both prototyped behind a flag; harness picks the scheme that clears the frozen ≥95%/≥90% bars; decision (or failure/escalation) recorded as ADR `docs/adr/0001-block-id-scheme.md`. Neither pre-invalidated; data decides, but the bars do not move to fit the data.

### Decision 3 — Where the Socratic interview runs
- **Option A — CLI before plan mode, live agent (CHOSEN).** Pros: no model call inside the blocking ExitPlanMode hook path, foundation untouched, §5 preserved, self-contained command; the pre-plan-mode live-agent interview is explicitly allowed and outside the enforced boundary. Cons: interview state lives outside the artifact (acceptable — crystallized summary is the handoff).
- **Option B — Live in-browser LLM interviewer.** Pros: single surface. Cons: **invalidated** — requires an LLM in/around the blocking path, contradicts design.md §5, mechanically impossible under the PermissionRequest blocking-hook contract without abandoning the proven foundation.
- Resolution: A. B explicitly invalidated by the blocking-hook contract and §5; documented in spec Assumptions and Non-Goals.

### Mode
SHORT consensus mode (default; not flagged `--deliberate`). The make-or-break risk is isolated, measured against a real loop, and frozen-gated with an explicit Milestone 1 failure/escalation branch, so a full pre-mortem/expanded-test-plan expansion is not triggered; the failure branch already encodes the worst-case handling.

---

## 8. ADR (consensus final)

- **Decision:** Build planos Phase 1 in the re-sequenced order (Scaffold incl. early coexistence spike → Milestone 2-thin minimal real round-trip → Milestone 1 ID-scheme spike measured against that real loop with live agents vs FROZEN bars → Milestone 2-full → SPA+diff → CLI interview → Exit gate), with the automated eval harness reporting three separately-gated metric groups (deterministic correctness pass/fail; canned-fixture ID-preservation/convergence; separately-gated live-run ID-preservation).
- **Drivers:** Falsifiability of the §6 make-or-break risk against a real loop; install friction + offline guarantee; preservation of design.md's proven hook foundation and the §5 "no model call inside the blocking ExitPlanMode hook path" invariant.
- **Alternatives considered:** Manual demo proof (invalidated — cannot falsify the unfalsifiable risk); spike against a hand-built fixture loop (rejected — a canned "revised" doc bakes in the result; must measure against the real thin loop with live agents); pre-deciding the ID scheme by design (rejected — every robustness property hinges on it, data must decide); tunable exit bars (rejected — bars frozen, shortfall escalates not auto-adjusts); single-aggregate exit number (rejected — decomposed into three separate gates so live-run falsification is not masked by canned passes); live in-browser LLM interviewer (invalidated — breaks §5 and the blocking-hook contract); Zod validator (deprioritized — hand-rolled chosen for zero deps in the blocking path, AC-17 import-graph cleanliness, and full control of corrective error messages); first-try ≥70% gate from design.md §9 (re-calibrated — the deny→revise loop tolerates bad first-tries, so ID-preservation + convergence become the hard gates).
- **Why chosen:** It puts the make-or-break risk first behind FROZEN, separately-reported numeric gates measured on a real loop, keeps the proven plannotator plumbing intact, satisfies the new interview requirement without violating the blocking-path invariant, and ships with zero runtime deps and a guaranteed offline loop.
- **Consequences:** Milestone 1 blocks all subsequent build until a passing scheme exists OR an escalation is signed off; harness investment and the thin loop are front-loaded; numeric bars are frozen (never tuned to fit data); plannotator coexistence remains unresolved (deferred to Phase 4) but its behavior is documented early and constrains Milestone 2's design.
- **Follow-ups (out of Phase 1 scope):** plannotator hook-collision resolution (Phase 4); PRD mode + v2 blocks (Phase 2); diff-review mode + v3 blocks (Phase 3); Bun single-binary, export, themes, hosted share (Phase 4).

---

## 9. Open Questions

Tracked in `.omc/plans/open-questions.md`.

---

## 10. Changelog — Revision 3 (post-approval merges)

Critic APPROVED; the following 5 non-blocking Architect improvements were merged surgically (no structural changes):
1. Step 2-thin.2 now requires the thin loop's `revise` `deny.message` to include the `(id,kind,title)` echo table (design.md §6 mechanism #2) so Milestone 1 measures the full mechanism set; ops-rendering/SPA-envelope serialization still defer to Milestone 2-full.
2. AC-12 adds a constraint: canned revised responses must model realistic revision behavior (incl. renumbering pressure), not trivially preserve IDs; group (ii) is regression protection, group (iii) live runs are the authoritative §6 falsifier.
3. Corrected the AC tag-count line to "16 `[H]`, 2 `[D]`, 3 `[M]`" (recounted, total 21).
4. AC-19(iii) adds wording-hygiene: the ≥5 live runs are a zero-regression tripwire, not a statistically-powered point estimator (gate logic unchanged).
5. AC-17 primary runtime test adds executor guidance to install the interceptor at the lowest practical process/socket-boundary layer of `bin/planos exit` (invariant unchanged).
