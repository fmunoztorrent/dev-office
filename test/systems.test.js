// The systems (server/systems.js): a product or business project made of artifacts (a repo, or a
// component of one), each with its kind and what it uses. A change goes in that order (core → bff → web),
// each part with the handoff of the ones it uses; the impact of an order follows who uses what; the
// kind of artifact picks the character for code no rule claims; and the system's instructions go on top
// of its artifacts' briefs.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { detectKind, suggestUses, orderParts, consumersOf, artifactLine } from '../server/systems.js';
import { guideFor, guideText, unguided } from '../server/guides.js';
import { scoped } from '../server/tasks.js';
import { DirectiveDesk } from '../server/directives.js';
import { companyMap, mapImpact, impactText } from '../server/components.js';
import { roleForTool } from '../server/roles.js';
import { startServer } from '../server/server.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-sys-')));
const repo = (name, pkg) => {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
};

/** A store with the Payments system: its core, its bff and its web (three repos), the core shared from Platform. */
function payments() {
  const store = openStore(':memory:');
  const pagos = store.createOffice({ name: 'Pagos' }).office;
  const plataforma = store.createOffice({ name: 'Plataforma' }).office;
  const dirs = { core: repo('pagos-core', { name: 'pagos-core', dependencies: { express: '4' } }), bff: repo('pagos-bff', { name: 'pagos-bff', dependencies: { fastify: '4' } }), web: repo('pagos-web', { name: 'pagos-web', dependencies: { next: '15', 'react-dom': '19' } }) };
  const core = store.createAgent({ path: dirs.core, harness: 'claude-code', name: 'pagos-core', office: plataforma.id, bin: '/nonexistent/claude' }).agent;
  const bff = store.createAgent({ path: dirs.bff, harness: 'claude-code', name: 'pagos-bff', office: pagos.id, bin: '/nonexistent/claude' }).agent;
  const web = store.createAgent({ path: dirs.web, harness: 'pi', name: 'pagos-web', office: pagos.id, bin: '/nonexistent/pi' }).agent;
  const sys = store.saveSystem({
    name: 'Pagos', office: pagos.id, instructions: 'Los montos van en centavos.',
    parts: [
      { name: 'web', project: web.id, kind: 'frontend', uses: ['bff'] },
      { name: 'bff', project: bff.id, kind: 'bff', uses: ['core'] },
      { name: 'core', project: core.path, kind: 'backend' },
    ],
  });
  assert.ok(sys.ok, sys.error);
  return { store, pagos, plataforma, dirs, core, bff, web, system: sys.system };
}

test('el tipo de un artefacto sale de su carpeta: Next es frontend, Express backend, un BFF lo dice su nombre', () => {
  assert.equal(detectKind(repo('tienda-web', { dependencies: { next: '15', 'react-dom': '19' } })), 'frontend');
  assert.equal(detectKind(repo('api', { dependencies: { express: '4' } })), 'backend');
  assert.equal(detectKind(repo('tienda-bff', { dependencies: { express: '4' } })), 'bff');
  assert.equal(detectKind(repo('app', { dependencies: { 'react-native': '0.76' } })), 'mobile');
  assert.equal(detectKind(repo('mails-worker', { dependencies: { bullmq: '5' } })), 'worker');
  assert.equal(detectKind(repo('ui-kit', { name: '@acme/ui', main: 'index.js' })), 'library');
  const tf = repo('cloud');
  fs.writeFileSync(path.join(tf, 'main.tf'), '');
  assert.equal(detectKind(tf), 'infra');
  const go = repo('cobros');
  fs.writeFileSync(path.join(go, 'go.mod'), 'module cobros');
  assert.equal(detectKind(go), 'backend');
  assert.equal(detectKind(repo('notas')), 'other');
});

test('el orden: primero lo que otros usan; sin decir qué usa cada uno, se propone por capas; un círculo no se acepta', () => {
  const parts = suggestUses([{ name: 'web', kind: 'frontend' }, { name: 'bff', kind: 'bff' }, { name: 'core', kind: 'backend' }, { name: 'ui', kind: 'library' }]);
  assert.deepEqual(parts.map((p) => [p.name, p.uses]), [['web', ['bff']], ['bff', ['core', 'ui']], ['core', ['ui']], ['ui', []]]);
  assert.deepEqual(orderParts(parts).order, ['ui', 'core', 'bff', 'web']);
  assert.deepEqual(consumersOf(parts, 'core'), ['bff', 'web'], 'cambiar el core alcanza al BFF y, por él, al front');
  assert.match(orderParts([{ name: 'a', uses: ['b'] }, { name: 'b', uses: ['a'] }]).error, /círculo: a, b/);
  assert.match(orderParts([{ name: 'a', uses: ['x'] }]).error, /«a» usa «x», que no está en el sistema/);
  // without a bff, the screens use the backends
  assert.deepEqual(suggestUses([{ name: 'app', kind: 'mobile' }, { name: 'api', kind: 'backend' }])[0].uses, ['api']);
});

test('un sistema se valida: sus repos registrados, sus tipos, sin nombres repetidos ni círculos; un repo de otro departamento es compartido', () => {
  const { store, pagos, plataforma, core, bff, system } = payments();
  try {
    assert.equal(system.office, pagos.id);
    assert.deepEqual(system.parts.map((p) => [p.name, p.kind, p.uses]), [['web', 'frontend', ['bff']], ['bff', 'bff', ['core']], ['core', 'backend', []]]);
    assert.equal(core.office, plataforma.id, 'el core sigue siendo de Plataforma');
    const bad = (parts) => store.saveSystem({ name: 'X', parts }).error;
    assert.match(bad([{ name: 'a', project: '/no/registrado' }]), /proyecto desconocido/);
    assert.match(bad([{ name: 'a', project: bff.id, kind: 'nave' }]), /uno de: frontend/);
    assert.match(bad([{ name: 'a', project: bff.id }, { name: 'A', project: core.id }]), /mismo nombre/);
    assert.match(bad([{ name: 'a', project: bff.id, uses: ['b'] }, { name: 'b', project: core.id, uses: ['a'] }]), /círculo/);
    const otro = store.saveSystem({ name: 'Caja', parts: [] }).system;
    assert.match(store.saveSystem({ id: otro.id, name: 'pagos' }).error, /ya hay un sistema/, 'el nombre es único (sin mayúsculas)');
    assert.equal(store.saveSystem({ name: 'PAGOS', instructions: 'otra' }).system.id, system.id, 'sin id, el del mismo nombre se actualiza');
    store.saveSystem({ id: system.id, name: 'Pagos', instructions: 'Los montos van en centavos.' });
    // the system an artifact is in, from its folder
    const [hit] = store.systemsOf(path.join(bff.path, 'src'));
    assert.deepEqual([hit.system.name, hit.part.name], ['Pagos', 'bff']);
    // deleting its department leaves it with the main one
    store.deleteOffice(pagos.id);
    assert.equal(store.getSystem(system.id).office, 'main');
  } finally { store.close(); }
});

test('un encargo a un artefacto lleva quién es en su sistema, qué usa y quién lo usa, y las indicaciones del sistema', () => {
  const { store, bff, dirs } = payments();
  try {
    const head = guideText(guideFor(store, bff.path));
    assert.match(head, /^🧩 Artefacto bff \(BFF\) del sistema Pagos · usa core · lo usan web$/m);
    assert.match(head, /📋 Indicaciones del sistema «Pagos»:\n│ Los montos van en centavos\./);
    // the folders it may read (what it uses), without changing them
    const brief = scoped('Agrega el endpoint de reembolsos', bff.path, head, [dirs.core]);
    assert.match(brief, new RegExp(`^📁 Trabaja sólo dentro de .*pagos-bff: no cambies archivos fuera de esa carpeta\\. Puedes leer, sin cambiar nada, .*pagos-core: lo que usa este artefacto`));
    assert.equal(unguided(brief), 'Agrega el endpoint de reembolsos', 'en la pizarra, sólo el pedido');
    assert.equal(artifactLine({ name: 'S', parts: [{ name: 'x', kind: 'other' }] }, { name: 'x', kind: 'other' }), '🧩 Artefacto x (otro) del sistema S');
  } finally { store.close(); }
});

/** A directive desk with fakes: each part becomes a task the test ends by hand. */
function desk(store) {
  const hub = Object.assign(new EventEmitter(), { tasks: new Map(), cancel() { return { ok: true }; } });
  const sent = [];
  let n = 0;
  const registry = {
    run(msg) {
      sent.push(msg);
      const task = { id: `t${++n}`, status: 'running', detail: '', output: [] };
      hub.tasks.set(task.id, task);
      return { ok: true, task };
    },
  };
  const d = new DirectiveDesk({ store, registry, hub, archive: null, company: { info: () => ({ name: '' }) } });
  const end = (target, status = 'done', output = []) => {
    const i = sent.findIndex((m) => m.target === target);
    const task = hub.tasks.get(`t${i + 1}`);
    Object.assign(task, { status, output });
    hub.emit('change');
  };
  return { d, sent, end };
}

test('un encargo a un sistema va en orden: el core primero, el BFF con su traspaso y el front al final', () => {
  const { store, core, bff, web, dirs } = payments();
  try {
    const { d, sent, end } = desk(store);
    const out = d.create({ text: 'Reembolsos parciales', systems: ['Pagos'], exact: true, ask: false });
    assert.ok(out.ok, out.error);
    const parts = Object.fromEntries(out.directive.parts.map((p) => [p.name, p]));
    assert.equal(parts['pagos-core'].status, 'running');
    assert.deepEqual([parts['pagos-bff'].status, parts['pagos-bff'].after, parts['pagos-bff'].detail], ['waiting', ['pagos-core'], 'espera a pagos-core (lo usa)']);
    assert.deepEqual(parts['pagos-web'].after, ['pagos-bff']);
    assert.deepEqual(sent.map((m) => m.target), [core.id], 'sólo el core parte');
    // the core is told who uses it, and to leave the handoff
    assert.match(sent[0].text, /🤝 Lo usan pagos-bff, que trabajan después de ti: al terminar, deja el traspaso con la herramienta MCP handoff/);
    // it leaves its handoff (MCP), from inside its folder
    const h = d.handoff({ cwd: path.join(dirs.core, 'src'), text: 'POST /refunds { amount, reason } → 201 { id }' });
    assert.deepEqual([h.ok, h.part, h.for], [true, 'pagos-core', ['pagos-bff']]);
    assert.equal(d.handoff({ cwd: '/otra/carpeta', text: 'x' }).ok, false);
    end(core.id);
    // the bff goes, with the core's handoff, and may read its folder
    assert.deepEqual(sent.map((m) => m.target), [core.id, bff.id]);
    assert.match(sent[1].text, /^📦 Lo que dejó pagos-core \(lo usas\):\nPOST \/refunds \{ amount, reason \} → 201 \{ id \}\n\n🏛 /);
    assert.deepEqual(sent[1].reads, [dirs.core]);
    // without a handoff, the end of what it answered (a session in the background)
    end(bff.id, 'done', ['…', 'Expuse GET /refunds/:id en el BFF']);
    assert.match(sent[2].text, /📦 Lo que dejó pagos-bff \(lo usas\):\n…\nExpuse GET \/refunds\/:id en el BFF/);
    assert.equal(sent[2].target, web.id);
    end(web.id);
    assert.equal(d.get(out.directive.id).status, 'done');
  } finally { store.close(); }
});

test('si el que se usa falla, los que dependen de él no parten', () => {
  const { store, core } = payments();
  try {
    const { d, sent, end } = desk(store);
    const out = d.create({ text: 'Cambiar la moneda', systems: ['Pagos'], exact: true, ask: false });
    end(core.id, 'failed');
    const parts = d.get(out.directive.id).parts;
    assert.deepEqual(parts.map((p) => [p.name, p.status]), [['pagos-bff', 'cancelled'], ['pagos-core', 'failed'], ['pagos-web', 'cancelled']].sort(), 'en el orden de la directiva');
    assert.match(parts.find((p) => p.name === 'pagos-bff').detail, /no partió: pagos-core no terminó/);
    assert.equal(sent.length, 1);
    assert.equal(d.get(out.directive.id).status, 'failed');
  } finally { store.close(); }
});

test('el impacto sigue las dependencias: cambiar el core alcanza al BFF y al front; nombrar el sistema, a todos', () => {
  const { store, core, bff, web } = payments();
  try {
    const map = companyMap(store);
    const viaCore = mapImpact(map, 'Que el core redondee los montos', { targets: [core.id] });
    const by = Object.fromEntries(viaCore.departments.flatMap((o) => o.projects).map((p) => [p.name, p]));
    assert.deepEqual([by['pagos-bff'].why, by['pagos-bff'].via, by['pagos-web'].why], ['uses', 'core', 'uses']);
    assert.deepEqual(new Set(viaCore.targets), new Set([core.id, bff.id, web.id]));
    assert.match(impactText(viaCore), /📁 pagos-bff — usa core, que cambia/);
    assert.match(impactText(viaCore), /🧩 Pagos: web ↺ · bff ↺ · core ✱/);
    const named = mapImpact(map, 'En el sistema Pagos, mostrar el IVA');
    assert.deepEqual(new Set(named.targets), new Set([core.id, bff.id, web.id]));
    // the core is Platform's: it comes in through the system (its department is not named)
    assert.deepEqual(['why', 'via'].map((k) => named.departments.flatMap((o) => o.projects).find((p) => p.name === 'pagos-core')[k]), ['system', 'Pagos']);
    assert.deepEqual(named.unknown, [], 'el sistema está en el mapa: no se pregunta');
    // the front alone: nobody uses it, so it reaches nobody else
    assert.deepEqual(mapImpact(map, 'Un botón nuevo', { targets: [web.id] }).targets, [web.id]);
  } finally { store.close(); }
});

test('el código que ninguna regla reclama es del personaje del tipo de su artefacto', () => {
  assert.equal(roleForTool('Edit', { file_path: '/r/src/lib/money.ts' }), 'backend', 'sin tipo: el backend, como siempre');
  assert.equal(roleForTool('Edit', { file_path: '/r/src/lib/money.ts' }, 'frontend'), 'frontend');
  assert.equal(roleForTool('Bash', { command: 'npm run build' }, 'frontend'), 'frontend');
  assert.equal(roleForTool('Edit', { file_path: '/r/main.go' }, 'infra'), 'devops');
  assert.equal(roleForTool('Edit', { file_path: '/r/src/money.test.ts' }, 'frontend'), 'qa', 'las reglas propias del archivo ganan');
});

test('por la API: un sistema con equipo propio, el encargo al sistema y el personaje según el artefacto', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const web = repo('caja-web', { name: 'caja-web', dependencies: { next: '15', 'react-dom': '19' } });
    const api = repo('caja-api', { name: 'caja-api', dependencies: { express: '4' } });
    const a1 = (await call('POST', '/v1/agents', { path: web, harness: 'claude-code', name: 'caja-web', bin: '/nonexistent/claude' })).agent;
    const a2 = (await call('POST', '/v1/agents', { path: api, harness: 'claude-code', name: 'caja-api', bin: '/nonexistent/claude' })).agent;
    // the form's proposal: kinds from each folder, and what each one uses
    const sug = await call('POST', '/v1/systems/suggest', { parts: [{ name: 'web', project: a1.id }, { name: 'api', project: a2.id }] });
    assert.deepEqual(sug.parts.map((p) => [p.name, p.kind, p.uses]), [['web', 'frontend', ['api']], ['api', 'backend', []]]);
    assert.deepEqual(sug.order, ['api', 'web']);
    // a team of its own: a new department, and its repos move to it
    const out = await call('POST', '/v1/systems', { name: 'Caja', team: 'new', parts: sug.parts });
    assert.equal(out.status, 201, out.error);
    assert.equal(out.office.name, 'Caja');
    assert.deepEqual(server.store.listAgents().map((a) => a.office), [out.office.id, out.office.id]);
    const list = await call('GET', '/v1/systems');
    assert.deepEqual(list.systems[0].order, ['api', 'web']);
    assert.equal(list.systems[0].officeName, 'Caja');
    // a frontend repo's code is the frontend's (a file no rule claims)
    const [ev] = server.company.ingest('claude-code', { session_id: 'c1', cwd: web, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(web, 'src', 'lib', 'money.ts') }, tool_use_id: 'u1' });
    assert.equal(ev.role, 'frontend');
    // a brief to the system: a directive to its artifacts, in order (the api goes first)
    const brief = await call('POST', `/v1/systems/${out.system.id}/brief`, { text: 'Pagar con QR' });
    assert.equal(brief.status, 201, brief.error);
    assert.deepEqual(brief.directive.parts.map((p) => [p.name, p.status === 'waiting' ? 'waiting' : 'sent']), [['caja-api', 'sent'], ['caja-web', 'waiting']]);
    assert.deepEqual(brief.directive.parts[1].after, ['caja-api']);
    // the handoff from an unknown folder
    assert.equal((await call('POST', '/v1/handoff', { cwd: '/otra', text: 'x' })).status, 404);
    // the settings file carries it
    const file = await call('GET', '/v1/settings/export');
    assert.deepEqual(file.systems.map((s) => [s.name, s.parts.length]), [['Caja', 2]]);
    assert.equal((await call('DELETE', `/v1/systems/${out.system.id}`)).ok, true);
  } finally { await server.close(); }
});

test('el MCP: list_systems (también con la oficina apagada) y handoff, que necesita un encargo de sistema en curso', async () => {
  const { createMcp } = await import('../server/mcp.js');
  const dir = tmp();
  const db = path.join(dir, 'office.db');
  const store = openStore(db);
  const core = store.createAgent({ path: repo('ventas-core', { dependencies: { express: '4' } }), harness: 'claude-code', name: 'ventas-core', bin: '/nonexistent/claude' }).agent;
  const web = store.createAgent({ path: repo('ventas-web', { dependencies: { next: '15' } }), harness: 'pi', name: 'ventas-web', bin: '/nonexistent/pi' }).agent;
  store.saveSystem({ name: 'Ventas', parts: [{ name: 'web', project: web.id, kind: 'frontend', uses: ['core'] }, { name: 'core', project: core.id, kind: 'backend' }] });
  store.close();
  const mcp = createMcp({ base: 'http://127.0.0.1:9', socket: null, cwd: core.path, openStore: () => openStore(db), env: {} });
  try {
    const call = async (name, args = {}) => (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
    const list = await call('list_systems');
    assert.match(list.content[0].text, /^Ventas: core → web\n  web \[frontend\] .*ventas-web · uses core\n  core \[backend\] .*ventas-core/);
    const h = await call('handoff', { text: 'POST /orders' });
    assert.ok(h.isError);
    assert.match(h.content[0].text, /office is not running/);
  } finally { mcp.close(); }
});
