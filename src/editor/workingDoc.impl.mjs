/**
 * planos editor — pure working-document model (Milestone M3).
 *
 * M3 ("edits actually stick"): the SPA holds a single mutable WORKING COPY of
 * the document derived from the inlined `window.__PLANOS_DOC__`. The reviewer's
 * existing edit affordances (task field patches, openQuestion answers) mutate
 * THIS working doc, and on Approve the full working doc is transmitted so the
 * PRD path can persist it as the NEXT revision.
 *
 * This module is the SINGLE place editor interaction state is folded back into
 * a canonical Document. It is intentionally:
 *   - PURE: no React, no clock, no network — a (baseDoc, editorState) → doc fn.
 *   - ADDITIVE over the M2 envelope: comments + globalComment stay advisory
 *     (they are NOT structural document content) and are NOT applied here.
 *   - The M4/M5 extension point: rich edit modals / table / diagram / prose
 *     edits and drag-drop reordering land as new EditorState shapes consumed
 *     HERE (one mapping site), with NO schema or transport change.
 *
 * Mapping (current, limited, affordances — the M3 test vehicle):
 *   - editorState.edits[blockId]   → shallow field patch merged onto the block
 *     (TaskBlock title/status/acceptance today; any future field tomorrow).
 *   - editorState.answers[blockId] → openQuestion `answer` field set on the
 *     matching block (only when the block is an openQuestion; a stray answer
 *     for a non-openQuestion block is ignored — it rides the advisory envelope
 *     as today, never corrupts the structural doc).
 *
 * Implemented as plain `.mjs` (zero toolchain) so the Node test harness can
 * import it directly; `workingDoc.ts` re-exports it for the typed call sites.
 *
 * Zero runtime dependencies. ES module.
 */

'use strict';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Derive the reviewer's working document from the loaded base document and the
 * accumulated editor interaction state.
 *
 * Block order and identity are preserved (id is never minted/renumbered here —
 * the current affordances only patch existing blocks). A block with no edits
 * and no applicable answer passes through byte-unchanged, so a review with NO
 * structural edits yields a working doc that canonicalizes equal to the base
 * (M3 no-op correctness — the PRD path relies on that to skip a spurious
 * revision).
 *
 * @param {{ id: string, meta: object, blocks: Array<Record<string, unknown>> }} baseDoc
 * @param {{
 *   edits?:   Record<string, Record<string, unknown>>,
 *   answers?: Record<string, string>,
 * }} [editorState]
 * @returns {object}  A new Document (the working copy). `baseDoc` is untouched.
 */
export function deriveWorkingDoc(baseDoc, editorState) {
  if (!isObj(baseDoc) || !Array.isArray(baseDoc.blocks)) {
    // Nothing sane to derive from — return the input as-is (never throw out of
    // the editor; the SPA stays usable and Approve falls back to the agent doc
    // on the server side if this is not a valid Document).
    return baseDoc;
  }

  const state = editorState || {};
  const edits = isObj(state.edits) ? state.edits : {};
  const answers = isObj(state.answers) ? state.answers : {};

  const blocks = baseDoc.blocks.map((block) => {
    const id = block && block.id;
    let next = block;

    // openQuestion answers become the block's `answer` field. We only apply it
    // to an actual openQuestion block — a stray answer keyed at a non-question
    // block is left to ride the advisory envelope (it must NOT mutate the
    // structural doc).
    if (
      typeof id === 'string' &&
      hasOwn(answers, id) &&
      typeof answers[id] === 'string' &&
      answers[id].length > 0 &&
      block.kind === 'openQuestion'
    ) {
      next = { ...next, answer: answers[id] };
    }

    // Field patches (today: TaskBlock title/status/acceptance) are merged
    // shallowly over the block. An empty patch is a no-op (the block passes
    // through byte-unchanged so the no-op-equality check holds).
    if (typeof id === 'string' && hasOwn(edits, id)) {
      const patch = edits[id];
      if (isObj(patch) && Object.keys(patch).length > 0) {
        next = { ...next, ...patch };
      }
    }

    return next;
  });

  return { ...baseDoc, blocks };
}
