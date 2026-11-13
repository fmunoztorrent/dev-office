// The executive floor: the company's directors give orders that cover several offices, departments
// or projects at once (a directive): "update the logging library everywhere", "every API exposes
// /health". The office is still the frontend: a directive is one brief per project, sent to each
// registered agent through its harness (an open session of it, or a new one), and the floor follows
// how each part goes. When the last one ends, its minutes go to the archive.
//
// Before it goes, the impact is mapped (server/components.js): the departments, projects and
// components the order names, plus the projects you chose. What it seems to name that is not on the
// map is asked first (does it exist, and where? is it a new component? a new department?); each part
// then carries the components it touches, and the new ones to create.
//
// Operations does not overload a department: it takes at most `prefs.capacity` open briefs at once
// (3 by default, counting what it already had); the rest of its parts wait their turn and go as
// soon as one of its briefs ends.
//
// When its projects are artifacts of a system (server/systems.js), the order follows what each one uses:
// a part waits until the parts it uses are done (core → bff → web), and its brief carries their handoff
// (what they left with the MCP tool `handoff`, or the end of their output) and may read their folders.
// If one of them fails or is cancelled, the parts that use it do not go. A brief to a system is a
// directive to its artifacts (`systems`).

import { EventEmitter } from 'node:events';
import { clip } from './roles.js';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';
import { companyMap, mapImpact, impactText } from './components.js';
import { insideDir } from './paths.js';

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

  /** The projects a directive goes to: the ones chosen, every registered one in the offices chosen and the artifacts of the systems chosen. */
  #targets({ offices = [], targets = [], systems = [] }) {
    const agents = this.store.listAgents();
    const want = new Set();
    for (const ref of [].concat(systems || [])) {
      const s = this.store.findSystem?.(ref);
      if (!s) return { error: tr('err.unknownSystem', { system: ref }) };
      for (const p of s.parts) { const a = agents.find((x) => x.path === p.project || (insideDir(x.path, p.project) && insideDir(p.project, x.path))); if (a) want.add(a.id); }
    }
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

  /** The company's map, with each department's name as the game says it. */
  #map() { return companyMap(this.store, { name: (o) => this.company?.info?.(o.id)?.name || o.name || o.id }); }

  /**
   * The impact of an order before it goes: { ok, map: { departments, unknown, targets, matched }, text }.
   * { text, offices?, targets? }: the departments and projects chosen by hand count too.
   */
  plan({ text, offices, targets, systems } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.taskEmpty') };
    const pick = this.#targets({ offices, targets, systems });
    if (pick.error) return { ok: false, error: pick.error };
    const map = mapImpact(this.#map(), text, { targets: pick.agents.map((a) => a.id) });
    return { ok: true, map, text: impactText(map) };
  }

  /**
   * Your answers about what the order names that is not on the map: [{ key | phrase, action, project?, path?, department? }]
   *   exists      it is in that project (and folder): it is mapped as a component of it
   *   create      it is new: it is mapped in that project, and its part says to create it
   *   department  it is a new department: it is created (its projects come later)
   *   ignore      it is not a part of the system
   * Returns { fresh: Map(project id → [names to create]), created: [offices], targets: [ids], error? }.
   */
  #answer(unknown, answers) {
    const fresh = new Map(), created = [], targets = [];
    const agents = this.store.listAgents();
    for (const u of unknown) {
      const a = answers.find((x) => x && (x.key === u.key || x.phrase === u.phrase || x.name === u.phrase || x.name === u.name));
      if (!a) continue;
      if (a.action === 'exists' || a.action === 'create') {
        const p = agents.find((x) => x.id === a.project || x.path === a.project);
        if (!p) return { error: tr('err.unknownProject', { project: a.project || '?' }) };
        const name = String(a.component || u.name).trim();
        const out = this.store.addComponent({ project: p.path, name, path: a.path || '', description: a.action === 'create' ? tr('impact.newDesc') : '' });
        if (!out.ok) return { error: out.error };
        targets.push(p.id);
        if (a.action === 'create') fresh.set(p.id, [...(fresh.get(p.id) || []), { name, path: out.component.path }]);
      } else if (a.action === 'department') {
        const out = this.store.createOffice({ name: String(a.department || u.name).trim() });
        if (!out.ok) return { error: out.error };
        created.push(out.office);
      } else if (a.action !== 'ignore') return { error: tr('impact.badAnswer', { what: u.phrase }) };
    }
    return { fresh, created, targets };
  }

  /**
   * A new directive. { text, title?, offices?: [id | name | 'all'], targets?: [agent id | path], answers?, ask?, exact?, from? }
   * It goes to the projects its impact map finds (and the ones chosen); with exact, only to the chosen
   * ones (and the ones an answer named): you saw the map and decided. If it names something that is
   * not on the map and there is no answer for it, it does not go: { ok: false, needsAnswers, map } (ask: false skips that).
   * Returns { ok, directive, created } (also when some part could not be sent: it shows why).
   */
  create({ text, title, offices, targets, systems, answers = [], ask = true, exact = false, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.taskEmpty') };
    if (text.length > TEXT_MAX) return { ok: false, error: tr('err.taskTooLong', { n: TEXT_MAX }) };
    const first = this.plan({ text, offices, targets, systems });
    if (!first.ok) return first;
    const missing = first.map.unknown.filter((u) => !(answers || []).some((x) => x && (x.key === u.key || x.phrase === u.phrase || x.name === u.phrase || x.name === u.name)));
    if (ask && missing.length) return { ok: false, needsAnswers: true, error: tr('impact.needAnswers', { what: missing.map((u) => `«${u.phrase}»`).join(', ') }), map: first.map, text: first.text };
    const answered = this.#answer(first.map.unknown, answers || []);
    if (answered.error) return { ok: false, error: answered.error };
    // the map again: what was answered is on it now
    const chosen = this.#targets({ offices, targets, systems }).agents.map((a) => a.id);
    const map = mapImpact(this.#map(), text, { targets: [...new Set([...chosen, ...answered.targets])] });
    const agents = this.store.listAgents();
    const going = exact ? new Set([...chosen, ...answered.targets]) : new Set(map.targets);
    const pick = { agents: agents.filter((a) => going.has(a.id)) };
    if (!pick.agents.length) return { ok: false, error: answered.created.length ? tr('impact.deptEmpty', { names: answered.created.map((o) => o.name).join(', ') }) : tr('err.pickProjects'), created: answered.created };
    if (pick.agents.length > PARTS_MAX) return { ok: false, error: tr('err.tooManyProjects', { n: PARTS_MAX }) };
    const touches = (id) => map.departments.flatMap((o) => o.projects).find((p) => p.id === id)?.components.filter((c) => c.impacted) || [];

    const d = {
      id: `d${Date.now().toString(36)}${++this.seq}`, title: clip(title || text.split('\n')[0], 120), text, status: 'running',
      source: clip(from || tr('events.you'), 60), parts: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    const names = pick.agents.map((a) => a.name);
    // what each project uses among the others (its artifacts' systems): it goes after them
    const after = this.#order(pick.agents);
    this.#sending = true;
    try {
      for (const a of pick.agents) {
        const others = names.filter((n) => n !== a.name);
        // the components of this project it touches, and the new ones to create in it
        const fresh = answered.fresh.get(a.id) || [];
        const comps = touches(a.id).filter((c) => !fresh.some((f) => f.name === c.name));
        const lines = [
          comps.length ? `🧩 ${tr('exec.components', { list: comps.map((c) => `${c.name}${c.path ? ` (${c.path})` : ''}`).join(', ') })}` : '',
          ...fresh.map((f) => `🆕 ${tr('exec.newComponent', { name: f.name, path: f.path ? ` (${f.path})` : '' })}`),
        ].filter(Boolean);
        const needs = [...(after.get(a.id) || [])];
        const users = pick.agents.filter((x) => after.get(x.id)?.has(a.id)).map((x) => x.name);
        if (users.length) lines.push(`🤝 ${tr('exec.leaveHandoff', { list: users.join(', ') })}`);
        const part = {
          target: a.id, name: a.name, harness: a.harness, office: a.office || MAIN_OFFICE, kind: null, ref: null, status: 'running', detail: '',
          components: comps.map((c) => c.name), fresh: fresh.map((f) => f.name), after: needs, handoff: '', output: '',
          brief: tr('exec.brief', { title: d.title, others: others.length ? others.join(', ') : '—' }) + (lines.length ? `\n${lines.join('\n')}` : '') + `\n\n${text}`,
        };
        d.parts.push(part);
      }
      for (const part of d.parts) {
        // after the ones it uses; and a department with its hands full: this part waits its turn
        if (part.after.length) { Object.assign(part, { status: 'waiting', detail: tr('exec.waitFor', { names: this.#names(d, part.after) }) }); continue; }
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
    return { ok: true, directive: this.#public(d), created: answered.created };
  }

  #sending = false;

  /**
   * What each project uses among these (by the systems their artifacts are in): Map(project id → Set of
   * the ids it goes after). A loop between systems is not followed (those go without waiting).
   */
  #order(agents) {
    const after = new Map(agents.map((a) => [a.id, new Set()]));
    const repoOf = (folder) => agents.find((a) => insideDir(folder, a.path) && insideDir(a.path, folder))?.id;
    for (const s of this.store.listSystems?.() || []) {
      for (const p of s.parts) {
        const me = repoOf(p.project);
        if (!me) continue;
        for (const u of p.uses || []) {
          const dep = s.parts.find((x) => x.name === u);
          const it = dep && repoOf(dep.project);
          if (it && it !== me) after.get(me).add(it);
        }
      }
    }
    // a loop (two systems saying opposite things): its projects go without waiting each other
    const reaches = (from, to, seen = new Set()) => {
      for (const x of after.get(from) || []) {
        if (x === to) return true;
        if (!seen.has(x)) { seen.add(x); if (reaches(x, to, seen)) return true; }
      }
      return false;
    };
    for (const id of [...after.keys()].filter((x) => reaches(x, x))) after.set(id, new Set());
    return after;
  }

  #names(d, ids) { return ids.map((id) => d.parts.find((p) => p.target === id)?.name || id).join(', '); }

  /** A part's brief as it goes: with the handoff of each part it waited for, and the folders it may read. */
  #briefOf(d, part) {
    const from = (part.after || []).map((id) => d.parts.find((p) => p.target === id)).filter(Boolean);
    if (!from.length) return { text: part.brief, reads: [] };
    const agents = this.store.listAgents();
    const pathOf = (p) => agents.find((a) => a.id === p.target)?.path;
    const handoffs = from.map((p) => `📦 ${tr('exec.handoffFrom', { name: p.name })}\n${p.handoff || p.output || tr('exec.noHandoff', { path: pathOf(p) || p.name })}`);
    return { text: `${handoffs.join('\n\n')}\n\n${part.brief}`, reads: from.map(pathOf).filter(Boolean) };
  }
  #capacity() { return Math.max(1, Number(this.store.getPrefs?.().capacity) || 3); }

  /** The briefs a department has open now (its tasks and pipeline runs that did not end). */
  #busy(office) {
    const open = (x) => (x.office || MAIN_OFFICE) === office && !ENDED.has(x.status);
    return [...(this.hub?.tasks?.values() || [])].filter(open).length + [...(this.pipelines?.runs?.values() || [])].filter((r) => r.office && open(r)).length;
  }

  /** Sends a part to its project's agent. */
  #send(d, part) {
    let out;
    const { text, reads } = this.#briefOf(d, part);
    try { out = this.registry.run({ target: part.target, entry: 'prompt', text, title: `🏛 ${d.title}`, from: tr('exec.from'), reads }); } catch (err) { out = { ok: false, error: err.message }; }
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

  /**
   * The handoff an agent leaves for the artifacts that use its own (the MCP tool `handoff`): what they
   * need to know (endpoints, types, events, how to try it). It goes to the most recent part of a running
   * directive that works in that folder. Returns { ok, directive, part, for: [names] } or { ok: false, error }.
   */
  handoff({ cwd, text } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.handoffEmpty') };
    const agents = this.store.listAgents();
    for (const d of [...this.items.values()].reverse()) {
      if (d.status !== 'running') continue;
      const part = d.parts.find((p) => { const a = agents.find((x) => x.id === p.target); return a && cwd && insideDir(cwd, a.path) && !['failed', 'cancelled'].includes(p.status); });
      if (!part) continue;
      part.handoff = text.slice(0, 3000);
      this.#update(d);
      return { ok: true, directive: d.id, part: part.name, for: d.parts.filter((p) => p.after?.includes(part.target)).map((p) => p.name) };
    }
    return { ok: false, status: 404, error: tr('err.noHandoff') };
  }

  get(id) { const d = this.items.get(String(id)); return d ? this.#public(d) : null; }
  list(limit = 12) { return [...this.items.values()].slice(-limit).reverse().map((d) => this.#public(d)); }

  // each part follows its task (or its pipeline run); the ones waiting their turn go when there is room
  #follow() {
    if (this.#sending) return;
    for (const d of this.items.values()) {
      if (d.status !== 'running') continue;
      let moved = false;
      // first how each part that went is doing; then the ones waiting (again, while something moves:
      // a part that did not go leaves the ones that use it without going too)
      for (const p of d.parts) {
        if (p.status === 'waiting' || ENDED.has(p.status) || !p.ref) continue;
        const x = p.kind === 'task' ? this.hub?.tasks?.get(p.ref) : this.pipelines?.runs?.get(p.ref);
        if (!x) continue;
        const status = ENDED.has(x.status) ? x.status : 'running';
        const detail = clip(x.detail || '', 200);
        // what it answered (a session launched in the background): the handoff when it left none
        if (status === 'done' && !p.output && Array.isArray(x.output) && x.output.length) p.output = x.output.slice(-15).join('\n').slice(-2000);
        if (status !== p.status || detail !== p.detail) { p.status = status; p.detail = detail; moved = true; }
      }
      for (let again = true; again;) {
        again = false;
        for (const p of d.parts) {
          if (p.status !== 'waiting') continue;
          // first the parts it uses: done, it goes; one of them did not make it, it does not go
          const deps = (p.after || []).map((id) => d.parts.find((x) => x.target === id)).filter(Boolean);
          const broken = deps.find((x) => x.status === 'failed' || x.status === 'cancelled');
          if (broken) { Object.assign(p, { status: 'cancelled', detail: tr('exec.depFailed', { name: broken.name }) }); moved = again = true; continue; }
          if (deps.some((x) => x.status !== 'done')) continue;
          if (this.#busy(p.office) >= this.#capacity()) {
            const detail = tr('exec.waitTurn', { n: this.#busy(p.office) });
            if (p.detail !== detail) { p.detail = detail; moved = true; }
            continue;
          }
          this.#sending = true;
          try { this.#send(d, p); } finally { this.#sending = false; }
          moved = again = true;
        }
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
      parts: d.parts.map(({ target, name, harness, office, kind, ref, status, detail, components = [], fresh = [], after = [], handoff = '' }) => ({ target, name, harness, office, kind, ref, status, detail, components, fresh, after: after.map((id) => d.parts.find((p) => p.target === id)?.name || id), handoff: !!handoff })),
    };
  }
}
