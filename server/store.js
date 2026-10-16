// La base de datos de la oficina: SQLite (node:sqlite, sin dependencias), en
// ~/.dev-team-office/office.db (o $DEV_TEAM_OFFICE_DB). Guarda lo que es del frontend:
//
//   agents     el mantenedor de agentes: una ruta completa + el CLI que la atiende. Lo que hay
//              en esa ruta (su harness, sus pipelines) es del agente: no se guarda, se detecta.
//   settings   ajustes de la oficina (la apariencia de los personajes)
//   prompts    historial de lo que se les mandó a los agentes y cómo terminó
//
// Todo se valida antes de escribir: un error devuelve { ok: false, error } y no toca nada.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normRole } from './roles.js';

const HARNESS_IDS = ['claude-code', 'opencode', 'pi'];
const AGENTS_MAX = 100;
const PROMPTS_KEEP = 2000;
const COLOR_RX = /^#[0-9a-f]{6}$/i;
const APPEARANCE = { name: 'text', title: 'text', shirt: 'color', pants: 'color', hair: 'color', skin: 'color', long: 'bool', beard: 'bool', glasses: 'bool' };

export const dbFile = () => process.env.DEV_TEAM_OFFICE_DB || path.join(os.homedir(), '.dev-team-office', 'office.db');
const legacyConfig = () => process.env.DEV_TEAM_OFFICE_CONFIG || path.join(os.homedir(), '.dev-team-office', 'config.json');

// Cada migración lleva la base de la versión i a la i+1 (PRAGMA user_version).
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
];

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agente';
const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

/** Abre (y crea o migra) la base. `file` ':memory:' sirve para los tests. */
export function openStore(file = dbFile()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fresh = file === ':memory:' || !fs.existsSync(file);
  const db = new DatabaseSync(file);
  if (file !== ':memory:') fs.chmodSync(file, 0o600); // sólo tu usuario: guarda rutas y prompts
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

  // ---------------------------------------------------------------- agentes (mantenedor)

  #row(r) {
    if (!r) return null;
    const a = { id: r.id, name: r.name, path: r.path, harness: r.harness, createdAt: r.created_at, updatedAt: r.updated_at };
    if (r.bin) a.bin = r.bin;
    const args = json(r.args, null);
    if (Array.isArray(args)) a.args = args;
    return a;
  }

  listAgents() { return this.db.prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE, harness').all().map((r) => this.#row(r)); }
  getAgent(id) { return this.#row(this.db.prepare('SELECT * FROM agents WHERE id = ?').get(String(id))); }

  /** Valida un agente: ruta completa existente, CLI conocido, nombre, ejecutable y argumentos. */
  #clean(a, current = {}) {
    const raw = String(a.path ?? current.path ?? '').trim();
    if (!raw) fail('falta la ruta');
    const expanded = raw.replace(/^~(?=$|\/)/, os.homedir());
    if (!path.isAbsolute(expanded)) fail(`${raw}: usa la ruta completa (p. ej. ~/Workspace/mi-proyecto)`);
    const dir = path.resolve(expanded);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) fail(`${raw}: no existe esa carpeta`);
    let harness = a.harness ?? current.harness;
    if (harness === 'claude') harness = 'claude-code';
    if (!HARNESS_IDS.includes(harness)) fail('elige el agente que atiende esa ruta: claude-code, opencode o pi');
    const name = String(a.name ?? current.name ?? '').trim().slice(0, 40) || path.basename(dir);
    const bin = a.bin !== undefined ? (a.bin ? String(a.bin).trim().slice(0, 300) : null) : current.bin ?? null;
    let args = a.args !== undefined ? a.args : current.args ?? null;
    if (typeof args === 'string') args = args.trim() ? args.trim().split(/\s+/) : null;
    if (args !== null && (!Array.isArray(args) || args.some((x) => typeof x !== 'string'))) fail(`${name}: args debe ser una lista de textos`);
    return { name, path: dir, harness, bin, args: args && args.length ? args.slice(0, 30).map((x) => x.slice(0, 300)) : null };
  }

  #write(fn) {
    try { return fn(); } catch (err) {
      if (err instanceof Invalid) return { ok: false, error: err.message };
      if (/UNIQUE constraint failed: agents\.path/.test(err.message)) return { ok: false, error: 'ese agente ya está registrado en esa ruta' };
      return { ok: false, error: `no se pudo guardar: ${err.message}` };
    }
  }

  createAgent(input = {}) {
    return this.#write(() => {
      if (this.db.prepare('SELECT count(*) AS n FROM agents').get().n >= AGENTS_MAX) fail(`como máximo ${AGENTS_MAX} agentes`);
      const a = this.#clean(input);
      let id = slug(input.id || `${a.name}-${a.harness}`);
      for (let i = 2; this.getAgent(id); i++) id = `${slug(`${a.name}-${a.harness}`)}-${i}`;
      const now = Date.now();
      this.db.prepare('INSERT INTO agents (id, name, path, harness, bin, args, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, a.name, a.path, a.harness, a.bin, a.args && JSON.stringify(a.args), now, now);
      return { ok: true, agent: this.getAgent(id) };
    });
  }

  updateAgent(id, patch = {}) {
    return this.#write(() => {
      const current = this.getAgent(id);
      if (!current) return { ok: false, error: 'agente desconocido', status: 404 };
      const a = this.#clean(patch, current);
      this.db.prepare('UPDATE agents SET name = ?, path = ?, harness = ?, bin = ?, args = ?, updated_at = ? WHERE id = ?')
        .run(a.name, a.path, a.harness, a.bin, a.args && JSON.stringify(a.args), Date.now(), current.id);
      return { ok: true, agent: this.getAgent(current.id) };
    });
  }

  deleteAgent(id) {
    const r = this.db.prepare('DELETE FROM agents WHERE id = ?').run(String(id));
    return r.changes ? { ok: true } : { ok: false, error: 'agente desconocido', status: 404 };
  }

  // ---------------------------------------------------------------- ajustes

  getAppearance() { return json(this.db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get()?.value, {}) || {}; }

  /** patch: { rol: { name, title, shirt, pants, hair, skin, long, beard, glasses } | null } (null = el original) */
  setAppearance(patch = {}) {
    return this.#write(() => {
      const appearance = { ...this.getAppearance() };
      for (const [key, look] of Object.entries(patch || {})) {
        const role = normRole(key) || fail(`rol desconocido: ${key}`);
        if (look === null) { delete appearance[role]; continue; }
        const clean = {};
        for (const [k, v] of Object.entries(look || {})) {
          const type = APPEARANCE[k] || fail(`${role}: no se puede cambiar "${k}"`);
          if (type === 'color') { if (!COLOR_RX.test(String(v))) fail(`${role}.${k}: usa un color como #3f73f0`); clean[k] = String(v).toLowerCase(); }
          else if (type === 'bool') clean[k] = !!v;
          else {
            const t = String(v ?? '').trim();
            if (!t) fail(`${role}.${k} no puede quedar vacío`);
            clean[k] = t.slice(0, k === 'name' ? 20 : 30);
          }
        }
        if (Object.keys(clean).length) appearance[role] = clean; else delete appearance[role];
      }
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('appearance', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(appearance));
      return { ok: true, appearance };
    });
  }

  // ---------------------------------------------------------------- historial de prompts

  /** Guarda (o actualiza) un prompt enviado. p: { id, agentId, agent, entry, text, session, mode, cwd, status, detail } */
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

  // ---------------------------------------------------------------- migración desde config.json

  /** La primera vez, trae lo que hubiera en ~/.dev-team-office/config.json (no lo borra). */
  importLegacy(file) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (raw.appearance) this.setAppearance(raw.appearance);
    for (const a of Array.isArray(raw.agents) ? raw.agents : []) this.createAgent(a);
  }

  close() { this.db.close(); }
}
