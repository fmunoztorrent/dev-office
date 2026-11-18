// ⚙ Settings: an area of its own over the game (not a dialog), with its sections on the left, in groups,
// and a search. The office is the frontend and keeps its own data in its SQLite database.
//
//   The office      General (language, time zone, city, weather) · The game (view, style, sounds)
//   The company     Company (the CTO's standards, capacity) · Departments · Repositories (each one a full
//                   path + the agent that serves it + its department; what its harness brings is detected)
//   Architecture    The map (architecture-ui.js: everything related, from a component to the whole company)
//                   · Projects (a product and its artifacts: server/systems.js) · Infrastructure
//                   (queues, databases, third-party APIs… and who uses them: server/resources.js)
//   The agents      Autonomy · Context (auto-compaction) · Models · Intelligence · Archive (RAG) · Terminal (herdr)
//   The people      Characters · Experts
//   Yours           Mine: your private skills and your own tools (server/mine.js)
//   System          Backup (your settings as a file) · About
//
// Its address is the page's hash: #settings/<section>. A section that keeps a draft (Characters, Models)
// saves with the button at the bottom; the rest saves each change as you make it.

import { personOf, defaultLook, VISITORS, APPEARANCE_KEYS, LOOK_PALETTES, SEXES, PERSONALITIES, STYLES, randomLook, lookForSex, DEFAULT_EXPERT, currentTheme } from './sim.js';
import { ANIME_EXPERT } from './themes.js';
import { exportCharacter, parseCharacter, characterFile } from './character.js';
import { drawSprite } from './sprite.js';
import { t, LANGUAGES, getLanguage } from './i18n.js';
import { allZones, zoneInfo, countryName } from './clock.js';
import { parsePlace } from './sky.js';
import { MODEL_ROLES, PROFILE_HARNESSES } from './models.js';
import { tildeHome as tilde, artifactFolder } from './targets.js';
import { createArchitecture } from './architecture-ui.js';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './settings-sections.js';
import { RESOURCE_ICON as RICON, RESOURCE_KINDS as RKINDS, RESOURCE_LINKS as RHOWS, KIND_ICON } from './impact.js';

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
const option = (value, label, selected) => el('option', { value, selected: selected ? true : undefined }, label);
const tzLabel = (tz) => { const z = zoneInfo(tz); return z.country ? `${tz} · ${countryName(z.country, getLanguage())}` : tz; };

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
}

// The sections and their groups, in the menu's order, are in settings-sections.js.
const ICON = { general: '⚙', game: '🎮', company: '🏛', repos: '📦', architecture: '🗺', infra: '🗄', autonomy: '🤖', context: '🗜', models: '🎛', intelligence: '🧠', archive: '📚', terminal: '🖥', look: '🧑', experts: '🎓', mine: '🔒', backup: '💾', about: 'ℹ' };
// the sections that keep a draft and save with the button
const DRAFTS = new Set(['look', 'models']);
// the ones redrawn when something arrives from the office (they hold no half-written text)
const LIVE = new Set(['general', 'game', 'terminal']);
const DOCS = 'https://github.com/fmunoztorrent/dev-office';
const fold = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const emptyForm = () => ({ id: null, path: '', harness: '', name: '', bin: '', args: '', office: '', kind: '', instructions: '', detected: null, touched: false });
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
 * @param onOffices             (list) => the company's offices, as the API returns them (to redraw them now,
 *                              without waiting for the WebSocket's `offices` message)
 * @param getPrefs/getHerdr     the general settings and herdr's state (they arrive over WebSocket)
 * @param onView                (id) => watch another office
 */
export function createSettings({ getTargets = () => [], getOffices = () => [], getOffice = () => null, getPrefs = () => null, getHerdr = () => null, onPrompt, onView, onSaved, onOffices, alerts } = {}) {
  const st = { tab: 'general', open: false, pushed: false, data: null, looks: null, form: emptyForm(), office: emptyOffice() };
  const msg = (text, ok = false) => { const m = $('s-msg'); m.textContent = text || ''; m.classList.toggle('ok', !!ok && !!text); m.classList.toggle('bad', !ok && !!text); };
  const here = () => getOffice()?.id || 'main';
  const N = (id) => t(`settings.nav.${id}`);
  const groupOf = (id) => SETTINGS_GROUPS.find(([, ids]) => ids.includes(id))?.[0];
  // one panel per section, made once
  const body = $('settings-form');
  body.replaceChildren(...SETTINGS_SECTIONS.map((id) => el('section', { 'data-panel': id, class: 's-panel', hidden: true })));
  const panelOf = (id) => body.querySelector(`[data-panel="${id}"]`);
  /** A group of fields under a title. */
  const card = (title, ...children) => el('section', { class: 'cfg-card' }, title ? el('h3', {}, title) : null, children);
  const prefs = () => getPrefs() || st.data?.office.prefs;
  const check = (checked, label, onchange) => el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: checked ? true : undefined, onchange }), label);
  const G = (k, v) => t(`settings.general.${k}`, v);
  // the map of the architecture (architecture-ui.js): from it you jump to the form of what you picked
  const arch = createArchitecture({
    api,
    say: (text, ok) => msg(text, ok),
    onPrompt: (id) => onPrompt?.(id),
    onGo: (section, what = {}) => { jumpTo(section, what); },
  });

  async function load() {
    const s = await api('GET', `/v1/settings?office=${encodeURIComponent(here())}`);
    if (!s.ok) { msg(s.error); return false; }
    st.data = s;
    return true;
  }

  /** Opens the area on a section (the last one seen, if none is given). */
  async function open(tab = st.tab) {
    const section = SETTINGS_SECTIONS.includes(tab) ? tab : 'general';
    const hash = `#settings/${section}`;
    if (location.hash !== hash) { history[st.open ? 'replaceState' : 'pushState'](null, '', hash); if (!st.open) st.pushed = true; }
    await enter(section);
  }

  async function enter(section) {
    const was = st.open;
    st.open = true;
    st.tab = section;
    const area = $('settings');
    area.hidden = false;
    document.body.classList.add('in-settings');
    if (!was) { $('cfg-search').value = ''; st.back = document.activeElement; }
    renderNav();
    if (!st.data || !was) {
      msg(t('settings.loading'), true);
      if (!(await load())) return;
      msg('');
    }
    if (!st.open) return;
    show(st.tab);
    $('cfg-content').scrollTop = 0;
    if (!was) $('cfg-content').focus({ preventScroll: true });
  }

  /** Back to the office. */
  function close() {
    if (!st.open) return;
    if (st.pushed && location.hash.startsWith('#settings')) { history.back(); return; } // popstate hides it
    if (location.hash.startsWith('#settings')) history.replaceState(null, '', location.pathname + location.search);
    hide();
  }
  function hide() {
    st.open = st.pushed = false;
    $('settings').hidden = true;
    document.body.classList.remove('in-settings');
    msg('');
    st.back?.focus?.();
  }
  /** The page's address changed (a link, the back button): the area follows it. */
  function route() {
    const m = location.hash.match(/^#settings(?:\/([\w-]+))?/);
    // the sections of before: departments and projects are in the company now
    const id = { offices: 'company', projects: 'company' }[m?.[1]] || m?.[1];
    if (m) enter(SETTINGS_SECTIONS.includes(id) ? id : st.tab);
    else if (st.open) hide();
  }

  /** Goes to a section (from the menu, the search or another section). */
  function go(section) {
    if (!SETTINGS_SECTIONS.includes(section)) return;
    msg('');
    st.tab = section;
    if (location.hash !== `#settings/${section}`) history.replaceState(null, '', `#settings/${section}`);
    show(section);
    $('cfg-content').scrollTop = 0;
  }

  /** From the map: the form of a department, a repository, a project or a resource, ready to edit. */
  function jumpTo(section, { edit = null, adopt = null } = {}) {
    if (section === 'repos' && edit) { const a = (st.projects || getTargets()).find((x) => x.id === edit); go('repos'); if (a) editRepo(a); return; }
    if (section === 'company' && edit) {
      // an area (area:<id>) or a project: its form, open
      if (String(edit).startsWith('area:')) { const a = (st.areas || []).find((x) => x.id === edit.slice(5)); st.areaForm = { id: edit.slice(5), name: a?.custom ? a.name : '', instructions: a?.instructions || '' }; }
      else { const o = getOffices().find((x) => x.id === edit); if (o) st.office = officeForm(o); }
      go('company');
      $('s-office-form')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (section === 'infra') { st.resource = adopt ? adoptForm(adopt) : edit ? resourceForm((st.resources || []).find((r) => r.id === edit)) : emptyResource(); go('infra'); $('s-res-form')?.scrollIntoView({ block: 'nearest' }); return; }
    go(section);
  }

  /** The menu: the sections in their groups (the ones the search finds), and the phone's picker. */
  function renderNav() {
    const q = fold($('cfg-search').value).trim();
    const hit = (id) => !q || fold(`${N(id)} ${t(`settings.desc.${id}`)} ${t(`settings.words.${id}`)}`).includes(q);
    const groups = SETTINGS_GROUPS.map(([g, ids]) => [g, ids.filter(hit)]).filter(([, ids]) => ids.length);
    put($('cfg-nav'), groups.length ? groups.map(([g, ids]) => el('div', { class: 'cfg-group' },
      el('h3', {}, t(`settings.groups.${g}`)),
      ids.map((id) => el('button', { type: 'button', class: 'cfg-item', 'data-section': id, 'aria-current': id === st.tab ? 'page' : undefined, title: t(`settings.desc.${id}`), onclick: () => go(id) },
        el('span', { class: 'cfg-ic', 'aria-hidden': 'true' }, ICON[id]), el('span', {}, N(id))))))
      : el('p', { class: 'hint cfg-none' }, t('settings.noMatch')));
    put($('cfg-jump'), SETTINGS_GROUPS.map(([g, ids]) => el('optgroup', { label: t(`settings.groups.${g}`) }, ids.map((id) => option(id, `${ICON[id]} ${N(id)}`, id === st.tab)))));
    st.found = groups.flatMap(([, ids]) => ids);
  }

  /** Draws a section. */
  function show(tab) {
    st.tab = SETTINGS_SECTIONS.includes(tab) ? tab : 'general';
    tab = st.tab;
    renderNav();
    $('settings').dataset.section = tab;
    $('cfg-crumb').textContent = t(`settings.groups.${groupOf(tab)}`);
    $('cfg-title').textContent = `${ICON[tab]} ${N(tab)}`;
    $('cfg-desc').textContent = t(`settings.desc.${tab}`);
    for (const p of body.children) p.hidden = p.dataset.panel !== tab;
    $('settings-save').hidden = !DRAFTS.has(tab);
    $('s-file').textContent = st.data ? t('settings.file', { file: tilde(st.data.office.file) }) : '';
    RENDER[tab]();
  }

  /** 🧠 Intelligence: which model, its address and limit, and a button to try it. */
  function intelGroup(c, key = 'intelligence') {
    const base = key === 'narrator' ? '/v1/narrator' : '/v1/intelligence';
    const PH = { anthropic: [key === 'narrator' ? 'claude-haiku-5-5' : 'claude-opus-5-5', 'https://api.anthropic.com/v1'], openai: [key === 'narrator' ? 'deepseek-…-flash' : 'gpt-…', 'https://api.openai.com/v1'], ollama: ['llama3.1', 'http://127.0.0.1:11434'] };
    const result = el('span', { class: 'hint', role: 'status' });
    const test = el('button', { type: 'button', class: 's-mini', onclick: async () => {
      test.disabled = true;
      result.textContent = G('intelTesting');
      const r = await api('POST', `${base}/test`, {});
      test.disabled = false;
      result.textContent = r.ok ? G('intelOk', { model: r.model, s: Math.round((r.ms || 0) / 100) / 10 }) : G('intelFail', { error: r.error || '?' });
    } }, G('intelTest'));
    const on = c.provider !== 'off';
    // what is missing for it to work (the key, the model, the agent's CLI), before you try it, and again
    // after each change
    const problem = el('p', { class: 's-bad', role: 'status' });
    const recheck = () => api('GET', base).then((r) => { problem.textContent = r.ok && r.problemText ? `⚠ ${r.problemText}` : ''; });
    const set = (patch, redraw = false) => setPref({ [key]: patch }, { redraw }).then((r) => { if (r?.ok && !redraw) recheck(); });
    if (on) recheck();
    return [
      el('label', { class: 'b-field' }, el('span', {}, G('intelProvider')),
        el('select', { onchange: (e) => set({ provider: e.target.value }, true) }, ['off', 'agent', 'anthropic', 'openai', 'ollama'].map((x) => option(x, G(`intel_${x}`), x === c.provider)))),
      c.provider === 'agent' ? el('label', { class: 'b-field' }, el('span', {}, G('intelHarness')),
        el('select', { onchange: (e) => set({ harness: e.target.value }) }, ['claude-code', 'codex', 'opencode', 'pi'].map((h) => option(h, HARNESS_NAME[h] || h, h === c.harness)))) : null,
      on ? el('label', { class: 'b-field' }, el('span', {}, G('intelModel')), el('input', { type: 'text', value: c.model || '', placeholder: c.provider === 'agent' ? G('intelModelAgent') : PH[c.provider]?.[0] || '', onchange: (e) => set({ model: e.target.value }) })) : null,
      on && c.provider !== 'agent' ? el('label', { class: 'b-field' }, el('span', {}, G('intelUrl')), el('input', { type: 'text', value: c.url || '', placeholder: PH[c.provider]?.[1] || '', onchange: (e) => set({ url: e.target.value }) })) : null,
      on ? el('label', { class: 'b-field' }, el('span', {}, G('intelTimeout')), el('input', { type: 'number', class: 's-num', min: 10, max: 600, value: c.timeout || 120, onchange: (e) => set({ timeout: Number(e.target.value) || 120 }) })) : null,
      on ? el('p', { class: 'hint' }, G(c.provider === 'agent' ? 'intelAgentHint' : c.provider === 'anthropic' ? 'intelKeyAnthropic' : c.provider === 'openai' ? 'intelKeyOpenai' : 'intelOllamaHint')) : null,
      on ? el('div', { class: 's-row' }, test, result) : null,
      on ? problem : null,
    ];
  }

  /** How the archive is indexed: chunks, and how many have their embedding. */
  async function indexStatus() {
    const r = await api('GET', '/v1/archive/index');
    const box = $('s-index');
    if (!r.ok || !box) return;
    box.textContent = t('settings.general.indexStatus', { chunks: r.chunks, embedded: r.embedded }) + (r.error ? ` · ⚠ ${r.error}` : r.running ? ' · …' : '');
  }

  /** Something new arrived (agents, offices, settings, the language…): the section is redrawn. */
  function refresh(all = false) {
    if (!st.open || !st.data) return;
    if (all) return show(st.tab);
    if (st.tab === 'repos') return loadProjects();
    if (st.tab === 'architecture') return arch.reload();
    // the company: redrawn, unless you are typing in one of its forms
    if (st.tab === 'company') return st.office || st.areaForm || (st.company && document.activeElement?.closest?.('[data-panel="company"]')) ? undefined : show('company');
    if (LIVE.has(st.tab)) return show(st.tab);
    // a change that alters the section: drawn again once the new settings are here
    if (st.redraw?.tab === st.tab && JSON.stringify(prefs()) !== st.redraw.from) { st.redraw = null; show(st.tab); }
  }
  /** The watched office's characters changed (another office chosen, or saved): Characters shows them. */
  function appearanceChanged() {
    if (!st.open || st.tab !== 'look' || (!st.pendingLook && !st.saved)) return;
    st.pendingLook = st.saved = false;
    st.looks = null;
    renderLook();
  }

  // ------------------------------------------------------------ General

  /**
   * Saves some general settings at once. `redraw`: the change alters what the section shows (another
   * provider, embeddings, unit…), so it is drawn again when the new settings arrive over the WebSocket
   * (refresh); the sections that are not LIVE are otherwise left alone, so nothing typed is lost.
   */
  async function setPref(patch, { redraw = false } = {}) {
    if (redraw) st.redraw = { tab: st.tab, from: JSON.stringify(prefs()) };
    const r = await api('PUT', '/v1/settings', { prefs: patch });
    if (!r.ok) { st.redraw = null; msg(r.error); return r; }
    msg(t('settings.saved'), true);
    onSaved?.();
    return r;
  }

  function renderGeneral() {
    const panel = panelOf('general');
    const p = prefs();
    if (!p) return;
    put(panel,
      card(G('cardLanguage'),
        el('label', { class: 'b-field' }, el('span', {}, G('language')),
          el('select', { 'aria-label': G('language'), onchange: (e) => setPref({ lang: e.target.value }) }, Object.entries(LANGUAGES).map(([id, name]) => option(id, name, id === p.lang)))),
        el('p', { class: 'hint' }, G('languageHint'))),
      card(G('cardPlace'),
        el('label', { class: 'b-field' }, el('span', {}, G('timezone')),
          el('span', { class: 'tz-field' }, zoneInput({ value: p.timezone, placeholder: G('tzSystem', { tz: st.data?.systemZone || '' }), label: G('timezone'), onPick: (z) => setPref({ timezone: z }) }))),
        el('p', { class: 'hint' }, G('tzHint')),
        el('label', { class: 'b-field' }, el('span', {}, G('city')),
          el('span', { class: 'tz-field' }, cityInput({ value: p.city, timezone: p.timezone || st.data?.systemZone, placeholder: G('cityZone', { city: zoneInfo(p.timezone || st.data?.systemZone).city || '' }), label: G('city'), onPick: (c) => setPref({ city: c }) }))),
        el('p', { class: 'hint' }, G('cityHint')),
        check(p.weather, `${G('weather')}: ${G(p.weather ? 'weatherOn' : 'weatherOff')}`, (e) => setPref({ weather: e.target.checked }))));
  }

  /** 🎮 The game: how it is seen (the view, the style), what the log tells and how it calls you. */
  function renderGame() {
    const panel = panelOf('game');
    const p = prefs();
    if (!p) return;
    put(panel,
      card(G('cardView'),
        el('label', { class: 'b-field' }, el('span', {}, G('viewMode')),
          el('select', { 'aria-label': G('viewMode'), onchange: (e) => setPref({ view: { mode: e.target.value } }) }, ['flat', 'iso'].map((m) => option(m, G(`view_${m}`), m === (p.view?.mode || 'flat'))))),
        // the graphic theme: how the people look (public/themes.js)
        el('label', { class: 'b-field' }, el('span', {}, G('theme')),
          el('select', { 'aria-label': G('theme'), onchange: (e) => setPref({ theme: e.target.value }) }, ['pixel', 'anime'].map((m) => option(m, G(`theme_${m}`), m === (p.theme || 'pixel'))))),
        el('p', { class: 'hint' }, G(p.theme === 'anime' ? 'themeAnimeHint' : 'themeHint'))),
      card(G('cardLog'),
        check(p.log?.life, G('life'), (e) => setPref({ log: { life: e.target.checked } }))),
      // when they wait for you (this browser's own: a sound, a system notification)
      alerts ? card(G('cardAlerts'),
        el('p', { class: 'hint' }, G('alertsHint')),
        check(alerts.get().sound, t('attention.sound'), (e) => alerts.set({ sound: e.target.checked })),
        'Notification' in window ? check(alerts.get().notify, t('attention.notify'), async (e) => {
          const on = e.target.checked && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted');
          alerts.set({ notify: on });
          e.target.checked = on;
        }) : null) : null);
  }

  /** 🤖 Autonomy: the analyst reviews each brief first, and the agents work to the end on their own. */
  function renderAutonomy() {
    const p = prefs();
    if (!p) return;
    put(panelOf('autonomy'),
      card(G('autonomy'),
        check(p.autonomy?.clarify !== false, G('clarify'), (e) => setPref({ autonomy: { clarify: e.target.checked } })),
        el('p', { class: 'hint' }, G('clarifyHint')),
        check(p.autonomy?.autonomous !== false, G('autonomous'), (e) => setPref({ autonomy: { autonomous: e.target.checked } })),
        el('p', { class: 'hint' }, G('autonomousHint'))),
      el('p', { class: 'hint' }, el('button', { type: 'button', class: 'cfg-link', onclick: () => go('company') }, G('autonomyDepts'))));
  }

  /** 🗜 Context: past the limit an agent's context is compacted on its own (server/compact.js). */
  function renderContext() {
    const p = prefs();
    if (!p) return;
    put(panelOf('context'), card(G('compact'), compactGroup(p.compact || { auto: true, at: 400000, unit: 'tokens' })));
  }

  /** 📚 The archive as a RAG: its chunks go on top of every brief; embeddings for the semantic search. */
  function renderArchive() {
    const p = prefs();
    if (!p) return;
    put(panelOf('archive'),
      card(G('archive'),
        check(p.archive?.push !== false, G('archivePush'), (e) => setPref({ archive: { push: e.target.checked } }))),
      card(G('cardEmbeddings'),
        el('label', { class: 'b-field' }, el('span', {}, G('embeddings')),
          el('select', { onchange: (e) => setPref({ archive: { embeddings: e.target.value } }, { redraw: true }) }, ['off', 'ollama', 'openai'].map((x) => option(x, G(`embed_${x}`), x === (p.archive?.embeddings || 'off'))))),
        p.archive?.embeddings && p.archive.embeddings !== 'off' ? [
          el('label', { class: 'b-field' }, el('span', {}, G('embedModel')), el('input', { type: 'text', value: p.archive.model || '', placeholder: p.archive.embeddings === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small', onchange: (e) => setPref({ archive: { model: e.target.value } }) })),
          el('label', { class: 'b-field' }, el('span', {}, G('embedUrl')), el('input', { type: 'text', value: p.archive.url || '', placeholder: p.archive.embeddings === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1', onchange: (e) => setPref({ archive: { url: e.target.value } }) })),
          el('p', { class: 'hint' }, G(p.archive.embeddings === 'ollama' ? 'embedOllamaHint' : 'embedKeyHint')),
        ] : null),
      card(G('cardIndex'),
        el('p', { class: 'hint', id: 's-index' }),
        el('div', { class: 's-row' }, el('button', { type: 'button', class: 's-mini', onclick: async () => { await api('POST', '/v1/archive/reindex', {}); indexStatus(); } }, G('reindex')))));
  }

  /** 🧠 Intelligence: the model the office leans on to size an order's impact (server/intelligence.js). */
  function renderIntelligence() {
    const p = prefs();
    if (!p) return;
    put(panelOf('intelligence'), card(G('intel'), el('p', { class: 'hint' }, G('intelHint')), intelGroup(p.intelligence || { provider: 'off', harness: 'claude-code', model: '', url: '', timeout: 120 })),
      // the narrator: a fast model for the short sentences (the card's "what they did", the bubbles at a turn's end)
      card(G('narrator'), el('p', { class: 'hint' }, G('narratorHint')), intelGroup(p.narrator || { provider: 'off', harness: 'claude-code', model: '', url: '', timeout: 30 }, 'narrator')));
  }

  /** 🖥 Terminal: herdr, the agent in a pane and each subagent in its own. */
  function renderTerminal() {
    const p = prefs();
    if (!p) return;
    const herdr = getHerdr() || st.data?.herdr || {};
    const agents = getTargets().filter((x) => x.registered);
    put(panelOf('terminal'),
      el('p', { class: `cfg-status ${herdr.available ? 'ok' : 'off'}` }, herdr.available ? G('herdrOn', { pane: herdr.pane || '?' }) : G('herdrOff')),
      card(G('herdr'),
        check(p.herdr.launch, G('herdrLaunch'), (e) => setPref({ herdr: { launch: e.target.checked } })),
        check(p.herdr.subagents !== false, G('herdrSubagents'), (e) => setPref({ herdr: { subagents: e.target.checked } })),
        el('label', { class: 'b-field' }, el('span', {}, G('herdrDirection')),
          el('select', { onchange: (e) => setPref({ herdr: { direction: e.target.value } }) }, ['right', 'down'].map((d) => option(d, G(d), d === p.herdr.direction)))),
        el('label', { class: 'b-field' }, el('span', {}, G('startAgent')),
          el('select', { onchange: (e) => setPref({ herdr: { startAgent: e.target.value } }) },
            option('auto', G('auto'), p.herdr.startAgent === 'auto'), option('none', G('none'), p.herdr.startAgent === 'none'),
            agents.map((a) => option(a.id, `${a.name} · ${HARNESS_NAME[a.harness]}`, a.id === p.herdr.startAgent))))));
  }

  /** 💾 Backup: your settings as a JSON file, to keep them, share them or take them to another machine. */
  function renderBackup() {
    put(panelOf('backup'),
      card(G('io'),
        el('p', { class: 'hint' }, G('ioHint')),
        el('div', { class: 's-row' },
          el('a', { class: 's-mini', href: '/v1/settings/export', download: '' }, G('ioExport')),
          el('button', { type: 'button', class: 's-mini', onclick: importSettingsFile }, G('ioImport'))),
        el('ul', { class: 'hint s-io', id: 's-io' })),
      card(G('cardData'),
        el('dl', { class: 'cfg-facts' }, el('dt', {}, G('dataFile')), el('dd', {}, el('code', {}, tilde(st.data?.office.file || '')))),
        el('p', { class: 'hint' }, G('dataHint'))),
      resetCard());
  }

  /** ⟲ Start over: what you choose goes back to how it was the first day (after exporting it, if you want). */
  function resetCard() {
    const PARTS = ['prefs', 'look', 'company', 'activity', 'archive'];
    const chosen = st.resetParts ||= new Set();
    const go1 = el('button', { type: 'button', class: 'btn danger', disabled: chosen.size ? undefined : true, onclick: async () => {
      const list = PARTS.filter((x) => chosen.has(x)).map((x) => `• ${G(`reset_${x}`)}`).join('\n');
      if (!confirm(G('resetConfirm', { list }))) return;
      const r = await api('POST', '/v1/reset', { parts: [...chosen] });
      if (!r.ok) return msg(r.error);
      st.resetParts = null;
      st.company = st.areas = st.projects = st.experts = null;
      await load();
      onSaved?.();
      msg(G('resetDone'), true);
      renderBackup();
    } }, `⟲ ${G('resetBtn')}`);
    return el('section', { class: 'cfg-card s-reset' },
      el('h3', {}, `⟲ ${G('resetTitle')}`),
      el('p', { class: 'hint' }, G('resetHint'), ' ', el('a', { href: '/v1/settings/export', download: '' }, G('resetExportFirst'))),
      el('div', { class: 's-reset-parts' }, PARTS.map((x) => el('label', { class: 'b-check' },
        el('input', { type: 'checkbox', checked: chosen.has(x) ? true : undefined, onchange: (e) => { if (e.target.checked) chosen.add(x); else chosen.delete(x); go1.disabled = !chosen.size; } }),
        el('span', {}, el('b', {}, G(`reset_${x}`)), el('span', { class: 'hint' }, ` — ${G(`resetWhat_${x}`)}`))))),
      el('p', { class: 'hint' }, G('resetKeeps')),
      el('div', { class: 's-row' }, go1));
  }

  /** ℹ About: the version that is running, where it runs and where to read more. */
  async function renderAbout() {
    const panel = panelOf('about');
    const B = (k, v) => t(`settings.about.${k}`, v);
    const h = await api('GET', '/v1/health');
    if (st.tab !== 'about') return;
    const link = (href, label) => el('a', { class: 's-mini', href, target: '_blank', rel: 'noopener' }, label);
    put(panel,
      card('Dev Team Office',
        el('dl', { class: 'cfg-facts' },
          el('dt', {}, B('version')), el('dd', {}, h.ok ? h.version : '?'),
          el('dt', {}, B('address')), el('dd', {}, el('code', {}, h.ok ? h.url : location.origin)),
          el('dt', {}, B('data')), el('dd', {}, el('code', {}, tilde(st.data?.office.file || ''))),
          h.ok && h.root ? [el('dt', {}, B('installed')), el('dd', {}, el('code', {}, tilde(h.root)))] : null,
          el('dt', {}, B('terminal')), el('dd', {}, h.ok && h.herdr ? B('herdrOn') : B('herdrOff'))),
        el('p', { class: 'hint' }, B('update'))),
      card(B('docs'),
        el('div', { class: 's-row cfg-links' },
          link(`${DOCS}#readme`, B('readme')), link(`${DOCS}/blob/main/docs/${getLanguage() === 'es' ? 'README.es.md' : 'README.md'}`, B('guides')),
          link(`${DOCS}/blob/main/CHANGELOG.md`, B('changelog')), link(`${DOCS}/issues/new/choose`, B('issue')))),
      card(B('keys'),
        el('ul', { class: 'cfg-keys' }, ['t', 'a', 'w', 'd', 'c', 'v', 'o', 'pg', 'r', 'l', 'i', 'e', 'f', 'esc'].map((k) => el('li', {}, el('kbd', {}, k === 'pg' ? B('pgKey') : k === 'esc' ? 'Esc' : k), ` ${B(`key.${k}`)}`)))));
  }

  /** The auto-compaction: on or off, and its limit (in thousands of tokens, or a share of the window). */
  function compactGroup(c) {
    const pct = c.unit === 'pct';
    const save = () => {
      const unit = $('s-compact-unit').value;
      const n = Number($('s-compact-at').value) || 0;
      setPref({ compact: { unit, at: unit === 'pct' ? n : n * 1000 } });
    };
    return [
      check(c.auto, G('compactAuto'), (e) => setPref({ compact: { auto: e.target.checked } }, { redraw: true })),
      el('label', { class: 'b-field' }, el('span', {}, G('compactAt')),
        el('span', { class: 's-compact' },
          el('input', { id: 's-compact-at', type: 'number', class: 's-num', min: 10, max: pct ? 99 : 10000, step: pct ? 1 : 10, value: pct ? c.at : Math.round(c.at / 1000), onchange: save, disabled: c.auto ? undefined : true }),
          el('select', { id: 's-compact-unit', 'aria-label': G('compactAt'), disabled: c.auto ? undefined : true, onchange: (e) => setPref({ compact: { unit: e.target.value } }, { redraw: true }) },
            option('tokens', `k ${G('compact_tokens')}`, !pct), option('pct', G('compact_pct'), pct)))),
      el('p', { class: 'hint' }, G('compactHint')),
    ];
  }

  /**
   * Where a settings file's skills go: { to: 'global' | 'repos' | 'none', repos } — asked only when it brings
   * some; null if you cancel. Repositories: the registered ones, and the file's (by their folder).
   */
  async function skillsWhere(file) {
    if (!st.projects) { const r = await api('GET', '/v1/agents'); if (r.ok) st.projects = r.agents.filter((a) => a.registered); }
    const skills = [...(file?.skills || []).map((x) => ({ name: x.name, description: x.description || '' })), ...(file?.mine?.skills || []).map((x) => ({ name: x.name, description: x.title || '' }))]
      .filter((x) => x && typeof x.name === 'string');
    if (!skills.length) return { to: 'global', repos: [] };
    const here = (st.projects || getTargets().filter((x) => x.registered)).map((a) => ({ key: a.id, name: a.name, path: a.path }));
    const known = new Set(here.map((a) => a.path));
    const theirs = (file.projects || []).filter((x) => x?.path && !known.has(x.path)).map((x) => ({ key: x.path, name: x.name || x.path, path: x.path, fromFile: true }));
    const repos = [...here, ...theirs];
    return new Promise((resolve) => {
      let to = 'global';
      const picked = new Set();
      const dlg = el('dialog', { class: 'brief settings skills-dlg', 'aria-labelledby': 'sk-title' });
      const list = el('div', { class: 's-skill-repos', hidden: true }, repos.length ? repos.map((a) => el('label', { class: 'b-check' },
        el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) picked.add(a.key); else picked.delete(a.key); } }),
        el('span', {}, el('b', {}, a.name), el('span', { class: 'hint' }, ` ${tilde(a.path)}${a.fromFile ? ` · ${G('ioSkillsFromFile')}` : ''}`))))
        : el('p', { class: 'hint' }, G('ioSkillsNoRepos')));
      const radio = (value) => el('label', { class: 'b-check' },
        el('input', { type: 'radio', name: 'sk-to', value, checked: value === to ? true : undefined, onchange: () => { to = value; list.hidden = to !== 'repos'; } }),
        el('span', {}, el('b', {}, G(`ioSkills_${value}`)), el('span', { class: 'hint' }, ` — ${G(`ioSkillsHint_${value}`)}`)));
      const done = (value) => { dlg.close(); dlg.remove(); resolve(value); };
      dlg.append(el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); done({ to, repos: to === 'repos' ? [...picked] : [] }); } },
        el('header', { class: 'brief-head' }, el('span', { class: 'pin', 'aria-hidden': 'true' }), el('h2', { id: 'sk-title' }, G('ioSkillsTitle', { n: skills.length })),
          el('button', { type: 'button', class: 'brief-x', 'aria-label': t('settings.close'), onclick: () => done(null) }, '✕')),
        el('div', { class: 'brief-body' },
          el('ul', { class: 's-skill-names' }, skills.slice(0, 40).map((x) => el('li', { title: x.description }, `🧩 ${x.name}`))),
          el('div', { class: 's-skill-to' }, ['global', 'repos', 'none'].map(radio)),
          list,
          el('p', { class: 'hint' }, G('ioSkillsSafe'))),
        el('footer', { class: 'brief-foot' },
          el('button', { type: 'button', class: 'btn ghost', onclick: () => done(null) }, t('settings.offices.cancel')),
          el('button', { type: 'submit', class: 'btn' }, G('ioSkillsGo')))));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  /** ⬆ Import: a settings file (server/settings-io.js); what it brings replaces what is here, the rest stays. */
  function importSettingsFile() {
    const input = el('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
      const file = input.files?.[0];
      if (!file) return;
      let body;
      try { body = JSON.parse(await file.text()); } catch { return msg(t('err.settingsFile.json')); }
      // the skills it brings: you choose where they go (or nowhere) before anything is applied
      const where = await skillsWhere(body);
      if (!where) return;
      const r = await api('POST', `/v1/settings/import?skills=${where.to}&repos=${encodeURIComponent(where.repos.join(','))}`, body);
      if (!r.ok) return msg(r.error);
      await load();
      msg(t('settings.general.ioDone', r.applied), true);
      onSaved?.();
      go('backup');
      // what could not be brought (a project whose folder is not on this machine…)
      $('s-io').replaceChildren(
        ...(r.installed || []).filter((x) => x.action !== 'same').map((x) => el('li', {}, `✓ ${G('ioSkillIn', { name: x.name, dir: tilde(x.dir) })}`)),
        ...(r.skipped || []).map((x) => el('li', {}, `✖ ${x.what}: ${x.error}`)));
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
    const panel = panelOf('mine');
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

  // ------------------------------------------------------------ The company: its areas and their projects

  const O = (k, v) => t(`settings.offices.${k}`, v);
  const officeForm = (o) => ({ id: o.id, name: o.custom ? o.name : '', area: o.area || 'general', timezone: o.ownTimezone || '', location: o.location || '', instructions: o.instructions || '', autonomy: o.autonomy || '' });
  const emptyArea = () => ({ id: null, name: '', instructions: '' });

  /**
   * 🏛 Company: its standards and capacity, and its areas, each with its projects (an office: a floor with
   * its people) and their repositories. Everything about the company's shape is here, in one place.
   */
  function renderCompany() {
    const panel = panelOf('company');
    const p = prefs() || {};
    st.company ||= { standards: p.standards || '', capacity: p.capacity || 3 };
    st.areaForm ||= null;
    const areas = st.areas || [{ id: 'general', name: t('areas.default'), custom: false, instructions: '', projects: getOffices().map((o) => o.id) }];
    const offices = getOffices();
    const repos = st.projects || getTargets().filter((x) => x.registered);
    const C = st.company;
    const projectCard = (o) => {
      const mine = repos.filter((a) => a.office === o.id);
      const editing = st.office?.id === o.id;
      return el('div', { class: `s-project${o.id === here() ? ' viewing' : ''}` },
        el('div', { class: 's-agent-head' },
          el('b', {}, `🧩 ${o.name}`), o.id === 'main' ? el('span', { class: 's-tag' }, O('main')) : null,
          o.autonomy ? el('span', { class: 's-tag kind', title: O(`autonomyHint.${o.autonomy}`) }, `🤖 ${O(`autonomyLevel.${o.autonomy}`)}`) : null,
          o.instructions ? el('span', { class: 's-tag kind', title: o.instructions }, `📋 ${O('hasInstructions')}`) : null,
          o.ownTimezone || o.place?.name ? el('span', { class: 'hint' }, [o.ownTimezone ? tzLabel(o.timezone) : '', o.place?.name ? `📍 ${o.place.name}` : ''].filter(Boolean).join(' · ')) : null,
          o.id === here() ? el('span', { class: 's-ok' }, O('viewing')) : null),
        el('div', { class: 's-chips' }, mine.length ? mine.map((a) => el('button', { type: 'button', class: 's-chip', title: tilde(a.path), onclick: () => { go('repos'); editRepo(a); } }, `${KIND_ICON[a.kind] || '📦'} ${a.name}`))
          : el('span', { class: 'hint' }, O('noRepos')),
          el('button', { type: 'button', class: 's-chip add', onclick: () => { go('repos'); newRepo(o.id); } }, O('addRepo'))),
        el('div', { class: 's-card-acts' },
          o.id !== here() ? el('button', { type: 'button', class: 's-mini', title: O('viewHint'), onclick: () => { onView?.(o.id); close(); } }, `👁 ${O('view')}`) : null,
          el('button', { type: 'button', class: 's-mini', title: O('staffHint'), onclick: () => { if (o.id !== here()) onView?.(o.id); go('look'); } }, `🧑 ${O('staff')}`),
          el('button', { type: 'button', class: 's-mini', onclick: () => { arch.go({ type: 'project', id: o.id }); go('architecture'); } }, `🗺 ${O('map')}`),
          mine.length ? el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(`system:${o.id}`) }, `✉ ${O('brief')}`) : null,
          el('button', { type: 'button', class: 's-mini', 'aria-expanded': String(editing), onclick: () => { st.office = editing ? null : officeForm(o); renderCompany(); } }, `✎ ${O('edit')}`),
          o.id !== 'main' ? el('button', { type: 'button', class: 's-mini danger', onclick: () => removeOffice(o) }, O('delete')) : null),
        editing ? projectForm(areas) : null);
    };
    const areaCard = (a) => {
      const projects = offices.filter((o) => (o.area || 'general') === a.id);
      const editing = st.areaForm?.id === a.id;
      const adding = st.office && !st.office.id && st.office.area === a.id;
      return el('section', { class: 'cfg-card s-area' },
        el('div', { class: 's-area-head' },
          el('h3', {}, `🏛 ${a.name}`), el('span', { class: 'hint' }, O('projectsCount', { n: projects.length })),
          el('span', { class: 's-grow' }),
          el('button', { type: 'button', class: 's-mini', 'aria-expanded': String(editing), onclick: () => { st.areaForm = editing ? null : { id: a.id, name: a.custom ? a.name : '', instructions: a.instructions || '' }; renderCompany(); } }, `✎ ${O('editArea')}`),
          a.id !== 'general' ? el('button', { type: 'button', class: 's-mini danger', onclick: () => removeArea(a) }, O('deleteArea')) : null),
        a.instructions && !editing ? el('p', { class: 's-dept-text' }, a.instructions) : null,
        editing ? areaForm() : null,
        el('div', { class: 's-projects' }, projects.map(projectCard)),
        adding ? el('div', { class: 's-project' }, projectForm(areas)) : el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.office = { ...emptyOffice(), area: a.id }; renderCompany(); } }, `＋ ${O('addProject')}`));
    };
    put(panel,
      el('p', { class: 'hint' }, O('companyHint')),
      card(O('standardsTitle'),
        el('label', { class: 'note' }, el('span', {}, O('standards')),
          el('textarea', { rows: 4, maxlength: 4000, placeholder: O('standardsPh'), oninput: (e) => { C.standards = e.target.value; } }, C.standards)),
        el('p', { class: 'hint' }, O('standardsHint')),
        el('label', { class: 'b-field' }, el('span', {}, O('capacity')),
          el('input', { type: 'number', min: 1, max: 20, value: C.capacity, class: 's-num', oninput: (e) => { C.capacity = Number(e.target.value) || 3; } })),
        el('p', { class: 'hint' }, O('capacityHint')),
        el('div', { class: 's-row' }, el('button', { type: 'button', class: 'btn', onclick: async () => { const r = await setPref({ standards: C.standards, capacity: C.capacity }); if (r?.ok) st.company = null; } }, O('saveCompany')))),
      el('h3', { class: 'cfg-sub' }, `🏛 ${O('areasTitle')}`),
      el('p', { class: 'hint' }, O('areasHint')),
      areas.map(areaCard),
      st.areaForm && !st.areaForm.id ? card(O('newArea'), areaForm()) : el('div', { class: 's-row' }, el('button', { type: 'button', class: 'btn', onclick: () => { st.areaForm = emptyArea(); renderCompany(); } }, `＋ ${O('addArea')}`)));
  }

  /** An area's form: its name and its instructions (they go on top of every brief of its projects). */
  function areaForm() {
    const f = st.areaForm;
    return el('div', { class: 's-form s-inline-form' },
      el('label', { class: 'b-field' }, el('span', {}, O('areaName')), el('input', { type: 'text', value: f.name, maxlength: 40, placeholder: f.id === 'general' ? t('areas.default') : O('areaNamePh'), oninput: (e) => { f.name = e.target.value; } })),
      el('label', { class: 'note' }, el('span', {}, O('areaInstructions')), el('textarea', { rows: 3, maxlength: 4000, placeholder: O('areaInstructionsPh'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions)),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: saveArea }, f.id ? O('saveChanges') : O('addArea')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.areaForm = null; renderCompany(); } }, O('cancel'))));
  }

  /** A project's form (an office: a floor with its people): its name, area, instructions, autonomy and place. */
  function projectForm(areas) {
    const f = st.office;
    const p = prefs() || {};
    const company = p.timezone || st.data?.systemZone || '';
    return el('div', { class: 's-form s-inline-form', id: 's-office-form' },
      el('h4', {}, f.id ? O('editTitle', { name: getOffices().find((o) => o.id === f.id)?.name || '' }) : O('newTitle')),
      el('label', { class: 'b-field' }, el('span', {}, O('name')), el('input', { type: 'text', value: f.name, maxlength: 40, placeholder: f.id === 'main' ? t('offices.main') : O('namePh'), oninput: (e) => { f.name = e.target.value; } })),
      el('label', { class: 'b-field' }, el('span', {}, O('area')),
        el('select', { onchange: (e) => { f.area = e.target.value; } }, areas.map((a) => option(a.id, a.name, a.id === f.area)))),
      el('label', { class: 'note' }, el('span', {}, O('instructions')),
        el('textarea', { rows: 3, maxlength: 4000, placeholder: O('instructionsPh'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions || '')),
      el('label', { class: 'b-field' }, el('span', {}, O('autonomy')),
        el('select', { onchange: (e) => { f.autonomy = e.target.value; renderCompany(); } },
          option('', O('autonomyCompany'), !f.autonomy), AUTONOMY.map((l) => option(l, O(`autonomyLevel.${l}`), f.autonomy === l)))),
      el('p', { class: 'hint' }, f.autonomy ? O(`autonomyHint.${f.autonomy}`) : O('autonomyCompanyHint')),
      el('details', {}, el('summary', {}, O('placeTitle')),
        el('label', { class: 'b-field' }, el('span', {}, O('timezone')),
          el('span', { class: 'tz-field' }, zoneInput({ value: f.timezone, placeholder: O('inherit', { tz: company }), label: O('timezone'), onPick: (z) => {
            // another country: its city is no longer valid
            if (zoneInfo(z || company).country !== zoneInfo(f.timezone || company).country) f.location = '';
            f.timezone = z || ''; renderCompany();
          } }))),
        el('label', { class: 'b-field' }, el('span', {}, O('location')),
          el('span', { class: 'tz-field' }, cityInput({ value: f.location, timezone: f.timezone || company, label: O('location'), onPick: (c) => { f.location = c || ''; },
            placeholder: !f.timezone && p.city ? O('cityInherit', { city: placeName(p.city) }) : O('locationPh', { city: zoneInfo(f.timezone || company).city || '' }) })))),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: saveOffice }, f.id ? O('saveChanges') : O('add')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.office = null; renderCompany(); } }, O('cancel'))));
  }

  async function saveArea() {
    const f = st.areaForm;
    const body = { name: f.name, instructions: f.instructions };
    const r = f.id ? await api('PUT', `/v1/areas/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/areas', body);
    if (!r.ok) return msg(r.error);
    msg(f.id ? O('areaSaved') : O('areaCreated', { name: r.area.name }), true);
    st.areaForm = null;
    await loadProjects();
  }
  async function removeArea(a) {
    if (!confirm(O('confirmDeleteArea', { name: a.name }))) return;
    const r = await api('DELETE', `/v1/areas/${encodeURIComponent(a.id)}`);
    if (!r.ok) return msg(r.error);
    msg(O('areaDeleted'), true);
    await reloadOffices();
    await loadProjects();
  }

  /** Every department's projects (the page only has the watched office's). */
  async function loadProjects() {
    const [r, map, sys, areas, rels] = await Promise.all([api('GET', '/v1/agents'), api('GET', '/v1/map'), api('GET', '/v1/systems'), api('GET', '/v1/areas'), api('GET', '/v1/relations')]);
    if (!r.ok) return;
    st.areas = areas.ok ? areas.areas : st.areas;
    st.relations = rels.ok ? rels.relations : [];
    // each repository with its kind: the one you said, or the one its folder says
    const kinds = map.ok ? Object.fromEntries(map.departments.flatMap((o) => o.projects).map((p) => [p.id, p.kind])) : {};
    st.projects = (r.agents || []).filter((a) => a.registered).map((a) => ({ ...a, kind: a.kind || kinds[a.id] || 'other' }));
    // each project's components (detected from its folder, and the ones declared): the map the directives use
    st.components = map.ok ? Object.fromEntries(map.departments.flatMap((o) => o.projects).map((p) => [p.id, p.components])) : {};
    st.kinds = map.ok ? Object.fromEntries(map.departments.flatMap((o) => o.projects).map((p) => [p.id, p.kind])) : {};
    st.systems = sys.ok ? sys.systems : [];
    st.kindList = sys.ok ? sys.kinds : ['frontend', 'mobile', 'bff', 'backend', 'worker', 'library', 'data', 'infra', 'other'];
    // the infrastructure: the declared ones, and what each project's folder says it uses
    st.resources = map.ok ? map.resources || [] : [];
    if (!st.open) return;
    if (st.tab === 'company') renderCompany();
    else if (st.tab === 'repos') renderList();
    else if (st.tab === 'infra') renderInfra();
  }

  // ------------------------------------------------------------ Infrastructure (server/resources.js)

  const R = (k, v) => t(`settings.resources.${k}`, v);
  const emptyResource = () => ({ id: null, kind: 'queue', name: '', tech: '', location: '', notes: '', planned: false, links: [] });
  /** A declared resource as its form edits it (its links: the repository's id and how it uses it). */
  const resourceForm = (r) => (r ? { id: r.id, kind: r.kind, name: r.name, tech: r.tech || '', location: r.location || '', notes: r.notes || '', planned: r.state === 'planned', links: r.projects.map((x) => ({ project: x.id, how: x.how })) } : emptyResource());
  /** What a repository's folder says it has (a queue its Terraform names): the form to declare it. */
  const adoptForm = (r) => ({ ...emptyResource(), kind: r.kind, name: r.name, tech: r.tech || '', links: (r.projects || r.users || []).map((x) => ({ project: String(x.id).replace(/^repo:/, ''), how: x.how || 'uses' })) });

  /** 🗄 Infrastructure: what is declared (with who uses it and how), what the repositories say they use, and the form. */
  /**
   * How each repository uses a technology, read from its code (GET /v1/resources/explain): what for,
   * where it is configured and with which library, each with its file and line.
   */
  function usageOf(r) {
    if (!r) return null;
    const tech = r.tech || r.name;
    st.explain ||= new Map();
    const box = el('div', { class: 'arch-usage s-usage' });
    const fill = () => box.replaceChildren(el('h4', {}, t('arch.usage.title')), ...r.projects.map((u) => {
      const x = st.explain.get(`${u.id}|${tech}`);
      return el('div', { class: 'arch-use' },
        el('b', {}, `📦 ${u.name}`), el('span', { class: 'hint' }, ` · ${t(`infra.how.${u.how}`)}`),
        !x ? el('p', { class: 'hint' }, '…')
          : !x.how.length && !x.where.length ? el('p', { class: 'hint' }, t('arch.usageNone'))
            : el('dl', { class: 'arch-facts arch-uses' },
              x.purpose.length ? [el('dt', {}, t('arch.usage.for')), el('dd', {}, [...x.purpose.map((p) => t(`arch.purpose.${p}`)), ...(x.details.length ? [x.details.join(', ')] : [])].join(' · '))] : null,
              x.where.length ? [el('dt', {}, t('arch.usage.where')), el('dd', {}, x.where.map((w) => el('div', { class: 'arch-evidence' }, w.evidence)))] : null,
              x.how.length ? [el('dt', {}, t('arch.usage.how')), el('dd', {}, x.how.map((w) => el('div', { class: 'arch-evidence' }, w.evidence)))] : null));
    }));
    fill();
    for (const u of r.projects) {
      const key = `${u.id}|${tech}`;
      if (st.explain.has(key)) continue;
      api('GET', `/v1/resources/explain?repo=${encodeURIComponent(u.id)}&tech=${encodeURIComponent(tech)}`).then((x) => { st.explain.set(key, x.ok ? x : { how: [], where: [], purpose: [], details: [] }); if (box.isConnected) fill(); });
    }
    return box;
  }

  function renderInfra() {
    const projects = st.projects || getTargets().filter((x) => x.registered);
    const all = st.resources || [];
    const declared = all.filter((r) => r.source === 'declared');
    const named = all.filter((r) => r.source === 'detected' && !r.techOnly);
    const stack = all.filter((r) => r.techOnly);
    const keyOf = (r) => r.key || r.name;
    const f = st.resource ||= emptyResource();
    const how = (h) => t(`infra.how.${h}`);
    const reload = () => { loadProjects(); };
    const put1 = async (r, links) => {
      const out = await api('PUT', `/v1/resources/${encodeURIComponent(r.id)}`, { links });
      if (!out.ok) return msg(out.error);
      msg(R('saved', { name: r.name }), true);
      reload();
    };
    const save = async () => {
      if (!f.name.trim()) return msg(t('err.resourceName'));
      const body = { kind: f.kind, name: f.name, tech: f.tech, location: f.location, notes: f.notes, state: f.planned ? 'planned' : 'exists', links: f.links.filter((l) => l.project) };
      const r = f.id ? await api('PUT', `/v1/resources/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/resources', body);
      if (!r.ok) return msg(r.error);
      msg(R('saved', { name: r.resource.name }), true);
      st.resource = emptyResource();
      reload();
    };
    const bind = (k) => (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const again = () => { renderInfra(); $('s-res-form')?.scrollIntoView({ block: 'nearest' }); };
    const cardOf = (r) => {
      const others = projects.filter((a) => !r.projects.some((x) => x.id === a.id));
      const pick = el('select', { class: 's-mini', 'aria-label': R('project') }, option('', R('linkRepo'), true), others.map((a) => option(a.id, a.name)));
      const verb = el('select', { class: 's-mini', 'aria-label': R('how') }, RHOWS.map((h) => option(h, how(h), h === 'uses')));
      return el('div', { class: 's-agent s-resource' },
        el('div', { class: 's-agent-head' },
          el('b', {}, `${RICON[r.kind] || ''} ${r.name}`), el('span', { class: 's-tag kind' }, t(`infra.kinds.${r.kind}`)),
          r.tech ? el('span', { class: 's-tag' }, r.tech) : null,
          r.state === 'planned' ? el('span', { class: 's-tag warn' }, R('planned')) : null,
          !r.projects.length ? el('span', { class: 's-bad' }, R('nobody')) : null),
        r.location ? el('div', { class: 's-path' }, `📍 ${r.location}`) : null,
        r.notes ? el('p', { class: 'hint' }, r.notes) : null,
        el('div', { class: 's-comp-row' },
          el('span', { class: 's-dept-k' }, R('usedBy')),
          r.projects.map((x) => el('span', { class: 's-comp own' }, `📦 ${x.name} · ${how(x.how)}`,
            el('button', { type: 'button', class: 's-x', 'aria-label': R('unlink', { name: x.name }), onclick: () => put1(r, r.projects.filter((y) => !(y.id === x.id && y.how === x.how)).map((y) => ({ project: y.id, how: y.how }))) }, '✕')))),
        el('div', { class: 's-row s-res-link' },
          others.length ? [pick, verb, el('button', { type: 'button', class: 's-mini', onclick: () => { if (!pick.value) return pick.focus(); put1(r, [...r.projects.map((y) => ({ project: y.id, how: y.how })), { project: pick.value, how: verb.value }]); } }, R('link'))] : null,
          el('span', { class: 'cfg-grow' }),
          el('button', { type: 'button', class: 's-mini', onclick: () => { arch.go({ type: 'company' }, `res:${r.id}`); go('architecture'); } }, `🗺 ${t('settings.offices.map')}`),
          el('button', { type: 'button', class: 's-mini', onclick: () => { st.resource = resourceForm(r); again(); } }, R('edit')),
          el('button', { type: 'button', class: 's-mini danger', 'aria-label': R('remove', { name: r.name }), onclick: async () => {
            if (!confirm(R('confirmDelete', { name: r.name }))) return;
            const out = await api('DELETE', `/v1/resources/${encodeURIComponent(r.id)}`);
            if (!out.ok) return msg(out.error);
            if (st.resource?.id === r.id) st.resource = emptyResource();
            msg(R('removed'), true);
            reload();
          } }, R('delete'))));
    };
    const linkRow = (l, i) => el('div', { class: 's-row s-res-linkrow' },
      el('select', { 'aria-label': R('project'), onchange: (e) => { l.project = e.target.value; } }, option('', R('pickRepo'), !l.project), projects.map((a) => option(a.id, a.name, a.id === l.project))),
      el('select', { 'aria-label': R('how'), onchange: (e) => { l.how = e.target.value; } }, RHOWS.map((h) => option(h, how(h), h === l.how))),
      el('button', { type: 'button', class: 's-x', 'aria-label': R('unlink', { name: projects.find((a) => a.id === l.project)?.name || '' }), onclick: () => { f.links.splice(i, 1); again(); } }, '✕'));
    put(panelOf('infra'),
      el('p', { class: 'hint' }, R('hint')),
      declared.length ? el('div', { class: 's-agents' }, declared.map(cardOf)) : el('p', { class: 'cfg-empty' }, R('none')),
      named.length ? card(R('detectedNamed'),
        el('p', { class: 'hint' }, R('detectedNamedHint')),
        el('ul', { class: 's-res' }, named.map((r) => el('li', {},
          el('b', {}, `${RICON[r.kind] || ''} ${r.name}`), ` · ${t(`infra.kinds.${r.kind}`)}${r.tech ? ` · ${r.tech}` : ''}`,
          el('span', { class: 'hint' }, ` ← ${r.projects.map((x) => x.name).join(', ')}`),
          el('button', { type: 'button', class: 's-mini', onclick: () => { st.resource = adoptForm(r); again(); } }, R('declare')))))) : null,
      stack.length ? card(R('detected'),
        el('p', { class: 'hint' }, R('stackHint')),
        // each one opens what its repositories' code says: what for, where and with which library
        el('div', { class: 's-comp-row' }, stack.map((r) => el('button', { type: 'button', class: `s-comp s-comp-btn${st.infraOpen === keyOf(r) ? ' on' : ''}`, 'aria-expanded': String(st.infraOpen === keyOf(r)), title: R('explainHint'), onclick: () => { st.infraOpen = st.infraOpen === keyOf(r) ? null : keyOf(r); renderInfra(); } },
          `${RICON[r.kind] || ''} ${r.name} `, el('span', { class: 'hint' }, `← ${r.projects.map((x) => x.name).join(', ')}`)))),
        st.infraOpen ? usageOf(stack.find((r) => keyOf(r) === st.infraOpen)) : null) : null,
      el('section', { class: 'cfg-card s-form s-res-form', id: 's-res-form' },
        el('h3', {}, f.id ? R('editTitle', { name: f.name }) : R('newTitle')),
        el('label', { class: 'b-field' }, el('span', {}, R('kind')), el('select', { onchange: bind('kind') }, RKINDS.map((k) => option(k, `${RICON[k]} ${t(`infra.kinds.${k}`)}`, k === f.kind)))),
        el('label', { class: 'b-field' }, el('span', {}, R('name')), el('input', { type: 'text', value: f.name, maxlength: 80, placeholder: R('namePh'), oninput: bind('name') })),
        el('label', { class: 'b-field' }, el('span', {}, R('tech')), el('input', { type: 'text', value: f.tech, maxlength: 60, placeholder: R('techPh'), oninput: bind('tech') })),
        el('label', { class: 'b-field' }, el('span', {}, R('location')), el('input', { type: 'text', value: f.location, maxlength: 200, placeholder: R('locationPh'), oninput: bind('location') })),
        el('label', { class: 'b-field' }, el('span', {}, R('notes')), el('input', { type: 'text', value: f.notes, maxlength: 500, placeholder: R('notesPh'), oninput: bind('notes') })),
        el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: f.planned ? true : undefined, onchange: bind('planned') }), R('plannedCheck')),
        el('div', { class: 's-dept-k' }, `${R('usedBy')} (${f.links.length})`),
        f.links.map(linkRow),
        el('div', { class: 's-row' }, projects.length ? el('button', { type: 'button', class: 's-mini', onclick: () => { f.links.push({ project: '', how: 'uses' }); again(); } }, R('addLink')) : el('span', { class: 'hint' }, R('noRepos'))),
        el('div', { class: 's-row' },
          el('button', { type: 'button', class: 'btn', onclick: save }, f.id ? R('save') : R('add')),
          f.id || f.name || f.links.length ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.resource = emptyResource(); again(); } }, R('cancel')) : null)));
  }

  /** The departments, as the API returns them: redrawn now, without waiting for the WebSocket's message. */
  async function reloadOffices() {
    const r = await api('GET', '/v1/offices');
    if (r.ok) onOffices?.(r.offices || []);
  }

  async function saveOffice() {
    const f = st.office;
    const body = { name: f.name, area: f.area || 'general', timezone: f.timezone || null, location: f.location || null, instructions: f.instructions || '', autonomy: f.autonomy || null };
    const r = f.id ? await api('PUT', `/v1/offices/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/offices', body);
    if (!r.ok) return msg(r.error);
    msg(f.id ? t('settings.offices.updated') : t('settings.offices.created', { name: r.office.name }), true);
    st.office = null;
    await reloadOffices();
    await load();
    await loadProjects();
  }

  async function removeOffice(o) {
    if (!confirm(t('settings.offices.confirmDelete', { name: o.name }))) return;
    const r = await api('DELETE', `/v1/offices/${encodeURIComponent(o.id)}`);
    if (!r.ok) return msg(r.error);
    msg(t('settings.offices.deleted'), true);
    if (st.office?.id === o.id) st.office = null;
    await reloadOffices();
    await loadProjects();
  }

  // ------------------------------------------------------------ Repositories (the maintainer)

  const A = (k, v) => t(`settings.repos.${k}`, v);

  /**
   * 📦 Repositories: every project's, in rows grouped by area and project (light: the details are in the
   * repository's window, ✎). Adding one asks which project it belongs to: it never lands in one by itself.
   */
  function renderRepos() {
    put(panelOf('repos'),
      el('p', { class: 'hint' }, A('hint')),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: () => newRepo() }, `＋ ${A('addOne')}`),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => openRepoPicker() }, A('addExisting'))),
      el('div', { id: 's-agent-list', class: 's-repos' }));
    renderList();
  }

  function renderList() {
    const box = $('s-agent-list');
    if (!box) return;
    const targets = getTargets();
    const offices = getOffices();
    const registered = st.projects || targets.filter((x) => x.registered);
    const loose = targets.filter((x) => !x.registered);
    const status = (a) => (!a.exists ? el('span', { class: 's-bad', title: A('pathMissing') }, `⚠ ${A('pathMissingShort')}`)
      : !a.available ? el('span', { class: 's-bad', title: A('cliMissing', { agent: HARNESS_NAME[a.harness] }) }, `⚠ ${A('cliMissingShort')}`)
        : a.sessions?.some((x) => x.live) ? el('span', { class: 's-ok' }, `● ${A('sessionOpenShort')}`) : null);
    const uses = (a) => (st.relations || []).filter((r) => r.from === a.id).map((r) => registered.find((x) => x.id === r.to)?.name).filter(Boolean);
    const row = (a) => el('div', { class: 's-repo', title: tilde(a.path) },
      el('span', { class: 's-repo-ic', 'aria-hidden': 'true' }, KIND_ICON[a.kind] || '📦'),
      el('span', { class: 's-repo-main' },
        el('b', {}, a.name),
        el('span', { class: 'hint' }, [a.kind && a.kind !== 'other' ? t(`system.kinds.${a.kind}`) : '', HARNESS_NAME[a.harness] || a.harness, uses(a).length ? `→ ${uses(a).join(', ')}` : ''].filter(Boolean).join(' · '))),
      a.instructions ? el('span', { class: 's-tag kind', title: a.instructions }, '📋') : null,
      status(a),
      el('span', { class: 's-repo-acts' },
        el('button', { type: 'button', class: 's-icon', title: A('sendPrompt'), 'aria-label': `${A('sendPrompt')} · ${a.name}`, onclick: () => onPrompt?.(a.id) }, '✉'),
        el('button', { type: 'button', class: 's-icon', title: t('settings.offices.map'), 'aria-label': `${t('settings.offices.map')} · ${a.name}`, onclick: () => { arch.go({ type: 'repo', id: a.id }); go('architecture'); } }, '🗺'),
        el('button', { type: 'button', class: 's-icon', title: A('edit'), 'aria-label': `${A('edit')} · ${a.name}`, onclick: () => editRepo(a) }, '✎'),
        el('button', { type: 'button', class: 's-icon danger', title: A('delete'), 'aria-label': `${A('delete')} · ${a.name}`, onclick: () => remove(a) }, '🗑')));
    const areas = st.areas || [{ id: 'general', name: t('areas.default') }];
    const groups = areas.map((ar) => [ar, offices.filter((o) => (o.area || 'general') === ar.id).map((o) => [o, registered.filter((a) => a.office === o.id)]).filter(([, list]) => list.length)]).filter(([, projects]) => projects.length);
    put(box,
      !registered.length ? el('p', { class: 'cfg-empty' }, A('noneWeb'))
        : groups.map(([ar, projects]) => el('div', { class: 's-repo-area' },
          areas.length > 1 ? el('h3', { class: 'cfg-sub' }, `🏛 ${ar.name}`) : null,
          projects.map(([o, list]) => el('div', { class: 's-repo-group' },
            el('h4', {}, `🧩 ${o.name} `, el('span', { class: 'hint' }, `(${list.length})`)),
            list.map(row))))),
      loose.length ? [el('h3', { class: 'cfg-sub' }, A('loose')), loose.map((a) => el('div', { class: 's-repo', title: tilde(a.path) },
        el('span', { class: 's-repo-ic', 'aria-hidden': 'true' }, '◌'),
        el('span', { class: 's-repo-main' }, el('b', {}, tilde(a.path)), el('span', { class: 'hint' }, HARNESS_NAME[a.harness] || a.harness)),
        el('span', { class: 's-repo-acts' }, el('button', { type: 'button', class: 's-mini', onclick: () => openRepo({ ...emptyForm(), path: a.path, harness: a.harness, office: '', touched: true }) }, A('register')))))] : null);
  }

  /** A new repository's window: its project chosen by you (`office` only when you came from a project). */
  const newRepo = (office = '') => openRepo({ ...emptyForm(), office });
  // its kind: the one you said (ownKind), or '' to keep the one its folder says
  const editRepo = (a) => openRepo({ ...emptyForm(), id: a.id, path: a.path, harness: a.harness, name: a.name, office: a.office, kind: a.ownKind || '', bin: a.bin || '', args: (a.args || []).join(' '), instructions: a.instructions || '', touched: true });
  function openRepo(form) {
    st.form = form;
    let dlg = $('s-repo-dialog');
    if (!dlg) { dlg = el('dialog', { id: 's-repo-dialog', class: 'brief settings repo-dlg', 'aria-labelledby': 's-form-title' }); document.body.append(dlg); }
    dlg.onclose = () => { if (st.form === form) st.form = emptyForm(); };
    renderForm();
    if (!dlg.open) dlg.showModal();
    if (form.path) detect();
  }

  /** The picker of repositories the office already knows (open sessions and registered ones). */
  function openRepoPicker(office) {
    // its window, made the first time (like the repository's)
    let pk = $('pick-repo');
    if (!pk) {
      pk = el('dialog', { id: 'pick-repo', class: 'brief settings pick-repo', 'aria-labelledby': 'pk-title' });
      document.body.append(pk);
    }
    const list = el('div', { class: 's-agents', id: 'pk-list' });
    put(pk, el('form', { method: 'dialog' },
      el('header', { class: 'brief-head' }, el('span', { class: 'pin', 'aria-hidden': 'true' }),
        el('h2', { id: 'pk-title' }, A('pick')),
        el('button', { type: 'button', class: 'brief-x', 'aria-label': t('settings.close'), onclick: () => pk.close() }, '✕')),
      el('div', { class: 'brief-body' }, el('p', { class: 'hint' }, A('pickHint')), list),
      el('footer', { class: 'brief-foot' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { pk.close(); startManualForm(); } }, A('pickManual')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => pk.close() }, A('cancel')))));
    const targets = getTargets();
    const offices = getOffices();
    st.pickOffice = office || '';
    const registered = st.projects || targets.filter((x) => x.registered);
    const loose = targets.filter((x) => !x.registered);
    const officeName = (id) => offices.find((o) => o.id === id)?.name || id;
    const row = (a, act) => el('div', { class: 's-agent' },
      el('div', { class: 's-agent-head' },
        el('b', {}, a.name), el('span', { class: 's-tag' }, HARNESS_NAME[a.harness] || a.harness),
        offices.length > 1 ? el('span', { class: 's-tag' }, `🧩 ${officeName(a.office)}`) : null,
        !a.exists ? el('span', { class: 's-bad' }, A('pathMissing')) : null),
      el('div', { class: 'hint' }, tilde(a.path)),
      el('div', { class: 's-row' }, act));
    const pick = (a) => () => {
      pk.close();
      if (st.tab !== 'repos') go('repos');
      if (a.registered) { editRepo(a); return; }
      openRepo({ ...emptyForm(), path: a.path, harness: a.harness, office: '', touched: true });
    };
    put(list,
      registered.length ? [el('h3', {}, A('pickRegistered')), registered.map((a) => row(a, el('button', { type: 'button', class: 's-mini', onclick: pick(a) }, A('pickEdit'))))] : null,
      loose.length ? [el('h3', {}, A('pickLoose')), loose.map((a) => row(a, el('button', { type: 'button', class: 's-mini', onclick: pick(a) }, A('pickChoose'))))] : null,
      (!registered.length && !loose.length) ? el('p', { class: 'hint' }, A('pickNone')) : null);
    pk.showModal();
  }

  /** The picker's "type the path" action: the empty form, in the repositories tab. */
  function startManualForm() {
    if (st.tab !== 'repos') go('repos');
    newRepo(st.pickOffice || '');
  }

  /** The repository's window: what it is, its project, its agent and kind; its instructions; what it uses; advanced. */
  function renderForm() {
    const f = st.form;
    const dlg = $('s-repo-dialog');
    if (!dlg) return;
    let timer = null;
    const pathInput = el('input', { type: 'text', value: f.path, placeholder: A('pathPhWeb'), 'aria-label': A('pathLabel'), required: true,
      oninput: (e) => { f.path = e.target.value; clearTimeout(timer); timer = setTimeout(detect, 350); } });
    const d = f.detected;
    const offices = getOffices();
    const areas = st.areas || [{ id: 'general', name: t('areas.default') }];
    const detectedKind = d?.kind || (st.projects || []).find((x) => x.id === f.id)?.kind || '';
    const repos = (st.projects || []).filter((x) => x.id !== f.id);
    const mine = f.id ? (st.relations || []).filter((r) => r.from === f.id) : [];
    const relTo = el('select', { 'aria-label': A('relTo') }, option('', A('relTo'), true), repos.map((x) => option(x.id, x.name, false)));
    const relHow = el('select', { 'aria-label': A('relHow') }, ['calls', 'uses', 'consumes', 'reads'].map((h) => option(h, t(`arch.how.${h}`), h === 'calls')));
    put(dlg,
      el('form', { method: 'dialog', class: 's-repo-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        el('header', { class: 'brief-head' }, el('span', { class: 'pin', 'aria-hidden': 'true' }), el('h2', { id: 's-form-title' }, f.id ? A('editTitle', { name: f.name || f.id }) : A('add')),
          el('button', { type: 'button', class: 'brief-x', 'aria-label': A('cancel'), onclick: () => dlg.close() }, '✕')),
        el('div', { class: 's-repo-body', id: 's-agent-form' },
          el('fieldset', { class: 's-fs' }, el('legend', {}, A('basics')),
            el('label', { class: 'b-field' }, el('span', {}, A('path')), pathInput),
            el('p', { class: 'hint', id: 's-detected' }, !d ? A('detectHint') : !d.exists ? A('detectNone')
              : A('detected', { what: [...d.kinds, ...(d.harnesses.length ? [d.harnesses.map((h) => HARNESS_NAME[h]).join(' + ')] : [])].join(' · ') || A('noHarness'), n: d.entries.length })),
            el('label', { class: 'b-field' }, el('span', {}, A('name')), el('input', { type: 'text', value: f.name, placeholder: A('namePh'), maxlength: 40, oninput: (e) => { f.name = e.target.value; } })),
            // its project: always chosen (grouped by area)
            el('label', { class: 'b-field' }, el('span', {}, A('project')),
              el('select', { 'aria-label': A('project'), class: f.office ? '' : 's-need', onchange: (e) => { f.office = e.target.value; f.msg = ''; e.target.classList.toggle('s-need', !f.office); } },
                option('', A('pickProject'), !f.office),
                areas.map((ar) => { const list = offices.filter((o) => (o.area || 'general') === ar.id); return list.length ? el('optgroup', { label: ar.name }, list.map((o) => option(o.id, o.name, o.id === f.office))) : null; }))),
            el('label', { class: 'b-field' }, el('span', {}, A('agent')),
              el('select', { 'aria-label': A('cliLabel'), onchange: (e) => { f.harness = e.target.value; f.touched = true; } },
                option('', A('choose'), !f.harness), ...Object.entries(HARNESS_NAME).map(([id, label]) => option(id, label + (d?.harnesses?.includes(id) ? A('configured') : ''), id === f.harness)))),
            el('label', { class: 'b-field' }, el('span', {}, A('kind')),
              el('select', { 'aria-label': A('kind'), onchange: (e) => { f.kind = e.target.value; } },
                option('', detectedKind ? A('kindDetected', { kind: t(`system.kinds.${detectedKind}`) }) : A('kindAuto'), !f.kind),
                (st.kindList || ['frontend', 'mobile', 'bff', 'backend', 'worker', 'library', 'data', 'infra', 'other']).map((k) => option(k, t(`system.kinds.${k}`), k === f.kind))))),
          el('fieldset', { class: 's-fs' }, el('legend', {}, A('instructions')),
            el('textarea', { rows: 4, maxlength: 4000, placeholder: A('instructionsPh'), 'aria-label': A('instructions'), oninput: (e) => { f.instructions = e.target.value; } }, f.instructions || '')),
          f.id ? el('fieldset', { class: 's-fs' }, el('legend', {}, A('usesTitle')),
            mine.length ? el('ul', { class: 's-rel-list' }, mine.map((r) => el('li', {},
              `→ ${repos.find((x) => x.id === r.to)?.name || r.to} · ${t(`arch.how.${r.how}`)}${r.note ? ` · ${r.note}` : ''}`,
              r.source === 'found' ? el('span', { class: 's-tag kind', title: r.evidence }, `🔍 ${t('arch.found')}`) : null,
              el('button', { type: 'button', class: 's-x', 'aria-label': t('arch.unrelate', { name: repos.find((x) => x.id === r.to)?.name || '' }), onclick: async () => { const x = await api('DELETE', `/v1/relations/${encodeURIComponent(r.id)}`); if (!x.ok) return msg(x.error); await loadProjects(); renderForm(); } }, '✕'))))
              : el('p', { class: 'hint' }, A('usesNone')),
            el('div', { class: 's-row' }, relTo, relHow,
              el('button', { type: 'button', class: 's-mini', onclick: async () => {
                if (!relTo.value) return msg(t('arch.relatePick'));
                const x = await api('POST', '/v1/relations', { from: f.id, to: relTo.value, how: relHow.value });
                if (!x.ok) return msg(x.error);
                await loadProjects(); renderForm();
              } }, `＋ ${t('arch.relate')}`))) : null,
          el('details', { class: 's-fs' }, el('summary', {}, A('advanced')),
            el('label', { class: 'b-field' }, el('span', {}, A('bin')), el('input', { type: 'text', value: f.bin, placeholder: A('binPh'), oninput: (e) => { f.bin = e.target.value; } })),
            el('label', { class: 'b-field' }, el('span', {}, A('args')), el('input', { type: 'text', value: f.args, placeholder: A('argsPh'), oninput: (e) => { f.args = e.target.value; } })),
            el('p', { class: 'hint' }, A('argsHint')))),
        el('footer', { class: 'brief-foot' },
          el('span', { class: 's-msg', id: 's-repo-msg', role: 'status' }, f.msg || ''),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, A('cancel')),
          el('button', { type: 'submit', class: 'btn' }, f.id ? A('saveChanges') : A('addAgent')))));
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
    if (focused) document.querySelector(`#s-repo-dialog [aria-label="${focused}"]`)?.focus();
  }

  async function save() {
    const f = st.form;
    // the window's line (kept in the form: a redraw while it detects the path does not lose it)
    const say = (text) => { f.msg = text; const m = $('s-repo-msg'); if (m) m.textContent = text; };
    // its project, always chosen: a repository never lands in one by itself
    if (!f.office) { say(t('err.pickProject')); $('s-repo-dialog')?.querySelector('select.s-need')?.focus(); return; }
    const body = { path: f.path, harness: f.harness, name: f.name, office: f.office, kind: f.kind || null, bin: f.bin || null, args: f.args.trim() ? f.args.trim().split(/\s+/) : null, instructions: f.instructions };
    const r = f.id ? await api('PUT', `/v1/agents/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/agents', body);
    if (!r.ok) return say(r.error);
    st.form = emptyForm();
    $('s-repo-dialog')?.close();
    msg(f.id ? A('updated') : A('added', { name: r.agent?.name }), true);
    onSaved?.();
    loadProjects();
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

  /**
   * 🧑 Characters: the team as a row of portraits, and one editor for the one you pick (who they are, how
   * they look, and its tools: random, back to default, export, import). Light: one character at a time.
   */
  function renderLook() {
    st.looks ||= Object.fromEntries(ROLE_ORDER.map((r) => [r, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, personOf(r)[k]]))]));
    if (!ROLE_ORDER.includes(st.lookRole)) st.lookRole = ROLE_ORDER.find((r) => r === 'tl') || ROLE_ORDER[0];
    const panel = panelOf('look');
    const role = st.lookRole;
    const look = st.looks[role];
    const roleText = (r) => (r === 'po' ? `${LK('role', { role: r })} · ${LK('you')}` : VISITORS[r] ? `${LK('role', { role: r })} · ${LK('visitor')}` : LK('role', { role: r }));
    // the roster: everyone, their portrait, name and title; a click edits them
    const portraits = [];
    const roster = el('div', { class: 's-roster', role: 'tablist', 'aria-label': LK('roster') }, ROLE_ORDER.map((r) => {
      const l = st.looks[r];
      const c = el('canvas', { 'aria-hidden': 'true' });
      portraits.push([c, r]);
      return el('button', { type: 'button', role: 'tab', class: 's-roster-item', 'aria-selected': String(r === role), title: roleText(r), onclick: () => { st.lookRole = r; renderLook(); } },
        c, el('span', { class: 's-roster-name' }, l.name || '?'), el('span', { class: 's-roster-title' }, l.title || r));
    }));
    const big = el('canvas', { class: 's-look-big', 'aria-label': LK('preview', { name: look.name }) });
    const redraw = () => { drawSprite(big, look, { id: role }); for (const [c, r] of portraits) if (r === role) drawSprite(c, look, { id: r }); };
    // a click on a swatch redraws the editor (to mark it); the free picker only the preview while dragging
    const set = (k, v, again = true) => { look[k] = v; if (again) renderLook(); else redraw(); };
    const toggle = (k) => el('label', {}, el('input', { type: 'checkbox', checked: look[k] ? true : undefined, onchange: (e) => set(k, e.target.checked, false) }), LK(k));
    const select = (k, values, label) => el('label', { class: 's-pick' }, el('span', {}, LK(k)),
      el('select', { 'aria-label': LK('of', { label: LK(k), name: look.name }), onchange: (e) => (k === 'sex' ? (Object.assign(look, lookForSex(e.target.value)), renderLook()) : set(k, e.target.value, false)) },
        values.map((v) => option(v, label(v), look[k] === v))));
    const editor = el('div', { class: 's-look-editor', role: 'tabpanel' },
      el('div', { class: 's-look-side' },
        big,
        el('p', { class: 'hint', title: VISITORS[role] ? LK('visitorHint') : undefined }, roleText(role)),
        el('div', { class: 's-look-tools' },
          el('button', { type: 'button', class: 's-icon', title: LK('randomTitle'), 'aria-label': LK('randomTitle'), onclick: () => { Object.assign(look, randomLook(look.sex)); renderLook(); } }, '🎲'),
          el('button', { type: 'button', class: 's-icon', title: LK('resetTitle'), 'aria-label': LK('resetTitle'), onclick: () => { Object.assign(look, defaultLook(role)); renderLook(); } }, '↺'),
          el('button', { type: 'button', class: 's-icon', title: LK('exportTitle', { name: look.name }), 'aria-label': LK('exportTitle', { name: look.name }), onclick: () => download(role, look) }, '⬇'),
          el('button', { type: 'button', class: 's-icon', title: LK('importTitle'), 'aria-label': LK('importTitle'), onclick: () => upload(role) }, '⬆'))),
      el('div', { class: 's-look-main' },
        el('fieldset', { class: 's-fs' }, el('legend', {}, LK('who')),
          el('div', { class: 'pair' },
            el('label', { class: 's-pick' }, el('span', {}, LK('name')), el('input', { type: 'text', value: look.name, maxlength: 20, 'aria-label': LK('name'), oninput: (e) => { look.name = e.target.value; } })),
            el('label', { class: 's-pick' }, el('span', {}, LK('title')), el('input', { type: 'text', value: look.title, maxlength: 30, 'aria-label': LK('title'), oninput: (e) => { look.title = e.target.value; } }))),
          el('div', { class: 'pair' },
            select('personality', Object.keys(PERSONALITIES), (v) => LK(`personalities.${v}`)),
            select('style', STYLES, (v) => LK(`styles.${v}`)))),
        el('fieldset', { class: 's-fs' }, el('legend', {}, LK('looks')),
          currentTheme() === 'anime' ? null : el('div', { class: 'pair' }, select('sex', SEXES, (v) => LK(`sexes.${v}`))),
          el('div', { class: 'colors' }, colorField(look, 'skin', set), colorField(look, 'hair', set), colorField(look, 'shirt', set), colorField(look, 'pants', set)),
          el('div', { class: 'toggles' }, toggle('long'), currentTheme() === 'anime' ? null : toggle('beard'), toggle('glasses')))));
    // keep the scroll and the focus where they were (a swatch redraws the panel)
    const box = $('cfg-content'), top = box?.scrollTop, focus = document.activeElement?.getAttribute('aria-label');
    put(panel,
      el('p', { class: 'hint' }, `${getOffice()?.name ? `🧩 ${getOffice().name} · ` : ''}${LK('hint')}`),
      roster, editor);
    for (const [c, r] of portraits) drawSprite(c, st.looks[r], { id: r });
    redraw();
    if (box) box.scrollTop = top;
    if (focus) [...panel.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === focus)?.focus();
  }

  // ------------------------------------------------------------ the subject matter experts (server/experts.js)

  const XK = (k, v) => t(`settings.experts.${k}`, v);
  const EXPERT_LOOK = APPEARANCE_KEYS;
  /** An expert as the form edits it: their skill, their topic and their whole look. */
  const expertForm = (x = {}) => ({
    id: x.id || null, skill: x.skill || '', topic: x.topic || '',
    look: { ...Object.fromEntries(EXPERT_LOOK.map((k) => [k, DEFAULT_EXPERT[k] ?? ''])), title: '', ...(x.look || {}) },
    actions: (Array.isArray(x.actions) ? x.actions : []).map((a) => ({ label: String(a?.label ?? ''), prompt: String(a?.prompt ?? '') })),
  });
  /** The experts and the skills the company knows (the archive's, yours, the projects'): to pick one. */
  async function loadExperts() {
    const r = await api('GET', '/v1/experts');
    if (!r.ok) return msg(r.error);
    st.experts = r.experts.map(expertForm);
    st.skills = r.skills || [];
    if (st.tab === 'experts' && st.open) renderExperts();
  }
  /** The experts changed elsewhere (another window): reloaded, unless one is being written here. */
  function expertsChanged() { if (st.open && st.tab === 'experts' && !st.experts?.some((x) => x.dirty)) loadExperts(); }

  /** 🎓 The experts: a character each, tied to a skill; they come up when an agent uses it. */
  function renderExperts() {
    const panel = panelOf('experts');
    const box = $('cfg-content'), top = box.scrollTop, focus = document.activeElement?.getAttribute('aria-label');
    put(panel, expertsBox());
    box.scrollTop = top;
    if (focus) [...panel.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === focus)?.focus();
  }

  /**
   * An expert's skill: picked from the ones the company knows, yours first (private, your agents' folders,
   * your Claude Code plugins), then the archive's and the projects'; or another one, typed.
   */
  function skillPick(x) {
    const OTHER = '__other__';
    const skills = st.skills || [];
    const groupOf = (k) => (k.where === 'mine' ? 'mine' : k.where === 'archive' ? 'archive' : String(k.where).startsWith('plugin:') ? 'plugin' : 'project');
    const custom = x.otherSkill || (x.skill && !skills.some((k) => k.name === x.skill));
    const label = (k) => ({ project: `${k.name} · ${k.where}`, plugin: `${k.name} · ${String(k.where).slice(7)}` }[groupOf(k)] || k.name);
    const pick = el('select', { 'aria-label': XK('skill'), onchange: (e) => {
      x.otherSkill = e.target.value === OTHER;
      x.skill = x.otherSkill ? '' : e.target.value;
      x.dirty = true;
      renderExperts();
    } },
      option('', XK('skillPick'), !x.skill && !custom),
      ['mine', 'plugin', 'archive', 'project'].map((g) => {
        const list = skills.filter((k) => groupOf(k) === g);
        return list.length ? el('optgroup', { label: XK(`skillFrom.${g}`) }, list.map((k) => option(k.name, label(k), !custom && k.name === x.skill))) : null;
      }),
      option(OTHER, XK('skillOther'), custom));
    return el('div', { class: 's-pick s-skill' }, el('span', {}, XK('skill')),
      el('span', { class: 's-skill-pick' }, pick,
        custom ? el('input', { type: 'text', value: x.skill, maxlength: 64, placeholder: XK('skillPh'), 'aria-label': XK('skillOther'), oninput: (e) => { x.skill = e.target.value; x.dirty = true; } }) : null),
      !skills.some((k) => k.where === 'mine') ? el('span', { class: 'hint' }, XK('skillNoneMine')) : null);
  }

  function expertsBox() {
    const list = st.experts;
    const card = (x, i) => {
      const look = x.look;
      const canvas = el('canvas', { 'aria-label': LK('preview', { name: look.name || '?' }) });
      const redraw = () => drawSprite(canvas, { ...DEFAULT_EXPERT, ...(currentTheme() === 'anime' ? ANIME_EXPERT : {}), ...look, ...(currentTheme() === 'anime' ? { sex: 'f', beard: false } : {}) }, { id: x.id || 'sme' });
      const set = (k, v, again = true) => { look[k] = v; x.dirty = true; if (again) renderExperts(); else redraw(); };
      const toggle = (k) => el('label', {}, el('input', { type: 'checkbox', checked: look[k] ? true : undefined, onchange: (e) => set(k, e.target.checked, false) }), LK(k));
      const select = (k, values, label) => el('label', { class: 's-pick' }, el('span', {}, LK(k)),
        el('select', { 'aria-label': LK('of', { label: LK(k), name: look.name }), onchange: (e) => (k === 'sex' ? (Object.assign(look, lookForSex(e.target.value)), x.dirty = true, renderExperts()) : set(k, e.target.value, false)) },
          values.map((v) => option(v, label(v), look[k] === v))));
      redraw();
      const save = async () => {
        const actions = x.actions.map((a) => ({ label: a.label.trim(), prompt: a.prompt.trim() })).filter((a) => a.label && a.prompt);
        const body = { skill: x.skill, topic: x.topic, look: Object.fromEntries(Object.entries(look).filter(([, v]) => v !== '' && v !== null && v !== undefined)), actions };
        const r = await api(x.id ? 'PUT' : 'POST', x.id ? `/v1/experts/${encodeURIComponent(x.id)}` : '/v1/experts', body);
        if (!r.ok) return msg(r.error);
        msg(XK('saved', { name: r.expert.look.name, skill: r.expert.skill }), true);
        await loadExperts();
      };
      const remove = async () => {
        if (x.id) {
          if (!confirm(XK('removeConfirm', { name: look.name, skill: x.skill }))) return;
          const r = await api('DELETE', `/v1/experts/${encodeURIComponent(x.id)}`);
          if (!r.ok) return msg(r.error);
        }
        list.splice(i, 1);
        renderExperts();
      };
      /** An action's button: it sends the prompt to the project agent that knows the skill. */
      const run = async (a) => {
        if (!x.id) return msg(XK('actionSaveFirst'));
        if (!String(a.prompt || '').trim()) return msg(XK('actionPromptEmpty'));
        const r = await api('POST', `/v1/experts/${encodeURIComponent(x.id)}/run`, { prompt: a.prompt });
        if (!r.ok) return msg(r.error);
        msg(XK('actionSent'), true);
      };
      /** The actions the skill offers, read from its SKILL.md (server/experts.js). */
      const suggest = async () => {
        const skill = String(x.skill || '').trim();
        if (!skill) return msg(XK('skillFirst'));
        const r = await api('GET', `/v1/experts/suggest?skill=${encodeURIComponent(skill)}`);
        if (!r.ok) return msg(r.error);
        const found = Array.isArray(r.actions) ? r.actions : [];
        if (!found.length) return msg(XK('actionNoSuggest'));
        const have = new Set(x.actions.map((a) => a.label.trim().toLowerCase()).filter(Boolean));
        let added = 0;
        for (const s of found) {
          const label = String(s.label ?? '').trim();
          if (!label || have.has(label.toLowerCase())) continue;
          x.actions.push({ label, prompt: String(s.prompt ?? '').trim() });
          have.add(label.toLowerCase());
          added++;
        }
        x.dirty = true;
        renderExperts();
        msg(XK('actionSuggested', { n: added }), true);
      };
      return el('div', { class: 's-look s-expert' },
        canvas,
        el('div', { class: 'pair' },
          el('input', { type: 'text', value: look.name, maxlength: 20, placeholder: XK('namePh'), 'aria-label': LK('name'), oninput: (e) => { look.name = e.target.value; x.dirty = true; } }),
          el('input', { type: 'text', value: look.title, maxlength: 30, placeholder: t('team.titles.sme', { skill: x.skill || '…', g: look.sex }), 'aria-label': LK('title'), oninput: (e) => { look.title = e.target.value; x.dirty = true; } })),
        skillPick(x),
        el('label', { class: 's-pick s-skill' }, el('span', {}, XK('topic')),
          el('input', { type: 'text', value: x.topic, maxlength: 120, placeholder: XK('topicPh'), 'aria-label': XK('topic'), oninput: (e) => { x.topic = e.target.value; x.dirty = true; } })),
        el('div', { class: 's-actions' },
          el('div', { class: 's-row' },
            el('span', { class: 'hint' }, XK('actionsHint')),
            el('button', { type: 'button', class: 's-mini', onclick: suggest }, XK('actionSuggest')),
            el('button', { type: 'button', class: 's-mini', onclick: () => { x.actions.push({ label: '', prompt: '' }); x.dirty = true; renderExperts(); } }, XK('actionAdd'))),
          x.actions.map((a) => el('div', { class: 's-action' },
            el('div', { class: 's-action-top' },
              el('input', { type: 'text', value: a.label, maxlength: 60, placeholder: XK('actionLabel'), 'aria-label': XK('actionLabel'), oninput: (e) => { a.label = e.target.value; x.dirty = true; } }),
              el('button', { type: 'button', class: 's-mini', title: XK('actionRun'), 'aria-label': XK('actionRun'), onclick: () => run(a) }, '▶'),
              el('button', { type: 'button', class: 's-mini danger', title: XK('actionRemove'), 'aria-label': XK('actionRemove'), onclick: () => { x.actions.splice(x.actions.indexOf(a), 1); x.dirty = true; renderExperts(); } }, '✕')),
            el('textarea', { rows: 2, maxlength: 4000, placeholder: XK('actionPrompt'), oninput: (e) => { a.prompt = e.target.value; x.dirty = true; } }, a.prompt)))),
        el('div', { class: 'pair' },
          currentTheme() === 'anime' ? null : select('sex', SEXES, (v) => LK(`sexes.${v}`)),
          select('personality', Object.keys(PERSONALITIES), (v) => LK(`personalities.${v}`))),
        el('div', { class: 'colors' }, colorField(look, 'skin', set), colorField(look, 'hair', set), colorField(look, 'shirt', set), colorField(look, 'pants', set)),
        el('div', { class: 'toggles' }, toggle('long'), currentTheme() === 'anime' ? null : toggle('beard'), toggle('glasses')),
        el('div', { class: 'toggles' },
          el('span', { class: 'hint' }, x.id ? XK('role', { skill: x.skill }) : XK('new')),
          el('button', { type: 'button', class: 's-mini', title: LK('randomTitle'), onclick: () => { Object.assign(look, randomLook(look.sex)); x.dirty = true; renderExperts(); } }, '🎲'),
          el('button', { type: 'button', class: 's-mini danger', title: XK('remove'), 'aria-label': XK('remove'), onclick: remove }, '🗑'),
          el('button', { type: 'button', class: 's-mini', onclick: save }, XK('save'))));
    };
    return el('section', { class: 's-experts' },
      el('p', { class: 'hint' }, XK('hint')),
      list ? el('div', { class: 's-looks' }, list.map(card)) : el('p', { class: 'hint' }, t('settings.loading')),
      el('div', { class: 's-row' }, el('button', { type: 'button', class: 's-mini', disabled: !list, onclick: () => { list.push({ ...expertForm(), dirty: true }); renderExperts(); } }, XK('add'))));
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
    const panel = panelOf('models');
    const p = prefs();
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

  // ------------------------------------------------------------ what draws each section, and the events

  const RENDER = {
    general: renderGeneral,
    game: renderGame,
    company: () => { renderCompany(); loadProjects(); },
    repos: () => { renderRepos(); loadProjects(); },
    architecture: () => arch.render(panelOf('architecture')),
    infra: () => { renderInfra(); loadProjects(); },
    autonomy: renderAutonomy,
    context: renderContext,
    models: () => { st.models = null; renderModels(); },
    intelligence: renderIntelligence,
    archive: () => { renderArchive(); indexStatus(); },
    terminal: renderTerminal,
    look: () => { st.looks = null; renderLook(); },
    experts: () => { st.experts = null; renderExperts(); loadExperts(); },
    mine: renderMine,
    backup: renderBackup,
    about: renderAbout,
  };

  $('settings-close').onclick = close;
  $('settings-save').onclick = () => (st.tab === 'look' ? saveLook() : st.tab === 'models' ? setPref({ models: st.models }) : null);
  $('settings-form').onsubmit = (e) => e.preventDefault();
  $('cfg-jump').onchange = (e) => go(e.target.value);
  const search = $('cfg-search');
  search.oninput = renderNav;
  // Enter goes to the first section found; Escape clears the search
  search.onkeydown = (e) => {
    if (e.key === 'Enter' && st.found?.length) { e.preventDefault(); go(st.found[0]); } else if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; renderNav(); }
  };
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  if (location.hash.startsWith('#settings')) route();

  return { open, close, refresh, appearanceChanged, expertsChanged, isOpen: () => st.open, go };
}
