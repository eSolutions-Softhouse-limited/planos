// tests/coexistence.test.mjs
//
// US-006 decided posture — the plannotator coexistence detect-and-refuse
// guard. Pure local-fs detection (AC-17 safe) + the handleExit refusal wiring.
// Offline; no model, no network, no real browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  detectCollidingExitPlanModePlugins,
  coexistenceGuard,
  coexistenceRefusalMessage,
} from '../src/hook/coexistence.mjs';
import { handleExit } from '../src/hook/exit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SPIKE = resolve(REPO, 'tests', 'spike');

test('detects sibling plugins that also hook ExitPlanMode', () => {
  // pluginRoot is a (notional) planos dir whose siblings are the two spike
  // stub plugins, both declaring a PermissionRequest ExitPlanMode matcher.
  const colliding = detectCollidingExitPlanModePlugins({
    pluginRoot: join(SPIKE, 'planos'),
    env: {},
  });
  assert.deepEqual(
    [...colliding].sort(),
    ['plannotator-stub-a', 'plannotator-stub-b'],
    'both spike stubs detected as colliding',
  );
});

test('no collision in a clean single-plugin env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planos-clean-'));
  await mkdir(join(root, 'planos', '.claude-plugin'), { recursive: true });
  await writeFile(
    join(root, 'planos', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'planos' }),
  );
  const colliding = detectCollidingExitPlanModePlugins({
    pluginRoot: join(root, 'planos'),
    env: {},
  });
  assert.deepEqual(colliding, [], 'no siblings → no collision');
});

test('missing/unresolvable plugin root → no collision (never spuriously block)', () => {
  assert.deepEqual(
    detectCollidingExitPlanModePlugins({ env: {}, pluginRoot: '' }),
    [],
  );
  assert.deepEqual(
    detectCollidingExitPlanModePlugins({
      env: {},
      pluginRoot: '/nonexistent/x/planos',
    }),
    [],
  );
});

test('PLANOS_ALLOW_COEXIST=1 disables the guard', () => {
  const colliding = coexistenceGuard({
    pluginRoot: join(SPIKE, 'planos'),
    env: { PLANOS_ALLOW_COEXIST: '1' },
  });
  assert.deepEqual(colliding, [], 'escape hatch bypasses detection');
});

test('refusal message names the colliding plugins + the escape hatch', () => {
  const msg = coexistenceRefusalMessage(['plannotator']);
  assert.ok(msg.includes('REFUSING TO RUN'));
  assert.ok(msg.includes('plannotator'));
  assert.ok(msg.includes('PLANOS_ALLOW_COEXIST=1'));
});

test('handleExit (production path) REFUSES on collision — no server boot', async () => {
  let refusedWith = null;
  let serverBooted = false;
  await handleExit({
    stdinText: JSON.stringify({ tool_input: { plan: '{}' } }),
    openBrowser: () => {
      serverBooted = true;
    },
    coexistenceGuard: () => ['plannotator'],
    onRefuse: (msg, colliding) => {
      refusedWith = { msg, colliding };
    },
  });
  assert.ok(refusedWith, 'onRefuse invoked');
  assert.deepEqual(refusedWith.colliding, ['plannotator']);
  assert.ok(refusedWith.msg.includes('REFUSING TO RUN'));
  assert.equal(serverBooted, false, 'server/browser NOT booted on refusal');
});

test('scripted mode opts out of the guard entirely (clean-env gate/tests unaffected)', async () => {
  // Scripted handleExit calls finish()→process.exit(0). Stub process.exit so
  // it does not kill this runner (the established pattern — see
  // tests/exit-thinloop.test.mjs). Assert the injected guard spy is NEVER
  // consulted when a decisionProvider is present (the `if (!scripted)` gate).
  const realExit = process.exit;
  let exitCode = null;
  // @ts-ignore - test stub
  process.exit = (c) => {
    exitCode = c;
    throw new Error('__stubbed_exit__');
  };
  let guardConsulted = false;
  try {
    await handleExit({
      stdinText: JSON.stringify({ tool_input: { plan: '{}' } }),
      openBrowser: () => {},
      decisionProvider: ({ url }) => {
        const u = new URL(url);
        import('node:http').then(({ default: http }) => {
          const body = JSON.stringify({ source: 'coexist-scripted' });
          const req = http.request(
            {
              host: '127.0.0.1',
              port: Number(u.port),
              path: '/api/approve',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
            },
            (r) => r.resume(),
          );
          req.end(body);
        });
      },
      coexistenceGuard: () => {
        guardConsulted = true;
        return ['should-not-be-consulted'];
      },
      onRefuse: () => {
        guardConsulted = true;
      },
    });
  } catch (e) {
    if (!/__stubbed_exit__/.test(String(e && e.message))) throw e;
  } finally {
    process.exit = realExit;
  }
  assert.equal(guardConsulted, false, 'guard skipped in scripted mode');
  assert.equal(exitCode, 0, 'scripted path still finishes with exit 0');
});
