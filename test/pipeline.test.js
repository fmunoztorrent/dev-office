// La oficina como RELAY de pipelines: los agentes anuncian lo que pueden correr, la oficina se lo
// pide a la sesión elegida y dibuja lo que el agente reporta. No lanza procesos ni corre gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { startFakeAgent } from './fixtures/fake-agent.mjs';
import * as lib from '../integrations/common/devteam.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(here, '..', 'examples', 'tienda');
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout');
};
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

async function withServer(fn) {
  const server = await startServer({ port: 0, socket: null, config: {} });
  try { await fn(server, server.url); } finally { await server.close(); }
}

test('un agente conectado anuncia sus pipelines; la oficina se lo pide y dibuja lo que reporta', () => withServer(async (server, base) => {
  const agent = startFakeAgent({ url: base, dir: EXAMPLE, session: 'pi-7' });
  try {
    await agent.ready;
    const projects = await until(async () => (await call(base, 'GET', '/v1/projects')).body.projects.find((p) => p.dir === EXAMPLE));
    const tdd = projects.pipelines.find((p) => p.id === 'feature-tdd');
    assert.equal(tdd.stages.length, 5);
    assert.deepEqual(tdd.hosts, [{ agent: 'pi', session: 'pi-7', live: true }]);

    const r = await call(base, 'POST', '/v1/pipelines', { session: 'pi-7', pipeline: 'feature-tdd', task: 'Cupones de descuento' });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.run.status, 'sent');
    // al agente le llega el pedido, no un plan: él lee su .devteam/ y lo ejecuta
    const msg = await until(() => agent.received.find((m) => m.type === 'pipeline'));
    assert.deepEqual(msg, { type: 'pipeline', id: r.body.run.id, session: 'pi-7', pipeline: 'feature-tdd', task: 'Cupones de descuento' });

    const run = await until(() => server.pipelines.snapshot().runs.find((x) => x.status === 'done'));
    assert.deepEqual(run.stages.map((s) => s.status), ['done', 'done', 'done', 'done', 'done']);
    // las etapas corrieron en la sesión del agente, con el modelo de cada rol
    assert.deepEqual(agent.received.filter((m) => m.type === 'stage').map((m) => m.model), ['anthropic/claude-opus-5-5', 'anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5', 'anthropic/claude-haiku-5-5', 'opus']);
    // la oficina dibujó el flujo de roles con lo que reportó el agente
    const s = server.office.sessionSummary('pi-7');
    assert.deepEqual(s.flow.map((f) => `${f.role}:${f.phase}`), ['tl:arquitectura', 'qa:red', 'backend:implementa', 'qa:green', 'tl:review']);
    assert.match(s.title, /Feature con TDD: Cupones de descuento/);
    assert.ok(server.office.snapshot().log.some((e) => e.kind === 'dispatch' && /Pipeline «Feature con TDD» para Pi/.test(e.text)));
  } finally {
    await agent.close();
  }
}));

test('cancelar desde la oficina llega al agente; sin agente conectado no hay a quién pedírselo', () => withServer(async (server, base) => {
  const agent = startFakeAgent({ url: base, dir: EXAMPLE, session: 'pi-8', delay: 150 });
  try {
    await agent.ready;
    await until(() => server.pipelines.projects().length);
    const { body } = await call(base, 'POST', '/v1/pipelines', { pipeline: 'fullstack', task: 'Carrito' }); // sin sesión: el primero que lo tenga
    assert.equal(body.run.session, 'pi-8');
    await until(() => server.pipelines.snapshot().runs[0].status === 'running');
    assert.equal((await call(base, 'POST', `/v1/pipelines/${body.run.id}/cancel`)).status, 200);
    await until(() => agent.received.some((m) => m.type === 'pipeline_cancel' && m.id === body.run.id));
    const run = await until(() => server.pipelines.snapshot().runs.find((x) => x.status === 'cancelled'));
    assert.ok(run.stages.some((s) => s.status === 'cancelled'));
  } finally {
    await agent.close();
  }
  await until(() => !server.pipelines.projects().length); // se desconectó: ya no lo ofrece
  const r = await call(base, 'POST', '/v1/pipelines', { pipeline: 'fullstack', task: 'x' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ningún agente conectado tiene el pipeline/);
}));

test('Claude Code anuncia su proyecto desde el hook y su pipeline se entrega en el Stop', () => withServer(async (server, base) => {
  const project = lib.catalogEntry(lib.loadProject(EXAMPLE));
  assert.equal((await call(base, 'POST', '/v1/agents/announce', { agent: 'claude-code', session: 'c1', cwd: EXAMPLE, project })).status, 200);
  const host = server.pipelines.projects()[0].pipelines[0].hosts[0];
  assert.deepEqual(host, { agent: 'claude-code', session: 'c1', live: false });

  const { body } = await call(base, 'POST', '/v1/pipelines', { session: 'c1', pipeline: 'feature-tdd', task: 'Login' });
  assert.equal(body.run.status, 'queued');
  // eventos que no son Stop no lo entregan
  let r = await call(base, 'POST', '/v1/hooks/claude-code', { session_id: 'c1', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  assert.deepEqual(r.body, {});
  r = await call(base, 'POST', '/v1/hooks/claude-code', { session_id: 'c1', hook_event_name: 'Stop' });
  assert.deepEqual(r.body, { pipeline: { id: body.run.id, pipeline: 'feature-tdd', task: 'Login' } });
  // el hook reporta el estado; cancelar queda pendiente hasta su próximo evento
  await call(base, 'POST', `/v1/pipelines/${body.run.id}/update`, { status: 'running', stages: [{ id: 'diseno', status: 'running', attempts: 1 }] });
  assert.equal(server.pipelines.snapshot().runs[0].stages[0].status, 'running');
  await call(base, 'POST', `/v1/pipelines/${body.run.id}/cancel`);
  r = await call(base, 'POST', '/v1/hooks/claude-code', { session_id: 'c1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} });
  assert.deepEqual(r.body.cancel, [body.run.id]);
  // un Stop que cierra una etapa no pone a la sesión en "listo"
  await call(base, 'POST', '/v1/hooks/claude-code', { session_id: 'c1', hook_event_name: 'Stop', devteam_stage: true });
  assert.notEqual(server.office.sessionSummary('c1').status, 'done');
}));

test('lo que anuncia un agente se sanea: nada de campos de más ni textos gigantes', () => withServer(async (server, base) => {
  await call(base, 'POST', '/v1/agents/announce', {
    session: 'c2', cwd: '/p',
    project: { dir: '/p', name: 'x'.repeat(500), secret: 1, pipelines: [{ id: 'a', stages: [{ id: 's', role: 'qa', agentPrompt: 'privado', check: { run: 'npm test', expect: 'fail' } }] }, { name: 'sin id' }] },
  });
  const [p] = server.pipelines.projects();
  assert.ok(p.name.length <= 80);
  assert.equal(p.secret, undefined);
  assert.equal(p.pipelines.length, 1);
  assert.equal(p.pipelines[0].stages[0].agentPrompt, undefined);
  assert.deepEqual(p.pipelines[0].stages[0].check, { run: 'npm test', expect: 'fail' });
}));
