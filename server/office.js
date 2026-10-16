import { EventEmitter } from 'node:events';
import { adapt } from './adapters.js';
import { ROLE_IDS, roleForTool, roleForText, describe, clip, normRole, normPhase } from './roles.js';

const LOG_MAX = 300;
const SESSIONS_MAX = 30;
const PAIR_WINDOW_MS = 15_000;
const FLOW_MAX = 40;
// Las llamadas al script del skill no son trabajo del equipo, sólo avisos a la oficina.
const OFFICE_CLI = /office-event(\.mjs)?\b/;

const TODO_STATUS = new Set(['pending', 'in_progress', 'completed']);
function normTodos(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((t, i) => ({
    id: String(t.id ?? i + 1),
    content: clip(t.content ?? t.subject ?? t.title ?? t.text ?? '', 120),
    status: TODO_STATUS.has(t.status) ? t.status : t.status === 'done' ? 'completed' : 'pending',
  }));
}

const SESSION_STATUS = { waiting: 'waiting', done: 'done', session_end: 'ended' };

export class Office extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.seq = 0;
    this.sessions = new Map();
    this.roles = Object.fromEntries(ROLE_IDS.map((id) => [id, { id, status: 'idle', text: '', ts: 0, actions: 0 }]));
    this.log = [];
    this.emit('reset');
  }

  /** Recibe un payload de cualquier agente y devuelve los eventos normalizados emitidos. */
  ingest(source = 'generic', payload = {}) {
    const out = [];
    for (const raw of adapt(source, payload)) {
      const ev = this.#enrich({ ...raw, source: clip(raw.source || source, 30) });
      if (!ev) continue;
      this.#apply(ev);
      out.push(ev);
      this.emit('event', ev, this.sessionSummary(ev.session));
    }
    return out;
  }

  #session(id, source, cwd) {
    const key = clip(id || `${source}-default`, 100);
    let s = this.sessions.get(key);
    if (!s) {
      s = { id: key, source, cwd: clip(cwd || '', 200), title: '', status: 'active', todos: [], subagents: [],
        tools: 0, errors: 0, startedAt: Date.now(), lastAt: Date.now(),
        // Rol "de turno" declarado por el agente con eventos `phase` (y la fase en la que está).
        turn: null, phase: null, flow: [] };
      this.sessions.set(key, s);
      if (this.sessions.size > SESSIONS_MAX) {
        const oldest = [...this.sessions.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
        this.sessions.delete(oldest.id);
      }
    }
    if (cwd && !s.cwd) s.cwd = clip(cwd, 200);
    return s;
  }

  #enrich(r) {
    const s = this.#session(r.session, r.source, r.cwd);
    const tool = typeof r.tool === 'string' ? r.tool : '';
    const t = tool.toLowerCase();
    const input = r.input && typeof r.input === 'object' ? r.input : {};
    const ev = { id: ++this.seq, ts: Date.now(), source: r.source, session: s.id, kind: r.kind, tool, ok: r.ok !== false };

    if (r.kind === 'tool_start' || r.kind === 'tool_end') {
      const start = r.kind === 'tool_start';
      if (t === 'task' || t === 'agent' || t === 'subagent' || t === 'subagent_run' || t === 'subagent_continue') {
        // `subagent` es la herramienta de la extensión de subagentes de Pi: { agent, task } | { tasks } | { chain };
        // `subagent_run` la de gentle-pi: { agent, task, label }
        const many = input.tasks || input.chain;
        const agentType = input.subagent_type || input.agent || (Array.isArray(many) ? many[0]?.agent : undefined);
        const desc = input.description || input.label || (Array.isArray(many) ? many.map((x) => x.agent).join(' → ') : input.task || input.prompt);
        return start
          ? this.#startSub(s, ev, { desc, agentType, toolUseId: r.toolUseId })
          : this.#endSub(s, ev, { toolUseId: r.toolUseId, desc: input.description });
      }
      if (t === 'todowrite') {
        if (!start) return null;
        s.todos = normTodos(input.todos);
        return { ...ev, kind: 'todos', role: 'manager', text: 'Actualiza el tablero' };
      }
      if (t === 'taskcreate') {
        if (!start) return null;
        s.todos.push({ id: String(s.todos.length + 1), content: clip(input.subject || input.description, 120), status: 'pending' });
        return { ...ev, kind: 'todos', role: 'manager', text: clip(`Nueva tarjeta: ${input.subject || ''}`) };
      }
      if (t === 'taskupdate') {
        if (!start) return null;
        const todo = s.todos.find((x) => x.id === String(input.taskId));
        if (todo) {
          if (TODO_STATUS.has(input.status)) todo.status = input.status;
          if (input.subject) todo.content = clip(input.subject, 120);
        }
        return { ...ev, kind: 'todos', role: 'manager', text: 'Mueve una tarjeta' };
      }
      if (OFFICE_CLI.test(String(input.command || ''))) return null;
      // Si el agente declaró quién está de turno, ese rol hace el trabajo; si no, se deduce de la herramienta.
      ev.role = normRole(r.role) || s.turn || roleForTool(tool, input);
      if (s.turn && ev.role === s.turn) ev.phase = s.phase;
      ev.text = clip(r.text && start ? r.text : describe(tool, input), 90);
      if (!start && !ev.ok) ev.text = clip(`Falló: ${ev.text}${r.text ? ` — ${r.text}` : ''}`, 120);
      return ev;
    }

    const role = normRole(r.role);
    switch (r.kind) {
      case 'phase': {
        if (!role) return null;
        const phase = normPhase(r.phase) || 'trabaja';
        const prev = normRole(r.from) || s.turn;
        s.turn = role;
        s.phase = phase;
        s.flow.push({ role, phase, text: clip(r.text, 90), ts: ev.ts });
        if (s.flow.length > FLOW_MAX) s.flow.splice(0, s.flow.length - FLOW_MAX);
        return { ...ev, role, phase, from: prev && prev !== role ? prev : null, text: clip(r.text, 120) };
      }
      case 'phase_end': {
        const was = s.turn;
        s.turn = s.phase = null;
        return was ? { ...ev, role: was, text: clip(r.text, 120) } : null;
      }
      case 'subagent_start':
        return this.#startSub(s, ev, { desc: r.text, agentType: r.agentType, agentId: r.agentId, fromHook: true, role });
      case 'subagent_end':
        return this.#endSub(s, ev, { agentId: r.agentId, toolUseId: r.toolUseId, fromHook: !r.toolUseId });
      case 'task':
        // La extensión y el skill de Pi pueden anunciar la misma tarea: se descarta el duplicado.
        if (s.title === clip(r.text, 300) && ev.ts - (s.taskAt || 0) < 30_000) return null;
        s.title = clip(r.text, 300);
        s.taskAt = ev.ts;
        s.turn = s.phase = null;
        s.flow = [];
        s.todos = s.status === 'done' ? [] : s.todos;
        return { ...ev, role: role || 'po', text: clip(r.text, 200) };
      case 'todos':
        s.todos = normTodos(r.todos);
        return { ...ev, role: 'manager', text: 'Actualiza el tablero' };
      case 'thinking': return { ...ev, role: role || s.turn || 'tl', text: clip(r.text || 'Pensando…') };
      case 'waiting': return { ...ev, role: 'manager', text: clip(r.text || 'El agente espera tu aprobación', 140) };
      case 'error': return { ...ev, ok: false, role: role || 'tl', text: clip(r.text || 'Algo salió mal', 140) };
      case 'compact': return { ...ev, role: 'manager', text: 'Ordena las notas (compacta el contexto)' };
      case 'done':
        // El skill y la extensión de Pi pueden anunciar el final a la vez.
        if (s.status === 'done' && ev.ts - (s.doneAt || 0) < 15_000) return null;
        s.doneAt = ev.ts;
        s.turn = s.phase = null;
        return { ...ev, role: 'manager', text: clip(r.text || '¡Tarea terminada!') };
      case 'session_start': return { ...ev, role: 'manager', text: 'Nueva sesión de trabajo' };
      case 'session_end': return { ...ev, role: 'manager', text: 'Sesión cerrada' };
      case 'chat': return { ...ev, role, from: clip(r.from || 'Tú', 30), text: clip(r.text, 200) };
      case 'stage_end': return role ? { ...ev, role, ok: r.ok !== false, text: clip(r.text, 160) } : null;
      // El agente dice qué subagente es qué rol (al arrancar un pipeline): no se dibuja, se aprende.
      case 'agent_roles':
        if (r.roles && typeof r.roles === 'object') this.setAgentRoles(s.id, Object.fromEntries(Object.entries(r.roles).filter(([, v]) => ROLE_IDS.includes(v)).slice(0, 40)));
        return null;
      case 'dispatch': return { ...ev, role: 'po', from: clip(r.from || 'Tú', 30), agent: clip(r.agent, 30), mode: r.mode === 'launch' ? 'launch' : 'session', text: clip(r.text, 200) };
      case 'poke': return role ? { ...ev, role, from: clip(r.from || 'Tú', 30), text: '👋' } : null;
      default: return null;
    }
  }

  // Un subagente puede anunciarse dos veces (PreToolUse(Task) y SubagentStart):
  // se emparejan para no duplicar el personaje trabajando.
  #startSub(s, ev, { desc, agentType, agentId, toolUseId, fromHook, role }) {
    const now = Date.now();
    const twin = s.subagents.find((x) => x.open && now - x.startedAt < PAIR_WINDOW_MS &&
      (fromHook ? !x.agentId && x.toolUseId : !x.toolUseId && x.agentId) &&
      (!agentType || !x.agentType || x.agentType.toLowerCase() === String(agentType).toLowerCase()));
    if (twin) {
      if (fromHook) twin.agentId = agentId; else twin.toolUseId = toolUseId;
      if (!twin.desc && desc) twin.desc = clip(desc, 120);
      return null;
    }
    const sub = {
      id: String(agentId || toolUseId || `sub-${ev.id}`), agentId, toolUseId, agentType: agentType || '',
      desc: clip(desc || agentType || 'Subtarea', 120), startedAt: now, open: true,
      role: role || s.agentRoles?.[String(agentType || '').toLowerCase()] || roleForText(desc, agentType),
    };
    s.subagents.push(sub);
    if (s.subagents.length > 40) s.subagents.splice(0, s.subagents.length - 40);
    return { ...ev, kind: 'subagent_start', role: sub.role, subId: sub.id, agentType: sub.agentType, text: sub.desc };
  }

  #endSub(s, ev, { agentId, toolUseId, desc, fromHook }) {
    let sub = s.subagents.find((x) => (agentId && x.agentId === agentId) || (toolUseId && x.toolUseId === toolUseId));
    if (sub && !sub.open) return null; // ya lo cerró el otro evento del par
    const open = s.subagents.filter((x) => x.open);
    if (!sub && !fromHook) sub = open.find((x) => desc && x.desc === clip(desc, 120)) || open[0];
    if (!sub) return null;
    sub.open = false;
    sub.endedAt = Date.now();
    return { ...ev, kind: 'subagent_end', role: sub.role, subId: sub.id, agentType: sub.agentType, text: sub.desc };
  }

  #apply(ev) {
    const s = this.sessions.get(ev.session);
    s.lastAt = ev.ts;
    if (ev.kind === 'tool_start') s.tools++;
    // En RED (TDD) que el test falle es lo esperado: no cuenta como error.
    if ((ev.kind === 'tool_end' && !ev.ok && ev.phase !== 'red') || ev.kind === 'error') s.errors++;
    if (!['chat', 'poke', 'dispatch'].includes(ev.kind)) s.status = SESSION_STATUS[ev.kind] || 'active';

    if (ev.role && this.roles[ev.role]) {
      const r = this.roles[ev.role];
      r.status = ev.phase === 'red' ? 'red' : ev.kind === 'tool_end' && !ev.ok ? 'blocked' : ev.kind === 'waiting' ? 'waiting' : ev.kind === 'done' ? 'done' : 'working';
      r.text = ev.text;
      r.ts = ev.ts;
      r.actions++;
    }
    this.log.push(ev);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }

  /** Nombre de subagente → rol, para que cada subagente de esa sesión caiga en su personaje. */
  setAgentRoles(sessionId, map = {}) {
    const s = this.#session(sessionId, 'generic');
    s.agentRoles = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  }

  sessionSummary(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { ...s, subagents: s.subagents.filter((x) => x.open || Date.now() - (x.endedAt || 0) < 60_000) };
  }

  snapshot() {
    return {
      sessions: [...this.sessions.keys()].map((id) => this.sessionSummary(id)),
      roles: this.roles,
      log: this.log.slice(-150),
    };
  }
}
