// The office's own skills in an agent's skills folder (bin/skills.js): each update leaves exactly this
// version's (whole folders, with their mark), removes the ones it no longer ships, and never touches a
// same-named folder that is not the office's.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncSkills, removeSkills, skillsState, shippedSkills, skillMark, packageVersion, SKILL_MARK } from '../bin/skills.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-skills-')));
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const ls = (d) => fs.readdirSync(d).sort();

test('el paquete trae sus skills, cada una con su SKILL.md', () => {
  assert.deepEqual(shippedSkills(), ['dev-team-office', 'dev-team-office-config', 'stay-focused']);
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});

test('una actualización deja las skills de esta versión enteras, quita las que ya no vienen y no toca las ajenas', () => {
  const src = tmp(), dst = tmp();
  write(path.join(src, 'alfa', 'SKILL.md'), 'alfa v1');
  write(path.join(src, 'alfa', 'viejo.mjs'), 'se va en la v2');
  write(path.join(src, 'beta', 'SKILL.md'), 'beta v1');
  write(path.join(src, 'no-es-skill', 'README.md'), 'sin SKILL.md');
  // what the user has: a skill of their own, and one with the name of an office skill that is theirs
  write(path.join(dst, 'mia', 'SKILL.md'), 'mía');
  write(path.join(dst, 'beta', 'SKILL.md'), 'mi beta');

  let r = syncSkills(dst, { src, version: '1.0.0' });
  assert.deepEqual(r, { installed: ['alfa'], removed: [], foreign: ['beta'], failed: [] });
  assert.equal(fs.readFileSync(path.join(dst, 'beta', 'SKILL.md'), 'utf8'), 'mi beta');
  assert.deepEqual(skillMark(path.join(dst, 'alfa')), { skill: 'alfa', version: '1.0.0', from: 'dev-team-office' });
  assert.deepEqual(skillsState(dst, { src, version: '1.0.0' }), { missing: [], outdated: [], foreign: ['beta'] });

  // version 2: alfa loses a file and gains a folder; beta is no longer shipped; gamma is new
  fs.rmSync(path.join(src, 'alfa', 'viejo.mjs'));
  write(path.join(src, 'alfa', 'SKILL.md'), 'alfa v2');
  write(path.join(src, 'alfa', 'scripts', 'run.sh'), 'echo');
  fs.rmSync(path.join(src, 'beta'), { recursive: true });
  write(path.join(src, 'gamma', 'SKILL.md'), 'gamma');
  assert.deepEqual(skillsState(dst, { src, version: '2.0.0' }), { missing: ['gamma'], outdated: [{ name: 'alfa', version: '1.0.0' }], foreign: [] });
  r = syncSkills(dst, { src, version: '2.0.0' });
  assert.deepEqual(r.installed, ['alfa', 'gamma']);
  assert.deepEqual(ls(path.join(dst, 'alfa')), [SKILL_MARK, 'SKILL.md', 'scripts'], 'sin el archivo que la v2 ya no trae');
  assert.equal(fs.readFileSync(path.join(dst, 'alfa', 'scripts', 'run.sh'), 'utf8'), 'echo');
  assert.deepEqual(ls(dst), ['alfa', 'beta', 'gamma', 'mia'], 'beta era del usuario: se queda');
  assert.deepEqual(skillsState(dst, { src, version: '2.0.0' }), { missing: [], outdated: [], foreign: [] });

  // a version that no longer ships gamma: it goes (it was the office's)
  fs.rmSync(path.join(src, 'gamma'), { recursive: true });
  assert.deepEqual(syncSkills(dst, { src, version: '3.0.0' }).removed, ['gamma']);
  assert.deepEqual(removeSkills(dst), ['alfa']);
  assert.deepEqual(ls(dst), ['beta', 'mia']);
});

test('las skills de antes de la marca (por su nombre) se reemplazan; una simulación no escribe nada', () => {
  const dst = tmp();
  write(path.join(dst, 'dev-team-office', 'SKILL.md'), 'versión vieja');
  write(path.join(dst, 'dev-team-office', 'resto.txt'), 'de antes');
  const before = ls(path.join(dst, 'dev-team-office'));
  const dry = syncSkills(dst, { dry: true });
  assert.deepEqual(dry.installed, ['dev-team-office', 'dev-team-office-config', 'stay-focused']);
  assert.deepEqual(ls(path.join(dst, 'dev-team-office')), before);
  assert.deepEqual(ls(dst), ['dev-team-office']);
  assert.deepEqual(skillsState(dst).outdated, [{ name: 'dev-team-office', version: null }]);

  syncSkills(dst);
  assert.equal(fs.existsSync(path.join(dst, 'dev-team-office', 'resto.txt')), false);
  assert.ok(fs.existsSync(path.join(dst, 'dev-team-office', 'office-event.mjs')));
  assert.equal(skillMark(path.join(dst, 'dev-team-office')).version, packageVersion());
  assert.equal(fs.readdirSync(dst).some((n) => n.startsWith('.')), false, 'sin carpetas temporales');
});
