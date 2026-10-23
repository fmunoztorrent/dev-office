// Inside herdr, each subagent shows up in its own pane. When an agent launches a subagent
// (gentle-pi, Claude Code's Task, OpenCode's…), the office opens a pane below the agent's with
// `dev-team-office follow`: what that subagent is doing (its tools, its commands' output, its
// phase) and, at the end, its report. The ones running at the same time sit side by side. The
// subagent is still run by its harness: the pane shows it, it does not run it.
//
// The pane closes by itself once the subagent finished and stopped reporting (a few seconds later,
// so you can read how it ended). If the agent is not running in herdr, the panes open below the
// office's.

import { clip } from './roles.js';
import { quote } from './herdr.js';

export const ROLE_ICON = { designer: '🎨', po: '📝', analyst: '📊', manager: '📋', frontend: '🖥️', backend: '⚙️', qa: '🧪', tl: '🧭' };

export class SubPanes {
  /**
   * @param herdr    server/herdr.js
   * @param company  the offices: each session's pane, to open the subagent's below it
   * @param command  the command that runs in the pane, without its arguments: [node, …/dev-team-office.js]
   * @param env      () => the pane's environment (the office URL)
   * @param enabled  () => is it on? (⚙ › herdr › Each subagent in its pane)
   * @param who      (office, role) => the character's name (for the pane title)
   * @param linger   how long it stays open after the subagent stopped reporting (ms)
   */
  constructor({ herdr, company, command, env = () => ({}), enabled = () => true, who = () => '', linger = 8000, every = 2000, stale = 30 * 60_000, log = () => {} }) {
    Object.assign(this, { herdr, company, command, env, enabled, who, linger, stale, log });
    this.open = new Map(); // `${session}\n${subId}` → { pane, office, session, subId, role, parent, endedAt, lastAt, opening }
    this.queue = Promise.resolve();
    this.timer = setInterval(() => this.sweep(), every);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }

  /** Each office event: a subagent that starts opens its pane; what it does keeps it alive. */
  onEvent(office, ev) {
    if (!ev?.session) return;
    if (ev.kind === 'session_end') {
      for (const e of this.open.values()) if (e.session === ev.session && !e.endedAt) e.endedAt = e.lastAt = Date.now();
      return;
    }
    if (!ev.subId) return;
    const key = `${ev.session}\n${ev.subId}`;
    const e = this.open.get(key);
    if (e) {
      e.lastAt = Date.now();
      if (ev.kind === 'subagent_end') e.endedAt = e.lastAt;
      return;
    }
    if (ev.kind !== 'subagent_start' || !this.herdr?.available || !this.enabled()) return;
    const entry = { pane: null, office, session: ev.session, subId: ev.subId, role: ev.role, parent: null, endedAt: 0, lastAt: Date.now() };
    this.open.set(key, entry);
    // one at a time: so one that starts at the same time as another already knows where the previous one went
    const run = this.queue.then(() => this.#launch(entry, ev));
    this.queue = run.catch(() => {});
    entry.opening = run.catch((err) => {
      this.open.delete(key);
      this.log(`herdr: ${err.message}`);
    });
  }

  async #launch(entry, ev) {
    const parent = this.company.paneOfSession?.(ev.session) || this.herdr.pane;
    // the ones already open for the same agent: the new one goes next to them; the first one, below the agent
    const siblings = [...this.open.values()].filter((x) => x !== entry && x.pane && x.parent === parent && !x.closing);
    const name = this.who(entry.office, ev.role);
    const title = `${ROLE_ICON[ev.role] || '🤖'} ${name ? `${name} · ` : ''}${ev.text || ev.agentType || ev.subId}`;
    const command = [...this.command, 'follow', '--session', ev.session, '--sub', ev.subId, '--office', entry.office].map(quote).join(' ');
    const base = { command, env: this.env(), office: entry.office, role: ev.role, title: clip(title, 60), kind: 'sub', session: ev.session, subId: ev.subId };
    const tries = siblings.length ? [{ from: siblings.at(-1).pane, direction: 'right' }] : [];
    tries.push({ from: parent, direction: 'down', ratio: 0.4 });
    if (parent !== this.herdr.pane) tries.push({ from: this.herdr.pane, direction: 'down', ratio: 0.4 }); // the agent's pane is gone
    let last;
    for (const where of tries) {
      try {
        const { pane } = await this.herdr.launchCommand({ ...base, ...where });
        entry.pane = pane;
        entry.parent = parent;
        return pane;
      } catch (err) { last = err; }
    }
    throw last;
  }

  /** Closes the panes of subagents that already finished (or have not reported for a long time). */
  async sweep(now = Date.now()) {
    for (const [key, e] of this.open) {
      if (!e.pane || e.closing) continue;
      const done = e.endedAt && now - e.lastAt >= this.linger;
      if (!done && now - e.lastAt < this.stale) continue;
      e.closing = true;
      this.open.delete(key);
      await this.herdr.closePane(e.pane).catch(() => {});
    }
  }

  /** The user closed the pane by hand. */
  forget(pane) {
    for (const [key, e] of this.open) if (e.pane === pane) this.open.delete(key);
  }

  list() { return [...this.open.values()].map(({ opening, ...e }) => e); }
}
