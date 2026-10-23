// The agents the office can send a prompt to. The office is the frontend: each agent is a
// backend with its own "harness engineering" (Errementari, gentle-pi, commands, .devteam/
// pipelines…) and it is THAT harness that runs the pipeline.
//
// - Registered (⚙ › Agents, the maintainer): a full path + the CLI that serves it (Claude
//   Code, OpenCode, Pi). Saved in the SQLite database (server/store.js).
// - Connected: any open agent session (Pi/OpenCode over WebSocket, Claude Code through its
//   hook), even if its path is not registered.
//
// For each one we detect what its harness brings (detectHarness) and where its pipeline starts.
// run() sends the prompt through that entry: to a session open in that path or to a new session.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { clip } from './roles.js';
import { detectHarness, invocation, HARNESSES, which } from '../integrations/common/devteam.mjs';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';
import { insideDir as inside } from './paths.js';

const DETECT_TTL = 4000;
const AGENT_NAME = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi', codex: 'Codex' };

export class AgentRegistry extends EventEmitter {
  /**
   * @param getAgents () => the registered agents ([{ id, name, path, harness, office, bin?, args? }])
   * @param office    the offices (server/company.js)
   */
  constructor({ getAgents, hub, pipelines, office }) {
    super();
    this.getAgents = getAgents;
    this.office = office;
    this.hub = hub;
    this.pipelines = pipelines;
    this.cache = new Map();
    hub.on('change', () => this.changed());
    pipelines.on('change', () => this.changed());
  }

  // the database may be closing (the office shuts down while the agents disconnect)
  #agents() { try { return this.getAgents(); } catch { return []; } }

  #detect(dir) {
    const hit = this.cache.get(dir);
    if (hit && Date.now() - hit.at < DETECT_TTL) return hit.info;
    let info;
    try { info = detectHarness(dir); } catch (err) { info = { dir, name: path.basename(dir), exists: false, harnesses: [], kinds: [], entries: [], roles: {}, error: err.message }; }
    this.cache.set(dir, { at: Date.now(), info });
    return info;
  }

  /** Open sessions: connected Pi/OpenCode and Claude Code sessions announced by their hook. */
  #sessions() {
    const live = this.hub.liveAgents().filter((c) => c.session).map((c) => ({ agent: c.agent, session: c.session, cwd: c.cwd, live: true }));
    const hooked = this.pipelines.hosts().filter((h) => !h.live && !live.some((l) => l.session === h.session)).map((h) => ({ agent: h.agent, session: h.session, cwd: h.cwd, live: false }));
    return [...live, ...hooked];
  }

  #sessionOffice(s) { return this.office?.officeOfSession?.(s.session) || this.office?.officeForPath?.(s.cwd) || MAIN_OFFICE; }

  /**
   * What the whiteboard dialog offers: each agent with its harness's entries.
   * @param office only that office's (without an office: all)
   */
  targets(office) {
    const sessions = this.#sessions();
    const used = new Set();
    const describe = ({ id, name, dir, harness, registered, own, office: where }) => {
      const info = this.#detect(dir);
      const mine = own.map((s) => ({ session: s.session, agent: s.agent, live: s.live, label: `${AGENT_NAME[s.agent] || s.agent} · ${tr(s.live ? 'targets.openSession' : 'targets.claudeTurn')}` }));
      const harnessOk = (e) => e.harnesses.includes(harness) || own.some((s) => e.harnesses.includes(s.agent));
      return {
        id, name, path: dir, harness, registered, exists: info.exists, office: where,
        available: !!which(harness === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[harness]?.bin),
        kinds: info.kinds, roles: info.roles,
        entries: info.entries.filter(harnessOk).map((e) => ({ ...e, harnesses: undefined })),
        sessions: mine,
      };
    };
    const out = [];
    for (const a of this.#agents()) {
      const own = sessions.filter((s) => inside(s.cwd, a.path) && (s.agent === a.harness || !a.harness));
      own.forEach((s) => used.add(s.session));
      if (office && (a.office || MAIN_OFFICE) !== office) continue;
      out.push({ ...describe({ id: a.id, name: a.name, dir: a.path, harness: a.harness, registered: true, own, office: a.office || MAIN_OFFICE }), bin: a.bin || null, args: a.args || null });
    }
    // sessions open outside the registered paths: they can be sent a prompt too
    for (const s of sessions) {
      if (used.has(s.session) || !s.cwd) continue;
      const where = this.#sessionOffice(s);
      if (office && where !== office) continue;
      out.push(describe({ id: `session:${s.session}`, name: path.basename(s.cwd), dir: s.cwd, harness: s.agent, registered: false, own: [s], office: where }));
    }
    return out;
  }

  target(id) { return this.targets().find((t) => t.id === id) || null; }

  /**
   * Sends a prompt to an agent through an entry of its harness.
   * msg: { target, entry, text, session?: id | null (null = new session), from }
   */
  run({ target, entry = 'prompt', text, session, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: tr('err.promptEmpty') };
    const t = this.targets().find((x) => x.id === target);
    if (!t) return { ok: false, error: tr('err.targetUnknown') };
    const e = t.entries.find((x) => x.id === entry);
    if (!e) return { ok: false, error: tr('err.noEntry', { name: t.name, entry }) };
    const s = session === null ? null : t.sessions.find((x) => x.session === session) || (session === undefined ? t.sessions.find((x) => x.live) : null);
    if (session && !s) return { ok: false, error: tr('err.sessionGone') };
    if (s) this.office?.setAgentRoles(s.session, t.roles); // which subagent of the harness is which character

    // .devteam/ pipeline: an open session runs it, inside itself
    if (e.devteam) {
      if (!s) return { ok: false, error: tr('err.needsSession', { label: e.label, agent: AGENT_NAME[t.harness] || t.harness, path: t.path }) };
      return this.pipelines.start({ session: s.session, agent: s.agent, pipeline: e.devteam, task: text, from, meta: { agentId: t.registered ? t.id : null, entry: e.id } });
    }
    const inv = invocation(e, text);
    const title = clip(`${e.id === 'prompt' ? '' : `${e.label}: `}${text}`, 300);
    const meta = { agentId: t.registered ? t.id : null, entry: e.id };
    if (s) return this.hub.submit({ text: inv.text, title, agent: s.agent, session: s.session, command: inv.command, args: inv.args, from, meta, office: t.office });
    if (!t.registered) return { ok: false, error: tr('err.sessionGone') };
    if (!t.exists) return { ok: false, error: tr('err.noPath', { path: t.path }) };
    const a = this.#agents().find((x) => x.id === t.id);
    return this.hub.submit({ text: inv.text, title, agent: t.harness, mode: 'launch', cwd: t.path, command: inv.command, args: inv.args, launch: { bin: a?.bin, args: a?.args }, from, meta, office: t.office });
  }

  /** Forgets what was detected in a folder (what it brings changed: its team, its commands). */
  forget(dir) { this.cache.delete(dir); }

  // several changes in a row (a session that registers moves tasks and pipelines) → a single notice
  changed() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.emit('change', this.targets()); });
  }
}
