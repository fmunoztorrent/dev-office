// 🗺 The architecture, drawn (⚙ › Map): the company's map as a diagram you can walk, level by level
// (public/architecture.js scopes it and lays it out; server/architecture.js builds the graph).
//
//   the company     every area with its projects, and what each project uses of another
//   an area         its projects with their repositories, and from outside what they use or is used by them
//   a project       its repositories in the order a change goes (and the ones of others it uses)
//   a repository    what it uses, who uses it, its infrastructure and its stack
//
// Click a node to see what it uses, who uses it and what a change of it reaches; open it to go one level
// down. A repository's panel relates it to another one (or 🔗 and a click on the other); 🔍 explores the
// folders and finds what their code says. Below, the review: what on the map deserves a look.

import { t } from './i18n.js';
import { archView, layoutArch, archNeighbors, archCrumbs, scopeOf } from './architecture.js';
import { KIND_ICON, RESOURCE_ICON } from './impact.js';
import { tildeHome } from './targets.js';

const SVG = 'http://www.w3.org/2000/svg';
const A = (k, v) => t(`arch.${k}`, v);
const TYPE_ICON = { area: '🏛', project: '🧩', repo: '📦', resource: '🗄' };
const HARNESS = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
const LANE_ICON = { area: '🏛', project: '🧩', infra: '🗄', self: '📦' };
const HOWS = ['calls', 'uses', 'consumes', 'reads'];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return e;
}
function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); }
  e.append(...children.flat().filter(Boolean));
  return e;
}
const clip = (s, n) => { const x = String(s ?? ''); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const sameScope = (a, b) => a?.type === b?.type && (a?.id || '') === (b?.id || '');

/**
 * @param api      (method, path, body) => the office's answer
 * @param onGo     (section, { edit }) => open another settings section, on that thing's form
 * @param onPrompt (target) => a brief to a repository or a project (`system:<id>`)
 * @param say      (text, ok) => a line in the settings' footer
 */
export function createArchitecture({ api, onGo, onPrompt, say = () => {} } = {}) {
  const st = { graph: null, scope: { type: 'company' }, stack: null, selected: null, zoom: 1, fit: true, box: null, error: '', connect: null, exploring: false, explain: new Map() };

  const labels = () => ({
    kind: (k) => t(`system.kinds.${k}`), resKind: (k) => t(`infra.kinds.${k}`), how: (h) => (HOWS.includes(h) ? A(`how.${h}`) : t(`infra.how.${h}`)),
    infra: A('lane.infra'), repos: (n) => A('stats.repos', { n }),
  });
  // a repository shows its stack unless you say otherwise; the bigger levels only the named infrastructure
  const stackOn = () => (st.stack === null ? st.scope.type === 'repo' : st.stack);

  async function load() {
    const r = await api('GET', '/v1/architecture');
    st.error = r.ok ? '' : r.error || '?';
    if (r.ok) st.graph = r;
    // the level being watched is gone (a repository removed, a project deleted): back to the company
    if (st.graph && archCrumbs(st.graph, st.scope).at(-1).type !== st.scope.type) st.scope = { type: 'company' };
    draw();
  }

  /** Draws the section into `box` (and reloads the map). */
  function render(box) {
    st.box = box;
    draw();
    load();
  }

  function go(scope, selected = null) {
    if (!scope) return;
    st.scope = scope;
    st.selected = selected;
    st.connect = null;
    draw();
  }

  const nodeOf = (id) => st.graph?.nodes.find((n) => n.id === id) || null;
  const iconOf = (n) => (n.type === 'resource' ? RESOURCE_ICON[n.kind] || '⚙️' : n.type === 'repo' ? KIND_ICON[n.kind] || TYPE_ICON.repo : TYPE_ICON[n.type]);
  const crumbLabel = (c) => (c.type === 'company' ? `🏢 ${A('company')}` : `${TYPE_ICON[c.type]} ${c.name}`);

  /** Relates two repositories (from → to) and draws the map again. */
  async function relate(from, to, how = 'calls', note = '') {
    const r = await api('POST', '/v1/relations', { from: from.replace(/^repo:/, ''), to: to.replace(/^repo:/, ''), how, note });
    if (!r.ok) { say(r.error, false); return false; }
    say(A('related', { from: nodeOf(from)?.name || '', to: nodeOf(to)?.name || '' }), true);
    await load();
    return true;
  }
  async function unrelate(id) {
    const r = await api('DELETE', `/v1/relations/${encodeURIComponent(id)}`);
    if (!r.ok) return say(r.error, false);
    await load();
  }
  /** 🔍 Explores the folders: the relations their code says, on the map as found ones. */
  async function explore() {
    st.exploring = true; draw();
    const r = await api('POST', '/v1/relations/explore', {});
    st.exploring = false;
    if (!r.ok) { say(r.error, false); return draw(); }
    say(r.added.length ? A('explored', { n: r.added.length }) : A('exploredNone'), true);
    await load();
  }

  function draw() {
    const box = st.box;
    if (!box?.isConnected) return;
    if (!st.graph) { box.replaceChildren(el('p', { class: 'hint' }, st.error || t('settings.loading'))); return; }
    const g = st.graph;
    const view = archView(g, st.scope, { stack: stackOn(), labels: labels() });
    const layout = layoutArch(view);
    if (st.selected && !selectedInView(view)) st.selected = null;
    const keep = box.querySelector('.arch-canvas');
    const scroll = keep ? [keep.scrollLeft, keep.scrollTop] : null;
    box.replaceChildren(
      header(g),
      el('div', { class: 'arch-body' }, canvas(layout, view), detail(g, view)),
      review(g));
    const now = box.querySelector('.arch-canvas');
    // until you zoom by hand, the whole width of the picture fits in its frame (down to a readable size)
    if (st.fit && now?.clientWidth) {
      const z = Math.max(0.6, Math.min(1, Math.floor(((now.clientWidth - 14) / (layout.width + 20)) * 100) / 100));
      if (z !== st.zoom) { st.zoom = z; return draw(); }
    }
    if (scroll && now) { now.scrollLeft = scroll[0]; now.scrollTop = scroll[1]; }
  }

  /** The node selected (a graph id) is in this view, or it is the level itself (an area, a project). */
  const selectedInView = (view) => view.nodes.some((n) => n.ref === st.selected || n.id === st.selected) || ['area', 'project'].includes(nodeOf(st.selected)?.type);

  // ------------------------------------------------------------ where you are, and where you can go

  function header(g) {
    const crumbs = archCrumbs(g, st.scope);
    const s = g.stats;
    const stat = (n, key) => el('span', { class: 'arch-stat' }, el('b', {}, String(n)), ` ${A(`stats.${key}`, { n })}`);
    const jump = el('select', { class: 'arch-jump', 'aria-label': A('jump'), onchange: (e) => { const [type, ...rest] = e.target.value.split(':'); if (type) go(type === 'company' ? { type } : { type, id: rest.join(':') }); } },
      el('option', { value: '' }, A('jump')),
      el('option', { value: 'company' }, `🏢 ${A('company')}`),
      group(A('types.area'), g.nodes.filter((n) => n.type === 'area' && n.projects.length), 'area'),
      group(A('types.project'), g.nodes.filter((n) => n.type === 'project'), 'project'),
      group(A('types.repo'), g.nodes.filter((n) => n.type === 'repo'), 'repo'));
    return el('div', { class: 'arch-head' },
      el('nav', { class: 'arch-crumbs', 'aria-label': A('crumbs') }, crumbs.map((c, i) => [
        i ? el('span', { class: 'arch-sep', 'aria-hidden': 'true' }, '›') : null,
        i === crumbs.length - 1 ? el('b', { 'aria-current': 'page' }, crumbLabel(c)) : el('button', { type: 'button', class: 'arch-crumb', onclick: () => go(c.type === 'company' ? { type: 'company' } : { type: c.type, id: c.id }) }, crumbLabel(c)),
      ])),
      jump,
      el('button', { type: 'button', class: 'btn arch-explore', disabled: st.exploring || !s.repos ? true : undefined, title: A('exploreHint'), onclick: explore }, st.exploring ? A('exploring') : `🔍 ${A('explore')}`),
      el('div', { class: 'arch-stats' }, stat(s.areas, 'areas'), stat(s.projects, 'projects'), stat(s.repos, 'repos'), stat(s.relations, 'relations'), stat(s.resources, 'resources')),
      el('div', { class: 'arch-tools' },
        el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: stackOn() ? true : undefined, onchange: (e) => { st.stack = e.target.checked; draw(); } }), A('stack', { n: s.stack })),
        el('span', { class: 'arch-zoom' },
          el('button', { type: 'button', class: 's-mini', 'aria-label': A('zoomOut'), onclick: () => { st.fit = false; st.zoom = Math.max(0.5, Math.round((st.zoom - 0.1) * 10) / 10); draw(); } }, '−'),
          el('span', { class: 'hint' }, `${Math.round(st.zoom * 100)}%`),
          el('button', { type: 'button', class: 's-mini', 'aria-label': A('zoomIn'), onclick: () => { st.fit = false; st.zoom = Math.min(1.6, Math.round((st.zoom + 0.1) * 10) / 10); draw(); } }, '+'),
          el('button', { type: 'button', class: 's-mini', 'aria-pressed': String(st.fit), title: A('fit'), 'aria-label': A('fit'), onclick: () => { st.fit = true; draw(); } }, '↔')),
        el('span', { class: 'arch-legend' },
          el('span', { class: 'arch-key uses' }, A('legend.uses')), el('span', { class: 'arch-key found' }, A('legend.found')), el('span', { class: 'arch-key link' }, A('legend.link')),
          el('span', { class: 'arch-key ext' }, A('legend.external')))),
      st.connect ? el('p', { class: 'arch-connect', role: 'status' }, `🔗 ${A('connecting', { name: nodeOf(st.connect)?.name || '' })} `,
        el('button', { type: 'button', class: 's-mini', onclick: () => { st.connect = null; draw(); } }, A('cancel'))) : null);
  }
  const group = (label, list, type) => (list.length ? el('optgroup', { label }, list.map((n) => el('option', { value: `${type}:${n.key}`, selected: sameScope(st.scope, { type, id: n.key }) ? true : undefined }, n.name))) : null);

  // ------------------------------------------------------------ the diagram

  function canvas(l, view) {
    const pad = 10;
    const W = l.width + pad * 2, H = l.height + pad * 2;
    const s = svg('svg', { class: `arch-svg${l.edges.length <= 14 ? ' few' : ''}${st.connect ? ' connecting' : ''}`, width: Math.round(W * st.zoom), height: Math.round(H * st.zoom), viewBox: `${-pad} ${-pad} ${W} ${H}`, role: 'group', 'aria-label': A('diagram') });
    s.append(svg('defs', {},
      svg('marker', { id: 'arch-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L8 4 L0 8 z' })),
      svg('marker', { id: 'arch-arrow-on', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L8 4 L0 8 z' }))));
    for (const lane of l.lanes) {
      // an area's or a project's lane opens it (unless it is the level you are on)
      const [kind, key] = lane.id.split(':');
      const open = (lane.kind === 'area' || lane.kind === 'project') && !(st.scope.type === kind && st.scope.id === key);
      const label = svg('text', { class: `arch-lane-t${open ? ' link' : ''}`, x: 12, y: lane.y + 20 }, document.createTextNode(`${LANE_ICON[lane.kind] || ''} ${lane.label}`));
      if (open) { label.setAttribute('tabindex', '0'); label.setAttribute('role', 'link'); label.onclick = () => go({ type: kind, id: key }); label.onkeydown = (e) => { if (e.key === 'Enter') label.onclick(); }; }
      s.append(svg('g', { class: `arch-lane k-${lane.kind}${lane.own ? ' own' : ''}` },
        svg('rect', { x: 0, y: lane.y, width: lane.w, height: lane.h, rx: 6 }), label,
        lane.empty ? svg('text', { class: 'arch-lane-empty', x: 14, y: lane.y + 46 }, document.createTextNode(A('lane.empty'))) : null));
    }
    const sel = st.selected;
    const selView = sel ? view.nodes.filter((n) => n.ref === sel || n.id === sel).map((n) => n.id) : [];
    const near = new Set(selView);
    // what is picked and not drawn as a box (the project you are in): nothing dims
    const dimming = selView.length > 0;
    for (const e of l.edges) if (selView.includes(e.from) || selView.includes(e.to)) { near.add(e.from); near.add(e.to); }
    const edges = svg('g', { class: 'arch-edges' });
    for (const e of l.edges) {
      const on = selView.includes(e.from) || selView.includes(e.to);
      const tip = [nameIn(l, e.from), e.label, nameIn(l, e.to)].join(' ') + (e.found ? ` · ${A('legend.found')}` : '');
      edges.append(svg('g', { class: `arch-edge k-${e.kind}${e.found ? ' found' : ''}${on ? ' on' : ''}${dimming && !on ? ' dim' : ''}` },
        svg('path', { d: e.d, 'marker-end': `url(#arch-arrow${on ? '-on' : ''})` }, svg('title', {}, document.createTextNode(tip))),
        e.label ? svg('text', { class: 'arch-edge-t', x: e.lx, y: e.ly - 3, 'text-anchor': 'middle' }, document.createTextNode(clip(e.label, 22))) : null));
    }
    s.append(edges);
    for (const n of l.nodes) {
      const on = selView.includes(n.id);
      const max = n.n ? 17 : 19;
      const target = st.connect && n.type === 'repo' && n.ref !== st.connect;
      const g = svg('g', {
        class: `arch-node t-${n.type} s-${n.state}${on ? ' on' : ''}${target ? ' target' : ''}${dimming && !near.has(n.id) && !st.connect ? ' dim' : ''}`, transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: 'button',
        'aria-label': [n.label, n.sub].filter(Boolean).join(' · '), 'aria-pressed': String(on),
      },
        svg('rect', { width: n.w, height: n.h, rx: 5 }),
        svg('text', { class: 'arch-ic', x: 9, y: 28 }, document.createTextNode(n.icon || '')),
        svg('text', { class: 'arch-t1', x: 32, y: n.sub ? 19 : 28 }, document.createTextNode(clip(n.label, max))),
        n.sub ? svg('text', { class: 'arch-t2', x: 32, y: 35 }, document.createTextNode(clip(n.sub, 24))) : null,
        n.n ? svg('g', { class: 'arch-turn' }, svg('circle', { cx: n.w - 13, cy: 13, r: 9 }), svg('text', { x: n.w - 13, y: 17, 'text-anchor': 'middle' }, document.createTextNode(String(n.n)))) : null,
        n.shared ? svg('text', { class: 'arch-shared', x: n.w - (n.n ? 34 : 12), y: 17, 'text-anchor': 'end' }, document.createTextNode('⇄'), svg('title', {}, document.createTextNode(A('shared')))) : null,
        svg('title', {}, document.createTextNode([n.label, n.sub, A(`state.${n.state}`)].filter(Boolean).join(' · '))));
      // relating: a click on another repository finishes it
      const pick = async () => {
        if (st.connect) { if (target) { const from = st.connect; st.connect = null; await relate(from, n.ref); st.selected = from; draw(); } return; }
        st.selected = on ? null : n.ref || n.id; draw();
      };
      const open = () => { if (!st.connect) go(scopeOf(nodeOf(n.ref)), n.ref); };
      g.onclick = pick;
      g.ondblclick = open;
      g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.shiftKey) open(); else pick(); } else if (e.key === 'Escape' && st.connect) { st.connect = null; draw(); } };
      s.append(g);
    }
    return el('div', { class: 'arch-canvas', tabindex: 0, 'aria-label': A('diagram') }, s);
  }
  const nameIn = (l, id) => l.nodes.find((n) => n.id === id)?.label || id;

  // ------------------------------------------------------------ what is selected (or the level itself)

  function detail(g, view) {
    const id = st.selected || (st.scope.type === 'company' ? null : `${st.scope.type}:${st.scope.id}`);
    const n = id ? nodeOf(id) : null;
    if (!n) return el('aside', { class: 'arch-detail' }, el('h3', {}, `🏢 ${A('company')}`), el('p', { class: 'hint' }, A('pick')), areasList(g));
    const nb = archNeighbors(g, n.id);
    const link = (x, extra = null) => el('li', {}, el('button', { type: 'button', class: 'arch-ref', onclick: () => focus(x) }, `${iconOf(x)} ${x.name}`), extra);
    const facts = [
      n.type === 'repo' && n.kind && n.kind !== 'other' ? [A('f.kind'), t(`system.kinds.${n.kind}`)] : null,
      n.type === 'resource' ? [A('f.kind'), `${t(`infra.kinds.${n.kind}`)}${n.tech && n.tech !== n.name ? ` · ${n.tech}` : ''}`] : null,
      n.type === 'resource' && n.location ? [A('f.where'), n.location] : null,
      n.type === 'resource' ? [A('f.state'), A(`state.${n.state === 'planned' ? 'planned' : n.source === 'detected' ? 'detected' : 'declared'}`)] : null,
      nb.area && n.type !== 'area' ? [A('f.area'), nb.area.name] : null,
      nb.project ? [A('f.project'), nb.project.name] : null,
      n.path ? [A('f.path'), tildeHome(n.path)] : null,
      n.type === 'repo' && n.harness ? [A('f.agent'), HARNESS[n.harness] || n.harness] : null,
      n.type === 'project' ? [A('f.order'), n.order.join(' → ') || '—'] : null,
      n.type === 'repo' && n.exists === false ? [A('f.state'), A('state.missing')] : null,
    ].filter(Boolean);
    const scope = scopeOf(n);
    const edit = { area: ['company', `area:${n.key}`], project: ['company', n.key], repo: ['repos', n.key], resource: n.key ? ['infra', n.key] : ['infra', null] }[n.type];
    return el('aside', { class: 'arch-detail' },
      el('h3', {}, `${iconOf(n)} ${n.name}`),
      el('p', { class: 'arch-type' }, A(`types.${n.type}`), n.shared ? el('span', { class: 's-tag', title: A('sharedHint') }, `⇄ ${A('shared')}`) : null),
      el('div', { class: 's-row arch-actions' },
        scope && !sameScope(scope, st.scope) ? el('button', { type: 'button', class: 's-mini', onclick: () => go(scope) }, `⤢ ${A('open')}`) : null,
        edit ? el('button', { type: 'button', class: 's-mini', onclick: () => onGo?.(edit[0], { edit: edit[1], adopt: n.type === 'resource' && !n.key ? n : null }) }, n.type === 'resource' && !n.key ? A('declare') : `✎ ${A('edit')}`) : null,
        n.type === 'repo' ? el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(n.key) }, `✉ ${A('brief')}`) : null,
        n.type === 'project' && n.parts.length ? el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(`system:${n.key}`) }, `✉ ${A('brief')}`) : null,
        st.selected ? el('button', { type: 'button', class: 's-mini', onclick: () => { st.selected = null; draw(); } }, A('unselect')) : null),
      el('dl', { class: 'arch-facts' }, facts.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
      n.instructions ? el('p', { class: 's-dept-text' }, n.instructions) : null,
      n.type === 'repo' ? relations(n, nb) : null,
      nb.reach.length > nb.usedBy.length ? [el('h4', {}, `${A('reach')} (${nb.reach.length})`), el('p', { class: 'hint' }, nb.reach.map((x) => x.name).join(' · '))] : null,
      nb.infra.length ? [el('h4', {}, `${A('infra')} (${nb.infra.length})`), el('ul', { class: 'arch-list' }, nb.infra.map((x) => link(x.node, el('span', { class: 'hint' }, ` · ${t(`infra.how.${x.how}`)}`))))] : null,
      n.type === 'resource' ? usage(n, nb) : null,
      n.type === 'project' ? [el('h4', {}, `${A('repos')} (${nb.repos.length})`), el('ol', { class: 'arch-list' }, nb.repos.map((x) => link(x.node, el('span', { class: 'hint' }, `${x.shared ? ` ⇄ ${A('shared')}` : ''}${x.uses.length ? ` → ${x.uses.join(', ')}` : ''}`))))] : null,
      n.type === 'area' ? [el('h4', {}, `${A('projects')} (${nb.projects.length})`), el('ul', { class: 'arch-list' }, nb.projects.map((x) => link(x, el('span', { class: 'hint' }, ` ${x.order.join(' → ')}`))))] : null,
      n.type === 'repo' && nb.projects.length > 1 ? [el('h4', {}, A('composes')), el('ul', { class: 'arch-list' }, nb.projects.map((x) => link(x)))] : null);
    function focus(x) {
      if (!x) return;
      // already in this picture: just select it; otherwise go to where it is
      if (view.nodes.some((v) => v.ref === x.id || v.id === x.id)) { st.selected = x.id; draw(); } else go(scopeOf(x) || { type: 'company' }, x.type === 'resource' ? x.id : null);
    }
    /** A repository's relations: what it uses and who uses it, how and what for; relate it to another one. */
    function relations(r, nb) {
      const repos = g.nodes.filter((x) => x.type === 'repo' && x.id !== r.id);
      const row = (x, out) => el('li', { class: `arch-rel${x.source === 'found' ? ' found' : ''}` },
        el('button', { type: 'button', class: 'arch-ref', onclick: () => focus(x.node) }, `${iconOf(x.node)} ${x.node.name}`),
        el('span', { class: 'hint' }, ` · ${A(`how.${x.how}`)}${x.note ? ` · ${x.note}` : ''}`),
        x.source === 'found' ? el('span', { class: 's-tag kind', title: x.evidence }, `🔍 ${A('found')}`) : null,
        x.source === 'found' && x.relation ? el('button', { type: 'button', class: 's-mini', title: A('confirmHint'), onclick: () => relate(out ? r.id : x.node.id, out ? x.node.id : r.id, x.how, x.note) }, `✓ ${A('confirm')}`) : null,
        x.relation ? el('button', { type: 'button', class: 's-x', 'aria-label': A('unrelate', { name: x.node.name }), onclick: () => unrelate(x.relation) }, '✕') : null,
        x.evidence ? el('div', { class: 'arch-evidence' }, x.evidence) : null);
      const to = el('select', { 'aria-label': A('relateTo') }, el('option', { value: '' }, A('relateTo')), repos.map((x) => el('option', { value: x.id }, x.name)));
      const how = el('select', { 'aria-label': A('relateHow') }, HOWS.map((h) => el('option', { value: h }, A(`how.${h}`))));
      const note = el('input', { type: 'text', maxlength: 300, placeholder: A('relateNote'), 'aria-label': A('relateNote') });
      return [
        el('h4', {}, `${A('uses')} (${nb.uses.length})`),
        nb.uses.length ? el('ul', { class: 'arch-list' }, nb.uses.map((x) => row(x, true))) : el('p', { class: 'hint' }, A('usesNone')),
        el('h4', {}, `${A('usedBy')} (${nb.usedBy.length})`),
        nb.usedBy.length ? el('ul', { class: 'arch-list' }, nb.usedBy.map((x) => row(x, false))) : el('p', { class: 'hint' }, A('usedByNone')),
        el('div', { class: 'arch-relate' },
          el('span', { class: 'hint' }, A('relateTitle', { name: r.name })),
          to, how, note,
          el('div', { class: 's-row' },
            el('button', { type: 'button', class: 's-mini', onclick: async () => { if (!to.value) return say(A('relatePick'), false); await relate(r.id, to.value, how.value, note.value); } }, `＋ ${A('relate')}`),
            el('button', { type: 'button', class: 's-mini', title: A('connectHint'), onclick: () => { st.connect = r.id; draw(); } }, `🔗 ${A('connect')}`))),
      ];
    }
    /** A resource: where it is, how each repository uses it and what for (read from their folders). */
    function usage(res, nb) {
      const tech = res.tech || res.name;
      const users = nb.users.filter((x) => x.node.type === 'repo');
      if (!users.length) return null;
      const box = el('div', { class: 'arch-usage' });
      const fill = () => box.replaceChildren(...users.map((u) => {
        const x = st.explain.get(`${u.node.key}|${tech}`);
        return el('div', { class: 'arch-use' },
          el('b', {}, `${iconOf(u.node)} ${u.node.name}`), el('span', { class: 'hint' }, ` · ${t(`infra.how.${u.how}`)}`),
          !x ? el('p', { class: 'hint' }, '…')
            : !x.how.length && !x.where.length ? el('p', { class: 'hint' }, A('usageNone'))
              : el('dl', { class: 'arch-facts arch-uses' },
                x.purpose.length ? [el('dt', {}, A('usage.for')), el('dd', {}, [...x.purpose.map((p) => A(`purpose.${p}`)), ...(x.details.length ? [x.details.join(', ')] : [])].join(' · '))] : null,
                x.where.length ? [el('dt', {}, A('usage.where')), el('dd', {}, x.where.map((w) => el('div', { class: 'arch-evidence' }, w.evidence)))] : null,
                x.how.length ? [el('dt', {}, A('usage.how')), el('dd', {}, x.how.map((w) => el('div', { class: 'arch-evidence' }, w.evidence)))] : null));
      }));
      fill();
      for (const u of users) {
        const key = `${u.node.key}|${tech}`;
        if (st.explain.has(key)) continue;
        api('GET', `/v1/resources/explain?repo=${encodeURIComponent(u.node.key)}&tech=${encodeURIComponent(tech)}`).then((r) => { st.explain.set(key, r.ok ? r : { how: [], where: [], purpose: [], details: [] }); if (box.isConnected) fill(); });
      }
      return [el('h4', {}, A('usage.title')), box];
    }
  }

  const areasList = (g) => el('ul', { class: 'arch-list' }, g.nodes.filter((a) => a.type === 'area' && a.projects.length).map((a) => el('li', {},
    el('button', { type: 'button', class: 'arch-ref', onclick: () => go({ type: 'area', id: a.key }) }, `🏛 ${a.name}`),
    el('span', { class: 'hint' }, ` · ${a.projects.map((k) => nodeOf(`project:${k}`)?.name).filter(Boolean).join(', ')}`))));

  // ------------------------------------------------------------ the review

  function review(g) {
    const list = g.findings;
    const show = (f) => {
      const n = f.node ? nodeOf(f.node) : null;
      if (!n) return;
      if (n.type === 'area' || n.type === 'project') return go(scopeOf(n));
      if (n.type === 'resource') { if (n.techOnly) st.stack = true; return go(n.users.length === 1 ? scopeOf(nodeOf(n.users[0].id)) : { type: 'company' }, n.id); }
      go(scopeOf(n), n.id);
    };
    return el('section', { class: 'arch-review' },
      el('h3', {}, `${A('review')} (${list.length})`),
      list.length ? el('ul', { class: 'arch-findings' }, list.map((f) => el('li', { class: `lv-${f.level}` },
        el('span', { class: 'arch-lv', 'aria-hidden': 'true' }, f.level === 'warn' ? '⚠' : 'ℹ'),
        el('span', {}, A(`findings.${f.code}`, f.vars)),
        f.code === 'noRelations' ? el('button', { type: 'button', class: 's-mini', onclick: explore }, `🔍 ${A('explore')}`) : null,
        f.node ? el('button', { type: 'button', class: 's-mini', onclick: () => show(f) }, A('show')) : null)))
        : el('p', { class: 'arch-clean' }, `✓ ${A('clean')}`));
  }

  return { render, reload: load, go };
}
