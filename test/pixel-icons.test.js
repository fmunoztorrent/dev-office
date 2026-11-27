// The interface's icons in pixel art (public/pixel-icons.js): every emoji the interface uses as an icon
// (its texts, its HTML, the badges over people's heads, their status) has its 12 × 12 drawing; what
// people and agents say keeps its emoji.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ICONS, PALETTE, EMOJI, MONO, EXTRA, SIZE, EMOJI_RE, iconOf, iconSVG, iconURL, drawIcon, leadingIcon, selectIcons, KEEP } from '../public/pixel-icons.js';
import en from '../public/locales/en.js';
import es from '../public/locales/es.js';
import { STATUS_ICON, PHASES, VISITORS } from '../public/sim.js';
import { KIND_ICON, RESOURCE_ICON } from '../public/impact.js';

/** What people say (their bubbles, the floors' chatter, the narrator): those emoji stay emoji. */
const SPEECH = /^(sim\.|floors\.[a-z]+\.(chat|at|react|who|lines)|narr|people\.|retro\.say)/;

/** Every emoji in the texts of a locale that the interface shows as such (not what someone says). */
function uiEmoji(locale) {
  const out = new Map();
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, p); continue; }
      if (SPEECH.test(p)) continue;
      for (const s of [].concat(v)) for (const m of String(s).matchAll(EMOJI_RE)) if (!out.has(m[0])) out.set(m[0], p);
    }
  };
  walk(locale, '');
  return out;
}

test('cada ícono es un dibujo de 12 × 12 con los colores del juego, y cada uno lo usa algún emoji', () => {
  for (const [name, rows] of Object.entries(ICONS)) {
    assert.equal(rows.length, SIZE, `${name}: 12 filas`);
    rows.forEach((r, i) => {
      assert.equal(r.length, SIZE, `${name}, fila ${i}`);
      for (const c of r) assert.ok(c === '.' || PALETTE[c], `${name}: color «${c}»`);
    });
    assert.ok(rows.join('').replace(/\./g, '').length > 10, `${name} no está vacío`);
  }
  for (const [emoji, name] of Object.entries(EMOJI)) assert.ok(ICONS[name], `${emoji} → ${name}`);
  const used = new Set(Object.values(EMOJI));
  for (const name of Object.keys(ICONS)) assert.ok(used.has(name) || EXTRA.has(name), `nadie usa ${name}`);
  for (const name of MONO) assert.ok(ICONS[name], name);
});

test('todos los emoji de la interfaz tienen su ícono: los textos, el HTML, los badges y los estados', () => {
  const missing = [];
  for (const [lang, locale] of [['en', en], ['es', es]]) {
    for (const [emoji, key] of uiEmoji(locale)) if (!iconOf(emoji)) missing.push(`${emoji} (${lang}: ${key})`);
  }
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(EMOJI_RE)) if (!iconOf(m[0])) missing.push(`${m[0]} (index.html)`);
  // the badges over people's heads (server/humanize.js) and their status (sim.js)
  const humanize = fs.readFileSync(new URL('../server/humanize.js', import.meta.url), 'utf8');
  for (const m of humanize.matchAll(/tag\('([^']+)'/g)) if (!iconOf(m[1])) missing.push(`${m[1]} (badge)`);
  for (const icon of Object.values(STATUS_ICON)) if (!iconOf(icon)) missing.push(`${icon} (estado)`);
  // the phases, the visiting specialists, the kinds of repository and of infrastructure
  for (const [what, icons] of [['fase', Object.values(PHASES).map((p) => p.icon)], ['visita', Object.values(VISITORS).map((v) => v.icon)], ['tipo', Object.values(KIND_ICON)], ['infra', Object.values(RESOURCE_ICON)]]) {
    for (const icon of icons) if (!iconOf(icon)) missing.push(`${icon} (${what})`);
  }
  // and every emoji the interface's code writes (its icon maps, its labels), outside comments
  const ui = ['main.js', 'brief.js', 'targets.js', 'settings-ui.js', 'settings-sections.js', 'impact.js', 'architecture.js',
    ...fs.readdirSync(new URL('../public/', import.meta.url)).filter((f) => f.endsWith('-ui.js'))];
  for (const f of new Set(ui)) {
    const code = fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
    for (const m of code.matchAll(EMOJI_RE)) if (!iconOf(m[0])) missing.push(`${m[0]} (${f})`);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('un emoji se reconoce con o sin su selector de variante; el SVG y el canvas dibujan los mismos píxeles', () => {
  assert.equal(iconOf('⚙️'), 'gear');
  assert.equal(iconOf('⚙'), 'gear');
  assert.equal(iconOf('✏️'), 'pencil');
  assert.equal(iconOf('🦖'), null, 'uno sin dibujo queda como está');
  assert.deepEqual(leadingIcon('✏️ cart.js'), { icon: 'pencil', text: 'cart.js' });
  assert.deepEqual(leadingIcon('cart.js'), { icon: null, text: 'cart.js' });
  const svg = iconSVG('gear');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 12 12"[^>]*shape-rendering="crispEdges"/);
  assert.match(iconURL('gear'), /^data:image\/svg\+xml;utf8,/);
  // a mono one: black in the SVG (the page paints it with the text's color through a mask)
  assert.doesNotMatch(iconSVG('play'), /fill="(?!#000)/);
  // the canvas: one rectangle per run of a color, all inside the square
  const rects = [];
  const ctx = { set fillStyle(v) { this.c = v; }, fillRect: (x, y, w, h) => rects.push({ x, y, w, h, c: ctx.c }) };
  assert.ok(drawIcon(ctx, 'gear', 10, 20, 24));
  const pixels = ICONS.gear.join('').replace(/\./g, '').length;
  assert.equal(rects.reduce((n, r) => n + (r.w / 2) * (r.h / 2), 0), pixels, 'cada píxel, una vez');
  assert.ok(rects.every((r) => r.x >= 10 && r.y >= 20 && r.x + r.w <= 34 && r.y + r.h <= 44));
  assert.equal(drawIcon(ctx, 'nada', 0, 0), false);
  // what stays as it is: what people say and write
  for (const sel of ['.talk', '.log', '.ar-read', 'textarea', 'select']) assert.ok(KEEP.includes(sel), sel);
});

test('un selector (el de los pisos, el del agente del encargo) no muestra emoji del sistema: su ícono va al lado, en pixel art', () => {
  const opt = (text) => ({ textContent: text, dataset: {} });
  const options = [opt('🏛 Dirección'), opt('🏢 Oficina principal'), opt('📚 Archivo'), opt('tienda · Pi'), opt('🦖 Sin dibujo')];
  const sel = { options, selectedOptions: [options[2]] };
  const css = {};
  const classes = new Set();
  const slot = { hidden: true, style: { setProperty: (k, v) => { css[k] = v; } }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  selectIcons(sel, slot);
  assert.deepEqual(options.map((o) => o.textContent), ['Dirección', 'Oficina principal', 'Archivo', 'tienda · Pi', '🦖 Sin dibujo'], 'sólo el texto; uno sin dibujo queda como está');
  assert.deepEqual(options.map((o) => o.dataset.icon), ['pillars', 'building', 'books', undefined, undefined]);
  assert.equal(slot.hidden, false);
  assert.equal(css['--px'], `url("${iconURL('books')}")`, 'el ícono del piso elegido');
  // again (the selector is filled again, or its value changes): idempotent, and without an icon the slot hides
  sel.selectedOptions = [options[3]];
  selectIcons(sel, slot);
  assert.equal(options[0].textContent, 'Dirección');
  assert.equal(slot.hidden, true);
  // without a slot: only the options' text
  const other = { options: [opt('🧩 Pagos · api → web')], selectedOptions: [] };
  selectIcons(other);
  assert.equal(other.options[0].textContent, 'Pagos · api → web');
});
