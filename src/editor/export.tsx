/**
 * planos SPA export affordances (Phase 4 / Milestone Q3 — SPA-side ONLY).
 *
 * Two zero-dependency, fully-offline export controls wired into the SPA header
 * next to the Q2 theme toggle:
 *
 *   1. "Download .md" — serializes the SPA's CURRENT in-memory document with
 *      the pure Q0 serializer (`src/export/markdown.mjs`, the SAME serializer
 *      the out-of-blocking-path `bin/planos export` CLI uses), wraps it in a
 *      `Blob`, and triggers a client-side download via a transient
 *      `a[download]`. NO `fetch`, NO network, NO server interaction — the doc
 *      is the one already loaded + rendered, passed in by `App.tsx`.
 *
 *   2. "Print / Save as PDF" — calls the browser-native `window.print()`. The
 *      `@media print` rules in `<PrintStyles/>` hide the interactive chrome
 *      (decision bar, revision/history browser, global-comment box, header
 *      toggle + these export buttons) so the printed / "Save as PDF" output is
 *      a clean paper document. ZERO new runtime dependency (Resolved Decision
 *      Q4 = browser print, no PDF library).
 *
 * Boundary (AC-17 / AC-Q12 / ADR-0002 D3 precedent): this module is SPA-side
 * ONLY. It is NEVER imported by `src/hook/*`, `bin/planos`, a blocking handler,
 * or `src/server/`. It MAY import the pure `src/export/markdown.mjs` serializer
 * (designed for exactly this dual SPA + CLI consumption). It adds ZERO runtime
 * dependency: `Blob`, `URL.createObjectURL`, `a[download]`, and
 * `window.print()` are all browser-native. Styling uses Q2 theme tokens only —
 * NO hard-coded color hex (Q2's AC-Q2 invariant stays green).
 */
import { serializeMarkdown } from '../export/markdown.mjs';
import { useTheme } from './theme';
import { type PlanDocument } from './types';

/**
 * Stable attribute marking interactive chrome that must NOT appear on paper.
 * The `@media print` block below hides every element carrying it. Applied in
 * `App.tsx` to the decision bar, the global-comment box, the header controls,
 * and (via its container) the revision/history browser.
 */
export const SCREEN_ONLY_ATTR = 'data-planos-screen-only';

/** Derive a safe download filename from the doc title (fallback: id). */
function filenameFor(doc: PlanDocument): string {
  const base =
    (doc && typeof doc.title === 'string' && doc.title.trim()) ||
    (doc && typeof doc.id === 'string' && doc.id) ||
    'plan';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'plan'}.md`;
}

/**
 * Serialize the CURRENT in-memory doc and trigger a client-side download.
 * Fully offline: Blob + transient `a[download]`, NO fetch / NO network.
 */
function downloadMarkdown(doc: PlanDocument): void {
  const md = serializeMarkdown(doc);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFor(doc);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The two export controls. Styled with Q2 theme tokens only (no hex literal).
 * `doc` is the SPA's current in-memory document — passed by `App.tsx`, never
 * re-fetched.
 */
export function ExportControls({ doc }: { doc: PlanDocument }) {
  const theme = useTheme();
  const btn: React.CSSProperties = {
    fontSize: 12,
    color: theme.headerMuted,
    background: 'none',
    border: `1px solid ${theme.headerMuted}`,
    borderRadius: 6,
    padding: '3px 9px',
    cursor: 'pointer',
  };
  return (
    <span
      {...{ [SCREEN_ONLY_ATTR]: '' }}
      style={{ display: 'flex', gap: 8 }}
    >
      <button
        type="button"
        onClick={() => downloadMarkdown(doc)}
        aria-label="Download markdown"
        style={btn}
      >
        ⬇ Download .md
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        aria-label="Print or Save as PDF"
        style={btn}
      >
        🖨 Print / Save as PDF
      </button>
    </span>
  );
}

/**
 * The `@media print` stylesheet (Q3.2). Inlined `<style>` — the SPA has no CSS
 * pipeline (every other style is an inline-style object), so an inlined print
 * block is the project-consistent, single-file-build-clean approach. It ONLY
 * affects `@media print` (screen rendering is untouched): it hides every
 * element carrying `SCREEN_ONLY_ATTR` (decision bar, revision/history browser,
 * global-comment box, header toggle + export buttons) and lays the document
 * out flush for paper.
 */
export function PrintStyles() {
  return (
    <style
      media="print"
      // The SPA is inline-style only; an @media print <style> is the
      // project-consistent way to add print rules to the single-file build.
      dangerouslySetInnerHTML={{
        __html: `
[${SCREEN_ONLY_ATTR}] { display: none !important; }
@page { margin: 16mm; }
body * { box-shadow: none !important; }
main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
header { padding: 0 0 8mm 0 !important; }
`,
      }}
    />
  );
}
