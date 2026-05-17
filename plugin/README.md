# planos (Claude Code plugin)

Structured-block **PRD** plugin for Claude Code. The agent authors a PRD as a
structured block document, rendered as a rich, editable, fully offline browser
UI with a local-server round-trip. Markdown is an *export format*, not the
source of truth.

**Fully offline · zero runtime dependencies · single committed `dist/index.html`.**

## Install

**Local development** — load this plugin directory in-place:

```bash
claude --plugin-dir ./plugin
```

**Marketplace** — add the marketplace, then install:

```bash
/plugin marketplace add eSolutions-Softhouse-limited/planos
/plugin install planos@esolutions-planos
```

No build step or `npm install` is needed to use the plugin: the editor SPA is
pre-built and committed at `dist/index.html`.

## Entry mode

planos is a **single flow — PRD** (ADR-0007).

| Mode | Trigger |
|---|---|
| **PRD** | `/planos-prd [topic]` slash command → `planos prd` (blocking CLI, stdin) |

The PRD is invoked by the command running the CLI directly — no hooks involved.

**Rich interactive editor:** the SPA provides per-kind edit modals for all 13 block kinds, a TipTap/ProseMirror WYSIWYG prose editor (bundled offline), an editable table grid, a Mermaid diagram editor, add/delete blocks, native HTML5 drag-and-drop block reorder with keyboard accessibility, advisory feedback forwarded on Approve (M2), and edited-revision persistence on Approve (M3 — the working doc with reviewer edits becomes the next immutable revision).

**Markdown export:** `bin/planos export < document.json > document.md` — out of
the blocking path by construction (no server, no round-trip, no block). Export is
also available inside the editor. The SPA additionally offers selectable themes
and PDF via the browser's `window.print()`.

## Guarantees

- **AC-17 — no model / network / agent spawn in the blocking path.** The
  blocking PRD round-trip (`bin/planos prd` → `src/hook/prd.mjs` →
  `src/hook/prd-runtime.mjs` → `src/server/` → `src/schema/` → `src/diff/` →
  `src/prd/store.mjs`) is model-free, makes no network egress, and spawns no
  agent. Enforced by `tests/ac17-invariant.test.mjs`.
- **Fully offline.** The full loop works with no external network; the SPA is a
  single self-contained HTML blob.
- **Zero runtime dependencies.** `package.json` declares no runtime
  `dependencies`; only Node stdlib is used at runtime.
- **Single committed SPA.** Editor ships pre-built as `dist/index.html`.

See the repository [`README.md`](../README.md), `docs/design.md`, and the ADRs
under `docs/adr/` for the full architecture. Editor screenshots can be added
under `docs/screenshots/`.

## License

Private esolutions.gr repository — `"license": "UNLICENSED"` (see
`.claude-plugin/plugin.json`).
