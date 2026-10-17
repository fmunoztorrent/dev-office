// La extensión de Pi y el plugin de OpenCode, de verdad, contra un Pi y un OpenCode de mentira
// (sus APIs imitadas): se conectan a la oficina, anuncian su proyecto y ejecutan el pipeline en
// su propia sesión, cambiando de modelo por etapa.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  // un agente de Pi que DECLARA su rol: el mecanismo es genérico (ningún nombre está cableado)
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
  process.stdin.isTTY = true; // la extensión sólo se conecta en sesiones interactivas
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
  // Pi de mentira: cada mensaje es un turno que lee un archivo y responde
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
      assert.match(sent[1].text, /respuesta 1/); // el resumen de RED llega a la implementación
      // QA con haiku; backend sin modelo propio: el de la sesión; al final, el de la sesión
      assert.deepEqual(models.map((m) => m.id), ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
      const s = server.office.sessionSummary('pi-int');
      assert.deepEqual(s.flow.map((f) => `${f.role}:${f.phase}`), ['qa:red', 'backend:implementa', 'qa:green']);
      assert.equal(s.title, 'TDD: Cupones'); // los prompts de etapa no se cuentan como tareas nuevas
      await until(() => server.office.sessionSummary('pi-int').status === 'done');

      // una tarea directa llega como mensaje del usuario
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

test('extensión de Pi: al registrarse le enseña a la oficina qué subagente suyo es qué personaje', { skip: !process.features?.typescript && 'Node sin soporte de TypeScript' }, async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cwd = process.cwd();
  const isTTY = process.stdin.isTTY;
  process.chdir(dir);
  process.stdin.isTTY = true; // la extensión sólo se conecta en sesiones interactivas
  const handlers = {};
  const ctx = { isIdle: () => true, modelRegistry: { find: () => undefined } };
  const fire = async (name, ev = {}) => { for (const h of handlers[name] || []) await h(ev, ctx); };
  const pi = { on: (name, h) => { (handlers[name] ||= []).push(h); }, setModel: async () => true, setThinkingLevel: () => {}, sendUserMessage: () => {} };
  try {
    await withEnv({ DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_LIB: path.join(ROOT, 'integrations', 'common', 'devteam.mjs'), DEV_TEAM_OFFICE_SESSION: 'pi-roles' }, async () => {
      // módulo fresco (query): la extensión fija su URL de la oficina al importarse
      const mod = await import(pathToFileURL(path.join(ROOT, 'integrations', 'pi', 'dev-team-office.ts')).href + '?roles');
      mod.default(pi);
      await fire('session_start');
      // el agente declara `role: backend` en su frontmatter: la oficina lo aprende al registrarse,
      // sin esperar a que le manden una tarea (así un subagente local cae en el personaje correcto)
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
      // mientras corre el pipeline, el fin de cada turno no es "listo"
      await hooks['chat.message']({ sessionID: 'ses_1' }, { parts: [{ type: 'text', text: prompts[0].body.parts[0].text }] });
      assert.equal(server.office.sessionSummary('ses_1').title, 'TDD: Cupones');

      // un comando de su harness (el /task de Errementari) se ejecuta como comando de OpenCode
      await call(server.url, 'POST', '/v1/tasks', { agent: 'opencode', session: 'ses_1', text: '/task bug: x', command: 'task', args: 'bug: x' });
      await until(() => commands.length);
      assert.deepEqual(commands[0], { id: 'ses_1', body: { command: 'task', arguments: 'bug: x' } });
    });
  } finally {
    await server.close();
  }
});
