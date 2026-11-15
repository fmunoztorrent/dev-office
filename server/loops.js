// A project's loop: a list of steps the office works through on its own, one after the other, each with
// its success criteria. The office is still the frontend: it sends each step to the project's agent as a
// brief (an open session of it, or a new one) and the agent does the work and checks the criteria.
//
//   - Every `interval` minutes (5 by default) the loop looks at its project: is it working (the step's brief
//     is still open, or a session in its folder is in the middle of a turn) or idle? While it works, or
//     waits for you, the loop only waits.
//   - Idle, it moves on: the step that did not go yet goes; the one that went is checked against its
//     criteria (the loop's, which every step has, plus its own). All met: the step is done and the next
//     one goes. One not met: the same step goes again with what is missing. Not reported: the agent is
//     asked to check them and report.
//   - The agent reports each criterion with the MCP tool `loop_report` (or, a session launched in the
//     background, with a line per criterion at the end of its answer: «✅ 1», «❌ 2 — why»); you can mark
//     one by hand, and your word stays.
//   - After `tries` rounds of a step without meeting its criteria, the loop stops and waits for you
//     (blocked): retry it, skip it, or change it. Criteria and steps can be added while it runs.

import { EventEmitter } from 'node:events';
import { clip } from './roles.js';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';
import { insideDir } from './paths.js';

export const LOOP_INTERVAL = 5; // minutes between looks, by default
export const LOOP_TRIES = 5; // rounds of a step before it asks you, by default
export const LOOP_STATUS = ['running', 'paused', 'blocked', 'done'];
const STEPS_MAX = 50;
const CRITERIA_MAX = 20;
const TEXT_MAX = 2000;
const ENDED = new Set(['done', 'failed', 'cancelled']);
// what an agent does when it works (until its turn ends it is not free)
const WORK = new Set(['task', 'thinking', 'tool_start', 'tool_end', 'subagent_start', 'phase', 'todos']);
// a session silent this long is not working any more (an agent that closed without saying so)
const STALE_MS = 30 * 60_000;
const OUTPUT_MAX = 2000;

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Success criteria, checked: [{ id, text, check }] (`check`: a command that proves it, which the agent runs).
 * They keep their id (a new one gets the next free `<prefix><n>`); a text alone is a criterion too.
 */
export function cleanCriteria(list, prefix = 'c', taken = []) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) fail(tr('err.loopCriteria'));
  if (list.length > CRITERIA_MAX) fail(tr('err.loopCriteriaMax', { n: CRITERIA_MAX }));
  const used = new Set(taken);
  let n = 0;
  const next = () => { do n++; while (used.has(`${prefix}${n}`)); used.add(`${prefix}${n}`); return `${prefix}${n}`; };
  const out = list.map((c) => {
    const raw = typeof c === 'string' ? { text: c } : c || {};
    const text = oneLine(raw.text, 300);
    if (!text) fail(tr('err.loopCriterionEmpty'));
    const id = typeof raw.id === 'string' && /^[a-z]\d{1,3}$/.test(raw.id) && !used.has(raw.id) ? raw.id : null;
    if (id) used.add(id);
    return { id, text, check: oneLine(raw.check, 300) };
  });
  return out.map((c) => ({ ...c, id: c.id || next() }));
}

/** What a step must meet: the loop's criteria (every step has them) and then its own. */
export const criteriaOf = (loop, step) => [...(loop.criteria || []), ...(step?.criteria || [])];

/** The step that is going (the first one not done nor skipped), or -1. */
export const currentIndex = (loop) => (loop.steps || []).findIndex((s) => !['done', 'skipped'].includes(s.status));

/**
 * What an answer says of each criterion, from its lines «✅ 1», «❌ 2 — why» (or «[x] 1», «[ ] 2»): { [id]: { met, note } }.
 * The numbers are the criteria's in the order the brief listed them.
 */
export function parseVerdict(text, criteria) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]\s*)?(✅|☑️?|✔️?|\[x\]|❌|✖️?|\[ \])\s*(?:#|n\.?\s*)?(\d{1,2})\b[.):]?\s*(?:[-—–:]\s*)?(.*)$/i);
    if (!m) continue;
    const c = criteria[Number(m[2]) - 1];
    if (!c) continue;
    const met = /✅|☑|✔|\[x\]/i.test(m[1]);
    // what follows the number: the criterion repeated is not a note
    const rest = oneLine(m[3], 300);
    out[c.id] = { met, note: rest && !rest.toLowerCase().startsWith(c.text.toLowerCase().slice(0, 20)) ? rest : '' };
  }
  return out;
}

/** The brief of a step: what to do, its criteria, and how to report them. `kind`: start | retry | verify. */
export function stepBrief(loop, step, { kind = 'start', index = 0 } = {}) {
  const crit = criteriaOf(loop, step);
  const total = loop.steps.length;
  const head = `🔁 ${tr('loop.brief.head', { name: loop.name, n: index + 1, total })}${kind === 'start' ? '' : ` · ${tr('loop.brief.try', { n: step.tries + 1, max: loop.tries })}`}`;
  const lines = [head];
  if (kind !== 'start') {
    const r = step.results || {};
    const unmet = crit.map((c, i) => ({ c, i })).filter(({ c }) => r[c.id]?.met === false);
    const unknown = crit.map((c, i) => ({ c, i })).filter(({ c }) => !r[c.id]);
    lines.push(tr(!crit.length ? 'loop.brief.again' : kind === 'retry' ? 'loop.brief.retry' : 'loop.brief.verify'));
    for (const { c, i } of unmet) lines.push(`❌ ${i + 1}. ${c.text}${r[c.id].note ? ` — ${r[c.id].note}` : ''}`);
    for (const { c, i } of unknown) lines.push(`❔ ${i + 1}. ${c.text}`);
    lines.push('', tr('loop.brief.theStep'));
  }
  lines.push(step.text);
  if (crit.length) {
    lines.push('', `✅ ${tr('loop.brief.criteria')}`);
    crit.forEach((c, i) => lines.push(`${i + 1}. ${c.text}${c.check ? ` — ${tr('loop.brief.check', { cmd: c.check })}` : ''}`));
    lines.push('', tr('loop.brief.report', { name: loop.name, n: index + 1 }));
  }
  return lines.join('\n');
}

export class LoopDesk extends EventEmitter {
  /**
   * @param store     the database: the loops and the registered projects
   * @param registry  the agents (server/registry.js): each step goes through it
   * @param hub       the tasks (server/tasks.js) and `pipelines` (server/pipeline.js): how each step's brief goes
   * @param company   the offices: the log, and the sessions of each folder
   * @param archive   the archive (server/archive.js): the minutes of each loop that ends
   * @param now       () => the time (the tests move it)
   */
  constructor({ store, registry, hub, pipelines, company, archive, now = () => Date.now(), tickMs = 15_000 }) {
    super();
    Object.assign(this, { store, registry, hub, pipelines, company, archive, now, tickMs });
    this.sessions = new Map(); // session → { cwd, busy, waiting, at }: who is in the middle of a turn
    this.items = new Map();
    for (const l of store.listLoops()) {
      // what was going when the office closed is not followed any more (its brief lived in its memory):
      // the step is checked again on its next look
      for (const s of l.steps || []) if (s.ref) { s.ref = null; s.kind = null; }
      l.activity = 'idle';
      l.nextTick = 0;
      this.items.set(l.id, l);
    }
    this.seq = 0;
    this.timer = null;
    this.senseTimer = null;
    // whether each project works or is idle is shown live (between looks the loop only waits)
    hub?.on?.('change', () => this.#senseSoon());
  }

  /** Whether each running loop's project is working, idle or waiting for you, now (it sends nothing). */
  sense() {
    let moved = false;
    for (const loop of this.items.values()) {
      if (loop.status !== 'running') continue;
      // what a session in the background answered of its criteria shows up already (the look decides)
      const s = loop.steps[currentIndex(loop)];
      if (s?.status === 'working' && ENDED.has(this.#item(s)?.status)) {
        const before = JSON.stringify(s.results || {});
        this.#collect(loop, s);
        if (JSON.stringify(s.results) !== before) { this.#save(loop); moved = true; }
      }
      const act = this.activity(loop);
      if (act === loop.activity) continue;
      loop.activity = act;
      loop.activitySince = this.now();
      moved = true;
    }
    if (moved) this.#changed();
    return moved;
  }
  #senseSoon() {
    if (this.senseTimer) return;
    this.senseTimer = setTimeout(() => { this.senseTimer = null; try { this.sense(); } catch { /* the view cannot break the loop */ } }, 500);
    this.senseTimer.unref?.();
  }

  /** Looks at the loops that are due, every few seconds (each one at its own interval). */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickAll(), this.tickMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); clearTimeout(this.senseTimer); this.timer = this.senseTimer = null; }

  /** Each event of each office: which sessions are in the middle of a turn, and which wait for you. */
  onEvent(_office, ev, session) {
    if (!session?.id || session.id === 'office' || ev.subId) return;
    let st = this.sessions.get(session.id);
    if (!st) {
      st = { cwd: session.cwd || '', busy: false, waiting: false, at: 0 };
      this.sessions.set(session.id, st);
      if (this.sessions.size > 200) this.sessions.delete(this.sessions.keys().next().value);
    }
    st.cwd = session.cwd || st.cwd;
    st.at = this.now();
    if (['turn_end', 'done', 'session_end'].includes(ev.kind)) { st.busy = false; st.waiting = false; }
    else if (ev.kind === 'waiting' || session.status === 'waiting') { st.waiting = true; st.busy = true; }
    else if (WORK.has(ev.kind)) { st.busy = true; st.waiting = false; }
    if (['turn_end', 'done', 'session_end', 'waiting', 'task'].includes(ev.kind)) this.#senseSoon();
  }

  // ---------------------------------------------------------------- what you do

  #agent(ref) {
    const agents = this.store.listAgents();
    return agents.find((a) => a.id === ref) || agents.find((a) => a.path === ref || a.name === ref) || null;
  }
  #find(ref) { return this.items.get(String(ref)) || [...this.items.values()].find((l) => l.name.toLowerCase() === String(ref ?? '').trim().toLowerCase()) || null; }

  /** The steps, checked: their text and criteria; the ones that already went keep how they went. */
  #cleanSteps(list, current = []) {
    if (list === undefined) return current;
    if (!Array.isArray(list)) fail(tr('err.loopSteps'));
    if (list.length > STEPS_MAX) fail(tr('err.loopStepsMax', { n: STEPS_MAX }));
    const used = new Set(current.map((s) => s.id));
    let n = 0;
    return list.map((raw) => {
      const s = typeof raw === 'string' ? { text: raw } : raw || {};
      const text = String(s.text ?? '').trim().slice(0, TEXT_MAX);
      if (!text) fail(tr('err.loopStepEmpty'));
      const was = current.find((x) => x.id === s.id);
      let id = was?.id;
      if (!id) { do n++; while (used.has(`p${n}`)); id = `p${n}`; used.add(id); }
      const criteria = cleanCriteria(s.criteria === undefined ? was?.criteria : s.criteria, 'c');
      return was ? { ...was, text, criteria } : { id, text, criteria, status: 'pending', tries: 0, results: {}, ref: null, kind: null, detail: '', sentAt: null, endedAt: null };
    });
  }

  #define(input, current = null) {
    const name = oneLine(input.name ?? current?.name, 60);
    if (!name) fail(tr('err.loopName'));
    const a = this.#agent(input.project ?? input.agent ?? current?.agent);
    if (!a) fail(tr('err.unknownProject', { project: input.project ?? input.agent ?? '?' }));
    const interval = input.interval === undefined || input.interval === null || input.interval === '' ? current?.interval ?? LOOP_INTERVAL : Number(input.interval);
    if (!Number.isInteger(interval) || interval < 1 || interval > 1440) fail(tr('err.loopInterval'));
    const tries = input.tries === undefined || input.tries === null || input.tries === '' ? current?.tries ?? LOOP_TRIES : Number(input.tries);
    if (!Number.isInteger(tries) || tries < 1 || tries > 50) fail(tr('err.loopTries'));
    const criteria = input.criteria === undefined ? current?.criteria || [] : cleanCriteria(input.criteria, 'g');
    const steps = this.#cleanSteps(input.steps, current?.steps || []);
    return { name, agent: a.id, interval, tries, criteria, steps };
  }

  #run(fn) {
    try { return fn(); } catch (err) {
      if (err instanceof Invalid) return { ok: false, error: err.message };
      throw err;
    }
  }

  /**
   * A new loop: { name, project (a registered project's id, folder or name), interval? (minutes), tries?,
   * criteria? (the loop's, for every step), steps: [{ text, criteria? }], paused? }. Its first look is now.
   */
  create(input = {}) {
    return this.#run(() => {
      const def = this.#define(input);
      const now = this.now();
      const loop = {
        id: `l${now.toString(36)}${++this.seq}`, ...def, status: input.paused ? 'paused' : 'running',
        activity: 'idle', activitySince: now, detail: '', lastTick: null, nextTick: now, createdAt: now, updatedAt: now,
      };
      if (!loop.steps.length && !input.paused) loop.detail = tr('loop.detail.noSteps');
      const saved = this.store.saveLoop(loop);
      if (!saved.ok) return saved;
      this.items.set(loop.id, loop);
      this.#log(loop, 'created', tr('loop.log.created', { name: loop.name, project: this.#agent(loop.agent)?.name || '?', n: loop.steps.length, every: loop.interval }));
      this.#changed();
      if (loop.status === 'running') this.#tick(loop, true);
      return { ok: true, loop: this.#public(loop) };
    });
  }

  /** Changes a loop: its name, project, interval, tries, criteria or steps (the ones that went keep how they went). */
  update(id, input = {}) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    return this.#run(() => {
      const def = this.#define(input, loop);
      const before = { ...loop };
      Object.assign(loop, def);
      // a step added to a loop that had finished: it goes on
      if (loop.status === 'done' && currentIndex(loop) >= 0) { loop.status = 'running'; loop.nextTick = this.now(); }
      const saved = this.#save(loop);
      if (!saved.ok) { Object.assign(loop, before); return saved; }
      this.#changed();
      return { ok: true, loop: this.#public(loop) };
    });
  }

  /** Adds success criteria while it runs: to the loop (`step` empty: every step) or to one step (its id or number). */
  addCriteria(id, { criteria, step } = {}) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    const list = [].concat(criteria ?? []);
    if (!list.length) return { ok: false, error: tr('err.loopCriterionEmpty') };
    const s = step === undefined || step === null || step === '' ? null : this.#step(loop, step);
    if (step !== undefined && step !== null && step !== '' && !s) return { ok: false, error: tr('err.unknownStep', { step }) };
    const target = s ? s.criteria : loop.criteria;
    return this.update(loop.id, s
      ? { steps: loop.steps.map((x) => (x === s ? { ...x, criteria: [...target, ...list] } : x)) }
      : { criteria: [...target, ...list] });
  }

  /** Adds steps at the end. */
  addSteps(id, steps) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    return this.update(loop.id, { steps: [...loop.steps, ...[].concat(steps ?? [])] });
  }

  #step(loop, ref) {
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return loop.steps[Number(ref) - 1] || null;
    return loop.steps.find((s) => s.id === ref) || null;
  }

  pause(id) { return this.#set(id, (loop) => { if (loop.status === 'done') return tr('err.loopDone'); loop.status = 'paused'; loop.detail = tr('loop.detail.paused'); }); }
  /** Goes on (also after it was blocked: the step gets its rounds back). Its next look is now. */
  resume(id) {
    return this.#set(id, (loop) => {
      if (loop.status === 'done') return tr('err.loopDone');
      const s = loop.steps[currentIndex(loop)];
      if (loop.status === 'blocked' && s) { s.tries = 0; s.status = s.status === 'blocked' ? (s.sentAt ? 'working' : 'pending') : s.status; }
      loop.status = 'running';
      loop.detail = '';
      loop.nextTick = this.now();
    }, true);
  }
  /** Skips the step that is going (it does not meet its criteria, and you decide it does not matter). */
  skip(id) {
    return this.#set(id, (loop) => {
      const s = loop.steps[currentIndex(loop)];
      if (!s) return tr('err.loopDone');
      s.status = 'skipped';
      s.endedAt = this.now();
      this.#log(loop, 'skipped', tr('loop.log.skipped', { name: loop.name, n: loop.steps.indexOf(s) + 1 }));
      if (loop.status === 'blocked') loop.status = 'running';
      loop.nextTick = this.now();
    }, true);
  }
  /** Looks now, without waiting for its interval. */
  tick(id) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    if (loop.status !== 'running') return { ok: false, error: tr('err.loopNotRunning', { status: tr(`loopStatus.${loop.status}`) }) };
    this.#tick(loop, true);
    return { ok: true, loop: this.#public(loop) };
  }
  remove(id) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    this.items.delete(loop.id);
    this.store.deleteLoop(loop.id);
    this.#changed();
    return { ok: true };
  }

  #set(id, fn, tickNow = false) {
    const loop = this.#find(id);
    if (!loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: id }) };
    const error = fn(loop);
    if (error) return { ok: false, error };
    this.#save(loop);
    this.#changed();
    if (tickNow && loop.status === 'running') this.#tick(loop, true);
    return { ok: true, loop: this.#public(loop) };
  }

  /**
   * How criteria are going: [{ criterion: number (the brief's) | id, met: true | false | null (null: forget
   * your mark), note? }]. From you (`by: 'you'`: it stays until you change it) or from the agent (MCP
   * `loop_report`: the loop by its id or name, or the one running in that folder; the step by its number,
   * or the one going). Returns { ok, loop, step, met, total, missing: [texts] }.
   */
  report({ loop: ref, cwd, step: stepRef, results, by = 'agent' } = {}) {
    let loop = ref ? this.#find(ref) : null;
    if (ref && !loop) return { ok: false, status: 404, error: tr('err.unknownLoop', { loop: ref }) };
    if (!loop && cwd) {
      const agents = this.store.listAgents();
      loop = [...this.items.values()].reverse().find((l) => { const a = agents.find((x) => x.id === l.agent); return a && insideDir(cwd, a.path) && l.status !== 'done'; }) || null;
    }
    if (!loop) return { ok: false, status: 404, error: tr('err.noLoopHere') };
    const s = stepRef !== undefined && stepRef !== null && stepRef !== '' ? this.#step(loop, stepRef) : loop.steps[currentIndex(loop)];
    if (!s) return { ok: false, error: tr('err.unknownStep', { step: stepRef ?? '—' }) };
    const crit = criteriaOf(loop, s);
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return { ok: false, error: tr('err.loopNoResults') };
    s.results ||= {};
    for (const r of list) {
      const ref2 = r?.criterion ?? r?.id ?? r?.n;
      const c = typeof ref2 === 'number' || /^\d+$/.test(String(ref2)) ? crit[Number(ref2) - 1] : crit.find((x) => x.id === ref2 || x.text.toLowerCase() === String(ref2 ?? '').toLowerCase());
      if (!c) return { ok: false, error: tr('err.unknownCriterion', { criterion: ref2 ?? '?' }) };
      // your mark stays: the agent does not overwrite it
      if (by !== 'you' && s.results[c.id]?.by === 'you') continue;
      if (r.met === null && by === 'you') { delete s.results[c.id]; continue; }
      s.results[c.id] = { met: !!r.met, note: oneLine(r.note, 300), by, at: this.now() };
    }
    this.#save(loop);
    const met = crit.filter((c) => s.results[c.id]?.met === true).length;
    if (by !== 'you') this.#log(loop, 'report', tr('loop.log.report', { name: loop.name, n: loop.steps.indexOf(s) + 1, met, total: crit.length }));
    this.#changed();
    return { ok: true, loop: loop.id, step: loop.steps.indexOf(s) + 1, met, total: crit.length, missing: crit.filter((c) => s.results[c.id]?.met !== true).map((c) => c.text) };
  }

  get(id) { const l = this.#find(id); return l ? this.#public(l) : null; }
  list() { return [...this.items.values()].map((l) => this.#public(l)); }

  // ---------------------------------------------------------------- the loop itself

  /** Each loop whose look is due. */
  tickAll() {
    for (const loop of this.items.values()) {
      try { this.#tick(loop, false); } catch { /* one loop cannot stop the others */ }
    }
  }

  /** The brief (or pipeline run) a step's last round went as, if the office still follows it. */
  #item(step) {
    if (!step.ref) return null;
    return step.kind === 'run' ? this.pipelines?.runs?.get(step.ref) || null : this.hub?.tasks?.get(step.ref) || null;
  }

  /** Is the project working ('working'), waiting for you ('waiting') or idle? */
  activity(loop) {
    const s = loop.steps[currentIndex(loop)];
    const x = s && this.#item(s);
    if (x && !ENDED.has(x.status)) return 'working';
    const a = this.store.listAgents().find((y) => y.id === loop.agent);
    if (!a) return 'idle';
    let out = 'idle';
    for (const st of this.sessions.values()) {
      if (!st.cwd || !insideDir(st.cwd, a.path) || this.now() - st.at > STALE_MS) continue;
      if (st.waiting) return 'waiting';
      if (st.busy) out = 'working';
    }
    return out;
  }

  #tick(loop, force) {
    if (loop.status !== 'running') return;
    const now = this.now();
    if (!force && now < (loop.nextTick || 0)) return;
    loop.lastTick = now;
    loop.nextTick = now + loop.interval * 60_000;
    const act = this.activity(loop);
    if (act !== loop.activity) { loop.activity = act; loop.activitySince = now; }
    if (act !== 'idle') {
      loop.detail = tr(act === 'waiting' ? 'loop.detail.waitingYou' : 'loop.detail.working');
      return this.#done(loop);
    }
    // idle: the step that is going moves on (and, when one is done, the next one goes right away)
    for (let guard = 0; guard < STEPS_MAX + 1; guard++) {
      const i = currentIndex(loop);
      const s = loop.steps[i];
      if (!s) {
        if (loop.steps.length) this.#finish(loop);
        else loop.detail = tr('loop.detail.noSteps');
        return this.#done(loop);
      }
      if (s.status === 'pending') { this.#send(loop, s, i, 'start'); return this.#done(loop); }
      if (s.status === 'blocked') { loop.status = 'blocked'; return this.#done(loop); }
      // it went, and it is idle: is it done?
      this.#collect(loop, s);
      const crit = criteriaOf(loop, s);
      const r = s.results || {};
      const item = this.#item(s);
      const failed = item ? item.status !== 'done' : false;
      // without criteria, the step is done when its brief ended well (one the office lost track of is checked again)
      const passed = crit.length ? crit.every((c) => r[c.id]?.met === true) : item?.status === 'done';
      if (passed) {
        s.status = 'done';
        s.endedAt = now;
        s.detail = '';
        this.#log(loop, 'passed', tr('loop.log.passed', { name: loop.name, n: i + 1, total: loop.steps.length }));
        continue;
      }
      if (s.tries >= loop.tries) {
        s.status = 'blocked';
        loop.status = 'blocked';
        loop.detail = tr('loop.detail.blocked', { n: i + 1, tries: s.tries });
        this.#log(loop, 'blocked', tr('loop.log.blocked', { name: loop.name, n: i + 1, tries: s.tries }), false);
        return this.#done(loop);
      }
      const kind = crit.some((c) => r[c.id]?.met === false) || failed ? 'retry' : 'verify';
      this.#send(loop, s, i, kind);
      return this.#done(loop);
    }
    return this.#done(loop);
  }

  #done(loop) { this.#save(loop); this.#changed(); }

  /** What a step's agent answered, when it went to a session in the background: its «✅ n» lines. */
  #collect(loop, s) {
    const x = this.#item(s);
    if (!x || !Array.isArray(x.output) || !x.output.length) return;
    const text = x.output.join('\n').slice(-OUTPUT_MAX);
    s.output = text;
    const found = parseVerdict(text, criteriaOf(loop, s));
    s.results ||= {};
    for (const [id, v] of Object.entries(found)) if (!s.results[id] || s.results[id].by === 'output') s.results[id] = { ...v, by: 'output', at: this.now() };
  }

  #send(loop, s, i, kind) {
    const a = this.store.listAgents().find((x) => x.id === loop.agent);
    const text = stepBrief(loop, s, { kind, index: i });
    // what the agent said last round goes away (yours stays): it reports again
    for (const [id, v] of Object.entries(s.results || {})) if (v.by !== 'you') delete s.results[id];
    s.output = '';
    let out;
    try {
      out = a ? this.registry.run({ target: a.id, entry: 'prompt', text, title: `🔁 ${loop.name} · ${i + 1}/${loop.steps.length}: ${oneLine(s.text, 120)}`, from: tr('loop.from') }) : { ok: false, error: tr('err.unknownProject', { project: loop.agent }) };
    } catch (err) { out = { ok: false, error: err.message }; }
    s.tries++;
    if (out.ok && (out.task || out.run)) {
      Object.assign(s, { status: 'working', kind: out.task ? 'task' : 'run', ref: (out.task || out.run).id, sentAt: this.now(), detail: '' });
      loop.activity = 'working';
      loop.activitySince = this.now();
      loop.detail = '';
      this.#log(loop, kind, tr(`loop.log.${kind}`, { name: loop.name, n: i + 1, total: loop.steps.length, try: s.tries, max: loop.tries, step: oneLine(s.text, 80) }));
    } else {
      s.detail = clip(out.error || tr('task.failedDefault'), 200);
      loop.detail = tr('loop.detail.cantSend', { error: s.detail });
      this.#log(loop, 'failed', tr('loop.log.cantSend', { name: loop.name, n: i + 1, error: s.detail }), false);
      if (s.tries >= loop.tries) { s.status = 'blocked'; loop.status = 'blocked'; }
    }
  }

  // every step done (or skipped): its minutes go to the archive
  #finish(loop) {
    loop.status = 'done';
    loop.detail = '';
    const lines = loop.steps.map((s, i) => `${i + 1}. ${tr(`loopStep.${s.status}`)}${s.tries > 1 ? ` (${tr('loop.minuteTries', { n: s.tries })})` : ''} — ${oneLine(s.text, 160)}`);
    try {
      this.archive?.save({
        kind: 'minute', title: tr('loop.minuteTitle', { name: loop.name }), tags: ['loop'],
        body: `${tr('loop.minuteProject', { project: this.#agent(loop.agent)?.name || '?' })}\n\n${lines.join('\n')}`,
      }, { source: tr('loop.from') });
    } catch { /* the minutes cannot break the loop */ }
    this.#log(loop, 'done', tr('loop.log.done', { name: loop.name, n: loop.steps.length }));
  }

  // what the loop does goes to its project's office log (the manager runs it)
  #log(loop, phase, text, ok = true) {
    const a = this.store.listAgents().find((x) => x.id === loop.agent);
    try { this.company?.ingest('generic', { session: 'office', office: a?.office || MAIN_OFFICE, kind: 'loop', phase, loop: loop.id, ok, text }); } catch { /* the log cannot break the loop */ }
  }

  #save(loop) {
    loop.updatedAt = this.now();
    try { return this.store.saveLoop(loop); } catch (err) { return { ok: false, error: err.message }; }
  }
  #changed() { this.emit('change', this.list()); }

  #public(l) {
    const a = this.store.listAgents().find((x) => x.id === l.agent);
    const i = currentIndex(l);
    return {
      id: l.id, name: l.name, agent: l.agent, project: a?.name || null, path: a?.path || null, office: a?.office || MAIN_OFFICE,
      interval: l.interval, tries: l.tries, status: l.status, activity: l.activity, activitySince: l.activitySince, detail: l.detail,
      lastTick: l.lastTick, nextTick: l.status === 'running' ? l.nextTick : null, current: i, createdAt: l.createdAt, updatedAt: l.updatedAt,
      criteria: l.criteria,
      steps: l.steps.map((s) => ({
        id: s.id, text: s.text, criteria: s.criteria, status: s.status, tries: s.tries, detail: s.detail, sentAt: s.sentAt, endedAt: s.endedAt, ref: s.ref,
        results: Object.fromEntries(criteriaOf(l, s).map((c) => [c.id, s.results?.[c.id] || null])),
      })),
    };
  }
}
