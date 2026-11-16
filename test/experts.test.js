// The subject matter experts (server/experts.js): a character who knows a skill, associated with it by
// hand. When an agent uses that skill (its skill tool, or reading the skill's files), its event is the
// expert's (role 'sme', with `expert`) and, in the game, the expert comes up by the elevator to a hot desk
// and leaves when the turn ends.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openStore } from '../server/store.js';
import { skillOf, expertOfTool, knownSkills, skillName, skillAgent, suggestExpertActions, parseSkillActions } from '../server/experts.js';
import { Office } from '../server/office.js';
import { createSim, setExperts, expertPerson, ELEVATOR, HOT_DESKS } from '../public/sim.js';
import { exportSettings, importSettings } from '../server/settings-io.js';
import { startServer } from '../server/server.js';

test('qué skill usa un agente: su herramienta de skills (Claude Code, OpenCode) o leer los archivos de la skill', () => {
  assert.equal(skillOf('Skill', { skill: 'pci-dss' }), 'pci-dss');
  assert.equal(skillOf('Skill', { skill: 'anthropic-skills:PDF' }), 'pdf', 'sin su plugin, en minúsculas');
  assert.equal(skillOf('skill', { name: 'pagos' }), 'pagos');
  assert.equal(skillOf('read', { path: '/home/ana/.agents/skills/pci-dss/SKILL.md' }), 'pci-dss');
  assert.equal(skillOf('Read', { file_path: '/repo/.claude/skills/pagos/reference/api.md' }), 'pagos');
  assert.equal(skillOf('Bash', { command: 'cat ~/.pi/skills/pci-dss/SKILL.md' }), 'pci-dss');
  assert.equal(skillOf('Read', { file_path: '/repo/src/skills.js' }), null);
  assert.equal(skillOf('Edit', { file_path: '/repo/src/app.js' }), null);
  assert.equal(skillName('/Deploy'), 'deploy');
});

test('un experto se guarda con su skill y su aspecto; una skill tiene un solo experto', () => {
  const store = openStore(':memory:');
  const out = store.saveExpert({ skill: 'PCI-DSS', topic: 'pagos con tarjeta', look: { name: 'Ana', sex: 'f', shirt: '#118ab2' } });
  assert.ok(out.ok, out.error);
  assert.equal(out.expert.skill, 'pci-dss');
  assert.match(store.saveExpert({ skill: 'pci-dss', look: { name: 'Otra' } }).ok ? 'ok' : '', /ok/, 'sin id, la misma skill actualiza a su experto');
  assert.equal(store.listExperts().length, 1);
  assert.equal(store.findExpert('pci-dss').look.name, 'Otra');
  const other = store.saveExpert({ skill: 'kafka', look: { name: 'Leo' } }).expert;
  assert.match(store.saveExpert({ id: other.id, skill: 'pci-dss', look: { name: 'Leo' } }).error, /ya tiene su experto/);
  assert.match(store.saveExpert({ skill: 'x y', look: { name: 'Z' } }).error, /skill del experto/);
  assert.match(store.saveExpert({ skill: 'ok', look: {} }).error, /necesita un nombre/);
  assert.match(store.saveExpert({ skill: 'ok', look: { name: 'Z', shirt: 'rojo' } }).error, /color/);
  assert.ok(store.deleteExpert('kafka').ok, 'se borra por su id o su skill');
  assert.deepEqual(expertOfTool(store.listExperts(), 'Skill', { skill: 'pci-dss' }), { id: store.findExpert('pci-dss').id, name: 'Otra', title: '', skill: 'pci-dss', shirt: null }, 'su aspecto se reemplaza entero');
  assert.equal(expertOfTool(store.listExperts(), 'Skill', { skill: 'otra' }), null);
});

test('en la oficina: usar la skill de un experto es suyo (rol sme, con su badge); lo demás sigue siendo del equipo', () => {
  const o = new Office();
  const experts = [{ id: 'x1', skill: 'pci-dss', look: { name: 'Ana', shirt: '#118ab2' } }];
  o.expertFor = (tool, input) => expertOfTool(experts, tool, input);
  const [ev] = o.ingest('generic', { session: 's1', kind: 'tool_start', tool: 'Skill', input: { skill: 'pci-dss' } });
  assert.equal(ev.role, 'sme');
  assert.equal(ev.expert.name, 'Ana');
  assert.equal(ev.badge, '🎓 pci-dss');
  const [edit] = o.ingest('generic', { session: 's1', kind: 'tool_start', tool: 'Edit', input: { file_path: 'src/api/pay.js' } });
  assert.notEqual(edit.role, 'sme');
  assert.equal(edit.expert, undefined);
  // no son un rol del equipo: no cambian el estado de nadie
  assert.equal(o.snapshot().roles.sme, undefined);
});

test('en el juego: el experto sube por el ascensor con su aspecto, se sienta en un escritorio libre y se va al terminar el turno', () => {
  let t = 0, seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const sim = createSim({ clock: () => t, random, wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  const run = (s) => { for (let i = 0; i < s * 20; i++) { t += 50; sim.step(0.05, t); } };
  setExperts([{ id: 'x1', skill: 'pci-dss', topic: 'Pagos y PCI', look: { name: 'Ana', sex: 'f', shirt: '#118ab2' } }]);
  const expert = { id: 'x1', name: 'Ana', skill: 'pci-dss' };
  sim.handle({ kind: 'tool_start', role: 'sme', expert, session: 's1', tool: 'Skill', text: 'Usa la skill pci-dss', badge: '🎓 pci-dss' });
  const [ana] = sim.ghosts;
  assert.ok(ana?.specialist, 'llega en persona');
  assert.equal(ana.cfg.name, 'Ana');
  assert.equal(ana.cfg.shirt, '#118ab2');
  assert.equal(ana.cfg.title, 'Pagos y PCI', 'su título: de qué sabe');
  assert.equal(ana.tag?.text, '🎓 pci-dss');
  assert.deepEqual([ana.x, ana.y], [ELEVATOR.spot.x, ELEVATOR.spot.y]);
  assert.match(sim.agents.manager.bubble?.text || '', /Sube Ana, que sabe de pci-dss/);
  run(25);
  assert.equal(ana.cfg.seat, HOT_DESKS[0]);
  // otra vez la skill en el mismo turno: la misma Ana
  sim.handle({ kind: 'tool_start', role: 'sme', expert, session: 's1', tool: 'Skill' });
  assert.equal(sim.ghosts.length, 1);
  // un subagente que usa la skill: el subagente trabaja y Ana viene a ayudar (ya está)
  sim.handle({ kind: 'turn_end', role: 'manager', session: 's1' });
  assert.ok(ana.leaving);
  run(40);
  assert.equal(sim.ghosts.length, 0);
  // sin la lista de expertos, llega igual con lo que trae el evento
  setExperts([]);
  assert.equal(expertPerson({ id: 'x9', name: 'Leo', skill: 'kafka' }).title, 'Experta en kafka');
});

test('las skills que conoce la empresa (para elegir la del experto) y los expertos van en tus ajustes', () => {
  const store = openStore(':memory:');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-sme-')));
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'pagos'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'pagos', 'SKILL.md'), '---\nname: pagos\n---\n');
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'vacia'), { recursive: true });
  store.createAgent({ path: dir, harness: 'claude-code', name: 'tienda' });
  store.saveMine({ kind: 'skill', name: 'mis-commits', title: 'Cómo escribo los commits', body: 'x' });
  const names = knownSkills(store).map((k) => `${k.name}@${k.where}`);
  assert.deepEqual(names, ['mis-commits@mine', 'pagos@tienda'], 'una carpeta sin SKILL.md no es una skill');

  store.saveExpert({ skill: 'pagos', topic: 'cobros', look: { name: 'Ana', glasses: true } });
  const file = exportSettings(store);
  assert.deepEqual(file.experts, [{ skill: 'pagos', topic: 'cobros', look: { name: 'Ana', glasses: true } }]);
  const other = openStore(':memory:');
  const out = importSettings(other, JSON.stringify(file), { mine: { save: () => ({ ok: true }) } });
  assert.equal(out.applied.experts, 1);
  assert.equal(other.findExpert('pagos').look.name, 'Ana');
});

test('API: crear, listar (con las skills conocidas) y borrar expertos', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-sme-home-')));
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, mine: { home }, loops: { autostart: false } });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const made = await call('POST', '/v1/experts', { skill: 'kafka', topic: 'eventos', look: { name: 'Leo', sex: 'm' } });
    assert.equal(made.status, 201, made.error);
    const list = await call('GET', '/v1/experts');
    assert.equal(list.experts.length, 1);
    assert.ok(Array.isArray(list.skills));
    assert.equal((await call('PUT', `/v1/experts/${made.expert.id}`, { skill: 'kafka', look: { name: 'Leo', sex: 'm', title: 'El de Kafka' } })).expert.look.title, 'El de Kafka');
    assert.equal(server.fullState().experts.length, 1, 'van en el estado de la oficina');
    assert.equal((await call('DELETE', `/v1/experts/${made.expert.id}`)).ok, true);
    assert.equal((await call('GET', '/v1/experts')).experts.length, 0);
  } finally { await server.close(); }
});

test('un experto guarda sus acciones rápidas y las valida', () => {
  const store = openStore(':memory:');
  const actions = [{ label: 'Listar runs', prompt: 'Listá los runs' }, { label: 'Forzar run', prompt: 'Forzá el tick' }];
  const out = store.saveExpert({ skill: 'abonos', look: { name: 'Ana' }, actions });
  assert.ok(out.ok, out.error);
  assert.deepEqual(out.expert.actions, actions);
  assert.deepEqual(store.findExpert('abonos').actions.length, 2);
  // sin id, la misma skill reemplaza sus acciones
  assert.deepEqual(store.saveExpert({ skill: 'abonos', look: { name: 'Ana' }, actions: [{ label: 'Otra', prompt: 'x' }] }).expert.actions, [{ label: 'Otra', prompt: 'x' }]);
  // sin acciones (o inválidas): vacío o error
  assert.deepEqual(store.saveExpert({ skill: 'sola', look: { name: 'Z' } }).expert.actions, []);
  assert.match(store.saveExpert({ skill: 'ok', look: { name: 'Z' }, actions: [{ label: '', prompt: 'x' }] }).error, /acción/);
  assert.match(store.saveExpert({ skill: 'ok', look: { name: 'Z' }, actions: 'no' }).error, /acción/);
  assert.match(store.saveExpert({ skill: 'ok', look: { name: 'Z' }, actions: Array.from({ length: 13 }, () => ({ label: 'a', prompt: 'b' })) }).error, /12/);
});

test('sugiere las acciones de una skill desde su SKILL.md y resuelve su proyecto', () => {
  assert.deepEqual(parseSkillActions('## Índice de acciones\n\n| Nombre | Qué hace |\n| --- | --- |\n| Listar runs | lee |\n| Forzar run | escribe |\n'), ['Listar runs', 'Forzar run']);
  assert.deepEqual(parseSkillActions('## Listar runs\ncurl\n\n## Forzar run\ncurl\n\n## Registro de lo observado\nnotas\n'), ['Listar runs', 'Forzar run'], 'las ## que no son acciones se saltan');
  const store = openStore(':memory:');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-actions-')));
  fs.mkdirSync(path.join(dir, '.pi', 'skills', 'loyalty-abono'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pi', 'skills', 'loyalty-abono', 'SKILL.md'), '## Índice de acciones\n\n| Nombre | Qué hace |\n| --- | --- |\n| Listar runs | lee |\n| Forzar run | escribe |\n');
  assert.equal(skillAgent(store, 'loyalty-abono'), null, 'sin proyecto registrado no hay agente');
  store.createAgent({ path: dir, harness: 'pi', name: 'core' });
  assert.equal(skillAgent(store, 'loyalty-abono').name, 'core');
  assert.deepEqual(suggestExpertActions(store, 'loyalty-abono'), [
    { label: 'Listar runs', prompt: 'Ejecutar la acción «Listar runs» del skill «loyalty-abono».' },
    { label: 'Forzar run', prompt: 'Ejecutar la acción «Forzar run» del skill «loyalty-abono».' },
  ]);
  assert.deepEqual(suggestExpertActions(store, 'no-existe'), []);
});

test('las acciones del experto van en tus ajustes (exportar e importar)', () => {
  const store = openStore(':memory:');
  store.saveExpert({ skill: 'abonos', look: { name: 'Ana' }, actions: [{ label: 'Forzar run', prompt: 'Forzá' }] });
  const file = exportSettings(store);
  assert.deepEqual(file.experts, [{ skill: 'abonos', look: { name: 'Ana' }, actions: [{ label: 'Forzar run', prompt: 'Forzá' }] }]);
  const other = openStore(':memory:');
  const out = importSettings(other, JSON.stringify(file), { mine: { save: () => ({ ok: true }) } });
  assert.equal(out.applied.experts, 1);
  assert.deepEqual(other.findExpert('abonos').actions, [{ label: 'Forzar run', prompt: 'Forzá' }]);
});

test('API: sugerir acciones y ejecutar una (va a la analista como la pizarra)', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-actions-home-')));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-actions-proj-')));
  fs.mkdirSync(path.join(dir, '.pi', 'skills', 'loyalty-abono'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pi', 'skills', 'loyalty-abono', 'SKILL.md'), '## Índice de acciones\n\n| Nombre | Qué hace |\n| --- | --- |\n| Listar runs | lee |\n');
  const spawn = (_exe, _argv, _opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit('data', 'Q: ¿Para qué perfil?\n'); child.emit('close', 0); }, 5);
    return child;
  };
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, mine: { home }, loops: { autostart: false }, clarify: { spawn, timeoutMs: 1000 } });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    assert.deepEqual((await call('GET', '/v1/experts/suggest?skill=loyalty-abono')).actions, [], 'sin proyecto registrado no hay de dónde leer');
    await call('POST', '/v1/agents', { path: dir, harness: 'pi', name: 'core', bin: process.execPath });
    assert.deepEqual((await call('GET', '/v1/experts/suggest?skill=loyalty-abono')).actions.map((a) => a.label), ['Listar runs']);
    assert.equal((await call('POST', '/v1/experts/nada/run', { prompt: 'x' })).status, 404);
    const made = await call('POST', '/v1/experts', { skill: 'loyalty-abono', look: { name: 'Ana' }, actions: [{ label: 'Listar runs', prompt: 'Listá los runs' }] });
    assert.equal(made.status, 201, made.error);
    assert.equal((await call('POST', `/v1/experts/${made.expert.id}/run`, { prompt: '' })).status, 400);
    const out = await call('POST', `/v1/experts/${made.expert.id}/run`, { prompt: 'Listá los runs' });
    assert.equal(out.ok, true, out.error);
    assert.ok(out.clarify, 'pasa por la analista, como la pizarra');
  } finally { await server.close(); }
});

test('API: ejecutar una acción sin proyecto que conozca la skill se lo dice', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-actions-noagent-')));
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, mine: { home }, loops: { autostart: false } });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const made = await call('POST', '/v1/experts', { skill: 'pci-dss', look: { name: 'Ana' } });
    const out = await call('POST', `/v1/experts/${made.expert.id}/run`, { prompt: 'Auditá' });
    assert.equal(out.status, 400);
    assert.match(out.error, /proyecto registrado/);
  } finally { await server.close(); }
});
