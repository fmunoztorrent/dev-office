// The status card (⏱): every few minutes a small card shows what every agent connected to the office is
// working on, with a timer: how long it stays, and when the next one comes. `pulseRows` (no DOM) builds the
// lines from the sessions and what each one was last seen doing, so it is tested in Node.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const P = (k, v) => t(`ui.pulse.${k}`, v);

export const PULSE_EVERY_MS = 5 * 60_000;  // a new card every 5 minutes
export const PULSE_SHOW_MS = 30_000;       // and it stays 30 seconds (a click closes it before)
export const PULSE_ALIVE_MS = 10 * 60_000; // a session silent for longer than this is not "connected"

const clip = (s, n) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/**
 * The lines of the card: one per connected session (open, and with news in the last 10 minutes).
 * @param sessions  the office's sessions ([{ id, source, cwd, title, status, lastAt, todos }])
 * @param doing     Map session → { text, at }: the last thing each one was seen doing
 * @param agentName (source) => the harness's name
 */
export function pulseRows(sessions, doing, now, agentName = (s) => s) {
  return [...sessions]
    .filter((s) => ['active', 'waiting'].includes(s.status) && now - (s.lastAt || 0) < PULSE_ALIVE_MS)
    .sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || (b.lastAt || 0) - (a.lastAt || 0))
    .map((s) => {
      const todo = (s.todos || []).find((x) => x.status === 'in_progress');
      const seen = doing.get(s.id);
      return {
        id: s.id,
        project: (s.cwd || '').split('/').filter(Boolean).pop() || s.id.slice(0, 8),
        agent: agentName(s.source),
        waiting: s.status === 'waiting',
        text: clip(seen?.text || todo?.content || s.title || '', 90),
        ago: Math.max(0, Math.round((now - (s.lastAt || now)) / 1000)),
      };
    });
}

/** "12 s", "3 min": how long ago something happened. */
export const agoText = (secs) => (secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`);
/** "4:07": a countdown. */
export const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * @param getSessions  () => the sessions
 * @param getDoing     () => Map session → { text, at }
 * @param agentName    (source) => the harness's name
 * @param every/show   the interval and how long the card stays (for the tests)
 */
export function createPulse({ getSessions, getDoing, agentName, every = PULSE_EVERY_MS, show = PULSE_SHOW_MS }) {
  const box = $('pulse');
  let nextAt = Date.now() + every; // when the next card comes
  let hideAt = 0;                  // when this one goes (0: it is hidden)

  function render() {
    const now = Date.now();
    const rows = pulseRows(getSessions(), getDoing(), now, agentName);
    const list = document.createElement('ul');
    list.className = 'pulse-list';
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.waiting) li.className = 'waiting';
      const head = document.createElement('b');
      head.textContent = `${r.waiting ? '✋' : '💻'} ${r.project}`;
      const meta = document.createElement('small');
      meta.textContent = `${r.agent} · ${P('ago', { t: agoText(r.ago) })}`;
      const what = document.createElement('span');
      what.textContent = r.waiting ? P('waiting', { text: r.text }) : r.text || P('thinking');
      li.append(head, meta, what);
      list.append(li);
    }
    $('pulse-body').replaceChildren(list);
    return rows.length;
  }

  function tick() {
    const now = Date.now();
    if (hideAt) {
      const left = hideAt - now;
      if (left <= 0) { hideAt = 0; box.hidden = true; nextAt = now + every; return; }
      $('pulse-timer').textContent = P('closes', { t: clock(left) });
      $('pulse-bar').style.width = `${Math.max(0, (left / show) * 100)}%`;
    } else if (now >= nextAt) {
      if (!render()) { nextAt = now + every; return; } // nobody connected: nothing to report
      hideAt = now + show;
      box.hidden = false;
      tick();
    }
  }

  function dismiss() { hideAt = 0; box.hidden = true; nextAt = Date.now() + every; }
  $('pulse-close').onclick = dismiss;
  setInterval(tick, 1000);
  return { tick, dismiss };
}
