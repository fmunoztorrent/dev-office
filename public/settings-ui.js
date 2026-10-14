// ⚙ Ajustes en la vista web. La oficina es el frontend: guarda sólo lo suyo (Personajes). La
// pestaña Agentes muestra lo que cada agente conectado anuncia (su proyecto, sus pipelines); eso
// se configura en el agente, en <proyecto>/.devteam/.

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES } from './sim.js';

const ROLE_ORDER = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
const HARNESS_NAME = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode' };

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}
const put = (panel, ...nodes) => panel.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
}

export function createSettings({ onSaved } = {}) {
  const st = { tab: 'agents', office: null, state: null, looks: null };
  const msg = (text, ok = false) => { $('s-msg').textContent = text; $('s-msg').style.color = ok ? '#2a9d8f' : ''; };

  async function open(tab = 'agents') {
    $('settings').showModal();
    msg('Cargando…', true);
    const [s, state] = await Promise.all([api('GET', '/v1/settings'), api('GET', '/v1/state')]);
    if (!s.ok) return msg(s.error);
    st.office = s.office;
    st.state = state.ok ? state : { agents: [], projects: [] };
    msg('');
    show(tab);
  }

  function show(tab) {
    st.tab = tab;
    for (const b of document.querySelectorAll('#settings .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll('#settings .s-panel')) p.hidden = p.dataset.panel !== tab;
    $('settings-save').hidden = tab !== 'look';
    if (tab === 'agents') renderAgents();
    else { st.looks = null; renderLook(); }
  }

  // ------------------------------------------------------------ Agentes (sólo lectura)

  function renderAgents() {
    const { agents = [], projects = [] } = st.state;
    $('s-file').textContent = '';
    const panel = document.querySelector('[data-panel="agents"]');
    const stage = (s) => el('li', { style: `--c:${TEAM[s.role]?.shirt || '#888'}` },
      el('b', {}, `${TEAM[s.role]?.name || s.role} · ${s.phase}`), ` ${s.name}`,
      el('span', { class: 'hint' }, [s.agent, s.model, s.check && `⚙ ${s.check.run} (${s.check.expect === 'pass' ? 'pasa' : 'falla'})`].filter(Boolean).map((x) => ` · ${x}`).join('')));
    put(panel,
      el('p', { class: 'hint' }, 'La oficina es el frontend: los agentes ejecutan las tareas y los pipelines. Esto es lo que anuncian ahora mismo.'),
      el('h3', {}, 'Sesiones conectadas'),
      el('ul', { class: 's-list' }, agents.length
        ? agents.map((a) => el('li', {}, el('span', {}, `${HARNESS_NAME[a.agent] || a.agent} · ${tilde(a.cwd)}`),
          el('span', { class: 'hint' }, (a.can || []).join(' · ') || 'tareas')))
        : el('li', {}, el('span', { class: 'hint' }, 'Ninguna. Abre Pi u OpenCode con su integración; las sesiones de Claude Code aparecen al usarlas.'))),
      el('h3', {}, 'Proyectos y pipelines'),
      projects.length ? projects.map((p) => el('div', { class: 's-project' },
        el('p', {}, el('b', {}, p.name), el('span', { class: 'hint' }, ` ${tilde(p.dir)}`)),
        p.pipelines.length ? p.pipelines.map((pl) => el('details', {},
          el('summary', {}, `${pl.name} (${pl.stages.length} etapas) — lo corre: ${pl.hosts.map((h) => HARNESS_NAME[h.agent] || h.agent).join(', ')}`),
          pl.description ? el('p', { class: 'hint' }, pl.description) : null,
          el('ol', { class: 's-stages' }, pl.stages.map(stage)),
          pl.issues?.length ? el('ul', { class: 's-issues' }, pl.issues.map((i) => el('li', {}, i))) : null))
          : el('p', { class: 'hint' }, 'Sin .devteam/pipelines en este proyecto.'))) : el('p', { class: 'hint' }, 'Ningún agente anunció un proyecto todavía.'),
      el('h3', {}, 'Configurar'),
      el('p', { class: 'hint' }, 'Equipo, modelos y pipelines viven en el proyecto: .devteam/team.json y .devteam/pipelines/*.json (ver docs/pipelines.md). Los agentes los vuelven a leer al empezar cada pipeline.'),
      el('pre', { class: 's-json' }, 'dev-team-office install    # integra Pi, OpenCode y Claude Code'),
    );
  }

  // ------------------------------------------------------------ Personajes

  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

  // El mismo sprite que en la oficina (game.js), de pie y quieto.
  function drawSprite(canvas, c) {
    const P = 4, ctx = canvas.getContext('2d');
    canvas.width = 16 * P; canvas.height = 25 * P;
    ctx.fillStyle = '#c9b48a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ox = 8 * P, oy = 24 * P;
    const px = (gx, gy, gw, gh, col) => { ctx.fillStyle = col; ctx.fillRect(ox + gx * P, oy + gy * P, gw * P, gh * P); };
    px(-3, -6, 2, 6, c.pants); px(1, -6, 2, 6, c.pants); px(-3, -1, 2, 1, '#222'); px(1, -1, 2, 1, '#222');
    px(-4, -13, 8, 7, c.shirt); px(-6, -13, 2, 6, c.shirt); px(-6, -7, 2, 1, c.skin); px(4, -13, 2, 6, c.shirt); px(4, -7, 2, 1, c.skin);
    px(-1, -14, 2, 1, c.skin); px(-3, -20, 6, 6, c.skin);
    px(-3, -21, 6, 2, c.hair); px(-4, -20, 1, 3, c.hair); px(3, -20, 1, 3, c.hair);
    if (c.long) { px(-4, -18, 1, 5, c.hair); px(3, -18, 1, 5, c.hair); }
    if (c.beard) px(-3, -15, 6, 1, c.hair);
    if (c.glasses) px(-3, -18, 6, 1, '#cfe8ff');
    px(-2, -18, 1, 1, '#1a1a1a'); px(1, -18, 1, 1, '#1a1a1a');
    if (c.glasses) px(-3, -19, 6, 1, '#2b2b2b');
    px(-1, -16, 2, 1, '#7a2e2e');
  }

  function renderLook() {
    st.looks ||= Object.fromEntries(ROLE_ORDER.map((r) => [r, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, TEAM[r][k]]))]));
    $('s-file').textContent = tilde(st.office.file);
    const panel = document.querySelector('[data-panel="look"]');
    const cards = ROLE_ORDER.map((role) => {
      const look = st.looks[role];
      const canvas = el('canvas', { 'aria-label': `Vista previa de ${look.name}` });
      const redraw = () => drawSprite(canvas, look);
      const set = (k, v) => { look[k] = v; redraw(); };
      const color = (k, label) => el('label', {}, el('input', { type: 'color', value: look[k], 'aria-label': `${label} de ${look.name}`, oninput: (e) => set(k, e.target.value) }), label);
      const toggle = (k, label) => el('label', {}, el('input', { type: 'checkbox', checked: look[k] ? true : undefined, onchange: (e) => set(k, e.target.checked) }), label);
      redraw();
      return el('div', { class: 's-look' },
        canvas,
        el('div', { class: 'pair' },
          el('input', { type: 'text', value: look.name, maxlength: 20, 'aria-label': 'Nombre', oninput: (e) => { look.name = e.target.value; } }),
          el('input', { type: 'text', value: look.title, maxlength: 30, 'aria-label': 'Cargo', oninput: (e) => { look.title = e.target.value; } })),
        el('div', { class: 'colors' }, color('shirt', 'Camisa'), color('pants', 'Pantalón'), color('hair', 'Pelo'), color('skin', 'Piel')),
        el('div', { class: 'toggles' }, toggle('long', 'Pelo largo'), toggle('beard', 'Barba'), toggle('glasses', 'Lentes')),
        el('div', { class: 'toggles' },
          el('span', { class: 'hint' }, `rol: ${role}`),
          el('button', { type: 'button', class: 's-mini', title: 'Al azar', onclick: () => { Object.assign(look, { shirt: pickOne(LOOK_PALETTES.shirt), hair: pickOne(LOOK_PALETTES.hair), skin: pickOne(LOOK_PALETTES.skin), pants: pickOne(LOOK_PALETTES.pants), long: Math.random() < 0.5, beard: Math.random() < 0.3, glasses: Math.random() < 0.3 }); renderLook(); } }, '🎲'),
          el('button', { type: 'button', class: 's-mini', title: 'Volver al original', onclick: () => { Object.assign(look, DEFAULT_TEAM[role]); renderLook(); } }, '↺')),
      );
    });
    put(panel,
      el('p', { class: 'hint' }, 'Cómo se ven y cómo se llaman los personajes. Cada uno sigue representando su rol (QA, backend…).'),
      el('div', { class: 's-looks' }, cards));
  }

  async function saveLook() {
    const appearance = {};
    for (const role of ROLE_ORDER) {
      const look = st.looks[role];
      const changed = Object.fromEntries(APPEARANCE_KEYS.filter((k) => look[k] !== DEFAULT_TEAM[role][k]).map((k) => [k, look[k]]));
      appearance[role] = Object.keys(changed).length ? changed : null;
    }
    const r = await api('PUT', '/v1/settings', { appearance });
    if (!r.ok) return msg(r.error);
    st.office = r.settings;
    msg('Listo: el equipo ya luce así en la oficina.', true);
    onSaved?.();
  }

  // ------------------------------------------------------------ eventos

  for (const b of document.querySelectorAll('#settings .tabs button')) b.onclick = () => { msg(''); show(b.dataset.tab); };
  $('settings-close').onclick = $('settings-cancel').onclick = () => $('settings').close();
  $('settings-save').onclick = () => st.tab === 'look' && saveLook();
  $('settings-form').onsubmit = (e) => e.preventDefault();

  return { open };
}
