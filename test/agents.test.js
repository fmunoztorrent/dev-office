// The agents maintainer through the API: register a path, see what its harness brings and send it
// a prompt that starts ITS pipeline (to the session open in that path or to a new session).
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
  assert.ok(!agent.entries.some((e) => e.id.startsWith('opencode:'))); // only what works for Claude Code

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
    // `claude -p "/task bug: …"` in the agent's path: Errementari is the one running its pipeline
    assert.deepEqual(run.args, ['-p', '/task bug: el SSE no reconecta', '--permission-mode', 'acceptEdits']);
    assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(dir));
    assert.equal(run.launched, '1');
    // it stays in the agent's history
    const detail = await call(base, 'GET', `/v1/agents/${body.agent.id}`);
    assert.deepEqual(detail.body.prompts.map((p) => [p.entry, p.status, p.mode]), [['errementari:bugfix', 'done', 'launch']]);
    // a .devteam/ pipeline needs an open session
    const dt = await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { entry: 'devteam:mini', text: 'x' });
    assert.match(dt.body.error, /lo corre una sesión abierta/);
    assert.match((await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { entry: 'nada', text: 'x' })).body.error, /no tiene la entrada/);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
  }
}));

test('prompt con sesión abierta en esa ruta: le llega a esa sesión (comando, o pipeline de .devteam)', () => withServer(async (server, base) => {
  const dir = errementariProject();
  // an OpenCode session open in the agent's path
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
  // without an open session in the path (null = new session) it can be forced too
  assert.equal(server.registry.target(agent.id).sessions[0].session, 'ses_1');
  ws.close();

  // a .devteam/ pipeline goes to a session that can run it (a fake Pi in the same path)
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

// What was seen with Pi in herdr: the agent registered as /tmp/… and its session says /private/tmp/…
// (macOS). It is the same folder: the prompt goes to the open session, not to a new one.
test('prompt: la sesión abierta en la ruta real (o por un enlace) es la del agente', () => withServer(async (server, base) => {
  const dir = errementariProject();
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-link-')), 'proyecto');
  fs.symlinkSync(dir, link);
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'task') got.push(m); });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'opencode', session: 'ses_real', cwd: fs.realpathSync(dir), can: ['task'] }));
  const { body } = await call(base, 'POST', '/v1/agents', { path: link, harness: 'opencode' });
  await until(async () => (await call(base, 'GET', `/v1/agents/${body.agent.id}`)).body.agent.sessions.some((s) => s.live));
  const r = await call(base, 'POST', `/v1/agents/${body.agent.id}/prompt`, { text: 'Sube la cobertura' });
  assert.equal(r.body.task.mode, 'session');
  assert.equal((await until(() => got[0])).session, 'ses_real');
  ws.close();
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
