/**
 * planos SPA theme token layer (Phase 4 / Milestone Q2 — SPA-side ONLY).
 *
 * The SPA historically hard-coded every color as an inline-style hex literal
 * (App.tsx shell `#f1f5f9`, header `#0f172a`; blocks.tsx per-kind palettes;
 * markdown.tsx / mermaid.tsx code + diagram surfaces). This module replaces
 * those literals with a CLOSED, named token set so the SPA can render under a
 * `light` (default) or `dark` palette.
 *
 * HARD REQUIREMENT (AC-Q1): every `THEMES.light` value below is the VERBATIM
 * pre-Q2 hex that was inline at that surface. The default render is therefore
 * byte-for-byte visually unchanged — the theme infra changes dist bytes but
 * NOT rendered colors under `light`, which keeps the AC-P17/AC-R15 drift
 * re-baseline meaningful and guarantees zero behavioral regression.
 *
 * Boundary (AC-Q12 / ADR-0002 D3 precedent): this module is SPA-side ONLY. It
 * is NEVER imported by `src/hook/*`, `bin/planos`, or `src/export/*`. It is not
 * in the AC-17 audited blocking closure at all, exactly like the build-time
 * bundled offline mermaid renderer. ZERO new runtime dependency: React context
 * only, no theming library, no `localStorage` (deferred — out of Q2 scope).
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The closed token set — exactly the semantic surfaces the SPA uses, derived
 * by enumerating every literal in App.tsx / blocks.tsx / markdown.tsx /
 * mermaid.tsx. No unused tokens are invented.
 */
export interface ThemeTokens {
  /** App shell background (App.tsx shell). */
  bg: string;
  /** Card / panel surface (white panels, block shells). */
  surface: string;
  /** Subtle inset surface (badges, code header, option cards, diff header). */
  surfaceMuted: string;
  /** Default border. */
  border: string;
  /** Strong border (table thead underline, textarea/input borders). */
  borderStrong: string;
  /** Primary body text / headings. */
  text: string;
  /** Secondary body text (prose body). */
  textBody: string;
  /** Tertiary text (list items, risk/objective detail). */
  textSubtle: string;
  /** Muted text (metadata, captions, labels). */
  textMuted: string;
  /** Faint text (placeholders-as-text, H-level tags, chevrons). */
  textFaint: string;
  /** Detail / paragraph text (task detail, rationale). */
  textDetail: string;
  /** Accent link / interactive text. */
  accent: string;
  /** Approve action background. */
  accentApprove: string;
  /** Revise action background. */
  accentRevise: string;
  /** Inverted text on dark / accent surfaces (header text, button labels). */
  onAccent: string;
  /** Header bar background. */
  headerBg: string;
  /** Header primary text. */
  headerText: string;
  /** Header secondary text. */
  headerMuted: string;
  /** Code / diff <pre> background (dark slab). */
  codeBg: string;
  /** Code / diff <pre> foreground. */
  codeText: string;
  /** Inline `code` span background. */
  codeInlineBg: string;
  /** Horizontal-rule / hr border. */
  rule: string;
  /** Unresolved-id warning text (phase view). */
  warn: string;

  /** Status badge: todo. */
  statusTodoBg: string;
  statusTodoFg: string;
  /** Status badge: doing / "modified" file/diff badge. */
  statusDoingBg: string;
  statusDoingFg: string;
  /** Status badge: done / "added" file/diff badge / approved banner. */
  statusDoneBg: string;
  statusDoneFg: string;
  /** Status badge: cut / "deleted" file/diff badge / revise banner. */
  statusCutBg: string;
  statusCutFg: string;
  /** Diff/file "renamed" badge. */
  statusRenamedBg: string;
  statusRenamedFg: string;

  /** Approved decision banner border. */
  bannerApproveBorder: string;
  /** Revise decision banner border. */
  bannerReviseBorder: string;

  /** Chosen decision-option border + answered-question border. */
  okBorder: string;
  /** Chosen decision-option background. */
  okBg: string;
  /** Unanswered-question border + reject-hunk border. */
  badBorder: string;
  /** Comment-hunk verdict border. */
  infoBorder: string;

  /** Diff added line background (rgba). */
  diffAddBg: string;
  /** Diff added line foreground. */
  diffAddFg: string;
  /** Diff removed line background (rgba). */
  diffRemoveBg: string;
  /** Diff removed line foreground. */
  diffRemoveFg: string;
  /** Diff context line foreground. */
  diffContextFg: string;
}

/** The two shipped palettes. Token NAMES are shared; values differ. */
export const THEMES: { light: ThemeTokens; dark: ThemeTokens } = {
  // light = the VERBATIM pre-Q2 hex for every surface (AC-Q1).
  light: {
    bg: '#f1f5f9',
    surface: '#fff',
    surfaceMuted: '#f8fafc',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    text: '#0f172a',
    textBody: '#1e293b',
    textSubtle: '#334155',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    textDetail: '#475569',
    accent: '#2563eb',
    accentApprove: '#16a34a',
    accentRevise: '#dc2626',
    onAccent: '#fff',
    headerBg: '#0f172a',
    headerText: '#f8fafc',
    headerMuted: '#94a3b8',
    codeBg: '#0f172a',
    codeText: '#e2e8f0',
    codeInlineBg: '#f1f5f9',
    rule: '#e5e7eb',
    warn: '#b45309',
    statusTodoBg: '#e5e7eb',
    statusTodoFg: '#374151',
    statusDoingBg: '#dbeafe',
    statusDoingFg: '#1e40af',
    statusDoneBg: '#dcfce7',
    statusDoneFg: '#15803d',
    statusCutBg: '#fee2e2',
    statusCutFg: '#b91c1c',
    statusRenamedBg: '#fef9c3',
    statusRenamedFg: '#854d0e',
    bannerApproveBorder: '#86efac',
    bannerReviseBorder: '#fca5a5',
    okBorder: '#86efac',
    okBg: '#f0fdf4',
    badBorder: '#fca5a5',
    infoBorder: '#93c5fd',
    diffAddBg: 'rgba(34,197,94,0.18)',
    diffAddFg: '#86efac',
    diffRemoveBg: 'rgba(239,68,68,0.18)',
    diffRemoveFg: '#fca5a5',
    diffContextFg: '#e2e8f0',
  },
  // dark = a sensible dark palette over the SAME token names.
  dark: {
    bg: '#0b1120',
    surface: '#111827',
    surfaceMuted: '#1e293b',
    border: '#334155',
    borderStrong: '#475569',
    text: '#f1f5f9',
    textBody: '#e2e8f0',
    textSubtle: '#cbd5e1',
    textMuted: '#94a3b8',
    textFaint: '#64748b',
    textDetail: '#cbd5e1',
    accent: '#60a5fa',
    accentApprove: '#16a34a',
    accentRevise: '#dc2626',
    onAccent: '#f8fafc',
    headerBg: '#020617',
    headerText: '#f8fafc',
    headerMuted: '#94a3b8',
    codeBg: '#020617',
    codeText: '#e2e8f0',
    codeInlineBg: '#1e293b',
    rule: '#334155',
    warn: '#fbbf24',
    statusTodoBg: '#334155',
    statusTodoFg: '#e2e8f0',
    statusDoingBg: '#1e3a8a',
    statusDoingFg: '#bfdbfe',
    statusDoneBg: '#14532d',
    statusDoneFg: '#bbf7d0',
    statusCutBg: '#7f1d1d',
    statusCutFg: '#fecaca',
    statusRenamedBg: '#713f12',
    statusRenamedFg: '#fde68a',
    bannerApproveBorder: '#15803d',
    bannerReviseBorder: '#b91c1c',
    okBorder: '#15803d',
    okBg: '#052e16',
    badBorder: '#b91c1c',
    infoBorder: '#1e40af',
    diffAddBg: 'rgba(34,197,94,0.22)',
    diffAddFg: '#86efac',
    diffRemoveBg: 'rgba(239,68,68,0.22)',
    diffRemoveFg: '#fca5a5',
    diffContextFg: '#cbd5e1',
  },
};

export type ThemeName = keyof typeof THEMES;

/**
 * OS default: `prefers-color-scheme: dark` → `dark`, else `light`. A one-liner,
 * zero dep; falls back to `light` when `matchMedia` is unknown/unsupported
 * (e.g. SSR / older runtimes). NO `localStorage` (Q2 scope — deferred).
 */
export function preferredTheme(): ThemeName {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    /* unsupported → light */
  }
  return 'light';
}

interface ThemeCtx {
  name: ThemeName;
  theme: ThemeTokens;
  setName: (n: ThemeName) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({
  name: 'light',
  theme: THEMES.light,
  setName: () => {},
  toggle: () => {},
});

/** Provider — seeds from `prefers-color-scheme`, holds the active palette. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>(() => preferredTheme());
  const value = useMemo<ThemeCtx>(
    () => ({
      name,
      theme: THEMES[name],
      setName,
      toggle: () => setName((n) => (n === 'light' ? 'dark' : 'light')),
    }),
    [name]
  );
  return createElement(Ctx.Provider, { value }, children);
}

/** Consume the active token palette. */
export function useTheme(): ThemeTokens {
  return useContext(Ctx).theme;
}

/** Consume the full theme controller (name + setter + toggle). */
export function useThemeControl(): ThemeCtx {
  return useContext(Ctx);
}
