# planos → PRD-only, rich interactive editor

Branch: `feat/prd-only-rich-editor`  ·  Status: in progress  ·  Mode: plan-then-execute autonomous

## Decision (user, explicit)
Consolidate to a single flow: **PRD only**. Drop `planos-plan` and `planos-review`.
Build a **big-bang rich interactive editor**: drag-and-drop, per-kind edit modals,
diagrams instead of raw markdown, comments that actually work.

Dropping the plan flow deletes the entire ExitPlanMode roundtrip (root of the two
earlier bugs). PRD already bypasses ExitPlanMode (CLI/stdin), so it is the survivor.

## Hard constraints (enforced by existing tests — keep green)
- Offline, zero non-loopback network egress (`ac17-invariant`).
- No CDN; all assets build-time bundled into the single-file SPA (`spa-inline-injection`).
- Single self-contained bin bundle, no `src/` at runtime (`packaging-no-src`, ADR-0006).
- Blocking local-server roundtrip is the product.

## Autonomous tech decisions (veto at any milestone boundary)
- Rich text: TipTap/ProseMirror, build-time bundled (precedent: bundled Mermaid).
- Diagrams: keep bundled Mermaid render; edit = modal (source + live preview).
  NOT tldraw/Excalidraw (fetch fonts/wasm → breaks AC-17/no-CDN).
- Drag-drop: dnd-kit; native HTML5 DnD fallback if bundle/AC-17 risk.
- Edit model: editor mutates the document directly; Approve persists the edited
  doc as a new PRD revision (existing prd-store chain); comments/verdict via the
  fixed envelope. Structurally removes the "approve drops feedback" defect.

## Milestones
- M1 Excise plan+review → PRD-only (commands, hooks, src/hook/{enter,exit,review}, v3/diff schema+UI, dead tests, manifest/README, ADR-0007). Gate: remaining suite green, both bundles build, `planos prd` roundtrip works.
- M2 Fix feedback contract on PRD **approve** (comments/verdict survive; awaited transport; server acks before resolve) + regression test.
- M3 Direct-edit document model + persist edited revision on approve.
- M4 Per-kind edit modals (all v2 PRD kinds) + editable table grid + Mermaid edit modal + TipTap prose.
- M5 Drag-and-drop block reorder.
- M6 Full verification (AC-17, packaging-no-src, spa-inline, drift, bundle-size, manual smoke) + docs.

Tasks tracked: #1–#6 (linear blockedBy chain).
