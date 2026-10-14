// ⚙ Ajustes: leer, validar y guardar lo que la interfaz permite configurar.
//
// - Oficina  (~/.dev-team-office/config.json): proyectos conocidos, directorio por defecto y
//   comandos para lanzar cada agente.
// - Proyecto (<proyecto>/.devteam/team.json): harness por defecto, orquestador, paralelismo,
//   agente/modelo/harness por rol y opciones de cada harness (p. ej. permisos de Claude).
// - Pipelines (<proyecto>/.devteam/pipelines/<id>.json).
//
// Todo se valida antes de escribir: un error devuelve { ok: false, error } y no toca el archivo.

import fs from 'node:fs';
import path from 'node:path';
import { configFile, loadConfig, DEFAULT_LAUNCHERS } from './tasks.js';
import { CONFIG_DIR, expandHome, loadProject, resolvePipeline } from './project.js';
import { HARNESSES, harnessId, discoverAgents, which } from './harness/index.js';
import { ROLE_IDS, normRole } from './roles.js';

const COLOR_RX = /^#[0-9a-f]{6}$/i;
const APPEARANCE = { name: 'text', title: 'text', shirt: 'color', pants: 'color', hair: 'color', skin: 'color', long: 'bool', beard: 'bool', glasses: 'bool' };

export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
const ID_RX = /^[\w-]{1,40}$/;

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };
const isDir = (d) => !!d && fs.statSync(d, { throwIfNoEntry: false })?.isDirectory();

function writeJson(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  fs.renameSync(tmp, file); // atómico: nunca queda un archivo a medio escribir
}

const guard = (fn) => (...args) => {
  try { return fn(...args); } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    return { ok: false, error: `no se pudo guardar: ${err.message}` };
  }
};

// ---------------------------------------------------------------- Oficina

export function readOfficeSettings() {
  const raw = loadConfig();
  const launchers = { ...DEFAULT_LAUNCHERS, ...(raw.launchers || {}) };
  return {
    file: configFile(),
    projects: raw.projects || [],
    cwd: raw.cwd || '',
    appearance: raw.appearance || {},
    launchers: Object.fromEntries(Object.entries(launchers).map(([a, cmd]) => [a, { command: cmd, available: !!which(expandHome(cmd[0])), custom: !!raw.launchers?.[a] }])),
    defaults: { launchers: DEFAULT_LAUNCHERS },
  };
}

/**
 * patch: { projects?: string[], cwd?: string, launchers?: { agente: string[] | null },
 *         appearance?: { rol: { name, title, shirt, pants, hair, skin, long, beard, glasses } | null } }
 * (null = volver al de fábrica)
 */
export const writeOfficeSettings = guard((patch = {}) => {
  const raw = loadConfig();
  const next = { ...raw };
  if (patch.projects !== undefined) {
    if (!Array.isArray(patch.projects)) fail('projects debe ser una lista');
    const seen = new Set();
    next.projects = patch.projects.map((p) => path.resolve(expandHome(String(p).trim()))).filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      if (!isDir(p)) fail(`no existe el directorio ${p}`);
      return true;
    });
  }
  if (patch.cwd !== undefined) {
    const cwd = String(patch.cwd || '').trim();
    if (cwd && !isDir(expandHome(cwd))) fail(`no existe el directorio ${cwd}`);
    if (cwd) next.cwd = cwd; else delete next.cwd;
  }
  if (patch.launchers !== undefined) {
    const launchers = { ...(raw.launchers || {}) };
    for (const [agent, cmd] of Object.entries(patch.launchers || {})) {
      if (!DEFAULT_LAUNCHERS[agent]) fail(`agente desconocido: ${agent}`);
      if (cmd === null || (Array.isArray(cmd) && cmd.join(' ') === DEFAULT_LAUNCHERS[agent].join(' '))) { delete launchers[agent]; continue; }
      if (!Array.isArray(cmd) || !cmd.length || !cmd.every((x) => typeof x === 'string' && x.length)) fail(`el comando de ${agent} no es válido`);
      if (!cmd.some((x) => x.includes('{task}'))) fail(`el comando de ${agent} debe incluir {task} (ahí va la tarea)`);
      launchers[agent] = cmd;
    }
    if (Object.keys(launchers).length) next.launchers = launchers; else delete next.launchers;
  }
  if (patch.appearance !== undefined) {
    const appearance = { ...(raw.appearance || {}) };
    for (const [key, look] of Object.entries(patch.appearance || {})) {
      const role = normRole(key) || fail(`rol desconocido: ${key}`);
      if (look === null) { delete appearance[role]; continue; }
      const clean = {};
      for (const [k, v] of Object.entries(look || {})) {
        const type = APPEARANCE[k] || fail(`${role}: no se puede cambiar "${k}"`);
        if (type === 'color') { if (!COLOR_RX.test(String(v))) fail(`${role}.${k}: usa un color como #3f73f0`); clean[k] = String(v).toLowerCase(); }
        else if (type === 'bool') clean[k] = !!v;
        else {
          const t = String(v ?? '').trim();
          if (!t) fail(`${role}.${k} no puede quedar vacío`);
          clean[k] = t.slice(0, k === 'name' ? 20 : 30);
        }
      }
      if (Object.keys(clean).length) appearance[role] = clean; else delete appearance[role];
    }
    if (Object.keys(appearance).length) next.appearance = appearance; else delete next.appearance;
  }
  writeJson(configFile(), next, 0o600);
  return { ok: true, config: next, settings: readOfficeSettings() };
});

// ---------------------------------------------------------------- Proyecto

export function readProjectSettings(dir) {
  const root = path.resolve(expandHome(dir));
  const p = loadProject(root);
  const pipelines = p.pipelines.map((pl) => {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG_DIR, 'pipelines', `${pl.id}.json`), 'utf8')); } catch { /* ilegible */ }
    return { id: pl.id, name: pl.name, raw, issues: pl.issues };
  });
  return {
    dir: root, name: p.name, hasConfig: p.hasConfig, errors: p.errors, team: p.team,
    harnesses: p.harnesses,
    agents: Object.fromEntries(Object.entries(discoverAgents(root)).map(([h, list]) => [h, list.map((a) => ({ name: a.name, model: a.model, description: a.description, scope: a.scope }))])),
    pipelines,
    claudePermissionModes: CLAUDE_PERMISSION_MODES,
  };
}

function cleanTeam(team) {
  if (!team || typeof team !== 'object' || Array.isArray(team)) fail('team debe ser un objeto');
  const out = {};
  if (team.name) out.name = String(team.name).slice(0, 80);
  if (team.harness) out.harness = harnessId(team.harness) || fail(`harness desconocido: ${team.harness}`);
  if (team.maxParallel !== undefined && team.maxParallel !== '') {
    const n = Number(team.maxParallel);
    if (!Number.isInteger(n) || n < 1 || n > 8) fail('etapas en paralelo: un número de 1 a 8');
    out.maxParallel = n;
  }
  const str = (v, max = 120) => (v === undefined || v === null || v === '' ? undefined : String(v).trim().slice(0, max) || undefined);
  if (team.roles) {
    out.roles = {};
    for (const [key, cfg] of Object.entries(team.roles)) {
      const role = normRole(key);
      if (!role) fail(`rol desconocido: ${key} (usa ${ROLE_IDS.join(', ')})`);
      const r = { harness: cfg?.harness ? harnessId(cfg.harness) || fail(`harness desconocido en ${role}: ${cfg.harness}`) : undefined, agent: str(cfg?.agent, 60), model: str(cfg?.model), thinking: str(cfg?.thinking, 20) };
      const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) out.roles[role] = clean;
    }
    if (!Object.keys(out.roles).length) delete out.roles;
  }
  if (team.orchestrator) {
    const o = { harness: team.orchestrator.harness ? harnessId(team.orchestrator.harness) || fail('harness del orquestador desconocido') : undefined, agent: str(team.orchestrator.agent, 60), model: str(team.orchestrator.model) };
    const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) out.orchestrator = clean;
  }
  if (team.harnessOptions) {
    out.harnessOptions = {};
    for (const [h, opts] of Object.entries(team.harnessOptions)) {
      const id = harnessId(h) || fail(`harness desconocido: ${h}`);
      const o = {};
      if (opts?.bin) o.bin = String(opts.bin).trim();
      if (opts?.args !== undefined) {
        if (!Array.isArray(opts.args) || !opts.args.every((a) => typeof a === 'string')) fail(`args de ${id} debe ser una lista de textos`);
        o.args = opts.args;
      }
      if (Object.keys(o).length) out.harnessOptions[id] = o;
    }
    if (!Object.keys(out.harnessOptions).length) delete out.harnessOptions;
  }
  return out;
}

export const writeTeam = guard((dir, team) => {
  const root = path.resolve(expandHome(dir));
  if (!isDir(root)) fail('el proyecto no existe');
  writeJson(path.join(root, CONFIG_DIR, 'team.json'), cleanTeam(team));
  return { ok: true, project: readProjectSettings(root) };
});

/** Valida un pipeline sin guardarlo: devuelve los problemas que vería el diálogo. */
export function checkPipeline(dir, id, pipeline) {
  const root = path.resolve(expandHome(dir));
  if (!ID_RX.test(String(id || ''))) return { ok: false, error: 'el id sólo admite letras, números, - y _ (hasta 40)' };
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline)) return { ok: false, error: 'el pipeline debe ser un objeto JSON' };
  const p = loadProject(root);
  const resolved = resolvePipeline(id, pipeline, p.team, discoverAgents(root));
  const blocking = resolved.issues.filter((i) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido/.test(i));
  return { ok: !blocking.length, issues: resolved.issues, error: blocking[0] };
}

export const writePipeline = guard((dir, id, pipeline) => {
  const check = checkPipeline(dir, id, pipeline);
  if (!check.ok) fail(check.error);
  const root = path.resolve(expandHome(dir));
  writeJson(path.join(root, CONFIG_DIR, 'pipelines', `${id}.json`), pipeline);
  return { ok: true, issues: check.issues, project: readProjectSettings(root) };
});

export const deletePipeline = guard((dir, id) => {
  if (!ID_RX.test(String(id || ''))) fail('id inválido');
  const root = path.resolve(expandHome(dir));
  const file = path.join(root, CONFIG_DIR, 'pipelines', `${id}.json`);
  if (!fs.existsSync(file)) fail(`no existe el pipeline ${id}`);
  fs.rmSync(file);
  return { ok: true, project: readProjectSettings(root) };
});

export const PIPELINE_TEMPLATE = {
  name: 'Nuevo pipeline',
  description: 'Qué hace y en qué orden',
  strategy: 'office',
  stages: [
    { id: 'plan', name: 'Plan', role: 'tl', phase: 'arquitectura' },
    { id: 'impl', name: 'Implementación', role: 'backend', phase: 'implementa', needs: ['plan'] },
    { id: 'verifica', name: 'Verificación', role: 'qa', phase: 'verifica', needs: ['impl'], check: { run: 'npm test', expect: 'pass' }, onFail: { goto: 'impl', max: 2 } },
  ],
};

export const HARNESS_LIST = Object.values(HARNESSES).map((h) => ({ id: h.id, label: h.label }));
