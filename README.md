# planos

> **planos** is a Claude Code plugin that makes the agent author **plans, PRDs, and
> diff reviews** as a **structured block document**, rendered as a rich, editable
> browser UI — the common ground between LLM-native serialization and human-native
> review. Markdown is an *export format*, not the source of truth.

planos is **fully offline**, has **zero runtime dependencies**, and ships as a
**single committed `plugin/dist/index.html`** SPA. The blocking review round-trip
makes **no model call, no network egress, and no agent spawn** (the AC-17
invariant — see [Guarantees](#guarantees)).

---

## Install

planos is distributed as a standalone Claude Code plugin. There are two install
paths:

### 1. Local development (`--plugin-dir`)

Point Claude Code at the bundled plugin directory in a checkout of this repo:

```bash
git clone https://github.com/eSolutions-Softhouse-limited/planos.git
cd planos
claude --plugin-dir ./plugin
```

This loads the plugin in-place from `./plugin` for development and local use.

### 2. Marketplace install

planos is listed via the `.claude-plugin/marketplace.json` in this repo. Add the
marketplace and install the plugin:

```bash
# Add this repo as a marketplace (local path or git URL)
/plugin marketplace add eSolutions-Softhouse-limited/planos

# Install the plugin
/plugin install planos@esolutions-planos
```

No build step and no `npm install` is required to *use* the plugin — the SPA is
pre-built and committed at `plugin/dist/index.html`. (Rebuilding the editor is a
development-only concern; see [Building the editor](#building-the-editor-dev-only).)

---

## The three entry modes

planos has **three entry modes, one engine**. All three share the block schema,
the SPA editor, the local-server round-trip, structured feedback, and structural
diff — only the *source* of the initial document and the *block subset* differ.

| Mode | Trigger | How it works |
|---|---|---|
| **Plan** | Native plan mode | The flagship loop. The `ExitPlanMode` hook fires automatically; the agent's structured plan opens in the editor; your structured feedback is fed back and the agent revises until approved. |
| **PRD** | `/planos-prd [topic]` slash command | Not plan-mode. Richer block vocabulary; persists revision history to a `prds/`-style directory. |
| **Diff review** | `/planos-review [PR# \| git range]` | `gh`/`git` fetch (pre-server, outside the blocking path) → `diff` blocks; comment / accept / reject per hunk. |

A `/planos-plan` slash command is also available to start the optional Socratic
interview that authors the initial plan document before plan mode.

### Markdown export

```bash
plugin/bin/planos export < document.json > document.md
```

`bin/planos export` reads a structured document on stdin and writes serialized
markdown to stdout. It is **out of the blocking path by construction**: it boots
no server, runs no decision round-trip, and never blocks. Markdown export is also
available from inside the SPA editor.

### Themes & PDF

The SPA editor ships with selectable color themes (SPA-side only — never on any
`bin/planos` path) and supports PDF output via the browser's native
`window.print()`. Both are zero-dependency and have no Node-side surface.

> **Screenshots:** see [`docs/`](docs/) for design material. Editor screenshots
> can be added under a `docs/screenshots/` directory.

---

## Guarantees

planos is built around a small set of hard, tested guarantees:

- **AC-17 — no model / network / spawn in the blocking path.** The blocking
  review round-trip (`bin/planos exit|prd|review` → `src/hook/*` → `src/server/`
  → `src/schema/` → `src/diff/`) contains **no model call, no network egress,
  and no agent spawn**. The agent authors block IDs; the path that turns agent
  output into the canonical artifact and serializes the decision is
  model-free. Enforced by `tests/ac17-invariant.test.mjs` and the import-graph
  harness. See [`docs/notes/ac17-invariant.md`](docs/notes/ac17-invariant.md)
  and [`docs/adr/0003-diff-review.md`](docs/adr/0003-diff-review.md).
- **Fully offline.** The full loop works with no external network. The SPA is a
  single self-contained HTML blob (bundled renderer, no CDN).
- **Zero runtime dependencies.** `package.json` declares **no** runtime
  `dependencies` — only dev dependencies for building the editor. The CLI
  dispatcher and hooks use only the Node standard library.
- **Single committed SPA.** The editor ships pre-built as one file:
  `plugin/dist/index.html`. No build step is needed to use planos.

For the full architecture, see [`docs/design.md`](docs/design.md) and the ADRs
under [`docs/adr/`](docs/adr/).

---

## Building the editor (dev only)

Only needed if you change the SPA source. The committed `plugin/dist/index.html`
is authoritative for end users.

```bash
npm install      # dev dependencies only — no runtime deps
npm run build:editor
```

---

## License

This is a private esolutions.gr repository. See `plugin/.claude-plugin/plugin.json`
(`"license": "UNLICENSED"`).
