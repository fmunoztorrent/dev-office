// Pipelines en la oficina: sólo un RELAY. El juego es el frontend y el agente es el backend.
//
// - Los agentes anuncian qué pipelines pueden correr en su proyecto: Pi y OpenCode al
//   registrarse por WebSocket, Claude Code desde su hook (POST /v1/agents/announce).
// - Al arrancar un pipeline desde la pizarra, la oficina se lo pide a la sesión de ese agente
//   ({ type: 'pipeline', id, pipeline, task }); a Claude Code se lo entrega su hook Stop.
// - El agente lo ejecuta dentro de su sesión (integrations/common/devteam.mjs) y reporta los
//   eventos y el estado (pipeline_update). La oficina no lanza procesos, no corre gates y no
//   lee .devteam/.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { clip } from './roles.js';

const ANNOUNCE_TTL = 12 * 3600_000;
const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
const STAGE_STATUS = new Set(['pending', 'running', 'done', 'failed', 'skipped', 'cancelled']);
const RUN_STATUS = new Set(['queued', 'sent', 'running', 'done', 'failed', 'cancelled']);
export const isBlocking = (issue) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido/.test(issue);

/** Lo que un agente anuncia de su proyecto, saneado (viene de otro proceso). */
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
  constructor(office, tasks) {
    super();
    this.office = office;
    this.tasks = tasks;
    this.runs = new Map();
    this.announced = new Map(); // sesiones de Claude Code (sin conexión permanente)
    this.seq = 0;
    tasks.on('change', () => this.changed()); // el catálogo depende de quién está conectado
  }

  /** El hook de Claude Code anuncia su sesión, su proyecto y sus pipelines. */
  announce({ agent, session, cwd, project } = {}) {
    if (!session) return { ok: false, error: 'falta session' };
    this.announced.set(String(session), { agent: agent || 'claude-code', session: clip(session, 100), cwd: clip(cwd, 300), project: sanitizeProject(project, cwd), at: Date.now() });
    this.changed();
    return { ok: true };
  }

  /** Sesiones de agentes que anunciaron un proyecto. */
  hosts() {
    const live = this.tasks.liveAgents().filter((c) => c.project).map((c) => ({ agent: c.agent, session: c.session, cwd: c.cwd, project: c.project, live: true }));
    const now = Date.now();
    const hooked = [...this.announced.values()]
      .filter((a) => now - a.at < ANNOUNCE_TTL && !live.some((l) => l.session === a.session))
      .map((a) => ({ ...a, live: false }));
    return [...live, ...hooked];
  }

  /** Proyectos (por directorio) con sus pipelines y qué sesiones pueden correr cada uno. */
  projects() {
    const byDir = new Map();
    for (const h of this.hosts()) {
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

  /** Pide a una sesión de agente que corra un pipeline. */
  start({ session, agent, pipeline, task, from } = {}) {
    task = String(task ?? '').trim();
    if (!task) return { ok: false, error: 'la tarea está vacía' };
    if (task.length > 4000) return { ok: false, error: 'la tarea supera 4000 caracteres' };
    const hosts = this.hosts().filter((h) => h.project?.pipelines?.some((p) => p.id === pipeline));
    const host = session ? hosts.find((h) => h.session === session) : hosts.find((h) => !agent || h.agent === agent);
    if (!host) return { ok: false, error: session ? 'esa sesión no está conectada o no tiene ese pipeline' : `ningún agente conectado tiene el pipeline "${pipeline}"` };
    const pl = host.project.pipelines.find((p) => p.id === pipeline);
    const blocking = (pl.issues || []).filter(isBlocking);
    if (blocking.length) return { ok: false, error: `el pipeline tiene errores: ${blocking[0]}` };

    const run = {
      id: `p${++this.seq}`, pipeline: { id: pl.id, name: pl.name }, project: { dir: host.project.dir, name: host.project.name },
      task, from: clip(from || 'Oficina', 30), agent: host.agent, session: host.session,
      status: host.live ? 'sent' : 'queued', detail: host.live ? 'enviado al agente' : 'se entrega cuando Claude termine su turno',
      stages: pl.stages.map((s) => ({ ...s, status: 'pending', attempts: 0 })), startedAt: Date.now(), endedAt: null, cancelRequested: false,
    };
    this.runs.set(run.id, run);
    if (this.runs.size > 30) {
      const old = [...this.runs.values()].find((r) => ['done', 'failed', 'cancelled'].includes(r.status));
      if (old) this.runs.delete(old.id);
    }
    this.office.ingest('generic', {
      session: 'office', kind: 'dispatch', agent: host.agent, from: run.from,
      text: `Pipeline «${pl.name}» para ${AGENT_NAME[host.agent] || host.agent}: ${task}`,
    });
    if (host.live) this.tasks.sendToSession(host.session, { type: 'pipeline', id: run.id, session: host.session, pipeline: pl.id, task });
    this.changed();
    return { ok: true, run: this.#public(run) };
  }

  /** Para el hook de Claude Code: el siguiente pipeline en cola de esa sesión. */
  takeForClaude(session) {
    const run = [...this.runs.values()].find((r) => r.session === session && r.status === 'queued');
    if (!run) return null;
    run.status = 'sent';
    run.detail = 'Claude lo tomó al terminar su turno';
    this.changed();
    return { id: run.id, pipeline: run.pipeline.id, task: run.task };
  }

  /** Para el hook de Claude Code: pipelines de esa sesión que el usuario canceló. */
  cancelsFor(session) {
    return [...this.runs.values()].filter((r) => r.session === session && r.cancelRequested && ['sent', 'running'].includes(r.status)).map((r) => r.id);
  }

  /** El agente informa el estado (pipeline_update). */
  update(id, status = {}) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, error: 'pipeline desconocido' };
    if (RUN_STATUS.has(status.status)) run.status = status.status;
    if (status.detail !== undefined) run.detail = clip(status.detail, 200);
    for (const s of Array.isArray(status.stages) ? status.stages : []) {
      const st = run.stages.find((x) => x.id === s.id);
      if (!st) continue;
      if (STAGE_STATUS.has(s.status)) st.status = s.status;
      if (Number.isInteger(s.attempts)) st.attempts = s.attempts;
    }
    if (['done', 'failed', 'cancelled'].includes(run.status)) run.endedAt ??= Date.now();
    this.changed();
    return { ok: true };
  }

  cancel(id) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, error: 'pipeline desconocido' };
    if (!['queued', 'sent', 'running'].includes(run.status)) return { ok: false, error: `el pipeline ya está ${run.status}` };
    if (run.status === 'queued') {
      run.status = 'cancelled';
      run.detail = 'cancelado antes de empezar';
      run.endedAt = Date.now();
    } else if (!this.tasks.sendToSession(run.session, { type: 'pipeline_cancel', id: run.id })) {
      run.cancelRequested = true; // Claude: lo recoge su hook en el siguiente evento
      run.detail = 'cancelando…';
    }
    this.changed();
    return { ok: true };
  }

  #public(r) {
    return {
      id: r.id, status: r.status, detail: r.detail, task: r.task, from: r.from,
      pipeline: r.pipeline, project: r.project, agent: r.agent, session: r.session, startedAt: r.startedAt, endedAt: r.endedAt,
      stages: r.stages.map((s) => ({ id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model, status: s.status, attempts: s.attempts })),
    };
  }

  changed() { this.emit('change', this.snapshot()); }
  snapshot() { return { runs: [...this.runs.values()].slice(-10).map((r) => this.#public(r)), projects: this.projects() }; }
}
