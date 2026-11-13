import { EventEmitter } from 'node:events';
import { adapt } from './adapters.js';
import { ALL_ROLE_IDS, roleForTool, roleForText, describe, clip, normRole, agentRole, normPhase, filePathOf } from './roles.js';
import { t } from '../public/i18n.js';
import { realDir, insideDir } from './paths.js';
import { unguided } from './guides.js';
import { badgeFor, myToolOf } from './humanize.js';

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
// the agent's tool to ask you something (Claude Code's AskUserQuestion, Pi's and OpenCode's question)
const ASK_TOOL = /^(askuserquestion|question|ask_user_choice|ask_user_question|ask_user)$/i;
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
const ANNOUNCEMENTS = new Set(['dispatch', 'clarify', 'standup', 'pane_open', 'pane_close', 'pane_state', 'service_up', 'service_down', 'autocompact']);
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
    this.roles = Object.fromEntries(ALL_ROLE_IDS.map((id) => [id, { id, status: 'idle', text: '', ts: 0, actions: 0 }]));
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
      // what arrived, as it arrived (the services left running in the background are seen here)
      this.emit('raw', { ...raw, source: raw.source || source }, ev);
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
    // how full the agent's context is (any event can bring it; `context` events bring only that)
    const ctx = r.context;
    if (ctx && Number(ctx.max) > 0 && Number(ctx.used) >= 0 && !r.child) s.context = { used: Math.round(Number(ctx.used)), max: Math.round(Number(ctx.max)), at: ev.ts };
    if (r.kind === 'context') return s.context ? { ...ev, role: 'manager', text: '' } : null;

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
      // If the agent declared who is on duty, that role does the work; otherwise it is inferred from the tool
      // (and, for code no rule claims, from the kind of artifact it is in: server/systems.js)
      const kind = this.kindFor?.(s.cwd || r.cwd, filePathOf(input)) || null;
      if (sub) {
        ev.role = agentRole(r.role) || sub.role || roleForTool(tool, input, kind);
        if (sub.phase && ev.role === sub.role) ev.phase = sub.phase;
      } else {
        const mine = myToolOf(tool, input); // one of your own tools: the character you chose for it
        ev.role = agentRole(r.role) || (mine && normRole(this.myToolRole?.(mine))) || s.turn || roleForTool(tool, input, kind);
        if (s.turn && ev.role === s.turn) ev.phase = s.phase;
      }
      ev.text = clip(r.text && start ? r.text : describe(tool, input), 90);
      // what they are doing, as small as it gets, over their head (✏️ cart.js, 🧪 tests)
      if (start) { const b = badgeFor(tool, input); if (b) ev.badge = clip(b, 24); }
      // the command line itself, apart from the words: for whoever wants to see it (never in a bubble)
      if (COMMAND_TOOLS.has(tl) && (input.command || input.cmd)) ev.command = clip(String(input.command || input.cmd), 300);
      if (!start && !ev.ok) ev.text = clip(t('events.failed', { text: ev.text, detail: r.text ? ` — ${r.text}` : '' }), 120);
      if (!start && sub && r.output && (COMMAND_TOOLS.has(tl) || !ev.ok)) ev.output = excerpt(r.output);
      return ev;
    }

    // the role the agent declares (never the PO: that is the user); chat and poke name the character you picked
    const role = agentRole(r.role) || (sub && ['thinking', 'waiting', 'error'].includes(r.kind) ? sub.role : null);
    switch (r.kind) {
      case 'phase': {
        if (!role) return null;
        const phase = normPhase(r.phase) || 'trabaja';
        // a subagent's phase is its own: it does not take the turn away from the session
        if (sub) {
          if (role === sub.role) sub.phase = phase;
          return { ...ev, role, phase, from: null, text: clip(r.text, 120) };
        }
        const prev = agentRole(r.from) || s.turn;
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
        // the scope line the office puts before a brief (tasks.js) is not part of the request
        if (typeof r.text === 'string') r.text = unguided(r.text); // the 📁 scope and the 📋 instructions are the office's
        // a directive's part (directives.js): its header becomes a 🏛 before the request
        if (typeof r.text === 'string' && r.text.startsWith('🏛 ')) r.text = r.text.replace(/^🏛 [^\n]*\n+/, '🏛 ');
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
      case 'thinking': return { ...ev, role: role || s.turn || 'tl', text: clip(r.text || t('events.thinking')), badge: t('badge.think') };
      case 'waiting': return { ...ev, role: (sub && role) || 'manager', text: clip(r.text || t('events.waiting'), 140) };
      case 'error': return { ...ev, ok: false, role: role || 'tl', text: clip(r.text || t('events.error'), 140) };
      // the office asked the agent to compact (server/compact.js): how, and why
      // (failed: the agent could not; it says why, and it is asked again later)
      case 'autocompact': {
        const via = ['agent', 'pane', 'manual', 'failed'].includes(r.via) ? r.via : 'agent';
        return { ...ev, role: 'manager', via, text: via === 'failed' ? t('events.autocompact.failed', { reason: clip(r.text, 140) }) : clip(r.text, 200) };
      }
      case 'compact':
        // until its next answer the agent does not know how full it is: the bar says it is compacting
        if (s.context) s.context = { ...s.context, compacted: ev.ts };
        return { ...ev, role: 'manager', text: t('events.compact') };
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
      case 'chat': return { ...ev, role: normRole(r.role), from: clip(r.from || t('events.you'), 30), text: clip(r.text, 200) };
      // A side question (btw) to the agent on duty: the question, and its answer (or why there was none).
      case 'btw': {
        const phase = ['ask', 'answer', 'failed'].includes(r.phase) ? r.phase : 'ask';
        return { ...ev, role: role || 'tl', phase, askId: clip(r.askId, 40), agent: clip(r.agent, 30), from: clip(r.from || t('events.you'), 30), text: clip(r.text, phase === 'answer' ? 4000 : 300), ...(r.subId ? { subId: clip(String(r.subId), 60) } : {}) };
      }
      case 'stage_end': return role ? { ...ev, role, ok: r.ok !== false, text: clip(r.text, 160) } : null;
      // The agent says which subagent is which role (when starting a pipeline): it is not drawn, it is learned.
      case 'agent_roles':
        if (r.roles && typeof r.roles === 'object') this.setAgentRoles(s.id, Object.fromEntries(Object.entries(r.roles).map(([k, v]) => [k, agentRole(v)]).filter(([, v]) => v).slice(0, 40)));
        return null;
      // The analyst reviews a brief before it goes to work (server/clarify.js): reviewing it, her
      // questions for you, and when it is handed over.
      // The daily standup (server/standup.js): what each character tells at the table.
      case 'standup': {
        const lines = (Array.isArray(r.lines) ? r.lines : []).map((l) => ({ role: normRole(l?.role), text: clip(l?.text, 300) })).filter((l) => l.role && l.text).slice(0, 10);
        const list = (v) => (Array.isArray(v) ? v.map((x) => clip(x, 120)).filter(Boolean).slice(0, 5) : []);
        return { ...ev, role: 'manager', lines, waiting: list(r.waiting), open: list(r.open), text: clip(r.text, 120) };
      }
      case 'clarify': {
        const phase = ['review', 'ask', 'sent', 'failed', 'cancelled'].includes(r.phase) ? r.phase : 'review';
        return { ...ev, role: 'analyst', phase, clarifyId: clip(r.clarifyId, 40), n: Number(r.n) || 0, project: clip(r.project, 60), text: clip(r.text, 600) };
      }
      case 'dispatch': return { ...ev, role: 'po', from: clip(r.from || t('events.you'), 30), agent: clip(r.agent, 30), mode: r.mode === 'launch' ? 'launch' : 'session', text: clip(r.text, 200) };
      case 'poke': return normRole(r.role) ? { ...ev, role: normRole(r.role), from: clip(r.from || t('events.you'), 30), text: '👋' } : null;
      // a service the agent left running in the background starts or ends (server/services.js)
      case 'service_up':
      case 'service_down':
        return { ...ev, role: role || 'backend', ok: r.ok !== false, service: clip(r.service, 20), text: clip(t(r.kind === 'service_up' ? 'events.serviceUp' : 'events.serviceDown', { name: r.text || '' }), 120) };
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
    return { ...ev, kind: 'subagent_start', role: sub.role, subId: sub.id, agentType: sub.agentType, text: sub.desc, badge: clip(`👥 ${clip(sub.agentType || sub.desc, 12)}`, 24), ...(sub.phase ? { phase: sub.phase } : {}), ...(task ? { task: excerpt(task, { max: 600, lines: 8, head: true }) } : {}) };
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
    if (ev.kind === 'context') return; // it only updates the session's context bar: nobody works, nothing is logged
    s.lastAt = ev.ts;
    if (ev.kind === 'tool_start') s.tools++;
    // In RED (TDD) a failing test is expected: it does not count as an error.
    if ((ev.kind === 'tool_end' && !ev.ok && ev.phase !== 'red') || ev.kind === 'error') s.errors++;
    // an agent that asks you something with its question tool is waiting for you too
    const asksYou = ev.kind === 'tool_start' && ASK_TOOL.test(ev.tool || '');
    if (!['chat', 'poke', 'dispatch', 'btw', 'clarify', 'standup', 'autocompact'].includes(ev.kind)) s.status = asksYou ? 'waiting' : SESSION_STATUS[ev.kind] || 'active';
    // what it is waiting for, and since when: the screen's "they are waiting for you" signal
    if (s.status === 'waiting') s.waiting = { text: ev.text || s.waiting?.text || '', since: s.waiting?.since || ev.ts, question: asksYou || !!s.waiting?.question, role: ev.role || null };
    else delete s.waiting;

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
