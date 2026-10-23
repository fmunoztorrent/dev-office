// Dev Team Office: the part that runs on the AGENT's side (the backend).
//
// Used by the Pi extension, the Claude Code hook and the OpenCode plugin. The office is only a
// frontend: it neither orchestrates nor runs gates. Pipelines happen here, inside the agent; the
// office only uses detectHarness() to show what each registered agent brings and agentCommand()
// to open a new session for it:
//
//   loadProject(dir)        reads <project>/.devteam/ and each harness's agents
//   catalogEntry(project)   what the agent announces to the office (its pipelines)
//   PipelineRun             runs a pipeline stage by stage INSIDE the agent's session:
//                           builds each stage's prompt, runs its gate, applies the loops and
//                           reports everything to the office as events
//   detectHarness(dir)      a project's harness engineering and where its pipeline starts
//   runGate / claudeChild / agentCommand / lastAssistantText / officeClient
//
// No dependencies: Node ≥ 18 or Bun. This file is copied next to each integration.

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
  // Pi and gentle-pi look for subagents in agents/ and subagents/, of the project and of its config folder
  pi: { id: 'pi', label: 'Pi', bin: 'pi', dirs: (p) => [[path.join(p, '.pi', 'agents'), 'project'], [path.join(p, '.pi', 'subagents'), 'project'], [path.join(piAgentDir(), 'agents'), 'user'], [path.join(piAgentDir(), 'subagents'), 'user']] },
  'claude-code': { id: 'claude-code', label: 'Claude Code', bin: 'claude', dirs: (p) => [[path.join(p, '.claude', 'agents'), 'project'], [path.join(os.homedir(), '.claude', 'agents'), 'user']] },
  opencode: { id: 'opencode', label: 'OpenCode', bin: 'opencode', dirs: (p) => [[path.join(p, '.opencode', 'agents'), 'project'], [path.join(os.homedir(), '.config', 'opencode', 'agents'), 'user']] },
  // Codex defines its agents in TOML (name, description, developer_instructions; `role` optional)
  codex: { id: 'codex', label: 'Codex', bin: 'codex', ext: '.toml', dirs: (p) => [[path.join(p, '.codex', 'agents'), 'project'], [path.join(os.homedir(), '.codex', 'agents'), 'user']] },
};
export const HARNESS_IDS = Object.keys(HARNESSES);
export const harnessId = (h) => ({ claude: 'claude-code', 'claude-code': 'claude-code', pi: 'pi', opencode: 'opencode', codex: 'codex' }[String(h || '').toLowerCase()] || null);

const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const normRole = (r) => { const k = String(r ?? '').toLowerCase().trim(); return ROLE_IDS.includes(k) ? k : ROLE_ALIASES[k] || null; };
export const normPhase = (p) => {
  const k = String(p ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return PHASE_ALIASES[k] || k;
};
export const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
/** Pi's config folder (`PI_CODING_AGENT_DIR`, or ~/.pi/agent). */
export const piAgentDir = () => expandHome(process.env.PI_CODING_AGENT_DIR?.trim()) || path.join(os.homedir(), '.pi', 'agent');

export function which(cmd) {
  if (!cmd) return null;
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* sigue */ }
  }
  return null;
}

// ------------------------------------------------------------------ each harness's agents

const unquote = (v) => String(v).trim().replace(/^(['"])(.*)\1$/, '$2');

/** Agent file: markdown with frontmatter (name, description, model, tools) + system prompt. */
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
    // role declared by the harness (optional): it wins over the legacy tables (SUBAGENT_ROLES).
    // It tells three cases apart: key missing → undefined; declared but blank → '' (an attempt
    // without a value, which detectHarness resolves heuristically and reports); declared with a value → string.
    role: meta.role === undefined ? undefined : String(meta.role).trim(),
    tools,
    prompt: body.trim(),
    file,
    meta,
  };
}

/**
 * Codex agent: a flat TOML (name, description, model, developer_instructions and, optionally, the
 * office contract's `role`, as a key or as a `# role: backend` comment). Only top-level keys
 * (before the first table) are read.
 */
export function parseAgentToml(text, file = 'agent.toml') {
  const src = String(text);
  const top = src.split(/^\s*\[/m)[0];
  const meta = {};
  const rx = /^([A-Za-z_][\w-]*)\s*=\s*("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'|[^\n#]+)/gm;
  for (const m of top.matchAll(rx)) {
    const raw = m[2].trim();
    let v = raw;
    if (raw.startsWith('"""') || raw.startsWith("'''")) v = raw.slice(3, -3).replace(/^\r?\n/, '');
    else if (raw.startsWith('"')) { try { v = JSON.parse(raw); } catch { v = raw.slice(1, -1); } }
    else if (raw.startsWith("'")) v = raw.slice(1, -1);
    meta[m[1]] = v;
  }
  const role = meta.role ?? (top.match(/^#\s*(?:dev-team-office\s+)?role\s*:\s*(\S+)/m) || [])[1];
  return {
    name: typeof meta.name === 'string' && meta.name ? meta.name : path.basename(file, '.toml'),
    description: typeof meta.description === 'string' ? meta.description : '',
    model: typeof meta.model === 'string' && meta.model ? meta.model : undefined,
    role: role === undefined ? undefined : String(role).trim(),
    tools: [],
    prompt: String(meta.developer_instructions || '').trim(),
    file,
  };
}

export function discoverAgents(projectDir) {
  const out = {};
  for (const h of Object.values(HARNESSES)) {
    const found = new Map();
    const ext = h.ext || '.md';
    const parse = ext === '.toml' ? parseAgentToml : parseAgentFile;
    for (const [dir, scope] of h.dirs(projectDir)) {
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort(); } catch { continue; }
      for (const f of files) {
        try {
          const a = parse(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f));
          if (!found.has(a.name)) found.set(a.name, { ...a, scope });
        } catch { /* ilegible */ }
      }
    }
    out[h.id] = [...found.values()];
  }
  return out;
}

// ------------------------------------------------------------------ project and pipelines

function readJson(file, errors) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') errors.push(`${path.basename(file)}: ${err.message}`);
    return null;
  }
}

/** Reads <dir>/.devteam/ (team.json + pipelines/*.json). Never throws: problems go in `errors`. */
export function loadProject(dir) {
  const root = path.resolve(expandHome(dir || process.cwd()));
  const cfg = path.join(root, CONFIG_DIR);
  const errors = [];
  const team = readJson(path.join(cfg, 'team.json'), errors) || {};
  const agents = discoverAgents(root);
  const pipelines = [];
  let files = [];
  try { files = fs.readdirSync(path.join(cfg, 'pipelines')).filter((f) => f.endsWith('.json')).sort(); } catch { /* no pipelines */ }
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

/** Validates a pipeline and fills it in with team.json and the agent files. */
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
      model: s.model === false ? null : s.model || roleCfg.model || def?.model || null, // false: the session's
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

/** What the agent announces to the office: which pipelines it can run in this project. */
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

// ------------------------------------------------------------------ a project's "harness engineering"
//
// Each project brings its own way of working: an orchestrator with subagents, commands that
// start its pipeline, prompts... Here we detect what it brings and where to enter, so a
// prompt sent from the office starts THAT pipeline (not one made up by the office).

/** Role of the subagents of known harnesses (Errementari, gentle-pi / gentle-ai). */
export const SUBAGENT_ROLES = {
  pipeline: 'manager', spec: 'analyst', architect: 'tl', qa: 'qa', backend: 'backend', frontend: 'frontend', explore: 'analyst',
  researcher: 'analyst', 'sdd-init': 'manager', 'sdd-onboard': 'manager', 'sdd-status': 'manager', 'sdd-explore': 'analyst',
  'sdd-research': 'analyst', 'sdd-proposal': 'po', 'sdd-spec': 'analyst', 'sdd-design': 'tl', 'sdd-tasks': 'manager',
  'sdd-apply': 'backend', 'sdd-remediate': 'backend', 'sdd-verify': 'qa', 'sdd-archive': 'manager', 'gentle-ai-explore': 'analyst',
  'gentle-ai-worker': 'backend', 'gentle-ai-verify': 'qa', 'review-risk': 'tl', 'review-readability': 'tl', 'review-reliability': 'tl',
  'review-resilience': 'tl', 'jd-judge-a': 'tl', 'jd-judge-b': 'tl', 'jd-fix-agent': 'backend',
};
// Did the harness declare a role with a value? undefined (no key), null and blank text count
// as "not declared": the predicate shared by roleOfAgent and detectHarness.
export const hasDeclaredRole = (declared) => declared !== undefined && declared !== null && String(declared).trim() !== '';

// The role a text suggests (a subagent's description, a task's label). null if nothing matches.
export const TEXT_RULES = [
  ['po', /product|producto|user stor|historias? de usuario|backlog|priori|roadmap|acceptance|aceptaci[oó]n|criterios?/i],
  ['qa', /\bqa\b|\btests?\b|testing|pruebas?\b|\be2e\b|end-to-end|regresi[oó]n|verificar|verify|calidad|quality|cobertura|coverage/i],
  ['designer', /dise[ñn]|design|\bux\b|figma|mockup|wireframe|paleta|palette|tipograf|typograph|brand|marca|icono|icon|logo|visual/i],
  ['frontend', /front|\bui\b|css|component|react|vue|svelte|p[aá]gina|\bpage|layout|responsive|html|browser|navegador|vista/i],
  ['backend', /back(?!log)|\bapi\b|endpoint|server|servidor|database|base de datos|\bdb\b|sql|migra|auth|queue|cola|worker|cache/i],
  ['tl', /review|revis|refactor|architect|arquitect|\bplan|bug|debug|security|seguridad|performance|rendimiento|lint/i],
  ['analyst', /analy|anali|research|investig|explor|busca|search|find|requirement|requisit|negocio|business|datos|data|m[eé]trica|metric|document/i],
  ['manager', /coordin|status|report|estado|deploy|release|schedule|agenda/i],
];
export function roleFromText(text = '') {
  for (const [role, rx] of TEXT_RULES) if (rx.test(String(text))) return role;
  return null;
}

/** A folder's project root: its git repository's (never $HOME or /), or the folder itself. */
export function projectRoot(dir) {
  const start = path.resolve(expandHome(dir || process.cwd()));
  const home = path.resolve(os.homedir());
  for (let d = start; d !== path.dirname(d) && d !== home; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
  }
  return start;
}

// Precedence: a role declared by the harness wins over the legacy tables; if it is declared
// but cannot be normalized, it returns null and is reported as an issue (it is not silently
// replaced by a guess); a blank declaration is an attempt without a value and falls back to the
// legacy heuristic (but is reported); without a declaration, the legacy heuristic is used (SUBAGENT_ROLES + name).
export const roleOfAgent = (name, declared) => {
  if (hasDeclaredRole(declared)) return normRole(declared);
  const k = String(name || '').toLowerCase();
  return SUBAGENT_ROLES[k] || normRole(k) || null;
};

// Errementari (https://github.com/fmunoztorrent/errementari): the `pipeline` agent classifies the
// request and runs it through spec → architect → qa → backend/frontend → qa → close. Entered with /task.
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
 * Which harness engineering a directory has and where its pipeline starts.
 * entries: [{ id, label, description, harnesses, command?, prefix?, devteam?, stages?, issues?, source }]
 *   - "Direct prompt": the harness's default agent receives it (it may auto-classify)
 *   - Errementari: /task and its flows (feature, bugfix, chore, debug)
 *   - Claude Code commands (.claude/commands), OpenCode's (opencode.json, .opencode/command)
 *     and Pi prompts (.pi/prompts, ~/.pi/agent/prompts)
 *   - Dev Team Office pipelines (.devteam/pipelines): run by an open session
 */
export function detectHarness(dir) {
  const root = path.resolve(expandHome(dir || process.cwd()));
  const has = (...p) => fs.existsSync(path.join(root, ...p));
  const harnesses = [];
  if (has('.claude') || has('CLAUDE.md')) harnesses.push('claude-code');
  if (has('opencode.json') || has('opencode.jsonc') || has('.opencode')) harnesses.push('opencode');
  if (has('.pi')) harnesses.push('pi');
  if (has('.codex')) harnesses.push('codex');
  const kinds = [];
  const entries = [{ id: 'prompt', label: 'Prompt directo', description: 'El prompt tal cual: lo recibe el agente por defecto del harness.', harnesses: HARNESS_IDS, source: 'agente' }];
  const covered = new Set();

  // Errementari: its manifest, or (older installs) its pipeline + the orchestrator agent
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
    ...readCommands(path.join(piAgentDir(), 'prompts'), 'pi', 'user'),
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

  // which subagent is which role (so the right character moves when the orchestrator delegates):
  // the declared one (`role:`), the one from its name or, otherwise, the one its description suggests
  const roles = {};
  const roleIssues = [];
  const subagents = [];
  // project ones before global ones (~/.claude/agents, ~/.pi/agent/agents…): with the same name, the project's wins
  const all = Object.entries(project.agents).flatMap(([harness, list]) => list.map((a) => ({ ...a, harness })));
  all.sort((x, y) => (x.scope === 'project' ? 0 : 1) - (y.scope === 'project' ? 0 : 1));
  for (const a of all) {
    const { harness } = a;
    const declared = a.role;
    let r = roleOfAgent(a.name, declared);
    let how = hasDeclaredRole(declared) ? 'declared' : r ? 'name' : null;
    if (!r && !hasDeclaredRole(declared)) { r = roleFromText(`${a.name} ${a.description}`); if (r) how = 'description'; }
    subagents.push({ name: a.name, harness, scope: a.scope, role: r, how, description: clip(a.description, 160), file: a.file });
    if (r) roles[a.name.toLowerCase()] ??= r;
    // role declaration contract:
    //   blank (attempt without a value) → legacy heuristic, but reported
    //   non-empty and not normalizable → null, left out of the map, and reported
    //   missing → legacy heuristic, not reported
    if (hasDeclaredRole(declared)) {
      if (!r) roleIssues.push(`rol desconocido "${declared}" declarado por el agente "${a.name}" (usa ${ROLE_IDS.join(', ')})`);
    } else if (declared !== undefined) {
      roleIssues.push(`rol en blanco declarado por el agente "${a.name}"`);
    }
  }
  if (opencode.default_agent && roleOfAgent(opencode.default_agent)) roles[opencode.default_agent.toLowerCase()] = roleOfAgent(opencode.default_agent);

  return { dir: root, name: project.team.name || path.basename(root), exists: fs.existsSync(root), harnesses, kinds, entries, roles, roleIssues, subagents, defaultAgent: opencode.default_agent || null };
}

/** The text (or command) that starts a harness entry with the user's task. */
export function invocation(entry, text) {
  text = String(text ?? '').trim();
  if (!entry?.command) return { text };
  const args = `${entry.prefix || ''}${text}`;
  return { text: `/${entry.command} ${args}`, command: entry.command, args };
}

/**
 * A Claude Code command, expanded, to hand to a session that is already open (the Stop hook
 * cannot run a slash command: it hands its text to Claude).
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
 * Executable and arguments for a new agent session, without a shell (the task goes as a single
 * argument). opts: { bin, args } of the registered agent.
 */
export function agentCommand(harness, inv, { bin, args } = {}) {
  const h = harnessId(harness);
  if (!h) return { error: `no sé lanzar "${harness}"`, code: 'unknown', bin: harness };
  const exe = which(expandHome(bin || (h === 'claude-code' ? process.env.DEV_TEAM_OFFICE_CLAUDE_BIN : '') || HARNESSES[h].bin));
  if (!exe) return { error: `no encuentro "${bin || HARNESSES[h].bin}" en el PATH`, code: 'missing', bin: bin || HARNESSES[h].bin };
  const extra = Array.isArray(args) ? args.map(String) : null;
  if (h === 'claude-code') return { exe, argv: ['-p', inv.text, ...(extra ?? ['--permission-mode', 'acceptEdits'])] };
  if (h === 'opencode') return { exe, argv: inv.command ? ['run', '--command', inv.command, ...(extra ?? []), inv.args] : ['run', ...(extra ?? []), inv.text] };
  if (h === 'codex') return { exe, argv: ['exec', ...(extra ?? ['--sandbox', 'workspace-write']), inv.text] };
  return { exe, argv: ['-p', ...(extra ?? []), inv.text] };
}

/**
 * A side question ("btw"): the terminal-less equivalent of Claude Code's /btw. It answers with the
 * on-duty session's context without adding anything to it (it forks and is not saved) and without touching files.
 *   claude   -p … --resume <session> --fork-session --no-session-persistence --permission-mode plan
 *   opencode run --session <session> --fork --agent plan …
 *   pi       -p --fork <session> --no-session --tools read,grep,find,ls …
 *   codex    exec --sandbox read-only --skip-git-repo-check …   (no fork: the context goes in the text)
 */
export function askCommand(harness, { question, session, bin } = {}) {
  const h = harnessId(harness);
  if (!h) return { error: `no sé preguntarle a "${harness}"`, code: 'unknown', bin: harness };
  const exe = which(expandHome(bin || (h === 'claude-code' ? process.env.DEV_TEAM_OFFICE_CLAUDE_BIN : '') || HARNESSES[h].bin));
  if (!exe) return { error: `no encuentro "${bin || HARNESSES[h].bin}" en el PATH`, code: 'missing', bin: bin || HARNESSES[h].bin };
  const q = String(question || '');
  const sid = session && /^[\w.:-]{4,200}$/.test(String(session)) ? String(session) : null;
  if (h === 'claude-code') return { exe, forked: !!sid, argv: ['-p', q, ...(sid ? ['--resume', sid, '--fork-session'] : []), '--no-session-persistence', '--permission-mode', 'plan'] };
  if (h === 'opencode') return { exe, forked: !!sid, argv: ['run', ...(sid ? ['--session', sid, '--fork'] : []), '--agent', 'plan', q] };
  if (h === 'pi') return { exe, forked: !!sid, argv: ['-p', ...(sid ? ['--fork', sid] : []), '--no-session', '--tools', 'read,grep,find,ls', q] };
  return { exe, forked: false, argv: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', q] };
}

// ------------------------------------------------------------------ running inside the session

const render = (tpl, vars) => tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Sequential execution order that respects `needs` (and the declaration order). */
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
 * A pipeline running inside an agent's session. It is a state machine:
 *   start()          → { action: 'prompt', stage, prompt }   the first stage
 *   advance(output)  → the current stage finished with that summary: runs its gate, applies the
 *                      loop if it fails, and returns the next action:
 *                      { action: 'prompt', stage, prompt } | { action: 'done' } | { action: 'failed', reason }
 * The agent's integration does what each action asks (send the prompt to its session,
 * change model…) and calls advance() when the agent ends its turn.
 *
 * report(event) receives events for the office (phases, board, gates, end) and onStatus(status)
 * the pipeline's state for its panel.
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

  /** For the Claude Code hook, which lives one process per event: the state goes to disk. */
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
    // the office learns which subagent is which role (if a stage delegates to subagents)
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

  /** The current stage finished (the agent closed its turn) with this summary. */
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

  /** The stage could not even start (e.g. the model is not available). */
  fail(reason) { const st = this.currentStage; return st ? this.#fail(st, reason) : this.#finish('failed', reason); }

  #fail(st, reason) {
    this.report({ kind: 'stage_end', role: st.role, ok: false, text: `✖ ${st.name}: ${clip(reason, 120)}` });
    const target = st.onFail && this.stage(st.onFail.goto);
    if (target && st.loops < st.onFail.max) {
      st.loops++;
      // it repeats from `goto`: that stage and everything that depends on it go back to pending
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
    this.#todos(); // before the end: any later event would put the session back "in progress"
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

// ------------------------------------------------------------------ agent utilities

/** Runs a gate in the project. */
export function runGate(command, cwd, timeoutSec = 600) {
  return new Promise((resolve) => {
    const tail = [];
    const collect = (d) => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) { tail.push(clip(l, 300)); if (tail.length > 20) tail.shift(); } };
    const child = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already finished */ } }, timeoutSec * 1000);
    child.on('error', (err) => { clearTimeout(timer); resolve({ passed: false, tail: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ passed: code === 0, tail: tail.join('\n') }); });
  });
}

/** The assistant's last reply in a Claude Code transcript (JSONL). */
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

/** The model the session answered with (the assistant's last message in the transcript). */
export function lastAssistantModel(transcriptPath) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'assistant' && entry.message?.model && entry.message.model !== '<synthetic>') return entry.message.model;
    } catch { /* broken line */ }
  }
  return '';
}

/** Does the stage ask for the model the session already has? ("opus", "claude-opus-5-5", "anthropic/claude-opus-5-5"…) */
export function sameModel(wanted, current) {
  const w = String(wanted || '').toLowerCase().replace(/^anthropic\//, '').replace(/\[.*\]$/, '');
  const c = String(current || '').toLowerCase().replace(/\[.*\]$/, '');
  if (!w || !c) return false;
  if (['opus', 'sonnet', 'haiku', 'fable'].includes(w)) return c.includes(w);
  return c === w || c.startsWith(`${w}-`);
}

/** Text of an assistant message (Pi and OpenCode use parts { type: 'text', text }). */
export const textOf = (message) => (Array.isArray(message?.content || message?.parts) ? (message.content || message.parts) : [])
  .filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n').trim();

/**
 * A Claude Code stage with a model different from the session's: hooks cannot change a session's
 * model, so it runs as `claude -p --model …` and its result goes back to the session.
 */
export function claudeChild({ prompt, model, agent, cwd, env = {}, bin, args }) {
  const exe = which(expandHome(bin || process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || 'claude'));
  if (!exe) return Promise.resolve({ ok: false, output: 'no encuentro "claude" en el PATH' });
  const argv = ['-p', '--output-format', 'json'];
  if (model) argv.push('--model', String(model).replace(/^anthropic\//, '')); // Claude uses aliases or ids without a provider
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

/** Sends in order: the office's events tell a story (phase → tools → end). */
export function inOrder(fn) {
  let chain = Promise.resolve();
  return (...args) => (chain = chain.then(() => fn(...args), () => fn(...args)));
}

/** Minimal HTTP client to the office (in order). Never throws: the office is optional. */
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
