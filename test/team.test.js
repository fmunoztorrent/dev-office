// bin/team.js: instala un *team pack* (los agentes de un equipo) en el directorio de agentes de un
// harness. Importa HARNESSES de devteam.mjs, cuyo os.homedir() es LAZY (se evalúa dentro de dirs(),
// no al importar), así que este test le da un HOME de mentira ANTES del import dinámico igual que
// install.test.js: importar el módulo no corre el CLI, sólo define listTeams()/installTeam().
//
// El pack de prueba es `example`, el GENÉRICO (sin vendor, modelo, metodología ni dominio pinneados):
// así este test no depende de ningún pack vendido y el camino `--from <root>` externo queda cubierto.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL_HOME = process.env.HOME;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-'));
process.env.HOME = HOME; // os.homedir() respeta $HOME (darwin/linux): aísla el install del home real

// Aislamiento AFIRMADO, no supuesto. devteam.mjs resuelve os.homedir() de forma lazy, pero si esta
// igualdad no se cumple el test escribiría en el home REAL en silencio. Contrato acotado a
// plataforma: package.json declara "os": ["darwin", "linux"], los únicos motores donde
// os.homedir() mira $HOME. A propósito NO se salta: un skip que pasa callado es peor que este fallo.
assert.equal(os.homedir(), HOME, 'os.homedir() ignoró $HOME: el aislamiento del install no rige en esta plataforma');

const { listTeams, installTeam } = await import('../bin/team.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'teams', 'example', 'agents');

// Los 5 archivos del pack genérico, ordenados: sirve para comparar contra readdirSync sin depender
// del orden que devuelva el filesystem.
const FILES = ['ex-architect.md', 'ex-backend.md', 'ex-explorer.md', 'ex-frontend.md', 'ex-qa.md'];

const USER_DEST = path.join(HOME, '.pi', 'agent', 'agents');
const PROJECTS = []; // tmps de scope project
const PACK_ROOTS = []; // tmps de packs externos (camino `from`)

after(() => {
  process.env.HOME = REAL_HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
  for (const dir of PROJECTS) fs.rmSync(dir, { recursive: true, force: true });
  for (const dir of PACK_ROOTS) fs.rmSync(dir, { recursive: true, force: true });
});

test('listTeams(): incluye el pack example con sus 5 roles mapeados a los agentes del pack', () => {
  const teams = listTeams();
  const example = teams.find((t) => String(t.name).toLowerCase() === 'example team');
  assert.ok(example, `example no está en listTeams(): ${JSON.stringify(teams)}`);
  assert.deepEqual(
    Object.keys(example.roles).sort(),
    ['analyst', 'backend', 'frontend', 'qa', 'tl'],
  );
  assert.equal(example.roles.tl.agent, 'ex-architect');
  assert.equal(example.roles.backend.agent, 'ex-backend');
  assert.equal(example.roles.frontend.agent, 'ex-frontend');
  assert.equal(example.roles.qa.agent, 'ex-qa');
  assert.equal(example.roles.analyst.agent, 'ex-explorer');
});

test('installTeam(user scope): copia los 5 agentes a ~/.pi/agent/agents', () => {
  fs.rmSync(USER_DEST, { recursive: true, force: true }); // estado limpio, sin depender del orden
  const res = installTeam({ team: 'example', harness: 'pi' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(fs.readdirSync(USER_DEST).filter((f) => f.endsWith('.md')).sort(), FILES);
  for (const f of FILES) assert.ok(fs.existsSync(path.join(USER_DEST, f)), `${f} no llegó`);
});

test('installTeam(project scope): copia los 5 agentes a <project>/.pi/agents', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-proj-'));
  PROJECTS.push(project);
  const dest = path.join(project, '.pi', 'agents');
  const res = installTeam({ team: 'example', harness: 'pi', project });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(fs.readdirSync(dest).filter((f) => f.endsWith('.md')).sort(), FILES);
  for (const f of FILES) assert.ok(fs.existsSync(path.join(dest, f)), `${f} no llegó`);
});

test('installTeam(): escribe byte-idéntico al pack y conserva el frontmatter escalar', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-proj-'));
  PROJECTS.push(project);
  const dest = path.join(project, '.pi', 'agents');
  assert.equal(installTeam({ team: 'example', harness: 'pi', project }).ok, true);

  for (const f of FILES) {
    const content = fs.readFileSync(path.join(dest, f), 'utf8');
    // vendor as-is: ningún renderer transforma el contenido
    assert.equal(content, fs.readFileSync(path.join(SRC, f), 'utf8'), `${f} no es byte-idéntico`);
    // `role:` y `tools:` sobreviven como escalares en el frontmatter
    assert.ok(/^role: \S+/m.test(content), `${f}: falta role: en el frontmatter`);
    assert.ok(/^tools: [^,\n]+(?:, [^,\n]+)*$/m.test(content), `${f}: tools: no es escalar`);
    assert.ok(!/^tools:\s*\n\s*-/m.test(content), `${f}: tools: quedó como lista YAML`);
  }
});

for (const harness of ['opencode', 'claude']) {
  test(`installTeam(${harness}): no implementado → ok:false con /not supported/`, () => {
    const res = installTeam({ team: 'example', harness });
    assert.equal(res.ok, false);
    assert.match(res.error, /not supported/);
  });
}

test('installTeam(team inexistente): ok:false', () => {
  const res = installTeam({ team: 'no-existe', harness: 'pi' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unknown team');
});

test('camino externo (`from`): lista e instala un pack fuera de teams/', () => {
  // prep: una raíz de packs externa, ajena al teams/ empotrado
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-pack-'));
  PACK_ROOTS.push(root);
  const srcFile = path.join(root, 'mini', 'agents', 'mini.md');
  const srcContent = [
    '---',
    'name: mini',
    'role: tl',
    'tools: read',
    '---',
    '',
    'Mini agent used only to exercise the external pack path.',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(path.join(root, 'mini', 'team.json'), JSON.stringify({
    name: 'Mini',
    roles: { tl: { agent: 'mini' } },
  }));
  fs.writeFileSync(srcFile, srcContent);

  const listed = listTeams(root);
  assert.ok(
    listed.some((t) => t.name === 'Mini'),
    `'Mini' no está en listTeams(from): ${JSON.stringify(listed)}`,
  );

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-proj-'));
  PROJECTS.push(project);
  const dest = path.join(project, '.pi', 'agents');
  const res = installTeam({ team: 'mini', harness: 'pi', project, from: root });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(fs.readFileSync(path.join(dest, 'mini.md'), 'utf8'), srcContent, 'mini.md no es byte-idéntico');
});
