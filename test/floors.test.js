// The two floors every office shares: the executive one (a directive goes to several offices'
// projects at once and its minutes end up in the archive) and the archive (the company's knowledge,
// its skills and its connectors, installed in each project in its agent's format).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.js';
import { startServer } from '../server/server.js';
import { Archive, installSkill, installConnector, skillFile } from '../server/archive.js';
import { DirectiveDesk, directiveStatus } from '../server/directives.js';
import { createMcp } from '../server/mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');
const tmp = (p = 'dto-floors-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const read = (f) => fs.readFileSync(f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(25); }
}
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

// ---------------------------------------------------------------- the archive in the database

test('el archivo: notas, skills y conectores validados; una skill con el mismo nombre se actualiza', () => {
  const store = openStore(':memory:');
  const note = store.createKnowledge({ kind: 'note', title: 'Cómo desplegamos', body: 'Con el pipeline de GitHub a staging y luego a producción', tags: 'deploy, CI' });
  assert.equal(note.ok, true, note.error);
  assert.deepEqual(note.entry.tags, ['deploy', 'ci']);
  for (const [bad, rx] of [
    [{ kind: 'meme', title: 'x' }, /tipo desconocido/], [{ kind: 'note' }, /ponle un título/],
    [{ kind: 'connector', name: 'jira', title: 'Jira' }, /un comando .* o una URL/], [{ kind: 'connector', name: 'x', title: 'X', url: 'ftp://x' }, /http/],
    [{ kind: 'note', title: 'x', office: 'nada' }, /departamento \(oficina\) desconocido/],
  ]) assert.match(store.createKnowledge(bad).error, rx, JSON.stringify(bad));

  const s1 = store.createKnowledge({ kind: 'skill', name: 'Deploy Staging', title: 'Desplegar a staging', body: '1. npm run deploy' });
  assert.equal(s1.entry.name, 'deploy-staging');
  const s2 = store.createKnowledge({ kind: 'skill', name: 'deploy-staging', title: 'Desplegar a staging (v2)', body: '1. make deploy' });
  assert.equal(s2.created, false, 'mismo nombre: la actualiza');
  assert.equal(s2.entry.id, s1.entry.id);
  assert.equal(store.findKnowledge('skill', 'deploy-staging').body, '1. make deploy');
  const c = store.createKnowledge({ kind: 'connector', name: 'issues', title: 'Los issues', command: 'npx -y issues-mcp', args: [] });
  assert.equal(c.ok, true, c.error);
  assert.deepEqual(c.entry.config, { command: 'npx -y issues-mcp', args: [] });
  assert.deepEqual(store.createKnowledge({ kind: 'connector', name: 'docs', title: 'Docs', url: 'https://mcp.example.com/mcp' }).entry.config, { url: 'https://mcp.example.com/mcp' });

  // the search: every word counts, more in the title than in the body; without accents or case
  store.createKnowledge({ kind: 'decision', title: 'Usamos PostgreSQL', body: 'no MySQL', tags: ['db'] });
  assert.deepEqual(store.listKnowledge({ q: 'staging' }).map((e) => e.kind), ['skill', 'note'], 'el título pesa más que el texto');
  assert.equal(store.listKnowledge({ q: 'POSTGRESQL' })[0].kind, 'decision');
  assert.equal(store.listKnowledge({ q: 'cómo' })[0].id, note.entry.id, 'sin tildes: como = cómo');
  assert.deepEqual(store.listKnowledge({ q: 'nada que ver' }), []);
  assert.deepEqual(store.knowledgeCounts(), { note: 1, decision: 1, doc: 0, term: 0, minute: 0, skill: 1, connector: 2 });
  // an office's entries: its own plus the whole company's
  store.createOffice({ name: 'Pagos' });
  store.createKnowledge({ kind: 'note', title: 'Sólo de pagos', office: 'Pagos' });
  assert.equal(store.listKnowledge({ office: 'main' }).length, 5);
  assert.equal(store.listKnowledge({ office: 'pagos' }).length, 6);
  assert.equal(store.deleteKnowledge(note.entry.id).ok, true);
  assert.equal(store.getKnowledge(note.entry.id), null);
});

// ---------------------------------------------------------------- installing in a project

test('una skill se instala en el formato de cada agente y no pisa la del proyecto', () => {
  const dir = tmp();
  const e = { name: 'deploy-staging', title: 'Desplegar: "staging"', body: 'Pasos' };
  const cc = installSkill(e, { dir, harness: 'claude-code' });
  assert.deepEqual([cc.ok, cc.action, path.relative(dir, cc.file)], [true, 'created', '.claude/skills/deploy-staging/SKILL.md']);
  assert.match(read(cc.file), /^---\nname: deploy-staging\ndescription: "Desplegar: \\"staging\\""\n---/);
  assert.equal(installSkill(e, { dir, harness: 'claude-code' }).action, 'same');
  assert.equal(installSkill({ ...e, body: 'Otros pasos' }, { dir, harness: 'claude-code' }).action, 'updated');
  for (const h of ['pi', 'opencode', 'codex']) assert.equal(path.relative(dir, installSkill(e, { dir, harness: h }).file), '.agents/skills/deploy-staging/SKILL.md');
  // the project's own skill with that name stays
  const own = path.join(dir, '.claude', 'skills', 'mia', 'SKILL.md');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '---\nname: mia\n---\nla mía');
  assert.deepEqual(installSkill({ name: 'mia', title: 'x', body: 'y' }, { dir, harness: 'claude-code' }), { ok: false, reason: 'exists', file: own });
  assert.equal(read(own), '---\nname: mia\n---\nla mía');
  assert.match(skillFile(e), /dev-team-office archive: deploy-staging/);
});

test('un conector se agrega a la config MCP de cada agente sin tocar lo demás', () => {
  const dir = tmp();
  const local = { name: 'issues', config: { command: 'npx', args: ['-y', 'issues-mcp'] } };
  const remote = { name: 'docs', config: { url: 'https://mcp.example.com/mcp' } };
  // Claude Code: .mcp.json, keeping what was there
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { otro: { command: 'x' } } }));
  assert.equal(installConnector(local, { dir, harness: 'claude-code' }).action, 'updated');
  assert.equal(installConnector(remote, { dir, harness: 'claude-code' }).ok, true);
  assert.deepEqual(JSON.parse(read(path.join(dir, '.mcp.json'))).mcpServers, { otro: { command: 'x' }, issues: { command: 'npx', args: ['-y', 'issues-mcp'] }, docs: { type: 'http', url: 'https://mcp.example.com/mcp' } });
  assert.equal(installConnector(local, { dir, harness: 'claude-code' }).action, 'same');
  assert.equal(installConnector({ ...local, config: { command: 'otro' } }, { dir, harness: 'claude-code' }).reason, 'exists', 'otro con ese nombre: no se pisa');
  // Pi: .pi/mcp.json · OpenCode: opencode.json · Codex: .codex/config.toml
  installConnector(local, { dir, harness: 'pi' });
  assert.deepEqual(JSON.parse(read(path.join(dir, '.pi', 'mcp.json'))).mcpServers.issues, { command: 'npx', args: ['-y', 'issues-mcp'] });
  installConnector(remote, { dir, harness: 'opencode' });
  const oc = JSON.parse(read(path.join(dir, 'opencode.json')));
  assert.equal(oc.$schema, 'https://opencode.ai/config.json');
  assert.deepEqual(oc.mcp.docs, { type: 'remote', url: 'https://mcp.example.com/mcp', enabled: true });
  fs.mkdirSync(path.join(dir, '.codex'));
  fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), 'model = "o3"\n');
  installConnector(local, { dir, harness: 'codex' });
  assert.equal(read(path.join(dir, '.codex', 'config.toml')), 'model = "o3"\n\n[mcp_servers.issues]\ncommand = "npx"\nargs = ["-y", "issues-mcp"]\n');
  assert.equal(installConnector(local, { dir, harness: 'codex' }).action, 'same');
  // OpenCode with comments in opencode.jsonc: by hand
  const other = tmp();
  fs.writeFileSync(path.join(other, 'opencode.jsonc'), '{ // mío\n}');
  assert.equal(installConnector(local, { dir: other, harness: 'opencode' }).reason, 'manual');
  fs.writeFileSync(path.join(other, '.mcp.json'), '{ roto');
  assert.equal(installConnector(local, { dir: other, harness: 'claude-code' }).reason, 'invalid');
});

test('Archive.install: en los proyectos registrados elegidos, con el resultado de cada uno', () => {
  const store = openStore(':memory:');
  const [a, b] = [tmp(), tmp()];
  const pa = store.createAgent({ path: a, harness: 'claude-code', name: 'api' }).agent;
  const pb = store.createAgent({ path: b, harness: 'pi', name: 'web' }).agent;
  const forgot = [];
  const archive = new Archive({ store, registry: { forget: (d) => forgot.push(d) } });
  const seen = [];
  archive.on('installed', (e, results) => seen.push([e.name, results.length]));
  const skill = archive.save({ kind: 'skill', name: 'review', title: 'Revisar PRs', body: 'x' }).entry;
  const out = archive.install(skill.id, [pa.id, pb.id, 'nadie']);
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((r) => [r.target, r.ok, r.action || r.reason]), [[pa.id, true, 'created'], [pb.id, true, 'created'], ['nadie', false, 'unknown']]);
  assert.ok(fs.existsSync(path.join(a, '.claude', 'skills', 'review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(b, '.agents', 'skills', 'review', 'SKILL.md')));
  assert.deepEqual(forgot, [a, b], 'lo que trae cada carpeta se vuelve a leer');
  assert.deepEqual(seen, [['review', 3]]);
  const note = archive.save({ kind: 'note', title: 'n' }).entry;
  assert.match(archive.install(note.id, [pa.id]).error, /sólo las skills y los conectores/);
  assert.match(archive.install(skill.id, []).error, /elige al menos/);
  // summaries: without the body, with its first words
  const long = archive.save({ kind: 'doc', title: 'Largo', body: 'palabra '.repeat(100) }).entry;
  const sum = archive.list({ kind: 'doc' }).find((e) => e.id === long.id);
  assert.equal(sum.body, undefined);
  assert.ok(sum.excerpt.length <= 240 && sum.excerpt.endsWith('…'));
  // a read by an agent counts
  assert.equal(archive.get(long.id, { touch: true }).uses, 1);
  assert.equal(store.getKnowledge(long.id).uses, 1);
});

// ---------------------------------------------------------------- directives

test('una directiva va a cada proyecto elegido, sigue sus tareas y deja su acta en el archivo', () => {
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  const api = store.createAgent({ path: tmp(), harness: 'claude-code', name: 'api' }).agent;
  const web = store.createAgent({ path: tmp(), harness: 'pi', name: 'web', office: 'Pagos' }).agent;
  const cli = store.createAgent({ path: tmp(), harness: 'codex', name: 'cli', office: 'Pagos' }).agent;
  const hub = Object.assign(new EventEmitter(), { tasks: new Map(), cancelled: [], cancel(id) { this.cancelled.push(id); return { ok: true }; } });
  const sent = [];
  let n = 0;
  const registry = {
    run(msg) {
      sent.push(msg);
      if (msg.target === cli.id) return { ok: false, error: 'no encuentro "codex" en el PATH' };
      const task = { id: `t${++n}`, status: 'running', detail: '' };
      hub.tasks.set(task.id, task);
      return { ok: true, task };
    },
  };
  const archive = new Archive({ store, registry });
  const desk = new DirectiveDesk({ store, registry, hub, archive, company: { info: (id) => ({ name: id === 'pagos' ? 'Pagos' : 'Principal' }) } });
  const ended = [];
  desk.on('ended', (d) => ended.push(d));

  assert.match(desk.create({ text: 'x' }).error, /elige al menos/);
  assert.match(desk.create({ text: 'x', offices: ['marte'] }).error, /departamento \(oficina\) desconocido/);
  assert.match(desk.create({ text: '' }).error, /vacía/);

  const out = desk.create({ text: 'Que todas las APIs expongan /health', offices: ['Pagos'], targets: [api.id] });
  assert.equal(out.ok, true, out.error);
  const d = out.directive;
  assert.deepEqual(d.parts.map((p) => [p.name, p.office, p.status]), [['api', 'main', 'running'], ['cli', 'pagos', 'failed'], ['web', 'pagos', 'running']]);
  assert.equal(d.status, 'running');
  // each brief says it is a directive, who else works on it, and the text
  const brief = sent.find((m) => m.target === web.id);
  assert.match(brief.text, /^🏛 Directiva de la dirección: «Que todas las APIs expongan \/health»\. También la trabajan: api, cli\./);
  assert.match(brief.text, /\n\nQue todas las APIs expongan \/health$/);
  assert.equal(brief.from, 'Dirección');
  assert.equal(brief.title, '🏛 Que todas las APIs expongan /health', 'en la pizarra, sólo la orden');

  // the tasks end: the directive follows them
  hub.tasks.get('t1').status = 'done';
  hub.emit('change');
  assert.equal(desk.get(d.id).status, 'running');
  hub.tasks.get('t2').status = 'done';
  hub.emit('change');
  const end = desk.get(d.id);
  assert.deepEqual([end.status, end.done, end.total], ['partial', 2, 3]);
  assert.equal(ended.length, 1);
  const minute = store.listKnowledge({ kind: 'minute' })[0];
  assert.equal(minute.title, 'Acta: Que todas las APIs expongan /health');
  assert.match(minute.body, /- cli \(Pagos\): falló — no encuentro "codex" en el PATH/);
  assert.equal(store.getDirective(d.id).status, 'partial', 'queda guardada');

  // cancelling: what is still running
  const two = desk.create({ text: 'Actualizar el logger', targets: [api.id, web.id] }).directive;
  assert.equal(desk.cancel(two.id).directive.status, 'cancelled');
  assert.deepEqual(hub.cancelled, ['t3', 't4']);
  assert.match(desk.cancel(two.id).error, /no se puede cancelar/);
  assert.equal(directiveStatus([{ status: 'done' }, { status: 'done' }]), 'done');
  assert.equal(directiveStatus([{ status: 'failed' }, { status: 'cancelled' }]), 'failed');

  // what was running when the office closed is marked as interrupted when it opens again
  desk.create({ text: 'A medias', targets: [api.id] });
  const again = new DirectiveDesk({ store, registry, hub, archive });
  assert.equal(again.list().find((x) => x.title === 'A medias').status, 'interrupted');
});

// ---------------------------------------------------------------- the API, the WebSocket and MCP

test('API: directivas a varias oficinas, el archivo y lo que cuentan los pisos', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  const base = server.url;
  process.env.FAKE_CLAUDE_LOG = path.join(tmp(), 'claude.log');
  try {
    const floor = [];
    server.bus.on('floor', (ev) => floor.push(ev));
    await call(base, 'POST', '/v1/offices', { name: 'Pagos' });
    const [d1, d2] = [tmp(), tmp()];
    const a1 = (await call(base, 'POST', '/v1/agents', { path: d1, harness: 'claude-code', name: 'api', bin: FAKE_CLAUDE })).body.agent;
    const a2 = (await call(base, 'POST', '/v1/agents', { path: d2, harness: 'claude-code', name: 'pagos-api', office: 'Pagos', bin: FAKE_CLAUDE })).body.agent;

    const r = await call(base, 'POST', '/v1/directives', { text: 'Agregar /health', offices: ['all'] });
    assert.equal(r.status, 201, r.body.error);
    assert.deepEqual(r.body.directive.parts.map((p) => [p.target, p.kind]).sort(), [[a1.id, 'task'], [a2.id, 'task']]);
    // each brief goes to its office (the board of that office shows it)
    const tasks = server.hub.snapshot().tasks;
    assert.deepEqual(tasks.map((x) => x.office).sort(), ['main', 'pagos']);
    // the fake CLI ends: the directive is accomplished and its minutes are archived
    const done = await until(async () => { const x = (await call(base, 'GET', '/v1/directives')).body; return x.directives[0].status === 'done' && x; });
    assert.equal(done.overview.length, 2);
    assert.deepEqual(floor.filter((e) => e.floor === 'exec').map((e) => e.kind), ['department', 'directive', 'directive_end'], 'operations takes note of the new department, then the directive');
    assert.equal((await call(base, 'GET', '/v1/knowledge?kind=minute')).body.entries.length, 1);
    const logged = read(process.env.FAKE_CLAUDE_LOG).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(logged.length, 2);
    assert.ok(logged.every((x) => x.args[1].includes('🏛') && x.args[1].includes('Agregar /health')), 'cada agente recibe su parte');
    assert.deepEqual(logged.map((x) => x.cwd).sort(), [d1, d2].sort());

    // the archive over HTTP: save, search (an agent's search is told), read, install, delete
    const s = await call(base, 'POST', '/v1/knowledge', { kind: 'skill', name: 'health', title: 'Endpoint /health', body: 'GET /health → 200' });
    assert.equal(s.status, 201, s.body.error);
    assert.equal(s.body.entry.source, 'Tú');
    const found = await call(base, 'GET', '/v1/knowledge?q=health&from=agent');
    assert.equal(found.body.entries[0].id, s.body.entry.id);
    assert.equal(found.body.counts.skill, 1);
    assert.equal((await call(base, 'GET', `/v1/knowledge/${s.body.entry.id}?from=agent`)).body.entry.uses, 1);
    const inst = await call(base, 'POST', `/v1/knowledge/${s.body.entry.id}/install`, { targets: [a1.id] });
    assert.equal(inst.status, 200, inst.body.error);
    assert.ok(fs.existsSync(path.join(d1, '.claude', 'skills', 'health', 'SKILL.md')));
    assert.equal((await call(base, 'PUT', `/v1/knowledge/${s.body.entry.id}`, { title: 'Endpoint /health (v2)' })).body.entry.title, 'Endpoint /health (v2)');
    assert.equal((await call(base, 'DELETE', `/v1/knowledge/${s.body.entry.id}`)).status, 200);
    assert.equal((await call(base, 'GET', `/v1/knowledge/${s.body.entry.id}`)).status, 404);
    assert.deepEqual(floor.filter((e) => e.floor === 'archive').map((e) => e.kind), ['saved', 'saved', 'search', 'read', 'installed', 'saved', 'removed']);
    // the state viewers get carries both floors
    const st = server.fullState();
    assert.ok(Array.isArray(st.directives) && Array.isArray(st.overview) && st.archive.counts);
    // the floor being watched is saved
    assert.equal(server.setPrefs({ view: { floor: 'archive' } }).prefs.view.floor, 'archive');
    assert.match(server.setPrefs({ view: { floor: 'sótano' } }).error, /view.floor/);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
    await server.close();
  }
});

test('MCP: un agente busca, lee y guarda en el archivo (con la oficina cerrada también) y manda directivas', async () => {
  // offline: straight to the database
  const db = path.join(tmp(), 'office.db');
  const offline = createMcp({ base: 'http://127.0.0.1:9', socket: null, openStore: () => openStore(db), env: {} });
  await offline.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
  const tool = async (mcp, name, args) => (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  let r = await tool(offline, 'save_knowledge', { kind: 'decision', title: 'Las fechas van en UTC', body: 'Siempre ISO 8601', tags: ['fechas'] });
  assert.match(r.content[0].text, /Saved in the archive: .* \[decision\] Las fechas van en UTC · the office is offline/);
  r = await tool(offline, 'search_knowledge', { query: 'utc' });
  // the passage that answers it, with its id to cite
  assert.match(r.content[0].text, /^\[k\w+§1\] Las fechas van en UTC \(company\)\n {4}Siempre ISO 8601\n/);
  const id = r.content[0].text.match(/^\[([^\]]+)\]/)[1]; // get_knowledge takes the citation too
  r = await tool(offline, 'get_knowledge', { id });
  assert.match(r.content[0].text, /Siempre ISO 8601/);
  assert.equal((await tool(offline, 'send_directive', { text: 'x', offices: ['all'] })).isError, true, 'una directiva necesita la oficina');
  offline.close();

  // with the office running: what it saved is there, and a directive goes through the API
  const server = await startServer({ port: 0, socket: null, db, weather: false, places: false });
  try {
    const mcp = createMcp({ base: server.url, socket: null, env: {} });
    await mcp.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { clientInfo: { name: 'pi' } } });
    assert.equal(server.archive.counts().decision, 1);
    await tool(mcp, 'save_knowledge', { kind: 'skill', name: 'fechas', title: 'Fechas en UTC', body: 'Usa toISOString()' });
    r = await tool(mcp, 'get_knowledge', { name: 'fechas' });
    assert.match(r.content[0].text, /\[skill\] fechas — Fechas en UTC/);
    assert.equal(server.store.findKnowledge('skill', 'fechas').source, 'pi');
    r = await tool(mcp, 'send_directive', { text: 'x', projects: ['/no/existe'] });
    assert.match(r.content[0].text, /no registered project/);
    r = await tool(mcp, 'list_directives', {});
    assert.match(r.content[0].text, /No directives yet/);
  } finally {
    await server.close();
  }
});

test('el monitor de la terminal cuenta las directivas en curso y lo que guarda el archivo, y cuenta sus noticias', async () => {
  const { createMonitor, renderMonitor } = await import('../tui/monitor.js');
  const mon = createMonitor();
  mon.snapshot({ directives: [{ status: 'running' }, { status: 'done' }], archive: { counts: { note: 2, skill: 1 } } });
  const n = mon.counts();
  assert.deepEqual([n.directives, n.knowledge], [1, 3]);
  mon.floorEvent({ floor: 'exec', kind: 'directive', text: 'Agregar /health', total: 2, offices: ['Principal', 'Pagos'] });
  mon.floorEvent({ floor: 'archive', kind: 'saved', text: 'Minuta', entryKind: 'minute' });
  assert.deepEqual(mon.model.log.map((l) => l.text), ['🏛 Directiva «Agregar /health» a 2 proyecto(s): Principal, Pagos'], 'las actas no se cuentan');
  const screen = renderMonitor(mon, { cols: 240, rows: 30, color: false, now: Date.now() }).join('\n');
  assert.match(screen, /🏛 1 directiva\(s\) en curso/);
  assert.match(screen, /📚 3 en el archivo/);
});

test('la sesión que recibe su parte de una directiva se titula con la orden, sin el encabezado', async () => {
  const { Office } = await import('../server/office.js');
  const office = new Office();
  office.ingest('pi', { session: 's1', cwd: tmp(), kind: 'task', text: '🏛 Directiva de la dirección: «Agregar /health». También la trabajan: web. Haz la parte de este proyecto.\n\nAgregar /health a la API' });
  assert.equal(office.sessions.get('s1').title, '🏛 Agregar /health a la API');
});

test('en la vista cenital los pisos compartidos tienen el pasillo de la oficina: un clic en su ascensor abre el panel de pisos', async () => {
  const { createFloors, floorHit } = await import('../public/floors.js');
  const { isoCamera, BACK } = await import('../public/iso.js');
  const { ELEVATOR } = await import('../public/sim.js');
  const cam = isoCamera();
  const floors = createFloors({ clock: () => 0 });
  for (const kind of ['exec', 'archive']) {
    const [x, y] = cam.proj(ELEVATOR.x + ELEVATOR.w / 2, BACK, 60); // the middle of its doors, on the back wall
    assert.deepEqual(floorHit(floors[kind], x, y, { iso: true, cam }), { what: 'lift' }, kind);
    assert.equal(floorHit(floors[kind], ELEVATOR.x + ELEVATOR.w / 2, 60, { iso: false }), null, 'en la vista frontal no hay pasillo');
  }
});

test('la salud de cada departamento en dirección: errores de la última hora, el contexto que le queda y cuánto te espera', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const ev = (e) => server.company.ingest('generic', { session: 's1', source: 'claude', cwd: '/tmp/tienda', ...e });
    const main = () => server.overview().find((o) => o.id === 'main');
    ev({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando' });
    assert.deepEqual([main().health, main().errors, main().context], ['ok', 0, null]);
    for (let i = 0; i < 3; i++) ev({ kind: 'tool_end', role: 'backend', tool: 'Bash', ok: false });
    ev({ kind: 'phase', role: 'qa', phase: 'red', text: 'Tests en rojo' });
    ev({ kind: 'tool_end', role: 'qa', tool: 'Bash', ok: false }); // a red test in TDD is no error
    assert.deepEqual([main().health, main().errors], ['warn', 3]);
    ev({ kind: 'context', context: { used: 190_000, max: 200_000 } });
    assert.equal(main().context, 0.05);
    assert.equal(main().health, 'bad', 'casi sin contexto');
    ev({ kind: 'context', context: { used: 20_000, max: 200_000 } }); // compacted
    assert.deepEqual([main().context, main().health], [0.9, 'warn']);
  } finally { await server.close(); }
});
