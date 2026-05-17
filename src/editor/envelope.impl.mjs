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
 * deleteBlock / moveBlock / addBlock are part of the type union (the wire
 * contract covers them) but the current UI never produces them, so this
 * builder never emits them. When the UI grows those affordances the mapping
 * lands here with no schema change.
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

  // M3: carry the reviewer's full edited working document on APPROVE so the
  // PRD path can persist the structural edits AS the next revision. The ops[]
  // above stay advisory (M2). Only attached on approve — revise is the
  // unchanged re-author loop and must not smuggle a competing doc.
  if (
    decision === 'approve' &&
    state.editedDocument &&
    typeof state.editedDocument === 'object' &&
    !Array.isArray(state.editedDocument)
  ) {
    envelope.editedDocument = state.editedDocument;
  }

  return envelope;
}
