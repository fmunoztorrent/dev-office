// The company's architecture (server/architecture.js, public/architecture.js): areas → projects →
// repositories and infrastructure, what each repository uses of another (declared, or found exploring the
// folders: server/explore.js), each level of the map and its drawing, the review, the outline an agent
// reads, and the systems of an earlier version turned into projects and relations.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { architecture, architectureText, buildArchitecture } from '../server/architecture.js';
import { inferRelations, explainInfra } from '../server/explore.js';
import { archView, layoutArch, archNeighbors, archCrumbs, scopeOf } from '../public/architecture.js';
import { startServer } from '../server/server.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-arch-')));
const repo = (name, pkg, extra = {}) => {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [file, text] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
  return dir;
};

/**
 * A company: the area Tecnología with the projects Pagos (its bff and its web) and Plataforma (the core,
 * which Pagos uses, and a back office); the main project in the general area with a loose landing; a
 * queue the core publishes to and nobody consumes, and a database nobody is linked to.
 */
function company(db = ':memory:') {
  const store = openStore(db);
  const tec = store.createArea({ name: 'Tecnología', instructions: 'Todo pasa por revisión.' }).area;
  const pagos = store.createOffice({ name: 'Pagos', area: tec.id }).office;
  const plataforma = store.createOffice({ name: 'Plataforma', area: tec.id }).office;
  const add = (name, office, pkg, extra) => store.createAgent({ path: repo(name, pkg, extra), harness: 'claude-code', name, office: office.id, bin: '/nonexistent/claude' }).agent;
  const core = add('pagos-core', plataforma, { name: 'pagos-core', dependencies: { express: '4', ioredis: '5' } }, { 'src/server.js': "import Redis from 'ioredis';\nconst redis = new Redis(process.env.REDIS_URL);\nawait redis.set('k', 1);\napp.listen(3000);\n", '.env.example': 'REDIS_URL=redis://cache.internal:6379\n' });
  const bff = add('pagos-bff', pagos, { name: 'pagos-bff', dependencies: { fastify: '4' } }, { '.env.example': 'CORE_URL=http://localhost:3000\n' });
  const web = add('pagos-web', pagos, { name: 'pagos-web', dependencies: { next: '15' } }, { 'src/api.js': 'export const api = process.env.PAGOS_BFF_URL;\n' });
  const admin = add('backoffice', plataforma, { name: 'backoffice', dependencies: { next: '15' } });
  const suelto = add('landing', store.getOffice('main'), { name: 'landing' });
  const rel = (from, to, how = 'calls', note = '') => { const r = store.saveRelation({ from: from.id, to: to.id, how, note }); assert.ok(r.ok, r.error); return r.relation; };
  rel(web, bff, 'calls', 'la pantalla de pagos');
  rel(bff, core);
  rel(admin, core, 'reads', 'los reportes');
  const cola = store.saveResource({ kind: 'queue', name: 'cobros', tech: 'SQS', links: [{ project: core.path, how: 'publishes' }] }).resource;
  const base = store.saveResource({ kind: 'database', name: 'ledger', tech: 'Postgres' }).resource;
  return { store, tec, pagos, plataforma, core, bff, web, admin, suelto, cola, base };
}

test('el grafo: áreas, proyectos con sus repos (y los compartidos que usan), relaciones e infraestructura', () => {
  const c = company();
  const g = architecture(c.store, { areaName: (a) => a.name || 'General' });
  const of = (type) => g.nodes.filter((n) => n.type === type);
  assert.deepEqual(of('area').map((n) => [n.name, n.projects.length]), [['General', 1], ['Tecnología', 2]]);
  assert.deepEqual(of('project').map((n) => n.name).sort(), ['Pagos', 'Plataforma', 'main']);
  assert.equal(of('repo').length, 5);
  // el core es de Plataforma, y compone Pagos porque su bff lo usa: compartido
  const core = g.nodes.find((n) => n.id === `repo:${c.core.id}`);
  assert.deepEqual([core.project, core.shared, core.projects.sort()], [c.plataforma.id, true, [c.pagos.id, c.plataforma.id].sort()]);
  // quién usa a quién, cómo y para qué
  const uses = g.edges.filter((e) => e.kind === 'uses').map((e) => [e.from, e.to, e.how, e.note]);
  assert.deepEqual(uses, [[`repo:${c.web.id}`, `repo:${c.bff.id}`, 'calls', 'la pantalla de pagos'], [`repo:${c.bff.id}`, `repo:${c.core.id}`, 'calls', ''], [`repo:${c.admin.id}`, `repo:${c.core.id}`, 'reads', 'los reportes']]);
  // el orden en que va un cambio en cada proyecto
  const order = (name) => g.nodes.find((n) => n.type === 'project' && n.name === name).order;
  assert.deepEqual(order('Pagos'), ['pagos-core', 'pagos-bff', 'pagos-web']);
  assert.deepEqual(order('Plataforma'), ['pagos-core', 'backoffice']);
  // la infraestructura y cómo la usa cada repo
  assert.deepEqual(g.edges.filter((e) => e.kind === 'link' && e.to === `res:${c.cola.id}`).map((e) => [e.from, e.how]), [[`repo:${c.core.id}`, 'publishes']]);
  assert.deepEqual([g.stats.areas, g.stats.projects, g.stats.repos, g.stats.relations, g.stats.resources], [2, 3, 5, 3, 2]);
  c.store.close();
});

test('la revisión: lo que merece una mirada, lo grave primero', () => {
  const c = company();
  fs.rmSync(c.suelto.path, { recursive: true });
  const solo = c.store.createOffice({ name: 'Vacío', area: c.tec.id }).office;
  const g = architecture(c.store);
  const find = (code) => g.findings.find((f) => f.code === code);
  assert.equal(find('noConsumer').node, `res:${c.cola.id}`, 'una cola en la que se publica y nadie consume');
  assert.equal(find('resourceUnused').vars.name, 'ledger', 'una base que nadie usa');
  assert.equal(find('repoMissing').node, `repo:${c.suelto.id}`, 'un repo cuya carpeta ya no está');
  assert.equal(find('sharedRepo').vars.name, 'pagos-core');
  assert.equal(find('sharedRepo').vars.projects, 'Pagos');
  assert.equal(find('emptyProject').node, `project:${solo.id}`);
  // primero los avisos, después las notas
  const levels = g.findings.map((f) => f.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === 'warn' ? 0 : 1) - (b === 'warn' ? 0 : 1)));
  c.store.close();
});

test('la revisión, sin base de datos: repos que nada relaciona, relaciones encontradas y la infraestructura', () => {
  const areas = [{ id: 'general', name: 'General' }];
  const departments = [{ id: 'a', name: 'A', area: 'general', projects: [{ id: 'x', name: 'x', path: '/nada/x', kind: 'backend' }, { id: 'y', name: 'y', path: '/nada/y', kind: 'frontend' }] }];
  assert.ok(buildArchitecture({ areas, departments }).findings.some((f) => f.code === 'noRelations' && f.vars.n === 2));
  const found = buildArchitecture({ areas, departments, relations: [{ id: 'r1', from: 'y', to: 'x', how: 'calls', source: 'found', evidence: '.env: X_URL=…' }] });
  assert.deepEqual(found.findings.filter((f) => f.code !== 'repoMissing').map((f) => [f.code, f.vars.evidence]), [['relationFound', '.env: X_URL=…']]);
  assert.equal(found.edges[0].source, 'found');
  // una cola que se consume y en la que nadie publica; una detectada con nombre, por declarar
  const r = buildArchitecture({ areas, departments, relations: [{ from: 'y', to: 'x' }], resources: [
    { id: 'r1', key: 'queue:pedidos', name: 'pedidos', kind: 'queue', source: 'declared', state: 'planned', projects: [{ id: 'x', name: 'x', how: 'consumes' }] },
    { key: 'queue:eventos', name: 'eventos', kind: 'queue', source: 'detected', projects: [{ id: 'y', name: 'y', how: 'owns' }] },
    { key: 'tech:Postgres', name: 'Postgres', kind: 'database', tech: 'Postgres', source: 'detected', techOnly: true, projects: [{ id: 'x', name: 'x', how: 'uses' }] },
  ] });
  assert.deepEqual(r.findings.map((f) => f.code).filter((x) => x !== 'repoMissing').sort(), ['noPublisher', 'resourceDetected', 'resourcePlanned']);
  assert.deepEqual([r.stats.resources, r.stats.stack], [2, 1]);
});

test('cada nivel muestra lo suyo: la empresa, un área, un proyecto y un repositorio', () => {
  const c = company();
  const g = architecture(c.store, { areaName: (a) => a.name || 'General' });
  // la empresa: un carril por área, una caja por proyecto, entre proyectos lo que usan sus repos; la infraestructura abajo
  const all = archView(g);
  assert.deepEqual(all.lanes.map((l) => [l.kind, l.label]), [['area', 'General'], ['area', 'Tecnología'], ['infra', 'Infrastructure']]);
  assert.deepEqual(all.nodes.filter((n) => n.type === 'project').map((n) => n.label).sort(), ['Pagos', 'Plataforma', 'main']);
  assert.ok(all.edges.some((e) => e.from === `project:${c.pagos.id}` && e.to === `project:${c.plataforma.id}` && e.kind === 'uses'), 'Pagos usa algo de Plataforma');
  assert.ok(all.nodes.some((n) => n.label === 'ledger'), 'la infraestructura declarada está aunque nadie la use');
  // un área: un carril por proyecto con sus repos
  const area = archView(g, { type: 'area', id: c.tec.id });
  assert.deepEqual(area.lanes.filter((l) => l.kind === 'project').map((l) => l.label), ['Pagos', 'Plataforma']);
  assert.deepEqual(area.nodes.filter((n) => n.type === 'repo').map((n) => n.label).sort(), ['backoffice', 'pagos-bff', 'pagos-core', 'pagos-web']);
  // un proyecto: sus repos con su turno, y el core de Plataforma (compartido) de fuera
  const project = archView(g, { type: 'project', id: c.pagos.id });
  assert.deepEqual(project.nodes.filter((n) => n.n).sort((a, b) => a.n - b.n).map((n) => [n.label, n.state]), [['pagos-core', 'external'], ['pagos-bff', 'own'], ['pagos-web', 'own']]);
  assert.ok(project.edges.some((e) => e.from === `repo:${c.web.id}` && e.to === `repo:${c.bff.id}` && e.kind === 'uses'));
  assert.ok(project.edges.some((e) => e.from === `repo:${c.core.id}` && e.kind === 'link' && e.label === 'publishes'), 'la infraestructura del core que usa');
  // un repositorio: él, lo que usa y lo que lo usa, de fuera
  const core = archView(g, { type: 'repo', id: c.core.id });
  assert.equal(core.lanes[0].kind, 'self');
  assert.deepEqual(core.nodes.filter((n) => n.state === 'external').map((n) => n.label).sort(), ['backoffice', 'pagos-bff']);
  // por dónde se llega, y a dónde lleva cada nodo
  assert.deepEqual(archCrumbs(g, { type: 'repo', id: c.bff.id }).map((x) => x.name || x.type), ['company', 'Tecnología', 'Pagos', 'pagos-bff']);
  assert.deepEqual(scopeOf(g.nodes.find((n) => n.type === 'area' && n.key === c.tec.id)), { type: 'area', id: c.tec.id });
  assert.equal(scopeOf(g.nodes.find((n) => n.type === 'resource')), null);
  c.store.close();
});

test('la tecnología de cada repo sólo se ve si se pide (stack)', () => {
  const departments = [{ id: 'a', name: 'A', area: 'g', projects: [{ id: 'x', name: 'x', path: '/nada/x', kind: 'backend' }] }];
  const g = buildArchitecture({ areas: [{ id: 'g', name: 'G' }], departments, resources: [{ key: 'tech:Postgres', name: 'Postgres', kind: 'database', tech: 'Postgres', source: 'detected', techOnly: true, projects: [{ id: 'x', name: 'x', how: 'uses' }] }] });
  assert.equal(archView(g).nodes.some((n) => n.type === 'resource'), false);
  const v = archView(g, { type: 'repo', id: 'x' }, { stack: true });
  assert.equal(v.nodes.find((n) => n.type === 'resource').state, 'detected');
});

test('el dibujo: carriles sin pisarse, el que usa a la izquierda de lo que usa, y nada encima de nada', () => {
  const c = company();
  const g = architecture(c.store);
  for (const scope of [{ type: 'company' }, { type: 'area', id: c.tec.id }, { type: 'project', id: c.pagos.id }, { type: 'project', id: c.plataforma.id }, { type: 'repo', id: c.core.id }]) {
    const l = layoutArch(archView(g, scope, { stack: true }));
    const at = new Map(l.nodes.map((n) => [n.id, n]));
    for (const n of l.nodes) {
      const lane = l.lanes.find((x) => x.id === n.lane);
      assert.ok(n.y >= lane.y && n.y + n.h <= lane.y + lane.h, `${n.label} cabe en su carril (${scope.type})`);
      assert.ok(n.x >= 0 && n.x + n.w <= l.width, `${n.label} cabe a lo ancho`);
    }
    for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i], b = l.nodes[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.label} y ${b.label} no se pisan (${scope.type})`);
    }
    for (let i = 1; i < l.lanes.length; i++) assert.ok(l.lanes[i].y >= l.lanes[i - 1].y + l.lanes[i - 1].h);
    for (const e of l.edges) {
      assert.match(e.d, /^M[\d.-]+ [\d.-]+ C/);
      if (e.kind === 'uses') assert.ok(at.get(e.from).x < at.get(e.to).x, `${e.from} queda a la izquierda de ${e.to}`);
    }
    assert.ok(l.height > 0 && l.width > 0);
  }
  // un ciclo no cuelga el dibujo
  const loop = layoutArch({ scope: {}, lanes: [{ id: 'l', label: 'L', kind: 'project' }], nodes: [{ id: 'a', label: 'a', lane: 'l' }, { id: 'b', label: 'b', lane: 'l' }], edges: [{ from: 'a', to: 'b', kind: 'uses', label: '' }, { from: 'b', to: 'a', kind: 'uses', label: '' }] });
  assert.equal(loop.nodes.length, 2);
  // una empresa sin repos: no revienta
  const none = layoutArch(archView(buildArchitecture({ areas: [{ id: 'g', name: 'G' }], departments: [{ id: 'main', name: 'main', area: 'g', projects: [] }] })));
  assert.equal(none.nodes.length, 1);
  c.store.close();
});

test('los vecinos de un nodo: qué usa, quién lo usa (cerca y lejos), cómo, su infraestructura, su proyecto y su área', () => {
  const c = company();
  const g = architecture(c.store);
  const core = archNeighbors(g, `repo:${c.core.id}`);
  assert.deepEqual(core.usedBy.map((x) => [x.node.name, x.how, x.note]).sort(), [['backoffice', 'reads', 'los reportes'], ['pagos-bff', 'calls', '']]);
  assert.deepEqual(core.reach.map((n) => n.name).sort(), ['backoffice', 'pagos-bff', 'pagos-web'], 'un cambio en el core llega hasta la web');
  assert.deepEqual(core.infra.map((x) => `${x.how} ${x.node.name}`), ['publishes cobros', 'uses Redis'], 'la cola declarada y el Redis de su carpeta');
  assert.deepEqual([core.project.name, core.area.name], ['Plataforma', 'Tecnología']);
  assert.deepEqual(core.projects.map((p) => p.name).sort(), ['Pagos', 'Plataforma']);
  const web = archNeighbors(g, `repo:${c.web.id}`);
  assert.deepEqual(web.uses.map((x) => [x.node.name, x.note]), [['pagos-bff', 'la pantalla de pagos']]);
  assert.deepEqual(web.usedBy, []);
  const pagos = archNeighbors(g, `project:${c.pagos.id}`);
  assert.deepEqual(pagos.repos.map((x) => [x.node.name, !!x.shared]), [['pagos-core', true], ['pagos-bff', false], ['pagos-web', false]]);
  const area = archNeighbors(g, `area:${c.tec.id}`);
  assert.deepEqual(area.projects.map((p) => p.name), ['Pagos', 'Plataforma']);
  const cola = archNeighbors(g, `res:${c.cola.id}`);
  assert.deepEqual(cola.users.map((x) => `${x.node.name} ${x.how}`), ['pagos-core publishes']);
  assert.equal(archNeighbors(g, 'no-existe').node, null);
  c.store.close();
});

test('explorar las carpetas: cómo se relacionan los repos según su código, sin modelo', () => {
  const c = company();
  try {
    const agents = c.store.listAgents();
    const found = inferRelations(agents);
    const by = (from, to) => found.find((r) => r.from === from.id && r.to === to.id);
    // el bff llama a la dirección en la que escucha el core (localhost:3000)
    assert.deepEqual([by(c.bff, c.core).how, by(c.bff, c.core).evidence], ['calls', '.env.example:1 CORE_URL=http://localhost:3000']);
    // la web, a una variable con el nombre del bff
    assert.match(by(c.web, c.bff).evidence, /PAGOS_BFF_URL/);
    // una cola en la que uno publica y otro consume los relaciona
    const res = [{ kind: 'queue', name: 'cobros', projects: [{ id: c.core.id, how: 'publishes' }, { id: c.admin.id, how: 'consumes' }] }];
    assert.deepEqual(inferRelations(agents, { resources: res }).find((r) => r.from === c.admin.id).how, 'consumes');
    // un paquete de otro repo
    const lib = repo('ui-kit', { name: '@acme/ui', main: 'index.js' });
    const app = repo('app', { name: 'app', dependencies: { '@acme/ui': '1' } });
    assert.deepEqual(inferRelations([{ id: 'lib', name: 'ui-kit', path: lib }, { id: 'app', name: 'app', path: app }]).map((r) => [r.from, r.to, r.how]), [['app', 'lib', 'uses']]);
    // y lo que hace un repo con su Redis: dónde está, cómo y para qué
    const x = explainInfra(c.core.path, 'Redis');
    assert.ok(x.where.some((w) => w.value === 'redis://cache.internal:6379'));
    assert.ok(x.how.some((h) => /src\/server\.js:1 import Redis from 'ioredis'/.test(h.evidence)));
    assert.deepEqual(x.purpose, ['cache']);
    assert.deepEqual(explainInfra(c.core.path, 'Kubernetes').how, [], 'lo que no conoce no lo inventa');
  } finally { c.store.close(); }
});

test('por la API: el mapa, relacionar, explorar (encontradas punteadas; las tuyas quedan) y explicar un recurso', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const core = (await call('POST', '/v1/agents', { path: repo('core', { name: 'core', dependencies: { express: '4' } }, { 'src/index.js': 'app.listen(4000);\n' }), harness: 'claude-code', bin: '/nonexistent/claude' })).agent;
    const bff = (await call('POST', '/v1/agents', { path: repo('bff', { name: 'bff' }, { '.env': 'CORE_URL=http://localhost:4000\n' }), harness: 'claude-code', bin: '/nonexistent/claude' })).agent;
    const web = (await call('POST', '/v1/agents', { path: repo('web', { name: 'web' }), harness: 'claude-code', bin: '/nonexistent/claude' })).agent;
    // yours: the web calls the bff
    assert.equal((await call('POST', '/v1/relations', { from: web.id, to: bff.id, how: 'calls', note: 'checkout' })).status, 201);
    // exploring finds the bff → core, and leaves yours as they are
    const ex = await call('POST', '/v1/relations/explore', {});
    assert.deepEqual(ex.added.map((r) => [r.from, r.to, r.source]), [[bff.id, core.id, 'found']]);
    assert.equal((await call('POST', '/v1/relations/explore', {})).added.length, 0, 'otra vez: nada nuevo');
    const g = await call('GET', '/v1/architecture');
    assert.deepEqual(g.edges.filter((e) => e.kind === 'uses').map((e) => [e.from, e.source]).sort(), [[`repo:${bff.id}`, 'found'], [`repo:${web.id}`, 'you']]);
    assert.ok(g.findings.some((f) => f.code === 'relationFound'));
    // confirming it (the panel's ✓: declaring the same pair) makes it yours, and exploring again does not undo it
    const confirmed = await call('POST', '/v1/relations', { from: bff.id, to: core.id, how: 'calls' });
    assert.deepEqual([confirmed.status, confirmed.relation.source], [200, 'you']);
    await call('POST', '/v1/relations/explore', {});
    assert.equal(server.store.listRelations().find((r) => r.from === bff.id).source, 'you');
    // what a repository does with a technology: by its id
    assert.equal((await call('GET', `/v1/resources/explain?repo=${core.id}&tech=Redis`)).ok, true);
    assert.equal((await call('GET', '/v1/resources/explain?repo=nadie&tech=Redis')).status, 404);
  } finally { await server.close(); }
});

test('las relaciones que confirmas quedan como tuyas; las encontradas no pisan las tuyas', () => {
  const c = company();
  try {
    const found = c.store.saveRelation({ from: c.admin.id, to: c.bff.id, how: 'calls', source: 'found', evidence: 'x' });
    assert.equal(found.relation.source, 'found');
    assert.equal(c.store.saveRelation({ from: c.admin.id, to: c.bff.id, how: 'calls', source: 'you', confirm: true }).relation.source, 'you', 'confirmar');
    assert.equal(c.store.saveRelation({ from: c.admin.id, to: c.bff.id, how: 'reads', source: 'found' }).relation.source, 'you', 'explorar otra vez no la vuelve encontrada');
  } finally { c.store.close(); }
});

test('en palabras (para un agente) y por la API', async () => {
  const c = company();
  const text = architectureText(architecture(c.store, { areaName: (a) => a.name || 'General' }));
  assert.match(text, /^Company: 2 area\(s\), 3 project\(s\), 5 repositories, 3 relation\(s\) between them, 2 infrastructure resource\(s\)\./);
  assert.match(text, /\nArea "Tecnología"\n {2}Project "Pagos" \(pagos\): a change goes pagos-core → pagos-bff → pagos-web/);
  assert.match(text, /- repository pagos-web \[frontend\] .*\n {8}uses pagos-bff \(calls: la pantalla de pagos\)/);
  assert.match(text, /- repository pagos-core \[backend\] .* \(of the project Plataforma, shared\)/);
  assert.match(text, /- queue "cobros" \(SQS\): pagos-core publishes/);
  assert.match(text, /\[warn\] noConsumer: cobros/);
  c.store.close();

  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const a = (await call('POST', '/v1/agents', { path: repo('tienda-api', { dependencies: { express: '4' } }), harness: 'claude-code', name: 'tienda-api', bin: '/nonexistent/claude' })).agent;
    assert.equal((await call('POST', '/v1/resources', { kind: 'database', name: 'pedidos', tech: 'Postgres', addLinks: [{ project: a.id, how: 'writes' }] })).status, 201);
    const g = await call('GET', '/v1/architecture');
    assert.equal(g.status, 200);
    assert.equal(g.stats.repos, 1);
    assert.ok(g.edges.some((e) => e.kind === 'link' && e.from === `repo:${a.id}` && e.how === 'writes'));
    assert.deepEqual(g.nodes.filter((n) => n.type === 'area').map((n) => n.name), ['General']);
    assert.equal(g.nodes.find((n) => n.type === 'project').name, server.company.info('main').name);
  } finally { await server.close(); }
});

test('el MCP: get_architecture, también con la oficina apagada', async () => {
  const { createMcp } = await import('../server/mcp.js');
  const dir = tmp();
  const db = path.join(dir, 'office.db');
  company(db).store.close();
  const mcp = createMcp({ base: 'http://127.0.0.1:9', socket: null, cwd: dir, openStore: () => openStore(db), env: {} });
  try {
    const r = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_architecture', arguments: {} } });
    assert.match(r.result.content[0].text, /^Company: 2 area\(s\), 3 project\(s\), 5 repositories/);
    assert.match(r.result.content[0].text, /Area "General"\n {2}Project "Main office"/);
  } finally { mcp.close(); }
});

test('la CLI: dev-team-office architecture en tu idioma (sin la oficina corriendo), y --json el grafo', async () => {
  const { spawnSync } = await import('node:child_process');
  const home = tmp();
  const file = path.join(home, 'office.db');
  company(file).store.close();
  const env = { PATH: process.env.PATH, HOME: home, DEV_TEAM_OFFICE_LANG: 'es', DEV_TEAM_OFFICE_DB: file, DEV_TEAM_OFFICE_PORT: '1', DEV_TEAM_OFFICE_SOCKET: path.join(home, 'none.sock'), DEV_TEAM_OFFICE_WEATHER: 'off' };
  const cli = (...args) => spawnSync(process.execPath, [new URL('../bin/dev-team-office.js', import.meta.url).pathname, ...args], { env, encoding: 'utf8', timeout: 20000 });
  try {
    const r = cli('architecture');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Empresa: 2 área\(s\), 3 proyecto\(s\), 5 repositorios, 3 relación\(es\) entre ellos, 2 recurso\(s\) de infraestructura\./);
    assert.match(r.stdout, /Área «General»\n {2}Proyecto «Oficina principal» \(main\)/);
    assert.match(r.stdout, /Proyecto «Pagos» \(pagos\): un cambio va pagos-core → pagos-bff → pagos-web/);
    assert.match(r.stdout, /usa pagos-bff \(llama a su API: la pantalla de pagos\)/);
    assert.match(r.stdout, /- queue "cobros" \(SQS\): pagos-core publica/);
    // the review, said in words (not its codes)
    assert.match(r.stdout, /Revisión\n {2}- \[warn\] /);
    assert.doesNotMatch(r.stdout, /noConsumer/);
    assert.equal(cli('map').stdout, r.stdout, 'map es lo mismo');
    const g = JSON.parse(cli('architecture', '--json').stdout);
    assert.equal(g.stats.repos, 5);
    assert.ok(g.findings.some((f) => f.code === 'noConsumer'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('una base de una versión anterior: sus sistemas pasan a ser proyectos y relaciones, sin perder nada', () => {
  const store = openStore(':memory:');
  try {
    // the department "Software Factory" answered for two systems; "Pagos" for one with its own name
    const sf = store.createOffice({ name: 'Software Factory', instructions: 'Revisión de código obligatoria.' }).office;
    const pagos = store.createOffice({ name: 'Pagos' }).office;
    store.setAppearance({ qa: { name: 'Pilar' } }, sf.id);
    const add = (name, office) => store.createAgent({ path: repo(name, { name }), harness: 'claude-code', name, office: office.id, bin: '/nonexistent/claude' }).agent;
    const lcore = add('loyalty-core', sf), lweb = add('loyalty-web', sf), tcore = add('tickets-core', sf), pcore = add('pagos-core', pagos);
    const now = Date.now();
    const insert = store.db.prepare('INSERT INTO systems (id, name, office_id, instructions, parts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('s1', 'Loyalty', sf.id, 'Los puntos nunca bajan de cero.', JSON.stringify([{ name: 'web', project: lweb.path, kind: 'frontend', uses: ['core'] }, { name: 'core', project: lcore.path, kind: 'backend', uses: ['pagos'] }, { name: 'pagos', project: pcore.path, kind: 'backend', uses: [] }]), now, now);
    insert.run('s2', 'Tickets', sf.id, '', JSON.stringify([{ name: 'core', project: tcore.path, kind: 'worker', uses: [] }]), now, now);
    insert.run('s3', 'Pagos', pagos.id, 'Montos en centavos.', JSON.stringify([{ name: 'core', project: pcore.path, kind: 'backend' }]), now, now);
    store.migrateSystems();
    // Software Factory became an area with a project per system (its people go with each), and the empty office left
    const area = store.findArea('Software Factory');
    assert.equal(area.instructions, 'Revisión de código obligatoria.');
    const loyalty = store.findOffice('Loyalty'), tickets = store.findOffice('Tickets');
    assert.deepEqual([loyalty.area, tickets.area], [area.id, area.id]);
    assert.equal(loyalty.instructions, 'Los puntos nunca bajan de cero.');
    assert.deepEqual(store.getAppearance(loyalty.id), { qa: { name: 'Pilar' } });
    assert.equal(store.getOffice(sf.id), null);
    // each repository with its project, its kind and what it used
    const of = (a) => store.getAgent(a.id);
    assert.deepEqual([of(lcore).office, of(lweb).office, of(tcore).office, of(pcore).office], [loyalty.id, loyalty.id, tickets.id, pagos.id]);
    assert.deepEqual([of(lweb).kind, of(tcore).kind], ['frontend', 'worker']);
    assert.deepEqual(store.listRelations().map((r) => [r.from, r.to]), [[lweb.id, lcore.id], [lcore.id, pcore.id]]);
    // Pagos had a system of its own name: it stays the project, in the general area, with the instructions
    assert.deepEqual([store.getOffice(pagos.id).area, store.getOffice(pagos.id).instructions], ['general', 'Montos en centavos.']);
    // the order of Loyalty: the core of Pagos it uses goes first
    assert.deepEqual(store.getSystem(loyalty.id).parts.map((p) => [p.name, !!p.shared]), [['loyalty-core', false], ['loyalty-web', false], ['pagos-core', true]]);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM systems').get().n, 0, 'una sola vez');
  } finally { store.close(); }
});
