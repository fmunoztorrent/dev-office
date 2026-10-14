// El "encargo" que se arma al hacer clic en la pizarra: proyecto, pipeline (o tarea directa),
// quién orquesta, a qué agente va y la tarea. Lo comparten la vista web y la terminal.

import { taskTargets, AGENT_NAME } from './targets.js';

/** Proyecto por defecto: el de la sesión más reciente, si no el primero con .devteam. */
export function defaultProject(projects, sessions) {
  const recent = [...sessions].sort((a, b) => b.lastAt - a.lastAt).find((s) => s.cwd && projects.some((p) => p.dir === s.cwd));
  if (recent) return projects.findIndex((p) => p.dir === recent.cwd);
  return Math.max(0, projects.findIndex((p) => p.hasConfig));
}

/**
 * Opciones del diálogo según lo elegido.
 * @param sel { project, pipeline, strategy, target } índices
 */
export function briefOptions({ projects = [], tasks = {}, sessions = [] }, sel) {
  const project = projects[sel.project] || null;
  const pipelines = [{ id: null, label: 'Tarea directa (sin pipeline)' }, ...(project?.pipelines || []).map((p) => ({ ...p, label: p.name }))];
  const pipeline = pipelines[sel.pipeline]?.id ? pipelines[sel.pipeline] : null;
  const strategies = pipeline
    ? [
      { id: 'office', label: 'La oficina: un agente por etapa' },
      { id: 'agent', label: `El orquestador: ${AGENT_NAME[pipeline.orchestrator?.harness] || 'agente'} con sus subagentes` },
    ]
    : [];
  const strategy = pipeline ? strategies[sel.strategy]?.id || 'office' : null;

  // A quién va: para una tarea directa, cualquier agente; para "el orquestador", su harness.
  let targets = [];
  if (!pipeline || strategy === 'agent') {
    targets = taskTargets(tasks, sessions).map((t) => (t.mode === 'launch' && project
      ? { ...t, label: `Nuevo ${AGENT_NAME[t.agent] || t.agent} en ${project.name}`, cwd: project.dir }
      : t));
    if (pipeline) targets = targets.filter((t) => t.agent === pipeline.orchestrator?.harness);
  }
  return { project, pipelines, pipeline, strategies, strategy, targets, target: targets[sel.target] || null, stages: pipeline?.stages || [] };
}

/** Qué falta para poder enviar (o null si está listo). */
export function briefProblem(opts, text) {
  if (!String(text || '').trim()) return 'Escribe la tarea';
  if (opts.pipeline?.issues?.some((i) => /ciclo|no existe|no tiene etapas|mismo id/.test(i))) return `El pipeline tiene errores: ${opts.pipeline.issues[0]}`;
  if ((!opts.pipeline || opts.strategy === 'agent') && !opts.target) {
    return opts.pipeline ? `No hay ningún ${AGENT_NAME[opts.pipeline.orchestrator?.harness] || 'orquestador'} disponible` : 'No hay a quién enviarla: conecta un agente o instala su CLI';
  }
  return null;
}

/** El mensaje WebSocket que dispara el encargo. */
export function briefMessage(opts, text, from) {
  text = String(text).trim();
  if (!opts.pipeline) {
    const t = opts.target;
    return { type: 'task', text, agent: t.agent, session: t.session, mode: t.mode, cwd: t.mode === 'launch' ? t.cwd : undefined, from };
  }
  return {
    type: 'pipeline_start', dir: opts.project.dir, pipeline: opts.pipeline.id, task: text, strategy: opts.strategy, from,
    target: opts.strategy === 'agent' ? { agent: opts.target.agent, session: opts.target.session, mode: opts.target.mode } : undefined,
  };
}

export const projectLabel = (p) => (p ? `${p.name}${p.hasConfig ? '' : ' (sin .devteam)'} — ${p.dir.replace(/^\/Users\/[^/]+/, '~')}` : '');

/** Campos del diálogo, en orden, según lo elegido (la terminal navega por ellos). */
export function briefFields(opts) {
  const fields = ['project', 'pipeline'];
  if (opts.pipeline) fields.push('strategy');
  if (!opts.pipeline || opts.strategy === 'agent') fields.push('target');
  fields.push('task');
  return fields;
}

/** Cambia la opción de un campo (delta ±1) y reinicia lo que depende de él. */
export function briefCycle(sel, field, delta, { projects, opts }) {
  const wrap = (i, n) => (n ? (i + delta + n) % n : 0);
  if (field === 'project') return { project: wrap(sel.project, projects.length), pipeline: 0, strategy: 0, target: 0 };
  if (field === 'pipeline') {
    const pipeline = wrap(sel.pipeline, opts.pipelines.length);
    return { ...sel, pipeline, strategy: opts.pipelines[pipeline]?.strategy === 'agent' ? 1 : 0, target: 0 };
  }
  if (field === 'strategy') return { ...sel, strategy: wrap(sel.strategy, opts.strategies.length), target: 0 };
  if (field === 'target') return { ...sel, target: wrap(sel.target, opts.targets.length) };
  return sel;
}
