// herdr: dentro de herdr la oficina abre a los agentes en panes, y entiende los panes que ellos
// abren para sus actividades. Todo con una CLI de herdr de mentira (no se toca ninguna sesión real).
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

/** Una CLI de herdr de mentira: panes en memoria y la lista de lo que se le pidió. */
function fakeHerdr() {
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
    // con un ejecutable propio, herdr reconoce al agente en el pane cuando arranca
    if (group === 'agent' && cmd === 'wait') { const p = panes.get(rest[0]); if (p) Object.assign(p, { agent: p.agent || 'claude', agent_status: 'idle' }); return ok(); }
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
  assert.deepEqual(fake.calls.find((c) => c[1] === 'prompt'), ['agent', 'prompt', name, 'Agrega cupones']);
  assert.equal(fake.panes.get('w1:p2').label, '🏢 Pagos · Claude · tienda');
  assert.match(name, /^[a-z][a-z0-9_-]{0,31}$/, 'un nombre válido para herdr');

  // un ejecutable propio: se escribe en el pane y se le habla por el id del pane
  fake.calls.length = 0;
  await herdr.launchAgent({ harness: 'pi', cwd: '/x', bin: '/opt/mi pi', args: ['--modelo', 'x'], prompt: 'hola' });
  assert.deepEqual(fake.calls.find((c) => c[1] === 'run'), ['pane', 'run', 'w1:p3', "'/opt/mi pi' --modelo x"]);
  assert.deepEqual(fake.calls.find((c) => c[1] === 'prompt'), ['agent', 'prompt', 'w1:p3', 'hola']);

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
  await herdr.poll(); // los que ya estaban no se anuncian
  const { pane } = await herdr.launchAgent({ harness: 'pi', cwd: '/proyectos/tienda' });
  fake.panes.get(pane).agent_status = 'working';
  await herdr.poll();
  fake.panes.get(pane).agent_status = 'idle';
  await herdr.poll();
  // el agente abre un pane en su proyecto (la oficina lo adopta) y el usuario otro en otra parte (no)
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
  // el proceso arrancó y sigue vivo: el pane no se cierra
  fake.panes.get(pane).foreground_processes = [{ name: 'node' }];
  await herdr.poll();
  assert.deepEqual(closed, []);
  assert.ok(herdr.status().panes.some((p) => p.pane === pane), 'sigue trackeado mientras corre');
  // el proceso terminó (foreground vacío, el shell idle sigue vivo): se cierra el pane
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
    // al abrir la oficina en la carpeta del agente: su pane, en su oficina y con la URL de la oficina
    const start = await server.launchStartAgent({ cwd: dir });
    assert.equal(start.ok, true, start.error);
    assert.deepEqual([start.pane, start.agent.office], ['w1:p2', 'pagos']);
    const split = fake.calls.find((c) => c[1] === 'split');
    assert.ok(split.includes(`DEV_TEAM_OFFICE_OFFICE=pagos`) && split.includes(`DEV_TEAM_OFFICE_URL=${server.url}`), split.join(' '));
    assert.equal(server.company.paneOffice.get('w1:p2'), 'pagos');

    // un prompt desde la pizarra sin sesión abierta: una sesión nueva… en un pane, no en segundo plano
    const r = server.registry.run({ target: agent.id, text: 'Reembolsos parciales', session: null, from: 'Web' });
    assert.equal(r.ok, true, r.error);
    const task = await until(() => server.hub.snapshot().tasks.find((x) => x.pane));
    assert.equal(task.office, 'pagos');
    assert.equal(task.status, 'running');
    assert.ok(fake.calls.some((c) => c[1] === 'prompt' && c.at(-1) === 'Reembolsos parciales'));
    // cuando el agente de ese pane termina su turno, la tarea queda hecha
    fake.panes.get(task.pane).agent_status = 'working';
    await sleep(80);
    fake.panes.get(task.pane).agent_status = 'idle';
    await until(() => server.hub.snapshot().tasks.find((x) => x.id === task.id && x.status === 'done'));

    // el agente abre un pane para los tests (dev-team-office pane): alguien de Pagos se encarga
    const res = await fetch(`${server.url}/v1/panes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pane: 'w1:p7', parent: 'w1:p2', title: 'tests en watch', command: 'npm test -- --watch', cwd: dir }) }).then((x) => x.json());
    assert.deepEqual([res.ok, res.office, res.role], [true, 'pagos', 'qa']);
    fake.panes.set('w1:p7', { pane_id: 'w1:p7', cwd: dir, agent_status: 'unknown' });
    const pagos = server.company.get('pagos');
    assert.ok(pagos.log.some((e) => e.kind === 'pane_open' && e.pane === 'w1:p7' && e.role === 'qa'));
    assert.ok(!server.company.get('main').log.some((e) => e.kind === 'pane_open'), 'no se cuela en otra oficina');
    // se cierra: la oficina lo ve
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
