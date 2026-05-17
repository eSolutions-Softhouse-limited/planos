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
 * carry mermaid/tables/code/fileChange too).
 *
 * M1 (ADR-0007) removed the v3 `diff` kind and the `type:"diff-review"`
 * document type along with the whole diff-review flow — planos is PRD-only.
 */
export const V2_KINDS = Object.freeze([
  "phase",
  "tradeoff",
  "fileChange",
  "code",
  "table",
  "diagram",
]);

const PRD_KIND_LIST = V1_KINDS.concat(V2_KINDS).join("|");
const FILE_CHANGE_ACTIONS = Object.freeze(["add", "modify", "delete"]);
const DOC_STATUS = Object.freeze(["draft", "in-review", "approved"]);
const TASK_STATUS = Object.freeze(["todo", "doing", "done", "cut"]);
const LMH = Object.freeze(["L", "M", "H"]);
const DOC_TYPES = Object.freeze(["plan", "prd"]);

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
};

function validateBlock(block, index, errors) {
  const path = `blocks[${index}]`;
  // v1∪v2 kinds are accepted in BOTH plan and prd documents (ADR-0005
  // supersedes ADR-0002 D5(i): plans are visually-approvable and carry
  // mermaid/tables/code/fileChange too). M1 (ADR-0007) removed the v3 `diff`
  // kind and the diff-review doc type — planos is PRD-only.
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
      `${path}.kind is required and must be a string (one of ${PRD_KIND_LIST}) but is ${show(
        block.kind,
      )}`,
    );
    return;
  }
  const validator = KIND_VALIDATORS[block.kind];
  if (!validator) {
    errors.push(
      `${path}.kind ${show(
        block.kind,
      )} is not a valid v1∪v2 kind (expected one of ${PRD_KIND_LIST})`,
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
      )} is not valid (expected one of ${DOC_TYPES.join("|")}; the PRD flow uses 'prd')`,
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
      validateBlock(obj.blocks[i], i, errors);
    }
    // Block ids must be unique across the document — they are the stable
    // revision-chain key and the reviewer-edit fold-back anchor. A duplicate id
    // silently corrupts edit/delete/reorder targeting and the persisted chain,
    // so it is a HARD field-level error (the deny→revise loop can fix it; the
    // approve path then safely falls back to the agent-authored doc).
    const seenIds = new Set();
    for (let i = 0; i < obj.blocks.length; i++) {
      const blk = obj.blocks[i];
      if (!isObject(blk) || !isNonEmptyString(blk.id)) continue;
      if (seenIds.has(blk.id)) {
        errors.push(
          `blocks[${i}].id ${show(
            blk.id,
          )} is a duplicate — every block id must be unique across the document (block ids are the stable revision-chain key; reuse none verbatim more than once)`,
        );
      } else {
        seenIds.add(blk.id);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, doc: /** @type {import("./types").Document} */ (obj) };
}
