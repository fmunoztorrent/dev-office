import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Office } from '../server/office.js';
import { roleForTool, roleForText } from '../server/roles.js';
import { demoScript, piDemoScript } from '../server/demo.js';

const cc = (o) => ({ session_id: 's1', cwd: '/p', ...o });

test('asigna roles según archivo, comando y descripción', () => {
  assert.equal(roleForTool('Edit', { file_path: 'src/components/Button.tsx' }), 'frontend');
  assert.equal(roleForTool('Edit', { file_path: 'src/components/Button.test.tsx' }), 'qa');
  assert.equal(roleForTool('Write', { file_path: 'tests/e2e/login.spec.ts' }), 'qa');
  assert.equal(roleForTool('Write', { file_path: 'src/server/db.ts' }), 'backend');
  assert.equal(roleForTool('Write', { file_path: 'design/logo.svg' }), 'designer');
  assert.equal(roleForTool('Read', { file_path: 'docs/requirements.md' }), 'analyst');
  assert.equal(roleForTool('Bash', { command: 'npm test' }), 'qa');
  assert.equal(roleForTool('Bash', { command: 'npx playwright test' }), 'qa');
  assert.equal(roleForTool('Bash', { command: 'npx tsc --noEmit' }), 'tl');
  assert.equal(roleForTool('Bash', { command: 'git commit -m "add tests"' }), 'tl');
  assert.equal(roleForTool('WebSearch', { query: 'x' }), 'analyst');
  assert.equal(roleForTool('edit', { filePath: 'app/page.vue' }), 'frontend'); // OpenCode usa filePath
  assert.equal(roleForText('Escribir historias de usuario'), 'po');
  assert.equal(roleForText('', 'Explore'), 'analyst');
  assert.equal(roleForText('Diseñar la paleta de colores'), 'designer');
  assert.equal(roleForText('Crear endpoint de pagos'), 'backend');
  assert.equal(roleForText('Escribir tests e2e del checkout'), 'qa');
  assert.equal(roleForText('Revisar la arquitectura'), 'tl');
  assert.equal(roleForText('', 'tester'), 'qa');
});

test('Task + SubagentStart + SubagentStop + PostToolUse producen un solo inicio y un solo fin', () => {
  const o = new Office();
  const pre = cc({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 't1', tool_input: { description: 'Explorar auth', subagent_type: 'Explore' } });
  const kinds = [
    pre,
    cc({ hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'a1' }),
    cc({ hook_event_name: 'SubagentStop', agent_type: 'Explore', agent_id: 'a1' }),
    { ...pre, hook_event_name: 'PostToolUse', tool_response: {} },
  ].flatMap((p) => o.ingest('claude-code', p)).map((e) => `${e.kind}:${e.role}`);
  assert.deepEqual(kinds, ['subagent_start:analyst', 'subagent_end:analyst']);
});

test('subagentes en paralelo se cierran por tool_use_id', () => {
  const o = new Office();
  const a = cc({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'ta', tool_input: { description: 'Diseñar UI' } });
  const b = cc({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'tb', tool_input: { description: 'API de pagos' } });
  o.ingest('claude-code', a); o.ingest('claude-code', b);
  const [end] = o.ingest('claude-code', { ...b, hook_event_name: 'PostToolUse' });
  assert.equal(end.role, 'backend');
  assert.equal(o.sessionSummary('s1').subagents.filter((x) => x.open).length, 1);
});

test('TodoWrite actualiza el tablero y los errores cuentan', () => {
  const o = new Office();
  o.ingest('claude-code', cc({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] } }));
  o.ingest('claude-code', cc({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'boom' }));
  const s = o.sessionSummary('s1');
  assert.deepEqual(s.todos.map((t) => t.status), ['completed', 'in_progress']);
  assert.equal(s.errors, 1);
  assert.equal(o.roles.qa.status, 'blocked');
});

test('formato genérico (OpenCode / Pi) y la demo completa', () => {
  const o = new Office();
  const [ev] = o.ingest('opencode', { session: 'oc', kind: 'tool_start', tool: 'edit', input: { filePath: 'src/ui/Nav.svelte' } });
  assert.equal(ev.role, 'frontend');
  assert.equal(ev.source, 'opencode');
  for (const [, p] of demoScript('d')) o.ingest('claude-code', p);
  const d = o.sessionSummary('d');
  assert.equal(d.status, 'done');
  assert.equal(d.subagents.filter((x) => x.open).length, 0);
  assert.ok(d.todos.every((t) => t.status === 'completed'));
});

test('ignora basura sin romperse', () => {
  const o = new Office();
  assert.deepEqual(o.ingest('generic', { kind: 'nope' }), []);
  assert.deepEqual(o.ingest('claude-code', { hook_event_name: 'Unknown' }), []);
  assert.deepEqual(o.ingest('generic', null), []);
});

test('flujo por roles: el rol de turno se queda con las herramientas y RED no cuenta como error', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', ...e });
  const [arch] = pi({ kind: 'phase', role: 'arquitecto', phase: 'Architecture', text: 'API' });
  assert.equal(arch.role, 'tl');
  assert.equal(arch.phase, 'arquitectura');
  const [red] = pi({ kind: 'phase', role: 'qa', phase: 'red' });
  assert.equal(red.from, 'tl'); // traspaso implícito desde quien tenía el turno
  const [fail] = pi({ kind: 'tool_end', tool: 'bash', input: { command: 'npm test' }, ok: false });
  assert.equal(fail.role, 'qa');
  assert.equal(fail.phase, 'red');
  pi({ kind: 'phase', role: 'backend', phase: 'implement' });
  // aunque sea un archivo de tests, lo hace quien está de turno
  const [edit] = pi({ kind: 'tool_start', tool: 'edit', input: { path: 'tests/a.test.ts' } });
  assert.equal(edit.role, 'backend');
  pi({ kind: 'phase', role: 'qa', phase: 'green' });
  const s = o.sessionSummary('p');
  assert.equal(s.errors, 0);
  assert.deepEqual(s.flow.map((f) => `${f.role}:${f.phase}`), ['tl:arquitectura', 'qa:red', 'backend:implementa', 'qa:green']);
  assert.equal(s.turn, 'qa');
});

test('fase con rol desconocido, llamadas al script del skill y duplicados se ignoran', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', ...e });
  assert.deepEqual(pi({ kind: 'phase', role: 'astronauta', phase: 'red' }), []);
  assert.deepEqual(pi({ kind: 'tool_start', tool: 'bash', input: { command: 'node ~/.pi/agent/skills/dev-team-office/office-event.mjs phase qa red' } }), []);
  assert.equal(pi({ kind: 'task', text: 'Hacer X' }).length, 1);
  assert.equal(pi({ kind: 'task', text: 'Hacer X' }).length, 0);
  assert.equal(pi({ kind: 'done' }).length, 1);
  assert.equal(pi({ kind: 'done' }).length, 0);
  assert.equal(o.sessionSummary('p').turn, null);
});

test('la demo de Pi termina con todo el flujo registrado', () => {
  const o = new Office();
  for (const [, p] of piDemoScript('pd')) o.ingest('pi', p);
  const s = o.sessionSummary('pd');
  assert.equal(s.status, 'done');
  assert.equal(s.errors, 0);
  assert.ok(s.flow.some((f) => f.role === 'qa' && f.phase === 'red'));
});
