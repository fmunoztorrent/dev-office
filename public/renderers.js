// The renderers: what draws a scene (public/scene.js). The game decides what happens; a renderer only
// turns each frame's scene into pixels (or characters, or polygons). The browser's game draws with the
// one chosen: its own canvas (front or isometric view) or one registered here.
//
// A renderer is { id, label, create(canvas, options) → instance }:
//
//   instance.draw(scene)        draws a frame (the scene of that frame: nothing else)
//   instance.resize?(w, h)      the canvas changed size (its pixels)
//   instance.pick?(x, y)        what is at that point of the canvas (fractions 0..1 of its width and height):
//                               { person: id } | { what: 'board' | 'rack' | 'lift' } | null
//   instance.dispose?()         it is no longer used
//
// `canvas` is a canvas of its own (a 3D renderer asks it for a WebGL context). To add one (say, a 3D one):
//
//   import { registerRenderer } from './renderers.js';
//   registerRenderer({ id: 'three', label: '3D', create: (canvas) => ({ draw(scene) { … } }) });
//
// and open the game with `?renderer=three`. docs/rendering.md has the scene's contract.

const REGISTRY = new Map();

/** Registers a renderer (the same id again replaces it). */
export function registerRenderer(spec) {
  if (!spec || typeof spec.id !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(spec.id)) throw new Error('a renderer needs an id (lowercase letters, digits and dashes)');
  if (typeof spec.create !== 'function') throw new Error(`the renderer ${spec.id} needs create(canvas)`);
  REGISTRY.set(spec.id, { label: spec.id, ...spec });
  return REGISTRY.get(spec.id);
}

/** A registered renderer, or null. */
export const getRenderer = (id) => REGISTRY.get(id) || null;

/** The registered renderers: [{ id, label }]. */
export const listRenderers = () => [...REGISTRY.values()].map(({ id, label }) => ({ id, label }));

/** The game's own renderers (public/game.js): its canvas, in its two views. They are not in the registry. */
export const BUILT_IN = ['flat', 'iso'];
