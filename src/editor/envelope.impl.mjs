/**
 * planos editor — pure FeedbackEnvelope builder (US-017 / Step 3.2, AC-9).
 *
 * Contract: docs/design.md §4 ("Feedback envelope (browser → agent)") and the
 * canonical SERVER-SIDE validator `src/schema/envelope.mjs` (US-015). The
 * envelope this builder emits MUST validate against `validateEnvelope` with
 * zero loss — that is AC-9.
 *
 *   FeedbackEnvelope {
 *     decision:     "approve" | "revise",
 *     documentId:   string,
 *     baseRevision: int,
 *     ops:          Edit[],
 *     globalComment?: string
 *   }
 *
 *   Edit =
 *     | { op:"editBlock",   blockId, patch }
 *     | { op:"deleteBlock", blockId }
 *     | { op:"moveBlock",   blockId, afterBlockId | null }
 *     | { op:"comment",     blockId, text, anchor? }
 *     | { op:"answer",      blockId, answer }
 *     | { op:"addBlock",    afterBlockId, block }
 *
 * The editor (US-016 `EditorState`) only produces a subset of the union:
 *   - task / openQuestion field patches  → `editBlock`
 *   - per-block reviewer comments         → `comment`
 *   - openQuestion answers                → `answer`
 *   - per-hunk diff verdicts (R5)         → `editBlock` patch of `comments[]`
 * deleteBlock / moveBlock / addBlock are part of the type union (the wire
 * contract covers them) but the current UI never produces them, so this
 * builder never emits them. When the UI grows those affordances the mapping
 * lands here with no schema change.
 *
 * R5 (Phase 3): a `diff` block's per-hunk accept/reject/comment is NOT a new
 * `Edit` op. It is an `editBlock` op whose `patch.comments[]` carries one
 * `BlockComment{commentId, hunkId, text, verdict}` per reviewed hunk. The
 * `commentId` is minted deterministically + stably as `<blockId>-c<n>` (the
 * §3.4 / ADR-0001-recursive scheme) so re-emission is byte-stable. NO change
 * to `src/schema/envelope.mjs` (the envelope never enumerates block kinds).
 *
 * Pure: no network, no clock, no React. Implemented as plain `.mjs`
 * (`envelope.impl.mjs`) so the test harness can `import` it with zero
 * toolchain; `envelope.ts` re-exports it for the typed call sites.
 *
 * Zero runtime dependencies. ES module.
 */

'use strict';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Build a structurally valid `FeedbackEnvelope` from the editor's accumulated
 * interaction state.
 *
 * Ordering is deterministic and stable: ops are emitted in document block
 * order, and within a block in (editBlock|answer) → comment order. This keeps
 * the human-readable rendering and the round-trip predictable.
 *
 * @param {"approve" | "revise"} decision
 * @param {{ id: string, meta: { revision: number }, blocks: Array<{ id: string, kind: string }> }} doc
 * @param {{
 *   edits?:   Record<string, object>,
 *   comments?: Record<string, string>,
 *   answers?:  Record<string, string>,
 *   reviewVerdicts?: Record<string, Record<string, { verdict: string, text: string }>>,
 *   globalComment?: string,
 * }} editorState
 * @returns {{
 *   decision: "approve" | "revise",
 *   documentId: string,
 *   baseRevision: number,
 *   ops: object[],
 *   globalComment?: string,
 * }}
 */
export function buildEnvelope(decision, doc, editorState) {
  const state = editorState || {};
  const edits = state.edits || {};
  const comments = state.comments || {};
  const answers = state.answers || {};
  const reviewVerdicts = state.reviewVerdicts || {};

  const blocks = Array.isArray(doc && doc.blocks) ? doc.blocks : [];
  const byId = new Map(blocks.map((b) => [b.id, b]));

  // Emit ops in document order so they are addressed predictably, then sweep
  // up any state keyed by ids no longer present in the doc (defensive — keeps
  // the human's feedback rather than silently dropping it).
  const ops = [];
  const seen = new Set();

  const emitForBlock = (blockId) => {
    if (seen.has(blockId)) return;
    seen.add(blockId);
    const block = byId.get(blockId);
    const kind = block ? block.kind : undefined;

    // openQuestion answers become `answer` ops; everything else that carries a
    // field patch becomes `editBlock`. We treat an explicit answer entry as the
    // openQuestion signal even if the block kind is unknown (degraded docs).
    const hasAnswer =
      hasOwn(answers, blockId) &&
      typeof answers[blockId] === 'string' &&
      answers[blockId].length > 0;

    if (hasAnswer && (kind === 'openQuestion' || kind === undefined)) {
      ops.push({ op: 'answer', blockId, answer: answers[blockId] });
    } else if (hasAnswer) {
      // Block exists but is not an openQuestion — fold the answer into a patch
      // so nothing the human typed is lost.
      ops.push({
        op: 'editBlock',
        blockId,
        patch: { answer: answers[blockId] },
      });
    }

    if (hasOwn(edits, blockId)) {
      const patch = edits[blockId];
      if (patch && typeof patch === 'object' && Object.keys(patch).length > 0) {
        ops.push({ op: 'editBlock', blockId, patch });
      }
    }

    // R5 — per-hunk diff verdicts. A reviewed hunk becomes a
    // `BlockComment{commentId, hunkId, text, verdict}` carried in an
    // `editBlock` op whose `patch.comments[]` replaces the diff block's
    // comments. `commentId` is minted deterministically as `<blockId>-c<n>`
    // (1-based, in stable hunk order — doc hunk order when the block resolves,
    // else sorted hunkId) so re-emission is byte-identical. NO new op (R5).
    if (hasOwn(reviewVerdicts, blockId)) {
      const hunkMap = reviewVerdicts[blockId];
      if (hunkMap && typeof hunkMap === 'object') {
        // Stable hunk ordering: prefer the doc block's own hunk order; fall
        // back to a deterministic sort of the reviewed hunkIds.
        const docHunks =
          block && Array.isArray(block.hunks) ? block.hunks : [];
        const order = [];
        const seenHunk = new Set();
        for (const h of docHunks) {
          if (
            h &&
            typeof h.hunkId === 'string' &&
            hasOwn(hunkMap, h.hunkId) &&
            !seenHunk.has(h.hunkId)
          ) {
            order.push(h.hunkId);
            seenHunk.add(h.hunkId);
          }
        }
        for (const hid of Object.keys(hunkMap).sort()) {
          if (!seenHunk.has(hid)) {
            order.push(hid);
            seenHunk.add(hid);
          }
        }
        const blockComments = [];
        let n = 0;
        for (const hid of order) {
          const r = hunkMap[hid];
          if (!r || typeof r !== 'object') continue;
          const verdict =
            r.verdict === 'accept' ||
            r.verdict === 'reject' ||
            r.verdict === 'comment'
              ? r.verdict
              : 'comment';
          const text = typeof r.text === 'string' ? r.text : '';
          // A neutral "comment" verdict with no text is not an actionable
          // signal — drop it (mirrors the empty-comment/empty-answer policy).
          if (verdict === 'comment' && text.trim().length === 0) continue;
          n += 1;
          blockComments.push({
            commentId: `${blockId}-c${n}`,
            hunkId: hid,
            text,
            verdict,
          });
        }
        if (blockComments.length > 0) {
          ops.push({
            op: 'editBlock',
            blockId,
            patch: { comments: blockComments },
          });
        }
      }
    }

    if (
      hasOwn(comments, blockId) &&
      typeof comments[blockId] === 'string' &&
      comments[blockId].length > 0
    ) {
      ops.push({ op: 'comment', blockId, text: comments[blockId] });
    }
  };

  for (const block of blocks) emitForBlock(block.id);
  // State keyed by ids not in the (possibly degraded) doc — still emit.
  for (const id of Object.keys(answers)) emitForBlock(id);
  for (const id of Object.keys(edits)) emitForBlock(id);
  for (const id of Object.keys(reviewVerdicts)) emitForBlock(id);
  for (const id of Object.keys(comments)) emitForBlock(id);

  /** @type {{ decision: string, documentId: string, baseRevision: number, ops: object[], globalComment?: string }} */
  const envelope = {
    decision,
    documentId: doc && doc.id,
    baseRevision: doc && doc.meta ? doc.meta.revision : undefined,
    ops,
  };

  if (
    typeof state.globalComment === 'string' &&
    state.globalComment.trim().length > 0
  ) {
    envelope.globalComment = state.globalComment;
  }

  return envelope;
}
