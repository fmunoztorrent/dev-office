// Simulación de la oficina, sin dibujo: personajes, rutas, reacciones a eventos y partículas.
// La usan el render en canvas (navegador, game.js) y el render de terminal (tui/).
// Todas las coordenadas están en un mundo de W×H.
//
// Además de reaccionar a lo que hace el agente, cada personaje tiene su propia "cabeza"
// (brain): necesidades que crecen con el tiempo (conversar, café, consultar, inspiración) y una
// personalidad que decide qué hace cuando nadie le pide nada. Las NPC de producto (PO, analista,
// diseñadora) se sientan juntas y cotorrean; la diseñadora sueña con unicornios y arcoíris; los
// técnicos a veces van a consultar al TL; el manager reparte los requerimientos y hace rondas.

export const W = 960, H = 600;

// Fila de arriba: el rincón de producto (diseñadora, PO y analista, juntas) y el manager.
// Fila de abajo: el equipo técnico, con el TL un poco aparte (se le va a consultar).
export const TEAM = {
  designer: { name: 'Camila', title: 'Diseñadora', shirt: '#c86bfa', pants: '#3a2f45', hair: '#f2d16b', skin: '#f0c8a8', long: true, seat: { x: 100, y: 228 }, prop: 'tablet' },
  po: { name: 'Sofía', title: 'Product Owner', shirt: '#e0607e', pants: '#3b3355', hair: '#5a3214', skin: '#f2c9a0', long: true, seat: { x: 210, y: 228 }, prop: 'notes' },
  analyst: { name: 'Valentina', title: 'Analista de negocio', shirt: '#f0a73a', pants: '#2f3b52', hair: '#21160f', skin: '#c98e62', long: true, seat: { x: 320, y: 228 }, prop: 'chart' },
  manager: { name: 'Marco', title: 'Manager', shirt: '#3f73f0', pants: '#2a2d3a', hair: '#8d8d8d', skin: '#e8b98f', seat: { x: 840, y: 228 }, prop: 'phone' },
  frontend: { name: 'Lucía', title: 'Frontend', shirt: '#ff7a45', pants: '#2d3a4f', hair: '#b8322a', skin: '#f5d0b0', long: true, seat: { x: 110, y: 418 }, prop: 'dual' },
  backend: { name: 'Diego', title: 'Backend', shirt: '#6b5bd6', pants: '#22222e', hair: '#151515', skin: '#b07a52', seat: { x: 220, y: 418 }, prop: 'terminal' },
  qa: { name: 'Andrés', title: 'QA', shirt: '#8ac926', pants: '#2b3a2e', hair: '#3d2817', skin: '#e0ac7e', glasses: true, seat: { x: 330, y: 418 }, prop: 'qa' },
  tl: { name: 'Tomás', title: 'Tech Lead', shirt: '#22a68e', pants: '#26313a', hair: '#2b1b12', skin: '#d9a273', beard: true, seat: { x: 560, y: 418 }, prop: 'big' },
};
export const PRODUCT = ['po', 'analyst', 'designer']; // NPC del negocio: conversan entre ellas y traen los requerimientos
export const TECH = ['backend', 'frontend', 'qa'];      // trabajan y a veces consultan al TL

// La pizarra de la pared: al hacerle clic se abre el diálogo para encargar una tarea.
export const BOARD = { x: 336, y: 6, w: 308, h: 112 };
export const onBoard = (x, y) => x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h;

// Apariencia personalizable (⚙ Ajustes › Personajes). TEAM se modifica en el sitio para que
// los dos renderers y la simulación vean el cambio al instante.
export const APPEARANCE_KEYS = ['name', 'title', 'shirt', 'pants', 'hair', 'skin', 'long', 'beard', 'glasses'];
export const DEFAULT_TEAM = Object.fromEntries(Object.entries(TEAM).map(([id, c]) => [id, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, c[k] ?? false]))]));
// Paletas para elegir colores sin escribir hex (la terminal las recorre con ◂ ▸; la web también tiene selector libre).
export const LOOK_PALETTES = {
  shirt: ['#e0607e', '#f0a73a', '#3f73f0', '#22a68e', '#8ac926', '#6b5bd6', '#ff7a45', '#c86bfa', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'],
  pants: ['#2a2d3a', '#2f3b52', '#3b3355', '#26313a', '#2b3a2e', '#22222e', '#3a2f45', '#4a3b2a'],
  hair: ['#151515', '#21160f', '#3d2817', '#5a3214', '#8d8d8d', '#b8322a', '#f2d16b', '#e8e9f1'],
  skin: ['#f5d0b0', '#f2c9a0', '#f0c8a8', '#e8b98f', '#e0ac7e', '#d9a273', '#c98e62', '#b07a52', '#8d5a3b'],
};
export function applyAppearance(overrides = {}) {
  for (const [id, cfg] of Object.entries(TEAM)) {
    const o = overrides[id] || {};
    for (const k of APPEARANCE_KEYS) cfg[k] = o[k] ?? DEFAULT_TEAM[id][k];
  }
}

export const SPOT = {
  board: { x: 490, y: 148 },
  coffee: { x: 905, y: 150 },
  table: { x: 600, y: 515 },
  sofa: { x: 360, y: 512 },
};
export const PLANTS = [[20, 560], [930, 560], [745, 372]];
const TABLE_SEATS = [[-75, -40], [-25, -42], [25, -42], [75, -40], [-108, 0], [108, 0], [-100, 42], [100, 42]];
const CORRIDOR_TOP = 148, CORRIDOR_MID = 318, CORRIDOR_LOW = 462;
const LANES = [25, 445, 665]; // huecos entre escritorios por donde se cambia de pasillo
const DEVS = ['backend', 'frontend', 'designer'];
const SPEED = 120; // px del mundo por segundo al caminar
export const STATUS_ICON = { working: '💻', thinking: '💭', blocked: '❗', waiting: '✋', done: '🎉', coffee: '☕', talking: '💬', red: '🔴' };

// Lo que imagina la diseñadora: pixel art que dibujan los dos renderers (cada carácter es un
// pixel; '.' es transparente).
export const DREAM_PALETTE = { W: '#ffffff', w: '#e9ecf5', k: '#2b2d42', y: '#ffd166', p: '#ff7eb6', v: '#c86bfa', h: '#8d99ae', b: '#7ad7f0' };
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
export const RAINBOW_COLORS = ['#ef476f', '#ff9f1c', '#ffd166', '#06d6a0', '#118ab2', '#8e7dbe'];
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
export const PHASES = {
  historia: { label: 'Historia', icon: '📝', anim: 'board' },
  criterios: { label: 'Criterios', icon: '📋', anim: 'board' },
  prioriza: { label: 'Prioriza', icon: '📌', anim: 'board' },
  acepta: { label: 'Acepta', icon: '✅', anim: 'approve' },
  rechaza: { label: 'Rechaza', icon: '❌', anim: 'reject' },
  analiza: { label: 'Analiza', icon: '🧐', anim: 'think' },
  investiga: { label: 'Investiga', icon: '🔎', anim: 'work' },
  requisitos: { label: 'Requisitos', icon: '📑', anim: 'board' },
  planifica: { label: 'Planifica', icon: '🗂️', anim: 'board' },
  asigna: { label: 'Asigna', icon: '📨', anim: 'work' },
  desbloquea: { label: 'Desbloquea', icon: '🔓', anim: 'visit' },
  release: { label: 'Release', icon: '🚀', anim: 'release' },
  arquitectura: { label: 'Arquitectura', icon: '🏛️', anim: 'board' },
  adr: { label: 'ADR', icon: '📐', anim: 'board' },
  review: { label: 'Review', icon: '🔍', anim: 'visit' },
  aprueba: { label: 'Aprueba', icon: '👍', anim: 'approve' },
  cambios: { label: 'Pide cambios', icon: '✋', anim: 'reject' },
  refactor: { label: 'Refactor', icon: '♻️', anim: 'work' },
  'plan-pruebas': { label: 'Plan de pruebas', icon: '🧪', anim: 'think' },
  red: { label: 'RED', icon: '🔴', anim: 'red' },
  green: { label: 'GREEN', icon: '🟢', anim: 'green' },
  regresion: { label: 'Regresión', icon: '🧪', anim: 'work' },
  bug: { label: 'Bug', icon: '🐞', anim: 'visit' },
  verifica: { label: 'Verifica', icon: '🔬', anim: 'work' },
  implementa: { label: 'Implementa', icon: '⌨️', anim: 'work' },
  fix: { label: 'Fix', icon: '🔧', anim: 'work' },
  migracion: { label: 'Migración', icon: '🗄️', anim: 'work' },
  ux: { label: 'UX', icon: '✏️', anim: 'work' },
  ui: { label: 'UI', icon: '🎨', anim: 'work' },
  'revision-visual': { label: 'Revisión visual', icon: '👀', anim: 'visit' },
  bloqueado: { label: 'Bloqueado', icon: '⛔', anim: 'blocked' },
};
export const phaseInfo = (id) => PHASES[id] || { label: String(id || '').toUpperCase(), icon: '▶', anim: 'work' };
export const PHASE_COLOR = { red: '#ef476f', green: '#06d6a0', bloqueado: '#ef476f', cambios: '#f4a261', rechaza: '#f4a261' };
const CODE_GLYPHS = '{}<>/;=()[]#$*+'.split('');

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ------------------------------------------------------------------------------------
// Personalidad: cuánto le cuesta quedarse solo, cuánto café toma, de qué habla.

// Segundos que tarda cada necesidad en llenarse (y que el personaje haga algo al respecto).
const PERSONALITY = {
  po: { social: 55, coffee: 420 },
  analyst: { social: 65, coffee: 460 },
  designer: { social: 60, coffee: 480, inspiration: 70 },
  manager: { social: 110, coffee: 360, rounds: 90 },
  tl: { social: 400, coffee: 400 },
  backend: { social: 400, coffee: 440, doubt: 95 },
  frontend: { social: 400, coffee: 460, doubt: 85 },
  qa: { social: 400, coffee: 460, doubt: 110 },
};
/** Necesidades de 0 a 1 (al llegar a 1, actúa). Arrancan desparejas para que no actúen todos a la vez. */
function freshMind(random) {
  const r = () => random() * 0.6;
  return { social: r(), coffee: r(), doubt: r(), inspiration: r() + 0.2, rounds: r(), nextThink: 0 };
}

const short = (t, n = 28) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

const GOSSIP = {
  po: ['¿Vieron lo que pidió el cliente? 🙄', 'Todo es urgente, como siempre 😅', '¿Almorzamos juntas hoy? 🥗', 'Marco va por su quinto café ☕😂', 'El roadmap quedó precioso 📌'],
  analyst: ['Los números de ayer… ¡subieron! 📈', 'Encontré un dato buenísimo 🤓', '¿Vieron el dashboard nuevo? 📊', 'Diego juró que no era un bug 👀', 'Hice una planilla de las planillas 😂'],
  designer: ['¿Y si todo fuera violeta? 💜', 'Ese botón me quita el sueño 😱', 'Le falta aire a esa pantalla ✨', 'Les traje una paleta nueva 🎨', '¿Quién usó Comic Sans? 😤'],
};
const REPLIES = ['Jajaja 😂', '¡Nooo! 😱', 'Total 💯', '¿En serio? 👀', 'Me encanta 💜', 'Ya sé, ¿no? 🙄', 'Cuéntame más ☕', 'Jaja, típico 😅'];
const IDEAS = ['modo oscuro 🌙', 'un tour para usuarios nuevos', 'exportar a PDF', 'notificaciones en vivo', 'un dashboard de métricas', 'login con Google'];
const ASK = {
  backend: ['¿este endpoint lo hago REST o RPC?', '¿te parece bien este índice?', '¿cómo manejamos este error?', '¿lo meto en una cola?'],
  frontend: ['¿estado local o global aquí?', '¿separo este componente?', '¿qué opinas de este hook?', '¿lo hago responsive así?'],
  qa: ['¿este caso borde lo cubrimos?', '¿mockeo esto o voy contra la base?', 'encontré algo raro, ¿lo vemos?', '¿cuánta cobertura pedimos?'],
};
const ANSWER = ['Hazlo simple, después refactorizamos 👍', 'Mándame el PR y lo miro 🔍', 'Sigue el ADR que acordamos 📐', 'Sí, pero agrégale un test 🧪', 'Sepáralo, va a crecer ♻️', 'Hagamos pair 5 minutos 👥'];
const THANKS = ['¡Gracias! 🙌', 'Dale, voy 💪', 'Perfecto 👌', '¡Me salvaste! 😅'];
const DREAM_LINES = {
  unicorn: ['¡Un onboarding con unicornios! 🦄', '¿Un unicornio en la página 404? 🦄✨', 'Imaginen: el logo… ¡con cuerno! 🦄'],
  rainbow: ['¿Y si el botón fuera un arcoíris? 🌈', 'Un degradado arcoíris en el header 🌈', '¡Más color! 🌈✨'],
};
// A quién le toca un requerimiento, según de qué habla (el manager reparte).
const ASSIGN_RULES = [
  ['designer', /dise[ñn]|logo|color|paleta|\bux\b|figma|[ií]cono|mockup|estilo/i],
  ['frontend', /front|\bui\b|pantalla|vista|bot[oó]n|p[aá]gina|css|react|vue|formulario|componente|\bweb\b|tema|oscuro/i],
  ['backend', /back(?!log)|\bapi\b|endpoint|servidor|base de datos|\bdb\b|sql|migraci|auth|login|pago|webhook|cola|export/i],
  ['qa', /\btests?\b|prueba|\bbug|error|falla|regresi|\bqa\b|e2e|cobertura/i],
];
export function assignees(text) {
  const roles = ASSIGN_RULES.filter(([, rx]) => rx.test(String(text || ''))).map(([r]) => r).slice(0, 2);
  return roles.length ? roles : ['tl']; // sin pistas: lo ve el Tech Lead
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
    this.carry = false;
    this.jumpUntil = 0;
    this.shakeUntil = 0;
    this.handUp = false;
    this.history = [];
    this.dream = null;     // { kind: 'unicorn' | 'rainbow', start, until } lo que imagina (la diseñadora)
    this.scene = null;     // la conversación en la que está
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
  get free() { return this.seated && !this.queue.length && !this.scene && !['blocked', 'waiting', 'red'].includes(this.state); }

  goTo(pt) {
    const from = this.queue.findLast((j) => j.end)?.end || { x: this.x, y: this.y };
    this.queue.push({ t: 'walk', path: route(from, pt), end: { x: pt.x, y: pt.y } });
    return this;
  }
  wait(ms) { this.queue.push({ t: 'wait', ms }); return this; }
  until(at) { this.queue.push({ t: 'until', at }); return this; }
  then(fn) { this.queue.push({ t: 'fn', fn }); return this; }
  goHome() { this.goTo(this.cfg.seat); this.queue.push({ t: 'sit', end: this.cfg.seat }); return this; }

  update(dt, now) {
    if (this.state !== 'idle' && now > this.stateUntil && !['waiting', 'blocked'].includes(this.state)) this.state = 'idle';
    if (this.state === 'blocked' && now > this.stateUntil + 4000) this.state = 'idle';
    if (this.bubble && now > this.bubble.until) this.bubble = null;

    const job = this.queue[0];
    if (!job) return;
    if (job.t === 'walk') {
      this.seated = false;
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
 */
export function createSim({ clock = () => performance.now(), random = Math.random } = {}) {
  let simNow = clock();
  const now_ = () => simNow;
  const R = (a, b) => a + random() * (b - a);
  const P = (arr) => arr[Math.floor(random() * arr.length)];
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
  let journal = [];  // lo que hicieron por iniciativa propia (para tests y curiosos)
  let lastRequirement = { text: '', at: -Infinity };
  const memory = { task: '', lastError: null, lastGreen: null }; // de qué se habla en la oficina

  const log = (a, text) => {
    a.history.unshift({ ts: Date.now(), text });
    if (a.history.length > 40) a.history.pop();
  };

  function emit(x, y, n, kind, color, ch) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y, kind, color: color || P(['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c86bfa', '#ff7a45']),
        vx: kind === 'confetti' ? R(-40, 40) : kind === 'sparkle' ? R(-35, 35) : R(-18, 18),
        vy: kind === 'confetti' ? R(30, 90) : kind === 'sparkle' ? R(-40, 10) : R(-50, -25),
        life: kind === 'confetti' ? R(2.5, 4.5) : kind === 'sparkle' || kind === 'emote' ? R(1.2, 2) : R(0.8, 1.4),
        ch: ch || (kind === 'sparkle' ? P(['✦', '✧', '⋆']) : P(CODE_GLYPHS)), rot: R(0, 6),
      });
    }
    if (particles.length > 600) particles = particles.slice(-600);
  }

  /** Pone a un personaje a trabajar en su escritorio (vuelve si estaba fuera). */
  function work(a, text, state = 'working', ms = 6000) {
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
        agents.manager.say('¡Arrancamos! ☕');
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
          if (ev.role === 'qa' && ev.phase !== 'red' && /^(bash|shell|exec)$/i.test(ev.tool)) a.say('✅ ¡Tests en verde!', 3000);
        } else if (ev.phase === 'red') {
          // TDD: en RED el test tiene que fallar. Es buena señal, no un bug.
          a.setState('red', 10_000);
          a.say('🔴 Falla como se esperaba (RED)', 3500, 'error');
          emit(a.x, a.y - 40, 6, 'spark', '#ef476f');
        } else if (ev.role === 'qa') {
          // QA encontró un bug: va a contárselo a quien tocó el código por última vez.
          const dev = agents[lastDev] || agents.tl;
          a.setState('talking', 6000);
          a.say('🐞 ¡Encontré un bug!', 2500, 'error');
          emit(a.x, a.y - 50, 6, 'bug');
          visit(a, dev.id, `🐞 ${dev.cfg.name}: ${ev.text}`, {
            stay: 2600,
            after: () => setTimeout(() => { dev.setState('thinking', 6000); dev.say('Uy, lo reviso 🔧', 3000); }, 1200),
          });
        } else {
          a.setState('blocked', 6000);
          a.shakeUntil = now + 700;
          a.say(ev.text, 5000, 'error');
          emit(a.x, a.y - 40, 14, 'spark', '#ff4d4d');
          if (ev.role !== 'tl') visit(agents.tl, ev.role, '¿Te ayudo con ese error? 🔍', { stay: 2200 });
          else agents.tl.say('Mmm, a revisar esto… 🔍', 4000);
        }
        break;
      case 'subagent_start': {
        if (!a) break;
        a.badges.set(ev.subId, ev.text);
        const m = agents.manager;
        const line = `${a.cfg.name}, te encargo: ${ev.text}`;
        if (ev.role !== 'manager') visit(m, ev.role, line, { carry: true, after: () => work(a, `Subtarea: ${ev.text}`, 'working', 7000) });
        else work(a, `Subtarea: ${ev.text}`);
        break;
      }
      case 'subagent_end':
        if (!a) break;
        a.badges.delete(ev.subId);
        a.setState('done', 2500);
        a.jumpUntil = now + 900;
        a.say(`✔ Listo: ${ev.text}`);
        emit(a.x, a.y - 60, 12, 'confetti');
        break;
      case 'waiting':
        agents.manager.handUp = true;
        agents.manager.setState('waiting', 60_000);
        agents.manager.say('¡Necesitamos tu OK! ✋', 8000, 'warn');
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
        agents.manager.say('Cerramos por hoy 👋');
        break;
      case 'chat': {
        banner = { text: `💬 ${ev.from}: ${ev.text}`, tone: 'chat', until: now + 7000 };
        const who = a || agents.po;
        who.say(P(['¡Anotado! 📝', 'Lo vemos en la daily 👍', 'Entendido 🙌', '¡Buena idea!']), 3500);
        break;
      }
      case 'poke':
        if (!a) break;
        a.jumpUntil = now + 700;
        a.say(`${ev.from} te saluda 👋`, 2500);
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
        if (a) a.say(ev.text || '✔ Termino mi turno', 2500);
        break;
    }
    // Cualquier evento de agente quita el aviso de espera (ya se respondió).
    if (!['waiting', 'chat', 'poke'].includes(ev.kind)) {
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
      if (atDesk && !from.away) visit(from, a.id, `${a.cfg.name}, te toca: ${ph.label}`, { carry: true, stay: 1200 });
      else from.say(`→ ${a.cfg.name}: ${ph.label}`, 2500);
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
        if (a.id !== 'manager') visit(agents.manager, a.id, '¿Qué te bloquea? 🔓', { stay: 2200 });
        break;
      case 'release':
        celebrate(`🚀 Release${ev.text ? `: ${ev.text}` : ''}`);
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

  function celebrate(text) {
    const now = simNow;
    celebrateUntil = now + 9000;
    banner = { text: `🎉 ${text}`, tone: 'done', until: now + 6000 };
    emit(W / 2, -10, 160, 'confetti');
    Object.values(agents).forEach((a, i) => {
      a.badges.clear();
      a.setState('done', 8000);
      a.handUp = false;
      if (a.queue.length > 4) return;
      const [dx, dy] = TABLE_SEATS[i];
      a.wait(i * 150).goTo({ x: SPOT.table.x + dx, y: SPOT.table.y + dy })
        .then((x) => { x.jumpUntil = simNow + 2500; if (i % 2 === 0) x.say(P(['¡Bien! 🎉', '¡Al fin!', '¡Deploy! 🚀', '¡Qué equipo!'])); })
        .wait(4200).goHome();
    });
  }

  // ---------------------------------------------------------------- la cabeza de cada uno

  const note = (kind, who, extra = {}) => {
    journal.push({ t: simNow, kind, who, ...extra });
    if (journal.length > 300) journal = journal.slice(-300);
  };

  /** Saca a alguien de su conversación (porque le llegó algo urgente). */
  function interrupt(a) {
    if (!a.scene) return;
    const sc = a.scene;
    sc.lines = sc.lines.filter((l) => l.who !== a.id);
    sc.members = sc.members.filter((m) => m !== a.id);
    a.scene = null;
    if (!a.seated) { a.queue = []; a.goHome(); }
  }

  /**
   * Una conversación: los participantes van a `spot` (o se quedan sentados si es null) y
   * hablan por turnos. lines: [[quién, texto], …]
   */
  function scene(kind, members, lines, { spot = null, gap = 2300, after } = {}) {
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
    note(kind, members[0], { with: members.slice(1) });
    return sc;
  }

  /** Lo que se dice en el cotorreo: chismes de la oficina y lo que está pasando. */
  /** Alguien más se suma a la escena para responder; la escena dura hasta `end`. */
  function join(sc, id, lines, end) {
    sc.lines.push(...lines.map(([text, at]) => ({ who: id, text, at })));
    sc.end = Math.max(sc.end, end);
    if (!sc.members.includes(id)) { sc.members.push(id); agents[id].scene = sc; }
    for (const m of sc.members) agents[m].queue = agents[m].queue.map((j) => (j.t === 'until' ? { ...j, at: sc.end } : j));
  }

  function gossipLine(id) {
    const topics = [...GOSSIP[id] || REPLIES];
    if (memory.task) topics.push(`¿Ya vieron «${short(memory.task, 22)}»? 👀`);
    if (memory.lastError && simNow - memory.lastError.at < 120_000) topics.push(`${TEAM[memory.lastError.role].name} se peleó con un error 😬`);
    if (memory.lastGreen && simNow - memory.lastGreen.at < 120_000) topics.push(`¡${TEAM.qa.name} vio todo en verde! 🟢`);
    return P(topics);
  }

  function gossip(a) {
    const others = PRODUCT.filter((id) => id !== a.id && agents[id].free);
    if (!others.length) return false;
    const members = [a.id, ...others.slice(0, chance(0.5) ? 2 : 1)];
    const lines = [[a.id, gossipLine(a.id)], [members[1], P(REPLIES)]];
    if (members[2]) lines.push([members[2], P(REPLIES)]);
    if (chance(0.5)) lines.push([a.id, P([...REPLIES, gossipLine(a.id)])]);
    // sentadas juntas cotorrean desde el escritorio; a veces se juntan en el café o el sofá
    const spot = chance(0.55) ? null : P([{ x: SPOT.coffee.x - 60, y: SPOT.coffee.y + 4 }, SPOT.sofa, { x: 210, y: CORRIDOR_TOP + 4 }]);
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
    const sc = scene('idea', [a.id], [[a.id, `Marco, se nos ocurrió: ${P(IDEAS)}`]], { spot: { x: TEAM.manager.seat.x - 70, y: TEAM.manager.seat.y - 6 } });
    a.queue.splice(1, 0, { t: 'fn', fn: (x) => { x.carry = false; } });
    const at = sc.lines[0].at + 2200;
    join(sc, 'manager', [[P(['¡Me gusta! Al backlog 📝', 'Lo vemos en la planning 🗂️', 'Anotado, después lo priorizamos 📌']), at]], at + 900);
  }

  function imagine(a) {
    const kind = chance(0.5) ? 'unicorn' : 'rainbow';
    a.dream = { kind, start: simNow, until: simNow + 4800 };
    a.jumpUntil = simNow + 1100;
    a.say(P(DREAM_LINES[kind]), 4200);
    emit(a.x, a.y - 80, 10, 'sparkle', kind === 'unicorn' ? '#ff7eb6' : null);
    a.mind.inspiration = -R(0, 0.6);
    note('dream', a.id, { dream: kind });
  }

  function consultTL(a) {
    const tl = agents.tl;
    if (tl.scene || tl.away) return false;
    // si está haciendo algo concreto ("Editando api.js") lo cuenta: "estoy editando api.js: …"
    const doing = /^[A-ZÁÉÍÓÚ][a-záéíóú]+ndo\b/.test(a.text || '') && chance(0.5) ? `estoy ${short(a.text, 26).replace(/^./, (c) => c.toLowerCase())}: ` : '';
    const topic = doing;
    const sc = scene('consult', [a.id], [[a.id, `Tomás, ${topic}${P(ASK[a.id])}`]], { spot: { x: tl.cfg.seat.x + 62, y: tl.cfg.seat.y - 6 } });
    const at = sc.lines[0].at;
    join(sc, 'tl', [[P(ANSWER), at + 2300]], at + 5300);
    sc.lines.push({ who: a.id, text: P(THANKS), at: at + 4600 });
    a.mind.doubt = -R(0, 0.5);
    return true;
  }

  function rounds(m) {
    const busy = TECH.filter((id) => agents[id].seated && ['working', 'thinking'].includes(agents[id].state) && !agents[id].scene);
    if (!busy.length) return false;
    const who = agents[P(busy)];
    const sc = scene('rounds', ['manager'], [['manager', P([`¿Cómo vas, ${who.cfg.name}?`, `${who.cfg.name}, ¿necesitas algo?`, `¿Todo bien por aquí, ${who.cfg.name}?`])]],
      { spot: { x: who.cfg.seat.x + 62, y: who.cfg.seat.y - 6 } });
    const at = sc.lines[0].at + 2200;
    join(sc, who.id, [[P(['Bien, avanzando 💪', 'Todo bajo control 👍', 'Un poco trabado, pero sale 😅', 'Casi listo 🙌']), at]], at + 800);
    m.mind.rounds = -R(0, 0.6);
    return true;
  }

  function coffee(a) {
    if (Object.values(agents).some((o) => o !== a && o.scene?.kind === 'coffee')) return false; // de a uno al café
    scene('coffee', [a.id], [[a.id, P(['☕', 'Mmm, café…', '🎵', '¿Alguien quiere café?', 'Pausa activa 🙆'])]], { spot: { x: SPOT.coffee.x - R(0, 30), y: SPOT.coffee.y } });
    a.state = 'coffee'; a.stateUntil = simNow + 9000;
    a.mind.coffee = -R(0, 0.4);
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
    po.say(`¡Llegó un requerimiento! «${short(text, 40)}»`, 3600);
    po.setState('talking', 9000);
    if (pod[0]) agents[pod[0]].wait(900).then((x) => x.say(x.id === 'designer' && targets.includes('designer') ? '¡Yo hago los mockups! 🎨' : x.id === 'analyst' ? 'Lo analizo 🧐' : '¡Vamos! ✨', 2800));
    note('requirement', 'po', { with: ['manager'], text, to: targets });
    // la PO le lleva la tarjeta a Marco
    po.queue = [];
    po.carry = true;
    po.wait(1400).goTo({ x: m.cfg.seat.x - 70, y: m.cfg.seat.y - 6 })
      .then((p) => {
        p.carry = false;
        p.say(`Marco, nuevo requerimiento: ${short(text, 60)}`, 3800);
        // Marco lo reparte a su equipo según la tarea
        m.queue = [];
        m.wait(1800).then((x) => { x.say(`¡Va! Esto es para ${targets.map((r) => TEAM[r].name).join(' y ')} 📨`, 3000); x.setState('working', 6000); });
        for (const r of targets) {
          const t = agents[r];
          m.then((x) => { x.carry = true; }).goTo({ x: t.cfg.seat.x + 62, y: t.cfg.seat.y - 6 })
            .then((x) => { x.carry = false; x.say(`${t.cfg.name}, esto es para ti: ${short(text, 50)}`, 3600); note('assign', 'manager', { with: [r], text }); })
            .wait(2000)
            .then(() => { t.say(P(['¡Voy! 💪', 'Dale, lo tomo 🙌', 'Me pongo con eso ⌨️']), 2600); t.lastActive = simNow; });
        }
        m.goHome();
      })
      .wait(2200).goHome();
  }

  /** Cada tanto, cada personaje decide qué hacer según sus necesidades y su personalidad. */
  function brain(a, dt) {
    const mind = a.mind, pers = PERSONALITY[a.id];
    // las necesidades crecen con el tiempo
    if (a.free && a.state !== 'working') mind.social += dt / pers.social;
    mind.coffee += dt / pers.coffee;
    if (pers.doubt && a.seated && ['working', 'thinking'].includes(a.state)) mind.doubt += dt / pers.doubt;
    if (pers.inspiration) mind.inspiration += dt / pers.inspiration;
    if (pers.rounds && a.free) mind.rounds += dt / pers.rounds;

    if (simNow < mind.nextThink) return;
    mind.nextThink = simNow + R(1200, 2600);
    if (a.dream && simNow > a.dream.until) a.dream = null;
    if (simNow < celebrateUntil) return;

    // la diseñadora se inspira hasta trabajando: salta e imagina
    if (pers.inspiration && mind.inspiration >= 1 && !a.walking && !a.dream) return imagine(a);
    // los técnicos, trabajando, a veces se paran a consultar al Tech Lead
    if (pers.doubt && mind.doubt >= 1 && a.seated && !a.queue.length && !a.scene) { if (consultTL(a)) return; }
    if (!a.free) return;
    if (PRODUCT.includes(a.id) && mind.social >= 1) { if (gossip(a)) return; mind.social = 0.6; }
    if (pers.rounds && mind.rounds >= 1 && a.state === 'idle') { if (rounds(a)) return; mind.rounds = 0.5; }
    if (mind.coffee >= 1 && a.state === 'idle' && a.badges.size === 0) coffee(a);
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
      if (a.dream && random() < dt * 3) emit(a.x + R(-20, 20), a.y - R(90, 130), 1, 'sparkle', a.dream.kind === 'unicorn' ? '#ff7eb6' : P(RAINBOW_COLORS));
    }
    runScenes();
    if (now < celebrateUntil && random() < dt * 8) emit(R(0, W), -10, 3, 'confetti');
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark') p.vy += 140 * dt;
      if (p.kind === 'emote') p.vy = -22;
      p.rot += dt * 6;
    }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 20);
    if (banner && now > banner.until) banner = null;
  }

  return {
    agents,
    handle,
    step,
    get board() { return board; },
    get banner() { return banner; },
    get particles() { return particles; },
    get turn() { return turn; },
    get turnPhase() { return turnPhase; },
    get journal() { return journal; },
    get scenes() { return scenes; },
    setBoard(session) {
      if (session && 'turn' in session) { turn = session.turn; turnPhase = session.phase; } // el servidor manda
      board = session ? { title: session.title, todos: session.todos || [], status: session.status, source: session.source } : { title: '', todos: [] };
      if (board.title) memory.task = board.title;
    },
    reset() {
      for (const a of Object.values(agents)) Object.assign(a, { queue: [], seated: true, x: a.cfg.seat.x, y: a.cfg.seat.y, state: 'idle', bubble: null, handUp: false, history: [], dream: null, scene: null, carry: false }), a.badges.clear();
      banner = null; particles = []; board = { title: '', todos: [] }; turn = turnPhase = lastDev = lastBlocked = null;
      scenes = []; memory.task = ''; memory.lastError = memory.lastGreen = null;
    },
  };
}
