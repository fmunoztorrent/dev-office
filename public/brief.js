// El "encargo" que se arma al hacer clic en la pizarra: proyecto, pipeline (o tarea directa), a
// qué sesión de agente va y la tarea. Lo comparten la vista web y la terminal.
//
// La oficina es el frontend: los proyectos y pipelines son los que anuncian los agentes
// conectados, y el pipeline lo ejecuta la sesión de agente elegida.

import { taskTargets, AGENT_NAME } from './targets.js';

const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() || p : '');

/** Proyecto por defecto: el de la sesión más reciente, si no el primero con pipelines. */
export function defaultProject(projects, sessions) {
  const recent = [...sessions].sort((a, b) => b.lastAt - a.lastAt).find((s) => s.cwd && projects.some((p) => p.dir === s.cwd));
  if (recent) return projects.findIndex((p) => p.dir === recent.cwd);
  return Math.max(0, projects.findIndex((p) => p.hasConfig));
}

/**
 * Opciones del diálogo según lo elegido.
 * @param sel { project, pipeline, target } índices
 */
export function briefOptions({ projects = [], tasks = {}, sessions = [] }, sel) {
  const project = projects[sel.project] || null;
  const pipelines = [{ id: null, label: 'Tarea directa (sin pipeline)' }, ...(project?.pipelines || []).map((p) => ({ ...p, label: p.name }))];
  const pipeline = pipelines[sel.pipeline]?.id ? pipelines[sel.pipeline] : null;

  // A quién va: un pipeline, a una sesión que lo anunció (lo ejecuta ella); una tarea directa,
  // a cualquier sesión o a una sesión nueva en el proyecto elegido.
  const targets = pipeline
    ? (pipeline.hosts || []).map((h) => ({
      label: `${AGENT_NAME[h.agent] || h.agent} · ${base(project.dir)} · ${h.live ? 'sesión abierta' : 'al terminar su turno'}`,
      agent: h.agent, session: h.session, mode: 'session',
    }))
    : taskTargets(tasks, sessions).map((t) => (t.mode === 'launch' && project
      ? { ...t, label: `Nuevo ${AGENT_NAME[t.agent] || t.agent} en ${project.name}`, cwd: project.dir }
      : t));
  return { project, pipelines, pipeline, targets, target: targets[sel.target] || null, stages: pipeline?.stages || [] };
}

/** Qué falta para poder enviar (o null si está listo). */
export function briefProblem(opts, text) {
  if (!String(text || '').trim()) return 'Escribe la tarea';
  if (opts.pipeline?.issues?.some((i) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido/.test(i))) return `El pipeline tiene errores: ${opts.pipeline.issues[0]}`;
  if (!opts.target) {
    return opts.pipeline
      ? 'Ninguna sesión de agente conectada tiene este pipeline'
      : 'No hay a quién enviarla: abre Pi, OpenCode o Claude Code con su integración (dev-team-office install)';
  }
  return null;
}

/** El mensaje WebSocket que dispara el encargo. */
export function briefMessage(opts, text, from) {
  text = String(text).trim();
  const t = opts.target;
  if (!opts.pipeline) return { type: 'task', text, agent: t.agent, session: t.session, mode: t.mode, cwd: t.mode === 'launch' ? t.cwd : undefined, from };
  return { type: 'pipeline_start', session: t.session, agent: t.agent, pipeline: opts.pipeline.id, task: text, from };
}

export const projectLabel = (p) => (p ? `${p.name}${p.hasConfig ? '' : ' (sin .devteam)'} — ${p.dir.replace(/^\/Users\/[^/]+/, '~')}` : '');

/** Campos del diálogo, en orden (la terminal navega por ellos). */
export function briefFields() {
  return ['project', 'pipeline', 'target', 'task'];
}

/** Cambia la opción de un campo (delta ±1) y reinicia lo que depende de él. */
export function briefCycle(sel, field, delta, { projects, opts }) {
  const wrap = (i, n) => (n ? (i + delta + n) % n : 0);
  if (field === 'project') return { project: wrap(sel.project, projects.length), pipeline: 0, target: 0 };
  if (field === 'pipeline') return { ...sel, pipeline: wrap(sel.pipeline, opts.pipelines.length), target: 0 };
  if (field === 'target') return { ...sel, target: wrap(sel.target, opts.targets.length) };
  return sel;
}
