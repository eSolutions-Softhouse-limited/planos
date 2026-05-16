/**
 * planos — diff-review-mode round-trip handler (Phase 3 / Milestone R2).
 *
 * Contract: planos-phase3-plan.md Resolved Decisions (R2 → Option A EPHEMERAL:
 * a diff review is NOT persisted — no reviews/ dir, no src/review/store.mjs, no
 * saveRevision; R4 → stdin handoff via readStdin/extractPlan; R5 → hunk verdict
 * carried in BlockComment{commentId,hunkId,text,verdict}, NO new envelope op —
 * buildDecision reused unchanged; R7 → a type:"diff-review" doc accepts v1∪v3),
 * §4.1 topology, §6 AC-R7 + AC-R8 + AC-R12 (the R2 gate), §7 Milestone R2.
 *
 * Topology (design.md §9 — slash command → blocking CLI, NOT a hook; the EXACT
 * mirror of Phase 2's bin/planos prd, NOT an ExitPlanMode PermissionRequest):
 *
 *   /planos-review <PR# | git range> scope interview + `gh pr diff`/`git diff`
 *   + v3 diff-review authoring   (live-agent CLI surface — AC-17 pre-server,
 *   allowed; gh/git are the agent's OWN tool use)  runs BEFORE this boots
 *      ↓ pipes authored v3 JSON via stdin   the server (R4 = stdin)
 *   bin/planos review → handleReview():
 *      1. read authored doc from stdin (reuse readStdin/extractPlan)
 *      2. validate as v3 diff-review → planToDocument; degradeToProse fallback
 *         (degradeOpts.type = "diff-review" so a degraded review stays
 *         type:"diff-review" with meta.degraded=true — AC-R3, mirrors
 *         prd.mjs's degradeOpts.type="prd" line VERBATIM)
 *      3. (R2 = EPHEMERAL — there is NO prior persisted revision to load and
 *         NO store; the optional previous-doc is an injectable diff base only)
 *      4. startServer() → real SPA + read-only /api/review* (current+previous)
 *         + the injectable browser opener + the SCRIPTED decisionProvider seam
 *         (exactly like handleExit/handlePrd so tests stay offline)
 *      5. BLOCK on decisionPromise
 *      6. APPROVE  → emit a structured ReviewRoundTrip success JSON carrying
 *                    the per-hunk verdicts + comments + overall decision
 *                    derived from the approved doc's `diff` blocks' comments[]
 *                    (R5). NO persistence (R2 ephemeral — the review result is
 *                    the returned envelope only; no saveRevision).
 *         REVISE   → buildReviseMessage (directive + (id,kind,title) echo
 *                    table + canonical JSON); baseRevision race guard reused
 *                    VERBATIM from the plan/PRD loop (AC-R8)
 *      7. flush-then-exit-0 via the server's finish() (reused unchanged)
 *
 * AC-17 (RE-ASSERTED, not weakened — formally re-proven in R5): the blocking
 * path
 *   bin/planos review → src/hook/review.mjs → src/server → src/schema →
 *   src/diff → src/review/ingest.mjs
 * has ZERO network egress, ZERO agent spawn, ZERO agent-SDK import. The
 * `gh pr diff`/`git diff` SUBPROCESS that PRODUCES the unified-diff text runs
 * in the pre-server CLI agent loop (the legitimate live-agent surface, exactly
 * like the Socratic interview), NEVER in this blocking path; src/review/
 * ingest.mjs is a PURE text→blocks parser with zero imports. There is NO
 * src/review/store.mjs (R2 ephemeral) so there is no filesystem-write boundary
 * to document here at all (this handler reads stdin + serves loopback only).
 * The browser opener is the injectable seam (tests inject a no-op); the
 * SCRIPTED decisionProvider seam keeps the harness fully offline (no SPA, no
 * /api/review handlers).
 *
 * buildReviewApiHandlers DESIGN CHOICE: because R2 = ephemeral there is no
 * persisted revision chain, so this handler is modeled on
 * {@link buildPlanApiHandlers} (exit.mjs — current + optional previous only),
 * NOT on buildPrdApiHandlers's multi-revision /api/prd/versions chain. The
 * ephemeral review has at most a current doc and an optional injectable diff
 * base — the plan-loop's current/previous shape is the clean ephemeral fit.
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
} from './exit.mjs';

// ---------------------------------------------------------------------------
// Ephemeral review read-only API (R2 = ephemeral) — current + previous only,
// mirroring buildPlanApiHandlers (exit.mjs), NOT buildPrdApiHandlers's
// persisted multi-revision chain (there is no persisted chain — R2 ephemeral).
// ---------------------------------------------------------------------------

/**
 * Build the read-only `/api/review*` handler map for the real-SPA path.
 *
 * Mirrors {@link buildPlanApiHandlers} exactly (current + optional previous):
 * an ephemeral diff review has at most the just-authored canonical document
 * and an OPTIONAL injectable previous document as the diff base. There is no
 * persisted revision chain (R2 ephemeral) so there is deliberately NO
 * `/api/review/versions` history-walk endpoint — only the current view and a
 * single optional diff base. All handlers are pure and read-only (no decision
 * resolution, no egress).
 *
 *   - GET /api/review            → { plan, doc, origin, previousPlan, versionInfo }
 *   - GET /api/review/versions   → { versions: [{ v, revision }, ...] } (≤2)
 *   - GET /api/review/version?v=N→ { plan } for the current or previous doc
 *
 * @param {import('../schema/types').Document} doc          Current canonical doc.
 * @param {import('../schema/types').Document} [previousDoc] Optional diff base.
 * @returns {Record<string, (req: import('node:http').IncomingMessage) => object>}
 */
export function buildReviewApiHandlers(doc, previousDoc) {
  const currentRev =
    doc && doc.meta && typeof doc.meta.revision === 'number'
      ? doc.meta.revision
      : 1;
  const prevRev =
    previousDoc &&
    previousDoc.meta &&
    typeof previousDoc.meta.revision === 'number'
      ? previousDoc.meta.revision
      : undefined;

  const versions = [];
  if (previousDoc)
    versions.push({ v: prevRev, revision: prevRev, doc: previousDoc });
  versions.push({ v: currentRev, revision: currentRev, doc });

  return {
    'GET /api/review': () => ({
      json: {
        plan: doc,
        doc,
        origin: 'planos-review',
        previousPlan: previousDoc || null,
        versionInfo: {
          revision: currentRev,
          previousRevision: prevRev ?? null,
          versions: versions.map((x) => ({ v: x.v, revision: x.revision })),
        },
      },
    }),
    'GET /api/review/versions': () => ({
      json: { versions: versions.map((x) => ({ v: x.v, revision: x.revision })) },
    }),
    'GET /api/review/version': (req) => {
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
// Structured review-envelope derivation (R5) — pure, from the approved doc.
// ---------------------------------------------------------------------------

/**
 * Derive the structured per-hunk review result from an APPROVED diff-review
 * document's `diff` blocks' `comments[]` (R5: a hunk verdict lives in a
 * `BlockComment{commentId, hunkId, text, verdict}`; there is NO new envelope
 * op — the SPA mutates `comments[]` via an `editBlock` op patch and the
 * approved canonical doc carries the result). Pure: no clock, no egress.
 *
 *   - per-hunk verdicts + comments: every BlockComment across every `diff`
 *     block, flattened, carrying its file path / block id / hunk id / verdict.
 *   - overall decision: "approve" (the human approved). A review with at least
 *     one "reject" verdict is still an APPROVE of the round-trip — the
 *     per-hunk rejects are the actionable signal the agent acts on; the
 *     overall flag summarises whether any hunk was rejected so the agent can
 *     branch without re-scanning.
 *
 * @param {import('../schema/types').Document} doc Approved canonical doc.
 * @returns {{ overall: 'approve', hasRejections: boolean,
 *             hunkVerdicts: Array<object>, comments: Array<object> }}
 */
function deriveReviewResult(doc) {
  const blocks =
    doc && Array.isArray(doc.blocks) ? doc.blocks : [];
  const hunkVerdicts = [];
  const comments = [];
  for (const b of blocks) {
    if (!b || b.kind !== 'diff') continue;
    const path = typeof b.path === 'string' ? b.path : undefined;
    const cs = Array.isArray(b.comments) ? b.comments : [];
    for (const c of cs) {
      if (!c || typeof c !== 'object') continue;
      const entry = {
        blockId: typeof b.id === 'string' ? b.id : String(b.id ?? ''),
        ...(path !== undefined ? { path } : {}),
        commentId:
          typeof c.commentId === 'string' ? c.commentId : String(c.commentId ?? ''),
        hunkId: typeof c.hunkId === 'string' ? c.hunkId : null,
        verdict:
          c.verdict === 'accept' || c.verdict === 'reject' || c.verdict === 'comment'
            ? c.verdict
            : 'comment',
        text: typeof c.text === 'string' ? c.text : '',
      };
      comments.push(entry);
      // A per-HUNK verdict anchors to a hunkId; a file-level comment
      // (hunkId === null) is a comment, not a per-hunk verdict.
      if (entry.hunkId !== null) {
        hunkVerdicts.push({
          blockId: entry.blockId,
          ...(path !== undefined ? { path } : {}),
          hunkId: entry.hunkId,
          verdict: entry.verdict,
          commentId: entry.commentId,
          text: entry.text,
        });
      }
    }
  }
  const hasRejections =
    hunkVerdicts.some((h) => h.verdict === 'reject') ||
    comments.some((c) => c.verdict === 'reject');
  return { overall: 'approve', hasRejections, hunkVerdicts, comments };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `review` subcommand — the slash-command → blocking-CLI diff-review
 * round-trip. EPHEMERAL (R2 = Option A): nothing is persisted.
 *
 * TWO modes, one engine — IDENTICAL seam shape to {@link handlePrd} so the
 * harness drives it exactly like the plan / PRD loop:
 *
 *   - SCRIPTED (harness, AC-R7/R8/R12): a `decisionProvider` is injected.
 *     A minimal placeholder HTML is served, no `/api/review*` handlers are
 *     registered, and the injected provider drives an /api/approve|deny POST so
 *     the harness resolves the round-trip deterministically + fully offline.
 *
 *   - REAL-SPA (production): NO `decisionProvider`. The prebuilt single-file
 *     editor is served at `/` with the canonical doc inlined; the current
 *     (+ optional injectable previous) doc is exposed read-only via
 *     `/api/review*`; the REAL browser opener is invoked; and we block on
 *     `decisionPromise` until the browser POSTs the FeedbackEnvelope to
 *     /api/approve|deny.
 *
 * On APPROVE a structured `ReviewRoundTrip` success JSON is emitted carrying
 * the per-hunk verdicts + comments + overall decision derived from the
 * approved doc's `diff` blocks' `comments[]` (R5). NOTHING is persisted (R2
 * ephemeral — there is no store; the review result is the returned envelope
 * only — this mirrors handlePrd's APPROVE shape MINUS the saveRevision call).
 * On REVISE the standard deny-message machinery ({@link buildDecision} →
 * directive + (id,kind,title) echo table + canonical JSON) is reused VERBATIM
 * from the plan/PRD loop, so the baseRevision race guard (AC-R8) fires
 * identically and the (id,kind,title) deny-echo table is kind-agnostic.
 *
 * @param {object} [options]
 * @param {(url: string) => void} [options.openBrowser]
 *   Injectable open-browser seam. Default: the real cross-platform opener in
 *   real-SPA mode; a no-op in scripted mode. Tests ALWAYS inject their own.
 * @param {(ctx: { url: string, doc: import('../schema/types').Document }) => void}
 *   [options.decisionProvider]
 *   Injectable SCRIPTED decision driver. Supplied → SCRIPTED mode (no SPA, no
 *   /api/review handlers). Omitted → REAL-SPA mode.
 * @param {import('../schema/types').Document} [options.previousDoc]
 *   Optional injectable diff base for the SPA (ephemeral — there is no store
 *   to load a prior revision from; the caller may supply one explicitly).
 * @param {string} [options.stdinText]
 *   Injectable stdin payload (tests pass it directly instead of piping).
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options.stdinOpts]
 *   Injectable production stdin bounds (US-013).
 * @param {{ id?: string, createdAt?: string, type?: string }} [options.degradeOpts]
 *   Deterministic overrides forwarded to degradeToProse for tests. `type`
 *   defaults to "diff-review" here so a degraded review stays a diff-review
 *   document (AC-R3, mirrors prd.mjs's degradeOpts.type="prd").
 * @param {(decision: object) => Promise<void>|void} [options.finishOverride]
 *   Test-only finish() override (in production finish() exits the process).
 * @returns {Promise<void>}
 */
export async function handleReview(options = {}) {
  const {
    decisionProvider,
    stdinText,
    stdinOpts = {},
    degradeOpts = {},
    previousDoc,
    finishOverride,
  } = options;

  // SCRIPTED iff a decisionProvider is injected (harness). Real-SPA otherwise
  // (production). The scripted seam mirrors handlePrd/handleExit verbatim.
  const scripted = typeof decisionProvider === 'function';

  const openBrowser =
    typeof options.openBrowser === 'function'
      ? options.openBrowser
      : scripted
        ? () => {}
        : openBrowserReal;

  // 1. Read stdin and extract tool_input.plan (R4 = stdin handoff). readStdin
  //    is the same production-hardened reader the ExitPlanMode hook + the PRD
  //    handler use (./roundtrip.mjs) — NEVER rejects/throws/blocks forever.
  const raw =
    typeof stdinText === 'string' ? stdinText : await readStdin(stdinOpts);
  const planText = extractPlan(raw);

  // 2. Parse/validate → canonical doc. A degraded review must stay
  //    type:"diff-review" (AC-R3) so we thread type:"diff-review" into the
  //    degrade overrides unless the caller pinned one explicitly. This mirrors
  //    prd.mjs's `{ type: 'prd', ...degradeOpts }` line VERBATIM (swap prd →
  //    diff-review). planToDocument is the SAME pure function the plan/PRD
  //    loops use (validate-as-is, else prose-degrade).
  const reviewDegradeOpts = { type: 'diff-review', ...degradeOpts };
  const doc = planToDocument(planText, reviewDegradeOpts);

  // 3. (R2 = EPHEMERAL) — no prior persisted revision to load, no store. The
  //    diff base is an OPTIONAL injectable previousDoc only.

  // 4. Boot the blocking server (SCRIPTED placeholder vs REAL-SPA + /api/rev*).
  const serveHtml = scripted
    ? '<!doctype html><html><body>' +
      '<!-- planos review scripted/harness mode: no SPA -->' +
      '</body></html>'
    : buildSpaHtml(doc);
  const apiHandlers = scripted
    ? {}
    : buildReviewApiHandlers(doc, previousDoc);

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

  // Reuse the plan/PRD-loop decision machinery VERBATIM: buildDecision applies
  // the baseRevision race guard (AC-R8) and serialises any FeedbackEnvelope
  // into the deny message exactly as the ExitPlanMode loop does (the proven
  // looksLikeBareEnvelope path — AC-R12). No envelope → backward-compatible
  // directive + (id,kind,title) echo table + canonical JSON.
  const decision = buildDecision(doc, resolved);

  // 6. APPROVE → emit a structured ReviewRoundTrip success JSON (per-hunk
  //    verdicts + comments + overall decision). NOTHING is persisted (R2
  //    ephemeral — no store, no saveRevision). REVISE → emit the deny/revise
  //    PermissionRequest output (same shape as the plan/PRD loop).
  let output;
  if (decision.behavior === 'deny') {
    output = toPermissionRequestOutput(decision);
  } else {
    const result = deriveReviewResult(doc);
    output = {
      hookSpecificOutput: {
        hookEventName: 'ReviewRoundTrip',
        decision: { behavior: 'allow' },
        review: {
          documentId: doc.id,
          revision:
            doc && doc.meta && typeof doc.meta.revision === 'number'
              ? doc.meta.revision
              : 1,
          // R2 = ephemeral: the review is NEVER persisted.
          persisted: false,
          overall: result.overall,
          hasRejections: result.hasRejections,
          hunkVerdicts: result.hunkVerdicts,
          comments: result.comments,
        },
      },
    };
  }

  // 7. flush-then-exit-0 via the server's finish() (reused unchanged).
  const fin = typeof finishOverride === 'function' ? finishOverride : finish;
  await fin(output);
}
