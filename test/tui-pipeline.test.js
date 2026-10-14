import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';
import { computeLayout } from '../tui/view.js';
import { BOARD } from '../public/sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};

test('desde la terminal: clic en la pizarra → elegir pipeline → la oficina lo corre', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-tui-'));
  fs.cpSync(path.join(here, '..', 'examples', 'tienda'), dir, { recursive: true });
  const teamFile = path.join(dir, '.devteam', 'team.json');
  fs.writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(teamFile, 'utf8')), harnessOptions: { pi: { bin: path.join(here, 'fixtures', 'fake-pi.mjs') } } }));
  // un pipeline corto sin gates externos
  fs.writeFileSync(path.join(dir, '.devteam', 'pipelines', 'a-corto.json'), JSON.stringify({
    name: 'Corto', stages: [{ id: 'plan', role: 'tl', phase: 'arquitectura' }, { id: 'api', role: 'backend', needs: ['plan'] }],
  }));

  const server = await startServer({ port: 0, socket: null, config: {}, projects: [dir] });
  const cols = 160, rows = 46;
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: cols, rows, out: '', write(s) { this.out += s; return true; } });
  const type = (s) => stdin.emit('data', s);
  const done = runTui({ feed: localFeed(server), stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(120);
    const L = computeLayout(cols, rows);
    const col = L.ox + Math.round((BOARD.x + BOARD.w / 2) * L.s) + 1;
    const row = Math.floor((L.oy + Math.round((BOARD.y + BOARD.h / 2) * L.s)) / 2) + 1;
    type(`\x1b[<0;${col};${row}M`); // clic en la pizarra
    await until(() => stdout.out.includes('Nuevo encargo') && stdout.out.includes('Tienda (ejemplo)'));
    type('\x1b[A'); // ↑ a «Para» (con tarea directa los campos son Proyecto, Pipeline, Para, Tarea)
    type('\x1b[A'); // ↑ a «Pipeline»
    type('\x1b[C'); // ▸ primer pipeline: "Corto"
    await sleep(80);
    type('Endpoint de cupones');
    await sleep(120);
    assert.match(stdout.out, /Etapas \(una por agente\)/);
    assert.match(stdout.out, /Diego · Implementa — api/);
    type('\r');
    const run = await until(() => server.pipelines.snapshot().runs.find((r) => r.status === 'done'));
    assert.equal(run.pipeline.name, 'Corto');
    assert.equal(run.task, 'Endpoint de cupones');
    assert.deepEqual(run.stages.map((s) => s.status), ['done', 'done']);
    await sleep(120);
    assert.match(stdout.out, /PIPELINES/); // el panel muestra el pipeline
  } finally {
    type('\x1b'); // cierra el diálogo si quedó abierto
    type('q');
    await done;
    await server.close();
  }
});
