/**
 * planos — reusable static module-reachability walker (AC-17 static layer).
 *
 * Contract: consensus plan AC-17 "Static layer", Step 4.2; docs/design.md §5;
 * docs/notes/ac17-invariant.md.
 *
 * This is a REAL import-graph reachability walk — NOT a flat text grep. From a
 * set of root modules it parses every module's `import` / `export ... from` /
 * `require(...)` / dynamic `import(...)` edges, resolves each STATIC string
 * specifier to a file, and recurses, building the transitive closure. The
 * resulting set is the exact body of code that can execute when the root runs.
 *
 * FAIL-CLOSED rule (AC-17): a dynamic `import()` / `require()` whose specifier
 * is NOT a provable static string in a module that is itself reachable from
 * the blocking/artifact/ID roots makes the graph unprovable — we cannot bound
 * what that edge pulls in, so we MUST treat the graph as dirty (fail closed),
 * NOT optimistically clean.
 *
 *   Exception (still static, still provable): the `bin/planos` dispatcher
 *   resolves its hook modules via `import(resolve(__dirname, '<literal>'))`.
 *   The path argument is a LITERAL string segment passed through node:path
 *   `resolve()` purely for cwd-independence. We extract that literal and
 *   resolve it relative to the importing module's directory — it is fully
 *   provable, so it does NOT trip the fail-closed rule. Any dynamic import
 *   whose argument has no extractable literal DOES trip it.
 *
 * Zero runtime dependencies. node: builtins only. Pure: same inputs → same
 * transitive set + same verdict, deterministically ordered.
 */

'use strict';

import { readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Module specifiers that are forbidden anywhere in the blocking/artifact/ID
 * transitive set: agent SDKs, model clients, and network-client wrappers. A
 * reachable import of any of these is an AC-17 violation. Matching is by
 * specifier shape (prefix / exact / substring) against the RESOLVED edge
 * specifier string, BEFORE node-builtin/relative resolution — so a bare
 * `import OpenAI from 'openai'` is caught even though it never resolves to a
 * file in this dep-free repo.
 *
 * `node:child_process` is intentionally NOT in this list: spawning the OS
 * URL-opener is the documented, allowed AC-17 boundary (see
 * docs/notes/ac17-invariant.md). The forbidden thing is spawning an AGENT —
 * which the runtime no-egress test asserts, and which no static specifier here
 * can express. What IS statically forbidden is importing an agent SDK.
 */
const FORBIDDEN_SPECIFIERS = Object.freeze([
  // Anthropic / Claude agent SDKs + model clients
  '@anthropic-ai/sdk',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/vertex-sdk',
  '@anthropic',
  'anthropic',
  // OpenAI + other model clients
  'openai',
  '@openai/',
  '@azure/openai',
  'cohere-ai',
  '@google/generative-ai',
  '@google-cloud/aiplatform',
  '@mistralai/',
  'groq-sdk',
  'replicate',
  'ollama',
  // Agent / LLM orchestration frameworks
  'langchain',
  '@langchain/',
  'llamaindex',
  'ai', // the Vercel `ai` SDK — model-client wrapper
  '@ai-sdk/',
  // HTTP/network-client wrappers (a model call would ride one of these; the
  // blocking path uses node:http to its OWN loopback server only — it never
  // needs a third-party network client).
  'axios',
  'node-fetch',
  'undici',
  'got',
  'superagent',
  'request',
  'cross-fetch',
]);

/**
 * Decide whether a resolved edge specifier names a forbidden module.
 *
 * @param {string} spec
 * @returns {string | null} the matched forbidden token, or null
 */
export function matchForbidden(spec) {
  if (typeof spec !== 'string' || spec.length === 0) return null;
  // Strip a subpath ( '@scope/pkg/sub' / 'pkg/sub' ) down to the package id
  // for exact/prefix comparison, but also test the raw spec for substrings.
  for (const f of FORBIDDEN_SPECIFIERS) {
    if (f.endsWith('/')) {
      if (spec === f.slice(0, -1) || spec.startsWith(f)) return f;
    } else if (f.startsWith('@')) {
      if (spec === f || spec.startsWith(`${f}/`)) return f;
    } else {
      // bare package: exact, or as the package root of a subpath import
      if (spec === f || spec.startsWith(`${f}/`)) return f;
    }
  }
  return null;
}

/** True for node core builtins (`node:` prefixed or bare core names). */
function isNodeBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  // The small set the blocking/artifact/ID modules actually use; we do not
  // need the full builtin list — anything not relative and not a builtin and
  // not forbidden is a (disallowed) third-party bare import we will report.
  const CORE = new Set([
    'fs',
    'path',
    'url',
    'http',
    'https',
    'net',
    'dns',
    'crypto',
    'os',
    'util',
    'stream',
    'events',
    'assert',
    'child_process',
    'process',
    'buffer',
    'zlib',
    'tls',
  ]);
  return CORE.has(spec);
}

/** A relative or absolute filesystem specifier (resolvable to a file). */
function isPathSpecifier(spec) {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('/') ||
    isAbsolute(spec)
  );
}

// Sentinel delimiter (NUL) — cannot appear in source, so a tokenized string
// can never be re-matched as code by the edge regexes.
const STR_OPEN = '\u0000S';
const STR_CLOSE = '\u0000';

/**
 * Tokenize source for edge discovery: drop line + block comments, and replace
 * every string / template literal with an OPAQUE sentinel that encodes its
 * value (`\0S<base64>\0`). The sentinel is a single atom — `import` / `require`
 * text *inside* a string can never be re-matched as a call site, while a
 * string in import/require argument position is still recoverable (the regex
 * matches the sentinel; {@link decodeSentinel} returns the original value).
 *
 * Template literals are tokenized too but only decode to a usable specifier
 * when they have NO `${}` substitution (a substituted template is a
 * non-literal ⇒ fail-closed via resolveDynamicArg). Hand-rolled scanner —
 * sufficient for ESM/CJS edge discovery in this dependency-free codebase.
 *
 * @param {string} src
 * @returns {string}
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      let body = '';
      let substituted = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') {
          body += (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (quote === '`' && ch === '$' && src[i + 1] === '{') {
          substituted = true; // template has interpolation → non-literal
          // consume to the matching } so the scanner stays in sync
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth === 0) break;
            i++;
          }
          i++;
          continue;
        }
        if (ch === quote) break;
        body += ch;
        i++;
      }
      i++; // consume the closing quote
      // Encode value; mark substituted templates so they decode to null.
      const payload = substituted
        ? `SUBST`
        : Buffer.from(body, 'utf8').toString('base64');
      out += STR_OPEN + payload + STR_CLOSE;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Sentinel pattern. `SENTINEL_RE` keeps a CAPTURING payload group so
// decodeSentinel() can read it from a standalone atom. `SENT_NC` is the
// NON-capturing form embedded inside composite regexes: composite patterns
// capture the WHOLE atom (one group) and hand it to decodeSentinel(), so the
// nested payload group never shifts the composite group indices.
const SENTINEL_RE = /\u0000S([A-Za-z0-9+/=]*|SUBST)\u0000/;
const SENT_NC = '\\u0000S(?:[A-Za-z0-9+/=]*|SUBST)\\u0000';

/**
 * Decode a sentinel back to its string value, or `null` if it was a
 * substituted template literal (a non-literal specifier — fail-closed).
 *
 * @param {string} token  a `\0S...\0` sentinel
 * @returns {string | null}
 */
function decodeSentinel(token) {
  if (typeof token !== 'string') return null;
  const m = token.match(SENTINEL_RE);
  if (!m) return null;
  if (m[1] === 'SUBST') return null;
  return Buffer.from(m[1], 'base64').toString('utf8');
}

/**
 * Find every `<callee>( ... )` call site and return its FULL argument text
 * using a balanced-paren scan, so a nested call inside the argument
 * (`import(resolve(__dirname, '<lit>'))`) is captured whole — a paren-naive
 * regex would truncate at the first inner `)`. Only matches `import` /
 * `require` used as a call (a preceding `.` would make it a member access,
 * which we skip). Operates on comment/string-stripped source.
 *
 * @param {string} code  comment/string-stripped source
 * @param {'import'|'require'} callee
 * @returns {Array<{ arg: string, raw: string }>}
 */
function findCallArgs(code, callee) {
  const out = [];
  const re = new RegExp(`\\b${callee}\\s*\\(`, 'g');
  for (let m; (m = re.exec(code)); ) {
    // Skip member access (`foo.import(` / `foo.require(`) — not the global.
    const prevNonWs = code.slice(0, m.index).trimEnd().slice(-1);
    if (prevNonWs === '.') continue;
    let i = m.index + m[0].length; // first char after the opening '('
    let depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      i++;
    }
    const arg = code.slice(start, i);
    out.push({ arg, raw: `${callee}(${arg})` });
    re.lastIndex = i; // continue scanning after this call
  }
  return out;
}

/**
 * Extract every import/require/dynamic-import edge from a module's source.
 *
 * Returns one record per edge:
 *   { kind: 'static'|'dynamic', specifier: string|null, raw: string }
 * `specifier === null` ⇒ a dynamic import/require whose argument is NOT a
 * provable static string (after the documented `resolve(__dirname,'<lit>')`
 * unwrap) — the fail-closed trigger.
 *
 * @param {string} src
 * @returns {Array<{ kind: string, specifier: string|null, raw: string }>}
 */
export function extractEdges(src) {
  const code = stripCommentsAndStrings(src);
  const edges = [];

  // After tokenizing, every string literal in `code` is an opaque sentinel
  // `\0S<base64>\0` — so `import`/`require` text *inside* a string is never
  // re-matched as a call site, while a string in specifier position is still
  // recoverable via decodeSentinel(). A substituted template decodes to null
  // (non-literal ⇒ fail-closed).
  const SENT = SENT_NC; // non-capturing atom; the composite wraps it once

  // 1. Static ESM: `import ... from <sent>`, `import <sent>`,
  //    `export ... from <sent>`. SENT is non-capturing so the ONLY groups
  //    are the two composite-level `(${SENT})` — alt1 → m[1], alt2 → m[2].
  const staticRe = new RegExp(
    `\\b(?:import|export)\\b[^;]*?\\bfrom\\s*(${SENT})|^\\s*import\\s*(${SENT})`,
    'gm',
  );
  for (let m; (m = staticRe.exec(code)); ) {
    const spec = decodeSentinel(m[1] || m[2]);
    if (spec) edges.push({ kind: 'static', specifier: spec, raw: m[0] });
  }

  // 2. CommonJS: `require(<sent>)`.
  const requireRe = new RegExp(`\\brequire\\s*\\(\\s*(${SENT})\\s*\\)`, 'g');
  for (let m; (m = requireRe.exec(code)); ) {
    const spec = decodeSentinel(m[1]);
    if (spec) edges.push({ kind: 'static', specifier: spec, raw: m[0] });
  }

  // 3. Dynamic import: `import( ... )`. The argument expression can itself
  //    contain nested parens (`import(resolve(__dirname, '<lit>'))`), so we
  //    extract it with a balanced-paren scan rather than a paren-naive regex
  //    (which would stop at the first inner `)`). The argument may then be a
  //    literal, the documented resolve(__dirname,'<lit>') unwrap, or a
  //    non-literal expression (⇒ null ⇒ fail-closed).
  for (const call of findCallArgs(code, 'import')) {
    edges.push({
      kind: 'dynamic',
      specifier: resolveDynamicArg(call.arg),
      raw: call.raw,
    });
  }

  // 4. Dynamic require: `require( <non-literal> )` (literal form caught in #2).
  const litReqRe = new RegExp(`^\\s*${SENT}\\s*$`);
  for (const call of findCallArgs(code, 'require')) {
    if (litReqRe.test(call.arg)) continue; // literal — already handled in #2
    edges.push({
      kind: 'dynamic',
      specifier: resolveDynamicArg(call.arg),
      raw: call.raw,
    });
  }

  return edges;
}

/**
 * Resolve a dynamic-import argument expression to a provable static specifier
 * string, or `null` if it cannot be proven.
 *
 * Provable forms:
 *   - a bare string literal:           `'x'` / `"x"`
 *   - the dispatcher unwrap:           `resolve(__dirname, '<literal>')`
 *     (node:path resolve over a literal path segment — cwd-independent, fully
 *      static; documented allowed exception, see file header + AC-17 note).
 *     We return the literal segment (still a relative-path specifier the
 *     walker resolves against the importing module's dir).
 *   - `new URL('<literal>', import.meta.url)` style — literal segment.
 *
 * Anything else (concatenation with a variable, a bare identifier, a call we
 * do not recognise, a substituted template) ⇒ null ⇒ fail-closed.
 *
 * Accepts EITHER a tokenized arg (sentinels, as produced inside
 * extractEdges) OR a raw-source arg with literal quotes (as the unit tests
 * pass it) — the raw form is tokenized first so both paths share one
 * matcher.
 *
 * @param {string} arg  the (raw or tokenized) text between import( ) parens
 * @returns {string | null}
 */
export function resolveDynamicArg(arg) {
  // Tokenize so a raw `'x'` becomes a sentinel; an already-tokenized arg is
  // unaffected (it contains no quote/comment chars to rewrite).
  const a = stripCommentsAndStrings(arg).trim();
  const SENT = SENT_NC; // non-capturing — composite wraps it once where needed

  // pure string literal
  let m = a.match(new RegExp(`^(${SENT})$`));
  if (m) return decodeSentinel(m[1]);

  // resolve(__dirname, '<lit>')  /  path.resolve(__dirname, '<lit>')
  m = a.match(
    new RegExp(`^(?:[\\w.]*\\.)?resolve\\s*\\(\\s*__dirname\\s*,\\s*(${SENT})\\s*\\)$`),
  );
  if (m) return decodeSentinel(m[1]);

  // join(__dirname, '<lit>')  /  path.join(__dirname, '<lit>')
  m = a.match(
    new RegExp(`^(?:[\\w.]*\\.)?join\\s*\\(\\s*__dirname\\s*,\\s*(${SENT})\\s*\\)$`),
  );
  if (m) return decodeSentinel(m[1]);

  // new URL('<lit>', import.meta.url)
  m = a.match(
    new RegExp(`^new\\s+URL\\s*\\(\\s*(${SENT})\\s*,\\s*import\\.meta\\.url\\s*\\)$`),
  );
  if (m) return decodeSentinel(m[1]);

  return null;
}

/**
 * Resolve a path/relative specifier to an absolute file, trying the explicit
 * path and the common ESM extensions / index forms this repo uses.
 *
 * @param {string} fromFile  absolute path of the importing module
 * @param {string} spec      a path specifier (relative or absolute)
 * @returns {string | null}  absolute resolved file, or null if unresolved
 */
function resolveFile(fromFile, spec) {
  const base = isAbsolute(spec) ? spec : resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.ts`,
    resolve(base, 'index.mjs'),
    resolve(base, 'index.js'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Walk the module graph from `roots`, returning the transitive closure plus a
 * verdict.
 *
 * @param {string[]} roots  absolute paths of root modules
 * @returns {{
 *   modules: string[],                // sorted absolute paths actually walked
 *   edges: Array<{ from: string, kind: string, specifier: string|null }>,
 *   violations: Array<{ from: string, reason: string, detail: string }>,
 *   clean: boolean,
 * }}
 */
export function walkImportGraph(roots) {
  const visited = new Set();
  const queue = [];
  const allEdges = [];
  const violations = [];

  for (const r of roots) {
    const abs = resolve(r);
    if (!visited.has(abs)) {
      visited.add(abs);
      queue.push(abs);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift();
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      violations.push({
        from: file,
        reason: 'unreadable-root-or-edge',
        detail: `cannot read module ${file}`,
      });
      continue;
    }

    const edges = extractEdges(src);
    for (const e of edges) {
      allEdges.push({ from: file, kind: e.kind, specifier: e.specifier });

      // Fail-closed: an unprovable dynamic edge in a reachable module means we
      // cannot bound the graph — the invariant cannot be proven ⇒ dirty.
      if (e.specifier === null) {
        violations.push({
          from: file,
          reason: 'unprovable-dynamic-import',
          detail: `dynamic import/require with a non-literal specifier: ${e.raw}`,
        });
        continue;
      }

      // Forbidden agent-SDK / model-client / network-client specifier.
      const hit = matchForbidden(e.specifier);
      if (hit) {
        violations.push({
          from: file,
          reason: 'forbidden-module',
          detail: `reachable import of forbidden module '${e.specifier}' (matched '${hit}')`,
        });
        continue;
      }

      // node: builtin → an allowed leaf, not traversed further.
      if (isNodeBuiltin(e.specifier)) continue;

      // A path specifier → resolve + recurse (the real graph walk).
      if (isPathSpecifier(e.specifier)) {
        const resolved = resolveFile(file, e.specifier);
        if (!resolved) {
          violations.push({
            from: file,
            reason: 'unresolved-path-import',
            detail: `cannot resolve reachable path import '${e.specifier}'`,
          });
          continue;
        }
        if (!visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
        continue;
      }

      // Anything else is a bare third-party package that is neither a node
      // builtin nor on the forbidden list. The blocking/artifact/ID set is
      // contractually zero-runtime-dep, so ANY third-party bare import here is
      // itself a violation (it could transitively reach a model client and we
      // cannot walk node_modules deterministically here — fail closed).
      violations.push({
        from: file,
        reason: 'unexpected-third-party-import',
        detail: `reachable bare third-party import '${e.specifier}' (blocking/artifact/ID set must be zero-runtime-dep)`,
      });
    }
  }

  const modules = [...visited].sort();
  return {
    modules,
    edges: allEdges,
    violations,
    clean: violations.length === 0,
  };
}

/**
 * The canonical AC-17 root set: the blocking-path entrypoint (`bin/planos`),
 * the exit hook, the schema modules, and the diff modules. Resolved relative
 * to this harness file so callers need not know the layout.
 *
 * `bin/planos` is included as the true entrypoint: its dispatcher dynamically
 * imports `enter.mjs`/`exit.mjs` via the documented `resolve(__dirname,'<lit>')`
 * unwrap, so the walk follows those edges as a real graph walk (not a grep).
 *
 * @returns {string[]} absolute root module paths
 */
export function ac17Roots() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, '../..');
  return [
    resolve(repo, 'plugin/bin/planos'),
    resolve(repo, 'src/hook/exit.mjs'),
    resolve(repo, 'src/schema/index.mjs'),
    resolve(repo, 'src/schema/validate.mjs'),
    resolve(repo, 'src/schema/fallback.mjs'),
    resolve(repo, 'src/schema/envelope.mjs'),
    resolve(repo, 'src/schema/id-strategy.mjs'),
    resolve(repo, 'src/diff/structural.mjs'),
    resolve(repo, 'src/diff/reanchor.mjs'),
  ];
}

// When run directly: print the transitive set + verdict (used by the AC-17
// test and for manual auditing — `node tests/harness/import-graph.mjs`).
if (
  import.meta.url ===
  (process.argv[1] ? pathToFileURL(process.argv[1]).href : '')
) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const rel = (p) => p.replace(`${repo}/`, '');
  const result = walkImportGraph(ac17Roots());
  process.stdout.write(
    'AC-17 import-graph walk — blocking / artifact / ID transitive set\n',
  );
  process.stdout.write('='.repeat(72) + '\n');
  process.stdout.write(`Roots:\n`);
  for (const r of ac17Roots()) process.stdout.write(`  - ${rel(r)}\n`);
  process.stdout.write(
    `\nTransitive module set (${result.modules.length} modules):\n`,
  );
  for (const m of result.modules) process.stdout.write(`  - ${rel(m)}\n`);
  process.stdout.write(`\nEdges walked: ${result.edges.length}\n`);
  if (result.violations.length > 0) {
    process.stdout.write(`\nVIOLATIONS (${result.violations.length}):\n`);
    for (const v of result.violations) {
      process.stdout.write(`  ✗ [${v.reason}] ${rel(v.from)}: ${v.detail}\n`);
    }
  }
  process.stdout.write(
    `\nVERDICT: ${
      result.clean
        ? 'CLEAN — no agent-SDK / model-client / unprovable-dynamic edge reachable'
        : 'DIRTY — AC-17 invariant NOT proven (see violations)'
    }\n`,
  );
  process.exit(result.clean ? 0 : 1);
}
