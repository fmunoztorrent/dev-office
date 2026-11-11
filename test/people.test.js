// The people of the office: how they walk (the feet step), what their screens show while they
// work, their sex and their personality (⚙ › Characters) and the coffee breaks in the middle of a task.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { t, ta, setLanguage } from '../public/i18n.js';
import { createSim, TEAM, DEFAULT_TEAM, applyAppearance, gait, screenMode, screenLines, traitsOf, randomLook, lookForSex, PERSONALITIES } from '../public/sim.js';
import { openStore } from '../server/store.js';
import { startServer } from '../server/server.js';
import { runTui } from '../tui/app.js';
import { localFeed } from '../tui/feeds.js';
import { computeLayout } from '../tui/view.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timeout');
};

function office(seed = 7) {
  let now = 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const sim = createSim({ clock: () => now, random, wall: () => new Date(2026, 9, 16, 10, 0).getTime() + now });
  sim.setWeather({ kind: 'clear', temp: 20 });
  const said = [];
  for (const a of Object.values(sim.agents)) {
    const say = a.say.bind(a);
    a.say = (text, ...rest) => { said.push({ t: now, who: a.id, text }); say(text, ...rest); };
  }
  const run = (s) => { for (let i = 0; i < s * 20; i++) { now += 50; sim.step(0.05, now); } };
  return { sim, said, run, now: () => now };
}

test('al caminar los pies dan pasos: cuatro cuadros por zancada, un pie adelante, el otro en el aire', () => {
  const walker = { walking: true, sideways: true, face: 1, walkT: 0 };
  const frames = [0, 0.12, 0.23, 0.34].map((walkT) => gait({ ...walker, walkT }));
  assert.deepEqual(frames.map((g) => g.frame), [0, 1, 2, 3]);
  assert.deepEqual(frames[0].reach, [1, -1], 'el izquierdo adelante (hacia donde mira)');
  assert.deepEqual(frames[2].reach, [-1, 1], 'después el derecho');
  assert.deepEqual(frames[1].lift, [0, 1], 'al cruzar, uno va en el aire');
  assert.deepEqual(frames[3].lift, [1, 0]);
  assert.equal(frames[1].bob, 1, 'el cuerpo sube un poco al cruzar');
  assert.equal(frames[0].swing, -frames[2].swing, 'los brazos van al revés que las piernas');
  // walking up or down the screen: the feet go up and down, they do not stride sideways
  assert.deepEqual(gait({ ...walker, sideways: false }).reach, [0, 0]);
  assert.equal(gait({ walking: false }), null, 'quieto: sin ciclo');
});

test('la pantalla del escritorio: código que se escribe y sube mientras trabaja; quieto mientras piensa; apagada sin nada', () => {
  const a = { id: 'backend', seated: true, state: 'working', taskAt: 0 };
  assert.equal(screenMode(a, 1000), 'type');
  assert.equal(screenMode({ ...a, state: 'thinking' }, 1000), 'think');
  assert.equal(screenMode({ ...a, state: 'idle' }, 1000), 'think', 'con una tarea en curso la pantalla sigue encendida');
  assert.equal(screenMode({ ...a, state: 'coffee', seated: false }, 1000), 'on', 'en la cafetería: encendida, más tenue');
  assert.equal(screenMode({ ...a, state: 'idle', taskAt: -Infinity }, 1000), 'off');
  assert.equal(screenMode(null, 0), 'off', 'un escritorio libre');
  // typing: the last line grows, then it all scrolls up a line
  const len = (s) => s.rows.at(-1).reduce((n, x) => n + x.w, 0);
  const early = screenLines('backend', 0, 4, 12), later = screenLines('backend', 600, 4, 12);
  assert.equal(early.rows.length, 4);
  assert.ok(len(later) > len(early), 'la última línea se va escribiendo');
  const next = screenLines('backend', 1100, 4, 12);
  assert.deepEqual(next.rows[2], later.rows[3].length ? screenLines('backend', 1099, 4, 12).rows[3] : next.rows[2], 'la línea terminada sube');
  for (const r of later.rows) for (const s of r) assert.ok(s.x + s.w <= 12, 'no se sale de la pantalla');
  // thinking: nothing moves but the cursor
  assert.deepEqual(screenLines('qa', 0, 3, 10, 'think').rows, screenLines('qa', 50_000, 3, 10, 'think').rows);
});

test('el sexo cambia los textos que hablan de la persona y su aspecto por defecto', () => {
  setLanguage('es');
  try {
    assert.equal(t('state.done', { g: 'f' }), 'lista');
    assert.equal(t('state.done', { g: 'm' }), 'listo');
    assert.equal(t('state.blocked'), 'bloqueado', 'sin decir quién: el genérico');
    assert.equal(TEAM.designer.title, 'Diseñadora');
    applyAppearance({ designer: { sex: 'm' } });
    assert.equal(TEAM.designer.title, 'Diseñador', 'el cargo que no se personalizó concuerda con su sexo');
    applyAppearance({ designer: { sex: 'm', title: 'Ilustradora' } });
    assert.equal(TEAM.designer.title, 'Ilustradora', 'uno personalizado queda como está');
    assert.ok(ta('sim.roundsReplies', { g: 'f' }).some((x) => /trabada/.test(x)));
  } finally { applyAppearance({}); setLanguage('es'); }
  assert.deepEqual(lookForSex('m'), { sex: 'm', long: false });
  assert.deepEqual(lookForSex('f'), { sex: 'f', long: true, beard: false });
  for (let i = 0; i < 40; i++) assert.equal(randomLook('f').beard, false, 'a ella no le sale barba al azar');
});

test('la personalidad cambia lo que hacen: las de siempre se portan igual; un QA conversador cotorrea', () => {
  for (const id of Object.keys(TEAM)) assert.ok(PERSONALITIES[DEFAULT_TEAM[id].personality], id);
  const qa = traitsOf('qa');
  assert.equal(qa.chats, false, 'el QA de siempre no se pone a cotorrear');
  assert.equal(qa.tv, true);
  assert.equal(traitsOf('po').chats, true);
  try {
    applyAppearance({ qa: { personality: 'chatty' }, po: { personality: 'focused' }, analyst: { personality: 'dreamer' } });
    assert.equal(traitsOf('qa').chats, true);
    assert.ok(traitsOf('qa').social <= qa.social / 2, 'y le dan ganas de hablar mucho antes');
    assert.equal(traitsOf('po').chats, false, 'una PO concentrada casi no cotorrea');
    assert.ok(traitsOf('po').breaks > traitsOf('qa').breaks, 'ni se para tanto');
    assert.ok(traitsOf('analyst').dream > 0, 'una analista soñadora sueña despierta');
    // in the office: the chatty QA ends up chatting with whoever is free
    const { sim, run } = office(11);
    sim.agents.qa.mind.social = 1.2;
    run(30);
    assert.ok(sim.journal.some((j) => ['deskchat', 'gossip', 'bathgossip'].includes(j.kind) && j.who === 'qa'), JSON.stringify(sim.journal.map((j) => [j.kind, j.who])));
  } finally { applyAppearance({}); }
});

test('en medio de una tarea va a la cafetería a contar en qué anda y vuelve pensando cómo resolverlo', () => {
  const { sim, said, run } = office(5);
  run(2);
  sim.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js' });
  run(3);
  sim.agents.backend.mind.brk = 1.5;
  let went = null;
  for (let i = 0; i < 60 && !went; i++) { run(1); went = sim.journal.find((j) => j.kind === 'workcoffee' && j.who === 'backend'); }
  assert.ok(went, 'fue por un café');
  assert.match(went.text, /Diego va por un café/);
  run(15); // walks to the counter and talks
  const pool = [...ta('sim.workCoffee.open', { action: 'editando api.js' }), ...ta('sim.workCoffee.alone', { action: 'editando api.js' })];
  assert.ok(said.some((s) => s.who === 'backend' && pool.some((p) => p.replace(/«[^»]*»/, '') === s.text.replace(/«[^»]*»/, ''))), `cuenta lo que hace: ${JSON.stringify(said.filter((s) => s.who === 'backend'))}`);
  run(30);
  const back = ta('sim.workCoffee.back');
  assert.ok(said.some((s) => s.who === 'backend' && back.includes(s.text)), 'vuelve pensando');
  // real work calls them back at any moment
  const { sim: s2, run: r2 } = office(5);
  r2(2);
  s2.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js' });
  r2(3);
  s2.agents.backend.mind.brk = 1.5;
  for (let i = 0; i < 60 && s2.agents.backend.scene?.kind !== 'workcoffee'; i++) r2(0.5);
  assert.equal(s2.agents.backend.scene?.kind, 'workcoffee');
  s2.handle({ kind: 'tool_start', role: 'backend', tool: 'Bash', text: 'Corriendo los tests' });
  assert.equal(s2.agents.backend.scene, null, 'deja el café y vuelve a su puesto');
});

test('el sexo y la personalidad se guardan por oficina y se validan', () => {
  const store = openStore(':memory:');
  try {
    assert.deepEqual(store.setAppearance({ qa: { sex: 'f', personality: 'chatty', skin: '#8D5A3B', hair: '#e8e9f1' } }).appearance.qa, { sex: 'f', personality: 'chatty', skin: '#8d5a3b', hair: '#e8e9f1' });
    assert.match(store.setAppearance({ qa: { sex: 'x' } }).error, /sex.*f, m/);
    assert.match(store.setAppearance({ qa: { personality: 'grumpy' } }).error, /personality.*chatty/);
    assert.equal(store.setAppearance({ qa: { skin: 'pink' } }).ok, false);
    assert.equal(store.getAppearance().qa.sex, 'f', 'lo inválido no se guarda');
  } finally { store.close?.(); }
});

test('desde la terminal: Personajes → sexo, personalidad y un color de piel escrito en hex', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const cols = 160, rows = 46;
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  const stdout = Object.assign(new EventEmitter(), { columns: cols, rows, out: '', write(s) { this.out += s; return true; } });
  const type = (s) => stdin.emit('data', s);
  const done = runTui({ feed: localFeed(server), stdin, stdout, colorMode: 'truecolor' });
  try {
    await sleep(150);
    const { gearCell } = computeLayout(cols, rows);
    type(`\x1b[<0;${gearCell.col + 2};${gearCell.row + 1}M`);
    await until(() => stdout.out.includes('⚙ Ajustes'));
    for (let i = 0; i < 3; i++) type('\x1b[C');
    await until(() => stdout.out.includes('Pelo largo'));
    for (let i = 0; i < 4; i++) type('\x1b[B'); // Character → Name → Title → Sex
    await until(() => stdout.out.includes('Hombre'));
    type('\x1b[C'); // Tomás: man → woman
    type('\x1b[B'); // Personality
    type('\x1b[C'); // calm → dreamer
    type('\x1b[B'); // Skin
    type('#5c3a21');
    type('\x13');
    const look = await until(() => server.store.getAppearance().tl);
    assert.deepEqual({ sex: look.sex, long: look.long, beard: look.beard, personality: look.personality, skin: look.skin }, { sex: 'f', long: true, beard: false, personality: 'dreamer', skin: '#5c3a21' });
    await until(() => TEAM.tl.sex === 'f');
  } finally {
    type('\x1b');
    type('q');
    await done;
    await server.close();
    applyAppearance({});
  }
});
