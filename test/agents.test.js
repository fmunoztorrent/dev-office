// El mantenedor de agentes por la API: registrar una ruta, ver lo que trae su harness y mandarle
// un prompt que arranca SU pipeline (a la sesión abierta en esa ruta o a una sesión nueva).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { errementariProject } from './fixtures/harness.mjs';
import { startFakeAgent } from './fixtures/fake-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout');
};
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

async function withServer(fn) {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  try { await fn(server, server.url); } finally { await server.close(); }
}

test('mantenedor: detectar, registrar, listar, editar y eliminar por la API', () => withServer(async (server, base) => {
  const dir = errementariProject();
  let r = await call(base, 'POST', '/v1/agents/detect', { path: dir });
  assert.deepEqual([r.body.exists, r.body.harnesses, r.body.kinds], [true, ['claude-code', 'opencode'], ['Errementari 2.1.0', 'Dev Team Office']]);

  r = await call(base, 'POST', '/v1/agents', { path: dir, harness: 'claude-code', name: 'Erre' });
  assert.equal(r.status, 201, r.body.error);
  const agent = r.body.agent;
  assert.equal(agent.id, 'erre-claude-code');
  assert.deepEqual(agent.kinds, ['Errementari 2.1.0', 'Dev Team Office']);
  assert.ok(agent.entries.some((e) => e.id === 'errementari:feature' && e.stages.length === 7));
  assert.ok(!agent.entries.some((e) => e.id.startsWith('opencode:'))); // sólo lo que sirve para Claude Code

  assert.equal((await call(base, 'POST', '/v1/agents', { path: dir, harness: 'claude-code' })).status, 400);
  assert.equal((await call(base, 'POST', '/v1/agents', { path: 'relativa', harness: 'pi' })).status, 400);

  r = await call(base, 'PUT', `/v1/agents/${agent.id}`, { name: 'Errementari' });
  assert.equal(r.body.agent.name, 'Errementari');
  assert.deepEqual((await call(base, 'GET', '/v1/agents')).body.agents.map((a) => [a.id, a.registered]), [['erre-claude-code', true]]);
  assert.equal((await call(base, 'GET', `/v1/agents/${agent.id}`)).body.agent.path, dir);
  assert.equal((await call(base, 'DELETE', `/v1/agents/${agent.id}`)).status, 200);
  assert.equal((await call(base, 'GET', `/v1/agents/${agent.id}`)).status, 404);
  assert.equal((await call(base, 'DELETE', `/v1/agents/${agent.id}`)).status, 404);
}));

test('prompt sin sesión abierta: la oficina abre el CLI del agente en su ruta con la entrada de su harness', () => withServer(async (server, base) => {
  const dir = errementariProject();
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-log-')), 'claude.log');
  process.env.FAKE_CLAUDE_LOG = log;
  try {
    const { body } = await call(base, 'POST', '/v1/agents', { path: dir, harness: 'claude-code', bin: FAKE_CLAUDE });
    const r = await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { entry: 'errementari:bugfix', text: 'el SSE no reconecta' });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.task.mode, 'launch');
    const t = await until(() => server.hub.snapshot().tasks.find((x) => x.status === 'done'));
    assert.equal(t.text, 'Errementari · bugfix: el SSE no reconecta');
    const run = JSON.parse(fs.readFileSync(log, 'utf8'));
    // `claude -p "/task bug: …"` en la ruta del agente: es Errementari el que corre su pipeline
    assert.deepEqual(run.args, ['-p', '/task bug: el SSE no reconecta', '--permission-mode', 'acceptEdits']);
    assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(dir));
    assert.equal(run.launched, '1');
    // queda en el historial del agente
    const detail = await call(base, 'GET', `/v1/agents/${body.agent.id}`);
    assert.deepEqual(detail.body.prompts.map((p) => [p.entry, p.status, p.mode]), [['errementari:bugfix', 'done', 'launch']]);
    // un pipeline de .devteam/ necesita una sesión abierta
    const dt = await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { entry: 'devteam:mini', text: 'x' });
    assert.match(dt.body.error, /lo corre una sesión abierta/);
    assert.match((await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { entry: 'nada', text: 'x' })).body.error, /no tiene la entrada/);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
  }
}));

test('prompt con sesión abierta en esa ruta: le llega a esa sesión (comando, o pipeline de .devteam)', () => withServer(async (server, base) => {
  const dir = errementariProject();
  // una sesión de OpenCode abierta en la ruta del agente
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'task') { got.push(m); ws.send(JSON.stringify({ type: 'task_update', id: m.id, status: 'accepted' })); } });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'opencode', session: 'ses_1', cwd: dir, can: ['task', 'pipeline'] }));
  const { body } = await call(base, 'POST', '/v1/agents', { path: dir, harness: 'opencode' });
  const agent = await until(async () => (await call(base, 'GET', `/v1/agents/${body.agent.id}`)).body.agent.sessions.find((s) => s.live) && body.agent);
  const r = await call(base, 'POST', `/v1/agents/${agent.id}/prompt`, { entry: 'errementari:feature', text: 'Login con Google' });
  assert.equal(r.body.task.mode, 'session');
  const msg = await until(() => got[0]);
  assert.deepEqual([msg.session, msg.text, msg.command, msg.args], ['ses_1', '/task feature: Login con Google', 'task', 'feature: Login con Google']);
  await until(() => server.hub.snapshot().tasks[0].status === 'running');
  // sin sesión abierta en la ruta (null = sesión nueva) también se puede forzar
  assert.equal(server.registry.target(agent.id).sessions[0].session, 'ses_1');
  ws.close();

  // un pipeline de .devteam/ va a una sesión que lo pueda correr (Pi de mentira en la misma ruta)
  const pi = startFakeAgent({ url: base, dir, session: 'pi-h' });
  await pi.ready;
  const piAgent = (await call(base, 'POST', '/v1/agents', { path: dir, harness: 'pi' })).body.agent;
  await until(async () => (await call(base, 'GET', `/v1/agents/${piAgent.id}`)).body.agent.sessions.some((s) => s.live));
  const p = await call(base, 'POST', `/v1/agents/${piAgent.id}/prompt`, { entry: 'devteam:mini', text: 'Cupones' });
  assert.equal(p.status, 200, p.body.error);
  await until(() => server.pipelines.snapshot().runs.find((x) => x.status === 'done'));
  assert.deepEqual(pi.received.filter((m) => m.type === 'stage').map((m) => m.id), ['plan', 'api']);
  await pi.close();
}));

test('las sesiones abiertas fuera de las rutas registradas también reciben prompts', () => withServer(async (server, base) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'task') got.push(m); });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-9', cwd: os.tmpdir() }));
  const t = await until(() => server.registry.targets().find((x) => x.id === 'session:pi-9'));
  assert.equal(t.registered, false);
  const r = await call(base, 'POST', '/v1/run', { target: t.id, entry: 'prompt', text: 'Hola' });
  assert.equal(r.status, 200, r.body.error);
  assert.equal((await until(() => got[0])).text, 'Hola');
  ws.close();
}));
