// La oficina en la terminal: bucle de dibujo, teclado, ratón y el modelo del panel lateral.

import { createSim, TEAM, applyAppearance } from '../public/sim.js';
import { Screen, detectColorMode } from './screen.js';
import { computeLayout, drawFrame, agentAtCell, boardAtCell } from './view.js';
import { briefOptions, briefFields, briefCycle, briefProblem, briefMessage, defaultProject } from '../public/brief.js';
import { createSettings } from './settings.js';

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h'; // pantalla alternativa, sin cursor, ratón SGR
const LEAVE = '\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l';
const OFFICE_SESSION = 'office'; // chat y saludos, no es una sesión de agente
const ROLES = Object.keys(TEAM);
const FPS = 20;

export function runTui({ feed, endpoints = [], colorMode = detectColorMode(), notice, stdin = process.stdin, stdout = process.stdout }) {
  return new Promise((resolve) => {
    const sim = createSim();
    const scr = new Screen({ colorMode });
    const sessions = new Map();
    const model = {
      selected: null, chat: null, status: null, log: [], session: null, sessions, connection: { ok: false, label: 'conectando…' }, endpoints,
      tasks: { tasks: [], agents: [], launchers: [], defaultCwd: '' },
      pipelines: [],
      projects: [], // los que anuncian los agentes conectados (con sus pipelines)
      brief: null, // el diálogo de la pizarra mientras está abierto
      settings: null, // ⚙ Ajustes mientras está abierto
    };
    let L;
    let active = true;

    const flash = (text, ms = 3500) => { model.status = { text, until: performance.now() + ms }; };
    const refreshSession = () => {
      model.session = [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt)[0] || null;
      sim.setBoard(model.session);
    };

    feed.start({
      onSnapshot(state) {
        sim.reset();
        sessions.clear();
        for (const s of state.sessions) if (s.id !== OFFICE_SESSION) sessions.set(s.id, s);
        model.log = state.log.slice().reverse().slice(0, 200);
        refreshSession();
      },
      onEvent(ev, session) {
        if (session && session.id !== OFFICE_SESSION) sessions.set(session.id, session);
        sim.handle(ev);
        refreshSession();
        model.log.unshift(ev);
        if (model.log.length > 200) model.log.pop();
      },
      onStatus(st) { model.connection = st; },
      onTasks(snap) { model.tasks = snap; },
      onPipelines(runs, projects) { model.pipelines = runs || []; if (projects) model.projects = projects; },
      onAppearance(a) { applyAppearance(a); },
      onError(err) { flash(`No se pudo: ${err}`, 6000); },
    });
    if (notice) flash(notice, 8000);

    const resize = () => {
      const cols = stdout.columns || 100, rows = stdout.rows || 30;
      scr.resize(cols, rows);
      L = computeLayout(cols, rows);
    };

    const send = (msg, ok) => {
      const out = feed.send(msg);
      flash(out?.ok === false ? `No se pudo: ${out.error}` : ok);
    };

    function select(delta) {
      const i = model.selected ? ROLES.indexOf(model.selected) : delta > 0 ? -1 : 0;
      model.selected = ROLES[(i + delta + ROLES.length) % ROLES.length];
    }

    // ---- diálogo "Nuevo encargo" (t, o clic en la pizarra) ----
    function openBrief() {
      model.brief = { field: 'task', sel: { project: defaultProject(model.projects, sessions.values()), pipeline: 0, target: 0 }, text: '', error: '' };
    }

    function openSettings() {
      model.brief = null;
      model.settings = createSettings({ http: feed.http });
    }

    function briefKey(k) {
      const b = model.brief;
      const opts = briefOptions({ projects: model.projects, tasks: model.tasks, sessions: sessions.values() }, b.sel);
      const fields = briefFields(opts);
      const i = Math.max(0, fields.indexOf(b.field));
      if (!fields.includes(b.field)) b.field = 'task';
      if (k === 'esc') { model.brief = null; return; }
      if (k === '\t' || k === 'down') { b.field = fields[(i + 1) % fields.length]; return; }
      if (k === 'shift-tab' || k === 'up') { b.field = fields[(i - 1 + fields.length) % fields.length]; return; }
      if (k === 'left' || k === 'right') {
        if (b.field !== 'task') b.sel = briefCycle(b.sel, b.field, k === 'right' ? 1 : -1, { projects: model.projects, opts });
        b.error = '';
        return;
      }
      if (k === '\r' || k === '\n') {
        const problem = briefProblem(opts, b.text);
        if (problem) { b.error = problem; return; }
        model.brief = null;
        send(briefMessage(opts, b.text, 'Terminal'), opts.pipeline ? `Pipeline «${opts.pipeline.name}» en marcha` : `Tarea enviada · ${opts.target.label}`);
        return;
      }
      if (k === '\x7f' || k === '\b') b.text = [...b.text].slice(0, -1).join('');
      else if (k.length <= 2 && k >= ' ' && [...b.text].length < 2000) b.text += k;
      else return;
      b.field = 'task'; // escribir siempre va a la tarea
      b.error = '';
    }

    function key(k) {
      if (k === '\x03') return quit(); // Ctrl+C siempre sale
      if (model.settings) { if (model.settings.key(k) === 'close') model.settings = null; return; }
      if (model.brief) return briefKey(k);
      if (model.chat !== null) {
        if (k === 'esc') model.chat = null;
        else if (k === '\r' || k === '\n') {
          const text = model.chat.trim();
          model.chat = null;
          if (text) send({ type: 'chat', text, role: model.selected || undefined, from: 'Terminal' }, 'Mensaje enviado');
        } else if (k === '\x7f' || k === '\b') model.chat = [...model.chat].slice(0, -1).join('');
        else if (k.length <= 2 && k >= ' ' && [...model.chat].length < 200) model.chat += k;
        return;
      }
      switch (k) {
        case 'q': case 'Q': return quit();
        case 'd': send({ type: 'command', action: 'demo' }, 'Demo de Claude Code en marcha'); break;
        case 'p': send({ type: 'command', action: 'demo-pi' }, 'Demo TDD (Pi) en marcha'); break;
        case 'r': send({ type: 'command', action: 'reset' }, 'Oficina reiniciada'); break;
        case '\t': case 'down': case 'right': select(1); break;
        case 'shift-tab': case 'up': case 'left': select(-1); break;
        case 'esc': model.selected = null; break;
        case 'm': model.chat = ''; break;
        case 't': openBrief(); break;
        case 'c': openSettings(); break;
        case 'x': {
          const run = [...model.pipelines].reverse().find((r) => r.status === 'running');
          if (run) { send({ type: 'pipeline_cancel', id: run.id }, `Cancelando el pipeline «${run.pipeline.name}»`); break; }
          const active = [...model.tasks.tasks].reverse().find((t) => ['running', 'queued', 'sent'].includes(t.status));
          if (active) send({ type: 'task_cancel', id: active.id }, `Cancelando: ${active.text}`);
          else flash('No hay tareas en curso');
          break;
        }
        case 's':
          if (model.selected) send({ type: 'poke', role: model.selected, from: 'Terminal' }, `Saludaste a ${TEAM[model.selected].name}`);
          else flash('Elige a alguien con tab o con un clic');
          break;
      }
    }

    function onInput(data) {
      let s = data;
      while (s.length) {
        let m;
        if ((m = s.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/))) {
          const [btn, col, row, press] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, m[4] === 'M'];
          if (press && btn === 0 && row === 0 && Math.abs(col - (L.gearCol + 1)) <= 1) openSettings();
          else if (press && btn === 0 && !model.brief && !model.settings) {
            const who = agentAtCell(L, sim, col, row);
            if (!who && boardAtCell(L, col, row)) openBrief();
            else model.selected = who;
          }
          s = s.slice(m[0].length);
          continue;
        }
        if (s.startsWith('\x1b[Z')) { key('shift-tab'); s = s.slice(3); continue; }
        if ((m = s.match(/^\x1b\[[0-9;?]*[A-Za-z~]/) || s.match(/^\x1bO./))) {
          const k = { A: 'up', B: 'down', C: 'right', D: 'left' }[m[0].at(-1)];
          if (k) key(k);
          s = s.slice(m[0].length);
          continue;
        }
        if (s[0] === '\x1b') { key('esc'); s = s.slice(1); continue; }
        const ch = String.fromCodePoint(s.codePointAt(0));
        key(ch);
        s = s.slice(ch.length);
      }
    }

    function restore() {
      if (!active) return;
      active = false;
      clearInterval(timer);
      stdout.off('resize', resize);
      stdin.off('data', onInput);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdout.write(LEAVE);
    }

    function quit() {
      restore();
      feed.close();
      resolve();
    }

    // Si algo revienta, la terminal tiene que quedar usable.
    process.once('exit', restore);
    for (const sig of ['SIGTERM', 'SIGHUP']) process.once(sig, () => { quit(); process.exit(0); });

    resize();
    stdout.on('resize', resize);
    stdout.write(ENTER);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onInput);
    stdin.resume();

    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        sim.step(dt, now);
        drawFrame(scr, L, sim, model, now);
        const out = scr.flush();
        if (out) stdout.write(out);
      } catch (err) {
        restore();
        feed.close();
        console.error(err);
        process.exit(1);
      }
    }, 1000 / FPS);
  });
}
