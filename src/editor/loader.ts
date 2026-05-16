/**
 * Injectable document loader — keeps the editor offline-testable.
 *
 * Resolution order:
 *   1. `window.__PLANOS_DOC__` injection seam (server inlines the doc here)
 *   2. `GET /api/plan` (best-effort; silently ignored offline / on failure)
 *   3. built-in demo document (so the SPA renders standalone)
 *
 * The fetch is behind this single function so tests can run with no network.
 */
import { DEMO_DOC } from './demoDoc';
import { type PlanDocument } from './types';

declare global {
  interface Window {
    __PLANOS_DOC__?: PlanDocument;
  }
}

function isPlanDocument(v: unknown): v is PlanDocument {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return d.schemaVersion === 1 && Array.isArray(d.blocks) && typeof d.id === 'string';
}

export async function loadDocument(): Promise<PlanDocument> {
  if (typeof window !== 'undefined' && isPlanDocument(window.__PLANOS_DOC__)) {
    return window.__PLANOS_DOC__ as PlanDocument;
  }

  try {
    const res = await fetch('/api/plan', { headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as unknown;
      // Server may wrap as { plan: Document } or return the doc directly.
      const candidate =
        body && typeof body === 'object' && 'plan' in body
          ? (body as { plan: unknown }).plan
          : body;
      if (isPlanDocument(candidate)) return candidate;
    }
  } catch {
    // Offline / no server — fall through to the demo document.
  }

  return DEMO_DOC;
}

/**
 * Best-effort fetch of the prior revision for the revision selector (US-014).
 * Returns `null` offline / when there is no previous revision (the selector
 * then renders disabled — never blocks). The current doc is ALSO carried via
 * `window.__PLANOS_DOC__` / `loadDocument`; only the diff base needs this.
 */
export async function loadPreviousDocument(): Promise<PlanDocument | null> {
  try {
    const res = await fetch('/api/plan', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { previousPlan?: unknown };
    const prev = body && typeof body === 'object' ? body.previousPlan : null;
    return isPlanDocument(prev) ? (prev as PlanDocument) : null;
  } catch {
    return null;
  }
}
