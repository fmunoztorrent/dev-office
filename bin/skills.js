// The office's own skills (skills/ in the package: how to work with the office, how to declare a
// harness's roles, how to stay on what was asked), installed into each agent's skills folder
// (~/.claude/skills, ~/.agents/skills) by `setup`, and so again by every `update`.
//
// Each installed skill carries a mark with the version that put it there (.dev-team-office.json), so:
//   - an update replaces the whole folder (a file the new version no longer has does not stay behind);
//   - a skill the office no longer ships is removed;
//   - `doctor` can tell a skill from another version;
//   - a folder with the same name that is not the office's is never touched.
// The skills installed before the mark existed are recognized by their names (LEGACY).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_SRC = path.join(ROOT, 'skills');
export const SKILL_MARK = '.dev-team-office.json';
// the office's skills from before the mark: their folders were always the office's to overwrite
const LEGACY = ['dev-team-office', 'dev-team-office-config', 'stay-focused'];

/** The version of this package (the one that installs). */
export function packageVersion(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

/** The skills this package ships: the folders of skills/ with a SKILL.md. */
export function shippedSkills(src = SKILLS_SRC) {
  try { return fs.readdirSync(src).filter((n) => fs.existsSync(path.join(src, n, 'SKILL.md'))).sort(); } catch { return []; }
}

/** The mark of an installed skill ({ skill, version }), or null. */
export function skillMark(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, SKILL_MARK), 'utf8')); } catch { return null; }
}

/** Is this folder one of the office's skills (marked, or one of the old names with its SKILL.md)? */
export function isOurs(dir) {
  if (skillMark(dir)) return true;
  return LEGACY.includes(path.basename(dir)) && fs.existsSync(path.join(dir, 'SKILL.md'));
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) copyTree(src, dst);
    else if (e.isFile()) fs.copyFileSync(src, dst);
  }
}

/**
 * Leaves `dir` with this version's skills: each one replaced whole (written next to it, then swapped),
 * the office's skills it no longer ships removed, and a same-named folder that is not the office's left
 * alone. Returns { installed, removed, foreign, failed: [{ name, error }] }.
 */
export function syncSkills(dir, { src = SKILLS_SRC, version = packageVersion(), dry = false } = {}) {
  const out = { installed: [], removed: [], foreign: [], failed: [] };
  const shipped = shippedSkills(src);
  for (const name of shipped) {
    const to = path.join(dir, name);
    if (fs.existsSync(to) && !isOurs(to)) { out.foreign.push(name); continue; }
    if (dry) { out.installed.push(name); continue; }
    const tmp = path.join(dir, `.${name}.dto-${process.pid}`);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      copyTree(path.join(src, name), tmp);
      fs.writeFileSync(path.join(tmp, SKILL_MARK), `${JSON.stringify({ skill: name, version, from: 'dev-team-office' }, null, 2)}\n`);
      fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(tmp, to);
      out.installed.push(name);
    } catch (error) {
      fs.rmSync(tmp, { recursive: true, force: true });
      out.failed.push({ name, error: error.message });
    }
  }
  // the office's skills this version no longer ships
  for (const name of listDirs(dir)) {
    if (shipped.includes(name) || !skillMark(path.join(dir, name))) continue;
    if (!dry) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    out.removed.push(name);
  }
  return out;
}

/** Removes every one of the office's skills from `dir` (marked, or the old names). Returns their names. */
export function removeSkills(dir, { dry = false } = {}) {
  const gone = [];
  for (const name of listDirs(dir)) {
    const full = path.join(dir, name);
    if (!isOurs(full)) continue;
    if (!dry) fs.rmSync(full, { recursive: true, force: true });
    gone.push(name);
  }
  return gone;
}

/** How `dir` is: { missing, outdated: [{ name, version }], foreign } against this version's skills. */
export function skillsState(dir, { src = SKILLS_SRC, version = packageVersion() } = {}) {
  const st = { missing: [], outdated: [], foreign: [] };
  for (const name of shippedSkills(src)) {
    const full = path.join(dir, name);
    if (!fs.existsSync(path.join(full, 'SKILL.md'))) st.missing.push(name);
    else if (!isOurs(full)) st.foreign.push(name);
    else if (skillMark(full)?.version !== version) st.outdated.push({ name, version: skillMark(full)?.version || null });
  }
  return st;
}

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch { return []; }
}
