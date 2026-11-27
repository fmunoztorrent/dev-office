// btw: a side question to an office's agent on duty. It answers in a forked session
// (claude --fork-session…) without interrupting its work; the question and the answer show up in the
// game and the log, and stay in the database. The CLIs are fakes (test/fixtures/fake-btw.mjs).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { askCommand } from '../integrations/common/devteam.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fixtures', 'fake-btw.mjs');
const tmp = (p = 'dto-btw-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout');
};
const readLog = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function withServer(fn, opts = {}) {
  const log = path.join(tmp(), 'calls.jsonl');
  const env = { DEV_TEAM_OFFICE_CLAUDE_BIN: FAKE, FAKE_BTW_LOG: log, ...opts.env };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, asks: opts.asks || {} });
  try { await fn(server, log); } finally {
    await server.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('cada harness tiene su btw: bifurca la sesión cuando puede y nunca toca archivos', () => {
  const bin = FAKE;
  assert.deepEqual(askCommand('claude', { question: 'q', session: 'abc-123', bin }).argv, ['-p', 'q', '--resume', 'abc-123', '--fork-session', '--no-session-persistence', '--permission-mode', 'plan']);
  assert.deepEqual(askCommand('claude-code', { question: 'q', bin }).argv, ['-p', 'q', '--no-session-persistence', '--permission-mode', 'plan']);
  assert.deepEqual(askCommand('opencode', { question: 'q', session: 'ses_9', bin }).argv, ['run', '--session', 'ses_9', '--fork', '--agent', 'plan', 'q']);
  assert.deepEqual(askCommand('pi', { question: 'q', bin }).argv, ['-p', '--no-session', '--tools', 'read,grep,find,ls', 'q']);
  assert.deepEqual(askCommand('codex', { question: 'q', session: 'x', bin }).argv, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', 'q']);
  assert.equal(askCommand('claude', { question: 'q', session: 'a; rm -rf /', bin }).forked, false, 'un id raro no se pasa');
  assert.equal(askCommand('nada', { question: 'q' }).code, 'unknown');
  assert.equal(askCommand('codex', { question: 'q', bin: '/no/existe' }).code, 'missing');
});

test('btw al agente de turno: su sesión de Claude Code, bifurcada; la respuesta se ve en la oficina y queda guardada', () => withServer(async (server, log) => {
  const dir = tmp('dto-btw-proj-');
  server.company.ingest('claude-code', { session_id: 'sess-1111', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Cobros con QR' });
  server.company.ingest('generic', { session: 'sess-1111', cwd: dir, kind: 'phase', role: 'backend', phase: 'implementa', text: 'POST /payments/qr' });

  const res = await fetch(`${server.url}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'btw ¿en qué está el equipo?', wait: true }) }).then((r) => r.json());
  assert.equal(res.ok, true, res.error);
  assert.equal(res.ask.answer, 'El equipo está cobrando con QR.', 'sin colores de terminal');
  assert.deepEqual([res.ask.agent, res.ask.role, res.ask.forked, res.ask.status], ['claude-code', 'backend', true, 'answered']);
  assert.equal(res.ask.question, '¿en qué está el equipo?', 'el "btw" del principio no es parte de la pregunta');

  const [call] = readLog(log);
  assert.deepEqual(call.args.slice(2), ['--resume', 'sess-1111', '--fork-session', '--no-session-persistence', '--permission-mode', 'plan']);
  assert.match(call.args[1], /\[btw\][\s\S]*¿en qué está el equipo\?[\s\S]*en Español/);
  assert.equal(call.cwd, dir);
  assert.equal(call.btw, '1', 'las integraciones no reportan la consulta como trabajo');

  // in the office: the question and the answer (a character answers it)
  const btw = server.company.get('main').log.filter((e) => e.kind === 'btw');
  assert.deepEqual(btw.map((e) => [e.phase, e.role]), [['ask', 'backend'], ['answer', 'backend']]);
  assert.equal(server.company.get('main').roles.backend.text, 'POST /payments/qr', 'una pregunta al margen no cambia en qué está el rol');
  // guardada
  const saved = (await fetch(`${server.url}/v1/asks`).then((r) => r.json())).asks;
  assert.deepEqual(saved.map((a) => [a.question, a.status]), [['¿en qué está el equipo?', 'answered']]);
}));

test('sin sesión abierta contesta el agente registrado de esa oficina (con el contexto en el texto); sin ninguno, avisa', () => withServer(async (server, log) => {
  let out = server.asks.ask({ text: '¿qué hace el equipo?' });
  assert.equal(out.ok, false);
  assert.match(out.error, /No hay agente de turno/);

  const dir = tmp('dto-btw-pi-');
  server.store.createOffice({ name: 'Pagos' });
  server.company.load();
  assert.equal(server.store.createAgent({ path: dir, harness: 'pi', office: 'pagos', bin: FAKE }).ok, true);
  server.company.ingest('generic', { session: 'p1', office: 'pagos', kind: 'task', text: 'Cobros con QR' });

  out = server.asks.ask({ text: '¿quién hace los tests?', office: 'pagos', from: 'Terminal' });
  assert.equal(out.ok, true, out.error);
  const done = await out.done;
  assert.equal(done.status, 'answered');
  const [call] = readLog(log);
  assert.deepEqual(call.args.slice(0, 4), ['-p', '--no-session', '--tools', 'read,grep,find,ls']);
  assert.match(call.args.at(-1), /Oficina \(equipo\/dominio\): Pagos[\s\S]*Cobros con QR[\s\S]*¿quién hace los tests\?/);
  assert.equal(call.cwd, dir);
  assert.equal(server.store.listAsks({ office: 'main' }).length, 0, 'cada oficina con lo suyo');
  assert.equal(server.store.listAsks({ office: 'pagos' })[0].question, '¿quién hace los tests?');
}));

test('si la CLI falla o tarda demasiado, se avisa; mientras contesta no se acumulan preguntas', () => withServer(async (server) => {
  const dir = tmp('dto-btw-fail-');
  server.company.ingest('claude-code', { session_id: 'sess-2222', cwd: dir, hook_event_name: 'SessionStart' });
  process.env.FAKE_BTW_FAIL = '1';
  try {
    const out = server.asks.ask({ text: 'hola' });
    const done = await out.done;
    assert.equal(done.status, 'failed');
    assert.match(done.error, /no session found/);
    assert.equal(server.company.get('main').log.at(-1).phase, 'failed');
  } finally { delete process.env.FAKE_BTW_FAIL; }

  process.env.FAKE_BTW_SLOW = '3000';
  try {
    const first = server.asks.ask({ text: 'una' });
    assert.equal(first.ok, true);
    const second = server.asks.ask({ text: 'otra' });
    assert.equal(second.ok, false);
    assert.match(second.error, /todavía está contestando/);
    const done = await first.done;
    assert.equal(done.status, 'failed');
    assert.match(done.error, /Tardó demasiado/);
  } finally { delete process.env.FAKE_BTW_SLOW; }
}, { asks: { timeoutMs: 400 } }));

test('desde el juego: el mensaje "ask" por WebSocket, y el visor de esa oficina ve la pregunta y la respuesta', () => withServer(async (server) => {
  const dir = tmp('dto-btw-ws-');
  server.company.ingest('claude-code', { session_id: 'sess-3333', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Landing' });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  try {
    const snap = await until(() => msgs.find((m) => m.type === 'snapshot'));
    assert.deepEqual(snap.state.asks, []);
    ws.send(JSON.stringify({ type: 'ask', text: '¿qué falta?', id: 7 }));
    const ack = await until(() => msgs.find((m) => m.type === 'ack' && m.id === 7));
    assert.equal(ack.ok, true);
    assert.equal(ack.ask.status, 'asking');
    const answered = await until(() => msgs.find((m) => m.type === 'ask' && m.ask.status === 'answered'));
    assert.equal(answered.ask.answer, 'El equipo está cobrando con QR.');
    assert.ok(msgs.some((m) => m.type === 'event' && m.event.kind === 'btw' && m.event.phase === 'answer'));
  } finally { ws.close(); }
}));

test('una pregunta a un personaje la contesta el agente del proyecto donde trabaja, con su tarea, su plan y lo último que hizo', () => withServer(async (server, log) => {
  const tienda = tmp('dto-btw-tienda-'), pagos = tmp('dto-btw-pagos-');
  for (const dir of [tienda, pagos]) assert.equal(server.store.createAgent({ path: dir, harness: 'pi', bin: FAKE }).ok, true);
  const pi = (session, cwd, e) => server.company.ingest('pi', { session, cwd, ...e });
  pi('s-tienda', tienda, { kind: 'task', text: 'Carrito con descuentos' });
  pi('s-tienda', tienda, { kind: 'todos', todos: [{ content: 'Calcular el descuento', status: 'in_progress' }, { content: 'Tests del carrito', status: 'pending' }] });
  pi('s-tienda', tienda, { kind: 'phase', role: 'backend', phase: 'implementa', text: 'Editando src/cart.js' });
  pi('s-pagos', pagos, { kind: 'task', text: 'Landing de pagos' });
  pi('s-pagos', pagos, { kind: 'phase', role: 'frontend', phase: 'implementa', text: 'Editando la landing' });

  // Diego (backend) works in the shop, even though the latest session is the payments one
  let done = await server.asks.ask({ text: '¿cómo vas?', role: 'backend' }).done;
  assert.equal(done.status, 'answered');
  assert.equal(done.role, 'backend', 'contesta el personaje al que le preguntaste');
  let call = readLog(log).at(-1);
  assert.equal(call.cwd, tienda);
  const prompt = call.args.at(-1);
  assert.match(prompt, new RegExp(`Proyecto: ${path.basename(tienda)}`));
  assert.match(prompt, /La pregunta es para Diego \(Backend, concentrado\)/);
  assert.match(prompt, /Carrito con descuentos/);
  assert.match(prompt, /\[~\] Calcular el descuento[\s\S]*\[ \] Tests del carrito/);
  assert.match(prompt, /Editando src\/cart\.js/);
  assert.doesNotMatch(prompt, /landing/i, 'nada del otro proyecto');

  // Lucía (frontend) answers from the payments project
  done = await server.asks.ask({ text: '¿qué te falta?', role: 'frontend' }).done;
  call = readLog(log).at(-1);
  assert.equal(call.cwd, pagos);
  assert.match(call.args.at(-1), /Landing de pagos[\s\S]*Editando la landing/);
  assert.equal(done.role, 'frontend');

  // the session chosen in the game wins over the agent on duty
  await server.asks.ask({ text: '¿en qué estás?', session: 's-tienda' }).done;
  assert.equal(readLog(log).at(-1).cwd, tienda);
}));

test('una pregunta a un recién llegado (un subagente) vuelve marcada para él: la contesta él en el juego, no el personaje de su rol', () => withServer(async (server) => {
  const dir = tmp('dto-btw-sub-');
  server.company.ingest('claude-code', { session_id: 'sess-sub', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Carrito' });
  const res = await fetch(`${server.url}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '¿qué te pidieron?', role: 'backend', session: 'sess-sub', subId: 'sub-7', wait: true }) }).then((r) => r.json());
  assert.equal(res.ok, true, res.error);
  const btw = server.office.log.filter((e) => e.kind === 'btw');
  assert.deepEqual(btw.map((e) => [e.phase, e.role, e.subId]), [['ask', 'backend', 'sub-7'], ['answer', 'backend', 'sub-7']]);
}));

test('el tech lead sabe de qué repositorios le hablas; la PM habla de producto; el manager responde de equipo', () => withServer(async (server, log) => {
  const dir = tmp('dto-btw-tl-');
  const core = tmp('dto-btw-core-');
  server.store.createOffice({ name: 'Loyalty' });
  server.company.load();
  const bff = server.store.createAgent({ path: dir, harness: 'pi', name: 'loyalty-bff', office: 'loyalty', bin: FAKE }).agent;
  const coreA = server.store.createAgent({ path: core, harness: 'pi', name: 'loyalty-core', office: 'loyalty', bin: FAKE }).agent;
  server.store.saveRelation({ from: bff.id, to: coreA.id, how: 'calls' });
  let out = server.asks.ask({ text: '¿cómo valida el token el loyalty core?', office: 'loyalty', role: 'tl' });
  await out.done;
  let prompt = readLog(log).at(-1).args.at(-1);
  assert.match(prompt, /Los repositorios de los que trata la pregunta \(1\):\n- loyalty-core \(/, 'nombrado con espacios en vez de guiones');
  assert.match(prompt, /lo usan: loyalty-bff/);
  assert.match(prompt, /Respondes como el tech lead/);
  out = server.asks.ask({ text: '¿para qué sirven los puntos?', office: 'loyalty', role: 'analyst' });
  await out.done;
  prompt = readLog(log).at(-1).args.at(-1);
  assert.match(prompt, /Respondes como la PM del proyecto[\s\S]*Nunca entres en detalles técnicos/);
  assert.doesNotMatch(prompt, /Los repositorios de los que trata/, 'la PM no recibe el bloque técnico');
}));

test('una orden al manager va a trabajo de inmediato, al repositorio que nombra (sin la revisión de la analista)', () => withServer(async (server) => {
  const a = tmp('dto-ord-a-'), b = tmp('dto-ord-b-');
  server.store.createOffice({ name: 'Loyalty' });
  server.company.load();
  server.store.createAgent({ path: a, harness: 'claude-code', name: 'loyalty-bff', office: 'loyalty', bin: '/nonexistent/claude' });
  server.store.createAgent({ path: b, harness: 'claude-code', name: 'loyalty-core', office: 'loyalty', bin: '/nonexistent/claude' });
  const post = (body) => fetch(`${server.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  let r = await post({ type: 'order', office: 'loyalty', text: 'Agrega un endpoint de canje' });
  assert.equal(r.ok, false);
  assert.match(r.error, /¿Cuál repositorio\? Nómbralo: loyalty-bff, loyalty-core/, 'con dos, pregunta cuál');
  r = await post({ type: 'order', office: 'loyalty', text: 'Agrega en loyalty-core un endpoint de canje' });
  assert.equal(r.target, 'loyalty-core', 'el que nombra');
  assert.match(r.error, /\/nonexistent\/claude/, 'y fue a lanzarlo de inmediato (aquí su CLI no existe)');
  assert.equal(server.clarify.list?.().length ?? 0, 0, 'la analista no la revisa');
}));

test('si la CLI falla, se ve el error del proveedor, no las advertencias que imprimen sus extensiones antes', () => withServer(async (server) => {
  const dir = tmp('dto-btw-warn-');
  server.company.ingest('claude-code', { session_id: 'sess-4444', cwd: dir, hook_event_name: 'SessionStart' });
  process.env.FAKE_BTW_FAIL = 'provider';
  try {
    const done = await server.asks.ask({ text: '¿qué hay?' }).done;
    assert.equal(done.status, 'failed');
    assert.equal(done.error, '401 · This API key has expired.');
  } finally { delete process.env.FAKE_BTW_FAIL; }
}));

test('quien no está trabajando no tiene nada que contar: te dice con quién hablar, sin correr ningún agente', () => withServer(async (server, log) => {
  const dir = tmp('dto-btw-idle-');
  assert.equal(server.store.createAgent({ path: dir, harness: 'pi', bin: FAKE }).ok, true);
  const pi = (e) => server.company.ingest('pi', { session: 's-idle', cwd: dir, ...e });
  pi({ kind: 'task', text: 'Carrito' });
  pi({ kind: 'phase', role: 'backend', phase: 'implementa', text: 'Editando src/cart.js' });
  const office = server.company.get('main');
  assert.equal(office.working('backend'), true, 'a mitad de turno, trabaja');
  pi({ kind: 'turn_end' });
  assert.equal(office.working('backend'), false, 'su turno terminó');
  assert.equal(office.working('qa'), false, 'nunca hizo nada');

  const out = server.asks.ask({ text: '¿qué estás haciendo?', role: 'backend' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'idle');
  assert.match(out.error, /Valentina[\s\S]*Tomás[\s\S]*Marco[\s\S]*pizarra/, 'a quién ir: negocio, técnico, ya, y la pizarra');
  assert.deepEqual(readLog(log), [], 'no se corrió ningún agente');
  assert.equal(office.log.filter((e) => e.kind === 'btw').length, 0, 'no va a la bitácora');

  // the analyst, the tech lead and the manager are asked about the project, whatever they are doing
  const done = await server.asks.ask({ text: '¿para quién es el carrito?', role: 'analyst' }).done;
  assert.equal(done.status, 'answered');
  assert.match(readLog(log).at(-1).args.at(-1), /responde como esa persona, sobre este proyecto/);

  // a newcomer (a subagent) or a chosen session are asked about that one, as always
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  try {
    ws.send(JSON.stringify({ type: 'ask', text: '¿cómo vas?', role: 'qa', id: 'ask:1' }));
    const ack = await until(() => msgs.find((m) => m.type === 'ack' && m.id === 'ask:1'));
    assert.deepEqual([ack.ok, ack.code], [false, 'idle'], 'el juego recibe la guía como respuesta de su pregunta');
  } finally { ws.close(); }
}));
