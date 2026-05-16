/**
 * planos — ExitPlanMode PermissionRequest hook handler (PRODUCTION path).
 *
 * Contract: plan Step 2f.2 (US-013), AC-2, AC-7, AC-17; docs/design.md §3,
 * §5 ("the fallback is a parser, not a model"), §6.
 *
 * US-013 hardening (production-quality stdin + parse + deterministic
 * degradation), keeping the US-008 exported API and injectable seams stable:
 *   - stdin reading survives large payloads, partial chunks, malformed/empty
 *     stdin, a hung non-piped fd, and stream errors; it NEVER throws out of
 *     the handler, NEVER blocks indefinitely, NEVER calls a model/network.
 *   - ANY invalid case (bad JSON, schema-invalid, plain markdown, empty,
 *     non-string plan, missing tool_input) degrades to EXACTLY one prose
 *     block + meta.degraded = true via degradeToProse(); the loop proceeds.
 *   - AC-7 is a hard pass/fail correctness property (100%), enforced by
 *     tests/exit-production.test.mjs (table-driven over every malformed
 *     class). NOT a percentage.
 *   - flush-then-exit-0 ordering preserved via src/server finish().
 *
 * Contract: plan Step 2-thin.2, AC-2, AC-3, AC-4, AC-17; docs/design.md §3, §6.
 *
 * Flow (design.md §3):
 *   1. Read hook JSON from stdin; extract `tool_input.plan`.
 *   2. Parse/validate `plan` via the src/schema barrel:
 *        valid v1 block doc      → use as-is
 *        invalid / plain-markdown → degradeToProse() (one prose block,
 *                                   meta.degraded = true)
 *      NEVER block the user, NEVER call a model or touch the network
 *      (AC-17 — zero egress from this path; only node: builtins + local
 *      src/ imports are reachable here).
 *   3. Boot the blocking server (src/server). In THIS thin milestone there is
 *      NO SPA / browser: the decision is resolved via a SCRIPTED path — an
 *      injected decision provider drives an /api/approve or /api/deny POST so
 *      the harness can resolve it deterministically. The open-browser seam is
 *      kept injectable and is an explicit no-op here.
 *   4. Emit the PermissionRequest decision JSON on stdout:
 *        approve → { hookSpecificOutput: { hookEventName: "PermissionRequest",
 *                                          decision: { behavior: "allow" } } }
 *        revise  → decision.behavior = "deny" with a `message`.
 *   5. The revise `deny.message` MUST include the (id, kind, title) echo table
 *      of the current document's blocks (design.md §6 mechanism #2) so
 *      Milestone 1 measures ID-preservation with the full mechanism set
 *      enabled. The human-readable ops rendering and full SPA FeedbackEnvelope
 *      serialization are DEFERRED to Milestone 2-full — only the directive
 *      preamble + (id,kind,title) table + canonical JSON are built here.
 *   6. Honor flush-then-exit-0 ordering via src/server's finish().
 *
 * Zero runtime dependencies. ES module. No network, no model, no spawn.
 */

'use strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { startServer } from '../server/index.mjs';
import {
  coexistenceGuard,
  coexistenceRefusalMessage,
} from './coexistence.mjs';
// Phase 2 / Milestone P2: the production-hardened stdin reader + tool_input.plan
// extractor were moved VERBATIM into ./roundtrip.mjs so the PRD-mode handler can
// reuse the exact same code path. exit.mjs imports them back and continues to
// call identical logic — ZERO behaviour change (the tests/exit-*.test.mjs
// regression guard stays green). They are also re-exported below so existing
// consumers / the round-trip seam keep a single import surface.
import { readStdin, extractPlan } from './roundtrip.mjs';

export { readStdin, extractPlan };
import {
  validateDocument,
  degradeToProse,
  validateEnvelope,
  checkBaseRevision,
  renderOpsHuman,
} from '../schema/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the prebuilt single-file SPA (committed; built offline by
 * `npm run build:editor`). Resolved from this module so the binary works from
 * any cwd.
 */
const SPA_HTML_PATH = resolve(__dirname, '../../plugin/dist/index.html');

// ---------------------------------------------------------------------------
// Tuned directive preamble (design.md §2 "Strong-directive deny preamble";
// plannotator prompts.ts:41-42 — soft phrasing was empirically ignored by
// agents, so the firmness is deliberate and load-bearing).
// ---------------------------------------------------------------------------
const REVISE_DIRECTIVE = `\
YOUR PLAN WAS NOT APPROVED. You MUST revise it and re-call ExitPlanMode.

Do NOT proceed with the previous plan. Address the feedback below, then
re-emit the FULL v1 block document (raw JSON only — no markdown fences).`;

// ---------------------------------------------------------------------------
// stdin (production-hardened — US-013): readStdin + extractPlan now live in
// ./roundtrip.mjs (moved verbatim, imported + re-exported above so this hook's
// behaviour is byte-identical and the PRD-mode handler reuses the same code).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plan → canonical document (AC-2)
// ---------------------------------------------------------------------------

/**
 * Turn the raw `tool_input.plan` text into the canonical v1 document.
 *
 * - If `plan` parses as JSON AND validates against the v1 schema → use as-is.
 * - Otherwise (non-JSON, or JSON that fails validation) → degradeToProse():
 *   exactly ONE prose block, meta.degraded = true. The user is NEVER blocked
 *   by malformed agent output (design.md §5).
 *
 * Pure: no network, no model. `degradeToProse` reads the clock once for
 * `createdAt`; deterministic overrides are injectable for tests.
 *
 * @param {string} planText
 * @param {{ id?: string, createdAt?: string }} [degradeOpts]
 * @returns {import('../schema/types').Document}
 */
export function planToDocument(planText, degradeOpts = {}) {
  const text = typeof planText === 'string' ? planText : '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON at all → degraded prose.
    return degradeToProse(text, degradeOpts);
  }
  // validateDocument is pure and zero-dep, but treat ANY throw as "not a
  // valid v1 doc" so a pathological parsed value can never escape the hook
  // (US-013: never throw out of the handler).
  let result;
  try {
    result = validateDocument(parsed);
  } catch {
    return degradeToProse(text, degradeOpts);
  }
  if (result && result.ok) return result.doc;
  // JSON but not a valid v1 doc → degraded prose (wrap the original text).
  return degradeToProse(text, degradeOpts);
}

// ---------------------------------------------------------------------------
// (id, kind, title) echo table — design.md §6 mechanism #2 (REQUIRED here)
// ---------------------------------------------------------------------------

/**
 * Derive a short human label for a block to put in the echo table's `title`
 * column. Each v1 kind carries its identity in a different field; pick the
 * most title-like one and clip it so the table stays scannable.
 *
 * @param {Record<string, unknown>} block
 * @returns {string}
 */
function blockTitle(block) {
  const candidate =
    block.title ??
    block.text ??
    block.question ??
    block.description ??
    block.md ??
    '';
  const s = typeof candidate === 'string' ? candidate : String(candidate ?? '');
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

/**
 * Render the current document's blocks as the `(id, kind, title)` echo table.
 *
 * design.md §6 mechanism #2: "On revise, the structured feedback includes the
 * current (id, kind, title) table so the agent has the exact IDs to reuse —
 * it is not recalling from memory." Reuse every id verbatim.
 *
 * @param {import('../schema/types').Document} doc
 * @returns {string}
 */
export function renderEchoTable(doc) {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const rows = blocks.map((b) => {
    const id = typeof b.id === 'string' ? b.id : String(b.id ?? '');
    const kind = typeof b.kind === 'string' ? b.kind : String(b.kind ?? '');
    return `| ${id} | ${kind} | ${blockTitle(b)} |`;
  });
  return [
    '## Current block (id, kind, title) table — REUSE THESE IDS',
    '',
    'When you re-emit the document, REUSE the `id` of every block whose intent',
    'is unchanged. Only mint a new `id` for a genuinely new block. NEVER',
    'renumber. The exact current ids are below — copy them verbatim:',
    '',
    '| id | kind | title |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * Build the full `deny.message` for the revise path.
 *
 * US-015 / Step 2f.4 scope (AC-5): tuned directive preamble
 *   + human-readable rendering of the FeedbackEnvelope ops (the part DEFERRED
 *     from US-008 Step 2-thin.2 — implemented now)
 *   + the (id, kind, title) echo table (reused from US-008, design.md §6 #2)
 *   + canonical JSON of the current document.
 *
 * The envelope is OPTIONAL: the US-008 two-arg call shape
 * `buildReviseMessage(doc, userFeedback)` stays valid (no envelope → no ops
 * section, identical output to the thin loop). When a validated
 * `FeedbackEnvelope` is supplied its ops are spelled out as explicit
 * directives (design.md §4: the agent is text-in/text-out and cannot diff
 * JSON itself). Round-trip (AC-9): the canonical JSON block recovers the
 * exact document; the envelope ops are recoverable from the rendered section.
 *
 * @param {import('../schema/types').Document} doc
 * @param {string} [userFeedback]  Optional free-text reviewer feedback.
 * @param {import('../schema/types').FeedbackEnvelope} [envelope]
 *   Optional validated envelope whose ops are rendered human-readably (AC-5).
 * @returns {string}
 */
export function buildReviseMessage(doc, userFeedback, envelope) {
  const parts = [REVISE_DIRECTIVE];
  if (typeof userFeedback === 'string' && userFeedback.trim().length > 0) {
    parts.push('', '## Reviewer feedback', '', userFeedback.trim());
  }
  if (envelope && Array.isArray(envelope.ops)) {
    parts.push('', renderOpsHuman(envelope));
  }
  parts.push('', renderEchoTable(doc));
  parts.push(
    '',
    '## Current canonical document (revise from THIS exact JSON)',
    '',
    '```json',
    JSON.stringify(doc, null, 2),
    '```',
  );
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// baseRevision race guard wired into the deny decision (AC-9, AC-10)
// ---------------------------------------------------------------------------

/**
 * Strong-directive preamble emitted INSTEAD of applying stale ops when the
 * `baseRevision` race guard trips (AC-10, design.md §6 #4). The human edited
 * an older revision; we MUST NOT apply those ops — re-render against the
 * current canonical document and let the human re-review.
 */
const STALE_OPS_DIRECTIVE = `\
YOUR PLAN WAS NOT APPROVED. The review was made against an OLDER revision of
the document than the current canonical one — the human's edits are STALE and
were NOT applied (race guard, design.md §6).

Do NOT proceed. Re-emit the FULL v1 block document below UNCHANGED so the
human can re-review the current revision. Do not invent changes from the
stale feedback.`;

/**
 * Turn a resolved server payload into the final deny/allow decision, applying
 * the `baseRevision` race guard (AC-10) and serializing the FeedbackEnvelope
 * into the deny message (AC-5, AC-9).
 *
 * Resolution rules:
 *  - approve (no deny behavior)                → { behavior: 'allow' }
 *  - deny + valid envelope, baseRevision OK    → deny.message =
 *        directive + rendered ops + echo table + canonical JSON
 *  - deny + valid envelope, baseRevision STALE → deny.message =
 *        STALE directive + echo table + canonical JSON; ops NOT applied,
 *        a re-render is signaled (the guard result is returned for callers
 *        that want to act on it without re-parsing the message).
 *  - deny + no/invalid envelope (thin-loop / scripted harness) → falls back
 *        to the US-008 directive + echo table + canonical JSON path, threading
 *        any free-text `feedback`/`message`. Backward compatible.
 *
 * Pure: no network, no model, no clock. The race guard is testable in
 * isolation via {@link checkBaseRevision} (re-exported from the schema barrel).
 *
 * @param {import('../schema/types').Document} doc  Canonical current document.
 * @param {Record<string, unknown>} resolved        Server-resolved POST payload.
 * @returns {{ behavior: 'allow' }
 *          | { behavior: 'deny', message: string,
 *              guard?: import('../schema/types').BaseRevisionCheck,
 *              envelopeErrors?: string[] }}
 */
export function buildDecision(doc, resolved) {
  if (!resolved || resolved.behavior !== 'deny') {
    return { behavior: 'allow' };
  }

  const freeText =
    typeof resolved.feedback === 'string'
      ? resolved.feedback
      : typeof resolved.message === 'string'
        ? resolved.message
        : undefined;

  // Locate the structured FeedbackEnvelope, if any. Three POST shapes reach
  // here, in priority order:
  //   1. The real SPA (US-014/US-017) — `src/editor/envelope.ts` fetchTransport
  //      POSTs the BARE envelope object as the request body, so the server
  //      spreads its fields onto `resolved` directly (resolved.decision /
  //      .documentId / .baseRevision / .ops). This is the production path.
  //   2. An explicit `{ envelope: {...} }` wrapper (used by isolated callers /
  //      envelope.test.mjs) — kept working, takes precedence when present.
  //   3. The thin-loop scripted harness posts only `{ feedback }` (no
  //      envelope) — US-008 backward-compatible path below.
  // The bare-envelope shape is identified structurally by its required §4
  // fields so it is never confused with the thin-loop `{ feedback }` POST.
  const looksLikeBareEnvelope =
    resolved.envelope === undefined &&
    typeof resolved.documentId === 'string' &&
    Array.isArray(resolved.ops) &&
    typeof resolved.baseRevision === 'number';
  const rawEnvelope =
    resolved.envelope !== undefined
      ? resolved.envelope
      : looksLikeBareEnvelope
        ? {
            decision: resolved.decision,
            documentId: resolved.documentId,
            baseRevision: resolved.baseRevision,
            ops: resolved.ops,
            ...(resolved.globalComment !== undefined
              ? { globalComment: resolved.globalComment }
              : {}),
          }
        : undefined;

  if (rawEnvelope === undefined) {
    // No envelope (thin loop / scripted) — US-008 backward-compatible path.
    return {
      behavior: 'deny',
      message: buildReviseMessage(doc, freeText),
    };
  }

  const result = validateEnvelope(rawEnvelope);
  if (!result.ok) {
    // Malformed envelope MUST NOT block the loop — degrade to the directive +
    // echo table + canonical JSON, surfacing the field-level errors so the
    // agent (and tests) can see exactly why the envelope was rejected.
    const errFeedback = [
      freeText && freeText.trim().length > 0 ? freeText.trim() : null,
      'The structured feedback envelope was malformed and could not be',
      'applied. Validator errors:',
      ...result.errors.map((e) => `- ${e}`),
    ]
      .filter(Boolean)
      .join('\n');
    return {
      behavior: 'deny',
      message: buildReviseMessage(doc, errFeedback),
      envelopeErrors: result.errors,
    };
  }

  const envelope = result.envelope;
  const canonicalRevision =
    doc && doc.meta && typeof doc.meta.revision === 'number'
      ? doc.meta.revision
      : NaN;
  const guard = checkBaseRevision(canonicalRevision, envelope.baseRevision);

  if (guard.stale) {
    // AC-10: stale ops are NOT applied — signal a re-render. The message
    // carries the STALE directive + echo table + canonical JSON only (NO
    // rendered ops — they would mislead the agent into applying stale edits).
    const parts = [STALE_OPS_DIRECTIVE];
    if (freeText && freeText.trim().length > 0) {
      parts.push('', '## Original reviewer feedback (stale — context only)', '', freeText.trim());
    }
    parts.push('', renderEchoTable(doc));
    parts.push(
      '',
      '## Current canonical document (re-render — DO NOT change)',
      '',
      '```json',
      JSON.stringify(doc, null, 2),
      '```',
    );
    return { behavior: 'deny', message: parts.join('\n'), guard };
  }

  // baseRevision matches → apply: serialize the envelope into the deny
  // message (directive + rendered ops + echo table + canonical JSON).
  return {
    behavior: 'deny',
    message: buildReviseMessage(
      doc,
      typeof envelope.globalComment === 'string' ? undefined : freeText,
      envelope,
    ),
    guard,
  };
}

// ---------------------------------------------------------------------------
// Decision → PermissionRequest hook envelope (design.md §3)
// ---------------------------------------------------------------------------

/**
 * Wrap a resolved server decision into the exact PermissionRequest hook
 * output shape (design.md §3 lines 90-92):
 *
 *   approve → { hookSpecificOutput: { hookEventName: "PermissionRequest",
 *                                     decision: { behavior: "allow" } } }
 *   revise  → decision.behavior = "deny", decision.message = <directive+table>
 *
 * The server resolves `decisionPromise` with `{ behavior, ...payload }`. For
 * the deny path the caller supplies the fully-built revise message; for the
 * allow path no message is emitted.
 *
 * @param {{ behavior: 'allow' | 'deny', message?: string }} resolved
 * @returns {{ hookSpecificOutput: { hookEventName: string, decision: object } }}
 */
export function toPermissionRequestOutput(resolved) {
  const behavior = resolved.behavior === 'deny' ? 'deny' : 'allow';
  /** @type {{ behavior: string, message?: string }} */
  const decision = { behavior };
  if (behavior === 'deny' && typeof resolved.message === 'string') {
    decision.message = resolved.message;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision,
    },
  };
}

// ---------------------------------------------------------------------------
// Real cross-platform browser opener (US-014 / AC-3, AC-17)
// ---------------------------------------------------------------------------
//
// AC-17 boundary (documented, load-bearing — the US-021 import-graph / runtime
// assertion checks this): opening a browser is NOT a model call and NOT an
// agent spawn. It is a single fire-and-forget `child_process.spawn` of the
// host OS URL opener (`open` / `xdg-open` / `cmd /c start`) with the local
// loopback SPA URL as its only argument. It performs:
//   - NO network egress from this process (the OS opener may itself talk to a
//     browser, but bin/planos exit makes zero outbound sockets — the AC-17
//     socket-connect spy in the tests proves this),
//   - NO model / agent invocation (the spawned process is the OS file/URL
//     handler, never `claude`/an agent runtime),
//   - it is detached + unref'd so it never keeps the blocking hook alive and
//     never blocks the flush-then-exit-0 ordering.
// The seam stays injectable; tests inject a no-op so the harness NEVER spawns
// a real browser. This default impl is only reached on the real plugin path.

/**
 * Open `url` in the user's default browser, cross-platform. Fire-and-forget:
 * spawn errors are swallowed (a missing opener must NOT block the hook or
 * crash the user — the URL is also printed to stderr as a fallback).
 *
 * @param {string} url  Loopback SPA URL (http://127.0.0.1:<port>).
 * @returns {void}
 */
export function openBrowserReal(url) {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    // `start` is a cmd builtin; the empty "" is the window-title arg so a URL
    // with characters is not mis-parsed as the title.
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });
    // Never let a missing opener throw out of the hook.
    child.on('error', () => {});
    // Do not keep the blocking hook process alive on the opener.
    if (typeof child.unref === 'function') child.unref();
  } catch {
    // Spawn itself threw (e.g. opener binary absent) — degrade silently; the
    // URL fallback below still lets the user reach the review UI.
  }
  try {
    process.stderr.write(`[planos] review UI: ${url}\n`);
  } catch {
    /* best-effort; never throw out of the opener */
  }
}

// ---------------------------------------------------------------------------
// Real-SPA serving (US-014 — serve the prebuilt single-file editor)
// ---------------------------------------------------------------------------

/**
 * Read the prebuilt single-file SPA and inline the canonical document into it
 * as `window.__PLANOS_DOC__` so the editor renders the real plan with zero
 * network round-trip (the loader's first resolution branch). `/api/plan` is
 * ALSO exposed (loader's second branch) for defense-in-depth. If the built
 * file is missing (editor not built yet) we fall back to a minimal shell that
 * still resolves via `/api/plan` — the user is never blocked.
 *
 * Pure read of a committed local file; no network, no model.
 *
 * @param {import('../schema/types').Document} doc
 * @returns {string}
 */
export function buildSpaHtml(doc) {
  let html;
  try {
    html = readFileSync(SPA_HTML_PATH, 'utf8');
  } catch {
    // Editor bundle not present — minimal shell; loader falls back to
    // GET /api/plan which we still serve.
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>planos</title></head><body><div id="root">' +
      'Loading plan… (SPA bundle not built — using /api/plan)</div>' +
      '</body></html>'
    );
  }
  // Inline the doc just before </head> so the loader's window.__PLANOS_DOC__
  // branch resolves first. JSON.stringify is safe to embed in a <script>
  // provided we neutralize the `</script>` sequence.
  const inline =
    `<script>window.__PLANOS_DOC__=` +
    JSON.stringify(doc).replace(/<\/(script)/gi, '<\\/$1') +
    `;</script>`;
  // Anchor on the LAST `</head>` — the document's real closing head tag. The
  // minified single-file bundle inlines third-party source (DOMPurify/mermaid)
  // that contains `</head>` string literals INSIDE the `<script type="module">`;
  // `String.replace('</head>', …)` would match the first such literal and
  // splice the inline `<script>…;</script>` into the middle of the module
  // bundle, prematurely closing it and dumping the rest as raw text. The real
  // `</head>` always follows the entire inlined script, so it is the last
  // occurrence. slice()+concat also avoids `String.replace`'s `$&`/`$$`
  // replacement-pattern interpretation on the embedded JSON doc.
  const idx = html.lastIndexOf('</head>');
  if (idx !== -1) {
    return html.slice(0, idx) + inline + html.slice(idx);
  }
  // No </head> (unexpected) — prepend; the loader still picks it up.
  return inline + html;
}

/**
 * Build the read-only `/api/plan*` handler map for the real-SPA path.
 *
 * Endpoints (minimal — AC-14's diff engine already exists; this only SURFACES
 * the current + previous revisions so the SPA's revision selector can switch
 * the diff base):
 *   - GET /api/plan            → { plan, doc, origin, previousPlan, versionInfo }
 *   - GET /api/plan/versions   → { versions: [{ v, revision }, ...] }
 *   - GET /api/plan/version?v=N→ { plan } for revision N (current or previous)
 *
 * `previousDoc` is optional (the prior revision for the diff base). When
 * absent only the current revision is offered. All handlers are pure and
 * read-only (no decision resolution, no egress).
 *
 * @param {import('../schema/types').Document} doc          Current canonical doc.
 * @param {import('../schema/types').Document} [previousDoc] Prior revision, if any.
 * @returns {Record<string, (req: import('node:http').IncomingMessage) => object>}
 */
export function buildPlanApiHandlers(doc, previousDoc) {
  const currentRev =
    doc && doc.meta && typeof doc.meta.revision === 'number'
      ? doc.meta.revision
      : 1;
  const prevRev =
    previousDoc && previousDoc.meta && typeof previousDoc.meta.revision === 'number'
      ? previousDoc.meta.revision
      : undefined;

  const versions = [];
  if (previousDoc) versions.push({ v: prevRev, revision: prevRev, doc: previousDoc });
  versions.push({ v: currentRev, revision: currentRev, doc });

  return {
    'GET /api/plan': () => ({
      json: {
        plan: doc,
        doc,
        origin: 'planos',
        previousPlan: previousDoc || null,
        versionInfo: {
          revision: currentRev,
          previousRevision: prevRev ?? null,
          versions: versions.map((x) => ({ v: x.v, revision: x.revision })),
        },
      },
    }),
    'GET /api/plan/versions': () => ({
      json: { versions: versions.map((x) => ({ v: x.v, revision: x.revision })) },
    }),
    'GET /api/plan/version': (req) => {
      let v;
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        v = u.searchParams.get('v');
      } catch {
        v = null;
      }
      const want = v == null ? currentRev : Number(v);
      const match = versions.find((x) => x.v === want);
      if (!match) return { status: 404, json: { error: 'no such revision' } };
      return { json: { plan: match.doc } };
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `exit` subcommand — the ExitPlanMode round-trip.
 *
 * TWO modes, one engine (the scripted seam is NOT replaced — the real browser
 * path is an ADDITIONAL mode, US-014):
 *
 *   - SCRIPTED (thin-loop / harness, US-008/013/017): a `decisionProvider` is
 *     injected. A minimal placeholder HTML is served, no `/api/plan*` handlers
 *     are registered, and the injected provider drives an /api/approve|deny
 *     POST so the harness resolves the round-trip deterministically. This is
 *     EXACTLY the US-008 path — unchanged and still covered by
 *     tests/exit-thinloop.test.mjs.
 *
 *   - REAL-SPA (production / US-014): NO `decisionProvider`. The prebuilt
 *     single-file editor (`plugin/dist/index.html`) is served at `/` with the
 *     canonical doc inlined as `window.__PLANOS_DOC__`; `GET /api/plan`,
 *     `/api/plan/versions`, `/api/plan/version` are exposed (read-only) so the
 *     SPA + its revision selector work; the REAL browser opener is invoked;
 *     and we block on `decisionPromise` until the browser POSTs the
 *     FeedbackEnvelope to /api/approve|deny.
 *
 * @param {object} [options]
 * @param {(url: string) => void} [options.openBrowser]
 *   Injectable open-browser seam. Default: the real cross-platform opener
 *   ({@link openBrowserReal}) so the production `bin/planos exit` (no args)
 *   opens the SPA. Tests ALWAYS inject a no-op so the harness NEVER spawns a
 *   real browser (AC-17). Opening a browser is NOT a model/agent call (see the
 *   {@link openBrowserReal} AC-17 boundary note).
 * @param {(ctx: { url: string, doc: import('../schema/types').Document }) => void}
 *   [options.decisionProvider]
 *   Injectable SCRIPTED decision driver (thin-loop/harness). When supplied →
 *   SCRIPTED mode (no SPA, no /api/plan handlers). When omitted → REAL-SPA
 *   mode. Default: undefined (real-SPA).
 * @param {import('../schema/types').Document} [options.previousDoc]
 *   Optional prior revision surfaced to the SPA revision selector (real-SPA
 *   mode only) so the diff base can be switched (src/diff/structural).
 * @param {string} [options.stdinText]
 *   Injectable stdin payload (tests pass it directly instead of piping).
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options.stdinOpts]
 *   Injectable production stdin bounds (US-013): idle/total safety timeout and
 *   the max bytes buffered. Tests use a tiny timeout/cap to exercise the
 *   hung-fd and oversized-payload degradation paths without real I/O.
 * @param {{ id?: string, createdAt?: string }} [options.degradeOpts]
 *   Deterministic overrides forwarded to degradeToProse for tests.
 * @returns {Promise<void>} Resolves only if finish() is stubbed; in
 *   production finish() calls process.exit(0) and never returns.
 */
export async function handleExit(options = {}) {
  const {
    decisionProvider,
    previousDoc,
    stdinText,
    stdinOpts = {},
    degradeOpts = {},
  } = options;

  // SCRIPTED iff a decisionProvider is injected (thin-loop / harness). Real-SPA
  // otherwise (production / US-014). The scripted seam is preserved verbatim.
  const scripted = typeof decisionProvider === 'function';

  // US-006 decided posture — plannotator coexistence guard. Production path
  // ONLY: if a SECOND installed plugin also hooks ExitPlanMode, Claude Code
  // dispatches to ALL matching plugins (deny-wins reconciliation) and two
  // blocking 96h servers cannot coexist — planos REFUSES rather than
  // double-boot (docs/notes/plannotator-coexistence-spike.md). Scripted /
  // harness / live-driver runs (decisionProvider injected) are clean-env by
  // construction and opt out, so the Phase-1 gate and the test suite are
  // unaffected. Detection is pure local-fs (AC-17 safe); injectable for tests.
  if (!scripted) {
    const guard =
      typeof options.coexistenceGuard === 'function'
        ? options.coexistenceGuard
        : coexistenceGuard;
    let colliding = [];
    try {
      colliding = guard({}) || [];
    } catch {
      // Defensive: a guard failure must never block the user — treat as no
      // collision (the documented clean-env assumption holds).
      colliding = [];
    }
    if (colliding.length > 0) {
      const onRefuse =
        typeof options.onRefuse === 'function'
          ? options.onRefuse
          : (msg) => {
              try {
                process.stderr.write(msg + '\n');
              } catch {
                /* best-effort */
              }
              process.exit(1);
            };
      // Refuse WITHOUT booting the server or emitting a stdout decision (do
      // not hijack the PermissionRequest channel in a multi-plugin session).
      return onRefuse(coexistenceRefusalMessage(colliding), colliding);
    }
  }

  // Open-browser default: real opener in real-SPA mode (so `bin/planos exit`
  // with no args opens the editor); no-op default in scripted mode (the
  // thin-loop never opens a browser). Tests ALWAYS inject their own opener.
  const openBrowser =
    typeof options.openBrowser === 'function'
      ? options.openBrowser
      : scripted
        ? () => {}
        : openBrowserReal;

  // 1. Read stdin and extract tool_input.plan. readStdin() is hardened to
  //    NEVER reject/throw/block indefinitely (US-013): any stream error,
  //    oversized payload, or never-closing fd degrades to the buffered text
  //    (or '') which the prose fallback then wraps. The user is never blocked.
  const raw =
    typeof stdinText === 'string' ? stdinText : await readStdin(stdinOpts);
  const planText = extractPlan(raw);

  // 2. Parse/validate → canonical doc (valid as-is, else prose-degrade).
  //    AC-17: this path imports only node: builtins + local src/ — no model,
  //    no network. The validator and fallback are pure.
  const doc = planToDocument(planText, degradeOpts);

  // 3. Boot the blocking server.
  //    - SCRIPTED: minimal placeholder; decision via the injected provider.
  //    - REAL-SPA: prebuilt editor + inlined doc + read-only /api/plan* so the
  //      browser renders and its revision selector can switch the diff base.
  const serveHtml = scripted
    ? '<!doctype html><html><body>' +
      '<!-- planos scripted/harness mode: no SPA -->' +
      '</body></html>'
    : buildSpaHtml(doc);
  const apiHandlers = scripted ? {} : buildPlanApiHandlers(doc, previousDoc);

  const { decisionPromise, finish } = await startServer({
    onReady: (url) => {
      // Open-browser seam — real opener in real-SPA mode, injected no-op in
      // tests; never an agent/model call (AC-17 boundary documented above).
      openBrowser(url);
      // Scripted decision driver — only in scripted mode (thin-loop/harness).
      if (scripted) decisionProvider({ url, doc });
    },
    serveHtml,
    apiHandlers,
  });

  // 5. BLOCK on the decision promise (in production: up to the 96h hook
  //    timeout; here the scripted provider resolves it deterministically).
  const resolved = await decisionPromise;

  // Build the final decision via buildDecision: it applies the baseRevision
  // race guard (AC-10) and serializes the FeedbackEnvelope into the deny
  // message (AC-5, AC-9). The server merges any POST payload into `resolved`
  // (free-text `feedback`/`message` for the scripted thin loop; a structured
  // `envelope` for the SPA). No envelope → US-008 backward-compatible path.
  const decision = buildDecision(doc, resolved);

  // 4 + 6. Emit the PermissionRequest decision JSON on stdout and honor the
  // flush-then-exit-0 ordering invariant via the server's finish().
  //
  // TODO(US-006 / Step 2f.3 — stdout-decision-ownership): the live
  // multi-plugin coexistence spike (US-006) is BLOCKED/deferred per locked
  // decision #4 — Phase 1 runs in a clean single-plugin environment, so this
  // process is the sole owner of the PermissionRequest stdout decision. If
  // Claude Code is later found to dispatch ExitPlanMode to multiple matching
  // plugins (see docs/notes/plannotator-coexistence-spike.md / AC-21), this
  // exclusive-stdout-ownership assumption must be revisited here. Proceeding
  // with the single-plugin clean-env assumption (do not block on it).
  await finish(toPermissionRequestOutput(decision));
}
