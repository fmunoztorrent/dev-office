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
//   directives the executive floor's orders: one text sent to several offices' projects at once
//   knowledge  the archive floor: the company's notes, decisions, docs, skills and connectors
//
// Everything is validated before writing: an error returns { ok: false, error } and touches nothing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normRole } from './roles.js';
import { t, isLanguage, DEFAULT_LANGUAGE } from '../public/i18n.js';
import { validZone } from '../public/clock.js';
import { DEFAULT_MODELS, normalizeModels } from '../public/models.js';
import { SEXES, PERSONALITIES, STYLES } from '../public/sim.js';
import { realDir, insideDir } from './paths.js';
import { chunkText } from './chunks.js';

const HARNESS_IDS = ['claude-code', 'opencode', 'pi', 'codex'];
const ASKS_KEEP = 500;
const AGENTS_MAX = 100;
const OFFICES_MAX = 30;
const INSTRUCTIONS_MAX = 4000; // a department's or a project's instructions (and the company's standards)
/** How much a department works on its own: guided (the analyst reviews, the agent asks when in doubt),
 * balanced (it reviews, the agent works to the end), autonomous (no review). null: the company's. */
export const AUTONOMY_LEVELS = ['guided', 'balanced', 'autonomous'];
const PROMPTS_KEEP = 2000;
const DIRECTIVES_KEEP = 200;
const KNOWLEDGE_MAX = 5000;
export const KNOWLEDGE_KINDS = ['note', 'decision', 'doc', 'term', 'minute', 'skill', 'connector'];
const NAMED = new Set(['skill', 'connector']); // they are installed in a project by their name
const BODY_MAX = 1024 * 1024; // a whole document (its readable text); the archive indexes it in chunks
const COLOR_RX = /^#[0-9a-f]{6}$/i;
// what can be changed of each character, and how it is checked (a list: one of those values)
const APPEARANCE = { name: 'text', title: 'text', sex: SEXES, personality: Object.keys(PERSONALITIES), style: STYLES, shirt: 'color', pants: 'color', hair: 'color', skin: 'color', long: 'bool', beard: 'bool', glasses: 'bool' };
export const MAIN_OFFICE = 'main';
/** The building's floors: the executive one on top, the offices, and the archive in the basement. */
export const FLOORS = ['exec', 'office', 'archive'];

/** The general settings and their defaults. */
export const DEFAULT_PREFS = {
  lang: DEFAULT_LANGUAGE,       // the game's language: en | es
  timezone: null,               // the company's time zone (null: the system's); each office may have its own
  city: null,                   // the company's city, in that zone's country (null: the zone's city): weather, sun and moon
  weather: true,                // query the real weather (Open-Meteo); otherwise it is simulated by season
  herdr: { launch: true, direction: 'right', startAgent: 'auto', subagents: true }, // inside herdr: the agents (and each subagent) in panes
  log: { life: false },         // the terminal log also shows the office's life
  view: { office: MAIN_OFFICE, mode: 'flat', floor: 'office' }, // the office being watched, how it looks (front: flat, or isometric top-down: iso) and the floor (an office, the executive one or the archive)
  models: DEFAULT_MODELS,       // the model profiles (public/models.js) and the one used by default
  // how a brief is worked: the analyst first checks it has everything (and asks you only what is missing),
  // and the agent works on its own to the end (it asks only if it gets stuck)
  autonomy: { clarify: true, autonomous: true },
  // the company's standards (the CTO's): on top of every brief of every department, before its own
  standards: '',
  // how many briefs a department takes at once from a directive (the rest wait their turn)
  capacity: 3,
  // the archive as a RAG: its chunks go on top of every brief (push), and optionally they get an
  // embedding for the semantic search (off | ollama | openai, with its model and URL)
  archive: { push: true, embeddings: 'off', model: '', url: '' },
  // the agents' context: past this much it is compacted on its own (server/compact.js); `at` is tokens
  // (unit: tokens) or a share of the model's window (unit: pct)
  compact: { auto: true, at: 400_000, unit: 'tokens' },
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
  // Two more floors: the executive floor (directives across offices) and the archive (the company's knowledge).
  `CREATE TABLE directives (
     id         TEXT PRIMARY KEY,
     title      TEXT NOT NULL,
     text       TEXT NOT NULL,
     status     TEXT NOT NULL,               -- running | done | partial | failed | cancelled | interrupted
     parts      TEXT NOT NULL,               -- JSON: one per project it was sent to
     source     TEXT,                        -- who sent it (you, an agent through MCP…)
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX directives_by_date ON directives (created_at DESC);
   CREATE TABLE knowledge (
     id         TEXT PRIMARY KEY,
     kind       TEXT NOT NULL,               -- note | decision | doc | minute | skill | connector
     name       TEXT,                        -- a skill's or connector's name (a slug)
     title      TEXT NOT NULL,               -- for a skill: its description (what it does, when to use it)
     body       TEXT NOT NULL DEFAULT '',
     tags       TEXT,                        -- JSON: array of strings
     office_id  TEXT,                        -- null: the whole company
     source     TEXT,                        -- who saved it
     config     TEXT,                        -- JSON: a connector's { command, args } or { url }
     uses       INTEGER NOT NULL DEFAULT 0,  -- how many times an agent read it
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX knowledge_by_kind ON knowledge (kind, updated_at DESC);`,
  // Instructions to work with each department (an office) and each project (a folder), like a
  // ChatGPT or Claude project's: they go with every brief, pipeline, directive and question.
  `ALTER TABLE offices ADD COLUMN instructions TEXT;
   CREATE TABLE projects (
     path         TEXT PRIMARY KEY,           -- the project's folder (real path)
     instructions TEXT NOT NULL DEFAULT '',
     updated_at   INTEGER NOT NULL
   );`,
  // The archive as a RAG: each entry's readable text, cut into chunks with their full-text index (and,
  // if a provider is set, their embedding); what agents searched and did not find (the gaps); and an
  // entry's scope (a project folder), where it came from and until when it is valid.
  `ALTER TABLE knowledge ADD COLUMN project TEXT;
   ALTER TABLE knowledge ADD COLUMN origin TEXT;
   ALTER TABLE knowledge ADD COLUMN valid_until INTEGER;
   CREATE TABLE knowledge_chunks (
     id        INTEGER PRIMARY KEY,
     entry_id  TEXT NOT NULL,
     ord       INTEGER NOT NULL,
     heading   TEXT NOT NULL DEFAULT '',
     text      TEXT NOT NULL,
     embedding BLOB,                         -- Float32 vector (null: not embedded)
     model     TEXT                          -- which embedding model made it
   );
   CREATE INDEX chunks_by_entry ON knowledge_chunks (entry_id, ord);
   CREATE VIRTUAL TABLE knowledge_fts USING fts5(chunk_id UNINDEXED, title, heading, text, tokenize = 'unicode61 remove_diacritics 2');
   CREATE TABLE knowledge_gaps (
     id        INTEGER PRIMARY KEY,
     query     TEXT NOT NULL,
     key       TEXT NOT NULL,                -- the query folded, to merge the same one asked again
     office_id TEXT,
     project   TEXT,
     source    TEXT,                         -- who searched (an agent through MCP, a brief…)
     count     INTEGER NOT NULL DEFAULT 1,
     first_at  INTEGER NOT NULL,
     last_at   INTEGER NOT NULL,
     resolved  INTEGER NOT NULL DEFAULT 0
   );`,
  // 6 → 7: each department's autonomy (null: the company's)
  `ALTER TABLE offices ADD COLUMN autonomy TEXT;`,
  // 7 → 8: the components of each project you declare (the rest are detected from its folder: server/components.js)
  `CREATE TABLE components (
     id          TEXT PRIMARY KEY,
     project     TEXT NOT NULL,               -- the project's folder (real path)
     name        TEXT NOT NULL,
     path        TEXT NOT NULL DEFAULT '',    -- its folder inside the project ('' : not said)
     description TEXT NOT NULL DEFAULT '',
     created_at  INTEGER NOT NULL,
     UNIQUE (project, name)
   );`,
  // 8 → 9: what is yours (⚙ › Mine): your private skills and your own tools (server/mine.js)
  `CREATE TABLE mine (
     id         TEXT PRIMARY KEY,
     kind       TEXT NOT NULL CHECK (kind IN ('skill', 'tool')),
     name       TEXT NOT NULL,
     title      TEXT NOT NULL,                -- what it does and when to use it
     body       TEXT NOT NULL DEFAULT '',     -- a skill's instructions (Markdown) or a tool's script
     config     TEXT,                         -- JSON: a tool's runtime, parameters, time limit and role
     enabled    INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (kind, name)
   );`,
];

// what is yours (⚙ › Mine): how many, how long, and how your tools run
export const MINE_KINDS = ['skill', 'tool'];
export const TOOL_RUNTIMES = ['sh', 'bash', 'node', 'python3'];
const MINE_MAX = 200;
const MINE_BODY_MAX = 64 * 1024;

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };
const slug = (s, fallback = 'agente') => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback;
/** Lowercase and without accents: to compare words. */
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

/** A tool's config, checked: { run, params: [{ name, description, required }], timeout, role }. */
function toolConfig(c = {}) {
  if (c !== null && typeof c !== 'object') fail(t('err.prefValue', { key: 'config' }));
  c ||= {};
  const run = c.run ?? 'sh';
  if (!TOOL_RUNTIMES.includes(run)) fail(t('err.mineRun', { runs: TOOL_RUNTIMES.join(', ') }));
  const params = Array.isArray(c.params) ? c.params : [];
  if (params.length > 8) fail(t('err.mineParams'));
  const seen = new Set();
  const list = params.map((p) => {
    const name = String(p?.name ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(name) || seen.has(name)) fail(t('err.mineParam', { name }));
    seen.add(name);
    return { name, description: String(p?.description ?? '').trim().slice(0, 200), required: p?.required !== false };
  });
  const timeout = c.timeout === undefined || c.timeout === null || c.timeout === '' ? 60 : Number(c.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600) fail(t('err.mineTimeout'));
  const role = c.role ? String(c.role).toLowerCase() : null;
  if (role && !/^[a-z]{2,12}$/.test(role)) fail(t('err.prefValue', { key: 'role' }));
  return { run, params: list, timeout, ...(role ? { role } : {}) };
}
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
  store.indexAll({ onlyIfEmpty: true }); // an archive from before the RAG gets its chunks
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
    return r ? { id: r.id, name: r.name, timezone: r.timezone || null, location: r.location || null, instructions: r.instructions || '', autonomy: AUTONOMY_LEVELS.includes(r.autonomy) ? r.autonomy : null, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at } : null;
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
    const instructions = o.instructions !== undefined ? String(o.instructions ?? '').trim().slice(0, INSTRUCTIONS_MAX) : current.instructions ?? '';
    const autonomy = o.autonomy !== undefined ? (o.autonomy ? (AUTONOMY_LEVELS.includes(o.autonomy) ? o.autonomy : fail(t('err.autonomy', { levels: AUTONOMY_LEVELS.join(', ') }))) : null) : current.autonomy ?? null;
    return { name, timezone: tz, location, instructions, autonomy };
  }

  createOffice(input = {}) {
    return this.#write(() => {
      if (this.db.prepare('SELECT count(*) AS n FROM offices').get().n >= OFFICES_MAX) fail(t('err.officesMax', { n: OFFICES_MAX }));
      const o = this.#cleanOffice(input);
      let id = slug(input.id || o.name, 'oficina');
      for (let i = 2; this.getOffice(id); i++) id = `${slug(o.name, 'oficina')}-${i}`;
      const now = Date.now();
      const position = (this.db.prepare('SELECT max(position) AS p FROM offices').get().p ?? 0) + 1;
      this.db.prepare('INSERT INTO offices (id, name, timezone, location, instructions, autonomy, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, o.name, o.timezone, o.location, o.instructions || null, o.autonomy, position, now, now);
      return { ok: true, office: this.getOffice(id) };
    });
  }

  updateOffice(id, patch = {}) {
    return this.#write(() => {
      const current = this.getOffice(id);
      if (!current) return { ok: false, error: t('err.unknownOffice', { office: id }), status: 404 };
      const o = this.#cleanOffice(patch, current);
      this.db.prepare('UPDATE offices SET name = ?, timezone = ?, location = ?, instructions = ?, autonomy = ?, updated_at = ? WHERE id = ?').run(o.name, o.timezone, o.location, o.instructions || null, o.autonomy, Date.now(), current.id);
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
    const a = { id: r.id, name: r.name, path: r.path, harness: r.harness, office: r.office_id || MAIN_OFFICE, instructions: this.getProjectInstructions(r.path), createdAt: r.created_at, updatedAt: r.updated_at };
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
      if (input.instructions !== undefined) this.#instructions(a.path, input.instructions);
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
      if (patch.instructions !== undefined) this.#instructions(a.path, patch.instructions);
      return { ok: true, agent: this.getAgent(current.id) };
    });
  }

  deleteAgent(id) {
    const r = this.db.prepare('DELETE FROM agents WHERE id = ?').run(String(id));
    return r.changes ? { ok: true } : { ok: false, error: t('err.unknownAgent'), status: 404 };
  }

  // ---------------------------------------------------------------- a project's instructions (per folder)

  /** The instructions to work with the project in that folder ('' if it has none). */
  getProjectInstructions(dir) {
    if (!dir) return '';
    return this.db.prepare('SELECT instructions FROM projects WHERE path = ?').get(realDir(String(dir)))?.instructions || '';
  }
  #instructions(dir, text) {
    const key = realDir(String(dir));
    const clean = String(text ?? '').trim().slice(0, INSTRUCTIONS_MAX);
    if (!clean) this.db.prepare('DELETE FROM projects WHERE path = ?').run(key);
    else this.db.prepare('INSERT INTO projects (path, instructions, updated_at) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET instructions = excluded.instructions, updated_at = excluded.updated_at').run(key, clean, Date.now());
    return clean;
  }
  // ---------------------------------------------------------------- a project's components (declared)

  /** The components declared for a project's folder (all of them without `project`). */
  listComponents(project = null) {
    const rows = project ? this.db.prepare('SELECT * FROM components WHERE project = ? ORDER BY name').all(realDir(String(project))) : this.db.prepare('SELECT * FROM components ORDER BY project, name').all();
    return rows.map((r) => ({ id: r.id, project: r.project, name: r.name, path: r.path, description: r.description, createdAt: r.created_at }));
  }

  /** Declares a component of a project: { project (its folder), name, path? (inside it), description? }. Same name: updated. */
  addComponent({ project, name, path: sub = '', description = '' } = {}) {
    return this.#write(() => {
      const dir = String(project ?? '').trim();
      if (!dir || !path.isAbsolute(dir)) fail(t('err.pathRelative', { path: dir }));
      const clean = String(name ?? '').trim().slice(0, 60);
      if (!clean) fail(t('err.componentName'));
      const rel = String(sub ?? '').trim().replace(/^\.?\/+|\/+$/g, '').slice(0, 200);
      if (rel.split('/').includes('..') || path.isAbsolute(rel)) fail(t('err.componentPath'));
      const key = realDir(dir);
      const now = Date.now();
      const id = this.db.prepare('SELECT id FROM components WHERE project = ? AND name = ? COLLATE NOCASE').get(key, clean)?.id || `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.db.prepare('INSERT INTO components (id, project, name, path, description, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET path = excluded.path, description = excluded.description')
        .run(id, key, clean, rel, String(description ?? '').trim().slice(0, 300), now);
      return { ok: true, component: this.listComponents(key).find((c) => c.id === id) };
    });
  }

  deleteComponent(id) {
    const r = this.db.prepare('DELETE FROM components WHERE id = ?').run(String(id));
    return r.changes ? { ok: true } : { ok: false, status: 404, error: t('err.unknownComponent') };
  }

  // ---------------------------------------------------------------- what is yours: private skills and own tools

  #mine(r) {
    if (!r) return null;
    const config = json(r.config, {}) || {};
    return { id: r.id, kind: r.kind, name: r.name, title: r.title, body: r.body, enabled: !!r.enabled, ...(r.kind === 'tool' ? { config } : {}), createdAt: r.created_at, updatedAt: r.updated_at };
  }
  /** Your private skills and your own tools (kind: only one of them). */
  listMine(kind = null) {
    const rows = kind ? this.db.prepare('SELECT * FROM mine WHERE kind = ? ORDER BY name').all(String(kind)) : this.db.prepare('SELECT * FROM mine ORDER BY kind, name').all();
    return rows.map((r) => this.#mine(r));
  }
  getMine(id) { return this.#mine(this.db.prepare('SELECT * FROM mine WHERE id = ?').get(String(id))); }
  findMine(kind, name) { return this.#mine(this.db.prepare('SELECT * FROM mine WHERE kind = ? AND name = ?').get(String(kind), String(name ?? '').toLowerCase())); }

  /**
   * Saves a skill or a tool of yours: { id?, kind, name, title, body, enabled?, config? }. Without `id`, one
   * with the same kind and name is updated. A tool's config: { run: sh | bash | node | python3, params:
   * [{ name, description?, required? }], timeout (seconds), role? }. Returns { ok, entry, created, was }.
   */
  saveMine(input = {}) {
    return this.#write(() => {
      const kind = input.kind;
      if (!MINE_KINDS.includes(kind)) fail(t('err.mineKind'));
      const name = String(input.name ?? '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) fail(t('err.mineName'));
      const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!title) fail(t('err.mineTitle'));
      const body = String(input.body ?? '');
      if (body.length > MINE_BODY_MAX) fail(t('err.knowledgeTooLong', { n: MINE_BODY_MAX / 1024 }));
      if (kind === 'tool' && !body.trim()) fail(t('err.mineScript'));
      const config = kind === 'tool' ? toolConfig(input.config) : null;
      const current = input.id ? this.getMine(input.id) : this.findMine(kind, name);
      if (input.id && !current) fail(t('err.unknownMine'));
      if (current && current.kind !== kind) fail(t('err.mineKind'));
      const clash = this.findMine(kind, name);
      if (clash && clash.id !== current?.id) fail(t('err.mineExists', { name }));
      const enabled = input.enabled === undefined ? (current ? current.enabled : true) : !!input.enabled;
      const now = Date.now();
      if (current) {
        this.db.prepare('UPDATE mine SET name = ?, title = ?, body = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ?').run(name, title, body, config && JSON.stringify(config), enabled ? 1 : 0, now, current.id);
        return { ok: true, entry: this.getMine(current.id), created: false, was: current };
      }
      if (this.db.prepare('SELECT count(*) AS n FROM mine').get().n >= MINE_MAX) fail(t('err.mineMax', { n: MINE_MAX }));
      const id = `m${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.db.prepare('INSERT INTO mine (id, kind, name, title, body, config, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, kind, name, title, body, config && JSON.stringify(config), enabled ? 1 : 0, now, now);
      return { ok: true, entry: this.getMine(id), created: true, was: null };
    });
  }

  deleteMine(id) {
    const e = this.getMine(id);
    if (!e) return { ok: false, status: 404, error: t('err.unknownMine') };
    this.db.prepare('DELETE FROM mine WHERE id = ?').run(e.id);
    return { ok: true, entry: e };
  }

  /** Every folder with instructions: [{ path, instructions }]. */
  listProjectInstructions() { return this.db.prepare('SELECT path, instructions FROM projects ORDER BY path').all().map((r) => ({ path: r.path, instructions: r.instructions })); }
  /** Sets (or, empty, removes) a project folder's instructions: an existing absolute path. */
  setProjectInstructions(dir, text) {
    return this.#write(() => {
      const raw = String(dir ?? '').trim().replace(/^~(?=$|\/)/, os.homedir());
      if (!raw) fail(t('err.pathMissing'));
      if (!path.isAbsolute(raw)) fail(t('err.pathRelative', { path: dir }));
      if (!fs.statSync(raw, { throwIfNoEntry: false })?.isDirectory()) fail(t('err.pathNotFound', { path: dir }));
      return { ok: true, path: realDir(raw), instructions: this.#instructions(raw, text) };
    });
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
      const zone = next.timezone;
      const bool = (key, v) => (typeof v === 'boolean' ? v : fail(t('err.prefValue', { key })));
      for (const [k, v] of Object.entries(patch)) {
        switch (k) {
          case 'lang': if (!isLanguage(v)) fail(t('err.language', { lang: v })); next.lang = v; break;
          case 'timezone': if (v !== null && !validZone(v)) fail(t('err.timezone', { tz: v })); next.timezone = v || null; break;
          case 'city':
            if (v !== null && typeof v !== 'string') fail(t('err.prefValue', { key: k }));
            next.city = String(v ?? '').trim().slice(0, 80) || null;
            break;
          case 'weather': next.weather = bool(k, v); break;
          case 'standards':
            if (v !== null && typeof v !== 'string') fail(t('err.prefValue', { key: k }));
            next.standards = String(v ?? '').trim().slice(0, INSTRUCTIONS_MAX);
            break;
          case 'capacity': {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 20) fail(t('err.prefValue', { key: k }));
            next.capacity = n;
            break;
          }
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
            if (v.floor !== undefined) next.view.floor = FLOORS.includes(v.floor) ? v.floor : fail(t('err.prefValue', { key: 'view.floor' }));
            break;
          case 'autonomy':
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            for (const [ak, av] of Object.entries(v)) {
              if (ak === 'clarify' || ak === 'autonomous') next.autonomy[ak] = bool(`autonomy.${ak}`, av);
              else fail(t('err.pref', { key: `autonomy.${ak}` }));
            }
            break;
          case 'archive':
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            for (const [ak, av] of Object.entries(v)) {
              if (ak === 'push') next.archive.push = bool('archive.push', av);
              else if (ak === 'embeddings') next.archive.embeddings = ['off', 'ollama', 'openai'].includes(av) ? av : fail(t('err.prefValue', { key: 'archive.embeddings' }));
              else if (ak === 'model') next.archive.model = String(av ?? '').trim().slice(0, 120);
              else if (ak === 'url') {
                const u = String(av ?? '').trim();
                if (u && !/^https?:\/\/[^\s]+$/i.test(u)) fail(t('err.prefValue', { key: 'archive.url' }));
                next.archive.url = u.slice(0, 300);
              } else fail(t('err.pref', { key: `archive.${ak}` }));
            }
            break;
          case 'compact': {
            if (!isObj(v)) fail(t('err.prefValue', { key: k }));
            const unit = next.compact.unit;
            for (const [ck, cv] of Object.entries(v)) {
              if (ck === 'auto') next.compact.auto = bool('compact.auto', cv);
              else if (ck === 'unit') next.compact.unit = ['tokens', 'pct'].includes(cv) ? cv : fail(t('err.prefValue', { key: 'compact.unit' }));
              else if (ck === 'at') next.compact.at = Number(cv);
              else fail(t('err.pref', { key: `compact.${ck}` }));
            }
            // another unit without a value: that unit's default
            if (next.compact.unit !== unit && v.at === undefined) next.compact.at = next.compact.unit === 'pct' ? 80 : DEFAULT_PREFS.compact.at;
            // a number of tokens (10k to 10M) or a share of the window (10 to 99 %)
            if (!Number.isFinite(next.compact.at) || (next.compact.unit === 'pct' ? next.compact.at < 10 || next.compact.at > 99 : next.compact.at < 10_000 || next.compact.at > 10_000_000)) fail(t('err.prefValue', { key: 'compact.at' }));
            next.compact.at = next.compact.unit === 'pct' ? Math.round(next.compact.at) : Math.round(next.compact.at / 1000) * 1000;
            break;
          }
          case 'models': {
            // a whole set ({ active, profiles }) or just which one is active ({ active })
            const merged = isObj(v) && !v.profiles ? { ...next.models, ...v } : v;
            if (isObj(v) && v.active && v.active !== 'none' && !(merged.profiles || {})[v.active]) fail(t('err.prefValue', { key: 'models.active' }));
            const out = normalizeModels(merged);
            if (!out.ok) fail(t('err.prefValue', { key: out.error }));
            next.models = out.models;
            break;
          }
          default: fail(t('err.pref', { key: k }));
        }
      }
      // another time zone (another country, perhaps): the city goes back to the zone's, unless one came too
      if (next.timezone !== zone && !('city' in patch)) next.city = null;
      this.#put('prefs', next);
      return { ok: true, prefs: next };
    });
  }

  /** The day (in the office's zone) each office had its last standup (server/standup.js). */
  getStandupDay(office) { return this.#get(`standup:${office}`, null); }
  setStandupDay(office, day) { this.#put(`standup:${office}`, String(day)); }
  /** When the office's last daily was (ms): the next one tells what happened since then. */
  getStandupAt(office) { const v = Number(this.#get(`standupAt:${office}`, 0)); return Number.isFinite(v) && v > 0 ? v : null; }
  setStandupAt(office, at) { this.#put(`standupAt:${office}`, String(Math.round(at))); }

  // ---------------------------------------------------------------- appearance (per office)

  #appearanceKey(office) { return !office || office === MAIN_OFFICE ? 'appearance' : `appearance:${office}`; }
  getAppearance(office = MAIN_OFFICE) { return this.#get(this.#appearanceKey(office), {}) || {}; }

  /** patch: { role: { name, title, sex, personality, style, shirt, pants, hair, skin, long, beard, glasses } | null } (null = the original) */
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
          else if (Array.isArray(type)) { if (!type.includes(v)) fail(t('err.oneOf', { role, key: k, values: type.join(', ') })); clean[k] = v; }
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

  /**
   * How briefs flowed per department since a time (from the history): { [office]: { briefs, done,
   * failed, leadMin } }; leadMin, the median minutes from sent to done. A brief belongs to its
   * registered agent's department, or to the one of the project its folder is in.
   */
  flowByOffice({ since = Date.now() - 7 * 86400_000 } = {}) {
    const agents = this.listAgents();
    const officeOf = (r) => agents.find((a) => a.id === r.agent_id)?.office
      || (r.cwd ? agents.filter((a) => insideDir(r.cwd, a.path)).sort((a, b) => b.path.length - a.path.length)[0]?.office : null) || MAIN_OFFICE;
    const out = {};
    for (const r of this.db.prepare('SELECT agent_id, cwd, status, created_at, updated_at FROM prompts WHERE created_at >= ?').all(since)) {
      const o = (out[officeOf(r)] ||= { briefs: 0, done: 0, failed: 0, leads: [] });
      o.briefs++;
      if (r.status === 'done') { o.done++; o.leads.push((r.updated_at - r.created_at) / 60_000); }
      if (r.status === 'failed') o.failed++;
    }
    for (const o of Object.values(out)) {
      const l = o.leads.sort((a, b) => a - b);
      o.leadMin = l.length ? Math.round(l.length % 2 ? l[(l.length - 1) / 2] : (l[l.length / 2 - 1] + l[l.length / 2]) / 2) : null;
      delete o.leads;
    }
    return out;
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

  // ---------------------------------------------------------------- the executive floor: directives

  /** Saves (or updates) a directive. d: { id, title, text, status, parts, source } */
  saveDirective(d) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO directives (id, title, text, status, parts, source, created_at, updated_at)
                     VALUES ($id, $title, $text, $status, $parts, $source, $created, $now)
                     ON CONFLICT (id) DO UPDATE SET status = excluded.status, parts = excluded.parts, updated_at = excluded.updated_at`)
      .run({
        $id: String(d.id), $title: String(d.title ?? ''), $text: String(d.text ?? ''), $status: String(d.status || 'running'),
        $parts: JSON.stringify(Array.isArray(d.parts) ? d.parts : []), $source: d.source ?? null, $created: d.createdAt || now, $now: now,
      });
    if (Math.random() < 0.05) this.db.prepare('DELETE FROM directives WHERE id NOT IN (SELECT id FROM directives ORDER BY created_at DESC LIMIT ?)').run(DIRECTIVES_KEEP);
  }

  #directive(r) {
    return r ? { id: r.id, title: r.title, text: r.text, status: r.status, parts: json(r.parts, []), source: r.source, createdAt: r.created_at, updatedAt: r.updated_at } : null;
  }
  listDirectives({ limit = 20 } = {}) {
    return this.db.prepare('SELECT * FROM directives ORDER BY created_at DESC LIMIT ?').all(Math.min(200, Number(limit) || 20)).map((r) => this.#directive(r));
  }
  getDirective(id) { return this.#directive(this.db.prepare('SELECT * FROM directives WHERE id = ?').get(String(id))); }

  // ---------------------------------------------------------------- the archive: the company's knowledge

  #knowledge(r) {
    if (!r) return null;
    const k = { id: r.id, kind: r.kind, title: r.title, body: r.body, tags: json(r.tags, []) || [], office: r.office_id || null, project: r.project || null, origin: r.origin || null, validUntil: r.valid_until || null, source: r.source || null, uses: r.uses, createdAt: r.created_at, updatedAt: r.updated_at };
    if (r.name) k.name = r.name;
    const config = json(r.config, null);
    if (isObj(config)) k.config = config;
    return k;
  }

  /** Validates an entry of the archive (patched over `current` when it is an update). */
  #cleanKnowledge(e, current = {}) {
    const kind = String(e.kind ?? current.kind ?? 'note');
    if (!KNOWLEDGE_KINDS.includes(kind)) fail(t('err.knowledgeKind', { kinds: KNOWLEDGE_KINDS.join(', ') }));
    const title = String(e.title ?? e.description ?? current.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!title) fail(t('err.knowledgeTitle'));
    const body = String(e.body ?? current.body ?? '');
    if (body.length > BODY_MAX) fail(t('err.knowledgeTooLong', { n: BODY_MAX / 1024 }));
    let tags = e.tags !== undefined ? e.tags : current.tags ?? [];
    // with commas, each one may have several words (a glossary synonym: "código de producto")
    if (typeof tags === 'string') tags = tags.split(tags.includes(',') ? /\s*,\s*/ : /\s+/);
    if (!Array.isArray(tags)) fail(t('err.prefValue', { key: 'tags' }));
    tags = [...new Set(tags.map((x) => slug(String(x), '')).filter(Boolean))].slice(0, 12);
    const officeRef = e.office !== undefined ? e.office : current.office ?? null;
    const office = officeRef ? (this.findOffice(officeRef) || fail(t('err.unknownOffice', { office: officeRef }))).id : null;
    let name = null, config = null;
    if (NAMED.has(kind)) {
      name = slug(e.name ?? current.name ?? title, '');
      if (!name) fail(t('err.knowledgeName'));
      const clash = this.db.prepare('SELECT id FROM knowledge WHERE kind = ? AND name = ? AND id != ?').get(kind, name, String(current.id || ''));
      if (clash) fail(t('err.knowledgeExists', { name }));
    }
    if (kind === 'connector') {
      const c = isObj(e.config) ? e.config : e.command || e.url || e.args ? { command: e.command, args: e.args, url: e.url } : current.config || {};
      const url = c.url ? String(c.url).trim() : '';
      const command = c.command ? String(c.command).trim().slice(0, 300) : '';
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) fail(t('err.connectorUrl'));
      if (!url && !command) fail(t('err.connectorHow'));
      let args = c.args ?? [];
      if (typeof args === 'string') args = args.trim() ? args.trim().split(/\s+/) : [];
      if (!Array.isArray(args) || args.some((x) => typeof x !== 'string')) fail(t('err.args', { name }));
      config = url ? { url: url.slice(0, 500) } : { command, args: args.slice(0, 30).map((x) => x.slice(0, 300)) };
    }
    const source = e.source !== undefined ? (e.source ? String(e.source).slice(0, 60) : null) : current.source ?? null;
    // a project folder (its scope: only that project's agents get it), where it came from, until when it holds
    const projectRef = e.project !== undefined ? e.project : current.project ?? null;
    const project = projectRef ? realDir(String(projectRef).replace(/^~(?=$|\/)/, os.homedir())) : null;
    if (project && !path.isAbsolute(project)) fail(t('err.pathRelative', { path: projectRef }));
    const origin = e.origin !== undefined ? (e.origin ? String(e.origin).trim().slice(0, 500) : null) : current.origin ?? null;
    const until = e.validUntil !== undefined ? e.validUntil : current.validUntil ?? null;
    const validUntil = until === null || until === '' ? null : Number.isFinite(Number(until)) ? Number(until) : Date.parse(String(until));
    if (validUntil !== null && !Number.isFinite(validUntil)) fail(t('err.prefValue', { key: 'validUntil' }));
    return { kind, name, title, body, tags, office, source, config, project, origin, validUntil };
  }

  /** Saves a new entry. With the name of a skill or connector that already exists, it updates that one. */
  createKnowledge(input = {}) {
    return this.#write(() => {
      const kind = String(input.kind || 'note');
      const named = NAMED.has(kind) && slug(input.name ?? input.title ?? '', '');
      const same = named && this.db.prepare('SELECT id FROM knowledge WHERE kind = ? AND name = ?').get(kind, named);
      if (same) return this.updateKnowledge(same.id, input);
      if (this.db.prepare('SELECT count(*) AS n FROM knowledge').get().n >= KNOWLEDGE_MAX) fail(t('err.knowledgeMax', { n: KNOWLEDGE_MAX }));
      const e = this.#cleanKnowledge(input);
      const now = Date.now();
      const id = `k${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.db.prepare('INSERT INTO knowledge (id, kind, name, title, body, tags, office_id, source, config, project, origin, valid_until, uses, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
        .run(id, e.kind, e.name, e.title, e.body, JSON.stringify(e.tags), e.office, e.source, e.config && JSON.stringify(e.config), e.project, e.origin, e.validUntil, now, now);
      this.#index(id);
      return { ok: true, entry: this.getKnowledge(id), created: true };
    });
  }

  updateKnowledge(id, patch = {}) {
    return this.#write(() => {
      const current = this.getKnowledge(id);
      if (!current) return { ok: false, error: t('err.unknownKnowledge'), status: 404 };
      const e = this.#cleanKnowledge(patch, current);
      this.db.prepare('UPDATE knowledge SET kind = ?, name = ?, title = ?, body = ?, tags = ?, office_id = ?, source = ?, config = ?, project = ?, origin = ?, valid_until = ?, updated_at = ? WHERE id = ?')
        .run(e.kind, e.name, e.title, e.body, JSON.stringify(e.tags), e.office, e.source, e.config && JSON.stringify(e.config), e.project, e.origin, e.validUntil, Date.now(), current.id);
      if (e.title !== current.title || e.body !== current.body) this.#index(current.id);
      return { ok: true, entry: this.getKnowledge(current.id), created: false };
    });
  }

  deleteKnowledge(id) {
    this.#unindex(String(id));
    const r = this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(String(id));
    return r.changes ? { ok: true } : { ok: false, error: t('err.unknownKnowledge'), status: 404 };
  }

  getKnowledge(id) { return this.#knowledge(this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(String(id))); }
  /** A skill or connector by its name. */
  findKnowledge(kind, name) { return this.#knowledge(this.db.prepare('SELECT * FROM knowledge WHERE kind = ? AND name = ?').get(String(kind), slug(String(name), ''))); }
  /** An agent read it: one more use. */
  touchKnowledge(id) { this.db.prepare('UPDATE knowledge SET uses = uses + 1 WHERE id = ?').run(String(id)); }

  /**
   * The archive's entries, the newest first; with `q`, the ones that match it best (every word
   * counts: in the title and the name it counts more than in the tags, and in the tags more than in
   * the body). `office`: that office's plus the whole company's.
   */
  listKnowledge({ kind, q, office, limit = 50 } = {}) {
    const n = Math.min(500, Math.max(1, Number(limit) || 50));
    let rows = kind ? this.db.prepare('SELECT * FROM knowledge WHERE kind = ? ORDER BY updated_at DESC').all(String(kind)) : this.db.prepare('SELECT * FROM knowledge ORDER BY updated_at DESC').all();
    if (office) rows = rows.filter((r) => !r.office_id || r.office_id === office);
    const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    if (!words.length) return rows.slice(0, n).map((r) => this.#knowledge(r));
    const scored = [];
    for (const r of rows) {
      const head = fold(`${r.title} ${r.name || ''}`), tags = fold(r.tags || ''), body = fold(r.body);
      let score = 0, hits = 0;
      for (const w of words) {
        const s = (head.includes(w) ? 6 : 0) + (tags.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0);
        if (s) hits++;
        score += s;
      }
      if (hits) scored.push([score * (hits / words.length), r]);
    }
    return scored.sort((a, b) => b[0] - a[0] || b[1].updated_at - a[1].updated_at).slice(0, n).map(([, r]) => this.#knowledge(r));
  }

  // ---------------------------------------------------------------- the archive as a RAG (server/rag.js)

  #unindex(id) {
    for (const c of this.db.prepare('SELECT id FROM knowledge_chunks WHERE entry_id = ?').all(id)) this.db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?').run(c.id);
    this.db.prepare('DELETE FROM knowledge_chunks WHERE entry_id = ?').run(id);
  }
  /** Cuts an entry's readable text into chunks and indexes them (their embeddings come later, if any). */
  #index(id) {
    const r = this.db.prepare('SELECT id, kind, title, body FROM knowledge WHERE id = ?').get(String(id));
    this.#unindex(String(id));
    if (!r) return 0;
    const pieces = chunkText(r.body, r.title);
    pieces.forEach((c, ord) => {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO knowledge_chunks (entry_id, ord, heading, text) VALUES (?, ?, ?, ?)').run(r.id, ord, c.heading, c.text);
      this.db.prepare('INSERT INTO knowledge_fts (chunk_id, title, heading, text) VALUES (?, ?, ?, ?)').run(Number(lastInsertRowid), r.title, c.heading, c.text);
    });
    return pieces.length;
  }
  /** Indexes every entry again (onlyIfEmpty: only when there are entries and no chunks, after the migration). */
  indexAll({ onlyIfEmpty = false } = {}) {
    if (onlyIfEmpty && (this.db.prepare('SELECT count(*) AS n FROM knowledge_chunks').get().n || !this.db.prepare('SELECT count(*) AS n FROM knowledge').get().n)) return 0;
    let n = 0;
    for (const r of this.db.prepare('SELECT id FROM knowledge').all()) n += this.#index(r.id);
    return n;
  }
  /** An entry's chunks, as they are indexed (to read them, and how many are embedded). */
  chunksOf(id) {
    return this.db.prepare('SELECT id, ord, heading, text, model, embedding IS NOT NULL AS embedded FROM knowledge_chunks WHERE entry_id = ? ORDER BY ord').all(String(id)).map((c) => ({ id: c.id, ord: c.ord, heading: c.heading, text: c.text, embedded: !!c.embedded, model: c.model || null }));
  }

  /**
   * The chunks that match a search (FTS5's bm25: lower is better), with their entry, in that scope:
   * the company's, the department's (office) and the project's (a folder that contains `project`),
   * still valid. { chunk, entry, rank }.
   */
  searchChunks(match, { office = null, project = null, kinds = null, limit = 20 } = {}) {
    if (!match) return [];
    let rows;
    try {
      rows = this.db.prepare(`SELECT f.chunk_id AS cid, bm25(knowledge_fts, 0, 4, 2, 1) AS rank FROM knowledge_fts f WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?`).all(match, Math.max(limit * 4, 40));
    } catch { return []; }
    return this.#inScope(rows.map((r) => ({ cid: r.cid, rank: r.rank })), { office, project, kinds }).slice(0, limit);
  }
  #inScope(hits, { office, project, kinds }) {
    const out = [];
    const now = Date.now();
    const entries = new Map();
    for (const h of hits) {
      const c = this.db.prepare('SELECT id, entry_id, ord, heading, text FROM knowledge_chunks WHERE id = ?').get(h.cid);
      if (!c) continue;
      if (!entries.has(c.entry_id)) entries.set(c.entry_id, this.getKnowledge(c.entry_id));
      const e = entries.get(c.entry_id);
      if (!e || (kinds && !kinds.includes(e.kind)) || e.kind === 'connector') continue;
      if (e.validUntil && e.validUntil < now) continue;
      if (e.office && e.office !== office) continue; // another department's (or a department's, and the search has none)
      if (e.project && (!project || !insideDir(project, e.project))) continue;
      out.push({ chunk: { id: c.id, ord: c.ord, heading: c.heading, text: c.text }, entry: e, rank: h.rank, ...(h.score !== undefined ? { score: h.score } : {}) });
    }
    return out;
  }
  /** The embedded chunks in that scope, for the semantic search: { chunk, entry, vector }. */
  vectorsInScope(model, { office = null, project = null } = {}) {
    const rows = this.db.prepare('SELECT id, embedding FROM knowledge_chunks WHERE model = ? AND embedding IS NOT NULL').all(String(model));
    const vectors = new Map(rows.map((r) => [r.id, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)]));
    return this.#inScope(rows.map((r) => ({ cid: r.id, rank: 0 })), { office, project }).map((h) => ({ ...h, vector: vectors.get(h.chunk.id) }));
  }
  /** Chunks still without an embedding of that model (to embed them in the background). */
  pendingChunks(model, limit = 32) {
    return this.db.prepare('SELECT c.id, c.heading, c.text, k.title FROM knowledge_chunks c JOIN knowledge k ON k.id = c.entry_id WHERE c.embedding IS NULL OR c.model IS NOT ? LIMIT ?').all(String(model), limit);
  }
  setEmbedding(chunkId, vector, model) {
    const v = vector instanceof Float32Array ? vector : Float32Array.from(vector);
    this.db.prepare('UPDATE knowledge_chunks SET embedding = ?, model = ? WHERE id = ?').run(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), String(model), Number(chunkId));
  }
  /** How the archive is indexed: chunks, and how many embedded with that model. */
  indexStatus(model = null) {
    const chunks = this.db.prepare('SELECT count(*) AS n FROM knowledge_chunks').get().n;
    const embedded = model ? this.db.prepare('SELECT count(*) AS n FROM knowledge_chunks WHERE model = ? AND embedding IS NOT NULL').get(String(model)).n : 0;
    return { chunks, embedded, model };
  }

  /** What an agent searched in the archive and did not find: the same question asked again adds up. */
  recordGap({ query, office = null, project = null, source = null } = {}) {
    const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    const key = fold(q).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) return null;
    const now = Date.now();
    const same = this.db.prepare('SELECT id FROM knowledge_gaps WHERE key = ? AND resolved = 0 AND office_id IS ?').get(key, office);
    if (same) this.db.prepare('UPDATE knowledge_gaps SET count = count + 1, last_at = ?, source = COALESCE(?, source) WHERE id = ?').run(now, source, same.id);
    else this.db.prepare('INSERT INTO knowledge_gaps (query, key, office_id, project, source, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(q, key, office, project, source, now, now);
    return same?.id ?? null;
  }
  listGaps({ office = null, limit = 50 } = {}) {
    return this.db.prepare('SELECT * FROM knowledge_gaps WHERE resolved = 0 ORDER BY count DESC, last_at DESC LIMIT ?').all(limit)
      .filter((g) => !office || !g.office_id || g.office_id === office)
      .map((g) => ({ id: g.id, query: g.query, office: g.office_id || null, project: g.project || null, source: g.source || null, count: g.count, firstAt: g.first_at, lastAt: g.last_at }));
  }
  resolveGap(id) {
    const r = this.db.prepare('UPDATE knowledge_gaps SET resolved = 1 WHERE id = ?').run(Number(id));
    return r.changes ? { ok: true } : { ok: false, status: 404, error: t('err.unknownGap') };
  }

  /** How many entries of each kind the archive keeps. */
  knowledgeCounts() {
    const out = Object.fromEntries(KNOWLEDGE_KINDS.map((k) => [k, 0]));
    for (const r of this.db.prepare('SELECT kind, count(*) AS n FROM knowledge GROUP BY kind').all()) out[r.kind] = r.n;
    return out;
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
