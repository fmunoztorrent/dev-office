// The company's architecture as a picture, without the DOM (shared by the web view and the tests):
//
//   archView(graph, scope)   what one level shows of the graph (server/architecture.js): the whole company,
//                            an area, a project or a repository. Each level keeps what is its own and
//                            brings in, marked as external, whatever it uses or is used by.
//   layoutArch(view)         that view laid out in lanes (an area, a project or the repository, and the
//                            infrastructure below) and columns (who uses goes to the left of what it uses:
//                            web → bff → core → db).
//   archNeighbors(graph, id) what a node uses, who uses it (near and far), its infrastructure, its project
//                            and its area.
//
// Scopes: { type: 'company' } | { type: 'area', id } | { type: 'project', id } | { type: 'repo', id } (the
// ids are the area's, the project's and the repository's own).

import { KIND_ICON, RESOURCE_ICON } from './impact.js';

const NODE = { w: 176, h: 46 };
const GAP = { x: 70, y: 14 };
const LANE = { pad: 14, head: 30, gap: 16 };
const LABELS = { kind: (k) => k, resKind: (k) => k, how: (h) => h, infra: 'Infrastructure', repos: (n) => `${n} repos`, relations: (n) => `${n}` };

const index = (g) => new Map((g?.nodes || []).map((n) => [n.id, n]));

/** The scope a node opens: an area, a project or a repository. */
export function scopeOf(node) {
  if (!node) return null;
  if (node.type === 'area') return { type: 'area', id: node.key };
  if (node.type === 'project') return { type: 'project', id: node.key };
  if (node.type === 'repo') return { type: 'repo', id: node.key };
  return null;
}

/** Where a scope is: [{ type: 'company' }, { type: 'area', id, name }, { type: 'project', … }, { type: 'repo', … }] down to it. */
export function archCrumbs(g, scope = { type: 'company' }) {
  const idx = index(g);
  const out = [{ type: 'company' }];
  const area = (id) => { const a = idx.get(`area:${id}`); if (a) out.push({ type: 'area', id, name: a.name }); };
  const project = (id) => { const p = idx.get(`project:${id}`); if (p) { area(p.area); out.push({ type: 'project', id, name: p.name }); } };
  if (scope.type === 'area') area(scope.id);
  else if (scope.type === 'project') project(scope.id);
  else if (scope.type === 'repo') { const r = idx.get(`repo:${scope.id}`); if (r) { project(r.project); out.push({ type: 'repo', id: scope.id, name: r.name }); } }
  return out;
}

/**
 * What a scope shows: { scope, lanes: [{ id, label, kind: 'area' | 'project' | 'self' | 'infra', own }],
 * nodes: [{ id, ref (the graph's node), type, label, sub, icon, lane, state: 'own' | 'external' | 'missing'
 * | 'planned' | 'detected', n? (its turn when a change goes through the project), shared? }],
 * edges: [{ from, to, kind: 'uses' | 'link', label, found?, relation? }] }. `stack`: also the technologies
 * each repository's folder says it uses (Postgres, Kafka…), not only the named infrastructure.
 */
export function archView(g, scope = { type: 'company' }, { stack = false, labels = {} } = {}) {
  const L = { ...LABELS, ...labels };
  const idx = index(g);
  const all = (type) => (g?.nodes || []).filter((n) => n.type === type);
  const nodes = new Map(), edges = [], lanes = [];
  const lane = (id, label, kind, own = false) => { if (!lanes.some((l) => l.id === id)) lanes.push({ id, label, kind, own }); return id; };
  const projectLane = (key, own = false) => lane(`project:${key}`, idx.get(`project:${key}`)?.name || key, 'project', own);
  const put = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return nodes.get(n.id); };
  const edge = (from, to, kind, label = '', extra = {}) => {
    if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
    const have = edges.find((e) => e.from === from && e.to === to && e.kind === kind);
    if (have) { if (label && !have.label.split(' · ').includes(label)) have.label = [have.label, label].filter(Boolean).join(' · '); } else edges.push({ from, to, kind, label, ...extra });
  };
  const repoNode = (r, state = 'own', laneId = projectLane(r.project, state === 'own')) => put({
    id: r.id, ref: r.id, type: 'repo', label: r.name, icon: KIND_ICON[r.kind] || KIND_ICON.other, lane: laneId, state: r.exists === false ? 'missing' : state, shared: !!r.shared,
    sub: r.kind && r.kind !== 'other' ? L.kind(r.kind) : '',
  });
  const resNode = (r) => put({
    id: r.id, ref: r.id, type: 'resource', label: r.name, icon: RESOURCE_ICON[r.kind] || RESOURCE_ICON.other, lane: lane('infra', L.infra, 'infra'),
    state: r.state === 'planned' ? 'planned' : r.source === 'detected' ? 'detected' : 'own',
    sub: r.techOnly ? L.resKind(r.kind) : [L.resKind(r.kind), r.tech && r.tech !== r.name ? r.tech : ''].filter(Boolean).join(' · '),
  });
  const wanted = (r) => r && (stack || !r.techOnly);
  // the infrastructure of the repositories in view (`via`: which nodes of the view stand for each repository)
  const infraFor = (via) => {
    for (const e of (g?.edges || []).filter((x) => x.kind === 'link')) {
      const r = idx.get(e.to);
      const from = via(e.from);
      if (!wanted(r) || !from.length) continue;
      resNode(r);
      for (const f of from) edge(f, r.id, 'link', L.how(e.how || 'uses'));
    }
  };
  const uses = (g?.edges || []).filter((e) => e.kind === 'uses');
  const relEdge = (e, from = e.from, to = e.to) => edge(from, to, 'uses', L.how(e.how || 'calls'), { found: e.source === 'found', relation: e.relation || null });
  const reposOf = (key) => all('repo').filter((r) => r.project === key);

  if (scope.type === 'area') {
    // its projects, each a lane with its repositories; from outside, what they use or is used by them
    const projects = all('project').filter((p) => p.area === scope.id);
    const mine = new Set();
    for (const p of projects) { projectLane(p.key, true); for (const r of reposOf(p.key)) { repoNode(r); mine.add(r.id); } }
    for (const e of uses) {
      if (!mine.has(e.from) && !mine.has(e.to)) continue;
      for (const id of [e.from, e.to]) if (!mine.has(id)) repoNode(idx.get(id), 'external');
      relEdge(e);
    }
    infraFor((id) => (mine.has(id) ? [id] : []));
  } else if (scope.type === 'project') {
    // its repositories in the order a change goes, and the ones of other projects it uses (shared)
    const p = idx.get(`project:${scope.id}`);
    if (p) {
      projectLane(p.key, true);
      const mine = new Set();
      for (const part of p.parts) {
        const r = idx.get(part.node);
        if (!r) continue;
        const own = r.project === p.key;
        const n = repoNode(r, own ? 'own' : 'external');
        n.n = p.order.indexOf(part.name) + 1;
        if (own) mine.add(r.id);
      }
      // who uses its repositories from other projects
      for (const e of uses) if (mine.has(e.to) && !nodes.has(e.from)) repoNode(idx.get(e.from), 'external');
      for (const e of uses) if (nodes.has(e.from) && nodes.has(e.to) && (mine.has(e.from) || mine.has(e.to) || p.parts.some((x) => x.node === e.from))) relEdge(e);
      infraFor((id) => (nodes.has(id) && (mine.has(id) || nodes.get(id).n) ? [id] : []));
    }
  } else if (scope.type === 'repo') {
    const r = idx.get(`repo:${scope.id}`);
    if (r) {
      const self = lane('self', r.name, 'self', true);
      repoNode(r, 'own', self);
      for (const e of uses) {
        if (e.from !== r.id && e.to !== r.id) continue;
        const other = idx.get(e.from === r.id ? e.to : e.from);
        if (other) repoNode(other, 'external');
        relEdge(e);
      }
      infraFor((id) => (id === r.id ? [r.id] : []));
    }
  } else {
    // the whole company: an area per lane, each project a box; between projects, what their repositories use
    for (const a of all('area')) {
      const projects = all('project').filter((p) => p.area === a.key);
      if (!projects.length) continue;
      const id = lane(`area:${a.key}`, a.name, 'area', true);
      for (const p of projects) {
        const n = reposOf(p.key).length;
        put({ id: p.id, ref: p.id, type: 'project', label: p.name, icon: '🧩', lane: id, state: 'own', sub: L.repos(n) });
      }
    }
    const projectOf = (repoId) => `project:${idx.get(repoId)?.project}`;
    for (const e of uses) {
      const a = projectOf(e.from), b = projectOf(e.to);
      if (a !== b) edge(a, b, 'uses', L.how(e.how || 'calls'));
    }
    infraFor((id) => (idx.get(id) ? [projectOf(id)] : []));
    // declared infrastructure nobody is linked to yet: on the map all the same
    for (const r of all('resource')) if (r.source === 'declared') resNode(r);
  }
  // the infrastructure goes last, below everything
  lanes.sort((a, b) => (a.kind === 'infra') - (b.kind === 'infra'));
  return { scope, lanes, nodes: [...nodes.values()], edges };
}

/**
 * A view laid out: its lanes one under the other, and inside each one its nodes in columns (each node one
 * column after whatever uses it; cycles broken) with what relates to nothing in a grid below. The
 * infrastructure is the last lane: a grid, each resource under whoever uses it, reached from above.
 * Returns { lanes: [{ …, y, h }], nodes: [{ …, x, y, w, h }], edges: [{ …, d (the SVG path), lx, ly (its
 * label) }], width, height }.
 */
export function layoutArch(view) {
  const ids = view.nodes.map((n) => n.id);
  // the columns follow who uses whom; the infrastructure hangs below, whoever uses it
  const flow = view.edges.filter((e) => e.kind !== 'link');
  const out = new Map(ids.map((id) => [id, []])), inc = new Map(ids.map((id) => [id, []]));
  const state = new Map(), keep = [];
  const visit = (id) => {
    state.set(id, 1);
    for (const e of flow.filter((x) => x.from === id)) {
      if (state.get(e.to) === 1) continue; // closes a cycle
      keep.push(e);
      if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  for (const e of keep) { out.get(e.from).push(e.to); inc.get(e.to).push(e.from); }
  const rank = new Map();
  const rankOf = (id) => {
    if (rank.has(id)) return rank.get(id);
    rank.set(id, 0);
    const r = inc.get(id).length ? Math.max(...inc.get(id).map((p) => rankOf(p) + 1)) : 0;
    rank.set(id, r);
    return r;
  };
  ids.forEach(rankOf);
  const linked = new Set(flow.flatMap((e) => [e.from, e.to]));
  const maxRank = Math.max(0, ...ids.filter((id) => linked.has(id)).map((id) => rank.get(id)));
  const looseMost = Math.max(0, ...view.lanes.map((l) => view.nodes.filter((n) => n.lane === l.id && !linked.has(n.id)).length));
  const cols = Math.max(maxRank + 1, Math.min(4, looseMost), 1);
  const colX = (c) => LANE.pad + c * (NODE.w + GAP.x);
  const width = LANE.pad * 2 + cols * (NODE.w + GAP.x) - GAP.x;

  const placed = new Map();
  const lanes = [];
  let y = 0;
  const rowOf = new Map(); // inside a cell: by name, then pulled towards the rows of what it relates to
  for (const l of view.lanes) {
    const mine = view.nodes.filter((n) => n.lane === l.id);
    const tied = mine.filter((n) => linked.has(n.id));
    // what relates to nothing here goes in a grid: by name, or (the infrastructure) under whoever uses it
    const users = (n) => view.edges.filter((e) => e.to === n.id && placed.has(e.from)).map((e) => placed.get(e.from).x);
    const pull = new Map(mine.map((n) => { const xs = users(n); return [n.id, xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : Infinity]; }));
    const loose = mine.filter((n) => !linked.has(n.id)).sort((a, b) => (l.kind === 'infra' ? pull.get(a.id) - pull.get(b.id) || 0 : 0) || a.label.localeCompare(b.label));
    const cells = new Map();
    for (const n of tied.sort((a, b) => (a.n || 0) - (b.n || 0) || a.label.localeCompare(b.label))) { const c = rank.get(n.id); if (!cells.has(c)) cells.set(c, []); cells.get(c).push(n); }
    for (const [, list] of [...cells].sort((a, b) => a[0] - b[0])) {
      const bary = (n) => { const ns = [...inc.get(n.id), ...out.get(n.id)].map((id) => rowOf.get(id)).filter((v) => v !== undefined); return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : Infinity; };
      const key = new Map(list.map((n, i) => [n.id, [bary(n), i]]));
      list.sort((a, b) => (key.get(a.id)[0] - key.get(b.id)[0]) || (key.get(a.id)[1] - key.get(b.id)[1]));
      list.forEach((n, i) => rowOf.set(n.id, i));
    }
    // the infrastructure's lane leaves a line under its name for how each one is used
    const head = l.kind === 'infra' ? LANE.head + 16 : LANE.head;
    const top = y + head;
    const tiedRows = Math.max(0, ...[...cells.values()].map((c) => c.length));
    for (const [c, list] of cells) list.forEach((n, i) => placed.set(n.id, { x: colX(c), y: top + i * (NODE.h + GAP.y) }));
    const looseTop = top + (tiedRows ? tiedRows * (NODE.h + GAP.y) + 4 : 0);
    loose.forEach((n, i) => placed.set(n.id, { x: colX(i % cols), y: looseTop + Math.floor(i / cols) * (NODE.h + GAP.y) }));
    const looseRows = Math.ceil(loose.length / cols);
    const rows = tiedRows + looseRows;
    // an empty lane is only its name and a line saying so
    const h = mine.length ? head + rows * (NODE.h + GAP.y) - GAP.y + (tiedRows && looseRows ? 4 : 0) + LANE.pad : LANE.head + 34;
    lanes.push({ ...l, y, h, empty: !mine.length });
    y += h + LANE.gap;
  }
  const height = Math.max(0, y - LANE.gap);
  const nodes = view.nodes.map((n) => ({ ...n, ...placed.get(n.id), w: NODE.w, h: NODE.h }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const r1 = (v) => Math.round(v * 10) / 10;
  // several links leave a node (and reach a resource) side by side, not on top of each other
  const links = view.edges.filter((e) => e.kind === 'link');
  const spread = (list, self, other) => {
    const slots = new Map();
    for (const id of new Set(list.map((e) => e[self]))) {
      const mine = list.filter((e) => e[self] === id).sort((a, b) => at.get(a[other]).x - at.get(b[other]).x || at.get(a[other]).y - at.get(b[other]).y);
      const step = Math.min(14, (NODE.w - 40) / Math.max(1, mine.length));
      mine.forEach((e, i) => slots.set(e, (i - (mine.length - 1) / 2) * step));
    }
    return slots;
  };
  const leave = spread(links, 'from', 'to'), arrive = spread(links, 'to', 'from');
  const edges = view.edges.map((e) => {
    const a = at.get(e.from), b = at.get(e.to);
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    let d, lx, ly;
    if (e.kind === 'link' && b.y >= a.y + a.h) { // down to the infrastructure: out of its bottom, into the other's top
      const x1 = a.x + a.w / 2 + leave.get(e), y1 = a.y + a.h, x2 = b.x + b.w / 2 + arrive.get(e), y2 = b.y, k = Math.max(26, (y2 - y1) / 2);
      d = `M${r1(x1)} ${r1(y1)} C${r1(x1)} ${r1(y1 + k)} ${r1(x2)} ${r1(y2 - k)} ${r1(x2)} ${r1(y2)}`;
      lx = x2; ly = y2 - 7;
    } else if (b.x >= a.x + a.w) { // to the right: out of its right side, into the other's left side
      const x1 = a.x + a.w, x2 = b.x, k = Math.max(28, (x2 - x1) / 2);
      d = `M${r1(x1)} ${r1(ay)} C${r1(x1 + k)} ${r1(ay)} ${r1(x2 - k)} ${r1(by)} ${r1(x2)} ${r1(by)}`;
      lx = (x1 + x2) / 2; ly = (ay + by) / 2;
    } else if (b.x + b.w <= a.x) { // back (a cycle): out of its left side, into the other's right side
      const x1 = a.x, x2 = b.x + b.w, k = Math.max(28, (x1 - x2) / 2);
      d = `M${r1(x1)} ${r1(ay)} C${r1(x1 - k)} ${r1(ay)} ${r1(x2 + k)} ${r1(by)} ${r1(x2)} ${r1(by)}`;
      lx = (x1 + x2) / 2; ly = (ay + by) / 2;
    } else { // the same column: around, by the right
      const x = a.x + a.w, k = 34 + Math.min(26, Math.abs(by - ay) / 6);
      d = `M${r1(x)} ${r1(ay)} C${r1(x + k)} ${r1(ay)} ${r1(x + k)} ${r1(by)} ${r1(x)} ${r1(by)}`;
      lx = x + k * 0.75; ly = (ay + by) / 2;
    }
    return { ...e, d, lx: r1(lx), ly: r1(ly) };
  });
  return { scope: view.scope, lanes: lanes.map((l) => ({ ...l, x: 0, w: width })), nodes, edges, width, height };
}

/**
 * What surrounds a node of the graph: { node, uses, usedBy (direct, each { node, how, note, source,
 * relation }), reach (everything a change of it reaches: who uses it, near or far), infra: [{ node, how }],
 * users (a resource's), repos (a project's or an area's), projects (an area's, or the ones a repository
 * composes), project, area }.
 */
export function archNeighbors(g, id) {
  const idx = index(g);
  const n = idx.get(id);
  const empty = { node: n || null, uses: [], usedBy: [], reach: [], infra: [], users: [], repos: [], projects: [], project: null, area: null };
  if (!n) return empty;
  const uses = (g.edges || []).filter((e) => e.kind === 'uses');
  const links = (g.edges || []).filter((e) => e.kind === 'link');
  const rel = (e, end) => ({ node: idx.get(e[end]), how: e.how, note: e.note || '', source: e.source || 'you', relation: e.relation || null, evidence: e.evidence || '' });
  const reach = new Set();
  const walk = (x) => { for (const e of uses) if (e.to === x && e.from !== id && !reach.has(e.from)) { reach.add(e.from); walk(e.from); } };
  if (n.type === 'repo') walk(id);
  const project = n.type === 'repo' ? idx.get(`project:${n.project}`) : n.type === 'project' ? n : null;
  const area = idx.get(`area:${project?.area || (n.type === 'area' ? n.key : '')}`) || null;
  return {
    node: n,
    uses: n.type === 'repo' ? uses.filter((e) => e.from === id).map((e) => rel(e, 'to')).filter((x) => x.node) : [],
    usedBy: n.type === 'repo' ? uses.filter((e) => e.to === id).map((e) => rel(e, 'from')).filter((x) => x.node) : [],
    reach: [...reach].map((x) => idx.get(x)).filter(Boolean),
    infra: n.type === 'repo' ? links.filter((e) => e.from === id).map((e) => ({ node: idx.get(e.to), how: e.how })).filter((x) => x.node) : [],
    users: n.type === 'resource' ? links.filter((e) => e.to === id).map((e) => ({ node: idx.get(e.from), how: e.how })).filter((x) => x.node) : [],
    repos: n.type === 'project' ? n.order.map((name) => n.parts.find((p) => p.name === name)).filter(Boolean).map((p) => ({ node: idx.get(p.node), shared: p.shared, uses: p.uses })).filter((x) => x.node)
      : n.type === 'area' ? (g.nodes || []).filter((r) => r.type === 'repo' && n.projects.includes(r.project)).map((node) => ({ node })) : [],
    projects: n.type === 'area' ? n.projects.map((k) => idx.get(`project:${k}`)).filter(Boolean) : n.type === 'repo' ? (n.projects || []).map((k) => idx.get(`project:${k}`)).filter(Boolean) : [],
    project: n.type === 'repo' ? project : null,
    area: n.type === 'area' ? null : area,
  };
}
