// Tareas que el usuario envía desde la oficina hacia un agente de código. La oficina es el
// frontend: entrega la tarea y muestra su estado; el trabajo lo hace el agente.
//
// - A una sesión abierta: Pi y OpenCode se conectan a la oficina (WebSocket, `register`) y
//   reciben la tarea al instante. Claude Code no tiene un canal así: la tarea queda en cola y
//   la entrega su hook `Stop` cuando Claude termina el turno en curso.
// - Una sesión nueva de un agente registrado (⚙ › Agentes, con su ruta): dentro de herdr, la
//   oficina abre al agente en un pane nuevo (interactivo, a la vista) y le manda el prompt; fuera de
//   herdr, abre su CLI en segundo plano en esa ruta (`claude -p`, `opencode run`, `pi -p`) con el
//   prompt o el comando que arranca el pipeline de su harness. No orquesta nada: el pipeline lo
//   corre el harness; la oficina dibuja lo que reportan sus hooks o plugins.
//
// Cada tarea es de una oficina (la del agente registrado, o la de la sesión que la recibe).

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip } from './roles.js';
import { sanitizeProject } from './pipeline.js';
import { agentCommand, HARNESSES, which } from '../integrations/common/devteam.mjs';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';

export const AGENT_LABEL = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi' };
const HARNESS_IDS = ['claude-code', 'opencode', 'pi'];
const TASKS_MAX = 50;
const TEXT_MAX = 4000;
const OUTPUT_LINES = 40;

export class TaskHub extends EventEmitter {
  /**
   * @param company  las oficinas (server/company.js): adónde va cada evento
   * @param store    la base (server/store.js): cada tarea queda en el historial de prompts
   * @param herdr    server/herdr.js: dentro de herdr, las sesiones nuevas se abren en un pane
   * @param prefs    () => los ajustes (herdr.launch, herdr.direction)
   */
  constructor(company, { cwd = process.cwd(), officeUrl, store, herdr = null, prefs = () => ({}), socket = null } = {}) {
    super();
    this.office = company;
    this.store = store;
    this.herdr = herdr;
    this.prefs = prefs;
    this.socket = socket;
    this.boot = Date.now().toString(36); // los ids de tarea se reinician con la oficina; en la base no
    this.officeUrl = officeUrl;
    this.defaultCwd = cwd;
    this.conns = new Map(); // agentes conectados por WebSocket
    this.tasks = new Map();
    this.children = new Map(); // sesiones lanzadas por la oficina, por id de tarea
    this.seq = 0;
  }

  // ---------------------------------------------------------------- agentes conectados

  /**
   * Un plugin/extensión se presenta (y se vuelve a presentar cuando cambia de sesión).
   * info: { agent, session, cwd, pid, can: ['task','pipeline'], project: { dir, name, pipelines } }
   */
  register(conn, info = {}) {
    const agent = String(info.agent || 'agente').slice(0, 30);
    let c = this.conns.get(conn.id);
    if (!c) {
      c = { id: conn.id, agent, sessions: new Set(), session: null, cwd: '', pid: null, can: [], project: null, connectedAt: Date.now(), send: conn.send };
      this.conns.set(conn.id, c);
    }
    c.agent = agent;
    c.cwd = clip(info.cwd || c.cwd, 300);
    c.pid = Number(info.pid) || c.pid;
    if (Array.isArray(info.can)) c.can = info.can.filter((x) => typeof x === 'string').slice(0, 10);
    if (info.project) c.project = sanitizeProject(info.project, c.cwd);
    if (info.session) { c.session = clip(info.session, 100); c.sessions.add(c.session); }
    // su oficina: la que dice (la oficina se la pasa al abrirlo), la de su sesión o la de su ruta
    if (c.session && !this.office.officeOfSession?.(c.session)) {
      this.office.bindSession?.(c.session, (info.office && this.office.has?.(info.office) && info.office) || this.office.officeForPath?.(c.cwd) || MAIN_OFFICE);
    }
    this.#changed();
    return { ok: true, id: c.id };
  }

  unregister(connId) {
    if (!this.conns.delete(connId)) return;
    for (const t of this.tasks.values()) if (t.connId === connId && ['sent', 'running'].includes(t.status) && t.mode === 'session') this.#set(t, 'failed', tr('task.disconnected'));
    this.#changed();
  }

  liveAgents() { return [...this.conns.values()]; }

  /** Envía un mensaje a la sesión de un agente conectado. false si no está conectada. */
  sendToSession(session, msg) {
    const c = [...this.conns.values()].find((x) => x.sessions.has(session));
    if (!c) return false;
    c.send(msg);
    return true;
  }

  #connFor(task) {
    const live = [...this.conns.values()].filter((c) => c.agent === task.agent);
    if (task.session) return live.find((c) => c.sessions.has(task.session)) || null;
    return live.sort((a, b) => b.connectedAt - a.connectedAt)[0] || null;
  }

  // ---------------------------------------------------------------- tareas

  /**
   * @param title   texto corto para la oficina (el tablero); por defecto, el propio texto
   * @param command, args  si la tarea es un comando del harness (`/task …`): el agente lo ejecuta
   *                como comando (OpenCode) o lo expande (Pi, Claude); `text` es "/comando args"
   * @param launch  { bin, args } del agente registrado, para una sesión nueva (mode: 'launch')
   * @param meta    { agentId, entry } para el historial: qué agente registrado y por qué entrada
   */
  submit({ text, title, agent, session, mode, cwd, from, command, args, launch, meta, office } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.taskEmpty') };
    if (text.length > TEXT_MAX) return { ok: false, error: tr('err.taskTooLong', { n: TEXT_MAX }) };
    session = session ? clip(session, 100) : null;
    agent = agent || (session && this.office.sessionSource(session)) || null;
    if (agent === 'claude') agent = 'claude-code';
    if (!agent) return { ok: false, error: tr('err.taskNoAgent') };

    const task = {
      id: `t${++this.seq}`, text, title: clip(title || text, 300), agent, session, mode: mode === 'launch' ? 'launch' : 'session',
      command: command ? clip(command, 60) : null, args: command ? String(args ?? '').slice(0, TEXT_MAX) : null,
      cwd: null, status: 'new', detail: '', output: [], from: clip(from || tr('events.office'), 30), createdAt: Date.now(), updatedAt: Date.now(),
      agentId: meta?.agentId || null, entry: meta?.entry || null,
      office: office || (session && this.office.officeOfSession?.(session)) || MAIN_OFFICE, pane: null,
    };

    if (task.mode === 'launch') {
      if (!HARNESS_IDS.includes(agent)) return { ok: false, error: tr('err.cantLaunch', { agent }) };
      task.cwd = path.resolve(String(cwd || this.defaultCwd).replace(/^~(?=$|\/)/, os.homedir()));
      if (!fs.statSync(task.cwd, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: tr('err.noDir', { dir: task.cwd }) };
      const cmd = agentCommand(agent, { text, command: task.command, args: task.args }, launch || {});
      if (cmd.error) return { ok: false, error: cmd.code === 'missing' ? tr('err.notInstalled', { bin: cmd.bin }) : tr('err.cantLaunch', { agent }) };
      this.#add(task);
      this.#dispatchEvent(task);
      if (this.inPanes) this.#launchInPane(task, launch || {});
      else this.#launch(task, cmd);
      return { ok: true, task: this.#public(task) };
    }

    const conn = this.#connFor(task);
    if (!conn && agent !== 'claude-code') {
      return { ok: false, error: tr('err.noSession', { agent: AGENT_LABEL[agent] || agent }) };
    }
    if (!conn && !session) return { ok: false, error: tr('err.pickClaude') };
    this.#add(task);
    this.#dispatchEvent(task);
    if (conn) this.#deliver(task, conn);
    else this.#set(task, 'queued', tr('task.queuedClaude'));
    return { ok: true, task: this.#public(task) };
  }

  /** ¿Las sesiones nuevas se abren en panes de herdr? (dentro de herdr, salvo que se apague en ⚙) */
  get inPanes() { return !!this.herdr?.available && this.prefs()?.herdr?.launch !== false; }

  // Dentro de herdr: el agente se abre en un pane nuevo, interactivo, y recibe la tarea como prompt.
  // Desde ahí orquesta lo suyo (y puede abrir más panes); la tarea termina cuando su turno termina.
  async #launchInPane(task, { bin, args }) {
    const label = AGENT_LABEL[task.agent] || task.agent;
    const env = { DEV_TEAM_OFFICE_URL: this.officeUrl, DEV_TEAM_OFFICE_OFFICE: task.office, ...(this.socket ? { DEV_TEAM_OFFICE_SOCKET: this.socket } : {}) };
    // la extensión de Pi adopta este id de sesión: así la tarea sabe qué sesión la está haciendo
    if (task.agent === 'pi') { env.DEV_TEAM_OFFICE_SESSION = `pi-${task.id}`; task.session = env.DEV_TEAM_OFFICE_SESSION; }
    this.#set(task, 'running', tr('task.inPane', { agent: label, pane: '…' }));
    try {
      const prefs = this.prefs() || {};
      const { pane } = await this.herdr.launchAgent({
        harness: task.agent, cwd: task.cwd, prompt: task.text, bin, args: Array.isArray(args) ? args : [], env,
        direction: prefs.herdr?.direction, office: task.office, officeName: this.officeName?.(task.office) || '',
        role: 'manager', title: task.title, taskId: task.id, label: `${label} · ${path.basename(task.cwd)}`,
      });
      task.pane = pane;
      this.office.bindPane?.(pane, task.office);
      if (task.session) this.office.bindSession?.(task.session, task.office);
      this.#set(task, 'running', tr('task.inPane', { agent: label, pane }));
    } catch (err) {
      this.#set(task, 'failed', tr('err.herdrFailed', { error: err.message }));
    }
  }

  /** El agente de un pane terminó su turno (herdr lo ve idle o done): su tarea queda hecha. */
  paneSettled(pane) {
    const t = [...this.tasks.values()].find((x) => x.pane === pane && x.status === 'running');
    if (t) this.#set(t, 'done', tr('task.paneIdle', { pane }));
  }

  /** La sesión que abrió el agente de un pane (llega en su primer evento). */
  paneSession(pane, session) {
    const t = [...this.tasks.values()].find((x) => x.pane === pane && !x.session);
    if (t) { t.session = clip(session, 100); this.#changed(); }
  }

  // Una sesión nueva del agente, en su directorio. La tarea va como un único argumento, sin shell.
  #launch(task, { exe, argv }) {
    const env = { ...process.env, DEV_TEAM_OFFICE_LAUNCHED: '1', ...(this.officeUrl ? { DEV_TEAM_OFFICE_URL: this.officeUrl } : {}) };
    delete env.DEV_TEAM_OFFICE_SESSION_ALIAS;
    // la extensión de Pi adopta este id de sesión: así la tarea sabe qué sesión la está haciendo
    if (task.agent === 'pi') { env.DEV_TEAM_OFFICE_SESSION = `pi-${task.id}`; task.session = env.DEV_TEAM_OFFICE_SESSION; } else delete env.DEV_TEAM_OFFICE_SESSION;
    let child;
    try {
      child = spawn(exe, argv, { cwd: task.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) {
      this.#set(task, 'failed', err.message);
      return;
    }
    this.children.set(task.id, child);
    this.#set(task, 'running', tr('task.runningIn', { exe: path.basename(exe), dir: task.cwd.replace(os.homedir(), '~') }));
    const collect = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        task.output.push(clip(line, 300));
        if (task.output.length > OUTPUT_LINES) task.output.shift();
      }
      this.#changed();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => this.#set(task, 'failed', err.message));
    child.on('close', (code, signal) => {
      this.children.delete(task.id);
      if (task.status === 'cancelled') return this.#changed();
      if (code === 0) this.#set(task, 'done', tr('task.finished'));
      else this.#set(task, 'failed', signal ? tr('task.killed', { signal }) : tr('task.exitCode', { code, last: task.output.length ? `: ${task.output.at(-1)}` : '' }));
    });
  }

  /** Corta las sesiones lanzadas por la oficina (al cerrarla). */
  stopAll() {
    for (const child of this.children.values()) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }
  }

  #deliver(task, conn) {
    task.connId = conn.id;
    task.session ||= conn.session;
    this.#set(task, 'sent', tr('task.sentTo', { agent: AGENT_LABEL[conn.agent] || conn.agent }));
    conn.send({ type: 'task', id: task.id, text: task.text, session: task.session, ...(task.command ? { command: task.command, args: task.args } : {}) });
  }

  /** Respuesta del agente: accepted | done | failed | rejected. */
  update(connId, { id, status, error, detail } = {}) {
    const t = this.tasks.get(String(id));
    if (!t || (t.connId !== undefined && t.connId !== connId)) return { ok: false, error: tr('err.unknownTask') };
    if (status === 'accepted') {
      this.#set(t, 'running', clip(detail, 200) || tr('task.accepted'));
      this.#startedEvent(t);
    } else if (status === 'done') this.#set(t, 'done', tr('task.finished'));
    else if (status === 'failed' || status === 'rejected') {
      this.#set(t, 'failed', clip(error || tr('task.failedDefault'), 200));
      this.office.ingest('generic', { session: t.session || 'office', office: t.office, kind: 'error', role: 'manager', text: tr('task.failedEvent', { agent: AGENT_LABEL[t.agent] || t.agent, detail: t.detail }) });
    }
    return { ok: true };
  }

  /** Para el hook Stop de Claude Code: la siguiente tarea en cola para esa sesión. */
  takeForClaude(session) {
    const t = [...this.tasks.values()].find((x) => x.agent === 'claude-code' && x.status === 'queued' && x.session === session);
    if (!t) return null;
    this.#set(t, 'running', tr('task.claudeTook'));
    this.#startedEvent(t);
    return t;
  }

  cancel(id) {
    const t = this.tasks.get(String(id));
    if (!t) return { ok: false, error: tr('err.unknownTask') };
    if (['queued', 'sent'].includes(t.status)) { this.#set(t, 'cancelled', tr('task.cancelled')); return { ok: true }; }
    const child = this.children.get(t.id);
    if (child) {
      this.#set(t, 'cancelled', tr('task.cancelled'));
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ }
      return { ok: true };
    }
    return { ok: false, error: tr('err.cantCancel', { status: tr(`taskStatus.${t.status}`) }) };
  }

  // ---------------------------------------------------------------- estado

  #add(task) {
    this.tasks.set(task.id, task);
    if (this.tasks.size > TASKS_MAX) {
      const old = [...this.tasks.values()].find((t) => !['running', 'queued', 'sent'].includes(t.status));
      if (old) this.tasks.delete(old.id);
    }
  }

  #set(task, status, detail) {
    task.status = status;
    task.detail = detail || '';
    task.updatedAt = Date.now();
    this.#save(task);
    this.#changed();
  }

  #save(t) {
    try {
      this.store?.savePrompt({ id: `${this.boot}-${t.id}`, agentId: t.agentId, agent: t.agent, entry: t.entry, text: t.title, session: t.session, mode: t.mode, cwd: t.cwd, status: t.status, detail: t.detail });
    } catch { /* el historial no puede romper el envío */ }
  }

  #changed() { this.emit('change', this.snapshot()); }

  // La oficina lo anima: la PO se lleva la tarjeta a la pizarra.
  #dispatchEvent(task) {
    this.office.ingest('generic', {
      session: 'office', office: task.office, kind: 'dispatch', agent: task.agent, mode: task.mode, from: task.from,
      text: tr(task.mode === 'launch' ? 'task.dispatchNew' : 'task.dispatch', { agent: AGENT_LABEL[task.agent] || task.agent, title: task.title }),
    });
  }

  // La sesión destino recibe la tarea como su nuevo pedido (el tablero cambia de título).
  #startedEvent(task) {
    if (task.session) this.office.ingest(task.agent, { session: task.session, office: task.office, kind: 'task', text: task.title });
  }

  #public(t) {
    return {
      id: t.id, text: t.title, agent: t.agent, agentId: t.agentId, entry: t.entry, session: t.session, mode: t.mode, cwd: t.cwd, command: t.command, status: t.status, detail: t.detail, office: t.office, pane: t.pane,
      output: t.mode === 'launch' ? t.output.slice(-12) : undefined, from: t.from, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }

  /** La oficina de un agente conectado: la de su sesión, o la de su ruta. */
  connOffice(c) { return (c.session && this.office.officeOfSession?.(c.session)) || this.office.officeForPath?.(c.cwd) || MAIN_OFFICE; }

  /** @param office sólo lo de esa oficina (sin oficina: todo) */
  snapshot(office) {
    const mine = (o) => !office || (o || MAIN_OFFICE) === office;
    return {
      tasks: [...this.tasks.values()].filter((t) => mine(t.office)).slice(-20).map((t) => this.#public(t)),
      agents: [...this.conns.values()].filter((c) => mine(this.connOffice(c))).map((c) => ({ id: c.id, agent: c.agent, session: c.session, cwd: c.cwd, pid: c.pid, can: c.can, project: c.project?.name || null, connectedAt: c.connectedAt })),
      // Sesiones nuevas: la oficina abre el CLI del agente (si está instalado).
      launchers: HARNESS_IDS.map((agent) => ({ agent, available: !!which(agent === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[agent].bin) })),
      defaultCwd: this.defaultCwd,
    };
  }
}
