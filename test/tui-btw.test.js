// btw in the terminal: `b` opens the line with "btw " and Enter asks the agent on duty.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout');
};

test('en el juego de la terminal: b → "btw <pregunta>" → la oficina se la pregunta al agente de turno', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const asked = [];
  server.asks.ask = (q) => { asked.push(q); return { ok: false, error: 'sin agente' }; };
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: 160, rows: 46, out: '', write(s) { this.out += s; return true; } });
  const feed = localFeed(server);
  const done = runTui({ feed, stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(120);
    assert.match(stdout.out, /btw \(preguntar\)/, 'la tecla aparece en la ayuda');
    stdin.emit('data', 'b');
    for (const ch of '¿quién hace QA?') stdin.emit('data', ch);
    stdin.emit('data', '\r');
    await until(() => asked.length);
    assert.deepEqual(asked, [{ text: '¿quién hace QA?', office: 'main', from: 'Terminal' }]);
  } finally {
    stdin.emit('data', 'q');
    await done;
    feed.close();
    await server.close();
  }
});
