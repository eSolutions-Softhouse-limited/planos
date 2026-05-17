/**
 * planos editor — in-house per-kind block editing UI (Milestone M4).
 *
 * Zero new runtime dependency (the offline gate / zero-dep posture is
 * non-negotiable — see docs/design.md §5, tests/ac17-invariant):
 *   - The modal/overlay is hand-rolled React (NO modal/form library).
 *   - The table editor is a hand-rolled grid (NO grid library).
 *   - The diagram editor reuses the ALREADY-bundled offline mermaid renderer
 *     (src/editor/mermaid.tsx — Resolved Decision D3) with a debounced live
 *     preview; a parse error degrades inline and never crashes the SPA.
 *   - STEP E (M4b): prose editing is a REAL TipTap/ProseMirror WYSIWYG editor.
 *     TipTap + tiptap-markdown are BUILD-TIME devDependencies, inlined fully
 *     into the single-file bundle exactly like React and the offline mermaid
 *     renderer — nothing is fetched at runtime, so the offline gate still
 *     holds (empirically proven; see M4b report). The block's markdown `md`
 *     field round-trips losslessly through tiptap-markdown; a genuine editor
 *     throw degrades inline to the in-house markdown textarea.
 *
 * Every mutation flows OUT through `onSave(patch)` / add / delete callbacks
 * into App's `edits`/`adds`/`deletes` state → the single `deriveWorkingDoc`
 * fold-back site. This component owns NO document state and does NO transport.
 */
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown as TiptapMarkdown } from 'tiptap-markdown';
import { Markdown } from './markdown';
import { MermaidDiagram } from './mermaid';
import { useTheme, type ThemeTokens } from './theme';
import {
  type Block,
  type BlockKind,
  type CodeBlock,
  type DecisionBlock,
  type DiagramBlock,
  type FileChangeBlock,
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
const LMH_VALUES = ['L', 'M', 'H'] as const;
const FILE_ACTIONS = ['add', 'modify', 'delete'] as const;

/** All 13 kinds, in canonical schema order — the add-block kind picker. */
export const ALL_KINDS: BlockKind[] = [
  'section',
  'prose',
  'objective',
  'task',
  'decision',
  'risk',
  'openQuestion',
  'phase',
  'tradeoff',
  'fileChange',
  'code',
  'table',
  'diagram',
];

/**
 * A schema-valid empty block of `kind` (no id — deriveWorkingDoc mints it).
 * Mirrors the required fields the validator enforces (src/schema/validate.mjs)
 * so an add → approve round-trip is validateDocument-clean by construction.
 */
export function emptyBlock(kind: BlockKind): Partial<Block> & { kind: BlockKind } {
  switch (kind) {
    case 'section':
      return { kind, title: 'New section', level: 1 };
    case 'prose':
      return { kind, md: '' };
    case 'objective':
      return { kind, text: 'New objective', successCriteria: [] };
    case 'task':
      return {
        kind,
        title: 'New task',
        status: 'todo',
        deps: [],
        acceptance: [],
      };
    case 'decision':
      return { kind, question: 'New decision?', options: [{ label: 'Option A' }] };
    case 'risk':
      return {
        kind,
        description: 'New risk',
        likelihood: 'M',
        impact: 'M',
        mitigation: '',
      };
    case 'openQuestion':
      return { kind, question: 'New open question?' };
    case 'phase':
      return { kind, title: 'New phase', taskIds: [] };
    case 'tradeoff':
      return { kind, axis: 'New axis', options: [{ label: 'Option A' }] };
    case 'fileChange':
      return { kind, path: 'path/to/file', action: 'modify', rationale: '' };
    case 'code':
      return { kind, lang: 'text', content: '' };
    case 'table':
      return { kind, columns: ['Column 1'], rows: [['']] };
    case 'diagram':
      return { kind, mermaid: 'graph TD\n  A --> B' };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared field primitives — styled once, reused by every kind form.
// ---------------------------------------------------------------------------

function useFieldStyles() {
  const theme = useTheme();
  const label: React.CSSProperties = {
    fontSize: 12,
    color: theme.textMuted,
    display: 'block',
    marginBottom: 10,
  };
  const control: React.CSSProperties = {
    display: 'block',
    width: '100%',
    marginTop: 3,
    padding: '6px 9px',
    border: `1px solid ${theme.borderStrong}`,
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: theme.surface,
    color: theme.text,
  };
  return { theme, label, control };
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const s = useFieldStyles();
  return (
    <label style={s.label}>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={s.control}
      />
    </label>
  );
}

function AreaField({
  label,
  value,
  onChange,
  rows = 4,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  const s = useFieldStyles();
  return (
    <label style={s.label}>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{
          ...s.control,
          resize: 'vertical',
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            : 'inherit',
          fontSize: mono ? 12.5 : 14,
        }}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  const s = useFieldStyles();
  return (
    <label style={s.label}>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={s.control}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A string[] edited one-item-per-line (deps / acceptance / successCriteria). */
function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <AreaField
      label={`${label} (one per line)`}
      value={value.join('\n')}
      onChange={(v) =>
        onChange(
          v
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        )
      }
      rows={3}
    />
  );
}

// ---------------------------------------------------------------------------
// STEP E — prose editor: a REAL TipTap/ProseMirror WYSIWYG editor (M4b).
//
// TipTap (@tiptap/react + @tiptap/starter-kit + @tiptap/pm) and the
// `tiptap-markdown` serializer are BUILD-TIME devDependencies, inlined fully
// into the single-file plugin/dist/index.html exactly like React and the
// offline mermaid renderer (ADR-0002 D3) — the "zero RUNTIME dependency"
// posture means nothing is fetched at runtime, NOT "no build-time libs".
//
// The prose block's field is markdown (`md`). `tiptap-markdown` parses `md`
// into the ProseMirror doc on mount and serializes the StarterKit node tree
// back to markdown on every change via `editor.storage.markdown.getMarkdown()`
// — a lossless round-trip for common markdown (headings, lists, bold/italic,
// inline + fenced code, links, blockquote, hr). The serialized markdown folds
// back through the UNCHANGED `set({ md })` → deriveWorkingDoc seam: the
// transport / persist contract is untouched.
//
// A graceful inline fallback (the in-house markdown textarea + bundled
// `Markdown` preview) is rendered ONLY if the editor genuinely throws — it is
// an error boundary, never the primary path.
// ---------------------------------------------------------------------------

/** The in-house markdown textarea + preview — the genuine-failure fallback. */
function ProseFallbackEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <div>
      <AreaField label="Prose (markdown)" value={value} onChange={onChange} rows={8} />
      <div style={{ fontSize: 12, color: theme.textMuted, margin: '4px 0 6px' }}>
        Live preview (rich editor unavailable — markdown fallback)
      </div>
      <div
        data-testid="prose-preview"
        style={{
          border: `1px solid ${theme.border}`,
          borderRadius: 6,
          padding: '10px 12px',
          background: theme.surfaceMuted,
          color: theme.textBody,
          fontSize: 14,
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        <Markdown source={value || '_(empty)_'} />
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  theme,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  theme: ThemeTokens;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => {
        // Keep the ProseMirror selection — toolbar clicks must not blur it.
        e.preventDefault();
      }}
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '3px 8px',
        border: `1px solid ${theme.borderStrong}`,
        borderRadius: 4,
        background: active ? theme.accent : theme.surfaceMuted,
        color: active ? theme.onAccent : theme.textDetail,
        cursor: 'pointer',
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

/** The TipTap WYSIWYG prose editor. Throws are caught by ProseEditor's boundary. */
function TiptapProseEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  // `value` is the source of truth held by the modal draft; we only push it
  // INTO the editor on mount (and external resets), and pull markdown OUT on
  // every transaction. A ref tracks the last value WE emitted so an external
  // change (e.g. kind re-seed) re-syncs without clobbering local typing.
  const lastEmitted = useRef<string>(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapMarkdown.configure({
        html: false,
        tightLists: true,
        linkify: false,
        breaks: false,
        transformPastedText: true,
      }),
    ],
    content: value,
    onUpdate({ editor: ed }) {
      const md = ed.storage.markdown.getMarkdown() as string;
      lastEmitted.current = md;
      onChange(md);
    },
    editorProps: {
      attributes: {
        'aria-label': 'Prose (rich text)',
        'data-testid': 'prose-richtext',
        style: 'outline: none; min-height: 140px;',
      },
    },
  });

  // Re-sync if `value` changes from OUTSIDE the editor (kind re-seed / reset).
  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div style={{ fontSize: 12, color: theme.textMuted }}>Loading editor…</div>
    );
  }

  const tb: Array<{ label: string; active: boolean; run: () => void }> = [
    {
      label: 'B',
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'I',
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: '<>',
      active: editor.isActive('code'),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'H1',
      active: editor.isActive('heading', { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'H2',
      active: editor.isActive('heading', { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'H3',
      active: editor.isActive('heading', { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: '• List',
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: '1. List',
      active: editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code block',
      active: editor.isActive('codeBlock'),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
        Prose (rich text — markdown round-trips on save)
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 5,
          marginBottom: 6,
        }}
      >
        {tb.map((b) => (
          <ToolbarButton
            key={b.label}
            label={b.label}
            active={b.active}
            onClick={b.run}
            theme={theme}
          />
        ))}
      </div>
      <div
        style={{
          border: `1px solid ${theme.borderStrong}`,
          borderRadius: 6,
          padding: '8px 12px',
          background: theme.surface,
          color: theme.text,
          fontSize: 14,
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/**
 * Prose editor with a genuine-failure error boundary: if TipTap/ProseMirror
 * throws while parsing/rendering, degrade inline to the in-house markdown
 * textarea so the modal (and the SPA) never crash. The boundary is NOT the
 * primary path — a healthy editor never reaches the fallback.
 */
class ProseEditor extends Component<
  { value: string; onChange: (v: string) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    // Inert log — never throws, never networks (offline-safe).
    console.error('[planos] prose rich editor failed; using markdown fallback', err);
  }

  render() {
    if (this.state.failed) {
      return (
        <ProseFallbackEditor
          value={this.props.value}
          onChange={this.props.onChange}
        />
      );
    }
    return (
      <TiptapProseEditor
        value={this.props.value}
        onChange={this.props.onChange}
      />
    );
  }
}

// ---------------------------------------------------------------------------
// STEP D — diagram editor: mermaid source + DEBOUNCED live offline preview.
// ---------------------------------------------------------------------------

function DiagramEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  const [preview, setPreview] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPreview(value), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  return (
    <div>
      <AreaField
        label="Mermaid source"
        value={value}
        onChange={onChange}
        rows={8}
        mono
      />
      <div style={{ fontSize: 12, color: theme.textMuted, margin: '4px 0 6px' }}>
        Live preview (offline mermaid; errors show inline)
      </div>
      <div
        data-testid="diagram-preview"
        style={{
          border: `1px solid ${theme.border}`,
          borderRadius: 6,
          padding: '10px 12px',
          background: theme.surfaceMuted,
          maxHeight: 280,
          overflow: 'auto',
        }}
      >
        <MermaidDiagram source={preview} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEP C — editable table grid: add/remove row & column, edit cells & headers.
// ---------------------------------------------------------------------------

function TableEditor({
  columns,
  rows,
  onChange,
}: {
  columns: string[];
  rows: string[][];
  onChange: (next: { columns: string[]; rows: string[][] }) => void;
}) {
  const theme = useTheme();

  const setHeader = (ci: number, v: string) => {
    const next = columns.slice();
    next[ci] = v;
    onChange({ columns: next, rows });
  };
  const setCell = (ri: number, ci: number, v: string) => {
    const nextRows = rows.map((r) => r.slice());
    nextRows[ri][ci] = v;
    onChange({ columns, rows: nextRows });
  };
  const addColumn = () => {
    onChange({
      columns: [...columns, `Column ${columns.length + 1}`],
      rows: rows.map((r) => [...r, '']),
    });
  };
  const removeColumn = (ci: number) => {
    if (columns.length <= 1) return;
    onChange({
      columns: columns.filter((_, i) => i !== ci),
      rows: rows.map((r) => r.filter((_, i) => i !== ci)),
    });
  };
  const addRow = () => {
    onChange({ columns, rows: [...rows, columns.map(() => '')] });
  };
  const removeRow = (ri: number) => {
    onChange({ columns, rows: rows.filter((_, i) => i !== ri) });
  };

  const cellInput: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '4px 6px',
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    fontSize: 13,
    background: theme.surface,
    color: theme.text,
  };
  const miniBtn: React.CSSProperties = {
    fontSize: 11,
    padding: '2px 7px',
    border: `1px solid ${theme.borderStrong}`,
    borderRadius: 4,
    background: theme.surfaceMuted,
    color: theme.textDetail,
    cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {columns.map((col, ci) => (
                <th key={ci} style={{ padding: 4 }}>
                  <input
                    aria-label={`Column ${ci + 1} header`}
                    value={col}
                    onChange={(e) => setHeader(ci, e.target.value)}
                    style={{ ...cellInput, fontWeight: 700 }}
                  />
                  <button
                    type="button"
                    onClick={() => removeColumn(ci)}
                    disabled={columns.length <= 1}
                    aria-label={`Remove column ${ci + 1}`}
                    style={{
                      ...miniBtn,
                      marginTop: 3,
                      opacity: columns.length <= 1 ? 0.4 : 1,
                    }}
                  >
                    × col
                  </button>
                </th>
              ))}
              <th style={{ padding: 4, verticalAlign: 'top' }}>
                <button
                  type="button"
                  onClick={addColumn}
                  style={miniBtn}
                  aria-label="Add column"
                >
                  + col
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map((_, ci) => (
                  <td key={ci} style={{ padding: 4 }}>
                    <input
                      aria-label={`Cell ${ri + 1},${ci + 1}`}
                      value={row[ci] ?? ''}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      style={cellInput}
                    />
                  </td>
                ))}
                <td style={{ padding: 4 }}>
                  <button
                    type="button"
                    onClick={() => removeRow(ri)}
                    style={miniBtn}
                    aria-label={`Remove row ${ri + 1}`}
                  >
                    × row
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        style={{ ...miniBtn, marginTop: 8 }}
        aria-label="Add row"
      >
        + row
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision / tradeoff option editors (JSON-free structured sub-editors).
// ---------------------------------------------------------------------------

function DecisionOptionsEditor({
  options,
  onChange,
}: {
  options: DecisionBlock['options'];
  onChange: (o: DecisionBlock['options']) => void;
}) {
  const theme = useTheme();
  const set = (i: number, patch: Partial<DecisionBlock['options'][number]>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
        Options
      </div>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            padding: 8,
            marginBottom: 6,
          }}
        >
          <TextField
            label={`Option ${i + 1} label`}
            value={opt.label}
            onChange={(v) => set(i, { label: v })}
          />
          <ListField
            label="Pros"
            value={opt.pros ?? []}
            onChange={(v) => set(i, { pros: v })}
          />
          <ListField
            label="Cons"
            value={opt.cons ?? []}
            onChange={(v) => set(i, { cons: v })}
          />
          {options.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, idx) => idx !== i))}
              style={{
                fontSize: 11,
                padding: '2px 7px',
                border: `1px solid ${theme.borderStrong}`,
                borderRadius: 4,
                background: theme.surfaceMuted,
                color: theme.textDetail,
                cursor: 'pointer',
              }}
            >
              × remove option
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { label: `Option ${options.length + 1}` }])}
        style={{
          fontSize: 12,
          padding: '4px 10px',
          border: `1px solid ${theme.borderStrong}`,
          borderRadius: 6,
          background: theme.surfaceMuted,
          color: theme.textDetail,
          cursor: 'pointer',
        }}
      >
        + add option
      </button>
    </div>
  );
}

function TradeoffOptionsEditor({
  options,
  onChange,
}: {
  options: TradeoffBlock['options'];
  onChange: (o: TradeoffBlock['options']) => void;
}) {
  const theme = useTheme();
  const set = (i: number, patch: Partial<TradeoffBlock['options'][number]>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
        Options
      </div>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            padding: 8,
            marginBottom: 6,
          }}
        >
          <TextField
            label={`Option ${i + 1} label`}
            value={opt.label}
            onChange={(v) => set(i, { label: v })}
          />
          <TextField
            label="Score (number, optional)"
            value={opt.score === undefined ? '' : String(opt.score)}
            onChange={(v) => {
              const n = v.trim() === '' ? undefined : Number(v);
              set(i, { score: Number.isFinite(n as number) ? (n as number) : undefined });
            }}
          />
          <TextField
            label="Note (optional)"
            value={opt.note ?? ''}
            onChange={(v) => set(i, { note: v || undefined })}
          />
          {options.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, idx) => idx !== i))}
              style={{
                fontSize: 11,
                padding: '2px 7px',
                border: `1px solid ${theme.borderStrong}`,
                borderRadius: 4,
                background: theme.surfaceMuted,
                color: theme.textDetail,
                cursor: 'pointer',
              }}
            >
              × remove option
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { label: `Option ${options.length + 1}` }])}
        style={{
          fontSize: 12,
          padding: '4px 10px',
          border: `1px solid ${theme.borderStrong}`,
          borderRadius: 6,
          background: theme.surfaceMuted,
          color: theme.textDetail,
          cursor: 'pointer',
        }}
      >
        + add option
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind form. `draft` is a working copy; `set` patches it. The dispatcher
// returns the kind-appropriate field set. Every v2 PRD kind is covered.
// ---------------------------------------------------------------------------

function KindForm({
  draft,
  set,
}: {
  draft: Partial<Block> & { kind: BlockKind };
  set: (patch: Record<string, unknown>) => void;
}) {
  switch (draft.kind) {
    case 'section': {
      const b = draft as Partial<SectionBlock>;
      return (
        <>
          <TextField
            label="Title"
            value={b.title ?? ''}
            onChange={(v) => set({ title: v })}
          />
          <TextField
            label="Level (heading depth, integer)"
            value={String(b.level ?? 1)}
            onChange={(v) => set({ level: Math.max(1, Math.floor(Number(v) || 1)) })}
          />
        </>
      );
    }
    case 'prose': {
      const b = draft as Partial<ProseBlock>;
      return (
        <ProseEditor value={b.md ?? ''} onChange={(v) => set({ md: v })} />
      );
    }
    case 'objective': {
      const b = draft as Partial<ObjectiveBlock>;
      return (
        <>
          <TextField
            label="Objective text"
            value={b.text ?? ''}
            onChange={(v) => set({ text: v })}
          />
          <ListField
            label="Success criteria"
            value={b.successCriteria ?? []}
            onChange={(v) => set({ successCriteria: v })}
          />
        </>
      );
    }
    case 'task': {
      const b = draft as Partial<TaskBlock>;
      return (
        <>
          <TextField
            label="Title"
            value={b.title ?? ''}
            onChange={(v) => set({ title: v })}
          />
          <SelectField
            label="Status"
            value={(b.status ?? 'todo') as TaskStatus}
            options={TASK_STATUSES}
            onChange={(v) => set({ status: v })}
          />
          <AreaField
            label="Detail"
            value={b.detail ?? ''}
            onChange={(v) => set({ detail: v || undefined })}
            rows={3}
          />
          <ListField
            label="Dependencies (block ids)"
            value={b.deps ?? []}
            onChange={(v) => set({ deps: v })}
          />
          <ListField
            label="Acceptance"
            value={b.acceptance ?? []}
            onChange={(v) => set({ acceptance: v })}
          />
          <TextField
            label="Estimate (optional)"
            value={b.estimate ?? ''}
            onChange={(v) => set({ estimate: v || undefined })}
          />
        </>
      );
    }
    case 'decision': {
      const b = draft as Partial<DecisionBlock>;
      return (
        <>
          <TextField
            label="Question"
            value={b.question ?? ''}
            onChange={(v) => set({ question: v })}
          />
          <DecisionOptionsEditor
            options={b.options ?? []}
            onChange={(o) => set({ options: o })}
          />
          <TextField
            label="Chosen (option label, optional)"
            value={b.chosen ?? ''}
            onChange={(v) => set({ chosen: v || undefined })}
          />
          <AreaField
            label="Rationale (optional)"
            value={b.rationale ?? ''}
            onChange={(v) => set({ rationale: v || undefined })}
            rows={3}
          />
        </>
      );
    }
    case 'risk': {
      const b = draft as Partial<RiskBlock>;
      return (
        <>
          <TextField
            label="Description"
            value={b.description ?? ''}
            onChange={(v) => set({ description: v })}
          />
          <SelectField
            label="Likelihood"
            value={(b.likelihood ?? 'M') as 'L' | 'M' | 'H'}
            options={LMH_VALUES}
            onChange={(v) => set({ likelihood: v })}
          />
          <SelectField
            label="Impact"
            value={(b.impact ?? 'M') as 'L' | 'M' | 'H'}
            options={LMH_VALUES}
            onChange={(v) => set({ impact: v })}
          />
          <AreaField
            label="Mitigation"
            value={b.mitigation ?? ''}
            onChange={(v) => set({ mitigation: v })}
            rows={3}
          />
        </>
      );
    }
    case 'openQuestion': {
      const b = draft as Partial<OpenQuestionBlock>;
      return (
        <>
          <TextField
            label="Question"
            value={b.question ?? ''}
            onChange={(v) => set({ question: v })}
          />
          <AreaField
            label="Answer (optional)"
            value={b.answer ?? ''}
            onChange={(v) => set({ answer: v || undefined })}
            rows={3}
          />
        </>
      );
    }
    case 'phase': {
      const b = draft as Partial<PhaseBlock>;
      return (
        <>
          <TextField
            label="Title"
            value={b.title ?? ''}
            onChange={(v) => set({ title: v })}
          />
          <ListField
            label="Task ids"
            value={b.taskIds ?? []}
            onChange={(v) => set({ taskIds: v })}
          />
        </>
      );
    }
    case 'tradeoff': {
      const b = draft as Partial<TradeoffBlock>;
      return (
        <>
          <TextField
            label="Axis"
            value={b.axis ?? ''}
            onChange={(v) => set({ axis: v })}
          />
          <TradeoffOptionsEditor
            options={b.options ?? []}
            onChange={(o) => set({ options: o })}
          />
        </>
      );
    }
    case 'fileChange': {
      const b = draft as Partial<FileChangeBlock>;
      return (
        <>
          <TextField
            label="Path"
            value={b.path ?? ''}
            onChange={(v) => set({ path: v })}
          />
          <SelectField
            label="Action"
            value={(b.action ?? 'modify') as 'add' | 'modify' | 'delete'}
            options={FILE_ACTIONS}
            onChange={(v) => set({ action: v })}
          />
          <AreaField
            label="Rationale"
            value={b.rationale ?? ''}
            onChange={(v) => set({ rationale: v })}
            rows={3}
          />
        </>
      );
    }
    case 'code': {
      const b = draft as Partial<CodeBlock>;
      return (
        <>
          <TextField
            label="Language"
            value={b.lang ?? ''}
            onChange={(v) => set({ lang: v })}
          />
          <TextField
            label="Filename (optional)"
            value={b.filename ?? ''}
            onChange={(v) => set({ filename: v || undefined })}
          />
          <AreaField
            label="Content"
            value={b.content ?? ''}
            onChange={(v) => set({ content: v })}
            rows={8}
            mono
          />
        </>
      );
    }
    case 'table': {
      const b = draft as Partial<TableBlock>;
      return (
        <TableEditor
          columns={b.columns ?? ['Column 1']}
          rows={b.rows ?? [['']]}
          onChange={(next) => set(next)}
        />
      );
    }
    case 'diagram': {
      const b = draft as Partial<DiagramBlock>;
      return (
        <DiagramEditor
          value={b.mermaid ?? ''}
          onChange={(v) => set({ mermaid: v })}
        />
      );
    }
    default:
      // All 13 BlockKind cases are handled above; this arm is unreachable for
      // a well-typed draft. Render nothing rather than asserting `never` (the
      // intersection-typed `draft` defeats TS switch-exhaustiveness narrowing).
      return null;
  }
}

// ---------------------------------------------------------------------------
// The modal shell — one hand-rolled overlay reused for EDIT and ADD.
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  theme,
  onClose,
  children,
  footer,
}: {
  title: string;
  theme: ThemeTokens;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          width: 'min(640px, 100%)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: 18,
              lineHeight: 1,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.textMuted,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>{children}</div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            padding: '12px 16px',
            borderTop: `1px solid ${theme.border}`,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

function primaryBtn(theme: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 14,
    padding: '7px 16px',
    background: theme.accent,
    color: theme.onAccent,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
  };
}
function ghostBtn(theme: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 14,
    padding: '7px 16px',
    background: theme.surfaceMuted,
    color: theme.textDetail,
    border: `1px solid ${theme.borderStrong}`,
    borderRadius: 6,
    cursor: 'pointer',
  };
}

/**
 * EDIT modal — opens on an existing block, edits a draft copy, emits the FULL
 * next-state of the block as a patch on Save (deriveWorkingDoc shallow-merges
 * it; id/kind are preserved). Cancel discards.
 */
export function BlockEditModal({
  block,
  onSave,
  onClose,
}: {
  block: Block;
  onSave: (patch: Partial<Block>) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<Partial<Block> & { kind: BlockKind }>({
    ...block,
  });
  const set = (patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, ...patch }));

  return (
    <ModalShell
      title={`Edit ${block.kind} · ${block.id}`}
      theme={theme}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn(theme)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              // Emit only the mutated fields (never id/kind) so the
              // fold-back stays a minimal id-stable patch.
              const { id: _id, kind: _kind, ...rest } = draft;
              onSave(rest as Partial<Block>);
              onClose();
            }}
            style={primaryBtn(theme)}
          >
            Save
          </button>
        </>
      }
    >
      <KindForm draft={draft} set={set} />
    </ModalShell>
  );
}

/**
 * ADD modal — pick a kind, fill the (schema-valid-seeded) form, choose where
 * to insert it. On Add emits `{ afterId, block }` for App's `adds` state.
 */
export function BlockAddModal({
  afterId,
  positionLabel,
  onAdd,
  onClose,
}: {
  /** Insert AFTER this id (null = at the top). */
  afterId: string | null;
  /** Human label for where it lands (e.g. 'after “Overview”'). */
  positionLabel: string;
  onAdd: (afterId: string | null, block: Partial<Block> & { kind: BlockKind }) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [kind, setKind] = useState<BlockKind>('prose');
  const seeded = useMemo(() => emptyBlock(kind), [kind]);
  const [draft, setDraft] = useState<Partial<Block> & { kind: BlockKind }>(seeded);

  // Re-seed the draft whenever the kind changes.
  useEffect(() => {
    setDraft(emptyBlock(kind));
  }, [kind]);

  const set = (patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, ...patch }));

  return (
    <ModalShell
      title={`Add block ${positionLabel}`}
      theme={theme}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn(theme)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onAdd(afterId, draft);
              onClose();
            }}
            style={primaryBtn(theme)}
          >
            Add block
          </button>
        </>
      }
    >
      <SelectField
        label="Block kind"
        value={kind}
        options={ALL_KINDS}
        onChange={(v) => setKind(v)}
      />
      <div
        style={{
          borderTop: `1px solid ${theme.border}`,
          marginTop: 4,
          paddingTop: 12,
        }}
      >
        <KindForm draft={draft} set={set} />
      </div>
    </ModalShell>
  );
}
