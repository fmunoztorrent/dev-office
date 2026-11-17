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
  // React alone is a screen too; a library that only asks for it is not
  assert.equal(detectKind(repo('loyalty-web', { dependencies: { react: '18' } })), 'frontend');
  assert.equal(detectKind(repo('botones', { name: '@acme/botones', main: 'index.js', peerDependencies: { react: '18' } })), 'library');
});

test('el orden: primero lo que otros usan; sin decir qué usa cada uno, se propone por capas; un círculo no se acepta', () => {
  const parts = suggestUses([{ name: 'web', kind: 'frontend' }, { name: 'bff', kind: 'bff' }, { name: 'core', kind: 'backend' }, { name: 'ui', kind: 'library' }]);
  assert.deepEqual(parts.map((p) => [p.name, p.uses]), [['web', ['bff']], ['bff', ['core', 'ui']], ['core', ['ui']], ['ui', []]]);
  assert.deepEqual(orderParts(parts).order, ['ui', 'core', 'bff', 'web']);
  assert.deepEqual(consumersOf(parts, 'core'), ['bff', 'web'], 'cambiar el core alcanza al BFF y, por él, al front');
  assert.match(orderParts([{ name: 'a', uses: ['b'] }, { name: 'b', uses: ['a'] }]).error, /círculo: a, b/);
  assert.match(orderParts([{ name: 'a', uses: ['x'] }]).error, /«a» usa «x», que no está en el proyecto/);
  // without a bff, the screens use the backends
  assert.deepEqual(suggestUses([{ name: 'app', kind: 'mobile' }, { name: 'api', kind: 'backend' }])[0].uses, ['api']);
});

test('un proyecto: sus repos, los que usan de otro proyecto (compartidos), sus tipos y lo que usa cada uno; dentro de él, sin círculos', () => {
  const { store, pagos, plataforma, core, bff, web, system } = payments();
  try {
    // the system of before became the project Pagos: its repos, and the core it uses (Platform's, shared)
    assert.equal(system.office, pagos.id);
    assert.deepEqual(system.parts.map((p) => [p.name, p.kind, p.uses, !!p.shared]), [['pagos-bff', 'bff', ['pagos-core'], false], ['pagos-web', 'frontend', ['pagos-bff'], false], ['pagos-core', 'backend', [], true]]);
    assert.equal(store.getAgent(core.id).office, plataforma.id, 'el core sigue siendo de Plataforma');
    assert.deepEqual(store.listRelations().map((r) => [r.from, r.to, r.how, r.source]), [[web.id, bff.id, 'calls', 'you'], [bff.id, core.id, 'calls', 'you']]);
    // a relation is checked: known repositories, not itself, how, and no circle inside a project
    assert.match(store.saveRelation({ from: bff.id, to: '/no/registrado' }).error, /repositorio desconocido/);
    assert.match(store.saveRelation({ from: bff.id, to: bff.id }).error, /no se usa a sí mismo/);
    assert.match(store.saveRelation({ from: bff.id, to: web.id, how: 'adora' }).error, /uno de: calls/);
    assert.match(store.saveRelation({ from: bff.id, to: web.id }).error, /no puede usar «pagos-web»: dentro de un proyecto/);
    // between projects it may (the core calling back the bff is Platform's business)
    const back = store.saveRelation({ from: core.id, to: bff.id, how: 'consumes', note: 'eventos de reembolso' });
    assert.equal(back.ok, true, back.error);
    assert.equal(store.saveRelation({ from: core.id, to: bff.id, how: 'calls' }).created, false, 'el mismo par se cambia');
    assert.equal(store.deleteRelation(back.relation.id).ok, true);
    // the kind you say, or the detected one
    assert.match(store.updateAgent(bff.id, { kind: 'nave' }).error, /uno de: frontend/);
    assert.equal(store.updateAgent(web.id, { kind: null }).agent.kind, null);
    assert.equal(store.getSystem(pagos.id).parts.find((p) => p.name === 'pagos-web').kind, 'frontend', 'detectado de su carpeta');
    // the project a folder is in: its own first, then the ones that use it
    const [hit] = store.systemsOf(path.join(bff.path, 'src'));
    assert.deepEqual([hit.system.name, hit.part.name], ['Pagos', 'pagos-bff']);
    assert.deepEqual(store.systemsOf(core.path).map((x) => x.system.name), ['Plataforma', 'Pagos']);
    // deleting a repository forgets its relations
    store.deleteAgent(web.id);
    assert.deepEqual(store.listRelations().map((r) => r.from), [bff.id]);
    // the systems of before are not written any more
    assert.equal(store.deleteSystem(pagos.id).status, 410);
  } finally { store.close(); }
});

test('un encargo a un artefacto lleva quién es en su sistema, qué usa y quién lo usa, y las indicaciones del sistema', () => {
  const { store, bff, dirs } = payments();
  try {
    const head = guideText(guideFor(store, bff.path));
    assert.match(head, /^🧩 Artefacto pagos-bff \(BFF\) del proyecto Pagos · usa pagos-core · lo usan pagos-web$/m);
    assert.match(head, /📋 Indicaciones del proyecto «Pagos»:\n│ Los montos van en centavos\./);
    // the folders it may read (what it uses), without changing them
    const brief = scoped('Agrega el endpoint de reembolsos', bff.path, head, [dirs.core]);
    assert.match(brief, new RegExp(`^📁 Trabaja sólo dentro de .*pagos-bff: no cambies archivos fuera de esa carpeta\\. Puedes leer, sin cambiar nada, .*pagos-core: lo que usa este artefacto`));
    assert.equal(unguided(brief), 'Agrega el endpoint de reembolsos', 'en la pizarra, sólo el pedido');
    assert.equal(artifactLine({ name: 'S', parts: [{ name: 'x', kind: 'other' }] }, { name: 'x', kind: 'other' }), '🧩 Artefacto x (otro) del proyecto S');
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
    assert.deepEqual([by['pagos-bff'].why, by['pagos-bff'].via, by['pagos-web'].why], ['uses', 'pagos-core', 'uses']);
    assert.deepEqual(new Set(viaCore.targets), new Set([core.id, bff.id, web.id]));
    assert.match(impactText(viaCore), /📁 pagos-bff — usa pagos-core, que cambia/);
    assert.match(impactText(viaCore), /🧩 Pagos: pagos-bff ↺ · pagos-web ↺ · pagos-core ✱$/);
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

test('por la API: un proyecto con sus repos y sus relaciones, el encargo al proyecto y el personaje según el repo', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const area = (await call('POST', '/v1/areas', { name: 'Tecnología', instructions: 'Todo pasa por revisión.' })).area;
    const caja = (await call('POST', '/v1/offices', { name: 'Caja', area: 'Tecnología' })).office;
    assert.equal(caja.area, area.id);
    const web = repo('caja-web', { name: 'caja-web', dependencies: { next: '15', 'react-dom': '19' } });
    const api = repo('caja-api', { name: 'caja-api', dependencies: { express: '4' } });
    const a1 = (await call('POST', '/v1/agents', { path: web, harness: 'claude-code', name: 'caja-web', office: caja.id, bin: '/nonexistent/claude' })).agent;
    const a2 = (await call('POST', '/v1/agents', { path: api, harness: 'claude-code', name: 'caja-api', office: caja.id, bin: '/nonexistent/claude' })).agent;
    // the web calls the api
    const rel = await call('POST', '/v1/relations', { from: a1.id, to: a2.id, how: 'calls', note: 'los cobros' });
    assert.equal(rel.status, 201, rel.error);
    assert.deepEqual((await call('GET', '/v1/relations')).relations.map((r) => [r.from, r.to, r.note]), [[a1.id, a2.id, 'los cobros']]);
    const list = await call('GET', '/v1/systems');
    assert.deepEqual([list.systems[0].name, list.systems[0].order, list.systems[0].officeName], ['Caja', ['caja-api', 'caja-web'], 'Caja']);
    // the area groups its projects
    assert.deepEqual((await call('GET', '/v1/areas')).areas.map((a) => [a.name, a.projects]), [['General', ['main']], ['Tecnología', ['caja']]]);
    // a frontend repo's code is the frontend's (a file no rule claims)
    const [ev] = server.company.ingest('claude-code', { session_id: 'c1', cwd: web, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(web, 'src', 'lib', 'money.ts') }, tool_use_id: 'u1' });
    assert.equal(ev.role, 'frontend');
    // a brief to the project: a directive to its repositories, in order (the api goes first)
    const brief = await call('POST', `/v1/systems/${caja.id}/brief`, { text: 'Pagar con QR' });
    assert.equal(brief.status, 201, brief.error);
    assert.deepEqual(brief.directive.parts.map((p) => [p.name, p.status === 'waiting' ? 'waiting' : 'sent']), [['caja-api', 'sent'], ['caja-web', 'waiting']]);
    assert.deepEqual(brief.directive.parts[1].after, ['caja-api']);
    // the handoff from an unknown folder
    assert.equal((await call('POST', '/v1/handoff', { cwd: '/otra', text: 'x' })).status, 404);
    // the settings file carries the area, the project's area and the relation
    const file = await call('GET', '/v1/settings/export');
    assert.deepEqual([file.areas.find((a) => a.id === area.id).instructions, file.departments.find((o) => o.id === caja.id).area], ['Todo pasa por revisión.', area.id]);
    assert.deepEqual(file.relations.map((r) => [r.from, r.to, r.how]), [[web, api, 'calls']]);
    // deleting the area sends its projects to the general one
    assert.equal((await call('DELETE', `/v1/areas/${area.id}`)).ok, true);
    assert.equal(server.store.getOffice(caja.id).area, 'general');
    assert.equal((await call('DELETE', '/v1/areas/general')).ok, false, 'la general queda');
    assert.equal((await call('DELETE', `/v1/relations/${rel.relation.id}`)).ok, true);
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
    assert.match(list.content[0].text, /^Ventas: ventas-core → ventas-web\n  ventas-core \[backend\] .*ventas-core\n  ventas-web \[frontend\] .*ventas-web · uses ventas-core/);
    const h = await call('handoff', { text: 'POST /orders' });
    assert.ok(h.isError);
    assert.match(h.content[0].text, /office is not running/);
  } finally { mcp.close(); }
});
