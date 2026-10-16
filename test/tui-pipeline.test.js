import './es.js';
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
import { startFakeAgent } from './fixtures/fake-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};

test('desde la terminal: clic en la pizarra → elegir el pipeline del agente → lo ejecuta su sesión de Pi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-tui-'));
  fs.cpSync(path.join(here, '..', 'examples', 'tienda'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.devteam', 'pipelines', 'a-corto.json'), JSON.stringify({
    name: 'Corto', stages: [{ id: 'plan', role: 'tl', phase: 'arquitectura' }, { id: 'api', role: 'backend', needs: ['plan'] }],
  }));

  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const agent = startFakeAgent({ url: server.url, dir, session: 'pi-tui' }); // como la extensión de Pi
  await agent.ready;
  await until(() => server.pipelines.projects().length);
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
    await until(() => stdout.out.includes('Nuevo encargo') && stdout.out.includes('● abierta'));
    // campos: Agente, Pipeline, Sesión, Prompt (el foco empieza en el prompt)
    type('\x1b[A'); // ↑ a «Sesión»
    type('\x1b[A'); // ↑ a «Pipeline»
    const target = server.registry.targets().find((t) => t.sessions.some((x) => x.session === 'pi-tui'));
    const steps = target.entries.findIndex((e) => e.id === 'devteam:a-corto');
    for (let i = 0; i < steps; i++) type('\x1b[C'); // ▸ hasta el pipeline "Corto"
    await sleep(80);
    type('Endpoint de cupones');
    await sleep(120);
    assert.match(stdout.out, /Pipeline · Corto/);
    assert.match(stdout.out, /Etapas \(las corre la sesión del agente\)/);
    assert.match(stdout.out, /Diego · Implementa — api/);
    assert.match(stdout.out, /Pi · sesión abierta/); // va a la sesión abierta en esa ruta
    type('\r');
    const run = await until(() => server.pipelines.snapshot().runs.find((r) => r.status === 'done'));
    assert.equal(run.pipeline.name, 'Corto');
    assert.equal(run.task, 'Endpoint de cupones');
    assert.equal(run.session, 'pi-tui');
    assert.deepEqual(run.stages.map((s) => s.status), ['done', 'done']);
    assert.deepEqual(agent.received.filter((m) => m.type === 'stage').map((m) => m.id), ['plan', 'api']);
    await sleep(120);
    assert.match(stdout.out, /PIPELINES/); // el panel muestra el pipeline
  } finally {
    type('\x1b'); // cierra el diálogo si quedó abierto
    type('q');
    await done;
    await agent.close();
    await server.close();
  }
});
