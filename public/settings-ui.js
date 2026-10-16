// ⚙ Ajustes en la vista web. La oficina es el frontend y guarda lo suyo en su base SQLite:
//   Agentes      el mantenedor: cada agente es una ruta completa + el CLI que la atiende. Lo que
//                trae su harness (Errementari, comandos, prompts, .devteam/) se detecta, y un
//                prompt enviado desde la pizarra arranca ESE pipeline.
//   Personajes   cómo se ven los personajes.

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES } from './sim.js';

const ROLE_ORDER = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
const HARNESS_NAME = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode' };

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (k === 'value') e.value = v ?? '';
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}
const put = (panel, ...nodes) => panel.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
const option = (value, label, selected) => el('option', { value, selected: selected ? true : undefined }, label);

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
}

const emptyForm = () => ({ id: null, path: '', harness: '', name: '', bin: '', args: '', detected: null, touched: false });

export function createSettings({ getTargets = () => [], onPrompt, onSaved } = {}) {
  const st = { tab: 'agents', office: null, looks: null, form: emptyForm() };
  const msg = (text, ok = false) => { $('s-msg').textContent = text; $('s-msg').style.color = ok ? '#2a9d8f' : ''; };

  async function open(tab = 'agents') {
    $('settings').showModal();
    msg('Cargando…', true);
    const s = await api('GET', '/v1/settings');
    if (!s.ok) return msg(s.error);
    st.office = s.office;
    msg('');
    show(tab);
  }

  function show(tab) {
    st.tab = tab;
    for (const b of document.querySelectorAll('#settings .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll('#settings .s-panel')) p.hidden = p.dataset.panel !== tab;
    $('settings-save').hidden = tab !== 'look';
    $('s-file').textContent = st.office ? tilde(st.office.file) : '';
    if (tab === 'agents') renderAgents();
    else { st.looks = null; renderLook(); }
  }

  /** Llega una lista nueva de agentes (alguien se conectó, se guardó un cambio…). */
  function refresh() {
    if ($('settings').open && st.tab === 'agents') renderList();
  }

  // ------------------------------------------------------------ Agentes (el mantenedor)

  function renderAgents() {
    const panel = document.querySelector('[data-panel="agents"]');
    put(panel,
      el('p', { class: 'hint' }, 'Cada agente es una ruta completa y el CLI que la atiende. La oficina detecta el pipeline de su harness (Errementari, comandos, prompts, .devteam/). Un prompt desde la pizarra lo arranca: en la sesión abierta en esa ruta, o en una sesión nueva.'),
      el('div', { id: 's-agent-list', class: 's-agents' }),
      el('h3', { id: 's-form-title' }),
      el('div', { id: 's-agent-form', class: 's-form' }));
    renderList();
    renderForm();
  }

  function renderList() {
    const box = $('s-agent-list');
    if (!box) return;
    const targets = getTargets();
    const registered = targets.filter((t) => t.registered);
    const loose = targets.filter((t) => !t.registered);
    const card = (t) => el('div', { class: 's-agent' },
      el('div', { class: 's-agent-head' },
        el('b', {}, t.name), el('span', { class: 's-tag' }, HARNESS_NAME[t.harness] || t.harness),
        ...t.kinds.map((k) => el('span', { class: 's-tag kind' }, k)),
        t.sessions.some((x) => x.live) ? el('span', { class: 's-ok' }, '● sesión abierta') : null,
        !t.exists ? el('span', { class: 's-bad' }, '✗ no existe la ruta') : !t.available ? el('span', { class: 's-bad' }, `✗ ${HARNESS_NAME[t.harness]} no está instalado`) : null),
      el('div', { class: 'hint' }, tilde(t.path)),
      el('div', { class: 's-entries' }, t.entries.map((e) => el('span', { title: e.description || '' }, e.label))),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 's-mini', onclick: () => onPrompt?.(t.id) }, '✉ Enviar prompt'),
        t.registered
          ? [el('button', { type: 'button', class: 's-mini', onclick: () => edit(t) }, 'Editar'),
            el('button', { type: 'button', class: 's-mini danger', onclick: () => remove(t) }, 'Eliminar')]
          : el('button', { type: 'button', class: 's-mini', onclick: () => { st.form = { ...emptyForm(), path: t.path, harness: t.harness, touched: true }; renderForm(); detect(); } }, 'Registrar')));
    put(box,
      registered.length ? registered.map(card) : el('p', { class: 'hint' }, 'Todavía no registraste ningún agente. Agrega uno abajo con su ruta completa.'),
      loose.length ? [el('h3', {}, 'Sesiones abiertas sin registrar'), loose.map(card)] : null);
  }

  function renderForm() {
    const f = st.form;
    const box = $('s-agent-form');
    if (!box) return;
    $('s-form-title').textContent = f.id ? `Editar «${f.name || f.id}»` : 'Agregar agente';
    let timer = null;
    const pathInput = el('input', { type: 'text', value: f.path, placeholder: '/Users/tú/Workspace/mi-proyecto  (o ~/Workspace/mi-proyecto)', 'aria-label': 'Ruta completa del proyecto',
      oninput: (e) => { f.path = e.target.value; clearTimeout(timer); timer = setTimeout(detect, 350); } });
    const d = f.detected;
    put(box,
      el('label', { class: 'b-field' }, el('span', {}, 'Ruta'), pathInput),
      el('p', { class: 'hint', id: 's-detected' }, !d ? 'Escribe la ruta: la oficina detecta qué harness trae.'
        : !d.exists ? '✗ No existe esa carpeta.'
          : `Encontré: ${[...d.kinds, ...(d.harnesses.length ? [d.harnesses.map((h) => HARNESS_NAME[h]).join(' + ')] : [])].join(' · ') || 'sin harness configurado (sólo prompt directo)'} — ${d.entries.length} entrada(s).`),
      el('label', { class: 'b-field' }, el('span', {}, 'Agente'),
        el('select', { 'aria-label': 'CLI que atiende la ruta', onchange: (e) => { f.harness = e.target.value; f.touched = true; } },
          option('', '— elige —', !f.harness), ...Object.entries(HARNESS_NAME).map(([id, label]) => option(id, label + (d?.harnesses?.includes(id) ? ' ✓ configurado' : ''), id === f.harness)))),
      el('label', { class: 'b-field' }, el('span', {}, 'Nombre'), el('input', { type: 'text', value: f.name, placeholder: '(el nombre de la carpeta)', maxlength: 40, oninput: (e) => { f.name = e.target.value; } })),
      el('details', {}, el('summary', {}, 'Avanzado'),
        el('label', { class: 'b-field' }, el('span', {}, 'Ejecutable'), el('input', { type: 'text', value: f.bin, placeholder: '(el del PATH: claude, opencode, pi)', oninput: (e) => { f.bin = e.target.value; } })),
        el('label', { class: 'b-field' }, el('span', {}, 'Argumentos'), el('input', { type: 'text', value: f.args, placeholder: 'p. ej. --permission-mode acceptEdits', oninput: (e) => { f.args = e.target.value; } })),
        el('p', { class: 'hint' }, 'Sólo para sesiones nuevas. Claude Code usa --permission-mode acceptEdits si no pones nada.')),
      el('div', { class: 's-row' },
        el('button', { type: 'button', class: 'btn', onclick: save }, f.id ? 'Guardar cambios' : '＋ Agregar agente'),
        f.id || f.path ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { st.form = emptyForm(); renderForm(); } }, 'Cancelar') : null));
  }

  async function detect() {
    const f = st.form;
    if (!f.path.trim()) { f.detected = null; renderForm(); return; }
    const r = await api('POST', '/v1/agents/detect', { path: f.path });
    if (st.form !== f) return;
    f.detected = r.ok ? r : { exists: false, kinds: [], harnesses: [], entries: [] };
    if (!f.touched && r.ok && r.harnesses.length) f.harness = r.harnesses[0];
    const focused = document.activeElement?.getAttribute('aria-label');
    renderForm();
    if (focused) document.querySelector(`#s-agent-form [aria-label="${focused}"]`)?.focus();
  }

  function edit(t) {
    st.form = { ...emptyForm(), id: t.id, path: t.path, harness: t.harness, name: t.name, bin: t.bin || '', args: (t.args || []).join(' '), touched: true };
    renderForm();
    detect();
    $('s-agent-form').scrollIntoView({ block: 'nearest' });
  }

  async function save() {
    const f = st.form;
    const body = { path: f.path, harness: f.harness, name: f.name, bin: f.bin || null, args: f.args.trim() ? f.args.trim().split(/\s+/) : null };
    const r = f.id ? await api('PUT', `/v1/agents/${encodeURIComponent(f.id)}`, body) : await api('POST', '/v1/agents', body);
    if (!r.ok) return msg(r.error);
    st.form = emptyForm();
    renderForm();
    msg(f.id ? 'Agente actualizado.' : `Listo: «${r.agent?.name}» ya aparece en la pizarra.`, true);
    onSaved?.();
  }

  async function remove(t) {
    if (!confirm(`¿Eliminar el agente «${t.name}»? Sólo se borra de la oficina: su carpeta no se toca.`)) return;
    const r = await api('DELETE', `/v1/agents/${encodeURIComponent(t.id)}`);
    if (!r.ok) return msg(r.error);
    msg('Agente eliminado.', true);
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
    st.office = { ...st.office, appearance: r.appearance };
    msg('Listo: el equipo ya luce así en la oficina.', true);
    onSaved?.();
  }

  // ------------------------------------------------------------ eventos

  for (const b of document.querySelectorAll('#settings .tabs button')) b.onclick = () => { msg(''); show(b.dataset.tab); };
  $('settings-close').onclick = $('settings-cancel').onclick = () => $('settings').close();
  $('settings-save').onclick = () => st.tab === 'look' && saveLook();
  $('settings-form').onsubmit = (e) => e.preventDefault();

  return { open, refresh };
}
