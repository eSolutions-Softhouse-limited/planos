/**
 * planos — dual block-ID strategies behind a single selector flag.
 *
 * Contract: docs/design.md §4 (IDs are agent-assigned, MUST persist across
 * revisions), §6 (block-ID stability is the single make-or-break risk);
 * plan Step 1.1 + Decision 2; AC-17 (zero runtime deps — node: builtins only).
 *
 * WHY THIS FILE EXISTS / WHAT IT DOES *NOT* DECIDE
 * ------------------------------------------------
 * design.md §6 says block IDs are minted by the *nondeterministic agent*; planos
 * does not own ID generation at runtime. This module is the *prototyping seam*
 * for Milestone 1: it implements BOTH candidate schemes (semantic-slug vs
 * opaque) plus the strategy-parametrized authoring-instruction text that gets
 * injected into `additionalContext`, so the rest of the build can be written
 * once and parametrized over the strategy.
 *
 * The choice of which scheme WINS was deferred to empirical measurement
 * (Decision 2 / Step 1.3) and is now DECIDED. Milestone 1 ran ≥5 live
 * forced-revise cycles per scheme through the REAL thin loop against the
 * FROZEN bars (no tuning). BOTH schemes cleared every bar at the maximum
 * (live ID-preservation = 1.000, 6/6, zero regression; convergence 1.000;
 * first-try 1.000) — the gate did not discriminate, so the tie-break is on
 * residual risk: `opaque` is rename-stable with no slug-collision growth
 * risk, and its only theoretical weakness (no semantic recall hook) is
 * neutralised by the always-on §6.2 deny-echo table and was empirically
 * proven (opaque 6/6 = 1.000). The production default is therefore `opaque`,
 * recorded authoritatively in docs/adr/0001-block-id-scheme.md.
 *
 * The `mint()` helpers here are used by harness fixtures and tooling that need
 * to *synthesize* ids deterministically for a strategy (e.g. generating canned
 * forced-revise fixtures, or a fallback synthesizer). They do not, and must
 * not, run inside the blocking ExitPlanMode hook path against agent output.
 *
 * Zero runtime dependencies. ES module. No network, no model, no clock.
 */

/** The two candidate strategies. Neither is pre-invalidated; data decides. */
export const ID_STRATEGIES = Object.freeze(["semantic-slug", "opaque"]);

/**
 * The env var that selects the active strategy.
 * @see getStrategy
 */
export const ID_STRATEGY_ENV = "PLANOS_ID_STRATEGY";

/**
 * Production default strategy — DECIDED at the Milestone 1 live gate.
 *
 * docs/adr/0001-block-id-scheme.md is the authoritative record: both schemes
 * cleared every FROZEN bar at the maximum, tie broken on residual risk →
 * `opaque`. This constant is now wired from that decision (Step 1.3); it is
 * no longer a placeholder.
 */
export const PRODUCTION_DEFAULT_STRATEGY = "opaque";

/**
 * Back-compat alias of {@link PRODUCTION_DEFAULT_STRATEGY}. Earlier code/tests
 * imported `DEV_DEFAULT_STRATEGY` while the winner was deferred; the name is
 * retained as a stable export but it now points at the ADR-decided production
 * default (`opaque`), NOT a dev-only placeholder.
 */
export const DEV_DEFAULT_STRATEGY = PRODUCTION_DEFAULT_STRATEGY;

/**
 * Resolve the active ID strategy from the environment.
 *
 * Reads `PLANOS_ID_STRATEGY`. Unknown / unset values fall back to the
 * ADR-decided production default (see {@link PRODUCTION_DEFAULT_STRATEGY} —
 * `opaque`, docs/adr/0001-block-id-scheme.md). The explicit flag still
 * overrides it (semantic-slug remains a validated, equal-measured-merit
 * alternative selectable via the env var).
 *
 * @param {{ [k: string]: string | undefined }} [env=process.env]
 * @returns {"semantic-slug" | "opaque"}
 */
export function getStrategy(env = process.env) {
  const raw = env && env[ID_STRATEGY_ENV];
  if (raw === "semantic-slug" || raw === "opaque") return raw;
  return DEV_DEFAULT_STRATEGY;
}

// ---------------------------------------------------------------------------
// Slug derivation (semantic-slug strategy)
// ---------------------------------------------------------------------------

/**
 * Short, stable per-kind prefix so ids read as `task-…`, `dec-…`, etc. Kept
 * compact because the agent recalls these from the deny-echo table (§6.2).
 */
const KIND_PREFIX = Object.freeze({
  section: "sec",
  prose: "prose",
  objective: "obj",
  task: "task",
  decision: "dec",
  risk: "risk",
  openQuestion: "q",
});

/** Fallback prefix for any block whose kind we do not have a short name for. */
const DEFAULT_PREFIX = "blk";

/**
 * The block field whose text is the human-meaningful basis for a slug, per
 * kind. Mirrors the v1 schema in validate.mjs / types.d.ts.
 */
const PRIMARY_TEXT_FIELD = Object.freeze({
  section: "title",
  prose: "md",
  objective: "text",
  task: "title",
  decision: "question",
  risk: "description",
  openQuestion: "question",
});

/**
 * Slugify arbitrary text: lowercase, ASCII-fold the cheap cases, collapse all
 * non-alphanumerics to single hyphens, trim, and cap word count so slugs stay
 * short and stable (a 12-word title and its lightly-edited 13-word variant
 * should not produce wildly different slugs — though semantic-slug's known
 * weakness, per Decision 2, is exactly title-edit instability; that is what
 * Milestone 1 measures, not something this code pretends to solve).
 *
 * @param {string} text
 * @param {number} [maxWords=5]
 * @returns {string} possibly empty if text has no slug-able characters
 */
function slugify(text, maxWords = 5) {
  const s = String(text == null ? "" : text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (s.length === 0) return "";
  return s.split(/\s+/).slice(0, maxWords).join("-");
}

function prefixFor(kind) {
  return KIND_PREFIX[kind] || DEFAULT_PREFIX;
}

function primaryTextOf(block) {
  if (!block || typeof block !== "object") return "";
  const field = PRIMARY_TEXT_FIELD[block.kind];
  const v = field ? block[field] : undefined;
  return typeof v === "string" ? v : "";
}

/**
 * Disambiguate `base` against `existingIds` by appending `-2`, `-3`, … until
 * unique. Pure: never mutates `existingIds`.
 *
 * @param {string} base
 * @param {Set<string> | Iterable<string>} existingIds
 * @returns {string}
 */
function disambiguate(base, existingIds) {
  const taken =
    existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// Strategy factories
// ---------------------------------------------------------------------------

/**
 * `semantic-slug`: `${kindPrefix}-${slug(primaryText)}` with `-N`
 * collision-disambiguation. Human-meaningful; may anchor agent recall
 * (Decision 2 Option A pro), at the cost of title-edit instability (its con —
 * the thing Milestone 1 measures).
 */
function semanticSlugFactory() {
  return {
    strategy: "semantic-slug",
    /**
     * @param {{ kind?: string }} block
     * @param {Set<string> | Iterable<string>} [existingIds]
     * @returns {string}
     */
    mint(block, existingIds) {
      const prefix = prefixFor(block && block.kind);
      const slug = slugify(primaryTextOf(block));
      const base = slug ? `${prefix}-${slug}` : prefix;
      return disambiguate(base, existingIds);
    },
  };
}

/**
 * `opaque`: short stable `b{n}` tokens with no semantic coupling
 * (Decision 2 Option B — rename-stable, no semantic hook for the agent).
 * The counter is seeded from the highest existing `b<number>` so a fresh mint
 * never collides with an id the agent already authored, keeping tokens short
 * and monotonic rather than random (short + stable beats random for the §6.2
 * deny-echo recall path).
 */
function opaqueFactory() {
  let counter = 0;
  return {
    strategy: "opaque",
    /**
     * @param {unknown} _block - intentionally unused: opaque ids are not
     *   derived from block content (that is the whole point of the scheme).
     * @param {Set<string> | Iterable<string>} [existingIds]
     * @returns {string}
     */
    mint(_block, existingIds) {
      const taken =
        existingIds instanceof Set
          ? existingIds
          : new Set(existingIds || []);
      // Seed the counter past any existing b<number> id so we never reissue one.
      for (const id of taken) {
        const m = /^b(\d+)$/.exec(id);
        if (m) {
          const n = Number(m[1]);
          if (Number.isFinite(n) && n > counter) counter = n;
        }
      }
      let candidate;
      do {
        counter += 1;
        candidate = `b${counter}`;
      } while (taken.has(candidate));
      return candidate;
    },
  };
}

/**
 * Build an id factory for `strategy`.
 *
 * The returned factory is stateful only for `opaque` (it remembers its
 * monotonic counter across `mint` calls within one factory instance); pass
 * `existingIds` on every call so collisions against already-authored ids are
 * impossible regardless of strategy.
 *
 * @param {"semantic-slug" | "opaque"} [strategy=getStrategy()]
 * @returns {{ strategy: string, mint: (block: unknown, existingIds?: Set<string>|Iterable<string>) => string }}
 */
export function makeIdFactory(strategy = getStrategy()) {
  if (strategy === "opaque") return opaqueFactory();
  if (strategy === "semantic-slug") return semanticSlugFactory();
  throw new Error(
    `unknown id strategy ${JSON.stringify(strategy)} (expected one of ${ID_STRATEGIES.join(
      " | ",
    )})`,
  );
}

// ---------------------------------------------------------------------------
// Authoring-instruction text (injected into additionalContext)
// ---------------------------------------------------------------------------

/**
 * The strategy-INVARIANT ID-preservation rule. design.md §6.1 verbatim intent:
 * REUSE unchanged ids, only mint for genuinely new blocks, NEVER renumber.
 * This sentence MUST appear identically under both strategies — it is the load-
 * bearing §6 instruction; only the strategy-specific guidance below differs.
 */
const NEVER_RENUMBER_RULE =
  "When you revise this document, REUSE the `id` of any block whose intent " +
  "is unchanged. Only mint new IDs for genuinely new blocks. NEVER renumber " +
  "or regenerate IDs for blocks that already exist — even if their wording, " +
  "order, or surrounding blocks changed.";

/** Per-strategy supplemental guidance appended after the invariant rule. */
const STRATEGY_GUIDANCE = Object.freeze({
  "semantic-slug":
    "IDs are human-meaningful slugs of the form `<kind>-<short-slug>` " +
    "(e.g. `task-auth-middleware`, `dec-db-choice`, `q-rollback-window`). " +
    "Treat the slug as an opaque stable handle: do NOT re-slug an existing " +
    "block just because you reworded its title or text — keep its original " +
    "ID. Only derive a fresh `<kind>-<slug>` ID for a block that did not " +
    "exist in the prior revision. If two new blocks would slug identically, " +
    "disambiguate the second with a `-2` (then `-3`, …) suffix.",
  opaque:
    "IDs are short opaque tokens of the form `b<number>` (e.g. `b1`, `b2`, " +
    "`b17`). They carry NO meaning and MUST NOT be derived from a block's " +
    "content — never rename an ID to match an edited title. The prior " +
    "revision's `(id, kind, title)` echo table is your source of truth for " +
    "which token belongs to which block; reuse those tokens exactly. For a " +
    "genuinely new block, mint the next unused `b<number>` higher than every " +
    "existing token; never reuse or recycle a retired token.",
});

/**
 * The canonical authoring-instruction text for `strategy`, ready to be dropped
 * into the EnterPlanMode `additionalContext` injection.
 *
 * Guarantees (asserted by tests/id-strategy.test.mjs):
 *  - the never-renumber invariant rule is present under BOTH strategies,
 *  - the text DIFFERS between strategies (strategy-specific guidance),
 *  - pure string work — no model, no clock, no deps.
 *
 * @param {"semantic-slug" | "opaque"} [strategy=getStrategy()]
 * @returns {string}
 */
export function idPreservationInstruction(strategy = getStrategy()) {
  if (strategy !== "semantic-slug" && strategy !== "opaque") {
    throw new Error(
      `unknown id strategy ${JSON.stringify(strategy)} (expected one of ${ID_STRATEGIES.join(
        " | ",
      )})`,
    );
  }
  return [
    "## Block ID stability (load-bearing)",
    "",
    NEVER_RENUMBER_RULE,
    "",
    STRATEGY_GUIDANCE[strategy],
  ].join("\n");
}
