// A subagent's pane (dev-team-office follow): it shows only that subagent's activity.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFollow, runFollow } from '../tui/follow.js';
import { startServer } from '../server/server.js';
import { openStore } from '../server/store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout');
};

test('follow: quién es y su tarea, sus herramientas con la salida, su fase y cómo terminó', () => {
  const f = createFollow({ session: 's', sub: 'c1', color: false, width: () => 80, zone: 'UTC' });
  const lines = [];
  const push = (e) => lines.push(...f.push({ session: 's', ts: Date.UTC(2026, 9, 17, 12, 0, 0), ...e }));
  push({ kind: 'subagent_start', subId: 'c1', role: 'qa', agentType: 'ex-qa', text: 'RED: tests que fallen', phase: 'red', task: 'Escribe tests de shipping()\nNo toques src/' });
  push({ kind: 'tool_start', subId: 'c2', role: 'backend', text: 'edita cart.js' }); // from another subagent
  push({ kind: 'tool_start', role: 'tl', text: 'lo del agente principal' });
  push({ kind: 'thinking', subId: 'c1', role: 'qa' });
  push({ kind: 'thinking', subId: 'c1', role: 'qa' });
  push({ kind: 'tool_start', subId: 'c1', role: 'qa', text: '$ npm test' });
  push({ kind: 'tool_end', subId: 'c1', role: 'qa', ok: false, phase: 'red', text: '$ npm test falló', output: 'ℹ pass 1\nℹ fail 2' });
  push({ kind: 'subagent_end', subId: 'c1', role: 'qa', output: 'Escribí 2 tests.', ts: Date.UTC(2026, 9, 17, 12, 1, 5) });
  const text = lines.join('\n');
  assert.match(text, /🧪 Andrés · QA {2}ex-qa/);
  assert.match(text, /RED: tests que fallen/);
  assert.match(text, /│ Escribe tests de shipping\(\)\n {2}│ No toques src\//);
  assert.ok(!/cart\.js|agente principal/.test(text), 'nada de lo de otros');
  push({ kind: 'thinking', subId: 'c1', role: 'qa' });
  assert.equal(lines.filter((l) => l.includes('💭')).length, 1, 'pensar es una sola línea, al empezar');
  assert.match(text, /12:00:00 {2}▸ \$ npm test/);
  assert.match(text, /✖ \$ npm test falló · falla, como se espera en RED/);
  assert.match(text, /│ ℹ fail 2/);
  assert.match(text, /✔ terminó \(1m 5s\)/);
  assert.match(text, /│ Escribí 2 tests\./);
  assert.ok(!text.includes('\x1b['), 'sin colores');
});

test('follow: un harness que no marca sus eventos con el subagente se sigue por su personaje mientras corre', () => {
  const f = createFollow({ session: 's', sub: 'tu1', color: false });
  const got = (e) => f.push({ session: 's', ...e }).join('\n');
  got({ kind: 'subagent_start', subId: 'tu1', role: 'qa', text: 'Revisa los tests' });
  assert.match(got({ kind: 'tool_start', role: 'qa', text: '$ npm test' }), /npm test/);
  assert.equal(got({ kind: 'tool_start', role: 'backend', text: 'edita db.ts' }), '');
  got({ kind: 'subagent_end', subId: 'tu1', role: 'qa' });
  assert.equal(got({ kind: 'tool_start', role: 'qa', text: '$ npm run lint' }), '', 'ya terminó');
});

test('follow en vivo: se engancha a la oficina, muestra lo que el subagente ya hizo y lo que sigue', async () => {
  const server = await startServer({ port: 0, socket: null, db: openStore(':memory:'), weather: false });
  let out = '';
  const pi = (e) => server.company.ingest('pi', { session: 'pi-5', cwd: '/tienda', ...e });
  pi({ kind: 'tool_start', tool: 'subagent_run', toolUseId: 'k1', input: { agent: 'ex-backend', label: 'Implementa shipping', task: 'Implementa shipping()' } });
  pi({ child: '77', kind: 'task', text: 'Implementa shipping()' });
  pi({ child: '77', kind: 'tool_start', tool: 'edit', input: { path: 'src/cart.js' } });
  const view = runFollow({ url: server.url, session: 'pi-5', sub: 'k1', color: false, write: (s) => { out += s; } });
  try {
    await until(() => out.includes('cart.js'));
    assert.match(out, /Implementa shipping/);
    pi({ child: '77', kind: 'tool_start', tool: 'bash', input: { command: 'npm test' } });
    pi({ kind: 'tool_end', tool: 'subagent_run', toolUseId: 'k1', input: { agent: 'ex-backend' }, output: 'Listo: 4 tests pasan.' });
    await until(() => out.includes('Listo: 4 tests pasan.'));
    assert.match(out, /\$ npm test/);
    assert.match(out, /el pane se cierra solo/);
  } finally {
    view.close();
    await server.close();
  }
});
