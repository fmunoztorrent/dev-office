// Agent names and task statuses (icon and tone; the name is in the languages:
// taskStatus.<status>). Shared by the terminal and the web view.
// Also how a folder is written for the user, and where an artifact of a system lives.

export const AGENT_NAME = { 'claude-code': 'Claude', opencode: 'OpenCode', pi: 'Pi' };

/** A folder as the settings show it: the home with `~` (`/Users/ana/x` → `~/x`). */
export const tildeHome = (p) => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');

/**
 * Where an artifact lives: its project's folder, plus the component's folder inside it
 * (`~/code/monorepo`, `~/code/monorepo/apps/web`). The project is the absolute path the office keeps.
 */
export function artifactFolder(part = {}) {
  const sub = String(part?.path ?? '').replace(/^\.?\/+|\/+$/g, '');
  return [part?.project, sub].filter(Boolean).join('/');
}

export const TASK_STATUS = {
  queued: ['◷', 'warn'], sent: ['→', 'blue'], running: ['▶', 'accent'],
  done: ['✔', 'ok'], failed: ['✖', 'err'], cancelled: ['⊘', 'muted'],
};
