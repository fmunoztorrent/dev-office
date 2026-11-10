// The office's lifecycle from the CLI: start / stop / restart in the background, and the restart
// after an update (restart --if-outdated) that only touches an office of the same install.
// Everything runs on a temp HOME, a free port, a temp database and socket: never the user's office.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareVersions, officeHealth, officeMode, sameInstall, stopOffice } from '../server/lifecycle.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const tmpDirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmpDirs.push(d); return d; };
const bases = [];
after(async () => {
  for (const base of bases) await stopOffice({ base });
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function sandbox() {
  const home = tmp('dto-life-');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  bases.push(base);
  const env = {
    PATH: process.env.PATH, HOME: home, LANG: 'en_US.UTF-8',
    DEV_TEAM_OFFICE_PORT: String(port), DEV_TEAM_OFFICE_DB: path.join(home, 'office.db'),
    DEV_TEAM_OFFICE_SOCKET: path.join(home, 'o.sock'), DEV_TEAM_OFFICE_WEATHER: 'off',
  };
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'dev-team-office.js'), ...args], { env, encoding: 'utf8', timeout: 20000 });
  return { home, port, base, env, cli };
}

test('compareVersions compara por número e ignora el sufijo de prerelease', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.7.0', '0.8.0'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3-rc.1'), 0);
  assert.equal(compareVersions(undefined, '0.0.1'), -1);
});

test('start deja la oficina en segundo plano, status la ve, stop la detiene y restart la levanta con otro pid', async () => {
  const { base, cli } = await sandbox();
  assert.match(cli('stop').stdout, /No office is running/);

  const s = cli('start');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /started in the background/);
  const h1 = await officeHealth(base);
  assert.equal(h1.version, VERSION);
  assert.equal(h1.mode, 'background');
  assert.ok(sameInstall(h1, ROOT));

  assert.match(cli('start').stdout, /already running/); // idempotent
  assert.equal((await officeHealth(base)).pid, h1.pid);

  const r = cli('restart');
  assert.equal(r.status, 0, r.stderr);
  const h2 = await officeHealth(base);
  assert.ok(h2 && h2.pid !== h1.pid, 'restart no cambió el proceso');

  const st = cli('stop');
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /stopped/);
  assert.equal(await officeHealth(base), null);
});

test('restart --if-outdated no toca una oficina de la misma versión ni una de otra instalación', async () => {
  const { base, cli } = await sandbox();
  assert.equal(cli('start').status, 0);
  const h = await officeHealth(base);
  assert.equal(cli('restart', '--if-outdated').stdout, ''); // same version: nothing to do
  assert.equal((await officeHealth(base)).pid, h.pid);
  // an office that says it comes from another folder is not this install's
  assert.equal(sameInstall({ ...h, root: tmp('dto-other-') }, ROOT), false);
  assert.equal(sameInstall({ pid: h.pid }, ROOT), true); // without `root` (an older office): by its process
  assert.equal(sameInstall({ pid: h.pid }, tmp('dto-other-')), false);
  // an older office does not say its mode: `serve` in its command line means background
  assert.equal(officeMode({ pid: h.pid }), 'background');
  assert.equal(officeMode({ pid: process.pid }), 'terminal');
  cli('stop');
});

test('update: la oficina en segundo plano que quedó con la versión vieja se reinicia con la nueva', async () => {
  const { home, base, env, cli } = await sandbox();
  // an "old" install in the temp HOME: this checkout with a lower version, serving in the background
  const app = path.join(home, '.dev-team-office', 'app');
  fs.cpSync(ROOT, app, { recursive: true, filter: (src) => !/\/(\.git|node_modules|\.claude)(\/|$)/.test(src.slice(ROOT.length)) });
  const pkg = path.join(app, 'package.json');
  const setVersion = (file, v) => {
    fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), version: v }, null, 2));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/export const VERSION = '[^']+'/, `export const VERSION = '${v}'`));
  };
  const serverJs = path.join(app, 'server', 'server.js');
  setVersion(serverJs, '0.0.1');
  // like 0.7.0, the old office does not report its mode or install folder
  fs.writeFileSync(serverJs, fs.readFileSync(serverJs, 'utf8').replace(', mode, root: path.dirname(path.dirname(CLI)) });', ' });'));
  const appCli = (...args) => spawnSync(process.execPath, [path.join(app, 'bin', 'dev-team-office.js'), ...args], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(appCli('start').status, 0);
  const old = await officeHealth(base);
  assert.equal(old.version, '0.0.1');

  // a checkout elsewhere (a different install) does not restart it
  assert.equal(cli('restart', '--if-outdated').stdout, '');
  assert.equal((await officeHealth(base)).pid, old.pid);

  // the install is replaced by the new version (what install.sh does), then the refresh runs
  setVersion(serverJs, VERSION);
  const r = appCli('restart', '--if-outdated');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`0\\.0\\.1 → ${VERSION.replace(/\./g, '\\.')}`));
  const now = await officeHealth(base);
  assert.equal(now.version, VERSION);
  assert.notEqual(now.pid, old.pid);
  appCli('stop');
});
