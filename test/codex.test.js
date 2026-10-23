// Codex: its hooks (the same events as Claude Code, with its own tools: shell, apply_patch,
// update_plan…) reach the office, and its TOML agents declare their role like the others.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adapt } from '../server/adapters.js';
import { Office } from '../server/office.js';
import { startServer } from '../server/server.js';
import { parseAgentToml, detectHarness } from '../integrations/common/devteam.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'integrations', 'codex', 'hook.mjs');
// the server runs in this same process: the hook has to run without blocking it
const runHook = (env, input) => new Promise((resolve, reject) => {
  const child = execFile(process.execPath, [HOOK], { env }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  child.stdin.end(input);
});
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-codex-')));

test('el adaptador de Codex traduce sus herramientas a las de la oficina', () => {
  const b = { session_id: 's1', cwd: '/p' };
  const [bash] = adapt('codex', { ...b, hook_event_name: 'PreToolUse', tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'npm test'] } });
  assert.deepEqual([bash.kind, bash.tool, bash.input.command], ['tool_start', 'Bash', 'npm test']);
  const [edit] = adapt('codex', { ...b, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** Update File: src/api.js\n@@\n-a\n+b\n*** End Patch' }, tool_response: { success: true } });
  assert.deepEqual([edit.kind, edit.tool, edit.input.file_path, edit.ok], ['tool_end', 'Edit', 'src/api.js', true]);
  const [plan] = adapt('codex', { ...b, hook_event_name: 'PreToolUse', tool_name: 'update_plan', tool_input: { plan: [{ step: 'Tests', status: 'completed' }, { step: 'API', status: 'in_progress' }] } });
  assert.deepEqual(plan.input.todos, [{ content: 'Tests', status: 'completed' }, { content: 'API', status: 'in_progress' }]);
  const [stop] = adapt('codex', { ...b, hook_event_name: 'Stop' });
  assert.equal(stop.kind, 'turn_end');
  const [intr] = adapt('codex', { ...b, hook_event_name: 'Interrupt' });
  assert.equal(intr.kind, 'turn_end');
  assert.deepEqual(adapt('codex', { ...b, hook_event_name: 'PostCompact' }), []);

  // in the office: the plan goes to the board and the command to QA
  const o = new Office();
  o.ingest('codex', { ...b, hook_event_name: 'SessionStart' });
  o.ingest('codex', { ...b, hook_event_name: 'PreToolUse', tool_name: 'update_plan', tool_input: { plan: [{ step: 'Tests', status: 'pending' }] } });
  assert.deepEqual(o.sessions.get('s1').todos.map((x) => x.content), ['Tests']);
  const [run] = o.ingest('codex', { ...b, hook_event_name: 'PreToolUse', tool_name: 'shell', tool_input: { command: ['npm', 'test'] } });
  assert.equal(run.role, 'qa');
});

test('el hook de Codex reenvía el evento a la oficina; dentro de una pregunta btw no reporta nada', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const dir = tmp();
  const env = { ...process.env, DEV_TEAM_OFFICE_URL: server.url, DEV_TEAM_OFFICE_SOCKET: path.join(dir, 'no.sock') };
  try {
    const out = await runHook(env, JSON.stringify({ session_id: 'cx-1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Cupones', transcript_path: '/x' }));
    assert.equal(out, '', 'nunca escribe en stdout');
    const s = server.company.session('cx-1');
    assert.equal(s.source, 'codex');
    assert.equal(s.title, 'Cupones');
    await runHook({ ...env, DEV_TEAM_OFFICE_BTW: '1' }, JSON.stringify({ session_id: 'cx-2', cwd: dir, hook_event_name: 'SessionStart' }));
    assert.equal(server.company.session('cx-2'), null);
    // without an office: it exits with 0
    await runHook({ ...env, DEV_TEAM_OFFICE_URL: 'http://127.0.0.1:9' }, '{"session_id":"x","hook_event_name":"Stop"}');
  } finally { await server.close(); }
});

test('los agentes de Codex (TOML) declaran su rol como los demás', () => {
  const a = parseAgentToml('# role: qa\nname = "reviewer"\ndescription = "Reviews diffs"\nmodel = \'gpt-5\'\ndeveloper_instructions = """\nBe strict.\n"""\n\n[mcp_servers.x]\nname = "otro"\n', 'reviewer.toml');
  assert.deepEqual([a.name, a.description, a.model, a.role, a.prompt], ['reviewer', 'Reviews diffs', 'gpt-5', 'qa', 'Be strict.']);
  assert.equal(parseAgentToml('name = "x"\nrole = "backend"\n').role, 'backend');
  assert.equal(parseAgentToml('name = "x"\n').role, undefined);

  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.codex', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codex', 'agents', 'pagos.toml'), 'name = "pagos-sync"\ndescription = "Sincroniza pagos"\nrole = "backend"\ndeveloper_instructions = "..."\n');
  const d = detectHarness(dir);
  assert.ok(d.harnesses.includes('codex'));
  assert.equal(d.roles['pagos-sync'], 'backend');
  assert.ok(d.entries[0].harnesses.includes('codex'), 'el prompt directo también va a Codex');
});

test('un evento sin sesión pero con carpeta cae en la sesión más reciente de esa carpeta', () => {
  const o = new Office();
  o.ingest('claude-code', { session_id: 'vieja', cwd: '/p', hook_event_name: 'SessionStart' });
  o.sessions.get('vieja').lastAt -= 60_000;
  o.ingest('claude-code', { session_id: 'nueva', cwd: '/p', hook_event_name: 'SessionStart' });
  o.ingest('claude-code', { session_id: 'otra', cwd: '/q', hook_event_name: 'SessionStart' });
  const [ev] = o.ingest('generic', { cwd: '/p/', kind: 'phase', role: 'qa', phase: 'red' });
  assert.equal(ev.session, 'nueva');
  assert.equal(o.sessions.get('nueva').turn, 'qa');
});
