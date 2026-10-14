// Plugin de OpenCode → Dev Team Office.
// Cópialo a .opencode/plugin/ (proyecto) o ~/.config/opencode/plugin/ (global).
//
// - Reporta eventos de la sesión a la oficina (HTTP).
// - Recibe tareas enviadas desde la oficina (WebSocket) y las manda a la sesión con el SDK
//   (`client.session.prompt`); si no hay sesión conocida, las escribe en el prompt del TUI.

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/v1/ws';

function send(event) {
  fetch(`${URL_BASE}/v1/events/opencode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // `run`: si este OpenCode es una etapa lanzada por la oficina, ya lee su salida y descarta esto.
    body: JSON.stringify({ ...event, run: process.env.DEV_TEAM_OFFICE_RUN }),
    signal: AbortSignal.timeout(1500),
  }).catch(() => {}); // la oficina es opcional: nunca rompe al agente
}

export const DevTeamOffice = async ({ client, directory }) => {
  const cwd = directory;
  let lastSession = null;
  let ws = null;

  const register = () => ws?.readyState === 1 &&
    ws.send(JSON.stringify({ type: 'register', agent: 'opencode', session: lastSession, cwd, pid: process.pid }));
  const seen = (session) => {
    if (!session || session === lastSession) return;
    lastSession = session;
    register();
  };
  const ack = (id, status, error) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'task_update', id, status, error }));

  async function toTui(text) {
    await client.tui.appendPrompt({ body: { text } });
    await client.tui.submitPrompt();
  }

  function runTask(msg) {
    client.tui.showToast({ body: { message: 'Tarea desde Dev Team Office', variant: 'info' } }).catch(() => {});
    const id = msg.session || lastSession;
    if (!id) {
      toTui(msg.text).then(() => ack(msg.id, 'accepted'), (err) => ack(msg.id, 'failed', String(err?.message || err)));
      return;
    }
    ack(msg.id, 'accepted');
    client.session.prompt({ path: { id }, body: { parts: [{ type: 'text', text: msg.text }] } })
      .then(() => ack(msg.id, 'done'))
      .catch((err) => toTui(msg.text).catch(() => ack(msg.id, 'failed', String(err?.message || err))));
  }

  // Sólo con OpenCode interactivo: un `opencode run` lanzado por la oficina termina solo.
  if (!process.env.DEV_TEAM_OFFICE_RUN && typeof WebSocket !== 'undefined') {
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = register;
      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(String(m.data)); } catch { return; }
        if (msg.type === 'task') runTask(msg);
      };
      ws.onclose = () => { ws = null; setTimeout(connect, 3000)?.unref?.(); };
      ws.onerror = () => {};
    };
    connect();
  }

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
        case 'session.idle': return send({ session, cwd, kind: 'done' });
        case 'session.error': return send({ session, cwd, kind: 'error', text: p.error?.data?.message || p.error?.name });
        case 'session.compacted': return send({ session, cwd, kind: 'compact' });
        case 'permission.updated':
        case 'permission.asked': return send({ session, cwd, kind: 'waiting', text: p.title || 'OpenCode pide permiso' });
        case 'todo.updated': return send({ session, cwd, kind: 'todos', todos: p.todos });
      }
    },
    // Mensaje del usuario → nueva tarea para el equipo.
    'chat.message': async (input, output) => {
      seen(input.sessionID);
      const text = output?.parts?.filter((x) => x.type === 'text').map((x) => x.text).join(' ');
      if (text) send({ session: input.sessionID, cwd, kind: 'task', text });
    },
  };
};
