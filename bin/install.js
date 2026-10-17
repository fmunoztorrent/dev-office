// `dev-team-office install [pi|opencode|claude]`: deja las integraciones en su sitio. La oficina
// es el frontend; el trabajo lo hacen estas piezas dentro de cada agente, con la librería común
// en ~/.dev-team-office/lib/devteam.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../public/i18n.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations');
const HOME = os.homedir();
const OFFICE_DIR = path.join(HOME, '.dev-team-office');
const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, fs.readFileSync(path.join(ROOT, from)));
  return to;
}

const TARGETS = {
  pi() {
    const ext = copy('pi/dev-team-office.ts', path.join(HOME, '.pi', 'agent', 'extensions', 'dev-team-office.ts'));
    const skill = path.join(HOME, '.agents', 'skills', 'dev-team-office');
    copy('pi/skills/dev-team-office/SKILL.md', path.join(skill, 'SKILL.md'));
    copy('pi/skills/dev-team-office/office-event.mjs', path.join(skill, 'office-event.mjs'));
    return [t('install.pi', { ext: tilde(ext), skill: tilde(skill) }), t('install.piHint')];
  },
  opencode() {
    const plugin = copy('opencode/dev-team-office.js', path.join(HOME, '.config', 'opencode', 'plugin', 'dev-team-office.js'));
    return [t('install.opencode', { plugin: tilde(plugin) }), t('install.opencodeHint')];
  },
  claude() {
    const hook = copy('claude-code/hook.mjs', path.join(OFFICE_DIR, 'claude-code', 'hook.mjs'));
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'claude-code', 'settings.example.json'), 'utf8'));
    const cmd = `node ${hook}`;
    for (const groups of Object.values(settings.hooks)) for (const g of groups) for (const h of g.hooks) h.command = cmd;
    const snippet = path.join(OFFICE_DIR, 'claude-code', 'settings.json');
    fs.writeFileSync(snippet, `${JSON.stringify(settings, null, 2)}\n`);
    return [
      t('install.claude', { hook: tilde(hook) }),
      t('install.claudeStep', { snippet: tilde(snippet) }),
      t('install.claudeWhere'),
    ];
  },
};
const ALIASES = { 'claude-code': 'claude', open: 'opencode' };

export function install(which = []) {
  const names = (which.length ? which : Object.keys(TARGETS)).map((n) => ALIASES[n] || n);
  const unknown = names.filter((n) => !TARGETS[n]);
  if (unknown.length) return { ok: false, error: t('install.unknown', { names: unknown.join(', ') }) };
  const lib = copy('common/devteam.mjs', path.join(OFFICE_DIR, 'lib', 'devteam.mjs'));
  const lines = [t('install.lib', { path: tilde(lib) })];
  // El skill de configuración es genérico (sirve a cualquier harness), pero es accesorio: si no se puede
  // copiar, se avisa y se sigue, porque la librería ya está en disco y las integraciones aún se pueden dejar.
  try {
    const configSkill = copy('common/skills/dev-team-office-config/SKILL.md', path.join(HOME, '.agents', 'skills', 'dev-team-office-config', 'SKILL.md'));
    lines.push(t('install.configSkill', { path: tilde(configSkill) }));
  } catch (error) {
    lines.push(t('install.configSkillFail', { error: error.message }));
  }
  for (const n of names) lines.push(...TARGETS[n]());
  return { ok: true, lines };
}
