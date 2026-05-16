# Work Plan: planos — Phase 4 (Polish & Distribution: Themes + Markdown/PDF Export + Bun + Encrypted Local Share + Marketplace Listing + Plannotator Coexistence Resolution)

- Plan ID: planos-phase4-plan
- Generated: 2026-05-16
- Revision: 1 (planning only — pending approval; not yet consensus-reviewed)
- Status: PLANNING ONLY — no implementation
- Sources of truth: `docs/design.md` (§1 non-goals incl. the Phase-4 "revisit" parentheticals + the "markdown becomes an export format, not the source of truth" thesis, §8 tech stack incl. "Revisit Bun in Phase 4 if a single binary is wanted", §9 Phase 4 scope line, §10 the plannotator coexistence row), `docs/adr/0000-validator-choice.md`, `docs/adr/0001-block-id-scheme.md`, `docs/adr/0002-prd-persistence.md`, `docs/adr/0003-diff-review.md` (ALL locked — AC-17 invariant, opaque IDs, zero-runtime-deps-in-blocking-path, committed single-file offline `plugin/dist/index.html` with byte-identical drift check + <4 MB cap, FROZEN Phase-1 bars — carry forward UNWEAKENED), `docs/notes/plannotator-coexistence-spike.md` (full CC multi-plugin dispatch semantics + the current detect-and-refuse posture), `.omc/plans/planos-phase3-plan.md` AND `.omc/plans/planos-phase2-plan.md` (structure mirrored EXACTLY), `.omc/plans/progress.txt` (Phase 1–3 build log + milestone discipline), and the real Phase 1+2+3 source under `src/`, `plugin/`, `tests/`
- Mode: standard plan (RALPLAN-DR not run — this is a draft for human sign-off + consensus pass)
- Repo: Phase 1 (plan-mode loop + ADR-0001 ID de-risk), Phase 2 (PRD mode + v2 vocab + persisted revisions), and Phase 3 (diff-review mode + v3 `diff` kind) COMPLETE, verified, committed; HEAD `cebe010`, branch `main`, tree clean (except gitignored `.omc` state churn). All three design.md §3 entry modes ship.

---

## 1. Context

Phase 1 proved the structured-artifact loop and falsified-clear the §6 block-ID-stability risk (ADR-0001: `opaque` is `PRODUCTION_DEFAULT_STRATEGY`, 1.000 live preservation). Phase 2 added PRD mode + v2 vocab + append-only persisted revisions (ADR-0002). Phase 3 added the third and final entry mode — diff-review (`bin/planos review`, v3 `diff` kind, ephemeral) — with AC-17 RE-ASSERTED for every blocking entrypoint (ADR-0003). **All three design.md §3 entry modes ship. Phase 4 is the FINAL phase: polish & distribution — it adds NO new entry mode and NO new blocking-path engine work.**

Phase 4 delivers exactly what design.md §9 Phase 4 scopes: **themes**, **markdown/PDF export**, **optional Bun single-binary**, **optional encrypted local share (plannotator-style, opt-in)**, **marketplace listing**, and the **DEFERRED full plannotator hook-collision coexistence resolution** (today: detect-and-refuse, `src/hook/coexistence.mjs`). These are **additive polish / distribution surfaces**, NOT blocking-path engine changes. Critically, **several are explicitly "optional" in design.md** ("optional Bun single-binary", "optional encrypted local share"), and the user has **already descoped caring about plannotator coexistence through Phase 3** (project memory: *"don't care about plannotator coexistence; refuse-on-collision is fine"*). The headline decision (Q1) is therefore **which Phase-4 workstreams are IN scope vs. deferred/dropped**, with a recommended cut.

**The single architectural constant across all four phases — AC-17 — recurs here and is answered the same way.** Phase 1 established and Phases 2+3 RE-ASSERTED: *no model call / network egress / agent spawn inside the blocking server-round-trip path* (`bin/planos exit|prd|review` → `src/hook/*` → `src/server/` → `src/schema/` → `src/diff/`). Phase 4's surfaces are, by construction, **SPA-side or pre/post-server CLI surfaces**:

- **Themes** are SPA-side ONLY (CSS/inline-style tokens in `src/editor/`) — they never enter any `bin/planos *` blocking path. Lowest-risk workstream.
- **Markdown export** is a pure `Document → string` serializer. *Where* it runs is a first-class Open Decision (Q3), analyzed exactly like Phase 3's R1 gh/git boundary: the recommended position is **SPA-side (a download in the browser) + an out-of-blocking-path CLI subcommand (`bin/planos export`, NOT `exit|prd|review`)** — the serializer module is pure (`Document → markdown string`, zero deps, zero subprocess) and never imported by a blocking handler.
- **PDF export** is the heaviest risk: a PDF library is a large runtime dep. Per the hard constraint, PDF MUST be **browser print-to-PDF (zero dependency)** or build-time/out-of-blocking-path — never a blocking-path runtime dep. Recommended: **browser-native `window.print()` with a print stylesheet, zero new dep** (Q4).
- **Bun single-binary** is a *build/distribution* artifact (`bun build --compile`), entirely outside the runtime blocking path; design.md §8 explicitly defers the Node-vs-Bun question to "Phase 4 if a single binary is wanted". It is genuinely optional (Q5).
- **Encrypted local share** is plannotator-style **LOCAL, opt-in, NO cloud/upload** — design.md §1's "no hosted service / no cloud / no upload / no share links in v1" non-goal stays in force; "share" here means an **encrypted local file** (e.g. an `age`/WebCrypto-encrypted self-contained HTML/JSON the user hands off out-of-band), NOT a hosted link. It is genuinely optional and the most scope-ambiguous (Q6) — recommended **DEFERRED/DROPPED** unless the user explicitly wants it.
- **Marketplace listing** is metadata/docs hardening of `.claude-plugin/marketplace.json` + `plugin/.claude-plugin/plugin.json` + `README` — zero code-path impact. Lowest-risk distribution workstream; recommended IN.
- **Plannotator full coexistence resolution** is the DEFERRED item from design.md §10. The user descoped it; the analysis below (§4) recommends **keeping detect-and-refuse and formally closing the §10 row as "resolved: refuse-on-collision is the accepted posture"** rather than building graceful co-operation (Q7) — this is treated as a first-class Open Decision per the brief.

The detect-and-refuse plannotator posture (`src/hook/coexistence.mjs`, escape hatch `PLANOS_ALLOW_COEXIST=1`, `tests/coexistence.test.mjs`) is unchanged unless Q7 explicitly resolves to build full coexistence. The FROZEN Phase-1 exit gate + `prd-smoke` + `review-smoke` + the AC-17 import-graph remain the regression guard between every milestone.

---

## 2. Reused from Phase 1/2/3 vs Genuinely New for Phase 4

### REUSED AS-IS (zero or near-zero change)

| Asset | File(s) | Why reusable unchanged |
|---|---|---|
| Hand-rolled validator engine + `V1_KINDS`/`V2_KINDS`/`V3_KINDS`/`KIND_VALIDATORS`/`DOC_TYPES` + three-tier `validateBlock` doc gate | `src/schema/validate.mjs` | Phase 4 adds NO new block kind and NO new doc type. The schema is FROZEN at v1∪v2∪v3. Export *reads* validated documents; it never extends the contract. ADR-0000's "revisit only if the schema grows materially" is NOT triggered (Phase 4 grows no schema). |
| All three blocking handlers + the round-trip engine | `src/hook/exit.mjs`, `src/hook/prd.mjs`, `src/hook/review.mjs`, `src/hook/roundtrip.mjs`, `src/server/index.mjs` | Phase 4 adds NO new blocking entrypoint. `bin/planos export` (Q3, if IN) is an **out-of-blocking-path** CLI surface that does NOT boot `startServer`, does NOT block, does NOT round-trip — it reads a document and writes markdown to stdout/file, exactly the gh/git pre-server doctrine (R1 Option A) applied to a *post*-server surface. |
| Opaque ID scheme + §6 mechanisms + AC-17 two-layer enforcement + `ac17Roots()` | `src/schema/id-strategy.mjs`, `tests/harness/import-graph.mjs` (`ac17Roots()` lines 601-623), `tests/ac17-invariant.test.mjs` (LAYER 1b/2b/2c) | ADR-0001 ACCEPTED; `opaque` rename-stable. **NO Phase-4 ID re-measurement** (AC-Q-WAIVER, mirrors AC-P18/AC-R-WAIVER): Phase 4 introduces ZERO new ID-minting surface — export/themes/share read existing IDs, never mint. The `ac17Roots()` + two-layer test are the proven re-assertion mechanism. |
| Single-file SPA build (Vite + `vite-plugin-singlefile`, committed `plugin/dist/index.html` = 3,414,771 B ≈3.26 MB, cap 4 MB, ≈0.74 MB headroom) + bundled offline mermaid | `vite.config.mjs`, `src/editor/main.tsx`, `package.json` (`build:editor`), `src/editor/mermaid.tsx` | Build pipeline unchanged. Themes + the markdown-export-download button + a print stylesheet compile into the SAME single artifact. Byte-identical drift check (AC-P17/AC-R15 pattern) re-run on every SPA change. **The ≈0.74 MB headroom is the hard budget for ALL Phase-4 SPA additions combined** (themes are CSS tokens ≈ negligible; the markdown serializer is small pure JS; `window.print()` is zero-dep; NO new heavy dep enters the SPA). |
| `BlockShell` comment affordance + `BlockRenderer` switch + `_never` exhaustiveness guard (now satisfied for all 14 kinds) | `src/editor/blocks.tsx` (switch line 1132, `_never` line 1201), `src/editor/types.ts`, `src/schema/types.d.ts` | Phase 4 adds NO block kind, so the `_never` guard and the 14-arm switch are untouched. Themes restyle existing renderers via a token layer; they do NOT add render arms. |
| Markdown *reader* (SPA-side, prose rendering) | `src/editor/markdown.tsx` | Renders `prose.md` in the SPA. Phase 4's markdown *export* is the INVERSE direction (`Document → markdown`) and is a NEW module — it does not reuse this reader, but the reader is unaffected. |
| Deterministic prose fallback (markdown→one prose block) | `src/schema/fallback.mjs` | The ONLY existing markdown-adjacent serializer, and it goes the *wrong way* (text→block). It is untouched; it confirms no `Document→markdown` serializer exists today (the export workstream is genuinely new — design.md §1's "markdown becomes an export format" is unimplemented). |
| Plannotator detect-and-refuse guard + tests | `src/hook/coexistence.mjs`, `tests/coexistence.test.mjs` (7 tests), `docs/notes/plannotator-coexistence-spike.md` | Unchanged UNLESS Q7 → build full coexistence (NOT recommended). It guards ONLY the `ExitPlanMode` PermissionRequest hook; `prd`/`review` command paths never touch it. If Q7 → keep-refuse (recommended), this is reused verbatim and the design.md §10 row is formally closed in ADR-0004. |
| AC-17 enforcement harness (static walk + runtime layers + smoke) + Phase-1 FROZEN gate + Phase-2/3 smokes | `tests/harness/import-graph.mjs`, `tests/ac17-invariant.test.mjs`, `tests/harness/verify-exit-gate.mjs` (FROZEN, untouched), `tests/harness/prd-smoke.mjs`, `tests/harness/review-smoke.mjs`, `tests/harness/metrics.mjs` (FROZEN_BARS untouched) | The verify gate Phase 4 must keep green between EVERY milestone. Phase 4 adds NO blocking root, so `ac17Roots()` is NOT extended (the export CLI, if IN, is asserted *out-of-blocking-path* — it is NOT a `bin/planos exit|prd|review` root and never imported by one; a NEW negative assertion proves the export module is absent from the blocking transitive closure — see AC-Q12). |

### GENUINELY NEW for Phase 4

| New asset | Proposed location | Purpose |
|---|---|---|
| Theme token layer (SPA-side only) | `src/editor/theme.ts` (NEW) + threaded through `src/editor/App.tsx` + `src/editor/blocks.tsx` (replace hard-coded hex with token refs) | A small named-palette token set (e.g. `light` default + `dark`) + a selector; SPA-side ONLY; NEVER imported by any `bin/planos *` blocking path. Scope per Q2. |
| Document→markdown serializer (PURE, zero-dep) | `src/export/markdown.mjs` (NEW) | Pure `(Document) → string` canonical markdown serializer covering all 14 v1∪v2∪v3 block kinds. ZERO imports / ZERO subprocess / ZERO network / ZERO clock (the R1-Option-A purity posture, mirroring `src/review/ingest.mjs`). Consumed SPA-side (download) AND by the out-of-blocking-path `bin/planos export` CLI — NEVER by `exit|prd|review`. |
| Markdown-export SPA affordance | `src/editor/export.tsx` (NEW) + `App.tsx` wiring | A "Download .md" button that runs `src/export/markdown.mjs` in-browser and triggers a client-side download (Blob + `a[download]`, zero dep). |
| `bin/planos export` out-of-blocking-path subcommand | `plugin/bin/planos` (`export` case, same provable `resolve(__dirname,'<lit>')` pattern) + `src/hook/export.mjs` (NEW, NON-blocking — reads stdin/arg doc, writes markdown to stdout, NO `startServer`, NO round-trip) | CLI markdown export for headless/scripted use. Out-of-blocking-path by construction (no server boot, no block); asserted absent from `ac17Roots()` blocking closure (Q3). |
| Print-to-PDF stylesheet (zero-dep) | `src/editor/print.css` (or an inlined `@media print` block in the SPA) + a "Print / Save as PDF" button in `src/editor/export.tsx` | Browser-native `window.print()` → user "Save as PDF". ZERO new runtime dep, ZERO blocking-path impact (Q4). |
| Bun single-binary build target (ONLY if Q5 = IN) | `package.json` script (`build:binary`) + `docs/notes/bun-binary.md` + a CI/release note | `bun build --compile` of `plugin/bin/planos` into a single binary as an *optional alternative* distribution; the Node script remains the default (design.md §8 "lower install friction"). Build/distribution only — NOT a runtime change (Q5). |
| Encrypted local share (ONLY if Q6 = IN — NOT recommended) | `src/share/encrypt.mjs` (NEW) + a SPA "Export encrypted bundle" affordance | Opt-in, LOCAL-only encrypted self-contained artifact (WebCrypto in the SPA, zero new dep). NO cloud, NO upload, NO hosted link — design.md §1 non-goal stays. Genuinely optional; recommended DEFERRED (Q6). |
| Marketplace-listing hardening | `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `README.md`, `plugin/README.md` (NEW if absent) | Description/keywords/homepage/license metadata, install instructions, screenshots reference — pure docs/metadata, zero code-path impact (Q-listing always IN). |
| Phase 4 ADR | `docs/adr/0004-phase4-polish-distribution.md` | Records Q1 (the scope cut — the headline), Q2 (theme scope), Q3 (markdown-export boundary), Q4 (PDF mechanism), Q5 (Bun in/out), Q6 (share in/out), Q7 (coexistence: keep-refuse vs build), and the AC-Q-WAIVER, once signed off. Formally closes the design.md §10 plannotator row. |
| `docs/notes/markdown-export-boundary.md` | NEW | Mirrors `docs/notes/planos-review-command.md`: documents that the markdown serializer + `bin/planos export` are out-of-blocking-path and AC-17-irrelevant by construction. |
| Phase 4 test suites | `tests/export-markdown.test.mjs`, `tests/theme.test.mjs`, extend `tests/editor-render.test.mjs` (theme + export-button non-visual), extend `tests/ac17-invariant.test.mjs` (export-module-absent-from-blocking-closure negative assertion), `tests/coexistence.test.mjs` (extend ONLY if Q7→build) | Serializer round-trip, theme token integrity, SPA non-visual, the AC-17 negative assertion |

---

## 3. Workstream Technical Approach (precise, per design.md §9 Phase 4 scope)

Phase 4 has **seven candidate workstreams**, several explicitly optional. §3 specifies each precisely; §10 (Q1) decides which are IN.

### 3.1 Themes (SPA-side only — design.md §9 "Themes")

The SPA today hard-codes every color as inline-style hex (`App.tsx` shell `#f1f5f9`, header `#0f172a`; `blocks.tsx` per-kind colors; `markdown.tsx` code-block `#0f172a`). A theme is a **named token palette** consumed by these styles.

- **NEW `src/editor/theme.ts`**: `export const THEMES = { light: {...tokens}, dark: {...tokens} }` where tokens are the small closed set the SPA actually uses (`bg`, `surface`, `border`, `text`, `textMuted`, `accentApprove`, `accentRevise`, `headerBg`, `codeBg`, `codeText`, …). A `ThemeContext` (React context, zero dep) + a header theme toggle; default = `light` (byte-identical-to-today when `light` reproduces the current exact hex values — a HARD requirement so the AC-P17/AC-R15 drift check stays meaningful: the default-light render must be visually unchanged, and the drift check re-baselines once on the committed rebuild).
- Threading: `App.tsx` and `blocks.tsx` replace literal hex with `theme.token` lookups. Mechanical, no behavior change. `markdown.tsx`/`mermaid.tsx` code/diagram backgrounds tokenized too.
- **AC-17: themes are SPA-side ONLY.** `src/editor/theme.ts` is NEVER imported by `src/hook/*` or `bin/planos`. The import-graph walk over the (unchanged) blocking roots stays VERDICT CLEAN with zero new roots (themes are not in the audited closure at all — they are SPA-only, exactly like the bundled mermaid renderer per ADR-0002 D3).
- Scope (Q2): minimum = `light`(default, byte-equivalent) + `dark`. Richer (system-preference auto, persisted user choice via `localStorage`, custom-palette) are scope expansions.

### 3.2 Markdown export (the canonical `Document → markdown` direction — design.md §1 thesis)

design.md §1 states the planos thesis: *"Markdown becomes an export format, not the source of truth."* **This serializer is the implementation of that sentence and does not exist yet** (confirmed: the only markdown-adjacent code is `src/schema/fallback.mjs` text→block and `src/editor/markdown.tsx` SPA prose rendering — neither serializes a Document to markdown).

- **NEW `src/export/markdown.mjs`** — a PURE `(doc: Document) → string` function. Deterministic, total over all 14 kinds: `section`→ATX heading at `level`; `prose`→`md` verbatim; `objective`→bold + criteria list; `task`→checkbox list item with status/deps/acceptance; `decision`→ADR-style block with chosen option; `risk`→table row or labelled block; `openQuestion`→`> Q:` / `> A:`; v2 `phase`/`tradeoff`/`fileChange`/`code`(fenced)/`table`(GFM table)/`diagram`(fenced ```mermaid```); v3 `diff`→fenced ```diff``` per hunk + comments as a list with verdict. **ZERO imports** (regex/string only, the `src/review/ingest.mjs` purity posture). No clock, no fs, no subprocess, no network.
- **Consumption A — SPA (NEW `src/editor/export.tsx`)**: a "Download .md" button calls `serialize(doc)` in-browser, `new Blob([md])` + `a[download]`. Zero dep, fully offline, no server interaction.
- **Consumption B — out-of-blocking-path CLI (Q3)**: `bin/planos export` (NEW `src/hook/export.mjs`) reads a document (stdin/arg, reusing `readStdin`/`extractPlan` from `roundtrip.mjs`), calls `serialize(doc)`, writes markdown to stdout, exits. **It does NOT call `startServer`, does NOT block, does NOT round-trip.** This is the gh/git pre-server doctrine (R1 Option A) applied to a *post*-server CLI surface: a legitimate non-blocking CLI tool, NOT in the blocking path.
- **AC-17 (Q3, analyzed exactly like Phase 3 R1):** `src/export/markdown.mjs` is pure; `src/hook/export.mjs` boots no server and never imports `src/hook/{exit,prd,review}.mjs`. Therefore the export modules are **NOT** added to `ac17Roots()` (they are not blocking roots), AND a NEW **negative** assertion (AC-Q12) proves `src/export/markdown.mjs` and `src/hook/export.mjs` are **absent from the blocking transitive closure** of `exit|prd|review` — i.e. no blocking handler can reach them. The blocking path stays byte-for-byte as in Phase 3. No new allowed-boundary carve-out. (Position-B-equivalent — putting markdown serialization *inside* a blocking handler's success path — is rejected for the same reason Phase 3 rejected blocking-path `gh`: it needlessly expands the audited surface for a feature that has zero reason to run while the user is blocked.)

### 3.3 PDF export (zero-dep mandatory — hard constraint)

A PDF library (`pdfkit`, `puppeteer`, headless Chrome) is a heavy runtime dep and is **forbidden** in the blocking path (and undesirable anywhere — install friction, 75 MB+). The hard constraint mandates browser print-to-PDF or build-time.

- **Recommended (Q4): browser-native `window.print()` + a print stylesheet.** A "Print / Save as PDF" button in `src/editor/export.tsx` calls `window.print()`; an `@media print` block (NEW `src/editor/print.css` or inlined) hides the decision bar / history browser / interactive chrome and lays the document out for paper. The user's browser/OS "Save as PDF" produces the PDF. **ZERO new dependency, ZERO blocking-path impact, fully offline.**
- Rejected: any Node PDF lib (runtime dep, violates zero-dep-in-blocking-path even if technically SPA-side it bloats the single-file artifact past headroom and adds install weight); build-time PDF (no use case — the artifact under review is dynamic).

### 3.4 Bun single-binary (genuinely optional — design.md §8 "Revisit Bun in Phase 4")

design.md §8 decided **Node for lower install friction** and explicitly says *"Revisit Bun in Phase 4 if a single binary is wanted."* This is a *distribution* question, not a runtime one.

- If Q5 = IN: add a `build:binary` script (`bun build --compile plugin/bin/planos --outfile dist/planos`) producing an *optional alternative* single binary; the committed Node `bin/planos` script + committed `plugin/dist/index.html` remain the **default** install path (zero-build, design.md §8). Document in `docs/notes/bun-binary.md`. The binary is build/release-only — it does NOT change the runtime blocking path, the AC-17 graph, or any handler.
- **Recommended: Q5 = OUT (defer).** Rationale (§10 Q5): design.md §8's Node decision was made *for install friction*; a single binary's only value is fewer install steps, but the plugin already installs zero-build via marketplace (the committed HTML + plain Node script — that was the whole §8 trade). Bun adds a second build toolchain + a per-platform binary matrix (darwin-arm64/x64, linux, win) + a release-artifact maintenance burden for marginal benefit. It is explicitly "optional" and nothing depends on it. Defer unless the user specifically wants a single-binary distribution.

### 3.5 Encrypted local share (genuinely optional, most scope-ambiguous — design.md §1/§9)

design.md §1 non-goal: *"Not a hosted service. No cloud, no upload, no share links in v1 (revisit in Phase 4)"* and *"optional encrypted local share (plannotator-style, opt-in)"*. **"Share" here is precisely scoped: an encrypted LOCAL file the user hands off out-of-band — NOT a cloud upload, NOT a hosted link.** The v1 "no hosted service / no cloud / no upload" non-goal **stays in force in Phase 4**; only the *local encrypted artifact* parenthetical is in scope.

- If Q6 = IN: NEW `src/share/encrypt.mjs` — a SPA-side WebCrypto (zero-dep, browser-native `crypto.subtle`) AES-GCM encryption of the canonical document JSON + a passphrase prompt, producing a downloadable encrypted blob (and a matching decrypt-on-load path guarded by passphrase). Entirely SPA-side; NO server, NO network, NO blocking-path contact. The recipient opens the same offline single-file SPA and supplies the passphrase.
- **Recommended: Q6 = OUT (defer/drop).** Rationale (§10 Q6): (1) it is explicitly "optional"; (2) it introduces a security-sensitive surface (key handling, passphrase UX, crypto correctness) whose review cost dwarfs its polish value in a final phase; (3) the planos thesis is *reviewable structured artifacts in PR/git* (ADR-0002 committed PRD history) — an encrypted opaque blob is the *opposite* of reviewable; (4) the user has shown a consistent preference for the smallest correct surface (R2 ephemeral, descoping coexistence). Defer to a future minor unless the user explicitly needs offline encrypted handoff.

### 3.6 Marketplace listing (always IN — design.md §9 "marketplace listing")

Pure metadata/docs hardening, zero code-path impact, lowest risk.

- `.claude-plugin/marketplace.json`: today `{ name, source }` only — add nothing CC doesn't read (keep minimal/valid); the listing richness lives in `plugin/.claude-plugin/plugin.json`.
- `plugin/.claude-plugin/plugin.json`: today `{ name, version, description, author }` — add `homepage`/`repository`/`license`/`keywords` per the Claude Code plugin manifest schema (verify against current docs at implementation time; do not invent fields).
- `README.md` + NEW `plugin/README.md`: install instructions (`claude --plugin-dir ./plugin` and marketplace install), the three entry modes, the AC-17 guarantee, offline/zero-dep posture, screenshots reference. Bump `version` to `1.0.0` (final phase — all design.md §3 modes ship) as a doc/metadata decision recorded in ADR-0004.
- No tests beyond JSON-validity (extend the existing packaging assertion if present) — this is `[D]`/`[M]`.

### 3.7 Plannotator full coexistence resolution (the DEFERRED §10 item — Q7, first-class Open Decision)

design.md §10 row: *"Coexistence with plannotator installed (hook matcher collision on `ExitPlanMode`) — Open — investigate in Phase 1."* Phase 1 investigated and **descoped to detect-and-refuse** per explicit user decision (`docs/notes/plannotator-coexistence-spike.md`; project memory: *"don't care about plannotator coexistence; refuse-on-collision is fine"*). design.md §9 lists "the DEFERRED full coexistence resolution" as Phase-4 scope.

**Feasibility/desirability analysis (the brief requires this be first-class):**

The coexistence spike established the hard CC dispatch facts: all matching `ExitPlanMode` PermissionRequest hooks fire **in parallel** (no first-wins, no priority, no namespacing), reconciliation is a **deny-wins conjunction**, and `PermissionRequest` does **not** fire under `claude -p` (so the collision is impossible to even observe headlessly). "Full coexistence resolution" (graceful co-operation: two plugins both wanting to own a blocking 96h `ExitPlanMode` round-trip cooperating instead of double-booting) would require **cross-plugin coordination Claude Code provides no primitive for** — no leader election, no shared lock channel, no ordering. The only mechanisms available are the ones already used (local-fs sibling detection) plus speculative, fragile inter-process coordination (a lockfile race between two independently-spawned hook processes with no defined ordering — itself a new correctness/security surface). **Graceful coexistence is not merely Phase-4-sized; it is arguably infeasible-without-a-CC-primitive, and the user has explicitly stated they do not want it.**

- **Recommended (Q7): keep detect-and-refuse; formally CLOSE the design.md §10 row as "Resolved — refuse-on-collision is the accepted, documented posture; full coexistence is infeasible without a Claude Code cross-plugin coordination primitive and is explicitly out of scope."** Concretely: ADR-0004 records the closure + the infeasibility analysis; `docs/notes/plannotator-coexistence-spike.md` status line updated from "RESOLVED for Phase 1" to "RESOLVED — final (Phase 4): refuse-on-collision is the permanent posture"; design.md §10 row updated; NO code change to `src/hook/coexistence.mjs` or `tests/coexistence.test.mjs`. This is the smallest correct surface, matches the user's stated preference, and converts a lingering "Open" into a principled closed decision — the genuine Phase-4 deliverable for this item.
- Alternative (Q7 = build): implement a best-effort cooperative posture (e.g. a documented `PLANOS_COEXIST_PRIORITY` ordering + a local advisory lock so only one server boots) — high complexity, fragile (no CC ordering guarantee), security-adjacent (lockfile in a shared dir), and explicitly unwanted by the user. NOT recommended.

---

## 4. The AC-17 Boundary Analysis for Phase 4 (the crux, mirroring Phase 3 §4)

Phase 3's headline was *where `gh`/`git` run*. Phase 4 has no subprocess like `gh`, but it has an analogous boundary question for **markdown/PDF export and encrypted share**: do any of these touch a subprocess/network, and if so do they run inside or outside the blocking round-trip?

The Phase 1 invariant is **"no model call / network egress / agent spawn inside the blocking server-round-trip path"** (`bin/planos exit|prd|review` → `src/hook/{exit,prd,review}.mjs` → `src/server/` → `src/schema/` → `src/diff/` [→ `src/prd/store.mjs` | `src/review/ingest.mjs`]). ADR-0002 established `node:fs` (store) and `node:child_process` (browser-opener) as the only documented allowed boundaries; ADR-0003 added `src/review/ingest.mjs` as a pure leaf and explicitly rejected blocking-path `gh`.

**Phase 4, workstream by workstream:**

- **Themes**: SPA-side ONLY. NEVER imported by any `bin/planos *` path. Not in the audited closure at all (like the bundled mermaid renderer, ADR-0002 D3). Zero AC-17 surface.
- **Markdown serializer (`src/export/markdown.mjs`)**: PURE (zero imports, zero subprocess/network/clock/fs) by construction — the `src/review/ingest.mjs` purity posture. It is consumed (a) SPA-side and (b) by the **out-of-blocking-path** `bin/planos export`. It is **never imported by a blocking handler**. The crux assertion (AC-Q12) is a **negative**: prove `src/export/markdown.mjs` + `src/hook/export.mjs` are **absent from the transitive import closure of `exit|prd|review`** — i.e. the export feature cannot run during a blocking round-trip. This is *stronger* than adding them as audited roots: it proves the blocking path is unchanged AND cannot reach export.
- **`bin/planos export` (`src/hook/export.mjs`)**: NON-blocking by construction — it must NOT import `startServer` / `src/server/`, MUST NOT call any decision round-trip, MUST NOT block. It reads a doc, serializes, writes stdout, exits. It is a sibling CLI surface like the pre-server gh/git agent tool use (R1 Option A) — legitimate, outside the blocking path. It is NOT added to `ac17Roots()` (it is not a blocking root); its purity (no network/spawn) is asserted independently but it is explicitly *excluded* from the blocking audited set by AC-Q12.
- **PDF (`window.print()`)**: SPA-side browser API, zero dep, zero Node-side surface. Zero AC-17 impact.
- **Encrypted share (if Q6=IN)**: SPA-side WebCrypto (`crypto.subtle`), zero Node-side surface, NO network (local file only — the design.md §1 "no upload" non-goal is enforced by construction: there is no fetch/upload code path). Zero blocking-path AC-17 impact. If Q6=OUT, zero surface.
- **Bun binary (if Q5=IN)**: build/release artifact only; the runtime entrypoint and its import graph are byte-identical. Zero AC-17 runtime impact.
- **Coexistence (Q7=keep-refuse, recommended)**: `src/hook/coexistence.mjs` unchanged — already pure local-fs, already in the audited closure CLEAN (ADR/spike). Zero new surface.

**Conclusion:** Phase 4 adds **zero new blocking-path surface and zero new allowed-boundary carve-out**. The `ac17Roots()` set is **unchanged**. The new AC-17 work is a single **negative assertion** (AC-Q12) that the export modules are unreachable from the blocking closure — RE-ASSERTING the invariant by proving the polish surfaces are strictly outside it, exactly mirroring how Phase 3 proved `gh`/`git` absent from the blocking transitive set.

---

## 5. Acceptance Criteria ([H] harness / [M] manual / [D] doc)

Mirrors Phase 1/2/3 rigor and tag discipline. Harness-asserted where mechanizable; doc artifacts for decisions; scripted manual smoke for browser/visual surfaces. AC count adapts to the Q1 scope cut — criteria for a DEFERRED workstream are marked conditional.

### Themes
- **AC-Q1** `[H]` `src/editor/theme.ts` exports a closed token set; `THEMES.light` reproduces the EXACT pre-Phase-4 hex values for every token the SPA uses (asserted by a token-snapshot test) so default render is unchanged (new `tests/theme.test.mjs`).
- **AC-Q2** `[H]` `App.tsx`/`blocks.tsx`/`markdown.tsx` contain NO remaining hard-coded color hex literals for tokenized surfaces (grep-style assertion in `tests/theme.test.mjs`); all route through `theme.*`. Theme switch toggles every tokenized surface (non-visual: assert the rendered tree's style props change with theme; extends `tests/editor-render.test.mjs`).
- **AC-Q3** `[M]` SPA renders correctly under `light` (default, visually identical to Phase 3) and `dark`; theme toggle works; `BlockShell`/comment/decision affordances unaffected. Manual demo (scope per Q2).

### Markdown export
- **AC-Q4** `[H]` `src/export/markdown.mjs` serializes a document containing ALL 14 v1∪v2∪v3 kinds to deterministic, byte-stable markdown (round-trip stability: same input → byte-identical output ×2); every kind has a defined rendering; empty/degraded docs serialize without throwing (`tests/export-markdown.test.mjs`, fixture per kind).
- **AC-Q5** `[H]` `src/export/markdown.mjs` is PURE: zero imports, zero `node:child_process`/`node:fs`/`node:net`/clock (static-purity scan in `tests/export-markdown.test.mjs`, mirroring the `src/review/ingest.mjs` purity test).
- **AC-Q6** `[H]` `bin/planos export` reads a doc (stdin/arg via reused `readStdin`/`extractPlan`), writes serialized markdown to stdout, exits 0, boots NO server, blocks NOT (asserted: no `startServer` import in `src/hook/export.mjs`; round-trip child-process test asserts immediate exit with markdown on stdout) — conditional on Q3=IN.
- **AC-Q7** `[M]` SPA "Download .md" button produces the serialized markdown as a client-side download, fully offline, zero network (non-visual assertion of the click→Blob path in `tests/editor-render.test.mjs`).

### PDF export
- **AC-Q8** `[M]` SPA "Print / Save as PDF" invokes `window.print()`; the `@media print` stylesheet hides interactive chrome (decision bar, history browser) and lays out the document for paper; zero new dependency present in `package.json`/the bundle (asserted: no PDF lib in deps; `tests/theme.test.mjs` or a deps assertion checks no new runtime dep) — conditional on Q4=print.

### Marketplace listing
- **AC-Q9** `[H]` `.claude-plugin/marketplace.json` + `plugin/.claude-plugin/plugin.json` remain schema-valid JSON; plugin.json carries the agreed metadata fields (extends/adds a packaging-validity test); `bin/planos` still dispatches `enter|exit|prd|review` (+`export` if Q3=IN) — no regression.
- **AC-Q10** `[D]` `README.md` + `plugin/README.md` document install (both paths), the three entry modes, the AC-17/offline/zero-dep guarantees; `version` bumped per the ADR-0004 decision.

### Bun / Share (conditional)
- **AC-Q11a** `[H]`/`[D]` (ONLY if Q5=IN) `npm run build:binary` (or documented `bun` invocation) produces a single binary; the Node default path is unchanged; `docs/notes/bun-binary.md` records the optional-alternative status. (If Q5=OUT: a `[D]` line in ADR-0004 records the deferral rationale — no code.)
- **AC-Q11b** `[H]`/`[D]` (ONLY if Q6=IN) `src/share/encrypt.mjs` round-trips encrypt→decrypt of a canonical doc via WebCrypto, zero network, local-file only (asserted: no fetch/upload code path). (If Q6=OUT: a `[D]` line in ADR-0004 records the deferral — no code.)

### Invariant + verification
- **AC-Q12** `[H]` AC-17 RE-ASSERTED by **negative proof**: `tests/ac17-invariant.test.mjs` extended (LAYER 1b static) so `src/export/markdown.mjs` + `src/hook/export.mjs` (+ `src/editor/theme.ts`, `src/share/encrypt.mjs` if IN — but SPA modules are inherently SPA-only) are asserted **ABSENT from the transitive import closure of `bin/planos exit|prd|review`**; `ac17Roots()` is UNCHANGED (no new blocking root); `node tests/harness/import-graph.mjs` stays VERDICT CLEAN. The blocking path is byte-for-byte as in Phase 3.
- **AC-Q13** `[H]` Phase-1 + Phase-2 + Phase-3 NOT regressed: `tests/harness/verify-exit-gate.mjs` exit 0 (FROZEN_BARS / `metrics.mjs` untouched), all `exit-*.test.mjs`, `tests/harness/prd-smoke.mjs`, `tests/harness/review-smoke.mjs` green between EVERY milestone; `ac17-invariant.test.mjs` LAYER 2/2b/2c intact.
- **AC-Q14** `[H]` Committed-artifact drift check (AC-P17/AC-R15 pattern): rebuild `plugin/dist/index.html`, assert byte-identical-after-commit once themes + export button + print css land; size stays under the 4 MB cap (currently 3,414,771 B; Phase-4 SPA additions are CSS tokens + a small pure serializer + a print stylesheet — no new runtime dep — expected to stay well under the ≈0.74 MB headroom; the exact post-build size is recorded in ADR-0004).
- **AC-Q15** `[D]` `docs/adr/0004-phase4-polish-distribution.md` records Q1 (scope cut — headline), Q2–Q7, the AC-Q-WAIVER, the final `version`, and **formally closes the design.md §10 plannotator coexistence row** (mirrors ADR-0003 structure). `docs/notes/markdown-export-boundary.md` documents the out-of-blocking-path export boundary (mirrors `planos-review-command.md`).
- **AC-Q-WAIVER** `[D]` No-Phase-4-ID-re-measurement reasoned waiver recorded in ADR-0004 (mirrors AC-P18 / AC-R-WAIVER): Phase 4 introduces **ZERO new ID-minting surface** — themes/export/PDF/share/listing/coexistence-closure all *read* existing validated documents and never mint or preserve an ID; `opaque` is the proven 1.000 production default (ADR-0001); the round-trip + agent authoring are reused byte-for-byte and untouched. Re-running the Milestone-1 ID gate would re-measure an already-falsified-clear risk against code paths Phase 4 does not touch. Documented reasoned waiver, NOT an omission.

> Target: ≥80% concrete/testable, mirroring Phase 1/2/3's ratio. With the recommended Q1 cut (themes + markdown export + PDF-via-print + marketplace listing + coexistence-closure IN; Bun + encrypted share DEFERRED): ~13 active criteria, ~9 `[H]`, ~3 `[D]` (+1 `[D]` waiver), ~4 `[M]`.

### Verification strategy (consistent with Phase 1/2/3 §6)
1. Per-milestone verify gate; the markdown serializer (the design.md §1 thesis implementation) + theme token layer are the first HARD GATE only insofar as the SPA rebuild/drift depends on them — but no downstream *engine* depends on Phase 4 (it is leaf polish), so the gate is regression-protection, not dependency-ordering, heavy.
2. Acceptance traceability: every AC → `[H]` assertion, `[D]` artifact, or scripted `[M]` smoke.
3. AC-17 re-assertion is a distinct verification pass (separate lane — not self-approved by the authoring context).
4. Offline verification: markdown export (SPA + CLI) and PDF print produce output with network disabled; assert zero egress; assert `bin/planos export` boots no server.
5. Live-session smoke: install via `claude --plugin-dir ./plugin`, exercise theme toggle + markdown download + print-to-PDF in a real round-trip SPA; confirm the three entry modes still work and marketplace metadata loads. `[M]` manual (the SPA/interactive surfaces do not fire under `claude -p`, exactly as Phase 1/2/3 documented their live smokes).
6. **No ID re-measurement** (AC-Q-WAIVER) — explicitly NOT re-running the Milestone-1 gate.
7. Phase-1 FROZEN exit gate + Phase-2 `prd-smoke` + Phase-3 `review-smoke` re-run green between EVERY milestone (no regression to any prior phase).

---

## 6. Milestones (strict dependency order, file-level work units)

One commit per milestone. Between every milestone the verify gate runs: full suite (`node --test tests/*.test.mjs tests/harness/*.test.mjs`) + `npx tsc --noEmit` exit 0 + `node tests/harness/import-graph.mjs` VERDICT CLEAN + `node tests/harness/verify-exit-gate.mjs` exit 0 (Phase-1) + `node tests/harness/prd-smoke.mjs` exit 0 (Phase-2) + `node tests/harness/review-smoke.mjs` exit 0 (Phase-3) + AC-17 CLEAN. Milestone Q-scope assumes the **recommended Q1 cut**; DEFERRED workstreams' milestones are struck (recorded in ADR-0004), exactly as Phase 3 struck the R2-driven store work units.

### Milestone Q0 — Document→markdown serializer (HARD GATE — the design.md §1 thesis; pure leaf, everything export-side depends on it)
- **Q0.1** Create `src/export/markdown.mjs`: PURE `(doc) → string`, total over all 14 kinds, ZERO imports, deterministic/byte-stable, degraded-doc-safe (the `src/review/ingest.mjs` purity posture). Top-of-file AC-17 out-of-blocking-path purity contract comment.
- **Q0.2** Tests: `tests/export-markdown.test.mjs` — per-kind fixtures, all-14-kinds doc, determinism (×2 byte-identical), degraded/empty, static-purity scan (zero imports, comment-stripped).
- Gate: AC-Q4, AC-Q5.

### Milestone Q1 — `bin/planos export` out-of-blocking-path CLI (conditional Q3=IN)
- **Q1.1** Create `src/hook/export.mjs`: reads doc (reuse `readStdin`/`extractPlan` from `roundtrip.mjs`), calls `src/export/markdown.mjs`, writes stdout, exits. NO `startServer`, NO `src/server/` import, NO round-trip, NO block.
- **Q1.2** Add `export` case to `plugin/bin/planos` switch (same provable `resolve(__dirname,'<lit>')` pattern as `prd`/`review`); update usage string to `enter, exit, prd, review, export`.
- **Q1.3** Tests: `tests/export-cli.test.mjs` — child-process: pipe a doc, assert markdown on stdout + immediate exit 0 + no server bind (no port opened).
- Gate: AC-Q6.

### Milestone Q2 — Theme token layer (SPA-side only)
- **Q2.1** Create `src/editor/theme.ts`: closed token set + `THEMES.light` (byte-equivalent to current hex) + `THEMES.dark` + `ThemeContext` + header toggle (scope per Q2).
- **Q2.2** Thread tokens through `src/editor/App.tsx`, `src/editor/blocks.tsx`, `src/editor/markdown.tsx`, `src/editor/mermaid.tsx` — replace literal hex with `theme.*`. Mechanical, zero behavior change; `light` default visually unchanged.
- **Q2.3** Tests: `tests/theme.test.mjs` (light=current-hex token snapshot; no-remaining-hex assertion); extend `tests/editor-render.test.mjs` (theme toggle non-visual).
- Gate: AC-Q1, AC-Q2.

### Milestone Q3 — SPA export affordances (markdown download + print-to-PDF) + rebuild/drift
- **Q3.1** Create `src/editor/export.tsx`: "Download .md" (Blob + `a[download]`, calls `src/export/markdown.mjs`) + "Print / Save as PDF" (`window.print()`); wire into `App.tsx`.
- **Q3.2** Add `@media print` stylesheet (`src/editor/print.css` or inlined) hiding decision bar / history / interactive chrome.
- **Q3.3** Rebuild + commit `plugin/dist/index.html`; assert byte-identical-after-commit + under 4 MB cap; record post-build size in the milestone log + ADR-0004.
- **Q3.4** Tests: extend `tests/editor-render.test.mjs` (export buttons present, click→Blob path non-visual, print-button invokes print); drift check; no-new-runtime-dep assertion.
- Gate: AC-Q7, AC-Q8, AC-Q14.

### Milestone Q4 — Marketplace-listing hardening
- **Q4.1** Update `plugin/.claude-plugin/plugin.json` (metadata fields verified against current CC plugin-manifest docs); keep `.claude-plugin/marketplace.json` minimal/valid; bump `version` per ADR-0004.
- **Q4.2** Write/expand `README.md` + NEW `plugin/README.md` (install both paths, 3 entry modes, AC-17/offline/zero-dep guarantees, screenshot refs).
- **Q4.3** Tests: extend the packaging-validity assertion (JSON valid, dispatch intact incl. `export` if Q3=IN).
- Gate: AC-Q9, AC-Q10.

### Milestone Q5 — AC-17 negative re-assertion + Phase 4 exit gate + ADR-0004 + §10 closure
- **Q5.1** Extend `tests/ac17-invariant.test.mjs` LAYER 1b: assert `src/export/markdown.mjs` + `src/hook/export.mjs` **ABSENT** from the `exit|prd|review` blocking transitive closure; `ac17Roots()` UNCHANGED; import-graph VERDICT CLEAN.
- **Q5.2** Create `docs/notes/markdown-export-boundary.md` (out-of-blocking-path boundary, mirrors `planos-review-command.md`).
- **Q5.3** Full Phase 4 harness + offline verify gate (the 7-check gate, all green). Live-session smoke `[M]` documented (does not fire under `claude -p`, per Phase 1/2/3).
- **Q5.4** Write `docs/adr/0004-phase4-polish-distribution.md`: Q1–Q7 resolutions + AC-Q-WAIVER + final `version`; **formally close the design.md §10 plannotator row**; update `docs/notes/plannotator-coexistence-spike.md` status to "RESOLVED — final (Phase 4): refuse-on-collision permanent"; update design.md §10 row. (Q7=keep-refuse: NO change to `src/hook/coexistence.mjs`/`tests/coexistence.test.mjs`.)
- Gate: AC-Q12, AC-Q13, AC-Q15, AC-Q-WAIVER; all active AC green; Phases 1+2+3 NOT regressed.

> Milestones for DEFERRED workstreams (Bun Q5-scope / encrypted share Q6-scope) are struck and recorded in ADR-0004 as deferred-with-rationale, exactly as Phase 3 struck the R2-driven store work units. If Q5/Q6 → IN, an additional milestone is inserted before Q5 (Bun: a `build:binary` + `docs/notes/bun-binary.md` unit; Share: `src/share/encrypt.mjs` + WebCrypto round-trip test + SPA affordance).

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Markdown/PDF/share export accidentally placed inside the blocking path → AC-17 weakened** | M | **H** | **The headline AC-17 risk (Phase-3-R1 analogue).** `src/export/markdown.mjs` is PURE zero-import; `src/hook/export.mjs` boots NO server / imports NO `src/server/`; AC-Q12 is a NEGATIVE assertion proving the export modules are ABSENT from the blocking closure. `ac17Roots()` UNCHANGED. PDF = `window.print()` (zero Node surface). Share (if IN) = SPA WebCrypto, no network. First-class Open Decision (Q3/Q4) requiring sign-off before Q0/Q1 implement. |
| Themes drift the committed `plugin/dist/index.html` / break the byte-identical drift check | M | M | `THEMES.light` MUST reproduce the exact current hex (AC-Q1 token-snapshot); drift check re-baselines ONCE on the deliberate committed rebuild (AC-Q14), exactly the AC-P17/AC-R15 pattern; default render visually unchanged. |
| Phase-4 SPA additions exceed the 4 MB cap / ≈0.74 MB headroom | L | M | Themes = CSS tokens (negligible); markdown serializer = small pure JS; PDF = `window.print()` zero-dep; NO new heavy runtime dep enters the SPA (the mermaid bundle from ADR-0002 D3 is the only heavy SPA dep and is unchanged). Post-build size asserted < cap (AC-Q14) and recorded in ADR-0004. |
| PDF pulls a heavy runtime dep (pdfkit/puppeteer) breaking zero-dep | L (if Q4=print) | H | Q4 recommended = browser-native `window.print()`, ZERO dependency; any Node PDF lib explicitly rejected (§3.3). First-class Open Decision. |
| Encrypted share is a security-sensitive surface reviewed under final-phase time pressure | M (if Q6=IN) | H | Q6 recommended = DEFER/DROP (§3.5): explicitly "optional", opposite of the reviewable-artifact thesis, security review cost dwarfs polish value. If Q6=IN it gets its own milestone + a dedicated security-review pass (separate lane), never bundled into a polish commit. |
| Building infeasible plannotator coexistence wastes the final phase | M (if Q7=build) | M | Q7 recommended = keep-refuse + formally close §10 (§3.7): graceful coexistence needs a CC cross-plugin coordination primitive that does not exist; the user explicitly does not want it; the Phase-4 deliverable for this item is the principled *closure*, not code. First-class Open Decision. |
| Bun adds a second build toolchain + per-platform binary matrix for marginal gain | M (if Q5=IN) | M | Q5 recommended = DEFER (§3.4): design.md §8's Node decision already optimized install friction; the plugin installs zero-build today. If Q5=IN it is build/release-only, never a runtime change; the Node default stays the committed primary path. |
| Theme threading regresses a renderer (mechanical hex→token slip) | M | M | `light` token values are the verbatim current hex (AC-Q1); `tests/editor-render.test.mjs` is the regression guard; threading is mechanical with zero behavior change; authoring vs verification kept as separate passes. |
| Marketplace metadata invents non-existent plugin-manifest fields | L | L | Verify field names against current Claude Code plugin-manifest docs at implementation time (do not invent); keep `marketplace.json` minimal; AC-Q9 asserts JSON validity + dispatch intact. |
| Scope creep — building all 7 optional workstreams in the final phase | M | M | Q1 (the headline Open Decision) forces an explicit IN/OUT cut with a recommended minimal set BEFORE any milestone; DEFERRED items get a recorded rationale in ADR-0004, not silent omission (Phase-3 R2-strike precedent). |
| Re-measuring ID stability for Phase 4 wastefully | L | M | AC-Q-WAIVER (mirrors AC-P18/AC-R-WAIVER): Phase 4 introduces ZERO new ID-minting surface (all workstreams READ existing validated docs); `opaque` proven 1.000; round-trip untouched. Reasoned waiver, not omission. |
| Regressing a prior phase via the SPA rebuild or a shared edit | L | H | Phase 4 touches NO blocking handler, NO schema, NO `bin/planos` dispatch behavior (only adds an `export` case), NO FROZEN_BARS; `verify-exit-gate` + `prd-smoke` + `review-smoke` + full suite are the regression guard, green between every milestone. |

---

## 8. Non-Goals (Phase 4)

No new entry mode (all three design.md §3 modes ship — Phase 1/2/3 COMPLETE); no new block kind or doc type (schema FROZEN at v1∪v2∪v3); no change to any blocking handler (`exit`/`prd`/`review`) or `plugin/hooks/hooks.json`; **no model / network egress / agent spawn in any blocking path** (AC-Q12 negative re-assertion); no markdown/PDF/share serialization *inside* the blocking round-trip (out-of-blocking-path only — the Phase-3-R1 doctrine applied to a post-server surface); **no hosted service / cloud / upload / share links** (design.md §1 v1 non-goal STAYS — "encrypted local share" is LOCAL opt-in file only, NOT a cloud/hosted link, and is recommended DEFERRED anyway); no Node PDF library (zero-dep; `window.print()` only); no graceful plannotator coexistence (recommended: keep detect-and-refuse + formally close §10 — full coexistence is infeasible without a CC cross-plugin primitive and explicitly unwanted by the user); no Bun runtime migration (Node stays the runtime; Bun, if IN, is an optional *build* artifact only — recommended DEFERRED); no multi-user/real-time collab; no GitHub write-back; **no re-running the Milestone-1 ID gate** (AC-Q-WAIVER); no new frozen numeric bar (the D6 lighter-but-rigorous gate precedent carries forward); no schema validator change (ADR-0000 "revisit only if schema grows materially" NOT triggered — Phase 4 grows no schema).

---

## 9. Open Decisions for the User (require sign-off before execution)

**Q1 — THE HEADLINE DECISION: which Phase-4 workstreams are IN scope vs deferred/dropped?** design.md §9 lists seven Phase-4 items, several explicitly "optional", and the user already descoped plannotator coexistence.
- **Option A (RECOMMENDED): IN = Themes + Markdown export (SPA + out-of-blocking-path CLI) + PDF-via-`window.print()` + Marketplace listing + formally CLOSE the plannotator §10 row as "refuse-on-collision permanent". DEFER/DROP = Bun single-binary + Encrypted local share + building graceful coexistence.** Rationale: the IN set is exactly the *additive, zero-new-dep, zero-blocking-path polish* that completes the design.md §1 "markdown is an export format" thesis and ships a clean marketplace-listed v1.0.0; the DEFERRED set is every item design.md marks "optional" or the user explicitly descoped, each carrying disproportionate cost (Bun = second toolchain + binary matrix; encrypted share = security surface antithetical to the reviewable-artifact thesis; graceful coexistence = infeasible without a CC primitive the user does not want). This is the smallest correct final-phase surface, consistent with the user's demonstrated minimal-surface preference (R2 ephemeral, coexistence descope).
- Option B: also include Bun single-binary (adds a distribution toolchain).
- Option C: also include encrypted local share (adds a security-sensitive surface).
- Option D: also build graceful plannotator coexistence (NOT recommended — infeasible without a CC cross-plugin primitive; explicitly unwanted).
- **Recommended: Option A.** Blocks the entire milestone set (which workstreams get milestones at all). The single most important Phase-4 decision — treat as first-class.

**Q2 — Theme scope.** Minimum = `light` (default, byte-equivalent to today) + `dark` + a header toggle. Richer options (OS `prefers-color-scheme` auto-detect; `localStorage`-persisted user choice; custom user palette) are real scope expansions. Which ships? **Recommended: minimum (`light`+`dark`+toggle), plus `prefers-color-scheme` auto-default only if zero-extra-risk** — it is a one-line media query, high polish value, no dependency. Affects Milestone Q2 size.

**Q3 — Markdown-export boundary & surfaces.** Where does serialization run, and which surfaces? **Recommended: PURE `src/export/markdown.mjs` consumed (a) SPA-side download AND (b) an out-of-blocking-path `bin/planos export` CLI; the serializer is NEVER imported by a blocking handler; AC-Q12 proves it absent from the `exit|prd|review` closure (the Phase-3-R1 doctrine applied to a post-server CLI surface).** Sub-decision: is the CLI surface (`bin/planos export`) IN, or SPA-download-only? Recommended: include the CLI (cheap, headless-useful, fully precedented by the provable-literal dispatch pattern) but it is genuinely optional. Blocks Milestone Q0/Q1 and AC-Q6/AC-Q12.

**Q4 — PDF export mechanism.** Options: (a) browser-native `window.print()` + print stylesheet (zero dep, RECOMMENDED); (b) a Node/SPA PDF library (heavy runtime dep — REJECTED by the hard constraint); (c) drop PDF, ship markdown export only (user converts md→pdf with their own tooling). **Recommended: (a) `window.print()`.** Blocks Milestone Q3 + AC-Q8. If the user finds print-to-PDF insufficient, (c) is the only acceptable fallback (no heavy dep).

**Q5 — Bun single-binary: IN or DEFER?** design.md §8 explicitly defers this to "Phase 4 if a single binary is wanted". **Recommended: DEFER (OUT).** Rationale: the Node decision was made *for* install friction and the plugin already installs zero-build via marketplace (the §8 trade); Bun adds a second build toolchain + a per-platform binary release matrix for marginal benefit; nothing depends on it; it is explicitly "optional". If IN, it is build/release-only (no runtime change) and gets its own milestone + `docs/notes/bun-binary.md`. Blocks whether a Bun milestone exists.

**Q6 — Encrypted local share: IN or DEFER/DROP?** design.md §1 scopes this as plannotator-style **LOCAL, opt-in, NO cloud/upload** (the v1 "no hosted service / no upload" non-goal STAYS). **Recommended: DEFER/DROP (OUT).** Rationale: explicitly "optional"; a security-sensitive surface (crypto correctness, key/passphrase UX) whose review cost dwarfs its polish value in a final phase; an encrypted opaque blob is the *opposite* of the planos reviewable-structured-artifact thesis; consistent with the user's minimal-surface preference. If IN, it is SPA-side WebCrypto (zero dep, no network) with its own milestone + a dedicated security-review pass (separate lane). Blocks whether a Share milestone exists.

**Q7 — Plannotator full coexistence resolution: build graceful coexistence, or formally close §10 as "refuse-on-collision permanent"?** (First-class per the brief; the user previously descoped caring about plannotator coexistence — project memory.) **Recommended: KEEP detect-and-refuse + formally CLOSE the design.md §10 row.** Rationale (§3.7): graceful coexistence requires a Claude Code cross-plugin coordination primitive that does not exist (all `ExitPlanMode` hooks fire in parallel, deny-wins, no ordering/namespacing — per the spike); a lockfile race between independently-spawned hook processes is a new fragile correctness/security surface; the user explicitly does not want this; the genuine Phase-4 deliverable is converting the lingering design.md §10 "Open" into a *principled, documented closed decision* (ADR-0004 + spike status + §10 row update), NOT code. NO change to `src/hook/coexistence.mjs`/`tests/coexistence.test.mjs`. The alternative (build a `PLANOS_COEXIST_PRIORITY` + advisory lock) is high-complexity, fragile, security-adjacent, and unwanted. Blocks whether `src/hook/coexistence.mjs` is touched and the §10/spike/ADR closure wording.

**Q8 — Final `version` + gating rigor.** (Confirmatory, mirrors D6/Phase-3 R-confirmations.) Phase 4 is the FINAL phase (all design.md §3 modes ship). Recommended: bump `plugin/.claude-plugin/plugin.json` + `package.json` to **`1.0.0`**; the Phase-4 exit gate is the §5 active-AC set + full offline suite green + `tsc` clean + AC-17 import-graph CLEAN (UNCHANGED `ac17Roots()`, plus the AC-Q12 negative assertion) + Phase-1 FROZEN gate + Phase-2 `prd-smoke` + Phase-3 `review-smoke` all green, with **NO new frozen numeric bar and NO ID re-measurement** (AC-Q-WAIVER) — the D6 lighter-but-rigorous precedent carried forward. Sign-off requested that `1.0.0` and this gate are acceptable, or specify otherwise.

---

## Resolved Decisions (user sign-off 2026-05-16)

- **Q1 → Option A (recommended minimal set).** IN: Themes + Markdown export
  (SPA download + out-of-blocking-path `bin/planos export` CLI) + PDF via
  `window.print()` + Marketplace listing + formally CLOSE the design.md §10
  plannotator row (refuse-on-collision permanent). **DEFER/DROP** (recorded
  in ADR-0004 with rationale, NOT silent omission — Phase-3 R2-strike
  precedent): Bun single-binary (Q5), Encrypted local share (Q6), building
  graceful plannotator coexistence (Q7). Smallest correct final-phase
  surface: zero new dep, zero blocking-path change, completes the design.md
  §1 "markdown is an export format" thesis, ships v1.0.0.
- **Q2 → light + dark + header toggle + `prefers-color-scheme` auto-default.**
  `THEMES.light` byte-equivalent to today (drift-check meaningful); the OS
  auto-default is a one-line media query (zero dep). NO `localStorage`
  persistence (deferred — not in scope).
- **Q3 → PURE `src/export/markdown.mjs` consumed BOTH SPA-side (download) AND
  via the out-of-blocking-path `bin/planos export` CLI.** Serializer is
  NEVER imported by a blocking handler; AC-Q12 proves it absent from the
  `exit|prd|review` closure (Phase-3-R1 doctrine, post-server surface).
- **Q4 → browser-native `window.print()` + `@media print` stylesheet.** ZERO
  new dependency; SPA-side; zero blocking-path impact. No Node PDF lib.
- **Q5 → DEFER (Bun OUT).** Build/distribution-only marginal benefit; Node
  installs zero-build today (design.md §8 trade). Recorded in ADR-0004.
- **Q6 → DEFER/DROP (encrypted local share OUT).** Explicitly "optional";
  security surface antithetical to the reviewable-artifact thesis. Recorded
  in ADR-0004. (design.md §1 "no cloud/upload/hosted" non-goal STAYS.)
- **Q7 → KEEP detect-and-refuse + formally CLOSE design.md §10.** Graceful
  coexistence is infeasible without a Claude Code cross-plugin coordination
  primitive that does not exist; user explicitly does not want it. ADR-0004
  records the closure + infeasibility analysis; `docs/notes/plannotator-
  coexistence-spike.md` status → "RESOLVED — final (Phase 4)"; design.md §10
  row updated. NO change to `src/hook/coexistence.mjs`/`tests/coexistence.test.mjs`.
- **Q8 → version `1.0.0` + the D6 lighter-but-rigorous gate.** Final phase
  (all 3 design.md §3 modes ship) → bump `plugin/.claude-plugin/plugin.json`
  + `package.json` to `1.0.0`. Exit gate = §5 active-AC set + full offline
  suite + `tsc` clean + AC-17 import-graph CLEAN (UNCHANGED `ac17Roots()` +
  the AC-Q12 negative assertion) + Phase-1 FROZEN gate + Phase-2 `prd-smoke`
  + Phase-3 `review-smoke`. NO new frozen numeric bar, NO ID re-measurement
  (AC-Q-WAIVER).

Execution proceeds in strict milestone order Q0→Q5 (the pure markdown
serializer Q0 is the first HARD GATE; DEFERRED-workstream milestones — Bun /
encrypted share — struck per the Q1 cut, recorded in ADR-0004 exactly as
Phase 3 struck the R2-driven store work units), one commit per milestone,
verify gate (full suite + tsc + AC-17 import-graph CLEAN + Phase-1 exit gate
+ Phase-2 prd-smoke + Phase-3 review-smoke) between every milestone, keeping
the single-file offline build invariant and the AC-17 invariant RE-ASSERTED-
not-weakened (by the AC-Q12 negative proof that the polish surfaces are
strictly outside the blocking closure).

---

This plan's Open Decisions (Q1–Q8) require sign-off before execution. Q1 (the scope cut) is the headline and gates the entire milestone set. Execution proceeds in strict milestone order Q0→Q5, one commit per milestone, verify gate between every milestone, keeping the single-file offline build invariant and the AC-17 invariant RE-ASSERTED-not-weakened for every prior entrypoint plus the new out-of-blocking-path `bin/planos export`.

---

**Key file references used to make this plan file-level precise** (all absolute):
- `/Users/ggiak/www/esolutions.gr/planos/.omc/plans/planos-phase3-plan.md` + `/Users/ggiak/www/esolutions.gr/planos/.omc/plans/planos-phase2-plan.md` — the structural templates mirrored exactly
- `/Users/ggiak/www/esolutions.gr/planos/docs/design.md` — §1 non-goals + "markdown as export format" thesis (lines 26, 37), §8 "Revisit Bun in Phase 4" (line 292), §9 Phase 4 scope (lines 327-330), §10 plannotator coexistence row (line 346)
- `/Users/ggiak/www/esolutions.gr/planos/docs/adr/0002-prd-persistence.md` + `/Users/ggiak/www/esolutions.gr/planos/docs/adr/0003-diff-review.md` — the AC-17 boundary doctrine + AC-P18/AC-R-WAIVER patterns mirrored
- `/Users/ggiak/www/esolutions.gr/planos/docs/notes/plannotator-coexistence-spike.md` — the CC multi-plugin dispatch facts grounding the Q7 infeasibility analysis
- `/Users/ggiak/www/esolutions.gr/planos/src/schema/fallback.mjs` + `/Users/ggiak/www/esolutions.gr/planos/src/editor/markdown.tsx` — confirm NO `Document→markdown` serializer exists (export workstream is genuinely new; the design.md §1 thesis is unimplemented)
- `/Users/ggiak/www/esolutions.gr/planos/src/editor/App.tsx` + `/Users/ggiak/www/esolutions.gr/planos/src/editor/blocks.tsx` — hard-coded inline-style hex (the theme-token threading targets)
- `/Users/ggiak/www/esolutions.gr/planos/plugin/bin/planos` — the provable `resolve(__dirname,'<lit>')` dispatch pattern the `export` case mirrors (lines 18-58)
- `/Users/ggiak/www/esolutions.gr/planos/tests/harness/import-graph.mjs` (`ac17Roots()` lines 601-623, UNCHANGED) + `/Users/ggiak/www/esolutions.gr/planos/tests/ac17-invariant.test.mjs` (LAYER 1b — extended with the AC-Q12 negative assertion) — the AC-17 re-assertion mechanism, by negative proof
- `/Users/ggiak/www/esolutions.gr/planos/tests/harness/verify-exit-gate.mjs` (FROZEN, untouched) + `prd-smoke.mjs` + `review-smoke.mjs` — the verify gate Phase 4 keeps green between every milestone
- `/Users/ggiak/www/esolutions.gr/planos/.claude-plugin/marketplace.json` + `/Users/ggiak/www/esolutions.gr/planos/plugin/.claude-plugin/plugin.json` + `/Users/ggiak/www/esolutions.gr/planos/package.json` — marketplace-listing + version-bump targets
- `/Users/ggiak/www/esolutions.gr/planos/src/hook/coexistence.mjs` + `/Users/ggiak/www/esolutions.gr/planos/tests/coexistence.test.mjs` — the detect-and-refuse posture (unchanged under the recommended Q7)
- SPA size measured: `/Users/ggiak/www/esolutions.gr/planos/plugin/dist/index.html` = 3,414,771 bytes (≈3.26 MB, ≈0.74 MB headroom under the 4 MB cap) — the hard budget for all Phase-4 SPA additions combined

---

**Plan complete.** This is ready to be written to `/Users/ggiak/www/esolutions.gr/planos/.omc/plans/planos-phase4-plan.md`. Key architectural calls embedded as recommended Open Decisions: (1) the headline Q1 scope cut keeps only zero-dep / zero-blocking-path additive polish IN and DEFERS every explicitly-"optional" / user-descoped item with recorded rationale; (2) the AC-17 invariant is RE-ASSERTED by a *negative* proof (export modules provably absent from the blocking closure), the Phase-3-R1 doctrine applied to a post-server surface — no new `ac17Roots()` entry, no new allowed-boundary carve-out; (3) PDF is mandated zero-dep `window.print()`; (4) the plannotator §10 item's genuine Phase-4 deliverable is a *principled documented closure* of the long-"Open" row, not infeasible coexistence code.
