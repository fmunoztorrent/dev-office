// `dev-team-office install [pi|opencode|claude|codex]`: puts each integration's files in place.
// The office is the frontend; the work is done by these pieces inside each agent, with the shared
// library at ~/.dev-team-office/lib/devteam.mjs. `setup` (bin/setup.js) uses this and also wires
// the hooks, the MCP server and the skills into each agent's configuration.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../public/i18n.js';
import { piAgentDir } from '../integrations/common/devteam.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(REPO, 'integrations');
const SKILLS_DIR = path.join(REPO, 'skills');
const HOME = os.homedir();
const OFFICE_DIR = path.join(HOME, '.dev-team-office');
const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, fs.readFileSync(path.isAbsolute(from) ? from : path.join(ROOT, from)));
  return to;
}

/** Claude Code's `hooks` section with every event pointing to `command`. */
export function claudeHooks(command) {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'claude-code', 'settings.example.json'), 'utf8'));
  for (const groups of Object.values(settings.hooks)) for (const g of groups) for (const h of g.hooks) h.command = command;
  return settings.hooks;
}

// OpenCode loads plugins from ~/.config/opencode/plugins/ (older versions, from plugin/)
const opencodePlugins = () => {
  const dir = path.join(HOME, '.config', 'opencode');
  return fs.existsSync(path.join(dir, 'plugin')) && !fs.existsSync(path.join(dir, 'plugins')) ? path.join(dir, 'plugin') : path.join(dir, 'plugins');
};

export const TARGETS = {
  pi() {
    const ext = copy('pi/dev-team-office.ts', path.join(piAgentDir(), 'extensions', 'dev-team-office.ts'));
    return [t('install.pi', { ext: tilde(ext), skill: tilde(path.join(HOME, '.agents', 'skills', 'dev-team-office')) }), t('install.piHint')];
  },
  opencode() {
    const plugin = copy('opencode/dev-team-office.js', path.join(opencodePlugins(), 'dev-team-office.js'));
    return [t('install.opencode', { plugin: tilde(plugin) }), t('install.opencodeHint')];
  },
  claude() {
    const hook = copy('claude-code/hook.mjs', path.join(OFFICE_DIR, 'claude-code', 'hook.mjs'));
    // the `hooks` section ready to copy (setup wires it by itself into ~/.claude/settings.json)
    const snippet = path.join(OFFICE_DIR, 'claude-code', 'settings.json');
    fs.writeFileSync(snippet, `${JSON.stringify({ hooks: claudeHooks(`node ${hook}`) }, null, 2)}\n`);
    return [t('install.claude', { hook: tilde(hook) })];
  },
  codex() {
    const hook = copy('codex/hook.mjs', path.join(OFFICE_DIR, 'codex', 'hook.mjs'));
    return [t('install.codex', { hook: tilde(hook) })];
  },
};
const ALIASES = { 'claude-code': 'claude', open: 'opencode' };

/** The skills (how to work with the office and how to declare roles) in ~/.agents/skills, the place
 * Pi, Codex and OpenCode share. They are accessories: if one cannot be copied, it warns and goes on. */
function installSkills() {
  const lines = [];
  for (const name of fs.readdirSync(SKILLS_DIR)) {
    const from = path.join(SKILLS_DIR, name);
    if (!fs.existsSync(path.join(from, 'SKILL.md'))) continue;
    const to = path.join(HOME, '.agents', 'skills', name);
    try {
      for (const f of fs.readdirSync(from)) copy(path.join(from, f), path.join(to, f));
      lines.push(t(name === 'dev-team-office-config' ? 'install.configSkill' : 'install.skill', { path: tilde(path.join(to, 'SKILL.md')) }));
    } catch (error) {
      lines.push(t(name === 'dev-team-office-config' ? 'install.configSkillFail' : 'install.skillFail', { error: error.message }));
    }
  }
  return lines;
}

/** Empty `which`: every integration. With `{ all: false }`, empty means none (only the shared parts). */
export function install(which = [], { all = true } = {}) {
  const names = (which.length || !all ? which : Object.keys(TARGETS)).map((n) => ALIASES[n] || n);
  const unknown = names.filter((n) => !TARGETS[n]);
  if (unknown.length) return { ok: false, error: t('install.unknown', { names: unknown.join(', ') }) };
  const lib = copy('common/devteam.mjs', path.join(OFFICE_DIR, 'lib', 'devteam.mjs'));
  const lines = [t('install.lib', { path: tilde(lib) }), ...installSkills()];
  for (const n of names) lines.push(...TARGETS[n]());
  return { ok: true, lines };
}
