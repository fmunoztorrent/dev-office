// The status card's lines (public/pulse-ui.js): who is connected and what each one is on.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pulseRows, clock, agoText, PULSE_ALIVE_MS } from '../public/pulse-ui.js';

test('la tarjeta lista las sesiones conectadas, primero las que te esperan, con lo último que hacían', () => {
  const now = 1_000_000_000;
  const sessions = [
    { id: 'a1', source: 'pi', cwd: '/w/tienda', status: 'active', lastAt: now - 5000, title: 'Carrito', todos: [] },
    { id: 'b2', source: 'claude-code', cwd: '/w/api', status: 'waiting', lastAt: now - 60_000, title: '', todos: [] },
    { id: 'c3', source: 'pi', cwd: '/w/vieja', status: 'active', lastAt: now - PULSE_ALIVE_MS - 1, title: 'x', todos: [] },
    { id: 'd4', source: 'pi', cwd: '/w/fin', status: 'ended', lastAt: now, title: 'x', todos: [] },
  ];
  const doing = new Map([['a1', { text: 'Editando cart.js', at: now }]]);
  const rows = pulseRows(sessions, doing, now, (s) => s.toUpperCase());
  assert.deepEqual(rows.map((r) => r.id), ['b2', 'a1'], 'sólo las conectadas; la que espera va primero');
  assert.equal(rows[1].text, 'Editando cart.js');
  assert.equal(rows[1].agent, 'PI');
  assert.equal(rows[1].project, 'tienda');
  assert.equal(rows[0].waiting, true);
});

test('sin lo último que hacían, usa su tarea en curso o su título', () => {
  const now = 5_000_000;
  const [r] = pulseRows([{ id: 'x', source: 'pi', cwd: '/w/p', status: 'active', lastAt: now, title: 'Título', todos: [{ status: 'in_progress', content: 'Paso 2' }] }], new Map(), now);
  assert.equal(r.text, 'Paso 2');
});

test('el temporizador y el "hace"', () => {
  assert.equal(clock(27_000), '0:27');
  assert.equal(clock(125_000), '2:05');
  assert.equal(agoText(30), '30 s');
  assert.equal(agoText(180), '3 min');
});
