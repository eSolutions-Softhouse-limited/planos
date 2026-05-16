/**
 * Block renderers — one kind-appropriate component per v1 block kind.
 *
 * Each renderer is read-first; the `task` renderer additionally supports inline
 * edit (title/status/acceptance) and the `openQuestion` renderer supports an
 * inline answer. Per-block commenting is provided by the shared `BlockShell`
 * wrapper around every block. All mutation flows up through callbacks — no
 * envelope/serialization logic lives here (that is Step 3.2 / US-017).
 */
import { useState, type ReactNode } from 'react';
import { Markdown } from './markdown';
import { MermaidDiagram } from './mermaid';
import { useTheme, type ThemeTokens } from './theme';
import {
  type Block,
  type CodeBlock,
  type DecisionBlock,
  type DiagramBlock,
  type DiffBlock,
  type FileChangeBlock,
  type HunkReview,
  type ObjectiveBlock,
  type OpenQuestionBlock,
  type PhaseBlock,
  type ProseBlock,
  type RiskBlock,
  type SectionBlock,
  type TableBlock,
  type TaskBlock,
  type TaskStatus,
  type TradeoffBlock,
} from './types';

const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'cut'];

const statusColors = (
  t: ThemeTokens
): Record<TaskStatus, { bg: string; fg: string }> => ({
  todo: { bg: t.statusTodoBg, fg: t.statusTodoFg },
  doing: { bg: t.statusDoingBg, fg: t.statusDoingFg },
  done: { bg: t.statusDoneBg, fg: t.statusDoneFg },
  cut: { bg: t.statusCutBg, fg: t.statusCutFg },
});

const LMH_LABEL: Record<string, string> = { L: 'Low', M: 'Medium', H: 'High' };

function KindBadge({ kind }: { kind: string }) {
  const theme = useTheme();
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: theme.textMuted,
        background: theme.codeInlineBg,
        padding: '2px 7px',
        borderRadius: 4,
      }}
    >
      {kind}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared shell — supplies the per-block comment affordance for ALL kinds.
// ---------------------------------------------------------------------------

interface ShellProps {
  block: Block;
  comment: string;
  onComment: (text: string) => void;
  children: ReactNode;
}

function BlockShell({ block, comment, onComment, children }: ShellProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(comment.length > 0);
  return (
    <div
      data-block-id={block.id}
      data-block-kind={block.kind}
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
        background: theme.surface,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <KindBadge kind={block.kind} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle comment"
          style={{
            fontSize: 12,
            color: comment ? theme.accent : theme.textFaint,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {comment ? '💬 commented' : '+ comment'}
        </button>
      </div>

      {children}

      {open && (
        <textarea
          aria-label={`Comment on ${block.id}`}
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          placeholder="Leave a comment for the agent…"
          rows={2}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '8px 10px',
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind renderers.
// ---------------------------------------------------------------------------

function SectionView({ block }: { block: SectionBlock }) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(Boolean(block.collapsed));
  const size = [22, 19, 17, 15, 14, 13][Math.min(block.level - 1, 5)] ?? 14;
  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: theme.text,
        }}
      >
        <span style={{ fontSize: 12, color: theme.textFaint }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span style={{ fontSize: size, fontWeight: 700 }}>{block.title}</span>
        <span style={{ fontSize: 11, color: theme.textFaint }}>
          H{block.level}
        </span>
      </button>
      {!collapsed && (
        <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 4 }}>
          (section group)
        </div>
      )}
    </div>
  );
}

function ProseView({ block }: { block: ProseBlock }) {
  const theme = useTheme();
  return (
    <div style={{ color: theme.textBody, fontSize: 14 }}>
      <Markdown source={block.md} />
    </div>
  );
}

function ObjectiveView({ block }: { block: ObjectiveBlock }) {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>
        🎯 {block.text}
      </div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
        Success criteria
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 20,
          fontSize: 13,
          color: theme.textSubtle,
        }}
      >
        {block.successCriteria.map((c, i) => (
          <li key={i} style={{ margin: '2px 0' }}>
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TaskViewProps {
  block: TaskBlock;
  patch: Partial<TaskBlock>;
  onPatch: (p: Partial<TaskBlock>) => void;
}

function TaskView({ block, patch, onPatch }: TaskViewProps) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const merged: TaskBlock = { ...block, ...patch };

  if (!editing) {
    const c = statusColors(theme)[merged.status];
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, color: theme.text }}>
            {merged.title}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 99,
              background: c.bg,
              color: c.fg,
            }}
          >
            {merged.status}
          </span>
          {merged.estimate && (
            <span style={{ fontSize: 12, color: theme.textFaint }}>
              ~{merged.estimate}
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              color: theme.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ✎ edit
          </button>
        </div>
        {merged.detail && (
          <p style={{ fontSize: 13, color: theme.textDetail, margin: '6px 0' }}>
            {merged.detail}
          </p>
        )}
        {merged.deps.length > 0 && (
          <div style={{ fontSize: 12, color: theme.textMuted, margin: '4px 0' }}>
            depends on: {merged.deps.join(', ')}
          </div>
        )}
        {merged.acceptance.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>
              Acceptance
            </div>
            <ul
              style={{
                margin: '2px 0 0',
                paddingLeft: 20,
                fontSize: 13,
                color: theme.textSubtle,
              }}
            >
              {merged.acceptance.map((a, i) => (
                <li key={i} style={{ margin: '2px 0' }}>
                  {a}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  // Edit mode — title / status / acceptance (AC-8).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 12, color: theme.textMuted }}>
        Title
        <input
          aria-label="Task title"
          value={merged.title}
          onChange={(e) => onPatch({ ...patch, title: e.target.value })}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 3,
            padding: '6px 9px',
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 6,
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
      </label>

      <label style={{ fontSize: 12, color: theme.textMuted }}>
        Status
        <select
          aria-label="Task status"
          value={merged.status}
          onChange={(e) =>
            onPatch({ ...patch, status: e.target.value as TaskStatus })
          }
          style={{
            display: 'block',
            marginTop: 3,
            padding: '6px 9px',
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label style={{ fontSize: 12, color: theme.textMuted }}>
        Acceptance (one per line)
        <textarea
          aria-label="Task acceptance"
          value={merged.acceptance.join('\n')}
          onChange={(e) =>
            onPatch({
              ...patch,
              acceptance: e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
            })
          }
          rows={3}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 3,
            padding: '6px 9px',
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </label>

      <button
        type="button"
        onClick={() => setEditing(false)}
        style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          padding: '6px 14px',
          background: theme.accent,
          color: theme.onAccent,
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Done
      </button>
    </div>
  );
}

function DecisionView({ block }: { block: DecisionBlock }) {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        ⚖ {block.question}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {block.options.map((opt, i) => {
          const chosen = block.chosen === opt.label;
          return (
            <div
              key={i}
              style={{
                border: `1px solid ${chosen ? theme.okBorder : theme.border}`,
                background: chosen ? theme.okBg : theme.surfaceMuted,
                borderRadius: 6,
                padding: '8px 10px',
              }}
            >
              <div
                style={{ fontWeight: 600, fontSize: 13, color: theme.text }}
              >
                {opt.label}
                {chosen && (
                  <span style={{ color: theme.statusDoneFg, marginLeft: 6 }}>
                    ✓ chosen
                  </span>
                )}
              </div>
              {opt.pros && opt.pros.length > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: theme.statusDoneFg,
                    marginTop: 4,
                  }}
                >
                  + {opt.pros.join('; ')}
                </div>
              )}
              {opt.cons && opt.cons.length > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: theme.statusCutFg,
                    marginTop: 2,
                  }}
                >
                  − {opt.cons.join('; ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {block.rationale && (
        <p
          style={{ fontSize: 13, color: theme.textDetail, margin: '8px 0 0' }}
        >
          <strong>Rationale:</strong> {block.rationale}
        </p>
      )}
    </div>
  );
}

function RiskView({ block }: { block: RiskBlock }) {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>
        ⚠ {block.description}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 13,
          color: theme.textSubtle,
        }}
      >
        <span>
          Likelihood:{' '}
          <strong>{LMH_LABEL[block.likelihood] ?? block.likelihood}</strong>
        </span>
        <span>
          Impact: <strong>{LMH_LABEL[block.impact] ?? block.impact}</strong>
        </span>
      </div>
      <p style={{ fontSize: 13, color: theme.textDetail, margin: '6px 0 0' }}>
        <strong>Mitigation:</strong> {block.mitigation}
      </p>
    </div>
  );
}

interface OpenQuestionViewProps {
  block: OpenQuestionBlock;
  answer: string;
  onAnswer: (text: string) => void;
}

function OpenQuestionView({ block, answer, onAnswer }: OpenQuestionViewProps) {
  const theme = useTheme();
  const current = answer || block.answer || '';
  return (
    <div>
      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>
        ❓ {block.question}
      </div>
      <textarea
        aria-label={`Answer ${block.id}`}
        value={current}
        onChange={(e) => onAnswer(e.target.value)}
        placeholder="Your answer (required by the agent)…"
        rows={2}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: `1px solid ${current ? theme.okBorder : theme.badBorder}`,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      {!current && (
        <div style={{ fontSize: 12, color: theme.statusCutFg, marginTop: 4 }}>
          This question requires an answer.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// v2 (PRD-scoped) renderers — design.md §4 / plan §3 "SPA renderer" column.
// Each is read-only; the comment affordance is supplied by BlockShell (so
// every v2 block is commentable, AC-P13). Zero new deps (zero-dep constraint):
// `code` uses a plain <pre> with no syntax-highlight library; `diagram` uses
// the build-time-bundled offline mermaid renderer (Resolved Decision D3).
// ---------------------------------------------------------------------------

/**
 * `phase`: title + ordered list of the referenced task titles, resolved via
 * the document `byId` map. Unresolved ids (agent-authored, not validator-
 * enforced per D5(iii)) are shown verbatim so nothing is silently dropped.
 */
function PhaseView({
  block,
  byId,
}: {
  block: PhaseBlock;
  byId: Record<string, Block>;
}) {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontWeight: 700, color: theme.text, marginBottom: 6 }}>
        🧭 {block.title}
      </div>
      {block.taskIds.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.textFaint }}>(no tasks)</div>
      ) : (
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 13,
            color: theme.textSubtle,
          }}
        >
          {block.taskIds.map((tid, i) => {
            const ref = byId[tid];
            const label =
              ref && 'title' in ref && typeof ref.title === 'string'
                ? ref.title
                : tid;
            const resolved = Boolean(ref);
            return (
              <li key={i} style={{ margin: '2px 0' }}>
                {label}
                {!resolved && (
                  <span style={{ color: theme.warn, marginLeft: 6 }}>
                    (unresolved id)
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** `tradeoff`: axis + option cards, each with a proportional score bar. */
function TradeoffView({ block }: { block: TradeoffBlock }) {
  const scores = block.options
    .map((o) => o.score)
    .filter((s): s is number => typeof s === 'number');
  const maxScore = scores.length > 0 ? Math.max(...scores, 1) : 1;
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        ⚖ Trade-off:{' '}
        <span style={{ color: theme.textDetail }}>{block.axis}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {block.options.map((opt, i) => {
          const hasScore = typeof opt.score === 'number';
          const pct = hasScore
            ? Math.max(0, Math.min(100, ((opt.score as number) / maxScore) * 100))
            : 0;
          return (
            <div
              key={i}
              style={{
                border: `1px solid ${theme.border}`,
                background: theme.surfaceMuted,
                borderRadius: 6,
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  fontWeight: 600,
                  color: theme.text,
                }}
              >
                <span>{opt.label}</span>
                {hasScore && (
                  <span style={{ fontSize: 12, color: theme.textMuted }}>
                    {opt.score}
                  </span>
                )}
              </div>
              {hasScore && (
                <div
                  style={{
                    marginTop: 6,
                    height: 6,
                    background: theme.border,
                    borderRadius: 99,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: theme.accent,
                    }}
                  />
                </div>
              )}
              {opt.note && (
                <div
                  style={{ fontSize: 12, color: theme.textDetail, marginTop: 6 }}
                >
                  {opt.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fileActionColors = (
  t: ThemeTokens
): Record<FileChangeBlock['action'], { bg: string; fg: string }> => ({
  add: { bg: t.statusDoneBg, fg: t.statusDoneFg },
  modify: { bg: t.statusDoingBg, fg: t.statusDoingFg },
  delete: { bg: t.statusCutBg, fg: t.statusCutFg },
});

/** `fileChange`: action badge + monospace path + rationale. */
function FileChangeView({ block }: { block: FileChangeBlock }) {
  const theme = useTheme();
  const c = fileActionColors(theme)[block.action] ?? {
    bg: theme.statusTodoBg,
    fg: theme.statusTodoFg,
  };
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '2px 8px',
            borderRadius: 4,
            background: c.bg,
            color: c.fg,
          }}
        >
          {block.action}
        </span>
        <code
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            color: theme.text,
          }}
        >
          {block.path}
        </code>
      </div>
      <p style={{ fontSize: 13, color: theme.textDetail, margin: '8px 0 0' }}>
        {block.rationale}
      </p>
    </div>
  );
}

/**
 * `code`: a plain <pre> with an optional filename header + a language label.
 * NO syntax-highlight dependency (zero-dep constraint, plan §3).
 */
function CodeView({ block }: { block: CodeBlock }) {
  const theme = useTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: theme.codeInlineBg,
          borderBottom: `1px solid ${theme.border}`,
          fontSize: 12,
        }}
      >
        <span
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            color: theme.textDetail,
          }}
        >
          {block.filename ?? '(inline)'}
        </span>
        <span
          style={{
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: theme.textMuted,
          }}
        >
          {block.lang || 'text'}
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          background: theme.codeBg,
          color: theme.codeText,
          fontSize: 12.5,
          lineHeight: 1.5,
          overflowX: 'auto',
          whiteSpace: 'pre',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {block.content}
      </pre>
    </div>
  );
}

/** `table`: a plain HTML table (columns header + string-cell rows). */
function TableView({ block }: { block: TableBlock }) {
  const theme = useTheme();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {block.columns.map((col, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left',
                  padding: '6px 10px',
                  borderBottom: `2px solid ${theme.borderStrong}`,
                  color: theme.textSubtle,
                  fontWeight: 700,
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: '6px 10px',
                    borderBottom: `1px solid ${theme.border}`,
                    color: theme.textDetail,
                    verticalAlign: 'top',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `diagram`: render the mermaid source visually via the build-time-bundled
 * offline renderer (Resolved Decision D3). A parse failure degrades to the
 * raw source in a <pre> and never crashes the SPA (see MermaidDiagram).
 */
function DiagramView({ block }: { block: DiagramBlock }) {
  return <MermaidDiagram source={block.mermaid} />;
}

// ---------------------------------------------------------------------------
// v3 (diff-review-scoped) renderer — Milestone R4. Plain React + inline
// styles, ZERO new deps, ZERO syntax-highlight lib (exactly like CodeView).
// Per-hunk accept/reject/comment is hunk-level only (R5); it flows up via
// `onHunkReview` and is serialized into an `editBlock` patch of `comments[]`
// (NO new envelope op). The block-level comment affordance stays in BlockShell.
// ---------------------------------------------------------------------------

const diffStatusColors = (
  t: ThemeTokens
): Record<NonNullable<DiffBlock['status']>, { bg: string; fg: string }> => ({
  added: { bg: t.statusDoneBg, fg: t.statusDoneFg },
  modified: { bg: t.statusDoingBg, fg: t.statusDoingFg },
  deleted: { bg: t.statusCutBg, fg: t.statusCutFg },
  renamed: { bg: t.statusRenamedBg, fg: t.statusRenamedFg },
  binary: { bg: t.statusTodoBg, fg: t.statusTodoFg },
});

const diffLineStyle = (
  t: ThemeTokens
): Record<' ' | '+' | '-', { bg: string; fg: string }> => ({
  ' ': { bg: 'transparent', fg: t.diffContextFg },
  '+': { bg: t.diffAddBg, fg: t.diffAddFg },
  '-': { bg: t.diffRemoveBg, fg: t.diffRemoveFg },
});

const HUNK_VERDICTS: HunkReview['verdict'][] = [
  'accept',
  'reject',
  'comment',
];

const hunkVerdictColors = (
  t: ThemeTokens
): Record<
  HunkReview['verdict'],
  { bg: string; fg: string; border: string }
> => ({
  accept: { bg: t.statusDoneBg, fg: t.statusDoneFg, border: t.okBorder },
  reject: { bg: t.statusCutBg, fg: t.statusCutFg, border: t.badBorder },
  comment: {
    bg: t.statusDoingBg,
    fg: t.statusDoingFg,
    border: t.infoBorder,
  },
});

interface DiffViewProps {
  block: DiffBlock;
  /** hunkId → current per-hunk review (verdict + optional comment text). */
  review: Record<string, HunkReview>;
  onHunkReview: (hunkId: string, next: HunkReview) => void;
}

/**
 * `diff`: a file-path header (status badge + mono path, `oldPath → path` on
 * rename), then a per-hunk unified-diff body styled by `DiffLine.op` in a
 * monospace <pre> exactly like `CodeView`. Each hunk carries a hunk-level
 * accept/reject/comment toggle + comment box (R5). Empty `hunks[]`
 * (binary / rename stub, R6) renders a descriptive affordance, never crashes.
 */
function DiffView({ block, review, onHunkReview }: DiffViewProps) {
  const theme = useTheme();
  const status = block.status;
  const badge = status ? diffStatusColors(theme)[status] : null;
  const hunks = Array.isArray(block.hunks) ? block.hunks : [];

  // Seed the per-hunk review from any pre-existing BlockComment in the doc
  // (hunkId-anchored), so a re-opened diff-review keeps prior verdicts.
  const seeded: Record<string, HunkReview> = {};
  for (const c of Array.isArray(block.comments) ? block.comments : []) {
    if (c && typeof c.hunkId === 'string' && c.hunkId.length > 0) {
      seeded[c.hunkId] = {
        verdict: c.verdict,
        text: typeof c.text === 'string' ? c.text : '',
      };
    }
  }
  const reviewFor = (hunkId: string): HunkReview =>
    review[hunkId] ??
    seeded[hunkId] ?? { verdict: 'comment', text: '' };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        {status && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 8px',
              borderRadius: 4,
              background: (badge ?? { bg: theme.statusTodoBg }).bg,
              color: (badge ?? { fg: theme.statusTodoFg }).fg,
            }}
          >
            {status}
          </span>
        )}
        <code
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            color: theme.text,
          }}
        >
          {status === 'renamed' && block.oldPath
            ? `${block.oldPath} → ${block.path}`
            : block.path}
        </code>
      </div>

      {hunks.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: theme.textMuted,
            fontStyle: 'italic',
            padding: '8px 10px',
            background: theme.surfaceMuted,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
          }}
        >
          {status === 'binary'
            ? 'binary file — no textual diff'
            : status === 'renamed'
              ? `renamed ${block.oldPath ?? '(unknown)'} → ${block.path}`
              : 'no textual diff'}
        </div>
      ) : (
        hunks.map((hunk) => {
          const r = reviewFor(hunk.hunkId);
          const dls = diffLineStyle(theme);
          return (
            <div
              key={hunk.hunkId}
              data-hunk-id={hunk.hunkId}
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                overflow: 'hidden',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  padding: '6px 10px',
                  background: theme.codeInlineBg,
                  borderBottom: `1px solid ${theme.border}`,
                  fontSize: 12,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  color: theme.textDetail,
                }}
              >
                {hunk.header}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px 0',
                  background: theme.codeBg,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  whiteSpace: 'pre',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              >
                {(Array.isArray(hunk.lines) ? hunk.lines : []).map(
                  (line, i) => {
                    const ls = dls[line.op] ?? dls[' '];
                    return (
                      <div
                        key={i}
                        style={{
                          background: ls.bg,
                          color: ls.fg,
                          padding: '0 12px',
                        }}
                      >
                        {line.op}
                        {line.text}
                      </div>
                    );
                  }
                )}
              </pre>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 10px',
                  borderTop: `1px solid ${theme.border}`,
                  background: theme.surface,
                }}
              >
                {HUNK_VERDICTS.map((v) => {
                  const active = r.verdict === v;
                  const c = hunkVerdictColors(theme)[v];
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-label={`${v} hunk ${hunk.hunkId}`}
                      aria-pressed={active}
                      onClick={() =>
                        onHunkReview(hunk.hunkId, { ...r, verdict: v })
                      }
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        padding: '3px 10px',
                        borderRadius: 99,
                        cursor: 'pointer',
                        background: active ? c.bg : theme.surfaceMuted,
                        color: active ? c.fg : theme.textFaint,
                        border: `1px solid ${
                          active ? c.border : theme.border
                        }`,
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>

              <textarea
                aria-label={`Comment on hunk ${hunk.hunkId}`}
                value={r.text}
                onChange={(e) =>
                  onHunkReview(hunk.hunkId, { ...r, text: e.target.value })
                }
                placeholder="Per-hunk comment for the agent…"
                rows={2}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  borderTop: `1px solid ${theme.border}`,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher.
// ---------------------------------------------------------------------------

export interface BlockRendererProps {
  block: Block;
  comment: string;
  taskPatch: Partial<TaskBlock>;
  answer: string;
  onComment: (text: string) => void;
  onTaskPatch: (p: Partial<TaskBlock>) => void;
  onAnswer: (text: string) => void;
  /**
   * Per-hunk review state for a `diff` block (hunkId → verdict + comment).
   * Optional so existing v1/v2 call sites keep working unchanged.
   */
  hunkReview?: Record<string, HunkReview>;
  /** Per-hunk review mutation (R5, hunk-level only). */
  onHunkReview?: (hunkId: string, next: HunkReview) => void;
  /**
   * All blocks in the document keyed by id — used by `phase` to resolve its
   * `taskIds` to task titles. Optional so existing call sites keep working;
   * unresolved ids fall back to showing the raw id.
   */
  byId?: Record<string, Block>;
}

export function BlockRenderer({
  block,
  comment,
  taskPatch,
  answer,
  onComment,
  onTaskPatch,
  onAnswer,
  hunkReview = {},
  onHunkReview,
  byId = {},
}: BlockRendererProps) {
  let body: ReactNode;
  switch (block.kind) {
    case 'section':
      body = <SectionView block={block} />;
      break;
    case 'prose':
      body = <ProseView block={block} />;
      break;
    case 'objective':
      body = <ObjectiveView block={block} />;
      break;
    case 'task':
      body = (
        <TaskView block={block} patch={taskPatch} onPatch={onTaskPatch} />
      );
      break;
    case 'decision':
      body = <DecisionView block={block} />;
      break;
    case 'risk':
      body = <RiskView block={block} />;
      break;
    case 'openQuestion':
      body = (
        <OpenQuestionView block={block} answer={answer} onAnswer={onAnswer} />
      );
      break;
    // v2 (PRD-scoped) kinds — Milestone P4. Each has a real kind-appropriate
    // renderer; the comment affordance still flows through BlockShell below.
    case 'phase':
      body = <PhaseView block={block} byId={byId} />;
      break;
    case 'tradeoff':
      body = <TradeoffView block={block} />;
      break;
    case 'fileChange':
      body = <FileChangeView block={block} />;
      break;
    case 'code':
      body = <CodeView block={block} />;
      break;
    case 'table':
      body = <TableView block={block} />;
      break;
    case 'diagram':
      body = <DiagramView block={block} />;
      break;
    // v3 (diff-review-scoped) kind — Milestone R0 placeholder satisfying the
    // exhaustiveness guard below. R4: full DiffView (file-path header, per-hunk
    // unified-diff render, per-hunk accept/reject + comment affordance).
    // v3 (diff-review-scoped) kind — Milestone R4. Real DiffView (file-path
    // header, per-hunk unified-diff render, per-hunk accept/reject + comment
    // affordance). Satisfies the `_never` guard with a real render, not null.
    case 'diff':
      body = (
        <DiffView
          block={block}
          review={hunkReview}
          onHunkReview={(hunkId, next) =>
            onHunkReview?.(hunkId, next)
          }
        />
      );
      break;
    default: {
      // Exhaustiveness guard: every one of the 14 Block kinds (7 v1 + 6 v2 +
      // 1 v3) is handled above, so `block` is `never` here. If a new kind is
      // added to the `Block` union without a case, this assignment fails to
      // compile — a build-time completeness gate (plan §3 schema engine
      // extension points). The runtime arm only renders if the type system is
      // bypassed.
      const _never: never = block;
      body = <pre>{JSON.stringify(_never, null, 2)}</pre>;
    }
  }

  return (
    <BlockShell block={block} comment={comment} onComment={onComment}>
      {body}
    </BlockShell>
  );
}
