// Dev Team Office: la parte que corre del lado del AGENTE (el backend).
//
// La usan la extensión de Pi, el hook de Claude Code y el plugin de OpenCode. La oficina es
// sólo un frontend: no orquesta ni corre gates. Los pipelines pasan aquí, dentro del agente; la
// oficina sólo usa detectHarness() para mostrar qué trae cada agente registrado y agentCommand()
// para abrirle una sesión nueva:
//
//   loadProject(dir)        lee <proyecto>/.devteam/ y los agentes de cada harness
//   catalogEntry(project)   lo que el agente le anuncia a la oficina (sus pipelines)
//   PipelineRun             ejecuta un pipeline etapa por etapa DENTRO de la sesión del agente:
//                           arma el prompt de cada etapa, corre su gate, aplica los bucles y
//                           reporta todo a la oficina como eventos
//   detectHarness(dir)      el harness engineering de un proyecto y por dónde se arranca su pipeline
//   runGate / claudeChild / agentCommand / lastAssistantText / officeClient
//
// Sin dependencias: Node ≥ 18 o Bun. Este archivo se copia junto a cada integración.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const CONFIG_DIR = '.devteam';
export const ROLE_IDS = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
export const ROLE_NAME = { po: 'Product Owner', analyst: 'Analista de negocio', manager: 'Manager', tl: 'Tech Lead', qa: 'QA', backend: 'Backend', frontend: 'Frontend', designer: 'Diseñadora' };
const DEFAULT_PHASE = { po: 'criterios', analyst: 'analiza', manager: 'planifica', tl: 'arquitectura', qa: 'verifica', backend: 'implementa', frontend: 'implementa', designer: 'ui' };
const ROLE_ALIASES = {
  arquitecto: 'tl', arquitecta: 'tl', architect: 'tl', 'tech-lead': 'tl', techlead: 'tl', lead: 'tl', reviewer: 'tl',
  tester: 'qa', test: 'qa', testing: 'qa', calidad: 'qa', analista: 'analyst', ba: 'analyst', business: 'analyst',
  pm: 'manager', 'project-manager': 'manager', scrum: 'manager', 'product-owner': 'po', producto: 'po', product: 'po',
  be: 'backend', fe: 'frontend', front: 'frontend', back: 'backend', diseñador: 'designer', diseñadora: 'designer',
  disenador: 'designer', disenadora: 'designer', design: 'designer', ux: 'designer',
};
const PHASE_ALIASES = {
  story: 'historia', criteria: 'criterios', accept: 'acepta', analysis: 'analiza', research: 'investiga', plan: 'planifica',
  architecture: 'arquitectura', approve: 'aprueba', changes: 'cambios', 'test-plan': 'plan-pruebas', regression: 'regresion',
  verify: 'verifica', implement: 'implementa', migration: 'migracion', 'visual-review': 'revision-visual', blocked: 'bloqueado',
};
const MAX_STAGES = 40;
const OUTPUT_MAX = 6000;

export const HARNESSES = {
  pi: { id: 'pi', label: 'Pi', bin: 'pi', dirs: (p) => [[path.join(p, '.pi', 'agents'), 'project'], [path.join(os.homedir(), '.pi', 'agent', 'agents'), 'user']] },
  'claude-code': { id: 'claude-code', label: 'Claude Code', bin: 'claude', dirs: (p) => [[path.join(p, '.claude', 'agents'), 'project'], [path.join(os.homedir(), '.claude', 'agents'), 'user']] },
  opencode: { id: 'opencode', label: 'OpenCode', bin: 'opencode', dirs: (p) => [[path.join(p, '.opencode', 'agents'), 'project'], [path.join(os.homedir(), '.config', 'opencode', 'agents'), 'user']] },
};
export const harnessId = (h) => ({ claude: 'claude-code', 'claude-code': 'claude-code', pi: 'pi', opencode: 'opencode' }[String(h || '').toLowerCase()] || null);

const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const normRole = (r) => { const k = String(r ?? '').toLowerCase().trim(); return ROLE_IDS.includes(k) ? k : ROLE_ALIASES[k] || null; };
export const normPhase = (p) => {
  const k = String(p ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return PHASE_ALIASES[k] || k;
};
export const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export function which(cmd) {
  if (!cmd) return null;
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* sigue */ }
  }
  return null;
}

// ------------------------------------------------------------------ agentes de cada harness

const unquote = (v) => String(v).trim().replace(/^(['"])(.*)\1$/, '$2');

/** Archivo de agente: markdown con frontmatter (name, description, model, tools) + system prompt. */
export function parseAgentFile(text, file = 'agent.md') {
  const m = String(text).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  const meta = {};
  let body = String(text);
  if (m) {
    body = m[2];
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) { key = kv[1]; meta[key] = kv[2].trim() === '' ? [] : unquote(kv[2]); }
      else if (key && /^\s+-\s+/.test(line)) meta[key] = [].concat(Array.isArray(meta[key]) ? meta[key] : [], unquote(line.replace(/^\s+-\s+/, '')));
    }
  }
  const tools = typeof meta.tools === 'string' ? meta.tools.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(meta.tools) && meta.tools.length ? meta.tools : undefined;
  return {
    name: typeof meta.name === 'string' && meta.name ? meta.name : path.basename(file, '.md'),
    description: typeof meta.description === 'string' ? meta.description : '',
    model: typeof meta.model === 'string' && meta.model ? meta.model : undefined,
    tools,
    prompt: body.trim(),
    file,
  };
}

export function discoverAgents(projectDir) {
  const out = {};
  for (const h of Object.values(HARNESSES)) {
    const found = new Map();
    for (const [dir, scope] of h.dirs(projectDir)) {
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { continue; }
      for (const f of files) {
        try {
          const a = parseAgentFile(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f));
          if (!found.has(a.name)) found.set(a.name, { ...a, scope });
        } catch { /* ilegible */ }
      }
    }
    out[h.id] = [...found.values()];
  }
  return out;
}

// ------------------------------------------------------------------ proyecto y pipelines

function readJson(file, errors) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') errors.push(`${path.basename(file)}: ${err.message}`);
    return null;
  }
}

/** Lee <dir>/.devteam/ (team.json + pipelines/*.json). Nunca lanza: los problemas van en `errors`. */
export function loadProject(dir) {
  const root = path.resolve(expandHome(dir || process.cwd()));
  const cfg = path.join(root, CONFIG_DIR);
  const errors = [];
  const team = readJson(path.join(cfg, 'team.json'), errors) || {};
  const agents = discoverAgents(root);
  const pipelines = [];
  let files = [];
  try { files = fs.readdirSync(path.join(cfg, 'pipelines')).filter((f) => f.endsWith('.json')).sort(); } catch { /* sin pipelines */ }
  for (const f of files) {
    const raw = readJson(path.join(cfg, 'pipelines', f), errors);
    if (raw) pipelines.push(resolvePipeline(path.basename(f, '.json'), raw, team, agents));
  }
  return { dir: root, name: team.name || path.basename(root), hasConfig: fs.existsSync(cfg), team, pipelines, agents, errors };
}

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

/** Valida y completa un pipeline con lo de team.json y los archivos de agente. */
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
    const agent = s.agent ?? roleCfg.agent ?? null;
    const def = findAgent(agent, harness, agents);
    if (agent && !def) issues.push(`${sid}: no encuentro el agente "${agent}"`);
    return {
      id: sid,
      name: String(s.name || sid).slice(0, 60),
      role,
      phase: normPhase(s.phase || DEFAULT_PHASE[role]),
      harness,
      agent,
      native: !!def?.native,
      agentPrompt: def?.prompt || '',
      model: s.model === false ? null : s.model || roleCfg.model || def?.model || null, // false: el de la sesión
      thinking: s.thinking || roleCfg.thinking || null,
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
  const seen = new Map();
  const visit = (s, trail) => {
    if (seen.get(s.id) === 'done') return;
    if (seen.get(s.id) === 'visiting') { issues.push(`dependencias en ciclo: ${[...trail, s.id].join(' → ')}`); return; }
    seen.set(s.id, 'visiting');
    for (const n of s.needs) { const d = stages.find((x) => x.id === n); if (d) visit(d, [...trail, s.id]); }
    seen.set(s.id, 'done');
  };
  stages.forEach((s) => visit(s, []));
  return { id, name: String(raw.name || id).slice(0, 80), description: String(raw.description || '').slice(0, 300), harness: defaultHarness, stages, issues: [...new Set(issues)] };
}

export const isBlocking = (issue) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido/.test(issue);

/** Lo que el agente le anuncia a la oficina: qué pipelines puede correr en este proyecto. */
export function catalogEntry(project) {
  return {
    dir: project.dir,
    name: project.name,
    pipelines: project.pipelines.map((p) => ({
      id: p.id, name: p.name, description: p.description, harness: p.harness, issues: p.issues,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model, needs: s.needs, check: s.check, onFail: s.onFail })),
    })),
  };
}

// ------------------------------------------------------------------ el "harness engineering" de un proyecto
//
// Cada proyecto trae su propia forma de trabajar: un orquestador con subagentes, comandos que
// arrancan su pipeline, prompts... Aquí se detecta qué trae y por dónde se entra, para que un
// prompt enviado desde la oficina arranque ESE pipeline (no uno inventado por la oficina).

/** Rol de los subagentes de los harness conocidos (Errementari, gentle-pi / gentle-ai). */
export const SUBAGENT_ROLES = {
  pipeline: 'manager', spec: 'analyst', architect: 'tl', qa: 'qa', backend: 'backend', frontend: 'frontend', explore: 'analyst',
  researcher: 'analyst', 'sdd-init': 'manager', 'sdd-onboard': 'manager', 'sdd-status': 'manager', 'sdd-explore': 'analyst',
  'sdd-research': 'analyst', 'sdd-proposal': 'po', 'sdd-spec': 'analyst', 'sdd-design': 'tl', 'sdd-tasks': 'manager',
  'sdd-apply': 'backend', 'sdd-remediate': 'backend', 'sdd-verify': 'qa', 'sdd-archive': 'manager', 'gentle-ai-explore': 'analyst',
  'gentle-ai-worker': 'backend', 'gentle-ai-verify': 'qa', 'review-risk': 'tl', 'review-readability': 'tl', 'review-reliability': 'tl',
  'review-resilience': 'tl', 'jd-judge-a': 'tl', 'jd-judge-b': 'tl', 'jd-fix-agent': 'backend',
};
export const roleOfAgent = (name) => { const k = String(name || '').toLowerCase(); return SUBAGENT_ROLES[k] || normRole(k) || null; };

// Errementari (https://github.com/fmunoztorrent/errementari): el agente `pipeline` clasifica el
// pedido y lo pasa por spec → architect → qa → backend/frontend → qa → close. Se entra con /task.
const ERREMENTARI_FLOWS = [
  ['auto', '', 'Clasifica el pedido (feature, bugfix, debug, chore o pregunta) y corre su pipeline', null],
  ['feature', 'feature: ', 'SPDD + SDD + BDD + TDD en 7 pasos', [
    ['analyst', 'analiza', 'SPDD Analysis + REASONS Canvas + spec + BDD', 'spec'], ['tl', 'arquitectura', 'Valida el Canvas y los escenarios', 'architect'],
    ['qa', 'red', 'Tests que fallan (RED)', 'qa'], ['backend', 'implementa', 'SPDD Generate: código desde el Canvas', 'backend'],
    ['qa', 'green', 'Suite + typecheck + lint + mutation (GREEN)', 'qa'], ['tl', 'refactor', 'Refactor + spdd-sync', null],
    ['manager', 'release', 'Close: merge a dev, PR, learnings', 'pipeline']]],
  ['bugfix', 'bug: ', 'TDD + SPDD en 6 pasos', [
    ['analyst', 'analiza', 'Triage + SPDD Analysis + Canvas', 'spec'], ['qa', 'red', 'Reproduce el bug con un test (RED)', 'qa'],
    ['tl', 'arquitectura', 'Architect (si el fix cambia la estructura)', 'architect'], ['backend', 'fix', 'SPDD Generate + fix', 'backend'],
    ['qa', 'verifica', 'Verify + spdd-sync', 'qa'], ['manager', 'release', 'Close', 'pipeline']]],
  ['chore', 'chore: ', 'Scope → execute → verify → close (SPDD si toca código)', [
    ['manager', 'planifica', 'Scope', 'pipeline'], ['backend', 'implementa', 'Execute', 'backend'], ['qa', 'verifica', 'Verify', 'qa'], ['manager', 'release', 'Close', 'pipeline']]],
  ['debug', 'debug: ', 'Triage → reproduce → análisis → reporte (sólo lectura)', [
    ['analyst', 'analiza', 'Triage', 'spec'], ['qa', 'red', 'Reproduce', 'qa'], ['tl', 'analiza', 'Análisis', 'architect'], ['manager', 'planifica', 'Reporte', 'pipeline']]],
];

function readCommands(dir, harness, scope) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; }
  return files.map((f) => {
    let description = '';
    try { description = parseAgentFile(fs.readFileSync(path.join(dir, f), 'utf8'), f).description; } catch { /* ilegible */ }
    const name = path.basename(f, '.md');
    return { id: `${harness}:/${name}`, label: `/${name}${scope === 'user' ? ' (global)' : ''}`, description: clip(description, 200), harnesses: [harness], command: name };
  });
}

function readJsonc(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; }
}

/**
 * Qué harness engineering tiene un directorio y por dónde se arranca su pipeline.
 * entries: [{ id, label, description, harnesses, command?, prefix?, devteam?, stages?, issues?, source }]
 *   - "Prompt directo": lo recibe el agente por defecto del harness (que puede auto-clasificar)
 *   - Errementari: /task y sus flujos (feature, bugfix, chore, debug)
 *   - comandos de Claude Code (.claude/commands), de OpenCode (opencode.json, .opencode/command)
 *     y prompts de Pi (.pi/prompts, ~/.pi/agent/prompts)
 *   - pipelines de Dev Team Office (.devteam/pipelines): los corre una sesión abierta
 */
export function detectHarness(dir) {
  const root = path.resolve(expandHome(dir || process.cwd()));
  const has = (...p) => fs.existsSync(path.join(root, ...p));
  const harnesses = [];
  if (has('.claude') || has('CLAUDE.md')) harnesses.push('claude-code');
  if (has('opencode.json') || has('opencode.jsonc') || has('.opencode')) harnesses.push('opencode');
  if (has('.pi')) harnesses.push('pi');
  const kinds = [];
  const entries = [{ id: 'prompt', label: 'Prompt directo', description: 'El prompt tal cual: lo recibe el agente por defecto del harness.', harnesses: ['claude-code', 'opencode', 'pi'], source: 'agente' }];
  const covered = new Set();

  // Errementari: su manifiesto, o (instalaciones anteriores) su pipeline + el agente orquestador
  const manifest = readJsonc(path.join(root, '.errementari.json'))
    || (has('.opencode', 'pipeline', 'start.md') && (has('.opencode', 'agents', 'pipeline.md') || has('.claude', 'agents', 'pipeline.md')) ? {} : null);
  if (manifest) {
    const source = `Errementari ${manifest.version || ''}`.trim();
    kinds.push(source);
    for (const [id, prefix, description, stages] of ERREMENTARI_FLOWS) {
      entries.push({
        id: `errementari:${id}`, label: id === 'auto' ? 'Errementari · /task (clasifica solo)' : `Errementari · ${id}`, description,
        harnesses: ['claude-code', 'opencode'], command: 'task', prefix, source,
        stages: stages ? stages.map(([role, phase, name, agent]) => ({ role, phase, name, agent })) : null,
      });
    }
    covered.add('claude-code:/task').add('opencode:/task');
  }

  const opencode = readJsonc(path.join(root, 'opencode.json')) || readJsonc(path.join(root, 'opencode.jsonc')) || {};
  const commands = [
    ...readCommands(path.join(root, '.claude', 'commands'), 'claude-code', 'project'),
    ...readCommands(path.join(os.homedir(), '.claude', 'commands'), 'claude-code', 'user'),
    ...Object.entries(opencode.command || {}).map(([name, c]) => ({ id: `opencode:/${name}`, label: `/${name}`, description: clip(c?.description, 200), harnesses: ['opencode'], command: name })),
    ...readCommands(path.join(root, '.opencode', 'command'), 'opencode', 'project'),
    ...readCommands(path.join(root, '.opencode', 'commands'), 'opencode', 'project'),
    ...readCommands(path.join(root, '.pi', 'prompts'), 'pi', 'project'),
    ...readCommands(path.join(os.homedir(), '.pi', 'agent', 'prompts'), 'pi', 'user'),
  ];
  for (const c of commands) if (!covered.has(c.id)) { covered.add(c.id); entries.push({ ...c, source: 'comando' }); }

  const project = loadProject(root);
  if (project.hasConfig) kinds.push('Dev Team Office');
  for (const p of project.pipelines) {
    entries.push({
      id: `devteam:${p.id}`, label: `Pipeline · ${p.name}`, description: p.description, harnesses: ['claude-code', 'opencode', 'pi'],
      devteam: p.id, needsSession: true, issues: p.issues, source: '.devteam',
      stages: p.stages.map((s) => ({ role: s.role, phase: s.phase, name: s.name, agent: s.agent, model: s.model, check: s.check })),
    });
  }

  // qué subagente es qué rol (para que el personaje correcto se mueva cuando el orquestador delega)
  const roles = {};
  for (const list of Object.values(project.agents)) for (const a of list) { const r = roleOfAgent(a.name); if (r) roles[a.name.toLowerCase()] = r; }
  if (opencode.default_agent && roleOfAgent(opencode.default_agent)) roles[opencode.default_agent.toLowerCase()] = roleOfAgent(opencode.default_agent);

  return { dir: root, name: project.team.name || path.basename(root), exists: fs.existsSync(root), harnesses, kinds, entries, roles, defaultAgent: opencode.default_agent || null };
}

/** El texto (o comando) que arranca una entrada del harness con la tarea del usuario. */
export function invocation(entry, text) {
  text = String(text ?? '').trim();
  if (!entry?.command) return { text };
  const args = `${entry.prefix || ''}${text}`;
  return { text: `/${entry.command} ${args}`, command: entry.command, args };
}

/**
 * Un comando de Claude Code expandido, para dárselo a una sesión que ya está abierta (el hook
 * Stop no puede ejecutar un slash command: le pasa su texto a Claude).
 */
export function expandClaudeCommand(dir, name, args = '') {
  for (const base of [path.join(dir || '', '.claude', 'commands'), path.join(os.homedir(), '.claude', 'commands')]) {
    let text;
    try { text = fs.readFileSync(path.join(base, `${String(name).replace(/[^\w:.-]/g, '')}.md`), 'utf8'); } catch { continue; }
    const body = parseAgentFile(text).prompt;
    return /\$ARGUMENTS/.test(body) ? body.replaceAll('$ARGUMENTS', args) : `${body}\n\n${args}`.trim();
  }
  return null;
}

/**
 * Ejecutable y argumentos para una sesión nueva de un agente, sin shell (la tarea va como un
 * único argumento). opts: { bin, args } del agente registrado.
 */
export function agentCommand(harness, inv, { bin, args } = {}) {
  const h = harnessId(harness);
  if (!h) return { error: `no sé lanzar "${harness}"` };
  const exe = which(expandHome(bin || (h === 'claude-code' ? process.env.DEV_TEAM_OFFICE_CLAUDE_BIN : '') || HARNESSES[h].bin));
  if (!exe) return { error: `no encuentro "${bin || HARNESSES[h].bin}" en el PATH` };
  const extra = Array.isArray(args) ? args.map(String) : null;
  if (h === 'claude-code') return { exe, argv: ['-p', inv.text, ...(extra ?? ['--permission-mode', 'acceptEdits'])] };
  if (h === 'opencode') return { exe, argv: inv.command ? ['run', '--command', inv.command, ...(extra ?? []), inv.args] : ['run', ...(extra ?? []), inv.text] };
  return { exe, argv: ['-p', ...(extra ?? []), inv.text] };
}

// ------------------------------------------------------------------ ejecución dentro de la sesión

const render = (tpl, vars) => tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Orden de ejecución secuencial que respeta `needs` (y el orden en que se declararon). */
function sequence(stages) {
  const done = new Set();
  const order = [];
  while (order.length < stages.length) {
    const next = stages.find((s) => !done.has(s.id) && s.needs.every((n) => done.has(n)));
    if (!next) break;
    done.add(next.id);
    order.push(next.id);
  }
  return order;
}

/**
 * Un pipeline corriendo dentro de la sesión de un agente. Es una máquina de estados:
 *   start()          → { action: 'prompt', stage, prompt }   la primera etapa
 *   advance(output)  → la etapa actual terminó con ese resumen: corre su gate, aplica el
 *                      bucle si falla, y devuelve la siguiente acción:
 *                      { action: 'prompt', stage, prompt } | { action: 'done' } | { action: 'failed', reason }
 * La integración del agente hace lo que pide cada acción (mandar el prompt a su sesión,
 * cambiar de modelo…) y llama a advance() cuando el agente termina el turno.
 *
 * report(event) recibe eventos para la oficina (fases, tablero, gates, fin) y onStatus(status)
 * el estado del pipeline para su panel.
 */
export class PipelineRun {
  constructor({ id, project, pipeline, task, report = () => {}, onStatus = () => {}, exec = runGate }) {
    this.id = id;
    this.project = { dir: project.dir, name: project.name };
    this.pipeline = pipeline;
    this.task = task;
    this.report = report;
    this.onStatus = onStatus;
    this.exec = exec;
    this.status = 'running';
    this.detail = '';
    this.current = null;
    this.lastRole = null;
    this.stages = pipeline.stages.map((s) => ({ ...s, status: 'pending', attempts: 0, loops: 0, output: '', failure: '' }));
    this.order = sequence(this.stages);
  }

  /** Para el hook de Claude Code, que vive un proceso por evento: el estado va a disco. */
  toJSON() {
    return { id: this.id, project: this.project, pipeline: this.pipeline, task: this.task, status: this.status, detail: this.detail, current: this.current, lastRole: this.lastRole, stages: this.stages };
  }

  static restore(state, opts = {}) {
    const run = new PipelineRun({ ...opts, id: state.id, project: state.project, pipeline: state.pipeline, task: state.task });
    Object.assign(run, { status: state.status, detail: state.detail, current: state.current, lastRole: state.lastRole, stages: state.stages });
    return run;
  }

  stage(id) { return this.stages.find((s) => s.id === id); }
  get currentStage() { return this.current ? this.stage(this.current) : null; }

  publicStatus() {
    return {
      id: this.id, status: this.status, detail: this.detail, current: this.current,
      stages: this.stages.map((s) => ({ id: s.id, name: s.name, role: s.role, phase: s.phase, harness: s.harness, agent: s.agent, model: s.model, status: s.status, attempts: s.attempts })),
    };
  }

  #todos() {
    const map = { pending: 'pending', running: 'in_progress', done: 'completed' };
    this.report({ kind: 'todos', todos: this.stages.map((s) => ({ id: s.id, content: `${s.name} · ${ROLE_NAME[s.role]}`, status: map[s.status] || 'pending' })) });
    this.onStatus(this.publicStatus());
  }

  start() {
    const blocking = this.pipeline.issues.filter(isBlocking);
    if (blocking.length) return this.#finish('failed', blocking.join('; '));
    this.report({ kind: 'task', text: `${this.pipeline.name}: ${this.task}` });
    // la oficina aprende qué subagente es qué rol (si una etapa delega en subagentes)
    const roles = {};
    for (const s of this.stages) if (s.agent) roles[s.agent.toLowerCase()] ??= s.role;
    if (Object.keys(roles).length) this.report({ kind: 'agent_roles', roles });
    return this.#next();
  }

  #next() {
    const nextId = this.order.find((id) => this.stage(id).status === 'pending' && this.stage(id).needs.every((n) => this.stage(n).status === 'done'));
    if (!nextId) {
      return this.stages.every((s) => s.status === 'done')
        ? this.#finish('done', `Pipeline «${this.pipeline.name}» terminado`)
        : this.#finish('failed', 'el pipeline quedó trabado: hay etapas que nunca podrán empezar');
    }
    const st = this.stage(nextId);
    st.status = 'running';
    st.attempts++;
    this.current = st.id;
    this.report({ kind: 'phase', role: st.role, phase: st.phase, from: this.lastRole || undefined, text: `${st.name}${st.agent ? ` · ${st.agent}` : ''}${st.model ? ` (${st.model})` : ''}` });
    this.lastRole = st.role;
    this.#todos();
    return { action: 'prompt', stage: { ...st }, prompt: this.promptFor(st) };
  }

  promptFor(st) {
    const previous = st.needs.map((id) => { const s = this.stage(id); return `### ${s.name} (${ROLE_NAME[s.role]})\n${s.output || '(sin resumen)'}`; }).join('\n\n');
    const vars = { task: this.task, project: this.project.name, previous, failure: st.failure };
    for (const s of this.stages) vars[`${s.id}.output`] = s.output;
    const persona = st.agentPrompt ? `Actúa como el agente «${st.agent}»:\n${st.agentPrompt}\n\n` : '';
    let body = st.prompt
      ? render(st.prompt, vars)
      : `Tarea: ${this.task}\n\nEres ${ROLE_NAME[st.role]} en el pipeline «${this.pipeline.name}» del proyecto ${this.project.name}. Tu etapa: «${st.name}» (fase ${st.phase}).`;
    if (previous && !/\{\{\s*previous\s*\}\}/.test(st.prompt || '')) body += `\n\nResultados de las etapas anteriores:\n\n${previous}`;
    if (st.failure && !/\{\{\s*failure\s*\}\}/.test(st.prompt || '')) body += `\n\nEl intento anterior no pasó. Corrige esto:\n${st.failure}`;
    const gate = st.check ? `\n\nAl terminar se ejecutará \`${st.check.run}\` y debe ${st.check.expect === 'pass' ? 'pasar' : 'FALLAR: es la fase RED, los tests todavía no deben pasar'}.` : '';
    return `[Dev Team Office · etapa ${this.order.indexOf(st.id) + 1}/${this.order.length}]\n${persona}${body}${gate}\n\nCuando termines, resume en pocas líneas qué hiciste (archivos, decisiones, resultados).`;
  }

  /** La etapa actual terminó (el agente cerró su turno) con este resumen. */
  async advance(output) {
    const st = this.currentStage;
    if (this.status !== 'running' || !st) return { action: this.status === 'done' ? 'done' : 'failed', reason: this.detail };
    st.output = clip(output || '(sin resumen)', OUTPUT_MAX);
    if (st.check) {
      const toolId = `${this.id}-${st.id}-gate-${st.attempts}`;
      this.report({ kind: 'tool_start', tool: 'Bash', input: { command: st.check.run }, toolUseId: toolId, role: st.role });
      const { passed, tail } = await this.exec(st.check.run, this.project.dir, st.check.timeout);
      if (this.status !== 'running') return { action: 'failed', reason: this.detail };
      this.report({ kind: 'tool_end', tool: 'Bash', input: { command: st.check.run }, toolUseId: toolId, role: st.role, ok: passed });
      const ok = st.check.expect === 'pass' ? passed : !passed;
      if (!ok) return this.#fail(st, `\`${st.check.run}\` ${passed ? 'pasó, y en esta etapa debía fallar' : 'falló'}:\n${tail}`);
    }
    st.status = 'done';
    st.failure = '';
    this.report({ kind: 'stage_end', role: st.role, ok: true, text: `✔ ${st.name}` });
    return this.#next();
  }

  /** La etapa no pudo ni empezar (p. ej. el modelo no está disponible). */
  fail(reason) { const st = this.currentStage; return st ? this.#fail(st, reason) : this.#finish('failed', reason); }

  #fail(st, reason) {
    this.report({ kind: 'stage_end', role: st.role, ok: false, text: `✖ ${st.name}: ${clip(reason, 120)}` });
    const target = st.onFail && this.stage(st.onFail.goto);
    if (target && st.loops < st.onFail.max) {
      st.loops++;
      // se repite desde `goto`: esa etapa y todo lo que depende de ella vuelve a pendiente
      const reset = new Set([target.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const s of this.stages) if (!reset.has(s.id) && s.needs.some((n) => reset.has(n))) { reset.add(s.id); grew = true; }
      }
      for (const s of this.stages) if (reset.has(s.id)) s.status = 'pending';
      st.status = 'pending';
      target.failure = clip(reason, 2000);
      return this.#next();
    }
    st.status = 'failed';
    return this.#finish('failed', `${st.name}: ${clip(reason, 160)}`);
  }

  #finish(status, detail) {
    this.status = status;
    this.detail = clip(detail, 200);
    this.current = null;
    for (const s of this.stages) if (s.status === 'pending') s.status = 'skipped';
    this.#todos(); // antes del final: cualquier evento posterior volvería a poner la sesión "en curso"
    if (status === 'done') this.report({ kind: 'done', text: detail });
    else this.report({ kind: 'error', role: 'manager', text: `Pipeline ${status === 'cancelled' ? 'cancelado' : 'detenido'}: ${this.detail}` });
    return status === 'done' ? { action: 'done' } : { action: 'failed', reason: this.detail };
  }

  cancel(reason = 'cancelado desde la oficina') {
    if (this.status !== 'running') return;
    for (const s of this.stages) if (s.status === 'running') s.status = 'cancelled';
    this.#finish('cancelled', reason);
  }
}

// ------------------------------------------------------------------ utilidades del agente

/** Corre un gate en el proyecto. */
export function runGate(command, cwd, timeoutSec = 600) {
  return new Promise((resolve) => {
    const tail = [];
    const collect = (d) => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) { tail.push(clip(l, 300)); if (tail.length > 20) tail.shift(); } };
    const child = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }, timeoutSec * 1000);
    child.on('error', (err) => { clearTimeout(timer); resolve({ passed: false, tail: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ passed: code === 0, tail: tail.join('\n') }); });
  });
}

/** Última respuesta del asistente en un transcript de Claude Code (JSONL). */
export function lastAssistantText(transcriptPath) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const text = Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() : typeof content === 'string' ? content : '';
    if (text) return text;
  }
  return '';
}

/** Modelo con el que respondió la sesión (el último mensaje del asistente en el transcript). */
export function lastAssistantModel(transcriptPath) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'assistant' && entry.message?.model && entry.message.model !== '<synthetic>') return entry.message.model;
    } catch { /* línea rota */ }
  }
  return '';
}

/** ¿La etapa pide el modelo que ya tiene la sesión? ("opus", "claude-opus-5-5", "anthropic/claude-opus-5-5"…) */
export function sameModel(wanted, current) {
  const w = String(wanted || '').toLowerCase().replace(/^anthropic\//, '').replace(/\[.*\]$/, '');
  const c = String(current || '').toLowerCase().replace(/\[.*\]$/, '');
  if (!w || !c) return false;
  if (['opus', 'sonnet', 'haiku', 'fable'].includes(w)) return c.includes(w);
  return c === w || c.startsWith(`${w}-`);
}

/** Texto de un mensaje del asistente (Pi y OpenCode usan partes { type: 'text', text }). */
export const textOf = (message) => (Array.isArray(message?.content || message?.parts) ? (message.content || message.parts) : [])
  .filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n').trim();

/**
 * Etapa de Claude Code con un modelo distinto al de la sesión: los hooks no pueden cambiar el
 * modelo de una sesión, así que corre como `claude -p --model …` y su resultado vuelve a la sesión.
 */
export function claudeChild({ prompt, model, agent, cwd, env = {}, bin, args }) {
  const exe = which(expandHome(bin || process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || 'claude'));
  if (!exe) return Promise.resolve({ ok: false, output: 'no encuentro "claude" en el PATH' });
  const argv = ['-p', '--output-format', 'json'];
  if (model) argv.push('--model', String(model).replace(/^anthropic\//, '')); // Claude usa alias o ids sin proveedor
  if (agent) argv.push('--agent', agent);
  argv.push(...(args || ['--permission-mode', 'acceptEdits']), prompt);
  return new Promise((resolve) => {
    let out = '';
    const tail = [];
    const child = spawn(exe, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { tail.push(d.toString('utf8')); });
    child.on('error', (err) => resolve({ ok: false, output: err.message }));
    child.on('close', (code) => {
      let result = out.trim();
      try { const j = JSON.parse(out); result = j.result ?? result; if (j.is_error) code = code || 1; } catch { /* texto plano */ }
      resolve({ ok: code === 0, output: code === 0 ? result : clip(`${result}\n${tail.join('')}`, 2000) });
    });
  });
}

/** Envía en orden: los eventos de la oficina cuentan una historia (fase → herramientas → fin). */
export function inOrder(fn) {
  let chain = Promise.resolve();
  return (...args) => (chain = chain.then(() => fn(...args), () => fn(...args)));
}

/** Cliente HTTP mínimo hacia la oficina (en orden). Nunca lanza: la oficina es opcional. */
export function officeClient(url = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317') {
  const post = inOrder((p, body, ms = 1500) => fetch(`${url}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  }).then((r) => r.json()).catch(() => null));
  return {
    url,
    post,
    event: (source, e) => post(`/v1/events/${source}`, e),
    pipelineStatus: (id, status) => post(`/v1/pipelines/${encodeURIComponent(id)}/update`, status),
  };
}
