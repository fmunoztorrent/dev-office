// The company's architecture as one graph: how everything on the map relates, from a repository up to
// the whole company.
//
//   areas ─ group ─▶ projects (an office: a floor with its people) ─ own ─▶ repositories
//   repositories ─ call / use / consume / read ─▶ repositories (their relations: declared, or found
//                                                  exploring their folders, server/explore.js)
//   repositories ─ publish / consume / read / call… ─▶ infrastructure (server/resources.js)
//
// A project is composed of its repositories and of the ones of other projects they use (a shared core):
// the order a change goes in follows what each one uses. buildArchitecture() is pure (it takes the map,
// the relations and the resources); architecture(store) reads them from the office's database. The web
// view scopes and lays out this graph (public/architecture.js); `findings` is the review: what on the
// map deserves a look.

import fs from 'node:fs';
import { companyMap } from './components.js';
import { knownResources } from './resources.js';
import { orderParts } from './systems.js';

/**
 * The graph: {
 *   nodes: [{ id, type: 'area' | 'project' | 'repo' | 'resource', name, key, … }],
 *   edges: [{ from, to, kind: 'uses' (a repository uses another: `how`, `note`, `source`, `relation`)
 *            | 'link' (a repository and its infrastructure: `how`) }],
 *   findings: [{ level: 'warn' | 'info', code, node, vars }],
 *   stats: { areas, projects, repos, relations, found, resources, stack }
 * }
 * An area: { projects: [keys] }. A project: { area, order: [names], parts: [{ name, kind, node, uses,
 * shared }], instructions }. A repo: { project (its owner), path, harness, kind, exists, projects (the
 * ones it composes), shared }. A resource: { kind, tech, location, state, source: 'declared' |
 * 'detected', techOnly, users: [{ id, name, how }] }.
 */
export function buildArchitecture({ areas = [], departments = [], relations = [], resources = [], exists = () => true } = {}) {
  const nodes = [], edges = [], findings = [];
  const byId = new Map();
  const node = (n) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n); } return byId.get(n.id); };
  const edge = (e) => { if (e.from !== e.to && !edges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind)) edges.push(e); };
  const finding = (level, code, id, vars = {}) => findings.push({ level, code, node: id, vars });

  for (const a of areas) node({ id: `area:${a.id}`, type: 'area', name: a.name, key: a.id, instructions: a.instructions || '', projects: [] });
  const repos = [];
  for (const o of departments) {
    const area = byId.get(`area:${o.area}`) || byId.get(`area:${areas[0]?.id}`) || null;
    const project = node({ id: `project:${o.id}`, type: 'project', name: o.name, key: o.id, area: area?.key || o.area || null, instructions: o.instructions || '', order: [], parts: [] });
    area?.projects.push(o.id);
    for (const p of o.projects || []) {
      const repo = node({ id: `repo:${p.id}`, type: 'repo', name: p.name, key: p.id, project: o.id, path: p.path, harness: p.harness, kind: p.kind || 'other', exists: exists(p.path), projects: [o.id], shared: false });
      repos.push(repo);
    }
    if (!(o.projects || []).length) finding('info', 'emptyProject', project.id, { name: o.name });
  }
  for (const r of repos) if (!r.exists) finding('warn', 'repoMissing', r.id, { name: r.name, path: r.path });

  // what each repository uses of another
  for (const rel of relations) {
    const from = byId.get(`repo:${rel.from}`), to = byId.get(`repo:${rel.to}`);
    if (!from || !to) continue;
    edge({ from: from.id, to: to.id, kind: 'uses', how: rel.how || 'calls', note: rel.note || '', source: rel.source || 'you', evidence: rel.evidence || '', relation: rel.id || null });
    if (rel.source === 'found') finding('info', 'relationFound', from.id, { from: from.name, to: to.name, evidence: rel.evidence || '' });
  }
  const uses = edges.filter((e) => e.kind === 'uses');
  // each project: its repositories, and the ones of other projects they use (near or far): the order a change goes in
  for (const project of nodes.filter((n) => n.type === 'project')) {
    const ids = new Set(repos.filter((r) => r.project === project.key).map((r) => r.id));
    const own = new Set(ids);
    for (let grew = true; grew;) { grew = false; for (const e of uses) if (ids.has(e.from) && !ids.has(e.to)) { ids.add(e.to); grew = true; } }
    const parts = [...ids].map((id) => byId.get(id)).map((r) => ({ name: r.name, kind: r.kind, node: r.id, uses: uses.filter((e) => e.from === r.id && ids.has(e.to)).map((e) => byId.get(e.to).name), shared: !own.has(r.id) }));
    for (const p of parts) if (p.shared) { const r = byId.get(p.node); if (!r.projects.includes(project.key)) r.projects.push(project.key); r.shared = true; }
    const order = orderParts(parts);
    Object.assign(project, { parts, order: order.ok ? order.order : parts.map((p) => p.name) });
    if (!order.ok && parts.length) finding('warn', 'projectOrder', project.id, { name: project.name, error: order.error });
    // several repositories and nothing says how they relate: explore them
    if (own.size > 1 && !uses.some((e) => own.has(e.from) || own.has(e.to))) finding('info', 'noRelations', project.id, { name: project.name, n: own.size });
  }
  for (const r of repos) if (r.shared) finding('info', 'sharedRepo', r.id, { name: r.name, projects: r.projects.filter((k) => k !== r.project).map((k) => byId.get(`project:${k}`)?.name).filter(Boolean).join(', ') });

  // the infrastructure, and who uses it
  for (const r of resources) {
    const id = `res:${r.id || r.key}`;
    const users = (r.projects || []).filter((x) => byId.has(`repo:${x.id}`));
    node({ id, type: 'resource', name: r.name, key: r.id || null, kind: r.kind, tech: r.tech || '', location: r.location || '', notes: r.notes || '', state: r.state || 'exists', source: r.source, techOnly: !!r.techOnly, users: users.map((x) => ({ id: `repo:${x.id}`, name: x.name, how: x.how || 'uses' })) });
    for (const x of users) edge({ from: `repo:${x.id}`, to: id, kind: 'link', how: x.how || 'uses' });
    if (r.source === 'declared') {
      if (!users.length) finding('warn', 'resourceUnused', id, { name: r.name });
      if (r.state === 'planned') finding('info', 'resourcePlanned', id, { name: r.name });
      // a queue somebody writes to and nobody reads (or the other way round)
      const hows = new Set(users.map((x) => x.how));
      if ((r.kind === 'queue' || r.kind === 'topic') && users.length) {
        if (hows.has('publishes') && !hows.has('consumes')) finding('warn', 'noConsumer', id, { name: r.name });
        if (hows.has('consumes') && !hows.has('publishes')) finding('warn', 'noPublisher', id, { name: r.name });
      }
    } else if (!r.techOnly) finding('info', 'resourceDetected', id, { name: r.name, repos: users.map((x) => x.name).join(', ') });
  }

  const order = { warn: 0, info: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return {
    nodes, edges, findings,
    stats: {
      areas: areas.length, projects: departments.length, repos: repos.length, relations: uses.length, found: uses.filter((e) => e.source === 'found').length,
      resources: nodes.filter((n) => n.type === 'resource' && !n.techOnly).length, stack: nodes.filter((n) => n.techOnly).length,
    },
  };
}

/** The office's architecture, from its database. `name`: how a project and an area are called (the main ones have no name of their own). */
export function architecture(store, { name = (o) => o.name || o.id, areaName = (a) => a.name || a.id } = {}) {
  const departments = companyMap(store, { name });
  const projects = departments.flatMap((o) => o.projects);
  return buildArchitecture({
    areas: (store.listAreas?.() || []).map((a) => ({ ...a, name: areaName(a) })),
    departments,
    relations: store.listRelations?.() || [],
    resources: knownResources({ declared: store.listResources(), projects }),
    exists: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } },
  });
}

// The outline's words, in English: what the MCP gives the agents (they read English). The CLI passes the
// user's language instead (`arch.text` in public/locales).
const OUTLINE = {
  head: 'Company: {areas} area(s), {projects} project(s), {repos} repositories, {relations} relation(s) between them, {resources} infrastructure resource(s).',
  area: 'Area "{name}"', project: 'Project "{name}" ({key}): a change goes {order}', noRepos: '(no repositories)',
  repo: 'repository {name} [{kind}] {path}', shared: '(of the project {project}, shared)', uses: 'uses {list}', usedBy: 'used by {list}',
  found: '(found in its code)', infra: 'infrastructure: {list}', infraHead: 'Infrastructure',
  planned: '[planned]', detected: '[detected]', nobody: 'nobody linked', review: 'Review',
};
const english = (key, vars = {}) => OUTLINE[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/**
 * The graph as an outline, to read before a change that crosses repositories: each area with its projects,
 * each project with its repositories in the order a change goes, what each one uses and who uses it, the
 * infrastructure and the review. In English by default (the MCP's); `say(key, vars)` gives the words in
 * another language, `how(code)` says how a repository uses a resource, `relHow(code)` how it uses another
 * repository, and `finding(f)` says a finding of the review (by default, their codes).
 */
export function architectureText(g, { say = english, how = (h) => h, relHow = how, finding = (f) => `${f.code}${Object.keys(f.vars).length ? `: ${Object.values(f.vars).filter(Boolean).join(' · ')}` : ''}` } = {}) {
  const out = [];
  const by = (type) => g.nodes.filter((n) => n.type === type);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const nameOf = (id) => byId.get(id)?.name || id;
  const uses = g.edges.filter((e) => e.kind === 'uses');
  const rel = (e, end) => `${nameOf(e[end])} (${relHow(e.how)}${e.note ? `: ${e.note}` : ''})${e.source === 'found' ? ` ${say('found')}` : ''}`;
  out.push(say('head', g.stats));
  for (const area of by('area')) {
    const projects = by('project').filter((p) => p.area === area.key);
    if (!projects.length) continue;
    out.push('', say('area', { name: area.name }));
    for (const p of projects) {
      out.push(`  ${say('project', { name: p.name, key: p.key, order: p.order.join(' → ') || '—' })}`);
      if (!p.parts.length) out.push(`    ${say('noRepos')}`);
      for (const part of p.order.map((n) => p.parts.find((x) => x.name === n)).filter(Boolean)) {
        const r = byId.get(part.node);
        out.push(`    - ${say('repo', { name: r.name, kind: r.kind, path: r.path })}${part.shared ? ` ${say('shared', { project: nameOf(`project:${r.project}`) })}` : ''}`);
        if (part.shared) continue;
        const outs = uses.filter((e) => e.from === r.id), ins = uses.filter((e) => e.to === r.id);
        if (outs.length) out.push(`        ${say('uses', { list: outs.map((e) => rel(e, 'to')).join('; ') })}`);
        if (ins.length) out.push(`        ${say('usedBy', { list: ins.map((e) => rel(e, 'from')).join('; ') })}`);
        const infra = g.edges.filter((e) => e.kind === 'link' && e.from === r.id).map((e) => `${how(e.how)} ${nameOf(e.to)}`);
        if (infra.length) out.push(`        ${say('infra', { list: infra.join('; ') })}`);
      }
    }
  }
  const res = by('resource').filter((r) => !r.techOnly);
  if (res.length) {
    out.push('', say('infraHead'));
    for (const r of res) out.push(`  - ${r.kind} "${r.name}"${r.tech ? ` (${r.tech})` : ''}${r.location ? ` @ ${r.location}` : ''}${r.state === 'planned' ? ` ${say('planned')}` : ''}${r.source === 'detected' ? ` ${say('detected')}` : ''}: ${r.users.map((u) => `${u.name} ${how(u.how)}`).join(', ') || say('nobody')}`);
  }
  if (g.findings.length) {
    out.push('', say('review'));
    for (const f of g.findings) out.push(`  - [${f.level}] ${finding(f)}`);
  }
  return out.join('\n');
}
