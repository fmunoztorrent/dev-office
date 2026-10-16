// Tareas que el usuario envía desde la oficina hacia un agente de código. La oficina es el
// frontend: entrega la tarea y muestra su estado; el trabajo lo hace el agente.
//
// - A una sesión abierta: Pi y OpenCode se conectan a la oficina (WebSocket, `register`) y
//   reciben la tarea al instante. Claude Code no tiene un canal así: la tarea queda en cola y
//   la entrega su hook `Stop` cuando Claude termina el turno en curso.
// - Una sesión nueva de un agente registrado (⚙ › Agentes, con su ruta): la oficina abre su CLI
//   en esa ruta (`claude -p`, `opencode run`, `pi -p`) con el prompt o el comando que arranca el
//   pipeline de su harness. No orquesta nada: el pipeline lo corre el harness; la oficina dibuja
//   lo que reportan sus hooks o plugins.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip } from './roles.js';
import { sanitizeProject } from './pipeline.js';
import { agentCommand, HARNESSES, which } from '../integrations/common/devteam.mjs';

export const AGENT_LABEL = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi' };
const HARNESS_IDS = ['claude-code', 'opencode', 'pi'];
const TASKS_MAX = 50;
const TEXT_MAX = 4000;
const OUTPUT_LINES = 40;

export class TaskHub extends EventEmitter {
  /** @param store la base (server/store.js): cada tarea queda en el historial de prompts */
  constructor(office, { cwd = process.cwd(), officeUrl, store } = {}) {
    super();
    this.office = office;
    this.store = store;
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
    this.#changed();
    return { ok: true, id: c.id };
  }

  unregister(connId) {
    if (!this.conns.delete(connId)) return;
    for (const t of this.tasks.values()) if (t.connId === connId && ['sent', 'running'].includes(t.status) && t.mode === 'session') this.#set(t, 'failed', 'el agente se desconectó');
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
  submit({ text, title, agent, session, mode, cwd, from, command, args, launch, meta } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: 'la tarea está vacía' };
    if (text.length > TEXT_MAX) return { ok: false, error: `la tarea supera ${TEXT_MAX} caracteres` };
    session = session ? clip(session, 100) : null;
    agent = agent || (session && this.office.sessions.get(session)?.source) || null;
    if (agent === 'claude') agent = 'claude-code';
    if (!agent) return { ok: false, error: 'falta el agente destino' };

    const task = {
      id: `t${++this.seq}`, text, title: clip(title || text, 300), agent, session, mode: mode === 'launch' ? 'launch' : 'session',
      command: command ? clip(command, 60) : null, args: command ? String(args ?? '').slice(0, TEXT_MAX) : null,
      cwd: null, status: 'new', detail: '', output: [], from: clip(from || 'Oficina', 30), createdAt: Date.now(), updatedAt: Date.now(),
      agentId: meta?.agentId || null, entry: meta?.entry || null,
    };

    if (task.mode === 'launch') {
      if (!HARNESS_IDS.includes(agent)) return { ok: false, error: `no sé lanzar "${agent}"` };
      task.cwd = path.resolve(String(cwd || this.defaultCwd).replace(/^~(?=$|\/)/, os.homedir()));
      if (!fs.statSync(task.cwd, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: `no existe el directorio ${task.cwd}` };
      const cmd = agentCommand(agent, { text, command: task.command, args: task.args }, launch || {});
      if (cmd.error) return { ok: false, error: cmd.error };
      this.#add(task);
      this.#dispatchEvent(task);
      this.#launch(task, cmd);
      return { ok: true, task: this.#public(task) };
    }

    const conn = this.#connFor(task);
    if (!conn && agent !== 'claude-code') {
      return { ok: false, error: `no hay ninguna sesión de ${AGENT_LABEL[agent] || agent} conectada; pide una nueva` };
    }
    if (!conn && !session) return { ok: false, error: 'elige una sesión de Claude Code' };
    this.#add(task);
    this.#dispatchEvent(task);
    if (conn) this.#deliver(task, conn);
    else this.#set(task, 'queued', 'se entrega cuando Claude termine su turno');
    return { ok: true, task: this.#public(task) };
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
    this.#set(task, 'running', `${path.basename(exe)} en ${task.cwd.replace(os.homedir(), '~')}`);
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
      if (code === 0) this.#set(task, 'done', 'terminada');
      else this.#set(task, 'failed', signal ? `cortada (${signal})` : `salió con código ${code}${task.output.length ? `: ${task.output.at(-1)}` : ''}`);
    });
  }

  /** Corta las sesiones lanzadas por la oficina (al cerrarla). */
  stopAll() {
    for (const child of this.children.values()) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }
  }

  #deliver(task, conn) {
    task.connId = conn.id;
    task.session ||= conn.session;
    this.#set(task, 'sent', `enviada a ${AGENT_LABEL[conn.agent] || conn.agent}`);
    conn.send({ type: 'task', id: task.id, text: task.text, session: task.session, ...(task.command ? { command: task.command, args: task.args } : {}) });
  }

  /** Respuesta del agente: accepted | done | failed | rejected. */
  update(connId, { id, status, error, detail } = {}) {
    const t = this.tasks.get(String(id));
    if (!t || (t.connId !== undefined && t.connId !== connId)) return { ok: false, error: 'tarea desconocida' };
    if (status === 'accepted') {
      this.#set(t, 'running', clip(detail, 200) || 'el agente la está haciendo');
      this.#startedEvent(t);
    } else if (status === 'done') this.#set(t, 'done', 'terminada');
    else if (status === 'failed' || status === 'rejected') {
      this.#set(t, 'failed', clip(error || 'el agente no pudo con la tarea', 200));
      this.office.ingest('generic', { session: t.session || 'office', kind: 'error', role: 'manager', text: `${AGENT_LABEL[t.agent] || t.agent} no pudo con la tarea: ${t.detail}` });
    }
    return { ok: true };
  }

  /** Para el hook Stop de Claude Code: la siguiente tarea en cola para esa sesión. */
  takeForClaude(session) {
    const t = [...this.tasks.values()].find((x) => x.agent === 'claude-code' && x.status === 'queued' && x.session === session);
    if (!t) return null;
    this.#set(t, 'running', 'Claude la tomó al terminar su turno');
    this.#startedEvent(t);
    return t;
  }

  cancel(id) {
    const t = this.tasks.get(String(id));
    if (!t) return { ok: false, error: 'tarea desconocida' };
    if (['queued', 'sent'].includes(t.status)) { this.#set(t, 'cancelled', 'cancelada'); return { ok: true }; }
    const child = this.children.get(t.id);
    if (child) {
      this.#set(t, 'cancelled', 'cancelada');
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ }
      return { ok: true };
    }
    return { ok: false, error: `no se puede cancelar una tarea ${t.status}: ya la tiene el agente` };
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
      session: 'office', kind: 'dispatch', agent: task.agent, mode: task.mode, from: task.from,
      text: `${task.mode === 'launch' ? 'Sesión nueva de' : 'Para'} ${AGENT_LABEL[task.agent] || task.agent}: ${task.title}`,
    });
  }

  // La sesión destino recibe la tarea como su nuevo pedido (el tablero cambia de título).
  #startedEvent(task) {
    if (task.session) this.office.ingest(task.agent, { session: task.session, kind: 'task', text: task.title });
  }

  #public(t) {
    return {
      id: t.id, text: t.title, agent: t.agent, agentId: t.agentId, entry: t.entry, session: t.session, mode: t.mode, cwd: t.cwd, command: t.command, status: t.status, detail: t.detail,
      output: t.mode === 'launch' ? t.output.slice(-12) : undefined, from: t.from, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }

  snapshot() {
    return {
      tasks: [...this.tasks.values()].slice(-20).map((t) => this.#public(t)),
      agents: [...this.conns.values()].map((c) => ({ id: c.id, agent: c.agent, session: c.session, cwd: c.cwd, pid: c.pid, can: c.can, project: c.project?.name || null, connectedAt: c.connectedAt })),
      // Sesiones nuevas: la oficina abre el CLI del agente (si está instalado).
      launchers: HARNESS_IDS.map((agent) => ({ agent, available: !!which(agent === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[agent].bin) })),
      defaultCwd: this.defaultCwd,
    };
  }
}
