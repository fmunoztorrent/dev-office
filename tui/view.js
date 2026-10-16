// Dibuja la simulación (public/sim.js) en el framebuffer de terminal.
// El mundo de 960×600 se escala a los píxeles disponibles; el texto va en celdas encima.

import { W, H, TEAM, SPOT, BOARD, STATUS_ICON, PHASE_COLOR, phaseInfo } from '../public/sim.js';
import { hex, mix, fit, wrap, strWidth } from './screen.js';
import { AGENT_NAME, TASK_STATUS } from '../public/targets.js';
import { briefOptions, briefFields, briefProblem, targetLabel } from '../public/brief.js';

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
}).map(([k, v]) => [k, hex(v)]));

const STATE_LABEL = { idle: 'libre', working: 'trabajando', thinking: 'pensando', blocked: 'bloqueado', waiting: 'esperando', done: 'listo', coffee: 'café', talking: 'hablando', red: 'en rojo' };
const STATE_COLOR = { idle: C.muted, working: C.blue, thinking: C.purple, talking: C.purple, blocked: C.err, red: C.err, waiting: C.warn, done: C.ok, coffee: C.muted };
const SESSION_LABEL = { active: 'en curso', waiting: 'esperándote', done: 'terminada', ended: 'cerrada' };
const STAGE_ICON = { pending: '◷', running: '▶', done: '✔', failed: '✖', skipped: '⊘', cancelled: '⊘' };

export function computeLayout(cols, rows) {
  const panelW = cols >= 110 ? Math.min(54, Math.max(34, Math.floor(cols * 0.28))) : 0;
  const sceneCols = cols - panelW - (panelW ? 1 : 0);
  const sceneRows = rows - 2; // cabecera + pie
  const s = Math.min(sceneCols / W, (sceneRows * 2) / H);
  const pw = Math.floor(W * s), ph = Math.floor(H * s);
  const ox = Math.max(0, Math.floor((sceneCols - pw) / 2));
  const oyRow = 1 + Math.max(0, Math.floor((sceneRows - Math.ceil(ph / 2)) / 2));
  return { cols, rows, panelW, panelX: cols - panelW, sceneCols, sceneRows, s, pw, ph, ox, oy: oyRow * 2, tooSmall: cols < 60 || rows < 18 };
}

export function drawFrame(scr, L, sim, model, now) {
  scr.clear(C.appBg);
  if (L.tooSmall) {
    const msg = 'Agranda la terminal (mínimo 60×18) · q para salir';
    scr.text(Math.max(0, Math.floor((L.cols - strWidth(msg)) / 2)), Math.floor(L.rows / 2), msg, C.accent, C.appBg);
    return;
  }
  const g = geometry(scr, L);
  drawRoom(g, now);
  drawBoard(g, sim);
  const items = [];
  for (const a of Object.values(sim.agents)) {
    const s = a.cfg.seat;
    items.push({ y: s.y - 1, fn: () => drawChair(g, a) });
    items.push({ y: s.y + 1, fn: () => drawDesk(g, a, now) });
    items.push({ y: a.seated ? s.y : a.y, fn: () => drawPerson(g, a, sim, model, now) });
  }
  items.push({ y: 242, fn: () => drawProps(g, sim, now) });
  items.sort((p, q) => p.y - q.y).forEach((i) => i.fn());
  drawParticles(g, sim);
  // Burbujas: las más nuevas se colocan primero; si chocan con otra, suben.
  const placed = [];
  const withBubble = Object.values(sim.agents).filter((a) => a.bubble).sort((a, b) => b.bubble.until - a.bubble.until);
  for (const a of withBubble) drawBubble(g, a, placed);
  drawBanner(g, sim, now);
  drawHeader(scr, L, model);
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
    // texto centrado en una x del mundo, sin salirse de la escena
    centered(wx, row, str, fg, bg) {
      const w = strWidth(str);
      const col = Math.max(L.ox, Math.min(L.ox + L.pw - w, X(wx) - Math.floor(w / 2)));
      scr.text(col, row, str, fg, bg, L.ox + L.pw - col);
    },
  };
}

function drawRoom(g, now) {
  const { rect, scr, X, Y } = g;
  rect(0, 0, W, 122, C.wall);
  for (let x = 0; x < W; x += 96) rect(x, 0, 2, 116, C.wallLine);
  rect(0, 116, W, 6, C.baseboard);
  // ventanas con una nube que pasa
  for (const wx of [22, 818]) {
    rect(wx - 4, 14, 128, 86, C.frame);
    rect(wx, 18, 120, 40, C.sky1);
    rect(wx, 58, 120, 38, C.sky2);
    rect(wx, 82, 120, 14, C.hill);
    rect(wx + 10, 70, 22, 26, C.city); rect(wx + 60, 62, 18, 34, C.city); rect(wx + 90, 74, 24, 22, C.city);
    const cx = wx + ((now / 1000) * 8 + wx) % 110;
    rect(cx, 30, 16, 6, C.white); rect(cx + 4, 26, 8, 4, C.white);
    rect(wx + 58, 18, 4, 78, C.frame);
  }
  // letrero y reloj
  rect(160, 30, 152, 44, C.frame);
  const r = g.row(52);
  const hue = Math.floor(now / 400) % 4;
  g.centered(236, r - (g.s > 0.12 ? 1 : 0), 'DEV TEAM', [C.accent, C.ok, C.blue, C.err][hue], C.frame);
  if (g.s > 0.12) g.centered(236, r, 'OFFICE', C.accent, C.frame);
  rect(688, 30, 44, 44, hex('#f4f1de'));
  const d = new Date();
  g.centered(710, g.row(52), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, C.ink, hex('#f4f1de'));
  // suelo a cuadros (baldosas de 32 del mundo)
  const fy0 = Y(122), fy1 = Y(H), fx0 = X(0), fx1 = X(W);
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) {
    const wx = (x - g.L.ox) / g.s, wy = (y - g.L.oy) / g.s;
    scr.pset(x, y, (Math.floor(wx / 32) + Math.floor(wy / 32)) % 2 ? C.floor1 : C.floor2);
  }
  rect(0, 122, W, 4, C.floorEdge);
  rect(SPOT.table.x - 130, SPOT.table.y - 52, 260, 126, C.rug1);
  rect(SPOT.table.x - 122, SPOT.table.y - 44, 244, 110, C.rug2);
}

function drawBoard(g, sim) {
  const { rect, scr, X } = g;
  const board = sim.board;
  rect(336, 6, 308, 112, C.boardFrame);
  rect(340, 10, 300, 104, C.paper);
  const c0 = X(344), c1 = X(636);
  const r0 = Math.ceil(g.Y(10) / 2), r1 = Math.floor(g.Y(114) / 2) - 1;
  const width = c1 - c0;
  if (r1 < r0 || width < 12) return;
  const title = board.title ? `TAREA: ${board.title}` : 'Sin tarea: esperando al agente…';
  scr.text(c0, r0, fit(title, width), C.ink, C.paper);
  const todos = board.todos || [];
  const cols = [['POR HACER', 'pending', C.sticky1], ['EN CURSO', 'in_progress', C.sticky2], ['HECHO', 'completed', C.sticky3]];
  const avail = r1 - r0 - 1; // filas para columnas
  if (avail < 2) {
    if (avail >= 1) {
      const n = (st) => todos.filter((t) => t.status === st).length;
      scr.text(c0, r0 + 1, fit(`hacer ${n('pending')} · curso ${n('in_progress')} · hecho ${n('completed')}`, width), C.inkMuted, C.paper);
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
    rect(340, 110, 300, 4, hex('#dee2e6'));
    rect(340, 110, Math.max(1, (300 * done) / todos.length), 4, hex('#2a9d8f'));
  }
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
  // rack de servidores (parpadea cuando trabaja backend)
  rect(572, 150, 42, 92, C.frame);
  rect(574, 152, 38, 88, C.rack);
  const be = sim.agents.backend.state === 'working';
  const x0 = X(578), rows = Math.max(2, Math.floor((Y(236) - Y(156)) / 2));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < 3; j++) {
      const on = be ? Math.random() > 0.4 : (Math.floor(now / 900) + i + j) % 4 === 0;
      scr.pset(x0 + j * 2, Y(156) + i * 2, on ? (j === 2 ? C.accent : C.ok) : C.rackSlot);
    }
  }
  // café, plantas, mesa, sofá
  rect(898, 128, 40, 30, C.coffee); rect(902, 110, 32, 22, C.coffeeTop); rect(914, 140, 10, 10, C.white);
  for (const [x, y] of [[20, 560], [930, 560], [640, 372]]) {
    rect(x - 10, y - 14, 20, 16, C.pot);
    rect(x - 14, y - 34, 10, 20, C.leaf1); rect(x - 2, y - 42, 10, 28, C.leaf2); rect(x + 6, y - 30, 10, 16, C.leaf1);
  }
  g.ellipse(SPOT.table.x, SPOT.table.y + 4, 84, 26, C.tableEdge);
  g.ellipse(SPOT.table.x, SPOT.table.y, 84, 24, C.table);
  rect(300, 528, 120, 16, C.sofaBack); rect(300, 540, 120, 34, C.sofa); rect(292, 532, 14, 42, C.sofaBack); rect(414, 532, 14, 42, C.sofaBack);
}

// Sprites a escala de terminal: 5×10 (grande) o 3×6 (chico), anclados en los pies.
function drawPerson(g, a, sim, model, now) {
  const { scr, X, Y, L } = g;
  const c = a.cfg;
  const big = g.s >= 0.14;
  const sw = big ? 5 : 3, sh = big ? 10 : 6;
  const skin = hex(c.skin), hair = hex(c.hair), shirt = hex(c.shirt), pants = hex(c.pants);
  let fx = X(a.seated ? c.seat.x : a.x), top;
  if (a.seated) top = Y(c.seat.y - 14) - (big ? 6 : 3);
  else top = Y(a.y) - sh;
  if (now < a.jumpUntil) top -= Math.round(Math.abs(Math.sin(now / 120)) * 2);
  if (now < a.shakeUntil) fx += Math.round(Math.sin(now / 25));
  const x0 = fx - Math.floor(sw / 2);
  const P = (dx, dy, col) => scr.pset(x0 + dx, top + dy, col);
  const rowsToDraw = a.seated ? (big ? 7 : 4) : sh;
  const blink = Math.floor(now / 100) % 40 === 0;
  const eye = blink ? skin : C.black;
  const walking = a.walking;
  const step = walking ? Math.sin(a.walkT * 14) > 0 : false;
  const typing = a.seated && a.state === 'working' && Math.floor(now / 140) % 2;

  scr.clearText(x0 - 1, top, sw + 2, rowsToDraw); // tapa el texto que quede detrás
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
    if (a.carry) { P(5, 4, C.white); P(5, 5, C.white); }
    if (!a.seated) {
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
    if (a.carry) P(3, 2, C.white);
    if (!a.seated) { P(0, 4, pants); P(2, 4, pants); P(step ? 0 : 2, 5, C.shoe); P(step ? 2 : 0, 5, C.shoe); }
  }

  const headRow = Math.floor(top / 2);
  // selección: línea amarilla bajo los pies
  if (model.selected === a.id) {
    const y = a.seated ? Y(c.seat.y + 24) : top + sh;
    scr.rect(x0 - 1, y, sw + 2, 1, C.select);
  }
  if (!a.seated) g.centered(a.x, headRow - 1, c.name, C.white, -1);
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

function drawBubble(g, a, placed) {
  const b = a.bubble;
  const { scr, L, X, Y } = g;
  const x = X(a.seated ? a.cfg.seat.x : a.x);
  const top = a.seated ? Y(a.cfg.seat.y - 14) - 6 : Y(a.y) - 10;
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
    else scr.pset(x, y, hex(p.color));
  }
}

function drawBanner(g, sim, now) {
  const banner = sim.banner;
  if (!banner) return;
  const { scr, L } = g;
  const tone = { warn: [C.warn, C.ink], done: [hex('#2a9d8f'), C.white], chat: [hex('#3f73f0'), C.white] }[banner.tone] || [C.ink, C.white];
  const pulse = banner.tone === 'warn' && Math.floor(now / 500) % 2 ? mix(tone[0], C.white, 0.15) : tone[0];
  const row = Math.floor((L.oy + L.ph) / 2) - 1;
  scr.fill(L.ox, row, L.pw, pulse);
  const text = fit(banner.text, L.pw - 2);
  scr.text(L.ox + Math.floor((L.pw - strWidth(text)) / 2), row, text, tone[1], pulse);
}

// ------------------------------------------------------------------ cabecera, pie y panel

function drawHeader(scr, L, model) {
  scr.fill(0, 0, L.cols, C.headerBg);
  let c = scr.text(0, 0, ' ▣ DEV TEAM OFFICE ', C.accent, C.headerBg);
  const conn = model.connection;
  c += scr.text(c, 0, ` ● ${conn.label} `, conn.ok ? C.ok : C.err, C.headerBg);
  const api = ` API ${model.endpoints.join(' · ')} `;
  c += scr.text(c, 0, fit(api, L.cols - c - 10), C.muted, C.headerBg);
  const t = new Date().toLocaleTimeString('es', { hour12: false });
  scr.text(L.cols - t.length - 1, 0, t, C.text, C.headerBg);
  // ⚙ Ajustes: se abre con un clic aquí o con la tecla c
  L.gearCol = L.cols - t.length - 5;
  scr.text(L.gearCol, 0, ' ⚙ ', model.settings ? C.headerBg : C.accent, model.settings ? C.accent : C.headerBg);
}

function drawFooter(scr, L, model) {
  const row = L.rows - 1;
  scr.fill(0, row, L.cols, C.headerBg);
  if (model.chat !== null) {
    const label = model.selected ? ` Mensaje para ${TEAM[model.selected].name}: ` : ' Mensaje al equipo: ';
    const c = scr.text(0, row, label, C.accent, C.headerBg);
    const hint = '  Enter enviar · Esc cancelar ';
    const shown = fit(model.chat, L.cols - c - strWidth(hint) - 2);
    const cc = scr.text(c, row, shown, C.text, C.headerBg);
    scr.text(c + cc, row, '▌', C.accent, C.headerBg);
    scr.text(L.cols - strWidth(hint), row, hint, C.muted, C.headerBg);
    return;
  }
  const keys = [['t', 'encargo (o clic en la pizarra)'], ['c', 'ajustes ⚙'], ['q', 'salir'], ['tab', 'elegir'], ['m', 'mensaje'], ['s', 'saludar'], ['x', 'cancelar'], ['d', 'demo'], ['p', 'demo TDD'], ['r', 'reiniciar'], ['esc', 'soltar']];
  let c = 1;
  for (const [k, label] of keys) {
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
  heading('TAREA', s ? `${s.source} · ${s.id.slice(0, 10)}` : '');
  const titleLines = wrap(s?.title || (s ? 'Sesión sin tarea todavía' : 'Esperando eventos de un agente…'), inner, 2);
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
    T(`${s.tools} acciones · ${s.errors} errores · ${subs} sub · ${SESSION_LABEL[s.status] || s.status}`, s.errors ? C.warn : C.muted);
    r++;
  }
  r++;

  // FLUJO por roles
  const flow = s?.flow || [];
  if (flow.length && r < maxR - 10) {
    heading('FLUJO');
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
    heading('PIPELINES');
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
    heading('TAREAS', `${(model.tasks.agents || []).length} agente(s) conectado(s)`);
    for (const t of tasks) {
      if (r > maxR) break;
      const [icon, label, tone] = TASK_STATUS[t.status] || ['·', t.status, 'muted'];
      const color = C[tone];
      scr.text(x + 1, r, icon, color, C.panelBg);
      const who = `${AGENT_NAME[t.agent] || t.agent}${t.mode === 'launch' ? '+' : ''}`;
      let c = x + 3 + scr.text(x + 3, r, who, C.text, C.panelBg);
      T(` ${t.text}`, C.muted, c, x + w - 1 - c - strWidth(label) - 1);
      scr.text(x + w - 1 - strWidth(label), r, label, color, C.panelBg);
      r++;
      const extra = t.status === 'running' && t.output?.length ? t.output.at(-1) : ['failed', 'queued'].includes(t.status) ? t.detail : '';
      if (extra && r <= maxR) { T(`  ${extra}`, C.muted); r++; }
    }
    r++;
  }

  // EQUIPO
  heading('EQUIPO');
  const compact = maxR - r < 26;
  for (const [id, cfg] of Object.entries(TEAM)) {
    if (r > maxR) break;
    const a = sim.agents[id];
    const sel = model.selected === id;
    const bg = sel ? C.headerBg : C.panelBg;
    scr.fill(x, r, w, bg);
    scr.text(x + 1, r, '■', hex(cfg.shirt), bg);
    scr.text(x + 3, r, fit(`${cfg.name} · ${cfg.title}`, inner - 14), C.text, bg);
    const st = STATE_LABEL[a.state] || a.state;
    scr.text(x + w - 1 - strWidth(st), r, st, STATE_COLOR[a.state] || C.muted, bg);
    r++;
    if (!compact && r <= maxR) {
      scr.fill(x, r, w, bg);
      scr.text(x + 3, r, fit(a.text || 'Sin actividad', inner - 2), C.muted, bg);
      r++;
    }
  }
  r++;

  // DETALLE del seleccionado, o BITÁCORA
  if (model.selected) {
    const a = sim.agents[model.selected], cfg = TEAM[model.selected];
    heading(`DETALLE · ${cfg.name}`, cfg.title);
    if (!a.history.length) { T('Todavía no ha hecho nada.', C.muted); r++; }
    for (const h of a.history) {
      if (r > maxR) break;
      const time = new Date(h.ts).toLocaleTimeString('es', { hour12: false, hour: '2-digit', minute: '2-digit' });
      scr.text(x + 1, r, time, C.muted, C.panelBg);
      T(h.text, C.text, x + 7, inner - 6);
      r++;
    }
    return;
  }
  heading('BITÁCORA');
  for (const ev of model.log) {
    if (r > maxR) break;
    const cfg = TEAM[ev.role];
    const time = new Date(ev.ts).toLocaleTimeString('es', { hour12: false, hour: '2-digit', minute: '2-digit' });
    scr.text(x + 1, r, time, C.muted, C.panelBg);
    const who = ev.kind === 'chat' || ev.kind === 'poke' ? ev.from : cfg?.name || 'Oficina';
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
  if (ev.kind === 'phase_end') return `termina su turno${ev.text ? `: ${ev.text}` : ''}`;
  return ev.text || ev.kind;
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
    scr.text(col, row, 'Nuevo encargo', C.ink, CB.paper);
    const x = 'esc ✕';
    scr.text(col + iw - strWidth(x), row, x, CB.soft, CB.paper);
  });
  rows.push(text('┄'.repeat(iw), CB.soft));
  rows.push(field('target', 'Agente', opts.target ? targetLabel(opts.target) : 'ninguno: regístralo en ⚙ › Agentes'));
  rows.push(field('entry', 'Pipeline', opts.entry?.label));
  const desc = opts.entry ? [opts.entry.description, opts.entry.source && opts.entry.source !== 'agente' ? `(${opts.entry.source})` : ''].filter(Boolean).join(' ')
    : 'Registra un agente con su ruta completa (c › Agentes): el prompt arranca el pipeline de su harness.';
  for (const line of wrap(desc, iw - labelW - 3, 2)) rows.push((row, col) => scr.text(col + labelW + 3, row, line, CB.soft, CB.paper));
  rows.push(field('session', 'Sesión', opts.session?.label));
  // la tarea, en una nota amarilla
  const focusTask = b.field === 'task';
  const noteW = iw - labelW;
  const noteLines = b.text ? wrap(b.text, noteW - 3, 3) : [''];
  noteLines.forEach((line, i) => rows.push((row, col) => {
    scr.text(col, row, i === 0 ? 'Prompt'.padEnd(labelW) : ' '.repeat(labelW), focusTask ? C.ink : CB.soft, CB.paper);
    scr.fill(col + labelW, row, noteW, CB.note);
    if (!b.text) scr.text(col + labelW + 1, row, fit('¿Qué necesitas que haga el equipo?', noteW - 3), CB.soft, CB.note);
    else scr.text(col + labelW + 1, row, line, C.ink, CB.note);
    if (focusTask && i === noteLines.length - 1) scr.text(col + labelW + 1 + (b.text ? strWidth(line) : 0), row, '▌', C.ink, CB.note);
  }));

  // etapas
  const stages = opts.stages;
  const fixedBelow = 3; // problema + regla + ayuda
  const room = L.rows - 4 - rows.length - fixedBelow - 2;
  if (stages.length && room > 2) {
    rows.push(text('', C.ink));
    rows.push(text(`Etapas (las corre ${opts.entry?.devteam ? 'la sesión del agente' : 'el harness del agente'})`, CB.soft));
    const withGates = room - 1 >= stages.length + stages.filter((s) => s.check).length;
    let left = room - 1;
    for (const [i, st] of stages.entries()) {
      if (left <= 0) { rows.push(text(`… y ${stages.length - i} más`, CB.soft)); break; }
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
        const gate = `⚙ ${st.check.run} debe ${st.check.expect === 'pass' ? 'pasar' : 'fallar'}${st.onFail ? ` · si no, vuelve a ${st.onFail.goto} (×${st.onFail.max})` : ''}`;
        rows.push((row, col) => scr.text(col + 5, row, fit(gate, iw - 5), CB.gate, CB.paper));
      }
    }
  }

  const problem = b.error || (b.text.trim() ? briefProblem(opts, b.text) : '');
  rows.push(text(problem ? `✖ ${problem}` : '', CB.err));
  rows.push(text('┄'.repeat(iw), CB.soft));
  rows.push((row, col) => {
    let c = col;
    for (const [k, label] of [['tab', 'campo'], ['◂▸', 'cambia'], ['Enter', '▶ ¡A trabajar!'], ['Esc', 'cancelar']]) {
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
    const x = L.ox + Math.round((a.seated ? a.cfg.seat.x : a.x) * L.s);
    const y = Math.floor((L.oy + Math.round((a.seated ? a.cfg.seat.y - 20 : a.y - 30) * L.s)) / 2);
    const d = Math.abs(col - x) / 2 + Math.abs(row - y);
    if (d < bestD) { best = a.id; bestD = d; }
  }
  return best;
}
