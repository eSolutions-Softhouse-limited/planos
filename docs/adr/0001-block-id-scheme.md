# ADR 0001 — Block-ID Scheme (Milestone 1 hard gate)

- Status: **ACCEPTED** — production default wired to `opaque`
- Date: 2026-05-16
- Deciders: Milestone 1 live gate (automated, FROZEN bars, no tuning)
- Plan: `.omc/plans/planos-phase1-consensus.md` Decision 2 / Step 1.3 / AC-11 / AC-12 / AC-18 / AC-19
- Supersedes: the Step 1.1 deferral note in `src/schema/id-strategy.mjs`
- Raw evidence: `.omc/research/live-semantic-slug.json`, `.omc/research/live-opaque.json`

## Context

Block IDs are minted by the nondeterministic agent (design.md §4); §6 calls
their survival across agent revisions the single make-or-break Phase-1 risk.
Two candidate schemes were prototyped behind `PLANOS_ID_STRATEGY` (US-009),
neither pre-invalidated:

- **semantic-slug** — `<kindPrefix>-<slug(primaryText)>` (e.g. `task-build-index`).
  Pro: human-meaningful, may anchor agent recall. Con: title-edit / collision
  instability.
- **opaque** — short `b<number>` tokens, no semantic coupling. Pro: rename-stable.
  Con: no semantic recall hook — relies more on the §6.2 deny-echo table.

The decision was deferred to **empirical measurement against the REAL thin
loop with live agents**, vs **FROZEN bars** (never tuned):

- block-ID preservation **≥ 0.95**
- deny→revise convergence within ≤2 iterations for **≥ 0.90**
- live-run group: **≥ 5** runs, **no single run** below the bar (zero-regression tripwire)
- deterministic correctness: **100%** (graceful degradation + offline)
- first-try valid rate: **reported, NOT gated**

## How it was measured

The real thin loop was driven end-to-end per run (`tests/harness/live-driver.mjs`,
billed runner `tests/harness/run-live.mjs`):

1. REAL `bin/planos enter` injects the v1 schema + worked example + the active
   strategy's ID rules (verbatim hook output).
2. A REAL `claude -p` agent authors a v1 block document from a realistic
   end-user prompt (≥3 deliverables). The agent mints its **own** IDs.
3. The REAL `src/hook/exit.mjs` `handleExit()` processes the authored text
   exactly as in production (parse / degrade / blocking server /
   `buildReviseMessage` with the `(id,kind,title)` echo table + canonical
   JSON). The only injected seams are the ones the hook already exposes for
   tests (stdin text, no-op browser, the forced `/api/deny` decision provider
   — that IS the forced revise).
4. The SAME agent session is resumed (`claude -p --resume`) and fed the REAL
   deny.message; it re-emits the document.

**Mechanical, judgment-free, frozen-at-author-time denominator (AC-12 spirit).**
The fixture's canned `expectedPreservedIds` cannot apply to a live run (the
live agent mints its own IDs, not the fixture's). The live denominator is the
set of IDs the agent minted in its **author** document, captured **before** the
forced revise; preservation = `|authorIds ∩ revisedIds| / |authorIds|` — pure
set-intersection, zero runtime human judgment. The forced-revise feedback
explicitly requests a structure/ID-preserving revision so "every author id
should survive" is a well-defined expectation. This is precisely the §6
falsifier: does the agent renumber/re-mint IDs when it regenerates the whole
document across a revision?

Group (ii) canned regression uses the separate fixture-frozen
`expectedPreservedIds` set (frozen at fixture-design time), over the 32-fixture
suite, exactly as `tests/harness/runner.mjs runCannedFixture` already did.

## Measured results (FROZEN bars — not adjusted)

### Group (iii) live — the authoritative §6 falsifier

| scheme | runs | ID-preservation | any run < 0.95? | converged ≤2 (rate) | first-try (reported) | gate |
|---|---|---|---|---|---|---|
| **semantic-slug** | 6 | **1.000** | no | 1.000 | 1.000 | **PASS** |
| **opaque** | 6 | **1.000** | no | 1.000 | 1.000 | **PASS** |

Per-run (rate; denominator = agent-authored block count):

- semantic-slug: search 1.000(21) · checkout 1.000(28) · notifications 1.000(34) · file-upload 1.000(33) · dashboard 1.000(24) · onboarding 1.000(28)
- opaque: search 1.000(16) · checkout 1.000(27) · notifications 1.000(35) · file-upload 1.000(27) · dashboard 1.000(23) · onboarding 1.000(25)

Every live run produced a schema-valid revised document that preserved **100%**
of the agent's own author-minted IDs across a forced revise — across 16–35
block documents in six distinct realistic domains, for **both** schemes, with
**zero** regressions.

### Group (ii) canned regression (n = 32, ≥30 required)

- ID-preservation = **1.000** (≥0.95) · convergence ≤2 = **1.000** (≥0.90) · gateReady = true → **PASS**

### Group (i) deterministic correctness

- graceful degradation = true · offline (zero egress) = true · evaluated = true → **PASS** (100%)

### First-try valid rate (reported, NOT gated)

- semantic-slug 6/6 = 1.000 · opaque 6/6 = 1.000

## Decision

**Both schemes cleared every FROZEN bar at the maximum (1.000).** The gate did
not discriminate. Per Step 1.3 the scheme that clears the bars is selected;
with a perfect tie the tie-break is principled and recorded here:

**Chosen production default: `opaque`.**

Rationale:

1. **Residual-risk asymmetry.** This Phase-1 forced revise is intent-preserving
   (the deny feedback asks to tighten wording, not churn structure), so
   semantic-slug's documented weakness — title-edit / collision instability —
   was *not* stressed and remains **unmeasured**. opaque's only theoretical
   weakness — no semantic recall hook — *was* fully exercised and is
   **measured-and-handled**: the always-on §6.2 `(id,kind,title)` deny-echo
   table makes the agent copy IDs verbatim rather than recall them, and opaque
   scored a perfect 6/6 = 1.000. Choosing opaque selects the scheme whose
   residual risk we have empirically proven is absorbed.
2. **Rename / growth stability.** opaque tokens have no coupling to block text,
   so future revisions that heavily edit titles (Phase 2+ PRD mode) cannot
   induce slug drift or slug collisions as documents grow.
3. **No measured cost.** opaque matched semantic-slug exactly on every gated
   metric and on the reported first-try rate, so the robustness gain carries
   no observed downside.

semantic-slug is retained as a **validated, equal-measured-merit alternative**,
selectable via `PLANOS_ID_STRATEGY=semantic-slug`.

Wired: `src/schema/id-strategy.mjs` `PRODUCTION_DEFAULT_STRATEGY = "opaque"`
(`DEV_DEFAULT_STRATEGY` retained as a back-compat alias); `getStrategy()` /
`activeIdStrategy()` fall back to `opaque` when the flag is unset; the explicit
flag still overrides.

## Failure branch (NOT taken)

The plan's explicit Milestone 1 failure branch — *if neither scheme clears the
frozen bars, Phase 1 FAILS, halt, escalate a re-scoping proposal for explicit
sign-off, never tune the bars* — was **not** triggered: both schemes passed
every bar. The bars in `tests/harness/metrics.mjs FROZEN_BARS` were **not
modified** at any point (idPreservation 0.95, convergenceWithin2 0.90,
cannedMinN 30, liveMinRuns 5).

## Consequences

- Phase 1's make-or-break risk (design.md §6) is **falsified-clear** under the
  full mechanism set: instruction injection + deny-echo table + the proven
  hook loop yield 100% live ID preservation for the chosen scheme.
- The deterministic re-anchoring fallback (AC-13, `src/diff/reanchor.mjs`)
  remains as defence-in-depth; the gate did not need to rely on it.
- Milestone 2-full and beyond proceed on `opaque`.
- ≥5 live runs is a zero-regression tripwire, not a statistical estimator; the
  perfect result does not claim a population point estimate, only that no run
  regressed under the gate.
- Follow-up (out of Phase 1 scope): if semantic-slug is ever reconsidered,
  re-measure it under a title-churning (non-intent-preserving) forced revise,
  which this gate intentionally did not stress.
