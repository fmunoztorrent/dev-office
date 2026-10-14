// Pi (pi-coding-agent). Una etapa = `pi --mode json -p --no-session …`, igual que lanza
// subagentes su extensión `subagent`: el modelo, las herramientas y el system prompt del
// agente van por flags. La salida es JSONL (docs/json.md de pi-mono).

import os from 'node:os';
import path from 'node:path';

const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
  .filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n').trim();

export default {
  id: 'pi',
  label: 'Pi',
  bin: 'pi',
  // Pi no tiene agentes nativos: la oficina les pasa modelo, herramientas y prompt por flags.
  nativeAgents: false,
  agentDirs: (project) => [
    { dir: path.join(project, '.pi', 'agents'), scope: 'project' },
    { dir: path.join(os.homedir(), '.pi', 'agent', 'agents'), scope: 'user' },
  ],
  defaultArgs: [],

  command({ prompt, model, thinking, tools, systemPromptFile, extraArgs = [] }) {
    const args = ['--mode', 'json', '-p', '--no-session'];
    if (model) args.push('--model', model);
    if (thinking) args.push('--thinking', thinking);
    if (tools?.length) args.push('--tools', tools.join(','));
    if (systemPromptFile) args.push('--append-system-prompt', systemPromptFile);
    return [...args, ...extraArgs, prompt];
  },

  /** Cómo pedirle al orquestador (estrategia "agent") que delegue una etapa. */
  delegation: (agent) => (agent
    ? `herramienta \`subagent\` con { agent: "${agent}", task, agentScope: "both" }`
    : 'hazla tú directamente'),

  createParser() {
    const args = new Map();
    let output = '';
    return {
      line(ev) {
        switch (ev?.type) {
          case 'turn_start': return [{ kind: 'thinking' }];
          case 'tool_execution_start':
            args.set(ev.toolCallId, ev.args);
            return [{ kind: 'tool_start', tool: ev.toolName, toolUseId: ev.toolCallId, input: ev.args }];
          case 'tool_execution_end':
            return [{ kind: 'tool_end', tool: ev.toolName, toolUseId: ev.toolCallId, input: args.get(ev.toolCallId), ok: !ev.isError }];
          case 'message_end': {
            if (ev.message?.role !== 'assistant') return [];
            const text = textOf(ev.message);
            if (text) output = text;
            if (ev.message.errorMessage) return [{ kind: 'error', text: ev.message.errorMessage }];
            return [];
          }
          default: return [];
        }
      },
      output: () => output,
    };
  },
};
