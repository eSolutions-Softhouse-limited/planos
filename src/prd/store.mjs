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
 * Reads never throw on missing data: missing dir / file → null / []. Only
 * saveRevision throws (append-only + path-traversal violations).
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
// Read helpers (never throw on missing data — always return null / []).
// ---------------------------------------------------------------------------

/**
 * Try to read and parse a JSON file. Returns null if the file does not exist
 * or cannot be parsed (never throws).
 *
 * @param {string} filePath
 * @returns {unknown | null}
 */
function tryReadJson(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
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
  const doc = tryReadJson(latestPath);
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
  const doc = tryReadJson(filePath);
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return null;
  return doc;
}

/**
 * List all persisted revisions for a PRD, newest-first.
 *
 * @param {string} rootDir
 * @param {string} docId
 * @returns {{ revision: number, createdAt: string }[]}  Newest revision first.
 */
export function listRevisions(rootDir, docId) {
  const dir = prdPath(rootDir, docId);
  if (!existsSync(dir)) return [];

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  // Collect all rNNN.json files.
  const revFiles = entries.filter((f) => /^r\d{3}\.json$/.test(f));

  const results = [];
  for (const f of revFiles) {
    const doc = tryReadJson(join(dir, f));
    if (doc == null || typeof doc !== "object" || Array.isArray(doc)) continue;
    const revision =
      doc.meta && typeof doc.meta.revision === "number"
        ? doc.meta.revision
        : null;
    const createdAt =
      doc.meta && typeof doc.meta.createdAt === "string"
        ? doc.meta.createdAt
        : "";
    if (revision === null) continue;
    results.push({ revision, createdAt });
  }

  // Newest revision first.
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
