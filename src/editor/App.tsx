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
import { BlockAddModal, BlockEditModal } from './blockEdit';
import { HistoryBrowser } from './history';
import {
  type EnvelopeTransport,
  emitEnvelope,
  fetchTransport,
} from './envelope';
import { ExportControls, PrintStyles, SCREEN_ONLY_ATTR } from './export';
import { loadDocument } from './loader';
import { deriveWorkingDoc, mintAddedBlockId } from './workingDoc';
import { ThemeProvider, useTheme, useThemeControl } from './theme';
import {
  type Block,
  type BlockAdd,
  type EditorCallbacks,
  type EditorState,
  type PlanDocument,
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

/** A thin "+ add block here" insertion affordance between blocks. */
function AddHere({
  label,
  onClick,
  ...rest
}: {
  label: string;
  onClick: () => void;
} & Record<string, unknown>) {
  const theme = useTheme();
  return (
    <div
      {...rest}
      style={{
        display: 'flex',
        justifyContent: 'center',
        margin: '4px 0',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Add block ${label}`}
        style={{
          fontSize: 12,
          color: theme.textMuted,
          background: theme.surfaceMuted,
          border: `1px dashed ${theme.borderStrong}`,
          borderRadius: 6,
          padding: '3px 12px',
          cursor: 'pointer',
        }}
      >
        + add block {label}
      </button>
    </div>
  );
}

function AppInner({
  onApprove,
  onRevise,
  transport = fetchTransport,
}: AppProps) {
  const theme = useTheme();
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  // 'sending' = the decision was chosen and the envelope is in flight; the
  // terminal 'approve'/'revise' state is only entered AFTER the transport
  // resolves (M2 Defect 2 — no false "captured" before delivery). 'error' =
  // delivery genuinely failed; the reviewer can retry.
  const [decision, setDecision] = useState<
    'idle' | 'sending' | 'approve' | 'revise' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [edits, setEdits] = useState<Record<string, Partial<Block>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [globalComment, setGlobalComment] = useState('');
  // M4: structural edits — deleted block ids + ordered block adds. Both fold
  // back through the single deriveWorkingDoc seam (id-stable; no renumber).
  const [deletes, setDeletes] = useState<string[]>([]);
  const [adds, setAdds] = useState<BlockAdd[]>([]);
  // M5: the reviewer's desired block sequence. Folds back through the SAME
  // single deriveWorkingDoc seam as a pure permutation (id-stable, no
  // mint/renumber, no add/drop). Empty = original order (byte no-op).
  const [order, setOrder] = useState<string[]>([]);
  // The block id currently being dragged (native HTML5 DnD), and the id we'd
  // drop BEFORE — drives the visual drop indicator. Both screen-only state.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  // Which block the edit modal is open on, and the add-modal anchor (afterId
  // === undefined means closed; null means "add at the top").
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingAfter, setAddingAfter] = useState<
    { afterId: string | null; label: string } | undefined
  >(undefined);

  useEffect(() => {
    let alive = true;
    loadDocument().then((d) => {
      if (alive) setDoc(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  // M4: derive `byId` (used by phase to resolve task titles) from the WORKING
  // doc so freshly edited/added titles resolve live. Filled in after
  // workingDoc is computed below; declared via a function to keep ordering.

  // M3: the single mutable WORKING COPY of the document. It is derived purely
  // from the loaded base doc + the reviewer's existing edit affordances (task
  // field patches + openQuestion answers). This is what Approve persists; the
  // comment/globalComment envelope stays advisory (M2). M4/M5 add their richer
  // edit/reorder mappings inside deriveWorkingDoc — App keeps this one seam.
  const workingDoc = useMemo(
    () =>
      doc
        ? deriveWorkingDoc(doc, { edits, answers, deletes, adds, order })
        : null,
    [doc, edits, answers, deletes, adds, order]
  );

  // byId over the WORKING doc so phase task-title resolution sees live edits.
  const byId = useMemo(
    () =>
      workingDoc
        ? Object.fromEntries(workingDoc.blocks.map((b) => [b.id, b]))
        : {},
    [workingDoc]
  );

  // The blocks the SPA renders — the WORKING doc's blocks (M3 flagged the
  // renderer must switch off the immutable base; this is that switch).
  const renderBlocks: Block[] = workingDoc ? workingDoc.blocks : [];

  // The block currently open in the edit modal (resolved against workingDoc so
  // the modal seeds from the reviewer's in-progress edits, not the stale base).
  const editingBlock: Block | null = useMemo(
    () =>
      workingDoc && editingId
        ? (workingDoc.blocks.find((b) => b.id === editingId) ?? null)
        : null,
    [workingDoc, editingId]
  );

  // Save an edit-modal patch. The block may be a BASE block (→ `edits`) or a
  // reviewer-ADDED block (→ patch the matching entry in `adds` so its id stays
  // stable and the single fold-back site still sees the final block).
  function saveEdit(blockId: string, patch: Partial<Block>) {
    const addIdx = adds.findIndex((a) => a.block.id === blockId);
    if (addIdx >= 0) {
      setAdds((prev) =>
        prev.map((a, i) =>
          i === addIdx ? { ...a, block: { ...a.block, ...patch } } : a
        )
      );
    } else {
      setEdits((e) => ({ ...e, [blockId]: { ...(e[blockId] ?? {}), ...patch } }));
    }
  }

  // Delete a block. A reviewer-added block is removed from `adds` (it never
  // existed in the base); a base block id goes into `deletes` (id-stable —
  // deriveWorkingDoc drops only that id, nothing renumbers).
  function deleteBlock(blockId: string) {
    const addIdx = adds.findIndex((a) => a.block.id === blockId);
    if (addIdx >= 0) {
      setAdds((prev) => prev.filter((_, i) => i !== addIdx));
    } else {
      setDeletes((d) => (d.includes(blockId) ? d : [...d, blockId]));
    }
  }

  // M5: commit a reorder. We always recompute a FULL order array from the
  // CURRENT rendered sequence (renderBlocks already reflects edits/adds/
  // deletes/prior reorder), move `id` to land before `beforeId` (or to the
  // end when beforeId === null), and store that as the new `order`. This keeps
  // `order` a complete, self-consistent permutation of the live working ids
  // every time — deriveWorkingDoc then applies it as a pure permutation.
  function reorderTo(id: string, beforeId: string | null) {
    const ids = renderBlocks.map((b) => b.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const without = ids.filter((x) => x !== id);
    let insertAt =
      beforeId === null ? without.length : without.indexOf(beforeId);
    if (insertAt < 0) insertAt = without.length;
    without.splice(insertAt, 0, id);
    // No-op guard: identical sequence → don't dirty `order` (keeps the
    // edit-free path a byte no-op so the PRD store still skips a revision).
    const changed = without.some((x, i) => x !== ids[i]);
    if (changed) setOrder(without);
  }

  // Keyboard a11y equivalent of drag — move a block one slot up/down. Shipping
  // this alongside native DnD so reorder is not drag-only (M5 requirement).
  function moveBlockBy(id: string, delta: -1 | 1) {
    const ids = renderBlocks.map((b) => b.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    const target = i + delta;
    if (target < 0 || target >= ids.length) return;
    // Move BEFORE the neighbour we're swapping past (delta>0 → before the
    // block after the neighbour, i.e. land where the neighbour was).
    if (delta < 0) {
      reorderTo(id, ids[target]);
    } else {
      const beforeId = target + 1 < ids.length ? ids[target + 1] : null;
      reorderTo(id, beforeId);
    }
  }

  const state: EditorState = useMemo(
    () => ({
      edits,
      comments: Object.fromEntries(
        Object.entries(comments).filter(([, v]) => v.trim().length > 0)
      ),
      answers: Object.fromEntries(
        Object.entries(answers).filter(([, v]) => v.trim().length > 0)
      ),
      deletes: deletes.length > 0 ? deletes : undefined,
      adds: adds.length > 0 ? adds : undefined,
      order: order.length > 0 ? order : undefined,
      globalComment: globalComment.trim() || undefined,
      // Carried on approve only (envelope.impl.mjs gates on decision).
      editedDocument: workingDoc ?? undefined,
    }),
    [edits, comments, answers, deletes, adds, order, globalComment, workingDoc]
  );

  // M2 Defect 2: await the transport BEFORE flipping the UI to the terminal
  // captured state. The decision is only "captured" once the server has
  // actually received the envelope; a delivery failure surfaces a real error
  // state (with retry) instead of a false confirmation.
  async function submit(kind: 'approve' | 'revise') {
    if (!doc || decision === 'sending') return;
    setErrorMsg('');
    setDecision('sending');
    try {
      await emitEnvelope(kind, doc, state, transport);
      setDecision(kind);
      if (kind === 'approve') onApprove?.(state, doc);
      else onRevise?.(state, doc);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to deliver the decision.'
      );
      setDecision('error');
    }
  }

  function handleApprove() {
    void submit('approve');
  }

  function handleRevise() {
    void submit('revise');
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
      <PrintStyles />
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
        <span
          {...{ [SCREEN_ONLY_ATTR]: '' }}
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ExportControls doc={doc} />
          <ThemeToggle />
        </span>
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
            {renderBlocks.length} blocks · document {doc.id}
            {doc.meta.degraded && ' · ⚠ this plan was not structured'}
          </p>

          {/* M4: render from the WORKING doc so edits/adds/deletes are live. */}
          <AddHere
            {...{ [SCREEN_ONLY_ATTR]: '' }}
            label="at the top"
            onClick={() =>
              setAddingAfter({ afterId: null, label: 'at the top' })
            }
          />
          {renderBlocks.map((block, idx) => (
            <div
              key={block.id}
              onDragOver={(e) => {
                // Only react while an App-level block drag is active. This is
                // the OUTER block layer; TipTap's own ProseMirror DnD lives
                // inside BlockRenderer and never sets dragId, so its internal
                // drag/selection is left fully isolated.
                if (dragId === null || dragId === block.id) return;
                e.preventDefault();
                if (dropBeforeId !== block.id) setDropBeforeId(block.id);
              }}
              onDrop={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                if (dragId !== block.id) reorderTo(dragId, block.id);
                setDragId(null);
                setDropBeforeId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropBeforeId(null);
              }}
            >
              {/* Visual drop indicator — a thin accent rule the dragged block
                  would land before. */}
              <div
                {...{ [SCREEN_ONLY_ATTR]: '' }}
                aria-hidden="true"
                style={{
                  height: 2,
                  margin: '2px 0',
                  borderRadius: 2,
                  background:
                    dragId !== null &&
                    dropBeforeId === block.id &&
                    dragId !== block.id
                      ? theme.accent
                      : 'transparent',
                }}
              />
              <div style={{ position: 'relative' }}>
                <div
                  {...{ [SCREEN_ONLY_ATTR]: '' }}
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                    marginBottom: -6,
                  }}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      setDragId(block.id);
                      e.dataTransfer.effectAllowed = 'move';
                      // Required by Firefox to start a native drag.
                      e.dataTransfer.setData('text/plain', block.id);
                    }}
                    aria-label={`Drag to reorder block ${block.id} (position ${
                      idx + 1
                    } of ${renderBlocks.length})`}
                    title="Drag to reorder"
                    style={{
                      fontSize: 12,
                      color: theme.textMuted,
                      background: theme.surfaceMuted,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: '2px 9px',
                      cursor: 'grab',
                      userSelect: 'none',
                      marginRight: 'auto',
                    }}
                  >
                    ⠿ drag
                  </span>
                  <button
                    type="button"
                    onClick={() => moveBlockBy(block.id, -1)}
                    disabled={idx === 0}
                    aria-label={`Move block ${block.id} up`}
                    style={{
                      fontSize: 12,
                      color: idx === 0 ? theme.textMuted : theme.accent,
                      background: 'none',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: '2px 9px',
                      cursor: idx === 0 ? 'not-allowed' : 'pointer',
                      opacity: idx === 0 ? 0.5 : 1,
                    }}
                  >
                    ↑ up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlockBy(block.id, 1)}
                    disabled={idx === renderBlocks.length - 1}
                    aria-label={`Move block ${block.id} down`}
                    style={{
                      fontSize: 12,
                      color:
                        idx === renderBlocks.length - 1
                          ? theme.textMuted
                          : theme.accent,
                      background: 'none',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: '2px 9px',
                      cursor:
                        idx === renderBlocks.length - 1
                          ? 'not-allowed'
                          : 'pointer',
                      opacity: idx === renderBlocks.length - 1 ? 0.5 : 1,
                    }}
                  >
                    ↓ down
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(block.id)}
                    aria-label={`Edit block ${block.id}`}
                    style={{
                      fontSize: 12,
                      color: theme.accent,
                      background: 'none',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: '2px 9px',
                      cursor: 'pointer',
                    }}
                  >
                    ✎ edit block
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteBlock(block.id)}
                    aria-label={`Delete block ${block.id}`}
                    style={{
                      fontSize: 12,
                      color: theme.statusCutFg,
                      background: 'none',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: '2px 9px',
                      cursor: 'pointer',
                    }}
                  >
                    🗑 delete
                  </button>
                </div>
                <BlockRenderer
                  block={block}
                  byId={byId}
                  comment={comments[block.id] ?? ''}
                  taskPatch={edits[block.id] ?? {}}
                  answer={answers[block.id] ?? ''}
                  onComment={(text) =>
                    setComments((c) => ({ ...c, [block.id]: text }))
                  }
                  onTaskPatch={(p) => saveEdit(block.id, p)}
                  onAnswer={(text) =>
                    setAnswers((a) => ({ ...a, [block.id]: text }))
                  }
                />
              </div>
              <AddHere
                {...{ [SCREEN_ONLY_ATTR]: '' }}
                label={`after ${block.id}`}
                onClick={() =>
                  setAddingAfter({
                    afterId: block.id,
                    label: `after ${block.id}`,
                  })
                }
              />
            </div>
          ))}
        </div>

        {editingBlock && (
          <BlockEditModal
            block={editingBlock}
            onSave={(patch) => saveEdit(editingBlock.id, patch)}
            onClose={() => setEditingId(null)}
          />
        )}
        {addingAfter && (
          <BlockAddModal
            afterId={addingAfter.afterId}
            positionLabel={addingAfter.label}
            onAdd={(afterId, block) => {
              const liveIds = new Set(
                (workingDoc?.blocks ?? []).map((b) => b.id)
              );
              const id = mintAddedBlockId(liveIds);
              setAdds((prev) => [
                ...prev,
                { afterId, block: { ...block, id } },
              ]);
            }}
            onClose={() => setAddingAfter(undefined)}
          />
        )}

        <div {...{ [SCREEN_ONLY_ATTR]: '' }}>
          <HistoryBrowser />
        </div>

        <div
          {...{ [SCREEN_ONLY_ATTR]: '' }}
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

        <div {...{ [SCREEN_ONLY_ATTR]: '' }}>
        {decision === 'idle' ||
        decision === 'sending' ||
        decision === 'error' ? (
          <>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={handleApprove}
                disabled={decision === 'sending'}
                style={{
                  flex: 1,
                  padding: 13,
                  background: theme.accentApprove,
                  color: theme.onAccent,
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: decision === 'sending' ? 'progress' : 'pointer',
                  opacity: decision === 'sending' ? 0.6 : 1,
                }}
              >
                {decision === 'sending' ? 'Sending…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={handleRevise}
                disabled={decision === 'sending'}
                style={{
                  flex: 1,
                  padding: 13,
                  background: theme.accentRevise,
                  color: theme.onAccent,
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: decision === 'sending' ? 'progress' : 'pointer',
                  opacity: decision === 'sending' ? 0.6 : 1,
                }}
              >
                {decision === 'sending' ? 'Sending…' : 'Request Revision'}
              </button>
            </div>
            {decision === 'error' && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: theme.statusCutBg,
                  border: `1px solid ${theme.bannerReviseBorder}`,
                  borderRadius: 8,
                  color: theme.statusCutFg,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Could not deliver the decision — it was NOT captured. Please
                retry. ({errorMsg})
              </div>
            )}
          </>
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
        </div>
      </main>
    </div>
  );
}
