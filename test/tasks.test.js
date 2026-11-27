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

// A turn that ends in a model error (the provider refused it: no balance, a bad key) is not a
// finished task: the session's `turn_end` carries the `error`, and the task fails with that reason.
test('un turno que termina en un error del modelo: la tarea de esa sesión falla con la razón, no queda terminada', () => withServer({}, async (server, base) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'task') ws.send(JSON.stringify({ type: 'task_update', id: m.id, status: 'accepted' }));
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-2', cwd: '/proj' }));
  await until(() => server.hub.snapshot().agents.length === 1);

  const first = (await (await post(base, '/v1/tasks', { agent: 'pi', text: 'Arregla el login' })).json()).task;
  await until(() => server.hub.snapshot().tasks.find((x) => x.id === first.id).status === 'running');
  server.office.ingest('pi', { session: 'pi-2', cwd: '/proj', kind: 'error', text: '402 Insufficient balance' });
  server.office.ingest('pi', { session: 'pi-2', cwd: '/proj', kind: 'turn_end', error: '402 Insufficient balance' });
  const failed = await until(() => server.hub.snapshot().tasks.find((x) => x.id === first.id && x.status === 'failed'));
  assert.equal(failed.detail, '402 Insufficient balance');
  // the end of the turn says it ended badly, and keeps the reason
  const end = server.office.log.findLast((e) => e.kind === 'turn_end' && e.session === 'pi-2');
  assert.deepEqual([end.ok, end.error, end.text], [false, '402 Insufficient balance', t('events.turnFailed')]);
  assert.ok(server.office.log.some((e) => e.kind === 'error' && e.session === 'pi-2' && /402 Insufficient balance/.test(e.text)));

  // a turn that ends well is still done
  const second = (await (await post(base, '/v1/tasks', { agent: 'pi', text: 'Sube la cobertura' })).json()).task;
  await until(() => server.hub.snapshot().tasks.find((x) => x.id === second.id).status === 'running');
  server.office.ingest('pi', { session: 'pi-2', cwd: '/proj', kind: 'turn_end' });
  await until(() => server.hub.snapshot().tasks.find((x) => x.id === second.id).status === 'done');
  const fine = server.office.log.findLast((e) => e.kind === 'turn_end');
  assert.ok(fine.ok !== false && !fine.error);
  assert.equal(server.hub.snapshot().tasks.find((x) => x.id === first.id).status, 'failed', 'la anterior no cambia');
  ws.close();
}));

test('un subagente en segundo plano: la tarea no termina con el turno que lo lanzó, sino cuando vuelve su trabajo y la sesión termina', () => withServer({}, async (server, base) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'task') ws.send(JSON.stringify({ type: 'task_update', id: m.id, status: 'accepted' }));
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 's-bg', cwd: '/proj' }));
  await until(() => server.hub.snapshot().agents.length === 1);
  const task = (await (await post(base, '/v1/tasks', { agent: 'pi', text: 'Agrega el descuento con su test' })).json()).task;
  await until(() => server.hub.snapshot().tasks.find((x) => x.id === task.id).status === 'running');
  const cc = (p) => server.office.ingest('claude-code', { session_id: 's-bg', cwd: '/proj', ...p });
  // Claude launches a subagent in the background: its tool answers at once («async_launched»)
  const input = { description: 'Write and run the test', prompt: 'write the test', subagent_type: 'general-purpose', run_in_background: true };
  cc({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: input });
  cc({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: input, tool_response: { isAsync: true, status: 'async_launched', agentId: 'a71' } });
  assert.ok(server.office.sessions.get('s-bg').subagents.find((x) => x.toolUseId === 'tu1').open, 'lanzado, no terminado');
  assert.ok(!server.office.log.some((e) => e.kind === 'subagent_end'));
  // the turn that launched it ends: the work goes on
  cc({ hook_event_name: 'Stop' });
  assert.equal(server.office.log.findLast((e) => e.kind === 'turn_end').pending, 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(server.hub.snapshot().tasks.find((x) => x.id === task.id).status, 'running', 'sigue en curso');
  // its hand-back: the subagent ended (it is not a new brief), with what it said
  cc({ hook_event_name: 'UserPromptSubmit', prompt: '<agent-message from="a71">\nTests pass: 4/4.\n</agent-message>' });
  const end = server.office.log.findLast((e) => e.kind === 'subagent_end');
  assert.equal(end.subId, 'tu1');
  assert.match(end.output, /Tests pass: 4\/4/);
  assert.ok(!server.office.log.some((e) => e.kind === 'task' && /agent-message/.test(e.text || '')), 'no es un encargo nuevo');
  // and the session's turn after it: now the task is done
  cc({ hook_event_name: 'Stop' });
  await until(() => server.hub.snapshot().tasks.find((x) => x.id === task.id).status === 'done');
  // the other form of the hand-back: the notice of a background task, with its tool_use_id
  cc({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_input: { ...input, description: 'Otro' } });
  cc({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_input: input, tool_response: { isAsync: true, status: 'async_launched', agentId: 'a72' } });
  // a background command's notice (not a subagent) closes nobody
  cc({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>bash9</task-id>\n<tool-use-id>tuBash</tool-use-id>\n<status>completed</status>\n</task-notification>' });
  assert.ok(server.office.sessions.get('s-bg').subagents.find((x) => x.toolUseId === 'tu2').open);
  cc({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>a72</task-id>\n<tool-use-id>tu2</tool-use-id>\n<status>completed</status>\n<summary>Agent "Otro" completed</summary>\n</task-notification>' });
  assert.equal(server.office.log.findLast((e) => e.kind === 'subagent_end').subId, 'tu2');
  assert.ok(!server.office.log.some((e) => e.kind === 'task' && /task-notification/.test(e.text || '')), 'tampoco es un encargo nuevo');
  ws.close();
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

// In the background, a Pi that exits with 0 after a model error: its session already said the turn
// ended in an error, and that is the task's verdict (not the exit code).
test('una sesión nueva en segundo plano: si su turno terminó en un error del modelo, la tarea falla aunque salga con 0', () => withServer({}, async (server) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-bin-'));
  const pi = path.join(bin, 'pi');
  fs.writeFileSync(pi, '#!/bin/sh\nsleep 0.4\nexit 0\n', { mode: 0o755 });
  try {
    const res = server.hub.submit({ agent: 'pi', mode: 'launch', text: 'Arregla el login', cwd: bin, launch: { bin: pi } });
    assert.equal(res.ok, true, res.error);
    await until(() => server.hub.snapshot().tasks[0].status === 'running');
    server.office.ingest('pi', { session: `pi-${res.task.id}`, cwd: bin, kind: 'turn_end', error: '402 Insufficient balance' });
    const task = await until(() => ['done', 'failed'].includes(server.hub.snapshot().tasks[0].status) && server.hub.snapshot().tasks[0]);
    assert.deepEqual([task.status, task.detail], ['failed', '402 Insufficient balance']);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}));

test('una sesión en segundo plano que sale con error: el motivo es su error, no la advertencia de una extensión', () => withServer({}, async (server) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-bin-'));
  const pi = path.join(bin, 'pi');
  fs.writeFileSync(pi, `#!/bin/sh
echo '401: {"type":"authentication_error","message":"This API key has expired."}' >&2
echo 'Warning: Extension package "/x/ext/package.json": Host-provided extension packages must be declared in peerDependencies' >&2
exit 1
`, { mode: 0o755 });
  try {
    const res = server.hub.submit({ agent: 'pi', mode: 'launch', text: 'Arregla el login', cwd: bin, launch: { bin: pi } });
    assert.equal(res.ok, true, res.error);
    const task = await until(() => server.hub.snapshot().tasks[0].status === 'failed' && server.hub.snapshot().tasks[0]);
    assert.equal(task.detail, t('task.exitCode', { code: 1, last: ': 401 · This API key has expired.' }));
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
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
