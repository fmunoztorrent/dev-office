import { EventEmitter } from 'node:events';
import { adapt } from './adapters.js';
import { ROLE_IDS, roleForTool, roleForText, describe, clip, normRole, normPhase } from './roles.js';
import { t } from '../public/i18n.js';
import { realDir, insideDir } from './paths.js';

const LOG_MAX = 300;
const SESSIONS_MAX = 30;
const PAIR_WINDOW_MS = 15_000;
const FLOW_MAX = 40;
// Calls to the skill's script are not the team's work, only notices to the office.
const OFFICE_CLI = /office-event(\.mjs)?\b/;

const TODO_STATUS = new Set(['pending', 'in_progress', 'completed']);
function normTodos(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && t.status !== 'dropped').slice(0, 50).map((t, i) => ({
    id: String(t.id ?? i + 1),
    content: clip(t.content ?? t.subject ?? t.title ?? t.text ?? '', 120),
    status: TODO_STATUS.has(t.status) ? t.status : t.status === 'done' ? 'completed' : 'pending',
  }));
}

const SESSION_STATUS = { waiting: 'waiting', done: 'done', session_end: 'ended' };
// What a subagent with its own process tells about its own session (not the team's).
const CHILD_OWN = new Set(['session_start', 'session_end', 'turn_end', 'done', 'compact', 'todos', 'agent_roles', 'phase_end', 'stage_end']);
// The TDD phase the parent put in a QA subagent's label ("RED tests for total()",
// "write failing tests", "confirmar en verde").
const tddPhase = (text) => (/\b(red|rojo|failing)\b|que fallen|que falle\b/i.test(text) ? 'red' : /\b(green|verde)\b/i.test(text) ? 'green' : null);
const words = (text) => String(text || '').replace(/\s+/g, ' ').trim();
// What a tool (or a subagent) returned, with its line breaks: the subagent's pane shows it.
// For a command the end matters (the test summary); for a subagent, the beginning.
function excerpt(text, { max = 1200, lines = 14, head = false } = {}) {
  const all = String(text ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
  while (all.length && !all[0].trim()) all.shift();
  while (all.length && !all.at(-1).trim()) all.pop();
  const kept = (head ? all.slice(0, lines) : all.slice(-lines)).join('\n');
  if (!kept) return undefined;
  return kept.length > max ? (head ? `${kept.slice(0, max - 1)}…` : `…${kept.slice(-(max - 1))}`) : kept;
}
/** Announcements: they are logged but do not change any role's state. */
const ANNOUNCEMENTS = new Set(['dispatch', 'pane_open', 'pane_close', 'pane_state']);
/** What state a character ends up in after one of its events (shared by the office and the monitor);
 *  `null` for announcements, which do not change the state (nor set it to idle). */
export const roleStatus = (ev) => (ANNOUNCEMENTS.has(ev.kind) ? null : ev.phase === 'red' ? 'red' : ev.kind === 'tool_end' && !ev.ok ? 'blocked' : ev.kind === 'waiting' ? 'waiting' : ev.kind === 'done' ? 'done' : ev.kind === 'turn_end' || ev.kind === 'session_end' ? 'idle' : 'working');
const SUB_TOOLS = new Set(['task', 'agent', 'subagent', 'subagent_run', 'subagent_continue']);
const COMMAND_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'local_shell', 'unified_exec', 'bash_background']);

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

  /** Receives a payload from any agent and returns the normalized events emitted. */
  ingest(source = 'generic', payload = {}) {
    const out = [];
    for (let raw of adapt(source, payload)) {
      // No session but a folder (the skill or the MCP of an agent that does not know its id): it is
      // that folder's most recent session, so its phase and the hook's tools go together.
      if (!raw.session && raw.cwd) raw = { ...raw, session: this.sessionFor(raw.cwd) || undefined };
      const ev = this.#enrich({ ...raw, source: clip(raw.source || source, 30) });
      if (!ev) continue;
      this.#apply(ev);
      out.push(ev);
      this.emit('event', ev, this.sessionSummary(ev.session));
    }
    return out;
  }

  /** The session that worked most recently in that folder (in the last 12 hours). */
  sessionFor(cwd) {
    const dir = realDir(clip(cwd, 200));
    let best = null;
    for (const s of this.sessions.values()) {
      if (s.id === 'office' || !s.cwd || Date.now() - s.lastAt > 12 * 3600_000 || realDir(s.cwd) !== dir) continue;
      if (!best || s.lastAt > best.lastAt) best = s;
    }
    return best?.id || null;
  }

  #session(id, source, cwd) {
    const key = clip(id || `${source}-default`, 100);
    let s = this.sessions.get(key);
    if (!s) {
      s = { id: key, source, cwd: clip(cwd || '', 200), title: '', status: 'active', todos: [], subagents: [],
        tools: 0, errors: 0, startedAt: Date.now(), lastAt: Date.now(),
        // Role "on duty" declared by the agent with `phase` events (and the phase it is in).
        turn: null, phase: null, flow: [] };
      this.sessions.set(key, s);
      if (this.sessions.size > SESSIONS_MAX) {
        const oldest = [...this.sessions.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
        this.sessions.delete(oldest.id);
      }
    }
    if (cwd && !s.cwd) s.cwd = clip(cwd, 200);
    // what the session's folder brings: which subagent is which character (until the agent says so)
    if (s.cwd && !s.agentRoles && !s.rolesTried) {
      s.rolesTried = true;
      const roles = this.rolesFor?.(s.cwd);
      if (roles && Object.keys(roles).length) s.agentRoles = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k.toLowerCase(), v]));
    }
    return s;
  }

  #enrich(r) {
    const s = this.#session(r.session, r.source, r.cwd);
    const tool = typeof r.tool === 'string' ? r.tool : '';
    const tl = tool.toLowerCase();
    const input = r.input && typeof r.input === 'object' ? r.input : {};
    const ev = { id: ++this.seq, ts: Date.now(), source: r.source, session: s.id, kind: r.kind, tool, ok: r.ok !== false };

    // A subagent that is its own process (Pi's) reports to the parent's session with `child`:
    // its work is done by the subagent's character, and its start, its task and its turn ends
    // are its own, not the team's (they do not change the title or release the session's turn).
    let sub = null;
    if (r.child) {
      if (CHILD_OWN.has(r.kind)) return null;
      sub = this.#childSub(s, clip(String(r.child), 40), r);
      if (r.kind === 'task') return null;
    } else if (r.agentId && ['tool_start', 'tool_end', 'thinking', 'waiting', 'error'].includes(r.kind)) {
      // a subagent running inside the agent's process (Claude Code): its tools carry its id
      sub = s.subagents.find((x) => x.agentId === String(r.agentId)) || null;
    }
    // everything a subagent does carries its id: so its herdr pane shows only its own activity
    if (sub) ev.subId = sub.id;

    if (r.kind === 'tool_start' || r.kind === 'tool_end') {
      const start = r.kind === 'tool_start';
      if (SUB_TOOLS.has(tl)) {
        // `subagent` is the tool of Pi's subagents extension: { agent, task } | { tasks } | { chain };
        // `subagent_run` is gentle-pi's: { agent, task, label }
        const many = input.tasks || input.chain;
        const agentType = input.subagent_type || input.agent || (Array.isArray(many) ? many[0]?.agent : undefined);
        const desc = input.description || input.label || (Array.isArray(many) ? many.map((x) => x.agent).join(' → ') : input.task || input.prompt);
        const task = typeof (input.task ?? input.prompt) === 'string' ? input.task ?? input.prompt : '';
        return start
          ? this.#startSub(s, ev, { desc, agentType, toolUseId: r.toolUseId, task })
          : this.#endSub(s, ev, { toolUseId: r.toolUseId, desc: input.description, output: r.output });
      }
      // gentle-pi's `todo` list: `write` brings the whole list (the extension reports the rest)
      if (tl === 'todo') {
        if (!start || input.action !== 'write' || !Array.isArray(input.tasks) || sub) return null;
        s.todos = normTodos(input.tasks);
        return { ...ev, kind: 'todos', role: 'manager', text: t('events.updateBoard') };
      }
      if (tl === 'todowrite') {
        if (!start) return null;
        s.todos = normTodos(input.todos);
        return { ...ev, kind: 'todos', role: 'manager', text: t('events.updateBoard') };
      }
      if (tl === 'taskcreate') {
        if (!start) return null;
        s.todos.push({ id: String(s.todos.length + 1), content: clip(input.subject || input.description, 120), status: 'pending' });
        return { ...ev, kind: 'todos', role: 'manager', text: clip(t('events.newCard', { text: input.subject || '' })) };
      }
      if (tl === 'taskupdate') {
        if (!start) return null;
        const todo = s.todos.find((x) => x.id === String(input.taskId));
        if (todo) {
          if (TODO_STATUS.has(input.status)) todo.status = input.status;
          if (input.subject) todo.content = clip(input.subject, 120);
        }
        return { ...ev, kind: 'todos', role: 'manager', text: t('events.moveCard') };
      }
      if (OFFICE_CLI.test(String(input.command || ''))) return null;
      // If the agent declared who is on duty, that role does the work; otherwise it is inferred from the tool.
      if (sub) {
        ev.role = normRole(r.role) || sub.role || roleForTool(tool, input);
        if (sub.phase && ev.role === sub.role) ev.phase = sub.phase;
      } else {
        ev.role = normRole(r.role) || s.turn || roleForTool(tool, input);
        if (s.turn && ev.role === s.turn) ev.phase = s.phase;
      }
      ev.text = clip(r.text && start ? r.text : describe(tool, input), 90);
      if (!start && !ev.ok) ev.text = clip(t('events.failed', { text: ev.text, detail: r.text ? ` — ${r.text}` : '' }), 120);
      if (!start && sub && r.output && (COMMAND_TOOLS.has(tl) || !ev.ok)) ev.output = excerpt(r.output);
      return ev;
    }

    const role = normRole(r.role) || (sub && ['thinking', 'waiting', 'error'].includes(r.kind) ? sub.role : null);
    switch (r.kind) {
      case 'phase': {
        if (!role) return null;
        const phase = normPhase(r.phase) || 'trabaja';
        // a subagent's phase is its own: it does not take the turn away from the session
        if (sub) {
          if (role === sub.role) sub.phase = phase;
          return { ...ev, role, phase, from: null, text: clip(r.text, 120) };
        }
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
        // Pi's extension and skill may announce the same task: the duplicate is dropped.
        if (s.title === clip(r.text, 300) && ev.ts - (s.taskAt || 0) < 30_000) return null;
        s.title = clip(r.text, 300);
        s.taskAt = ev.ts;
        s.turn = s.phase = null;
        s.flow = [];
        s.todos = s.status === 'done' ? [] : s.todos;
        return { ...ev, role: role || 'po', text: clip(r.text, 200) };
      case 'todos':
        s.todos = normTodos(r.todos);
        return { ...ev, role: 'manager', text: t('events.updateBoard') };
      case 'thinking': return { ...ev, role: role || s.turn || 'tl', text: clip(r.text || t('events.thinking')) };
      case 'waiting': return { ...ev, role: (sub && role) || 'manager', text: clip(r.text || t('events.waiting'), 140) };
      case 'error': return { ...ev, ok: false, role: role || 'tl', text: clip(r.text || t('events.error'), 140) };
      case 'compact': return { ...ev, role: 'manager', text: t('events.compact') };
      // Quiet end of turn: releases the declared turn without celebrating anything (that is `done`, the merge).
      case 'turn_end': {
        const was = s.turn;
        s.turn = s.phase = null;
        return { ...ev, role: role || was || 'manager', text: clip(r.text || t('events.turnEnd', { text: '' }), 140) };
      }
      case 'done':
        // Pi's skill and extension may announce the end at the same time.
        if (s.status === 'done' && ev.ts - (s.doneAt || 0) < 15_000) return null;
        s.doneAt = ev.ts;
        s.turn = s.phase = null;
        s.todos = s.todos.map((t) => ({ ...t, status: 'completed' }));
        return { ...ev, role: 'manager', text: clip(r.text || t('events.done')) };
      case 'session_start': return { ...ev, role: 'manager', text: t('events.sessionStart') };
      case 'session_end': return { ...ev, role: 'manager', text: t('events.sessionEnd') };
      case 'chat': return { ...ev, role, from: clip(r.from || t('events.you'), 30), text: clip(r.text, 200) };
      // A side question (btw) to the agent on duty: the question, and its answer (or why there was none).
      case 'btw': {
        const phase = ['ask', 'answer', 'failed'].includes(r.phase) ? r.phase : 'ask';
        return { ...ev, role: role || 'po', phase, askId: clip(r.askId, 40), agent: clip(r.agent, 30), from: clip(r.from || t('events.you'), 30), text: clip(r.text, phase === 'answer' ? 1500 : 300) };
      }
      case 'stage_end': return role ? { ...ev, role, ok: r.ok !== false, text: clip(r.text, 160) } : null;
      // The agent says which subagent is which role (when starting a pipeline): it is not drawn, it is learned.
      case 'agent_roles':
        if (r.roles && typeof r.roles === 'object') this.setAgentRoles(s.id, Object.fromEntries(Object.entries(r.roles).filter(([, v]) => ROLE_IDS.includes(v)).slice(0, 40)));
        return null;
      case 'dispatch': return { ...ev, role: 'po', from: clip(r.from || t('events.you'), 30), agent: clip(r.agent, 30), mode: r.mode === 'launch' ? 'launch' : 'session', text: clip(r.text, 200) };
      case 'poke': return role ? { ...ev, role, from: clip(r.from || t('events.you'), 30), text: '👋' } : null;
      // herdr panes: the agent (or the office) opens a terminal for an activity, and someone on the
      // team takes care of it while it stays open.
      case 'pane_open':
      case 'pane_close':
      case 'pane_state':
        if (!r.pane) return null;
        return {
          ...ev, role: role || roleForText(r.text, r.agent) || 'tl', pane: clip(r.pane, 40), text: clip(r.text || r.pane, 120),
          ...(r.kind === 'pane_state' ? { state: ['working', 'blocked', 'idle', 'done'].includes(r.state) ? r.state : 'idle' } : {}),
          ...(r.agent ? { agent: clip(r.agent, 30) } : {}),
        };
      default: return null;
    }
  }

  // A subagent may announce itself twice (PreToolUse(Task) and SubagentStart):
  // they are paired so the working character is not duplicated.
  /**
   * The subagent that is the `child` process: the one already assigned or, on its first event, the
   * one that gave it that task (its first message is the `task` the parent passed it); if it is not
   * recognized, the oldest one still open without a process, or the last one that finished (background
   * ones finish their tool right away and keep working).
   */
  #childSub(s, child, r) {
    const mine = s.subagents.find((x) => x.child === child);
    if (mine) return mine;
    const now = Date.now();
    const free = s.subagents.filter((x) => !x.child && (x.open || now - (x.endedAt || 0) < 60_000));
    if (!free.length) return null;
    const text = r.kind === 'task' ? words(r.text) : '';
    const said = (x) => { const task = words(x.task).slice(0, 160); return task && text && (text.includes(task) || task.includes(text.slice(0, 160))); };
    const sub = (text && free.find(said)) || free.find((x) => x.open) || free.at(-1);
    sub.child = child;
    return sub;
  }

  #startSub(s, ev, { desc, agentType, agentId, toolUseId, fromHook, role, task }) {
    const now = Date.now();
    const twin = s.subagents.find((x) => x.open && now - x.startedAt < PAIR_WINDOW_MS &&
      (fromHook ? !x.agentId && x.toolUseId : !x.toolUseId && x.agentId) &&
      (!agentType || !x.agentType || x.agentType.toLowerCase() === String(agentType).toLowerCase()));
    if (twin) {
      if (fromHook) twin.agentId = agentId; else twin.toolUseId = toolUseId;
      if (!twin.desc && desc) twin.desc = clip(desc, 120);
      if (!twin.task && task) twin.task = String(task).slice(0, 2000);
      return null;
    }
    const sub = {
      id: String(agentId || toolUseId || `sub-${ev.id}`), agentId, toolUseId, agentType: agentType || '',
      desc: clip(desc || agentType || t('events.subtask'), 120), startedAt: now, open: true,
      role: role || s.agentRoles?.[String(agentType || '').toLowerCase()] || roleForText(desc, agentType),
      task: task ? String(task).slice(0, 2000) : '', child: null, phase: null,
    };
    if (sub.role === 'qa') sub.phase = tddPhase(desc);
    s.subagents.push(sub);
    if (s.subagents.length > 40) s.subagents.splice(0, s.subagents.length - 40);
    return { ...ev, kind: 'subagent_start', role: sub.role, subId: sub.id, agentType: sub.agentType, text: sub.desc, ...(sub.phase ? { phase: sub.phase } : {}), ...(task ? { task: excerpt(task, { max: 600, lines: 8, head: true }) } : {}) };
  }

  #endSub(s, ev, { agentId, toolUseId, desc, fromHook, output }) {
    let sub = s.subagents.find((x) => (agentId && x.agentId === agentId) || (toolUseId && x.toolUseId === toolUseId));
    if (sub && !sub.open) return null; // the other event of the pair already closed it
    const open = s.subagents.filter((x) => x.open);
    if (!sub && !fromHook) sub = open.find((x) => desc && x.desc === clip(desc, 120)) || open[0];
    if (!sub) return null;
    sub.open = false;
    sub.endedAt = Date.now();
    const said = excerpt(output, { max: 1500, lines: 30, head: true });
    return { ...ev, kind: 'subagent_end', role: sub.role, subId: sub.id, agentType: sub.agentType, text: sub.desc, ...(said ? { output: said } : {}) };
  }

  #apply(ev) {
    const s = this.sessions.get(ev.session);
    s.lastAt = ev.ts;
    if (ev.kind === 'tool_start') s.tools++;
    // In RED (TDD) a failing test is expected: it does not count as an error.
    if ((ev.kind === 'tool_end' && !ev.ok && ev.phase !== 'red') || ev.kind === 'error') s.errors++;
    if (!['chat', 'poke', 'dispatch', 'btw'].includes(ev.kind)) s.status = SESSION_STATUS[ev.kind] || 'active';

    // a side question does not change what each role is doing; announcements (dispatch, panes)
    // do not either: roleStatus returns null and they stay only in the log.
    if (ev.role && this.roles[ev.role] && ev.kind !== 'btw') {
      const status = roleStatus(ev);
      if (status) {
        const r = this.roles[ev.role];
        r.status = status;
        r.text = ev.text;
        r.ts = ev.ts;
        r.session = ev.session;
        r.actions++;
      }
    }
    // the session closed: whoever was working in it is freed (what belongs to other sessions stays as is)
    if (ev.kind === 'session_end') {
      for (const r of Object.values(this.roles)) if (r.session === ev.session && r.status !== 'done') r.status = 'idle';
    }
    this.log.push(ev);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }

  /**
   * What a folder brings now (the team `join` installed for it): the sessions open there add it
   * to what they already knew, without overwriting what their agent said.
   */
  learnRoles(dir, map = {}) {
    const roles = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    for (const s of this.sessions.values()) if (s.cwd && insideDir(s.cwd, dir)) s.agentRoles = { ...roles, ...(s.agentRoles || {}) };
  }

  /** Subagent name → role, so each subagent of that session lands on its character. */
  setAgentRoles(sessionId, map = {}) {
    const s = this.#session(sessionId, 'generic');
    s.agentRoles = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  }

  sessionSummary(id) {
    const found = this.sessions.get(id);
    if (!found) return null;
    const { rolesTried, ...s } = found;
    // each subagent's full task only serves to recognize its process: it is not sent to the viewers
    return { ...s, subagents: s.subagents.filter((x) => x.open || Date.now() - (x.endedAt || 0) < 60_000).map(({ task, ...x }) => x) };
  }

  snapshot() {
    return {
      sessions: [...this.sessions.keys()].map((id) => this.sessionSummary(id)),
      roles: this.roles,
      log: this.log.slice(-150),
    };
  }
}
