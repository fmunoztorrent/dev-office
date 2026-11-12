// What is yours (server/mine.js), not the company's: your private skills, installed in your personal
// folder of each agent (never in a project), and your own tools, which your agents use through the
// office's MCP server (my_<name>) and run where they work. Every test uses a temporary HOME.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.js';
import { Mine, runTool, toolSpec, personalSkillDirs, SKILL_MARK } from '../server/mine.js';
import { createMcp } from '../server/mcp.js';
import { startServer } from '../server/server.js';
import { exportSettings, importSettings } from '../server/settings-io.js';

/** A temporary HOME with Claude Code and Pi "installed" (their folders), and a project. */
function home({ agents = ['.claude', '.pi'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-mine-'));
  for (const a of agents) fs.mkdirSync(path.join(dir, a), { recursive: true });
  const project = path.join(dir, 'proyecto');
  fs.mkdirSync(project);
  return { dir, project };
}
const skillAt = (h, base, name) => path.join(h, base, 'skills', name, 'SKILL.md');

test('lo tuyo se valida: nombre, qué hace, el programa de una herramienta, sus parámetros y su tope', () => {
  const store = openStore(':memory:');
  try {
    const bad = (input) => store.saveMine(input).error;
    assert.match(bad({ kind: 'note', name: 'x1', title: 't' }), /skill o una herramienta/);
    assert.match(bad({ kind: 'skill', name: 'Con Espacios', title: 't' }), /minúsculas/);
    assert.match(bad({ kind: 'skill', name: 'revisar-pr', title: ' ' }), /qué hace/);
    assert.match(bad({ kind: 'tool', name: 'deploy', title: 'Despliega' }), /programa/);
    assert.match(bad({ kind: 'tool', name: 'deploy', title: 'Despliega', body: 'echo', config: { run: 'ruby' } }), /sh, bash, node, python3/);
    assert.match(bad({ kind: 'tool', name: 'deploy', title: 'Despliega', body: 'echo', config: { params: [{ name: 'con espacio' }] } }), /parámetro/);
    assert.match(bad({ kind: 'tool', name: 'deploy', title: 'Despliega', body: 'echo', config: { timeout: 9999 } }), /1 a 600/);
    const ok = store.saveMine({ kind: 'tool', name: 'deploy', title: 'Despliega a staging', body: 'echo "$1"', config: { run: 'bash', params: [{ name: 'env', description: 'staging o prod' }, { name: 'dry', required: false }], role: 'DevOps' } });
    assert.ok(ok.ok, ok.error);
    assert.deepEqual(ok.entry.config, { run: 'bash', params: [{ name: 'env', description: 'staging o prod', required: true }, { name: 'dry', description: '', required: false }], timeout: 60, role: 'devops' });
    // the same kind and name: the same one (updated); the same name as a skill: another one
    assert.equal(store.saveMine({ kind: 'tool', name: 'deploy', title: 'Despliega', body: 'echo hola' }).created, false);
    assert.equal(store.saveMine({ kind: 'skill', name: 'deploy', title: 'Cómo despliego' }).created, true);
    assert.deepEqual(store.listMine().map((e) => `${e.kind}:${e.name}`), ['skill:deploy', 'tool:deploy']);
  } finally { store.close(); }
});

test('una skill tuya se instala en tus carpetas personales (no en un proyecto), y apagarla o borrarla la saca', () => {
  const h = home();
  const store = openStore(':memory:');
  try {
    const mine = new Mine({ store, home: h.dir });
    assert.deepEqual(personalSkillDirs(h.dir).map((d) => d.dir), [path.join(h.dir, '.claude', 'skills'), path.join(h.dir, '.agents', 'skills')]);
    const out = mine.save({ kind: 'skill', name: 'revisar-pr', title: 'Revisa un PR como me gusta', body: '1. Lee el diff.\n2. Corre los tests.' });
    assert.ok(out.ok, out.error);
    assert.deepEqual(out.installed.map((x) => x.action), ['created', 'created']);
    const file = skillAt(h.dir, '.claude', 'revisar-pr');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^---\nname: revisar-pr\ndescription: "Revisa un PR como me gusta"\n---/);
    assert.ok(text.includes(SKILL_MARK) && text.includes('Corre los tests.'));
    assert.ok(fs.existsSync(skillAt(h.dir, '.agents', 'revisar-pr')));
    assert.ok(!fs.existsSync(path.join(h.project, '.claude')), 'nunca en un proyecto');
    // off: out of there; on again: back
    mine.save({ id: out.entry.id, kind: 'skill', name: 'revisar-pr', title: 'Revisa un PR como me gusta', enabled: false });
    assert.ok(!fs.existsSync(file));
    mine.save({ id: out.entry.id, kind: 'skill', name: 'revisar-pr', title: 'Revisa un PR como me gusta', body: 'otra', enabled: true });
    assert.ok(fs.existsSync(file));
    // renamed: the old one goes
    mine.save({ id: out.entry.id, kind: 'skill', name: 'revisar', title: 'Revisa un PR', body: 'otra' });
    assert.ok(!fs.existsSync(file) && fs.existsSync(skillAt(h.dir, '.claude', 'revisar')));
    // a skill of yours that is not the office's is never stepped on (nor deleted)
    const own = skillAt(h.dir, '.claude', 'commits');
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, '---\nname: commits\n---\nmía\n');
    const clash = mine.save({ kind: 'skill', name: 'commits', title: 'Commits' });
    assert.equal(clash.installed[0].reason, 'exists');
    mine.remove(clash.entry.id);
    assert.equal(fs.readFileSync(own, 'utf8'), '---\nname: commits\n---\nmía\n');
    // deleted: out of there
    mine.remove(store.findMine('skill', 'revisar').id);
    assert.ok(!fs.existsSync(skillAt(h.dir, '.claude', 'revisar')) && !fs.existsSync(path.join(h.dir, '.claude', 'skills', 'revisar')));
  } finally { store.close(); }
  // only the agents on this machine: without Pi, OpenCode or Codex, only Claude Code's folder
  assert.deepEqual(personalSkillDirs(home({ agents: ['.claude'] }).dir).map((d) => path.basename(path.dirname(d.dir))), ['.claude']);
});

test('una herramienta tuya corre con sus parámetros (en orden y como TOOL_<NOMBRE>), en la carpeta del agente, con su tope', async () => {
  const h = home();
  const tool = (run, body, extra = {}) => ({ name: 'saludo', title: 'Saluda', body, config: { run, params: [{ name: 'nombre', required: true }, { name: 'tono', required: false }], timeout: 5, ...extra } });
  const sh = await runTool(tool('sh', 'echo "hola $1 ($TOOL_TONO) en $(basename "$PWD")"'), { nombre: 'Ana', tono: 'suave' }, { cwd: h.project });
  assert.deepEqual([sh.code, sh.output.trim()], [0, 'hola Ana (suave) en proyecto']);
  const node = await runTool(tool('node', 'console.log(process.argv.slice(1).join("|"), process.env.TOOL_NOMBRE)'), { nombre: 'Ana' }, { cwd: h.project });
  assert.equal(node.output.trim(), 'Ana| Ana', 'un opcional que no viene llega vacío');
  const fail = await runTool(tool('bash', 'echo malo >&2; exit 3'), { nombre: 'x' }, { cwd: h.project });
  assert.deepEqual([fail.code, fail.output.trim()], [3, 'malo']);
  const missing = await runTool(tool('sh', 'echo x'), {}, { cwd: h.project });
  assert.ok(missing.invalid);
  assert.match(missing.output, /missing parameters: nombre/);
  const slow = await runTool({ ...tool('sh', 'sleep 5'), config: { run: 'sh', params: [], timeout: 1 } }, {}, { cwd: h.project });
  assert.equal(slow.timedOut, true);
  // the MCP tool that offers it
  const spec = toolSpec({ name: 'subir-version', title: 'Sube la versión', config: { run: 'sh', params: [{ name: 'parte', description: 'major, minor o patch', required: true }] } });
  assert.equal(spec.name, 'my_subir_version');
  assert.deepEqual(spec.inputSchema.required, ['parte']);
  assert.match(spec.description, /^Sube la versión — the user's own tool/);
});

test('el MCP ofrece tus herramientas a los agentes (my_<nombre>, list_my_tools, run_my_tool) y las corre donde trabajan', async () => {
  const h = home();
  const db = path.join(h.dir, 'office.db');
  const store = openStore(db);
  store.saveMine({ kind: 'tool', name: 'contar-archivos', title: 'Cuenta los archivos de la carpeta', body: 'ls -1 | wc -l | tr -d " "', config: { run: 'sh' } });
  store.saveMine({ kind: 'tool', name: 'apagada', title: 'No se ofrece', body: 'echo no', enabled: false });
  store.saveMine({ kind: 'skill', name: 'una-skill', title: 'No es una herramienta' });
  store.close();
  fs.writeFileSync(path.join(h.project, 'a.txt'), 'a');
  fs.writeFileSync(path.join(h.project, 'b.txt'), 'b');
  // the office is off: the MCP reads its database
  const mcp = createMcp({ base: 'http://127.0.0.1:9', socket: null, cwd: h.project, openStore: () => openStore(db), env: { PATH: process.env.PATH } });
  try {
    const list = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = list.result.tools.map((x) => x.name);
    assert.ok(names.includes('my_contar_archivos') && names.includes('list_my_tools') && names.includes('run_my_tool'));
    assert.ok(!names.includes('my_apagada') && !names.includes('my_una_skill'));
    const call = async (name, args = {}) => (await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).result;
    const r = await call('my_contar_archivos');
    assert.equal(r.content[0].text, 'contar-archivos: exit 0\n2');
    assert.ok(!r.isError);
    assert.equal((await call('run_my_tool', { name: 'contar-archivos' })).content[0].text, 'contar-archivos: exit 0\n2');
    assert.match((await call('list_my_tools')).content[0].text, /my_contar_archivos — Cuenta los archivos de la carpeta \(sh\)/);
    const none = await call('my_no_existe');
    assert.ok(none.isError);
  } finally { mcp.close(); }
});

test('por la API: lo tuyo se guarda, el MCP lee tus herramientas activas, y en el juego la usa el personaje que elegiste', async () => {
  const h = home();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, mine: { home: h.dir } });
  const call = (method, p, body) => fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const skill = await call('POST', '/v1/mine', { kind: 'skill', name: 'mi-estilo', title: 'Cómo me gusta el código', body: 'Funciones cortas.' });
    assert.equal(skill.status, 201);
    assert.ok(fs.existsSync(skillAt(h.dir, '.claude', 'mi-estilo')));
    const tool = await call('POST', '/v1/mine', { kind: 'tool', name: 'deploy', title: 'Despliega a staging', body: './deploy.sh "$1"', config: { params: [{ name: 'env' }], role: 'devops' } });
    assert.equal(tool.status, 201, tool.error);
    assert.equal((await call('POST', '/v1/mine', { kind: 'tool', name: 'Mal Nombre', title: 'x', body: 'x' })).status, 400);
    const all = await call('GET', '/v1/mine');
    assert.deepEqual([all.skills.length, all.tools.length, all.dirs.length], [1, 1, 2]);
    assert.deepEqual((await call('GET', '/v1/mine/tools')).tools.map((x) => x.name), ['deploy']);
    // an agent uses it: the character you chose does it, said in words, with its badge
    const [ev] = server.company.ingest('claude-code', { session_id: 'c1', cwd: h.project, hook_event_name: 'PreToolUse', tool_name: 'mcp__dev-team-office__my_deploy', tool_input: { env: 'staging' }, tool_use_id: 'u1' });
    assert.deepEqual([ev.role, ev.text, ev.badge], ['devops', 'Usando tu herramienta «deploy»', '🧰 deploy']);
    assert.equal((await call('DELETE', `/v1/mine/${tool.entry.id}`)).ok, true);
    assert.equal((await call('DELETE', `/v1/mine/${skill.entry.id}`)).ok, true);
    assert.ok(!fs.existsSync(skillAt(h.dir, '.claude', 'mi-estilo')));
  } finally { await server.close(); }
});

test('lo tuyo viaja en tu archivo de ajustes: se exporta y, al importarlo en otra máquina, tus skills se instalan ahí', () => {
  const a = home(), b = home({ agents: ['.claude'] });
  const one = openStore(':memory:'), two = openStore(':memory:');
  try {
    new Mine({ store: one, home: a.dir }).save({ kind: 'skill', name: 'mi-estilo', title: 'Cómo me gusta el código', body: 'Funciones cortas.' });
    one.saveMine({ kind: 'tool', name: 'deploy', title: 'Despliega', body: 'echo "$1"', config: { params: [{ name: 'env' }] } });
    const file = exportSettings(one);
    assert.deepEqual(file.mine.skills.map((x) => x.name), ['mi-estilo']);
    assert.deepEqual(file.mine.tools[0].config.params, [{ name: 'env', description: '', required: true }]);
    const out = importSettings(two, JSON.parse(JSON.stringify(file)), { mine: new Mine({ store: two, home: b.dir }) });
    assert.ok(out.ok);
    assert.deepEqual([out.applied.skills, out.applied.tools], [1, 1]);
    assert.ok(fs.existsSync(skillAt(b.dir, '.claude', 'mi-estilo')));
    assert.equal(two.findMine('tool', 'deploy').body, 'echo "$1"');
  } finally { one.close(); two.close(); }
});
