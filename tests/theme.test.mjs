/**
 * planos — Q2 theme token-layer contract tests (plain Node, zero deps).
 *
 * Covers Phase 4 Milestone Q2 acceptance:
 *  - AC-Q1: src/editor/theme.ts exports a CLOSED token set and `THEMES.light`
 *           reproduces the EXACT pre-Q2 inline hex for every tokenized SPA
 *           surface (hard-coded expected snapshot below — the byte-equivalent
 *           guarantee that makes the AC-P17/AC-R15 drift re-baseline meaningful
 *           and proves zero default-render regression).
 *  - AC-Q2: App.tsx / blocks.tsx / markdown.tsx / mermaid.tsx contain NO
 *           remaining hard-coded color hex (or the two tokenized rgba diff
 *           backgrounds) literals — every tokenized surface routes through
 *           `theme.*` (grep-style source scan).
 *  - SPA-only boundary (AC-Q12 family): src/editor/theme.ts is NEVER imported
 *           by any src/hook/* , plugin/bin/* , or src/export/* module — it is
 *           SPA-side ONLY, exactly like the bundled offline mermaid renderer
 *           (ADR-0002 D3). It is not in the AC-17 audited blocking closure.
 *
 * Mirrors tests/export-markdown.test.mjs / tests/review-ingest.test.mjs style.
 * Run: node tests/theme.test.mjs   (or via node --test)
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { THEMES, preferredTheme } from "../src/editor/theme.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err && err.message ? err.message : err}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// AC-Q1 — THEMES.light is the VERBATIM pre-Q2 hex for every tokenized surface.
// This map is the byte-equivalence contract: each value is the literal hex
// that was inline in the SPA source BEFORE Q2 (App.tsx shell #f1f5f9 / header
// #0f172a; blocks.tsx per-kind palettes; markdown.tsx code #0f172a; mermaid.tsx
// error/loading). If a `light` value ever changes the default render drifts.
// ───────────────────────────────────────────────────────────────────────────
const EXPECTED_LIGHT = {
  bg: "#f1f5f9",
  surface: "#fff",
  surfaceMuted: "#f8fafc",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: "#0f172a",
  textBody: "#1e293b",
  textSubtle: "#334155",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  textDetail: "#475569",
  accent: "#2563eb",
  accentApprove: "#16a34a",
  accentRevise: "#dc2626",
  onAccent: "#fff",
  headerBg: "#0f172a",
  headerText: "#f8fafc",
  headerMuted: "#94a3b8",
  codeBg: "#0f172a",
  codeText: "#e2e8f0",
  codeInlineBg: "#f1f5f9",
  rule: "#e5e7eb",
  warn: "#b45309",
  statusTodoBg: "#e5e7eb",
  statusTodoFg: "#374151",
  statusDoingBg: "#dbeafe",
  statusDoingFg: "#1e40af",
  statusDoneBg: "#dcfce7",
  statusDoneFg: "#15803d",
  statusCutBg: "#fee2e2",
  statusCutFg: "#b91c1c",
  statusRenamedBg: "#fef9c3",
  statusRenamedFg: "#854d0e",
  bannerApproveBorder: "#86efac",
  bannerReviseBorder: "#fca5a5",
  okBorder: "#86efac",
  okBg: "#f0fdf4",
  badBorder: "#fca5a5",
  infoBorder: "#93c5fd",
  diffAddBg: "rgba(34,197,94,0.18)",
  diffAddFg: "#86efac",
  diffRemoveBg: "rgba(239,68,68,0.18)",
  diffRemoveFg: "#fca5a5",
  diffContextFg: "#e2e8f0",
};

test("AC-Q1 THEMES.light reproduces the EXACT pre-Q2 hex for every token", () => {
  assert.deepEqual(
    THEMES.light,
    EXPECTED_LIGHT,
    "THEMES.light drifted from the verbatim pre-Q2 inline hex — the default " +
      "render is no longer byte-equivalent (AC-Q1 / AC-P17 re-baseline broken)"
  );
});

test("AC-Q1 the token set is CLOSED — light & dark have the SAME token names", () => {
  const lightKeys = Object.keys(THEMES.light).sort();
  const darkKeys = Object.keys(THEMES.dark).sort();
  assert.deepEqual(
    darkKeys,
    lightKeys,
    "THEMES.dark must define EXACTLY the same closed token set as THEMES.light"
  );
  // Every token resolves to a non-empty string in BOTH palettes (no holes).
  for (const k of lightKeys) {
    assert.equal(typeof THEMES.light[k], "string");
    assert.ok(THEMES.light[k].length > 0, `light.${k} empty`);
    assert.equal(typeof THEMES.dark[k], "string");
    assert.ok(THEMES.dark[k].length > 0, `dark.${k} empty`);
  }
});

test("AC-Q1 dark is a DISTINCT palette (not a light copy)", () => {
  // Sanity: the two palettes must actually differ on the core surfaces or the
  // toggle is a no-op. (A handful of tokens — e.g. accentApprove — may stay the
  // same by design; we only require the palette is not wholesale identical.)
  assert.notDeepEqual(
    THEMES.dark,
    THEMES.light,
    "THEMES.dark must differ from THEMES.light"
  );
  assert.notEqual(THEMES.dark.bg, THEMES.light.bg, "dark bg must differ");
  assert.notEqual(
    THEMES.dark.surface,
    THEMES.light.surface,
    "dark surface must differ"
  );
});

test("preferredTheme() returns a valid theme name and never throws", () => {
  // No `window`/`matchMedia` in plain Node → must fall back to 'light'.
  const t = preferredTheme();
  assert.ok(t === "light" || t === "dark", `unexpected theme name: ${t}`);
  assert.equal(t, "light", "Node (no matchMedia) must fall back to light");
});

// ───────────────────────────────────────────────────────────────────────────
// AC-Q2 — no remaining hard-coded color literals in the tokenized SPA files.
// Comment-strip first so a hex mentioned in a doc-comment never trips the scan
// (mirrors the comment-stripped purity scan in export-markdown.test.mjs).
// ───────────────────────────────────────────────────────────────────────────
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TOKENIZED_FILES = [
  "src/editor/App.tsx",
  "src/editor/blocks.tsx",
  "src/editor/markdown.tsx",
  "src/editor/mermaid.tsx",
];

test("AC-Q2 tokenized SPA files contain NO hard-coded color hex / rgba literals", () => {
  const colorRe = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;
  for (const rel of TOKENIZED_FILES) {
    const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
    const m = colorRe.exec(code);
    assert.equal(
      m,
      null,
      `${rel} still has a hard-coded color literal: ${m && m[0]} — every ` +
        `tokenized surface must route through theme.* (AC-Q2)`
    );
    // Positive: the file actually consults the theme token layer.
    assert.ok(
      /useTheme\(\)|ThemeTokens|theme\./.test(code),
      `${rel} must consume the theme token layer (theme.* / useTheme)`
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// SPA-only boundary — theme.ts must NEVER be imported by a hook / CLI / export
// module (it is not in the AC-17 audited blocking closure at all; SPA-side
// only, like the bundled offline mermaid renderer per ADR-0002 D3).
// ───────────────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("theme.ts is SPA-only — never imported by src/hook/*, plugin/bin/*, src/export/*", () => {
  const refRe = /['"`][^'"`]*editor\/theme(?:\.ts)?['"`]|\btheme\.ts\b/;
  const surfaces = [
    ...walk(join(ROOT, "src", "hook")),
    ...walk(join(ROOT, "src", "export")),
    ...walk(join(ROOT, "plugin", "bin")),
  ].filter((p) => /\.(mjs|cjs|js|ts|mts)$/.test(p) || /\/planos$/.test(p));

  for (const p of surfaces) {
    const src = readFileSync(p, "utf8");
    assert.ok(
      !/editor\/theme/.test(src) && !refRe.test(src),
      `${p} references src/editor/theme — the theme layer must be SPA-only ` +
        `(not in the AC-17 blocking closure)`
    );
  }
  // Sanity: we actually scanned the CLI entry.
  assert.ok(
    surfaces.some((p) => /plugin\/bin\/planos$/.test(p)),
    "expected to have scanned plugin/bin/planos"
  );
});

console.log("");
console.log(`theme token-layer tests: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
