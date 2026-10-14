import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { loadProject } from '../server/project.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-settings-'));
process.env.DEV_TEAM_OFFICE_CONFIG = path.join(tmp, 'config.json'); // nunca el config real
const project = path.join(tmp, 'tienda');
fs.cpSync(path.join(here, '..', 'examples', 'tienda'), project, { recursive: true });

const call = (base, method, p, body, headers = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('⚙ Oficina: proyectos, directorio por defecto y comandos se guardan y aplican en caliente', async () => {
  const server = await startServer({ port: 0, socket: null });
  try {
    let r = await call(server.url, 'GET', '/v1/settings');
    assert.deepEqual(r.body.office.launchers.pi.command, ['pi', '-p', '{task}']);

    r = await call(server.url, 'PUT', '/v1/settings', { projects: [project], cwd: project, launchers: { pi: ['pi', '-p', '{task}', '--model', 'sonnet'] } });
    assert.equal(r.status, 200, r.body.error);
    const saved = JSON.parse(fs.readFileSync(process.env.DEV_TEAM_OFFICE_CONFIG, 'utf8'));
    assert.deepEqual(saved.projects, [project]);
    assert.equal(fs.statSync(process.env.DEV_TEAM_OFFICE_CONFIG).mode & 0o777, 0o600);

    // en caliente, sin reiniciar
    const tasks = await call(server.url, 'GET', '/v1/tasks');
    assert.equal(tasks.body.defaultCwd, project);
    const projects = await call(server.url, 'GET', '/v1/projects');
    assert.ok(projects.body.projects.some((p) => p.dir === project && p.hasConfig));

    // un comando sin {task} se rechaza y no toca el archivo
    r = await call(server.url, 'PUT', '/v1/settings', { launchers: { pi: ['pi', '-p'] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /\{task\}/);
    assert.deepEqual(JSON.parse(fs.readFileSync(process.env.DEV_TEAM_OFFICE_CONFIG, 'utf8')).launchers.pi.at(-1), 'sonnet');

    // volver al comando de fábrica
    r = await call(server.url, 'PUT', '/v1/settings', { launchers: { pi: null } });
    assert.equal(JSON.parse(fs.readFileSync(process.env.DEV_TEAM_OFFICE_CONFIG, 'utf8')).launchers, undefined);

    // un sitio web ajeno no puede cambiar la configuración
    r = await call(server.url, 'PUT', '/v1/settings', { cwd: '/' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  } finally {
    await server.close();
  }
});

test('⚙ Proyecto: equipo por rol y pipelines (validar, guardar, borrar)', async () => {
  const server = await startServer({ port: 0, socket: null, projects: [project] });
  try {
    let r = await call(server.url, 'GET', `/v1/settings/project?dir=${encodeURIComponent(project)}`);
    assert.ok(r.body.agents.pi.some((a) => a.name === 'tester'));
    assert.equal(r.body.pipelines.length, 3);

    r = await call(server.url, 'PUT', '/v1/settings/team', {
      dir: project,
      team: { name: 'Tienda', harness: 'pi', maxParallel: 2, roles: { qa: { agent: 'tester', model: 'anthropic/claude-sonnet-5-5' }, arquitecto: { agent: 'architect' } }, harnessOptions: { claude: { args: ['--permission-mode', 'plan'] } } },
    });
    assert.equal(r.status, 200, r.body.error);
    const p = loadProject(project);
    assert.equal(p.team.roles.tl.agent, 'architect'); // alias de rol normalizado
    assert.deepEqual(p.team.harnessOptions['claude-code'].args, ['--permission-mode', 'plan']);
    assert.equal(p.pipelines.find((x) => x.id === 'feature-tdd').stages.find((s) => s.id === 'red').model, 'anthropic/claude-sonnet-5-5');

    r = await call(server.url, 'PUT', '/v1/settings/team', { dir: project, team: { maxParallel: 99 } });
    assert.equal(r.status, 400);

    const broken = { stages: [{ id: 'a', role: 'qa', needs: ['b'] }, { id: 'b', role: 'qa', needs: ['a'] }] };
    r = await call(server.url, 'POST', '/v1/settings/pipeline/check', { dir: project, id: 'roto', pipeline: broken });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /ciclo/);
    r = await call(server.url, 'PUT', '/v1/settings/pipeline', { dir: project, id: 'roto', pipeline: broken });
    assert.equal(r.status, 400);

    r = await call(server.url, 'PUT', '/v1/settings/pipeline', { dir: project, id: 'nuevo', pipeline: { name: 'Nuevo', stages: [{ id: 'x', role: 'backend' }] } });
    assert.equal(r.status, 200, r.body.error);
    assert.ok(fs.existsSync(path.join(project, '.devteam', 'pipelines', 'nuevo.json')));
    r = await call(server.url, 'DELETE', '/v1/settings/pipeline', { dir: project, id: 'nuevo' });
    assert.equal(r.status, 200);
    assert.ok(!fs.existsSync(path.join(project, '.devteam', 'pipelines', 'nuevo.json')));

    // sólo en proyectos que la oficina conoce
    r = await call(server.url, 'PUT', '/v1/settings/team', { dir: tmp, team: {} });
    assert.equal(r.status, 404);
  } finally {
    await server.close();
  }
});
