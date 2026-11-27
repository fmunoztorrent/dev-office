// The scene (public/scene.js): the layer between what the game decides (public/sim.js) and what a graphics
// engine draws. Each frame is plain data (it could be sent or saved); the canvas (front and isometric), the
// terminal and the reference plan draw only from it, and another renderer (a 3D one) can register itself
// with the renderer SDK (public/sdk/index.js, test/sdk.test.js) and draw the same scene.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSim, setExperts, TEAM, HOT_DESKS } from '../public/sim.js';
import { buildScene, peopleOf, personIn, WORLD, SCENE_VERSION } from '../public/scene.js';
import { registerRenderer, getRenderer, listRenderers, unregisterRenderer } from '../public/sdk/index.js';
import { drawPlan } from '../public/renderers/plan.js';
import { Screen } from '../tui/screen.js';
import { computeLayout, drawFrame } from '../tui/view.js';

/** An office with its own clock, already with people coming and going. */
function office() {
  let t = 0, seed = 11;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const sim = createSim({ clock: () => t, random, wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  const run = (s) => { for (let i = 0; i < s * 20; i++) { t += 50; sim.step(0.05, t); } };
  setExperts([{ id: 'x1', skill: 'pci-dss', topic: 'Pagos y PCI', look: { name: 'Ana', shirt: '#118ab2' } }]);
  sim.handle({ kind: 'task', role: 'po', session: 's1', text: 'Cobrar con tarjeta' });
  sim.handle({ kind: 'tool_start', role: 'sme', expert: { id: 'x1', name: 'Ana', skill: 'pci-dss' }, session: 's1', tool: 'Skill', badge: '🎓 pci-dss' });
  sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'Construyendo la imagen' });
  for (const role of ['qa']) sim.handle({ kind: 'tool_start', role, session: 'main', tool: 'Edit', text: 'En lo suyo' }); // the role's own character is busy: a newcomer comes
  sim.handle({ kind: 'subagent_start', role: 'qa', session: 's1', subId: 'sub-1', text: 'Escribir los tests' });
  sim.handle({ kind: 'tool_start', role: 'backend', session: 's1', tool: 'Edit', text: 'Editando pay.js', badge: '✏️ pay.js' });
  run(20);
  return { sim, run, now: () => t };
}

/** Every value in it is plain data: objects and arrays of their own (no class instances, no functions). */
function assertPlain(v, at = 'scene', seen = new Set()) {
  if (v === null || typeof v !== 'object') { assert.notEqual(typeof v, 'function', at); return; }
  if (seen.has(v)) return;
  seen.add(v);
  if (at === 'scene.date') return; // the office's date (Date-like, in its zone)
  const proto = Object.getPrototypeOf(v);
  assert.ok(proto === Object.prototype || proto === Array.prototype || proto === null, `${at} es un objeto de la simulación`);
  for (const [k, x] of Object.entries(v)) assertPlain(x, `${at}.${k}`, seen);
}

test('la escena de un cuadro: datos planos con todo lo que se dibuja (la gente, el mundo, el ambiente y lo que cambia)', () => {
  const { sim, now } = office();
  const scene = buildScene(sim, { now: now(), selected: 'backend', services: [{ id: 'web', status: 'running', name: 'vite' }] });
  assertPlain({ ...scene, date: null });
  assert.equal(scene.v, SCENE_VERSION);
  assert.deepEqual(Object.keys(scene.team).sort(), Object.keys(TEAM).sort(), 'el equipo, por rol');
  assert.deepEqual(scene.visitors.map((v) => v.kind).sort(), ['expert', 'newcomer', 'visitor']);
  const ana = scene.visitors.find((v) => v.kind === 'expert');
  assert.equal(ana.cfg.name, 'Ana');
  assert.equal(ana.cfg.shirt, '#118ab2');
  assert.equal(ana.expert, 'x1');
  assert.equal(ana.badge, '🎓 pci-dss');
  assert.ok(['sit', 'walk', 'stand'].includes(ana.pose));
  assert.equal(scene.team.backend.badge, '✏️ pay.js');
  assert.equal(scene.board.title, 'Cobrar con tarjeta');
  assert.equal(scene.selected, 'backend');
  assert.deepEqual(scene.services, [{ id: 'web', status: 'running', name: 'vite' }]);
  assert.ok(scene.light && typeof scene.light.night === 'number', 'la luz del momento');
  assert.equal(personIn(scene, 'backend'), scene.team.backend);
  assert.equal(peopleOf(scene).length, 8 + 3);
  // a copy: changing the scene does not touch the simulation
  scene.team.backend.x = -999;
  assert.notEqual(sim.agents.backend.x, -999);
  // and it travels: JSON there and back
  const back = JSON.parse(JSON.stringify(scene));
  assert.equal(back.visitors.length, 3);
});

test('el mundo que no se mueve: salas, puertas, la pared de vidrio, los muebles (un escritorio por personaje) y los lugares', () => {
  assert.deepEqual(WORLD.rooms.map((r) => r.id), ['office', 'cafe', 'dining', 'hall', 'bathroom']);
  assert.ok(WORLD.doors.some((d) => d.id === 'elevator'));
  for (const role of Object.keys(TEAM)) assert.ok(WORLD.props.some((p) => p.kind === 'desk' && p.owner === role), role);
  assert.equal(WORLD.props.filter((p) => p.kind === 'hotdesk').length, HOT_DESKS.length);
  for (const p of WORLD.props) for (const k of ['x', 'y', 'w', 'd', 'h']) assert.ok(Number.isFinite(p[k]), `${p.id}.${k}`);
  assert.ok(WORLD.units.perMeter > 0);
  assert.ok(WORLD.spots.elevator && WORLD.spots.board);
  assert.ok(Object.isFrozen(WORLD));
});

test('los renderers se registran; el plano de referencia dibuja la oficina sólo con la escena', () => {
  assert.throws(() => registerRenderer({ id: 'X y' }), /id/);
  assert.throws(() => registerRenderer({ id: 'sin-create' }), /create/);
  const seen = [];
  registerRenderer({ id: 'prueba-3d', label: '3D', create: () => ({ draw: (scene) => seen.push(scene.v) }) });
  getRenderer('prueba-3d').create({}).draw({ v: 1 });
  assert.deepEqual(seen, [1]);
  unregisterRenderer('prueba-3d');
  assert.ok(listRenderers().some((r) => r.id === 'plan'));
  const { sim, now } = office();
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k in ctx ? undefined : (...a) => calls.push([k, ...a])), set: () => true });
  const out = drawPlan(ctx, buildScene(sim, { now: now() }), 1216, 760);
  assert.equal(out.rooms, WORLD.rooms.length);
  assert.ok(out.people.includes('backend'));
  assert.ok(out.people.some((id) => id.startsWith('new:visit:s1:sme:x1')), 'la experta, también');
  assert.ok(calls.some(([k, text]) => k === 'fillText' && text === 'Cobrar con tarjeta'), 'la tarea de la pizarra');
});

test('la terminal es otro renderer de la misma escena', () => {
  const { sim, now } = office();
  const scr = new Screen();
  scr.resize(220, 60);
  const scene = buildScene(sim, { now: now() });
  drawFrame(scr, computeLayout(220, 60), scene, { selected: null, chat: null, status: null, log: [], session: null, connection: { ok: true, label: 'en vivo' }, endpoints: [] }, now());
  const text = Array.from({ length: scr.rows }, (_, r) => scr.tch.slice(r * scr.cols, (r + 1) * scr.cols).map((c) => c ?? ' ').join('')).join('\n');
  assert.match(text, / Ana /, 'la experta en su escritorio');
});

test('los renderers no leen la simulación: el canvas y la terminal dibujan sólo desde la escena', () => {
  const game = fs.readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
  // (without the comments: they may name the simulation)
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  // the canvas's renderer: from createCanvasRenderer to its registration with the SDK
  const drawing = code(game.slice(game.indexOf('export function createCanvasRenderer'), game.indexOf("registerRenderer({ id: 'canvas'")));
  assert.ok(drawing.length > 50000, 'el renderer del canvas está entero');
  assert.deepEqual([...drawing.matchAll(/\bsim\.(\w+)/g)].map((m) => m[1]).filter((k) => k !== 'js'), [], 'el canvas no toca la simulación');
  assert.doesNotMatch(drawing, /\bagents\b|\bcreateSim\b|\bbuildScene\b/);
  const view = code(fs.readFileSync(new URL('../tui/view.js', import.meta.url), 'utf8'));
  assert.deepEqual([...view.matchAll(/\bsim\.(\w+)/g)].map((m) => m[1]).filter((k) => k !== 'js'), []);
});
