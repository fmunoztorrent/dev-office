// The renderer SDK's conformance kit: checks that a renderer keeps the contract (public/sdk/index.js), the
// same way for the game's own canvas, the reference plan and any new one. It runs in Node (with a canvas
// that takes any 2D drawing call) or in a browser (with a real canvas, for one that needs WebGL):
//
//   import { checkRenderer } from './public/sdk/conformance.js';
//   const { ok, problems } = checkRenderer(spec);   // spec: what registerRenderer gets
//
// It creates the renderer in each of its views, draws sample scenes (frozen: a renderer only reads them),
// resizes it, changes its theme and view, asks it what is at points of the canvas (a valid target or
// nothing), checks that what it says with project and toWorld agrees with what it picks, and disposes it.
// `node scripts/check-renderer.mjs <module>` runs it on every renderer a module registers.

import { createSim } from '../sim.js';
import { buildScene } from '../scene.js';
import { defineRenderer, createRenderer, createHost, isTarget, pickWith, peopleOf, INSTANCE_METHODS, INTERACTIVE, PERSON, WORLD } from './index.js';

/** A canvas for Node: its 2D context takes any drawing call (and answers the few that return something); no WebGL. */
export function fakeCanvas(width = 1216, height = 760) {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const returns = {
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, createConicGradient: () => gradient,
    createPattern: () => ({ setTransform: noop }),
    measureText: (s) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false, isPointInStroke: () => false, getLineDash: () => [],
  };
  const classes = new Set();
  const classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on) };
  const canvas = { width, height, style: {}, classList, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  const state = {
    canvas, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', imageSmoothingEnabled: true, filter: 'none',
    shadowBlur: 0, shadowColor: 'transparent', shadowOffsetX: 0, shadowOffsetY: 0, lineCap: 'butt', lineJoin: 'miter',
  };
  const ctx = new Proxy(state, {
    get: (t, k) => (k in returns ? returns[k] : k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  canvas.getContext = (kind) => (kind === '2d' ? ctx : null);
  return canvas;
}

/**
 * Sample scenes: an office with work going on (a newcomer, a visiting specialist and an expert), a
 * selected person and the whiteboard under the pointer; the same office at night; and lunchtime.
 */
export function sampleScenes() {
  let t = 0, seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const scenes = [];
  for (const hour of [10, 13, 22]) {
    t = 0;
    const sim = createSim({ clock: () => t, random, wall: () => new Date(2026, 9, 16, hour).getTime() + t });
    const run = (s) => { for (let i = 0; i < s * 20; i++) { t += 50; sim.step(0.05, t); } };
    sim.handle({ kind: 'task', role: 'po', session: 's1', text: 'Pay by card' });
    sim.handle({ kind: 'tool_start', role: 'sme', expert: { id: 'x1', name: 'Ana', skill: 'pci-dss' }, session: 's1', tool: 'Skill', badge: '🎓 pci-dss' });
    sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'Building the image' });
    sim.handle({ kind: 'tool_start', role: 'qa', session: 'main', tool: 'Edit', text: 'On their own' });
    sim.handle({ kind: 'subagent_start', role: 'qa', session: 's1', subId: 'sub-1', text: 'Write the tests' });
    sim.handle({ kind: 'tool_start', role: 'backend', session: 's1', tool: 'Edit', text: 'Editing pay.js', badge: '✏️ pay.js' });
    run(12);
    scenes.push(buildScene(sim, { now: t, selected: 'backend', hover: 'qa', hovered: { prop: 'whiteboard' }, services: [{ id: 'web', status: 'running', name: 'vite' }] }));
  }
  return scenes;
}

const freeze = (v, seen = new Set()) => {
  if (!v || typeof v !== 'object' || seen.has(v) || v instanceof Date) return v;
  seen.add(v);
  for (const x of Object.values(v)) freeze(x, seen);
  return Object.freeze(v);
};

/**
 * Checks a renderer against the contract.
 * @param spec     what registerRenderer gets ({ id, label, views, create })
 * @param options  canvas: () => a canvas for it (a fake 2D one in Node by default); scenes (sampleScenes())
 * @returns { ok, problems: [text], passed: [text] }
 */
export function checkRenderer(spec, { canvas = () => fakeCanvas(), scenes = sampleScenes() } = {}) {
  const problems = [], passed = [];
  const check = (what, fn) => {
    try {
      const out = fn();
      if (out === false) problems.push(what); else passed.push(what);
    } catch (e) { problems.push(`${what}: ${e.message}`); }
  };
  let def;
  try { def = defineRenderer(spec); } catch (e) { return { ok: false, problems: [`spec: ${e.message}`], passed }; }
  passed.push('spec');
  for (const view of def.views) {
    const c = canvas();
    let r = null;
    check(`[${view}] create(host) returns { draw }`, () => { r = createRenderer(def, createHost(c, { width: c.width, height: c.height, pixelRatio: 1, view, theme: 'pixel' })); });
    if (!r) continue;
    check(`[${view}] its optional members are functions`, () => {
      const bad = INSTANCE_METHODS.filter((m) => r[m] !== undefined && typeof r[m] !== 'function');
      if (bad.length) throw new Error(`not functions: ${bad.join(', ')}`);
    });
    check(`[${view}] draws each sample scene without changing it`, () => {
      for (const s of scenes) {
        try { r.draw(freeze(s)); } catch (e) {
          if (e instanceof TypeError && /read.only|frozen|not extensible|Cannot (assign|add|delete)/i.test(e.message)) throw new Error(`it changes the scene (${e.message}): a renderer only reads it`);
          throw e;
        }
      }
    });
    const scene = scenes[0];
    if (r.resize) check(`[${view}] resize(width, height, pixelRatio) and draw again`, () => { r.resize(800, 500, 2); r.draw(scene); r.resize(c.width, c.height, 1); r.draw(scene); });
    if (r.setTheme) check(`[${view}] setTheme('anime') and back`, () => { r.setTheme('anime'); r.draw(scene); r.setTheme('pixel'); r.draw(scene); });
    check(`[${view}] what is at each point: a target of the scene, or nothing`, () => {
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
        const raw = r.pick ? r.pick(i / 12, j / 8) : pickWith(r, scene, i / 12, j / 8);
        if (raw !== null && raw !== undefined && !isTarget(raw, scene)) throw new Error(`pick(${(i / 12).toFixed(2)}, ${(j / 8).toFixed(2)}) → ${JSON.stringify(raw)}`);
      }
    });
    if (r.project) {
      check(`[${view}] project: every prop of the world lands somewhere (or is out of sight: null)`, () => {
        let seen = 0;
        for (const p of WORLD.props) {
          for (const z of [0, p.h]) {
            const a = r.project(p.x, p.y, z);
            if (a === null) continue; // behind the camera
            if (!a || ![a.x, a.y].every(Number.isFinite)) throw new Error(`project(${p.id}, z ${z}) → ${JSON.stringify(a)}`);
            if (a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1) seen++;
          }
        }
        if (!seen) throw new Error('nothing of the world lands on the canvas');
      });
      check(`[${view}] pick finds the people where project puts them`, () => {
        const people = peopleOf(scene).filter((a) => a.pose !== 'hidden' && !a.gone && a.fade > 0.3);
        let found = 0;
        for (const a of people) {
          const f = a.seated && a.cfg.seat ? a.cfg.seat : a;
          const p = r.project(f.x, f.y, PERSON.height * 0.6);
          if (!p) continue;
          const hit = pickWith(r, scene, p.x, p.y);
          if (hit?.person) found++;
        }
        if (found < Math.ceil(people.length / 2)) throw new Error(`only ${found} of ${people.length}`);
      });
      check(`[${view}] pick finds the whiteboard where project puts it`, () => {
        const wb = INTERACTIVE.find((p) => p.id === 'whiteboard'), s = wb.surface;
        const p = r.project((s.x0 + s.x1) / 2, s.y, (s.z0 + s.z1) / 2);
        if (!p) return;
        const quiet = { ...scene, team: {}, visitors: [] }; // nobody in front of it
        const hit = pickWith(r, quiet, p.x, p.y);
        if (hit?.prop !== 'whiteboard') throw new Error(`→ ${JSON.stringify(hit)}`);
      });
    }
    if (r.toWorld && r.project) check(`[${view}] toWorld undoes project on the floor`, () => {
      for (const room of WORLD.rooms) {
        const x = (room.x0 + room.x1) / 2, y = (room.y0 + room.y1) / 2, p = r.project(x, y, 0);
        if (!p) continue;
        const w = r.toWorld(p.x, p.y);
        if (!w || Math.hypot(w.x - x, w.y - y) > 2) throw new Error(`${room.id}: (${x}, ${y}) → ${JSON.stringify(w)}`);
      }
    });
    if (r.setView) check(`[${view}] setView to each of its views`, () => { for (const v of def.views) { r.setView(v); r.draw(scene); } r.setView(view); });
    if (r.dispose) check(`[${view}] dispose()`, () => { r.dispose(); });
  }
  return { ok: problems.length === 0, problems, passed };
}
