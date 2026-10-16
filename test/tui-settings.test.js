import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';
import { computeLayout } from '../tui/view.js';
import { TEAM, applyAppearance } from '../public/sim.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};

test('desde la terminal: ⚙ → Personajes → renombrar a Tomás → ctrl+s guarda y se aplica', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cols = 160, rows = 46;
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: cols, rows, out: '', write(s) { this.out += s; return true; } });
  const type = (s) => stdin.emit('data', s);
  const done = runTui({ feed: localFeed(server), stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(150);
    const { gearCell } = computeLayout(cols, rows); // el ⚙ va dentro de la escena, arriba a la derecha
    type(`\x1b[<0;${gearCell.col + 2};${gearCell.row + 1}M`); // clics 1-based, en el centro de « ⚙ »
    await until(() => stdout.out.includes('⚙ Ajustes') && stdout.out.includes('Idioma'));
    type('\x1b[C'); // pestañas: General → Oficinas
    await until(() => stdout.out.includes('Agregar oficina'));
    type('\x1b[C'); // → Agentes
    await until(() => stdout.out.includes('Agentes registrados'));
    type('\x1b[C'); // → Personajes
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
