// Traducen el payload nativo de cada agente al formato genérico de la oficina:
//
//   { session, kind, tool?, input?, text?, ok?, todos?, agentType?, agentId?, toolUseId?, role?, cwd? }
//
// kind: session_start | task | thinking | tool_start | tool_end | subagent_start | subagent_end
//       | todos | waiting | error | compact | done | session_end | chat

function isError(resp) {
  if (!resp || typeof resp !== 'object') return false;
  return resp.is_error === true || resp.success === false || (typeof resp.error === 'string' && resp.error.length > 0);
}

// Hooks de Claude Code: el JSON que el hook recibe por stdin.
function fromClaudeCode(p) {
  const b = { session: p.session_id, cwd: p.cwd };
  switch (p.hook_event_name) {
    case 'SessionStart': return { ...b, kind: 'session_start', text: p.source };
    case 'UserPromptSubmit': return { ...b, kind: 'task', text: p.prompt };
    case 'PreToolUse':
      return { ...b, kind: 'tool_start', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id };
    case 'PostToolUse':
      return { ...b, kind: 'tool_end', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id, ok: !isError(p.tool_response) };
    case 'PostToolUseFailure':
      return { ...b, kind: 'tool_end', tool: p.tool_name, input: p.tool_input, toolUseId: p.tool_use_id, ok: false, text: p.error };
    case 'Notification':
    case 'PermissionRequest':
      return { ...b, kind: 'waiting', text: p.message || (p.tool_name ? `Permiso para ${p.tool_name}` : undefined) };
    case 'SubagentStart': return { ...b, kind: 'subagent_start', agentType: p.agent_type, agentId: p.agent_id };
    case 'SubagentStop': return { ...b, kind: 'subagent_end', agentType: p.agent_type, agentId: p.agent_id };
    case 'PreCompact': return { ...b, kind: 'compact' };
    case 'Stop': return { ...b, kind: 'done' };
    case 'SessionEnd': return { ...b, kind: 'session_end', text: p.reason };
    default: return null;
  }
}

// Formato genérico (lo usan los plugins de OpenCode y Pi, y cualquier otro agente).
function fromGeneric(p) {
  return Array.isArray(p) ? p : [p];
}

export const ADAPTERS = {
  'claude-code': fromClaudeCode,
  claude: fromClaudeCode,
  generic: fromGeneric,
};

export function adapt(source, payload) {
  const fn = ADAPTERS[source] || fromGeneric;
  return [].concat(fn(payload) ?? []).filter((e) => e && typeof e === 'object');
}
