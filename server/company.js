// La empresa: una instancia de la oficina puede tener varias oficinas (equipos o dominios), como
// una empresa de verdad. Cada oficina tiene su propio estado (sesiones, bitácora, roles: Office), su
// zona horaria y su clima; las interfaces muestran la que el usuario elige.
//
// Cada evento de un agente se reparte a una oficina:
//   1. la que dice el propio evento (`office`, o `devteam_office` desde el hook de Claude Code),
//   2. la de su sesión, si ya se conoce,
//   3. la del pane de herdr donde corre (los panes que abrió la oficina),
//   4. la del agente registrado cuya ruta contiene su directorio (la más específica),
//   5. si no, la principal.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Office } from './office.js';
import { clip } from './roles.js';
import { MAIN_OFFICE } from './store.js';
import { t } from '../public/i18n.js';
import { systemZone, zoneInfo } from '../public/clock.js';

const inside = (dir, root) => !!dir && !!root && (dir === root || dir.startsWith(`${root}${path.sep}`));

export class Company extends EventEmitter {
  /** @param store la base (server/store.js): oficinas, agentes y ajustes */
  constructor({ store }) {
    super();
    this.store = store;
    this.offices = new Map();   // id → Office
    this.sessionOffice = new Map(); // sesión de agente → oficina
    this.paneOffice = new Map();    // pane de herdr → oficina
    this.load();
  }

  // ---------------------------------------------------------------- las oficinas

  /** Sincroniza con la base: crea las que faltan y saca las que se eliminaron. */
  load() {
    const ids = new Set(this.store.listOffices().map((o) => o.id));
    ids.add(MAIN_OFFICE);
    for (const id of ids) if (!this.offices.has(id)) this.#add(id);
    for (const id of [...this.offices.keys()]) {
      if (ids.has(id)) continue;
      this.offices.get(id).removeAllListeners();
      this.offices.delete(id);
      for (const [k, v] of this.sessionOffice) if (v === id) this.sessionOffice.set(k, MAIN_OFFICE);
      for (const [k, v] of this.paneOffice) if (v === id) this.paneOffice.set(k, MAIN_OFFICE);
    }
    this.emit('change', this.list());
  }

  #add(id) {
    const office = new Office();
    office.id = id;
    office.on('event', (ev, session) => this.emit('event', id, ev, session));
    office.on('reset', () => this.emit('reset', id));
    this.offices.set(id, office);
  }

  has(id) { return this.offices.has(id); }
  /** El estado de una oficina (la principal si no existe). */
  get(id = MAIN_OFFICE) { return this.offices.get(id) || this.offices.get(MAIN_OFFICE); }
  ids() { return [...this.offices.keys()]; }

  /** La zona horaria de una oficina: la suya, la de la empresa o la del sistema. */
  zoneOf(id) {
    const own = this.store.getOffice(id)?.timezone;
    return own || this.store.getPrefs().timezone || systemZone();
  }

  /** Lo que las interfaces saben de cada oficina (el selector, el reloj, el clima). */
  info(id) {
    const o = this.store.getOffice(id);
    if (!o) return null;
    const tz = this.zoneOf(id);
    const z = zoneInfo(tz);
    const office = this.get(id);
    return {
      id: o.id, name: o.name || t('offices.main'), custom: !!o.name, timezone: tz, ownTimezone: o.timezone, location: o.location,
      country: z.country, city: z.city, agents: this.store.listAgents().filter((a) => a.office === o.id).length,
      sessions: [...office.sessions.values()].filter((s) => s.id !== 'office').length,
    };
  }
  list() { return this.store.listOffices().map((o) => this.info(o.id)).filter(Boolean); }

  // ---------------------------------------------------------------- a qué oficina va cada cosa

  /** La oficina del agente registrado cuya ruta contiene `cwd` (la más específica). */
  officeForPath(cwd) {
    if (!cwd) return null;
    let best = null;
    for (const a of this.store.listAgents()) if (inside(cwd, a.path) && (!best || a.path.length > best.path.length)) best = a;
    return best?.office || null;
  }

  /** Decide la oficina de un payload de agente (ver el orden arriba). */
  route(payload = {}) {
    const p = Array.isArray(payload) ? payload[0] || {} : payload;
    const explicit = p.office || p.devteam_office;
    if (explicit && this.has(explicit)) return explicit;
    const session = p.session || p.session_id;
    if (session && this.sessionOffice.has(String(session))) return this.sessionOffice.get(String(session));
    const pane = p.pane || p.herdr_pane;
    if (pane && this.paneOffice.has(String(pane))) return this.paneOffice.get(String(pane));
    return this.officeForPath(p.cwd) || MAIN_OFFICE;
  }

  bindSession(session, office) { if (session && this.has(office)) this.sessionOffice.set(clip(session, 100), office); }
  bindPane(pane, office) { if (pane && this.has(office)) this.paneOffice.set(String(pane), office); }
  officeOfSession(session) { return this.sessionOffice.get(String(session)) || null; }

  /** Recibe un payload de cualquier agente, lo manda a su oficina y devuelve los eventos. */
  ingest(source = 'generic', payload = {}) {
    const id = this.route(payload);
    const events = this.get(id).ingest(source, payload);
    for (const ev of events) if (ev.session && ev.session !== 'office' && !this.sessionOffice.has(ev.session)) this.sessionOffice.set(ev.session, id);
    return events;
  }

  /** La sesión (con su oficina), esté donde esté. */
  session(id) {
    const office = this.officeOfSession(id);
    const s = office ? this.get(office).sessions.get(String(id)) : null;
    return s ? { ...s, office } : null;
  }
  sessionSource(id) { return this.session(id)?.source || null; }

  setAgentRoles(session, roles) {
    const office = this.officeOfSession(session) || MAIN_OFFICE;
    this.get(office).setAgentRoles(session, roles);
  }

  reset(id) { this.get(id).reset(); }
}
