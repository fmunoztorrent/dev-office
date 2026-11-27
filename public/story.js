// The activity told as a story: what the agents do, the way a person would tell it. Each tool an
// agent uses becomes a verb ("reads", "searches the code", "runs the tests"), and the verbs of one
// person in a stretch of work go in one line that grows ("Diego reads 3 files and searches the code")
// instead of one line per command. Commands, patterns and tool names stay in the line's details (its
// tooltip): the terminal is where to read them. No DOM here: the browser and the tests use it alike.

import { t } from './i18n.js';

// A browser the agent drives (to look at the page it is building).
const BROWSER = /^mcp__(claude[-_]?browser|claude[-_]in[-_]chrome|playwright|puppeteer|chrome[-_]devtools|browser)/i;
// The badge's icon (server/humanize.js, badgeFor) says what kind of thing it was.
const ICON_VERB = {
  '📖': 'read', '✏️': 'edit', '🔍': 'search', '🧪': 'tests', '💾': 'commit', '🚀': 'push', '⬇️': 'pull', '🔀': 'git', '🌿': 'git',
  '🐙': 'github', '📦': 'deps', '▶️': 'run', '🔨': 'build', '🧹': 'lint', '🌐': 'web', '🐳': 'containers', '🗂': 'files',
  '🛰': 'remote', '⌨️': 'shell', '📋': 'plan', '👥': 'team', '🔌': 'tool', '🛠': 'tool', '🧰': 'mine',
};
// Verbs counted by the different things they touch (3 files), not by how many times.
const BY_THING = new Set(['read', 'edit']);
// Verbs said with how many times when they happen more than once.
const COUNTED = new Set(['read', 'edit', 'search', 'tests', 'team', 'tool', 'trip']);
const MAX_VERBS = 4;

/** What kind of thing a tool event was (a verb of the story), or null if it is not a tool. */
export function verbOf(ev) {
  if (!ev || (ev.kind !== 'tool_start' && ev.kind !== 'tool_end')) return null;
  const tool = String(ev.tool || '');
  if (BROWSER.test(tool)) return 'browser';
  if (ev.badge && ev.badge === t('badge.ask')) return 'ask';
  const icon = String(ev.badge || '').split(' ')[0];
  return ICON_VERB[icon] || 'tool';
}

/** The thing a badge names (📖 cart.js → cart.js), to count different files. */
const thingOf = (ev) => String(ev.badge || '').split(' ').slice(1).join(' ').trim();
/** A commit's message, from what the agent is doing («fix the cart»). */
const messageOf = (text) => String(text || '').match(/[«"“]([^»"”]+)[»"”]/)?.[1] || '';

/** One verb said in words: "reads 3 files", "runs the tests", "saves the changes: «fix the cart»". */
export function phrase(verb, { n = 1, things = 0, msg = '', name = '' } = {}) {
  const count = BY_THING.has(verb) ? Math.max(things, 1) : n;
  if (verb === 'commit' && msg) return t('story.commitMsg', { msg: msg.length > 50 ? `${msg.slice(0, 49)}…` : msg });
  if (verb === 'mine' && name) return t('story.mineName', { name });
  if (COUNTED.has(verb) && count > 1) return t(`story.${verb}N`, { n: count });
  return t(`story.${verb}`);
}

/** The verbs of a line, joined the way one says a list ("reads 3 files, searches the code and runs the tests"). */
export function sentence(verbs) {
  const parts = [...verbs].map(([verb, v]) => phrase(verb, { n: v.n, things: v.things.size, msg: v.msg, name: v.name }));
  const shown = parts.length > MAX_VERBS ? [...parts.slice(0, MAX_VERBS - 1), t('story.more', { n: parts.length - MAX_VERBS + 1 })] : parts;
  if (shown.length < 2) return shown[0] || '';
  return t('narrate.list', { first: shown.slice(0, -1).join(', '), last: shown.at(-1) });
}

/**
 * The story so far. `tell(ev)` takes an event of the log and says what to do with it:
 *   null              it is not a tool: the log shows it as always;
 *   { skip: true }    nothing to tell (a tool that ended well: its start already told it);
 *   { line, isNew }   the story line it went into: a new one, or one that grew.
 * `mark()` says another line went into the log (a line far up does not grow any more).
 */
export function createStory({ recentMs = 3 * 60_000, reach = 6, keep = 200 } = {}) {
  let seq = 0;
  const lines = [];
  const open = new Map(); // who → their latest line

  function tell(ev) {
    const verb = verbOf(ev);
    if (!verb) return null;
    const failed = ev.kind === 'tool_end' && ev.ok === false;
    if (ev.kind === 'tool_end' && !failed) return { skip: true };
    const who = ev.subId ? `sub:${ev.subId}` : `${ev.session || ''}:${ev.role || ''}`;
    const ts = ev.ts || Date.now();
    let line = open.get(who);
    const isNew = !line || ts - line.ts > recentMs || seq - line.seq > reach;
    if (isNew) {
      line = { id: ++seq, seq, who, role: ev.role || null, subId: ev.subId || null, session: ev.session || null, first: ts, ts, verbs: new Map(), details: [], trips: 0 };
      open.set(who, line);
      lines.push(line);
      while (lines.length > keep) lines.shift();
    }
    line.ts = ts;
    const key = failed ? 'trip' : verb;
    const v = line.verbs.get(key) || { n: 0, things: new Set(), msg: '', name: '' };
    v.n++;
    const thing = thingOf(ev);
    if (thing && !failed) v.things.add(thing);
    if (key === 'commit') v.msg = messageOf(ev.text) || v.msg;
    if (key === 'mine') v.name = thing.replace(/…$/, '') || v.name;
    line.verbs.set(key, v);
    if (failed) line.trips++;
    const detail = String(ev.text || '').trim();
    if (detail && line.details.at(-1) !== detail) { line.details.push(failed ? `✖ ${detail}` : detail); if (line.details.length > 12) line.details.shift(); }
    line.text = sentence(line.verbs);
    return { line, isNew };
  }

  return {
    tell,
    mark() { seq++; },
    /** The latest lines of one person (their role's character, or a newcomer by its subagent), newest first. */
    recent({ role, subId } = {}, n = 4) {
      return lines.filter((l) => (subId ? l.subId === subId : l.role === role && !l.subId)).slice(-n).reverse();
    },
    clear() { lines.length = 0; open.clear(); },
  };
}
