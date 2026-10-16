import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';
import { TEAM, applyAppearance } from '../public/sim.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};

test('desde la terminal: ⚙ → Personajes → renombrar a Tomás → ctrl+s guarda y se aplica', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:' });
  const cols = 160, rows = 46;
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: cols, rows, out: '', write(s) { this.out += s; return true; } });
  const type = (s) => stdin.emit('data', s);
  const done = runTui({ feed: localFeed(server), stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(150);
    const time = new Date().toLocaleTimeString('es', { hour12: false });
    const gear = cols - time.length - 5 + 1; // columna del ⚙ (0-based) → 1-based en el clic
    type(`\x1b[<0;${gear + 1};1M`);
    await until(() => stdout.out.includes('⚙ Ajustes') && stdout.out.includes('Agentes registrados'));
    type('\x1b[C'); // pestañas: Agentes → Personajes
    await until(() => stdout.out.includes('Pelo largo'));
    type('\x1b[B'); // Personaje (Tomás por defecto)
    type('\x1b[B'); // Nombre
    for (let i = 0; i < 6; i++) type('\x7f');
    type('Tito');
    type('\x13'); // ctrl+s
    await until(() => server.store.getAppearance().tl?.name === 'Tito');
    await until(() => TEAM.tl.name === 'Tito'); // aplicado en vivo a la oficina
  } finally {
    type('\x1b'); // cierra ajustes si quedó abierto
    type('q');
    await done;
    await server.close();
    applyAppearance({});
  }
});
