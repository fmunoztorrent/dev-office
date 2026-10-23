// They translate each agent's native payload into the office's generic format:
//
//   { session, kind, tool?, input?, text?, ok?, todos?, agentType?, agentId?, toolUseId?, role?, cwd? }
//
// kind: session_start | task | thinking | tool_start | tool_end | subagent_start | subagent_end
//       | todos | waiting | error | compact | turn_end | done | session_end | chat | pane_open | pane_close | pane_state

import { t } from '../public/i18n.js';

function isError(resp) {
  if (!resp || typeof resp !== 'object') return false;
  return resp.is_error === true || resp.success === false || (typeof resp.error === 'string' && resp.error.length > 0);
}

/** The text a tool returned (a command's output, a subagent's report). */
function outputOf(resp) {
  if (typeof resp === 'string') return resp;
  if (!resp || typeof resp !== 'object') return undefined;
  if (Array.isArray(resp.content)) return resp.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n') || undefined;
  if (typeof resp.stdout === 'string' || typeof resp.stderr === 'string') return [resp.stdout, resp.stderr].filter(Boolean).join('\n') || undefined;
  return typeof resp.output === 'string' ? resp.output : typeof resp.result === 'string' ? resp.result : undefined;
}

// Claude Code hooks: the JSON the hook receives on stdin. Inside a subagent, each event
// carries its `agent_id`: that is how its tools belong to the subagent.
function fromClaudeCode(p) {
  const b = { session: p.session_id, cwd: p.cwd, ...(p.agent_id ? { agentId: p.agent_id } : {}) };
  switch (p.hook_event_name) {
    case 'SessionStart': return { ...b, kind: 'session_start', text: p.source };
    case 'UserPromptSubmit': return { ...b, kind: 'task', text: p.prompt };
    case 'PreToolUse':
      return { ...b, kind: 'tool_start', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id };
    case 'PostToolUse':
      return { ...b, kind: 'tool_end', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id, ok: !isError(p.tool_response), output: outputOf(p.tool_response) };
    case 'PostToolUseFailure':
      return { ...b, kind: 'tool_end', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id, ok: false, text: p.error };
    case 'Notification':
    case 'PermissionRequest':
      return { ...b, kind: 'waiting', text: p.message || (p.tool_name ? t('events.permission', { tool: p.tool_name }) : undefined) };
    case 'SubagentStart': return { ...b, kind: 'subagent_start', agentType: p.agent_type, agentId: p.agent_id };
    case 'SubagentStop': return { ...b, kind: 'subagent_end', agentType: p.agent_type, agentId: p.agent_id };
    case 'PreCompact': return { ...b, kind: 'compact' };
    case 'Stop': return { ...b, kind: p.kind || 'turn_end' };
    case 'SessionEnd': return { ...b, kind: 'session_end', text: p.reason };
    default: return null;
  }
}

// Codex hooks: the same events and fields as Claude Code's (session_id, cwd,
// hook_event_name, tool_name, tool_input…), with Codex's own tools.
const CODEX_TOOLS = {
  shell: 'Bash', local_shell: 'Bash', exec_command: 'Bash', unified_exec: 'Bash', 'container.exec': 'Bash',
  apply_patch: 'Edit', read_file: 'Read', view_image: 'Read', list_dir: 'Glob', grep_files: 'Grep', web_search: 'WebSearch', update_plan: 'TodoWrite',
};
const PLAN_STATUS = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' };

function codexTool(name, raw) {
  const tool = CODEX_TOOLS[name] || name;
  let input = raw && typeof raw === 'object' ? { ...raw } : typeof raw === 'string' ? { command: raw } : {};
  if (tool === 'Bash' && Array.isArray(input.command)) {
    const argv = input.command.map(String);
    // ["bash", "-lc", "npm test"] → "npm test"
    input.command = /^(ba|z)?sh$/.test(argv[0] || '') && /^-\w*c$/.test(argv[1] || '') ? argv.slice(2).join(' ') : argv.join(' ');
  } else if (tool === 'Bash' && typeof input.cmd === 'string') input.command = input.cmd;
  if (tool === 'Edit' && !input.file_path) {
    const patch = String(input.input ?? input.patch ?? input.command ?? '');
    const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    if (m) input.file_path = m[1].trim();
  }
  if (tool === 'TodoWrite' && Array.isArray(input.plan)) input = { todos: input.plan.map((x) => ({ content: x.step ?? x.content, status: PLAN_STATUS[x.status] || 'pending' })) };
  if ((tool === 'Read') && !input.file_path && input.path) input.file_path = input.path;
  return { tool, input };
}

function fromCodex(p) {
  if (p.hook_event_name === 'Interrupt') return { session: p.session_id, cwd: p.cwd, kind: 'turn_end', text: t('events.interrupted') };
  if (p.hook_event_name === 'PostCompact') return null;
  if (p.tool_name) {
    const { tool, input } = codexTool(p.tool_name, p.tool_input);
    return fromClaudeCode({ ...p, tool_name: tool, tool_input: input });
  }
  return fromClaudeCode(p);
}

// Generic format (used by the OpenCode and Pi plugins, and any other agent).
function fromGeneric(p) {
  return Array.isArray(p) ? p : [p];
}

export const ADAPTERS = {
  'claude-code': fromClaudeCode,
  claude: fromClaudeCode,
  codex: fromCodex,
  generic: fromGeneric,
};

export function adapt(source, payload) {
  const fn = ADAPTERS[source] || fromGeneric;
  return [].concat(fn(payload) ?? []).filter((e) => e && typeof e === 'object');
}
