/**
 * planos — schema barrel: the single strategy-aware entry point.
 *
 * Contract: plan Step 1.1 ("Schema and injected authoring instructions
 * parametrized over the strategy" — selectable by flag with no code changes
 * elsewhere); docs/design.md §4, §6; AC-17 (zero runtime deps).
 *
 * Consumers (hook injection, harness, tooling) import from here and stay
 * strategy-agnostic: flip `PLANOS_ID_STRATEGY` and the active strategy, its
 * id factory, and its injected authoring instruction all change together with
 * zero call-site edits. Validation itself is strategy-INVARIANT (the v1
 * contract does not care HOW an id was minted, only that it is a stable
 * non-empty string — see validate.mjs), so `validateDocument` is re-exported
 * as-is and a valid doc round-trips under either strategy.
 *
 * No winner is chosen here; the active strategy is whatever the flag resolves
 * to (DEV default documented in id-strategy.mjs; production default deferred to
 * the Milestone 1 live gate / ADR-0001).
 *
 * Zero runtime dependencies. ES module.
 */

export { validateDocument, V1_KINDS } from "./validate.mjs";
export { degradeToProse } from "./fallback.mjs";
export {
  validateEnvelope,
  checkBaseRevision,
  renderOpsHuman,
  ENVELOPE_DECISIONS,
  EDIT_OPS,
} from "./envelope.mjs";
export {
  ID_STRATEGIES,
  ID_STRATEGY_ENV,
  DEV_DEFAULT_STRATEGY,
  getStrategy,
  makeIdFactory,
  idPreservationInstruction,
} from "./id-strategy.mjs";

import { getStrategy, makeIdFactory, idPreservationInstruction } from "./id-strategy.mjs";

/**
 * Bundle the active strategy's runtime surface in one call so call sites never
 * branch on the flag themselves.
 *
 * @param {{ [k: string]: string | undefined }} [env=process.env]
 * @returns {{
 *   strategy: "semantic-slug" | "opaque",
 *   idFactory: { strategy: string, mint: (block: unknown, existingIds?: Set<string>|Iterable<string>) => string },
 *   authoringInstruction: string,
 * }}
 */
export function activeIdStrategy(env = process.env) {
  const strategy = getStrategy(env);
  return {
    strategy,
    idFactory: makeIdFactory(strategy),
    authoringInstruction: idPreservationInstruction(strategy),
  };
}
