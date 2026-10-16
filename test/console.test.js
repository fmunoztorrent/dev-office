// La consola: al lanzar la oficina desde la terminal se ve la bitácora con la actividad de los
// agentes; g abre el juego en esa misma terminal (q vuelve), o lo abre en el navegador, q sale.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/server.js';
import { createLog, runConsole } from '../tui/console.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout');
};
const tty = () => {
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, raw: false, setRawMode(v) { this.raw = v; }, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { isTTY: true, columns: 120, rows: 36, out: '', write(s) { this.out += s; return true; } });
  return { stdin, stdout };
};
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

test('la bitácora: la actividad de los agentes, con la oficina si hay varias, y sin colores en un log', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  let out = '';
  const log = createLog({ server, write: (s) => { out += s; }, color: false });
  try {
    server.company.ingest('generic', { session: 's1', kind: 'phase', role: 'tl', phase: 'arquitectura', text: 'Estado CANCELLED' });
    server.company.ingest('generic', { session: 's1', kind: 'tool_start', role: 'backend', tool: 'Edit', input: { file_path: 'src/api.js' } });
    server.company.ingest('generic', { session: 's1', kind: 'tool_end', role: 'backend', tool: 'Edit', input: { file_path: 'src/api.js' }, ok: true });
    server.company.ingest('generic', { session: 's1', kind: 'tool_end', role: 'qa', tool: 'Bash', input: { command: 'npm test' }, ok: false });
    assert.match(out, /Tomás {2}🏛\uFE0F? Arquitectura: Estado CANCELLED/u);
    assert.match(out, /Diego {2}Editando api\.js/);
    assert.match(out, /Andrés {2}✖ Falló: \$ npm test/);
    assert.ok(!/\x1b\[/.test(out), 'sin colores');
    assert.equal(out.split('\n').filter(Boolean).length, 3, 'un tool_end que salió bien no ensucia la bitácora');
    // con dos oficinas, cada línea dice de cuál es
    await fetch(`${server.url}/v1/offices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Pagos' }) });
    out = '';
    server.company.ingest('generic', { session: 'p1', office: 'pagos', kind: 'task', text: 'Cobros con QR' });
    assert.match(out, /🏢 Pagos {2}Sofía {2}📝 Cobros con QR/);
    // las tareas: cuando cambia su estado
    out = '';
    server.hub.submit({ text: 'algo', agent: 'claude-code', session: 'c1', office: 'pagos' });
    assert.match(out, /Claude {2}📨 algo → en cola/);
  } finally {
    log.close();
    await server.close();
  }
});

test('la consola: g abre el juego en la misma terminal, q vuelve a la bitácora y q cierra la oficina', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const { stdin, stdout } = tty();
  let games = 0;
  const onGame = async () => {
    games++;
    const feed = localFeed(server);
    try { await runTui({ feed, stdin, stdout, colorMode: 'truecolor', quitKey: 'log' }); } finally { feed.close(); }
  };
  const done = runConsole({ server, stdin, stdout, onGame, notes: ['nota de arranque'], version: '0.4.0' });
  try {
    await until(() => plain(stdout.out).includes('DEV TEAM OFFICE'));
    const banner = plain(stdout.out);
    assert.match(banner, new RegExp(`Web +${server.url.replace(/[.:/]/g, '\\$&')}`));
    assert.match(banner, /g juego · o navegador · h ayuda · q salir/);
    assert.match(banner, /fuera de herdr/);
    assert.match(banner, /nota de arranque/);
    assert.equal(stdin.raw, true);

    stdin.emit('data', 'g');
    await until(() => stdout.out.includes('\x1b[?1049h')); // pantalla alternativa: el juego
    assert.equal(games, 1);
    // mientras se juega, la bitácora espera
    const before = stdout.out.length;
    server.company.ingest('generic', { session: 's1', kind: 'task', text: 'Durante el juego' });
    await sleep(80);
    assert.ok(!stdout.out.slice(before).includes('Durante el juego') || stdout.out.slice(before).includes('\x1b['), 'la línea no se escribe encima del juego');
    assert.match(plain(stdout.out), /q bitácora/, 'en el juego, q vuelve a la bitácora');
    stdin.emit('data', 'q');
    await until(() => plain(stdout.out).includes('de vuelta en la bitácora'));
    assert.match(plain(stdout.out.slice(stdout.out.lastIndexOf('de vuelta'))), /📝 Durante el juego/, 'y después aparece lo que pasó');

    stdin.emit('data', 'q');
    await done;
    assert.match(plain(stdout.out), /Cerrando la oficina/);
    assert.equal(stdin.raw, false);
  } finally {
    await server.close();
  }
});
