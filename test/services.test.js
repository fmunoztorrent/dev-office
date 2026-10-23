// The services an agent leaves running in the background (server/services.js): which commands
// start one, where their log is, whether they are still running and what they print.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceOf, backgrounded, logFileOf, claudeTaskOutput, nameOf, ServiceHub } from '../server/services.js';
import { startServer } from '../server/server.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-services-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('qué comando deja un servicio corriendo y dónde queda su log', () => {
  assert.ok(backgrounded('npm run dev > dev.log 2>&1 &'));
  assert.ok(backgrounded('nohup python -m http.server 8000 > http.log 2>&1 &'));
  assert.ok(!backgrounded('npm test && npm run build'), '&& no es segundo plano');
  assert.ok(!backgrounded('npm run dev'));
  assert.equal(logFileOf('npm run dev > dev.log 2>&1 &', '/p'), '/p/dev.log');
  assert.equal(logFileOf('cd web && npm start >> /tmp/web.log 2>&1 &', '/p'), '/tmp/web.log');
  assert.equal(logFileOf('vite &> "logs/vite out.log" &', '/p'), '/p/logs/vite out.log');
  assert.equal(logFileOf('npm run dev > /dev/null 2>&1 &', '/p'), null);
  assert.equal(logFileOf('npm run dev 2>&1 &', '/p'), null);
  assert.equal(nameOf('cd web && PORT=3000 npm run dev > dev.log 2>&1 &'), 'npm run dev');
});

test('los eventos que levantan o detienen un servicio', () => {
  const bash = (command, extra = {}) => ({ kind: 'tool_end', tool: 'Bash', ok: true, cwd: '/p', input: { command }, ...extra });
  // Claude Code: run_in_background
  assert.deepEqual(serviceOf(bash('npm run dev', { backgroundTaskId: 'b1' })).start, { key: 'b1', command: 'npm run dev', cwd: '/p', taskId: 'b1' });
  // any agent: to the background with its output in a file
  assert.equal(serviceOf(bash('npm run dev > dev.log 2>&1 &')).start.log, '/p/dev.log');
  assert.equal(serviceOf(bash('npm run dev &')), null, 'sin log no hay qué mostrar');
  assert.equal(serviceOf(bash('npm run dev > dev.log 2>&1 &', { ok: false })), null, 'si falló, no quedó corriendo');
  assert.equal(serviceOf({ ...bash('npm run dev > dev.log &'), kind: 'tool_start' }), null, 'cuenta cuando ya se lanzó');
  // stopped by the agent, or reported as is by an integration
  assert.deepEqual(serviceOf({ kind: 'tool_start', tool: 'KillShell', input: { shell_id: 'b1' } }), { stop: 'b1' });
  assert.deepEqual(serviceOf({ kind: 'tool_start', tool: 'TaskStop', input: { task_id: 'b1' } }), { stop: 'b1' });
  assert.equal(serviceOf({ kind: 'service_start', id: 'w', command: 'cargo watch', log: '/p/w.log' }).start.log, '/p/w.log');
});

test('el log de una tarea de Claude Code en segundo plano', () => {
  const root = tmp();
  const dir = path.join(root, '-Users-yo-proyecto', 'sesion-1', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b1.output'), 'listo\n');
  assert.equal(claudeTaskOutput('b1', 'sesion-1', { roots: [root] }), path.join(dir, 'b1.output'));
  assert.equal(claudeTaskOutput('b1', null, { roots: [root] }), path.join(dir, 'b1.output'), 'sin sesión, en cualquiera');
  assert.equal(claudeTaskOutput('b2', 'sesion-1', { roots: [root] }), null);
  assert.equal(claudeTaskOutput('../x', 'sesion-1', { roots: [root] }), null);
});

test('sigue corriendo mientras alguien tiene su log abierto; después queda como terminado', async () => {
  const dir = tmp();
  const log = path.join(dir, 'dev.log');
  fs.writeFileSync(log, 'arrancando\n');
  let open = new Map([[log, [4242]]]);
  let clock = 1000;
  const hub = new ServiceHub({ holders: async () => open, now: () => clock, grace: 5000 });
  const seen = [];
  hub.on('up', (s) => seen.push(`up ${s.name}`));
  hub.on('down', (s) => seen.push(`down ${s.name}`));
  const s = hub.observe('main', { kind: 'tool_end', tool: 'Bash', ok: true, cwd: dir, session: 's1', input: { command: 'npm run dev > dev.log 2>&1 &' } }, { role: 'backend', session: 's1' });
  assert.equal(s.status, 'running');
  await hub.check();
  assert.deepEqual(hub.list('main').map((x) => [x.name, x.status, x.pids]), [['npm run dev', 'running', [4242]]]);
  // the same command again: the same service, not another one
  hub.observe('main', { kind: 'tool_end', tool: 'Bash', ok: true, cwd: dir, session: 's1', input: { command: 'npm run dev > dev.log 2>&1 &' } }, {});
  assert.equal(hub.list('main').length, 1);
  open = new Map();
  clock += 6000; // restarted: it gets its grace again
  await hub.check();
  assert.equal(hub.list('main')[0].status, 'ended');
  assert.deepEqual(seen, ['up npm run dev', 'up npm run dev', 'down npm run dev']);
  assert.deepEqual(hub.list('otra'), [], 'cada oficina ve los suyos');
});

test('sin lsof no se puede saber: sigue corriendo hasta que el agente lo detiene', async () => {
  const hub = new ServiceHub({ holders: async () => null, now: () => 99_999_999 });
  const s = hub.observe('main', { kind: 'service_start', id: 'w', command: 'cargo watch', log: '/no/existe.log' }, {});
  await hub.check();
  assert.equal(hub.get(s.id).status, 'running');
  hub.observe('main', { kind: 'service_stop', id: 'w' }, {});
  assert.equal(hub.get(s.id).status, 'ended');
});

test('lo que imprime: el final, y después sólo lo nuevo', () => {
  const dir = tmp();
  const log = path.join(dir, 'dev.log');
  fs.writeFileSync(log, 'uno\ndos\n\x1b[32mtres\x1b[0m\n');
  const hub = new ServiceHub({ holders: async () => new Map() });
  const s = hub.observe('main', { kind: 'service_start', id: 'x', command: 'dev', log }, {});
  let r = hub.read(s.id);
  assert.equal(r.text, 'uno\ndos\ntres\n', 'sin los colores de la terminal');
  fs.appendFileSync(log, 'cuatro\n');
  r = hub.read(s.id, { from: r.offset });
  assert.equal(r.text, 'cuatro\n');
  fs.writeFileSync(log, 'de nuevo\n');
  r = hub.read(s.id, { from: r.offset });
  assert.deepEqual([r.text, r.reset], ['de nuevo\n', true], 'si el archivo se achicó, empieza de nuevo');
  assert.equal(hub.read('nada'), null);
});

test('el servidor: el hook de Claude Code levanta el servicio, la bitácora lo cuenta y se leen sus logs', async () => {
  const root = tmp();
  const dir = path.join(root, '-proyecto', 'sesion-bg', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'bk1.output');
  fs.writeFileSync(out, 'VITE ready in 300 ms\n  ➜  Local: http://localhost:5173/\n');
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, services: { roots: [root], holders: async () => new Map([[out, [7]]]) } });
  const post = (p, body) => fetch(server.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const get = (p) => fetch(server.url + p).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    await post('/v1/hooks/claude-code', {
      hook_event_name: 'PostToolUse', session_id: 'sesion-bg', cwd: '/proyecto', tool_name: 'Bash', tool_use_id: 't1',
      tool_input: { command: 'npm run dev', run_in_background: true }, tool_response: { stdout: '', stderr: '', backgroundTaskId: 'bk1' },
    });
    const list = await get('/v1/services');
    assert.deepEqual(list.services.map((s) => [s.name, s.status, s.log, s.session]), [['npm run dev', 'running', out, 'sesion-bg']]);
    const id = list.services[0].id;
    const log = await get(`/v1/services/${id}/log`);
    assert.match(log.text, /Local: http:\/\/localhost:5173/);
    assert.equal((await get(`/v1/services/${id}/log?from=${log.offset}`)).text, '');
    const state = await get('/v1/state');
    assert.equal(state.services.length, 1, 'en el snapshot');
    assert.ok(state.log.some((e) => e.kind === 'service_up' && /Levantó un servicio: npm run dev/.test(e.text)), 'la bitácora lo cuenta');
    // outside herdr there is no pane to open: the web shows it itself
    const term = await fetch(`${server.url}/v1/services/${id}/terminal`, { method: 'POST' });
    assert.equal(term.status, 409);
    assert.equal((await get('/v1/services/nada/log')).status, 404);
    // the agent stops it
    await post('/v1/hooks/claude-code', { hook_event_name: 'PreToolUse', session_id: 'sesion-bg', cwd: '/proyecto', tool_name: 'KillShell', tool_use_id: 't2', tool_input: { shell_id: 'bk1' } });
    await sleep(20);
    assert.equal((await get('/v1/services')).services[0].status, 'ended');
  } finally {
    await server.close();
  }
});
