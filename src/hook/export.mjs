/**
 * planos — `bin/planos export` OUT-OF-BLOCKING-PATH markdown-export CLI.
 *
 * Contract: docs/design.md §1 thesis ("markdown becomes an export format, not
 * the source of truth"), plan planos-phase4-plan.md Resolved Decisions (Q3 =
 * the pure serializer is consumed SPA-side AND by this out-of-blocking-path
 * CLI, NEVER imported by a blocking handler), §3.2 (Consumption B), §4 (the
 * out-of-blocking-path boundary), §5 AC-Q6 (the gate for this milestone),
 * §6 Milestone Q1 (Q1.1/Q1.2/Q1.3).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AC-17 OUT-OF-BLOCKING-PATH CONTRACT (Q3 — the R1-Option-A pre-server gh/git
 * doctrine applied to a POST-server CLI surface):
 *
 *   This handler is a NON-blocking, one-shot read→serialize→print→exit CLI.
 *   It boots NO server (it does NOT import `src/server/` and never calls
 *   `startServer`), opens NO decision round-trip, and NEVER blocks. It does
 *   NOT import any blocking handler (`src/hook/{exit,prd,review}.mjs`). Its
 *   ONLY imports are `./roundtrip.mjs` (the production-hardened
 *   `readStdin`/`extractPlan` stdin handoff — byte-for-byte the same the
 *   ExitPlanMode hook + the PRD/review handlers use) and the PURE
 *   `../export/markdown.mjs` serializer. It introduces ZERO new `node:`
 *   surface beyond what `roundtrip.mjs` itself already uses for stdin, ZERO
 *   network egress, ZERO model invocation, ZERO subprocess.
 *
 *   Because it is neither a `bin/planos exit|prd|review` root nor reachable
 *   from one, the AC-17 import-graph walk over the blocking roots stays
 *   VERDICT CLEAN with zero new allowed-boundary carve-outs; `ac17Roots()`
 *   is UNCHANGED. AC-Q12 (Milestone Q5) additionally proves this module —
 *   and `../export/markdown.mjs` — ABSENT from the blocking transitive
 *   closure of `exit|prd|review` by a NEGATIVE assertion. The blocking path
 *   stays byte-for-byte as in Phase 3. Do NOT add a server / blocking-handler
 *   import to this file.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Degrade-not-block doctrine: `serializeMarkdown` is degrade-safe (it NEVER
 * throws and ALWAYS returns a string — a malformed/empty/degraded doc still
 * yields best-effort markdown). On any readable stdin (including empty or
 * non-JSON) we therefore still write the serializer's best-effort output and
 * exit 0. Only a genuinely unreadable stdin (the reader rejecting — which it
 * is contractually guaranteed never to do, but we are defensive) is a
 * non-zero exit with a stderr message.
 *
 * Zero runtime dependencies. ES module. No network, no model, no spawn.
 */

'use strict';

import { readStdin, extractPlan } from './roundtrip.mjs';
import { serializeMarkdown } from '../export/markdown.mjs';

/**
 * Handle the `export` subcommand — read a document from stdin (the same
 * production-hardened `readStdin`/`extractPlan` handoff the PRD/review
 * handlers use), serialize it to canonical markdown via the PURE
 * `serializeMarkdown` serializer, write the markdown to stdout, and exit 0.
 *
 * Out-of-blocking-path by construction: NO server, NO round-trip, NO block.
 *
 * @param {object} [options]
 * @param {string} [options.stdinText]
 *   Injectable stdin payload (tests pass it directly instead of piping).
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options.stdinOpts]
 *   Injectable production stdin bounds (US-013), forwarded to readStdin.
 * @param {(text: string) => void} [options.writeOut]
 *   Test-only stdout sink (default: process.stdout.write).
 * @param {(text: string) => void} [options.writeErr]
 *   Test-only stderr sink (default: process.stderr.write).
 * @param {(code: number) => void} [options.exit]
 *   Test-only exit override (default: process.exit).
 * @returns {Promise<void>}
 */
export async function handleExport(options = {}) {
  const { stdinText, stdinOpts = {} } = options;
  const writeOut =
    typeof options.writeOut === 'function'
      ? options.writeOut
      : (s) => process.stdout.write(s);
  const writeErr =
    typeof options.writeErr === 'function'
      ? options.writeErr
      : (s) => process.stderr.write(s);
  const exit =
    typeof options.exit === 'function'
      ? options.exit
      : (c) => process.exit(c);

  // 1. Read stdin and extract tool_input.plan (the SAME production-hardened
  //    reader the ExitPlanMode hook + the PRD/review handlers use —
  //    ./roundtrip.mjs; NEVER rejects/throws/blocks forever). readStdin is
  //    contractually safe, but we stay defensive: a genuinely unreadable
  //    stdin is the ONLY non-zero exit (degrade-not-block otherwise).
  let raw;
  try {
    raw =
      typeof stdinText === 'string'
        ? stdinText
        : await readStdin(stdinOpts);
  } catch (e) {
    writeErr(
      'planos export: could not read stdin: ' +
        (e && e.message ? e.message : String(e)) +
        '\n',
    );
    exit(1);
    return;
  }

  const planText = extractPlan(raw);

  // 2. Parse the extracted plan text into a best-effort document. A
  //    non-JSON / empty / malformed payload degrades: the serializer is
  //    degrade-safe and still emits valid best-effort markdown (we NEVER
  //    block the user — degrade-not-block doctrine).
  let doc;
  try {
    doc = JSON.parse(planText);
  } catch {
    // Not JSON — hand the raw text to the serializer as a best-effort doc;
    // serializeMarkdown is total over any shape and never throws.
    doc = planText;
  }

  // 3. Serialize to canonical markdown (PURE — zero clock/fs/network/spawn).
  const md = serializeMarkdown(doc);

  // 4. Write markdown to stdout and exit 0. One-shot: no server, no block.
  writeOut(md);
  exit(0);
}
