#!/usr/bin/env node
// Checks renderers against the renderer SDK's contract (public/sdk/conformance.js): every renderer the
// given modules register, or, with no module, the game's own (the pixel-art canvas and the reference plan).
//
//   node scripts/check-renderer.mjs                         the game's renderers
//   node scripts/check-renderer.mjs public/renderers/x.js   the ones that module registers
//
// It runs in Node, with a canvas that takes any 2D drawing call: a renderer that needs WebGL is checked
// in a browser instead (checkRenderer with a real canvas). Exits with 1 if one fails.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { listRenderers, getRenderer } = await import(pathToFileURL(path.join(root, 'public/sdk/index.js')));
const { checkRenderer } = await import(pathToFileURL(path.join(root, 'public/sdk/conformance.js')));

const before = new Set(listRenderers().map((r) => r.id));
const modules = process.argv.slice(2);
const load = modules.length ? modules.map((m) => path.resolve(m)) : ['public/game.js', 'public/renderers/plan.js'].map((m) => path.join(root, m));
for (const file of load) await import(pathToFileURL(file));
const ids = listRenderers().map((r) => r.id).filter((id) => !modules.length || !before.has(id));
if (!ids.length) { console.error('no renderer registered: call registerRenderer({ id, create }) in the module'); process.exit(1); }

let failed = 0;
for (const id of ids) {
  const { ok, problems, passed } = checkRenderer(getRenderer(id));
  console.log(`${ok ? '✓' : '✗'} ${id}  (${passed.length} checks passed${problems.length ? `, ${problems.length} failed` : ''})`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
