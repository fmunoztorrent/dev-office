// The daily standup (server/standup.js): from the real log of the last 24 hours each character tells
// what their agent did; the game gathers them at the table, the minutes go to the archive, and it
// happens by itself once a day, after 9:30 in each office's time zone (or whenever you call it).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/server.js';
import { Standup } from '../server/standup.js';
import { createSim } from '../public/sim.js';

const HOUR = 3600_000;
/** How much to move the clock so that it is `h` o'clock UTC (less than a day ahead: the log still counts). */
const toHour = (h) => { const n = Date.now(); const d = new Date(n); d.setUTCHours(h, 0, 0, 0); let x = d.getTime() - n; if (x < 0) x += 24 * HOUR; return x; };

async function office({ at = null } = {}) {
  let shift = at === null ? 0 : toHour(at);
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0, now: () => Date.now() + shift } });
  server.store.setPrefs({ timezone: 'UTC' });
  const ev = (e) => server.company.ingest('generic', { session: 's1', source: 'claude', cwd: '/tmp/tienda', ...e });
  return { server, ev, setHour: (h) => { shift = toHour(h); } };
}

test('el informe sale de la bitácora real: qué hizo cada uno, cuántos pasos y en qué se trabó; y qué espera a la PO', async () => {
  const { server, ev } = await office();
  try {
    ev({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando el carrito' });
    ev({ kind: 'tool_end', role: 'backend', tool: 'Edit', ok: true });
    ev({ kind: 'tool_start', role: 'backend', tool: 'Bash', text: 'Corriendo los tests' });
    ev({ kind: 'tool_end', role: 'backend', tool: 'Bash', ok: false });
    ev({ kind: 'tool_start', role: 'qa', tool: 'Bash', text: 'Probando el pago' });
    ev({ kind: 'chat', role: 'frontend', from: 'Tú', text: 'hola' }); // a chat is not work
    const r = server.standup.report('main');
    assert.equal(r.empty, false);
    assert.deepEqual(r.lines.map((l) => l.role), ['backend', 'qa'], 'en orden, sólo quien trabajó');
    assert.deepEqual(r.lines[0], { role: 'backend', did: ['Editando el carrito', 'Corriendo los tests'], steps: 2, errors: 1, doing: null });
    assert.equal(Standup.say(r.lines[0]), 'Ayer: editando el carrito y corriendo los tests (2 pasos). Se trabó una vez.');
    assert.equal(Standup.say({ role: 'qa', did: [], steps: 0, errors: 0 }), 'Ayer: revisar y planificar (0 pasos).');
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    // an agent waiting for you is in the report
    ev({ kind: 'tool_start', role: 'backend', tool: 'AskUserQuestion', text: '¿Pesos o dólares?' });
    assert.deepEqual(server.standup.report('main').waiting.length, 1);
  } finally { await server.close(); }
});

test('la daily: el juego reúne al equipo, el acta va al archivo (actas, «daily») y se puede pedir cuando quieras; lo que está en curso va como «ahora»', async () => {
  const { server, ev } = await office();
  try {
    ev({ kind: 'tool_start', role: 'frontend', tool: 'Edit', text: 'Maquetando el checkout' });
    const res = await fetch(`${server.url}/v1/offices/main/standup`, { method: 'POST' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.deepEqual(out.lines, [{ role: 'frontend', text: 'Ahora: maquetando el checkout (1 paso).' }]);
    // the event the game draws
    const log = server.company.get('main').log;
    const e = log.findLast((x) => x.kind === 'standup');
    assert.ok(e, 'el evento llega a la bitácora');
    assert.equal(e.role, 'manager');
    assert.deepEqual(e.lines, [{ role: 'frontend', text: 'Ahora: maquetando el checkout (1 paso).' }]);
    assert.match(e.text, /^Daily · .+ · \d{4}-\d{2}-\d{2}$/);
    // the minutes, in the archive
    const minutes = server.store.listKnowledge({ kind: 'minute' });
    assert.equal(minutes.length, 1);
    assert.deepEqual(minutes[0].tags, ['daily']);
    assert.equal(minutes[0].office, 'main');
    assert.match(server.store.getKnowledge(minutes[0].id).body, /- \*\*frontend\*\*: Ahora: maquetando el checkout/);
    // an unknown office
    assert.equal((await fetch(`${server.url}/v1/offices/nope/standup`, { method: 'POST' })).status, 404);
  } finally { await server.close(); }
});

test('sola, una vez al día después de las 9:30 de la oficina; sin nada que contar, no hay reunión', async () => {
  const { server, ev, setHour } = await office({ at: 8 });
  try {
    ev({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando el carrito' });
    const count = () => server.company.get('main').log.filter((x) => x.kind === 'standup').length;
    server.standup.tick();
    assert.equal(count(), 0, 'a las 8 todavía no');
    setHour(10);
    server.standup.tick();
    assert.equal(count(), 1, 'a las 10 sí');
    server.standup.tick();
    assert.equal(count(), 1, 'una sola vez ese día');
    assert.match(server.store.getStandupDay('main'), /^\d{4}-\d{2}-\d{2}$/);
  } finally { await server.close(); }
  // an office where nothing happened: no meeting (and it is not asked again that day)
  const quiet = await office({ at: 10 });
  try {
    quiet.server.standup.tick();
    assert.equal(quiet.server.company.get('main').log.filter((x) => x.kind === 'standup').length, 0);
    assert.ok(quiet.server.store.getStandupDay('main'));
  } finally { await quiet.server.close(); }
});

test('en el juego la daily reúne en la mesa a quien trabajó y cada uno dice lo suyo; el manager abre y cierra', () => {
  let t = 0;
  let seed = 3;
  const sim = createSim({ clock: () => t, random: () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296), wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  const said = [];
  for (const a of Object.values(sim.agents)) { const say = a.say.bind(a); a.say = (text, ...rest) => { said.push({ who: a.id, text }); say(text, ...rest); }; }
  sim.handle({ kind: 'standup', role: 'manager', text: 'Daily · Oficina · 2026-10-16', lines: [{ role: 'backend', text: 'Ayer: editando el carrito (2 pasos).' }, { role: 'qa', text: 'Ayer: probando el pago (1 paso).' }], waiting: ['¿Pesos o dólares?'], open: [] });
  const sc = sim.scenes.find((s) => s.kind === 'standup');
  assert.ok(sc, 'hay escena');
  assert.deepEqual(sc.members, ['manager', 'backend', 'qa']);
  for (let i = 0; i < 20 * 60; i++) { t += 50; sim.step(0.05, t); }
  const lines = said.map((s) => `${s.who}: ${s.text}`);
  assert.ok(lines.some((l) => l.startsWith('manager: ¡Buenos días! Daily')), lines.join('\n'));
  assert.ok(lines.includes('backend: Ayer: editando el carrito (2 pasos).'));
  assert.ok(lines.includes('qa: Ayer: probando el pago (1 paso).'));
  assert.ok(lines.some((l) => /^manager: 1 cosa\(s\) esperan a la PO: ¿Pesos o dólares\?/.test(l)));
  assert.ok(sim.journal.some((j) => j.kind === 'standup'), 'queda en la bitácora de la oficina');
});

test('a pedido, para saber lo último: cada daily cuenta lo que pasó desde la anterior, y su texto entero vuelve', async () => {
  const { server, ev } = await office();
  try {
    ev({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando el carrito' });
    ev({ kind: 'tool_end', role: 'backend', tool: 'Edit', ok: true });
    const first = await (await fetch(`${server.url}/v1/offices/main/standup`, { method: 'POST' })).json();
    assert.equal(first.from, null, 'la primera: las últimas 24 horas');
    assert.match(first.text, /^🗣 Daily · .+ · \d{4}-\d{2}-\d{2}\n- \*\*Diego \(Backend\)\*\*: Ayer: editando el carrito \(1 paso\)\.$/);
    // right after: nothing new
    const quiet = server.standup.run('main');
    assert.equal(quiet.empty, true);
    assert.match(quiet.from, /^desde las \d{2}:\d{2}$/);
    assert.match(quiet.text, /· desde las \d{2}:\d{2}\nNada nuevo desde la última daily\./);
    // new work: only that (Diego's editing was already told), and what each one is on now
    ev({ kind: 'tool_start', role: 'qa', tool: 'Bash', text: 'Probando el pago' });
    ev({ kind: 'tool_end', role: 'qa', tool: 'Bash', ok: false });
    ev({ kind: 'tool_start', role: 'qa', tool: 'Bash', text: 'Corriendo la regresión' });
    ev({ kind: 'tool_start', role: 'devops', tool: 'Bash', text: 'Construyendo la imagen' });
    ev({ kind: 'tool_start', role: 'backend', tool: 'AskUserQuestion', text: '¿Pesos o dólares?' }); // that waits for you: it is not work
    const next = server.standup.run('main');
    assert.deepEqual(next.waiting, ['¿Pesos o dólares?']);
    assert.deepEqual(next.lines.map((l) => l.role), ['qa', 'devops']);
    assert.match(next.lines[0].text, /^Desde las \d{2}:\d{2}: probando el pago \(2 pasos\)\. Se trabó una vez\. Ahora: corriendo la regresión\.$/);
    assert.match(next.text, /- \*\*Andrés \(QA\)\*\*: Desde las/);
    assert.match(next.text, /- \*\*Rafa \(DevOps\/SRE\)\*\*: Ahora: construyendo la imagen \(1 paso\)\./, 'los especialistas de visita también');
    // the company's daily: every department, at once
    server.store.createOffice?.({ id: 'pagos', name: 'Pagos', timezone: 'UTC' });
    server.company.load?.();
    const all = await (await fetch(`${server.url}/v1/standup`, { method: 'POST' })).json();
    assert.equal(all.ok, true);
    assert.ok(all.reports.length >= 1);
    assert.ok(all.reports.every((r) => typeof r.text === 'string'));
    assert.equal(all.text, all.reports.map((r) => r.text).join('\n\n'));
  } finally { await server.close(); }
});

test('Standup.from: desde cuándo, en palabras y en la hora de la oficina', () => {
  const now = Date.UTC(2026, 10, 12, 15, 0);
  assert.equal(Standup.from(null, now, 'UTC'), null);
  assert.equal(Standup.from(Date.UTC(2026, 10, 12, 9, 30), now, 'UTC'), 'desde las 09:30');
  assert.equal(Standup.from(Date.UTC(2026, 10, 11, 9, 30), now, 'UTC'), 'desde ayer a las 09:30');
  assert.equal(Standup.from(Date.UTC(2026, 10, 9, 9, 30), now, 'UTC'), 'desde el 2026-11-09');
  assert.equal(Standup.from(Date.UTC(2026, 10, 12, 9, 30), now, 'America/Santiago'), 'desde las 06:30');
});
