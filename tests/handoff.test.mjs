/**
 * planos — AC-16 crystallized-intent → block-authoring HANDOFF fixture
 * (plain Node, zero dependencies).
 *
 * Contract: consensus plan AC-16, Step 4.2 ("Crystallized-intent → block
 * authoring handoff"); docs/design.md §4, §5; spec
 * .omc/specs/deep-interview-planos-phase1.md;
 * plugin/commands/planos-plan.md (Phase 1 → Phase 2);
 * docs/notes/planos-plan-command.md; docs/notes/ac17-invariant.md.
 *
 * WHAT THIS PROVES (and what it deliberately does NOT)
 * ----------------------------------------------------
 * Real Phase-2 authoring is the LIVE AGENT's job — the agent reads the
 * crystallized summary + the EnterPlanMode-injected v1 schema and emits the
 * JSON block document. That live run is the user's Milestone-1 / -5 gate
 * (consensus plan AC-19(iii), Steps 5.2–5.3) and is intentionally NOT
 * automated here. This is the CANNED / OFFLINE portion of AC-16: it asserts
 * the HANDOFF CONTRACT deterministically, with no model in the loop:
 *
 *   1. The handoff INPUT is well-formed: a realistic Crystallized Intent
 *      Summary in the EXACT `/planos-plan` Phase-1 format, AND the
 *      EnterPlanMode hook actually injects the full v1 schema + worked
 *      example + ID-preservation rules the agent authors against.
 *   2. The handoff OUTPUT contract holds: a REPRESENTATIVE authored document
 *      (the canned stand-in for what the live agent would emit from this exact
 *      summary) is schema-valid via `src/schema` validateDocument, and every
 *      summary section maps onto the documented block kinds
 *      (GOAL→objective, DELIVERABLE→section+task, CONSTRAINT→prose,
 *       OPEN QUESTION→openQuestion).
 *   3. The DEGRADE path is reachable: if the interview was interrupted
 *      (empty / partial summary), the documented blocking path still yields a
 *      schema-valid document (exactly one prose block, meta.degraded=true) so
 *      the EnterPlanMode→ExitPlanMode→browser loop stays reachable — it
 *      degrades, it never crashes, it never blocks.
 *
 * Run: node tests/handoff.test.mjs
 * No network access required. No external dependencies.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateDocument } from '../src/schema/index.mjs';
import { handleEnter } from '../src/hook/enter.mjs';
import { planToDocument } from '../src/hook/exit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTER_MOD = join(__dirname, '../src/hook/enter.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => {
          passed++;
          console.log(`  PASS  ${name}`);
        },
        (err) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err && err.message ? err.message : String(err)}`);
        },
      );
    }
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err && err.message ? err.message : String(err)}`);
  }
  return undefined;
}

// ===========================================================================
// THE CANNED HANDOFF INPUT — a realistic Crystallized Intent Summary in the
// EXACT format `/planos-plan` Phase 1 produces (see the "Interview closure
// trigger" template in plugin/commands/planos-plan.md). This is what the live
// agent would carry into Phase 2 authoring. It is a plausible end-user
// planning request (≥3 distinct deliverables), not a synthetic minimal stub.
// ===========================================================================

const CRYSTALLIZED_SUMMARY = `\
=== CRYSTALLIZED INTENT SUMMARY ===

GOAL
Replace the legacy cookie-session auth with stateless JWT auth so the API tier
can scale horizontally behind the load balancer without sticky sessions.

KEY CONSTRAINTS / NON-GOALS
- Zero-downtime cutover — no maintenance window is acceptable.
- Do NOT change the public login/logout HTTP contract in this phase.
- Refresh-token rotation is explicitly out of scope for this phase.

MAIN DELIVERABLES
- Dual-write session layer behind a feature flag (old store + new JWT).
- JWT issuance + verification middleware with key rotation support.
- Cutover runbook + dashboards to watch error rate and p99 latency.

OPEN QUESTIONS (unresolved, require human input in the plan)
- Do we keep the legacy session endpoint for one release cycle as a fallback?

ASSUMPTIONS LOCKED IN
- The current load balancer can be reconfigured to drop session affinity.
===`;

/**
 * The REPRESENTATIVE authored document: the canned stand-in for what the live
 * agent would emit from CRYSTALLIZED_SUMMARY when it follows the Phase-2
 * authoring instructions in plugin/commands/planos-plan.md. Hand-authored to
 * the documented mapping so the handoff CONTRACT (summary section → block
 * kind) can be asserted offline. NOT a model output — the live emission is the
 * user's Milestone-1/5 gate.
 */
const REPRESENTATIVE_AUTHORED_DOC = {
  schemaVersion: 1,
  type: 'plan',
  id: 'jwt-auth-migration-2026-05-16',
  title: 'Stateless JWT Auth Migration',
  meta: {
    branch: 'feat/jwt-auth',
    status: 'draft',
    createdAt: '2026-05-16T12:00:00.000Z',
    revision: 1,
  },
  blocks: [
    // GOAL → one objective block (success criteria from the interview).
    {
      id: 'obj-jwt-migration',
      kind: 'objective',
      text: 'Replace cookie-session auth with stateless JWT so the API tier scales horizontally without sticky sessions.',
      successCriteria: [
        'No 5xx spike during cutover',
        'p99 latency stays under 200 ms during and after cutover',
        'Session affinity removed from the load balancer',
      ],
    },
    // Constraints / non-goals → prose under a Constraints section.
    { id: 's-constraints', kind: 'section', title: 'Constraints & Non-Goals', level: 1 },
    {
      id: 'p-constraints',
      kind: 'prose',
      md: 'Zero-downtime cutover (no maintenance window). The public login/logout HTTP contract is unchanged this phase. Refresh-token rotation is out of scope this phase.',
    },
    // Each MAIN DELIVERABLE → a section + task.
    { id: 's-deliverables', kind: 'section', title: 'Deliverables', level: 1 },
    {
      id: 't-dual-write',
      kind: 'task',
      title: 'Dual-write session layer behind a feature flag',
      detail: 'Write to both the legacy store and the new JWT path behind a flag for safe rollback.',
      status: 'todo',
      deps: [],
      acceptance: ['Both paths consistent under load test', 'Flag flips with zero downtime'],
      estimate: '3d',
    },
    {
      id: 't-jwt-middleware',
      kind: 'task',
      title: 'JWT issuance + verification middleware with key rotation',
      status: 'todo',
      deps: ['t-dual-write'],
      acceptance: ['Tokens verified with rotated keys', 'Clock-skew tolerance covered by tests'],
      estimate: '2d',
    },
    {
      id: 't-cutover-runbook',
      kind: 'task',
      title: 'Cutover runbook + error-rate / p99 dashboards',
      status: 'todo',
      deps: ['t-jwt-middleware'],
      acceptance: ['Runbook peer-reviewed', 'Dashboards alert on error-rate and p99 regression'],
      estimate: '1d',
    },
    // A material design choice surfaced during the interview → decision.
    {
      id: 'dec-token-format',
      kind: 'decision',
      question: 'Which token format do we issue?',
      options: [
        { label: 'JWT', pros: ['stateless', 'standard'], cons: ['revocation complexity'] },
        { label: 'opaque', pros: ['easy revocation'], cons: ['requires DB lookup'] },
      ],
      chosen: 'JWT',
      rationale: 'Stateless scaling is the primary objective; revocation handled via short TTL.',
    },
    // A material risk surfaced during the interview → risk.
    {
      id: 'risk-cutover-stampede',
      kind: 'risk',
      description: 'Cache/auth stampede when affinity is dropped at cutover.',
      likelihood: 'M',
      impact: 'H',
      mitigation: 'Request coalescing + key/cache warmup before shifting traffic.',
    },
    // Each OPEN QUESTION → an openQuestion block (answer left for the UI).
    {
      id: 'q-legacy-endpoint',
      kind: 'openQuestion',
      question: 'Do we keep the legacy session endpoint for one release cycle as a fallback?',
    },
  ],
};

/**
 * Parse the canned summary's labelled sections into structured arrays so the
 * handoff mapping (summary section → block kind) is asserted from the ACTUAL
 * summary text, not hard-coded twice.
 *
 * @param {string} summary
 * @returns {{ goal: string, constraints: string[], deliverables: string[], openQuestions: string[], assumptions: string[] }}
 */
function parseSummary(summary) {
  const section = (label, next) => {
    const re = new RegExp(`${label}\\n([\\s\\S]*?)\\n(?:${next}|===)`, 'm');
    const m = summary.match(re);
    return m ? m[1].trim() : '';
  };
  const bullets = (block) =>
    block
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter((l) => l.length > 0);
  return {
    goal: section('GOAL', 'KEY CONSTRAINTS / NON-GOALS').replace(/\s+/g, ' ').trim(),
    constraints: bullets(section('KEY CONSTRAINTS / NON-GOALS', 'MAIN DELIVERABLES')),
    deliverables: bullets(section('MAIN DELIVERABLES', 'OPEN QUESTIONS')),
    openQuestions: bullets(
      section('OPEN QUESTIONS \\(unresolved, require human input in the plan\\)', 'ASSUMPTIONS LOCKED IN'),
    ),
    assumptions: bullets(section('ASSUMPTIONS LOCKED IN', '===')),
  };
}

// ===========================================================================
// 1. The handoff INPUT is well-formed.
// ===========================================================================

await test('handoff input: the canned summary is in the exact /planos-plan Phase-1 format', () => {
  assert.ok(
    CRYSTALLIZED_SUMMARY.startsWith('=== CRYSTALLIZED INTENT SUMMARY ==='),
    'summary uses the documented header',
  );
  for (const label of [
    'GOAL',
    'KEY CONSTRAINTS / NON-GOALS',
    'MAIN DELIVERABLES',
    'OPEN QUESTIONS',
    'ASSUMPTIONS LOCKED IN',
  ]) {
    assert.ok(CRYSTALLIZED_SUMMARY.includes(label), `summary has the '${label}' section`);
  }
  const parsed = parseSummary(CRYSTALLIZED_SUMMARY);
  assert.ok(parsed.goal.length > 0, 'GOAL is non-empty');
  assert.ok(
    parsed.deliverables.length >= 3,
    `realistic request: ≥3 deliverables (got ${parsed.deliverables.length})`,
  );
  assert.ok(parsed.openQuestions.length >= 1, 'at least one open question carried into the plan');
});

await test('handoff input: EnterPlanMode injects the v1 schema + worked example + ID rules the agent authors against', async () => {
  // The agent authors Phase-2 against the schema injected by `bin/planos
  // enter`. Capture that injected additionalContext and assert it carries the
  // full handoff contract (schema + example + ID-preservation rules).
  const origWrite = process.stdout.write;
  const origExit = process.exit;
  let out = '';
  process.stdout.write = function spy(chunk, enc, cb) {
    out += typeof chunk === 'string' ? chunk : chunk.toString();
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };
  process.exit = () => {};
  try {
    await handleEnter();
  } finally {
    process.stdout.write = origWrite;
    process.exit = origExit;
  }
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.ok(typeof ctx === 'string' && ctx.length > 0, 'additionalContext present');
  assert.ok(ctx.includes('v1 Block Schema'), 'injects the v1 schema summary');
  assert.ok(ctx.includes('Worked Example'), 'injects a worked example doc');
  assert.ok(/section|prose|objective|task|decision|risk|openQuestion/.test(ctx), 'lists v1 kinds');
  assert.ok(/REUSE|preserv|NEVER renumber/i.test(ctx), 'injects the ID-preservation rules');
});

// ===========================================================================
// 2. The handoff OUTPUT contract holds — the representative authored doc is
//    schema-valid AND every summary section maps onto the documented kinds.
// ===========================================================================

await test('handoff output: representative authored doc validates via src/schema validateDocument', () => {
  const result = validateDocument(REPRESENTATIVE_AUTHORED_DOC);
  assert.equal(
    result.ok,
    true,
    `authored doc must be schema-valid; errors: ${result.ok ? '' : result.errors.join(' | ')}`,
  );
  assert.equal(result.doc.meta.degraded, undefined, 'a real authored doc is NOT degraded');
});

await test('handoff output: the doc round-trips through the documented blocking path (planToDocument)', () => {
  // The agent emits the JSON as tool_input.plan; the blocking exit path turns
  // it into the canonical doc. A valid authored doc must pass through
  // UNCHANGED (no degrade) — that is the contract the loop depends on.
  const doc = planToDocument(JSON.stringify(REPRESENTATIVE_AUTHORED_DOC));
  assert.deepEqual(doc, REPRESENTATIVE_AUTHORED_DOC, 'valid authored doc passes through unchanged');
  assert.equal(doc.meta.degraded, undefined, 'not degraded');
});

await test('handoff output: every summary section maps onto the documented block kinds', () => {
  const parsed = parseSummary(CRYSTALLIZED_SUMMARY);
  const kinds = REPRESENTATIVE_AUTHORED_DOC.blocks.map((b) => b.kind);

  // GOAL → exactly one objective block.
  const objectives = REPRESENTATIVE_AUTHORED_DOC.blocks.filter((b) => b.kind === 'objective');
  assert.equal(objectives.length, 1, 'GOAL → exactly one objective block');
  assert.ok(objectives[0].successCriteria.length >= 1, 'objective carries success criteria');

  // Each MAIN DELIVERABLE → at least one task block (≥ deliverable count).
  const tasks = REPRESENTATIVE_AUTHORED_DOC.blocks.filter((b) => b.kind === 'task');
  assert.ok(
    tasks.length >= parsed.deliverables.length,
    `≥1 task per deliverable (deliverables=${parsed.deliverables.length}, tasks=${tasks.length})`,
  );

  // KEY CONSTRAINTS / NON-GOALS → at least one prose block.
  assert.ok(kinds.includes('prose'), 'constraints → at least one prose block');

  // Each OPEN QUESTION → an openQuestion block.
  const oq = REPRESENTATIVE_AUTHORED_DOC.blocks.filter((b) => b.kind === 'openQuestion');
  assert.ok(
    oq.length >= parsed.openQuestions.length,
    `≥1 openQuestion per unresolved question (oq=${oq.length}, summary=${parsed.openQuestions.length})`,
  );
  // The unresolved interview question is carried verbatim into an openQuestion.
  assert.ok(
    oq.some((b) => b.question.includes('legacy session endpoint')),
    'the summary open question is carried into an openQuestion block',
  );

  // Sections group the content (documented "group blocks logically").
  assert.ok(kinds.includes('section'), 'sections group the document');
});

// ===========================================================================
// 3. The DEGRADE path is reachable — interrupted / empty interview still
//    yields a schema-valid document and a reachable loop (never crashes).
// ===========================================================================

/**
 * The reduced-clarity summary `/planos-plan` synthesizes on a graceful
 * interruption (see "Graceful interruption / early-exit" template in
 * plugin/commands/planos-plan.md). Minimal, but still the documented shape.
 */
const INTERRUPTED_SUMMARY = `\
=== CRYSTALLIZED INTENT SUMMARY (reduced clarity — interview cut short) ===

GOAL
Not yet stated — see openQuestion block

KEY CONSTRAINTS / NON-GOALS
- None established

MAIN DELIVERABLES
- None established — to be filled in the browser UI

OPEN QUESTIONS (unresolved, require human input in the plan)
- What are we actually trying to build here?

ASSUMPTIONS LOCKED IN
- None
===`;

for (const [label, input] of [
  ['empty interview (nothing gathered)', ''],
  ['interrupted interview (reduced-clarity summary, no JSON authored)', INTERRUPTED_SUMMARY],
  ['partial / non-JSON authoring attempt', '# Migrate auth\n\nWe started but the agent never emitted JSON.'],
]) {
  await test(`degrade reachable: ${label} → schema-valid degraded doc, loop still reachable`, () => {
    // If Phase-2 authoring never produced valid JSON (interview interrupted,
    // agent emitted prose, or nothing), the documented blocking path degrades
    // it deterministically — exactly one prose block, meta.degraded=true — so
    // the EnterPlanMode→ExitPlanMode→browser loop is STILL reachable.
    const doc = planToDocument(input, {
      id: 'handoff-degraded-fixed',
      createdAt: '2026-05-16T00:00:00.000Z',
    });
    const result = validateDocument(doc);
    assert.equal(
      result.ok,
      true,
      `degraded doc must STILL be schema-valid; errors: ${result.ok ? '' : result.errors.join(' | ')}`,
    );
    assert.equal(doc.meta.degraded, true, 'degraded flag set (recovery surface signaled)');
    assert.equal(doc.blocks.length, 1, 'exactly one block');
    assert.equal(doc.blocks[0].kind, 'prose', 'the single block is prose');
    assert.equal(doc.meta.revision, 1, 'degraded doc is revision 1');
    // "Loop still reachable" = a valid document the browser review loop can
    // render; never an exception, never a block, never an empty doc.
    assert.ok(doc.title.length > 0, 'degraded doc still has a title (renderable)');
  });
}

// ===========================================================================
// 4. End-to-end (canned, offline): the documented handoff carried through the
//    real `bin/planos enter` child + the blocking authoring path. enter
//    injects the schema; the canned authored doc (what the live agent would
//    emit from the summary) validates as the artifact. The live emission
//    itself is the user's Milestone-1/5 gate — explicitly NOT run here.
// ===========================================================================

await test('handoff e2e (canned): bin/planos enter injects schema → canned authored doc is a valid artifact', async () => {
  const enterOut = await new Promise((res) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(
      `import { handleEnter } from '${ENTER_MOD}';\nawait handleEnter();\n`,
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => res({ stdout, stderr, code }));
  });

  assert.equal(enterOut.code, 0, `enter exits 0 (stderr: ${enterOut.stderr})`);
  const enterParsed = JSON.parse(enterOut.stdout.trim());
  const ctx = enterParsed.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('v1 Block Schema'), 'enter child injected the schema the agent authors against');

  // The agent (live, deferred) would now read CRYSTALLIZED_SUMMARY + ctx and
  // emit JSON. We assert the CANNED stand-in for that emission is a valid v1
  // artifact — closing the offline half of the handoff contract.
  const artifact = planToDocument(JSON.stringify(REPRESENTATIVE_AUTHORED_DOC));
  const v = validateDocument(artifact);
  assert.equal(v.ok, true, 'the handed-off authored doc is a schema-valid artifact');
  assert.equal(artifact.id, REPRESENTATIVE_AUTHORED_DOC.id, 'document id preserved through the handoff');
  console.log('        NOTE: live interview→author emission is the user\'s Milestone-1/5 gate (deferred).');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`AC-16 handoff fixture (US-021 / Step 4.2): ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
