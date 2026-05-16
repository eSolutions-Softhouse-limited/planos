/**
 * planos — v1 core block schema (the contract).
 *
 * This file is the type-level mirror of the runtime validator in `validate.mjs`.
 * It documents the discriminated union exactly as specified in docs/design.md §4
 * (v1 core — Plan). v2/v3 kinds are intentionally NOT modeled here: v1 is the
 * only contract the validator enforces.
 *
 * Zero runtime dependencies. ES modules. Pure type declarations.
 */

/** Tri-state qualitative scale used by `risk` likelihood/impact. */
export type LMH = "L" | "M" | "H";

/** Lifecycle status of a `task` block. */
export type TaskStatus = "todo" | "doing" | "done" | "cut";

/** Document-level workflow status. */
export type DocStatus = "draft" | "in-review" | "approved";

/** Document type. v1 implements `"plan"`; the others are reserved for later phases. */
export type DocType = "plan" | "prd" | "diff-review";

/**
 * Structural grouping header. `level` mirrors a markdown heading depth.
 */
export interface SectionBlock {
  id: string;
  kind: "section";
  title: string;
  level: number;
  /** Optional UI hint — collapsed by default in the editor when true. */
  collapsed?: boolean;
}

/** Free narrative. `md` is markdown; this is also the degraded-fallback container. */
export interface ProseBlock {
  id: string;
  kind: "prose";
  md: string;
}

/** A goal plus its measurable success criteria. */
export interface ObjectiveBlock {
  id: string;
  kind: "objective";
  text: string;
  successCriteria: string[];
}

/** A unit of work with status, dependency edges, and acceptance criteria. */
export interface TaskBlock {
  id: string;
  kind: "task";
  title: string;
  detail?: string;
  status: TaskStatus;
  /** Block ids of tasks this task depends on. */
  deps: string[];
  acceptance: string[];
  estimate?: string;
}

/** A single weighed option inside a `decision` block. */
export interface DecisionOption {
  label: string;
  pros?: string[];
  cons?: string[];
}

/** ADR-style decision card. `chosen` references one option `label`. */
export interface DecisionBlock {
  id: string;
  kind: "decision";
  question: string;
  options: DecisionOption[];
  chosen?: string;
  rationale?: string;
}

/** A risk with qualitative likelihood/impact and a mitigation. */
export interface RiskBlock {
  id: string;
  kind: "risk";
  description: string;
  likelihood: LMH;
  impact: LMH;
  mitigation: string;
}

/** An inline question that REQUIRES human input. `answer` filled by the reviewer. */
export interface OpenQuestionBlock {
  id: string;
  kind: "openQuestion";
  question: string;
  answer?: string;
}

// ---------------------------------------------------------------------------
// v2 block kinds (PRD-scoped — design.md §4 lines 143-149). The runtime mirror
// is `validate.mjs` (V2_KINDS + KIND_VALIDATORS). v2 kinds are accepted ONLY
// in `type:"prd"` documents; a `type:"prd"` document accepts v1∪v2.
// ---------------------------------------------------------------------------

/** A delivery phase grouping `task` blocks by id (agent-authored, unchecked). */
export interface PhaseBlock {
  id: string;
  kind: "phase";
  title: string;
  /** Block ids of the `task` blocks in this phase (like v1 `task.deps`). */
  taskIds: string[];
}

/** A single weighed option inside a `tradeoff` block. */
export interface TradeoffOption {
  label: string;
  score?: number;
  note?: string;
}

/** A decision axis with scored options. */
export interface TradeoffBlock {
  id: string;
  kind: "tradeoff";
  axis: string;
  options: TradeoffOption[];
}

/** A planned filesystem change with rationale. */
export interface FileChangeBlock {
  id: string;
  kind: "fileChange";
  path: string;
  action: "add" | "modify" | "delete";
  rationale: string;
}

/** A code snippet. `content` may be empty. */
export interface CodeBlock {
  id: string;
  kind: "code";
  lang: string;
  content: string;
  filename?: string;
}

/** A tabular block. Every `rows` entry length must equal `columns.length`. */
export interface TableBlock {
  id: string;
  kind: "table";
  columns: string[];
  rows: string[][];
}

/** A mermaid diagram source. */
export interface DiagramBlock {
  id: string;
  kind: "diagram";
  mermaid: string;
}

// ---------------------------------------------------------------------------
// v3 block kind (diff-review-scoped — design.md §4 lines 151-153). The runtime
// mirror is `validate.mjs` (V3_KINDS + KIND_VALIDATORS.diff). v3 `diff` is
// accepted ONLY in `type:"diff-review"` documents; a `type:"diff-review"`
// document accepts v1∪v3 (NOT v2 PRD kinds — R7).
// ---------------------------------------------------------------------------

/** A single unified-diff line. `text` is the content WITHOUT the op char. */
export interface DiffLine {
  /** `" "` context | `"+"` added | `"-"` removed. */
  op: " " | "+" | "-";
  /** The line content without the leading op char; may be empty. */
  text: string;
}

/** One `@@`-delimited hunk. `hunkId` is a stable opaque per-hunk anchor. */
export interface Hunk {
  /** The `@@ -a,b +c,d @@` line (may carry a section heading). */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  /** Stable per-hunk anchor for accept/reject/comment (ADR-0001 recursively). */
  hunkId: string;
}

/** A per-hunk (or file-level) review comment carrying a verdict (R5). */
export interface BlockComment {
  /** Stable opaque comment id. */
  commentId: string;
  /** The `Hunk.hunkId` this anchors to, or `null` for a file-level comment. */
  hunkId: string | null;
  text: string;
  /** The per-hunk review verdict carried alongside the comment text. */
  verdict: "accept" | "reject" | "comment";
}

/** A concrete file diff with per-hunk lines and per-hunk review comments. */
export interface DiffBlock {
  id: string;
  kind: "diff";
  path: string;
  /** May be empty for a binary/rename stub (R6). */
  hunks: Hunk[];
  /** Per-hunk/file-level review comments; may be empty. */
  comments: BlockComment[];
  status?: "added" | "modified" | "deleted" | "renamed" | "binary";
  /** Present only for a renamed file (the pre-rename path). */
  oldPath?: string;
}

/** v1∪v2∪v3 discriminated union — discriminant is `kind`. */
export type Block =
  | SectionBlock
  | ProseBlock
  | ObjectiveBlock
  | TaskBlock
  | DecisionBlock
  | RiskBlock
  | OpenQuestionBlock
  | PhaseBlock
  | TradeoffBlock
  | FileChangeBlock
  | CodeBlock
  | TableBlock
  | DiagramBlock
  | DiffBlock;

/** Set of valid v1∪v2∪v3 `kind` discriminants. */
export type BlockKind = Block["kind"];

export interface DocumentMeta {
  branch?: string;
  status: DocStatus;
  /** ISO-8601 timestamp string. */
  createdAt: string;
  /** Monotonic integer revision; the revision-chain counter. */
  revision: number;
  /**
   * Set to `true` ONLY by the deterministic prose fallback when the agent's
   * `tool_input.plan` failed validation and was wrapped verbatim. The editor
   * surfaces a "this plan wasn't structured" affordance when present.
   */
  degraded?: boolean;
}

/** The canonical artifact. `id` is stable across revisions (revision-chain key). */
export interface Document {
  schemaVersion: 1;
  type: DocType;
  id: string;
  title: string;
  meta: DocumentMeta;
  blocks: Block[];
}

/** Discriminated result of `validateDocument`. */
export type ValidationResult =
  | { ok: true; doc: Document }
  | { ok: false; errors: string[] };

/**
 * Zero-dependency structural validator. Returns `{ ok: true, doc }` for a
 * well-formed v1 document, or `{ ok: false, errors }` where every error is a
 * human-readable, field-level string designed to feed the corrective
 * deny→revise preamble.
 */
export declare function validateDocument(obj: unknown): ValidationResult;

/**
 * Deterministic, model-free fallback. Wraps arbitrary text in exactly ONE
 * `prose` block, generates a fresh document id, sets `meta.degraded = true`
 * and `meta.revision = 1`. Pure: no network, no model, no clock-dependence
 * beyond `createdAt`.
 */
export declare function degradeToProse(rawText: string): Document;

// ---------------------------------------------------------------------------
// FeedbackEnvelope (browser → agent) — design.md §4, plan Step 2f.4
// ---------------------------------------------------------------------------

/** Reviewer decision carried by the envelope. */
export type EnvelopeDecision = "approve" | "revise";

/** Optional intra-block character anchor for a `comment` op. */
export interface CommentAnchor {
  start: number;
  end: number;
}

/** The block-addressed structured edit union (design.md §4). */
export type Edit =
  | { op: "editBlock"; blockId: string; patch: Partial<Block> }
  | { op: "deleteBlock"; blockId: string }
  | { op: "moveBlock"; blockId: string; afterBlockId: string | null }
  | { op: "comment"; blockId: string; text: string; anchor?: CommentAnchor }
  | { op: "answer"; blockId: string; answer: string }
  | { op: "addBlock"; afterBlockId: string | null; block: Block };

/** The structured browser→agent feedback envelope. */
export interface FeedbackEnvelope {
  decision: EnvelopeDecision;
  /** The revision-chain key — must match `Document.id`. */
  documentId: string;
  /** The revision the human edited against (the race guard — AC-10). */
  baseRevision: number;
  ops: Edit[];
  globalComment?: string;
}

/** Discriminated result of `validateEnvelope`. */
export type EnvelopeValidationResult =
  | { ok: true; envelope: FeedbackEnvelope }
  | { ok: false; errors: string[] };

/** The exact set of envelope decisions. */
export declare const ENVELOPE_DECISIONS: readonly EnvelopeDecision[];

/** The exact `Edit` union op discriminants. */
export declare const EDIT_OPS: readonly Edit["op"][];

/**
 * Zero-dependency structural validator for the FeedbackEnvelope. Returns
 * `{ ok: true, envelope }` for a well-formed envelope, else
 * `{ ok: false, errors }` where every error is a field-level string shaped
 * to feed the corrective deny→revise preamble.
 */
export declare function validateEnvelope(
  obj: unknown,
): EnvelopeValidationResult;

/** Outcome of the `baseRevision` race guard (AC-10). */
export interface BaseRevisionCheck {
  stale: boolean;
  canonicalRevision: number;
  baseRevision: number;
  action: "apply" | "re-render";
}

/**
 * `baseRevision` race guard. When the canonical doc's `meta.revision` differs
 * from the envelope's `baseRevision`, the ops are stale and the server must
 * re-render rather than apply them.
 */
export declare function checkBaseRevision(
  canonicalRevision: number,
  baseRevision: number,
): BaseRevisionCheck;

/**
 * Render a validated envelope's ops + globalComment as a human-readable
 * directive section for the deny→revise preamble (AC-5).
 */
export declare function renderOpsHuman(envelope: FeedbackEnvelope): string;

// ---------------------------------------------------------------------------
// Block-ID strategies (Milestone 1 spike — plan Step 1.1, design.md §6)
// ---------------------------------------------------------------------------

/**
 * The two candidate block-ID schemes prototyped behind a flag. The winning
 * scheme is NOT chosen at the type level — it is deferred to the Milestone 1
 * live gate and recorded in `docs/adr/0001-block-id-scheme.md`.
 */
export type IdStrategy = "semantic-slug" | "opaque";

/** Stateful per-strategy id minter. `opaque` carries a monotonic counter. */
export interface IdFactory {
  strategy: IdStrategy;
  /**
   * Mint an id for `block` that does not collide with `existingIds`. For
   * `semantic-slug`, derived from the block's primary text + kind; for
   * `opaque`, a short content-independent `b<number>` token.
   */
  mint(
    block: unknown,
    existingIds?: Set<string> | Iterable<string>,
  ): string;
}

/** The two valid strategy identifiers. */
export declare const ID_STRATEGIES: readonly IdStrategy[];

/** Env var that selects the active strategy (`PLANOS_ID_STRATEGY`). */
export declare const ID_STRATEGY_ENV: string;

/**
 * DEV-ONLY default strategy. NOT a production decision — the real default is
 * set by the Milestone 1 live gate (ADR-0001), not by this constant.
 */
export declare const DEV_DEFAULT_STRATEGY: IdStrategy;

/** Resolve the active strategy from the environment (DEV default otherwise). */
export declare function getStrategy(env?: {
  [k: string]: string | undefined;
}): IdStrategy;

/** Build an id factory for `strategy` (defaults to {@link getStrategy}). */
export declare function makeIdFactory(strategy?: IdStrategy): IdFactory;

/**
 * Canonical authoring-instruction text for `strategy`, injected into the
 * EnterPlanMode `additionalContext`. Always contains the strategy-invariant
 * never-renumber rule plus strategy-specific guidance.
 */
export declare function idPreservationInstruction(
  strategy?: IdStrategy,
): string;

/** The active strategy's full runtime surface, resolved from the flag. */
export declare function activeIdStrategy(env?: {
  [k: string]: string | undefined;
}): {
  strategy: IdStrategy;
  idFactory: IdFactory;
  authoringInstruction: string;
};
