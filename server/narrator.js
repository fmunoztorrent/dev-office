// The narrator: what someone of the team did lately, in one short and concrete sentence ("Fixed the
// rounding in pagos.js; 2 of 3 test runs failed"), for their card and, when a turn ends, their bubble.
// With a fast model you choose (⚙ › Intelligence › Narrator: Haiku, a DeepSeek flash, a local Ollama…)
// the model writes it from the facts; without one, the office says it by rules. Either way it comes from
// the real log (the events of that character), never invented, and each answer is cached by what it saw.
import { t, getLanguage } from '../public/i18n.js';

const RECENT = 30;      // events of a character looked at
const CACHE_MAX = 200;
const NARRATE_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const WORK = new Set(['tool_start', 'tool_end', 'error', 'phase', 'subagent_start', 'subagent_end', 'task']);

/** The facts of a character's recent events: what they did (newest last, without repeats), what failed, and now. */
export function factsOf(events) {
  const done = [];
  let fails = 0, tools = 0;
  for (const ev of events) {
    if (!WORK.has(ev.kind)) continue;
    if (ev.kind === 'tool_start') tools++;
    if (ev.kind === 'error' || (ev.kind === 'tool_end' && ev.ok === false)) fails++;
    const text = String(ev.text || '').trim();
    if (!text || ev.kind === 'tool_end') continue;
    const at = done.indexOf(text);
    if (at >= 0) done.splice(at, 1);
    done.push(text);
  }
  return { done: done.slice(-6), fails, tools, last: done.at(-1) || '' };
}

/** The sentence by rules: the last things done, how many failed. */
export function rulesLine(facts) {
  if (!facts.done.length) return '';
  const list = facts.done.slice(-3);
  const what = list.length > 1 ? t('narrate.list', { first: list.slice(0, -1).join(', '), last: list.at(-1) }) : list[0];
  return facts.fails ? t('narrate.withFails', { what, n: facts.fails }) : what;
}

export class Narrator {
  /**
   * @param model    an Intelligence reading prefs.narrator (server/intelligence.js)
   * @param company  server/company.js: the offices and their logs
   */
  constructor({ model, company }) {
    Object.assign(this, { model, company });
    this.cache = new Map();
  }

  /** The events of a character (a role, or one subagent) in an office's log, the most recent ones. */
  eventsOf(office, { role, subId = null }) {
    const log = this.company.get?.(office)?.log || [];
    return log.filter((ev) => (subId ? ev.subId === subId : ev.role === role && !ev.subId)).slice(-RECENT);
  }

  /**
   * What they did lately: { ok, text, source: 'model' | 'rules' | 'none' }. With the model it is asked once
   * for what it saw (cached); if the model fails, by rules.
   */
  async line(office, { role, subId = null, name = '', title = '' } = {}) {
    const events = this.eventsOf(office, { role, subId });
    const facts = factsOf(events);
    if (!facts.done.length) return { ok: true, text: '', source: 'none' };
    const rules = rulesLine(facts);
    if (!this.model?.enabled) return { ok: true, text: rules, source: 'rules' };
    const key = `${office}|${role}|${subId || ''}|${events.at(-1)?.id || 0}|${getLanguage()}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const out = await this.model.ask({
      system: t('narrate.system'),
      user: t('narrate.user', { who: [name, title || role].filter(Boolean).join(', '), facts: facts.done.map((x) => `- ${x}`).join('\n'), fails: facts.fails }),
      schema: NARRATE_SCHEMA,
    });
    const text = out.ok && typeof out.json?.text === 'string' ? out.json.text.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    const res = text ? { ok: true, text, source: 'model' } : { ok: true, text: rules, source: 'rules', error: out.error };
    if (text) {
      this.cache.set(key, res);
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    }
    return res;
  }

  /**
   * A turn ended: with the model on, each one who worked in it says what they did (up to three), as a
   * bubble over them. Without the model nothing is said (the rules' sentence is on their card).
   */
  async turnEnded(office, session, emit) {
    if (!this.model?.enabled) return [];
    const log = this.company.get?.(office)?.log || [];
    const from = log.findLastIndex((ev, i) => i < log.length - 1 && ev.session === session && ['turn_end', 'done'].includes(ev.kind));
    const turn = log.slice(from + 1).filter((ev) => ev.session === session && WORK.has(ev.kind) && ev.role && !ev.subId);
    const roles = [...new Set(turn.map((ev) => ev.role))].filter((r) => turn.filter((ev) => ev.role === r).length >= 2).slice(0, 3);
    const said = [];
    for (const role of roles) {
      const out = await this.line(office, { role });
      if (out.source === 'model' && out.text) { emit({ role, text: out.text }); said.push(role); }
    }
    return said;
  }
}
