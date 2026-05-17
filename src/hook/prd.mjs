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
import { validateDocument } from '../schema/index.mjs';
import {
  loadLatest,
  listRevisions,
  listRevisionDocs,
  saveRevision,
  canonicalize,
  PrdCorruptError,
} from '../prd/store.mjs';

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

/**
 * Assemble the FULL persisted revision chain for a PRD doc id (MEDIUM-2 /
 * AC-P12). The history browser + `GET /api/prd/versions` advertise the entire
 * chain so ANY earlier revision is retrievable via
 * `GET /api/prd/version?v=<old>`; passing only the immediate predecessor 404s
 * every revision below it. Reads every persisted `rNNN.json` via the store
 * (pure node:fs — AC-17-clean, same boundary as `loadLatest`).
 *
 * A read failure must NEVER block the round-trip: degrade to head+prev only
 * (`previousDoc` when present, else empty — `buildPrdApiHandlers` always folds
 * the current `doc` in itself, so the current revision stays retrievable).
 *
 * [2] de-dupe: this used to call `listRevisions` (which reads+parses every
 * `rNNN.json` to extract meta) and THEN `loadRevision` per entry (a SECOND
 * read+parse of the very same file) — 2 reads/parses per revision file. It now
 * uses the store's `listRevisionDocs`, which returns the parsed doc for every
 * revision in ONE pass, so each file is read+parsed exactly ONCE. Behaviour is
 * identical: same chain membership, same AC-17 pure-node:fs boundary (the
 * single read still lives inside src/prd/store.mjs), same safe degrade. A
 * corrupt revision is skipped (doc === null) exactly as the old `if (d)` guard
 * skipped a `loadRevision` that returned null.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @param {object | undefined} previousDoc  loadLatest().doc, the degrade base.
 * @returns {object[]}  Every persisted revision document (any order).
 */
export function assemblePriorChain(rootDir, docId, previousDoc) {
  let chain = [];
  try {
    if (typeof docId === 'string' && docId.length > 0) {
      for (const { doc } of listRevisionDocs(rootDir, docId)) {
        if (doc) chain.push(doc);
      }
    }
  } catch {
    chain = previousDoc ? [previousDoc] : [];
  }
  if (chain.length === 0 && previousDoc) chain = [previousDoc];
  return chain;
}

// ---------------------------------------------------------------------------
// M3 — reviewer's edited working document becomes the persisted revision.
// ---------------------------------------------------------------------------

/**
 * Pick the document to persist on Approve (M3 — "edits actually stick").
 *
 * The SPA POSTs its full edited WORKING document on the FeedbackEnvelope as
 * `editedDocument` (src/editor/envelope.impl.mjs). When present AND it
 * validates as a Document AND it carries the SAME stable id as the
 * agent-authored doc, the reviewer's edits BECOME the document: we persist
 * THAT (normalised so its `meta.revision` matches the chain head + 1, exactly
 * as the agent-authored path already normalises). Otherwise we fall back to
 * the agent-authored `agentDoc` unchanged — an absent / malformed / id-
 * mismatched editedDocument must NEVER block the round-trip (design.md §5:
 * the user is never blocked by bad client input).
 *
 * NO-OP CORRECTNESS: if the chosen doc canonicalizes EQUAL (via the store's
 * own byte-stable `canonicalize`) to the prior persisted revision's document,
 * the reviewer made no structural change. The store is append-only with a
 * monotonic revision number and has NO content-dedupe of its own (see
 * tests/prd-store.test.mjs "byte-stable" + tests/prd-roundtrip.test.mjs
 * "append-only invariant"): re-saving the SAME revision number throws, and
 * bumping the number would persist a spuriously DIFFERING revision for an
 * unchanged document. So the established no-op contract here is: persist
 * nothing new and report the prior revision as current. A genuine edit (or a
 * first revision with no prior) always persists.
 *
 * Pure: no network, no model, no clock. node:fs writes happen later in the
 * caller (saveRevision) — this only DECIDES.
 *
 * @param {import('../schema/types').Document} agentDoc
 *   The agent-authored doc, already normalised to meta.revision = nextRevision.
 * @param {number} nextRevision  The chain-head + 1 (1 if no prior).
 * @param {{ doc: object, revision: number } | null} prior
 *   The prior persisted revision (loadLatest result), or null if none.
 * @param {unknown} editedDocument  resolved.editedDocument from the envelope.
 * @returns {{ doc: import('../schema/types').Document, persist: boolean,
 *             source: 'reviewer-edited' | 'agent-authored',
 *             noop: boolean }}
 */
export function selectApproveDoc(agentDoc, nextRevision, prior, editedDocument) {
  let chosen = agentDoc;
  let source = 'agent-authored';

  if (
    editedDocument &&
    typeof editedDocument === 'object' &&
    !Array.isArray(editedDocument)
  ) {
    let validated = null;
    try {
      const r = validateDocument(editedDocument);
      validated = r && r.ok ? r.doc : null;
    } catch {
      validated = null;
    }
    // Only honour an edited doc that is a valid Document AND targets the SAME
    // stable id (a different id is not "this document's next revision").
    if (
      validated &&
      typeof validated.id === 'string' &&
      validated.id === agentDoc.id
    ) {
      // Normalise the revision the SAME way the agent-authored path does — the
      // persisted chain is the source of truth for monotonicity, not whatever
      // baseRevision the SPA edited against (single-reviewer blocking flow:
      // approve-with-edits always persists off the current chain head; a stale
      // base is noted in the message, never an error — see handlePrd).
      chosen = {
        ...validated,
        meta: { ...validated.meta, revision: nextRevision },
      };
      source = 'reviewer-edited';
    }
  }

  // NO-OP: canonically equal to the prior persisted revision → persist nothing
  // (the store has no content-dedupe; bumping the number would create a
  // spuriously differing revision for an unchanged doc).
  if (prior && prior.doc) {
    const priorCanon = canonicalize(prior.doc);
    // Compare at the prior revision's own number so a pure revision-bump does
    // not register as a "change" (content equality, not meta equality).
    const chosenAtPriorRev = {
      ...chosen,
      meta: { ...chosen.meta, revision: prior.revision },
    };
    if (canonicalize(chosenAtPriorRev) === priorCanon) {
      return { doc: prior.doc, persist: false, source, noop: true };
    }
  }

  return { doc: chosen, persist: true, source, noop: false };
}

/**
 * Build the human-readable persistence note that rides on the Approve
 * `decision.message` (M3). It NAMES the revision the reviewer's approved
 * document was persisted as (stable id + revision number + on-disk path) so
 * the agent continues from the document that actually stuck — and flags the
 * no-op / persist-failure / stale-base cases plainly.
 *
 * baseRevision / optimistic concurrency on approve (M3 requirement 4): the
 * single-reviewer blocking flow ALWAYS persists approve-with-edits off the
 * current chain head (prior + 1). A stale base (the SPA edited an older
 * revision than the current canonical one) does NOT block — it is persisted
 * anyway and merely NOTED here, consistent with the store's append-only chain
 * semantics (the deny path keeps its stricter race guard — unchanged).
 *
 * Pure: string build only. No fs, no network, no model, no clock.
 *
 * @param {{ source: string, persist: boolean, noop: boolean }} picked
 * @param {number} effectiveRevision
 * @param {string|null} savedPath
 * @param {string|null} persistError
 * @param {{ stale: boolean, baseRevision: number, headRevision: number } | null} [staleBase]
 * @param {{ file: string, message: string } | null} [priorCorrupt]
 *   Set when the on-disk head revision was CORRUPT (the [1] fix). Surfaced
 *   loudly so the agent knows the prior head is damaged and that this revision
 *   was appended ABOVE it (no diff base, no silent continuity assumption).
 * @returns {string}
 */
export function buildPersistenceNote(
  picked,
  effectiveRevision,
  savedPath,
  persistError,
  staleBase = null,
  priorCorrupt = null,
) {
  const lines = ['## Persisted document (work from THIS revision)'];
  if (picked.noop) {
    lines.push(
      '',
      `The reviewer made NO structural edits. No new revision was created; ` +
        `revision ${effectiveRevision} remains the current persisted document.`,
    );
  } else if (persistError !== null) {
    lines.push(
      '',
      `The approved document could NOT be persisted (revision ` +
        `${effectiveRevision}): ${persistError}. Treat revision ` +
        `${effectiveRevision} as the intended current document.`,
    );
  } else {
    const src =
      picked.source === 'reviewer-edited'
        ? "the reviewer's edited document"
        : 'the approved document';
    lines.push(
      '',
      `Persisted ${src} as revision ${effectiveRevision}` +
        (savedPath !== null ? ` (${savedPath})` : '') +
        '. This is now the current canonical document — continue from it.',
    );
    if (picked.source === 'reviewer-edited') {
      lines.push(
        '',
        'The reviewer made STRUCTURAL edits in the review UI; the document ' +
          'above already reflects them. The advisory notes/comments (if any) ' +
          'below are additional context, NOT a re-review gate.',
      );
    }
  }
  if (staleBase && staleBase.stale) {
    lines.push(
      '',
      `Note: the review was made against revision ${staleBase.baseRevision} ` +
        `while the chain head was ${staleBase.headRevision}. Per the ` +
        `single-reviewer blocking flow the approved document was still ` +
        `persisted off the current head (not rejected).`,
    );
  }
  if (priorCorrupt && priorCorrupt.file) {
    lines.push(
      '',
      `WARNING: the previously persisted head revision on disk is CORRUPT ` +
        `(${priorCorrupt.file}) and could not be read. This revision was ` +
        `appended ABOVE the damaged one (the revision counter was recovered ` +
        `from the on-disk filenames, NOT reset). There is therefore no ` +
        `reliable diff base against the prior revision — do not assume ` +
        `continuity with it; the corrupt file was left untouched for manual ` +
        `recovery.`,
    );
  }
  return lines.join('\n');
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
  //    id. Pure node:fs read (src/prd/store.mjs) — AC-17-clean.
  //
  //    CALLER CONTRACT for the [1] fix (corrupt head ≠ missing head):
  //      - Missing head (loadLatest → null): genuinely no prior revision →
  //        prior = null, nextRevision = 1 (first-revision creation — unchanged).
  //      - prdPath throws (hostile/invalid id): no persistence is reachable →
  //        prior = null, nextRevision = 1, no chain (unchanged).
  //      - CORRUPT head (loadLatest throws PrdCorruptError): the head EXISTS
  //        but is damaged. We must NEVER block the round-trip (design.md §5),
  //        but we must ALSO NOT pretend the chain is empty — doing so reset the
  //        counter to 1 and made saveRevision later throw the confusing
  //        "r001 already exists" append-only error (silent data-loss risk).
  //        So instead we degrade VISIBLY: no diff base (prior stays null so the
  //        no-op compare cannot run against a doc we could not read), but the
  //        next revision number is recovered from the on-disk filenames
  //        (listRevisions still reports a corrupt revision with its filename
  //        number) so the new revision is appended ABOVE the damaged head and
  //        the append-only guard is never tripped. The corruption is then
  //        surfaced in the success payload (priorCorrupt) — loud, not silent.
  let prior = null;
  let priorCorrupt = null; // { file: string, message: string } | null
  const hasId = typeof authored.id === 'string' && authored.id.length > 0;
  try {
    prior = hasId ? loadLatest(rootDir, authored.id) : null;
  } catch (err) {
    if (err instanceof PrdCorruptError) {
      priorCorrupt = {
        file: err.filePath,
        message: err.message,
      };
    }
    // Either way the diff base is unavailable; never block the round-trip.
    prior = null;
  }

  // The new revision is the prior persisted revision + 1 (monotonic,
  // append-only — AC-P10). A degraded/first PRD starts at revision 1. The
  // document's own meta.revision is normalised so saveRevision writes rNNN
  // matching the chain (the agent-authored revision is advisory only — the
  // persisted chain is the source of truth for monotonicity).
  //
  // When the head is corrupt we cannot trust loadLatest's revision, so derive
  // the true chain head from the on-disk rNNN.json filenames (listRevisions
  // reports corrupt entries with their filename-derived revision number, never
  // throws). nextRevision = highest-on-disk + 1 so we append ABOVE the damaged
  // revision instead of colliding with r001.
  let nextRevision =
    prior && typeof prior.revision === 'number' ? prior.revision + 1 : 1;
  if (priorCorrupt !== null && hasId) {
    let maxOnDisk = 0;
    try {
      for (const r of listRevisions(rootDir, authored.id)) {
        if (typeof r.revision === 'number' && r.revision > maxOnDisk) {
          maxOnDisk = r.revision;
        }
      }
    } catch {
      // listRevisions never throws by contract; defensive only.
      maxOnDisk = 0;
    }
    if (maxOnDisk + 1 > nextRevision) nextRevision = maxOnDisk + 1;
  }
  const doc = {
    ...authored,
    meta: { ...authored.meta, revision: nextRevision },
  };
  const previousDoc = prior ? prior.doc : undefined;

  // MEDIUM-2 / AC-P12: pass the FULL persisted chain (not just [previousDoc])
  // so any earlier revision is retrievable via GET /api/prd/version?v=<old>.
  const priorChain = assemblePriorChain(rootDir, authored.id, previousDoc);

  // 4. Boot the blocking server (SCRIPTED placeholder vs REAL-SPA + /api/prd*).
  const serveHtml = scripted
    ? '<!doctype html><html><body>' +
      '<!-- planos PRD scripted/harness mode: no SPA -->' +
      '</body></html>'
    : buildSpaHtml(doc);
  const apiHandlers = scripted
    ? {}
    : buildPrdApiHandlers(doc, priorChain);

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

  // M3: decide WHICH document is persisted FIRST. The reviewer's edited
  // working document (transmitted on the approve envelope as
  // resolved.editedDocument) BECOMES the document when valid + same id; else
  // fall back to the agent-authored doc. Computed before buildDecision so the
  // approve-feedback echo table can describe the doc that actually sticks
  // (MEDIUM-1). Pure: selectApproveDoc only DECIDES (no fs).
  const picked = selectApproveDoc(
    doc,
    nextRevision,
    prior,
    resolved && typeof resolved === 'object'
      ? resolved.editedDocument
      : undefined,
  );

  // Reuse the decision machinery: buildDecision applies the baseRevision race
  // guard (AC-P8) and serialises any FeedbackEnvelope into the deny message.
  // No envelope → backward-compatible directive + echo table + canonical JSON.
  // MEDIUM-1: on the reviewer-edited approve path the "REUSE THESE IDS" echo
  // table MUST reflect the PERSISTED edited doc (picked.doc), not the pre-edit
  // agent-authored `doc` — otherwise the agent re-mints/drops ids that no
  // longer match what stuck. The deny path is unaffected (it re-renders the
  // agent doc, which is correct: on deny the reviewer edits did NOT stick).
  const decision = buildDecision(
    doc,
    resolved,
    picked.source === 'reviewer-edited' ? { echoDoc: picked.doc } : {},
  );

  // 6. APPROVE → persist a NEW immutable revision (append-only) + emit a
  //    PRD-shaped success JSON. REVISE → emit the deny/revise PermissionRequest
  //    output. Persistence is pure node:fs.
  let output;
  if (decision.behavior === 'deny') {
    // Surface a corrupt on-disk head on the deny/revise path too: nothing is
    // persisted here, but the agent should know its persisted chain head could
    // not be read as a diff base (parity with the approve-path priorCorrupt).
    if (priorCorrupt !== null && typeof decision.message === 'string') {
      decision.message =
        `WARNING: the on-disk PRD head revision is CORRUPT ` +
        `(${priorCorrupt.file}) and could not be read as a diff base.\n\n` +
        decision.message;
    }
    output = toPermissionRequestOutput(decision);
  } else {
    let savedPath = null;
    let persistError = null;
    if (picked.persist) {
      try {
        savedPath = saveRevision(rootDir, picked.doc);
      } catch (err) {
        // An append-only / path violation must NOT crash the round-trip — the
        // decision still resolves; surface the error in the success payload so
        // the agent/tests can see it (the user is never blocked).
        persistError = err && err.message ? err.message : String(err);
      }
    }

    // The effective current revision the agent should treat as canonical:
    // the just-persisted one, or — on a no-op / persist failure — the prior.
    const effectiveRevision = picked.doc.meta.revision;

    // M2 Defect 1: when the reviewer approved BUT also left feedback,
    // buildDecision returns the allow with a rendered `message` (approve
    // directive + ops + echo table). M3: ADDITIONALLY state the persisted
    // revision (id + number + path) and keep the M2 change summary so the
    // agent works from the document that actually stuck. A clean approve with
    // no edits + no notes stays a bare allow (no noise).
    // Optimistic-concurrency note (M3 req 4): if the SPA edited an older
    // revision than the chain head, persist anyway (single-reviewer blocking
    // flow) and NOTE it. headRevision = the revision the agent-authored doc was
    // normalised to (prior + 1); a base strictly below the prior persisted
    // revision is stale.
    const envBaseRevision =
      resolved &&
      typeof resolved === 'object' &&
      typeof resolved.baseRevision === 'number'
        ? resolved.baseRevision
        : null;
    const priorRevision =
      prior && typeof prior.revision === 'number' ? prior.revision : 0;
    const staleBase =
      envBaseRevision !== null && envBaseRevision < priorRevision
        ? {
            stale: true,
            baseRevision: envBaseRevision,
            headRevision: priorRevision,
          }
        : null;

    const persistenceNote = buildPersistenceNote(
      picked,
      effectiveRevision,
      savedPath,
      persistError,
      staleBase,
      priorCorrupt,
    );
    const m2Summary =
      typeof decision.message === 'string' && decision.message.length > 0
        ? decision.message
        : null;
    // A clean approve — agent-authored doc, NO reviewer structural edits, NO
    // M2 feedback — stays a BARE allow (no noise; the agent already has the
    // doc it authored, nothing changed). The persistence note is attached
    // ONLY when there is something the agent must act on: M2 feedback, OR the
    // reviewer's structural edits became the document, OR a no-op/persist
    // failure the agent must be told about explicitly.
    const reviewerChangedDoc = picked.source === 'reviewer-edited';
    const composed =
      m2Summary !== null
        ? `${persistenceNote}\n\n${m2Summary}`
        : reviewerChangedDoc ||
            picked.noop ||
            persistError !== null ||
            priorCorrupt !== null
          ? persistenceNote
          : null;
    const approveDecision =
      composed !== null
        ? { behavior: 'allow', message: composed }
        : { behavior: 'allow' };
    output = {
      hookSpecificOutput: {
        hookEventName: 'PrdRoundTrip',
        decision: approveDecision,
        prd: {
          documentId: picked.doc.id,
          revision: effectiveRevision,
          persisted: savedPath !== null,
          source: picked.source,
          noop: picked.noop,
          ...(savedPath !== null ? { path: savedPath } : {}),
          ...(persistError !== null ? { error: persistError } : {}),
          // [1] LOUD, not silent: a corrupt head was detected. The new
          // revision was still appended ABOVE the damaged one (no counter
          // mis-reset, no confusing "r001 already exists"), and the agent is
          // told the on-disk head is damaged so it does not assume continuity.
          ...(priorCorrupt !== null ? { priorCorrupt } : {}),
        },
      },
    };
  }

  // 7. flush-then-exit-0 via the server's finish() (reused unchanged).
  const fin = typeof finishOverride === 'function' ? finishOverride : finish;
  await fin(output);
}
