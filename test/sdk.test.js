// The renderer SDK (public/sdk/index.js): the interfaces between the game (what moves and what is clicked)
// and whatever draws it. A renderer registers itself, gets a host and each frame's scene, and answers what
// is at a point of its canvas; the game turns that into an action. The game's own canvas and the reference
// plan go through the same interfaces, and pass the same conformance kit (public/sdk/conformance.js).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSim, TEAM } from '../public/sim.js';
import { buildScene } from '../public/scene.js';
import {
  SDK_VERSION, WORLD, defineRenderer, registerRenderer, unregisterRenderer, getRenderer, listRenderers, createHost, createRenderer,
  isTarget, actionOf, pickAt, pickByProjection, pickWith, boxOnScreen, propOf, INTERACTIVE, PERSON,
} from '../public/sdk/index.js';
import * as sdk from '../public/sdk/index.js';
import { checkRenderer, fakeCanvas, sampleScenes } from '../public/sdk/conformance.js';
import { createGame } from '../public/game.js';
import '../public/renderers/plan.js';

/** An office with its own clock and people in it. */
function office() {
  let t = 0;
  const sim = createSim({ clock: () => t, random: () => 0.42, wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  for (let i = 0; i < 200; i++) { t += 50; sim.step(0.05, t); }
  return { sim, scene: (extra) => buildScene(sim, { now: t, ...extra }) };
}

/** The fields of an interface in index.d.ts (its first-level ones). */
function declared(name) {
  const dts = fs.readFileSync(new URL('../public/sdk/index.d.ts', import.meta.url), 'utf8');
  const start = dts.indexOf(`export interface ${name} {`);
  assert.ok(start >= 0, name);
  let depth = 0, body = '';
  for (let i = dts.indexOf('{', start); i < dts.length; i++) {
    const c = dts[i];
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth === 1 && c !== '{') body += c;
    if (depth === 1 && c === '\n') body += '\n';
    if (depth === 0) break;
  }
  return [...body.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').matchAll(/(?:^|[;\n])\s*(\w+)\??:/g)].map((m) => m[1]).sort();
}

test('las interfaces del SDK (index.d.ts) dicen exactamente lo que trae cada escena y cada persona', () => {
  const { scene } = office();
  const s = scene({ hovered: { prop: 'whiteboard' } });
  assert.deepEqual(declared('Scene'), Object.keys(s).sort(), 'Scene');
  for (const a of [...Object.values(s.team), ...s.visitors]) assert.deepEqual(declared('Actor'), Object.keys(a).sort(), `Actor ${a.id}`);
  assert.deepEqual(declared('World'), Object.keys(WORLD).sort(), 'World');
  // and every function and constant it declares is exported (and the other way around)
  const dts = fs.readFileSync(new URL('../public/sdk/index.d.ts', import.meta.url), 'utf8');
  const names = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, Object.keys(sdk).sort());
});

test('un renderer se define con su id, su create y sus vistas; el SDK dice qué está mal', () => {
  assert.throws(() => defineRenderer({ id: 'Con Espacios', create() {} }), /id/);
  assert.throws(() => defineRenderer({ id: 'sin-create' }), /create\(host\)/);
  assert.throws(() => defineRenderer({ id: 'futuro', sdk: SDK_VERSION + 1, create() {} }), /SDK/);
  assert.throws(() => defineRenderer({ id: 'vistas', views: [], create() {} }), /views/);
  const def = defineRenderer({ id: 'tres-d', label: '3D', views: ['orbit', 'top'], create: () => ({ draw() {} }) });
  assert.deepEqual([def.id, def.label, def.sdk, def.views, def.builtIn], ['tres-d', '3D', 1, ['orbit', 'top'], false]);
  assert.ok(Object.isFrozen(def));
  // create(host) must give something that draws
  assert.throws(() => createRenderer(defineRenderer({ id: 'nada', create: () => ({}) }), createHost(fakeCanvas())), /draw/);
  // the host: its canvas, its size, the view (one of the renderer's) and the theme, and the world
  let got = null;
  const r = createRenderer(def, createHost(fakeCanvas(800, 500), { width: 400, height: 250, pixelRatio: 2, view: 'flat', theme: 'anime' }));
  createRenderer(defineRenderer({ id: 'mira', views: ['uno', 'dos'], create: (host) => { got = host; return { draw() {} }; } }), createHost(fakeCanvas(), { view: 'dos' }));
  assert.ok(r.draw);
  assert.equal(got.view, 'dos');
  assert.equal(got.sdk, SDK_VERSION);
  assert.equal(got.world, WORLD);
  // the game's own canvas is one more renderer, with its two views
  assert.deepEqual(listRenderers().find((x) => x.id === 'canvas'), { id: 'canvas', label: 'Pixel art', views: ['flat', 'iso'], builtIn: true });
  assert.ok(getRenderer('plan'));
});

test('lo que se apunta es una persona o un mueble del mundo, y el juego sabe qué hacer con cada uno', () => {
  const { scene } = office();
  const s = scene();
  assert.ok(isTarget({ person: 'backend' }, s));
  assert.ok(isTarget({ prop: 'whiteboard' }));
  assert.ok(!isTarget({ person: 'nadie' }, s));
  assert.ok(!isTarget({ what: 'board' }));
  assert.ok(!isTarget({ prop: 'la-luna' }));
  assert.deepEqual(actionOf({ person: 'qa' }), { type: 'select', person: 'qa' });
  assert.deepEqual(actionOf({ prop: 'desk:backend' }), { type: 'select', person: 'backend' }, 'un escritorio es de su dueño');
  assert.deepEqual(actionOf({ prop: 'whiteboard' }), { type: 'board' });
  assert.deepEqual(actionOf({ prop: 'rack' }), { type: 'services' });
  assert.deepEqual(actionOf({ prop: 'elevator' }), { type: 'lift' });
  assert.deepEqual(actionOf({ prop: 'rug' }), { type: 'rug' });
  assert.deepEqual(actionOf({ prop: 'meeting-table' }), { type: 'rug' });
  assert.equal(actionOf({ prop: 'sofa' }), null, 'el sofá es sólo un mueble');
  assert.equal(actionOf(null), null);
  // every interactive prop says what it does, and a desk for each character
  for (const p of INTERACTIVE) assert.ok(['select', 'board', 'services', 'lift', 'rug'].includes(p.action), p.id);
  for (const role of Object.keys(TEAM)) assert.equal(propOf(`desk:${role}`).owner, role);
  // the whiteboard's writable part, in the world (for a 3D renderer, and for where the expanded board comes from)
  const wb = propOf('whiteboard').surface;
  assert.ok(wb.x1 > wb.x0 && wb.z1 > wb.z0 && wb.z0 > 0);
});

test('el SDK encuentra qué hay en un punto del piso, o de la pantalla con la proyección del renderer', () => {
  const { scene } = office();
  const s = scene();
  const someone = Object.values(s.team).find((a) => !a.seated && a.pose !== 'hidden') || Object.values(s.team)[0];
  const foot = someone.seated ? someone.cfg.seat : someone;
  assert.deepEqual(pickAt(s, foot.x + 3, foot.y - 2), { person: someone.id });
  const empty = { ...s, team: {}, visitors: [] };
  const wb = propOf('whiteboard');
  assert.deepEqual(pickAt(empty, wb.x, wb.y), { prop: 'whiteboard' });
  const table = propOf('meeting-table');
  assert.deepEqual(pickAt(empty, table.x, table.y), { prop: 'meeting-table' }, 'el más chico que lo cubre: la mesa, no la alfombra');
  assert.deepEqual(pickAt(empty, table.x + 120, table.y + 60), { prop: 'rug' });
  assert.equal(pickAt(empty, -900, -900), null);
  // a camera from above, by fractions of a 1500 × 700 canvas: the projection finds the same
  const top = (x, y, z = 0) => ({ x: (x + 300) / 1500, y: (y - z * 0.5) / 700 });
  const at = top(wb.x, wb.y, wb.h / 2);
  assert.deepEqual(pickByProjection(empty, top, at.x, at.y), { prop: 'whiteboard' });
  const head = top(foot.x, foot.y, PERSON.height * 0.7);
  assert.equal(pickByProjection(s, top, head.x, head.y)?.person, someone.id);
  // where a box lands on the screen
  const b = boxOnScreen(top, { x0: 0, x1: 150, y0: 70, y1: 140, z0: 0, z1: 0 });
  assert.deepEqual(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toFixed(6)])), { x: 0.2, y: 0.1, w: 0.1, h: 0.1 });
  assert.equal(boxOnScreen(() => null, wb), null, 'detrás de la cámara');
  // pickWith asks the renderer the best way it can answer, and never gives back something invalid
  assert.deepEqual(pickWith({ draw() {}, pick: () => ({ prop: 'rack' }) }, s, 0.5, 0.5), { prop: 'rack' });
  assert.equal(pickWith({ draw() {}, pick: () => ({ what: 'board' }) }, s, 0.5, 0.5), null);
  assert.deepEqual(pickWith({ draw() {}, project: top }, empty, at.x, at.y), { prop: 'whiteboard' });
  assert.deepEqual(pickWith({ draw() {}, toWorld: () => ({ x: wb.x, y: wb.y }) }, empty, 0, 0), { prop: 'whiteboard' });
  assert.equal(pickWith({ draw() {} }, s, 0.5, 0.5), null, 'un renderer que no dice nada: nada');
});

test('el kit de conformidad: el canvas del juego (sus dos vistas) y el plano pasan; uno que rompe el contrato, no', () => {
  const scenes = sampleScenes();
  assert.equal(scenes.length, 3);
  for (const id of ['canvas', 'plan']) {
    const { ok, problems, passed } = checkRenderer(getRenderer(id), { scenes });
    assert.deepEqual(problems, [], id);
    assert.ok(ok && passed.length >= 9, id);
  }
  assert.ok(checkRenderer(getRenderer('canvas'), { scenes }).passed.some((p) => p.startsWith('[iso]')), 'las dos vistas');
  const bad = checkRenderer({
    id: 'roto',
    create: () => ({
      draw(scene) { scene.team.po.x = 0; },                   // it changes the scene
      pick: () => ({ what: 'board' }),                         // not a target
      project: (x, y, z) => ({ x: x / 1500 + 3, y: (y - z) / 700 }), // off the canvas
    }),
  }, { scenes });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /changes the scene/);
  assert.match(bad.problems.join('\n'), /\{"what":"board"\}/);
  assert.match(bad.problems.join('\n'), /nothing of the world lands on the canvas/);
  assert.match(checkRenderer({ id: 'X' }).problems[0], /^spec: /);
});

test('scripts/check-renderer.mjs revisa los renderers del juego, o los que registra un módulo', () => {
  const out = execFileSync(process.execPath, ['scripts/check-renderer.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(out, /✓ canvas/);
  assert.match(out, /✓ plan/);
});

test('el juego dibuja con el renderer que se le pide y le pregunta qué hay bajo el puntero (y lo vuelve una acción)', () => {
  // a browser, just enough: frames by hand, a canvas with its events, and document for the renderer's own canvas
  const frames = [], layers = [];
  const saved = { raf: globalThis.requestAnimationFrame, document: globalThis.document };
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.document = { createElement: () => { const c = fakeCanvas(); c.dataset = {}; c.remove = () => { c.removed = true; }; layers.push(c); return c; } };
  try {
    const canvas = fakeCanvas(1216, 760);
    const handlers = {};
    canvas.addEventListener = (type, fn) => { handlers[type] = fn; };
    canvas.after = () => {};
    const drawn = [], asked = [];
    let disposed = 0, theme = null;
    registerRenderer({
      id: 'prueba',
      views: ['flat', 'orbit'],
      create(host) {
        assert.equal(host.canvas, layers[0], 'su propio canvas, sobre el del juego');
        assert.equal(host.view, 'flat');
        return {
          draw: (scene) => drawn.push(scene),
          // the left half of the screen is the whiteboard; the right half, the backend
          pick: (fx, fy) => { asked.push([fx, fy]); return fx < 0.5 ? { prop: 'whiteboard' } : { person: 'backend' }; },
          setTheme: (id) => { theme = id; },
          dispose: () => { disposed++; },
        };
      },
    });
    const calls = [];
    const game = createGame(canvas, {
      renderer: 'prueba',
      now: () => new Date(2026, 9, 16, 10),
      onBoardClick: () => calls.push('board'),
      onSelect: (id) => calls.push(`select:${id}`),
      onHover: (id) => calls.push(`hover:${id}`),
    });
    assert.equal(game.renderer, 'prueba');
    const tick = (n = 1) => { for (let i = 0; i < n; i++) frames.shift()?.(16 * (i + 1)); };
    tick(3);
    assert.ok(drawn.length >= 2, 'cada cuadro, la escena');
    assert.equal(drawn.at(-1).v, 1);
    handlers.mousemove({ clientX: 100, clientY: 300 });
    tick();
    assert.deepEqual(drawn.at(-1).hovered, { prop: 'whiteboard' }, 'lo que está bajo el puntero va en la escena');
    handlers.click({ clientX: 100, clientY: 300 });
    handlers.click({ clientX: 1000, clientY: 300 });
    assert.deepEqual(asked.at(-1), [1000 / 1216, 300 / 760], 'en fracciones del canvas');
    assert.deepEqual(calls.filter((c) => !c.startsWith('hover')), ['board', 'select:backend']);
    tick();
    assert.equal(drawn.at(-1).selected, 'backend');
    game.setTheme('anime');
    assert.equal(theme, 'anime');
    // back to the canvas's own: the other one is disposed and its canvas removed
    game.setRenderer(null);
    assert.equal(game.renderer, 'canvas');
    assert.equal(disposed, 1);
    assert.ok(layers[0].removed);
    // a renderer that fails is dropped: the game goes back to its own canvas
    registerRenderer({ id: 'falla', create: () => ({ draw() { throw new Error('boom'); } }) });
    const error = console.error;
    console.error = () => {};
    try {
      game.setRenderer('falla');
      tick(2);
    } finally { console.error = error; }
    assert.equal(game.renderer, 'canvas');
    assert.equal(game.setRenderer('no-existe'), false);
  } finally {
    globalThis.requestAnimationFrame = saved.raf;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    unregisterRenderer('prueba');
    unregisterRenderer('falla');
  }
});
