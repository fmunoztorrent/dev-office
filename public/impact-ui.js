// The impact of an order, drawn (public/impact.js lays it out), for the directives dialog (floors-ui.js)
// and the brief dialog (main.js):
//
//   renderImpact(box, map, …)    the tree of the repos it involves: a box each, and over a box (pointer
//                                or keyboard focus) a bubble with how it is touched; ⤢ opens the graph
//   openImpactGraph(map, …)      every impact and dependency, in layers, in its own dialog: hover a node
//                                to see what it reaches and is reached by, zoom with the buttons
//   impactQuestions(box, …)      a question for each thing it needs that is not on the map: a component
//                                (in a project? a repo of its own? a new repo? infrastructure?) or a piece
//                                of infrastructure (does it exist, where? must it be created, by whom?)

import { t } from './i18n.js';
import { impactTree, impactGraph, layoutGraph, RESOURCE_ICON, RESOURCE_KINDS, RESOURCE_LINKS } from './impact.js';

const SVG = 'http://www.w3.org/2000/svg';
const U = (k, v) => t(`impact.ui.${k}`, v);
const HARNESSES = ['claude-code', 'opencode', 'pi', 'codex'];
const AGENT_NAME = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi', codex: 'Codex' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return e;
}
function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  e.append(...children.filter(Boolean));
  return e;
}
// an artifact's or a resource's kind, in words ('component' too)
const kindLabel = (k) => (k === 'component' ? U('component') : RESOURCE_KINDS.includes(k) ? t(`infra.kinds.${k}`) : t(`system.kinds.${k}`));
const clip = (s, n) => { const x = String(s ?? ''); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const tilde = (p) => String(p || '').replace(/^\/(Users|home)\/[^/]+/, '~');

// ---------------------------------------------------------------- the bubble

let bubble = null;
function showBubble(target, content) {
  if (!bubble) { bubble = el('div', { class: 'imp-bubble', role: 'tooltip', id: 'imp-bubble' }); }
  // inside the open dialog (the top layer), so it is drawn over it
  const host = target.closest('dialog') || document.body;
  if (bubble.parentNode !== host) host.append(bubble);
  bubble.replaceChildren(...content);
  bubble.hidden = false;
  const r = target.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const left = Math.min(window.innerWidth - b.width - 8, Math.max(8, r.left + r.width / 2 - b.width / 2));
  const below = r.bottom + 8 + b.height < window.innerHeight;
  bubble.style.left = `${left}px`;
  bubble.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - b.height - 8)}px`;
  target.setAttribute('aria-describedby', 'imp-bubble');
}
function hideBubble() { if (bubble) bubble.hidden = true; }

/** What a box says when you look at it: why it is in, how it is touched, what it uses. */
function describe(n, map, { title }) {
  const d = n.data || {};
  const row = (k, ...v) => el('div', { class: 'imp-b-row' }, el('b', {}, k), ' ', ...v);
  const out = [];
  if (n.kind === 'task') {
    out.push(el('div', { class: 'imp-b-head' }, `📋 ${U('task')}`), el('p', {}, clip(title, 400)));
    if (map.insight?.summary) out.push(row(`🧠 ${U('summary')}:`, map.insight.summary));
    return out;
  }
  if (n.kind === 'dept') {
    out.push(el('div', { class: 'imp-b-head' }, `🏢 ${n.label}`), el('p', {}, U('dept', { n: d.projects?.filter((p) => p.impacted).length || 0 })));
    return out;
  }
  if (n.kind === 'group') return [el('div', { class: 'imp-b-head' }, n.label), el('p', {}, U('answerBelow'))];
  if (n.kind === 'unknown') {
    return [el('div', { class: 'imp-b-head' }, `❓ ${d.name}`), d.kind && d.kind !== 'component' ? el('p', { class: 'imp-b-dim' }, t(`infra.kinds.${d.kind}`)) : null, el('p', {}, d.question || ''), el('p', { class: 'imp-b-dim' }, U('answerBelow'))].filter(Boolean);
  }
  if (n.kind === 'component') {
    return [el('div', { class: 'imp-b-head' }, `🧩 ${d.name}`), d.project ? row(`📁`, d.project) : null, d.path ? row(`${U('path')}:`, d.path) : null].filter(Boolean);
  }
  if (n.kind === 'resource') {
    const users = (d.projects || []).map((x) => `${x.name} (${t(`infra.how.${x.how || 'uses'}`)})`).join(', ');
    return [
      el('div', { class: 'imp-b-head' }, `${RESOURCE_ICON[d.kind] || '⚙️'} ${d.name}`),
      el('p', { class: 'imp-b-dim' }, [t(`infra.kinds.${d.kind}`), d.tech && d.tech !== d.name ? d.tech : '', d.state === 'planned' ? t('infra.planned') : ''].filter(Boolean).join(' · ')),
      d.location ? row(`${U('where')}:`, d.location) : null,
      users ? row(`${U('usedBy')}:`, users) : null,
      d.how ? row(`🧠 ${U('how')}:`, d.how) : null,
      d.said ? row('«', d.said, '»') : null,
    ].filter(Boolean);
  }
  // a repo: why, how, its components, its infrastructure and its system
  const p = d;
  out.push(el('div', { class: 'imp-b-head' }, `📁 ${p.name}`));
  out.push(el('p', { class: 'imp-b-dim' }, [p.kind && p.kind !== 'other' ? t(`system.kinds.${p.kind}`) : '', AGENT_NAME[p.harness] || p.harness || '', p.level ? U(`level.${p.level}`) : ''].filter(Boolean).join(' · ')));
  if (p.why) out.push(row(`${U('why')}:`, t(`impact.why.${p.why}`, { via: p.via || '' })));
  if (p.how) out.push(row(`🧠 ${U('how')}:`, p.how));
  const comps = (p.components || []).filter((c) => c.impacted).map((c) => c.name);
  if (comps.length) out.push(row(`🧩 ${U('components')}:`, comps.join(', ')));
  const res = (map.resources || []).filter((r) => !r.techOnly && r.projects?.some((x) => x.id === p.id));
  if (res.length) out.push(row(`🗄 ${U('infra')}:`, res.map((r) => `${RESOURCE_ICON[r.kind] || ''} ${r.name} (${t(`infra.how.${r.projects.find((x) => x.id === p.id)?.how || 'uses'}`)})${r.state === 'planned' ? ` · ${t('infra.planned')}` : ''}`).join(', ')));
  const stack = (p.infra || []).filter((x) => !x.name).map((x) => x.tech);
  if (stack.length) out.push(row(`${U('stack')}:`, stack.join(', ')));
  for (const s of map.systems || []) {
    const part = s.parts.find((x) => x.project && p.path && (x.project === p.path || x.project.startsWith(`${p.path}/`)));
    if (!part) continue;
    const users = s.parts.filter((x) => x.uses?.includes(part.name)).map((x) => x.name);
    out.push(row(`🧩 ${U('system')}:`, `${s.name}${part.uses?.length ? ` · ${t('system.uses', { list: part.uses.join(', ') })}` : ''}${users.length ? ` · ${t('system.usedBy', { list: users.join(', ') })}` : ''}`));
  }
  if (p.path) out.push(row(`${U('path')}:`, tilde(p.path)));
  return out;
}

/** A box can be looked at with the pointer or the keyboard. */
function lookable(g, n, map, opts) {
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', `${n.label}${n.sub ? ` · ${n.sub}` : ''}`);
  const on = () => showBubble(g, describe(n, map, opts));
  g.addEventListener('pointerenter', on);
  g.addEventListener('focus', on);
  g.addEventListener('pointerleave', hideBubble);
  g.addEventListener('blur', hideBubble);
  g.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideBubble(); e.stopPropagation(); } });
}

function boxText(n, w, big = false) {
  const max = Math.floor((w - 14) / (big ? 7.4 : 6.6));
  return [
    svg('text', { class: 'imp-t1', x: 8, y: n.sub ? 18 : 25 }, document.createTextNode(clip(n.label, max))),
    n.sub ? svg('text', { class: 'imp-t2', x: 8, y: 34 }, document.createTextNode(clip(n.sub, max + 4))) : null,
  ];
}

// ---------------------------------------------------------------- the tree

/**
 * Draws the tree of an impact in `box`. `status`: a line over it (the model analyzing, or how it went);
 * `title`: the order. ⤢ opens the graph.
 */
export function renderImpact(box, map, { title = '', status = '' } = {}) {
  hideBubble();
  if (!map) { box.hidden = true; box.replaceChildren(); return; }
  const tree = impactTree(map, { title: clip(title.split('\n')[0], 40) || U('task'), unknownLabel: U('unknown'), kindLabel });
  const pad = 6;
  const W = tree.width + pad * 2, H = tree.height + pad * 2;
  const s = svg('svg', { class: 'imp-tree', width: W, height: H, viewBox: `${-pad} ${-pad} ${W} ${H}`, role: 'group', 'aria-label': U('tree') });
  const at = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const l of tree.links) {
    const a = at.get(l.from), b = at.get(l.to);
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, ym = (y1 + y2) / 2;
    s.append(svg('path', { class: `imp-link${b.kind === 'unknown' ? ' unknown' : ''}`, d: `M${x1} ${y1} V${ym} H${x2} V${y2}` }));
  }
  for (const n of tree.nodes) {
    const state = n.kind === 'unknown' ? 'unknown' : n.data?.why === 'uses' ? 'reached' : n.data?.why === 'model' ? 'model' : '';
    const g = svg('g', { class: `imp-node k-${n.kind} ${state}${n.level ? ` lv-${n.level}` : ''}`, transform: `translate(${n.x} ${n.y})` },
      svg('rect', { width: n.w, height: n.h, rx: 4 }),
      n.level ? svg('rect', { class: 'imp-level', width: 4, height: n.h }) : null,
      ...boxText(n, n.w, n.kind === 'task'));
    lookable(g, n, map, { title });
    s.append(g);
  }
  const graph = el('button', { type: 'button', class: 'fl-mini imp-expand', onclick: () => openImpactGraph(map, { title }) }, U('expand'));
  box.hidden = false;
  box.replaceChildren(
    el('div', { class: 'imp-head' }, el('span', { class: 'fl-label' }, U('tree')), status ? el('span', { class: 'imp-status', role: 'status' }, status) : null, graph),
    el('div', { class: 'imp-scroll' }, s));
}

// ---------------------------------------------------------------- the graph

let zoom = 1;
/** Opens the graph of every impact and dependency of the order (dialog #impact-graph). */
export function openImpactGraph(map, { title = '' } = {}) {
  const dialog = document.getElementById('impact-graph');
  if (!dialog) return;
  const g = layoutGraph(impactGraph(map, { title: clip(title.split('\n')[0], 40) || U('task'), kindLabel }));
  const pad = 14;
  const W = g.width + pad * 2, H = g.height + pad * 2;
  const s = svg('svg', { class: 'imp-graph', viewBox: `${-pad} ${-pad} ${W} ${H}`, role: 'group', 'aria-label': U('graphTitle') });
  s.append(svg('defs', {}, svg('marker', { id: 'imp-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L8 4 L0 8 z' }))));
  const at = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const e of g.edges) {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) continue;
    let d;
    if (b.x > a.x) { const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, c = (x2 - x1) / 2; d = `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`; }
    // the same column or backwards: around, over the boxes
    else { const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x + b.w / 2, y2 = b.y, top = Math.min(y1, y2) - 26; d = `M${x1} ${y1} C${x1} ${top} ${x2} ${top} ${x2} ${y2}`; }
    const path = svg('path', { class: `imp-edge e-${e.kind}`, d, 'marker-end': 'url(#imp-arrow)' });
    // only what says something: how it uses a resource (not plain use), and what the model said
    const words = e.kind === 'link' && e.label && e.label !== 'uses' ? t(`infra.how.${e.label}`) : e.kind === 'model' ? e.label : '';
    const label = words ? svg('text', { class: 'imp-elabel', x: b.x > a.x ? (a.x + a.w + b.x) / 2 : (a.x + b.x + a.w) / 2, y: b.x > a.x ? (a.y + b.y + a.h) / 2 - 4 : Math.min(a.y, b.y) - 22, 'text-anchor': 'middle' }, document.createTextNode(clip(words, 20))) : null;
    const wrap = svg('g', { class: 'imp-e', 'data-from': e.from, 'data-to': e.to }, path, label);
    edges.push(wrap);
    s.append(wrap);
  }
  for (const n of g.nodes) {
    const node = svg('g', { class: `imp-node k-${n.kind} s-${n.state}`, transform: `translate(${n.x} ${n.y})`, 'data-id': n.id },
      svg('rect', { width: n.w, height: n.h, rx: 4 }),
      n.data?.level ? svg('rect', { class: `imp-level lv-${n.data.level}`, width: 4, height: n.h }) : null,
      ...boxText(n, n.w, n.kind === 'task'));
    lookable(node, n, map, { title });
    // what it reaches and what reaches it, lit; the rest, dim
    const near = (on) => {
      s.classList.toggle('focus', on);
      const ids = new Set([n.id]);
      for (const e of edges) {
        const hit = e.dataset.from === n.id || e.dataset.to === n.id;
        e.classList.toggle('lit', on && hit);
        if (hit) { ids.add(e.dataset.from); ids.add(e.dataset.to); }
      }
      for (const x of s.querySelectorAll('.imp-node')) x.classList.toggle('lit', on && ids.has(x.dataset.id));
    };
    node.addEventListener('pointerenter', () => near(true));
    node.addEventListener('focus', () => near(true));
    node.addEventListener('pointerleave', () => near(false));
    node.addEventListener('blur', () => near(false));
    s.append(node);
  }
  const holder = dialog.querySelector('.imp-g-scroll');
  const size = () => { s.setAttribute('width', Math.round(W * zoom)); s.setAttribute('height', Math.round(H * zoom)); };
  const fit = () => { const r = holder.getBoundingClientRect(); zoom = Math.max(0.25, Math.min(1.4, (r.width - 20) / W, (r.height - 20) / H)); size(); };
  dialog.querySelector('#ig-in').onclick = () => { zoom = Math.min(2.5, zoom * 1.25); size(); };
  dialog.querySelector('#ig-out').onclick = () => { zoom = Math.max(0.25, zoom / 1.25); size(); };
  dialog.querySelector('#ig-fit').onclick = fit;
  dialog.querySelector('#ig-close').onclick = () => { hideBubble(); dialog.close(); };
  dialog.onclose = hideBubble;
  dialog.querySelector('#ig-legend').replaceChildren(...['impacted', 'reached', 'dependency', 'new', 'unknown'].map((k) => el('span', { class: `imp-key s-${k}` }, el('i', {}), U(`legend.${k}`))));
  dialog.querySelector('#ig-count').textContent = U('count', { n: g.nodes.length, e: g.edges.length });
  dialog.querySelector('#ig-summary').textContent = map.insight?.summary ? `🧠 ${map.insight.summary}` : '';
  holder.replaceChildren(g.nodes.length > 1 ? s : el('p', { class: 'fl-empty' }, U('empty')));
  if (!dialog.open) dialog.showModal();
  fit();
}

// ---------------------------------------------------------------- the questions

/**
 * One question per thing the order needs that is not on the map. `projects`: [{ id, name, dept }];
 * `offices`: [{ id, name }]. What you answered survives a redraw (the model may add questions). Returns
 * { answers: () => [...], missing: () => the first one not answered, or null }.
 */
export function impactQuestions(box, unknown = [], { projects = [], offices = [], head = '' } = {}) {
  const kept = box._kept || (box._kept = new Map()); // key → { field: value }
  const P = (k) => t(`exec.ui.${k}`);
  const projectSelect = (first) => el('select', { 'aria-label': P('ansProject') }, first !== undefined ? el('option', { value: '' }, first) : null, projects.map((a) => el('option', { value: a.id }, `${a.name}${a.dept ? ` · ${a.dept}` : ''}`)));
  const rows = unknown.map((u) => {
    const infra = u.kind && u.kind !== 'component';
    const k = kept.get(u.key) || {};
    const actions = infra ? ['', 'exists', 'create', 'ignore'] : ['', 'exists', 'create', 'repo', 'newRepo', 'resource', 'department', 'ignore'];
    const f = {
      action: el('select', { 'aria-label': u.question }, actions.map((v) => el('option', { value: v }, infra ? t(`exec.ui.infraAns.${v || 'pick'}`) : t(`exec.ui.ans.${v || 'pick'}`)))),
      project: projectSelect(infra ? P('ansUsedBy') : undefined),
      who: projectSelect(P('ansWho')),
      path: el('input', { type: 'text', maxlength: 200, placeholder: P('ansPath'), 'aria-label': P('ansPath') }),
      where: el('input', { type: 'text', maxlength: 300, placeholder: P('ansWhere'), 'aria-label': P('ansWhere') }),
      location: el('input', { type: 'text', maxlength: 200, placeholder: P('ansLocation'), 'aria-label': P('ansLocation') }),
      harness: el('select', { 'aria-label': P('ansHarness') }, HARNESSES.map((h) => el('option', { value: h }, AGENT_NAME[h] || h))),
      office: el('select', { 'aria-label': P('ansOffice') }, offices.map((o) => el('option', { value: o.id }, `🏢 ${o.name}`))),
      kind: el('select', { 'aria-label': P('ansKind') }, RESOURCE_KINDS.filter((x) => x !== 'repo').map((x) => el('option', { value: x }, `${RESOURCE_ICON[x]} ${t(`infra.kinds.${x}`)}`))),
      how: el('select', { 'aria-label': P('ansHow') }, RESOURCE_LINKS.filter((x) => x !== 'owns').map((x) => el('option', { value: x }, t(`infra.how.${x}`)))),
      dept: el('input', { type: 'text', maxlength: 40, value: u.name, placeholder: P('ansDept'), 'aria-label': P('ansDept') }),
    };
    if (!infra) f.kind.value = 'service';
    for (const [name, v] of Object.entries(k)) if (f[name] && v !== undefined) f[name].value = v;
    const show = {
      exists: infra ? ['location', 'project', 'how'] : ['project', 'path'], create: infra ? ['who', 'location'] : ['project', 'path'],
      repo: ['where', 'harness', 'office'], newRepo: ['where', 'harness', 'office'], resource: ['kind', 'location', 'project', 'how'], department: ['dept'],
    };
    const sync = () => {
      const on = new Set(show[f.action.value] || []);
      for (const [name, input] of Object.entries(f)) if (name !== 'action') input.hidden = !on.has(name);
      f.where.placeholder = f.action.value === 'newRepo' ? P('ansNewPath') : P('ansWhere');
      kept.set(u.key, Object.fromEntries(Object.entries(f).map(([n, i]) => [n, i.value])));
    };
    for (const input of Object.values(f)) { input.addEventListener('change', sync); input.addEventListener('input', sync); }
    sync();
    const icon = infra ? `${RESOURCE_ICON[u.kind] || '⚙️'} ` : '';
    return { u, infra, f, node: el('div', { class: `dv-q${u.source === 'model' ? ' from-model' : ''}` }, el('b', {}, `${icon}${u.question}`), el('div', { class: 'dv-q-row' }, ...Object.values(f))) };
  });
  box.replaceChildren(...(rows.length ? [el('span', { class: 'fl-label' }, head || t('impact.unknownHead')), ...rows.map((r) => r.node)] : []));
  const answer = ({ u, infra, f }) => {
    const a = { key: u.key, name: u.phrase, action: f.action.value };
    const v = (x) => f[x].value.trim();
    if (infra) {
      if (a.action === 'exists') Object.assign(a, { where: v('location'), ...(v('project') ? { project: v('project'), how: v('how') } : {}) });
      if (a.action === 'create') Object.assign(a, { project: v('who'), where: v('location') });
    } else if (a.action === 'exists' || a.action === 'create') Object.assign(a, { project: v('project'), path: v('path') });
    else if (a.action === 'repo' || a.action === 'newRepo') Object.assign(a, { where: v('where'), harness: v('harness'), office: v('office') });
    else if (a.action === 'resource') Object.assign(a, { kind: v('kind'), where: v('location'), ...(v('project') ? { project: v('project'), how: v('how') } : {}) });
    else if (a.action === 'department') a.department = v('dept') || u.name;
    return a;
  };
  return {
    answers: () => rows.map(answer).filter((a) => a.action),
    /** The first question without a usable answer (its select gets the focus), or null. */
    missing: () => {
      for (const r of rows) {
        const a = answer(r);
        const bad = !a.action || ((a.action === 'exists' || a.action === 'create') && !r.infra && !a.project) || (r.infra && a.action === 'create' && !a.project) || ((a.action === 'repo' || a.action === 'newRepo') && !a.where);
        if (bad) { (a.action ? r.f[a.action === 'create' && r.infra ? 'who' : a.action === 'repo' || a.action === 'newRepo' ? 'where' : 'project'] : r.f.action).focus(); return r.u; }
      }
      return null;
    },
  };
}
