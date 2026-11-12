import { createGame, TEAM, personOf, phaseInfo } from './game.js';
import { applyAppearance, DREAMS, teamNames } from './sim.js';
import { AGENT_NAME, TASK_STATUS } from './targets.js';
import { briefOptions, briefProblem, briefMessage, defaultTarget, targetLabel } from './brief.js';
import { createSettings } from './settings-ui.js';
import { createServices } from './services-ui.js';
import { createBoardView } from './board-ui.js';
import { createPrompts } from './prompts-ui.js';
import { createDirectivesUi, createArchiveUi } from './floors-ui.js';
import { drawSprite } from './sprite.js';
import { season, isSouth, daylight, weatherIcon } from './sky.js';
import { t, ta, setLanguage, onLanguage, getLanguage, timeOf } from './i18n.js';
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
let services = []; // the services the agents left running in the background (the rack, the ▶ chip)
let asking = [];   // what the agents ask you on their screens (inside herdr): the ✋ chip
let clarifications = []; // the analyst's reviews of your briefs (server/clarify.js): her questions wait for you
// the two shared floors: the executive one (directives, how each office is doing) and the archive
let directives = [];
let overview = [];

// the whiteboard: with tickets it expands to show them as post-its; without them, a new brief
// the PO is you: with a question pending, clicking it (or the manager, hand up) opens the questions
const game = createGame($('office'), {
  onSelect: (id) => ((id === 'po' || id === 'manager') && asking.length ? promptsUi.open() : select(id)),
  onBoardClick: () => (boardView.hasTickets() ? boardView.open() : openBrief()),
  onRackClick: () => servicesUi.open(),
  // the shared floors: the board and the screen (directives), the shelves, the rack and the patch panel (the archive), the elevator
  onFloorClick: (floor, what) => {
    if (what === 'lift') return openLift();
    if (floor === 'exec') return directivesUi.open();
    return archiveUi.open({ kind: what === 'knowledge' ? '' : what });
  },
});
const boardView = createBoardView({
  getBoard: () => game.sim.board,
  onBrief: () => openBrief(),
  // where the small whiteboard is on the page (in either view)
  boardRect: () => {
    const r = $('office').getBoundingClientRect(), b = game.boardBox();
    return { left: r.left + b.x * r.width, top: r.top + b.y * r.height, width: b.w * r.width, height: b.h * r.height };
  },
});
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
  renderContext();
  renderTeam();
  renderOffices();
  renderWeather();
  onTasks(tasks);
  onRuns(runs);
  if ($('brief').open) renderBrief();
  settings.refresh?.(true);
  renderServicesChip();
  servicesUi.refresh();
  renderAskChip();
  promptsUi.refresh();
});

// ---------------------------------------------------------------- socket

let served = null; // the office version this page was loaded from
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/v1/ws`);
  ws.onopen = () => { setConn(true); ws.send(JSON.stringify({ type: 'client', app: 'web' })); };
  ws.onclose = () => { setConn(false); setTimeout(connect, 1500); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    // the office was restarted with another version (an update): this page has the old code
    if (msg.type === 'hello') { if (served && msg.version && msg.version !== served) location.reload(); served = msg.version || served; }
    if (msg.type === 'snapshot') {
      const st = msg.state;
      if (st.prefs) onPrefs(st.prefs);
      onOffices(st.offices || [], st.office);
      onHerdr(st.herdr);
      onSnapshot(st);
      if (st.tasks) onTasks(st);
      onRuns(st.pipelines || []);
      onTargets(st.targets);
      onServices(st.services || []);
      onPrompts(st.prompts || []);
      clarifications = st.clarifications || [];
      renderAttention();
      onFloors(st);
    }
    if (msg.type === 'directives') onFloors({ directives: msg.directives });
    if (msg.type === 'overview') onFloors({ overview: msg.overview });
    if (msg.type === 'archive') onFloors({ archive: msg.archive });
    if (msg.type === 'floor') onFloorEvent(msg.event);
    if (msg.type === 'prefs') onPrefs(msg.prefs);
    if (msg.type === 'offices') onOffices(msg.offices, msg.offices.find((o) => o.id === office?.id));
    if (msg.type === 'herdr') onHerdr(msg.herdr);
    if (msg.type === 'pipelines') onRuns(msg.runs);
    if (msg.type === 'targets') onTargets(msg.targets);
    if (msg.type === 'services' && msg.office === office?.id) onServices(msg.services);
    if (msg.type === 'prompts' && msg.office === office?.id) onPrompts(msg.prompts);
    if (msg.type === 'clarify' && msg.clarify?.office === office?.id) onClarify(msg.clarify);
    if (msg.type === 'snapshot' || msg.type === 'appearance') { applyAppearance((msg.state || msg).appearance || {}); game.floors.setYou(TEAM.po); renderTeam(); renderSheet(true); settings?.appearanceChanged?.(); }
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

// ---------------------------------------------------------------- the services in the background

const servicesUi = createServices({ getServices: () => services, getHerdr: () => herdr, who: (role) => personOf(role)?.name || '', hhmm: (ts) => hhmm(ts) });

function onServices(list) {
  services = list || [];
  game.setServices(services);
  renderServicesChip();
  servicesUi.refresh();
}

/** The ▶ chip in the HUD: how many are running (it shows up with the first one). */
function renderServicesChip() {
  const n = services.filter((s) => s.status === 'running').length;
  const chip = $('svc-chip');
  chip.hidden = !services.length;
  chip.textContent = `▶ ${n}`;
  chip.classList.toggle('idle', !n);
  chip.title = t('ui.servicesKey', { n });
  chip.setAttribute('aria-label', chip.title);
}
$('svc-chip').onclick = () => servicesUi.open();

// ---------------------------------------------------------------- what the agents ask you

const promptsUi = createPrompts({
  getPrompts: () => asking,
  agentName: (a) => AGENT_NAME[a] || a,
  answer: (id, choice) => fetch(`/v1/prompts/${encodeURIComponent(id)}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(choice) }).then((r) => r.json()),
});

function onPrompts(list) {
  asking = list || [];
  renderAskChip();
  promptsUi.refresh();
  renderAttention();
}

// ---------------------------------------------------------------- waiting for you

// Whatever needs your answer: the analyst's questions about a brief, what an agent asks on its screen
// (inside herdr) and the sessions that stopped to wait for you (a permission, their question tool).
// It shows as a big pulsing banner at the top with the screen's edge lit up, in the tab's title, and
// (if you want, in ⚙ › General) with a sound and a system notification. It stays until you answer.
const ALERTS_KEY = 'dto.alerts';
const alertPrefs = () => { try { return { sound: true, notify: false, ...JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}') }; } catch { return { sound: true, notify: false }; } };
function setAlertPrefs(patch) { try { localStorage.setItem(ALERTS_KEY, JSON.stringify({ ...alertPrefs(), ...patch })); } catch { /* private window: only for now */ } }
const announced = new Set();
const baseTitle = document.title;

function attentionItems() {
  const items = [];
  for (const c of clarifications) {
    if (c.status !== 'asking') continue;
    items.push({ key: `c:${c.id}`, who: TEAM.analyst.name, what: t('attention.clarify', { name: TEAM.analyst.name, n: c.questions.length }), since: c.createdAt, label: t('attention.answer'), go: () => openClarify(c.id) });
  }
  for (const p of asking) items.push({ key: `p:${p.id}:${p.rev}`, who: AGENT_NAME[p.agent] || p.agent || t('prompts.theAgent'), what: p.summary || '', since: p.since || Date.now(), label: t('attention.answer'), go: () => promptsUi.open() });
  for (const s of sessions.values()) {
    const w = s.status === 'waiting' && s.waiting;
    if (!w || Date.now() - w.since > 6 * 3600_000 || asking.some((p) => p.cwd && s.cwd && p.cwd === s.cwd)) continue;
    items.push({
      key: `s:${s.id}:${w.since}`, who: [AGENT_NAME[s.source] || s.source, projectOf(s.id)].filter(Boolean).join(' · '),
      what: w.question ? t('attention.question', { text: w.text }) : w.text, since: w.since,
      // outside herdr the office cannot press anything for you: you answer in the agent's terminal
      label: t('attention.terminal'), go: () => { if (w.role && TEAM[w.role]) select(w.role); },
    });
  }
  return items.sort((a, b) => a.since - b.since);
}

function renderAttention() {
  const items = attentionItems();
  const bar = $('attention');
  bar.hidden = !items.length; // on every floor: wherever you are, you see it
  if (!items.length && $('inbox').open) $('inbox').close();
  $('screen').classList.toggle('waiting', items.length > 0);
  document.title = items.length ? `${t('attention.title', { n: items.length })} · ${baseTitle}` : baseTitle;
  if (!items.length) return;
  const first = items[0];
  $('attention-who').textContent = items.length > 1 ? `${t('attention.many', { n: items.length })} · ` : `${t('attention.one', { who: first.who })} · `;
  $('attention-what').textContent = items.length > 1 ? `${first.who}: ${first.what}` : first.what;
  const min = Math.floor((Date.now() - first.since) / 60_000);
  $('attention-since').textContent = min >= 1 ? t('attention.since', { min }) : '';
  $('attention-go').textContent = first.label;
  $('attention-go').onclick = first.go;
  $('attention-all').hidden = items.length < 2;
  $('attention-all').textContent = t('attention.all', { n: items.length });
  if ($('inbox').open) renderInbox(items);
  // something new: a sound and, if you allowed it, a system notification
  const fresh = items.filter((x) => !announced.has(x.key));
  for (const x of items) announced.add(x.key);
  if (fresh.length) announce(fresh[0]);
}
setInterval(renderAttention, 15_000); // the "for N min" grows

/** The inbox: everything waiting for you, in one list (oldest first), each with its own button. */
function renderInbox(items = attentionItems()) {
  const ol = $('inbox-list');
  ol.innerHTML = '';
  for (const x of items) {
    const min = Math.floor((Date.now() - x.since) / 60_000);
    const go = el('button', 'btn', x.label);
    go.type = 'button';
    go.onclick = () => { $('inbox').close(); x.go(); };
    const text = el('div', 'inbox-text');
    text.append(el('b', '', x.who), el('span', '', x.what));
    const li = el('li');
    li.append(text, el('span', 'inbox-since', min >= 1 ? t('attention.since', { min }) : t('attention.now')), go);
    ol.append(li);
  }
}
$('attention-all').onclick = () => { renderInbox(); if (!$('inbox').open) $('inbox').showModal(); };
$('inbox-close').onclick = () => $('inbox').close();

function announce(item) {
  const p = alertPrefs();
  if (p.sound) chime();
  if (p.notify && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    try { new Notification(t('attention.notifyTitle'), { body: `${item.who}: ${item.what}`, tag: item.key }); } catch { /* not allowed here */ }
  }
}
/** Two soft notes (no audio files: WebAudio). Browsers allow it after your first click on the page. */
let audio = null;
function chime() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    [[880, 0], [1320, 0.16]].forEach(([f, at]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(now + at); o.stop(now + at + 0.4);
    });
  } catch { /* no audio */ }
}

// ---------------------------------------------------------------- the analyst's questions about a brief

let clarifyOpen = null;
function onClarify(c) {
  clarifications = [...clarifications.filter((x) => x.id !== c.id), c].slice(-30);
  if (clarifyOpen === c.id && c.status !== 'asking') $('clarify').close();
  renderAttention();
}
function openClarify(id) {
  const c = clarifications.find((x) => x.id === id && x.status === 'asking');
  if (!c) return;
  clarifyOpen = id;
  $('cl-title').textContent = t('clarify.ui.title', { name: TEAM.analyst.name });
  $('cl-brief').textContent = `${c.name}: ${c.text}`;
  const ol = $('cl-questions');
  ol.innerHTML = '';
  c.questions.forEach((q, i) => {
    const li = el('li');
    const area = el('textarea');
    area.rows = 2; area.maxLength = 1000; area.placeholder = t('clarify.ui.placeholder'); area.dataset.i = String(i);
    li.append(el('p', 'cl-q', q), area);
    ol.append(li);
  });
  const dlg = $('clarify');
  if (!dlg.open) dlg.showModal();
  ol.querySelector('textarea')?.focus();
}
const clarifyReply = (body) => { if (!clarifyOpen) return; send({ type: 'clarify_answer', id: clarifyOpen, ...body }); $('clarify').close(); };
$('cl-form').onsubmit = (e) => { e.preventDefault(); clarifyReply({ answers: [...$('cl-questions').querySelectorAll('textarea')].map((x) => x.value) }); };
$('cl-skip').onclick = () => clarifyReply({ skip: true });
$('cl-cancel').onclick = () => { if (clarifyOpen) send({ type: 'clarify_cancel', id: clarifyOpen }); $('clarify').close(); };
$('cl-close').onclick = () => $('clarify').close();
$('clarify').addEventListener('close', () => { clarifyOpen = null; });
$('cl-questions').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('cl-form').requestSubmit(); };

/** The ✋ chip in the HUD: it shows up while an agent is waiting for your answer. */
function renderAskChip() {
  const chip = $('ask-chip');
  const first = asking[0];
  chip.hidden = !first;
  if (!first) return;
  const agent = AGENT_NAME[first.agent] || first.agent || t('prompts.theAgent');
  chip.textContent = `✋ ${asking.length > 1 ? t('prompts.chipMany', { n: asking.length }) : t('prompts.chip', { agent })}`;
  chip.title = `${first.summary || ''} (r)`;
  chip.setAttribute('aria-label', `${chip.textContent}: ${chip.title}`);
}
$('ask-chip').onclick = () => promptsUi.open();

function onPrefs(p) {
  prefs = p;
  feed.life = !!p.log?.life;
  $('feed-life').checked = feed.life;
  // the office view: front (the usual one) or isometric top-down, as saved in the settings
  game.setView(p.view?.mode === 'iso' ? 'iso' : 'flat');
  if (p.view?.floor && p.view.floor !== game.floor) setFloor(p.view.floor, { save: false });
  $('view-mode').setAttribute('aria-pressed', String(game.view === 'iso'));
  $('screen').dataset.view = game.view;
  setLanguage(p.lang);
  settings?.refresh?.();
}

// ---------------------------------------------------------------- the offices

function onOffices(list, current) {
  offices = list || [];
  const changed = current && current.id !== office?.id;
  if (current) office = current;
  if (current && current.id === wanted) wanted = null;
  if (office) { game.sim.setZone(office.timezone); game.sim.setPlace(office.place); }
  renderOffices();
  if (changed) sysLine(t('ui.viewing', { name: office.name, tz: office.timezone }));
  renderWeather();
  settings?.refresh?.();
}

/** The selector, top left: the building's floors, from the executive one to the archive. */
function renderOffices() {
  const sel = $('office-select');
  sel.innerHTML = '';
  sel.append(new Option(t('floors.name.exec'), FLOOR_VALUE.exec));
  for (const o of offices) sel.append(new Option(`🏢 ${o.name}`, o.id));
  sel.append(new Option(t('floors.name.archive'), FLOOR_VALUE.archive));
  sel.value = game.floor === 'office' ? office?.id || '' : FLOOR_VALUE[game.floor];
}
// the office asked for, until its snapshot arrives (the elevator does not wait for it)
let wanted = null;
function viewOffice(id) {
  if (!id || id === (wanted || office?.id)) return;
  wanted = id;
  send({ type: 'view', office: id });
}
$('office-select').onchange = (e) => pickFloor(e.target.value);
/** o: the next floor going down (and from the archive, back to the executive floor). */
function nextOffice() { moveFloor(1); }

// ---------------------------------------------------------------- the building's floors

const directivesUi = createDirectivesUi({ getDirectives: () => directives, getOffices: () => offices, getOverview: () => overview, hhmm: (ts) => hhmm(ts) });
const archiveUi = createArchiveUi({ getOffices: () => offices, hhmm: (ts) => `${new Date(ts).toLocaleDateString(getLanguage())} ${hhmm(ts)}` });
const FLOOR_VALUE = { exec: '@exec', archive: '@archive' }; // in the selector, next to the offices' ids

function onFloors({ directives: d, overview: o, archive: a } = {}) {
  if (d) { directives = d; directivesUi.refresh(); }
  if (o) { overview = o; directivesUi.refresh(); }
  if (a) archiveUi.refresh();
  game.floors.setData({ directives: d, overview: o, archive: a });
}

/** What happens on the shared floors: the game animates it and the log tells it. */
function onFloorEvent(ev = {}) {
  game.floors.handle(ev);
  const kind = (k) => t(`knowledgeKind.${k || 'note'}`);
  const line = {
    directive: () => t('exec.log.created', { title: ev.text, n: ev.total || 0, offices: (ev.offices || []).join(', ') }),
    department: () => t('exec.log.department', { name: ev.text }),
    directive_end: () => t('exec.log.ended', { title: ev.text, status: t(`directiveStatus.${ev.status}`), done: ev.done ?? 0, total: ev.total ?? 0 }),
    saved: () => (ev.entryKind === 'minute' ? null : t(ev.created ? 'archive.log.saved' : 'archive.log.updated', { kind: kind(ev.entryKind), title: ev.text, who: ev.source || t('events.you') })),
    installed: () => (ev.count ? t('floors.archive.react.installed', { name: ev.text, n: ev.count }) : null),
    generate: () => t('archive.log.generate', { kind: kind(ev.entryKind), text: ev.text }),
    read: () => t('floors.archive.react.read', { title: ev.text }),
    search: () => t('floors.archive.react.search', { title: ev.text }),
  }[ev.kind]?.();
  if (line) sysLine(line, `sys floor-${ev.floor}`);
}

/** Watches a floor: 'exec', 'archive' or 'office' (the office chosen). It is saved in the settings. */
function setFloor(f, { save = true } = {}) {
  f = ['exec', 'archive'].includes(f) ? f : 'office';
  if (f === game.floor) return;
  game.setFloor(f);
  document.body.dataset.floor = f;
  if (f !== 'office' && selected) select(null);
  renderOffices();
  renderContext();
  if (save) send({ type: 'prefs', prefs: { view: { floor: f } } });
  sysLine(t('floors.going', { name: f === 'office' ? office?.name || '' : t(`floors.name.${f}`) }));
}
/** The elevator: up (-1) or down (+1) through the executive floor, the offices and the archive. */
function moveFloor(step) {
  const stops = [FLOOR_VALUE.exec, ...offices.map((o) => o.id), FLOOR_VALUE.archive];
  const here = game.floor === 'office' ? wanted || office?.id : FLOOR_VALUE[game.floor];
  const i = Math.max(0, stops.indexOf(here));
  const next = stops[(i + step + stops.length) % stops.length];
  pickFloor(next);
}
/**
 * The elevator: clicking it (on any floor) opens its panel, a button per floor — the executive floor
 * on top, each office, the archive in the basement — and takes you to the one you press.
 */
function openLift() {
  const dlg = $('lift');
  const here = game.floor === 'office' ? wanted || office?.id : FLOOR_VALUE[game.floor];
  const stops = [
    { value: FLOOR_VALUE.exec, label: t('floors.name.exec'), mark: '▲' },
    ...offices.map((o, i) => ({ value: o.id, label: `🏢 ${o.name}`, mark: String(offices.length - i) })),
    { value: FLOOR_VALUE.archive, label: t('floors.name.archive'), mark: '▼' },
  ];
  const ol = $('lift-floors');
  ol.innerHTML = '';
  for (const st of stops) {
    const on = st.value === here;
    const b = el('button', `lift-btn${on ? ' here' : ''}`);
    b.type = 'button';
    b.append(el('span', 'lift-dot', st.mark), el('span', 'lift-name', st.label), ...(on ? [el('span', 'lift-here', t('floors.lift.here'))] : []));
    if (on) b.setAttribute('aria-current', 'true');
    b.onclick = () => { dlg.close(); if (!on) { game.sim.elevator.doorAt = performance.now(); pickFloor(st.value); } };
    const li = el('li');
    li.append(b);
    ol.append(li);
  }
  if (!dlg.open) dlg.showModal();
  (ol.querySelector('.here') || ol.querySelector('button'))?.focus();
}
$('lift-close').onclick = () => $('lift').close();
$('lift').onclick = (e) => { if (e.target === $('lift')) $('lift').close(); }; // a click outside the panel closes it

function pickFloor(value) {
  if (value === FLOOR_VALUE.exec) return setFloor('exec');
  if (value === FLOOR_VALUE.archive) return setFloor('archive');
  setFloor('office');
  viewOffice(value);
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
  const place = w.place || office?.place?.name || office?.city || t('ui.here');
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
  renderContext();
  renderTeam();
  renderSheet(true);
}

function onEvent(ev, session) {
  if (session && session.id !== OFFICE_SESSION) sessions.set(session.id, session);
  const current = currentSession();
  // Events from other sessions move the team all the same, but the board shows the focused session.
  game.handle(ev.kind === 'subagent_start' ? { ...ev, project: projectOf(ev.session) } : ev);
  if (ev.kind === 'chat') heardReply(ev);
  if (!current || ev.session === current.id) { game.setBoard(currentSession()); boardView.refresh(); }
  addLog(ev);
  renderSessions();
  renderContext();
  renderTeam();
  if (session?.source === 'claude-code' && $('brief').open) renderBrief();
  if (ev.kind === 'waiting' || session?.status === 'waiting' || $('screen').classList.contains('waiting')) renderAttention();
  if (selected === ev.role) renderSheet();
}

// ---------------------------------------------------------------- the activity (bottom left)

// What the agents do and the office's life, as a log you read. It opens with 📰 or `a`; closed, a
// counter tells you what is new.
const feed = { open: false, unread: 0, life: true };

function toggleFeed(open = !feed.open) {
  feed.open = open;
  $('feed').hidden = !open;
  $('open-log').setAttribute('aria-expanded', String(open));
  if (open) { feed.unread = 0; renderBadge(); scrollLog(true); }
}
function renderBadge() {
  const b = $('feed-badge');
  b.hidden = !feed.unread;
  b.textContent = feed.unread > 99 ? '99+' : String(feed.unread);
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
  if (!feed.open && !quiet) { feed.unread++; renderBadge(); }
}
$('open-log').onclick = () => toggleFeed();
$('feed-close').onclick = () => toggleFeed(false);
$('feed-clear').onclick = () => { $('log').innerHTML = ''; };
// the office's life in the log (chit-chat, dreams, lunch, fires): shown or not, and it is saved
$('feed-life').onchange = (e) => {
  feed.life = e.target.checked;
  send({ type: 'prefs', prefs: { log: { life: feed.life } } });
  sysLine(t(feed.life ? 'ui.lifeOn' : 'ui.lifeOff'));
};

// ---------------------------------------------------------------- the context bar

const kTokens = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);
/** The context left, as a health bar next to the weather: the focused session's or, without a
 * chosen one, the latest session whose agent reports it. It is always there on an office's floor:
 * empty and grey until an agent reports its context (Claude Code, Pi and OpenCode do). */
function renderContext() {
  const cur = currentSession();
  const s = cur?.context?.max > 0 || focus ? cur : [...sessions.values()].filter((x) => x.context?.max > 0).sort((a, b) => b.lastAt - a.lastAt)[0];
  const c = s?.context?.max > 0 ? s.context : null;
  const bar = $('ctx-bar');
  bar.hidden = game.floor !== 'office';
  bar.classList.toggle('none', !c);
  if (!c) {
    game.sim.setContext(null);
    $('ctx-fill').style.width = $('ctx-trail').style.width = '0%';
    $('ctx-who').textContent = '';
    $('ctx-pct').textContent = '—';
    bar.title = t('ui.contextNone');
    $('ctx-meter').removeAttribute('aria-valuenow');
    $('ctx-meter').setAttribute('aria-label', bar.title);
    bar.classList.remove('mid', 'low');
    return;
  }
  const left = Math.max(0, Math.min(1, 1 - c.used / c.max));
  const pct = Math.round(left * 100);
  game.sim.setContext(left); // running out tires the team (sim.js)
  $('ctx-fill').style.width = `${left * 100}%`;
  $('ctx-trail').style.width = `${left * 100}%`;
  $('ctx-who').textContent = '';
  $('ctx-pct').textContent = `${pct}%`;
  const label = t('ui.contextAria', { pct, used: kTokens(c.used), max: kTokens(c.max) });
  bar.title = `${t('ui.context', { agent: AGENT_NAME[s.source] || s.source || '' })} · ${projectOf(s.id) || ''}`.replace(/ · $/, '') + `\n${label}`;
  $('ctx-meter').setAttribute('aria-valuenow', String(pct));
  $('ctx-meter').setAttribute('aria-label', label);
  bar.classList.toggle('mid', pct <= 50 && pct > 25);
  bar.classList.toggle('low', pct <= 25);
}

// An office can hold several projects (a few backends and their BFFs…): each session's project is
// its folder, and when more than one is active the log says which one each line is about.
const projectOf = (session) => { const cwd = sessions.get(session)?.cwd; return cwd ? cwd.split('/').filter(Boolean).pop() : ''; };
const severalProjects = () => new Set([...sessions.values()].filter((s) => s.cwd && Date.now() - s.lastAt < 6 * 3600_000).map((s) => s.cwd)).size > 1;

function addLog(ev, opts) {
  if (ev.kind === 'context') return; // it only moves the context bar
  const li = document.createElement('li');
  li.dataset.ev = '1';
  const cfg = personOf(ev.role);
  const who = ev.kind === 'chat' || ev.kind === 'poke' ? ev.from : cfg?.name || t('events.office');
  let text = ev.text || ev.kind;
  if (ev.kind === 'phase') {
    const ph = phaseInfo(ev.phase);
    text = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
  }
  if (ev.kind === 'phase_end') text = t('events.turnEnd', { text: ev.text ? `: ${ev.text}` : '' });
  if (ev.kind === 'pane_open' || ev.kind === 'pane_close') text = `🪟 ${ev.pane} · ${ev.text}${ev.kind === 'pane_close' ? ' ✔' : ''}`;
  if (ev.kind === 'standup') text = t('events.standup', { text: ev.text || '' });
  if (ev.kind === 'clarify') text = t(`events.clarify.${ev.phase}`, { project: ev.project || '', n: ev.n || 0, text: ev.text || '' });
  if (ev.kind === 'btw') text = ev.phase === 'ask' ? `❓ btw: ${ev.text}` : ev.phase === 'answer' ? `💡 ${ev.text}` : `✖ btw: ${ev.text}`;
  const name = el('b', '', `${ev.kind === 'btw' && ev.phase === 'ask' ? ev.from : who}: `);
  if (cfg) name.style.color = cfg.shirt;
  const body = el('span', ev.ok === false || (ev.kind === 'btw' && ev.phase === 'failed') ? 'err' : '');
  const project = severalProjects() ? projectOf(ev.session) : '';
  body.append(name, ...(project ? [el('span', 'proj', `[${project}] `)] : []), document.createTextNode(text), el('span', 'src', `  ${ev.source || ''}`));
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
    if (!feed.life || NOISY.has(j.kind)) continue;
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

// ---------------------------------------------------------------- talking to the characters

// You talk to each one on their sheet: what you say and what they answer stay there, like a chat.
// A question goes to the agent of the project and the task that character is working on, and they
// answer it (btw: in a forked session, without interrupting it). Anything else is said out loud and
// they answer in their own words. On your own sheet (the PO's) you talk to the whole team.
const talks = new Map(); // role → [{ who: 'you' | 'them', text, ts, ask?, status? }]
const isQuestion = (text) => /\?\s*$/.test(text) || /^\s*¿/.test(text);
function talk(role, line) {
  const list = talks.get(role) || [];
  list.push({ ts: Date.now(), ...line });
  while (list.length > 30) list.shift();
  talks.set(role, list);
  if (selected === role) renderTalk();
  return line;
}

const asked = new Map(); // a question (its text, then its id) → whose chat it goes to (a newcomer's is not their role's)
function say(text) {
  const q = String(text || '').trim();
  if (!q || !selected) return;
  if (ws?.readyState !== 1) { talk(selected, { who: 'them', text: t('conn.offline'), status: 'failed' }); return; }
  talk(selected, { who: 'you', text: q });
  const p = who();
  if (selected !== 'po' && isQuestion(q)) {
    talk(selected, { who: 'them', text: '', status: 'asking', ask: 'pending', question: q });
    asked.set(q, selected);
    // a newcomer answers from their own session (their subagent's), as one of their role
    return p.ghost ? askBtw(q, p.role, p.session, p.subId) : askBtw(q, selected);
  }
  if (p?.ghost) {
    // a newcomer is only in this office's game: they answer here, in their own words
    const lines = ta('sim.chatReplies', teamNames());
    const line = lines[Math.floor(Math.random() * lines.length)] || '👍';
    p.say(line, 3500);
    setTimeout(() => talk(p.id, { who: 'them', text: line, by: p.id }), 300);
    return;
  }
  send({ type: 'chat', text: q, role: selected === 'po' ? undefined : selected });
}

// btw: a side question to the agent on duty (about the domain, the team or the office). It answers
// in a forked session, without interrupting it; the answer shows on that character's sheet (or, if
// it is not open, in a card at the top) and in the log.
let btwTimer = null;
function askBtw(question, role = selected, session = focus, subId) {
  // the character you asked answers, from the project and the task it is working on (or the chosen session)
  send({ type: 'ask', text: question, role: role || undefined, session: session || undefined, subId: subId || undefined });
}
function onAsk(a) {
  if (!a || (office && a.office !== office.id)) return;
  // the conversation with whom was asked: its pending line becomes the answer
  if (!asked.has(a.id) && asked.has(a.question)) { asked.set(a.id, asked.get(a.question)); asked.delete(a.question); }
  const role = asked.get(a.id) || a.role || 'tl';
  const list = talks.get(role) || [];
  let line = list.find((x) => x.ask === a.id) || list.findLast((x) => x.ask === 'pending' && x.question === a.question);
  if (!line && a.status === 'asking') line = talk(role, { who: 'them', text: '', status: 'asking', question: a.question });
  if (line) {
    line.ask = a.id;
    line.status = a.status;
    line.text = a.status === 'answered' ? a.answer : a.status === 'failed' ? t('ui.btwFailed', { error: a.error || '' }) : '';
    if (selected === role) renderTalk();
  }
  if (selected === role && !$('sheet').hidden) { $('btw-card').hidden = true; return; } // it is already on their sheet
  const card = $('btw-card');
  clearTimeout(btwTimer);
  card.hidden = false;
  card.classList.toggle('asking', a.status === 'asking');
  card.classList.toggle('failed', a.status === 'failed');
  $('btw-q').textContent = a.question;
  const who = personOf(a.role)?.name || '';
  $('btw-who').textContent = [who, a.agent].filter(Boolean).join(' · ');
  $('btw-a').textContent = a.status === 'asking' ? t('ui.btwThinking') : a.status === 'answered' ? a.answer : t('ui.btwFailed', { error: a.error || '' });
  if (a.status !== 'asking') btwTimer = setTimeout(() => { if (!card.matches(':hover')) card.hidden = true; }, a.status === 'answered' ? 60_000 : 15_000);
}
$('btw-close').onclick = () => { clearTimeout(btwTimer); $('btw-card').hidden = true; };

/** Someone said something out loud: whoever answers in the office (their bubble) goes to the chat. */
function heardReply(ev) {
  const role = ev.role && ev.role !== 'po' ? ev.role : 'po';
  const who = role === 'po' ? 'manager' : role; // you are the PO: the team answers you
  const text = game.agents[who]?.bubble?.text;
  if (!talks.get(role)?.some((x) => x.who === 'you' && x.text === ev.text)) talk(role, { who: 'you', text: ev.text, from: ev.from });
  if (text) talk(role, { who: 'them', text, by: who });
}

function renderTalk() {
  const ol = $('sheet-talk');
  const list = talks.get(selected) || [];
  ol.innerHTML = '';
  if (!list.length && who()) ol.append(el('li', 'talk-empty', selected === 'po' ? t('ui.talkEmptyTeam') : t('ui.talkEmpty', { name: who().cfg.name })));
  for (const x of list.slice(-12)) {
    const by = x.who === 'you' ? null : who(x.by || selected)?.cfg;
    const li = el('li', `${x.who}${x.status ? ` ${x.status}` : ''}`);
    const name = el('b', '', x.who === 'you' ? (x.from && x.from !== t('events.you') ? x.from : t('ui.you')) : by?.name || '');
    if (by) name.style.color = by.shirt;
    li.append(name, el('span', '', x.status === 'asking' ? t('ui.btwThinking') : x.text));
    ol.append(li);
  }
  ol.scrollTop = ol.scrollHeight;
}
$('sheet-say').onsubmit = (e) => {
  e.preventDefault();
  const text = $('say-text').value;
  $('say-text').value = '';
  say(text);
};

// ---------------------------------------------------------------- the work (📋): the session, its task and its flow

function currentSession() {
  if (focus && sessions.has(focus)) return sessions.get(focus);
  return [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt)[0] || null;
}

function renderSessions() {
  const sel = $('session');
  const list = [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt);
  sel.innerHTML = '';
  sel.append(new Option(t('ui.latest'), ''));
  for (const s of list) sel.append(new Option([projectOf(s.id), AGENT_NAME[s.source] || s.source, s.id.slice(0, 8)].filter(Boolean).join(' · '), s.id));
  sel.value = focus || '';

  const s = currentSession();
  game.setBoard(s);
  boardView.refresh();
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
    const cfg = personOf(step.role);
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
  if (a.stress?.n >= 3) return t('ui.mood.stressed', { n: a.stress.n, g: a.cfg.sex });
  if (a.tired && game.sim.fatigue) return t('ui.mood.tired', { pct: Math.round(game.sim.fatigue.left * 100), g: a.cfg.sex });
  return t(`state.${a.state}`, { g: a.cfg.sex });
}

function renderTeam() {
  const ul = $('team');
  ul.innerHTML = '';
  for (const [id, cfg] of Object.entries(TEAM)) {
    const a = game.agents[id];
    const li = document.createElement('li');
    li.className = selected === id ? 'sel' : '';
    li.onclick = () => { $('work').close(); select(id); };
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
/** Who is selected: one of the team, or a newcomer (a subagent: 'new:<id>'). */
const who = (id = selected) => (id ? game.person(id) : null);
const isNewcomer = (id = selected) => !!who(id)?.ghost;

function select(id) {
  if (id && !who(id)) id = null;
  const changed = id !== selected;
  selected = id;
  game.select(id);
  renderTeam();
  renderSheet(true);
  renderTalk();
  if (id && changed) {
    const p = who(id);
    $('say-text').placeholder = id === 'po' ? t('ui.talkTeamPh') : t('ui.talkPh', { name: p.cfg.name });
    $('say-text').value = '';
    fitSay();
  }
}

/** Their card: who they are, what they are doing right now and, in a corner, what they did lately. */
function renderSheet(full) {
  const box = $('sheet');
  const a = who();
  if (!a) { box.hidden = true; if (selected) select(null); return; }
  const cfg = a.cfg;
  box.hidden = false;
  const look = `${selected}:${cfg.shirt}${cfg.hair}${cfg.skin}${cfg.pants}${cfg.long}${cfg.beard}${cfg.glasses}${cfg.sex}`;
  if (full || portraitOf !== look) {
    portraitOf = look;
    drawSprite($('sheet-portrait'), cfg, { P: 4, bg: a.ghost ? '#c7d6e6' : '#c9b48a' });
    $('sheet-name').textContent = cfg.name;
    $('sheet-name').style.color = cfg.shirt;
    const role = a.ghost ? t(a.specialist ? 'ui.visitorOf' : 'ui.newcomerOf', { role: personOf(a.role)?.title || a.role, project: a.project || '' }).replace(/ · $/, '') : cfg.title;
    $('sheet-role').textContent = `${role}${a.badges.size ? ` · ${t('ui.subagents', { n: a.badges.size })}` : ''}`;
  }
  $('sheet-mood').textContent = `${moodOf(a)}${a.text && ['working', 'thinking', 'red'].includes(a.state) ? `: ${a.text}` : ''}`;
  if (box.querySelector('.sheet-more').open || full) {
    const ul = $('sheet-history');
    ul.innerHTML = '';
    if (!a.history.length) ul.append(el('li', '', t('ui.nothingYet')));
    for (const h of a.history.slice(0, 8)) ul.append(el('li', '', `${hhmm(h.ts)} — ${h.text}`));
  }
}
setInterval(() => { renderSheet(); if ($('work').open) renderTeam(); }, 500);
$('sheet-close').onclick = () => select(null);
$('poke').onclick = () => {
  if (!selected) return;
  // a newcomer is only in this office's game: they answer here
  if (isNewcomer()) { const g = who(); g.jumpUntil = performance.now() + 700; g.say(t('sim.poke', { from: t('events.you') }), 2500); return; }
  send({ type: 'poke', role: selected });
};
// Enter sends; Shift+Enter, a new line. The box grows with what you write.
function fitSay() {
  const box = $('say-text');
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
}
$('say-text').oninput = fitSay;
$('say-text').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('sheet-say').requestSubmit(); }
};

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
    const who = personOf(p.role);
    const tag = el('span', '', `🪟 ${p.pane}`);
    tag.style.color = who?.shirt || '';
    li.append(tag, el('span', '', ` ${who?.name || p.role} · ${p.title}`), el('span', 'st-running', p.status || ''));
    ul.append(li);
  }
}

function alertTask(error) {
  if ($('brief').open) { $('b-problem').textContent = t('brief.failed', { error }); return; }
  sysLine(`✖ ${t('brief.failed', { error })}`, 'echo');
  toggleFeed(true);
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
      const chip = el('span', `r-stage ${st.status}`, `${STAGE_ICON[st.status] || '·'} ${personOf(st.role)?.name || st.role} · ${phaseInfo(st.phase).label}${st.attempts > 1 ? ` ×${st.attempts}` : ''}`);
      chip.style.setProperty('--c', personOf(st.role)?.shirt || '#888');
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

/** The brief's agents, grouped by project (each one works only inside its folder). */
function fillByProject(select, items, index) {
  select.innerHTML = '';
  const groups = new Map();
  items.forEach((x, i) => {
    const project = String(x.path || '').split('/').filter(Boolean).pop() || x.name;
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push([x, i]);
  });
  for (const [project, list] of groups) {
    const g = document.createElement('optgroup');
    g.label = `📁 ${project}`;
    for (const [x, i] of list) g.append(new Option(targetLabel(x), String(i)));
    select.append(g);
  }
  select.value = String(Math.min(index, Math.max(0, items.length - 1)));
}

function fillSelect(select, items, index, label = (x) => x.label) {
  select.innerHTML = '';
  items.forEach((item, i) => select.append(new Option(label(item), String(i))));
  select.value = String(Math.min(index, Math.max(0, items.length - 1)));
}

function renderBrief() {
  const o = brief.opts = briefOptions({ targets, models: prefs?.models }, brief.sel);
  if (targets.length) fillByProject($('b-agent'), targets, brief.sel.target);
  else fillSelect($('b-agent'), [{ label: t('brief.noAgentWeb') }], 0);
  $('b-agent').disabled = !targets.length;
  fillSelect($('b-pipeline'), o.entries.length ? o.entries : [{ label: '—' }], Math.max(0, o.entries.indexOf(o.entry)));
  $('b-desc').textContent = o.entry ? [o.entry.description, o.entry.source && o.entry.source !== 'agente' ? `(${o.entry.source})` : ''].filter(Boolean).join(' ')
    : t('brief.registerHintWeb');
  fillSelect($('b-session'), o.sessions.length ? o.sessions : [{ label: '—' }], o.sessionIndex);
  fillSelect($('b-profile'), o.profiles, o.profileIndex);
  $('b-profile-note').textContent = o.profileNote;

  const box = $('b-stages');
  box.innerHTML = '';
  if (o.stages.length) {
    box.append(el('h3', '', t('brief.stages', { who: t(o.entry.devteam ? 'brief.bySession' : 'brief.byHarness') })));
    o.stages.forEach((st, i) => {
      const card = el('div', 'b-stage');
      card.style.setProperty('--c', personOf(st.role)?.shirt || '#888');
      card.append(el('span', 'n', String(i + 1)), el('span', 'who', `${personOf(st.role)?.name || st.role} · ${phaseInfo(st.phase).label} — ${st.name}`));
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
$('b-profile').onchange = (e) => { brief.sel = { ...brief.sel, profile: Number(e.target.value) }; renderBrief(); };
$('b-text').oninput = () => renderBrief();
$('b-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('brief-form').requestSubmit(); };
$('brief-close').onclick = $('brief-cancel').onclick = () => $('brief').close();
$('new-brief').onclick = () => openBrief();

// ⚙ Settings: general, offices, the agents maintainer and the characters' appearance.
const settings = createSettings({
  getTargets: () => targets, getOffices: () => offices, getOffice: () => office, getPrefs: () => prefs, getHerdr: () => herdr,
  onPrompt: (id) => { $('settings').close(); openBrief(id); },
  onView: (id) => viewOffice(id),
  alerts: { get: alertPrefs, set: setAlertPrefs },
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

$('session').onchange = (e) => { focus = e.target.value || null; renderSessions(); renderContext(); };
$('standup').onclick = () => { send({ type: 'standup' }); $('work').close?.(); };
$('demo').onclick = () => send({ type: 'command', action: 'demo' });
$('demo-pi').onclick = () => send({ type: 'command', action: 'demo-pi' });
$('reset').onclick = () => send({ type: 'command', action: 'reset' });
setInterval(() => { if (!$('work').open) renderTeam(); }, 2000); // statuses expire on the client

/** 📋 (or w): the work — the session's task, its flow, the pipelines, the tasks, the demos and the team. */
function openWork() {
  const dlg = $('work');
  if (!dlg.open) dlg.showModal();
  renderSessions();
  renderTeam();
}
$('open-work').onclick = () => openWork();
$('work-close').onclick = () => $('work').close();

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
  $('screen').dataset.view = game.view;
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
    if (selected) select(null); else if (feed.open) toggleFeed(false);
    return;
  }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === 'a') { e.preventDefault(); toggleFeed(); }
  else if (k === 'w') { e.preventDefault(); openWork(); }
  else if (k === 't') { e.preventDefault(); if (game.floor === 'exec') directivesUi.open(); else if (game.floor === 'archive') archiveUi.open({ create: true }); else openBrief(); }
  else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); moveFloor(e.key === 'PageUp' ? -1 : 1); }
  else if (k === 'c') { e.preventDefault(); settings.open(); }
  else if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
  else if (k === 'v') { e.preventDefault(); toggleView(); }
  else if (k === 'o') { e.preventDefault(); nextOffice(); }
  else if (k === 'l') { e.preventDefault(); servicesUi.open(); }
  else if (k === 'r') { if (promptsUi.open()) e.preventDefault(); }
});

applyI18n();
renderWeather();
const welcome = sysLine(t('ui.welcome'));
onLanguage(() => { welcome.textContent = t('ui.welcome'); });
connect();
