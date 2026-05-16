/**
 * planos plan-review SPA root.
 *
 * Owns: document load (injectable loader), local interaction state
 * (task edits / answers / per-block comments / global comment), the decision
 * bar, and — as of US-017 / Step 3.2 — FeedbackEnvelope emission. On a
 * decision it builds the design.md §4 envelope and hands it to an injectable
 * transport (default = POST via fetch; tests inject a capture fn). The legacy
 * `onApprove` / `onRevise` callbacks still fire (post-build) for observers.
 */
import { useEffect, useMemo, useState } from 'react';
import { BlockRenderer } from './blocks';
import { HistoryBrowser } from './history';
import {
  type EnvelopeTransport,
  emitEnvelope,
  fetchTransport,
} from './envelope';
import { loadDocument } from './loader';
import { ThemeProvider, useTheme, useThemeControl } from './theme';
import {
  type EditorCallbacks,
  type EditorState,
  type HunkReview,
  type PlanDocument,
  type TaskBlock,
} from './types';

interface AppProps extends EditorCallbacks {
  /** Injectable envelope transport — defaults to POST via fetch. */
  transport?: EnvelopeTransport;
}

export default function App(props: AppProps) {
  return (
    <ThemeProvider>
      <AppInner {...props} />
    </ThemeProvider>
  );
}

function ThemeToggle() {
  const { name, toggle } = useThemeControl();
  const theme = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      style={{
        marginLeft: 'auto',
        fontSize: 12,
        color: theme.headerMuted,
        background: 'none',
        border: `1px solid ${theme.headerMuted}`,
        borderRadius: 6,
        padding: '3px 9px',
        cursor: 'pointer',
      }}
    >
      {name === 'light' ? '🌙 dark' : '☀ light'}
    </button>
  );
}

function AppInner({
  onApprove,
  onRevise,
  transport = fetchTransport,
}: AppProps) {
  const theme = useTheme();
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [decision, setDecision] = useState<'idle' | 'approve' | 'revise'>(
    'idle'
  );

  const [edits, setEdits] = useState<Record<string, Partial<TaskBlock>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reviewVerdicts, setReviewVerdicts] = useState<
    Record<string, Record<string, HunkReview>>
  >({});
  const [globalComment, setGlobalComment] = useState('');

  useEffect(() => {
    let alive = true;
    loadDocument().then((d) => {
      if (alive) setDoc(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  const byId = useMemo(
    () =>
      doc
        ? Object.fromEntries(doc.blocks.map((b) => [b.id, b]))
        : {},
    [doc]
  );

  const state: EditorState = useMemo(
    () => ({
      edits,
      comments: Object.fromEntries(
        Object.entries(comments).filter(([, v]) => v.trim().length > 0)
      ),
      answers: Object.fromEntries(
        Object.entries(answers).filter(([, v]) => v.trim().length > 0)
      ),
      reviewVerdicts: Object.fromEntries(
        Object.entries(reviewVerdicts)
          .map(
            ([bid, hunks]) =>
              [
                bid,
                Object.fromEntries(
                  Object.entries(hunks).filter(
                    ([, r]) =>
                      r.verdict !== 'comment' || r.text.trim().length > 0
                  )
                ),
              ] as const
          )
          .filter(([, hunks]) => Object.keys(hunks).length > 0)
      ),
      globalComment: globalComment.trim() || undefined,
    }),
    [edits, comments, answers, reviewVerdicts, globalComment]
  );

  function handleApprove() {
    setDecision('approve');
    if (doc) {
      emitEnvelope('approve', doc, state, transport);
      onApprove?.(state, doc);
    }
  }

  function handleRevise() {
    setDecision('revise');
    if (doc) {
      emitEnvelope('revise', doc, state, transport);
      onRevise?.(state, doc);
    }
  }

  const shell: React.CSSProperties = {
    minHeight: '100vh',
    background: theme.bg,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: theme.text,
  };

  if (!doc) {
    return (
      <div style={{ ...shell, display: 'grid', placeItems: 'center' }}>
        <span style={{ color: theme.textMuted }}>Loading plan…</span>
      </div>
    );
  }

  return (
    <div style={shell}>
      <header
        style={{
          background: theme.headerBg,
          color: theme.headerText,
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          planos
        </strong>
        <span style={{ color: theme.headerMuted, fontSize: 13 }}>
          Plan Review
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: theme.headerMuted,
          }}
        >
          rev {doc.meta.revision} · {doc.meta.status}
        </span>
        <ThemeToggle />
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '28px 16px' }}>
        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            padding: 24,
            marginBottom: 20,
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              margin: '0 0 4px',
            }}
          >
            {doc.title}
          </h1>
          <p style={{ fontSize: 13, color: theme.textMuted, margin: '0 0 20px' }}>
            {doc.blocks.length} blocks · document {doc.id}
            {doc.meta.degraded && ' · ⚠ this plan was not structured'}
          </p>

          {doc.blocks.map((block) => (
            <BlockRenderer
              key={block.id}
              block={block}
              byId={byId}
              comment={comments[block.id] ?? ''}
              taskPatch={edits[block.id] ?? {}}
              answer={answers[block.id] ?? ''}
              onComment={(text) =>
                setComments((c) => ({ ...c, [block.id]: text }))
              }
              onTaskPatch={(p) =>
                setEdits((e) => ({ ...e, [block.id]: p }))
              }
              onAnswer={(text) =>
                setAnswers((a) => ({ ...a, [block.id]: text }))
              }
              hunkReview={reviewVerdicts[block.id] ?? {}}
              onHunkReview={(hunkId, next) =>
                setReviewVerdicts((rv) => ({
                  ...rv,
                  [block.id]: { ...(rv[block.id] ?? {}), [hunkId]: next },
                }))
              }
            />
          ))}
        </div>

        <HistoryBrowser />

        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <label style={{ fontSize: 12, color: theme.textMuted }}>
            Overall comment (optional)
            <textarea
              aria-label="Global comment"
              value={globalComment}
              onChange={(e) => setGlobalComment(e.target.value)}
              placeholder="Anything for the agent that isn't tied to one block…"
              rows={2}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '8px 10px',
                border: `1px solid ${theme.borderStrong}`,
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </label>
        </div>

        {decision === 'idle' ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={handleApprove}
              style={{
                flex: 1,
                padding: 13,
                background: theme.accentApprove,
                color: theme.onAccent,
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={handleRevise}
              style={{
                flex: 1,
                padding: 13,
                background: theme.accentRevise,
                color: theme.onAccent,
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Request Revision
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              background:
                decision === 'approve'
                  ? theme.statusDoneBg
                  : theme.statusCutBg,
              border: `1px solid ${
                decision === 'approve'
                  ? theme.bannerApproveBorder
                  : theme.bannerReviseBorder
              }`,
              borderRadius: 8,
              textAlign: 'center',
              fontWeight: 700,
              color:
                decision === 'approve'
                  ? theme.statusDoneFg
                  : theme.statusCutFg,
            }}
          >
            {decision === 'approve'
              ? 'Plan approved — decision captured.'
              : 'Revision requested — feedback captured.'}
          </div>
        )}
      </main>
    </div>
  );
}
