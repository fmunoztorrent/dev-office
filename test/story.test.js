// The activity told as a story (public/story.js): the log of the game says what someone does the way
// a person tells it, one line per person and stretch of work, never a command or a tool's name.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStory, verbOf, sentence } from '../public/story.js';

const tool = (badge, more = {}) => ({ kind: 'tool_start', tool: 'Bash', session: 's1', role: 'backend', ok: true, badge, ts: 1000, ...more });

test('cada herramienta es un verbo, por su badge o por ser el navegador', () => {
  assert.equal(verbOf(tool('📖 cart.js')), 'read');
  assert.equal(verbOf(tool('🔍 grep')), 'search');
  assert.equal(verbOf(tool('🧪 tests')), 'tests');
  assert.equal(verbOf(tool('🔌 Claude_Brow…', { tool: 'mcp__Claude_Browser__navigate' })), 'browser');
  assert.equal(verbOf(tool(undefined, { tool: 'mcp__ccd_turn__wrap_up' })), 'tool');
  assert.equal(verbOf({ kind: 'phase', role: 'qa' }), null);
});

test('lo que hace una persona seguido va en una sola línea que crece, sin comandos', () => {
  const story = createStory();
  const a = story.tell(tool('📖 cart.js', { text: 'Leyendo cart.js' }));
  assert.equal(a.isNew, true);
  assert.equal(a.line.text, 'lee un archivo');
  assert.deepEqual(story.tell({ ...tool(), kind: 'tool_end' }), { skip: true }, 'el fin de una herramienta que salió bien no se cuenta dos veces');
  story.tell(tool('📖 cart.js', { ts: 2000 }));
  story.tell(tool('📖 total.js', { ts: 3000 }));
  const b = story.tell(tool('🔍 grep', { ts: 4000, text: 'Buscando en el código' }));
  assert.equal(b.isNew, false);
  assert.equal(b.line, a.line);
  assert.equal(b.line.text, 'lee 2 archivos y busca en el código');
  story.tell(tool('🧪 tests', { ts: 5000 }));
  story.tell(tool('💾 commit', { ts: 6000, text: 'Haciendo commit: «arregla el total»' }));
  assert.equal(a.line.text, 'lee 2 archivos, busca en el código, corre las pruebas y guarda los cambios: «arregla el total»');
  assert.ok(!/grep|Bash|commit -m/.test(a.line.text));
  assert.deepEqual(a.line.details, ['Leyendo cart.js', 'Buscando en el código', 'Haciendo commit: «arregla el total»'], 'el detalle queda aparte (en el tooltip)');
});

test('un problema en el camino se cuenta en la línea, con su detalle aparte', () => {
  const story = createStory();
  story.tell(tool('⌨️ shell', { tool: 'mcp__ccd_turn__wrap_up' }));
  const r = story.tell({ kind: 'tool_end', tool: 'mcp__ccd_turn__wrap_up', session: 's1', role: 'backend', ok: false, ts: 1500, text: 'Falló: Not shown: commit does not hold' });
  assert.equal(r.line.text, 'trabaja en la terminal y se topa con un problema');
  assert.equal(r.line.trips, 1);
  assert.match(r.line.details.at(-1), /^✖ Falló: Not shown/);
});

test('otra persona, otro rato u otras líneas en medio abren una línea nueva', () => {
  const story = createStory({ recentMs: 60_000, reach: 2 });
  const diego = story.tell(tool('📖 a.js')).line;
  const lucia = story.tell(tool('🌐 navegador', { role: 'frontend', tool: 'mcp__Claude_Browser__navigate' })).line;
  assert.notEqual(diego, lucia);
  assert.equal(lucia.text, 'revisa la página en el navegador');
  assert.equal(story.tell(tool('📖 b.js', { ts: 2000 })).line, diego, 'Diego sigue en su línea aunque Lucía hable entre medio');
  assert.equal(story.tell(tool('📖 c.js', { ts: 100_000 })).isNew, true, 'mucho después: otra línea');
  story.mark(); story.mark(); story.mark();
  assert.equal(story.tell(tool('📖 d.js', { ts: 101_000 })).isNew, true, 'muy arriba en la bitácora: otra línea');
  const sub = story.tell(tool('📖 e.js', { subId: 'x1', ts: 101_500 }));
  assert.equal(sub.isNew, true, 'un subagente tiene su propia línea');
  assert.equal(story.recent({ role: 'backend' }, 2).length, 2);
  assert.equal(story.recent({ subId: 'x1' })[0], sub.line);
  assert.deepEqual(story.recent({ role: 'backend' }).map((l) => l.subId), [null, null, null], 'lo del subagente no es del personaje de su rol');
});

test('muchas cosas distintas se resumen', () => {
  const verbs = new Map(['read', 'search', 'tests', 'build', 'push'].map((v) => [v, { n: 1, things: new Set(), msg: '', name: '' }]));
  assert.equal(sentence(verbs), 'lee un archivo, busca en el código, corre las pruebas y 2 cosas más');
});
