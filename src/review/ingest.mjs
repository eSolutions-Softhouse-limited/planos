/**
 * planos — pure unified-diff → v3 `diff` blocks ingestion parser.
 *
 * Contract: docs/design.md §4 (v3 block schema), plan planos-phase3-plan.md
 * §3.1 (exact `diff`/`Hunk`/`DiffLine`/`BlockComment` field shapes), §3.4
 * (hunk-id stability — deterministically minted opaque ids), §7 Milestone R1,
 * AC-R9 + AC-R10.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AC-17 PURITY CONTRACT (R1 Option A — load-bearing for the headline risk):
 *
 *   This module is a PURE text→blocks parser. It imports NOTHING — not even a
 *   `node:` builtin (mirrors src/diff/structural.mjs's pure-logic discipline).
 *   It makes ZERO subprocess calls (no `node:child_process`), ZERO network
 *   egress, ZERO model invocation, ZERO clock/filesystem access. It is
 *   text-in / blocks-out only: regex + line-scan + array construction.
 *
 *   The `gh pr diff <PR#>` / `git diff <range>` SUBPROCESS that *produces* the
 *   unified-diff text runs in the pre-server CLI agent loop (the legitimate
 *   live-agent surface, exactly like the Socratic interview), NEVER in the
 *   blocking `bin/planos review` path. This module only consumes the resulting
 *   text. The AC-17 import-graph walk over the review roots therefore stays
 *   VERDICT CLEAN with zero new allowed-boundary carve-outs. Do NOT add any
 *   import to this file.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Determinism: same diff text + same opts ⇒ byte-identical blocks (no clock,
 * no randomness). hunk/comment ids are minted as `<blockId>-h<n>` /
 * `<blockId>-c<n>` (content-INDEPENDENT, position-indexed) so re-ingesting the
 * same diff preserves every per-hunk anchor across revisions (§3.4, ADR-0001
 * opaque doctrine applied recursively).
 *
 * Size cap (R6 — degrade, never block; mirrors readStdin's MAX_STDIN_BYTES
 * doctrine): when a hunk's DiffLine count exceeds `maxLinesPerHunk`, the
 * overflow lines are ELIDED and a single explicit context DiffLine is appended
 * verbatim as:
 *
 *     { op: " ", text: "… N lines elided (hunk exceeds cap of M) …" }
 *
 * The parser NEVER throws and NEVER blocks on a pathological diff; it always
 * returns a valid block array (a malformed/empty diff yields `[]`).
 *
 * Source-agnostic (R3): both `gh pr diff` and `git diff <range>` emit standard
 * unified-diff text with `diff --git` headers, so the parser does not care
 * which tool produced its input.
 *
 * Zero runtime dependencies. ES module. No imports at all.
 */

"use strict";

/** Sane default per-hunk DiffLine cap (R6). Overridable via opts. */
const DEFAULT_MAX_LINES_PER_HUNK = 2000;

/**
 * Parse `@@ -oldStart,oldLines +newStart,newLines @@ optional section` into
 * its four integers. Git omits the `,count` when count === 1 (e.g.
 * `@@ -0,0 +1 @@`) — that case is normalised to count = 1 here.
 *
 * @param {string} line the verbatim `@@ ... @@` header line
 * @returns {{oldStart:number,oldLines:number,newStart:number,newLines:number}|null}
 */
function parseHunkHeader(line) {
  // -oldStart[,oldLines] +newStart[,newLines]
  const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!m) return null;
  return {
    oldStart: Number(m[1]),
    oldLines: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newLines: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/**
 * Unquote a git-quoted path. Git wraps paths with special chars in
 * double-quotes with C-style escapes (e.g. `"a/sp ace.txt"`). For the common
 * unquoted case the input is returned verbatim.
 *
 * @param {string} p
 * @returns {string}
 */
function unquotePath(p) {
  if (p.length >= 2 && p[0] === '"' && p[p.length - 1] === '"') {
    const inner = p.slice(1, -1);
    let out = "";
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "\\" && i + 1 < inner.length) {
        const c = inner[i + 1];
        if (c === "n") out += "\n";
        else if (c === "t") out += "\t";
        else if (c === '"') out += '"';
        else if (c === "\\") out += "\\";
        else out += c;
        i++;
      } else {
        out += inner[i];
      }
    }
    return out;
  }
  return p;
}

/**
 * Strip a leading `a/` or `b/` prefix from a `--- a/X` / `+++ b/Y` path. Git
 * uses these conventional prefixes; `/dev/null` is left as-is (it signals an
 * add/delete and is handled by the caller via the file-header status).
 *
 * @param {string} p
 * @returns {string}
 */
function stripPrefix(p) {
  if (p === "/dev/null") return p;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/**
 * Parse the `diff --git a/X b/Y` line's two paths. Handles the unquoted common
 * case (`diff --git a/foo b/foo`). Falls back to `null` paths when the form is
 * unusual (the per-file `---`/`+++` lines then supply the path).
 *
 * @param {string} line
 * @returns {{oldPath:string,newPath:string}|null}
 */
function parseGitHeaderPaths(line) {
  // diff --git a/<old> b/<new>  — split on " b/" is ambiguous with spaces in
  // names; prefer the quoted form, else the simple a/ … b/ split.
  const rest = line.slice("diff --git ".length);
  const qm = rest.match(/^"(.*)" "(.*)"$/);
  if (qm) {
    return {
      oldPath: stripPrefix(unquotePath(`"${qm[1]}"`)),
      newPath: stripPrefix(unquotePath(`"${qm[2]}"`)),
    };
  }
  // Unquoted: a/<path> b/<path>. The new path begins at the LAST " b/".
  const idx = rest.lastIndexOf(" b/");
  if (rest.startsWith("a/") && idx > 0) {
    return {
      oldPath: stripPrefix(rest.slice(0, idx)),
      newPath: stripPrefix(rest.slice(idx + 1)),
    };
  }
  return null;
}

/**
 * Split unified-diff text into per-file segments. Each segment begins at a
 * `diff --git ` line (the standard git boundary). Anything before the first
 * `diff --git ` (e.g. a commit-message preamble from `git show`) is discarded.
 *
 * @param {string} text
 * @returns {string[][]} array of segments, each an array of raw lines
 */
function splitFileSegments(text) {
  const lines = text.split("\n");
  const segments = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) segments.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Classify a file segment's status from its git extended headers, and resolve
 * its path / oldPath. Mirrors git's own header vocabulary:
 *   - `new file mode`                   → added
 *   - `deleted file mode`               → deleted
 *   - `rename from` / `rename to`       → renamed (carries oldPath)
 *   - `Binary files … differ` / `GIT binary patch` → binary
 *   - else                              → modified
 *
 * @param {string[]} seg raw lines of one `diff --git` segment
 * @returns {{status:string,path:string,oldPath:string|undefined,binary:boolean}}
 */
function classifySegment(seg) {
  const headerPaths = parseGitHeaderPaths(seg[0]);
  let status = "modified";
  let binary = false;
  let renameFrom;
  let renameTo;
  let minusPath;
  let plusPath;

  for (const line of seg) {
    if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "deleted";
    else if (line.startsWith("rename from ")) {
      status = "renamed";
      renameFrom = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      status = "renamed";
      renameTo = line.slice("rename to ".length);
    } else if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      binary = true;
    } else if (line.startsWith("--- ")) {
      minusPath = stripPrefix(unquotePath(line.slice(4).trim()));
    } else if (line.startsWith("+++ ")) {
      plusPath = stripPrefix(unquotePath(line.slice(4).trim()));
    }
  }

  // binary classification overrides modified/added/deleted (R6): a binary file
  // has no textual hunks regardless of add/delete.
  if (binary) status = "binary";

  // Resolve the canonical path: the new path for added/modified/renamed/binary,
  // the old path for a delete. Prefer the explicit ---/+++ lines, fall back to
  // the `diff --git` header paths, then the rename headers.
  let path;
  let oldPath;
  if (status === "renamed") {
    oldPath = renameFrom !== undefined
      ? unquotePath(renameFrom)
      : headerPaths
        ? headerPaths.oldPath
        : minusPath;
    path = renameTo !== undefined
      ? unquotePath(renameTo)
      : headerPaths
        ? headerPaths.newPath
        : plusPath;
  } else if (status === "deleted") {
    path =
      minusPath && minusPath !== "/dev/null"
        ? minusPath
        : headerPaths
          ? headerPaths.oldPath
          : plusPath;
  } else {
    path =
      plusPath && plusPath !== "/dev/null"
        ? plusPath
        : headerPaths
          ? headerPaths.newPath
          : minusPath;
  }
  if (path === undefined || path === "/dev/null") {
    path = headerPaths ? headerPaths.newPath : "(unknown)";
  }
  return { status, path, oldPath, binary };
}

/**
 * Parse the body hunks of one file segment into `Hunk[]`. The
 * `\ No newline at end of file` marker is NOT a DiffLine — it annotates the
 * preceding line's EOL state, carries no reviewable content, and is folded
 * away (skipped) here so every emitted DiffLine maps 1:1 to a real source
 * line. Lines outside any `@@` hunk (extended headers, ---/+++) are ignored.
 *
 * @param {string[]} seg raw lines of one `diff --git` segment
 * @param {string} blockId the parent `diff` block id (for hunkId minting)
 * @param {number} maxLinesPerHunk R6 per-hunk DiffLine cap
 * @returns {object[]} Hunk[]
 */
function parseHunks(seg, blockId, maxLinesPerHunk) {
  const hunks = [];
  let hunkIndex = 0;
  let i = 0;
  while (i < seg.length) {
    const line = seg[i];
    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line);
      if (!parsed) {
        i++;
        continue;
      }
      hunkIndex++;
      const lines = [];
      i++;
      while (i < seg.length) {
        const l = seg[i];
        if (l.startsWith("@@") || l.startsWith("diff --git ")) break;
        if (l.startsWith("\\")) {
          // "\ No newline at end of file" — fold away (not a DiffLine).
          i++;
          continue;
        }
        const c = l[0];
        if (c === " " || c === "+" || c === "-") {
          lines.push({ op: c, text: l.slice(1) });
        }
        // A genuine empty-content context line arrives as a single space
        // (handled above: " " → text:""). A truly empty stream line is a
        // terminator/trailing-newline artifact, NOT diff content, and is
        // ignored. Any other prefix (stray header) is ignored too.
        i++;
      }
      // R6 size cap: elide overflow, never throw, never block.
      let emitted = lines;
      if (lines.length > maxLinesPerHunk) {
        const elided = lines.length - maxLinesPerHunk;
        emitted = lines.slice(0, maxLinesPerHunk);
        emitted.push({
          op: " ",
          text: `… ${elided} lines elided (hunk exceeds cap of ${maxLinesPerHunk}) …`,
        });
      }
      hunks.push({
        header: line,
        oldStart: parsed.oldStart,
        oldLines: parsed.oldLines,
        newStart: parsed.newStart,
        newLines: parsed.newLines,
        lines: emitted,
        hunkId: `${blockId}-h${hunkIndex}`,
      });
    } else {
      i++;
    }
  }
  return hunks;
}

/**
 * Ingest unified-diff text (as produced by BOTH `gh pr diff <PR#>` AND
 * `git diff <range>` — source-agnostic, R3) into an array of v3 `diff` blocks,
 * one block per file.
 *
 * Pure: text-in / blocks-out. No subprocess, no network, no clock, no
 * filesystem (AC-17 — see the purity contract at the top of this file).
 *
 * @param {string} diffText the unified-diff text
 * @param {{idPrefix?:string, maxLinesPerHunk?:number}} [opts]
 *   - `idPrefix`: parent block-id prefix for deterministic id minting; each
 *     file block is `<idPrefix>-<n>` (default prefix `"dr"` ⇒ `dr-1`, `dr-2`).
 *     Content-INDEPENDENT and position-indexed ⇒ stable across re-ingestion
 *     of the same diff (§3.4).
 *   - `maxLinesPerHunk`: R6 per-hunk DiffLine cap (default 2000).
 * @returns {object[]} v3 `diff` blocks; `[]` for empty/malformed input.
 */
export function ingestUnifiedDiff(diffText, opts = {}) {
  if (typeof diffText !== "string" || diffText.length === 0) return [];
  const idPrefix =
    typeof opts.idPrefix === "string" && opts.idPrefix.length > 0
      ? opts.idPrefix
      : "dr";
  const maxLinesPerHunk =
    typeof opts.maxLinesPerHunk === "number" &&
    Number.isInteger(opts.maxLinesPerHunk) &&
    opts.maxLinesPerHunk > 0
      ? opts.maxLinesPerHunk
      : DEFAULT_MAX_LINES_PER_HUNK;

  const segments = splitFileSegments(diffText);
  const blocks = [];
  let fileIndex = 0;
  for (const seg of segments) {
    fileIndex++;
    const blockId = `${idPrefix}-${fileIndex}`;
    const { status, path, oldPath, binary } = classifySegment(seg);
    // Binary files (R6) carry NO textual hunks regardless of any binary-patch
    // payload — empty hunks[] with status:"binary".
    const hunks = binary ? [] : parseHunks(seg, blockId, maxLinesPerHunk);
    const block = {
      id: blockId,
      kind: "diff",
      path,
      status,
      hunks,
      // comments are ALWAYS empty at ingestion — added by the human in the SPA.
      comments: [],
    };
    if (status === "renamed" && typeof oldPath === "string") {
      block.oldPath = oldPath;
    }
    blocks.push(block);
  }
  return blocks;
}

/** Default cap, exported for callers/tests that need the documented default. */
export const MAX_LINES_PER_HUNK = DEFAULT_MAX_LINES_PER_HUNK;
