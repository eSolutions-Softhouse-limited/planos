/**
 * planos — shared PRD blocking-round-trip internals.
 *
 * M1 (PRD-only consolidation, ADR-0007): planos was reduced to a SINGLE flow
 * — PRD. The ExitPlanMode roundtrip (`src/hook/exit.mjs`), the EnterPlanMode
 * hook (`src/hook/enter.mjs`) and the diff-review flow (`src/hook/review.mjs`)
 * were removed. The pure, model-free helpers the PRD round-trip handler still
 * needs (plan→document degradation, the deny/revise decision machinery, the
 * (id,kind,title) echo table, the real browser opener, and the prebuilt-SPA
 * HTML builder) were extracted VERBATIM out of the deleted `exit.mjs` into
 * this module so `src/hook/prd.mjs` keeps an identical code path. This is a
 * ZERO-behaviour-change move for the PRD flow.
 *
 * AC-17: this module is reachable from `bin/planos prd` (via prd.mjs). It
 * performs ONLY pure work + local filesystem reads of the committed SPA bundle
 * + a single fire-and-forget OS URL-opener spawn (the documented, load-bearing
 * AC-17 boundary — NOT a model call, NOT an agent spawn, NO network egress
 * from this process). Zero runtime dependencies. ES module.
 */

'use strict';

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  validateDocument,
  degradeToProse,
  validateEnvelope,
  checkBaseRevision,
  renderOpsHuman,
} from '../schema/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the prebuilt single-file SPA (committed; built offline by
 * `npm run build:editor`).
 *
 * The bundle is found at different relative locations depending on how planos
 * runs: in-place from the source repo (`src/hook/` → `../../plugin/dist`), or
 * from an installed plugin package where the layout is flattened (`dist/` a
 * sibling of `bin/`, `src/` vendored alongside). A single hardcoded relative
 * path silently produced the "SPA bundle not built" fallback whenever the
 * install layout differed. Try an ordered candidate list and use the first
 * that exists; `null` only if NONE exist (true missing-bundle).
 *
 * @returns {string|null}
 */
function resolveSpaHtmlPath() {
  const candidates = [
    // Source-repo layout: <root>/src/hook/prd-runtime.mjs → <root>/plugin/dist/…
    resolve(__dirname, '../../plugin/dist/index.html'),
    // Packaged layout: src/ vendored under the plugin → <pkg>/dist/index.html
    resolve(__dirname, '../../dist/index.html'),
    // src/ one level under the plugin (…/plugin/src/hook → …/plugin/dist)
    resolve(__dirname, '../dist/index.html'),
    // Defensive deeper-nesting fallbacks.
    resolve(__dirname, '../../../plugin/dist/index.html'),
    resolve(__dirname, '../../../dist/index.html'),
    // Last resort: relative to the process cwd (repo or plugin root).
    resolve(process.cwd(), 'plugin/dist/index.html'),
    resolve(process.cwd(), 'dist/index.html'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const SPA_HTML_PATH = resolveSpaHtmlPath();

// ---------------------------------------------------------------------------
// Tuned directive preamble (design.md §2 "Strong-directive deny preamble").
// ---------------------------------------------------------------------------
const REVISE_DIRECTIVE = `\
YOUR PRD WAS NOT APPROVED. You MUST revise it and re-run /planos-prd.

Do NOT proceed with the previous PRD. Address the feedback below, then
re-emit the FULL v2 block document (raw JSON only — no markdown fences).`;

// ---------------------------------------------------------------------------
// Plan → canonical document (AC-2)
// ---------------------------------------------------------------------------

/**
 * Turn the raw authored text into the canonical document.
 *
 * - If it parses as JSON AND validates against the schema → use as-is.
 * - Otherwise (non-JSON, or JSON that fails validation) → degradeToProse():
 *   exactly ONE prose block, meta.degraded = true. The user is NEVER blocked
 *   by malformed agent output (design.md §5).
 *
 * Pure: no network, no model. `degradeToProse` reads the clock once for
 * `createdAt`; deterministic overrides are injectable for tests.
 *
 * @param {string} planText
 * @param {{ id?: string, createdAt?: string, type?: string }} [degradeOpts]
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
  // valid doc" so a pathological parsed value can never escape the hook
  // (never throw out of the handler).
  let result;
  try {
    result = validateDocument(parsed);
  } catch {
    return degradeToProse(text, degradeOpts);
  }
  if (result && result.ok) return result.doc;
  // JSON but not a valid doc → degraded prose (wrap the original text).
  return degradeToProse(text, degradeOpts);
}

// ---------------------------------------------------------------------------
// (id, kind, title) echo table — design.md §6 mechanism #2 (REQUIRED here)
// ---------------------------------------------------------------------------

/**
 * Derive a short human label for a block to put in the echo table's `title`
 * column. Each kind carries its identity in a different field; pick the
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
 * Tuned directive preamble + optional human-readable rendering of the
 * FeedbackEnvelope ops + the (id, kind, title) echo table + canonical JSON of
 * the current document.
 *
 * The envelope is OPTIONAL: the two-arg call shape
 * `buildReviseMessage(doc, userFeedback)` stays valid (no envelope → no ops
 * section). When a validated `FeedbackEnvelope` is supplied its ops are
 * spelled out as explicit directives (design.md §4: the agent is
 * text-in/text-out and cannot diff JSON itself).
 *
 * @param {import('../schema/types').Document} doc
 * @param {string} [userFeedback]  Optional free-text reviewer feedback.
 * @param {import('../schema/types').FeedbackEnvelope} [envelope]
 *   Optional validated envelope whose ops are rendered human-readably.
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
YOUR PRD WAS NOT APPROVED. The review was made against an OLDER revision of
the document than the current canonical one — the human's edits are STALE and
were NOT applied (race guard, design.md §6).

Do NOT proceed. Re-emit the FULL v2 block document below UNCHANGED so the
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
 *        STALE directive + echo table + canonical JSON; ops NOT applied
 *  - deny + no/invalid envelope (scripted harness) → falls back to the
 *        directive + echo table + canonical JSON path, threading any free-text
 *        `feedback`/`message`. Backward compatible.
 *
 * Pure: no network, no model, no clock.
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
  //   1. The real SPA — `src/editor/envelope.ts` fetchTransport POSTs the BARE
  //      envelope object as the request body, so the server spreads its fields
  //      onto `resolved` directly (resolved.decision / .documentId /
  //      .baseRevision / .ops). This is the production path.
  //   2. An explicit `{ envelope: {...} }` wrapper (used by isolated callers /
  //      envelope.test.mjs) — kept working, takes precedence when present.
  //   3. The scripted harness posts only `{ feedback }` (no envelope) — the
  //      backward-compatible path below.
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
    // No envelope (scripted) — backward-compatible path.
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
// Real cross-platform browser opener (AC-3, AC-17)
// ---------------------------------------------------------------------------
//
// AC-17 boundary (documented, load-bearing): opening a browser is NOT a model
// call and NOT an agent spawn. It is a single fire-and-forget
// `child_process.spawn` of the host OS URL opener (`open` / `xdg-open` /
// `cmd /c start`) with the local loopback SPA URL as its only argument. It
// performs NO network egress from this process, NO model/agent invocation, and
// it is detached + unref'd so it never keeps the blocking hook alive. The seam
// stays injectable; tests inject a no-op so the harness NEVER spawns a real
// browser. This default impl is only reached on the real plugin path.

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
// Real-SPA serving (serve the prebuilt single-file editor)
// ---------------------------------------------------------------------------

/**
 * Self-contained degraded view, served ONLY when the prebuilt SPA bundle
 * cannot be located at runtime (install layout differs / editor not built).
 *
 * It is fully self-contained: it inlines the document (both as
 * `window.__PLANOS_DOC__` for a future bundle and as escaped, human-readable
 * JSON) so the reviewer can always SEE the content and approve via the CLI —
 * it makes ZERO network calls and never hangs.
 *
 * Pure string build; no fs, no network, no model.
 *
 * @param {import('../schema/types').Document} doc
 * @returns {string}
 */
export function buildDegradedHtml(doc) {
  const safeJson = JSON.stringify(doc, null, 2).replace(/[<&]/g, (c) =>
    c === '<' ? '&lt;' : '&amp;',
  );
  const inlineDoc =
    `<script>window.__PLANOS_DOC__=` +
    JSON.stringify(doc).replace(/<\/(script)/gi, '<\\/$1') +
    `;</script>`;
  const safeTitle = String((doc && doc.title) || 'planos document').replace(
    /[<&]/g,
    (c) => (c === '<' ? '&lt;' : '&amp;'),
  );
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>planos — degraded view</title>' +
    '<style>html,body{margin:0;padding:0}*,*::before,*::after{box-sizing:border-box}' +
    'body{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:#0d1117;color:#e6edf3;padding:24px}' +
    'h1{font:600 16px system-ui;margin:0 0 4px}' +
    '.note{color:#f0b72f;font:13px system-ui;margin:0 0 16px}' +
    'pre{background:#161b22;border:1px solid #30363d;border-radius:8px;' +
    'padding:16px;overflow:auto;white-space:pre-wrap;word-break:break-word}</style>' +
    inlineDoc +
    '</head><body><div id="root">' +
    `<h1>${safeTitle}</h1>` +
    '<p class="note">SPA bundle could not be located — showing the ' +
    'structured document directly (read-only degraded view). Approve / ' +
    'request changes via the CLI.</p>' +
    `<pre>${safeJson}</pre>` +
    '</div></body></html>'
  );
}

/**
 * Read the prebuilt single-file SPA and inline the canonical document into it
 * as `window.__PLANOS_DOC__` so the editor renders the real document with zero
 * network round-trip (the loader's first resolution branch). If the built file
 * cannot be located (install layout differs / editor not built) we fall back
 * to {@link buildDegradedHtml}: a SELF-CONTAINED read-only view that inlines
 * the doc — it never hangs. The user is never blocked.
 *
 * Pure read of a committed local file; no network, no model.
 *
 * @param {import('../schema/types').Document} doc
 * @returns {string}
 */
export function buildSpaHtml(doc) {
  let html = null;
  if (typeof SPA_HTML_PATH === 'string') {
    try {
      html = readFileSync(SPA_HTML_PATH, 'utf8');
    } catch {
      html = null;
    }
  }
  if (html === null) {
    return buildDegradedHtml(doc);
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
