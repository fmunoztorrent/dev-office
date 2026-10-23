#!/usr/bin/env node
// dev-team-office: the office (a company with one or more offices) + the integration API.
// It is launched from a terminal: that is where the log with the agents' activity shows; the game
// opens in that same terminal (g) or in the browser, at the URL the server serves (o). Inside
// herdr, the agent opens in a new pane and orchestrates its work from there.

import os from 'node:os';
import path from 'node:path';
import { startServer, DEFAULT_PORT, DEFAULT_HOST, VERSION, defaultSocketPath } from '../server/server.js';
import { listTeams, installTeam } from './team.js';
import { openStore } from '../server/store.js';
import { detectHarness } from '../integrations/common/devteam.mjs';
import { t, setLanguage, getLanguage } from '../public/i18n.js';
import { systemZone, countryName, zoneInfo } from '../public/clock.js';

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const args = { _: [], rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args.rest = argv.slice(i + 1); break; } // what follows is the command (dev-team-office pane -- npm test)
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a.startsWith('--no-')) args[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      const next = argv[i + 1];
      let v = true;
      if (inline !== undefined) v = inline;
      else if (next !== undefined && !next.startsWith('--')) { v = next; i++; }
      args[k] = v;
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.DEV_TEAM_OFFICE_PORT) || DEFAULT_PORT;
const host = args.host || process.env.DEV_TEAM_OFFICE_HOST || DEFAULT_HOST;
const socket = args.socket === false ? null : typeof args.socket === 'string' ? args.socket : defaultSocketPath();
// inside a pane the office opened, the URL comes in the environment
const base = !args.port && !args.host && process.env.DEV_TEAM_OFFICE_URL ? process.env.DEV_TEAM_OFFICE_URL.replace(/\/$/, '') : `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
const tilde = (p) => (p && p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);
const str = (v) => (typeof v === 'string' ? v : undefined);

// the CLI messages, in the office's language (the one saved in the database)
try { const store = openStore(); setLanguage(store.getPrefs().lang); store.close(); } catch { /* no database yet: English */ }

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  try {
    const res = await fetch(`${base}${path}`, method === 'GET' ? { signal: AbortSignal.timeout(2000) } : {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(2000),
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function runningOffice() {
  const h = await api('/v1/health');
  return h?.name === 'dev-team-office' ? h : null;
}

const colorMode = () => (args.color === '256' ? '256' : args.color === 'truecolor' ? 'truecolor' : undefined);

// ---------------------------------------------------------------- the office

/** Inside herdr: the agent, in a new pane (the one from --agent, or the one in the settings). */
async function launchAgent(server) {
  if (!server.herdr?.available || args.launch === false) return;
  const out = await server.launchStartAgent({ cwd: str(args.cwd) || process.cwd(), agent: str(args.agent) });
  if (out.ok) server.bus.emit('log', { ts: Date.now(), office: out.agent.office, text: t('console.startAgent', { agent: `${out.agent.name} (${out.agent.harness})`, pane: out.pane, office: server.company.info(out.agent.office)?.name || '' }) });
  else if (!out.skipped) server.bus.emit('log', { ts: Date.now(), text: t('console.startFailed', { error: out.error }) });
}

// Inside herdr the terminal shows the activity monitor, not the game (--no-monitor: the previous one).
const wantsMonitor = () => args._[0] === 'monitor' || (process.env.HERDR_ENV === '1' && args.monitor !== false);

/** Starts the office and leaves the log in the terminal; with `game`, it goes straight into the game. */
async function cmdOpen({ game = false } = {}) {
  // Without an interactive terminal (a script, a background process) there is no game in the terminal,
  // but the office stays alive for the browser, with the log.
  if (!process.stdout.isTTY || !process.stdin.isTTY) return cmdServe();
  const notes = [];
  let started = false;
  let server;
  try {
    server = await startServer({ port, host, socket, log: (m) => { if (!started) notes.push(m); }, herdr: args.herdr !== false });
    started = true;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    const other = await runningOffice();
    if (!other) fail(t('cli.portBusyOther', { port }));
    if (wantsMonitor()) return cmdMonitorRemote();
    return cmdWatch(`ws://${new URL(base).host}/v1/ws`, t('console.attached'));
  }
  if (wantsMonitor()) {
    const [{ runMonitor }, { localFeed }, { runTui }, { openBrowser }] = await Promise.all([import('../tui/monitor.js'), import('../tui/feeds.js'), import('../tui/app.js'), import('../tui/console.js')]);
    const endpoints = [server.url, tilde(server.socket)].filter(Boolean);
    const feed = localFeed(server);
    setImmediate(() => { for (const n of notes) server.bus.emit('log', { ts: Date.now(), text: n }); });
    launchAgent(server).catch(() => {});
    await runMonitor({
      feed, server, colorMode: colorMode() || (process.env.COLORTERM ? 'truecolor' : '256'), info: { version: VERSION, url: server.url, local: true },
      onBrowser: () => openBrowser(server.url),
      onGame: async () => { const f = localFeed(server); try { await runTui({ feed: f, endpoints, colorMode: colorMode(), quitKey: 'log' }); } finally { f.close(); } },
    });
    feed.close();
    await server.close();
    process.exit(0);
  }
  const [{ runConsole }, { localFeed }, { runTui }] = await Promise.all([import('../tui/console.js'), import('../tui/feeds.js'), import('../tui/app.js')]);
  const endpoints = [server.url, tilde(server.socket)].filter(Boolean);
  const onGame = async () => {
    const feed = localFeed(server);
    try { await runTui({ feed, endpoints, colorMode: colorMode(), quitKey: 'log' }); } finally { feed.close(); }
  };
  const done = runConsole({ server, onGame, notes, version: VERSION, colorMode: colorMode() || (process.env.COLORTERM ? 'truecolor' : '256'), startInGame: game });
  launchAgent(server).catch(() => {});
  await done;
  await server.close();
  process.exit(0);
}

/** The monitor of an office that is already running (over WebSocket). */
async function cmdMonitorRemote() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) fail(t('cli.needsTty'));
  const ws = `ws://${new URL(base).host}/v1/ws`;
  const [{ runMonitor }, { remoteFeed }, { runTui }, { openBrowser }] = await Promise.all([import('../tui/monitor.js'), import('../tui/feeds.js'), import('../tui/app.js'), import('../tui/console.js')]);
  const feed = remoteFeed(ws);
  await runMonitor({
    feed, colorMode: colorMode() || (process.env.COLORTERM ? 'truecolor' : '256'), info: { version: VERSION, url: base, local: false },
    onBrowser: () => openBrowser(base),
    onGame: async () => { const f = remoteFeed(ws); try { await runTui({ feed: f, endpoints: [base], colorMode: colorMode(), quitKey: 'log' }); } finally { f.close(); } },
  });
  feed.close();
  process.exit(0);
}

async function cmdWatch(url, notice) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) fail(t('cli.needsTty'));
  let ws = url || `ws://${new URL(base).host}/v1/ws`;
  if (/^https?:/.test(ws)) ws = ws.replace(/^http/, 'ws').replace(/\/?$/, '') + '/v1/ws';
  const [{ remoteFeed }, { runTui }] = await Promise.all([import('../tui/feeds.js'), import('../tui/app.js')]);
  const feed = remoteFeed(ws);
  await runTui({ feed, endpoints: [ws.replace(/^ws/, 'http').replace(/\/v1\/ws$/, '')], notice, colorMode: colorMode(), quitKey: 'quit' });
  feed.close();
  process.exit(0);
}

async function cmdServe() {
  const notes = [];
  let started = false;
  let server;
  try {
    server = await startServer({ port, host, socket, log: (m) => { if (!started) notes.push(m); }, herdr: args.herdr !== false });
    started = true;
  } catch (err) {
    if (err.code === 'EADDRINUSE') fail(t('cli.portBusy', { port }));
    throw err;
  }
  const { createLog } = await import('../tui/console.js');
  const log = createLog({ server, write: (s) => process.stdout.write(s), color: false });
  for (const n of notes) log.line({ text: n });
  if (str(args.agent)) launchAgent(server).catch(() => {});
  const stop = async () => { log.close(); await server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function cmdStatus() {
  const h = await runningOffice();
  if (!h) fail(t('cli.noOffice', { base }));
  console.log(t('cli.status', { version: h.version, pid: h.pid, uptime: h.uptime, url: h.url, socket: tilde(h.socket) || t('cli.noSocket') }));
}

async function cmdDemo() {
  const out = await api('/v1/commands', { action: args.pi ? 'demo-pi' : 'demo', speed: Number(args.speed) || 1, office: str(args.office) });
  if (!out) fail(t('cli.noOfficeOpen', { base }));
  console.log(out.ok ? t('cli.demoRunning') : t('cli.couldNot', { error: out.error }));
}

async function cmdSend() {
  const kind = args._[1];
  if (!kind) fail(t('cli.sendUsage'));
  const text = str(args.text);
  const role = str(args.role);
  const office = str(args.office);
  let out;
  if (kind === 'chat' || kind === 'poke') {
    out = await api('/v1/messages', { type: kind, text, role, from: args.from || 'CLI', office });
  } else {
    const input = args.file ? { file_path: args.file } : args.command ? { command: args.command } : undefined;
    out = await api(`/v1/events/${encodeURIComponent(args.source || 'cli')}`, {
      session: args.session || 'cli', kind, text, role, phase: args.phase, tool: args.tool, input, ok: args.ok !== 'false', office,
    });
  }
  if (!out) fail(t('cli.noOffice', { base }));
  console.log(out.ok ? t('cli.sendOk', { n: out.accepted ?? 1 }) : t('cli.sendErr', { error: out.error }));
}

async function cmdTask() {
  const text = args._.slice(1).join(' ').trim();
  const snap = await api('/v1/tasks');
  if (!snap) fail(t('cli.noOfficeOpen', { base }));
  if (!text || !args.agent) {
    const name = { 'claude-code': 'claude', opencode: 'opencode', pi: 'pi', codex: 'codex' };
    console.log(t('cli.sessions'));
    for (const a of snap.agents) console.log(`  --agent ${name[a.agent] || a.agent} --session ${a.session}   (${tilde(a.cwd)})`);
    if (!snap.agents.length) console.log(t('cli.none'));
    console.log(t('cli.launchers', { dir: tilde(snap.defaultCwd) }));
    for (const l of snap.launchers) console.log(`  --agent ${name[l.agent] || l.agent} --launch   ${l.available ? '' : t('cli.notFound', { cmd: l.agent })}`);
    console.log(t('cli.claudeHint'));
    if (!text) return;
    process.exit(1);
  }
  const out = await api('/v1/tasks', {
    text, agent: args.agent === 'claude' ? 'claude-code' : args.agent, session: str(args.session),
    mode: args.launch ? 'launch' : 'session', cwd: str(args.cwd), from: 'CLI', office: str(args.office),
  });
  if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
  console.log(`${out.task.id}: ${t(`taskStatus.${out.task.status}`)}${out.task.detail ? ` (${out.task.detail})` : ''}`);
}

async function cmdTasks() {
  const snap = await api('/v1/tasks');
  if (!snap) fail(t('cli.noOffice', { base }));
  for (const x of snap.tasks) console.log(`${x.id.padEnd(4)} ${t(`taskStatus.${x.status}`).padEnd(10)} ${x.agent.padEnd(11)} ${x.text}${x.detail ? `  · ${x.detail}` : ''}`);
  if (!snap.tasks.length) console.log(t('cli.noTasks'));
}

// The agents maintainer: through the API if an office is running (so open interfaces see it
// instantly), otherwise straight in the SQLite database.
async function cmdAgents() {
  const [, sub, ...rest] = args._;
  const office = await runningOffice();
  const harness = args.agent === 'claude' ? 'claude-code' : args.agent;
  if (sub === 'add') {
    const body = { path: rest.join(' '), harness, name: str(args.name), office: str(args.office) };
    let out;
    if (office) out = await api('/v1/agents', body);
    else { const store = openStore(); out = store.createAgent(body); store.close(); }
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    console.log(t('cli.registered', { id: out.agent.id, path: tilde(out.agent.path) }));
    return;
  }
  if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
    let out;
    if (office) out = await api(`/v1/agents/${encodeURIComponent(rest[0] || '')}`, undefined, 'DELETE');
    else { const store = openStore(); out = store.deleteAgent(rest[0]); store.close(); }
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    console.log(t('cli.removed', { id: rest[0] }));
    return;
  }
  if (sub) fail(t('cli.unknownSub', { cmd: 'agents', sub }));
  let agents;
  if (office) agents = ((await api('/v1/agents'))?.agents || []).filter((a) => a.registered);
  else {
    const store = openStore();
    agents = store.listAgents().map((a) => { const d = detectHarness(a.path); return { ...a, kinds: d.kinds, sessions: [], entries: d.entries.filter((e) => e.harnesses.includes(a.harness)) }; });
    store.close();
  }
  if (!agents.length) console.log(t('cli.noAgents'));
  for (const a of agents) {
    console.log(`${a.id}  🏢 ${a.office || 'main'}\n  ${a.harness} · ${tilde(a.path)}${a.kinds.length ? ` · ${a.kinds.join(' + ')}` : ''}${a.sessions.some((x) => x.live) ? t('cli.openSession') : ''}`);
    console.log(`  --pipeline ${a.entries.map((e) => e.id).join(' | ')}`);
  }
}

// The company's offices: through the API if an office is running, otherwise in the database.
async function cmdOffices() {
  const [, sub, ...rest] = args._;
  const live = await runningOffice();
  const body = () => ({ ...(str(args.name) || (sub === 'add' && rest.length) ? { name: str(args.name) || rest.join(' ') } : {}), ...(args.timezone !== undefined ? { timezone: args.timezone === 'system' || args.timezone === true ? null : args.timezone } : {}), ...(args.location !== undefined ? { location: args.location === true ? null : args.location } : {}) });
  const run = async (method, path, b, local) => {
    if (live) return api(path, b, method);
    const store = openStore();
    try { return local(store); } finally { store.close(); }
  };
  if (sub === 'add') {
    const out = await run('POST', '/v1/offices', body(), (s) => s.createOffice(body()));
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    console.log(t('cli.officeAdded', { id: out.office.id, name: out.office.name, tz: out.office.timezone || systemZone() }));
    return;
  }
  if (sub === 'set') {
    const id = rest[0];
    const out = await run('PUT', `/v1/offices/${encodeURIComponent(id || '')}`, body(), (s) => s.updateOffice(id, body()));
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    console.log(t('cli.officeSaved', { id }));
    return;
  }
  if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
    const id = rest[0];
    const out = await run('DELETE', `/v1/offices/${encodeURIComponent(id || '')}`, undefined, (s) => s.deleteOffice(id));
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    console.log(t('cli.officeRemoved', { id }));
    return;
  }
  if (sub) fail(t('cli.officesUsage'));
  let list, view;
  if (live) { const r = await api('/v1/offices'); list = r?.offices || []; view = r?.view; }
  else {
    const store = openStore();
    const prefs = store.getPrefs();
    view = prefs.view.office;
    list = store.listOffices().map((o) => { const tz = o.timezone || prefs.timezone || systemZone(); return { ...o, name: o.name || t('offices.main'), timezone: tz, country: zoneInfo(tz).country, agents: store.listAgents().filter((a) => a.office === o.id).length }; });
    store.close();
  }
  console.log(t('cli.offices'));
  for (const o of list) console.log(t('cli.officeLine', { id: o.id, name: o.name, tz: o.timezone, country: o.country ? ` (${countryName(o.country, getLanguage())})` : '', agents: o.agents, viewing: o.id === view ? t('cli.viewing') : '' }));
}

// The general settings (dev-team-office config [key] [value]).
const CONFIG_KEYS = ['lang', 'timezone', 'weather', 'herdr.launch', 'herdr.subagents', 'herdr.direction', 'herdr.startAgent', 'log.life', 'view.office', 'view.mode'];
async function cmdConfig() {
  const [, key, ...rest] = args._;
  const live = await runningOffice();
  const store = openStore();
  try {
    if (!key) {
      const p = store.getPrefs();
      console.log(t('cli.config', { file: tilde(store.file) }));
      const get = (k) => k.split('.').reduce((o, x) => o?.[x], p);
      for (const k of CONFIG_KEYS) console.log(`  ${k.padEnd(18)}${get(k) ?? `system (${systemZone()})`}`);
      return;
    }
    if (!CONFIG_KEYS.includes(key)) fail(t('cli.configUnknown', { key }));
    let value = rest.join(' ');
    if (['weather', 'herdr.launch', 'herdr.subagents', 'log.life'].includes(key)) value = /^(on|true|yes|si|sí|1)$/i.test(value);
    if (key === 'timezone' && (!value || value === 'system')) value = null;
    const [a, b] = key.split('.');
    const patch = b ? { [a]: { [b]: value } } : { [a]: value };
    const out = live ? await api('/v1/settings', { prefs: patch }, 'PUT') : store.setPrefs(patch);
    if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
    if (key === 'lang') setLanguage(value);
    console.log(t('cli.configSaved', { key, value: value ?? 'system' }));
  } finally { store.close(); }
}

/**
 * Inside herdr, from an agent's pane: opens a pane next to it with an activity (a command, or
 * another agent with a prompt) and tells the office, which assigns it to a team member while it
 * stays open. Prints the pane (JSON) so you can keep using it with `herdr pane read`.
 */
async function cmdPane() {
  const text = (args.rest.length ? args.rest : args._.slice(1)).join(' ').trim();
  if (!text && !args.agent) fail(t('cli.paneUsage'));
  const { Herdr, HERDR_KIND } = await import('../server/herdr.js');
  const herdr = new Herdr();
  if (!herdr.available) fail(t('err.noHerdr'));
  const office = process.env.DEV_TEAM_OFFICE_OFFICE || str(args.office);
  const env = { DEV_TEAM_OFFICE_URL: base, ...(office ? { DEV_TEAM_OFFICE_OFFICE: office } : {}), ...(process.env.DEV_TEAM_OFFICE_SOCKET ? { DEV_TEAM_OFFICE_SOCKET: process.env.DEV_TEAM_OFFICE_SOCKET } : {}) };
  const direction = args.direction === 'down' ? 'down' : 'right';
  const title = str(args.title);
  const harness = args.agent === 'claude' ? 'claude-code' : str(args.agent);
  let out;
  try {
    out = harness
      ? await herdr.launchAgent({ harness, cwd: process.cwd(), prompt: text || undefined, env, direction, title: title || text, label: title || HERDR_KIND[harness] || harness })
      : await herdr.launchCommand({ command: text, cwd: process.cwd(), direction, env, title });
  } catch (err) { fail(t('err.herdrFailed', { error: err.message })); }
  const reported = await api('/v1/panes', { pane: out.pane, parent: herdr.pane, role: str(args.role), title: title || text || harness, command: harness ? undefined : text, agent: harness, office, cwd: process.cwd() });
  console.log(JSON.stringify({ pane: out.pane, ...(out.name ? { name: out.name } : {}), office: reported?.office || office || null, role: reported?.role || null }));
  if (!reported) console.error(t('cli.paneOffline'));
}

/**
 * Adds this folder (its project) to the office: starts it if it is not running, registers the project
 * with its agent and shows which character plays each subagent. Same as the join_office MCP tool.
 */
async function cmdJoin() {
  const { createMcp, startOfficeDetached } = await import('../server/mcp.js');
  const mcp = createMcp({ base, socket, version: VERSION, cwd: process.cwd(), openStore, env: process.env, startOffice: () => startOfficeDetached({ port }) });
  const harness = args.agent === 'claude' ? 'claude-code' : str(args.agent);
  const out = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'join_office', arguments: { ...(args._[1] ? { path: args._[1] } : {}), ...(str(args.office) ? { office: str(args.office) } : {}), ...(str(args.name) ? { name: str(args.name) } : {}), ...(harness ? { harness } : {}), ...(args.open ? { open: true } : {}), ...(args.team === false ? { team: 'none' } : str(args.team) ? { team: str(args.team) } : {}) } } });
  mcp.close();
  const r = out.result;
  const text = r.content[0].text.split('\n\n{')[0];
  if (r.isError) fail(text);
  console.log(text);
}

/** A subagent's pane: what it is doing, live (the office opens it by itself inside herdr). */
async function cmdFollow() {
  const session = str(args.session), sub = str(args.sub);
  if (!session || !sub) fail(t('follow.usage'));
  const { runFollow } = await import('../tui/follow.js');
  const view = runFollow({ url: base, office: str(args.office) || process.env.DEV_TEAM_OFFICE_OFFICE, session, sub, colorMode: colorMode() || (process.env.COLORTERM ? 'truecolor' : '256') });
  const stop = () => { view.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
}

async function cmdPrompt() {
  const [, id, ...rest] = args._;
  const text = rest.join(' ').trim();
  if (!id || !text) fail(t('cli.promptUsage'));
  if (!(await runningOffice())) fail(t('cli.noOfficeOpen', { base }));
  const out = await api(`/v1/agents/${encodeURIComponent(id)}/prompt`, {
    text, entry: str(args.pipeline) || 'prompt', session: args.new ? null : undefined, from: 'CLI',
  });
  if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
  const x = out.task || out.run;
  console.log(`${x.id}: ${x.status}${x.detail ? ` (${x.detail})` : ''}`);
}

// Installing = leaving everything connected: integration, hooks, MCP and skills for each agent (bin/setup.js).
const onlyAgents = () => [...args._.slice(1), ...(str(args.only) ? args.only.split(',') : [])].map((x) => x.trim()).filter(Boolean);

async function cmdSetup() {
  const { setup } = await import('./setup.js');
  const out = setup({ only: onlyAgents(), dry: !!args['dry-run'] });
  if (!out.ok) fail(out.error);
  console.log(t('setup.title', { version: VERSION }));
  for (const l of out.lines) console.log(l);
  console.log(`\n${t(out.dry ? 'setup.dryDone' : 'setup.done')}`);
}

async function cmdUninstall() {
  const { uninstall } = await import('./setup.js');
  const out = uninstall({ only: onlyAgents(), dry: !!args['dry-run'], purge: !!args.purge });
  for (const l of out.lines) console.log(l);
}

async function cmdDoctor() {
  const { doctor } = await import('./setup.js');
  const out = await doctor({ base });
  console.log(t('doctor.title', { version: VERSION }));
  for (const c of out.checks) console.log(`${c.ok ? '✓' : c.optional ? '·' : '✗'} ${c.text}${c.fix ? `\n    → ${c.fix}` : ''}`);
  console.log(`\n${t(out.ok ? 'doctor.ok' : 'doctor.fail')}`);
  if (!out.ok) process.exitCode = 1;
}

// Updating: an installed copy is replaced by the latest version (with the same installer); a git
// clone is updated with git.
async function cmdUpdate() {
  const fs = await import('node:fs');
  const { ROOT_DIR } = await import('./setup.js');
  if (fs.existsSync(path.join(ROOT_DIR, '.git'))) { console.log(t('cli.updateGit', { dir: tilde(ROOT_DIR) })); return; }
  const { spawnSync } = await import('node:child_process');
  const url = process.env.DEV_TEAM_OFFICE_INSTALLER || 'https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh';
  const r = spawnSync('sh', ['-c', `curl -fsSL ${JSON.stringify(url)} | sh`], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}

// The team packs shipped with the package: they are listed and installed into a harness's agents.
async function cmdTeam() {
  const [, sub, ...rest] = args._;
  if (!sub || sub === 'list') {
    const teams = listTeams(str(args.from));
    if (!teams.length) { console.log(t('cli.teamNone')); return; }
    console.log(t('cli.teams'));
    for (const tm of teams) {
      console.log(`${tm.name}${tm.description ? ` — ${tm.description}` : ''}`);
      for (const [role, r] of Object.entries(tm.roles)) console.log(`  ${role.padEnd(10)} ${r.agent}`);
    }
    return;
  }
  if (sub === 'install') {
    const team = rest[0];
    const harness = str(args.agent);
    if (!team || !harness) fail(t('cli.teamUsage'));
    const p = str(args.project);
    const project = args.project === true ? process.cwd() : p ? path.resolve(p) : undefined;
    const out = installTeam({ team, harness, project, from: str(args.from) });
    if (!out.ok) fail(out.error);
    for (const l of out.lines) console.log(l);
    return;
  }
  fail(t('cli.teamUsage'));
}

// btw: a side question to an office's agent on duty (like Claude Code's /btw).
async function cmdBtw() {
  const text = (args.rest.length ? args.rest : args._.slice(1)).join(' ').trim();
  if (!text) fail(t('cli.btwUsage'));
  if (!(await runningOffice())) fail(t('cli.noOfficeOpen', { base }));
  let out = null;
  try {
    const res = await fetch(`${base}/v1/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, office: str(args.office) || process.env.DEV_TEAM_OFFICE_OFFICE, from: 'CLI', wait: true }), signal: AbortSignal.timeout(240_000),
    });
    out = await res.json();
  } catch { /* no answer */ }
  if (!out?.ok) fail(t('cli.couldNot', { error: out?.error || t('cli.noAnswer') }));
  console.log(out.ask.answer);
}

// The MCP server (stdio): Claude Code, Codex, OpenCode, Gemini or Cursor register it via `setup`.
async function cmdMcp() {
  const { runMcp, startOfficeDetached } = await import('../server/mcp.js');
  await runMcp({
    base, socket: process.env.DEV_TEAM_OFFICE_SOCKET || socket, version: VERSION, openStore,
    startOffice: () => startOfficeDetached({ port: args.port || process.env.DEV_TEAM_OFFICE_PORT }),
  });
  process.exit(0);
}

// ---------------------------------------------------------------- main

const HELP = () => t('cli.help', { version: VERSION, port: DEFAULT_PORT, host: DEFAULT_HOST });
if (args.help) { console.log(HELP()); process.exit(0); }
if (args.version) { console.log(VERSION); process.exit(0); }

const commands = {
  open: () => cmdOpen({ game: !!args.game }), game: () => cmdOpen({ game: true }), monitor: () => cmdOpen(), serve: cmdServe, watch: () => cmdWatch(args._[1]), status: cmdStatus,
  demo: cmdDemo, send: cmdSend, task: cmdTask, tasks: cmdTasks, install: cmdSetup, setup: cmdSetup, uninstall: cmdUninstall, doctor: cmdDoctor, update: cmdUpdate, agents: cmdAgents, offices: cmdOffices, config: cmdConfig,
  pane: cmdPane, follow: cmdFollow, join: cmdJoin, prompt: cmdPrompt, team: cmdTeam, mcp: cmdMcp, btw: cmdBtw, help: () => console.log(HELP()),
};
const cmd = commands[args._[0] || 'open'];
if (!cmd) fail(`${t('cli.unknownCommand', { cmd: args._[0] })}\n\n${HELP()}`);
cmd().catch((err) => fail(err.stack || err.message));
