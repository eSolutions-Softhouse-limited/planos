/**
 * Type sidecar for the zero-dependency pure model `workingDoc.impl.mjs`.
 *
 * The implementation is plain JS so the Node test harness can import it with
 * no toolchain; this declaration gives the TS call sites (`workingDoc.ts` /
 * App.tsx) a precise signature. Kept in lockstep with the M3 working-doc model.
 */
import { type EditorState, type PlanDocument } from './types';

export function deriveWorkingDoc(
  baseDoc: PlanDocument,
  editorState?: Pick<EditorState, 'edits' | 'answers' | 'deletes' | 'adds'>
): PlanDocument;

/**
 * Deterministically mint a stable, collision-free `b<n>` id for a new block,
 * seeded past every existing id (never renumbers an existing block).
 */
export function mintAddedBlockId(
  existingIds: Iterable<string>,
  ordinal?: number
): string;
