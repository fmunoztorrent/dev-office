// herdr: inside herdr the office opens the agents in panes, and understands the panes they open
// for their activities. All with a fake herdr CLI (no real session is touched).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Herdr, paneRole } from '../server/herdr.js';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';
import { createSim } from '../public/sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');
const ENV = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout');
};

/** A fake herdr CLI: panes in memory and the list of what it was asked. */
function fakeHerdr({ onPrompt, agentGet } = {}) {
  const panes = new Map([['w1:p1', { pane_id: 'w1:p1', workspace_id: 'w1', cwd: '/oficina', agent_status: 'unknown' }]]);
  const calls = [];
  let n = 1;
  const opt = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const ok = (result = {}) => JSON.stringify({ id: 'cli', result });
  const run = async (args) => {
    calls.push(args);
    const [group, cmd, ...rest] = args;
    if (group === 'pane' && cmd === 'split') {
      const id = `w1:p${++n}`;
      const cwd = opt(rest, '--cwd');
      panes.set(id, { pane_id: id, workspace_id: 'w1', cwd, foreground_cwd: cwd, agent_status: 'unknown' });
      return ok({ type: 'pane_info', pane: panes.get(id) });
    }
    if (group === 'pane' && cmd === 'list') return ok({ type: 'pane_list', panes: [...panes.values()].map((p) => ({ ...p })) });
    if (group === 'pane' && cmd === 'rename') { panes.get(rest[0]).label = rest[1]; return ok(); }
    if (group === 'pane' && cmd === 'run') { panes.get(rest[0]).terminal_title_stripped = rest[1]; return ok(); }
    if (group === 'pane' && cmd === 'process-info') {
      const p = panes.get(opt(rest, '--pane'));
      return ok({ type: 'pane_process_info', process_info: { pane_id: p.pane_id, foreground_processes: p.foreground_processes || [], shell_pid: 1 } });
    }
    if (group === 'pane' && cmd === 'close') { panes.delete(rest[0]); return ok(); }
    if (group === 'agent' && cmd === 'start') { const p = panes.get(opt(rest, '--pane')); Object.assign(p, { agent: opt(rest, '--kind'), agent_status: 'idle' }); return ok(); }
    // with a custom executable, herdr recognizes the agent in the pane when it starts
    if (group === 'agent' && cmd === 'wait') { const p = panes.get(rest[0]); if (p) Object.assign(p, { agent: p.agent || 'claude', agent_status: 'idle' }); return ok(); }
    if (group === 'agent' && cmd === 'prompt') return onPrompt ? onPrompt(rest[0], rest[1], { ok }) : ok();
    if (group === 'agent' && cmd === 'get') {
      const status = typeof agentGet === 'function' ? agentGet(rest[0]) : (agentGet?.[rest[0]] ?? panes.get(rest[0])?.agent_status ?? 'idle');
      return ok({ agent: { status } });
    }
    if (group === 'agent') return ok();
    throw new Error(`herdr ${args.join(' ')}: no lo conozco`);
  };
  return { run, calls, panes };
}

test('herdr: un agente en un pane nuevo (con su entorno y su prompt), y una actividad con su comando', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const opened = [];
  herdr.on('open', (p) => opened.push(p));
  assert.equal(herdr.available, true);
  assert.equal(new Herdr({ env: {}, run: fake.run }).available, false, 'fuera de herdr no hace nada');

  const { pane, name } = await herdr.launchAgent({ harness: 'claude-code', cwd: '/proyectos/tienda', prompt: 'Agrega cupones', env: { DEV_TEAM_OFFICE_OFFICE: 'pagos' }, office: 'pagos', officeName: 'Pagos', label: 'Claude · tienda' });
  assert.equal(pane, 'w1:p2');
  const split = fake.calls.find((c) => c[1] === 'split');
  assert.deepEqual(split, ['pane', 'split', 'w1:p1', '--direction', 'right', '--cwd', '/proyectos/tienda', '--env', 'DEV_TEAM_OFFICE_OFFICE=pagos', '--no-focus']);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'start'), ['agent', 'start', name, '--kind', 'claude', '--pane', 'w1:p2']);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'prompt'), ['agent', 'prompt', name, 'Agrega cupones', '--wait', '--until', 'working', '--timeout', '15000']);
  assert.equal(fake.panes.get('w1:p2').label, '🏢 Pagos · Claude · tienda');
  assert.match(name, /^[a-z][a-z0-9_-]{0,31}$/, 'un nombre válido para herdr');

  // a custom executable: it is typed into the pane and addressed by the pane's id
  fake.calls.length = 0;
  await herdr.launchAgent({ harness: 'pi', cwd: '/x', bin: '/opt/mi pi', args: ['--modelo', 'x'], prompt: 'hola' });
  assert.deepEqual(fake.calls.find((c) => c[1] === 'run'), ['pane', 'run', 'w1:p3', "'/opt/mi pi' --modelo x"]);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'prompt'), ['agent', 'prompt', 'w1:p3', 'hola', '--wait', '--until', 'working', '--timeout', '15000']);

  const cmd = await herdr.launchCommand({ command: 'npm test -- --watch', cwd: '/proyectos/tienda', from: 'w1:p2', direction: 'down', title: 'tests' });
  assert.equal(cmd.pane, 'w1:p4');
  assert.deepEqual(fake.calls.filter((c) => c[1] === 'split').at(-1).slice(2, 5), ['w1:p2', '--direction', 'down']);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'run' && c[2] === 'w1:p4'), ['pane', 'run', 'w1:p4', 'npm test -- --watch']);
  assert.deepEqual(opened.map((p) => [p.pane, p.kind, p.role]), [['w1:p2', 'agent', 'manager'], ['w1:p3', 'agent', 'manager'], ['w1:p4', 'command', 'qa']]);
});

test('herdr: los panes que se cierran, los cambios de estado y los panes que abre un agente por su cuenta', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const seen = [];
  for (const kind of ['open', 'close', 'state', 'discover']) herdr.on(kind, (p, st) => seen.push([kind, p.pane, st || null]));
  await herdr.poll(); // the ones already there are not announced
  const { pane } = await herdr.launchAgent({ harness: 'pi', cwd: '/proyectos/tienda' });
  fake.panes.get(pane).agent_status = 'working';
  await herdr.poll();
  fake.panes.get(pane).agent_status = 'idle';
  await herdr.poll();
  // the agent opens a pane in its project (the office adopts it) and the user another one elsewhere (it does not)
  fake.panes.set('w1:p9', { pane_id: 'w1:p9', cwd: '/proyectos/tienda', foreground_cwd: '/proyectos/tienda', terminal_title_stripped: 'npm run dev', agent_status: 'unknown' });
  fake.panes.set('w1:p8', { pane_id: 'w1:p8', cwd: '/Users/yo/Downloads', agent_status: 'unknown' });
  await herdr.poll();
  fake.panes.delete(pane);
  await herdr.poll();
  assert.deepEqual(seen, [['open', 'w1:p2', null], ['state', 'w1:p2', 'working'], ['state', 'w1:p2', 'idle'], ['discover', 'w1:p9', null], ['close', 'w1:p2', null]]);
  assert.equal(paneRole({ command: 'npm run dev' }), 'frontend');
  assert.equal(paneRole({ command: 'pytest -k pagos' }), 'qa');
  assert.equal(paneRole({ role: 'arquitecto' }), 'tl');
});

test('herdr: el pane de un comando se cierra solo cuando su proceso terminó', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const closed = [];
  herdr.on('close', (p) => closed.push(p.pane));
  await herdr.poll();
  const { pane } = await herdr.launchCommand({ command: 'npm test', cwd: '/x' });
  // the process started and is still alive: the pane does not close
  fake.panes.get(pane).foreground_processes = [{ name: 'node' }];
  await herdr.poll();
  assert.deepEqual(closed, []);
  assert.ok(herdr.status().panes.some((p) => p.pane === pane), 'sigue trackeado mientras corre');
  // the process finished (empty foreground, the idle shell still alive): the pane closes
  fake.panes.get(pane).foreground_processes = [];
  await herdr.poll();
  assert.deepEqual(closed, [pane]);
  assert.ok(!herdr.status().panes.some((p) => p.pane === pane), 'sale de los panes de la oficina');
  assert.ok(!fake.panes.has(pane), 'se pidió cerrar el pane a herdr');
});

test('herdr: un watch con el proceso vivo nunca se auto-cierra', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const closed = [];
  herdr.on('close', (p) => closed.push(p.pane));
  await herdr.poll();
  const { pane } = await herdr.launchCommand({ command: 'npm test -- --watch', cwd: '/x' });
  fake.panes.get(pane).foreground_processes = [{ name: 'node' }];
  await herdr.poll();
  await herdr.poll();
  assert.deepEqual(closed, []);
  assert.ok(herdr.status().panes.some((p) => p.pane === pane), 'un watch sigue siendo una actividad abierta');
});

test('la oficina dentro de herdr: el agente al abrir, las sesiones nuevas en panes y las actividades del agente', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run, every: 30 });
  const store = openStore(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-herdr-'));
  store.createOffice({ name: 'Pagos' });
  const agent = store.createAgent({ path: dir, harness: 'claude', name: 'cobros', office: 'pagos', bin: FAKE_CLAUDE }).agent;
  const server = await startServer({ port: 0, socket: null, db: store, weather: false, herdr });
  try {
    // when the office opens in the agent's folder: its pane, in its office and with the office's URL
    const start = await server.launchStartAgent({ cwd: dir });
    assert.equal(start.ok, true, start.error);
    assert.deepEqual([start.pane, start.agent.office], ['w1:p2', 'pagos']);
    const split = fake.calls.find((c) => c[1] === 'split');
    assert.ok(split.includes(`DEV_TEAM_OFFICE_OFFICE=pagos`) && split.includes(`DEV_TEAM_OFFICE_URL=${server.url}`), split.join(' '));
    assert.equal(server.company.paneOffice.get('w1:p2'), 'pagos');

    // a prompt from the whiteboard without an open session: a new session… in a pane, not in the background
    const r = server.registry.run({ target: agent.id, text: 'Reembolsos parciales', session: null, from: 'Web' });
    assert.equal(r.ok, true, r.error);
    const task = await until(() => server.hub.snapshot().tasks.find((x) => x.pane));
    assert.equal(task.office, 'pagos');
    assert.equal(task.status, 'running');
    assert.ok(fake.calls.some((c) => c[1] === 'prompt' && c[3] === 'Reembolsos parciales'));
    // when that pane's agent ends its turn, the task is done
    fake.panes.get(task.pane).agent_status = 'working';
    await sleep(80);
    fake.panes.get(task.pane).agent_status = 'idle';
    await until(() => server.hub.snapshot().tasks.find((x) => x.id === task.id && x.status === 'done'));

    // the agent opens a pane for the tests (dev-team-office pane): someone from Pagos takes care of it
    const res = await fetch(`${server.url}/v1/panes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: 'w1:p7', parent: 'w1:p2', title: 'tests en watch', command: 'npm test -- --watch', cwd: dir }) }).then((x) => x.json());
    assert.deepEqual([res.ok, res.office, res.role], [true, 'pagos', 'qa']);
    fake.panes.set('w1:p7', { pane_id: 'w1:p7', cwd: dir, agent_status: 'unknown' });
    const pagos = server.company.get('pagos');
    assert.ok(pagos.log.some((e) => e.kind === 'pane_open' && e.pane === 'w1:p7' && e.role === 'qa'));
    assert.ok(!server.company.get('main').log.some((e) => e.kind === 'pane_open'), 'no se cuela en otra oficina');
    // it closes: the office sees it
    fake.panes.delete('w1:p7');
    await until(() => pagos.log.some((e) => e.kind === 'pane_close' && e.pane === 'w1:p7'));
    assert.deepEqual(server.herdr.status().panes.map((p) => p.pane).sort(), ['w1:p2', 'w1:p3']);
  } finally {
    await server.close();
  }
});

test('en el juego: el pane es de alguien del equipo mientras siga abierto', () => {
  let now = 0;
  const sim = createSim({ clock: () => now, random: () => 0.5, wall: () => new Date(2026, 9, 16, 10).getTime() });
  sim.handle({ kind: 'pane_open', role: 'qa', pane: 'w1:p7', text: 'tests en watch' });
  let worked = false;
  for (let i = 0; i < 300; i++) { now += 50; sim.step(0.05, now); worked ||= sim.agents.qa.state === 'working' && /tests en watch/.test(sim.agents.qa.text); }
  assert.ok(sim.agents.qa.badges.has('pane:w1:p7'));
  assert.ok(worked, 'Andrés trabaja en lo del pane');
  assert.ok(sim.journal.some((j) => j.kind === 'pane' && /Andrés se encarga del pane w1:p7/.test(j.text)));
  sim.handle({ kind: 'pane_close', role: 'qa', pane: 'w1:p7', text: 'tests en watch' });
  assert.ok(!sim.agents.qa.badges.has('pane:w1:p7'));
  sim.handle({ kind: 'pane_state', role: 'backend', pane: 'w1:p9', state: 'blocked', text: 'migración' });
  assert.equal(sim.agents.manager.handUp, true);
  assert.match(sim.agents.manager.bubble.text, /w1:p9 espera tu respuesta/);
});

test('dentro de herdr, cada subagente en su pane: bajo el del agente, uno al lado del otro, y se cierra al terminar', async () => {
  const fake = fakeHerdr();
  fake.panes.set('w1:p2', { pane_id: 'w1:p2', workspace_id: 'w1', cwd: '/proyectos/tienda', agent: 'pi', agent_status: 'working' });
  const herdr = new Herdr({ env: ENV, run: fake.run, every: 30 });
  const store = openStore(':memory:');
  const server = await startServer({ port: 0, socket: null, db: store, weather: false, herdr });
  const pi = (e) => server.company.ingest('pi', { session: 'pi-1', cwd: '/proyectos/tienda', pane: 'w1:p2', ...e });
  const splits = () => fake.calls.filter((c) => c[1] === 'split');
  try {
    pi({ kind: 'session_start' });
    pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'ex-qa', label: 'RED: tests que fallen', task: 'Escribe tests que fallen para shipping()' } });
    await until(() => server.subPanes.list().find((x) => x.pane));
    // below the agent's pane (not the office's), with that subagent's viewer
    assert.deepEqual(splits()[0].slice(0, 7), ['pane', 'split', 'w1:p2', '--direction', 'down', '--ratio', '0.4']);
    const qa = server.subPanes.list()[0].pane;
    const run = fake.calls.find((c) => c[1] === 'run' && c[2] === qa);
    assert.match(run[3], / follow --session pi-1 --sub c1 --office main$/);
    assert.ok(splits()[0].includes(`DEV_TEAM_OFFICE_URL=${server.url}`));
    assert.equal(fake.panes.get(qa).label, '🧪 Andrés · RED: tests que fallen');
    // a subagent's pane is not "someone's activity": its events tell its work
    assert.ok(!server.company.get('main').log.some((e) => e.kind === 'pane_open'));

    // another one at the same time: next to the first
    pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c2', input: { agent: 'ex-backend', label: 'Implementa shipping', task: 'Implementa shipping()' } });
    await until(() => server.subPanes.list().filter((x) => x.pane).length === 2);
    assert.deepEqual(splits()[1].slice(0, 5), ['pane', 'split', qa, '--direction', 'right']);

    // the first one finishes: its pane stays for a while (so it can be read) and then closes by itself
    pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'ex-qa' }, ok: true, output: '2 tests en rojo' });
    await server.subPanes.sweep(Date.now() + 1000);
    assert.ok(fake.panes.has(qa), 'todavía no');
    await server.subPanes.sweep(Date.now() + 9000);
    assert.ok(!fake.panes.has(qa), 'se cerró');
    assert.equal(server.subPanes.list().length, 1);
    // if the user closes one by hand, the office lets it go
    const be = server.subPanes.list()[0].pane;
    fake.panes.delete(be);
    await until(() => server.subPanes.list().length === 0);

    // turned off in ⚙: subagents no longer open panes
    server.setPrefs({ herdr: { subagents: false } });
    pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c3', input: { agent: 'ex-qa', task: 'Confirma en verde' } });
    await sleep(60);
    assert.equal(splits().length, 2);
    assert.equal(server.subPanes.list().length, 0);
  } finally {
    await server.close();
  }
});

test('un subagente sin el pane de su agente (el agente no está en herdr): bajo el de la oficina', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run, every: 30 });
  const server = await startServer({ port: 0, socket: null, db: openStore(':memory:'), weather: false, herdr });
  try {
    server.company.ingest('claude-code', { hook_event_name: 'PreToolUse', session_id: 'c-1', cwd: '/x', tool_name: 'Task', tool_use_id: 'tu1', tool_input: { subagent_type: 'qa-engineer', description: 'Revisa los tests' } });
    await until(() => server.subPanes.list().find((x) => x.pane));
    assert.deepEqual(fake.calls.find((c) => c[1] === 'split').slice(0, 5), ['pane', 'split', 'w1:p1', '--direction', 'down']);
  } finally {
    await server.close();
  }
});

test('un visor puede mirar otra oficina (?office=) sin cambiar la que quedó elegida', async () => {
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  const server = await startServer({ port: 0, socket: null, db: store, weather: false });
  try {
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}/v1/ws?office=pagos`);
    const snap = await new Promise((resolve, reject) => {
      ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.type === 'snapshot') resolve(m.state); });
      ws.addEventListener('error', reject);
    });
    ws.close();
    assert.equal(snap.office.id, 'pagos');
    assert.equal(store.getPrefs().view.office, 'main');
  } finally {
    await server.close();
  }
});

test('herdr: el prompt pide confirmación y el error de herdr conserva su código', async () => {
  const fake = fakeHerdr();
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const { name } = await herdr.launchAgent({ harness: 'claude-code', cwd: '/x', prompt: 'hola' });
  assert.deepEqual(fake.calls.find((c) => c[1] === 'prompt'), ['agent', 'prompt', name, 'hola', '--wait', '--until', 'working', '--timeout', '15000']);

  // the JSON error the CLI returns on stderr keeps its code, not only the message
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-herdr-bin-'));
  const bin = path.join(dir, 'herdr');
  fs.writeFileSync(bin, '#!/bin/sh\necho \'{"error":{"code":"agent_prompt_stalled","message":"el agente no arrancó"}}\' >&2\nexit 1\n', { mode: 0o755 });
  try {
    const cli = new Herdr({ env: ENV, bin });
    await assert.rejects(cli.prompt('agente', 'hola'), (err) => err.code === 'agent_prompt_stalled' && err.message === 'el agente no arrancó');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('herdr: un prompt estancado se confirma con agent get y se reenvía una sola vez (agente de herdr)', async () => {
  let prompts = 0;
  const stall = () => { throw Object.assign(new Error('no hubo actividad'), { code: 'agent_prompt_stalled' }); };
  const fake = fakeHerdr({ onPrompt: (target, text, { ok }) => (++prompts === 1 ? stall() : ok()) });
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const { name } = await herdr.launchAgent({ harness: 'claude-code', cwd: '/x', prompt: 'hola' });
  assert.equal(prompts, 2, 'un solo reintento');
  assert.deepEqual(fake.calls.find((c) => c[1] === 'get'), ['agent', 'get', name]);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'wait'), ['agent', 'wait', name, '--until', 'idle', '--timeout', '15000']);
  assert.equal(fake.calls.filter((c) => c[1] === 'prompt').length, 2);
});

test('herdr: el mismo reintento con un ejecutable propio (bin)', async () => {
  let prompts = 0;
  const stall = () => { throw Object.assign(new Error('no hubo actividad'), { code: 'agent_prompt_stalled' }); };
  const fake = fakeHerdr({ onPrompt: (target, text, { ok }) => (++prompts === 1 ? stall() : ok()) });
  const herdr = new Herdr({ env: ENV, run: fake.run });
  const { pane } = await herdr.launchAgent({ harness: 'pi', cwd: '/x', bin: '/opt/pi', prompt: 'hola' });
  assert.equal(prompts, 2);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'get'), ['agent', 'get', pane]);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'wait' && c.at(-1) === '15000'), ['agent', 'wait', pane, '--until', 'idle', '--timeout', '15000']);
});

test('herdr: si el prompt estancado ya arrancó el turno (working), no se reenvía', async () => {
  let prompts = 0;
  const fake = fakeHerdr({
    agentGet: () => 'working',
    onPrompt: () => { prompts++; throw Object.assign(new Error('no hubo actividad'), { code: 'agent_prompt_stalled' }); },
  });
  const herdr = new Herdr({ env: ENV, run: fake.run });
  await herdr.launchAgent({ harness: 'claude-code', cwd: '/x', prompt: 'hola' });
  assert.equal(prompts, 1, 'el pedido llegó: no se reenvía');
});

test('herdr: si el reintento también queda estancado, se propaga el error con su código y el pane', async () => {
  let prompts = 0;
  const fake = fakeHerdr({ onPrompt: () => { prompts++; throw Object.assign(new Error('no hubo actividad'), { code: 'agent_prompt_stalled' }); } });
  const herdr = new Herdr({ env: ENV, run: fake.run });
  await assert.rejects(
    herdr.launchAgent({ harness: 'claude-code', cwd: '/x', prompt: 'hola' }),
    (err) => err.code === 'agent_prompt_stalled' && err.pane === 'w1:p2',
  );
  assert.equal(prompts, 2, 'nunca hay un tercer envío');
});

test('herdr: un agente bloqueado (agent_blocked) no se reintenta', async () => {
  let prompts = 0;
  const fake = fakeHerdr({ onPrompt: () => { prompts++; throw Object.assign(new Error('el agente está bloqueado'), { code: 'agent_blocked' }); } });
  const herdr = new Herdr({ env: ENV, run: fake.run });
  await assert.rejects(herdr.launchAgent({ harness: 'claude-code', cwd: '/x', prompt: 'hola' }), (err) => err.code === 'agent_blocked');
  assert.equal(prompts, 1, 'agent_blocked no se reintenta');
});
