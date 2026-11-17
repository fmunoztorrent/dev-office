// 🗺 The architecture, drawn (⚙ › Architecture): the company's map as a diagram you can walk, level by
// level (public/architecture.js scopes it and lays it out; server/architecture.js builds the graph).
//
//   the company     every department with its repositories, who uses whom across them, and the infrastructure
//   a department    its repositories, and from outside only what they use or uses them
//   a project       its artifacts in the order a change goes, and the infrastructure of their repositories
//   a repository    its components, the repositories around it and its stack
//
// Click a node to see what it uses, who uses it and what a change of it reaches; open it to go one level
// down. Below, the review: what on the map deserves a look.

import { t } from './i18n.js';
import { archView, layoutArch, archNeighbors, archCrumbs, scopeOf } from './architecture.js';
import { KIND_ICON, RESOURCE_ICON } from './impact.js';
import { tildeHome } from './targets.js';

const SVG = 'http://www.w3.org/2000/svg';
const A = (k, v) => t(`arch.${k}`, v);
const TYPE_ICON = { dept: '👥', system: '🧩', repo: '📦', component: '🧱', resource: '🗄' };
const HARNESS = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
const LANE_ICON = { dept: '👥', infra: '🗄', self: '📦', unknown: '❓' };
// a color per project: the dots on the repositories that are its artifacts
const HUES = ['#e76f51', '#2a9d8f', '#457b9d', '#b5179e', '#e9c46a', '#6a994e', '#7b2cbf', '#bc6c25'];

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
 */
export function createArchitecture({ api, onGo, onPrompt } = {}) {
  const st = { graph: null, scope: { type: 'company' }, stack: null, selected: null, zoom: 1, fit: true, box: null, error: '' };

  const labels = () => ({
    kind: (k) => t(`system.kinds.${k}`), resKind: (k) => t(`infra.kinds.${k}`), how: (h) => t(`infra.how.${h}`),
    infra: A('lane.infra'), whole: A('whole'), unknown: A('lane.unknown'), components: (n) => String(n),
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
    draw();
  }

  const nodeOf = (id) => st.graph?.nodes.find((n) => n.id === id) || null;
  const iconOf = (n) => (n.type === 'resource' ? RESOURCE_ICON[n.kind] || '⚙️' : n.type === 'repo' || n.type === 'component' ? KIND_ICON[n.kind] || TYPE_ICON[n.type] : TYPE_ICON[n.type]);
  const hue = (sysId) => HUES[Math.max(0, (st.graph?.nodes || []).filter((n) => n.type === 'system').findIndex((n) => n.key === sysId)) % HUES.length];
  const crumbLabel = (c) => (c.type === 'company' ? `🏢 ${A('company')}` : `${TYPE_ICON[c.type]} ${c.name}`);

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

  /** The node selected (a graph id) is in this view: as itself, or as the artifact that stands for it. */
  const selectedInView = (view) => view.nodes.some((n) => n.ref === st.selected || n.id === st.selected) || ['dept', 'system'].includes(nodeOf(st.selected)?.type);

  // ------------------------------------------------------------ where you are, and where you can go

  function header(g) {
    const crumbs = archCrumbs(g, st.scope);
    const s = g.stats;
    const stat = (n, key) => el('span', { class: 'arch-stat' }, el('b', {}, String(n)), ` ${A(`stats.${key}`, { n })}`);
    const jump = el('select', { class: 'arch-jump', 'aria-label': A('jump'), onchange: (e) => { const [type, ...rest] = e.target.value.split(':'); if (type) go(type === 'company' ? { type } : { type, id: rest.join(':') }); } },
      el('option', { value: '' }, A('jump')),
      el('option', { value: 'company' }, `🏢 ${A('company')}`),
      group(A('types.dept'), g.nodes.filter((n) => n.type === 'dept'), 'dept'),
      group(A('types.system'), g.nodes.filter((n) => n.type === 'system'), 'system'),
      group(A('types.repo'), g.nodes.filter((n) => n.type === 'repo'), 'repo'));
    return el('div', { class: 'arch-head' },
      el('nav', { class: 'arch-crumbs', 'aria-label': A('crumbs') }, crumbs.map((c, i) => [
        i ? el('span', { class: 'arch-sep', 'aria-hidden': 'true' }, '›') : null,
        i === crumbs.length - 1 ? el('b', { 'aria-current': 'page' }, crumbLabel(c)) : el('button', { type: 'button', class: 'arch-crumb', onclick: () => go(c.type === 'company' ? { type: 'company' } : { type: c.type, id: c.id }) }, crumbLabel(c)),
      ])),
      jump,
      el('div', { class: 'arch-stats' }, stat(s.departments, 'departments'), stat(s.systems, 'systems'), stat(s.repos, 'repos'), stat(s.components, 'components'), stat(s.resources, 'resources'), stat(s.relations, 'relations')),
      el('div', { class: 'arch-tools' },
        el('label', { class: 'b-check' }, el('input', { type: 'checkbox', checked: stackOn() ? true : undefined, onchange: (e) => { st.stack = e.target.checked; draw(); } }), A('stack', { n: s.stack })),
        el('span', { class: 'arch-zoom' },
          el('button', { type: 'button', class: 's-mini', 'aria-label': A('zoomOut'), onclick: () => { st.fit = false; st.zoom = Math.max(0.5, Math.round((st.zoom - 0.1) * 10) / 10); draw(); } }, '−'),
          el('span', { class: 'hint' }, `${Math.round(st.zoom * 100)}%`),
          el('button', { type: 'button', class: 's-mini', 'aria-label': A('zoomIn'), onclick: () => { st.fit = false; st.zoom = Math.min(1.6, Math.round((st.zoom + 0.1) * 10) / 10); draw(); } }, '+'),
          el('button', { type: 'button', class: 's-mini', 'aria-pressed': String(st.fit), title: A('fit'), 'aria-label': A('fit'), onclick: () => { st.fit = true; draw(); } }, '↔')),
        el('span', { class: 'arch-legend' },
          el('span', { class: 'arch-key uses' }, A('legend.uses')), el('span', { class: 'arch-key link' }, A('legend.link')),
          el('span', { class: 'arch-key ext' }, A('legend.external')))));
  }
  const group = (label, list, type) => (list.length ? el('optgroup', { label }, list.map((n) => el('option', { value: `${type}:${n.key}`, selected: sameScope(st.scope, { type, id: n.key }) ? true : undefined }, n.name))) : null);

  // ------------------------------------------------------------ the diagram

  function canvas(l, view) {
    const pad = 10;
    const W = l.width + pad * 2, H = l.height + pad * 2;
    const s = svg('svg', { class: `arch-svg${l.edges.length <= 14 ? ' few' : ''}`, width: Math.round(W * st.zoom), height: Math.round(H * st.zoom), viewBox: `${-pad} ${-pad} ${W} ${H}`, role: 'group', 'aria-label': A('diagram') });
    s.append(svg('defs', {},
      svg('marker', { id: 'arch-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L8 4 L0 8 z' })),
      svg('marker', { id: 'arch-arrow-on', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L8 4 L0 8 z' }))));
    for (const lane of l.lanes) {
      const open = lane.kind === 'dept' && !(st.scope.type === 'dept' && `dept:${st.scope.id}` === lane.id);
      const label = svg('text', { class: `arch-lane-t${open ? ' link' : ''}`, x: 12, y: lane.y + 20 }, document.createTextNode(`${LANE_ICON[lane.kind] || ''} ${lane.label}`));
      if (open) { label.setAttribute('tabindex', '0'); label.setAttribute('role', 'link'); label.onclick = () => go({ type: 'dept', id: lane.id.replace(/^dept:/, '') }); label.onkeydown = (e) => { if (e.key === 'Enter') label.onclick(); }; }
      s.append(svg('g', { class: `arch-lane k-${lane.kind}${lane.own ? ' own' : ''}` },
        svg('rect', { x: 0, y: lane.y, width: lane.w, height: lane.h, rx: 6 }), label,
        lane.empty ? svg('text', { class: 'arch-lane-empty', x: 14, y: lane.y + 46 }, document.createTextNode(A('lane.empty'))) : null));
    }
    const sel = st.selected;
    const selView = sel ? view.nodes.filter((n) => n.ref === sel || n.id === sel).map((n) => n.id) : [];
    const near = new Set(selView);
    for (const e of l.edges) if (selView.includes(e.from) || selView.includes(e.to)) { near.add(e.from); near.add(e.to); }
    const edges = svg('g', { class: 'arch-edges' });
    for (const e of l.edges) {
      const on = selView.includes(e.from) || selView.includes(e.to);
      const tip = [nameIn(l, e.from), e.kind === 'uses' ? A('edge.uses') : e.label, nameIn(l, e.to)].join(' ') + (e.kind === 'uses' && e.label ? ` · ${e.label}` : '');
      edges.append(svg('g', { class: `arch-edge k-${e.kind}${on ? ' on' : ''}${sel && !on ? ' dim' : ''}` },
        svg('path', { d: e.d, 'marker-end': `url(#arch-arrow${on ? '-on' : ''})` }, svg('title', {}, document.createTextNode(tip))),
        e.label ? svg('text', { class: 'arch-edge-t', x: e.lx, y: e.ly - 3, 'text-anchor': 'middle' }, document.createTextNode(clip(e.label, 22))) : null));
    }
    s.append(edges);
    for (const n of l.nodes) {
      const on = selView.includes(n.id);
      const max = n.n ? 17 : 19;
      const g = svg('g', {
        class: `arch-node t-${n.type} s-${n.state}${on ? ' on' : ''}${sel && !near.has(n.id) ? ' dim' : ''}`, transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: 'button',
        'aria-label': [n.label, n.sub].filter(Boolean).join(' · '), 'aria-pressed': String(on),
      },
        svg('rect', { width: n.w, height: n.h, rx: 5 }),
        svg('text', { class: 'arch-ic', x: 9, y: 28 }, document.createTextNode(n.icon || '')),
        svg('text', { class: 'arch-t1', x: 32, y: n.sub ? 19 : 28 }, document.createTextNode(clip(n.label, max))),
        n.sub ? svg('text', { class: 'arch-t2', x: 32, y: 35 }, document.createTextNode(clip(n.sub, 24))) : null,
        n.n ? svg('g', { class: 'arch-turn' }, svg('circle', { cx: n.w - 13, cy: 13, r: 9 }), svg('text', { x: n.w - 13, y: 17, 'text-anchor': 'middle' }, document.createTextNode(String(n.n)))) : null,
        (n.systems || []).slice(0, 5).map((id, i) => svg('circle', { class: 'arch-dot', cx: n.w - 10 - i * 11, cy: n.h - 9, r: 4, fill: hue(id) }, svg('title', {}, document.createTextNode(nodeOf(`sys:${id}`)?.name || '')))),
        n.shared ? svg('text', { class: 'arch-shared', x: n.w - (n.n ? 34 : 12), y: 17, 'text-anchor': 'end' }, document.createTextNode('⇄'), svg('title', {}, document.createTextNode(A('shared')))) : null,
        svg('title', {}, document.createTextNode([n.label, n.sub, A(`state.${n.state}`)].filter(Boolean).join(' · '))));
      const pick = () => { st.selected = on ? null : n.ref || n.id; draw(); };
      const open = () => go(scopeOf(nodeOf(n.ref)), n.ref);
      g.onclick = pick;
      g.ondblclick = open;
      g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.shiftKey) open(); else pick(); } };
      s.append(g);
    }
    return el('div', { class: 'arch-canvas', tabindex: 0, 'aria-label': A('diagram') }, s);
  }
  const nameIn = (l, id) => l.nodes.find((n) => n.id === id)?.label || id;

  // ------------------------------------------------------------ what is selected (or the level itself)

  function detail(g, view) {
    const id = st.selected || (st.scope.type === 'company' ? null : `${{ dept: 'dept', system: 'sys', repo: 'repo' }[st.scope.type]}:${st.scope.id}`);
    const n = id ? nodeOf(id) : null;
    if (!n) return el('aside', { class: 'arch-detail' }, el('h3', {}, `🏢 ${A('company')}`), el('p', { class: 'hint' }, A('pick')), projectsList(g.nodes.filter((x) => x.type === 'system')), deptsList(g));
    const nb = archNeighbors(g, n.id);
    const link = (x, extra = '') => el('li', {}, el('button', { type: 'button', class: 'arch-ref', onclick: () => focus(x) }, `${iconOf(x)} ${x.name}`), extra ? el('span', { class: 'hint' }, ` ${extra}`) : null);
    const list = (title, items, extra = () => '') => (items.length ? [el('h4', {}, `${title} (${items.length})`), el('ul', { class: 'arch-list' }, items.map((x) => link(x.node || x, extra(x))))] : null);
    const facts = [
      (n.type === 'repo' || n.type === 'component') && n.kind && n.kind !== 'other' ? [A('f.kind'), t(`system.kinds.${n.kind}`)] : null,
      n.type === 'resource' ? [A('f.kind'), `${t(`infra.kinds.${n.kind}`)}${n.tech && n.tech !== n.name ? ` · ${n.tech}` : ''}`] : null,
      n.type === 'resource' && n.location ? [A('f.where'), n.location] : null,
      n.type === 'resource' ? [A('f.state'), A(`state.${n.state === 'planned' ? 'planned' : n.source === 'detected' ? 'detected' : 'declared'}`)] : null,
      nb.dept && n.type !== 'dept' ? [A('f.dept'), nb.dept.name] : null,
      nb.repo ? [A('f.repo'), nb.repo.name] : null,
      n.path ? [A('f.path'), n.type === 'repo' ? tildeHome(n.path) : n.path] : null,
      n.type === 'repo' && n.harness ? [A('f.agent'), HARNESS[n.harness] || n.harness] : null,
      n.type === 'system' ? [A('f.order'), n.order.join(' → ') || '—'] : null,
      n.type === 'repo' && n.exists === false ? [A('f.state'), A('state.missing')] : null,
    ].filter(Boolean);
    const scope = scopeOf(n);
    const edit = { dept: ['offices', n.key], system: ['projects', n.key], repo: ['repos', n.key], component: ['repos', n.repo?.replace(/^repo:/, '')], resource: n.key ? ['infra', n.key] : ['infra', null] }[n.type];
    return el('aside', { class: 'arch-detail' },
      el('h3', {}, `${iconOf(n)} ${n.name}`),
      el('p', { class: 'arch-type' }, A(`types.${n.type}`), n.shared ? el('span', { class: 's-tag', title: A('sharedHint') }, `⇄ ${A('shared')}`) : null, n.type === 'component' && !n.declared ? el('span', { class: 's-tag kind' }, A('detected')) : null),
      el('div', { class: 's-row arch-actions' },
        scope && !sameScope(scope, st.scope) ? el('button', { type: 'button', class: 's-mini', onclick: () => go(scope, n.type === 'component' ? n.id : null) }, `⤢ ${A('open')}`) : null,
        edit ? el('button', { type: 'button', class: 's-mini', onclick: () => onGo?.(edit[0], { edit: edit[1], adopt: n.type === 'resource' && !n.key ? n : null }) }, n.type === 'resource' && !n.key ? A('declare') : `✎ ${A('edit')}`) : null,
        n.type === 'repo' ? el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(n.key) }, `✉ ${A('brief')}`) : null,
        n.type === 'system' ? el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(`system:${n.key}`) }, `✉ ${A('brief')}`) : null,
        st.selected ? el('button', { type: 'button', class: 's-mini', onclick: () => { st.selected = null; draw(); } }, A('unselect')) : null),
      el('dl', { class: 'arch-facts' }, facts.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
      n.description ? el('p', { class: 'hint' }, n.description) : null,
      n.instructions ? el('p', { class: 's-dept-text' }, n.instructions) : null,
      list(A('uses'), nb.uses),
      list(A('usedBy'), nb.usedBy),
      nb.reach.length > nb.usedBy.length ? [el('h4', {}, `${A('reach')} (${nb.reach.length})`), el('p', { class: 'hint' }, nb.reach.map((x) => x.name).join(' · '))] : null,
      list(A('infra'), nb.infra, (x) => `· ${t(`infra.how.${x.how}`)}`),
      list(A('users'), nb.users, (x) => `· ${t(`infra.how.${x.how}`)}`),
      n.type === 'system' ? [el('h4', {}, `${A('artifacts')} (${n.parts.length})`), el('ol', { class: 'arch-list' }, n.order.map((name) => n.parts.find((p) => p.name === name)).filter(Boolean).map((p) => el('li', {},
        p.node ? el('button', { type: 'button', class: 'arch-ref', onclick: () => focus(nodeOf(p.node)) }, `${KIND_ICON[p.kind] || ''} ${p.name}`) : el('span', { class: 's-bad' }, `${p.name} · ${A('state.missing')}`),
        p.uses.length ? el('span', { class: 'hint' }, ` → ${p.uses.join(', ')}`) : null)))] : null,
      list(A('components'), nb.components),
      n.type === 'dept' ? list(A('types.repo'), nb.repos) : null,
      n.type !== 'system' && nb.systems.length ? [el('h4', {}, `${A('projects')} (${nb.systems.length})`), projectsList(nb.systems)] : null);
    function focus(x) {
      if (!x) return;
      // already in this picture: just select it; otherwise go to where it is
      if (view.nodes.some((v) => v.ref === x.id || v.id === x.id)) { st.selected = x.id; draw(); } else go(scopeOf(x) || { type: 'company' }, x.type === 'resource' ? x.id : x.type === 'component' ? x.id : null);
    }
  }

  const projectsList = (systems) => (systems.length ? el('ul', { class: 'arch-list' }, systems.map((s) => el('li', {},
    el('span', { class: 'arch-hue', style: `background:${hue(s.key)}`, 'aria-hidden': 'true' }),
    el('button', { type: 'button', class: 'arch-ref', onclick: () => go({ type: 'system', id: s.key }) }, s.name),
    el('span', { class: 'hint' }, ` ${s.order.join(' → ')}`)))) : null);
  const reposIn = (g, d) => g.nodes.filter((r) => r.type === 'repo' && r.dept === d.key).length;
  const deptsList = (g) => el('ul', { class: 'arch-list' }, g.nodes.filter((d) => d.type === 'dept').map((d) => el('li', {},
    el('button', { type: 'button', class: 'arch-ref', onclick: () => go({ type: 'dept', id: d.key }) }, `👥 ${d.name}`),
    el('span', { class: 'hint' }, ` ${reposIn(g, d)} ${A('stats.repos', { n: reposIn(g, d) })}`))));

  // ------------------------------------------------------------ the review

  function review(g) {
    const list = g.findings;
    const show = (f) => {
      const n = f.node ? nodeOf(f.node) : null;
      if (!n) return;
      if (n.type === 'dept' || n.type === 'system') return go(scopeOf(n));
      if (n.type === 'resource') { if (n.techOnly) st.stack = true; return go(n.users.length === 1 ? scopeOf(nodeOf(n.users[0].id)) : { type: 'company' }, n.id); }
      go({ type: 'company' }, n.id);
    };
    return el('section', { class: 'arch-review' },
      el('h3', {}, `${A('review')} (${list.length})`),
      list.length ? el('ul', { class: 'arch-findings' }, list.map((f) => el('li', { class: `lv-${f.level}` },
        el('span', { class: 'arch-lv', 'aria-hidden': 'true' }, f.level === 'warn' ? '⚠' : 'ℹ'),
        el('span', {}, A(`findings.${f.code}`, f.vars)),
        f.node ? el('button', { type: 'button', class: 's-mini', onclick: () => show(f) }, A('show')) : f.code === 'noProjects' ? el('button', { type: 'button', class: 's-mini', onclick: () => onGo?.('projects', {}) }, A('createProject')) : null)))
        : el('p', { class: 'arch-clean' }, `✓ ${A('clean')}`));
  }

  return { render, reload: load, go };
}
