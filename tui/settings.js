// ⚙ Settings in the terminal: a form over the cork board, with the same tabs as the web.
//   General      language, time zone, real weather, herdr (agents in panes) and the log
//   Offices      the company's offices: name, time zone and location; view, edit, delete
//   Agents       the maintainer: add (full path + CLI + office), delete and send it a prompt;
//                shows what each one's harness brings
//   Characters   name, title, colors and features of the characters of the office being watched
// Everything is saved in the SQLite database (through the office's API).
// Keys: ↑↓/tab field · ◂▸ change · typing edits · Enter action · ctrl+s save · esc close

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES } from '../public/sim.js';
import { t, LANGUAGES } from '../public/i18n.js';
import { allZones, zoneInfo, countryName } from '../public/clock.js';
import { hex, fit, strWidth } from './screen.js';

const ROLES = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
const HARNESS_NAME = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
const TABS = ['general', 'offices', 'agents', 'look'];
const C = Object.fromEntries(Object.entries({
  cork: '#b9895a', corkDot: '#8f6640', paper: '#fdfcf6', ink: '#2b2d42', soft: '#6c757d', pin: '#ef476f', shadow: '#0a0b14',
  accent: '#ffd166', ok: '#2a9d8f', err: '#c1121f', field: '#ebe6d6', warn: '#9b5d1d',
}).map(([k, v]) => [k, hex(v)]));

const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
const cycle = (list, current, delta) => {
  const i = list.indexOf(current);
  return list[((i < 0 ? 0 : i) + delta + list.length) % list.length];
};
const yesNo = (v) => t(v ? 'settings.yes' : 'settings.no');
/** The zones that match what was typed (the city, the region or the country). */
const searchZones = (q, lang) => {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return allZones();
  return allZones().filter((z) => z.toLowerCase().replace(/_/g, ' ').includes(s) || countryName(zoneInfo(z).country, lang).toLowerCase().includes(s));
};

const HARNESS_IDS = ['claude-code', 'opencode', 'pi', 'codex'];
const emptyOffice = () => ({ id: null, name: '', timezone: null, location: '', tzQuery: '' });

/**
 * @param office  () => the office being watched (the characters' one)
 * @param onView  (id) => watch another office
 */
export function createSettings({ http, onSaved, onPrompt, office = () => 'main', onView }) {
  const s = {
    tab: 'general', focus: 0, msg: '', msgOk: false, loading: true, data: null, targets: [], offices: [], prefs: null, herdr: null,
    form: { path: '', harness: 'claude-code', name: '', office: office() }, looks: null, role: 'tl',
    tzQuery: '', officeForm: emptyOffice(),
  };

  async function api(method, path, body) {
    try {
      const res = await fetch(`${http}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  const say = (msg, ok = false) => { s.msg = msg; s.msgOk = ok; };

  async function loadAgents() {
    const r = await api('GET', '/v1/agents');
    if (r.ok) s.targets = r.agents;
  }
  async function loadSettings() {
    const r = await api('GET', `/v1/settings?office=${encodeURIComponent(office())}`);
    if (!r.ok) return say(r.error);
    s.data = r;
    s.prefs = r.office.prefs;
    s.offices = r.offices || [];
    s.herdr = r.herdr;
  }

  async function load() {
    await Promise.all([loadSettings(), loadAgents()]);
    s.loading = false;
    s.looks = Object.fromEntries(ROLES.map((role) => [role, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, TEAM[role][k]]))]));
  }

  /** A general setting: saved when changed. */
  async function setPref(patch) {
    const r = await api('PUT', '/v1/settings', { prefs: patch });
    if (!r.ok) return say(r.error);
    s.prefs = r.prefs;
    say(t('settings.saved'), true);
    onSaved?.();
  }

  // ---------------------------------------------------------------- agentes

  async function addAgent() {
    const r = await api('POST', '/v1/agents', s.form);
    if (!r.ok) return say(r.error);
    say(t('settings.agents.added', { name: r.agent.name }), true);
    s.form = { path: '', harness: 'claude-code', name: '', office: office() };
    await loadAgents();
  }

  async function removeAgent(a) {
    const r = await api('DELETE', `/v1/agents/${encodeURIComponent(a.id)}`);
    if (!r.ok) return say(r.error);
    say(t('settings.agents.removed', { name: a.name }), true);
    await loadAgents();
  }

  // ---------------------------------------------------------------- oficinas

  async function saveOffice() {
    const f = s.officeForm;
    const body = { name: f.name, timezone: f.timezone, location: f.location || null };
    const r = f.id ? await api('PUT', `/v1/offices/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/offices', body);
    if (!r.ok) return say(r.error);
    say(f.id ? t('settings.offices.updated') : t('settings.offices.created', { name: r.office.name }), true);
    s.officeForm = emptyOffice();
    await loadSettings();
  }

  async function deleteOffice(o) {
    const r = await api('DELETE', `/v1/offices/${encodeURIComponent(o.id)}`);
    if (!r.ok) return say(r.error);
    say(t('settings.offices.deleted'), true);
    await Promise.all([loadSettings(), loadAgents()]);
  }

  // ---------------------------------------------------------------- each tab's fields

  const tzLabel = (tz) => { const z = zoneInfo(tz); return `${tz}${z.country ? ` · ${countryName(z.country, s.prefs?.lang)}` : ''}`; };

  function fields() {
    const f = [{ type: 'tabs' }];
    if (s.loading) return [...f, { type: 'info', text: t('settings.loading') }];
    if (!s.data) return f;
    const p = s.prefs;
    if (s.tab === 'general') {
      f.push({ type: 'select', label: t('settings.general.language'), value: () => LANGUAGES[p.lang], cycle: (d) => setPref({ lang: cycle(Object.keys(LANGUAGES), p.lang, d) }) });
      const zones = () => searchZones(s.tzQuery, p.lang);
      const system = s.data.systemZone;
      f.push({ type: 'text', label: t('settings.general.timezone'), value: () => s.tzQuery, placeholder: () => (p.timezone ? tzLabel(p.timezone) : t('settings.general.tzSystem', { tz: system || '' })),
        edit: (v) => { s.tzQuery = v; }, enter: () => { const z = zones()[0]; if (z) { s.tzQuery = ''; setPref({ timezone: z }); } },
        suffix: () => (s.tzQuery ? `→ ${zones()[0] || '✗'}` : '') });
      f.push({ type: 'select', label: '', value: () => (p.timezone ? tzLabel(p.timezone) : t('settings.general.tzSystem', { tz: system || '' })),
        cycle: (d) => { const list = [null, ...zones()]; setPref({ timezone: cycle(list, p.timezone, d) }); } });
      f.push({ type: 'info', text: `  ${t('settings.general.tzHint')}` });
      f.push({ type: 'select', label: t('settings.general.weather'), value: () => t(p.weather ? 'settings.general.weatherOn' : 'settings.general.weatherOff'), cycle: () => setPref({ weather: !p.weather }) });
      f.push({ type: 'select', label: t('settings.general.life'), value: () => yesNo(p.log.life), cycle: () => setPref({ log: { life: !p.log.life } }) });
      f.push({ type: 'heading', text: t('settings.general.herdr') });
      f.push({ type: 'info', text: `  ${s.herdr?.available ? t('settings.general.herdrOn', { pane: s.herdr.pane || '?' }) : t('settings.general.herdrOff')}` });
      f.push({ type: 'select', label: t('settings.general.herdrLaunch'), value: () => yesNo(p.herdr.launch), cycle: () => setPref({ herdr: { launch: !p.herdr.launch } }) });
      f.push({ type: 'select', label: t('settings.general.herdrSubagents'), value: () => yesNo(p.herdr.subagents !== false), cycle: () => setPref({ herdr: { subagents: p.herdr.subagents === false } }) });
      f.push({ type: 'select', label: t('settings.general.herdrDirection'), value: () => t(`settings.general.${p.herdr.direction}`), cycle: () => setPref({ herdr: { direction: p.herdr.direction === 'right' ? 'down' : 'right' } }) });
      const starts = ['auto', 'none', ...s.targets.filter((x) => x.registered).map((x) => x.id)];
      const startLabel = (id) => (id === 'auto' || id === 'none' ? t(`settings.general.${id}`) : s.targets.find((x) => x.id === id)?.name || id);
      f.push({ type: 'select', label: t('settings.general.startAgent'), value: () => startLabel(p.herdr.startAgent), cycle: (d) => setPref({ herdr: { startAgent: cycle(starts, p.herdr.startAgent, d) } }) });
      f.push({ type: 'info', text: `  ${t('settings.file', { file: tilde(s.data.office.file) })}` });
    } else if (s.tab === 'offices') {
      f.push({ type: 'info', text: `  ${t('settings.offices.hint')}` });
      for (const o of s.offices) {
        const own = o.ownTimezone ? tzLabel(o.timezone) : t('settings.offices.inherit', { tz: o.timezone });
        f.push({ type: 'info', text: `  ${o.name}${o.id === 'main' ? ` (${t('settings.offices.main')})` : ''} · ${own} · ${t('settings.offices.agents', { n: o.agents })}${o.id === office() ? `  ${t('settings.offices.viewing')}` : ''}`, color: C.ink });
        if (o.id !== office()) f.push({ type: 'action', label: '', value: () => `👁 ${t('settings.offices.view')} ${o.name}`, run: () => onView?.(o.id) });
        f.push({ type: 'action', label: '', value: () => `✎ ${t('settings.offices.edit')} ${o.name}`, run: () => { s.officeForm = { id: o.id, name: o.custom ? o.name : '', timezone: o.ownTimezone, location: o.location || '', tzQuery: '' }; s.focus = 0; } });
        if (o.id !== 'main') f.push({ type: 'action', label: '', value: () => `✕ ${t('settings.offices.delete')} ${o.name}`, run: () => deleteOffice(o) });
      }
      const of = s.officeForm;
      f.push({ type: 'heading', text: of.id ? t('settings.offices.editTitle', { name: of.name || s.offices.find((o) => o.id === of.id)?.name }) : t('settings.offices.newTitle') });
      f.push({ type: 'text', label: t('settings.offices.name'), value: () => of.name, edit: (v) => { of.name = v.slice(0, 40); } });
      const zones = () => searchZones(of.tzQuery, p.lang);
      f.push({ type: 'text', label: t('settings.offices.timezone'), value: () => of.tzQuery, placeholder: () => (of.timezone ? tzLabel(of.timezone) : t('settings.offices.inherit', { tz: p.timezone || '' })),
        edit: (v) => { of.tzQuery = v; of.timezone = searchZones(v, p.lang)[0] || of.timezone; }, suffix: () => (of.tzQuery ? `→ ${zones()[0] || '✗'}` : '') });
      f.push({ type: 'select', label: '', value: () => (of.timezone ? tzLabel(of.timezone) : t('settings.offices.inherit', { tz: p.timezone || '' })), cycle: (d) => { of.timezone = cycle([null, ...zones()], of.timezone, d); } });
      f.push({ type: 'text', label: t('settings.offices.location'), value: () => of.location, placeholder: t('settings.offices.locationPh'), edit: (v) => { of.location = v.slice(0, 80); } });
      f.push({ type: 'action', label: '', value: () => (of.id ? t('settings.offices.saveChanges') : t('settings.offices.add')), run: () => saveOffice() });
      if (of.id) f.push({ type: 'action', label: '', value: () => t('settings.offices.cancel'), run: () => { s.officeForm = emptyOffice(); } });
    } else if (s.tab === 'agents') {
      const registered = s.targets.filter((x) => x.registered);
      const loose = s.targets.filter((x) => !x.registered);
      const officeName = (id) => s.offices.find((o) => o.id === id)?.name || id;
      f.push({ type: 'heading', text: t('settings.agents.registered') });
      if (!registered.length) f.push({ type: 'info', text: `  ${t('settings.agents.none')}` });
      for (const a of registered) {
        const flags = [a.sessions.some((x) => x.live) && t('settings.agents.open'), !a.exists && t('settings.agents.missing'), a.exists && !a.available && t('settings.agents.notInstalled')].filter(Boolean).join(' ');
        f.push({ type: 'info', text: `  ${a.name} · ${HARNESS_NAME[a.harness]}${a.kinds.length ? ` · ${a.kinds.join(' + ')}` : ''}${s.offices.length > 1 ? ` · 🏢 ${officeName(a.office)}` : ''} ${flags}`, color: C.ink });
        f.push({ type: 'info', text: `    ${tilde(a.path)} · ${a.entries.map((e) => e.label).join(', ')}` });
        f.push({ type: 'action', label: '', value: () => t('settings.agents.promptTo', { name: a.name }), run: () => onPrompt?.(a.id) });
        f.push({ type: 'action', label: '', value: () => t('settings.agents.removeOne', { name: a.name }), run: () => removeAgent(a) });
      }
      f.push({ type: 'heading', text: t('settings.agents.add') });
      f.push({ type: 'text', label: t('settings.agents.path'), value: () => s.form.path, placeholder: t('settings.agents.pathPh'), edit: (v) => { s.form.path = v; } });
      f.push({ type: 'select', label: t('settings.agents.agent'), value: () => HARNESS_NAME[s.form.harness], cycle: (d) => { s.form.harness = cycle(HARNESS_IDS, s.form.harness, d); } });
      f.push({ type: 'text', label: t('settings.agents.name'), value: () => s.form.name, placeholder: t('settings.agents.namePh'), edit: (v) => { s.form.name = v.slice(0, 40); } });
      if (s.offices.length > 1) f.push({ type: 'select', label: t('settings.agents.office'), value: () => officeName(s.form.office), cycle: (d) => { s.form.office = cycle(s.offices.map((o) => o.id), s.form.office, d); } });
      f.push({ type: 'action', label: '', value: () => t('settings.agents.addBtn'), run: () => addAgent() });
      if (loose.length) {
        f.push({ type: 'heading', text: t('settings.agents.loose') });
        for (const a of loose) f.push({ type: 'info', text: `  ${HARNESS_NAME[a.harness] || a.harness} · ${tilde(a.path)}${a.kinds.length ? ` · ${a.kinds.join(' + ')}` : ''}` });
      }
    } else if (s.tab === 'look') {
      const look = s.looks[s.role];
      const L = (k) => t(`settings.look.${k}`);
      f.push({ type: 'select', label: L('character'), value: () => `${look.name} (${s.role})`, cycle: (d) => { s.role = cycle(ROLES, s.role, d); } });
      f.push({ type: 'text', label: L('name'), value: () => look.name, edit: (v) => { look.name = v.slice(0, 20); } });
      f.push({ type: 'text', label: L('title'), value: () => look.title, edit: (v) => { look.title = v.slice(0, 30); } });
      for (const k of ['shirt', 'pants', 'hair', 'skin']) {
        const palette = () => (LOOK_PALETTES[k].includes(look[k]) ? LOOK_PALETTES[k] : [look[k], ...LOOK_PALETTES[k]]);
        f.push({ type: 'select', label: L(k), swatch: () => look[k], value: () => look[k], cycle: (d) => { look[k] = cycle(palette(), look[k], d); } });
      }
      for (const k of ['long', 'beard', 'glasses']) f.push({ type: 'select', label: L(k), value: () => yesNo(look[k]), cycle: () => { look[k] = !look[k]; } });
      f.push({ type: 'action', label: '', value: () => L('random'), run: () => {
        const pick = (l) => l[Math.floor(Math.random() * l.length)];
        Object.assign(look, { shirt: pick(LOOK_PALETTES.shirt), pants: pick(LOOK_PALETTES.pants), hair: pick(LOOK_PALETTES.hair), skin: pick(LOOK_PALETTES.skin), long: Math.random() < 0.5, beard: Math.random() < 0.3, glasses: Math.random() < 0.3 });
      } });
      f.push({ type: 'action', label: '', value: () => L('reset'), run: () => { Object.assign(look, DEFAULT_TEAM[s.role]); } });
    }
    return f;
  }

  const focusable = (f) => f.filter((x) => !['info', 'heading'].includes(x.type));

  // ---------------------------------------------------------------- guardar

  async function save() {
    if (!s.data) return;
    if (s.tab === 'agents') return addAgent();
    if (s.tab === 'offices') return saveOffice();
    if (s.tab !== 'look') return;
    const appearance = {};
    for (const role of ROLES) {
      const changed = Object.fromEntries(APPEARANCE_KEYS.filter((k) => s.looks[role][k] !== DEFAULT_TEAM[role][k]).map((k) => [k, s.looks[role][k]]));
      appearance[role] = Object.keys(changed).length ? changed : null;
    }
    const r = await api('PUT', '/v1/settings', { appearance, office: office() });
    if (!r.ok) return say(r.error);
    say(t('settings.saved'), true);
    onSaved?.();
  }

  // ---------------------------------------------------------------- teclado

  /** Returns 'close' when it has to close. */
  function key(k) {
    const all = fields();
    const list = focusable(all);
    if (s.focus >= list.length) s.focus = Math.max(0, list.length - 1);
    const cur = list[s.focus];
    if (k === 'esc') return 'close';
    if (k === '\x13') { save(); return; } // ctrl+s
    if (k === '\t' || k === 'down') { s.focus = (s.focus + 1) % list.length; return; }
    if (k === 'shift-tab' || k === 'up') { s.focus = (s.focus - 1 + list.length) % list.length; return; }
    if (k === 'left' || k === 'right') {
      const d = k === 'right' ? 1 : -1;
      if (cur?.type === 'tabs') { s.tab = cycle(TABS, s.tab, d); s.focus = 0; say(''); }
      else cur?.cycle?.(d);
      return;
    }
    if (k === '\r' || k === '\n') {
      if (cur?.run) { cur.run(); return; }
      if (cur?.enter) { cur.enter(); return; }
      s.focus = (s.focus + 1) % list.length;
      return;
    }
    if (!cur?.edit) return;
    const v = String(cur.value() ?? '');
    if (k === '\x7f' || k === '\b') cur.edit([...v].slice(0, -1).join(''));
    else if (k.length <= 2 && k >= ' ') cur.edit(v + k);
  }

  // ---------------------------------------------------------------- dibujo

  function draw(scr, L) {
    const w = Math.min(L.cols - 2, 100), h = Math.min(L.rows - 2, 36);
    const x0 = Math.floor((L.cols - w) / 2), y0 = Math.max(1, Math.floor((L.rows - h) / 2));
    for (let r = y0 + 1; r <= y0 + h; r++) scr.fill(x0 + 1, r, w, C.shadow);
    for (let r = y0; r < y0 + h; r++) {
      scr.fill(x0, r, w, C.cork);
      for (let c = x0; c < x0 + w; c++) if ((c + r * 3) % 7 === 0 && (r === y0 || r === y0 + h - 1 || c < x0 + 2 || c >= x0 + w - 2)) scr.text(c, r, '·', C.corkDot, C.cork);
    }
    for (let r = y0 + 1; r < y0 + h - 1; r++) scr.fill(x0 + 2, r, w - 4, C.paper);
    scr.text(x0 + Math.floor(w / 2), y0, '●', C.pin, C.cork);

    const col = x0 + 4, iw = w - 8;
    const previewW = s.tab === 'look' ? 14 : 0;
    const fw = iw - previewW;
    let row = y0 + 1;
    scr.text(col, row, t('settings.title'), C.ink, C.paper);
    scr.text(col + iw - 5, row, 'esc ✕', C.soft, C.paper);
    row += 2;

    const all = fields();
    const list = focusable(all);
    const cur = list[Math.min(s.focus, list.length - 1)];
    const bodyRows = y0 + h - 4 - row; // leaves room for the message and the help
    // scrolling so the focused field stays in sight
    const idx = all.indexOf(cur);
    const start = Math.max(0, Math.min(idx - Math.floor(bodyRows / 2), all.length - bodyRows));
    for (const f of all.slice(start, start + bodyRows)) {
      const focus = f === cur;
      if (f.type === 'tabs') {
        let c = col;
        for (const id of TABS) {
          const on = id === s.tab;
          c += scr.text(c, row, ` ${t(`settings.tabs.${id}`)} `, on ? C.accent : C.ink, on ? C.ink : C.field) + 1;
        }
        if (focus) scr.text(c + 1, row, t('settings.keys.tabs'), C.soft, C.paper);
      } else if (f.type === 'heading') {
        scr.text(col, row, fit(f.text, fw), C.ink, C.paper);
      } else if (f.type === 'info') {
        scr.text(col, row, fit(f.text, fw), f.color ?? C.soft, C.paper);
      } else {
        const labelW = 18;
        let c = col;
        scr.text(c, row, fit(f.label, labelW - 1), focus ? C.ink : C.soft, C.paper);
        c = col + labelW;
        const room = fw - labelW - 4;
        let v = String(f.value() ?? '');
        if (f.swatch) { scr.text(c, row, '██', hex(f.swatch()), C.paper); c += 3; }
        const ph = typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder;
        if (f.type === 'text') {
          const suffix = typeof f.suffix === 'function' ? f.suffix() : f.suffix;
          const boxW = room - (suffix ? Math.min(28, strWidth(suffix) + 1) : 0);
          scr.fill(c, row, boxW, focus ? C.accent : C.field);
          scr.text(c + 1, row, v ? fit(v, boxW - 3) : fit(ph || '', boxW - 3), v ? C.ink : C.soft, focus ? C.accent : C.field);
          if (focus) scr.text(c + 1 + Math.min(strWidth(v), boxW - 3), row, '▌', C.ink, C.accent);
          if (suffix) scr.text(c + boxW + 1, row, fit(suffix, room - boxW - 1), C.ok, C.paper);
        } else if (f.type === 'select') {
          v = fit(v, room - 6);
          if (focus) scr.text(c, row, ` ◂ ${v} ▸ `, C.accent, C.ink);
          else scr.text(c, row, `   ${v}`, C.ink, C.paper);
        } else if (f.type === 'action') {
          scr.text(c, row, ` ${fit(v, room - 2)} `, focus ? C.accent : C.ink, focus ? C.ink : C.field);
        }
      }
      row++;
    }
    if (s.tab === 'look' && s.looks) drawPreview(scr, x0 + w - 4 - previewW + 2, y0 + 4, s.looks[s.role]);

    const msgRow = y0 + h - 3;
    if (s.msg) scr.text(col, msgRow, fit(`${s.msgOk ? '✓' : '✖'} ${s.msg}`, iw), s.msgOk ? C.ok : C.err, C.paper);
    let c = col;
    for (const [k, label] of [['↑↓', 'field'], ['◂▸', 'change'], ['Enter', 'action'], ['ctrl+s', 'save'], ['esc', 'close']]) {
      c += scr.text(c, y0 + h - 2, k, C.ink, C.paper);
      c += scr.text(c, y0 + h - 2, ` ${t(`settings.keys.${label}`)}   `, C.soft, C.paper);
    }
  }

  // Character preview: the office's sprite, at double size, with half blocks.
  function drawPreview(scr, x, y, look) {
    const sh = hex(look.shirt), pa = hex(look.pants), ha = hex(look.hair), sk = hex(look.skin), eye = hex('#1a1a1a'), bg = hex('#c9b48a'), shoe = hex('#222222');
    const grid = Array.from({ length: 10 }, () => Array(5).fill(bg));
    const P = (cx, cy, col) => { if (grid[cy]?.[cx] !== undefined) grid[cy][cx] = col; };
    [[1, 0], [2, 0], [3, 0], [0, 1], [4, 1]].forEach(([cx, cy]) => P(cx, cy, ha));
    [1, 2, 3].forEach((cx) => { P(cx, 1, sk); P(cx, 3, look.beard ? ha : sk); });
    P(1, 2, eye); P(2, 2, look.glasses ? hex('#2b2b2b') : sk); P(3, 2, eye);
    if (look.long) { P(0, 2, ha); P(4, 2, ha); P(0, 3, ha); P(4, 3, ha); }
    for (let cy = 4; cy <= 6; cy++) for (let cx = 0; cx < 5; cx++) P(cx, cy, sh);
    P(0, 6, sk); P(4, 6, sk);
    for (const cy of [7, 8]) { P(1, cy, pa); P(3, cy, pa); }
    P(1, 9, shoe); P(3, 9, shoe);
    // each sprite pixel = 2 columns × 1 half row; two sprite rows per text row
    for (let r = 0; r < 5; r++) {
      for (let cx = 0; cx < 5; cx++) {
        for (const dx of [0, 1]) scr.text(x + cx * 2 + dx, y + r * 2, '▀', grid[r * 2][cx], grid[r * 2][cx]);
        for (const dx of [0, 1]) scr.text(x + cx * 2 + dx, y + r * 2 + 1, '▀', grid[r * 2 + 1][cx], grid[r * 2 + 1][cx]);
      }
    }
    scr.text(x, y + 10, fit(look.name, 12), hex('#2b2d42'), hex('#fdfcf6'));
  }

  load();
  return { key, draw, get state() { return s; } };
}
