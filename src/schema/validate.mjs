/**
 * planos — zero-dependency hand-rolled v1 schema validator.
 *
 * Contract: docs/design.md §4 (v1 core — Plan), plan Step 0.4, AC-6.
 *
 * Design intent: every emitted error string is field-level, human-readable, and
 * explicitly shaped to be dropped verbatim into the corrective deny→revise
 * preamble. The agent at the other end is text-in/text-out, so errors name the
 * exact JSON path, the offending value, and the expected shape. Error message
 * quality is load-bearing for the deny→revise convergence gate — keep it sharp.
 *
 * Zero runtime dependencies. ES module. No network, no model, no clock.
 */

/** The exact v1 core kinds, in canonical order, for messages and checks. */
export const V1_KINDS = Object.freeze([
  "section",
  "prose",
  "objective",
  "task",
  "decision",
  "risk",
  "openQuestion",
]);

/**
 * The exact v2 block kinds (design.md §4 lines 143-149), in canonical order.
 * v2 kinds are accepted in BOTH `type:"plan"` and `type:"prd"` documents
 * (ADR-0005 supersedes ADR-0002 D5(i): plans are now visually-approvable and
 * carry mermaid/tables/code/fileChange too). A `type:"diff-review"` doc still
 * accepts only v1∪v3 (R7 — v2 PRD kinds are NOT meaningful in a diff review).
 */
export const V2_KINDS = Object.freeze([
  "phase",
  "tradeoff",
  "fileChange",
  "code",
  "table",
  "diagram",
]);

/**
 * The exact v3 block kinds (design.md §4 lines 151-153), in canonical order.
 * v3 kinds are diff-review-scoped: only accepted in `type:"diff-review"`
 * documents (R7 — keeps each doc-type's contract tight, mirrors D5(i)). A
 * `type:"diff-review"` doc accepts v1∪v3 (NOT v2 PRD kinds — R7).
 */
export const V3_KINDS = Object.freeze(["diff"]);

const V2_KIND_SET = new Set(V2_KINDS);
const V3_KIND_SET = new Set(V3_KINDS);
const PRD_KIND_LIST = V1_KINDS.concat(V2_KINDS).join("|");
/** A `type:"diff-review"` doc accepts v1∪v3 (R7); v2 PRD kinds are rejected. */
const DIFF_REVIEW_KIND_LIST = V1_KINDS.concat(V3_KINDS).join("|");
const DIFF_STATUS = Object.freeze([
  "added",
  "modified",
  "deleted",
  "renamed",
  "binary",
]);
const DIFF_LINE_OPS = Object.freeze([" ", "+", "-"]);
const BLOCK_COMMENT_VERDICTS = Object.freeze(["accept", "reject", "comment"]);
const FILE_CHANGE_ACTIONS = Object.freeze(["add", "modify", "delete"]);
const DOC_STATUS = Object.freeze(["draft", "in-review", "approved"]);
const TASK_STATUS = Object.freeze(["todo", "doing", "done", "cut"]);
const LMH = Object.freeze(["L", "M", "H"]);
const DOC_TYPES = Object.freeze(["plan", "prd", "diff-review"]);

const isObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v) => typeof v === "string";
const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
const isInteger = (v) => typeof v === "number" && Number.isInteger(v);

/** A short, safe rendering of a value for inclusion in an error message. */
function show(v) {
  if (typeof v === "string") return `'${v}'`;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return String(v);
}

/**
 * Validate that `value` at JSON path `path` is a `string[]`. Pushes a
 * field-level error per problem into `errors`. Returns true if valid.
 */
function checkStringArray(value, path, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(
      `${path} (${label}) must be a string[] but is ${show(value)}`,
    );
    return false;
  }
  let ok = true;
  for (let i = 0; i < value.length; i++) {
    if (!isString(value[i])) {
      errors.push(
        `${path}[${i}] (${label}) must be a string but is ${show(value[i])}`,
      );
      ok = false;
    }
  }
  return ok;
}

function requireString(holder, key, path, errors, { nonEmpty = true } = {}) {
  const v = holder[key];
  const ok = nonEmpty ? isNonEmptyString(v) : isString(v);
  if (!ok) {
    errors.push(
      `${path}.${key} is required and must be a ${
        nonEmpty ? "non-empty " : ""
      }string but is ${show(v)}`,
    );
    return false;
  }
  return true;
}

function checkEnum(holder, key, allowed, path, errors) {
  const v = holder[key];
  if (!allowed.includes(v)) {
    errors.push(
      `${path}.${key} ${show(v)} is not a valid value (expected one of ${allowed.join(
        "|",
      )})`,
    );
    return false;
  }
  return true;
}

/**
 * Validate that an optional numeric field is a finite number when present.
 * Pushes a field-level error and returns false on a non-number value; returns
 * true when the value is absent (optional) or a finite number.
 */
function checkNumber(holder, key, path, errors) {
  const v = holder[key];
  if (v === undefined) return true;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(
      `${path}.${key} optional field must be a finite number when present but is ${show(
        v,
      )}`,
    );
    return false;
  }
  return true;
}

/**
 * Validate that a REQUIRED integer field is an integer (optionally `>= 0`).
 * Pushes a field-level error and returns false on a non-integer (or negative
 * when `min` is given) value. Mirrors {@link checkNumber} but for required
 * integers — the v3 `Hunk` line-range fields (`oldStart`/`oldLines`/...).
 */
function requireInteger(holder, key, path, errors, { min = null } = {}) {
  const v = holder[key];
  if (!isInteger(v)) {
    errors.push(
      `${path}.${key} is required and must be an integer but is ${show(v)}`,
    );
    return false;
  }
  if (min !== null && v < min) {
    errors.push(
      `${path}.${key} must be an integer >= ${min} but is ${show(v)}`,
    );
    return false;
  }
  return true;
}

/** Per-kind validators. Each receives (block, path, errors) and pushes errors. */
const KIND_VALIDATORS = {
  section(b, path, errors) {
    requireString(b, "title", path, errors);
    if (!isInteger(b.level)) {
      errors.push(
        `${path} (section '${b.title ?? ""}') field 'level' must be an integer but is ${show(
          b.level,
        )}`,
      );
    }
    if (b.collapsed !== undefined && typeof b.collapsed !== "boolean") {
      errors.push(
        `${path} (section) optional field 'collapsed' must be a boolean when present but is ${show(
          b.collapsed,
        )}`,
      );
    }
  },

  prose(b, path, errors) {
    if (!isString(b.md)) {
      errors.push(
        `${path} (prose) missing required field 'md' (string) — got ${show(
          b.md,
        )}`,
      );
    }
  },

  objective(b, path, errors) {
    requireString(b, "text", path, errors);
    if (b.successCriteria === undefined) {
      errors.push(
        `${path} (objective) missing required field 'successCriteria' (string[])`,
      );
    } else {
      checkStringArray(
        b.successCriteria,
        `${path}.successCriteria`,
        "objective.successCriteria",
        errors,
      );
    }
  },

  task(b, path, errors) {
    const title = isString(b.title) ? b.title : "";
    requireString(b, "title", path, errors);
    if (b.detail !== undefined && !isString(b.detail)) {
      errors.push(
        `${path} (task '${title}') optional field 'detail' must be a string when present but is ${show(
          b.detail,
        )}`,
      );
    }
    if (b.status === undefined) {
      errors.push(
        `${path} (task '${title}') missing required field 'status' (one of ${TASK_STATUS.join(
          "|",
        )})`,
      );
    } else if (!TASK_STATUS.includes(b.status)) {
      errors.push(
        `${path}.status ${show(
          b.status,
        )} is not a valid task status (expected one of ${TASK_STATUS.join("|")})`,
      );
    }
    if (b.deps === undefined) {
      errors.push(
        `${path} (task '${title}') missing required field 'deps' (id[] — string[] of block ids)`,
      );
    } else {
      checkStringArray(b.deps, `${path}.deps`, "task.deps", errors);
    }
    if (b.acceptance === undefined) {
      errors.push(
        `${path} (task '${title}') missing required field 'acceptance' (string[])`,
      );
    } else {
      checkStringArray(
        b.acceptance,
        `${path}.acceptance`,
        "task.acceptance",
        errors,
      );
    }
    if (b.estimate !== undefined && !isString(b.estimate)) {
      errors.push(
        `${path} (task '${title}') optional field 'estimate' must be a string when present but is ${show(
          b.estimate,
        )}`,
      );
    }
  },

  decision(b, path, errors) {
    requireString(b, "question", path, errors);
    if (!Array.isArray(b.options)) {
      errors.push(
        `${path} (decision) missing required field 'options' ({label,pros?,cons?}[]) — got ${show(
          b.options,
        )}`,
      );
    } else {
      if (b.options.length === 0) {
        errors.push(
          `${path}.options (decision) must contain at least one option`,
        );
      }
      for (let i = 0; i < b.options.length; i++) {
        const opt = b.options[i];
        const optPath = `${path}.options[${i}]`;
        if (!isObject(opt)) {
          errors.push(`${optPath} must be an object {label,pros?,cons?} but is ${show(opt)}`);
          continue;
        }
        if (!isNonEmptyString(opt.label)) {
          errors.push(
            `${optPath}.label is required and must be a non-empty string but is ${show(
              opt.label,
            )}`,
          );
        }
        if (opt.pros !== undefined) {
          checkStringArray(opt.pros, `${optPath}.pros`, "decision option pros", errors);
        }
        if (opt.cons !== undefined) {
          checkStringArray(opt.cons, `${optPath}.cons`, "decision option cons", errors);
        }
      }
    }
    if (b.chosen !== undefined && !isString(b.chosen)) {
      errors.push(
        `${path} (decision) optional field 'chosen' must be a string (an option label) when present but is ${show(
          b.chosen,
        )}`,
      );
    }
    if (b.rationale !== undefined && !isString(b.rationale)) {
      errors.push(
        `${path} (decision) optional field 'rationale' must be a string when present but is ${show(
          b.rationale,
        )}`,
      );
    }
  },

  risk(b, path, errors) {
    requireString(b, "description", path, errors);
    if (b.likelihood === undefined) {
      errors.push(
        `${path} (risk) missing required field 'likelihood' (one of ${LMH.join(
          "|",
        )})`,
      );
    } else if (!LMH.includes(b.likelihood)) {
      errors.push(
        `${path}.likelihood ${show(
          b.likelihood,
        )} is not a valid value (expected one of ${LMH.join("|")})`,
      );
    }
    if (b.impact === undefined) {
      errors.push(
        `${path} (risk) missing required field 'impact' (one of ${LMH.join(
          "|",
        )})`,
      );
    } else if (!LMH.includes(b.impact)) {
      errors.push(
        `${path}.impact ${show(
          b.impact,
        )} is not a valid value (expected one of ${LMH.join("|")})`,
      );
    }
    requireString(b, "mitigation", path, errors);
  },

  openQuestion(b, path, errors) {
    requireString(b, "question", path, errors);
    if (b.answer !== undefined && !isString(b.answer)) {
      errors.push(
        `${path} (openQuestion) optional field 'answer' must be a string when present but is ${show(
          b.answer,
        )}`,
      );
    }
  },

  // --- v2 kinds (PRD-scoped; design.md §4 lines 143-149) -------------------

  phase(b, path, errors) {
    requireString(b, "title", path, errors);
    // taskIds: agent-authored id[] like v1 task.deps — NO referential graph
    // check (D5(iii); no blocking-path graph walk).
    if (b.taskIds === undefined) {
      errors.push(
        `${path} (phase) missing required field 'taskIds' (id[] — string[] of task block ids)`,
      );
    } else {
      checkStringArray(b.taskIds, `${path}.taskIds`, "phase.taskIds", errors);
    }
  },

  tradeoff(b, path, errors) {
    requireString(b, "axis", path, errors);
    if (!Array.isArray(b.options)) {
      errors.push(
        `${path} (tradeoff) missing required field 'options' ({label,score?,note?}[]) — got ${show(
          b.options,
        )}`,
      );
    } else {
      if (b.options.length === 0) {
        errors.push(
          `${path}.options (tradeoff) must contain at least one option`,
        );
      }
      for (let i = 0; i < b.options.length; i++) {
        const opt = b.options[i];
        const optPath = `${path}.options[${i}]`;
        if (!isObject(opt)) {
          errors.push(
            `${optPath} must be an object {label,score?,note?} but is ${show(
              opt,
            )}`,
          );
          continue;
        }
        if (!isNonEmptyString(opt.label)) {
          errors.push(
            `${optPath}.label is required and must be a non-empty string but is ${show(
              opt.label,
            )}`,
          );
        }
        checkNumber(opt, "score", optPath, errors);
        if (opt.note !== undefined && !isString(opt.note)) {
          errors.push(
            `${optPath}.note optional field must be a string when present but is ${show(
              opt.note,
            )}`,
          );
        }
      }
    }
  },

  fileChange(b, path, errors) {
    requireString(b, "path", path, errors);
    if (b.action === undefined) {
      errors.push(
        `${path} (fileChange) missing required field 'action' (one of ${FILE_CHANGE_ACTIONS.join(
          "|",
        )})`,
      );
    } else {
      checkEnum(b, "action", FILE_CHANGE_ACTIONS, path, errors);
    }
    requireString(b, "rationale", path, errors);
  },

  code(b, path, errors) {
    requireString(b, "lang", path, errors);
    // content must be a string but MAY be empty (isString, not isNonEmpty).
    if (!isString(b.content)) {
      errors.push(
        `${path} (code) missing required field 'content' (string, may be empty) — got ${show(
          b.content,
        )}`,
      );
    }
    if (b.filename !== undefined && !isString(b.filename)) {
      errors.push(
        `${path} (code) optional field 'filename' must be a string when present but is ${show(
          b.filename,
        )}`,
      );
    }
  },

  table(b, path, errors) {
    const columnsOk = checkStringArray(
      b.columns,
      `${path}.columns`,
      "table.columns",
      errors,
    );
    if (!Array.isArray(b.rows)) {
      errors.push(
        `${path} (table) missing required field 'rows' (string[][]) — got ${show(
          b.rows,
        )}`,
      );
      return;
    }
    const colLen = Array.isArray(b.columns) ? b.columns.length : null;
    for (let i = 0; i < b.rows.length; i++) {
      const row = b.rows[i];
      const rowOk = checkStringArray(
        row,
        `${path}.rows[${i}]`,
        "table.row",
        errors,
      );
      // D5(ii): row/column-length mismatch is a HARD field-level error
      // (agent-correctable via the deny→revise loop).
      if (rowOk && columnsOk && colLen !== null && row.length !== colLen) {
        errors.push(
          `${path}.rows[${i}] (table) has ${row.length} cell(s) but the table declares ${colLen} column(s) — every row length must equal columns.length`,
        );
      }
    }
  },

  diagram(b, path, errors) {
    requireString(b, "mermaid", path, errors);
  },

  // --- v3 kind (diff-review-scoped; design.md §4 lines 151-153) -----------

  diff(b, path, errors) {
    requireString(b, "path", path, errors);
    if (!Array.isArray(b.hunks)) {
      errors.push(
        `${path} (diff) missing required field 'hunks' (Hunk[], may be empty for a binary/rename stub) — got ${show(
          b.hunks,
        )}`,
      );
    } else {
      // Empty hunks[] is allowed (binary/rename stub — R6).
      for (let i = 0; i < b.hunks.length; i++) {
        validateHunk(b.hunks[i], `${path}.hunks[${i}]`, errors);
      }
    }
    if (!Array.isArray(b.comments)) {
      errors.push(
        `${path} (diff) missing required field 'comments' (BlockComment[], may be empty) — got ${show(
          b.comments,
        )}`,
      );
    } else {
      for (let i = 0; i < b.comments.length; i++) {
        validateBlockComment(
          b.comments[i],
          `${path}.comments[${i}]`,
          errors,
        );
      }
    }
    if (b.status !== undefined) {
      checkEnum(b, "status", DIFF_STATUS, path, errors);
    }
    if (b.oldPath !== undefined && !isString(b.oldPath)) {
      errors.push(
        `${path} (diff) optional field 'oldPath' must be a string when present but is ${show(
          b.oldPath,
        )}`,
      );
    }
  },
};

/**
 * Validate a nested `Hunk` object (a `diff` block's `hunks[]` element). Pushes
 * field-level errors; mirrors the `decision`/`tradeoff` options-array helper
 * style. `hunkId` is a stable opaque per-hunk anchor (ADR-0001 recursively).
 */
function validateHunk(h, path, errors) {
  if (!isObject(h)) {
    errors.push(
      `${path} must be an object {header,oldStart,oldLines,newStart,newLines,lines,hunkId} but is ${show(
        h,
      )}`,
    );
    return;
  }
  requireString(h, "header", path, errors);
  requireInteger(h, "oldStart", path, errors);
  requireInteger(h, "oldLines", path, errors, { min: 0 });
  requireInteger(h, "newStart", path, errors);
  requireInteger(h, "newLines", path, errors, { min: 0 });
  if (!Array.isArray(h.lines)) {
    errors.push(
      `${path} (Hunk) missing required field 'lines' (DiffLine[]) — got ${show(
        h.lines,
      )}`,
    );
  } else {
    for (let i = 0; i < h.lines.length; i++) {
      validateDiffLine(h.lines[i], `${path}.lines[${i}]`, errors);
    }
  }
  if (!isNonEmptyString(h.hunkId)) {
    errors.push(
      `${path}.hunkId is required and must be a non-empty string (the stable per-hunk anchor) but is ${show(
        h.hunkId,
      )}`,
    );
  }
}

/**
 * Validate a nested `DiffLine` object. `text` is the line content WITHOUT the
 * leading op char and MAY be empty (`isString`, not `isNonEmptyString` —
 * mirrors `code.content`).
 */
function validateDiffLine(line, path, errors) {
  if (!isObject(line)) {
    errors.push(
      `${path} must be an object {op,text} but is ${show(line)}`,
    );
    return;
  }
  checkEnum(line, "op", DIFF_LINE_OPS, path, errors);
  if (!isString(line.text)) {
    errors.push(
      `${path} (DiffLine) missing required field 'text' (string, may be empty) — got ${show(
        line.text,
      )}`,
    );
  }
}

/**
 * Validate a nested `BlockComment` object (a `diff` block's `comments[]`
 * element). `hunkId` is the `Hunk.hunkId` this comment anchors to, OR `null`
 * for a file-level comment. `verdict` carries the per-hunk review verdict
 * (R5: reuse this shape; NO new envelope op).
 */
function validateBlockComment(c, path, errors) {
  if (!isObject(c)) {
    errors.push(
      `${path} must be an object {commentId,hunkId,text,verdict} but is ${show(
        c,
      )}`,
    );
    return;
  }
  if (!isNonEmptyString(c.commentId)) {
    errors.push(
      `${path}.commentId is required and must be a non-empty string (stable) but is ${show(
        c.commentId,
      )}`,
    );
  }
  // hunkId: a Hunk.hunkId string, OR null for a file-level comment.
  if (c.hunkId !== null && !isString(c.hunkId)) {
    errors.push(
      `${path}.hunkId is required and must be a string (the Hunk.hunkId) or null (file-level comment) but is ${show(
        c.hunkId,
      )}`,
    );
  }
  requireString(c, "text", path, errors);
  checkEnum(c, "verdict", BLOCK_COMMENT_VERDICTS, path, errors);
}

function validateBlock(block, index, errors, docType) {
  const path = `blocks[${index}]`;
  // v2 kinds are accepted in BOTH plan and prd (ADR-0005 supersedes D5(i)):
  // plans are visually-approvable and carry mermaid/tables/code/fileChange.
  // v3 `diff` is diff-review-scoped (R7): only `type:"diff-review"` documents
  // accept it, and a diff-review doc accepts v1∪v3 (NOT v2 PRD kinds).
  const isDiffReview = docType === "diff-review";
  // plan ∪ prd → v1∪v2; diff-review → v1∪v3.
  const validKindList = isDiffReview ? DIFF_REVIEW_KIND_LIST : PRD_KIND_LIST;
  if (!isObject(block)) {
    errors.push(`${path} must be an object but is ${show(block)}`);
    return;
  }
  if (!isNonEmptyString(block.id)) {
    errors.push(
      `${path}.id is required and must be a non-empty string (stable across revisions) but is ${show(
        block.id,
      )}`,
    );
  }
  if (!isString(block.kind)) {
    errors.push(
      `${path}.kind is required and must be a string (one of ${validKindList}) but is ${show(
        block.kind,
      )}`,
    );
    return;
  }
  // A v2 kind in a diff-review document is a field-level rejection: a
  // diff-review doc is v1∪v3 only (R7 — v2 PRD kinds are NOT meaningful in a
  // diff review). plan ∪ prd both accept v2 (ADR-0005 supersedes D5(i)).
  if (isDiffReview && V2_KIND_SET.has(block.kind)) {
    errors.push(
      `${path}.kind ${show(
        block.kind,
      )} is a v2 plan/PRD kind and is not allowed in a type:'diff-review' document (expected one of ${DIFF_REVIEW_KIND_LIST}; v2 kinds require type:'plan' or type:'prd')`,
    );
    return;
  }
  // A v3 `diff` kind outside a diff-review document is a field-level rejection:
  // keeps the plan/PRD v1∪v2 contract tight (R7, mirror of the old D5(i)).
  if (!isDiffReview && V3_KIND_SET.has(block.kind)) {
    errors.push(
      `${path}.kind ${show(
        block.kind,
      )} is a v3 diff-review-only kind and is not allowed in a type:'${
        docType === undefined ? "plan" : docType
      }' document (expected one of ${PRD_KIND_LIST}; the 'diff' kind requires type:'diff-review')`,
    );
    return;
  }
  const validator = KIND_VALIDATORS[block.kind];
  if (!validator) {
    errors.push(
      `${path}.kind ${show(
        block.kind,
      )} is not a valid ${
        isDiffReview ? "v1∪v3" : "v1∪v2"
      } kind (expected one of ${validKindList})`,
    );
    return;
  }
  validator(block, path, errors);
}

function validateMeta(meta, errors) {
  if (!isObject(meta)) {
    errors.push(`meta is required and must be an object but is ${show(meta)}`);
    return;
  }
  if (meta.branch !== undefined && !isString(meta.branch)) {
    errors.push(
      `meta.branch optional field must be a string when present but is ${show(
        meta.branch,
      )}`,
    );
  }
  checkEnum(meta, "status", DOC_STATUS, "meta", errors);
  if (!isNonEmptyString(meta.createdAt)) {
    errors.push(
      `meta.createdAt is required and must be a non-empty string (ISO-8601 timestamp) but is ${show(
        meta.createdAt,
      )}`,
    );
  }
  if (!isInteger(meta.revision)) {
    errors.push(
      `meta.revision is required and must be an integer but is ${show(
        meta.revision,
      )}`,
    );
  }
  if (meta.degraded !== undefined && typeof meta.degraded !== "boolean") {
    errors.push(
      `meta.degraded optional field must be a boolean when present but is ${show(
        meta.degraded,
      )}`,
    );
  }
}

/**
 * Validate `obj` against the planos v1 core schema.
 *
 * @param {unknown} obj
 * @returns {{ ok: true, doc: import("./types").Document }
 *          | { ok: false, errors: string[] }}
 */
export function validateDocument(obj) {
  const errors = [];

  if (!isObject(obj)) {
    return {
      ok: false,
      errors: [
        `document must be a JSON object but is ${show(
          obj,
        )} (a valid v1 plan document is expected)`,
      ],
    };
  }

  if (obj.schemaVersion !== 1) {
    errors.push(
      `schemaVersion must be the integer 1 (v1 is the only supported schema) but is ${show(
        obj.schemaVersion,
      )}`,
    );
  }

  if (!DOC_TYPES.includes(obj.type)) {
    errors.push(
      `type ${show(
        obj.type,
      )} is not valid (expected one of ${DOC_TYPES.join("|")}; v1 plan flow uses 'plan')`,
    );
  }

  if (!isNonEmptyString(obj.id)) {
    errors.push(
      `id is required and must be a non-empty string (stable across revisions — the revision-chain key) but is ${show(
        obj.id,
      )}`,
    );
  }

  if (!isNonEmptyString(obj.title)) {
    errors.push(
      `title is required and must be a non-empty string but is ${show(
        obj.title,
      )}`,
    );
  }

  validateMeta(obj.meta, errors);

  if (!Array.isArray(obj.blocks)) {
    errors.push(
      `blocks is required and must be an array of block objects but is ${show(
        obj.blocks,
      )}`,
    );
  } else {
    if (obj.blocks.length === 0) {
      errors.push(
        `blocks must contain at least one block (an empty plan is not a valid document)`,
      );
    }
    for (let i = 0; i < obj.blocks.length; i++) {
      validateBlock(obj.blocks[i], i, errors, obj.type);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, doc: /** @type {import("./types").Document} */ (obj) };
}
