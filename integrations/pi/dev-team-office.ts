// Extensión de Pi (pi-coding-agent) → Dev Team Office. Pi es el BACKEND: aquí se ejecuta todo;
// la oficina sólo envía pedidos y dibuja lo que pasa.
//
// Instalación: `dev-team-office install pi` (copia esta extensión a ~/.pi/agent/extensions/ y la
// librería común a ~/.dev-team-office/lib/devteam.mjs).
//
// - Reporta prompts, herramientas y fin del agente a la oficina.
// - Se registra por WebSocket y anuncia los pipelines de su proyecto (.devteam/).
// - task:     la tarea llega como mensaje del usuario (follow-up si Pi está ocupado). Si es un
//             comando (`/architect …`, un prompt de tu harness), Pi lo expande como si lo
//             hubieras escrito.
// - pipeline: ejecuta un pipeline de .devteam/ DENTRO de esta sesión, etapa por etapa: cambia de
//             modelo con setModel, manda el prompt de la etapa, espera a que Pi termine
//             (agent_settled), corre el gate y sigue. Los bucles y gates los decide devteam.mjs.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';
const STAGE_MARK = '[Dev Team Office · etapa'; // así empiezan los prompts de etapa (no son tareas nuevas)

async function loadLib(): Promise<any> {
  const candidates = [process.env.DEV_TEAM_OFFICE_LIB, path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs')];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// La oficina (equipo) a la que pertenece esta sesión, si la abrió la oficina, y su pane de herdr.
const WHERE: Record<string, string> = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { pane: process.env.HERDR_PANE_ID } : {}),
};

// En orden: los eventos cuentan una historia (fase → herramientas → fin).
let chain: Promise<unknown> = Promise.resolve();
function send(event: Record<string, unknown>) {
  chain = chain.then(() => fetch(`${URL_BASE}/v1/events/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...WHERE, ...event }),
    signal: AbortSignal.timeout(1500),
  })).catch(() => {}); // la oficina es opcional: nunca rompe a Pi
}

export default function (pi: ExtensionAPI) {
  const session = (process.env.DEV_TEAM_OFFICE_SESSION ||= `pi-${process.pid}`);
  const cwd = process.cwd();
  const report = (e: Record<string, unknown>) => send({ session, cwd, ...e });
  let ctx: any = null;     // último contexto visto (isIdle, modelRegistry, model)
  let lib: any = null;
  let run: any = null;     // pipeline en curso en esta sesión
  let waiting = false;     // esperando que la etapa actual termine
  let lastText = '';       // última respuesta de Pi (el resumen de la etapa)
  let originalModel: any = null;

  pi.on('session_start', async (_e: any, c: any) => { ctx = c; report({ kind: 'session_start' }); register(); });
  pi.on('before_agent_start', async (event: any, c: any) => {
    ctx = c;
    // un prompt de etapa no es una tarea nueva: la fase ya la anunció el pipeline
    if (event.messageType === 'user' && event.prompt && !String(event.prompt).startsWith(STAGE_MARK)) report({ kind: 'task', text: event.prompt });
  });
  pi.on('turn_start', async (_e: any, c: any) => { ctx = c; report({ kind: 'thinking' }); });
  pi.on('tool_call', async (event: any, c: any) => {
    ctx = c;
    report({ kind: 'tool_start', tool: event.toolName, toolUseId: event.toolCallId, input: event.input });
  });
  pi.on('tool_result', async (event: any) =>
    report({ kind: 'tool_end', tool: event.toolName, toolUseId: event.toolCallId, input: event.input, ok: !event.isError }));
  pi.on('message_end', async (event: any) => {
    if (event.message?.role !== 'assistant' || !lib) return;
    const t = lib.textOf(event.message);
    if (t) lastText = t;
  });
  pi.on('session_compact', async () => report({ kind: 'compact' }));
  // con un pipeline en curso cada etapa termina un turno: el "listo" lo da el pipeline al final
  pi.on('agent_end', async (_e: any, c: any) => { ctx = c; if (!run) report({ kind: 'done' }); });
  pi.on('agent_settled', async (event: any, c: any) => {
    ctx = c;
    if (!run || !waiting) return;
    waiting = false;
    if (event.aborted) { run.cancel('cancelado en Pi'); return finish(); }
    await apply(await run.advance(lastText));
  });
  pi.on('session_shutdown', async () => { closed = true; ws?.close(); report({ kind: 'session_end' }); });

  // ---- pipelines dentro de la sesión ----

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
      await pi.setModel(originalModel); // sin modelo propio: el de la sesión
    }
    lastText = '';
    waiting = true;
    if (ctx?.isIdle?.() ?? true) pi.sendUserMessage(step.prompt);
    else pi.sendUserMessage(step.prompt, { deliverAs: 'followUp' });
  }

  function finish() {
    waiting = false;
    run = null;
    if (originalModel) pi.setModel(originalModel).catch(() => {}); // vuelve al modelo con el que estaba la sesión
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

  // ---- conexión con la oficina ----
  // Sólo en sesiones interactivas: un `pi -p` (p. ej. lanzado por la oficina) termina solo.
  let ws: WebSocket | null = null;
  let closed = false;
  const wsSend = (m: unknown) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  // El harness declara qué subagente suyo es qué personaje (frontmatter `role`): se lo cuenta a la
  // oficina al registrarse, así una sesión que sólo delega en local también cae en el personaje correcto.
  // Va aparte del registro para no mezclar la sesión con el reporte de roles (y para poder verlo fallar).
  function reportAgentRoles() {
    // sin librería no hay nada que detectar; ya se avisa en `register`/`startPipeline` (no se repite)
    if (!lib) return;
    let detected: any;
    try {
      // SÓLO la lectura puede fallar: el reporte no, se traga sus propios errores
      detected = lib.detectHarness(cwd);
    } catch (err: any) {
      // no se pudieron LEER los roles: la oficina usa su respaldo por texto; se avisa y nunca se rompe a Pi
      console.warn(`[dev-team-office] no se pudieron leer los roles del harness: ${String(err?.message || err)}`);
      return;
    }
    // Un mapa vacío es un DATO LEGÍTIMO (el proyecto no tiene agentes con rol), no un error: se reporta
    // igual, así la oficina distingue "no aprendí nada" de "no me lo contaron". No lo conviertas en aviso:
    // sería ruido en cada sesión de un proyecto sin agentes.
    report({ kind: 'agent_roles', roles: detected?.roles || {} });
    // Una declaración rota no se tapa: la oficina no puede adivinar el personaje y el operador tiene que verlo.
    for (const issue of detected?.roleIssues || []) console.warn(`[dev-team-office] ${issue}`);
  }

  function register() {
    const project = lib ? lib.catalogEntry(lib.loadProject(cwd)) : null;
    wsSend({ type: 'register', agent: 'pi', session, cwd, pid: process.pid, can: lib ? ['task', 'pipeline'] : ['task'], project, ...WHERE });
    reportAgentRoles();
  }
  if (!process.stdin.isTTY || process.env.DEV_TEAM_OFFICE_LAUNCHED || typeof WebSocket === 'undefined') return;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = register;
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'task') {
        try {
          // `/comando …`: se expande como si lo hubieras escrito (prompts y comandos de tu harness)
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
    ws.onclose = () => { ws = null; if (!closed) (setTimeout(connect, 3000) as any).unref?.(); };
    ws.onerror = () => {}; // onclose reintenta; la oficina es opcional
  };
  loadLib().then((l) => { lib = l; }).catch(() => {}).finally(connect);
}
