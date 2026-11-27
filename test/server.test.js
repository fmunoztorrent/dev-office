// Regression test: server.close() shuts open HTTP connections instead of hanging on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer } from '../server/server.js';

test('el cierre no se cuelga con una conexión TCP abierta (keep-alive del navegador)', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const { hostname, port } = new URL(server.url);
  // A raw idle socket, like a browser's keep-alive: no HTTP request, never closed by the client.
  const socket = net.connect(Number(port), hostname);
  let closed = false;
  try {
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    const start = Date.now();
    await server.close(); // must not wait for the open socket forever
    closed = true;
    assert.ok(Date.now() - start < 2000, `close() tardó ${Date.now() - start} ms con la conexión abierta`);
  } finally {
    socket.destroy();
    if (!closed) await server.close(); // idempotent: a second close must not hang either
  }
});

test('una página del navegador que no dice `client` (cargada de una oficina vieja) recibe el aviso de recargar; una nueva o un cliente de Node, no', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, outdatedAfter: 150 });
  const port = new URL(server.url).port;
  const listen = (headers, hello) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { headers });
    const got = [];
    ws.onopen = () => { if (hello) ws.send(JSON.stringify({ type: 'client', app: 'web' })); };
    ws.onmessage = (m) => got.push(JSON.parse(m.data));
    setTimeout(() => { ws.close(); resolve(got.filter((x) => x.type === 'error')); }, 500);
  });
  try {
    const origin = { origin: `http://127.0.0.1:${port}` };
    const [old, fresh, node] = await Promise.all([listen(origin, false), listen(origin, true), listen({}, false)]);
    assert.equal(old.length, 1);
    assert.match(old[0].error, /reload this page/);
    assert.deepEqual(fresh, []);
    assert.deepEqual(node, []);
  } finally {
    await server.close();
  }
});

test('una segunda demo mientras corre otra dice que ya hay una (no «comando no disponible»); terminada, se puede pedir otra', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const post = (action) => fetch(`${server.url}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, speed: 50 }) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    assert.equal((await post('demo')).ok, true);
    const again = await post('demo');
    assert.equal(again.status, 400);
    assert.match(again.error, /demo is already running/);
    assert.doesNotMatch(again.error, /not available/);
    assert.equal((await post('stop-demo')).ok, true);
    assert.equal((await post('demo')).ok, true);
    assert.match((await post('nope')).error, /command not available: nope/);
    await post('stop-demo');
  } finally {
    await server.close();
  }
});

test('la oficina dice qué agentes instalados no están conectados: en el arranque, en /v1/health y en el hello del juego', async () => {
  const lines = [];
  const gaps = [{ id: 'claude-code', label: 'Claude Code', fix: 'dev-team-office setup --only claude-code' }];
  let calls = 0;
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, log: (m) => lines.push(m), integrations: () => { calls++; return gaps; } });
  try {
    assert.ok(lines.some((l) => l.includes('Claude Code') && l.includes('dev-team-office setup --only claude-code')), lines.join('\n'));
    const health = await (await fetch(`${server.url}/v1/health`)).json();
    assert.deepEqual(health.unconnected, gaps);
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}/v1/ws`);
    const hello = await new Promise((resolve, reject) => { ws.onmessage = (e) => resolve(JSON.parse(e.data)); ws.onerror = reject; });
    ws.close();
    assert.deepEqual([hello.type, hello.unconnected], ['hello', gaps]);
    assert.equal(calls, 1, 'se mira a lo más cada 30 s, no en cada pedido');
  } finally { await server.close(); }

  // the tests (and any office that does not pass `integrations`) never look at your HOME
  const plain = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  try { assert.deepEqual((await (await fetch(`${plain.url}/v1/health`)).json()).unconnected, []); } finally { await plain.close(); }
});
