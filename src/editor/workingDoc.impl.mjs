/**
 * planos editor — pure working-document model (Milestone M3 → M4).
 *
 * M3 ("edits actually stick"): the SPA holds a single mutable WORKING COPY of
 * the document derived from the inlined `window.__PLANOS_DOC__`. The reviewer's
 * edit affordances mutate THIS working doc, and on Approve the full working doc
 * is transmitted so the PRD path can persist it as the NEXT revision.
 *
 * M4 ("rich interactive editing"): the same single fold-back site now also
 * folds back:
 *   - field patches for ALL v2 PRD kinds (the shallow merge was always
 *     kind-agnostic — the per-kind edit modals just produce richer patches),
 *   - structural ADD (`adds`) and DELETE (`deletes`) of blocks, id-stable:
 *     existing ids are NEVER renumbered; added blocks get deterministic ids.
 *
 * This module is the SINGLE place editor interaction state is folded back into
 * a canonical Document. It is intentionally:
 *   - PURE: no React, no clock, no network — a (baseDoc, editorState) → doc fn.
 *   - ADDITIVE over the M2 envelope: comments + globalComment stay advisory
 *     (they are NOT structural document content) and are NOT applied here.
 *   - The M5 extension point: reorder/move lands as a new EditorState shape
 *     consumed HERE (one mapping site), with NO schema or transport change.
 *
 * Mapping (M4):
 *   - editorState.edits[blockId]   → shallow field patch merged onto the block
 *     (ANY field of ANY kind — task/objective/prose/section/decision/risk/
 *     phase/tradeoff/fileChange/code/table/diagram/openQuestion).
 *   - editorState.answers[blockId] → openQuestion `answer` field set on the
 *     matching block (only when the block is an openQuestion; a stray answer
 *     for a non-openQuestion block is ignored — it rides the advisory envelope
 *     as today, never corrupts the structural doc).
 *   - editorState.deletes          → Set/array of block ids removed from the
 *     working doc (id-stable: only listed ids vanish; nothing renumbers).
 *   - editorState.adds             → ordered list of { afterId|null, block }
 *     insertions. `afterId:null` prepends; an unknown afterId appends to the
 *     end (never silently dropped). Added blocks keep whatever id they carry;
 *     `mintAddedBlockId` deterministically synthesizes a stable, collision-free
 *     id when the caller does not supply one.
 *   - editorState.order            → M5 reorder: an array of block ids giving
 *     the reviewer's desired sequence over the WORKING ids (base + adds, minus
 *     deletes). Applied LAST, as a pure permutation: it never mints or
 *     renumbers an id and never adds/drops a block. Compose contract:
 *       * `order` is applied to the post-(delete+add)-splice block list, so a
 *         freshly-added block already has a position and can be reordered by
 *         listing its (minted) id in `order`.
 *       * Live blocks whose id appears in `order` are emitted in `order`'s
 *         sequence (first occurrence wins; duplicate ids ignored).
 *       * A live block id NOT present in `order` is never dropped — it is
 *         re-appended keeping its original post-splice relative position,
 *         AFTER the ordered ones. (So a partial `order` of just the moved ids
 *         still works; an empty/absent `order` is a byte no-op.)
 *       * An id in `order` that is not live (deleted, or never existed) is
 *         skipped — `deletes` always wins over `order`.
 *     Net: a pure reorder yields the SAME block objects (id-stable, byte-equal
 *     per block) in a new sequence; the produced doc stays validateDocument-
 *     clean and canonical.
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
 * Deterministically mint a stable, collision-free id for a newly-added block.
 *
 * Mirrors the production `opaque` id scheme (src/schema/id-strategy.mjs): a
 * short `b<n>` token seeded PAST the highest existing `b<number>` so a fresh
 * add never collides with — and never renumbers — an id the agent already
 * authored. Pure and deterministic: the same `existingIds` set + the same
 * number of prior adds always yields the same id, which is what the M4 model
 * tests pin (id-stable add).
 *
 * Re-implemented here (not imported) to keep this module zero-dependency and
 * importable by the bare Node test harness; the scheme is byte-identical to
 * `opaqueFactory().mint` for the `b<n>` shape.
 *
 * @param {Iterable<string>} existingIds
 * @param {number} [ordinal=0]  how many ids were already minted in this batch
 * @returns {string}
 */
export function mintAddedBlockId(existingIds, ordinal = 0) {
  const taken =
    existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  let counter = 0;
  for (const id of taken) {
    const m = /^b(\d+)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > counter) counter = n;
    }
  }
  // Advance past any ids already minted earlier in the same add batch.
  counter += ordinal;
  let candidate;
  do {
    counter += 1;
    candidate = `b${counter}`;
  } while (taken.has(candidate));
  return candidate;
}

/**
 * Derive the reviewer's working document from the loaded base document and the
 * accumulated editor interaction state.
 *
 * Block identity is preserved: an existing block's id is NEVER minted or
 * renumbered here. A block with no edits, no applicable answer, and not in the
 * delete set passes through byte-unchanged, so a review with NO structural
 * edits yields a working doc that canonicalizes equal to the base (no-op
 * correctness — the PRD path relies on that to skip a spurious revision).
 *
 * @param {{ id: string, meta: object, blocks: Array<Record<string, unknown>> }} baseDoc
 * @param {{
 *   edits?:   Record<string, Record<string, unknown>>,
 *   answers?: Record<string, string>,
 *   deletes?: string[] | Set<string>,
 *   adds?:    Array<{ afterId: string | null, block: Record<string, unknown> }>,
 *   order?:   string[],
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
  const deletes =
    state.deletes instanceof Set
      ? state.deletes
      : new Set(Array.isArray(state.deletes) ? state.deletes : []);
  const adds = Array.isArray(state.adds) ? state.adds : [];
  const order = Array.isArray(state.order) ? state.order : [];

  // Pass 1: patch + answer + delete existing blocks (id-stable).
  const patched = [];
  for (const block of baseDoc.blocks) {
    const id = block && block.id;

    if (typeof id === 'string' && deletes.has(id)) {
      // Reviewer removed this block — drop it. Nothing else renumbers.
      continue;
    }

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

    // Field patches (ANY field of ANY kind) are merged shallowly over the
    // block. An empty patch is a no-op (the block passes through byte-unchanged
    // so the no-op-equality check holds).
    if (typeof id === 'string' && hasOwn(edits, id)) {
      const patch = edits[id];
      if (isObj(patch) && Object.keys(patch).length > 0) {
        next = { ...next, ...patch };
      }
    }

    patched.push(next);
  }

  // Pass 2: splice in added blocks. Each add is positioned AFTER `afterId`
  // (null → prepend; unknown id → append). Added blocks are id-stable: a
  // caller-supplied non-empty string id that does NOT collide is honoured
  // verbatim; otherwise (no id, or a supplied id already taken by a live block
  // or an earlier add in this batch) a deterministic collision-free id is
  // minted that never clobbers an existing one. Ordering of multiple adds at
  // the same anchor preserves insertion order (stable for the no-op /
  // round-trip tests).
  let blocks = patched;
  if (adds.length > 0) {
    const liveIds = new Set();
    for (const b of patched) {
      if (b && typeof b.id === 'string') liveIds.add(b.id);
    }
    const prepended = [];
    const afterMap = new Map(); // anchorId → block[]
    const appended = [];

    for (const entry of adds) {
      if (!isObj(entry) || !isObj(entry.block)) continue;
      let block = entry.block;
      const supplied = block.id;
      if (
        typeof supplied !== 'string' ||
        supplied.length === 0 ||
        liveIds.has(supplied)
      ) {
        // No usable id OR a SUPPLIED id that already collides with a live id
        // (base block or an earlier add in this batch) → mint a fresh one. This
        // makes the docstring's "never clobbers an existing one" actually true:
        // a colliding supplied id is re-minted, not silently merged onto the
        // existing block. liveIds grows each iteration, so the seed-past-highest
        // mint is monotonic + collision-free across the batch (no ordinal
        // bookkeeping needed — that would double-count).
        const id = mintAddedBlockId(liveIds);
        liveIds.add(id);
        block = { ...block, id };
      } else {
        liveIds.add(supplied);
      }

      const afterId = entry.afterId;
      if (afterId === null || afterId === undefined) {
        prepended.push(block);
      } else if (liveIds.has(afterId)) {
        const arr = afterMap.get(afterId) || [];
        arr.push(block);
        afterMap.set(afterId, arr);
      } else {
        // Unknown anchor — never drop the reviewer's block; append it.
        appended.push(block);
      }
    }

    const spliced = [...prepended];
    for (const b of patched) {
      spliced.push(b);
      if (b && typeof b.id === 'string' && afterMap.has(b.id)) {
        for (const added of afterMap.get(b.id)) spliced.push(added);
      }
    }
    for (const b of appended) spliced.push(b);
    blocks = spliced;
  }

  // Pass 3 (M5): reorder. `order` is a pure permutation of the post-splice
  // working ids — it never mints/renumbers an id and never adds/drops a block.
  // Live blocks whose id is listed in `order` come first, in `order`'s
  // sequence (first occurrence wins). Any live block NOT in `order` keeps its
  // original post-splice relative position and is appended after the ordered
  // ones (never dropped). Ids in `order` that are not live (deleted via
  // `deletes`, or never existed) are skipped — `deletes` wins over `order`.
  // An empty/absent `order`, or one that names exactly the current sequence,
  // is a byte no-op (same array contents, same per-block identity).
  if (order.length > 0) {
    const byId = new Map();
    for (const b of blocks) {
      if (b && typeof b.id === 'string' && !byId.has(b.id)) byId.set(b.id, b);
    }
    const taken = new Set();
    const ordered = [];
    for (const id of order) {
      if (typeof id !== 'string') continue;
      if (taken.has(id)) continue; // duplicate id in `order` — first wins
      if (!byId.has(id)) continue; // not live (deleted/unknown) — skip
      ordered.push(byId.get(id));
      taken.add(id);
    }
    // Re-append any live block `order` did not mention, in original order.
    for (const b of blocks) {
      if (b && typeof b.id === 'string' && taken.has(b.id)) continue;
      ordered.push(b);
    }
    blocks = ordered;
  }

  return { ...baseDoc, blocks };
}
