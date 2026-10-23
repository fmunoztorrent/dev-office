// The MCP server (`dev-team-office mcp`): any agent with MCP registers its projects with the office,
// sees what each one brings, reports which phase it is in and sends work to another. With the office
// running it goes through its API; with it stopped, what gets registered stays in the database anyway.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';
import { createMcp, harnessOfClient, PROTOCOL_VERSIONS } from '../server/mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin', 'dev-team-office.js');
const tmp = (p = 'dto-mcp-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
// the user's subagents (~/.claude/agents, ~/.pi/agent/agents…) count when deciding whether an agent
// already has a team: these tests use an empty HOME, never the real one
process.env.HOME = tmp('dto-mcp-home-');
delete process.env.PI_CODING_AGENT_DIR;
// a new Claude Code session (send_task with no open session) runs the fake CLI, never the real `claude`
process.env.DEV_TEAM_OFFICE_CLAUDE_BIN = path.join(here, 'fixtures', 'fake-claude.mjs');
assert.equal(os.homedir(), process.env.HOME, 'os.homedir() ignoró $HOME');

/** A project with a Claude Code subagent that declares its role. */
function project(name = 'tienda') {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'power-sync.md'), '---\nname: power-sync\ndescription: sincroniza\nrole: backend\n---\nhola\n');
  return dir;
}

async function session(mcp, clientName = 'claude-code') {
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1' } } });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 10;
  const call = async (name, args = {}) => {
    const r = await mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const text = r.result.content[0].text;
    const json = text.includes('\n\n{') ? JSON.parse(text.slice(text.indexOf('\n\n{') + 2)) : null;
    return { error: !!r.result.isError, text, json };
  };
  return { init, call };
}

test('protocolo: initialize negocia la versión, lista las herramientas y contesta errores como JSON-RPC', async () => {
  const mcp = createMcp({ base: 'http://127.0.0.1:9', version: '9.9.9' });
  const { init } = await session(mcp);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'dev-team-office');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false }, prompts: { listChanged: false } });
  assert.match(init.result.instructions, /register_project/);
  const other = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01', clientInfo: { name: 'x' } } });
  assert.equal(other.result.protocolVersion, PROTOCOL_VERSIONS[0], 'una versión desconocida recibe la última');

  const list = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['join_office', 'office_status', 'office_start', 'register_project', 'list_projects', 'detect_project', 'report_activity', 'send_task', 'open_pane', 'create_office']) assert.ok(names.includes(n), n);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object', t.name);

  assert.deepEqual(await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'ping' }), { jsonrpc: '2.0', id: 4, result: {} });
  assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'nada/raro' })).error.code, -32601);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }), null);
  const unknown = await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'no_existe' } });
  assert.equal(unknown.result.isError, true);

  assert.equal(harnessOfClient('claude-code'), 'claude-code');
  assert.equal(harnessOfClient('codex-mcp-client'), 'codex');
  assert.equal(harnessOfClient('opencode'), 'opencode');
  assert.equal(harnessOfClient('pi-coding-agent'), 'pi');
  assert.equal(harnessOfClient('gemini-cli-mcp-client'), null);
});

test('con la oficina corriendo: registra (idempotente, con su oficina), detecta roles, reporta fases y manda tareas', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const dir = project();
  const mcp = createMcp({ base: server.url, cwd: dir, env: {} });
  try {
    const { call } = await session(mcp, 'claude-code');
    let r = await call('office_status');
    assert.equal(r.json.running, true);
    assert.equal(r.json.url, server.url);

    r = await call('detect_project');
    assert.equal(r.json.roles['power-sync'], 'backend', 'el role: declarado manda');
    assert.ok(r.json.harnesses.includes('claude-code'));

    r = await call('register_project', { office: 'Pagos', name: 'Tienda' });
    assert.equal(r.error, false, r.text);
    assert.deepEqual([r.json.harness, r.json.office, r.json.path, r.json.registered], ['claude-code', 'pagos', dir, true]);
    assert.ok(server.company.has('pagos'), 'la oficina se crea si no existe');
    r = await call('register_project', {});
    assert.deepEqual([r.json.registered, r.json.updated], [false, true], 'registrar de nuevo no duplica');
    assert.equal(server.store.listAgents().length, 1);

    r = await call('list_projects', { office: 'Pagos' });
    assert.equal(r.json.projects.length, 1);

    // report: without a session id, it lands in that folder's most recent session (the hook's)
    server.company.ingest('claude-code', { session_id: 'cc-1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Carrito' });
    r = await call('report_activity', { kind: 'phase', role: 'qa', phase: 'red', text: '2 tests fallan' });
    assert.equal(r.error, false, r.text);
    const office = server.company.get('pagos');
    assert.equal(office.sessions.get('cc-1').turn, 'qa');
    assert.equal(office.log.at(-1).phase, 'red');
    r = await call('report_activity', { kind: 'phase', role: 'qa' });
    assert.equal(r.error, true, 'phase sin fase es un error');

    r = await call('send_task', { project: dir, text: 'agrega cupones' });
    assert.equal(r.error, false, r.text);
    r = await call('create_office', { name: 'Logística', timezone: 'Europe/Madrid' });
    assert.equal(r.json.timezone, 'Europe/Madrid');
    r = await call('list_offices');
    assert.deepEqual(r.json.offices.map((o) => o.id), ['main', 'pagos', 'logistica']);

    r = await call('remove_project', { id: server.store.listAgents()[0].id });
    assert.equal(r.error, false);
    assert.equal(server.store.listAgents().length, 0);
    r = await call('open_pane', { command: 'npm test' });
    assert.equal(r.error, true, 'fuera de herdr no hay panes');
    assert.match(r.text, /herdr/);
  } finally { mcp.close(); await server.close(); }
});

test('con la oficina apagada: lo que se registra queda en la base y aparece al abrirla', async () => {
  const db = path.join(tmp(), 'office.db');
  const dir = project('blog');
  const mcp = createMcp({ base: 'http://127.0.0.1:9', socket: null, cwd: dir, openStore: () => openStore(db), env: {} });
  try {
    const { call } = await session(mcp, 'codex-mcp-client');
    let r = await call('office_status');
    assert.equal(r.json.running, false);
    r = await call('register_project', { office: 'Contenido' });
    assert.equal(r.error, false, r.text);
    assert.equal(r.json.harness, 'codex', 'el harness es el de quien llama');
    assert.equal(r.json.officeRunning, false);
    r = await call('report_activity', { kind: 'task', text: 'algo' });
    assert.equal(r.json.delivered, false, 'reportar sin oficina no es un error');
    r = await call('send_task', { project: dir, text: 'x' });
    assert.equal(r.error, true);
  } finally { mcp.close(); }
  const server = await startServer({ port: 0, socket: null, db, weather: false });
  try {
    assert.deepEqual(server.store.listAgents().map((a) => [a.path, a.harness, a.office]), [[dir, 'codex', 'contenido']]);
    assert.ok(server.company.list().some((o) => o.name === 'Contenido'));
  } finally { await server.close(); }
});

test('por stdio: `dev-team-office mcp` habla JSON-RPC línea a línea y sólo protocolo por stdout', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const home = tmp('dto-mcp-home-');
  const dir = project('api');
  const child = spawn(process.execPath, [BIN, 'mcp', '--no-socket'], {
    cwd: dir, env: { ...process.env, HOME: home, DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_DB: path.join(home, 'office.db') }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const replies = () => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const until = async (n) => { for (let i = 0; i < 200 && replies().length < n; i++) await new Promise((r) => setTimeout(r, 25)); return replies(); };
  try {
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opencode', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'register_project', arguments: {} } });
    child.stdin.write('esto no es json\n');
    const got = await until(4);
    const byId = Object.fromEntries(got.map((m) => [m.id, m]));
    assert.equal(byId[1].result.protocolVersion, '2025-11-25');
    assert.ok(byId[2].result.tools.length >= 10);
    assert.equal(byId[3].result.isError, undefined, byId[3].result.content[0].text);
    assert.equal(byId[null].error.code, -32700);
    assert.deepEqual(server.store.listAgents().map((a) => [a.path, a.harness]), [[dir, 'opencode']]);
  } finally {
    child.stdin.end();
    await new Promise((r) => child.on('close', r));
    await server.close();
  }
});

// What the user asked for: enter an already configured folder, open the agent and add it to the
// game with one command. join_office does it all in one step; the `join` prompt is that command
// (/mcp__dev-team-office__join in Claude Code) and `dev-team-office join` the same from the terminal.
function team(name = 'tienda') {
  const dir = path.join(tmp(), name);
  const agents = path.join(dir, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(agents, 'power-sync.md'), '---\nname: power-sync\ndescription: sincroniza\nrole: backend\n---\nhola\n');
  fs.writeFileSync(path.join(agents, 'qa.md'), '---\nname: qa\ndescription: lo que sea\n---\nhola\n');
  fs.writeFileSync(path.join(agents, 'checker.md'), '---\nname: checker\ndescription: Runs the e2e tests before merging\n---\nhola\n');
  fs.writeFileSync(path.join(agents, 'helper.md'), '---\nname: helper\ndescription: misc chores\n---\nhola\n');
  return dir;
}

test('join_office: en un paso levanta la oficina, registra la raíz del repo y muestra quién hace cada subagente', async () => {
  const dir = team();
  const net = await import('node:net');
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  let server = null;
  const startOffice = async () => { server = await startServer({ port, socket: null, db: ':memory:', weather: false }); };
  const mcp = createMcp({ base: `http://127.0.0.1:${port}`, socket: null, cwd: path.join(dir, 'src'), env: { CLAUDE_CODE_SESSION_ID: 'cc-9' }, startOffice });
  try {
    const { call } = await session(mcp, 'claude-code');
    let r = await call('join_office');
    assert.equal(r.error, false, r.text);
    assert.match(r.text, new RegExp(`started at http://127\\.0\\.0\\.1:${port}`));
    assert.match(r.text, /✓ Registered: tienda — claude-code at /);
    assert.equal(r.json.project.path, dir, 'la raíz del repo, no la subcarpeta');
    const by = Object.fromEntries(r.json.team.filter((x) => x.scope === 'project').map((x) => [x.name, [x.role, x.character, x.how]]));
    assert.deepEqual(by['power-sync'], ['backend', 'Diego', 'declared']);
    assert.deepEqual(by.qa, ['qa', 'Andrés', 'name']);
    assert.deepEqual(by.checker, ['qa', 'Andrés', 'description']);
    assert.deepEqual(by.helper, [null, null, null]);
    assert.match(r.text, /checker → Andrés \(QA\) · by its description/);
    assert.match(r.text, /helper → no role: add `role:` to its file/);
    // the session that asked already knows who is who
    assert.equal(server.company.get('main').sessions.get('cc-9')?.agentRoles?.checker, 'qa');
    // again: it was already there
    r = await call('join_office');
    assert.match(r.text, /Already registered/);
    assert.equal(server.store.listAgents().length, 1);

    // a new session in that folder (without its agent saying anything) already draws each subagent as its character
    const [sub] = server.company.ingest('claude-code', { hook_event_name: 'PreToolUse', session_id: 'cc-10', cwd: path.join(dir, 'src'), tool_name: 'Task', tool_use_id: 't1', tool_input: { subagent_type: 'checker', description: 'Revisa el login' } });
    assert.equal(sub.role, 'qa');

    // the command: a prompt of the MCP server
    const list = await mcp.handle({ jsonrpc: '2.0', id: 90, method: 'prompts/list' });
    assert.deepEqual(list.result.prompts.map((p) => p.name), ['join']);
    const got = await mcp.handle({ jsonrpc: '2.0', id: 91, method: 'prompts/get', params: { name: 'join', arguments: { office: 'Pagos' } } });
    assert.match(got.result.messages[0].content.text, /join_office with office "Pagos"/);
    assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 92, method: 'prompts/get', params: { name: 'otro' } })).error.code, -32602);
  } finally {
    mcp.close();
    await server?.close();
  }
});

// What the user asked for: in any new folder and with any agent, `join` leaves the agent with a team.
// If it brings no subagents with a role, the office gives it its own, in its harness's format.
test('join_office en una carpeta sin subagentes: la oficina le da su equipo y todos lo aprenden', async () => {
  const dir = path.join(tmp(), 'nueva');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  // a session already open in that folder, before it has a team
  server.company.ingest('claude-code', { hook_event_name: 'SessionStart', session_id: 'cc-21', cwd: dir });
  const mcp = createMcp({ base: server.url, socket: null, cwd: dir, env: { CLAUDE_CODE_SESSION_ID: 'cc-20' } });
  try {
    const { call } = await session(mcp, 'claude-code');
    let r = await call('join_office');
    assert.equal(r.error, false, r.text);
    assert.match(r.text, /✓ It had no subagents with a role, so the office gave it its team \(Example Team\): 5 subagent\(s\) in \.claude\/agents\/\. Restart Claude Code to load them/);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.claude', 'agents')).sort(), ['ex-architect.md', 'ex-backend.md', 'ex-explorer.md', 'ex-frontend.md', 'ex-qa.md']);
    assert.equal(r.json.given.fresh, true);
    const by = Object.fromEntries(r.json.team.map((x) => [x.name, [x.role, x.character]]));
    assert.deepEqual(by['ex-qa'], ['qa', 'Andrés']);
    assert.deepEqual(by['ex-architect'], ['tl', 'Tomás']);
    assert.match(r.text, /ex-backend → Diego \(Backend\)\n/);
    // the session that asked and the one already open know who is who
    const sessions = server.company.get('main').sessions;
    assert.equal(sessions.get('cc-20')?.agentRoles?.['ex-qa'], 'qa');
    assert.equal(sessions.get('cc-21')?.agentRoles?.['ex-frontend'], 'frontend');
    const [sub] = server.company.ingest('claude-code', { hook_event_name: 'PreToolUse', session_id: 'cc-21', cwd: dir, tool_name: 'Task', tool_use_id: 't2', tool_input: { subagent_type: 'ex-qa', description: 'Escribe los tests' } });
    assert.equal(sub.role, 'qa');
    // the game also sees it on the registered agent
    assert.equal(server.registry.target(r.json.project.id).roles['ex-qa'], 'qa');
    // again: it already has a team, it is not installed again
    r = await call('join_office');
    assert.ok(!/gave it its team/.test(r.text), r.text);
    assert.equal(r.json.given, null);

    // a half team (only QA): the office adds the missing roles; the folder already existed,
    // so Claude Code sees them without restarting
    const half = path.join(tmp(), 'media');
    fs.mkdirSync(path.join(half, '.claude', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(half, '.git'));
    fs.writeFileSync(path.join(half, '.claude', 'agents', 'tester.md'), '---\nname: tester\nrole: qa\ndescription: tests\n---\nhola\n');
    r = await call('join_office', { path: half });
    assert.match(r.text, /✓ It had no subagent for Tech Lead, Backend, Analista de negocio, Frontend, so the office added ex-architect, ex-backend, ex-explorer, ex-frontend from its team \(Example Team\) in \.claude\/agents\/\. Claude Code loads them in a few seconds\./);
    assert.ok(!fs.existsSync(path.join(half, '.claude', 'agents', 'ex-qa.md')));
    assert.match(r.text, /tester → Andrés \(QA\)/);

    // --no-team (team: "none"): another folder stays without a team, as it was
    const bare = path.join(tmp(), 'sola');
    fs.mkdirSync(path.join(bare, '.git'), { recursive: true });
    r = await call('join_office', { path: bare, team: 'none' });
    assert.match(r.text, /No subagents found/);
    assert.ok(!fs.existsSync(path.join(bare, '.claude')));
    // a pack that does not exist is an error, not silence
    r = await call('join_office', { path: bare, team: 'no-existe' });
    assert.equal(r.error, true);
    assert.match(r.text, /could not give it the team "no-existe": unknown team/);
  } finally {
    mcp.close();
    await server.close();
  }
});

test('POST /v1/agents/:id/team: lo que usa el /office de Pi', async () => {
  const dir = path.join(tmp(), 'pi-nueva');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const post = (p, body) => fetch(server.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const { agent } = await post('/v1/agents', { path: dir, harness: 'pi' });
    let out = await post(`/v1/agents/${agent.id}/team`, {});
    assert.equal(out.installed, true, JSON.stringify(out));
    assert.equal(out.dir, path.join(dir, '.pi', 'agents'));
    assert.equal(out.agent.roles['ex-architect'], 'tl');
    out = await post(`/v1/agents/${agent.id}/team`, {});
    assert.deepEqual([out.installed, out.reason], [false, 'has-team']);
    assert.equal((await fetch(`${server.url}/v1/agents/nadie/team`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  } finally {
    await server.close();
  }
});

// OpenCode, when it closes, kills the whole process tree of its MCP server: the office that
// join_office started cannot be part of that tree (otherwise it dies with the agent).
test('startOfficeDetached: la oficina queda huérfana, no como hija de quien la lanzó', async () => {
  const home = tmp('dto-detached-');
  const net = await import('node:net');
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const { startOfficeDetached } = await import('../server/mcp.js');
  const { execFileSync } = await import('node:child_process');
  startOfficeDetached({ port, log: path.join(home, 'office.log'), env: { ...process.env, HOME: home, DEV_TEAM_OFFICE_WEATHER: 'off', DEV_TEAM_OFFICE_DB: path.join(home, 'office.db') } });
  let h = null;
  for (let i = 0; i < 80 && !h; i++) { await new Promise((r) => setTimeout(r, 100)); h = await fetch(`http://127.0.0.1:${port}/v1/health`).then((r) => r.json()).catch(() => null); }
  try {
    assert.equal(h?.name, 'dev-team-office', fs.existsSync(path.join(home, 'office.log')) ? fs.readFileSync(path.join(home, 'office.log'), 'utf8') : 'sin bitácora');
    const ppid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(h.pid)], { encoding: 'utf8' }).trim());
    assert.notEqual(ppid, process.pid, 'la oficina es hija del proceso que la lanzó');
  } finally {
    if (h?.pid) try { process.kill(h.pid); } catch { /* already finished */ }
  }
});

test('`dev-team-office join` desde la terminal: lo mismo que join_office', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const home = tmp('dto-join-home-');
  const dir = team('api');
  try {
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, 'join', '--agent', 'pi', '--office', 'Pagos', '--port', String(new URL(server.url).port), '--no-socket'], { cwd: path.join(dir, 'src'), env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      child.on('close', (code) => resolve({ code, text }));
    });
    assert.equal(out.code, 0, out.text);
    assert.match(out.text, /✓ Registered: api — pi at/);
    assert.match(out.text, /power-sync → Diego \(Backend\)/);
    // the subagents it brings are Claude Code's: Pi gets the office team in .pi/agents
    assert.match(out.text, /gave it its team \(Example Team\): 5 subagent\(s\) in \.pi\/agents\/\. Pi uses them from the next subagent call/);
    assert.equal(fs.readdirSync(path.join(dir, '.pi', 'agents')).length, 5);
    assert.ok(!out.text.includes('"team"'), 'sin el JSON de la herramienta');
    assert.deepEqual(server.store.listAgents().map((a) => [a.path, a.harness, a.office]), [[dir, 'pi', 'pagos']]);
  } finally {
    await server.close();
  }
});
