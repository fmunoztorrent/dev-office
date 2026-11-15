// The projects' loops in the web view (server/loops.js): the 🔁 chip in the HUD (or `i`, or 🔁 in the
// work dialog) lists the loops of the office being watched. Each one shows its steps, which one is going,
// how each success criterion is (✅ met, ❌ not, ❔ not reported: you can mark it), whether its project is
// working or idle and when it looks next. A loop is created and changed here: its project, its interval
// (5 min by default), its tries per step, the criteria every step has and each step with its own.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const L = (k, v) => t(`loop.ui.${k}`, v);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}

const STEP_ICON = { pending: '⏳', working: '🔄', done: '✅', blocked: '✋', skipped: '⏭' };
const ACTIVITY_ICON = { idle: '💤', working: '💻', waiting: '✋' };
const mark = (r) => (r?.met === true ? '✅' : r?.met === false ? '❌' : '❔');

/** A criterion as a line of the form: «text :: command that checks it». */
export const criterionLine = (c) => (c.check ? `${c.text} :: ${c.check}` : c.text);
/** Lines → criteria; the ones with the same text as before keep their id (and how they were going). */
export function linesToCriteria(text, before = []) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [txt, ...rest] = l.split(' :: ');
    const check = rest.join(' :: ').trim();
    const was = before.find((c) => c.text === txt.trim());
    return { ...(was ? { id: was.id } : {}), text: txt.trim(), ...(check ? { check } : {}) };
  });
}

/**
 * @param getLoops     () => every loop (they arrive over WebSocket)
 * @param getProjects  () => the registered projects of the office being watched ([{ id, name }])
 * @param office       () => the office being watched (its id)
 */
export function createLoops({ getLoops = () => [], getProjects = () => [], office = () => 'main' }) {
  const dialog = $('loops');
  const st = { id: null, editing: null };
  const api = (method, path, body) => fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: L('offline') }));
  const say = (text, bad = false) => { $('lp-msg').textContent = text || ''; $('lp-msg').classList.toggle('muted', !bad); };
  const mine = () => getLoops().filter((l) => (l.office || 'main') === office());

  $('lp-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('lp-new').onclick = () => edit(null);
  // the next look's countdown moves on its own
  let timer = null;
  dialog.addEventListener('close', () => { clearInterval(timer); timer = null; st.editing = null; });

  function open(id) {
    if (!dialog.open) dialog.showModal();
    st.id = id || st.id || mine()[0]?.id || null;
    st.editing = null;
    say('');
    if (!mine().length) return edit(null);
    render();
    timer ??= setInterval(() => { if (!st.editing) render(); }, 1000);
  }

  /** The loops changed (over WebSocket): redrawn, unless you are writing in the form. */
  function refresh() { if (dialog.open && !st.editing) render(); }

  function render() {
    const list = mine();
    if (!list.some((l) => l.id === st.id)) st.id = list[0]?.id || null;
    $('lp-list').replaceChildren(...list.map((l) => el('li', {},
      el('button', { type: 'button', class: `lp-pick ${l.status}`, 'aria-pressed': String(l.id === st.id), onclick: () => { st.id = l.id; st.editing = null; render(); } },
        el('b', {}, `🔁 ${l.name}`), el('small', {}, `${l.project || '?'} · ${t(`loopStatus.${l.status}`)}`)))));
    const l = list.find((x) => x.id === st.id);
    $('lp-detail').replaceChildren(l ? view(l) : el('p', { class: 'fl-dim' }, L('empty')));
  }

  const act = (path, body) => async () => {
    const r = await api('POST', path, body ?? {});
    say(r.ok ? '' : r.error, !r.ok);
  };
  const next = (l) => {
    if (l.status !== 'running' || !l.nextTick) return '';
    const s = Math.max(0, Math.round((l.nextTick - Date.now()) / 1000));
    return s ? L('nextIn', { t: s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s` }) : L('nextNow');
  };

  function view(l) {
    const base = `/v1/loops/${encodeURIComponent(l.id)}`;
    const running = l.status === 'running';
    const add = (placeholder, onAdd) => {
      const input = el('input', { type: 'text', maxlength: '300', placeholder, 'aria-label': placeholder });
      const go = async () => { const v = input.value.trim(); if (!v) return; const r = await onAdd(v); if (r.ok) input.value = ''; say(r.ok ? '' : r.error, !r.ok); };
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      return el('div', { class: 'lp-add' }, input, el('button', { type: 'button', class: 's-mini', onclick: go }, '＋'));
    };
    const crit = (c, i, s) => {
      const r = s.results?.[c.id];
      const markIt = (met) => act(`${base}/mark`, { step: l.steps.indexOf(s) + 1, criterion: c.id, met: r?.by === 'you' && r.met === met ? null : met });
      return el('li', { class: `lp-crit ${r?.met === true ? 'met' : r?.met === false ? 'unmet' : ''}` },
        el('span', { class: 'lp-mark', 'aria-hidden': 'true' }, mark(r)),
        el('span', { class: 'lp-ctext' }, `${i + 1}. ${c.text}`, c.check ? el('code', {}, c.check) : null,
          r?.note ? el('small', {}, ` — ${r.note}`) : null, r?.by === 'you' ? el('small', { class: 'lp-you' }, ` · ${L('byYou')}`) : null),
        el('span', { class: 'lp-cbtns' },
          el('button', { type: 'button', class: 's-mini', title: L('markMet'), 'aria-label': L('markMet'), onclick: markIt(true) }, '✓'),
          el('button', { type: 'button', class: 's-mini', title: L('markUnmet'), 'aria-label': L('markUnmet'), onclick: markIt(false) }, '✗')));
    };
    return el('div', { class: 'lp-view' },
      el('div', { class: 'lp-head' },
        el('h3', {}, `🔁 ${l.name}`),
        el('span', { class: `lp-status ${l.status}` }, t(`loopStatus.${l.status}`)),
        el('span', { class: 'lp-act' }, `${ACTIVITY_ICON[l.activity] || ''} ${L(`activity.${l.activity}`)}`)),
      el('p', { class: 'lp-meta' }, L('meta', { project: l.project || '?', every: l.interval, tries: l.tries }), ' ', el('b', {}, next(l))),
      l.detail ? el('p', { class: `lp-detail-msg ${l.status}` }, l.detail) : null,
      el('div', { class: 'lp-btns' },
        el('button', { type: 'button', class: 'btn ghost', disabled: !running, onclick: act(`${base}/tick`) }, L('tick')),
        running ? el('button', { type: 'button', class: 'btn ghost', onclick: act(`${base}/pause`) }, L('pause'))
          : l.status !== 'done' ? el('button', { type: 'button', class: 'btn ghost', onclick: act(`${base}/resume`) }, L(l.status === 'blocked' ? 'retry' : 'resume')) : null,
        l.current >= 0 ? el('button', { type: 'button', class: 'btn ghost', onclick: act(`${base}/skip`) }, L('skip')) : null,
        el('button', { type: 'button', class: 'btn ghost', onclick: () => edit(l) }, L('edit')),
        el('button', { type: 'button', class: 'btn ghost danger', onclick: async () => { if (!confirm(L('confirmDelete', { name: l.name }))) return; const r = await api('DELETE', base); say(r.ok ? '' : r.error, !r.ok); } }, L('delete'))),
      el('span', { class: 'fl-label' }, L('loopCriteria')),
      l.criteria.length ? el('ul', { class: 'lp-gcrit' }, l.criteria.map((c) => el('li', {}, c.text, c.check ? el('code', {}, c.check) : null))) : el('p', { class: 'fl-dim' }, L('noLoopCriteria')),
      add(L('addLoopCriterion'), (v) => api('POST', `${base}/criteria`, { criteria: linesToCriteria(v) })),
      el('span', { class: 'fl-label' }, L('steps')),
      el('ol', { class: 'lp-steps' }, l.steps.map((s, i) => {
        const all = [...l.criteria, ...s.criteria];
        const open = i === l.current;
        return el('li', { class: `lp-step ${s.status}${open ? ' current' : ''}` },
          el('div', { class: 'lp-srow' },
            el('span', { class: 'lp-sicon', title: t(`loopStep.${s.status}`) }, STEP_ICON[s.status] || '•'),
            el('span', { class: 'lp-stext' }, s.text.split('\n')[0]),
            s.tries ? el('small', { class: 'lp-tries' }, L('tries', { n: s.tries, max: l.tries })) : null),
          open && all.length ? el('ul', { class: 'lp-crits' }, all.map((c, k) => crit(c, k, s))) : null,
          open ? add(L('addStepCriterion'), (v) => api('POST', `${base}/criteria`, { criteria: linesToCriteria(v), step: i + 1 })) : null,
          s.detail ? el('small', { class: 'lp-sdetail' }, s.detail) : null);
      })),
      add(L('addStep'), (v) => api('POST', `${base}/steps`, { steps: [v] })));
  }

  // ---------------------------------------------------------------- the form: a new loop, or changing one

  function edit(l) {
    st.editing = l ? l.id : 'new';
    const projects = getProjects();
    const steps = (l?.steps || [{ text: '', criteria: [] }]).map((s) => ({ ...s }));
    const field = (label, input) => el('label', { class: 'b-field' }, el('span', {}, label), input);
    const name = el('input', { type: 'text', maxlength: '60', value: l?.name || '', required: true });
    const project = el('select', {}, projects.map((p) => el('option', { value: p.id, selected: l ? p.id === l.agent : undefined }, p.name)));
    const every = el('input', { type: 'number', min: '1', max: '1440', value: String(l?.interval ?? 5) });
    const tries = el('input', { type: 'number', min: '1', max: '50', value: String(l?.tries ?? 5) });
    const gcrit = el('textarea', { rows: '2', placeholder: L('criteriaPh') });
    gcrit.value = (l?.criteria || []).map(criterionLine).join('\n');
    const box = el('ol', { class: 'lp-fsteps' });
    const drawSteps = () => box.replaceChildren(...steps.map((s, i) => {
      const locked = s.status && s.status !== 'pending';
      const what = el('textarea', { rows: '2', maxlength: '2000', placeholder: L('stepPh'), 'aria-label': L('stepPh') });
      what.value = s.text;
      what.oninput = () => { s.text = what.value; };
      const cr = el('textarea', { rows: '2', placeholder: L('criteriaPh'), 'aria-label': L('stepCriteria') });
      cr.value = s.lines ?? (s.criteria || []).map(criterionLine).join('\n');
      cr.oninput = () => { s.lines = cr.value; };
      return el('li', { class: 'lp-fstep' },
        el('div', { class: 'lp-fhead' }, el('b', {}, L('stepN', { n: i + 1 })), s.status ? el('small', {}, ` · ${t(`loopStep.${s.status}`)}`) : null,
          locked ? null : el('button', { type: 'button', class: 's-mini', title: L('removeStep'), 'aria-label': L('removeStep'), onclick: () => { steps.splice(i, 1); drawSteps(); } }, '✕')),
        what, el('span', { class: 'lp-flabel' }, L('stepCriteria')), cr);
    }));
    drawSteps();
    const save = async () => {
      const body = {
        name: name.value, project: project.value, interval: Number(every.value), tries: Number(tries.value),
        criteria: linesToCriteria(gcrit.value, l?.criteria || []),
        steps: steps.filter((s) => s.text.trim()).map((s) => ({ ...(s.id ? { id: s.id } : {}), text: s.text, criteria: linesToCriteria(s.lines ?? (s.criteria || []).map(criterionLine).join('\n'), s.criteria || []) })),
      };
      const r = await api(l ? 'PUT' : 'POST', l ? `/v1/loops/${encodeURIComponent(l.id)}` : '/v1/loops', body);
      if (!r.ok) return say(r.error, true);
      st.id = r.loop.id;
      st.editing = null;
      say(l ? L('saved') : L('created'));
      render();
      timer ??= setInterval(() => { if (!st.editing) render(); }, 1000);
    };
    $('lp-detail').replaceChildren(el('form', { class: 'lp-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      el('h3', {}, l ? L('editTitle', { name: l.name }) : L('newTitle')),
      el('p', { class: 'b-desc' }, L('intro')),
      projects.length ? null : el('p', { class: 'b-problem' }, L('noProjects')),
      field(L('name'), name), field(L('project'), project),
      el('div', { class: 'lp-nums' }, field(L('every'), every), field(L('triesLabel'), tries)),
      el('span', { class: 'fl-label' }, L('loopCriteria')), el('small', { class: 'fl-dim' }, L('loopCriteriaHint')), gcrit,
      el('span', { class: 'fl-label' }, L('steps')), box,
      el('div', { class: 'lp-btns' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { steps.push({ text: '', criteria: [] }); drawSteps(); box.lastChild?.querySelector('textarea')?.focus(); } }, L('addStepBtn')),
        l || mine().length ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.editing = null; render(); } }, L('cancel')) : null,
        el('button', { type: 'submit', class: 'btn', disabled: !projects.length }, l ? L('save') : L('create')))));
    if (!l) $('lp-list').replaceChildren(...mine().map((x) => el('li', {}, el('button', { type: 'button', class: `lp-pick ${x.status}`, onclick: () => { st.id = x.id; st.editing = null; render(); } }, el('b', {}, `🔁 ${x.name}`), el('small', {}, `${x.project || '?'} · ${t(`loopStatus.${x.status}`)}`)))));
    name.focus();
  }

  return { open, refresh, mine };
}
