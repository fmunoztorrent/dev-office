// The company: one office instance can hold several offices (teams or domains), like a real
// company. Each office has its own state (sessions, log, roles: Office), its time zone and its
// weather; the interfaces show the one the user picks.
//
// Each agent event is routed to an office:
//   1. the one the event itself names (`office`, or `devteam_office` from the Claude Code hook),
//   2. its session's, if already known,
//   3. the one of the herdr pane it runs in (the panes the office opened),
//   4. the one of the registered agent whose path contains its directory (the most specific),
//   5. otherwise, the main one.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Office } from './office.js';
import { clip } from './roles.js';
import { MAIN_OFFICE } from './store.js';
import { insideDir } from './paths.js';
import { t } from '../public/i18n.js';
import { systemZone, zoneInfo } from '../public/clock.js';


export class Company extends EventEmitter {
  /** @param store the database (server/store.js): offices, agents and settings */
  constructor({ store }) {
    super();
    this.store = store;
    this.offices = new Map();   // id → Office
    this.sessionOffice = new Map(); // agent session → office
    this.paneOffice = new Map();    // herdr pane → office
    this.sessionPane = new Map();   // agent session → the herdr pane it runs in (its events say so)
    this.load();
  }

  // ---------------------------------------------------------------- the offices

  /** Syncs with the database: creates the missing ones and removes the deleted ones. */
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
    // which subagent is which character according to each session's folder (set by the server)
    office.rolesFor = (cwd) => this.rolesFor?.(cwd) || null;
    office.on('event', (ev, session) => this.emit('event', id, ev, session));
    office.on('reset', () => this.emit('reset', id));
    this.offices.set(id, office);
  }

  has(id) { return this.offices.has(id); }
  /** An office's state (the main one if it does not exist). */
  get(id = MAIN_OFFICE) { return this.offices.get(id) || this.offices.get(MAIN_OFFICE); }
  ids() { return [...this.offices.keys()]; }

  /** An office's time zone: its own, the company's or the system's. */
  zoneOf(id) {
    const own = this.store.getOffice(id)?.timezone;
    return own || this.store.getPrefs().timezone || systemZone();
  }

  /** What the interfaces know about each office (the selector, the clock, the weather). */
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

  // ---------------------------------------------------------------- which office each thing goes to

  /** The office of the registered agent whose path contains `cwd` (the most specific). */
  officeForPath(cwd) {
    if (!cwd) return null;
    let best = null;
    for (const a of this.store.listAgents()) if (insideDir(cwd, a.path) && (!best || a.path.length > best.path.length)) best = a;
    return best?.office || null;
  }

  /** Decides the office of an agent payload (see the order above). */
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

  /** Receives a payload from any agent, sends it to its office and returns the events. */
  ingest(source = 'generic', payload = {}) {
    const id = this.route(payload);
    const events = this.get(id).ingest(source, payload);
    const first = Array.isArray(payload) ? payload[0] || {} : payload;
    const pane = first.pane || first.herdr_pane;
    for (const ev of events) {
      if (!ev.session || ev.session === 'office') continue;
      if (!this.sessionOffice.has(ev.session)) this.sessionOffice.set(ev.session, id);
      if (pane && typeof pane === 'string' && source !== 'herdr') this.sessionPane.set(ev.session, clip(pane, 40));
    }
    if (this.sessionPane.size > 200) this.sessionPane.delete(this.sessionPane.keys().next().value);
    return events;
  }

  /** The herdr pane a session runs in (if its events said so). */
  paneOfSession(session) { return this.sessionPane.get(String(session)) || null; }

  /** The session (with its office), wherever it is. */
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
