// The office's database: SQLite (node:sqlite, no dependencies), at
// ~/.dev-team-office/office.db (or $DEV_TEAM_OFFICE_DB). It keeps everything that belongs to the frontend:
//
//   offices    the company's offices (teams or domains): name, time zone and location for the
//              weather. The main one ('main') is always there.
//   agents     the agents maintainer: a full path + the CLI that serves it + its office. What is
//              in that path (its harness, its pipelines) belongs to the agent: it is detected, not saved.
//   settings   the settings: `prefs` (language, the company's time zone, weather, herdr, log, the
//              office being watched) and the appearance of each office's characters
//   prompts    history of what was sent to the agents and how it ended
//
// Everything is validated before writing: an error returns { ok: false, error } and touches nothing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normRole } from './roles.js';
import { t, isLanguage, DEFAULT_LANGUAGE } from '../public/i18n.js';
import { validZone } from '../public/clock.js';

const HARNESS_IDS = ['claude-code', 'opencode', 'pi', 'codex'];
const ASKS_KEEP = 500;
const AGENTS_MAX = 100;
const OFFICES_MAX = 30;
const PROMPTS_KEEP = 2000;
const COLOR_RX = /^#[0-9a-f]{6}$/i;
const APPEARANCE = { name: 'text', title: 'text', shirt: 'color', pants: 'color', hair: 'color', skin: 'color', long: 'bool', beard: 'bool', glasses: 'bool' };
export const MAIN_OFFICE = 'main';

/** The general settings and their defaults. */
export const DEFAULT_PREFS = {
  lang: DEFAULT_LANGUAGE,       // the game's language: en | es
  timezone: null,               // the company's time zone (null: the system's); each office may have its own
  weather: true,                // query the real weather (Open-Meteo); otherwise it is simulated by season
  herdr: { launch: true, direction: 'right', startAgent: 'auto', subagents: true }, // inside herdr: the agents (and each subagent) in panes
  log: { life: false },         // the terminal log also shows the office's life
  view: { office: MAIN_OFFICE, mode: 'flat' }, // the office being watched and how it looks: front (flat) or isometric top-down (iso)
};

// The default language (until one is chosen in ⚙): $DEV_TEAM_OFFICE_LANG, otherwise English.
const defaultLang = () => (isLanguage(process.env.DEV_TEAM_OFFICE_LANG) ? process.env.DEV_TEAM_OFFICE_LANG : DEFAULT_LANGUAGE);

export const dbFile = () => process.env.DEV_TEAM_OFFICE_DB || path.join(os.homedir(), '.dev-team-office', 'office.db');
const legacyConfig = () => process.env.DEV_TEAM_OFFICE_CONFIG || path.join(os.homedir(), '.dev-team-office', 'config.json');

// Each migration takes the database from version i to i+1 (PRAGMA user_version).
const MIGRATIONS = [
  `CREATE TABLE agents (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     path       TEXT NOT NULL,
     harness    TEXT NOT NULL CHECK (harness IN ('claude-code', 'opencode', 'pi')),
     bin        TEXT,
     args       TEXT,                        -- JSON: argumentos extra del CLI
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (path, harness)
   );
   CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL                     -- JSON
   );
   CREATE TABLE prompts (
     id         TEXT PRIMARY KEY,
     agent_id   TEXT,                        -- agente registrado (o null: una sesión abierta)
     agent      TEXT NOT NULL,               -- claude-code | opencode | pi
     entry      TEXT,                        -- por dónde entró: prompt, errementari:feature, devteam:<id>…
     text       TEXT NOT NULL,
     session    TEXT,
     mode       TEXT NOT NULL,               -- session | launch | pipeline
     cwd        TEXT,
     status     TEXT NOT NULL,
     detail     TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX prompts_by_agent ON prompts (agent_id, created_at DESC);`,
  // Several offices (teams or domains) in the same instance, like a real company.
  `CREATE TABLE offices (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,               -- '' en la principal: se muestra "Oficina principal" en el idioma del juego
     timezone   TEXT,                        -- zona IANA (null: la de la empresa)
     location   TEXT,                        -- ciudad o "lat,lon" para el clima (null: la ciudad de la zona horaria)
     position   INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   INSERT INTO offices (id, name, position, created_at, updated_at)
     VALUES ('main', '', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
   ALTER TABLE agents ADD COLUMN office_id TEXT NOT NULL DEFAULT 'main';`,
  // Codex as a harness (SQLite cannot change a CHECK: the table is rebuilt) and side questions (btw).
  `CREATE TABLE agents_v3 (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     path       TEXT NOT NULL,
     harness    TEXT NOT NULL CHECK (harness IN ('claude-code', 'opencode', 'pi', 'codex')),
     bin        TEXT,
     args       TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     office_id  TEXT NOT NULL DEFAULT 'main',
     UNIQUE (path, harness)
   );
   INSERT INTO agents_v3 (id, name, path, harness, bin, args, created_at, updated_at, office_id)
     SELECT id, name, path, harness, bin, args, created_at, updated_at, office_id FROM agents;
   DROP TABLE agents;
   ALTER TABLE agents_v3 RENAME TO agents;
   CREATE TABLE asks (
     id         TEXT PRIMARY KEY,
     office_id  TEXT NOT NULL DEFAULT 'main',
     agent      TEXT,                        -- quién contesta: claude-code | opencode | pi | codex
     agent_id   TEXT,                        -- el agente registrado (si lo hay)
     session    TEXT,                        -- la sesión de turno que se bifurcó (si la había)
     cwd        TEXT,
     question   TEXT NOT NULL,
     answer     TEXT,
     status     TEXT NOT NULL,               -- asking | answered | failed
     error      TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX asks_by_office ON asks (office_id, created_at DESC);`,
];

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };
const slug = (s, fallback = 'agente') => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback;
const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Opens (and creates or migrates) the database. `file` ':memory:' is for the tests. */
export function openStore(file = dbFile()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fresh = file === ':memory:' || !fs.existsSync(file);
  const db = new DatabaseSync(file);
  if (file !== ':memory:') fs.chmodSync(file, 0o600); // only your user: it stores paths and prompts
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  const store = new Store(db, file);
  if (fresh && file !== ':memory:') store.importLegacy(legacyConfig());
  return store;
}

export class Store {
  constructor(db, file) {
    this.db = db;
    this.file = file;
  }

  #write(fn) {
    try { return fn(); } catch (err) {
      if (err instanceof Invalid) return { ok: false, error: err.message };
      if (/UNIQUE constraint failed: agents\.path/.test(err.message)) return { ok: false, error: t('err.agentExists') };
      return { ok: false, error: t('err.saveFailed', { error: err.message }) };
    }
  }

  // ---------------------------------------------------------------- oficinas

  #office(r) {
    return r ? { id: r.id, name: r.name, timezone: r.timezone || null, location: r.location || null, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at } : null;
  }
  listOffices() { return this.db.prepare('SELECT * FROM offices ORDER BY position, created_at').all().map((r) => this.#office(r)); }
  getOffice(id) { return this.#office(this.db.prepare('SELECT * FROM offices WHERE id = ?').get(String(id))); }

  /** An office by id, or by name (case- and accent-insensitive). */
  findOffice(ref) {
    if (!ref) return null;
    return this.getOffice(ref) || this.listOffices().find((o) => slug(o.name, '') === slug(ref, '-')) || null;
  }

  #cleanOffice(o, current = {}) {
    const name = String(o.name ?? current.name ?? '').trim().slice(0, 40);
    if (!name && current.id !== MAIN_OFFICE) fail(t('err.officeName'));
    const tz = o.timezone !== undefined ? (o.timezone ? String(o.timezone).trim() : null) : current.timezone ?? null;
    if (tz && !validZone(tz)) fail(t('err.timezone', { tz }));
    const location = o.location !== undefined ? (o.location ? String(o.location).trim().slice(0, 80) : null) : current.location ?? null;
    const clash = name && this.listOffices().find((x) => x.id !== current.id && slug(x.name, '') === slug(name, '-'));
    if (clash) fail(t('err.officeExists'));
    return { name, timezone: tz, location };
  }

  createOffice(input = {}) {
    return this.#write(() => {
      if (this.db.prepare('SELECT count(*) AS n FROM offices').get().n >= OFFICES_MAX) fail(t('err.officesMax', { n: OFFICES_MAX }));
      const o = this.#cleanOffice(input);
      let id = slug(input.id || o.name, 'oficina');
      for (let i = 2; this.getOffice(id); i++) id = `${slug(o.name, 'oficina')}-${i}`;
      const now = Date.now();
      const position = (this.db.prepare('SELECT max(position) AS p FROM offices').get().p ?? 0) + 1;
      this.db.prepare('INSERT INTO offices (id, name, timezone, location, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, o.name, o.timezone, o.location, position, now, now);
      return { ok: true, office: this.getOffice(id) };
    });
  }

  updateOffice(id, patch = {}) {
    return this.#write(() => {
      const current = this.getOffice(id);
      if (!current) return { ok: false, error: t('err.unknownOffice', { office: id }), status: 404 };
      const o = this.#cleanOffice(patch, current);
      this.db.prepare('UPDATE offices SET name = ?, timezone = ?, location = ?, updated_at = ? WHERE id = ?').run(o.name, o.timezone, o.location, Date.now(), current.id);
      return { ok: true, office: this.getOffice(current.id) };
    });
  }

  /** Deletes an office: its agents move to the main one (their folders are not touched). */
  deleteOffice(id) {
    if (String(id) === MAIN_OFFICE) return { ok: false, error: t('err.mainOffice') };
    if (!this.getOffice(id)) return { ok: false, error: t('err.unknownOffice', { office: id }), status: 404 };
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE agents SET office_id = ? WHERE office_id = ?').run(MAIN_OFFICE, String(id));
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`appearance:${id}`);
      this.db.prepare('DELETE FROM offices WHERE id = ?').run(String(id));
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); return { ok: false, error: t('err.saveFailed', { error: err.message }) }; }
    if (this.getPrefs().view.office === String(id)) this.setPrefs({ view: { office: MAIN_OFFICE } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- agentes (mantenedor)

  #row(r) {
    if (!r) return null;
    const a = { id: r.id, name: r.name, path: r.path, harness: r.harness, office: r.office_id || MAIN_OFFICE, createdAt: r.created_at, updatedAt: r.updated_at };
    if (r.bin) a.bin = r.bin;
    const args = json(r.args, null);
    if (Array.isArray(args)) a.args = args;
    return a;
  }

  listAgents() { return this.db.prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE, harness').all().map((r) => this.#row(r)); }
  getAgent(id) { return this.#row(this.db.prepare('SELECT * FROM agents WHERE id = ?').get(String(id))); }

  /** Validates an agent: an existing full path, a known CLI, name, executable, arguments and office. */
  #clean(a, current = {}) {
    const raw = String(a.path ?? current.path ?? '').trim();
    if (!raw) fail(t('err.pathMissing'));
    const expanded = raw.replace(/^~(?=$|\/)/, os.homedir());
    if (!path.isAbsolute(expanded)) fail(t('err.pathRelative', { path: raw }));
    const dir = path.resolve(expanded);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) fail(t('err.pathNotFound', { path: raw }));
    let harness = a.harness ?? current.harness;
    if (harness === 'claude') harness = 'claude-code';
    if (!HARNESS_IDS.includes(harness)) fail(t('err.harness'));
    const name = String(a.name ?? current.name ?? '').trim().slice(0, 40) || path.basename(dir);
    const bin = a.bin !== undefined ? (a.bin ? String(a.bin).trim().slice(0, 300) : null) : current.bin ?? null;
    let args = a.args !== undefined ? a.args : current.args ?? null;
    if (typeof args === 'string') args = args.trim() ? args.trim().split(/\s+/) : null;
    if (args !== null && (!Array.isArray(args) || args.some((x) => typeof x !== 'string'))) fail(t('err.args', { name }));
    const officeRef = a.office ?? current.office ?? MAIN_OFFICE;
    const office = this.findOffice(officeRef) || fail(t('err.unknownOffice', { office: officeRef }));
    return { name, path: dir, harness, bin, args: args && args.length ? args.slice(0, 30).map((x) => x.slice(0, 300)) : null, office: office.id };
  }

  createAgent(input = {}) {
    return this.#write(() => {
      if (this.db.prepare('SELECT count(*) AS n FROM agents').get().n >= AGENTS_MAX) fail(t('err.agentsMax', { n: AGENTS_MAX }));
      const a = this.#clean(input);
      let id = slug(input.id || `${a.name}-${a.harness}`);
      for (let i = 2; this.getAgent(id); i++) id = `${slug(`${a.name}-${a.harness}`)}-${i}`;
      const now = Date.now();
      this.db.prepare('INSERT INTO agents (id, name, path, harness, bin, args, office_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, a.name, a.path, a.harness, a.bin, a.args && JSON.stringify(a.args), a.office, now, now);
      return { ok: true, agent: this.getAgent(id) };
    });
  }

  updateAgent(id, patch = {}) {
    return this.#write(() => {
      const current = this.getAgent(id);
      if (!current) return { ok: false, error: t('err.unknownAgent'), status: 404 };
      const a = this.#clean(patch, current);
      this.db.prepare('UPDATE agents SET name = ?, path = ?, harness = ?, bin = ?, args = ?, office_id = ?, updated_at = ? WHERE id = ?')
        .run(a.name, a.path, a.harness, a.bin, a.args && JSON.stringify(a.args), a.office, Date.now(), current.id);
      return { ok: true, agent: this.getAgent(current.id) };
    });
  }

  deleteAgent(id) {
    const r = this.db.prepare('DELETE FROM agents WHERE id = ?').run(String(id));
    return r.changes ? { ok: true } : { ok: false, error: t('err.unknownAgent'), status: 404 };
  }

  // ---------------------------------------------------------------- ajustes generales

  #get(key, fallback) { return json(this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value, fallback) ?? fallback; }
  #put(key, value) { this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }

  /** The general settings, with the defaults for whatever has not been saved. */
  getPrefs() {
    const saved = this.#get('prefs', {});
    const out = structuredClone(DEFAULT_PREFS);
    out.lang = defaultLang();
    for (const [k, v] of Object.entries(isObj(saved) ? saved : {})) {
      if (!(k in out)) continue;
      out[k] = isObj(out[k]) && isObj(v) ? { ...out[k], ...v } : v;
    }
    if (!this.getOffice(out.view.office)) out.view.office = MAIN_OFFICE;
    return out;
  }

  /** Changes some settings (the rest stay as they are). Returns { ok, prefs } or { ok: false, error }. */
  setPrefs(patch = {}) {
    return this.#write(() => {
      if (!isObj(patch)) fail(t('err.prefValue', { key: 'prefs' }));
      const next = this.getPrefs();
      const bool = (key, v) => (typeof v === 'boolean' ? v : fail(t('err.prefValue', { key })));
      for (const [k, v] of Object.entries(patch)) {
        switch (k) {
          case 'lang': if (!isLanguage(v)) fail(t('err.language', { lang: v })); next.lang = v; break;
          case 'timezone': if (v !== null && !validZone(v)) fail(t('err.timezone', { tz: v })); next.timezone = v || null; break;
          case 'weather': next.weather = bool(k, v); break;
          case 'herdr':
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            for (const [hk, hv] of Object.entries(v)) {
              if (hk === 'launch') next.herdr.launch = bool('herdr.launch', hv);
              else if (hk === 'subagents') next.herdr.subagents = bool('herdr.subagents', hv);
              else if (hk === 'direction') next.herdr.direction = ['right', 'down'].includes(hv) ? hv : fail(t('err.prefValue', { key: 'herdr.direction' }));
              else if (hk === 'startAgent') {
                if (hv !== null && hv !== 'auto' && hv !== 'none' && !this.getAgent(hv)) fail(t('err.unknownAgent'));
                next.herdr.startAgent = hv ?? 'auto';
              } else fail(t('err.pref', { key: `herdr.${hk}` }));
            }
            break;
          case 'log':
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            for (const [lk, lv] of Object.entries(v)) {
              if (lk === 'life') next.log.life = bool('log.life', lv);
              else fail(t('err.pref', { key: `log.${lk}` }));
            }
            break;
          case 'view':
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            if (v.office !== undefined) next.view.office = this.getOffice(v.office)?.id || fail(t('err.unknownOffice', { office: v.office }));
            if (v.mode !== undefined) next.view.mode = ['flat', 'iso'].includes(v.mode) ? v.mode : fail(t('err.prefValue', { key: 'view.mode' }));
            break;
          default: fail(t('err.pref', { key: k }));
        }
      }
      this.#put('prefs', next);
      return { ok: true, prefs: next };
    });
  }

  // ---------------------------------------------------------------- appearance (per office)

  #appearanceKey(office) { return !office || office === MAIN_OFFICE ? 'appearance' : `appearance:${office}`; }
  getAppearance(office = MAIN_OFFICE) { return this.#get(this.#appearanceKey(office), {}) || {}; }

  /** patch: { role: { name, title, shirt, pants, hair, skin, long, beard, glasses } | null } (null = the original) */
  setAppearance(patch = {}, office = MAIN_OFFICE) {
    return this.#write(() => {
      if (!this.getOffice(office)) fail(t('err.unknownOffice', { office }));
      const appearance = { ...this.getAppearance(office) };
      for (const [key, look] of Object.entries(patch || {})) {
        const role = normRole(key) || fail(t('err.unknownRole', { role: key }));
        if (look === null) { delete appearance[role]; continue; }
        const clean = {};
        for (const [k, v] of Object.entries(look || {})) {
          const type = APPEARANCE[k] || fail(t('err.notEditable', { role, key: k }));
          if (type === 'color') { if (!COLOR_RX.test(String(v))) fail(t('err.color', { role, key: k })); clean[k] = String(v).toLowerCase(); }
          else if (type === 'bool') clean[k] = !!v;
          else {
            const s = String(v ?? '').trim();
            if (!s) fail(t('err.empty', { role, key: k }));
            clean[k] = s.slice(0, k === 'name' ? 20 : 30);
          }
        }
        if (Object.keys(clean).length) appearance[role] = clean; else delete appearance[role];
      }
      this.#put(this.#appearanceKey(office), appearance);
      return { ok: true, appearance };
    });
  }

  // ---------------------------------------------------------------- prompt history

  /** Saves (or updates) a sent prompt. p: { id, agentId, agent, entry, text, session, mode, cwd, status, detail } */
  savePrompt(p) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO prompts (id, agent_id, agent, entry, text, session, mode, cwd, status, detail, created_at, updated_at)
                     VALUES ($id, $agentId, $agent, $entry, $text, $session, $mode, $cwd, $status, $detail, $now, $now)
                     ON CONFLICT (id) DO UPDATE SET session = excluded.session, status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`)
      .run({
        $id: String(p.id), $agentId: p.agentId ?? null, $agent: String(p.agent || 'agente'), $entry: p.entry ?? null, $text: String(p.text ?? ''),
        $session: p.session ?? null, $mode: String(p.mode || 'session'), $cwd: p.cwd ?? null, $status: String(p.status || 'new'), $detail: p.detail ?? null, $now: now,
      });
    if (Math.random() < 0.02) this.db.prepare('DELETE FROM prompts WHERE id NOT IN (SELECT id FROM prompts ORDER BY created_at DESC LIMIT ?)').run(PROMPTS_KEEP);
  }

  listPrompts({ agentId, limit = 50 } = {}) {
    const rows = agentId
      ? this.db.prepare('SELECT * FROM prompts WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(String(agentId), Math.min(500, Number(limit) || 50))
      : this.db.prepare('SELECT * FROM prompts ORDER BY created_at DESC LIMIT ?').all(Math.min(500, Number(limit) || 50));
    return rows.map((r) => ({ id: r.id, agentId: r.agent_id, agent: r.agent, entry: r.entry, text: r.text, session: r.session, mode: r.mode, cwd: r.cwd, status: r.status, detail: r.detail, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  // ---------------------------------------------------------------- side questions (btw)

  /** Saves (or updates) a btw question. q: { id, office, agent, agentId, session, cwd, question, answer, status, error } */
  saveAsk(q) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO asks (id, office_id, agent, agent_id, session, cwd, question, answer, status, error, created_at, updated_at)
                     VALUES ($id, $office, $agent, $agentId, $session, $cwd, $question, $answer, $status, $error, $now, $now)
                     ON CONFLICT (id) DO UPDATE SET agent = excluded.agent, agent_id = excluded.agent_id, session = excluded.session, cwd = excluded.cwd,
                       answer = excluded.answer, status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`)
      .run({
        $id: String(q.id), $office: String(q.office || MAIN_OFFICE), $agent: q.agent ?? null, $agentId: q.agentId ?? null, $session: q.session ?? null,
        $cwd: q.cwd ?? null, $question: String(q.question ?? ''), $answer: q.answer ?? null, $status: String(q.status || 'asking'), $error: q.error ?? null, $now: now,
      });
    if (Math.random() < 0.05) this.db.prepare('DELETE FROM asks WHERE id NOT IN (SELECT id FROM asks ORDER BY created_at DESC LIMIT ?)').run(ASKS_KEEP);
  }

  listAsks({ office, limit = 20 } = {}) {
    const n = Math.min(200, Number(limit) || 20);
    const rows = office
      ? this.db.prepare('SELECT * FROM asks WHERE office_id = ? ORDER BY created_at DESC LIMIT ?').all(String(office), n)
      : this.db.prepare('SELECT * FROM asks ORDER BY created_at DESC LIMIT ?').all(n);
    return rows.map((r) => ({ id: r.id, office: r.office_id, agent: r.agent, agentId: r.agent_id, session: r.session, cwd: r.cwd, question: r.question, answer: r.answer, status: r.status, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  // ---------------------------------------------------------------- migration from config.json

  /** The first time, brings over whatever was in ~/.dev-team-office/config.json (it does not delete it). */
  importLegacy(file) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (raw.appearance) this.setAppearance(raw.appearance);
    for (const a of Array.isArray(raw.agents) ? raw.agents : []) this.createAgent(a);
  }

  close() { this.db.close(); }
}
