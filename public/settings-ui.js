// ⚙ Ajustes en la vista web: Oficina (proyectos, directorio, comandos), Proyecto (equipo por
// rol, harness, orquestador, permisos de Claude) y Pipelines (editar, validar, crear, borrar).

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
const option = (value, label, selected) => el('option', { value, selected: selected ? true : undefined }, label);
const put = (panel, ...nodes) => panel.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));

// "pi -p {task} --model x" ⇄ ["pi", "-p", "{task}", "--model", "x"]
export const formatCommand = (arr) => arr.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
export function parseCommand(str) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2] ?? m[3]);
  return out;
}

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
}

export function createSettings({ onSaved } = {}) {
  const st = { tab: 'office', data: null, office: null, projectDir: null, project: null, pipelineId: null, dirty: false };
  const msg = (text, ok = false) => { $('s-msg').textContent = text; $('s-msg').style.color = ok ? '#2a9d8f' : ''; };

  async function open(tab = 'office') {
    $('settings').showModal();
    msg('Cargando…', true);
    const r = await api('GET', '/v1/settings');
    if (!r.ok) return msg(r.error);
    st.data = r;
    st.office = structuredClone(r.office);
    st.projectDir ||= r.projects.find((d) => r.office.projects.includes(d)) || r.projects[0] || null;
    msg('');
    show(tab);
  }

  function show(tab) {
    st.tab = tab;
    for (const b of document.querySelectorAll('#settings .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll('#settings .s-panel')) p.hidden = p.dataset.panel !== tab;
    $('settings-save').hidden = false;
    if (tab === 'office') renderOffice();
    else if (tab === 'look') { st.looks = null; renderLook(); }
    else loadProject().then(() => (tab === 'project' ? renderProject() : renderPipelines()));
  }

  // ------------------------------------------------------------ Oficina

  function renderOffice() {
    const o = st.office;
    $('s-file').textContent = o.file.replace(/^\/Users\/[^/]+/, '~');
    const panel = document.querySelector('[data-panel="office"]');
    const addInput = el('input', { type: 'text', placeholder: '/ruta/al/proyecto (con o sin .devteam/)', 'aria-label': 'Ruta del proyecto' });
    const add = () => {
      const v = addInput.value.trim();
      if (v && !o.projects.includes(v)) o.projects.push(v);
      addInput.value = '';
      renderOffice();
    };
    addInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    put(panel, 
      el('h3', {}, 'Proyectos'),
      el('p', { class: 'hint' }, 'Los que el diálogo de la pizarra ofrece. También aparecen solos los de las sesiones conectadas.'),
      el('ul', { class: 's-list' }, o.projects.length
        ? o.projects.map((p, i) => el('li', {}, el('span', {}, p), el('button', { type: 'button', class: 's-mini danger', 'aria-label': `Quitar ${p}`, onclick: () => { o.projects.splice(i, 1); renderOffice(); } }, 'Quitar')))
        : el('li', {}, el('span', { class: 'hint' }, 'Ninguno todavía.'))),
      el('div', { class: 's-row' }, addInput, el('button', { type: 'button', class: 's-mini', onclick: add }, 'Agregar')),
      el('h3', {}, 'Directorio por defecto'),
      el('p', { class: 'hint' }, 'Dónde se lanzan los agentes nuevos cuando no eliges proyecto.'),
      el('input', { type: 'text', value: o.cwd, placeholder: '(el directorio donde arrancó la oficina)', 'aria-label': 'Directorio por defecto', oninput: (e) => { o.cwd = e.target.value; } }),
      el('h3', {}, 'Comandos para lanzar agentes'),
      el('p', { class: 'hint' }, '{task} es la tarea; va como un único argumento, sin shell.'),
      ...Object.entries(o.launchers).map(([agent, l]) => el('div', { class: 's-cmd' },
        el('span', {}, HARNESS_NAME[agent] || agent),
        el('input', { type: 'text', value: formatCommand(l.command), 'aria-label': `Comando de ${HARNESS_NAME[agent] || agent}`, oninput: (e) => { l.command = parseCommand(e.target.value); l.edited = true; } }),
        el('span', { class: l.available ? 's-ok' : 's-bad', title: l.available ? 'Encontrado en el PATH' : 'No está en el PATH' }, l.available ? '✓ instalado' : '✗ no está'),
        el('button', { type: 'button', class: 's-mini', title: 'Volver al de fábrica', onclick: () => { l.command = [...st.data.office.defaults.launchers[agent]]; l.edited = true; renderOffice(); } }, '↺'),
      )),
    );
  }

  async function saveOffice() {
    const o = st.office;
    const launchers = Object.fromEntries(Object.entries(o.launchers).filter(([, l]) => l.edited).map(([a, l]) => [a, l.command]));
    const r = await api('PUT', '/v1/settings', { projects: o.projects, cwd: o.cwd, launchers });
    if (!r.ok) return msg(r.error);
    st.data.office = r.settings;
    st.office = structuredClone(r.settings);
    st.data.projects = (await api('GET', '/v1/settings')).projects || st.data.projects;
    renderOffice();
    msg('Guardado. Ya se está usando.', true);
    onSaved?.();
  }

  // ------------------------------------------------------------ Proyecto

  async function loadProject() {
    if (!st.projectDir) { st.project = null; return; }
    const r = await api('GET', `/v1/settings/project?dir=${encodeURIComponent(st.projectDir)}`);
    st.project = r.ok ? r : null;
    if (!r.ok) msg(r.error);
    if (st.project) {
      st.team = structuredClone(st.project.team || {});
      st.team.roles ||= {};
    }
  }

  function projectPicker(onchange) {
    return el('label', { class: 'b-field' }, el('span', {}, 'Proyecto'),
      el('select', { 'aria-label': 'Proyecto', onchange: async (e) => { st.projectDir = e.target.value; st.pipelineId = null; await loadProject(); onchange(); } },
        st.data.projects.length ? st.data.projects.map((d) => option(d, d.replace(/^\/Users\/[^/]+/, '~'), d === st.projectDir)) : option('', 'Agrega un proyecto en la pestaña Oficina')));
  }

  function renderProject() {
    const panel = document.querySelector('[data-panel="project"]');
    if (!st.project) { put(panel, projectPicker(renderProject), el('p', { class: 'hint' }, 'Agrega proyectos en la pestaña Oficina.')); return; }
    const t = st.team;
    const p = st.project;
    $('s-file').textContent = `${p.dir.replace(/^\/Users\/[^/]+/, '~')}/.devteam/team.json`;
    const harnessSelect = (value, onchange, withDefault, label) => el('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value || undefined) },
      withDefault ? option('', withDefault, !value) : null,
      ...p.harnesses.map((h) => option(h.id, `${h.label}${h.available ? '' : ' (no instalado)'}`, h.id === value)));
    const defaultHarness = t.harness || 'pi';
    const claudeArgs = t.harnessOptions?.['claude-code']?.args || ['--permission-mode', 'acceptEdits'];
    const mode = claudeArgs[claudeArgs.indexOf('--permission-mode') + 1] || 'acceptEdits';

    const roleRows = ROLE_ORDER.flatMap((role) => {
      const cfg = t.roles[role] || {};
      const h = cfg.harness || defaultHarness;
      const agents = p.agents[h] || [];
      const agentModel = agents.find((a) => a.name === cfg.agent)?.model;
      const set = (k, v) => { t.roles[role] = { ...t.roles[role], [k]: v || undefined }; renderProject(); };
      return [
        el('span', { class: 's-role', style: `--c:${TEAM[role].shirt}` }, el('i'), `${TEAM[role].name} · ${TEAM[role].title}`),
        harnessSelect(cfg.harness, (v) => set('harness', v), `(${HARNESS_NAME[defaultHarness]})`, `Harness de ${TEAM[role].name}`),
        el('select', { 'aria-label': `Agente de ${TEAM[role].name}`, onchange: (e) => set('agent', e.target.value) },
          option('', '— sin agente —', !cfg.agent),
          ...agents.map((a) => option(a.name, `${a.name}${a.scope === 'user' ? ' (global)' : ''}`, a.name === cfg.agent)),
          cfg.agent && !agents.some((a) => a.name === cfg.agent) ? option(cfg.agent, `${cfg.agent} (no encontrado)`, true) : null),
        el('input', { type: 'text', value: cfg.model || '', placeholder: agentModel || 'modelo (opcional)', 'aria-label': `Modelo de ${TEAM[role].name}`, oninput: (e) => { t.roles[role] = { ...t.roles[role], model: e.target.value || undefined }; } }),
      ];
    });

    put(panel, 
      projectPicker(renderProject),
      el('label', { class: 'b-field' }, el('span', {}, 'Nombre'), el('input', { type: 'text', value: t.name || '', placeholder: p.name, oninput: (e) => { t.name = e.target.value; } })),
      el('label', { class: 'b-field' }, el('span', {}, 'Harness'), harnessSelect(t.harness, (v) => { t.harness = v; renderProject(); }, '(Pi)', 'Harness por defecto')),
      el('label', { class: 'b-field' }, el('span', {}, 'Orquesta'), harnessSelect(t.orchestrator?.harness, (v) => { t.orchestrator = { ...t.orchestrator, harness: v }; }, `(${HARNESS_NAME[defaultHarness]})`, 'Harness del orquestador')),
      el('label', { class: 'b-field' }, el('span', {}, 'En paralelo'), el('input', { type: 'number', min: 1, max: 8, value: t.maxParallel || 3, 'aria-label': 'Etapas en paralelo', oninput: (e) => { t.maxParallel = Number(e.target.value); } })),
      el('h3', {}, 'Equipo'),
      el('p', { class: 'hint' }, 'Qué agente y qué modelo hace el trabajo de cada personaje. Los agentes salen de .pi/agents, .claude/agents y .opencode/agents.'),
      el('div', { class: 's-grid' },
        el('span', { class: 'head' }, 'Personaje'), el('span', { class: 'head' }, 'Harness'), el('span', { class: 'head' }, 'Agente'), el('span', { class: 'head' }, 'Modelo'),
        ...roleRows),
      el('h3', {}, 'Claude Code'),
      el('label', { class: 'b-field' }, el('span', {}, 'Permisos'),
        el('select', { 'aria-label': 'Modo de permisos de Claude', onchange: (e) => { t.harnessOptions = { ...t.harnessOptions, 'claude-code': { ...t.harnessOptions?.['claude-code'], args: ['--permission-mode', e.target.value] } }; } },
          ...p.claudePermissionModes.map((m) => option(m, m, m === mode)))),
      el('p', { class: 'hint' }, 'Cuando la oficina lanza una etapa con Claude nadie aprueba permisos: acceptEdits edita archivos y deniega lo demás.'),
      el('details', {}, el('summary', {}, 'Ejecutables (avanzado)'),
        ...p.harnesses.map((h) => el('label', { class: 'b-field' }, el('span', {}, h.label),
          el('input', { type: 'text', value: t.harnessOptions?.[h.id]?.bin || '', placeholder: h.bin, oninput: (e) => { t.harnessOptions = { ...t.harnessOptions, [h.id]: { ...t.harnessOptions?.[h.id], bin: e.target.value || undefined } }; } })))),
    );
  }

  async function saveProject() {
    const r = await api('PUT', '/v1/settings/team', { dir: st.projectDir, team: st.team });
    if (!r.ok) return msg(r.error);
    st.project = r.project;
    st.team = structuredClone(r.project.team);
    st.team.roles ||= {};
    renderProject();
    msg('Equipo guardado.', true);
    onSaved?.();
  }

  // ------------------------------------------------------------ Pipelines

  function renderPipelines(issues) {
    const panel = document.querySelector('[data-panel="pipelines"]');
    if (!st.project) { put(panel, projectPicker(renderPipelines), el('p', { class: 'hint' }, 'Agrega proyectos en la pestaña Oficina.')); return; }
    const list = st.project.pipelines;
    if (st.pipelineId === null && list.length) st.pipelineId = list[0].id;
    const current = list.find((p) => p.id === st.pipelineId);
    const isNew = !current;
    $('s-file').textContent = `${st.project.dir.replace(/^\/Users\/[^/]+/, '~')}/.devteam/pipelines/${st.pipelineId || '<id>'}.json`;
    const idInput = el('input', { type: 'text', value: isNew ? st.pipelineId || '' : st.pipelineId, placeholder: 'id-del-pipeline', 'aria-label': 'Id del pipeline', readonly: !isNew ? true : undefined });
    const json = el('textarea', { class: 's-json', spellcheck: 'false', 'aria-label': 'Pipeline en JSON' });
    json.value = JSON.stringify(st.draft ?? current?.raw ?? st.data.pipelineTemplate, null, 2);
    json.oninput = () => { st.draft = null; st.draftText = json.value; };
    if (st.draftText !== undefined && st.draftFor === st.pipelineId) json.value = st.draftText;
    st.draftFor = st.pipelineId;
    st.readDraft = () => ({ id: idInput.value.trim(), text: json.value });

    const shownIssues = issues ?? current?.issues ?? [];
    put(panel, 
      projectPicker(() => { st.draftText = undefined; renderPipelines(); }),
      el('div', { class: 's-row' },
        el('select', { 'aria-label': 'Pipeline', onchange: (e) => { st.pipelineId = e.target.value || ''; st.draftText = undefined; renderPipelines(); } },
          ...list.map((p) => option(p.id, `${p.name} (${p.id})`, p.id === st.pipelineId)),
          option('', '➕ Nuevo pipeline', isNew)),
        el('button', { type: 'button', class: 's-mini', onclick: () => validate() }, 'Validar'),
        !isNew ? el('button', { type: 'button', class: 's-mini danger', onclick: () => remove() }, 'Borrar') : null),
      isNew ? el('label', { class: 'b-field' }, el('span', {}, 'Id'), idInput) : null,
      json,
      shownIssues.length
        ? el('ul', { class: 's-issues' }, shownIssues.map((i) => el('li', {}, i)))
        : issues ? el('ul', { class: 's-issues ok' }, el('li', {}, '✓ Sin problemas')) : null,
      el('p', { class: 'hint' }, 'Etapas: id, name, role, phase, agent, model, harness, needs, prompt ({{task}}, {{previous}}, {{failure}}, {{<id>.output}}), check { run, expect: pass|fail }, onFail { goto, max }. Ver docs/pipelines.md.'),
    );
  }

  function readPipeline() {
    const { id, text } = st.readDraft();
    try { return { id, pipeline: JSON.parse(text) }; } catch (err) { msg(`JSON inválido: ${err.message}`); return null; }
  }

  async function validate() {
    const d = readPipeline();
    if (!d) return;
    const r = await api('POST', '/v1/settings/pipeline/check', { dir: st.projectDir, id: d.id || 'nuevo', pipeline: d.pipeline });
    st.draftText = st.readDraft().text;
    renderPipelines(r.issues || []);
    msg(r.ok ? '' : r.error || 'El pipeline tiene errores');
  }

  async function savePipeline() {
    const d = readPipeline();
    if (!d) return;
    const r = await api('PUT', '/v1/settings/pipeline', { dir: st.projectDir, id: d.id, pipeline: d.pipeline });
    if (!r.ok) return msg(r.error);
    st.project = r.project;
    st.pipelineId = d.id;
    st.draftText = undefined;
    renderPipelines(r.issues);
    msg('Pipeline guardado: ya aparece en el diálogo de la pizarra.', true);
    onSaved?.();
  }

  async function remove() {
    if (!confirm(`¿Borrar el pipeline "${st.pipelineId}"? Se elimina el archivo .devteam/pipelines/${st.pipelineId}.json`)) return;
    const r = await api('DELETE', '/v1/settings/pipeline', { dir: st.projectDir, id: st.pipelineId });
    if (!r.ok) return msg(r.error);
    st.project = r.project;
    st.pipelineId = null;
    renderPipelines();
    msg('Pipeline borrado.', true);
    onSaved?.();
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
    $('s-file').textContent = st.office.file.replace(/^\/Users\/[^/]+/, '~');
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
    st.data.office = r.settings;
    msg('Listo: el equipo ya luce así en la oficina.', true);
    onSaved?.();
  }

  // ------------------------------------------------------------ eventos

  for (const b of document.querySelectorAll('#settings .tabs button')) b.onclick = () => { msg(''); show(b.dataset.tab); };
  $('settings-close').onclick = $('settings-cancel').onclick = () => $('settings').close();
  $('settings-save').onclick = () => ({ office: saveOffice, project: saveProject, pipelines: savePipeline, look: saveLook })[st.tab]();
  $('settings-form').onsubmit = (e) => e.preventDefault();

  return { open };
}
