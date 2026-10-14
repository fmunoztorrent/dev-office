// Harnesses soportados. Cada uno sabe: dónde están sus agentes, cómo correr una etapa con
// un agente y un modelo, cómo leer su salida JSON y cómo pedirle a su orquestador que delegue.

import fs from 'node:fs';
import path from 'node:path';
import pi from './pi.js';
import claude from './claude.js';
import opencode from './opencode.js';
import { readAgentDirs } from './agents.js';

export const HARNESSES = { pi, 'claude-code': claude, opencode };
const ALIASES = { claude: 'claude-code', 'claude-code': 'claude-code', pi: 'pi', opencode: 'opencode' };

export const harnessId = (name) => ALIASES[String(name || '').toLowerCase()] || null;
export const getHarness = (name) => HARNESSES[harnessId(name)] || null;

export function which(cmd) {
  if (!cmd) return null;
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* sigue */ }
  }
  return null;
}

/** Agentes que cada harness ve en un proyecto: { pi: [...], 'claude-code': [...], opencode: [...] } */
export function discoverAgents(projectDir) {
  return Object.fromEntries(Object.values(HARNESSES).map((h) => [h.id, readAgentDirs(h.agentDirs(projectDir))]));
}
