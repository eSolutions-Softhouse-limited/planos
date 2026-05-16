/**
 * planos editor — local type surface.
 *
 * Mirrors the v1 Block union from `src/schema/types.d.ts` (the contract) so the
 * editor compiles standalone without reaching into the schema package. Keep in
 * sync with docs/design.md §4. Editor-local state types (edits/comments/answers
 * and the callback surface) also live here — the FeedbackEnvelope itself is
 * deliberately NOT built here (that is US-017 / Step 3.2).
 */

export type LMH = 'L' | 'M' | 'H';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'cut';
export type DocStatus = 'draft' | 'in-review' | 'approved';
export type DocType = 'plan' | 'prd' | 'diff-review';

export interface SectionBlock {
  id: string;
  kind: 'section';
  title: string;
  level: number;
  collapsed?: boolean;
}

export interface ProseBlock {
  id: string;
  kind: 'prose';
  md: string;
}

export interface ObjectiveBlock {
  id: string;
  kind: 'objective';
  text: string;
  successCriteria: string[];
}

export interface TaskBlock {
  id: string;
  kind: 'task';
  title: string;
  detail?: string;
  status: TaskStatus;
  deps: string[];
  acceptance: string[];
  estimate?: string;
}

export interface DecisionOption {
  label: string;
  pros?: string[];
  cons?: string[];
}

export interface DecisionBlock {
  id: string;
  kind: 'decision';
  question: string;
  options: DecisionOption[];
  chosen?: string;
  rationale?: string;
}

export interface RiskBlock {
  id: string;
  kind: 'risk';
  description: string;
  likelihood: LMH;
  impact: LMH;
  mitigation: string;
}

export interface OpenQuestionBlock {
  id: string;
  kind: 'openQuestion';
  question: string;
  answer?: string;
}

// ---------------------------------------------------------------------------
// v2 block kinds (PRD-scoped — design.md §4). Mirror of src/schema/types.d.ts;
// keep both in sync. Runtime mirror is src/schema/validate.mjs.
// ---------------------------------------------------------------------------

export interface PhaseBlock {
  id: string;
  kind: 'phase';
  title: string;
  taskIds: string[];
}

export interface TradeoffOption {
  label: string;
  score?: number;
  note?: string;
}

export interface TradeoffBlock {
  id: string;
  kind: 'tradeoff';
  axis: string;
  options: TradeoffOption[];
}

export interface FileChangeBlock {
  id: string;
  kind: 'fileChange';
  path: string;
  action: 'add' | 'modify' | 'delete';
  rationale: string;
}

export interface CodeBlock {
  id: string;
  kind: 'code';
  lang: string;
  content: string;
  filename?: string;
}

export interface TableBlock {
  id: string;
  kind: 'table';
  columns: string[];
  rows: string[][];
}

export interface DiagramBlock {
  id: string;
  kind: 'diagram';
  mermaid: string;
}

// ---------------------------------------------------------------------------
// v3 block kind (diff-review-scoped — design.md §4). Mirror of
// src/schema/types.d.ts; keep both in sync. Runtime mirror is
// src/schema/validate.mjs (V3_KINDS + KIND_VALIDATORS.diff).
// ---------------------------------------------------------------------------

export interface DiffLine {
  op: ' ' | '+' | '-';
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  hunkId: string;
}

export interface BlockComment {
  commentId: string;
  hunkId: string | null;
  text: string;
  verdict: 'accept' | 'reject' | 'comment';
}

export interface DiffBlock {
  id: string;
  kind: 'diff';
  path: string;
  hunks: Hunk[];
  comments: BlockComment[];
  status?: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  oldPath?: string;
}

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

export type BlockKind = Block['kind'];

export interface DocumentMeta {
  branch?: string;
  status: DocStatus;
  createdAt: string;
  revision: number;
  degraded?: boolean;
}

export interface PlanDocument {
  schemaVersion: 1;
  type: DocType;
  id: string;
  title: string;
  meta: DocumentMeta;
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Editor-local interaction state (NOT the FeedbackEnvelope — that is Step 3.2)
// ---------------------------------------------------------------------------

/**
 * The structured surface the editor accumulates from user interactions. The
 * envelope-emission step (US-017) consumes exactly this; nothing here knows
 * about serialization, `documentId`, or `baseRevision`.
 */
export interface EditorState {
  /** blockId → shallow patch of changed fields (task edits). */
  edits: Record<string, Partial<TaskBlock>>;
  /** blockId → reviewer comment text. */
  comments: Record<string, string>;
  /** blockId → answer text (openQuestion). */
  answers: Record<string, string>;
  /** Optional document-wide comment. */
  globalComment?: string;
}

export type EditorDecision = 'approve' | 'revise';

/** Callback surface consumed by US-014 / US-017 — the clean prop boundary. */
export interface EditorCallbacks {
  onApprove?: (state: EditorState, doc: PlanDocument) => void;
  onRevise?: (state: EditorState, doc: PlanDocument) => void;
}
