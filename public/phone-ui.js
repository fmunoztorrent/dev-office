// The expert phone (📞 in the HUD): when the company has experts (⚙ › Characters › Experts), you can call
// one whenever you need them. The dialog lists them with their quick actions and a free text; a call
// dispatches its task to the project agent that knows their skill (POST /v1/experts/:id/run).

import { t } from './i18n.js';
import { drawSprite } from './sprite.js';

const $ = (id) => document.getElementById(id);
const P = (k, v) => t(`ui.phone.${k}`, v);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param getExperts   () => the experts ([{ id, skill, topic, look, actions }])
 * @param personOf     (expert) => the expert's look, to draw their portrait
 */
export function createPhone({ getExperts, personOf }) {
  const dlg = $('phone');
  const list = $('phone-list');
  const note = $('phone-note');

  /** Sends a call: the task goes to the agent of the project that knows the skill. */
  async function call(x, prompt, button) {
    const text = String(prompt || '').trim();
    if (!text) { note.textContent = P('empty'); return; }
    button.disabled = true;
    note.textContent = P('calling', { name: x.look?.name || x.skill });
    let out;
    try { out = await (await fetch(`/v1/experts/${encodeURIComponent(x.id)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text }) })).json(); } catch (err) { out = { ok: false, error: err.message }; }
    button.disabled = false;
    note.textContent = out?.ok ? P('sent', { name: x.look?.name || x.skill }) : out?.error || '✖';
    note.classList.toggle('bad', !out?.ok);
  }

  function card(x) {
    const cfg = personOf(x) || {};
    const box = el('section', 'phone-card');
    const portrait = el('canvas', 'phone-portrait');
    try { drawSprite(portrait, cfg, { P: 3, bg: '#c7d6e6', id: x.id }); } catch { /* no canvas: the name is enough */ }
    const who = el('div', 'phone-who');
    who.append(el('b', '', cfg.name || x.skill), el('span', '', cfg.title || ''), el('small', '', `🎓 ${x.skill}`));
    const head = el('div', 'phone-head');
    head.append(portrait, who);
    box.append(head);
    const actions = el('div', 'phone-actions');
    const ask = el('input', 'phone-input');
    ask.type = 'text';
    ask.placeholder = P('placeholder');
    ask.maxLength = 600;
    const go = el('button', 'btn', P('call'));
    go.type = 'button';
    for (const a of x.actions || []) {
      const b = el('button', 'btn ghost', a.label);
      b.type = 'button';
      b.onclick = () => call(x, a.prompt, b);
      actions.append(b);
    }
    go.onclick = () => call(x, ask.value, go).then(() => { ask.value = ''; });
    ask.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } };
    const row = el('div', 'phone-row');
    row.append(ask, go);
    box.append(actions, row);
    return box;
  }

  function render() {
    const xs = getExperts();
    list.replaceChildren(...(xs.length ? xs.map(card) : [el('p', 'quiet', P('none'))]));
    note.textContent = '';
    note.classList.remove('bad');
  }

  /** The button only shows when there is someone to call. */
  function refresh() {
    $('open-phone').hidden = !getExperts().length;
    if (dlg.open) render();
  }

  function open() {
    if (!getExperts().length) return;
    render();
    if (!dlg.open) dlg.showModal();
  }

  $('open-phone').onclick = open;
  $('phone-close').onclick = () => dlg.close();
  return { open, refresh };
}
