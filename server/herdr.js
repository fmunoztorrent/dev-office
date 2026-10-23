// herdr: the terminal multiplexer for coding agents. If the office runs inside herdr
// (HERDR_ENV=1), agents are not launched in the background: they open in a new pane, next to the
// office's, and stay in sight (and at hand) for the user.
//
// The concept: the office launches the agent in its pane; from there the agent orchestrates its own
// activities (subagents, its harness's pipelines) and may also open more panes, each with an
// activity (tests in watch mode, a server, another agent…), with `dev-team-office pane` or with
// `herdr` itself. That belongs to the agent, not to the office; the office understands it and shows it:
// each pane is an activity that someone on the team takes care of while it stays open.
//
// Everything goes through the herdr CLI (`herdr pane split|run|list|rename`, `herdr agent start|prompt`),
// which answers JSON. The tests pass it a fake `run`.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { which } from '../integrations/common/devteam.mjs';
import { roleForCommand, roleForText, normRole, clip } from './roles.js';
import { t } from '../public/i18n.js';
import { insideDir as inside } from './paths.js';

// Each CLI's name for `herdr agent start --kind`
export const HERDR_KIND = { 'claude-code': 'claude', claude: 'claude', pi: 'pi', opencode: 'opencode', codex: 'codex' };
const STATUS = new Set(['idle', 'working', 'blocked', 'done']);
export const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** Which office role a pane stands for: the requested one, or by its agent or its command. */
export function paneRole({ role, agent, title = '', command = '' } = {}) {
  const r = normRole(role);
  if (r) return r;
  if (agent) return roleForText(title, agent) || 'tl';
  return roleForCommand(command || title);
}

export class Herdr extends EventEmitter {
  /**
   * @param env    the environment (HERDR_ENV, HERDR_PANE_ID, HERDR_WORKSPACE_ID)
   * @param run    (args) => Promise<stdout>: the herdr CLI (the tests replace it)
   * @param every  how often the panes are checked (ms)
   */
  constructor({ env = process.env, run, bin = 'herdr', every = 2500, log = () => {} } = {}) {
    super();
    this.env = env;
    this.bin = bin;
    this.every = every;
    this.log = log;
    this.custom = !!run;
    this.run = run || ((args, timeout = 20_000) => new Promise((resolve, reject) => {
      execFile(bin, args, { timeout, maxBuffer: 4 << 20, env }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        let msg = String(stderr || '').trim();
        let code = null;
        try { const j = JSON.parse(msg); code = j.error?.code || null; msg = j.error?.message || j.message || msg; } catch { /* texto */ }
        const e = new Error(msg || err.message);
        if (code) e.code = code;
        reject(e);
      });
    }));
    this.tracked = new Map(); // the panes the office follows: id → { pane, office, role, title, agent, kind, taskId, name, status }
    this.known = null;        // the panes that were already there (not announced)
    this.timer = null;
    this.seq = 0;
  }

  /** Are we inside herdr? */
  get available() { return this.env.HERDR_ENV === '1' && (this.custom || !!which(this.bin)); }
  get pane() { return this.env.HERDR_PANE_ID || null; }
  get workspace() { return this.env.HERDR_WORKSPACE_ID || null; }

  async call(args, timeout) {
    const out = await this.run(args, timeout);
    try { return JSON.parse(out || '{}')?.result ?? {}; } catch { return {}; }
  }

  status() {
    return { available: this.available, pane: this.pane, workspace: this.workspace, panes: [...this.tracked.values()].map((p) => ({ ...p })) };
  }

  // ---------------------------------------------------------------- primitivas

  /** A new pane next to `from` (by default, the office's), without taking the focus away from the user. */
  async split({ from = this.pane, cwd, direction = 'right', env = {}, focus = false, ratio } = {}) {
    const args = ['pane', 'split'];
    if (from) args.push(from);
    args.push('--direction', direction === 'down' ? 'down' : 'right');
    if (ratio > 0 && ratio < 1) args.push('--ratio', String(ratio));
    if (cwd) args.push('--cwd', cwd);
    for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== null) args.push('--env', `${k}=${v}`);
    args.push(focus ? '--focus' : '--no-focus');
    const r = await this.call(args);
    if (!r.pane?.pane_id) throw new Error(t('herdr.noPane'));
    return r.pane;
  }

  runIn(pane, command) { return this.call(['pane', 'run', pane, command]); }
  async processInfo(id) { return (await this.call(['pane', 'process-info', '--pane', id])).process_info ?? {}; }
  closePane(id) { return this.call(['pane', 'close', id]); }
  async rename(pane, label) { try { await this.call(['pane', 'rename', pane, clip(label, 60)]); } catch { /* the label is a detail */ } }
  // The prompt counts as delivered only when herdr sees the agent switch to `working` (S1). If herdr
  // observes no activity it answers with an error that keeps its `code` (agent_prompt_stalled, …).
  prompt(target, text) { return this.call(['agent', 'prompt', target, text, '--wait', '--until', 'working', '--timeout', '15000'], 60_000); }

  /** The real state herdr sees for an agent (`agent get`): working, idle, unknown… */
  async #agentStatus(target) {
    try {
      const r = await this.call(['agent', 'get', target]);
      const a = r?.agent ?? r;
      return a?.status ?? a?.agent_status ?? a?.state ?? null;
    } catch { return null; }
  }

  /**
   * Delivers a prompt with confirmation (S1) and, if herdr sees it stalled (agent_prompt_stalled), a
   * single retry (S2): it checks the real state and, if it is not working, waits for it to be free and
   * resends exactly once. There is no third send.
   */
  async #promptAgent(target, text) {
    try {
      await this.prompt(target, text);
      return;
    } catch (err) {
      if (err.code !== 'agent_prompt_stalled') throw err;
    }
    // the request may have arrived anyway (the turn starts right after): if it is already working, it is not resent
    if (await this.#agentStatus(target) === 'working') return;
    await this.call(['agent', 'wait', target, '--until', 'idle', '--timeout', '15000'], 20_000).catch(() => {});
    await this.prompt(target, text); // a single retry: if it fails, its error propagates
  }
  async list() { return (await this.call(['pane', 'list', ...(this.workspace ? ['--workspace', this.workspace] : [])])).panes || []; }

  // ---------------------------------------------------------------- what the office opens

  /**
   * Opens an agent in a new pane and, if there is one, sends it the prompt.
   * @param harness  claude-code | pi | opencode
   * @param bin, args  the registered agent's executable and arguments (if it has them)
   * @param env      the pane's environment (the office URL, the office, Pi's session…)
   * @returns { pane, name }
   */
  async launchAgent({ harness, cwd, prompt, bin, args = [], env = {}, direction, office, officeName = '', role = 'manager', title, taskId, label } = {}) {
    const kind = HERDR_KIND[harness] || harness;
    const pane = await this.split({ cwd, direction, env });
    const id = pane.pane_id;
    const name = `dto-${kind}-${Date.now().toString(36).slice(-4)}${++this.seq}`.toLowerCase().slice(0, 32);
    this.track(id, { office, role, title: title || label || kind, agent: harness, kind: 'agent', taskId, name, cwd });
    await this.rename(id, `🏢 ${officeName ? `${officeName} · ` : ''}${label || kind}`);
    try {
      if (bin) {
        // a custom executable: it is typed into the pane and we wait for herdr to recognize the agent
        await this.runIn(id, [bin, ...args].map(quote).join(' '));
        await this.call(['agent', 'wait', id, '--until', 'idle', '--timeout', '30000'], 40_000).catch(() => {});
        if (prompt) await this.#promptAgent(id, prompt);
      } else {
        await this.call(['agent', 'start', name, '--kind', kind, '--pane', id, ...(args.length ? ['--', ...args] : [])], 45_000);
        if (prompt) await this.#promptAgent(name, prompt);
      }
    } catch (err) {
      // the pane already exists: it is attached to the error so the task knows which one to name (S3)
      if (!err.pane) err.pane = id;
      throw err;
    }
    return { pane: id, name };
  }

  /**
   * Opens a pane with a command: an activity (tests, a server, a build…), or with kind 'sub' a
   * subagent's viewer (the office closes it when the subagent finishes).
   */
  async launchCommand({ command, cwd, from, direction, ratio, env = {}, office, role, title, kind = 'command', session, subId } = {}) {
    const pane = await this.split({ from, cwd, direction, ratio, env });
    const id = pane.pane_id;
    this.track(id, { office, role: kind === 'sub' ? role : paneRole({ role, command }), title: title || command, kind, command, cwd, session, subId });
    if (title) await this.rename(id, title);
    if (command) await this.runIn(id, command);
    return { pane: id };
  }

  /** Follows a pane (the office opened it, or the agent announced it): notifies when it opens and when it closes. */
  track(id, info = {}) {
    const prev = this.tracked.get(id);
    const p = { pane: id, office: info.office || prev?.office || null, role: info.role || prev?.role || 'tl', title: clip(info.title || prev?.title || id, 120), agent: info.agent || prev?.agent || null, kind: info.kind || prev?.kind || 'command', taskId: info.taskId ?? prev?.taskId ?? null, name: info.name || prev?.name || null, cwd: info.cwd || prev?.cwd || null, status: prev?.status || null, openedAt: prev?.openedAt || Date.now() };
    if (info.session || prev?.session) p.session = info.session || prev.session;
    if (info.subId || prev?.subId) p.subId = info.subId || prev.subId;
    this.tracked.set(id, p);
    this.known?.add(id);
    if (!prev) this.emit('open', p);
    return p;
  }

  // ---------------------------------------------------------------- watching the panes

  /**
   * Every so often the workspace's panes are checked: the ones that closed, the agents' state
   * changes and the new panes an agent opened on its own (in the folder of a project the office
   * knows: `isProject(cwd)`).
   */
  start({ isProject = () => false } = {}) {
    if (!this.available || this.timer) return this;
    this.isProject = isProject;
    const loop = async () => {
      try { await this.poll(); } catch (err) { if (!this.failed) this.log(`herdr: ${err.message}`); this.failed = true; }
      this.timer = setTimeout(loop, this.every);
      this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
    return this;
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async poll() {
    const panes = await this.list();
    this.failed = false;
    const live = new Map(panes.map((p) => [p.pane_id, p]));
    if (!this.known) { this.known = new Set(live.keys()); this.known.add(this.pane); }
    for (const [id, p] of this.tracked) {
      const now = live.get(id);
      if (!now) { this.tracked.delete(id); this.emit('close', p); continue; }
      const title = now.label || now.terminal_title_stripped;
      if (p.kind === 'command' && title && title !== p.title && !now.label) p.title = clip(title, 120);
      const status = STATUS.has(now.agent_status) ? now.agent_status : null;
      if (now.agent && status && status !== p.status) { const was = p.status; p.status = status; if (was || status !== 'idle') this.emit('state', p, status, was); }
    }
    // auto-close of command panes: when the foreground process finished
    for (const [id, p] of [...this.tracked]) {
      if (p.kind !== 'command') continue;
      const info = await this.processInfo(id).catch(() => null);
      if (!info || !Array.isArray(info.foreground_processes)) continue;
      if (info.foreground_processes.length > 0) { p.started = true; continue; }
      if (p.started) {
        await this.closePane(id).catch(() => {});
        this.tracked.delete(id);
        this.emit('close', p);
      }
    }
    // panes an agent opened in a project's folder: the office adopts them
    for (const [id, p] of live) {
      if (this.known.has(id)) continue;
      this.known.add(id);
      const cwd = p.foreground_cwd || p.cwd;
      const sibling = [...this.tracked.values()].some((x) => x.cwd && (inside(cwd, x.cwd) || inside(x.cwd, cwd)));
      if (!sibling && !this.isProject?.(cwd)) continue;
      const title = p.label || p.terminal_title_stripped || p.agent || id;
      this.emit('discover', { pane: id, cwd, agent: p.agent || null, title, status: STATUS.has(p.agent_status) ? p.agent_status : null });
    }
  }
}
