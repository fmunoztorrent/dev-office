// Tareas que el usuario envía desde la oficina hacia un agente de código.
//
// - A una sesión abierta: Pi y OpenCode se conectan a la oficina (WebSocket, `register`) y
//   reciben la tarea al instante. Claude Code no tiene un canal así: la tarea queda en cola y
//   la entrega su hook `Stop` cuando Claude termina el turno en curso.
// - Como ejecución nueva: la oficina lanza el CLI del agente (`claude -p`, `opencode run`,
//   `pi -p`) en un directorio. Sin shell: la tarea viaja como un único argumento.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip } from './roles.js';

export const AGENT_LABEL = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi' };

export const DEFAULT_LAUNCHERS = {
  'claude-code': ['claude', '-p', '{task}', '--permission-mode', 'acceptEdits'],
  opencode: ['opencode', 'run', '{task}'],
  pi: ['pi', '-p', '{task}'],
};
const TASKS_MAX = 50;
const OUTPUT_LINES = 60;
const TEXT_MAX = 20_000; // un pipeline compilado para un orquestador puede ser largo

const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

function which(cmd) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* sigue */ }
  }
  return null;
}

/** ~/.dev-team-office/config.json (opcional): { "cwd": "~/proyecto", "launchers": { "pi": ["pi", "-p", "{task}"] } } */
export const configFile = () => process.env.DEV_TEAM_OFFICE_CONFIG || path.join(os.homedir(), '.dev-team-office', 'config.json');

export function loadConfig(file = configFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export class TaskHub extends EventEmitter {
  constructor(office, { config, cwd = process.cwd(), officeUrl } = {}) {
    config ??= loadConfig();
    super();
    this.office = office;
    this.officeUrl = officeUrl;
    this.processCwd = cwd;
    this.applyConfig(config);
    this.conns = new Map();   // agentes conectados por WebSocket
    this.tasks = new Map();
    this.runs = new Map();
    this.seq = 0;
  }

  /** Directorio por defecto y comandos de lanzamiento (también al guardar desde ⚙ Ajustes). */
  applyConfig(config = {}) {
    this.defaultCwd = expandHome(config.cwd) || this.processCwd;
    this.launchers = Object.fromEntries(Object.entries({ ...DEFAULT_LAUNCHERS, ...(config.launchers || {}) })
      .filter(([, cmd]) => Array.isArray(cmd) && cmd.length && cmd.every((x) => typeof x === 'string'))
      .map(([agent, cmd]) => [agent, { agent, command: cmd, path: which(cmd[0]) }]));
    if (this.conns) this.#changed();
  }

  // ---------------------------------------------------------------- agentes conectados

  /** Un plugin/extensión se presenta (y se vuelve a presentar cuando cambia de sesión). */
  register(conn, info = {}) {
    const agent = String(info.agent || 'agente').slice(0, 30);
    let c = this.conns.get(conn.id);
    if (!c) {
      c = { id: conn.id, agent, sessions: new Set(), session: null, cwd: '', pid: null, connectedAt: Date.now(), send: conn.send };
      this.conns.set(conn.id, c);
    }
    c.agent = agent;
    c.cwd = clip(info.cwd || c.cwd, 300);
    c.pid = Number(info.pid) || c.pid;
    if (info.session) { c.session = clip(info.session, 100); c.sessions.add(c.session); }
    if (info.run) this.linkRun(String(info.run), c.session);
    this.#changed();
    // Tareas que esperaban a que este agente apareciera.
    for (const t of this.tasks.values()) if (t.status === 'queued' && this.#connFor(t) === c) this.#deliver(t, c);
    return { ok: true, id: c.id };
  }

  unregister(connId) {
    if (!this.conns.delete(connId)) return;
    for (const t of this.tasks.values()) if (t.connId === connId && t.status === 'sent') this.#set(t, 'failed', 'el agente se desconectó');
    this.#changed();
  }

  #connFor(task) {
    const live = [...this.conns.values()].filter((c) => c.agent === task.agent);
    if (task.session) return live.find((c) => c.sessions.has(task.session)) || null;
    return live.sort((a, b) => b.connectedAt - a.connectedAt)[0] || null;
  }

  // ---------------------------------------------------------------- tareas

  /** @returns {{ ok: boolean, task?: object, error?: string }} */
  /**
   * @param title  texto corto para la oficina (el tablero); por defecto, el propio texto
   * @param meta   { agentRoles }: nombre de subagente → rol, para la sesión que reciba la tarea
   */
  submit({ text, title, meta, agent, session, mode, cwd, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: 'la tarea está vacía' };
    if (text.length > TEXT_MAX) return { ok: false, error: `la tarea supera ${TEXT_MAX} caracteres` };
    session = session ? clip(session, 100) : null;
    agent = agent || (session && this.office.sessions.get(session)?.source) || null;
    if (!agent) return { ok: false, error: 'falta el agente destino' };
    if (agent === 'claude') agent = 'claude-code';

    const task = {
      id: `t${++this.seq}`, text, title: clip(title || text, 300), meta: meta || null, agent, session, mode: mode === 'launch' ? 'launch' : 'session',
      cwd: null, status: 'new', detail: '', from: clip(from || 'Oficina', 30), createdAt: Date.now(), updatedAt: Date.now(),
    };

    if (task.mode === 'launch') {
      const launcher = this.launchers[agent];
      if (!launcher) return { ok: false, error: `no sé lanzar "${agent}"` };
      if (!launcher.path) return { ok: false, error: `no encuentro "${launcher.command[0]}" en el PATH` };
      task.cwd = path.resolve(expandHome(cwd) || this.defaultCwd);
      if (!fs.statSync(task.cwd, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: `no existe el directorio ${task.cwd}` };
      this.#add(task);
      this.#dispatchEvent(task);
      this.#launch(task, launcher);
      return { ok: true, task: this.#public(task) };
    }

    const conn = this.#connFor(task);
    if (!conn && agent !== 'claude-code') {
      return { ok: false, error: `no hay ninguna sesión de ${AGENT_LABEL[agent] || agent} conectada; lánzala como ejecución nueva` };
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
    this.#sessionKnown(task);
    this.#set(task, 'sent', `enviada a ${AGENT_LABEL[conn.agent] || conn.agent}`);
    conn.send({ type: 'task', id: task.id, text: task.text, session: task.session });
  }

  /** Respuesta del agente: accepted | done | failed | rejected. */
  update(connId, { id, status, error } = {}) {
    const t = this.tasks.get(String(id));
    if (!t || (t.connId !== undefined && t.connId !== connId)) return { ok: false, error: 'tarea desconocida' };
    if (status === 'accepted') {
      this.#set(t, 'running', 'el agente la está haciendo');
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
    this.#sessionKnown(t);
    this.#set(t, 'running', 'Claude la tomó al terminar su turno');
    this.#startedEvent(t);
    return t;
  }

  cancel(id) {
    const t = this.tasks.get(String(id));
    if (!t) return { ok: false, error: 'tarea desconocida' };
    if (t.run?.child && t.status === 'running') {
      try { process.kill(-t.run.child.pid, 'SIGINT'); } catch { t.run.child.kill('SIGINT'); }
      this.#set(t, 'cancelled', 'cancelada');
      return { ok: true };
    }
    if (['queued', 'sent'].includes(t.status)) { this.#set(t, 'cancelled', 'cancelada'); return { ok: true }; }
    return { ok: false, error: `no se puede cancelar una tarea ${t.status}` };
  }

  // ---------------------------------------------------------------- ejecuciones nuevas

  #launch(task, launcher) {
    const runId = `r${this.seq}`;
    const args = launcher.command.slice(1).map((a) => a.replaceAll('{task}', task.text));
    const env = {
      ...process.env,
      DEV_TEAM_OFFICE_RUN: runId,
      DEV_TEAM_OFFICE_SESSION: `${task.agent}-${runId}`, // la extensión de Pi la adopta como id de sesión
      ...(this.officeUrl ? { DEV_TEAM_OFFICE_URL: this.officeUrl } : {}),
    };
    const run = { id: runId, output: [], child: null, exitCode: null };
    task.run = run;
    task.runId = runId;
    let child;
    try {
      child = spawn(launcher.path, args, { cwd: task.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) {
      this.#set(task, 'failed', err.message);
      return;
    }
    run.child = child;
    this.runs.set(runId, task);
    this.#set(task, 'running', `${path.basename(launcher.command[0])} en ${task.cwd.replace(os.homedir(), '~')}`);
    const collect = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        run.output.push(clip(line, 300));
        if (run.output.length > OUTPUT_LINES) run.output.shift();
      }
      task.last = run.output.at(-1);
      this.#changed();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => this.#set(task, 'failed', err.message));
    child.on('close', (code, signal) => {
      run.exitCode = code;
      run.child = null;
      if (task.status === 'cancelled') return this.#changed();
      if (code === 0) this.#set(task, 'done', 'terminada');
      else this.#set(task, 'failed', signal ? `cortada (${signal})` : `salió con código ${code}${task.last ? `: ${task.last}` : ''}`);
    });
  }

  /** Une una ejecución lanzada con la sesión que reporta su agente (hooks/extensiones). */
  linkRun(runId, session) {
    const t = this.runs.get(runId);
    if (t && session && !t.session) { t.session = clip(session, 100); this.#sessionKnown(t); this.#changed(); }
  }

  // Cuando se sabe qué sesión hará la tarea, la oficina aprende qué subagente es qué rol.
  #sessionKnown(task) {
    if (task.session && task.meta?.agentRoles) this.office.setAgentRoles(task.session, task.meta.agentRoles);
  }

  /** Mata las ejecuciones en curso (al cerrar la oficina). */
  stopAll() {
    for (const t of this.runs.values()) if (t.run?.child) { try { process.kill(-t.run.child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }
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
      text: `${task.mode === 'launch' ? 'Lanzo' : 'Para'} ${AGENT_LABEL[task.agent] || task.agent}: ${task.title}`,
    });
  }

  // La sesión destino recibe la tarea como su nuevo pedido (el tablero cambia de título).
  #startedEvent(task) {
    if (task.session) this.office.ingest(task.agent, { session: task.session, kind: 'task', text: task.title });
  }

  #public(t) {
    return {
      id: t.id, text: t.title, agent: t.agent, session: t.session, mode: t.mode, cwd: t.cwd, status: t.status,
      detail: t.detail, from: t.from, createdAt: t.createdAt, updatedAt: t.updatedAt, runId: t.runId,
      output: t.run ? t.run.output.slice(-12) : undefined,
    };
  }

  snapshot() {
    return {
      tasks: [...this.tasks.values()].slice(-20).map((t) => this.#public(t)),
      agents: [...this.conns.values()].map((c) => ({ id: c.id, agent: c.agent, session: c.session, cwd: c.cwd, pid: c.pid, connectedAt: c.connectedAt })),
      launchers: Object.values(this.launchers).map((l) => ({ agent: l.agent, available: !!l.path, command: l.command[0] })),
      defaultCwd: this.defaultCwd,
    };
  }
}
