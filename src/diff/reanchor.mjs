/**
 * planos — deterministic re-anchoring fallback (design.md §6 mechanism #3,
 * plan Step 3.4, AC-13).
 *
 * The hard problem: block `id`s are agent-minted (design.md §4), so a revising
 * agent can mint a FRESH id for a block whose intent is unchanged. When that
 * happens, comments anchored to the old id would be orphaned even though an
 * obviously-corresponding block exists in the next revision. Mechanisms #1/#2
 * (instruction + deny-echo) try to prevent it; THIS is the last-resort,
 * model-free fallback that carries comments forward by content similarity —
 * heuristic, conservative, and ALWAYS surfaced to the user for verification.
 *
 * This module is in the artifact/ID transitive set, so AC-17 import
 * cleanliness applies: zero runtime dependencies, no `node:` imports needed,
 * no model, no network, no third-party imports. Pure logic — same input
 * always yields byte-identical output (deterministic, stable ordering).
 *
 * --- AC-13 similarity function (implemented EXACTLY) -----------------------
 *
 *   sim(a, b) = 0                              if a.kind !== b.kind
 *             = jaccard(tokens(norm(Pa)),      otherwise
 *                       tokens(norm(Pb)))
 *
 * where:
 *   - `P` is the kind's PRIMARY TEXT FIELD (mapping below);
 *   - `norm` = lowercase → collapse whitespace → strip punctuation;
 *   - `tokens` = whitespace-split token SET (set-based Jaccard, not multiset);
 *   - `jaccard(A,B) = |A ∩ B| / |A ∪ B|`, with `jaccard(∅,∅) = 0` (two
 *     empty-text blocks carry NO evidence of correspondence → never auto-carry).
 *
 * --- Primary text field per kind -----------------------------------------
 *
 *   section      → title           (AC-13)
 *   task         → title           (AC-13)
 *   decision     → title*          (AC-13 lists `title`; the v1 `decision`
 *                                    block has no `title` — its primary text
 *                                    is `question`, so we map decision→question
 *                                    and fall back through `title` for forward
 *                                    compatibility. See PRIMARY_FIELD below.)
 *   objective    → text            (AC-13 lists `title`; v1 `objective` has no
 *                                    `title`, its narrative field is `text`.)
 *   openQuestion → question        (AC-13)
 *   prose        → md (first 200)  (AC-13: "first 200 chars of `md`")
 *   risk         → description     (task spec; AC-13's enumerated list omits
 *                                    risk — `description` is risk's primary
 *                                    narrative field, consistent with the
 *                                    structural-diff TEXT_FIELDS mapping.)
 *
 * AC-13 names the field by intent ("primary text field"); where the v1 schema
 * (src/schema/types.d.ts §4) names that field differently than AC-13's
 * shorthand, the schema field wins and the mapping is documented here so the
 * choice is auditable. Each kind also lists FALLBACK fields tried in order
 * (first present, non-empty string wins) so the function is robust to schema
 * evolution without changing behavior for v1 blocks.
 *
 * --- Carry-forward rule (margin guard against decoys) ---------------------
 *
 * For each commented old block, score it against every candidate new block
 * (deterministic order = next-revision order). Carry the comment forward to
 * the best candidate IFF:
 *
 *     best.score >= CARRY_THRESHOLD (0.6)
 *   AND
 *     best.score - secondBest.score >= MARGIN (0.15)
 *
 * The MARGIN is the decoy guard: a genuinely-new block that superficially
 * resembles an old one will score close to the true match, collapsing the
 * margin and FORCING an orphan rather than a mis-attach. A confident,
 * unambiguous match clears both bars. Anything else → orphaned + flagged.
 * Carried comments are flagged ("comment re-attached — verify"); no-carry
 * comments are flagged "orphaned". Nothing is ever carried silently.
 */

/** Best-candidate score floor for auto carry-forward (AC-13). */
export const CARRY_THRESHOLD = 0.6;

/** Required lead of best over second-best — the decoy margin guard (AC-13). */
export const MARGIN = 0.15;

/** Human-facing flag on a re-attached (carried) comment — verify required. */
export const FLAG_REATTACHED = "comment re-attached — verify";

/** Human-facing reason on a comment that could not be safely carried. */
export const REASON_ORPHANED = "orphaned";

/**
 * Per-kind primary-text-field resolution order. The first field that is a
 * present, non-empty string is the primary text. Ordered so the v1 schema's
 * actual field (src/schema/types.d.ts §4) is tried first, with AC-13's
 * shorthand names kept as forward-compatible fallbacks.
 */
const PRIMARY_FIELD = Object.freeze({
  section: ["title"],
  task: ["title"],
  decision: ["question", "title"],
  objective: ["text", "title"],
  openQuestion: ["question"],
  prose: ["md"],
  risk: ["description"],
  // v2 kinds — each maps to its primary narrative field (mirrors the
  // structural-diff TEXT_FIELDS choice). `table` has no narrative text; its
  // first column header is the most stable identity signal available.
  phase: ["title"],
  tradeoff: ["axis"],
  fileChange: ["path"],
  code: ["filename", "content"],
  table: ["columns"],
  diagram: ["mermaid"],
});

/** prose's primary text is the FIRST 200 chars of `md` (AC-13). */
const PROSE_MD_LIMIT = 200;

const isObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Pull the kind's raw primary text out of a block (pre-normalization). Returns
 * "" when the block is malformed, the kind is unknown, or no primary field is
 * a non-empty string. `prose` is truncated to the first 200 chars of `md`
 * per AC-13.
 *
 * @param {unknown} block
 * @returns {string}
 */
function primaryText(block) {
  if (!isObject(block) || typeof block.kind !== "string") return "";
  const fields = PRIMARY_FIELD[block.kind];
  if (!fields) return "";
  for (const field of fields) {
    const raw = block[field];
    if (typeof raw === "string" && raw.length > 0) {
      if (block.kind === "prose" && field === "md") {
        return raw.slice(0, PROSE_MD_LIMIT);
      }
      return raw;
    }
  }
  return "";
}

/**
 * Normalize a string for similarity: lowercase, strip punctuation, collapse
 * all whitespace runs to a single space, trim. "Strip punctuation" removes any
 * char that is not a letter, number, or whitespace (Unicode-aware), so token
 * boundaries are driven purely by alphanumerics — `re-anchor`, `re anchor`
 * and `re_anchor` all normalize identically. Deterministic and pure.
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    // Strip punctuation/symbols: keep only Unicode letters, numbers, and
    // whitespace. Everything else becomes a space (also splits glued tokens
    // like "old,new" → "old new").
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    // Collapse every whitespace run to a single space.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token SET of a block's normalized primary text. Set (not multiset) is what
 * AC-13's "token-set Jaccard" specifies — repeated words count once.
 *
 * @param {unknown} block
 * @returns {Set<string>}
 */
function tokenSet(block) {
  const norm = normalize(primaryText(block));
  if (norm === "") return new Set();
  return new Set(norm.split(" "));
}

/**
 * Jaccard index of two token sets: |A ∩ B| / |A ∪ B|. By convention here
 * `jaccard(∅, ∅) = 0`: two blocks with no extractable primary text carry no
 * positive evidence of correspondence, so they must never auto-carry.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) {
    if (b.has(tok)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * The AC-13 similarity function, implemented EXACTLY:
 *
 *   sim(a, b) = 0  if a.kind !== b.kind
 *             = token-set Jaccard over normalized primary text otherwise.
 *
 * Pure and deterministic. Exported for testing/inspection.
 *
 * @param {unknown} a  a block
 * @param {unknown} b  a block
 * @returns {number} similarity in [0, 1]
 */
export function sim(a, b) {
  if (!isObject(a) || !isObject(b)) return 0;
  if (a.kind !== b.kind) return 0;
  return jaccard(tokenSet(a), tokenSet(b));
}

/**
 * Read the ordered block list from a Document or a bare Block[]. Tolerates
 * null/undefined/missing `blocks` (→ empty). Blocks without a non-empty
 * string `id` are dropped (they cannot be anchored to). Mirrors the
 * structural-diff reader so the two engines agree on what "a block" is.
 *
 * @param {unknown} docOrBlocks
 * @returns {object[]}
 */
function readBlocks(docOrBlocks) {
  let blocks;
  if (Array.isArray(docOrBlocks)) {
    blocks = docOrBlocks;
  } else if (isObject(docOrBlocks) && Array.isArray(docOrBlocks.blocks)) {
    blocks = docOrBlocks.blocks;
  } else {
    blocks = [];
  }
  return blocks.filter(
    (b) => isObject(b) && typeof b.id === "string" && b.id.length > 0,
  );
}

/**
 * Deterministic re-anchoring of comments from `prevDoc` to `nextDoc`.
 *
 * For every comment whose anchor block id survived unchanged into the next
 * revision, NOTHING is done — the id-keyed anchor still resolves, so this
 * fallback stays out of the way (it exists ONLY for the agent-minted-new-id
 * failure case). For every comment whose old block id is absent from the next
 * revision, the old block is scored (via {@link sim}) against every next
 * block, and the comment is carried forward iff the best candidate clears
 * both the score threshold and the decoy margin guard.
 *
 * Determinism: candidates are scored in next-revision order; the best/second
 * best selection breaks score ties toward the EARLIER next-revision block, so
 * a given (prevDoc, nextDoc, comments) triple always yields byte-identical
 * output. No carry is ever silent — every outcome is flagged.
 *
 * @param {unknown} prevDoc  Previous revision (Document or Block[]).
 * @param {unknown} nextDoc  Next revision (Document or Block[]).
 * @param {Array<{ id?: string, commentId?: string, blockId?: string }>} comments
 *   Comments to re-anchor. Each must carry a comment identifier (`commentId`
 *   or `id`) and the OLD anchor block id (`blockId`). Comments missing either,
 *   or anchored to a still-present id, are skipped (the id anchor still works).
 * @returns {{
 *   reattached: { commentId: string, fromId: string, toId: string,
 *                 score: number, margin: number, flagged: true }[],
 *   orphaned:   { commentId: string, fromId: string, reason: string }[]
 * }}
 */
export function reanchorComments(prevDoc, nextDoc, comments) {
  const prevBlocks = readBlocks(prevDoc);
  const nextBlocks = readBlocks(nextDoc);

  const prevById = new Map();
  for (const b of prevBlocks) prevById.set(b.id, b);
  const nextIds = new Set(nextBlocks.map((b) => b.id));

  const reattached = [];
  const orphaned = [];

  const list = Array.isArray(comments) ? comments : [];
  for (const comment of list) {
    if (!isObject(comment)) continue;
    const commentId =
      typeof comment.commentId === "string" && comment.commentId.length > 0
        ? comment.commentId
        : typeof comment.id === "string" && comment.id.length > 0
          ? comment.id
          : null;
    const fromId =
      typeof comment.blockId === "string" && comment.blockId.length > 0
        ? comment.blockId
        : null;
    if (commentId === null || fromId === null) continue;

    // The id-keyed anchor still resolves — re-anchoring is unnecessary and
    // must not run (it would risk re-attaching a still-valid comment).
    if (nextIds.has(fromId)) continue;

    const oldBlock = prevById.get(fromId);
    if (oldBlock === undefined) {
      // The anchor block did not exist in prev either — nothing to match
      // against; the comment is orphaned by construction.
      orphaned.push({ commentId, fromId, reason: REASON_ORPHANED });
      continue;
    }

    // Score against every next block, in next-revision order, tracking the
    // best and second-best. Ties resolve toward the earlier next block
    // (strictly-greater comparison ⇒ first-seen wins) for determinism.
    let best = null; // { block, score }
    let second = null; // { block, score }
    for (const cand of nextBlocks) {
      const score = sim(oldBlock, cand);
      if (best === null || score > best.score) {
        second = best;
        best = { block: cand, score };
      } else if (second === null || score > second.score) {
        second = { block: cand, score };
      }
    }

    const bestScore = best === null ? 0 : best.score;
    const secondScore = second === null ? 0 : second.score;
    const marginValue = bestScore - secondScore;

    if (
      best !== null &&
      bestScore >= CARRY_THRESHOLD &&
      marginValue >= MARGIN
    ) {
      reattached.push({
        commentId,
        fromId,
        toId: best.block.id,
        score: bestScore,
        margin: marginValue,
        flagged: true,
      });
    } else {
      // Sub-threshold OR decoy-ambiguous (margin collapsed) → never carry.
      orphaned.push({ commentId, fromId, reason: REASON_ORPHANED });
    }
  }

  return { reattached, orphaned };
}
