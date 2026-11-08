// The activity monitor (inside herdr, instead of the game): how many agents are running and what each one is doing.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor, renderMonitor, ago } from '../tui/monitor.js';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';
import { localFeed } from '../tui/feeds.js';

test('monitor: cifras, cada agente con su tarea y en qué está, sus subagentes y la bitácora', async () => {
  const server = await startServer({ port: 0, socket: null, db: openStore(':memory:'), weather: false });
  try {
    const mon = createMonitor();
    const feed = localFeed(server);
    feed.start({ onStatus() {}, onSnapshot: (st) => mon.snapshot(st), onEvent: (ev, s) => mon.event(ev, s), onTasks: (x) => mon.tasks(x), onPipelines() {}, onHerdr: (h) => mon.herdr(h) });
    const pi = (e) => server.company.ingest('pi', { session: 'pi-1', cwd: '/proyectos/tienda', ...e });
    pi({ kind: 'session_start' });
    pi({ kind: 'task', text: 'Agrega discount() al carrito' });
    pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'ex-qa', label: 'RED: tests de discount', task: 'Escribe tests que fallen' } });
    pi({ child: '9', kind: 'task', text: 'Escribe tests que fallen' });
    pi({ child: '9', kind: 'tool_start', tool: 'bash', input: { command: 'npm test' } });
    server.company.ingest('claude-code', { hook_event_name: 'UserPromptSubmit', session_id: 'cc-1', cwd: '/proyectos/api', prompt: 'Arregla el login' });
    server.company.ingest('claude-code', { hook_event_name: 'Notification', session_id: 'cc-1', cwd: '/proyectos/api', message: 'Claude necesita tu permiso' });

    const lines = renderMonitor(mon, { cols: 160, rows: 30, color: false, info: { version: '0.5.0', url: server.url } });
    const text = lines.join('\n');
    assert.equal(lines.length, 30, 'llena la pantalla, ni más ni menos');
    assert.match(lines[0], /DEV TEAM OFFICE 0\.5\.0 {2}🏢 Oficina principal/);
    assert.match(lines[1], /2 agente\(s\) activo\(s\).*1 esperándote.*1 subagente\(s\) corriendo/);
    assert.match(text, /✋ Claude · api +esperándote +Arregla el login +▸ Marco: Claude necesita tu permiso/);
    assert.match(text, /● Pi · tienda +en curso +Agrega discount\(\) al carrito/);
    assert.match(text, /└ 🧪 Andrés +ex-qa +🔴 RED: tests de discount +▸ Corriendo los tests/);
    assert.match(text, /BITÁCORA/);
    assert.match(text, /Andrés +🤖 RED: tests de discount/);
    assert.match(lines.at(-1), /o navegador · g juego · ←→ oficina · q salir/);
    assert.ok(lines.every((l) => !l.includes('\x1b[')), 'sin colores');

    // the subagent finishes: it stays as finished for a while and no longer counts
    pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'c1', input: { agent: 'ex-qa' } });
    const after = renderMonitor(mon, { cols: 160, rows: 30, color: false }).join('\n');
    assert.match(after, /0 subagente\(s\) corriendo/);
    assert.match(after, /└ 🧪 Andrés .*✔ terminó/);
    // in a small terminal it gets trimmed, but the header, the figures and the footer remain
    const small = renderMonitor(mon, { cols: 60, rows: 12, color: false });
    assert.equal(small.length, 12);
    assert.match(small[1], /agente/);
    assert.match(small.at(-1), /q salir/);
    feed.close();
  } finally {
    await server.close();
  }
});

test('monitor: sin agentes lo dice, y "hace" cuánto', () => {
  const mon = createMonitor();
  mon.snapshot({ sessions: [], roles: {}, log: [] });
  assert.match(renderMonitor(mon, { cols: 120, rows: 14, color: false }).join('\n'), /Sin agentes todavía/);
  assert.deepEqual([ago(4000), ago(125_000), ago(2 * 3600_000)], ['4s', '2m', '2h']);
});

test('el monitor no cuenta los anuncios de pane como trabajo, pero sí el trabajo real', () => {
  const mon = createMonitor();
  const idle = (id) => ({ id, status: 'idle', text: '', ts: 0, actions: 0 });
  mon.snapshot({ sessions: [], roles: { po: idle('po'), qa: idle('qa'), backend: idle('backend') }, log: [] });
  const now = Date.now();
  mon.event({ kind: 'dispatch', role: 'po', text: 'Para Pi: tarea', ts: now }, null);
  mon.event({ kind: 'pane_open', role: 'qa', pane: 'w1:p7', text: 'tests en watch', ts: now }, null);
  assert.equal(mon.counts(now).working, 0, 'ni dispatch ni pane_open marcan trabajo');
  assert.match(renderMonitor(mon, { cols: 120, rows: 14, color: false, now }).join('\n'), /todos libres/);

  // real work does count and is drawn in the team row
  mon.event({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js', ts: now }, null);
  assert.equal(mon.counts(now).working, 1);
  assert.match(renderMonitor(mon, { cols: 120, rows: 14, color: false, now }).join('\n'), /Diego +trabajando/);
});

test('monitor: los servicios que quedaron corriendo, numerados para abrir sus logs', () => {
  const mon = createMonitor();
  const now = Date.now();
  mon.services([
    { id: 's2', name: 'npm run dev', command: 'npm run dev > dev.log 2>&1 &', role: 'frontend', agent: 'claude-code', cwd: '/p/web', status: 'running', startedAt: now - 120_000 },
    { id: 's1', name: 'cargo watch', command: 'cargo watch', role: 'backend', agent: 'pi', cwd: '/p/api', status: 'ended', startedAt: now - 600_000, endedAt: now - 60_000 },
  ]);
  const lines = renderMonitor(mon, { cols: 170, rows: 24, color: false, now });
  const text = lines.join('\n');
  assert.match(lines[1], /▶ 1 servicio\(s\) corriendo/);
  assert.match(text, /SERVICIOS/);
  assert.match(text, /1 ▶ npm run dev +Lucía · Claude +corriendo · 2m +web/);
  assert.match(text, /2 ■ cargo watch +Diego · Pi +se detuvo hace 1m +api/);
  assert.match(lines.at(-1), /1-9 los logs de un servicio/);
  assert.equal(lines.length, 24);
});

test('monitor: lo que te pregunta un agente va arriba, y con r se ven sus opciones para responder', () => {
  const mon = createMonitor();
  mon.prompts([{ id: 'q-w1:p2', rev: 1, pane: 'w1:p2', agent: 'pi', project: 'tienda', summary: '⚠️ Dangerous command: … Allow?', question: 'Allow?', options: [{ label: 'Yes', detail: '' }, { label: 'No', detail: '' }], cursor: 0 }]);
  let lines = renderMonitor(mon, { cols: 120, rows: 24, color: false });
  let text = lines.join('\n');
  assert.match(text, /TE ESPERAN/);
  assert.match(text, /✋ Pi · tienda +⚠️? Dangerous command: … Allow\?/);
  assert.match(lines.at(-1), /r responder/);
  assert.doesNotMatch(text, /1 → Yes/);
  // r: its options, numbered (→ the one marked on the agent's screen)
  mon.model.answering = 'q-w1:p2';
  lines = renderMonitor(mon, { cols: 120, rows: 24, color: false });
  text = lines.join('\n');
  assert.match(text, /1 → Yes\n +2 {3}No/);
  assert.match(lines.at(-1), /1-2 responder · x cancelar la pregunta · esc volver/);
  assert.equal(lines.length, 24);
  // in a narrow pane (next to the agent's): the question on its own line, without the details
  const narrow = renderMonitor(mon, { cols: 44, rows: 24, color: false }).join('\n');
  assert.match(narrow, /✋ Pi · tienda\n +⚠️? Dangerous command: … Allow\?/);
  assert.match(narrow, /1 → Yes\n +2 {3}No\n/);
  // what just happened goes before the keys, so a narrow pane shows it
  mon.model.flash = 'Respondido: «No».';
  assert.match(renderMonitor(mon, { cols: 44, rows: 24, color: false }).at(-1), /^ {2}Respondido: «No»\. {3}1-2 resp/);
  mon.model.flash = null;
  // answered from elsewhere: it is no longer there, and neither is the answering mode
  mon.prompts([]);
  assert.equal(mon.model.answering, null);
  assert.doesNotMatch(renderMonitor(mon, { cols: 120, rows: 24, color: false }).join('\n'), /TE ESPERAN/);
});
