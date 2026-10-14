// De dónde saca la interfaz de terminal los eventos: del servidor en el mismo proceso,
// o de otra oficina por WebSocket (`dev-team-office watch`).

import WebSocket from 'ws';

export function localFeed(server) {
  let h = null;
  const onEvent = (ev, session) => h?.onEvent(ev, session);
  const onReset = () => h?.onSnapshot(server.office.snapshot());
  const onTasks = (snap) => h?.onTasks(snap);
  const onPipelines = (snap) => h?.onPipelines(snap.runs, snap.projects);
  const onAppearance = (a) => h?.onAppearance?.(a);
  return {
    http: server.url,
    start(handlers) {
      h = handlers;
      h.onStatus({ ok: true, label: 'en vivo' });
      h.onSnapshot(server.office.snapshot());
      h.onTasks(server.hub.snapshot());
      const p = server.pipelines.snapshot();
      h.onPipelines(p.runs, p.projects);
      h.onAppearance?.(server.appearance());
      server.bus.on('appearance', onAppearance);
      server.office.on('event', onEvent);
      server.office.on('reset', onReset);
      server.hub.on('change', onTasks);
      server.pipelines.on('change', onPipelines);
    },
    send: (msg) => server.handleMessage(msg),
    close() {
      server.office.off('event', onEvent);
      server.office.off('reset', onReset);
      server.hub.off('change', onTasks);
      server.pipelines.off('change', onPipelines);
      server.bus.off('appearance', onAppearance);
    },
  };
}

export function remoteFeed(wsUrl) {
  let ws = null, h = null, closed = false, retry = null;
  const label = new URL(wsUrl).host;
  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => h.onStatus({ ok: true, label: `conectado a ${label}` }));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'snapshot') { h.onSnapshot(msg.state); if (msg.state.tasks) h.onTasks(msg.state); h.onPipelines(msg.state.pipelines || [], msg.state.projects || []); h.onAppearance?.(msg.state.appearance || {}); }
      if (msg.type === 'appearance') h.onAppearance?.(msg.appearance);
      if (msg.type === 'pipelines') h.onPipelines(msg.runs, msg.projects);
      if (msg.type === 'event') h.onEvent(msg.event, msg.session);
      if (msg.type === 'tasks') h.onTasks(msg);
      if (msg.type === 'ack' && msg.ok === false) h.onError?.(msg.error);
    });
    ws.on('close', () => {
      if (closed) return;
      h.onStatus({ ok: false, label: `sin conexión con ${label}, reintentando…` });
      retry = setTimeout(connect, 1500);
    });
    ws.on('error', () => {}); // 'close' llega después y reintenta
  };
  return {
    http: wsUrl.replace(/^ws/, 'http').replace(/\/v1\/ws$|\/ws$/, ''),
    start(handlers) { h = handlers; h.onStatus({ ok: false, label: `conectando a ${label}…` }); connect(); },
    send(msg) {
      if (ws?.readyState !== 1) return { ok: false, error: 'sin conexión' };
      // Con `ref` el servidor contesta un ack; si falla, llega por onError.
      ws.send(JSON.stringify(msg.type === 'task' || msg.type === 'pipeline_start' ? { ...msg, ref: Date.now() } : msg));
      return { ok: true };
    },
    close() { closed = true; clearTimeout(retry); ws?.close(); },
  };
}
