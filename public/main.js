import { createGame, TEAM, phaseInfo } from './game.js';
import { applyAppearance, needsOf, DREAMS } from './sim.js';
import { AGENT_NAME, TASK_STATUS } from './targets.js';
import { briefOptions, briefProblem, briefMessage, defaultTarget, targetLabel } from './brief.js';
import { createSettings } from './settings-ui.js';
import { drawSprite } from './sprite.js';
import { season, isSouth, daylight, weatherIcon } from './sky.js';
import { t, setLanguage, onLanguage, getLanguage, timeOf } from './i18n.js';
import { countryName } from './clock.js';

const $ = (id) => document.getElementById(id);
const OFFICE_SESSION = 'office'; // chat, greetings and panes: not an agent session

const sessions = new Map();
let focus = null;      // session pinned by the user (null = the most recent)
let selected = null;
let ws;
let tasks = { tasks: [], agents: [], launchers: [], defaultCwd: '' };
let runs = [];
let targets = []; // registered agents (⚙ › Agents) and open sessions, with what their harness brings
let offices = []; // the company's offices (the selector, top left)
let office = null; // the one being watched: { id, name, timezone, country, city, … }
let prefs = null;  // the general settings (language, zone, weather, herdr, log)
let herdr = { available: false, panes: [] };

const game = createGame($('office'), { onSelect: (id) => select(id), onBoardClick: () => openBrief() });
const zone = () => office?.timezone || null;
const hhmm = (ts) => timeOf(ts, zone());

// ---------------------------------------------------------------- idioma

/** The HTML's fixed texts (data-i18n, -title, -aria, -ph) in the game's language. */
function applyI18n() {
  document.documentElement.lang = getLanguage();
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle);
  for (const e of document.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria));
  for (const e of document.querySelectorAll('[data-i18n-ph]')) e.placeholder = t(e.dataset.i18nPh);
}
onLanguage(() => {
  applyI18n();
  select(selected);
  renderSessions();
  renderTeam();
  renderOffices();
  renderWeather();
  onTasks(tasks);
  onRuns(runs);
  if ($('brief').open) renderBrief();
  settings.refresh?.(true);
});

// ---------------------------------------------------------------- socket

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/v1/ws`);
  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connect, 1500); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'snapshot') {
      const st = msg.state;
      if (st.prefs) onPrefs(st.prefs);
      onOffices(st.offices || [], st.office);
      onHerdr(st.herdr);
      onSnapshot(st);
      if (st.tasks) onTasks(st);
      onRuns(st.pipelines || []);
      onTargets(st.targets);
    }
    if (msg.type === 'prefs') onPrefs(msg.prefs);
    if (msg.type === 'offices') onOffices(msg.offices, msg.offices.find((o) => o.id === office?.id));
    if (msg.type === 'herdr') onHerdr(msg.herdr);
    if (msg.type === 'pipelines') onRuns(msg.runs);
    if (msg.type === 'targets') onTargets(msg.targets);
    if (msg.type === 'snapshot' || msg.type === 'appearance') { applyAppearance((msg.state || msg).appearance || {}); renderTeam(); renderSheet(true); }
    if (msg.type === 'snapshot' || msg.type === 'weather') { game.sim.setWeather((msg.state ? msg.state.weather : msg.weather) || null); renderWeather(); }
    if (msg.type === 'event') onEvent(msg.event, msg.session);
    if (msg.type === 'ask') onAsk(msg.ask);
    if (msg.type === 'tasks') onTasks(msg);
    if (msg.type === 'ack' && msg.ok === false) alertTask(msg.error);
    if (msg.type === 'ack' && msg.ok && msg.run) $('brief').close();
    if (msg.type === 'error') alertTask(msg.error);
  };
}
const send = (obj) => ws?.readyState === 1 && ws.send(JSON.stringify(obj));

function onPrefs(p) {
  prefs = p;
  term.life = !!p.log?.life;
  // the office view: front (the usual one) or isometric top-down, as saved in the settings
  game.setView(p.view?.mode === 'iso' ? 'iso' : 'flat');
  $('view-mode').setAttribute('aria-pressed', String(game.view === 'iso'));
  setLanguage(p.lang);
  settings?.refresh?.();
}

// ---------------------------------------------------------------- the offices

function onOffices(list, current) {
  offices = list || [];
  const changed = current && current.id !== office?.id;
  if (current) office = current;
  if (office) game.sim.setZone(office.timezone);
  renderOffices();
  if (changed) sysLine(t('ui.viewing', { name: office.name, tz: office.timezone }));
  renderWeather();
  settings?.refresh?.();
}

/** The selector, top left: only if the company has more than one office. */
function renderOffices() {
  const box = $('office-pick'), sel = $('office-select');
  box.hidden = offices.length < 2;
  sel.innerHTML = '';
  for (const o of offices) sel.append(new Option(o.name, o.id));
  sel.value = office?.id || '';
}
function viewOffice(id) {
  if (!id || id === office?.id) return;
  send({ type: 'view', office: id });
}
$('office-select').onchange = (e) => viewOffice(e.target.value);
function nextOffice() {
  if (offices.length < 2) return;
  const i = Math.max(0, offices.findIndex((o) => o.id === office?.id));
  viewOffice(offices[(i + 1) % offices.length].id);
}

function onHerdr(st) {
  herdr = st || { available: false, panes: [] };
  renderPanes();
}

// The weather in the HUD: the same one seen through the glass wall (real or simulated).
function renderWeather() {
  const w = game.sim.weather, now = game.sim.date();
  const icon = weatherIcon(w, daylight(now, w).night);
  const temp = Number.isFinite(w.temp) ? `${Math.round(w.temp)}°` : '';
  const el = $('wx');
  el.hidden = false;
  el.textContent = `${icon} ${temp}`;
  const place = w.place || office?.city || t('ui.here');
  const country = office?.country ? `, ${countryName(office.country, getLanguage())}` : '';
  const where = w.source === 'open-meteo' ? t('ui.weatherReal', { place: `${place}${country}` }) : `${t('ui.weatherSim')} · ${place}${country}`;
  el.title = t('ui.weatherTitle', { label: t(`weather.${w.kind}`), temp: temp ? `, ${temp}C` : '', season: t(`season.${season(now, isSouth(w.lat, zone() || undefined))}`), where });
}
setInterval(renderWeather, 60_000);

function setConn(on) {
  $('conn').className = `conn ${on ? 'on' : 'off'}`;
  $('conn').textContent = t(on ? 'conn.live' : 'conn.offline');
  $('conn').dataset.i18n = on ? 'conn.live' : 'conn.offline';
}

function onSnapshot(state) {
  game.reset();
  sessions.clear();
  for (const s of state.sessions) if (s.id !== OFFICE_SESSION) sessions.set(s.id, s);
  $('log').querySelectorAll('li[data-ev]').forEach((li) => li.remove()); // the events arrive again with the snapshot
  state.log.forEach((ev) => addLog(ev, { quiet: true }));
  if (focus && !sessions.has(focus)) focus = null;
  renderSessions();
  renderTeam();
  renderSheet(true);
}

function onEvent(ev, session) {
  if (session && session.id !== OFFICE_SESSION) sessions.set(session.id, session);
  const current = currentSession();
  // Events from other sessions move the team all the same, but the board shows the focused session.
  game.handle(ev);
  if (!current || ev.session === current.id) game.setBoard(currentSession());
  addLog(ev);
  renderSessions();
  renderTeam();
  if (session?.source === 'claude-code' && $('brief').open) renderBrief();
  if (selected === ev.role) renderSheet();
}

// ---------------------------------------------------------------- the terminal: the team's activity

const term = { open: false, tab: 'activity', unread: 0, life: true };

function toggleTerm(open = !term.open) {
  term.open = open;
  $('term').hidden = !open;
  $('open-term').setAttribute('aria-expanded', String(open));
  if (open) {
    term.unread = 0;
    renderBadge();
    scrollLog(true);
    $('chat-text').focus();
  }
}
function setTab(tab) {
  term.tab = tab;
  for (const b of document.querySelectorAll('.term-tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.t-panel')) p.hidden = p.dataset.panel !== tab;
  if (tab === 'activity') scrollLog(true);
}
function renderBadge() {
  const b = $('term-badge');
  b.hidden = !term.unread;
  b.textContent = term.unread > 99 ? '99+' : String(term.unread);
}
/** Follows the end of the log, unless the user scrolled up to read. */
function scrollLog(force) {
  const box = $('log').parentElement;
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 60) box.scrollTop = box.scrollHeight;
}

function pushLine(li, { quiet = false } = {}) {
  const ol = $('log');
  const stick = ol.parentElement.scrollHeight - ol.parentElement.scrollTop - ol.parentElement.clientHeight < 60;
  ol.append(li);
  while (ol.children.length > 300) ol.firstChild.remove();
  if (stick) scrollLog(true);
  if (!term.open && !quiet) { term.unread++; renderBadge(); }
}

function addLog(ev, opts) {
  const li = document.createElement('li');
  li.dataset.ev = '1';
  const cfg = TEAM[ev.role];
  const who = ev.kind === 'chat' || ev.kind === 'poke' ? ev.from : cfg?.name || t('events.office');
  let text = ev.text || ev.kind;
  if (ev.kind === 'phase') {
    const ph = phaseInfo(ev.phase);
    text = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
  }
  if (ev.kind === 'phase_end') text = t('events.turnEnd', { text: ev.text ? `: ${ev.text}` : '' });
  if (ev.kind === 'pane_open' || ev.kind === 'pane_close') text = `🪟 ${ev.pane} · ${ev.text}${ev.kind === 'pane_close' ? ' ✔' : ''}`;
  if (ev.kind === 'btw') text = ev.phase === 'ask' ? `❓ btw: ${ev.text}` : ev.phase === 'answer' ? `💡 ${ev.text}` : `✖ btw: ${ev.text}`;
  const name = el('b', '', `${ev.kind === 'btw' && ev.phase === 'ask' ? ev.from : who}: `);
  if (cfg) name.style.color = cfg.shirt;
  const body = el('span', ev.ok === false || (ev.kind === 'btw' && ev.phase === 'failed') ? 'err' : '');
  body.append(name, document.createTextNode(text), el('span', 'src', `  ${ev.source || ''}`));
  li.append(el('time', '', hhmm(ev.ts)), body);
  pushLine(li, opts);
}

// What they do on their own initiative (chit-chat, dreams, lunch, bathroom, fires) shows up too.
const seenLife = new WeakSet();
const NOISY = new Set(['deskchat', 'coffee']); // happens very often: only when asked to see everything
function pollLife() {
  for (const j of game.sim.journal) {
    if (seenLife.has(j)) continue;
    seenLife.add(j);
    if (!term.life || NOISY.has(j.kind)) continue;
    const li = el('li', `life${j.kind === 'fire' ? ' event-fire' : ''}`);
    li.append(el('time', '', hhmm(j.ts)), el('b', '', '* '), document.createTextNode(j.text));
    pushLine(li, { quiet: !['fire', 'repaired', 'lunch', 'requirement'].includes(j.kind) });
  }
}
setInterval(pollLife, 400);

function sysLine(text, cls = 'sys') {
  const li = el('li', cls, text);
  pushLine(li, { quiet: true });
  return li;
}

// btw: a side question to the agent on duty (about the domain, the team or the office). It answers
// in a forked session, without interrupting it; the answer shows in a card at the top and in the log.
let btwTimer = null;
function askBtw(question) {
  const q = String(question || '').trim();
  if (!q) return sysLine(t('ui.btwUsage'));
  if (ws?.readyState !== 1) return sysLine(t('conn.offline'));
  send({ type: 'ask', text: q });
}
function onAsk(a) {
  if (!a || (office && a.office !== office.id)) return;
  const card = $('btw-card');
  clearTimeout(btwTimer);
  card.hidden = false;
  card.classList.toggle('asking', a.status === 'asking');
  card.classList.toggle('failed', a.status === 'failed');
  $('btw-q').textContent = a.question;
  const who = TEAM[a.role]?.name || '';
  $('btw-who').textContent = [who, a.agent].filter(Boolean).join(' · ');
  $('btw-a').textContent = a.status === 'asking' ? t('ui.btwThinking') : a.status === 'answered' ? a.answer : t('ui.btwFailed', { error: a.error || '' });
  if (a.status !== 'asking') btwTimer = setTimeout(() => { if (!card.matches(':hover')) card.hidden = true; }, a.status === 'answered' ? 60_000 : 15_000);
}
$('btw-close').onclick = () => { clearTimeout(btwTimer); $('btw-card').hidden = true; };

// The terminal's command line: a message to the team, or a /command (in the game's language;
// the English names always work too).
const COMMANDS = {
  help: () => sysLine(t('ui.help')),
  brief: () => openBrief(),
  demo: () => send({ type: 'command', action: 'demo' }),
  tdd: () => send({ type: 'command', action: 'demo-pi' }),
  reset: () => send({ type: 'command', action: 'reset' }),
  settings: () => settings.open(),
  office: (arg) => {
    if (!arg) return nextOffice();
    const q = arg.toLowerCase();
    const o = offices.find((x) => x.id === q || x.name.toLowerCase() === q) || offices.find((x) => x.name.toLowerCase().includes(q));
    return o ? viewOffice(o.id) : sysLine(t('ui.noOffice', { name: arg }));
  },
  clear: () => { $('log').innerHTML = ''; },
  life: () => {
    term.life = !term.life;
    send({ type: 'prefs', prefs: { log: { life: term.life } } }); // queda guardado
    sysLine(t(term.life ? 'ui.lifeOn' : 'ui.lifeOff'));
  },
  screen: () => toggleFullscreen(),
  btw: (arg) => askBtw(arg),
};
const commandFor = (name) => COMMANDS[name] || COMMANDS[Object.keys(COMMANDS).find((k) => t(`ui.commands.${k}`) === name)];
$('chat').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  $('chat-text').value = '';
  if (!text) return;
  sysLine(`$ ${text}`, 'echo');
  if (/^btw\b/i.test(text)) return askBtw(text.replace(/^btw\b[:,]?\s*/i, ''));
  if (text.startsWith('/')) {
    const [name, ...rest] = text.slice(1).split(/\s+/);
    const cmd = commandFor(name.toLowerCase());
    return cmd ? cmd(rest.join(' ')) : sysLine(t('ui.unknownCommand'));
  }
  send({ type: 'chat', text, role: selected || undefined });
};
$('open-term').onclick = () => toggleTerm();
$('term-close').onclick = () => toggleTerm(false);
for (const b of document.querySelectorAll('.term-tabs [role=tab]')) b.onclick = () => setTab(b.dataset.tab);

// ---------------------------------------------------------------- briefs (terminal tab)

function currentSession() {
  if (focus && sessions.has(focus)) return sessions.get(focus);
  return [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt)[0] || null;
}

function renderSessions() {
  const sel = $('session');
  const list = [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt);
  sel.innerHTML = '';
  sel.append(new Option(t('ui.latest'), ''));
  for (const s of list) sel.append(new Option(`${s.source} · ${s.id.slice(0, 8)}`, s.id));
  sel.value = focus || '';

  const s = currentSession();
  game.setBoard(s);
  $('task-title').textContent = s?.title || (s ? t('ui.noTaskYet') : t('ui.waitingAgent'));
  const todos = s?.todos || [];
  const done = todos.filter((x) => x.status === 'completed').length;
  $('progress-bar').style.width = todos.length ? `${(100 * done) / todos.length}%` : s?.status === 'done' ? '100%' : '0';
  $('st-tools').textContent = s?.tools ?? 0;
  $('st-errors').textContent = s?.errors ?? 0;
  $('st-subs').textContent = s?.subagents?.filter((x) => x.open).length ?? 0;
  $('st-status').textContent = s ? t(`sessionStatus.${s.status}`) : '—';
  renderFlow(s);
}

// Role flow declared by the agent: Tomás · Architecture → Andrés · RED → Diego · Implement → …
function renderFlow(s) {
  const ol = $('flow');
  const flow = s?.flow || [];
  ol.hidden = !flow.length;
  ol.innerHTML = '';
  flow.slice(-12).forEach((step, i, arr) => {
    const cfg = TEAM[step.role];
    const ph = phaseInfo(step.phase);
    const li = el('li', i === arr.length - 1 && s.turn ? 'now' : '', `${cfg?.name || step.role} · ${ph.label}`);
    li.style.setProperty('--c', cfg?.shirt || '#888');
    li.title = step.text || '';
    ol.append(li);
  });
  ol.scrollLeft = ol.scrollWidth;
}

function moodOf(a) {
  if (a.hidden) return t('ui.mood.bath');
  if (a.dance) return t('ui.mood.bathWait');
  if (a.dream) return t('ui.mood.dream', { dream: DREAMS[a.dream.kind].label, emoji: DREAMS[a.dream.kind].emoji });
  if (a.lunch) return t('ui.mood.lunch', { food: a.food || '🍽️' });
  if (a.state === 'alarm') return t('ui.mood.fire');
  if (a.scene && a.scene.kind !== 'consult') return t('ui.mood.talking');
  return t(`state.${a.state}`);
}

function renderTeam() {
  const ul = $('team');
  ul.innerHTML = '';
  for (const [id, cfg] of Object.entries(TEAM)) {
    const a = game.agents[id];
    const li = document.createElement('li');
    li.className = selected === id ? 'sel' : '';
    li.onclick = () => select(id);
    const dot = el('span', 'dot'); dot.style.background = cfg.shirt; dot.style.color = cfg.shirt;
    const who = el('div');
    const name = el('span', 'who', `${cfg.name} · ${cfg.title}`);
    name.style.color = cfg.shirt;
    who.append(name, el('span', 'what', a.text || t('ui.noActivity')));
    li.append(dot, who, el('span', `pill ${a.state}`, moodOf(a)));
    ul.append(li);
  }
}

// ---------------------------------------------------------------- the selected character's sheet

let portraitOf = null;
function select(id) {
  selected = id;
  game.select(id);
  $('prompt-label').textContent = id ? t('ui.promptOne', { name: TEAM[id].name.toLowerCase() }) : t('ui.promptTeam');
  renderTeam();
  renderSheet(true);
}

/** Each need as a "how well it is" bar (full green = satisfied), like in The Sims. */
function renderSheet(full) {
  const box = $('sheet');
  if (!selected) { box.hidden = true; return; }
  const cfg = TEAM[selected], a = game.agents[selected];
  box.hidden = false;
  if (full || portraitOf !== `${selected}:${cfg.shirt}${cfg.hair}${cfg.skin}${cfg.pants}${cfg.long}${cfg.beard}${cfg.glasses}`) {
    portraitOf = `${selected}:${cfg.shirt}${cfg.hair}${cfg.skin}${cfg.pants}${cfg.long}${cfg.beard}${cfg.glasses}`;
    drawSprite($('sheet-portrait'), cfg, { P: 4, bg: '#c9b48a' });
    $('sheet-name').textContent = cfg.name;
    $('sheet-name').style.color = cfg.shirt;
    $('sheet-role').textContent = `${cfg.title}${a.badges.size ? ` · ${t('ui.subagents', { n: a.badges.size })}` : ''}`;
  }
  $('sheet-mood').textContent = `${moodOf(a)}${a.text && ['working', 'thinking', 'red'].includes(a.state) ? `: ${a.text}` : ''}`;
  const dl = $('sheet-needs');
  const needs = needsOf(selected);
  if (full || dl.children.length !== needs.length * 2) {
    dl.innerHTML = '';
    for (const [, label] of needs) { const dd = el('dd'); dd.append(el('span')); dl.append(el('dt', '', label), dd); }
  }
  needs.forEach(([key], i) => {
    const ok = 1 - Math.max(0, Math.min(1, a.mind[key] ?? 0));
    const bar = dl.children[i * 2 + 1].firstChild;
    bar.style.width = `${Math.round(ok * 100)}%`;
    bar.style.setProperty('--c', ok > 0.6 ? '#3fd16b' : ok > 0.3 ? '#ffd166' : '#ef476f');
  });
  const ul = $('sheet-history');
  ul.innerHTML = '';
  if (!a.history.length) ul.append(el('li', '', t('ui.nothingYet')));
  for (const h of a.history.slice(0, 4)) ul.append(el('li', '', `${hhmm(h.ts)} — ${h.text}`));
}
setInterval(() => { renderSheet(); if (term.open && term.tab === 'team') renderTeam(); }, 500);
$('sheet-close').onclick = () => select(null);
$('poke').onclick = () => selected && send({ type: 'poke', role: selected });
$('sheet-msg').onclick = () => { toggleTerm(true); setTab('activity'); $('chat-text').focus(); };

// ---------------------------------------------------------------- tasks for the agents

function onTasks(snap) {
  tasks = snap;
  $('agents-count').textContent = tasks.agents.length ? t('ui.connected', { n: tasks.agents.length }) : '';
  renderTasks();
  if ($('brief').open) renderBrief();
}

function renderTasks() {
  const ul = $('tasks');
  ul.innerHTML = '';
  for (const task of tasks.tasks.slice(-6).reverse()) {
    const [icon] = TASK_STATUS[task.status] || ['·'];
    const li = document.createElement('li');
    li.append(el('span', `st-${task.status}`, icon), el('span', '', `${AGENT_NAME[task.agent] || task.agent}${task.mode === 'launch' ? t('ui.isNew') : ''}: ${task.text}`));
    if (['running', 'queued', 'sent'].includes(task.status)) {
      const b = el('button', '', '✕');
      b.title = t('ui.cancel');
      b.onclick = () => send({ type: 'task_cancel', id: task.id });
      li.append(b);
    } else li.append(el('span', `st-${task.status}`, t(`taskStatus.${task.status}`)));
    const sub = task.status === 'running' && task.output?.length ? task.output.at(-1) : ['failed', 'queued'].includes(task.status) || task.pane ? task.detail : '';
    if (sub) li.append(el('span', 'sub', sub));
    ul.append(li);
  }
}

// This office's herdr panes: the activities the agent opened, and who is in charge.
function renderPanes() {
  let ul = $('panes');
  if (!ul) { ul = el('ul', 'tasks'); ul.id = 'panes'; $('tasks').after(ul); }
  ul.innerHTML = '';
  for (const p of (herdr?.panes || []).filter((x) => !x.main && (x.office || 'main') === (office?.id || 'main')).slice(-6)) {
    const li = document.createElement('li');
    const who = TEAM[p.role];
    const tag = el('span', '', `🪟 ${p.pane}`);
    tag.style.color = who?.shirt || '';
    li.append(tag, el('span', '', ` ${who?.name || p.role} · ${p.title}`), el('span', 'st-running', p.status || ''));
    ul.append(li);
  }
}

function alertTask(error) {
  if ($('brief').open) { $('b-problem').textContent = t('brief.failed', { error }); return; }
  sysLine(`✖ ${t('brief.failed', { error })}`, 'echo');
  toggleTerm(true);
}

// ---------------------------------------------------------------- pipelines en curso

const STAGE_ICON = { pending: '◷', running: '▶', done: '✔', failed: '✖', skipped: '⊘', cancelled: '⊘' };

function onRuns(list) {
  runs = list || [];
  const ul = $('runs');
  ul.innerHTML = '';
  for (const r of runs.slice(-3).reverse()) {
    const li = document.createElement('li');
    const head = el('div', 'r-head');
    head.append(el('span', 'r-name', `${r.pipeline.name} · ${r.project.name}`));
    if (r.status === 'running') {
      const b = el('button', '', t('ui.cancelRun'));
      b.onclick = () => send({ type: 'pipeline_cancel', id: r.id });
      head.append(b);
    } else head.append(el('span', `st-${r.status === 'done' ? 'done' : 'failed'}`, t(`runStatus.${r.status}`)));
    li.append(head, el('div', 'sub', t('ui.runBy', { agent: AGENT_NAME[r.agent] || r.agent, task: r.task })));
    const stages = el('div', 'r-stages');
    for (const st of r.stages) {
      const chip = el('span', `r-stage ${st.status}`, `${STAGE_ICON[st.status] || '·'} ${TEAM[st.role]?.name || st.role} · ${phaseInfo(st.phase).label}${st.attempts > 1 ? ` ×${st.attempts}` : ''}`);
      chip.style.setProperty('--c', TEAM[st.role]?.shirt || '#888');
      chip.title = [st.name, st.agent, st.model, st.detail].filter(Boolean).join(' · ');
      stages.append(chip);
    }
    li.append(stages);
    if (r.detail && r.status !== 'running') li.append(el('div', 'r-detail', r.detail));
    ul.append(li);
  }
}

// ---------------------------------------------------------------- "New brief" dialog

const brief = { sel: { target: 0, entry: 0, session: -1 }, opts: null };

function onTargets(list) {
  targets = list || [];
  if ($('brief').open) renderBrief();
  settings.refresh?.();
}

/** @param agentId opens the dialog with that agent chosen (from ⚙ › Agents) */
function openBrief(agentId) {
  const dlg = $('brief');
  if (!dlg.open) dlg.showModal();
  const i = agentId ? targets.findIndex((x) => x.id === agentId) : -1;
  brief.sel = { target: i >= 0 ? i : defaultTarget(targets, sessions.values()), entry: 0, session: -1 };
  renderBrief();
  $('b-text').focus();
}

function fillSelect(select, items, index, label = (x) => x.label) {
  select.innerHTML = '';
  items.forEach((item, i) => select.append(new Option(label(item), String(i))));
  select.value = String(Math.min(index, Math.max(0, items.length - 1)));
}

function renderBrief() {
  const o = brief.opts = briefOptions({ targets }, brief.sel);
  fillSelect($('b-agent'), targets.length ? targets : [{ label: t('brief.noAgentWeb') }], brief.sel.target, (x) => x.label || targetLabel(x));
  $('b-agent').disabled = !targets.length;
  fillSelect($('b-pipeline'), o.entries.length ? o.entries : [{ label: '—' }], Math.max(0, o.entries.indexOf(o.entry)));
  $('b-desc').textContent = o.entry ? [o.entry.description, o.entry.source && o.entry.source !== 'agente' ? `(${o.entry.source})` : ''].filter(Boolean).join(' ')
    : t('brief.registerHintWeb');
  fillSelect($('b-session'), o.sessions.length ? o.sessions : [{ label: '—' }], o.sessionIndex);

  const box = $('b-stages');
  box.innerHTML = '';
  if (o.stages.length) {
    box.append(el('h3', '', t('brief.stages', { who: t(o.entry.devteam ? 'brief.bySession' : 'brief.byHarness') })));
    o.stages.forEach((st, i) => {
      const card = el('div', 'b-stage');
      card.style.setProperty('--c', TEAM[st.role]?.shirt || '#888');
      card.append(el('span', 'n', String(i + 1)), el('span', 'who', `${TEAM[st.role]?.name || st.role} · ${phaseInfo(st.phase).label} — ${st.name}`));
      const how = [st.agent, st.model].filter(Boolean).join(' · ');
      if (how || st.needs?.length) card.append(el('span', 'how', `${how}${st.needs?.length ? `  ← ${st.needs.join(', ')}` : ''}`));
      if (st.check) card.append(el('span', 'gate', t('brief.gate', { run: st.check.run, expect: t(st.check.expect === 'pass' ? 'brief.pass' : 'brief.fail'), loop: '' })));
      box.append(card);
    });
    if (o.entry.issues?.length) box.append(el('p', 'b-problem', o.entry.issues.join(' · ')));
  }
  const problem = briefProblem(o, $('b-text').value);
  $('b-problem').textContent = problem && ($('b-text').value.trim() || !o.target) ? problem : '';
  $('brief-go').disabled = !!problem;
}

$('b-agent').onchange = (e) => { brief.sel = { target: Number(e.target.value), entry: 0, session: -1 }; renderBrief(); };
$('b-pipeline').onchange = (e) => { brief.sel = { ...brief.sel, entry: Number(e.target.value) }; renderBrief(); };
$('b-session').onchange = (e) => { brief.sel = { ...brief.sel, session: Number(e.target.value) }; renderBrief(); };
$('b-text').oninput = () => renderBrief();
$('b-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('brief-form').requestSubmit(); };
$('brief-close').onclick = $('brief-cancel').onclick = () => $('brief').close();
$('new-brief').onclick = () => openBrief();

// ⚙ Settings: general, offices, the agents maintainer and the characters' appearance.
const settings = createSettings({
  getTargets: () => targets, getOffices: () => offices, getOffice: () => office, getPrefs: () => prefs, getHerdr: () => herdr,
  onPrompt: (id) => { $('settings').close(); openBrief(id); },
  onView: (id) => viewOffice(id),
});
$('open-settings').onclick = () => settings.open();
$('brief-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('b-text').value;
  const problem = briefProblem(brief.opts, text);
  if (problem) { $('b-problem').textContent = problem; return; }
  send({ ...briefMessage(brief.opts, text, 'Web'), ref: Date.now() });
  $('b-text').value = '';
  $('brief').close();
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

$('session').onchange = (e) => { focus = e.target.value || null; renderSessions(); };
$('demo').onclick = () => COMMANDS.demo();
$('demo-pi').onclick = () => COMMANDS.tdd();
$('reset').onclick = () => COMMANDS.reset();
setInterval(() => { if (term.open && term.tab === 'team') return; renderTeam(); }, 2000); // statuses expire on the client

// ---------------------------------------------------------------- full screen and shortcuts

function toggleFullscreen() {
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
  else { const root = doc.documentElement; (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root); }
}
$('fullscreen').onclick = toggleFullscreen;
// front or top-down: it switches right away and stays in the settings (the other viewers see it too)
function toggleView() {
  game.setView(game.view === 'iso' ? 'flat' : 'iso');
  $('view-mode').setAttribute('aria-pressed', String(game.view === 'iso'));
  send({ type: 'prefs', prefs: { view: { mode: game.view } } });
}
$('view-mode').onclick = toggleView;
const onFs = () => $('fullscreen').setAttribute('aria-pressed', String(!!(document.fullscreenElement || document.webkitFullscreenElement)));
document.addEventListener('fullscreenchange', onFs);
document.addEventListener('webkitfullscreenchange', onFs);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (typing) document.activeElement.blur();
    if (term.open) toggleTerm(false); else if (selected) select(null);
    return;
  }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === 'a') { e.preventDefault(); toggleTerm(); }
  else if (k === 't') { e.preventDefault(); openBrief(); }
  else if (k === 'c') { e.preventDefault(); settings.open(); }
  else if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
  else if (k === 'v') { e.preventDefault(); toggleView(); }
  else if (k === 'o') { e.preventDefault(); nextOffice(); }
});

applyI18n();
renderWeather();
const welcome = sysLine(t('ui.welcome'));
onLanguage(() => { welcome.textContent = t('ui.welcome'); });
connect();
