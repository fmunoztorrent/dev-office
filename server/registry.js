// Los agentes a los que la oficina les puede mandar un prompt. La oficina es el frontend: cada
// agente es un backend con su propio "harness engineering" (Errementari, gentle-pi, comandos,
// pipelines de .devteam/…) y es ESE harness el que corre el pipeline.
//
// - Registrados (⚙ › Agentes, el mantenedor): una ruta completa + el CLI que la atiende (Claude
//   Code, OpenCode, Pi). Se guardan en la base SQLite (server/store.js).
// - Conectados: cualquier sesión de agente abierta (Pi/OpenCode por WebSocket, Claude Code por su
//   hook), aunque su ruta no esté registrada.
//
// Para cada uno se detecta qué trae su harness (detectHarness) y por dónde se arranca su pipeline.
// run() manda el prompt por esa entrada: a una sesión abierta en esa ruta o a una sesión nueva.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { clip } from './roles.js';
import { detectHarness, invocation, HARNESSES, which } from '../integrations/common/devteam.mjs';

const DETECT_TTL = 4000;
const AGENT_NAME = { 'claude-code': 'Claude Code', opencode: 'OpenCode', pi: 'Pi' };
const inside = (dir, root) => !!dir && !!root && (dir === root || dir.startsWith(`${root}${path.sep}`));

export class AgentRegistry extends EventEmitter {
  /** @param getAgents () => los agentes registrados ([{ id, name, path, harness, bin?, args? }]) */
  constructor({ getAgents, hub, pipelines, office }) {
    super();
    this.getAgents = getAgents;
    this.office = office;
    this.hub = hub;
    this.pipelines = pipelines;
    this.cache = new Map();
    hub.on('change', () => this.changed());
    pipelines.on('change', () => this.changed());
  }

  // la base puede estar cerrándose (la oficina se apaga mientras se desconectan los agentes)
  #agents() { try { return this.getAgents(); } catch { return []; } }

  #detect(dir) {
    const hit = this.cache.get(dir);
    if (hit && Date.now() - hit.at < DETECT_TTL) return hit.info;
    let info;
    try { info = detectHarness(dir); } catch (err) { info = { dir, name: path.basename(dir), exists: false, harnesses: [], kinds: [], entries: [], roles: {}, error: err.message }; }
    this.cache.set(dir, { at: Date.now(), info });
    return info;
  }

  /** Sesiones abiertas: Pi/OpenCode conectados y sesiones de Claude Code que anunció su hook. */
  #sessions() {
    const live = this.hub.liveAgents().filter((c) => c.session).map((c) => ({ agent: c.agent, session: c.session, cwd: c.cwd, live: true }));
    const hooked = this.pipelines.hosts().filter((h) => !h.live && !live.some((l) => l.session === h.session)).map((h) => ({ agent: h.agent, session: h.session, cwd: h.cwd, live: false }));
    return [...live, ...hooked];
  }

  /** Lo que ofrece el diálogo de la pizarra: cada agente con las entradas de su harness. */
  targets() {
    const sessions = this.#sessions();
    const used = new Set();
    const describe = ({ id, name, dir, harness, registered, own }) => {
      const info = this.#detect(dir);
      const mine = own.map((s) => ({ session: s.session, agent: s.agent, live: s.live, label: `${AGENT_NAME[s.agent] || s.agent} · ${s.live ? 'sesión abierta' : 'Claude, al terminar su turno'}` }));
      const harnessOk = (e) => e.harnesses.includes(harness) || own.some((s) => e.harnesses.includes(s.agent));
      return {
        id, name, path: dir, harness, registered, exists: info.exists,
        available: !!which(harness === 'claude-code' && process.env.DEV_TEAM_OFFICE_CLAUDE_BIN || HARNESSES[harness]?.bin),
        kinds: info.kinds, roles: info.roles,
        entries: info.entries.filter(harnessOk).map((e) => ({ ...e, harnesses: undefined })),
        sessions: mine,
      };
    };
    const out = [];
    for (const a of this.#agents()) {
      const own = sessions.filter((s) => inside(s.cwd, a.path) && (s.agent === a.harness || !a.harness));
      own.forEach((s) => used.add(s.session));
      out.push({ ...describe({ id: a.id, name: a.name, dir: a.path, harness: a.harness, registered: true, own }), bin: a.bin || null, args: a.args || null });
    }
    // sesiones abiertas fuera de las rutas registradas: también se les puede mandar un prompt
    for (const s of sessions) {
      if (used.has(s.session) || !s.cwd) continue;
      out.push(describe({ id: `session:${s.session}`, name: path.basename(s.cwd), dir: s.cwd, harness: s.agent, registered: false, own: [s] }));
    }
    return out;
  }

  target(id) { return this.targets().find((t) => t.id === id) || null; }

  /**
   * Manda un prompt a un agente por una entrada de su harness.
   * msg: { target, entry, text, session?: id | null (null = sesión nueva), from }
   */
  run({ target, entry = 'prompt', text, session, from } = {}) {
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: 'el prompt está vacío' };
    const t = this.targets().find((x) => x.id === target);
    if (!t) return { ok: false, error: 'ese agente no está registrado ni conectado' };
    const e = t.entries.find((x) => x.id === entry);
    if (!e) return { ok: false, error: `el harness de ${t.name} no tiene la entrada "${entry}"` };
    const s = session === null ? null : t.sessions.find((x) => x.session === session) || (session === undefined ? t.sessions.find((x) => x.live) : null);
    if (session && !s) return { ok: false, error: 'esa sesión ya no está abierta' };
    if (s) this.office?.setAgentRoles(s.session, t.roles); // qué subagente del harness es qué personaje

    // pipeline de .devteam/: lo ejecuta una sesión abierta, dentro de sí misma
    if (e.devteam) {
      if (!s) return { ok: false, error: `«${e.label}» lo corre una sesión abierta: abre ${AGENT_NAME[t.harness] || t.harness} en ${t.path} con su integración` };
      return this.pipelines.start({ session: s.session, agent: s.agent, pipeline: e.devteam, task: text, from, meta: { agentId: t.registered ? t.id : null, entry: e.id } });
    }
    const inv = invocation(e, text);
    const title = clip(`${e.id === 'prompt' ? '' : `${e.label}: `}${text}`, 300);
    const meta = { agentId: t.registered ? t.id : null, entry: e.id };
    if (s) return this.hub.submit({ text: inv.text, title, agent: s.agent, session: s.session, command: inv.command, args: inv.args, from, meta });
    if (!t.registered) return { ok: false, error: 'esa sesión ya no está abierta' };
    if (!t.exists) return { ok: false, error: `no existe ${t.path}` };
    const a = this.#agents().find((x) => x.id === t.id);
    return this.hub.submit({ text: inv.text, title, agent: t.harness, mode: 'launch', cwd: t.path, command: inv.command, args: inv.args, launch: { bin: a?.bin, args: a?.args }, from, meta });
  }

  // varios cambios seguidos (una sesión que se registra mueve tareas y pipelines) → un solo aviso
  changed() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.emit('change', this.targets()); });
  }
}
