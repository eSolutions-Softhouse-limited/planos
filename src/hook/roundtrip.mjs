/**
 * planos — shared blocking-round-trip internals (stdin ingestion).
 *
 * Phase 2 / Milestone P2: extracted VERBATIM from src/hook/exit.mjs so the
 * PRD-mode handler (src/hook/prd.mjs) can reuse the exact same production-
 * hardened stdin reader + tool_input.plan extractor that the ExitPlanMode
 * hook uses. This is a ZERO-behaviour-change move: exit.mjs imports these
 * back and continues to call identical code (the functions are byte-identical
 * to their previous in-file definitions). The existing tests/exit-*.test.mjs
 * suites are the regression guard and stay green unchanged.
 *
 * Guarantees (US-013, unchanged): readStdin NEVER rejects, NEVER blocks
 * indefinitely, NEVER throws; extractPlan tolerates malformed/empty stdin.
 * No network, no model, no spawn — pure stream read + JSON parse.
 *
 * Zero runtime dependencies. ES module.
 */

'use strict';

// ---------------------------------------------------------------------------
// stdin (production-hardened — US-013)
// ---------------------------------------------------------------------------

/**
 * Hard cap on the stdin payload we will buffer. A hook stdin JSON is a tool
 * call envelope; even a very large plan is well under this. Capping bounds
 * memory against a pathological/hostile payload — once exceeded we stop
 * accumulating and degrade what we have (the prose fallback still wraps it;
 * the user is never blocked, and we never OOM the blocking hook).
 */
const MAX_STDIN_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Idle/total ceiling for reading stdin. In a real hook stdin is a pipe that
 * closes promptly; if the fd is somehow never closed (misconfigured spawn,
 * non-piped invocation that did not end) we must NOT block the user forever.
 * On timeout we resolve with whatever was buffered ('' if nothing) and the
 * prose fallback degrades it. This is an upper safety bound, not the contract.
 */
const STDIN_TIMEOUT_MS = 30 * 1000;

/**
 * Read all of process.stdin as a UTF-8 string, production-hardened.
 *
 * Guarantees (US-013): NEVER rejects, NEVER blocks indefinitely, NEVER throws.
 *   - large payloads     → buffered up to MAX_STDIN_BYTES then truncated
 *   - partial chunks     → concatenated in arrival order
 *   - empty / TTY stdin  → resolves '' (prose fallback degrades it)
 *   - stream 'error'     → resolves whatever was buffered ('' if none); the
 *                          error is swallowed (we degrade, never crash)
 *   - never-closing fd   → STDIN_TIMEOUT_MS safety bound resolves the buffer
 *
 * No network, no model, no spawn — pure stream read.
 *
 * @param {{ timeoutMs?: number, maxBytes?: number }} [opts]
 *   Injectable bounds for tests (tiny timeout / cap). Defaults are production.
 * @returns {Promise<string>}
 */
export function readStdin(opts = {}) {
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs >= 0
      ? opts.timeoutMs
      : STDIN_TIMEOUT_MS;
  const maxBytes =
    typeof opts.maxBytes === 'number' && opts.maxBytes > 0
      ? opts.maxBytes
      : MAX_STDIN_BYTES;

  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let truncated = false;
    let settled = false;
    const stdin = process.stdin;

    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      // Stop the flowing stream so a still-open fd cannot keep this process
      // alive after we have resolved (e.g. after a timeout).
      try {
        stdin.pause();
      } catch {
        /* best-effort; never throw out of stdin teardown */
      }
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      let text = '';
      try {
        text = Buffer.concat(chunks).toString('utf8');
      } catch {
        // Buffer.concat on a pathological chunk set — degrade to empty; the
        // prose fallback still produces a valid (empty-bodied) document.
        text = '';
      }
      resolve(text);
    };

    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (truncated) return;
      if (total + buf.length > maxBytes) {
        // Keep only up to the cap, then stop accumulating; we still degrade
        // the (partial) text — never block, never OOM.
        const room = Math.max(0, maxBytes - total);
        if (room > 0) {
          chunks.push(buf.subarray(0, room));
          total += room;
        }
        truncated = true;
        settle();
        return;
      }
      chunks.push(buf);
      total += buf.length;
    };

    const onEnd = () => settle();

    // A stream 'error' must NOT propagate out of the handler (US-013): we
    // resolve whatever we have and let the prose fallback degrade it.
    const onError = () => settle();

    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);

    if (timeoutMs > 0) {
      timer = setTimeout(settle, timeoutMs);
      // Do not let the safety timer keep the event loop alive on its own.
      if (timer && typeof timer.unref === 'function') timer.unref();
    }

    // Kick the stream; in some spawn contexts 'data'/'end' need an explicit
    // resume to start flowing.
    try {
      stdin.resume();
    } catch {
      // A non-resumable stdin (already destroyed) → resolve empty.
      settle();
    }
  });
}

/**
 * Extract the raw `tool_input.plan` value from the hook stdin JSON.
 * Tolerates malformed / empty stdin (returns '' — the prose fallback then
 * degrades it; the user is never blocked).
 *
 * @param {string} raw
 * @returns {string}
 */
export function extractPlan(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return '';
  let hookJson;
  try {
    hookJson = JSON.parse(raw);
  } catch {
    // stdin was not JSON at all — treat the whole thing as the plan text.
    return raw;
  }
  const plan =
    hookJson &&
    typeof hookJson === 'object' &&
    hookJson.tool_input &&
    typeof hookJson.tool_input === 'object'
      ? hookJson.tool_input.plan
      : undefined;
  if (typeof plan === 'string') return plan;
  if (plan === undefined || plan === null) return '';
  // plan present but not a string — stringify so the fallback can wrap it.
  // JSON.stringify can throw (circular refs, BigInt); never let that escape —
  // fall back to a String() coercion so degradeToProse still gets text.
  try {
    const s = JSON.stringify(plan);
    return typeof s === 'string' ? s : String(plan);
  } catch {
    try {
      return String(plan);
    } catch {
      return '';
    }
  }
}
