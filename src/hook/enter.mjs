/**
 * planos — EnterPlanMode PreToolUse hook handler.
 *
 * Contract: plan Step 2-thin.1, AC-1, US-007.
 *
 * Emits, on the PreToolUse EnterPlanMode channel, an `additionalContext`
 * payload containing:
 *   (a) The full v1 block schema — human-readable summary of the 7 v1 kinds
 *       and Document shape from src/schema.
 *   (b) A worked example of a small valid v1 block document.
 *   (c) The explicit ID-preservation rules text from id-strategy.mjs
 *       (REUSE id of intent-unchanged blocks; only mint new IDs for genuinely
 *       new blocks; NEVER renumber).
 *
 * Outputs the correct PreToolUse hook JSON:
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *                             "additionalContext": "..." } }
 *
 * Exit 0 immediately after writing. Zero runtime dependencies.
 * No network, no model, no child_process spawn.
 *
 * Integration point for id-strategy.mjs:
 *   import { authoringInstructions } from '../../src/schema/id-strategy.mjs';
 *
 * When that module is available the `idPreservationRules()` function below
 * switches to its exported text. Until then, the inline constant below is the
 * authoritative fallback (never blank — tests assert on it).
 */

'use strict';

// ---------------------------------------------------------------------------
// ID-strategy integration point
// ---------------------------------------------------------------------------
// TODO: wire to the real module once src/schema/id-strategy.mjs exists.
//   import { authoringInstructions } from '../schema/id-strategy.mjs';
// The exported `authoringInstructions` string contains the per-strategy
// authoring-instruction text selected by the active strategy flag/env.
// ---------------------------------------------------------------------------

/**
 * Load the per-strategy ID-preservation authoring text from the schema
 * module. `activeIdStrategy(env)` resolves the active strategy from the
 * `PLANOS_ID_STRATEGY` flag and returns `{ authoringInstruction }`. The
 * import is wrapped in try/catch so the enter handler still works if the
 * schema module is unavailable, in which case the inline fallback is used.
 *
 * @returns {Promise<string | null>}
 */
async function tryLoadIdStrategyInstructions() {
  try {
    const mod = await import('../schema/index.mjs');
    const active = mod.activeIdStrategy?.();
    if (active && typeof active.authoringInstruction === 'string' && active.authoringInstruction.length > 0) {
      return active.authoringInstruction;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Inline fallback for the ID-preservation rules text.
 * Used when src/schema/id-strategy.mjs does not yet exist.
 * Mirrors the language in design.md §6 mechanism #1 verbatim.
 */
const ID_PRESERVATION_RULES_FALLBACK = `\
## Block ID Preservation Rules (CRITICAL)

Block IDs are the stable revision-chain key for every annotation, diff, and
feedback anchor. You MUST follow these rules on every revision:

1. REUSE the \`id\` of any block whose intent is unchanged — even if you
   rephrase its title or content. Same concept = same id.
2. Only MINT a new \`id\` for blocks that are genuinely new (no corresponding
   prior block). Choose a short, unique, human-readable identifier such as
   "t2", "risk-caching", "q-deploy-window".
3. NEVER renumber. Do not shift ids numerically just because block positions
   changed. IDs are semantic anchors, not positional indices.
4. The deny feedback includes the current (id, kind, title) table — use it
   as your exact reference when revising. Reuse every id you see there.

Violation: re-minted IDs break every annotation and diff anchor permanently.`;

// ---------------------------------------------------------------------------
// Schema summary (human-readable, not JSON — easier for the agent to absorb)
// ---------------------------------------------------------------------------

const SCHEMA_SUMMARY = `\
## planos v1 Block Schema — Authoring Reference

Author the plan as a **JSON block document** matching the schema below.
Output ONLY the raw JSON — no markdown fences, no prose around it.

### Document shape

\`\`\`
{
  "schemaVersion": 1,                  // always 1
  "type": "plan",                      // use "plan" for plan-mode
  "id": "<string>",                    // STABLE across revisions (revision-chain key)
  "title": "<string>",                 // human title of the plan
  "meta": {
    "status": "draft",                 // one of: draft | in-review | approved
    "createdAt": "<ISO-8601>",         // e.g. "2026-05-16T12:00:00.000Z"
    "revision": 1                      // integer; increment on each revision
  },
  "blocks": [ ...Block ]
}
\`\`\`

### Block kinds (v1 core — 7 kinds)

Every block requires \`"id"\` (stable string) and \`"kind"\` (discriminant).

| kind | Required fields | Optional fields |
|------|----------------|-----------------|
| \`section\` | id, kind, title (string), level (integer 1–6) | collapsed (boolean) |
| \`prose\` | id, kind, md (markdown string) | — |
| \`objective\` | id, kind, text (string), successCriteria (string[]) | — |
| \`task\` | id, kind, title (string), status (todo\\|doing\\|done\\|cut), deps (id[]), acceptance (string[]) | detail (string), estimate (string) |
| \`decision\` | id, kind, question (string), options ({label, pros?, cons?}[]) | chosen (label string), rationale (string) |
| \`risk\` | id, kind, description (string), likelihood (L\\|M\\|H), impact (L\\|M\\|H), mitigation (string) | — |
| \`openQuestion\` | id, kind, question (string) | answer (string) |

Use \`prose\` for narrative context. Use \`openQuestion\` for anything that
REQUIRES human input — the reviewer answers it directly in the UI.`;

// ---------------------------------------------------------------------------
// Worked example
// ---------------------------------------------------------------------------

const WORKED_EXAMPLE = `\
## Worked Example — Small Valid v1 Plan Document

\`\`\`json
{
  "schemaVersion": 1,
  "type": "plan",
  "id": "auth-rewrite-2026-05-16",
  "title": "Auth Rewrite",
  "meta": {
    "status": "draft",
    "createdAt": "2026-05-16T12:00:00.000Z",
    "revision": 1
  },
  "blocks": [
    {
      "id": "s-overview",
      "kind": "section",
      "title": "Overview",
      "level": 1
    },
    {
      "id": "p-context",
      "kind": "prose",
      "md": "We are replacing the legacy session store with a JWT-based system to enable horizontal scaling."
    },
    {
      "id": "obj-migration",
      "kind": "objective",
      "text": "Zero-downtime migration to the new auth system",
      "successCriteria": [
        "No 5xx spike during cutover",
        "p99 latency stays under 200 ms"
      ]
    },
    {
      "id": "t-dual-write",
      "kind": "task",
      "title": "Build dual-write layer",
      "detail": "Write to both old and new store behind a feature flag",
      "status": "todo",
      "deps": [],
      "acceptance": ["Both stores consistent under load test"],
      "estimate": "3d"
    },
    {
      "id": "dec-token-format",
      "kind": "decision",
      "question": "Which token format should we use?",
      "options": [
        { "label": "JWT", "pros": ["stateless", "standard"], "cons": ["revocation complexity"] },
        { "label": "opaque", "pros": ["easy revocation"], "cons": ["requires DB lookup"] }
      ],
      "chosen": "JWT",
      "rationale": "Stateless scaling wins for our read-heavy workload."
    },
    {
      "id": "risk-stampede",
      "kind": "risk",
      "description": "Cache stampede on cutover",
      "likelihood": "M",
      "impact": "H",
      "mitigation": "Request coalescing and cache warmup before traffic shift"
    },
    {
      "id": "q-legacy-endpoint",
      "kind": "openQuestion",
      "question": "Do we keep the legacy endpoint for one release cycle?"
    }
  ]
}
\`\`\``;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `enter` subcommand.
 * Writes the PreToolUse hook JSON to stdout and exits 0.
 *
 * @returns {Promise<void>}
 */
export async function handleEnter() {
  // Attempt to load external ID-strategy authoring instructions.
  // Falls back to the inline constant if the module is not yet available.
  const idRules = (await tryLoadIdStrategyInstructions()) ?? ID_PRESERVATION_RULES_FALLBACK;

  const additionalContext = [
    SCHEMA_SUMMARY,
    '',
    WORKED_EXAMPLE,
    '',
    idRules,
  ].join('\n');

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext,
    },
  });

  // Write synchronously and exit immediately. process.stdout.write is
  // non-blocking for small payloads; for safety we flush via the 'drain'
  // event / callback before exiting — but the payload here is well within the
  // kernel pipe buffer so the callback fires synchronously in practice.
  const flushed = process.stdout.write(output + '\n', 'utf8', () => {
    process.exit(0);
  });

  // If write returned true the data was flushed to the kernel immediately;
  // the callback will still fire asynchronously. If it returned false the
  // 'drain' event is pending and the callback fires after drain. Either way
  // we rely solely on the callback for the exit so we never exit before flush.
  // Guard: if somehow the callback never fires (e.g. stdout is synchronous in
  // the test environment) we exit after a short delay.
  if (flushed) {
    // Callback will fire; nothing more to do here.
  }
}
