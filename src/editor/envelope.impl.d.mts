/**
 * Type sidecar for the zero-dependency pure builder `envelope.impl.mjs`.
 *
 * The implementation is plain JS so the Node test harness can import it with
 * no toolchain; this declaration gives the TS call sites (`envelope.ts`) a
 * precise signature. Kept in lockstep with docs/design.md §4.
 */
import { type EditorDecision, type EditorState, type PlanDocument } from './types';
import { type FeedbackEnvelope } from './envelope';

export function buildEnvelope(
  decision: EditorDecision,
  doc: PlanDocument,
  editorState: EditorState
): FeedbackEnvelope;
