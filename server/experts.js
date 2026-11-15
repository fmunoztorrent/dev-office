// The subject matter experts (SME): a character who knows a skill. For now you associate each one with
// a skill by hand (⚙ › Characters › Experts): "Ana, PCI compliance" knows the skill `pci-dss`. When an
// agent uses that skill, its expert comes to the office: up the elevator, to a hot desk, with the skill in
// their badge, and leaves when the agent's turn ends (like the visiting specialists). The work stays the
// team's: the expert is who the agent consults.
//
// An agent uses a skill when it calls its skill tool (Claude Code's Skill, OpenCode's skill) or reads the
// skill's files (Pi, Codex and the rest read skills/<name>/SKILL.md).

import fs from 'node:fs';
import path from 'node:path';
import { filePathOf } from './roles.js';

// the tools that load a skill by its name
const SKILL_TOOLS = new Set(['skill', 'skills', 'use_skill', 'load_skill', 'read_skill']);
// a skill's folder in a path: …/skills/<name>/… (the project's, yours, a plugin's)
const SKILL_DIR = /[/\\]skills[/\\]([a-z0-9][a-z0-9._-]{0,63})(?:[/\\]|$)/i;

/** A skill's name as experts are kept: lowercase, without its plugin («plugin:name» → «name»). */
export const skillName = (s) => String(s ?? '').trim().toLowerCase().split(':').pop().replace(/^\/+/, '');

/** The skill an agent's tool uses: its skill tool's, or the one whose files it reads. null if none. */
export function skillOf(tool, input = {}) {
  const tl = String(tool || '').toLowerCase();
  if (SKILL_TOOLS.has(tl)) {
    const name = skillName(input.skill ?? input.name ?? input.command ?? input.id ?? '');
    return name || null;
  }
  const where = [filePathOf(input), input.pattern, typeof input.command === 'string' ? input.command : '', typeof input.cmd === 'string' ? input.cmd : ''].filter(Boolean).join(' ');
  const m = where.match(SKILL_DIR);
  return m ? skillName(m[1]) : null;
}

/**
 * The expert of the skill a tool uses, as events carry them: { id, name, title, skill, shirt } (or null).
 * @param experts the experts (store.listExperts())
 */
export function expertOfTool(experts, tool, input) {
  const skill = skillOf(tool, input);
  if (!skill) return null;
  const x = experts.find((e) => e.skill === skill);
  return x ? { id: x.id, name: x.look?.name || skill, title: x.look?.title || '', skill: x.skill, shirt: x.look?.shirt || null } : null;
}

// where a project keeps its skills (one folder per skill, with its SKILL.md)
const PROJECT_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.pi/skills', '.opencode/skills', '.codex/skills', 'skills'];

/** The skills in a folder of skills: [names] (each one a folder with its SKILL.md). */
function skillsIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => (d.isDirectory() || d.isSymbolicLink()) && fs.existsSync(path.join(dir, d.name, 'SKILL.md'))).map((d) => skillName(d.name));
  } catch { return []; }
}

/**
 * The skills the company knows, to pick an expert's: the archive's, yours (⚙ › Mine and your personal
 * folders) and the registered projects' ([{ name, where }], each name once).
 * @param dirs  your personal skill folders (server/mine.js, personalSkillDirs)
 */
export function knownSkills(store, { dirs = [] } = {}) {
  const out = new Map();
  const add = (name, where) => { const n = skillName(name); if (n && !out.has(n)) out.set(n, { name: n, where }); };
  try { for (const k of store.listKnowledge({ kind: 'skill', limit: 500 })) add(k.name || k.title, 'archive'); } catch { /* an archive that cannot be read */ }
  for (const m of store.listMine('skill')) add(m.name, 'mine');
  for (const d of dirs) for (const n of skillsIn(d.dir || d)) add(n, 'mine');
  for (const a of store.listAgents()) for (const sub of PROJECT_SKILL_DIRS) for (const n of skillsIn(path.join(a.path, sub))) add(n, a.name);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
