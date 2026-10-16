// ⚙ Ajustes: la apariencia de los personajes, guardada en la base SQLite de la oficina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';

const call = (base, method, p, body, headers = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('⚙ Personajes: se validan, se guardan y se aplican en caliente', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:' });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const live = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'appearance') live.push(m.appearance); });
  await new Promise((r) => ws.on('open', r));
  try {
    let r = await call(server.url, 'GET', '/v1/settings');
    assert.deepEqual(r.body.office.appearance, {});
    assert.equal(r.body.office.file, ':memory:');

    r = await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: { name: 'Andrea', shirt: '#AA3344', glasses: true }, arquitecto: { title: 'Arquitecto' } } });
    assert.equal(r.status, 200, r.body.error);
    assert.deepEqual(server.store.getAppearance(), { qa: { name: 'Andrea', shirt: '#aa3344', glasses: true }, tl: { title: 'Arquitecto' } });
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(live.at(-1).qa.name, 'Andrea'); // las interfaces abiertas lo ven al instante
    assert.equal((await call(server.url, 'GET', '/v1/state')).body.appearance.tl.title, 'Arquitecto');

    // lo inválido no toca nada
    for (const bad of [{ qa: { shirt: 'rojo' } }, { mago: { name: 'x' } }, { qa: { hat: true } }, { qa: { name: '  ' } }]) {
      r = await call(server.url, 'PUT', '/v1/settings', { appearance: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(server.store.getAppearance().qa.name, 'Andrea');

    // null = volver al original
    await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: null, tl: null } });
    assert.deepEqual(server.store.getAppearance(), {});

    // un sitio web ajeno no puede cambiar nada (ni registrar agentes)
    r = await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: { name: 'X' } } }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    r = await call(server.url, 'POST', '/v1/agents', { path: '/', harness: 'pi' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  } finally {
    ws.close();
    await server.close();
  }
});
