// The services an agent left running in the background (a dev server, a watcher…), in the web
// view: clicking the server rack (or the ▶ chip in the HUD, or `l`) lists them, and a terminal
// follows what the chosen one prints, live, from its log. Inside herdr it also opens in a pane of
// its own (`tail -F`). The office never starts or stops them: the agent does.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const LINES_MAX = 4000; // what the terminal keeps (the rest is in the log)
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}

/**
 * @param getServices  () => the services of the office being watched (they arrive over WebSocket)
 * @param getHerdr     () => herdr's state ({ available })
 * @param who          (role) => the character's name
 * @param hhmm         (ts) => the time, in the office's zone
 */
export function createServices({ getServices = () => [], getHerdr = () => ({}), who = () => '', hhmm = (ts) => new Date(ts).toLocaleTimeString() }) {
  const st = { id: null, offset: undefined, timer: null, seq: 0 };
  const S = (k, v) => t(`services.${k}`, v);
  const dialog = $('services');

  $('svc-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { clearTimeout(st.timer); st.id = null; });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // outside the card
  $('svc-pane').onclick = openPane;

  /** Opens the list; with `id`, that service's terminal (by default, the newest one running). */
  function open(id) {
    if (!dialog.open) dialog.showModal();
    render();
    const list = getServices();
    const pick = list.find((s) => s.id === id) || list.find((s) => s.id === st.id) || list.find((s) => s.status === 'running') || list[0];
    if (pick) choose(pick.id); else showTerm(null);
  }

  /** The list changed (it came over WebSocket): it is redrawn if it is open. */
  function refresh() {
    if (!dialog.open) return;
    render();
    const s = getServices().find((x) => x.id === st.id);
    if (st.id && !s) open(); else if (s) head(s);
  }

  function render() {
    const list = getServices();
    $('svc-empty').hidden = list.length > 0;
    $('svc-list').replaceChildren(...list.map((s) => el('li', { class: `svc ${s.status}` },
      el('button', { type: 'button', class: 'svc-pick', 'aria-pressed': String(s.id === st.id), onclick: () => choose(s.id) },
        el('span', { class: 'svc-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'svc-main' },
          el('b', {}, s.name || s.command),
          el('span', { class: 'svc-meta' }, [
            who(s.role), s.agent,
            s.status === 'running' ? S('since', { time: hhmm(s.startedAt) }) : S('stopped', { time: hhmm(s.endedAt) }),
            tilde(s.cwd),
          ].filter(Boolean).join(' · '))))),
    ));
  }

  function choose(id) {
    const s = getServices().find((x) => x.id === id);
    if (!s) return;
    if (st.id !== id) { st.id = id; st.offset = undefined; st.placeholder = false; $('svc-out').textContent = ''; }
    render();
    showTerm(s);
    poll();
  }

  function head(s) {
    $('svc-term-name').textContent = s.name || s.command;
    $('svc-term-state').textContent = s.status === 'running'
      ? `● ${S('running')}${s.pids?.length ? ` · pid ${s.pids[0]}` : ''}`
      : `○ ${S('stopped', { time: hhmm(s.endedAt) })}`;
    $('svc-term').classList.toggle('ended', s.status !== 'running');
    $('svc-pane').hidden = !getHerdr()?.available || !s.log;
    $('svc-cmd').textContent = `$ ${s.command}`;
  }

  function showTerm(s) {
    $('svc-term').hidden = !s;
    if (s) head(s);
    $('svc-msg').textContent = '';
  }

  /** What the chosen service printed since the last time (every second, while it is open). */
  async function poll() {
    clearTimeout(st.timer);
    const id = st.id, n = ++st.seq;
    if (!dialog.open || !id) return;
    try {
      const q = st.offset === undefined ? '' : `?from=${st.offset}`;
      const r = await (await fetch(`/v1/services/${encodeURIComponent(id)}/log${q}`)).json();
      if (n !== st.seq || id !== st.id) return;
      if (r.ok) {
        const out = $('svc-out');
        const atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 24;
        if (r.reset) out.textContent = '';
        if (r.text) {
          if (st.placeholder) { out.textContent = ''; st.placeholder = false; }
          out.textContent += r.text;
          const lines = out.textContent.split('\n');
          if (lines.length > LINES_MAX) out.textContent = lines.slice(-LINES_MAX).join('\n');
        } else if (!out.textContent) {
          out.textContent = r.missing ? S('noLog') : S('waiting');
          st.placeholder = true;
        }
        st.offset = r.offset;
        if (atEnd) out.scrollTop = out.scrollHeight;
      }
    } catch { /* the office is restarting: it tries again */ }
    st.timer = setTimeout(poll, 1000);
  }

  async function openPane() {
    if (!st.id) return;
    const r = await fetch(`/v1/services/${encodeURIComponent(st.id)}/terminal`, { method: 'POST' }).then((x) => x.json()).catch((err) => ({ ok: false, error: err.message }));
    $('svc-msg').textContent = r.ok ? S('paneOpened', { pane: r.pane }) : r.error || '';
  }

  return { open, refresh, get isOpen() { return dialog.open; } };
}
