# Spike: plannotator coexistence — Claude Code multi-plugin `ExitPlanMode` dispatch

- Story: US-006 / AC-21 (plan `.omc/plans/planos-phase1-consensus.md` Step 0.6)
- Status: **RESOLVED for Phase 1** (descoped to refuse-on-collision per explicit user decision)
- Date: 2026-05-16
- Feeds: Step 2-thin.2 and Step 2f.3 stdout-decision-ownership design

## Question (AC-21)

If a second plugin (e.g. plannotator) also declares a `PermissionRequest`
matcher for `ExitPlanMode` alongside planos, does Claude Code dispatch the
event to **all** matching plugins, the **first**, or **error**? And who owns
the single PermissionRequest stdout decision?

## Scope decision (authoritative for Phase 1)

The user explicitly decided: **planos does not need to coexist with
plannotator. If a colliding second `ExitPlanMode` plugin is present, planos
may detect-and-refuse (throw).** Full coexistence resolution was already a
Phase-4 Non-Goal and Phase 1 already runs in a clean single-plugin
environment (consensus plan locked decision #4). This descopes the spike from
"design coexistence" to "document the dispatch semantics and record the
refuse-on-collision posture". No empirical multi-plugin corroboration run was
spent (it would require an interactive session — see limitation below — and is
not load-bearing for a refuse posture).

## Findings — Claude Code multi-plugin hook dispatch (documented)

Sourced from Claude Code hooks/settings docs and tracked issues
(code.claude.com/docs/en/hooks, .../settings; github.com/anthropics/claude-code
issues #29724, #15897, #21533):

1. **All matching hooks fire — in parallel.** When multiple plugins (and
   user/project settings) register a hook for the same event, Claude Code
   merges them and runs **all** matching hooks. There is **no** first-wins,
   no priority ordering, no per-matcher precedence. Behaviour is uniform
   across `PreToolUse` / `PermissionRequest` / `UserPromptSubmit` / etc.

2. **Deduplication caveat (bug #29724).** Plugin hooks are deduplicated by the
   *command template string* **before** `${CLAUDE_PLUGIN_ROOT}` is expanded.
   Two plugins whose command strings are byte-identical pre-expansion (e.g.
   both `bash ${CLAUDE_PLUGIN_ROOT}/hook.sh`) collapse to one. planos invokes
   `${CLAUDE_PLUGIN_ROOT}/bin/planos exit`; plannotator's command differs
   (different binary/args), so the two are **not** deduplicated → **both
   would fire**. planos is therefore *not* at risk of being silently dropped,
   but it is also *not* the sole hook if plannotator is installed.

3. **PermissionRequest reconciliation = deny-wins conjunction.** If multiple
   `PermissionRequest` hooks respond: any `deny` → the tool call is denied;
   the tool proceeds only if **all** hooks `allow`. Settings `deny` rules
   outrank hook decisions. There is no documented "last/first write wins"
   ownership of the decision — it is a conjunction, not a single owner.

4. **`claude -p` (non-interactive) does NOT fire `PermissionRequest`.** Plan
   mode / `ExitPlanMode` PermissionRequest hooks fire only in **interactive**
   sessions. In `-p` mode you must use `PreToolUse` for permission automation.
   Consequence: a headless empirical probe of `ExitPlanMode` multi-plugin
   dispatch is **impossible**; the documented semantics above are the answer.

5. **No hook namespacing / no collision warning.** Skills are namespaced
   (`/plugin:skill`); hooks are not. Claude Code emits no warning when
   multiple plugins hook the same event. Inferred mitigations only (specific
   matchers, unique script filenames, documenting your hooks).

## Implication for planos (Step 2-thin.2 / Step 2f.3 — stdout-decision-ownership)

If plannotator (or any second `ExitPlanMode` PermissionRequest plugin) is
installed alongside planos:

- Both hooks fire in parallel. **Two blocking servers would boot and two
  browsers would open**, and the PermissionRequest decision is reconciled by
  Claude Code as a deny-wins conjunction across both — neither plugin "owns"
  stdout exclusively. This is an unrecoverable UX/state collision for a
  blocking 96h round-trip; graceful coexistence is genuinely a Phase-4-sized
  problem and is out of Phase-1 scope.
- **Decided posture (Phase 1): detect-and-refuse — IMPLEMENTED.**
  `src/hook/coexistence.mjs` scans the siblings of `CLAUDE_PLUGIN_ROOT` for any
  other plugin whose `hooks/hooks.json` declares a `PermissionRequest`
  `ExitPlanMode` matcher; `handleExit` consults it on the **production path
  only** (scripted/harness/live-driver runs are clean-env by construction and
  opt out, so the Phase-1 gate and the test suite are unaffected) and, on a
  positive detection, refuses **without booting the server or emitting a
  stdout decision** (stderr explanation + non-zero exit) rather than
  double-booting. Detection is pure local-fs (AC-17 import-graph stays CLEAN,
  re-verified) and defensive (any error → "no collision", never spuriously
  blocks a clean env). Escape hatch: `PLANOS_ALLOW_COEXIST=1`. Covered by
  `tests/coexistence.test.mjs` (7 tests). The exclusive-stdout-ownership
  assumption in `bin/planos exit` is therefore *intentional and now
  enforced*, not an oversight.
- No change to the clean-env Phase-1 loop: in the absence of a colliding
  plugin (the Phase-1 environment), planos is the sole owner and behaves
  exactly as built. The actual implementation of the detect-and-refuse guard
  is a small follow-up (it does not block the Milestone 1 gate or the Phase-1
  exit gate, both of which run clean-env).

## Limitation (honest)

The "all matching plugins fire / deny-wins" conclusion rests on Claude Code's
documentation + tracked issues, not a live two-plugin `ExitPlanMode`
observation, because `PermissionRequest` hooks do not fire under `claude -p`
(finding #4) and an interactive multi-plugin session is outside the headless
scope. Given the descoped requirement (refuse-on-collision, not coexistence),
empirical dispatch measurement is not needed to satisfy AC-21 — the documented
semantics fully determine the refuse posture. Two ready stub plugins exist at
`tests/spike/plugin-a` and `tests/spike/plugin-b` (distinct command templates,
so not subject to bug #29724) for a future interactive corroboration if ever
needed.
