// The daily standup: every morning (from 9:30 in each office's time zone, the first time the office
// is running that day and something happened the day before) the team gathers at the meeting table
// and each character tells what their agent did, from the real log: what they worked on, how many
// steps, what went wrong; then what is waiting for you and what is still open. It is the office's own
// summary (no model is asked); its minutes go to the archive. It can also be called at any time.
//
//   report(officeId) → { office, date, lines: [{ role, did, steps, errors }], waiting, open, empty }
//   run(officeId)    → emits the 'standup' event (the game gathers them) and saves the minutes

import { EventEmitter } from 'node:events';
import { t, listOf } from '../public/i18n.js';
import { clip } from './roles.js';
import { zoned } from '../public/clock.js';

const DAY = 24 * 3600_000;
const AT = 9 * 60 + 30; // 9:30, the office's time
const WORK = new Set(['tool_start', 'phase', 'subagent_start', 'done', 'turn_end']);
const ORDER = ['analyst', 'designer', 'tl', 'backend', 'frontend', 'qa', 'devops', 'security', 'manager']; // the visiting specialists tell theirs too

export class Standup extends EventEmitter {
  /**
   * @param company  the offices (their log and sessions)
   * @param archive  where the minutes go
   * @param store    which day each office already had its standup (settings)
   * @param hub      the tasks still running
   */
  constructor({ company, archive, store, hub, clarify, now = () => Date.now(), every = 5 * 60_000 } = {}) {
    super();
    Object.assign(this, { company, archive, store, hub, clarify, now });
    if (every) { this.timer = setInterval(() => this.tick(), every); this.timer.unref?.(); }
  }

  stop() { clearInterval(this.timer); }

  /** What happened in an office in the last 24 hours, said by each character. */
  report(officeId) {
    const office = this.company.get(officeId);
    const since = this.now() - DAY;
    const log = (office?.log || []).filter((e) => e.ts >= since && e.role && e.role !== 'po' && e.session !== 'office');
    const lines = [];
    for (const role of ORDER) {
      const mine = log.filter((e) => e.role === role);
      if (!mine.some((e) => WORK.has(e.kind))) continue;
      const steps = mine.filter((e) => e.kind === 'tool_start').length;
      const errors = mine.filter((e) => (e.kind === 'tool_end' && e.ok === false && e.phase !== 'red') || e.kind === 'error').length;
      // what they worked on: the latest distinct things they did, in words
      const did = [...new Set(mine.filter((e) => ['tool_start', 'phase', 'subagent_start'].includes(e.kind) && e.text).map((e) => clip(e.text, 60)).reverse())].slice(0, 3).reverse();
      lines.push({ role, did, steps, errors });
    }
    const sessions = [...(office?.sessions?.values() || [])].filter((s) => s.id !== 'office');
    const waiting = sessions.filter((s) => s.status === 'waiting').map((s) => clip(s.waiting?.text || s.title || '', 80)).filter(Boolean)
      .concat((this.clarify?.list(officeId) || []).filter((c) => c.status === 'asking').map((c) => clip(c.text, 80)));
    const open = [...(this.hub?.tasks?.values() || [])].filter((x) => (x.office || 'main') === officeId && ['queued', 'sent', 'running'].includes(x.status)).map((x) => clip(x.title || x.text, 80));
    const zone = this.company.zoneOf?.(officeId);
    const d = zoned(this.now(), zone);
    return { office: officeId, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, lines, waiting, open, empty: !lines.length };
  }

  /** What each character says at the table (in the game's language). */
  static say(line) {
    const did = line.did.length ? listOf(line.did.map((x) => x.replace(/^./, (c) => c.toLocaleLowerCase()))) : t('standup.nothing');
    const many = (key, n) => t(`standup.${key}.${n === 1 ? 'one' : 'other'}`, { n });
    return [t('standup.did', { did, steps: many('steps', line.steps) }), line.errors ? many('errors', line.errors) : null].filter(Boolean).join(' ');
  }

  /** The standup now: the game gathers the team, and its minutes go to the archive. */
  run(officeId, { from = null } = {}) {
    const r = this.report(officeId);
    const name = this.company.info?.(officeId)?.name || officeId;
    const lines = r.lines.map((l) => ({ role: l.role, text: Standup.say(l) }));
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
    this.emit('done', { ...r, lines, entry });
    return { ok: true, ...r, lines, entry };
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
