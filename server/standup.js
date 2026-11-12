// The daily standup: every morning (from 9:30 in each office's time zone, the first time the office
// is running that day and something happened the day before) the team gathers at the meeting table
// and each character tells what their agent did, from the real log: what they worked on, how many
// steps, what went wrong; then what is waiting for you and what is still open. It is the office's own
// summary (no model is asked); its minutes go to the archive. It can also be called at any time, to
// be told the latest: each daily tells what happened since the office's previous one (the first, the
// last 24 hours; never more than a week).
//
//   report(officeId) → { office, date, since, lines: [{ role, did, steps, errors, doing }], waiting, open, empty }
//   run(officeId)    → emits the 'standup' event (the game gathers them), saves the minutes, and
//                      returns the report with each line said and the whole of it as `text`
//   runAll()         → the company's daily: every department's, at once

import { EventEmitter } from 'node:events';
import { t, listOf } from '../public/i18n.js';
import { clip } from './roles.js';
import { zoned } from '../public/clock.js';

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;
const NOW_MS = 10 * 60_000; // what someone is doing "now": something they started in the last 10 minutes
const STARTS = new Set(['tool_start', 'phase', 'thinking', 'subagent_start']);
const QUIET = new Set(['chat', 'poke', 'btw', 'context', 'standup', 'clarify', 'dispatch']); // not work
// a question the agent asks you is not work they did: it goes with what is waiting for you
const ASK = /^(askuserquestion|question|ask_user_choice|ask_user_question|ask_user)$/i;
const asking = (e) => e.kind === 'tool_start' && ASK.test(e.tool || '');
// a sentence ends once: "¿Pesos o dólares?." → "¿Pesos o dólares?"
const once = (s) => s.replace(/([.?!…])\.$/u, '$1');
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const AT = 9 * 60 + 30; // 9:30, the office's time
const WORK = new Set(['tool_start', 'phase', 'subagent_start', 'done', 'turn_end']);
const ORDER = ['analyst', 'designer', 'tl', 'backend', 'frontend', 'qa', 'devops', 'security', 'manager']; // the visiting specialists tell theirs too

export class Standup extends EventEmitter {
  /**
   * @param company  the offices (their log and sessions)
   * @param archive  where the minutes go
   * @param store    which day each office already had its standup (settings)
   * @param hub      the tasks still running
   * @param who      (office, role) → how the text names each one: "Diego (Backend)"
   */
  constructor({ company, archive, store, hub, clarify, who = null, now = () => Date.now(), every = 5 * 60_000 } = {}) {
    super();
    Object.assign(this, { company, archive, store, hub, clarify, who, now });
    if (every) { this.timer = setInterval(() => this.tick(), every); this.timer.unref?.(); }
  }

  stop() { clearInterval(this.timer); }

  /**
   * What happened in an office since its previous daily (or in the last 24 hours, the first time),
   * said by each character, and what each one is doing right now.
   */
  report(officeId, { since: from } = {}) {
    const office = this.company.get(officeId);
    const now = this.now();
    const last = from ?? this.store?.getStandupAt?.(officeId) ?? null;
    const since = Math.max(last ?? now - DAY, now - WEEK);
    const log = (office?.log || []).filter((e) => e.ts >= since && e.role && e.role !== 'po' && e.session !== 'office');
    const lines = [];
    for (const role of ORDER) {
      const mine = log.filter((e) => e.role === role);
      if (!mine.some((e) => WORK.has(e.kind) && !asking(e))) continue;
      const steps = mine.filter((e) => e.kind === 'tool_start' && !asking(e)).length;
      const errors = mine.filter((e) => (e.kind === 'tool_end' && e.ok === false && e.phase !== 'red') || e.kind === 'error').length;
      // what they worked on: the latest distinct things they did, in words
      // and what they are on right now: their latest event started something that has not ended (it is not told as done)
      const last = (office?.log || []).findLast((e) => e.role === role && e.session !== 'office' && !QUIET.has(e.kind));
      const doing = last && STARTS.has(last.kind) && !asking(last) && now - last.ts < NOW_MS && last.text ? clip(last.text, 60) : null;
      const did = [...new Set(mine.filter((e) => ['tool_start', 'phase', 'subagent_start'].includes(e.kind) && e.text && !asking(e)).map((e) => clip(e.text, 60)).reverse())].filter((x) => x !== doing).slice(0, 3).reverse();
      lines.push({ role, did, steps, errors, doing });
    }
    const sessions = [...(office?.sessions?.values() || [])].filter((s) => s.id !== 'office');
    const waiting = sessions.filter((s) => s.status === 'waiting').map((s) => clip(s.waiting?.text || s.title || '', 80)).filter(Boolean)
      .concat((this.clarify?.list(officeId) || []).filter((c) => c.status === 'asking').map((c) => clip(c.text, 80)));
    const open = [...(this.hub?.tasks?.values() || [])].filter((x) => (x.office || 'main') === officeId && ['queued', 'sent', 'running'].includes(x.status)).map((x) => clip(x.title || x.text, 80));
    const zone = this.company.zoneOf?.(officeId);
    return { office: officeId, date: ymd(zoned(now, zone)), since, from: Standup.from(last === null ? null : since, now, zone), lines, waiting, open, empty: !lines.length };
  }

  /**
   * Since when, in words, in the office's time: null the first time (the last 24 hours: "yesterday"),
   * otherwise "since 14:05", "since yesterday at 9:30" or "since 2026-11-03".
   */
  static from(since, now, zone) {
    if (since === null || since === undefined) return null;
    const a = zoned(since, zone), b = zoned(now, zone);
    if (ymd(a) === ymd(b)) return t('standup.since.today', { at: hhmm(a) });
    if (ymd(a) === ymd(zoned(now - DAY, zone))) return t('standup.since.yesterday', { at: hhmm(a) });
    return t('standup.since.day', { date: ymd(a) });
  }

  /** What each character says at the table (in the game's language); `from`: since when (null: yesterday). */
  static say(line, from = null) {
    const low = (x) => x.replace(/^./, (c) => c.toLocaleLowerCase());
    const many = (key, n) => t(`standup.${key}.${n === 1 ? 'one' : 'other'}`, { n });
    // only what they are on now: that, with its steps
    if (!line.did.length && line.doing) return [once(t('standup.doingOnly', { what: low(line.doing), steps: many('steps', line.steps) })), line.errors ? many('errors', line.errors) : null].filter(Boolean).join(' ');
    const did = line.did.length ? listOf(line.did.map(low)) : t('standup.nothing');
    const head = from ? t('standup.didSince', { from, did, steps: many('steps', line.steps) }).replace(/^./, (c) => c.toLocaleUpperCase()) : t('standup.did', { did, steps: many('steps', line.steps) });
    return [once(head), line.errors ? many('errors', line.errors) : null, line.doing ? once(t('standup.doing', { what: low(line.doing) })) : null].filter(Boolean).join(' ');
  }

  /** The whole daily as text (Markdown): for the terminal, the MCP and the archive. `who(role)`: "Diego (Backend)". */
  static text(r, { name = r.office, who = (role) => role } = {}) {
    const out = [`🗣 ${t('standup.title', { office: name, date: r.date })}${r.from ? ` · ${r.from}` : ''}`];
    if (r.empty) out.push(t('standup.quiet'));
    for (const l of r.lines) out.push(`- **${who(l.role)}**: ${l.text ?? Standup.say(l, r.from)}`);
    if (r.waiting.length) out.push('', t('standup.waitingHead'), ...r.waiting.map((x) => `- ${x}`));
    if (r.open.length) out.push('', t('standup.openHead'), ...r.open.map((x) => `- ${x}`));
    return out.join('\n');
  }

  /** The standup now: the game gathers the team, and its minutes go to the archive. */
  run(officeId, { from = null } = {}) {
    const r = this.report(officeId);
    const name = this.company.info?.(officeId)?.name || officeId;
    const lines = r.lines.map((l) => ({ role: l.role, text: Standup.say(l, r.from) }));
    this.company.ingest('generic', {
      kind: 'standup', session: 'office', office: officeId, text: t('standup.title', { office: name, date: r.date }),
      lines, waiting: r.waiting.slice(0, 3), open: r.open.slice(0, 3),
    });
    let entry = null;
    if (!r.empty && this.archive) {
      const body = [
        ...lines.map((l) => `- **${l.role}**: ${l.text}`),
        r.waiting.length ? `\n${t('standup.waitingHead')}\n${r.waiting.map((x) => `- ${x}`).join('\n')}` : '',
        r.open.length ? `\n${t('standup.openHead')}\n${r.open.map((x) => `- ${x}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
      const out = this.archive.save({ kind: 'minute', title: t('standup.title', { office: name, date: r.date }), body, office: officeId, tags: ['daily'] }, { source: from || t('standup.source') });
      entry = out.ok ? out.entry : null;
    }
    this.store?.setStandupDay?.(officeId, r.date);
    this.store?.setStandupAt?.(officeId, this.now()); // the next one tells what happened from now on
    const text = Standup.text({ ...r, lines }, { name, who: (role) => this.who?.(officeId, role) || role });
    this.emit('done', { ...r, lines, entry });
    const people = Object.fromEntries(lines.map((l) => [l.role, this.who?.(officeId, l.role) || l.role]));
    return { ok: true, ...r, name, lines, people, entry, text };
  }

  /** The company's daily: every department's at once (the ones with nothing to tell say so). */
  runAll(opts = {}) {
    const reports = this.company.ids().map((id) => this.run(id, opts));
    return { ok: true, reports, text: reports.map((r) => r.text).join('\n\n') };
  }

  /** Every few minutes: the offices whose morning came and did not have their standup yet. */
  tick() {
    for (const id of this.company.ids()) {
      const d = zoned(this.now(), this.company.zoneOf?.(id));
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getHours() * 60 + d.getMinutes() < AT || this.store?.getStandupDay?.(id) === today) continue;
      if (this.report(id).empty) { this.store?.setStandupDay?.(id, today); continue; } // nothing to tell: no meeting
      this.run(id);
    }
  }
}
