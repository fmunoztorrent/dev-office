// The renderer SDK: the one module a graphics engine needs to draw Dev Team Office. The game (public/sim.js:
// who moves where, who does what, what happens in the office) and whatever draws it (the canvas of
// public/game.js, the reference plan, a 3D engine…) only talk through what is here:
//
//   game ──► scene (plain data, public/scene.js) ──► renderer.draw(scene)
//   game ◄── target ({ person } | { prop }) ◄──────── renderer.pick(x, y)   (or project / toWorld)
//
// A renderer is a spec { id, label, views?, create(host) → instance } (defineRenderer checks it). The game
// hands it a host (its canvas, its size, the view and the theme) and, every frame, the scene; it asks the
// renderer what is under the pointer and where a point of the world lands on the canvas, and turns what
// is pointed at into an action with actionOf (select someone, open the whiteboard, the services, the
// elevator, the rug). Nothing else crosses: a renderer never reads the simulation, and the game never
// reads a renderer's internals.
//
// The types are in ./index.d.ts; the contract and a walk-through in docs/rendering.md; a renderer can be
// checked with ./conformance.js (node scripts/check-renderer.mjs <its module>).

import { SCENE_VERSION, WORLD, peopleOf, personIn } from '../scene.js';

export { SCENE_VERSION, WORLD, peopleOf, personIn };

/** The SDK's version: what create(host) gets and what an instance may have. A renderer says which one it was written for (`sdk`). */
export const SDK_VERSION = 1;

/** What an instance can have besides draw (all optional). */
export const INSTANCE_METHODS = ['resize', 'pick', 'project', 'toWorld', 'setView', 'setTheme', 'dispose'];

/** What a person measures, in world units: how tall they are drawn and how far from them the pointer still finds them. */
export const PERSON = Object.freeze({ height: 63, reach: 18 });

// ---------------------------------------------------------------- the registry

const REGISTRY = new Map();
const ID = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * Checks a renderer's spec and returns it, frozen, with its defaults: { id, label, sdk, views, builtIn, create }.
 * Throws with what is wrong (an id, create, the views, an SDK this one does not know).
 */
export function defineRenderer(spec) {
  if (!spec || typeof spec.id !== 'string' || !ID.test(spec.id)) throw new Error('a renderer needs an id (lowercase letters, digits and dashes)');
  if (typeof spec.create !== 'function') throw new Error(`the renderer ${spec.id} needs create(host)`);
  const sdk = spec.sdk ?? SDK_VERSION;
  if (!Number.isInteger(sdk) || sdk < 1 || sdk > SDK_VERSION) throw new Error(`the renderer ${spec.id} was written for SDK ${sdk}; this one is ${SDK_VERSION}`);
  const views = spec.views ?? ['default'];
  if (!Array.isArray(views) || !views.length || views.some((v) => typeof v !== 'string' || !ID.test(v))) throw new Error(`the renderer ${spec.id}: views is a list of ids`);
  return Object.freeze({ ...spec, label: String(spec.label || spec.id), sdk, views: Object.freeze([...views]), builtIn: !!spec.builtIn });
}

/** Registers a renderer (the same id again replaces it). The game draws with it when opened with ?renderer=<id>. */
export function registerRenderer(spec) {
  const def = defineRenderer(spec);
  REGISTRY.set(def.id, def);
  return def;
}

/** A registered renderer, or null. */
export const getRenderer = (id) => REGISTRY.get(id) || null;

/** The registered renderers: [{ id, label, views, builtIn }]. */
export const listRenderers = () => [...REGISTRY.values()].map(({ id, label, views, builtIn }) => ({ id, label, views, builtIn }));

/** Forgets a renderer (the tests). */
export const unregisterRenderer = (id) => REGISTRY.delete(id);

/**
 * The host a renderer is created with: its canvas, the canvas's size on the page (CSS pixels) and the
 * screen's pixel ratio, the view and the theme it starts with, and the world. `extra` is the host's own
 * (the built-in canvas also gets the shared floors).
 */
export function createHost(canvas, { width = canvas?.width || 0, height = canvas?.height || 0, pixelRatio = 1, view = null, theme = 'pixel', ...extra } = {}) {
  return { sdk: SDK_VERSION, canvas, width, height, pixelRatio, view, theme, world: WORLD, ...extra };
}

/**
 * Creates an instance of a renderer and checks it has what it must (draw). The host's view is one of
 * the renderer's (its first if the asked one is not).
 */
export function createRenderer(spec, host) {
  const def = spec?.create && Object.isFrozen(spec) ? spec : defineRenderer(spec);
  const view = def.views.includes(host.view) ? host.view : def.views[0];
  const instance = def.create({ ...host, view });
  if (!instance || typeof instance.draw !== 'function') throw new Error(`the renderer ${def.id}: create(host) must return { draw(scene) }`);
  return instance;
}

// ---------------------------------------------------------------- targets and actions

/**
 * A target: what is at a point of the canvas, in the world's words. Either a person of the scene
 * ({ person: id }) or a prop of the world ({ prop: id }, WORLD.props). Anything else is not one.
 */
export function isTarget(t, scene = null) {
  if (!t || typeof t !== 'object') return false;
  if (typeof t.person === 'string') return !scene || !!personIn(scene, t.person);
  if (typeof t.prop === 'string') return PROPS.has(t.prop);
  return false;
}

const PROPS = new Map(WORLD.props.map((p) => [p.id, p]));
/** A prop of the world by id. */
export const propOf = (id) => PROPS.get(id) || null;

/** The props that do something when clicked (each says what with its `action`). */
export const INTERACTIVE = Object.freeze(WORLD.props.filter((p) => p.action));

/**
 * What the game does with a target: { type: 'select', person } (their card; a desk is its owner's),
 * { type: 'board' } (the whiteboard), { type: 'services' } (the rack), { type: 'lift' } (the elevator),
 * { type: 'rug' } (the meeting table: the daily and the retro), or null.
 */
export function actionOf(target) {
  if (!target) return null;
  if (typeof target.person === 'string') return { type: 'select', person: target.person };
  const p = PROPS.get(target.prop);
  if (!p?.action) return null;
  return p.action === 'select' ? { type: 'select', person: p.owner } : { type: p.action };
}

/** The people who can be pointed at: in sight and staying. */
const pointable = (scene) => peopleOf(scene).filter((a) => a.pose !== 'hidden' && !a.gone && a.fade > 0.3);
/** Where a person is on the floor: seated, their chair. */
const footOf = (a) => (a.seated && a.cfg?.seat ? a.cfg.seat : a);

/**
 * What is at a point of the floor (x, y in world units): the closest person within reach, or the smallest
 * interactive prop whose footprint covers it. For a renderer that can say where on the floor the pointer
 * is (toWorld): a top-down one, or a 3D one casting a ray onto the floor.
 */
export function pickAt(scene, x, y) {
  if (!scene || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null, bestD = PERSON.reach;
  for (const a of pointable(scene)) {
    const f = footOf(a), d = Math.hypot(f.x - x, f.y - y);
    if (d < bestD) { best = a.id; bestD = d; }
  }
  if (best) return { person: best };
  let prop = null;
  for (const p of INTERACTIVE) {
    if (Math.abs(x - p.x) > p.w / 2 || Math.abs(y - p.y) > p.d / 2) continue;
    if (!prop || p.w * p.d < prop.w * prop.d) prop = p;
  }
  return prop ? { prop: prop.id } : null;
}

/**
 * What is at a point of the canvas (fx, fy: fractions 0..1 of its width and height), for a renderer that
 * can say where a point of the world lands on it (project): a person if the point is on their silhouette
 * (the one in front first), else the smallest interactive prop whose volume on screen covers it.
 */
export function pickByProjection(scene, project, fx, fy) {
  if (!scene || typeof project !== 'function') return null;
  let best = null, bestScore = Infinity;
  for (const a of pointable(scene)) {
    const f = footOf(a);
    const feet = project(f.x, f.y, 0), head = project(f.x, f.y, PERSON.height);
    if (!onScreen(feet) || !onScreen(head)) continue;
    const tall = Math.hypot(head.x - feet.x, head.y - feet.y) || 1e-6;
    const half = tall * 0.32;
    const [left, right] = [Math.min(feet.x, head.x) - half, Math.max(feet.x, head.x) + half];
    const [top, bottom] = [Math.min(feet.y, head.y), Math.max(feet.y, head.y)];
    if (fx < left || fx > right || fy < top || fy > bottom) continue;
    // the closest to the middle of the body, and among those the one in front (lower on screen)
    const score = Math.hypot(fx - (feet.x + head.x) / 2, fy - (feet.y + head.y) / 2) / tall - feet.y;
    if (score < bestScore) { best = a.id; bestScore = score; }
  }
  if (best) return { person: best };
  let prop = null, area = Infinity;
  for (const p of INTERACTIVE) {
    const b = boxOnScreen(project, p);
    if (!b || fx < b.x || fx > b.x + b.w || fy < b.y || fy > b.y + b.h) continue;
    if (b.w * b.h < area) { prop = p; area = b.w * b.h; }
  }
  return prop ? { prop: prop.id } : null;
}

const onScreen = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Where a box of the world lands on the canvas ({ x, y, w, h } in fractions), through a renderer's
 * project: a prop ({ x, y, w, d, h }: its footprint's middle, its footprint and its height) or any
 * { x0, x1, y0, y1, z0, z1 }. null if a corner cannot be projected (behind the camera).
 */
export function boxOnScreen(project, b) {
  const [x0, x1, y0, y1, z0, z1] = 'x0' in b
    ? [b.x0, b.x1, b.y0, b.y1, b.z0 ?? 0, b.z1 ?? 0]
    : [b.x - b.w / 2, b.x + b.w / 2, b.y - b.d / 2, b.y + b.d / 2, b.z ?? 0, (b.z ?? 0) + b.h];
  const pts = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const p = project(x, y, z);
    if (!onScreen(p)) return null;
    pts.push(p);
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * What is at a point of the canvas, asking an instance the best way it can answer: its own pick, else
 * by projection (project), else on the floor (toWorld). Always a valid target or null.
 */
export function pickWith(instance, scene, fx, fy) {
  if (!instance || !scene) return null;
  let t = null;
  if (typeof instance.pick === 'function') t = instance.pick(fx, fy);
  else if (typeof instance.project === 'function') t = pickByProjection(scene, instance.project, fx, fy);
  else if (typeof instance.toWorld === 'function') { const p = instance.toWorld(fx, fy); t = p ? pickAt(scene, p.x, p.y) : null; }
  return isTarget(t, scene) ? t : null;
}

// ---------------------------------------------------------------- labels over the drawing

/**
 * Places labels over the drawing so that none covers another: the speech bubbles and the badges over
 * people's heads. Each one prefers to sit centered just above its anchor (where its tail points); if that
 * place is taken it tries higher up and to the sides, the closest free place first, always inside the
 * bounds. A label keeps the place it had in the last frame while that place stays free, so labels do not
 * jump around; the ones that matter more (`priority`) are placed first.
 *
 * @param items     [{ id, x, y (the anchor), w, h, priority = 0 }], in the canvas's units
 * @param options   bounds { x0, y0, x1, y1 }; gap between labels; previous: Map id → { dx, dy } of the last frame
 * @returns Map id → { x, y (top-left), w, h, dx, dy (its offset from the preferred place), free (no overlap) }
 */
export function layoutLabels(items, { bounds = null, gap = 4, previous = null } = {}) {
  const placed = [];
  const out = new Map();
  const order = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.y - a.y || String(a.id).localeCompare(String(b.id)));
  const clamp = (r) => {
    if (!bounds) return r;
    const x = Math.max(bounds.x0, Math.min(bounds.x1 - r.w, r.x)), y = Math.max(bounds.y0, Math.min(bounds.y1 - r.h, r.y));
    return { ...r, x, y };
  };
  const overlap = (r) => {
    let area = 0;
    for (const p of placed) {
      // (closer than `gap` counts as touching)
      const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x) + gap;
      const oy = Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y) + gap;
      if (ox > 0 && oy > 0) area += ox * oy;
    }
    return area;
  };
  for (const it of order) {
    const base = { x: it.x - it.w / 2, y: it.y - it.h, w: it.w, h: it.h };
    // the candidates, closest first: up a row or two, then to the sides (a little, then a whole width)
    const tries = [];
    const last = previous?.get(it.id);
    if (last) tries.push({ dx: last.dx, dy: last.dy, score: -1 });
    for (let row = 0; row <= 3; row++) {
      for (const side of [0, 0.6, -0.6, 1.15, -1.15]) {
        const dx = side * (it.w + gap), dy = -row * (it.h + gap);
        tries.push({ dx, dy, score: Math.abs(dy) + Math.abs(dx) * 0.8 });
      }
    }
    tries.sort((a, b) => a.score - b.score);
    let best = null;
    for (const t of tries) {
      const r = clamp({ ...base, x: base.x + t.dx, y: base.y + t.dy });
      const area = overlap(r);
      if (!best || area < best.area) best = { r, area };
      if (area === 0) break;
    }
    const r = best.r;
    placed.push(r);
    out.set(it.id, { x: r.x, y: r.y, w: r.w, h: r.h, dx: r.x - base.x, dy: r.y - base.y, free: best.area === 0 });
  }
  return out;
}
