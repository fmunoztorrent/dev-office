// Definiciones de agentes de cada harness: archivos markdown con frontmatter, como
//   ---
//   name: architect
//   description: Diseña la solución
//   model: anthropic/claude-opus-5-5
//   tools: read, grep, find, ls
//   ---
//   Eres el arquitecto del equipo…   ← system prompt
//
// Pi (extensión subagent): .pi/agents/ y ~/.pi/agent/agents/
// Claude Code:             .claude/agents/ y ~/.claude/agents/
// OpenCode:                .opencode/agents/ y ~/.config/opencode/agents/

import fs from 'node:fs';
import path from 'node:path';

const unquote = (v) => String(v).trim().replace(/^(['"])(.*)\1$/, '$2');

export function parseAgentFile(text, file = 'agent.md') {
  const m = String(text).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  const meta = {};
  let body = String(text);
  if (m) {
    body = m[2];
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) {
        key = kv[1];
        meta[key] = kv[2].trim() === '' ? [] : unquote(kv[2]);
      } else if (key && /^\s+-\s+/.test(line)) {
        meta[key] = [].concat(Array.isArray(meta[key]) ? meta[key] : [], unquote(line.replace(/^\s+-\s+/, '')));
      }
    }
  }
  const tools = typeof meta.tools === 'string'
    ? meta.tools.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(meta.tools) && meta.tools.length ? meta.tools : undefined;
  return {
    name: typeof meta.name === 'string' && meta.name ? meta.name : path.basename(file, '.md'),
    description: typeof meta.description === 'string' ? meta.description : '',
    model: typeof meta.model === 'string' && meta.model ? meta.model : undefined,
    tools,
    mode: typeof meta.mode === 'string' ? meta.mode : undefined,
    prompt: body.trim(),
    file,
  };
}

/** Agentes de una lista de directorios; el primero gana si se repite el nombre. */
export function readAgentDirs(dirs) {
  const out = new Map();
  for (const { dir, scope } of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of files.sort()) {
      const file = path.join(dir, f);
      try {
        const a = parseAgentFile(fs.readFileSync(file, 'utf8'), file);
        if (!out.has(a.name)) out.set(a.name, { ...a, scope });
      } catch { /* archivo ilegible: se ignora */ }
    }
  }
  return [...out.values()];
}
