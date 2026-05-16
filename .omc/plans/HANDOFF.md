# planos — Handoff (continue plugin implementation)

> Supersedes the original Phase-1 handoff. Full chronological history is in
> `.omc/plans/progress.txt`. This doc is the current, authoritative entry point.

Paste the fenced block below into a fresh Claude Code session **run in this
repo** (`/Users/ggiak/www/esolutions.gr/planos`). An environment with the live
`claude` CLI is only needed for *interactive dogfooding* / any future live
gate — Phase 3/4 build + verification are fully offline.

---

```
You are resuming planos. Phase 1 (prove the loop + de-risk block-ID stability)
and Phase 2 (PRD mode + v2 vocab + persisted revisions) are COMPLETE, verified,
and committed. Do NOT rebuild them.

## Read first (authoritative, in order)
1. .omc/plans/progress.txt                  — full build log (Iterations 1–4 + Phase 2)
2. docs/design.md                           — architecture; §3 modes, §4 schema (v1+v2),
                                               §7 diff, §9 phasing/exit criteria
3. docs/adr/0000-validator-choice.md        — hand-rolled validator (zero-dep)
4. docs/adr/0001-block-id-scheme.md         — opaque IDs chosen (live-proven 1.000)
5. docs/adr/0002-prd-persistence.md         — D1–D6 Phase-2 decisions + AC-P18 waiver
6. docs/adr/0003-diff-review.md             — Phase-3 R1–R7 + AC-R-WAIVER (ACCEPTED)
7. .omc/plans/planos-phase1-consensus.md    — Phase 1 plan (frozen gate rules)
8. .omc/plans/planos-phase2-plan.md         — Phase 2 plan + Resolved Decisions
9. .omc/plans/planos-phase3-plan.md         — Phase 3 plan + Resolved Decisions (R1–R7)
10. docs/notes/plannotator-coexistence-spike.md — US-006 (refuse-on-collision, implemented)
11. docs/notes/planos-review-command.md      — Phase-3 /planos-review AC-17 boundary note
12. .omc/state/sessions/*/prd.json           — Phase-1 26 stories (all passes:true)

## Verified state — PROJECT COMPLETE (planos v1.0.0; HEAD 5b668b8 on main; pushed)
ALL 4 PHASES DONE. design.md §3 (all three entry modes) + Phase-4 polish ship.
Re-run to confirm:
  node --test tests/*.test.mjs tests/harness/*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
  npx tsc --noEmit ; echo tsc=$?
  node tests/harness/import-graph.mjs 2>&1 | tail -1                 # VERDICT CLEAN (ac17Roots UNCHANGED; Q5 negative proof)
  node tests/harness/verify-exit-gate.mjs >/dev/null 2>&1; echo $?   # Phase-1 FROZEN gate, 0
  node tests/harness/prd-smoke.mjs 2>&1 | tail -1                    # Phase-2 persistence, PASS
  node tests/harness/review-smoke.mjs 2>&1 | tail -1                 # Phase-3 envelope shape, PASS
Expected: full suite 49/49/0; tsc=0; AC-17 VERDICT CLEAN; Phase-1 gate 0;
prd-smoke PASS; review-smoke PASS. (ac17-invariant.test.mjs:46 'require' TS
hint is the KNOWN false-positive — used at runtime, not a regression.)
Commits: …b4dd894 P5(Phase2) · 2bf39f9 R5(Phase3) · cebe010 P3-handoff ·
8d60389 Q0 · 5afcaf8 Q1 · 034ba2a Q2 · 4bf4e7d Q3 · 9039cdb Q4 ·
5b668b8 Q5(Phase4 done — v1.0.0).

## What exists & works (do not redo)
- Plan-mode loop: EnterPlanMode (PreToolUse → bin/planos enter injects v1 schema)
  → agent authors → ExitPlanMode (PermissionRequest 96h → bin/planos exit) blocks
  on a localhost server + single-file SPA → FeedbackEnvelope → deny/approve loop.
  Falsified-clear at 1.000 live ID-preservation (ADR-0001).
- PRD mode: /planos-prd command → bin/planos prd (boots same server directly,
  NOT a hook) → v2 blocks (phase/tradeoff/fileChange/code/table/diagram, mermaid
  rendered offline) → append-only persistence prds/<id>/rNNN.json + latest.json
  → minimal multi-revision history browser.
- /planos-plan + /planos-prd self-contained Socratic commands.
- Engine: src/schema (hand-rolled validator, v1∪v2, opaque IDs, envelope,
  fallback), src/hook (enter/exit/prd/roundtrip/coexistence), src/server,
  src/diff (structural + reanchor), src/editor (React single-file SPA),
  src/prd/store.mjs. Harness: tests/harness/{runner,live-driver,run-live,
  metrics,import-graph,verify-exit-gate,prd-smoke,seams}.mjs + 22 test files.

## Remaining work — NONE. planos is COMPLETE (v1.0.0, all 4 phases).
PHASE 3 — Diff review mode — ✅ COMPLETE (HEAD 2bf39f9; ADR-0003; 16 AC-R).
PHASE 4 — Polish & distribution — ✅ COMPLETE (HEAD 5b668b8; ADR-0004; v1.0.0).
  IN (shipped): themes (light/dark/OS-auto, SPA-side, theme.ts token layer);
  markdown export — pure src/export/markdown.mjs serializer consumed SPA
  ("Download .md") + out-of-blocking-path `bin/planos export` CLI; PDF via
  browser window.print() + @media print stylesheet (zero new dep); marketplace
  listing hardened (plugin.json/marketplace.json schema-valid, README +
  plugin/README, version 1.0.0); design.md §10 plannotator row FORMALLY
  CLOSED (refuse-on-collision is the permanent posture — full coexistence
  infeasible without a CC cross-plugin primitive; user-descoped).
  DEFERRED w/ recorded rationale in ADR-0004: Bun single-binary (Q5),
  encrypted local share (Q6), graceful plannotator coexistence (Q7).
  AC-17 RE-ASSERTED by NEGATIVE proof (export modules ABSENT from the
  exit|prd|review blocking-handler closure; ac17Roots() UNCHANGED — no new
  blocking root / carve-out). Commits Q0 8d60389 · Q1 5afcaf8 · Q2 034ba2a ·
  Q3 4bf4e7d · Q4 9039cdb · Q5 5b668b8. Plan:
  .omc/plans/planos-phase4-plan.md (Resolved Decisions Q1–Q8 signed off
  2026-05-16). Full build log: .omc/plans/progress.txt Phase 4 section.

No further phases planned. design.md §3 (plan / PRD / diff-review) + §9 all
delivered. Any future work is new scope: open a fresh plan with the architect,
surface Open Decisions for sign-off, execute milestone-by-milestone with the
verify gate (suite + tsc + AC-17 import-graph CLEAN + Phase-1 FROZEN gate +
prd-smoke + review-smoke) between every milestone, one commit per milestone.
Keep the AC-17 invariant and the committed single-file offline
plugin/dist/index.html (byte-identical drift check, <4 MB cap) intact.
KNOWN OPEN ITEM (non-blocking): plugin.json `license` = "UNLICENSED" (no
LICENSE file exists; honest default for a private esolutions.gr repo) — set
a real license if marketplace distribution is intended.

## Hard constraints (do NOT violate)
- AC-17: NO model call / network egress / agent spawn inside ANY blocking
  server-round-trip path (bin/planos exit AND bin/planos prd AND a future
  bin/planos review). Add the new entrypoint to tests/harness/import-graph.mjs
  ac17Roots() + extend tests/ac17-invariant.test.mjs (runtime + static) — keep
  VERDICT CLEAN. Interview/authoring run pre-server in the CLI agent loop =
  legitimate; the blocking path stays model-free. Filesystem (node:fs) is
  allowed (fs ≠ network/model).
- Block IDs are agent-authored opaque tokens (ADR-0001); §6 mechanisms
  (instruction inject + (id,kind,title) deny-echo table + deterministic
  re-anchoring + baseRevision race guard) are load-bearing — reuse, don't
  reinvent. NO Phase-1 ID-gate re-measurement needed (AC-P18 reasoned waiver).
- Frozen Phase-1 bars in tests/harness/metrics.mjs FROZEN_BARS are FROZEN —
  never tune. Phase-1 exit gate must keep passing (regression guard).
- Zero runtime deps in the blocking path; one committed offline single-file
  plugin/dist/index.html (currently 3.25 MB, cap 4 MB; rebuild + byte-identical
  drift check on any SPA change; mermaid is build-time bundled, SPA-side only).
- PRD persistence is append-only (never mutate a prior rNNN.json);
  path-traversal-safe.
- plannotator/2nd-ExitPlanMode-plugin: detect-and-refuse is the decided posture
  (user confirmed — do not build coexistence in Phase 1–3; it's Phase-4 scope).
  Escape hatch PLANOS_ALLOW_COEXIST=1.
- Keep ALL existing tests green, tsc clean, AC-17 CLEAN between every step.
  The ac17-invariant.test.mjs:46 'require' TS hint is a KNOWN false-positive
  (used at runtime) — not a regression.

## Testing the plugin (interactive only)
PermissionRequest/ExitPlanMode hooks do NOT fire under `claude -p` (headless).
Dogfood interactively:
  cd /Users/ggiak/www/esolutions.gr/planos && claude --plugin-dir ./plugin
then /planos-plan <topic> or plain plan mode (plan loop) or /planos-prd <topic>
(PRD mode → approve persists prds/<id>/r001.json → re-run → r002 + diff).

## Workflow
This was driven via /autopilot then milestone delegation to executor agents
with a verify gate between milestones and one commit per milestone. Continue
that. Update .omc/plans/progress.txt each milestone. Project memory:
/Users/ggiak/.claude/projects/-Users-ggiak-www-esolutions-gr-planos/memory/
(MEMORY.md index + plannotator-coexistence-descoped.md).
Commit only what the user asks; main is the working branch (greenfield, no
remote pushes requested). node_modules + .omc/state are gitignored.
```

---

## Context for the human (not the resume agent)

- **Status:** Phase 1 + Phase 2 + Phase 3 are done, verified, committed (HEAD
  `2bf39f9`, tree clean except gitignored .omc state churn). Full suite
  45/45/0, `tsc` 0, AC-17 import-graph CLEAN (incl. review roots, LAYER 2c),
  Phase-1 FROZEN exit gate PASS, PRD persistence smoke PASS, Phase-3 review
  envelope smoke PASS. All three design.md §3 entry modes shipped.
- **What's left:** Phase 4 ONLY (polish/distribution: themes, markdown/PDF
  export, optional Bun single-binary, marketplace listing, the DEFERRED full
  plannotator hook-collision *resolution*). Additive — not blocking-path
  engine work; keep AC-17 + the committed single-file offline dist intact.
- **Decisions already locked:** opaque IDs (ADR-0001), hand-rolled validator
  (ADR-0000), committed append-only PRD persistence + bundled offline mermaid +
  lighter-but-rigorous Phase-2 gate (ADR-0002, D1–D6), Phase-3 diff-review
  (ADR-0003, R1–R7: R1 pre-server gh/git ingestion / R2 ephemeral / R5 no new
  envelope op / AC-R-WAIVER), refuse-on-collision for plannotator
  (user-confirmed, descoped through Phase 3 — Phase-4 scope).
- **Recommended next step:** ask the resuming agent to plan Phase 4 with the
  architect, sign off its Open Decisions, then build it milestone-by-milestone
  exactly like Phase 2/3 (verify gate now also includes review-smoke).
- **Unrelated aside:** `/doctor` flags a benign OMC-4.14.0 upstream manifest
  quirk (declares a `commands/` dir it no longer ships) — accepted, does not
  affect planos. Restart Claude Code to run OMC 4.14.0.
