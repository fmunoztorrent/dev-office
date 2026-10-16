// La vida propia de la oficina (public/sim.js), en tiempo simulado: cada personaje decide qué
// hacer según sus necesidades y su personalidad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, assignees, PRODUCT, TECH, TEAM, UNICORN, rainbowPixels } from '../public/sim.js';
import { Screen } from '../tui/screen.js';
import { computeLayout, drawFrame } from '../tui/view.js';

/** Una oficina con reloj y azar propios: corre minutos en milisegundos y siempre igual. */
function office(seed = 7) {
  let t = 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const sim = createSim({ clock: () => t, random });
  const said = [];
  for (const a of Object.values(sim.agents)) {
    const say = a.say.bind(a);
    a.say = (text, ...rest) => { said.push({ t, who: a.id, text }); say(text, ...rest); };
  }
  const run = (seconds, every) => {
    for (let i = 0; i < seconds * 20; i++) {
      t += 50;
      every?.(i, t);
      sim.step(0.05, t);
    }
  };
  return { sim, said, run, now: () => t };
}

test('las NPC de producto se sientan juntas y cotorrean entre ellas', () => {
  const seats = PRODUCT.map((id) => TEAM[id].seat);
  assert.ok(seats.every((s) => s.y === seats[0].y) && Math.max(...seats.map((s) => s.x)) - Math.min(...seats.map((s) => s.x)) <= 240, 'escritorios contiguos');
  const { sim, said, run } = office();
  run(10 * 60);
  const chats = sim.journal.filter((j) => j.kind === 'deskchat' || j.kind === 'gossip');
  assert.ok(chats.length >= 4, `conversaron ${chats.length} veces`);
  for (const c of chats) assert.ok([c.who, ...c.with].every((id) => PRODUCT.includes(id)), 'el cotorreo es entre ellas');
  assert.ok(chats.some((c) => c.kind === 'deskchat') && chats.some((c) => c.kind === 'gossip'), 'desde el escritorio y juntándose');
  // y de verdad se dicen cosas
  assert.ok(said.filter((s) => PRODUCT.includes(s.who)).length >= 8);
});

test('la diseñadora salta e imagina unicornios y arcoíris', () => {
  const { sim, said, run } = office(11);
  let jumps = 0;
  let lastJump = 0;
  run(12 * 60, () => {
    const d = sim.agents.designer;
    if (d.jumpUntil !== lastJump) { lastJump = d.jumpUntil; jumps++; }
  });
  const dreams = sim.journal.filter((j) => j.kind === 'dream');
  assert.ok(dreams.some((d) => d.dream === 'unicorn'), 'unicornio');
  assert.ok(dreams.some((d) => d.dream === 'rainbow'), 'arcoíris');
  assert.ok(dreams.length <= 14, `no vive soñando: ${dreams.length} en 12 minutos`);
  assert.ok(jumps >= dreams.length, 'salta cuando se le ocurre algo');
  assert.ok(said.some((s) => s.who === 'designer' && /🦄|🌈/.test(s.text)));
  assert.ok(dreams.every((d) => d.who === 'designer'));
});

test('un requerimiento: la PO se lo lleva al manager y él lo reparte según la tarea', () => {
  const { sim, said, run } = office(3);
  run(5);
  sim.handle({ kind: 'dispatch', text: 'Para Claude Code: Nueva pantalla de pagos con su endpoint' });
  sim.handle({ kind: 'task', text: 'Nueva pantalla de pagos con su endpoint' }); // el mismo pedido, reportado por el agente
  let poAtManager = false;
  let managerAtDevs = new Set();
  run(70, () => {
    const po = sim.agents.po, m = sim.agents.manager;
    if (!po.seated && Math.hypot(po.x - (TEAM.manager.seat.x - 70), po.y - (TEAM.manager.seat.y - 6)) < 4) poAtManager = true;
    for (const r of ['frontend', 'backend']) if (!m.seated && Math.hypot(m.x - (TEAM[r].seat.x + 62), m.y - (TEAM[r].seat.y - 6)) < 4) managerAtDevs.add(r);
  });
  const reqs = sim.journal.filter((j) => j.kind === 'requirement');
  assert.equal(reqs.length, 1, 'el encargo y el prompt del agente son un solo requerimiento');
  assert.deepEqual(reqs[0].to, ['frontend', 'backend']);
  assert.ok(poAtManager, 'la PO fue al escritorio del manager');
  assert.deepEqual([...managerAtDevs].sort(), ['backend', 'frontend'], 'el manager fue a cada uno');
  assert.deepEqual(sim.journal.filter((j) => j.kind === 'assign').map((j) => j.with[0]), ['frontend', 'backend']);
  assert.ok(said.some((s) => s.who === 'po' && /Marco, nuevo requerimiento/.test(s.text)));
  assert.ok(said.some((s) => s.who === 'manager' && /Lucía, esto es para ti/.test(s.text)));
  assert.ok(sim.agents.po.seated && sim.agents.manager.seated, 'y vuelven a sus puestos');
});

test('trabajando, los técnicos a veces van a consultar al TL (no siempre)', () => {
  const { sim, said, run } = office(5);
  // Diego y Andrés trabajan todo el rato; Lucía no hace nada
  run(10 * 60, (i) => {
    if (i % 40 === 0) {
      sim.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js', ok: true });
      sim.handle({ kind: 'tool_start', role: 'qa', tool: 'Bash', text: 'Ejecutando npm test', ok: true });
    }
  });
  const consults = sim.journal.filter((j) => j.kind === 'consult');
  const by = (id) => consults.filter((c) => c.who === id).length;
  assert.ok(by('backend') >= 2 && by('qa') >= 2, `Diego ${by('backend')}, Andrés ${by('qa')}`);
  assert.ok(by('backend') <= 10 && by('qa') <= 10, 'a veces, no a cada rato');
  assert.equal(by('frontend'), 0, 'quien no trabaja no tiene dudas');
  assert.ok(consults.every((c) => TECH.includes(c.who)));
  // el TL contesta
  assert.ok(said.filter((s) => s.who === 'tl').length >= consults.length);
  assert.ok(said.some((s) => s.who === 'backend' && /^Tomás, /.test(s.text)));
});

test('a quién le toca cada requerimiento', () => {
  assert.deepEqual(assignees('Arreglar el bug del login'), ['backend', 'qa']);
  assert.deepEqual(assignees('Cambiar la paleta y el logo'), ['designer']);
  assert.deepEqual(assignees('Nueva página de perfil'), ['frontend']);
  assert.deepEqual(assignees('Investigar opciones de arquitectura'), ['tl']);
});

test('reset deja a todos en su puesto, sin conversaciones ni sueños', () => {
  const { sim, run } = office(9);
  run(4 * 60);
  sim.reset();
  for (const a of Object.values(sim.agents)) {
    assert.ok(a.seated && !a.queue.length && !a.scene && !a.dream);
    assert.deepEqual([a.x, a.y], [a.cfg.seat.x, a.cfg.seat.y]);
  }
  assert.equal(sim.scenes.length, 0);
});

test('la terminal dibuja el unicornio y el arcoíris', () => {
  const { sim, run, now } = office(2);
  run(1);
  const L = computeLayout(220, 60); // grande: el sueño en pixel art (en chico va como emoji)
  const model = { selected: null, log: [], sessions: new Map(), connection: { ok: true, label: '' }, endpoints: [], tasks: { tasks: [], agents: [] }, pipelines: [], targets: [] };
  const render = (kind) => {
    sim.agents.designer.dream = { kind, start: now() - 1000, until: now() + 10_000 };
    const scr = new Screen({ colorMode: 'truecolor' });
    scr.resize(220, 60);
    drawFrame(scr, L, sim, model, now());
    return scr.flush();
  };
  // los colores del sueño aparecen en la salida (rosa de la crin, bandas del arcoíris)
  assert.match(render('unicorn'), /255;126;182/);
  assert.match(render('rainbow'), /239;71;111/);
  assert.ok(UNICORN.every((row) => row.length === UNICORN[0].length));
  // en una terminal chica, como emoji
  const small = new Screen({ colorMode: 'truecolor' });
  small.resize(100, 30);
  sim.agents.designer.dream = { kind: 'unicorn', start: now() - 1000, until: now() + 10_000 };
  drawFrame(small, computeLayout(100, 30), sim, model, now());
  assert.match(small.flush(), /🦄/);
  assert.ok(rainbowPixels(6).length > 20);
});
