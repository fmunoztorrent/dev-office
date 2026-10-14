// OpenCode. Una etapa = `opencode run --format json …`. Los agentes de .opencode/agents/
// se usan nativamente con `--agent`. Cada herramienta llega como un único `tool_use` al
// terminar (part.tool, part.state.status completed|error, part.state.input).

import os from 'node:os';
import path from 'node:path';

export default {
  id: 'opencode',
  label: 'OpenCode',
  bin: 'opencode',
  nativeAgents: true,
  agentDirs: (project) => [
    { dir: path.join(project, '.opencode', 'agents'), scope: 'project' },
    { dir: path.join(os.homedir(), '.config', 'opencode', 'agents'), scope: 'user' },
  ],
  defaultArgs: [],

  // OpenCode no acepta un system prompt extra por CLI: si el agente no es suyo, va delante del mensaje.
  command({ prompt, model, agent, native, agentPrompt, extraArgs = [] }) {
    const args = ['run', '--format', 'json'];
    if (model) args.push('--model', model);
    if (agent && native) args.push('--agent', agent);
    const message = !native && agentPrompt ? `${agentPrompt}\n\n---\n\n${prompt}` : prompt;
    return [...args, ...extraArgs, message];
  },

  delegation: (agent) => (agent ? `subagente @${agent} (herramienta task)` : 'hazla tú directamente'),

  createParser() {
    let output = '';
    let n = 0;
    return {
      line(ev) {
        const part = ev?.part || {};
        switch (ev?.type) {
          case 'step_start': return [{ kind: 'thinking' }];
          case 'tool_use': {
            const id = part.id || part.partID || `oc-${++n}`;
            const input = part.state?.input;
            return [
              { kind: 'tool_start', tool: part.tool, toolUseId: id, input },
              { kind: 'tool_end', tool: part.tool, toolUseId: id, input, ok: part.state?.status !== 'error' },
            ];
          }
          case 'text':
            if (part.text?.trim()) output = part.text.trim();
            return [];
          case 'error': return [{ kind: 'error', text: ev.error?.message || 'OpenCode terminó con error' }];
          default: return [];
        }
      },
      output: () => output,
    };
  },
};
