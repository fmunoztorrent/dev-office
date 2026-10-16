// El selector de oficina en la terminal: arriba a la izquierda, sólo si hay más de una; la tecla o
// (o un clic) pasa a la siguiente, y la elegida queda guardada.
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

test('desde la terminal: el selector de oficina aparece con dos oficinas y o cambia de oficina', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: 160, rows: 46, out: '', write(s) { this.out += s; return true; } });
  const feed = localFeed(server);
  const done = runTui({ feed, stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(150);
    assert.ok(!stdout.out.includes('🏢'), 'con una sola oficina no hay nada que elegir');
    server.store.createOffice({ name: 'Pagos', timezone: 'Asia/Tokyo' });
    server.company.load();
    server.bus.emit('offices', server.company.list());
    await until(() => stdout.out.includes('🏢 Oficina principal ▾'));
    stdin.emit('data', 'o');
    await until(() => stdout.out.includes('Pagos ▾')); // la pantalla sólo reescribe lo que cambió
    assert.equal(feed.view, 'pagos');
    assert.equal(server.store.getPrefs().view.office, 'pagos', 'queda guardada');
    // lo que pasa en la otra oficina no se ve aquí
    stdout.out = '';
    server.company.ingest('generic', { session: 'm1', kind: 'task', text: 'Landing de la principal' });
    server.company.ingest('generic', { session: 'p1', office: 'pagos', kind: 'task', text: 'Cobros con QR' });
    await until(() => stdout.out.includes('Cobros con QR'));
    assert.ok(!stdout.out.includes('Landing de la principal'));
    // un clic en el selector (arriba a la izquierda) vuelve a la principal
    stdin.emit('data', '\x1b[<0;3;1M');
    await until(() => feed.view === 'main');
  } finally {
    stdin.emit('data', 'q');
    await done;
    feed.close();
    await server.close();
  }
});
