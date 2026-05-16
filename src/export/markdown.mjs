/**
 * planos — pure canonical `Document → markdown` serializer.
 *
 * Contract: docs/design.md §1 thesis ("markdown becomes an export format, not
 * the source of truth"), plan planos-phase4-plan.md §3.2 (the precise per-kind
 * serialization spec — implemented EXACTLY here), §6 Milestone Q0 (Q0.1),
 * §5 AC-Q4 + AC-Q5. Total over ALL 14 v1∪v2∪v3 block kinds:
 *   v1: section, prose, objective, task, decision, risk, openQuestion
 *   v2: phase, tradeoff, fileChange, code, table, diagram
 *   v3: diff
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AC-17 OUT-OF-BLOCKING-PATH PURITY CONTRACT (Q3 — mirrors src/review/ingest.mjs):
 *
 *   This module is a PURE document→string serializer. It imports NOTHING —
 *   not even a `node:` builtin (mirrors src/review/ingest.mjs's and
 *   src/diff/structural.mjs's pure-logic discipline). It makes ZERO subprocess
 *   calls (no `node:child_process`), ZERO network egress, ZERO model
 *   invocation, ZERO clock access, ZERO filesystem access. It is doc-in /
 *   string-out only: string + array + regex construction.
 *
 *   It is consumed (a) SPA-side by an in-browser "Download .md" button and
 *   (b) by the out-of-blocking-path `bin/planos export` CLI (Milestone Q1,
 *   the next milestone — the gh/git pre-server doctrine applied to a POST-
 *   server CLI surface). It is NEVER imported by a blocking handler
 *   (`src/hook/{exit,prd,review}.mjs`) and is NOT a `bin/planos exit|prd|
 *   review` root. The AC-17 import-graph walk over the blocking roots
 *   therefore stays VERDICT CLEAN with zero new allowed-boundary carve-outs;
 *   AC-Q12 additionally proves this module ABSENT from the blocking
 *   transitive closure by negative assertion. Do NOT add any import to this
 *   file.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Determinism: same input ⇒ byte-identical output across repeated calls. No
 * clock, no randomness, no Map/Set iteration nondeterminism — `blocks` is
 * iterated in array order; every field is read positionally.
 *
 * Degraded/empty-safe: a degraded doc (one `prose` block, `meta.degraded`),
 * an empty doc, and a malformed/non-object doc all serialize WITHOUT throwing
 * (best-effort; every accessor is null-guarded). This serializer NEVER throws
 * and ALWAYS returns a string.
 *
 * Zero runtime dependencies. ES module. No imports at all.
 */

"use strict";

/** Coerce any value to a safe string ("" for null/undefined). */
function str(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

/** A defensive array view ([] for anything non-array). */
function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** Clamp a heading level into the valid markdown 1–6 range (default 2). */
function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 2;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 6) return 6;
  return i;
}

/** Escape pipes/newlines so a value is safe inside a GFM table cell. */
function tableCell(v) {
  return str(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

/** A bullet list from string items; "" when empty. */
function bulletList(items, prefix) {
  const list = arr(items);
  if (list.length === 0) return "";
  const p = prefix === undefined ? "- " : prefix;
  return list.map((it) => `${p}${str(it)}`).join("\n");
}

// ───────────────────────── per-kind serializers ──────────────────────────

/** v1 `section` → ATX heading at clamped `level`. */
function renderSection(b) {
  const level = clampLevel(b.level);
  return `${"#".repeat(level)} ${str(b.title)}`;
}

/** v1 `prose` → `md` verbatim. */
function renderProse(b) {
  return str(b.md);
}

/** v1 `objective` → bold goal + a bullet list of `successCriteria`. */
function renderObjective(b) {
  const head = `**${str(b.text)}**`;
  const crit = bulletList(b.successCriteria);
  return crit ? `${head}\n\n${crit}` : head;
}

/** v1 `task` → checkbox list item with status/detail/deps/acceptance/estimate. */
function renderTask(b) {
  const status = str(b.status);
  // todo/doing → unchecked; done → checked; cut → struck-through title.
  let box = "[ ]";
  if (status === "done") box = "[x]";
  let title = str(b.title);
  if (status === "cut") {
    box = "[~]";
    title = `~~${title}~~`;
  }
  const lines = [`- ${box} ${title}`];
  if (str(b.detail).length > 0) {
    lines.push(`  ${str(b.detail).replace(/\n/g, "\n  ")}`);
  }
  const deps = arr(b.deps);
  if (deps.length > 0) {
    lines.push(`  - Deps: ${deps.map((d) => `\`${str(d)}\``).join(", ")}`);
  }
  const acceptance = arr(b.acceptance);
  if (acceptance.length > 0) {
    lines.push("  - Acceptance:");
    for (const a of acceptance) lines.push(`    - ${str(a)}`);
  }
  if (str(b.estimate).length > 0) {
    lines.push(`  - Estimate: ${str(b.estimate)}`);
  }
  return lines.join("\n");
}

/** v1 `decision` → ADR-style block with the chosen option highlighted. */
function renderDecision(b) {
  const lines = [`**Decision:** ${str(b.question)}`];
  const options = arr(b.options);
  const chosen = str(b.chosen);
  if (options.length > 0) {
    lines.push("");
    lines.push("**Options:**");
    for (const opt of options) {
      const label = str(opt && opt.label);
      const isChosen = chosen.length > 0 && label === chosen;
      lines.push(`- ${isChosen ? `**${label}** ✓ (chosen)` : label}`);
      const pros = arr(opt && opt.pros);
      for (const p of pros) lines.push(`  - Pro: ${str(p)}`);
      const cons = arr(opt && opt.cons);
      for (const c of cons) lines.push(`  - Con: ${str(c)}`);
    }
  }
  if (str(b.rationale).length > 0) {
    lines.push("");
    lines.push(`**Rationale:** ${str(b.rationale)}`);
  }
  return lines.join("\n");
}

/** v1 `risk` → a GFM single-row table (description/likelihood/impact/mitigation). */
function renderRisk(b) {
  return [
    "| Risk | Likelihood | Impact | Mitigation |",
    "| --- | --- | --- | --- |",
    `| ${tableCell(b.description)} | ${tableCell(b.likelihood)} | ${tableCell(
      b.impact,
    )} | ${tableCell(b.mitigation)} |`,
  ].join("\n");
}

/** v1 `openQuestion` → `> **Q:**` blockquote + optional `> **A:**`. */
function renderOpenQuestion(b) {
  const lines = [`> **Q:** ${str(b.question)}`];
  if (str(b.answer).length > 0) {
    lines.push(">");
    lines.push(`> **A:** ${str(b.answer)}`);
  }
  return lines.join("\n");
}

/** v2 `phase` → heading + ordered list of `taskIds` (ids verbatim, NOT resolved). */
function renderPhase(b) {
  const lines = [`### ${str(b.title)}`];
  const ids = arr(b.taskIds);
  if (ids.length > 0) {
    lines.push("");
    ids.forEach((id, i) => lines.push(`${i + 1}. \`${str(id)}\``));
  }
  return lines.join("\n");
}

/** v2 `tradeoff` → axis line + a GFM table of options (label/score/note). */
function renderTradeoff(b) {
  const lines = [`**Tradeoff:** ${str(b.axis)}`];
  const options = arr(b.options);
  if (options.length > 0) {
    lines.push("");
    lines.push("| Option | Score | Note |");
    lines.push("| --- | --- | --- |");
    for (const opt of options) {
      const score =
        opt && opt.score !== undefined && opt.score !== null
          ? tableCell(opt.score)
          : "";
      lines.push(
        `| ${tableCell(opt && opt.label)} | ${score} | ${tableCell(
          opt && opt.note,
        )} |`,
      );
    }
  }
  return lines.join("\n");
}

/** v2 `fileChange` → an action badge line + inline-code `path` + rationale. */
function renderFileChange(b) {
  const action = str(b.action).toUpperCase() || "CHANGE";
  const head = `**[${action}]** \`${str(b.path)}\``;
  const rationale = str(b.rationale);
  return rationale ? `${head}\n\n${rationale}` : head;
}

/** v2 `code` → fenced code block with `lang`; optional bold `filename` line. */
function renderCode(b) {
  const lang = str(b.lang);
  const fence = "```";
  const body = `${fence}${lang}\n${str(b.content)}\n${fence}`;
  if (str(b.filename).length > 0) {
    return `**\`${str(b.filename)}\`**\n\n${body}`;
  }
  return body;
}

/** v2 `table` → a GFM table from `columns`/`rows`. */
function renderTable(b) {
  const columns = arr(b.columns).map((c) => str(c));
  const cols = columns.length > 0 ? columns : [""];
  const lines = [
    `| ${cols.map(tableCell).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
  ];
  for (const row of arr(b.rows)) {
    const cells = arr(row);
    const padded = cols.map((_, i) => tableCell(cells[i]));
    lines.push(`| ${padded.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** v2 `diagram` → a fenced ```mermaid block. */
function renderDiagram(b) {
  return "```mermaid\n" + str(b.mermaid) + "\n```";
}

/** v3 `diff` → file header + per-hunk fenced ```diff blocks + comments list. */
function renderDiff(b) {
  const path = str(b.path);
  const status = str(b.status);
  const lines = [];
  if (status === "renamed" && str(b.oldPath).length > 0) {
    lines.push(`**\`${str(b.oldPath)}\` → \`${path}\`** (renamed)`);
  } else {
    const suffix = status.length > 0 ? ` (${status})` : "";
    lines.push(`**\`${path}\`**${suffix}`);
  }

  const hunks = arr(b.hunks);
  if (hunks.length === 0) {
    lines.push("");
    if (status === "binary") {
      lines.push("_binary file_");
    } else if (status === "renamed") {
      lines.push(`_renamed ${str(b.oldPath)} → ${path}_`);
    } else {
      lines.push("_no textual changes_");
    }
  } else {
    for (const h of hunks) {
      lines.push("");
      lines.push("```diff");
      lines.push(str(h && h.header));
      for (const dl of arr(h && h.lines)) {
        lines.push(`${str(dl && dl.op)}${str(dl && dl.text)}`);
      }
      lines.push("```");
    }
  }

  const comments = arr(b.comments);
  if (comments.length > 0) {
    lines.push("");
    lines.push("**Comments:**");
    for (const c of comments) {
      const verdict = str(c && c.verdict) || "comment";
      const anchor =
        c && c.hunkId !== null && c.hunkId !== undefined
          ? ` _(hunk \`${str(c.hunkId)}\`)_`
          : " _(file-level)_";
      lines.push(`- **${verdict}**${anchor}: ${str(c && c.text)}`);
    }
  }
  return lines.join("\n");
}

/** Dispatch table — array-ordered, deterministic; discriminant is `kind`. */
const RENDERERS = {
  section: renderSection,
  prose: renderProse,
  objective: renderObjective,
  task: renderTask,
  decision: renderDecision,
  risk: renderRisk,
  openQuestion: renderOpenQuestion,
  phase: renderPhase,
  tradeoff: renderTradeoff,
  fileChange: renderFileChange,
  code: renderCode,
  table: renderTable,
  diagram: renderDiagram,
  diff: renderDiff,
};

/**
 * Serialize ONE block. Unknown/malformed kinds degrade to a fenced JSON
 * fallback so an unexpected shape never crashes the export (never throws).
 *
 * @param {object} block
 * @returns {string}
 */
function renderBlock(block) {
  if (block === null || typeof block !== "object") return "";
  const kind = str(block.kind);
  const fn = RENDERERS[kind];
  if (fn) {
    try {
      return fn(block);
    } catch (_e) {
      // Best-effort: a pathological field shape degrades, never crashes.
    }
  }
  let dump = "";
  try {
    dump = JSON.stringify(block, null, 2);
  } catch (_e) {
    dump = "";
  }
  return "```json\n" + dump + "\n```";
}

/**
 * Serialize a `Document` to canonical, deterministic, byte-stable markdown.
 *
 * - `title` → an H1.
 * - `meta` (revision/status/branch/degraded) → a small italic header line.
 * - `blocks` → each kind's defined rendering, in array order, blank-line
 *   separated.
 *
 * Total over all 14 v1∪v2∪v3 kinds. Pure: no clock/fs/network/subprocess
 * (AC-17 — see the purity contract at the top of this file). NEVER throws;
 * a malformed/empty/degraded doc still yields a string.
 *
 * @param {object} doc the canonical Document (or any best-effort shape)
 * @returns {string} canonical markdown
 */
export function serializeMarkdown(doc) {
  const out = [];
  const d = doc !== null && typeof doc === "object" ? doc : {};

  out.push(`# ${str(d.title) || "Untitled"}`);

  const meta = d.meta !== null && typeof d.meta === "object" ? d.meta : null;
  if (meta) {
    const parts = [];
    if (meta.revision !== undefined && meta.revision !== null) {
      parts.push(`revision ${str(meta.revision)}`);
    }
    if (str(meta.status).length > 0) parts.push(`status: ${str(meta.status)}`);
    if (str(meta.branch).length > 0) parts.push(`branch: ${str(meta.branch)}`);
    if (meta.degraded === true) parts.push("degraded");
    if (parts.length > 0) {
      out.push(`_${parts.join(" · ")}_`);
    }
  }

  for (const block of arr(d.blocks)) {
    const rendered = renderBlock(block);
    if (rendered.length > 0) out.push(rendered);
  }

  // Trailing newline → canonical, POSIX-clean, byte-stable.
  return out.join("\n\n") + "\n";
}
