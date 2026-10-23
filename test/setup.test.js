// `dev-team-office setup`: connects every coding agent it finds (hooks, MCP, skills) with no manual
// steps, without overwriting what the user already had, idempotently; `uninstall` leaves everything as it was.
// Runs with a fake HOME (set BEFORE importing: install.js freezes its HOME when it loads).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REAL = { HOME: process.env.HOME, PATH: process.env.PATH, BIN: process.env.DEV_TEAM_OFFICE_BIN_DIR };
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-setup-')));
const BIN_DIR = path.join(HOME, '.local', 'bin');
process.env.HOME = HOME;
process.env.DEV_TEAM_OFFICE_BIN_DIR = BIN_DIR;
process.env.PATH = path.join(HOME, 'nada'); // no agent "installed": they are detected by their folder
assert.equal(os.homedir(), HOME, 'os.homedir() ignoró $HOME');

const { setup, uninstall, doctor, parseJsonc, shimPath, MARK } = await import('../bin/setup.js');
await import('./es.js');

after(() => {
  process.env.HOME = REAL.HOME;
  process.env.PATH = REAL.PATH;
  if (REAL.BIN === undefined) delete process.env.DEV_TEAM_OFFICE_BIN_DIR; else process.env.DEV_TEAM_OFFICE_BIN_DIR = REAL.BIN;
  fs.rmSync(HOME, { recursive: true, force: true });
});

const P = (...p) => path.join(HOME, ...p);
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const read = (f) => fs.readFileSync(f, 'utf8');

// what the user already had
const CLAUDE = P('.claude', 'settings.json');
const CODEX_TOML = P('.codex', 'config.toml');
const CODEX_HOOKS = P('.codex', 'hooks.json');
const OPENCODE = P('.config', 'opencode', 'opencode.jsonc');
const GEMINI = P('.gemini', 'settings.json');
const CURSOR = P('.cursor', 'mcp.json');
write(CLAUDE, JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mío' }] }] } }));
write(P('.claude.json'), JSON.stringify({ numStartups: 7, mcpServers: { otro: { command: 'x' } } }));
write(CODEX_TOML, 'model = "gpt-5"\n\n[mcp_servers.otro]\ncommand = "x"\n');
write(OPENCODE, '{\n  // mi config\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {\n    "docs": { "type": "remote", "url": "https://x" } // docs\n  }\n}\n');
write(GEMINI, '{"theme":"dark"}');
fs.mkdirSync(P('.cursor'), { recursive: true });
write(P('.pi', 'agent', 'mcp.json'), JSON.stringify({ mcpServers: { engram: { command: 'engram', args: ['mcp'], lifecycle: 'lazy' } } }));
const before = { claude: read(CLAUDE), toml: read(CODEX_TOML), opencode: read(OPENCODE), gemini: read(GEMINI), claudeJson: read(P('.claude.json')), piMcp: read(P('.pi', 'agent', 'mcp.json')) };

test('parseJsonc: comentarios y comas finales, sin tocar las barras dentro de los textos', () => {
  assert.deepEqual(parseJsonc('{ "a": "http://x//y", /* b */ "c": [1, 2,], // fin\n }'), { a: 'http://x//y', c: [1, 2] });
});

test('una simulación (--dry-run) no escribe nada', () => {
  const out = setup({ dry: true, cli: false });
  assert.equal(out.ok, true);
  assert.equal(fs.existsSync(shimPath()), false);
  assert.equal(read(CLAUDE), before.claude);
  assert.equal(read(CODEX_TOML), before.toml);
});

test('setup conecta cada agente encontrado sin pisar lo que había', () => {
  const out = setup({ cli: false });
  assert.equal(out.ok, true);
  const by = Object.fromEntries(out.agents.map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(by).sort(), ['claude-code', 'codex', 'cursor', 'gemini', 'opencode', 'pi']);
  for (const a of out.agents) assert.deepEqual(a.failed, [], `${a.id}: ${out.lines.join('\n')}`);

  // the stable launcher (used by the hooks and the MCP) and the command in ~/.local/bin
  const shim = shimPath();
  assert.ok(fs.statSync(shim).mode & 0o100);
  assert.equal(execFileSync(path.join(BIN_DIR, 'dev-team-office'), ['--version'], { env: { ...process.env, PATH: '/usr/bin:/bin' } }).toString().trim(), JSON.parse(read(path.join(import.meta.dirname, '..', 'package.json'))).version);

  // Claude Code: the office's hooks next to the user's, the MCP in ~/.claude.json and the skills
  const settings = json(CLAUDE);
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'echo mío');
  assert.match(settings.hooks.PreToolUse[1].hooks[0].command, /dev-team-office' hook claude-code$/);
  assert.equal(settings.hooks.Stop[0].hooks[0].timeout, 3600);
  const claudeJson = json(P('.claude.json'));
  assert.equal(claudeJson.numStartups, 7);
  assert.deepEqual(claudeJson.mcpServers[MARK], { type: 'stdio', command: shim, args: ['mcp'], env: {} });
  assert.ok(claudeJson.mcpServers.otro);
  assert.ok(fs.existsSync(P('.claude', 'skills', 'dev-team-office', 'SKILL.md')));
  assert.ok(fs.existsSync(P('.claude', 'skills', 'dev-team-office', 'office-event.mjs')));
  assert.ok(fs.existsSync(P('.dev-team-office', 'claude-code', 'hook.mjs')));
  assert.equal(read(`${CLAUDE}.${MARK}.bak`), before.claude, 'con respaldo');

  // Codex: its hook in hooks.json, the MCP table at the end of config.toml (the rest untouched), shared skills
  const toml = read(CODEX_TOML);
  assert.ok(toml.startsWith(before.toml.trimEnd()));
  assert.match(toml, /\[mcp_servers\.dev-team-office\]\ncommand = ".*dev-team-office"\nargs = \["mcp"\]/);
  assert.match(json(CODEX_HOOKS).hooks.PostToolUse[0].hooks[0].command, /hook codex$/);
  assert.ok(fs.existsSync(P('.dev-team-office', 'codex', 'hook.mjs')));
  assert.ok(fs.existsSync(P('.agents', 'skills', 'dev-team-office-config', 'SKILL.md')));

  // OpenCode: the .jsonc with comments is edited as text (the comments stay)
  const oc = read(OPENCODE);
  assert.match(oc, /\/\/ mi config/);
  assert.match(oc, /\/\/ docs/);
  assert.deepEqual(parseJsonc(oc).mcp[MARK], { type: 'local', command: [shim, 'mcp'], enabled: true });
  assert.ok(parseJsonc(oc).mcp.docs);
  assert.ok(fs.existsSync(P('.config', 'opencode', 'plugins', 'dev-team-office.js')));

  // Gemini and Cursor: only the MCP
  assert.equal(json(GEMINI).theme, 'dark');
  assert.deepEqual(json(GEMINI).mcpServers[MARK], { command: shim, args: ['mcp'] });
  assert.deepEqual(json(CURSOR).mcpServers[MARK], { command: shim, args: ['mcp'] });
  // Pi: its extension and the MCP (Pi 1.x's and pi-mcp-adapter read the same file), without touching anything else
  assert.ok(fs.existsSync(P('.pi', 'agent', 'extensions', 'dev-team-office.ts')));
  const piMcp = json(P('.pi', 'agent', 'mcp.json')).mcpServers;
  assert.deepEqual({ ...piMcp[MARK], description: undefined }, { command: shim, args: ['mcp'], description: undefined });
  assert.equal(typeof piMcp[MARK].description, 'string');
  assert.ok(piMcp.engram, 'los servidores que ya tenía Pi se quedan');
});

test('correrlo de nuevo no duplica nada', () => {
  const snap = () => [read(CLAUDE), read(CODEX_TOML), read(CODEX_HOOKS), read(OPENCODE), read(GEMINI), read(CURSOR), read(P('.claude.json')), read(P('.pi', 'agent', 'mcp.json'))];
  const first = snap();
  setup({ cli: false });
  assert.deepEqual(snap(), first);
});

test('el hook del lanzador nunca rompe al agente: sin oficina sale con 0 y en silencio', () => {
  const r = execFileSync(shimPath(), ['hook', 'codex'], { input: JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: HOME }), env: { ...process.env, DEV_TEAM_OFFICE_URL: 'http://127.0.0.1:9', PATH: '/usr/bin:/bin' } });
  assert.equal(r.toString(), '');
});

test('doctor revisa cada parte y uninstall deja todo como estaba (los datos se quedan)', async () => {
  const d = await doctor({ base: 'http://127.0.0.1:9' });
  const agentLines = d.checks.filter((c) => /Claude Code|Codex|OpenCode|Gemini|Cursor|Pi:/.test(c.text));
  assert.equal(agentLines.length, 6);
  assert.ok(agentLines.every((c) => c.ok), JSON.stringify(agentLines));
  assert.ok(d.checks.find((c) => /no está corriendo/.test(c.text)).optional, 'la oficina apagada no es una falla');

  write(P('.dev-team-office', 'office.db'), 'datos');
  const out = uninstall({ cli: false });
  assert.ok(out.lines.length > 5);
  assert.deepEqual(json(CLAUDE), JSON.parse(before.claude));
  assert.deepEqual(json(P('.claude.json')), JSON.parse(before.claudeJson));
  assert.equal(read(CODEX_TOML).trim(), before.toml.trim());
  assert.equal(fs.existsSync(CODEX_HOOKS) ? json(CODEX_HOOKS).hooks : undefined, undefined);
  assert.equal(read(OPENCODE), before.opencode);
  assert.equal(json(GEMINI).theme, 'dark');
  assert.deepEqual(json(GEMINI).mcpServers, {});
  assert.deepEqual(json(P('.pi', 'agent', 'mcp.json')), JSON.parse(before.piMcp));
  for (const f of [shimPath(), path.join(BIN_DIR, 'dev-team-office'), P('.agents', 'skills', 'dev-team-office'), P('.claude', 'skills', 'dev-team-office'), P('.pi', 'agent', 'extensions', 'dev-team-office.ts')]) assert.equal(fs.existsSync(f), false, f);
  assert.ok(fs.existsSync(P('.dev-team-office', 'office.db')), 'la base no se borra sin --purge');
});

test('un JSON roto no se pisa: se avisa y lo demás sigue; con el plugin de Claude Code no se duplica', () => {
  write(GEMINI, '{ esto no es json');
  write(P('.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'dev-team-office@dev-office': [{ scope: 'user' }] } }));
  const out = setup({ cli: false });
  const by = Object.fromEntries(out.agents.map((a) => [a.id, a]));
  assert.deepEqual(by.gemini.failed, ['mcp']);
  assert.equal(read(GEMINI), '{ esto no es json');
  assert.ok(out.lines.some((l) => /no es un JSON válido/.test(l)));
  assert.equal(by['claude-code'].plugin, true);
  assert.equal(JSON.stringify(json(CLAUDE).hooks).includes('dev-team-office'), false, 'el plugin ya trae los hooks');
  assert.deepEqual(by.codex.failed, []);
  uninstall({ cli: false });
});
