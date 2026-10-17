// herdr: el multiplexor de terminales para agentes de código. Si la oficina corre dentro de herdr
// (HERDR_ENV=1), los agentes no se lanzan en segundo plano: se abren en un pane nuevo, junto al de
// la oficina, y quedan a la vista (y a mano) del usuario.
//
// El concepto: la oficina lanza al agente en su pane; desde ahí el agente orquesta sus propias
// actividades (subagentes, pipelines de su harness) y también puede abrir más panes, cada uno con
// una actividad (los tests en modo watch, un servidor, otro agente…), con `dev-team-office pane` o
// con el propio `herdr`. Eso es del agente, no de la oficina; la oficina lo entiende y lo muestra:
// cada pane es una actividad de la que se encarga alguien del equipo mientras siga abierto.
//
// Todo pasa por la CLI de herdr (`herdr pane split|run|list|rename`, `herdr agent start|prompt`),
// que contesta JSON. Los tests le pasan un `run` de mentira.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { which } from '../integrations/common/devteam.mjs';
import { roleForCommand, roleForText, normRole, clip } from './roles.js';
import { t } from '../public/i18n.js';

// El nombre de cada CLI para `herdr agent start --kind`
export const HERDR_KIND = { 'claude-code': 'claude', claude: 'claude', pi: 'pi', opencode: 'opencode' };
const STATUS = new Set(['idle', 'working', 'blocked', 'done']);
const inside = (dir, root) => !!dir && !!root && (dir === root || dir.startsWith(`${root}${path.sep}`));
const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** Qué rol de la oficina representa un pane: el que se pidió, o según su agente o su comando. */
export function paneRole({ role, agent, title = '', command = '' } = {}) {
  const r = normRole(role);
  if (r) return r;
  if (agent) return roleForText(title, agent) || 'tl';
  return roleForCommand(command || title);
}

export class Herdr extends EventEmitter {
  /**
   * @param env    el entorno (HERDR_ENV, HERDR_PANE_ID, HERDR_WORKSPACE_ID)
   * @param run    (args) => Promise<stdout>: la CLI de herdr (los tests la reemplazan)
   * @param every  cada cuánto se miran los panes (ms)
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
        try { const j = JSON.parse(msg); msg = j.error?.message || j.message || msg; } catch { /* texto */ }
        reject(new Error(msg || err.message));
      });
    }));
    this.tracked = new Map(); // los panes que la oficina sigue: id → { pane, office, role, title, agent, kind, taskId, name, status }
    this.known = null;        // los panes que ya estaban (no se anuncian)
    this.timer = null;
    this.seq = 0;
  }

  /** ¿Estamos dentro de herdr? */
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

  /** Un pane nuevo junto a `from` (por defecto, el de la oficina), sin quitarle el foco al usuario. */
  async split({ from = this.pane, cwd, direction = 'right', env = {}, focus = false } = {}) {
    const args = ['pane', 'split'];
    if (from) args.push(from);
    args.push('--direction', direction === 'down' ? 'down' : 'right');
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
  async rename(pane, label) { try { await this.call(['pane', 'rename', pane, clip(label, 60)]); } catch { /* la etiqueta es un detalle */ } }
  prompt(target, text) { return this.call(['agent', 'prompt', target, text], 60_000); }
  async list() { return (await this.call(['pane', 'list', ...(this.workspace ? ['--workspace', this.workspace] : [])])).panes || []; }

  // ---------------------------------------------------------------- lo que la oficina abre

  /**
   * Abre un agente en un pane nuevo y, si hay, le manda el prompt.
   * @param harness  claude-code | pi | opencode
   * @param bin, args  el ejecutable y los argumentos del agente registrado (si tiene)
   * @param env      el entorno del pane (la URL de la oficina, la oficina, la sesión de Pi…)
   * @returns { pane, name }
   */
  async launchAgent({ harness, cwd, prompt, bin, args = [], env = {}, direction, office, officeName = '', role = 'manager', title, taskId, label } = {}) {
    const kind = HERDR_KIND[harness] || harness;
    const pane = await this.split({ cwd, direction, env });
    const id = pane.pane_id;
    const name = `dto-${kind}-${Date.now().toString(36).slice(-4)}${++this.seq}`.toLowerCase().slice(0, 32);
    this.track(id, { office, role, title: title || label || kind, agent: harness, kind: 'agent', taskId, name, cwd });
    await this.rename(id, `🏢 ${officeName ? `${officeName} · ` : ''}${label || kind}`);
    if (bin) {
      // un ejecutable propio: se escribe en el pane y se espera a que herdr reconozca al agente
      await this.runIn(id, [bin, ...args].map(quote).join(' '));
      await this.call(['agent', 'wait', id, '--until', 'idle', '--timeout', '30000'], 40_000).catch(() => {});
      if (prompt) await this.prompt(id, prompt);
    } else {
      await this.call(['agent', 'start', name, '--kind', kind, '--pane', id, ...(args.length ? ['--', ...args] : [])], 45_000);
      if (prompt) await this.prompt(name, prompt);
    }
    return { pane: id, name };
  }

  /** Abre un pane con un comando: una actividad (tests, un servidor, un build…). */
  async launchCommand({ command, cwd, from, direction, env = {}, office, role, title } = {}) {
    const pane = await this.split({ from, cwd, direction, env });
    const id = pane.pane_id;
    this.track(id, { office, role: paneRole({ role, command }), title: title || command, kind: 'command', command, cwd });
    if (title) await this.rename(id, title);
    if (command) await this.runIn(id, command);
    return { pane: id };
  }

  /** Sigue un pane (lo abrió la oficina, o el agente lo anunció): se avisa al abrirse y al cerrarse. */
  track(id, info = {}) {
    const prev = this.tracked.get(id);
    const p = { pane: id, office: info.office || prev?.office || null, role: info.role || prev?.role || 'tl', title: clip(info.title || prev?.title || id, 120), agent: info.agent || prev?.agent || null, kind: info.kind || prev?.kind || 'command', taskId: info.taskId ?? prev?.taskId ?? null, name: info.name || prev?.name || null, cwd: info.cwd || prev?.cwd || null, status: prev?.status || null, openedAt: prev?.openedAt || Date.now() };
    this.tracked.set(id, p);
    this.known?.add(id);
    if (!prev) this.emit('open', p);
    return p;
  }

  // ---------------------------------------------------------------- mirar los panes

  /**
   * Cada tanto se miran los panes del workspace: los que se cerraron, los cambios de estado de los
   * agentes y los panes nuevos que abrió un agente por su cuenta (en la carpeta de un proyecto que
   * la oficina conoce: `isProject(cwd)`).
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
    // auto-close de panes de comando: cuando el proceso foreground terminó
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
    // panes que abrió un agente en la carpeta de un proyecto: la oficina los adopta
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
