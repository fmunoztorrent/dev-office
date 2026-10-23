// The "brief" put together when clicking the whiteboard: which agent it goes to, through which entry
// of its harness (its pipeline, a command, the prompt as is), in which session, and the prompt. Shared
// by the web view and the terminal.
//
// The office is the frontend: the agents are the ones registered in ⚙ › Agents (a full path) plus
// the open sessions, and what each one offers comes from its own harness.

import { AGENT_NAME } from './targets.js';
import { t } from './i18n.js';

const tr = t; // targetLabel uses `t` for the agent

const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() || p : '');
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

/** Default agent: the one from the most recent session, otherwise the first registered one. */
export function defaultTarget(targets, sessions) {
  const recent = [...sessions].sort((a, b) => b.lastAt - a.lastAt).find((s) => targets.some((t) => t.sessions.some((x) => x.session === s.id)));
  if (recent) return targets.findIndex((t) => t.sessions.some((x) => x.session === recent.id));
  return 0;
}

/**
 * The dialog's options for what has been chosen.
 * @param sel { target, entry, session } indexes (session -1 = the usual one: an open one, otherwise a new one)
 */
export function briefOptions({ targets = [] }, sel) {
  const target = targets[sel.target] || null;
  const entries = target?.entries || [];
  const entry = entries[sel.entry] || entries[0] || null;
  const sessions = [
    ...(target?.sessions || []),
    ...(target?.registered ? [{ session: null, live: false, label: t('brief.newSession', { agent: AGENT_NAME[target.harness] || target.harness, dir: base(target.path) }) }] : []),
  ];
  let index = sel.session ?? -1;
  if (index < 0 || index >= sessions.length) {
    index = sessions.findIndex((s) => s.live);
    if (index < 0) index = sessions.findIndex((s) => s.session === null);
    if (index < 0) index = 0;
  }
  return { target, entries, entry, sessions, sessionIndex: index, session: sessions[index] || null, stages: entry?.stages || [] };
}

/** What is missing before it can be sent (or null if it is ready). */
export function briefProblem(opts, text) {
  if (!opts.target) return t('brief.pRegister');
  if (!String(text || '').trim()) return t('brief.pWrite');
  if (!opts.target.exists && !opts.session?.session) return t('brief.pNoPath', { path: tilde(opts.target.path) });
  if (opts.entry?.issues?.some((i) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido|cycle|does not exist|no stages|same id|unknown role/.test(i))) return t('brief.pIssues', { issue: opts.entry.issues[0] });
  if (opts.entry?.needsSession && !opts.session?.session) return t('brief.pNeedsSession', { label: opts.entry.label, agent: AGENT_NAME[opts.target.harness] || opts.target.harness, path: tilde(opts.target.path) });
  if (opts.session && opts.session.session === null && !opts.target.available) return t('brief.pNotInstalled', { agent: AGENT_NAME[opts.target.harness] || opts.target.harness });
  return null;
}

/** The WebSocket message that fires the brief. */
export function briefMessage(opts, text, from) {
  return { type: 'run', target: opts.target.id, entry: opts.entry?.id || 'prompt', session: opts.session?.session ?? null, text: String(text).trim(), from };
}

export const targetLabel = (t) => (t
  ? `${t.name} · ${AGENT_NAME[t.harness] || t.harness}${t.kinds?.length ? ` · ${t.kinds.join(' + ')}` : ''}${t.sessions?.some((s) => s.live) ? ` · ${tr('brief.open')}` : ''}${t.registered ? '' : ` ${tr('brief.unregistered')}`} — ${tilde(t.path)}`
  : '');

/** The dialog's fields, in order (the terminal navigates through them). */
export function briefFields() {
  return ['target', 'entry', 'session', 'task'];
}

/** Changes a field's option (delta ±1) and resets what depends on it. */
export function briefCycle(sel, field, delta, { targets, opts }) {
  const wrap = (i, n) => (n ? (i + delta + n) % n : 0);
  if (field === 'target') return { target: wrap(sel.target, targets.length), entry: 0, session: -1 };
  if (field === 'entry') return { ...sel, entry: wrap(opts.entries.indexOf(opts.entry), opts.entries.length) };
  if (field === 'session') return { ...sel, session: wrap(opts.sessionIndex, opts.sessions.length) };
  return sel;
}
