// The narrator (server/narrator.js): what someone did, in one sentence, from the real log — by a fast
// model you choose (faked here: nothing leaves the machine) or, without one, by rules.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsOf, rulesLine } from '../server/narrator.js';
import { startServer } from '../server/server.js';

const ev = (kind, text, extra = {}) => ({ type: 'event', office: 'main', session: 's1', kind, role: 'backend', text, ...extra });

test('los hechos y la frase por reglas: lo último hecho, sin repetir, y cuántas cosas fallaron', () => {
  const f = factsOf([
    { kind: 'tool_start', text: 'Editando pagos.js' }, { kind: 'tool_end', text: 'Editando pagos.js', ok: true },
    { kind: 'tool_start', text: 'Corriendo los tests' }, { kind: 'tool_end', text: 'Corriendo los tests', ok: false },
    { kind: 'tool_start', text: 'Editando pagos.js' }, { kind: 'chat', text: 'hola' },
  ]);
  assert.deepEqual(f.done, ['Corriendo los tests', 'Editando pagos.js']);
  assert.equal(f.fails, 1);
  assert.equal(rulesLine(f), 'Corriendo los tests y Editando pagos.js (fallas: 1)');
  assert.equal(rulesLine(factsOf([])), '');
});

test('con un modelo narrador: la ficha dice lo que contesta, y al terminar el turno lo dice en su burbuja', async () => {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"text": "Arregló el redondeo de pagos.js; un test sigue fallando."}' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, loops: { autostart: false }, intelligence: { fetch, env: { ANTHROPIC_API_KEY: 'x' } } });
  const said = [];
  server.company.on('event', (id, e) => { if (e.kind === 'narrate') said.push(e); });
  const post = (b) => fetch && globalThis.fetch(`${server.url}/v1/events/generic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    for (const e of [ev('tool_start', 'Editando pagos.js', { tool: 'Edit' }), ev('tool_start', 'Corriendo los tests', { tool: 'Bash' })]) await post(e);
    // off: by rules
    let r = await globalThis.fetch(`${server.url}/v1/offices/main/narrate?role=backend`).then((x) => x.json());
    assert.deepEqual([r.source, r.text], ['rules', 'Editando pagos.js y Corriendo los tests']);
    await globalThis.fetch(`${server.url}/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefs: { narrator: { provider: 'anthropic' } } }) });
    r = await globalThis.fetch(`${server.url}/v1/offices/main/narrate?role=backend&name=Diego`).then((x) => x.json());
    assert.deepEqual([r.source, r.text], ['model', 'Arregló el redondeo de pagos.js; un test sigue fallando.']);
    assert.equal(asked.at(-1).model, 'claude-haiku-5-5', 'el narrador usa uno rápido por defecto');
    assert.match(JSON.stringify(asked.at(-1).messages), /Editando pagos\.js/, 'desde los hechos reales');
    const n = asked.length;
    await globalThis.fetch(`${server.url}/v1/offices/main/narrate?role=backend`);
    assert.equal(asked.length, n, 'lo mismo no se pregunta dos veces');
    await post(ev('turn_end', '', { role: 'manager' }));
    for (let i = 0; i < 50 && !said.length; i++) await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(said.map((e) => [e.role, e.text]), [['backend', 'Arregló el redondeo de pagos.js; un test sigue fallando.']]);
  } finally {
    await server.close();
  }
});
