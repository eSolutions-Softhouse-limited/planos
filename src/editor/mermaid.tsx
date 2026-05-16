/**
 * Offline mermaid renderer for `diagram` blocks (Phase 2 / P4 / Resolved
 * Decision D3 — BUNDLE mermaid at build time).
 *
 * Constraints honoured here:
 *   - Runtime is fully OFFLINE: mermaid is a build-time devDependency, inlined
 *     into the single-file `plugin/dist/index.html` by vite-plugin-singlefile
 *     (vite.config.mjs sets `inlineDynamicImports` so mermaid's own dynamic
 *     import() chunks collapse into the one bundle — NO CDN, NO network).
 *   - LAZY init: mermaid is imported via a dynamic `import('mermaid')` the
 *     FIRST time a diagram actually needs rendering. A PRD with zero `diagram`
 *     blocks never pays the mermaid cost and renders instantly. (At build the
 *     dynamic import is statically inlined, so this is purely a render-time
 *     deferral, not a network fetch.)
 *   - SPA-side ONLY: this module is never imported from src/hook/**,
 *     src/schema/** or src/diff/** — AC-17 import-graph stays CLEAN.
 *
 * Render contract: `mermaid.render` is async + idempotent here; a parse/render
 * failure NEVER crashes the SPA — the raw mermaid source is shown in a <pre>
 * with the error, so a malformed diagram still degrades gracefully.
 */
import { useEffect, useRef, useState } from 'react';

// `mermaid` has no first-party React types we depend on; we only use the
// minimal `initialize` / `render` surface.
type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (
    id: string,
    text: string
  ) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

/**
 * Lazily import + initialize mermaid exactly once. Subsequent calls reuse the
 * same promise. `startOnLoad:false` so mermaid never scans the DOM on its own
 * (we drive every render explicitly and synchronously per block).
 */
function getMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((mod) => {
    const m = (mod.default ?? mod) as unknown as MermaidApi;
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
    });
    return m;
  });
  return mermaidPromise;
}

let renderSeq = 0;

export function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string>(`planos-mmd-${(renderSeq += 1)}`);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setError(null);
    if (!source || !source.trim()) {
      setError('empty diagram');
      return;
    }
    getMermaid()
      .then((m) => m.render(idRef.current, source))
      .then(({ svg: out }) => {
        if (alive) setSvg(out);
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      alive = false;
    };
  }, [source]);

  if (error) {
    return (
      <div>
        <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 4 }}>
          ⚠ diagram could not be rendered: {error}
        </div>
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            fontSize: 12,
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {source}
        </pre>
      </div>
    );
  }

  if (svg === null) {
    return (
      <div style={{ fontSize: 13, color: '#94a3b8' }}>rendering diagram…</div>
    );
  }

  return (
    <div
      style={{ overflowX: 'auto' }}
      // SECURITY: mermaid is initialized with securityLevel:'strict', which
      // sanitizes the generated SVG (no inline scripts / event handlers).
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
