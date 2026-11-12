// OpenCode plugin → Dev Team Office. OpenCode is the BACKEND: everything runs here; the office
// only sends requests and draws what happens.
//
// Installation: `dev-team-office install opencode` (copies this plugin to ~/.config/opencode/plugin/
// and the shared library to ~/.dev-team-office/lib/devteam.mjs).
//
// - Reports the session's events to the office (HTTP).
// - Registers over WebSocket and announces its project's pipelines (.devteam/).
// - task:     sends it to the session with the SDK (`client.session.prompt`, or `client.session.command`
//             if it is a command of your harness, like Errementari's `/task`) or to the TUI prompt.
// - pipeline: runs a .devteam/ pipeline INSIDE the session, stage by stage, with each stage's model
//             and agent (`client.session.prompt`). Gates and loops: devteam.mjs.
// - context:  how full each session's context is (the office's bar), from its answers' tokens.
// - compact:  the office asks to compact it (past your threshold): `client.session.summarize`, when free.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';
const STAGE_MARK = '[Dev Team Office · etapa'; // stage prompts start like this (they are not new tasks)
// the OpenCode events that tell the office something
const TRACKED = new Set(['session.created', 'session.idle', 'session.error', 'session.compacted', 'permission.updated', 'permission.asked', 'todo.updated', 'message.updated']);

async function loadLib() {
  let here = null;
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { /* no import.meta.url */ }
  const candidates = [
    process.env.DEV_TEAM_OFFICE_LIB,
    path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs'),
    here && path.join(here, '..', 'common', 'devteam.mjs'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// The office (team) this session belongs to, if the office opened it, and its herdr pane.
const WHERE = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { pane: process.env.HERDR_PANE_ID } : {}),
};

// In order: the events tell a story (phase → tools → end).
let chain = Promise.resolve();
function send(event) {
  chain = chain.then(() => fetch(`${URL_BASE}/v1/events/opencode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...WHERE, ...event }),
    signal: AbortSignal.timeout(1500),
  })).catch(() => {}); // the office is optional: it never breaks the agent
}

const errText = (err) => String(err?.data?.message || err?.message || err);
/** The SDK returns { data, error } (or the value directly, depending on the version). */
const unwrap = (res) => {
  if (res?.error) throw new Error(errText(res.error));
  return res?.data ?? res;
};

export const DevTeamOffice = async ({ client, directory }) => {
  // a side question (btw) launched by the office: it is not the team's work, it is not reported
  if (process.env.DEV_TEAM_OFFICE_BTW) return {};
  const cwd = directory;
  let lib = null;
  let lastSession = null;
  let ws = null;
  let run = null;        // pipeline en curso
  let runSession = null; // the OpenCode session where it runs

  const wsSend = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
  const register = () => wsSend({
    type: 'register', agent: 'opencode', session: lastSession, cwd, pid: process.pid,
    can: lib ? ['task', 'pipeline', 'compact'] : ['task', 'compact'], project: lib ? lib.catalogEntry(lib.loadProject(cwd)) : null, ...WHERE,
  });
  const seen = (session) => {
    if (!session || session === lastSession || parentOf.get(session)) return;
    lastSession = session;
    register();
  };
  // OpenCode's subagents (the `task` tool) run in child sessions (`parentID`): their activity goes to
  // the parent's session marked with `child`, like Pi's, and the office draws it as the subagent's
  // character. Their start, their prompt and their turn end are their own (the office does not count them for the team).
  const parentOf = new Map(); // session → its parent's (null: it is a main session)
  const learn = (info) => {
    if (!info?.id) return;
    parentOf.set(info.id, info.parentID || null);
    if (parentOf.size > 200) parentOf.delete(parentOf.keys().next().value);
  };
  async function where(session) {
    if (session && !parentOf.has(session)) {
      // the session.created event usually arrives first; if not, OpenCode is asked (once, with a cap)
      const info = await Promise.race([Promise.resolve(client.session.get?.({ path: { id: session } })).then(unwrap, () => null), new Promise((r) => setTimeout(r, 500, null))]).catch(() => null);
      if (info?.id === session) learn(info); else parentOf.set(session, null);
    }
    const parent = parentOf.get(session);
    return parent ? { session: parent, child: session } : { session };
  }
  const ack = (id, status, error, detail) => wsSend({ type: 'task_update', id, status, error, detail });
  const toast = (message) => client.tui.showToast({ body: { message, variant: 'info' } }).catch(() => {});

  async function toTui(text) {
    await client.tui.appendPrompt({ body: { text } });
    await client.tui.submitPrompt();
  }

  async function newSession(title) {
    const s = unwrap(await client.session.create({ body: { title: String(title).slice(0, 60) } }));
    seen(s.id);
    return s.id;
  }

  function runTask(msg) {
    toast('Tarea desde Dev Team Office');
    const id = msg.session || lastSession;
    if (!id) {
      toTui(msg.text).then(() => ack(msg.id, 'accepted'), (err) => ack(msg.id, 'failed', errText(err)));
      return;
    }
    ack(msg.id, 'accepted');
    const sent = msg.command
      ? client.session.command({ path: { id }, body: { command: msg.command, arguments: msg.args ?? '' } })
      : client.session.prompt({ path: { id }, body: { parts: [{ type: 'text', text: msg.text }] } });
    sent
      .then((res) => { unwrap(res); ack(msg.id, 'done'); })
      .catch((err) => toTui(msg.text).catch(() => ack(msg.id, 'failed', errText(err))));
  }

  // How full a session's context is: an assistant message's tokens (what it read, cached or not, and
  // what it wrote) against its model's window (the provider says it: limit.context). A compaction's
  // summary is not the conversation (it read the whole old one): it does not count.
  const windows = new Map(); // "provider/model" → context window (only the ones found: a failed lookup is retried)
  const lastContext = new Map(); // session → what was sent (only when it moves)
  const modelOf = new Map(); // session → { providerID, modelID } of its last answer (to compact it)
  async function windowOf(providerID, modelID) {
    const key = `${providerID}/${modelID}`;
    if (!windows.has(key)) {
      let cfg = {};
      try { cfg = unwrap(await client.config.providers()) || {}; } catch { /* asked again with the next answer */ }
      const model = (cfg.providers || []).find((x) => x.id === providerID)?.models?.[modelID];
      const n = Number(model?.limit?.context) || 0;
      if (!n) return 0;
      windows.set(key, n);
    }
    return windows.get(key);
  }
  async function contextOf(info) {
    const tk = info?.tokens;
    if (info?.role !== 'assistant' || !tk || info.summary) return null;
    if (info.providerID && info.modelID) modelOf.set(info.sessionID, { providerID: info.providerID, modelID: info.modelID });
    const used = Number(tk.total) || (tk.input || 0) + (tk.cache?.read || 0) + (tk.cache?.write || 0) + (tk.output || 0) + (tk.reasoning || 0);
    const max = used ? await windowOf(info.providerID, info.modelID) : 0;
    return used && max ? { used, max } : null;
  }

  // The office asks to compact a session's context (past your threshold, ⚙ › General): OpenCode
  // summarizes it (session.summarize) when the session is free, never in the middle of an answer.
  const idle = new Set();          // sessions that are not working
  const compactAsked = new Set();  // sessions to compact when they are free
  function compactIfAsked(session) {
    if (!compactAsked.has(session) || !idle.has(session) || (run && session === runSession)) return;
    const model = modelOf.get(session);
    if (!model || typeof client.session.summarize !== 'function') return;
    compactAsked.delete(session);
    client.session.summarize({ path: { id: session }, body: model }).then(unwrap).catch((err) => send({ session, cwd, kind: 'autocompact', via: 'failed', text: errText(err) }));
  }
  const busy = (session) => { if (session) idle.delete(session); };

  // ---- pipelines inside the session ----

  /** "provider/model" → { providerID, modelID }. Without a provider, it looks it up among the configured ones. */
  async function modelRef(spec) {
    const [providerID, ...rest] = String(spec).split('/');
    if (rest.length) return { providerID, modelID: rest.join('/') };
    const cfg = unwrap(await client.config.providers().catch(() => null)) || {};
    for (const p of cfg.providers || []) if (p.models && spec in p.models) return { providerID: p.id, modelID: spec };
    return null;
  }

  async function startPipeline(msg) {
    const update = (status) => wsSend({ type: 'pipeline_update', id: msg.id, ...status });
    if (!lib) return update({ status: 'failed', detail: 'falta la librería devteam.mjs: corre `dev-team-office install opencode`' });
    if (run) return update({ status: 'failed', detail: 'este OpenCode ya está corriendo otro pipeline' });
    const project = lib.loadProject(cwd);
    const pipeline = project.pipelines.find((p) => p.id === msg.pipeline);
    if (!pipeline) return update({ status: 'failed', detail: `no hay un pipeline "${msg.pipeline}" en ${project.dir}/.devteam/` });

    runSession = msg.session && msg.session === lastSession ? msg.session : lastSession || await newSession(`Pipeline ${pipeline.name}`);
    const report = (e) => send({ session: runSession, cwd, ...e });
    const me = run = new lib.PipelineRun({ id: msg.id, project, pipeline, task: msg.task, report, onStatus: update, models: msg.models || null });
    toast(`Pipeline «${pipeline.name}» desde Dev Team Office`);
    let step = run.start();
    while (step.action === 'prompt' && run === me) {
      const body = { parts: [{ type: 'text', text: step.prompt }] };
      if (step.stage.native && step.stage.harness === 'opencode') body.agent = step.stage.agent;
      if (step.stage.model) {
        const model = await modelRef(step.stage.model);
        if (!model) { step = run.fail(`OpenCode no conoce el modelo ${step.stage.model} (usa proveedor/modelo)`); continue; }
        body.model = model;
      }
      try {
        const res = unwrap(await client.session.prompt({ path: { id: runSession }, body }));
        if (run !== me) break; // cancelled while running
        step = await run.advance(lib.textOf(res) || lib.textOf(res?.info));
      } catch (err) {
        if (run !== me) break;
        step = run.fail(`OpenCode: ${errText(err)}`);
      }
    }
    if (run === me) { run = null; compactIfAsked(runSession); }
  }

  function cancelPipeline(id) {
    if (!run || run.id !== id) return;
    run.cancel();
    run = null;
    client.session.abort({ path: { id: runSession } }).catch(() => {});
  }

  // ---- connection to the office ----
  // Not in sessions launched by the office (`opencode run`): they end by themselves.
  const connect = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = register;
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'task') runTask(msg);
      else if (msg.type === 'pipeline') startPipeline(msg).catch((err) => wsSend({ type: 'pipeline_update', id: msg.id, status: 'failed', detail: errText(err) }));
      else if (msg.type === 'pipeline_cancel') cancelPipeline(msg.id);
      else if (msg.type === 'compact' && (msg.session || lastSession)) { compactAsked.add(msg.session || lastSession); compactIfAsked(msg.session || lastSession); }
    };
    ws.onclose = () => { ws = null; setTimeout(connect, 3000)?.unref?.(); };
    ws.onerror = () => {};
  };
  lib = await loadLib().catch(() => null);
  if (!process.env.DEV_TEAM_OFFICE_LAUNCHED && typeof WebSocket !== 'undefined') connect();

  // a command's arguments, from its start to its end: a command left in the background with its
  // output in a file is a service the office lists (server/services.js)
  const commandArgs = new Map();
  return {
    'tool.execute.before': async (input, output) => {
      busy(input.sessionID);
      const at = await where(input.sessionID);
      seen(input.sessionID);
      if (input.tool === 'bash' && output?.args) {
        commandArgs.set(input.callID, output.args);
        if (commandArgs.size > 50) commandArgs.delete(commandArgs.keys().next().value);
      }
      send({ ...at, cwd, kind: 'tool_start', tool: input.tool, toolUseId: input.callID, input: output.args });
    },
    'tool.execute.after': async (input, output) => {
      const failed = output?.metadata?.error || output?.metadata?.exit > 0;
      const args = commandArgs.get(input.callID);
      commandArgs.delete(input.callID);
      send({ ...(await where(input.sessionID)), cwd, kind: 'tool_end', tool: input.tool, toolUseId: input.callID, ok: !failed, ...(args ? { input: args } : {}) });
    },
    event: async ({ event }) => {
      const p = event.properties || {};
      if (event.type === 'session.created' || event.type === 'session.updated') learn(p.info);
      // a message's info carries its session (its own id is the message's); a session's info is the session
      const session = p.sessionID || p.info?.sessionID || p.info?.id;
      if (!session || !TRACKED.has(event.type)) return;
      seen(session);
      const at = await where(session);
      switch (event.type) {
        case 'session.created': return send({ ...at, cwd, kind: 'session_start' });
        // with a pipeline in progress each stage ends a turn: the pipeline says when it is "done"
        case 'session.idle':
          idle.add(session);
          compactIfAsked(session);
          return run && session === runSession ? undefined : send({ ...at, cwd, kind: 'turn_end' });
        case 'session.error': return send({ ...at, cwd, kind: 'error', text: p.error?.data?.message || p.error?.name });
        case 'session.compacted': lastContext.delete(session); return send({ ...at, cwd, kind: 'compact' });
        case 'permission.updated':
        case 'permission.asked': return send({ ...at, cwd, kind: 'waiting', text: p.title || 'OpenCode pide permiso' });
        case 'todo.updated': return run && session === runSession ? undefined : send({ ...at, cwd, kind: 'todos', todos: p.todos });
        case 'message.updated': {
          if (at.child) return; // a subagent's context is its own
          const context = await contextOf(p.info);
          const key = context && `${Math.round(context.used / 1000)}/${context.max}`;
          if (!context || lastContext.get(session) === key) return;
          lastContext.set(session, key);
          return send({ ...at, cwd, kind: 'context', context });
        }
      }
    },
    // User message → new task for the team (stage prompts are not). In a child session it is the
    // assignment the parent gave its subagent: that is how the office knows which one it is.
    'chat.message': async (input, output) => {
      busy(input.sessionID);
      const at = await where(input.sessionID);
      seen(input.sessionID);
      const text = output?.parts?.filter((x) => x.type === 'text').map((x) => x.text).join(' ');
      if (text && !text.startsWith(STAGE_MARK)) send({ ...at, cwd, kind: 'task', text });
    },
  };
};
