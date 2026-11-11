// The building's two shared floors, as the game draws them (game.js hands this module its drawing
// toolkit, so the people and the window look the same as in the offices):
//
//   exec     the executive floor, on top: the directors give orders that cover several offices or
//            projects (directives). On the wall, the directives board and the company's screen
//            (how each office is doing); in the middle, the boardroom table.
//   archive  the archive, in the basement: the company's knowledge on the shelves, the skills rack
//            and the connectors' patch panel (MCP servers to outside information).
//
// The floors live on their own: their people chat, go for coffee and take the elevator, and they
// react to what the server tells (a directive sent or finished, an entry saved, read, installed…).

import { W, H, LEFT, ELEVATOR, rand, pick } from './sim.js';
import { BACK, unapply } from './iso.js';
import { t, ta } from './i18n.js';

export const FLOOR_IDS = ['exec', 'office', 'archive'];
const SPEED = 110;
const AISLE = 154; // the walkway along the back wall
const KIND_COLOR = { note: '#ffd166', decision: '#ef476f', doc: '#4cc9f0', minute: '#a8dadc', skill: '#06d6a0', connector: '#c77dff' };
const STATUS_COLOR = { running: '#ffd166', done: '#06d6a0', partial: '#f4a261', failed: '#ef476f', cancelled: '#8d99ae', interrupted: '#8d99ae' };

// ---------------------------------------------------------------- the layouts (the world is the office's: 960 × 600)

export const EXEC = {
  window: { x0: 10, x1: 300, top: 8, bottom: 112 },
  board: { x: 316, y: 10, w: 190, h: 106 },   // the directives (click: the directives)
  lift: { x: 522, w: 66, top: 22 },           // the elevator's doors
  screen: { x: 604, y: 8, w: 346, h: 110 },   // the company: each office (click: the directives)
  table: { x0: 300, x1: 700, y0: 300, y1: 372 },
  cart: { x: 920, y: 236 },
  plants: [[22, 594], [944, 420], [276, 214]],
};
export const ARCHIVE = {
  wells: { x0: 24, x1: 472, top: 6, bottom: 28 }, // the basement's light wells, at street level
  shelves: { x: 10, y: 34, w: 466, h: 90 },        // the knowledge (click: the archive)
  lift: { x: 494, w: 66, top: 22 },
  patch: { x: 578, y: 8, w: 178, h: 112 },         // the connectors (click: the connectors)
  rack: { x: 770, y: 8, w: 180, h: 112 },          // the skills (click: the skills)
  rows: [{ x0: 30, x1: 330, y: 270 }, { x0: 30, x1: 330, y: 380 }, { x0: 30, x1: 330, y: 490 }],
  catalog: { x: 470, y: 300 },
  plants: [[944, 594], [420, 594]],
};

const PEOPLE = {
  exec: {
    ceo: { name: '', shirt: '#e0607e', pants: '#3b3355', hair: '#5a3214', skin: '#f2c9a0', long: true, seat: { x: 840, y: 500 }, desk: true, you: true },
    coo: { name: 'Ignacio', shirt: '#264653', pants: '#1d2a33', hair: '#2b2b2b', skin: '#e0ac7e', seat: { x: 420, y: 296 } },
    cto: { name: 'Rafael', shirt: '#3a86ff', pants: '#222b3a', hair: '#6b4f3a', skin: '#c98e62', glasses: true, beard: true, seat: { x: 580, y: 296 } },
    assistant: { name: 'Matías', shirt: '#e9c46a', pants: '#3a3a48', hair: '#1c1c1c', skin: '#b07a52', seat: { x: 130, y: 500 }, desk: true },
  },
  archive: {
    archivist: { name: 'Elena', shirt: '#9b5de5', pants: '#2e2a3d', hair: '#c9c9c9', skin: '#f0c8a8', long: true, glasses: true, seat: { x: 470, y: 330 }, desk: true },
    skills: { name: 'Bruno', shirt: '#06a77d', pants: '#22302b', hair: '#3b2a1a', skin: '#d9a273', seat: { x: 770, y: 470 }, desk: true },
    connectors: { name: 'Inés', shirt: '#f15bb5', pants: '#2b2d42', hair: '#141414', skin: '#8d5a3b', long: true, seat: { x: 760, y: 280 }, desk: true },
  },
};
/** Where the floor's people go when they have nothing to do. */
const SPOTS = {
  exec: [{ x: 920, y: 262, say: 'coffee' }, { x: 150, y: AISLE + 6, say: 'window' }, { x: 776, y: AISLE + 4, say: 'screen' }, { x: 410, y: AISLE + 4, say: 'board' }],
  archive: [{ x: 180, y: 320, say: 'shelf' }, { x: 220, y: 430, say: 'shelf' }, { x: 660, y: AISLE + 4, say: 'patch' }, { x: 860, y: AISLE + 4, say: 'rack' }, { x: 300, y: AISLE + 4, say: 'shelf' }],
};

// ---------------------------------------------------------------- the people

class Person {
  constructor(id, cfg, clock) {
    Object.assign(this, { id, cfg, clock, x: cfg.seat.x, y: cfg.seat.y, seated: true, queue: [], state: 'idle', bubble: null, badges: new Map(), walkT: 0, face: 1 });
    Object.assign(this, { carry: false, jumpUntil: 0, shakeUntil: 0, handUp: false, hidden: false, dance: false, food: null, back: false, perch: false, stateUntil: 0 });
  }
  get walking() { return this.queue[0]?.t === 'walk'; }
  get free() { return this.seated && !this.queue.length; }
  say(text, ms = 4200, tone) { this.bubble = { text, until: this.clock() + ms, tone }; return this; }
  setState(state, ms = 6000) { this.state = state; this.stateUntil = this.clock() + ms; }
  // along the walkway by the back wall: nobody crosses the boardroom table or the shelves
  goTo(pt) {
    const from = this.queue.findLast((j) => j.end)?.end || { x: this.x, y: this.y };
    const path = Math.abs(from.y - pt.y) < 8 ? [pt] : [{ x: from.x, y: AISLE }, { x: pt.x, y: AISLE }, pt];
    this.queue.push({ t: 'walk', path: path.map((p) => ({ x: p.x, y: p.y })), end: { x: pt.x, y: pt.y } });
    return this;
  }
  wait(ms) { this.queue.push({ t: 'wait', ms }); return this; }
  then(fn) { this.queue.push({ t: 'fn', fn }); return this; }
  goHome() { this.goTo(this.cfg.seat); this.queue.push({ t: 'sit' }); return this; }
  update(dt, now) {
    if (this.state !== 'idle' && now > this.stateUntil) this.state = 'idle';
    if (this.bubble && now > this.bubble.until) this.bubble = null;
    const job = this.queue[0];
    if (!job) return;
    if (job.t === 'walk') {
      this.seated = false;
      const p = job.path[0];
      if (!p) { this.queue.shift(); return; }
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy), step = SPEED * dt;
      if (d <= step) { this.x = p.x; this.y = p.y; job.path.shift(); } else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
      if (Math.abs(dx) > 1) this.face = Math.sign(dx);
      this.walkT += dt;
      if (!job.path.length) this.queue.shift();
    } else if (job.t === 'wait') {
      job.until ??= now + job.ms;
      if (now >= job.until) this.queue.shift();
    } else if (job.t === 'sit') {
      Object.assign(this, { x: this.cfg.seat.x, y: this.cfg.seat.y, seated: true });
      this.queue.shift();
    } else if (job.t === 'fn') {
      this.queue.shift();
      job.fn(this);
    }
  }
}

/** One floor: its people, its elevator and what it shows (directives, offices, the archive's counts). */
function createFloor(kind, { clock }) {
  const people = Object.fromEntries(Object.entries(PEOPLE[kind]).map(([id, cfg]) => [id, new Person(id, { ...cfg, seat: { ...cfg.seat } }, clock)]));
  const lift = kind === 'exec' ? EXEC.lift : ARCHIVE.lift;
  const floor = { kind, people, particles: [], lift: { openUntil: 0 }, data: {}, nextLife: clock() + 4000 };
  const door = { x: lift.x + lift.w / 2, y: AISLE };

  /** Someone takes the elevator (to the offices) and comes back after a while. */
  floor.ride = (p, ms = 3500, carry = 'card') => {
    if (!p) return;
    p.queue.length = 0;
    p.carry = carry;
    p.goTo(door).then(() => { floor.lift.openUntil = clock() + 900; p.hidden = true; })
      .wait(ms).then(() => { floor.lift.openUntil = clock() + 900; p.hidden = false; p.carry = false; }).wait(300).goHome();
  };
  floor.burst = (x, y, ch, n = 6) => { for (let i = 0; i < n; i++) floor.particles.push({ x: x + rand(-14, 14), y: y + rand(-10, 4), vx: rand(-20, 20), vy: rand(-60, -30), life: 1.4, ch }); };
  /** A click on someone: they say who they are and what they do. */
  floor.intro = (id) => people[id]?.say(t(`floors.${kind}.who.${id}`), 5000);
  floor.lines = (key, vars) => { const all = ta(key, vars); return Array.isArray(all) && all.length ? pick(all) : t(key, vars); };

  floor.step = (dt, now) => {
    for (const p of Object.values(people)) p.update(dt, now);
    for (const q of floor.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    floor.particles = floor.particles.filter((q) => q.life > 0);
    if (now < floor.nextLife) return;
    floor.nextLife = now + rand(7000, 14000);
    const free = Object.values(people).filter((p) => p.free && !p.cfg.you);
    if (!free.length) return;
    const p = pick(free);
    if (Math.random() < 0.45) { p.say(floor.lines(`floors.${kind}.chat`, { you: people.ceo?.cfg.name || '' })); return; }
    const spot = pick(SPOTS[kind]);
    p.goTo(spot).then((who) => who.say(floor.lines(`floors.${kind}.at.${spot.say}`))).wait(rand(2500, 5000)).goHome();
  };
  return floor;
}

/** The two floors. `handle` gets what the server tells about them ({ floor, kind, text, … }). */
export function createFloors({ clock = () => performance.now() } = {}) {
  const exec = createFloor('exec', { clock });
  const archive = createFloor('archive', { clock });
  const floors = { exec, archive };

  function handle(ev = {}) {
    const f = floors[ev.floor];
    if (!f) return;
    const P = f.people;
    const text = String(ev.text || '');
    if (ev.floor === 'exec') {
      if (ev.kind === 'directive') {
        P.ceo.say(t('floors.exec.react.order', { title: text }), 5000).setState('working', 5000);
        setTimeout(() => P.coo.say(t('floors.exec.react.split', { offices: (ev.offices || []).join(', ') || '—', n: ev.total || 0 }), 5000), 1500);
        setTimeout(() => P.cto.say(f.lines('floors.exec.react.tech'), 4000), 3200);
        setTimeout(() => f.ride(P.assistant, 4200), 2000);
      } else if (ev.kind === 'directive_end') {
        const good = ev.status === 'done';
        P.coo.say(t(`floors.exec.react.${good ? 'done' : 'trouble'}`, { title: text, done: ev.done ?? 0, total: ev.total ?? 0 }), 6000, good ? undefined : 'warn');
        if (good) { P.ceo.jumpUntil = clock() + 1400; f.burst(P.ceo.x, P.ceo.y - 40, '🎉', 8); } else { P.cto.shakeUntil = clock() + 900; P.cto.setState('blocked', 5000); }
      }
    } else {
      const who = ev.entryKind === 'skill' ? P.skills : ev.entryKind === 'connector' ? P.connectors : P.archivist;
      if (ev.kind === 'saved') {
        who.say(t('floors.archive.react.saved', { title: text, kind: t(`knowledgeKind.${ev.entryKind || 'note'}`) }), 4500);
        const shelf = ev.entryKind === 'skill' ? { x: 860, y: AISLE + 4 } : ev.entryKind === 'connector' ? { x: 666, y: AISLE + 4 } : { x: rand(60, 440), y: AISLE + 4 };
        who.queue.length = 0;
        who.carry = 'card';
        who.goTo(shelf).then((p) => { p.carry = false; f.burst(p.x, p.y - 70, '📄', 3); }).wait(1200).goHome();
      } else if (ev.kind === 'read' || ev.kind === 'search') {
        const p = P.archivist;
        p.queue.length = 0;
        p.goTo({ x: rand(60, 440), y: AISLE + 4 }).then((q) => { q.carry = 'card'; q.say(t(`floors.archive.react.${ev.kind}`, { title: text }), 4000); }).wait(1400).goHome().then((q) => { q.carry = false; });
      } else if (ev.kind === 'installed') {
        who.say(t('floors.archive.react.installed', { name: text, n: ev.count || 0 }), 5000);
        if (ev.count) f.ride(who, 3800, 'card');
      } else if (ev.kind === 'generate') {
        P.archivist.say(t('floors.archive.react.generate', { text, kind: t(`knowledgeKind.${ev.entryKind || 'skill'}`) }), 5500);
        setTimeout(() => f.ride(who, 3600), 1200);
      } else if (ev.kind === 'removed') {
        who.say(t('floors.archive.react.removed', { title: text }), 3500);
      }
    }
  }

  /** What each floor shows: { directives, overview } on the executive one, { archive } in the basement. */
  function setData({ directives, overview, archive: arc } = {}) {
    if (directives) exec.data.directives = directives;
    if (overview) exec.data.overview = overview;
    if (arc) archive.data.archive = arc;
  }

  /** You preside the executive floor: with your look as the PO (the offices' one). */
  function setYou(look = {}) {
    const c = exec.people.ceo.cfg;
    for (const k of ['name', 'shirt', 'pants', 'hair', 'skin', 'long', 'beard', 'glasses']) if (look[k] !== undefined) c[k] = look[k];
  }

  return { exec, archive, handle, setData, setYou, step(dt, now) { exec.step(dt, now); archive.step(dt, now); } };
}

// ---------------------------------------------------------------- what each click means

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** What is under the pointer: a person ({ person }) or a part of the floor ({ what }). */
export function floorHit(floor, X, Y, { iso = false, cam } = {}) {
  // the people first (they stand in front of everything)
  for (const p of Object.values(floor.people)) {
    if (p.hidden) continue;
    let hx = p.x, hy = (p.seated ? p.y + 14 : p.y) - 33;
    if (iso) [hx, hy] = cam.proj(p.x, p.y, 30);
    if (Math.hypot(X - hx, Y - hy) < (iso ? 26 : 34)) return { person: p.id };
  }
  const [x, y] = iso ? unapply(cam.front(BACK), X, Y) : [X, Y];
  if (y < 0 || y > BACK + 2) return null;
  if (iso && x >= ELEVATOR.x && x <= ELEVATOR.x + ELEVATOR.w) return { what: 'lift' }; // the building's, in the hallway
  if (floor.kind === 'exec') {
    if (inRect(x, y, EXEC.board)) return { what: 'directives' };
    if (inRect(x, y, EXEC.screen)) return { what: 'company' };
    if (x >= EXEC.lift.x && x <= EXEC.lift.x + EXEC.lift.w) return { what: 'lift' };
  } else {
    if (inRect(x, y, ARCHIVE.shelves)) return { what: 'knowledge' };
    if (inRect(x, y, ARCHIVE.patch)) return { what: 'connector' };
    if (inRect(x, y, ARCHIVE.rack)) return { what: 'skill' };
    if (x >= ARCHIVE.lift.x && x <= ARCHIVE.lift.x + ARCHIVE.lift.w) return { what: 'lift' };
  }
  return null;
}

// ---------------------------------------------------------------- drawing
//
// g: the game's toolkit — { ctx, R, use, ID, cam, box, poly, iso, FONT, EMOJI, fit, drawPerson,
// drawBubble, drawPlumbob, outdoorAt, isoBackdrop, shadow, scale }

export function drawFloor(g, floor, now, light, { hover, selected } = {}) {
  const { ctx } = g;
  const dark = Math.min(0.55, light?.night ?? 0);
  if (g.iso) drawIso(g, floor, now, light);
  else drawFlat(g, floor, now, light);
  g.use(g.ID);
  // the floor's particles (🎉, 📄) over everything, and its lights at night
  for (const q of floor.particles) {
    g.use(g.iso ? g.cam.billboard(q.x, q.y, q.x, q.y) : g.ID);
    ctx.globalAlpha = Math.max(0, Math.min(1, q.life));
    ctx.font = `16px ${g.EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(q.ch, q.x, q.y);
    ctx.globalAlpha = 1;
  }
  g.use(g.ID);
  if (dark > 0.05 && floor.kind === 'exec') { ctx.fillStyle = `rgba(10,14,40,${dark * 0.35})`; ctx.fillRect(0, 0, W, H); }
  for (const p of Object.values(floor.people)) { g.use(personM(g, p)); g.drawBubble(p, now); }
  if (floor.people[selected]) { g.use(personM(g, floor.people[selected])); g.drawPlumbob(floor.people[selected], now); }
  if (floor.people[hover] && hover !== selected) {
    const p = floor.people[hover];
    g.use(personM(g, p));
    ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(p.x, (p.seated ? p.y + 14 : p.y) + 12, 26, 7, 0, 0, Math.PI * 2); ctx.stroke();
  }
  g.use(g.ID);
}

const personM = (g, p) => (g.iso ? g.cam.billboard(p.x, p.seated ? p.y + 14 : p.y, p.x, p.seated ? p.y - 14 : p.y) : g.ID);

function drawFlat(g, floor, now, light) {
  const exec = floor.kind === 'exec';
  drawFloorPlane(g, floor);
  drawWall(g, floor, now, light);
  const items = [];
  for (const it of furniture(floor)) items.push({ y: it.y, fn: () => it.flat(g, now) });
  for (const p of Object.values(floor.people)) {
    items.push({ y: p.cfg.seat.y - 1, fn: () => (p.cfg.desk ? chair(g, p.cfg.seat, exec) : bigChair(g, p.cfg.seat)) });
    items.push({ y: p.seated ? p.cfg.seat.y : p.y, fn: () => g.drawPerson(p, now) });
  }
  items.sort((a, b) => a.y - b.y).forEach((i) => i.fn());
}

function drawIso(g, floor, now, light) {
  const { ctx, cam } = g;
  g.isoBackdrop(now, light, floor.kind);
  g.use(g.ID);
  const P0 = (x, y, z = 0) => cam.proj(x, y, z);
  const slab = 12;
  const edge = floor.kind === 'exec' ? '#2a1d16' : '#2b2f38';
  // the same footprint as an office's (the tower below is as wide): the room, and left of it the hallway
  // with the building's elevator and the bathroom
  g.poly([P0(LEFT, H), P0(W, H), P0(W, BACK), [P0(W, BACK)[0], P0(W, BACK)[1] + slab], [P0(W, H)[0], P0(W, H)[1] + slab], [P0(LEFT, H)[0], P0(LEFT, H)[1] + slab]], edge);
  ctx.save();
  g.use(cam.floor(0));
  ctx.beginPath(); ctx.rect(0, BACK, W, H - BACK); ctx.clip();
  drawFloorPlane(g, floor);
  ctx.restore();
  g.isoWing(now, { tag: floor.kind === 'exec' ? 'D' : 'A', doorAt: floor.lift.openUntil - 2400, wall: floor.kind === 'exec' ? '#3a2a24' : '#2f343f' });
  g.use(g.ID);
  ctx.save();
  g.use(cam.front(BACK));
  ctx.beginPath(); ctx.rect(0, 0, W, BACK); ctx.clip();
  drawWall(g, floor, now, light);
  ctx.restore();
  // furniture (volumes) and people (standing sprites), by depth: mostly how far from the back wall,
  // because the big pieces (the table, the shelving) are long along x
  const depth = (x, y) => y + x * 0.02;
  const items = [];
  for (const it of furniture(floor)) items.push({ d: depth(it.x, it.y), fn: () => (it.iso ? it.iso(g, now) : (g.use(cam.billboard(it.x, it.y, it.x, it.y)), it.flat(g, now))) });
  for (const p of Object.values(floor.people)) items.push({ d: depth(p.x, p.seated ? p.y - 14 : p.y) + 0.5, fn: () => { g.use(personM(g, p)); g.drawPerson(p, now); } });
  items.sort((a, b) => a.d - b.d).forEach((i) => i.fn());
}

// ---------------------------------------------------------------- the floor and the back wall

function drawFloorPlane(g, floor) {
  const { R } = g;
  if (floor.kind === 'exec') {
    // a deep blue carpet with a woven pattern, and a rug under the boardroom table
    R(0, BACK, W, H - BACK, '#24345a');
    for (let y = BACK; y < H; y += 24) for (let x = ((y / 24) % 2) * 12; x < W; x += 24) R(x, y, 12, 12, '#283a63');
    const tb = EXEC.table;
    R(tb.x0 - 40, tb.y0 - 40, tb.x1 - tb.x0 + 80, tb.y1 - tb.y0 + 110, '#6d2e46');
    R(tb.x0 - 34, tb.y0 - 34, tb.x1 - tb.x0 + 68, tb.y1 - tb.y0 + 98, '#7f3a55');
    R(tb.x0 - 26, tb.y0 - 26, tb.x1 - tb.x0 + 52, tb.y1 - tb.y0 + 82, '#6d2e46');
  } else {
    // concrete slabs with their joints, and the yellow safety line of the mobile shelving
    R(0, BACK, W, H - BACK, '#5c6370');
    for (let y = BACK; y < H; y += 60) R(0, y, W, 1, '#4f5560');
    for (let x = 0; x < W; x += 80) R(x, BACK, 1, H - BACK, '#4f5560');
    for (const r of ARCHIVE.rows) { R(r.x0 - 10, r.y + 18, r.x1 - r.x0 + 20, 3, '#e9c46a'); R(r.x0 - 10, r.y + 18, 3, 3, '#2b2d42'); }
  }
}

function drawWall(g, floor, now, light) {
  if (floor.kind === 'exec') drawExecWall(g, floor, now, light);
  else drawArchiveWall(g, floor, now, light);
}

function sign(g, text, x, y, color, size = 22) {
  const { ctx } = g;
  ctx.font = `${size}px ${g.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00000066'; ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function label(g, text, x, y, color, size = 14, align = 'left', maxW = 200) {
  const { ctx } = g;
  ctx.font = `${size}px ${g.FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(g.fit(text, maxW), x, y);
}

function drawLift(g, floor, lift, now, tag) {
  const { R } = g;
  const open = Math.max(0, Math.min(1, (floor.lift.openUntil - now) / 450)) * (floor.lift.openUntil > now ? 1 : 0);
  const x = lift.x, w = lift.w, top = lift.top;
  R(x - 4, top - 4, w + 8, 126 - top + 4, '#2b2d42');
  R(x, top, w, 126 - top, '#1b1f33');
  const gap = Math.round((w / 2) * Math.min(1, open * 2));
  R(x, top, w / 2 - gap, 126 - top, '#aab3c0');
  R(x + w / 2 + gap, top, w / 2 - gap, 126 - top, '#aab3c0');
  R(x + w / 2 - gap - 1, top, 1, 126 - top, '#7d8692');
  R(x + w / 2 + gap, top, 1, 126 - top, '#7d8692');
  // the floor indicator
  R(x + w / 2 - 16, top - 18, 32, 12, '#111');
  label(g, tag, x + w / 2, top - 12, '#ff9f1c', 13, 'center', 30);
  R(x + w + 6, 70, 6, 10, '#2b2d42'); R(x + w + 7, 71, 4, 3, open ? '#06d6a0' : '#adb5bd'); R(x + w + 7, 75, 4, 3, '#adb5bd');
}

function drawExecWall(g, floor, now, light) {
  const { R } = g;
  // dark wood paneling with its vertical slats
  R(0, 0, W, 126, '#5b3a29');
  for (let x = 0; x < W; x += 32) R(x, 0, 2, 126, '#4a2f21');
  R(0, 120, W, 6, '#3b2418');
  // the window: the top floor, more sky than anywhere else
  const wn = EXEC.window;
  R(wn.x0 - 4, wn.top - 4, wn.x1 - wn.x0 + 8, wn.bottom - wn.top + 8, '#2b1b12');
  g.outdoorAt({ x0: wn.x0, x1: wn.x1, top: wn.top, bottom: wn.bottom, glass: true, arc: 90 }, now, light);
  for (let x = wn.x0 + 96; x < wn.x1; x += 96) R(x, wn.top, 3, wn.bottom - wn.top, '#2b1b12');
  // the directives board
  const b = EXEC.board;
  R(b.x - 3, b.y - 3, b.w + 6, b.h + 6, '#2b1b12');
  R(b.x, b.y, b.w, b.h, '#f1ead8');
  R(b.x, b.y, b.w, 16, '#9c2c3f');
  label(g, t('floors.exec.board'), b.x + b.w / 2, b.y + 8, '#ffe8a3', 15, 'center', b.w - 8);
  const list = (floor.data.directives || []).slice(0, 3);
  if (!list.length) {
    label(g, t('floors.exec.none'), b.x + b.w / 2, b.y + 52, '#6c757d', 13, 'center', b.w - 12);
    label(g, '✚', b.x + b.w / 2, b.y + 72, '#9c2c3f', 20, 'center');
  }
  list.forEach((d, i) => {
    const y = b.y + 22 + i * 28;
    R(b.x + 6, y, b.w - 12, 24, '#fffaf0');
    R(b.x + 6, y, 3, 24, STATUS_COLOR[d.status] || '#ffd166');
    label(g, d.title, b.x + 13, y + 7, '#2b2d42', 13, 'left', b.w - 26);
    const pw = b.w - 52;
    R(b.x + 13, y + 15, pw, 5, '#dee2e6');
    R(b.x + 13, y + 15, d.total ? Math.round((pw * d.done) / d.total) : 0, 5, STATUS_COLOR[d.status] || '#ffd166');
    label(g, `${d.done}/${d.total}`, b.x + b.w - 10, y + 17, '#495057', 12, 'right', 34);
  });
  drawLift(g, floor, EXEC.lift, now, '▲ D');
  // the company's screen: how each office is doing
  const s = EXEC.screen;
  R(s.x - 4, s.y - 4, s.w + 8, s.h + 8, '#111522');
  R(s.x, s.y, s.w, s.h, '#0b1020');
  const offices = floor.data.overview || [];
  const blink = Math.floor(now / 500) % 2;
  label(g, `${t('floors.exec.wall')} · ${offices.length}`, s.x + 8, s.y + 9, '#8ecae6', 15, 'left', 200);
  offices.slice(0, 5).forEach((o, i) => {
    const y = s.y + 24 + i * 17;
    const color = o.waiting ? '#ffd166' : o.working ? '#06d6a0' : '#5c677d';
    R(s.x + 8, y + 3, 8, 8, o.waiting && blink ? '#0b1020' : color);
    label(g, o.name, s.x + 22, y + 7, '#e9ecef', 14, 'left', 120);
    const what = o.waiting ? t('floors.exec.waiting', { n: o.waiting }) : o.working ? t('floors.exec.working', { n: o.working }) : t('floors.exec.idle');
    label(g, `${what}${o.tasks ? ` · ${t('floors.exec.tasks', { n: o.tasks })}` : ''}`, s.x + 148, y + 7, color, 13, 'left', s.w - 156);
  });
  if (offices.length > 5) label(g, `+${offices.length - 5}`, s.x + s.w - 8, s.y + s.h - 8, '#8ecae6', 13, 'right', 40);
  // the floor's brass plate, under the window
  R(wn.x0 + 96, 114, 100, 10, '#b08d57');
  label(g, t('floors.exec.sign'), wn.x0 + 146, 119, '#3b2418', 12, 'center', 96);
}

function drawArchiveWall(g, floor, now, light) {
  const { R } = g;
  const counts = floor.data.archive?.counts || {};
  // concrete with its formwork marks, and the pipes along the ceiling
  R(0, 0, W, 126, '#4b5260');
  for (let y = 10; y < 126; y += 30) R(0, y, W, 1, '#434a57');
  for (let x = 0; x < W; x += 120) R(x, 0, 1, 126, '#434a57');
  R(0, 120, W, 6, '#2f343f');
  // the light wells: the street seen from below (the same weather)
  const wl = ARCHIVE.wells;
  R(wl.x0 - 3, wl.top - 3, wl.x1 - wl.x0 + 6, wl.bottom - wl.top + 6, '#2f343f');
  g.outdoorAt({ x0: wl.x0, x1: wl.x1, top: wl.top, bottom: wl.bottom, glass: true, arc: 30 }, now, light);
  for (let x = wl.x0 + 64; x < wl.x1; x += 64) R(x, wl.top, 2, wl.bottom - wl.top, '#2f343f');
  // the shelves: one binder per entry (notes, decisions, docs, minutes), in order
  const sh = ARCHIVE.shelves;
  const levels = 2, slot = 8, per = Math.floor((sh.w - 12) / slot);
  R(sh.x, sh.y, sh.w, sh.h, '#3a3f4b');
  const binders = [];
  for (const k of ['note', 'decision', 'doc', 'minute']) for (let i = 0; i < Math.min(counts[k] || 0, levels * per); i++) binders.push(k);
  for (let lv = 0; lv < levels; lv++) {
    const y = sh.y + 6 + lv * 42;
    R(sh.x + 4, y + 34, sh.w - 8, 4, '#8d99ae');
    for (let i = 0; i < per; i++) {
      const k = binders[lv * per + i];
      if (!k) continue;
      const tall = 26 + ((i * 7 + lv * 3) % 7);
      R(sh.x + 6 + i * slot, y + 34 - tall, slot - 1, tall, KIND_COLOR[k]);
      R(sh.x + 6 + i * slot + 2, y + 34 - tall + 6, slot - 5, 3, '#ffffffaa');
    }
  }
  const total = ['note', 'decision', 'doc', 'minute'].reduce((n, k) => n + (counts[k] || 0), 0);
  R(sh.x + sh.w - 92, sh.y + sh.h - 14, 88, 12, '#1b1f33');
  label(g, t('floors.archive.entries', { n: total }), sh.x + sh.w - 48, sh.y + sh.h - 8, '#ffd166', 13, 'center', 84);
  drawLift(g, floor, ARCHIVE.lift, now, '▼ A');
  // the connectors' patch panel: a lit port (and its cable going out) per connector
  const pp = ARCHIVE.patch;
  R(pp.x - 3, pp.y - 3, pp.w + 6, pp.h + 6, '#1b1f33');
  R(pp.x, pp.y, pp.w, pp.h, '#2b2d42');
  label(g, t('floors.archive.connectors', { n: counts.connector || 0 }), pp.x + pp.w / 2, pp.y + 9, '#c77dff', 14, 'center', pp.w - 8);
  const cols = 8, rows = 4;
  for (let i = 0; i < cols * rows; i++) {
    const x = pp.x + 12 + (i % cols) * 20, y = pp.y + 24 + Math.floor(i / cols) * 22;
    const on = i < (counts.connector || 0);
    R(x, y, 12, 12, '#111');
    R(x + 2, y + 2, 8, 8, on ? (Math.floor(now / 300 + i) % 5 ? '#c77dff' : '#f1d6ff') : '#3a3f58');
    if (on) R(x + 5, y - 6 - (i % 3), 2, 6 + (i % 3), '#c77dff88');
  }
  // the skills rack: a cartridge per skill
  const rk = ARCHIVE.rack;
  R(rk.x - 3, rk.y - 3, rk.w + 6, rk.h + 6, '#1b1f33');
  R(rk.x, rk.y, rk.w, rk.h, '#33394a');
  label(g, t('floors.archive.skills', { n: counts.skill || 0 }), rk.x + rk.w / 2, rk.y + 9, '#06d6a0', 14, 'center', rk.w - 8);
  for (let i = 0; i < 24; i++) {
    const x = rk.x + 10 + (i % 8) * 20, y = rk.y + 22 + Math.floor(i / 8) * 28;
    R(x, y + 22, 16, 2, '#8d99ae');
    if (i < (counts.skill || 0)) { R(x + 2, y + 2, 12, 20, '#06d6a0'); R(x + 4, y + 5, 8, 4, '#d8f3dc'); R(x + 2, y + 18, 12, 2, '#048a68'); }
  }
  // stenciled on the concrete, by the elevator
  sign(g, t('floors.archive.sign'), ARCHIVE.lift.x + ARCHIVE.lift.w / 2, 8, '#e9c46a', 14);
}

// ---------------------------------------------------------------- furniture

function chair(g, s, exec) {
  const { R } = g;
  R(s.x - 16, s.y - 40, 32, 34, exec ? '#1e1e2a' : '#3a3f58');
  R(s.x - 14, s.y - 38, 28, 30, exec ? '#2e2e40' : '#4a5070');
}
function bigChair(g, s) {
  const { R } = g;
  R(s.x - 17, s.y - 50, 34, 44, '#1e1e2a');
  R(s.x - 15, s.y - 48, 30, 40, '#34344a');
  R(s.x - 15, s.y - 48, 30, 4, '#44445e');
}
function desk(g, s, { top = '#7d4f2e', front = '#5e3a21', lip = '#3e2414' } = {}) {
  const { R } = g;
  R(s.x - 60, s.y - 10, 120, 14, top);
  R(s.x - 60, s.y + 2, 120, 28, front);
  R(s.x - 60, s.y + 2, 120, 3, lip);
}
function plant(g, x, y) {
  const { R } = g;
  R(x - 10, y - 18, 20, 18, '#8c5a33'); R(x - 12, y - 20, 24, 4, '#6b4226');
  for (const [dx, dy, s] of [[-10, -36, 12], [2, -42, 12], [-4, -52, 10], [6, -30, 10], [-14, -28, 8]]) R(x + dx, y + dy, s, s, '#2d6a4f');
  R(x - 2, y - 44, 6, 6, '#40916c');
}
function monitor(g, x, y, now, color = '#4cc9f0') {
  const { R } = g;
  R(x - 14, y - 26, 28, 20, '#1b1f33');
  R(x - 12, y - 24, 24, 16, '#0b1020');
  for (let i = 0; i < 3; i++) R(x - 10, y - 21 + i * 5, 6 + ((Math.floor(now / 400) + i * 3) % 12), 2, color);
  R(x - 2, y - 6, 4, 4, '#1b1f33');
}

/** The floor's furniture: { x, y (where it stands, for depth), flat(g, now), iso?(g, now) }. */
function furniture(floor) {
  const items = [];
  const P = floor.people;
  if (floor.kind === 'exec') {
    const tb = EXEC.table;
    items.push({
      x: (tb.x0 + tb.x1) / 2, y: tb.y0 + 1,
      flat: (g) => {
        const { R } = g;
        R(tb.x0, tb.y0, tb.x1 - tb.x0, tb.y1 - tb.y0, '#7d4f2e');
        R(tb.x0 - 10, tb.y0 + 8, 10, tb.y1 - tb.y0 - 16, '#7d4f2e'); R(tb.x1, tb.y0 + 8, 10, tb.y1 - tb.y0 - 16, '#7d4f2e');
        R(tb.x0 + 8, tb.y0 + 4, tb.x1 - tb.x0 - 16, 2, '#9b6a43');
        R(tb.x0 - 10, tb.y1, tb.x1 - tb.x0 + 20, 14, '#5e3a21');
        R(tb.x0 - 10, tb.y1, tb.x1 - tb.x0 + 20, 3, '#3e2414');
        // papers, a laptop and a water jug on the table
        R(tb.x0 + 100, tb.y0 + 20, 26, 18, '#f8f9fa'); R(tb.x0 + 104, tb.y0 + 24, 16, 2, '#adb5bd');
        R(tb.x0 + 250, tb.y0 + 18, 30, 4, '#adb5bd'); R(tb.x0 + 252, tb.y0 + 2, 26, 16, '#2b2d42'); R(tb.x0 + 254, tb.y0 + 4, 22, 12, '#4cc9f0');
        R(tb.x0 + 190, tb.y0 + 16, 10, 20, '#a8dadcaa'); R(tb.x0 + 190, tb.y0 + 26, 10, 10, '#4cc9f088');
      },
      iso: (g) => {
        g.box(tb.x0, tb.y0 - 6, tb.x1, tb.y1 - 6, 28, { top: '#7d4f2e', front: '#5e3a21', side: '#4a2d18', edge: '#9b6a43' });
        g.box(tb.x0 + 250, tb.y0 + 4, tb.x0 + 282, tb.y0 + 22, 2, { top: '#2b2d42', front: '#2b2d42', side: '#1b1f33' }, 28);
      },
    });
    // empty chairs on our side of the table (their backs)
    for (const x of [360, 500, 640]) {
      items.push({
        x, y: tb.y1 + 30,
        flat: (g) => { g.R(x - 15, tb.y1 + 2, 30, 36, '#1e1e2a'); g.R(x - 13, tb.y1 + 4, 26, 30, '#34344a'); },
        iso: (g) => g.box(x - 14, tb.y1 + 2, x + 14, tb.y1 + 22, 26, { top: '#34344a', front: '#1e1e2a', side: '#15151f' }),
      });
    }
    for (const id of ['ceo', 'assistant']) {
      const s = P[id].cfg.seat;
      items.push({
        x: s.x, y: s.y + 1,
        flat: (g, now) => { desk(g, s); monitor(g, s.x + (id === 'ceo' ? 34 : -34), s.y - 8, now, id === 'ceo' ? '#ffd166' : '#4cc9f0'); if (id === 'ceo') { g.R(s.x - 46, s.y - 16, 22, 4, '#e9c46a'); } },
        iso: (g) => g.box(s.x - 60, s.y - 6, s.x + 60, s.y + 18, 24, { top: '#7d4f2e', front: '#5e3a21', side: '#4a2d18', edge: '#9b6a43' }),
      });
    }
    // the coffee cart
    const c = EXEC.cart;
    items.push({
      x: c.x, y: c.y,
      flat: (g) => { const { R } = g; R(c.x - 22, c.y - 34, 44, 6, '#adb5bd'); R(c.x - 20, c.y - 28, 4, 28, '#6c757d'); R(c.x + 16, c.y - 28, 4, 28, '#6c757d'); R(c.x - 22, c.y - 12, 44, 4, '#adb5bd'); R(c.x - 12, c.y - 48, 14, 14, '#2b2d42'); R(c.x + 6, c.y - 42, 8, 8, '#f8f9fa'); },
    });
    for (const [x, y] of EXEC.plants) items.push({ x, y, flat: (g) => plant(g, x, y) });
  } else {
    for (const r of ARCHIVE.rows) {
      items.push({
        x: (r.x0 + r.x1) / 2, y: r.y,
        flat: (g) => {
          const { R } = g;
          R(r.x0, r.y - 74, r.x1 - r.x0, 74, '#8d99ae');
          R(r.x0, r.y - 74, r.x1 - r.x0, 4, '#adb5bd');
          for (let lv = 0; lv < 2; lv++) {
            const y = r.y - 68 + lv * 34;
            R(r.x0 + 4, y, r.x1 - r.x0 - 8, 28, '#5c677d');
            for (let x = r.x0 + 6; x < r.x1 - 10; x += 9) {
              const k = ['note', 'doc', 'decision', 'minute', 'doc', 'note'][(x + lv * 5 + r.y) % 6];
              R(x, y + 2 + ((x + r.y) % 5), 7, 24 - ((x + r.y) % 5), `${KIND_COLOR[k]}bb`);
            }
          }
          R(r.x1 - 18, r.y - 46, 10, 10, '#2b2d42'); R(r.x1 - 15, r.y - 43, 4, 4, '#adb5bd'); // the crank
        },
        iso: (g) => g.box(r.x0, r.y - 40, r.x1, r.y, 74, { top: '#adb5bd', front: '#6c7689', side: '#5c677d', edge: '#ced4da' }),
      });
    }
    // the archivist's desk with the card catalog
    const ar = P.archivist.cfg.seat;
    items.push({
      x: ar.x, y: ar.y + 1,
      flat: (g, now) => {
        desk(g, ar, { top: '#a0703f', front: '#7c5230', lip: '#5d3b20' });
        monitor(g, ar.x + 34, ar.y - 8, now, '#ffd166');
        const { R } = g;
        R(ar.x - 52, ar.y - 26, 36, 18, '#8c5a33');
        for (let i = 0; i < 6; i++) { R(ar.x - 50 + (i % 3) * 12, ar.y - 24 + Math.floor(i / 3) * 8, 10, 6, '#b5835a'); R(ar.x - 46 + (i % 3) * 12, ar.y - 22 + Math.floor(i / 3) * 8, 3, 2, '#e9c46a'); }
      },
      iso: (g) => g.box(ar.x - 60, ar.y - 6, ar.x + 60, ar.y + 18, 24, { top: '#a0703f', front: '#7c5230', side: '#5d3b20', edge: '#c08a52' }),
    });
    // the skills workbench: the press that makes cartridges
    const sk = P.skills.cfg.seat;
    items.push({
      x: sk.x, y: sk.y + 1,
      flat: (g, now) => {
        desk(g, sk, { top: '#6c757d', front: '#495057', lip: '#343a40' });
        const { R } = g;
        R(sk.x + 20, sk.y - 40, 34, 30, '#343a40'); R(sk.x + 24, sk.y - 36, 26, 10, '#06d6a0');
        R(sk.x + 30, sk.y - 24, 14, 14, '#adb5bd'); R(sk.x + 34, sk.y - 20 + (Math.floor(now / 250) % 2) * 2, 6, 6, '#06d6a0');
        R(sk.x - 50, sk.y - 16, 12, 6, '#06d6a0'); R(sk.x - 36, sk.y - 16, 12, 6, '#06d6a0');
      },
      iso: (g) => g.box(sk.x - 60, sk.y - 6, sk.x + 60, sk.y + 18, 24, { top: '#6c757d', front: '#495057', side: '#343a40', edge: '#adb5bd' }),
    });
    // the connectors' console
    const cn = P.connectors.cfg.seat;
    items.push({
      x: cn.x, y: cn.y + 1,
      flat: (g, now) => { desk(g, cn, { top: '#6c757d', front: '#495057', lip: '#343a40' }); monitor(g, cn.x - 30, cn.y - 8, now, '#c77dff'); monitor(g, cn.x + 30, cn.y - 8, now, '#c77dff'); },
      iso: (g) => g.box(cn.x - 60, cn.y - 6, cn.x + 60, cn.y + 18, 24, { top: '#6c757d', front: '#495057', side: '#343a40', edge: '#adb5bd' }),
    });
    for (const [x, y] of ARCHIVE.plants) items.push({ x, y, flat: (g) => plant(g, x, y) });
  }
  return items;
}
