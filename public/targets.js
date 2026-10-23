// Agent names and task statuses (icon and tone; the name is in the languages:
// taskStatus.<status>). Shared by the terminal and the web view.

export const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };
export const TASK_STATUS = {
  queued: ['◷', 'warn'], sent: ['→', 'blue'], running: ['▶', 'accent'],
  done: ['✔', 'ok'], failed: ['✖', 'err'], cancelled: ['⊘', 'muted'],
};
