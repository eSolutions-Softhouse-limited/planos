/**
 * planos — buildSpaHtml inline-doc injection regression (node:test, zero deps).
 *
 * Guards a real-SPA production bug: the prebuilt single-file editor
 * (plugin/dist/index.html) inlines third-party source (DOMPurify via mermaid)
 * inside ONE `<script type="module">`. That bundled source contains the string
 * literal `<head></head><body>`. The original injector used
 *
 *     html.replace('</head>', `${inline}</head>`)
 *
 * which matched the FIRST `</head>` — the one INSIDE the DOMPurify string
 * literal, mid-bundle — and spliced `<script>…;</script>` there. The injected
 * `</script>` prematurely closed the module script and the browser rendered the
 * rest of the bundle as raw text (the "raw data instead of artifacts" symptom).
 *
 * Contract asserted here:
 *   1. The plan doc is injected exactly once.
 *   2. The HTML parser does NOT close the module script before the entire
 *      bundle (incl. the DOMPurify `<head></head><body>` literal) — i.e. the
 *      bundle's real `</script>` is the first parser-recognized close.
 *   3. The injected inline lands AFTER the bundle and immediately before the
 *      document's true (last) `</head>`.
 *   4. A `</script>` embedded in user plan text is neutralized (no extra
 *      parser-recognized close is introduced by the doc payload).
 *
 * Skips cleanly if the editor bundle has not been built.
 *
 * Run: node --test tests/spa-inline-injection.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSpaHtml, buildDegradedHtml } from '../src/hook/exit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(__dirname, '..', 'plugin', 'dist', 'index.html');

const SAMPLE_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'regression-spa-inline',
  title: 'SPA inline injection regression',
  meta: { status: 'draft', createdAt: '2026-05-16T00:00:00.000Z', revision: 1 },
  blocks: [
    {
      id: 'b1',
      kind: 'prose',
      // Adversarial payload: script-close + replace special patterns + template.
      md: 'edge </script> <\/SCRIPT $& $$ `${x}` </head> test',
    },
  ],
};

// First parser-recognized close of an inline script: per the HTML spec the
// script data ends at the first `</script` followed by whitespace, `/`, or `>`.
function firstParserScriptClose(html) {
  const open = html.search(/<script[\s>]/i);
  if (open === -1) return -1;
  const rest = html.slice(open + '<script'.length);
  const rel = rest.search(/<\/script[\s/>]/i);
  return rel === -1 ? -1 : open + '<script'.length + rel;
}

test('buildSpaHtml: inline doc lands after the whole bundle, not mid-DOMPurify', (t) => {
  if (!existsSync(BUNDLE)) {
    t.skip('plugin/dist/index.html not built — run npm run build:editor');
    return;
  }

  const html = buildSpaHtml(SAMPLE_DOC);

  const INJ = '<script>window.__PLANOS_DOC__=';
  const injPos = html.indexOf(INJ);
  const injCount = html.split(INJ).length - 1;

  // The DOMPurify string literal that lives deep inside the module bundle and
  // that the buggy first-match replace used to target.
  const dompurifyLiteral = html.indexOf('<head></head><body>');
  const lastHead = html.lastIndexOf('</head>');
  const parserClose = firstParserScriptClose(html);

  assert.equal(injCount, 1, 'plan doc must be injected exactly once');
  assert.ok(
    dompurifyLiteral !== -1,
    'sanity: bundle should contain the DOMPurify <head></head><body> literal',
  );

  // The crux: the parser must stay inside the module script THROUGH the
  // DOMPurify literal — i.e. the first recognized `</script>` is the bundle's
  // own real close, which is AFTER that literal. (Pre-fix this was false.)
  assert.ok(
    parserClose > dompurifyLiteral,
    `module script must not close before the bundle's DOMPurify code ` +
      `(parserClose=${parserClose}, dompurifyLiteral=${dompurifyLiteral})`,
  );

  // The injected inline sits AFTER the entire bundle and immediately before
  // the document's true (last) </head>.
  assert.ok(
    injPos > dompurifyLiteral,
    `inline doc must be injected after the bundle, not spliced into it ` +
      `(injPos=${injPos}, dompurifyLiteral=${dompurifyLiteral})`,
  );
  assert.ok(
    injPos > parserClose,
    `inline doc must follow the module script's real close ` +
      `(injPos=${injPos}, parserClose=${parserClose})`,
  );
  assert.ok(
    injPos < lastHead,
    'inline doc must be injected before the document\'s real </head>',
  );

  // The adversarial </script> in plan text must be neutralized so it cannot
  // introduce its own parser-recognized close. The inline is
  // `<script>window.__PLANOS_DOC__=<JSON>;</script>`; the payload under test is
  // the <JSON> region only — bounded by the inline's OWN legitimate closing
  // `;</script>`, NOT the document's last </head> (which would wrongly include
  // that intended terminator).
  const jsonStart = injPos + INJ.length;
  const jsonEnd = html.indexOf(';</script>', jsonStart);
  assert.ok(
    jsonEnd !== -1 && jsonEnd < lastHead,
    'inline must terminate with its own ;</script> before the real </head>',
  );
  const payload = html.slice(jsonStart, jsonEnd);
  assert.ok(
    !/<\/script[\s/>]/i.test(payload),
    'embedded </script> in plan text must be neutralized in the inline payload',
  );
});

// ---------------------------------------------------------------------------
// Degraded-fallback regression: the reported `/planos-review` bug —
// "Loading plan… (SPA bundle not built — using /api/plan)" hung forever
// because the fallback fetched /api/plan, which does NOT exist in review
// (/api/review) or prd (/api/prd) mode. The replacement must be fully
// self-contained: inline the doc, never reference /api/plan, never hang.
// ---------------------------------------------------------------------------

test('buildDegradedHtml: self-contained, inlines the doc, never hangs on /api/plan', () => {
  const html = buildDegradedHtml(SAMPLE_DOC);

  // Well-formed standalone document.
  assert.ok(
    html.trim().startsWith('<!doctype html>') && html.trim().endsWith('</html>'),
    'degraded view must be a well-formed standalone HTML document',
  );

  // The exact old infinite-loading text + the /api/plan dependency are GONE.
  assert.ok(
    !html.includes('SPA bundle not built — using /api/plan'),
    'must not emit the old misleading "/api/plan" loading shell',
  );
  assert.ok(
    !html.includes('/api/plan') &&
      !html.includes('/api/review') &&
      !html.includes('/api/prd'),
    'degraded view must make ZERO API calls (fully self-contained)',
  );

  // The doc is inlined exactly once for a future bundle…
  const INJ = '<script>window.__PLANOS_DOC__=';
  assert.equal(
    html.split(INJ).length - 1,
    1,
    'doc must be inlined exactly once as window.__PLANOS_DOC__',
  );

  // …and the content is human-readable so a reviewer can SEE/approve it.
  assert.ok(
    html.includes(SAMPLE_DOC.id),
    'degraded view must show the document content (id present in JSON)',
  );
  // The adversarial `</script>` from the doc text must be HTML-escaped (`<`
  // → `&lt;`) so it is inert page text inside <pre>, not a real tag.
  const preStart = html.indexOf('<pre>');
  const preEnd = html.indexOf('</pre>', preStart);
  assert.ok(preStart !== -1 && preEnd > preStart, 'a readable <pre> block exists');
  const preBody = html.slice(preStart + '<pre>'.length, preEnd);
  assert.ok(
    preBody.includes('&lt;/script') && !/<\/script[\s/>]/i.test(preBody),
    'doc JSON inside <pre> must be HTML-escaped (no live </script>)',
  );

  // The adversarial </script> in plan text must not introduce an extra
  // parser-recognized script close beyond the single inline terminator.
  const closes = (html.match(/<\/script[\s/>]/gi) || []).length;
  assert.equal(
    closes,
    1,
    `exactly one parser-recognized </script> (the inline's own); got ${closes}`,
  );
});
