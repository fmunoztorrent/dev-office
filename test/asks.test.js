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
