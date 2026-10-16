// ⚙ Ajustes en la terminal: un formulario sobre el corcho, con las mismas pestañas que la web.
//   Agentes      el mantenedor: agregar (ruta completa + CLI), eliminar y mandarle un prompt;
//                se ve lo que trae el harness de cada uno (se guarda en la base SQLite)
//   Personajes   nombre, cargo, colores y rasgos de cada personaje (con vista previa)
// Teclas: ↑↓/tab campo · ◂▸ cambia · escribir edita · Enter acción · ctrl+s guardar · esc cerrar

import { TEAM, DEFAULT_TEAM, APPEARANCE_KEYS, LOOK_PALETTES } from '../public/sim.js';
import { hex, fit, strWidth } from './screen.js';

const ROLES = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];
const HARNESS_NAME = { pi: 'Pi', 'claude-code': 'Claude Code', opencode: 'OpenCode' };
const TABS = [['agents', 'Agentes'], ['look', 'Personajes']];
const C = Object.fromEntries(Object.entries({
  cork: '#b9895a', corkDot: '#8f6640', paper: '#fdfcf6', ink: '#2b2d42', soft: '#6c757d', pin: '#ef476f', shadow: '#0a0b14',
  accent: '#ffd166', ok: '#2a9d8f', err: '#c1121f', field: '#ebe6d6', warn: '#9b5d1d',
}).map(([k, v]) => [k, hex(v)]));

const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
const cycle = (list, current, delta) => {
  const i = list.indexOf(current);
  return list[((i < 0 ? 0 : i) + delta + list.length) % list.length];
};

const HARNESS_IDS = ['claude-code', 'opencode', 'pi'];

export function createSettings({ http, onSaved, onPrompt }) {
  const s = { tab: 'agents', focus: 0, msg: '', msgOk: false, loading: true, data: null, targets: [], form: { path: '', harness: 'claude-code', name: '' }, looks: null, role: 'tl' };

  async function api(method, path, body) {
    try {
      const res = await fetch(`${http}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  const say = (msg, ok = false) => { s.msg = msg; s.msgOk = ok; };

  async function loadAgents() {
    const r = await api('GET', '/v1/agents');
    if (r.ok) s.targets = r.agents;
  }

  async function addAgent() {
    const r = await api('POST', '/v1/agents', s.form);
    if (!r.ok) return say(r.error);
    say(`Listo: «${r.agent.name}» ya aparece en la pizarra.`, true);
    s.form = { path: '', harness: 'claude-code', name: '' };
    await loadAgents();
  }

  async function removeAgent(t) {
    const r = await api('DELETE', `/v1/agents/${encodeURIComponent(t.id)}`);
    if (!r.ok) return say(r.error);
    say(`«${t.name}» eliminado (su carpeta no se toca).`, true);
    await loadAgents();
  }

  async function load() {
    const [r] = await Promise.all([api('GET', '/v1/settings'), loadAgents()]);
    s.loading = false;
    if (!r.ok) return say(r.error);
    s.data = r;
    s.looks = Object.fromEntries(ROLES.map((role) => [role, Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, TEAM[role][k]]))]));
  }

  // ---------------------------------------------------------------- campos de cada pestaña

  function fields() {
    const f = [{ type: 'tabs' }];
    if (s.loading) return [...f, { type: 'info', text: 'Cargando…' }];
    if (!s.data) return f;
    if (s.tab === 'agents') {
      const registered = s.targets.filter((t) => t.registered);
      const loose = s.targets.filter((t) => !t.registered);
      f.push({ type: 'heading', text: 'Agentes registrados (el prompt arranca el pipeline de su harness)' });
      if (!registered.length) f.push({ type: 'info', text: '  Ninguno todavía: agrega uno abajo con su ruta completa.' });
      for (const t of registered) {
        const flags = [t.sessions.some((x) => x.live) && '● abierta', !t.exists && '✗ no existe', t.exists && !t.available && '✗ CLI no instalado'].filter(Boolean).join(' ');
        f.push({ type: 'info', text: `  ${t.name} · ${HARNESS_NAME[t.harness]}${t.kinds.length ? ` · ${t.kinds.join(' + ')}` : ''} ${flags}`, color: C.ink });
        f.push({ type: 'info', text: `    ${tilde(t.path)} · ${t.entries.map((e) => e.label).join(', ')}` });
        f.push({ type: 'action', label: '', value: () => `✉ Prompt a ${t.name}`, run: () => onPrompt?.(t.id) });
        f.push({ type: 'action', label: '', value: () => `✕ Eliminar ${t.name}`, run: () => removeAgent(t) });
      }
      f.push({ type: 'heading', text: 'Agregar agente' });
      f.push({ type: 'text', label: 'Ruta', value: () => s.form.path, placeholder: '/ruta/completa/al/proyecto', edit: (v) => { s.form.path = v; } });
      f.push({ type: 'select', label: 'Agente', value: () => HARNESS_NAME[s.form.harness], cycle: (d) => { s.form.harness = cycle(HARNESS_IDS, s.form.harness, d); } });
      f.push({ type: 'text', label: 'Nombre', value: () => s.form.name, placeholder: '(el de la carpeta)', edit: (v) => { s.form.name = v.slice(0, 40); } });
      f.push({ type: 'action', label: '', value: () => '＋ Agregar', run: () => addAgent() });
      if (loose.length) {
        f.push({ type: 'heading', text: 'Sesiones abiertas sin registrar' });
        for (const t of loose) f.push({ type: 'info', text: `  ${HARNESS_NAME[t.harness] || t.harness} · ${tilde(t.path)}${t.kinds.length ? ` · ${t.kinds.join(' + ')}` : ''}` });
      }
    } else if (s.tab === 'look') {
      const look = s.looks[s.role];
      f.push({ type: 'select', label: 'Personaje', value: () => `${look.name} (${s.role})`, cycle: (d) => { s.role = cycle(ROLES, s.role, d); } });
      f.push({ type: 'text', label: 'Nombre', value: () => look.name, edit: (v) => { look.name = v.slice(0, 20); } });
      f.push({ type: 'text', label: 'Cargo', value: () => look.title, edit: (v) => { look.title = v.slice(0, 30); } });
      for (const [k, label] of [['shirt', 'Camisa'], ['pants', 'Pantalón'], ['hair', 'Pelo'], ['skin', 'Piel']]) {
        const palette = () => (LOOK_PALETTES[k].includes(look[k]) ? LOOK_PALETTES[k] : [look[k], ...LOOK_PALETTES[k]]);
        f.push({ type: 'select', label, swatch: () => look[k], value: () => look[k], cycle: (d) => { look[k] = cycle(palette(), look[k], d); } });
      }
      for (const [k, label] of [['long', 'Pelo largo'], ['beard', 'Barba'], ['glasses', 'Lentes']]) {
        f.push({ type: 'select', label, value: () => (look[k] ? 'sí' : 'no'), cycle: () => { look[k] = !look[k]; } });
      }
      f.push({ type: 'action', label: '', value: () => '🎲 Al azar', run: () => {
        const pick = (l) => l[Math.floor(Math.random() * l.length)];
        Object.assign(look, { shirt: pick(LOOK_PALETTES.shirt), pants: pick(LOOK_PALETTES.pants), hair: pick(LOOK_PALETTES.hair), skin: pick(LOOK_PALETTES.skin), long: Math.random() < 0.5, beard: Math.random() < 0.3, glasses: Math.random() < 0.3 });
      } });
      f.push({ type: 'action', label: '', value: () => '↺ Volver al original', run: () => { Object.assign(look, DEFAULT_TEAM[s.role]); } });
    }
    return f;
  }

  const focusable = (f) => f.filter((x) => !['info', 'heading'].includes(x.type));

  // ---------------------------------------------------------------- guardar

  async function save() {
    if (!s.data) return;
    if (s.tab === 'agents') return addAgent();
    const appearance = {};
    for (const role of ROLES) {
      const changed = Object.fromEntries(APPEARANCE_KEYS.filter((k) => s.looks[role][k] !== DEFAULT_TEAM[role][k]).map((k) => [k, s.looks[role][k]]));
      appearance[role] = Object.keys(changed).length ? changed : null;
    }
    const r = await api('PUT', '/v1/settings', { appearance });
    if (!r.ok) return say(r.error);
    say('Guardado: ya se está usando.', true);
    onSaved?.();
  }

  // ---------------------------------------------------------------- teclado

  /** Devuelve 'close' cuando hay que cerrar. */
  function key(k) {
    const all = fields();
    const list = focusable(all);
    if (s.focus >= list.length) s.focus = Math.max(0, list.length - 1);
    const cur = list[s.focus];
    if (k === 'esc') return 'close';
    if (k === '\x13') { save(); return; } // ctrl+s
    if (k === '\t' || k === 'down') { s.focus = (s.focus + 1) % list.length; return; }
    if (k === 'shift-tab' || k === 'up') { s.focus = (s.focus - 1 + list.length) % list.length; return; }
    if (k === 'left' || k === 'right') {
      const d = k === 'right' ? 1 : -1;
      if (cur?.type === 'tabs') { s.tab = cycle(TABS.map((t) => t[0]), s.tab, d); s.focus = 0; say(''); }
      else cur?.cycle?.(d);
      return;
    }
    if (k === '\r' || k === '\n') {
      if (cur?.run) { cur.run(); return; }
      if (cur?.enter) { cur.enter(); return; }
      s.focus = (s.focus + 1) % list.length;
      return;
    }
    if (!cur?.edit) return;
    const v = String(cur.value() ?? '');
    if (k === '\x7f' || k === '\b') cur.edit([...v].slice(0, -1).join(''));
    else if (k.length <= 2 && k >= ' ') cur.edit(v + k);
  }

  // ---------------------------------------------------------------- dibujo

  function draw(scr, L) {
    const w = Math.min(L.cols - 2, 96), h = Math.min(L.rows - 2, 34);
    const x0 = Math.floor((L.cols - w) / 2), y0 = Math.max(1, Math.floor((L.rows - h) / 2));
    for (let r = y0 + 1; r <= y0 + h; r++) scr.fill(x0 + 1, r, w, C.shadow);
    for (let r = y0; r < y0 + h; r++) {
      scr.fill(x0, r, w, C.cork);
      for (let c = x0; c < x0 + w; c++) if ((c + r * 3) % 7 === 0 && (r === y0 || r === y0 + h - 1 || c < x0 + 2 || c >= x0 + w - 2)) scr.text(c, r, '·', C.corkDot, C.cork);
    }
    for (let r = y0 + 1; r < y0 + h - 1; r++) scr.fill(x0 + 2, r, w - 4, C.paper);
    scr.text(x0 + Math.floor(w / 2), y0, '●', C.pin, C.cork);

    const col = x0 + 4, iw = w - 8;
    const previewW = s.tab === 'look' ? 14 : 0;
    const fw = iw - previewW;
    let row = y0 + 1;
    scr.text(col, row, '⚙ Ajustes', C.ink, C.paper);
    scr.text(col + iw - 5, row, 'esc ✕', C.soft, C.paper);
    row += 2;

    const all = fields();
    const list = focusable(all);
    const cur = list[Math.min(s.focus, list.length - 1)];
    const bodyRows = y0 + h - 4 - row; // deja lugar para el mensaje y la ayuda
    // desplazamiento para que el campo con foco quede a la vista
    const idx = all.indexOf(cur);
    const start = Math.max(0, Math.min(idx - Math.floor(bodyRows / 2), all.length - bodyRows));
    for (const f of all.slice(start, start + bodyRows)) {
      const focus = f === cur;
      if (f.type === 'tabs') {
        let c = col;
        for (const [id, label] of TABS) {
          const on = id === s.tab;
          c += scr.text(c, row, ` ${label} `, on ? C.accent : C.ink, on ? C.ink : C.field) + 1;
        }
        if (focus) scr.text(c + 1, row, '◂ ▸ cambia de pestaña', C.soft, C.paper);
      } else if (f.type === 'heading') {
        scr.text(col, row, fit(f.text, fw), C.ink, C.paper);
      } else if (f.type === 'info') {
        scr.text(col, row, fit(f.text, fw), f.color ?? C.soft, C.paper);
      } else {
        const labelW = 16;
        let c = col;
        if (f.color) c += scr.text(c, row, '■ ', hex(f.color), C.paper);
        scr.text(c, row, fit(f.label, labelW - (c - col)), focus ? C.ink : C.soft, C.paper);
        c = col + labelW;
        const room = fw - labelW - 4;
        let v = String(f.value() ?? '');
        if (f.swatch) { scr.text(c, row, '██', hex(f.swatch()), C.paper); c += 3; }
        const ph = typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder;
        if (f.type === 'text') {
          scr.fill(c, row, room, focus ? C.accent : C.field);
          scr.text(c + 1, row, v ? fit(v, room - 3) : fit(ph || '', room - 3), v ? C.ink : C.soft, focus ? C.accent : C.field);
          if (focus) scr.text(c + 1 + Math.min(strWidth(v), room - 3), row, '▌', C.ink, C.accent);
          if (f.suffix) scr.text(c + room + 1, row, f.suffix, f.suffix === '✓' ? C.ok : C.err, C.paper);
        } else if (f.type === 'select') {
          v = fit(v, room - 6);
          if (focus) scr.text(c, row, ` ◂ ${v} ▸ `, C.accent, C.ink);
          else scr.text(c, row, `   ${v}`, C.ink, C.paper);
        } else if (f.type === 'action') {
          scr.text(c, row, ` ${fit(v, room - 2)} `, focus ? C.accent : C.ink, focus ? C.ink : C.field);
        }
      }
      row++;
    }
    if (s.tab === 'look' && s.looks) drawPreview(scr, x0 + w - 4 - previewW + 2, y0 + 4, s.looks[s.role]);

    const msgRow = y0 + h - 3;
    if (s.msg) scr.text(col, msgRow, fit(`${s.msgOk ? '✓' : '✖'} ${s.msg}`, iw), s.msgOk ? C.ok : C.err, C.paper);
    let c = col;
    for (const [k, label] of [['↑↓', 'campo'], ['◂▸', 'cambia'], ['Enter', 'acción'], ['ctrl+s', 'guardar'], ['esc', 'cerrar']]) {
      c += scr.text(c, y0 + h - 2, k, C.ink, C.paper);
      c += scr.text(c, y0 + h - 2, ` ${label}   `, C.soft, C.paper);
    }
  }

  // Vista previa del personaje: el sprite de la oficina, a doble tamaño, con medios bloques.
  function drawPreview(scr, x, y, look) {
    const sh = hex(look.shirt), pa = hex(look.pants), ha = hex(look.hair), sk = hex(look.skin), eye = hex('#1a1a1a'), bg = hex('#c9b48a'), shoe = hex('#222222');
    const grid = Array.from({ length: 10 }, () => Array(5).fill(bg));
    const P = (cx, cy, col) => { if (grid[cy]?.[cx] !== undefined) grid[cy][cx] = col; };
    [[1, 0], [2, 0], [3, 0], [0, 1], [4, 1]].forEach(([cx, cy]) => P(cx, cy, ha));
    [1, 2, 3].forEach((cx) => { P(cx, 1, sk); P(cx, 3, look.beard ? ha : sk); });
    P(1, 2, eye); P(2, 2, look.glasses ? hex('#2b2b2b') : sk); P(3, 2, eye);
    if (look.long) { P(0, 2, ha); P(4, 2, ha); P(0, 3, ha); P(4, 3, ha); }
    for (let cy = 4; cy <= 6; cy++) for (let cx = 0; cx < 5; cx++) P(cx, cy, sh);
    P(0, 6, sk); P(4, 6, sk);
    for (const cy of [7, 8]) { P(1, cy, pa); P(3, cy, pa); }
    P(1, 9, shoe); P(3, 9, shoe);
    // cada pixel del sprite = 2 columnas × 1 media fila; dos filas del sprite por fila de texto
    for (let r = 0; r < 5; r++) {
      for (let cx = 0; cx < 5; cx++) {
        for (const dx of [0, 1]) scr.text(x + cx * 2 + dx, y + r * 2, '▀', grid[r * 2][cx], grid[r * 2][cx]);
        for (const dx of [0, 1]) scr.text(x + cx * 2 + dx, y + r * 2 + 1, '▀', grid[r * 2 + 1][cx], grid[r * 2 + 1][cx]);
      }
    }
    scr.text(x, y + 10, fit(look.name, 12), hex('#2b2d42'), hex('#fdfcf6'));
  }

  load();
  return { key, draw, get state() { return s; } };
}
