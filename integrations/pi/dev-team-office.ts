// Pi (pi-coding-agent) extension → Dev Team Office. Pi is the BACKEND: everything runs here;
// the office only sends requests and draws what happens.
//
// Installation: `dev-team-office install pi` (copies this extension to ~/.pi/agent/extensions/ and the
// shared library to ~/.dev-team-office/lib/devteam.mjs).
//
// - Pi launches the office: when an interactive session opens, if the office is not running it starts
//   it in the background, registers the project (its git root) and says where to watch it. `/office`
//   does the same on demand (`/office open` opens the browser). DEV_TEAM_OFFICE_AUTOSTART=0 leaves it to `/office` only.
// - Reports prompts, tools and the agent's end to the office; its subagents (other `pi`s) too.
// - Registers over WebSocket and announces its project's pipelines (.devteam/).
// - task:     the task arrives as a user message (a follow-up if Pi is busy). If it is a
//             command (`/architect …`, a prompt of your harness), Pi expands it as if you
//             had typed it.
// - pipeline: runs a .devteam/ pipeline INSIDE this session, stage by stage: switches model
//             with setModel, sends the stage's prompt, waits for Pi to finish (agent_settled),
//             runs the gate and goes on. Loops and gates are decided by devteam.mjs.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';
const STAGE_MARK = '[Dev Team Office · etapa'; // stage prompts start like this (they are not new tasks)

async function loadLib(): Promise<any> {
  const candidates = [process.env.DEV_TEAM_OFFICE_LIB, path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs')];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// The office (team) this session belongs to, if the office opened it, and its herdr pane.
const WHERE: Record<string, string> = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { pane: process.env.HERDR_PANE_ID } : {}),
};

// In order: the events tell a story (phase → tools → end).
let chain: Promise<unknown> = Promise.resolve();
function send(event: Record<string, unknown>) {
  chain = chain.then(() => fetch(`${URL_BASE}/v1/events/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...WHERE, ...event }),
    signal: AbortSignal.timeout(1500),
  })).catch(() => {}); // the office is optional: it never breaks Pi
}

// ---- starting the office from Pi ----

async function api(method: string, p: string, body?: unknown): Promise<any> {
  try {
    const r = await fetch(URL_BASE + p, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2000),
    });
    return await r.json();
  } catch { return null; }
}
const officeUp = async () => (await api('GET', '/v1/health'))?.name === 'dev-team-office';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The stable launcher that `dev-team-office setup` leaves (or the command, if it is on the PATH).
function launcher(): string | null {
  const shim = path.join(os.homedir(), '.dev-team-office', 'bin', 'dev-team-office');
  if (fs.existsSync(shim)) return shim;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const f = dir && path.join(dir, 'dev-team-office');
    if (f && fs.existsSync(f)) return f;
  }
  return null;
}

/** Starts it in the background (`dev-team-office serve`, without opening any agent) and waits for it to answer. */
async function startOffice(): Promise<boolean> {
  let url: URL;
  try { url = new URL(URL_BASE); } catch { return false; }
  // an office on another machine is not started from here
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
  const bin = launcher();
  if (!bin) return false;
  const log = path.join(os.homedir(), '.dev-team-office', 'office.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  // the office is not part of this session: it does not inherit its id or the owner mark
  const env: Record<string, string | undefined> = { ...process.env, DEV_TEAM_OFFICE_LAUNCHED: '1' };
  delete env.DEV_TEAM_OFFICE_SESSION;
  delete env.DEV_TEAM_OFFICE_PI_PID;
  try {
    // double fork: an intermediate `sh` leaves it running and exits, so it does not die with Pi's process tree
    const child = spawn('/bin/sh', ['-c', '"$0" "$@" &', bin, 'serve', '--port', url.port || '4317'], { detached: true, stdio: ['ignore', fd, fd], env });
    child.on('error', () => {});
    child.unref();
  } finally { fs.closeSync(fd); }
  for (let i = 0; i < 60; i++) { if (await officeUp()) return true; await sleep(250); }
  return false;
}

// The project folder: the git root (or the folder, if it has .pi or .devteam). Never home or the root.
function projectRoot(dir: string): string | null {
  const home = path.resolve(os.homedir());
  for (let cur = path.resolve(dir); ; ) {
    if (cur === home || cur === path.dirname(cur)) break;
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    cur = path.dirname(cur);
  }
  const here = path.resolve(dir);
  return here !== home && ['.pi', '.devteam'].some((d) => fs.existsSync(path.join(here, d))) ? here : null;
}
const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const within = (dir: string, root: string) => { const d = real(dir), r = real(root); return d === r || d.startsWith(r + path.sep); };

/** The Pi agent registered for this folder; if there is none, it registers it (in the project's office, if it already has one). */
async function ensureProject(cwd: string, office?: string): Promise<{ agent: any; created: boolean } | null> {
  const list = await api('GET', '/v1/agents');
  const registered = (list?.agents || []).filter((a: any) => a.registered && a.path && within(cwd, a.path));
  const mine = registered.find((a: any) => a.harness === 'pi');
  if (mine) return { agent: mine, created: false };
  const root = projectRoot(cwd);
  if (!root) return null;
  const out = await api('POST', '/v1/agents', { path: real(root), harness: 'pi', name: path.basename(root), ...((office || registered[0]?.office) ? { office: office || registered[0].office } : {}) });
  return out?.agent ? { agent: out.agent, created: true } : null;
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* no browser */ }
}

// The `todo` list (gentle-pi) → the board: its full state comes in the result.
const TODO_STATUS: Record<string, string> = { pending: 'pending', in_progress: 'in_progress', blocked: 'pending', done: 'completed' };
function todosOf(details: any) {
  const tasks = details?.gentleTodo?.tasks;
  if (!Array.isArray(tasks)) return null;
  return tasks.filter((t: any) => t?.status !== 'dropped').map((t: any) => ({ id: t.id, content: String(t.title ?? ''), status: TODO_STATUS[t.status] || 'pending' }));
}

// What a tool returned, as text: it is sent for subagents (and what they do), because inside
// herdr each subagent has its pane and it shows there. For a report the beginning matters; for
// a command, the end (the test summary).
const SUB_TOOLS = new Set(['subagent', 'subagent_run', 'subagent_continue']);
function resultText(event: any, head = false) {
  const text = Array.isArray(event.content) ? event.content.map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : '')).join('\n').trim() : '';
  return head ? text.slice(0, 4000) : text.slice(-4000);
}

export default function (pi: ExtensionAPI) {
  // a side question (btw) launched by the office: it is not the team's work, it is not reported
  if (process.env.DEV_TEAM_OFFICE_BTW) return;
  // A subagent of this session: Pi's subagents (gentle-pi, pi-subagents…) are other `pi`s that
  // inherit the environment and load this same extension. They are recognized because the session
  // already has an owner (another process): they report to the parent's session marked with `child`,
  // and the office draws their work as the character of the subagent that launched them.
  const owner = process.env.DEV_TEAM_OFFICE_PI_PID;
  const nested = !!(owner && owner !== String(process.pid) && process.env.DEV_TEAM_OFFICE_SESSION);
  const session = (process.env.DEV_TEAM_OFFICE_SESSION ||= `pi-${process.pid}`);
  process.env.DEV_TEAM_OFFICE_PI_PID = String(process.pid);
  const cwd = process.cwd();
  const report = (e: Record<string, unknown>) => send({ session, cwd, ...(nested ? { child: String(process.pid) } : {}), ...e });
  let ctx: any = null;     // last context seen (isIdle, modelRegistry, model)
  let lib: any = null;
  let run: any = null;     // pipeline in progress in this session
  let waiting = false;     // waiting for the current stage to finish
  let lastText = '';       // Pi's last reply (the stage's summary)
  let originalModel: any = null;

  // The library loads before reporting anything: so the subagents' roles reach the office before
  // the first subagent, also in a `pi -p` (no terminal, no WebSocket).
  const libReady = loadLib().then((l) => { lib = l; }).catch(() => {});
  // Only an interactive session connects (and starts the office): a `pi -p` ends by itself.
  const interactive = !nested && !!process.stdin.isTTY && !process.env.DEV_TEAM_OFFICE_LAUNCHED && typeof WebSocket !== 'undefined';
  const autostart = process.env.DEV_TEAM_OFFICE_AUTOSTART !== '0';
  pi.on('session_start', async (_e: any, c: any) => {
    ctx = c;
    await libReady;
    report({ kind: 'session_start' });
    if (nested) return;
    register();
    if (!interactive) return;
    // in the background: opening Pi does not wait for the office
    bringUp(autostart).then((r) => {
      if (r.started || r.project?.created) c.ui?.notify?.(officeLine(r), 'info');
    }).finally(connect);
  });

  /** The office up (if `start`, it starts it) and the project registered. */
  async function bringUp(start: boolean) {
    let up = await officeUp();
    let started = false;
    if (!up && start) up = started = await startOffice();
    const project = up && start ? await ensureProject(cwd, WHERE.office) : null;
    return { up, started, project };
  }
  function officeLine(r: { started: boolean; project: { agent: any; created: boolean } | null }, withTeam = false, given: any = null) {
    const p = r.project;
    const what = p ? ` · ${p.agent.name}${p.created ? ' registered' : ''} (office ${p.agent.office || 'main'})` : '';
    // with /office: which character plays each of the project's subagents (the office detects it in its folder)
    const roles = Object.entries(p?.agent?.roles || {});
    const added = (given?.agents || []).map((x: any) => `${x.name} (${x.role})`).join(', ');
    const gave = !given?.installed ? '' : given.whole
      ? `\nno subagents with a role here, so the office gave you its team (${given.team}): ${given.files?.length || 0} in .pi/agents, ready for the next subagent call`
      : `\nyour team had no ${(given.agents || []).map((x: any) => x.role).join(', ')}, so the office added ${added} to .pi/agents, ready for the next subagent call`;
    const team = withTeam ? `${gave}\n${roles.length ? `team: ${roles.slice(0, 12).map(([n, role]) => `${n} → ${role}`).join(' · ')}` : 'team: no subagents with a role in this project (add `role:` to .pi/agents/*.md)'}` : '';
    return `Dev Team Office${r.started ? ' started at' : ':'} ${URL_BASE}${what}${team}`;
  }
  // in Pi's footer, while connected: the notice goes away, the address stays in sight
  const showStatus = (on: boolean) => { try { ctx?.ui?.setStatus?.('dev-team-office', on ? `🏢 ${URL_BASE.replace(/^https?:\/\//, '')}` : undefined); } catch { /* no UI */ } };

  // /office: starts the office if needed, registers the project and says where to watch it
  if (!nested) pi.registerCommand?.('office', {
    description: 'Dev Team Office: start it if needed, register this project and show its URL (/office open: in the browser)',
    handler: async (args: string, c: any) => {
      const r = await bringUp(true);
      if (!r.up) {
        c.ui?.notify?.(launcher() ? `Dev Team Office did not start: see ~/.dev-team-office/office.log` : 'Dev Team Office is not installed: run `npx github:fmunoztorrent/dev-office setup`', 'warning');
        return;
      }
      // the roles its subagents do not cover are filled with the office team in .pi/agents (gentle-pi reads it on every call)
      const given = r.project ? await api('POST', `/v1/agents/${encodeURIComponent(r.project.agent.id)}/team`, {}) : null;
      if (given?.installed && r.project) { r.project.agent = given.agent || r.project.agent; reportAgentRoles(); }
      c.ui?.notify?.(officeLine(r, true, given), 'info');
      if (interactive && !ws) { clearTimeout(retry); connect(); }
      if (/^\s*open\b/.test(String(args || ''))) openBrowser(URL_BASE);
    },
  });
  pi.on('before_agent_start', async (event: any, c: any) => {
    ctx = c;
    // a stage prompt is not a new task: the pipeline already announced the phase
    if (event.messageType === 'user' && event.prompt && !String(event.prompt).startsWith(STAGE_MARK)) report({ kind: 'task', text: event.prompt });
  });
  pi.on('turn_start', async (_e: any, c: any) => { ctx = c; report({ kind: 'thinking' }); });
  pi.on('tool_call', async (event: any, c: any) => {
    ctx = c;
    if (event.toolName === 'todo') return; // the board is updated with its result
    report({ kind: 'tool_start', tool: event.toolName, toolUseId: event.toolCallId, input: event.input });
  });
  pi.on('tool_result', async (event: any) => {
    if (event.toolName === 'todo') {
      const todos = event.isError || event.input?.action === 'list' ? null : todosOf(event.details);
      if (todos) report({ kind: 'todos', todos });
      return;
    }
    const sub = SUB_TOOLS.has(event.toolName);
    const output = nested || sub ? resultText(event, sub) : '';
    report({ kind: 'tool_end', tool: event.toolName, toolUseId: event.toolCallId, input: event.input, ok: !event.isError, ...(output ? { output } : {}) });
  });
  pi.on('message_end', async (event: any) => {
    if (event.message?.role !== 'assistant' || !lib) return;
    const t = lib.textOf(event.message);
    if (t) lastText = t;
  });
  pi.on('session_compact', async () => report({ kind: 'compact' }));
  // with a pipeline in progress each stage ends a turn: the pipeline says "done" at the end
  pi.on('agent_end', async (_e: any, c: any) => { ctx = c; if (!run) report({ kind: 'turn_end' }); });
  pi.on('agent_settled', async (event: any, c: any) => {
    ctx = c;
    if (!run || !waiting) return;
    waiting = false;
    if (event.aborted) { run.cancel('cancelado en Pi'); return finish(); }
    await apply(await run.advance(lastText));
  });
  // Pi closes right away: pending notices are awaited (each one has its own 1.5 s cap)
  pi.on('session_shutdown', async () => { closed = true; clearTimeout(retry); ws?.close(); report({ kind: 'session_end' }); await chain; });

  // ---- pipelines inside the session ----

  async function useModel(spec: string, thinking?: string) {
    const reg = ctx?.modelRegistry;
    if (!reg) return false;
    const [provider, ...rest] = String(spec).split('/');
    let model = rest.length ? reg.find(provider, rest.join('/')) : undefined;
    if (!model) {
      const all = reg.getAvailable?.() || reg.getAll?.() || [];
      model = all.find((m: any) => m.id === spec || `${m.provider}/${m.id}` === spec) || all.find((m: any) => String(m.id).includes(spec));
    }
    if (!model) return false;
    originalModel ??= ctx.model || null;
    const ok = await pi.setModel(model);
    if (ok && thinking) pi.setThinkingLevel(thinking as any);
    return ok;
  }

  async function apply(step: any): Promise<void> {
    if (step.action !== 'prompt') return finish();
    if (step.stage.model) {
      if (!(await useModel(step.stage.model, step.stage.thinking))) return apply(run.fail(`Pi no tiene disponible el modelo ${step.stage.model}`));
    } else if (originalModel) {
      await pi.setModel(originalModel); // no model of its own: the session's
    }
    lastText = '';
    waiting = true;
    if (ctx?.isIdle?.() ?? true) pi.sendUserMessage(step.prompt);
    else pi.sendUserMessage(step.prompt, { deliverAs: 'followUp' });
  }

  function finish() {
    waiting = false;
    run = null;
    if (originalModel) pi.setModel(originalModel).catch(() => {}); // back to the model the session had
    originalModel = null;
  }

  async function startPipeline(msg: any) {
    const update = (status: any) => wsSend({ type: 'pipeline_update', id: msg.id, ...status });
    if (!lib) return update({ status: 'failed', detail: 'falta la librería devteam.mjs: corre `dev-team-office install pi`' });
    if (run) return update({ status: 'failed', detail: 'esta sesión de Pi ya está corriendo otro pipeline' });
    const project = lib.loadProject(cwd);
    const pipeline = project.pipelines.find((p: any) => p.id === msg.pipeline);
    if (!pipeline) return update({ status: 'failed', detail: `no hay un pipeline "${msg.pipeline}" en ${project.dir}/.devteam/` });
    run = new lib.PipelineRun({ id: msg.id, project, pipeline, task: msg.task, report, onStatus: update });
    await apply(run.start());
  }

  // ---- connection to the office ----
  // Only in interactive sessions: a `pi -p` (e.g. launched by the office) ends by itself.
  let ws: WebSocket | null = null;
  let closed = false;
  const wsSend = (m: unknown) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  // The harness declares which of its subagents is which character (frontmatter `role`): it tells the
  // office when registering, so a session that only delegates locally also lands on the right character.
  // It is separate from registration so the session is not mixed with the role report (and so it can be seen failing).
  function reportAgentRoles() {
    // without the library there is nothing to detect; `register`/`startPipeline` already warn (not repeated)
    if (!lib) return;
    let detected: any;
    try {
      // ONLY the reading can fail: the report cannot, it swallows its own errors
      detected = lib.detectHarness(cwd);
    } catch (err: any) {
      // the roles could not be READ: the office uses its text fallback; it warns and never breaks Pi
      console.warn(`[dev-team-office] no se pudieron leer los roles del harness: ${String(err?.message || err)}`);
      return;
    }
    // An empty map is LEGITIMATE DATA (the project has no agents with a role), not an error: it is reported
    // anyway, so the office can tell "I learned nothing" from "nobody told me". Do not turn it into a warning:
    // it would be noise in every session of a project without agents.
    report({ kind: 'agent_roles', roles: detected?.roles || {} });
    // A broken declaration is not hidden: the office cannot guess the character and the operator has to see it.
    for (const issue of detected?.roleIssues || []) console.warn(`[dev-team-office] ${issue}`);
  }

  function register() {
    const project = lib ? lib.catalogEntry(lib.loadProject(cwd)) : null;
    wsSend({ type: 'register', agent: 'pi', session, cwd, pid: process.pid, can: lib ? ['task', 'pipeline'] : ['task'], project, ...WHERE });
    reportAgentRoles();
  }
  let retry: any = null;
  function connect() {
    if (closed || ws || !interactive) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { register(); showStatus(true); };
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'task') {
        try {
          // `/command …`: expanded as if you had typed it (prompts and commands of your harness)
          const expandPromptTemplates = String(msg.text).startsWith('/');
          if (ctx?.isIdle?.() ?? true) pi.sendUserMessage(msg.text, { expandPromptTemplates });
          else pi.sendUserMessage(msg.text, { deliverAs: 'followUp', expandPromptTemplates });
          wsSend({ type: 'task_update', id: msg.id, status: 'accepted' });
        } catch (err: any) {
          wsSend({ type: 'task_update', id: msg.id, status: 'failed', error: String(err?.message || err) });
        }
      } else if (msg.type === 'pipeline') {
        startPipeline(msg).catch((err) => wsSend({ type: 'pipeline_update', id: msg.id, status: 'failed', detail: String(err?.message || err) }));
      } else if (msg.type === 'pipeline_cancel' && run?.id === msg.id) {
        run.cancel();
        ctx?.abort?.();
        finish();
      }
    };
    ws.onclose = () => { const was = ws?.readyState; ws = null; if (was !== undefined) showStatus(false); if (!closed) { retry = setTimeout(connect, 3000); retry.unref?.(); } };
    ws.onerror = () => {}; // onclose retries; the office is optional
  }
}
