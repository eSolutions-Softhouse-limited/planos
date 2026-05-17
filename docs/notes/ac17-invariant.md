# AC-17 Invariant — Allow/Deny Boundary

> **Historical context.** This note was written before ADR-0007 (PRD-only consolidation).
> References to `bin/planos exit`, `ExitPlanMode`, `/planos-plan`, and `handleExit` describe
> the plan-mode hook path that was removed. The invariant itself — no model call / network
> egress / agent spawn inside the blocking path — still holds for `bin/planos prd` (the only
> remaining blocking round-trip). The authoritative current statement is in ADR-0007 and
> `docs/adr/0007-consolidate-prd-only.md`. The test enforcement is in
> `tests/ac17-invariant.test.mjs`.

**US-021 / Milestone 4, Step 4.2**
**Related:** consensus plan AC-16/AC-17, `docs/design.md §4, §5`,
`docs/notes/planos-plan-command.md`, `tests/ac17-invariant.test.mjs`,
`tests/harness/import-graph.mjs`, `tests/handoff.test.mjs`.

---

## The invariant (consensus plan AC-17)

> **No model call inside the blocking `ExitPlanMode` hook path.**

Block IDs are authored by the **nondeterministic agent** (design.md §4) — that
is *why* the §6 ID-stability mechanisms (injected instruction, deny-echo table,
content re-anchoring) exist. planos does not, and cannot, make ID generation
deterministic. The enforced, testable invariant is therefore narrower than
"deterministic IDs": **the path that turns agent output into the canonical
artifact and serializes the decision contains no model call.**

## What is ALLOWED (legitimate — out of scope)

The `/planos-plan` Socratic **interview** is a **pre-plan-mode, live-agent CLI
dialogue**. It runs in the terminal, initiated by the user, *before* plan mode
and *before* the blocking hook ever fires:

```
User types /planos-plan
      ↓
Live agent runs the Socratic interview IN THE CLI        ← ALLOWED (legitimate)
      ↓
Agent authors the v1 block document JSON                 ← ALLOWED (legitimate)
   (including agent-minted block IDs — §4)
      ↓
Agent calls ExitPlanMode  ───────────────────────────────┐ blocking path STARTS
      ↓                                                   │
bin/planos exit  →  src/hook/exit.mjs                     │  NO model call
   → src/schema/* (validate / fallback / id-strategy)     │  NO model call
   → src/diff/*   (structural / reanchor)                 │  NO model call
   → src/server/index.mjs (loopback blocking server)      │  NO model call
      ↓                                                   │
Browser opens (OS opener spawn — allowed boundary)        │  NO model call
      ↓                                                   │
User POSTs approve / revise (loopback)                    │  NO model call
      ↓                                                   │
Decision JSON → stdout, process exits 0  ─────────────────┘ blocking path ENDS
```

The interview's live-agent calls are **legitimate and explicitly out of scope**
of AC-17. They are never invoked from `bin/planos exit` or any module in its
transitive import graph. Authoring the document — **including the agent-minted
block IDs** — happens in the **agent loop BEFORE the blocking hook**, not
inside it.

The **OS browser-opener** (`open` / `xdg-open` / `cmd /c start`) is a single
fire-and-forget `child_process.spawn` of the host URL handler. It is **NOT** a
model call and **NOT** an agent spawn, and it produces **zero network egress
from this process**. It is the one documented `child_process` use on the
blocking path. In tests the opener seam is always injected as a no-op, so the
test path spawns nothing at all.

## What is FORBIDDEN

Any **model invocation** reachable from:

- `bin/planos exit` (the PermissionRequest hook entrypoint / dispatcher)
- `src/hook/exit.mjs` and every module it transitively imports
- `src/schema/` (validator, fallback, id-strategy, envelope)
- `src/diff/` (structural diff, re-anchor)
- `src/server/` (the loopback blocking server)

Concretely forbidden in that transitive set: any agent SDK
(`@anthropic-ai/*`, `@anthropic*`), any model client (`openai`, `@ai-sdk/*`,
`langchain`, `cohere-ai`, …), any third-party network-client wrapper
(`axios`, `node-fetch`, `undici`, `got`, …), any outbound non-loopback socket,
any DNS resolution of an external host, and any `child_process` spawn of an
agent runtime.

## How it is enforced (two layers, `tests/ac17-invariant.test.mjs`)

1. **Static import-graph walk** — `tests/harness/import-graph.mjs` performs a
   *real module-reachability walk* (parse `import` / `export … from` /
   `require()` / dynamic `import()`, resolve each **static** specifier, recurse
   to transitive closure). It is **NOT a flat text grep**. It asserts the
   transitive set of the roots above contains **no** agent-SDK /
   model-client / network-client module.
   **Fail-closed rule:** a dynamic `import()` / `require()` whose specifier is
   **not a provable static string** in any *reachable* module makes the graph
   unbounded — the invariant cannot be proven, so the walk **fails closed**
   (reports DIRTY), it does not optimistically pass. The one provable
   exception is the dispatcher's `import(resolve(__dirname, '<literal>'))`
   form: the path argument is a literal segment passed through `node:path`
   `resolve()` only for cwd-independence, so it is fully static and is
   followed as a real graph edge.

2. **Runtime no-egress / no-spawn assertion** — `bin/planos exit` is exercised
   in **real-SPA mode** with an **injected no-op browser opener** and a scripted
   thin loopback decision. Interceptors are installed at the lowest practical
   process/socket boundary: `node:net` connect, `node:dns`
   lookup/promises-lookup, `node:child_process`
   spawn/spawnSync/exec/execSync/execFile/execFileSync/fork, global `fetch`,
   and `http(s).request`. The test asserts **zero non-loopback network
   egress**, **zero external DNS resolution**, and **zero process/agent
   spawn**. Loopback (the local blocking server + the scripted loopback POST)
   is distinguished from external egress and permitted; the real OS opener is
   asserted never to run on the test path (the injected no-op replaces it).

## Self-containment

`/planos-plan` must work with **no external skill** installed (no
`/deep-interview`, `/grill-me`, etc.). The interview logic is defined inline in
`plugin/commands/planos-plan.md`. See `docs/notes/planos-plan-command.md`.

## Live-run gate (explicitly deferred)

The canned handoff fixture (`tests/handoff.test.mjs`) and the offline runtime
assertion here are the **offline** portion of AC-16/AC-17. Live-agent runs of
the full interview→author→ExitPlanMode loop are the **user's Milestone-1 / -5
gate** (consensus plan AC-19(iii), Steps 5.2–5.3) and are intentionally not
automated here.
