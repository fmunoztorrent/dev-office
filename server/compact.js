// Auto-compaction: when an agent's context goes past your threshold (⚙ › General: 400k tokens by
// default, or a share of its model's window), the office asks the agent to compact it. The agent does it
// (the office never touches a conversation), each one its own way:
//
//   - Pi and OpenCode connected to the office (their extension says it `can` compact): they get
//     { type: 'compact' } and compact when they are free (ctx.compact, session.summarize).
//   - Any other agent in a herdr pane (Claude Code, Codex…): when its turn ends, `/compact` in its prompt.
//   - Otherwise (Claude Code in a terminal of its own): the log says so, once, for you to type /compact.
//
// And the Claude Code sessions the office opens get the threshold as their own
// (CLAUDE_CODE_AUTO_COMPACT_WINDOW or CLAUDE_AUTOCOMPACT_PCT_OVERRIDE): they compact by themselves.

import { t } from '../public/i18n.js';
import { thresholdOf, kTokens } from '../public/compact.js';

export { thresholdOf, kTokens };

// asked and not compacted yet: it is asked again after this long (the agent may not have been able to)
const RETRY_MS = 10 * 60_000;
// what an agent does when it works (after these it is not free until its turn ends)
const WORK = new Set(['task', 'thinking', 'tool_start', 'tool_end', 'subagent_start', 'waiting', 'phase']);

/** The environment that gives a Claude Code the office opens your threshold as its own. */
export function claudeCompactEnv(prefs) {
  const c = prefs?.compact;
  if (!c?.auto) return {};
  return c.unit === 'pct' ? { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: String(c.at) } : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(c.at) };
}

export class Compactor {
  /**
   * @param prefs    () => the settings (compact: { auto, at, unit })
   * @param hub      server/tasks.js: the agents connected to the office (and what they can do)
   * @param herdr    server/herdr.js (or null): the agents' panes
   * @param company  server/company.js: which pane each session runs in, and the log
   */
  constructor({ prefs, hub, herdr = null, company }) {
    this.prefs = prefs;
    this.hub = hub;
    this.herdr = herdr;
    this.company = company;
    this.sessions = new Map(); // session → { idle, asked }
  }

  /** Each event of each office: is that session's context past the threshold, and can it compact now? */
  onEvent(office, ev, session) {
    if (!session?.id || session.id === 'office' || ev.subId) return null;
    let st = this.sessions.get(session.id);
    if (!st) {
      st = { idle: false, asked: 0 };
      this.sessions.set(session.id, st);
      if (this.sessions.size > 200) this.sessions.delete(this.sessions.keys().next().value);
    }
    if (ev.kind === 'compact') { st.asked = 0; return null; } // it compacted (by itself or because it was asked)
    if (ev.kind === 'turn_end' || ev.kind === 'done') st.idle = true;
    else if (WORK.has(ev.kind)) st.idle = false;
    const ctx = session.context;
    const at = thresholdOf(this.prefs(), ctx);
    if (!at || ctx.compacted) return null;
    if (ctx.used < at) { st.asked = 0; return null; }
    if (st.asked && Date.now() - st.asked < RETRY_MS) return null;
    return this.#ask(office, session, st, { used: ctx.used, at });
  }

  #ask(office, session, st, { used, at }) {
    const conn = this.hub.liveAgents().find((c) => c.sessions.has(session.id) && c.can.includes('compact'));
    const pane = !conn && this.herdr?.available ? this.company.paneOfSession?.(session.id) : null;
    let via;
    if (conn) {
      conn.send({ type: 'compact', session: session.id, used, at });
      via = 'agent';
    } else if (!st.idle) {
      return null; // in a pane or by hand, only when its turn ends (never in the middle of an answer)
    } else if (pane) {
      this.herdr.prompt(pane, '/compact').catch(() => {}); // herdr types it in its prompt
      via = 'pane';
    } else via = 'manual';
    // by hand it is said once, until it goes below the threshold or compacts
    st.asked = via === 'manual' ? Number.MAX_SAFE_INTEGER - RETRY_MS : Date.now();
    this.company.ingest('generic', { session: session.id, office, kind: 'autocompact', via, text: t(`events.autocompact.${via}`, { used: kTokens(used), at: kTokens(at) }) });
    return via;
  }
}
