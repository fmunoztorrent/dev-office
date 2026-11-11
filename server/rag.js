// The archive as the company's RAG: what you load there (notes, decisions, documents, the glossary)
// reaches the agents when they need it, with its source to cite.
//
//   - Lexical search, always: SQLite's FTS5 over each entry's chunks (server/chunks.js), without
//     accents and by prefix, so exact business terms (SKUs, codes, acronyms) are found. Offline.
//   - Semantic search, optional (⚙ › General › Archive): each chunk's embedding, from local Ollama or
//     an OpenAI-compatible API (OpenAI, Voyage…; its key in $DEV_TEAM_OFFICE_EMBED_KEY), compared
//     by cosine in memory. Both rankings are fused (reciprocal rank fusion).
//   - The glossary (entries of kind `term`: the term, its definition, its synonyms as tags) widens
//     the search, and a term mentioned in a brief goes with it, defined.
//   - Scope: the company's, a department's, a project's (its folder): its own first. Expired entries
//     (validUntil) are left out.
//   - Gaps: a search that finds nothing is recorded, so you see what the agents needed and fill it.
//   - The agent writes the answer: the archive hands it chunks with an id to cite ([k12§3]),
//     on demand (MCP search_knowledge) and on top of every brief and question ("📚 From the archive").
//
// The readable text stays as you wrote it (the entry's body); the chunks and their embeddings are
// the index built from it.

import { t } from '../public/i18n.js';
import { insideDir } from './paths.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const STOP = new Set(('a al como con cual cuales de del el en es esta este la las lo los o para por que se si sin su sus un una y ' +
  'an and are as at be by do does for from how in is it of on or the this to what when where which who why with').split(' '));
const RRF_K = 60;
const SNIPPET = 280;
const BLOCK_MAX = 1400;

/** A search as an FTS5 query: each significant word (and the extra ones) as a prefix, any of them. */
export function ftsQuery(q, extra = []) {
  const words = [...new Set([...tokens(q), ...extra.flatMap(tokens)])].filter((w) => w.length > 1 && !STOP.has(w)).slice(0, 24);
  return words.map((w) => `"${w}"*`).join(' OR ');
}

/** The glossary terms mentioned in a text (by the term or one of its synonyms): their entries. */
export function termsIn(store, text, { office = null } = {}) {
  const hay = ` ${tokens(text).join(' ')} `;
  if (hay.trim() === '') return [];
  return store.listKnowledge({ kind: 'term', limit: 500, office }).filter((e) => [e.title, ...(e.tags || [])].some((n) => {
    const words = tokens(n);
    const k = words.join(' ');
    // a single short or empty word ("de", "a") is no term
    return k && !(words.length === 1 && (words[0].length < 2 || STOP.has(words[0]))) && hay.includes(` ${k} `);
  }));
}

const scopeOf = (e) => (e.project ? 'project' : e.office ? 'department' : 'company');
const BOOST = { project: 1.5, department: 1.25, company: 1 }; // bm25: lower is better, so scoped ones go first
// "Title › Heading", without repeating the title when the heading already starts with it
const labelOf = (title, heading) => (!heading ? title : fold(heading).startsWith(fold(title)) ? heading : `${title} › ${heading}`);
const result = (h, score) => ({
  id: `${h.entry.id}§${h.chunk.ord + 1}`, entryId: h.entry.id, kind: h.entry.kind, title: h.entry.title, heading: h.chunk.heading, label: labelOf(h.entry.title, h.chunk.heading),
  text: h.chunk.text, scope: scopeOf(h.entry), origin: h.entry.origin || null, updatedAt: h.entry.updatedAt, score,
});

/** The department a project works for (its registered folder's office), when the search does not say. */
const departmentOf = (store, project) => (project ? store.listAgents().filter((a) => insideDir(project, a.path)).sort((a, b) => b.path.length - a.path.length)[0]?.office || null : null);

/** Lexical search (synchronous): the chunks that match, the project's and department's first. The
 * glossary terms it mentions come apart (defined), not as passages. */
export function searchLexical(store, q, { office = null, project = null, k = 5, kinds = null } = {}) {
  office ||= departmentOf(store, project);
  const terms = termsIn(store, q, { office });
  const known = new Set(terms.map((e) => e.id));
  const match = ftsQuery(q, terms.flatMap((e) => [e.title, ...(e.tags || [])]));
  const hits = store.searchChunks(match, { office, project, kinds, limit: k * 3 }).filter((h) => !known.has(h.entry.id));
  return hits.map((h) => ({ h, s: h.rank * BOOST[scopeOf(h.entry)] })).sort((a, b) => a.s - b.s).slice(0, k).map(({ h, s }) => result(h, -s));
}

/** How much of a question a result covers: the share of its significant words (as prefixes) it contains. */
export function coverage(q, r) {
  const want = [...new Set(tokens(q).filter((w) => w.length > 1 && !STOP.has(w)))];
  if (!want.length) return 1;
  const have = tokens(`${r.title} ${r.heading} ${r.text}`);
  return want.filter((w) => have.some((h) => h.startsWith(w.slice(0, Math.max(4, w.length - 2))))).length / want.length;
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * The search the agents use: lexical and, if there is an embedding provider, semantic, fused. If
 * nothing is found (and `gap`), the question is recorded as a gap. { results, terms, semantic }.
 */
export async function search(store, q, { office = null, project = null, k = 5, embedder = null, source = null, gap = true } = {}) {
  const query = String(q || '').trim();
  if (!query) return { results: [], terms: [], semantic: false };
  office ||= departmentOf(store, project);
  const terms = termsIn(store, query, { office });
  const known = new Set(terms.map((e) => e.id));
  const lexical = searchLexical(store, query, { office, project, k: k * 3 });
  let semantic = [];
  let used = false;
  if (embedder?.enabled) {
    try {
      const [qv] = await embedder.embed([query]);
      const scored = store.vectorsInScope(embedder.model, { office, project }).filter((h) => !known.has(h.entry.id)).map((h) => ({ h, s: cosine(qv, h.vector) * BOOST[scopeOf(h.entry)] }));
      semantic = scored.sort((a, b) => b.s - a.s).slice(0, k * 3).filter((x) => x.s > 0.2).map(({ h, s }) => result(h, s));
      used = true;
    } catch { /* the provider is down: lexical only */ }
  }
  // reciprocal rank fusion: what both rankings put high goes first
  const fused = new Map();
  [lexical, semantic].forEach((list) => list.forEach((r, i) => {
    const cur = fused.get(r.id) || { ...r, score: 0 };
    cur.score += 1 / (RRF_K + i + 1);
    fused.set(r.id, cur);
  }));
  const results = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  for (const id of new Set(results.map((r) => r.entryId))) store.touchKnowledge(id);
  // a gap: nothing, or nothing that covers most of what was asked (sharing one word is not an answer)
  if (gap && !terms.length && (!results.length || Math.max(...results.map((r) => coverage(query, r))) < 0.6) && !(semantic.length && used)) store.recordGap({ query, office, project, source });
  return { results, terms: terms.map((e) => ({ id: e.id, term: e.title, definition: e.body, synonyms: e.tags })), semantic: used };
}

const clipText = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/**
 * What goes on top of a brief or a question: the glossary terms it mentions and the most relevant
 * chunks (lexical, so it is immediate), each with its id to cite. '' if there is nothing.
 */
export function contextBlock(store, text, { office = null, project = null, k = 3 } = {}) {
  if (store?.getPrefs?.().archive?.push === false) return '';
  office ||= departmentOf(store, project);
  const terms = termsIn(store, text, { office }).slice(0, 4);
  const hits = searchLexical(store, text, { office, project, k });
  if (!terms.length && !hits.length) return '';
  const lines = [`📚 ${t('rag.block')}`];
  let room = BLOCK_MAX;
  for (const e of terms) { const l = `│ 📖 ${e.title}: ${clipText(e.body, 200)}`; if (l.length > room) break; lines.push(l); room -= l.length; }
  for (const r of hits) {
    const l = `│ [${r.id}] ${r.label}: ${clipText(r.text, SNIPPET)}`;
    if (l.length > room) break;
    lines.push(l);
    room -= l.length;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

// ---------------------------------------------------------------- embeddings (optional)

const PROVIDERS = {
  ollama: { url: 'http://127.0.0.1:11434', model: 'nomic-embed-text' },
  openai: { url: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
};
export const EMBEDDING_PROVIDERS = ['off', ...Object.keys(PROVIDERS)];

/**
 * The embedding provider of ⚙ › General › Archive: { enabled, model, embed(texts) → [Float32Array] }.
 * `model` names the provider too ("ollama:nomic-embed-text"): changing it re-embeds everything.
 */
export function createEmbedder(getPrefs, { fetch: fetchFn = globalThis.fetch, env = process.env } = {}) {
  const cfg = () => {
    const a = getPrefs?.()?.archive || {};
    const p = PROVIDERS[a.embeddings];
    return p ? { provider: a.embeddings, url: String(a.url || p.url).replace(/\/+$/, ''), name: a.model || p.model } : null;
  };
  return {
    get enabled() { return !!cfg(); },
    get model() { const c = cfg(); return c ? `${c.provider}:${c.name}` : null; },
    async embed(texts) {
      const c = cfg();
      if (!c) throw new Error('embeddings off');
      const ctl = AbortSignal.timeout?.(30_000);
      if (c.provider === 'ollama') {
        const r = await fetchFn(`${c.url}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: c.name, input: texts }), signal: ctl });
        if (!r.ok) throw new Error(`Ollama ${r.status}`);
        return ((await r.json()).embeddings || []).map((v) => Float32Array.from(v));
      }
      const key = env.DEV_TEAM_OFFICE_EMBED_KEY || env.OPENAI_API_KEY || '';
      const r = await fetchFn(`${c.url}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: c.name, input: texts }), signal: ctl });
      if (!r.ok) throw new Error(`embeddings ${r.status}`);
      return ((await r.json()).data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => Float32Array.from(d.embedding));
    },
  };
}

/**
 * Embeds in the background the chunks that are not yet (after a save, and every few minutes).
 * { kick(), status }: status { model, running, lastError }.
 */
export function createIndexer(store, embedder, { every = 5 * 60_000 } = {}) {
  const status = { running: false, lastError: null };
  let again = false;
  async function run() {
    if (!embedder.enabled) return;
    if (status.running) { again = true; return; }
    status.running = true;
    try {
      for (let guard = 0; guard < 500; guard++) {
        const model = embedder.model;
        const batch = store.pendingChunks(model, 32);
        if (!batch.length) break;
        const vectors = await embedder.embed(batch.map((c) => `${c.title}${c.heading ? ` — ${c.heading}` : ''}\n${c.text}`));
        batch.forEach((c, i) => { if (vectors[i]) store.setEmbedding(c.id, vectors[i], model); });
      }
      status.lastError = null;
    } catch (err) { status.lastError = err.message; } finally { status.running = false; }
    if (again) { again = false; run(); }
  }
  const timer = setInterval(run, every);
  timer.unref?.();
  return { kick: () => { run(); }, status, stop: () => clearInterval(timer), run };
}
