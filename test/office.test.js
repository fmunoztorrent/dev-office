import './es.js';
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
  assert.equal(red.from, 'tl'); // implicit handover from whoever held the turn
  const [fail] = pi({ kind: 'tool_end', tool: 'bash', input: { command: 'npm test' }, ok: false });
  assert.equal(fail.role, 'qa');
  assert.equal(fail.phase, 'red');
  pi({ kind: 'phase', role: 'backend', phase: 'implement' });
  // even if it is a test file, whoever is on duty does it
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

// An agent's end of turn is NOT the "done" celebration: that is reserved for the merge.
// A Claude Code `Stop` (and the extensions' `agent_end` / `session.idle`) is `turn_end`:
// the role is freed (`idle`) but the session stays alive and the declared turn is released.
test('el fin de turno emite turn_end, no done, y no cierra la sesión', () => {
  const o = new Office();
  o.ingest('pi', { session: 'sX', kind: 'phase', role: 'backend', phase: 'implement' });
  assert.equal(o.sessionSummary('sX').turn, 'backend');
  const [ev] = o.ingest('claude-code', { hook_event_name: 'Stop', session_id: 'sX', cwd: '/p' });
  assert.equal(ev.kind, 'turn_end');
  assert.equal(ev.role, 'backend');
  assert.equal(o.roles.backend.status, 'idle');
  const s = o.sessionSummary('sX');
  assert.equal(s.status, 'active');
  assert.equal(s.turn, null);
  assert.equal(s.phase, null);
});

// `done` is the merge: it closes the session and the whole board, not just what the agent
// managed to check off. A card `in_progress` when the merge arrives cannot be left hanging.
test('el done marca todas las tarjetas del tablero como completed', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', ...e });
  pi({ kind: 'todos', todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] });
  assert.deepEqual(o.sessionSummary('p').todos.map((t) => t.status), ['completed', 'in_progress']);
  pi({ kind: 'done' });
  const s = o.sessionSummary('p');
  assert.equal(s.status, 'done');
  assert.equal(s.todos.length, 2);
  assert.ok(s.todos.every((t) => t.status === 'completed'));
});

test('la demo de Pi termina con todo el flujo registrado', () => {
  const o = new Office();
  for (const [, p] of piDemoScript('pd')) o.ingest('pi', p);
  const s = o.sessionSummary('pd');
  assert.equal(s.status, 'done');
  assert.equal(s.errors, 0);
  assert.ok(s.flow.some((f) => f.role === 'qa' && f.phase === 'red'));
});

// The `role:` an agent declares in its frontmatter is the AUTHORITATIVE source of the character.
// The agent's name is neutral (`power-sync` describes no role) so the test is not vacuous:
// if the office inferred the role only from the name, the no-map case would not give `tl`.
test('el rol declarado por el agente manda sobre la heurística del nombre y del texto', () => {
  const rolDe = (map, task) => {
    const o = new Office();
    const pi = (e) => o.ingest('pi', { session: 'p', cwd: '/p', ...e });
    pi({ kind: 'session_start' });
    if (map) pi({ kind: 'agent_roles', roles: map }); // the extension learns the map when registering
    pi({ kind: 'tool_start', tool: 'subagent_run', input: { agent: 'power-sync', task } });
    return o.sessionSummary('p').subagents[0].role;
  };

  // 1) without a learned map, neither the name nor the text identify a role: it falls back to `tl`.
  //    This case is what makes the test non-vacuous: it fails if someone infers `backend` from the name.
  assert.equal(rolDe(null, 'hacer una tarea'), 'tl');
  // 2) the map learned from the frontmatter resolves the role even if the text says nothing.
  assert.equal(rolDe({ 'power-sync': 'backend' }, 'hacer una tarea'), 'backend');
  // 3) the declaration WINS over the text heuristic: `crear endpoint de pagos` classifies
  //    as `backend`, but the agent declared itself `designer` and that is the character that shows up.
  assert.equal(rolDe({ 'power-sync': 'designer' }, 'crear endpoint de pagos'), 'designer');
});

// What was seen with real Pi (gentle-pi): each subagent is another `pi` that loads the same extension and
// reports to the parent's session with `child`. Its work is done by the subagent's character, not the
// one the tool suggests, and its start, its task and its end of turn are not the session's.
test('subagentes con proceso propio: su trabajo cae en su personaje y no toca la sesión del padre', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'pi-t2', cwd: '/tienda', ...e });
  const child = (pid, e) => pi({ child: pid, ...e });
  pi({ kind: 'session_start' });
  pi({ kind: 'agent_roles', roles: { tester: 'qa', coder: 'backend' } });
  pi({ kind: 'task', text: 'Agrega total() con descuento' });
  const redTask = 'Repo: /tienda. Escribe tests de total() en test/cart.test.js y confirma que fallan.';
  pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'tester', label: 'RED tests for total()', task: redTask, mode: 'task' } });
  assert.equal(child('201', { kind: 'session_start' }).length, 0);
  assert.equal(child('201', { kind: 'task', text: `${redTask}\n\n## Allowed edit surfaces\n- test/**` }).length, 0);
  // a `read` of src/ and a `mkdir` would be done by Backend; in the QA subagent QA does them, in RED
  const [read] = child('201', { kind: 'tool_start', tool: 'read', input: { path: 'src/cart.js' } });
  assert.equal(read.role, 'qa');
  assert.equal(read.phase, 'red');
  const [fail] = child('201', { kind: 'tool_end', tool: 'bash', input: { command: 'npm test' }, ok: false });
  assert.equal(fail.role, 'qa');
  assert.equal(child('201', { kind: 'turn_end' }).length, 0);
  assert.equal(child('201', { kind: 'session_end' }).length, 0);
  pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'tester' } });

  pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c2', input: { agent: 'coder', label: 'GREEN total()', task: 'Implementa total() hasta que npm test pase.' } });
  child('202', { kind: 'task', text: 'Implementa total() hasta que npm test pase.' });
  const [edit] = child('202', { kind: 'tool_start', tool: 'edit', input: { path: 'test/cart.test.js' } });
  assert.equal(edit.role, 'backend');
  assert.equal(child('202', { kind: 'thinking' })[0].role, 'backend');
  pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'c2', input: { agent: 'coder' } });

  const s = o.sessionSummary('pi-t2');
  assert.equal(s.title, 'Agrega total() con descuento', 'la tarea de un subagente no es la de la sesión');
  assert.equal(s.status, 'active');
  assert.equal(s.errors, 0, 'en RED que el test falle es lo esperado');
  assert.deepEqual(s.subagents.map((x) => [x.agentType, x.role, x.child, x.open]), [['tester', 'qa', '201', false], ['coder', 'backend', '202', false]]);
  assert.ok(s.subagents.every((x) => x.task === undefined), 'la tarea completa no viaja a los visores');
  assert.equal(o.log.filter((e) => e.kind === 'session_start' || e.kind === 'turn_end').length, 1);
  // when the session closes, nobody is left working in it
  o.ingest('pi', { session: 'otra', cwd: '/otra', kind: 'tool_start', tool: 'edit', input: { path: 'src/a.css' } });
  pi({ kind: 'session_end' });
  assert.equal(o.roles.qa.status, 'idle');
  assert.equal(o.roles.backend.status, 'idle');
  assert.equal(o.roles.frontend.status, 'working', 'lo de otra sesión sigue igual');
});

test('la fase TDD de un subagente de QA sale de su etiqueta', () => {
  const phaseOf = (label) => {
    const o = new Office();
    return o.ingest('pi', { session: 'p', cwd: '/p', kind: 'tool_start', tool: 'subagent_run', toolUseId: 'x', input: { agent: 'qa', label } })[0].phase;
  };
  assert.equal(phaseOf('RED tests for total()'), 'red');
  assert.equal(phaseOf('write failing shipping tests'), 'red');
  assert.equal(phaseOf('tests que fallen para el envío'), 'red');
  assert.equal(phaseOf('confirm shipping green'), 'green');
  assert.equal(phaseOf('confirmar en verde'), 'green');
  assert.equal(phaseOf('revisar cobertura'), undefined);
});

test('subagentes en paralelo: cada proceso se reconoce por la tarea que recibió', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', cwd: '/p', ...e });
  pi({ kind: 'agent_roles', roles: { ux: 'designer', api: 'backend' } });
  pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'a', input: { agent: 'ux', task: 'Diseña la pantalla de pago', mode: 'background' } });
  pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'b', input: { agent: 'api', task: 'Crea POST /payments', mode: 'background' } });
  // in the background the tool returns right away: the subagent keeps working
  pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'a', input: {} });
  pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'b', input: {} });
  pi({ child: '9', kind: 'task', text: 'Crea POST /payments' });
  pi({ child: '8', kind: 'task', text: 'Diseña la pantalla de pago' });
  assert.equal(pi({ child: '9', kind: 'tool_start', tool: 'read', input: { path: 'public/pay.css' } })[0].role, 'backend');
  assert.equal(pi({ child: '8', kind: 'tool_start', tool: 'bash', input: { command: 'npm test' } })[0].role, 'designer');
});

test('la lista de todo de gentle-pi va al tablero', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', cwd: '/p', ...e });
  const [ev] = pi({ kind: 'tool_start', tool: 'todo', input: { action: 'write', tasks: [{ title: 'RED', status: 'done' }, { title: 'GREEN', status: 'in_progress' }, { title: 'viejo', status: 'dropped' }] } });
  assert.equal(ev.kind, 'todos');
  assert.deepEqual(o.sessionSummary('p').todos.map((t) => `${t.content}:${t.status}`), ['RED:completed', 'GREEN:in_progress']);
  assert.equal(pi({ kind: 'tool_start', tool: 'todo', input: { action: 'update', id: 2, status: 'done' } }).length, 0);
});

// Inside herdr each subagent has its pane: to show only its own activity, each subagent event
// carries its id, together with what it did (its commands' output, its report).
test('lo de cada subagente lleva su id, la salida de sus comandos y su informe', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'pi-9', cwd: '/tienda', ...e });
  const task = 'Escribe tests de shipping() que fallen.\nNo toques src/.';
  const [start] = pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'qa', label: 'RED shipping', task } });
  assert.equal(start.subId, 'c1');
  assert.equal(start.task, task, 'su tarea, con sus saltos de línea, para el pane');
  pi({ child: '31', kind: 'task', text: task });
  const [cmd] = pi({ child: '31', kind: 'tool_start', tool: 'bash', input: { command: 'npm test' } });
  assert.equal(cmd.subId, 'c1');
  const out = Array.from({ length: 30 }, (_, i) => `línea ${i + 1}`).join('\n') + '\n\x1b[31mℹ fail 2\x1b[0m\n';
  const [end] = pi({ child: '31', kind: 'tool_end', tool: 'bash', input: { command: 'npm test' }, ok: false, output: out });
  assert.equal(end.subId, 'c1');
  assert.match(end.output, /ℹ fail 2$/, 'el final de la salida, sin colores');
  assert.ok(!end.output.includes('línea 1\n'), 'sólo las últimas líneas');
  assert.equal(pi({ child: '31', kind: 'thinking' })[0].subId, 'c1');
  // what it read is not sent (only the output of commands, or of what failed)
  assert.equal(pi({ child: '31', kind: 'tool_end', tool: 'read', input: { path: 'src/cart.js' }, output: 'export function subtotal() {}' })[0].output, undefined);
  assert.equal(pi({ child: '31', kind: 'tool_start', tool: 'bash', input: { command: 'cd /tienda && npm test' } })[0].text, '$ npm test', 'sin el cd del principio');
  // the main agent's tool output is not sent (it is already visible in its pane)
  assert.equal(pi({ kind: 'tool_end', tool: 'bash', input: { command: 'ls' }, output: 'a\nb' })[0].output, undefined);
  const [done] = pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'qa' }, output: 'Escribí 2 tests en test/shipping.test.js; fallan como se espera.' });
  assert.equal(done.kind, 'subagent_end');
  assert.equal(done.subId, 'c1');
  assert.match(done.output, /^Escribí 2 tests/);
});

test('Claude Code: las herramientas dentro de un subagente (agent_id) son de ese subagente', () => {
  const o = new Office();
  const [start] = o.ingest('claude-code', cc({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'tu1', tool_input: { subagent_type: 'qa-engineer', description: 'Revisa los tests', prompt: 'Corre los tests' } }));
  o.ingest('claude-code', cc({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'qa-engineer' }));
  const [edit] = o.ingest('claude-code', cc({ hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: 'Edit', tool_use_id: 'tu2', tool_input: { file_path: 'src/server/db.ts' } }));
  assert.equal(edit.subId, start.subId);
  assert.equal(edit.role, 'qa', 'el personaje del subagente, no el que adivina el archivo');
  const [ran] = o.ingest('claude-code', cc({ hook_event_name: 'PostToolUse', agent_id: 'ag1', tool_name: 'Bash', tool_use_id: 'tu3', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok 3 tests', stderr: '' } }));
  assert.equal(ran.output, 'ok 3 tests');
  const [mine] = o.ingest('claude-code', cc({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'tu4', tool_input: { file_path: 'src/server/db.ts' } }));
  assert.equal(mine.subId, undefined, 'lo del agente principal no es del subagente');
  assert.equal(mine.role, 'backend');
});

// S4: dispatch and pane events are announcements: they are logged but do NOT change any role's
// state (they neither set it to working nor free it to idle if it was already busy).
test('los anuncios (dispatch y panes) no cambian el estado de ningún rol', () => {
  const o = new Office();
  const pi = (e) => o.ingest('pi', { session: 'p', cwd: '/p', ...e });
  pi({ kind: 'phase', role: 'backend', phase: 'implementa' });
  pi({ kind: 'tool_start', tool: 'edit', input: { path: 'src/api.js' } });
  assert.equal(o.roles.backend.status, 'working');

  pi({ kind: 'dispatch', agent: 'pi', text: 'Para Pi: nueva tarea' });
  assert.equal(o.roles.po.status, 'idle', 'dispatch no pone a la PO a trabajar');
  assert.equal(o.roles.backend.status, 'working', 'y no toca lo que otro rol ya hace');

  pi({ kind: 'pane_open', role: 'qa', pane: 'w1:p7', text: 'tests en watch' });
  assert.equal(o.roles.qa.status, 'idle', 'abrir un pane no pone a QA a trabajar');

  pi({ kind: 'waiting', text: 'aprueba el Bash' });
  assert.equal(o.roles.manager.status, 'waiting');
  pi({ kind: 'pane_state', role: 'manager', pane: 'w1:p7', state: 'working', text: 'tests en watch' });
  assert.equal(o.roles.manager.status, 'waiting', 'el estado del pane no saca a Marco de waiting');
  pi({ kind: 'pane_close', role: 'manager', pane: 'w1:p7', text: 'tests en watch' });
  assert.equal(o.roles.manager.status, 'waiting', 'cerrar el pane tampoco lo libera');

  assert.ok(o.log.some((e) => e.kind === 'dispatch'), 'el anuncio sí queda en la bitácora');
  assert.ok(o.log.some((e) => e.kind === 'pane_open'), 'el pane abierto también queda en la bitácora');
});

// Events that are real work keep the state they already had: tool_start→working,
// waiting→waiting, done→done and turn_end→idle (roleStatus takes nothing else with it).
test('los eventos que sí marcan trabajo conservan su estado', () => {
  const status = (...events) => {
    const o = new Office();
    for (const e of events) o.ingest('pi', { session: 'p', cwd: '/p', ...e });
    return o.snapshot().roles;
  };
  assert.equal(status({ kind: 'tool_start', tool: 'edit', input: { path: 'src/a.css' } }).frontend.status, 'working');
  assert.equal(status({ kind: 'waiting', text: 'aprueba el Bash' }).manager.status, 'waiting');
  assert.equal(status({ kind: 'done' }).manager.status, 'done');
  assert.equal(status({ kind: 'phase', role: 'qa', phase: 'red' }, { kind: 'turn_end' }).qa.status, 'idle');
});
