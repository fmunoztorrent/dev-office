import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../public/sim.js';
import { Screen, clean, fit, strWidth } from '../tui/screen.js';
import { computeLayout, drawFrame } from '../tui/view.js';

const model = () => ({ selected: null, chat: null, status: null, log: [], session: null, connection: { ok: true, label: 'en vivo' }, endpoints: ['http://127.0.0.1:4317'] });
const rowsText = (scr) => Array.from({ length: scr.rows }, (_, r) => scr.tch.slice(r * scr.cols, (r + 1) * scr.cols).map((c) => c ?? ' ').join(''));

test('el texto externo no puede inyectar secuencias de escape en la terminal', () => {
  assert.equal(clean('hola\x1b[2J\x1b]0;pwned\x07 mundo'), 'hola[2J]0;pwned mundo');
  assert.equal(strWidth('🐞 bug'), 6);
  assert.equal(fit('Valentina', 5), 'Vale…');
});

test('dibuja la oficina completa sin errores en varios tamaños', () => {
  for (const [cols, rows] of [[200, 60], [160, 46], [120, 36], [80, 24], [50, 15]]) {
    const sim = createSim();
    const scr = new Screen();
    scr.resize(cols, rows);
    drawFrame(scr, computeLayout(cols, rows), sim, model(), performance.now());
    const out = scr.flush();
    assert.ok(out.length > 0);
    const text = rowsText(scr).join('\n');
    assert.ok(cols < 60 ? text.includes('Agranda la terminal') : text.includes('DEV TEAM OFFICE'), `${cols}x${rows}`);
  }
});

test('dos burbujas juntas no se pisan', () => {
  const sim = createSim();
  const { po, analyst } = sim.agents;
  Object.assign(po, { seated: false, x: 520, y: 148 });
  Object.assign(analyst, { seated: false, x: 470, y: 148 });
  po.say('Nueva tarea: login con Google');
  analyst.say('Analizo el negocio');
  const scr = new Screen();
  scr.resize(160, 46);
  drawFrame(scr, computeLayout(160, 46), sim, model(), performance.now());
  const text = rowsText(scr).join('\n');
  assert.ok(text.includes('Analizo el negocio'));
  assert.ok(text.includes('Nueva tarea:'));
});

test('flush sólo reescribe lo que cambió', () => {
  const sim = createSim();
  const scr = new Screen();
  scr.resize(120, 36);
  const L = computeLayout(120, 36);
  const m = model();
  const now = performance.now();
  drawFrame(scr, L, sim, m, now);
  const first = scr.flush().length;
  drawFrame(scr, L, sim, m, now);
  assert.ok(scr.flush().length < first / 20);
});
