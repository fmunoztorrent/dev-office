// Plugin de OpenCode → Dev Team Office. OpenCode es el BACKEND: aquí se ejecuta todo; la oficina
// sólo envía pedidos y dibuja lo que pasa.
//
// Instalación: `dev-team-office install opencode` (copia este plugin a ~/.config/opencode/plugin/
// y la librería común a ~/.dev-team-office/lib/devteam.mjs).
//
// - Reporta eventos de la sesión a la oficina (HTTP).
// - Se registra por WebSocket y anuncia los pipelines de su proyecto (.devteam/).
// - task:     la manda a la sesión con el SDK (`client.session.prompt`, o `client.session.command`
//             si es un comando de tu harness, como `/task` de Errementari) o al prompt del TUI.
// - pipeline: ejecuta un pipeline de .devteam/ DENTRO de la sesión, etapa por etapa, con el modelo
//             y el agente de cada etapa (`client.session.prompt`). Gates y bucles: devteam.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';
const STAGE_MARK = '[Dev Team Office · etapa'; // así empiezan los prompts de etapa (no son tareas nuevas)

async function loadLib() {
  let here = null;
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { /* sin import.meta.url */ }
  const candidates = [
    process.env.DEV_TEAM_OFFICE_LIB,
    path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs'),
    here && path.join(here, '..', 'common', 'devteam.mjs'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// La oficina (equipo) a la que pertenece esta sesión, si la abrió la oficina, y su pane de herdr.
const WHERE = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { pane: process.env.HERDR_PANE_ID } : {}),
};

// En orden: los eventos cuentan una historia (fase → herramientas → fin).
let chain = Promise.resolve();
function send(event) {
  chain = chain.then(() => fetch(`${URL_BASE}/v1/events/opencode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...WHERE, ...event }),
    signal: AbortSignal.timeout(1500),
  })).catch(() => {}); // la oficina es opcional: nunca rompe al agente
}

const errText = (err) => String(err?.data?.message || err?.message || err);
/** El SDK devuelve { data, error } (o el valor directo, según la versión). */
const unwrap = (res) => {
  if (res?.error) throw new Error(errText(res.error));
  return res?.data ?? res;
};

export const DevTeamOffice = async ({ client, directory }) => {
  const cwd = directory;
  let lib = null;
  let lastSession = null;
  let ws = null;
  let run = null;        // pipeline en curso
  let runSession = null; // sesión de OpenCode donde corre

  const wsSend = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
  const register = () => wsSend({
    type: 'register', agent: 'opencode', session: lastSession, cwd, pid: process.pid,
    can: lib ? ['task', 'pipeline'] : ['task'], project: lib ? lib.catalogEntry(lib.loadProject(cwd)) : null, ...WHERE,
  });
  const seen = (session) => {
    if (!session || session === lastSession) return;
    lastSession = session;
    register();
  };
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

  // ---- pipelines dentro de la sesión ----

  /** "proveedor/modelo" → { providerID, modelID }. Sin proveedor, lo busca entre los configurados. */
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
    const me = run = new lib.PipelineRun({ id: msg.id, project, pipeline, task: msg.task, report, onStatus: update });
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
        if (run !== me) break; // cancelado mientras corría
        step = await run.advance(lib.textOf(res) || lib.textOf(res?.info));
      } catch (err) {
        if (run !== me) break;
        step = run.fail(`OpenCode: ${errText(err)}`);
      }
    }
    if (run === me) run = null;
  }

  function cancelPipeline(id) {
    if (!run || run.id !== id) return;
    run.cancel();
    run = null;
    client.session.abort({ path: { id: runSession } }).catch(() => {});
  }

  // ---- conexión con la oficina ----
  // No en sesiones lanzadas por la oficina (`opencode run`): terminan solas.
  const connect = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = register;
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'task') runTask(msg);
      else if (msg.type === 'pipeline') startPipeline(msg).catch((err) => wsSend({ type: 'pipeline_update', id: msg.id, status: 'failed', detail: errText(err) }));
      else if (msg.type === 'pipeline_cancel') cancelPipeline(msg.id);
    };
    ws.onclose = () => { ws = null; setTimeout(connect, 3000)?.unref?.(); };
    ws.onerror = () => {};
  };
  lib = await loadLib().catch(() => null);
  if (!process.env.DEV_TEAM_OFFICE_LAUNCHED && typeof WebSocket !== 'undefined') connect();

  return {
    'tool.execute.before': async (input, output) => {
      seen(input.sessionID);
      send({ session: input.sessionID, cwd, kind: 'tool_start', tool: input.tool, toolUseId: input.callID, input: output.args });
    },
    'tool.execute.after': async (input, output) => {
      const failed = output?.metadata?.error || output?.metadata?.exit > 0;
      send({ session: input.sessionID, cwd, kind: 'tool_end', tool: input.tool, toolUseId: input.callID, ok: !failed });
    },
    event: async ({ event }) => {
      const p = event.properties || {};
      const session = p.sessionID || p.info?.id || p.info?.sessionID;
      if (event.type.startsWith('session.')) seen(session);
      switch (event.type) {
        case 'session.created': return send({ session, cwd, kind: 'session_start' });
        // con un pipeline en curso cada etapa termina un turno: el "listo" lo da el pipeline
        case 'session.idle': return run && session === runSession ? undefined : send({ session, cwd, kind: 'done' });
        case 'session.error': return send({ session, cwd, kind: 'error', text: p.error?.data?.message || p.error?.name });
        case 'session.compacted': return send({ session, cwd, kind: 'compact' });
        case 'permission.updated':
        case 'permission.asked': return send({ session, cwd, kind: 'waiting', text: p.title || 'OpenCode pide permiso' });
        case 'todo.updated': return run && session === runSession ? undefined : send({ session, cwd, kind: 'todos', todos: p.todos });
      }
    },
    // Mensaje del usuario → nueva tarea para el equipo (los prompts de etapa no lo son).
    'chat.message': async (input, output) => {
      seen(input.sessionID);
      const text = output?.parts?.filter((x) => x.type === 'text').map((x) => x.text).join(' ');
      if (text && !text.startsWith(STAGE_MARK)) send({ session: input.sessionID, cwd, kind: 'task', text });
    },
  };
};
