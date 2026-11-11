// Autonomy: before a brief goes to work the analyst checks it has everything (the project's agent
// reads it, read-only) and brings you only the questions that would change the result; with your
// answers (or none) it goes to work. And when an agent stops to wait for you, the office knows it.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ClarifyDesk, parseReview, clarified } from '../server/clarify.js';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-clarify-')));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('timeout');
};
/** A fake CLI: it answers `output` (and logs what it was asked). */
function fakeSpawn(output, calls = []) {
  return (exe, argv, opts) => {
    calls.push({ exe, argv, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit('data', output); child.emit('close', 0); }, 5);
    return child;
  };
}

test('lo que contesta la revisión: LISTO, o hasta 3 preguntas con «P:» o «Q:»', () => {
  assert.deepEqual(parseReview('LISTO'), []);
  assert.deepEqual(parseReview('READY\n'), []);
  assert.deepEqual(parseReview('P: ¿Para web o también móvil?\n1. P: ¿Qué pasa con los cupones vencidos?\n- Q: Which currency?\nP: una\nP: de más'), ['¿Para web o también móvil?', '¿Qué pasa con los cupones vencidos?', 'Which currency?']);
  assert.deepEqual(parseReview('\x1b[1mP:\x1b[0m ¿Cuál es el límite?'), ['¿Cuál es el límite?'], 'sin colores de terminal');
  const text = clarified('Cupones de descuento', { questions: ['¿Acumulables?', '¿Vencen?'], answers: ['No', ''] });
  assert.equal(text, 'Cupones de descuento\n\nLo que aclaró la PO:\n- P: ¿Acumulables?\n  R: No\n- P: ¿Vencen?\n  R: (sin respuesta: decide de forma razonable y anótalo)');
  assert.match(clarified('X', { skip: true }), /^X\n\nLa PO le deja los puntos abiertos al equipo/);
});

function desk({ output, prefs = { clarify: true } } = {}) {
  const dir = tmp();
  const sent = [];
  const events = [];
  const calls = [];
  const target = { id: 'tienda-pi', name: 'tienda', path: dir, harness: 'pi', office: 'main', bin: process.execPath, sessions: [] };
  const registry = { targets: () => [target], run: (msg) => { sent.push(msg); return { ok: true, task: { id: 't1', status: 'running' } }; } };
  const store = openStore(':memory:');
  store.setPrefs({ autonomy: prefs });
  const company = { ingest: (_, ev) => events.push(ev) };
  const d = new ClarifyDesk({ registry, store, company, spawn: fakeSpawn(output, calls) });
  return { d, sent, events, calls, store, dir };
}

test('con todo lo necesario el encargo va directo a trabajo; con preguntas, la analista te las trae y tus respuestas van con él', async () => {
  // ready: it goes as it is
  let k = desk({ output: 'LISTO\n' });
  let out = k.d.review({ type: 'run', target: 'tienda-pi', entry: 'prompt', text: 'Agrega paginación' });
  assert.equal(out.clarify.status, 'reviewing');
  await until(() => k.sent.length);
  assert.equal(k.sent[0].text, 'Agrega paginación');
  assert.deepEqual(k.events.map((e) => [e.kind, e.phase]), [['clarify', 'review'], ['clarify', 'sent']]);
  // the reviewer read it read-only, in the project's folder, with what it is about
  assert.equal(k.calls[0].opts.cwd, k.dir);
  assert.ok(k.calls[0].argv.includes('--tools') && k.calls[0].argv.includes('read,grep,find,ls'), 'Pi en sólo lectura');
  assert.match(k.calls[0].argv.join(' '), /Agrega paginación/);
  assert.equal(k.calls[0].opts.env.DEV_TEAM_OFFICE_BTW, '1', 'su revisión no se reporta como trabajo del equipo');
  k.store.close();

  // questions: she waits for you; your answers go with the brief
  k = desk({ output: 'P: ¿Los cupones se acumulan?\nP: ¿Tienen vencimiento?\n' });
  out = k.d.review({ type: 'run', target: 'tienda-pi', entry: 'prompt', text: 'Cupones de descuento' });
  await until(() => k.d.list()[0].status === 'asking');
  const c = k.d.list()[0];
  assert.deepEqual(c.questions, ['¿Los cupones se acumulan?', '¿Tienen vencimiento?']);
  assert.deepEqual(k.events.at(-1), { kind: 'clarify', session: 'office', office: 'main', phase: 'ask', clarifyId: c.id, text: '¿Los cupones se acumulan? · ¿Tienen vencimiento?', n: 2, project: 'tienda' });
  assert.equal(k.sent.length, 0, 'todavía no se manda');
  const r = k.d.answer(c.id, { answers: ['No', 'Sí, 30 días'] });
  assert.equal(r.ok, true);
  assert.match(k.sent[0].text, /^Cupones de descuento\n\nLo que aclaró la PO:\n- P: ¿Los cupones se acumulan\?\n  R: No\n- P: ¿Tienen vencimiento\?\n  R: Sí, 30 días$/);
  assert.equal(k.sent[0].clarified, true);
  assert.equal(k.d.list()[0].status, 'sent');
  assert.equal(k.d.answer(c.id, { answers: [] }).ok, false, 'ya no espera respuestas');
  k.store.close();

  // you can also leave it to the team, or cancel it
  k = desk({ output: 'P: ¿Moneda?\n' });
  k.d.review({ target: 'tienda-pi', text: 'Precios' });
  await until(() => k.d.list()[0]?.status === 'asking');
  k.d.answer(k.d.list()[0].id, { skip: true });
  assert.match(k.sent[0].text, /La PO le deja los puntos abiertos al equipo/);
  k.d.review({ target: 'tienda-pi', text: 'Otra cosa' });
  await until(() => k.d.list().at(-1)?.status === 'asking');
  assert.equal(k.d.cancel(k.d.list().at(-1).id).ok, true);
  assert.equal(k.sent.length, 1, 'cancelado no se manda');
  k.store.close();
});

test('sin revisión (apagada en ⚙ › General) el encargo va directo', () => {
  const k = desk({ output: 'P: ¿algo?', prefs: { clarify: false } });
  const out = k.d.review({ target: 'tienda-pi', text: 'Agrega paginación' });
  assert.equal(out.ok, true);
  assert.equal(k.sent.length, 1);
  assert.equal(k.calls.length, 0, 'nadie lo revisó');
  k.store.close();
});

test('en el servidor: la pregunta de la analista llega a la oficina, se contesta por HTTP y el encargo sale', async () => {
  const dir = tmp();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, clarify: { spawn: fakeSpawn('P: ¿Para qué países?\n') } });
  try {
    const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
    const a = (await call('POST', '/v1/agents', { path: dir, harness: 'pi', name: 'tienda', bin: process.execPath })).agent;
    let out = await call('POST', `/v1/agents/${a.id}/prompt`, { text: 'Envío gratis' });
    assert.equal(out.clarify.status, 'reviewing');
    const c = await until(async () => (await call('GET', '/v1/clarifications')).clarifications.find((x) => x.status === 'asking'));
    assert.deepEqual(c.questions, ['¿Para qué países?']);
    assert.ok(server.office.log.some((e) => e.kind === 'clarify' && e.phase === 'ask' && e.role === 'analyst'), 'la analista la trae a la oficina');
    out = await call('POST', `/v1/clarifications/${c.id}/answer`, { answers: ['Chile'] });
    assert.equal(out.clarify.status, out.ok ? 'sent' : 'failed');
    assert.match(out.clarify.text, /Envío gratis/);
  } finally { await server.close(); }
});

test('un agente que te pregunta con su herramienta de preguntas, o que espera tu permiso, queda esperándote hasta su próximo paso', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const cc = (body) => server.company.ingest('claude-code', { session_id: 'w1', cwd: '/tmp', ...body });
    cc({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '¿Postgres o SQLite?' }] } });
    let s = server.company.session('w1');
    assert.equal(s.status, 'waiting');
    assert.equal(s.waiting.question, true);
    cc({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {}, tool_response: {} });
    s = server.company.session('w1');
    assert.equal(s.status, 'active');
    assert.equal(s.waiting, undefined, 'ya contestaste');
    cc({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
    s = server.company.session('w1');
    assert.deepEqual([s.status, s.waiting.text, s.waiting.question], ['waiting', 'Claude needs your permission to use Bash', false]);
  } finally { await server.close(); }
});

test('el juego de la terminal también muestra que te esperan, hasta que contestas', async () => {
  const { runTui } = await import('../tui/app.js');
  const { localFeed } = await import('../tui/feeds.js');
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: 140, rows: 40, out: '', write(s) { this.out += s; return true; } });
  const done = runTui({ feed: localFeed(server), stdin, stdout, colorMode: 'truecolor' });
  try {
    await new Promise((r) => setTimeout(r, 150));
    server.company.ingest('claude-code', { session_id: 'w2', cwd: '/tmp/tienda', hook_event_name: 'Notification', message: 'Claude necesita tu permiso para usar Bash' });
    const plain = () => stdout.out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    await until(() => plain().includes('✋ Claude · tienda te está esperando · Claude necesita tu permiso para usar Bash'));
  } finally {
    stdin.emit('data', 'q');
    await done;
    await server.close();
  }
});

test('cada departamento con su autonomía: el autónomo no pasa por la analista; el guiado sí, aunque la empresa no, y sin la línea del modo autónomo', async () => {
  // the company does not review, but this department is guided
  let k = desk({ output: 'P: ¿Pesos o dólares?\n', prefs: { clarify: false } });
  k.store.updateOffice('main', { autonomy: 'guided' });
  let out = k.d.review({ type: 'run', target: 'tienda-pi', entry: 'prompt', text: 'Precios en la tienda' });
  assert.equal(out.clarify?.status, 'reviewing');
  await until(() => k.d.list()[0].status === 'asking');
  k.store.close();
  // the company reviews, but this department is autonomous: straight to work
  k = desk({ output: 'P: ¿algo?\n', prefs: { clarify: true } });
  k.store.updateOffice('main', { autonomy: 'autonomous' });
  out = k.d.review({ type: 'run', target: 'tienda-pi', entry: 'prompt', text: 'Agrega paginación' });
  assert.equal(out.ok, true);
  assert.equal(out.clarify, undefined);
  assert.equal(k.sent.length, 1);
  assert.equal(k.calls.length, 0, 'nadie revisó');
  k.store.close();
  // a guided department's briefs go without the autonomous-mode line
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const dir = tmp();
    server.store.createOffice({ name: 'Pagos', autonomy: 'guided' });
    server.store.createAgent({ path: dir, harness: 'pi', name: 'pagos-api', office: 'Pagos' });
    assert.doesNotMatch(server.hub.brief('Cobros con QR', dir), /Modo autónomo/);
    server.store.updateOffice('pagos', { autonomy: 'balanced' });
    assert.match(server.hub.brief('Cobros con QR', dir), /Modo autónomo/);
  } finally { await server.close(); }
});
