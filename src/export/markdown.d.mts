/**
 * Ambient type surface for the pure Q0 markdown serializer
 * (`src/export/markdown.mjs`).
 *
 * `src/export/markdown.mjs` is FROZEN (Q0) and intentionally carries ZERO
 * imports / no types. This sibling `.d.mts` is a NEW declaration file (it does
 * NOT modify the frozen serializer) so the SPA-side `src/editor/export.tsx`
 * (Q3) can `import { serializeMarkdown }` under the `src/editor`-scoped
 * `tsconfig.json` with `moduleResolution: bundler` and stay at tsc=0.
 *
 * The serializer is doc-in / string-out and NEVER throws (see the purity
 * contract atop markdown.mjs); the document is typed loosely here to mirror
 * the runtime's best-effort, total-over-any-shape contract.
 */
export declare function serializeMarkdown(doc: unknown): string;
