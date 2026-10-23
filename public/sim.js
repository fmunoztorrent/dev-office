// The office simulation, without drawing: characters, routes, reactions to events and particles.
// Used by the canvas renderer (browser, game.js) and the terminal renderer (tui/).
// All coordinates are in a W×H world.
//
// Besides reacting to what the agent does, each character has its own "brain": needs that grow
// over time (talking, coffee, bathroom, consulting, dreaming) and a personality that decides what
// it does when nobody asks it for anything. The product NPCs (PO, analyst, designer) sit together
// and chit-chat; the designer dreams of unicorns and rainbows, QA of skulls and the devs of pizza;
// the technical people sometimes go consult the TL and the TL sometimes goes to talk with product;
// the manager hands out the requirements and makes rounds. The office also has its own life: at
// 13:00 the team goes to lunch in the dining room, there is a bathroom (one at a time, with a
// queue) and sometimes the server catches fire and the technical team puts it out and repairs it.
// The texts (dialogs, log) are in the game's languages (i18n.js, locales/).
// What happens "sometimes" always has a random factor: the need fills up and then a roll has to
// be won for it to happen.

import { daylight, simulatedWeather, strikeStart, WEATHER, WET } from './sky.js';
import { t, ta, listOf, onLanguage } from './i18n.js';
import { zoned, zoneInfo, systemZone, validZone } from './clock.js';
export { daylight } from './sky.js';

export const W = 960, H = 600;

// Top row: the product corner (designer, PO and analyst, together) and the manager.
// Bottom row: the technical team, with the TL a bit apart (people go consult them).
// The job title comes from the game's language, unless customized in ⚙ › Characters.
export const TEAM = {
  designer: { name: 'Camila', title: 'Diseñadora', shirt: '#c86bfa', pants: '#3a2f45', hair: '#f2d16b', skin: '#f0c8a8', long: true, seat: { x: 100, y: 228 }, prop: 'tablet' },
  po: { name: 'Sofía', title: 'Product Owner', shirt: '#e0607e', pants: '#3b3355', hair: '#5a3214', skin: '#f2c9a0', long: true, seat: { x: 210, y: 228 }, prop: 'notes' },
  analyst: { name: 'Valentina', title: 'Analista de negocio', shirt: '#f0a73a', pants: '#2f3b52', hair: '#21160f', skin: '#c98e62', long: true, seat: { x: 320, y: 228 }, prop: 'chart' },
  manager: { name: 'Marco', title: 'Manager', shirt: '#3f73f0', pants: '#2a2d3a', hair: '#8d8d8d', skin: '#e8b98f', seat: { x: 710, y: 228 }, prop: 'phone' },
  frontend: { name: 'Lucía', title: 'Frontend', shirt: '#ff7a45', pants: '#2d3a4f', hair: '#b8322a', skin: '#f5d0b0', long: true, seat: { x: 110, y: 418 }, prop: 'dual' },
  backend: { name: 'Diego', title: 'Backend', shirt: '#6b5bd6', pants: '#22222e', hair: '#151515', skin: '#b07a52', seat: { x: 220, y: 418 }, prop: 'terminal' },
  qa: { name: 'Andrés', title: 'QA', shirt: '#8ac926', pants: '#2b3a2e', hair: '#3d2817', skin: '#e0ac7e', glasses: true, seat: { x: 330, y: 418 }, prop: 'qa' },
  tl: { name: 'Tomás', title: 'Tech Lead', shirt: '#22a68e', pants: '#26313a', hair: '#2b1b12', skin: '#d9a273', beard: true, seat: { x: 560, y: 418 }, prop: 'big' },
};
export const PRODUCT = ['po', 'analyst', 'designer']; // business NPCs: they talk among themselves and bring the requirements
export const TECH = ['backend', 'frontend', 'qa'];      // they work and sometimes consult the TL

// The whiteboard, on an easel in front of the glass wall (with the digital clock on top): clicking
// it opens the dialog to brief a task.
export const BOARD = { x: 372, y: 34, w: 236, h: 98 };
export const EASEL = { top: 22, feet: 146, legs: [[362, 348], [618, 632]] }; // front legs, at the sides: x at the top → x on the floor
export const ALARM = { x: 588, y: 6 }; // hangs from the ceiling beam, over the rack
export const SIGN = { x: 308, y: 62 }; // the sign, in vinyl on the lower part of a glass panel (under the HUD)
export const CLOCK = { x: 446, y: 3, w: 88, h: 26 };
// The back wall is glass (from x 0 to GLASS.x1); the bathroom is a solid block on the right.
export const GLASS = { x0: 0, x1: 704, top: 6, bottom: 108 };
export const onBoard = (x, y) => x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h;

// Customizable appearance (⚙ Settings › Characters). TEAM is modified in place so both
// renderers and the simulation see the change instantly.
export const APPEARANCE_KEYS = ['name', 'title', 'shirt', 'pants', 'hair', 'skin', 'long', 'beard', 'glasses'];
export const DEFAULT_TEAM = Object.fromEntries(Object.entries(TEAM).map(([id, c]) => {
  const look = Object.fromEntries(APPEARANCE_KEYS.filter((k) => k !== 'title').map((k) => [k, c[k] ?? false]));
  Object.defineProperty(look, 'title', { get: () => t(`team.titles.${id}`), enumerable: true });
  return [id, look];
}));
// Palettes to pick colors without typing hex (the terminal cycles them with ◂ ▸; the web also has a free picker).
export const LOOK_PALETTES = {
  shirt: ['#e0607e', '#f0a73a', '#3f73f0', '#22a68e', '#8ac926', '#6b5bd6', '#ff7a45', '#c86bfa', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'],
  pants: ['#2a2d3a', '#2f3b52', '#3b3355', '#26313a', '#2b3a2e', '#22222e', '#3a2f45', '#4a3b2a'],
  hair: ['#151515', '#21160f', '#3d2817', '#5a3214', '#8d8d8d', '#b8322a', '#f2d16b', '#e8e9f1'],
  skin: ['#f5d0b0', '#f2c9a0', '#f0c8a8', '#e8b98f', '#e0ac7e', '#d9a273', '#c98e62', '#b07a52', '#8d5a3b'],
};
let appearance = {};
export function applyAppearance(overrides = {}) {
  appearance = overrides || {};
  for (const [id, cfg] of Object.entries(TEAM)) {
    const o = appearance[id] || {};
    for (const k of APPEARANCE_KEYS) cfg[k] = o[k] ?? DEFAULT_TEAM[id][k];
  }
}
applyAppearance();
onLanguage(() => applyAppearance(appearance)); // titles that were not customized change language
/** The team's current names, for the dialogs ({tl}, {po}, {manager}…). */
export const teamNames = () => Object.fromEntries(Object.entries(TEAM).map(([id, c]) => [id, c.name]));

// ------------------------------------------------------------------------------------ the map

// The café takes the right side, at the top: a counter against the wall (with the espresso machine,
// the fridge and the neon sign) and a high table. A line of planters separates it from the office,
// with gaps at the height of the aisles.
export const CAFE = {
  x: 772,                                   // where its floor starts
  counter: { x: 812, w: 144, top: 116 },    // the counter: top from `top`, front down to top + 32
  fridge: { x: 778, y: 54, w: 28, h: 94 },
  espresso: { x: 884, w: 42 },
  bistro: { x: 836, y: 262 },               // the high table with two levels
};
// Below the café, the dining room: a low wall with a door separates them, and a long table where
// the whole team has lunch. Product and the manager sit behind the table (facing us); the
// technical team in front, from behind. You enter through the wall's door (the back ones) or from
// below (the front ones), so as not to cross the table.
export const DINING = {
  top: 330,                                 // the wall: from top to top + 14
  door: { x0: 900, x1: 948 },               // the wall's door (café ↔ dining room)
  table: { x: 866, y: 452, w: 150 },        // y: the back edge of the top (where the back ones sit)
  aisle: { back: 410, front: 566, side: 788, door: 924 }, // how each row is reached
};
const DINE_X = [-54, -18, 18, 54].map((dx) => DINING.table.x + dx);
export const DINING_SEATS = {
  back: DINE_X.map((x) => ({ x, y: DINING.table.y, row: 'back' })),
  front: DINE_X.map((x) => ({ x, y: DINING.table.y + 48, row: 'front' })),
};
const COUNTER_SPOTS = [{ x: 836, y: 150 }, { x: 872, y: 150 }, { x: 908, y: 150 }];
export const PARTITION = [[190, 296], [340, 440], [484, 600]]; // planters at x = CAFE.x - 6, with gaps at the aisles
// The bathroom: a door in the wall, between the clock and the café. One at a time.
export const BATH = { x: 714, w: 52, door: { x: 740, y: 126 }, front: { x: 740, y: 150 }, line: { x: 694, y: 154 } };
// The server rack (the one that catches fire) and its extinguisher, on the floor to its left.
export const RACK = { x: 572, y: 150, w: 42, h: 92 };
export const EXTINGUISHER = { x: 561, y: 242 };
const EXT_PICK = { x: 561, y: 272 };
const FIRE_SPOT = { backend: { x: 594, y: 276 }, tl: { x: 640, y: 286 }, frontend: { x: 546, y: 288 }, qa: { x: 684, y: 292 } };
const FIRE_ORDER = ['backend', 'tl', 'frontend', 'qa']; // who grabs the extinguisher if they can
// The living room: a TV on a tripod and, in front, a sofa (seen from behind: those watching TV
// have their backs to us). It is reached from the side so as not to cross the TV.
export const TV = { x: 360, feet: 522, w: 96, h: 58 };
export const SOFA = { x: 360, y: 562, seats: [320, 360, 400], side: { x: 266, y: 532 } };

export const SPOT = {
  board: { x: 490, y: 148 },
  coffee: COUNTER_SPOTS[1],
  table: { x: 600, y: 515 },
  sofa: { x: 236, y: 520 }, // next to the sofa, to chat standing up
};
export const PLANTS = [[20, 560], [700, 400], [944, 590]];
const TABLE_SEATS = [[-75, -40], [-25, -42], [25, -42], [75, -40], [-108, 0], [108, 0], [-100, 42], [100, 42]];
const CORRIDOR_TOP = 148, CORRIDOR_MID = 318, CORRIDOR_LOW = 462;
const LANES = [25, 445, 637]; // gaps between desks where people switch aisles
const DEVS = ['backend', 'frontend', 'designer'];
const SPEED = 120; // world px per second when walking
export const LUNCH = { start: 13 * 60, end: 14 * 60 }; // minutes of the day
/** What is on TV: breaking news if the server catches fire; if someone is watching, football too. */
export function tvChannel(sim, now) {
  if (sim.fire && sim.fire.phase !== 'done') return 'breaking';
  const watched = Object.values(sim.agents).some((a) => a.back);
  const list = watched ? ['sports', 'weather', 'news', 'sports'] : ['weather', 'news'];
  return list[Math.floor(now / 9000) % list.length];
}

export const STATUS_ICON = { working: '💻', thinking: '💭', blocked: '❗', waiting: '✋', done: '🎉', coffee: '☕', talking: '💬', red: '🔴', alarm: '🚨' };

// ------------------------------------------------------------------------------------ dreams

// What they imagine: pixel art drawn by both renderers (each character is a pixel; '.' is
// transparent). The rainbow is computed (rainbowPixels).
export const DREAM_PALETTE = {
  W: '#ffffff', w: '#e9ecf5', k: '#2b2d42', y: '#ffd166', p: '#ff7eb6', v: '#c86bfa', h: '#8d99ae', b: '#7ad7f0',
  s: '#c9ccd6', c: '#d08c45', C: '#9c5a2a', Y: '#ffe8a3', r: '#d62828', g: '#3fb68b',
};
export const UNICORN = [
  '...y.........',
  '...yy........',
  '..WWWpv......',
  '.WkWWpvp.....',
  'WWWWWWpv.....',
  '...WWWWWWWWpv',
  '...WWWWWWWWvp',
  '...WWWWWWWW.p',
  '...W.W..W.W..',
  '...h.h..h.h..',
];
export const SKULL = [
  '....WWWWW....',
  '..WWWWWWWWW..',
  '.WWWWWWWWWWW.',
  '.WWkkWWWkkWs.',
  '.WkkkWWWkkks.',
  '.WWkkWWWkkWs.',
  '..WWWWkWWWs..',
  '...WWWWWWs...',
  '...WkWkWkW...',
  '....sssss....',
];
export const PIZZA = [
  'CcccccccccccC',
  'cYyyyyyyyyyYc',
  '.yyrryyyyrry.',
  '.yrrryyyrrry.',
  '..yrryygyry..',
  '..yyyyrryy...',
  '...yygrrry...',
  '...yyyyyy....',
  '....yryy.....',
  '.....yy......',
  '.....y.......',
];
export const RAINBOW_COLORS = ['#ef476f', '#ff9f1c', '#ffd166', '#06d6a0', '#118ab2', '#8e7dbe'];
/** Each dream: its sprite (or null if computed), the cloud's color and the glow's. */
export const DREAMS = {
  unicorn: { sprite: UNICORN, cloud: '#cfe2ff', glow: '#ff7eb6', emoji: '🦄' },
  rainbow: { sprite: null, cloud: '#ffffff', glow: '#ffd166', emoji: '🌈' },
  skull: { sprite: SKULL, cloud: '#3a3550', glow: '#a06cff', emoji: '💀' },
  pizza: { sprite: PIZZA, cloud: '#fff3d6', glow: '#ff9f1c', emoji: '🍕' },
};
for (const [kind, d] of Object.entries(DREAMS)) Object.defineProperty(d, 'label', { get: () => t(`dream.${kind}`), enumerable: true });
// Who dreams of what.
export const DREAMERS = { designer: ['unicorn', 'rainbow'], qa: ['skull'], backend: ['pizza'], frontend: ['pizza'] };

/** Pixels of a rainbow of radius r (RAINBOW_COLORS bands going inward): [[dx, dy, color]]. */
export function rainbowPixels(r = 9) {
  const out = [];
  const band = Math.max(1, Math.floor(r / (RAINBOW_COLORS.length + 1)));
  for (let dy = -r; dy <= 0; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = Math.floor((r - d) / band);
      if (d <= r && i < RAINBOW_COLORS.length) out.push([dx, dy, RAINBOW_COLORS[i]]);
    }
  }
  return out;
}

// Phases of the role flow (`phase` event). `anim` decides what the character does.
// Each phase's name is in the languages (i18n: phase.<id>).
export const PHASES = {
  historia: { icon: '📝', anim: 'board' },
  criterios: { icon: '📋', anim: 'board' },
  prioriza: { icon: '📌', anim: 'board' },
  acepta: { icon: '✅', anim: 'approve' },
  rechaza: { icon: '❌', anim: 'reject' },
  analiza: { icon: '🧐', anim: 'think' },
  investiga: { icon: '🔎', anim: 'work' },
  requisitos: { icon: '📑', anim: 'board' },
  planifica: { icon: '🗂️', anim: 'board' },
  asigna: { icon: '📨', anim: 'work' },
  desbloquea: { icon: '🔓', anim: 'visit' },
  release: { icon: '🚀', anim: 'release' },
  arquitectura: { icon: '🏛️', anim: 'board' },
  adr: { icon: '📐', anim: 'board' },
  review: { icon: '🔍', anim: 'visit' },
  aprueba: { icon: '👍', anim: 'approve' },
  cambios: { icon: '✋', anim: 'reject' },
  refactor: { icon: '♻️', anim: 'work' },
  'plan-pruebas': { icon: '🧪', anim: 'think' },
  red: { icon: '🔴', anim: 'red' },
  green: { icon: '🟢', anim: 'green' },
  regresion: { icon: '🧪', anim: 'work' },
  bug: { icon: '🐞', anim: 'visit' },
  verifica: { icon: '🔬', anim: 'work' },
  implementa: { icon: '⌨️', anim: 'work' },
  fix: { icon: '🔧', anim: 'work' },
  migracion: { icon: '🗄️', anim: 'work' },
  ux: { icon: '✏️', anim: 'work' },
  ui: { icon: '🎨', anim: 'work' },
  'revision-visual': { icon: '👀', anim: 'visit' },
  bloqueado: { icon: '⛔', anim: 'blocked' },
};
for (const [id, ph] of Object.entries(PHASES)) Object.defineProperty(ph, 'label', { get: () => t(`phase.${id}`), enumerable: true });
export const phaseInfo = (id) => PHASES[id] || { label: String(id || '').toUpperCase(), icon: '▶', anim: 'work' };
export const PHASE_COLOR = { red: '#ef476f', green: '#06d6a0', bloqueado: '#ef476f', cambios: '#f4a261', rechaza: '#f4a261' };
const CODE_GLYPHS = '{}<>/;=()[]#$*+'.split('');

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ------------------------------------------------------------------------------------
// Personality: how hard it is to be alone, how much coffee they drink, what they talk about.

// Seconds each need takes to fill up (and for the character to want to do something about it).
const PERSONALITY = {
  po: { social: 55, coffee: 420, bladder: 1900 },
  analyst: { social: 65, coffee: 460, bladder: 2100 },
  designer: { social: 60, coffee: 480, bladder: 2000, dream: 70 },
  manager: { social: 110, coffee: 360, bladder: 1800, rounds: 90 },
  tl: { social: 400, coffee: 400, bladder: 2200, product: 230 },
  backend: { social: 400, coffee: 440, bladder: 2100, doubt: 95, dream: 480 },
  frontend: { social: 400, coffee: 460, bladder: 2000, doubt: 85, dream: 450 },
  qa: { social: 400, coffee: 460, bladder: 2300, doubt: 110, dream: 420 },
};
/** Needs from 0 to 1 (on reaching 1, they want to act). They start uneven so not everyone acts at once. */
function freshMind(random) {
  const r = () => random() * 0.6;
  return { social: r(), coffee: r(), doubt: r(), dream: r() + 0.2, rounds: r(), bladder: r(), product: r(), nextThink: 0 };
}
/** The needs shown in the character's sheet (0 = satisfied, 1 = urgent). */
export const NEEDS = ['social', 'coffee', 'bladder', 'dream', 'doubt'];
export const needsOf = (id) => NEEDS.filter((k) => k !== 'dream' || DREAMERS[id]).filter((k) => k !== 'doubt' || PERSONALITY[id]?.doubt).map((k) => [k, t(`needs.${k}`)]);

const short = (t, n = 28) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// The dialogs are in the game's languages (locales/: sim.*); the names go as {variables}.
const LUNCH_FOOD = { designer: '🥗', po: '🥗', analyst: '🍣', manager: '🍝', frontend: '🍕', backend: '🍕', qa: '🍔', tl: '🍜' };
// Who gets a requirement, depending on what it is about (the manager hands them out).
const ASSIGN_RULES = [
  ['designer', /dise[ñn]|design|logo|colou?r|paleta|palette|\bux\b|figma|[ií]cono|\bicons?\b|mockup|estilo|style/i],
  ['frontend', /front|\bui\b|pantalla|screen|vista|\bview|bot[oó]n|button|p[aá]gina|\bpage|css|react|vue|formulario|\bform|componente|component|\bweb\b|tema|theme|oscuro|dark/i],
  ['backend', /back(?!log)|\bapi\b|endpoint|servidor|server|base de datos|database|\bdb\b|sql|migraci|migration|auth|login|pago|payment|webhook|cola|queue|export/i],
  ['qa', /\btests?\b|prueba|\bbug|error|falla|failure|regresi|\bqa\b|e2e|cobertura|coverage/i],
];
export function assignees(text) {
  const roles = ASSIGN_RULES.filter(([, rx]) => rx.test(String(text || ''))).map(([r]) => r).slice(0, 2);
  return roles.length ? roles : ['tl']; // no clues: the Tech Lead looks at it
}

// Conversations that are cut short if real work reaches the character (consulting the TL is not).
const LEISURE = new Set(['gossip', 'deskchat', 'coffee', 'lunchtalk', 'archchat', 'idea', 'rounds', 'tv']);

// When the weather outside changes (the real one, or the simulated one when offline)
const SKY_GROUP = { clear: 'fair', partly: 'fair', cloudy: 'cloudy', fog: 'fog', drizzle: 'wet', rain: 'wet', storm: 'storm', snow: 'snow' };

/** The log text for what they did on their own initiative. */
function describe(kind, who, extra) {
  const name = (id) => TEAM[id]?.name || id;
  const vars = {
    ...teamNames(), who: name(who), names: listOf([who, ...(extra.with || [])].map(name)), text: short(extra.text, 40),
    cause: extra.cause ? ` (${extra.cause})` : '', pane: extra.pane || '', title: extra.title || '',
  };
  switch (kind) {
    case 'archchat': case 'assign': return t(`sim.journal.${kind}`, { ...vars, names: listOf((extra.with || []).map(name)) });
    case 'dream': return t(extra.dream === 'skull' ? 'sim.journal.nightmare' : 'sim.journal.dream', { ...vars, dream: DREAMS[extra.dream]?.label || extra.dream, emoji: DREAMS[extra.dream]?.emoji || '' });
    case 'weather': return extra.text;
    case 'deskchat': case 'gossip': case 'idea': case 'feasibility': case 'consult': case 'rounds': case 'coffee': case 'requirement':
    case 'bathroom': case 'lunch': case 'lunchend': case 'fire': case 'repaired': case 'tv': case 'pane': case 'paneDone':
      return t(`sim.journal.${kind}`, vars);
    default: return t('sim.journal.other', { ...vars, kind });
  }
}

class Agent {
  constructor(id, cfg, clock, random) {
    this.id = id;
    this.cfg = cfg;
    this.clock = clock;
    this.x = cfg.seat.x; this.y = cfg.seat.y;
    this.seated = true;
    this.queue = [];
    this.state = 'idle';
    this.stateUntil = 0;
    this.text = '';
    this.bubble = null;
    this.badges = new Map(); // assigned subagents: id → description
    this.walkT = 0;
    this.lastActive = clock() + random() * 20_000;
    this.carry = false;      // true: a card; 'ext': the extinguisher
    this.jumpUntil = 0;
    this.shakeUntil = 0;
    this.handUp = false;
    this.history = [];
    this.dream = null;     // { kind: 'unicorn' | 'rainbow' | 'skull' | 'pizza', start, until } what they imagine
    this.scene = null;     // the conversation they are in
    this.perch = false;    // sitting on a chair that is not theirs (having lunch)
    this.hidden = false;   // inside the bathroom
    this.dance = false;    // waiting for the bathroom to be free
    this.food = null;      // what they are eating
    this.lunch = null;     // { seat } while having lunch at the café
    this.back = false;     // from behind (on the sofa, watching TV)
    this.tvSeat = null;    // the sofa spot they take
    this.diningSeat = null; // their chair in the dining room, while having lunch
    this.mind = freshMind(random);
  }

  get away() { return !this.seated || this.queue.length > 0; }
  get walking() { return this.queue[0]?.t === 'walk'; }

  say(text, ms = 3800, tone) { this.bubble = { text, until: this.clock() + ms, tone }; }

  setState(state, ms = 6000) {
    this.state = state;
    this.stateUntil = this.clock() + ms;
    this.lastActive = this.clock();
  }

  /** Free to do something on their own initiative: seated, no queue, no conversation, no urgencies. */
  get free() { return this.seated && !this.queue.length && !this.scene && !this.lunch && !['blocked', 'waiting', 'red', 'alarm'].includes(this.state); }

  goTo(pt) {
    const from = this.queue.findLast((j) => j.end)?.end || { x: this.x, y: this.y };
    this.queue.push({ t: 'walk', path: route(from, pt), end: { x: pt.x, y: pt.y } });
    return this;
  }
  wait(ms) { this.queue.push({ t: 'wait', ms }); return this; }
  until(at) { this.queue.push({ t: 'until', at }); return this; }
  /** Waits until the condition holds. */
  waitFor(test) { this.queue.push({ t: 'cond', test }); return this; }
  then(fn) { this.queue.push({ t: 'fn', fn }); return this; }
  goHome() { this.goTo(this.cfg.seat); this.queue.push({ t: 'sit', end: this.cfg.seat }); return this; }
  /** Walks in a straight line (without going through the aisles): to move inside the living room. */
  walk(pt) { this.queue.push({ t: 'walk', path: [{ x: pt.x, y: pt.y }], end: { x: pt.x, y: pt.y } }); return this; }

  update(dt, now) {
    if (this.state !== 'idle' && now > this.stateUntil && !['waiting', 'blocked'].includes(this.state)) this.state = 'idle';
    if (this.state === 'blocked' && now > this.stateUntil + 4000) this.state = 'idle';
    if (this.bubble && now > this.bubble.until) this.bubble = null;

    const job = this.queue[0];
    if (!job) return;
    if (job.t === 'walk') {
      this.seated = false;
      this.perch = false;
      this.back = false;
      const target = job.path[0];
      if (!target) { this.queue.shift(); return; }
      const dx = target.x - this.x, dy = target.y - this.y, d = Math.hypot(dx, dy);
      const step = SPEED * dt;
      if (d <= step) { this.x = target.x; this.y = target.y; job.path.shift(); }
      else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
      if (Math.abs(dx) > 1) this.face = Math.sign(dx);
      this.walkT += dt;
      if (!job.path.length) this.queue.shift();
    } else if (job.t === 'wait') {
      job.until ??= now + job.ms;
      if (now >= job.until) this.queue.shift();
    } else if (job.t === 'until') {
      if (now >= job.at) this.queue.shift();
    } else if (job.t === 'cond') {
      if (job.test()) this.queue.shift();
    } else if (job.t === 'sit') {
      this.x = this.cfg.seat.x; this.y = this.cfg.seat.y; this.seated = true; this.queue.shift();
    } else if (job.t === 'fn') {
      this.queue.shift();
      job.fn(this);
    }
  }
}

// Aisles: behind row 1, between rows, and in front of row 2 (the table area).
function corridor(y) { return y < 270 ? CORRIDOR_TOP : y < 450 ? CORRIDOR_MID : CORRIDOR_LOW; }
function route(a, b) {
  const ca = corridor(a.y), cb = corridor(b.y);
  const pts = [{ x: a.x, y: ca }];
  if (ca !== cb) {
    const lane = LANES.reduce((best, l) => (Math.abs(a.x - l) + Math.abs(b.x - l) < Math.abs(a.x - best) + Math.abs(b.x - best) ? l : best));
    pts.push({ x: lane, y: ca }, { x: lane, y: cb });
  }
  pts.push({ x: b.x, y: cb }, { x: b.x, y: b.y });
  return pts;
}

// ------------------------------------------------------------------------------------

const pathLength = (pts, from) => pts.reduce((acc, p) => { const d = Math.hypot(p.x - from.x, p.y - from.y); from = p; return acc + d; }, 0);

/**
 * @param clock  () => ms; the renderers use performance.now (and pass the same `now` to step)
 * @param random () => [0,1); the tests use a seeded one
 * @param wall   () => epoch ms: the real time (for lunch); the tests fix it
 * @param zone   the office's time zone (null: the system's): it gives the time, the
 *               daylight and the simulated weather
 */
export function createSim({ clock = () => performance.now(), random = Math.random, wall = () => Date.now(), zone = null } = {}) {
  let simNow = clock();
  const now_ = () => simNow;
  const R = (a, b) => a + random() * (b - a);
  const P = (arr) => arr[Math.floor(random() * arr.length)];
  // the texts, in the game's language and with the team's current names
  const T = (key, vars) => t(key, { ...teamNames(), ...vars });
  const L = (key) => ta(key, teamNames());
  const chance = (p) => random() < p;
  const agents = Object.fromEntries(Object.entries(TEAM).map(([id, cfg]) => [id, new Agent(id, cfg, now_, random)]));
  let particles = [];
  let board = { title: '', todos: [], status: 'idle', source: '' };
  let banner = null; // { text, tone, until }
  let celebrateUntil = 0;
  let lastDev = null;
  let turn = null;   // role "on duty" declared by the agent
  let turnPhase = null;
  let lastBlocked = null;
  let scenes = [];   // conversaciones en curso
  let journal = [];  // what they did on their own initiative (for the terminal, the tests and the curious)
  let timers = [];   // things that happen a while later: { at, fn }
  let lastRequirement = { text: '', at: -Infinity };
  const memory = { task: '', lastError: null, lastGreen: null, fails: [], work: {} }; // what the office talks about and how the work is going
  // Office life
  let bath = { occupant: null, line: [], doorAt: -Infinity };
  let lunch = null;          // { endMin, nextTalk } mientras almuerzan
  let lunchDay = null;       // the day they already had lunch
  let fire = null;           // { phase: 'burning' | 'fighting' | 'repair' | 'done', start, at, level, crew, fighter, sprinklers }
  let lastFireAt = simNow - 5 * 60_000;
  let heat = 0;              // rack temperature: rises with the backend's load
  let extinguisher = 'floor';
  let nextOffice = 0;
  let weather = null;        // the real weather the server sends (null: simulated by season)
  let skyGroup = null;       // the last weather seen (to comment when it changes)
  let lastWeatherTalk = -Infinity;
  let lastStrike = simNow;

  const log = (a, text) => {
    a.history.unshift({ ts: Date.now(), text });
    if (a.history.length > 40) a.history.pop();
  };
  const later = (ms, fn) => timers.push({ at: simNow + ms, fn });
  let tz = validZone(zone) ? zone : null;
  const wallDate = () => zoned(wall(), tz);
  // without real weather, it is simulated in the time zone's city
  const simPlace = () => { const z = zoneInfo(tz || systemZone()); return { lat: z.lat, lon: z.lon, place: z.city }; };
  const minutesOfDay = () => { const d = wallDate(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const dayKey = () => { const d = wallDate(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  function emit(x, y, n, kind, color, ch, vel) {
    for (let i = 0; i < n; i++) {
      const p = {
        x, y, kind, color: color || P(['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c86bfa', '#ff7a45']),
        vx: kind === 'confetti' ? R(-40, 40) : kind === 'sparkle' ? R(-35, 35) : kind === 'smoke' ? R(-10, 10) : R(-18, 18),
        vy: kind === 'confetti' ? R(30, 90) : kind === 'sparkle' ? R(-40, 10) : kind === 'smoke' ? R(-34, -18) : kind === 'drop' ? R(160, 220) : R(-50, -25),
        life: kind === 'confetti' ? R(2.5, 4.5) : kind === 'smoke' ? R(2, 3.4) : kind === 'sparkle' || kind === 'emote' ? R(1.2, 2) : kind === 'foam' ? R(0.5, 0.9) : R(0.8, 1.4),
        ch: ch || (kind === 'sparkle' ? P(['✦', '✧', '⋆']) : P(CODE_GLYPHS)), rot: R(0, 6), size: R(0.6, 1.2),
      };
      if (vel) Object.assign(p, vel(p));
      particles.push(p);
    }
    if (particles.length > 600) particles = particles.slice(-600);
  }

  /** Empties what they planned to do, except finishing in the bathroom if they already went in. */
  function clearQueue(a) {
    a.queue = a.queue.filter((j) => j.bath && bath.occupant === a.id);
    if (bath.line.includes(a.id)) bath.line = bath.line.filter((id) => id !== a.id);
    a.dance = false;
    if (a.carry === 'ext') { a.carry = false; extinguisher = 'floor'; }
    // if they were on the sofa, they leave from the side (so as not to cross the TV)
    if (a.tvSeat != null) { a.tvSeat = null; a.back = false; if (a.y > TV.feet) a.walk(SOFA.side); }
    // if they were seated at the dining table, they leave the way they came (so as not to cross the table)
    if (a.diningSeat) {
      const seat = a.diningSeat;
      a.diningSeat = null;
      a.back = false;
      if (Math.hypot(a.x - seat.x, a.y - seat.y) < 2) fromDiningSeat(a, seat);
    }
  }

  /** Puts a character to work at their desk (they come back if they were away). */
  function work(a, text, state = 'working', ms = 6000) {
    // real work comes first: they leave the conversation or lunch and go back to their spot
    if (a.lunch || LEISURE.has(a.scene?.kind)) { interrupt(a); emit(a.x, a.y - 70, 1, 'emote', null, '🏃'); }
    a.text = text;
    a.setState(state, ms);
    a.say(text);
    a.handUp = false;
    if (!a.seated && a.queue.length === 0) a.goHome();
  }

  // A character walks up to another, says something and goes back to their spot.
  function visit(a, target, line, { carry = false, stay = 1600, after } = {}) {
    if (a.queue.length > 4) { a.say(line); after?.(); return false; } // very busy: says it from afar
    const s = agents[target]?.cfg.seat || target;
    a.carry = carry;
    a.goTo({ x: s.x + (s.x > 700 ? -70 : 62), y: s.y - 6 })
      .then(() => { a.say(line, stay + 1200); a.carry = false; after?.(); })
      .wait(stay)
      .goHome();
    return true;
  }

  function handle(ev) {
    const a = agents[ev.role];
    const now = simNow;
    if (a) log(a, ev.text);
    switch (ev.kind) {
      case 'session_start':
        agents.manager.say(T('sim.sessionStart'));
        break;
      case 'task':
        turn = turnPhase = null;
        board = { ...board, title: ev.text, todos: [] };
        requirement(ev.text);
        break;
      case 'todos': {
        const m = agents.manager;
        m.setState('working', 4000);
        if (!m.away) m.goTo({ x: SPOT.board.x + 70, y: SPOT.board.y }).then((x) => x.say(ev.text)).wait(1400).goHome();
        else m.say(ev.text);
        const done = board.todos.filter((t) => t.status === 'completed').length;
        if (done && done === board.todos.length) emit(SPOT.board.x, 60, 30, 'confetti');
        break;
      }
      case 'tool_start':
        if (!a) break;
        work(a, ev.text, ev.phase === 'red' ? 'red' : 'working', ev.phase === 'red' ? 10_000 : 6000);
        emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 3, 'code', a.cfg.shirt);
        if (DEVS.includes(ev.role)) lastDev = ev.role;
        break;
      case 'tool_end':
        if (!a) break;
        if (!ev.ok && ev.phase !== 'red') memory.lastError = { role: a.id, at: now };
        if (ev.ok && ev.role === 'qa' && ev.phase !== 'red' && /^(bash|shell|exec)$/i.test(ev.tool)) memory.lastGreen = { at: now };
        if (ev.ok) {
          a.stateUntil = Math.max(a.stateUntil, now + 2500);
          emit(a.x, a.y - 60, ev.role === 'qa' ? 6 : 1, 'check');
          if (ev.role === 'qa' && ev.phase !== 'red' && /^(bash|shell|exec)$/i.test(ev.tool)) a.say(T('sim.testsGreen'), 3000);
        } else if (ev.phase === 'red') {
          // TDD: in RED the test has to fail. It is a good sign, not a bug.
          a.setState('red', 10_000);
          a.say(T('sim.redExpected'), 3500, 'error');
          emit(a.x, a.y - 40, 6, 'spark', '#ef476f');
        } else if (ev.role === 'qa') {
          // QA found a bug: they go tell whoever touched the code last.
          const dev = agents[lastDev] || agents.tl;
          a.setState('talking', 6000);
          a.say(T('sim.foundBug'), 2500, 'error');
          emit(a.x, a.y - 50, 6, 'bug');
          visit(a, dev.id, T('sim.bugReport', { name: dev.cfg.name, text: ev.text }), {
            stay: 2600,
            after: () => later(1200, () => { dev.setState('thinking', 6000); dev.say(T('sim.checkIt'), 3000); }),
          });
        } else {
          a.setState('blocked', 6000);
          a.shakeUntil = now + 700;
          a.say(ev.text, 5000, 'error');
          emit(a.x, a.y - 40, 14, 'spark', '#ff4d4d');
          if (ev.role !== 'tl') visit(agents.tl, ev.role, T('sim.helpError'), { stay: 2200 });
          else agents.tl.say(T('sim.reviewThis'), 4000);
        }
        break;
      case 'subagent_start': {
        if (!a) break;
        a.badges.set(ev.subId, ev.text);
        const m = agents.manager;
        const line = T('sim.assignSub', { name: a.cfg.name, text: ev.text });
        if (ev.role !== 'manager') visit(m, ev.role, line, { carry: true, after: () => work(a, T('sim.subtask', { text: ev.text }), 'working', 7000) });
        else work(a, T('sim.subtask', { text: ev.text }));
        break;
      }
      case 'subagent_end':
        if (!a) break;
        a.badges.delete(ev.subId);
        a.setState('done', 2500);
        a.say(T('sim.subDone', { text: ev.text }));
        // small note for a finished subtask: the big celebration is saved for 'done' (merge)
        emit(a.x, a.y - 60, 1, 'check');
        break;
      case 'waiting':
        agents.manager.handUp = true;
        agents.manager.setState('waiting', 60_000);
        agents.manager.say(T('sim.needOk'), 8000, 'warn');
        banner = { text: `⚠  ${ev.text}`, tone: 'warn', until: now + 60_000 };
        break;
      case 'error':
        if (!a) break;
        a.setState('blocked', 6000);
        a.shakeUntil = now + 700;
        a.say(ev.text, 5000, 'error');
        break;
      case 'thinking':
        if (a) work(a, ev.text, 'thinking', 5000);
        break;
      case 'compact':
        work(agents.manager, ev.text, 'working', 4000);
        break;
      case 'done':
        turn = turnPhase = null;
        celebrate(ev.text);
        break;
      case 'session_end':
        agents.manager.say(T('sim.sessionEnd'));
        break;
      case 'chat': {
        banner = { text: `💬 ${ev.from}: ${ev.text}`, tone: 'chat', until: now + 7000 };
        const who = a || agents.po;
        who.say(P(L('sim.chatReplies')), 3500);
        break;
      }
      // btw: a side question to the agent on duty. Whoever holds the turn (or the PO) stays thinking
      // and then answers out loud; the full answer stays in the log.
      case 'btw': {
        const who = a || agents.po;
        if (ev.phase === 'ask') {
          banner = { text: `❓ btw · ${ev.from}: ${short(ev.text, 90)}`, tone: 'chat', until: now + 8000 };
          who.setState('thinking', 120_000);
          who.say(P(L('sim.btwThinking')), 5000);
        } else if (ev.phase === 'answer') {
          banner = { text: `💡 ${who.cfg.name}: ${short(ev.text, 110)}`, tone: 'chat', until: now + 12_000 };
          who.setState('done', 2500);
          who.jumpUntil = now + 600;
          who.say(short(ev.text, 160), 10_000);
        } else {
          who.setState('idle', 1000);
          who.say(T('sim.btwFail'), 4500);
        }
        break;
      }
      case 'poke':
        if (!a) break;
        a.jumpUntil = now + 700;
        a.say(T('sim.poke', { from: ev.from }), 2500);
        break;
      case 'dispatch':
        // A brief sent from the office: it is a new requirement for the team.
        banner = { text: `📨 ${ev.text}`, tone: 'chat', until: now + 6000 };
        requirement(ev.text.replace(/^[^:]*:\s*/, ''));
        break;
      case 'phase':
        if (a) phase(a, ev, now);
        break;
      case 'phase_end':
        turn = turnPhase = null;
        if (a) a.say(ev.text || T('sim.turnEnd'), 2500);
        break;
      case 'turn_end':
        // end of turn, without celebration: the same calm as closing a phase.
        turn = turnPhase = null;
        if (a) a.say(ev.text || T('sim.turnEnd'), 2500);
        break;
      case 'stage_end':
        // a pipeline stage finished: it passed (or not) its gate
        if (!a) break;
        if (ev.ok) { a.jumpUntil = now + 800; a.say(ev.text || T('sim.stageOk'), 2600); emit(a.x, a.y - 60, 6, 'check'); }
        else { a.setState('blocked', 5000); a.shakeUntil = now + 600; a.say(ev.text || T('sim.stageFail'), 4000, 'error'); emit(a.x, a.y - 40, 10, 'spark', '#ff4d4d'); }
        break;
      // a herdr pane the agent (or the office) opened: someone on the team takes care of it
      case 'pane_open': {
        if (!a) break;
        const key = `pane:${ev.pane}`;
        if (a.badges.has(key)) break;
        a.badges.set(key, ev.text);
        note('pane', a.id, { pane: ev.pane, title: ev.text });
        const busy = () => work(a, T('sim.paneWork', { title: ev.text }), 'working', 7000);
        if (ev.role !== 'manager') visit(agents.manager, ev.role, T('sim.paneAssign', { name: a.cfg.name, pane: ev.pane, title: short(ev.text, 30) }), { carry: true, after: busy });
        else busy();
        break;
      }
      case 'pane_close':
        if (!a || !a.badges.delete(`pane:${ev.pane}`)) break;
        note('paneDone', a.id, { pane: ev.pane, title: ev.text });
        a.setState('done', 2500);
        a.jumpUntil = now + 700;
        a.say(T('sim.paneDone', { title: short(ev.text, 40) }), 2600);
        break;
      case 'pane_state':
        if (!a) break;
        if (ev.state === 'working') work(a, T('sim.paneWork', { title: ev.text }), 'working', 8000);
        else if (ev.state === 'blocked') {
          a.setState('waiting', 20_000);
          agents.manager.handUp = true;
          agents.manager.say(T('sim.paneBlocked', { pane: ev.pane }), 6000, 'warn');
        } else if (ev.state === 'done') { a.setState('done', 2500); a.jumpUntil = now + 700; }
        break;
    }
    correlate(ev);
    // Any agent event clears the waiting notice (it was already answered).
    if (!['waiting', 'chat', 'poke'].includes(ev.kind) && !(ev.kind === 'pane_state' && ev.state === 'blocked')) {
      if (banner?.tone === 'warn') banner = null;
      if (agents.manager.handUp) { agents.manager.handUp = false; if (agents.manager.state === 'waiting') agents.manager.state = 'idle'; }
    }
  }

  /** The agent declares that a role takes the turn in a phase of the flow (architect → QA RED → backend → QA GREEN…). */
  function phase(a, ev, now) {
    const ph = phaseInfo(ev.phase);
    const line = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
    turn = a.id;
    turnPhase = ev.phase;
    log(a, line);

    // Handover: whoever held the turn brings the card to the next one (if they are working at their spot).
    const from = agents[ev.from];
    const atDesk = !['board', 'visit', 'release'].includes(ph.anim);
    if (from && from !== a) {
      if (atDesk && !from.away) visit(from, a.id, T('sim.yourTurn', { name: a.cfg.name, phase: ph.label }), { carry: true, stay: 1200 });
      else from.say(T('sim.passTurn', { name: a.cfg.name, phase: ph.label }), 2500);
    }

    switch (ph.anim) {
      case 'board':
        a.setState('talking', 8000);
        if (!a.away) a.goTo({ x: SPOT.board.x + R(-60, 60), y: SPOT.board.y }).then((x) => x.say(line, 5000)).wait(3000).goHome();
        else a.say(line, 5000);
        break;
      case 'think': work(a, line, 'thinking', 8000); break;
      case 'red':
        work(a, line, 'red', 12_000);
        a.say(line, 5000, 'error');
        emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 8, 'spark', '#ef476f');
        break;
      case 'green':
        work(a, line, 'done', 5000);
        a.jumpUntil = now + 900;
        emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 8, 'check');
        emit(a.cfg.seat.x, a.cfg.seat.y - 60, 14, 'confetti');
        break;
      case 'approve':
        a.setState('done', 4000);
        a.jumpUntil = now + 900;
        a.say(line, 4000);
        emit(a.cfg.seat.x, a.cfg.seat.y - 60, 12, 'confetti');
        break;
      case 'reject':
        a.setState('blocked', 5000);
        a.shakeUntil = now + 600;
        a.say(line, 4500, 'warn');
        break;
      case 'blocked':
        a.setState('blocked', 30_000);
        a.say(line, 6000, 'error');
        lastBlocked = a.id;
        if (a.id !== 'manager') visit(agents.manager, a.id, T('sim.whatBlocks'), { stay: 2200 });
        break;
      case 'release':
        celebrate(T('sim.release', { text: ev.text ? `: ${ev.text}` : '' }), { icon: '🚀' });
        break;
      case 'visit': {
        const target = {
          review: DEVS.includes(ev.from) ? ev.from : lastDev,
          bug: DEVS.includes(ev.from) ? ev.from : lastDev,
          'revision-visual': 'frontend',
          desbloquea: lastBlocked || ev.from,
        }[ev.phase];
        a.setState('working', 8000);
        if (target && target !== a.id) visit(a, target, line, { stay: 2600 });
        else a.say(line);
        if (ev.phase === 'bug') emit(a.x, a.y - 50, 6, 'bug');
        if (ev.phase === 'desbloquea' && agents[target]) agents[target].state = 'idle';
        break;
      }
      default:
        work(a, line, 'working', 10_000);
    }
  }

  function celebrate(text, { icon = '🎉', tone = 'done' } = {}) {
    const now = simNow;
    celebrateUntil = now + 9000;
    banner = { text: `${icon} ${text}`, tone, until: now + 6000 };
    emit(W / 2, -10, 160, 'confetti');
    Object.values(agents).forEach((a, i) => {
      a.badges.clear();
      a.setState('done', 8000);
      a.handUp = false;
      if (a.queue.length > 4 || a.lunch || a.hidden) return;
      const [dx, dy] = TABLE_SEATS[i];
      a.wait(i * 150).goTo({ x: SPOT.table.x + dx, y: SPOT.table.y + dy })
        .then((x) => { x.jumpUntil = simNow + 2500; if (i % 2 === 0) x.say(P(L('sim.cheers'))); })
        .wait(4200).goHome();
    });
  }

  // ---------------------------------------------------------------- each one's brain

  const note = (kind, who, extra = {}) => {
    journal.push({ t: simNow, ts: wall(), kind, who, ...extra, text: describe(kind, who, extra), detail: extra.text });
    if (journal.length > 300) journal = journal.slice(-300);
  };

  /** Pulls someone out of what they were doing (conversation or lunch) and sends them to their spot. */
  function interrupt(a) {
    const busy = a.scene || a.lunch;
    if (a.scene) {
      const sc = a.scene;
      sc.lines = sc.lines.filter((l) => l.who !== a.id);
      sc.members = sc.members.filter((m) => m !== a.id);
      a.scene = null;
    }
    if (a.lunch) { a.lunch = null; a.food = null; if (a.state === 'lunch') a.state = 'idle'; }
    if (busy && !a.seated) { clearQueue(a); a.goHome(); }
  }

  /**
   * A conversation: the participants go to `spot` (or stay where they are if it is null) and
   * talk in turns. lines: [[who, text], …]
   */
  function scene(kind, members, lines, { spot = null, gap = 2300, after, quiet = false } = {}) {
    let arrive = simNow;
    const sc = { kind, members: [...members], lines: [], end: 0, after };
    if (spot) {
      members.forEach((id, i) => {
        const a = agents[id];
        const off = members.length === 1 ? 0 : (i - (members.length - 1) / 2) * 44;
        const pt = { x: Math.max(30, Math.min(W - 30, spot.x + off)), y: spot.y + (i % 2 ? 6 : 0) };
        const from = { x: a.x, y: a.y };
        arrive = Math.max(arrive, simNow + (pathLength(route(from, pt), from) / SPEED) * 1000);
        a.goTo(pt);
      });
    }
    let at = arrive + 400;
    for (const [who, text] of lines) { sc.lines.push({ who, text, at }); at += gap; }
    sc.end = at + 600;
    for (const id of members) {
      const a = agents[id];
      a.scene = sc;
      if (spot) a.until(sc.end).goHome();
    }
    scenes.push(sc);
    if (!quiet) note(kind, members[0], { with: members.slice(1) });
    return sc;
  }

  /** Someone else joins the scene to reply; the scene lasts until `end`. */
  function join(sc, id, lines, end) {
    sc.lines.push(...lines.map(([text, at]) => ({ who: id, text, at })));
    sc.end = Math.max(sc.end, end);
    if (!sc.members.includes(id)) { sc.members.push(id); agents[id].scene = sc; }
    for (const m of sc.members) agents[m].queue = agents[m].queue.map((j) => (j.t === 'until' ? { ...j, at: sc.end } : j));
  }

  /** What is said in the chit-chat: office gossip and what is going on. */
  function gossipLine(id) {
    const topics = [...(PRODUCT.includes(id) ? L(`sim.gossip.${id}`) : L('sim.replies'))];
    if (memory.task) topics.push(T('sim.gossipTask', { task: short(memory.task, 22) }));
    if (memory.lastError && simNow - memory.lastError.at < 120_000) topics.push(T('sim.gossipError', { name: TEAM[memory.lastError.role].name }));
    if (memory.lastGreen && simNow - memory.lastGreen.at < 120_000) topics.push(T('sim.gossipGreen', { name: TEAM.qa.name }));
    if (journal.some((j) => j.kind === 'repaired' && simNow - j.t < 10 * 60_000)) topics.push(T('sim.gossipFire'));
    return P(topics);
  }

  function gossip(a) {
    const others = PRODUCT.filter((id) => id !== a.id && agents[id].free);
    if (!others.length) return false;
    const members = [a.id, ...others.slice(0, chance(0.5) ? 2 : 1)];
    const lines = [[a.id, gossipLine(a.id)], [members[1], P(L('sim.replies'))]];
    if (members[2]) lines.push([members[2], P(L('sim.replies'))]);
    if (chance(0.5)) lines.push([a.id, P([...L('sim.replies'), gossipLine(a.id)])]);
    // sitting together they chit-chat from the desk; sometimes they meet at the café or the sofa
    const spot = chance(0.55) ? null : P([{ x: COUNTER_SPOTS[0].x, y: COUNTER_SPOTS[0].y + 4 }, SPOT.sofa, { x: 210, y: CORRIDOR_TOP + 4 }]);
    // and sometimes an idea comes out of the chat and they take it to the manager
    const idea = chance(0.2) && agents.manager.free;
    scene(spot ? 'gossip' : 'deskchat', members, lines, {
      spot,
      after: () => { if (idea) pitchIdea(a); emit(agents[members[0]].x, agents[members[0]].y - 70, 3, 'emote', null, P(['😂', '💬', '✨', '💜'])); },
    });
    for (const id of members) { agents[id].mind.social = -R(0, 0.4); agents[id].setState('talking', 4000); }
    return true;
  }

  function pitchIdea(a) {
    if (!a.free || !agents.manager.free) return;
    a.carry = true;
    const sc = scene('idea', [a.id], [[a.id, T('sim.pitch', { idea: P(L('sim.ideas')) })]], { spot: { x: TEAM.manager.seat.x - 70, y: TEAM.manager.seat.y - 6 } });
    a.queue.splice(1, 0, { t: 'fn', fn: (x) => { x.carry = false; } });
    const at = sc.lines[0].at + 2200;
    join(sc, 'manager', [[P(L('sim.pitchReplies')), at]], at + 900);
  }

  /** How much faster their imagination fills up depending on what happens (nightmares after an error, pizza when hungry). */
  function dreamBoost(a) {
    if (a.id === 'qa' && memory.fails.some((t) => simNow - t < 180_000)) return 2.5; // with failing tests, nightmares
    if (DREAMERS[a.id]?.includes('pizza')) {
      const m = minutesOfDay();
      if (lunch) return 0;
      if (m >= 11.5 * 60 && m < LUNCH.start) return 2.5; // hungry before lunch
      if ((memory.work[a.id] || []).filter((t) => simNow - t < 5 * 60_000).length >= 8) return 2; // mucho teclear da hambre
    }
    return 1;
  }

  function imagine(a, { kind = P(DREAMERS[a.id]), line, cause } = {}) {
    if (a.hidden || a.state === 'alarm' || a.dream) return false;
    a.dream = { kind, start: simNow, until: simNow + 4800 };
    a.say(line || P(L(`sim.dreamLines.${kind}`)), 4200);
    if (kind === 'skull') { a.shakeUntil = simNow + 700; emit(a.x, a.y - 80, 1, 'emote', null, '😱'); }
    else if (kind === 'pizza') { a.jumpUntil = simNow + 600; emit(a.x, a.y - 80, 1, 'emote', null, '🤤'); }
    else a.jumpUntil = simNow + 1100;
    emit(a.x, a.y - 80, 10, 'sparkle', DREAMS[kind].glow);
    a.mind.dream = -R(0, 0.6);
    note('dream', a.id, { dream: kind, cause });
    return true;
  }

  function consultTL(a) {
    const tl = agents.tl;
    if (tl.scene || tl.away || tl.lunch) return false;
    // if they are doing something concrete ("Editing api.js") they say it: "I'm editing api.js: …"
    const doing = chance(0.5) ? t('sim.doing', { text: short(a.text, 26) }) : '';
    const sc = scene('consult', [a.id], [[a.id, T('sim.consultAsk', { doing, ask: P(L(`sim.ask.${a.id}`)) })]], { spot: { x: tl.cfg.seat.x + 62, y: tl.cfg.seat.y - 6 } });
    const at = sc.lines[0].at;
    join(sc, 'tl', [[P(L('sim.answers')), at + 2300]], at + 5300);
    sc.lines.push({ who: a.id, text: P(L('sim.thanks')), at: at + 4600 });
    a.mind.doubt = -R(0, 0.5);
    return true;
  }

  /** The architect goes to talk with someone from product (priorities, data, designs). */
  function archChat(tl, { target: want, asks = 'sim.tlAsks' } = {}) {
    if (!tl.free) return false;
    const who = PRODUCT.filter((id) => agents[id].free);
    if (!who.length) return false;
    const target = agents[who.includes(want) ? want : P(who)];
    const s = target.cfg.seat;
    // the TL goes to her desk; she answers without getting up
    const sc = scene('archchat', ['tl'], [['tl', P(L(`${asks}.${target.id}`))]], { spot: { x: s.x + 54, y: s.y - 6 }, quiet: true });
    note('archchat', 'tl', { with: [target.id] });
    const at = sc.lines[0].at + 2300;
    join(sc, target.id, [[P(L(`sim.tlReplies.${target.id}`)), at]], at + 2600);
    sc.lines.push({ who: 'tl', text: P(L('sim.tlThanks')), at: at + 2200 });
    tl.mind.product = -R(0, 0.5);
    return true;
  }

  /** Product goes to the TL to ask whether what is coming is feasible. */
  function feasibility(a) {
    const tl = agents.tl;
    if (!a.free || tl.scene || tl.away || tl.lunch) return false;
    const sc = scene('feasibility', [a.id], [[a.id, P(L('sim.feasibleAsk'))]], { spot: { x: tl.cfg.seat.x + 62, y: tl.cfg.seat.y - 6 } });
    const at = sc.lines[0].at;
    join(sc, 'tl', [[P(L('sim.feasibleAnswer')), at + 2300]], at + 4800);
    sc.lines.push({ who: a.id, text: P(L('sim.thanks')), at: at + 4400 });
    return true;
  }

  function rounds(m) {
    const busy = TECH.filter((id) => agents[id].seated && ['working', 'thinking'].includes(agents[id].state) && !agents[id].scene);
    if (!busy.length) return false;
    const who = agents[P(busy)];
    const sc = scene('rounds', ['manager'], [['manager', P(ta('sim.rounds', { name: who.cfg.name }))]],
      { spot: { x: who.cfg.seat.x + 62, y: who.cfg.seat.y - 6 } });
    const at = sc.lines[0].at + 2200;
    join(sc, who.id, [[P(L('sim.roundsReplies')), at]], at + 800);
    m.mind.rounds = -R(0, 0.6);
    return true;
  }

  /** What gets said in front of the TV (the forecast is the real one). */
  function tvLines() {
    const w = currentWeather(), info = WEATHER[w.kind];
    const lines = [...L('sim.tv'), T('sim.tvForecast', { label: t(`weather.${w.kind}`), temp: Number.isFinite(w.temp) ? `, ${Math.round(w.temp)}°` : '', icon: info.icon })];
    if (memory.task) lines.push(T('sim.tvTask', { task: short(memory.task, 18) }));
    return lines;
  }

  /** Sits on the sofa to watch TV for a while (with their back to us). */
  function watchTV(a, { cause, line } = {}) {
    if (!a.free) return false;
    const taken = new Set(Object.values(agents).map((o) => o.tvSeat).filter((i) => i != null));
    const seat = SOFA.seats.findIndex((_, i) => !taken.has(i));
    if (seat < 0) return false;
    const pt = { x: SOFA.seats[seat], y: SOFA.y };
    const from = { x: a.x, y: a.y };
    const arrive = simNow + ((pathLength(route(from, SOFA.side), from) + Math.hypot(pt.x - SOFA.side.x, pt.y - SOFA.side.y)) / SPEED) * 1000;
    const stay = R(18_000, 32_000);
    const lines = [[a.id, line || P(tvLines())]];
    if (chance(0.5)) lines.push([a.id, P(tvLines())]);
    const sc = scene('tv', [a.id], lines, { quiet: true, gap: stay / (lines.length + 1) });
    for (const l of sc.lines) l.at += arrive - simNow + 1500;
    sc.end = arrive + stay;
    a.tvSeat = seat;
    a.goTo(SOFA.side).walk(pt)
      .then((x) => { x.perch = true; x.back = true; })
      .waitFor(() => a.scene !== sc)
      .walk(SOFA.side)
      .then((x) => { x.tvSeat = null; })
      .goHome();
    a.mind.social = -R(0, 0.5);
    note('tv', a.id, { cause });
    return true;
  }

  function coffee(a) {
    if (Object.values(agents).some((o) => o !== a && o.scene?.kind === 'coffee')) return false; // one at a time to the coffee
    const spot = P(COUNTER_SPOTS);
    scene('coffee', [a.id], [[a.id, P(L('sim.coffee'))]], { spot: { x: spot.x + R(-8, 8), y: spot.y } });
    a.state = 'coffee'; a.stateUntil = simNow + 9000;
    a.mind.coffee = -R(0, 0.4);
    a.mind.bladder += 0.25; // the coffee kicks in later
    return true;
  }

  /** To the bathroom: one at a time. If it is occupied, they wait outside (restless). */
  function bathroom(a, urgent = false) {
    if (bath.line.includes(a.id) || bath.occupant === a.id || a.hidden) return false;
    bath.line.push(a.id);
    const place = bath.line.length - 1;
    note('bathroom', a.id);
    if (urgent) a.say(P(L('sim.bathUrgent')), 2400);
    a.mind.bladder = -R(0, 0.3);
    const n0 = a.queue.length;
    a.goTo({ x: BATH.line.x - place * 30, y: BATH.line.y })
      .then((x) => { if (bath.occupant || bath.line[0] !== x.id) { x.dance = true; if (chance(0.6)) x.say(P(L('sim.bathWait')), 2600); } })
      .waitFor(() => !bath.occupant && bath.line[0] === a.id)
      .then((x) => { x.dance = false; bath.occupant = x.id; bath.line.shift(); })
      .goTo(BATH.door)
      .then((x) => { x.hidden = true; x.bubble = null; bath.doorAt = simNow; })
      .wait(R(5000, 11_000))
      .then((x) => { x.hidden = false; bath.doorAt = simNow; bath.occupant = null; x.say(P(L('sim.bathDone')), 2400); });
    a.queue.slice(n0).forEach((j) => { j.bath = true; });
    a.goHome();
    return true;
  }

  /**
   * A new requirement: the product people discuss it, the PO takes it to the manager and he hands
   * it to whoever fits depending on what it is about.
   */
  function requirement(text) {
    text = String(text || '').trim();
    // the brief (dispatch) and the prompt the agent reports later (task) are the same request
    if (!text || simNow - lastRequirement.at < 20_000) { if (text) memory.task = text; return; }
    lastRequirement = { text, at: simNow };
    memory.task = text;
    const po = agents.po, m = agents.manager;
    for (const id of ['po', 'manager', ...PRODUCT]) interrupt(agents[id]);
    const targets = assignees(text);
    // in the product corner: they discuss it from their desks
    const pod = PRODUCT.filter((id) => id !== 'po' && agents[id].seated && !agents[id].queue.length);
    po.say(T('sim.reqArrived', { text: short(text, 40) }), 3600);
    po.setState('talking', 9000);
    if (pod[0]) agents[pod[0]].wait(900).then((x) => x.say(T(x.id === 'designer' && targets.includes('designer') ? 'sim.reqMockups' : x.id === 'analyst' ? 'sim.reqAnalyze' : 'sim.reqGo'), 2800));
    note('requirement', 'po', { with: ['manager'], text, to: targets });
    // the PO brings the card to Marco
    clearQueue(po);
    po.carry = true;
    po.wait(1400).goTo({ x: m.cfg.seat.x - 70, y: m.cfg.seat.y - 6 })
      .then((p) => {
        p.carry = false;
        p.say(T('sim.reqToManager', { text: short(text, 60) }), 3800);
        // Marco hands it out to his team depending on the task
        clearQueue(m);
        m.wait(1800).then((x) => { x.say(T('sim.reqSplit', { names: listOf(targets.map((r) => TEAM[r].name)) }), 3000); x.setState('working', 6000); });
        for (const r of targets) {
          const t = agents[r];
          m.then((x) => { x.carry = true; }).goTo({ x: t.cfg.seat.x + 62, y: t.cfg.seat.y - 6 })
            .then((x) => { x.carry = false; x.say(T('sim.reqForYou', { name: t.cfg.name, text: short(text, 50) }), 3600); note('assign', 'manager', { with: [r], text }); })
            .wait(2000)
            .then(() => { t.say(P(L('sim.reqTake')), 2600); t.lastActive = simNow; });
        }
        m.goHome();
      })
      .wait(2200).goHome();
  }

  // ---------------------------------------------------------------- almuerzo

  /** Are they in the middle of something the agent asked for? Then they have lunch at their desk. */
  const onDuty = (a) => a.badges.size > 0 || (['working', 'thinking', 'red'].includes(a.state) && simNow - a.lastActive < 20_000) || a.id === turn;

  /** To their dining room chair without crossing the table: the back ones come in through the wall's door
   *  and go down behind the chairs; the front ones arrive from below. */
  function toDiningSeat(a, seat) {
    const { aisle } = DINING;
    if (seat.row === 'back') a.goTo({ x: aisle.door, y: aisle.back }).walk({ x: seat.x, y: aisle.back }).walk(seat);
    else a.goTo({ x: aisle.side, y: aisle.front }).walk({ x: seat.x, y: aisle.front }).walk(seat);
    return a;
  }
  /** And to leave, the same path in reverse. */
  function fromDiningSeat(a, seat) {
    const { aisle } = DINING;
    if (seat.row === 'back') a.walk({ x: seat.x, y: aisle.back }).walk({ x: aisle.door, y: aisle.back });
    else a.walk({ x: seat.x, y: aisle.front }).walk({ x: aisle.side, y: aisle.front });
    return a;
  }

  function startLunch() {
    const m = minutesOfDay();
    lunchDay = dayKey();
    lunch = { endMin: Math.min(LUNCH.end, Math.max(m + 3, R(LUNCH.start + 35, LUNCH.end - 5))), nextTalk: simNow + R(6000, 9000) };
    banner = { text: T('sim.lunchBanner'), tone: 'chat', until: simNow + 7000 };
    note('lunch', 'manager');
    (agents.manager.hidden ? agents.po : agents.manager).say(P(L('sim.lunchCall')), 3200);
    // product and the manager, behind the table (facing us); the technical team, in front (from behind)
    const rows = { back: ['po', 'analyst', 'designer', 'manager'], front: ['backend', 'frontend', 'qa', 'tl'] };
    let i = 0;
    for (const [row, ids] of Object.entries(rows)) ids.forEach((id, k) => {
      const a = agents[id];
      if (onDuty(a)) { a.food = '🥪'; a.say(T('sim.lunchDesk'), 2600); return; }
      if (a.scene) interrupt(a);
      clearQueue(a);
      const seat = DINING_SEATS[row][k];
      a.lunch = { seat };
      const food = LUNCH_FOOD[id];
      const counter = COUNTER_SPOTS[i % COUNTER_SPOTS.length];
      a.wait(400 + i * 650).goTo({ x: counter.x + R(-6, 6), y: counter.y })
        .then((x) => { x.food = food; x.say(`${food} ${P(L('sim.lunchOrder'))}`, 2200); })
        .wait(1200);
      toDiningSeat(a, seat)
        .then((x) => { x.perch = true; x.back = seat.row === 'front'; x.diningSeat = seat; x.state = 'lunch'; x.stateUntil = Infinity; })
        .waitFor(() => !a.lunch)
        .then((x) => { x.food = null; x.diningSeat = null; if (x.state === 'lunch') x.state = 'idle'; });
      fromDiningSeat(a, seat).goHome();
      i++;
    });
  }

  function lunchTick() {
    if (simNow >= lunch.nextTalk) {
      lunch.nextTalk = simNow + R(5000, 9000);
      // a table row with at least two seated: one talks, another replies
      const rows = ['back', 'front'].map((row) => Object.values(agents).filter((a) => a.lunch && a.perch && a.diningSeat?.row === row && !a.scene));
      const row = P(rows.filter((r) => r.length >= 2));
      if (row) {
        const [a, b] = [...row].sort(() => random() - 0.5);
        const pool = PRODUCT.includes(a.id) || a.id === 'manager' ? L('sim.lunchTalk.product') : L('sim.lunchTalk.tech');
        scene('lunchtalk', [a.id, b.id], [[a.id, P(pool)], [b.id, P(L('sim.replies'))]], { quiet: true });
        if (chance(0.5)) emit(a.x, a.y - 60, 1, 'emote', null, a.food || '🍽️');
      }
    }
    if (minutesOfDay() >= lunch.endMin || minutesOfDay() < LUNCH.start) endLunch();
  }

  function endLunch() {
    lunch = null;
    note('lunchend', 'manager');
    banner = { text: T('sim.lunchEndBanner'), tone: 'chat', until: simNow + 5000 };
    // they get up little by little
    let i = 0;
    for (const a of Object.values(agents)) {
      if (a.lunch) later(i++ * 600, () => { a.lunch = null; });
      if (a.food === '🥪') a.food = null;
    }
    if (!agents.manager.hidden) agents.manager.say(P(L('sim.lunchEnd')), 2800);
  }

  // ---------------------------------------------------------------- the fire

  /** The rack catches fire: the technical team goes with the extinguisher, puts it out and restarts the servers. */
  function ignite(cause) {
    if (fire) return false;
    const crew = FIRE_ORDER.filter((id) => { const a = agents[id]; return !a.hidden && !a.lunch && !bath.line.includes(id); });
    if (!crew.length) return false;
    const fighter = crew[0];
    fire = { phase: 'burning', start: simNow, at: simNow, level: 0, crew, fighter, sprinklers: false };
    lastFireAt = simNow;
    banner = { text: T(cause ? 'sim.fireBannerCause' : 'sim.fireBanner'), tone: 'fire', until: simNow + 9000 };
    note('fire', fighter, { with: crew.slice(1), cause });
    // the office reacts
    ['manager', 'po', 'designer', 'analyst'].forEach((id, i) => later(300 + i * 500, () => { const a = agents[id]; if (!a.hidden) { a.say(T(`sim.fireYell.${id}`), 2600, 'error'); a.shakeUntil = simNow + 500; } }));
    for (const id of crew) {
      const a = agents[id];
      if (a.scene) interrupt(a);
      clearQueue(a);
      a.dream = null;
      a.setState('alarm', 60_000);
      if (id === fighter) {
        a.goTo(EXT_PICK)
          .then((x) => { x.carry = 'ext'; extinguisher = 'carried'; x.say(T('sim.fireGotExt'), 2200); })
          .goTo(FIRE_SPOT.backend)
          .then((x) => { if (fire?.phase === 'burning') { fire.phase = 'fighting'; fire.at = simNow; x.say(T('sim.fireBack'), 2500); } })
          .waitFor(() => !fire || fire.phase === 'done')
          .goTo(EXT_PICK)
          .then((x) => { x.carry = false; extinguisher = 'floor'; });
      } else {
        a.wait(R(300, 1000)).goTo(FIRE_SPOT[id]).then((x) => x.say(P(L(['tl', 'frontend', 'qa'].includes(id) ? `sim.fireCrew.${id}` : 'sim.fireCrew.other')), 2400))
          .waitFor(() => !fire || fire.phase === 'done');
      }
      a.then((x) => { if (x.state === 'alarm') x.state = 'idle'; }).goHome();
    }
    return true;
  }

  function fireTick(dt) {
    const f = fire;
    const cx = RACK.x + RACK.w / 2;
    if (f.phase === 'burning') {
      f.level = Math.min(1, f.level + dt / 2.5);
      // if nobody makes it (everyone busy), the sprinklers go off
      if (simNow - f.start > 25_000) { f.phase = 'fighting'; f.at = simNow; f.sprinklers = true; banner = { text: T('sim.sprinklers'), tone: 'fire', until: simNow + 5000 }; }
    } else if (f.phase === 'fighting') {
      f.level = Math.max(0, f.level - dt / 7);
      const fx = agents[f.fighter];
      if (f.sprinklers) { if (random() < dt * 40) emit(R(RACK.x - 30, RACK.x + RACK.w + 30), 124, 1, 'drop', '#7ad7f0'); }
      else if (fx.carry === 'ext' && random() < dt * 45) {
        const sx = fx.x + 27, sy = fx.y - 37; // the extinguisher's nozzle
        emit(sx, sy, 1, 'foam', '#ffffff', null, () => ({ vx: (cx - sx) * 1.6 + R(-30, 30), vy: (RACK.y + 40 - sy) * 1.6 + R(-30, 30) }));
      }
      if (f.level <= 0) {
        f.phase = 'repair'; f.at = simNow;
        const lines = [['tl', 600, T('sim.fireRepair.tl')], [f.fighter === 'backend' ? 'backend' : f.fighter, 1500, T('sim.fireRepair.backend')], ['qa', 2600, T('sim.fireRepair.qa')], ['frontend', 3800, T('sim.fireRepair.frontend')]];
        for (const [id, ms, text] of lines) if (f.crew.includes(id)) later(ms, () => agents[id].say(text, 2600));
      }
    } else if (f.phase === 'repair') {
      if (simNow - f.at > 7500) {
        f.phase = 'done'; f.at = simNow;
        agents[f.fighter].say(T('sim.serverUp'), 2800);
        agents[f.fighter].jumpUntil = simNow + 900;
        if (f.crew.includes('tl') && f.fighter !== 'tl') later(900, () => agents.tl.say(T('sim.postmortem'), 2600));
        emit(cx, RACK.y - 10, 24, 'confetti');
        note('repaired', f.fighter, { with: f.crew.filter((id) => id !== f.fighter) });
        heat = 0;
      }
    } else if (f.phase === 'done' && simNow - f.at > 1500) {
      fire = null;
      return;
    }
    // smoke and sparks while it burns (and some smoke while repairing)
    const smoke = f.phase === 'repair' ? 1.5 : f.phase === 'done' ? 0 : 7 * f.level + 1;
    if (random() < dt * smoke) emit(R(RACK.x + 4, RACK.x + RACK.w - 4), RACK.y - 6, 1, 'smoke', '#6c6f7d');
    if (f.phase !== 'repair' && f.phase !== 'done' && random() < dt * 4 * f.level) emit(R(RACK.x, RACK.x + RACK.w), RACK.y + R(0, 40), 2, 'spark', P(['#ffd166', '#ff9f1c']));
  }

  // ---------------------------------------------------------------- what the harness does, in the office
  //
  // Each signal from the agent and its subagents pushes a need or triggers a reaction of the
  // matching character; chance only decides the exact moment (and sometimes that it does not happen):
  //   failing tests or gates   → QA has nightmares; whoever failed is left with doubts (consults the TL)
  //   repeated errors          → the rack overheats and may catch fire
  //   subagent or tool         → that character types; lots of typing makes them hungry (dreams of pizza) and tired (coffee)
  //   design phases (ux/ui)    → the designer gets inspired (unicorns and rainbows)
  //   architecture / ADR       → the TL goes to ask product about the scope
  //   story / requirements     → product goes to ask the TL whether it is feasible
  //   the agent awaits your OK → those not working take the chance for coffee or a chat
  //   task finished            → celebration, and the devs dream of the party pizza
  const TEST_RX = /\b(tests?|jest|vitest|pytest|mocha|spec|e2e|playwright|cypress|npm t|go test|cargo test)\b/i;
  const within = (list, ms) => (list || []).filter((t) => simNow - t < ms);

  function correlate(ev) {
    const a = agents[ev.role];
    const red = ev.phase === 'red' || (turnPhase === 'red' && ev.role === turn);
    switch (ev.kind) {
      case 'tool_start':
      case 'subagent_start':
        if (!a) break;
        memory.work[a.id] = [...within(memory.work[a.id], 5 * 60_000), simNow];
        if (a.id === 'backend' && /bash|shell|exec/i.test(ev.tool || '')) heat = Math.min(1.2, heat + 0.04); // builds and scripts heat up the rack
        if (a.id === 'designer') a.mind.dream += ev.kind === 'subagent_start' ? 0.4 : 0.12; // designing inspires her
        break;
      case 'subagent_end':
        if (!a) break;
        // finished their subtask: sometimes they reward themselves with pizza (in dreams), otherwise with a coffee
        if (DREAMERS[a.id]?.includes('pizza') && chance(0.35)) later(R(1500, 3000), () => imagine(a, { kind: 'pizza', line: T('sim.pizzaReward'), cause: t('sim.cause.subtask') }));
        else a.mind.coffee = Math.max(a.mind.coffee, 0.95);
        break;
      case 'thinking':
        if (a?.id === 'designer') a.mind.dream += 0.25;
        break;
      case 'phase': {
        if (!a) break;
        if (['ux', 'ui', 'revision-visual'].includes(ev.phase) && a.id === 'designer') a.mind.dream = Math.max(a.mind.dream, 0.85);
        if (['arquitectura', 'adr', 'planifica'].includes(ev.phase) && a.id === 'tl') {
          later(R(9000, 14_000), () => { if (chance(0.7)) archChat(agents.tl, { target: P(['po', 'analyst']), asks: 'sim.tlScope' }); });
        }
        if (['historia', 'criterios', 'requisitos', 'analiza'].includes(ev.phase) && PRODUCT.includes(a.id)) {
          later(R(7000, 11_000), () => { if (chance(0.5)) feasibility(a); });
        }
        if (ev.phase === 'green') calm();
        break;
      }
      case 'waiting': {
        // while they wait for your OK, those not working take advantage of the pause: coffee or TV
        for (const id of PRODUCT) agents[id].mind.social = Math.max(agents[id].mind.social, 1);
        const idle = [...TECH, 'tl'].filter((x) => !['working', 'thinking'].includes(agents[x].state));
        if (idle[0]) agents[idle[0]].mind.coffee = Math.max(agents[idle[0]].mind.coffee, 1);
        if (idle[1]) later(R(1500, 4000), () => watchTV(agents[idle[1]], { cause: t('sim.cause.waitingOk') }));
        break;
      }
      case 'done':
        calm();
        for (const id of ['backend', 'frontend']) if (chance(0.5)) later(R(9500, 13_000), () => imagine(agents[id], { kind: 'pizza', line: P(L('sim.pizzaParty')), cause: t('sim.cause.taskDone') }));
        break;
      case 'task':
      case 'dispatch':
        if (assignees(ev.text).includes('designer')) agents.designer.mind.dream += 0.4;
        break;
    }
    // Failures and successes: tools, stage gates and agent errors.
    if (!['tool_end', 'stage_end', 'error'].includes(ev.kind)) return;
    const isTest = ev.kind === 'stage_end' || ev.role === 'qa' || TEST_RX.test(`${ev.tool || ''} ${ev.text || ''}`);
    if (ev.ok === false && !red) {
      memory.fails = [...within(memory.fails, 3 * 60_000), simNow];
      // failing tests keep QA up at night
      if (isTest) later(R(1200, 3200), () => { if (chance(0.85)) imagine(agents.qa, { kind: 'skull', line: P(L('sim.nightmares')), cause: t('sim.cause.testsFailed') }); });
      // whoever failed is left with doubts: soon they go consult the TL
      if (a && PERSONALITY[a.id]?.doubt) a.mind.doubt = Math.max(a.mind.doubt, 0.95);
      // errors overheat the server; if they pile up, it catches fire
      heat = Math.min(1.3, heat + (a?.id === 'backend' || ev.kind === 'error' ? 0.3 : 0.12));
      if (memory.fails.length >= 3 && heat >= 0.9 && !fire && !lunch && simNow - lastFireAt > 4 * 60_000 && chance(0.5)) {
        later(R(1500, 4000), () => { if (!fire && !lunch) ignite(t('sim.cause.tooManyErrors')); });
      }
    } else if (ev.ok && isTest) {
      calm();
    }
  }

  /** All green: QA breathes easy and the rack cools down a little. */
  function calm() {
    const qa = agents.qa;
    qa.mind.dream = Math.min(qa.mind.dream, 0);
    if (qa.dream?.kind === 'skull') qa.dream.until = Math.min(qa.dream.until, simNow + 400);
    memory.fails = [];
    heat = Math.max(0, heat - 0.15);
  }

  // ---------------------------------------------------------------- office life

  /** Every half second: the clock (lunch), the bathroom, the rack temperature and the unexpected. */
  function officeTick(dt) {
    const m = minutesOfDay();
    const lunchTime = m >= LUNCH.start && m < LUNCH.end;
    if (lunch) lunchTick();
    else if (lunchTime && lunchDay !== dayKey() && !fire) startLunch();
    weatherTick();
    if (bath.occupant && random() < dt * 0.25) emit(BATH.door.x + R(-10, 10), BATH.door.y - 50, 1, 'emote', null, P(['🎵', '🎶', '🧻', '🚿']));
    // the rack heats up with the backend's load; when hot, it smokes and may catch fire
    if (!fire && heat > 0.75 && random() < dt * 0.6) emit(R(RACK.x + 6, RACK.x + RACK.w - 6), RACK.y - 4, 1, 'smoke', '#9095b0');
    const hazard = (0.5 + heat) / (18 * 60); // per second: ~1 every 36 min when calm, ~1 every 12 min with the rack red-hot
    const crewHere = FIRE_ORDER.filter((id) => !agents[id].hidden && !agents[id].lunch).length;
    if (!fire && !lunch && simNow > celebrateUntil && simNow - lastFireAt > 8 * 60_000 && crewHere >= 2 && random() < dt * hazard) ignite();
  }

  // ---------------------------------------------------------------- the weather outside

  /** The weather seen through the glass: the real one (sent by the server) or one simulated by season. */
  const currentWeather = () => weather || simulatedWeather(wallDate(), simPlace());

  function weatherTick() {
    const w = currentWeather();
    const group = SKY_GROUP[w.kind] || 'fair';
    if (skyGroup && group !== skyGroup) weatherChanged(group, w);
    skyGroup = group;
    // with a storm, sometimes thunder scares someone
    if (w.kind === 'storm') {
      for (let k = Math.floor(lastStrike / 5200); k <= Math.floor(simNow / 5200); k++) {
        const at = strikeStart(k);
        if (at != null && at > lastStrike && at <= simNow && chance(0.3)) startle();
      }
    }
    lastStrike = simNow;
  }

  function startle() {
    const who = Object.values(agents).filter((a) => !a.hidden && !a.walking);
    if (!who.length) return;
    const a = P(who);
    a.shakeUntil = simNow + 500;
    emit(a.x, a.y - 80, 1, 'emote', null, P(['⚡', '😱']));
    if (chance(0.4)) a.say(P(L('sim.startle')), 2200);
  }

  function weatherChanged(group, w) {
    const night = daylight(wallDate(), w).night > 0.5;
    const news = t(`sim.weatherNews.${group === 'fair' && night ? 'stars' : group}`);
    note('weather', null, { text: T('sim.weatherNote', { news, label: t(`weather.${w.kind}`), temp: Number.isFinite(w.temp) ? `, ${Math.round(w.temp)}°` : '' }), sky: w.kind });
    // rain makes people want more coffee and TV
    if (group === 'wet' || group === 'storm') for (const id of [...TECH, 'tl']) agents[id].mind.social += 0.3;
    if (simNow - lastWeatherTalk < 5 * 60_000 || !chance(0.75)) return;
    const who = Object.values(agents).filter((a) => !a.hidden && !a.walking && a.state !== 'alarm');
    if (!who.length) return;
    lastWeatherTalk = simNow;
    const a = P(who);
    if (group === 'wet') a.mind.coffee = Math.max(a.mind.coffee, 0.9);
    later(R(800, 2500), () => { a.say(P(L(`sim.weatherTalk.${group}`)), 3600); emit(a.x, a.y - 80, 1, 'emote', null, WEATHER[w.kind].icon); });
  }

  /** Every so often, each character decides what to do based on their needs and personality. */
  function brain(a, dt) {
    const mind = a.mind, pers = PERSONALITY[a.id];
    // needs grow over time
    if (a.free && a.state !== 'working') mind.social += dt / pers.social;
    mind.coffee += (dt / pers.coffee) * (a.state === 'working' ? 1.6 : 1); // working tires them faster
    if (!a.hidden) mind.bladder += dt / pers.bladder;
    if (pers.doubt && a.seated && ['working', 'thinking'].includes(a.state)) mind.doubt += dt / pers.doubt;
    if (pers.dream) mind.dream += (dt / pers.dream) * dreamBoost(a);
    if (pers.rounds && a.free) mind.rounds += dt / pers.rounds;
    if (pers.product && a.free) mind.product += dt / pers.product;

    if (simNow < mind.nextThink) return;
    mind.nextThink = simNow + R(1200, 2600);
    if (a.dream && simNow > a.dream.until) a.dream = null;
    if (simNow < celebrateUntil || a.hidden || a.state === 'alarm') return;

    // they daydream (sometimes): the designer even while working; QA of skulls; the devs of pizza
    if (pers.dream && mind.dream >= 1 && !a.walking && !a.dream && (a.seated || a.perch) && chance(0.35)) return imagine(a);
    // the technical people, while working, sometimes get up to consult the Tech Lead
    if (pers.doubt && mind.doubt >= 1 && a.seated && !a.queue.length && !a.scene && chance(0.6)) { if (consultTL(a)) return; }
    // to the bathroom: if they cannot hold it any longer, they leave whatever they are doing at their desk
    if (mind.bladder >= 1.6 && a.seated && !a.queue.length && !a.scene && !a.lunch) { bathroom(a, true); return; }
    if (!a.free) return;
    if (mind.bladder >= 1 && chance(0.4)) { bathroom(a); return; }
    if (PRODUCT.includes(a.id) && mind.social >= 1) { if (gossip(a)) return; mind.social = 0.6; }
    if (pers.product && mind.product >= 1 && !['working', 'thinking', 'red'].includes(a.state) && chance(0.5)) { if (archChat(a)) return; mind.product = 0.7; }
    if (pers.rounds && mind.rounds >= 1 && a.state === 'idle') { if (rounds(a)) return; mind.rounds = 0.5; }
    // the technical people, with nothing to do, sometimes sit down to watch TV (more with rain)
    if ((TECH.includes(a.id) || a.id === 'tl') && mind.social >= 1 && a.state === 'idle' && !lunch) {
      if (chance(WET.has(currentWeather().kind) ? 0.7 : 0.45) && watchTV(a)) return;
      mind.social = 0.6;
    }
    if (mind.coffee >= 1 && a.state === 'idle' && a.badges.size === 0 && !lunch) coffee(a);
  }

  function runScenes() {
    for (const sc of scenes) {
      for (const l of sc.lines) {
        if (!l.said && simNow >= l.at) { l.said = true; agents[l.who]?.say(l.text, 3000); }
      }
    }
    for (const sc of scenes.filter((x) => simNow >= x.end)) {
      for (const id of sc.members) if (agents[id].scene === sc) agents[id].scene = null;
      sc.after?.();
    }
    scenes = scenes.filter((x) => simNow < x.end);
  }

  /** Advances the simulation `dt` seconds. The renderers call it once per frame. */
  function step(dt, now = clock()) {
    simNow = now;
    for (const a of Object.values(agents)) {
      a.update(dt, now);
      brain(a, dt);
      if (a.seated && a.state === 'working' && random() < dt * 2.2) emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 1, 'code', a.cfg.shirt);
      if (a.dream && random() < dt * 3) emit(a.x + R(-20, 20), a.y - R(90, 130), 1, 'sparkle', a.dream.kind === 'rainbow' ? P(RAINBOW_COLORS) : DREAMS[a.dream.kind].glow);
    }
    runScenes();
    if (timers.length) {
      const due = timers.filter((t) => now >= t.at);
      timers = timers.filter((t) => now < t.at);
      for (const t of due) t.fn();
    }
    heat = agents.backend.state === 'working' ? Math.min(1, heat + dt / 120) : Math.max(0, heat - dt / 300);
    if (fire) fireTick(dt);
    if (now >= nextOffice) { officeTick(Math.max(dt, 0.5)); nextOffice = now + 500; }
    if (now < celebrateUntil && random() < dt * 8) emit(R(0, W), -10, 3, 'confetti');
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark') p.vy += 140 * dt;
      if (p.kind === 'emote') p.vy = -22;
      if (p.kind === 'smoke') { p.vx *= 1 - dt * 0.5; p.size += dt * 0.8; }
      p.rot += dt * 6;
    }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 20);
    if (banner && now > banner.until) banner = null;
  }

  return {
    agents,
    handle,
    step,
    ignite,
    get board() { return board; },
    get banner() { return banner; },
    get particles() { return particles; },
    get turn() { return turn; },
    get turnPhase() { return turnPhase; },
    get journal() { return journal; },
    get scenes() { return scenes; },
    get fire() { return fire; },
    get lunch() { return lunch; },
    get bath() { return bath; },
    get extinguisher() { return extinguisher; },
    get heat() { return heat; },
    /** The weather outside: the real one if it came from the server, otherwise one simulated by season. */
    get weather() { return currentWeather(); },
    /** The office's date and time, in its time zone (a ZonedDate). */
    date: () => wallDate(),
    get zone() { return tz; },
    setZone(z) { tz = validZone(z) ? z : null; },
    setWeather(w) { weather = w && WEATHER[w.kind] ? w : null; },
    watchTV: (id, opts) => watchTV(agents[id], opts),
    setBoard(session) {
      if (session && 'turn' in session) { turn = session.turn; turnPhase = session.phase; } // the server rules
      board = session ? { title: session.title, todos: session.todos || [], status: session.status, source: session.source } : { title: '', todos: [] };
      if (board.title) memory.task = board.title;
    },
    reset() {
      for (const a of Object.values(agents)) {
        Object.assign(a, { queue: [], seated: true, x: a.cfg.seat.x, y: a.cfg.seat.y, state: 'idle', bubble: null, handUp: false, history: [], dream: null, scene: null, carry: false, perch: false, hidden: false, dance: false, food: null, lunch: null, back: false, tvSeat: null, diningSeat: null });
        a.badges.clear();
      }
      banner = null; particles = []; board = { title: '', todos: [] }; turn = turnPhase = lastDev = lastBlocked = null;
      scenes = []; timers = []; memory.task = ''; memory.lastError = memory.lastGreen = null; memory.fails = []; memory.work = {};
      bath = { occupant: null, line: [], doorAt: -Infinity };
      // if it is lunchtime, they go out again on the next tick
      lunch = null; lunchDay = null; fire = null; extinguisher = 'floor'; heat = 0; timers = [];
    },
  };
}
