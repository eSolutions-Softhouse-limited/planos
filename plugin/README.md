# planos (Claude Code plugin)

Structured-block **plan / PRD / diff-review** plugin for Claude Code. The agent
authors plans, PRDs, and code reviews as a structured block document, rendered as
a rich, editable, fully offline browser UI with a local-server round-trip.
Markdown is an *export format*, not the source of truth.

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

## Entry modes

| Mode | Trigger |
|---|---|
| **Plan** | Native plan mode → `ExitPlanMode` hook (automatic) |
| **PRD** | `/planos-prd [topic]` slash command |
| **Diff review** | `/planos-review [PR# \| git range]` slash command |

`/planos-plan` starts the optional Socratic interview that authors the initial
plan before plan mode.

**Markdown export:** `bin/planos export < document.json > document.md` — out of
the blocking path by construction (no server, no round-trip, no block). Export is
also available inside the editor. The SPA additionally offers selectable themes
and PDF via the browser's `window.print()`.

## Guarantees

- **AC-17 — no model / network / agent spawn in the blocking path.** The
  blocking review round-trip (`bin/planos exit|prd|review` → `src/hook/*` →
  `src/server/` → `src/schema/` → `src/diff/`) is model-free, makes no network
  egress, and spawns no agent. Enforced by `tests/ac17-invariant.test.mjs`.
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
