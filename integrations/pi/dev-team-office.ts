// Extensión de Pi (pi-coding-agent) → Dev Team Office.
// Cópiala a ~/.pi/agent/extensions/ (global) o a la carpeta de extensiones del proyecto.
//
// - Reporta prompts, herramientas y fin del agente a la oficina (HTTP).
// - Recibe tareas enviadas desde la oficina (WebSocket) y se las pasa a Pi como mensaje del
//   usuario: al instante si Pi está libre, o como follow-up si está trabajando.
// Las fases por rol (arquitecto → QA RED → backend…) las reporta el skill `dev-team-office`.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';

function send(event: Record<string, unknown>) {
  fetch(`${URL_BASE}/v1/events/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(1500),
  }).catch(() => {});
}

export default function (pi: ExtensionAPI) {
  // Los comandos que lanza Pi heredan esta variable: así el script del skill usa la misma sesión.
  const session = (process.env.DEV_TEAM_OFFICE_SESSION ||= `pi-${process.pid}`);
  const cwd = process.cwd();
  let ctx: any = null; // último contexto visto, para saber si Pi está ocupado

  pi.on('session_start', async (_e: any, c: any) => { ctx = c; send({ session, cwd, kind: 'session_start' }); });
  pi.on('before_agent_start', async (event: any, c: any) => {
    ctx = c;
    if (event.messageType === 'user' && event.prompt) send({ session, cwd, kind: 'task', text: event.prompt });
  });
  pi.on('turn_start', async (_e: any, c: any) => { ctx = c; send({ session, cwd, kind: 'thinking' }); });
  pi.on('tool_call', async (event: any, c: any) => {
    ctx = c;
    send({ session, cwd, kind: 'tool_start', tool: event.toolName, toolUseId: event.toolCallId, input: event.input });
  });
  pi.on('tool_result', async (event: any) =>
    send({ session, cwd, kind: 'tool_end', tool: event.toolName, toolUseId: event.toolCallId, input: event.input, ok: !event.isError }));
  pi.on('session_compact', async () => send({ session, cwd, kind: 'compact' }));
  pi.on('agent_end', async (_e: any, c: any) => { ctx = c; send({ session, cwd, kind: 'done' }); });
  pi.on('session_shutdown', async () => { closed = true; ws?.close(); send({ session, cwd, kind: 'session_end' }); });

  // ---- tareas desde la oficina ----
  // Sólo en sesiones interactivas: un `pi -p` lanzado por la oficina termina solo.
  let ws: WebSocket | null = null;
  let closed = false;
  if (process.env.DEV_TEAM_OFFICE_RUN || typeof WebSocket === 'undefined') return;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => ws?.send(JSON.stringify({ type: 'register', agent: 'pi', session, cwd, pid: process.pid }));
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type !== 'task') return;
      try {
        const idle = ctx?.isIdle?.() ?? true;
        if (idle) pi.sendUserMessage(msg.text);
        else pi.sendUserMessage(msg.text, { deliverAs: 'followUp' });
        ws?.send(JSON.stringify({ type: 'task_update', id: msg.id, status: 'accepted' }));
      } catch (err: any) {
        ws?.send(JSON.stringify({ type: 'task_update', id: msg.id, status: 'failed', error: String(err?.message || err) }));
      }
    };
    ws.onclose = () => { ws = null; if (!closed) (setTimeout(connect, 3000) as any).unref?.(); };
    ws.onerror = () => {}; // onclose reintenta; la oficina es opcional
  };
  connect();
}
