// The office's lifecycle from the outside: whether one is running (and which version), stopping it,
// starting it in the background, and restarting it so a freshly installed version is the one serving.
// An office left running keeps the code it started with, so after `update` it must be restarted.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** -1, 0 or 1 comparing two "x.y.z" versions (a prerelease suffix is ignored). */
export function compareVersions(a, b) {
  const p = (v) => String(v || '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

/** The version of the code installed at `root` (read from disk: it may be newer than the running one). */
export function installedVersion(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

/** The office answering at `base`, or null. A second try covers a kept-alive connection to an office that is gone. */
export async function officeHealth(base, timeout = 1500, tries = 2) {
  try {
    const res = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(timeout) });
    const h = await res.json();
    return h?.name === 'dev-team-office' ? h : null;
  } catch (err) {
    return tries > 1 && err?.name !== 'TimeoutError' ? officeHealth(base, timeout, tries - 1) : null;
  }
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/**
 * Whether the office `h` (its /v1/health) runs from the install at `root`. Recent offices say their
 * `root`; an older one is recognized by the script its process runs (`ps`), resolving symlinks.
 * An installer run from a temporary HOME (a test) must never touch the user's own office.
 */
export function sameInstall(h, root = ROOT) {
  const want = real(root);
  if (h?.root) return real(h.root) === want;
  const words = commandOf(h?.pid);
  const script = words.find((w) => /dev-team-office(\.js)?$/.test(w));
  return !!script && real(script) === real(path.join(root, 'bin', 'dev-team-office.js'));
}

/** The command line of a process, in words ([] if it is gone). */
function commandOf(pid) {
  if (!Number(pid)) return [];
  const r = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(Number(pid))], { encoding: 'utf8' });
  return (r.stdout || '').trim().split(/\s+/).filter(Boolean);
}

/** 'background' (`serve`) or 'terminal'. Recent offices say it; an older one, by its command line. */
export function officeMode(h) {
  if (h?.mode) return h.mode;
  const words = commandOf(h?.pid);
  const i = words.findIndex((w) => /dev-team-office(\.js)?$/.test(w));
  return i >= 0 && words[i + 1] === 'serve' ? 'background' : 'terminal';
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/**
 * Stops the office answering at `base` (SIGTERM to the pid it reports, SIGKILL if it does not go).
 * @returns {Promise<{ok: boolean, stopped: boolean, health?: object, error?: string}>}
 */
export async function stopOffice({ base, timeout = 6000 } = {}) {
  const h = await officeHealth(base);
  if (!h) return { ok: true, stopped: false };
  const pid = Number(h.pid);
  if (!pid || pid === process.pid) return { ok: false, stopped: false, health: h, error: 'no pid' };
  try { process.kill(pid, 'SIGTERM'); } catch (err) { if (err.code !== 'ESRCH') return { ok: false, stopped: false, health: h, error: err.message }; }
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (!alive(pid)) return { ok: true, stopped: true, health: h };
    await sleep(100);
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  await sleep(200);
  return alive(pid) ? { ok: false, stopped: false, health: h, error: `pid ${pid} did not stop` } : { ok: true, stopped: true, health: h };
}

/** Launches `dev-team-office serve` detached from this process (its output goes to the log file). */
export function spawnOffice({ port, root = ROOT, log = path.join(os.homedir(), '.dev-team-office', 'office.log'), env = process.env } = {}) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  const child = spawn('/bin/sh', ['-c', '"$0" "$@" &', process.execPath, path.join(root, 'bin', 'dev-team-office.js'), 'serve', ...(port ? ['--port', String(port)] : [])], {
    detached: true, stdio: ['ignore', fd, fd], env: { ...env, DEV_TEAM_OFFICE_LAUNCHED: '1' },
  });
  child.on('error', () => {});
  child.unref();
  fs.closeSync(fd);
}

/**
 * Starts the office in the background and waits until it answers.
 * @returns {Promise<{ok: boolean, health?: object, log: string}>}
 */
export async function startOffice({ base, port, root = ROOT, env = process.env, timeout = 8000 } = {}) {
  const log = path.join(os.homedir(), '.dev-team-office', 'office.log');
  spawnOffice({ port, root, log, env });
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await sleep(150);
    const h = await officeHealth(base, 800);
    if (h) return { ok: true, health: h, log };
  }
  return { ok: false, log };
}
