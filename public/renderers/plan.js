// The reference renderer: a plain top-down plan of the office drawn ONLY from the scene (public/scene.js):
// its rooms, doors and furniture from `scene.world`, each person as a dot of their shirt's color with their
// name, what they say and their badge, the whiteboard's task and the time of day. It is not a game view:
// it proves the scene is enough to draw the office and is where a new renderer (a 3D one) can start from.
// Open the game with `?renderer=plan`.

import { registerRenderer } from '../renderers.js';
import { peopleOf } from '../scene.js';

const KIND_COLOR = {
  desk: '#a0703f', hotdesk: '#b48450', whiteboard: '#f8f9fa', tv: '#1b1f33', sofa: '#2c5470', rack: '#3a3f58', table: '#8c5a33',
  plant: '#2a9d8f', counter: '#6d4c41', fridge: '#cfd8dc', espresso: '#455a64', planter: '#52796f', stall: '#adb5bd', sink: '#e0e0e0',
  cooler: '#90caf9', elevator: '#607d8b', extinguisher: '#d62828',
};
const ROOM_COLOR = { office: '#e9ecef', cafe: '#d7b98e', dining: '#efe1c6', hall: '#5c677d', bathroom: '#dfe7ef' };

/**
 * Draws a scene on a 2D context of `w` × `h` pixels.
 * @returns what it drew, for the tests: { rooms, props, people }
 */
export function drawPlan(ctx, scene, w, h) {
  const { bounds } = scene.world;
  const k = Math.min(w / (bounds.x1 - bounds.x0), h / (bounds.y1 - bounds.y0));
  const X = (x) => (x - bounds.x0) * k, Y = (y) => (y - bounds.y0) * k;
  const night = scene.light?.night ?? 0;
  ctx.fillStyle = '#1b1f33';
  ctx.fillRect(0, 0, w, h);
  for (const r of scene.world.rooms) {
    ctx.fillStyle = ROOM_COLOR[r.id] || '#ced4da';
    ctx.fillRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
  }
  // the glass wall, with the sky's light
  for (const g of scene.world.windows) { ctx.fillStyle = night > 0.5 ? '#0b132b' : '#8ecae6'; ctx.fillRect(X(g.x0), Y(g.top), (g.x1 - g.x0) * k, Math.max(3, (g.bottom - g.top) * k * 0.3)); }
  for (const p of scene.world.props) {
    ctx.fillStyle = KIND_COLOR[p.kind] || '#adb5bd';
    ctx.fillRect(X(p.x - p.w / 2), Y(p.y - p.d / 2), Math.max(2, p.w * k), Math.max(2, p.d * k));
  }
  for (const d of scene.world.doors) {
    ctx.fillStyle = '#ffd166';
    if (d.x !== undefined) ctx.fillRect(X(d.x) - 2, Y(d.y0), 4, (d.y1 - d.y0) * k);
    else if (d.y !== undefined) ctx.fillRect(X(d.x0), Y(d.y) - 2, (d.x1 - d.x0) * k, 4);
  }
  // the whiteboard's task, on it
  const board = scene.world.props.find((p) => p.kind === 'whiteboard');
  if (board && scene.board.title) { ctx.fillStyle = '#1b1f33'; ctx.font = `${Math.max(9, 11 * k)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(scene.board.title.slice(0, 40), X(board.x), Y(board.y) - 8); }
  // the people
  const people = peopleOf(scene).filter((a) => a.pose !== 'hidden' && !a.gone);
  ctx.textAlign = 'center';
  for (const a of people) {
    const r = Math.max(4, 9 * k);
    ctx.globalAlpha = Math.max(0.15, Math.min(1, a.fade));
    ctx.fillStyle = a.cfg.shirt || '#8d99ae';
    ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = a.id === scene.selected ? '#06d6a0' : a.id === scene.hover ? '#fff' : '#1b1f33';
    ctx.lineWidth = a.id === scene.selected ? 3 : 1;
    ctx.stroke();
    ctx.fillStyle = '#1b1f33';
    ctx.font = `${Math.max(9, 12 * k)}px sans-serif`;
    ctx.fillText(`${a.cfg.name || a.id}${a.kind === 'expert' ? ' 🎓' : a.kind === 'visitor' ? ' 🛠' : ''}`, X(a.x), Y(a.y) + r + 11);
    const over = a.bubble?.text || a.tag?.text;
    if (over) { ctx.fillStyle = a.bubble ? '#fff' : '#ffd166'; ctx.fillText(String(over).slice(0, 28), X(a.x), Y(a.y) - r - 4); }
    ctx.globalAlpha = 1;
  }
  if (scene.banner?.text) { ctx.fillStyle = '#3a86ff'; ctx.fillRect(0, h - 22, w, 22); ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText(scene.banner.text.slice(0, 100), w / 2, h - 7); }
  if (night > 0.05) { ctx.fillStyle = `rgba(10,14,40,${night * 0.4})`; ctx.fillRect(0, 0, w, h); }
  return { rooms: scene.world.rooms.length, props: scene.world.props.length, people: people.map((a) => a.id) };
}

registerRenderer({
  id: 'plan',
  label: 'Plan (reference)',
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let last = null;
    return {
      draw(scene) { last = scene; drawPlan(ctx, scene, canvas.width, canvas.height); },
      // a person under the pointer (fractions of the canvas)
      pick(fx, fy) {
        if (!last) return null;
        const { bounds } = last.world;
        const k = Math.min(canvas.width / (bounds.x1 - bounds.x0), canvas.height / (bounds.y1 - bounds.y0));
        const x = fx * canvas.width / k + bounds.x0, y = fy * canvas.height / k + bounds.y0;
        const hit = peopleOf(last).filter((a) => a.pose !== 'hidden' && !a.gone).find((a) => Math.hypot(a.x - x, a.y - y) < 18);
        return hit ? { person: hit.id } : null;
      },
    };
  },
});
