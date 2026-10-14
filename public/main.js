import { createGame, TEAM, phaseInfo } from './game.js';
import { applyAppearance } from './sim.js';
import { AGENT_NAME, TASK_STATUS } from './targets.js';
import { briefOptions, briefProblem, briefMessage, defaultProject, projectLabel } from './brief.js';
import { createSettings } from './settings-ui.js';

const $ = (id) => document.getElementById(id);
const STATUS_LABEL = { idle: 'libre', working: 'trabajando', thinking: 'pensando', blocked: 'bloqueado', waiting: 'esperando', done: 'listo', coffee: 'café', talking: 'hablando', red: 'en rojo' };
const SESSION_LABEL = { active: 'en curso', waiting: 'esperándote', done: 'terminada', ended: 'cerrada' };
const OFFICE_SESSION = 'office'; // chat y saludos, no es una sesión de agente

const sessions = new Map();
let focus = null;      // sesión fijada por el usuario (null = la más reciente)
let selected = null;
let ws;
let tasks = { tasks: [], agents: [], launchers: [], defaultCwd: '' };
let runs = [];
let projects = []; // los que anuncian los agentes conectados (con sus pipelines)

const game = createGame($('office'), { onSelect: (id) => select(id), onBoardClick: () => openBrief() });

// ---------------------------------------------------------------- socket

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/v1/ws`);
  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connect, 1500); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'snapshot') { onSnapshot(msg.state); if (msg.state.tasks) onTasks(msg.state); onRuns(msg.state.pipelines || []); onProjects(msg.state.projects); }
    if (msg.type === 'pipelines') { onRuns(msg.runs); onProjects(msg.projects); }
    if (msg.type === 'snapshot' || msg.type === 'appearance') { applyAppearance((msg.state || msg).appearance || {}); renderTeam(); if (selected) renderDetail(); }
    if (msg.type === 'event') onEvent(msg.event, msg.session);
    if (msg.type === 'tasks') onTasks(msg);
    if (msg.type === 'ack' && msg.ok === false) alertTask(msg.error);
    if (msg.type === 'ack' && msg.ok && msg.run) $('brief').close();
  };
}
const send = (obj) => ws?.readyState === 1 && ws.send(JSON.stringify(obj));

function setConn(on) {
  $('conn').className = `conn ${on ? 'on' : 'off'}`;
  $('conn').textContent = on ? 'en vivo' : 'desconectado';
}

function onSnapshot(state) {
  game.reset();
  sessions.clear();
  for (const s of state.sessions) if (s.id !== OFFICE_SESSION) sessions.set(s.id, s);
  $('log').innerHTML = '';
  state.log.forEach(addLog);
  if (focus && !sessions.has(focus)) focus = null;
  renderSessions();
  renderTeam();
  renderDetail();
}

function onEvent(ev, session) {
  if (session && session.id !== OFFICE_SESSION) sessions.set(session.id, session);
  const current = currentSession();
  // Los eventos de otras sesiones mueven al equipo igual, pero el tablero muestra la sesión enfocada.
  game.handle(ev);
  if (!current || ev.session === current.id) game.setBoard(currentSession());
  addLog(ev);
  renderSessions();
  renderTeam();
  if (session?.source === 'claude-code' && $('brief').open) renderBrief();
  if (selected === ev.role) renderDetail();
}

// ---------------------------------------------------------------- UI

function currentSession() {
  if (focus && sessions.has(focus)) return sessions.get(focus);
  return [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt)[0] || null;
}

function renderSessions() {
  const sel = $('session');
  const list = [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt);
  sel.innerHTML = '';
  sel.append(new Option('Más reciente', ''));
  for (const s of list) sel.append(new Option(`${s.source} · ${s.id.slice(0, 8)}`, s.id));
  sel.value = focus || '';

  const s = currentSession();
  game.setBoard(s);
  $('task-title').textContent = s?.title || (s ? 'Sesión sin tarea todavía' : 'Esperando eventos de un agente…');
  const todos = s?.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  $('progress-bar').style.width = todos.length ? `${(100 * done) / todos.length}%` : s?.status === 'done' ? '100%' : '0';
  $('st-tools').textContent = s?.tools ?? 0;
  $('st-errors').textContent = s?.errors ?? 0;
  $('st-subs').textContent = s?.subagents?.filter((x) => x.open).length ?? 0;
  $('st-status').textContent = s ? SESSION_LABEL[s.status] || s.status : '—';
  renderFlow(s);
}

// Flujo por roles declarado por el agente: Tomás · Arquitectura → Andrés · RED → Diego · Implementa → …
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

function renderTeam() {
  const ul = $('team');
  ul.innerHTML = '';
  for (const [id, cfg] of Object.entries(TEAM)) {
    const a = game.agents[id];
    const li = document.createElement('li');
    li.className = selected === id ? 'sel' : '';
    li.onclick = () => select(id);
    const dot = el('span', 'dot'); dot.style.background = cfg.shirt;
    const who = el('div');
    who.append(el('span', 'who', `${cfg.name} · ${cfg.title}`), el('span', 'what', a.text || 'Sin actividad'));
    li.append(dot, who, el('span', `pill ${a.state}`, STATUS_LABEL[a.state] || a.state));
    ul.append(li);
  }
}

function addLog(ev) {
  const ol = $('log');
  const li = document.createElement('li');
  const cfg = TEAM[ev.role];
  const dot = el('span', 'dot'); dot.style.background = cfg?.shirt || '#888';
  const who = ev.kind === 'chat' || ev.kind === 'poke' ? ev.from : cfg?.name || 'Oficina';
  const body = el('span', ev.ok === false ? 'err' : '');
  let text = ev.text || ev.kind;
  if (ev.kind === 'phase') {
    const ph = phaseInfo(ev.phase);
    text = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`;
  }
  if (ev.kind === 'phase_end') text = `termina su turno${ev.text ? `: ${ev.text}` : ''}`;
  body.append(el('b', '', `${who}: `), document.createTextNode(text), el('span', 'src', `  ${ev.source}`));
  li.append(el('time', '', new Date(ev.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })), dot, body);
  ol.prepend(li);
  while (ol.children.length > 150) ol.lastChild.remove();
}

function select(id) {
  selected = id;
  game.select(id);
  renderTeam();
  renderDetail();
}

function renderDetail() {
  const box = $('detail');
  if (!selected) { box.hidden = true; return; }
  const cfg = TEAM[selected], a = game.agents[selected];
  box.hidden = false;
  $('detail-name').textContent = cfg.name;
  const subs = a.badges.size ? ` · ${a.badges.size} subagente(s) asignado(s)` : '';
  $('detail-role').textContent = `${cfg.title} — ${STATUS_LABEL[a.state] || a.state}${subs}`;
  const ul = $('detail-history');
  ul.innerHTML = '';
  if (!a.history.length) ul.append(el('li', 'muted', 'Todavía no ha hecho nada en esta sesión.'));
  for (const h of a.history) ul.append(el('li', '', `${new Date(h.ts).toLocaleTimeString('es')} — ${h.text}`));
}

// ---------------------------------------------------------------- tareas para los agentes

function onTasks(snap) {
  tasks = snap;
  $('agents-count').textContent = tasks.agents.length ? `${tasks.agents.length} agente(s) conectado(s)` : '';
  renderTasks();
  if ($('brief').open) renderBrief();
}

function renderTasks() {
  const ul = $('tasks');
  ul.innerHTML = '';
  for (const t of tasks.tasks.slice(-6).reverse()) {
    const [icon, label] = TASK_STATUS[t.status] || ['·', t.status];
    const li = document.createElement('li');
    li.append(el('span', `st-${t.status}`, icon), el('span', '', `${AGENT_NAME[t.agent] || t.agent}${t.mode === 'launch' ? ' (nuevo)' : ''}: ${t.text}`));
    if (['running', 'queued', 'sent'].includes(t.status)) {
      const b = el('button', '', '✕');
      b.title = 'Cancelar';
      b.onclick = () => send({ type: 'task_cancel', id: t.id });
      li.append(b);
    } else li.append(el('span', `st-${t.status}`, label));
    const sub = t.status === 'running' && t.output?.length ? t.output.at(-1) : ['failed', 'queued'].includes(t.status) ? t.detail : '';
    if (sub) li.append(el('span', 'sub', sub));
    ul.append(li);
  }
}

function alertTask(error) {
  if ($('brief').open) { $('b-problem').textContent = `No se pudo: ${error}`; return; }
  const li = el('li', '', '');
  li.append(el('span', 'st-failed', '✖'), el('span', 'st-failed', `No se pudo: ${error}`));
  $('tasks').prepend(li);
}

// ---------------------------------------------------------------- pipelines en curso

const STAGE_ICON = { pending: '◷', running: '▶', done: '✔', failed: '✖', skipped: '⊘', cancelled: '⊘' };
const RUN_LABEL = { running: 'en curso', done: 'terminado', failed: 'falló', cancelled: 'cancelado' };

function onRuns(list) {
  runs = list || [];
  const ul = $('runs');
  ul.innerHTML = '';
  for (const r of runs.slice(-3).reverse()) {
    const li = document.createElement('li');
    const head = el('div', 'r-head');
    head.append(el('span', 'r-name', `${r.pipeline.name} · ${r.project.name}`));
    if (r.status === 'running') {
      const b = el('button', '', '✕ cancelar');
      b.onclick = () => send({ type: 'pipeline_cancel', id: r.id });
      head.append(b);
    } else head.append(el('span', `st-${r.status === 'done' ? 'done' : 'failed'}`, RUN_LABEL[r.status] || r.status));
    li.append(head, el('div', 'sub', `Lo ejecuta ${AGENT_NAME[r.agent] || r.agent}: ${r.task}`));
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

// ---------------------------------------------------------------- diálogo "Nuevo encargo"

const brief = { sel: { project: 0, pipeline: 0, target: 0 }, opts: null };

function onProjects(list) {
  projects = list || [];
  if ($('brief').open) renderBrief();
}

function openBrief() {
  const dlg = $('brief');
  if (!dlg.open) dlg.showModal();
  brief.sel = { project: defaultProject(projects, sessions.values()), pipeline: 0, target: 0 };
  renderBrief();
  $('b-text').focus();
}

function fillSelect(select, items, index, label = (x) => x.label) {
  select.innerHTML = '';
  items.forEach((item, i) => select.append(new Option(label(item), String(i))));
  select.value = String(Math.min(index, Math.max(0, items.length - 1)));
}

function renderBrief() {
  const o = brief.opts = briefOptions({ projects, tasks, sessions: sessions.values() }, brief.sel);
  fillSelect($('b-project'), projects.length ? projects : [{ label: 'Ningún agente anunció un proyecto' }], brief.sel.project, (p) => p.label || projectLabel(p));
  $('b-project').disabled = !projects.length;
  fillSelect($('b-pipeline'), o.pipelines, brief.sel.pipeline);
  $('b-desc').textContent = o.pipeline ? o.pipeline.description
    : !projects.length ? 'Los pipelines los anuncia cada agente al conectarse (los lee de .devteam/ en su proyecto).'
      : o.project && !o.project.hasConfig ? 'Este proyecto no tiene .devteam/: sólo tareas directas.' : '';
  fillSelect($('b-target'), o.targets.length ? o.targets : [{ label: 'Nadie disponible' }], brief.sel.target);

  const box = $('b-stages');
  box.innerHTML = '';
  if (o.stages.length) {
    box.append(el('h3', '', 'Etapas (las ejecuta el agente en su sesión)'));
    o.stages.forEach((st, i) => {
      const card = el('div', 'b-stage');
      card.style.setProperty('--c', TEAM[st.role]?.shirt || '#888');
      card.append(el('span', 'n', String(i + 1)), el('span', 'who', `${TEAM[st.role]?.name || st.role} · ${phaseInfo(st.phase).label} — ${st.name}`));
      const how = [st.agent, st.model].filter(Boolean).join(' · ');
      if (how || st.needs.length) card.append(el('span', 'how', `${how}${st.needs.length ? `  ← ${st.needs.join(', ')}` : ''}`));
      if (st.check) card.append(el('span', 'gate', `⚙ ${st.check.run} debe ${st.check.expect === 'pass' ? 'pasar' : 'fallar'}${st.onFail ? ` · si no, vuelve a ${st.onFail.goto} (×${st.onFail.max})` : ''}`));
      box.append(card);
    });
    if (o.pipeline.issues?.length) box.append(el('p', 'b-problem', o.pipeline.issues.join(' · ')));
  }
  const problem = briefProblem(o, $('b-text').value);
  $('b-problem').textContent = problem && $('b-text').value.trim() ? problem : '';
  $('brief-go').disabled = !!problem;
}

$('b-project').onchange = (e) => {
  brief.sel = { project: Number(e.target.value), pipeline: 0, target: 0 };
  renderBrief();
};
$('b-pipeline').onchange = (e) => {
  brief.sel = { ...brief.sel, pipeline: Number(e.target.value), target: 0 };
  renderBrief();
};
$('b-target').onchange = (e) => { brief.sel.target = Number(e.target.value); renderBrief(); };
$('b-text').oninput = () => renderBrief();
$('b-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('brief-form').requestSubmit(); };
$('brief-close').onclick = $('brief-cancel').onclick = () => $('brief').close();
$('open-brief').onclick = () => openBrief();

// ⚙ Ajustes: la apariencia de los personajes (de la oficina) y lo que anuncian los agentes.
const settings = createSettings();
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
$('chat').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  if (!text) return;
  send({ type: 'chat', text, role: selected || undefined });
  $('chat-text').value = '';
};
$('poke').onclick = () => selected && send({ type: 'poke', role: selected });
$('demo').onclick = () => send({ type: 'command', action: 'demo' });
$('demo-pi').onclick = () => send({ type: 'command', action: 'demo-pi' });
$('reset').onclick = () => send({ type: 'command', action: 'reset' });
setInterval(renderTeam, 2000); // los estados caducan en el cliente (vuelven a "libre")

connect();
