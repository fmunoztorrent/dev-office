// The dialogs of the two shared floors, in the web view:
//
//   directives  (the executive floor: the board, the company's screen, or `t` there) a new order for
//               several offices or projects at once, and how the latest ones are going
//   archive     (the shelves, the skills rack, the patch panel, or `t` there) the company's knowledge:
//               search it, read it, add to it, install a skill or a connector in some projects, or
//               ask an agent to write one
//
// They talk to the office over HTTP (/v1/directives, /v1/knowledge, /v1/agents); what changes comes
// back over WebSocket and they redraw.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const KINDS = ['note', 'decision', 'doc', 'minute', 'skill', 'connector'];
const ICON = { note: '📝', decision: '⚖️', doc: '📘', minute: '🗒️', skill: '🧩', connector: '🔌' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return e;
}
const api = (path, body, method = body === undefined ? 'GET' : 'POST') =>
  fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then((r) => r.json()).catch((err) => ({ ok: false, error: err.message }));
/** The registered agents of every office (the projects), grouped by office. */
async function projectsByOffice(offices) {
  const all = ((await api('/v1/agents')).agents || []).filter((a) => a.registered);
  return offices.map((o) => ({ ...o, projects: all.filter((a) => a.office === o.id) })).concat(
    all.some((a) => !offices.find((o) => o.id === a.office)) ? [{ id: '?', name: '—', projects: all.filter((a) => !offices.find((o) => o.id === a.office)) }] : [],
  );
}

/** Checkboxes: an office (all its projects) and each of its projects. Returns () => the chosen ids. */
function scopePicker(box, groups, { checked = () => false } = {}) {
  box.innerHTML = '';
  for (const g of groups) {
    const kids = g.projects.map((a) => el('input', { type: 'checkbox', value: a.id, checked: checked(a) }));
    const all = el('input', { type: 'checkbox', disabled: !g.projects.length });
    const sync = () => { all.checked = kids.length > 0 && kids.every((k) => k.checked); all.indeterminate = !all.checked && kids.some((k) => k.checked); };
    all.onchange = () => { for (const k of kids) k.checked = all.checked; };
    kids.forEach((k) => { k.onchange = sync; });
    sync();
    box.append(el('div', { class: 'fl-group' },
      el('label', { class: 'fl-office' }, all, el('b', {}, g.name), el('span', { class: 'fl-dim' }, g.projects.length ? t('exec.ui.all', { n: g.projects.length }) : t('exec.ui.none'))),
      g.projects.length ? el('div', { class: 'fl-projects' }, g.projects.map((a, i) => el('label', { class: 'fl-project', title: a.path }, kids[i], `${a.name}`, el('span', { class: 'fl-dim' }, ` · ${a.harness}`)))) : null));
  }
  return () => [...box.querySelectorAll('.fl-projects input:checked')].map((i) => i.value);
}

// ---------------------------------------------------------------- the executive floor: directives

/**
 * @param getDirectives  () => the latest directives (they come over WebSocket)
 * @param getOffices     () => the company's offices
 * @param hhmm           (ts) => the time, in the office's zone
 * @param onDepartment   (office) => a department was created from here (to set up its projects and people)
 */
export function createDirectivesUi({ getDirectives = () => [], getOffices = () => [], hhmm = (ts) => new Date(ts).toLocaleTimeString(), onDepartment }) {
  const dialog = $('directives');
  const st = { chosen: () => [], busy: false };
  $('dv-close').onclick = () => dialog.close();
  $('dv-cancel').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('dv-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('dv-form').requestSubmit(); };

  /** A line under the form: a problem (red) or that it went well. */
  const say = (text, good = false) => { $('dv-msg').textContent = text; $('dv-msg').classList.toggle('ok', good); };

  async function open() {
    say('');
    if (!dialog.open) dialog.showModal();
    render();
    const groups = await projectsByOffice(getOffices());
    const any = groups.some((g) => g.projects.length);
    $('dv-offices').hidden = !any;
    $('dv-none').hidden = any;
    st.chosen = scopePicker($('dv-offices'), groups, { checked: () => groups.length === 1 });
    $('dv-text').focus();
  }

  // A department that does not exist yet: created here (its projects, people and instructions, in ⚙ › Departments)
  $('dv-dept').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dv-dept-add').click(); } };
  $('dv-dept-add').onclick = async () => {
    const name = $('dv-dept').value.trim();
    if (!name) { say(t('exec.ui.deptName')); $('dv-dept').focus(); return; }
    const out = await api('/v1/offices', { name });
    if (!out.ok) return say(out.error || '?');
    $('dv-dept').value = '';
    say(t('exec.ui.deptCreated', { name: out.office.name }), true);
    onDepartment?.(out.office);
    const groups = await projectsByOffice([...getOffices().filter((o) => o.id !== out.office.id), out.office]);
    $('dv-offices').hidden = false;
    $('dv-none').hidden = true;
    st.chosen = scopePicker($('dv-offices'), groups);
  };

  $('dv-form').onsubmit = async (e) => {
    e.preventDefault();
    if (st.busy) return;
    const text = $('dv-text').value.trim();
    const targets = st.chosen();
    if (!text) return say(t('exec.ui.write'));
    if (!targets.length) return say(t('exec.ui.pick'));
    st.busy = true;
    $('dv-go').disabled = true;
    const out = await api('/v1/directives', { text, targets });
    st.busy = false;
    $('dv-go').disabled = false;
    if (!out.ok) { say(out.error || '?'); return; }
    $('dv-text').value = '';
    say(t('exec.ui.sent', { n: out.directive.total }), true);
    render();
  };

  function render() {
    const ul = $('dv-list');
    ul.innerHTML = '';
    const list = getDirectives();
    if (!list.length) ul.append(el('li', { class: 'fl-empty' }, t('exec.ui.empty')));
    for (const d of list) {
      ul.append(el('li', { class: `dv-item ${d.status}` },
        el('div', { class: 'dv-top' },
          el('b', { class: 'dv-title', title: d.text }, d.title),
          el('span', { class: `fl-pill ${d.status}` }, t(`directiveStatus.${d.status}`)),
          el('span', { class: 'fl-dim' }, `${t('exec.ui.progress', { done: d.done, total: d.total })} · ${hhmm(d.createdAt)}`),
          d.status === 'running' ? el('button', { type: 'button', class: 'fl-mini', onclick: async () => { const out = await api(`/v1/directives/${encodeURIComponent(d.id)}/cancel`, {}); if (!out.ok) $('dv-msg').textContent = out.error; } }, t('exec.ui.stop')) : null),
        el('ul', { class: 'dv-parts' }, d.parts.map((p) => el('li', { class: p.status, title: p.detail || '' },
          el('span', { class: 'dot' }), `${p.name}`, el('span', { class: 'fl-dim' }, ` · ${(getOffices().find((o) => o.id === p.office)?.name) || p.office} · ${t(`taskStatus.${p.status}`)}${p.detail ? ` — ${p.detail}` : ''}`))))));
    }
  }

  return { open, refresh() { if (dialog.open) render(); } };
}

// ---------------------------------------------------------------- the archive

/**
 * @param getOffices  () => the company's offices (an entry can be for one of them)
 * @param hhmm        (ts) => the time, in the office's zone
 */
export function createArchiveUi({ getOffices = () => [], hhmm = (ts) => new Date(ts).toLocaleString() }) {
  const dialog = $('archive');
  const A = (k, v) => t(`archive.ui.${k}`, v);
  const st = { kind: '', q: '', entries: [], counts: {}, view: 'list', current: null, timer: null };
  $('ar-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('ar-q').oninput = () => { clearTimeout(st.timer); st.timer = setTimeout(() => { st.q = $('ar-q').value.trim(); load(); }, 220); };
  $('ar-new').onclick = () => edit(null);
  $('ar-ask').onclick = () => ask();

  /** Opens the archive: { kind } shows only that kind, { create: true } a new entry. */
  async function open({ kind = '', create = false } = {}) {
    st.kind = KINDS.includes(kind) ? kind : '';
    $('ar-msg').textContent = '';
    if (!dialog.open) dialog.showModal();
    await load();
    if (create) edit(null, { kind: st.kind || 'note' });
    else { show(st.current?.id || null); $('ar-q').focus(); }
  }

  async function load() {
    const qs = new URLSearchParams({ limit: '200', ...(st.kind ? { kind: st.kind } : {}), ...(st.q ? { q: st.q } : {}) });
    const out = await api(`/v1/knowledge?${qs}`);
    st.entries = out.entries || [];
    st.counts = out.counts || {};
    renderTabs();
    renderList();
  }

  function renderTabs() {
    const nav = $('ar-tabs');
    nav.innerHTML = '';
    const total = KINDS.reduce((n, k) => n + (st.counts[k] || 0), 0);
    for (const k of ['', ...KINDS]) {
      nav.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(st.kind === k), onclick: () => { st.kind = k; load(); } },
        `${k ? `${ICON[k]} ${A(`kinds.${k}`)}` : A('all')} `, el('span', { class: 'fl-dim' }, String(k ? st.counts[k] || 0 : total))));
    }
  }

  function renderList() {
    const ul = $('ar-list');
    ul.innerHTML = '';
    if (!st.entries.length) ul.append(el('li', { class: 'fl-empty' }, st.q ? A('none', { q: st.q }) : A('empty')));
    for (const e of st.entries) {
      ul.append(el('li', { class: `ar-item${st.current?.id === e.id ? ' sel' : ''}`, tabindex: '0', onclick: () => show(e.id), onkeydown: (ev) => { if (ev.key === 'Enter') show(e.id); } },
        el('span', { class: 'ar-icon', title: t(`knowledgeKind.${e.kind}`) }, ICON[e.kind] || '📄'),
        el('div', { class: 'ar-what' },
          el('b', {}, e.name ? `${e.name} — ${e.title}` : e.title),
          el('span', { class: 'fl-dim' }, [e.excerpt, ...(e.tags || []).map((x) => `#${x}`)].filter(Boolean).join('  ')))));
    }
  }

  async function show(id) {
    st.view = 'show';
    const box = $('ar-detail');
    box.innerHTML = '';
    if (!id) { st.current = null; box.append(el('p', { class: 'fl-empty' }, A('pickOne'))); renderList(); return; }
    const out = await api(`/v1/knowledge/${encodeURIComponent(id)}`);
    if (!out.ok) { $('ar-msg').textContent = out.error; return; }
    const e = st.current = out.entry;
    renderList();
    const office = e.office ? getOffices().find((o) => o.id === e.office)?.name || e.office : A('company');
    box.append(...[
      el('header', { class: 'ar-head' },
        el('span', { class: `fl-pill k-${e.kind}` }, `${ICON[e.kind]} ${t(`knowledgeKind.${e.kind}`)}`),
        el('h3', {}, e.name ? e.name : e.title),
        el('div', { class: 'ar-actions' },
          el('button', { type: 'button', class: 'fl-mini', onclick: () => edit(e) }, A('edit')),
          el('button', { type: 'button', class: 'fl-mini danger', onclick: () => remove(e) }, A('remove')))),
      e.name ? el('p', { class: 'ar-desc' }, e.title) : null,
      el('p', { class: 'fl-dim' }, [office, e.source && A('by', { who: e.source }), A('uses', { n: e.uses }), hhmm(e.updatedAt), ...(e.tags || []).map((x) => `#${x}`)].filter(Boolean).join(' · ')),
      e.config ? el('pre', { class: 'ar-config' }, e.config.url ? e.config.url : [e.config.command, ...(e.config.args || [])].join(' ')) : null,
      e.body ? el('pre', { class: 'ar-body' }, e.body) : null,
    ].filter(Boolean));
    if (e.kind === 'skill' || e.kind === 'connector') installBox(box, e);
  }

  async function installBox(box, e) {
    const wrap = el('section', { class: 'ar-install' }, el('h4', {}, A('install')), el('p', { class: 'fl-dim' }, A('installHint')));
    const pick = el('div', { class: 'fl-scope' });
    const results = el('ul', { class: 'ar-results' });
    const go = el('button', { type: 'button', class: 'btn' }, A('installGo'));
    wrap.append(pick, el('div', { class: 'ar-row' }, go), results);
    box.append(wrap);
    const groups = await projectsByOffice(getOffices());
    const chosen = scopePicker(pick, groups);
    go.onclick = async () => {
      const targets = chosen();
      if (!targets.length) { $('ar-msg').textContent = t('exec.ui.pick'); return; }
      go.disabled = true;
      const out = await api(`/v1/knowledge/${encodeURIComponent(e.id)}/install`, { targets });
      go.disabled = false;
      results.innerHTML = '';
      $('ar-msg').textContent = out.ok ? '' : out.error || '';
      for (const r of out.results || []) {
        results.append(el('li', { class: r.ok ? 'ok' : 'err', title: r.file || '' }, `${r.ok ? '✓' : '✗'} ${r.name || r.target}: `,
          r.ok ? t(`archive.action.${r.action}`) : t(`archive.reason.${r.reason}`), r.rel ? el('span', { class: 'fl-dim' }, ` · ${r.rel}`) : null));
      }
    };
  }

  /** The form: a new entry (null) or that one. */
  function edit(e, { kind } = {}) {
    st.view = 'edit';
    const box = $('ar-detail');
    box.innerHTML = '';
    const k = e?.kind || kind || st.kind || 'note';
    const f = {
      kind: el('select', {}, KINDS.map((x) => el('option', { value: x, selected: x === k }, `${ICON[x]} ${t(`knowledgeKind.${x}`)}`))),
      name: el('input', { type: 'text', value: e?.name || '', maxlength: '40', placeholder: 'deploy-staging' }),
      title: el('input', { type: 'text', value: e?.title || '', maxlength: '200' }),
      command: el('input', { type: 'text', value: e?.config?.command || '', placeholder: 'npx -y @acme/mcp-server' }),
      args: el('input', { type: 'text', value: (e?.config?.args || []).join(' ') }),
      url: el('input', { type: 'text', value: e?.config?.url || '', placeholder: 'https://mcp.example.com/mcp' }),
      tags: el('input', { type: 'text', value: (e?.tags || []).join(', ') }),
      office: el('select', {}, el('option', { value: '' }, A('company')), getOffices().map((o) => el('option', { value: o.id, selected: e?.office === o.id }, o.name))),
      body: el('textarea', { rows: '10', maxlength: String(64 * 1024) }, e?.body || ''),
    };
    const row = (label, input, cls = '') => el('label', { class: `b-field ${cls}` }, el('span', {}, label), input);
    const titleRow = row(A('titleField'), f.title), nameRow = row(A('name'), f.name), cmdRow = row(A('command'), f.command), argsRow = row(A('args'), f.args), urlRow = row(A('url'), f.url);
    const bodyLabel = el('span', {});
    const sync = () => {
      const kk = f.kind.value;
      nameRow.hidden = !['skill', 'connector'].includes(kk);
      for (const r of [cmdRow, argsRow, urlRow]) r.hidden = kk !== 'connector';
      titleRow.firstChild.textContent = A(kk === 'skill' ? 'descField' : kk === 'connector' ? 'infoField' : 'titleField');
      bodyLabel.textContent = A(kk === 'skill' ? 'instructions' : kk === 'connector' ? 'setup' : 'body');
    };
    f.kind.onchange = sync;
    const save = el('button', { type: 'button', class: 'btn' }, A('save'));
    save.onclick = async () => {
      // a command written as one line: the first word is the command, the rest its arguments
      let command = f.command.value.trim(), args = f.args.value.trim() ? f.args.value.trim().split(/\s+/) : [];
      if (command.includes(' ') && !args.length) [command, ...args] = command.split(/\s+/);
      const body = {
        kind: f.kind.value, title: f.title.value, body: f.body.value, tags: f.tags.value, office: f.office.value || null,
        ...(['skill', 'connector'].includes(f.kind.value) ? { name: f.name.value || f.title.value } : {}),
        ...(f.kind.value === 'connector' ? { config: f.url.value.trim() ? { url: f.url.value.trim() } : { command, args } } : {}),
      };
      save.disabled = true;
      const out = e ? await api(`/v1/knowledge/${encodeURIComponent(e.id)}`, body, 'PUT') : await api('/v1/knowledge', body);
      save.disabled = false;
      if (!out.ok) { $('ar-msg').textContent = out.error || '?'; return; }
      $('ar-msg').textContent = A('saved');
      await load();
      show(out.entry.id);
    };
    box.append(
      el('div', { class: 'ar-form' }, row(A('kind'), f.kind), nameRow, titleRow, cmdRow, argsRow, urlRow, row(A('tags'), f.tags), row(A('office'), f.office),
        el('label', { class: 'note' }, bodyLabel, f.body)),
      el('div', { class: 'ar-row' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => show(e?.id || null) }, A('back')), save),
    );
    sync();
    (e ? f.title : f.kind.value === 'note' ? f.title : f.name).focus();
  }

  async function remove(e) {
    if (!confirm(A('removeAsk', { title: e.name || e.title }))) return;
    const out = await api(`/v1/knowledge/${encodeURIComponent(e.id)}`, undefined, 'DELETE');
    if (!out.ok) { $('ar-msg').textContent = out.error || '?'; return; }
    $('ar-msg').textContent = A('removed');
    st.current = null;
    await load();
    show(null);
  }

  /** Ask an agent: it writes the skill (or connector, note, doc) and saves it with save_knowledge. */
  async function ask() {
    st.view = 'ask';
    const box = $('ar-detail');
    box.innerHTML = '';
    const targets = ((await api('/v1/agents')).agents || []).filter((a) => a.exists !== false);
    const kind = el('select', {}, ['skill', 'connector', 'note', 'doc'].map((x) => el('option', { value: x, selected: x === (st.kind === 'connector' ? 'connector' : 'skill') }, `${ICON[x]} ${t(`knowledgeKind.${x}`)}`)));
    const text = el('textarea', { rows: '4', placeholder: A('describePh') });
    const agent = el('select', {}, targets.map((a) => el('option', { value: a.id }, `${a.name} · ${a.harness}${a.sessions?.some((s) => s.live) ? ' ●' : ''}`)));
    const go = el('button', { type: 'button', class: 'btn', disabled: !targets.length }, '▶');
    go.onclick = async () => {
      go.disabled = true;
      const out = await api('/v1/knowledge/generate', { kind: kind.value, text: text.value, target: agent.value });
      go.disabled = false;
      $('ar-msg').textContent = out.ok ? A('asked', { agent: agent.selectedOptions[0]?.textContent || '' }) : out.error || '?';
      $('ar-msg').classList.toggle('ok', !!out.ok);
      if (out.ok) text.value = '';
    };
    box.append(el('div', { class: 'ar-form' },
      el('label', { class: 'b-field' }, el('span', {}, A('kind')), kind),
      el('label', { class: 'note' }, el('span', {}, A('describe')), text),
      el('label', { class: 'b-field' }, el('span', {}, A('agent')), targets.length ? agent : el('span', { class: 'fl-dim' }, A('noTargets'))),
      el('div', { class: 'ar-row' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => show(st.current?.id || null) }, A('back')), go)));
    text.focus();
  }

  return {
    open,
    /** The archive changed (over WebSocket): the list is reloaded if it is open. */
    refresh() { if (dialog.open) load(); },
  };
}
