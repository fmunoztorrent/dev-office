// Your skills as part of your exported settings (server/settings-io.js): the ones in your personal folders
// (Claude Code, Pi, OpenCode, Codex) and the ones your experts use from a project, each with its text files,
// so importing the file on another machine brings them back. On import you choose where they go: your
// personal folders (global), some registered repositories, or nowhere.
//
// Installing never steps on a skill that is already there and is not the same: it is skipped (and said),
// unless this office put it there before from an import (.dev-team-office-import.json).
import fs from 'node:fs';
import path from 'node:path';
import { personalSkillDirs, SKILL_MARK as MINE_MARK } from './mine.js';
import { OTHER_PERSONAL_DIRS, skillAgent } from './experts.js';

/** The mark of a skill this office installed from an imported file. */
export const IMPORT_MARK = '.dev-team-office-import.json';
// the office's own skills (bin/skills.js, installed by setup): they come with the office, not with you
const OFFICE_MARK = '.dev-team-office.json';

export const SKILLS_MAX = 60;          // skills in one file
const FILE_MAX = 256 * 1024;           // bytes of one file
const SKILL_MAX = 1024 * 1024;         // bytes of one skill
const FILES_MAX = 80;                  // files of one skill
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build']);

/** A skill's folder name: lowercase letters, digits, dots, dashes and underscores. */
export const validSkillName = (n) => typeof n === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n) && !n.includes('..');

/** A relative path inside a skill that is safe to write: no absolute path, no `..`, no hidden folder tricks. */
export function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 200 || rel.includes('\0')) return null;
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'));
  if (norm.startsWith('/') || norm.startsWith('../') || norm === '..' || norm.split('/').some((p) => p === '..' || p === '')) return null;
  if (norm === IMPORT_MARK || norm === OFFICE_MARK) return null;
  return norm;
}

const isText = (buf) => !buf.includes(0);

/** The text files of a skill's folder: { rel: text }, or null if it is too big. */
function filesOf(dir) {
  const files = {};
  let total = 0, count = 0;
  const walk = (d, rel = '', depth = 0) => {
    if (depth > 4) return true;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return true; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === IMPORT_MARK || e.name === OFFICE_MARK || e.name === '.DS_Store') continue;
      const full = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !walk(full, r, depth + 1)) return false; continue; }
      if (!st.isFile() || st.size > FILE_MAX) continue;
      const buf = fs.readFileSync(full);
      if (!isText(buf)) continue;
      total += buf.length;
      if (++count > FILES_MAX || total > SKILL_MAX) return false;
      files[r] = buf.toString('utf8');
    }
    return true;
  };
  return walk(dir) && files['SKILL.md'] ? files : null;
}

/** A SKILL.md's description (its front matter), for the list on import. */
function describe(md) {
  const m = String(md).match(/^---\n([\s\S]*?)\n---/);
  const d = m?.[1].match(/^description:\s*(.+)$/m)?.[1] || '';
  return d.replace(/^["']|["']$/g, '').slice(0, 200);
}

/** The skills of a folder of skills: [{ name, dir }] (each one a folder with its SKILL.md). */
function skillsIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && validSkillName(d.name) && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => ({ name: d.name, dir: path.join(dir, d.name) }));
  } catch { return []; }
}

/**
 * Your skills, to take with your settings: [{ name, from, description, files }].
 *   from: 'personal' (one of your agents' personal folders) or 'repo:<name>' (a project skill an expert uses)
 * Left out: the office's own skills (they come with it), the private ones of ⚙ › Mine (they go in the file's
 * `mine`), and the ones that are too big or not text.
 */
export function collectSkills({ store, home }) {
  const out = new Map();
  const take = (s, from) => {
    if (out.size >= SKILLS_MAX || out.has(s.name)) return;
    if (fs.existsSync(path.join(s.dir, OFFICE_MARK))) return;
    let md = '';
    try { md = fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'); } catch { return; }
    if (md.includes(MINE_MARK)) return;
    const files = filesOf(s.dir);
    if (files) out.set(s.name, { name: s.name, from, description: describe(md), files });
  };
  if (home) {
    for (const d of personalSkillDirs(home)) for (const s of skillsIn(d.dir)) take(s, 'personal');
    for (const d of OTHER_PERSONAL_DIRS) for (const s of skillsIn(path.join(home, ...d))) take(s, 'personal');
  }
  // the skills your experts use, from the project that has them
  for (const x of store?.listExperts?.() || []) {
    const a = skillAgent(store, x.skill);
    if (!a) continue;
    for (const sub of ['.claude/skills', '.agents/skills', '.pi/skills', '.opencode/skills', '.codex/skills', 'skills']) {
      const dir = path.join(a.path, sub, x.skill);
      if (fs.existsSync(path.join(dir, 'SKILL.md'))) { take({ name: x.skill, dir }, `repo:${a.name}`); break; }
    }
  }
  return [...out.values()];
}

/** Where a registered repository keeps its skills, by its agent. */
export const repoSkillDir = (a) => path.join(a.path, a.harness === 'claude-code' ? '.claude/skills' : '.agents/skills');

/**
 * Installs bundled skills in some folders of skills (your personal ones, or some repositories').
 * @param skills  [{ name, files }] as collectSkills gives them (from a file: checked here)
 * @param dirs    [{ dir, label }] the folders of skills to install in
 * @returns [{ name, label, ok, action: 'installed'|'updated'|'same' | reason: 'exists'|'invalid', dir }]
 */
export function installSkills(skills, dirs) {
  const out = [];
  for (const s of Array.isArray(skills) ? skills : []) {
    const name = s?.name;
    const files = s && typeof s.files === 'object' && s.files ? Object.entries(s.files).map(([rel, text]) => [safeRel(rel), text]) : [];
    const valid = validSkillName(name) && files.length && files.length <= FILES_MAX && files.every(([rel, text]) => rel && typeof text === 'string' && Buffer.byteLength(text) <= FILE_MAX)
      && files.some(([rel]) => rel === 'SKILL.md');
    for (const { dir, label } of dirs) {
      if (!valid) { out.push({ name: String(name || '?'), label, ok: false, reason: 'invalid', dir }); continue; }
      const target = path.join(dir, name);
      const same = files.every(([rel, text]) => { try { return fs.readFileSync(path.join(target, rel), 'utf8') === text; } catch { return false; } });
      if (same) { out.push({ name, label, ok: true, action: 'same', dir: target }); continue; }
      const exists = fs.existsSync(target);
      if (exists && !fs.existsSync(path.join(target, IMPORT_MARK))) { out.push({ name, label, ok: false, reason: 'exists', dir: target }); continue; }
      try {
        for (const [rel, text] of files) {
          const file = path.join(target, rel);
          if (!file.startsWith(`${target}${path.sep}`)) throw new Error(`unsafe path ${rel}`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, text);
        }
        fs.writeFileSync(path.join(target, IMPORT_MARK), `${JSON.stringify({ skill: name, from: 'dev-team-office import', at: new Date().toISOString() }, null, 2)}\n`);
        out.push({ name, label, ok: true, action: exists ? 'updated' : 'installed', dir: target });
      } catch (err) {
        out.push({ name, label, ok: false, reason: 'invalid', error: err.message, dir: target });
      }
    }
  }
  return out;
}
