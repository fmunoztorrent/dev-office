// The company's architecture (server/architecture.js, public/architecture.js): the whole map as one graph
// (departments, projects, repositories, components and infrastructure, with what uses what), its review,
// what each level shows of it (company, department, project, repository) and how it is laid out.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { architecture, architectureText, buildArchitecture } from '../server/architecture.js';
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
 * A company: Pagos (bff + web) and Plataforma (the core, shared with Pagos, and a monorepo with two
 * components), a project "Pagos" (web → bff → core), a queue the core publishes to and nobody consumes,
 * and a database nobody is linked to.
 */
function company(db = ':memory:') {
  const store = openStore(db);
  const pagos = store.createOffice({ name: 'Pagos' }).office;
  const plataforma = store.createOffice({ name: 'Plataforma' }).office;
  const add = (name, office, pkg, extra) => store.createAgent({ path: repo(name, pkg, extra), harness: 'claude-code', name, office: office.id, bin: '/nonexistent/claude' }).agent;
  const core = add('pagos-core', plataforma, { name: 'pagos-core', dependencies: { express: '4' } });
  const bff = add('pagos-bff', pagos, { name: 'pagos-bff', dependencies: { fastify: '4' } });
  const web = add('pagos-web', pagos, { name: 'pagos-web', dependencies: { next: '15' } });
  const mono = add('plataforma', plataforma, { name: 'plataforma', workspaces: ['apps/*'] }, { 'apps/admin/package.json': '{"name":"admin","dependencies":{"next":"15"}}', 'apps/jobs/package.json': '{"name":"jobs","dependencies":{"bullmq":"5"}}' });
  const suelto = add('landing', pagos, { name: 'landing' });
  const sys = store.saveSystem({ name: 'Pagos', office: pagos.id, parts: [
    { name: 'web', project: web.id, kind: 'frontend', uses: ['bff'] },
    { name: 'bff', project: bff.id, kind: 'bff', uses: ['core'] },
    { name: 'core', project: core.id, kind: 'backend' },
  ] }).system;
  const admin = store.saveSystem({ name: 'Backoffice', office: plataforma.id, parts: [
    { name: 'admin', project: mono.id, component: 'admin', path: 'apps/admin', kind: 'frontend', uses: ['jobs', 'core'] },
    { name: 'jobs', project: mono.id, component: 'jobs', path: 'apps/jobs', kind: 'worker' },
    { name: 'core', project: core.id, kind: 'backend' },
  ] }).system;
  const cola = store.saveResource({ kind: 'queue', name: 'cobros', tech: 'SQS', links: [{ project: core.path, how: 'publishes' }] }).resource;
  const base = store.saveResource({ kind: 'database', name: 'ledger', tech: 'Postgres' }).resource;
  return { store, pagos, plataforma, core, bff, web, mono, suelto, sys, admin, cola, base };
}

test('el grafo: departamentos, repos, componentes, proyectos e infraestructura, con quién usa qué', () => {
  const c = company();
  const g = architecture(c.store);
  const of = (type) => g.nodes.filter((n) => n.type === type);
  assert.deepEqual(of('dept').map((n) => n.name).sort(), ['Pagos', 'Plataforma', 'main'].sort());
  assert.equal(of('repo').length, 5);
  assert.deepEqual(of('component').map((n) => n.name).sort(), ['admin', 'jobs']);
  assert.equal(of('system').length, 2);
  // el core es de Plataforma y es artefacto de un proyecto de Pagos: compartido
  const core = g.nodes.find((n) => n.id === `repo:${c.core.id}`);
  assert.equal(core.shared, true);
  assert.deepEqual(core.systems.sort(), [c.sys.id, c.admin.id].sort());
  assert.equal(core.dept, c.plataforma.id);
  // quién usa a quién: entre repos, y entre componentes de un monorepo
  const uses = g.edges.filter((e) => e.kind === 'uses').map((e) => `${e.from} → ${e.to}`);
  assert.ok(uses.includes(`repo:${c.web.id} → repo:${c.bff.id}`));
  assert.ok(uses.includes(`repo:${c.bff.id} → repo:${c.core.id}`));
  assert.ok(uses.includes(`comp:${c.mono.id}:apps/admin → comp:${c.mono.id}:apps/jobs`));
  assert.ok(uses.includes(`comp:${c.mono.id}:apps/admin → repo:${c.core.id}`));
  // el orden en que va un cambio en el proyecto
  assert.deepEqual(g.nodes.find((n) => n.id === `sys:${c.sys.id}`).order, ['core', 'bff', 'web']);
  // la infraestructura y cómo la usa cada repo
  assert.deepEqual(g.edges.filter((e) => e.kind === 'link' && e.to === `res:${c.cola.id}`).map((e) => [e.from, e.how]), [[`repo:${c.core.id}`, 'publishes']]);
  assert.equal(g.stats.repos, 5);
  assert.equal(g.stats.systems, 2);
  assert.equal(g.stats.resources, 2);
  c.store.close();
});

test('la revisión: lo que merece una mirada, lo grave primero', () => {
  const c = company();
  fs.rmSync(c.suelto.path, { recursive: true });
  const g = architecture(c.store);
  const codes = g.findings.map((f) => f.code);
  const find = (code) => g.findings.find((f) => f.code === code);
  assert.equal(find('noConsumer').node, `res:${c.cola.id}`, 'una cola en la que se publica y nadie consume');
  assert.equal(find('resourceUnused').vars.name, 'ledger', 'una base que nadie usa');
  assert.equal(find('repoMissing').node, `repo:${c.suelto.id}`, 'un repo cuya carpeta ya no está');
  assert.equal(find('repoNoProject').vars.name, 'landing', 'un repo que no es de ningún proyecto');
  assert.equal(find('sharedRepo').vars.name, 'pagos-core');
  assert.equal(find('emptyDept').vars.name, 'main');
  assert.ok(!codes.includes('noProjects'));
  // primero los avisos, después las notas
  const levels = g.findings.map((f) => f.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === 'warn' ? 0 : 1) - (b === 'warn' ? 0 : 1)));
  c.store.close();
});

test('la revisión, sin base de datos: un artefacto sin repo, un ciclo y repos sin ningún proyecto', () => {
  const departments = [{ id: 'a', name: 'A', projects: [{ id: 'x', name: 'x', path: '/nada/x', kind: 'backend', components: [] }, { id: 'y', name: 'y', path: '/nada/y', kind: 'frontend', components: [] }] }];
  const lone = buildArchitecture({ departments });
  assert.deepEqual(lone.findings.map((f) => f.code), ['noProjects']);
  const g = buildArchitecture({ departments, systems: [{ id: 's', name: 'S', office: 'a', parts: [{ name: 'x', project: '/nada/x', kind: 'backend', uses: ['z'] }, { name: 'z', project: '/nada/no-esta', kind: 'backend', uses: ['x'] }] }] });
  const codes = g.findings.map((f) => f.code);
  assert.ok(codes.includes('partNoRepo'));
  assert.ok(codes.includes('systemOrder'), 'x usa a z y z usa a x');
  assert.equal(g.nodes.find((n) => n.id === 'sys:s').parts.find((p) => p.name === 'z').missing, true);
  // una cola que se consume y en la que nadie publica; una detectada con nombre, por declarar
  const r = buildArchitecture({ departments, resources: [
    { id: 'r1', key: 'queue:pedidos', name: 'pedidos', kind: 'queue', source: 'declared', state: 'planned', projects: [{ id: 'x', name: 'x', how: 'consumes' }] },
    { key: 'queue:eventos', name: 'eventos', kind: 'queue', source: 'detected', projects: [{ id: 'y', name: 'y', how: 'owns' }] },
    { key: 'tech:Postgres', name: 'Postgres', kind: 'database', tech: 'Postgres', source: 'detected', techOnly: true, projects: [{ id: 'x', name: 'x', how: 'uses' }] },
  ] });
  assert.deepEqual(r.findings.map((f) => f.code).sort(), ['noProjects', 'noPublisher', 'resourceDetected', 'resourcePlanned']);
  assert.equal(r.stats.resources, 2);
  assert.equal(r.stats.stack, 1);
});

test('cada nivel muestra lo suyo: la empresa, un departamento, un proyecto y un repositorio', () => {
  const c = company();
  const g = architecture(c.store);
  // la empresa: un carril por departamento y, abajo, la infraestructura; los componentes van en su repo
  const all = archView(g);
  assert.deepEqual(all.lanes.map((l) => l.kind), ['dept', 'dept', 'dept', 'infra']);
  assert.equal(all.nodes.filter((n) => n.type === 'repo').length, 5);
  assert.equal(all.nodes.filter((n) => n.type === 'component').length, 0);
  assert.ok(all.edges.some((e) => e.from === `repo:${c.mono.id}` && e.to === `repo:${c.core.id}` && e.label === 'Backoffice'), 'lo que usa un componente sube a su repo');
  assert.ok(all.nodes.some((n) => n.label === 'ledger'), 'la infraestructura declarada está aunque nadie la use');
  // un departamento: sus repos, y de fuera sólo lo que usan o los usa
  const dept = archView(g, { type: 'dept', id: c.pagos.id });
  assert.deepEqual(dept.nodes.filter((n) => n.state === 'own').map((n) => n.label).sort(), ['landing', 'pagos-bff', 'pagos-web']);
  assert.deepEqual(dept.nodes.filter((n) => n.state === 'external').map((n) => n.label), ['pagos-core']);
  assert.equal(dept.lanes[0].own, true);
  assert.ok(!dept.nodes.some((n) => n.label === 'cobros'), 'la cola es del core, que aquí es de fuera');
  // un proyecto: sus artefactos, con su turno, y la infraestructura de sus repos
  const sys = archView(g, { type: 'system', id: c.sys.id });
  assert.deepEqual(sys.nodes.filter((n) => n.n).sort((a, b) => a.n - b.n).map((n) => n.label), ['core', 'bff', 'web']);
  assert.equal(sys.nodes.find((n) => n.label === 'core').shared, true);
  assert.ok(sys.edges.some((e) => e.from === 'part:web' && e.to === 'part:bff' && e.kind === 'uses'));
  assert.ok(sys.edges.some((e) => e.from === 'part:core' && e.kind === 'link' && e.label === 'publishes'));
  // un repositorio: él, sus componentes, y los otros repos enteros
  const mono = archView(g, { type: 'repo', id: c.mono.id });
  assert.equal(mono.lanes[0].kind, 'self');
  assert.deepEqual(mono.nodes.filter((n) => n.type === 'component').map((n) => n.label).sort(), ['admin', 'jobs']);
  assert.ok(mono.edges.some((e) => e.from.endsWith('apps/admin') && e.to.endsWith('apps/jobs')));
  assert.ok(mono.edges.some((e) => e.from.endsWith('apps/admin') && e.to === `repo:${c.core.id}`));
  assert.equal(mono.nodes.find((n) => n.id === `repo:${c.core.id}`).state, 'external');
  // por dónde se llega, y a dónde lleva cada nodo
  assert.deepEqual(archCrumbs(g, { type: 'repo', id: c.mono.id }).map((x) => x.name || x.type), ['company', 'Plataforma', 'plataforma']);
  assert.deepEqual(scopeOf(g.nodes.find((n) => n.name === 'admin')), { type: 'repo', id: c.mono.id });
  assert.equal(scopeOf(g.nodes.find((n) => n.type === 'resource')), null);
  c.store.close();
});

test('la tecnología de cada repo sólo se ve si se pide (stack)', () => {
  const departments = [{ id: 'a', name: 'A', projects: [{ id: 'x', name: 'x', path: '/nada/x', kind: 'backend', components: [] }] }];
  const g = buildArchitecture({ departments, resources: [{ key: 'tech:Postgres', name: 'Postgres', kind: 'database', tech: 'Postgres', source: 'detected', techOnly: true, projects: [{ id: 'x', name: 'x', how: 'uses' }] }] });
  assert.equal(archView(g).nodes.some((n) => n.type === 'resource'), false);
  const v = archView(g, { type: 'repo', id: 'x' }, { stack: true });
  assert.equal(v.nodes.find((n) => n.type === 'resource').state, 'detected');
});

test('el dibujo: carriles sin pisarse, el que usa a la izquierda de lo que usa, y nada encima de nada', () => {
  const c = company();
  const g = architecture(c.store);
  for (const scope of [{ type: 'company' }, { type: 'dept', id: c.pagos.id }, { type: 'system', id: c.sys.id }, { type: 'system', id: c.admin.id }, { type: 'repo', id: c.mono.id }]) {
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
  const loop = layoutArch({ scope: {}, lanes: [{ id: 'l', label: 'L', kind: 'dept' }], nodes: [{ id: 'a', label: 'a', lane: 'l' }, { id: 'b', label: 'b', lane: 'l' }], edges: [{ from: 'a', to: 'b', kind: 'uses', label: '' }, { from: 'b', to: 'a', kind: 'uses', label: '' }] });
  assert.equal(loop.nodes.length, 2);
  // una empresa sin nada: un carril vacío, y no revienta
  const none = layoutArch(archView(buildArchitecture({ departments: [{ id: 'main', name: 'main', projects: [] }] })));
  assert.equal(none.lanes[0].empty, true);
  c.store.close();
});

test('los vecinos de un nodo: qué usa, quién lo usa (cerca y lejos), su infraestructura y sus proyectos', () => {
  const c = company();
  const g = architecture(c.store);
  const core = archNeighbors(g, `repo:${c.core.id}`);
  assert.deepEqual(core.usedBy.map((n) => n.name).sort(), ['pagos-bff', 'plataforma']);
  assert.deepEqual(core.reach.map((n) => n.name).sort(), ['pagos-bff', 'pagos-web', 'plataforma'], 'un cambio en el core llega hasta la web');
  assert.deepEqual(core.infra.map((x) => `${x.how} ${x.node.name}`), ['publishes cobros']);
  assert.deepEqual(core.systems.map((s) => s.name).sort(), ['Backoffice', 'Pagos']);
  assert.equal(core.dept.name, 'Plataforma');
  const web = archNeighbors(g, `repo:${c.web.id}`);
  assert.deepEqual(web.uses.map((n) => n.name), ['pagos-bff']);
  assert.deepEqual(web.usedBy, []);
  const mono = archNeighbors(g, `repo:${c.mono.id}`);
  assert.deepEqual(mono.components.map((n) => n.name).sort(), ['admin', 'jobs']);
  assert.deepEqual(mono.uses.map((n) => n.name), ['pagos-core'], 'lo que usan sus componentes, sin contarse a sí mismo');
  const admin = archNeighbors(g, `comp:${c.mono.id}:apps/admin`);
  assert.deepEqual(admin.uses.map((n) => n.name).sort(), ['jobs', 'pagos-core']);
  assert.equal(admin.repo.name, 'plataforma');
  const cola = archNeighbors(g, `res:${c.cola.id}`);
  assert.deepEqual(cola.users.map((x) => `${x.node.name} ${x.how}`), ['pagos-core publishes']);
  const dept = archNeighbors(g, `dept:${c.pagos.id}`);
  assert.deepEqual(dept.repos.map((n) => n.name).sort(), ['landing', 'pagos-bff', 'pagos-web']);
  assert.deepEqual(dept.systems.map((s) => s.name), ['Pagos']);
  assert.equal(archNeighbors(g, 'no-existe').node, null);
  c.store.close();
});

test('en palabras (para un agente) y por la API', async () => {
  const c = company();
  const text = architectureText(architecture(c.store));
  assert.match(text, /^Company: 3 department\(s\), 5 repositories, 2 component\(s\), 2 project\(s\), 2 infrastructure resource\(s\)\./);
  assert.match(text, /Project "Pagos" \(department Pagos\): a change goes core → bff → web/);
  assert.match(text, /- repository pagos-core \[backend\] .* \(shared with projects of other departments\)\n {6}infrastructure: publishes cobros/);
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
    assert.equal(g.nodes.find((n) => n.type === 'dept').name, server.company.info('main').name);
  } finally { await server.close(); }
});

test('el MCP: get_architecture, también con la oficina apagada', async () => {
  const { createMcp } = await import('../server/mcp.js');
  const dir = tmp();
  const db = path.join(dir, 'office.db');
  const store = openStore(db);
  const core = store.createAgent({ path: repo('ventas-core', { dependencies: { express: '4' } }), harness: 'claude-code', name: 'ventas-core', bin: '/nonexistent/claude' }).agent;
  const web = store.createAgent({ path: repo('ventas-web', { dependencies: { next: '15' } }), harness: 'pi', name: 'ventas-web', bin: '/nonexistent/pi' }).agent;
  store.saveSystem({ name: 'Ventas', parts: [{ name: 'web', project: web.id, kind: 'frontend', uses: ['core'] }, { name: 'core', project: core.id, kind: 'backend' }] });
  store.close();
  const mcp = createMcp({ base: 'http://127.0.0.1:9', socket: null, cwd: core.path, openStore: () => openStore(db), env: {} });
  const out = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_architecture', arguments: {} } })).result;
  assert.match(out.content[0].text, /Project "Ventas".*: a change goes core → web\n {2}- web \[frontend\] = ventas-web, uses core/);
  assert.match(out.content[0].text, /^Company: 1 department\(s\), 2 repositories/);
  mcp.close();
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
    assert.match(r.stdout, /^Empresa: 3 departamento\(s\), 5 repositorios, 2 componente\(s\), 2 proyecto\(s\), 2 recurso\(s\) de infraestructura\./);
    assert.match(r.stdout, /Proyecto «Pagos» \(departamento Pagos\): un cambio va core → bff → web/);
    assert.match(r.stdout, /infraestructura: publica cobros/);
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
