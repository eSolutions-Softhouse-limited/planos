/**
 * planos — M4b prose rich-editor markdown round-trip tests (plain Node, zero
 * extra harness; uses the build-time prosemirror-markdown engine directly).
 *
 * WHAT THIS PROVES
 * ----------------
 * Milestone M4b replaces the in-house markdown <textarea> ProseEditor with a
 * REAL TipTap/ProseMirror WYSIWYG editor for the `prose` block kind. TipTap's
 * `Editor` needs a DOM, and this repo has NO DOM test harness (by design — see
 * tests/editor-render.test.mjs docstring). The serializer the editor relies on
 * is `prosemirror-markdown` (wrapped by `tiptap-markdown`, which the SPA
 * imports). `prosemirror-markdown` is DOM-FREE, so this test drives the EXACT
 * markdown engine the in-editor save path uses, headless:
 *
 *   markdown (`md`)  --parse-->  ProseMirror doc  --serialize-->  markdown
 *
 * and asserts:
 *
 *   (A) ROUND-TRIP is structurally lossless for the common markdown the prose
 *       block carries (headings, bold/italic, inline + fenced code, ordered &
 *       unordered lists, blockquote, links). Unordered-list marker is
 *       normalized (`-`/`*` are equivalent markdown for the SAME AST); the
 *       round-trip is asserted to reach a FIXED POINT (idempotent), which is
 *       the correct losslessness criterion for a normalizing serializer.
 *
 *   (B) The serialized markdown folds back through the UNCHANGED
 *       `deriveWorkingDoc` edits seam (set({ md })) and the resulting
 *       `editedDocument` is schema-valid (validateDocument) — i.e. the rich
 *       editor's output is a drop-in replacement for the textarea's `md`
 *       string; the transport / persist contract is untouched.
 *
 * Run: node --test tests/prose-richedit-roundtrip.test.mjs
 * No network access required. No DOM. Build-time deps only.
 */

import assert from 'node:assert/strict';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';

import { deriveWorkingDoc } from '../src/editor/workingDoc.impl.mjs';
import { validateDocument } from '../src/schema/index.mjs';

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
    console.log(`        ${err && err.message ? err.message : String(err)}`);
  }
}

/** The in-editor save path: markdown -> PM doc -> markdown (tiptap-markdown
 *  serializes through this exact prosemirror-markdown engine). */
function roundTrip(md) {
  const doc = defaultMarkdownParser.parse(md);
  return defaultMarkdownSerializer.serialize(doc);
}

// A representative prose sample exercising every StarterKit markdown node the
// PRD prose block realistically carries.
const SAMPLE_MD = [
  '# Project overview',
  '',
  'This plan ships **bold**, *italic*, and `inline code` with a',
  '[reference link](https://example.com/spec).',
  '',
  '## Goals',
  '',
  '- First goal',
  '- Second goal',
  '- Third goal',
  '',
  '1. Step one',
  '2. Step two',
  '',
  '> A guiding principle worth quoting.',
  '',
  '```',
  'const offline = true;',
  '```',
].join('\n');

// ---------------------------------------------------------------------------
// (A) ROUND-TRIP losslessness (structural + idempotent fixed point).
// ---------------------------------------------------------------------------

test('M4b (A1): markdown round-trips through the PM engine to an IDEMPOTENT fixed point', () => {
  const once = roundTrip(SAMPLE_MD);
  const twice = roundTrip(once);
  assert.equal(
    once,
    twice,
    'serialize(parse(x)) must be a fixed point — a normalizing but LOSSLESS round-trip'
  );
});

test('M4b (A2): every common markdown construct survives the round-trip (no content loss)', () => {
  const out = roundTrip(SAMPLE_MD);
  // Headings (both levels), emphasis, inline + fenced code, link, list items,
  // blockquote text all survive verbatim (marker normalization aside).
  for (const needle of [
    '# Project overview',
    '## Goals',
    '**bold**',
    '*italic*',
    '`inline code`',
    '[reference link](https://example.com/spec)',
    'First goal',
    'Second goal',
    'Third goal',
    '1. Step one',
    '2. Step two',
    '> A guiding principle worth quoting.',
    '```',
    'const offline = true;',
  ]) {
    assert.ok(
      out.includes(needle),
      `round-trip dropped/altered markdown construct: ${JSON.stringify(needle)}\n--- got ---\n${out}`
    );
  }
});

test('M4b (A3): the ProseMirror node structure is preserved (headings/lists/quote/code)', () => {
  const doc = defaultMarkdownParser.parse(SAMPLE_MD);
  const kinds = new Set();
  doc.descendants((n) => {
    kinds.add(n.type.name);
    return true;
  });
  for (const expected of [
    'heading',
    'paragraph',
    'bullet_list',
    'ordered_list',
    'list_item',
    'blockquote',
    'code_block',
  ]) {
    assert.ok(kinds.has(expected), `parsed doc missing node type: ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// (B) The rich editor's serialized markdown folds back through the UNCHANGED
//     deriveWorkingDoc seam to a SCHEMA-VALID editedDocument.
// ---------------------------------------------------------------------------

const BASE = {
  schemaVersion: 1,
  type: 'prd',
  id: 'prd-m4b-prose-richedit-2026-05-17',
  title: 'PRD M4b Prose Rich-Edit Round-Trip',
  meta: { status: 'draft', createdAt: '2026-05-17T12:00:00.000Z', revision: 1 },
  blocks: [
    { id: 'b1', kind: 'section', title: 'Overview', level: 1 },
    { id: 'b2', kind: 'prose', md: 'Old prose body.' },
    {
      id: 'b3',
      kind: 'task',
      title: 'Ship M4b',
      status: 'todo',
      deps: [],
      acceptance: ['rich prose editor'],
    },
  ],
};

test('M4b (B1): rich-editor markdown folds through deriveWorkingDoc → schema-valid editedDocument', () => {
  // The TipTap onUpdate emits exactly this: getMarkdown() of the edited doc.
  // We simulate it with the same engine, then fold it through the UNCHANGED
  // edits seam exactly as App's state → deriveWorkingDoc does.
  const editedMd = roundTrip(SAMPLE_MD);
  const wd = deriveWorkingDoc(BASE, { edits: { b2: { md: editedMd } } });

  const v = validateDocument(wd);
  assert.equal(v.ok, true, `editedDocument must be schema-valid: ${JSON.stringify(v)}`);

  const b2 = wd.blocks.find((b) => b.id === 'b2');
  assert.equal(b2.kind, 'prose', 'kind preserved (id-stable fold)');
  assert.equal(b2.md, editedMd, 'the rich-editor markdown is the persisted md (no transport change)');
  // Nothing else moved: ids + order stable, no renumber.
  assert.deepEqual(
    wd.blocks.map((b) => b.id),
    ['b1', 'b2', 'b3'],
    'fold-back is id-stable and order-preserving (contract unchanged)'
  );
});

test('M4b (B2): an empty prose edit is still a schema-valid round-trip (degenerate case)', () => {
  const emptyMd = roundTrip('');
  const wd = deriveWorkingDoc(BASE, { edits: { b2: { md: emptyMd } } });
  assert.equal(validateDocument(wd).ok, true, 'empty prose md must stay schema-valid');
  const b2 = wd.blocks.find((b) => b.id === 'b2');
  assert.equal(typeof b2.md, 'string', 'prose md remains a string after round-trip');
});

console.log('');
console.log(
  `prose rich-editor (M4b) round-trip tests: ${passed} passed, ${failed} failed`
);
console.log('');

if (failed > 0) process.exit(1);
