#!/usr/bin/env node
// dev-team-office: la oficina en la terminal + la API de integración.

import os from 'node:os';
import path from 'node:path';
import { startServer, DEFAULT_PORT, DEFAULT_HOST, VERSION, defaultSocketPath } from '../server/server.js';

const HELP = `dev-team-office ${VERSION}: tu agente de código como un equipo de desarrollo, en la terminal.

Uso:
  dev-team-office                 Abre la oficina en la terminal y levanta la API.
                                  Si ya hay una oficina corriendo, se conecta a ella.
  dev-team-office serve           Sólo la API, sin interfaz (para dejarla en segundo plano).
  dev-team-office watch [url]     Mira una oficina que ya está corriendo (por defecto la local).
  dev-team-office status          ¿Hay una oficina corriendo? Muestra versión y endpoints.
  dev-team-office demo [--pi]     Reproduce una sesión de ejemplo (Claude Code, o flujo TDD de Pi).
  dev-team-office task "<texto>" --agent pi|opencode|claude [--session <id>] [--launch [--cwd <dir>]]
                                  Envía una tarea al agente: a su sesión abierta, o lanza una
                                  ejecución nueva con --launch. Sin --agent, muestra a quién se puede.
  dev-team-office tasks           Lista las tareas enviadas y su estado.
  dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …]
                                  [--command …] [--source …] [--session …]
                                  Envía un evento (task, phase, tool_start, chat, poke, done…).

Opciones:
  --port <n>        Puerto HTTP/WebSocket (por defecto ${DEFAULT_PORT}, o $DEV_TEAM_OFFICE_PORT)
  --host <ip>       Interfaz (por defecto ${DEFAULT_HOST}, o $DEV_TEAM_OFFICE_HOST)
  --socket <ruta>   Socket Unix de la API (por defecto ~/.dev-team-office/office.sock)
  --no-socket       No abrir el socket Unix
  --project <dir>   Proyecto con .devteam/ para ofrecer en el diálogo de encargos (repetible).
                    También: "projects" en ~/.dev-team-office/config.json
  --color <modo>    truecolor | 256 (se detecta solo)
  -v, --version     Versión
  -h, --help        Esta ayuda

Teclas: t tarea al agente · x cancelar tarea · q salir · tab elegir · m mensaje · s saludar · d/p demos · r reiniciar
API: docs/api.md (POST /v1/events/<source>, GET /v1/state, WS /v1/ws)`;

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a.startsWith('--no-')) args[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      const next = argv[i + 1];
      let v = true;
      if (inline !== undefined) v = inline;
      else if (next !== undefined && !next.startsWith('--')) { v = next; i++; }
      if (k === 'project') (args.projects ||= []).push(path.resolve(String(v)));
      else args[k] = v;
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.DEV_TEAM_OFFICE_PORT) || DEFAULT_PORT;
const host = args.host || process.env.DEV_TEAM_OFFICE_HOST || DEFAULT_HOST;
const socket = args.socket === false ? null : typeof args.socket === 'string' ? args.socket : defaultSocketPath();
const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
const tilde = (p) => (p && p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function api(path, body) {
  try {
    const res = await fetch(`${base}${path}`, body === undefined ? { signal: AbortSignal.timeout(2000) } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000),
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

// ---------------------------------------------------------------- comandos

async function openTui(feedFactory, endpoints, notice) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    fail('La oficina necesita una terminal interactiva. Para usarla sin interfaz: dev-team-office serve');
  }
  const { runTui } = await import('../tui/app.js');
  const { feed, close } = await feedFactory();
  await runTui({ feed, endpoints, notice, colorMode: args.color === '256' ? '256' : args.color === 'truecolor' ? 'truecolor' : undefined });
  await close?.();
  process.exit(0);
}

async function cmdOpen() {
  const notes = [];
  let server;
  try {
    server = await startServer({ port, host, socket, log: (m) => notes.push(m), projects: args.projects });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    const other = await runningOffice();
    if (!other) fail(`El puerto ${port} está ocupado por otro programa. Usa --port <n>.`);
    return cmdWatch(`ws://${new URL(base).host}/v1/ws`, 'Conectado a la oficina que ya corría');
  }
  const { localFeed } = await import('../tui/feeds.js');
  const warning = notes.find((n) => n.startsWith('Socket Unix no disponible'));
  await openTui(async () => ({ feed: localFeed(server), close: () => server.close() }), [server.url, tilde(server.socket)].filter(Boolean), warning);
}

async function cmdWatch(url, notice) {
  let ws = url || `ws://${new URL(base).host}/v1/ws`;
  if (/^https?:/.test(ws)) ws = ws.replace(/^http/, 'ws').replace(/\/?$/, '') + '/v1/ws';
  const { remoteFeed } = await import('../tui/feeds.js');
  await openTui(async () => ({ feed: remoteFeed(ws) }), [ws.replace(/^ws/, 'http').replace(/\/v1\/ws$/, '')], notice);
}

async function cmdServe() {
  try {
    const server = await startServer({ port, host, socket, log: console.log, projects: args.projects });
    const stop = async () => { await server.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    if (err.code === 'EADDRINUSE') fail(`El puerto ${port} ya está en uso. ¿Otra oficina corriendo? Prueba: dev-team-office status`);
    throw err;
  }
}

async function cmdStatus() {
  const h = await runningOffice();
  if (!h) fail(`No hay ninguna oficina en ${base}.`);
  console.log(`dev-team-office ${h.version} (pid ${h.pid}, ${h.uptime}s)\n  HTTP/WS: ${h.url}\n  socket:  ${tilde(h.socket) || '(sin socket Unix)'}`);
}

async function cmdDemo() {
  const out = await api('/v1/commands', { action: args.pi ? 'demo-pi' : 'demo', speed: Number(args.speed) || 1 });
  if (!out) fail(`No hay ninguna oficina en ${base}. Ábrela con: dev-team-office`);
  console.log(out.ok ? 'Demo en marcha.' : `No se pudo: ${out.error}`);
}

async function cmdSend() {
  const kind = args._[1];
  if (!kind) fail('Uso: dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …]');
  const text = typeof args.text === 'string' ? args.text : undefined;
  const role = typeof args.role === 'string' ? args.role : undefined;
  let out;
  if (kind === 'chat' || kind === 'poke') {
    out = await api('/v1/messages', { type: kind, text, role, from: args.from || 'CLI' });
  } else {
    const input = args.file ? { file_path: args.file } : args.command ? { command: args.command } : undefined;
    out = await api(`/v1/events/${encodeURIComponent(args.source || 'cli')}`, {
      session: args.session || 'cli', kind, text, role, phase: args.phase, tool: args.tool, input, ok: args.ok !== 'false',
    });
  }
  if (!out) fail(`No hay ninguna oficina en ${base}.`);
  console.log(out.ok ? `ok (${out.accepted ?? 1} evento${out.accepted === 1 ? '' : 's'})` : `error: ${out.error}`);
}

async function cmdTask() {
  const text = args._.slice(1).join(' ').trim();
  const snap = await api('/v1/tasks');
  if (!snap) fail(`No hay ninguna oficina en ${base}. Ábrela con: dev-team-office`);
  if (!text || !args.agent) {
    const name = { 'claude-code': 'claude', opencode: 'opencode', pi: 'pi' };
    console.log('Sesiones conectadas (reciben la tarea al instante):');
    for (const a of snap.agents) console.log(`  --agent ${name[a.agent] || a.agent} --session ${a.session}   (${tilde(a.cwd)})`);
    if (!snap.agents.length) console.log('  (ninguna)');
    console.log(`Ejecuciones nuevas (--launch, en ${tilde(snap.defaultCwd)} o --cwd):`);
    for (const l of snap.launchers) console.log(`  --agent ${name[l.agent] || l.agent} --launch   ${l.available ? '' : `(no encuentro "${l.command}")`}`);
    console.log('Claude Code: --agent claude --session <id> deja la tarea en cola hasta que termine su turno.');
    if (!text) return;
    process.exit(1);
  }
  const out = await api('/v1/tasks', {
    text, agent: args.agent === 'claude' ? 'claude-code' : args.agent, session: typeof args.session === 'string' ? args.session : undefined,
    mode: args.launch ? 'launch' : 'session', cwd: typeof args.cwd === 'string' ? args.cwd : undefined, from: 'CLI',
  });
  if (!out?.ok) fail(`No se pudo: ${out?.error || 'sin respuesta'}`);
  console.log(`${out.task.id}: ${out.task.status}${out.task.detail ? ` (${out.task.detail})` : ''}`);
}

async function cmdTasks() {
  const snap = await api('/v1/tasks');
  if (!snap) fail(`No hay ninguna oficina en ${base}.`);
  for (const t of snap.tasks) console.log(`${t.id.padEnd(4)} ${t.status.padEnd(9)} ${t.agent.padEnd(11)} ${t.text}${t.detail ? `  · ${t.detail}` : ''}`);
  if (!snap.tasks.length) console.log('(sin tareas)');
}

// ---------------------------------------------------------------- main

if (args.help) { console.log(HELP); process.exit(0); }
if (args.version) { console.log(VERSION); process.exit(0); }

const commands = { open: cmdOpen, serve: cmdServe, watch: () => cmdWatch(args._[1]), status: cmdStatus, demo: cmdDemo, send: cmdSend, task: cmdTask, tasks: cmdTasks, help: () => console.log(HELP) };
const cmd = commands[args._[0] || 'open'];
if (!cmd) fail(`Comando desconocido: ${args._[0]}\n\n${HELP}`);
cmd().catch((err) => fail(err.stack || err.message));
