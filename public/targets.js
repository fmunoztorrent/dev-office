// Nombres de los agentes y estados de las tareas (ícono y tono; el nombre está en los idiomas:
// taskStatus.<estado>). Lo comparten la terminal y la vista web.

export const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
export const TASK_STATUS = {
  queued: ['◷', 'warn'], sent: ['→', 'blue'], running: ['▶', 'accent'],
  done: ['✔', 'ok'], failed: ['✖', 'err'], cancelled: ['⊘', 'muted'],
};
