// Several offices (teams or domains) in the same instance, like a real company: the database
// keeps them, each event goes to its office and each viewer sees only the office it chose.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { openStore } from '../server/store.js';
import { Company } from '../server/company.js';
import { startServer } from '../server/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dto-offices-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('la base: oficinas con nombre, zona horaria y ubicación; la principal no se elimina', () => {
  const store = openStore(':memory:');
  assert.deepEqual(store.listOffices().map((o) => o.id), ['main']);
  let r = store.createOffice({ name: 'Pagos', timezone: 'Europe/Madrid', location: 'Madrid' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.office.id, r.office.name, r.office.timezone, r.office.location], ['pagos', 'Pagos', 'Europe/Madrid', 'Madrid']);
  for (const [bad, rx] of [[{}, /nombre/], [{ name: 'pagos' }, /ya hay una oficina/], [{ name: 'X', timezone: 'Marte/Olympus' }, /zona horaria desconocida/]]) {
    assert.match(store.createOffice(bad).error, rx, JSON.stringify(bad));
  }
  assert.equal(store.updateOffice('pagos', { timezone: null }).office.timezone, null);
  assert.equal(store.findOffice('PAGOS').id, 'pagos', 'por nombre, sin mayúsculas');

  // that office's agents; when it is deleted they move to the main one and its appearance is forgotten
  const dir = tmp();
  const a = store.createAgent({ path: dir, harness: 'pi', office: 'Pagos' });
  assert.equal(a.agent.office, 'pagos');
  assert.match(store.createAgent({ path: dir, harness: 'claude', office: 'nada' }).error, /oficina desconocida/);
  assert.equal(store.setAppearance({ qa: { name: 'Pilar' } }, 'pagos').ok, true);
  assert.deepEqual(store.getAppearance('pagos'), { qa: { name: 'Pilar' } });
  assert.deepEqual(store.getAppearance(), {}, 'cada oficina tiene sus personajes');
  store.setPrefs({ view: { office: 'pagos' } });
  assert.match(store.deleteOffice('main').error, /principal/);
  assert.equal(store.deleteOffice('pagos').ok, true);
  assert.equal(store.getAgent(a.agent.id).office, 'main');
  assert.deepEqual(store.getAppearance('pagos'), {});
  assert.equal(store.getPrefs().view.office, 'main', 'la que se miraba ya no existe');
});

test('los ajustes generales se validan y se guardan', () => {
  const store = openStore(':memory:');
  const p = store.getPrefs();
  assert.deepEqual([p.lang, p.timezone, p.weather, p.herdr.launch, p.herdr.direction, p.herdr.startAgent, p.log.life, p.view.office], ['es', null, true, true, 'right', 'auto', false, 'main']);
  assert.equal(store.setPrefs({ timezone: 'Asia/Tokyo', herdr: { direction: 'down' }, log: { life: true } }).ok, true);
  assert.deepEqual([store.getPrefs().timezone, store.getPrefs().herdr.direction, store.getPrefs().herdr.launch, store.getPrefs().log.life], ['Asia/Tokyo', 'down', true, true]);
  for (const [bad, rx] of [[{ lang: 'fr' }, /idioma/], [{ timezone: 'Nada/Nada' }, /zona horaria/], [{ weather: 'sí' }, /weather/], [{ herdr: { direction: 'up' } }, /direction/], [{ view: { office: 'x' } }, /oficina/], [{ color: 1 }, /ajuste desconocido/]]) {
    assert.match(store.setPrefs(bad).error, rx, JSON.stringify(bad));
  }
  assert.equal(store.getPrefs().timezone, 'Asia/Tokyo', 'lo inválido no toca nada');
});

test('una base de la versión anterior se migra: la oficina principal y la oficina de cada agente', () => {
  const file = path.join(tmp(), 'office.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, harness TEXT NOT NULL, bin TEXT, args TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (path, harness));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE prompts (id TEXT PRIMARY KEY, agent_id TEXT, agent TEXT NOT NULL, entry TEXT, text TEXT NOT NULL, session TEXT, mode TEXT NOT NULL, cwd TEXT, status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO agents VALUES ('viejo-pi', 'viejo', '/tmp', 'pi', NULL, NULL, 1, 1);
    PRAGMA user_version = 1;`);
  db.close();
  const store = openStore(file);
  assert.deepEqual(store.listOffices().map((o) => o.id), ['main']);
  assert.equal(store.getAgent('viejo-pi').office, 'main');
  store.close();
});

test('cada evento va a su oficina: la que dice, la de su sesión, la de su pane o la de la ruta del agente', () => {
  const store = openStore(':memory:');
  const root = tmp(), sub = path.join(root, 'pagos');
  fs.mkdirSync(sub);
  store.createOffice({ name: 'Pagos' });
  store.createOffice({ name: 'Web' });
  store.createAgent({ path: root, harness: 'claude', office: 'web' });
  store.createAgent({ path: sub, harness: 'claude', office: 'pagos' });
  const company = new Company({ store });
  const seen = [];
  company.on('event', (id, ev) => seen.push([id, ev.session]));
  company.ingest('claude-code', { hook_event_name: 'SessionStart', session_id: 'a', cwd: path.join(sub, 'src') });
  company.ingest('claude-code', { hook_event_name: 'SessionStart', session_id: 'b', cwd: root });
  company.ingest('claude-code', { hook_event_name: 'SessionStart', session_id: 'c', cwd: '/otra/parte' });
  company.ingest('generic', { kind: 'session_start', session: 'd', office: 'web', cwd: sub });
  company.bindPane('w1:p3', 'pagos');
  company.ingest('claude-code', { hook_event_name: 'SessionStart', session_id: 'e', cwd: '/otra', herdr_pane: 'w1:p3' });
  // a known session stays in its office even if it changes folder
  company.ingest('claude-code', { hook_event_name: 'Stop', session_id: 'a', cwd: root });
  assert.deepEqual(seen, [['pagos', 'a'], ['web', 'b'], ['main', 'c'], ['web', 'd'], ['pagos', 'e'], ['pagos', 'a']]);
  assert.equal(company.session('a').office, 'pagos');
  assert.deepEqual(company.list().map((o) => [o.id, o.agents]), [['main', 0], ['pagos', 1], ['web', 1]]);
});

test('el servidor: cada visor recibe sólo la oficina que mira; la elección queda guardada', async () => {
  const store = openStore(':memory:');
  const server = await startServer({ port: 0, socket: null, db: store, weather: false });
  const open = async () => {
    const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    return { ws, got };
  };
  try {
    let r = await call(server.url, 'POST', '/v1/offices', { name: 'Pagos', timezone: 'Asia/Tokyo' });
    assert.equal(r.status, 201, r.body.error);
    const a = await open(), b = await open();
    await sleep(50);
    assert.equal(a.got.find((m) => m.type === 'snapshot').state.office.id, 'main');
    assert.deepEqual(a.got.find((m) => m.type === 'snapshot').state.offices.map((o) => o.id), ['main', 'pagos']);
    b.ws.send(JSON.stringify({ type: 'view', office: 'pagos' }));
    await sleep(80);
    const snap = b.got.filter((m) => m.type === 'snapshot').at(-1).state;
    assert.equal(snap.office.id, 'pagos');
    assert.equal(snap.office.timezone, 'Asia/Tokyo');
    assert.equal(snap.office.country, 'JP');
    assert.equal(store.getPrefs().view.office, 'pagos', 'la oficina elegida queda guardada');
    // a Pagos event is only seen by whoever watches Pagos
    await call(server.url, 'POST', '/v1/events/generic', { session: 'p1', office: 'pagos', kind: 'task', text: 'Cobros con QR' });
    await call(server.url, 'POST', '/v1/events/generic', { session: 'm1', kind: 'task', text: 'Landing nueva' });
    await sleep(80);
    const texts = (c) => c.got.filter((m) => m.type === 'event').map((m) => m.event.text);
    assert.deepEqual(texts(a), ['Landing nueva']);
    assert.deepEqual(texts(b), ['Cobros con QR']);
    // the viewer's chat goes to its office; /v1/state?office= shows another one
    b.ws.send(JSON.stringify({ type: 'chat', text: 'hola Pagos' }));
    await sleep(60);
    assert.ok(texts(b).includes('hola Pagos') && !texts(a).includes('hola Pagos'));
    r = await call(server.url, 'GET', '/v1/state?office=pagos');
    assert.deepEqual(r.body.sessions.filter((s) => s.id !== 'office').map((s) => s.title), ['Cobros con QR']);
    // the appearance belongs to each office
    r = await call(server.url, 'PUT', '/v1/settings', { office: 'pagos', appearance: { qa: { name: 'Pilar' } } });
    assert.equal(r.status, 200, r.body.error);
    await sleep(50);
    assert.equal(b.got.filter((m) => m.type === 'appearance').at(-1)?.appearance.qa.name, 'Pilar');
    assert.ok(!a.got.some((m) => m.type === 'appearance'));
    // renaming and deleting is broadcast to everyone (for the selector)
    await call(server.url, 'PUT', '/v1/offices/pagos', { name: 'Pagos LatAm' });
    await sleep(50);
    assert.equal(a.got.filter((m) => m.type === 'offices').at(-1).offices[1].name, 'Pagos LatAm');
    assert.equal((await call(server.url, 'DELETE', '/v1/offices/main')).status, 400);
    a.ws.close(); b.ws.close();
  } finally {
    await server.close();
  }
});

test('la zona horaria de cada oficina: la suya, si no la de la empresa, si no la del sistema', async () => {
  const store = openStore(':memory:');
  const company = new Company({ store });
  store.createOffice({ name: 'Tokio', timezone: 'Asia/Tokyo' });
  store.createOffice({ name: 'Remota' });
  company.load();
  const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(company.zoneOf('tokio'), 'Asia/Tokyo');
  assert.equal(company.zoneOf('remota'), sys);
  store.setPrefs({ timezone: 'America/Santiago' });
  assert.equal(company.zoneOf('remota'), 'America/Santiago');
  assert.deepEqual([company.info('remota').country, company.info('remota').city], ['CL', 'Santiago']);
});
