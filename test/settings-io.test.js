// Your settings as a JSON file (server/settings-io.js): what is yours (the general settings, the
// departments with their characters, the projects with their instructions) is exported and imported;
// what belongs to the game or is history is not; a project whose folder is not here is skipped.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/server.js';
import { exportSettings, importSettings, parseSettings, SETTINGS_KIND } from '../server/settings-io.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-settings-')));
const office = () => startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 } });
const put = (server, body) => fetch(`${server.url}/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
/** An export without what changes every time. */
const same = (x) => { const { exportedAt, app, ...rest } = x; return rest; };

test('exportar: lo tuyo (ajustes, departamentos con sus personajes, proyectos con sus indicaciones), sin historial ni dónde estás mirando', async () => {
  const server = await office();
  const dir = tmp();
  try {
    server.store.setPrefs({ lang: 'es', timezone: 'America/Santiago', standards: 'Todo con tests.', capacity: 5, view: { mode: 'iso', floor: 'exec' }, autonomy: { clarify: false } });
    const pagos = server.store.createOffice({ name: 'Pagos', timezone: 'Europe/Madrid', instructions: 'Todo en euros.', autonomy: 'guided' }).office;
    server.store.setAppearance({ backend: { name: 'Bruno', shirt: '#123456' }, devops: { name: 'Rafa B' } }, pagos.id);
    server.store.createAgent({ path: dir, harness: 'claude-code', name: 'Tienda', office: pagos.id, instructions: 'pnpm, no npm.' });
    server.company.ingest('generic', { session: 's1', kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'algo' });
    const res = await fetch(`${server.url}/v1/settings/export`);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="dev-team-office-settings-\d{4}-\d{2}-\d{2}\.json"/);
    const x = await res.json();
    assert.equal(x.kind, SETTINGS_KIND);
    assert.equal(x.version, 1);
    assert.match(x.app, /^\d+\.\d+\.\d+$/);
    assert.equal(x.prefs.standards, 'Todo con tests.');
    assert.equal(x.prefs.capacity, 5);
    assert.deepEqual(x.prefs.view, { mode: 'iso' }, 'cómo se ve el juego, no qué piso estás mirando');
    assert.equal(x.prefs.autonomy.clarify, false);
    assert.ok(x.prefs.models?.profiles, 'los perfiles de modelos');
    const p = x.departments.find((o) => o.id === 'pagos');
    assert.deepEqual([p.name, p.timezone, p.instructions, p.autonomy], ['Pagos', 'Europe/Madrid', 'Todo en euros.', 'guided']);
    assert.deepEqual(p.characters, { backend: { name: 'Bruno', shirt: '#123456' }, devops: { name: 'Rafa B' } });
    assert.deepEqual(x.projects, [{ name: 'Tienda', path: dir, harness: 'claude-code', department: 'pagos', instructions: 'pnpm, no npm.' }]);
    assert.deepEqual(Object.keys(x).sort(), ['app', 'departments', 'exportedAt', 'instructions', 'kind', 'prefs', 'projects', 'version'], 'ni la bitácora, ni encargos, ni directivas, ni el archivo');
    assert.ok(!JSON.stringify(x).includes('algo'), 'nada de la bitácora');
  } finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('importar en otra oficina deja todo igual; lo que el archivo no trae se queda; los proyectos sin carpeta aquí se saltan', async () => {
  const a = await office();
  const b = await office();
  const dir = tmp();
  try {
    a.store.setPrefs({ lang: 'es', standards: 'PRs chicos.', capacity: 2, view: { mode: 'iso' }, weather: false });
    const pagos = a.store.createOffice({ name: 'Pagos', instructions: 'Euros.' }).office;
    a.store.setAppearance({ qa: { name: 'Ana', sex: 'f' } }, pagos.id);
    a.store.setAppearance({ manager: { name: 'Jefa' } }, 'main');
    const api = a.store.createAgent({ path: dir, harness: 'pi', name: 'Api', office: pagos.id, instructions: 'Go 1.23.' }).agent;
    a.store.addComponent({ project: api.path, name: 'cobranza', path: 'src/cobranza', description: 'los cobros' });
    const file = await (await fetch(`${a.url}/v1/settings/export`)).json();
    file.projects.push({ name: 'Lejos', path: '/no/existe/aqui', harness: 'pi', department: 'pagos' });
    // b had something of its own: it stays (merge), except the characters of a department the file brings
    b.store.setAppearance({ tl: { name: 'Otro' } }, 'main');
    const extra = b.store.createOffice({ name: 'Diseño' }).office;
    const out = await (await fetch(`${b.url}/v1/settings/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) })).json();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.skipped.map((s) => s.what), ['Proyecto Lejos']);
    assert.match(out.skipped[0].error, /\/no\/existe\/aqui/);
    assert.equal(out.applied.projects, 1);
    assert.equal(out.applied.components, 1, 'los componentes que declaraste, también');
    assert.deepEqual(b.store.listComponents().map((c) => [c.name, c.path, c.description]), [['cobranza', 'src/cobranza', 'los cobros']]);
    assert.equal(out.lang, 'es');
    // the same as a (what the file brings)
    const again = exportSettings(b.store);
    assert.deepEqual(same(again).prefs, same(file).prefs);
    assert.deepEqual(again.projects, file.projects.slice(0, 1));
    assert.deepEqual(again.departments.find((o) => o.id === 'pagos'), file.departments.find((o) => o.id === 'pagos'));
    assert.deepEqual(b.store.getAppearance('main'), { manager: { name: 'Jefa' } }, 'los personajes de un departamento quedan como en el archivo');
    assert.ok(b.store.getOffice(extra.id), 'lo que el archivo no trae se queda');
    assert.equal(b.company.info('pagos').name, 'Pagos', 'la empresa ya lo ve');
    // again: idempotent
    const twice = importSettings(b.store, file);
    assert.equal(twice.ok, true);
    assert.equal(b.store.listAgents().length, 1, 'no duplica proyectos');
    assert.equal(b.store.listOffices().filter((o) => o.name === 'Pagos').length, 1, 'ni departamentos');
  } finally { await a.close(); await b.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('un archivo que no es de ajustes no se toca; un ajuste malo no tumba a los demás', async () => {
  const server = await office();
  try {
    assert.match(parseSettings('{no').error, /no es JSON/);
    assert.match(parseSettings({ kind: 'dev-team-office/character' }).error, /no son ajustes/);
    assert.match(parseSettings({ kind: SETTINGS_KIND, version: 99 }).error, /versión más nueva/);
    const res = await fetch(`${server.url}/v1/settings/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'x' }) });
    assert.equal(res.status, 400);
    const out = importSettings(server.store, { kind: SETTINGS_KIND, version: 1, prefs: { capacity: 99, standards: 'Bien.', nope: 1, herdr: { startAgent: 'no-esta' } } });
    assert.equal(out.ok, true);
    assert.deepEqual(out.skipped.map((s) => s.what).sort(), ['Ajuste capacity', 'Ajuste nope']);
    assert.equal(server.store.getPrefs().standards, 'Bien.');
    assert.equal(server.store.getPrefs().herdr.startAgent, 'auto', 'un agente que no está aquí: el automático');
    await put(server, { prefs: { lang: 'es' } });
  } finally { await server.close(); }
});

test('la CLI: settings export a un archivo y settings import en otra máquina (sin oficina corriendo)', async () => {
  const { spawnSync } = await import('node:child_process');
  const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const homes = [tmp(), tmp()];
  const dir = tmp();
  const envOf = (home) => ({ PATH: process.env.PATH, HOME: home, DEV_TEAM_OFFICE_LANG: 'es', DEV_TEAM_OFFICE_DB: path.join(home, 'office.db'), DEV_TEAM_OFFICE_PORT: '1', DEV_TEAM_OFFICE_SOCKET: path.join(home, 'none.sock'), DEV_TEAM_OFFICE_WEATHER: 'off' });
  const cli = (home, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'dev-team-office.js'), ...args], { env: envOf(home), encoding: 'utf8', timeout: 20000 });
  try {
    assert.equal(cli(homes[0], 'departments', 'add', 'Pagos', '--instructions', 'Euros.').status, 0);
    assert.equal(cli(homes[0], 'agents', 'add', dir, '--agent', 'pi', '--name', 'tienda', '--office', 'pagos', '--instructions', 'pnpm.').status, 0);
    assert.equal(cli(homes[0], 'config', 'view.mode', 'iso').status, 0);
    const file = path.join(homes[0], 'mis-ajustes.json');
    let r = cli(homes[0], 'settings', 'export', '--out', file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ajustes exportados a/);
    r = cli(homes[1], 'settings', 'import', file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ajustes importados: \d+ ajustes, 2 departamentos, 0 personajes, 1 proyectos, 0 componentes\./);
    r = cli(homes[1], 'settings', 'export');
    const x = JSON.parse(r.stdout);
    assert.deepEqual(x.prefs.view, { mode: 'iso' });
    assert.deepEqual(x.projects.map((p) => [p.name, p.department, p.instructions]), [['tienda', 'pagos', 'pnpm.']]);
    assert.equal(cli(homes[1], 'settings').status, 1, 'sin subcomando: el uso');
  } finally { for (const d of [...homes, dir]) fs.rmSync(d, { recursive: true, force: true }); }
});
