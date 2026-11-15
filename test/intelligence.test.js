// The model the office leans on for judgment (server/intelligence.js) and the pictures of an impact
// (public/impact.js). The providers are fakes here: nothing leaves the machine, nothing real is launched.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Intelligence, extractJson, normalizeInsight, IMPACT_SCHEMA, mapForModel } from '../server/intelligence.js';
import { askCommand } from '../integrations/common/devteam.mjs';
import { openStore } from '../server/store.js';
import { DirectiveDesk } from '../server/directives.js';
import { startServer } from '../server/server.js';
import { mapImpact, companyMap, mergeInsight } from '../server/components.js';
import { knownResources } from '../server/resources.js';
import { impactTree, impactGraph, layoutGraph } from '../public/impact.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-intel-')));
const write = (root, file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data)); return root; };
/** A fetch that answers `reply(url, body)` and keeps what it was asked. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const [status, json] = reply(url, body, calls.length);
    return { ok: status < 400, status, json: async () => json };
  };
  return Object.assign(fn, { calls });
}
const prefsOf = (intelligence) => () => ({ intelligence });

test('el JSON de una respuesta: con cerco, con prosa alrededor o solo; y lo que no es se deja', () => {
  assert.deepEqual(extractJson('Listo:\n```json\n{"a": 1}\n```\n'), { a: 1 });
  assert.deepEqual(extractJson('Pensé un rato. {"summary": "x {y}", "n": [1, {"b": 2}]} y eso es todo'), { summary: 'x {y}', n: [1, { b: 2 }] });
  assert.deepEqual(extractJson('\x1b[32m{"ok":true}\x1b[0m'), { ok: true });
  assert.equal(extractJson('no hay nada'), null);
  const n = normalizeInsight({ summary: 's', projects: [{ id: 'a', how: 'h', level: 'altísimo', components: ['x', 7] }, { how: 'sin id' }], resources: [{ name: 'q', kind: 'cola', action: 'borrar' }], unknown: [{ name: 'svc' }], links: [{ from: 'a' }] });
  assert.deepEqual(n.projects, [{ id: 'a', how: 'h', level: 'medium', components: ['x', '7'] }]);
  assert.deepEqual(n.resources, [{ name: 'q', kind: 'other', known: false, action: 'use', projects: [], how: '' }]);
  assert.deepEqual([n.unknown, n.links], [[{ name: 'svc', kind: 'component', question: '' }], []]);
  assert.equal(IMPACT_SCHEMA.additionalProperties, false);
});

test('Anthropic: la API de Messages con su versión, la clave del entorno, el esquema y el respaldo ante un rechazo', async () => {
  const insight = { summary: 'ok', projects: [], resources: [], unknown: [], links: [] };
  let f = fakeFetch(() => [200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(insight) }] }]);
  let intel = new Intelligence({ getPrefs: prefsOf({ provider: 'anthropic' }), fetch: f, env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(intel.label, 'anthropic · claude-opus-5-5');
  assert.equal(intel.problem(), null);
  let out = await intel.analyzeImpact({ order: 'x', company: [], known: [] });
  assert.ok(out.ok, out.error);
  assert.deepEqual(out.insight.summary, 'ok');
  const { url, headers, body } = f.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual([headers['x-api-key'], headers['anthropic-version'], headers['anthropic-beta']], ['sk-test', '2026-10-21', 'server-side-fallback-2026-07-01']);
  assert.deepEqual([body.model, body.max_tokens, body.fallbacks, body.output_config.format.type], ['claude-opus-5-5', 16000, 'default', 'json_schema']);
  assert.equal(body.messages[0].role, 'user');
  // another model: no fallback; a model without structured outputs: asked again without the schema
  f = fakeFetch((u, b, n) => (n === 1 ? [400, { error: { message: 'output_config.format is not supported on this model' } }] : [200, { content: [{ type: 'text', text: '```json\n{"ok": true}\n```' }] }]));
  intel = new Intelligence({ getPrefs: prefsOf({ provider: 'anthropic', model: 'claude-haiku-4-5' }), fetch: f, env: { DEV_TEAM_OFFICE_MODEL_KEY: 'k2' } });
  out = await intel.test();
  assert.ok(out.ok, out.error);
  assert.deepEqual([f.calls.length, 'fallbacks' in f.calls[0].body, f.calls[1].body.output_config, f.calls[0].headers['x-api-key']], [2, false, undefined, 'k2']);
  // a refusal is said, not parsed
  f = fakeFetch(() => [200, { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }]);
  out = await new Intelligence({ getPrefs: prefsOf({ provider: 'anthropic' }), fetch: f, env: { ANTHROPIC_API_KEY: 'x' } }).ask({ system: 's', user: 'u' });
  assert.deepEqual([out.ok, out.error], [false, 'refused (cyber)']);
  // without a key: what is missing
  assert.equal(new Intelligence({ getPrefs: prefsOf({ provider: 'anthropic' }), env: {} }).problem(), 'key');
  assert.equal(new Intelligence({ getPrefs: prefsOf({ provider: 'off' }) }).enabled, false);
});

test('OpenAI compatible y Ollama: su dirección, su modelo y JSON; una API sin modo JSON se pregunta de nuevo', async () => {
  let f = fakeFetch((u, b, n) => (n === 1 ? [400, { error: { message: 'response_format unsupported' } }] : [200, { choices: [{ message: { content: 'Aquí va: {"ok": true}' } }] }]));
  let intel = new Intelligence({ getPrefs: prefsOf({ provider: 'openai', url: 'http://127.0.0.1:1234/v1/', model: 'qwen' }), fetch: f, env: { OPENAI_API_KEY: 'o1' } });
  let out = await intel.test();
  assert.ok(out.ok, out.error);
  assert.deepEqual([f.calls[0].url, f.calls[0].body.response_format, f.calls[1].body.response_format, f.calls[0].headers.authorization], ['http://127.0.0.1:1234/v1/chat/completions', { type: 'json_object' }, undefined, 'Bearer o1']);
  assert.equal(new Intelligence({ getPrefs: prefsOf({ provider: 'openai' }) }).problem(), 'model', 'sin modelo no hay a quién preguntarle');
  f = fakeFetch(() => [200, { message: { content: '{"ok": true}' } }]);
  intel = new Intelligence({ getPrefs: prefsOf({ provider: 'ollama' }), fetch: f });
  out = await intel.test();
  assert.ok(out.ok, out.error);
  assert.deepEqual([f.calls[0].url, f.calls[0].body.model, f.calls[0].body.stream, f.calls[0].body.format.type], ['http://127.0.0.1:11434/api/chat', 'llama3.1', false, 'object']);
});

test('uno de tus agentes: su CLI en sólo lectura, en una carpeta neutra, callado para la oficina, con otro modelo si lo pides', async () => {
  const calls = [];
  const spawn = (exe, argv, opts) => {
    calls.push({ exe, argv, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => { child.stdout.emit('data', 'Analicé el pedido.\n{"summary":"s","projects":[],"resources":[],"unknown":[{"name":"gateway","kind":"component","question":"¿Dónde está?"}],"links":[]}\n'); child.emit('close', 0); });
    return child;
  };
  const ask = (h, o) => ({ exe: '/bin/fake', argv: askCommand('claude-code', o).argv ?? ['-p', o.question, ...(o.model ? ['--model', o.model] : [])] });
  const intel = new Intelligence({ getPrefs: prefsOf({ provider: 'agent', harness: 'claude-code', model: 'sonnet', timeout: 30 }), spawn, askCommand: ask });
  const out = await intel.analyzeImpact({ order: 'Mandar SMS por el gateway', company: [], known: [] });
  assert.ok(out.ok, out.error);
  assert.deepEqual(out.insight.unknown, [{ name: 'gateway', kind: 'component', question: '¿Dónde está?' }]);
  const { argv, opts } = calls[0];
  assert.equal(opts.cwd, os.tmpdir());
  assert.equal(opts.env.DEV_TEAM_OFFICE_BTW, '1', 'sus hooks no lo cuentan como trabajo');
  assert.ok(argv.includes('--model') && argv.includes('sonnet'));
  assert.match(argv[argv.indexOf('-p') + 1], /JSON schema/, 'a un CLI la forma va en palabras');
  assert.equal(intel.label, 'claude-code · sonnet');
  // askCommand: the model flag of each CLI
  const bin = process.execPath;
  assert.deepEqual(askCommand('claude-code', { question: 'q', bin, model: 'opus' }).argv.slice(-2), ['--model', 'opus']);
  assert.deepEqual(askCommand('codex', { question: 'q', bin, model: 'gpt-x' }).argv.slice(-3), ['-m', 'gpt-x', 'q']);
  assert.deepEqual(askCommand('opencode', { question: 'q', bin, model: 'a/b' }).argv.slice(-3), ['--model', 'a/b', 'q']);
  assert.ok(!askCommand('pi', { question: 'q', bin, model: 'x; rm -rf /' }).argv.includes('--model'), 'un nombre raro no pasa');
});

/** Pagos: payments-core (Kafka) and payments-web; Clientes: crm. A desk with a fake model and a registry that sends nothing. */
function company(insight) {
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  store.createOffice({ name: 'Clientes' });
  const dirs = [write(tmp(), 'package.json', { dependencies: { kafkajs: '2' } }), write(tmp(), 'package.json', { dependencies: { next: '14', 'react-dom': '18' } }), write(tmp(), 'package.json', { dependencies: { ioredis: '5' } })];
  const agent = (dir, name, office) => store.createAgent({ path: dir, harness: 'claude-code', name, office, bin: path.join(dir, 'no-claude') }).agent;
  const core = agent(dirs[0], 'payments-core', 'pagos'), web = agent(dirs[1], 'payments-web', 'pagos'), crm = agent(dirs[2], 'crm', 'clientes');
  const hub = Object.assign(new EventEmitter(), { tasks: new Map(), cancel() { return { ok: true }; } });
  const sent = [];
  let n = 0;
  const registry = { run(msg) { sent.push(msg); const task = { id: `t${++n}`, status: 'running' }; hub.tasks.set(task.id, task); return { ok: true, task }; } };
  const asked = [];
  const intel = { enabled: true, async analyzeImpact(args) { asked.push(args); return { ok: true, insight: normalizeInsight(insight({ core, web, crm })), model: 'fake · m', ms: 5 }; } };
  const desk = new DirectiveDesk({ store, registry, hub, intel, company: { info: (id) => ({ name: id }) } });
  return { store, desk, sent, asked, core, web, crm, dirs };
}

test('el análisis encima del mapa: cómo toca cada repo, los que agrega, lo que falta (sin repetir) y lo que usan', () => {
  const { store, core, web, crm, dirs } = company(() => ({}));
  try {
    const map = companyMap(store);
    const m = mapImpact(map, 'Mostrar los reembolsos en payments-web', { resources: store.listResources() });
    assert.deepEqual(m.targets, [web.id]);
    mergeInsight(m, normalizeInsight({
      summary: 'Toca la web y el core.',
      projects: [{ id: core.id, how: 'Exponer GET /refunds', level: 'high' }, { id: 'no-existe', how: 'x' }, { id: web.id, how: 'Una pantalla', level: 'low' }],
      resources: [{ name: 'Kafka', kind: 'topic', known: true, action: 'use', projects: [core.id] }, { name: 'refunds-dlq', kind: 'queue', known: false, action: 'create', how: '¿Existe la DLQ?' }],
      unknown: [{ name: 'payments-web', kind: 'component', question: 'ya está' }, { name: 'el repo payments-core', kind: 'repo', question: 'también está' }, { name: 'servicio de reportes', kind: 'component', question: '¿Dónde están los reportes?' }],
      links: [{ from: core.id, to: 'refunds-dlq', label: 'publica' }],
    }), { known: knownResources({ declared: [], projects: map.flatMap((o) => o.projects) }), model: 'fake · m' });
    const p = (id) => m.departments.flatMap((o) => o.projects).find((x) => x.id === id);
    assert.deepEqual([p(core.id).why, p(core.id).how, p(core.id).level], ['model', 'Exponer GET /refunds', 'high']);
    assert.deepEqual([p(web.id).why, p(web.id).level], ['named', 'low'], 'lo que dicen las palabras se queda');
    assert.equal(p(crm.id).impacted, false);
    assert.deepEqual(m.targets.sort(), [core.id, web.id].sort());
    assert.deepEqual(m.unknown.map((u) => [u.kind, u.name, u.source]), [['queue', 'refunds-dlq', 'model'], ['component', 'servicio de reportes', 'model']]);
    assert.equal(m.resources.find((r) => r.tech === 'Kafka').impacted, 'model');
    assert.deepEqual([m.insight, m.links.length], [{ model: 'fake · m', summary: 'Toca la web y el core.' }, 1]);
    assert.match(mapForModel({ company: map, known: [], first: m }), /project id=payments-core-claude-code name=payments-core kind=worker folder=.*\n {6}stack: Kafka \(topic\)/);
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('think: la directiva parte con el análisis (sus preguntas también se contestan, y cada encargo lleva el cómo)', async () => {
  const { desk, sent, asked, core, crm, dirs } = company(({ core: c, crm: r }) => ({
    summary: 's', projects: [{ id: c.id, how: 'Publicar refund.created', level: 'high' }, { id: r.id, how: 'Consumir refund.created', level: 'low' }],
    resources: [], unknown: [{ name: 'servicio de notificaciones', kind: 'component', question: '¿Dónde vive?' }], links: [],
  }));
  try {
    const text = 'Avisar al cliente cuando se aprueba un reembolso';
    assert.deepEqual(desk.plan({ text }).map.targets, [], 'por las palabras, nada');
    const out = await desk.think({ text });
    assert.deepEqual([out.insight.ok, out.insight.model], [true, 'fake · m']);
    assert.deepEqual(out.map.targets.sort(), [core.id, crm.id].sort());
    assert.equal(asked[0].order, text);
    assert.ok(asked[0].company.length >= 2, 'el modelo ve el mapa');
    // the order goes with what the model said: its question first
    let d = desk.create({ text });
    assert.equal(d.needsAnswers, true);
    d = desk.create({ text, answers: [{ key: 'servicio de notificaciones', action: 'ignore' }] });
    assert.ok(d.ok, d.error);
    assert.match(sent.find((m) => m.target === core.id).text, /🧠 Según el análisis: Publicar refund\.created/);
    // without a model: the map by words, said
    desk.intel = { enabled: false };
    const off = await desk.think({ text: 'otra cosa' });
    assert.deepEqual(off.insight, { ok: false, error: 'off' });
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('por la API: cómo está el modelo, probarlo y el plan con think (la dirección reacciona)', async () => {
  const insight = { summary: 'resumen', projects: [], resources: [], unknown: [{ name: 'motor de reglas', kind: 'component', question: '¿Dónde está el motor de reglas?' }], links: [] };
  const f = fakeFetch((u, b) => [200, { choices: [{ message: { content: JSON.stringify(b.messages[1].content === 'ping' ? { ok: true } : insight) } }] }]);
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 }, loops: { autostart: false }, intelligence: { fetch: f, env: {} } });
  const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    let r = await call('GET', '/v1/intelligence');
    assert.deepEqual([r.body.enabled, r.body.model], [false, 'off']);
    assert.equal((await call('POST', '/v1/intelligence/test', {})).status, 400);
    r = await call('PUT', '/v1/settings', { prefs: { intelligence: { provider: 'openai', url: 'http://fake.local/v1', model: 'm1', timeout: 30 } } });
    assert.ok(r.body.ok, r.body.error);
    assert.equal((await call('PUT', '/v1/settings', { prefs: { intelligence: { provider: 'oraculo' } } })).status, 400);
    r = await call('POST', '/v1/intelligence/test', {});
    assert.deepEqual([r.status, r.body.ok, r.body.model], [200, true, 'openai · m1']);
    const floor = [];
    server.bus.on('floor', (e) => floor.push(e));
    r = await call('POST', '/v1/directives/plan', { text: 'Cambiar las comisiones', think: true });
    assert.deepEqual([r.body.insight.ok, r.body.map.insight.summary, r.body.map.unknown.map((u) => u.name)], [true, 'resumen', ['motor de reglas']]);
    assert.match(r.body.text, /^🧠 resumen \(openai · m1\)/);
    assert.deepEqual(floor.map((e) => [e.kind, e.unknown, e.ok]), [['think', 1, true]]);
    assert.equal(f.calls.at(-1).url, 'http://fake.local/v1/chat/completions');
  } finally { await server.close(); }
});

test('el árbol: el pedido arriba, sus departamentos, una caja por repo y lo que no está en el mapa aparte; sin cajas encimadas', () => {
  const m = {
    departments: [
      { id: 'p', name: 'Pagos', impacted: true, projects: [{ id: 'core', name: 'payments-core', kind: 'backend', impacted: true, why: 'named', level: 'high', components: [{ name: 'api', impacted: true }] }, { id: 'web', name: 'payments-web', kind: 'frontend', impacted: true, why: 'uses', components: [] }, { id: 'x', name: 'otro', impacted: false, components: [] }] },
      { id: 'c', name: 'Clientes', impacted: true, projects: [{ id: 'crm', name: 'crm', impacted: true, why: 'model', components: [] }] },
      { id: 'z', name: 'Nadie', impacted: false, projects: [] },
    ],
    resources: [{ key: 'queue:refunds', name: 'refunds', kind: 'queue', impacted: 'named', projects: [{ id: 'core', name: 'payments-core', how: 'consumes' }] }],
    unknown: [{ key: 'gateway', name: 'gateway', kind: 'component' }, { key: 'topic:x', name: 'x', kind: 'topic' }],
  };
  const tree = impactTree(m, { title: 'El pedido', unknownLabel: '?', kindLabel: (k) => k.toUpperCase() });
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  assert.deepEqual(tree.nodes.filter((n) => n.kind === 'repo').map((n) => [n.label, n.sub]), [['payments-core', 'BACKEND · 🧩1 · 🗄1'], ['payments-web', 'FRONTEND'], ['crm', '']]);
  assert.ok(!byId.has('dept:z') && !byId.has('repo:x'), 'sólo lo que toca');
  assert.deepEqual(tree.nodes.filter((n) => n.kind === 'unknown').map((n) => n.sub), ['', 'TOPIC']);
  const leaves = tree.nodes.filter((n) => n.kind === 'repo' || n.kind === 'unknown').sort((a, b) => a.x - b.x);
  for (let i = 1; i < leaves.length; i++) assert.ok(leaves[i].x >= leaves[i - 1].x + leaves[i - 1].w, 'cada hoja en su columna');
  const pagos = byId.get('dept:p');
  assert.equal(pagos.x, (byId.get('repo:core').x + byId.get('repo:web').x) / 2, 'el padre, centrado sobre sus hijos');
  assert.ok(byId.get('task').y < pagos.y && pagos.y < byId.get('repo:core').y);
  assert.equal(tree.links.length, tree.nodes.length - 1);
});

test('el grafo: lo que toca, lo que usa (core ← bff ← web), la infraestructura una vez por tecnología, lo que falta y lo que dijo el modelo; en capas', () => {
  const m = {
    departments: [{ id: 'p', name: 'Pagos', projects: [
      { id: 'core', name: 'payments-core', path: '/r/core', impacted: true, why: 'named', components: [{ name: 'api', impacted: true }] },
      { id: 'web', name: 'payments-web', path: '/r/web', impacted: true, why: 'uses', components: [] },
    ] }],
    systems: [{ id: 's', name: 'Pagos', impacted: true, parts: [
      { name: 'core', project: '/r/core', kind: 'backend', uses: [], impacted: 'touched' },
      { name: 'bff', project: '/r/bff', kind: 'bff', uses: ['core'], impacted: null },
      { name: 'web', project: '/r/web', kind: 'frontend', uses: ['bff'], impacted: 'uses' },
    ] }],
    resources: [
      { key: 'tech:Kafka', name: 'Kafka', kind: 'topic', tech: 'Kafka', techOnly: true, impacted: null, projects: [{ id: 'core', name: 'payments-core', how: 'uses' }, { id: 'web', name: 'payments-web', how: 'uses' }] },
      { key: 'topic:refund created', name: 'refund.created', kind: 'topic', tech: 'Kafka', impacted: 'named', state: 'planned', projects: [{ id: 'core', name: 'payments-core', how: 'owns' }] },
    ],
    unknown: [{ key: 'gateway', name: 'gateway', kind: 'component' }],
    links: [{ from: 'core', to: 'refund.created', label: 'publica' }],
  };
  const g = impactGraph(m, { title: 'pedido' });
  const ids = g.nodes.map((n) => n.id);
  assert.equal(ids.filter((id) => id === 'tech:Kafka').length, 1, 'Kafka, una vez');
  assert.ok(ids.includes('part:s:bff'), 'el bff que no está registrado, como dependencia del camino');
  const edge = (a, b) => g.edges.find((e) => e.from === a && e.to === b);
  assert.equal(edge('repo:web', 'part:s:bff')?.kind, 'uses');
  assert.equal(edge('part:s:bff', 'repo:core')?.kind, 'uses');
  assert.deepEqual([edge('repo:core', 'res:topic:refund created')?.label, edge('res:topic:refund created', 'tech:Kafka')?.kind], ['owns', 'runs']);
  assert.equal(edge('task', 'unknown:gateway')?.kind, 'unknown');
  assert.equal(g.nodes.find((n) => n.id === 'res:topic:refund created').state, 'new');
  assert.equal(edge('repo:core', 'res:topic:refund created').kind, 'link', 'el modelo dijo lo mismo: una sola flecha');
  const l = layoutGraph(g);
  const at = new Map(l.nodes.map((n) => [n.id, n]));
  assert.equal(at.get('task').x, 0);
  assert.ok(at.get('repo:web').x < at.get('part:s:bff').x && at.get('part:s:bff').x < at.get('repo:core').x, 'web → bff → core, en capas');
  for (const a of l.nodes) for (const b of l.nodes) if (a !== b && a.x === b.x) assert.ok(Math.abs(a.y - b.y) >= a.h, `${a.id} y ${b.id} no se encima`);
  // a cycle does not hang it
  assert.ok(layoutGraph({ nodes: [{ id: 'task' }, { id: 'a' }, { id: 'b' }], edges: [{ from: 'task', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }).width > 0);
});
