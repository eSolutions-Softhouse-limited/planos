/**
 * planos editor — typed FeedbackEnvelope surface (US-017 / Step 3.2, AC-9).
 *
 * The actual construction logic lives in the zero-dependency, zero-toolchain
 * `envelope.mjs` so the test harness can import it with plain Node. This file
 * is the *typed* face for the React call sites and the injectable transport
 * seam that keeps the SPA offline-testable (default = `fetch`, tests inject a
 * capture fn).
 *
 * The emitted shape is exact to docs/design.md §4 and round-trips through the
 * server-side `validateEnvelope` (src/schema/envelope.mjs) without loss.
 */
import { buildEnvelope as buildEnvelopeImpl } from './envelope.impl.mjs';
import {
  type Block,
  type EditorDecision,
  type EditorState,
  type PlanDocument,
} from './types';

/** A single block-addressed structured edit (docs/design.md §4 `Edit` union). */
export type Edit =
  | { op: 'editBlock'; blockId: string; patch: Partial<Block> }
  | { op: 'deleteBlock'; blockId: string }
  | { op: 'moveBlock'; blockId: string; afterBlockId: string | null }
  | {
      op: 'comment';
      blockId: string;
      text: string;
      anchor?: { start: number; end: number };
    }
  | { op: 'answer'; blockId: string; answer: string }
  | { op: 'addBlock'; afterBlockId: string | null; block: Block };

/** The browser → agent envelope (docs/design.md §4). */
export interface FeedbackEnvelope {
  decision: EditorDecision;
  documentId: string;
  baseRevision: number;
  ops: Edit[];
  globalComment?: string;
}

/**
 * Build a structurally valid `FeedbackEnvelope` from the editor's accumulated
 * interaction state. Pure — see `envelope.mjs` for the implementation.
 */
export function buildEnvelope(
  decision: EditorDecision,
  doc: PlanDocument,
  editorState: EditorState
): FeedbackEnvelope {
  return buildEnvelopeImpl(
    decision,
    doc,
    editorState
  ) as unknown as FeedbackEnvelope;
}

/**
 * Transport seam: given a decision + envelope, deliver it. The default uses
 * `fetch` (approve → `/api/approve`, revise → `/api/deny`); tests inject a
 * capture fn so the whole emit path runs with no network.
 */
export type EnvelopeTransport = (
  decision: EditorDecision,
  envelope: FeedbackEnvelope
) => void | Promise<void>;

/** Approve and revise route to distinct server endpoints (design.md §4). */
export const ENVELOPE_ENDPOINTS: Record<EditorDecision, string> = {
  approve: '/api/approve',
  revise: '/api/deny',
};

/** The default production transport — POSTs the envelope as JSON. */
export const fetchTransport: EnvelopeTransport = async (decision, envelope) => {
  const url = ENVELOPE_ENDPOINTS[decision];
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  } catch {
    // Offline / no server — the decision is still captured in the UI; the
    // envelope is logged for the manual smoke. Never throw from the seam.
    console.info('[planos] envelope (offline)', { decision, envelope });
  }
};

/**
 * Build the envelope for `decision` and hand it to `transport`. This is the
 * single function the React layer calls; the transport is injected so the
 * emit path is exercised offline in tests.
 */
export function emitEnvelope(
  decision: EditorDecision,
  doc: PlanDocument,
  editorState: EditorState,
  transport: EnvelopeTransport = fetchTransport
): FeedbackEnvelope {
  const envelope = buildEnvelope(decision, doc, editorState);
  void transport(decision, envelope);
  return envelope;
}
