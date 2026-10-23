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
    assert.match(text, /└ 🧪 Andrés +ex-qa +🔴 RED: tests de discount +▸ \$ npm test/);
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
