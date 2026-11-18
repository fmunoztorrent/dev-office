// The office's judgment: a model you choose (⚙ › Intelligence) that reads an order next to
// the company's map and says what it touches and how, and what it needs that is not on the map. The
// office is still the frontend: the model only reads and answers (JSON); it changes nothing. Without
// one (provider 'off'), the impact is read from the order's words alone (server/components.js).
//
//   agent      one of your agents' CLIs, read-only, the way the analyst reviews a brief (askCommand):
//              Claude Code, Codex, OpenCode or Pi, with its own login; optionally another model of it
//   anthropic  the Claude API (Messages), with its key in $DEV_TEAM_OFFICE_MODEL_KEY or $ANTHROPIC_API_KEY
//   openai     any OpenAI-compatible API (OpenAI, OpenRouter, LM Studio, vLLM…): its URL and model, and
//              its key in $DEV_TEAM_OFFICE_MODEL_KEY or $OPENAI_API_KEY
//   ollama     a local Ollama, with its model
//
// Keys never go to the database: they are read from the environment the office runs in.

import os from 'node:os';
import { spawn as spawnChild } from 'node:child_process';
import { askCommand as askCmd } from '../integrations/common/devteam.mjs';
import { childEnv } from './tasks.js';
import { getLanguage, LANGUAGES } from '../public/i18n.js';
import { RESOURCE_KINDS } from '../public/impact.js';

export const INTEL_DEFAULTS = {
  anthropic: { url: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
  openai: { url: 'https://api.openai.com/v1', model: '' },
  ollama: { url: 'http://127.0.0.1:11434', model: 'llama3.1' },
};
// the narrator's (a short sentence, often): the fast ones
export const NARRATOR_DEFAULTS = {
  anthropic: { url: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5' },
  openai: { url: 'https://api.openai.com/v1', model: '' },
  ollama: { url: 'http://127.0.0.1:11434', model: 'llama3.1' },
};
const ANTHROPIC_VERSION = '2026-10-21';
// models that take the server-side fallback on a refusal (another model answers instead of none)
const FALLBACKS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const MAP_MAX = 24_000;

const str = { type: 'string' };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
/** What the model answers about an order's impact (a JSON schema: the API enforces it where it can). */
export const IMPACT_SCHEMA = obj({
  summary: str,
  projects: { type: 'array', items: obj({ id: str, how: str, level: { type: 'string', enum: ['high', 'medium', 'low'] }, components: { type: 'array', items: str } }) },
  resources: { type: 'array', items: obj({ name: str, kind: { type: 'string', enum: RESOURCE_KINDS }, known: { type: 'boolean' }, action: { type: 'string', enum: ['use', 'change', 'create'] }, projects: { type: 'array', items: str }, how: str }) },
  unknown: { type: 'array', items: obj({ name: str, kind: { type: 'string', enum: ['component', ...RESOURCE_KINDS] }, question: str }) },
  links: { type: 'array', items: obj({ from: str, to: str, label: str }) },
});
const PING_SCHEMA = obj({ ok: { type: 'boolean' } });

/** The JSON object in a model's answer (fenced or not, with prose around it): the last one that parses. */
export function extractJson(text) {
  const s = String(text ?? '').replace(ANSI, '');
  const fenced = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const f of fenced.reverse()) { try { const v = JSON.parse(f); if (v && typeof v === 'object') return v; } catch { /* not this one */ } }
  let best = null;
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { const v = JSON.parse(s.slice(i, j + 1)); if (v && typeof v === 'object') { best = v; i = j; } } catch { /* keep looking */ }
        break;
      }
    }
  }
  return best;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** The analysis, checked and trimmed (a model may answer more, less or something else). */
export function normalizeInsight(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    summary: text(raw.summary, 600),
    projects: arr(raw.projects).slice(0, 40).map((p) => ({ id: text(p?.id, 120), how: text(p?.how, 400), level: ['high', 'medium', 'low'].includes(p?.level) ? p.level : 'medium', components: arr(p?.components).slice(0, 20).map((c) => text(c, 60)).filter(Boolean) })).filter((p) => p.id),
    resources: arr(raw.resources).slice(0, 40).map((r) => ({ name: text(r?.name, 80), kind: RESOURCE_KINDS.includes(r?.kind) ? r.kind : 'other', known: !!r?.known, action: ['use', 'change', 'create'].includes(r?.action) ? r.action : 'use', projects: arr(r?.projects).slice(0, 20).map((x) => text(x, 120)).filter(Boolean), how: text(r?.how, 300) })).filter((r) => r.name),
    unknown: arr(raw.unknown).slice(0, 20).map((u) => ({ name: text(u?.name, 60), kind: ['component', ...RESOURCE_KINDS].includes(u?.kind) ? u.kind : 'component', question: text(u?.question, 240) })).filter((u) => u.name),
    links: arr(raw.links).slice(0, 60).map((l) => ({ from: text(l?.from, 80), to: text(l?.to, 80), label: text(l?.label, 40) })).filter((l) => l.from && l.to),
  };
}

/**
 * The company's map in words, for the model: departments → projects (id, kind, components, stack),
 * the infrastructure on the map, the systems, and what the first pass (the words) found.
 */
export function mapForModel({ company = [], known = [], first = null } = {}) {
  const out = ['DEPARTMENTS AND PROJECTS (git repositories)'];
  for (const o of company) {
    out.push(`- department "${o.name}" (id ${o.id})`);
    for (const p of o.projects) {
      out.push(`  - project id=${p.id} name=${p.name} kind=${p.kind || 'other'} folder=${String(p.path || '').split('/').filter(Boolean).pop() || ''}`);
      if (p.components?.length) out.push(`      components: ${p.components.map((c) => `${c.name}${c.path ? ` (${c.path})` : ''}`).join(', ')}`);
      const stack = (p.infra || []).map((x) => (x.name ? `${x.kind} "${x.name}" (${x.tech})` : `${x.tech} (${x.kind})`));
      if (stack.length) out.push(`      stack: ${stack.join(', ')}`);
    }
    for (const s of o.systems || []) out.push(`  - system "${s.name}": ${s.parts.map((x) => `${x.name} [${x.kind}]${x.uses?.length ? ` uses ${x.uses.join('+')}` : ''}`).join('; ')}`);
  }
  const named = known.filter((r) => !r.techOnly);
  if (named.length) {
    out.push('', 'INFRASTRUCTURE ON THE MAP');
    for (const r of named) out.push(`- ${r.kind} "${r.name}"${r.tech ? ` · ${r.tech}` : ''}${r.location ? ` · ${r.location}` : ''}${r.state === 'planned' ? ' · planned' : ''}${r.projects.length ? ` · ${r.projects.map((x) => `${x.name} ${x.how}`).join(', ')}` : ''}`);
  }
  if (first) {
    out.push('', 'FIRST PASS (by the words of the order)');
    const hit = first.departments.flatMap((o) => o.projects.filter((p) => p.impacted).map((p) => `${p.id} (${p.why}${p.via ? `: ${p.via}` : ''})`));
    out.push(`- touches: ${hit.length ? hit.join(', ') : 'nothing found'}`);
    if (first.unknown?.length) out.push(`- not on the map: ${first.unknown.map((u) => `"${u.phrase}" (${u.kind})`).join(', ')}`);
  }
  const s = out.join('\n');
  return s.length > MAP_MAX ? `${s.slice(0, MAP_MAX)}\n…` : s;
}

/** What the model is asked about an order: { system, user }. */
export function impactPrompt({ order, mapText, lang = getLanguage(), schemaInText = false }) {
  const language = LANGUAGES[lang] || 'English';
  const system = [
    'You size the impact of a work order on a company\'s code, before anyone works on it. You get the order and the company\'s map: its departments, their projects (git repositories, each with an id), the components of each, the stack detected in each, the infrastructure on the map (queues, topics, databases, caches, storage, services, third-party APIs, schedulers, external repositories) and its systems (products made of several repositories, with what each one uses). A first pass by the order\'s words is included: correct and complete it.',
    'Answer with one JSON object:',
    '- summary: what the order means for the company, in at most two sentences.',
    '- projects: every project the order needs changed, by its id from the map (never another): how (one or two concrete sentences: endpoints, events, tables, screens, jobs), level (high | medium | low) and the names of its components it touches.',
    '- resources: the infrastructure the order needs: its name, kind, known (true only if it is on the map, as infrastructure or in a project\'s stack), action (use | change | create), the ids of the projects that use it, and how.',
    '- unknown: what the order needs that is not on the map and only the user can clarify: a component or repository (kind component or repo) or infrastructure (its kind), with a short question for the user (does it exist, and where? must it be created, and by whom?). Never guess a location.',
    '- links: dependencies between what you listed (from and to: a project id or a resource name; label: a verb such as publishes, consumes, calls, reads, writes, schedules).',
    `Write summary, how and question in ${language}. Be brief; do not invent projects, repositories or infrastructure the order does not need.`,
    ...(schemaInText ? [`Reply with the JSON object only (no prose, no code fences), following this JSON schema: ${JSON.stringify(IMPACT_SCHEMA)}`] : []),
  ].join('\n');
  const user = `THE ORDER\n${String(order).slice(0, 4000)}\n\nTHE COMPANY'S MAP\n${mapText}`;
  return { system, user };
}

export class Intelligence {
  /**
   * @param getPrefs  () => the settings (prefs.intelligence)
   * @param fetch     for the tests (the HTTP providers)
   * @param spawn     for the tests (the agent provider)
   */
  constructor({ getPrefs, fetch: fetchFn = globalThis.fetch, env = process.env, spawn = spawnChild, askCommand = askCmd, prefKey = 'intelligence' } = {}) {
    Object.assign(this, { getPrefs, fetchFn, env, spawn, askCommand, prefKey });
  }

  /** The current setting, with the provider's defaults: { provider, harness, model, url, timeout }. */
  get config() {
    const c = { provider: 'off', harness: 'claude-code', model: '', url: '', timeout: 120, ...(this.getPrefs?.()?.[this.prefKey] || {}) };
    // the narrator's default models are the fast ones
    const d = (this.prefKey === 'narrator' ? NARRATOR_DEFAULTS : INTEL_DEFAULTS)[c.provider];
    return { ...c, model: c.model || d?.model || '', url: String(c.url || d?.url || '').replace(/\/+$/, '') };
  }
  get enabled() { return this.config.provider !== 'off'; }
  /** "anthropic · claude-opus-5-5", "claude-code", "off". */
  get label() {
    const c = this.config;
    if (c.provider === 'off') return 'off';
    if (c.provider === 'agent') return c.model ? `${c.harness} · ${c.model}` : c.harness;
    return `${c.provider} · ${c.model || '?'}`;
  }

  #key(provider) {
    if (provider === 'anthropic') return this.env.DEV_TEAM_OFFICE_MODEL_KEY || this.env.ANTHROPIC_API_KEY || '';
    if (provider === 'openai') return this.env.DEV_TEAM_OFFICE_MODEL_KEY || this.env.OPENAI_API_KEY || '';
    return '';
  }

  /** What is missing for it to work (a key, a model, the agent's CLI), or null. */
  problem() {
    const c = this.config;
    if (c.provider === 'off') return null;
    if (c.provider === 'agent') { const cmd = this.askCommand(c.harness, { question: 'ping' }); return cmd.error ? cmd.error : null; }
    if (!c.model) return 'model';
    if (c.provider === 'anthropic' && !this.#key('anthropic') && !this.env.ANTHROPIC_AUTH_TOKEN) return 'key';
    return null;
  }

  /**
   * One question, one JSON answer: { ok, json, ms, model } or { ok: false, error, ms }. `schema`: what
   * the answer must look like (enforced by the APIs that can; in the prompt for the CLIs).
   */
  async ask({ system, user, schema = null } = {}) {
    const c = this.config;
    const t0 = Date.now();
    const done = (out) => ({ ...out, ms: Date.now() - t0, model: this.label });
    if (c.provider === 'off') return done({ ok: false, error: 'off' });
    try {
      const raw = c.provider === 'agent' ? await this.#agent(c, `${system}\n\n${user}`)
        : c.provider === 'anthropic' ? await this.#anthropic(c, system, user, schema)
          : c.provider === 'openai' ? await this.#openai(c, system, user)
            : await this.#ollama(c, system, user, schema);
      const json = extractJson(raw);
      return json ? done({ ok: true, json }) : done({ ok: false, error: 'not JSON' });
    } catch (err) { return done({ ok: false, error: String(err?.message || err).slice(0, 300) }); }
  }

  /** The impact of an order: { ok, insight, ms, model } (insight: normalizeInsight) or { ok: false, error }. */
  async analyzeImpact({ order, company, known, first } = {}) {
    // the CLIs and the OpenAI-compatible APIs get the shape in words (the others enforce the schema)
    const schemaInText = ['agent', 'openai'].includes(this.config.provider);
    const { system, user } = impactPrompt({ order, mapText: mapForModel({ company, known, first }), schemaInText });
    const out = await this.ask({ system, user, schema: IMPACT_SCHEMA });
    if (!out.ok) return out;
    const insight = normalizeInsight(out.json);
    return insight ? { ...out, insight } : { ...out, ok: false, error: 'not an analysis' };
  }

  /** A tiny question, to see that the setting works: { ok, ms, model } or { ok: false, error }. */
  async test() {
    const out = await this.ask({ system: 'Reply with the JSON object {"ok": true} and nothing else.', user: 'ping', schema: PING_SCHEMA });
    return out.ok && out.json?.ok === true ? { ok: true, ms: out.ms, model: out.model } : { ok: false, error: out.error || 'unexpected answer', ms: out.ms, model: out.model };
  }

  #signal(c) { return AbortSignal.timeout?.(c.timeout * 1000); }

  async #anthropic(c, system, user, schema) {
    const key = this.#key('anthropic');
    const token = !key && this.env.ANTHROPIC_AUTH_TOKEN;
    const fallback = FALLBACKS.has(c.model);
    const betas = [...(token ? ['oauth-2025-04-20'] : []), ...(fallback ? ['server-side-fallback-2026-07-01'] : [])];
    const headers = { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, ...(key ? { 'x-api-key': key } : token ? { authorization: `Bearer ${token}` } : {}), ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}) };
    const send = async (withSchema) => {
      const body = { model: c.model, max_tokens: 16000, system, messages: [{ role: 'user', content: user }], ...(withSchema && schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}), ...(fallback ? { fallbacks: 'default' } : {}) };
      return this.fetchFn(`${c.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal: this.#signal(c) });
    };
    let r = await send(true);
    // a model without structured outputs: ask again, with the shape in words
    if (r.status === 400 && schema) {
      const err = await r.json().catch(() => ({}));
      if (!/output_config|format|schema/i.test(JSON.stringify(err))) throw new Error(`Anthropic 400: ${err?.error?.message || ''}`.trim());
      r = await send(false);
    }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${out?.error?.message || ''}`.trim());
    if (out.stop_reason === 'refusal') throw new Error(`refused${out.stop_details?.category ? ` (${out.stop_details.category})` : ''}`);
    return (out.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async #openai(c, system, user) {
    const key = this.#key('openai');
    const send = (json) => this.fetchFn(`${c.url}/chat/completions`, {
      method: 'POST', signal: this.#signal(c),
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
    let r = await send(true);
    if (r.status === 400) r = await send(false); // an API without JSON mode
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${c.url} ${r.status}: ${out?.error?.message || ''}`.trim());
    return out.choices?.[0]?.message?.content || '';
  }

  async #ollama(c, system, user, schema) {
    const r = await this.fetchFn(`${c.url}/api/chat`, {
      method: 'POST', signal: this.#signal(c), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.model, stream: false, format: schema || 'json', messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${out?.error || ''}`.trim());
    return out.message?.content || '';
  }

  /** One of your agents' CLIs, read-only, in a neutral folder (its hooks stay quiet: it is not work). */
  #agent(c, question) {
    const cmd = this.askCommand(c.harness, { question, model: c.model || undefined });
    if (cmd.error) return Promise.reject(new Error(cmd.error));
    return new Promise((resolve, reject) => {
      let out = '', child;
      const timer = setTimeout(() => { try { child?.kill('SIGTERM'); } catch { /* gone */ } reject(new Error('timeout')); }, c.timeout * 1000);
      timer.unref?.();
      try {
        child = this.spawn(cmd.exe, cmd.argv, { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'ignore'], env: childEnv({ DEV_TEAM_OFFICE_BTW: '1', DEV_TEAM_OFFICE_LAUNCHED: '1' }) });
        child.stdout?.on('data', (d) => { if (out.length < 200_000) out += d; });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${c.harness} exited with ${code}`)); });
      } catch (err) { clearTimeout(timer); reject(err); }
    });
  }
}
