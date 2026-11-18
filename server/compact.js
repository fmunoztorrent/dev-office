// Auto-compaction: when an agent's context goes past your threshold (⚙ › Context: 400k tokens by
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

import fs from 'node:fs';
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

// the variables Claude Code reads its auto-compaction threshold from, and the office's mark next to them
const CLAUDE_KEYS = ['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'];
const CLAUDE_MARK = 'DEV_TEAM_OFFICE_COMPACT';

/**
 * Your threshold in Claude Code's own settings (~/.claude/settings.json → env), so every Claude Code
 * compacts where you said: the ones you open by hand too, and their subagents (Claude Code compacts a
 * subagent with the same rule as its conversation). Only our two variables, marked as ours: one you set
 * yourself is left as it is. Off: ours are removed. The file is never created: without it, nothing.
 * @returns 'set' | 'removed' | 'same' | 'yours' | 'none'
 */
export function syncClaudeCompact(file, prefs) {
  if (!file) return 'none';
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 'none'; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'none';
  const env = data.env && typeof data.env === 'object' && !Array.isArray(data.env) ? { ...data.env } : {};
  const ours = env[CLAUDE_MARK] === '1';
  if (!ours && CLAUDE_KEYS.some((k) => k in env)) return 'yours';
  for (const k of [...CLAUDE_KEYS, CLAUDE_MARK]) delete env[k];
  const want = claudeCompactEnv(prefs);
  if (Object.keys(want).length) Object.assign(env, want, { [CLAUDE_MARK]: '1' });
  const before = JSON.stringify(data.env || {});
  const next = { ...data };
  if (Object.keys(env).length) next.env = env; else delete next.env;
  if (JSON.stringify(next.env || {}) === before) return 'same';
  try { fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`); } catch { return 'none'; }
  return Object.keys(want).length ? 'set' : 'removed';
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
