// Departments, projects and characters: each department (an office) has its projects, its people and
// its instructions; each project folder has its own instructions, like a ChatGPT or Claude project's;
// both go on top of every brief, pipeline, directive and question. And a character (personality,
// answer style and look) is a JSON file that can be shared.
import './es.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.js';
import { startServer } from '../server/server.js';
import { guideFor, guideText, unguided } from '../server/guides.js';
import { scoped } from '../server/tasks.js';
import { exportCharacter, parseCharacter, changedLook, characterFile, CHARACTER_KIND } from '../public/character.js';
import { applyAppearance, TEAM } from '../public/sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const FAKE_BTW = path.join(here, 'fixtures', 'fake-btw.mjs');
const dirs = [];
const tmp = (p = 'dto-dept-') => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const call = (base, method, p, body) => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout');
};

test('un departamento tiene sus indicaciones y cada carpeta de proyecto las suyas: se guardan, se validan y se borran vacías', () => {
  const store = openStore(':memory:');
  try {
    const dept = store.createOffice({ name: 'Pagos', instructions: '  Montos en centavos.\nNunca registres números de tarjeta.  ' }).office;
    assert.equal(dept.instructions, 'Montos en centavos.\nNunca registres números de tarjeta.');
    assert.equal(store.updateOffice('pagos', { name: 'Pagos' }).office.instructions, dept.instructions, 'cambiar otra cosa no las borra');
    assert.equal(store.updateOffice('pagos', { instructions: '' }).office.instructions, '');

    const dir = tmp();
    const a = store.createAgent({ path: dir, harness: 'pi', office: 'pagos', instructions: 'pnpm, no npm.' }).agent;
    assert.equal(a.instructions, 'pnpm, no npm.');
    // they are the folder's: another agent in the same folder shares them
    assert.equal(store.createAgent({ path: dir, harness: 'claude-code' }).agent.instructions, 'pnpm, no npm.');
    assert.equal(store.updateAgent(a.id, { instructions: 'pnpm test antes de cerrar.' }).agent.instructions, 'pnpm test antes de cerrar.');
    assert.equal(store.getProjectInstructions(`${dir}/`), 'pnpm test antes de cerrar.', 'por su ruta real');
    assert.equal(store.setProjectInstructions(dir, '').instructions, '');
    assert.equal(store.getProjectInstructions(dir), '');
    assert.equal(store.setProjectInstructions('relativa', 'x').ok, false);
    assert.equal(store.setProjectInstructions('/no/existe', 'x').ok, false);
  } finally { store.close(); }
});

test('las indicaciones van arriba del encargo, bajo la línea 📁, y la oficina las saca del título de la pizarra', () => {
  const store = openStore(':memory:');
  try {
    store.createOffice({ name: 'Pagos', instructions: 'Montos en centavos.' });
    const dir = tmp();
    store.createAgent({ path: dir, harness: 'pi', name: 'tienda', office: 'pagos', instructions: 'pnpm, no npm.\n\nTests: pnpm test.' });
    fs.mkdirSync(path.join(dir, 'src'));
    // a subfolder of the project is still the project
    const g = guideFor(store, path.join(dir, 'src'));
    assert.deepEqual([g.department.name, g.project.name], ['Pagos', 'tienda']);
    const head = guideText(g);
    assert.equal(head, '📋 Indicaciones del departamento «Pagos»:\n│ Montos en centavos.\n📋 Indicaciones del proyecto «tienda»:\n│ pnpm, no npm.\n│\n│ Tests: pnpm test.');
    const brief = scoped('Agregar paginación', dir, head);
    assert.match(brief, /^📁 Trabaja sólo dentro de .*\n📋 Indicaciones del departamento «Pagos»:\n│ Montos en centavos\.\n📋 Indicaciones del proyecto «tienda»:\n│ pnpm, no npm\.\n│\n│ Tests: pnpm test\.\n\nAgregar paginación$/);
    assert.equal(unguided(brief), 'Agregar paginación');
    assert.equal(unguided(scoped('Solo el alcance', dir)), 'Solo el alcance', 'sin indicaciones, como antes');
    assert.equal(scoped('Sin nada', null, ''), 'Sin nada');
    // a folder without a registered project and without instructions: nothing
    assert.equal(guideText(guideFor(store, tmp())), '');
  } finally { store.close(); }
});

test('en el servidor: el encargo para Claude, el título de la sesión y la pregunta llevan las indicaciones (y el estilo de quien contesta)', async () => {
  const log = path.join(tmp(), 'btw.jsonl');
  const saved = { bin: process.env.DEV_TEAM_OFFICE_CLAUDE_BIN, log: process.env.FAKE_BTW_LOG };
  Object.assign(process.env, { DEV_TEAM_OFFICE_CLAUDE_BIN: FAKE_BTW, FAKE_BTW_LOG: log });
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const dir = tmp();
    assert.equal((await call(server.url, 'POST', '/v1/offices', { name: 'Pagos', instructions: 'Montos en centavos.' })).status, 201);
    const a = (await call(server.url, 'POST', '/v1/agents', { path: dir, harness: 'claude-code', name: 'tienda', office: 'Pagos', instructions: 'pnpm, no npm.' })).body.agent;
    assert.equal(a.instructions, 'pnpm, no npm.', 'el mantenedor la devuelve');
    assert.equal((await call(server.url, 'GET', '/v1/offices/pagos')).body.office.instructions, 'Montos en centavos.');

    // the session's title is the task, without the office's header
    const prompt = server.hub.brief('Cobros con QR', dir, { office: 'pagos' });
    assert.match(prompt, /📋 Indicaciones del proyecto «tienda»:\n│ pnpm, no npm\./);
    server.company.ingest('claude-code', { session_id: 'sess-q', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt });
    assert.equal(server.company.session('sess-q').title, 'Cobros con QR');

    // a brief queued for that Claude session gets its instructions when Claude ends its turn
    const sent = server.hub.submit({ text: 'Agregar paginación', agent: 'claude-code', session: 'sess-q' });
    assert.equal(sent.ok, true, sent.error);
    const stop = await call(server.url, 'POST', '/v1/hooks/claude-code', { session_id: 'sess-q', cwd: dir, hook_event_name: 'Stop' });
    assert.match(stop.body.task.text, /^📋 Modo autónomo: .*\n📋 Indicaciones del departamento «Pagos»:\n│ Montos en centavos\.\n📋 Indicaciones del proyecto «tienda»:\n│ pnpm, no npm\.\n\nAgregar paginación$/);

    // the question: the instructions and the style of whom it was asked (a concise QA)
    assert.equal((await call(server.url, 'PUT', '/v1/settings', { office: 'pagos', appearance: { qa: { style: 'concise' } } })).status, 200);
    const res = await call(server.url, 'POST', '/v1/ask', { text: '¿qué falta?', role: 'qa', session: 'sess-q', office: 'pagos', wait: true });
    assert.equal(res.body.ok, true, res.body.error);
    const asked = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1).args.join(' ');
    assert.match(asked, /Montos en centavos/);
    assert.match(asked, /pnpm, no npm/);
    assert.match(asked, /Contesta en una o dos oraciones cortas/, 'el estilo conciso');
    assert.doesNotMatch(asked, /a lo más 3 oraciones/, 'no el normal');
  } finally {
    await server.close();
    for (const [k, v] of [['DEV_TEAM_OFFICE_CLAUDE_BIN', saved.bin], ['FAKE_BTW_LOG', saved.log]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    applyAppearance({});
  }
});

test('un personaje se exporta como JSON y se importa en otro rol u oficina; lo que no se entiende se ignora', async () => {
  const look = { ...TEAM.qa, name: 'Pilar', sex: 'f', personality: 'chatty', style: 'teacher', hair: '#b8322a' };
  const c = exportCharacter('qa', look);
  assert.equal(c.kind, CHARACTER_KIND);
  assert.deepEqual([c.role, c.name, c.sex, c.personality, c.style, c.hair], ['qa', 'Pilar', 'f', 'chatty', 'teacher', '#b8322a']);
  assert.equal(c.title, undefined, 'el cargo por defecto no viaja (cada idioma tiene el suyo)');
  assert.equal(characterFile('qa', 'Pilar Núñez'), 'pilar-nunez-qa.json');

  const back = parseCharacter(JSON.stringify({ ...c, style: 'gritón', shirt: 'rojo', extra: 1, title: 'QA Lead' }));
  assert.equal(back.ok, true);
  assert.equal(back.role, 'qa');
  assert.equal(back.look.style, undefined, 'un estilo desconocido no entra');
  assert.equal(back.look.shirt, undefined, 'ni un color que no es color');
  assert.equal(back.look.extra, undefined);
  assert.equal(back.look.title, 'QA Lead');
  assert.deepEqual(parseCharacter('no es json'), { ok: false, error: 'json' });
  assert.deepEqual(parseCharacter({ name: 'x' }), { ok: false, error: 'kind' });
  assert.deepEqual(changedLook('qa', { name: TEAM.qa.name, style: 'formal' }), { style: 'formal' });

  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    // it is imported as the backend of the Payments office
    await call(server.url, 'POST', '/v1/offices', { name: 'Pagos' });
    let r = await call(server.url, 'PUT', '/v1/characters/backend?office=pagos', c);
    assert.equal(r.status, 200, r.body.error);
    assert.deepEqual(server.store.getAppearance('pagos').backend, changedLook('backend', parseCharacter(c).look), 'what differs from the original backend is saved');
    r = await call(server.url, 'GET', '/v1/characters/backend?office=pagos');
    assert.deepEqual([r.body.kind, r.body.role, r.body.name, r.body.style], [CHARACTER_KIND, 'backend', 'Pilar', 'teacher']);
    assert.equal((await call(server.url, 'GET', '/v1/characters/backend')).body.name, 'Diego', 'la oficina principal no cambió');
    assert.equal((await call(server.url, 'PUT', '/v1/characters/backend', { name: 'x' })).status, 400);
    assert.equal((await call(server.url, 'GET', '/v1/characters/nadie')).status, 404);
  } finally { await server.close(); }
});

test('la CLI: departamentos y proyectos con indicaciones, y personajes que se exportan e importan', () => {
  const home = tmp('dto-dept-cli-');
  const env = { PATH: process.env.PATH, HOME: home, LANG: 'es_CL.UTF-8', DEV_TEAM_OFFICE_LANG: 'es', DEV_TEAM_OFFICE_DB: path.join(home, 'office.db'), DEV_TEAM_OFFICE_PORT: '1', DEV_TEAM_OFFICE_SOCKET: path.join(home, 'none.sock'), DEV_TEAM_OFFICE_WEATHER: 'off' };
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'dev-team-office.js'), ...args], { env, encoding: 'utf8', timeout: 20000 });
  let r = cli('departments', 'add', 'Pagos', '--instructions', 'Montos en centavos.');
  assert.equal(r.status, 0, r.stderr);
  const dir = tmp();
  r = cli('agents', 'add', dir, '--agent', 'pi', '--name', 'tienda', '--office', 'pagos', '--instructions', 'pnpm, no npm.');
  assert.equal(r.status, 0, r.stderr);
  r = cli('agents');
  assert.match(r.stdout, /📋 pnpm, no npm\./);
  r = cli('agents', 'set', 'tienda-pi', '--instructions', 'pnpm test antes de cerrar.');
  assert.equal(r.status, 0, r.stderr);

  const out = path.join(home, 'chars');
  fs.mkdirSync(out);
  r = cli('character', 'export', 'qa', '--out', `${out}/`);
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(out, 'andres-qa.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([json.kind, json.role, json.name, json.personality, json.style], [CHARACTER_KIND, 'qa', 'Andrés', 'anxious', 'normal']);
  fs.writeFileSync(file, JSON.stringify({ ...json, name: 'Pilar', style: 'explanatory' }));
  r = cli('character', 'import', file, '--role', 'tl', '--office', 'pagos');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Pilar es ahora el tl de pagos/);
  r = cli('character', 'import', path.join(home, 'office.db'));
  assert.notEqual(r.status, 0, 'un archivo que no es un personaje');

  const store = openStore(env.DEV_TEAM_OFFICE_DB);
  try {
    assert.equal(store.findOffice('pagos').instructions, 'Montos en centavos.');
    assert.equal(store.getProjectInstructions(dir), 'pnpm test antes de cerrar.');
    assert.deepEqual([store.getAppearance('pagos').tl.name, store.getAppearance('pagos').tl.style], ['Pilar', 'explanatory']);
  } finally { store.close(); }
});
