// tests/harness/live-driver.mjs
//
// US-010 / Step 1.2 / AC-18 — the LIVE agent driver, wired to a real `claude`
// invocation driving the REAL thin loop. This is the integration the Step 0.5
// scaffold intentionally left as an honest stub (see runner.mjs history).
//
// The real thin loop, faithfully (AC-18 — not a hand-built fixture loop):
//
//   1. EnterPlanMode  → run the REAL `node plugin/bin/planos enter` and take
//                        its emitted additionalContext verbatim (schema +
//                        worked example + the active strategy's ID rules).
//   2. author         → a REAL `claude -p` agent authors a v1 block document
//                        from that injected context + the fixture's realistic
//                        initialPrompt. The agent mints its OWN block ids.
//   3. ExitPlanMode   → the REAL src/hook/exit.mjs handleExit() processes the
//      (forced revise)  authored text exactly as in production (parse / degrade
//                        / server / buildDecision → buildReviseMessage with the
//                        (id,kind,title) echo table + canonical JSON). The only
//                        injected seams are the ones handleExit already exposes
//                        for tests: stdinText, a no-op openBrowser, and a
//                        decisionProvider that POSTs the forced /api/deny. That
//                        IS the "forced revise" the harness is defined to do.
//   4. revise         → the SAME agent session is resumed (`claude -p --resume
//                        <session_id>`) and fed the REAL deny.message. It
//                        re-emits the document.
//   5. ExitPlanMode   → (optional) a second handleExit() with /api/approve
//      (approve)        closes the loop end-to-end.
//
// ── Mechanical ID-preservation denominator for LIVE runs (AC-12 spirit) ──
// Canned group (ii) uses the fixture's FROZEN expectedPreservedIds (frozen at
// fixture-design time). That set cannot apply to a live run: the live agent
// authors its OWN ids, not the fixture's canned ids. The judgment-free live
// denominator is the set of ids the agent minted in its AUTHOR document,
// captured BEFORE the forced revise (frozen at author time, never recomputed,
// zero runtime human judgment):
//
//     liveIdPreservation = |authorIds ∩ revisedIds| / |authorIds|
//
// To make "every author id should survive" a well-defined, judgment-free
// expectation, the forced-revise feedback explicitly asks for a STRUCTURE- and
// ID-preserving revision (tighten wording; do NOT add/drop blocks; reuse every
// id from the echo table). This is precisely the §6 falsifier: does the
// nondeterministic agent renumber/re-mint ids when it regenerates the whole
// document across a revision? Pure set-intersection, frozen at author time.
//
// Zero offline-suite cost: the agent call is injectable. The real `claude`
// path is only taken by tests/harness/run-live.mjs (out-of-band, billed). The
// offline unit suite injects a deterministic fake agent.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateDocument } from '../../src/schema/index.mjs';
import { idPreservationRate } from './metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN_PLANOS = resolve(REPO_ROOT, 'plugin', 'bin', 'planos');
const EXIT_MOD_URL = `file://${resolve(REPO_ROOT, 'src', 'hook', 'exit.mjs')}`;

// ---------------------------------------------------------------------------
// Low-level: spawn a process, collect stdio (zero deps, no shell).
// ---------------------------------------------------------------------------

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string,string>, cwd?: string,
 *           timeoutMs?: number }} [opts]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
function exec(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd,
    });
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* best-effort */
        }
        rej(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      rej(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      res({ code, stdout, stderr });
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// 1. Real EnterPlanMode injection (the actual hook output, verbatim).
// ---------------------------------------------------------------------------

/**
 * Run the REAL `bin/planos enter` under the given ID strategy and return the
 * emitted additionalContext string (schema + worked example + ID rules).
 *
 * @param {string} [strategy]  PLANOS_ID_STRATEGY (semantic-slug | opaque)
 * @returns {Promise<string>}
 */
export async function getEnterContext(strategy) {
  const env = strategy ? { PLANOS_ID_STRATEGY: strategy } : {};
  const { code, stdout, stderr } = await exec(
    process.execPath,
    [BIN_PLANOS, 'enter'],
    { env, timeoutMs: 15000 },
  );
  if (code !== 0)
    throw new Error(`bin/planos enter failed (code ${code}): ${stderr}`);
  const j = JSON.parse(stdout.trim());
  const ctx = j?.hookSpecificOutput?.additionalContext;
  if (typeof ctx !== 'string' || ctx.length === 0)
    throw new Error('enter produced no additionalContext');
  return ctx;
}

// ---------------------------------------------------------------------------
// 2. Real ExitPlanMode round-trip via the production handleExit() (child
//    process, mirroring tests/exit-thinloop.test.mjs runScriptedExit).
// ---------------------------------------------------------------------------

/**
 * Drive the REAL src/hook/exit.mjs handleExit() in a child process with the
 * given plan text as tool_input.plan and a scripted decision (deny→forced
 * revise, or approve). Returns the decision object the hook emitted on stdout
 * (the REAL PermissionRequest output: deny.message carries the directive +
 * (id,kind,title) echo table + canonical JSON, exactly as in production).
 *
 * @param {string} planText  Raw agent author/revise text → tool_input.plan
 * @param {'deny'|'approve'} kind
 * @param {string} [strategy]
 * @returns {Promise<{ behavior: string, message?: string }>}
 */
async function runRealExit(planText, kind, strategy) {
  const hookStdin = JSON.stringify({ tool_input: { plan: planText } });
  const denyFeedback =
    'Forced revise for the Phase-1 ID-stability eval. Re-emit the FULL v1 ' +
    'block document. Tighten wording only — do NOT add, remove, split, or ' +
    'merge blocks, and do NOT change the plan. REUSE every id from the ' +
    '(id, kind, title) table verbatim for every block (its intent is ' +
    'unchanged). Output ONLY the raw JSON document, no markdown fences.';
  const childScript = `
import http from 'node:http';
import { handleExit } from ${JSON.stringify(EXIT_MOD_URL)};
await handleExit({
  stdinText: ${JSON.stringify(hookStdin)},
  openBrowser: () => {},
  decisionProvider: ({ url }) => {
    const port = Number(new URL(url).port);
    const path = ${JSON.stringify(kind === 'approve' ? '/api/approve' : '/api/deny')};
    const payload = ${
      kind === 'approve'
        ? "{ source: 'planos-live-eval' }"
        : `{ feedback: ${JSON.stringify(denyFeedback)} }`
    };
    const body = JSON.stringify(payload);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(body) } },
      (r) => { r.resume(); },
    );
    req.end(body);
  },
});
`.trim();
  const env = strategy ? { PLANOS_ID_STRATEGY: strategy } : {};
  const { code, stdout, stderr } = await exec(
    process.execPath,
    ['--input-type=module'],
    { input: childScript, env, timeoutMs: 30000 },
  );
  if (code !== 0)
    throw new Error(`handleExit child failed (code ${code}): ${stderr}`);
  const parsed = JSON.parse(stdout.trim());
  const decision = parsed?.hookSpecificOutput?.decision;
  if (!decision || typeof decision.behavior !== 'string')
    throw new Error('handleExit produced no decision');
  return decision;
}

/**
 * Forced-revise (deny) round-trip → the REAL deny.message the agent receives.
 * @param {string} planText
 * @param {string} [strategy]
 * @returns {Promise<string>} the deny.message
 */
export async function exitForcedRevise(planText, strategy) {
  const d = await runRealExit(planText, 'deny', strategy);
  if (d.behavior !== 'deny' || typeof d.message !== 'string')
    throw new Error(`expected deny+message, got ${JSON.stringify(d.behavior)}`);
  return d.message;
}

/**
 * Approve round-trip → closes the loop end-to-end (behavior:"allow").
 * @param {string} planText
 * @param {string} [strategy]
 * @returns {Promise<{ behavior: string }>}
 */
export async function exitApprove(planText, strategy) {
  return runRealExit(planText, 'approve', strategy);
}

// ---------------------------------------------------------------------------
// 3. Real agent — `claude -p ... --output-format json` (+ session resume).
// ---------------------------------------------------------------------------

let CLEAN_CWD = null;
/** A throwaway cwd so the agent does not inherit this repo's plugin/CLAUDE.md
 *  (the user-global ~/.claude/CLAUDE.md still applies — that is the real agent
 *  environment, which is faithful to a real EnterPlanMode authoring). */
async function cleanCwd() {
  if (!CLEAN_CWD) CLEAN_CWD = await mkdtemp(join_(tmpdir(), 'planos-live-'));
  return CLEAN_CWD;
}
function join_(a, b) {
  return a.endsWith('/') ? a + b : `${a}/${b}`;
}

/**
 * Default real agent: one `claude -p` turn (optionally resuming a session).
 *
 * @param {string} prompt
 * @param {{ resume?: string }} [opts]
 * @returns {Promise<{ text: string, sessionId: string }>}
 */
export async function claudeAgent(prompt, opts = {}) {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (opts.resume) args.push('--resume', opts.resume);
  const cwd = await cleanCwd();
  const { code, stdout, stderr } = await exec('claude', args, {
    cwd,
    timeoutMs: 240000,
  });
  if (code !== 0)
    throw new Error(
      `claude -p failed (code ${code}): ${stderr.slice(0, 800)}`,
    );
  let j;
  try {
    j = JSON.parse(stdout.trim());
  } catch {
    // --output-format json should always be JSON; if not, treat raw as text.
    return { text: stdout.trim(), sessionId: opts.resume || '' };
  }
  return {
    text: typeof j.result === 'string' ? j.result : '',
    sessionId: typeof j.session_id === 'string' ? j.session_id : '',
  };
}

// ---------------------------------------------------------------------------
// Parse helper — raw agent text → { ok, doc }. Tolerates an accidental
// ```json fence (the agent is instructed not to use one, but a real agent
// occasionally does; the REAL exit path would degrade it — we only use this
// for the post-hoc id measurement, never to "fix" what the loop saw).
// ---------------------------------------------------------------------------

/**
 * @param {string} raw
 * @returns {{ ok: boolean, ids: string[] }}
 */
function docIds(raw) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let obj = tryParse(raw);
  if (obj === undefined) {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) obj = tryParse(m[1].trim());
  }
  if (obj === undefined) {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) obj = tryParse(raw.slice(a, b + 1));
  }
  if (obj === undefined) return { ok: false, ids: [] };
  let v;
  try {
    v = validateDocument(obj);
  } catch {
    return { ok: false, ids: [] };
  }
  if (!v || !v.ok) return { ok: false, ids: [] };
  const ids = Array.isArray(v.doc.blocks)
    ? v.doc.blocks.map((bl) => bl.id).filter((x) => typeof x === 'string')
    : [];
  return { ok: true, ids };
}

// ---------------------------------------------------------------------------
// The live forced-revise loop for ONE fixture, ONE strategy.
// ---------------------------------------------------------------------------

/**
 * Run the real thin loop live for one fixture under one ID strategy.
 *
 * @param {{ name: string, initialPrompt: string }} fixture
 * @param {{ strategy?: string,
 *           agent?: (p: string, o?: {resume?: string}) =>
 *             Promise<{ text: string, sessionId: string }>,
 *           approve?: boolean }} [opts]
 * @returns {Promise<{
 *   name: string, strategy: string,
 *   idResult: { rate: number, intersection: number, denominator: number },
 *   convergedWithin2: boolean, degraded: boolean, valid: boolean,
 *   firstTryValid: boolean, authorIds: string[], revisedIds: string[],
 *   error?: string
 * }>}
 */
export async function runLiveFixture(fixture, opts = {}) {
  const strategy = opts.strategy || 'semantic-slug';
  const agent = opts.agent || claudeAgent;
  const base = {
    name: fixture.name,
    strategy,
    idResult: { rate: 0, intersection: 0, denominator: 0 },
    convergedWithin2: false,
    degraded: true,
    valid: false,
    firstTryValid: false,
    authorIds: [],
    revisedIds: [],
  };
  try {
    // 1. real EnterPlanMode injected context
    const enterCtx = await getEnterContext(strategy);

    // 2. author (real agent, agent mints its own ids)
    const authorPrompt =
      `${enterCtx}\n\n` +
      `---\n\n# Planning request\n\n${fixture.initialPrompt}\n\n` +
      `Author the plan now as a v1 block document. Respond with ONLY the ` +
      `raw JSON document — no markdown fences, no commentary.`;
    const a1 = await agent(authorPrompt, {});
    const authored = docIds(a1.text);
    base.firstTryValid = authored.ok;
    base.authorIds = authored.ids;

    // 3. real ExitPlanMode forced revise → the REAL deny.message
    const denyMessage = await exitForcedRevise(a1.text, strategy);

    // 4. revise — same session resumed, fed the REAL deny.message
    const a2 = await agent(denyMessage, { resume: a1.sessionId });
    const revised = docIds(a2.text);
    base.revisedIds = revised.ids;
    base.valid = revised.ok;
    // Convergence: a valid doc reached within ≤2 iterations (author + 1 revise)
    base.convergedWithin2 = revised.ok;
    base.degraded = !authored.ok || !revised.ok;

    // 5. (optional) approve to close the loop end-to-end
    if (opts.approve && revised.ok) {
      await exitApprove(a2.text, strategy);
    }

    // ── mechanical, judgment-free, frozen-at-author-time denominator ──
    // expected = ids the agent minted at author time (frozen before revise).
    // preserved = those that survived into the revised doc.
    const authorIds = authored.ok ? authored.ids : [];
    const revisedSet = new Set(revised.ok ? revised.ids : []);
    const preserved = authorIds.filter((id) => revisedSet.has(id));
    base.idResult = idPreservationRate(preserved, authorIds);
    return base;
  } catch (err) {
    base.error = err && err.message ? err.message : String(err);
    return base;
  }
}
