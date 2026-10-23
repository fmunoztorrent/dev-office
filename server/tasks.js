// Tasks the user sends from the office to a coding agent. The office is the frontend: it delivers
// the task and shows its state; the agent does the work.
//
// - To an open session: Pi and OpenCode connect to the office (WebSocket, `register`) and
//   receive the task instantly. Claude Code has no such channel: the task is queued and its
//   `Stop` hook delivers it when Claude ends the current turn.
// - A new session of a registered agent (⚙ › Agents, with its path): inside herdr, the office
//   opens the agent in a new pane (interactive, in sight) and sends it the prompt; outside herdr,
//   it opens its CLI in the background in that path (`claude -p`, `opencode run`, `pi -p`) with the
//   prompt or the command that starts its harness's pipeline. It orchestrates nothing: the harness
//   runs the pipeline; the office draws what its hooks or plugins report.
//
// Each task belongs to an office (the registered agent's, or the one of the session that receives it).

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
/**
 * The environment of an agent the office launches: its own, plus the Node the office runs with on the
 * PATH (a CLI written in Node, like pi, starts even if the office was opened without Node on the PATH).
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // the "Pi session with an owner" mark: if the office was opened from a Pi, what it launches is not its subagent
  delete env.DEV_TEAM_OFFICE_PI_PID;
  const dir = path.dirname(process.execPath);
  const parts = (env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!parts.includes(dir)) env.PATH = [...parts, dir].join(path.delimiter);
  return env;
}

const HARNESS_IDS = ['claude-code', 'opencode', 'pi', 'codex'];
const TASKS_MAX = 50;
const TEXT_MAX = 4000;
const OUTPUT_LINES = 40;

export class TaskHub extends EventEmitter {
  /**
   * @param company  the offices (server/company.js): where each event goes
   * @param store    the database (server/store.js): each task stays in the prompt history
   * @param herdr    server/herdr.js: inside herdr, new sessions open in a pane
   * @param prefs    () => the settings (herdr.launch, herdr.direction)
   */
  constructor(company, { cwd = process.cwd(), officeUrl, store, herdr = null, prefs = () => ({}), socket = null } = {}) {
    super();
    this.office = company;
    this.store = store;
    this.herdr = herdr;
    this.prefs = prefs;
    this.socket = socket;
    this.boot = Date.now().toString(36); // task ids restart with the office; in the database they do not
    this.officeUrl = officeUrl;
    this.defaultCwd = cwd;
    this.conns = new Map(); // agents connected over WebSocket
    this.tasks = new Map();
    this.children = new Map(); // sessions launched by the office, by task id
    this.seq = 0;
  }

  // ---------------------------------------------------------------- agentes conectados

  /**
   * A plugin/extension introduces itself (and does it again when it changes session).
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
    // its office: the one it states (the office passes it when opening it), its session's or its path's
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

  /** Sends a message to a connected agent's session. false if it is not connected. */
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
   * @param title   short text for the office (the board); by default, the text itself
   * @param command, args  if the task is a harness command (`/task …`): the agent runs it
   *                as a command (OpenCode) or expands it (Pi, Claude); `text` is "/command args"
   * @param launch  { bin, args } of the registered agent, for a new session (mode: 'launch')
   * @param meta    { agentId, entry } for the history: which registered agent and through which entry
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

  /** Do new sessions open in herdr panes? (inside herdr, unless it is turned off in ⚙) */
  get inPanes() { return !!this.herdr?.available && this.prefs()?.herdr?.launch !== false; }

  // Inside herdr: the agent opens in a new, interactive pane and gets the task as its prompt.
  // From there it orchestrates its own work (and may open more panes); the task ends when its turn ends.
  async #launchInPane(task, { bin, args }) {
    const label = AGENT_LABEL[task.agent] || task.agent;
    const env = { DEV_TEAM_OFFICE_URL: this.officeUrl, DEV_TEAM_OFFICE_OFFICE: task.office, ...(this.socket ? { DEV_TEAM_OFFICE_SOCKET: this.socket } : {}) };
    // the Pi extension adopts this session id: so the task knows which session is doing it
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
      const pane = err.pane || task.pane;
      if (err.code && pane) {
        // S3: the retry did not start the turn either → the task fails with the pane and the code.
        task.pane = pane;
        const detail = tr('task.paneNoTurn', { pane, code: err.code });
        this.#set(task, 'failed', detail);
        this.#releasePaneRole(pane, task.office, err.code);
      } else {
        this.#set(task, 'failed', tr('err.herdrFailed', { error: err.message }));
      }
    }
  }

  /** S4: when a pane task fails, the role herdr tracks for that pane goes back to idle. */
  #releasePaneRole(pane, office, code) {
    const role = this.herdr?.tracked?.get(pane)?.role || 'manager';
    this.office.ingest('generic', { session: 'office', office, kind: 'turn_end', role, text: tr('task.paneNoTurn', { pane, code }) });
  }

  /** A pane's agent ended its turn (herdr sees it idle or done): its task is done. */
  paneSettled(pane) {
    const t = [...this.tasks.values()].find((x) => x.pane === pane && x.status === 'running');
    if (t) this.#set(t, 'done', tr('task.paneIdle', { pane }));
  }

  /**
   * The session ended its turn (its own event, without depending on herdr recognizing the agent):
   * what was sent to it, in its pane or to the open session, is done. Without a pane, what was
   * launched in the background is closed by its exit code, and Claude gets the task right at its Stop.
   */
  sessionSettled(session) {
    for (const t of this.tasks.values()) {
      if (t.status !== 'running' || !session || t.session !== session) continue;
      if (!t.pane && (t.mode !== 'session' || t.agent === 'claude-code')) continue;
      this.#set(t, 'done', tr('task.finished'));
    }
  }

  /** The session opened by a pane's agent (it arrives with its first event). */
  paneSession(pane, session) {
    const t = [...this.tasks.values()].find((x) => x.pane === pane && !x.session);
    if (t) { t.session = clip(session, 100); this.#changed(); }
  }

  // A new session of the agent, in its directory. The task goes as a single argument, without a shell.
  #launch(task, { exe, argv }) {
    const env = childEnv({ DEV_TEAM_OFFICE_LAUNCHED: '1', ...(this.officeUrl ? { DEV_TEAM_OFFICE_URL: this.officeUrl } : {}) });
    delete env.DEV_TEAM_OFFICE_SESSION_ALIAS;
    // the Pi extension adopts this session id: so the task knows which session is doing it
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

  /** Kills the sessions launched by the office (when it closes). */
  stopAll() {
    for (const child of this.children.values()) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already finished */ } }
  }

  #deliver(task, conn) {
    task.connId = conn.id;
    task.session ||= conn.session;
    this.#set(task, 'sent', tr('task.sentTo', { agent: AGENT_LABEL[conn.agent] || conn.agent }));
    conn.send({ type: 'task', id: task.id, text: task.text, session: task.session, ...(task.command ? { command: task.command, args: task.args } : {}) });
  }

  /** The agent's answer: accepted | done | failed | rejected. */
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

  /** For Claude Code's Stop hook: the next queued task for that session. */
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
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already finished */ }
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
    } catch { /* the history cannot break the delivery */ }
  }

  #changed() { this.emit('change', this.snapshot()); }

  // The office animates it: the PO takes the card to the whiteboard.
  #dispatchEvent(task) {
    this.office.ingest('generic', {
      session: 'office', office: task.office, kind: 'dispatch', agent: task.agent, mode: task.mode, from: task.from,
      text: tr(task.mode === 'launch' ? 'task.dispatchNew' : 'task.dispatch', { agent: AGENT_LABEL[task.agent] || task.agent, title: task.title }),
    });
  }

  // The target session gets the task as its new request (the board changes its title).
  #startedEvent(task) {
    if (task.session) this.office.ingest(task.agent, { session: task.session, office: task.office, kind: 'task', text: task.title });
  }

  #public(t) {
    return {
      id: t.id, text: t.title, agent: t.agent, agentId: t.agentId, entry: t.entry, session: t.session, mode: t.mode, cwd: t.cwd, command: t.command, status: t.status, detail: t.detail, office: t.office, pane: t.pane,
      output: t.mode === 'launch' ? t.output.slice(-12) : undefined, from: t.from, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }

  /** A connected agent's office: its session's, or its path's. */
  connOffice(c) { return (c.session && this.office.officeOfSession?.(c.session)) || this.office.officeForPath?.(c.cwd) || MAIN_OFFICE; }

  /** @param office only that office's (without an office: everything) */
  snapshot(office) {
    const mine = (o) => !office || (o || MAIN_OFFICE) === office;
    return {
      tasks: [...this.tasks.values()].filter((t) => mine(t.office)).slice(-20).map((t) => this.#public(t)),
      agents: [...this.conns.values()].filter((c) => mine(this.connOffice(c))).map((c) => ({ id: c.id, agent: c.agent, session: c.session, cwd: c.cwd, pid: c.pid, can: c.can, project: c.project?.name || null, connectedAt: c.connectedAt })),
      // New sessions: the office opens the agent's CLI (if it is installed).
      launchers: HARNESS_IDS.map((agent) => ({ agent, available: !!which(agent === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[agent].bin) })),
      defaultCwd: this.defaultCwd,
    };
  }
}
