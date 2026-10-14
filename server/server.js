// Servidor de integración: API HTTP/JSON + WebSocket, en TCP (localhost) y en un socket Unix.
// Lo usan `npm start` (sin interfaz) y el ejecutable `dev-team-office` (con la oficina en la terminal).

import http from 'node:http';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Office } from './office.js';
import { runDemo, demoScript, piDemoScript } from './demo.js';
import { TaskHub, loadConfig } from './tasks.js';
import { PipelineHub } from './pipeline.js';
import { readOfficeSettings, writeOfficeSettings, readProjectSettings, writeTeam, checkPipeline, writePipeline, deletePipeline, PIPELINE_TEMPLATE, HARNESS_LIST } from './settings.js';

export const VERSION = '0.3.0';
export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY = 16 * 1024 * 1024; // PostToolUse trae el resultado completo de la herramienta
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const WS_PATHS = new Set(['/v1/ws', '/ws']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function defaultSocketPath() {
  return process.env.DEV_TEAM_OFFICE_SOCKET || path.join(os.homedir(), '.dev-team-office', 'office.sock');
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Arranca la oficina. Rechaza con code EADDRINUSE si el puerto ya está ocupado.
 * @returns {Promise<{office, url, socket, command, handleMessage, close}>}
 */
export async function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, socket = defaultSocketPath(), log = () => {}, config, projects = [] } = {}) {
  const office = new Office();
  config = { ...(config ?? loadConfig()) };
  config.projects = [...(config.projects || []), ...projects]; // proyectos que el diálogo ofrece de entrada
  const hub = new TaskHub(office, { config, officeUrl: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}` });
  const pipelines = new PipelineHub(office, hub, { config });
  const startedAt = Date.now();
  const appearance = () => config.appearance || {};
  const bus = new EventEmitter(); // cambios de ajustes que ven las interfaces (p. ej. la apariencia)
  const fullState = () => ({ ...office.snapshot(), ...hub.snapshot(), pipelines: pipelines.snapshot().runs, appearance: appearance() });
  // Guardar en ⚙ Ajustes se aplica en caliente: proyectos, directorio por defecto y comandos.
  const applyConfig = (next) => {
    config = { ...next, projects: [...(next.projects || []), ...projects] };
    hub.applyConfig(config);
    pipelines.config = config;
    bus.emit('appearance', appearance());
  };
  // Eventos que un hook/extensión manda desde una etapa cuya salida ya leemos: se descartan.
  const fromStreamedStage = (p) => pipelines.isStreamed(p?.run);
  let stopDemo = null;
  let socketPath = null;

  // ---------- acciones compartidas por HTTP, WebSocket y la interfaz local ----------

  function command(action, { speed } = {}) {
    switch (action) {
      case 'reset': office.reset(); return true;
      case 'demo':
      case 'demo-pi':
        if (stopDemo) return false;
        stopDemo = runDemo((p) => office.ingest(action === 'demo' ? 'claude-code' : 'pi', p), {
          script: action === 'demo' ? demoScript : piDemoScript, speed: Number(speed) || 1, onEnd: () => (stopDemo = null),
        });
        return true;
      case 'stop-demo': stopDemo?.(); return true;
      default: return false;
    }
  }

  /**
   * Mensaje con la forma del protocolo WebSocket. `conn` es la conexión que lo envía
   * (null por HTTP o desde la interfaz local). Devuelve { ok, ... }.
   */
  function handleMessage(msg, conn = null) {
    if (!msg || typeof msg !== 'object') return { ok: false, error: 'mensaje inválido' };
    switch (msg.type) {
      case 'event': {
        const source = String(msg.source || msg.payload?.source || conn?.agent || 'generic');
        if (fromStreamedStage(msg.payload)) return { ok: true, accepted: 0, ids: [] };
        const events = office.ingest(source, msg.payload ?? {});
        return { ok: true, accepted: events.length, ids: events.map((e) => e.id) };
      }
      // Un agente (extensión de Pi, plugin de OpenCode…) se registra para recibir tareas.
      case 'register': {
        if (!conn) return { ok: false, error: 'register sólo por WebSocket' };
        conn.agent = String(msg.agent || 'agente');
        return hub.register(conn, msg);
      }
      case 'task_update':
        return conn ? hub.update(conn.id, msg) : { ok: false, error: 'task_update sólo por WebSocket' };
      case 'task':
        return hub.submit(msg);
      case 'task_cancel':
        return hub.cancel(msg.id);
      case 'pipeline_start':
        return pipelines.start(msg);
      case 'pipeline_cancel':
        return pipelines.cancel(msg.id);
      case 'chat':
      case 'poke': {
        const events = office.ingest('generic', { kind: msg.type, session: msg.session || 'office', text: msg.text, from: msg.from, role: msg.role });
        return { ok: true, accepted: events.length };
      }
      case 'command': {
        const ok = command(msg.action, msg);
        return ok ? { ok: true } : { ok: false, error: `comando no disponible: ${msg.action}` };
      }
      default:
        return { ok: false, error: `tipo desconocido: ${msg.type}` };
    }
  }

  // ---------- HTTP ----------

  const info = () => ({ ok: true, name: 'dev-team-office', version: VERSION, pid: process.pid, uptime: Math.round((Date.now() - startedAt) / 1000), url: `http://${host}:${port}`, socket: socketPath });

  const handler = (viaUnix) => async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (!viaUnix) checkBrowserAccess(req, host, port);
      if (req.method === 'GET' && p === '/v1/health') return json(res, 200, info());
      if (req.method === 'GET' && (p === '/v1/state' || p === '/api/state')) return json(res, 200, fullState());
      if (req.method === 'POST' && (p === '/v1/events' || p.startsWith('/v1/events/') || p === '/event' || p.startsWith('/event/'))) {
        const payload = JSON.parse((await readBody(req)) || '{}');
        const fromPath = decodeURIComponent(p.replace(/^\/(v1\/events|event)\/?/, ''));
        const source = fromPath || url.searchParams.get('source') || (!Array.isArray(payload) && payload.source) || 'generic';
        const list = (Array.isArray(payload) ? payload : [payload]).filter((e) => !fromStreamedStage(e));
        const events = list.length ? office.ingest(source, Array.isArray(payload) ? list : list[0]) : [];
        return json(res, 200, { ok: true, accepted: events.length, ids: events.map((e) => e.id) });
      }
      // ⚙ Ajustes
      if (req.method === 'GET' && p === '/v1/settings') {
        return json(res, 200, { office: readOfficeSettings(), projects: pipelines.knownDirs(), harnesses: HARNESS_LIST, pipelineTemplate: PIPELINE_TEMPLATE });
      }
      if (req.method === 'PUT' && p === '/v1/settings') {
        const out = writeOfficeSettings(JSON.parse((await readBody(req)) || '{}'));
        if (out.ok) applyConfig(out.config);
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/settings/project') {
        const dir = url.searchParams.get('dir');
        if (!pipelines.knownDirs().includes(dir)) throw new HttpError(404, 'proyecto desconocido: agrégalo en ⚙ Ajustes › Oficina');
        return json(res, 200, readProjectSettings(dir));
      }
      if (['PUT', 'POST', 'DELETE'].includes(req.method) && (p === '/v1/settings/team' || p === '/v1/settings/pipeline' || p === '/v1/settings/pipeline/check')) {
        const body = JSON.parse((await readBody(req)) || '{}');
        // Sólo se escribe en proyectos que la oficina conoce (no en cualquier ruta).
        if (!pipelines.knownDirs().includes(body.dir)) throw new HttpError(404, 'proyecto desconocido: agrégalo en ⚙ Ajustes › Oficina');
        let out;
        if (p === '/v1/settings/team') out = writeTeam(body.dir, body.team);
        else if (p === '/v1/settings/pipeline/check') out = checkPipeline(body.dir, body.id, body.pipeline);
        else if (req.method === 'DELETE') out = deletePipeline(body.dir, body.id);
        else out = writePipeline(body.dir, body.id, body.pipeline);
        if (out.ok && p !== '/v1/settings/pipeline/check') pipelines.changed();
        return json(res, out.ok || p === '/v1/settings/pipeline/check' ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/projects') return json(res, 200, { projects: pipelines.projects() });
      if (req.method === 'GET' && p === '/v1/project') {
        const project = pipelines.project(url.searchParams.get('dir'));
        return project ? json(res, 200, project) : json(res, 404, { ok: false, error: 'el proyecto no existe' });
      }
      if (req.method === 'GET' && p === '/v1/pipelines') return json(res, 200, pipelines.snapshot());
      if (req.method === 'POST' && p === '/v1/pipelines') {
        const out = pipelines.start(JSON.parse((await readBody(req)) || '{}'));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && /^\/v1\/pipelines\/[^/]+\/cancel$/.test(p)) {
        const out = pipelines.cancel(decodeURIComponent(p.split('/')[3]));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && p === '/v1/tasks') return json(res, 200, hub.snapshot());
      if (req.method === 'POST' && p === '/v1/tasks') {
        const out = hub.submit(JSON.parse((await readBody(req)) || '{}'));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && /^\/v1\/tasks\/[^/]+\/cancel$/.test(p)) {
        const out = hub.cancel(decodeURIComponent(p.split('/')[3]));
        return json(res, out.ok ? 200 : 400, out);
      }
      // Hooks de Claude Code: además de registrar el evento, la respuesta es lo que el hook
      // imprime por stdout. Vacía no cambia nada; en Stop puede entregar una tarea en cola.
      if (req.method === 'POST' && p === '/v1/hooks/claude-code') {
        const payload = JSON.parse((await readBody(req)) || '{}');
        const run = url.searchParams.get('run');
        if (!pipelines.isStreamed(run)) office.ingest('claude-code', payload);
        if (run) hub.linkRun(run, payload.session_id);
        const task = payload.hook_event_name === 'Stop' && payload.session_id ? hub.takeForClaude(payload.session_id) : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(task ? JSON.stringify({
          decision: 'block',
          reason: `Nueva tarea enviada por el usuario desde Dev Team Office. Hazla ahora:\n\n${task.text}`,
        }) : '');
      }
      if (req.method === 'POST' && p === '/v1/messages') {
        const out = handleMessage(JSON.parse((await readBody(req)) || '{}'));
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && p === '/v1/commands') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const out = handleMessage({ ...body, type: 'command' });
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && !p.startsWith('/v1/')) return serveStatic(p, res);
      throw new HttpError(404, 'ruta no encontrada');
    } catch (err) {
      json(res, err.status || 400, { ok: false, error: err.message });
    }
  };

  // ---------- WebSocket ----------
  //
  // cliente → servidor: { type: 'event' | 'chat' | 'poke' | 'command', ..., id? }  (con `id` se responde { type: 'ack', id, ... })
  // servidor → cliente: { type: 'hello' }, { type: 'snapshot', state }, { type: 'event', event, session }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  let connSeq = 0;
  // A los visores les llega todo; a los agentes registrados sólo sus tareas.
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1 && !c.conn?.agent) c.send(data);
  };
  office.on('event', (event, session) => broadcast({ type: 'event', event, session }));
  office.on('reset', () => broadcast({ type: 'snapshot', state: fullState() }));
  hub.on('change', (snap) => broadcast({ type: 'tasks', ...snap }));
  pipelines.on('change', (snap) => broadcast({ type: 'pipelines', ...snap }));
  bus.on('appearance', (a) => broadcast({ type: 'appearance', appearance: a }));

  wss.on('connection', (ws) => {
    const conn = ws.conn = { id: ++connSeq, agent: null, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
    ws.send(JSON.stringify({ type: 'hello', ...info() }));
    ws.send(JSON.stringify({ type: 'snapshot', state: fullState() }));
    ws.on('close', () => hub.unregister(conn.id));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return ws.send(JSON.stringify({ type: 'error', error: 'invalid json' })); }
      const out = handleMessage(msg, conn);
      // `task` usa `id` para su propio id de tarea; el acuse va con `ref`.
      const ref = msg?.type === 'task' || msg?.type === 'pipeline_start' ? msg.ref : msg?.id;
      if (ref !== undefined) ws.send(JSON.stringify({ type: 'ack', id: ref, ...out }));
      else if (!out.ok) ws.send(JSON.stringify({ type: 'error', error: out.error }));
    });
  });

  const onUpgrade = (viaUnix) => (req, sock, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!WS_PATHS.has(pathname)) throw new HttpError(404, 'not found');
      if (!viaUnix) checkBrowserAccess(req, host, port);
    } catch (err) {
      sock.end(`HTTP/1.1 ${err.status || 400} ${err.message}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  };

  // ---------- listeners ----------

  const tcp = http.createServer(handler(false));
  tcp.on('upgrade', onUpgrade(false));
  await new Promise((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(port, host, () => { tcp.off('error', reject); resolve(); });
  });
  port = tcp.address().port; // por si se pidió el 0 (puerto libre cualquiera)
  hub.officeUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;

  let unix = null;
  if (socket) {
    try {
      unix = http.createServer(handler(true));
      unix.on('upgrade', onUpgrade(true));
      await listenUnix(unix, socket);
      socketPath = socket;
    } catch (err) {
      unix = null;
      log(`Socket Unix no disponible (${socket}): ${err.message}`);
    }
  }

  log(`Dev Team Office ${VERSION} en http://${host}:${port}`);
  // Desde el navegador: en un equipo local, localhost y 127.0.0.1 son la misma oficina.
  if (LOOPBACK.has(host)) log(`  Ábrela en el navegador: http://127.0.0.1:${port}  ·  http://localhost:${port}`);
  log(`  API: POST /v1/events/<source> · GET /v1/state · WS /v1/ws${socketPath ? `  ·  socket: ${socketPath}` : ''}`);

  return {
    office,
    hub,
    pipelines,
    bus,
    appearance,
    url: `http://${host}:${port}`,
    socket: socketPath,
    command,
    handleMessage,
    async close() {
      stopDemo?.();
      hub.stopAll();
      pipelines.stopAll();
      for (const c of wss.clients) c.terminate();
      await Promise.all([tcp, unix].filter(Boolean).map((s) => new Promise((r) => s.close(r))));
      if (socketPath) fs.rmSync(socketPath, { force: true });
    },
  };
}

// El socket Unix sólo lo puede abrir tu usuario (0600) y no choca con otros puertos.
async function listenUnix(server, file) {
  // macOS limita la ruta de un socket a 104 bytes (sun_path).
  if (Buffer.byteLength(file) > 103) throw new Error('ruta demasiado larga para un socket Unix (máx. 103 bytes); usa --socket con una más corta');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const alive = await new Promise((resolve) => {
      const c = net.connect(file, () => { c.destroy(); resolve(true); });
      c.on('error', () => resolve(false));
    });
    if (alive) throw new Error('ya hay otra oficina escuchando ahí');
    fs.rmSync(file, { force: true }); // quedó de una ejecución que no cerró bien
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(file, () => { server.off('error', reject); resolve(); });
  });
  fs.chmodSync(file, 0o600);
}

// Un sitio web abierto en tu navegador no debe poder leer ni inyectar eventos en la oficina:
// se rechazan Host ajenos (DNS rebinding) y Origin de otros sitios. Los clientes que no son
// navegadores (curl, hooks, plugins) no mandan Origin y pasan.
function checkBrowserAccess(req, boundHost, port) {
  const hostHeader = req.headers.host || '';
  const hostname = hostHeader.replace(/:\d+$/, '');
  if (LOOPBACK.has(boundHost) && hostname && !LOOPBACK.has(hostname)) throw new HttpError(403, 'host no permitido');
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const o = new URL(origin);
    if (o.host === hostHeader) return; // la propia vista web
    if (LOOPBACK.has(o.hostname) && Number(o.port || 80) === port) return;
  } catch { /* origin inválido */ }
  throw new HttpError(403, 'origen no permitido');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'payload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { ok: false });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}
