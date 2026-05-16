/**
 * planos — zero-dependency hand-rolled FeedbackEnvelope validator + renderer.
 *
 * Contract: docs/design.md §4 ("Feedback envelope (browser → agent)"),
 * plan Step 2f.4, AC-5, AC-9, AC-10.
 *
 * The browser SPA (US-017 / Milestone 3) produces a `FeedbackEnvelope`; this
 * module is the SERVER-SIDE half: it validates the envelope shape (field-level
 * errors, mirroring validate.mjs style), renders the `ops[]` as human-readable
 * directive text for the deny→revise loop, and exposes the `baseRevision` race
 * guard (AC-10). Validation is exact to the design.md §4 `Edit` union:
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
 * Every error string is field-level and shaped to feed the corrective deny
 * preamble, exactly like the document validator.
 *
 * Zero runtime dependencies. ES module. No network, no model, no clock.
 */

'use strict';

/** The exact set of envelope decisions. */
export const ENVELOPE_DECISIONS = Object.freeze(['approve', 'revise']);

/** The exact `Edit` union op discriminants, in canonical order. */
export const EDIT_OPS = Object.freeze([
  'editBlock',
  'deleteBlock',
  'moveBlock',
  'comment',
  'answer',
  'addBlock',
]);

const OP_LIST = EDIT_OPS.join('|');

const isObject = (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isInteger = (v) => typeof v === 'number' && Number.isInteger(v);

/** A short, safe rendering of a value for inclusion in an error message. */
function show(v) {
  if (typeof v === 'string') return `'${v}'`;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return String(v);
}

function requireNonEmptyString(holder, key, path, errors) {
  const v = holder[key];
  if (!isNonEmptyString(v)) {
    errors.push(
      `${path}.${key} is required and must be a non-empty string but is ${show(
        v,
      )}`,
    );
    return false;
  }
  return true;
}

/**
 * Validate a single `Edit` union member at `path`. Pushes field-level errors.
 *
 * @param {unknown} op
 * @param {string} path
 * @param {string[]} errors
 */
function validateEdit(op, path, errors) {
  if (!isObject(op)) {
    errors.push(`${path} must be an object Edit but is ${show(op)}`);
    return;
  }
  if (!EDIT_OPS.includes(op.op)) {
    errors.push(
      `${path}.op ${show(
        op.op,
      )} is not a valid Edit op (expected one of ${OP_LIST})`,
    );
    return;
  }

  switch (op.op) {
    case 'editBlock': {
      requireNonEmptyString(op, 'blockId', path, errors);
      if (!isObject(op.patch)) {
        errors.push(
          `${path} (editBlock) requires 'patch' to be a partial-Block object but is ${show(
            op.patch,
          )}`,
        );
      }
      break;
    }
    case 'deleteBlock': {
      requireNonEmptyString(op, 'blockId', path, errors);
      break;
    }
    case 'moveBlock': {
      requireNonEmptyString(op, 'blockId', path, errors);
      // afterBlockId is REQUIRED but may be null (move to head) or a string id.
      if (!('afterBlockId' in op)) {
        errors.push(
          `${path} (moveBlock) requires 'afterBlockId' (a block id string, or null to move to the top)`,
        );
      } else if (op.afterBlockId !== null && !isNonEmptyString(op.afterBlockId)) {
        errors.push(
          `${path}.afterBlockId (moveBlock) must be a non-empty string id or null but is ${show(
            op.afterBlockId,
          )}`,
        );
      }
      break;
    }
    case 'comment': {
      requireNonEmptyString(op, 'blockId', path, errors);
      if (!isString(op.text)) {
        errors.push(
          `${path} (comment) requires 'text' to be a string but is ${show(
            op.text,
          )}`,
        );
      }
      if (op.anchor !== undefined) {
        if (!isObject(op.anchor)) {
          errors.push(
            `${path}.anchor (comment) optional field must be a {start,end} object when present but is ${show(
              op.anchor,
            )}`,
          );
        } else {
          if (!isInteger(op.anchor.start)) {
            errors.push(
              `${path}.anchor.start (comment) must be an integer offset but is ${show(
                op.anchor.start,
              )}`,
            );
          }
          if (!isInteger(op.anchor.end)) {
            errors.push(
              `${path}.anchor.end (comment) must be an integer offset but is ${show(
                op.anchor.end,
              )}`,
            );
          }
        }
      }
      break;
    }
    case 'answer': {
      requireNonEmptyString(op, 'blockId', path, errors);
      if (!isString(op.answer)) {
        errors.push(
          `${path} (answer) requires 'answer' to be a string but is ${show(
            op.answer,
          )}`,
        );
      }
      break;
    }
    case 'addBlock': {
      // afterBlockId REQUIRED, may be null (insert at the top).
      if (!('afterBlockId' in op)) {
        errors.push(
          `${path} (addBlock) requires 'afterBlockId' (a block id string, or null to insert at the top)`,
        );
      } else if (op.afterBlockId !== null && !isNonEmptyString(op.afterBlockId)) {
        errors.push(
          `${path}.afterBlockId (addBlock) must be a non-empty string id or null but is ${show(
            op.afterBlockId,
          )}`,
        );
      }
      if (!isObject(op.block)) {
        errors.push(
          `${path} (addBlock) requires 'block' to be a Block object but is ${show(
            op.block,
          )}`,
        );
      } else {
        if (!isNonEmptyString(op.block.id)) {
          errors.push(
            `${path}.block.id (addBlock) is required and must be a non-empty string but is ${show(
              op.block.id,
            )}`,
          );
        }
        if (!isNonEmptyString(op.block.kind)) {
          errors.push(
            `${path}.block.kind (addBlock) is required and must be a non-empty string but is ${show(
              op.block.kind,
            )}`,
          );
        }
      }
      break;
    }
    default:
      // Unreachable — guarded by the EDIT_OPS.includes check above.
      break;
  }
}

/**
 * Validate `obj` against the design.md §4 `FeedbackEnvelope` contract.
 *
 * @param {unknown} obj
 * @returns {{ ok: true, envelope: import("./types").FeedbackEnvelope }
 *          | { ok: false, errors: string[] }}
 */
export function validateEnvelope(obj) {
  const errors = [];

  if (!isObject(obj)) {
    return {
      ok: false,
      errors: [
        `FeedbackEnvelope must be a JSON object but is ${show(
          obj,
        )} (a structured browser→agent envelope is expected)`,
      ],
    };
  }

  if (!ENVELOPE_DECISIONS.includes(obj.decision)) {
    errors.push(
      `decision ${show(
        obj.decision,
      )} is not valid (expected one of ${ENVELOPE_DECISIONS.join('|')})`,
    );
  }

  if (!isNonEmptyString(obj.documentId)) {
    errors.push(
      `documentId is required and must be a non-empty string (the revision-chain key) but is ${show(
        obj.documentId,
      )}`,
    );
  }

  if (!isInteger(obj.baseRevision)) {
    errors.push(
      `baseRevision is required and must be an integer (the revision the human edited against — the race guard) but is ${show(
        obj.baseRevision,
      )}`,
    );
  }

  if (!Array.isArray(obj.ops)) {
    errors.push(
      `ops is required and must be an array of Edit objects but is ${show(
        obj.ops,
      )}`,
    );
  } else {
    for (let i = 0; i < obj.ops.length; i++) {
      validateEdit(obj.ops[i], `ops[${i}]`, errors);
    }
  }

  if (obj.globalComment !== undefined && !isString(obj.globalComment)) {
    errors.push(
      `globalComment optional field must be a string when present but is ${show(
        obj.globalComment,
      )}`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    envelope: /** @type {import("./types").FeedbackEnvelope} */ (obj),
  };
}

// ---------------------------------------------------------------------------
// baseRevision race guard (AC-10, design.md §6 mechanism #4)
// ---------------------------------------------------------------------------

/**
 * Detect a stale-ops race: the human edited against `baseRevision` but the
 * canonical document has since moved to `meta.revision`. When they differ the
 * server MUST NOT apply the (stale) ops — it signals a re-render instead
 * (design.md §6: "if the agent revised while the human was editing, detect
 * mismatch and re-render rather than apply stale ops").
 *
 * Pure and side-effect-free; the exit/decision path consumes the result.
 *
 * @param {number} canonicalRevision  `doc.meta.revision` of the current doc.
 * @param {number} baseRevision       `envelope.baseRevision` from the browser.
 * @returns {{ stale: boolean, canonicalRevision: number, baseRevision: number,
 *             action: "apply" | "re-render" }}
 */
export function checkBaseRevision(canonicalRevision, baseRevision) {
  const stale = canonicalRevision !== baseRevision;
  return {
    stale,
    canonicalRevision,
    baseRevision,
    action: stale ? 're-render' : 'apply',
  };
}

// ---------------------------------------------------------------------------
// Human-readable ops rendering (AC-5 — deferred from US-008 Step 2-thin.2)
// ---------------------------------------------------------------------------

/** Clip a value to a single scannable line for the ops rendering. */
function oneLine(v, max = 200) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const collapsed = (s ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length > max
    ? `${collapsed.slice(0, max - 3)}...`
    : collapsed;
}

/**
 * Render a single `Edit` op as one human-readable directive line. The agent
 * is text-in/text-out and we do NOT assume it can diff JSON itself
 * (design.md §4) — spell out exactly what the human changed.
 *
 * @param {object} op
 * @returns {string}
 */
function renderOp(op) {
  switch (op.op) {
    case 'editBlock':
      return `- EDIT block \`${op.blockId}\`: apply this patch — ${oneLine(
        JSON.stringify(op.patch),
      )}`;
    case 'deleteBlock':
      return `- DELETE block \`${op.blockId}\`: remove it entirely.`;
    case 'moveBlock':
      return op.afterBlockId === null
        ? `- MOVE block \`${op.blockId}\` to the TOP of the document.`
        : `- MOVE block \`${op.blockId}\` to immediately AFTER block \`${op.afterBlockId}\`.`;
    case 'comment':
      return `- COMMENT on block \`${op.blockId}\`${
        op.anchor
          ? ` (chars ${op.anchor.start}-${op.anchor.end})`
          : ''
      }: ${oneLine(op.text)}`;
    case 'answer':
      return `- ANSWER openQuestion block \`${op.blockId}\`: ${oneLine(
        op.answer,
      )}`;
    case 'addBlock':
      return op.afterBlockId === null
        ? `- ADD a new \`${op.block.kind}\` block (id \`${op.block.id}\`) at the TOP: ${oneLine(
            JSON.stringify(op.block),
          )}`
        : `- ADD a new \`${op.block.kind}\` block (id \`${op.block.id}\`) AFTER block \`${op.afterBlockId}\`: ${oneLine(
            JSON.stringify(op.block),
          )}`;
    default:
      return `- (unrecognized op ${show(op.op)})`;
  }
}

/**
 * Render a validated envelope's `ops[]` (and `globalComment`) as a
 * human-readable directive section for the deny→revise preamble. This is the
 * piece explicitly DEFERRED from US-008 Step 2-thin.2 — implemented now per
 * Step 2f.4 / AC-5.
 *
 * @param {import("./types").FeedbackEnvelope} envelope
 * @returns {string}
 */
export function renderOpsHuman(envelope) {
  const ops = Array.isArray(envelope.ops) ? envelope.ops : [];
  const lines = [
    '## Requested changes (apply EVERY item below)',
    '',
    'The human reviewed the document and made the following structured edits.',
    'Apply each one precisely, then re-emit the FULL v1 block document.',
    '',
  ];
  if (ops.length === 0) {
    lines.push('_(no per-block ops — see the global comment / reviewer feedback)_');
  } else {
    for (const op of ops) lines.push(renderOp(op));
  }
  if (
    typeof envelope.globalComment === 'string' &&
    envelope.globalComment.trim().length > 0
  ) {
    lines.push('', '### Global comment', '', envelope.globalComment.trim());
  }
  return lines.join('\n');
}
