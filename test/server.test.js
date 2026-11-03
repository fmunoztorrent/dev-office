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
