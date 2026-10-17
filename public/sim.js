// Simulación de la oficina, sin dibujo: personajes, rutas, reacciones a eventos y partículas.
// La usan el render en canvas (navegador, game.js) y el render de terminal (tui/).
// Todas las coordenadas están en un mundo de W×H.
//
// Además de reaccionar a lo que hace el agente, cada personaje tiene su propia "cabeza"
// (brain): necesidades que crecen con el tiempo (conversar, café, baño, consultar, soñar) y una
// personalidad que decide qué hace cuando nadie le pide nada. Las NPC de producto (PO, analista,
// diseñadora) se sientan juntas y cotorrean; la diseñadora sueña con unicornios y arcoíris, QA con
// calaveras y los devs con pizza; los técnicos a veces van a consultar al TL y el TL a veces va a
// conversar con producto; el manager reparte los requerimientos y hace rondas. La oficina también
// tiene su vida: a las 13:00 el equipo se va a almorzar al comedor, hay un baño (de a uno, con
// fila) y a veces el servidor se incendia y el equipo técnico lo apaga y lo repara.
// Los textos (diálogos, bitácora) están en los idiomas del juego (i18n.js, locales/).
// Lo que pasa "a veces" siempre tiene un factor aleatorio: la necesidad se llena y además hay que
// ganar una tirada para que ocurra.

import { daylight, simulatedWeather, strikeStart, WEATHER, WET } from './sky.js';
import { t, ta, listOf, onLanguage } from './i18n.js';
import { zoned, zoneInfo, systemZone, validZone } from './clock.js';
export { daylight } from './sky.js';

export const W = 960, H = 600;

// Fila de arriba: el rincón de producto (diseñadora, PO y analista, juntas) y el manager.
// Fila de abajo: el equipo técnico, con el TL un poco aparte (se le va a consultar).
// El cargo (title) sale del idioma del juego, salvo que se personalice en ⚙ › Personajes.
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
export const PRODUCT = ['po', 'analyst', 'designer']; // NPC del negocio: conversan entre ellas y traen los requerimientos
export const TECH = ['backend', 'frontend', 'qa'];      // trabajan y a veces consultan al TL

// La pizarra, en un atril frente a la pared de vidrio (con el reloj digital encima): al hacerle
// clic se abre el diálogo para encargar una tarea.
export const BOARD = { x: 372, y: 34, w: 236, h: 98 };
export const EASEL = { top: 22, feet: 146, legs: [[362, 348], [618, 632]] }; // patas delanteras, a los costados: x arriba → x en el piso
export const ALARM = { x: 588, y: 6 }; // cuelga de la viga del techo, sobre el rack
export const SIGN = { x: 308, y: 62 }; // el letrero, en vinilo en la parte baja de un panel del vidrio (bajo el HUD)
export const CLOCK = { x: 446, y: 3, w: 88, h: 26 };
// La pared del fondo es de vidrio (de x 0 a GLASS.x1); el baño es un bloque sólido a la derecha.
export const GLASS = { x0: 0, x1: 704, top: 6, bottom: 108 };
export const onBoard = (x, y) => x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h;

// Apariencia personalizable (⚙ Ajustes › Personajes). TEAM se modifica en el sitio para que
// los dos renderers y la simulación vean el cambio al instante.
export const APPEARANCE_KEYS = ['name', 'title', 'shirt', 'pants', 'hair', 'skin', 'long', 'beard', 'glasses'];
export const DEFAULT_TEAM = Object.fromEntries(Object.entries(TEAM).map(([id, c]) => {
  const look = Object.fromEntries(APPEARANCE_KEYS.filter((k) => k !== 'title').map((k) => [k, c[k] ?? false]));
  Object.defineProperty(look, 'title', { get: () => t(`team.titles.${id}`), enumerable: true });
  return [id, look];
}));
// Paletas para elegir colores sin escribir hex (la terminal las recorre con ◂ ▸; la web también tiene selector libre).
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
onLanguage(() => applyAppearance(appearance)); // los cargos que no se personalizaron cambian de idioma
/** Los nombres actuales del equipo, para los diálogos ({tl}, {po}, {manager}…). */
export const teamNames = () => Object.fromEntries(Object.entries(TEAM).map(([id, c]) => [id, c.name]));

// ------------------------------------------------------------------------------------ el mapa

// La cafetería ocupa el lado derecho, arriba: barra contra la pared (con la máquina de espresso,
// el refrigerador y el letrero de neón) y una mesita alta. Una línea de jardineras la separa de la
// oficina, con pasos a la altura de los pasillos.
export const CAFE = {
  x: 772,                                   // donde empieza su piso
  counter: { x: 812, w: 144, top: 116 },    // la barra: cubierta desde `top`, frente hasta top + 32
  fridge: { x: 778, y: 54, w: 28, h: 94 },
  espresso: { x: 884, w: 42 },
  bistro: { x: 836, y: 262 },               // la mesita alta con dos pisos
};
// Bajo la cafetería, el comedor: un muro bajo con una puerta los separa, y una mesa larga donde
// almuerza todo el equipo. Producto y el manager se sientan detrás de la mesa (de frente); el
// equipo técnico delante, de espaldas. Se entra por la puerta del muro (los de atrás) o por abajo
// (los de adelante), para no atravesar la mesa.
export const DINING = {
  top: 330,                                 // el muro: de top a top + 14
  door: { x0: 900, x1: 948 },               // la puerta del muro (cafetería ↔ comedor)
  table: { x: 866, y: 452, w: 150 },        // y: el borde de atrás de la cubierta (donde se sientan los de atrás)
  aisle: { back: 410, front: 566, side: 788, door: 924 }, // por dónde se llega a cada fila
};
const DINE_X = [-54, -18, 18, 54].map((dx) => DINING.table.x + dx);
export const DINING_SEATS = {
  back: DINE_X.map((x) => ({ x, y: DINING.table.y, row: 'back' })),
  front: DINE_X.map((x) => ({ x, y: DINING.table.y + 48, row: 'front' })),
};
const COUNTER_SPOTS = [{ x: 836, y: 150 }, { x: 872, y: 150 }, { x: 908, y: 150 }];
export const PARTITION = [[190, 296], [340, 440], [484, 600]]; // jardineras en x = CAFE.x - 6, con pasos en los pasillos
// El baño: una puerta en la pared, entre el reloj y la cafetería. Se entra de a uno.
export const BATH = { x: 714, w: 52, door: { x: 740, y: 126 }, front: { x: 740, y: 150 }, line: { x: 694, y: 154 } };
// El rack de servidores (el que se incendia) y su extintor, en el piso a su izquierda.
export const RACK = { x: 572, y: 150, w: 42, h: 92 };
export const EXTINGUISHER = { x: 561, y: 242 };
const EXT_PICK = { x: 561, y: 272 };
const FIRE_SPOT = { backend: { x: 594, y: 276 }, tl: { x: 640, y: 286 }, frontend: { x: 546, y: 288 }, qa: { x: 684, y: 292 } };
const FIRE_ORDER = ['backend', 'tl', 'frontend', 'qa']; // quién toma el extintor si puede
// La sala de estar: una tele en un trípode y, delante, un sofá (se ve de espaldas: los que miran
// la tele dan la espalda). Se llega por el costado para no atravesar la tele.
export const TV = { x: 360, feet: 512, w: 72, h: 44 };
export const SOFA = { x: 360, y: 562, seats: [320, 360, 400], side: { x: 266, y: 532 } };

export const SPOT = {
  board: { x: 490, y: 148 },
  coffee: COUNTER_SPOTS[1],
  table: { x: 600, y: 515 },
  sofa: { x: 236, y: 520 }, // junto al sofá, para conversar de pie
};
export const PLANTS = [[20, 560], [700, 400], [944, 590]];
const TABLE_SEATS = [[-75, -40], [-25, -42], [25, -42], [75, -40], [-108, 0], [108, 0], [-100, 42], [100, 42]];
const CORRIDOR_TOP = 148, CORRIDOR_MID = 318, CORRIDOR_LOW = 462;
const LANES = [25, 445, 637]; // huecos entre escritorios por donde se cambia de pasillo
const DEVS = ['backend', 'frontend', 'designer'];
const SPEED = 120; // px del mundo por segundo al caminar
export const LUNCH = { start: 13 * 60, end: 14 * 60 }; // minutos del día
/** Qué da la tele: última hora si se incendia el servidor; si alguien la mira, también fútbol. */
export function tvChannel(sim, now) {
  if (sim.fire && sim.fire.phase !== 'done') return 'breaking';
  const watched = Object.values(sim.agents).some((a) => a.back);
  const list = watched ? ['sports', 'weather', 'news', 'sports'] : ['weather', 'news'];
  return list[Math.floor(now / 9000) % list.length];
}

export const STATUS_ICON = { working: '💻', thinking: '💭', blocked: '❗', waiting: '✋', done: '🎉', coffee: '☕', talking: '💬', red: '🔴', alarm: '🚨' };

// ------------------------------------------------------------------------------------ sueños

// Lo que imaginan: pixel art que dibujan los dos renderers (cada carácter es un pixel; '.' es
// transparente). El arcoíris se calcula (rainbowPixels).
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
/** Cada sueño: su sprite (o null si se calcula), el color de la nube y el del resplandor. */
export const DREAMS = {
  unicorn: { sprite: UNICORN, cloud: '#cfe2ff', glow: '#ff7eb6', emoji: '🦄' },
  rainbow: { sprite: null, cloud: '#ffffff', glow: '#ffd166', emoji: '🌈' },
  skull: { sprite: SKULL, cloud: '#3a3550', glow: '#a06cff', emoji: '💀' },
  pizza: { sprite: PIZZA, cloud: '#fff3d6', glow: '#ff9f1c', emoji: '🍕' },
};
for (const [kind, d] of Object.entries(DREAMS)) Object.defineProperty(d, 'label', { get: () => t(`dream.${kind}`), enumerable: true });
// Quién sueña con qué.
export const DREAMERS = { designer: ['unicorn', 'rainbow'], qa: ['skull'], backend: ['pizza'], frontend: ['pizza'] };

/** Pixeles de un arcoíris de radio r (bandas de RAINBOW_COLORS hacia adentro): [[dx, dy, color]]. */
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

// Fases del flujo por roles (evento `phase`). `anim` decide qué hace el personaje.
// El nombre de cada fase está en los idiomas (i18n: phase.<id>).
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
// Personalidad: cuánto le cuesta quedarse solo, cuánto café toma, de qué habla.

// Segundos que tarda cada necesidad en llenarse (y que el personaje quiera hacer algo al respecto).
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
/** Necesidades de 0 a 1 (al llegar a 1, quiere actuar). Arrancan desparejas para que no actúen todos a la vez. */
function freshMind(random) {
  const r = () => random() * 0.6;
  return { social: r(), coffee: r(), doubt: r(), dream: r() + 0.2, rounds: r(), bladder: r(), product: r(), nextThink: 0 };
}
/** Las necesidades que se ven en la ficha del personaje (0 = satisfecha, 1 = urgente). */
export const NEEDS = ['social', 'coffee', 'bladder', 'dream', 'doubt'];
export const needsOf = (id) => NEEDS.filter((k) => k !== 'dream' || DREAMERS[id]).filter((k) => k !== 'doubt' || PERSONALITY[id]?.doubt).map((k) => [k, t(`needs.${k}`)]);

const short = (t, n = 28) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Los diálogos están en los idiomas del juego (locales/: sim.*); los nombres van como {variables}.
const LUNCH_FOOD = { designer: '🥗', po: '🥗', analyst: '🍣', manager: '🍝', frontend: '🍕', backend: '🍕', qa: '🍔', tl: '🍜' };
// A quién le toca un requerimiento, según de qué habla (el manager reparte).
const ASSIGN_RULES = [
  ['designer', /dise[ñn]|design|logo|colou?r|paleta|palette|\bux\b|figma|[ií]cono|\bicons?\b|mockup|estilo|style/i],
  ['frontend', /front|\bui\b|pantalla|screen|vista|\bview|bot[oó]n|button|p[aá]gina|\bpage|css|react|vue|formulario|\bform|componente|component|\bweb\b|tema|theme|oscuro|dark/i],
  ['backend', /back(?!log)|\bapi\b|endpoint|servidor|server|base de datos|database|\bdb\b|sql|migraci|migration|auth|login|pago|payment|webhook|cola|queue|export/i],
  ['qa', /\btests?\b|prueba|\bbug|error|falla|failure|regresi|\bqa\b|e2e|cobertura|coverage/i],
];
export function assignees(text) {
  const roles = ASSIGN_RULES.filter(([, rx]) => rx.test(String(text || ''))).map(([r]) => r).slice(0, 2);
  return roles.length ? roles : ['tl']; // sin pistas: lo ve el Tech Lead
}

// Conversaciones que se cortan si al personaje le llega trabajo de verdad (consultar al TL no).
const LEISURE = new Set(['gossip', 'deskchat', 'coffee', 'lunchtalk', 'archchat', 'idea', 'rounds', 'tv']);

// Cuando cambia el clima de afuera (el real, o el simulado sin conexión)
const SKY_GROUP = { clear: 'fair', partly: 'fair', cloudy: 'cloudy', fog: 'fog', drizzle: 'wet', rain: 'wet', storm: 'storm', snow: 'snow' };

/** El texto de la bitácora para lo que hicieron por iniciativa propia. */
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
    this.badges = new Map(); // subagentes asignados: id → descripción
    this.walkT = 0;
    this.lastActive = clock() + random() * 20_000;
    this.carry = false;      // true: una tarjeta; 'ext': el extintor
    this.jumpUntil = 0;
    this.shakeUntil = 0;
    this.handUp = false;
    this.history = [];
    this.dream = null;     // { kind: 'unicorn' | 'rainbow' | 'skull' | 'pizza', start, until } lo que imagina
    this.scene = null;     // la conversación en la que está
    this.perch = false;    // sentado en una silla que no es la suya (almorzando)
    this.hidden = false;   // dentro del baño
    this.dance = false;    // esperando que se desocupe el baño
    this.food = null;      // lo que está comiendo
    this.lunch = null;     // { seat } mientras almuerza en la cafetería
    this.back = false;     // de espaldas (en el sofá, mirando la tele)
    this.tvSeat = null;    // el puesto del sofá que ocupa
    this.diningSeat = null; // su silla en el comedor, mientras almuerza
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

  /** Libre para hacer algo por iniciativa propia: sentado, sin cola, sin conversación ni urgencias. */
  get free() { return this.seated && !this.queue.length && !this.scene && !this.lunch && !['blocked', 'waiting', 'red', 'alarm'].includes(this.state); }

  goTo(pt) {
    const from = this.queue.findLast((j) => j.end)?.end || { x: this.x, y: this.y };
    this.queue.push({ t: 'walk', path: route(from, pt), end: { x: pt.x, y: pt.y } });
    return this;
  }
  wait(ms) { this.queue.push({ t: 'wait', ms }); return this; }
  until(at) { this.queue.push({ t: 'until', at }); return this; }
  /** Espera hasta que se cumpla la condición. */
  waitFor(test) { this.queue.push({ t: 'cond', test }); return this; }
  then(fn) { this.queue.push({ t: 'fn', fn }); return this; }
  goHome() { this.goTo(this.cfg.seat); this.queue.push({ t: 'sit', end: this.cfg.seat }); return this; }
  /** Camina en línea recta (sin pasar por los pasillos): para moverse dentro de la sala de estar. */
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

// Pasillos: detrás de la fila 1, entre filas, y delante de la fila 2 (zona de la mesa).
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
 * @param clock  () => ms; los renderers usan performance.now (y le pasan el mismo `now` a step)
 * @param random () => [0,1); los tests usan uno con semilla
 * @param wall   () => ms de época: la hora real (para el almuerzo); los tests la fijan
 * @param zone   la zona horaria de la oficina (null: la del sistema): de ella salen la hora, la
 *               luz del día y el clima simulado
 */
export function createSim({ clock = () => performance.now(), random = Math.random, wall = () => Date.now(), zone = null } = {}) {
  let simNow = clock();
  const now_ = () => simNow;
  const R = (a, b) => a + random() * (b - a);
  const P = (arr) => arr[Math.floor(random() * arr.length)];
  // los textos, en el idioma del juego y con los nombres actuales del equipo
  const T = (key, vars) => t(key, { ...teamNames(), ...vars });
  const L = (key) => ta(key, teamNames());
  const chance = (p) => random() < p;
  const agents = Object.fromEntries(Object.entries(TEAM).map(([id, cfg]) => [id, new Agent(id, cfg, now_, random)]));
  let particles = [];
  let board = { title: '', todos: [], status: 'idle', source: '' };
  let banner = null; // { text, tone, until }
  let celebrateUntil = 0;
  let lastDev = null;
  let turn = null;   // rol "de turno" declarado por el agente
  let turnPhase = null;
  let lastBlocked = null;
  let scenes = [];   // conversaciones en curso
  let journal = [];  // lo que hicieron por iniciativa propia (para la terminal, los tests y curiosos)
  let timers = [];   // cosas que pasan un rato después: { at, fn }
  let lastRequirement = { text: '', at: -Infinity };
  const memory = { task: '', lastError: null, lastGreen: null, fails: [], work: {} }; // de qué se habla en la oficina y cómo viene el trabajo
  // La vida de la oficina
  let bath = { occupant: null, line: [], doorAt: -Infinity };
  let lunch = null;          // { endMin, nextTalk } mientras almuerzan
  let lunchDay = null;       // el día en que ya almorzaron
  let fire = null;           // { phase: 'burning' | 'fighting' | 'repair' | 'done', start, at, level, crew, fighter, sprinklers }
  let lastFireAt = simNow - 5 * 60_000;
  let heat = 0;              // temperatura del rack: sube con la carga del backend
  let extinguisher = 'floor';
  let nextOffice = 0;
  let weather = null;        // el clima real que manda el servidor (null: se simula según la estación)
  let skyGroup = null;       // el último clima visto (para comentar cuando cambia)
  let lastWeatherTalk = -Infinity;
  let lastStrike = simNow;

  const log = (a, text) => {
    a.history.unshift({ ts: Date.now(), text });
    if (a.history.length > 40) a.history.pop();
  };
  const later = (ms, fn) => timers.push({ at: simNow + ms, fn });
  let tz = validZone(zone) ? zone : null;
  const wallDate = () => zoned(wall(), tz);
  // sin clima real, se simula en la ciudad de la zona horaria
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

  /** Vacía lo que tenía pensado hacer, salvo terminar en el baño si ya entró. */
  function clearQueue(a) {
    a.queue = a.queue.filter((j) => j.bath && bath.occupant === a.id);
    if (bath.line.includes(a.id)) bath.line = bath.line.filter((id) => id !== a.id);
    a.dance = false;
    if (a.carry === 'ext') { a.carry = false; extinguisher = 'floor'; }
    // si estaba en el sofá, sale por el costado (para no atravesar la tele)
    if (a.tvSeat != null) { a.tvSeat = null; a.back = false; if (a.y > TV.feet) a.walk(SOFA.side); }
    // si estaba sentado a la mesa del comedor, sale por donde entró (para no atravesar la mesa)
    if (a.diningSeat) {
      const seat = a.diningSeat;
      a.diningSeat = null;
      a.back = false;
      if (Math.hypot(a.x - seat.x, a.y - seat.y) < 2) fromDiningSeat(a, seat);
    }
  }

  /** Pone a un personaje a trabajar en su escritorio (vuelve si estaba fuera). */
  function work(a, text, state = 'working', ms = 6000) {
    // el trabajo de verdad manda: deja la conversación o el almuerzo y vuelve a su puesto
    if (a.lunch || LEISURE.has(a.scene?.kind)) { interrupt(a); emit(a.x, a.y - 70, 1, 'emote', null, '🏃'); }
    a.text = text;
    a.setState(state, ms);
    a.say(text);
    a.handUp = false;
    if (!a.seated && a.queue.length === 0) a.goHome();
  }

  // Un personaje se acerca a otro, dice algo y vuelve a su sitio.
  function visit(a, target, line, { carry = false, stay = 1600, after } = {}) {
    if (a.queue.length > 4) { a.say(line); after?.(); return false; } // muy ocupado: lo dice de lejos
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
          // TDD: en RED el test tiene que fallar. Es buena señal, no un bug.
          a.setState('red', 10_000);
          a.say(T('sim.redExpected'), 3500, 'error');
          emit(a.x, a.y - 40, 6, 'spark', '#ef476f');
        } else if (ev.role === 'qa') {
          // QA encontró un bug: va a contárselo a quien tocó el código por última vez.
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
        // nota chica de subtarea terminada: el festejo grande queda para el 'done' (merge)
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
      case 'poke':
        if (!a) break;
        a.jumpUntil = now + 700;
        a.say(T('sim.poke', { from: ev.from }), 2500);
        break;
      case 'dispatch':
        // Encargo enviado desde la oficina: es un requerimiento nuevo para el equipo.
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
        // fin de turno, sin festejo: la misma calma que el cierre de fase.
        turn = turnPhase = null;
        if (a) a.say(ev.text || T('sim.turnEnd'), 2500);
        break;
      case 'stage_end':
        // una etapa del pipeline terminó: pasó (o no) su gate
        if (!a) break;
        if (ev.ok) { a.jumpUntil = now + 800; a.say(ev.text || T('sim.stageOk'), 2600); emit(a.x, a.y - 60, 6, 'check'); }
        else { a.setState('blocked', 5000); a.shakeUntil = now + 600; a.say(ev.text || T('sim.stageFail'), 4000, 'error'); emit(a.x, a.y - 40, 10, 'spark', '#ff4d4d'); }
        break;
      // un pane de herdr que abrió el agente (o la oficina): alguien del equipo se encarga
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
    // Cualquier evento de agente quita el aviso de espera (ya se respondió).
    if (!['waiting', 'chat', 'poke'].includes(ev.kind) && !(ev.kind === 'pane_state' && ev.state === 'blocked')) {
      if (banner?.tone === 'warn') banner = null;
      if (agents.manager.handUp) { agents.manager.handUp = false; if (agents.manager.state === 'waiting') agents.manager.state = 'idle'; }
    }
  }

  /** El agente declara que un rol toma el turno en una fase del flujo (arquitecto → QA RED → backend → QA GREEN…). */
  function phase(a, ev, now) {
    const ph = phaseInfo(ev.phase);
    const line = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
    turn = a.id;
    turnPhase = ev.phase;
    log(a, line);

    // Traspaso: quien tenía el turno le lleva la tarjeta al siguiente (si éste trabaja en su sitio).
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

  // ---------------------------------------------------------------- la cabeza de cada uno

  const note = (kind, who, extra = {}) => {
    journal.push({ t: simNow, ts: wall(), kind, who, ...extra, text: describe(kind, who, extra), detail: extra.text });
    if (journal.length > 300) journal = journal.slice(-300);
  };

  /** Saca a alguien de lo que estaba haciendo (conversación o almuerzo) y lo manda a su puesto. */
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
   * Una conversación: los participantes van a `spot` (o se quedan donde están si es null) y
   * hablan por turnos. lines: [[quién, texto], …]
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

  /** Alguien más se suma a la escena para responder; la escena dura hasta `end`. */
  function join(sc, id, lines, end) {
    sc.lines.push(...lines.map(([text, at]) => ({ who: id, text, at })));
    sc.end = Math.max(sc.end, end);
    if (!sc.members.includes(id)) { sc.members.push(id); agents[id].scene = sc; }
    for (const m of sc.members) agents[m].queue = agents[m].queue.map((j) => (j.t === 'until' ? { ...j, at: sc.end } : j));
  }

  /** Lo que se dice en el cotorreo: chismes de la oficina y lo que está pasando. */
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
    // sentadas juntas cotorrean desde el escritorio; a veces se juntan en la cafetería o el sofá
    const spot = chance(0.55) ? null : P([{ x: COUNTER_SPOTS[0].x, y: COUNTER_SPOTS[0].y + 4 }, SPOT.sofa, { x: 210, y: CORRIDOR_TOP + 4 }]);
    // y a veces de la charla sale una idea que le llevan al manager
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

  /** Cuánto más rápido se le llena la imaginación según lo que pasa (pesadillas tras un error, pizza con hambre). */
  function dreamBoost(a) {
    if (a.id === 'qa' && memory.fails.some((t) => simNow - t < 180_000)) return 2.5; // con tests fallando, pesadillas
    if (DREAMERS[a.id]?.includes('pizza')) {
      const m = minutesOfDay();
      if (lunch) return 0;
      if (m >= 11.5 * 60 && m < LUNCH.start) return 2.5; // hambre antes de almorzar
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
    // si está haciendo algo concreto ("Editando api.js") lo cuenta: "estoy editando api.js: …"
    const doing = chance(0.5) ? t('sim.doing', { text: short(a.text, 26) }) : '';
    const sc = scene('consult', [a.id], [[a.id, T('sim.consultAsk', { doing, ask: P(L(`sim.ask.${a.id}`)) })]], { spot: { x: tl.cfg.seat.x + 62, y: tl.cfg.seat.y - 6 } });
    const at = sc.lines[0].at;
    join(sc, 'tl', [[P(L('sim.answers')), at + 2300]], at + 5300);
    sc.lines.push({ who: a.id, text: P(L('sim.thanks')), at: at + 4600 });
    a.mind.doubt = -R(0, 0.5);
    return true;
  }

  /** El arquitecto va a conversar con alguien de producto (prioridades, datos, diseños). */
  function archChat(tl, { target: want, asks = 'sim.tlAsks' } = {}) {
    if (!tl.free) return false;
    const who = PRODUCT.filter((id) => agents[id].free);
    if (!who.length) return false;
    const target = agents[who.includes(want) ? want : P(who)];
    const s = target.cfg.seat;
    // el TL va a su escritorio; ella le responde sin levantarse
    const sc = scene('archchat', ['tl'], [['tl', P(L(`${asks}.${target.id}`))]], { spot: { x: s.x + 54, y: s.y - 6 }, quiet: true });
    note('archchat', 'tl', { with: [target.id] });
    const at = sc.lines[0].at + 2300;
    join(sc, target.id, [[P(L(`sim.tlReplies.${target.id}`)), at]], at + 2600);
    sc.lines.push({ who: 'tl', text: P(L('sim.tlThanks')), at: at + 2200 });
    tl.mind.product = -R(0, 0.5);
    return true;
  }

  /** Producto va donde el TL a preguntar si lo que se viene es factible. */
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

  /** Lo que se comenta frente a la tele (el pronóstico es el de verdad). */
  function tvLines() {
    const w = currentWeather(), info = WEATHER[w.kind];
    const lines = [...L('sim.tv'), T('sim.tvForecast', { label: t(`weather.${w.kind}`), temp: Number.isFinite(w.temp) ? `, ${Math.round(w.temp)}°` : '', icon: info.icon })];
    if (memory.task) lines.push(T('sim.tvTask', { task: short(memory.task, 18) }));
    return lines;
  }

  /** Se sienta en el sofá a ver tele un rato (de espaldas a nosotros). */
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
    if (Object.values(agents).some((o) => o !== a && o.scene?.kind === 'coffee')) return false; // de a uno al café
    const spot = P(COUNTER_SPOTS);
    scene('coffee', [a.id], [[a.id, P(L('sim.coffee'))]], { spot: { x: spot.x + R(-8, 8), y: spot.y } });
    a.state = 'coffee'; a.stateUntil = simNow + 9000;
    a.mind.coffee = -R(0, 0.4);
    a.mind.bladder += 0.25; // el café se nota después
    return true;
  }

  /** Al baño: de a uno. Si está ocupado, espera afuera (inquieto). */
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
   * Un requerimiento nuevo: las de producto lo comentan, la PO se lo lleva al manager y él se lo
   * pasa a quien corresponda según de qué trata.
   */
  function requirement(text) {
    text = String(text || '').trim();
    // el encargo (dispatch) y el prompt que después reporta el agente (task) son el mismo pedido
    if (!text || simNow - lastRequirement.at < 20_000) { if (text) memory.task = text; return; }
    lastRequirement = { text, at: simNow };
    memory.task = text;
    const po = agents.po, m = agents.manager;
    for (const id of ['po', 'manager', ...PRODUCT]) interrupt(agents[id]);
    const targets = assignees(text);
    // en el rincón de producto: lo comentan desde sus escritorios
    const pod = PRODUCT.filter((id) => id !== 'po' && agents[id].seated && !agents[id].queue.length);
    po.say(T('sim.reqArrived', { text: short(text, 40) }), 3600);
    po.setState('talking', 9000);
    if (pod[0]) agents[pod[0]].wait(900).then((x) => x.say(T(x.id === 'designer' && targets.includes('designer') ? 'sim.reqMockups' : x.id === 'analyst' ? 'sim.reqAnalyze' : 'sim.reqGo'), 2800));
    note('requirement', 'po', { with: ['manager'], text, to: targets });
    // la PO le lleva la tarjeta a Marco
    clearQueue(po);
    po.carry = true;
    po.wait(1400).goTo({ x: m.cfg.seat.x - 70, y: m.cfg.seat.y - 6 })
      .then((p) => {
        p.carry = false;
        p.say(T('sim.reqToManager', { text: short(text, 60) }), 3800);
        // Marco lo reparte a su equipo según la tarea
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

  /** ¿Está en medio de algo que le pidió el agente? Entonces almuerza en su escritorio. */
  const onDuty = (a) => a.badges.size > 0 || (['working', 'thinking', 'red'].includes(a.state) && simNow - a.lastActive < 20_000) || a.id === turn;

  /** Hasta su silla del comedor sin atravesar la mesa: los de atrás entran por la puerta del muro
   *  y bajan por detrás de las sillas; los de adelante llegan por abajo. */
  function toDiningSeat(a, seat) {
    const { aisle } = DINING;
    if (seat.row === 'back') a.goTo({ x: aisle.door, y: aisle.back }).walk({ x: seat.x, y: aisle.back }).walk(seat);
    else a.goTo({ x: aisle.side, y: aisle.front }).walk({ x: seat.x, y: aisle.front }).walk(seat);
    return a;
  }
  /** Y para irse, el mismo camino al revés. */
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
    // producto y el manager, detrás de la mesa (de frente); el equipo técnico, delante (de espaldas)
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
      // una fila de la mesa con al menos dos sentados: uno habla, otro responde
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
    // se van levantando de a poco
    let i = 0;
    for (const a of Object.values(agents)) {
      if (a.lunch) later(i++ * 600, () => { a.lunch = null; });
      if (a.food === '🥪') a.food = null;
    }
    if (!agents.manager.hidden) agents.manager.say(P(L('sim.lunchEnd')), 2800);
  }

  // ---------------------------------------------------------------- el incendio

  /** El rack se incendia: el equipo técnico va con el extintor, lo apaga y reinicia los servidores. */
  function ignite(cause) {
    if (fire) return false;
    const crew = FIRE_ORDER.filter((id) => { const a = agents[id]; return !a.hidden && !a.lunch && !bath.line.includes(id); });
    if (!crew.length) return false;
    const fighter = crew[0];
    fire = { phase: 'burning', start: simNow, at: simNow, level: 0, crew, fighter, sprinklers: false };
    lastFireAt = simNow;
    banner = { text: T(cause ? 'sim.fireBannerCause' : 'sim.fireBanner'), tone: 'fire', until: simNow + 9000 };
    note('fire', fighter, { with: crew.slice(1), cause });
    // la oficina reacciona
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
      // si nadie llega (todos ocupados), se activan los rociadores
      if (simNow - f.start > 25_000) { f.phase = 'fighting'; f.at = simNow; f.sprinklers = true; banner = { text: T('sim.sprinklers'), tone: 'fire', until: simNow + 5000 }; }
    } else if (f.phase === 'fighting') {
      f.level = Math.max(0, f.level - dt / 7);
      const fx = agents[f.fighter];
      if (f.sprinklers) { if (random() < dt * 40) emit(R(RACK.x - 30, RACK.x + RACK.w + 30), 124, 1, 'drop', '#7ad7f0'); }
      else if (fx.carry === 'ext' && random() < dt * 45) {
        const sx = fx.x + 27, sy = fx.y - 37; // la boquilla del extintor
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
    // humo y chispas mientras quema (y algo de humo al reparar)
    const smoke = f.phase === 'repair' ? 1.5 : f.phase === 'done' ? 0 : 7 * f.level + 1;
    if (random() < dt * smoke) emit(R(RACK.x + 4, RACK.x + RACK.w - 4), RACK.y - 6, 1, 'smoke', '#6c6f7d');
    if (f.phase !== 'repair' && f.phase !== 'done' && random() < dt * 4 * f.level) emit(R(RACK.x, RACK.x + RACK.w), RACK.y + R(0, 40), 2, 'spark', P(['#ffd166', '#ff9f1c']));
  }

  // ---------------------------------------------------------------- lo que hace el harness, en la oficina
  //
  // Cada señal del agente y sus subagentes empuja una necesidad o dispara una reacción del
  // personaje que corresponde; el azar sólo decide el momento exacto (y a veces que no pase):
  //   tests o gates que fallan  → QA tiene pesadillas; quien falló queda con dudas (consulta al TL)
  //   errores seguidos          → el rack se recalienta y se puede incendiar
  //   subagente o herramienta   → ese personaje teclea; mucho teclear da hambre (sueña con pizza) y cansa (café)
  //   fases de diseño (ux/ui)   → la diseñadora se inspira (unicornios y arcoíris)
  //   arquitectura / ADR        → el TL va a preguntarle el alcance a producto
  //   historia / requisitos     → producto va a preguntarle al TL si es factible
  //   el agente espera tu OK    → los que no trabajan aprovechan de tomar café o conversar
  //   tarea terminada           → celebración, y los devs sueñan con la pizza del festejo
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
        if (a.id === 'backend' && /bash|shell|exec/i.test(ev.tool || '')) heat = Math.min(1.2, heat + 0.04); // builds y scripts calientan el rack
        if (a.id === 'designer') a.mind.dream += ev.kind === 'subagent_start' ? 0.4 : 0.12; // diseñar la inspira
        break;
      case 'subagent_end':
        if (!a) break;
        // terminó su subtarea: a veces se premia con pizza (en sueños), si no, con un café
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
        // mientras esperan tu OK, los que no están trabajando aprovechan la pausa: café o tele
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
    // Fallas y éxitos: herramientas, gates de las etapas y errores del agente.
    if (!['tool_end', 'stage_end', 'error'].includes(ev.kind)) return;
    const isTest = ev.kind === 'stage_end' || ev.role === 'qa' || TEST_RX.test(`${ev.tool || ''} ${ev.text || ''}`);
    if (ev.ok === false && !red) {
      memory.fails = [...within(memory.fails, 3 * 60_000), simNow];
      // los tests que no pasan le quitan el sueño a QA
      if (isTest) later(R(1200, 3200), () => { if (chance(0.85)) imagine(agents.qa, { kind: 'skull', line: P(L('sim.nightmares')), cause: t('sim.cause.testsFailed') }); });
      // quien falló queda con dudas: pronto va a consultar al TL
      if (a && PERSONALITY[a.id]?.doubt) a.mind.doubt = Math.max(a.mind.doubt, 0.95);
      // los errores recalientan el servidor; si se acumulan, se incendia
      heat = Math.min(1.3, heat + (a?.id === 'backend' || ev.kind === 'error' ? 0.3 : 0.12));
      if (memory.fails.length >= 3 && heat >= 0.9 && !fire && !lunch && simNow - lastFireAt > 4 * 60_000 && chance(0.5)) {
        later(R(1500, 4000), () => { if (!fire && !lunch) ignite(t('sim.cause.tooManyErrors')); });
      }
    } else if (ev.ok && isTest) {
      calm();
    }
  }

  /** Todo en verde: QA respira tranquilo y el rack se enfría un poco. */
  function calm() {
    const qa = agents.qa;
    qa.mind.dream = Math.min(qa.mind.dream, 0);
    if (qa.dream?.kind === 'skull') qa.dream.until = Math.min(qa.dream.until, simNow + 400);
    memory.fails = [];
    heat = Math.max(0, heat - 0.15);
  }

  // ---------------------------------------------------------------- la vida de la oficina

  /** Cada medio segundo: el reloj (almuerzo), el baño, la temperatura del rack y los imprevistos. */
  function officeTick(dt) {
    const m = minutesOfDay();
    const lunchTime = m >= LUNCH.start && m < LUNCH.end;
    if (lunch) lunchTick();
    else if (lunchTime && lunchDay !== dayKey() && !fire) startLunch();
    weatherTick();
    if (bath.occupant && random() < dt * 0.25) emit(BATH.door.x + R(-10, 10), BATH.door.y - 50, 1, 'emote', null, P(['🎵', '🎶', '🧻', '🚿']));
    // el rack se calienta con la carga del backend; caliente, humea y puede prenderse
    if (!fire && heat > 0.75 && random() < dt * 0.6) emit(R(RACK.x + 6, RACK.x + RACK.w - 6), RACK.y - 4, 1, 'smoke', '#9095b0');
    const hazard = (0.5 + heat) / (18 * 60); // por segundo: ~1 cada 36 min en calma, ~1 cada 12 min con el rack al rojo
    const crewHere = FIRE_ORDER.filter((id) => !agents[id].hidden && !agents[id].lunch).length;
    if (!fire && !lunch && simNow > celebrateUntil && simNow - lastFireAt > 8 * 60_000 && crewHere >= 2 && random() < dt * hazard) ignite();
  }

  // ---------------------------------------------------------------- el clima de afuera

  /** El clima que se ve por el vidrio: el real (lo manda el servidor) o uno simulado según la estación. */
  const currentWeather = () => weather || simulatedWeather(wallDate(), simPlace());

  function weatherTick() {
    const w = currentWeather();
    const group = SKY_GROUP[w.kind] || 'fair';
    if (skyGroup && group !== skyGroup) weatherChanged(group, w);
    skyGroup = group;
    // con tormenta, a veces un trueno asusta a alguien
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
    // con lluvia dan más ganas de café y de tele
    if (group === 'wet' || group === 'storm') for (const id of [...TECH, 'tl']) agents[id].mind.social += 0.3;
    if (simNow - lastWeatherTalk < 5 * 60_000 || !chance(0.75)) return;
    const who = Object.values(agents).filter((a) => !a.hidden && !a.walking && a.state !== 'alarm');
    if (!who.length) return;
    lastWeatherTalk = simNow;
    const a = P(who);
    if (group === 'wet') a.mind.coffee = Math.max(a.mind.coffee, 0.9);
    later(R(800, 2500), () => { a.say(P(L(`sim.weatherTalk.${group}`)), 3600); emit(a.x, a.y - 80, 1, 'emote', null, WEATHER[w.kind].icon); });
  }

  /** Cada tanto, cada personaje decide qué hacer según sus necesidades y su personalidad. */
  function brain(a, dt) {
    const mind = a.mind, pers = PERSONALITY[a.id];
    // las necesidades crecen con el tiempo
    if (a.free && a.state !== 'working') mind.social += dt / pers.social;
    mind.coffee += (dt / pers.coffee) * (a.state === 'working' ? 1.6 : 1); // trabajando se cansa más rápido
    if (!a.hidden) mind.bladder += dt / pers.bladder;
    if (pers.doubt && a.seated && ['working', 'thinking'].includes(a.state)) mind.doubt += dt / pers.doubt;
    if (pers.dream) mind.dream += (dt / pers.dream) * dreamBoost(a);
    if (pers.rounds && a.free) mind.rounds += dt / pers.rounds;
    if (pers.product && a.free) mind.product += dt / pers.product;

    if (simNow < mind.nextThink) return;
    mind.nextThink = simNow + R(1200, 2600);
    if (a.dream && simNow > a.dream.until) a.dream = null;
    if (simNow < celebrateUntil || a.hidden || a.state === 'alarm') return;

    // sueñan despiertos (a veces): la diseñadora hasta trabajando; QA con calaveras; los devs con pizza
    if (pers.dream && mind.dream >= 1 && !a.walking && !a.dream && (a.seated || a.perch) && chance(0.35)) return imagine(a);
    // los técnicos, trabajando, a veces se paran a consultar al Tech Lead
    if (pers.doubt && mind.doubt >= 1 && a.seated && !a.queue.length && !a.scene && chance(0.6)) { if (consultTL(a)) return; }
    // al baño: si ya no aguanta, deja lo que esté haciendo en su escritorio
    if (mind.bladder >= 1.6 && a.seated && !a.queue.length && !a.scene && !a.lunch) { bathroom(a, true); return; }
    if (!a.free) return;
    if (mind.bladder >= 1 && chance(0.4)) { bathroom(a); return; }
    if (PRODUCT.includes(a.id) && mind.social >= 1) { if (gossip(a)) return; mind.social = 0.6; }
    if (pers.product && mind.product >= 1 && !['working', 'thinking', 'red'].includes(a.state) && chance(0.5)) { if (archChat(a)) return; mind.product = 0.7; }
    if (pers.rounds && mind.rounds >= 1 && a.state === 'idle') { if (rounds(a)) return; mind.rounds = 0.5; }
    // los técnicos, sin nada que hacer, a veces se sientan a ver tele (con lluvia, más)
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

  /** Avanza la simulación `dt` segundos. Los renderers la llaman una vez por cuadro. */
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
    /** El clima de afuera: el real si llegó del servidor, si no uno simulado según la estación. */
    get weather() { return currentWeather(); },
    /** La fecha y hora de la oficina, en su zona horaria (un ZonedDate). */
    date: () => wallDate(),
    get zone() { return tz; },
    setZone(z) { tz = validZone(z) ? z : null; },
    setWeather(w) { weather = w && WEATHER[w.kind] ? w : null; },
    watchTV: (id, opts) => watchTV(agents[id], opts),
    setBoard(session) {
      if (session && 'turn' in session) { turn = session.turn; turnPhase = session.phase; } // el servidor manda
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
      // si es la hora de almuerzo, vuelven a salir en el siguiente tic
      lunch = null; lunchDay = null; fire = null; extinguisher = 'floor'; heat = 0; timers = [];
    },
  };
}
