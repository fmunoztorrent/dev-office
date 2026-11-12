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
import { ClarifyDesk } from './clarify.js';
import { Standup } from './standup.js';
import { exportSettings, importSettings } from './settings-io.js';
import { companyMap } from './components.js';
import { autonomyOf } from './guides.js';
import { search as ragSearch, createEmbedder, createIndexer } from './rag.js';
import { fromFile, fromUrl } from './ingest.js';
import { AskDesk } from './asks.js';
import { Archive } from './archive.js';
import { DirectiveDesk } from './directives.js';
import { openStore, dbFile, MAIN_OFFICE } from './store.js';
import { Weather, findPlaces } from './weather.js';
import { Herdr, paneRole, quote } from './herdr.js';
import { clip, normRole } from './roles.js';
import { SubPanes } from './subpanes.js';
import { ServiceHub } from './services.js';
import { PromptHub } from './prompts.js';
import { defaultLook } from '../public/sim.js';
import { exportCharacter, parseCharacter, changedLook } from '../public/character.js';
import { detectHarness, projectRoot, HARNESSES, which } from '../integrations/common/devteam.mjs';
import { t, setLanguage, getLanguage } from '../public/i18n.js';
import { zoneInfo, systemZone } from '../public/clock.js';
import { insideDir as inside } from './paths.js';
import { provisionTeam } from '../bin/team.js';

export const VERSION = '0.18.1';
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
 * @param places   the city picker's search (Open-Meteo's geocoder): false to not query it, or
 *                 { fetch } (the tests); by default, unless DEV_TEAM_OFFICE_WEATHER=off
 * @param services the services left running in the background: a ServiceHub or its options (the tests)
 * @param herdr    true: if running inside herdr, opens agents in panes (the executable asks for it);
 *                 a Herdr instance (the tests); false/omitted: no herdr at all
 * @param mode     'terminal' (an interface lives in this process) or 'background' (`serve`): /v1/health
 *                 says it, so `update` knows whether it can bring the office back by itself
 * @returns {Promise<{company, office, url, socket, command, handleMessage, close, …}>}
 */
export async function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, socket = defaultSocketPath(), log = () => {}, db, weather: weatherOpt, places: placesOpt, services: servicesOpt, herdr: herdrOpt, asks: asksOpt = {}, clarify: clarifyOpt = {}, rag: ragOpt = {}, standup: standupOpt = {}, mode = 'terminal', outdatedAfter = 3000 } = {}) {
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
  const registry = new AgentRegistry({ getAgents: () => store.listAgents(), hub, pipelines, office: company, prefs: () => store.getPrefs() });
  // side questions (btw) to each office's agent on duty
  const asks = new AskDesk({ company, store, officeUrl, ...asksOpt });
  // a brief from you is reviewed first by the analyst: does it have everything? (server/clarify.js)
  const clarify = new ClarifyDesk({ registry, store, company, ...clarifyOpt });
  const publicAsk = ({ id, office: o, agent, question, answer, status, error, from, forked, role, createdAt, updatedAt }) => ({ id, office: o, agent, question, answer, status, error, from, forked, role, createdAt, updatedAt });
  // the two floors that serve every office: the archive (the company's knowledge) and the executive one (directives)
  const archive = new Archive({ store, registry });
  // the archive as a RAG: its embeddings (optional) are made in the background after each save
  const embedder = createEmbedder(() => store.getPrefs(), ragOpt);
  const indexer = createIndexer(store, embedder);
  archive.on('saved', () => indexer.kick());
  // the daily standup, each morning in each office (and on demand)
  // how the daily's text names each one: "Diego (Backend)", with the office's names
  const personIn = (id, role) => {
    const look = { ...defaultLook(role), ...(store.getAppearance(id)?.[role] || {}) };
    return look.name ? `${look.name} (${look.title || t(`team.titles.${role}`, { g: look.sex })})` : role;
  };
  const standup = new Standup({ company, archive, store, hub, clarify, who: personIn, ...standupOpt });
  const directives = new DirectiveDesk({ store, registry, hub, pipelines, archive, company });
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
  const weatherKey = (id) => company.locationOf(id) || process.env.DEV_TEAM_OFFICE_LOCATION || company.zoneOf(id);
  function weatherOf(id) {
    if (weatherOpt === false || !prefs().weather) return null;
    if (weatherShared) return weatherShared;
    const key = weatherKey(id);
    let w = weathers.get(key);
    if (!w) {
      const tz = company.zoneOf(id), z = zoneInfo(tz);
      const own = company.locationOf(id) || process.env.DEV_TEAM_OFFICE_LOCATION;
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
      asks: asks.list(id, 10), clarifications: clarify.list(id), services: services.list(id), prompts: promptsOf(id),
      directives: directives.list(), archive: archive.snapshot(), overview: overview(),
    };
  };

  /**
   * What the executive floor sees of each office: who is working, who waits for you, what is running,
   * and its health: errors in the last hour, the context left of its agents (the lowest) and how long
   * it has been waiting for you → 'ok' | 'warn' | 'bad'.
   */
  function overview() {
    const now = Date.now();
    const agents = store.listAgents();
    const flow = store.flowByOffice({ since: now - 7 * 86400_000 });
    return company.ids().map((id) => {
      const o = company.get(id);
      const live = [...o.sessions.values()].filter((s) => s.id !== 'office' && ['active', 'waiting'].includes(s.status) && now - s.lastAt < 15 * 60_000);
      const last = [...o.sessions.values()].filter((s) => s.id !== 'office').sort((a, b) => b.lastAt - a.lastAt)[0];
      const errors = o.log.filter((e) => e.ts >= now - 3600_000 && ((e.kind === 'tool_end' && e.ok === false && e.phase !== 'red') || e.kind === 'error')).length;
      const left = live.filter((s) => s.context?.max > 0).map((s) => Math.max(0, 1 - s.context.used / s.context.max));
      const context = left.length ? Math.round(Math.min(...left) * 100) / 100 : null;
      const waiting = live.filter((s) => s.status === 'waiting');
      const waitMin = waiting.length ? Math.floor((now - Math.min(...waiting.map((s) => s.waiting?.since || s.lastAt))) / 60_000) : 0;
      const health = waitMin >= 15 || errors >= 10 || (context !== null && context < 0.1) ? 'bad'
        : waiting.length || errors >= 3 || (context !== null && context < 0.25) ? 'warn' : 'ok';
      return {
        id, name: company.info(id)?.name || id, agents: agents.filter((a) => a.office === id).length,
        working: live.filter((s) => s.status === 'active').length, waiting: waiting.length,
        tasks: [...hub.tasks.values()].filter((x) => (x.office || MAIN_OFFICE) === id && ['queued', 'sent', 'running'].includes(x.status)).length,
        title: live.sort((a, b) => b.lastAt - a.lastAt)[0]?.title || '', lastAt: last?.lastAt || null,
        errors, context, waitMin, health,
        // how it works on its own, and how its briefs flowed in the last 7 days
        autonomy: autonomyOf(store, id).level || 'company', flow: flow[id] || { briefs: 0, done: 0, failed: 0, leadMin: null },
      };
    });
  }
  let stopDemo = null;

  // ---------- the services an agent leaves running in the background (server/services.js) ----------

  const services = servicesOpt instanceof ServiceHub ? servicesOpt : new ServiceHub(servicesOpt || {});
  services.start();
  company.on('raw', (id, raw, ev) => services.observe(id, raw, ev || {}));
  // the log tells it: who started it, and when it stopped
  const serviceNews = (kind) => (s) => company.ingest('office', { session: s.session || 'office', office: s.office, kind, role: s.role, text: s.name, service: s.id });
  services.on('up', serviceNews('service_up'));
  services.on('down', serviceNews('service_down'));

  /** Inside herdr: a pane below the agent's that follows the service's log (`tail -F`). */
  async function serviceTerminal(s) {
    if (!herdr?.available) return { ok: false, status: 409, error: t('err.noHerdr') };
    if (!s.log) return { ok: false, status: 409, error: t('err.serviceNoLog') };
    const from = company.paneOfSession?.(s.session) || herdr.pane;
    const { pane } = await herdr.launchCommand({
      command: `tail -n 200 -F ${quote(s.log)}`, cwd: s.cwd || undefined, from, direction: 'down', ratio: 0.35,
      office: s.office, role: s.role, title: clip(`📜 ${s.name}`, 60), kind: 'logs',
    });
    return { ok: true, pane };
  }

  // ---------- herdr: the agents in panes, and the panes they open ----------

  function trackPane(info) {
    if (!info?.pane) return;
    company.bindPane(info.pane, info.office || MAIN_OFFICE);
    // the agent's pane, or a subagent's: its own events tell its activity
    if (info.main || info.kind === 'sub' || info.kind === 'logs') return;
    company.ingest('herdr', { session: 'office', office: info.office || MAIN_OFFICE, kind: 'pane_open', pane: info.pane, role: info.role, text: info.title, agent: info.agent });
  }
  herdr?.on('open', (p) => {
    trackPane(p);
    say(t('herdr.opened', { pane: p.pane, title: p.title, office: company.info(p.office || MAIN_OFFICE)?.name || '' }), { office: p.office, pane: p.pane });
    bus.emit('herdr', herdr.status());
  });
  herdr?.on('close', (p) => {
    if (p.kind === 'sub') subPanes?.forget(p.pane);
    if (!p.main && p.kind !== 'sub' && p.kind !== 'logs') company.ingest('herdr', { session: 'office', office: p.office || MAIN_OFFICE, kind: 'pane_close', pane: p.pane, role: p.role, text: p.title });
    if (p.taskId) hub.paneSettled(p.pane);
    say(t('herdr.closed', { pane: p.pane, title: p.title }), { office: p.office, pane: p.pane });
    bus.emit('herdr', herdr.status());
  });
  herdr?.on('state', (p, status, was) => {
    if (was === 'working' && ['idle', 'done'].includes(status)) hub.paneSettled(p.pane);
    if (!p.main && p.kind !== 'logs') company.ingest('herdr', { session: 'office', office: p.office || MAIN_OFFICE, kind: 'pane_state', pane: p.pane, role: p.role, text: p.title, state: status });
    bus.emit('herdr', herdr.status());
  });
  // a pane an agent opened on its own, in a project's folder: the office adopts it
  herdr?.on('discover', (d) => {
    const parent = [...herdr.tracked.values()].find((x) => x.cwd && (inside(d.cwd, x.cwd) || inside(x.cwd, d.cwd)));
    herdr.track(d.pane, { office: parent?.office || company.officeForPath(d.cwd) || MAIN_OFFICE, role: paneRole({ agent: d.agent, title: d.title }), title: d.title, agent: d.agent, kind: d.agent ? 'agent' : 'command', cwd: d.cwd });
  });
  herdr?.start({ isProject: (cwd) => !!company.officeForPath(cwd) });

  // ---------- what the agents ask you on their screens: permissions and questions (server/prompts.js) ----------

  const prompts = new PromptHub({
    herdr: herdr?.available ? herdr : null,
    officeOf: (pane, cwd) => herdr?.tracked.get(pane)?.office || company.route({ pane, cwd }),
  });
  herdr?.on('screens', (screens) => prompts.round(screens));
  // herdr names Claude Code `claude`; the office, `claude-code`
  const harnessOf = (agent) => (agent === 'claude' ? 'claude-code' : agent || null);
  const publicPrompt = ({ id, rev, pane, agent, cwd, office: o, question, summary, options, cursor, since }) => ({ id, rev, pane, agent: harnessOf(agent), project: cwd ? path.basename(cwd) : null, office: o, question, summary, options, cursor, since });
  const promptsOf = (id) => prompts.list(valid(id)).map(publicPrompt);
  // a new question: the manager goes to your desk (the PO's) to ask, unless the agent's own event
  // (Claude Code's permission hook) has just sent him
  const lastWaiting = new Map(); // office → when its last 'waiting' came
  company.on('event', (id, ev) => { if (ev.kind === 'waiting') lastWaiting.set(id, Date.now()); });
  prompts.on('new', (q) => {
    if (Date.now() - (lastWaiting.get(q.office) || 0) < 20_000) return;
    // the session of that pane's agent (if its events said which pane it is in) waits for you
    const session = [...company.sessionPane].find(([, pane]) => pane === q.pane)?.[0] || 'office';
    const agent = AGENT_LABEL[harnessOf(q.agent)] || q.agent || t('prompts.theAgent');
    company.ingest('herdr', { session, office: q.office, kind: 'waiting', text: t('prompts.waiting', { agent, summary: q.summary || '' }) });
  });

  /** Your answer, pressed in the agent's pane: `option` (its number from 0) or `cancel`, for the question `rev` you saw. */
  async function answerPrompt(id, { rev, option, cancel } = {}) {
    if (!herdr?.available) return { ok: false, status: 409, error: t('err.noHerdr') };
    if (!prompts.get(id)) return { ok: false, status: 404, error: t('err.promptGone') };
    try {
      const out = await prompts.answer(id, { rev, option: option === undefined ? undefined : Number(option), cancel: !!cancel });
      if (out.ok) say(t(out.answer ? 'prompts.answered' : 'prompts.cancelled', { answer: out.answer || '', pane: out.pane }), { pane: out.pane });
      if (!out.ok) return { ...out, error: t(out.reason === 'option' ? 'err.promptOption' : out.status === 404 ? 'err.promptGone' : 'err.promptChanged') };
      return out;
    } catch (err) {
      return { ok: false, status: 500, error: t('err.herdrFailed', { error: err.message }) };
    }
  }

  // each subagent, in its pane (`dev-team-office follow`): its start opens it, its end closes it
  const subPanes = herdr ? new SubPanes({
    herdr, company, log: say,
    command: [process.execPath, CLI],
    env: () => ({ DEV_TEAM_OFFICE_URL: officeUrl() }),
    enabled: () => prefs().herdr.subagents !== false,
    who: (id, role) => store.getAppearance(id)?.[role]?.name || defaultLook(role)?.name || '',
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

  // ---------- what happens on the executive floor and in the archive (the game animates it, the log tells it) ----------

  function floor(where, kind, extra = {}) {
    bus.emit('floor', { floor: where, kind, ts: Date.now(), ...extra });
  }
  const officeName = (id) => company.info(id)?.name || id;
  directives.on('created', (d) => {
    const offices = [...new Set(d.parts.map((p) => p.office))];
    floor('exec', 'directive', { text: d.title, offices: offices.map(officeName), total: d.total, waiting: d.parts.filter((p) => p.status === 'waiting').length });
    say(t('exec.log.created', { title: d.title, n: d.total, offices: offices.map(officeName).join(', ') }), { floor: 'exec' });
  });
  directives.on('ended', (d) => {
    floor('exec', 'directive_end', { text: d.title, status: d.status, done: d.done, total: d.total });
    say(t('exec.log.ended', { title: d.title, status: t(`directiveStatus.${d.status}`), done: d.done, total: d.total }), { floor: 'exec' });
  });
  archive.on('saved', (e, created) => {
    floor('archive', 'saved', { text: e.title, entryKind: e.kind, source: e.source, created });
    if (e.kind !== 'minute') say(t(created ? 'archive.log.saved' : 'archive.log.updated', { kind: t(`knowledgeKind.${e.kind}`), title: e.title, who: e.source || t('events.you') }), { floor: 'archive' });
  });
  archive.on('removed', (e) => e && floor('archive', 'removed', { text: e.title, entryKind: e.kind }));
  archive.on('installed', (e, results) => {
    const ok = results.filter((r) => r.ok);
    floor('archive', 'installed', { text: e.name, entryKind: e.kind, count: ok.length });
    if (ok.length) say(t('archive.log.installed', { kind: t(`knowledgeKind.${e.kind}`), name: e.name, projects: ok.map((r) => r.name).join(', ') }), { floor: 'archive' });
  });
  archive.on('generate', (g) => {
    floor('archive', 'generate', { text: g.text, entryKind: g.kind });
    say(t('archive.log.generate', { kind: t(`knowledgeKind.${g.kind}`), text: clip(g.text, 80) }), { floor: 'archive' });
  });

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
    if ('timezone' in patch || 'city' in patch || 'weather' in patch) refreshWeather();
    bus.emit('prefs', out.prefs);
    if (patch.lang || 'timezone' in patch || 'city' in patch) bus.emit('offices', company.list());
    return out;
  }

  /** After importing settings: everything they touch is applied and the interfaces are told. */
  function settingsImported(out) {
    if (out.lang) setLanguage(out.lang);
    officesChanged();
    bus.emit('prefs', prefs());
    for (const o of company.list()) bus.emit('appearance', o.id, store.getAppearance(o.id));
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
        return clarify.review(msg);
      // your answers to the analyst's questions about a brief (or skip: the team decides)
      case 'clarify_answer':
        return clarify.answer(msg.id, { answers: Array.isArray(msg.answers) ? msg.answers : [], skip: !!msg.skip });
      case 'clarify_cancel':
        return clarify.cancel(msg.id);
      case 'standup':
        return msg.all ? standup.runAll({ from: t('events.you') }) : standup.run(here, { from: t('events.you') });
      // the executive floor: one order for several offices or projects, and cancelling it
      case 'directive': {
        const out = directives.create({ text: msg.text, title: msg.title, offices: msg.offices, targets: msg.targets, answers: msg.answers, ask: msg.ask !== false, from: msg.from });
        if (out.created?.length) officesChanged();
        return out;
      }
      case 'directive_cancel':
        return directives.cancel(msg.id);
      case 'pipeline_start':
        return pipelines.start(msg);
      case 'pipeline_cancel':
        return pipelines.cancel(msg.id);
      // The agent reports how the pipeline it is running is going.
      case 'pipeline_update':
        return pipelines.update(msg.id, msg);
      // btw: a side question to the office's agent on duty (it answers without being interrupted)
      case 'ask': {
        const out = asks.ask({ text: msg.text, office: here, from: msg.from, ...askTarget(msg) });
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
      // a browser page says it is from 0.8.2 or newer: it reloads itself when the version changes
      case 'client':
        if (conn) conn.client = String(msg.app || 'web');
        return { ok: true };
      default:
        return { ok: false, error: t('err.unknownType', { type: msg.type }) };
    }
  }

  // ---------- HTTP ----------

  const info = () => ({ ok: true, name: 'dev-team-office', version: VERSION, pid: process.pid, uptime: Math.round((Date.now() - startedAt) / 1000), url: `http://${host}:${port}`, socket: socketPath, lang: getLanguage(), herdr: !!herdr?.available, mode, root: path.dirname(path.dirname(CLI)) });
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
      // the services left running in the background: the list, what each one prints, and its pane
      if (req.method === 'GET' && p === '/v1/services') return json(res, 200, { ok: true, services: services.list(valid(q('office'))) });
      const sm = p.match(/^\/v1\/services\/([^/]+)\/(log|terminal)$/);
      if (sm) {
        const s = services.get(decodeURIComponent(sm[1]));
        if (!s) return json(res, 404, { ok: false, error: t('err.unknownService') });
        if (sm[2] === 'log' && req.method === 'GET') {
          const from = q('from') !== undefined ? Number(q('from')) : undefined;
          return json(res, 200, { ok: true, service: s.id, ...services.read(s.id, { from }) });
        }
        if (sm[2] === 'terminal' && req.method === 'POST') {
          try {
            const out = await serviceTerminal(s);
            return json(res, out.ok ? 200 : out.status, out);
          } catch (err) { return json(res, 500, { ok: false, error: err.message }); }
        }
      }
      // what the agents ask you on their screens, and your answer (pressed in the agent's pane)
      if (req.method === 'GET' && p === '/v1/prompts') return json(res, 200, { ok: true, prompts: promptsOf(q('office')) });
      const pm = p.match(/^\/v1\/prompts\/([^/]+)\/answer$/);
      if (pm && req.method === 'POST') {
        const out = await answerPrompt(decodeURIComponent(pm[1]), await body(req));
        return json(res, out.ok ? 200 : out.status || 400, out);
      }
      // the city picker: the cities of a time zone's country that start with what was typed
      if (req.method === 'GET' && p === '/v1/places') {
        const tz = q('timezone') || company.zoneOf(valid(q('office')));
        const country = zoneInfo(tz).country || null;
        const online = placesOpt !== false && (placesOpt?.fetch || process.env.DEV_TEAM_OFFICE_WEATHER !== 'off');
        if (!online) return json(res, 200, { ok: true, places: [], country, offline: true });
        try {
          return json(res, 200, { ok: true, places: await findPlaces(q('q'), { country, fetch: placesOpt?.fetch }), country });
        } catch (err) {
          return json(res, 200, { ok: true, places: [], country, offline: true, error: err.message });
        }
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
      // Your settings as a JSON file (server/settings-io.js): to keep them or take them to another machine
      if (req.method === 'GET' && p === '/v1/settings/export') {
        const data = exportSettings(store, { app: VERSION });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="dev-team-office-settings-${data.exportedAt.slice(0, 10)}.json"`, 'cache-control': 'no-store' });
        return res.end(`${JSON.stringify(data, null, 2)}\n`);
      }
      if (req.method === 'POST' && p === '/v1/settings/import') {
        const out = importSettings(store, await body(req));
        if (!out.ok) return json(res, 400, out);
        settingsImported(out);
        return json(res, 200, out);
      }
      // The company's offices (teams or domains)
      if (req.method === 'GET' && p === '/v1/offices') return json(res, 200, { ok: true, offices: company.list(), view: view() });
      if (req.method === 'POST' && p === '/v1/offices') {
        const out = store.createOffice(await body(req));
        if (out.ok) {
          officesChanged();
          out.office = company.info(out.office.id);
          floor('exec', 'department', { text: out.office.name }); // operations takes note of the new department
        }
        return json(res, out.ok ? 201 : 400, out);
      }
      let m;
      // The daily standup now (it also happens by itself every morning): what happened since the last
      // one. /v1/standup is the company's: every department's at once.
      if (req.method === 'POST' && p === '/v1/standup') return json(res, 200, standup.runAll({ from: t('events.you') }));
      if (req.method === 'POST' && (m = p.match(/^\/v1\/offices\/([^/]+)\/standup$/))) {
        const id = decodeURIComponent(m[1]);
        if (!company.has(id)) return json(res, 404, { ok: false, error: t('err.unknownOffice', { office: id }) });
        return json(res, 200, standup.run(id, { from: t('events.you') }));
      }
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
      // A character as JSON, to share it (public/character.js): GET exports it, PUT imports one
      if ((m = p.match(/^\/v1\/characters\/([^/]+)$/))) {
        const role = normRole(decodeURIComponent(m[1]));
        if (!role) return json(res, 404, { ok: false, error: t('err.unknownRole', { role: decodeURIComponent(m[1]) }) });
        const id = valid(q('office'));
        if (req.method === 'GET') return json(res, 200, exportCharacter(role, { ...defaultLook(role), ...(store.getAppearance(id)[role] || {}) }));
        if (req.method === 'PUT') {
          const c = parseCharacter(await body(req));
          if (!c.ok) return json(res, 400, { ok: false, error: t(`err.character.${c.error}`) });
          const r = store.setAppearance({ [role]: Object.keys(changedLook(role, c.look)).length ? changedLook(role, c.look) : null }, id);
          if (!r.ok) return json(res, 400, r);
          bus.emit('appearance', id, r.appearance);
          return json(res, 200, { ok: true, role, appearance: r.appearance[role] || {} });
        }
      }
      // A project folder's instructions (also with each agent of ⚙ › Agents): { path, instructions }
      if (req.method === 'PUT' && p === '/v1/projects/instructions') {
        const b = await body(req);
        const out = store.setProjectInstructions(b.path, b.instructions);
        if (out.ok) registry.changed();
        return json(res, out.ok ? 200 : 400, out);
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
        const out = clarify.review({ ...(await body(req)), target: decodeURIComponent(m[1]) });
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/run') {
        const out = clarify.review(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      // The analyst's questions about your briefs, and your answers
      if (req.method === 'GET' && p === '/v1/clarifications') return json(res, 200, { ok: true, clarifications: clarify.list(q('office') || undefined) });
      if (req.method === 'POST' && (m = p.match(/^\/v1\/clarifications\/([^/]+)\/(answer|cancel)$/))) {
        const id = decodeURIComponent(m[1]);
        const b = await body(req);
        const out = m[2] === 'cancel' ? clarify.cancel(id) : clarify.answer(id, { answers: Array.isArray(b.answers) ? b.answers : [], skip: !!b.skip });
        return json(res, out.ok ? 200 : out.status || 400, out);
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
            // with the instructions of its project and department on top (Claude already works in its folder)
            if (task) out.task = { id: task.id, text: task.command ? task.text : hub.brief(task.text, company.session(session)?.cwd, { office: task.office, scope: false }), ...(task.command ? { command: task.command, args: task.args } : {}) };
          }
        }
        const cancel = session ? pipelines.cancelsFor(session) : [];
        if (cancel.length) out.cancel = cancel;
        return json(res, 200, out);
      }
      // btw over HTTP: { text, office?, from?, wait? } (with wait, it answers when the reply arrives)
      if (req.method === 'POST' && p === '/v1/ask') {
        const b = await body(req);
        const out = asks.ask({ text: b.text, office: valid(b.office), from: b.from, ...askTarget(b) });
        if (!out.ok) return json(res, 400, out);
        if (!b.wait) return json(res, 202, { ok: true, ask: publicAsk(out.ask) });
        const done = await out.done;
        return json(res, 200, { ok: done.status === 'answered', ask: publicAsk(done), ...(done.error ? { error: done.error } : {}) });
      }
      if (req.method === 'GET' && p === '/v1/asks') return json(res, 200, { ok: true, asks: asks.list(valid(q('office')), Number(q('limit')) || 20) });
      // The executive floor: directives (one order for several offices or projects) and how each office is doing
      if (req.method === 'GET' && p === '/v1/directives') return json(res, 200, { ok: true, directives: directives.list(Number(q('limit')) || 12), overview: overview() });
      // The company's map: departments → projects → components (detected from each folder, and the declared ones)
      if (req.method === 'GET' && p === '/v1/map') return json(res, 200, { ok: true, departments: companyMap(store, { name: (o) => officeName(o.id) }) });
      if (req.method === 'POST' && p === '/v1/components') {
        const b = await body(req);
        const a = store.listAgents().find((x) => x.id === b.project || x.path === b.project);
        if (!a) return json(res, 400, { ok: false, error: t('err.unknownProject', { project: b.project || '?' }) });
        const out = store.addComponent({ project: a.path, name: b.name, path: b.path, description: b.description });
        return json(res, out.ok ? 201 : 400, out);
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/v1\/components\/([^/]+)$/))) {
        const out = store.deleteComponent(decodeURIComponent(m[1]));
        return json(res, out.ok ? 200 : out.status || 400, out);
      }
      // the impact before it goes: the departments, projects and components it touches, and what is not on the map
      if (req.method === 'POST' && p === '/v1/directives/plan') {
        const b = await body(req);
        const out = directives.plan({ text: b.text, offices: b.offices, targets: b.targets ?? b.projects });
        if (out.ok) floor('exec', 'impact', { text: clip(b.text, 80), total: out.map.targets.length, unknown: out.map.unknown.length });
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/directives') {
        const b = await body(req);
        const out = directives.create({ text: b.text, title: b.title, offices: b.offices, targets: b.targets ?? b.projects, answers: b.answers, ask: b.ask !== false, exact: !!b.exact, from: b.from });
        if (out.created?.length) { officesChanged(); for (const o of out.created) floor('exec', 'department', { text: o.name }); }
        return json(res, out.ok ? 201 : out.needsAnswers ? 409 : 400, out);
      }
      if ((m = p.match(/^\/v1\/directives\/([^/]+)(\/cancel)?$/))) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET' && !m[2]) { const d = directives.get(id); return d ? json(res, 200, { ok: true, directive: d }) : json(res, 404, { ok: false, error: t('err.unknownDirective') }); }
        if (req.method === 'POST' && m[2]) { const out = directives.cancel(id); return json(res, out.ok ? 200 : out.status || 400, out); }
      }
      // The archive: the company's knowledge (notes, decisions, docs, minutes), its skills and its connectors
      if (req.method === 'GET' && p === '/v1/knowledge') {
        const query = q('q');
        const entries = archive.list({ kind: q('kind'), q: query, office: q('office'), limit: q('limit') });
        if (query && q('from') === 'agent') floor('archive', 'search', { text: query });
        return json(res, 200, { ok: true, entries, counts: archive.counts() });
      }
      if (req.method === 'POST' && p === '/v1/knowledge') {
        const out = archive.save(await body(req), { source: t('events.you') });
        return json(res, out.ok ? (out.created ? 201 : 200) : out.status || 400, out);
      }
      // The archive as a RAG: the chunks that answer a search, with an id to cite them (lexical and,
      // with an embedding provider, semantic). A search that finds nothing is recorded as a gap.
      if (req.method === 'GET' && p === '/v1/knowledge/search') {
        const query = q('q') || '';
        const out = await ragSearch(store, query, { office: q('office') || null, project: q('project') || null, k: Math.min(20, Number(q('k')) || 5), embedder, source: q('source') || null, gap: q('from') === 'agent' });
        if (query && q('from') === 'agent') floor('archive', 'search', { text: query });
        return json(res, 200, { ok: true, ...out });
      }
      // A document into the archive: { url } or { name, text | base64 }, plus kind, title, office, project, tags, validUntil
      if (req.method === 'POST' && p === '/v1/knowledge/import') {
        const b = await body(req);
        const doc = b.url ? await fromUrl(String(b.url)) : fromFile({ name: b.name, text: b.text, base64: b.base64 });
        if (!doc.ok) return json(res, 400, doc);
        const out = archive.save({ kind: b.kind || 'doc', title: b.title || doc.title, body: doc.text, origin: doc.origin, office: b.office || null, project: b.project || null, tags: b.tags, validUntil: b.validUntil ?? null }, { source: b.from || t('events.you') });
        return json(res, out.ok ? 201 : out.status || 400, out);
      }
      // What the agents searched and did not find: to fill it in
      if (req.method === 'GET' && p === '/v1/knowledge/gaps') return json(res, 200, { ok: true, gaps: store.listGaps({ office: q('office') || null }) });
      if (req.method === 'POST' && (m = p.match(/^\/v1\/knowledge\/gaps\/(\d+)\/resolve$/))) { const out = store.resolveGap(m[1]); return json(res, out.ok ? 200 : out.status || 400, out); }
      // How the archive is indexed (chunks, embeddings), and indexing it again
      if (req.method === 'GET' && p === '/v1/archive/index') return json(res, 200, { ok: true, ...store.indexStatus(embedder.model), embeddings: embedder.enabled, running: indexer.status.running, error: indexer.status.lastError });
      if (req.method === 'POST' && p === '/v1/archive/reindex') { const chunks = store.indexAll(); indexer.kick(); return json(res, 200, { ok: true, chunks }); }
      if (req.method === 'POST' && p === '/v1/knowledge/generate') {
        const out = archive.generate(await body(req));
        return json(res, out.ok ? 200 : 400, out);
      }
      if ((m = p.match(/^\/v1\/knowledge\/([^/]+)(\/install)?$/))) {
        const id = decodeURIComponent(m[1]);
        if (m[2] && req.method === 'POST') {
          const b = await body(req);
          const out = archive.install(id, b.targets ?? b.projects);
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
        if (!m[2] && req.method === 'GET') {
          const e = archive.get(id, { touch: q('from') === 'agent' });
          if (e && q('from') === 'agent') floor('archive', 'read', { text: e.title, entryKind: e.kind });
          // with its index: the chunks it was cut into, and how many have their embedding
          return e ? json(res, 200, { ok: true, entry: e, chunks: store.chunksOf(e.id) }) : json(res, 404, { ok: false, error: t('err.unknownKnowledge') });
        }
        if (!m[2] && (req.method === 'PUT' || req.method === 'PATCH')) {
          const out = archive.save({ ...(await body(req)), id });
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
        if (!m[2] && req.method === 'DELETE') {
          const out = archive.remove(id);
          return json(res, out.ok ? 200 : out.status || 400, out);
        }
      }
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
  services.on('change', (id) => toOffice(id, { type: 'services', services: services.list(id), office: id }));
  prompts.on('change', (id) => toOffice(id, { type: 'prompts', prompts: promptsOf(id), office: id }));
  hub.on('change', () => perOffice((id) => ({ type: 'tasks', ...hub.snapshot(id) })));
  pipelines.on('change', () => perOffice((id) => ({ type: 'pipelines', ...pipelines.snapshot(id) })));
  registry.on('change', () => perOffice((id) => ({ type: 'targets', targets: registry.targets(id) })));
  bus.on('appearance', (id, a) => toOffice(id, { type: 'appearance', appearance: a, office: id }));
  bus.on('weather', (id, w) => toOffice(id, { type: 'weather', weather: w, office: id }));
  bus.on('prefs', (pr) => broadcast({ type: 'prefs', prefs: pr }));
  bus.on('offices', (list) => broadcast({ type: 'offices', offices: list }));
  bus.on('herdr', (st) => broadcast({ type: 'herdr', herdr: st }));
  asks.on('change', (a) => toOffice(a.office, { type: 'ask', ask: publicAsk(a) }));
  clarify.on('change', (c) => toOffice(c.office, { type: 'clarify', clarify: c }));
  // the two floors every office shares: the directives, the archive and what happens on them
  directives.on('change', (list) => broadcast({ type: 'directives', directives: list }));
  archive.on('change', () => broadcast({ type: 'archive', archive: archive.snapshot() }));
  bus.on('floor', (ev) => broadcast({ type: 'floor', event: ev }));
  // how each office is doing (the executive floor's wall): at most once a second
  let overviewTimer = null;
  const overviewSoon = () => { overviewTimer ??= setTimeout(() => { overviewTimer = null; broadcast({ type: 'overview', overview: overview() }); }, 1000); overviewTimer.unref?.(); };
  company.on('event', overviewSoon);
  hub.on('change', overviewSoon);
  for (const id of company.ids()) weatherOf(id);

  wss.on('connection', (ws, req) => {
    // `?office=<id>`: a viewer that watches that office without changing the chosen one (a subagent's pane)
    const wanted = new URL(req?.url || '/', 'http://localhost').searchParams.get('office');
    const conn = ws.conn = { id: ++connSeq, agent: null, view: wanted && company.has(wanted) ? wanted : view(), send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
    ws.send(JSON.stringify({ type: 'hello', ...info() }));
    ws.send(JSON.stringify({ type: 'snapshot', state: fullState(conn.view) }));
    // A browser page (it sends an Origin, Node clients do not) that does not say `client` was loaded
    // from an older office (0.8.1 or before): its code cannot reload itself, so it is told to.
    const stale = req?.headers?.origin ? setTimeout(() => { if (!conn.client) conn.send({ type: 'error', error: t('server.outdatedPage', { version: VERSION }) }); }, outdatedAfter) : null;
    stale?.unref?.();
    ws.on('close', () => { clearTimeout(stale); hub.unregister(conn.id); });
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
    clarify,
    archive,
    embedder,
    indexer,
    standup,
    directives,
    overview,
    bus,
    herdr,
    subPanes,
    services,
    prompts,
    promptsOf,
    answerPrompt,
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
      standup.stop();
      indexer.stop();
      clearTimeout(overviewTimer);
      for (const w of weathers.values()) w.stop();
      weatherShared?.stop?.();
      herdr?.stop();
      services.stop();
      subPanes?.stop();
      hub.stopAll();
      for (const c of wss.clients) c.terminate();
      // `close()` stops accepting new connections but waits for the open ones (a browser's keep-alive,
      // an idle socket): a terminal that quits would hang here and never reach `process.exit(0)`.
      // So after each `close()` we force the remaining connections shut.
      await Promise.all([tcp, unix].filter(Boolean).map((s) => new Promise((r) => {
        s.close(r);
        s.closeAllConnections?.();
      })));
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
/** Who a question is for: the character asked (`role`) and/or the session chosen (only when given). */
function askTarget(m) {
  const role = normRole(m?.role);
  // subId: a newcomer was asked (a subagent): its newcomer answers in the game, not its role's character
  return { ...(role ? { role } : {}), ...(typeof m?.session === 'string' && m.session ? { session: m.session } : {}), ...(typeof m?.subId === 'string' && m.subId ? { subId: m.subId.slice(0, 60) } : {}) };
}

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
