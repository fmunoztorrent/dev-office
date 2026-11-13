// ⚙ Settings in the web view. The office is the frontend and keeps its own data in its SQLite database:
//   General      game language, the company's time zone and city, real weather, herdr and the log
//   Offices      the company's offices (teams or domains): name, time zone and city
//   Agents       the maintainer: each agent is a full path + the CLI that serves it + its
//                office. What its harness brings (Errementari, commands, prompts, .devteam/) is
//                detected, and a prompt sent from the whiteboard starts THAT pipeline.
//   Characters   how the characters of the office being watched look.
//   Mine         what is yours, not the company's: your private skills and your own tools (server/mine.js).

import { personOf, defaultLook, VISITORS, APPEARANCE_KEYS, LOOK_PALETTES, SEXES, PERSONALITIES, STYLES, randomLook, lookForSex } from './sim.js';
import { exportCharacter, parseCharacter, characterFile } from './character.js';
import { drawSprite } from './sprite.js';
import { t, LANGUAGES, getLanguage } from './i18n.js';
import { allZones, zoneInfo, countryName } from './clock.js';
import { parsePlace } from './sky.js';
import { MODEL_ROLES, PROFILE_HARNESSES } from './models.js';

const ROLE_ORDER = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer', 'devops', 'security']; // the last two: the visiting specialists
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
    else if (tab === 'mine') renderMine();
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
      // the agents' context: past the limit it is compacted on its own (server/compact.js)
      compactGroup(p.compact || { auto: true, at: 400000, unit: 'tokens' }, G, check),
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
          agents.map((a) => option(a.id, `${a.name} · ${HARNESS_NAME[a.harness]}`, a.id === p.herdr.startAgent)))),
      // your settings as a JSON file: to keep them, share them or take them to another machine
      el('h3', {}, G('io')),
      el('p', { class: 'hint' }, G('ioHint')),
      el('div', { class: 's-row' },
        el('a', { class: 's-mini', href: '/v1/settings/export', download: '' }, G('ioExport')),
        el('button', { type: 'button', class: 's-mini', onclick: importSettingsFile }, G('ioImport'))),
      el('ul', { class: 'hint s-io', id: 's-io' }));
  }

  /** The auto-compaction: on or off, and its limit (in thousands of tokens, or a share of the window). */
  function compactGroup(c, G, check) {
    const pct = c.unit === 'pct';
    const save = () => {
      const unit = $('s-compact-unit').value;
      const n = Number($('s-compact-at').value) || 0;
      setPref({ compact: { unit, at: unit === 'pct' ? n : n * 1000 } });
    };
    return [
      el('h3', {}, G('compact')),
      check(c.auto, G('compactAuto'), (e) => setPref({ compact: { auto: e.target.checked } })),
      el('label', { class: 'b-field' }, el('span', {}, G('compactAt')),
        el('span', { class: 's-compact' },
          el('input', { id: 's-compact-at', type: 'number', class: 's-num', min: 10, max: pct ? 99 : 10000, step: pct ? 1 : 10, value: pct ? c.at : Math.round(c.at / 1000), onchange: save, disabled: c.auto ? undefined : true }),
          el('select', { id: 's-compact-unit', 'aria-label': G('compactAt'), disabled: c.auto ? undefined : true, onchange: (e) => setPref({ compact: { unit: e.target.value } }) },
            option('tokens', `k ${G('compact_tokens')}`, !pct), option('pct', G('compact_pct'), pct)))),
      el('p', { class: 'hint' }, G('compactHint')),
    ];
  }

  /** ⬆ Import: a settings file (server/settings-io.js); what it brings replaces what is here, the rest stays. */
  function importSettingsFile() {
    const input = el('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
      const file = input.files?.[0];
      if (!file) return;
      let body;
      try { body = JSON.parse(await file.text()); } catch { return msg(t('err.settingsFile.json')); }
      const r = await api('POST', '/v1/settings/import', body);
      if (!r.ok) return msg(r.error);
      await load();
      msg(t('settings.general.ioDone', r.applied), true);
      onSaved?.();
      show('general');
      // what could not be brought (a project whose folder is not on this machine…)
      if (r.skipped?.length) $('s-io').replaceChildren(...r.skipped.map((x) => el('li', {}, `✖ ${x.what}: ${x.error}`)));
    } });
    input.click();
  }

  // ------------------------------------------------------------ Mine: your private skills and your own tools

  const TOOL_RUNS = ['sh', 'bash', 'node', 'python3'];
  /** An entry as its form edits it (a tool's parameters, one per line: "name: what it is", "name?" optional). */
  const mineForm = (e = {}, kind = e.kind) => ({
    kind, id: e.id || null, name: e.name || '', title: e.title || '', body: e.body || '', enabled: e.enabled !== false,
    run: e.config?.run || 'sh', timeout: e.config?.timeout || 60, role: e.config?.role || '',
    params: (e.config?.params || []).map((p) => `${p.name}${p.required ? '' : '?'}${p.description ? `: ${p.description}` : ''}`).join('\n'),
  });
  const paramsOf = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:?\s]+)(\?)?\s*(?::\s*(.*))?$/) || [];
    return { name: (m[1] || l).toLowerCase(), required: !m[2], description: m[3] || '' };
  });
  const minePayload = (f) => ({
    kind: f.kind, name: f.name.trim(), title: f.title, body: f.body, enabled: f.enabled,
    ...(f.kind === 'tool' ? { config: { run: f.run, params: paramsOf(f.params), timeout: Number(f.timeout) || 60, ...(f.role ? { role: f.role } : {}) } } : {}),
  });

  async function saveMine(f) {
    const r = await api(f.id ? 'PUT' : 'POST', f.id ? `/v1/mine/${encodeURIComponent(f.id)}` : '/v1/mine', minePayload(f));
    if (!r.ok) { msg(r.error); return false; }
    const M = (k, v) => t(`settings.mine.${k}`, v);
    const clash = (r.installed || []).find((x) => !x.ok && x.reason === 'exists');
    const where = (r.installed || []).filter((x) => x.ok).map((x) => tilde(x.dir)).join(' · ');
    msg(clash ? M('conflict', { name: r.entry.name, dir: tilde(clash.dir) }) : where ? M('installed', { where }) : M('saved'), !clash);
    return true;
  }

  async function renderMine() {
    const panel = document.querySelector('[data-panel="mine"]');
    const M = (k, v) => t(`settings.mine.${k}`, v);
    const r = await api('GET', '/v1/mine');
    if (!r.ok) return msg(r.error);
    const f = st.mineForm;
    const dirs = (r.dirs || []).map((d) => tilde(d.dir)).join(' · ') || M('noDirs');
    const row = (e) => el('li', { class: `s-mine-row${e.enabled ? '' : ' off'}` },
      el('span', { class: 's-mine-name' }, e.kind === 'tool' ? `🧰 my_${e.name.replace(/-/g, '_')}` : `📘 ${e.name}`),
      el('span', { class: 'hint s-mine-title' }, e.title),
      el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: e.enabled ? true : undefined, onchange: async (ev) => { if (await saveMine({ ...mineForm(e), enabled: ev.target.checked })) renderMine(); } }), M(e.enabled ? 'on' : 'off')),
      el('button', { type: 'button', class: 's-mini', onclick: () => { st.mineForm = mineForm(e); renderMine(); } }, M('edit')),
      el('button', { type: 'button', class: 's-mini', onclick: async () => {
        if (!confirm(M('removeConfirm', { name: e.name }))) return;
        const x = await api('DELETE', `/v1/mine/${encodeURIComponent(e.id)}`);
        if (!x.ok) return msg(x.error);
        if (st.mineForm?.id === e.id) st.mineForm = null;
        msg(M('removed'), true);
        renderMine();
      } }, M('remove')));
    const list = (items) => (items.length ? el('ul', { class: 's-mine' }, items.map(row)) : el('p', { class: 'hint' }, M('none')));
    const field = (label, input) => el('label', { class: 'b-field' }, el('span', {}, label), input);
    const bind = (k) => (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const form = () => el('div', { class: 's-mine-form' },
      field(M('name'), el('input', { type: 'text', value: f.name, placeholder: M('namePh'), maxlength: 40, oninput: bind('name') })),
      field(M('title'), el('input', { type: 'text', value: f.title, placeholder: M('titlePh'), maxlength: 300, oninput: bind('title') })),
      f.kind === 'tool' ? [
        field(M('run'), el('select', { onchange: bind('run') }, TOOL_RUNS.map((x) => option(x, x, x === f.run)))),
        field(M('script'), el('textarea', { rows: 8, class: 's-code', spellcheck: 'false', value: f.body, placeholder: f.run === 'python3' ? 'import sys\nprint(sys.argv[1:])' : f.run === 'node' ? 'console.log(process.argv.slice(1))' : 'echo "$1"', oninput: bind('body') })),
        field(M('params'), el('textarea', { rows: 3, value: f.params, placeholder: M('paramsPh'), oninput: bind('params') })),
        field(M('timeout'), el('input', { type: 'number', class: 's-num', min: 1, max: 600, value: f.timeout, oninput: bind('timeout') })),
        field(M('role'), el('select', { onchange: bind('role') }, option('', M('roleAuto'), !f.role), ROLE_ORDER.filter((x) => x !== 'po').map((x) => option(x, `${personOf(x)?.name || x} · ${t(`team.titles.${x}`)}`, x === f.role)))),
      ] : field(M('body'), el('textarea', { rows: 10, value: f.body, oninput: bind('body') })),
      el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: f.enabled ? true : undefined, onchange: bind('enabled') }), M('enabled')),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: async () => { if (await saveMine(f)) { st.mineForm = null; renderMine(); } } }, M('save')),
        el('button', { type: 'button', class: 's-mini', onclick: () => { st.mineForm = null; renderMine(); } }, M('cancel'))));
    const add = (kind) => el('div', { class: 's-row' }, el('button', { type: 'button', class: 's-mini', onclick: () => { st.mineForm = mineForm({}, kind); renderMine(); } }, M('add')));
    put(panel,
      el('p', { class: 'hint' }, M('intro')),
      el('h3', {}, M('skills')), el('p', { class: 'hint' }, M('skillsHint', { dirs })),
      list(r.skills), f?.kind === 'skill' ? form() : add('skill'),
      el('h3', {}, M('tools')), el('p', { class: 'hint' }, M('toolsHint')),
      list(r.tools), f?.kind === 'tool' ? form() : add('tool'));
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
        // the components of each project: what a directive can name (detected ones, and the ones you declare)
        mine.length && st.components ? el('div', { class: 's-comps' }, mine.map((a) => componentsRow(a))) : null,
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
      // the systems: a product or business project and its artifacts (repos, or components of one)
      systemsBox(projects),
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
    const [r, map, sys] = await Promise.all([api('GET', '/v1/agents'), api('GET', '/v1/map'), api('GET', '/v1/systems')]);
    if (!r.ok) return;
    st.projects = (r.agents || []).filter((a) => a.registered);
    // each project's components (detected from its folder, and the ones declared): the map the directives use
    st.components = map.ok ? Object.fromEntries(map.departments.flatMap((o) => o.projects).map((p) => [p.id, p.components])) : {};
    st.kinds = map.ok ? Object.fromEntries(map.departments.flatMap((o) => o.projects).map((p) => [p.id, p.kind])) : {};
    st.systems = sys.ok ? sys.systems : [];
    st.kindList = sys.ok ? sys.kinds : ['frontend', 'mobile', 'bff', 'backend', 'worker', 'library', 'data', 'infra', 'other'];
    if (st.tab === 'offices' && $('settings').open) renderOffices();
  }

  /** A project's components: chips (the declared ones can be removed) and ＋ to declare one (name and folder). */
  function componentsRow(a) {
    const O = (k, v) => t(`settings.offices.${k}`, v);
    const list = st.components?.[a.id] || [];
    const name = el('input', { type: 'text', maxlength: 60, placeholder: O('compName'), 'aria-label': O('compName') });
    const where = el('input', { type: 'text', maxlength: 200, placeholder: O('compPath'), 'aria-label': O('compPath') });
    const add = async () => {
      if (!name.value.trim()) return name.focus();
      const r = await api('POST', '/v1/components', { project: a.id, name: name.value.trim(), path: where.value.trim() });
      if (!r.ok) return msg(r.error);
      msg(O('compAdded', { name: r.component.name }), true);
      loadProjects();
    };
    name.onkeydown = where.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    return el('div', { class: 's-comp-row' },
      el('b', {}, `${a.name}:`),
      list.length ? list.map((c) => el('span', { class: `s-comp${c.declared ? ' own' : ''}`, title: [c.path, c.description, c.declared ? O('compDeclared') : O('compDetected')].filter(Boolean).join(' · ') },
        `🧩 ${c.name}`,
        c.declared ? el('button', { type: 'button', class: 's-x', 'aria-label': O('compRemove', { name: c.name }), onclick: async () => { const r = await api('DELETE', `/v1/components/${encodeURIComponent(c.id)}`); if (!r.ok) return msg(r.error); loadProjects(); } }, '✕') : null)) : el('span', { class: 'hint' }, O('compNone')),
      el('span', { class: 's-comp-add' }, name, where, el('button', { type: 'button', class: 's-mini', onclick: add }, O('compAdd'))));
  }

  // ------------------------------------------------------------ Systems (server/systems.js)

  const S = (k, v) => t(`settings.systems.${k}`, v);
  const KIND = (k) => t(`system.kinds.${k}`);
  const emptySystem = () => ({ id: null, name: '', office: here(), team: '', move: true, instructions: '', parts: [] });

  /** The systems: a card each (its team, the order a change goes in and its artifacts), and the form. */
  function systemsBox(projects) {
    const list = st.systems || [];
    const cards = list.map((s) => el('div', { class: 's-agent s-system' },
      el('div', { class: 's-agent-head' },
        el('b', {}, `🧩 ${s.name}`), el('span', { class: 's-tag kind' }, `👥 ${s.officeName || s.office}`),
        s.instructions ? el('span', { class: 's-tag kind', title: s.instructions }, S('hasInstructions')) : null),
      el('div', { class: 's-sys-order' }, s.order.join('  →  ')),
      el('ul', { class: 's-sys-parts' }, s.parts.map((p) => el('li', {},
        el('b', {}, p.name), ` · ${KIND(p.kind)} · `, el('span', { class: 'hint' }, `${p.repo}${p.path ? `/${p.path}` : ''}`),
        p.uses?.length ? ` · ${t('system.uses', { list: p.uses.join(', ') })}` : '',
        p.shared ? el('span', { class: 's-tag', title: S('sharedHint') }, S('shared')) : null,
        p.target ? null : el('span', { class: 's-tag danger' }, S('noRepo'))))),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 's-mini', onclick: () => { onPrompt?.(`system:${s.id}`); } }, `✉ ${S('brief')}`),
        el('button', { type: 'button', class: 's-mini', onclick: () => { st.system = { id: s.id, name: s.name, office: s.office, team: '', move: true, instructions: s.instructions || '', parts: s.parts.map((p) => ({ name: p.name, project: p.target || p.project, component: p.component || '', path: p.path || '', kind: p.kind, uses: [...(p.uses || [])] })) }; renderOffices(); $('s-system-form')?.scrollIntoView({ block: 'nearest' }); } }, S('edit')),
        el('button', { type: 'button', class: 's-mini danger', onclick: async () => {
          if (!confirm(S('confirmDelete', { name: s.name }))) return;
          const r = await api('DELETE', `/v1/systems/${encodeURIComponent(s.id)}`);
          if (!r.ok) return msg(r.error);
          msg(S('deleted'), true);
          loadProjects();
        } }, S('delete')))));
    return [
      el('h3', {}, S('title')),
      el('p', { class: 'hint' }, S('hint')),
      list.length ? el('div', { class: 's-agents' }, cards) : el('p', { class: 'hint' }, S('none')),
      systemForm(projects),
    ];
  }

  function systemForm(projects) {
    const f = st.system ||= emptySystem();
    const kinds = st.kindList || ['other'];
    const rerender = () => { renderOffices(); $('s-system-form')?.scrollIntoView({ block: 'nearest' }); };
    const compsOf = (id) => (st.components?.[id] || []);
    const partRow = (p, i) => {
      const others = f.parts.filter((x, j) => j !== i && x.name);
      return el('div', { class: 's-sys-part' },
        el('input', { type: 'text', value: p.name, maxlength: 60, placeholder: S('partName'), 'aria-label': S('partName'), oninput: (e) => { const was = p.name; p.name = e.target.value; for (const x of f.parts) x.uses = x.uses.map((u) => (u === was ? p.name : u)); } }),
        el('select', { 'aria-label': S('repo'), onchange: (e) => { p.project = e.target.value; p.component = ''; p.path = ''; const a = projects.find((x) => x.id === p.project); if (!p.name && a) p.name = a.name; p.kind = st.kinds?.[p.project] || p.kind; rerender(); } },
          option('', S('pickRepo'), !p.project), projects.map((a) => option(a.id, `${a.name} · ${HARNESS_NAME[a.harness] || a.harness}`, a.id === p.project))),
        compsOf(p.project).length ? el('select', { 'aria-label': S('component'), onchange: (e) => { const c = compsOf(p.project).find((x) => x.name === e.target.value); p.component = c?.name || ''; p.path = c?.path || ''; if (c?.kind && c.kind !== 'other') p.kind = c.kind; rerender(); } },
          option('', S('wholeRepo'), !p.component), compsOf(p.project).map((c) => option(c.name, `🧩 ${c.name}`, c.name === p.component))) : null,
        el('select', { 'aria-label': S('kind'), onchange: (e) => { p.kind = e.target.value; } }, kinds.map((k) => option(k, KIND(k), k === p.kind))),
        others.length ? el('span', { class: 's-sys-uses' }, el('span', { class: 'hint' }, S('uses')),
          others.map((x) => el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: p.uses.includes(x.name) ? true : undefined, onchange: (e) => { p.uses = e.target.checked ? [...p.uses, x.name] : p.uses.filter((u) => u !== x.name); } }), x.name))) : null,
        el('button', { type: 'button', class: 's-x', 'aria-label': S('removePart'), onclick: () => { f.parts.splice(i, 1); for (const x of f.parts) x.uses = x.uses.filter((u) => u !== p.name); rerender(); } }, '✕'));
    };
    return el('div', { class: 's-form', id: 's-system-form' },
      el('h3', {}, f.id ? S('editTitle', { name: f.name }) : S('newTitle')),
      el('label', { class: 'b-field' }, el('span', {}, S('name')), el('input', { type: 'text', value: f.name, maxlength: 60, placeholder: S('namePh'), oninput: (e) => { f.name = e.target.value; } })),
      el('label', { class: 'b-field' }, el('span', {}, S('team')),
        el('select', { onchange: (e) => { if (e.target.value === '@new') { f.team = 'new'; } else { f.team = ''; f.office = e.target.value; } rerender(); } },
          getOffices().map((o) => option(o.id, o.name, !f.team && o.id === f.office)), option('@new', S('ownTeam'), f.team === 'new'))),
      f.team === 'new' ? el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: f.move ? true : undefined, onchange: (e) => { f.move = e.target.checked; } }), S('moveRepos')) : null,
      el('p', { class: 'hint' }, S('teamHint')),
      el('label', { class: 'note' }, el('span', {}, S('instructions')),
        el('textarea', { rows: 3, maxlength: 4000, placeholder: S('instructionsPh'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions || '')),
      el('div', { class: 's-dept-k' }, `${S('parts')} (${f.parts.length})`),
      el('div', { class: 's-sys-form-parts' }, f.parts.map(partRow)),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 's-mini', onclick: () => { f.parts.push({ name: '', project: '', component: '', path: '', kind: 'other', uses: [] }); rerender(); } }, S('addPart')),
        f.parts.length > 1 ? el('button', { type: 'button', class: 's-mini', title: S('suggestHint'), onclick: async () => {
          const r = await api('POST', '/v1/systems/suggest', { parts: f.parts.filter((p) => p.project), redo: true });
          if (!r.ok) return msg(r.error);
          f.parts = r.parts.map((p) => ({ ...p, uses: p.uses || [] }));
          msg(r.order ? S('order', { order: r.order.join(' → ') }) : r.error, !!r.order);
          rerender();
        } }, S('suggest')) : null),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: saveSystem }, f.id ? S('save') : S('create')),
        f.id || f.parts.length || f.name ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.system = emptySystem(); rerender(); } }, S('cancel')) : null));
  }

  async function saveSystem() {
    const f = st.system;
    const body = { name: f.name, office: f.office, instructions: f.instructions, parts: f.parts.filter((p) => p.project).map(({ name, project, component, path: sub, kind, uses }) => ({ name: name || project, project, component, path: sub, kind, uses })), ...(f.team === 'new' ? { team: 'new', move: f.move } : {}) };
    const r = f.id ? await api('PUT', `/v1/systems/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/systems', body);
    if (!r.ok) return msg(r.error);
    msg(r.office ? S('createdTeam', { name: r.system.name, team: r.office.name }) : S('saved', { name: r.system.name }), true);
    st.system = emptySystem();
    if (r.office) { await load(); onSaved?.(); }
    loadProjects();
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
    st.looks ||= Object.fromEntries(ROLE_ORDER.map((r) => [r, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, personOf(r)[k]]))]));
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
          el('span', { class: 'hint', title: VISITORS[role] ? LK('visitorHint') : undefined }, role === 'po' ? `${LK('role', { role })} · ${LK('you')}` : VISITORS[role] ? `${LK('role', { role })} · ${LK('visitor')}` : LK('role', { role })),
          el('button', { type: 'button', class: 's-mini', title: LK('randomTitle'), onclick: () => { Object.assign(look, randomLook(look.sex)); renderLook(); } }, '🎲'),
          el('button', { type: 'button', class: 's-mini', title: LK('resetTitle'), onclick: () => { Object.assign(look, defaultLook(role)); renderLook(); } }, '↺')),
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
      const changed = Object.fromEntries(APPEARANCE_KEYS.filter((k) => look[k] !== defaultLook(role)[k]).map((k) => [k, look[k]]));
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
    const roleName = (role) => (role === 'default' ? M('default') : `${personOf(role)?.name || role} · ${t(`team.titles.${role}`)}`);
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
