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
  const server = await startServer({ port: 0, socket: null, db: ':memory:', ...config });
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

test('una sesión nueva: la oficina abre el CLI del agente (sin shell) y se puede cancelar', () => withServer({}, async (server, base) => {
  let res = await (await post(base, '/v1/tasks', { agent: 'pi', mode: 'launch', text: 'x', cwd: '/no/existe' })).json();
  assert.match(res.error, /no existe el directorio/);
  res = await (await post(base, '/v1/tasks', { agent: 'emacs', mode: 'launch', text: 'x' })).json();
  assert.match(res.error, /no sé lanzar/);
  // un "pi" que tarda: la oficina lo lanza y lo corta al cancelar
  const bin = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'dto-bin-'));
  const slow = `${bin}/pi`;
  (await import('node:fs')).writeFileSync(slow, '#!/bin/sh\necho trabajando\nsleep 30\n', { mode: 0o755 });
  res = server.hub.submit({ agent: 'pi', mode: 'launch', text: 'Algo largo', cwd: bin, launch: { bin: slow } });
  assert.equal(res.ok, true, res.error);
  await until(() => server.hub.snapshot().tasks[0].output?.includes('trabajando'));
  assert.equal(server.hub.snapshot().tasks[0].session, `pi-${res.task.id}`); // la extensión de Pi adopta este id
  assert.equal((await (await post(base, `/v1/tasks/${res.task.id}/cancel`, {})).json()).ok, true);
  await until(() => server.hub.snapshot().tasks[0].status === 'cancelled');
}));
