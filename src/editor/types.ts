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
export type DocType = 'plan' | 'prd';

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
  | DiagramBlock;

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
/** A new block the reviewer added, anchored AFTER `afterId` (null = prepend). */
export interface BlockAdd {
  /** Insert directly after this existing block id; `null` prepends. */
  afterId: string | null;
  /**
   * The new block. `id` may be omitted/empty — deriveWorkingDoc mints a
   * deterministic, collision-free id. Loosely typed (the modal builds a
   * partial of the chosen kind, then deriveWorkingDoc folds it in).
   */
  block: Partial<Block> & { kind: BlockKind };
}

export interface EditorState {
  /**
   * blockId → shallow patch of changed fields. M4: ANY field of ANY kind
   * (not just task) — the per-kind edit modals produce these.
   */
  edits: Record<string, Partial<Block>>;
  /** blockId → reviewer comment text. */
  comments: Record<string, string>;
  /** blockId → answer text (openQuestion). */
  answers: Record<string, string>;
  /** M4: block ids the reviewer deleted (id-stable; nothing renumbers). */
  deletes?: string[];
  /** M4: blocks the reviewer added, in insertion order. */
  adds?: BlockAdd[];
  /** Optional document-wide comment. */
  globalComment?: string;
  /**
   * M3: the reviewer's full edited working document, derived from the base doc
   * + the affordances above. Consumed by the envelope builder on Approve so
   * the PRD path persists the structural edits as the next revision. Advisory
   * comment/globalComment are NOT folded into this — they stay envelope-only.
   */
  editedDocument?: PlanDocument;
}

export type EditorDecision = 'approve' | 'revise';

/** Callback surface consumed by US-014 / US-017 — the clean prop boundary. */
export interface EditorCallbacks {
  onApprove?: (state: EditorState, doc: PlanDocument) => void;
  onRevise?: (state: EditorState, doc: PlanDocument) => void;
}
