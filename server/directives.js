// The executive floor: the company's directors give orders that cover several offices, departments
// or projects at once (a directive): "update the logging library everywhere", "every API exposes
// /health". The office is still the frontend: a directive is one brief per project, sent to each
// registered agent through its harness (an open session of it, or a new one), and the floor follows
// how each part goes. When the last one ends, its minutes go to the archive.
//
// Operations does not overload a department: it takes at most `prefs.capacity` open briefs at once
// (3 by default, counting what it already had); the rest of its parts wait their turn and go as
// soon as one of its briefs ends.

import { EventEmitter } from 'node:events';
import { clip } from './roles.js';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';

const TEXT_MAX = 4000;
const PARTS_MAX = 20;
const KEEP = 30;
const ENDED = new Set(['done', 'failed', 'cancelled']);

/** How a directive goes, from how its parts go. */
export function directiveStatus(parts) {
  if (!parts.length) return 'failed';
  if (parts.some((p) => !ENDED.has(p.status))) return 'running';
  if (parts.every((p) => p.status === 'done')) return 'done';
  if (parts.every((p) => p.status === 'cancelled')) return 'cancelled';
  return parts.some((p) => p.status === 'done') ? 'partial' : 'failed';
}

export class DirectiveDesk extends EventEmitter {
  /**
   * @param store     the database: the directives and the registered agents
   * @param registry  the agents (server/registry.js): each part goes through it
   * @param hub       the tasks (server/tasks.js) and `pipelines` (server/pipeline.js): how each part goes
   * @param archive   the archive (server/archive.js): the minutes of each directive that ends
   * @param company   the offices: their names
   */
  constructor({ store, registry, hub, pipelines, archive, company }) {
    super();
    this.store = store;
    this.registry = registry;
    this.hub = hub;
    this.pipelines = pipelines;
    this.archive = archive;
    this.company = company;
    this.items = new Map();
    // what was running when the office closed cannot be followed any more (the tasks lived in its memory)
    for (const d of store.listDirectives({ limit: KEEP }).reverse()) {
      if (d.status === 'running') {
        d.parts = d.parts.map((p) => (ENDED.has(p.status) ? p : { ...p, status: 'cancelled', detail: tr('exec.interrupted') }));
        d.status = 'interrupted';
        store.saveDirective(d);
      }
      this.items.set(d.id, d);
    }
    this.seq = 0;
    hub?.on('change', () => this.#follow());
    pipelines?.on('change', () => this.#follow());
  }

  /** The projects a directive goes to: the ones chosen plus every registered one in the offices chosen. */
  #targets({ offices = [], targets = [] }) {
    const agents = this.store.listAgents();
    const want = new Set();
    for (const ref of [].concat(offices || [])) {
      const o = ref === 'all' ? null : this.store.findOffice(ref);
      if (ref !== 'all' && !o) return { error: tr('err.unknownOffice', { office: ref }) };
      for (const a of agents) if (ref === 'all' || a.office === o.id) want.add(a.id);
    }
    for (const ref of [].concat(targets || [])) {
      const a = agents.find((x) => x.id === ref || x.path === ref);
      if (!a) return { error: tr('err.unknownProject', { project: ref }) };
      want.add(a.id);
    }
    return { agents: agents.filter((a) => want.has(a.id)) };
  }

  /**
   * A new directive. { text, title?, offices?: [id | name | 'all'], targets?: [agent id | path], from? }
   * Returns { ok, directive } (also when some part could not be sent: it shows why).
   */
  create({ text, title, offices, targets, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.taskEmpty') };
    if (text.length > TEXT_MAX) return { ok: false, error: tr('err.taskTooLong', { n: TEXT_MAX }) };
    const pick = this.#targets({ offices, targets });
    if (pick.error) return { ok: false, error: pick.error };
    if (!pick.agents.length) return { ok: false, error: tr('err.pickProjects') };
    if (pick.agents.length > PARTS_MAX) return { ok: false, error: tr('err.tooManyProjects', { n: PARTS_MAX }) };

    const d = {
      id: `d${Date.now().toString(36)}${++this.seq}`, title: clip(title || text.split('\n')[0], 120), text, status: 'running',
      source: clip(from || tr('events.you'), 60), parts: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    const names = pick.agents.map((a) => a.name);
    this.#sending = true;
    try {
      for (const a of pick.agents) {
        const others = names.filter((n) => n !== a.name);
        const part = { target: a.id, name: a.name, harness: a.harness, office: a.office || MAIN_OFFICE, kind: null, ref: null, status: 'running', detail: '', brief: tr('exec.brief', { title: d.title, others: others.length ? others.join(', ') : '—' }) + `\n\n${text}` };
        d.parts.push(part);
        // a department with its hands full: this part waits its turn
        const busy = this.#busy(part.office);
        if (busy >= this.#capacity()) Object.assign(part, { status: 'waiting', detail: tr('exec.waitTurn', { n: busy }) });
        else this.#send(d, part);
      }
    } finally { this.#sending = false; }
    d.status = directiveStatus(d.parts);
    this.items.set(d.id, d);
    while (this.items.size > KEEP) this.items.delete(this.items.keys().next().value);
    this.#save(d);
    this.emit('created', this.#public(d));
    if (d.status !== 'running') this.#ended(d);
    this.#changed();
    return { ok: true, directive: this.#public(d) };
  }

  #sending = false;
  #capacity() { return Math.max(1, Number(this.store.getPrefs?.().capacity) || 3); }

  /** The briefs a department has open now (its tasks and pipeline runs that did not end). */
  #busy(office) {
    const open = (x) => (x.office || MAIN_OFFICE) === office && !ENDED.has(x.status);
    return [...(this.hub?.tasks?.values() || [])].filter(open).length + [...(this.pipelines?.runs?.values() || [])].filter((r) => r.office && open(r)).length;
  }

  /** Sends a part to its project's agent. */
  #send(d, part) {
    let out;
    try { out = this.registry.run({ target: part.target, entry: 'prompt', text: part.brief, title: `🏛 ${d.title}`, from: tr('exec.from') }); } catch (err) { out = { ok: false, error: err.message }; }
    if (out.ok && out.task) Object.assign(part, { kind: 'task', ref: out.task.id, status: ENDED.has(out.task.status) ? out.task.status : 'running', detail: out.task.detail || '' });
    else if (out.ok && out.run) Object.assign(part, { kind: 'run', ref: out.run.id, status: 'running', detail: out.run.detail || '' });
    else Object.assign(part, { status: 'failed', detail: out.error || tr('task.failedDefault') });
  }

  /** Cancels what is still running of a directive. */
  cancel(id) {
    const d = this.items.get(String(id));
    if (!d) return { ok: false, status: 404, error: tr('err.unknownDirective') };
    if (d.status !== 'running') return { ok: false, error: tr('err.cantCancel', { status: tr(`directiveStatus.${d.status}`) }) };
    for (const p of d.parts) {
      if (ENDED.has(p.status)) continue;
      if (p.kind === 'task') this.hub?.cancel(p.ref);
      else if (p.kind === 'run') this.pipelines?.cancel(p.ref);
      // whatever could not be stopped (an open session already working on it) is left to its agent
      p.status = 'cancelled';
      p.detail = tr('task.cancelled');
    }
    this.#update(d);
    return { ok: true, directive: this.#public(d) };
  }

  get(id) { const d = this.items.get(String(id)); return d ? this.#public(d) : null; }
  list(limit = 12) { return [...this.items.values()].slice(-limit).reverse().map((d) => this.#public(d)); }

  // each part follows its task (or its pipeline run); the ones waiting their turn go when there is room
  #follow() {
    if (this.#sending) return;
    for (const d of this.items.values()) {
      if (d.status !== 'running') continue;
      let moved = false;
      for (const p of d.parts) {
        if (p.status === 'waiting') {
          if (this.#busy(p.office) >= this.#capacity()) continue;
          this.#sending = true;
          try { this.#send(d, p); } finally { this.#sending = false; }
          moved = true;
          continue;
        }
        if (ENDED.has(p.status) || !p.ref) continue;
        const x = p.kind === 'task' ? this.hub?.tasks?.get(p.ref) : this.pipelines?.runs?.get(p.ref);
        if (!x) continue;
        const status = ENDED.has(x.status) ? x.status : 'running';
        const detail = clip(x.detail || '', 200);
        if (status !== p.status || detail !== p.detail) { p.status = status; p.detail = detail; moved = true; }
      }
      if (moved) this.#update(d);
    }
  }

  #update(d) {
    const was = d.status;
    d.status = directiveStatus(d.parts);
    d.updatedAt = Date.now();
    this.#save(d);
    if (was === 'running' && d.status !== 'running') this.#ended(d);
    this.#changed();
  }

  // the minutes: what was asked, to whom, and how each part ended
  #ended(d) {
    const lines = d.parts.map((p) => `- ${p.name} (${this.company?.info?.(p.office)?.name || p.office}): ${tr(`taskStatus.${p.status}`)}${p.detail ? ` — ${p.detail}` : ''}`);
    try {
      this.archive?.save({
        kind: 'minute', title: tr('exec.minuteTitle', { title: d.title }), tags: ['directive'],
        body: `${tr('exec.minuteAsked', { who: d.source })}\n\n${d.text}\n\n${tr('exec.minuteParts')}\n${lines.join('\n')}`,
      }, { source: tr('exec.from') });
    } catch { /* the minutes cannot break the directive */ }
    this.emit('ended', this.#public(d));
  }

  #save(d) { try { this.store.saveDirective(d); } catch { /* the history cannot break the directive */ } }
  #changed() { this.emit('change', this.list()); }

  #public(d) {
    const done = d.parts.filter((p) => p.status === 'done').length;
    return {
      id: d.id, title: d.title, text: d.text, status: d.status, source: d.source, createdAt: d.createdAt, updatedAt: d.updatedAt, done, total: d.parts.length,
      parts: d.parts.map(({ target, name, harness, office, kind, ref, status, detail }) => ({ target, name, harness, office, kind, ref, status, detail })),
    };
  }
}
