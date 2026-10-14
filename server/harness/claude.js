// Claude Code. Una etapa = `claude -p --output-format stream-json --verbose …`.
// Los agentes de .claude/agents/ se usan nativamente con `--agent`.

import os from 'node:os';
import path from 'node:path';

export default {
  id: 'claude-code',
  label: 'Claude Code',
  bin: 'claude',
  nativeAgents: true,
  agentDirs: (project) => [
    { dir: path.join(project, '.claude', 'agents'), scope: 'project' },
    { dir: path.join(os.homedir(), '.claude', 'agents'), scope: 'user' },
  ],
  // Sin nadie que apruebe permisos: edita archivos y deniega lo demás. Se cambia en team.json.
  defaultArgs: ['--permission-mode', 'acceptEdits'],

  command({ prompt, model, agent, native, systemPromptFile, extraArgs = [] }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);
    if (agent && native) args.push('--agent', agent);
    else if (systemPromptFile) args.push('--append-system-prompt-file', systemPromptFile);
    return [...args, ...extraArgs, prompt];
  },

  delegation: (agent) => (agent ? `herramienta Task con subagent_type: "${agent}"` : 'hazla tú directamente'),

  createParser() {
    const tools = new Map(); // tool_use_id → { name, input }
    let output = '';
    return {
      line(ev) {
        const content = Array.isArray(ev?.message?.content) ? ev.message.content : [];
        const parent = ev?.parent_tool_use_id || undefined;
        if (ev?.type === 'assistant') {
          const out = [];
          for (const c of content) {
            if (c.type === 'tool_use') {
              tools.set(c.id, { name: c.name, input: c.input });
              out.push({ kind: 'tool_start', tool: c.name, toolUseId: c.id, input: c.input, parentToolUseId: parent });
            } else if (c.type === 'text' && c.text && !parent) output = c.text.trim();
          }
          return out;
        }
        if (ev?.type === 'user') {
          return content.filter((c) => c.type === 'tool_result').map((c) => {
            const t = tools.get(c.tool_use_id) || {};
            return { kind: 'tool_end', tool: t.name, toolUseId: c.tool_use_id, input: t.input, ok: !c.is_error, parentToolUseId: parent };
          });
        }
        if (ev?.type === 'result') {
          if (typeof ev.result === 'string' && ev.result.trim()) output = ev.result.trim();
          return ev.is_error ? [{ kind: 'error', text: ev.result || 'Claude terminó con error' }] : [];
        }
        return [];
      },
      output: () => output,
    };
  },
};
