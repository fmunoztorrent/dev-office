// What an agent asks you on its screen (server/prompts.js): the selector read from a herdr pane,
// and the keys that answer it. The screens in fixtures/screens are real (Pi and Claude Code inside herdr).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePrompt, keysFor, PromptHub } from '../server/prompts.js';
import { Herdr } from '../server/herdr.js';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';
import { t } from '../public/i18n.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout');
};
const screen = (name) => fs.readFileSync(new URL(`./fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const CLAUDE = ['╭──────────────────────────────╮', '│ Bash command                 │', '│                              │', '│   rm -rf build               │', '│                              │', '│ Do you want to proceed?      │', '│ ❯ 1. Yes                     │', '│   2. Yes, and don’t ask again │', '│   3. No                      │', '╰──────────────────────────────╯'].join('\n');

test('lee la pregunta de la pantalla: un permiso, una elección con detalle y un diálogo numerado', () => {
  const gate = parsePrompt(screen('pi-permission-gate'));
  assert.deepEqual(gate.options.map((o) => o.label), ['Yes', 'No']);
  assert.match(gate.question, /Dangerous command:[\s\S]*rm -rf build[\s\S]*Allow\?$/);
  assert.equal(gate.cursor, 0);
  const choice = parsePrompt(screen('pi-ask-user-choice'));
  assert.equal(choice.question, '¿A partir de qué monto el envío es\ngratis: 5000 o 10000 centavos?');
  assert.deepEqual(choice.options.map((o) => o.label), ['5000 centavos', '10000 centavos']);
  assert.match(choice.options[1].detail, /Requiere cambiar la condición/);
  const claude = parsePrompt(CLAUDE);
  assert.deepEqual(claude.options.map((o) => o.label), ['Yes', 'Yes, and don’t ask again', 'No']);
  assert.match(claude.question, /Do you want to proceed\?$/);
  // in one line: what it is about and what it asks
  assert.match(gate.summary, /^⚠️ Dangerous command: … Allow\?$/);
  assert.equal(choice.summary, '¿A partir de qué monto el envío es gratis: 5000 o 10000 centavos?');
  assert.equal(claude.summary, 'Bash command … Do you want to proceed?');
  // right after starting the agent (a real screen): the shell's prompt above is not part of the question
  const login = parsePrompt(screen('claude-login'));
  assert.equal(login.summary, 'Welcome to Claude Code v2.1.287 … Select login method:');
  assert.deepEqual(login.options.map((o) => o.label), ['Claude account with subscription ·', 'Anthropic Console account · API usage', '3rd-party platform · Amazon Bedrock,']);
  assert.equal(login.options[0].detail, 'Pro, Max, Team, or Enterprise');
  // a list while you type (autocomplete) is not a question
  assert.equal(parsePrompt(' > /off\n → /office  join\n   /offline  x\n'), null);
  assert.equal(parsePrompt('hola'), null);
});

test('las teclas que responden: las flechas desde la opción marcada, y Enter', () => {
  const p = { options: [{}, {}, {}], cursor: 1 };
  assert.deepEqual(keysFor(p, 1), ['enter']);
  assert.deepEqual(keysFor(p, 2), ['down', 'enter']);
  assert.deepEqual(keysFor(p, 0), ['up', 'enter']);
  assert.equal(keysFor(p, 3), null);
});

test('responder: relee la pantalla y sólo aprieta si sigue siendo la misma pregunta', async () => {
  let shown = screen('pi-permission-gate');
  const pressed = [];
  const hub = new PromptHub({ herdr: { read: async () => shown, keys: async (pane, keys) => pressed.push([pane, ...keys]) }, officeOf: () => 'main' });
  const news = [];
  hub.on('new', (p) => news.push(p.question.split('\n').at(-1)));
  hub.round([{ pane: 'w1:p4', agent: 'pi', text: shown }]);
  hub.round([{ pane: 'w1:p4', agent: 'pi', text: shown }]); // the same question: not new again
  assert.deepEqual(news, ['Allow?']);
  const [p] = hub.list('main');
  // another question appeared in between: nothing is pressed
  shown = screen('pi-ask-user-choice');
  assert.equal((await hub.answer(p.id, { rev: p.rev, option: 1 })).status, 409);
  assert.deepEqual(pressed, []);
  // the one on screen now
  const [q] = hub.list('main');
  const r = await hub.answer(q.id, { rev: q.rev, option: 1 });
  assert.deepEqual([r.ok, r.answer], [true, '10000 centavos']);
  assert.deepEqual(pressed, [['w1:p4', 'down', 'enter']]);
  assert.deepEqual(hub.list('main'), []);
});

test('dentro de herdr: la pregunta llega al juego, el encargado va a tu escritorio y tu respuesta se aprieta en el pane del agente', async () => {
  let shown = screen('pi-permission-gate');
  const pressed = [];
  const panes = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'unknown' }, { pane_id: 'w1:p2', workspace_id: 'w1', agent: 'pi', agent_status: 'blocked', cwd: '/proyectos/tienda' }];
  const ok = (result = {}) => JSON.stringify({ id: 'cli', result });
  const run = async ([group, cmd, ...rest]) => {
    if (group === 'pane' && cmd === 'list') return ok({ panes });
    if (group === 'pane' && cmd === 'read') return rest[0] === 'w1:p2' ? shown : '';
    if (group === 'pane' && cmd === 'send-keys') { pressed.push(rest); shown = 'Listo: build borrado'; return ok(); }
    return ok();
  };
  const herdr = new Herdr({ env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1' }, run, every: 30 });
  const server = await startServer({ port: 0, socket: null, db: openStore(':memory:'), weather: false, herdr });
  const ws = new WebSocket(`${server.url.replace('http', 'ws')}/v1/ws`);
  const sent = [];
  // what the game gets: in the snapshot when it connects, and each change after that
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.type === 'prompts') sent.push(m.prompts); if (m.type === 'snapshot') sent.push(m.state.prompts); });
  try {
    // it is read from the agent's screen and reaches the game (HTTP and WebSocket)
    const [q] = await until(() => server.promptsOf('main').length && server.promptsOf('main'));
    assert.deepEqual([q.agent, q.project, q.pane, q.options.map((o) => o.label)], ['pi', 'tienda', 'w1:p2', ['Yes', 'No']]);
    const got = await fetch(`${server.url}/v1/prompts`).then((r) => r.json());
    assert.equal(got.prompts[0].summary, '⚠️ Dangerous command: … Allow?');
    await until(() => sent.some((l) => l.length));
    // the manager goes to your desk: the office gets a 'waiting'
    assert.ok(server.company.get('main').log.some((e) => e.kind === 'waiting' && e.text === 'Pi te pregunta: ⚠️ Dangerous command: … Allow?'));
    // an answer for a question you did not see presses nothing
    const post = (body) => fetch(`${server.url}/v1/prompts/${encodeURIComponent(q.id)}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const stale = await post({ rev: q.rev + 5, option: 0 });
    assert.deepEqual([stale.status, stale.error], [409, t('err.promptChanged')]);
    assert.deepEqual(pressed, []);
    // "No": one down from the marked one, and Enter, in the agent's pane
    const r = await post({ rev: q.rev, option: 1 });
    assert.deepEqual([r.ok, r.answer, r.keys], [true, 'No', ['down', 'enter']]);
    assert.deepEqual(pressed, [['w1:p2', 'down', 'enter']]);
    assert.deepEqual(server.promptsOf('main'), []);
    await until(() => sent.at(-1)?.length === 0);
  } finally {
    ws.close();
    await server.close();
  }
});

test('fuera de herdr no hay preguntas que leer ni teclas que apretar', async () => {
  const server = await startServer({ port: 0, socket: null, db: openStore(':memory:'), weather: false });
  try {
    assert.deepEqual((await fetch(`${server.url}/v1/prompts`).then((r) => r.json())).prompts, []);
    const r = await fetch(`${server.url}/v1/prompts/q-w1%3Ap2/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"option":0}' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, t('err.noHerdr'));
  } finally {
    await server.close();
  }
});
