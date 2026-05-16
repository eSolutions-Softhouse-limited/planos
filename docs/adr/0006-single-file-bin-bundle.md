# ADR 0006 — Single-file bundled `plugin/bin/planos` (plugin is now distributable)

- Status: **ACCEPTED** — `plugin/bin/planos` is an esbuild bundle of the new
  SOURCE dispatcher `src/bin/planos-entry.mjs` (static imports of all five
  handlers). `npm run build:bin` (esbuild.bin.mjs). `plugin/package.json`
  `{"type":"module"}` added so the shipped bin resolves as ESM with no
  reliance on the repo-root package.json. AC-17 stays provably enforced; the
  frozen `ac17Roots()` is byte-UNCHANGED.
- Date: 2026-05-17
- Deciders: user sign-off in the planos-prd field-test follow-up session
  (chose "Single-file bin/planos bundle" for the packaging defect); design +
  AC-17 resolution from two architect consults.
- Supersedes: the `plugin/bin/planos` dispatcher's
  `import(resolve(__dirname,'../../src/hook/*.mjs'))` boundary-escaping
  resolution. Does NOT supersede the AC-17 doctrine of ADR-0004; it preserves
  it (see Safety Argument).
- Raw evidence: `tests/bin-bundle.test.mjs` (AC-DIST-0/1/1b — byte-identical
  drift + self-containment), `tests/packaging-no-src.test.mjs` (AC-DIST-2 —
  bundled bin runs from a `plugin/`-only dir with NO src/), hardened
  `tests/packaging.test.mjs` (quote-agnostic dispatch + source-entry check),
  `tests/ac17-invariant.test.mjs` LAYER 1b (now walks
  `[...ac17Roots(), src/bin/planos-entry.mjs]`; `ac17Roots()` byte-frozen),
  `tests/harness/import-graph.mjs` VERDICT CLEAN, `esbuild.bin.mjs`,
  `src/bin/planos-entry.mjs`.

## Context

The marketplace ships `source: "./plugin"` (`.claude-plugin/marketplace.json`).
Only `plugin/`'s contents are packaged: an install has `bin/ dist/ commands/
hooks/` but **no `src/`** (it lives at the repo root, outside `plugin/`). The
old `plugin/bin/planos` did `import(resolve(__dirname,'../../src/hook/*.mjs'))`,
which escapes the package boundary — a real, remote, or cache install could
not import any handler. It only worked because the local *directory*
marketplace runs the plugin in-place from the repo, where `../../src`
resolves. `packaging.test.mjs` only validated manifest JSON, never executed an
installed layout, so the defect shipped silently in 1.0.0.

## Decision

Bundle the dispatcher + its entire static `src/` closure into ONE
self-contained, zero-dependency `plugin/bin/planos` (esbuild, ESM, node:
builtins external, minify off for a stable reviewable diff). Mirrors the
already-accepted single-file `plugin/dist/index.html` SPA precedent. The
committed source-of-truth for AC-17 stays `src/`; the bundle is a committed,
deterministically-rebuildable build artifact.

## Decision Drivers

- The plugin must be installable/distributable, not only runnable in-place.
- The project already has a single-file-artifact precedent (the SPA) with an
  AC-P17 byte-identical drift gate — reuse that exact trust model.
- Zero runtime dependencies must remain zero (esbuild inlines first-party
  `src/` only; node: builtins external).

## Alternatives Considered

1. **Vendor `src/` into `plugin/src/`** — committed duplicate tree + path
   rework + a drift copy. More moving parts than one bundled file.
2. **Ship the repo root as the plugin** — drags tests/docs/config into the
   package; needs ignore rules; widest blast radius.
3. **Document only** — leaves the plugin non-distributable. Rejected: user
   wants it fixed.

## AC-17 Safety Argument

`ac17Roots()` (`tests/harness/import-graph.mjs`) is **byte-UNCHANGED** — the
frozen byte-exact `deepEqual` and the AC-Q12 negative proof (both derived from
the unchanged `ac17Roots()`) are intact and pass. The shipped
`plugin/bin/planos` is an esbuild bundle of the static-import SOURCE
dispatcher `src/bin/planos-entry.mjs`; the bundled file is edgeless, so the
LAYER 1b positive walk follows the dispatcher's enter/exit/prd/review/export
edges via the SOURCE entry instead — LAYER 1b now walks
`[...ac17Roots(), src/bin/planos-entry.mjs]` (one extra walk root in ONE
positive test; not a change to the frozen `ac17Roots()` function). `enter.mjs`
is retained as the "real walk, not grep" canary — it is reachable ONLY
transitively via the new source entry's static `import { handleEnter }`, a
stricter probe than the old dynamic-import edge. The negative proof's
blocking-handler closure (`ac17Roots()` minus the dispatcher) is
mathematically unaffected because `src/bin/planos-entry.mjs` IS the dispatcher
AC-Q12 deliberately excludes. The positive closure legitimately includes
`src/hook/export.mjs`/`src/export/markdown.mjs` (zero-import, model-free per
ADR-0004 Q3) — the positive test makes no absence claim; export reachability
is owned solely by the untouched negative proof. The safety composition:
*import-graph walk proves the `src/` closure is model-free* ∧
*`tests/bin-bundle.test.mjs` proves committed `plugin/bin/planos` ≡ a fresh
deterministic build of exactly that `src/`* ∧ *`tests/packaging-no-src.test.mjs`
proves the artifact runs self-contained* ⟹ *the shipped blocking path is
provably the audited model-free code* — strictly stronger than 1.0.0, which
checked the shipped artifact not at all.

## Consequences

- **Positive:** the plugin is genuinely distributable; the shipped artifact is
  now a checked invariant (drift + no-src gates); AC-17 proof preserved and
  strengthened (stricter enter.mjs probe).
- **Neutral:** `plugin/bin/planos` is now generated — edit
  `src/bin/planos-entry.mjs` (or the handlers) then `npm run build:bin`; the
  drift gate fails loudly on a stale commit (run `build:bin` before the gate,
  as `editor-render` does for `build:editor`).
- **Cost / follow-up (non-blocking, future ESCALATED change):** the
  architecturally cleanest end-state lists `src/bin/planos-entry.mjs` as an
  explicit `ac17Roots()` member (restoring the Phase-2/3 dispatcher-independent
  doctrine for the bundled world). That changes the frozen byte-exact
  assertion and requires the same escalation rigor as ADR-0004; deferred.
  Shipping 1.0.x without it is acceptable because the drift + no-src gates
  compose the equivalent guarantee.
- **Boundary preserved:** diff-review v2 rejection (R7) and every blocking
  invariant are untouched; `resolveSpaHtmlPath()` already has packaged-layout
  candidates so the SPA still resolves from the bundled bin's location
  (verified by the no-src packaging test).
