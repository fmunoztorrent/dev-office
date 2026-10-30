#!/usr/bin/env node
// Installation checks: installs Dev Team Office the way a new user would, once per agent (Claude
// Code, Pi, OpenCode). Each runs in an empty HOME with only node and that agent on the PATH, and the
// script checks that the install is simple and reproducible:
//
//   prereq     Node.js >= 22.13 and the agent's CLI
//   install    the one-line installer finishes on its own
//   command    a new terminal finds `dev-team-office` (the user said yes to adding it to the PATH)
//   doctor     `dev-team-office doctor` sees the agent connected (integration, MCP, skills)
//   mcp        the agent itself lists the office's MCP server
//   office     the office starts
//   report     a headless run of the agent reaches the office
//   again      installing again changes nothing (nothing duplicated)
//   uninstall  `dev-team-office uninstall` removes it and leaves the user's own settings as they were
//
//   node scripts/install-check.mjs [--agent claude,pi,opencode] [--source local|github] [--login]
//                                  [--container] [--keep] [--json <file>]
//
// --source local installs this checkout (DEV_TEAM_OFFICE_SOURCE). --source github runs the README's
// one-liner (the installer and the code published on GitHub today). --source download runs this
// checkout's installer, which downloads the code from GitHub (to try an installer fix before it is
// published).
// --login links your agents' logins into the empty HOME (as scripts/dev-session.sh does), so the run
// talks to a model. Without it the agent has no login, like right after installing it. On macOS,
// Claude Code keeps its login in the Keychain, so it is logged in either way.
// --container runs the same checks in a clean Linux (podman or docker). The agents are installed
// there with npm, and no login ever goes in.
// Nothing touches your real HOME: everything lives in /tmp/dto-install-* and is deleted at the end.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONE_LINER = 'https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh';
const PROMPT = 'Reply with exactly one word: hola';
const MARK = 'dev-team-office';
const REAL_HOME = os.homedir();
// where the empty HOMEs go: /tmp on your machine; in the container, /home (like a Linux user's)
const BASE = process.env.DTO_INSTALL_BASE || '/tmp';

const AGENTS = {
  claude: {
    label: 'Claude Code', cli: 'claude', npm: '@anthropic-ai/claude-code', source: 'claude-code',
    run: ['-p', PROMPT], mcpList: ['mcp', 'list'],
    // what the user already had: their own setting and their own hook must survive
    config: (h) => [[path.join(h, '.claude', 'settings.json'), { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }]],
    login: () => [], // the Keychain (macOS) is used whatever the HOME
    traces: (h) => [path.join(h, '.claude', 'settings.json'), path.join(h, '.claude.json'), path.join(h, '.claude', 'skills', MARK)],
  },
  pi: {
    label: 'Pi', cli: 'pi', npm: '@earendil-works/pi-coding-agent', source: 'pi',
    run: ['-p', PROMPT], mcpList: null,
    config: (h) => [[path.join(h, '.pi', 'agent', 'settings.json'), { quietStartup: true, ...piModel() }]],
    login: (h) => [[path.join(REAL_HOME, '.pi', 'agent', 'auth.json'), path.join(h, '.pi', 'agent', 'auth.json')]],
    traces: (h) => [path.join(h, '.pi', 'agent', 'extensions', `${MARK}.ts`), path.join(h, '.pi', 'agent', 'mcp.json')],
  },
  opencode: {
    label: 'OpenCode', cli: 'opencode', npm: 'opencode-ai', source: 'opencode',
    run: ['run', PROMPT], mcpList: ['mcp', 'list'],
    config: (h) => [[path.join(h, '.config', 'opencode', 'opencode.json'), { $schema: 'https://opencode.ai/config.json', theme: 'tokyonight' }]],
    login: (h) => [[path.join(REAL_HOME, '.local', 'share', 'opencode', 'auth.json'), path.join(h, '.local', 'share', 'opencode', 'auth.json')]],
    traces: (h) => [path.join(h, '.config', 'opencode', 'opencode.json'), path.join(h, '.config', 'opencode', 'plugins', `${MARK}.js`), path.join(h, '.config', 'opencode', 'plugin', `${MARK}.js`)],
  },
};

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const flag = (name) => argv.includes(`--${name}`);
const agents = opt('agent', 'claude,pi,opencode').split(',').map((s) => s.trim()).filter(Boolean);
const source = opt('source', 'local');
const login = flag('login');
const keep = flag('keep');
const jsonOut = opt('json', null);
for (const a of agents) if (!AGENTS[a]) { console.error(`install-check: unknown agent "${a}" (claude, pi, opencode)`); process.exit(2); }
if (!['local', 'github', 'download'].includes(source)) { console.error('install-check: --source local|github|download'); process.exit(2); }

// The model Pi uses in your own settings (with --login): without it, Pi does not know which to call.
function piModel() {
  if (!login) return {};
  try {
    const s = JSON.parse(fs.readFileSync(path.join(REAL_HOME, '.pi', 'agent', 'settings.json'), 'utf8'));
    return Object.fromEntries(['defaultProvider', 'defaultModel', 'defaultThinkingLevel'].filter((k) => s[k]).map((k) => [k, s[k]]));
  } catch { return {}; }
}

// ---------------------------------------------------------------- helpers

const which = (cmd, PATH = process.env.PATH) => PATH.split(':').map((d) => path.join(d, cmd)).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } }) || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const tail = (text, n = 3) => String(text || '').trim().split('\n').filter((l) => l.trim()).slice(-n).join(' ⏎ ').slice(0, 300);

/** Runs a command and returns { code, out, ms } (stdout and stderr together, never throws). */
function run(cmd, args, { env, cwd, timeout = 180_000, input } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { env, cwd, timeout, input, encoding: 'utf8', maxBuffer: 16 << 20 });
  return { code: r.status ?? (r.error ? -1 : null), out: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`, ms: Date.now() - t0 };
}

/** Does `want` (an object) still hold inside `have`? (the user's own settings, after us) */
function contains(have, want) {
  if (want === null || typeof want !== 'object') return have === want;
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  return !!have && typeof have === 'object' && Object.entries(want).every(([k, v]) => contains(have[k], v));
}

// ---------------------------------------------------------------- one agent

async function checkAgent(key) {
  const a = AGENTS[key];
  const steps = [];
  const step = (name, ok, detail = '') => { steps.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(9)} ${detail}`); return ok; };
  console.log(`\n${a.label} — ${{ github: 'the one-liner from GitHub', download: "this checkout's installer, downloading from GitHub", local: 'this checkout' }[source]}${login ? ', with login' : ', no login'}`);

  const T = fs.mkdtempSync(path.join(BASE, `dto-install-${key}-`));
  const HOME = path.join(T, 'home');
  const BIN = path.join(T, 'bin');
  const PROJECT = path.join(T, 'project');
  for (const d of [HOME, BIN, PROJECT]) fs.mkdirSync(d, { recursive: true });

  // only node, npm and this agent on the PATH (plus the system), like a machine that has just those
  const cli = which(a.cli);
  for (const [name, target] of [['node', process.execPath], ['npm', which('npm')], ['npx', which('npx')], [a.cli, cli]]) if (target) fs.symlinkSync(target, path.join(BIN, name));
  const PATH0 = [BIN, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const port = await freePort();
  // the usual shell: zsh on macOS, bash on Linux; and what the user already had in its profile
  const SHELL = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  const PROFILE = path.join(HOME, process.platform === 'darwin' ? '.zshrc' : '.bashrc');
  const MINE = '# mine\nalias ll="ls -l"\n';
  fs.writeFileSync(PROFILE, MINE);
  const envOf = (PATH) => ({
    HOME, PATH, USER: os.userInfo().username, LOGNAME: os.userInfo().username, SHELL, TERM: 'dumb', LANG: 'en_US.UTF-8',
    DEV_TEAM_OFFICE_MODIFY_PATH: '1', // the installer's question, answered yes
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), // macOS gives every user one
    DEV_TEAM_OFFICE_PORT: String(port), DEV_TEAM_OFFICE_URL: `http://127.0.0.1:${port}`, DEV_TEAM_OFFICE_WEATHER: 'off',
  });

  // what the user already had in their agent's settings
  const seeded = a.config(HOME);
  for (const [file, data] of seeded) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); }
  if (login) for (const [from, to] of a.login(HOME)) if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.symlinkSync(from, to); }

  let office = null;
  try {
    // prereq
    const [maj, min] = process.versions.node.split('.').map(Number);
    const version = cli ? run(cli, ['--version'], { env: envOf(PATH0), timeout: 30_000 }) : null;
    if (!step('prereq', (maj > 22 || (maj === 22 && min >= 13)) && version?.code === 0, `node ${process.versions.node} · ${a.cli} ${cli ? tail(version.out, 1) : 'not installed'}`)) return { agent: key, steps };

    // install: the one command of the README
    const install = () => (source === 'github'
      ? run('/bin/sh', ['-c', `curl -fsSL ${ONE_LINER} | sh`], { env: envOf(PATH0) })
      : run('/bin/sh', [path.join(REPO, 'install.sh')], { env: { ...envOf(PATH0), ...(source === 'local' ? { DEV_TEAM_OFFICE_SOURCE: REPO } : {}) } }));
    const inst = install();
    fs.writeFileSync(path.join(T, 'install.log'), inst.out);
    const connected = inst.out.split('\n').find((l) => l.includes(a.label) && /✓/.test(l));
    step('install', inst.code === 0 && !!connected, `exit ${inst.code} · ${(inst.ms / 1000).toFixed(1)}s · ${inst.out.split('\n').filter((l) => l.trim()).length} lines · ${connected ? connected.trim() : `${a.label} not connected`}`);

    // command: a new terminal (the user's shell, reading its profile) finds it
    const local = path.join(HOME, '.local', 'bin');
    const fresh = run(SHELL, ['-i', '-c', `command -v ${MARK}`], { env: envOf(PATH0), timeout: 30_000 });
    const found = fresh.out.split('\n').find((l) => l.trim().endsWith(`/${MARK}`));
    const hinted = /add .*\.local\/bin.* to your PATH|agrega .*\.local\/bin.* a tu PATH/i.test(inst.out);
    const installed = fs.existsSync(path.join(local, MARK));
    step('command', !!found || (installed && hinted), found ? `a new ${path.basename(SHELL)} finds it (${found.trim().replace(HOME, '~')})` : installed ? (hinted ? 'at ~/.local/bin; a new terminal does not find it, the installer only says to add ~/.local/bin to the PATH' : 'at ~/.local/bin, and nothing says to add it to the PATH') : 'not installed');
    const PATH1 = `${local}:${PATH0}`; // the user followed the hint
    const env = envOf(PATH1);

    // doctor
    const doc = run(MARK, ['doctor'], { env, timeout: 60_000 });
    const line = doc.out.split('\n').find((l) => l.includes(a.label)) || '';
    step('doctor', !!line && !line.includes('✗'), line ? line.trim().replace(/^[✓✗·]\s*/, '') : `${a.label} not in doctor (exit ${doc.code})`);

    // mcp: as the agent itself sees it
    if (a.mcpList) {
      const m = run(a.cli, a.mcpList, { env, cwd: PROJECT, timeout: 90_000 });
      const row = m.out.split('\n').find((l) => l.includes(MARK));
      step('mcp', !!row, row ? row.trim().slice(0, 120) : `not listed by \`${a.cli} ${a.mcpList.join(' ')}\` (exit ${m.code})`);
    } else {
      const mcp = readJson(path.join(HOME, '.pi', 'agent', 'mcp.json'));
      step('mcp', !!mcp?.mcpServers?.[MARK], mcp?.mcpServers?.[MARK] ? '~/.pi/agent/mcp.json has it (Pi has no `mcp list`)' : 'missing from ~/.pi/agent/mcp.json');
    }

    // office
    office = spawn(path.join(local, MARK), ['serve', '--port', String(port)], { env, cwd: PROJECT, detached: true, stdio: ['ignore', fs.openSync(path.join(T, 'office.log'), 'a'), fs.openSync(path.join(T, 'office.log'), 'a')] });
    office.on('error', () => {}); // not installed: the health check says so
    let health = null;
    for (let i = 0; i < 40 && !health; i++) { await sleep(250); try { health = await (await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) })).json(); } catch { /* not yet */ } }
    step('office', health?.name === MARK, health ? `${health.name} ${health.version} at http://127.0.0.1:${port}` : 'did not start (office.log)');

    // report: a real, headless run of the agent in a project
    run('git', ['init', '-q'], { cwd: PROJECT, env });
    fs.writeFileSync(path.join(PROJECT, 'README.md'), '# test project\n');
    const r = run(a.cli, a.run, { env, cwd: PROJECT, timeout: 150_000, input: '' });
    fs.writeFileSync(path.join(T, 'agent.log'), r.out);
    let seen = null;
    for (let i = 0; i < 20 && !seen?.events; i++) {
      await sleep(500);
      const st = await fetch(`http://127.0.0.1:${port}/v1/state`).then((x) => x.json()).catch(() => null);
      const evs = (st?.log || []).filter((e) => e.source === a.source);
      if (evs.length || st?.sessions?.some((s) => s.source === a.source)) seen = { events: evs.length, kinds: [...new Set(evs.map((e) => e.kind))].join(', ') };
    }
    const answered = r.code === 0 && /hola/i.test(r.out);
    step('report', !!seen, `${seen ? `the office got ${seen.events} event(s): ${seen.kinds || 'a session'}` : 'nothing reached the office'} · model: ${answered ? 'answered' : `no answer (exit ${r.code}: ${tail(r.out, 1) || '—'})`}`);

    // again: the installer twice is the same as once
    const before = Object.fromEntries(a.traces(HOME).map((f) => [f, fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null]));
    const again = install();
    const doc2 = run(MARK, ['doctor'], { env, timeout: 60_000 });
    const line2 = doc2.out.split('\n').find((l) => l.includes(a.label)) || '';
    const changed = a.traces(HOME).filter((f) => (fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null) !== before[f]).map((f) => f.replace(HOME, '~'));
    const dupes = key === 'claude' ? duplicatedHooks(path.join(HOME, '.claude', 'settings.json')) : [];
    step('again', again.code === 0 && !!line2 && !line2.includes('✗') && !dupes.length, `exit ${again.code} · ${dupes.length ? `duplicated hooks: ${dupes.join(', ')}` : 'nothing duplicated'}${changed.length ? ` · rewritten: ${changed.join(', ')}` : ''}`);

    // uninstall: our traces go away, the user's own settings stay
    stop(office); office = null;
    const un = run(path.join(local, MARK), ['uninstall'], { env, timeout: 90_000 });
    const left = [...a.traces(HOME), path.join(HOME, '.agents', 'skills', MARK), path.join(local, MARK)]
      .filter((f) => fs.existsSync(f) && (fs.statSync(f).isDirectory() || fs.readFileSync(f, 'utf8').includes(MARK))).map((f) => f.replace(HOME, '~'));
    const lost = seeded.filter(([file, data]) => !contains(readJson(file), data)).map(([file]) => file.replace(HOME, '~'));
    if (fs.readFileSync(PROFILE, 'utf8') !== MINE) lost.push(PROFILE.replace(HOME, '~'));
    step('uninstall', un.code === 0 && !left.length && !lost.length, `exit ${un.code} · ${left.length ? `left behind: ${left.join(', ')}` : 'nothing left'} · ${lost.length ? `user settings changed: ${lost.join(', ')}` : 'user settings intact'}`);
  } catch (err) {
    step('error', false, err.message);
  } finally {
    stop(office);
    if (keep) console.log(`  (kept: ${T})`);
    else { spawnSync('find', [T, '-type', 'l', '-delete']); fs.rmSync(T, { recursive: true, force: true }); }
  }
  return { agent: key, label: a.label, steps };
}

/** Hooks of ours that appear more than once for the same event. */
function duplicatedHooks(file) {
  const hooks = readJson(file)?.hooks || {};
  return Object.entries(hooks).filter(([, groups]) => (groups || []).filter((g) => JSON.stringify(g).includes(MARK)).length > 1).map(([ev]) => ev);
}

function stop(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
}

// ---------------------------------------------------------------- the container

function inContainer() {
  const engine = ['podman', 'docker'].find((e) => which(e));
  if (!engine) { console.error('install-check: --container needs podman or docker'); process.exit(2); }
  const pkgs = agents.map((k) => AGENTS[k].npm).join(' ');
  const out = fs.realpathSync(fs.mkdtempSync('/tmp/dto-install-out-')); // podman on macOS shares /private/tmp, not /tmp
  const inner = argv.filter((x, i) => x !== '--container' && x !== '--login' && !(argv[i - 1] === '--json')).filter((x) => x !== '--json');
  const script = `set -e; npm install -g --no-audit --no-fund ${pkgs} > /tmp/npm.log 2>&1 || { tail -20 /tmp/npm.log; exit 1; }; node /src/scripts/install-check.mjs ${inner.join(' ')} --json /out/report.json`;
  console.log(`A clean Linux (${engine}, node:22-bookworm): npm install -g ${pkgs}; no login goes in.`);
  const r = spawnSync(engine, ['run', '--rm', '-e', 'DTO_INSTALL_BASE=/home', '-v', `${REPO}:/src:ro`, '-v', `${out}:/out`, 'docker.io/library/node:22-bookworm', 'bash', '-c', script], { stdio: 'inherit' });
  if (jsonOut && fs.existsSync(path.join(out, 'report.json'))) fs.copyFileSync(path.join(out, 'report.json'), jsonOut);
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

// ---------------------------------------------------------------- main

if (flag('container')) inContainer();
else {
  const started = new Date();
  const results = [];
  for (const a of agents) results.push(await checkAgent(a));
  const names = ['prereq', 'install', 'command', 'doctor', 'mcp', 'office', 'report', 'again', 'uninstall'];
  console.log(`\n${'agent'.padEnd(12)}${names.map((n) => n.padEnd(10)).join('')}`);
  for (const r of results) console.log(`${(r.label || r.agent).padEnd(12)}${names.map((n) => { const s = r.steps.find((x) => x.name === n); return (s ? (s.ok ? '✓' : '✗') : '·').padEnd(10); }).join('')}`);
  const report = { started: started.toISOString(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.versions.node, source, login, results };
  if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = results.every((r) => r.steps.every((s) => s.ok)) ? 0 : 1;
}
