import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';

const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('timeout');
};

async function withServer(config, fn) {
  const server = await startServer({ port: 0, socket: null, config });
  try { await fn(server, server.url); } finally { await server.close(); }
}

test('una tarea llega a la sesión de Pi conectada y queda en curso al aceptarla', () => withServer({}, async (server, base) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'task') { got.push(m); ws.send(JSON.stringify({ type: 'task_update', id: m.id, status: 'accepted' })); }
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-1', cwd: '/proj' }));
  await until(() => server.hub.snapshot().agents.length === 1);

  const res = await (await post(base, '/v1/tasks', { agent: 'pi', text: 'Agrega validación de email' })).json();
  assert.equal(res.ok, true);
  await until(() => got.length === 1);
  assert.equal(got[0].text, 'Agrega validación de email');
  assert.equal(got[0].session, 'pi-1');
  await until(() => server.hub.snapshot().tasks[0].status === 'running');
  // la sesión de Pi recibe la tarea como su nuevo pedido
  assert.equal(server.office.sessionSummary('pi-1').title, 'Agrega validación de email');
  ws.close();
  await until(() => server.hub.snapshot().agents.length === 0);
}));

test('sin sesión conectada de Pi u OpenCode hay que pedir una nueva', () => withServer({}, async (_s, base) => {
  const res = await (await post(base, '/v1/tasks', { agent: 'opencode', text: 'x' })).json();
  assert.equal(res.ok, false);
  assert.match(res.error, /no hay ninguna sesión de OpenCode conectada; pide una nueva/);
}));

test('Claude Code: la tarea espera en cola y la oficina se la da al hook en el Stop', () => withServer({}, async (server, base) => {
  const hook = (body) => post(base, '/v1/hooks/claude-code', { session_id: 'c1', cwd: '/p', ...body }).then((r) => r.json());
  assert.deepEqual(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hola' }), {});
  const res = await (await post(base, '/v1/tasks', { agent: 'claude-code', session: 'c1', text: 'Escribe los tests del login' })).json();
  assert.equal(res.task.status, 'queued');
  assert.deepEqual(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }), {});
  const out = await hook({ hook_event_name: 'Stop' });
  assert.deepEqual(out, { task: { id: res.task.id, text: 'Escribe los tests del login' } });
  assert.equal(server.hub.snapshot().tasks[0].status, 'running');
  assert.deepEqual(await hook({ hook_event_name: 'Stop' }), {}); // ya no queda nada en cola
}));

test('una sesión nueva la lanza un agente conectado, no la oficina', () => withServer({}, async (server, base) => {
  // nadie que sepa lanzar: la oficina no lanza procesos
  let res = await (await post(base, '/v1/tasks', { agent: 'claude-code', mode: 'launch', text: 'x' })).json();
  assert.equal(res.ok, false);
  assert.match(res.error, /no hay ningún agente conectado que pueda lanzar/);
  assert.deepEqual(server.hub.snapshot().launchers.map((l) => l.available), [false, false, false]);

  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'launch') got.push(m); });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-1', cwd: '/proj', can: ['task', 'launch'] }));
  await until(() => server.hub.snapshot().launchers[0].available);

  res = await (await post(base, '/v1/tasks', { agent: 'claude-code', mode: 'launch', text: 'Arregla el login', cwd: '/proj/web' })).json();
  assert.equal(res.ok, true, res.error);
  const msg = await until(() => got[0]);
  assert.deepEqual(msg, { type: 'launch', id: res.task.id, harness: 'claude-code', task: 'Arregla el login', cwd: '/proj/web' });
  ws.send(JSON.stringify({ type: 'task_update', id: msg.id, status: 'accepted', detail: 'sesión nueva lanzada por Pi (pid 42)' }));
  await until(() => server.hub.snapshot().tasks[0].status === 'running');
  ws.send(JSON.stringify({ type: 'task_update', id: msg.id, status: 'done' }));
  await until(() => server.hub.snapshot().tasks[0].status === 'done');
  ws.close();
}));
