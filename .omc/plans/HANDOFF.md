# planos Phase 1 — Handoff Prompt

Paste everything in the fenced block below into a fresh Claude Code session
**run in this repo** (`/Users/ggiak/www/esolutions.gr/planos`), in an
environment where live `claude` agent runs are possible.

---

```
You are resuming planos Phase 1. Do NOT rebuild what exists — it is done and verified.

## Read first (authoritative, in order)
1. .omc/plans/progress.txt            — full build log + exact handoff steps
2. .omc/plans/planos-phase1-consensus.md — the approved consensus plan (frozen gate rules)
3. .omc/specs/deep-interview-planos-phase1.md — requirements/decisions (ambiguity 9.3%, PASSED)
4. .omc/state/sessions/*/prd.json     — 26 stories; 18 have passes:true (do not redo them)
5. docs/design.md                     — architecture / §4 schema / §6 ID-stability / §5 invariant

## State of the world (verified — re-run `for f in tests/*.test.mjs; do node --test "$f"; done` to confirm)
- 18/26 stories done: M0 scaffold, M2-thin, M2-full, M3, M4 — all green.
- 244 tests / 0 failures; `npx tsc --noEmit` 0 errors; one offline single-file plugin/dist/index.html.
- AC-17 invariant machine-proven: `node tests/harness/import-graph.mjs` → VERDICT CLEAN
  (no model call reachable from bin/planos exit / src/schema / src/diff).
- Both ID strategies exist behind PLANOS_ID_STRATEGY (semantic-slug | opaque). NO winner chosen — that is your job.
- Nothing is committed (greenfield `main`, all uncommitted).

## Your remaining work — 8 stories, all need THIS environment (live `claude` agent runs)
US-006  plannotator coexistence spike: install a 2nd plugin that also matches ExitPlanMode
        PermissionRequest alongside ./plugin; observe whether Claude Code dispatches to ALL
        matching plugins, the first, or errors. Write docs/notes/plannotator-coexistence-spike.md.
US-010  Wire tests/harness/runner.mjs `liveAgentDriver` (currently an honest unwired stub) to a
        real `claude` invocation. Build ≥30 canned forced-revise fixtures (frozen expected-ID
        sets per AC-12) + run ≥5 LIVE forced-revise cycles, for BOTH PLANOS_ID_STRATEGY values,
        against the REAL thin loop. Measure ID-preservation = |preserved ∩ expected| / |expected|.
US-011  Milestone 1 HARD GATE. Compare measured numbers to the FROZEN bars:
          - block-ID preservation ≥ 95% across forced revise
          - deny→revise convergence ≤ 2 iterations for ≥ 90%
          - live-run group: ≥5 runs, NO single run may regress below the bar
          - deterministic correctness: 100% pass/fail
        Pick the scheme that clears them; record docs/adr/0001-block-id-scheme.md.
        ⚠ NEVER tune the bars to fit the data. If NEITHER scheme clears them →
          Phase 1 FAILS: halt, do not proceed to verification, escalate a re-scoping
          proposal to the user with the measured numbers for explicit sign-off.
US-023  Full harness run end-to-end: ≥30 canned + ≥5 live, none regress (AC-18).
US-024  Verify the FROZEN exit gate, three groups reported SEPARATELY (AC-19) — no single number,
        no tuning. First-try valid rate is reported but NOT gated.
US-025  Verify handoff fixture + graceful-degradation + offline paths (AC-16/AC-7/AC-19i).
US-026  Live-session smoke: `claude --plugin-dir ./plugin`, run author→review→revise→approve
        end-to-end (AC-20); reconfirm US-006 findings still hold.

## Hard constraints (do not violate)
- AC-17: NO model call inside the blocking ExitPlanMode hook path (bin/planos exit / src/schema
  / src/diff transitive set). The /planos-plan interview's pre-plan-mode live-agent calls are
  LEGITIMATE and out of scope. Re-run the import-graph walker after any change to those modules.
- Frozen bars are frozen. Shortfall → escalate, never auto-adjust.
- Block IDs are agent-authored by design (§4); §6 mechanisms (instruction / deny-echo /
  deterministic re-anchoring / baseRevision race guard) exist because that is nondeterministic.
- Keep all 244 existing tests green; keep tsc clean; keep the single-file offline build.

## Workflow
- This is a /oh-my-claudecode:ralph-style persistence task. Update the session prd.json
  (passes:true only on fresh verified evidence) and append to .omc/plans/progress.txt each step.
- When all 26 stories pass AND the frozen gate is cleared (or the failure/escalation branch is
  recorded), run /oh-my-claudecode:cancel to clean state.
- If the Milestone 1 gate fails for both schemes, STOP and report — that is a valid Phase 1
  outcome per the plan, not a bug to work around.

Start by reading the 5 files above, then re-running the full test suite to confirm the 18/26
baseline, then begin US-006 + wiring the live agent driver for US-010.
```

---

## Quick context for you (the human), not the agent

- **What works today, unattended:** the entire structured-block plan loop in canned/offline
  mode — schema, validator, thin + full ExitPlanMode round-trip, SPA editor (7 block kinds),
  structural diff, re-anchoring, the `/planos-plan` interview command, AC-17 enforcement.
- **What only you can finish:** the make-or-break proof — does an agent actually preserve block
  IDs across revisions ≥95% of the time? That needs real `claude` runs. Everything was built so
  this is the *only* remaining unknown.
- **The honest possible outcome:** Milestone 1 may *fail* (neither ID scheme clears the frozen
  bars). The plan treats that as a legitimate result that escalates a re-scope — the agent is
  instructed not to paper over it.
- **Before you start:** consider letting me `git commit` the verified 18/26 build so it's saved.
```
