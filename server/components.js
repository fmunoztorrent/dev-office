// The company's map and a directive's impact on it. The map is departments (offices) → projects (the
// registered agents' folders) → components: the parts of each project, detected from its folder (its
// workspaces: package.json and pnpm-workspace.yaml; or the usual folders: apps/, packages/, services/…)
// plus the ones you declare (the store's `components`).
//
// The impact of an order (mapImpact) is read from its words, without asking any model: the departments,
// projects and components it names (and the projects you chose), and what it seems to name that is not
// on the map ("the notifications service", `billing-api`): those are asked before it goes (does it exist,
// and where? is it a new component? a new department?). The systems (server/systems.js) count too: naming
// one takes all its artifacts, and a change to an artifact reaches whoever uses it (core → bff → web).

import fs from 'node:fs';
import path from 'node:path';
import { t } from '../public/i18n.js';
import { realDir, insideDir } from './paths.js';
import { consumersOf, detectKind } from './systems.js';

const CACHE_MS = 60_000;
const COMPONENTS_MAX = 60;
// the usual folders of a repository with several parts
const PART_DIRS = ['apps', 'packages', 'services', 'libs', 'modules', 'microservices', 'functions', 'workers', 'cmd', 'crates', 'projects'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '__pycache__']);
// names too common to tell a part by themselves: they count only if their project is named too
const GENERIC = new Set(['api', 'app', 'apps', 'web', 'www', 'lib', 'libs', 'core', 'common', 'shared', 'utils', 'util', 'src', 'server', 'client', 'docs', 'doc', 'test', 'tests', 'scripts', 'packages', 'services', 'ui', 'frontend', 'backend', 'config', 'types', 'main', 'admin', 'site']);

/** Lowercase, without accents, and only letters and digits separated by one space. */
export const words = (s) => ` ${String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const says = (text, name) => { const w = words(name).trim(); return w.length > 1 && text.includes(` ${w} `); };

// ---------------------------------------------------------------- the components of a folder

const seen = new Map(); // dir → { at, list }

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name)).map((d) => d.name).sort(); } catch { return []; } };

/** The workspace patterns of a repository: package.json's `workspaces` and pnpm-workspace.yaml's `packages`. */
function workspaces(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const out = [].concat(Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages || []);
  try {
    const yaml = fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
    let inside = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inside = true; continue; }
      if (inside && /^\S/.test(line)) inside = false;
      const m = inside && line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
      if (m) out.push(m[1]);
    }
  } catch { /* no pnpm workspace */ }
  return out.map(String).filter((p) => p && !p.startsWith('!'));
}

/**
 * The parts of a project, from its folder: [{ name, path }] (path relative to it). Its workspaces if
 * it has them, otherwise the usual folders (apps/web, services/billing…). None: the project is one piece.
 */
export function detectComponents(dir, { now = Date.now() } = {}) {
  const hit = seen.get(dir);
  if (hit && now - hit.at < CACHE_MS) return hit.list;
  const found = new Map();
  const add = (rel) => {
    const abs = path.join(dir, rel);
    if (!isDir(abs) || found.size >= COMPONENTS_MAX) return;
    const pkg = readJson(path.join(abs, 'package.json'));
    const name = String(pkg?.name || path.basename(rel)).replace(/^@[^/]+\//, '');
    if (!found.has(rel)) found.set(rel, { name, path: rel, kind: detectKind(abs) });
  };
  const expand = (pattern) => {
    const clean = pattern.replace(/\/\*\*$/, '/*').replace(/\/$/, '');
    if (clean.endsWith('/*')) { const base = clean.slice(0, -2); for (const d of subdirs(path.join(dir, base))) add(path.posix.join(base, d)); } else if (!clean.includes('*')) add(clean);
  };
  const ws = workspaces(dir);
  if (ws.length) ws.forEach(expand);
  else for (const base of PART_DIRS) for (const d of subdirs(path.join(dir, base))) add(`${base}/${d}`);
  const list = [...found.values()];
  seen.set(dir, { at: now, list });
  return list;
}

// ---------------------------------------------------------------- the company's map

/**
 * Departments → projects → components (detected and declared). `who`: the office's name for the
 * main one ('' in the store).
 */
export function companyMap(store, { name = (o) => o.name } = {}) {
  const agents = store.listAgents();
  const declared = store.listComponents();
  const systems = store.listSystems?.() || [];
  return store.listOffices().map((o) => ({
    id: o.id, name: name(o),
    projects: agents.filter((a) => a.office === o.id).map((a) => {
      const own = declared.filter((c) => c.project === realDir(a.path)).map((c) => ({ id: c.id, name: c.name, path: c.path, description: c.description, declared: true }));
      const auto = detectComponents(a.path).filter((c) => !own.some((x) => x.path && x.path === c.path) && !own.some((x) => words(x.name) === words(c.name)));
      return { id: a.id, name: a.name, path: a.path, harness: a.harness, kind: detectKind(a.path), components: [...own, ...auto.map((c) => ({ ...c, declared: false }))] };
    }),
    // the systems this department answers for (their artifacts may be repos of other departments: shared)
    systems: systems.filter((s) => s.office === o.id).map((s) => ({ id: s.id, name: s.name, instructions: s.instructions, parts: s.parts })),
  }));
}

// ---------------------------------------------------------------- what an order names that is not on the map

// the words that announce a part of the system ("the X service", "el servicio de X", "la app X"…)
const PART_ES = ['servicio', 'microservicio', 'componente', 'modulo', 'app', 'aplicacion', 'api', 'bff', 'worker', 'repo', 'repositorio', 'portal', 'backoffice', 'sistema', 'frontend', 'backend', 'pasarela', 'gateway', 'dashboard', 'sdk', 'bot'];
const PART_EN = ['service', 'microservice', 'component', 'module', 'app', 'application', 'api', 'bff', 'worker', 'repo', 'repository', 'portal', 'backoffice', 'system', 'frontend', 'backend', 'gateway', 'dashboard', 'sdk', 'bot'];
const PART = new Set([...PART_ES, ...PART_EN]);
const LINKS = [['de', 'la'], ['de', 'los'], ['de', 'las'], ['del'], ['de'], ['para', 'el'], ['para', 'la'], ['para'], ['of', 'the'], ['of'], ['for', 'the'], ['for']];
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'que', 'y', 'o', 'a', 'en', 'con', 'para', 'por', 'se', 'su', 'sus', 'este', 'esta', 'ese', 'esa', 'cada', 'todo', 'toda', 'todos', 'todas', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'actual', 'mismo', 'misma', 'otro', 'otra', 'nuestro', 'nuestra',
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'with', 'for', 'by', 'its', 'their', 'our', 'this', 'that', 'these', 'those', 'every', 'each', 'all', 'any', 'new', 'same', 'other', 'current', 'existing', 'main', 'one', 'some', 'no', 'your', 'my']);
// platforms: "la app móvil", "the web app"
const PLATFORM = new Set(['movil', 'mobile', 'web', 'ios', 'android', 'desktop', 'escritorio']);
// a bare hyphenated name counts as a part when one of its words says so (payments-api, user_service)
const PART_WORD = new Set([...PART, 'svc', 'web', 'ui', 'server', 'client', 'sdk', 'gateway', 'gw', 'db', 'admin', 'core', 'lib', 'cli', 'bot', 'job', 'jobs', 'cron']);
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'en', 'y', 'para', 'con', 'un', 'una', 'del', 'se', 'por']);
const EN_WORDS = new Set(['the', 'of', 'and', 'to', 'in', 'for', 'with', 'a', 'an', 'is', 'on', 'every', 'each']);

/** What the order seems to name as a part of the system: [{ phrase (as written), name (as written), key (the name, in `words`) }]. */
export function namedParts(text) {
  const src = String(text ?? '');
  const toks = [...src.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ raw: m[0], w: fold(m[0]), at: m.index, end: m.index + m[0].length }));
  const span = (i, j) => src.slice(toks[i].at, toks[j].end);
  const english = toks.filter((x) => EN_WORDS.has(x.w)).length > toks.filter((x) => ES_WORDS.has(x.w)).length;
  const out = [];
  const add = (phrase, name) => {
    const key = words(name).trim();
    if (!key || key.length < 3 || STOP.has(key)) return;
    // one thing, said once: "payments-api" already covers "payments"
    if (out.some((x) => ` ${x.key} `.includes(` ${key} `) || ` ${key} `.includes(` ${x.key} `))) return;
    out.push({ phrase: String(phrase).trim().replace(/\s+/g, ' ').slice(0, 60), key, name: String(name).trim().slice(0, 60) });
  };
  // `billing-api`, «notificaciones», "payments-service": one name, in quotes
  for (const m of src.matchAll(/[`«"“']([\p{L}\p{N}][\p{L}\p{N}._-]{1,38})[`»"”']/gu)) if (!/\.\w{1,4}$/.test(m[1])) add(m[1], m[1]);
  // payments-api, user_service: a hyphenated name that says it is a part
  for (const m of src.matchAll(/(?<![\w/.-])([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)(?![\w/.-])/g)) if (m[1].split(/[-_]/).some((w) => PART_WORD.has(w))) add(m[1], m[1]);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].w, one = w.replace(/e?s$/, '');
    if (!PART.has(w) && !PART.has(one)) continue;
    const next = toks[i + 1], prev = toks[i - 1];
    // el servicio de notificaciones · la api de pagos · the module for billing (· la app de pagos móvil)
    for (const link of LINKS) {
      if (!link.every((x, k) => toks[i + 1 + k]?.w === x)) continue;
      const j = i + 1 + link.length;
      if (toks[j] && !STOP.has(toks[j].w) && !PART.has(toks[j].w)) add(span(i, PLATFORM.has(toks[j + 1]?.w) ? j + 1 : j), span(j, PLATFORM.has(toks[j + 1]?.w) ? j + 1 : j));
      break;
    }
    // la app móvil · the web app
    if (['app', 'aplicacion', 'application'].includes(w) && next && PLATFORM.has(next.w)) add(span(i, i + 1), span(i, i + 1));
    if (['app', 'apps', 'application'].includes(w) && prev && PLATFORM.has(prev.w)) add(span(i - 1, i), span(i - 1, i));
    // el servicio Notificaciones · the worker EmailSender: a proper name after the word
    if (next && /^\p{Lu}/u.test(next.raw) && !STOP.has(next.w) && !PART.has(next.w)) add(span(i, i + 1), next.raw);
    // English: the billing service · the payments API (the name first)
    if (english && prev && !STOP.has(prev.w) && !PLATFORM.has(prev.w) && !PART.has(prev.w) && !/^\d+$/.test(prev.w)) add(span(i - 1, i), prev.raw);
  }
  return out;
}

// ---------------------------------------------------------------- the impact

/**
 * What an order touches. `targets`: the projects chosen by hand (they always count).
 * Returns { departments: [{ id, name, impacted, why, projects: [{ id, name, harness, path, impacted, why,
 * components: [{ name, path, declared, impacted }] }] }], unknown: [{ phrase, key, question }], targets, matched }.
 * `why`: 'named' (the order names it), 'chosen' (you picked it), 'part' (it names one of its components).
 */
export function mapImpact(map, text, { targets = [] } = {}) {
  const flat = words(text);
  const chosen = new Set(targets);
  const parts = namedParts(text);
  const known = new Set(); // the keys of the named parts that are on the map
  const knows = (key, name) => { const w = words(name).trim(); return w === key || ` ${w} `.includes(` ${key} `) || ` ${key} `.includes(` ${w} `); };
  const departments = map.map((o) => {
    const deptNamed = !!o.name && o.id !== 'main' && says(flat, o.name);
    for (const p of parts) if (o.name && knows(p.key, o.name)) known.add(p.key);
    const projects = o.projects.map((a) => {
      const projNamed = says(flat, a.name) || says(flat, path.basename(a.path));
      for (const p of parts) if (knows(p.key, a.name)) known.add(p.key);
      const components = a.components.map((c) => {
        const generic = GENERIC.has(words(c.name).trim());
        let hit = !generic && says(flat, c.name);
        for (const p of parts) if (knows(p.key, c.name) && (!generic || projNamed || chosen.has(a.id))) { known.add(p.key); hit = true; }
        if (generic && says(flat, c.name) && (projNamed || chosen.has(a.id))) hit = true;
        return { ...c, impacted: hit };
      });
      const why = chosen.has(a.id) ? 'chosen' : projNamed ? 'named' : components.some((c) => c.impacted) ? 'part' : deptNamed ? 'department' : null;
      return { id: a.id, name: a.name, harness: a.harness, path: a.path, impacted: !!why, why, components };
    });
    const impacted = projects.some((p) => p.impacted) || deptNamed;
    return { id: o.id, name: o.name, impacted, why: deptNamed ? 'named' : impacted ? 'part' : null, projects };
  });
  // the systems: naming one takes all its artifacts; an artifact touched reaches whoever uses it
  const all = departments.flatMap((o) => o.projects);
  const repo = (folder) => all.find((p) => insideDir(folder, p.path) && insideDir(p.path, folder));
  const systems = map.flatMap((o) => (o.systems || []).map((s) => {
    const sysNamed = says(flat, s.name);
    for (const p of parts) if (knows(p.key, s.name)) known.add(p.key);
    const touched = new Set();
    for (const part of s.parts) {
      let named = sysNamed || says(flat, part.name);
      for (const p of parts) if (knows(p.key, part.name)) { known.add(p.key); named = true; }
      const r = repo(part.project);
      // its repo is in for another reason: the artifact is touched (in a repo with several, only the one whose component it names)
      const many = s.parts.filter((x) => x.project === part.project).length > 1;
      const inRepo = r?.impacted && (!many || !part.component || r.components.some((c) => c.impacted && words(c.name) === words(part.component)));
      if (named || inRepo) touched.add(part.name);
    }
    const reached = new Map(); // consumer → the touched artifacts it uses
    for (const n of touched) for (const c of consumersOf(s.parts, n)) if (!touched.has(c)) reached.set(c, [...(reached.get(c) || []), n]);
    for (const [n, via] of reached) {
      const r = repo(s.parts.find((x) => x.name === n).project);
      if (r && !r.impacted) Object.assign(r, { impacted: true, why: 'uses', via: via.join(', ') });
    }
    for (const n of touched) {
      const r = repo(s.parts.find((x) => x.name === n).project);
      if (r && !r.impacted) Object.assign(r, { impacted: true, why: sysNamed ? 'system' : 'part', via: s.name });
    }
    return { id: s.id, name: s.name, office: o.id, impacted: touched.size > 0, parts: s.parts.map((p) => ({ ...p, impacted: touched.has(p.name) ? 'touched' : reached.has(p.name) ? 'uses' : null })) };
  }));
  for (const o of departments) if (!o.impacted && o.projects.some((p) => p.impacted)) Object.assign(o, { impacted: true, why: 'part' });
  const unknown = parts.filter((p) => !known.has(p.key)).map((p) => ({ ...p, question: t('impact.ask', { what: p.phrase }) }));
  const ids = departments.flatMap((o) => o.projects.filter((p) => p.impacted).map((p) => p.id));
  return { departments, systems, unknown, targets: ids, matched: ids.length > 0 };
}

/** The impact in words (for the MCP and the terminal). */
export function impactText(m) {
  const out = [];
  for (const o of m.departments.filter((x) => x.impacted)) {
    out.push(`🏢 ${o.name}`);
    for (const p of o.projects.filter((x) => x.impacted)) {
      const comps = p.components.filter((c) => c.impacted).map((c) => `${c.name}${c.path ? ` (${c.path})` : ''}`);
      out.push(`  📁 ${p.name} — ${t(`impact.why.${p.why}`, { via: p.via || '' })}${comps.length ? `: ${comps.join(', ')}` : ''}`);
    }
  }
  for (const s of (m.systems || []).filter((x) => x.impacted)) out.push(`🧩 ${s.name}: ${s.parts.map((p) => `${p.name}${p.impacted === 'touched' ? ' ✱' : p.impacted === 'uses' ? ' ↺' : ''}`).join(' · ')}`);
  if (!out.length) out.push(t('impact.none'));
  if (m.unknown.length) out.push('', t('impact.unknownHead'), ...m.unknown.map((u) => `  ? ${u.question}`));
  return out.join('\n');
}
