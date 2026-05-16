/**
 * planos — deterministic, model-free prose fallback.
 *
 * Contract: docs/design.md §5 ("The fallback is a parser, not a model"),
 * plan Step 0.4, AC-7, AC-17.
 *
 * When `tool_input.plan` fails schema validation inside the blocking
 * `ExitPlanMode` hook, the user must NEVER be blocked by malformed agent
 * output. This module wraps the raw text verbatim in exactly ONE `prose`
 * block, mints a fresh document id, sets `meta.degraded = true`, and
 * `meta.revision = 1`. Pure: no network, no model, no agent spawn — only a
 * single `Date` read for `createdAt`. ID-stable for a given input is NOT a
 * goal here (this is revision 1 of a degraded doc); determinism of *shape*
 * is. AC-17: nothing in this path can reach a model.
 *
 * Zero runtime dependencies. ES module.
 */

import { randomUUID } from "node:crypto";

/**
 * Deterministically wrap arbitrary text in a single-prose degraded document.
 *
 * @param {string} rawText - The raw, unstructured agent output (any text).
 * @param {{ id?: string, createdAt?: string, title?: string, type?: string }} [opts]
 *   Optional overrides. `id`/`createdAt` injectable for deterministic tests.
 * @returns {import("./types").Document}
 */
export function degradeToProse(rawText, opts = {}) {
  const text = typeof rawText === "string" ? rawText : String(rawText ?? "");

  const docId = opts.id ?? `planos-degraded-${randomUUID()}`;
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const title = opts.title ?? deriveTitle(text);
  const type = opts.type ?? "plan";

  return {
    schemaVersion: 1,
    type,
    id: docId,
    title,
    meta: {
      status: "draft",
      createdAt,
      revision: 1,
      degraded: true,
    },
    blocks: [
      {
        id: `${docId}-prose-1`,
        kind: "prose",
        md: text,
      },
    ],
  };
}

/**
 * Derive a human-readable title from the raw text deterministically: first
 * markdown heading if present, else first non-empty line, trimmed to 120
 * chars, falling back to a fixed label. No model, pure string work.
 *
 * @param {string} text
 * @returns {string}
 */
function deriveTitle(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const heading = trimmed.match(/^#{1,6}\s+(.*\S)\s*$/);
    const candidate = heading ? heading[1] : trimmed;
    return candidate.length > 120 ? `${candidate.slice(0, 117)}...` : candidate;
  }
  return "Unstructured plan (degraded)";
}
