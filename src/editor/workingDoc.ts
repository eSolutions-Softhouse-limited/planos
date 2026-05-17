/**
 * planos editor — typed face for the pure working-document model (M3).
 *
 * The construction logic lives in the zero-dependency, zero-toolchain
 * `workingDoc.impl.mjs` so the Node test harness can import it with plain Node.
 * This file is the typed face for the React call sites (App.tsx).
 *
 * M3: the SPA maintains a single mutable working copy of the document. This is
 * the one place editor interaction state is folded back into a Document; M4
 * (rich edit modals / table / diagram / prose) and M5 (drag-drop reorder) add
 * their mappings HERE with no schema or transport change.
 */
import { deriveWorkingDoc as deriveWorkingDocImpl } from './workingDoc.impl.mjs';
import { type EditorState, type PlanDocument } from './types';

/**
 * Derive the reviewer's working document from the base document + the
 * accumulated editor interaction state. Pure — see `workingDoc.impl.mjs`.
 */
export function deriveWorkingDoc(
  baseDoc: PlanDocument,
  editorState?: Pick<EditorState, 'edits' | 'answers'>
): PlanDocument {
  return deriveWorkingDocImpl(
    baseDoc,
    editorState
  ) as unknown as PlanDocument;
}
