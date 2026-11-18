// The retro (server/retro.js): the learnings of the last task, suggested from what it said (no model),
// and the ones you keep go to the archive; with none, nothing is saved.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLearnings, learningsOf } from '../server/retro.js';
import { startServer } from '../server/server.js';

const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('lo que la oficina sugiere: las líneas de la tarea que dicen algo aprendido, y por qué falló', () => {
  const task = { text: 'Cobros', status: 'failed', detail: 'el test de contrato', output: ['Compilando…', 'Ojo: la API redondea en centavos', '- Aprendí que el seed va antes de los e2e', 'listo'] };
  assert.deepEqual(suggestLearnings(task), ['Ojo: la API redondea en centavos', 'Aprendí que el seed va antes de los e2e', 'Falló: el test de contrato']);
  assert.deepEqual(suggestLearnings(null), []);
  assert.deepEqual(learningsOf('- uno\n\n* dos\ntres  '), ['uno', 'dos', 'tres']);
});

test('por la API: la retro de un proyecto guarda lo aprendido en el archivo y el equipo se junta en la mesa', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, loops: { autostart: false } });
  const seen = [];
  server.company.on('event', (id, ev) => { if (ev.kind === 'retro') seen.push(ev); });
  try {
    let r = await call(server.url, 'GET', '/v1/offices/main/retro');
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.suggestions, []);
    r = await call(server.url, 'POST', '/v1/offices/main/retro', { learnings: '  \n' });
    assert.deepEqual(r.body, { ok: true, saved: 0 }, 'sin aprendizajes, nada al archivo');
    r = await call(server.url, 'POST', '/v1/offices/main/retro', { learnings: '- La API redondea en centavos\n- El seed va antes' });
    assert.equal(r.body.saved, 2);
    assert.deepEqual(r.body.entry.tags.slice(0, 1), ['retro']);
    assert.match(r.body.entry.body, /- La API redondea en centavos/);
    assert.equal(server.store.listKnowledge({ q: 'centavos' }).length, 1, 'queda en el archivo');
    assert.deepEqual(seen.at(-1).lines, ['La API redondea en centavos', 'El seed va antes']);
    assert.equal((await call(server.url, 'GET', '/v1/offices/nada/retro')).status, 404);
  } finally {
    await server.close();
  }
});
