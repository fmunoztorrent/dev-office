// A quién se le puede mandar una tarea desde la oficina. Lo comparten la terminal y la vista web.

export const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
export const TASK_STATUS = {
  queued: ['◷', 'en cola', 'warn'], sent: ['→', 'enviada', 'blue'], running: ['▶', 'en curso', 'accent'],
  done: ['✔', 'hecha', 'ok'], failed: ['✖', 'falló', 'err'], cancelled: ['⊘', 'cancelada', 'muted'],
};
const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() || p : '');

/**
 * Destinos posibles, en este orden: sesiones de Pi/OpenCode conectadas (entrega inmediata),
 * sesiones recientes de Claude Code (la entrega su hook Stop) y ejecuciones nuevas.
 * @param tasks   estado de tareas del servidor: { agents, launchers, defaultCwd }
 * @param sessions iterable de sesiones de la oficina
 */
export function taskTargets(tasks = {}, sessions = []) {
  const { agents = [], launchers = [], defaultCwd = '' } = tasks;
  const out = [];
  for (const a of agents) {
    out.push({ label: `${AGENT_NAME[a.agent] || a.agent} · ${base(a.cwd) || 'sesión'} · sesión abierta`, agent: a.agent, session: a.session, mode: 'session' });
  }
  const recent = [...sessions]
    .filter((s) => s.source === 'claude-code' && s.status !== 'ended' && Date.now() - s.lastAt < 3 * 3600_000)
    .sort((a, b) => b.lastAt - a.lastAt).slice(0, 3);
  for (const s of recent) {
    const when = s.status === 'active' ? 'al terminar su turno' : 'tras tu próximo mensaje';
    out.push({ label: `Claude · ${base(s.cwd) || s.id.slice(0, 8)} · ${when}`, agent: 'claude-code', session: s.id, mode: 'session' });
  }
  for (const l of launchers.filter((x) => x.available)) {
    out.push({ label: `Nuevo ${AGENT_NAME[l.agent] || l.agent} en ${base(defaultCwd)}`, agent: l.agent, mode: 'launch' });
  }
  return out;
}
