// The anime theme's people (public/themes.js), drawn with vector strokes instead of pixels: adult women
// in the style of Japanese anime (big eyes, long legs, their hair style and their outfit). The same
// poses as the pixel ones (game.js drawPerson): standing, walking, sitting at a desk or a table, from
// behind on the sofa, a hand up, typing, eating, carrying a card or the extinguisher.
//
// Everything is in world units (a person is about 68 tall, a bit more than the pixel one), with the
// feet at (x, y): it is drawn under any transform (the front view, the isometric one's billboards, a
// portrait). The head is drawn in its own coordinates, centered at HEAD.

import { animeStyle } from './themes.js';

/** How tall the anime people are, to the top of the hair (name tags go over it). */
export const ANIME_HEIGHT = 70;
const HEAD = -57.5;
const LINE = 'rgba(58, 34, 48, 0.88)';
const hex = (c) => { const n = parseInt(String(c || '#888888').slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb = ([r, g, b], a = 1) => (a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);
/** A color, darker (k < 1) or mixed with white (k > 1). */
const tone = (c, k) => { const v = hex(c); return rgb(k <= 1 ? v.map((x) => x * k) : v.map((x) => x + (255 - x) * (k - 1))); };
const hash = (s) => [...String(s ?? '')].reduce((h, ch) => ((h * 31) + ch.charCodeAt(0)) >>> 0, 7);
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// what each outfit is: its top, its sleeves, its bottom (and where it ends), its legs and its shoes
const OUTFIT = {
  blazer: { top: 'cami', sleeve: 'long', jacket: true, bottom: 'pencil', hem: -21.5, legs: 'pantyhose', shoes: 'heels' },
  blouse: { top: 'blouse', sleeve: 'none', bow: true, bottom: 'pleats', hem: -21, legs: 'thigh', legTop: -16.5, shoes: 'loafers' },
  suit: { top: 'vest', sleeve: 'short', bottom: 'pencil', hem: -21, legs: 'boots', legTop: -15, shoes: 'boots' },
  offshoulder: { top: 'offshoulder', sleeve: 'long', bottom: 'shorts', hem: -23.2, legs: 'thigh', legTop: -16, shoes: 'sneakers' },
  crop: { top: 'crop', sleeve: 'short', bottom: 'pleats', hem: -21.5, legs: 'knee', legTop: -10.5, shoes: 'sneakers' },
  turtleneck: { top: 'turtle', sleeve: 'none', bottom: 'shorts', hem: -23.6, legs: 'boots', legTop: -15.5, shoes: 'boots' },
  jacket: { top: 'tank', sleeve: 'elbow', jacket: true, short: true, bottom: 'pencil', hem: -21.5, legs: 'none', shoes: 'boots-low' },
  sweater: { top: 'dress', sleeve: 'long', bottom: 'dress', hem: -20, legs: 'thigh', legTop: -15.5, shoes: 'boots-low' },
};

// ---------------------------------------------------------------- drawing helpers

function path(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]); else ctx.lineTo(p[0], p[1]);
  }
  if (close) ctx.closePath();
}
function paint(ctx, color, line = true, w = 0.4) {
  ctx.fillStyle = color;
  ctx.fill();
  if (line) { ctx.strokeStyle = LINE; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.stroke(); }
}
function oval(ctx, x, y, rx, ry, color, line = false, rot = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); paint(ctx, color, line, 0.32);
}
function stroke(ctx, pts, color, w) { path(ctx, pts, false); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke(); }

/** A limb as one smooth outline through its joints (no seams at the knee or the elbow), round at both ends. */
function limbPath(ctx, pts, ws) {
  const n = pts.length;
  const normal = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  };
  const left = pts.map((p, i) => { const [nx, ny] = normal(i); return [p[0] + nx * ws[i], p[1] + ny * ws[i]]; });
  const right = pts.map((p, i) => { const [nx, ny] = normal(i); return [p[0] - nx * ws[i], p[1] - ny * ws[i]]; });
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) { const m = lerp(left[i - 1], left[i], 0.5); ctx.quadraticCurveTo(left[i - 1][0], left[i - 1][1], m[0], m[1]); }
  ctx.lineTo(left[n - 1][0], left[n - 1][1]);
  const [ex, ey] = pts[n - 1], [nx1, ny1] = normal(n - 1);
  ctx.arc(ex, ey, ws[n - 1], Math.atan2(ny1, nx1), Math.atan2(-ny1, -nx1), false);
  for (let i = n - 2; i >= 0; i--) { const m = lerp(right[i + 1], right[i], 0.5); ctx.quadraticCurveTo(right[i + 1][0], right[i + 1][1], m[0], m[1]); }
  ctx.lineTo(right[0][0], right[0][1]);
  const [sx, sy] = pts[0], [nx0, ny0] = normal(0);
  ctx.arc(sx, sy, ws[0], Math.atan2(-ny0, -nx0), Math.atan2(ny0, nx0), false);
  ctx.closePath();
}

// ---------------------------------------------------------------- the pose

/** Where each joint is, for this frame: legs, arms, how low the body goes and whether it sits. */
function pose(a, now) {
  const sit = !!(a.seated || a.perch);
  const side = a.sideways === false ? 0 : (a.face || 1);
  const ph = a.walking ? a.walkT * 9 * (Math.PI / 2) : 0;
  const s = Math.sin(ph), c = Math.cos(ph);
  const dancing = a.dance && !a.walking;
  const legs = [-1, 1].map((k, i) => {
    const hip = [k * 3.1, -26.5];
    if (sit) return { hip, knee: [k * 3.5, -19.5], ankle: [k * 3.1, -8.5] };
    // a step: the feet go forward and back without crossing
    const step = a.walking ? (i ? -s : s) * 2.0 * side : 0;
    const lift = a.walking ? Math.max(0, i ? -c : c) * (side ? 1.7 : 2.3) : dancing && (Math.floor(now / 160) % 2 === i) ? 1.9 : 0;
    const ankle = [k * 2.6 + step, -1.4 - lift];
    const knee = lerp(hip, ankle, 0.52);
    return { hip, knee: [knee[0] + step * 0.12, knee[1] - lift * 0.35], ankle };
  });
  const sw = a.walking ? s * 2.2 * (side || 1) : 0;
  const working = a.seated && a.state === 'working';
  const tap = working ? (Math.floor(now / 140) % 2 ? 0.7 : -0.7) : 0;
  const eating = a.perch && a.food && Math.floor(now / 600) % 3 === 0;
  const arm = (k) => {
    const sh = [k * 6.3, -44];
    if (k < 0 && a.handUp) return { sh, el: [-9.4, -52], hand: [-9.8, -60.5] };
    if (k > 0 && eating) return { sh, el: [8.1, -37.5], hand: [2.4, -50.6] };
    if (k > 0 && a.carry) return { sh, el: [7.8, -36], hand: [6.6, -31.5] };
    if (working) return { sh, el: [k * 7.8, -36.5], hand: [k * 4.6, -32.5 + (k < 0 ? tap : -tap)] };
    if (sit) return { sh, el: [k * 7.6, -36], hand: [k * 5.5, -29.5] };
    return { sh, el: [k * 7.5 - sw * 0.4 * k, -35.6], hand: [k * 7.8 - sw * k, -27.8 + Math.abs(sw) * 0.3] };
  };
  return { sit, side, legs, arms: [arm(-1), arm(1)], dy: sit ? 8 : a.walking ? -Math.abs(s) * 0.7 : 0, sway: Math.sin(now / 420 + (hash(a.id) % 7)) * 0.5 + (a.walking ? -side * 1.2 : 0), eating };
}

// ---------------------------------------------------------------- the hair (head coordinates)

/** Pointed strands along a line: from `from` to `to`, tips at `tips` (each [x, y]); the gaps go up to `gap`. */
function strands(ctx, tips, gap) {
  for (let i = 0; i < tips.length; i++) {
    const [tx, ty] = tips[i];
    const next = tips[i + 1];
    ctx.quadraticCurveTo(tx + 0.5, (ty + gap) / 2 + 0.4, tx, ty);
    if (next) { const gx = (tx + next[0]) / 2; ctx.quadraticCurveTo(gx + 0.1, (ty + gap) / 2, gx, gap); }
  }
}

function hairBack(ctx, st, hair, sway) {
  const dark = tone(hair, 0.78);
  const h = st.hairstyle;
  ctx.beginPath();
  if (h === 'long' || h === 'hime' || h === 'wavy') {
    const end = h === 'hime' ? 26 : 27;
    ctx.moveTo(-7.6, -2);
    if (h === 'wavy') { ctx.quadraticCurveTo(-10.4, 6, -8.4 + sway, 12); ctx.quadraticCurveTo(-6.6, 18, -9 + sway, end - 2); }
    else ctx.quadraticCurveTo(-9.8, 10, -8.6 + sway, end - 2);
    if (h === 'hime') { ctx.lineTo(-8.6 + sway, end); ctx.lineTo(8.6 + sway, end); }
    else strands(ctx, [[-7.4 + sway, end], [-4.2 + sway, end - 1.4], [-1.2 + sway, end + 0.6], [2 + sway, end - 1.2], [5 + sway, end + 0.4], [8 + sway, end - 1.6]], end - 4);
    if (h === 'wavy') { ctx.quadraticCurveTo(6.6, 18, 8.4 + sway, 12); ctx.quadraticCurveTo(10.4, 6, 7.6, -2); }
    else { ctx.lineTo(8.6 + sway, end - 2); ctx.quadraticCurveTo(9.8, 10, 7.6, -2); }
    ctx.quadraticCurveTo(0, -13, -7.6, -2);
    paint(ctx, dark);
  } else if (h === 'ponytail') {
    ctx.moveTo(1.5, -8.6);
    ctx.quadraticCurveTo(9.2 + sway, -6, 7.6 + sway * 1.6, 9);
    ctx.quadraticCurveTo(6.8 + sway * 2, 17, 4.6 + sway * 2.2, 22);
    ctx.quadraticCurveTo(4.6 + sway * 1.6, 12, 4.4 + sway, 6);
    ctx.quadraticCurveTo(4, -2, 0, -6.6);
    paint(ctx, dark);
  } else if (h === 'twintails') {
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(k * 5.8, -8.4);
      ctx.quadraticCurveTo(k * 13 + sway, -2, k * 11 + sway * 1.4, 12);
      ctx.quadraticCurveTo(k * 10.2 + sway * 1.6, 18, k * 8.2 + sway * 1.8, 23);
      ctx.quadraticCurveTo(k * 8 + sway * 1.2, 12, k * 7.2 + sway, 4);
      ctx.quadraticCurveTo(k * 6.4, -2, k * 5, -5.2);
      paint(ctx, dark);
    }
  } else if (h === 'bob') {
    ctx.moveTo(-7.6, -2);
    ctx.quadraticCurveTo(-9.2, 5, -7.8 + sway * 0.2, 9.6);
    ctx.lineTo(7.8 + sway * 0.2, 9.6);
    ctx.quadraticCurveTo(9.2, 5, 7.6, -2);
    ctx.quadraticCurveTo(0, -13, -7.6, -2);
    paint(ctx, dark);
  } else if (h === 'bun') {
    oval(ctx, 1.2, -10, 3.6, 3.2, hair, true);
    oval(ctx, 2, -10.8, 1.4, 0.8, tone(hair, 1.25));
  } else if (h === 'side') {
    ctx.moveTo(5.2, -7.6);
    ctx.quadraticCurveTo(12 + sway, -2, 10.2 + sway * 1.5, 12);
    ctx.quadraticCurveTo(9.4 + sway * 1.8, 16, 7.8 + sway * 2, 19);
    ctx.quadraticCurveTo(8 + sway, 8, 6.4, -0.6);
    paint(ctx, dark);
  }
}

function hairFront(ctx, st, hair, sway) {
  const h = st.hairstyle;
  const light = tone(hair, 1.32), dark = tone(hair, 0.8);
  // the skull's cap and its bangs, in curved strands
  ctx.beginPath();
  ctx.moveTo(-7.6, 1);
  ctx.quadraticCurveTo(-8.6, -10.8, 0, -11);
  ctx.quadraticCurveTo(8.6, -10.8, 7.6, 1);
  ctx.quadraticCurveTo(7.2, -2, 6.6, -3.2);
  if (h === 'hime') { ctx.lineTo(6.2, -1.3); ctx.lineTo(-6.2, -1.3); }
  else if (h === 'short') strands(ctx, [[5.4, -2.2], [2.9, -1.4], [0.4, -2.6], [-2.2, -1.2], [-4.8, -2.4]], -5);
  else strands(ctx, [[5.6, -1.4], [3.4, -0.6], [1.0, -1.9], [-1.4, -0.5], [-3.6, -1.7], [-5.6, -0.9]], -4.6);
  ctx.quadraticCurveTo(-6.8, -2.2, -7.6, 1);
  ctx.closePath();
  paint(ctx, hair);
  // a shade under the crown, and the shine: a broken arc of light
  ctx.save(); ctx.clip();
  oval(ctx, 0, -2.4, 9, 2.2, tone(hair, 0.9));
  ctx.restore();
  for (const [a0, a1] of [[1.08, 1.32], [1.4, 1.62], [1.7, 1.9]]) {
    ctx.beginPath(); ctx.ellipse(0, -5.6, 5.4, 2.4, 0, Math.PI * a0, Math.PI * a1); ctx.strokeStyle = light; ctx.lineWidth = 0.75; ctx.lineCap = 'round'; ctx.stroke();
  }
  // the locks that frame the face
  const lock = h === 'short' ? 3.6 : h === 'bob' ? 9.2 : h === 'bun' || h === 'ponytail' ? 7 : 11.5;
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 7.7, -3.6);
    ctx.quadraticCurveTo(k * 8.3, 3.5, k * 6.9 + sway * 0.25, lock);
    ctx.quadraticCurveTo(k * 6.2, lock - 4, k * 5.6, -0.6);
    ctx.closePath();
    paint(ctx, hair);
    stroke(ctx, [[k * 7.0, -1], [k * 7.2, 3, k * 6.6, lock - 2]], dark, 0.25);
  }
  if (h === 'hime') for (const k of [-1, 1]) { path(ctx, [[k * 6.6, -1.4], [k * 4.8, -1.4], [k * 4.8, 7.2], [k * 6.8, 7.2]]); paint(ctx, hair); }
  if (h === 'braid') {
    // over the front shoulder, in links, tied with a ribbon
    for (let i = 0; i < 7; i++) oval(ctx, 6.2 + sway * 0.18 * i - i * 0.12, 8 + i * 2.5, 1.65 - i * 0.07, 1.45, i % 2 ? hair : dark, true);
    oval(ctx, 5.4 + sway * 1.2, 25.4, 1, 0.6, '#e85d75');
  }
  if (h === 'twintails') for (const k of [-1, 1]) { path(ctx, [[k * 6.2, -8.2], [k * 8.8, -10.6], [k * 9.4, -6.6], [k * 6.8, -6.4]]); paint(ctx, '#e85d75'); oval(ctx, k * 6.6, -7.4, 0.8, 0.8, '#c4405a'); }
  if (h === 'side') oval(ctx, 6.6, -6.6, 1.2, 0.95, '#ffd166', true);
  if (h === 'ponytail') oval(ctx, 2.2, -8.2, 0.9, 0.7, tone(hair, 0.6));
  if (h === 'bun') stroke(ctx, [[-1.6, -10.6], [4.6, -12.2]], '#2b2d42', 0.35);
}

// ---------------------------------------------------------------- the face (head coordinates)

function face(ctx, a, c, st, now) {
  const skin = c.skin || '#f5d6c0';
  const showEars = ['short', 'bun', 'ponytail'].includes(st.hairstyle);
  if (showEars) for (const k of [-1, 1]) oval(ctx, k * 6.1, 1.6, 0.8, 1.3, skin, true);
  path(ctx, [[-6.0, -3.0], [-6.2, 2.2, -5.0, 4.6], [-2.5, 8.2, 0, 8.9], [2.5, 8.2, 5.0, 4.6], [6.2, 2.2, 6.0, -3.0], [0, -9.5, -6.0, -3.0]]);
  paint(ctx, skin);
  // the shade the bangs cast on the forehead
  ctx.save(); ctx.clip(); oval(ctx, 0, -2.6, 6.4, 1.3, tone(skin, 0.9)); ctx.restore();
  const blink = Math.floor(now / 100) % 43 === 42;
  const look = a.walking ? (a.face || 0) * 0.45 : 0;
  const iris = st.eyes || tone(c.hair || '#553', 0.7);
  for (const k of [-1, 1]) {
    const ex = k * 2.75 + look * 0.4, ey = 2.0;
    const inner = ex - k * 1.85, outer = ex + k * 1.95;
    if (blink) {
      stroke(ctx, [[inner, ey + 0.2], [ex, ey + 1.3, outer, ey]], '#2b1d2e', 0.55);
    } else {
      oval(ctx, ex, ey, 1.8, 2.3, '#ffffff');
      ctx.save();
      ctx.beginPath(); ctx.ellipse(ex + look * 0.35, ey + 0.25, 1.38, 2.05, 0, 0, Math.PI * 2); ctx.clip();
      oval(ctx, ex + look * 0.35, ey + 0.25, 1.38, 2.05, iris);
      oval(ctx, ex + look * 0.35, ey - 0.9, 1.6, 1.3, tone(iris, 0.6));
      oval(ctx, ex + look * 0.35, ey + 1.5, 1.1, 0.7, tone(iris, 1.35));
      ctx.restore();
      oval(ctx, ex + look * 0.35, ey + 0.35, 0.58, 0.98, '#1d1220');
      oval(ctx, ex - 0.5 + look * 0.35, ey - 0.75, 0.52, 0.55, '#ffffff');
      oval(ctx, ex + 0.55 + look * 0.35, ey + 1.0, 0.24, 0.24, '#ffffff');
      // the upper lash line, thick, with its wing at the outer corner; the crease; a thin lower lash
      ctx.beginPath(); ctx.moveTo(inner, ey - 0.5); ctx.quadraticCurveTo(ex, ey - 3.1, outer, ey - 1.4); ctx.lineTo(outer + k * 0.75, ey - 2.2);
      ctx.strokeStyle = '#2b1d2e'; ctx.lineWidth = 0.78; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      stroke(ctx, [[inner + k * 0.3, ey - 2.4], [ex, ey - 3.9, outer - k * 0.2, ey - 2.6]], 'rgba(90, 50, 60, 0.45)', 0.25);
      stroke(ctx, [[ex - k * 0.2, ey + 2.35], [ex + k * 1.0, ey + 2.2, outer - k * 0.1, ey + 1.6]], '#2b1d2e', 0.24);
    }
    // the brows, from the hair; the blush, with its little lines
    stroke(ctx, [[ex - 1.5, -2.6], [ex, -3.5, ex + 1.6, -2.8]], tone(c.hair || '#553', 0.55), 0.32);
    oval(ctx, k * 3.9, 4.7, 1.3, 0.5, 'rgba(255, 110, 135, 0.3)');
    for (const dx of [-0.6, 0, 0.6]) stroke(ctx, [[k * 3.9 + dx - 0.25, 4.95], [k * 3.9 + dx + 0.2, 4.45]], 'rgba(220, 80, 105, 0.45)', 0.16);
  }
  // the nose: just a hint of shade
  stroke(ctx, [[0.25, 4.3], [0.55, 5.0]], 'rgba(150, 80, 80, 0.5)', 0.26);
  // the mouth: what they feel
  const talking = a.bubble && (!a.bubble.until || a.bubble.until > now) && Math.floor(now / 140) % 2;
  const happy = a.state === 'done' || (a.jumpUntil && now < a.jumpUntil);
  const worried = a.state === 'blocked' || a.state === 'alarm' || a.dance;
  if (happy || talking || a.eating) {
    path(ctx, [[-1.15, 6.3], [0, 6.55], [1.15, 6.3], [0.85, 7.9, 0, 8.0], [-0.85, 7.9, -1.15, 6.3]]); paint(ctx, '#8e2a3e', false);
    oval(ctx, 0, 7.5, 0.55, 0.28, '#f28a9b');
  } else if (worried) {
    stroke(ctx, [[-0.9, 7.0], [-0.3, 6.4, 0.2, 6.9], [0.6, 7.3, 1.0, 6.8]], '#7a3040', 0.3);
  } else {
    stroke(ctx, [[-0.95, 6.6], [0, 7.25, 0.95, 6.6]], '#b4485c', 0.36);
  }
  if (c.glasses) {
    ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 0.3;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(k * 2.75, 2.1, 2.4, 2.0, 0, 0, Math.PI * 2); ctx.stroke(); }
    stroke(ctx, [[-0.4, 1.6], [0.4, 1.6]], '#2b2d42', 0.3);
    ctx.fillStyle = 'rgba(200, 230, 255, 0.16)';
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(k * 2.75, 2.1, 2.4, 2.0, 0, 0, Math.PI * 2); ctx.fill(); }
  }
}

// ---------------------------------------------------------------- the body and the clothes

const TORSO = [[-1.7, -45.2], [-6.6, -44.2], [-7.0, -42.6, -6.1, -41.0], [-6.4, -38.6], [-5.6, -36, -4.0, -33.4], [-5.7, -30, -6.6, -26.3], [6.6, -26.3], [5.7, -30, 4.0, -33.4], [5.6, -36, 6.4, -38.6], [6.1, -41.0], [7.0, -42.6, 6.6, -44.2], [1.7, -45.2]];

/** The torso's area between two heights, in a color (a garment is a band of the torso), with its shade. */
function band(ctx, top, bottom, color) {
  ctx.save();
  path(ctx, TORSO); ctx.clip();
  ctx.fillStyle = color; ctx.fillRect(-9, top, 18, bottom - top);
  ctx.fillStyle = 'rgba(40, 20, 50, 0.1)'; ctx.fillRect(2.6, top, 7, bottom - top);
  ctx.restore();
}

function legs(ctx, P, c, o) {
  const skin = c.skin || '#f5d6c0';
  const wear = o.legs === 'pantyhose' ? 'rgba(25, 20, 35, 0.5)' : o.legs === 'knee' ? '#f4f1ea' : '#24212f';
  for (const L of P.legs) {
    const pts = [L.hip, lerp(L.hip, L.knee, 0.5), L.knee, lerp(L.knee, L.ankle, 0.38), L.ankle];
    const ws = [2.15, 1.85, 1.22, 1.32, 0.74];
    limbPath(ctx, pts, ws); paint(ctx, skin, false);
    // what covers them, from its top down (clipped to the leg): stockings, thigh-highs, boots
    if (o.legs !== 'none') {
      ctx.save(); limbPath(ctx, pts, ws); ctx.clip();
      const top = o.legs === 'pantyhose' ? -40 : o.legTop;
      ctx.fillStyle = wear; ctx.fillRect(-14, top, 28, 4 - top);
      if (o.legs === 'thigh' || o.legs === 'knee') { ctx.fillStyle = o.legs === 'knee' ? '#c9c4b8' : '#4a4660'; ctx.fillRect(-14, top, 28, 0.6); }
      ctx.restore();
    }
    limbPath(ctx, pts, ws); ctx.strokeStyle = LINE; ctx.lineWidth = 0.38; ctx.stroke();
    if (P.sit) continue;
    // the shoes
    const [fx, fy] = L.ankle;
    const dir = P.side * 0.8;
    if (o.shoes === 'heels') { path(ctx, [[fx - 1, fy - 0.6], [fx + 1.1 + dir, fy - 0.2], [fx + 1.4 + dir, fy + 1.1], [fx - 0.8, fy + 1.1], [fx - 0.9, fy + 0.3]]); paint(ctx, '#1d1b26'); }
    else if (o.shoes === 'sneakers') { path(ctx, [[fx - 1.2, fy - 0.4], [fx + 1.3 + dir, fy - 0.2], [fx + 1.6 + dir, fy + 1.2], [fx - 1.2, fy + 1.2]]); paint(ctx, '#f7f7fb'); ctx.fillStyle = c.shirt || '#e85d75'; ctx.fillRect(fx - 1.2, fy + 0.7, 2.8 + dir, 0.45); }
    else if (o.shoes === 'loafers') { path(ctx, [[fx - 1.1, fy - 0.3], [fx + 1.3 + dir, fy - 0.1], [fx + 1.5 + dir, fy + 1.1], [fx - 1.1, fy + 1.1]]); paint(ctx, '#4a2c22'); }
    else { path(ctx, [[fx - 1.2, fy - 2.6], [fx + 1.15, fy - 2.6], [fx + 1.5 + dir, fy + 1.1], [fx - 1.25, fy + 1.1]]); paint(ctx, '#26222f'); }
  }
}

function bottom(ctx, o, c, P) {
  const col = c.pants || '#2b2d42';
  const hem = P.sit ? o.hem + 3.5 : o.hem;
  if (o.bottom === 'shorts') {
    path(ctx, [[-4.2, -33.6], [4.2, -33.6], [6.8, -27.4], [6.7, hem], [1.0, hem + 0.7], [0, -25.4], [-1.0, hem + 0.7], [-6.7, hem], [-6.8, -27.4]]);
    paint(ctx, col);
    stroke(ctx, [[-3.6, -31.4], [3.6, -31.4]], tone(col, 0.7), 0.3);
  } else if (o.bottom === 'pleats') {
    path(ctx, [[-4.2, -33.4], [4.2, -33.4], [6.8, -27.6], [7.9, hem], [-7.9, hem], [-6.8, -27.6]]); paint(ctx, col);
    for (const k of [-4.6, -2, 0.6, 3.2, 5.6]) stroke(ctx, [[k * 0.6, -31.8], [k * 1.12, hem - 0.2]], tone(col, 0.72), 0.3);
  } else if (o.bottom === 'dress') {
    path(ctx, [[-4.1, -33.6], [4.1, -33.6], [6.6, -27.4], [7.1, hem], [-7.1, hem], [-6.6, -27.4]]); paint(ctx, c.shirt || col);
    ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(40, 20, 50, 0.1)'; ctx.fillRect(2.6, -34, 6, 20); ctx.restore();
  } else {
    path(ctx, [[-4.2, -33.6], [4.2, -33.6], [6.7, -27.4], [6.3, hem], [-6.3, hem], [-6.7, -27.4]]); paint(ctx, col);
    stroke(ctx, [[1.3, hem], [1.5, hem - 2.6]], tone(col, 0.65), 0.3);
  }
}

function torso(ctx, o, c, back) {
  const skin = c.skin || '#f5d6c0';
  const top = c.shirt || '#e0607e';
  const dark = c.pants || '#2b2d42';
  path(ctx, TORSO); paint(ctx, skin);
  if (o.top === 'cami') {
    band(ctx, -41.4, -32, top);
    if (!back) stroke(ctx, [[-3.4, -41.5], [0, -37.8], [3.4, -41.5]], tone(top, 0.72), 0.32);
  } else if (o.top === 'blouse' || o.top === 'turtle' || o.top === 'dress') {
    band(ctx, o.top === 'turtle' ? -48.5 : -45.4, -26, top);
    if (o.top === 'turtle') { path(ctx, [[-2.1, -48.6], [2.1, -48.6], [2.3, -44.8], [-2.3, -44.8]]); paint(ctx, top); }
    if (o.top === 'blouse' && !back) { path(ctx, [[-1.9, -45.2], [0, -42.8], [1.9, -45.2], [0.6, -45.3], [0, -44.3], [-0.6, -45.3]]); paint(ctx, '#ffffff'); }
  } else if (o.top === 'vest') {
    band(ctx, -45.4, -26.6, '#f7f7fb');
    band(ctx, -42.2, -27, top);
    if (!back) {
      path(ctx, [[-1.5, -45.2], [0, -40.2], [1.5, -45.2]]); paint(ctx, skin, false);
      for (const yb of [-37.6, -34.6, -31.6]) oval(ctx, 0, yb, 0.36, 0.36, '#e8d8a8');
    }
  } else if (o.top === 'offshoulder') {
    band(ctx, -42.6, -25.8, top);
    stroke(ctx, [[-6.6, -42.6], [0, -41.2, 6.6, -42.6]], tone(top, 0.72), 0.65);
  } else if (o.top === 'crop') {
    band(ctx, -45.4, -36.4, top);
    stroke(ctx, [[-5.9, -36.4], [5.9, -36.4]], tone(top, 0.7), 0.45);
    if (!back) stroke(ctx, [[-0.12, -35.4], [0.12, -34.7]], tone(skin, 0.72), 0.25);
  } else if (o.top === 'tank') {
    band(ctx, -42, -32.6, '#f2f2f7');
  }
  if (o.jacket) {
    // an open jacket: its two panels and its lapels
    const col = o.short ? top : dark;
    const hem = o.short ? -35 : -28.6;
    for (const k of [-1, 1]) {
      path(ctx, [[k * 1.8, -45.2], [k * 6.7, -44.4], [k * 7.0, -42.6, k * 6.2, -41.0], [k * 6.5, -38.6], [k * 5.8, -36, k * 4.9, hem], [k * (back ? 0 : 2.7), hem], [k * (back ? 0 : 2.3), -39.6]]);
      paint(ctx, col);
      if (!back) { path(ctx, [[k * 1.8, -45.2], [k * 3.7, -42.4], [k * 2.7, -40.4]]); paint(ctx, tone(col, 0.78)); }
    }
  }
  if (!back && !o.jacket && o.top !== 'vest') {
    // a hint of her shape: two soft lines at the chest, under the top
    for (const k of [-1, 1]) stroke(ctx, [[k * 4.6, -39.4], [k * 2.8, -37.3, k * 0.9, -38.3]], 'rgba(58, 34, 48, 0.26)', 0.3);
  }
  if (o.bow && !back) { path(ctx, [[0, -43.4], [-1.7, -44.4], [-1.7, -42.4]]); paint(ctx, '#e85d75'); path(ctx, [[0, -43.4], [1.7, -44.4], [1.7, -42.4]]); paint(ctx, '#e85d75'); }
}

function arms(ctx, P, o, c) {
  const skin = c.skin || '#f5d6c0';
  const sleeve = o.jacket ? (o.short ? c.shirt : c.pants) : o.top === 'vest' ? '#f7f7fb' : c.shirt;
  const until = { short: 0.45, elbow: 1, long: 1.82 }[o.sleeve] || 0;
  for (const A of P.arms) {
    const pts = [A.sh, lerp(A.sh, A.el, 0.5), A.el, A.hand];
    const ws = [1.4, 1.15, 0.92, 0.78];
    limbPath(ctx, pts, ws); paint(ctx, skin, false);
    if (until) {
      // the sleeve: the arm, colored from the shoulder to where it ends
      ctx.save(); limbPath(ctx, pts, ws); ctx.clip();
      const end = until <= 1 ? lerp(A.sh, A.el, until) : lerp(A.el, A.hand, until - 1);
      stroke(ctx, until <= 1 ? [[A.sh[0], A.sh[1] - 1], end] : [[A.sh[0], A.sh[1] - 1], A.el, end], sleeve, 4.4);
      ctx.restore();
    }
    limbPath(ctx, pts, ws); ctx.strokeStyle = LINE; ctx.lineWidth = 0.36; ctx.stroke();
  }
}

function carried(ctx, a, P) {
  const h = P.arms[1].hand;
  if (a.carry === 'ext') {
    path(ctx, [[h[0] - 1.2, h[1] - 6], [h[0] + 2.4, h[1] - 6], [h[0] + 2.4, h[1] + 4], [h[0] - 1.2, h[1] + 4]]); paint(ctx, '#d62828');
    path(ctx, [[h[0] - 0.4, h[1] - 7.4], [h[0] + 1.6, h[1] - 7.4], [h[0] + 1.6, h[1] - 6], [h[0] - 0.4, h[1] - 6]]); paint(ctx, '#2b2d42');
  } else if (a.carry) {
    path(ctx, [[h[0] - 1.6, h[1] - 4.4], [h[0] + 2.6, h[1] - 4.4], [h[0] + 2.6, h[1] + 1.4], [h[0] - 1.6, h[1] + 1.4]]); paint(ctx, '#ffffff');
    ctx.fillStyle = '#adb5bd'; ctx.fillRect(h[0] - 0.8, h[1] - 3, 2.6, 0.45); ctx.fillRect(h[0] - 0.8, h[1] - 1.8, 2, 0.45);
  }
}

/**
 * Draws a person of the anime theme with the feet at (x, y) (sitting: the same anchor the pixel one
 * uses). `a`: the scene's actor (or a floor person): its cfg, its pose, its state.
 */
export function drawAnime(ctx, a, now, { x, y }) {
  const c = a.cfg || {};
  const st = animeStyle(a.expert || (a.role === 'sme' ? a.id : a.role) || a.id, c);
  const o = OUTFIT[st.outfit] || OUTFIT.blouse;
  const P = pose(a, now);
  const hair = c.hair || '#553';
  ctx.save();
  ctx.translate(x, y + P.dy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!P.sit) oval(ctx, 0, -P.dy, 9, 2.4, 'rgba(0, 0, 0, 0.18)');
  // the head, a bit smaller than its drawing (an adult's proportions)
  const head = (fn) => { ctx.save(); ctx.translate(0, HEAD); ctx.scale(0.93, 0.93); fn(); ctx.restore(); };
  if (a.back) {
    // from behind (on the sofa): the back of the clothes, and all the hair
    torso(ctx, o, c, true);
    arms(ctx, P, o, c);
    path(ctx, [[-1.6, -49], [-1.6, -44.6], [1.6, -44.6], [1.6, -49]]); paint(ctx, tone(c.skin || '#f5d6c0', 0.9), false);
    head(() => {
      hairBack(ctx, st, hair, P.sway);
      oval(ctx, 0, -1, 7.8, 9, hair, true);
      oval(ctx, -1.5, -5.6, 3.4, 1.4, tone(hair, 1.2));
    });
    ctx.restore();
    return;
  }
  head(() => hairBack(ctx, st, hair, P.sway));
  legs(ctx, P, c, o);
  torso(ctx, o, c, false);
  bottom(ctx, o, c, P);
  arms(ctx, P, o, c);
  // the neck, with the shade of the chin
  path(ctx, [[-1.6, -50], [-1.6, -44.6], [1.6, -44.6], [1.6, -50]]); paint(ctx, c.skin || '#f5d6c0', false);
  oval(ctx, 0, -48.6, 1.7, 0.9, tone(c.skin || '#f5d6c0', 0.86));
  head(() => { face(ctx, { ...a, eating: P.eating }, c, st, now); hairFront(ctx, st, hair, P.sway); });
  carried(ctx, a, P);
  ctx.restore();
}

/**
 * A portrait of a person of the anime theme on its canvas (the character's sheet, ⚙ › Characters):
 * the whole figure, drawn at the canvas' real resolution.
 */
export function drawAnimePortrait(canvas, c, { id = '', bg = '#c9b48a', width = 64, height = 100, k = 3 } = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = width * k; canvas.height = height * k;
  canvas.style.imageRendering = 'auto';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, tone(bg, 1.18)); g.addColorStop(1, bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = (canvas.height * 0.96) / ANIME_HEIGHT;
  ctx.setTransform(s, 0, 0, s, canvas.width / 2, canvas.height - 2 * k);
  drawAnime(ctx, { id, role: id, cfg: c, state: 'idle', face: 0 }, 1, { x: 0, y: 0 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
