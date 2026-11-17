// The company's architecture as one graph: how everything on the map relates, from a component inside a
// repository up to the whole company.
//
//   departments ─ own ─▶ repositories ─ have ─▶ components
//   projects (server/systems.js) ─ group ─▶ artifacts (a repository, or a component of one), and say
//                                           which artifact uses which
//   repositories ─ publish / consume / read / call… ─▶ infrastructure (server/resources.js)
//
// buildArchitecture() is pure (it takes the map, the projects and the resources); architecture(store)
// reads them from the office's database. The web view scopes and lays out this graph
// (public/architecture.js); `findings` is the review: what on the map deserves a look.

import fs from 'node:fs';
import { companyMap } from './components.js';
import { knownResources } from './resources.js';
import { orderParts } from './systems.js';
import { realDir } from './paths.js';

const sameDir = (a, b) => !!a && !!b && (a === b || realDir(a) === realDir(b));
const clean = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The graph: {
 *   nodes: [{ id, type: 'dept' | 'system' | 'repo' | 'component' | 'resource', name, … }],
 *   edges: [{ from, to, kind: 'uses' (an artifact uses another: `system`, `label`) | 'link' (a repository
 *            and its infrastructure: `how`) }],
 *   findings: [{ level: 'warn' | 'info', code, node, vars }],
 *   stats: { departments, repos, components, systems, resources, relations }
 * }
 * A repo: { dept, path, harness, kind, exists, systems: [ids], shared }. A component: { repo, dept, path,
 * kind, declared }. A system: { dept, order: [names], parts: [{ name, kind, node, uses, shared, missing }] }.
 * A resource: { kind, tech, location, state, source: 'declared' | 'detected', techOnly, users: [{ id, name, how }] }.
 */
export function buildArchitecture({ departments = [], systems = [], resources = [], exists = () => true } = {}) {
  const nodes = [], edges = [], findings = [];
  const byId = new Map();
  const node = (n) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n); } return byId.get(n.id); };
  const edge = (e) => { if (e.from !== e.to && !edges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind && x.system === e.system && x.how === e.how)) edges.push(e); };
  const finding = (level, code, id, vars = {}) => findings.push({ level, code, node: id, vars });

  const repos = [];
  for (const o of departments) {
    node({ id: `dept:${o.id}`, type: 'dept', name: o.name, key: o.id });
    for (const p of o.projects || []) {
      const repo = node({ id: `repo:${p.id}`, type: 'repo', name: p.name, key: p.id, dept: o.id, path: p.path, harness: p.harness, kind: p.kind || 'other', exists: exists(p.path), systems: [], shared: false });
      repos.push(repo);
      for (const c of p.components || []) {
        node({ id: `comp:${p.id}:${clean(c.path || c.name)}`, type: 'component', name: c.name, key: c.id || null, repo: repo.id, dept: o.id, path: c.path || '', description: c.description || '', kind: c.kind || 'other', declared: !!c.declared });
      }
    }
    if (!(o.projects || []).length) finding('info', 'emptyDept', `dept:${o.id}`, { name: o.name });
  }
  for (const r of repos) if (!r.exists) finding('warn', 'repoMissing', r.id, { name: r.name, path: r.path });

  // the projects: each artifact is a repository, or a component of one (its folder inside the repo)
  const repoAt = (dir) => repos.find((r) => sameDir(r.path, dir));
  for (const s of systems) {
    const order = orderParts(s.parts || []);
    const sys = node({ id: `sys:${s.id}`, type: 'system', name: s.name, key: s.id, dept: s.office, instructions: s.instructions || '', order: order.ok ? order.order : (s.parts || []).map((p) => p.name), parts: [] });
    if (!order.ok) finding('warn', 'systemOrder', sys.id, { name: s.name, error: order.error });
    const target = new Map();
    for (const p of s.parts || []) {
      const repo = repoAt(p.project);
      let id = null;
      if (repo) {
        if (!repo.systems.includes(s.id)) repo.systems.push(s.id);
        if (repo.dept !== s.office) repo.shared = true;
        if (p.path || p.component) {
          const comp = nodes.find((n) => n.type === 'component' && n.repo === repo.id && ((p.path && clean(n.path) === clean(p.path)) || (p.component && clean(n.name) === clean(p.component))));
          // a folder nobody declared and nothing detected: it is on the map because a project names it
          id = (comp || node({ id: `comp:${repo.key}:${clean(p.path || p.component)}`, type: 'component', name: p.component || p.path, key: null, repo: repo.id, dept: repo.dept, path: p.path || '', description: '', kind: p.kind || 'other', declared: false })).id;
          const c = byId.get(id);
          if (c.kind === 'other' && p.kind && p.kind !== 'other') c.kind = p.kind;
        } else {
          id = repo.id;
          if (repo.kind === 'other' && p.kind && p.kind !== 'other') repo.kind = p.kind;
        }
      } else finding('warn', 'partNoRepo', sys.id, { name: p.name, system: s.name });
      target.set(p.name, id);
      sys.parts.push({ name: p.name, kind: p.kind || 'other', node: id, uses: [...(p.uses || [])], shared: !!repo && repo.dept !== s.office, missing: !repo });
    }
    for (const p of s.parts || []) for (const u of p.uses || []) {
      const from = target.get(p.name), to = target.get(u);
      if (from && to) edge({ from, to, kind: 'uses', system: s.id, label: s.name });
    }
    if (!(s.parts || []).length) finding('info', 'emptySystem', sys.id, { name: s.name });
  }
  for (const r of repos) if (r.shared) finding('info', 'sharedRepo', r.id, { name: r.name, systems: r.systems.map((id) => byId.get(`sys:${id}`)?.name).filter(Boolean).join(', ') });
  // repositories no project names: nothing says what they use or who uses them
  if (systems.length) for (const r of repos) if (!r.systems.length) finding('info', 'repoNoProject', r.id, { name: r.name });

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
  if (repos.length > 1 && !systems.length) finding('info', 'noProjects', null, {});

  const order = { warn: 0, info: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return {
    nodes, edges, findings,
    stats: {
      departments: departments.length, repos: repos.length, components: nodes.filter((n) => n.type === 'component').length,
      systems: systems.length, resources: nodes.filter((n) => n.type === 'resource' && !n.techOnly).length, stack: nodes.filter((n) => n.techOnly).length,
      relations: edges.length,
    },
  };
}

/** The office's architecture, from its database. `name`: how a department is called (the main one has no name of its own). */
export function architecture(store, { name = (o) => o.name || o.id } = {}) {
  const departments = companyMap(store, { name });
  const projects = departments.flatMap((o) => o.projects);
  return buildArchitecture({
    departments,
    systems: store.listSystems?.() || [],
    resources: knownResources({ declared: store.listResources(), projects }),
    exists: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } },
  });
}

/**
 * The architecture as an outline, in words (for an agent: the MCP tool `get_architecture`):
 * each department with its repositories and their components, each project with what uses what,
 * the infrastructure with who uses it, and the review.
 */
export function architectureText(g) {
  const out = [];
  const by = (type) => g.nodes.filter((n) => n.type === type);
  const nameOf = (id) => g.nodes.find((n) => n.id === id)?.name || id;
  out.push(`Company: ${g.stats.departments} department(s), ${g.stats.repos} repositor${g.stats.repos === 1 ? 'y' : 'ies'}, ${g.stats.components} component(s), ${g.stats.systems} project(s), ${g.stats.resources} infrastructure resource(s).`);
  for (const d of by('dept')) {
    out.push('', `Department "${d.name}" (${d.key})`);
    const repos = by('repo').filter((r) => r.dept === d.key);
    if (!repos.length) out.push('  (no repositories)');
    for (const r of repos) {
      out.push(`  - repository ${r.name} [${r.kind}] ${r.path}${r.shared ? ' (shared with projects of other departments)' : ''}`);
      const comps = by('component').filter((c) => c.repo === r.id);
      if (comps.length) out.push(`      components: ${comps.map((c) => `${c.name}${c.path ? ` (${c.path})` : ''}`).join(', ')}`);
      const infra = g.edges.filter((e) => e.kind === 'link' && e.from === r.id).map((e) => `${e.how} ${nameOf(e.to)}`);
      if (infra.length) out.push(`      infrastructure: ${infra.join('; ')}`);
    }
  }
  for (const s of by('system')) {
    out.push('', `Project "${s.name}" (department ${nameOf(`dept:${s.dept}`)}): a change goes ${s.order.join(' → ') || '(no artifacts)'}`);
    for (const p of s.parts) out.push(`  - ${p.name} [${p.kind}]${p.node ? ` = ${nameOf(p.node)}` : ' = (no repository registered)'}${p.uses.length ? `, uses ${p.uses.join(', ')}` : ''}${p.shared ? ' (shared)' : ''}`);
  }
  const res = by('resource').filter((r) => !r.techOnly);
  if (res.length) {
    out.push('', 'Infrastructure');
    for (const r of res) out.push(`  - ${r.kind} "${r.name}"${r.tech ? ` (${r.tech})` : ''}${r.state === 'planned' ? ' [planned]' : ''}${r.source === 'detected' ? ' [detected]' : ''}: ${r.users.map((u) => `${u.name} ${u.how}`).join(', ') || 'nobody linked'}`);
  }
  if (g.findings.length) {
    out.push('', 'Review');
    for (const f of g.findings) out.push(`  - [${f.level}] ${f.code}${Object.keys(f.vars).length ? `: ${Object.values(f.vars).filter(Boolean).join(' · ')}` : ''}`);
  }
  return out.join('\n');
}
