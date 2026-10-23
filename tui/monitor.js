// The activity monitor: what the terminal shows inside herdr, instead of the game. At the top, how
// many agents, subagents, panes and tasks are running; in the middle, each agent (each session) with
// its task and what it is doing, and its subagents below; at the end, the log. The game is still at
// hand: in the browser (o) or in this terminal (g).
//
// It works with the office in the same process (localFeed) or watching one that is already running (remoteFeed).

import { DEFAULT_TEAM, phaseInfo } from '../public/sim.js';
import { t, timeOf, setLanguage } from '../public/i18n.js';
import { AGENT_NAME } from '../public/targets.js';
import { fit, strWidth } from './screen.js';
import { activityLine } from './console.js';
import { roleStatus } from '../server/office.js';
import { ROLE_ICON } from '../server/subpanes.js';

const ESC = '\x1b[';
const ENTER = `${ESC}?1049h${ESC}?25l`;
const LEAVE = `${ESC}0m${ESC}?25h${ESC}?1049l`;
const LOG_MAX = 400;
const RECENT_MS = 30 * 60_000; // a finished session is still shown for half an hour
const SUB_RECENT_MS = 60_000;  // a finished subagent, for a minute
const STATUS_ICON = { active: '●', waiting: '✋', done: '✔', ended: '○' };
const TONE = { err: '#ef476f', ok: '#06d6a0', warn: '#ffd166', info: '#8ecae6', accent: '#ffd166', dim: null };

/** How long ago: 12s, 3m, 2h. */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

const project = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';

/** The monitor's state: fed with the office's snapshot and events. */
export function createMonitor() {
  const m = {
    office: null, offices: [], sessions: new Map(), roles: {}, tasks: [], herdr: null, appearance: {},
    log: [], last: new Map(), subLast: new Map(), connection: { ok: false, key: 'conn.connecting' }, flash: null,
  };
  const person = (role) => ({ ...DEFAULT_TEAM[role], ...(m.appearance?.[role] || {}) });

  function remember(ev) {
    if (!ev?.session || ev.session === 'office') return;
    const doing = ['tool_start', 'tool_end', 'phase', 'thinking', 'waiting', 'error', 'task', 'subagent_start', 'subagent_end', 'done', 'turn_end'].includes(ev.kind);
    if (!doing) return;
    const what = { kind: ev.kind, role: ev.role, text: ev.kind === 'thinking' ? t('follow.thinking') : ev.text, phase: ev.phase, ok: ev.ok, ts: ev.ts || Date.now() };
    if (ev.subId && !['subagent_start', 'subagent_end'].includes(ev.kind)) m.subLast.set(`${ev.session}\n${ev.subId}`, what);
    else m.last.set(ev.session, what);
  }
  function addLog(ev) {
    const a = activityLine(ev);
    if (!a) return;
    const p = ev.role ? person(ev.role) : null;
    m.log.push({ ts: ev.ts || Date.now(), who: a.speaker ?? (p?.name || t('events.office')), shirt: a.speaker ? null : p?.shirt, text: a.text, tone: a.tone });
    if (m.log.length > LOG_MAX) m.log.splice(0, m.log.length - LOG_MAX);
  }

  return {
    model: m,
    person,
    snapshot(st) {
      m.office = st.office || m.office;
      m.offices = st.offices || m.offices;
      m.appearance = st.appearance || {};
      m.roles = Object.fromEntries(Object.entries(st.roles || {}).map(([k, r]) => [k, { ...r }]));
      m.sessions = new Map((st.sessions || []).filter((s) => s && s.id !== 'office').map((s) => [s.id, s]));
      m.tasks = st.tasks || [];
      m.herdr = st.herdr || m.herdr;
      m.log = []; m.last.clear(); m.subLast.clear();
      for (const ev of st.log || []) { remember(ev); addLog(ev); }
    },
    event(ev, session) {
      if (session?.id && session.id !== 'office') m.sessions.set(session.id, session);
      // as in the office: announcements (dispatch, panes) and side questions do not change
      // any role's state (roleStatus returns null for them).
      if (ev.role && m.roles[ev.role] && !['chat', 'poke', 'btw'].includes(ev.kind)) {
        const status = roleStatus(ev);
        if (status) m.roles[ev.role] = { ...m.roles[ev.role], status, text: ev.text, ts: ev.ts, session: ev.session };
      }
      if (ev.kind === 'session_end') for (const r of Object.values(m.roles)) if (r.session === ev.session && r.status !== 'done') r.status = 'idle';
      remember(ev);
      addLog(ev);
    },
    tasks(snap) { m.tasks = snap?.tasks || []; },
    herdr(st) { m.herdr = st; },
    log(entry) { m.log.push({ ts: entry.ts || Date.now(), who: '', text: entry.text, tone: 'dim' }); if (m.log.length > LOG_MAX) m.log.shift(); },
    /** The sessions shown: the ones still going (or that finished recently), the most recent on top. */
    visible(now = Date.now()) {
      const rank = { waiting: 0, active: 1, done: 2, ended: 3 };
      return [...m.sessions.values()]
        .filter((s) => ['active', 'waiting'].includes(s.status) || now - (s.lastAt || 0) < RECENT_MS)
        .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (b.lastAt || 0) - (a.lastAt || 0));
    },
    counts(now = Date.now()) {
      const live = [...m.sessions.values()].filter((s) => ['active', 'waiting'].includes(s.status));
      return {
        agents: live.length,
        waiting: live.filter((s) => s.status === 'waiting').length,
        subagents: [...m.sessions.values()].reduce((n, s) => n + (s.subagents || []).filter((x) => x.open).length, 0),
        panes: (m.herdr?.panes || []).length,
        tasks: m.tasks.filter((x) => ['running', 'sent', 'queued'].includes(x.status)).length,
        working: Object.values(m.roles).filter((r) => r.status && r.status !== 'idle' && r.status !== 'done' && now - (r.ts || 0) < 10 * 60_000).length,
      };
    },
  };
}

/**
 * Draws the monitor: returns exactly `rows` lines (with colors if `color`).
 * @param info { version, url, local }  what is shown in the header
 */
export function renderMonitor(mon, { cols = 100, rows = 30, color = true, colorMode = '256', now = Date.now(), info = {} } = {}) {
  const m = mon.model;
  const paint = (hex) => {
    if (!color || !hex) return '';
    const n = parseInt(String(hex).replace('#', ''), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (colorMode === 'truecolor') return `${ESC}38;2;${r};${g};${b}m`;
    const q = (v) => Math.round((v / 255) * 5);
    return `${ESC}38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
  };
  const c = (code) => (color ? `${ESC}${code}m` : '');
  const B = c(1), D = c(2), R = c(0);
  const zone = m.office?.timezone;
  // a line made of pieces [text, style]: it is trimmed to the width without cutting a color in half
  const row = (...parts) => {
    let out = '', w = 0;
    for (const [text, style = ''] of parts) {
      if (w >= cols) break;
      const piece = fit(String(text ?? ''), cols - w);
      if (!piece) continue;
      out += `${style}${piece}${style ? R : ''}`;
      w += strWidth(piece);
    }
    return out;
  };
  const rule = (label) => row([`${label ? `─ ${label} ` : ''}${'─'.repeat(cols)}`, D]);
  const lines = [];

  // ---- header and figures ----
  const officeName = m.office?.name || t('offices.main');
  const herdr = m.herdr?.available ? `herdr ${m.herdr.pane || ''}`.trim() : t('monitor.noHerdr');
  const conn = m.connection.ok ? '' : `  ${t(m.connection.key, m.connection.vars || {})}`;
  lines.push(row(['▣ DEV TEAM OFFICE', `${B}${paint('#ffd166')}`], [` ${info.version || ''}  `, D], [`🏢 ${officeName}`, B], [`  ${info.url || ''}  `, ''], [herdr, D], [conn, paint(TONE.err)], [`  ${timeOf(now, zone, { seconds: true })}`, D]));
  const n = mon.counts(now);
  lines.push(row(
    ['  ● ', paint(n.agents ? TONE.ok : null)], [t('monitor.agents', { n: n.agents }), B],
    ...(n.waiting ? [['  ✋ ', paint(TONE.warn)], [t('monitor.waiting', { n: n.waiting }), B]] : []),
    ['   🤖 ', ''], [t('monitor.subagents', { n: n.subagents }), B],
    ['   👥 ', ''], [t('monitor.working', { n: n.working }), B],
    ['   🪟 ', ''], [t('monitor.panes', { n: n.panes }), B],
    ['   📨 ', ''], [t('monitor.tasks', { n: n.tasks }), B],
  ));

  // ---- the agents and their subagents ----
  const agentRows = [];
  for (const s of mon.visible(now)) {
    const last = m.last.get(s.id);
    const ended = s.status === 'done' || s.status === 'ended';
    const icon = STATUS_ICON[s.status] || '●';
    const tone = s.status === 'waiting' ? TONE.warn : s.status === 'active' ? TONE.ok : null;
    const who = last?.role ? mon.person(last.role) : null;
    const doing = last ? `${who?.name ? `${who.name}: ` : ''}${last.phase && last.kind === 'phase' ? `${phaseInfo(last.phase).icon} ` : ''}${last.text || ''}` : '';
    const name = `${AGENT_NAME[s.source] || s.source || '?'} · ${project(s.cwd) || s.id}`;
    agentRows.push(row(
      [` ${icon} `, paint(tone)], [fit(name, 24).padEnd(25), ended ? D : B],
      [fit(t(`sessionStatus.${s.status}`) || s.status, 11).padEnd(12), ended ? D : paint(tone)],
      [fit(s.title || t('tui.noTaskYet'), Math.max(10, Math.floor(cols * 0.32))).padEnd(Math.max(10, Math.floor(cols * 0.32)) + 1), ended ? D : ''],
      [doing ? `▸ ${doing}` : '', ended ? D : paint(TONE.info)],
      [`  ${ago(now - (s.lastAt || now))}`, D],
    ));
    const subs = (s.subagents || []).filter((x) => x.open || now - (x.endedAt || 0) < SUB_RECENT_MS);
    subs.forEach((x, i) => {
      const p = mon.person(x.role);
      const sl = m.subLast.get(`${s.id}\n${x.id}`);
      const branch = i === subs.length - 1 ? '└' : '├';
      const ph = x.phase ? `${phaseInfo(x.phase).icon} ` : '';
      agentRows.push(row(
        [`   ${branch} `, D], [`${ROLE_ICON[x.role] || '🤖'} `, ''], [fit(`${p.name || x.role}`, 10).padEnd(11), x.open ? `${B}${paint(p.shirt)}` : D],
        [fit(x.agentType || '', 14).padEnd(15), D], [fit(`${ph}${x.desc || ''}`, Math.max(10, Math.floor(cols * 0.3))).padEnd(Math.max(10, Math.floor(cols * 0.3)) + 1), x.open ? '' : D],
        [x.open ? (sl?.text ? `▸ ${sl.text}` : `💭 ${t('follow.thinking')}`) : `✔ ${t('monitor.subDone')}`, x.open ? paint(sl && !sl.ok && sl.kind === 'tool_end' ? (sl.phase === 'red' ? TONE.warn : TONE.err) : TONE.info) : paint(TONE.ok)],
        [`  ${ago(now - (x.open ? x.startedAt : x.endedAt || now))}`, D],
      ));
    });
  }
  if (!agentRows.length) agentRows.push(row([`  ${t('monitor.none')}`, D]));

  // ---- the team: who is doing something ----
  const busy = Object.entries(m.roles).filter(([, r]) => r.status && r.status !== 'idle' && now - (r.ts || 0) < 10 * 60_000);
  const teamParts = busy.length
    ? busy.flatMap(([role, r], i) => [[i ? ' · ' : '  ', D], [`${mon.person(role).name || role}`, `${B}${paint(mon.person(role).shirt)}`], [` ${t(`state.${r.status}`) || r.status}`, paint(r.status === 'red' || r.status === 'blocked' ? TONE.err : r.status === 'waiting' ? TONE.warn : null)]])
    : [[`  ${t('monitor.teamIdle')}`, D]];

  // ---- splitting the height ----
  const footer = row(['  ', ''], [t('monitor.keys', { quit: info.local ? t('monitor.quitOffice') : t('monitor.quit') }), D], ...(m.flash ? [[`   ${m.flash}`, paint(TONE.accent)]] : []));
  const fixed = lines.length + 1 /* regla agentes */ + 1 /* equipo */ + 1 /* log rule */ + 1 /* pie */;
  const room = Math.max(0, rows - fixed);
  const agentsMax = Math.max(1, Math.min(agentRows.length, Math.floor(room * 0.5)));
  lines.push(rule(t('monitor.agentsTitle')));
  const shown = agentRows.slice(0, agentsMax);
  if (agentRows.length > agentsMax) shown[agentsMax - 1] = row([`  … ${t('monitor.more', { n: agentRows.length - agentsMax + 1 })}`, D]);
  lines.push(...shown);
  lines.push(row([`  ${t('tui.team')}`, B], ...teamParts));
  lines.push(rule(t('tui.log')));
  const logRoom = Math.max(0, rows - lines.length - 1);
  const logs = m.log.slice(-logRoom).map((l) => row(
    [`  ${timeOf(l.ts, zone, { seconds: true })}  `, D],
    ...(l.who ? [[fit(l.who, 10).padEnd(11), `${B}${paint(l.shirt)}`]] : []),
    [l.text, l.tone ? (l.tone === 'dim' ? D : paint(TONE[l.tone])) : ''],
  ));
  lines.push(...logs);
  while (lines.length < rows - 1) lines.push('');
  lines.length = Math.max(0, rows - 1);
  lines.push(footer);
  return lines;
}

/**
 * The full-screen monitor. Resolves when the user leaves (q or ctrl+c).
 * @param feed      localFeed(server) or remoteFeed(url) (tui/feeds.js)
 * @param onGame    () => Promise: opens the game in this terminal (g); on leaving, the monitor comes back
 * @param onBrowser () => void: opens the game in the browser (o)
 * @param server    with the office in this process: its notices (herdr panes, weather…) go to the log
 */
export function runMonitor({ feed, stdin = process.stdin, stdout = process.stdout, colorMode = '256', onGame, onBrowser, server, info = {} }) {
  return new Promise((resolve) => {
    const mon = createMonitor();
    const tty = !!(stdin.isTTY && stdout.isTTY);
    let paused = false, dirty = true, timer = null, flashTimer = null, done = false;
    const draw = () => {
      if (paused || !tty) return;
      const lines = renderMonitor(mon, { cols: stdout.columns || 100, rows: stdout.rows || 30, colorMode, info });
      stdout.write(`${ESC}H${lines.map((l) => `${l}${ESC}0m${ESC}K`).join('\r\n')}`);
      dirty = false;
    };
    const flash = (text) => { mon.model.flash = text; dirty = true; clearTimeout(flashTimer); flashTimer = setTimeout(() => { mon.model.flash = null; dirty = true; }, 3000); };
    const onLog = (entry) => { mon.log(entry); dirty = true; };
    feed.start({
      onStatus(st) { mon.model.connection = st; dirty = true; },
      onSnapshot(st) { mon.snapshot(st); dirty = true; },
      onEvent(ev, session) { mon.event(ev, session); dirty = true; },
      onTasks(snap) { mon.tasks(snap); dirty = true; },
      onPipelines() {},
      onHerdr(st) { mon.herdr(st); dirty = true; },
      onAppearance(a) { mon.model.appearance = a || {}; dirty = true; },
      onOffices(list, current) { mon.model.offices = list || []; if (current) mon.model.office = current; dirty = true; },
      onPrefs(p) { if (p?.lang) setLanguage(p.lang); dirty = true; },
      onError(err) { flash(`✖ ${err}`); },
    });
    server?.bus.on('log', onLog);

    function onKey(data) {
      const s = String(data);
      if (s === '\x1b[C' || s === '\x1b[D') {
        const list = mon.model.offices;
        if (list.length > 1) {
          const i = list.findIndex((o) => o.id === mon.model.office?.id);
          const next = list[(i + (s === '\x1b[C' ? 1 : -1) + list.length) % list.length];
          feed.send({ type: 'view', office: next.id });
        }
        return;
      }
      for (const k of s) {
        if (k === '\x03' || k === 'q' || k === 'Q') return quit();
        if ((k === 'o' || k === 'O') && onBrowser) { onBrowser(); flash(t('console.opening', { url: info.url || '' })); }
        if ((k === 'g' || k === 'G') && onGame) return game();
      }
    }
    const listen = () => { if (!tty) return; stdin.setRawMode(true); stdin.setEncoding('utf8'); stdin.on('data', onKey); stdin.resume(); };
    const unlisten = () => { if (!tty) return; stdin.off('data', onKey); stdin.setRawMode(false); };
    const onResize = () => { dirty = true; if (tty) stdout.write(`${ESC}2J`); };

    async function game() {
      if (paused) return;
      paused = true;
      unlisten();
      stdout.write(LEAVE);
      try { await onGame(); } finally {
        paused = false;
        if (!done) { stdout.write(`${ENTER}${ESC}2J`); listen(); dirty = true; }
      }
    }
    function quit() {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(flashTimer);
      unlisten();
      stdin.pause();
      stdout.off?.('resize', onResize);
      server?.bus.off('log', onLog);
      if (tty) stdout.write(LEAVE);
      resolve();
    }

    if (tty) stdout.write(`${ENTER}${ESC}2J`);
    stdout.on?.('resize', onResize);
    listen();
    // it redraws when something changes (at most 8 times per second) and every second (the clock, the "ago")
    let tick = 0;
    timer = setInterval(() => { tick++; if (dirty || tick % 8 === 0) draw(); }, 125);
    timer.unref?.();
    draw();
    for (const sig of ['SIGTERM', 'SIGHUP']) process.once(sig, quit);
    if (!tty) process.once('SIGINT', quit);
  });
}
