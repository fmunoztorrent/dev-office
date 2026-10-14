// De dónde saca la interfaz de terminal los eventos: del servidor en el mismo proceso,
// o de otra oficina por WebSocket (`dev-team-office watch`).

import WebSocket from 'ws';

export function localFeed(server) {
  let h = null;
  const onEvent = (ev, session) => h?.onEvent(ev, session);
  const onReset = () => h?.onSnapshot(server.office.snapshot());
  const onTasks = (snap) => h?.onTasks(snap);
  return {
    start(handlers) {
      h = handlers;
      h.onStatus({ ok: true, label: 'en vivo' });
      h.onSnapshot(server.office.snapshot());
      h.onTasks(server.hub.snapshot());
      server.office.on('event', onEvent);
      server.office.on('reset', onReset);
      server.hub.on('change', onTasks);
    },
    send: (msg) => server.handleMessage(msg),
    close() {
      server.office.off('event', onEvent);
      server.office.off('reset', onReset);
      server.hub.off('change', onTasks);
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
      if (msg.type === 'snapshot') { h.onSnapshot(msg.state); if (msg.state.tasks) h.onTasks(msg.state); }
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
    start(handlers) { h = handlers; h.onStatus({ ok: false, label: `conectando a ${label}…` }); connect(); },
    send(msg) {
      if (ws?.readyState !== 1) return { ok: false, error: 'sin conexión' };
      // Con `ref` el servidor contesta un ack; si falla, llega por onError.
      ws.send(JSON.stringify(msg.type === 'task' ? { ...msg, ref: Date.now() } : msg));
      return { ok: true };
    },
    close() { closed = true; clearTimeout(retry); ws?.close(); },
  };
}
