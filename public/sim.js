// Simulación de la oficina, sin dibujo: personajes, rutas, reacciones a eventos y partículas.
// La usan el render en canvas (navegador, game.js) y el render de terminal (tui/).
// Todas las coordenadas están en un mundo de W×H.

export const W = 960, H = 600;

export const TEAM = {
  designer: { name: 'Camila', title: 'Diseñadora', shirt: '#c86bfa', pants: '#3a2f45', hair: '#f2d16b', skin: '#f0c8a8', long: true, seat: { x: 110, y: 228 }, prop: 'tablet' },
  frontend: { name: 'Lucía', title: 'Frontend', shirt: '#ff7a45', pants: '#2d3a4f', hair: '#b8322a', skin: '#f5d0b0', long: true, seat: { x: 300, y: 228 }, prop: 'dual' },
  backend: { name: 'Diego', title: 'Backend', shirt: '#6b5bd6', pants: '#22222e', hair: '#151515', skin: '#b07a52', seat: { x: 490, y: 228 }, prop: 'terminal' },
  manager: { name: 'Marco', title: 'Manager', shirt: '#3f73f0', pants: '#2a2d3a', hair: '#8d8d8d', skin: '#e8b98f', seat: { x: 840, y: 228 }, prop: 'phone' },
  analyst: { name: 'Valentina', title: 'Analista de negocio', shirt: '#f0a73a', pants: '#2f3b52', hair: '#21160f', skin: '#c98e62', long: true, seat: { x: 110, y: 418 }, prop: 'chart' },
  tl: { name: 'Tomás', title: 'Tech Lead', shirt: '#22a68e', pants: '#26313a', hair: '#2b1b12', skin: '#d9a273', beard: true, seat: { x: 300, y: 418 }, prop: 'big' },
  qa: { name: 'Andrés', title: 'QA', shirt: '#8ac926', pants: '#2b3a2e', hair: '#3d2817', skin: '#e0ac7e', glasses: true, seat: { x: 490, y: 418 }, prop: 'qa' },
  po: { name: 'Sofía', title: 'Product Owner', shirt: '#e0607e', pants: '#3b3355', hair: '#5a3214', skin: '#f2c9a0', long: true, seat: { x: 840, y: 418 }, prop: 'notes' },
};

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
};
const TABLE_SEATS = [[-75, -40], [-25, -42], [25, -42], [75, -40], [-108, 0], [108, 0], [-100, 42], [100, 42]];
const CORRIDOR_TOP = 148, CORRIDOR_MID = 318, CORRIDOR_LOW = 462;
const LANES = [205, 395, 700]; // huecos entre escritorios por donde se cambia de pasillo
const DEVS = ['backend', 'frontend', 'designer'];
export const STATUS_ICON = { working: '💻', thinking: '💭', blocked: '❗', waiting: '✋', done: '🎉', coffee: '☕', talking: '💬', red: '🔴' };

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

class Agent {
  constructor(id, cfg) {
    this.id = id;
    this.cfg = cfg;
    this.x = cfg.seat.x; this.y = cfg.seat.y;
    this.seated = true;
    this.queue = [];
    this.state = 'idle';
    this.stateUntil = 0;
    this.text = '';
    this.bubble = null;
    this.badges = new Map(); // subagentes asignados: id → descripción
    this.walkT = 0;
    this.lastActive = performance.now() + Math.random() * 20_000;
    this.carry = false;
    this.jumpUntil = 0;
    this.shakeUntil = 0;
    this.handUp = false;
    this.history = [];
  }

  get away() { return !this.seated || this.queue.length > 0; }
  get walking() { return this.queue[0]?.t === 'walk'; }

  say(text, ms = 3800, tone) { this.bubble = { text, until: performance.now() + ms, tone }; }

  setState(state, ms = 6000) {
    this.state = state;
    this.stateUntil = performance.now() + ms;
    this.lastActive = performance.now();
  }

  goTo(pt) {
    const from = this.queue.findLast((j) => j.end)?.end || { x: this.x, y: this.y };
    this.queue.push({ t: 'walk', path: route(from, pt), end: { x: pt.x, y: pt.y } });
    return this;
  }
  wait(ms) { this.queue.push({ t: 'wait', ms }); return this; }
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
      const step = 120 * dt;
      if (d <= step) { this.x = target.x; this.y = target.y; job.path.shift(); }
      else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
      if (Math.abs(dx) > 1) this.face = Math.sign(dx);
      this.walkT += dt;
      if (!job.path.length) this.queue.shift();
    } else if (job.t === 'wait') {
      job.until ??= now + job.ms;
      if (now >= job.until) this.queue.shift();
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

export function createSim() {
  const agents = Object.fromEntries(Object.entries(TEAM).map(([id, cfg]) => [id, new Agent(id, cfg)]));
  let particles = [];
  let board = { title: '', todos: [], status: 'idle', source: '' };
  let banner = null; // { text, tone, until }
  let celebrateUntil = 0;
  let lastDev = null;
  let turn = null;   // rol "de turno" declarado por el agente
  let turnPhase = null;
  let lastBlocked = null;

  const log = (a, text) => {
    a.history.unshift({ ts: Date.now(), text });
    if (a.history.length > 40) a.history.pop();
  };

  function emit(x, y, n, kind, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y, kind, color: color || pick(['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c86bfa', '#ff7a45']),
        vx: kind === 'confetti' ? rand(-40, 40) : rand(-18, 18),
        vy: kind === 'confetti' ? rand(30, 90) : rand(-50, -25),
        life: kind === 'confetti' ? rand(2.5, 4.5) : rand(0.8, 1.4),
        ch: pick(CODE_GLYPHS), rot: rand(0, 6),
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
    const now = performance.now();
    if (a) log(a, ev.text);
    switch (ev.kind) {
      case 'session_start':
        agents.manager.say('¡Arrancamos! ☕');
        break;
      case 'task': {
        turn = turnPhase = null;
        const po = agents.po;
        board = { ...board, title: ev.text, todos: [] };
        po.setState('talking', 7000);
        if (!po.away) po.goTo(SPOT.board).then((p) => p.say(`Nueva tarea: ${ev.text}`, 5000)).wait(3200).goHome();
        else po.say(`Nueva tarea: ${ev.text}`, 5000);
        const ba = agents.analyst;
        if (!ba.away) {
          ba.wait(900).goTo({ x: SPOT.board.x - 60, y: SPOT.board.y })
            .then((b) => { b.say('Analizo el negocio 🧐'); b.setState('thinking', 5000); }).wait(2200).goHome();
        }
        break;
      }
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
        who.say(pick(['¡Anotado! 📝', 'Lo vemos en la daily 👍', 'Entendido 🙌', '¡Buena idea!']), 3500);
        break;
      }
      case 'poke':
        if (!a) break;
        a.jumpUntil = now + 700;
        a.say(`${ev.from} te saluda 👋`, 2500);
        break;
      case 'dispatch': {
        // Tarea enviada desde la oficina al agente: la PO se lleva la tarjeta a la pizarra.
        banner = { text: `📨 ${ev.text}`, tone: 'chat', until: now + 6000 };
        const po = agents.po;
        po.setState('talking', 5000);
        if (!po.away) {
          po.carry = true;
          po.goTo({ x: SPOT.board.x + 40, y: SPOT.board.y }).then((p) => { p.carry = false; p.say(`📨 ${ev.text}`, 4500); }).wait(2400).goHome();
        } else po.say(`📨 ${ev.text}`, 4500);
        break;
      }
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
        if (!a.away) a.goTo({ x: SPOT.board.x + rand(-60, 60), y: SPOT.board.y }).then((x) => x.say(line, 5000)).wait(3000).goHome();
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
    const now = performance.now();
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
        .then((x) => { x.jumpUntil = performance.now() + 2500; if (i % 2 === 0) x.say(pick(['¡Bien! 🎉', '¡Al fin!', '¡Deploy! 🚀', '¡Qué equipo!'])); })
        .wait(4200).goHome();
    });
  }

  function idleLife(a, now) {
    if (a.away || a.state !== 'idle' || a.badges.size || now - a.lastActive < 40_000) return;
    if (Object.values(agents).some((o) => o !== a && o.away)) return; // de a uno al café
    if (Math.random() > 0.002) return;
    a.lastActive = now;
    const dest = Math.random() < 0.6 ? { x: SPOT.coffee.x - rand(0, 30), y: SPOT.coffee.y } : { x: SPOT.table.x + rand(-80, 80), y: SPOT.table.y + 50 };
    a.goTo(dest).then((x) => { x.state = 'coffee'; x.stateUntil = performance.now() + 3000; x.say(pick(['☕', '¿Alguien vio el último PR?', 'Mmm, café…', '🎵'])); })
      .wait(3000).goHome();
  }

  /** Avanza la simulación `dt` segundos. Los renderers la llaman una vez por cuadro. */
  function step(dt, now = performance.now()) {
    for (const a of Object.values(agents)) {
      a.update(dt, now);
      idleLife(a, now);
      if (a.seated && a.state === 'working' && Math.random() < dt * 2.2) emit(a.cfg.seat.x + 34, a.cfg.seat.y - 50, 1, 'code', a.cfg.shirt);
    }
    if (now < celebrateUntil && Math.random() < dt * 8) emit(rand(0, W), -10, 3, 'confetti');
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark') p.vy += 140 * dt;
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
    setBoard(session) {
      if (session && 'turn' in session) { turn = session.turn; turnPhase = session.phase; } // el servidor manda
      board = session ? { title: session.title, todos: session.todos || [], status: session.status, source: session.source } : { title: '', todos: [] };
    },
    reset() {
      for (const a of Object.values(agents)) Object.assign(a, { queue: [], seated: true, x: a.cfg.seat.x, y: a.cfg.seat.y, state: 'idle', bubble: null, handUp: false, history: [] }), a.badges.clear();
      banner = null; particles = []; board = { title: '', todos: [] }; turn = turnPhase = lastDev = lastBlocked = null;
    },
  };
}
