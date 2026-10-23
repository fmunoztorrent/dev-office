// The services an agent leaves running in the background (a dev server, a watcher, a queue…):
// the office lists them and shows what they print. It never starts or stops them.
//
// Where they come from:
//   - Claude Code: a Bash with `run_in_background` answers with its `backgroundTaskId`, and Claude
//     writes its output to /tmp/claude-<uid>/<project>/<session>/tasks/<id>.output.
//     KillShell / TaskStop end it.
//   - Any agent: a command sent to the background with its output in a file
//     (`npm run dev > dev.log 2>&1 &`, `nohup … > out.log &`).
//   - An integration can report it as is: { kind: 'service_start', id, command, cwd, log }.
//
// Is it still running? Whoever holds its log open is the service (`lsof`): when nobody does, it
// ended. Without lsof it counts as running until the agent stops it or its session ends.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip } from './roles.js';

const COMMAND_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'local_shell', 'unified_exec', 'bash_background']);
const STOP_TOOLS = new Set(['killshell', 'killbash', 'taskstop']);
const KEEP_ENDED = 30 * 60_000; // an ended service stays on the list for a while (to read how it ended)
const MAX = 30;                 // per office
const READ_MAX = 256 * 1024;    // the most of a log sent at once

/** The command sent to the background, if it is one: ends with a lone `&` (or uses nohup/setsid). */
export function backgrounded(command) {
  const c = String(command || '').trim();
  return /(^|[^&])&\s*$/.test(c) || /(^|[;&|]\s*)(nohup|setsid)\s/.test(c) && /(^|[^&])&(\s|$)/.test(c);
}

/** The file a command's output goes to (`> file`, `>> file`, `&> file`), resolved against cwd. */
export function logFileOf(command, cwd = '') {
  const c = String(command || '');
  let last = null;
  for (const m of c.matchAll(/(?:^|[^\d&>])(?:&>>?|1?>>?)\s*(?!&)("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) last = m[1].replace(/^["']|["']$/g, '');
  if (!last || last === '/dev/null') return null;
  const home = last.replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(home) ? home : cwd ? path.resolve(cwd, home) : null;
}

/** Where Claude Code writes a background task's output (null if it is not found). */
export function claudeTaskOutput(taskId, session, { roots = claudeRoots() } = {}) {
  const id = String(taskId || '').replace(/[^\w-]/g, '');
  if (!id) return null;
  for (const root of roots) {
    let projects = [];
    try { projects = fs.readdirSync(root); } catch { continue; }
    for (const p of projects) {
      const dirs = session ? [String(session)] : (() => { try { return fs.readdirSync(path.join(root, p)); } catch { return []; } })();
      for (const s of dirs) {
        const file = path.join(root, p, s, 'tasks', `${id}.output`);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  return null;
}
const claudeRoots = () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  return [...new Set([process.env.CLAUDE_CODE_TMPDIR, '/tmp', '/private/tmp', os.tmpdir()].filter(Boolean).map((d) => path.join(d, `claude-${uid}`)))];
};

/**
 * The service a normalized event (from adapters.js) starts or stops, if any:
 *   { start: { key, command, cwd, log?, taskId? } } or { stop: key }
 */
export function serviceOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'service_start') {
    const command = clip(raw.command || raw.text, 300);
    if (!command && !raw.log) return null;
    return { start: { key: String(raw.id || raw.log || command), command, cwd: raw.cwd || '', log: raw.log ? String(raw.log) : null } };
  }
  if (raw.kind === 'service_stop' && (raw.id || raw.log)) return { stop: String(raw.id || raw.log) };
  const tool = String(raw.tool || '').toLowerCase();
  const input = raw.input && typeof raw.input === 'object' ? raw.input : {};
  if (raw.kind === 'tool_start' && STOP_TOOLS.has(tool)) {
    const id = input.shell_id ?? input.task_id ?? input.bash_id ?? input.id;
    return id ? { stop: String(id) } : null;
  }
  if (raw.kind !== 'tool_end' || raw.ok === false || !COMMAND_TOOLS.has(tool)) return null;
  const command = typeof input.command === 'string' ? input.command : '';
  if (raw.backgroundTaskId) return { start: { key: String(raw.backgroundTaskId), command: clip(command, 300), cwd: raw.cwd || '', taskId: String(raw.backgroundTaskId) } };
  if (!backgrounded(command)) return null;
  const log = logFileOf(command, raw.cwd);
  return log ? { start: { key: log, command: clip(command.replace(/\s*&\s*$/, ''), 300), cwd: raw.cwd || '', log } } : null;
}

/** Who holds each file open (lsof): Map file → [pid]. null if lsof is not there. */
export function holders(files) {
  return new Promise((resolve) => {
    if (!files.length) return resolve(new Map());
    execFile('lsof', ['-F', 'pn', '--', ...files], { timeout: 4000 }, (err, stdout) => {
      if (err && err.code === 'ENOENT') return resolve(null);
      const out = new Map();
      let pid = null;
      for (const line of String(stdout || '').split('\n')) {
        if (line[0] === 'p') pid = Number(line.slice(1));
        else if (line[0] === 'n' && pid) { const f = line.slice(1); out.set(f, [...new Set([...(out.get(f) || []), pid])]); }
      }
      resolve(out);
    });
  });
}

export class ServiceHub extends EventEmitter {
  /**
   * @param holders  (files) => Promise<Map file → pids | null> (lsof; the tests use their own)
   * @param every    how often it checks which ones are still running (ms)
   * @param grace    how long a service with nobody holding its log counts as just started (ms)
   */
  constructor({ holders: who = holders, roots, every = 3000, grace = 6000, now = () => Date.now() } = {}) {
    super();
    Object.assign(this, { who, roots, every, grace, now });
    this.services = new Map(); // id → service
    this.seq = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.check().catch(() => {}), this.every);
    this.timer.unref?.();
    return this;
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  /** Each raw event of an office (before the office enriches it): it may start or stop a service. */
  observe(office, raw, ev = {}) {
    if (raw?.kind === 'session_end' && raw.session) return this.#sessionEnded(raw.session);
    const s = serviceOf(raw);
    if (!s) return null;
    if (s.stop) return this.#end([...this.services.values()].find((x) => x.office === office && (x.key === s.stop || x.taskId === s.stop || x.log === s.stop)));
    const { key, command, cwd, taskId } = s.start;
    const found = s.start.log || (taskId ? claudeTaskOutput(taskId, raw.session, this.roots ? { roots: this.roots } : undefined) : null);
    const log = found ? realPath(found) : null;
    // the same log again (the agent restarted it): the same service, running again
    const same = [...this.services.values()].find((x) => x.office === office && (x.key === key || (log && x.log === log)));
    const svc = same || { id: `s${++this.seq}`, office, key };
    Object.assign(svc, {
      session: ev.session || raw.session || null, agent: raw.source || ev.source || null, role: ev.role || 'backend',
      command, name: nameOf(command), cwd: clip(cwd, 200), log, taskId: taskId || null, pids: [], status: 'running',
      startedAt: this.now(), endedAt: null, seenAlive: false,
    });
    this.services.set(svc.id, svc);
    this.#trim(office);
    this.emit('up', svc);
    this.emit('change', office);
    return svc;
  }

  /** Which ones are still running: whoever holds the log open. */
  async check() {
    const running = [...this.services.values()].filter((s) => s.status === 'running' && s.log);
    const map = running.length ? await this.who(running.map((s) => s.log)) : new Map();
    const changed = new Set();
    for (const s of running) {
      if (!map) break; // without lsof, nothing can be said
      const pids = map.get(s.log) || map.get(realPath(s.log)) || [];
      if (pids.length) { s.seenAlive = true; if (String(s.pids) !== String(pids)) { s.pids = pids; changed.add(s.office); } continue; }
      if (s.seenAlive || this.now() - s.startedAt > this.grace) { this.#end(s, false); changed.add(s.office); }
    }
    // the ones that ended long ago leave the list
    for (const s of [...this.services.values()]) {
      if (s.status !== 'running' && this.now() - s.endedAt > KEEP_ENDED) { this.services.delete(s.id); changed.add(s.office); }
    }
    for (const o of changed) this.emit('change', o);
  }

  get(id) { return this.services.get(id) || null; }

  /** An office's services: the running ones first, the newest first. */
  list(office) {
    return [...this.services.values()].filter((s) => !office || s.office === office)
      .sort((a, b) => (a.status === 'running') - (b.status === 'running') || a.startedAt - b.startedAt).reverse()
      .map(({ key, seenAlive, ...s }) => s);
  }

  /**
   * What a service's log says. `from`: the byte to read from (what the viewer already has);
   * without it, the last part. If the file shrank (it was truncated), it starts over.
   */
  read(id, { from, max = READ_MAX } = {}) {
    const s = this.services.get(id);
    if (!s) return null;
    if (!s.log) return { text: '', offset: 0, size: 0, status: s.status };
    let fd;
    try {
      fd = fs.openSync(s.log, 'r');
      const size = fs.fstatSync(fd).size;
      let start = Number.isFinite(from) && from >= 0 && from <= size ? from : Math.max(0, size - Math.min(max, 64 * 1024));
      if (size - start > max) start = size - max;
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      // a cut on the first line (it started in the middle): it starts at the next one
      let text = buf.toString('utf8');
      if (start > 0 && start !== from) text = text.slice(text.indexOf('\n') + 1);
      return { text: text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), offset: size, size, status: s.status, reset: Number.isFinite(from) && from > size };
    } catch {
      return { text: '', offset: 0, size: 0, status: s.status, missing: true };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  #end(s, notify = true) {
    if (!s || s.status !== 'running') return null;
    s.status = 'ended';
    s.endedAt = this.now();
    s.pids = [];
    this.emit('down', s);
    if (notify) this.emit('change', s.office);
    return s;
  }

  // Claude Code ends its background tasks when the session ends; without lsof that is how it is known
  #sessionEnded(session) {
    for (const s of this.services.values()) if (s.session === session && s.taskId) this.#end(s);
    return null;
  }

  #trim(office) {
    const mine = [...this.services.values()].filter((s) => s.office === office).sort((a, b) => a.startedAt - b.startedAt);
    while (mine.length > MAX) {
      const old = mine.find((s) => s.status !== 'running') || mine[0];
      mine.splice(mine.indexOf(old), 1);
      this.services.delete(old.id);
    }
  }
}

const realPath = (f) => { try { return fs.realpathSync(f); } catch { return f; } };

/** A short name for the list: "npm run dev", "python -m http.server 8000"… (without cd, env or redirects). */
export function nameOf(command) {
  let c = String(command || '').replace(/\s*(?:\d?>>?|&>>?)\s*\S+/g, '').replace(/\s*&\s*$/, '').trim();
  c = c.split(/\s*(?:&&|;)\s*/).filter((x) => !/^cd\s/.test(x)).pop() || c;
  c = c.replace(/^(?:\w+=\S+\s+)+/, '').replace(/^(?:nohup|setsid)\s+/, '');
  return clip(c, 60);
}
