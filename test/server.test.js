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
