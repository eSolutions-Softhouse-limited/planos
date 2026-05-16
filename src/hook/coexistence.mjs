/**
 * planos — plannotator coexistence guard (US-006 decided posture).
 *
 * Decision (docs/notes/plannotator-coexistence-spike.md, confirmed by the
 * user): planos does NOT coexist with a second plugin that also hooks
 * `ExitPlanMode` (PermissionRequest). Claude Code dispatches the event to ALL
 * matching plugins in parallel (no first-wins) and reconciles PermissionRequest
 * as a deny-wins conjunction — two blocking 96h servers + two browsers is an
 * unrecoverable collision. Rather than attempt coexistence (a Phase-4-sized
 * problem, an explicit Non-Goal), planos detects the collision and REFUSES.
 *
 * AC-17: this module is reachable from `bin/planos exit`. It performs ONLY
 * local filesystem reads of sibling plugin manifests — no model, no network,
 * no agent/child-process spawn — so the import-graph walker stays CLEAN.
 * Re-run `node tests/harness/import-graph.mjs` after touching this file.
 *
 * Defensive by construction: ANY error / ambiguity resolves to "no collision"
 * so the guard can never spuriously block a user in the normal (clean-env)
 * case. It only fires on a positively-detected second ExitPlanMode plugin.
 *
 * Escape hatch: `PLANOS_ALLOW_COEXIST=1` disables the guard (caller accepts
 * the documented collision risk).
 *
 * Zero runtime dependencies. ES module.
 */

'use strict';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const SELF_PLUGIN_NAME = 'planos';

/**
 * Does a parsed hooks.json declare a PermissionRequest matcher for
 * `ExitPlanMode`? Tolerates shape drift (missing keys → false).
 *
 * @param {unknown} hooksJson
 * @returns {boolean}
 */
function declaresExitPlanModePermissionRequest(hooksJson) {
  try {
    const pr =
      hooksJson &&
      typeof hooksJson === 'object' &&
      hooksJson.hooks &&
      typeof hooksJson.hooks === 'object'
        ? hooksJson.hooks.PermissionRequest
        : undefined;
    if (!Array.isArray(pr)) return false;
    return pr.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.matcher === 'string' &&
        // Claude Code matchers are (extended) regexes; a literal substring
        // test is the conservative over-detector — better to refuse a
        // borderline collision than silently double-boot.
        entry.matcher.includes('ExitPlanMode'),
    );
  } catch {
    return false;
  }
}

/**
 * Read a plugin directory's declared name (`.claude-plugin/plugin.json`),
 * falling back to the directory basename. Never throws.
 *
 * @param {string} pluginDir
 * @returns {string}
 */
function pluginNameOf(pluginDir) {
  try {
    const pj = JSON.parse(
      readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    if (pj && typeof pj.name === 'string' && pj.name.length > 0) return pj.name;
  } catch {
    /* fall through to basename */
  }
  return basename(pluginDir);
}

/**
 * Detect OTHER installed plugins that also declare an `ExitPlanMode`
 * PermissionRequest hook, by scanning siblings of planos's own plugin root.
 *
 * `CLAUDE_PLUGIN_ROOT` (set by Claude Code) points at planos's installed
 * plugin dir; its parent is the plugins install dir holding sibling plugins.
 * For each sibling (excluding planos itself) we read `hooks/hooks.json` and
 * check for the colliding matcher.
 *
 * @param {{ env?: Record<string,string|undefined>, pluginRoot?: string }} [opts]
 * @returns {string[]} names of colliding plugins (empty = no collision)
 */
export function detectCollidingExitPlanModePlugins(opts = {}) {
  const env = opts.env || process.env;
  const pluginRoot =
    typeof opts.pluginRoot === 'string' && opts.pluginRoot.length > 0
      ? opts.pluginRoot
      : env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return []; // cannot locate siblings → assume clean env
  let pluginsDir;
  try {
    pluginsDir = dirname(pluginRoot);
  } catch {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(pluginsDir);
  } catch {
    return [];
  }
  const colliding = [];
  for (const name of entries) {
    let dir;
    try {
      dir = join(pluginsDir, name);
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // Skip planos itself (by path identity and by declared name).
    if (dir === pluginRoot) continue;
    let hooksJson;
    try {
      hooksJson = JSON.parse(
        readFileSync(join(dir, 'hooks', 'hooks.json'), 'utf8'),
      );
    } catch {
      continue; // no hooks.json / unreadable → not a collision source
    }
    if (!declaresExitPlanModePermissionRequest(hooksJson)) continue;
    const pname = pluginNameOf(dir);
    if (pname === SELF_PLUGIN_NAME) continue;
    colliding.push(pname);
  }
  return colliding;
}

/**
 * The refusal message emitted to stderr when a collision is detected. Kept as
 * a function so tests can assert its content without duplicating the prose.
 *
 * @param {string[]} colliding
 * @returns {string}
 */
export function coexistenceRefusalMessage(colliding) {
  return [
    '[planos] REFUSING TO RUN: another installed plugin also hooks',
    `ExitPlanMode (PermissionRequest): ${colliding.join(', ')}.`,
    '',
    'Claude Code dispatches ExitPlanMode to ALL matching plugins in',
    'parallel; two blocking 96h review servers cannot coexist. planos does',
    'not support coexistence (see docs/notes/plannotator-coexistence-spike.md).',
    '',
    'Resolve by uninstalling the other plugin, or set PLANOS_ALLOW_COEXIST=1',
    'to bypass this guard (you accept the documented collision risk).',
  ].join('\n');
}

/**
 * Production coexistence guard. Returns the list of colliding plugins unless
 * the escape hatch is set. Pure detection — the caller decides how to refuse
 * (so the guard stays trivially testable and AC-17-safe).
 *
 * @param {{ env?: Record<string,string|undefined>, pluginRoot?: string }} [opts]
 * @returns {string[]}
 */
export function coexistenceGuard(opts = {}) {
  const env = opts.env || process.env;
  if (env.PLANOS_ALLOW_COEXIST === '1') return [];
  return detectCollidingExitPlanModePlugins(opts);
}
