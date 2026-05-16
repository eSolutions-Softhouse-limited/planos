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
import {
  type Block,
  type DecisionBlock,
  type ObjectiveBlock,
  type OpenQuestionBlock,
  type ProseBlock,
  type RiskBlock,
  type SectionBlock,
  type TaskBlock,
  type TaskStatus,
} from './types';

const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'cut'];

const STATUS_COLORS: Record<TaskStatus, { bg: string; fg: string }> = {
  todo: { bg: '#e5e7eb', fg: '#374151' },
  doing: { bg: '#dbeafe', fg: '#1e40af' },
  done: { bg: '#dcfce7', fg: '#15803d' },
  cut: { bg: '#fee2e2', fg: '#b91c1c' },
};

const LMH_LABEL: Record<string, string> = { L: 'Low', M: 'Medium', H: 'High' };

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        background: '#f1f5f9',
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
  const [open, setOpen] = useState(comment.length > 0);
  return (
    <div
      data-block-id={block.id}
      data-block-kind={block.kind}
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
        background: '#fff',
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
            color: comment ? '#2563eb' : '#94a3b8',
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
            border: '1px solid #cbd5e1',
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
          color: '#0f172a',
        }}
      >
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span style={{ fontSize: size, fontWeight: 700 }}>{block.title}</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>H{block.level}</span>
      </button>
      {!collapsed && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          (section group)
        </div>
      )}
    </div>
  );
}

function ProseView({ block }: { block: ProseBlock }) {
  return (
    <div style={{ color: '#1e293b', fontSize: 14 }}>
      <Markdown source={block.md} />
    </div>
  );
}

function ObjectiveView({ block }: { block: ObjectiveBlock }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
        🎯 {block.text}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        Success criteria
      </div>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#334155' }}>
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
  const [editing, setEditing] = useState(false);
  const merged: TaskBlock = { ...block, ...patch };

  if (!editing) {
    const c = STATUS_COLORS[merged.status];
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
          <span style={{ fontWeight: 600, color: '#0f172a' }}>
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
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              ~{merged.estimate}
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              color: '#2563eb',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ✎ edit
          </button>
        </div>
        {merged.detail && (
          <p style={{ fontSize: 13, color: '#475569', margin: '6px 0' }}>
            {merged.detail}
          </p>
        )}
        {merged.deps.length > 0 && (
          <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0' }}>
            depends on: {merged.deps.join(', ')}
          </div>
        )}
        {merged.acceptance.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              Acceptance
            </div>
            <ul
              style={{
                margin: '2px 0 0',
                paddingLeft: 20,
                fontSize: 13,
                color: '#334155',
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
      <label style={{ fontSize: 12, color: '#64748b' }}>
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
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
      </label>

      <label style={{ fontSize: 12, color: '#64748b' }}>
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
            border: '1px solid #cbd5e1',
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

      <label style={{ fontSize: 12, color: '#64748b' }}>
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
            border: '1px solid #cbd5e1',
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
          background: '#2563eb',
          color: '#fff',
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
  return (
    <div>
      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
        ⚖ {block.question}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {block.options.map((opt, i) => {
          const chosen = block.chosen === opt.label;
          return (
            <div
              key={i}
              style={{
                border: `1px solid ${chosen ? '#86efac' : '#e2e8f0'}`,
                background: chosen ? '#f0fdf4' : '#f8fafc',
                borderRadius: 6,
                padding: '8px 10px',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                {opt.label}
                {chosen && (
                  <span style={{ color: '#15803d', marginLeft: 6 }}>
                    ✓ chosen
                  </span>
                )}
              </div>
              {opt.pros && opt.pros.length > 0 && (
                <div style={{ fontSize: 12, color: '#15803d', marginTop: 4 }}>
                  + {opt.pros.join('; ')}
                </div>
              )}
              {opt.cons && opt.cons.length > 0 && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>
                  − {opt.cons.join('; ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {block.rationale && (
        <p style={{ fontSize: 13, color: '#475569', margin: '8px 0 0' }}>
          <strong>Rationale:</strong> {block.rationale}
        </p>
      )}
    </div>
  );
}

function RiskView({ block }: { block: RiskBlock }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
        ⚠ {block.description}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#334155' }}>
        <span>
          Likelihood:{' '}
          <strong>{LMH_LABEL[block.likelihood] ?? block.likelihood}</strong>
        </span>
        <span>
          Impact: <strong>{LMH_LABEL[block.impact] ?? block.impact}</strong>
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#475569', margin: '6px 0 0' }}>
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
  const current = answer || block.answer || '';
  return (
    <div>
      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
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
          border: `1px solid ${current ? '#86efac' : '#fca5a5'}`,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      {!current && (
        <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
          This question requires an answer.
        </div>
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
}

export function BlockRenderer({
  block,
  comment,
  taskPatch,
  answer,
  onComment,
  onTaskPatch,
  onAnswer,
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
    default: {
      // v1 kinds are all handled above. v2 kinds (phase/tradeoff/fileChange/
      // code/table/diagram) are part of the type union from Milestone P0 but
      // their kind-specific *View renderers land in Milestone P4 — until then
      // they fall back to a raw structural view (no crash, comment affordance
      // still works via BlockShell). NOT a real renderer; P4 owns that.
      body = <pre>{JSON.stringify(block, null, 2)}</pre>;
    }
  }

  return (
    <BlockShell block={block} comment={comment} onComment={onComment}>
      {body}
    </BlockShell>
  );
}
