// ⚙ Settings in the web view. The office is the frontend and keeps its own data in its SQLite database:
//   General      game language, the company's time zone and city, real weather, herdr and the log
//   Offices      the company's offices (teams or domains): name, time zone and city
//   Agents       the maintainer: each agent is a full path + the CLI that serves it + its
//                office. What its harness brings (Errementari, commands, prompts, .devteam/) is
//                detected, and a prompt sent from the whiteboard starts THAT pipeline.
//   Characters   how the characters of the office being watched look.

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES, SEXES, PERSONALITIES, STYLES, randomLook, lookForSex } from './sim.js';
import { exportCharacter, parseCharacter, characterFile } from './character.js';
import { drawSprite } from './sprite.js';
import { t, LANGUAGES, getLanguage } from './i18n.js';
import { allZones, zoneInfo, countryName } from './clock.js';
import { parsePlace } from './sky.js';
import { MODEL_ROLES, PROFILE_HARNESSES } from './models.js';

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

const emptyForm = () => ({ id: null, path: '', harness: '', name: '', bin: '', args: '', office: null, instructions: '', detected: null, touched: false });
const emptyOffice = () => ({ id: null, name: '', timezone: '', location: '', instructions: '', autonomy: '' });
const AUTONOMY = ['guided', 'balanced', 'autonomous'];

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

/** The name of a stored city, without its coordinates. */
const placeName = (location) => parsePlace(location)?.name || String(location || '');

/**
 * A city field: type to search among the cities of the time zone's country (Open-Meteo, through the
 * office); the one picked is saved with its coordinates. Empty: the zone's city. Without a
 * connection, what was typed is saved as is (a name or "lat, lon").
 */
function cityInput({ value, timezone, placeholder, label, onPick }) {
  const id = `city-${Math.random().toString(36).slice(2, 8)}`;
  const C = (k, v) => t(`settings.general.${k}`, v);
  const list = el('datalist', { id });
  const input = el('input', { type: 'text', value: placeName(value), placeholder, list: id, 'aria-label': label, autocomplete: 'off', maxlength: 80 });
  const note = el('span', { class: 'hint tz-country' }, '');
  const country = zoneInfo(timezone).country;
  let found = [], offline = false, timer = null, seq = 0;
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { found = []; list.replaceChildren(); note.textContent = ''; return; }
    timer = setTimeout(async () => {
      const n = ++seq;
      const r = await api('GET', `/v1/places?q=${encodeURIComponent(q)}&timezone=${encodeURIComponent(timezone || '')}`);
      if (n !== seq || !r.ok) return;
      found = r.places || [];
      offline = !!r.offline;
      list.replaceChildren(...found.map((p) => option(p.label, countryName(p.country, getLanguage()))));
      note.textContent = offline ? C('cityOffline') : found.length ? '' : C('cityNone', { country: countryName(country, getLanguage()) || country || '' });
    }, 250);
  };
  input.onchange = () => {
    const v = input.value.trim(), low = v.toLowerCase();
    if (!v) { note.textContent = ''; onPick(null); return; }
    const hit = found.find((p) => p.label.toLowerCase() === low) || found.find((p) => p.name.toLowerCase() === low) || (found.length === 1 ? found[0] : null);
    if (hit) { input.value = hit.label; note.textContent = ''; onPick(hit.location); return; }
    if (offline) onPick(v);
  };
  return [input, list, note];
}

/**
 * @param getOffices/getOffice  the offices and the one being watched
 * @param getPrefs/getHerdr     the general settings and herdr's state (they arrive over WebSocket)
 * @param onView                (id) => watch another office
 */
export function createSettings({ getTargets = () => [], getOffices = () => [], getOffice = () => null, getPrefs = () => null, getHerdr = () => null, onPrompt, onView, onSaved, alerts } = {}) {
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
    $('settings-save').hidden = tab !== 'look' && tab !== 'models';
    $('s-file').textContent = st.data ? t('settings.file', { file: tilde(st.data.office.file) }) : '';
    if (tab === 'general') { renderGeneral(); indexStatus(); }
    else if (tab === 'offices') { renderOffices(); loadProjects(); }
    else if (tab === 'agents') renderAgents();
    else if (tab === 'models') { st.models = null; renderModels(); }
    else { st.looks = null; renderLook(); }
  }

  /** How the archive is indexed: chunks, and how many have their embedding. */
  async function indexStatus() {
    const r = await api('GET', '/v1/archive/index');
    const box = $('s-index');
    if (!r.ok || !box) return;
    box.textContent = t('settings.general.indexStatus', { chunks: r.chunks, embedded: r.embedded }) + (r.error ? ` · ⚠ ${r.error}` : r.running ? ' · …' : '');
  }

  /** Something new arrived (agents, offices, settings, the language…): the tab is redrawn. */
  function refresh(all = false) {
    if (!$('settings').open) return;
    if (st.tab === 'agents') return renderList();
    if (all || st.tab === 'general' || st.tab === 'offices') show(st.tab);
  }
  /** The watched office's characters changed (another office chosen, or saved): Characters shows them. */
  function appearanceChanged() {
    if (!$('settings').open || st.tab !== 'look' || (!st.pendingLook && !st.saved)) return;
    st.pendingLook = st.saved = false;
    st.looks = null;
    renderLook();
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
      el('label', { class: 'b-field' }, el('span', {}, G('city')),
        el('span', { class: 'tz-field' }, cityInput({ value: p.city, timezone: p.timezone || st.data?.systemZone, placeholder: G('cityZone', { city: zoneInfo(p.timezone || st.data?.systemZone).city || '' }), label: G('city'), onPick: (c) => setPref({ city: c }) }))),
      el('p', { class: 'hint' }, G('cityHint')),
      check(p.weather, `${G('weather')}: ${G(p.weather ? 'weatherOn' : 'weatherOff')}`, (e) => setPref({ weather: e.target.checked })),
      check(p.log?.life, G('life'), (e) => setPref({ log: { life: e.target.checked } })),
      // autonomy: the analyst reviews each brief first, and the agents work to the end on their own
      el('h3', {}, G('autonomy')),
      check(p.autonomy?.clarify !== false, G('clarify'), (e) => setPref({ autonomy: { clarify: e.target.checked } })),
      check(p.autonomy?.autonomous !== false, G('autonomous'), (e) => setPref({ autonomy: { autonomous: e.target.checked } })),
      // the archive as a RAG: its chunks go on top of every brief; embeddings for the semantic search
      el('h3', {}, G('archive')),
      check(p.archive?.push !== false, G('archivePush'), (e) => setPref({ archive: { push: e.target.checked } })),
      el('label', { class: 'b-field' }, el('span', {}, G('embeddings')),
        el('select', { onchange: (e) => setPref({ archive: { embeddings: e.target.value } }) }, ['off', 'ollama', 'openai'].map((x) => option(x, G(`embed_${x}`), x === (p.archive?.embeddings || 'off'))))),
      p.archive?.embeddings && p.archive.embeddings !== 'off' ? [
        el('label', { class: 'b-field' }, el('span', {}, G('embedModel')), el('input', { type: 'text', value: p.archive.model || '', placeholder: p.archive.embeddings === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small', onchange: (e) => setPref({ archive: { model: e.target.value } }) })),
        el('label', { class: 'b-field' }, el('span', {}, G('embedUrl')), el('input', { type: 'text', value: p.archive.url || '', placeholder: p.archive.embeddings === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1', onchange: (e) => setPref({ archive: { url: e.target.value } }) })),
        el('p', { class: 'hint' }, G(p.archive.embeddings === 'ollama' ? 'embedOllamaHint' : 'embedKeyHint')),
      ] : null,
      el('p', { class: 'hint', id: 's-index' }),
      el('div', { class: 's-row' }, el('button', { type: 'button', class: 's-mini', onclick: async () => { await api('POST', '/v1/archive/reindex', {}); indexStatus(); } }, G('reindex'))),
      // when they wait for you (this browser's own: a sound, a system notification)
      alerts ? check(alerts.get().sound, t('attention.sound'), (e) => alerts.set({ sound: e.target.checked })) : null,
      alerts && 'Notification' in window ? check(alerts.get().notify, t('attention.notify'), async (e) => {
        const on = e.target.checked && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted');
        alerts.set({ notify: on });
        e.target.checked = on;
      }) : null,
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

  /**
   * The departments maintainer: each department is an office of the company, with its projects
   * (repositories and their agents), its people (the characters), its instructions (how to work
   * there), its time zone and its weather.
   */
  function renderOffices() {
    const panel = document.querySelector('[data-panel="offices"]');
    const O = (k, v) => t(`settings.offices.${k}`, v);
    const p = getPrefs() || st.data?.office.prefs || {};
    const company = p.timezone || st.data?.systemZone || '';
    const projects = st.projects || getTargets().filter((x) => x.registered);
    const cards = getOffices().map((o) => {
      const mine = projects.filter((a) => a.office === o.id);
      const others = projects.filter((a) => a.office !== o.id);
      return el('div', { class: 's-agent s-dept' },
        el('div', { class: 's-agent-head' },
          el('b', {}, o.name), o.id === 'main' ? el('span', { class: 's-tag' }, O('main')) : null,
          el('span', { class: 's-tag kind' }, tzLabel(o.timezone)),
          o.instructions ? el('span', { class: 's-tag kind', title: o.instructions }, O('hasInstructions')) : null,
          o.autonomy ? el('span', { class: 's-tag kind', title: O(`autonomyHint.${o.autonomy}`) }, `🤖 ${O(`autonomyLevel.${o.autonomy}`)}`) : null,
          o.id === here() ? el('span', { class: 's-ok' }, O('viewing')) : null),
        el('div', { class: 'hint' }, `${o.place?.name ? `📍 ${o.place.name}` : ''}${o.ownTimezone ? '' : `${o.place?.name ? ' · ' : ''}${O('inherit', { tz: company })}`}`),
        o.instructions ? el('p', { class: 's-dept-text' }, o.instructions) : null,
        // its projects: the repositories of the company that work for it
        el('div', { class: 's-dept-k' }, `${O('projects')} (${mine.length})`),
        el('div', { class: 's-entries' }, mine.length ? mine.map((a) => el('span', { title: `${tilde(a.path)}${a.instructions ? `\n📋 ${a.instructions}` : ''}` }, `${a.name} · ${HARNESS_NAME[a.harness] || a.harness}${a.instructions ? ' 📋' : ''}`)) : el('span', { class: 'hint' }, O('noProjects'))),
        el('div', { class: 's-row' },
          el('button', { type: 'button', class: 's-mini', onclick: () => { st.form = { ...emptyForm(), office: o.id }; show('agents'); } }, O('addProject')),
          others.length ? el('select', { class: 's-mini', 'aria-label': O('moveHere'), onchange: async (e) => {
            if (!e.target.value) return;
            const r = await api('PUT', `/v1/agents/${encodeURIComponent(e.target.value)}`, { office: o.id });
            if (!r.ok) return msg(r.error);
            onSaved?.();
            loadProjects();
          } }, option('', O('moveHere'), true), others.map((a) => option(a.id, `${a.name} · ${HARNESS_NAME[a.harness] || a.harness}`))) : null),
        // its people: the characters of that office
        el('div', { class: 's-row' },
          o.id !== here() ? el('button', { type: 'button', class: 's-mini', onclick: () => { onView?.(o.id); $('settings').close(); } }, `👁 ${O('view')}`) : null,
          el('button', { type: 'button', class: 's-mini', onclick: () => { if (o.id !== here()) { st.pendingLook = true; onView?.(o.id); } show('look'); } }, `👥 ${O('editPeople')}`),
          el('button', { type: 'button', class: 's-mini', onclick: () => { st.office = { id: o.id, name: o.custom ? o.name : '', timezone: o.ownTimezone || '', location: o.location || '', instructions: o.instructions || '', autonomy: o.autonomy || '' }; renderOffices(); $('s-office-form')?.scrollIntoView({ block: 'nearest' }); } }, O('edit')),
          o.id !== 'main' ? el('button', { type: 'button', class: 's-mini danger', onclick: () => removeOffice(o) }, O('delete')) : null));
    });
    const f = st.office;
    const editing = getOffices().find((o) => o.id === f.id);
    // the company's standards (the CTO's) and how much a department takes at once (operations)
    const companyBox = el('div', { class: 's-form s-company' },
      el('label', { class: 'note' }, el('span', {}, O('standards')),
        el('textarea', { id: 's-standards', rows: 3, maxlength: 4000, placeholder: O('standardsPh') }, p.standards || '')),
      el('label', { class: 'b-field' }, el('span', {}, O('capacity')),
        el('input', { id: 's-capacity', type: 'number', min: 1, max: 20, value: p.capacity || 3, class: 's-num' })),
      el('p', { class: 'hint' }, O('capacityHint')),
      el('div', { class: 's-row' }, el('button', { type: 'button', class: 'btn', onclick: () => setPref({ standards: $('s-standards').value, capacity: Number($('s-capacity').value) || 3 }) }, O('saveCompany'))));
    put(panel,
      el('p', { class: 'hint' }, O('hint')),
      el('h3', {}, O('companyTitle')),
      companyBox,
      el('h3', {}, O('departments')),
      el('div', { class: 's-agents' }, cards),
      el('h3', {}, editing ? O('editTitle', { name: editing.name }) : O('newTitle')),
      el('div', { class: 's-form', id: 's-office-form' },
        el('label', { class: 'b-field' }, el('span', {}, O('name')), el('input', { type: 'text', value: f.name, maxlength: 40, oninput: (e) => { f.name = e.target.value; } })),
        el('label', { class: 'note' }, el('span', {}, O('instructions')),
          el('textarea', { rows: 4, maxlength: 4000, placeholder: O('instructionsPh'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions || '')),
        el('label', { class: 'b-field' }, el('span', {}, O('autonomy')),
          el('select', { onchange: (e) => { f.autonomy = e.target.value; renderOffices(); } },
            option('', O('autonomyCompany'), !f.autonomy), AUTONOMY.map((l) => option(l, O(`autonomyLevel.${l}`), f.autonomy === l)))),
        el('p', { class: 'hint' }, f.autonomy ? O(`autonomyHint.${f.autonomy}`) : O('autonomyCompanyHint')),
        el('label', { class: 'b-field' }, el('span', {}, O('timezone')),
          el('span', { class: 'tz-field' }, zoneInput({ value: f.timezone, placeholder: O('inherit', { tz: company }), label: O('timezone'), onPick: (z) => {
            // another country: its city is no longer valid
            if (zoneInfo(z || company).country !== zoneInfo(f.timezone || company).country) f.location = '';
            f.timezone = z || ''; renderOffices();
          } }))),
        el('label', { class: 'b-field' }, el('span', {}, O('location')),
          el('span', { class: 'tz-field' }, cityInput({ value: f.location, timezone: f.timezone || company, label: O('location'), onPick: (c) => { f.location = c || ''; },
            placeholder: !f.timezone && p.city ? O('cityInherit', { city: placeName(p.city) }) : O('locationPh', { city: zoneInfo(f.timezone || company).city || '' }) }))),
        el('div', { class: 's-row' },
          el('button', { type: 'button', class: 'btn', onclick: saveOffice }, f.id ? O('saveChanges') : O('add')),
          f.id ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.office = emptyOffice(); renderOffices(); } }, O('cancel')) : null)));
  }

  /** Every department's projects (the page only has the watched office's). */
  async function loadProjects() {
    const r = await api('GET', '/v1/agents');
    if (!r.ok) return;
    st.projects = (r.agents || []).filter((a) => a.registered);
    if (st.tab === 'offices' && $('settings').open) renderOffices();
  }

  async function saveOffice() {
    const f = st.office;
    const body = { name: f.name, timezone: f.timezone || null, location: f.location || null, instructions: f.instructions || '', autonomy: f.autonomy || null };
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
        a.instructions ? el('span', { class: 's-tag kind', title: a.instructions }, A('hasInstructions')) : null,
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
      // how to work with this project: it goes with every brief, pipeline and question to its folder
      el('label', { class: 'note' }, el('span', {}, A('instructions')),
        el('textarea', { rows: 4, maxlength: 4000, placeholder: A('instructionsPh'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions || '')),
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
    st.form = { ...emptyForm(), id: a.id, path: a.path, harness: a.harness, name: a.name, office: a.office, bin: a.bin || '', args: (a.args || []).join(' '), instructions: a.instructions || '', touched: true };
    renderForm();
    detect();
    $('s-agent-form').scrollIntoView({ block: 'nearest' });
  }

  async function save() {
    const f = st.form;
    const body = { path: f.path, harness: f.harness, name: f.name, office: f.office || here(), bin: f.bin || null, args: f.args.trim() ? f.args.trim().split(/\s+/) : null, instructions: f.instructions };
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

  const LK = (k, v) => t(`settings.look.${k}`, v);

  /**
   * A color: its palette as swatches (one click) and, at the end, the browser's color picker for
   * any other one (the chosen color shows there if it is not in the palette).
   */
  function colorField(look, k, set) {
    const palette = LOOK_PALETTES[k];
    const name = LK('of', { label: LK(k), name: look.name });
    const custom = !palette.includes(look[k]);
    return el('div', { class: 's-color', role: 'radiogroup', 'aria-label': name },
      el('span', { class: 's-color-k' }, LK(k)),
      palette.map((c) => el('button', {
        type: 'button', class: 's-swatch', role: 'radio', 'aria-checked': String(look[k] === c), 'aria-label': `${LK(k)} ${c}`, title: c,
        style: `--c:${c}`, onclick: () => set(k, c),
      })),
      el('label', { class: `s-swatch s-more${custom ? ' on' : ''}`, title: LK('moreColors'), style: `--c:${look[k]}` },
        el('input', { type: 'color', value: look[k], 'aria-label': `${name} · ${LK('pickColor')}`, oninput: (e) => set(k, e.target.value, false), onchange: () => renderLook() }),
        '+'));
  }

  function renderLook() {
    st.looks ||= Object.fromEntries(ROLE_ORDER.map((r) => [r, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, TEAM[r][k]]))]));
    const panel = document.querySelector('[data-panel="look"]');
    const cards = ROLE_ORDER.map((role) => {
      const look = st.looks[role];
      const canvas = el('canvas', { 'aria-label': LK('preview', { name: look.name }) });
      const redraw = () => drawSprite(canvas, look);
      // a click on a swatch redraws the card (to mark it); the free picker only the preview while dragging
      const set = (k, v, again = true) => { look[k] = v; if (again) renderLook(); else redraw(); };
      const toggle = (k) => el('label', {}, el('input', { type: 'checkbox', checked: look[k] ? true : undefined, onchange: (e) => set(k, e.target.checked, false) }), LK(k));
      const select = (k, values, label) => el('label', { class: 's-pick' }, el('span', {}, LK(k)),
        el('select', { 'aria-label': LK('of', { label: LK(k), name: look.name }), onchange: (e) => (k === 'sex' ? (Object.assign(look, lookForSex(e.target.value)), renderLook()) : set(k, e.target.value, false)) },
          values.map((v) => option(v, label(v), look[k] === v))));
      redraw();
      return el('div', { class: 's-look' },
        canvas,
        el('div', { class: 'pair' },
          el('input', { type: 'text', value: look.name, maxlength: 20, 'aria-label': LK('name'), oninput: (e) => { look.name = e.target.value; } }),
          el('input', { type: 'text', value: look.title, maxlength: 30, 'aria-label': LK('title'), oninput: (e) => { look.title = e.target.value; } })),
        el('div', { class: 'pair' },
          select('sex', SEXES, (v) => LK(`sexes.${v}`)),
          select('personality', Object.keys(PERSONALITIES), (v) => LK(`personalities.${v}`))),
        el('div', { class: 'pair' },
          select('style', STYLES, (v) => LK(`styles.${v}`)),
          el('div', { class: 's-share' },
            el('button', { type: 'button', class: 's-mini', title: LK('exportTitle', { name: look.name }), onclick: () => download(role, look) }, LK('export')),
            el('button', { type: 'button', class: 's-mini', title: LK('importTitle'), onclick: () => upload(role) }, LK('import')))),
        el('div', { class: 'colors' }, colorField(look, 'skin', set), colorField(look, 'hair', set), colorField(look, 'shirt', set), colorField(look, 'pants', set)),
        el('div', { class: 'toggles' }, toggle('long'), toggle('beard'), toggle('glasses')),
        el('div', { class: 'toggles' },
          el('span', { class: 'hint' }, role === 'po' ? `${LK('role', { role })} · ${LK('you')}` : LK('role', { role })),
          el('button', { type: 'button', class: 's-mini', title: LK('randomTitle'), onclick: () => { Object.assign(look, randomLook(look.sex)); renderLook(); } }, '🎲'),
          el('button', { type: 'button', class: 's-mini', title: LK('resetTitle'), onclick: () => { Object.assign(look, DEFAULT_TEAM[role]); renderLook(); } }, '↺')),
      );
    });
    // keep the scroll and the focus where they were (a swatch redraws the panel)
    const box = panel.closest('.brief-body'), top = box?.scrollTop, focus = document.activeElement?.getAttribute('aria-label');
    put(panel,
      el('p', { class: 'hint' }, `${getOffice()?.name ? `🏢 ${getOffice().name} · ` : ''}${LK('hint')}`),
      el('div', { class: 's-looks' }, cards));
    if (box) box.scrollTop = top;
    if (focus) [...panel.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === focus)?.focus();
  }

  // A character as a JSON file (public/character.js): to share them, and to bring one in.
  function download(role, look) {
    const blob = new Blob([`${JSON.stringify(exportCharacter(role, look), null, 2)}\n`], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: characterFile(role, look.name) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function upload(role) {
    const input = el('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
      const file = input.files?.[0];
      if (!file) return;
      const c = parseCharacter(await file.text());
      if (!c.ok) return msg(t(`err.character.${c.error}`));
      Object.assign(st.looks[role], c.look);
      renderLook();
      msg(LK('imported', { name: st.looks[role].name }), true);
    } });
    input.click();
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

  // ------------------------------------------------------------ Models (profiles: public/models.js)

  function renderModels() {
    const panel = document.querySelector('[data-panel="models"]');
    const p = getPrefs() || st.data?.office.prefs;
    if (!p?.models) return;
    st.models ||= structuredClone(p.models);
    const m = st.models;
    const M = (k, v) => t(`settings.models.${k}`, v);
    const roleName = (role) => (role === 'default' ? M('default') : `${TEAM[role]?.name || role} · ${t(`team.titles.${role}`)}`);
    const card = ([id, prof]) => el('fieldset', { class: 's-profile' },
      el('legend', {}, `${prof.label} · ${id}`),
      el('label', { class: 'b-field' }, el('span', {}, M('label')),
        el('input', { type: 'text', value: prof.label, maxlength: 30, oninput: (e) => { prof.label = e.target.value; } })),
      el('div', { class: 'toggles' }, el('span', { class: 'hint' }, M('for')),
        PROFILE_HARNESSES.map((h) => el('label', {}, el('input', {
          type: 'checkbox', checked: prof.harnesses.includes(h) ? true : undefined,
          onchange: (e) => { prof.harnesses = e.target.checked ? [...new Set([...prof.harnesses, h])] : prof.harnesses.filter((x) => x !== h); },
        }), HARNESS_NAME[h] || h))),
      el('div', { class: 's-roles' }, MODEL_ROLES.map((role) => el('label', { class: 'b-field' }, el('span', {}, roleName(role)),
        el('input', {
          type: 'text', value: prof.roles[role] || '', spellcheck: 'false',
          placeholder: role === 'default' ? 'provider/model' : M('same', { model: prof.roles.default || '' }),
          oninput: (e) => { const v = e.target.value.trim(); if (v) prof.roles[role] = v; else delete prof.roles[role]; },
        })))),
      el('button', { type: 'button', class: 'btn ghost', disabled: Object.keys(m.profiles).length < 2 ? true : undefined,
        onclick: () => { delete m.profiles[id]; if (m.active === id) m.active = null; renderModels(); } }, M('remove')));
    const add = () => {
      let n = 1;
      while (m.profiles[`perfil-${n}`]) n++;
      const base = Object.values(m.profiles)[0];
      m.profiles[`perfil-${n}`] = { label: M('newLabel', { n }), harnesses: [...PROFILE_HARNESSES], roles: { default: base?.roles.default || '' } };
      renderModels();
    };
    put(panel,
      el('p', { class: 'hint' }, M('hint')),
      el('label', { class: 'b-field' }, el('span', {}, M('active')),
        el('select', { onchange: (e) => { m.active = e.target.value === 'none' ? null : e.target.value; } },
          option('none', t('brief.ownModel'), !m.active), Object.entries(m.profiles).map(([id, prof]) => option(id, prof.label, id === m.active)))),
      el('div', { class: 's-profiles' }, Object.entries(m.profiles).map(card)),
      el('button', { type: 'button', class: 'btn ghost', onclick: add }, M('add')));
  }

  // ------------------------------------------------------------ eventos

  for (const b of document.querySelectorAll('#settings .tabs button')) b.onclick = () => { msg(''); show(b.dataset.tab); };
  $('settings-close').onclick = $('settings-cancel').onclick = () => $('settings').close();
  $('settings-save').onclick = () => (st.tab === 'look' ? saveLook() : st.tab === 'models' ? setPref({ models: st.models }) : null);
  $('settings-form').onsubmit = (e) => e.preventDefault();

  return { open, refresh, appearanceChanged };
}
