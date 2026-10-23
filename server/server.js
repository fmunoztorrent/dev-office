// Integration server: HTTP/JSON API + WebSocket, over TCP (localhost) and a Unix socket.
// Used by `npm start` (no interface) and the `dev-team-office` executable (with the office in the terminal).
//
// One instance is a company: it can hold several offices (teams or domains). Each viewer (the
// web, the terminal) watches one office at a time and receives only that office's data; the chosen
// one is saved in the settings. The settings (language, time zone, weather, herdr…) and each
// office's appearance are saved in the SQLite database.

import http from 'node:http';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from './ws.js';
import { Company } from './company.js';
import { runDemo, demoScript, piDemoScript } from './demo.js';
import { TaskHub, AGENT_LABEL } from './tasks.js';
import { PipelineHub } from './pipeline.js';
import { AgentRegistry } from './registry.js';
import { AskDesk } from './asks.js';
import { openStore, dbFile, MAIN_OFFICE } from './store.js';
import { Weather } from './weather.js';
import { Herdr, paneRole } from './herdr.js';
import { SubPanes } from './subpanes.js';
import { DEFAULT_TEAM } from '../public/sim.js';
import { detectHarness, projectRoot, HARNESSES, which } from '../integrations/common/devteam.mjs';
import { t, setLanguage, getLanguage } from '../public/i18n.js';
import { zoneInfo, systemZone } from '../public/clock.js';
import { insideDir as inside } from './paths.js';
import { provisionTeam } from '../bin/team.js';

export const VERSION = '0.6.0';
export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY = 16 * 1024 * 1024; // PostToolUse carries the tool's full result
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CLI = fileURLToPath(new URL('../bin/dev-team-office.js', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const WS_PATHS = new Set(['/v1/ws', '/ws']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function defaultSocketPath() {
  return process.env.DEV_TEAM_OFFICE_SOCKET || path.join(os.homedir(), '.dev-team-office', 'office.sock');
}

// A task requested through the API does not choose an executable or arguments: only a registered
// agent (⚙ › Agents) defines that, and it is used when sending it a prompt (/v1/agents/:id/prompt).
const publicTask = ({ launch, meta, ...task } = {}) => task;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Starts the office. Rejects with code EADDRINUSE if the port is already taken.
 * @param db       the SQLite database: a path (~/.dev-team-office/office.db by default), ':memory:' or an open Store
 * @param weather  the weather outside (Open-Meteo): false to not query it, Weather options or an
 *                 instance (the same one for every office)
 * @param herdr    true: if running inside herdr, opens agents in panes (the executable asks for it);
 *                 a Herdr instance (the tests); false/omitted: no herdr at all
 * @returns {Promise<{company, office, url, socket, command, handleMessage, close, …}>}
 */
export async function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, socket = defaultSocketPath(), log = () => {}, db, weather: weatherOpt, herdr: herdrOpt, asks: asksOpt = {} } = {}) {
  const ownStore = !db || typeof db === 'string';
  const store = ownStore ? openStore(db || dbFile()) : db; // oficinas, agentes, ajustes e historial
  setLanguage(store.getPrefs().lang);
  const company = new Company({ store });
  // Each session learns which subagent is which character from what its project's folder brings (the
  // project's subagents with their `role:`, their name or their description), even if its agent does not say.
  const rolesSeen = new Map();
  company.rolesFor = (cwd) => {
    if (!cwd || !fs.existsSync(cwd)) return null;
    const reg = store.listAgents().filter((a) => inside(cwd, a.path)).sort((a, b) => b.path.length - a.path.length)[0];
    const root = reg?.path || projectRoot(cwd);
    const hit = rolesSeen.get(root);
    if (hit && Date.now() - hit.at < 30_000) return hit.roles;
    let roles = null;
    try { roles = Object.fromEntries(detectHarness(root).subagents.filter((x) => x.scope === 'project' && x.role).map((x) => [x.name.toLowerCase(), x.role])); } catch { /* carpeta ilegible */ }
    rolesSeen.set(root, { at: Date.now(), roles });
    if (rolesSeen.size > 100) rolesSeen.delete(rolesSeen.keys().next().value);
    return roles;
  };
  // the folder's team changed (join installed one): it is read again and the sessions open there add it
  company.learnRoles = (dir) => {
    for (const k of [...rolesSeen.keys()]) if (inside(k, dir) || inside(dir, k)) rolesSeen.delete(k);
    const roles = company.rolesFor(dir) || {};
    for (const id of company.ids()) company.get(id).learnRoles(dir, roles);
    return roles;
  };
  const office = company.get(MAIN_OFFICE); // the main one (the one older clients used)
  const herdr = herdrOpt instanceof EventEmitter ? herdrOpt : herdrOpt === true ? new Herdr({ log }) : null;
  const officeUrl = () => `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  let socketPath = null;
  const hub = new TaskHub(company, { officeUrl: officeUrl(), store, herdr, prefs: () => store.getPrefs(), socket: null });
  hub.officeName = (id) => company.info(id)?.name || '';
  const pipelines = new PipelineHub(company, hub, { store });
  const registry = new AgentRegistry({ getAgents: () => store.listAgents(), hub, pipelines, office: company });
  // side questions (btw) to each office's agent on duty
  const asks = new AskDesk({ company, store, officeUrl, ...asksOpt });
  const publicAsk = ({ id, office: o, agent, question, answer, status, error, from, forked, role, createdAt, updatedAt }) => ({ id, office: o, agent, question, answer, status, error, from, forked, role, createdAt, updatedAt });
  const startedAt = Date.now();
  const bus = new EventEmitter(); // changes the interfaces see: settings, appearance, weather, offices, log
  const prefs = () => store.getPrefs();
  const view = () => prefs().view.office;
  const valid = (id) => (id && company.has(id) ? id : view());
  const say = (text, extra = {}) => { log(text); bus.emit('log', { ts: Date.now(), kind: 'server', text, ...extra }); };

  // ---------- the weather outside, per office (the ones in the same city share it) ----------

  const weatherShared = weatherOpt instanceof EventEmitter ? weatherOpt : null;
  weatherShared?.on('change', (cur) => { for (const oid of company.ids()) bus.emit('weather', oid, cur); });
  weatherShared?.start();
  const weathers = new Map(); // where → Weather
  const weatherKey = (id) => store.getOffice(id)?.location || process.env.DEV_TEAM_OFFICE_LOCATION || company.zoneOf(id);
  function weatherOf(id) {
    if (weatherOpt === false || !prefs().weather) return null;
    if (weatherShared) return weatherShared;
    const key = weatherKey(id);
    let w = weathers.get(key);
    if (!w) {
      const tz = company.zoneOf(id), z = zoneInfo(tz);
      const own = store.getOffice(id)?.location || process.env.DEV_TEAM_OFFICE_LOCATION;
      // without its own location: the coordinates of its time zone's city (no geocoding)
      w = new Weather({ log: (m) => say(m), ...(weatherOpt || {}), timezone: tz, location: own || (Number.isFinite(z.lat) ? `${z.lat},${z.lon}` : undefined), place: own ? undefined : z.city });
      w.on('change', (cur) => { for (const oid of company.ids()) if (weatherKey(oid) === key) bus.emit('weather', oid, cur); });
      weathers.set(key, w);
      w.start();
    }
    return w;
  }
  /** After changing zones, locations or the weather setting: drops the ones no longer used and notifies. */
  function refreshWeather() {
    const used = new Set(prefs().weather && weatherOpt !== false && !weatherShared ? company.ids().map(weatherKey) : []);
    for (const [key, w] of weathers) if (!used.has(key)) { w.stop(); weathers.delete(key); }
    for (const id of company.ids()) bus.emit('weather', id, weatherOf(id)?.current || null);
  }

  /** An office's full state, for a viewer watching it. */
  const fullState = (id = view()) => {
    id = valid(id);
    const p = pipelines.snapshot(id);
    return {
      ...company.get(id).snapshot(), ...hub.snapshot(id), pipelines: p.runs, projects: p.projects, targets: registry.targets(id),
      appearance: store.getAppearance(id), weather: weatherOf(id)?.current || null,
      office: company.info(id), offices: company.list(), prefs: prefs(), herdr: herdr ? herdr.status() : { available: false, panes: [] },
      asks: asks.list(id, 10),
    };
  };
  let stopDemo = null;

  // ---------- herdr: the agents in panes, and the panes they open ----------

  function trackPane(info) {
    if (!info?.pane) return;
    company.bindPane(info.pane, info.office || MAIN_OFFICE);
    // the agent's pane, or a subagent's: its own events tell its activity
    if (info.main || info.kind === 'sub') return;
    company.ingest('herdr', { session: 'office', office: info.office || MAIN_OFFICE, kind: 'pane_open', pane: info.pane, role: info.role, text: info.title, agent: info.agent });
  }
  herdr?.on('open', (p) => {
    trackPane(p);
    say(t('herdr.opened', { pane: p.pane, title: p.title, office: company.info(p.office || MAIN_OFFICE)?.name || '' }), { office: p.office, pane: p.pane });
    bus.emit('herdr', herdr.status());
  });
  herdr?.on('close', (p) => {
    if (p.kind === 'sub') subPanes?.forget(p.pane);
    if (!p.main && p.kind !== 'sub') company.ingest('herdr', { session: 'office', office: p.office || MAIN_OFFICE, kind: 'pane_close', pane: p.pane, role: p.role, text: p.title });
    if (p.taskId) hub.paneSettled(p.pane);
    say(t('herdr.closed', { pane: p.pane, title: p.title }), { office: p.office, pane: p.pane });
    bus.emit('herdr', herdr.status());
  });
  herdr?.on('state', (p, status, was) => {
    if (was === 'working' && ['idle', 'done'].includes(status)) hub.paneSettled(p.pane);
    if (!p.main) company.ingest('herdr', { session: 'office', office: p.office || MAIN_OFFICE, kind: 'pane_state', pane: p.pane, role: p.role, text: p.title, state: status });
    bus.emit('herdr', herdr.status());
  });
  // a pane an agent opened on its own, in a project's folder: the office adopts it
  herdr?.on('discover', (d) => {
    const parent = [...herdr.tracked.values()].find((x) => x.cwd && (inside(d.cwd, x.cwd) || inside(x.cwd, d.cwd)));
    herdr.track(d.pane, { office: parent?.office || company.officeForPath(d.cwd) || MAIN_OFFICE, role: paneRole({ agent: d.agent, title: d.title }), title: d.title, agent: d.agent, kind: d.agent ? 'agent' : 'command', cwd: d.cwd });
  });
  herdr?.start({ isProject: (cwd) => !!company.officeForPath(cwd) });

  // each subagent, in its pane (`dev-team-office follow`): its start opens it, its end closes it
  const subPanes = herdr ? new SubPanes({
    herdr, company, log: say,
    command: [process.execPath, CLI],
    env: () => ({ DEV_TEAM_OFFICE_URL: officeUrl() }),
    enabled: () => prefs().herdr.subagents !== false,
    who: (id, role) => store.getAppearance(id)?.[role]?.name || DEFAULT_TEAM[role]?.name || '',
  }) : null;
  company.on('event', (id, event) => subPanes?.onEvent(id, event));

  /**
   * When the office opens inside herdr: the agent, in a new pane. Which one? The one in the settings
   * (⚙ › General); on automatic, the registered agent of the folder where the office was opened, or
   * the CLI that folder has configured (or the first one installed).
   */
  async function launchStartAgent({ cwd = process.cwd(), agent: wanted } = {}) {
    if (!herdr?.available) return { ok: false, error: t('err.noHerdr') };
    const choice = wanted || prefs().herdr.startAgent;
    if (choice === 'none') return { ok: false, skipped: true };
    const installed = (h) => !!which(h === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[h].bin);
    let a = choice && choice !== 'auto' ? store.getAgent(choice) || null : null;
    if (!a && ['claude-code', 'claude', 'pi', 'opencode', 'codex'].includes(choice)) a = { name: path.basename(cwd), path: cwd, harness: choice === 'claude' ? 'claude-code' : choice };
    if (!a) a = store.listAgents().filter((x) => inside(cwd, x.path)).sort((x, y) => y.path.length - x.path.length)[0] || null;
    if (!a) {
      const d = detectHarness(cwd);
      const harness = [...d.harnesses, 'claude-code', 'pi', 'opencode', 'codex'].find(installed);
      if (!harness) return { ok: false, error: t('herdr.noAgent') };
      a = { name: d.name || path.basename(cwd), path: cwd, harness };
    }
    if (!installed(a.harness) && !a.bin) return { ok: false, error: t('err.notInstalled', { bin: HARNESSES[a.harness]?.bin || a.harness }) };
    const where = a.office || company.officeForPath(a.path) || view();
    const env = { DEV_TEAM_OFFICE_URL: officeUrl(), DEV_TEAM_OFFICE_OFFICE: where, ...(socketPath ? { DEV_TEAM_OFFICE_SOCKET: socketPath } : {}) };
    try {
      const label = `${AGENT_LABEL[a.harness] || a.harness} · ${a.name}`;
      const out = await herdr.launchAgent({ harness: a.harness, cwd: a.path, bin: a.bin, args: a.args || [], env, direction: prefs().herdr.direction, office: where, officeName: company.info(where)?.name || '', role: 'manager', title: label, label });
      const p = herdr.tracked.get(out.pane);
      if (p) p.main = true;
      return { ok: true, pane: out.pane, agent: { id: a.id || null, name: a.name, harness: a.harness, path: a.path, office: where } };
    } catch (err) {
      return { ok: false, error: t('err.herdrFailed', { error: err.message }) };
    }
  }

  // ---------- actions shared by HTTP, WebSocket and the local interface ----------

  function command(action, { speed, office: id } = {}) {
    id = valid(id);
    switch (action) {
      case 'reset': company.reset(id); return true;
      case 'demo':
      case 'demo-pi':
        if (stopDemo) return false;
        stopDemo = runDemo((p) => company.ingest(action === 'demo' ? 'claude-code' : 'pi', { ...p, office: id }), {
          script: action === 'demo' ? demoScript : piDemoScript, speed: Number(speed) || 1, onEnd: () => (stopDemo = null),
        });
        return true;
      case 'stop-demo': stopDemo?.(); return true;
      default: return false;
    }
  }

  /** Changes general settings: applies them (language, weather, zones) and notifies the interfaces. */
  function setPrefs(patch) {
    const out = store.setPrefs(patch);
    if (!out.ok) return out;
    if (patch.lang) setLanguage(out.prefs.lang);
    if ('timezone' in patch || 'weather' in patch) refreshWeather();
    bus.emit('prefs', out.prefs);
    if (patch.lang || 'timezone' in patch) bus.emit('offices', company.list());
    return out;
  }

  function officesChanged() {
    company.load();
    refreshWeather();
    registry.changed();
    bus.emit('offices', company.list());
  }

  /**
   * A message shaped like the WebSocket protocol. `conn` is the connection that sends it
   * (null over HTTP or from the local interface). Returns { ok, ... }.
   */
  function handleMessage(msg, conn = null) {
    if (!msg || typeof msg !== 'object') return { ok: false, error: t('err.invalidMessage') };
    const here = valid(msg.office || conn?.view);
    switch (msg.type) {
      case 'event': {
        const source = String(msg.source || msg.payload?.source || conn?.agent || 'generic');
        const events = company.ingest(source, msg.payload ?? {});
        return { ok: true, accepted: events.length, ids: events.map((e) => e.id) };
      }
      // An agent (Pi extension, OpenCode plugin…) registers to receive tasks.
      case 'register': {
        if (!conn) return { ok: false, error: t('err.registerWs') };
        conn.agent = String(msg.agent || 'agente');
        return hub.register(conn, msg);
      }
      case 'task_update':
        return conn ? hub.update(conn.id, msg) : { ok: false, error: t('err.updateWs') };
      case 'task':
        return hub.submit({ office: here, ...publicTask(msg) });
      case 'task_cancel':
        return hub.cancel(msg.id);
      // A prompt for an agent, through an entry of its harness (what the whiteboard sends).
      case 'run':
        return registry.run(msg);
      case 'pipeline_start':
        return pipelines.start(msg);
      case 'pipeline_cancel':
        return pipelines.cancel(msg.id);
      // The agent reports how the pipeline it is running is going.
      case 'pipeline_update':
        return pipelines.update(msg.id, msg);
      // btw: a side question to the office's agent on duty (it answers without being interrupted)
      case 'ask': {
        const out = asks.ask({ text: msg.text, office: here, from: msg.from });
        return out.ok ? { ok: true, ask: publicAsk(out.ask) } : out;
      }
      case 'chat':
      case 'poke': {
        const events = company.ingest('generic', { kind: msg.type, session: msg.session || 'office', office: here, text: msg.text, from: msg.from, role: msg.role });
        return { ok: true, accepted: events.length };
      }
      case 'command': {
        const ok = command(msg.action, { ...msg, office: here });
        return ok ? { ok: true } : { ok: false, error: t('err.unknownCommand', { action: msg.action }) };
      }
      // The viewer chooses which office to watch (and it is saved).
      case 'view': {
        if (!company.has(msg.office)) return { ok: false, error: t('err.unknownOffice', { office: msg.office }) };
        if (conn) conn.view = msg.office;
        setPrefs({ view: { office: msg.office } });
        return { ok: true, state: conn ? undefined : fullState(msg.office) };
      }
      case 'prefs':
        return setPrefs(msg.prefs || {});
      default:
        return { ok: false, error: t('err.unknownType', { type: msg.type }) };
    }
  }

  // ---------- HTTP ----------

  const info = () => ({ ok: true, name: 'dev-team-office', version: VERSION, pid: process.pid, uptime: Math.round((Date.now() - startedAt) / 1000), url: `http://${host}:${port}`, socket: socketPath, lang: getLanguage(), herdr: !!herdr?.available });
  const body = async (req) => JSON.parse((await readBody(req)) || '{}');

  const handler = (viaUnix) => async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const q = (k) => url.searchParams.get(k) || undefined;
    try {
      if (!viaUnix) checkBrowserAccess(req, host, port);
      if (req.method === 'GET' && p === '/v1/health') return json(res, 200, info());
      if (req.method === 'GET' && (p === '/v1/state' || p === '/api/state')) return json(res, 200, fullState(q('office')));
      if (req.method === 'GET' && p === '/v1/weather') {
        const id = valid(q('office'));
        return json(res, 200, { ok: true, weather: weatherOf(id)?.current || null, enabled: !!weatherOf(id)?.enabled, office: id });
      }
      if (req.method === 'POST' && (p === '/v1/events' || p.startsWith('/v1/events/') || p === '/event' || p.startsWith('/event/'))) {
        const payload = await body(req);
        const fromPath = decodeURIComponent(p.replace(/^\/(v1\/events|event)\/?/, ''));
        const source = fromPath || q('source') || (!Array.isArray(payload) && payload.source) || 'generic';
        const events = company.ingest(source, payload);
        return json(res, 200, { ok: true, accepted: events.length, ids: events.map((e) => e.id) });
      }
      // ⚙ Settings: the general ones (language, time zone, weather, herdr…) and an office's appearance
      if (req.method === 'GET' && p === '/v1/settings') {
        const id = valid(q('office'));
        return json(res, 200, { office: { id, file: store.file, appearance: store.getAppearance(id), prefs: prefs() }, offices: company.list(), systemZone: systemZone(), herdr: herdr ? herdr.status() : { available: false } });
      }
      if (req.method === 'PUT' && p === '/v1/settings') {
        const b = await body(req);
        const id = valid(b.office || q('office'));
        const out = { ok: true };
        if (b.prefs) {
          const r = setPrefs(b.prefs);
          if (!r.ok) return json(res, 400, r);
          out.prefs = r.prefs;
        }
        if (b.appearance) {
          const r = store.setAppearance(b.appearance, id);
          if (!r.ok) return json(res, 400, r);
          out.appearance = r.appearance;
          bus.emit('appearance', id, r.appearance);
        }
        return json(res, 200, out);
      }
      // The company's offices (teams or domains)
      if (req.method === 'GET' && p === '/v1/offices') return json(res, 200, { ok: true, offices: company.list(), view: view() });
      if (req.method === 'POST' && p === '/v1/offices') {
        const out = store.createOffice(await body(req));
        if (out.ok) { officesChanged(); out.office = company.info(out.office.id); }
        return json(res, out.ok ? 201 : 400, out);
      }
      let m;
      if ((m = p.match(/^\/v1\/offices\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') { const o = company.info(id); return o ? json(res, 200, { ok: true, office: o }) : json(res, 404, { ok: false, error: t('err.unknownOffice', { office: id }) }); }
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const out = store.updateOffice(id, await body(req));
          if (out.ok) { officesChanged(); out.office = company.info(id); }
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
        if (req.method === 'DELETE') {
          const out = store.deleteOffice(id);
          if (out.ok) officesChanged();
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
      }
      // herdr: the panes the office follows, and the ones an agent announces (`dev-team-office pane`)
      if (req.method === 'GET' && p === '/v1/panes') return json(res, 200, { ok: true, ...(herdr ? herdr.status() : { available: false, panes: [] }) });
      if (req.method === 'POST' && p === '/v1/panes') {
        const b = await body(req);
        if (!b.pane) return json(res, 400, { ok: false, error: t('err.paneMissing') });
        const where = (company.has(b.office) && b.office) || company.paneOffice.get(String(b.parent)) || company.officeForPath(b.cwd) || MAIN_OFFICE;
        const pane = { office: where, role: paneRole({ role: b.role, agent: b.agent, title: b.title, command: b.command }), title: b.title || b.command || b.agent || b.pane, agent: b.agent || null, kind: b.agent ? 'agent' : 'command', cwd: b.cwd || null };
        if (herdr) herdr.track(String(b.pane), pane);
        else trackPane({ ...pane, pane: String(b.pane) });
        return json(res, 200, { ok: true, office: where, role: pane.role });
      }
      if (req.method === 'POST' && p === '/v1/herdr/launch') {
        const b = await body(req);
        const out = await launchStartAgent({ cwd: b.cwd, agent: b.agent });
        return json(res, out.ok ? 200 : 400, out);
      }
      // The agents maintainer: a full path + the CLI that serves it + its office. What its harness
      // brings (pipelines, commands) is detected; the prompt starts THAT pipeline.
      if (req.method === 'GET' && p === '/v1/agents') return json(res, 200, { agents: registry.targets(q('office')) });
      if (req.method === 'POST' && p === '/v1/agents') {
        const out = store.createAgent(await body(req));
        if (out.ok) { registry.changed(); out.agent = registry.target(out.agent.id); bus.emit('offices', company.list()); }
        return json(res, out.ok ? 201 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/agents/detect') {
        const dir = String((await body(req)).path || '').trim().replace(/^~(?=$|\/)/, os.homedir());
        if (!path.isAbsolute(dir)) return json(res, 400, { ok: false, error: t('err.fullPath') });
        const d = detectHarness(dir);
        return json(res, 200, { ok: true, exists: d.exists, name: d.name, harnesses: d.harnesses, kinds: d.kinds, entries: d.entries.map((e) => ({ id: e.id, label: e.label, harnesses: e.harnesses })) });
      }
      // The office team for the roles an agent lacks (`join` asks for it): { team?: pack }
      if (req.method === 'POST' && (m = p.match(/^\/v1\/agents\/([^/]+)\/team$/))) {
        const id = decodeURIComponent(m[1]);
        const a = store.getAgent(id);
        if (!a) return json(res, 404, { ok: false, error: t('err.unknownAgent') });
        const b = await body(req);
        const out = provisionTeam({ dir: a.path, harness: a.harness, ...(b.team ? { team: String(b.team) } : {}) });
        if (out.installed) { company.learnRoles(a.path); registry.forget(a.path); registry.changed(); }
        return json(res, 200, { ok: true, ...out, agent: registry.target(id) });
      }
      if ((m = p.match(/^\/v1\/agents\/([^/]+)$/)) && m[1] !== 'announce' && m[1] !== 'detect') {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const tg = registry.target(id);
          return tg ? json(res, 200, { ok: true, agent: tg, prompts: store.listPrompts({ agentId: id, limit: 20 }) }) : json(res, 404, { ok: false, error: t('err.unknownAgent') });
        }
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const out = store.updateAgent(id, await body(req));
          if (out.ok) { registry.changed(); out.agent = registry.target(id); bus.emit('offices', company.list()); }
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
        if (req.method === 'DELETE') {
          const out = store.deleteAgent(id);
          if (out.ok) { registry.changed(); bus.emit('offices', company.list()); }
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
      }
      // Send it a prompt: { text, entry?: the entry of its harness, session?: id | null (new session) }
      if (req.method === 'POST' && (m = p.match(/^\/v1\/agents\/([^/]+)\/prompt$/))) {
        const out = registry.run({ ...(await body(req)), target: decodeURIComponent(m[1]) });
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/run') {
        const out = registry.run(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/prompts') {
        return json(res, 200, { prompts: store.listPrompts({ agentId: q('agent'), limit: q('limit') || 50 }) });
      }
      // What the agents announce: projects and pipelines each session can run.
      if (req.method === 'GET' && p === '/v1/projects') return json(res, 200, { projects: pipelines.projects(q('office')) });
      if (req.method === 'POST' && p === '/v1/agents/announce') {
        const out = pipelines.announce(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/pipelines') return json(res, 200, pipelines.snapshot(q('office')));
      if (req.method === 'POST' && p === '/v1/pipelines') {
        const out = pipelines.start(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && /^\/v1\/pipelines\/[^/]+\/(cancel|update)$/.test(p)) {
        const [, , , id, action] = p.split('/');
        const out = action === 'cancel' ? pipelines.cancel(decodeURIComponent(id)) : pipelines.update(decodeURIComponent(id), await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/tasks') return json(res, 200, hub.snapshot(q('office')));
      if (req.method === 'POST' && p === '/v1/tasks') {
        const out = hub.submit(publicTask(await body(req)));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && /^\/v1\/tasks\/[^/]+\/cancel$/.test(p)) {
        const out = hub.cancel(decodeURIComponent(p.split('/')[3]));
        return json(res, out.ok ? 200 : 400, out);
      }
      // Claude Code hook (integrations/claude-code/hook.mjs): records the event and returns what the
      // office has for that session. What to do with it is decided by the hook, on the agent's side.
      //   { task?: { id, text }, pipeline?: { id, pipeline, task }, cancel?: [id] }
      if (req.method === 'POST' && p === '/v1/hooks/claude-code') {
        const payload = await body(req);
        // `devteam_stage`: that Stop closes a pipeline stage, not the work
        if (!(payload.devteam_stage && payload.hook_event_name === 'Stop')) company.ingest('claude-code', payload);
        const session = payload.session_id;
        if (session && payload.herdr_pane) hub.paneSession(String(payload.herdr_pane), session);
        const out = {};
        if (payload.hook_event_name === 'Stop' && session) {
          const run = pipelines.takeForClaude(session);
          if (run) out.pipeline = run;
          else {
            const task = hub.takeForClaude(session);
            if (task) out.task = { id: task.id, text: task.text, ...(task.command ? { command: task.command, args: task.args } : {}) };
          }
        }
        const cancel = session ? pipelines.cancelsFor(session) : [];
        if (cancel.length) out.cancel = cancel;
        return json(res, 200, out);
      }
      // btw over HTTP: { text, office?, from?, wait? } (with wait, it answers when the reply arrives)
      if (req.method === 'POST' && p === '/v1/ask') {
        const b = await body(req);
        const out = asks.ask({ text: b.text, office: valid(b.office), from: b.from });
        if (!out.ok) return json(res, 400, out);
        if (!b.wait) return json(res, 202, { ok: true, ask: publicAsk(out.ask) });
        const done = await out.done;
        return json(res, 200, { ok: done.status === 'answered', ask: publicAsk(done), ...(done.error ? { error: done.error } : {}) });
      }
      if (req.method === 'GET' && p === '/v1/asks') return json(res, 200, { ok: true, asks: asks.list(valid(q('office')), Number(q('limit')) || 20) });
      if (req.method === 'POST' && p === '/v1/messages') {
        const out = handleMessage(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/commands') {
        const out = handleMessage({ ...(await body(req)), type: 'command' });
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && !p.startsWith('/v1/')) return serveStatic(p, res);
      throw new HttpError(404, t('err.notFound'));
    } catch (err) {
      json(res, err.status || 400, { ok: false, error: err.message });
    }
  };

  // ---------- WebSocket ----------
  //
  // client → server: { type: 'event' | 'chat' | 'poke' | 'command' | 'view' | 'prefs', ..., id? }
  //                  (with `id` it replies { type: 'ack', id, ... })
  // server → client: { type: 'hello' }, { type: 'snapshot', state }, { type: 'event', event, session, office },
  //                  { type: 'tasks' | 'pipelines' | 'targets' | 'appearance' | 'weather' | 'prefs' | 'offices', … }
  // Each viewer receives what belongs to the office it watches (conn.view).

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  let connSeq = 0;
  const viewers = () => [...wss.clients].filter((c) => c.readyState === 1 && !c.conn?.agent);
  const viewOf = (c) => valid(c.conn?.view);
  const broadcast = (msg) => { const data = JSON.stringify(msg); for (const c of viewers()) c.send(data); };
  const toOffice = (id, msg) => { const data = JSON.stringify(msg); for (const c of viewers()) if (viewOf(c) === id) c.send(data); };
  /** To each viewer, its office's data (computed once per office). */
  const perOffice = (make) => {
    const cache = new Map();
    for (const c of viewers()) {
      const id = viewOf(c);
      if (!cache.has(id)) cache.set(id, JSON.stringify(make(id)));
      c.send(cache.get(id));
    }
  };
  company.on('event', (id, event, session) => toOffice(id, { type: 'event', event, session, office: id }));
  company.on('event', (id, event) => bus.emit('activity', id, event));
  company.on('event', (_id, event) => { if (event.kind === 'turn_end' || event.kind === 'done') hub.sessionSettled(event.session); });
  company.on('reset', (id) => toOffice(id, { type: 'snapshot', state: fullState(id) }));
  hub.on('change', () => perOffice((id) => ({ type: 'tasks', ...hub.snapshot(id) })));
  pipelines.on('change', () => perOffice((id) => ({ type: 'pipelines', ...pipelines.snapshot(id) })));
  registry.on('change', () => perOffice((id) => ({ type: 'targets', targets: registry.targets(id) })));
  bus.on('appearance', (id, a) => toOffice(id, { type: 'appearance', appearance: a, office: id }));
  bus.on('weather', (id, w) => toOffice(id, { type: 'weather', weather: w, office: id }));
  bus.on('prefs', (pr) => broadcast({ type: 'prefs', prefs: pr }));
  bus.on('offices', (list) => broadcast({ type: 'offices', offices: list }));
  bus.on('herdr', (st) => broadcast({ type: 'herdr', herdr: st }));
  asks.on('change', (a) => toOffice(a.office, { type: 'ask', ask: publicAsk(a) }));
  for (const id of company.ids()) weatherOf(id);

  wss.on('connection', (ws, req) => {
    // `?office=<id>`: a viewer that watches that office without changing the chosen one (a subagent's pane)
    const wanted = new URL(req?.url || '/', 'http://localhost').searchParams.get('office');
    const conn = ws.conn = { id: ++connSeq, agent: null, view: wanted && company.has(wanted) ? wanted : view(), send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
    ws.send(JSON.stringify({ type: 'hello', ...info() }));
    ws.send(JSON.stringify({ type: 'snapshot', state: fullState(conn.view) }));
    ws.on('close', () => hub.unregister(conn.id));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return ws.send(JSON.stringify({ type: 'error', error: 'invalid json' })); }
      const out = handleMessage(msg, conn);
      if (msg?.type === 'view' && out.ok) ws.send(JSON.stringify({ type: 'snapshot', state: fullState(conn.view) }));
      // `task` uses `id` for its own task id; the ack goes with `ref`.
      const ref = ['task', 'pipeline_start', 'run'].includes(msg?.type) ? msg.ref : msg?.id;
      if (ref !== undefined) ws.send(JSON.stringify({ type: 'ack', id: ref, ...out }));
      else if (!out.ok) ws.send(JSON.stringify({ type: 'error', error: out.error }));
    });
  });

  const onUpgrade = (viaUnix) => (req, sock, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!WS_PATHS.has(pathname)) throw new HttpError(404, 'not found');
      if (!viaUnix) checkBrowserAccess(req, host, port);
    } catch (err) {
      sock.end(`HTTP/1.1 ${err.status || 400} ${err.message}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  };

  // ---------- listeners ----------

  const tcp = http.createServer(handler(false));
  tcp.on('upgrade', onUpgrade(false));
  await new Promise((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(port, host, () => { tcp.off('error', reject); resolve(); });
  });
  port = tcp.address().port; // in case 0 was requested (any free port)
  hub.officeUrl = officeUrl();

  let unix = null;
  if (socket) {
    try {
      unix = http.createServer(handler(true));
      unix.on('upgrade', onUpgrade(true));
      await listenUnix(unix, socket);
      socketPath = socket;
      hub.socket = socket;
    } catch (err) {
      unix = null;
      say(t('server.socketUnavailable', { file: socket, error: err.message }));
    }
  }

  say(t('server.started', { version: VERSION, url: `http://${host}:${port}` }));
  // From the browser: on a local machine, localhost and 127.0.0.1 are the same office.
  if (LOOPBACK.has(host)) say(t('server.browser', { urls: `http://127.0.0.1:${port}  ·  http://localhost:${port}` }));
  say(t('server.api', { socket: socketPath ? `  ·  socket: ${socketPath}` : '' }));

  return {
    company,
    office,
    hub,
    pipelines,
    registry,
    asks,
    bus,
    herdr,
    subPanes,
    appearance: (id = view()) => store.getAppearance(id),
    weatherOf,
    get weather() { return weatherOf(view()); },
    fullState,
    setPrefs,
    launchStartAgent,
    url: `http://${host}:${port}`,
    socket: socketPath,
    command,
    handleMessage,
    store,
    async close() {
      stopDemo?.();
      for (const w of weathers.values()) w.stop();
      weatherShared?.stop?.();
      herdr?.stop();
      subPanes?.stop();
      hub.stopAll();
      for (const c of wss.clients) c.terminate();
      await Promise.all([tcp, unix].filter(Boolean).map((s) => new Promise((r) => s.close(r))));
      if (socketPath) fs.rmSync(socketPath, { force: true });
      if (ownStore) store.close();
    },
  };
}

// Only your user can open the Unix socket (0600) and it does not clash with other ports.
async function listenUnix(server, file) {
  // macOS limits a socket path to 104 bytes (sun_path).
  if (Buffer.byteLength(file) > 103) throw new Error(t('server.socketTooLong'));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const alive = await new Promise((resolve) => {
      const c = net.connect(file, () => { c.destroy(); resolve(true); });
      c.on('error', () => resolve(false));
    });
    if (alive) throw new Error(t('server.socketBusy'));
    fs.rmSync(file, { force: true }); // left over from a run that did not close properly
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(file, () => { server.off('error', reject); resolve(); });
  });
  fs.chmodSync(file, 0o600);
}

// A website open in your browser must not be able to read or inject events into the office:
// foreign Hosts (DNS rebinding) and Origins from other sites are rejected. Non-browser clients
// (curl, hooks, plugins) send no Origin and pass.
function checkBrowserAccess(req, boundHost, port) {
  const hostHeader = req.headers.host || '';
  const hostname = hostHeader.replace(/:\d+$/, '');
  if (LOOPBACK.has(boundHost) && hostname && !LOOPBACK.has(hostname)) throw new HttpError(403, t('err.hostDenied'));
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const o = new URL(origin);
    if (o.host === hostHeader) return; // the web view itself
    if (LOOPBACK.has(o.hostname) && Number(o.port || 80) === port) return;
  } catch { /* invalid origin */ }
  throw new HttpError(403, t('err.originDenied'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, t('err.tooLarge'))); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { ok: false });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}
