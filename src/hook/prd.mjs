/**
 * planos — PRD-mode round-trip handler (the SINGLE planos flow, ADR-0007).
 *
 * Contract: planos-phase2-plan.md §6 (AC-P7, AC-P8, AC-P10 round-trip half,
 * AC-P12), Resolved Decisions (D4 = stdin handoff; D1 layout in
 * src/prd/store.mjs). M1 (ADR-0007) removed the plan/diff-review flows; PRD
 * is now the only round-trip.
 *
 * Topology (design.md §3 — command → blocking CLI, NOT a hook):
 *
 *   /planos-prd interview + v2 authoring  (live-agent CLI surface — AC-17
 *   pre-server, allowed)                    runs BEFORE this handler boots
 *      ↓ pipes authored v2 JSON via stdin   the server (D4 = stdin)
 *   bin/planos prd → handlePrd():
 *      1. read authored doc from stdin (reuse readStdin/extractPlan)
 *      2. validate as v2 PRD → planToDocument; degradeToProse fallback
 *         (degradeOpts.type = "prd" so a degraded PRD stays type:"prd")
 *      3. load the prior persisted revision (src/prd/store.mjs) for the diff
 *         base + the new revision number
 *      4. startServer() → real SPA + read-only /api/prd* (full chain) + the
 *         injectable browser opener + the SCRIPTED decisionProvider seam
 *         (so tests stay offline)
 *      5. BLOCK on decisionPromise
 *      6. APPROVE  → saveRevision (persist the new immutable revision) +
 *                    emit success JSON
 *         REVISE   → buildReviseMessage (directive + (id,kind,title) echo
 *                    table + canonical JSON); baseRevision race guard reused
 *      7. flush-then-exit-0 via the server's finish()
 *
 * AC-17 (RE-ASSERTED, not weakened): the blocking path
 *   bin/planos prd → src/hook/prd.mjs → src/hook/prd-runtime.mjs →
 *   src/server → src/schema → src/diff → src/prd/store.mjs
 * has ZERO network egress, ZERO agent spawn, ZERO agent-SDK import.
 * src/prd/store.mjs is filesystem-only (node:fs/node:path) — its fs writes are
 * explicitly in-scope-allowed (filesystem ≠ network/model, same boundary as
 * the openBrowserReal note in src/hook/prd-runtime.mjs). The browser opener is
 * the injectable seam (tests inject a no-op); the SCRIPTED decisionProvider
 * seam keeps the harness fully offline (no SPA, no /api/prd handlers).
 *
 * Zero runtime dependencies. ES module. No network, no model, no spawn.
 */

'use strict';

import { startServer } from '../server/index.mjs';
import { readStdin, extractPlan } from './roundtrip.mjs';
import {
  planToDocument,
  buildDecision,
  toPermissionRequestOutput,
  buildSpaHtml,
  openBrowserReal,
} from './prd-runtime.mjs';
import { loadLatest, saveRevision } from '../prd/store.mjs';

// ---------------------------------------------------------------------------
// PRD persisted-chain read-only API (AC-P12) — full chain, not current+prev.
// ---------------------------------------------------------------------------

/**
 * Build the read-only `/api/prd*` handler map for the real-SPA path.
 *
 * Unlike `buildPlanApiHandlers` (which only surfaces current + previous), the
 * PRD handlers serve the FULL persisted revision chain so the multi-revision
 * history browser can pick ANY revision as the view and ANY earlier revision
 * as the diff base (AC-P12, D2 minimal scope):
 *
 *   - GET /api/prd            → { plan, doc, origin, previousPlan, versionInfo }
 *   - GET /api/prd/versions   → { versions: [{ v, revision }, ...] } (all)
 *   - GET /api/prd/version?v=N→ { plan } for ANY persisted revision N
 *
 * `chain` is the array of every persisted revision document (any order); it is
 * sorted ascending by `meta.revision` here. `doc` is the current (just-authored
 * or just-persisted) canonical document — it is folded into the chain so the
 * SPA can render it even before it is persisted. All handlers are pure and
 * read-only (no decision resolution, no egress).
 *
 * @param {import('../schema/types').Document} doc   Current canonical doc.
 * @param {import('../schema/types').Document[]} [chain] All persisted revisions.
 * @returns {Record<string, (req: import('node:http').IncomingMessage) => object>}
 */
export function buildPrdApiHandlers(doc, chain = []) {
  const currentRev =
    doc && doc.meta && typeof doc.meta.revision === 'number'
      ? doc.meta.revision
      : 1;

  // Fold every persisted revision + the current doc into one revision map,
  // keyed by meta.revision. The current doc wins for its own revision number
  // (it is the freshest copy of that revision).
  const byRev = new Map();
  for (const d of Array.isArray(chain) ? chain : []) {
    const r =
      d && d.meta && typeof d.meta.revision === 'number'
        ? d.meta.revision
        : null;
    if (r === null) continue;
    byRev.set(r, d);
  }
  byRev.set(currentRev, doc);

  const versions = [...byRev.entries()]
    .map(([revision, d]) => ({ v: revision, revision, doc: d }))
    .sort((a, b) => a.revision - b.revision);

  // The diff base = the highest persisted revision strictly below the current
  // one (the immediate predecessor in the chain), if any.
  const prev =
    versions
      .filter((x) => x.revision < currentRev)
      .sort((a, b) => b.revision - a.revision)[0] || null;

  return {
    'GET /api/prd': () => ({
      json: {
        plan: doc,
        doc,
        origin: 'planos-prd',
        previousPlan: prev ? prev.doc : null,
        versionInfo: {
          revision: currentRev,
          previousRevision: prev ? prev.revision : null,
          versions: versions.map((x) => ({ v: x.v, revision: x.revision })),
        },
      },
    }),
    'GET /api/prd/versions': () => ({
      json: { versions: versions.map((x) => ({ v: x.v, revision: x.revision })) },
    }),
    'GET /api/prd/version': (req) => {
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
 * Handle the `prd` subcommand — the command → blocking-CLI PRD round-trip.
 *
 * TWO modes, one engine — the harness drives the round-trip offline:
 *
 *   - SCRIPTED (harness, AC-P7/P8/P10/P12): a `decisionProvider` is injected.
 *     A minimal placeholder HTML is served, no `/api/prd*` handlers are
 *     registered, and the injected provider drives an /api/approve|deny POST so
 *     the harness resolves the round-trip deterministically + fully offline.
 *
 *   - REAL-SPA (production): NO `decisionProvider`. The prebuilt single-file
 *     editor is served at `/` with the canonical doc inlined; the full
 *     persisted chain is exposed read-only via `/api/prd*`; the REAL browser
 *     opener is invoked; and we block on `decisionPromise` until the browser
 *     POSTs the FeedbackEnvelope to /api/approve|deny.
 *
 * On APPROVE the just-authored document is persisted as a NEW immutable
 * revision via {@link saveRevision} (the revision number is carried by
 * `doc.meta.revision`, incremented from the prior persisted revision); a
 * PRD-shaped success JSON is then emitted. On REVISE the standard
 * deny-message machinery ({@link buildDecision} → directive + (id,kind,title)
 * echo table + canonical JSON) is reused VERBATIM, so the
 * baseRevision race guard (AC-P8) fires identically.
 *
 * @param {object} [options]
 * @param {(url: string) => void} [options.openBrowser]
 *   Injectable open-browser seam. Default: the real cross-platform opener in
 *   real-SPA mode; a no-op in scripted mode. Tests ALWAYS inject their own.
 * @param {(ctx: { url: string, doc: import('../schema/types').Document }) => void}
 *   [options.decisionProvider]
 *   Injectable SCRIPTED decision driver. Supplied → SCRIPTED mode (no SPA, no
 *   /api/prd handlers). Omitted → REAL-SPA mode.
 * @param {string} [options.rootDir]
 *   PRD persistence root (the dir that holds `prds/`). Default: process.cwd().
 *   Tests pass a tmpdir so the repo's real prds/ is never touched.
 * @param {string} [options.stdinText]
 *   Injectable stdin payload (tests pass it directly instead of piping).
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options.stdinOpts]
 *   Injectable production stdin bounds (US-013).
 * @param {{ id?: string, createdAt?: string, type?: string }} [options.degradeOpts]
 *   Deterministic overrides forwarded to degradeToProse for tests. `type`
 *   defaults to "prd" here so a degraded PRD stays a PRD document.
 * @param {(decision: object) => Promise<void>|void} [options.finishOverride]
 *   Test-only finish() override (in production finish() exits the process).
 * @returns {Promise<void>}
 */
export async function handlePrd(options = {}) {
  const {
    decisionProvider,
    stdinText,
    stdinOpts = {},
    degradeOpts = {},
    finishOverride,
  } = options;

  const rootDir =
    typeof options.rootDir === 'string' && options.rootDir.length > 0
      ? options.rootDir
      : process.cwd();

  // SCRIPTED iff a decisionProvider is injected (harness). Real-SPA otherwise
  // (production).
  const scripted = typeof decisionProvider === 'function';

  const openBrowser =
    typeof options.openBrowser === 'function'
      ? options.openBrowser
      : scripted
        ? () => {}
        : openBrowserReal;

  // 1. Read stdin and extract tool_input.plan (D4 = stdin handoff). readStdin
  //    is the production-hardened shared reader (./roundtrip.mjs) — NEVER
  //    rejects/throws/blocks indefinitely.
  const raw =
    typeof stdinText === 'string' ? stdinText : await readStdin(stdinOpts);
  const planText = extractPlan(raw);

  // 2. Parse/validate → canonical doc. A degraded PRD must stay type:"prd"
  //    (AC-P3 / D5) so we thread type:"prd" into the degrade overrides unless
  //    the caller pinned one explicitly. planToDocument is the shared pure
  //    function (validate-as-is, else prose-degrade).
  const prdDegradeOpts = { type: 'prd', ...degradeOpts };
  const authored = planToDocument(planText, prdDegradeOpts);

  // 3. Load the prior persisted revision (diff base) keyed by the stable doc
  //    id. Pure node:fs read (src/prd/store.mjs) — AC-17-clean. Missing → null.
  let prior = null;
  try {
    prior =
      typeof authored.id === 'string' && authored.id.length > 0
        ? loadLatest(rootDir, authored.id)
        : null;
  } catch {
    // A hostile/invalid id only throws from prdPath; never block the round-trip
    // on a persistence-read failure — proceed with no diff base.
    prior = null;
  }

  // The new revision is the prior persisted revision + 1 (monotonic,
  // append-only — AC-P10). A degraded/first PRD starts at revision 1. The
  // document's own meta.revision is normalised so saveRevision writes rNNN
  // matching the chain (the agent-authored revision is advisory only — the
  // persisted chain is the source of truth for monotonicity).
  const nextRevision =
    prior && typeof prior.revision === 'number' ? prior.revision + 1 : 1;
  const doc = {
    ...authored,
    meta: { ...authored.meta, revision: nextRevision },
  };
  const previousDoc = prior ? prior.doc : undefined;

  // 4. Boot the blocking server (SCRIPTED placeholder vs REAL-SPA + /api/prd*).
  const serveHtml = scripted
    ? '<!doctype html><html><body>' +
      '<!-- planos PRD scripted/harness mode: no SPA -->' +
      '</body></html>'
    : buildSpaHtml(doc);
  const apiHandlers = scripted
    ? {}
    : buildPrdApiHandlers(doc, previousDoc ? [previousDoc] : []);

  const { decisionPromise, finish } = await startServer({
    onReady: (url) => {
      openBrowser(url);
      if (scripted) decisionProvider({ url, doc });
    },
    serveHtml,
    apiHandlers,
  });

  // 5. BLOCK on the decision promise.
  const resolved = await decisionPromise;

  // Reuse the decision machinery: buildDecision applies the baseRevision race
  // guard (AC-P8) and serialises any FeedbackEnvelope into the deny message.
  // No envelope → backward-compatible directive + echo table + canonical JSON.
  const decision = buildDecision(doc, resolved);

  // 6. APPROVE → persist a NEW immutable revision (append-only) + emit a
  //    PRD-shaped success JSON. REVISE → emit the deny/revise PermissionRequest
  //    output. Persistence is pure node:fs.
  let output;
  if (decision.behavior === 'deny') {
    output = toPermissionRequestOutput(decision);
  } else {
    let savedPath = null;
    let persistError = null;
    try {
      savedPath = saveRevision(rootDir, doc);
    } catch (err) {
      // An append-only / path violation must NOT crash the round-trip — the
      // decision still resolves; surface the error in the success payload so
      // the agent/tests can see it (the user is never blocked).
      persistError = err && err.message ? err.message : String(err);
    }
    // M2 Defect 1: when the reviewer approved BUT also left feedback,
    // buildDecision returns the allow with a rendered `message` (approve
    // directive + ops + echo table). Carry it on the decision so the
    // approved-with-notes feedback actually reaches the agent instead of
    // being silently discarded. A clean approve has no message → bare allow.
    const approveDecision =
      typeof decision.message === 'string' && decision.message.length > 0
        ? { behavior: 'allow', message: decision.message }
        : { behavior: 'allow' };
    output = {
      hookSpecificOutput: {
        hookEventName: 'PrdRoundTrip',
        decision: approveDecision,
        prd: {
          documentId: doc.id,
          revision: doc.meta.revision,
          persisted: savedPath !== null,
          ...(savedPath !== null ? { path: savedPath } : {}),
          ...(persistError !== null ? { error: persistError } : {}),
        },
      },
    };
  }

  // 7. flush-then-exit-0 via the server's finish() (reused unchanged).
  const fin = typeof finishOverride === 'function' ? finishOverride : finish;
  await fin(output);
}
