// Your skills travel with your settings (server/skill-bundle.js): the exported file carries their files,
// and importing it installs them where you choose (your personal folders, some repositories, or nowhere),
// never over a different skill that is already there and never outside its folder. Always a temporary HOME.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { exportSettings, importSettings } from '../server/settings-io.js';
import { Mine } from '../server/mine.js';
import { collectSkills, installSkills, safeRel, IMPORT_MARK } from '../server/skill-bundle.js';
import { startServer } from '../server/server.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `dto-skb-${p}-`));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

/** A HOME with your skills: one of Claude Code with a reference file, one of Pi, the office's own and a private one. */
function homeWithSkills() {
  const home = tmp('home');
  write(path.join(home, '.claude/skills/revisar-pr/SKILL.md'), '---\nname: revisar-pr\ndescription: "Cómo reviso un PR"\n---\nMira los tests.\n');
  write(path.join(home, '.claude/skills/revisar-pr/refs/checklist.md'), '- tests\n- docs\n');
  fs.writeFileSync(path.join(home, '.claude/skills/revisar-pr/logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01])); // not text: left out
  write(path.join(home, '.pi/agent/skills/mi-deploy/SKILL.md'), '---\nname: mi-deploy\n---\nDeploy.\n');
  write(path.join(home, '.claude/skills/dev-team-office/SKILL.md'), '---\nname: dev-team-office\n---\n');
  write(path.join(home, '.claude/skills/dev-team-office/.dev-team-office.json'), '{}');
  return home;
}

test('se juntan tus skills (con sus archivos de texto), no las de la oficina ni las privadas', () => {
  const store = openStore(':memory:');
  const home = homeWithSkills();
  try {
    const mine = new Mine({ store, home });
    mine.save({ kind: 'skill', name: 'mis-commits', title: 'Commits', body: 'x' });
    const skills = collectSkills({ store, home });
    assert.deepEqual(skills.map((s) => [s.name, s.from]), [['revisar-pr', 'personal'], ['mi-deploy', 'personal']]);
    assert.deepEqual(Object.keys(skills[0].files).sort(), ['SKILL.md', 'refs/checklist.md'], 'sin binarios');
    assert.equal(skills[0].description, 'Cómo reviso un PR');
    // without a HOME, none of yours (a test never reads the real one)
    assert.deepEqual(collectSkills({ store }), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('las skills que usan tus expertos viajan aunque estén en un proyecto', () => {
  const store = openStore(':memory:');
  const repo = tmp('repo');
  try {
    write(path.join(repo, '.claude/skills/pagos/SKILL.md'), '---\nname: pagos\n---\nCobros.\n');
    store.createAgent({ path: repo, harness: 'claude-code', name: 'tienda' });
    store.saveExpert({ skill: 'pagos', look: { name: 'Ana' } });
    assert.deepEqual(collectSkills({ store }).map((s) => [s.name, s.from]), [['pagos', 'repo:tienda']]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('instalar: nunca sobre una skill distinta, nunca fuera de su carpeta; la que puso la oficina se actualiza', () => {
  const dir = tmp('dest');
  try {
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', '', IMPORT_MARK]) assert.equal(safeRel(bad), null, bad);
    assert.equal(safeRel('refs/a.md'), 'refs/a.md');
    const skill = { name: 'revisar-pr', files: { 'SKILL.md': 'v1', 'refs/a.md': 'a' } };
    let r = installSkills([skill], [{ dir, label: 'aquí' }]);
    assert.deepEqual(r.map((x) => [x.name, x.ok, x.action]), [['revisar-pr', true, 'installed']]);
    assert.equal(fs.readFileSync(path.join(dir, 'revisar-pr/refs/a.md'), 'utf8'), 'a');
    r = installSkills([skill], [{ dir, label: 'aquí' }]);
    assert.equal(r[0].action, 'same');
    r = installSkills([{ ...skill, files: { 'SKILL.md': 'v2' } }], [{ dir, label: 'aquí' }]);
    assert.equal(r[0].action, 'updated', 'la que puso la oficina se puede actualizar');
    // one that is yours (no mark) is never stepped on
    write(path.join(dir, 'propia/SKILL.md'), 'mía');
    r = installSkills([{ name: 'propia', files: { 'SKILL.md': 'otra' } }], [{ dir, label: 'aquí' }]);
    assert.deepEqual([r[0].ok, r[0].reason], [false, 'exists']);
    assert.equal(fs.readFileSync(path.join(dir, 'propia/SKILL.md'), 'utf8'), 'mía');
    // a file that tries to get out of its folder, or a bad name: nothing is written
    for (const bad of [{ name: 'x', files: { 'SKILL.md': 'a', '../../fuera.md': 'b' } }, { name: '../x', files: { 'SKILL.md': 'a' } }, { name: 'sin-skill', files: { 'otra.md': 'a' } }]) {
      r = installSkills([bad], [{ dir, label: 'aquí' }]);
      assert.deepEqual([r[0].ok, r[0].reason], [false, 'invalid'], JSON.stringify(bad));
    }
    assert.ok(!fs.existsSync(path.join(dir, '..', 'fuera.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('de una máquina a otra: global, en los repos elegidos o en ninguna parte', () => {
  const from = homeWithSkills();
  const homes = [];
  const repo = tmp('repo');
  try {
    const a = openStore(':memory:');
    new Mine({ store: a, home: from }).save({ kind: 'skill', name: 'mis-commits', title: 'Commits', body: 'Así.' });
    const file = exportSettings(a, { home: from });
    assert.deepEqual(file.skills.map((s) => s.name), ['revisar-pr', 'mi-deploy']);
    assert.equal(exportSettings(a, { home: from, skills: false }).skills.length, 0, 'sin ellas si así lo pides');

    // global: in your personal folders
    const g = tmp('g'); homes.push(g);
    fs.mkdirSync(path.join(g, '.claude'));
    let b = openStore(':memory:');
    let out = importSettings(b, file, { mine: new Mine({ store: b, home: g }), skills: { to: 'global' } });
    assert.equal(out.ok, true, out.error);
    assert.ok(fs.existsSync(path.join(g, '.claude/skills/revisar-pr/refs/checklist.md')));
    assert.ok(fs.existsSync(path.join(g, '.claude/skills/mis-commits/SKILL.md')), 'la privada, también');
    assert.equal(out.applied.installed, 2);

    // repos: only in the ones you chose, by their agent (Claude Code: .claude/skills)
    const r = tmp('r'); homes.push(r);
    fs.mkdirSync(path.join(r, '.claude'));
    b = openStore(':memory:');
    const tienda = b.createAgent({ path: repo, harness: 'claude-code', name: 'tienda' }).agent;
    out = importSettings(b, file, { mine: new Mine({ store: b, home: r }), skills: { to: 'repos', repos: [tienda.id] } });
    assert.ok(fs.existsSync(path.join(repo, '.claude/skills/revisar-pr/SKILL.md')));
    assert.ok(fs.existsSync(path.join(repo, '.claude/skills/mis-commits/SKILL.md')), 'la privada va al repo');
    assert.ok(!fs.existsSync(path.join(r, '.claude/skills')), 'y no a tus carpetas');
    assert.equal(b.listMine('skill')[0].enabled, false, 'en ⚙ › Mío queda apagada');

    // none: nothing installed anywhere
    const n = tmp('n'); homes.push(n);
    fs.mkdirSync(path.join(n, '.claude'));
    b = openStore(':memory:');
    out = importSettings(b, file, { mine: new Mine({ store: b, home: n }), skills: { to: 'none' } });
    assert.equal(out.applied.installed, 0);
    assert.ok(!fs.existsSync(path.join(n, '.claude/skills')));
  } finally {
    for (const d of [from, repo, ...homes]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('por la API: exportar con tus skills y elegir al importar dónde van', async () => {
  const home = homeWithSkills();
  const repo = tmp('repo');
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, loops: { autostart: false }, mine: { home } });
  try {
    const file = await fetch(`${server.url}/v1/settings/export`).then((r) => r.json());
    assert.deepEqual(file.skills.map((s) => s.name), ['revisar-pr', 'mi-deploy']);
    const lean = await fetch(`${server.url}/v1/settings/export?skills=0`).then((r) => r.json());
    assert.deepEqual(lean.skills, []);
    const r = await call(server.url, 'POST', '/v1/agents', { path: repo, harness: 'pi', name: 'tienda', bin: '/nonexistent' });
    const out = await call(server.url, 'POST', `/v1/settings/import?skills=repos&repos=${encodeURIComponent(r.body.agent.id)}`, file);
    assert.equal(out.body.ok, true, out.body.error);
    assert.ok(fs.existsSync(path.join(repo, '.agents/skills/mi-deploy/SKILL.md')), 'Pi: .agents/skills');
  } finally {
    await server.close();
    for (const d of [home, repo]) fs.rmSync(d, { recursive: true, force: true });
  }
});
