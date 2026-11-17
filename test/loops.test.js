// A project's loop (server/loops.js): steps with success criteria, worked through one after the other.
// Every `interval` minutes it looks at its project: while it works (or waits for you) it waits; idle, the
// step that did not go goes, and the one that went is checked against its criteria: all met, the next
// one; one not met, the same step again with what is missing; not reported, the agent checks them.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { LoopDesk, cleanCriteria, parseVerdict, stepBrief, criteriaOf, LOOP_INTERVAL } from '../server/loops.js';
import { startServer } from '../server/server.js';
import { createMcp } from '../server/mcp.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-loop-')));
const MIN = 60_000;

/** A loop desk with a project and a registry that only writes down what it is sent (each brief, a task). */
function setup() {
  const store = openStore(':memory:');
  const dir = tmp();
  const agent = store.createAgent({ path: dir, harness: 'claude-code', name: 'tienda', bin: '/nonexistent/claude' }).agent;
  const hub = new EventEmitter();
  hub.tasks = new Map();
  const sent = [];
  let seq = 0;
  const registry = {
    run(msg) {
      const task = { id: `t${++seq}`, status: 'running', output: [] };
      hub.tasks.set(task.id, task);
      sent.push({ ...msg, task });
      return { ok: true, task };
    },
  };
  const log = [];
  const minutes = [];
  const company = { ingest: (_src, ev) => log.push(ev) };
  const archive = { save: (e) => minutes.push(e) };
  const clock = { t: Date.UTC(2026, 10, 14, 12) };
  const desk = new LoopDesk({ store, registry, hub, pipelines: { runs: new Map() }, company, archive, now: () => clock.t });
  const later = (min) => { clock.t += min * MIN; };
  const finish = (n = sent.length, output) => { const t = sent[n - 1].task; t.status = 'done'; if (output) t.output = output.split('\n'); };
  return { store, dir, agent, desk, sent, log, minutes, clock, later, finish };
}

test('los criterios llevan su id; un texto solo también es un criterio; la respuesta dice cuáles se cumplen', () => {
  const crit = cleanCriteria(['Los tests pasan', { text: 'El endpoint responde 200', check: 'curl -f localhost:3000/health' }]);
  assert.deepEqual(crit.map((c) => c.id), ['c1', 'c2']);
  assert.equal(crit[1].check, 'curl -f localhost:3000/health');
  assert.throws(() => cleanCriteria(['']), /vacío/);
  const v = parseVerdict('Listo.\n✅ 1 — 42 tests en verde\n❌ 2 — devuelve 500\n✅ 7', crit);
  assert.deepEqual(v.c1, { met: true, note: '42 tests en verde' });
  assert.deepEqual(v.c2, { met: false, note: 'devuelve 500' });
  assert.equal(Object.keys(v).length, 2, 'un número que no es de un criterio no cuenta');
  assert.deepEqual(parseVerdict('- [x] 1\n- [ ] 2: falta', crit), { c1: { met: true, note: '' }, c2: { met: false, note: 'falta' } });
});

test('el encargo de un paso lleva el paso, sus criterios numerados (los del loop primero) y cómo reportarlos', () => {
  const loop = { name: 'Login', tries: 5, criteria: cleanCriteria(['Los tests pasan'], 'g'), steps: [] };
  const step = { text: 'Implementa POST /login', criteria: cleanCriteria([{ text: 'Devuelve un JWT', check: 'npm test -- login' }]), tries: 0, results: {} };
  loop.steps = [step, { text: 'otro', criteria: [] }];
  const brief = stepBrief(loop, step);
  assert.match(brief, /^🔁 Loop «Login» · paso 1 de 2\nImplementa POST \/login/);
  assert.match(brief, /1\. Los tests pasan\n2\. Devuelve un JWT — verifícalo con `npm test -- login`/);
  assert.match(brief, /loop_report \(loop «Login», paso 1\)/);
  assert.deepEqual(criteriaOf(loop, step).map((c) => c.id), ['g1', 'c1']);
  step.results = { g1: { met: false, note: 'falla auth.test.js' } };
  step.tries = 1;
  const again = stepBrief(loop, step, { kind: 'retry' });
  assert.match(again, /intento 2 de 5/);
  assert.match(again, /❌ 1\. Los tests pasan — falla auth\.test\.js\n❔ 2\. Devuelve un JWT/);
});

test('un loop envía el primer paso al crearse; mientras trabaja espera; sin reporte pide verificar; cumplido, va el siguiente', () => {
  const { desk, sent, agent, later, finish, log } = setup();
  const out = desk.create({ name: 'Login', project: agent.id, criteria: ['Los tests pasan'], steps: [{ text: 'Implementa POST /login', criteria: ['Devuelve un JWT'] }, 'Documenta el endpoint'] });
  assert.ok(out.ok, out.error);
  assert.equal(out.loop.interval, LOOP_INTERVAL);
  assert.equal(sent.length, 1, 'el primer paso va al crearlo (su primera mirada es ahora)');
  assert.equal(sent[0].target, agent.id);
  assert.match(sent[0].title, /^🔁 Login · 1\/2: Implementa/);
  assert.match(sent[0].text, /2\. Devuelve un JWT/);
  const id = out.loop.id;
  assert.equal(desk.get(id).activity, 'working');

  // antes del intervalo no mira; después, el encargo sigue abierto: espera
  later(2); desk.tickAll();
  assert.equal(sent.length, 1);
  later(4); desk.tickAll();
  assert.equal(sent.length, 1);
  assert.equal(desk.get(id).activity, 'working');

  // terminó sin reportar: le pide verificar (intento 2)
  finish();
  later(5); desk.tickAll();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /No llegó cómo va cada criterio/);
  assert.match(sent[1].text, /❔ 1\. Los tests pasan\n❔ 2\. Devuelve un JWT/);

  // reporta todo cumplido; al terminar su turno y en la próxima mirada, el paso se cumple y va el siguiente
  const r = desk.report({ cwd: agent.path, results: [{ criterion: 1, met: true }, { criterion: 2, met: true, note: 'token firmado' }] });
  assert.ok(r.ok, r.error);
  assert.deepEqual([r.met, r.total, r.missing], [2, 2, []]);
  finish();
  later(5); desk.tickAll();
  const l = desk.get(id);
  assert.equal(l.steps[0].status, 'done');
  assert.equal(l.current, 1);
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /paso 2 de 2\nDocumenta el endpoint/);
  assert.match(sent[2].text, /1\. Los tests pasan/, 'los criterios del loop van en cada paso');
  assert.ok(log.some((e) => e.kind === 'loop' && e.phase === 'passed'));
});

test('un criterio que no se cumple vuelve con lo que falta; a los intentos, el loop te espera; reintentar o saltar lo sigue', () => {
  const { desk, sent, agent, later, finish, log } = setup();
  const id = desk.create({ name: 'Pagos', project: agent.id, tries: 2, steps: [{ text: 'Cobra con tarjeta', criteria: ['El cobro queda registrado'] }, 'Envía el recibo'] }).loop.id;
  desk.report({ loop: 'Pagos', results: [{ criterion: 1, met: false, note: 'no se guarda' }] });
  finish();
  later(5); desk.tickAll();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Todavía no se cumplen/);
  assert.match(sent[1].text, /❌ 1\. El cobro queda registrado — no se guarda/);
  assert.match(sent[1].text, /intento 2 de 2/);

  // lo de la ronda anterior no cuenta: vuelve a reportar; sigue sin cumplirse y ya usó sus intentos
  assert.equal(desk.get(id).steps[0].results.c1, null);
  desk.report({ loop: id, results: [{ criterion: 1, met: false }] });
  finish();
  later(5); desk.tickAll();
  let l = desk.get(id);
  assert.equal(l.status, 'blocked');
  assert.equal(l.steps[0].status, 'blocked');
  assert.match(l.detail, /intentos/);
  assert.ok(log.some((e) => e.kind === 'loop' && e.phase === 'blocked' && e.ok === false));
  later(30); desk.tickAll();
  assert.equal(sent.length, 2, 'bloqueado no envía nada');

  // reintentar: el paso recupera sus intentos y vuelve a ir ahora
  assert.ok(desk.resume(id).ok);
  assert.equal(sent.length, 3);
  assert.equal(desk.get(id).status, 'running');
  // saltarlo: va el siguiente
  finish();
  assert.ok(desk.skip(id).ok);
  l = desk.get(id);
  assert.equal(l.steps[0].status, 'skipped');
  assert.equal(sent.length, 4);
  assert.match(sent[3].text, /Envía el recibo/);
});

test('el loop sabe si su proyecto trabaja: una sesión en su carpeta a mitad de turno lo hace esperar, y te pregunta: espera tu respuesta', () => {
  const { desk, sent, agent, later, finish } = setup();
  const id = desk.create({ name: 'Docs', project: agent.id, steps: ['Escribe el README', 'Escribe la guía'] }).loop.id;
  finish();
  // tú trabajas con otro agente en la misma carpeta: el loop no lo interrumpe
  const s = { id: 'cc-1', cwd: path.join(agent.path, 'src'), status: 'active' };
  desk.onEvent('main', { kind: 'tool_start' }, s);
  later(5); desk.tickAll();
  assert.equal(desk.get(id).activity, 'working');
  assert.equal(sent.length, 1);
  desk.onEvent('main', { kind: 'waiting' }, { ...s, status: 'waiting' });
  later(5); desk.tickAll();
  assert.equal(desk.get(id).activity, 'waiting');
  assert.match(desk.get(id).detail, /te pregunta/);
  // terminó su turno: libre. Sin criterios, el paso que terminó bien se cumple y va el siguiente
  desk.onEvent('main', { kind: 'turn_end' }, s);
  later(5); desk.tickAll();
  assert.equal(desk.get(id).steps[0].status, 'done');
  assert.equal(sent.length, 2);
  // una sesión que calla media hora no lo tiene esperando para siempre
  finish();
  desk.onEvent('main', { kind: 'tool_start' }, s);
  later(31); desk.tickAll();
  assert.equal(desk.get(id).status, 'done');
});

test('los criterios se agregan mientras corre; tu marca queda sobre lo que reporte el agente; la respuesta en segundo plano también cuenta', () => {
  const { desk, sent, agent, later, finish } = setup();
  const id = desk.create({ name: 'API', project: agent.id, interval: 10, steps: [{ text: 'Agrega /health', criteria: ['Responde 200'] }] }).loop.id;
  // un criterio para todo el loop, ya con el paso en curso: sin reportar, se pide verificar
  assert.ok(desk.addCriteria(id, { criteria: ['El lint pasa'] }).ok);
  desk.report({ loop: id, step: 1, results: [{ criterion: 'c1', met: true }] });
  // tú marcas el del lint como cumplido; el agente después dice que no: queda el tuyo
  assert.ok(desk.report({ loop: id, results: [{ criterion: 'g1', met: true }], by: 'you' }).ok);
  desk.report({ loop: id, results: [{ criterion: 'g1', met: false }] });
  assert.equal(desk.get(id).steps[0].results.g1.by, 'you');
  // la respuesta de la sesión en segundo plano: sus líneas «✅ n»
  finish(1, 'Hecho.\n✅ 1\n✅ 2');
  later(5); desk.tickAll();
  assert.equal(desk.get(id).status, 'running', 'a los 5 minutos no mira: su intervalo es de 10');
  later(5); desk.tickAll();
  const l = desk.get(id);
  assert.equal(l.status, 'done');
  assert.equal(sent.length, 1);
});

test('un loop terminado deja su acta en el archivo; un paso nuevo lo pone en marcha otra vez; sobrevive a reiniciar la oficina', () => {
  const { desk, sent, agent, later, finish, minutes, store } = setup();
  const id = desk.create({ name: 'Release', project: agent.id, steps: ['Sube la versión'] }).loop.id;
  finish();
  later(5); desk.tickAll();
  assert.equal(desk.get(id).status, 'done');
  assert.equal(minutes.length, 1);
  assert.equal(minutes[0].kind, 'minute');
  assert.match(minutes[0].body, /1\. cumplido — Sube la versión/);
  assert.ok(desk.addSteps(id, ['Publica el changelog']).ok);
  assert.equal(desk.get(id).status, 'running');
  later(5); desk.tickAll();
  assert.equal(sent.length, 2);

  // la oficina se cierra con el paso en curso: al volver, su encargo ya no existe y se le pide verificar
  const again = new LoopDesk({ store, registry: { run: (m) => { sent.push({ ...m, task: { id: 'tx', status: 'running', output: [] } }); return { ok: true, task: { id: 'tx', status: 'running' } }; } }, hub: { tasks: new Map() }, pipelines: { runs: new Map() }, company: { ingest() {} }, now: () => Date.now() });
  const l = again.get('Release');
  assert.equal(l.steps[1].status, 'working');
  assert.equal(l.steps[1].ref, null);
  again.tickAll();
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /paso 2 de 2 · intento 2 de 5\nEste paso quedó a medias/);
});

test('validación: proyecto, intervalo, pasos y nombre único', () => {
  const { desk, agent } = setup();
  assert.match(desk.create({ name: 'X', project: 'nadie', steps: ['a'] }).error, /repositorio desconocido/);
  assert.match(desk.create({ name: 'X', project: agent.id, interval: 0, steps: ['a'] }).error, /intervalo/);
  assert.match(desk.create({ name: 'X', project: agent.id, steps: [''] }).error, /cada paso/);
  assert.match(desk.create({ name: '', project: agent.id }).error, /nombre/);
  assert.ok(desk.create({ name: 'X', project: agent.name, steps: ['a'], paused: true }).ok, 'el proyecto también por su nombre');
  assert.match(desk.create({ name: 'x', project: agent.id, steps: ['a'] }).error, /ya hay un loop/);
  assert.equal(desk.list()[0].status, 'paused');
  assert.match(desk.tick('X').error, /en pausa/);
});

test('API y MCP: crear un loop, el agente reporta con loop_report desde su carpeta y list_loops lo muestra', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, loops: { autostart: false } });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const dir = tmp();
    const a = (await call('POST', '/v1/agents', { path: dir, harness: 'claude-code', name: 'caja', bin: '/nonexistent/claude' })).agent;
    const made = await call('POST', '/v1/loops', { name: 'Caja', project: a.id, interval: 3, criteria: ['Los tests pasan'], steps: [{ text: 'Cuadra la caja' }], paused: true });
    assert.equal(made.status, 201, made.error);
    assert.equal(made.loop.interval, 3);
    assert.equal((await call('GET', '/v1/loops')).loops.length, 1);
    assert.equal((await call('POST', `/v1/loops/${made.loop.id}/criteria`, { criteria: ['Sin warnings'], step: 1 })).loop.steps[0].criteria.length, 1);
    const mcp = createMcp({ base: server.url, socket: null, cwd: dir, env: {} });
    await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } } });
    const tool = async (name, args) => (await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).result;
    const r = await tool('loop_report', { results: [{ criterion: 1, met: true }, { criterion: 2, met: false, note: '3 warnings' }] });
    assert.ok(!r.isError, r.content[0].text);
    assert.match(r.content[0].text, /1\/2 met\. Still missing: Sin warnings/);
    const mark = await call('POST', `/v1/loops/${made.loop.id}/mark`, { step: 1, criterion: 2, met: true });
    assert.equal(mark.met, 2);
    const listed = await tool('list_loops', {});
    assert.match(listed.content[0].text, /Caja \(caja, every 3 min\): paused/);
    assert.match(listed.content[0].text, /✅ 1\. Los tests pasan\n {6}✅ 2\. Sin warnings/);
    assert.equal((await call('POST', `/v1/loops/${made.loop.id}/tick`, {})).status, 400, 'en pausa no mira');
    assert.equal((await call('DELETE', `/v1/loops/${made.loop.id}`)).ok, true);
    assert.equal((await call('GET', `/v1/loops/${made.loop.id}`)).status, 404);
  } finally { await server.close(); }
});

test('si el proyecto trabaja o está libre se ve en vivo, sin esperar la próxima mirada (y sin enviar nada)', () => {
  const { desk, sent, agent, finish } = setup();
  const id = desk.create({ name: 'Vivo', project: agent.id, steps: ['Uno', 'Dos'] }).loop.id;
  assert.equal(desk.get(id).activity, 'working');
  finish();
  assert.equal(desk.sense(), true);
  assert.equal(desk.get(id).activity, 'idle');
  assert.equal(sent.length, 1, 'mirar si trabaja no envía: eso lo hace cada mirada');
  assert.equal(desk.sense(), false);
});

test('en la bitácora de la terminal: lo que te espera se destaca y lo cumplido va en verde', async () => {
  const { activityLine } = await import('../tui/console.js');
  assert.equal(activityLine({ kind: 'loop', phase: 'blocked', ok: false, text: '✋ «X» te espera' }).tone, 'warn');
  assert.equal(activityLine({ kind: 'loop', phase: 'passed', text: '✅ «X» · paso 1/2 cumplido' }).tone, 'ok');
  assert.equal(activityLine({ kind: 'loop', phase: 'start', text: '🔁 «X» · paso 1/2' }).text, '🔁 «X» · paso 1/2');
});
