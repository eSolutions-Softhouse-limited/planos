/**
 * Multi-revision history browser (Phase 2 / Milestone P4.2, AC-P11).
 *
 * Resolved Decision D2 — MINIMAL scope: a revision list + pick-to-view +
 * pick-an-earlier-revision-as-diff-base, rendering the EXISTING Phase-1
 * structural diff engine (`src/diff/structural.mjs` `diffDocuments`). NO
 * timeline / blame / side-by-side (those are explicit scope expansions).
 *
 * API shape (served read-only by buildPrdApiHandlers in src/hook/prd.mjs):
 *   - GET /api/prd/versions    → { versions: [{ v, revision }, ...] }
 *   - GET /api/prd/version?v=N → { plan: Document }
 *
 * The Phase-1 plan-mode SPA path (/api/plan*) is UNAFFECTED: this component
 * is only mounted for PRD docs (App.tsx gates on the versions endpoint and
 * silently no-ops when it is absent, e.g. plan mode / offline). Both API
 * shapes coexist.
 *
 * SPA-side ONLY — never imported from src/hook/**, src/schema/** or
 * src/diff/** (it imports the diff engine, not the reverse): AC-17
 * import-graph stays CLEAN.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  type DiffEntry,
  type DiffResult,
  diffDocuments,
} from '../diff/structural.mjs';
import { type PlanDocument } from './types';

interface RevisionRef {
  v: number;
  revision: number;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  added: { bg: '#dcfce7', fg: '#15803d' },
  removed: { bg: '#fee2e2', fg: '#b91c1c' },
  moved: { bg: '#fef3c7', fg: '#b45309' },
  modified: { bg: '#dbeafe', fg: '#1e40af' },
  unchanged: { bg: '#f1f5f9', fg: '#64748b' },
};

async function fetchVersions(): Promise<RevisionRef[]> {
  try {
    const res = await fetch('/api/prd/versions', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { versions?: RevisionRef[] };
    return Array.isArray(body.versions) ? body.versions : [];
  } catch {
    // Offline / plan mode / no PRD server — the browser simply does not mount.
    return [];
  }
}

async function fetchRevision(v: number): Promise<PlanDocument | null> {
  try {
    const res = await fetch(`/api/prd/version?v=${encodeURIComponent(v)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { plan?: unknown };
    return (body.plan as PlanDocument) ?? null;
  } catch {
    return null;
  }
}

function blockTitle(block: Record<string, unknown> | null): string {
  if (!block) return '';
  for (const f of ['title', 'text', 'question', 'description', 'path', 'axis']) {
    const v = block[f];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return String(block.id ?? '');
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const s = STATUS_STYLE[entry.status] ?? STATUS_STYLE.unchanged;
  const title = blockTitle(entry.block ?? entry.prevBlock);
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '4px 0',
        fontSize: 13,
        borderBottom: '1px solid #f1f5f9',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          padding: '1px 7px',
          borderRadius: 4,
          background: s.bg,
          color: s.fg,
          minWidth: 72,
          textAlign: 'center',
        }}
      >
        {entry.status}
      </span>
      <span style={{ color: '#64748b', fontSize: 11 }}>{entry.kind}</span>
      <span style={{ color: '#0f172a' }}>{title}</span>
    </li>
  );
}

export function HistoryBrowser() {
  const [versions, setVersions] = useState<RevisionRef[] | null>(null);
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [baseRev, setBaseRev] = useState<number | null>(null);
  const [viewDoc, setViewDoc] = useState<PlanDocument | null>(null);
  const [baseDoc, setBaseDoc] = useState<PlanDocument | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVersions().then((vs) => {
      if (!alive) return;
      setVersions(vs);
      if (vs.length > 0) {
        const latest = vs[vs.length - 1].v;
        setViewRev(latest);
        const earlier = vs.filter((x) => x.v < latest);
        setBaseRev(earlier.length > 0 ? earlier[earlier.length - 1].v : null);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (viewRev == null) {
      setViewDoc(null);
      return;
    }
    fetchRevision(viewRev).then((d) => {
      if (alive) setViewDoc(d);
    });
    return () => {
      alive = false;
    };
  }, [viewRev]);

  useEffect(() => {
    let alive = true;
    if (baseRev == null) {
      setBaseDoc(null);
      return;
    }
    fetchRevision(baseRev).then((d) => {
      if (alive) setBaseDoc(d);
    });
    return () => {
      alive = false;
    };
  }, [baseRev]);

  const diff: DiffResult | null = useMemo(() => {
    if (!viewDoc || !baseDoc) return null;
    return diffDocuments(baseDoc, viewDoc);
  }, [viewDoc, baseDoc]);

  // Not a PRD round-trip (plan mode / offline / single revision) — render
  // nothing so the Phase-1 plan-mode SPA path is completely unaffected.
  if (!versions || versions.length < 2) return null;

  const changed = diff
    ? diff.results.filter((r) => r.status !== 'unchanged')
    : [];

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <div
        style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}
      >
        Revision history
        <span
          style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 8 }}
        >
          {versions.length} revisions
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <label style={{ fontSize: 12, color: '#64748b' }}>
          Viewing revision
          <select
            aria-label="View revision"
            value={viewRev ?? ''}
            onChange={(e) => setViewRev(Number(e.target.value))}
            style={{
              display: 'block',
              marginTop: 3,
              padding: '6px 9px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {versions.map((x) => (
              <option key={x.v} value={x.v}>
                r{x.revision}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, color: '#64748b' }}>
          Diff base (earlier revision)
          <select
            aria-label="Diff base revision"
            value={baseRev ?? ''}
            onChange={(e) =>
              setBaseRev(e.target.value === '' ? null : Number(e.target.value))
            }
            style={{
              display: 'block',
              marginTop: 3,
              padding: '6px 9px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <option value="">(none — no diff)</option>
            {versions
              .filter((x) => viewRev == null || x.v < viewRev)
              .map((x) => (
                <option key={x.v} value={x.v}>
                  r{x.revision}
                </option>
              ))}
          </select>
        </label>
      </div>

      {diff ? (
        changed.length === 0 ? (
          <div style={{ fontSize: 13, color: '#64748b' }}>
            No structural changes between the selected revisions.
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {changed.map((entry) => (
              <DiffRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )
      ) : (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          Select a diff base to compare revisions.
        </div>
      )}
    </div>
  );
}
