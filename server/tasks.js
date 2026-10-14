// Tareas que el usuario envía desde la oficina hacia un agente de código. La oficina es el
// frontend: entrega la tarea y muestra su estado; el trabajo lo hace el agente.
//
// - A una sesión abierta: Pi y OpenCode se conectan a la oficina (WebSocket, `register`) y
//   reciben la tarea al instante. Claude Code no tiene un canal así: la tarea queda en cola y
//   la entrega su hook `Stop` cuando Claude termina el turno en curso.
// - Una sesión nueva: la oficina se la pide a un agente conectado que sepa lanzar (`can:
//   ['launch']`); ese agente arranca el CLI (`pi -p`, `claude -p`, `opencode run`). La
//   oficina no lanza procesos.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip } from './roles.js';
import { sanitizeProject } from './pipeline.js';

export const AGENT_LABEL = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi' };
const HARNESS_IDS = ['claude-code', 'opencode', 'pi'];
const TASKS_MAX = 50;
const TEXT_MAX = 4000;

/** ~/.dev-team-office/config.json: preferencias del frontend (p. ej. la apariencia de los personajes). */
export const configFile = () => process.env.DEV_TEAM_OFFICE_CONFIG || path.join(os.homedir(), '.dev-team-office', 'config.json');
export function loadConfig(file = configFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export class TaskHub extends EventEmitter {
  constructor(office, { cwd = process.cwd(), officeUrl } = {}) {
    super();
    this.office = office;
    this.officeUrl = officeUrl;
    this.defaultCwd = cwd;
    this.conns = new Map(); // agentes conectados por WebSocket
    this.tasks = new Map();
    this.seq = 0;
  }

  // ---------------------------------------------------------------- agentes conectados

  /**
   * Un plugin/extensión se presenta (y se vuelve a presentar cuando cambia de sesión).
   * info: { agent, session, cwd, pid, can: ['task','pipeline','launch'], project: { dir, name, pipelines } }
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

  /** Quién puede lanzar una sesión nueva: un agente conectado con `can: ['launch']` (mejor si es del mismo tipo). */
  #launcherFor(agent) {
    const able = [...this.conns.values()].filter((c) => c.can.includes('launch')).sort((a, b) => b.connectedAt - a.connectedAt);
    return able.find((c) => c.agent === agent) || able[0] || null;
  }

  // ---------------------------------------------------------------- tareas

  /** @param title texto corto para la oficina (el tablero); por defecto, el propio texto */
  submit({ text, title, agent, session, mode, cwd, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: 'la tarea está vacía' };
    if (text.length > TEXT_MAX) return { ok: false, error: `la tarea supera ${TEXT_MAX} caracteres` };
    session = session ? clip(session, 100) : null;
    agent = agent || (session && this.office.sessions.get(session)?.source) || null;
    if (agent === 'claude') agent = 'claude-code';
    if (!agent) return { ok: false, error: 'falta el agente destino' };

    const task = {
      id: `t${++this.seq}`, text, title: clip(title || text, 300), agent, session, mode: mode === 'launch' ? 'launch' : 'session',
      cwd: null, status: 'new', detail: '', from: clip(from || 'Oficina', 30), createdAt: Date.now(), updatedAt: Date.now(),
    };

    if (task.mode === 'launch') {
      if (!HARNESS_IDS.includes(agent)) return { ok: false, error: `no sé pedir que se lance "${agent}"` };
      const launcher = this.#launcherFor(agent);
      if (!launcher) return { ok: false, error: 'no hay ningún agente conectado que pueda lanzar sesiones nuevas (abre Pi u OpenCode con su integración)' };
      task.cwd = clip(cwd || this.defaultCwd, 300);
      task.connId = launcher.id;
      this.#add(task);
      this.#dispatchEvent(task);
      this.#set(task, 'sent', `pedida a ${AGENT_LABEL[launcher.agent] || launcher.agent}`);
      launcher.send({ type: 'launch', id: task.id, harness: agent, task: text, cwd: task.cwd });
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

  #deliver(task, conn) {
    task.connId = conn.id;
    task.session ||= conn.session;
    this.#set(task, 'sent', `enviada a ${AGENT_LABEL[conn.agent] || conn.agent}`);
    conn.send({ type: 'task', id: task.id, text: task.text, session: task.session });
  }

  /** Respuesta del agente: accepted | done | failed | rejected. */
  update(connId, { id, status, error, detail } = {}) {
    const t = this.tasks.get(String(id));
    if (!t || (t.connId !== undefined && t.connId !== connId)) return { ok: false, error: 'tarea desconocida' };
    if (status === 'accepted') {
      this.#set(t, 'running', clip(detail, 200) || (t.mode === 'launch' ? 'sesión nueva en marcha' : 'el agente la está haciendo'));
      if (t.mode === 'session') this.#startedEvent(t);
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
    this.#changed();
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
    return { id: t.id, text: t.title, agent: t.agent, session: t.session, mode: t.mode, cwd: t.cwd, status: t.status, detail: t.detail, from: t.from, createdAt: t.createdAt, updatedAt: t.updatedAt };
  }

  snapshot() {
    const canLaunch = [...this.conns.values()].some((c) => c.can.includes('launch'));
    return {
      tasks: [...this.tasks.values()].slice(-20).map((t) => this.#public(t)),
      agents: [...this.conns.values()].map((c) => ({ id: c.id, agent: c.agent, session: c.session, cwd: c.cwd, pid: c.pid, can: c.can, project: c.project?.name || null, connectedAt: c.connectedAt })),
      // Sesiones nuevas: las lanza un agente conectado; la oficina sólo dice si hay quién.
      launchers: HARNESS_IDS.map((agent) => ({ agent, available: canLaunch })),
      defaultCwd: this.defaultCwd,
    };
  }
}
