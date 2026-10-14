// `dev-team-office install [pi|opencode|claude]`: deja las integraciones en su sitio. La oficina
// es el frontend; el trabajo lo hacen estas piezas dentro de cada agente, con la librería común
// en ~/.dev-team-office/lib/devteam.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    return [`Pi: extensión en ${tilde(ext)} y skill en ${tilde(skill)}/`, '    Abre pi en tu proyecto: se conecta sola a la oficina.'];
  },
  opencode() {
    const plugin = copy('opencode/dev-team-office.js', path.join(HOME, '.config', 'opencode', 'plugin', 'dev-team-office.js'));
    return [`OpenCode: plugin en ${tilde(plugin)}`, '    Abre opencode en tu proyecto: se conecta solo a la oficina.'];
  },
  claude() {
    const hook = copy('claude-code/hook.mjs', path.join(OFFICE_DIR, 'claude-code', 'hook.mjs'));
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'claude-code', 'settings.example.json'), 'utf8'));
    const cmd = `node ${hook}`;
    for (const groups of Object.values(settings.hooks)) for (const g of groups) for (const h of g.hooks) h.command = cmd;
    const snippet = path.join(OFFICE_DIR, 'claude-code', 'settings.json');
    fs.writeFileSync(snippet, `${JSON.stringify(settings, null, 2)}\n`);
    return [
      `Claude Code: hook en ${tilde(hook)}`,
      `    Falta un paso tuyo: copia la sección "hooks" de ${tilde(snippet)}`,
      '    a ~/.claude/settings.json (o a .claude/settings.json del proyecto).',
    ];
  },
};
const ALIASES = { 'claude-code': 'claude', open: 'opencode' };

export function install(which = []) {
  const names = (which.length ? which : Object.keys(TARGETS)).map((n) => ALIASES[n] || n);
  const unknown = names.filter((n) => !TARGETS[n]);
  if (unknown.length) return { ok: false, error: `no conozco: ${unknown.join(', ')} (usa pi, opencode o claude)` };
  const lib = copy('common/devteam.mjs', path.join(OFFICE_DIR, 'lib', 'devteam.mjs'));
  const lines = [`Librería común en ${tilde(lib)}`];
  for (const n of names) lines.push(...TARGETS[n]());
  return { ok: true, lines };
}
