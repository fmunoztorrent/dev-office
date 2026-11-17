// The infrastructure on the map (server/resources.js) and an order's impact with it: what each repo's
// folder says it uses, what an order names (queues, topics, tables, buckets, crons, third-party APIs),
// what is asked when it is not on the map, and how each answer lands (a planned queue, a separate repo,
// a new repo created empty, a URL noted), with the lines each brief carries.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openStore } from '../server/store.js';
import { DirectiveDesk } from '../server/directives.js';
import { startServer } from '../server/server.js';
import { detectInfra, namedInfra, knownResources, findResource } from '../server/resources.js';
import { mapImpact, companyMap, briefLines } from '../server/components.js';
import { exportSettings, importSettings } from '../server/settings-io.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-infra-')));
const write = (root, file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data)); return root; };

test('lo que usa un repo sale de su carpeta: dependencias, docker-compose y lo que su Terraform declara con nombre', () => {
  const node = write(tmp(), 'package.json', { dependencies: { kafkajs: '2', pg: '8', express: '4' }, devDependencies: { stripe: '14' } });
  write(node, 'docker-compose.yml', 'services:\n  cache:\n    image: redis:7-alpine\n  db:\n    image: "postgres:16"\n');
  write(node, 'infra/main.tf', 'resource "aws_sqs_queue" "refunds" {\n  name = "refunds-dlq"\n}\nresource "aws_s3_bucket" "invoices" {}\nresource "aws_iam_role" "x" {}\n');
  const got = detectInfra(node, { now: 1 }).map((x) => [x.kind, x.tech, x.name || '']);
  assert.deepEqual(got.sort(), [['api', 'Stripe', ''], ['cache', 'Redis', ''], ['database', 'PostgreSQL', ''], ['queue', 'SQS', 'refunds-dlq'], ['storage', 'S3', 'invoices'], ['topic', 'Kafka', '']].sort());
  const py = write(tmp(), 'requirements.txt', 'Django==5\npsycopg2-binary>=2.9\ncelery[redis]\nrequests\n');
  assert.deepEqual(detectInfra(py, { now: 1 }).map((x) => x.tech).sort(), ['Celery', 'PostgreSQL']);
  const go = write(tmp(), 'go.mod', 'module x\nrequire (\n\tgithub.com/segmentio/kafka-go v0.4.0\n\tgithub.com/redis/go-redis/v9 v9.0.0\n)\n');
  assert.deepEqual(detectInfra(go, { now: 1 }).map((x) => x.tech).sort(), ['Kafka', 'Redis']);
  assert.deepEqual(detectInfra(tmp(), { now: 1 }), [], 'nada que decir');
});

test('lo que un pedido nombra de la infraestructura (y lo que no)', () => {
  const said = (text) => namedInfra(text).map((m) => `${m.kind}:${m.name}`);
  assert.deepEqual(said('Al crear un reembolso, publicar el evento `refund.created` en Kafka y guardarlo en la tabla refunds'), ['topic:refund.created', 'database:refunds', 'topic:Kafka']);
  assert.deepEqual(said('Agregar la cola de reembolsos y un cron que limpie las sesiones vencidas'), ['queue:reembolsos', 'scheduler:limpie sesiones vencidas']);
  assert.deepEqual(said('Cobrar con la API de Stripe y avisar por el webhook de Stripe'), ['api:Stripe'], 'un proveedor es su API, una vez');
  assert.deepEqual(said('Consume the refunds queue, write to the orders database and publish the order.created topic'), ['queue:refunds', 'database:orders', 'topic:order.created']);
  assert.deepEqual(said('Guardar el carrito en Redis y la factura en el bucket de facturas'), ['storage:facturas', 'cache:Redis']);
  assert.deepEqual(said('a nightly cron job to purge expired sessions'), ['scheduler:purge expired sessions']);
  for (const quiet of ['la cola tiene mensajes duplicados', 'Que todas las APIs expongan /health', 'Revisar el evento de mañana con el equipo']) assert.deepEqual(said(quiet), [], quiet);
});

/** A company: Pagos (payments-core: Kafka, PostgreSQL, Stripe and its SQS queue; payments-web) and Clientes (crm), with a desk that sends nothing for real. */
function company({ intel = null } = {}) {
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  store.createOffice({ name: 'Clientes' });
  const coreDir = write(tmp(), 'package.json', { dependencies: { kafkajs: '2', pg: '8', stripe: '14' } });
  write(coreDir, 'terraform/main.tf', 'resource "aws_sqs_queue" "refunds" {\n  name = "refunds"\n}\n');
  const webDir = write(tmp(), 'package.json', { dependencies: { next: '14', 'react-dom': '18' } });
  const crmDir = write(tmp(), 'package.json', { dependencies: { express: '4', ioredis: '5' } });
  // executables that are not there: nothing real is ever launched
  const agent = (dir, name, office) => store.createAgent({ path: dir, harness: 'claude-code', name, office, bin: path.join(dir, 'no-claude') }).agent;
  const core = agent(coreDir, 'payments-core', 'pagos');
  const web = agent(webDir, 'payments-web', 'pagos');
  const crm = agent(crmDir, 'crm', 'clientes');
  const hub = Object.assign(new EventEmitter(), { tasks: new Map(), cancel() { return { ok: true }; } });
  const sent = [];
  let n = 0;
  const registry = { run(msg) { sent.push(msg); const task = { id: `t${++n}`, status: 'running' }; hub.tasks.set(task.id, task); return { ok: true, task }; } };
  const names = { main: 'Principal', pagos: 'Pagos', clientes: 'Clientes' };
  const desk = new DirectiveDesk({ store, registry, hub, intel, company: { info: (id) => ({ name: names[id] || id }) } });
  return { store, desk, sent, core, web, crm, dirs: [coreDir, webDir, crmDir] };
}
const cleanup = (dirs) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };
const briefOf = (sent, id) => sent.find((m) => m.target === id)?.text || '';

test('el mapa con la infraestructura: lo nombrado llega a quien lo usa; una tecnología sola no; un proveedor sí; lo que no está se pregunta', () => {
  const { store, core, crm, dirs } = company();
  try {
    store.saveResource({ kind: 'topic', name: 'orders.created', tech: 'Kafka', location: 'msk-prod', links: [{ project: crm.path, how: 'consumes' }] });
    const map = () => companyMap(store);
    let m = mapImpact(map(), 'Dejar de leer el tópico orders.created', { resources: store.listResources() });
    assert.deepEqual(m.targets, [crm.id]);
    assert.equal(m.departments.flatMap((o) => o.projects).find((p) => p.id === crm.id).why, 'resource');
    const topic = m.resources.find((r) => r.name === 'orders.created');
    assert.equal(topic.impacted, 'named');
    assert.deepEqual(topic.projects.map((x) => [x.name, x.how]), [['crm', 'consumes']]);
    assert.ok(m.resources.some((r) => r.techOnly && r.tech === 'Redis'), 'lo que usa el repo que toca: una dependencia');
    m = mapImpact(map(), 'Mover los logs a Redis', { resources: store.listResources() });
    assert.deepEqual(m.targets, [], 'Redis lo usan muchos: no dice cuál');
    m = mapImpact(map(), 'Actualizar la API de Stripe a la versión nueva', { resources: store.listResources() });
    assert.deepEqual(m.targets, [core.id], 'quien llama a Stripe');
    assert.deepEqual(m.unknown, [], 'Stripe no es un componente que falte');
    m = mapImpact(map(), 'Consumir la cola refunds y publicar en el tópico cobros-aprobados', { resources: store.listResources() });
    assert.deepEqual(m.targets, [core.id], 'la cola que su Terraform declara');
    assert.deepEqual(m.unknown.map((u) => [u.kind, u.name, u.question]), [['topic', 'cobros-aprobados', '«tópico cobros-aprobados» (tópico): ¿ya existe, y dónde? ¿O hay que crearla, y quién?']]);
    assert.equal(findResource(knownResources({ declared: store.listResources(), projects: map().flatMap((o) => o.projects) }), { name: 'refunds', kind: 'queue' })?.tech, 'SQS');
  } finally { cleanup(dirs); }
});

test('las respuestas: la cola por crear (y quién), la que existe (dónde y quién la usa), un repo aparte (carpeta o URL), un repo nuevo, y lo que llevan los encargos', () => {
  const { store, desk, sent, core, web, crm, dirs } = company();
  const fresh = path.join(tmp(), 'notificaciones');
  const other = write(tmp(), 'README.md', '# facturación');
  try {
    const text = 'Publicar el tópico reembolsos-hechos, leer de la cola conciliaciones, avisar desde el servicio de notificaciones, registrar en el servicio de facturación y en el servicio de auditoría; la web payments-web muestra el estado';
    let out = desk.create({ text });
    assert.equal(out.needsAnswers, true);
    assert.deepEqual(out.map.unknown.map((u) => [u.kind, u.name]), [['component', 'notificaciones'], ['component', 'facturación'], ['component', 'auditoría'], ['topic', 'reembolsos-hechos'], ['queue', 'conciliaciones']]);
    const rest = [
      { key: 'queue:conciliaciones', action: 'exists', where: 'SQS prod', project: crm.id, how: 'consumes' },
      { key: 'notificaciones', action: 'newRepo', where: fresh, harness: 'pi', office: 'clientes' },
      { key: 'facturacion', action: 'repo', where: other, harness: 'claude-code', office: 'pagos' },
      { key: 'auditoria', action: 'repo', where: 'https://github.com/acme/auditoria' },
    ];
    // a create without who creates it is not an answer
    out = desk.create({ text, answers: [{ key: 'topic:reembolsos hechos', action: 'create' }, ...rest] });
    assert.match(out.error, /qué repositorio crea/i);
    assert.equal(fs.existsSync(fresh), false, 'nada a medias: ni la carpeta del repo nuevo');
    assert.equal(store.listAgents().length, 3);
    out = desk.create({ text, answers: [
      { key: 'topic:reembolsos hechos', action: 'create', project: core.id, where: 'msk-prod' },
      { key: 'queue:conciliaciones', action: 'exists', where: 'SQS prod', project: crm.id, how: 'consumes' },
      { key: 'notificaciones', action: 'newRepo', where: fresh, harness: 'pi', office: 'clientes' },
      { key: 'facturacion', action: 'repo', where: other, harness: 'claude-code', office: 'pagos' },
      { key: 'auditoria', action: 'repo', where: 'https://github.com/acme/auditoria' },
    ] });
    assert.ok(out.ok, out.error);
    // the new repo: an empty folder, registered; the separate one, registered
    assert.deepEqual(fs.readdirSync(fresh), []);
    assert.deepEqual(out.registered.map((a) => [a.name, a.harness, a.office]), [['notificaciones', 'pi', 'clientes'], ['facturación', 'claude-code', 'pagos']]);
    const ids = Object.fromEntries(store.listAgents().map((a) => [a.name, a.id]));
    assert.deepEqual(out.directive.parts.map((p) => p.name).sort(), ['crm', 'facturación', 'notificaciones', 'payments-core', 'payments-web']);
    // on the map now
    const res = Object.fromEntries(store.listResources().map((r) => [r.name, r]));
    assert.deepEqual([res['reembolsos-hechos'].state, res['reembolsos-hechos'].location, res['reembolsos-hechos'].links.map((l) => l.how)], ['planned', 'msk-prod', ['owns']]);
    assert.deepEqual([res.conciliaciones.state, res.conciliaciones.location, res.conciliaciones.links.map((l) => [l.project, l.how])], ['exists', 'SQS prod', [[crm.path, 'consumes']]]);
    assert.deepEqual([res.auditoría.kind, res.auditoría.location], ['repo', 'https://github.com/acme/auditoria']);
    // what each brief carries
    assert.match(briefOf(sent, core.id), /🆕 Hay que crear 📣 tópico «reembolsos-hechos» \(msk-prod\): créala como parte de este trabajo/);
    assert.match(briefOf(sent, crm.id), /🗄 Toca 📨 cola «conciliaciones» \(SQS prod\) \(la consume\)\./);
    assert.match(briefOf(sent, ids.notificaciones), /🆕 Este repositorio es nuevo \(una carpeta vacía\)/);
    assert.match(briefOf(sent, web.id), /🔗 «auditoría» vive en un repositorio que la oficina no tiene: https:\/\/github\.com\/acme\/auditoria/, 'un repo de fuera: lo saben todos');
    assert.ok(!briefOf(sent, web.id).split('\n').some((l) => /^(🆕|🗄)/.test(l) && l.includes('reembolsos-hechos')), 'el tópico por crear es del core');
    // asking again: nothing to ask any more
    assert.deepEqual(desk.plan({ text }).map.unknown, []);
    // a new repo where a folder with things is: no
    out = desk.create({ text: 'Avisar desde el servicio de mensajería', answers: [{ key: 'mensajeria', action: 'newRepo', where: other }] });
    assert.match(out.error, /ya existe y no está vacía/);
    out = desk.create({ text: 'Avisar desde el servicio de mensajería', answers: [{ key: 'mensajeria', action: 'repo', where: path.join(other, 'no-esta') }] });
    assert.match(out.error, /No existe la carpeta/);
    // it is infrastructure after all: another team's service
    out = desk.create({ text: 'Avisar desde el servicio de mensajería', answers: [{ key: 'mensajeria', action: 'resource', kind: 'service', where: 'equipo Plataforma', project: core.id, how: 'calls' }] });
    assert.ok(out.ok, out.error);
    assert.deepEqual(store.findResource('mensajería', 'service')?.links.map((l) => l.how), ['calls']);
  } finally { cleanup([...dirs, path.dirname(fresh), other]); }
});

test('la base: la infraestructura se valida, se mezcla por tipo y nombre, y viaja con tus ajustes', () => {
  const store = openStore(':memory:');
  const dir = tmp();
  try {
    assert.match(store.saveResource({ kind: 'lago', name: 'x' }).error, /el tipo es uno de/);
    assert.match(store.saveResource({ kind: 'queue', name: ' ' }).error, /falta su nombre/);
    assert.match(store.saveResource({ kind: 'queue', name: 'x', links: [{ project: 'relativa' }] }).error, /ruta|relativ/i);
    assert.match(store.saveResource({ kind: 'queue', name: 'x', links: [{ project: dir, how: 'mira' }] }).error, /cómo la usa/);
    const a = store.saveResource({ kind: 'queue', name: 'refunds', tech: 'SQS', links: [{ project: dir, how: 'consumes' }] });
    const b = store.saveResource({ kind: 'queue', name: 'Refunds', location: 'prod', addLinks: [{ project: dir, how: 'publishes' }] });
    assert.equal(b.resource.id, a.resource.id, 'la misma cola');
    assert.deepEqual([b.created, b.resource.tech, b.resource.location, b.resource.links.map((l) => l.how)], [false, 'SQS', 'prod', ['consumes', 'publishes']]);
    assert.ok(store.saveResource({ kind: 'database', name: 'refunds' }).created, 'otro tipo, otra cosa');
    const file = exportSettings(store);
    assert.deepEqual(file.resources.map((r) => [r.kind, r.name]), [['database', 'refunds'], ['queue', 'Refunds']]);
    const other = openStore(':memory:');
    const out = importSettings(other, file);
    assert.equal(out.applied.resources, 2);
    assert.deepEqual(other.findResource('Refunds', 'queue').links, [{ project: dir, how: 'consumes' }, { project: dir, how: 'publishes' }]);
    assert.equal(store.deleteResource(a.resource.id).ok, true);
    assert.equal(store.deleteResource(a.resource.id).status, 404);
  } finally { cleanup([dir]); }
});

test('por la API: la infraestructura (un proyecto por su id), el mapa con lo que usa cada repo, y las respuestas de un encargo solo', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 }, loops: { autostart: false } });
  const dir = write(tmp(), 'package.json', { dependencies: { amqplib: '0.10' } });
  const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const a = server.store.createAgent({ path: dir, harness: 'pi', name: 'cobranza', bin: path.join(dir, 'no-pi') }).agent;
    let r = await call('POST', '/v1/resources', { kind: 'queue', name: 'cobros', tech: 'RabbitMQ', links: [{ project: a.id, how: 'consumes' }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.resource.links, [{ project: dir, how: 'consumes' }]);
    assert.equal((await call('POST', '/v1/resources', { kind: 'nube', name: 'x' })).status, 400);
    r = await call('GET', '/v1/map');
    assert.deepEqual(r.body.departments[0].projects[0].infra.map((x) => x.tech), ['RabbitMQ']);
    assert.deepEqual(r.body.resources.map((x) => [x.name, x.source]), [['cobros', 'declared'], ['RabbitMQ', 'detected']]);
    r = await call('GET', '/v1/resources');
    assert.equal(r.body.resources.length, 1);
    assert.ok(r.body.kinds.includes('scheduler'));
    // a single brief's answers: on the map, and the lines on top of its brief
    r = await call('POST', '/v1/impact/answers', { text: 'Reintentar los cobros de la cola `cobros` desde un cron que reintente los cobros fallidos', targets: [a.id], target: a.id, answers: [{ key: 'scheduler:reintente cobros fallidos', action: 'create', project: a.id }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.lines, ['🆕 Hay que crear ⏰ scheduler «reintente cobros fallidos»: créala como parte de este trabajo (y, ya creada, declárala con la herramienta MCP declare_resource).', '🗄 Toca 📨 cola «cobros» (RabbitMQ) (la consume).']);
    assert.equal(server.store.findResource('reintente cobros fallidos', 'scheduler').state, 'planned');
    r = await call('PUT', `/v1/resources/${server.store.findResource('cobros', 'queue').id}`, { location: 'rabbit-prod' });
    assert.equal(r.body.resource.location, 'rabbit-prod');
    assert.equal((await call('DELETE', `/v1/resources/${r.body.resource.id}`)).status, 200);
  } finally { await server.close(); cleanup([dir]); }
});

test('MCP: declare_resource pone en el mapa lo que el agente creó, usado por su carpeta', async () => {
  const { createMcp } = await import('../server/mcp.js');
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 }, loops: { autostart: false } });
  const dir = tmp();
  try {
    const mcp = createMcp({ base: server.url, socket: null, env: {}, cwd: dir });
    await mcp.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { clientInfo: { name: 'pi' } } });
    const r = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'declare_resource', arguments: { kind: 'topic', name: 'refund.created', tech: 'Kafka', location: 'msk-prod', how: 'owns' } } })).result;
    assert.ok(!r.isError, r.content[0].text);
    assert.match(r.content[0].text, /topic "refund\.created" is on the map \(Kafka\) at msk-prod/);
    assert.deepEqual(server.store.findResource('refund.created', 'topic').links, [{ project: dir, how: 'owns' }]);
  } finally { await server.close(); cleanup([dir]); }
});

test('briefLines: un proyecto lleva lo suyo y lo de nadie; no lo de otro', () => {
  const m = {
    departments: [{ id: 'main', projects: [{ id: 'a', name: 'a', components: [{ name: 'api', path: 'apps/api', impacted: true }], how: 'Agregar /refunds' }, { id: 'b', name: 'b', components: [] }] }],
    resources: [
      { name: 'refunds', kind: 'queue', tech: 'SQS', location: '', state: 'exists', impacted: 'named', projects: [{ id: 'a', name: 'a', how: 'consumes' }] },
      { name: 'Redis', kind: 'cache', tech: 'Redis', techOnly: true, impacted: 'named', projects: [{ id: 'a', name: 'a', how: 'uses' }] },
      { name: 'ledger', kind: 'database', tech: '', location: 'rds-prod', state: 'exists', impacted: 'named', projects: [] },
    ],
  };
  assert.deepEqual(briefLines(m, 'a', { fresh: [{ name: 'worker', path: 'apps/worker' }] }), [
    '🧩 Componentes de este repositorio que toca: api (apps/api).',
    '🆕 Componente nuevo «worker» (apps/worker): hay que crearlo como parte de esta directiva.',
    '🗄 Toca 📨 cola «refunds» (SQS) (la consume).',
    '🗄 Toca 🗄 base de datos «ledger» (rds-prod) (la usa).',
    '🧠 Según el análisis: Agregar /refunds',
  ]);
  assert.deepEqual(briefLines(m, 'b', { newRepo: true }), ['🆕 Este repositorio es nuevo (una carpeta vacía): ármalo desde cero para lo que sigue (git init, su estructura, su README).', '🗄 Toca 🗄 base de datos «ledger» (rds-prod) (la usa).']);
});
