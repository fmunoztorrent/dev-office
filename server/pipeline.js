// Pipelines in the office: only a RELAY. The game is the frontend and the agent is the backend.
//
// - Agents announce which pipelines they can run in their project: Pi and OpenCode when they
//   register over WebSocket, Claude Code from its hook (POST /v1/agents/announce).
// - When a pipeline is started from the whiteboard, the office asks that agent's session for it
//   ({ type: 'pipeline', id, pipeline, task }); Claude Code gets it from its Stop hook.
// - The agent runs it inside its session (integrations/common/devteam.mjs) and reports the
//   events and the state (pipeline_update). The office does not launch processes, does not run
//   gates and does not read .devteam/.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { clip } from './roles.js';
import { t as tr } from '../public/i18n.js';
import { MAIN_OFFICE } from './store.js';

const ANNOUNCE_TTL = 12 * 3600_000;
const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
const STAGE_STATUS = new Set(['pending', 'running', 'done', 'failed', 'skipped', 'cancelled']);
const RUN_STATUS = new Set(['queued', 'sent', 'running', 'done', 'failed', 'cancelled']);
export const isBlocking = (issue) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido|cycle|does not exist|no stages|same id|unknown role/.test(issue);

/** What an agent announces about its project, sanitized (it comes from another process). */
export function sanitizeProject(p, cwd) {
  if (!p || typeof p !== 'object') return null;
  const stage = (s) => ({
    id: clip(s?.id, 40), name: clip(s?.name || s?.id, 60), role: clip(s?.role, 20), phase: clip(s?.phase, 30),
    harness: clip(s?.harness, 20), agent: s?.agent ? clip(s.agent, 60) : null, model: s?.model ? clip(s.model, 80) : null,
    needs: Array.isArray(s?.needs) ? s.needs.slice(0, 20).map((n) => clip(n, 40)) : [],
    check: s?.check?.run ? { run: clip(s.check.run, 200), expect: s.check.expect === 'fail' ? 'fail' : 'pass' } : null,
    onFail: s?.onFail?.goto ? { goto: clip(s.onFail.goto, 40), max: Number(s.onFail.max) || 1 } : null,
  });
  return {
    dir: clip(p.dir || cwd, 300),
    name: clip(p.name || path.basename(String(p.dir || cwd || '')), 80),
    pipelines: (Array.isArray(p.pipelines) ? p.pipelines.slice(0, 30) : []).map((pl) => ({
      id: clip(pl?.id, 40), name: clip(pl?.name || pl?.id, 80), description: clip(pl?.description, 300), harness: clip(pl?.harness, 20),
      issues: Array.isArray(pl?.issues) ? pl.issues.slice(0, 10).map((i) => clip(i, 200)) : [],
      stages: (Array.isArray(pl?.stages) ? pl.stages.slice(0, 40) : []).map(stage),
    })).filter((pl) => pl.id),
  };
}

export class PipelineHub extends EventEmitter {
  /** @param company the offices (server/company.js) */
  constructor(company, tasks, { store } = {}) {
    super();
    this.office = company;
    this.tasks = tasks;
    this.store = store; // prompt history (server/store.js)
    this.runs = new Map();
    this.announced = new Map(); // Claude Code sessions (without a permanent connection)
    this.seq = 0;
    tasks.on('change', () => this.changed()); // the catalog depends on who is connected
  }

  /** The Claude Code hook announces its session, its project and its pipelines. */
  announce({ agent, session, cwd, project, office, pane } = {}) {
    if (!session) return { ok: false, error: tr('err.noSessionField') };
    this.announced.set(String(session), { agent: agent || 'claude-code', session: clip(session, 100), cwd: clip(cwd, 300), project: sanitizeProject(project, cwd), at: Date.now() });
    if (!this.office.officeOfSession?.(session)) {
      this.office.bindSession?.(session, (office && this.office.has?.(office) && office) || (pane && this.office.paneOffice?.get(String(pane))) || this.office.officeForPath?.(cwd) || MAIN_OFFICE);
    }
    this.changed();
    return { ok: true };
  }

  /** A session's office (or its path's). */
  officeOf(h) { return this.office.officeOfSession?.(h.session) || this.office.officeForPath?.(h.cwd) || MAIN_OFFICE; }

  /** Agent sessions that announced a project. */
  hosts() {
    const live = this.tasks.liveAgents().filter((c) => c.project).map((c) => ({ agent: c.agent, session: c.session, cwd: c.cwd, project: c.project, live: true }));
    const now = Date.now();
    const hooked = [...this.announced.values()]
      .filter((a) => now - a.at < ANNOUNCE_TTL && !live.some((l) => l.session === a.session))
      .map((a) => ({ ...a, live: false }));
    return [...live, ...hooked];
  }

  /** Projects (by directory) with their pipelines and which sessions can run each one. */
  projects(office) {
    const byDir = new Map();
    for (const h of this.hosts()) {
      if (office && this.officeOf(h) !== office) continue;
      const dir = h.project?.dir || h.cwd;
      if (!dir) continue;
      let p = byDir.get(dir);
      if (!p) { p = { dir, name: h.project?.name || path.basename(dir), hasConfig: false, pipelines: [] }; byDir.set(dir, p); }
      for (const pl of h.project?.pipelines || []) {
        p.hasConfig = true;
        let entry = p.pipelines.find((x) => x.id === pl.id);
        if (!entry) { entry = { ...pl, hosts: [] }; p.pipelines.push(entry); }
        if (!entry.hosts.some((x) => x.session === h.session)) entry.hosts.push({ agent: h.agent, session: h.session, live: h.live });
      }
    }
    return [...byDir.values()];
  }

  /** Asks an agent session to run a pipeline. */
  start({ session, agent, pipeline, task, from, meta } = {}) {
    task = String(task ?? '').trim();
    if (!task) return { ok: false, error: tr('err.taskEmpty') };
    if (task.length > 4000) return { ok: false, error: tr('err.taskTooLong', { n: 4000 }) };
    const hosts = this.hosts().filter((h) => h.project?.pipelines?.some((p) => p.id === pipeline));
    const host = session ? hosts.find((h) => h.session === session) : hosts.find((h) => !agent || h.agent === agent);
    if (!host) return { ok: false, error: session ? tr('err.pipelineSession') : tr('err.pipelineNone', { pipeline }) };
    const pl = host.project.pipelines.find((p) => p.id === pipeline);
    const blocking = (pl.issues || []).filter(isBlocking);
    if (blocking.length) return { ok: false, error: tr('err.pipelineIssues', { issue: blocking[0] }) };

    const run = {
      id: `p${++this.seq}`, pipeline: { id: pl.id, name: pl.name }, project: { dir: host.project.dir, name: host.project.name },
      task, from: clip(from || tr('events.office'), 30), agent: host.agent, session: host.session, office: this.officeOf(host),
      status: host.live ? 'sent' : 'queued', detail: host.live ? tr('run.sent') : tr('task.queuedClaude'),
      stages: pl.stages.map((s) => ({ ...s, status: 'pending', attempts: 0 })), startedAt: Date.now(), endedAt: null, cancelRequested: false,
      agentId: meta?.agentId || null, entry: meta?.entry || `devteam:${pl.id}`,
    };
    this.runs.set(run.id, run);
    if (this.runs.size > 30) {
      const old = [...this.runs.values()].find((r) => ['done', 'failed', 'cancelled'].includes(r.status));
      if (old) this.runs.delete(old.id);
    }
    this.office.ingest('generic', {
      session: 'office', office: run.office, kind: 'dispatch', agent: host.agent, from: run.from,
      text: tr('run.dispatch', { name: pl.name, agent: AGENT_NAME[host.agent] || host.agent, task }),
    });
    if (host.live) this.tasks.sendToSession(host.session, { type: 'pipeline', id: run.id, session: host.session, pipeline: pl.id, task });
    this.changed(run);
    return { ok: true, run: this.#public(run) };
  }

  /** For the Claude Code hook: that session's next queued pipeline. */
  takeForClaude(session) {
    const run = [...this.runs.values()].find((r) => r.session === session && r.status === 'queued');
    if (!run) return null;
    run.status = 'sent';
    run.detail = tr('run.claudeTook');
    this.changed(run);
    return { id: run.id, pipeline: run.pipeline.id, task: run.task };
  }

  /** For the Claude Code hook: that session's pipelines the user cancelled. */
  cancelsFor(session) {
    return [...this.runs.values()].filter((r) => r.session === session && r.cancelRequested && ['sent', 'running'].includes(r.status)).map((r) => r.id);
  }

  /** The agent reports the state (pipeline_update). */
  update(id, status = {}) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, error: tr('err.unknownPipeline') };
    if (RUN_STATUS.has(status.status)) run.status = status.status;
    if (status.detail !== undefined) run.detail = clip(status.detail, 200);
    for (const s of Array.isArray(status.stages) ? status.stages : []) {
      const st = run.stages.find((x) => x.id === s.id);
      if (!st) continue;
      if (STAGE_STATUS.has(s.status)) st.status = s.status;
      if (Number.isInteger(s.attempts)) st.attempts = s.attempts;
    }
    if (['done', 'failed', 'cancelled'].includes(run.status)) run.endedAt ??= Date.now();
    this.changed(run);
    return { ok: true };
  }

  cancel(id) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, error: tr('err.unknownPipeline') };
    if (!['queued', 'sent', 'running'].includes(run.status)) return { ok: false, error: tr('err.pipelineDone', { status: tr(`runStatus.${run.status}`) }) };
    if (run.status === 'queued') {
      run.status = 'cancelled';
      run.detail = tr('run.cancelledEarly');
      run.endedAt = Date.now();
    } else if (!this.tasks.sendToSession(run.session, { type: 'pipeline_cancel', id: run.id })) {
      run.cancelRequested = true; // Claude: its hook picks it up on the next event
      run.detail = tr('run.cancelling');
    }
    this.changed(run);
    return { ok: true };
  }

  #public(r) {
    return {
      id: r.id, status: r.status, detail: r.detail, task: r.task, from: r.from,
      pipeline: r.pipeline, project: r.project, agent: r.agent, session: r.session, office: r.office, startedAt: r.startedAt, endedAt: r.endedAt,
      stages: r.stages.map((s) => ({ id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model, status: s.status, attempts: s.attempts })),
    };
  }

  #save(r) {
    try {
      this.store?.savePrompt({ id: `${this.tasks.boot}-${r.id}`, agentId: r.agentId, agent: r.agent, entry: r.entry, text: `${r.pipeline.name}: ${r.task}`, session: r.session, mode: 'pipeline', cwd: r.project.dir, status: r.status, detail: r.detail });
    } catch { /* the history cannot break the pipeline */ }
  }

  changed(run) {
    if (run) this.#save(run);
    this.emit('change', this.snapshot());
  }
  /** @param office only that office's (without an office: everything) */
  snapshot(office) {
    return { runs: [...this.runs.values()].filter((r) => !office || (r.office || MAIN_OFFICE) === office).slice(-10).map((r) => this.#public(r)), projects: this.projects(office) };
  }
}
