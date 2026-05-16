/**
 * planos — zero-dependency structural diff engine.
 *
 * Contract: docs/design.md §7 (Structural Diff) + §4 (block schema), plan
 * Step 3.3, AC-14. Replaces plannotator's ~600 LOC text-diff engine with a
 * small, deterministic, ID-keyed structural one.
 *
 *   Outer pass (by ID-set + position): every block is classified as EXACTLY
 *   one of `added` | `removed` | `moved` | `modified` | `unchanged`.
 *
 *   Inner pass (modified blocks only): word-level diff over the text-bearing
 *   fields, returning token runs tagged equal/added/removed (the
 *   `diffWordsWithSpace` IDEA only — hand-rolled, zero-dep).
 *
 * This module is in the artifact/ID transitive set, so AC-17 import
 * cleanliness applies: zero runtime dependencies, `node:` builtins only, no
 * model, no network, no third-party imports. Pure logic — same input always
 * yields byte-identical output (deterministic, stable ordering).
 *
 * The SPA revision selector (US-014) calls `diffDocuments` and renders the
 * result; this module exposes only a clean API and never touches the DOM.
 */

/** Block classification statuses (AC-14). Exactly one applies per block. */
export const DIFF_STATUS = Object.freeze({
  ADDED: "added",
  REMOVED: "removed",
  MOVED: "moved",
  MODIFIED: "modified",
  UNCHANGED: "unchanged",
});

/**
 * Per-kind text-bearing fields, in canonical order. The inner word-diff runs
 * over exactly these fields for `modified` blocks (design.md §7). Kept in sync
 * with the v1 schema (validate.mjs / types.d.ts §4).
 */
const TEXT_FIELDS = Object.freeze({
  section: ["title"],
  prose: ["md"],
  objective: ["text"],
  task: ["title", "detail"],
  decision: ["question"],
  risk: ["description", "mitigation"],
  openQuestion: ["question", "answer"],
  // v2 kinds — text-bearing fields only (design.md §4). `table` is
  // INTENTIONALLY omitted: its content is purely structural (columns/rows),
  // so canonical structural equality is the correct change detector for it.
  phase: ["title"],
  tradeoff: ["axis"],
  fileChange: ["path", "rationale"],
  code: ["content"],
  diagram: ["mermaid"],
});

const isObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Stable, deterministic canonical JSON: object keys are sorted recursively so
 * key-order differences are NOT treated as content changes. Arrays keep order
 * (order is semantically meaningful for blocks/options/criteria). Used for the
 * structural-equality test that distinguishes `moved` from `modified`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Structural equality of two blocks, ignoring object key order. Two blocks are
 * equal iff their canonical JSON matches. (`id` is part of the comparison but
 * by construction both blocks share the same id when this is called.)
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function blocksEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Tokenize a string into a run of words and the whitespace between them,
 * preserving every character exactly (the `diffWordsWithSpace` idea: spaces
 * are their own tokens, never merged away). Splitting on word/whitespace
 * boundaries keeps the diff stable and reversible — concatenating the tokens
 * reproduces the input verbatim.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (text === "" || text == null) return [];
  // Each token is either a maximal run of non-whitespace or a maximal run of
  // whitespace. The regex consumes the whole string with no gaps or overlap.
  return String(text).match(/\s+|\S+/g) || [];
}

/**
 * Hand-rolled word-level diff (the `diffWordsWithSpace` IDEA only — zero-dep).
 * Classic LCS over token arrays, emitting runs tagged equal/added/removed.
 * Deterministic: for a given (prev, next) the run sequence is fixed. Removed
 * runs are emitted before added runs at the same divergence point so output
 * ordering is stable across runs.
 *
 * @param {string} prevText
 * @param {string} nextText
 * @returns {{ type: "equal"|"added"|"removed", value: string }[]}
 */
export function wordDiff(prevText, nextText) {
  const a = tokenize(prevText);
  const b = tokenize(nextText);
  const n = a.length;
  const m = b.length;

  // LCS length table. (n+1) x (m+1), bottom-up.
  const lcs = [];
  for (let i = 0; i <= n; i++) {
    lcs.push(new Array(m + 1).fill(0));
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  /** @type {{ type: "equal"|"added"|"removed", value: string }[]} */
  const runs = [];
  /** Append to the trailing run when same type, else open a new run. */
  const push = (type, value) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) {
      last.value += value;
    } else {
      runs.push({ type, value });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      // Prefer consuming the removed token first → stable removed-before-added.
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("removed", a[i]);
    i++;
  }
  while (j < m) {
    push("added", b[j]);
    j++;
  }
  return runs;
}

/**
 * Compute the inner word-diff for a modified block: one entry per text-bearing
 * field of its kind whose value actually changed. Fields equal across
 * revisions are omitted (only differing fields carry runs). Returns `[]` for
 * kinds with no text fields or when nothing textual changed (e.g. only a
 * non-text field like `task.status` changed).
 *
 * @param {object} prevBlock
 * @param {object} nextBlock
 * @returns {{ field: string, runs: { type: string, value: string }[] }[]}
 */
function fieldDiffs(prevBlock, nextBlock) {
  const fields = TEXT_FIELDS[nextBlock.kind] || [];
  const out = [];
  for (const field of fields) {
    const prevVal = prevBlock[field] == null ? "" : String(prevBlock[field]);
    const nextVal = nextBlock[field] == null ? "" : String(nextBlock[field]);
    if (prevVal === nextVal) continue;
    out.push({ field, runs: wordDiff(prevVal, nextVal) });
  }
  return out;
}

/**
 * Indices (into `seqA`) of the elements that lie on a Longest Common
 * Subsequence of `seqA` and `seqB`. Used to find which surviving blocks kept
 * their relative order (on the LCS ⇒ stable) versus which were genuinely
 * reordered (off the LCS ⇒ moved). Deterministic tie-break: when the two LCS
 * directions are equal, descend the `seqA` axis first, so the chosen stable
 * subsequence is fixed for a given pair of inputs.
 *
 * @param {string[]} seqA
 * @param {string[]} seqB
 * @returns {Set<string>} the ids from `seqA` that are on the chosen LCS
 */
function lcsStableIds(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  const lcs = [];
  for (let i = 0; i <= n; i++) lcs.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        seqA[i] === seqB[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const stable = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (seqA[i] === seqB[j]) {
      stable.add(seqA[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return stable;
}

/**
 * Read the ordered block list from a document or a bare block array. Tolerates
 * `null`/`undefined`/missing `blocks` (treated as empty — supports the
 * empty-prev / empty-next edge cases). Blocks without a non-empty string `id`
 * are skipped (they cannot participate in ID-keyed diffing).
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
 * Structural diff between two document revisions.
 *
 * Outer pass (by ID-set + position):
 *   - `added`     — id present in next, absent in prev.
 *   - `removed`   — id present in prev, absent in next.
 *   - `moved`     — same id, content structurally equal, but its order
 *                   RELATIVE TO OTHER SURVIVING blocks changed (a real
 *                   reorder). Absolute index shifts caused purely by
 *                   add/remove/move of *other* blocks do NOT count — only an
 *                   actual relative reordering does (LCS of the common-id
 *                   sequence: ids off the longest stable subsequence moved).
 *   - `modified`  — same id, content differs. (Takes precedence over `moved`:
 *                   a simultaneous move+modify is classified `modified`.)
 *   - `unchanged` — same id, content structurally equal, and relative order
 *                   among surviving blocks preserved.
 *
 * Kind change is NOT a modification: an id reused with a different `kind` is
 * treated as `removed` (prev) + `added` (next), never `modified`.
 *
 * Determinism / stable ordering: the returned `blocks` array lists every
 * next-revision block in its next-revision order, followed by `removed` blocks
 * in their prev-revision order. Same inputs always yield byte-identical output.
 *
 * @param {unknown} prevDoc  Previous revision (Document or Block[]); may be
 *                            null/undefined/empty → every next block is `added`.
 * @param {unknown} nextDoc  Next revision (Document or Block[]); may be
 *                            null/undefined/empty → every prev block is `removed`.
 * @returns {{
 *   blocks: { id: string, status: string, kind: string,
 *             prevIndex: number|null, nextIndex: number|null,
 *             block: object|null, prevBlock: object|null,
 *             fieldDiffs?: { field: string, runs: object[] }[] }[],
 *   byId: { [id: string]: object }
 * }}
 */
export function diffDocuments(prevDoc, nextDoc) {
  const prevBlocks = readBlocks(prevDoc);
  const nextBlocks = readBlocks(nextDoc);

  /** @type {Map<string, { block: object, index: number }>} */
  const prevById = new Map();
  prevBlocks.forEach((block, index) => {
    prevById.set(block.id, { block, index });
  });
  /** @type {Map<string, { block: object, index: number }>} */
  const nextById = new Map();
  nextBlocks.forEach((block, index) => {
    nextById.set(block.id, { block, index });
  });

  // Common-id sequences: ids that survive into next with the SAME kind, taken
  // in prev order and in next order. Ids on the LCS of these two sequences
  // kept their relative order (stable); the rest were genuinely reordered.
  const survives = (id) => {
    const p = prevById.get(id);
    const x = nextById.get(id);
    return p && x && p.block.kind === x.block.kind;
  };
  const prevCommon = prevBlocks
    .map((b) => b.id)
    .filter((id) => nextById.has(id) && survives(id));
  const nextCommon = nextBlocks
    .map((b) => b.id)
    .filter((id) => prevById.has(id) && survives(id));
  const stableIds = lcsStableIds(prevCommon, nextCommon);

  const results = [];

  // Pass 1: every next-revision block, in next order (stable).
  nextBlocks.forEach((nextBlock, nextIndex) => {
    const prior = prevById.get(nextBlock.id);

    if (!prior) {
      results.push({
        id: nextBlock.id,
        status: DIFF_STATUS.ADDED,
        kind: nextBlock.kind,
        prevIndex: null,
        nextIndex,
        block: nextBlock,
        prevBlock: null,
      });
      return;
    }

    const prevBlock = prior.block;

    // Kind change is treated as removed+added, NOT modified. The prev side is
    // emitted as `removed` in pass 2 (prior.block stays in prevById).
    if (prevBlock.kind !== nextBlock.kind) {
      results.push({
        id: nextBlock.id,
        status: DIFF_STATUS.ADDED,
        kind: nextBlock.kind,
        prevIndex: null,
        nextIndex,
        block: nextBlock,
        prevBlock: null,
      });
      return;
    }

    const equal = blocksEqual(prevBlock, nextBlock);
    // A block moved iff its order RELATIVE to other surviving blocks changed,
    // i.e. it is not on the longest stable common subsequence. Pure absolute
    // index shifts (caused by other blocks' add/remove/move) are NOT moves.
    const relocated = !stableIds.has(nextBlock.id);

    let status;
    if (!equal) {
      // Content differs — `modified` regardless of whether it also moved
      // (move+modify ⇒ modified).
      status = DIFF_STATUS.MODIFIED;
    } else if (relocated) {
      status = DIFF_STATUS.MOVED;
    } else {
      status = DIFF_STATUS.UNCHANGED;
    }

    const entry = {
      id: nextBlock.id,
      status,
      kind: nextBlock.kind,
      prevIndex: prior.index,
      nextIndex,
      block: nextBlock,
      prevBlock,
    };
    if (status === DIFF_STATUS.MODIFIED) {
      entry.fieldDiffs = fieldDiffs(prevBlock, nextBlock);
    }
    results.push(entry);
  });

  // Pass 2: prev-revision blocks absent from next, OR whose id was reused with
  // a different kind — emitted as `removed`, in prev order (stable).
  prevBlocks.forEach((prevBlock, prevIndex) => {
    const successor = nextById.get(prevBlock.id);
    const survives = successor && successor.block.kind === prevBlock.kind;
    if (survives) return;
    results.push({
      id: prevBlock.id,
      status: DIFF_STATUS.REMOVED,
      kind: prevBlock.kind,
      prevIndex,
      nextIndex: null,
      block: null,
      prevBlock,
    });
  });

  /** @type {{ [id: string]: object }} */
  const byId = Object.create(null);
  for (const entry of results) {
    // Pass 1 (next blocks, incl. added) precedes pass 2 (removed). On a
    // kind-change reuse the next-side `added` entry registers first; the
    // prev-side `removed` keeps the same id, so prefer the surviving/next
    // entry and never let a later `removed` clobber it.
    if (byId[entry.id] === undefined || entry.status !== DIFF_STATUS.REMOVED) {
      byId[entry.id] = entry;
    }
  }

  return { blocks: results, byId };
}
