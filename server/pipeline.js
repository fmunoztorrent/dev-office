// Pipelines: una tarea que recorre varias etapas, cada una en manos de un rol del equipo
// con su propio agente y modelo. Dos estrategias:
//
// - "office": la oficina orquesta. Lanza un proceso del harness por etapa (en paralelo cuando
//   las dependencias lo permiten), lee su salida JSON y la convierte en eventos del juego,
//   aplica los gates (`check`) y los bucles (`onFail`), y pasa los resultados a las etapas
//   siguientes.
// - "agent": el agente orquesta. La oficina compila el pipeline en una instrucción y se la
//   envía a un agente (p. ej. Pi con su extensión de subagentes), que delega cada etapa. Lo
//   que pasa dentro llega por sus hooks/extensiones como cualquier otra sesión.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject, expandHome } from './project.js';
import { HARNESSES, which } from './harness/index.js';
import { clip } from './roles.js';

export const ROLE_NAME = { po: 'Product Owner', analyst: 'Analista de negocio', manager: 'Manager', tl: 'Tech Lead', qa: 'QA', backend: 'Backend', frontend: 'Frontend', designer: 'Diseñadora' };
const OUTPUT_MAX = 6000;
const TAIL_LINES = 30;
const SUB_TOOLS = new Set(['task', 'agent', 'subagent']);

/** Lo que se le manda a la interfaz de un pipeline (sin los system prompts de los agentes). */
export function publicPipeline(p) {
  return {
    id: p.id, name: p.name, description: p.description, strategy: p.strategy, harness: p.harness,
    orchestrator: p.orchestrator, issues: p.issues,
    stages: p.stages.map((s) => ({
      id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model,
      native: s.native, needs: s.needs, check: s.check, onFail: s.onFail,
    })),
  };
}

export function publicProject(p) {
  return {
    dir: p.dir, name: p.name, hasConfig: p.hasConfig, errors: p.errors, harnesses: p.harnesses,
    pipelines: p.pipelines.map(publicPipeline),
    agents: Object.fromEntries(Object.entries(p.agents).map(([h, list]) => [h, list.map((a) => ({ name: a.name, description: a.description, model: a.model, scope: a.scope }))])),
  };
}

/** Mapa nombre de agente → rol, para que los subagentes caigan en el personaje correcto. */
function agentRoles(pipeline) {
  const map = {};
  for (const s of pipeline.stages) if (s.agent) map[s.agent.toLowerCase()] ??= s.role;
  return map;
}

function render(template, vars) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

// ------------------------------------------------------------------------------------------

export class PipelineHub extends EventEmitter {
  constructor(office, tasks, { config = {} } = {}) {
    super();
    this.office = office;
    this.tasks = tasks;
    this.config = config;
    this.runs = new Map();
    this.streamed = new Map(); // DEV_TEAM_OFFICE_RUN de cada etapa en curso → run
    this.seq = 0;
    office.on('event', (ev) => { for (const r of this.runs.values()) r.onOfficeEvent?.(ev); });
    tasks.on('change', () => { for (const r of this.runs.values()) r.onTasksChange?.(); });
  }

  /** Directorios de proyecto conocidos: config, directorio por defecto, sesiones y agentes conectados. */
  knownDirs() {
    const dirs = [
      ...(this.config.projects || []).map(expandHome),
      this.tasks.defaultCwd,
      ...[...this.office.sessions.values()].map((s) => s.cwd),
      ...this.tasks.snapshot().agents.map((a) => a.cwd),
      ...[...this.runs.values()].map((r) => r.project.dir),
    ];
    const seen = new Set();
    return dirs.filter((d) => {
      if (!d || !path.isAbsolute(d) || seen.has(d)) return false;
      seen.add(d);
      return fs.statSync(d, { throwIfNoEntry: false })?.isDirectory();
    }).slice(0, 20);
  }

  projects() {
    return this.knownDirs().map((d) => publicProject(loadProject(d))).sort((a, b) => Number(b.hasConfig) - Number(a.hasConfig));
  }

  project(dir) {
    if (!dir || !fs.statSync(expandHome(dir), { throwIfNoEntry: false })?.isDirectory()) return null;
    return publicProject(loadProject(dir));
  }

  /**
   * @param {{ dir, pipeline, task, strategy?, target?, from? }} req
   *   target (estrategia agent): { agent, session?, mode: 'session' | 'launch' }
   */
  start({ dir, pipeline: pipelineId, task, strategy, target = {}, from } = {}) {
    task = String(task ?? '').trim();
    if (!task) return { ok: false, error: 'la tarea está vacía' };
    if (!dir || !fs.statSync(expandHome(dir), { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: 'el proyecto no existe' };
    const project = loadProject(dir);
    const pipeline = project.pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return { ok: false, error: `no hay un pipeline "${pipelineId}" en ${project.name}` };
    const blocking = pipeline.issues.filter((i) => /ciclo|no existe|no tiene etapas|mismo id/.test(i));
    if (blocking.length) return { ok: false, error: blocking.join('; ') };

    const Run = (strategy || pipeline.strategy) === 'agent' ? AgentRun : OfficeRun;
    const run = new Run(this, project, pipeline, task, { target, from: clip(from || 'Oficina', 30) });
    this.runs.set(run.id, run);
    if (this.runs.size > 30) {
      const old = [...this.runs.values()].find((r) => r.status !== 'running');
      if (old) this.runs.delete(old.id);
    }
    const out = run.start();
    if (out?.ok === false) { this.runs.delete(run.id); return out; }
    this.changed();
    return { ok: true, run: run.toJSON() };
  }

  cancel(id) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, error: 'pipeline desconocido' };
    if (run.status !== 'running') return { ok: false, error: `el pipeline ya está ${run.status}` };
    run.cancel();
    return { ok: true };
  }

  /** ¿Este DEV_TEAM_OFFICE_RUN es una etapa cuya salida ya estamos leyendo? (evita eventos dobles) */
  isStreamed(tag) { return !!tag && this.streamed.has(String(tag)); }

  changed() { this.emit('change', this.snapshot()); }
  snapshot() { return { runs: [...this.runs.values()].slice(-10).map((r) => r.toJSON()) }; }
  stopAll() { for (const r of this.runs.values()) if (r.status === 'running') r.cancel(); }
}

// ------------------------------------------------------------------------------------------

class BaseRun {
  session = null;
  taskId = null;

  constructor(hub, project, pipeline, task, { from }) {
    this.hub = hub;
    this.id = `p${++hub.seq}`;
    this.project = project;
    this.pipeline = pipeline;
    this.task = task;
    this.from = from;
    this.status = 'running';
    this.detail = '';
    this.startedAt = Date.now();
    this.endedAt = null;
    this.stages = pipeline.stages.map((s) => ({ ...s, status: 'pending', attempts: 0, loops: 0, output: '', failure: '', detail: '' }));
  }

  stage(id) { return this.stages.find((s) => s.id === id); }

  toJSON() {
    return {
      id: this.id, strategy: this.strategy, status: this.status, detail: this.detail, task: this.task, from: this.from,
      pipeline: { id: this.pipeline.id, name: this.pipeline.name }, project: { dir: this.project.dir, name: this.project.name },
      session: this.session, taskId: this.taskId, startedAt: this.startedAt, endedAt: this.endedAt,
      stages: this.stages.map((s) => ({
        id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model,
        status: s.status, attempts: s.attempts, detail: s.detail,
      })),
    };
  }
}

/** La oficina orquesta: un proceso del harness por etapa. */
class OfficeRun extends BaseRun {
  strategy = 'office';

  constructor(...args) {
    super(...args);
    this.session = `pipe-${this.id}`;
    this.procs = new Set();
    this.lastRole = null;
  }

  emit(ev) {
    this.hub.office.ingest('generic', { source: ev.source || 'pipeline', session: this.session, cwd: this.project.dir, ...ev });
  }

  start() {
    const missing = [...new Set(this.stages.map((s) => s.harness))].filter((h) => !this.bin(h));
    if (missing.length) {
      return { ok: false, error: `no encuentro ${missing.map((h) => `"${HARNESSES[h].bin}"`).join(', ')} en el PATH` };
    }
    this.hub.office.setAgentRoles(this.session, agentRoles(this.pipeline));
    this.emit({ kind: 'session_start' });
    this.emit({ kind: 'task', text: `${this.pipeline.name}: ${this.task}` });
    this.todos();
    queueMicrotask(() => this.tick());
    return { ok: true };
  }

  bin(harness) {
    const opts = this.project.team.harnessOptions?.[harness] || {};
    return which(expandHome(opts.bin || HARNESSES[harness].bin));
  }

  todos() {
    const status = { pending: 'pending', running: 'in_progress', done: 'completed' };
    this.emit({
      kind: 'todos',
      todos: this.stages.map((s) => ({ id: s.id, content: `${s.name} · ${ROLE_NAME[s.role]}`, status: status[s.status] || 'pending' })),
    });
    this.hub.changed();
  }

  tick() {
    if (this.status !== 'running') return;
    const running = this.stages.filter((s) => s.status === 'running').length;
    const ready = this.stages.filter((s) => s.status === 'pending' && s.needs.every((n) => this.stage(n)?.status === 'done'));
    for (const s of ready.slice(0, Math.max(0, this.pipeline.maxParallel - running))) this.runStage(s);
    if (!this.stages.some((s) => s.status === 'running')) {
      if (this.stages.every((s) => s.status === 'done')) this.finish('done', `Pipeline «${this.pipeline.name}» terminado`);
      else if (!ready.length) this.finish('failed', 'el pipeline quedó trabado: hay etapas que nunca podrán empezar');
    }
  }

  promptFor(st) {
    const previous = st.needs.map((id) => {
      const s = this.stage(id);
      return `### ${s.name} (${ROLE_NAME[s.role]})\n${s.output || '(sin resumen)'}`;
    }).join('\n\n');
    const vars = { task: this.task, project: this.project.name, previous, failure: st.failure };
    for (const s of this.stages) vars[`${s.id}.output`] = s.output;
    const gate = st.check
      ? `\n\nAl terminar se ejecutará \`${st.check.run}\` y debe ${st.check.expect === 'pass' ? 'pasar' : 'FALLAR: es la fase RED, los tests todavía no deben pasar'}.`
      : '';
    let prompt = st.prompt
      ? render(st.prompt, vars)
      : `Tarea: ${this.task}\n\nEres ${ROLE_NAME[st.role]} en el pipeline «${this.pipeline.name}» del proyecto ${this.project.name}. Tu etapa: «${st.name}» (fase ${st.phase}).`;
    if (previous && !/\{\{\s*previous\s*\}\}/.test(st.prompt || '')) prompt += `\n\nResultados de las etapas anteriores:\n\n${previous}`;
    if (st.failure && !/\{\{\s*failure\s*\}\}/.test(st.prompt || '')) prompt += `\n\nEl intento anterior no pasó. Corrige esto:\n${st.failure}`;
    return `${prompt}${gate}\n\nCuando termines, resume en pocas líneas qué hiciste (archivos, decisiones, resultados).`;
  }

  runStage(st) {
    st.status = 'running';
    st.attempts++;
    st.detail = st.attempts > 1 ? `intento ${st.attempts}` : '';
    const h = HARNESSES[st.harness];
    this.emit({
      kind: 'phase', role: st.role, phase: st.phase, from: this.lastRole || undefined,
      text: `${st.name}${st.agent ? ` · ${st.agent}` : ''}${st.model ? ` (${st.model})` : ''}`,
    });
    this.lastRole = st.role;
    this.todos();

    let systemPromptFile = null;
    if (st.agentPrompt && !st.native) {
      const dir = path.join(os.tmpdir(), 'dev-team-office');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      systemPromptFile = path.join(dir, `${this.id}-${st.id}.md`);
      fs.writeFileSync(systemPromptFile, st.agentPrompt, { mode: 0o600 });
    }
    const opts = this.project.team.harnessOptions?.[st.harness] || {};
    const args = h.command({
      prompt: this.promptFor(st), model: st.model, thinking: st.thinking, tools: st.tools, agent: st.agent, native: st.native,
      systemPromptFile, agentPrompt: st.agentPrompt, extraArgs: Array.isArray(opts.args) ? opts.args : h.defaultArgs,
    });
    const tag = `${this.id}-${st.id}-${st.attempts}`;
    this.hub.streamed.set(tag, this);

    let child;
    try {
      child = spawn(this.bin(st.harness), args, {
        cwd: this.project.dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
        env: { ...process.env, DEV_TEAM_OFFICE_RUN: tag, DEV_TEAM_OFFICE_SESSION: this.session, ...(this.hub.tasks.officeUrl ? { DEV_TEAM_OFFICE_URL: this.hub.tasks.officeUrl } : {}) },
      });
    } catch (err) {
      return this.fail(st, err.message);
    }
    this.procs.add(child);
    const parser = h.createParser();
    const subRoles = new Map(); // subagente (tool_use_id) → rol, para sus herramientas internas
    const tail = [];
    let buf = '';
    const onLine = (line) => {
      if (!line.trim()) return;
      let obj;
      try { obj = JSON.parse(line); } catch { tail.push(clip(line, 300)); if (tail.length > TAIL_LINES) tail.shift(); return; }
      for (const ev of parser.line(obj)) {
        let role = subRoles.get(ev.parentToolUseId) || st.role;
        if (SUB_TOOLS.has(String(ev.tool).toLowerCase())) {
          const name = String(ev.input?.subagent_type || ev.input?.agent || ev.input?.tasks?.[0]?.agent || '').toLowerCase();
          role = agentRoles(this.pipeline)[name] || null; // la oficina lo resuelve por el nombre del agente
          if (role && ev.kind === 'tool_start') subRoles.set(ev.toolUseId, role);
        }
        this.emit({ ...ev, parentToolUseId: undefined, source: st.harness, role: role || undefined });
      }
    };
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(onLine);
    });
    child.stderr.on('data', (d) => {
      for (const l of d.toString('utf8').split('\n')) if (l.trim()) { tail.push(clip(l, 300)); if (tail.length > TAIL_LINES) tail.shift(); }
    });
    child.on('error', (err) => tail.push(err.message));
    child.on('close', (code, signal) => {
      if (buf) onLine(buf);
      this.procs.delete(child);
      setTimeout(() => this.hub.streamed.delete(tag), 5000).unref?.(); // hooks rezagados
      if (systemPromptFile) fs.rm(systemPromptFile, { force: true }, () => {});
      if (this.status !== 'running') return;
      st.output = clip(parser.output() || tail.slice(-8).join('\n'), OUTPUT_MAX);
      if (code !== 0) return this.fail(st, `${h.label} terminó ${signal ? `por ${signal}` : `con código ${code}`}${tail.length ? `: ${tail.slice(-3).join(' · ')}` : ''}`);
      if (st.check) return this.runCheck(st);
      this.done(st);
    });
  }

  runCheck(st) {
    const { run, expect, timeout } = st.check;
    const id = `${this.id}-${st.id}-check-${st.attempts}`;
    this.emit({ kind: 'tool_start', tool: 'Bash', input: { command: run }, toolUseId: id, role: st.role });
    const child = spawn('/bin/sh', ['-c', run], { cwd: this.project.dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: process.env });
    this.procs.add(child);
    const tail = [];
    const collect = (d) => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) { tail.push(clip(l, 300)); if (tail.length > TAIL_LINES) tail.shift(); } };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }, timeout * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      this.procs.delete(child);
      if (this.status !== 'running') return;
      const passed = code === 0;
      this.emit({ kind: 'tool_end', tool: 'Bash', input: { command: run }, toolUseId: id, role: st.role, ok: passed });
      const ok = expect === 'pass' ? passed : !passed;
      if (ok) return this.done(st);
      this.fail(st, `\`${run}\` ${passed ? 'pasó, y en esta etapa debía fallar' : 'falló'}:\n${tail.slice(-15).join('\n')}`);
    });
  }

  done(st) {
    st.status = 'done';
    st.failure = '';
    st.detail = '';
    this.emit({ kind: 'stage_end', role: st.role, ok: true, text: `✔ ${st.name}` });
    this.todos();
    this.tick();
  }

  fail(st, reason) {
    st.detail = clip(reason, 200);
    this.emit({ kind: 'stage_end', role: st.role, ok: false, text: `✖ ${st.name}: ${clip(reason, 120)}` });
    const target = st.onFail && this.stage(st.onFail.goto);
    if (target && st.loops < st.onFail.max) {
      st.loops++;
      // Se repite desde `goto`: esa etapa y todo lo que depende de ella vuelve a pendiente.
      const reset = new Set([target.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const s of this.stages) if (!reset.has(s.id) && s.needs.some((n) => reset.has(n))) { reset.add(s.id); grew = true; }
      }
      for (const s of this.stages) if (reset.has(s.id) && s.status !== 'running') s.status = 'pending';
      target.failure = reason;
      st.status = 'pending';
      this.todos();
      return this.tick();
    }
    st.status = 'failed';
    this.finish('failed', `${st.name}: ${clip(reason, 160)}`);
  }

  finish(status, detail) {
    if (this.status !== 'running') return;
    this.status = status;
    this.detail = clip(detail, 200);
    this.endedAt = Date.now();
    for (const s of this.stages) if (s.status === 'pending') s.status = 'skipped';
    for (const c of this.procs) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* ya terminó */ } }
    if (status === 'done') this.emit({ kind: 'done', text: detail });
    else this.emit({ kind: 'error', role: 'manager', text: `Pipeline ${status === 'cancelled' ? 'cancelado' : 'detenido'}: ${detail}` });
    this.todos();
  }

  cancel() {
    for (const s of this.stages) if (s.status === 'running') s.status = 'cancelled';
    this.finish('cancelled', 'cancelado desde la oficina');
  }
}

/** El agente orquesta: la oficina le manda el pipeline compilado como instrucción. */
class AgentRun extends BaseRun {
  strategy = 'agent';

  constructor(hub, project, pipeline, task, { target, from }) {
    super(hub, project, pipeline, task, { from });
    this.target = target || {};
  }

  start() {
    const harness = HARNESSES[this.target.agent] ? this.target.agent : this.pipeline.orchestrator.harness;
    const out = this.hub.tasks.submit({
      text: compileInstruction(this.project, this.pipeline, this.task, harness),
      title: `${this.pipeline.name}: ${this.task}`,
      agent: harness,
      session: this.target.session,
      mode: this.target.mode === 'launch' ? 'launch' : 'session',
      cwd: this.project.dir,
      from: this.from,
      meta: { agentRoles: agentRoles(this.pipeline) },
    });
    if (!out.ok) return out;
    this.taskId = out.task.id;
    this.onTasksChange();
    return { ok: true };
  }

  onTasksChange() {
    const t = this.hub.tasks.tasks.get(this.taskId);
    if (!t || this.status !== 'running') return;
    this.session = t.session || this.session;
    this.detail = t.detail;
    if (['done', 'failed', 'cancelled'].includes(t.status)) {
      this.status = t.status;
      this.endedAt = Date.now();
      if (t.status === 'done') for (const s of this.stages) if (s.status !== 'done') s.status = s.status === 'running' ? 'done' : s.status;
    }
    this.hub.changed();
  }

  // Lo que el orquestador hace adentro marca las etapas: subagentes y fases por rol.
  onOfficeEvent(ev) {
    if (this.status !== 'running' || !this.session || ev.session !== this.session) return;
    const byAgent = (name) => this.stages.find((s) => s.agent && s.agent.toLowerCase() === String(name || '').toLowerCase() && s.status !== 'done');
    let st = null;
    if (ev.kind === 'subagent_start') { st = byAgent(ev.agentType); if (st) st.status = 'running'; }
    else if (ev.kind === 'subagent_end') { st = byAgent(ev.agentType); if (st) st.status = 'done'; }
    else if (ev.kind === 'phase') {
      st = this.stages.find((s) => s.role === ev.role && s.phase === ev.phase && s.status === 'pending');
      if (st) { for (const s of this.stages) if (s.status === 'running' && s.role !== st.role) s.status = 'done'; st.status = 'running'; }
    }
    if (st) this.hub.changed();
  }

  cancel() {
    this.hub.tasks.cancel(this.taskId);
    this.status = 'cancelled';
    this.endedAt = Date.now();
    this.hub.changed();
  }
}

/** El pipeline como instrucción para un agente orquestador. */
export function compileInstruction(project, pipeline, task, harness) {
  const h = HARNESSES[harness] || HARNESSES.pi;
  const lines = [
    `Ejecuta el pipeline «${pipeline.name}» del proyecto ${project.name} para esta tarea:`,
    '',
    task,
    '',
  ];
  if (pipeline.description) lines.push(pipeline.description, '');
  lines.push(
    'Orquesta tú las etapas: delega cada una en su subagente y pásale lo que necesite de las etapas anteriores.',
    'Respeta las dependencias; las etapas que no dependen entre sí pueden ir en paralelo.',
    '',
    'Etapas:',
  );
  pipeline.stages.forEach((s, i) => {
    lines.push(`${i + 1}. «${s.name}» (id ${s.id}): ${ROLE_NAME[s.role]}, fase ${s.phase}.`);
    lines.push(`   Cómo: ${h.delegation(s.agent)}${s.model ? ` · modelo ${s.model}` : ''}.`);
    if (s.needs.length) lines.push(`   Depende de: ${s.needs.join(', ')}.`);
    if (s.prompt) lines.push(`   Instrucción: ${render(s.prompt, { task, project: project.name, previous: '(resultados de las etapas anteriores)', failure: '' })}`);
    if (s.check) {
      lines.push(`   Gate: ejecuta \`${s.check.run}\`; debe ${s.check.expect === 'pass' ? 'pasar' : 'fallar (fase RED)'}.${s.onFail ? ` Si no se cumple, vuelve a «${s.onFail.goto}» (máximo ${s.onFail.max} veces).` : ''}`);
    }
  });
  lines.push(
    '',
    'Si tienes el skill dev-team-office, antes de cada etapa avisa a la oficina con su rol y su fase (por ejemplo: phase qa red).',
    'Al terminar, resume el resultado de cada etapa.',
  );
  return lines.join('\n');
}
