// Where the terminal interface gets its events from: the server in the same process,
// or another office over WebSocket (`dev-team-office watch`).
//
// The interface watches one office at a time (the chosen one, saved in the settings): the feed only
// passes it that office's data, and send({ type: 'view', office }) changes it.

// To watch another office, Node's built-in WebSocket (≥ 22) is used: the office installs no packages.

export function localFeed(server) {
  let h = null;
  let view = server.store.getPrefs().view.office;
  const mine = (id) => id === view;
  const onEvent = (id, ev, session) => { if (mine(id)) h?.onEvent(ev, session); };
  const onReset = (id) => { if (mine(id)) h?.onSnapshot(server.fullState(view)); };
  const onTasks = () => h?.onTasks(server.hub.snapshot(view));
  const onPipelines = () => h?.onPipelines(server.pipelines.snapshot(view).runs);
  const onTargets = () => h?.onTargets?.(server.registry.targets(view));
  const onAppearance = (id, a) => { if (mine(id)) h?.onAppearance?.(a); };
  const onWeather = (id, w) => { if (mine(id)) h?.onWeather?.(w); };
  const onPrefs = (p) => h?.onPrefs?.(p);
  const onOffices = (list) => h?.onOffices?.(list, server.company.info(view));
  const onHerdr = (st) => h?.onHerdr?.(st);
  const snapshot = () => {
    const st = server.fullState(view);
    h.onPrefs?.(st.prefs);
    h.onOffices?.(st.offices, st.office);
    h.onSnapshot(st);
    h.onTasks(st);
    h.onPipelines(st.pipelines);
    h.onTargets?.(st.targets);
    h.onAppearance?.(st.appearance);
    h.onWeather?.(st.weather);
    h.onHerdr?.(st.herdr);
  };
  return {
    http: server.url,
    get view() { return view; },
    start(handlers) {
      h = handlers;
      h.onStatus({ ok: true, key: 'conn.live' });
      snapshot();
      server.company.on('event', onEvent);
      server.company.on('reset', onReset);
      server.hub.on('change', onTasks);
      server.pipelines.on('change', onPipelines);
      server.registry.on('change', onTargets);
      server.bus.on('appearance', onAppearance);
      server.bus.on('weather', onWeather);
      server.bus.on('prefs', onPrefs);
      server.bus.on('offices', onOffices);
      server.bus.on('herdr', onHerdr);
    },
    send(msg) {
      if (msg?.type === 'view') {
        const out = server.handleMessage(msg);
        if (out.ok) { view = msg.office; snapshot(); }
        return out;
      }
      return server.handleMessage({ office: view, ...msg });
    },
    close() {
      server.company.off('event', onEvent);
      server.company.off('reset', onReset);
      server.hub.off('change', onTasks);
      server.pipelines.off('change', onPipelines);
      server.registry.off('change', onTargets);
      server.bus.off('appearance', onAppearance);
      server.bus.off('weather', onWeather);
      server.bus.off('prefs', onPrefs);
      server.bus.off('offices', onOffices);
      server.bus.off('herdr', onHerdr);
    },
  };
}

export function remoteFeed(wsUrl) {
  let ws = null, h = null, closed = false, retry = null, view = null;
  const host = new URL(wsUrl).host;
  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      h.onStatus({ ok: true, key: 'conn.connectedTo', vars: { host } });
      if (view) ws.send(JSON.stringify({ type: 'view', office: view })); // when reconnecting, the same office
    });
    ws.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'snapshot') {
        const st = msg.state;
        view = st.office?.id || view;
        if (st.prefs) h.onPrefs?.(st.prefs);
        h.onOffices?.(st.offices || [], st.office);
        h.onSnapshot(st);
        if (st.tasks) h.onTasks(st);
        h.onPipelines(st.pipelines || []);
        h.onTargets?.(st.targets || []);
        h.onAppearance?.(st.appearance || {});
        h.onWeather?.(st.weather || null);
        h.onHerdr?.(st.herdr || null);
      }
      if (msg.type === 'appearance') h.onAppearance?.(msg.appearance);
      if (msg.type === 'weather') h.onWeather?.(msg.weather);
      if (msg.type === 'prefs') h.onPrefs?.(msg.prefs);
      if (msg.type === 'offices') h.onOffices?.(msg.offices, (msg.offices || []).find((o) => o.id === view));
      if (msg.type === 'herdr') h.onHerdr?.(msg.herdr);
      if (msg.type === 'pipelines') h.onPipelines(msg.runs);
      if (msg.type === 'targets') h.onTargets?.(msg.targets);
      if (msg.type === 'event') h.onEvent(msg.event, msg.session);
      if (msg.type === 'tasks') h.onTasks(msg);
      if (msg.type === 'ack' && msg.ok === false) h.onError?.(msg.error);
      if (msg.type === 'error') h.onError?.(msg.error);
    });
    ws.addEventListener('close', () => {
      if (closed) return;
      h.onStatus({ ok: false, key: 'conn.retrying', vars: { host } });
      retry = setTimeout(connect, 1500);
    });
    ws.addEventListener('error', () => {}); // 'close' arrives later and retries
  };
  return {
    http: wsUrl.replace(/^ws/, 'http').replace(/\/v1\/ws$|\/ws$/, ''),
    get view() { return view; },
    start(handlers) { h = handlers; h.onStatus({ ok: false, key: 'conn.connectingTo', vars: { host } }); connect(); },
    send(msg) {
      if (ws?.readyState !== 1) return { ok: false, error: 'offline' };
      if (msg?.type === 'view') view = msg.office;
      // With `ref` the server answers an ack; if it fails, it arrives through onError.
      ws.send(JSON.stringify(['task', 'pipeline_start', 'run'].includes(msg.type) ? { ...msg, ref: Date.now() } : msg));
      return { ok: true };
    },
    close() { closed = true; clearTimeout(retry); ws?.close(); },
  };
}
