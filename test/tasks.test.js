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

test('sin sesión conectada de Pi u OpenCode se pide lanzarla como ejecución nueva', () => withServer({}, async (_s, base) => {
  const res = await (await post(base, '/v1/tasks', { agent: 'opencode', text: 'x' })).json();
  assert.equal(res.ok, false);
  assert.match(res.error, /lánzala como ejecución nueva/);
}));

test('Claude Code: la tarea espera en cola y el hook Stop la entrega', () => withServer({}, async (server, base) => {
  const hook = (body) => post(base, '/v1/hooks/claude-code', { session_id: 'c1', cwd: '/p', ...body }).then((r) => r.text());
  assert.equal(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hola' }), ''); // nada en stdout = sin efectos
  const res = await (await post(base, '/v1/tasks', { agent: 'claude-code', session: 'c1', text: 'Escribe los tests del login' })).json();
  assert.equal(res.task.status, 'queued');
  assert.equal(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }), '');
  const out = JSON.parse(await hook({ hook_event_name: 'Stop' }));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /Escribe los tests del login/);
  assert.equal(server.hub.snapshot().tasks[0].status, 'running');
  assert.equal(await hook({ hook_event_name: 'Stop' }), ''); // ya no queda nada en cola
}));

test('lanzar: la tarea viaja como un solo argumento, sin shell', () => {
  const echo = [process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)), process.env.DEV_TEAM_OFFICE_RUN)', '{task}'];
  return withServer({ launchers: { pi: echo } }, async (server, base) => {
    const evil = 'hola"; touch /tmp/pwned-dto; echo "$(whoami)';
    const res = await (await post(base, '/v1/tasks', { agent: 'pi', mode: 'launch', text: evil, cwd: process.cwd() })).json();
    assert.equal(res.ok, true, res.error);
    const t = await until(() => server.hub.snapshot().tasks.find((x) => x.status === 'done'));
    assert.equal(t.output[0], `${JSON.stringify([evil])} r1`);
    assert.equal((await import('node:fs')).existsSync('/tmp/pwned-dto'), false);
  });
});

test('lanzar falla con un mensaje claro si el directorio no existe o falta el comando', () =>
  withServer({ launchers: { pi: ['no-existe-este-comando-xyz', '{task}'] } }, async (_s, base) => {
    let res = await (await post(base, '/v1/tasks', { agent: 'pi', mode: 'launch', text: 'x' })).json();
    assert.match(res.error, /no encuentro/);
    res = await (await post(base, '/v1/tasks', { agent: 'claude-code', mode: 'launch', text: 'x', cwd: '/no/existe' })).json();
    assert.equal(res.ok, false);
  }));
