// Starting over (⚙ › Backup): only the parts you choose go back to the first day, all at once, and the
// repositories' folders are never touched.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, DEFAULT_AREA } from '../server/store.js';
import { startServer } from '../server/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dto-reset-'));
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

/** A company with something of everything. */
function filled(store, dir) {
  store.setPrefs({ lang: 'en', standards: 'Commits convencionales.' });
  store.createArea({ name: 'Tecnología', instructions: 'Con su prueba.' });
  store.createOffice({ name: 'Loyalty', area: 'tecnologia' });
  store.updateOffice('main', { name: 'Casa', instructions: 'Hola.' });
  const core = store.createAgent({ path: path.join(dir, 'core'), harness: 'claude-code', name: 'core', office: 'loyalty' }).agent;
  const bff = store.createAgent({ path: path.join(dir, 'bff'), harness: 'claude-code', name: 'bff', office: 'loyalty' }).agent;
  store.saveRelation({ from: bff.id, to: core.id, how: 'calls' });
  store.setAppearance({ tl: { name: 'Tito' } });
  store.saveExpert({ skill: 'pagos', look: { name: 'Ana' } });
  store.savePrompt({ id: 'p1', agent: 'pi', text: 'hola', status: 'done' });
  store.createKnowledge({ kind: 'note', title: 'Cómo desplegamos', body: 'Con el pipeline.' });
}

test('sólo lo elegido vuelve al primer día; la empresa deja la oficina principal vacía y no toca las carpetas', () => {
  const store = openStore(':memory:');
  const dir = tmp();
  for (const d of ['core', 'bff']) fs.mkdirSync(path.join(dir, d));
  try {
    filled(store, dir);
    assert.equal(store.reset([]).ok, false, 'sin elegir nada, nada');
    assert.equal(store.reset(['nada']).ok, false);

    let r = store.reset(['company', 'activity']);
    assert.deepEqual(r, { ok: true, reset: ['company', 'activity'] });
    assert.deepEqual(store.listOffices().map((o) => [o.id, o.name, o.area]), [['main', '', DEFAULT_AREA]]);
    assert.equal(store.getOffice('main').instructions || '', '');
    assert.deepEqual(store.listAreas().map((a) => a.id), [DEFAULT_AREA]);
    assert.deepEqual(store.listAgents(), []);
    assert.deepEqual(store.listRelations(), []);
    assert.deepEqual(store.listPrompts(), []);
    assert.ok(fs.existsSync(path.join(dir, 'core')), 'la carpeta del repo sigue ahí');
    // what was not chosen stays
    assert.equal(store.getPrefs().standards, 'Commits convencionales.');
    assert.equal(store.getAppearance().tl?.name, 'Tito');
    assert.equal(store.listExperts().length, 1);
    assert.equal(store.listKnowledge({}).length, 1);

    r = store.reset(['prefs', 'look', 'archive']);
    assert.equal(r.ok, true, r.error);
    assert.equal(store.getPrefs().standards || '', '');
    assert.equal(store.getAppearance().tl, undefined);
    assert.deepEqual(store.listExperts(), []);
    assert.deepEqual(store.listKnowledge({}), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('por la API: POST /v1/reset, y los clientes se enteran de las oficinas que quedan', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, loops: { autostart: false } });
  const dir = tmp();
  try {
    await call(server.url, 'POST', '/v1/offices', { name: 'Loyalty' });
    await call(server.url, 'POST', '/v1/agents', { path: dir, harness: 'claude-code', office: 'loyalty', bin: '/nonexistent' });
    let r = await call(server.url, 'POST', '/v1/reset', {});
    assert.equal(r.status, 400);
    r = await call(server.url, 'POST', '/v1/reset', { parts: ['company'] });
    assert.deepEqual(r.body, { ok: true, reset: ['company'] });
    r = await call(server.url, 'GET', '/v1/offices');
    assert.deepEqual(r.body.offices.map((o) => o.id), ['main']);
    r = await call(server.url, 'GET', '/v1/agents');
    assert.deepEqual(r.body.agents.filter((a) => a.registered), []);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
