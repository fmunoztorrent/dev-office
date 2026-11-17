// The company's areas (Technology, Operations…): each groups projects (offices), its instructions go on
// top of every brief of its projects, and deleting one never loses a project.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, DEFAULT_AREA } from '../server/store.js';
import { startServer } from '../server/server.js';
import { guideFor, guideText } from '../server/guides.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dto-areas-'));
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('la base: la general siempre está; un área con nombre único; borrarla manda sus proyectos a la general', () => {
  const store = openStore(':memory:');
  assert.deepEqual(store.listAreas().map((a) => a.id), [DEFAULT_AREA]);
  assert.equal(store.getOffice('main').area, DEFAULT_AREA, 'la oficina principal está en la general');
  const tec = store.createArea({ name: 'Tecnología', instructions: 'Todo cambio con su prueba.' });
  assert.equal(tec.ok, true, tec.error);
  assert.equal(tec.area.id, 'tecnologia');
  assert.match(store.createArea({ name: 'tecnologia' }).error, /ya hay un área/i);
  assert.match(store.createArea({ name: '  ' }).error, /nombre/i);
  assert.equal(store.findArea('TECNOLOGÍA').id, 'tecnologia', 'por nombre, sin mayúsculas ni tildes');

  const loyalty = store.createOffice({ name: 'Loyalty', area: 'Tecnología' });
  assert.equal(loyalty.ok, true, loyalty.error);
  assert.equal(loyalty.office.area, 'tecnologia', 'el área se puede dar por su nombre');
  assert.equal(store.updateOffice('loyalty', { area: DEFAULT_AREA }).office.area, DEFAULT_AREA);
  store.updateOffice('loyalty', { area: 'tecnologia' });

  assert.equal(store.deleteArea(DEFAULT_AREA).ok, false, 'la general no se elimina');
  assert.equal(store.deleteArea('tecnologia').ok, true);
  assert.equal(store.getOffice('loyalty').area, DEFAULT_AREA, 'el proyecto sigue, en la general');
  assert.equal(store.deleteArea('nada').status, 404);
});

test('las indicaciones del área van en cada encargo de sus proyectos, entre las de la empresa y las del proyecto', () => {
  const store = openStore(':memory:');
  const dir = tmp();
  try {
    store.setPrefs({ standards: 'Commits convencionales.' });
    store.createArea({ name: 'Tecnología', instructions: 'Todo cambio con su prueba.' });
    store.createOffice({ name: 'Loyalty', area: 'tecnologia', instructions: 'Los puntos nunca bajan de cero.' });
    store.createAgent({ path: dir, harness: 'claude-code', name: 'loyalty-core', office: 'loyalty' });
    const text = guideText(guideFor(store, dir));
    const at = (s) => text.indexOf(s);
    assert.ok(at('Commits convencionales.') >= 0 && at('Todo cambio con su prueba.') > at('Commits convencionales.'), text);
    assert.match(text, /Indicaciones del área «Tecnología»/);
    assert.ok(at('Los puntos nunca bajan de cero.') > at('Todo cambio con su prueba.'), 'el proyecto va después del área');
    // a project of the general area: nothing of the other area
    store.updateOffice('loyalty', { area: DEFAULT_AREA });
    assert.doesNotMatch(guideText(guideFor(store, dir)), /Todo cambio con su prueba/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('por la API: crear, renombrar y borrar un área; cada proyecto dice la suya', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, loops: { autostart: false } });
  try {
    let r = await call(server.url, 'POST', '/v1/areas', { name: 'Operaciones', instructions: 'Nada se cae en horario hábil.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.area.id;
    r = await call(server.url, 'POST', '/v1/offices', { name: 'Bodegas', area: id });
    assert.equal(r.body.office.area, id);
    r = await call(server.url, 'GET', '/v1/areas');
    const ops = r.body.areas.find((a) => a.id === id);
    assert.deepEqual(ops.projects, ['bodegas'], 'cada área con sus proyectos');
    assert.equal(r.body.areas[0].id, DEFAULT_AREA);
    r = await call(server.url, 'PUT', `/v1/areas/${id}`, { name: 'Operación' });
    assert.equal(r.body.area.name, 'Operación');
    assert.equal(r.body.area.instructions, 'Nada se cae en horario hábil.', 'lo que no se manda queda');
    r = await call(server.url, 'DELETE', `/v1/areas/${DEFAULT_AREA}`);
    assert.equal(r.status, 400);
    r = await call(server.url, 'DELETE', `/v1/areas/${id}`);
    assert.equal(r.body.ok, true);
    r = await call(server.url, 'GET', '/v1/offices');
    assert.equal(r.body.offices.find((o) => o.id === 'bodegas').area, DEFAULT_AREA);
  } finally {
    await server.close();
  }
});
