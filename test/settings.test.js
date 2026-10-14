// ⚙ Ajustes: la oficina sólo guarda lo suyo (la apariencia de los personajes). Lo de los
// agentes (equipo, modelos, pipelines) vive en su proyecto y no se toca desde aquí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-settings-'));
process.env.DEV_TEAM_OFFICE_CONFIG = path.join(tmp, 'config.json'); // nunca el config real
const saved = () => JSON.parse(fs.readFileSync(process.env.DEV_TEAM_OFFICE_CONFIG, 'utf8'));

const call = (base, method, p, body, headers = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('⚙ Personajes: se validan, se guardan con permisos 0600 y se aplican en caliente', async () => {
  // restos de versiones anteriores (configuración de agentes): se limpian al guardar
  fs.writeFileSync(process.env.DEV_TEAM_OFFICE_CONFIG, JSON.stringify({ launchers: { pi: ['pi'] }, projects: ['/x'], cwd: '/x' }));
  const server = await startServer({ port: 0, socket: null });
  const ws = new (await import('ws')).default(server.url.replace('http', 'ws') + '/v1/ws');
  const live = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'appearance') live.push(m.appearance); });
  await new Promise((r) => ws.on('open', r));
  try {
    let r = await call(server.url, 'GET', '/v1/settings');
    assert.deepEqual(r.body.office.appearance, {});

    r = await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: { name: 'Andrea', shirt: '#AA3344', glasses: true }, arquitecto: { title: 'Arquitecto' } } });
    assert.equal(r.status, 200, r.body.error);
    assert.deepEqual(saved(), { appearance: { qa: { name: 'Andrea', shirt: '#aa3344', glasses: true }, tl: { title: 'Arquitecto' } } });
    assert.equal(fs.statSync(process.env.DEV_TEAM_OFFICE_CONFIG).mode & 0o777, 0o600);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(live.at(-1).qa.name, 'Andrea'); // las interfaces abiertas lo ven al instante
    assert.equal((await call(server.url, 'GET', '/v1/state')).body.appearance.tl.title, 'Arquitecto');

    // lo inválido no toca el archivo
    for (const bad of [{ qa: { shirt: 'rojo' } }, { mago: { name: 'x' } }, { qa: { hat: true } }, { qa: { name: '  ' } }]) {
      r = await call(server.url, 'PUT', '/v1/settings', { appearance: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(saved().appearance.qa.name, 'Andrea');

    // null = volver al original
    await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: null, tl: null } });
    assert.deepEqual(saved(), {});

    // la configuración de los agentes ya no se edita desde la oficina
    assert.equal((await call(server.url, 'PUT', '/v1/settings/team', { dir: tmp, team: {} })).status, 404);

    // un sitio web ajeno no puede cambiar nada
    r = await call(server.url, 'PUT', '/v1/settings', { appearance: { qa: { name: 'X' } } }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  } finally {
    ws.close();
    await server.close();
  }
});
