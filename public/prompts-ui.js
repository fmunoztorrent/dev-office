// What the agents are asking you on their screens (a permission, a question, a choice), in the web
// view. The ✋ chip in the HUD (or `r`, or clicking the PO, which is you, or the manager with his
// hand up) opens them, and each option is a button. Answering presses the same keys you would in
// the agent's herdr pane (server/prompts.js). Outside herdr the office cannot see those screens.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return e;
}

/**
 * @param getPrompts  () => the questions of the office being watched (they arrive over WebSocket)
 * @param answer      (id, { rev, option } | { rev, cancel: true }) => Promise<{ ok, answer?, error? }>
 * @param agentName   (harness) => its name (Claude, Pi…)
 */
export function createPrompts({ getPrompts = () => [], answer, agentName = (a) => a || '' }) {
  const P = (k, v) => t(`prompts.${k}`, v);
  const dialog = $('agent-ask');
  const st = { busy: false, closing: null };

  $('pr-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // outside the card
  // 1-9: the first question's options
  dialog.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const p = getPrompts()[0];
    if (p && Number(e.key) <= p.options.length) { e.preventDefault(); pick(p, { option: Number(e.key) - 1 }); }
  });

  function open() {
    if (!getPrompts().length) return false;
    clearTimeout(st.closing);
    $('pr-msg').textContent = '';
    if (!dialog.open) dialog.showModal();
    render();
    dialog.querySelector('.pr-opt')?.focus();
    return true;
  }

  /** The list changed (it came over WebSocket): it is redrawn if it is open. */
  function refresh() {
    if (!dialog.open) return;
    render();
    if (!getPrompts().length && !st.busy) {
      clearTimeout(st.closing);
      st.closing = setTimeout(() => { if (!getPrompts().length) dialog.close(); }, 1600);
    }
  }

  function render() {
    const list = getPrompts();
    $('pr-empty').hidden = list.length > 0;
    $('pr-list').replaceChildren(...list.map((p) => el('section', { class: 'pr-card', 'data-id': p.id },
      el('header', { class: 'pr-who' },
        el('b', {}, P('asks', { agent: agentName(p.agent) || P('theAgent') })),
        el('span', { class: 'pr-where' }, [p.project, p.pane && P('pane', { pane: p.pane })].filter(Boolean).join(' · '))),
      p.question ? el('pre', { class: 'pr-q' }, p.question) : null,
      el('div', { class: 'pr-opts', role: 'group', 'aria-label': P('options') },
        p.options.map((o, i) => el('button', { type: 'button', class: 'pr-opt', 'aria-current': i === p.cursor ? 'true' : null, disabled: st.busy, onclick: () => pick(p, { option: i }) },
          el('kbd', {}, String(i + 1)),
          el('span', { class: 'pr-label' }, o.label),
          o.detail ? el('span', { class: 'pr-detail' }, o.detail) : null))),
      el('div', { class: 'pr-foot' },
        el('button', { type: 'button', class: 'pr-cancel', disabled: st.busy, onclick: () => pick(p, { cancel: true }) }, P('cancel')),
        el('span', { class: 'pr-hint' }, P('hint'))),
    )));
  }

  async function pick(p, choice) {
    if (st.busy) return;
    st.busy = true;
    render();
    $('pr-msg').textContent = P('sending');
    const r = await answer(p.id, { rev: p.rev, ...choice }).catch((err) => ({ ok: false, error: err.message }));
    st.busy = false;
    $('pr-msg').textContent = r.ok ? (r.answer ? P('sent', { answer: r.answer }) : P('cancelledMsg')) : r.error || P('failed');
    render();
    refresh();
  }

  return { open, refresh, get isOpen() { return dialog.open; } };
}
