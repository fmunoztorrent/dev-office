// The Pi extension and the OpenCode plugin, for real, against a fake Pi and a fake OpenCode
// (their APIs mimicked): they connect to the office, announce their project and run the pipeline
// in their own session, switching model per stage.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-int-'));
  fs.mkdirSync(path.join(dir, '.devteam', 'pipelines'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devteam', 'team.json'), JSON.stringify({ name: 'Integrado', roles: { qa: { model: 'anthropic/claude-haiku-5-5' } } }));
  // a Pi agent that DECLARES its role: the mechanism is generic (no name is hard-wired)
  fs.mkdirSync(path.join(dir, '.pi', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pi', 'agents', 'custom-agent.md'), '---\nname: custom-agent\nrole: backend\n---\n\nEscribe el código.\n');
  fs.writeFileSync(path.join(dir, '.devteam', 'pipelines', 'tdd.json'), JSON.stringify({
    name: 'TDD', stages: [
      { id: 'red', role: 'qa', phase: 'red', check: { run: 'false', expect: 'fail' } },
      { id: 'impl', role: 'backend', needs: ['red'] },
      { id: 'green', role: 'qa', phase: 'green', needs: ['impl'], check: { run: 'true' } },
    ],
  }));
  return dir;
}

async function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('extensión de Pi: corre el pipeline en su sesión, con setModel por etapa, y vuelve a su modelo', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  process.chdir(dir);
  process.stdin.isTTY = true; // the extension only connects in interactive sessions
  const handlers = {};
  const sent = [], models = [];
  let idle = true;
  const original = { provider: 'anthropic', id: 'claude-opus-5-5' };
  const ctx = {
    get model() { return models.at(-1) || original; },
    isIdle: () => idle,
    modelRegistry: { find: (provider, id) => ({ provider, id }) },
  };
  const fire = async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); };
  // fake Pi: each message is a turn that reads a file and answers
  const pi = {
    on: (name, h) => { (handlers[name] ||= []).push(h); },
    setModel: async (m) => { models.push(m); return true; },
    setThinkingLevel: () => {},
    sendUserMessage: (text, opts) => {
      sent.push({ text, opts });
      setTimeout(async () => {
        idle = false;
        await fire('before_agent_start', { messageType: 'user', prompt: text });
        await fire('tool_call', { toolName: 'read', toolCallId: `t${sent.length}`, input: { path: 'README.md' } });
        await fire('tool_result', { toolName: 'read', toolCallId: `t${sent.length}`, input: { path: 'README.md' }, isError: false });
        await fire('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: `respuesta ${sent.length}` }] } });
        await fire('agent_end', {});
        idle = true;
        await fire('agent_settled', { aborted: false });
      }, 10);
    },
  };
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-int' }, async () => {
      const mod = await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href);
      mod.default(pi);
      await fire('session_start');
      const project = await until(() => server.pipelines.projects().find((p) => p.name === 'Integrado'));
      assert.deepEqual(project.pipelines[0].hosts, [{ agent: 'pi', session: 'pi-int', live: true }]);
      assert.deepEqual(server.hub.snapshot().agents[0].can, ['task', 'pipeline']);

      const { run } = await call(server.url, 'POST', '/v1/pipelines', { pipeline: 'tdd', task: 'Cupones' });
      const done = await until(() => server.pipelines.snapshot().runs.find((r) => r.id === run.id && r.status === 'done'));
      assert.deepEqual(done.stages.map((s) => s.status), ['done', 'done', 'done']);
      assert.equal(sent.length, 3);
      assert.match(sent[0].text, /^\[Dev Team Office · etapa 1\/3\]/);
      assert.match(sent[1].text, /respuesta 1/); // the RED summary reaches the implementation
      // QA with haiku; backend without its own model: the session's; at the end, the session's
      assert.deepEqual(models.map((m) => m.id), ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
      const s = server.office.sessionSummary('pi-int');
      assert.deepEqual(s.flow.map((f) => `${f.role}:${f.phase}`), ['qa:red', 'backend:implementa', 'qa:green']);
      assert.equal(s.title, 'TDD: Cupones'); // stage prompts do not count as new tasks
      await until(() => server.office.sessionSummary('pi-int').status === 'done');

      // a direct task arrives as a user message
      await call(server.url, 'POST', '/v1/tasks', { agent: 'pi', text: 'Sube la cobertura' });
      await until(() => sent.some((m) => m.text === 'Sube la cobertura'));
      await fire('session_shutdown');
    });
  } finally {
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
    await server.close();
  }
});

// Documented skip (the behavior does not change): skips the extension's end-to-end path
// —`register → reportAgentRoles → agent_roles`— because it imports the `.ts` extension and needs
// Node's TypeScript support. It is acceptable because `process.features.typescript` is always truthy
// on the declared engine (package.json `engines.node: >=22.13`): in a supported environment the test runs.
// If it were skipped anyway, the underlying contract is still covered: `detectHarness`'s roles and
// `roleIssues` are tested in test/devteam.test.js, and the `agent_roles` ingestion in test/office.test.js.
test('extensión de Pi: al registrarse le enseña a la oficina qué subagente suyo es qué personaje', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  process.chdir(dir);
  process.stdin.isTTY = true; // the extension only connects in interactive sessions
  const handlers = {};
  const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined } };
  const fire = async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); };
  const pi = { on: (name, h) => { (handlers[name] ||= []).push(h); }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} };
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-roles' }, async () => {
      // fresh module (query): the extension fixes its office URL on import
      const mod = await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?roles');
      mod.default(pi);
      await fire('session_start');
      // the agent declares `role: backend` in its frontmatter: the office learns it on registration,
      // without waiting for a task (so a local subagent lands on the right character)
      await until(() => server.office.sessionSummary('pi-roles')?.agentRoles?.['custom-agent'] === 'backend');
      assert.equal(server.office.sessionSummary('pi-roles').agentRoles['custom-agent'], 'backend');
      await fire('session_shutdown');
    });
  } finally {
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
    await server.close();
  }
});

test('extensión de Pi: sin agentes en el proyecto igual reporta un mapa de roles vacío, sin avisar', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  // project without agents: the empty map is data (I learned nothing), not an error
  fs.rmSync(path.join(dir, '.pi', 'agents'), { recursive: true, force: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-home-')); // isolates the real user's agents
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  process.chdir(dir);
  process.stdin.isTTY = true;
  const handlers = {};
  const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined } };
  const fire = async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); };
  const pi = { on: (name, h) => { (handlers[name] ||= []).push(h); }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} };
  // the extension's complaint goes out through console.warn: it is captured to assert there was NONE
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-empty', HOME: home }, async () => {
      const mod = await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?empty');
      mod.default(pi);
      await fire('session_start');
      // the event arrives anyway: the session ends up with an EMPTY map (not undefined), a sign it was reported
      await until(() => {
        const s = server.office.sessionSummary('pi-empty');
        return s?.agentRoles && Object.keys(s.agentRoles).length === 0 ? s : null;
      });
      assert.deepEqual(server.office.sessionSummary('pi-empty').agentRoles, {});
      assert.deepEqual(warns.filter((w) => w.includes('[dev-team-office]')), []);
      await fire('session_shutdown');
    });
  } finally {
    console.warn = realWarn;
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
    await server.close();
  }
});

test('extensión de Pi: un rol declarado que no se puede normalizar avisa y queda fuera del mapa', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  // `bakend` is not a valid role: it is not guessed by name or by tables, and the operator has to see it
  fs.writeFileSync(path.join(dir, '.pi', 'agents', 'power-sync.md'), '---\nname: power-sync\nrole: bakend\n---\n\nSincroniza.\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-home-')); // isolates the real user's agents
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  process.chdir(dir);
  process.stdin.isTTY = true;
  const handlers = {};
  const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined } };
  const fire = async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); };
  const pi = { on: (name, h) => { (handlers[name] ||= []).push(h); }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} };
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-sync', HOME: home }, async () => {
      const mod = await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?sync');
      mod.default(pi);
      await fire('session_start');
      // the project's well-declared agent does arrive: that tells us the report already happened
      const s = await until(() => (server.office.sessionSummary('pi-sync')?.agentRoles?.['custom-agent'] === 'backend' ? server.office.sessionSummary('pi-sync') : null));
      assert.equal(s.agentRoles['power-sync'], undefined); // the broken one does not get into the map
      const issue = await until(() => warns.find((w) => w.includes('bakend')));
      assert.match(issue, /^\[dev-team-office\] /);
      assert.match(issue, /rol desconocido/);
      assert.match(issue, /power-sync/);
      await fire('session_shutdown');
    });
  } finally {
    console.warn = realWarn;
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
    await server.close();
  }
});

// What happens with gentle-pi for real: a `pi -p` (no terminal) delegates to a subagent, which is another
// `pi` with the same environment and the same extension. The parent reports the roles even without a
// WebSocket; the child sees the session already has an owner and reports to the parent's, as the subagent's character.
test('extensión de Pi: un subagente que es otro pi reporta a la sesión del padre, en su personaje', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  const saved = { owner: process.env.DEV_TEAM_OFFICE_PI_PID };
  process.chdir(dir);
  process.stdin.isTTY = false; // like `pi -p`: no WebSocket
  const fake = () => {
    const handlers = {};
    const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined } };
    return {
      fire: async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); },
      pi: { on: (name, h) => { (handlers[name] ||= []).push(h); }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} },
    };
  };
  const ext = pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href;
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-padre' }, async () => {
      delete process.env.DEV_TEAM_OFFICE_PI_PID;
      const parent = fake();
      (await import(`${ext}?padre`)).default(parent.pi);
      assert.equal(process.env.DEV_TEAM_OFFICE_PI_PID, String(process.pid), 'el padre marca la sesión como suya');
      await parent.fire('session_start');
      // even without a terminal it teaches the office each subagent's role, before delegating
      await until(() => server.office.sessionSummary('pi-padre')?.agentRoles?.['custom-agent'] === 'backend');
      await parent.fire('before_agent_start', { messageType: 'user', prompt: 'Agrega cupones' });
      await parent.fire('tool_call', { toolName: 'subagent_run', toolCallId: 'c1', input: { agent: 'custom-agent', task: 'Escribe el endpoint de cupones' } });

      // the child inherits the environment; for the test, the session's owner is "another process"
      process.env.DEV_TEAM_OFFICE_PI_PID = '1';
      const child = fake();
      (await import(`${ext}?hijo`)).default(child.pi);
      await child.fire('session_start');
      await child.fire('before_agent_start', { messageType: 'user', prompt: 'Escribe el endpoint de cupones' });
      await child.fire('tool_call', { toolName: 'read', toolCallId: 'r1', input: { path: 'docs/cupones.md' } });
      await child.fire('tool_result', { toolName: 'read', toolCallId: 'r1', input: { path: 'docs/cupones.md' }, isError: false, content: [{ type: 'text', text: '# Cupones\nUn cupón por pedido.' }] });
      await child.fire('tool_call', { toolName: 'bash', toolCallId: 'b1', input: { command: 'npm test' } });
      await child.fire('tool_result', { toolName: 'bash', toolCallId: 'b1', input: { command: 'npm test' }, isError: true, content: [{ type: 'text', text: 'ℹ pass 3\nℹ fail 1' }] });
      await child.fire('agent_end');
      await child.fire('session_shutdown');
      const read = await until(() => server.office.log.find((e) => e.kind === 'tool_end' && e.tool === 'read'));
      assert.equal(read.session, 'pi-padre');
      assert.equal(read.role, 'backend', 'leer docs/ lo haría Analista: en el subagente lo hace su personaje');
      // the subagent's activity carries its id and what it returned (inside herdr, its pane shows it)
      assert.equal(read.subId, 'c1');
      assert.equal(read.output, undefined, 'lo que leyó no viaja: sólo la salida de sus comandos');
      const ran = await until(() => server.office.log.find((e) => e.kind === 'tool_end' && e.tool === 'bash'));
      assert.deepEqual([ran.subId, ran.ok, ran.output], ['c1', false, 'ℹ pass 3\nℹ fail 1']);

      await parent.fire('tool_result', { toolName: 'subagent_run', toolCallId: 'c1', input: { agent: 'custom-agent' }, isError: false, content: [{ type: 'text', text: 'Endpoint listo: POST /coupons.' }] });
      const end = await until(() => server.office.log.find((e) => e.kind === 'subagent_end'));
      assert.equal(end.output, 'Endpoint listo: POST /coupons.', 'el informe del subagente');
      // gentle-pi's `todo` list reaches the board from its result
      await parent.fire('tool_result', { toolName: 'todo', toolCallId: 'td', input: { action: 'update', id: 1, status: 'done' }, isError: false, details: { gentleTodo: { tasks: [{ id: 1, title: 'Endpoint', status: 'done' }, { id: 2, title: 'Docs', status: 'pending' }] } } });
      const s = await until(() => { const x = server.office.sessionSummary('pi-padre'); return x.todos.length === 2 && x; });
      assert.deepEqual(s.todos.map((t) => t.status), ['completed', 'pending']);
      assert.equal(s.title, 'Agrega cupones', 'la tarea del subagente no reemplaza la de la sesión');
      assert.notEqual(s.status, 'ended', 'que el subagente termine no cierra la sesión');
      assert.deepEqual(s.subagents.map((x) => [x.role, x.child, x.open]), [['backend', String(process.pid), false]]);
      await parent.fire('session_shutdown');
    });
  } finally {
    if (saved.owner === undefined) delete process.env.DEV_TEAM_OFFICE_PI_PID; else process.env.DEV_TEAM_OFFICE_PI_PID = saved.owner;
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
    await server.close();
  }
});

// Pi launches the office: you open `pi` in your project and, if the office is not running, the extension
// starts it (with the launcher `setup` left), registers the project by its git root and connects.
const freePort = () => new Promise((resolve) => { const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });
function fakePi() {
  const handlers = {}, commands = {}, notes = [], status = {};
  const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined }, ui: { notify: (m, type) => notes.push({ m, type }), setStatus: (k, v) => { status[k] = v; } } };
  return {
    handlers, commands, notes, status, ctx,
    fire: async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); },
    pi: { on: (name, h) => { (handlers[name] ||= []).push(h); }, registerCommand: (name, spec) => { commands[name] = spec; }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} },
  };
}
function shimIn(home, script) {
  const bin = path.join(home, '.dev-team-office', 'bin', 'dev-team-office');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return bin;
}

test('extensión de Pi: Pi lanza la oficina, registra su proyecto y se conecta', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-pihome-'));
  shimIn(home, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'bin', 'dev-team-office.js')}" "$@"\n`);
  const project = tempProject();
  fs.mkdirSync(path.join(project, '.git'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  delete process.env.DEV_TEAM_OFFICE_PI_PID;
  process.chdir(project);
  process.stdin.isTTY = true;
  const p = fakePi();
  let pid = null;
  try {
    await withEnv({ HOME: home, DEV_TEAM_OFFICE_URL: base, DEV_TEAM_OFFICE_SOCKET: path.join(os.tmpdir(), `dto-pi-${process.pid}.sock`), DEV_TEAM_OFFICE_WEATHER: 'off', DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-lanza' }, async () => {
      (await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?lanza')).default(p.pi);
      assert.ok(p.commands.office, 'la extensión trae el comando /office');
      await p.fire('session_start');
      const note = await until(() => p.notes.find((n) => /started/.test(n.m)), 20000);
      pid = (await (await fetch(`${base}/v1/health`)).json()).pid;
      // it registered the project with Pi, and the live session ended up on that agent
      const { agents } = await (await fetch(`${base}/v1/agents`)).json();
      const agent = agents.find((a) => a.registered && a.harness === 'pi');
      assert.equal(fs.realpathSync(agent.path), fs.realpathSync(project));
      assert.equal(note.m, `Dev Team Office started at ${base} · ${agent.name} registered (office main)`);
      await until(async () => (await (await fetch(`${base}/v1/agents/${agent.id}`)).json()).agent.sessions.some((s) => s.session === 'pi-lanza' && s.live), 8000);
      // and it taught it which subagent is which character
      await until(async () => (await (await fetch(`${base}/v1/state`)).json()).sessions.find((s) => s.id === 'pi-lanza')?.agentRoles?.['custom-agent'] === 'backend', 8000);
      // /office: it is already up and registered, it only says where to watch it
      await until(() => p.status['dev-team-office']?.includes(`127.0.0.1:${port}`));
      await p.commands.office.handler('', p.ctx);
      // /office also says which character plays each of the project's subagents and, since the team only
      // has a backend, the office adds the missing roles in .pi/agents (and the session learns it)
      assert.equal(p.notes.at(-1).m, `Dev Team Office: ${base} · ${agent.name} (office main)\nyour team had no tl, analyst, frontend, qa, so the office added ex-architect (tl), ex-explorer (analyst), ex-frontend (frontend), ex-qa (qa) to .pi/agents, ready for the next subagent call\nteam: custom-agent → backend · ex-architect → tl · ex-explorer → analyst · ex-frontend → frontend · ex-qa → qa`);
      assert.deepEqual(fs.readdirSync(path.join(project, '.pi', 'agents')).sort(), ['custom-agent.md', 'ex-architect.md', 'ex-explorer.md', 'ex-frontend.md', 'ex-qa.md']);
      await until(async () => (await (await fetch(`${base}/v1/state`)).json()).sessions.find((s) => s.id === 'pi-lanza')?.agentRoles?.['ex-qa'] === 'qa', 8000);
      assert.equal((await (await fetch(`${base}/v1/agents`)).json()).agents.filter((a) => a.registered).length, 1, 'no se registra dos veces');
      // again: with every role covered, it adds nothing
      await p.commands.office.handler('', p.ctx);
      assert.ok(!/the office added|gave you/.test(p.notes.at(-1).m), p.notes.at(-1).m);
    });
  } finally {
    await p.fire('session_shutdown'); // closes its WebSocket even if the test fails
    if (!pid) pid = (await fetch(`${base}/v1/health`).then((r) => r.json()).catch(() => null))?.pid;
    if (pid) { try { process.kill(pid); } catch { /* already finished */ } }
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
  }
});

test('extensión de Pi: con DEV_TEAM_OFFICE_AUTOSTART=0 no levanta la oficina sola', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-pihome-'));
  const marker = path.join(home, 'lanzado');
  shimIn(home, `#!/bin/sh\ntouch "${marker}"\n`);
  const project = tempProject();
  fs.mkdirSync(path.join(project, '.git'));
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  delete process.env.DEV_TEAM_OFFICE_PI_PID;
  process.chdir(project);
  process.stdin.isTTY = true;
  const p = fakePi();
  try {
    await withEnv({ HOME: home, DEV_TEAM_OFFICE_URL: `http://127.0.0.1:${await freePort()}`, DEV_TEAM_OFFICE_AUTOSTART: '0', DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-quieto' }, async () => {
      (await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?quieto')).default(p.pi);
      await p.fire('session_start');
      await sleep(600);
      assert.equal(fs.existsSync(marker), false, 'no corrió el lanzador');
      assert.deepEqual(p.notes, []);
      await p.fire('session_shutdown');
    });
  } finally {
    process.chdir(cwd);
    process.stdin.isTTY = isTTY;
  }
});

test('plugin de OpenCode: corre el pipeline en su sesión con el modelo de cada etapa', async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const prompts = [];
  const commands = [];
  let n = 0;
  const client = {
    session: {
      create: async () => ({ data: { id: 'ses_nueva' } }),
      command: async ({ path: p, body }) => { commands.push({ id: p.id, body }); return { data: { info: {}, parts: [] } }; },
      prompt: async ({ path: p, body }) => {
        prompts.push({ id: p.id, body });
        return { data: { info: { role: 'assistant' }, parts: [{ type: 'text', text: `hecho ${++n}` }] } };
      },
      abort: async () => ({ data: true }),
    },
    config: { providers: async () => ({ data: { providers: [{ id: 'anthropic', models: { 'claude-haiku-5-5': {} } }] } }) },
    tui: { showToast: async () => {}, appendPrompt: async () => {}, submitPrompt: async () => {} },
  };
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs') }, async () => {
      const { DevTeamOffice } = await import(pathToFileURL(path.join(ROOT, 'integrations', 'opencode', 'dev-team-office.js')).href);
      const hooks = await DevTeamOffice({ client, directory: dir });
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_1' } } } });
      const project = await until(() => server.pipelines.projects().find((p) => p.name === 'Integrado' && p.pipelines[0]?.hosts.some((h) => h.session === 'ses_1')));
      assert.equal(project.pipelines[0].hosts[0].agent, 'opencode');

      const { run } = await call(server.url, 'POST', '/v1/pipelines', { session: 'ses_1', pipeline: 'tdd', task: 'Cupones' });
      const done = await until(() => server.pipelines.snapshot().runs.find((r) => r.id === run.id && ['done', 'failed'].includes(r.status)));
      assert.equal(done.status, 'done', done.detail);
      assert.deepEqual(prompts.map((p) => p.id), ['ses_1', 'ses_1', 'ses_1']);
      assert.deepEqual(prompts.map((p) => p.body.model), [{ providerID: 'anthropic', modelID: 'claude-haiku-5-5' }, undefined, { providerID: 'anthropic', modelID: 'claude-haiku-5-5' }]);
      assert.match(prompts[1].body.parts[0].text, /hecho 1/);
      // while the pipeline runs, the end of each turn is not "done"
      await hooks['chat.message']({ sessionID: 'ses_1' }, { parts: [{ type: 'text', text: prompts[0].body.parts[0].text }] });
      assert.equal(server.office.sessionSummary('ses_1').title, 'TDD: Cupones');

      // a command of its harness (Errementari's /task) runs as an OpenCode command
      await call(server.url, 'POST', '/v1/tasks', { agent: 'opencode', session: 'ses_1', text: '/task bug: x', command: 'task', args: 'bug: x' });
      await until(() => commands.length);
      assert.deepEqual(commands[0], { id: 'ses_1', body: { command: 'task', arguments: 'bug: x' } });

      // a subagent (the `task` tool) runs in a child session: its activity goes to the parent's session,
      // as the subagent's character, and the child does not show up as another session
      await hooks['tool.execute.before']({ sessionID: 'ses_1', tool: 'task', callID: 'c1' }, { args: { description: 'Corre los tests', prompt: 'Corre npm test e informa el resultado', subagent_type: 'ex-qa' } });
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_hija', parentID: 'ses_1' } } } });
      await hooks['chat.message']({ sessionID: 'ses_hija' }, { parts: [{ type: 'text', text: 'Corre npm test e informa el resultado' }] });
      await hooks['tool.execute.before']({ sessionID: 'ses_hija', tool: 'bash', callID: 'c2' }, { args: { command: 'npm test' } });
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_hija' } } });
      const sub = await until(() => server.office.sessionSummary('ses_1')?.subagents?.find((x) => x.agentType === 'ex-qa' && x.child === 'ses_hija'));
      assert.equal(sub.role, 'qa');
      const bash = await until(() => server.office.log.find((e) => e.tool === 'bash' && e.subId === sub.id));
      assert.equal(bash.role, 'qa');
      assert.equal(server.office.sessionSummary('ses_hija'), null, 'la sesión hija no es otra sesión del equipo');
      assert.ok(!server.office.log.some((e) => e.session === 'ses_1' && e.kind === 'turn_end' && e.ts >= bash.ts), 'el fin de turno de la hija no es del padre');
    });
  } finally {
    await server.close();
  }
});
