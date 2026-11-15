// The impact of an order as pictures, without the DOM (shared by the web view, the server and the tests):
//
//   impactTree(map)    the tree of the repositories it involves: the order → its departments → each repo
//                      (a box) → and what is not on the map yet, apart. Laid out top-down (tidy tree).
//   impactGraph(map)   every impact and dependency as a graph: the order, the repos (and the ones they use
//                      or that use them), their components, the infrastructure (queues, topics, databases,
//                      third-party APIs, schedulers…) and what is still unknown. Laid out in layers, left
//                      to right, in the direction things reach each other (web → bff → core → database).
//
// The map is what server/components.js mapImpact returns (with the model's analysis merged, if any).

/** The kinds of infrastructure a company's code runs on or talks to (server/resources.js). */
export const RESOURCE_KINDS = ['queue', 'topic', 'database', 'cache', 'storage', 'service', 'api', 'scheduler', 'repo', 'other'];
/** How a project relates to a resource. */
export const RESOURCE_LINKS = ['uses', 'publishes', 'consumes', 'reads', 'writes', 'calls', 'schedules', 'owns'];
export const RESOURCE_ICON = { queue: '📨', topic: '📣', database: '🗄', cache: '⚡', storage: '🪣', service: '🛰', api: '🔌', scheduler: '⏰', repo: '📦', other: '⚙️' };
export const KIND_ICON = { frontend: '🖥', mobile: '📱', bff: '🔀', backend: '⚙️', worker: '🛠', library: '📚', data: '📊', infra: '🏗', other: '📁' };

const BOX = { w: 132, h: 46, gapX: 18, gapY: 54 };
const NODE = { w: 156, h: 40, colGap: 74, rowGap: 16 };

// ---------------------------------------------------------------- the tree

/**
 * The tree of an impact: { nodes: [{ id, kind: 'task'|'dept'|'repo'|'unknown'|'group', label, sub, x, y, w, h, data }],
 * links: [{ from, to }], width, height }. x, y: the box's top-left corner.
 */
export function impactTree(map, { title = '', unknownLabel = '?', kindLabel = (k) => k } = {}) {
  const root = { id: 'task', kind: 'task', label: title, sub: '', children: [], data: { insight: map?.insight || null } };
  for (const o of map?.departments || []) {
    const repos = o.projects.filter((p) => p.impacted);
    if (!repos.length && !o.impacted) continue;
    const dept = { id: `dept:${o.id}`, kind: 'dept', label: o.name, sub: '', children: [], data: o };
    for (const p of repos) {
      const comps = p.components.filter((c) => c.impacted).length;
      const infra = (map.resources || []).filter((r) => r.projects?.some((x) => x.id === p.id) && (r.impacted || r.state === 'planned')).length;
      dept.children.push({ id: `repo:${p.id}`, kind: 'repo', label: p.name, sub: [p.kind && p.kind !== 'other' ? kindLabel(p.kind) : '', comps ? `🧩${comps}` : '', infra ? `🗄${infra}` : ''].filter(Boolean).join(' · '), children: [], data: p, level: p.level || null });
    }
    root.children.push(dept);
  }
  // named infrastructure no project is linked to: under the order itself
  const loose = (map?.resources || []).filter((r) => r.impacted === 'named' && !r.projects?.length);
  for (const r of loose) root.children.push({ id: `res:${r.key}`, kind: 'resource', label: `${RESOURCE_ICON[r.kind] || '⚙️'} ${r.name}`, sub: r.location || r.tech || kindLabel(r.kind), children: [], data: r });
  if (map?.unknown?.length) {
    root.children.push({ id: 'unknown', kind: 'group', label: unknownLabel, sub: '', children: map.unknown.map((u) => ({ id: `unknown:${u.key}`, kind: 'unknown', label: u.name, sub: u.kind && u.kind !== 'component' ? kindLabel(u.kind) : '', children: [], data: u })), data: null });
  }
  // tidy: each leaf in its own column, each parent centered over its children
  const nodes = [], links = [];
  let col = 0, depth = 0;
  const place = (n, d) => {
    depth = Math.max(depth, d);
    if (!n.children.length) { n.x = col++ * (BOX.w + BOX.gapX); } else {
      for (const c of n.children) { place(c, d + 1); links.push({ from: n.id, to: c.id }); }
      n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
    }
    n.y = d * (BOX.h + BOX.gapY);
    nodes.push(n);
  };
  place(root, 0);
  return {
    nodes: nodes.map(({ children, ...n }) => ({ ...n, w: BOX.w, h: BOX.h })),
    links,
    width: Math.max(1, col) * (BOX.w + BOX.gapX) - BOX.gapX,
    height: (depth + 1) * (BOX.h + BOX.gapY) - BOX.gapY,
  };
}

// ---------------------------------------------------------------- the graph

/**
 * Every impact and dependency of an order: { nodes: [{ id, kind, label, sub, state, data }],
 * edges: [{ from, to, kind: impacts | contains | uses (a system's artifacts; label: the system) | link
 * (a repo and its infrastructure; label: how) | runs | model (label: the model's verb) | unknown, label }] }. state: 'impacted' (the order touches it), 'reached' (it uses
 * something touched), 'dependency' (what something touched uses), 'new' (to create), 'unknown'.
 */
export function impactGraph(map, { title = '', kindLabel = (k) => k } = {}) {
  const nodes = new Map(), edges = [];
  const node = (id, n) => { if (!nodes.has(id)) nodes.set(id, { id, ...n }); return nodes.get(id); };
  const edge = (from, to, kind, label = '') => { if (from !== to && nodes.has(from) && nodes.has(to) && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, kind, label }); };
  node('task', { kind: 'task', label: title, sub: '', state: 'impacted', data: { insight: map?.insight || null } });
  const projects = (map?.departments || []).flatMap((o) => o.projects.map((p) => ({ ...p, dept: o.name })));
  const byName = new Map(projects.map((p) => [p.name, p]));
  for (const p of projects.filter((x) => x.impacted)) {
    node(`repo:${p.id}`, { kind: 'repo', label: p.name, sub: [KIND_ICON[p.kind] || '', p.dept].filter(Boolean).join(' '), state: p.why === 'uses' ? 'reached' : 'impacted', data: p });
  }
  // the systems: who uses whom (the impacted ones, and what they use: their dependencies)
  for (const s of map?.systems || []) {
    if (!s.impacted) continue;
    const repoOf = (part) => projects.find((p) => p.path && part.project && (p.path === part.project || part.project.startsWith(`${p.path}/`) || p.path.startsWith(`${part.project}/`)));
    const idOf = (part) => { const r = repoOf(part); return r ? `repo:${r.id}` : `part:${s.id}:${part.name}`; };
    const want = new Set(s.parts.filter((x) => x.impacted).map((x) => x.name));
    for (const part of s.parts) for (const u of part.uses || []) if (want.has(part.name)) want.add(u);
    for (const part of s.parts.filter((x) => want.has(x.name))) {
      const r = repoOf(part);
      const id = idOf(part);
      if (!nodes.has(id)) node(id, { kind: 'repo', label: r?.name || part.name, sub: [KIND_ICON[part.kind] || '', s.name].filter(Boolean).join(' '), state: part.impacted === 'touched' ? 'impacted' : part.impacted === 'uses' ? 'reached' : 'dependency', data: r || { name: part.name, kind: part.kind, system: s.name } });
    }
    for (const part of s.parts.filter((x) => want.has(x.name))) for (const u of part.uses || []) { const dep = s.parts.find((x) => x.name === u); if (dep && want.has(u)) edge(idOf(part), idOf(dep), 'uses', s.name); }
  }
  for (const p of projects.filter((x) => x.impacted)) {
    edge('task', `repo:${p.id}`, 'impacts', p.why || '');
    for (const c of p.components.filter((x) => x.impacted)) {
      node(`comp:${p.id}:${c.name}`, { kind: 'component', label: c.name, sub: c.path || '', state: c.fresh ? 'new' : 'impacted', data: { ...c, project: p.name } });
      edge(`repo:${p.id}`, `comp:${p.id}:${c.name}`, 'contains');
    }
  }
  // the infrastructure: what it names, what is to be created, and what the repos in it use (their stack)
  const resources = map?.resources || [];
  for (const r of [...resources].sort((a, b) => (a.techOnly ? 1 : 0) - (b.techOnly ? 1 : 0))) {
    const linked = (r.projects || []).filter((x) => nodes.has(`repo:${x.id}`));
    if (!r.impacted && r.state !== 'planned' && !linked.length) continue;
    // a technology is one node (Kafka), whoever uses it; a named resource on it points to it
    const id = r.techOnly ? `tech:${r.tech}` : `res:${r.key}`;
    node(id, { kind: 'resource', label: `${RESOURCE_ICON[r.kind] || '⚙️'} ${r.name}`, sub: r.techOnly ? kindLabel(r.kind) : r.location || r.tech || kindLabel(r.kind), state: r.state === 'planned' ? 'new' : r.impacted ? 'impacted' : 'dependency', data: r });
    if (!r.techOnly && r.tech && resources.some((x) => x.techOnly && x.tech === r.tech && x.projects?.some((y) => nodes.has(`repo:${y.id}`)))) {
      const tid = `tech:${r.tech}`;
      const tr = resources.find((x) => x.techOnly && x.tech === r.tech);
      node(tid, { kind: 'resource', label: `${RESOURCE_ICON[tr.kind] || '⚙️'} ${tr.name}`, sub: kindLabel(tr.kind), state: tr.impacted ? 'impacted' : 'dependency', data: tr });
      edge(id, tid, 'runs');
    }
    for (const x of linked) edge(`repo:${x.id}`, id, 'link', x.how || 'uses');
    if (r.impacted === 'named' && !linked.length) edge('task', id, 'impacts');
  }
  for (const u of map?.unknown || []) {
    node(`unknown:${u.key}`, { kind: 'unknown', label: u.name, sub: u.kind ? kindLabel(u.kind) : '', state: 'unknown', data: u });
    edge('task', `unknown:${u.key}`, 'unknown', '?');
  }
  // what the model said reaches what (names of projects or resources)
  const find = (name) => {
    const w = String(name || '').toLowerCase();
    if (nodes.has(name)) return name;
    const p = byName.get(name) || projects.find((x) => x.id === name || x.name.toLowerCase() === w);
    if (p && nodes.has(`repo:${p.id}`)) return `repo:${p.id}`;
    return [...nodes.values()].find((n) => n.kind !== 'task' && String(n.data?.name || n.label).toLowerCase().replace(/^\S+\s/, '') === w.replace(/^\S+\s/, ''))?.id
      || [...nodes.values()].find((n) => n.kind !== 'task' && String(n.data?.name || '').toLowerCase() === w)?.id;
  };
  for (const l of map?.links || []) { const a = find(l.from), b = find(l.to); if (a && b) edge(a, b, 'model', l.label || ''); }
  return { nodes: [...nodes.values()], edges };
}

/**
 * The graph in layers (left to right): each node one column after whatever reaches it (the longest
 * path, cycles broken), and in each column in the order of its neighbours (barycenters). Adds x, y,
 * w, h to each node; returns { nodes, edges, width, height }.
 */
export function layoutGraph(g) {
  const ids = g.nodes.map((n) => n.id);
  const out = new Map(ids.map((id) => [id, []])), inc = new Map(ids.map((id) => [id, []]));
  // a depth-first walk drops the edges that close a cycle
  const state = new Map(), keep = [];
  const visit = (id) => {
    state.set(id, 1);
    for (const e of g.edges.filter((x) => x.from === id)) {
      if (state.get(e.to) === 1) continue;
      keep.push(e);
      if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  for (const e of keep) { out.get(e.from).push(e.to); inc.get(e.to).push(e.from); }
  const rank = new Map();
  const rankOf = (id, seen = new Set()) => {
    if (rank.has(id)) return rank.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const r = inc.get(id).length ? Math.max(...inc.get(id).map((p) => rankOf(p, seen) + 1)) : 0;
    rank.set(id, r);
    return r;
  };
  ids.forEach((id) => rankOf(id));
  // nodes with nothing coming in (other than the order) start next to it
  for (const id of ids) if (id !== 'task' && !inc.get(id).length) rank.set(id, 1);
  const cols = [];
  for (const id of ids) (cols[rank.get(id)] ||= []).push(id);
  const pos = new Map();
  const order = () => cols.forEach((c) => c?.forEach((id, i) => pos.set(id, i)));
  order();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const c of cols) {
      if (!c) continue;
      const bary = (id) => { const ns = [...inc.get(id), ...(sweep % 2 ? out.get(id) : [])]; return ns.length ? ns.reduce((s, x) => s + pos.get(x), 0) / ns.length : pos.get(id); };
      c.sort((a, b) => bary(a) - bary(b));
      c.forEach((id, i) => pos.set(id, i));
    }
  }
  const tallest = Math.max(1, ...cols.map((c) => c?.length || 0));
  const height = tallest * (NODE.h + NODE.rowGap) - NODE.rowGap;
  const nodes = g.nodes.map((n) => {
    const c = rank.get(n.id), list = cols[c];
    const top = (height - (list.length * (NODE.h + NODE.rowGap) - NODE.rowGap)) / 2;
    return { ...n, x: c * (NODE.w + NODE.colGap), y: top + list.indexOf(n.id) * (NODE.h + NODE.rowGap), w: NODE.w, h: NODE.h };
  });
  return { nodes, edges: g.edges, width: cols.length * (NODE.w + NODE.colGap) - NODE.colGap, height };
}
