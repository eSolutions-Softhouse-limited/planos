// tests/harness/seams.mjs
//
// Integration seams — stub boundaries the harness scaffold runs against TODAY,
// to be replaced by real implementations built in parallel.
//
// SEAM CONTRACT (documented integration points; do NOT remove these signatures):
//
//   1. validateDocument(doc)  -> { ok: bool, degraded: bool, errors: string[] }
//        Later wired to `src/schema` (the zero-dep hand-rolled validator,
//        plan §6 / design §5). For the scaffold this is a minimal structural
//        stub: it checks the few invariants the harness needs to run
//        standalone (schemaVersion, id, blocks[]), and models graceful
//        degradation (malformed -> single prose block, meta.degraded=true).
//
//   2. createServerSeam()     -> { listen(), close(), get url(), get egressCount }
//        Later wired to `src/server` (the Node built-in `http` blocking
//        round-trip, design §3). In canned mode the harness uses the NULL
//        server seam below: it never binds a socket and counts any attempted
//        network egress so result-shape.test can assert ZERO egress offline.
//
//   3. openBrowserSeam(url)   -> void
//        Later wired to the platform open-browser launcher. In canned mode
//        this is a no-op that records the call without spawning anything.
//
// Replacing a seam = swap the factory passed into runHarness(); the runner
// never imports src/* directly, so the scaffold runs fully offline today.

/**
 * Minimal stand-in for src/schema's validator.
 * Real validator decides v1 block-kind correctness; the scaffold only needs
 * enough to (a) accept well-formed fixture docs and (b) model degradation.
 *
 * @param {unknown} doc
 * @returns {{ ok: boolean, degraded: boolean, errors: string[], doc: any }}
 */
export function validateDocument(doc) {
  const errors = [];
  if (doc === null || typeof doc !== "object") {
    errors.push("document is not an object");
  } else {
    if (doc.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    if (typeof doc.id !== "string" || doc.id.length === 0)
      errors.push("document id must be a non-empty string");
    if (!Array.isArray(doc.blocks)) errors.push("blocks must be an array");
    else {
      for (const [i, b] of doc.blocks.entries()) {
        if (b === null || typeof b !== "object" || typeof b.id !== "string")
          errors.push(`block[${i}] missing string id`);
        if (b && typeof b.kind !== "string")
          errors.push(`block[${i}] missing string kind`);
      }
    }
  }
  return { ok: errors.length === 0, degraded: false, errors, doc };
}

/**
 * Deterministic graceful-degradation fallback (design §5: malformed output ->
 * single prose block, meta.degraded=true, never blocks). Pure, no model call.
 *
 * @param {string} rawText
 * @returns {object} a valid degraded document
 */
export function degradeToProseBlock(rawText) {
  return {
    schemaVersion: 1,
    type: "plan",
    id: "degraded-" + simpleHash(String(rawText ?? "")),
    title: "Unstructured plan (degraded)",
    meta: { status: "draft", revision: 1, degraded: true },
    blocks: [{ id: "b-degraded-1", kind: "prose", md: String(rawText ?? "") }],
  };
}

/**
 * NULL server seam used in canned mode. Never binds a socket. Any attempt to
 * "listen" or otherwise reach the network increments egressCount so the
 * harness can assert offline purity (AC-19 group i / Step 0.5 acceptance).
 *
 * @returns {{ listen: Function, close: Function, openBrowser: Function,
 *             url: string|null, egressCount: number }}
 */
export function createNullServerSeam() {
  let egress = 0;
  return {
    /** Canned mode MUST NOT bind a socket. Calling this is a contract breach. */
    listen() {
      egress += 1;
      throw new Error(
        "network seam disabled in canned mode: attempted server.listen()",
      );
    },
    close() {
      /* no socket was ever opened */
    },
    /** Open-browser seam — no-op in canned mode, recorded for assertions. */
    openBrowser(_url) {
      egress += 1;
      throw new Error(
        "open-browser seam disabled in canned mode: attempted browser launch",
      );
    },
    get url() {
      return null;
    },
    get egressCount() {
      return egress;
    },
  };
}

/** Tiny non-cryptographic hash, only for deterministic degraded ids. */
function simpleHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
