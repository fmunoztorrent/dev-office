// Render en canvas (navegador) de la simulación de sim.js.

import { createSim, W, H, SPOT, STATUS_ICON, PHASE_COLOR, phaseInfo, rand, onBoard } from './sim.js';
export { TEAM, PHASES, phaseInfo } from './sim.js';

const P = 3; // tamaño de un "pixel" del sprite
const FONT = '"VT323", ui-monospace, monospace';

export function createGame(canvas, { onSelect, onBoardClick } = {}) {
  const ctx = canvas.getContext('2d');
  const sim = createSim();
  const { agents } = sim;
  let selected = null;
  let hover = null;
  let hoverBoard = false;
  let last = performance.now();
  const clouds = [0, 1, 2, 3].map((i) => ({ x: i * 260 + rand(0, 80), y: rand(16, 60), s: rand(0.6, 1.1) }));

  // ---------------------------------------------------------------- dibujo

  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  function drawRoom(t) {
    // pared
    R(0, 0, W, 122, '#2e3550');
    R(0, 116, W, 6, '#232840');
    for (let x = 0; x < W; x += 48) R(x, 0, 2, 116, '#333b59');
    // ventanas
    for (const wx of [22, 818]) {
      R(wx - 4, 14, 128, 86, '#1b1f33');
      const g = ctx.createLinearGradient(0, 18, 0, 96);
      g.addColorStop(0, '#5aa9e6'); g.addColorStop(1, '#a7d8f5');
      ctx.fillStyle = g; ctx.fillRect(wx, 18, 120, 78);
      ctx.save(); ctx.beginPath(); ctx.rect(wx, 18, 120, 78); ctx.clip();
      for (const c of clouds) {
        const cx = ((c.x + t * 6 * c.s) % (W + 120)) - 60;
        R(cx, c.y + 10, 30 * c.s, 8, '#ffffffcc'); R(cx + 8, c.y + 4, 16 * c.s, 8, '#ffffffcc');
      }
      R(wx, 80, 120, 16, '#4c7a5a'); R(wx + 10, 70, 22, 26, '#3d5f8c'); R(wx + 60, 62, 18, 34, '#34507a'); R(wx + 90, 74, 24, 22, '#3d5f8c');
      ctx.restore();
      R(wx + 58, 18, 4, 78, '#1b1f33'); R(wx, 55, 120, 3, '#1b1f33');
    }
    // letrero
    R(160, 30, 152, 44, '#1b1f33');
    ctx.font = `22px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsl(${(t * 40) % 360} 90% 65%)`; ctx.fillText('DEV TEAM', 236, 44);
    ctx.fillStyle = '#ffd166'; ctx.fillText('OFFICE', 236, 62);
    // reloj
    R(688, 30, 44, 44, '#1b1f33'); R(692, 34, 36, 36, '#f4f1de');
    const d = new Date(), cx = 710, cy = 52;
    const hand = (ang, len, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); ctx.stroke(); };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * Math.PI / 6, 9, 3, '#222');
    hand(d.getMinutes() * Math.PI / 30, 14, 2, '#222');
    hand(d.getSeconds() * Math.PI / 30, 15, 1, '#e63946');
    // suelo
    for (let y = 122; y < H; y += 32) for (let x = 0; x < W; x += 32) R(x, y, 32, 32, ((x + y) / 32) % 2 ? '#c9b48a' : '#c2ab7f');
    R(0, 122, W, 4, '#9c8660');
    // alfombra de la mesa de reuniones
    R(SPOT.table.x - 130, SPOT.table.y - 52, 260, 126, '#6d597a');
    R(SPOT.table.x - 122, SPOT.table.y - 44, 244, 110, '#7f6a8c');
  }

  function drawBoard() {
    const x0 = 340, y0 = 10, w = 300, h = 104;
    R(x0 - 4, y0 - 4, w + 8, h + 8, hoverBoard ? '#ffd166' : '#8d99ae');
    R(x0, y0, w, h, '#f8f9fa');
    ctx.font = `15px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#2b2d42';
    const board = sim.board;
    ctx.fillText(fit(board.title ? `TAREA: ${board.title}` : 'Sin tarea — esperando al agente…', w - 12), x0 + 6, y0 + 3);
    const cols = [['POR HACER', 'pending', '#ffe08a'], ['EN CURSO', 'in_progress', '#9ad1ff'], ['HECHO', 'completed', '#a8e6a1']];
    const cw = (w - 16) / 3;
    cols.forEach(([label, status, color], i) => {
      const cx = x0 + 6 + i * (cw + 2);
      R(cx, y0 + 20, cw, 1, '#adb5bd');
      ctx.fillStyle = '#6c757d'; ctx.font = `13px ${FONT}`; ctx.fillText(label, cx + 2, y0 + 22);
      const items = board.todos.filter((t) => t.status === status);
      items.slice(0, 4).forEach((todo, j) => {
        const sy = y0 + 36 + j * 17;
        R(cx + 1, sy + 1, cw - 4, 15, '#00000022');
        R(cx, sy, cw - 4, 15, color);
        ctx.fillStyle = '#2b2d42'; ctx.font = `13px ${FONT}`;
        ctx.fillText(fit(todo.content, cw - 10), cx + 3, sy + 1);
      });
      if (items.length > 4) { ctx.fillStyle = '#6c757d'; ctx.fillText(`+${items.length - 4}`, cx + cw - 22, y0 + 22); }
    });
    if (hoverBoard) {
      ctx.font = `14px ${FONT}`;
      const tip = '✎ clic: nuevo encargo';
      const tw = ctx.measureText(tip).width + 12;
      R(x0 + w - tw - 4, y0 + h - 20, tw, 16, '#2b2d42');
      ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(tip, x0 + w - tw + 2, y0 + h - 12);
    }
    if (board.todos.length) {
      const done = board.todos.filter((t) => t.status === 'completed').length;
      R(x0, y0 + h - 4, w, 4, '#dee2e6');
      R(x0, y0 + h - 4, (w * done) / board.todos.length, 4, '#2a9d8f');
    }
  }

  function fit(text, maxW) {
    text = String(text ?? '');
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function drawPerson(a, now) {
    const c = a.cfg;
    let x = a.x, y = a.y;
    const walking = a.queue[0]?.t === 'walk';
    if (a.seated) y += 14;
    if (now < a.jumpUntil) y -= Math.abs(Math.sin(now / 120)) * 12;
    if (now < a.shakeUntil) x += Math.sin(now / 25) * 3;
    const px = (gx, gy, gw, gh, col) => R(x + gx * P, y + gy * P, gw * P, gh * P, col);
    const step = walking ? Math.sin(a.walkT * 14) : 0;

    // sombra
    if (!a.seated) { ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.ellipse(x, y, 14, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    // piernas
    if (!a.seated) {
      px(-3, -6 + (step > 0 ? -1 : 0), 2, 6, c.pants);
      px(1, -6 + (step < 0 ? -1 : 0), 2, 6, c.pants);
      px(-3, -1, 2, 1, '#222'); px(1, -1, 2, 1, '#222');
    }
    // torso
    px(-4, -13, 8, 7, c.shirt);
    px(-4, -7, 8, 1, '#00000030');
    // brazos
    const working = a.seated && a.state === 'working';
    const typing = working && Math.floor(now / 140) % 2;
    const typing2 = working && !typing;
    if (a.handUp) { px(-6, -19, 2, 7, c.shirt); px(-6, -20, 2, 2, c.skin); }
    else px(-6, -13 + (typing ? 1 : 0), 2, 6, c.shirt), px(-6, -7 + (typing ? 1 : 0), 2, 1, c.skin);
    px(4, -13 + (typing2 ? 1 : 0), 2, 6, c.shirt); px(4, -7 + (typing2 ? 1 : 0), 2, 1, c.skin);
    if (a.carry) { px(5, -10, 4, 5, '#fff'); px(6, -9, 2, 1, '#adb5bd'); px(6, -7, 2, 1, '#adb5bd'); }
    // cabeza
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
    if (a.state === 'done' || now < a.jumpUntil) px(-1, -16, 2, 1, '#7a2e2e');
    else if (a.state === 'blocked') px(-1, -16, 2, 1, '#333');

    // nombre si camina, icono de estado
    if (!a.seated) {
      ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#00000080'; ctx.fillText(c.name, x + 1, y - 21 * P - 1);
      ctx.fillStyle = '#fff'; ctx.fillText(c.name, x, y - 21 * P - 2);
    }
    const icon = STATUS_ICON[a.state] || (a.badges.size ? '🤖' : '');
    if (icon) {
      ctx.font = '16px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const bob = Math.sin(now / 250) * 2;
      ctx.fillText(icon, x + 20, y - 18 * P + bob);
    }
    // Etiqueta del rol "de turno" con su fase (p. ej. ▶ RED), a la izquierda de la cabeza.
    const { turn, turnPhase } = sim;
    if (turn === a.id && turnPhase) {
      const label = `▶ ${phaseInfo(turnPhase).label}`;
      ctx.font = `15px ${FONT}`;
      const w = ctx.measureText(label).width + 10;
      const tx = x - 20 - w, ty = y - 20 * P - 1 + Math.sin(now / 300) * 1.5;
      R(tx, ty, w, 15, '#1b1f33');
      R(tx + 1, ty + 1, w - 2, 13, PHASE_COLOR[turnPhase] || c.shirt);
      ctx.fillStyle = '#1b1f33'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, tx + 5, ty + 8);
    }
    if (selected === a.id || hover === a.id) {
      ctx.strokeStyle = selected === a.id ? '#ffd166' : '#ffffff99'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(a.seated ? a.cfg.seat.x : a.x, (a.seated ? a.cfg.seat.y + 26 : a.y), 26, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawChair(a) {
    const s = a.cfg.seat;
    R(s.x - 16, s.y - 40, 32, 34, '#3a3f58');
    R(s.x - 14, s.y - 38, 28, 30, '#4a5070');
  }

  function drawDesk(a, now) {
    const s = a.cfg.seat, c = a.cfg;
    const busy = a.state === 'working' || a.state === 'thinking' || a.state === 'red';
    // superficie y frente
    R(s.x - 50, s.y - 14, 100, 14, '#a0703f');
    R(s.x - 50, s.y - 2, 100, 26, '#7c5230');
    R(s.x - 50, s.y - 2, 100, 3, '#5d3b20');
    // placa con nombre
    R(s.x - 38, s.y + 6, 76, 14, '#1b1f33');
    ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = c.shirt; ctx.fillText(fit(`${c.name} · ${c.title}`, 72), s.x, s.y + 13);

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
    // props por rol
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
    // subagentes asignados: carpetas en el escritorio
    let i = 0;
    for (let k = 0; k < a.badges.size; k++) {
      if (i > 2) break;
      R(s.x - 46 + i * 4, s.y - 30 - i * 3, 18, 13, '#ffb703'); R(s.x - 46 + i * 4, s.y - 32 - i * 3, 8, 3, '#fb8500');
      i++;
    }
  }

  function drawProps(now) {
    // rack de servidores junto al backend
    const rx = 572, ry = 150;
    R(rx, ry, 42, 92, '#1b1f33'); R(rx + 2, ry + 2, 38, 88, '#2b2d42');
    const be = agents.backend.state === 'working';
    for (let i = 0; i < 6; i++) {
      R(rx + 5, ry + 6 + i * 14, 32, 10, '#3a3f58');
      for (let j = 0; j < 3; j++) {
        const on = be ? Math.random() > 0.4 : (Math.floor(now / 900) + i + j) % 4 === 0;
        R(rx + 8 + j * 5, ry + 9 + i * 14, 3, 3, on ? (j === 2 ? '#ffd166' : '#06d6a0') : '#1b1f33');
      }
    }
    // máquina de café
    R(898, 128, 40, 30, '#3d405b'); R(902, 110, 32, 22, '#e07a5f'); R(912, 140, 12, 10, '#222'); R(914, 146, 8, 6, '#fff');
    // plantas
    for (const [x, y] of [[20, 560], [930, 560], [640, 372]]) {
      R(x - 10, y - 14, 20, 16, '#b5651d');
      R(x - 14, y - 34, 10, 20, '#2a9d8f'); R(x - 2, y - 42, 10, 28, '#3fb68b'); R(x + 6, y - 30, 10, 16, '#2a9d8f');
    }
    // mesa de reuniones
    ctx.fillStyle = '#5d3b20'; ctx.beginPath(); ctx.ellipse(SPOT.table.x, SPOT.table.y + 4, 84, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8c5a33'; ctx.beginPath(); ctx.ellipse(SPOT.table.x, SPOT.table.y, 84, 24, 0, 0, Math.PI * 2); ctx.fill();
    R(SPOT.table.x - 20, SPOT.table.y - 8, 14, 10, '#fff'); R(SPOT.table.x + 12, SPOT.table.y - 4, 8, 8, '#e07a5f');
    // sofá
    R(300, 540, 120, 34, '#457b9d'); R(300, 528, 120, 16, '#3a6a88'); R(292, 532, 14, 42, '#3a6a88'); R(414, 532, 14, 42, '#3a6a88');
  }

  function drawBubble(a, now) {
    const b = a.bubble;
    if (!b) return;
    const x = a.seated ? a.cfg.seat.x : a.x;
    const y = (a.seated ? a.cfg.seat.y + 14 : a.y) - 22 * P - 8;
    ctx.font = `16px ${FONT}`;
    const lines = wrap(b.text, 176, 3);
    const w = Math.min(190, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14);
    const h = lines.length * 15 + 8;
    const bx = Math.max(4, Math.min(W - w - 4, x - w / 2)), by = Math.max(4, y - h);
    const fade = Math.min(1, (b.until - now) / 300);
    ctx.globalAlpha = Math.max(0, fade);
    const border = b.tone === 'error' ? '#e63946' : b.tone === 'warn' ? '#f4a261' : '#2b2d42';
    R(bx - 2, by - 2, w + 4, h + 4, border);
    R(bx, by, w, h, b.tone === 'error' ? '#ffe5e5' : b.tone === 'warn' ? '#fff3e0' : '#ffffff');
    R(Math.max(bx + 6, Math.min(bx + w - 12, x - 4)), by + h, 8, 4, border);
    ctx.fillStyle = '#2b2d42'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 4 + i * 15));
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

  function drawParticles() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of sim.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      if (p.kind === 'code') { ctx.font = `16px ${FONT}`; ctx.fillStyle = p.color; ctx.fillText(p.ch, p.x, p.y); }
      else if (p.kind === 'bug') { ctx.font = '16px system-ui, "Apple Color Emoji", sans-serif'; ctx.fillText('🐞', p.x, p.y); }
      else if (p.kind === 'check') { ctx.font = `18px ${FONT}`; ctx.fillStyle = '#06d6a0'; ctx.fillText('✓', p.x, p.y); }
      else R(p.x, p.y, p.kind === 'confetti' ? 4 + Math.sin(p.rot) * 2 : 3, p.kind === 'confetti' ? 6 : 3, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner(now) {
    const banner = sim.banner;
    if (!banner) return;
    const colors = { warn: ['#f4a261', '#2b2d42'], done: ['#2a9d8f', '#fff'], chat: ['#3f73f0', '#fff'] }[banner.tone] || ['#2b2d42', '#fff'];
    const pulse = banner.tone === 'warn' ? 0.85 + Math.sin(now / 200) * 0.15 : 1;
    ctx.globalAlpha = pulse;
    R(0, H - 34, W, 34, colors[0]);
    ctx.globalAlpha = 1;
    ctx.font = `20px ${FONT}`; ctx.fillStyle = colors[1]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fit(banner.text, W - 40), W / 2, H - 17);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    sim.step(dt, now);

    drawRoom(t);
    drawBoard();
    // orden por profundidad: sillas → personas sentadas → escritorios; caminantes por su y
    const items = [];
    for (const a of Object.values(agents)) {
      const s = a.cfg.seat;
      items.push({ y: s.y - 1, fn: () => drawChair(a) });
      items.push({ y: s.y + 1, fn: () => drawDesk(a, now) });
      items.push({ y: a.seated ? s.y : a.y, fn: () => drawPerson(a, now) });
    }
    items.push({ y: 242, fn: () => drawProps(now) });
    items.sort((p, q) => p.y - q.y).forEach((i) => i.fn());
    drawParticles();
    for (const a of Object.values(agents)) drawBubble(a, now);
    drawBanner(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- interacción

  function agentAt(mx, my) {
    let best = null, bestD = 40;
    for (const a of Object.values(agents)) {
      const x = a.seated ? a.cfg.seat.x : a.x;
      const y = (a.seated ? a.cfg.seat.y + 14 : a.y) - 33;
      const d = Math.hypot(mx - x, my - y);
      if (d < bestD) { best = a.id; bestD = d; }
    }
    return best;
  }
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  canvas.addEventListener('mousemove', (e) => {
    const [x, y] = toCanvas(e);
    hover = agentAt(x, y);
    hoverBoard = !hover && onBoard(x, y);
    canvas.style.cursor = hover || hoverBoard ? 'pointer' : 'default';
  });
  canvas.addEventListener('mouseleave', () => { hover = null; hoverBoard = false; });
  canvas.addEventListener('click', (e) => {
    const [x, y] = toCanvas(e);
    const who = agentAt(x, y);
    if (!who && onBoard(x, y)) return onBoardClick?.();
    selected = who;
    onSelect?.(selected);
  });


  return {
    handle: sim.handle,
    agents,
    setBoard: sim.setBoard,
    select(id) { selected = id; },
    reset: sim.reset,
  };
}
