// Nombres de los agentes y estados de las tareas. Lo comparten la terminal y la vista web.

export const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
export const TASK_STATUS = {
  queued: ['◷', 'en cola', 'warn'], sent: ['→', 'enviada', 'blue'], running: ['▶', 'en curso', 'accent'],
  done: ['✔', 'hecha', 'ok'], failed: ['✖', 'falló', 'err'], cancelled: ['⊘', 'cancelada', 'muted'],
};
