// A directive's impact (server/components.js, server/directives.js): the company's map is departments →
// projects → components (detected from each folder, and declared); before an order goes, it says what it
// touches, and what it names that is not on the map is asked (does it exist and where? a new component?
// a new department?).
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
import { detectComponents, namedParts, mapImpact, companyMap, impactText } from '../server/components.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-impact-')));
const mkdirs = (root, ...dirs) => { for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true }); return root; };
const write = (root, file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data)); };

test('los componentes de un proyecto salen de su carpeta: sus workspaces, o las carpetas de siempre', () => {
  const mono = tmp();
  write(mono, 'package.json', { name: 'acme', workspaces: ['apps/*', 'packages/ui'] });
  write(mono, 'apps/web/package.json', { name: '@acme/web' });
  mkdirs(mono, 'apps/admin', 'apps/node_modules', 'packages/ui', 'packages/other');
  assert.deepEqual(detectComponents(mono, { now: 1 }), [{ name: 'admin', path: 'apps/admin' }, { name: 'web', path: 'apps/web' }, { name: 'ui', path: 'packages/ui' }]);
  const pnpm = tmp();
  write(pnpm, 'pnpm-workspace.yaml', "packages:\n  - 'services/*'\n  - '!services/legacy'\n");
  mkdirs(pnpm, 'services/billing', 'services/notificaciones');
  assert.deepEqual(detectComponents(pnpm, { now: 1 }).map((c) => c.name), ['billing', 'notificaciones']);
  const plain = tmp();
  mkdirs(plain, 'services/facturacion', 'cmd/server', 'src');
  assert.deepEqual(detectComponents(plain, { now: 1 }).map((c) => c.path), ['services/facturacion', 'cmd/server']);
  assert.deepEqual(detectComponents(tmp(), { now: 1 }), [], 'un proyecto de una sola pieza');
});

test('lo que un pedido nombra como parte del sistema (y lo que no: verbos, librerías, rutas)', () => {
  const keys = (text) => namedParts(text).map((p) => p.phrase);
  assert.deepEqual(keys('Mandar push desde el servicio de notificaciones y mostrarlos en la app móvil'), ['servicio de notificaciones', 'app móvil']);
  assert.deepEqual(keys('Move the billing service to the new payments-api'), ['payments-api', 'billing service']);
  assert.deepEqual(keys('Cambiar el worker EmailSender y el módulo de la facturación'), ['worker EmailSender', 'módulo de la facturación']);
  assert.deepEqual(keys('Revisar `checkout-web`'), ['checkout-web']);
  for (const quiet of ['Que todas las APIs expongan /health', 'Actualizar la librería de logs en todos los servicios', 'Every API must expose /health', 'Agregar e-mail y end-to-end', 'Un servicio nuevo para todos']) assert.deepEqual(keys(quiet), [], quiet);
});

/** A company: Pagos (api-pagos, with services) and Tienda (tienda, with apps), and a desk that sends nothing for real. */
function company() {
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  store.createOffice({ name: 'Tienda' });
  const pagosDir = mkdirs(tmp(), 'services/notificaciones', 'services/facturacion');
  const tiendaDir = mkdirs(tmp(), 'apps/web', 'apps/admin');
  const pagos = store.createAgent({ path: pagosDir, harness: 'claude-code', name: 'api-pagos', office: 'pagos' }).agent;
  const tienda = store.createAgent({ path: tiendaDir, harness: 'pi', name: 'tienda', office: 'tienda' }).agent;
  const hub = Object.assign(new EventEmitter(), { tasks: new Map(), cancel() { return { ok: true }; } });
  const sent = [];
  let n = 0;
  const registry = { run(msg) { sent.push(msg); const task = { id: `t${++n}`, status: 'running' }; hub.tasks.set(task.id, task); return { ok: true, task }; } };
  const names = { main: 'Principal', pagos: 'Pagos', tienda: 'Tienda' };
  const desk = new DirectiveDesk({ store, registry, hub, company: { info: (id) => ({ name: names[id] || id }) } });
  return { store, desk, sent, pagos, tienda, dirs: [pagosDir, tiendaDir] };
}

test('el mapa de impacto: departamentos, proyectos y componentes que nombra; lo genérico sólo con su proyecto', () => {
  const { store, desk, pagos, tienda, dirs } = company();
  try {
    let r = desk.plan({ text: 'Que el servicio de notificaciones avise cuando falla la facturación' });
    assert.equal(r.ok, true);
    const p = r.map.departments.find((o) => o.id === 'pagos');
    assert.equal(p.impacted, true);
    const proj = p.projects[0];
    assert.deepEqual([proj.id, proj.why], [pagos.id, 'part']);
    assert.deepEqual(proj.components.filter((c) => c.impacted).map((c) => c.name), ['facturacion', 'notificaciones']);
    assert.equal(r.map.departments.find((o) => o.id === 'tienda').impacted, false);
    assert.deepEqual(r.map.unknown, [], 'todo está en el mapa');
    assert.deepEqual(r.map.targets, [pagos.id]);
    assert.match(r.text, /🏢 Pagos\n {2}📁 api-pagos — nombra un componente suyo: facturacion \(services\/facturacion\), notificaciones \(services\/notificaciones\)/);
    // a department by its name: all its projects
    r = desk.plan({ text: 'En Pagos hay que cambiar el logo' });
    assert.deepEqual(r.map.targets, [pagos.id]);
    assert.equal(r.map.departments.find((o) => o.id === 'pagos').projects[0].why, 'department');
    // "web" is too common: only with its project named (or chosen)
    assert.equal(desk.plan({ text: 'Mejorar la web' }).map.targets.length, 0);
    r = desk.plan({ text: 'Mejorar la web de tienda' });
    assert.deepEqual(r.map.departments.find((o) => o.id === 'tienda').projects[0].components.filter((c) => c.impacted).map((c) => c.name), ['web']);
    // chosen by hand: it counts
    assert.deepEqual(desk.plan({ text: 'Actualizar el logger', targets: [tienda.id] }).map.targets, [tienda.id]);
    assert.match(desk.plan({ text: 'Actualizar el logger' }).text, /No identifiqué qué departamentos ni proyectos toca/);
  } finally { store.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('lo que no está en el mapa se pregunta antes de enviar: existe (y dónde), crearlo, departamento nuevo o no es un componente', () => {
  const { store, desk, sent, pagos, tienda, dirs } = company();
  try {
    const text = 'Mandar push desde el servicio de notificaciones y mostrarlos en la app móvil y en el portal de socios';
    let out = desk.create({ text });
    assert.equal(out.ok, false);
    assert.equal(out.needsAnswers, true);
    assert.deepEqual(out.map.unknown.map((u) => u.phrase), ['app móvil', 'portal de socios']);
    assert.equal(out.map.unknown[0].question, '¿Existe «app móvil»? ¿En qué proyecto y carpeta está, o hay que crearlo?');
    assert.match(out.error, /«app móvil», «portal de socios»/);
    assert.equal(sent.length, 0, 'no se envía nada');
    // a bad answer
    assert.match(desk.create({ text, answers: [{ key: 'app movil', action: 'quizás' }, { key: 'socios', action: 'ignore' }] }).error, /¿Qué es «app móvil»\?/);
    // the mobile app has to be created in tienda; the partners' portal is a new department
    out = desk.create({ text, answers: [{ key: 'app movil', action: 'create', project: tienda.id, path: 'apps/mobile' }, { key: 'socios', action: 'department', department: 'Socios' }] });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.created.map((o) => o.name), ['Socios'], 'se creó el departamento');
    assert.ok(store.findOffice('Socios'));
    const d = out.directive;
    assert.deepEqual(d.parts.map((p) => [p.name, p.components, p.fresh]), [['api-pagos', ['notificaciones'], []], ['tienda', [], ['app móvil']]]);
    const toTienda = sent.find((m) => m.target === tienda.id).text;
    assert.match(toTienda, /\n🆕 Componente nuevo «app móvil» \(apps\/mobile\): hay que crearlo como parte de esta directiva\.\n\n/);
    assert.match(sent.find((m) => m.target === pagos.id).text, /\n🧩 Componentes de este proyecto que toca: notificaciones \(services\/notificaciones\)\.\n\n/);
    // it is on the map now: the next order that names it knows where it is
    assert.deepEqual(store.listComponents().map((c) => [c.name, c.path]), [['app móvil', 'apps/mobile']]);
    const again = desk.plan({ text: 'Que la app móvil tenga modo oscuro' });
    assert.deepEqual([again.map.unknown, again.map.targets], [[], [tienda.id]]);
    // it exists, somewhere: mapped where you say
    out = desk.create({ text: 'Que el módulo de cobranza mande recibos', answers: [{ key: 'cobranza', action: 'exists', project: pagos.id, path: 'src/cobranza' }] });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.directive.parts.map((p) => [p.name, p.components]), [['api-pagos', ['cobranza']]]);
    // exact: only the projects you left chosen (you saw the map and unchecked one)
    out = desk.create({ text: 'Que el servicio de notificaciones y la web de tienda usen UTC', targets: [tienda.id], exact: true });
    assert.deepEqual(out.directive.parts.map((p) => [p.name, p.components]), [['tienda', ['web']]]);
    // ask: false skips the questions (what an older client does)
    assert.equal(desk.create({ text: 'Revisar el portal de proveedores', targets: [pagos.id], ask: false }).ok, true);
  } finally { store.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('por la API: el mapa de la empresa, declarar y quitar componentes, el plan (con la reacción de la dirección) y el 409 que pide respuestas', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 } });
  const dir = mkdirs(tmp(), 'apps/web');
  const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const a = server.store.createAgent({ path: dir, harness: 'pi', name: 'tienda', bin: path.join(dir, 'no-pi') }).agent;
    let r = await call('POST', '/v1/components', { project: a.id, name: 'Pasarela', path: 'src/pasarela', description: 'pagos con tarjeta' });
    assert.equal(r.status, 201);
    assert.equal((await call('POST', '/v1/components', { project: a.id, name: 'x', path: '../fuera' })).status, 400);
    r = await call('GET', '/v1/map');
    const comps = r.body.departments[0].projects[0].components;
    assert.deepEqual(comps.map((c) => [c.name, c.path, c.declared]), [['Pasarela', 'src/pasarela', true], ['web', 'apps/web', false]]);
    const floorEvents = [];
    server.bus.on('floor', (e) => floorEvents.push(e));
    r = await call('POST', '/v1/directives/plan', { text: 'Que la pasarela acepte débito y el servicio de envíos calcule el costo' });
    assert.deepEqual([r.status, r.body.map.targets, r.body.map.unknown.map((u) => u.phrase)], [200, [a.id], ['servicio de envíos']]);
    assert.deepEqual(floorEvents.map((e) => [e.kind, e.total, e.unknown]), [['impact', 1, 1]]);
    r = await call('POST', '/v1/directives', { text: 'Que la pasarela acepte débito y el servicio de envíos calcule el costo' });
    assert.equal(r.status, 409);
    assert.equal(r.body.needsAnswers, true);
    r = await call('POST', '/v1/directives', { text: 'Que la pasarela acepte débito', answers: [] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await call('DELETE', `/v1/components/${comps[0].id}`)).status, 200);
    assert.equal((await call('DELETE', `/v1/components/${comps[0].id}`)).status, 404);
  } finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('companyMap no repite un componente declarado sobre el que ya se detecta', () => {
  const store = openStore(':memory:');
  const dir = mkdirs(tmp(), 'apps/web');
  try {
    const a = store.createAgent({ path: dir, harness: 'pi', name: 'tienda' }).agent;
    store.addComponent({ project: a.path, name: 'web', path: 'apps/web', description: 'la tienda' });
    const [proj] = companyMap(store)[0].projects;
    assert.deepEqual(proj.components.map((c) => [c.name, c.declared, c.description]), [['web', true, 'la tienda']]);
    assert.ok(impactText(mapImpact(companyMap(store), 'nada')).length > 0);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('MCP: map_impact dice qué toca; send_directive no sale hasta que el usuario contesta lo que no está en el mapa', async () => {
  const { createMcp } = await import('../server/mcp.js');
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 } });
  const dir = mkdirs(tmp(), 'services/notificaciones');
  try {
    server.store.createOffice({ name: 'Pagos' });
    // an executable that is not there: nothing real is launched (the part fails on the spot)
    const a = server.store.createAgent({ path: dir, harness: 'claude-code', name: 'api-pagos', office: 'pagos', bin: path.join(dir, 'no-claude') }).agent;
    const mcp = createMcp({ base: server.url, socket: null, env: {} });
    await mcp.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
    const tool = async (name, args) => (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
    const text = 'Que el servicio de notificaciones mande SMS desde el gateway de mensajería';
    let r = await tool('map_impact', { text });
    assert.match(r.content[0].text, /🏢 Pagos\n {2}📁 api-pagos — nombra un componente suyo: notificaciones \(services\/notificaciones\)/);
    assert.match(r.content[0].text, /Nombra cosas que no están en el mapa:\n {2}\? ¿Existe «gateway de mensajería»\?/);
    r = await tool('send_directive', { text });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /^Not sent yet\./);
    assert.match(r.content[0].text, /- "gateway de mensajería": ¿Existe/);
    r = await tool('send_directive', { text, answers: [{ name: 'gateway de mensajería', action: 'create', project: dir, path: 'services/gateway' }] });
    assert.ok(!r.isError, r.content[0].text);
    assert.match(r.content[0].text, /api-pagos \(pagos\): .* · components: notificaciones · new: mensajería/);
    assert.deepEqual(server.store.listComponents(a.path).map((c) => [c.name, c.path]), [['mensajería', 'services/gateway']]);
  } finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
