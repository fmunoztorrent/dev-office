// The archive as the company's RAG: what you load (text, documents, the glossary) is cut into chunks,
// indexed (words always; meaning with an embedding provider) and reaches the agents with an id to
// cite: on demand and on top of every brief. What they search and do not find is recorded.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkText } from '../server/chunks.js';
import { openStore } from '../server/store.js';
import { ftsQuery, searchLexical, search, contextBlock, termsIn, createEmbedder, createIndexer } from '../server/rag.js';
import { htmlToText, fromFile } from '../server/ingest.js';
import { unguided } from '../server/guides.js';
import { startServer } from '../server/server.js';
import { which } from '../integrations/common/devteam.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-rag-')));

test('un documento se corta por sus títulos (con su ruta) y una sección larga, por párrafos con algo de solape', () => {
  const md = '# Devoluciones\n\nIntro.\n\n## Plazos\n\nTienes 30 días.\n\n```\n# esto no es un título\n```\n\n## Excepciones\n\nLos productos en oferta no se devuelven.';
  const c = chunkText(md, 'Política');
  assert.deepEqual(c.map((x) => x.heading), ['Devoluciones', 'Devoluciones › Plazos', 'Devoluciones › Excepciones']);
  assert.match(c[1].text, /# esto no es un título/, 'lo que está en un bloque de código no corta');
  const long = Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1}: ${'texto de negocio '.repeat(12)}`).join('\n\n');
  const parts = chunkText(`# Largo\n\n${long}`);
  assert.ok(parts.length >= 3, `se corta (${parts.length})`);
  for (const p of parts) assert.ok(p.text.length <= 1600, 'ninguno es enorme');
  assert.ok(parts[1].text.startsWith('texto de negocio') || /Párrafo/.test(parts[1].text.slice(0, 200)), 'el siguiente repite un poco del anterior');
  assert.deepEqual(chunkText('', 'Sólo un título'), [{ heading: '', text: 'Sólo un título' }]);
});

test('la búsqueda por palabras no ve acentos, busca por prefijo y respeta el alcance y la vigencia', () => {
  const store = openStore(':memory:');
  try {
    const dir = tmp();
    store.createOffice({ name: 'Pagos' });
    const politica = store.createKnowledge({ kind: 'doc', title: 'Política de devoluciones', body: '# Plazos\n\nEl cliente tiene 30 días para devolver un producto.\n\n# Reembolsos\n\nSe reembolsa al mismo medio de pago en 5 días hábiles.' }).entry;
    store.createKnowledge({ kind: 'note', title: 'Conciliación', body: 'Las devoluciones se concilian cada lunes.', office: 'pagos' });
    store.createKnowledge({ kind: 'note', title: 'Sólo en la tienda', body: 'La tienda acepta devoluciones en el local.', project: dir });
    store.createKnowledge({ kind: 'note', title: 'Vieja regla', body: 'Antes las devoluciones eran de 10 días.', validUntil: Date.now() - 1000 });

    assert.equal(ftsQuery('¿Cuántos días tiene para la devolución?'), '"cuantos"* OR "dias"* OR "tiene"* OR "devolucion"*');
    let r = searchLexical(store, 'devolucion', {});
    assert.deepEqual([...new Set(r.map((x) => x.title))], ['Política de devoluciones'], 'sin acentos ni plural; ni otro departamento, ni otro proyecto, ni lo vencido');
    assert.match(r[0].id, new RegExp(`^${politica.id}§1$`), 'un id para citarlo: la entrada y su fragmento');
    assert.equal(r[0].heading, 'Plazos');
    r = searchLexical(store, 'devoluciones', { office: 'pagos', project: path.join(dir, 'src') });
    assert.deepEqual([...new Set(r.map((x) => x.title))].sort(), ['Conciliación', 'Política de devoluciones', 'Sólo en la tienda'].sort());
    assert.ok(r.some((x) => x.scope === 'project') && r.some((x) => x.scope === 'department'), 'lo de su proyecto y su departamento también (con un empujón en el orden)');
    assert.equal(searchLexical(store, 'reembolso medio', {})[0].heading, 'Reembolsos');

    // editing the text indexes it again; deleting it removes its chunks
    store.updateKnowledge(politica.id, { body: 'Ahora son 60 días.' });
    assert.equal(store.chunksOf(politica.id).length, 1);
    store.deleteKnowledge(politica.id);
    assert.equal(searchLexical(store, '60 dias', {}).length, 0);
  } finally { store.close(); }
});

test('el glosario amplía la búsqueda y viaja definido; lo que no se encuentra queda como vacío', async () => {
  const store = openStore(':memory:');
  try {
    store.createKnowledge({ kind: 'term', title: 'NPS', body: 'Net Promoter Score: % de promotores menos % de detractores.', tags: ['satisfaccion', 'recomendacion'] });
    store.createKnowledge({ kind: 'doc', title: 'Encuesta trimestral', body: 'Medimos la satisfaccion de los clientes cada trimestre.' });
    assert.deepEqual(termsIn(store, 'Sube el NPS del checkout').map((e) => e.title), ['NPS']);
    let out = await search(store, '¿cómo va el NPS?', {});
    assert.equal(out.terms[0].term, 'NPS');
    assert.deepEqual(out.results.map((x) => x.title), ['Encuesta trimestral'], 'por su sinónimo');
    out = await search(store, 'política de viáticos en el extranjero', { source: 'MCP · pi' });
    assert.deepEqual(out.results, []);
    await search(store, 'Politica de viaticos en el extranjero', { source: 'MCP · claude-code' });
    const gaps = store.listGaps();
    assert.deepEqual([gaps.length, gaps[0].count, gaps[0].query], [1, 2, 'política de viáticos en el extranjero'], 'la misma pregunta suma');
    assert.equal(store.resolveGap(gaps[0].id).ok, true);
    // sharing one word is not an answer: it comes back (partial) and it is a gap too
    store.createKnowledge({ kind: 'doc', title: 'Política de devoluciones', body: 'Hasta 30 días.' });
    out = await search(store, 'política de viáticos', {});
    assert.equal(out.results[0].title, 'Política de devoluciones');
    assert.equal(store.listGaps()[0].query, 'política de viáticos');
    store.resolveGap(store.listGaps()[0].id);
    // a synonym of several words (with commas) is one synonym: "de" alone is not a term
    store.createKnowledge({ kind: 'term', title: 'SKU', body: 'Código único de un producto.', tags: 'código de producto, referencia' });
    assert.deepEqual(termsIn(store, 'el plazo de entrega').map((e) => e.title), []);
    assert.deepEqual(termsIn(store, 'busca por código de producto').map((e) => e.title), ['SKU']);
    assert.equal(store.listGaps().length, 0);

    const block = contextBlock(store, 'Mejorar el NPS con la encuesta trimestral', {});
    assert.match(block, /^📚 Del archivo \(cita su \[id\]; busca más con search_knowledge\):\n│ 📖 NPS: Net Promoter Score/);
    assert.match(block, /│ \[k\w+§1\] Encuesta trimestral: Medimos la satisfaccion/);
    assert.equal(unguided(`${block}\n\nMejorar el NPS`), 'Mejorar el NPS', 'la oficina lo saca del título de la pizarra');
    store.setPrefs({ archive: { push: false } });
    assert.equal(contextBlock(store, 'NPS', {}), '', 'apagado en ⚙ › General');
  } finally { store.close(); }
});

test('con un proveedor de embeddings: se guardan los vectores junto al texto legible y la búsqueda por significado se fusiona', async () => {
  const store = openStore(':memory:');
  try {
    // a fake provider: one dimension per topic (money, shipping), the OpenAI shape
    const topic = (s) => [/pago|cobro|reembolso|plata|dinero/i.test(s) ? 1 : 0, /env[ií]o|despacho|courier/i.test(s) ? 1 : 0, 0.01];
    const calls = [];
    const fetch = async (url, init) => {
      calls.push(url);
      const { input } = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: input.map((x, index) => ({ index, embedding: topic(x) })) }) };
    };
    store.setPrefs({ archive: { embeddings: 'openai', url: 'http://embed.test/v1', model: 'mini' } });
    const embedder = createEmbedder(() => store.getPrefs(), { fetch, env: { DEV_TEAM_OFFICE_EMBED_KEY: 'k' } });
    assert.equal(embedder.model, 'openai:mini');
    const despacho = store.createKnowledge({ kind: 'doc', title: 'Despachos', body: 'El courier pasa a las 17:00 y lleva los pedidos del día.' }).entry;
    store.createKnowledge({ kind: 'doc', title: 'Cobros', body: 'Los reembolsos se hacen al mismo medio de pago.' });
    const indexer = createIndexer(store, embedder, { every: 60_000 });
    await indexer.run();
    indexer.stop();
    assert.equal(calls[0], 'http://embed.test/v1/embeddings');
    assert.deepEqual(store.indexStatus('openai:mini'), { chunks: 2, embedded: 2, model: 'openai:mini' });
    assert.equal(store.getKnowledge(despacho.id).body, 'El courier pasa a las 17:00 y lleva los pedidos del día.', 'el texto legible queda tal cual');
    assert.equal(store.chunksOf(despacho.id)[0].embedded, true);
    // "envío" does not appear in any text: only the meaning finds it
    const out = await search(store, '¿a qué hora sale el envío?', { embedder });
    assert.equal(out.semantic, true);
    assert.equal(out.results[0].title, 'Despachos');
    // the provider down: words only, no error
    const down = createEmbedder(() => store.getPrefs(), { fetch: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await search(store, 'courier', { embedder: down })).results[0].title, 'Despachos');
  } finally { store.close(); }
});

test('cargar documentos: Markdown y texto tal cual, HTML a texto legible, y lo que no se puede leer lo dice', () => {
  const h = htmlToText('<html><head><title>Ayuda</title><style>x{}</style></head><body><h1>Envíos</h1><p>Despachamos en <b>24&nbsp;h</b>.</p><ul><li>Santiago</li><li>Regiones</li></ul><script>alert(1)</script></body></html>');
  assert.equal(h.title, 'Ayuda');
  assert.equal(h.text, '# Envíos\n\nDespachamos en 24 h.\n\n- Santiago\n- Regiones');
  assert.deepEqual(fromFile({ name: 'reglas-de-negocio.md', text: '# Reglas\n\nTodo en CLP.' }), { ok: true, title: 'Reglas', text: '# Reglas\n\nTodo en CLP.', origin: 'reglas-de-negocio.md' });
  assert.equal(fromFile({ name: 'notas-sueltas.txt', text: 'sin títulos' }).title, 'notas sueltas', 'sin título, el del archivo');
  assert.equal(fromFile({ name: 'foto.png', base64: 'AAAA' }).code, 'format');
  assert.equal(fromFile({ name: 'vacio.txt', text: '  ' }).code, 'empty');
  if (!which('pdftotext')) assert.match(fromFile({ name: 'contrato.pdf', base64: 'JVBERi0=' }).error, /pdftotext/);
});

test('en el servidor: cargar, buscar con citas, y el encargo que sale con lo que sabe el archivo', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    server.store.setPrefs({ autonomy: { clarify: false } });
    const call = (method, p, body) => fetch(`${server.url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
    const dir = tmp();
    let out = await call('POST', '/v1/knowledge/import', { name: 'cupones.md', text: '# Cupones\n\n## Acumulación\n\nLos cupones no se acumulan con otras promociones.', tags: 'checkout', project: dir });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([out.entry.kind, out.entry.title, out.entry.origin, out.entry.project], ['doc', 'Cupones', 'cupones.md', dir], 'su título es su primer título');
    out = await call('GET', `/v1/knowledge/${out.entry.id}`);
    assert.equal(out.chunks[0].heading, 'Cupones › Acumulación');
    out = await call('GET', `/v1/knowledge/search?q=${encodeURIComponent('¿se acumulan los cupones?')}&project=${encodeURIComponent(dir)}&from=agent`);
    assert.equal(out.results[0].heading, 'Cupones › Acumulación');
    out = await call('GET', `/v1/knowledge/search?q=${encodeURIComponent('cupones')}&from=agent`);
    assert.equal(out.results.length, 0, 'es de ese proyecto: otro no lo ve');
    assert.equal((await call('GET', '/v1/knowledge/gaps')).gaps[0].query, 'cupones');
    assert.equal((await call('POST', '/v1/knowledge/import', { name: 'x.exe', base64: 'AA==' })).ok, false);
    const idx = await call('GET', '/v1/archive/index');
    assert.deepEqual([idx.chunks, idx.embeddings], [1, false]);

    // a brief to that project carries what the archive knows about it
    const brief = server.hub.brief('Agregar cupones al checkout', dir);
    assert.match(brief, /📚 Del archivo .*\n│ \[k\w+§1\] Cupones › Acumulación: Los cupones no se acumulan/);
    assert.equal(unguided(brief), 'Agregar cupones al checkout');
  } finally { await server.close(); }
});
