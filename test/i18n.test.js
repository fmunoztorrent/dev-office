// Languages: English by default, Spanish available from the start; the language is saved in the
// database and shared by the server, the terminal and the web. (This file does NOT import ./es.js: it tests English.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import en from '../public/locales/en.js';
import es from '../public/locales/es.js';
import { t, ta, listOf, setLanguage, getLanguage, LANGUAGES } from '../public/i18n.js';
import { createSim, TEAM, applyAppearance, phaseInfo } from '../public/sim.js';
import { describe } from '../server/roles.js';
import { openStore } from '../server/store.js';
import { startServer } from '../server/server.js';

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const get = (o, k) => k.split('.').reduce((x, y) => x?.[y], o);
const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',') : '');

test('los dos idiomas tienen las mismas claves y las mismas {variables}', () => {
  assert.deepEqual(Object.keys(LANGUAGES), ['en', 'es']);
  const a = flat(en), b = flat(es);
  assert.deepEqual(a.filter((k) => !b.includes(k)), [], 'faltan en español');
  assert.deepEqual(b.filter((k) => !a.includes(k)), [], 'faltan en inglés');
  for (const k of a) assert.equal(vars(get(en, k)), vars(get(es, k)), k);
  for (const k of a) if (Array.isArray(get(en, k))) assert.ok(get(en, k).length && get(es, k).length, k);
});

test('inglés por defecto; español al elegirlo (y uno desconocido vuelve al inglés)', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(t('conn.live'), 'live');
  assert.equal(t('err.noDir', { dir: '/x' }), 'the directory /x does not exist');
  assert.equal(t('settings.offices.agents', { n: 0 }), '0 agent(s)', 'el 0 también se escribe');
  assert.equal(t('err.noDir', {}), 'the directory  does not exist', 'lo que falta queda vacío');
  assert.equal(listOf(['Ana', 'Leo', 'Sol']), 'Ana, Leo, and Sol');
  assert.equal(describe('Edit', { file_path: 'src/api.js' }), 'Editing api.js');
  assert.equal(TEAM.designer.title, 'Designer');
  assert.equal(phaseInfo('historia').label, 'Story');
  setLanguage('es');
  try {
    assert.equal(t('conn.live'), 'en vivo');
    assert.equal(listOf(['Ana', 'Leo', 'Sol']), 'Ana, Leo y Sol');
    assert.equal(describe('Edit', { file_path: 'src/api.js' }), 'Editando api.js');
    assert.equal(TEAM.designer.title, 'Diseñadora', 'el cargo que no se personalizó cambia de idioma');
    assert.equal(phaseInfo('historia').label, 'Historia');
    // a customized title stays as it is
    applyAppearance({ designer: { title: 'Ilustradora' } });
    setLanguage('en');
    assert.equal(TEAM.designer.title, 'Ilustradora');
    applyAppearance({});
    assert.equal(TEAM.designer.title, 'Designer');
    assert.equal(setLanguage('klingon'), 'en');
    assert.ok(ta('sim.replies').length > 3);
  } finally { setLanguage('en'); applyAppearance({}); }
});

test('la vida de la oficina habla el idioma del juego (con los nombres actuales del equipo)', () => {
  let now = 0;
  const sim = createSim({ clock: () => now, random: () => 0.5, wall: () => new Date(2026, 9, 16, 10, 0).getTime() });
  const said = new Set();
  const run = (s) => { for (let i = 0; i < s * 20; i++) { now += 50; sim.step(0.05, now); for (const a of Object.values(sim.agents)) if (a.bubble) said.add(a.bubble.text); } };
  run(1);
  sim.handle({ kind: 'subagent_start', role: 'backend', subId: 's1', text: 'API' });
  run(12);
  assert.ok(said.has('Diego, this one is yours: API'), [...said].join(' | '));
  applyAppearance({ backend: { name: 'Bruno' } });
  try {
    sim.handle({ kind: 'subagent_start', role: 'backend', subId: 's2', text: 'DB' });
    run(12);
    assert.ok(said.has('Bruno, this one is yours: DB'), [...said].join(' | '));
    sim.handle({ kind: 'waiting', text: 'Bash?' });
    assert.equal(sim.agents.manager.bubble.text, 'We need your OK! ✋');
  } finally { applyAppearance({}); }
});

test('el idioma se guarda en la base y lo comparten todos: los errores de la API, los eventos y la web', async () => {
  delete process.env.DEV_TEAM_OFFICE_LANG;
  const store = openStore(':memory:');
  assert.equal(store.getPrefs().lang, 'en', 'inglés por defecto');
  const server = await startServer({ port: 0, socket: null, db: store, weather: false });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const prefs = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'prefs') prefs.push(m.prefs); });
  await new Promise((r) => ws.on('open', r));
  const put = (body) => fetch(`${server.url}/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    assert.equal((await put({ prefs: { lang: 'tlh' } })).error, 'unknown language: tlh');
    assert.equal((await put({ prefs: { lang: 'es' } })).prefs.lang, 'es');
    assert.equal(store.getPrefs().lang, 'es');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(prefs.at(-1)?.lang, 'es', 'las interfaces abiertas se enteran');
    const r = await fetch(`${server.url}/v1/agents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harness: 'pi' }) }).then((x) => x.json());
    assert.equal(r.error, 'falta la ruta');
    const [ev] = server.company.ingest('claude-code', { hook_event_name: 'PreToolUse', session_id: 's', cwd: '/p', tool_name: 'Read', tool_input: { file_path: '/p/a.md' } });
    assert.equal(ev.text, 'Leyendo a.md');
    assert.equal((await fetch(`${server.url}/v1/state`).then((x) => x.json())).office.name, 'Oficina principal');
  } finally {
    ws.close();
    await server.close();
    setLanguage('en');
  }
});
