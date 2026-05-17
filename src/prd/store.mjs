/**
 * planos — PRD persistence layer (Milestone P1).
 *
 * Contract: docs/design.md §9 Phase 2 scope; planos-phase2-plan.md §5 + §7 P1;
 * Resolved Decision D1 (Option A — committed, append-only):
 *
 *   Layout:  prds/<doc-id>/rNNN.json   (NNN = zero-padded 3-digit meta.revision)
 *            prds/<doc-id>/latest.json  (always the most-recently-written revision)
 *
 * Invariants:
 *   - APPEND-ONLY: saveRevision throws if rNNN.json already exists for that
 *     revision number (prior revisions are never mutated).
 *   - PATH-SAFE: prdPath() rejects any docId containing '..', a path separator,
 *     or absolute form — throws a clear Error before touching the filesystem.
 *   - BYTE-STABLE: canonical JSON via the same canonicalize ordering as
 *     src/diff/structural.mjs (key-sorted recursively so diffs are byte-stable).
 *   - AC-17-CLEAN: zero runtime dependencies. node:fs + node:path only. No
 *     network, no spawn, no model, no clock. Timestamps pass through the doc's
 *     own meta.createdAt — this module never reads the system clock.
 *
 * Reads never throw on MISSING data: missing dir / file → null / []. But a
 * file that EXISTS yet is CORRUPT (JSON parse / non-ENOENT read failure) is no
 * longer conflated with "missing": loadLatest / loadRevision throw the typed
 * PrdCorruptError (loud, distinguishable), and listRevisions /
 * listRevisionDocs report the revision with `corrupt: true` rather than
 * silently dropping it (so a damaged head can never shorten the on-disk chain
 * and mis-reset the revision counter). saveRevision still throws on append-only
 * + path-traversal violations.
 *
 * Run: node --test tests/prd-store.test.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Canonical JSON (mirrors canonicalize() in src/diff/structural.mjs so diffs
// are byte-stable across the two consumers).
// ---------------------------------------------------------------------------

const isObj = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Stable, deterministic canonical JSON: object keys are sorted recursively.
 * Arrays keep order. Identical to the canonicalize() helper in structural.mjs.
 *
 * Exported so the PRD round-trip can content-dedupe an approve-with-edits
 * against the prior persisted revision using THIS exact byte-stable ordering
 * (M3 no-op correctness — same ordering the on-disk rNNN.json files use, so
 * "canonically equal" means "byte-identical once persisted").
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Zero-pad a revision number to 3 digits.
 *
 * @param {number} n
 * @returns {string}  e.g. 1 → "001", 12 → "012", 123 → "123"
 */
function padRevision(n) {
  return String(n).padStart(3, "0");
}

/**
 * Resolve the per-PRD directory for a given docId inside rootDir.
 *
 * PATH-TRAVERSAL PROTECTION: docId must not be empty, must not be an absolute
 * path, and must not contain '..' segments or path separators (/ or \ or the
 * platform sep). Throws a clear Error before touching the filesystem if any of
 * these checks fail.
 *
 * @param {string} rootDir  Absolute path to the repo / working directory root.
 * @param {string} docId    Stable document id (the revision-chain key).
 * @returns {string}        Absolute resolved per-PRD directory.
 */
export function prdPath(rootDir, docId) {
  if (typeof docId !== "string" || docId.length === 0) {
    throw new Error(
      `prdPath: docId must be a non-empty string, got ${JSON.stringify(docId)}`,
    );
  }
  // Reject absolute paths.
  if (isAbsolute(docId)) {
    throw new Error(
      `prdPath: docId must not be an absolute path, got ${JSON.stringify(docId)}`,
    );
  }
  // Reject any '..' segment (traversal up the tree).
  const parts = docId.split(/[/\\]/);
  if (parts.some((p) => p === "..")) {
    throw new Error(
      `prdPath: docId must not contain '..' path components, got ${JSON.stringify(docId)}`,
    );
  }
  // Reject forward slash, backslash, or platform sep in the id — a docId is a
  // flat identifier, not a nested path.
  if (docId.includes("/") || docId.includes("\\") || (sep !== "/" && docId.includes(sep))) {
    throw new Error(
      `prdPath: docId must not contain path separators, got ${JSON.stringify(docId)}`,
    );
  }
  return resolve(rootDir, "prds", docId);
}

// ---------------------------------------------------------------------------
// Read helpers.
//
// CONTRACT (the [1] fix): a MISSING file and a CORRUPT file are NO LONGER
// conflated. They are categorically different states with different correct
// responses:
//
//   - MISSING (ENOENT): the revision/dir simply does not exist yet. This is the
//     normal "fresh document / no prior revision" state. It must keep yielding
//     the "not present" result (null / skipped) EXACTLY as before so that
//     first-revision creation, no-op dedupe and chain assembly are unaffected.
//
//   - CORRUPT (the file EXISTS but JSON.parse fails, or a non-ENOENT read
//     error): on-disk damage. Silently mapping this to "missing" is the bug —
//     it makes loadLatest → null → nextRevision reset to 1 → saveRevision later
//     throw the confusing "r001 already exists" append-only error, i.e. silent
//     data-loss risk. So corruption is now a DISTINCT, loud, typed signal
//     (PrdCorruptError) the callers must explicitly handle.
//
// This module still NEVER blocks the PRD round-trip (design.md §5): being loud
// here just hands the caller a typed error; src/hook/prd.mjs catches it and
// degrades VISIBLY (and crucially recovers the true revision counter from the
// on-disk filenames so the append-only guard is never tripped) instead of
// silently losing the chain head.
// ---------------------------------------------------------------------------

/**
 * Typed signal: a PRD file EXISTS on disk but could not be read/parsed as JSON
 * (corruption / truncation / a non-ENOENT read error). Distinct from "the file
 * is absent" (which the readers still represent as null / a skipped entry).
 */
export class PrdCorruptError extends Error {
  /**
   * @param {string} filePath  The on-disk path that failed to parse.
   * @param {unknown} cause     The underlying read/parse error.
   */
  constructor(filePath, cause) {
    const reason = cause && cause.message ? cause.message : String(cause);
    super(`PRD revision file is corrupt (exists but unreadable): ${filePath} — ${reason}`, { cause });
    this.name = "PrdCorruptError";
    this.filePath = filePath;
  }
}

/**
 * Read + parse a JSON file, distinguishing "absent" from "corrupt":
 *
 *   - ENOENT (file does not exist)            → returns `null` (as before).
 *   - File exists but JSON.parse / read fails → throws {@link PrdCorruptError}.
 *
 * Callers that must stay non-blocking catch PrdCorruptError explicitly and
 * decide how to degrade — they MUST NOT treat it as "missing" (that is the bug
 * this fix removes).
 *
 * @param {string} filePath
 * @returns {unknown | null}
 */
function readJsonOrThrow(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    // ENOENT == "not present" → preserve the historical null sentinel so a
    // fresh doc id still loads as null and nextRevision still starts at 1.
    if (err && err.code === "ENOENT") return null;
    // Any other read failure means the file is THERE but unreadable → loud.
    throw new PrdCorruptError(filePath, err);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // The file exists on disk but is not valid JSON → corruption, not absence.
    throw new PrdCorruptError(filePath, err);
  }
}

/**
 * Load the latest revision of a PRD document.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @returns {{ doc: object, revision: number } | null}
 */
export function loadLatest(rootDir, docId) {
  const dir = prdPath(rootDir, docId);
  const latestPath = join(dir, "latest.json");
  // Absent → null (fresh doc). EXISTS-but-corrupt → throws PrdCorruptError so
  // the caller cannot silently treat a damaged head as "no prior revision"
  // (which would mis-reset the counter to 1 — the [1] bug).
  const doc = readJsonOrThrow(latestPath);
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const revision =
    doc.meta && typeof doc.meta.revision === "number"
      ? doc.meta.revision
      : null;
  if (revision === null) return null;
  return { doc, revision };
}

/**
 * Load a specific numbered revision of a PRD document.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @param {number} n  Revision number (1-based, matches meta.revision).
 * @returns {object | null}
 */
export function loadRevision(rootDir, docId, n) {
  const dir = prdPath(rootDir, docId);
  const filePath = join(dir, `r${padRevision(n)}.json`);
  // Absent → null (no such revision). EXISTS-but-corrupt → throws
  // PrdCorruptError (a specific requested revision being damaged is loud, not
  // silently "missing").
  const doc = readJsonOrThrow(filePath);
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return null;
  return doc;
}

/**
 * Parse the meta of a single `rNNN.json` whose revision number we already know
 * from its filename. Returns the parsed doc + extracted fields, or — when the
 * file is corrupt — a `{ corrupt: true }` marker WITHOUT throwing, so the
 * enumeration is never silently truncated and the revision NUMBER (the counter
 * source of truth) is always preserved even when the body is unreadable.
 *
 * @param {string} dir
 * @param {string} fileName  e.g. "r003.json"
 * @param {number} fileRev   The revision parsed from the filename.
 * @returns {{ revision: number, createdAt: string, doc: object | null, corrupt: boolean }}
 */
function readRevisionEntry(dir, fileName, fileRev) {
  let doc;
  try {
    doc = readJsonOrThrow(join(dir, fileName));
  } catch (err) {
    if (err instanceof PrdCorruptError) {
      // Body is damaged — keep the revision number visible (from the filename)
      // so callers can still compute the true chain head; drop the content.
      return { revision: fileRev, createdAt: "", doc: null, corrupt: true };
    }
    throw err;
  }
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    return { revision: fileRev, createdAt: "", doc: null, corrupt: false };
  }
  const metaRev =
    doc.meta && typeof doc.meta.revision === "number"
      ? doc.meta.revision
      : fileRev;
  const createdAt =
    doc.meta && typeof doc.meta.createdAt === "string"
      ? doc.meta.createdAt
      : "";
  return { revision: metaRev, createdAt, doc, corrupt: false };
}

/**
 * Collect every `rNNN.json` filename + its filename-derived revision number for
 * a PRD dir. Pure readdir (no content read) — cheap; used by both
 * {@link listRevisions} and {@link listRevisionDocs} so each file is touched at
 * most once for content.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @returns {{ dir: string, files: { fileName: string, fileRev: number }[] }}
 */
function revisionFiles(rootDir, docId) {
  const dir = prdPath(rootDir, docId);
  if (!existsSync(dir)) return { dir, files: [] };
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return { dir, files: [] };
  }
  const files = [];
  for (const f of entries) {
    const m = /^r(\d{3})\.json$/.exec(f);
    if (m) files.push({ fileName: f, fileRev: Number(m[1]) });
  }
  return { dir, files };
}

/**
 * List all persisted revisions for a PRD, newest-first.
 *
 * Corruption handling (the [1] fix): a damaged `rNNN.json` is NOT silently
 * dropped — its revision number (from the filename) is still reported with
 * `corrupt: true` and an empty `createdAt`, so a corrupt head can never make
 * the chain look shorter than it is on disk (which is what mis-reset the
 * revision counter). Never throws.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @returns {{ revision: number, createdAt: string, corrupt: boolean }[]}
 *   Newest revision first.
 */
export function listRevisions(rootDir, docId) {
  const { dir, files } = revisionFiles(rootDir, docId);
  const results = [];
  for (const { fileName, fileRev } of files) {
    const e = readRevisionEntry(dir, fileName, fileRev);
    results.push({
      revision: e.revision,
      createdAt: e.createdAt,
      corrupt: e.corrupt,
    });
  }
  results.sort((a, b) => b.revision - a.revision);
  return results;
}

/**
 * Like {@link listRevisions} but ALSO returns the parsed document for each
 * non-corrupt revision in the SAME single pass — so consumers that need the
 * full chain of docs (assemblePriorChain) read+parse each `rNNN.json` exactly
 * ONCE instead of listing then re-loading every file (the [2] de-dupe). Corrupt
 * files are reported with `doc: null` + `corrupt: true` (never throws, never
 * truncates the enumeration). Newest revision first (same order as
 * listRevisions).
 *
 * @param {string} rootDir
 * @param {string} docId
 * @returns {{ revision: number, createdAt: string, doc: object | null, corrupt: boolean }[]}
 */
export function listRevisionDocs(rootDir, docId) {
  const { dir, files } = revisionFiles(rootDir, docId);
  const results = [];
  for (const { fileName, fileRev } of files) {
    results.push(readRevisionEntry(dir, fileName, fileRev));
  }
  results.sort((a, b) => b.revision - a.revision);
  return results;
}

// ---------------------------------------------------------------------------
// Write (throws on violation — append-only + path-safety).
// ---------------------------------------------------------------------------

/**
 * Persist a new revision of a PRD document.
 *
 * - Writes `prds/<docId>/r<NNN>.json` (NNN = zero-padded doc.meta.revision).
 * - Rewrites `prds/<docId>/latest.json` to this revision.
 * - APPEND-ONLY: throws if r<NNN>.json already exists.
 * - Uses canonical JSON (key-sorted, byte-stable) for both files.
 * - Never reads the system clock; timestamps come from doc.meta.createdAt.
 *
 * @param {string} rootDir
 * @param {object} doc  Validated planos document with doc.id + doc.meta.revision.
 * @returns {string}    Absolute path of the written rNNN.json file.
 */
export function saveRevision(rootDir, doc) {
  if (
    doc == null ||
    typeof doc !== "object" ||
    Array.isArray(doc) ||
    typeof doc.id !== "string" ||
    doc.id.length === 0
  ) {
    throw new Error(
      "saveRevision: doc must be an object with a non-empty string .id",
    );
  }
  if (
    doc.meta == null ||
    typeof doc.meta !== "object" ||
    !Number.isInteger(doc.meta.revision) ||
    doc.meta.revision < 1
  ) {
    throw new Error(
      "saveRevision: doc.meta.revision must be a positive integer",
    );
  }

  const dir = prdPath(rootDir, doc.id);
  const revFile = join(dir, `r${padRevision(doc.meta.revision)}.json`);
  const latestFile = join(dir, "latest.json");

  // APPEND-ONLY: refuse to overwrite an existing revision file.
  if (existsSync(revFile)) {
    throw new Error(
      `saveRevision: revision r${padRevision(doc.meta.revision)} already exists at ${revFile} — append-only, cannot overwrite`,
    );
  }

  // Ensure the per-PRD directory exists.
  mkdirSync(dir, { recursive: true });

  const canonical = canonicalize(doc);

  writeFileSync(revFile, canonical, "utf8");
  writeFileSync(latestFile, canonical, "utf8");

  return revFile;
}
