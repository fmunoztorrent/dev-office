import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';

function fakeTerminal(cols = 160, rows = 46) {
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: cols, rows, out: '', write(s) { this.out += s; return true; } });
  return { stdin, stdout, type: (s) => stdin.emit('data', s) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('desde la TUI: t + texto + Enter manda la tarea a la sesión de Pi conectada', async () => {
  const server = await startServer({ port: 0, socket: null, config: {} });
  const agent = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const received = [];
  agent.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'task') received.push(m); });
  await new Promise((r) => agent.on('open', r));
  agent.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-9', cwd: '/Users/yo/tienda' }));
  await sleep(100);

  const term = fakeTerminal();
  const done = runTui({ feed: localFeed(server), stdin: term.stdin, stdout: term.stdout, colorMode: 'truecolor' });
  await sleep(120);
  term.type('t');
  term.type('Agrega paginación al listado');
  await sleep(120);
  assert.match(term.stdout.out, /Pi · tienda · sesión abierta/); // destino visible en pantalla
  term.type('\r');
  await sleep(150);
  assert.equal(received.length, 1);
  assert.equal(received[0].text, 'Agrega paginación al listado');
  assert.equal(received[0].session, 'pi-9');

  term.type('q');
  await done;
  agent.close();
  await server.close();
});
