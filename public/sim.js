// The office simulation, without drawing: characters, routes, reactions to events and particles.
// Used by the canvas renderer (browser, game.js) and the terminal renderer (tui/).
// All coordinates are in a world from x = LEFT to W and from y = 0 to H.
//
// Besides reacting to what the agent does, each character has its own "brain": needs that grow
// over time (talking, coffee, bathroom, consulting, dreaming) and a personality that decides what
// it does when nobody asks it for anything. The product NPCs (PO, analyst, designer) sit together
// and chit-chat; the designer dreams of unicorns and rainbows, QA of skulls and the devs of pizza;
// the technical people sometimes go consult the TL and the TL sometimes goes to talk with product;
// the manager hands out the requirements and makes rounds. The PO is the user: the PO brings your
// requests, the agent's questions and permissions go to the PO's desk, and the PO never decides
// anything alone (chit-chat yes; pitching ideas or answering scope questions, no). The office
// also has its own life: at 13:00 the team goes to lunch in the dining room, there is a bathroom
// (a room off the hallway, with two stalls, a queue and gossip at the mirror) and sometimes the
// server catches fire and the technical team puts it out and repairs it. The office takes the
// whole floor of a building: its door opens to a hallway with the elevator at its end, where the
// newcomers (the subagents) arrive and leave; each one gets a desk that is there while it works.
// The texts (dialogs, log) are in the game's languages (i18n.js, locales/).
// What happens "sometimes" always has a random factor: the need fills up and then a roll has to
// be won for it to happen.

import { daylight, simulatedWeather, strikeStart, WEATHER, WET } from './sky.js';
import { t, ta, listOf, onLanguage } from './i18n.js';
import { zoned, zoneInfo, systemZone, validZone } from './clock.js';
export { daylight } from './sky.js';

// The office is x 0..W; to its left, the hallway (with the elevator) and the bathroom; below the
// living room, the newcomers' desks. The canvas shows the whole floor: (W - LEFT) × H.
export const LEFT = -256, W = 960, H = 760;
export const WORLD_W = W - LEFT;

// Top row: the product corner (designer, PO and analyst, together) and the manager.
// Bottom row: the technical team, with the TL a bit apart (people go consult them).
// The job title comes from the game's language, unless customized in ⚙ › Characters.
export const TEAM = {
  designer: { name: 'Camila', title: 'Diseñadora', sex: 'f', personality: 'dreamer', style: 'normal', shirt: '#c86bfa', pants: '#3a2f45', hair: '#f2d16b', skin: '#f0c8a8', long: true, seat: { x: 100, y: 228 }, prop: 'tablet' },
  po: { name: 'Sofía', title: 'Product Owner', sex: 'f', personality: 'chatty', style: 'normal', shirt: '#e0607e', pants: '#3b3355', hair: '#5a3214', skin: '#f2c9a0', long: true, seat: { x: 210, y: 228 }, prop: 'notes' },
  analyst: { name: 'Valentina', title: 'Analista de negocio', sex: 'f', personality: 'chatty', style: 'normal', shirt: '#f0a73a', pants: '#2f3b52', hair: '#21160f', skin: '#c98e62', long: true, seat: { x: 320, y: 228 }, prop: 'chart' },
  manager: { name: 'Marco', title: 'Manager', sex: 'm', personality: 'chatty', style: 'normal', shirt: '#3f73f0', pants: '#2a2d3a', hair: '#8d8d8d', skin: '#e8b98f', seat: { x: 710, y: 228 }, prop: 'phone' },
  frontend: { name: 'Lucía', title: 'Frontend', sex: 'f', personality: 'focused', style: 'normal', shirt: '#ff7a45', pants: '#2d3a4f', hair: '#b8322a', skin: '#f5d0b0', long: true, seat: { x: 110, y: 418 }, prop: 'dual' },
  backend: { name: 'Diego', title: 'Backend', sex: 'm', personality: 'focused', style: 'normal', shirt: '#6b5bd6', pants: '#22222e', hair: '#151515', skin: '#b07a52', seat: { x: 220, y: 418 }, prop: 'terminal' },
  qa: { name: 'Andrés', title: 'QA', sex: 'm', personality: 'anxious', style: 'normal', shirt: '#8ac926', pants: '#2b3a2e', hair: '#3d2817', skin: '#e0ac7e', glasses: true, seat: { x: 330, y: 418 }, prop: 'qa' },
  tl: { name: 'Tomás', title: 'Tech Lead', sex: 'm', personality: 'calm', style: 'normal', shirt: '#22a68e', pants: '#26313a', hair: '#2b1b12', skin: '#d9a273', beard: true, seat: { x: 560, y: 418 }, prop: 'big' },
};
// The visiting specialists (DevOps/SRE and security) have no desk of their own: when the agent's work
// is theirs (a deploy, a container, a CI pipeline; an audit, a scanner, a key) one of them comes up by
// the elevator, sits at a hot desk while it lasts and leaves when it is over, like the newcomers. They
// are people, not extras: always the same one, drawn solid. Like the team, they can be customized in
// ⚙ › Characters; their title comes from the game's language.
export const VISITORS = {
  devops: { name: 'Rafa', title: 'DevOps/SRE', sex: 'm', personality: 'calm', style: 'normal', shirt: '#118ab2', pants: '#26313a', hair: '#3d2817', skin: '#d9a273', long: false, beard: true, glasses: false, prop: 'laptop', icon: '🛠️' },
  security: { name: 'Inés', title: 'Seguridad', sex: 'f', personality: 'focused', style: 'normal', shirt: '#ffd166', pants: '#2b2d42', hair: '#151515', skin: '#f0c8a8', long: true, beard: false, glasses: true, prop: 'laptop', icon: '🛡️' },
};
export const VISITOR_ROLES = Object.keys(VISITORS);
/** A role's person: the team's character or the visiting specialist (null if neither). */
export const personOf = (role) => TEAM[role] || VISITORS[role] || null;
/** A role's default look (before ⚙ › Characters): the team's, or the visiting specialist's. */
export const defaultLook = (role) => DEFAULT_TEAM[role] || DEFAULT_VISITORS[role];
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
export const APPEARANCE_KEYS = ['name', 'title', 'sex', 'personality', 'style', 'shirt', 'pants', 'hair', 'skin', 'long', 'beard', 'glasses'];
/**
 * How they answer you (like Claude's styles): normal, concise (straight to the point), explanatory
 * (the why, with an example), teacher (step by step, as to someone learning) or formal.
 */
export const STYLES = ['normal', 'concise', 'explanatory', 'teacher', 'formal'];
/** Sex: their face, their default look and how the texts that talk about them are written. */
export const SEXES = ['f', 'm'];
/**
 * Personality: how fast each need fills up (a factor: < 1, sooner) and what they do about it.
 *   chatty   — talks a lot: chit-chat at the desks and at the café, even if they are technical
 *   focused  — barely leaves the desk: few breaks, no TV, holds on to their doubts
 *   anxious  — many doubts (to the TL's desk), coffee and bathroom often
 *   calm     — takes it easy: coffee breaks and TV, no rush
 *   dreamer  — daydreams (unicorns and rainbows) while they work
 */
export const PERSONALITIES = {
  chatty: { social: 0.5, coffee: 0.9, doubt: 1, dream: 1.2, breaks: 0.6, chats: true, tv: true },
  focused: { social: 2.2, coffee: 1.3, doubt: 1.5, dream: 1.6, breaks: 2.2, chats: false, tv: false },
  anxious: { social: 1, coffee: 0.75, bladder: 0.7, doubt: 0.5, dream: 0.8, breaks: 0.9, chats: false, tv: true },
  calm: { social: 1.2, coffee: 0.8, doubt: 1.2, dream: 1, breaks: 0.7, chats: false, tv: true },
  dreamer: { social: 1, coffee: 1, doubt: 1, dream: 0.45, breaks: 1, chats: false, tv: true, dreams: ['unicorn', 'rainbow'] },
};
const defaults = (people) => Object.fromEntries(Object.entries(people).map(([id, c]) => {
  const look = Object.fromEntries(APPEARANCE_KEYS.filter((k) => k !== 'title').map((k) => [k, c[k] ?? false]));
  // the title follows the language and, where the language has it, their sex (Diseñadora / Diseñador)
  Object.defineProperty(look, 'title', { get: () => t(`team.titles.${id}`, { g: people[id]?.sex || c.sex }), enumerable: true });
  return [id, look];
}));
export const DEFAULT_TEAM = defaults(TEAM);
export const DEFAULT_VISITORS = defaults(VISITORS);
// Palettes to pick colors without typing hex (the terminal cycles them with ◂ ▸; the web also has a free picker).
export const LOOK_PALETTES = {
  shirt: ['#e0607e', '#f0a73a', '#3f73f0', '#22a68e', '#8ac926', '#6b5bd6', '#ff7a45', '#c86bfa', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'],
  pants: ['#2a2d3a', '#2f3b52', '#3b3355', '#26313a', '#2b3a2e', '#22222e', '#3a2f45', '#4a3b2a'],
  hair: ['#151515', '#21160f', '#3d2817', '#5a3214', '#8d8d8d', '#b8322a', '#f2d16b', '#e8e9f1'],
  skin: ['#f5d0b0', '#f2c9a0', '#f0c8a8', '#e8b98f', '#e0ac7e', '#d9a273', '#c98e62', '#b07a52', '#8d5a3b'],
};
/** A random look (🎲), believable for their sex: long hair more often for her, a beard only for him. */
export function randomLook(sex = 'f', rnd = Math.random) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  return { shirt: pick(LOOK_PALETTES.shirt), pants: pick(LOOK_PALETTES.pants), hair: pick(LOOK_PALETTES.hair), skin: pick(LOOK_PALETTES.skin), long: rnd() < (sex === 'f' ? 0.75 : 0.12), beard: sex === 'm' && rnd() < 0.35, glasses: rnd() < 0.3 };
}
/** Changing the sex changes the look too: she gets long hair and no beard; he, short hair. */
export const lookForSex = (sex) => (sex === 'f' ? { sex, long: true, beard: false } : { sex, long: false });

let appearance = {};
export function applyAppearance(overrides = {}) {
  appearance = overrides || {};
  for (const [id, cfg] of [...Object.entries(TEAM), ...Object.entries(VISITORS)]) {
    const o = appearance[id] || {};
    for (const k of APPEARANCE_KEYS) if (k !== 'title') cfg[k] = o[k] ?? defaultLook(id)[k];
    cfg.title = o.title ?? defaultLook(id).title; // after the sex: the default title agrees with it
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
// The bathroom: a room left of the hallway, with two stalls and a sink with its mirror on the back
// wall. Its walls are low (cut away, like a dollhouse) so what happens inside shows: whoever goes
// in walks to a free stall and closes its door, then washes their hands; at the mirror, they chat.
export const BATHROOM = {
  x0: LEFT, x1: -128, front: 420,                   // its floor: x0..x1, from the back wall to `front`
  door: { y0: 262, y1: 318 },                       // the gap in its wall to the hallway (x1..x1 + 8)
  stalls: [{ x: -234, w: 34 }, { x: -194, w: 34 }], // their doors, on the back wall (x: the middle)
  sink: { x: -156, y: 150, w: 44 },                 // the counter with the mirror (x: the middle)
};
const BATH_IN = { x: -150, y: 290 }, BATH_OUT = { x: -100, y: 290 };
const BATH_LINE = { x: -96, y: 340 };               // the queue, along the hallway's wall
const inBath = (p) => p.x < BATHROOM.x1 + 4 && p.y < BATHROOM.front;
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
export const PLANTS = [[700, 400], [944, 590], [16, 744], [748, 744], [944, 744], [-236, 744], [-142, 470]];
const TABLE_SEATS = [[-75, -40], [-25, -42], [25, -42], [75, -40], [-108, 0], [108, 0], [-100, 42], [100, 42]];
const CORRIDOR_TOP = 148, CORRIDOR_MID = 318, CORRIDOR_LOW = 462, CORRIDOR_FRONT = 624;
const LANES = [25, 445, 637];   // gaps between desks where people switch aisles
const FRONT_LANES = [240, 748]; // from the lower aisle to the front one: around the sofa and the meeting table
// The newcomers' desks: each subagent is a new employee who comes in for its subtask and leaves
// when it is done (a translucent extra of its role's character). Its desk appears with it, in the
// row in front of the living room, and goes with it; more newcomers than places sit at the
// meeting table.
export const HOT_DESKS = [70, 170, 270, 370, 470, 570, 670].map((x) => ({ x, y: 704 }));
// The hallway: from the office's door (in its left wall, at the lower aisle) to the elevator, at
// its end on the back wall. The newcomers arrive and leave by the elevator.
export const HALL = { x0: -120, x1: -8, spine: -64 };
export const OFFICE_DOOR = { y0: 430, y1: 494 };      // the gap in the office's left wall (x -8..0)
export const ELEVATOR = { x: -112, w: 96, spot: { x: HALL.spine, y: 134 } };
const DOOR_IN = { x: 14, y: CORRIDOR_LOW }, DOOR_OUT = { x: HALL.spine, y: CORRIDOR_LOW };
const NEWCOMER_NAMES = ['Nico', 'Sam', 'Alex', 'Robin', 'Fran', 'Dani', 'Cami', 'Juli', 'Ale', 'Gabi', 'Santi', 'Vale', 'Noa', 'Eli'];
const FADE_MS = 900;
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
  infra: { icon: '🏗️', anim: 'work' },
  audita: { icon: '🛡️', anim: 'work' },
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
  return { social: r(), coffee: r(), doubt: r(), dream: r() + 0.2, rounds: r(), bladder: r(), product: r(), brk: 0, nextThink: 0 };
}
/** The needs shown in the character's sheet (0 = satisfied, 1 = urgent). */
export const NEEDS = ['social', 'coffee', 'bladder', 'dream', 'doubt'];
export const needsOf = (id) => { const r = traitsOf(id); return NEEDS.filter((k) => k !== 'dream' || r.dream).filter((k) => k !== 'doubt' || r.doubt).map((k) => [k, t(`needs.${k}`)]); };

/**
 * How `id` behaves with the personality chosen for them (⚙ › Characters): their role's rhythm
 * (PERSONALITY) scaled by how their personality differs from the role's default one, so the
 * defaults behave as always and a different one shows (a chatty QA chats, a focused PO barely does).
 *   social, coffee, bladder, doubt, dream, breaks: seconds for each need to fill up (doubt and
 *   dream only for whom they apply); chats: joins the chit-chat; tv: watches TV when free;
 *   dreams: what they daydream about.
 */
export function traitsOf(id) {
  const base = PERSONALITY[id] || PERSONALITY.qa;
  const now = PERSONALITIES[TEAM[id]?.personality] || PERSONALITIES[DEFAULT_TEAM[id]?.personality] || PERSONALITIES.calm;
  const def = PERSONALITIES[DEFAULT_TEAM[id]?.personality] || now;
  const f = (k) => (now[k] ?? 1) / (def[k] ?? 1);
  const own = now !== def;
  const dreams = DREAMERS[id] || now.dreams;
  return {
    ...base,
    social: base.social * f('social'),
    coffee: base.coffee * f('coffee'),
    bladder: base.bladder * f('bladder'),
    doubt: base.doubt ? base.doubt * f('doubt') : 0,
    dream: base.dream ? base.dream * f('dream') : now.dreams ? 90 : 0,
    breaks: 150 * f('breaks'),
    chats: PRODUCT.includes(id) ? !own || now.chats || now.social <= 1 : own && now.chats,
    tv: TECH.includes(id) || id === 'tl' ? !own || now.tv : own && now.tv,
    dreams: dreams || [],
  };
}

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
const LEISURE = new Set(['standup', 'gossip', 'deskchat', 'bathgossip', 'coffee', 'workcoffee', 'lunchtalk', 'archchat', 'idea', 'rounds', 'tv']);

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
    case 'workcoffee': return extra.with?.length ? t('sim.journal.workcoffee', { ...vars, names: listOf(extra.with.map(name)) }) : t('sim.journal.workcoffeeAlone', vars);
    case 'standup': case 'deskchat': case 'gossip': case 'bathgossip': case 'idea': case 'feasibility': case 'consult': case 'rounds': case 'coffee': case 'requirement':
    case 'bathroom': case 'lunch': case 'lunchend': case 'fire': case 'repaired': case 'tv': case 'pane': case 'paneDone':
      return t(`sim.journal.${kind}`, vars);
    case 'newcomer': case 'farewell': case 'visitor': return t(`sim.journal.${kind}`, { ...vars, name: extra.name || '', role: personOf(who)?.title || who });
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
    this.taskAt = -Infinity; // the last time they did real work (their screen stays on a while)
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
    this.stress = null;    // { n, at }: errors in a row (from the real log); 3 or more: stressed 😰
    this.tired = false;    // their agent is running out of context: they yawn 🥱
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
      this.sideways = Math.abs(dx) >= Math.abs(dy); // across the screen (a stride) or up and down it (steps)
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

const hash = (n) => { n = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); return (n ^ (n >>> 16)) >>> 0; };
const seedOf = (id) => [...String(id)].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) | 0, 7);

/**
 * What a desk's screen shows (both renderers):
 *   'type'  — at the desk working: code being typed, line after line, scrolling up
 *   'think' — at the desk thinking (or with a task going on): the code stays, the cursor blinks
 *   'on'    — away from the desk with a task going on (at the café, at the TL's): still on, dimmer
 *   'off'   — nothing going on
 */
export function screenMode(a, now) {
  if (!a) return 'off';
  const onTask = now - (a.taskAt ?? -Infinity) < 150_000;
  if (a.seated && (a.state === 'working' || a.state === 'red')) return 'type';
  if (a.seated && (a.state === 'thinking' || onTask)) return 'think';
  return onTask || ['working', 'thinking', 'red'].includes(a.state) ? 'on' : 'off';
}

/**
 * The lines of code on a screen of `rows` × `cols` cells: each row is a list of segments
 * { x, w, c } (c: which of 4 colors). While typing, the last line grows character by character and
 * then everything scrolls up one line; otherwise the screen is still. cursor: where it blinks.
 */
export function screenLines(id, now, rows, cols, mode = 'type') {
  const period = 1100;
  const typing = mode === 'type';
  const clock = typing ? now : 0;
  const k = Math.floor(clock / period) + 40, p = typing ? Math.min(1, (clock % period) / (period * 0.7)) : 1;
  const seed = seedOf(id);
  const out = [];
  let cursor = { x: 0, y: rows - 1 };
  for (let r = 0; r < rows; r++) {
    const h = hash(seed + k - rows + 1 + r);
    const indent = Math.min(cols - 2, (h % 3) * 2);
    let len = Math.max(1, 2 + ((h >>> 3) % Math.max(1, cols - indent - 2)));
    if (r === rows - 1) len = Math.max(0, Math.round(len * p));
    const segs = [];
    let x = indent, left = len;
    while (left > 0) {
      const w = Math.min(left, 1 + ((h >>> (8 + segs.length * 3)) % 5));
      segs.push({ x, w, c: ((h >>> 20) + segs.length) % 4 });
      x += w + 1; left -= w + 1;
    }
    out.push(segs);
    if (r === rows - 1) cursor = { x: Math.min(cols - 1, segs.length ? x - 1 : indent), y: r };
  }
  return { rows: out, cursor, blink: Math.floor(now / 450) % 2 === 0 };
}

/**
 * The walk cycle, shared by both renderers: four frames per stride, so the feet step instead of
 * gliding. null when standing still.
 *   frame 0: the left foot ahead · 1: passing, the right one lifted · 2: the right ahead · 3: the left lifted
 * reach: how far each foot (left, right) is ahead, in sprite pixels (only when walking across the
 * screen); lift: whether it is in the air; bob: the body rises while passing; swing: the arms go
 * opposite to the legs.
 */
export function gait(a) {
  if (!a.walking) return null;
  const frame = Math.floor(a.walkT * 9) % 4;
  const side = a.sideways === false ? 0 : (a.face || 1);
  return {
    frame,
    reach: [frame === 0 ? side : frame === 2 ? -side : 0, frame === 2 ? side : frame === 0 ? -side : 0].map((x) => x || 0),
    lift: [frame === 3 ? 1 : 0, frame === 1 ? 1 : 0],
    bob: frame % 2,
    swing: frame === 0 ? 1 : frame === 2 ? -1 : 0,
  };
}

// Aisles: behind row 1, between rows, in front of row 2 (the table area) and behind the newcomers' row.
function corridor(y) { return y < 270 ? CORRIDOR_TOP : y < 450 ? CORRIDOR_MID : y < 600 ? CORRIDOR_LOW : CORRIDOR_FRONT; }
const nearest = (lanes, ax, bx) => lanes.reduce((best, l) => (Math.abs(ax - l) + Math.abs(bx - l) < Math.abs(ax - best) + Math.abs(bx - best) ? l : best));
/** Inside the office: along the aisles, switching between them at the gaps. */
function officeRoute(a, b) {
  const ca = corridor(a.y), cb = corridor(b.y);
  const pts = [{ x: a.x, y: ca }];
  let x = a.x, c = ca;
  const hop = (lanes, to) => { const l = nearest(lanes, x, b.x); pts.push({ x: l, y: c }, { x: l, y: to }); x = l; c = to; };
  if (c === CORRIDOR_FRONT && cb !== c) hop(FRONT_LANES, CORRIDOR_LOW);
  const mid = cb === CORRIDOR_FRONT ? CORRIDOR_LOW : cb;
  if (c !== mid) hop(LANES, mid);
  if (cb === CORRIDOR_FRONT && c !== cb) hop(FRONT_LANES, CORRIDOR_FRONT);
  pts.push({ x: b.x, y: cb }, { x: b.x, y: b.y });
  return pts;
}
/** In the hallway: along its middle. */
const hallRoute = (a, b) => [{ x: HALL.spine, y: a.y }, { x: HALL.spine, y: b.y }, { x: b.x, y: b.y }];
const zoneOf = (p) => (p.x >= 0 ? 'office' : inBath(p) ? 'bath' : 'hall');
/** From a to b: through the office's door and the bathroom's when they are in different rooms. */
function route(a, b) {
  const za = zoneOf(a), zb = zoneOf(b);
  if (za === zb) return za === 'office' ? officeRoute(a, b) : za === 'bath' ? [{ x: b.x, y: b.y }] : hallRoute(a, b);
  const pts = [];
  let cur = a;
  const go = (list) => { pts.push(...list); cur = list[list.length - 1]; };
  if (za === 'bath') go([BATH_IN, BATH_OUT]);
  else if (za === 'office') go([...officeRoute(a, DOOR_IN), DOOR_OUT]);
  if (zb === 'office') go([...hallRoute(cur, DOOR_OUT), ...officeRoute(DOOR_IN, b)]);
  else if (zb === 'bath') go([...hallRoute(cur, BATH_OUT), BATH_IN, { x: b.x, y: b.y }]);
  else go(hallRoute(cur, b));
  return pts;
}

// ------------------------------------------------------------------------------------

/** The bathroom's state: who is in each stall (and when its door moved) and who waits outside. */
function freshBath() {
  const stalls = BATHROOM.stalls.map(() => null);
  return { stalls, doorAt: BATHROOM.stalls.map(() => -Infinity), line: [], get occupant() { return stalls.find(Boolean) || null; } };
}

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
  const ghosts = new Map(); // subId → the newcomer doing that subagent's work (a translucent extra employee)
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
  let fatigue = null; // { left } while the agent's context is running out (less than 25 % free)
  const memory = { task: '', lastError: null, lastGreen: null, fails: [], work: {}, doing: {} }; // what the office talks about and how the work is going
  // Office life
  let bath = freshBath();
  let elevator = { doorAt: -Infinity, floor: 12 }; // the doors open when someone arrives or leaves
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
  // without real weather, it is simulated in the office's city (by default, the time zone's)
  let city = null;
  const simPlace = () => {
    if (Number.isFinite(city?.lat)) return { lat: city.lat, lon: city.lon, place: city.name };
    const z = zoneInfo(tz || systemZone());
    return { lat: z.lat, lon: z.lon, place: z.city };
  };
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
    a.queue = a.queue.filter((j) => j.bath && bath.stalls.includes(a.id));
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
    a.taskAt = simNow; // their screen stays on while the task lasts
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
    const ghost = ev.subId ? ghosts.get(ev.subId) : null; // a subagent's events are its newcomer's
    const a = ghost || agents[ev.role] || specialist(ev); // DevOps and security have no desk: they come up
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
        if (ev.text) memory.doing[a.id] = { text: ev.text, at: now };
        if (/^(askuserquestion|question|ask_user_choice|ask_user_question|ask_user)$/i.test(ev.tool || '') && a.id !== 'po') {
          // the agent asks you something: you both leave what you were doing and whoever asks goes to
          // your desk (the PO's) with the question
          const po = agents.po;
          banner = { text: `❓ ${ev.text}`, tone: 'chat', until: now + 12_000 };
          interrupt(a); summon(po);
          if (!po.hidden && !a.hidden) visit(a, 'po', T('sim.askYou', { name: po.cfg.name }), { stay: 3000 });
          else a.say(T('sim.askYou', { name: po.cfg.name }), 4000);
          break;
        }
        work(a, ev.text, ev.phase === 'red' ? 'red' : 'working', ev.phase === 'red' ? 10_000 : 6000);
        emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 3, 'code', a.cfg.shirt);
        if (DEVS.includes(ev.role)) lastDev = ev.role;
        break;
      case 'tool_end':
        if (!a) break;
        if (!ev.ok && ev.phase !== 'red') memory.lastError = { role: a.id, at: now, text: memory.doing[a.id]?.text || '' };
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
          if (ev.role !== 'tl' || a.ghost) visit(agents.tl, a.ghost ? a.cfg.seat : ev.role, T('sim.helpError'), { stay: 2200 });
          else agents.tl.say(T('sim.reviewThis'), 4000);
        }
        break;
      case 'subagent_start': {
        if (!a && !VISITORS[ev.role]) break;
        const g = ghost || hire(ev);
        if (g) {
          // a newcomer: Marco brings them the card, and their role's character says hello
          g.badges.set(ev.subId, ev.text);
          note('newcomer', ev.role, { name: g.cfg.name, text: ev.text });
          const main = agents[ev.role];
          if (main?.free) later(R(900, 1800), () => main.say(T('sim.newcomer.welcome', { name: g.cfg.name, g: g.cfg.sex }), 2600));
          const busy = () => work(g, T('sim.subtask', { text: ev.text }), 'working', 7000);
          if (ev.role !== 'manager') visit(agents.manager, g.cfg.seat, T('sim.assignSub', { name: g.cfg.name, text: ev.text }), { carry: true, after: busy });
          else busy();
          break;
        }
        a.badges.set(ev.subId, ev.text);
        const m = agents.manager;
        const line = T('sim.assignSub', { name: a.cfg.name, text: ev.text });
        if (ev.role !== 'manager') visit(m, ev.role, line, { carry: true, after: () => work(a, T('sim.subtask', { text: ev.text }), 'working', 7000) });
        else work(a, T('sim.subtask', { text: ev.text }));
        break;
      }
      case 'subagent_end':
        if (!a) break;
        if (a.ghost) { note('farewell', ev.role, { name: a.cfg.name }); farewell(a); emit(a.x, a.y - 60, 1, 'check'); break; }
        a.badges.delete(ev.subId);
        a.setState('done', 2500);
        a.say(T('sim.subDone', { text: ev.text }));
        // small note for a finished subtask: the big celebration is saved for 'done' (merge)
        emit(a.x, a.y - 60, 1, 'check');
        break;
      case 'waiting': {
        // the agent needs your OK: you both leave what you were doing and Marco goes to your desk
        // (the PO's) to ask for it, hand up. Another wait while this one is open does not send him again.
        const m = agents.manager, po = agents.po;
        if (!m.handUp) {
          interrupt(m); summon(po);
          if (!po.hidden && !m.hidden) visit(m, 'po', T('sim.askOk', { name: po.cfg.name }), { stay: 3000 });
          else m.say(T('sim.needOk'), 8000, 'warn');
        }
        m.handUp = true;
        m.setState('waiting', 60_000);
        banner = { text: `⚠  ${ev.text}`, tone: 'warn', until: now + 60_000 };
        break;
      }
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
        for (const g of ghosts.values()) farewell(g); // the task is over: the newcomers go home
        break;
      case 'session_end':
        agents.manager.say(T('sim.sessionEnd'));
        for (const g of ghosts.values()) farewell(g);
        break;
      case 'chat': {
        banner = { text: `💬 ${ev.from}: ${ev.text}`, tone: 'chat', until: now + 7000 };
        const who = a && a.id !== 'po' ? a : agents.manager; // you are the PO: the team answers you
        who.say(P(L('sim.chatReplies')), 3500);
        break;
      }
      // btw: a side question to the agent on duty. You (the PO) ask it out loud; whoever holds the
      // turn (or the TL) stays thinking and then answers; the full answer stays in the log.
      case 'btw': {
        const who = a && a.id !== 'po' ? a : agents.tl;
        if (ev.phase === 'ask') {
          banner = { text: `❓ btw · ${ev.from}: ${short(ev.text, 90)}`, tone: 'chat', until: now + 8000 };
          if (!agents.po.hidden) agents.po.say(`❓ ${short(ev.text, 60)}`, 4500);
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
      // The daily standup (server/standup.js): the team gathers at the meeting table, the manager opens
      // it, each one tells what their agent did (the real log), and the manager closes with what is
      // waiting for you and what is still open.
      case 'standup': {
        const lines = (ev.lines || []).filter((l) => (agents[l.role] && !agents[l.role].hidden && !agents[l.role].lunch) || VISITORS[l.role]);
        const members = ['manager', ...new Set(lines.map((l) => l.role).filter((r) => r !== 'manager' && agents[r]))];
        for (const id of members) interrupt(agents[id]);
        // the visiting specialists are not at the table: the manager tells what they did
        const say = [['manager', T('sim.standup.open')], ...lines.map((l) => (agents[l.role] ? [l.role, l.text] : ['manager', T('sim.standup.visitor', { name: VISITORS[l.role].name, role: VISITORS[l.role].title, text: l.text })]))];
        say.push(['manager', ev.waiting?.length ? T('sim.standup.waiting', { n: ev.waiting.length, what: short(ev.waiting[0], 50) }) : ev.open?.length ? T('sim.standup.open2', { n: ev.open.length }) : T('sim.standup.close')]);
        banner = { text: `🗣 ${ev.text}`, tone: 'chat', until: now + 8000 };
        scene('standup', members, say, { spot: SPOT.table, gap: 3600 });
        break;
      }
      // The analyst reviews your brief before it goes to work (server/clarify.js): she thinks it over
      // and, if something only you know is missing, she brings you her questions and waits at your
      // desk, hand up, until you answer.
      case 'clarify': {
        const an = agents.analyst, po = agents.po;
        if (ev.phase === 'review') {
          an.setState('thinking', 180_000);
          an.say(P(L('sim.clarify.review')), 3500);
        } else if (ev.phase === 'ask') {
          const line = T('sim.clarify.ask', { n: ev.n || 1 });
          banner = { text: `❓ ${an.cfg.name}: ${line}`, tone: 'chat', until: now + 12_000 };
          an.setState('waiting', 3_600_000);
          an.handUp = true;
          if (!an.hidden && !po.hidden && an.queue.length < 3) {
            an.carry = true;
            an.goTo({ x: po.cfg.seat.x + 62, y: po.cfg.seat.y - 6 }).then((x) => { x.carry = false; x.say(line, 6000); }).waitFor(() => !an.handUp).goHome();
          } else an.say(line, 6000);
        } else {
          an.handUp = false;
          an.setState(ev.phase === 'sent' ? 'done' : 'idle', 2500);
          if (ev.phase === 'sent') an.say(P(L('sim.clarify.sent')), 3000);
          else if (ev.phase === 'cancelled') an.say(T('sim.clarify.cancelled'), 2500);
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
        if (a?.ghost) { const ph = phaseInfo(ev.phase); work(a, `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`); } // a newcomer's phase is its own
        else if (a) phase(a, ev, now);
        break;
      case 'phase_end':
        turn = turnPhase = null;
        if (a) a.say(ev.text || T('sim.turnEnd'), 2500);
        break;
      case 'turn_end':
        // end of turn, without celebration: the same calm as closing a phase.
        turn = turnPhase = null;
        // the agent's turn is over: so are its subagents (even one whose end never arrived)
        if (!ev.subId) for (const g of ghosts.values()) if (!ev.session || g.session === ev.session) farewell(g);
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
        if (ev.role !== 'manager') visit(agents.manager, a.ghost ? a.cfg.seat : ev.role, T('sim.paneAssign', { name: a.cfg.name, pane: ev.pane, title: short(ev.text, 30) }), { carry: true, after: busy });
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
    if (!['waiting', 'chat', 'poke', 'clarify'].includes(ev.kind) && !(ev.kind === 'pane_state' && ev.state === 'blocked')) {
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

  /** The agent needs you (the PO): you leave what you were doing, unless you are in the bathroom,
   *  and go back to your desk. */
  function summon(po) {
    interrupt(po);
    if (po.hidden || bath.stalls.includes(po.id)) return;
    clearQueue(po);
    if (!po.seated) po.goHome();
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
        const pt = { x: Math.max(LEFT + 30, Math.min(W - 30, spot.x + off)), y: spot.y + (i % 2 ? 6 : 0) };
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

  const lower = (s) => String(s || '').replace(/^./, (c) => c.toLocaleLowerCase());
  const nameOf = (id) => TEAM[id]?.name || [...ghosts.values()].find((g) => g.id === id)?.cfg.name || '';
  /** Is the office busy with real work? (something happened in the last minutes) */
  const onTask = (a) => simNow - (a.taskAt ?? -Infinity) < 150_000;
  const lively = () => Object.values(memory.doing).some((d) => simNow - d.at < 180_000) || (board.todos.length > 0 && board.todos.some((x) => x.status !== 'completed'));

  /** What is going on right now, said by `id`: the board, who is doing what, who got stuck, the
   *  newcomers, whether you (the PO) are being waited for. The chit-chat comes from here. */
  function liveTopics(id) {
    const out = [];
    const todos = board.todos;
    if (todos.length) out.push(T('sim.live.board', { done: todos.filter((x) => x.status === 'completed').length, total: todos.length }));
    for (const [role, d] of Object.entries(memory.doing)) {
      if (role === id || simNow - d.at > 90_000 || !nameOf(role)) continue;
      out.push(T('sim.live.doing', { name: nameOf(role), action: lower(short(d.text, 40)) }));
    }
    const e = memory.lastError;
    if (e && simNow - e.at < 120_000 && e.text && nameOf(e.role)) out.push(T('sim.live.stuck', { name: nameOf(e.role), action: lower(short(e.text, 36)) }));
    if (memory.lastGreen && simNow - memory.lastGreen.at < 120_000) out.push(T('sim.gossipGreen', { name: TEAM.qa.name }));
    if (agents.manager.handUp) out.push(T('sim.live.waitingYou'));
    for (const g of ghosts.values()) if (!g.leaving) out.push(T(g.specialist ? 'sim.live.visitor' : 'sim.live.newcomer', { name: g.cfg.name, role: personOf(g.role)?.title || g.role }));
    return out;
  }

  /** What is said in the chit-chat: what is going on (when there is work), or office gossip. */
  function gossipLine(id) {
    const live = liveTopics(id);
    if (memory.task) live.push(T('sim.gossipTask', { task: short(memory.task, 22) }));
    if (lively() && live.length && chance(0.85)) return { text: P(live), live: true };
    const topics = [...(PRODUCT.includes(id) ? L(`sim.gossip.${id}`) : L('sim.replies')), ...live];
    if (memory.lastError && simNow - memory.lastError.at < 120_000 && nameOf(memory.lastError.role)) topics.push(T('sim.gossipError', { name: nameOf(memory.lastError.role) }));
    if (journal.some((j) => j.kind === 'repaired' && simNow - j.t < 10 * 60_000)) topics.push(T('sim.gossipFire'));
    const text = P(topics);
    return { text, live: live.includes(text) };
  }
  // ---------------------------------------------------------------- the newcomers (subagents)

  /** A free hot desk (or a seat at the meeting table, when they are all taken). */
  function seatFor(self = null) {
    const here = [...ghosts.values()].filter((g) => !g.leaving && g !== self);
    const taken = new Set(here.map((g) => g.desk));
    const desk = HOT_DESKS.findIndex((_, i) => !taken.has(i));
    const [dx, dy] = TABLE_SEATS[here.filter((g) => g.desk < 0).length % TABLE_SEATS.length];
    return { desk, seat: desk >= 0 ? HOT_DESKS[desk] : { x: SPOT.table.x + dx, y: SPOT.table.y + dy } };
  }

  /**
   * A subagent starts: a newcomer of its role comes in by the elevator to a hot desk. The visiting
   * specialists (DevOps, security) come the same way, under `key` when it is their main session's
   * work; the first one of their role is the specialist in person (solid, always the same), the rest
   * are newcomers of that role.
   */
  function hire(ev, key = ev.subId) {
    const look = personOf(ev.role);
    if (!look || !key) return null;
    const { desk, seat } = seatFor();
    const present = [...ghosts.values()].filter((g) => !g.gone);
    const used = new Set(present.map((g) => g.cfg.name));
    const specialist = !!VISITORS[ev.role] && !used.has(look.name);
    const name = specialist ? look.name : P(NEWCOMER_NAMES.filter((n) => !used.has(n))) || `${look.name} 2`;
    const cfg = specialist ? { ...look, title: look.title, name, seat }
      : { ...look, title: look.title, name, seat, prop: 'laptop', hair: P(LOOK_PALETTES.hair), skin: P(LOOK_PALETTES.skin), long: chance(0.5), beard: chance(0.25), glasses: chance(0.3) };
    const g = new Agent(`new:${key}`, cfg, now_, random);
    Object.assign(g, { ghost: true, specialist, role: ev.role, subId: ev.subId || null, session: ev.session || null, project: ev.project || '', desk, x: ELEVATOR.spot.x, y: ELEVATOR.spot.y, seated: false, born: simNow, fade: 0, leaving: false, gone: false });
    elevator.doorAt = simNow; // it arrives by the elevator
    g.goHome();
    ghosts.set(key, g);
    return g;
  }

  // What brings a visiting specialist up (the rest of their events find them already here, or not).
  const CALLS = new Set(['tool_start', 'thinking', 'phase', 'pane_open', 'pane_state']);
  /**
   * The visiting specialist doing this work of their main session (a subagent's comes with its
   * subagent_start): already here, on their way out (they come back) or called now by the elevator.
   */
  function specialist(ev) {
    if (!VISITORS[ev.role] || ev.subId) return null;
    const key = `visit:${ev.session || ''}:${ev.role}`;
    const g = ghosts.get(key);
    if (g && !g.leaving) return g;
    if (!CALLS.has(ev.kind)) return null;
    if (g) {
      // they were leaving: they come back to a free desk
      const { desk, seat } = seatFor(g);
      g.desk = desk; g.cfg.seat = seat;
      Object.assign(g, { leaving: false, gone: false, queue: [] });
      if (g.fade <= 0) Object.assign(g, { x: ELEVATOR.spot.x, y: ELEVATOR.spot.y, seated: false });
      g.goHome();
      return g;
    }
    const v = hire(ev, key);
    note('visitor', ev.role, { name: v.cfg.name, text: ev.text });
    agents.manager.say(T('sim.visitor.arrive', { name: v.cfg.name, role: v.cfg.title, icon: VISITORS[ev.role].icon }), 2600);
    log(v, T(`sim.visitor.hello.${ev.role}`));
    return v;
  }

  /** Its subtask is done: says goodbye, walks to the elevator and fades away (its desk goes with it). */
  function farewell(g) {
    if (!g || g.leaving) return;
    g.leaving = true;
    g.badges.clear();
    g.queue = [];
    g.setState('done', 2500);
    g.jumpUntil = simNow + 700;
    g.say(T('sim.newcomer.bye'), 2600);
    g.wait(1600).goTo(ELEVATOR.spot).then((x) => { elevator.doorAt = simNow; x.gone = true; });
  }

  /** The answer to a line: about the work if the line was about the work. */
  const replyTo = (line) => P(L(line.live ? 'sim.live.replies' : 'sim.replies'));

  function gossip(a) {
    // product chit-chats among themselves; a chatty technical person, with whoever is free
    const pool = PRODUCT.includes(a.id) ? PRODUCT : [...TECH, 'tl', 'manager', 'analyst', 'designer'];
    const others = pool.filter((id) => id !== a.id && agents[id].free && agents[id].state !== 'working');
    if (!others.length) return false;
    // sometimes the two of them go to whisper at the bathroom's mirror
    if (chance(0.2) && !bath.line.length) return bathGossip(a, P(others));
    const members = [a.id, ...others.slice(0, chance(0.5) ? 2 : 1)];
    const first = gossipLine(a.id);
    const lines = [[a.id, first.text], [members[1], replyTo(first)]];
    if (members[2]) lines.push([members[2], replyTo(first)]);
    if (chance(0.5)) { const more = gossipLine(a.id); lines.push([a.id, more.live || chance(0.5) ? more.text : replyTo(first)]); }
    // sitting together they chit-chat from the desk; sometimes they meet at the café or the sofa
    const spot = chance(0.55) ? null : P([{ x: COUNTER_SPOTS[0].x, y: COUNTER_SPOTS[0].y + 4 }, SPOT.sofa, { x: 210, y: CORRIDOR_TOP + 4 }]);
    // and sometimes an idea comes out of the chat and they take it to the manager (not you, the PO:
    // what goes to the backlog is your call)
    const pitcher = chance(0.2) && agents.manager.free ? members.map((id) => agents[id]).find((x) => x.id !== 'po') : null;
    scene(spot ? 'gossip' : 'deskchat', members, lines, {
      spot,
      after: () => { if (pitcher) pitchIdea(pitcher); emit(agents[members[0]].x, agents[members[0]].y - 70, 3, 'emote', null, P(['😂', '💬', '✨', '💜'])); },
    });
    for (const id of members) { agents[id].mind.social = -R(0, 0.4); agents[id].setState('talking', 4000); }
    return true;
  }

  /** Two of product go to the bathroom together and whisper at the mirror. */
  function bathGossip(a, other) {
    const first = bathLine();
    const lines = [[a.id, first.text], [other, replyTo(first)], [a.id, bathLine().text]];
    if (chance(0.6)) lines.push([other, P(L('sim.bathGossipEnd'))]);
    scene('bathgossip', [a.id, other], lines, { spot: { x: BATHROOM.sink.x, y: BATHROOM.sink.y + 2 }, gap: 2200,
      after: () => emit(BATHROOM.sink.x, BATHROOM.sink.y - 70, 2, 'emote', null, P(['🤫', '😏', '💅', '👀'])) });
    for (const id of [a.id, other]) { agents[id].mind.social = -R(0, 0.4); agents[id].setState('talking', 4000); }
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

  function imagine(a, { kind = P(traitsOf(a.id).dreams), line, cause } = {}) {
    if (!kind) return false;
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
    const now = memory.doing[a.id];
    const doing = now && simNow - now.at < 120_000 ? t('sim.doing', { text: short(now.text, 34) }) : chance(0.5) ? t('sim.doing', { text: short(a.text, 26) }) : '';
    const sc = scene('consult', [a.id], [[a.id, T('sim.consultAsk', { doing, ask: P(L(`sim.ask.${a.id}`)) })]], { spot: { x: tl.cfg.seat.x + 62, y: tl.cfg.seat.y - 6 } });
    const at = sc.lines[0].at;
    join(sc, 'tl', [[P(L('sim.answers')), at + 2300]], at + 5300);
    sc.lines.push({ who: a.id, text: P(L('sim.thanks')), at: at + 4600 });
    a.mind.doubt = -R(0, 0.5);
    return true;
  }

  /** The architect goes to talk with someone from product (data, designs). Not with you, the PO:
   *  the agent asks you for real (AskUserQuestion), it is not made up. */
  function archChat(tl, { target: want, asks = 'sim.tlAsks' } = {}) {
    if (!tl.free) return false;
    const who = PRODUCT.filter((id) => id !== 'po' && agents[id].free);
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
    const doing = memory.doing[who.id];
    const ask = doing && simNow - doing.at < 120_000 ? T('sim.live.rounds', { name: who.cfg.name, action: lower(short(doing.text, 36)) }) : P(ta('sim.rounds', { name: who.cfg.name }));
    const sc = scene('rounds', ['manager'], [['manager', ask]],
      { spot: { x: who.cfg.seat.x + 62, y: who.cfg.seat.y - 6 } });
    const at = sc.lines[0].at + 2200;
    join(sc, who.id, [[P(ta('sim.roundsReplies', { ...teamNames(), g: who.cfg.sex })), at]], at + 800);
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

  /**
   * A break in the middle of a task: they go to the café with what they are doing in their head,
   * tell someone about it (or think out loud, if nobody comes) and walk back "thinking" how to
   * solve it; at the desk the idea clicks. Real work calls them back at any moment (LEISURE).
   */
  function workCoffee(a) {
    if (a.ghost || !a.free || scenes.filter((x) => x.kind === 'workcoffee').length >= 2) return false;
    const d = memory.doing[a.id];
    const what = d && simNow - d.at < 150_000 ? d.text : a.text || memory.task;
    if (!what) return false;
    const vars = { action: lower(short(what, 40)), task: short(memory.task || what, 28), g: a.cfg.sex };
    const line = (key, who = a) => P(ta(key, { ...teamNames(), ...vars, name: a.cfg.name, g: who.cfg.sex }));
    // who comes along: someone free who is not in the middle of something (the chatty ones, more)
    const free = Object.values(agents).filter((o) => o !== a && o.free && o.state !== 'working' && !o.hidden && (traitsOf(o.id).chats || chance(0.5)));
    const mate = chance(0.8) ? P(free) : null;
    const counter = COUNTER_SPOTS[1];
    const spot = { x: counter.x + (mate ? 0 : R(-16, 16)), y: counter.y + 6 };
    const lines = mate
      ? [[a.id, line('sim.workCoffee.open')], [mate.id, line(mate.id === 'tl' ? 'sim.workCoffee.tlReply' : 'sim.workCoffee.reply', mate)], [a.id, line('sim.workCoffee.more')], [mate.id, line('sim.workCoffee.advice', mate)]]
      : [[a.id, line('sim.workCoffee.alone')], [a.id, line('sim.workCoffee.aloneMore')]];
    scene('workcoffee', mate ? [a.id, mate.id] : [a.id], lines, {
      spot, gap: 2600, quiet: true,
      after: () => {
        // on the way back: thinking how to solve it (and at the desk it clicks)
        a.setState('thinking', 16_000);
        a.say(line('sim.workCoffee.back'), 4200);
        emit(a.x, a.y - 80, 1, 'emote', null, P(['💭', '🤔', '💡']));
        a.then((x) => { if (x.state === 'thinking') { x.say(line('sim.workCoffee.eureka'), 3000); x.taskAt = simNow; } });
      },
    });
    note('workcoffee', a.id, { with: mate ? [mate.id] : [], text: what });
    a.state = 'coffee'; a.stateUntil = simNow + 12_000;
    a.mind.brk = -R(0, 0.3);
    a.mind.coffee = -R(0, 0.3);
    a.mind.social = Math.min(a.mind.social, 0);
    a.mind.bladder += 0.15;
    if (mate) { mate.setState('talking', 9000); mate.mind.social = -R(0, 0.3); mate.mind.coffee = Math.min(mate.mind.coffee, 0); }
    return true;
  }

  /** A spot at the bathroom's sink (two fit in front of the mirror). */
  const sinkSpot = (i = 0) => ({ x: BATHROOM.sink.x + (i ? 16 : -16), y: BATHROOM.sink.y + (i ? 4 : 0) });

  /**
   * To the bathroom: they walk in, take a free stall and close its door; then they wash their hands
   * at the mirror (where, if someone else is there, they whisper) and go back. With both stalls
   * taken, they wait in the hallway (restless).
   */
  function bathroom(a, urgent = false) {
    if (bath.line.includes(a.id) || bath.stalls.includes(a.id) || a.hidden) return false;
    bath.line.push(a.id);
    const place = bath.line.length - 1;
    note('bathroom', a.id);
    if (urgent) a.say(P(L('sim.bathUrgent')), 2400);
    a.mind.bladder = -R(0, 0.3);
    const free = () => bath.stalls.findIndex((x) => x === null);
    a.goTo({ x: BATH_LINE.x, y: BATH_LINE.y + place * 26 })
      .then((x) => { if (free() < 0 || bath.line[0] !== x.id) { x.dance = true; if (chance(0.6)) x.say(P(L('sim.bathWait')), 2600); } })
      .waitFor(() => free() >= 0 && bath.line[0] === a.id)
      .then((x) => {
        x.dance = false;
        const i = free();
        bath.stalls[i] = x.id;
        bath.line.shift();
        // the rest is decided now (which stall), and goes first in their queue
        const door = { x: BATHROOM.stalls[i].x, y: 142 }, sink = sinkSpot(i);
        const jobs = [
          { t: 'walk', path: route({ x: x.x, y: x.y }, door), end: door },
          { t: 'fn', fn: (y) => { y.hidden = true; y.bubble = null; bath.doorAt[i] = simNow; } },
          { t: 'wait', ms: R(4000, 9000) },
          { t: 'fn', fn: (y) => { y.hidden = false; bath.doorAt[i] = simNow; bath.stalls[i] = null; } },
          { t: 'walk', path: [sink], end: sink },
          { t: 'fn', fn: (y) => { y.face = -1; y.say(P(L('sim.bathDone')), 2400); emit(sink.x, sink.y - 40, 2, 'emote', null, P(['💧', '🧼', '🫧'])); whisperAtSink(y); } },
          { t: 'wait', ms: 1800 },
        ];
        for (const j of jobs) j.bath = true;
        x.queue.unshift(...jobs);
      })
      .then((x) => { if (!x.queue.length) x.goHome(); });
    return true;
  }

  /** At the mirror, if someone else is washing their hands too: a whisper and its answer. */
  function whisperAtSink(a) {
    const other = Object.values(agents).find((b) => b !== a && !b.hidden && !b.scene && Math.hypot(b.x - BATHROOM.sink.x, b.y - BATHROOM.sink.y) < 30);
    if (!other || !chance(0.7)) return;
    const first = bathLine();
    scene('bathgossip', [a.id, other.id], [[a.id, first.text], [other.id, replyTo(first)]], { gap: 1400 });
  }
  /** What is whispered at the bathroom's mirror: office gossip or, with work going on, about it. */
  function bathLine() {
    const live = liveTopics(null);
    if (lively() && live.length && chance(0.5)) return { text: `🤫 ${P(live)}`, live: true };
    return { text: P(L('sim.bathGossip')), live: false };
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
        const live = lively() && chance(0.6) ? gossipLine(a.id) : { text: P(pool), live: false };
        scene('lunchtalk', [a.id, b.id], [[a.id, live.text], [b.id, replyTo(live)]], { quiet: true });
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
  const STRESS_MS = 5 * 60_000;
  const STRESSED = 3;
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
          later(R(9000, 14_000), () => { if (chance(0.7)) archChat(agents.tl, { target: 'analyst', asks: 'sim.tlScope' }); });
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
      // errors in a row stress whoever made them (three within five minutes)
      if (a) {
        const n = (a.stress && simNow - a.stress.at < STRESS_MS ? a.stress.n : 0) + 1;
        a.stress = { n, at: simNow };
        if (n === STRESSED && !a.hidden && !a.lunch) { a.say(P(L('sim.stressed')), 3200); emit(a.x, a.y - 70, 1, 'emote', null, '😰'); }
      }
      // failing tests keep QA up at night
      if (isTest) later(R(1200, 3200), () => { if (chance(0.85)) imagine(agents.qa, { kind: 'skull', line: P(L('sim.nightmares')), cause: t('sim.cause.testsFailed') }); });
      // whoever failed is left with doubts: soon they go consult the TL
      if (a && traitsOf(a.id).doubt) a.mind.doubt = Math.max(a.mind.doubt, 0.95);
      // errors overheat the server; if they pile up, it catches fire
      heat = Math.min(1.3, heat + (a?.id === 'backend' || ev.kind === 'error' ? 0.3 : 0.12));
      if (memory.fails.length >= 3 && heat >= 0.9 && !fire && !lunch && simNow - lastFireAt > 4 * 60_000 && chance(0.5)) {
        later(R(1500, 4000), () => { if (!fire && !lunch) ignite(t('sim.cause.tooManyErrors')); });
      }
    } else if (ev.ok && isTest) {
      calm();
    }
    if (ev.ok && a?.stress) a.stress = null; // it worked: the stress goes away
  }

  /** The agent's context (the share still free, 0–1; null: unknown): running out tires the team on it. */
  function setContext(left) {
    const low = Number.isFinite(left) && left < 0.25;
    const m = agents.manager;
    if (low && !fatigue) {
      fatigue = { left };
      if (!m.hidden && !m.lunch) m.say(T('sim.tired', { pct: Math.round(left * 100) }), 4200);
    } else if (!low && fatigue) {
      fatigue = null;
      // it was compacted (or a new session): rested again
      if (Number.isFinite(left) && !m.hidden && !m.lunch) { m.say(P(L('sim.rested')), 3600); emit(m.x, m.y - 70, 4, 'sparkle'); }
    } else if (low) fatigue.left = left;
  }
  /** Who the low context tires: the manager (who runs the agent) and whoever is working on it. */
  const tiredOnes = () => (fatigue ? Object.values(agents).filter((a) => a.id === 'manager' || a.id === turn || ['working', 'thinking'].includes(a.state)) : []);

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
    bath.stalls.forEach((id, i) => { if (id && random() < dt * 0.2) emit(BATHROOM.stalls[i].x + R(-6, 6), 84, 1, 'emote', null, P(['🎵', '🎶', '🧻'])); });
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
    const mind = a.mind, pers = traitsOf(a.id);
    // needs grow over time
    if (a.free && a.state !== 'working') mind.social += dt / pers.social;
    mind.coffee += (dt / pers.coffee) * (a.state === 'working' ? 1.6 : 1); // working tires them faster
    if (!a.hidden) mind.bladder += dt / pers.bladder;
    if (pers.doubt && a.seated && ['working', 'thinking'].includes(a.state)) mind.doubt += dt / pers.doubt;
    if (pers.dream) mind.dream += (dt / pers.dream) * dreamBoost(a);
    if (pers.rounds && a.free) mind.rounds += dt / pers.rounds;
    if (pers.product && a.free) mind.product += dt / pers.product;
    // with a task going on, they want a break: to the café to talk about it (and back thinking)
    if (onTask(a) && a.seated && a.state !== 'working') mind.brk += dt / pers.breaks;

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
    if (mind.brk >= 1 && onTask(a) && !lunch && chance(0.6)) { if (workCoffee(a)) return; mind.brk = 0.7; }
    if (pers.chats && mind.social >= 1) { if (gossip(a)) return; mind.social = 0.6; }
    if (pers.product && mind.product >= 1 && !['working', 'thinking', 'red'].includes(a.state) && chance(0.5)) { if (archChat(a)) return; mind.product = 0.7; }
    if (pers.rounds && mind.rounds >= 1 && a.state === 'idle') { if (rounds(a)) return; mind.rounds = 0.5; }
    // the technical people, with nothing to do, sometimes sit down to watch TV (more with rain)
    if (pers.tv && mind.social >= 1 && a.state === 'idle' && !lunch) {
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
      // moods from real signals: stressed (errors in a row) sweat, tired (low context) yawn and want coffee
      if (a.stress && now - a.stress.at > STRESS_MS) a.stress = null;
      if (a.stress?.n >= STRESSED && !a.hidden && random() < dt * 0.15) emit(a.x + R(-6, 6), a.y - 72, 1, 'emote', null, '😰');
      if (a.tired && !a.hidden) {
        if (random() < dt * 0.07) emit(a.x + R(-6, 6), a.y - 72, 1, 'emote', null, '🥱');
        a.mind.coffee = Math.min(1.2, a.mind.coffee + dt * 0.003);
      }
    }
    const tired = new Set(tiredOnes().map((a) => a.id));
    for (const a of Object.values(agents)) a.tired = tired.has(a.id);
    for (const [id, g] of ghosts) {
      g.update(dt, now);
      if (g.seated && g.state === 'working' && random() < dt * 2.2) emit(g.cfg.seat.x + 20, g.cfg.seat.y - 40, 1, 'code', g.cfg.shirt);
      // they fade in when they arrive and out when they leave (or after 10 minutes without news)
      g.fade = g.gone ? Math.max(0, g.fade - dt * 1000 / FADE_MS) : Math.min(1, g.fade + dt * 1000 / FADE_MS);
      if (!g.leaving && now - g.lastActive > 10 * 60_000) farewell(g);
      if (g.gone && g.fade <= 0) ghosts.delete(id);
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
    /** The newcomers: one per running subagent (translucent, at the hot desks), while they last. */
    get ghosts() { return [...ghosts.values()]; },
    get scenes() { return scenes; },
    get fire() { return fire; },
    get lunch() { return lunch; },
    get bath() { return bath; },
    get elevator() { return elevator; },
    get extinguisher() { return extinguisher; },
    get heat() { return heat; },
    /** The weather outside: the real one if it came from the server, otherwise one simulated by season. */
    get weather() { return currentWeather(); },
    /** The office's date and time, in its time zone (a ZonedDate). */
    date: () => wallDate(),
    get zone() { return tz; },
    setZone(z) { tz = validZone(z) ? z : null; },
    /** The office's city ({ name, lat, lon }; null: the time zone's). */
    setPlace(p) { city = p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null; },
    setWeather(w) { weather = w && WEATHER[w.kind] ? w : null; },
    watchTV: (id, opts) => watchTV(agents[id], opts),
    setContext,
    /** The agent's context is running out: { left } (null: fine or unknown). */
    get fatigue() { return fatigue; },
    setBoard(session) {
      if (session && 'turn' in session) { turn = session.turn; turnPhase = session.phase; } // the server rules
      board = session ? { title: session.title, todos: session.todos || [], status: session.status, source: session.source } : { title: '', todos: [] };
      if (board.title) memory.task = board.title;
    },
    reset() {
      for (const a of Object.values(agents)) {
        Object.assign(a, { stress: null, tired: false, taskAt: -Infinity, queue: [], seated: true, x: a.cfg.seat.x, y: a.cfg.seat.y, state: 'idle', bubble: null, handUp: false, history: [], dream: null, scene: null, carry: false, perch: false, hidden: false, dance: false, food: null, lunch: null, back: false, tvSeat: null, diningSeat: null });
        a.badges.clear();
      }
      ghosts.clear();
      banner = null; particles = []; board = { title: '', todos: [] }; turn = turnPhase = lastDev = lastBlocked = null;
      scenes = []; timers = []; memory.task = ''; memory.lastError = memory.lastGreen = null; memory.fails = []; memory.work = {}; memory.doing = {};
      bath = freshBath();
      elevator = { doorAt: -Infinity, floor: 12 };
      // if it is lunchtime, they go out again on the next tick
      lunch = null; lunchDay = null; fire = null; extinguisher = 'floor'; heat = 0; timers = []; fatigue = null;
    },
  };
}
