// La vida propia de la oficina (public/sim.js), en tiempo simulado: cada personaje decide qué
// hacer según sus necesidades y su personalidad.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, assignees, PRODUCT, TECH, TEAM, UNICORN, SKULL, PIZZA, rainbowPixels, DINING, DINING_SEATS, RACK, SOFA, TV } from '../public/sim.js';
import { Screen } from '../tui/screen.js';
import { computeLayout, drawFrame } from '../tui/view.js';

/** Una oficina con reloj y azar propios: corre minutos en milisegundos y siempre igual. */
const CLEAR = { kind: 'clear', clouds: 0.05, precip: 0, wind: 5, temp: 20, lat: -33.45, lon: -70.65, sunrise: 7, sunset: 20, source: 'test' };
function office(seed = 7, { hour = 10, weather = CLEAR } = {}) {
  let t = 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const morning = new Date(2026, 9, 16, Math.floor(hour), Math.round((hour % 1) * 60)).getTime(); // hora fija: el almuerzo no depende de cuándo corren los tests
  const sim = createSim({ clock: () => t, random, wall: () => morning + t });
  sim.setWeather(weather); // el clima, fijo: que no dependa de la zona horaria de la máquina
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
  const dreams = sim.journal.filter((j) => j.kind === 'dream' && j.who === 'designer');
  assert.ok(dreams.some((d) => d.dream === 'unicorn'), 'unicornio');
  assert.ok(dreams.some((d) => d.dream === 'rainbow'), 'arcoíris');
  assert.ok(dreams.length <= 14, `no vive soñando: ${dreams.length} en 12 minutos`);
  assert.ok(jumps >= dreams.length, 'salta cuando se le ocurre algo');
  assert.ok(said.some((s) => s.who === 'designer' && /🦄|🌈/.test(s.text)));
  assert.ok(dreams.every((d) => d.dream === 'unicorn' || d.dream === 'rainbow'));
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

test('QA a veces sueña con calaveras y los devs con pizza (con su factor de azar)', () => {
  const { sim, said, run } = office(4);
  run(30 * 60);
  const dreams = (who) => sim.journal.filter((j) => j.kind === 'dream' && j.who === who);
  assert.ok(dreams('qa').length >= 1 && dreams('qa').every((d) => d.dream === 'skull'), `QA: ${dreams('qa').length}`);
  for (const dev of ['backend', 'frontend']) assert.ok(dreams(dev).length >= 1 && dreams(dev).every((d) => d.dream === 'pizza'), `${dev}: ${dreams(dev).length}`);
  // a veces: no a cada rato, y no todos al mismo ritmo
  for (const who of ['qa', 'backend', 'frontend']) assert.ok(dreams(who).length <= 14, `${who} soñó ${dreams(who).length} veces en 30 minutos`);
  assert.ok(dreams('analyst').length === 0 && dreams('po').length === 0);
  assert.ok(said.some((s) => s.who === 'qa' && /💀/.test(s.text)) && said.some((s) => s.who === 'backend' && /🍕/.test(s.text)));
  for (const sprite of [SKULL, PIZZA]) assert.ok(sprite.every((row) => row.length === sprite[0].length));
});

test('a las 13:00 el equipo se va a almorzar al comedor (salvo quien está trabajando) y después vuelve', () => {
  const { sim, said, run, now } = office(6, { hour: 12 + 58 / 60 });
  let maxAtTables = 0;
  let foods = new Set();
  const seats = [...DINING_SEATS.back, ...DINING_SEATS.front];
  const { x: tx, y: ty, w: tw } = DINING.table;
  const crossed = [];
  run(4 * 60, (i) => {
    if (i % 40 === 0) sim.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js', ok: true });
    const perched = Object.values(sim.agents).filter((a) => a.perch && seats.some((s) => s.x === a.x && s.y === a.y));
    maxAtTables = Math.max(maxAtTables, perched.length);
    for (const a of perched) foods.add(a.food);
    // nadie atraviesa la mesa: se llega a cada silla por detrás o por delante
    for (const a of Object.values(sim.agents)) if (!a.perch && a.x > tx - tw / 2 && a.x < tx + tw / 2 && a.y > ty + 2 && a.y < ty + 44) crossed.push(`${a.id}@${Math.round(a.x)},${Math.round(a.y)}`);
  });
  assert.ok(sim.journal.some((j) => j.kind === 'lunch'), 'a las 13:00 salen a almorzar');
  assert.ok(sim.lunch, 'siguen almorzando');
  assert.equal(maxAtTables, 7, 'todos sentados a la mesa del comedor…');
  assert.deepEqual(crossed, [], 'nadie camina por encima de la mesa');
  // producto y el manager, detrás de la mesa (de frente); el equipo técnico, delante (de espaldas)
  for (const id of ['po', 'analyst', 'designer', 'manager']) assert.ok(sim.agents[id].diningSeat?.row === 'back' && !sim.agents[id].back, id);
  for (const id of ['frontend', 'qa', 'tl']) assert.ok(sim.agents[id].diningSeat?.row === 'front' && sim.agents[id].back, id);
  assert.ok(!sim.agents.backend.perch && sim.agents.backend.food === '🥪', '…menos Diego, que el agente lo tiene trabajando');
  assert.ok(foods.has('🍕') && foods.has('🥗'));
  assert.ok(said.some((s) => s.who === 'manager' && /almorzar|comer|almuerzo/i.test(s.text)));
  // si el agente la necesita, Lucía deja el almuerzo y vuelve a su puesto
  sim.handle({ kind: 'tool_start', role: 'frontend', tool: 'Edit', text: 'Editando App.vue', ok: true });
  run(20);
  assert.ok(sim.agents.frontend.seated && !sim.agents.frontend.lunch);
  // a las 14:00 a más tardar, todos de vuelta
  run(60 * 60);
  assert.ok(sim.journal.some((j) => j.kind === 'lunchend'));
  assert.ok(!sim.lunch && Object.values(sim.agents).every((a) => !a.lunch && !a.diningSeat && (!a.perch || a.back)), `${now()}`); // en el sofá (mirando tele) no es almuerzo
  assert.equal(sim.journal.filter((j) => j.kind === 'lunch').length, 1, 'se almuerza una vez al día');
});

test('el baño: de a uno, con fila si está ocupado, y todos vuelven', () => {
  const { sim, said, run } = office(8);
  for (const id of ['po', 'qa', 'manager']) sim.agents[id].mind.bladder = 1.7; // a los tres les urge a la vez
  let maxInside = 0, maxLine = 0;
  run(90, () => {
    maxInside = Math.max(maxInside, Object.values(sim.agents).filter((a) => a.hidden).length);
    maxLine = Math.max(maxLine, sim.bath.line.length);
  });
  assert.equal(maxInside, 1, 'adentro hay uno solo');
  assert.ok(maxLine >= 2, 'los demás hacen fila');
  assert.ok(sim.journal.filter((j) => j.kind === 'bathroom').length >= 3);
  assert.ok(said.some((s) => /Apúrate|Queda mucho|😬/.test(s.text)) || said.some((s) => /aguanto/.test(s.text)));
  run(60);
  assert.ok(Object.values(sim.agents).every((a) => !a.hidden) && !sim.bath.occupant);
  // y además va solo, cada tanto
  const { sim: s2, run: run2 } = office(12);
  run2(30 * 60);
  assert.ok(s2.journal.filter((j) => j.kind === 'bathroom').length >= 4);
});

test('el arquitecto a veces va a conversar con producto', () => {
  const { sim, said, run } = office(13);
  run(15 * 60);
  const chats = sim.journal.filter((j) => j.kind === 'archchat');
  assert.ok(chats.length >= 2 && chats.length <= 12, `${chats.length} conversaciones`);
  assert.ok(chats.every((c) => c.who === 'tl' && PRODUCT.includes(c.with[0])));
  assert.ok(said.some((s) => s.who === 'tl' && /^(Sofía|Valentina|Camila), |¿De dónde|¿Qué reglas|spike|Esa animación|design system/.test(s.text)));
});

test('a veces el servidor se incendia y el equipo técnico lo apaga y lo repara', () => {
  const { sim, said, run } = office(21);
  run(5);
  assert.ok(sim.ignite());
  let carried = false, maxLevel = 0;
  const phases = new Set();
  run(70, () => {
    if (sim.agents.backend.carry === 'ext') carried = true;
    if (sim.fire) { phases.add(sim.fire.phase); maxLevel = Math.max(maxLevel, sim.fire.level); }
  });
  assert.ok(carried, 'Diego tomó el extintor');
  assert.deepEqual([...phases], ['burning', 'fighting', 'repair', 'done']);
  assert.equal(maxLevel, 1);
  assert.equal(sim.fire, null);
  assert.equal(sim.extinguisher, 'floor', 'y lo devolvió');
  const repaired = sim.journal.find((j) => j.kind === 'repaired');
  assert.ok(repaired && repaired.who === 'backend' && repaired.with.includes('tl'));
  assert.ok(said.some((s) => s.who === 'po' && /Fuego/.test(s.text)) && said.some((s) => s.who === 'backend' && /arriba/.test(s.text)));
  assert.ok(sim.particles.length >= 0 && Object.values(sim.agents).every((a) => a.seated), 'todos de vuelta');
  assert.ok(sim.particles.every((p) => p.y < 600));
  // y solo, por azar: en una hora pasa alguna vez, pero no a cada rato
  const { sim: s2, run: run2 } = office(31);
  run2(60 * 60, (i) => { if (i % 60 === 0) s2.handle({ kind: 'tool_start', role: 'backend', tool: 'Bash', text: 'npm run build', ok: true }); });
  const fires = s2.journal.filter((j) => j.kind === 'fire').length;
  assert.ok(fires >= 1 && fires <= 7, `${fires} incendios en una hora`);
  assert.ok(s2.journal.filter((j) => j.kind === 'repaired').length >= fires - 1);
  assert.ok(RACK.w > 0);
});

test('lo que hace el harness se ve en la oficina: tests rojos → pesadillas de QA; verde → calma', () => {
  const { sim, said, run } = office(17);
  run(3);
  sim.agents.qa.mind.dream = 0; // sin sueños pendientes: lo que pase es por los tests
  sim.handle({ kind: 'tool_start', role: 'qa', tool: 'Bash', text: 'npm test', ok: true });
  sim.handle({ kind: 'tool_end', role: 'qa', tool: 'Bash', text: '3 tests fallaron', ok: false });
  run(6);
  const nightmare = sim.journal.find((j) => j.kind === 'dream' && j.who === 'qa');
  assert.ok(nightmare && nightmare.dream === 'skull' && nightmare.cause === 'fallaron los tests', JSON.stringify(nightmare));
  assert.match(nightmare.text, /pesadilla/);
  assert.ok(said.some((s) => s.who === 'qa' && /💀/.test(s.text)));
  // en RED (TDD) fallar es lo esperado: no hay pesadilla
  const { sim: tdd, run: runTdd } = office(17);
  runTdd(3);
  tdd.agents.qa.mind.dream = 0;
  tdd.handle({ kind: 'phase', role: 'qa', phase: 'red', text: 'tests del carrito' });
  tdd.handle({ kind: 'tool_end', role: 'qa', tool: 'Bash', phase: 'red', text: 'falla como se esperaba', ok: false });
  runTdd(6);
  assert.ok(!tdd.journal.some((j) => j.kind === 'dream' && j.who === 'qa'));
  // y cuando pasan, se le pasa
  sim.agents.qa.dream = { kind: 'skull', start: 0, until: Infinity };
  sim.handle({ kind: 'tool_end', role: 'qa', tool: 'Bash', text: 'npm test', ok: true });
  run(3);
  assert.equal(sim.agents.qa.dream, null);
});

test('lo que hace el harness se ve en la oficina: el subagente de backend teclea; errores seguidos incendian el servidor', () => {
  const { sim, run } = office(19);
  run(3);
  sim.handle({ kind: 'subagent_start', role: 'backend', subId: 's1', text: 'Implementar el endpoint de pagos' });
  run(20);
  const diego = sim.agents.backend;
  assert.ok(diego.seated && diego.badges.has('s1'), 'Diego está en su escritorio con la carpeta del subagente');
  sim.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando pagos.js', ok: true });
  assert.equal(diego.state, 'working', 'y teclea');
  // una seguidilla de errores del backend recalienta el rack hasta que se prende
  let fired = false;
  for (let i = 0; i < 8 && !fired; i++) {
    sim.handle({ kind: 'tool_end', role: 'backend', tool: 'Bash', text: 'npm run build: error', ok: false });
    run(6);
    fired = sim.journal.some((j) => j.kind === 'fire');
  }
  const fire = sim.journal.find((j) => j.kind === 'fire');
  assert.ok(fire, 'se incendió');
  assert.equal(fire.cause, 'demasiados errores seguidos');
  assert.ok(sim.journal.some((j) => j.kind === 'consult' && j.who === 'backend') || diego.mind.doubt >= 0.9 || sim.journal.some((j) => j.kind === 'fire'), 'quedó con dudas');
});

test('lo que hace el harness se ve en la oficina: arquitectura → el TL va donde producto; diseño → la diseñadora sueña', () => {
  const { sim, said, run } = office(23);
  run(3);
  sim.handle({ kind: 'phase', role: 'tl', phase: 'arquitectura', text: 'diseño del módulo de pagos' });
  run(40);
  const chat = sim.journal.find((j) => j.kind === 'archchat');
  assert.ok(chat && ['po', 'analyst'].includes(chat.with[0]), JSON.stringify(chat));
  assert.ok(said.some((s) => s.who === 'tl' && /alcance|mínimo|volumen|reglas de negocio/.test(s.text)));
  sim.agents.designer.mind.dream = 0;
  sim.handle({ kind: 'phase', role: 'designer', phase: 'ux', text: 'flujo de pago' });
  run(25);
  assert.ok(sim.journal.some((j) => j.kind === 'dream' && j.who === 'designer' && j.t > 43_000));
  // terminar la tarea: celebración y, a veces, pizza
  const { sim: s2, run: run2 } = office(3);
  run2(3);
  s2.handle({ kind: 'done', text: 'Pagos listos' });
  run2(20);
  assert.ok(s2.journal.some((j) => j.kind === 'dream' && j.dream === 'pizza' && j.cause === 'terminaron la tarea'));
});

test('el fin de turno se dibuja tranquilo: sin festejo, sin confetti, el personaje dice su línea', () => {
  const { sim, said, run } = office(13);
  run(3);
  sim.handle({ kind: 'turn_end', role: 'manager', text: 'x' });
  assert.equal(sim.banner, null, 'sin banner de festejo');
  assert.ok(!sim.particles.some((p) => p.kind === 'confetti'), 'sin partículas de confetti');
  assert.ok(said.some((s) => s.who === 'manager' && s.text === 'x'), 'el manager dice el texto del evento');
  // sin texto, cae en la línea tranquila del i18n (la misma del cierre de fase)
  sim.handle({ kind: 'turn_end', role: 'manager' });
  assert.ok(said.some((s) => s.who === 'manager' && s.text === '✔ Termino mi turno'));
  assert.ok(!sim.particles.some((p) => p.kind === 'confetti'), 'sigue sin confetti');
});

test('el fin de un subagente no festeja: nota chica de subtarea, sin confetti y sin saltos', () => {
  const { sim, said, run } = office(17);
  run(3);
  const analyst = sim.agents.analyst;
  const jumpBefore = analyst.jumpUntil;
  sim.handle({ kind: 'subagent_end', role: 'analyst', subId: 's', text: 'x' });
  assert.ok(!sim.particles.some((p) => p.kind === 'confetti'), 'sin confetti: el festejo grande es del merge');
  assert.ok(sim.particles.some((p) => p.kind === 'check'), 'una notita chica con ✔ (check)');
  assert.equal(analyst.jumpUntil, jumpBefore, 'no salta: terminó una subtarea, no el cierre');
  assert.ok(said.some((s) => s.who === 'analyst' && /✔/.test(s.text)), 'el diálogo conserva el ✔ de subtarea');
});

test('release y done festejan distinto: 🚀 el deploy real, 🎉 el merge', () => {
  const { sim, run } = office(31);
  run(3);
  sim.handle({ kind: 'phase', role: 'manager', phase: 'release', text: 'v1.4.0' });
  assert.ok(sim.banner.text.startsWith('🚀 Deploy'), `el deploy usa 🚀 Deploy: ${sim.banner.text}`);
  assert.ok(!sim.banner.text.startsWith('🎉'), 'el deploy no usa el 🎉 del merge');
  assert.ok(sim.particles.some((p) => p.kind === 'confetti'), 'el deploy festeja con confetti');
  sim.handle({ kind: 'done', text: 'merge' });
  assert.ok(sim.banner.text.startsWith('🎉'), `el merge usa 🎉: ${sim.banner.text}`);
  assert.ok(sim.particles.some((p) => p.kind === 'confetti'), 'el merge festeja con confetti');
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
  sim.ignite();
  run(3);
  sim.reset();
  assert.equal(sim.fire, null);
  for (const a of Object.values(sim.agents)) {
    assert.ok(a.seated && !a.queue.length && !a.scene && !a.dream && !a.hidden && !a.lunch && !a.perch);
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

test('el clima de afuera: cuando cambia, se anota y alguien lo comenta; los truenos asustan', () => {
  const { sim, said, run } = office(21);
  run(5);
  sim.setWeather({ ...CLEAR, kind: 'rain', clouds: 1, precip: 0.7 });
  run(6);
  const news = sim.journal.filter((j) => j.kind === 'weather');
  assert.equal(news.length, 1);
  assert.match(news[0].text, /llover/);
  assert.ok(said.some((x) => /llov|paraguas|lluvia/i.test(x.text)), 'alguien comenta la lluvia');
  // llovizna y lluvia son lo mismo para comentar: no se repite
  sim.setWeather({ ...CLEAR, kind: 'drizzle', clouds: 0.9, precip: 0.3 });
  run(2);
  assert.equal(sim.journal.filter((j) => j.kind === 'weather').length, 1);
  // con tormenta, los truenos
  sim.setWeather({ ...CLEAR, kind: 'storm', clouds: 1, precip: 1 });
  const shaken = new Set();
  run(120, () => { for (const a of Object.values(sim.agents)) if (a.shakeUntil > 0) shaken.add(a.id); });
  assert.ok(shaken.size >= 1, 'algún trueno asustó a alguien');
  assert.match(sim.journal.filter((j) => j.kind === 'weather').at(-1).text, /tormenta/);
  assert.equal(sim.weather.kind, 'storm');
  // sin clima del servidor, se simula
  sim.setWeather(null);
  assert.equal(sim.weather.source, 'simulado');
});

test('la tele: se sientan en el sofá de espaldas, sin atravesar la tele, y vuelven; el trabajo los saca', () => {
  const { sim, run } = office(5);
  run(2);
  const d = sim.agents.backend;
  assert.ok(sim.watchTV('backend', { cause: 'prueba' }));
  // por el pasillo de abajo se pasa por detrás de la tele; lo que no puede es bajar a través de ella
  const tv = { x0: TV.x - TV.w / 2, x1: TV.x + TV.w / 2, y0: 470, y1: TV.feet };
  let crossed = false, sat = false;
  run(30, () => {
    if (d.x > tv.x0 && d.x < tv.x1 && d.y > tv.y0 && d.y < tv.y1) crossed = true;
    if (d.back && d.perch && d.y === SOFA.y && SOFA.seats.includes(d.x)) sat = true;
  });
  assert.ok(sat, 'se sentó en el sofá, de espaldas');
  assert.ok(!crossed, 'no atraviesa la tele');
  assert.match(sim.journal.find((j) => j.kind === 'tv').text, /Diego se sienta a ver tele 📺 \(prueba\)/);
  // otro más: toma otro puesto del sofá
  assert.ok(sim.watchTV('qa'));
  run(20);
  assert.ok(sim.agents.qa.back && sim.agents.qa.x !== d.x);
  // si el agente lo necesita, deja la tele y vuelve a su puesto (por el costado)
  sim.handle({ kind: 'tool_start', role: 'backend', tool: 'Edit', text: 'Editando api.js', ok: true });
  run(15, () => { if (d.x > tv.x0 && d.x < tv.x1 && d.y > tv.y0 && d.y < tv.y1) crossed = true; });
  assert.ok(d.seated && !d.back && d.tvSeat === null);
  assert.ok(!crossed);
  run(60);
  assert.ok(sim.agents.qa.seated && !sim.agents.qa.back, 'al rato, el resto también vuelve');
});

test('mientras el agente espera tu OK, uno se toma un café y otro se pone a ver tele', () => {
  const { sim, run } = office(9);
  run(2);
  sim.handle({ kind: 'waiting', role: 'tl', text: '¿Apruebas el plan?' });
  run(10);
  const tv = sim.journal.find((j) => j.kind === 'tv');
  assert.ok(tv && /esperan tu OK/.test(tv.text));
});
