import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { Herdr } from '../server/herdr.js';
import { t } from '../public/i18n.js';

const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('timeout');
};

async function withServer(config, fn) {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, ...config });
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
  assert.match(got[0].text, /^📁 Trabaja sólo dentro de \/proj: no leas ni cambies archivos fuera de esa carpeta\. Haz exactamente lo que se pide .*\n📋 Modo autónomo: trabájalo hasta terminar .*\n\nAgrega validación de email$/);
  assert.equal(got[0].session, 'pi-1');
  await until(() => server.hub.snapshot().tasks[0].status === 'running');
  // the Pi session gets the task as its new request
  assert.equal(server.office.sessionSummary('pi-1').title, 'Agrega validación de email');
  // the extension only accepts it: it is done when the session ends its turn
  server.office.ingest('pi', { session: 'pi-1', cwd: '/proj', kind: 'turn_end' });
  await until(() => server.hub.snapshot().tasks[0].status === 'done');
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
  assert.match(out.task.text, /^📋 Modo autónomo: .*\n\nEscribe los tests del login$/, 'Claude ya trabaja en su carpeta: sin 📁, con el modo autónomo');
  assert.equal(out.task.id, res.task.id);
  assert.equal(server.hub.snapshot().tasks[0].status, 'running');
  assert.deepEqual(await hook({ hook_event_name: 'Stop' }), {}); // nothing is left in the queue
}));

test('una sesión nueva: la oficina abre el CLI del agente (sin shell) y se puede cancelar', () => withServer({}, async (server, base) => {
  let res = await (await post(base, '/v1/tasks', { agent: 'pi', mode: 'launch', text: 'x', cwd: '/no/existe' })).json();
  assert.match(res.error, /no existe el directorio/);
  res = await (await post(base, '/v1/tasks', { agent: 'emacs', mode: 'launch', text: 'x' })).json();
  assert.match(res.error, /no sé lanzar/);
  // a slow "pi": the office launches it and kills it on cancel
  const bin = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'dto-bin-'));
  const slow = `${bin}/pi`;
  (await import('node:fs')).writeFileSync(slow, '#!/bin/sh\necho trabajando\nsleep 30\n', { mode: 0o755 });
  res = server.hub.submit({ agent: 'pi', mode: 'launch', text: 'Algo largo', cwd: bin, launch: { bin: slow } });
  assert.equal(res.ok, true, res.error);
  await until(() => server.hub.snapshot().tasks[0].output?.includes('trabajando'));
  assert.equal(server.hub.snapshot().tasks[0].session, `pi-${res.task.id}`); // the Pi extension adopts this id
  assert.equal((await (await post(base, `/v1/tasks/${res.task.id}/cancel`, {})).json()).ok, true);
  await until(() => server.hub.snapshot().tasks[0].status === 'cancelled');
}));

// fake herdr whose prompt never starts the turn (always agent_prompt_stalled)
function stalledPaneHerdr() {
  const calls = [];
  const panes = new Map([['w1:p1', { pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'unknown' }]]);
  let n = 1;
  const ok = (result = {}) => JSON.stringify({ id: 'cli', result });
  const run = async (args) => {
    calls.push(args);
    const [group, cmd, ...rest] = args;
    if (group === 'pane' && cmd === 'split') {
      const id = `w1:p${++n}`;
      panes.set(id, { pane_id: id, workspace_id: 'w1', agent_status: 'idle' });
      return ok({ pane: panes.get(id) });
    }
    if (group === 'pane' && cmd === 'list') return ok({ panes: [...panes.values()] });
    if (group === 'pane' && (cmd === 'rename' || cmd === 'run')) return ok();
    if (group === 'agent' && cmd === 'prompt') throw Object.assign(new Error('no hubo actividad'), { code: 'agent_prompt_stalled' });
    if (group === 'agent' && cmd === 'get') return ok({ agent: { status: 'idle' } });
    if (group === 'agent') return ok();
    throw new Error(`herdr ${args.join(' ')}: no lo conozco`);
  };
  return { run, calls };
}

test('dentro de herdr: si el prompt no arranca el turno ni con reintento, la tarea falla y libera el rol del pane', async () => {
  const fake = stalledPaneHerdr();
  const herdr = new Herdr({ env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, run: fake.run, every: 60_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-pane-'));
  try {
    await withServer({ herdr }, async (server) => {
      const res = server.hub.submit({ agent: 'opencode', mode: 'launch', text: 'Reembolsos parciales', cwd: dir, launch: { bin: process.execPath } });
      assert.equal(res.ok, true, res.error);
      const task = await until(() => server.hub.snapshot().tasks.find((x) => x.status === 'failed'));
      assert.equal(task.pane, 'w1:p2');
      assert.equal(task.detail, t('task.paneNoTurn', { pane: 'w1:p2', code: 'agent_prompt_stalled' }));
      // S4: the pane's role (manager) goes back to idle, it is not left "working"
      assert.equal(server.company.get('main').roles.manager.status, 'idle');
      // two sends: the first one and a single retry
      assert.equal(fake.calls.filter((c) => c[1] === 'prompt').length, 2);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('un encargo nuevo limita al agente a su carpeta: la nota va delante y en OpenCode es una regla de verdad', async () => {
  const { scoped, fenced } = await import('../server/tasks.js');
  const { Office } = await import('../server/office.js');
  const text = scoped('Agrega envío gratis', '/proj');
  assert.match(text, /^📁 Trabaja sólo dentro de \/proj: .*sin irte por la tangente.*\n\nAgrega envío gratis$/);
  assert.equal(scoped('/task algo', null), '/task algo', 'sin carpeta, tal cual');
  // the agent reports the prompt it got: the board's title is only the request
  const o = new Office();
  o.ingest('pi', { session: 'p1', cwd: '/proj', kind: 'task', text });
  assert.equal(o.sessionSummary('p1').title, 'Agrega envío gratis');
  // OpenCode: reading or changing files outside the folder is denied (keeping its own config)
  const env = fenced('opencode', { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'x', permission: { bash: 'ask' } }) });
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT), { model: 'x', permission: { bash: 'ask', external_directory: 'deny' } });
  assert.deepEqual(fenced('pi', { A: '1' }), { A: '1' });
});

// fake herdr whose pane is always busy: in the bin path the office types the agent's executable
// into the new pane (pane run), and that is where herdr refuses with agent_pane_busy
function busyPaneHerdr() {
  const calls = [];
  const panes = new Map([['w1:p1', { pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'unknown' }]]);
  let n = 1;
  const ok = (result = {}) => JSON.stringify({ id: 'cli', result });
  const run = async (args) => {
    calls.push(args);
    const [group, cmd, ...rest] = args;
    if (group === 'pane' && cmd === 'split') {
      const id = `w1:p${++n}`;
      panes.set(id, { pane_id: id, workspace_id: 'w1', agent_status: 'idle' });
      return ok({ pane: panes.get(id) });
    }
    if (group === 'pane' && cmd === 'list') return ok({ panes: [...panes.values()] });
    if (group === 'pane' && cmd === 'rename') return ok();
    if (group === 'pane' && cmd === 'run') throw Object.assign(new Error('el pane está ocupado'), { code: 'agent_pane_busy' });
    if (group === 'agent') return ok();
    throw new Error(`herdr ${args.join(' ')}: no lo conozco`);
  };
  return { run, calls };
}

test('dentro de herdr: si el pane está ocupado en cada intento, la tarea falla con el último pane y libera el rol', async () => {
  const fake = busyPaneHerdr();
  const herdr = new Herdr({ env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, run: fake.run, every: 60_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-pane-busy-'));
  try {
    await withServer({ herdr }, async (server) => {
      const res = server.hub.submit({ agent: 'opencode', mode: 'launch', text: 'Reembolsos parciales', cwd: dir, launch: { bin: process.execPath } });
      assert.equal(res.ok, true, res.error);
      const task = await until(() => server.hub.snapshot().tasks.find((x) => x.status === 'failed'));
      // three attempts, three panes: the task fails naming the pane of the last attempt
      assert.equal(task.pane, 'w1:p4');
      assert.equal(task.detail, t('task.paneNoTurn', { pane: 'w1:p4', code: 'agent_pane_busy' }));
      // S4: the pane's role (manager) goes back to idle, it is not left "working"
      assert.equal(server.company.get('main').roles.manager.status, 'idle');
      assert.equal(fake.calls.filter((c) => c[1] === 'split').length, 3);
      assert.equal(fake.calls.filter((c) => c[1] === 'run').length, 3);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
