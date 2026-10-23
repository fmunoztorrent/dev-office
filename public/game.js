// Canvas renderer (browser) of the sim.js simulation.
// The world is W×H; the canvas is drawn at an integer multiple of that size so that in full screen
// the "pixels" stay crisp. There are two views of the same office, to choose from (⚙ › General,
// the ◇ button or the v key): the usual front view (the default) and the isometric top-down view
// (the floor as a rhombus, the back and left walls, furniture as volumes and people standing,
// sorted by depth; see iso.js). The back wall is glass: behind it you see the city with the real
// time, season and weather (sky.js). On top of the scene goes a subtle lighting pass (lamps, neon,
// monitors, the TV, the fire and the glow of the dreams).

import {
  createSim, W, H, SPOT, PLANTS, STATUS_ICON, PHASE_COLOR, phaseInfo, onBoard, tvChannel,
  DREAMS, DREAM_PALETTE, rainbowPixels, CAFE, DINING, DINING_SEATS, PARTITION, BATH, RACK, EXTINGUISHER, daylight,
  BOARD, EASEL, CLOCK, GLASS, TV, SOFA, ALARM, SIGN,
} from './sim.js';
import { outdoor, lightning, colorHex, weatherIcon } from './sky.js';
import { isoCamera, apply, unapply, scaled, BACK, WALL_H } from './iso.js';
import { t } from './i18n.js';
export { TEAM, PHASES, phaseInfo } from './sim.js';

const P = 3; // size of a sprite "pixel"
const FONT = '"VT323", ui-monospace, monospace';
const EMOJI = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
const hslRgb = (h, s, l) => {
  const f = (n) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `${f(0)},${f(8)},${f(4)}`;
};

/**
 * @param now   () => Date: the instant (daylight, clock, lunch). The real one by default.
 * @param zone  the office's time zone (null: the system's); changed with sim.setZone
 */
export function createGame(canvas, { onSelect, onBoardClick, onHover, now: clockNow = () => new Date(), zone = null, view = 'flat' } = {}) {
  const ctx = canvas.getContext('2d');
  let iso = view !== 'flat';
  const cam = isoCamera();
  const sim = createSim({ wall: () => clockNow().getTime(), zone });
  const { agents } = sim;
  let selected = null;
  let hover = null;
  let hoverBoard = false;
  let last = performance.now();
  let scale = 1;

  // Resolution: an integer multiple of the world, the smallest that covers the canvas's real pixels.
  function fitResolution() {
    const r = canvas.getBoundingClientRect();
    const k = Math.max(1, Math.min(4, Math.ceil((r.width * (window.devicePixelRatio || 1)) / W)));
    if (k !== scale || canvas.width !== W * k) { scale = k; canvas.width = W * k; canvas.height = H * k; }
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitResolution).observe(canvas);
  fitResolution();

  // ---------------------------------------------------------------- dibujo

  // The transform used to draw (the isometric camera's, or none), times the canvas scale.
  const ID = [1, 0, 0, 1, 0, 0];
  const use = (m) => ctx.setTransform(...scaled(m, scale));
  const FS = 1.35; // in the isometric view the sprites' texts get bigger (the sprite gets smaller)
  const fpx = (n) => Math.round(n * (iso ? FS : 1));
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const blob = (bx, by, r) => { ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); };
  /** A spot of light: a soft-falloff radial gradient (used in 'screen' mode). */
  function glow(x, y, r, rgb, a) {
    if (a <= 0.005 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.35, `rgba(${rgb},${a * 0.55})`);
    g.addColorStop(0.7, `rgba(${rgb},${a * 0.15})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const sitting = (a) => a.seated || a.perch;
  const FLOOR_TILE = 40;
  const FLOOR_TONES = ['#eef0f3', '#eaedf1', '#f1f3f5', '#e8ebef', '#edf0f2'];
  const feetY = (a) => (sitting(a) ? a.y + 14 : a.y);

  // A diagonal pole, in pixel-art steps (the easel's and the tripod's legs).
  function stick(x1, y1, x2, y2, wd, c) {
    const n = Math.max(1, Math.ceil(Math.abs(y2 - y1) / 2));
    for (let i = 0; i <= n; i++) R(x1 + ((x2 - x1) * i) / n - wd / 2, y1 + ((y2 - y1) * i) / n, wd, 2, c);
  }

  function drawRoom(t, now, light) {
    drawGlass(now, light);
    drawSign(t);
    drawBathWall();
    drawBathDoor(now);
    drawAlarm(now);
    drawTiles();
    drawRugs();
    drawCafeRoom(now);
  }

  // the sign, in vinyl on the glass
  function drawSign(t) {
    R(SIGN.x - 39, SIGN.y, 78, 44, 'rgba(14,18,34,.62)');
    R(SIGN.x - 39, SIGN.y, 78, 1, 'rgba(255,255,255,.12)');
    ctx.font = `22px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsl(${(t * 40) % 360} 85% 68%)`; ctx.fillText('DEV TEAM', SIGN.x, SIGN.y + 14);
    ctx.fillStyle = '#ffd166'; ctx.fillText('OFFICE', SIGN.x, SIGN.y + 32);
  }
  // the bathroom: a block of solid wall between the glass and the café
  function drawBathWall() {
    R(GLASS.x1, 0, CAFE.x - GLASS.x1, 122, '#2e3550');
    R(GLASS.x1, 0, 3, 116, '#262c42');
    for (let x = GLASS.x1 + 24; x < CAFE.x; x += 24) R(x, 0, 2, 116, '#333b59');
    R(0, 116, CAFE.x, 6, '#232840');
  }
  // alarm, hanging from the beam (off by default; with the fire it spins and lights up)
  function drawAlarm(now) {
    R(ALARM.x + 3, ALARM.y, 4, 3, '#1b1f33');
    R(ALARM.x, ALARM.y + 3, 10, 8, sim.fire && ['burning', 'fighting'].includes(sim.fire.phase) && Math.floor(now / 150) % 2 ? '#ff3b3b' : '#7a1f2b');
    R(ALARM.x - 1, ALARM.y + 11, 12, 2, '#1b1f33');
  }
  function drawRugs() {
    // the meeting table's rug
    R(SPOT.table.x - 130, SPOT.table.y - 52, 260, 126, '#6d597a');
    R(SPOT.table.x - 122, SPOT.table.y - 44, 244, 110, '#7f6a8c');
    // the living room rug (under the TV and the sofa)
    R(SOFA.x - 96, TV.feet - 10, 192, H - TV.feet + 6, '#5b7a8c');
    R(SOFA.x - 90, TV.feet - 4, 180, H - TV.feet - 6, '#6a8a9c');
  }

  // The office floor: large white porcelain tiles, with their grout, a light edge on each tile
  // (barely different from its neighbor, like real ones) and the window's reflection.
  function drawTiles() {
    const T = FLOOR_TILE, x1 = CAFE.x;
    for (let y = 126, row = 0; y < H; y += T, row++) {
      for (let x = 0, col = 0; x < x1; x += T, col++) {
        const w = Math.min(T, x1 - x), h = Math.min(T, H - y);
        R(x, y, w, h, FLOOR_TONES[(row * 7 + col * 3 + ((row * col) % 5)) % FLOOR_TONES.length]);
        R(x, y, w, 1, '#f9fafb'); R(x, y, 1, h, '#f6f7f9');          // light edge
        R(x + w - 1, y, 1, h, '#cfd5dc'); R(x, y + h - 1, w, 1, '#cbd1d8'); // junta
      }
    }
    // the window's light reflects on the polished floor, stronger near the glass
    const g = ctx.createLinearGradient(0, 126, 0, 300);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(GLASS.x0, 126, GLASS.x1 - GLASS.x0, 174);
    if (!iso) drawSkirting();
  }
  function drawSkirting() { R(0, 122, CAFE.x, 4, '#9aa3ae'); R(0, 125, CAFE.x, 1, '#7d8692'); } // skirting board

  // The glass wall: the landscape (sky.js) with its glass on top, between the ceiling beam and the skirting.
  function drawGlass(now, light) {
    const { shapes } = outdoor({ date: sim.date(), weather: sim.weather, light, now, x0: GLASS.x0, x1: GLASS.x1, top: GLASS.top, bottom: GLASS.bottom });
    for (const [x, y, w, h, c, a] of shapes) {
      ctx.globalAlpha = a; ctx.fillStyle = colorHex(c);
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    }
    ctx.globalAlpha = 1;
    R(GLASS.x0, 0, GLASS.x1 - GLASS.x0, GLASS.top, '#262c42');               // ceiling beam
    R(GLASS.x0, GLASS.top - 1, GLASS.x1 - GLASS.x0, 1, '#1b1f33');
    R(GLASS.x0, GLASS.bottom, GLASS.x1 - GLASS.x0, 116 - GLASS.bottom, '#3a4158'); // window sill
    R(GLASS.x0, GLASS.bottom, GLASS.x1 - GLASS.x0, 1, '#59627c');
  }

  // The bathroom: a door in the wall with its vacant/occupied sign.
  function drawBathDoor(now) {
    const { x, w } = BATH, open = now - sim.bath.doorAt < 650;
    R(x, 40, w, 82, '#1b1f33');
    if (open) {
      R(x + 4, 44, w - 8, 78, '#11131c');
      R(x + 14, 92, 18, 14, '#e9ecf5'); R(x + 12, 104, 22, 6, '#c9ccd6'); // the toilet, barely
      R(x + w - 12, 44, 8, 78, '#a9b8c4'); // the open door, edge-on
    } else {
      R(x + 4, 44, w - 8, 78, '#c9d6df');
      R(x + 8, 50, w - 16, 30, '#d8e2ea'); R(x + 8, 86, w - 16, 30, '#d8e2ea');
      R(x + w - 14, 82, 6, 3, '#6c757d');
    }
    // letrero
    R(x + 8, 22, 30, 14, '#1b1f33');
    ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8e9f1';
    ctx.fillText(t('scene.wc'), x + 23, 29);
    R(x + 42, 25, 8, 8, '#1b1f33'); R(x + 43, 26, 6, 6, sim.bath.occupant ? '#ff4d4d' : '#3ddc84');
  }

  // The café: tiles with neon, a fridge, a marble counter with an espresso machine and a display case.
  function drawCafeRoom(now) {
    drawCafeWall(now);
    drawFridge();
    drawCounter();
    drawCounterTop(now);
    drawCafeFloor();
    drawDiningFloor();
    drawPartitions();
  }

  function drawCafeWall(now) {
    const x0 = CAFE.x;
    // tiled wall
    R(x0, 0, W - x0, 122, '#1d4f53');
    for (let y = 0; y < 116; y += 8) {
      R(x0, y, W - x0, 1, '#163d40');
      for (let x = x0 + ((y / 8) % 2 ? 8 : 0); x < W; x += 16) R(x, y, 1, 8, '#163d40');
    }
    R(x0, 0, 3, 122, '#122f32');
    R(x0, 116, W - x0, 6, '#122f32');
    // neon: a cup and CAFÉ, on the left (the HUD buttons go on the right); the glow goes in the lighting pass
    const flick = Math.sin(now / 900) > 0.97 ? 0.45 : 1;
    ctx.globalAlpha = flick;
    ctx.strokeStyle = '#7ff7ff'; ctx.lineWidth = 2;
    ctx.strokeRect(784, 24, 12, 12); ctx.beginPath(); ctx.arc(797, 30, 4, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(787, 20); ctx.lineTo(789, 15); ctx.moveTo(792, 20); ctx.lineTo(794, 15); ctx.stroke();
    ctx.font = `30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffd1e8';
    ctx.fillText(t('scene.cafe'), 840, 30);
    ctx.globalAlpha = 1;
    // shelf with cups and a plant
    R(818, 72, 138, 4, '#8c5a33'); R(818, 76, 138, 2, '#5d3b20');
    [['#ffd166', 826], ['#ef476f', 838], ['#06d6a0', 850], ['#e9ecf5', 862]].forEach(([c, x]) => { R(x, 64, 8, 8, c); R(x + 8, 66, 2, 4, c); });
    R(886, 60, 10, 12, '#d9a273'); R(884, 52, 6, 10, '#3fb68b'); R(890, 48, 6, 14, '#2a9d8f'); R(894, 54, 6, 8, '#3fb68b');
    R(912, 58, 10, 14, '#c9ccd6'); R(912, 60, 10, 8, '#7a4b2a'); R(930, 58, 10, 14, '#c9ccd6'); R(930, 62, 10, 6, '#e9d8a6');
  }

  // drinks fridge
  function drawFridge() {
    const f = CAFE.fridge;
    R(f.x - 2, f.y - 2, f.w + 4, f.h + 2, '#1b1f33'); R(f.x, f.y, f.w, f.h, '#dfe4ea');
    R(f.x + 3, f.y + 4, f.w - 6, f.h - 18, '#203747');
    for (let i = 0; i < 4; i++) {
      const sy = f.y + 8 + i * 18;
      R(f.x + 3, sy + 12, f.w - 6, 1, '#8fb4c9');
      ['#ef476f', '#ffd166', '#06d6a0', '#ff9f1c'].forEach((c, j) => { if ((i + j) % 4 !== 3) R(f.x + 5 + j * 5, sy + 2, 3, 10, c); });
    }
    R(f.x + f.w - 6, f.y + 30, 2, 16, '#8d99ae');
    R(f.x + 6, f.y + f.h - 10, f.w - 12, 4, '#7ad7f0');
  }

  // the counter
  function drawCounter() {
    const c = CAFE.counter;
    R(c.x, c.top, c.w, 9, '#ece7df');
    R(c.x + 10, c.top + 3, 30, 1, '#d6cfc3'); R(c.x + 70, c.top + 5, 40, 1, '#d6cfc3');
    R(c.x, c.top + 9, c.w, 23, '#5b3a26');
    for (let x = c.x + 4; x < c.x + c.w; x += 6) R(x, c.top + 10, 1, 19, '#4a2f1f');
    R(c.x, c.top + 29, c.w, 3, '#2b2d42');
  }

  // what is on the counter: the display case, the glasses, the espresso machine and the till
  function drawCounterTop(now) {
    const c = CAFE.counter;
    // display case with cakes
    R(820, 113, 34, 3, '#c9ccd6');
    R(826, 104, 10, 9, '#f4a3c4'); R(826, 104, 10, 3, '#fff3f8'); R(840, 106, 9, 7, '#7a4b2a'); R(840, 106, 9, 2, '#f4f1de');
    ctx.strokeStyle = 'rgba(220,240,255,.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(837, 113, 16, Math.PI, 0); ctx.stroke();
    // vasos
    R(860, 104, 8, 12, '#f4f1de'); R(860, 108, 8, 3, '#2a9d8f'); R(870, 106, 8, 10, '#f4f1de'); R(870, 109, 8, 3, '#ef476f');
    // espresso machine
    const e = CAFE.espresso.x;
    R(e, 80, 42, 6, '#8d99ae'); R(e + 2, 78, 10, 2, '#e9ecf5'); R(e + 16, 78, 10, 2, '#e9ecf5');
    R(e, 86, 42, 26, '#c0c7d1'); R(e, 86, 42, 2, '#e9ecf5'); R(e + 40, 86, 2, 26, '#8d99ae');
    R(e + 4, 90, 34, 6, '#2b2d42'); R(e + 7, 92, 2, 2, '#3ddc84'); R(e + 12, 92, 2, 2, Math.floor(now / 700) % 2 ? '#ff4d4d' : '#7a1f2b');
    R(e + 8, 100, 8, 4, '#2b2d42'); R(e + 26, 100, 8, 4, '#2b2d42'); R(e + 10, 104, 4, 2, '#2b2d42'); R(e + 28, 104, 4, 2, '#2b2d42');
    R(e + 2, 112, 38, 4, '#5c636e');
    // steam when someone is ordering
    const ordering = Object.values(agents).some((a) => !a.walking && Math.abs(a.y - 150) < 3 && a.x > c.x && a.x < c.x + c.w);
    if (ordering) for (let i = 0; i < 3; i++) {
      const k = ((now / 1400 + i / 3) % 1);
      ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - k)})`;
      blob(e + 14 + Math.sin(now / 300 + i) * 4, 76 - k * 26, 3 + k * 4);
    }
    // the till's tablet
    R(936, 104, 14, 12, '#1b1f33'); R(938, 106, 10, 7, '#7ad7f0');
  }

  function drawCafeFloor() {
    const x0 = CAFE.x;
    // light oak floor, in staggered planks (up to the dining room wall)
    for (let y = 122, row = 0; y < DINING.top + 14; y += 10, row++) {
      for (let x = x0 - (row % 3) * 22; x < W; x += 66) {
        const sx = Math.max(x0, x);
        R(sx, y, Math.min(66, x + 66 - sx), 10, ['#c39062', '#bb8859', '#c8976a'][(row + Math.floor(x / 66)) % 3]);
        R(sx, y, 1, 10, '#ad7b4f');
      }
      R(x0, y, W - x0, 1, '#b5845a');
    }
    R(x0, 122, W - x0, 4, '#7d5534');
  }

  // planters that separate the café
  function drawPartitions() {
    const x0 = CAFE.x;
    for (const [y0, y1] of PARTITION) {
      R(x0 - 13, y0, 14, y1 - y0, '#3d405b'); R(x0 - 13, y0, 14, 3, '#4a4e69'); R(x0 - 11, y0 + 3, 10, y1 - y0 - 6, '#5a3e2b');
      for (let y = y0 + 4; y < y1 - 6; y += 12) { R(x0 - 15, y - 6, 8, 10, '#2a9d8f'); R(x0 - 8, y - 9, 8, 12, '#3fb68b'); }
    }
  }

  // The café's high table, with its two levels.
  function drawBistro() {
    const { x, y } = CAFE.bistro;
    ctx.fillStyle = '#00000025'; ctx.beginPath(); ctx.ellipse(x, y + 2, 26, 5, 0, 0, Math.PI * 2); ctx.fill();
    for (const sx of [x - 30, x + 30]) { R(sx - 7, y - 22, 14, 4, '#2b2d42'); R(sx - 1, y - 18, 2, 18, '#5c636e'); R(sx - 5, y - 1, 10, 2, '#5c636e'); }
    R(x - 2, y - 28, 4, 28, '#5c636e'); R(x - 9, y - 1, 18, 3, '#3a3f58');
    ctx.fillStyle = '#ece7df'; ctx.beginPath(); ctx.ellipse(x, y - 30, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d6cfc3'; ctx.fillRect(x - 20, y - 30, 40, 2);
    R(x - 6, y - 37, 6, 6, '#f4f1de'); R(x - 5, y - 35, 4, 2, '#7a4b2a'); R(x + 4, y - 36, 5, 5, '#ef476f');
  }

  // The dining room, below the café: a tiled floor and, hanging, the table's lamps.
  function drawDiningFloor(lamps = true) {
    const y0 = DINING.top + 14;
    for (let y = y0, row = 0; y < H; y += 16, row++) {
      for (let x = CAFE.x, col = 0; x < W; x += 16, col++) R(x, y, Math.min(16, W - x), Math.min(16, H - y), (row + col) % 2 ? '#e2d3b4' : '#d3bf98');
    }
    for (let y = y0; y < H; y += 16) R(CAFE.x, y, W - CAFE.x, 1, '#c4ae86');
    for (let x = CAFE.x; x < W; x += 16) R(x, y0, 1, H - y0, '#c4ae86');
    // rug under the table
    const { x, y, w } = DINING.table;
    R(x - w / 2 - 14, y - 40, w + 28, 112, '#7a3b2e'); R(x - w / 2 - 10, y - 36, w + 20, 104, '#93493a');
    for (let k = 0; k < 2; k++) R(x - w / 2 - 6, y - 32 + k * 94, w + 12, 2, '#c9824f');
    // pendant lamps (at night they light the table)
    if (lamps) for (const lx of [x - 34, x + 34]) {
      R(lx, y0, 1, y - 74 - y0, '#2b2d42');
      R(lx - 9, y - 74, 19, 3, '#2b2d42'); R(lx - 12, y - 71, 25, 6, '#3d405b'); R(lx - 4, y - 65, 9, 2, '#ffe8a3');
    }
  }

  // The wall between the café and the dining room: a skirting with glass on top, a door and the
  // vinyl sign. It goes in the depth order (it covers whoever is right behind it).
  function drawDiningWall() {
    const top = DINING.top, { x0: d0, x1: d1 } = DINING.door;
    const spans = [[CAFE.x, d0], [d1, W]];
    for (const [a, b] of spans) {
      ctx.fillStyle = 'rgba(180,220,255,.22)'; ctx.fillRect(a, top - 32, b - a, 32);
      R(a, top - 32, b - a, 2, '#5c636e');
      for (let x = a + 40; x < b - 6; x += 40) R(x, top - 32, 2, 32, '#8d99ae');
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      for (let x = a + 10; x < b - 14; x += 40) { ctx.beginPath(); ctx.moveTo(x, top - 4); ctx.lineTo(x + 8, top - 4); ctx.lineTo(x + 18, top - 30); ctx.lineTo(x + 10, top - 30); ctx.closePath(); ctx.fill(); }
      R(a, top, b - a, 3, '#efe6d2'); R(a, top + 3, b - a, 11, '#8c5a33');
      for (let x = a + 6; x < b; x += 10) R(x, top + 4, 1, 9, '#7a4b2a');
      R(a, top + 13, b - a, 1, '#5d3b20');
    }
    // door frame
    R(d0 - 3, top - 34, 3, 48, '#5c636e'); R(d1, top - 34, 3, 48, '#5c636e'); R(d0 - 3, top - 36, d1 - d0 + 6, 3, '#5c636e');
    // the sign, in vinyl on the glass
    ctx.font = `16px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1b1f33'; ctx.fillText(t('scene.dining'), (CAFE.x + d0) / 2 + 1, top - 15);
    ctx.fillStyle = '#ffd166'; ctx.fillText(t('scene.dining'), (CAFE.x + d0) / 2, top - 16);
  }

  // The dining room's long table: back chairs (with whoever sits on them, facing us), the top with
  // its tablecloth and what they eat; the front chairs are drawn later, covering whoever sits there.
  function drawDiningBackChairs() { DINING_SEATS.back.forEach((s, i) => drawDiningBackChair(s, i)); }
  function drawDiningBackChair(s, i) {
    R(s.x - 11, s.y - 36, 22, 24, '#1b1f33');
    R(s.x - 9, s.y - 34, 18, 20, ['#ffd166', '#06d6a0', '#ef476f', '#118ab2'][i % 4]);
    R(s.x - 9, s.y - 34, 18, 3, '#ffffff55');
  }
  function drawDiningTable() {
    const { x, y, w } = DINING.table;
    ctx.fillStyle = '#00000025'; ctx.beginPath(); ctx.ellipse(x, y + 40, w / 2 + 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    for (const lx of [x - w / 2 + 8, x + w / 2 - 11]) R(lx, y + 18, 3, 22, '#5d3b20');
    R(x - w / 2, y - 14, w, 28, '#f4f1ea'); R(x - w / 2, y - 14, w, 1, '#ffffff');
    for (let k = x - w / 2 + 10; k < x + w / 2; k += 20) R(k, y - 13, 1, 27, '#e7e0d2');
    R(x - w / 2, y + 14, w, 6, '#e1d9c9');
    for (let k = x - w / 2; k < x + w / 2; k += 10) R(k + 3, y + 20, 4, 2, '#e1d9c9'); // the tablecloth's edge
    drawDiningTableTop();
  }
  function drawDiningTableTop() {
    const { x, y } = DINING.table;
    // water jug, bread and a vase
    R(x - 4, y - 8, 7, 10, '#bfe3f2'); R(x - 3, y - 6, 5, 6, '#e6f6fc');
    R(x + 18, y - 4, 12, 6, '#d08c45'); R(x + 19, y - 5, 10, 2, '#e9b872');
    R(x - 26, y - 10, 4, 8, '#7ad7f0'); R(x - 27, y - 15, 6, 5, '#ef476f');
    // what the ones at the back eat (the ones at the front show their backs)
    ctx.font = `13px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const a of Object.values(agents)) {
      if (!a.perch || !a.food || a.diningSeat?.row !== 'back') continue;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(a.x, y - 4, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(a.food, a.x, y - 7);
    }
  }
  function drawDiningFrontChair(s) {
    R(s.x - 12, s.y - 24, 24, 4, '#5d3b20'); R(s.x - 11, s.y - 20, 22, 18, '#8c5a33');
    R(s.x - 8, s.y - 17, 16, 2, '#a8703f'); R(s.x - 8, s.y - 11, 16, 2, '#a8703f');
    R(s.x - 11, s.y - 2, 3, 16, '#5d3b20'); R(s.x + 8, s.y - 2, 3, 16, '#5d3b20');
  }

  // The whiteboard on its easel, with the red-dot digital clock on top.
  function drawBoard(now) {
    const { x, y, w, h } = BOARD;
    const wood = '#8c5a33', woodDark = '#5d3b20';
    // the legs: the back one peeks out below; the two front ones, at the sides of the board and spread
    // down to the floor; on top, the crossbar with the clock
    stick(x + w / 2, y + h, x + w / 2 + 4, EASEL.feet - 6, 4, woodDark);
    const [[lt, lf], [rt, rf]] = EASEL.legs;
    R(lt - 3, EASEL.top + 4, rt - lt + 6, 4, wood); R(lt - 3, EASEL.top + 8, rt - lt + 6, 1, woodDark);
    for (const [top, foot] of EASEL.legs) { stick(top, EASEL.top, foot, EASEL.feet - 2, 5, wood); R(foot - 4, EASEL.feet - 1, 8, 3, woodDark); }
    R(lt - 1, EASEL.top - 2, 3, 3, woodDark); R(rt - 1, EASEL.top - 2, 3, 3, woodDark);
    drawClock(now);
    // the board
    R(x - 4, y - 4, w + 8, h + 8, hoverBoard ? '#ffd166' : '#8d99ae');
    R(x, y, w, h, '#f8f9fa');
    ctx.font = `15px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#2b2d42';
    const board = sim.board;
    ctx.fillText(fit(board.title ? t('scene.taskTitle', { title: board.title }) : t('scene.noTask'), w - 12), x + 6, y + 3);
    const cols = [[t('scene.todo'), 'pending', '#ffe08a'], [t('scene.doing'), 'in_progress', '#9ad1ff'], [t('scene.done'), 'completed', '#a8e6a1']];
    const cw = (w - 16) / 3;
    cols.forEach(([label, status, color], i) => {
      const cx = x + 6 + i * (cw + 2);
      R(cx, y + 20, cw, 1, '#adb5bd');
      ctx.fillStyle = '#6c757d'; ctx.font = `13px ${FONT}`; ctx.fillText(label, cx + 2, y + 22);
      const items = board.todos.filter((t) => t.status === status);
      items.slice(0, 3).forEach((todo, j) => {
        const sy = y + 36 + j * 17;
        R(cx + 1, sy + 1, cw - 4, 15, '#00000022');
        R(cx, sy, cw - 4, 15, color);
        ctx.fillStyle = '#2b2d42'; ctx.font = `13px ${FONT}`;
        ctx.fillText(fit(todo.content, cw - 10), cx + 3, sy + 1);
      });
      if (items.length > 3) { ctx.fillStyle = '#6c757d'; ctx.fillText(`+${items.length - 3}`, cx + cw - 22, y + 22); }
    });
    if (hoverBoard) {
      ctx.font = `14px ${FONT}`;
      const tip = t('scene.boardTip');
      const tw = ctx.measureText(tip).width + 12;
      R(x + w - tw - 4, y + h - 20, tw, 16, '#2b2d42');
      ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(tip, x + w - tw + 2, y + h - 12);
    }
    if (board.todos.length) {
      const done = board.todos.filter((t) => t.status === 'completed').length;
      R(x, y + h - 4, w, 4, '#dee2e6');
      R(x, y + h - 4, (w * done) / board.todos.length, 4, '#2a9d8f');
    }
    // the marker tray, from leg to leg
    const ly = y + h + 4, tl = lt + ((lf - lt) * (ly - EASEL.top)) / (EASEL.feet - EASEL.top), tr = rt + ((rf - rt) * (ly - EASEL.top)) / (EASEL.feet - EASEL.top);
    R(tl, ly, tr - tl, 4, wood); R(tl, ly + 4, tr - tl, 1, woodDark);
    R(x + 18, y + h + 1, 12, 3, '#e63946'); R(x + 34, y + h + 1, 12, 3, '#3f73f0'); R(x + 50, y + h + 1, 12, 3, '#2a9d8f');
    R(x + w - 44, y + h, 18, 4, '#2b2d42'); R(x + w - 44, y + h, 18, 1, '#8d99ae');
  }

  // The clock: a matrix of red dots (5×7 per digit); the colon blinks every second.
  const DOTS = {
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['0', '0', '1', '0', '1', '0', '0'],
  };
  function drawClock() {
    const { x, y, w, h } = CLOCK;
    R(x - 2, y - 2, w + 4, h + 4, '#0b0c14');
    R(x, y, w, h, '#160a0c');
    const d = sim.date();
    const pad = (n) => String(n).padStart(2, '0');
    const chars = [...`${pad(d.getHours())}:${pad(d.getMinutes())}`];
    const pitch = 3, cols = chars.reduce((n, c) => n + DOTS[c][0].length + 1, -1);
    let ox = x + Math.round((w - cols * pitch) / 2);
    const oy = y + Math.round((h - 7 * pitch) / 2) + 1;
    const blink = d.getMilliseconds() < 500;
    for (const c of chars) {
      const g = DOTS[c];
      g.forEach((row, ry) => [...row].forEach((bit, rx) => {
        const on = bit === '1' && (c !== ':' || blink);
        R(ox + rx * pitch, oy + ry * pitch, 2, 2, on ? '#ff3b30' : '#3a1013');
      }));
      ox += (g[0].length + 1) * pitch;
    }
  }

  function fit(text, maxW) {
    text = String(text ?? '');
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function drawPerson(a, now) {
    if (a.hidden) return;
    const c = a.cfg;
    let x = a.x, y = feetY(a);
    const walking = a.walking;
    if (now < a.jumpUntil) y -= Math.abs(Math.sin(now / 120)) * 12;
    if (now < a.shakeUntil) x += Math.sin(now / 25) * 3;
    if (a.dance && !walking) x += Math.sin(now / 55) * 2; // waiting for the bathroom
    const px = (gx, gy, gw, gh, col) => R(x + gx * P, y + gy * P, gw * P, gh * P, col);
    const step = walking ? Math.sin(a.walkT * 14) : 0;

    // sombra
    if (!sitting(a)) { ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.ellipse(x, y, 14, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    // piernas
    if (!sitting(a)) {
      const dance = a.dance && !walking && Math.floor(now / 160) % 2;
      px(-3, -6 + (step > 0 || dance ? -1 : 0), 2, 6, c.pants);
      px(1, -6 + (step < 0 || (a.dance && !dance) ? -1 : 0), 2, 6, c.pants);
      px(-3, -1, 2, 1, '#222'); px(1, -1, 2, 1, '#222');
    }
    // torso
    px(-4, -13, 8, 7, c.shirt);
    px(-4, -7, 8, 1, '#00000030');
    // brazos
    const working = a.seated && a.state === 'working';
    const typing = working && Math.floor(now / 140) % 2;
    const typing2 = working && !typing;
    const eating = a.perch && a.food && Math.floor(now / 600) % 3 === 0;
    if (a.handUp) { px(-6, -19, 2, 7, c.shirt); px(-6, -20, 2, 2, c.skin); }
    else px(-6, -13 + (typing ? 1 : 0), 2, 6, c.shirt), px(-6, -7 + (typing ? 1 : 0), 2, 1, c.skin);
    if (eating) { px(4, -15, 2, 5, c.shirt); px(4, -16, 2, 1, c.skin); }
    else { px(4, -13 + (typing2 ? 1 : 0), 2, 6, c.shirt); px(4, -7 + (typing2 ? 1 : 0), 2, 1, c.skin); }
    if (a.carry === 'ext') {
      px(5, -12, 3, 8, '#d62828'); px(5, -13, 3, 1, '#2b2d42'); px(6, -12, 1, 6, '#ff6b6b');
      px(8, -13, 2, 1, '#2b2d42'); px(9, -12, 1, 2, '#2b2d42');
    } else if (a.carry) { px(5, -10, 4, 5, '#fff'); px(6, -9, 2, 1, '#adb5bd'); px(6, -7, 2, 1, '#adb5bd'); }
    // head (from behind, on the sofa: only the hair)
    if (a.back) {
      px(-3, -21, 6, 7, c.hair); px(-4, -20, 1, 4, c.hair); px(3, -20, 1, 4, c.hair);
      if (c.long) px(-4, -16, 8, 3, c.hair); else px(-2, -14, 4, 1, c.skin);
      return;
    }
    px(-1, -14, 2, 1, c.skin);
    px(-3, -20, 6, 6, c.skin);
    px(-3, -21, 6, 2, c.hair); px(-4, -20, 1, 3, c.hair); px(3, -20, 1, 3, c.hair);
    if (c.long) { px(-4, -18, 1, 5, c.hair); px(3, -18, 1, 5, c.hair); }
    if (c.beard) px(-3, -15, 6, 1, c.hair);
    const blink = Math.floor(now / 100) % 40 === 0;
    const look = walking ? (a.face || 1) : 0;
    if (c.glasses) px(-3, -18, 6, 1, '#cfe8ff');
    if (!blink) { px(-2 + (look > 0 ? 1 : 0), -18, 1, 1, '#1a1a1a'); px(1 + (look > 0 ? 1 : 0) - (look < 0 ? 1 : 0), -18, 1, 1, '#1a1a1a'); }
    if (c.glasses) px(-3, -19, 6, 1, '#2b2b2b');
    if (a.state === 'done' || now < a.jumpUntil || eating) px(-1, -16, 2, 1, '#7a2e2e');
    else if (a.state === 'blocked' || a.state === 'alarm' || a.dance) px(-1, -16, 2, 1, '#333');

    // name if walking, status icon
    if (!sitting(a)) {
      ctx.font = `${fpx(14)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#00000080'; ctx.fillText(c.name, x + 1, y - 21 * P - 1);
      ctx.fillStyle = '#fff'; ctx.fillText(c.name, x, y - 21 * P - 2);
    }
    const icon = STATUS_ICON[a.state] || (a.badges.size ? '🤖' : '');
    if (icon) {
      ctx.font = `${fpx(16)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const bob = Math.sin(now / 250) * 2;
      ctx.fillText(icon, x + 20, y - 18 * P + bob);
    }
    // what they eat at their desk
    if (a.seated && a.food) { ctx.font = `13px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.food, a.cfg.seat.x - 30, a.cfg.seat.y - 18); }
    // Label of the role "on duty" with its phase (e.g. ▶ RED), to the left of the head.
    const { turn, turnPhase } = sim;
    if (turn === a.id && turnPhase) {
      const label = `▶ ${phaseInfo(turnPhase).label}`;
      ctx.font = `${fpx(15)}px ${FONT}`;
      const w = ctx.measureText(label).width + 10, lh = fpx(15);
      const tx = x - 20 - w, ty = y - 20 * P - 1 + Math.sin(now / 300) * 1.5;
      R(tx, ty, w, lh, '#1b1f33');
      R(tx + 1, ty + 1, w - 2, lh - 2, PHASE_COLOR[turnPhase] || c.shirt);
      ctx.fillStyle = '#1b1f33'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, tx + 5, ty + lh / 2 + 1);
    }
    if (hover === a.id && selected !== a.id) {
      ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(a.x, feetY(a) + 12, 26, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // The selected one wears its green diamond on top, like in The Sims.
  function drawPlumbob(a, now) {
    if (!a || a.hidden) return;
    const x = a.x + (a.dance ? Math.sin(now / 55) * 2 : 0);
    const y = feetY(a) - 21 * P - 26 + Math.sin(now / 320) * 3;
    const w = 7 * Math.abs(Math.cos(now / 700)) + 2;
    ctx.save();
    ctx.shadowColor = 'rgba(93,255,138,.55)'; ctx.shadowBlur = 6 * scale;
    ctx.fillStyle = '#3fd16b';
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + w, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - w, y); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#b8ffcb';
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + w * 0.45, y - 2); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawChair(a) {
    const s = a.cfg.seat;
    R(s.x - 16, s.y - 40, 32, 34, '#3a3f58');
    R(s.x - 14, s.y - 38, 28, 30, '#4a5070');
  }

  function drawDesk(a, now) {
    const s = a.cfg.seat;
    // top and front
    R(s.x - 50, s.y - 14, 100, 14, '#a0703f');
    R(s.x - 50, s.y - 2, 100, 26, '#7c5230');
    R(s.x - 50, s.y - 2, 100, 3, '#5d3b20');
    drawNamePlate(a);
    drawDeskProps(a, now);
  }
  // name plate
  function drawNamePlate(a) {
    const s = a.cfg.seat, c = a.cfg;
    R(s.x - 38, s.y + 6, 76, 14, '#1b1f33');
    ctx.font = `${fpx(14)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = c.shirt; ctx.fillText(fit(`${c.name} · ${c.title}`, 72), s.x, s.y + 13);
  }
  // what is on the desk: the screens and each role's things, the keyboard and the folders
  function drawDeskProps(a, now) {
    const s = a.cfg.seat, c = a.cfg;
    const busy = a.state === 'working' || a.state === 'thinking' || a.state === 'red';

    const screen = (sx, sy, sw, sh) => {
      R(sx - 2, sy - 2, sw + 4, sh + 4, '#20232f');
      R(sx, sy, sw, sh, busy ? '#0d1b2a' : '#1d2433');
      if (busy) {
        const off = Math.floor(now / 160);
        for (let i = 0; i < Math.floor(sh / 4); i++) {
          const len = ((i * 7 + off) * 13) % (sw - 4);
          R(sx + 2 + ((i * 5) % 6), sy + 2 + i * 4, Math.max(4, len), 2, ['#06d6a0', '#ffd166', '#9ad1ff', c.shirt][(i + off) % 4]);
        }
      }
    };
    // props per role
    switch (c.prop) {
      case 'dual': screen(s.x + 14, s.y - 44, 22, 18); screen(s.x + 38, s.y - 44, 22, 18); R(s.x + 34, s.y - 24, 4, 10, '#20232f'); break;
      case 'tablet':
        screen(s.x + 22, s.y - 44, 26, 20); R(s.x + 33, s.y - 22, 4, 8, '#20232f');
        R(s.x - 44, s.y - 12, 26, 9, '#333'); R(s.x - 42, s.y - 11, 22, 7, busy ? '#c86bfa' : '#555');
        ['#ef476f', '#ffd166', '#06d6a0', '#118ab2'].forEach((col, i) => R(s.x - 14 + i * 6, s.y - 10, 4, 4, col));
        break;
      case 'terminal': screen(s.x + 20, s.y - 46, 30, 22); R(s.x + 33, s.y - 22, 4, 8, '#20232f'); break;
      case 'chart': {
        R(s.x + 18, s.y - 48, 34, 26, '#20232f'); R(s.x + 20, s.y - 46, 30, 22, '#f8f9fa');
        const k = busy ? Math.floor(now / 300) : 0;
        [8, 14, 10, 18].forEach((hgt, i) => { const hh = (hgt + ((k + i) % 3) * 2) | 0; R(s.x + 23 + i * 7, s.y - 25 - hh, 5, hh, ['#f0a73a', '#118ab2', '#06d6a0', '#ef476f'][i]); });
        R(s.x + 33, s.y - 22, 4, 8, '#20232f');
        break;
      }
      case 'qa': {
        R(s.x + 18, s.y - 48, 34, 26, '#20232f'); R(s.x + 20, s.y - 46, 30, 22, '#f8f9fa');
        const k = Math.floor(now / 400);
        for (let i = 0; i < 4; i++) {
          const fail = a.state === 'red' || (a.state === 'talking' && i === 3);
          const ok = a.state === 'done' || !busy || i < (k % 5);
          R(s.x + 23, s.y - 43 + i * 5, 3, 3, fail ? '#ef476f' : ok ? '#06d6a0' : '#ced4da');
          R(s.x + 28, s.y - 42 + i * 5, 16 - (i % 2) * 5, 1, '#adb5bd');
        }
        R(s.x + 33, s.y - 22, 4, 8, '#20232f');
        ctx.strokeStyle = '#6c757d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x - 36, s.y - 9, 5, 0, Math.PI * 2); ctx.stroke();
        R(s.x - 32, s.y - 5, 6, 2, '#6c757d');
        break;
      }
      case 'big': screen(s.x + 14, s.y - 50, 40, 28); R(s.x + 32, s.y - 22, 4, 8, '#20232f'); break;
      case 'notes':
        screen(s.x + 22, s.y - 44, 26, 20); R(s.x + 33, s.y - 22, 4, 8, '#20232f');
        ['#ffe08a', '#ff9fb2', '#9ad1ff'].forEach((col, i) => R(s.x - 44 + i * 10, s.y - 12 + (i % 2) * 2, 8, 8, col));
        break;
      case 'phone':
        screen(s.x + 22, s.y - 44, 26, 20); R(s.x + 33, s.y - 22, 4, 8, '#20232f');
        R(s.x - 42, s.y - 12, 14, 8, '#222'); R(s.x - 40, s.y - 15, 10, 4, '#444');
        R(s.x - 22, s.y - 13, 8, 9, '#fff'); R(s.x - 14, s.y - 11, 3, 4, '#fff');
        break;
    }
    R(s.x + 6, s.y - 12, 12, 4, '#2b2d42'); // teclado
    // assigned subagents: folders on the desk
    for (let i = 0; i < Math.min(3, a.badges.size); i++) {
      R(s.x - 46 + i * 4, s.y - 30 - i * 3, 18, 13, '#ffb703'); R(s.x - 46 + i * 4, s.y - 32 - i * 3, 8, 3, '#fb8500');
    }
  }

  function drawProps(now) {
    drawRack(now);
    drawExtinguisher();
    for (const [x, y] of PLANTS) drawPlant(x, y);
    drawMeetingTable();
  }

  // server rack: blinks with the backend; on fire, red; when repaired, it boots row by row
  function drawRack(now) {
    const { x: rx, y: ry } = RACK;
    const f = sim.fire;
    R(rx, ry, 42, 92, '#1b1f33'); R(rx + 2, ry + 2, 38, 88, f && f.phase !== 'done' && f.phase !== 'repair' ? '#3a2324' : '#2b2d42');
    const be = agents.backend.state === 'working';
    const booted = f?.phase === 'repair' ? Math.floor((now - f.at) / 900) : 6;
    for (let i = 0; i < 6; i++) {
      R(rx + 5, ry + 6 + i * 14, 32, 10, '#3a3f58');
      for (let j = 0; j < 3; j++) {
        let on, col;
        if (f && ['burning', 'fighting'].includes(f.phase)) { on = (Math.floor(now / 120) + i + j) % 2 === 0; col = '#ff3b3b'; }
        else if (i >= booted) { on = false; col = '#1b1f33'; }
        else { on = be ? Math.random() > 0.4 : (Math.floor(now / 900) + i + j) % 4 === 0; col = j === 2 ? '#ffd166' : '#06d6a0'; }
        R(rx + 8 + j * 5, ry + 9 + i * 14, 3, 3, on ? col : '#1b1f33');
      }
    }
    if (sim.heat > 0.75 && !f) R(rx + 2, ry + 2, 38, 3, '#ff9f1c'); // red-hot
    drawFire(now);
  }

  // the fire extinguisher, next to the rack
  function drawExtinguisher() {
    if (sim.extinguisher === 'floor') {
      const { x, y } = EXTINGUISHER;
      R(x - 5, y - 24, 10, 24, '#d62828'); R(x - 4, y - 22, 2, 18, '#ff6b6b'); R(x - 5, y - 14, 10, 5, '#f4f1de');
      R(x - 3, y - 28, 6, 4, '#2b2d42'); R(x + 3, y - 27, 5, 2, '#2b2d42'); R(x + 6, y - 25, 2, 12, '#2b2d42');
    }
  }

  function drawPlant(x, y) {
    R(x - 10, y - 14, 20, 16, '#b5651d');
    R(x - 14, y - 34, 10, 20, '#2a9d8f'); R(x - 2, y - 42, 10, 28, '#3fb68b'); R(x + 6, y - 30, 10, 16, '#2a9d8f');
  }

  function drawMeetingTable() {
    // meeting table
    ctx.fillStyle = '#5d3b20'; ctx.beginPath(); ctx.ellipse(SPOT.table.x, SPOT.table.y + 4, 84, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8c5a33'; ctx.beginPath(); ctx.ellipse(SPOT.table.x, SPOT.table.y, 84, 24, 0, 0, Math.PI * 2); ctx.fill();
    R(SPOT.table.x - 20, SPOT.table.y - 8, 14, 10, '#fff'); R(SPOT.table.x + 12, SPOT.table.y - 4, 8, 8, '#e07a5f');
  }

  // The sofa, from behind: you see the backrest (and above it, the ones watching TV).
  function drawSofa() {
    const { x, y } = SOFA;
    R(x - 72, y - 8, 12, 36, '#2c5470'); R(x + 60, y - 8, 12, 36, '#2c5470');
    R(x - 72, y - 8, 12, 3, '#3a6a88'); R(x + 60, y - 8, 12, 3, '#3a6a88');
    R(x - 64, y - 2, 128, 30, '#3a6a88');
    R(x - 64, y - 2, 128, 3, '#4f86a6');
    R(x - 22, y + 3, 1, 22, '#2c5470'); R(x + 21, y + 3, 1, 22, '#2c5470');
    R(x - 68, y + 28, 4, 4, '#2b2d42'); R(x + 64, y + 28, 4, 4, '#2b2d42');
  }

  // The TV on its tripod: what is on depends on what is happening (the weather, the team news,
  // football if someone is watching, or breaking news if the server catches fire).
  function drawTV(now) {
    const { x, feet, w, h } = TV;
    const top = feet - 18 - h;
    const dark = '#1b1d27';
    R(x - 3, top + h - 2, 6, 9, dark);
    stick(x, top + h + 6, x - 28, feet, 3, dark);
    stick(x, top + h + 6, x + 28, feet, 3, dark);
    stick(x, top + h + 6, x + 4, feet - 6, 2, '#2b2d3a');
    R(x - w / 2, top, w, h, '#111219');
    R(x - w / 2, top, w, 1, '#3a3d4c');
    R(x - w / 2, top + h - 1, w, 1, '#06070b');
    const sx = x - w / 2 + 3, sy = top + 3, sw = w - 6, sh = h - 9;
    ctx.save();
    ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
    drawChannel(tvChannel(sim, now), sx, sy, sw, sh, now);
    ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(sx + sw * 0.55, sy); ctx.lineTo(sx + sw, sy); ctx.lineTo(sx + sw, sy + sh * 0.5); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    R(x + w / 2 - 7, top + h - 4, 2, 2, '#3ddc84');
  }

  // What is on TV. The measures are meant for a 35 px tall screen: `u` scales them.
  function drawChannel(ch, x, y, w, h, now) {
    const u = h / 35, k = (v) => Math.round(v * u);
    const text = (str, tx, ty, size, color, align = 'left') => {
      ctx.font = `${k(size)}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(str, tx, ty);
    };
    if (ch === 'breaking') {
      R(x, y, w, h, Math.floor(now / 400) % 2 ? '#9d0208' : '#6a040f');
      R(x, y + k(4), w, k(9), '#ffd166');
      text(t('scene.tvBreaking'), x + w / 2, y + k(9), 12, '#6a040f', 'center');
      ctx.font = `${k(14)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.fillText('🔥', x + k(12), y + k(23));
      text(t('scene.tvServer'), x + w / 2 + k(6), y + k(23), 13, '#ffffff', 'center');
      return;
    }
    if (ch === 'sports') {
      R(x, y, w, h, '#2f8f46');
      for (let c = 0; c < w; c += k(12)) R(x + c, y, k(6), h, '#33994b');
      R(x + w / 2, y, 1, h, '#e9f5ec'); ctx.strokeStyle = '#e9f5ec'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + w / 2 + 0.5, y + h / 2, k(7), 0, Math.PI * 2); ctx.stroke();
      const bx = x + w / 2 + Math.sin(now / 700) * (w / 2 - k(8)), by = y + h / 2 + Math.sin(now / 430) * (h / 2 - k(5));
      R(x + w / 2 - k(14) + Math.sin(now / 600) * k(10), y + k(8) + Math.cos(now / 800) * k(4), k(3), k(4), '#e63946');
      R(x + w / 2 + k(12) + Math.cos(now / 650) * k(10), y + h - k(12) + Math.sin(now / 750) * k(4), k(3), k(4), '#3f73f0');
      R(bx, by, k(2), k(2), '#ffffff');
      R(x + 2, y + 2, k(22), k(9), '#0b0c14cc'); text('1-0', x + 2 + k(11), y + 2 + k(5), 11, '#ffffff', 'center');
      return;
    }
    if (ch === 'news') {
      R(x, y, w, h, '#1d3557');
      R(x, y, w, k(9), '#e63946'); text(t('scene.tvNews'), x + 3, y + k(5), 11, '#ffffff');
      R(x + k(10), y + k(13), k(10), k(8), '#e0ac7e'); R(x + k(9), y + k(12), k(12), k(3), '#2b1b12'); R(x + k(7), y + k(21), k(16), k(6), '#457b9d'); // the presenter
      R(x + k(28), y + k(14), w - k(32), k(2), '#a8dadc'); R(x + k(28), y + k(19), w - k(40), k(2), '#a8dadc55');
      R(x, y + h - k(8), w, k(8), '#e9ecf5');
      const news = sim.board.title ? t('scene.tvLive', { title: sim.board.title }) : (sim.journal.at(-1)?.text || t('scene.tvQuiet'));
      ctx.font = `${k(11)}px ${FONT}`;
      const tw = ctx.measureText(news).width;
      text(news, x + w - ((now / 28) % (tw + w)), y + h - k(4), 11, '#1d3557');
      return;
    }
    // the weather (the same one seen through the glass)
    const wth = sim.weather, light = daylight(sim.date(), wth);
    const bg = light.night > 0.5 ? '#141c40' : { clear: '#4a92d8', partly: '#5a95cc', cloudy: '#6f7a8a', fog: '#8d96a3', drizzle: '#55657a', rain: '#4a5568', snow: '#8fa6bf', storm: '#2d3340' }[wth.kind];
    R(x, y, w, h, bg);
    R(x, y, w, k(9), '#0b0c1499'); text(t('scene.tvWeather'), x + 3, y + k(5), 11, '#ffd166');
    ctx.font = `${k(16)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(weatherIcon(wth, light.night), x + k(15), y + k(21));
    text(Number.isFinite(wth.temp) ? `${Math.round(wth.temp)}°` : '--', x + w - k(6), y + k(21), 20, '#ffffff', 'right');
  }




  // Pixel-art flames over the rack: three layers (red, orange, yellow) that flicker.
  function drawFire(now) {
    const f = sim.fire;
    if (!f || f.level <= 0) return;
    const { x: rx, y: ry, w } = RACK;
    const L = f.level;
    const flame = (fx, base, hgt, wd = 5) => {
      if (hgt <= 2) return;
      R(fx, base - hgt, wd, hgt, '#e63946');
      R(fx + 1, base - hgt * 0.72, wd - 2, hgt * 0.72, '#ff9f1c');
      R(fx + 1, base - hgt * 0.38, wd - 2, hgt * 0.38, '#ffd166');
    };
    // the crown over the rack
    for (let i = 0; i < 13; i++) {
      const n = Math.sin(now / 90 + i * 1.7) + Math.sin(now / 53 + i * 0.9);
      flame(rx - 10 + i * 5, ry + 8, L * (34 + 12 * n + (i % 3) * 7) * (1 - Math.abs(i - 6) / 9));
    }
    // tongues coming out of the trays
    for (let row = 0; row < 3; row++) {
      for (let j = 0; j < 3; j++) {
        const n = Math.sin(now / 70 + row * 2.1 + j * 1.3);
        flame(rx + 6 + j * 12, ry + 18 + row * 14, L * (9 + 5 * n) * (row < 2 || L > 0.6 ? 1 : 0), 4);
      }
    }
    // on the sides
    for (const [sx, k] of [[rx - 5, 0], [rx + w + 1, 1]]) flame(sx, ry + 34, L * (20 + 7 * Math.sin(now / 70 + k * 3)), 4);
  }

  // The extinguisher's jet: a cone of foam from the nozzle to the fire.
  function drawSpray(now) {
    const f = sim.fire;
    if (f?.phase !== 'fighting' || f.sprinklers) return;
    const a = agents[f.fighter];
    if (a.carry !== 'ext' || a.walking) return;
    const nx = a.x + 27, ny = a.y - 37, tx = RACK.x + RACK.w / 2, ty = RACK.y + 30;
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(now / 40);
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx - 16, ty - 10); ctx.lineTo(tx + 16, ty + 12); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // What they imagine: a glowing thought cloud (unicorn, rainbow, skull or pizza).
  const RAINBOW = rainbowPixels(9);
  const BLOBS = [[-28, 4, 18], [-10, -10, 20], [12, -12, 20], [30, 2, 18], [8, 10, 18], [-14, 12, 16]];
  function drawDream(a, now) {
    const d = a.dream;
    if (!d || now > d.until || a.hidden) return;
    const info = DREAMS[d.kind];
    const x = a.x;
    const head = feetY(a) - 21 * P;
    const k = Math.min(1, (now - d.start) / 350, (d.until - now) / 400); // fades in and out
    if (k <= 0) return;
    const cx = Math.max(52, Math.min(W - 52, x + 62)), cy = Math.max(46, head - 34 + Math.sin(now / 400) * 3);
    const rgb = d.kind === 'rainbow' ? hslRgb((now / 6) % 360, 0.9, 0.6) : rgbOf(info.glow);
    // glow: a faint halo that breathes behind the cloud
    const pulse = 0.92 + 0.08 * Math.sin(now / 420);
    ctx.globalCompositeOperation = 'screen';
    glow(cx, cy, 72 * pulse, rgb, 0.2 * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = k;
    // little bubbles from the head to the cloud, with a lit edge
    ctx.save();
    ctx.shadowColor = `rgba(${rgb},.5)`; ctx.shadowBlur = 7 * scale;
    ctx.fillStyle = '#2b2d42';
    blob(x + 12, head - 2, 4.5); blob(x + 24, head - 12, 6.5);
    for (const [bx, by, r] of BLOBS) blob(cx + bx, cy + by, r + 2);
    ctx.restore();
    ctx.fillStyle = info.cloud;
    blob(x + 12, head - 2, 3); blob(x + 24, head - 12, 5);
    for (const [bx, by, r] of BLOBS) blob(cx + bx, cy + by, r);
    if (info.sprite) {
      const U = 4; // a bit bigger than the characters: it is a dream
      const sp = info.sprite;
      const hop = d.kind === 'unicorn' ? Math.abs(Math.sin(now / 160)) * 3 : d.kind === 'skull' ? Math.sin(now / 90) * 1.2 : Math.sin(now / 300) * 2;
      const ox = cx - (sp[0].length * U) / 2 + (d.kind === 'skull' ? Math.sin(now / 47) : 0), oy = cy - (sp.length * U) / 2 - hop;
      sp.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch !== '.') R(ox + rx * U, oy + ry * U, U, U, DREAM_PALETTE[ch]); }));
      if (d.kind === 'skull') { // glowing eyes
        ctx.globalCompositeOperation = 'screen';
        for (const ex of [3.5, 9.5]) glow(ox + ex * U, oy + 4 * U, 6, '160,108,255', 0.45 * k);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      const ox = cx, oy = cy + 12;
      for (const [dx, dy, col] of RAINBOW) R(ox + dx * P, oy + dy * P, P, P, col);
      for (const ex of [-9, 9]) { R(ox + ex * P - 7, oy - 2, 14, 6, '#e9ecf5'); R(ox + ex * P - 4, oy - 6, 8, 5, '#e9ecf5'); }
    }
    ctx.globalAlpha = 1;
  }

  function drawBubble(a, now) {
    const b = a.bubble;
    if (!b || a.hidden) return;
    const x = a.x;
    const y = feetY(a) - 22 * P - 8;
    ctx.font = `${fpx(16)}px ${FONT}`;
    const lh = fpx(15);
    const lines = wrap(b.text, fpx(176), 3);
    const w = Math.min(fpx(190), Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14);
    const h = lines.length * lh + 8;
    const bx = iso ? x - w / 2 : Math.max(4, Math.min(W - w - 4, x - w / 2)), by = iso ? y - h : Math.max(4, y - h);
    const fade = Math.min(1, (b.until - now) / 300);
    ctx.globalAlpha = Math.max(0, fade);
    const border = b.tone === 'error' ? '#e63946' : b.tone === 'warn' ? '#f4a261' : '#2b2d42';
    R(bx - 2, by - 2, w + 4, h + 4, border);
    R(bx, by, w, h, b.tone === 'error' ? '#ffe5e5' : b.tone === 'warn' ? '#fff3e0' : '#ffffff');
    R(Math.max(bx + 6, Math.min(bx + w - 12, x - 4)), by + h, 8, 4, border);
    ctx.fillStyle = '#2b2d42'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 4 + i * lh));
    ctx.globalAlpha = 1;
  }

  function wrap(text, maxW, maxLines) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = fit(lines[maxLines - 1] + ' …', maxW);
    return lines.map((l) => fit(l, maxW));
  }

  function drawParticles(list = sim.particles) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of list) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      if (p.kind === 'code') { ctx.font = `16px ${FONT}`; ctx.fillStyle = p.color; ctx.fillText(p.ch, p.x, p.y); }
      else if (p.kind === 'bug') { ctx.font = `16px ${EMOJI}`; ctx.fillText('🐞', p.x, p.y); }
      else if (p.kind === 'check') { ctx.font = `18px ${FONT}`; ctx.fillStyle = '#06d6a0'; ctx.fillText('✓', p.x, p.y); }
      else if (p.kind === 'sparkle') {
        ctx.save(); ctx.shadowColor = p.color; ctx.shadowBlur = 4 * scale;
        ctx.font = `18px ${FONT}`; ctx.fillStyle = p.color; ctx.fillText(p.ch, p.x, p.y);
        ctx.restore();
      } else if (p.kind === 'emote') { ctx.font = `18px ${EMOJI}`; ctx.fillText(p.ch, p.x, p.y); }
      else if (p.kind === 'smoke') { ctx.globalAlpha = Math.min(0.55, p.life / 4); ctx.fillStyle = p.color; blob(p.x, p.y, 4 + p.size * 6); }
      else if (p.kind === 'foam') { ctx.fillStyle = '#ffffff'; blob(p.x, p.y, 3 * p.size + 2); }
      else if (p.kind === 'drop') R(p.x, p.y, 1, 5, p.color);
      else R(p.x, p.y, p.kind === 'confetti' ? 4 + Math.sin(p.rot) * 2 : 3, p.kind === 'confetti' ? 6 : 3, p.color);
    }
    ctx.globalAlpha = 1;
  }

  // The lighting pass. At night the office lights stay on: the color only cools down a little
  // (multiply) and the light sources add a faint glow (screen).
  function drawLights(now, light) {
    const [sr, sg, sb] = light.shade;
    if (sr + sg + sb < 2.995) {
      ctx.globalCompositeOperation = 'multiply';
      R(0, 0, W, H, `rgb(${Math.round(sr * 255)},${Math.round(sg * 255)},${Math.round(sb * 255)})`);
    }
    ctx.globalCompositeOperation = 'screen';
    const n = light.night;
    const flick = Math.sin(now / 900) > 0.97 ? 0.6 : 1;
    // the café's neon and the light under the shelf
    glow(840, 30, 60, '255,95,162', (0.1 + n * 0.1) * flick);
    glow(791, 29, 24, '127,247,255', (0.1 + n * 0.1) * flick);
    const g = ctx.createLinearGradient(0, 78, 0, 120);
    g.addColorStop(0, `rgba(255,200,120,${0.1 + n * 0.1})`); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.fillRect(818, 78, 138, 42);
    glow(CAFE.fridge.x + 14, 100, 38, '150,215,255', 0.04 + n * 0.08);
    // the dining room lamps, warm at night
    for (const lx of [DINING.table.x - 34, DINING.table.x + 34]) glow(lx, DINING.table.y - 52, 70, '255,206,140', 0.03 + n * 0.11);
    // the bathroom sign, the dot clock and the TV
    glow(BATH.x + 46, 29, 12, sim.bath.occupant ? '255,60,60' : '60,255,120', 0.25);
    glow(CLOCK.x + CLOCK.w / 2, CLOCK.y + CLOCK.h / 2, 48, '255,59,48', 0.04 + n * 0.05);
    const tvRgb = { breaking: '255,60,40', sports: '80,200,110', news: '90,140,220', weather: '150,190,255' }[tvChannel(sim, now)];
    glow(TV.x, TV.feet - 18 - TV.h / 2, 84, tvRgb, 0.04 + n * 0.08);
    // the light coming through the glass: by day, a warm strip on the floor (more golden at sunset)
    if (light.alt > 0) {
      const a = Math.min(1, light.alt * 2.5) * (1 - light.gloom * 0.8);
      const sun = ctx.createLinearGradient(0, 116, 0, 230);
      sun.addColorStop(0, `rgba(255,${Math.round(236 - 50 * light.dusk)},${Math.round(200 - 90 * light.dusk)},${0.07 * a})`);
      sun.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = sun; ctx.fillRect(GLASS.x0, 116, GLASS.x1 - GLASS.x0, 114);
    }
    // monitores
    for (const a of Object.values(agents)) {
      const busy = ['working', 'thinking', 'red'].includes(a.state);
      if (busy || n > 0.3) glow(a.cfg.seat.x + 34, a.cfg.seat.y - 34, 34, a.state === 'red' ? '255,80,100' : '120,190,255', (busy ? 0.06 : 0.02) + n * 0.06);
    }
    // the office sign
    glow(SIGN.x, SIGN.y + 22, 56, '255,209,102', 0.03 + n * 0.05);
    // the fire: flickering orange light and the alarm spinning
    const f = sim.fire;
    if (f) {
      const cx = RACK.x + RACK.w / 2;
      if (f.level > 0) {
        glow(cx, RACK.y + 10, 70 + 130 * f.level, '255,120,30', (0.3 + 0.06 * Math.sin(now / 70) + 0.03 * Math.sin(now / 23)) * f.level);
        glow(cx, RACK.y - 6, 36, '255,220,120', 0.25 * f.level);
      }
      if (['burning', 'fighting'].includes(f.phase)) glow(ALARM.x + 5, ALARM.y + 7, 34, '255,40,40', 0.15 + 0.2 * Math.max(0, Math.sin(now / 110)));
    }
    ctx.globalCompositeOperation = 'source-over';
    // with the fire, the office turns red in pulses
    if (f && ['burning', 'fighting'].includes(f.phase)) R(0, 0, W, H, `rgba(255,40,20,${0.03 + 0.02 * Math.sin(now / 160)})`);
    // lightning lights up the office for an instant
    const bolt = lightning(now, sim.weather);
    if (bolt.flash > 0) R(0, 0, W, H, `rgba(220,230,255,${0.08 * bolt.flash})`);
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.6, W / 2, H / 2, W * 0.66);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function drawBanner(now) {
    const banner = sim.banner;
    if (!banner) return;
    const colors = { warn: ['#f4a261', '#2b2d42'], done: ['#2a9d8f', '#fff'], chat: ['#3f73f0', '#fff'], fire: ['#e85d04', '#fff'] }[banner.tone] || ['#2b2d42', '#fff'];
    const pulse = banner.tone === 'warn' || banner.tone === 'fire' ? 0.85 + Math.sin(now / 200) * 0.15 : 1;
    ctx.globalAlpha = pulse;
    R(0, H - 34, W, 34, colors[0]);
    ctx.globalAlpha = 1;
    ctx.font = `20px ${FONT}`; ctx.fillStyle = colors[1]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fit(banner.text, W - 260), W / 2, H - 17);
  }

  // ---------------------------------------------------------------- the isometric view
  //
  // The same office, seen from the front-right corner (iso.js). The floor, the rugs and the back
  // wall are the flat view's art with another transform; furniture is volumes (top, front and
  // side) and people are standing sprites sorted by depth along with everything else.

  const SP = cam.sprite;
  const poly = (pts, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  /** A volume of x0..x1 by y0..y1 (on the floor) and h tall (from z0): its top, its front and its side. */
  function box(x0, y0, x1, y1, h, { top, front, side, edge }, z0 = 0) {
    use(ID);
    const p = (x, y, z) => cam.proj(x, y, z);
    poly([p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z0 + h), p(x0, y1, z0 + h)], front);
    poly([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z0 + h), p(x1, y0, z0 + h)], side);
    poly([p(x0, y0, z0 + h), p(x1, y0, z0 + h), p(x1, y1, z0 + h), p(x0, y1, z0 + h)], top);
    if (edge) { // a light edge on the top's front border
      ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...p(x0, y1, z0 + h)); ctx.lineTo(...p(x1, y1, z0 + h)); ctx.stroke();
    }
  }
  const shadowAt = (x, y, rx, ry) => { use(cam.floor(0)); ctx.fillStyle = '#00000022'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };

  // where each person stands (or sits) on the floor
  function anchor(a) {
    if (a.seated) return [a.cfg.seat.x, a.cfg.seat.y - 26];
    return [a.x, a.y];
  }
  /** The matrix a person is drawn with (and what goes above them: bubble, dream, diamond). */
  function personM(a) {
    if (!iso) return ID;
    const [x, y] = anchor(a);
    return cam.billboard(a.x, feetY(a), x, y);
  }
  const BOARD_M = () => cam.front(EASEL.feet);

  function drawIsoRoom(t, now, light) {
    use(ID);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1e33'); bg.addColorStop(1, '#0f1220');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const P0 = (x, y, z = 0) => cam.proj(x, y, z);
    // the floor: a rhombus with its model-like thickness on the two front edges
    const slab = 12;
    poly([P0(0, H), P0(W, H), P0(W, BACK), [P0(W, BACK)[0], P0(W, BACK)[1] + slab], [P0(W, H)[0], P0(W, H)[1] + slab], [P0(0, H)[0], P0(0, H)[1] + slab]], '#23283f');
    poly([P0(W, H), P0(W, BACK), [P0(W, BACK)[0], P0(W, BACK)[1] + slab], [P0(W, H)[0], P0(W, H)[1] + slab]], '#1b1f33');
    ctx.save();
    use(cam.floor(0));
    ctx.beginPath(); ctx.rect(0, BACK, W, H - BACK); ctx.clip();
    drawTiles();
    drawRugs();
    drawCafeFloor();
    drawDiningFloor(false);
    ctx.restore();
    // the left wall (x = 0): plain, with its skirting, two pictures and a door
    const side = (u0, v0, u1, v1, color) => poly([P0(0, u0, v0), P0(0, u1, v0), P0(0, u1, v1), P0(0, u0, v1)], color);
    use(ID);
    side(BACK, 0, H, WALL_H, '#2b3150');
    side(BACK, WALL_H - 6, H, WALL_H, '#232840');
    side(BACK, 0, H, 5, '#9aa3ae');
    side(BACK, 0, H, 1, '#7d8692');
    side(170, 30, 250, 92, '#1b1f33'); side(174, 34, 246, 88, '#3f73f0'); side(186, 46, 234, 76, '#ffd166');  // a picture
    side(290, 40, 340, 86, '#1b1f33'); side(294, 44, 336, 82, '#e9ecf5'); side(300, 56, 330, 60, '#2a9d8f'); side(300, 66, 322, 70, '#ef476f');
    side(430, 0, 492, 96, '#1b1f33'); side(434, 0, 488, 92, '#8c5a33'); side(476, 44, 482, 50, '#ffd166');      // the door
    // the back wall: the window with the city, the sign, the bathroom, the alarm and the café
    ctx.save();
    use(cam.front(BACK));
    ctx.beginPath(); ctx.rect(0, 0, W, BACK); ctx.clip();
    drawGlass(now, light);
    drawSign(t);
    drawBathWall();
    drawBathDoor(now);
    drawAlarm(now);
    drawCafeWall(now);
    drawSkirting();
    R(CAFE.x, 122, W - CAFE.x, 4, '#122f32');
    ctx.restore();
    // the corner where the two walls meet
    use(ID);
    ctx.strokeStyle = '#151827'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(...P0(0, BACK, 0)); ctx.lineTo(...P0(0, BACK, WALL_H)); ctx.stroke();
  }

  // the office chair: wheeled base, seat and backrest (the backrest stays behind whoever sits)
  function isoChair(s) {
    use(cam.floor(0)); ctx.fillStyle = '#2b2d42'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 38, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
    box(s.x - 2, s.y - 40, s.x + 2, s.y - 36, 12, { top: '#5c636e', front: '#5c636e', side: '#3d4250' });
    box(s.x - 13, s.y - 46, s.x + 13, s.y - 30, 5, { top: '#5a6185', front: '#4a5070', side: '#3a3f58' }, 12);
    box(s.x - 12, s.y - 48, s.x + 12, s.y - 44, 22, { top: '#6b7398', front: '#5a6185', side: '#4a5070' }, 17);
  }

  function isoDesk(a, now) {
    const s = a.cfg.seat;
    shadowAt(s.x, s.y + 4, 56, 26);
    box(s.x - 50, s.y - 18, s.x + 50, s.y + 18, 26, { top: '#a0703f', front: '#7c5230', side: '#5d3b20', edge: '#c08a52' });
    use(cam.front(s.y + 18, s.y + 24));
    drawNamePlate(a);
    use(cam.front(s.y - 6, s.y - 12, 26));
    drawDeskProps(a, now);
  }

  function isoRack(now) {
    const { x, y, w, h } = RACK, gy = y + h;
    box(x, gy - 22, x + w, gy, h, { top: '#2b2d42', front: '#1b1f33', side: '#151827' });
    use(cam.front(gy, gy));
    drawRack(now);
  }

  function isoMeetingTable() {
    const { x, y } = SPOT.table;
    shadowAt(x, y + 6, 92, 48);
    box(x - 10, y - 8, x + 10, y + 8, 18, { top: '#5d3b20', front: '#4a2f1f', side: '#3d2618' });
    use(cam.floor(18)); ctx.fillStyle = '#5d3b20'; ctx.beginPath(); ctx.ellipse(x, y, 86, 46, 0, 0, Math.PI * 2); ctx.fill();
    use(cam.floor(22)); ctx.fillStyle = '#8c5a33'; ctx.beginPath(); ctx.ellipse(x, y, 84, 44, 0, 0, Math.PI * 2); ctx.fill();
    R(x - 30, y - 16, 22, 16, '#ffffff'); R(x + 18, y - 4, 10, 10, '#e07a5f'); R(x - 4, y + 14, 18, 12, '#ffe08a');
  }

  function isoSofa() {
    const { x, y } = SOFA;
    shadowAt(x, y + 2, 80, 26);
    box(x - 64, y - 20, x + 64, y + 14, 16, { top: '#4f86a6', front: '#3a6a88', side: '#2c5470' });
    box(x - 64, y + 8, x + 64, y + 20, 38, { top: '#4f86a6', front: '#3a6a88', side: '#2c5470', edge: '#6aa0c0' });
    for (const ax of [x - 74, x + 64]) box(ax, y - 22, ax + 10, y + 20, 26, { top: '#3a6a88', front: '#2c5470', side: '#244860' });
  }

  // a section of planter (the planters that separate the café go in sections)
  function isoPartition(y0, y1) {
    const x0 = CAFE.x;
    box(x0 - 14, y0, x0, y1, 16, { top: '#5a3e2b', front: '#3d405b', side: '#4a4e69' });
    use(ID);
    for (let y = y0 + 8; y < y1 - 2; y += 14) {
      const [X, Y] = cam.proj(x0 - 7, y, 16);
      R(X - 7, Y - 12, 7, 12, '#2a9d8f'); R(X - 1, Y - 16, 7, 16, '#3fb68b'); R(X + 4, Y - 9, 5, 9, '#2a9d8f');
    }
  }

  function isoCafe(now) {
    const f = CAFE.fridge, c = CAFE.counter;
    box(f.x - 2, BACK + 2, f.x + f.w + 2, BACK + 24, f.h, { top: '#c9ccd6', front: '#dfe4ea', side: '#b8c0c8' });
    use(cam.front(BACK + 24, f.y + f.h));
    drawFridge();
    box(c.x, BACK + 2, c.x + c.w, BACK + 26, 32, { top: '#ece7df', front: '#5b3a26', side: '#4a2f1f', edge: '#ffffff' });
    use(cam.front(BACK + 26, c.top + 32));
    drawCounter();
    use(cam.front(BACK + 14, c.top, 32));
    drawCounterTop(now);
  }

  function isoDiningTable() {
    const { x, y, w } = DINING.table;
    shadowAt(x, y + 4, w / 2 + 10, 30);
    for (const [lx, ly] of [[x - w / 2 + 6, y - 14], [x + w / 2 - 9, y - 14], [x - w / 2 + 6, y + 16], [x + w / 2 - 9, y + 16]]) box(lx, ly, lx + 3, ly + 3, 22, { top: '#5d3b20', front: '#5d3b20', side: '#4a2f1f' });
    box(x - w / 2, y - 20, x + w / 2, y + 22, 6, { top: '#f4f1ea', front: '#e1d9c9', side: '#d6cdbb', edge: '#ffffff' }, 22);
    use(cam.front(y, y + 2, 28));
    drawDiningTableTop();
  }

  function isoLamps() {
    const { x, y } = DINING.table;
    use(ID);
    for (const lx of [x - 34, x + 34]) {
      const [X, Y] = cam.proj(lx, y, 112);
      R(X, Y - 26, 1, 26, '#2b2d42');
      R(X - 6, Y, 13, 2, '#2b2d42'); R(X - 8, Y + 2, 17, 4, '#3d405b'); R(X - 3, Y + 6, 7, 2, '#ffe8a3');
    }
  }

  /** What is in the office, in occlusion order (back to front). */
  function isoItems(now) {
    const items = [];
    const add = (x, y, fn) => items.push({ d: cam.depth(x, y), fn });
    const at = (m, fn) => () => { use(m); fn(); };
    for (const a of Object.values(agents)) {
      const s = a.cfg.seat;
      add(s.x, s.y - 44, () => isoChair(s));
      add(s.x, s.y + 4, () => isoDesk(a, now));
      if (!a.hidden) { const [x, y] = anchor(a); add(x, y, at(personM(a), () => drawPerson(a, now))); }
    }
    add(BOARD.x + BOARD.w / 2, EASEL.feet, at(BOARD_M(), () => drawBoard(now)));
    add(RACK.x + RACK.w / 2, RACK.y + RACK.h - 10, () => isoRack(now));
    if (sim.extinguisher === 'floor') add(EXTINGUISHER.x, EXTINGUISHER.y, at(cam.billboard(EXTINGUISHER.x, EXTINGUISHER.y, EXTINGUISHER.x, EXTINGUISHER.y), drawExtinguisher));
    for (const [x, y] of PLANTS) add(x, y, at(cam.billboard(x, y, x, y), () => drawPlant(x, y)));
    add(SPOT.table.x, SPOT.table.y, isoMeetingTable);
    add(TV.x, TV.feet, at(cam.front(TV.feet), () => drawTV(now)));
    add(SOFA.x, SOFA.y + 14, isoSofa);
    for (const [y0, y1] of PARTITION) for (let y = y0; y < y1; y += 36) { const a = y, b = Math.min(y1, y + 36); add(CAFE.x, (a + b) / 2, () => isoPartition(a, b)); }
    add(CAFE.x + 60, BACK + 14, () => isoCafe(now));
    add(CAFE.bistro.x, CAFE.bistro.y, at(cam.billboard(CAFE.bistro.x, CAFE.bistro.y, CAFE.bistro.x, CAFE.bistro.y), drawBistro));
    add(CAFE.x + 90, DINING.top + 14, at(cam.front(DINING.top + 14), drawDiningWall));
    DINING_SEATS.back.forEach((s, i) => add(s.x, s.y - 12, at(cam.billboard(s.x, s.y - 12, s.x, s.y - 12), () => drawDiningBackChair(s, i))));
    add(DINING.table.x, DINING.table.y, isoDiningTable);
    for (const s of DINING_SEATS.front) add(s.x, s.y + 14, at(cam.billboard(s.x, s.y + 14, s.x, s.y + 14), () => drawDiningFrontChair(s)));
    add(DINING.table.x, DINING.table.y + 30, isoLamps);
    items.sort((p, q) => p.d - q.d).forEach((i) => i.fn());
  }

  // The extinguisher's jet, from the nozzle (on the person) to the fire (on the rack's front).
  function drawSprayIso(now) {
    const f = sim.fire;
    if (f?.phase !== 'fighting' || f.sprinklers) return;
    const a = agents[f.fighter];
    if (a.carry !== 'ext' || a.walking) return;
    const [nx, ny] = apply(personM(a), a.x + 27, a.y - 37);
    const [tx, ty] = apply(cam.front(RACK.y + RACK.h), RACK.x + RACK.w / 2, RACK.y + 30);
    use(ID);
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(now / 40);
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx - 10, ty - 8); ctx.lineTo(tx + 10, ty + 8); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Particles are born where the simulation puts them (over the desks, the heads): they stand on
  // the floor a little further forward and at that height.
  function drawParticlesIso() {
    for (const p of sim.particles) {
      use(cam.billboard(p.x, p.y, p.x, p.y + 40, 40));
      drawParticles([p]);
    }
    use(ID);
  }

  // The lighting pass, with each light on its plane (the wall, the whiteboard, the TV, each desk).
  function drawLightsIso(now, light) {
    const [sr, sg, sb] = light.shade;
    use(ID);
    if (sr + sg + sb < 2.995) {
      ctx.globalCompositeOperation = 'multiply';
      R(0, 0, W, H, `rgb(${Math.round(sr * 255)},${Math.round(sg * 255)},${Math.round(sb * 255)})`);
    }
    ctx.globalCompositeOperation = 'screen';
    const n = light.night;
    const flick = Math.sin(now / 900) > 0.97 ? 0.6 : 1;
    use(cam.front(BACK));
    glow(840, 30, 60, '255,95,162', (0.1 + n * 0.1) * flick);
    glow(791, 29, 24, '127,247,255', (0.1 + n * 0.1) * flick);
    glow(BATH.x + 46, 29, 12, sim.bath.occupant ? '255,60,60' : '60,255,120', 0.25);
    glow(SIGN.x, SIGN.y + 22, 56, '255,209,102', 0.03 + n * 0.05);
    const f = sim.fire;
    if (f && ['burning', 'fighting'].includes(f.phase)) glow(ALARM.x + 5, ALARM.y + 7, 34, '255,40,40', 0.15 + 0.2 * Math.max(0, Math.sin(now / 110)));
    use(cam.front(BACK + 24, CAFE.fridge.y + CAFE.fridge.h));
    glow(CAFE.fridge.x + 14, 100, 38, '150,215,255', 0.04 + n * 0.08);
    use(ID);
    for (const lx of [DINING.table.x - 34, DINING.table.x + 34]) { const [X, Y] = cam.proj(lx, DINING.table.y, 60); glow(X, Y, 60, '255,206,140', 0.03 + n * 0.11); }
    use(BOARD_M());
    glow(CLOCK.x + CLOCK.w / 2, CLOCK.y + CLOCK.h / 2, 48, '255,59,48', 0.04 + n * 0.05);
    use(cam.front(TV.feet));
    const tvRgb = { breaking: '255,60,40', sports: '80,200,110', news: '90,140,220', weather: '150,190,255' }[tvChannel(sim, now)];
    glow(TV.x, TV.feet - 18 - TV.h / 2, 84, tvRgb, 0.04 + n * 0.08);
    // the light coming through the glass: a warm strip on the floor
    if (light.alt > 0) {
      const a = Math.min(1, light.alt * 2.5) * (1 - light.gloom * 0.8);
      use(cam.floor(0));
      const sun = ctx.createLinearGradient(0, BACK, 0, 260);
      sun.addColorStop(0, `rgba(255,${Math.round(236 - 50 * light.dusk)},${Math.round(200 - 90 * light.dusk)},${0.09 * a})`);
      sun.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = sun; ctx.fillRect(GLASS.x0, BACK, GLASS.x1 - GLASS.x0, 134);
    }
    for (const a of Object.values(agents)) {
      const busy = ['working', 'thinking', 'red'].includes(a.state);
      if (!busy && n <= 0.3) continue;
      const s = a.cfg.seat;
      use(cam.front(s.y - 6, s.y - 12, 26));
      glow(s.x + 34, s.y - 34, 34, a.state === 'red' ? '255,80,100' : '120,190,255', (busy ? 0.06 : 0.02) + n * 0.06);
    }
    if (f && f.level > 0) {
      use(cam.front(RACK.y + RACK.h));
      const cx = RACK.x + RACK.w / 2;
      glow(cx, RACK.y + 10, 70 + 130 * f.level, '255,120,30', (0.3 + 0.06 * Math.sin(now / 70) + 0.03 * Math.sin(now / 23)) * f.level);
      glow(cx, RACK.y - 6, 36, '255,220,120', 0.25 * f.level);
    }
    use(ID);
    ctx.globalCompositeOperation = 'source-over';
    if (f && ['burning', 'fighting'].includes(f.phase)) R(0, 0, W, H, `rgba(255,40,20,${0.03 + 0.02 * Math.sin(now / 160)})`);
    const bolt = lightning(now, sim.weather);
    if (bolt.flash > 0) R(0, 0, W, H, `rgba(220,230,255,${0.08 * bolt.flash})`);
  }

  function frameIso(now, t, light) {
    drawIsoRoom(t, now, light);
    isoItems(now);
    drawSprayIso(now);
    drawParticlesIso();
    drawLightsIso(now, light);
    for (const a of Object.values(agents)) { use(personM(a)); drawDream(a, now); }
    if (agents[selected]) { use(personM(agents[selected])); drawPlumbob(agents[selected], now); }
    for (const a of Object.values(agents)) { use(personM(a)); drawBubble(a, now); }
    use(ID);
    drawVignette();
    drawBanner(now);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    sim.step(dt, now);
    const light = daylight(sim.date(), sim.weather);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (iso) {
      frameIso(now, t, light);
      requestAnimationFrame(frame);
      return;
    }

    drawRoom(t, now, light);
    drawBoard(now);
    // depth order: chairs → seated people → desks; walkers by their y
    const items = [];
    for (const a of Object.values(agents)) {
      const s = a.cfg.seat;
      items.push({ y: s.y - 1, fn: () => drawChair(a) });
      items.push({ y: s.y + 1, fn: () => drawDesk(a, now) });
      items.push({ y: a.seated ? s.y : a.y, fn: () => drawPerson(a, now) });
    }
    items.push({ y: CAFE.bistro.y, fn: () => drawBistro() });
    items.push({ y: DINING.top + 13, fn: () => drawDiningWall() });
    items.push({ y: DINING.table.y - 1, fn: () => drawDiningBackChairs() });
    items.push({ y: DINING.table.y + 1, fn: () => drawDiningTable() });
    for (const s of DINING_SEATS.front) items.push({ y: s.y + 1, fn: () => drawDiningFrontChair(s) });
    items.push({ y: 242, fn: () => drawProps(now) });
    items.push({ y: TV.feet, fn: () => drawTV(now) });
    items.push({ y: SOFA.y + 8, fn: () => drawSofa() });
    items.sort((p, q) => p.y - q.y).forEach((i) => i.fn());
    drawSpray(now);
    drawParticles();
    drawLights(now, light);
    for (const a of Object.values(agents)) drawDream(a, now);
    drawPlumbob(agents[selected], now);
    for (const a of Object.values(agents)) drawBubble(a, now);
    drawVignette();
    drawBanner(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- interaction

  function agentAt(mx, my) {
    let best = null, bestD = iso ? 40 * SP : 40;
    for (const a of Object.values(agents)) {
      if (a.hidden) continue;
      const [hx, hy] = apply(personM(a), a.x, feetY(a) - 33);
      const d = Math.hypot(mx - hx, my - hy);
      if (d < bestD) { best = a.id; bestD = d; }
    }
    return best;
  }
  /** Is the pointer over the whiteboard? (in the isometric view, it is mapped to the whiteboard's plane) */
  const overBoard = (x, y) => (iso ? onBoard(...unapply(BOARD_M(), x, y)) : onBoard(x, y));
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  canvas.addEventListener('mousemove', (e) => {
    const [x, y] = toWorld(e);
    const was = hover;
    hover = agentAt(x, y);
    hoverBoard = !hover && overBoard(x, y);
    canvas.style.cursor = hover || hoverBoard ? 'pointer' : 'default';
    if (was !== hover) onHover?.(hover);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; hoverBoard = false; });
  canvas.addEventListener('click', (e) => {
    const [x, y] = toWorld(e);
    const who = agentAt(x, y);
    if (!who && overBoard(x, y)) return onBoardClick?.();
    selected = who;
    onSelect?.(selected);
  });

  return {
    handle: sim.handle,
    agents,
    sim,
    setBoard: sim.setBoard,
    select(id) { selected = id; },
    reset: sim.reset,
    /** 'flat' (the front view, the default) or 'iso' (the isometric top-down one): the office view. */
    get view() { return iso ? 'iso' : 'flat'; },
    setView(v) { iso = v !== 'flat'; },
  };
}
