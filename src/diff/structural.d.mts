/**
 * Type sidecar for the zero-dependency pure structural diff engine
 * `structural.mjs` (Phase 1, design.md §7, AC-14).
 *
 * The implementation is plain JS so the Node test harness imports it with no
 * toolchain; this declaration gives the SPA history browser (Phase 2 / P4 /
 * D2 — src/editor/history.tsx) a precise signature for `diffDocuments`.
 *
 * SPA-side typing ONLY: the diff engine is already in the AC-17-clean root
 * set; the SPA importing it is allowed (the reverse — diff importing the SPA
 * or mermaid — is not, and does not happen). Kept in lockstep with
 * structural.mjs's JSDoc return shape.
 */

export type DiffStatus =
  | 'added'
  | 'removed'
  | 'moved'
  | 'modified'
  | 'unchanged';

export interface DiffWordRun {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

export interface DiffFieldDiff {
  field: string;
  runs: DiffWordRun[];
}

export interface DiffEntry {
  id: string;
  status: DiffStatus;
  kind: string;
  prevIndex: number | null;
  nextIndex: number | null;
  block: Record<string, unknown> | null;
  prevBlock: Record<string, unknown> | null;
  fieldDiffs?: DiffFieldDiff[];
}

export interface DiffResult {
  results: DiffEntry[];
  byId: Record<string, Record<string, unknown>>;
}

export const DIFF_STATUS: {
  readonly ADDED: 'added';
  readonly REMOVED: 'removed';
  readonly MOVED: 'moved';
  readonly MODIFIED: 'modified';
  readonly UNCHANGED: 'unchanged';
};

export function diffDocuments(
  prevDoc: unknown,
  nextDoc: unknown
): DiffResult;
