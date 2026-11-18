// The graphic themes (public/themes.js): the anime one is its own cast, all of them women, drawn with
// vector strokes (public/anime.js), and it keeps its own customizations apart from the pixel ones.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { startServer } from '../server/server.js';
import { createSim, setTheme, currentTheme, TEAM, VISITORS, defaultLook, applyAppearance, setExperts, expertPerson } from '../public/sim.js';
import { animeStyle, ANIME_TEAM, ANIME_VISITORS, ANIME_FLOORS, HAIRSTYLES, OUTFITS } from '../public/themes.js';
import { drawAnime, ANIME_HEIGHT } from '../public/anime.js';
import { createFloors } from '../public/floors.js';

test('el elenco anime: sus nombres, todas mujeres (aunque un look guardado diga otra cosa), y de vuelta al pixel art', (t) => {
  t.after(() => { setTheme('pixel'); applyAppearance({}); });
  assert.equal(currentTheme(), 'pixel');
  assert.deepEqual([TEAM.backend.name, TEAM.backend.sex], ['Diego', 'm']);
  assert.equal(setTheme('anime'), true);
  assert.equal(setTheme('anime'), false, 'ya estaba');
  for (const [id, c] of Object.entries({ ...TEAM, ...VISITORS })) {
    assert.equal(c.sex, 'f', `${id} es mujer`);
    assert.equal(c.beard, false);
    assert.equal(c.name, (ANIME_TEAM[id] || ANIME_VISITORS[id]).name);
  }
  assert.deepEqual([TEAM.backend.title, TEAM.designer.title, defaultLook('qa').name], ['Backend', 'Diseñadora', 'Nanami']);
  // a look saved as a man: here, a woman (her name stays: it was chosen)
  applyAppearance({ tl: { name: 'Tomás', sex: 'm', beard: true } });
  assert.deepEqual([TEAM.tl.name, TEAM.tl.sex, TEAM.tl.beard], ['Tomás', 'f', false]);
  setExperts([{ id: 'x1', skill: 'pci-dss', look: { name: 'Bruno', sex: 'm', beard: true } }]);
  assert.deepEqual([expertPerson('x1').sex, expertPerson('x1').beard], ['f', false]);
  setTheme('pixel');
  applyAppearance({});
  assert.deepEqual([TEAM.backend.name, TEAM.backend.sex, TEAM.tl.beard], ['Diego', 'm', true]);
  assert.equal(setTheme('vaporwave'), false, 'un tema que no existe es el de siempre');
});

test('en el tema anime, los recién llegados también son mujeres', (t) => {
  t.after(() => setTheme('pixel'));
  setTheme('anime');
  let now = 0;
  const sim = createSim({ clock: () => now, random: () => 0.3, wall: () => Date.UTC(2026, 9, 16, 13) });
  for (const role of ['backend', 'qa', 'tl']) sim.handle({ kind: 'tool_start', role, session: 'main', tool: 'Edit', text: 'En lo suyo' }); // the role's own character is busy: a newcomer comes
  for (const [subId, role] of [['a', 'backend'], ['b', 'qa'], ['c', 'tl']]) sim.handle({ kind: 'subagent_start', role, subId, text: `parte ${subId}` });
  const ghosts = [...sim.ghosts];
  assert.equal(ghosts.length, 3);
  for (const g of ghosts) {
    assert.equal(g.cfg.sex, 'f');
    assert.equal(g.cfg.beard, false);
    assert.match(g.cfg.name, /^(Yui|Aoi|Miyu|Riko|Saki|Nao|Kana|Shiori|Chika|Eri|Mana|Tomoe|Ayaka|Fumi)$/);
  }
});

test('el estilo de cada una: el de su ficha, o uno fijo por su id; el pelo corto o largo del look manda', () => {
  assert.deepEqual(animeStyle('designer'), { hairstyle: 'twintails', outfit: 'offshoulder', eyes: ANIME_TEAM.designer.eyes });
  assert.equal(animeStyle('coo').hairstyle, ANIME_FLOORS.coo.hairstyle);
  assert.ok(['bob', 'short'].includes(animeStyle('designer', { long: false }).hairstyle));
  assert.ok(!['bob', 'short'].includes(animeStyle('frontend', { long: true }).hairstyle));
  const x = animeStyle('expert-42');
  assert.deepEqual(animeStyle('expert-42'), x, 'siempre la misma');
  assert.ok(HAIRSTYLES.includes(x.hairstyle) && OUTFITS.includes(x.outfit), JSON.stringify(x));
  for (let i = 0; i < 50; i++) assert.ok(OUTFITS.includes(animeStyle(`new:${i}`).outfit), 'cualquier id tiene su ropa');
  assert.deepEqual(animeStyle('po', { hairstyle: 'braid', outfit: 'suit' }), { hairstyle: 'braid', outfit: 'suit', eyes: ANIME_TEAM.po.eyes }, 'lo que dice el look gana');
});

/** A canvas context that only keeps count: drawing must not break and must leave the state as it found it. */
function fakeCtx() {
  let depth = 0, calls = 0;
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(_, k) {
      if (k === 'depth') return depth;
      if (k === 'calls') return calls;
      if (k === 'save') return () => { depth++; calls++; };
      if (k === 'restore') return () => { depth--; calls++; };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      return () => { calls++; };
    },
    set() { return true; },
  });
}

test('el dibujo anime: cada peinado, cada ropa y cada pose se dibujan sin romper nada', () => {
  const poses = [{}, { walking: true, walkT: 0.3, face: 1 }, { walking: true, walkT: 0.7, face: -1, sideways: false }, { seated: true, state: 'working' }, { perch: true, food: '🍝' }, { back: true }, { handUp: true }, { carry: true }, { carry: 'ext' }, { dance: true }, { state: 'done', jumpUntil: 10 }, { state: 'blocked' }, { bubble: { text: 'hola', until: 99 } }];
  let n = 0;
  for (const hairstyle of HAIRSTYLES) {
    for (const outfit of OUTFITS) {
      // the look says its hair style and its outfit
      const id = `${hairstyle}-${outfit}`;
      for (const p of poses) {
        const ctx = fakeCtx();
        drawAnime(ctx, { id, role: id, cfg: { ...ANIME_TEAM.po, hairstyle, outfit, glasses: n % 2 === 0 }, state: 'idle', ...p }, 5, { x: 100, y: 200 });
        assert.equal(ctx.depth, 0, `${id} ${JSON.stringify(p)}: save/restore balanced`);
        assert.ok(ctx.calls > 40);
        n++;
      }
    }
  }
  assert.ok(ANIME_HEIGHT > 64 && ANIME_HEIGHT < 76);
});

test('los pisos compartidos: su gente en el tema anime son mujeres, y vuelven a ser los de siempre', () => {
  const floors = createFloors({ clock: () => 0 });
  floors.setTheme('anime');
  assert.deepEqual(['coo', 'cto', 'assistant'].map((id) => [floors.exec.people[id].cfg.name, floors.exec.people[id].cfg.sex]), [['Ayame', 'f'], ['Kyoko', 'f'], ['Emi', 'f']]);
  assert.equal(floors.archive.people.skills.cfg.name, 'Momo');
  floors.setTheme('pixel');
  assert.deepEqual([floors.exec.people.coo.cfg.name, floors.exec.people.cto.cfg.beard], ['Ignacio', true]);
});

test('la base: cada tema guarda sus propios personajes; el ajuste se valida', () => {
  const store = openStore(':memory:');
  assert.equal(store.getPrefs().theme, 'pixel');
  store.setAppearance({ backend: { name: 'Diego Jr.' } });
  assert.match(store.setPrefs({ theme: 'manga' }).error, /theme/);
  assert.equal(store.setPrefs({ theme: 'anime' }).ok, true);
  assert.deepEqual(store.getAppearance(), {}, 'el elenco anime no hereda los cambios del pixel art');
  store.setAppearance({ backend: { name: 'Yuki-san' } });
  assert.equal(store.getAppearance().backend.name, 'Yuki-san');
  assert.equal(store.getAppearance('main', 'pixel').backend.name, 'Diego Jr.');
  store.setPrefs({ theme: 'pixel' });
  assert.equal(store.getAppearance().backend.name, 'Diego Jr.');
  // a department that goes takes both casts with it
  const o = store.createOffice({ name: 'Pagos' }).office;
  store.setAppearance({ qa: { name: 'A' } }, o.id);
  store.setPrefs({ theme: 'anime' });
  store.setAppearance({ qa: { name: 'B' } }, o.id);
  store.deleteOffice(o.id);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'appearance:%'").get().n, 0);
});

test('por la API: cambiar de tema avisa a cada oficina con el elenco de ese tema', async (t) => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 }, loops: { autostart: false } });
  t.after(async () => { await server.close(); setTheme('pixel'); });
  const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const seen = [];
  server.bus.on('appearance', (id, a) => seen.push([id, a]));
  await call('PUT', '/v1/settings', { appearance: { backend: { name: 'Diego Jr.' } } });
  seen.length = 0;
  const r = await call('PUT', '/v1/settings', { prefs: { theme: 'anime' } });
  assert.equal(r.body.prefs.theme, 'anime');
  assert.deepEqual(seen, [['main', {}]], 'el elenco anime, sin los cambios del pixel art');
  assert.equal(currentTheme(), 'anime', 'el servidor nombra con el elenco del tema');
  assert.equal(defaultLook('backend').name, 'Yuki');
  const s = await call('GET', '/v1/settings');
  assert.deepEqual(s.body.office.appearance, {});
});
