// bin/team.js: installs a *team pack* (a team's agents) into a harness's agents directory. It imports
// HARNESSES from devteam.mjs, whose os.homedir() is LAZY (evaluated inside dirs(), not on import), so
// this test gives it a fake HOME BEFORE the dynamic import, just like install.test.js: importing the
// module does not run the CLI, it only defines listTeams()/installTeam().
//
// The test pack is `example`, the GENERIC one (no vendor, model, methodology or domain pinned):
// so this test does not depend on any shipped pack and the external `--from <root>` path is covered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL_HOME = process.env.HOME;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-'));
process.env.HOME = HOME; // os.homedir() honors $HOME (darwin/linux): isolates the install from the real home

// Isolation ASSERTED, not assumed. devteam.mjs resolves os.homedir() lazily, but if this equality
// does not hold the test would silently write to the REAL home. Platform-bound contract:
// package.json declares "os": ["darwin", "linux"], the only engines where os.homedir() looks at
// $HOME. It is deliberately NOT skipped: a skip that passes silently is worse than this failure.
assert.equal(os.homedir(), HOME, 'os.homedir() ignoró $HOME: el aislamiento del install no rige en esta plataforma');

const { listTeams, installTeam, provisionTeam } = await import('../bin/team.js');
const { detectHarness, parseAgentFile, parseAgentToml } = await import('../integrations/common/devteam.mjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'teams', 'example', 'agents');

// The generic pack's 5 files, sorted: used to compare against readdirSync without depending on
// the order the filesystem returns.
const FILES = ['ex-architect.md', 'ex-backend.md', 'ex-explorer.md', 'ex-frontend.md', 'ex-qa.md'];

const USER_DEST = path.join(HOME, '.pi', 'agent', 'agents');
const PROJECTS = []; // project-scope temp dirs
const PACK_ROOTS = []; // external pack temp dirs (the `from` path)

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
  fs.rmSync(USER_DEST, { recursive: true, force: true }); // clean state, independent of the order
  const res = installTeam({ team: 'example', harness: 'pi' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(fs.readdirSync(USER_DEST).filter((f) => f.endsWith('.md')).sort(), FILES);
  for (const f of FILES) assert.ok(fs.existsSync(path.join(USER_DEST, f)), `${f} no llegó`);
  // never in a relative folder (the process's): the user destination is absolute
  assert.ok(res.lines.every((l) => path.isAbsolute(l.split(' -> ')[1])), res.lines.join('\n'));
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
    // vendor as-is: no renderer transforms the content
    assert.equal(content, fs.readFileSync(path.join(SRC, f), 'utf8'), `${f} no es byte-idéntico`);
    // `role:` and `tools:` survive as scalars in the frontmatter
    assert.ok(/^role: \S+/m.test(content), `${f}: falta role: en el frontmatter`);
    assert.ok(/^tools: [^,\n]+(?:, [^,\n]+)*$/m.test(content), `${f}: tools: no es escalar`);
    assert.ok(!/^tools:\s*\n\s*-/m.test(content), `${f}: tools: quedó como lista YAML`);
  }
});

// The same pack, in each harness's format: the office reads it back with team.json's role
const ROLES = { 'ex-architect': 'tl', 'ex-backend': 'backend', 'ex-frontend': 'frontend', 'ex-qa': 'qa', 'ex-explorer': 'analyst' };
const newProject = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-team-proj-'))); PROJECTS.push(dir); return dir; };
const rolesOf = (dir, harness) => Object.fromEntries(detectHarness(dir).subagents.filter((x) => x.harness === harness).map((x) => [x.name, [x.role, x.how]]));
const declared = Object.fromEntries(Object.entries(ROLES).map(([n, r]) => [n, [r, 'declared']]));

test('installTeam(claude): .claude/agents con las herramientas de Claude Code, el esfuerzo y el rol', () => {
  const project = newProject();
  const res = installTeam({ team: 'example', harness: 'claude', project });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.files.length, 5);
  const read = (n) => fs.readFileSync(path.join(project, '.claude', 'agents', `${n}.md`), 'utf8');
  // read, grep, find, ls → Read, Grep, Glob (no repeats); the description in quotes (it contains «:»)
  assert.match(read('ex-architect'), /^---\nname: ex-architect\ndescription: "Plans the work before implementing: [^"\n]+"\nrole: tl\ntools: Read, Grep, Glob\neffort: high\n---\n/);
  assert.match(read('ex-backend'), /^tools: Read, Write, Edit, Bash, Grep, Glob$/m);
  assert.match(read('ex-explorer'), /^effort: low$/m);
  assert.ok(!/^(thinking|mode):/m.test(read('ex-qa')), 'lo que es sólo de Pi no viaja');
  assert.ok(read('ex-qa').includes('You guarantee quality through **TDD**'), 'el system prompt va entero');
  assert.deepEqual(rolesOf(project, 'claude-code'), declared);
});

test('installTeam(opencode): subagentes con mode: subagent y lo de sólo lectura como permission', () => {
  const project = newProject();
  assert.equal(installTeam({ team: 'example', harness: 'opencode', project }).ok, true);
  const read = (n) => fs.readFileSync(path.join(project, '.opencode', 'agents', `${n}.md`), 'utf8');
  assert.match(read('ex-architect'), /^---\ndescription: "[^"\n]+"\nmode: subagent\nrole: tl\npermission:\n  edit: deny\n  bash: deny\n---\n/);
  assert.match(read('ex-qa'), /permission:\n  edit: deny\n---/, 'QA corre los tests pero no edita');
  assert.ok(!/permission:/.test(read('ex-backend')), 'backend escribe y corre comandos');
  assert.ok(!/^name:/m.test(read('ex-qa')), 'en OpenCode el nombre es el del archivo');
  assert.deepEqual(rolesOf(project, 'opencode'), declared);
});

test('installTeam(codex): un TOML por agente con developer_instructions y el rol en un comentario', () => {
  const project = newProject();
  assert.equal(installTeam({ team: 'example', harness: 'codex', project }).ok, true);
  const file = path.join(project, '.codex', 'agents', 'ex-backend.toml');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# dev-team-office role: backend\nname = "ex-backend"\ndescription = "[^"\n]+"\nmodel_reasoning_effort = "high"\ndeveloper_instructions = '''\n/);
  const a = parseAgentToml(text, file);
  assert.equal(a.prompt, parseAgentFile(fs.readFileSync(path.join(SRC, 'ex-backend.md'), 'utf8')).prompt);
  assert.deepEqual(rolesOf(project, 'codex'), declared);
});

test('installTeam(overwrite: false): no pisa un agente que ya existe con otro contenido', () => {
  const project = newProject();
  const mine = path.join(project, '.claude', 'agents', 'ex-qa.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, '---\nname: ex-qa\ndescription: el mío\n---\nmío\n');
  const res = installTeam({ team: 'example', harness: 'claude', project, overwrite: false });
  assert.deepEqual(res.kept, [mine]);
  assert.equal(res.files.length, 4);
  assert.match(fs.readFileSync(mine, 'utf8'), /el mío/);
});

test('provisionTeam: un agente sin subagentes con rol recibe el equipo de la oficina, una sola vez', () => {
  const project = newProject();
  const first = provisionTeam({ dir: project, harness: 'claude' });
  assert.equal(first.installed, true, JSON.stringify(first));
  assert.equal(first.team, 'Example Team');
  assert.equal(first.whole, true, 'no tenía ninguno: el pack entero');
  assert.equal(first.fresh, true, 'la carpeta de agentes no existía: Claude Code tiene que reiniciarse');
  assert.equal(first.dir, path.join(project, '.claude', 'agents'));
  assert.deepEqual(rolesOf(project, 'claude-code'), declared);
  // again: it already has a team
  assert.deepEqual(provisionTeam({ dir: project, harness: 'claude' }), { installed: false, reason: 'has-team', have: 5 });
  // the team is per harness: Pi does not have its own yet (without the one another test left in ~/.pi)
  fs.rmSync(USER_DEST, { recursive: true, force: true });
  assert.equal(provisionTeam({ dir: project, harness: 'pi' }).installed, true);
  assert.equal(fs.readdirSync(path.join(project, '.pi', 'agents')).length, 5);
});

test('provisionTeam: completa sólo los roles que le faltan (cuentan los del proyecto y los del usuario)', () => {
  const project = newProject();
  const dir = path.join(project, '.opencode', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reviewer.md'), '---\ndescription: Reviews every pull request\n---\nhola\n');
  // the reviewer is already a Tech Lead (by its description): it gets the other four
  const out = provisionTeam({ dir: project, harness: 'opencode' });
  assert.equal(out.installed, true, JSON.stringify(out));
  assert.equal(out.whole, false);
  assert.deepEqual(out.agents.map((x) => x.role).sort(), ['analyst', 'backend', 'frontend', 'qa']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['ex-backend.md', 'ex-explorer.md', 'ex-frontend.md', 'ex-qa.md', 'reviewer.md']);
  // with every role covered, nothing else
  assert.deepEqual(provisionTeam({ dir: project, harness: 'opencode' }), { installed: false, reason: 'has-team', have: 5 });
  // the user's ones (~/.claude/agents) count too
  const user = path.join(HOME, '.claude', 'agents');
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(user, 'qa.md'), '---\nname: qa\ndescription: tests\n---\nhola\n');
  try {
    const cc = provisionTeam({ dir: project, harness: 'claude' });
    assert.deepEqual(cc.agents.map((x) => x.name).sort(), ['ex-architect', 'ex-backend', 'ex-explorer', 'ex-frontend']);
    assert.ok(!fs.existsSync(path.join(project, '.claude', 'agents', 'ex-qa.md')));
  } finally {
    fs.rmSync(user, { recursive: true, force: true });
  }
  assert.equal(provisionTeam({ dir: project, harness: 'nadie' }).reason, 'unknown harness');
  assert.equal(provisionTeam({ dir: project, harness: 'codex', team: 'no-existe' }).reason, 'unknown team');
});

test('installTeam(team inexistente): ok:false', () => {
  const res = installTeam({ team: 'no-existe', harness: 'pi' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unknown team');
});

test('camino externo (`from`): lista e instala un pack fuera de teams/', () => {
  // prep: an external packs root, separate from the bundled teams/
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
