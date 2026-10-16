// Dibuja la simulación (public/sim.js) en el framebuffer de terminal.
// El mundo de 960×600 se escala a los píxeles disponibles; el texto va en celdas encima.

import { W, H, TEAM, SPOT, BOARD, PLANTS, STATUS_ICON, PHASE_COLOR, phaseInfo, DREAMS, DREAM_PALETTE, RAINBOW_COLORS, rainbowPixels, CAFE, DINING, DINING_SEATS, PARTITION, BATH, RACK, EXTINGUISHER, daylight, GLASS, EASEL, CLOCK, TV, SOFA, ALARM, SIGN, tvChannel } from '../public/sim.js';
import { outdoor, lightning, weatherIcon } from '../public/sky.js';
import { hex, mix, fit, wrap, strWidth } from './screen.js';
import { AGENT_NAME, TASK_STATUS } from '../public/targets.js';
import { briefOptions, briefProblem, targetLabel } from '../public/brief.js';
import { t, timeOf } from '../public/i18n.js';

const C = Object.fromEntries(Object.entries({
  appBg: '#12141f', panelBg: '#1a1d2c', headerBg: '#2b2f47', text: '#e8e9f1', muted: '#9095b0', accent: '#ffd166',
  ok: '#06d6a0', warn: '#f4a261', err: '#ef476f', blue: '#9ad1ff', purple: '#d0b0ff',
  wall: '#2e3550', wallLine: '#333b59', baseboard: '#232840', frame: '#1b1f33', sky1: '#5aa9e6', sky2: '#a7d8f5', city: '#3d5f8c', hill: '#4c7a5a',
  floor1: '#c9b48a', floor2: '#c2ab7f', floorEdge: '#9c8660', rug1: '#6d597a', rug2: '#7f6a8c',
  wood: '#a0703f', woodFront: '#7c5230', woodEdge: '#5d3b20', chair: '#3a3f58', screenOff: '#1d2433', screenOn: '#0d1b2a', monitor: '#20232f',
  paper: '#f8f9fa', boardFrame: '#8d99ae', ink: '#2b2d42', inkMuted: '#6c757d', sticky1: '#ffe08a', sticky2: '#9ad1ff', sticky3: '#a8e6a1',
  rack: '#2b2d42', rackSlot: '#3a3f58', table: '#8c5a33', tableEdge: '#5d3b20', sofa: '#457b9d', sofaBack: '#3a6a88', pot: '#b5651d', leaf1: '#2a9d8f', leaf2: '#3fb68b',
  coffee: '#3d405b', coffeeTop: '#e07a5f', white: '#ffffff', black: '#1a1a1a', shoe: '#222222', folder: '#ffb703',
  bubble: '#ffffff', bubbleErr: '#ffe5e5', bubbleWarn: '#fff3e0', select: '#ffd166', glasses: '#2b2b2b',
  tile: '#1d4f53', grout: '#163d40', neon: '#ff5fa2', neonCyan: '#7ff7ff', marble: '#ece7df', counter: '#5b3a26', chrome: '#c0c7d1',
  oak1: '#c39062', oak2: '#bb8859', oak3: '#c8976a', oakSeam: '#ad7b4f', planter: '#3d405b', fridge: '#dfe4ea', fridgeIn: '#203747',
  door: '#c9d6df', doorDark: '#11131c', fire1: '#e63946', fire2: '#ff9f1c', fire3: '#ffd166', ext: '#d62828', smoke: '#6c6f7d',
  plumbob: '#3fd16b', dine1: '#e2d3b4', dine2: '#d3bf98', dineRug: '#93493a',
}).map(([k, v]) => [k, hex(v)]));

const STATE_COLOR = { idle: C.muted, working: C.blue, thinking: C.purple, talking: C.purple, blocked: C.err, red: C.err, waiting: C.warn, done: C.ok, coffee: C.muted, lunch: C.accent, alarm: C.err };
const STAGE_ICON = { pending: '◷', running: '▶', done: '✔', failed: '✖', skipped: '⊘', cancelled: '⊘' };

/** @param panel mostrar el panel de actividad a la derecha (se oculta con el ícono >_ o la tecla a) */
export function computeLayout(cols, rows, { panel = true } = {}) {
  const panelW = panel && cols >= 110 ? Math.min(54, Math.max(34, Math.floor(cols * 0.28))) : 0;
  const sceneCols = cols - panelW - (panelW ? 1 : 0);
  const sceneRows = rows - 2; // cabecera + pie
  const s = Math.min(sceneCols / W, (sceneRows * 2) / H);
  const pw = Math.floor(W * s), ph = Math.floor(H * s);
  const ox = Math.max(0, Math.floor((sceneCols - pw) / 2));
  const oyRow = 1 + Math.max(0, Math.floor((sceneRows - Math.ceil(ph / 2)) / 2));
  const oy = oyRow * 2;
  // los íconos van dentro de la escena: ⚙ arriba a la derecha, la terminal (>_) abajo a la izquierda;
  // el selector de oficina (si hay más de una), arriba a la izquierda, en la cabecera
  const gearCell = { col: ox + pw - 4, row: oyRow };
  const termCell = { col: ox + 1, row: Math.floor((oy + ph) / 2) - 1 };
  const officeCell = { col: 0, row: 0, w: 0 };
  return { cols, rows, panelW, panelX: cols - panelW, sceneCols, sceneRows, s, pw, ph, ox, oy, gearCell, termCell, officeCell, panel: !!panelW, tooSmall: cols < 60 || rows < 18 };
}

export function drawFrame(scr, L, sim, model, now) {
  scr.clear(C.appBg);
  if (L.tooSmall) {
    const msg = t('scene.resize');
    scr.text(Math.max(0, Math.floor((L.cols - strWidth(msg)) / 2)), Math.floor(L.rows / 2), msg, C.accent, C.appBg);
    return;
  }
  const g = geometry(scr, L);
  const date = model.clock?.() || sim.date();
  const light = daylight(date, sim.weather);
  drawRoom(g, sim, now, light, date);
  drawBoard(g, sim, date);
  const items = [];
  for (const a of Object.values(sim.agents)) {
    const s = a.cfg.seat;
    items.push({ y: s.y - 1, fn: () => drawChair(g, a) });
    items.push({ y: s.y + 1, fn: () => drawDesk(g, a, now) });
    items.push({ y: a.seated ? s.y : a.y, fn: () => drawPerson(g, a, sim, model, now) });
  }
  items.push({ y: CAFE.bistro.y, fn: () => drawBistro(g) });
  items.push({ y: DINING.top + 13, fn: () => drawDiningWall(g) });
  items.push({ y: DINING.table.y - 1, fn: () => drawDiningBackChairs(g) });
  items.push({ y: DINING.table.y + 1, fn: () => drawDiningTable(g, sim) });
  for (const s of DINING_SEATS.front) items.push({ y: s.y + 1, fn: () => drawDiningFrontChair(g, s) });
  items.push({ y: 242, fn: () => drawProps(g, sim, now) });
  items.push({ y: TV.feet, fn: () => drawTV(g, sim, now) });
  items.push({ y: SOFA.y + 8, fn: () => drawSofa(g) });
  items.sort((p, q) => p.y - q.y).forEach((i) => i.fn());
  drawParticles(g, sim);
  drawLights(g, sim, now, light);
  for (const a of Object.values(sim.agents)) drawDream(g, a, now);
  if (model.selected) drawPlumbob(g, sim.agents[model.selected], now);
  // Burbujas: las más nuevas se colocan primero; si chocan con otra, suben.
  const placed = [];
  const withBubble = Object.values(sim.agents).filter((a) => a.bubble).sort((a, b) => b.bubble.until - a.bubble.until);
  for (const a of withBubble) drawBubble(g, a, placed);
  drawBanner(g, sim, now);
  drawSceneIcons(scr, L, model);
  drawHeader(scr, L, model, sim, light);
  drawFooter(scr, L, model);
  if (L.panelW) drawPanel(scr, L, sim, model);
  if (model.brief) drawBrief(scr, L, model);
  if (model.settings) model.settings.draw(scr, L);
}

// ------------------------------------------------------------------ escena

function geometry(scr, L) {
  const { s, ox, oy } = L;
  const X = (wx) => ox + Math.round(wx * s);
  const Y = (wy) => oy + Math.round(wy * s);
  return {
    scr, L, X, Y, s,
    rect(wx, wy, ww, wh, c) {
      const x0 = X(wx), y0 = Y(wy);
      scr.rect(x0, y0, Math.max(1, X(wx + ww) - x0), Math.max(1, Y(wy + wh) - y0), c);
    },
    ellipse(cx, cy, rx, ry, c) {
      const x0 = X(cx - rx), x1 = X(cx + rx), y0 = Y(cy - ry), y1 = Y(cy + ry);
      const pcx = X(cx), pcy = Y(cy), prx = Math.max(1, rx * s), pry = Math.max(1, ry * s);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (((x - pcx) / prx) ** 2 + ((y - pcy) / pry) ** 2 <= 1) scr.pset(x, y, c);
      }
    },
    row: (wy) => Math.floor(Y(wy) / 2),
    /** Un rectángulo semitransparente: se mezcla con lo que hay. Lo que mide menos de un píxel no se
     *  dibuja (así las figuras chicas no se acumulan), salvo con `keep` (lluvia, estrellas, ventanas). */
    blend(wx, wy, ww, wh, c, a, keep = false) {
      let x0 = X(wx), x1 = X(wx + ww), y0 = Y(wy), y1 = Y(wy + wh);
      if (keep) { x1 = Math.max(x1, x0 + 1); y1 = Math.max(y1, y0 + 1); }
      x0 = Math.max(x0, L.ox); y0 = Math.max(y0, L.oy); x1 = Math.min(x1, L.ox + L.pw); y1 = Math.min(y1, L.oy + L.ph);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * scr.cols + x; scr.px[i] = mix(scr.px[i], c, a); }
    },
    /** Acerca los pixeles de un círculo (en el mundo) a un color: luz o resplandor. */
    tint(wx, wy, wr, c, amount) {
      const pcx = X(wx), pcy = Y(wy), pr = Math.max(1, wr * s);
      const x0 = Math.max(L.ox, Math.floor(pcx - pr)), x1 = Math.min(L.ox + L.pw - 1, Math.ceil(pcx + pr));
      const y0 = Math.max(L.oy, Math.floor(pcy - pr)), y1 = Math.min(L.oy + L.ph - 1, Math.ceil(pcy + pr));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - pcx, y - pcy) / pr;
        if (d < 1) { const i = y * scr.cols + x; scr.px[i] = mix(scr.px[i], c, amount * (1 - d)); }
      }
    },
    // texto centrado en una x del mundo, sin salirse de la escena
    centered(wx, row, str, fg, bg) {
      const w = strWidth(str);
      const col = Math.max(L.ox, Math.min(L.ox + L.pw - w, X(wx) - Math.floor(w / 2)));
      scr.text(col, row, str, fg, bg, L.ox + L.pw - col);
    },
  };
}

function drawRoom(g, sim, now, light, date) {
  const { rect, scr, X, Y } = g;
  // la pared de vidrio: el paisaje con la hora, la estación y el clima (sky.js), y su vidrio
  const { shapes } = outdoor({ date, weather: sim.weather, light, now, ...GLASS, lod: 'low' });
  for (const [x, y, w, h, c, a, keep] of shapes) {
    if (a >= 0.99) rect(x, y, w, h, c);
    else g.blend(x, y, w, h, c, a, keep);
  }
  rect(GLASS.x0, 0, GLASS.x1 - GLASS.x0, GLASS.top, hex('#262c42'));
  rect(GLASS.x0, GLASS.bottom, GLASS.x1 - GLASS.x0, 116 - GLASS.bottom, hex('#3a4158'));
  // el baño: un bloque de pared sólida entre el vidrio y la cafetería
  rect(GLASS.x1, 0, CAFE.x - GLASS.x1, 122, C.wall);
  rect(0, 116, CAFE.x, 6, C.baseboard);
  // el letrero, en vinilo sobre el vidrio
  rect(SIGN.x - 39, SIGN.y, 78, 44, C.frame);
  const r = g.row(SIGN.y + 22);
  const hue = Math.floor(now / 400) % 4;
  g.centered(SIGN.x, r - (g.s > 0.12 ? 1 : 0), 'DEV TEAM', [C.accent, C.ok, C.blue, C.err][hue], C.frame);
  if (g.s > 0.12) g.centered(SIGN.x, r, 'OFFICE', C.accent, C.frame);
  // el baño: puerta (abierta un instante cuando alguien entra o sale) y su luz de libre/ocupado
  const open = now - sim.bath.doorAt < 650;
  rect(BATH.x, 40, BATH.w, 82, C.frame);
  rect(BATH.x + 4, 44, BATH.w - 8, 78, open ? C.doorDark : C.door);
  if (open) rect(BATH.x + 14, 92, 18, 16, C.white);
  else rect(BATH.x + BATH.w - 14, 82, 6, 4, C.inkMuted);
  rect(BATH.x + 8, 22, 30, 14, C.frame);
  if (g.s > 0.12) g.centered(BATH.x + 23, g.row(29), t('scene.wc'), C.white, C.frame);
  rect(BATH.x + 42, 24, 8, 8, sim.bath.occupant ? C.err : C.ok);
  // alarma del rack, colgando de la viga
  const alarm = sim.fire && ['burning', 'fighting'].includes(sim.fire.phase);
  rect(ALARM.x, ALARM.y + 3, 10, 8, alarm && Math.floor(now / 150) % 2 ? hex('#ff3b3b') : hex('#7a1f2b'));
  // la cafetería: azulejos, neón, repisa, refrigerador, barra y máquina de espresso
  rect(CAFE.x, 0, W - CAFE.x, 122, C.tile);
  for (let y = 0; y < 116; y += 16) rect(CAFE.x, y, W - CAFE.x, 1, C.grout);
  rect(782, 22, 14, 14, C.neonCyan); rect(785, 25, 8, 8, C.tile);
  g.centered(840, g.row(30), t('scene.cafe'), C.neon, C.tile);
  rect(818, 72, 138, 4, C.tableEdge);
  [C.accent, C.err, C.ok, C.white].forEach((c, i) => rect(826 + i * 12, 64, 8, 8, c));
  rect(886, 54, 12, 18, C.leaf2);
  const f = CAFE.fridge;
  rect(f.x, f.y, f.w, f.h, C.fridge); rect(f.x + 3, f.y + 4, f.w - 6, f.h - 18, C.fridgeIn);
  for (let i = 0; i < 4; i++) [C.err, C.accent, C.ok].forEach((c, j) => rect(f.x + 6 + j * 6, f.y + 10 + i * 18, 3, 8, c));
  const k = CAFE.counter;
  rect(k.x, k.top, k.w, 9, C.marble); rect(k.x, k.top + 9, k.w, 23, C.counter);
  const e = CAFE.espresso.x;
  rect(e, 80, 42, 32, C.chrome); rect(e + 4, 90, 34, 6, C.ink); rect(e + 8, 100, 8, 6, C.ink); rect(e + 26, 100, 8, 6, C.ink);
  rect(e + 7, 92, 3, 3, Math.floor(now / 700) % 2 ? C.err : C.ok);
  rect(822, 102, 30, 14, hex('#f4a3c4')); rect(860, 104, 18, 12, hex('#f4f1de'));
  // pisos: baldosas en la oficina, tablas de roble en la cafetería, cerámica en el comedor
  const fy0 = Y(122), fy1 = Y(H), fx0 = X(0), fx1 = X(W), cafeX = X(CAFE.x), dineY = Y(DINING.top + 14);
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) {
    const wx2 = (x - g.L.ox) / g.s, wy2 = (y - g.L.oy) / g.s;
    if (x < cafeX) scr.pset(x, y, (Math.floor(wx2 / 32) + Math.floor(wy2 / 32)) % 2 ? C.floor1 : C.floor2);
    else if (y >= dineY) scr.pset(x, y, (Math.floor(wx2 / 16) + Math.floor(wy2 / 16)) % 2 ? C.dine1 : C.dine2);
    else {
      const row = Math.floor((wy2 - 122) / 10), col = Math.floor((wx2 + (row % 3) * 22) / 66);
      scr.pset(x, y, [C.oak1, C.oak2, C.oak3][(row + col) % 3]);
    }
  }
  // la alfombra y las lámparas del comedor
  const tb = DINING.table;
  rect(tb.x - tb.w / 2 - 14, tb.y - 40, tb.w + 28, 112, C.dineRug);
  for (const lx of [tb.x - 34, tb.x + 34]) { rect(lx, DINING.top + 14, 1, tb.y - 74 - DINING.top - 14, C.ink); rect(lx - 12, tb.y - 72, 25, 7, hex('#3d405b')); }
  rect(0, 122, W, 4, C.floorEdge);
  rect(SPOT.table.x - 130, SPOT.table.y - 52, 260, 126, C.rug1);
  rect(SPOT.table.x - 122, SPOT.table.y - 44, 244, 110, C.rug2);
  rect(SOFA.x - 96, TV.feet - 10, 192, H - TV.feet + 6, hex('#5b7a8c'));
  rect(SOFA.x - 90, TV.feet - 4, 180, H - TV.feet - 6, hex('#6a8a9c'));
  // jardineras que separan la cafetería
  for (const [y0, y1] of PARTITION) { rect(CAFE.x - 13, y0, 14, y1 - y0, C.planter); rect(CAFE.x - 15, y0 + 2, 18, y1 - y0 - 6, C.leaf1); rect(CAFE.x - 11, y0 + 6, 10, y1 - y0 - 14, C.leaf2); }
}

// La mesita alta de la cafetería.
function drawBistro(g) {
  const { x, y } = CAFE.bistro;
  for (const sx of [x - 30, x + 30]) { g.rect(sx - 7, y - 22, 14, 4, C.ink); g.rect(sx - 1, y - 18, 2, 18, C.chrome); }
  g.rect(x - 2, y - 28, 4, 28, C.chrome);
  g.ellipse(x, y - 30, 20, 7, C.marble);
}

// El muro entre la cafetería y el comedor: vidrio sobre un zócalo de madera, con su puerta.
function drawDiningWall(g) {
  const top = DINING.top, { x0: d0, x1: d1 } = DINING.door;
  for (const [a, b] of [[CAFE.x, d0], [d1, W]]) {
    g.blend(a, top - 32, b - a, 32, hex('#b4dcff'), 0.25);
    g.rect(a, top - 32, b - a, 2, C.chrome);
    g.rect(a, top, b - a, 14, C.woodFront);
    g.rect(a, top, b - a, 3, C.marble);
  }
  g.rect(d0 - 3, top - 34, 3, 48, C.chrome); g.rect(d1, top - 34, 3, 48, C.chrome);
  if (g.s > 0.12) g.centered((CAFE.x + d0) / 2, g.row(top - 16), t('scene.dining'), C.accent, -1);
}

// La mesa larga del comedor: sillas de atrás, la cubierta con mantel (y lo que comen los de atrás)
// y las sillas de adelante, que tapan la espalda de quien se sienta.
function drawDiningBackChairs(g) {
  const colors = [C.accent, C.ok, C.err, hex('#118ab2')];
  DINING_SEATS.back.forEach((s, i) => g.rect(s.x - 11, s.y - 36, 22, 24, colors[i % 4]));
}
function drawDiningTable(g, sim) {
  const { x, y, w } = DINING.table;
  g.rect(x - w / 2 + 8, y + 18, 3, 22, C.woodEdge); g.rect(x + w / 2 - 11, y + 18, 3, 22, C.woodEdge);
  g.rect(x - w / 2, y - 14, w, 28, hex('#f4f1ea'));
  g.rect(x - w / 2, y + 14, w, 7, hex('#e1d9c9'));
  if (g.s < 0.14) return;
  for (const a of Object.values(sim.agents)) {
    if (!a.perch || !a.food || a.diningSeat?.row !== 'back') continue;
    const col = g.X(a.x) - 1;
    g.scr.text(col, g.row(y - 6), a.food, C.white, -1, g.L.ox + g.L.pw - col);
  }
}
function drawDiningFrontChair(g, s) {
  g.rect(s.x - 12, s.y - 24, 24, 4, C.woodEdge);
  g.rect(s.x - 11, s.y - 20, 22, 18, C.woodFront);
}

// La pizarra en su atril, con el reloj digital rojo encima.
function drawBoard(g, sim, date) {
  const { rect, scr, X } = g;
  const board = sim.board;
  const wood = C.wood, woodDark = C.woodEdge;
  const [[lt, lf], [rt, rf]] = EASEL.legs;
  rect(lt - 3, EASEL.top + 4, rt - lt + 6, 4, wood);
  for (const [top, foot] of EASEL.legs) for (let k = 0; k <= 12; k++) rect(top + ((foot - top) * k) / 12 - 2, EASEL.top + ((EASEL.feet - EASEL.top) * k) / 12, 5, 11, wood);
  rect(BOARD.x + BOARD.w / 2, BOARD.y + BOARD.h, 4, EASEL.feet - BOARD.y - BOARD.h - 4, woodDark);
  // el reloj: dígitos rojos sobre negro
  rect(CLOCK.x - 2, CLOCK.y - 2, CLOCK.w + 4, CLOCK.h + 4, hex('#0b0c14'));
  rect(CLOCK.x, CLOCK.y, CLOCK.w, CLOCK.h, hex('#160a0c'));
  const pad = (n) => String(n).padStart(2, '0');
  const blink = date.getMilliseconds() < 500 ? ':' : ' ';
  g.centered(CLOCK.x + CLOCK.w / 2, g.row(CLOCK.y + CLOCK.h / 2), `${pad(date.getHours())}${blink}${pad(date.getMinutes())}`, hex('#ff3b30'), hex('#160a0c'));
  // el tablero
  rect(BOARD.x - 4, BOARD.y - 4, BOARD.w + 8, BOARD.h + 8, C.boardFrame);
  rect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, C.paper);
  rect(lt + 4, BOARD.y + BOARD.h + 4, rt - lt - 8, 4, wood);
  const c0 = X(BOARD.x + 4), c1 = X(BOARD.x + BOARD.w - 4);
  const r0 = Math.ceil(g.Y(BOARD.y + 4) / 2), r1 = Math.floor(g.Y(BOARD.y + BOARD.h - 4) / 2) - 1;
  const width = c1 - c0;
  if (r1 < r0 || width < 12) return;
  const title = board.title ? t('scene.taskTitle', { title: board.title }) : t('scene.noTask');
  scr.text(c0, r0, fit(title, width), C.ink, C.paper);
  const todos = board.todos || [];
  const cols = [[t('scene.todo'), 'pending', C.sticky1], [t('scene.doing'), 'in_progress', C.sticky2], [t('scene.done'), 'completed', C.sticky3]];
  const avail = r1 - r0 - 1; // filas para columnas
  if (avail < 2) {
    if (avail >= 1) {
      const n = (st) => todos.filter((t) => t.status === st).length;
      scr.text(c0, r0 + 1, fit(t('scene.todoShort', { todo: n('pending'), doing: n('in_progress'), done: n('completed') }), width), C.inkMuted, C.paper);
    }
    return;
  }
  const cw = Math.floor(width / 3);
  cols.forEach(([label, status, color], i) => {
    const cx = c0 + i * cw;
    const items = todos.filter((t) => t.status === status);
    scr.text(cx, r0 + 1, fit(`${label}${items.length ? ` ${items.length}` : ''}`, cw - 1), C.inkMuted, C.paper);
    const fitRows = avail - 1;
    items.slice(0, fitRows).forEach((todo, j) => {
      scr.fill(cx, r0 + 2 + j, cw - 1, color);
      scr.text(cx, r0 + 2 + j, fit(todo.content, cw - 1), C.ink, color);
    });
  });
  if (todos.length) {
    const done = todos.filter((t) => t.status === 'completed').length;
    rect(BOARD.x, BOARD.y + BOARD.h - 4, BOARD.w, 4, hex('#dee2e6'));
    rect(BOARD.x, BOARD.y + BOARD.h - 4, Math.max(1, (BOARD.w * done) / todos.length), 4, hex('#2a9d8f'));
  }
}

// El sofá, de espaldas, y la tele en su trípode.
function drawSofa(g) {
  const { x, y } = SOFA;
  g.rect(x - 72, y - 8, 12, 36, C.sofaBack); g.rect(x + 60, y - 8, 12, 36, C.sofaBack);
  g.rect(x - 64, y - 2, 128, 30, C.sofa);
  g.rect(x - 64, y - 2, 128, 3, hex('#4f86a6'));
}
const TV_BG = { breaking: '#9d0208', sports: '#2f8f46', news: '#1d3557' };
const SKY_BG = { clear: '#4a92d8', partly: '#5a95cc', cloudy: '#6f7a8a', fog: '#8d96a3', drizzle: '#55657a', rain: '#4a5568', snow: '#8fa6bf', storm: '#2d3340' };
function drawTV(g, sim, now) {
  const { x, feet, w, h } = TV;
  const top = feet - 18 - h;
  const dark = hex('#1b1d27');
  g.rect(x - 2, top + h - 2, 4, 8, dark);
  for (let k = 0; k <= 6; k++) { const yy = top + h + 6 + k * 2; g.rect(x - 4 - k * 3.4, yy, 3, 3, dark); g.rect(x + 1 + k * 3.4, yy, 3, 3, dark); }
  g.rect(x - w / 2, top, w, h, hex('#111219'));
  const ch = tvChannel(sim, now);
  const wth = sim.weather;
  const bg = hex(ch === 'weather' ? SKY_BG[wth.kind] : TV_BG[ch]);
  g.rect(x - w / 2 + 3, top + 3, w - 6, h - 9, bg);
  if (ch === 'sports') g.rect(x, top + 3, 1, h - 9, C.white);
  if (ch === 'news') g.rect(x - w / 2 + 3, top + 3, w - 6, 8, C.err);
  if (g.s < 0.14) return;
  const label = ch === 'weather' ? `${weatherIcon(wth)} ${Number.isFinite(wth.temp) ? Math.round(wth.temp) : '--'}°` : ch === 'breaking' ? '🔥 !!!' : ch === 'sports' ? '1-0' : 'TV';
  g.centered(x, g.row(top + h / 2), label, C.white, bg);
}

function drawChair(g, a) {
  const s = a.cfg.seat;
  g.rect(s.x - 16, s.y - 40, 32, 34, C.chair);
}

function screenPixels(g, x, y, w, h, busy, accent, now) {
  const { scr } = g;
  scr.rect(x - 1, y - 1, w + 2, h + 2, C.monitor);
  scr.rect(x, y, w, h, busy ? C.screenOn : C.screenOff);
  if (!busy) return;
  const off = Math.floor(now / 160);
  const colors = [C.ok, C.accent, C.blue, accent];
  for (let r = 0; r < h; r++) {
    const len = 1 + ((r * 7 + off) * 13) % Math.max(1, w - 1);
    scr.rect(x + (r % 2), y + r, Math.min(len, w - (r % 2)), 1, colors[(r + off) % 4]);
  }
}

function drawDesk(g, a, now) {
  const { rect, X, Y, scr } = g;
  const s = a.cfg.seat, c = a.cfg;
  const busy = ['working', 'thinking', 'red'].includes(a.state);
  rect(s.x - 50, s.y - 14, 100, 14, C.wood);
  rect(s.x - 50, s.y - 2, 100, 26, C.woodFront);
  rect(s.x - 50, s.y - 2, 100, 2, C.woodEdge);
  // monitor
  const mx = X(s.x + 20), my = Y(s.y - 42), mw = Math.max(3, X(s.x + 46) - mx), mh = Math.max(2, Y(s.y - 26) - my);
  if (c.prop === 'qa' || c.prop === 'chart') {
    scr.rect(mx - 1, my - 1, mw + 2, mh + 2, C.monitor);
    scr.rect(mx, my, mw, mh, C.paper);
    for (let r = 0; r < mh; r++) {
      if (c.prop === 'qa') {
        const fail = a.state === 'red' || (a.state === 'talking' && r === mh - 1);
        const ok = a.state === 'done' || !busy || r < (Math.floor(now / 400) % (mh + 1));
        scr.pset(mx, my + r, fail ? C.err : ok ? C.ok : hex('#ced4da'));
        scr.rect(mx + 2, my + r, Math.max(1, mw - 3 - (r % 2)), 1, hex('#adb5bd'));
      }
    }
    if (c.prop === 'chart') {
      const k = busy ? Math.floor(now / 300) : 0;
      [C.warn, C.blue, C.ok, C.err].forEach((col, i) => {
        const h = Math.min(mh, 1 + ((i * 2 + k) % mh));
        if (mx + i * 2 < mx + mw) scr.rect(mx + i * 2, my + mh - h, 1, h, col);
      });
    }
  } else {
    screenPixels(g, mx, my, mw, mh, busy, hex(c.shirt), now);
  }
  scr.rect(X(s.x + 33), my + mh + 1, 1, Math.max(1, Y(s.y - 14) - (my + mh + 1)), C.monitor); // pie del monitor
  // carpetas = subagentes asignados
  for (let i = 0; i < Math.min(3, a.badges.size); i++) rect(s.x - 46 + i * 6, s.y - 30 - i * 4, 18, 12, C.folder);
  // placa con el nombre
  g.centered(s.x, g.row(s.y + 10), ` ${a.cfg.name} `, hex(c.shirt), C.frame);
}

function drawProps(g, sim, now) {
  const { rect, X, Y, scr } = g;
  // rack de servidores: parpadea con el backend; en llamas, rojo; al reparar arranca de a poco
  const f = sim.fire, burning = f && ['burning', 'fighting'].includes(f.phase);
  rect(RACK.x, RACK.y, RACK.w, RACK.h, C.frame);
  rect(RACK.x + 2, RACK.y + 2, RACK.w - 4, RACK.h - 4, burning ? hex('#3a2324') : C.rack);
  const be = sim.agents.backend.state === 'working';
  const x0 = X(578), rows = Math.max(2, Math.floor((Y(236) - Y(156)) / 2));
  const booted = f?.phase === 'repair' ? Math.floor(((now - f.at) / 7500) * rows) : rows;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < 3; j++) {
      let c = C.rackSlot;
      if (burning) c = (Math.floor(now / 120) + i + j) % 2 ? C.err : C.rackSlot;
      else if (i < booted && (be ? (Math.floor(now / 90) * 7 + i * 3 + j) % 5 > 1 : (Math.floor(now / 900) + i + j) % 4 === 0)) c = j === 2 ? C.accent : C.ok;
      scr.pset(x0 + j * 2, Y(156) + i * 2, c);
    }
  }
  if (f && f.level > 0) {
    // llamas: tres capas que titilan con el tiempo
    for (let i = 0; i < 9; i++) {
      const n = Math.sin(now / 90 + i * 1.7) + Math.sin(now / 53 + i * 0.9);
      const h = f.level * (30 + 10 * n) * (1 - Math.abs(i - 4) / 7);
      if (h < 3) continue;
      const fx = RACK.x - 6 + i * 6;
      rect(fx, RACK.y + 8 - h, 6, h, C.fire1); rect(fx + 1, RACK.y + 8 - h * 0.7, 4, h * 0.7, C.fire2); rect(fx + 1, RACK.y + 8 - h * 0.35, 4, h * 0.35, C.fire3);
    }
  }
  // el extintor, junto al rack (si nadie lo tiene)
  if (sim.extinguisher === 'floor') { rect(EXTINGUISHER.x - 5, EXTINGUISHER.y - 24, 10, 24, C.ext); rect(EXTINGUISHER.x - 3, EXTINGUISHER.y - 28, 6, 4, C.ink); }
  // plantas y mesa
  for (const [x, y] of PLANTS) {
    rect(x - 10, y - 14, 20, 16, C.pot);
    rect(x - 14, y - 34, 10, 20, C.leaf1); rect(x - 2, y - 42, 10, 28, C.leaf2); rect(x + 6, y - 30, 10, 16, C.leaf1);
  }
  g.ellipse(SPOT.table.x, SPOT.table.y + 4, 84, 26, C.tableEdge);
  g.ellipse(SPOT.table.x, SPOT.table.y, 84, 24, C.table);
}

// Sprites a escala de terminal: 5×10 (grande) o 3×6 (chico), anclados en los pies.
function drawPerson(g, a, sim, model, now) {
  if (a.hidden) return; // en el baño
  const { scr, X, Y, L } = g;
  const c = a.cfg;
  const big = g.s >= 0.14;
  const sw = big ? 5 : 3, sh = big ? 10 : 6;
  const skin = hex(c.skin), hair = hex(c.hair), shirt = hex(c.shirt), pants = hex(c.pants);
  const sitting = a.seated || a.perch;
  let fx = X(a.x), top;
  if (sitting) top = Y(a.y - 14) - (big ? 6 : 3);
  else top = Y(a.y) - sh;
  if (now < a.jumpUntil) top -= Math.round(Math.abs(Math.sin(now / 120)) * 2);
  if (now < a.shakeUntil) fx += Math.round(Math.sin(now / 25));
  if (a.dance && !a.walking) fx += Math.round(Math.sin(now / 55)); // esperando el baño
  const x0 = fx - Math.floor(sw / 2);
  const P = (dx, dy, col) => scr.pset(x0 + dx, top + dy, col);
  const rowsToDraw = sitting ? (big ? 7 : 4) : sh;
  const blink = Math.floor(now / 100) % 40 === 0;
  const eye = blink ? skin : C.black;
  const walking = a.walking;
  const step = walking ? Math.sin(a.walkT * 14) > 0 : false;
  const typing = a.seated && a.state === 'working' && Math.floor(now / 140) % 2;

  scr.clearText(x0 - 1, top, sw + 2, rowsToDraw); // tapa el texto que quede detrás
  if (a.back) { // de espaldas, en el sofá: el pelo y los hombros
    if (big) {
      for (const x of [1, 2, 3]) P(x, 0, hair);
      for (let y = 1; y <= 3; y++) for (let x = 0; x < 5; x++) P(x, y, hair);
      for (let y = 4; y <= 6; y++) for (let x = 0; x < 5; x++) P(x, y, shirt);
    } else {
      for (const x of [0, 1, 2]) { P(x, 0, hair); P(x, 1, hair); P(x, 2, shirt); P(x, 3, shirt); }
    }
    return;
  }
  if (big) {
    const side = c.long ? hair : null;
    [[1, 0, hair], [2, 0, hair], [3, 0, hair], [0, 1, hair], [4, 1, hair]].forEach(([x, y, col]) => P(x, y, col));
    for (const x of [1, 2, 3]) P(x, 1, skin);
    P(1, 2, eye); P(2, 2, c.glasses ? C.glasses : skin); P(3, 2, eye);
    if (side) { P(0, 2, side); P(4, 2, side); P(0, 3, side); P(4, 3, side); }
    for (const x of [1, 2, 3]) P(x, 3, c.beard ? hair : skin);
    if (a.state === 'done' || now < a.jumpUntil) P(2, 3, hex('#7a2e2e'));
    for (let y = 4; y <= 6; y++) for (let x = 0; x < 5; x++) P(x, y, shirt);
    P(0, 6, typing ? shirt : skin); P(4, 6, typing ? skin : shirt);
    if (a.handUp) { P(-1, 1, skin); P(-1, 2, shirt); P(-1, 3, shirt); P(-1, 4, shirt); }
    if (a.carry) { P(5, 4, a.carry === 'ext' ? C.ext : C.white); P(5, 5, a.carry === 'ext' ? C.ext : C.white); }
    if (!sitting) {
      for (const y of [7, 8]) { P(1, y, pants); P(3, y, pants); }
      // al caminar los zapatos se alternan
      const [l, rr] = !walking ? [1, 3] : step ? [0, 3] : [1, 4];
      P(l, 9, C.shoe); P(rr, 9, C.shoe);
    }
  } else {
    for (const x of [0, 1, 2]) P(x, 0, hair);
    P(0, 1, eye); P(1, 1, skin); P(2, 1, eye);
    for (const x of [0, 1, 2]) { P(x, 2, shirt); P(x, 3, shirt); }
    if (a.handUp) P(-1, 1, skin);
    if (a.carry) P(3, 2, a.carry === 'ext' ? C.ext : C.white);
    if (!sitting) { P(0, 4, pants); P(2, 4, pants); P(step ? 0 : 2, 5, C.shoe); P(step ? 2 : 0, 5, C.shoe); }
  }

  const headRow = Math.floor(top / 2);
  // selección: línea amarilla bajo los pies
  if (model.selected === a.id) {
    const y = sitting ? Y(a.y + 24) : top + sh;
    scr.rect(x0 - 1, y, sw + 2, 1, C.select);
  }
  if (!sitting) g.centered(a.x, headRow - 1, c.name, C.white, -1);
  if (a.seated && a.food && big) scr.text(X(c.seat.x - 30), g.row(c.seat.y - 18), a.food, C.white, -1, L.ox + L.pw - X(c.seat.x - 30));
  const icon = STATUS_ICON[a.state] || (a.badges.size ? '🤖' : '');
  if (icon) scr.text(x0 + sw + 1, headRow, icon, C.white, -1, L.ox + L.pw - (x0 + sw + 1));
  if (sim.turn === a.id && sim.turnPhase) {
    const label = `▶${phaseInfo(sim.turnPhase).label}`;
    const w = strWidth(label) + 2;
    const col = Math.max(L.ox, x0 - 1 - w);
    const bg = PHASE_COLOR[sim.turnPhase] ? hex(PHASE_COLOR[sim.turnPhase]) : hex(c.shirt);
    scr.text(col, headRow, ` ${label} `, C.frame, bg);
  }
}

// Lo que imaginan: una nube con su pixel art (unicornio, arcoíris, calavera o pizza) que brilla.
const RAINBOW_SMALL = rainbowPixels(6);
function drawDream(g, a, now) {
  const d = a.dream;
  if (!d || now > d.until || now < d.start + 150 || a.hidden) return;
  const { scr, X, Y, L } = g;
  const info = DREAMS[d.kind];
  const x = X(a.x);
  const head = a.seated || a.perch ? Y(a.y - 14) - 6 : Y(a.y) - 10;
  const big = g.s >= 0.14;
  const sprite = info.sprite;
  const w = sprite ? sprite[0].length : 13, h = sprite ? sprite.length : 7;
  const x0 = Math.min(L.ox + L.pw - w - 3, x + 4), y0 = Math.max(L.oy + 1, head - h - 4);
  if (!big) { // terminal chica: el sueño como emoji, junto a la cabeza
    const col = Math.min(L.ox + L.pw - 3, x + 2);
    scr.text(col, Math.max(1, Math.floor(head / 2) - 2), info.emoji, C.white, -1, L.ox + L.pw - col);
    return;
  }
  // resplandor alrededor de la nube (el arcoíris cambia de color)
  const glowColor = hex(d.kind === 'rainbow' ? RAINBOW_COLORS[Math.floor(now / 300) % RAINBOW_COLORS.length] : info.glow);
  const cx = (x0 + w / 2 - L.ox) / g.s, cy = (y0 + h / 2 - L.oy) / g.s;
  g.tint(cx, cy, (w + 8) / g.s * 0.75, glowColor, 0.28 + 0.04 * Math.sin(now / 420));
  const cloud = hex(info.cloud);
  scr.rect(x0 - 1, y0 - 1, w + 2, h + 2, cloud); // la nube
  scr.pset(x0 - 2, y0 + h - 1, cloud); scr.pset(x0 - 3, y0 + h + 1, cloud); // burbujitas hacia la cabeza
  if (sprite) sprite.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch !== '.') scr.pset(x0 + rx, y0 + ry, hex(DREAM_PALETTE[ch])); }));
  else for (const [dx, dy, col] of RAINBOW_SMALL) scr.pset(x0 + 6 + dx, y0 + 6 + dy, hex(col));
}

/** Luz: de noche el color se enfría apenas (las luces siguen prendidas) y brillan tenues el neón,
 *  los monitores, el baño y el fuego. */
function drawLights(g, sim, now, light) {
  const { scr, L } = g;
  const [sr, sg, sb] = light.shade;
  if (sr + sg + sb < 2.995) {
    for (let y = L.oy; y < L.oy + L.ph; y++) for (let x = L.ox; x < L.ox + L.pw; x++) {
      const i = y * scr.cols + x, p = scr.px[i];
      if (p >= 0) scr.px[i] = (Math.round(((p >> 16) & 255) * sr) << 16) | (Math.round(((p >> 8) & 255) * sg) << 8) | Math.round((p & 255) * sb);
    }
  }
  const n = light.night;
  g.tint(840, 30, 56, C.neon, 0.1 + n * 0.1);
  g.tint(BATH.x + 46, 28, 12, sim.bath.occupant ? C.err : C.ok, 0.2);
  for (const a of Object.values(sim.agents)) {
    const busy = ['working', 'thinking', 'red'].includes(a.state);
    if (busy || n > 0.3) g.tint(a.cfg.seat.x + 34, a.cfg.seat.y - 34, 32, a.state === 'red' ? C.err : C.blue, (busy ? 0.06 : 0.02) + n * 0.06);
  }
  for (const lx of [DINING.table.x - 34, DINING.table.x + 34]) if (n > 0.3) g.tint(lx, DINING.table.y - 52, 64, C.accent, n * 0.1);
  g.tint(CLOCK.x + CLOCK.w / 2, CLOCK.y + CLOCK.h / 2, 40, hex('#ff3b30'), 0.04 + n * 0.05);
  const f = sim.fire;
  if (f?.level > 0) g.tint(RACK.x + RACK.w / 2, RACK.y + 10, 70 + 120 * f.level, C.fire2, (0.25 + 0.05 * Math.sin(now / 70)) * f.level);
  // los relámpagos iluminan la oficina un instante
  const bolt = lightning(now, sim.weather);
  if (bolt.flash > 0) g.blend(0, 0, W, H, C.white, 0.08 * bolt.flash);
}

// El seleccionado lleva un rombo verde encima, como en Los Sims.
function drawPlumbob(g, a, now) {
  if (!a || a.hidden) return;
  const { scr, X, Y } = g;
  const x = X(a.x);
  const top = (a.seated || a.perch ? Y(a.y - 14) - (g.s >= 0.14 ? 6 : 3) : Y(a.y) - (g.s >= 0.14 ? 10 : 6)) - 4 + Math.round(Math.sin(now / 320));
  scr.pset(x, top, C.plumbob); scr.pset(x - 1, top + 1, C.plumbob); scr.pset(x, top + 1, hex('#b8ffcb')); scr.pset(x + 1, top + 1, C.plumbob); scr.pset(x, top + 2, C.plumbob);
}

function drawBubble(g, a, placed) {
  const b = a.bubble;
  if (a.hidden) return;
  const { scr, L, X, Y } = g;
  const x = X(a.x);
  const top = a.seated || a.perch ? Y(a.y - 14) - 6 : Y(a.y) - 10;
  const maxW = Math.max(10, Math.min(30, Math.floor(L.pw / 4)));
  const lines = wrap(b.text, maxW - 2, L.sceneRows > 30 ? 3 : 2);
  if (!lines.length) return;
  const w = Math.max(...lines.map(strWidth)) + 2;
  const bg = b.tone === 'error' ? C.bubbleErr : b.tone === 'warn' ? C.bubbleWarn : C.bubble;
  const fg = b.tone === 'error' ? hex('#9b1d32') : C.ink;
  const col = Math.max(L.ox, Math.min(L.ox + L.pw - w, x - Math.floor(w / 2)));
  let row0 = Math.max(1, Math.floor(top / 2) - 1 - lines.length);
  const h = lines.length + 1;
  const hits = (r) => placed.some((p) => col < p.col + p.w + 1 && p.col < col + w + 1 && r < p.row + p.h && p.row < r + h);
  while (hits(row0) && row0 > 1) row0--;
  if (hits(row0)) return; // no hay sitio: se omite este cuadro
  placed.push({ col, row: row0, w, h });
  lines.forEach((line, i) => {
    scr.fill(col, row0 + i, w, bg);
    scr.text(col + 1, row0 + i, line, fg, bg);
  });
  scr.text(Math.max(col, Math.min(col + w - 1, x)), row0 + lines.length, '▾', bg, -1);
}

function drawParticles(g, sim) {
  const { scr, X, Y, L } = g;
  for (const p of sim.particles) {
    if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
    const x = X(p.x), y = Y(p.y);
    if (p.kind === 'code') scr.text(x, Math.floor(y / 2), p.ch, hex(p.color), -1, L.ox + L.pw - x);
    else if (p.kind === 'check') scr.text(x, Math.floor(y / 2), '✓', C.ok, -1, L.ox + L.pw - x);
    else if (p.kind === 'bug') scr.text(x, Math.floor(y / 2), '🐞', C.white, -1, L.ox + L.pw - x);
    else if (p.kind === 'sparkle') scr.text(x, Math.floor(y / 2), p.ch, hex(p.color), -1, L.ox + L.pw - x);
    else if (p.kind === 'emote') scr.text(x, Math.floor(y / 2), p.ch, C.white, -1, L.ox + L.pw - x);
    else if (p.kind === 'smoke') scr.rect(x - 1, y - 1, 2 + Math.round(p.size), 2, mix(scr.px[y * scr.cols + x] ?? C.smoke, C.smoke, Math.min(0.8, p.life / 2.5)));
    else if (p.kind === 'foam') scr.rect(x, y, 2, 1, C.white);
    else scr.pset(x, y, hex(p.color));
  }
}

function drawBanner(g, sim, now) {
  const banner = sim.banner;
  if (!banner) return;
  const { scr, L } = g;
  const tone = { warn: [C.warn, C.ink], done: [hex('#2a9d8f'), C.white], chat: [hex('#3f73f0'), C.white], fire: [hex('#e85d04'), C.white] }[banner.tone] || [C.ink, C.white];
  const pulse = (banner.tone === 'warn' || banner.tone === 'fire') && Math.floor(now / 500) % 2 ? mix(tone[0], C.white, 0.15) : tone[0];
  const row = Math.floor((L.oy + L.ph) / 2) - 1;
  scr.fill(L.ox, row, L.pw, pulse);
  const text = fit(banner.text, L.pw - 2);
  scr.text(L.ox + Math.floor((L.pw - strWidth(text)) / 2), row, text, tone[1], pulse);
}

// ------------------------------------------------------------------ cabecera, pie y panel

function drawHeader(scr, L, model, sim, light) {
  scr.fill(0, 0, L.cols, C.headerBg);
  let c = 0;
  // arriba a la izquierda, el selector de oficina (sólo si la empresa tiene más de una)
  const offices = model.offices || [];
  if (offices.length > 1) {
    const label = ` 🏢 ${fit(model.office?.name || '', 22)} ▾ `;
    c += scr.text(0, 0, label, C.headerBg, C.accent);
    Object.assign(L.officeCell, { col: 0, row: 0, w: c });
    c++;
  } else L.officeCell.w = 0;
  c += scr.text(c, 0, ' ▣ DEV TEAM OFFICE ', C.accent, C.headerBg);
  const conn = model.connection;
  c += scr.text(c, 0, ` ● ${conn.key ? t(conn.key, conn.vars) : conn.label} `, conn.ok ? C.ok : C.err, C.headerBg);
  // a la derecha: el clima de afuera (el que se ve por el vidrio) y la hora de la oficina
  const clock = timeOf(Date.now(), sim.zone, { seconds: true });
  const w = sim.weather;
  const wx = `${weatherIcon(w, light.night)} ${Number.isFinite(w.temp) ? `${Math.round(w.temp)}°` : ''}${w.place ? ` ${w.place}` : ''}  `;
  const right = L.cols - clock.length - 1 - strWidth(wx);
  const api = ` API ${model.endpoints.join(' · ')} `;
  c += scr.text(c, 0, fit(api, Math.max(0, right - c - 1)), C.muted, C.headerBg);
  if (right > c) scr.text(right, 0, wx, C.text, C.headerBg);
  scr.text(L.cols - clock.length - 1, 0, clock, C.text, C.headerBg);
}

/** Dentro de la escena: ⚙ Ajustes arriba a la derecha y la terminal (actividad) abajo a la izquierda. */
function drawSceneIcons(scr, L, model) {
  const on = (x) => (x ? [C.headerBg, C.accent] : [C.accent, C.frame]);
  const [gf, gb] = on(model.settings);
  scr.text(L.gearCell.col, L.gearCell.row, ' ⚙ ', gf, gb);
  const [tf, tb] = L.panel ? [C.appBg, C.ok] : [C.ok, C.frame];
  scr.text(L.termCell.col, L.termCell.row, ' >_ ', tf, tb);
}

function drawFooter(scr, L, model) {
  const row = L.rows - 1;
  scr.fill(0, row, L.cols, C.headerBg);
  if (model.chat !== null) {
    const label = model.selected ? t('tui.msgTo', { name: TEAM[model.selected].name }) : t('tui.msgTeam');
    const c = scr.text(0, row, label, C.accent, C.headerBg);
    const hint = t('tui.msgHint');
    const shown = fit(model.chat, L.cols - c - strWidth(hint) - 2);
    const cc = scr.text(c, row, shown, C.text, C.headerBg);
    scr.text(c + cc, row, '▌', C.accent, C.headerBg);
    scr.text(L.cols - strWidth(hint), row, hint, C.muted, C.headerBg);
    return;
  }
  const keys = ['t', 'c', 'a', ...((model.offices || []).length > 1 ? ['o'] : []), 'q', 'tab', 'm', 's', 'x', 'd', 'p', 'r', 'esc'];
  let c = 1;
  for (const k of keys) {
    const label = t(`tui.keys.${k === 'q' && model.quitKey === 'quit' ? 'quit' : k}`);
    if (c + k.length + label.length + 3 > L.cols - 2) break;
    c += scr.text(c, row, k, C.accent, C.headerBg);
    c += scr.text(c, row, ` ${label}  `, C.muted, C.headerBg);
  }
  if (model.status && performance.now() < model.status.until) {
    const msg = fit(model.status.text, Math.max(10, L.cols - c - 2));
    scr.text(L.cols - strWidth(msg) - 1, row, msg, C.text, C.headerBg);
  }
}

function drawPanel(scr, L, sim, model) {
  const x = L.panelX, w = L.panelW, inner = w - 2;
  for (let r = 1; r < L.rows - 1; r++) scr.fill(x, r, w, C.panelBg);
  let r = 2;
  const maxR = L.rows - 2;
  const T = (text, fg = C.text, col = x + 1, max = inner) => { if (r <= maxR) scr.text(col, r, fit(text, max), fg, C.panelBg); };
  const heading = (title, right = '') => {
    if (r > maxR) return;
    scr.text(x + 1, r, title, C.muted, C.panelBg);
    if (right) { const rr = fit(right, inner - strWidth(title) - 2); scr.text(x + w - 1 - strWidth(rr), r, rr, C.muted, C.panelBg); }
    r++;
  };

  // TAREA
  const s = model.session;
  heading(t('tui.task'), s ? `${s.source} · ${s.id.slice(0, 10)}` : '');
  const titleLines = wrap(s?.title || (s ? t('tui.noTaskYet') : t('tui.waitingAgent')), inner, 2);
  for (const line of titleLines) { T(line); r++; }
  const todos = s?.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  const barW = Math.max(6, inner - 8);
  const filled = todos.length ? Math.round((barW * done) / todos.length) : s?.status === 'done' ? barW : 0;
  if (r <= maxR) {
    scr.text(x + 1, r, '█'.repeat(filled), C.ok, C.panelBg);
    scr.text(x + 1 + filled, r, '░'.repeat(barW - filled), C.headerBg, C.panelBg);
    scr.text(x + 2 + barW, r, todos.length ? `${done}/${todos.length}` : '', C.muted, C.panelBg);
    r++;
  }
  if (s) {
    const subs = s.subagents?.filter((x) => x.open).length || 0;
    T(t('tui.stats', { tools: s.tools, errors: s.errors, subs, status: t(`sessionStatus.${s.status}`) }), s.errors ? C.warn : C.muted);
    r++;
  }
  r++;

  // FLUJO por roles
  const flow = s?.flow || [];
  if (flow.length && r < maxR - 10) {
    heading(t('tui.flow'));
    const parts = flow.map((f) => ({ text: `${TEAM[f.role]?.name || f.role}·${phaseInfo(f.phase).label}`, color: hex(TEAM[f.role]?.shirt || '#888888') }));
    // de atrás hacia adelante, lo que quepa en 2 líneas
    const lines = [[]];
    let used = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const pw = strWidth(parts[i].text) + 3;
      if (used + pw > inner) { if (lines.length === 2) break; lines.unshift([]); used = 0; }
      lines[0].unshift(parts[i]);
      used += pw;
    }
    for (const line of lines) {
      let c = x + 1;
      line.forEach((p, i) => {
        if (i || line !== lines[0]) c += scr.text(c, r, '→ ', C.muted, C.panelBg);
        c += scr.text(c, r, p.text, p === parts.at(-1) && s?.turn ? C.accent : p.color, C.panelBg);
        c += scr.text(c, r, ' ', C.muted, C.panelBg);
      });
      r++;
    }
    r++;
  }

  // PIPELINES: cada etapa con el personaje que la hace
  const runs = (model.pipelines || []).slice(-2).reverse();
  if (runs.length && r < maxR - 12) {
    heading(t('tui.pipelines'));
    for (const run of runs) {
      if (r > maxR) break;
      const [icon, tone] = { running: ['▶', 'accent'], done: ['✔', 'ok'], failed: ['✖', 'err'], cancelled: ['⊘', 'muted'] }[run.status] || ['·', 'muted'];
      scr.text(x + 1, r, icon, C[tone], C.panelBg);
      T(`${run.pipeline.name} · ${run.project.name} · ${AGENT_NAME[run.agent] || run.agent}`, C.text, x + 3, inner - 2);
      r++;
      let c = x + 3;
      for (const st of run.stages) {
        const chip = `${STAGE_ICON[st.status] || '·'}${TEAM[st.role]?.name || st.role}${st.attempts > 1 ? `×${st.attempts}` : ''} `;
        if (c + strWidth(chip) > x + w - 1) { r++; c = x + 3; if (r > maxR) break; }
        const color = st.status === 'failed' ? C.err : ['pending', 'skipped', 'cancelled'].includes(st.status) ? C.muted : hex(TEAM[st.role]?.shirt || '#888888');
        c += scr.text(c, r, chip, color, C.panelBg);
      }
      r++;
      if (run.status !== 'running' && run.detail && r <= maxR) { T(`  ${run.detail}`, C.muted); r++; }
    }
    r++;
  }

  // TAREAS enviadas a los agentes
  const tasks = (model.tasks?.tasks || []).slice(-4).reverse();
  if (tasks.length) {
    heading(t('tui.tasks'), t('tui.connected', { n: (model.tasks.agents || []).length }));
    for (const task of tasks) {
      if (r > maxR) break;
      const [icon, tone] = TASK_STATUS[task.status] || ['·', 'muted'];
      const label = t(`taskStatus.${task.status}`);
      const color = C[tone];
      scr.text(x + 1, r, icon, color, C.panelBg);
      const who = `${AGENT_NAME[task.agent] || task.agent}${task.mode === 'launch' ? '+' : ''}`;
      let c = x + 3 + scr.text(x + 3, r, who, C.text, C.panelBg);
      T(` ${task.text}`, C.muted, c, x + w - 1 - c - strWidth(label) - 1);
      scr.text(x + w - 1 - strWidth(label), r, label, color, C.panelBg);
      r++;
      const extra = task.status === 'running' && task.output?.length ? task.output.at(-1) : ['failed', 'queued', 'running'].includes(task.status) && (task.pane || task.status !== 'running') ? task.detail : '';
      if (extra && r <= maxR) { T(`  ${extra}`, C.muted); r++; }
    }
    r++;
  }

  // PANES de herdr: las actividades que abrió el agente (o la oficina), con quién se encarga
  const panes = (model.herdr?.panes || []).filter((p) => !p.main && (p.office || 'main') === (model.office?.id || 'main'));
  if (panes.length && r < maxR - 10) {
    heading(t('tui.panes'));
    for (const p of panes.slice(-4)) {
      if (r > maxR) break;
      scr.text(x + 1, r, '▪', hex(TEAM[p.role]?.shirt || '#888888'), C.panelBg);
      T(`${p.pane} ${TEAM[p.role]?.name || p.role} · ${p.title}${p.status ? ` · ${p.status}` : ''}`, C.text, x + 3, inner - 2);
      r++;
    }
    r++;
  }

  // EQUIPO
  heading(t('tui.team'));
  const compact = maxR - r < 26;
  for (const [id, cfg] of Object.entries(TEAM)) {
    if (r > maxR) break;
    const a = sim.agents[id];
    const sel = model.selected === id;
    const bg = sel ? C.headerBg : C.panelBg;
    scr.fill(x, r, w, bg);
    scr.text(x + 1, r, '■', hex(cfg.shirt), bg);
    scr.text(x + 3, r, fit(`${cfg.name} · ${cfg.title}`, inner - 14), C.text, bg);
    const st = t(`state.${a.state}`);
    scr.text(x + w - 1 - strWidth(st), r, st, STATE_COLOR[a.state] || C.muted, bg);
    r++;
    if (!compact && r <= maxR) {
      scr.fill(x, r, w, bg);
      scr.text(x + 3, r, fit(a.text || t('tui.noActivity'), inner - 2), C.muted, bg);
      r++;
    }
  }
  r++;

  // DETALLE del seleccionado, o BITÁCORA
  if (model.selected) {
    const a = sim.agents[model.selected], cfg = TEAM[model.selected];
    heading(t('tui.detail', { name: cfg.name }), cfg.title);
    if (!a.history.length) { T(t('tui.nothingYet'), C.muted); r++; }
    for (const h of a.history) {
      if (r > maxR) break;
      const time = timeOf(h.ts, sim.zone);
      scr.text(x + 1, r, time, C.muted, C.panelBg);
      T(h.text, C.text, x + 7, inner - 6);
      r++;
    }
    return;
  }
  heading(t('tui.log'));
  for (const ev of model.log) {
    if (r > maxR) break;
    const cfg = TEAM[ev.role];
    const time = timeOf(ev.ts, sim.zone);
    scr.text(x + 1, r, time, C.muted, C.panelBg);
    const who = ev.kind === 'chat' || ev.kind === 'poke' ? ev.from : cfg?.name || t('events.office');
    let c = x + 7;
    c += scr.text(c, r, fit(who, 10), cfg ? hex(cfg.shirt) : C.text, C.panelBg);
    T(` ${logText(ev)}`, ev.ok === false ? C.err : C.text, c, x + w - 1 - c);
    r++;
  }
}

export function logText(ev) {
  if (ev.kind === 'phase') {
    const ph = phaseInfo(ev.phase);
    return `${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
  }
  if (ev.kind === 'phase_end') return t('events.turnEnd', { text: ev.text ? `: ${ev.text}` : '' });
  return ev.text || ev.kind;
}

/** ¿Esa celda cae en el selector de oficina? (arriba a la izquierda, si hay más de una) */
export function officeAtCell(L, col, row) {
  return !!L.officeCell?.w && row === L.officeCell.row && col >= L.officeCell.col && col < L.officeCell.col + L.officeCell.w;
}

/** ¿Esa celda cae en la pizarra? (un clic abre el diálogo de encargo) */
export function boardAtCell(L, col, row) {
  if (L.tooSmall) return false;
  const x0 = L.ox + Math.round(BOARD.x * L.s), x1 = L.ox + Math.round((BOARD.x + BOARD.w) * L.s);
  const r0 = Math.floor((L.oy + Math.round(BOARD.y * L.s)) / 2), r1 = Math.floor((L.oy + Math.round((BOARD.y + BOARD.h) * L.s)) / 2);
  return col >= x0 && col <= x1 && row >= r0 && row <= r1;
}

// ------------------------------------------------------------------ diálogo "Nuevo encargo"

const CB = Object.fromEntries(Object.entries({
  cork: '#b9895a', corkDot: '#8f6640', paper: '#fdfcf6', note: '#ffe08a', pin: '#ef476f', gate: '#9b5d1d', err: '#c1121f', shadow: '#0a0b14', soft: '#6c757d',
}).map(([k, v]) => [k, hex(v)]));

/** El diálogo de la pizarra: un corcho con una hoja clavada, como en la vista web. */
function drawBrief(scr, L, model) {
  const b = model.brief;
  const opts = briefOptions({ targets: model.targets || [] }, b.sel);
  const w = Math.min(L.cols - 2, 88);
  const iw = w - 8; // ancho útil dentro de la hoja
  const labelW = 10;
  const rows = []; // cada fila: (row, col) => void

  const text = (str, fg, bg = CB.paper) => (row, col) => scr.text(col, row, fit(str, iw), fg, bg);
  const field = (name, label, value) => (row, col) => {
    const focus = b.field === name;
    scr.text(col, row, label.padEnd(labelW), focus ? C.ink : CB.soft, CB.paper);
    const v = fit(value || '—', iw - labelW - 4);
    if (focus) scr.text(col + labelW, row, ` ◂ ${v} ▸ `, C.accent, C.ink);
    else scr.text(col + labelW, row, `   ${v}`, C.ink, CB.paper);
  };

  rows.push((row, col) => {
    scr.text(col, row, t('brief.title'), C.ink, CB.paper);
    const x = t('brief.close');
    scr.text(col + iw - strWidth(x), row, x, CB.soft, CB.paper);
  });
  rows.push(text('┄'.repeat(iw), CB.soft));
  rows.push(field('target', t('brief.agent'), opts.target ? targetLabel(opts.target) : t('brief.noAgent')));
  rows.push(field('entry', t('brief.pipeline'), opts.entry?.label));
  const desc = opts.entry ? [opts.entry.description, opts.entry.source && opts.entry.source !== 'agente' ? `(${opts.entry.source})` : ''].filter(Boolean).join(' ')
    : t('brief.registerHint');
  for (const line of wrap(desc, iw - labelW - 3, 2)) rows.push((row, col) => scr.text(col + labelW + 3, row, line, CB.soft, CB.paper));
  rows.push(field('session', t('brief.session'), opts.session?.label));
  // la tarea, en una nota amarilla
  const focusTask = b.field === 'task';
  const noteW = iw - labelW;
  const noteLines = b.text ? wrap(b.text, noteW - 3, 3) : [''];
  noteLines.forEach((line, i) => rows.push((row, col) => {
    scr.text(col, row, i === 0 ? t('brief.prompt').padEnd(labelW) : ' '.repeat(labelW), focusTask ? C.ink : CB.soft, CB.paper);
    scr.fill(col + labelW, row, noteW, CB.note);
    if (!b.text) scr.text(col + labelW + 1, row, fit(t('brief.placeholder'), noteW - 3), CB.soft, CB.note);
    else scr.text(col + labelW + 1, row, line, C.ink, CB.note);
    if (focusTask && i === noteLines.length - 1) scr.text(col + labelW + 1 + (b.text ? strWidth(line) : 0), row, '▌', C.ink, CB.note);
  }));

  // etapas
  const stages = opts.stages;
  const fixedBelow = 3; // problema + regla + ayuda
  const room = L.rows - 4 - rows.length - fixedBelow - 2;
  if (stages.length && room > 2) {
    rows.push(text('', C.ink));
    rows.push(text(t('brief.stages', { who: t(opts.entry?.devteam ? 'brief.bySession' : 'brief.byHarness') }), CB.soft));
    const withGates = room - 1 >= stages.length + stages.filter((s) => s.check).length;
    let left = room - 1;
    for (const [i, st] of stages.entries()) {
      if (left <= 0) { rows.push(text(t('brief.more', { n: stages.length - i }), CB.soft)); break; }
      left--;
      rows.push((row, col) => {
        let c = col + scr.text(col, row, `${String(i + 1).padStart(2)} `, CB.soft, CB.paper);
        c += scr.text(c, row, '■ ', hex(TEAM[st.role]?.shirt || '#888888'), CB.paper);
        const who = `${TEAM[st.role]?.name || st.role} · ${phaseInfo(st.phase).label} — ${st.name}`;
        const how = [st.agent, st.model].filter(Boolean).join(' · ');
        const howW = Math.min(strWidth(how), Math.floor(iw * 0.45));
        c += scr.text(c, row, fit(who, col + iw - c - howW - 2), C.ink, CB.paper);
        scr.text(col + iw - howW, row, fit(how, howW), CB.soft, CB.paper);
      });
      if (st.check && withGates) {
        left--;
        const gate = t('brief.gate', { run: st.check.run, expect: t(st.check.expect === 'pass' ? 'brief.pass' : 'brief.fail'), loop: st.onFail ? t('brief.loop', { goto: st.onFail.goto, max: st.onFail.max }) : '' });
        rows.push((row, col) => scr.text(col + 5, row, fit(gate, iw - 5), CB.gate, CB.paper));
      }
    }
  }

  const problem = b.error || (b.text.trim() ? briefProblem(opts, b.text) : '');
  rows.push(text(problem ? `✖ ${problem}` : '', CB.err));
  rows.push(text('┄'.repeat(iw), CB.soft));
  rows.push((row, col) => {
    let c = col;
    for (const [k, label] of [['tab', t('brief.keyField')], ['◂▸', t('brief.keyCycle')], ['Enter', t('brief.go')], ['Esc', t('brief.cancel')]]) {
      c += scr.text(c, row, k, C.ink, CB.paper);
      c += scr.text(c, row, ` ${label}   `, CB.soft, CB.paper);
    }
  });

  const h = rows.length + 2;
  const x0 = Math.floor((L.cols - w) / 2), y0 = Math.max(1, Math.floor((L.rows - h) / 2));
  // sombra, corcho, hoja y chinche
  for (let r = y0 + 1; r <= y0 + h; r++) scr.fill(x0 + 1, r, w, CB.shadow);
  for (let r = y0; r < y0 + h; r++) {
    scr.fill(x0, r, w, CB.cork);
    for (let c = x0; c < x0 + w; c++) if ((c + r * 3) % 7 === 0 && (r === y0 || r === y0 + h - 1 || c < x0 + 2 || c >= x0 + w - 2)) scr.text(c, r, '·', CB.corkDot, CB.cork);
  }
  for (let r = y0 + 1; r < y0 + h - 1; r++) scr.fill(x0 + 2, r, w - 4, CB.paper);
  scr.text(x0 + Math.floor(w / 2), y0, '●', CB.pin, CB.cork);
  rows.forEach((draw, i) => draw(y0 + 1 + i, x0 + 4));
}

/** Personaje más cercano a una celda (para clics del ratón). */
export function agentAtCell(L, sim, col, row) {
  if (L.tooSmall) return null;
  let best = null, bestD = 4;
  for (const a of Object.values(sim.agents)) {
    if (a.hidden) continue;
    const x = L.ox + Math.round(a.x * L.s);
    const y = Math.floor((L.oy + Math.round((a.seated || a.perch ? a.y - 20 : a.y - 30) * L.s)) / 2);
    const d = Math.abs(col - x) / 2 + Math.abs(row - y);
    if (d < bestD) { best = a.id; bestD = d; }
  }
  return best;
}
