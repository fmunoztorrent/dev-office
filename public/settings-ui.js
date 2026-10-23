// ⚙ Settings in the web view. The office is the frontend and keeps its own data in its SQLite database:
//   General      game language, the company's time zone, real weather, herdr and the log
//   Offices      the company's offices (teams or domains): name, time zone and location
//   Agents       the maintainer: each agent is a full path + the CLI that serves it + its
//                office. What its harness brings (Errementari, commands, prompts, .devteam/) is
//                detected, and a prompt sent from the whiteboard starts THAT pipeline.
//   Characters   how the characters of the office being watched look.

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES } from './sim.js';
import { drawSprite } from './sprite.js';
import { t, LANGUAGES, getLanguage } from './i18n.js';
import { allZones, zoneInfo, countryName } from './clock.js';

const ROLE_ORDER = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
const HARNESS_NAME = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (k === 'value') e.value = v ?? '';
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}
const put = (panel, ...nodes) => panel.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
const option = (value, label, selected) => el('option', { value, selected: selected ? true : undefined }, label);
const tzLabel = (tz) => { const z = zoneInfo(tz); return z.country ? `${tz} · ${countryName(z.country, getLanguage())}` : tz; };

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
}

const emptyForm = () => ({ id: null, path: '', harness: '', name: '', bin: '', args: '', office: null, detected: null, touched: false });
const emptyOffice = () => ({ id: null, name: '', timezone: '', location: '' });

/** A time zone field: type to search (city, region or country) among all zones. */
function zoneInput({ value, placeholder, label, onPick }) {
  const id = `tz-${Math.random().toString(36).slice(2, 8)}`;
  const list = el('datalist', { id }, allZones().map((z) => option(z, countryName(zoneInfo(z).country, getLanguage()))));
  const input = el('input', { type: 'text', value: value || '', placeholder, list: id, 'aria-label': label, autocomplete: 'off' });
  const country = el('span', { class: 'hint tz-country' }, value ? tzLabel(value) : '');
  input.onchange = () => {
    const v = input.value.trim();
    if (!v) { country.textContent = ''; onPick(null); return; }
    const z = allZones().find((x) => x.toLowerCase() === v.toLowerCase()) || allZones().find((x) => x.toLowerCase().replace(/_/g, ' ').includes(v.toLowerCase()));
    if (!z) { country.textContent = '✗'; return; }
    input.value = z;
    country.textContent = tzLabel(z);
    onPick(z);
  };
  return [input, list, country];
}

/**
 * @param getOffices/getOffice  the offices and the one being watched
 * @param getPrefs/getHerdr     the general settings and herdr's state (they arrive over WebSocket)
 * @param onView                (id) => watch another office
 */
export function createSettings({ getTargets = () => [], getOffices = () => [], getOffice = () => null, getPrefs = () => null, getHerdr = () => null, onPrompt, onView, onSaved } = {}) {
  const st = { tab: 'general', data: null, looks: null, form: emptyForm(), office: emptyOffice() };
  const msg = (text, ok = false) => { $('s-msg').textContent = text; $('s-msg').style.color = ok ? '#2a9d8f' : ''; };
  const here = () => getOffice()?.id || 'main';

  async function load() {
    const s = await api('GET', `/v1/settings?office=${encodeURIComponent(here())}`);
    if (!s.ok) { msg(s.error); return false; }
    st.data = s;
    return true;
  }

  async function open(tab = st.tab) {
    $('settings').showModal();
    msg(t('settings.loading'), true);
    if (!(await load())) return;
    msg('');
    show(tab);
  }

  function show(tab) {
    st.tab = tab;
    for (const b of document.querySelectorAll('#settings .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll('#settings .s-panel')) p.hidden = p.dataset.panel !== tab;
    $('settings-save').hidden = tab !== 'look';
    $('s-file').textContent = st.data ? t('settings.file', { file: tilde(st.data.office.file) }) : '';
    if (tab === 'general') renderGeneral();
    else if (tab === 'offices') renderOffices();
    else if (tab === 'agents') renderAgents();
    else { st.looks = null; renderLook(); }
  }

  /** Something new arrived (agents, offices, settings, the language…): the tab is redrawn. */
  function refresh(all = false) {
    if (!$('settings').open) return;
    if (st.tab === 'agents') return renderList();
    if (all || st.tab === 'general' || st.tab === 'offices') show(st.tab);
  }

  // ------------------------------------------------------------ General

  async function setPref(patch) {
    const r = await api('PUT', '/v1/settings', { prefs: patch });
    if (!r.ok) return msg(r.error);
    msg(t('settings.saved'), true);
    onSaved?.();
  }

  function renderGeneral() {
    const panel = document.querySelector('[data-panel="general"]');
    const p = getPrefs() || st.data?.office.prefs;
    if (!p) return;
    const herdr = getHerdr() || st.data?.herdr || {};
    const agents = getTargets().filter((x) => x.registered);
    const G = (k, v) => t(`settings.general.${k}`, v);
    const check = (checked, label, onchange) => el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: checked ? true : undefined, onchange }), label);
    put(panel,
      el('label', { class: 'b-field' }, el('span', {}, G('language')),
        el('select', { 'aria-label': G('language'), onchange: (e) => setPref({ lang: e.target.value }) }, Object.entries(LANGUAGES).map(([id, name]) => option(id, name, id === p.lang)))),
      el('label', { class: 'b-field' }, el('span', {}, G('timezone')),
        el('span', { class: 'tz-field' }, zoneInput({ value: p.timezone, placeholder: G('tzSystem', { tz: st.data?.systemZone || '' }), label: G('timezone'), onPick: (z) => setPref({ timezone: z }) }))),
      el('p', { class: 'hint' }, G('tzHint')),
      check(p.weather, `${G('weather')}: ${G(p.weather ? 'weatherOn' : 'weatherOff')}`, (e) => setPref({ weather: e.target.checked })),
      check(p.log?.life, G('life'), (e) => setPref({ log: { life: e.target.checked } })),
      el('label', { class: 'b-field' }, el('span', {}, G('viewMode')),
        el('select', { 'aria-label': G('viewMode'), onchange: (e) => setPref({ view: { mode: e.target.value } }) }, ['flat', 'iso'].map((m) => option(m, G(`view_${m}`), m === (p.view?.mode || 'flat'))))),
      el('h3', {}, G('herdr')),
      el('p', { class: 'hint' }, herdr.available ? G('herdrOn', { pane: herdr.pane || '?' }) : G('herdrOff')),
      check(p.herdr.launch, G('herdrLaunch'), (e) => setPref({ herdr: { launch: e.target.checked } })),
      check(p.herdr.subagents !== false, G('herdrSubagents'), (e) => setPref({ herdr: { subagents: e.target.checked } })),
      el('label', { class: 'b-field' }, el('span', {}, G('herdrDirection')),
        el('select', { onchange: (e) => setPref({ herdr: { direction: e.target.value } }) }, ['right', 'down'].map((d) => option(d, G(d), d === p.herdr.direction)))),
      el('label', { class: 'b-field' }, el('span', {}, G('startAgent')),
        el('select', { onchange: (e) => setPref({ herdr: { startAgent: e.target.value } }) },
          option('auto', G('auto'), p.herdr.startAgent === 'auto'), option('none', G('none'), p.herdr.startAgent === 'none'),
          agents.map((a) => option(a.id, `${a.name} · ${HARNESS_NAME[a.harness]}`, a.id === p.herdr.startAgent)))));
  }

  // ------------------------------------------------------------ Oficinas

  function renderOffices() {
    const panel = document.querySelector('[data-panel="offices"]');
    const O = (k, v) => t(`settings.offices.${k}`, v);
    const p = getPrefs() || st.data?.office.prefs || {};
    const company = p.timezone || st.data?.systemZone || '';
    const cards = getOffices().map((o) => el('div', { class: 's-agent' },
      el('div', { class: 's-agent-head' },
        el('b', {}, o.name), o.id === 'main' ? el('span', { class: 's-tag' }, O('main')) : null,
        el('span', { class: 's-tag kind' }, tzLabel(o.timezone)),
        o.id === here() ? el('span', { class: 's-ok' }, O('viewing')) : null),
      el('div', { class: 'hint' }, `${O('agents', { n: o.agents })}${o.location ? ` · 📍 ${o.location}` : ''}${o.ownTimezone ? '' : ` · ${O('inherit', { tz: company })}`}`),
      el('div', { class: 's-row' },
        o.id !== here() ? el('button', { type: 'button', class: 's-mini', onclick: () => { onView?.(o.id); $('settings').close(); } }, `👁 ${O('view')}`) : null,
        el('button', { type: 'button', class: 's-mini', onclick: () => { st.office = { id: o.id, name: o.custom ? o.name : '', timezone: o.ownTimezone || '', location: o.location || '' }; renderOffices(); } }, O('edit')),
        o.id !== 'main' ? el('button', { type: 'button', class: 's-mini danger', onclick: () => removeOffice(o) }, O('delete')) : null)));
    const f = st.office;
    const editing = getOffices().find((o) => o.id === f.id);
    put(panel,
      el('p', { class: 'hint' }, O('hint')),
      el('div', { class: 's-agents' }, cards),
      el('h3', {}, editing ? O('editTitle', { name: editing.name }) : O('newTitle')),
      el('div', { class: 's-form' },
        el('label', { class: 'b-field' }, el('span', {}, O('name')), el('input', { type: 'text', value: f.name, maxlength: 40, oninput: (e) => { f.name = e.target.value; } })),
        el('label', { class: 'b-field' }, el('span', {}, O('timezone')),
          el('span', { class: 'tz-field' }, zoneInput({ value: f.timezone, placeholder: O('inherit', { tz: company }), label: O('timezone'), onPick: (z) => { f.timezone = z || ''; } }))),
        el('label', { class: 'b-field' }, el('span', {}, O('location')), el('input', { type: 'text', value: f.location, placeholder: O('locationPh'), maxlength: 80, oninput: (e) => { f.location = e.target.value; } })),
        el('div', { class: 's-row' },
          el('button', { type: 'button', class: 'btn', onclick: saveOffice }, f.id ? O('saveChanges') : O('add')),
          f.id ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.office = emptyOffice(); renderOffices(); } }, O('cancel')) : null)));
  }

  async function saveOffice() {
    const f = st.office;
    const body = { name: f.name, timezone: f.timezone || null, location: f.location || null };
    const r = f.id ? await api('PUT', `/v1/offices/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/offices', body);
    if (!r.ok) return msg(r.error);
    msg(f.id ? t('settings.offices.updated') : t('settings.offices.created', { name: r.office.name }), true);
    st.office = emptyOffice();
    await load();
    renderOffices();
  }

  async function removeOffice(o) {
    if (!confirm(t('settings.offices.confirmDelete', { name: o.name }))) return;
    const r = await api('DELETE', `/v1/offices/${encodeURIComponent(o.id)}`);
    if (!r.ok) return msg(r.error);
    msg(t('settings.offices.deleted'), true);
  }

  // ------------------------------------------------------------ Agents (the maintainer)

  const A = (k, v) => t(`settings.agents.${k}`, v);

  function renderAgents() {
    const panel = document.querySelector('[data-panel="agents"]');
    put(panel,
      el('p', { class: 'hint' }, A('hint')),
      el('div', { id: 's-agent-list', class: 's-agents' }),
      el('h3', { id: 's-form-title' }),
      el('div', { id: 's-agent-form', class: 's-form' }));
    renderList();
    renderForm();
  }

  function renderList() {
    const box = $('s-agent-list');
    if (!box) return;
    const targets = getTargets();
    const offices = getOffices();
    const officeName = (id) => offices.find((o) => o.id === id)?.name || id;
    const registered = targets.filter((x) => x.registered);
    const loose = targets.filter((x) => !x.registered);
    const card = (a) => el('div', { class: 's-agent' },
      el('div', { class: 's-agent-head' },
        el('b', {}, a.name), el('span', { class: 's-tag' }, HARNESS_NAME[a.harness] || a.harness),
        ...a.kinds.map((k) => el('span', { class: 's-tag kind' }, k)),
        offices.length > 1 ? el('span', { class: 's-tag' }, `🏢 ${officeName(a.office)}`) : null,
        a.sessions.some((x) => x.live) ? el('span', { class: 's-ok' }, A('sessionOpen')) : null,
        !a.exists ? el('span', { class: 's-bad' }, A('pathMissing')) : !a.available ? el('span', { class: 's-bad' }, A('cliMissing', { agent: HARNESS_NAME[a.harness] })) : null),
      el('div', { class: 'hint' }, tilde(a.path)),
      el('div', { class: 's-entries' }, a.entries.map((e) => el('span', { title: e.description || '' }, e.label))),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(a.id) }, A('sendPrompt')),
        a.registered
          ? [el('button', { type: 'button', class: 's-mini', onclick: () => edit(a) }, A('edit')),
            el('button', { type: 'button', class: 's-mini danger', onclick: () => remove(a) }, A('delete'))]
          : el('button', { type: 'button', class: 's-mini', onclick: () => { st.form = { ...emptyForm(), path: a.path, harness: a.harness, office: a.office, touched: true }; renderForm(); detect(); } }, A('register'))));
    put(box,
      registered.length ? registered.map(card) : el('p', { class: 'hint' }, A('noneWeb')),
      loose.length ? [el('h3', {}, A('loose')), loose.map(card)] : null);
  }

  function renderForm() {
    const f = st.form;
    const box = $('s-agent-form');
    if (!box) return;
    f.office ||= here();
    $('s-form-title').textContent = f.id ? A('editTitle', { name: f.name || f.id }) : A('add');
    let timer = null;
    const pathInput = el('input', { type: 'text', value: f.path, placeholder: A('pathPhWeb'), 'aria-label': A('pathLabel'),
      oninput: (e) => { f.path = e.target.value; clearTimeout(timer); timer = setTimeout(detect, 350); } });
    const d = f.detected;
    const offices = getOffices();
    put(box,
      el('label', { class: 'b-field' }, el('span', {}, A('path')), pathInput),
      el('p', { class: 'hint', id: 's-detected' }, !d ? A('detectHint')
        : !d.exists ? A('detectNone')
          : A('detected', { what: [...d.kinds, ...(d.harnesses.length ? [d.harnesses.map((h) => HARNESS_NAME[h]).join(' + ')] : [])].join(' · ') || A('noHarness'), n: d.entries.length })),
      el('label', { class: 'b-field' }, el('span', {}, A('agent')),
        el('select', { 'aria-label': A('cliLabel'), onchange: (e) => { f.harness = e.target.value; f.touched = true; } },
          option('', A('choose'), !f.harness), ...Object.entries(HARNESS_NAME).map(([id, label]) => option(id, label + (d?.harnesses?.includes(id) ? A('configured') : ''), id === f.harness)))),
      el('label', { class: 'b-field' }, el('span', {}, A('name')), el('input', { type: 'text', value: f.name, placeholder: A('namePh'), maxlength: 40, oninput: (e) => { f.name = e.target.value; } })),
      offices.length > 1 ? el('label', { class: 'b-field' }, el('span', {}, A('office')),
        el('select', { onchange: (e) => { f.office = e.target.value; } }, offices.map((o) => option(o.id, o.name, o.id === f.office)))) : null,
      el('details', {}, el('summary', {}, A('advanced')),
        el('label', { class: 'b-field' }, el('span', {}, A('bin')), el('input', { type: 'text', value: f.bin, placeholder: A('binPh'), oninput: (e) => { f.bin = e.target.value; } })),
        el('label', { class: 'b-field' }, el('span', {}, A('args')), el('input', { type: 'text', value: f.args, placeholder: A('argsPh'), oninput: (e) => { f.args = e.target.value; } })),
        el('p', { class: 'hint' }, A('argsHint'))),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: save }, f.id ? A('saveChanges') : A('addAgent')),
        f.id || f.path ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.form = emptyForm(); renderForm(); } }, A('cancel')) : null));
  }

  async function detect() {
    const f = st.form;
    if (!f.path.trim()) { f.detected = null; renderForm(); return; }
    const r = await api('POST', '/v1/agents/detect', { path: f.path });
    if (st.form !== f) return;
    f.detected = r.ok ? r : { exists: false, kinds: [], harnesses: [], entries: [] };
    if (!f.touched && r.ok && r.harnesses.length) f.harness = r.harnesses[0];
    const focused = document.activeElement?.getAttribute('aria-label');
    renderForm();
    if (focused) document.querySelector(`#s-agent-form [aria-label="${focused}"]`)?.focus();
  }

  function edit(a) {
    st.form = { ...emptyForm(), id: a.id, path: a.path, harness: a.harness, name: a.name, office: a.office, bin: a.bin || '', args: (a.args || []).join(' '), touched: true };
    renderForm();
    detect();
    $('s-agent-form').scrollIntoView({ block: 'nearest' });
  }

  async function save() {
    const f = st.form;
    const body = { path: f.path, harness: f.harness, name: f.name, office: f.office || here(), bin: f.bin || null, args: f.args.trim() ? f.args.trim().split(/\s+/) : null };
    const r = f.id ? await api('PUT', `/v1/agents/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/agents', body);
    if (!r.ok) return msg(r.error);
    st.form = emptyForm();
    renderForm();
    msg(f.id ? A('updated') : A('added', { name: r.agent?.name }), true);
    onSaved?.();
  }

  async function remove(a) {
    if (!confirm(A('confirmDelete', { name: a.name }))) return;
    const r = await api('DELETE', `/v1/agents/${encodeURIComponent(a.id)}`);
    if (!r.ok) return msg(r.error);
    msg(A('deleted'), true);
  }

  // ------------------------------------------------------------ Personajes

  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const LK = (k, v) => t(`settings.look.${k}`, v);

  function renderLook() {
    st.looks ||= Object.fromEntries(ROLE_ORDER.map((r) => [r, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, TEAM[r][k]]))]));
    const panel = document.querySelector('[data-panel="look"]');
    const cards = ROLE_ORDER.map((role) => {
      const look = st.looks[role];
      const canvas = el('canvas', { 'aria-label': LK('preview', { name: look.name }) });
      const redraw = () => drawSprite(canvas, look);
      const set = (k, v) => { look[k] = v; redraw(); };
      const color = (k) => el('label', {}, el('input', { type: 'color', value: look[k], 'aria-label': LK('of', { label: LK(k), name: look.name }), oninput: (e) => set(k, e.target.value) }), LK(k));
      const toggle = (k) => el('label', {}, el('input', { type: 'checkbox', checked: look[k] ? true : undefined, onchange: (e) => set(k, e.target.checked) }), LK(k));
      redraw();
      return el('div', { class: 's-look' },
        canvas,
        el('div', { class: 'pair' },
          el('input', { type: 'text', value: look.name, maxlength: 20, 'aria-label': LK('name'), oninput: (e) => { look.name = e.target.value; } }),
          el('input', { type: 'text', value: look.title, maxlength: 30, 'aria-label': LK('title'), oninput: (e) => { look.title = e.target.value; } })),
        el('div', { class: 'colors' }, color('shirt'), color('pants'), color('hair'), color('skin')),
        el('div', { class: 'toggles' }, toggle('long'), toggle('beard'), toggle('glasses')),
        el('div', { class: 'toggles' },
          el('span', { class: 'hint' }, LK('role', { role })),
          el('button', { type: 'button', class: 's-mini', title: LK('randomTitle'), onclick: () => { Object.assign(look, { shirt: pickOne(LOOK_PALETTES.shirt), hair: pickOne(LOOK_PALETTES.hair), skin: pickOne(LOOK_PALETTES.skin), pants: pickOne(LOOK_PALETTES.pants), long: Math.random() < 0.5, beard: Math.random() < 0.3, glasses: Math.random() < 0.3 }); renderLook(); } }, '🎲'),
          el('button', { type: 'button', class: 's-mini', title: LK('resetTitle'), onclick: () => { Object.assign(look, DEFAULT_TEAM[role]); renderLook(); } }, '↺')),
      );
    });
    put(panel,
      el('p', { class: 'hint' }, `${getOffice()?.name ? `🏢 ${getOffice().name} · ` : ''}${LK('hint')}`),
      el('div', { class: 's-looks' }, cards));
  }

  async function saveLook() {
    const appearance = {};
    for (const role of ROLE_ORDER) {
      const look = st.looks[role];
      const changed = Object.fromEntries(APPEARANCE_KEYS.filter((k) => look[k] !== DEFAULT_TEAM[role][k]).map((k) => [k, look[k]]));
      appearance[role] = Object.keys(changed).length ? changed : null;
    }
    const r = await api('PUT', '/v1/settings', { appearance, office: here() });
    if (!r.ok) return msg(r.error);
    msg(LK('saved'), true);
    onSaved?.();
  }

  // ------------------------------------------------------------ eventos

  for (const b of document.querySelectorAll('#settings .tabs button')) b.onclick = () => { msg(''); show(b.dataset.tab); };
  $('settings-close').onclick = $('settings-cancel').onclick = () => $('settings').close();
  $('settings-save').onclick = () => st.tab === 'look' && saveLook();
  $('settings-form').onsubmit = (e) => e.preventDefault();

  return { open, refresh };
}
