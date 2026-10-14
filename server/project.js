// Configuración de un proyecto para la oficina, en <proyecto>/.devteam/:
//
//   team.json             quién es quién: rol de la oficina → agente + modelo (+ harness)
//   pipelines/<id>.json   pipelines: etapas con rol, fase, agente, modelo, dependencias,
//                         gates (un comando que debe pasar o fallar) y bucles si fallan
//
// Los agentes se leen de las carpetas de cada harness (.pi/agents, .claude/agents,
// .opencode/agents). Ver docs/pipelines.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HARNESSES, harnessId, discoverAgents, which } from './harness/index.js';
import { normRole, normPhase, ROLE_IDS } from './roles.js';

export const CONFIG_DIR = '.devteam';
const DEFAULT_PHASE = { po: 'criterios', analyst: 'analiza', manager: 'planifica', tl: 'arquitectura', qa: 'verifica', backend: 'implementa', frontend: 'implementa', designer: 'ui' };
const MAX_STAGES = 40;

export const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') errors.push(`${path.basename(file)}: ${err.message}`);
    return null;
  }
}

export function hasConfig(dir) {
  return fs.existsSync(path.join(expandHome(dir), CONFIG_DIR));
}

/** Lee y resuelve la configuración de un proyecto. Nunca lanza: los problemas van en `errors`. */
export function loadProject(dir) {
  const root = path.resolve(expandHome(dir));
  const cfgDir = path.join(root, CONFIG_DIR);
  const errors = [];
  const team = readJson(path.join(cfgDir, 'team.json'), errors) || {};
  const agents = discoverAgents(root);

  const pipelines = [];
  let files = [];
  try { files = fs.readdirSync(path.join(cfgDir, 'pipelines')).filter((f) => f.endsWith('.json')).sort(); } catch { /* sin pipelines */ }
  for (const f of files) {
    const raw = readJson(path.join(cfgDir, 'pipelines', f), errors);
    if (raw) pipelines.push(resolvePipeline(path.basename(f, '.json'), raw, team, agents));
  }

  const harnesses = Object.values(HARNESSES).map((h) => {
    const bin = team.harnessOptions?.[h.id]?.bin || h.bin;
    return { id: h.id, label: h.label, bin, available: !!which(expandHome(bin)) };
  });
  return { dir: root, name: team.name || path.basename(root), hasConfig: fs.existsSync(cfgDir), team, pipelines, agents, harnesses, errors };
}

/** Busca un agente: primero entre los del harness de la etapa (nativo), luego en los demás. */
function findAgent(name, harness, agents) {
  if (!name) return null;
  const own = agents[harness]?.find((a) => a.name === name);
  if (own) return { ...own, harness, native: true };
  for (const [h, list] of Object.entries(agents)) {
    const a = list.find((x) => x.name === name);
    if (a) return { ...a, harness: h, native: false };
  }
  return null;
}

export function resolvePipeline(id, raw, team = {}, agents = {}) {
  const issues = [];
  const defaultHarness = harnessId(raw.harness || team.harness) || 'pi';
  const list = Array.isArray(raw.stages) ? raw.stages.slice(0, MAX_STAGES) : [];
  if (!list.length) issues.push('el pipeline no tiene etapas');

  const stages = list.map((s, i) => {
    const sid = String(s.id || `etapa-${i + 1}`).replace(/[^\w-]/g, '-').slice(0, 40);
    const role = normRole(s.role) || 'tl';
    if (s.role && !normRole(s.role)) issues.push(`${sid}: rol desconocido "${s.role}" (usa ${ROLE_IDS.join(', ')})`);
    const roleCfg = team.roles?.[role] || {};
    const harness = harnessId(s.harness || roleCfg.harness) || defaultHarness;
    const agentName = s.agent ?? roleCfg.agent ?? null;
    const agentDef = findAgent(agentName, harness, agents);
    if (agentName && !agentDef) issues.push(`${sid}: no encuentro el agente "${agentName}" (${HARNESSES[harness].agentDirs('<proyecto>')[0].dir.replace('<proyecto>/', '')}/)`);
    return {
      id: sid,
      name: String(s.name || sid).slice(0, 60),
      role,
      phase: normPhase(s.phase || DEFAULT_PHASE[role]),
      harness,
      agent: agentName,
      agentDef: agentDef ? { name: agentDef.name, description: agentDef.description, harness: agentDef.harness, native: agentDef.native, file: agentDef.file } : null,
      native: !!agentDef?.native && HARNESSES[harness].nativeAgents,
      agentPrompt: agentDef?.prompt || '',
      model: s.model || roleCfg.model || agentDef?.model || null,
      thinking: s.thinking || roleCfg.thinking || null,
      tools: Array.isArray(s.tools) ? s.tools : agentDef?.tools || null,
      prompt: typeof s.prompt === 'string' ? s.prompt : null,
      needs: [].concat(s.needs || []).map(String),
      check: s.check && typeof s.check.run === 'string'
        ? { run: s.check.run, expect: s.check.expect === 'fail' ? 'fail' : 'pass', timeout: Math.min(3600, Number(s.check.timeout) || 600) }
        : null,
      onFail: s.onFail?.goto ? { goto: String(s.onFail.goto), max: Math.max(1, Math.min(10, Number(s.onFail.max) || 2)) } : null,
    };
  });

  const ids = new Set(stages.map((s) => s.id));
  if (ids.size !== stages.length) issues.push('hay etapas con el mismo id');
  for (const s of stages) {
    for (const n of s.needs) if (!ids.has(n)) issues.push(`${s.id}: depende de "${n}", que no existe`);
    if (s.onFail && !ids.has(s.onFail.goto)) issues.push(`${s.id}: onFail.goto "${s.onFail.goto}" no existe`);
  }
  // ciclos en las dependencias
  const state = new Map();
  const visit = (s, trail) => {
    if (state.get(s.id) === 'done') return;
    if (state.get(s.id) === 'visiting') { issues.push(`dependencias en ciclo: ${[...trail, s.id].join(' → ')}`); return; }
    state.set(s.id, 'visiting');
    for (const n of s.needs) { const d = stages.find((x) => x.id === n); if (d) visit(d, [...trail, s.id]); }
    state.set(s.id, 'done');
  };
  stages.forEach((s) => visit(s, []));

  const orch = raw.orchestrator || team.orchestrator || {};
  return {
    id,
    name: String(raw.name || id).slice(0, 80),
    description: String(raw.description || '').slice(0, 300),
    strategy: raw.strategy === 'agent' ? 'agent' : 'office',
    harness: defaultHarness,
    orchestrator: { harness: harnessId(orch.harness) || defaultHarness, agent: orch.agent || null, model: orch.model || null },
    maxParallel: Math.max(1, Math.min(8, Number(raw.maxParallel || team.maxParallel) || 3)),
    stages,
    issues: [...new Set(issues)],
  };
}
