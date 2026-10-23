// Our own WebSocket (server/ws.js): the office does not depend on `ws`. The test client is Node's
// global WebSocket (a standards-compliant client), plus hand-built frames for fragmentation, ping
// and large sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { WebSocketServer, connect, acceptKey } from '../server/ws.js';

async function serve(onConn, opts) {
  const wss = new WebSocketServer(opts);
  const srv = http.createServer();
  srv.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => onConn(ws)));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  return { wss, port, close: () => { for (const c of wss.clients) c.terminate(); return new Promise((r) => srv.close(r)); } };
}

const clientFrame = (opcode, payload, fin = true) => {
  const data = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  const n = data.length;
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | n]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, n >> 8, n & 255]);
  const body = Buffer.from(data.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([head, mask, body]);
};

async function rawClient(port) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(`GET /v1/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
  const until = async (fn) => { for (let i = 0; i < 200; i++) { if (fn(buf)) return buf; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); };
  await until((b) => b.includes('\r\n\r\n'));
  const headers = buf.toString('latin1');
  assert.match(headers, /101 Switching Protocols/);
  assert.ok(headers.includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`));
  buf = buf.subarray(buf.indexOf('\r\n\r\n') + 4);
  return { sock, until, get buf() { return buf; }, reset() { buf = Buffer.alloc(0); } };
}

test('el cliente estándar conversa con el servidor: texto en las dos direcciones, grande y chico', async () => {
  const got = [];
  const s = await serve((ws) => {
    ws.send(JSON.stringify({ type: 'hello' }));
    ws.on('message', (m) => { got.push(m); ws.send(`eco:${m.length}`); });
  });
  try {
    const ws = connect(`ws://127.0.0.1:${s.port}/v1/ws`);
    const msgs = [];
    ws.on('message', (m) => msgs.push(m));
    await new Promise((r) => ws.on('open', r));
    const big = 'x'.repeat(200_000); // 64-bit length
    const mid = 'ñ'.repeat(40_000); // 16 bits and UTF-8
    ws.send('hola');
    ws.send(mid);
    ws.send(big);
    for (let i = 0; i < 200 && msgs.length < 4; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(got, ['hola', mid, big]);
    assert.deepEqual(msgs, ['{"type":"hello"}', 'eco:4', `eco:${mid.length}`, `eco:${big.length}`]);
    const closed = new Promise((r) => ws.on('close', r));
    ws.close();
    await closed;
    for (let i = 0; i < 50 && s.wss.clients.size; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(s.wss.clients.size, 0, 'el servidor suelta la conexión cerrada');
  } finally { await s.close(); }
});

test('fragmentos, ping/pong, mensajes del handshake y payload demasiado grande', async () => {
  const got = [];
  const s = await serve((ws) => ws.on('message', (m) => got.push(m)), { maxPayload: 1000 });
  try {
    const c = await rawClient(s.port);
    c.sock.write(Buffer.concat([clientFrame(0x1, 'hol', false), clientFrame(0x0, 'a ', false), clientFrame(0x0, 'mundo')]));
    c.sock.write(clientFrame(0x9, 'pi'));
    await c.until((b) => b.length >= 4);
    assert.equal(c.buf[0], 0x8a, 'pong con FIN');
    assert.equal(c.buf.subarray(2, 4).toString(), 'pi');
    assert.deepEqual(got, ['hola mundo']);
    // an unmasked frame is a protocol error: close 1002
    c.reset();
    c.sock.write(Buffer.from([0x81, 0x02, 0x6f, 0x6b]));
    await c.until((b) => b.length >= 4);
    assert.equal(c.buf[0], 0x88);
    assert.equal(c.buf.readUInt16BE(2), 1002);
    c.sock.destroy();

    const d = await rawClient(s.port);
    d.sock.write(clientFrame(0x1, 'y'.repeat(2000)));
    await d.until((b) => b.length >= 4);
    assert.equal(d.buf.readUInt16BE(2), 1009, 'demasiado grande');
    d.sock.destroy();
  } finally { await s.close(); }
});

test('un upgrade sin clave válida se rechaza con 400', async () => {
  const s = await serve(() => assert.fail('no debería conectar'));
  try {
    const res = await new Promise((resolve) => {
      const sock = net.connect(s.port, '127.0.0.1', () => sock.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
      let out = '';
      sock.on('data', (d) => { out += d; });
      sock.on('close', () => resolve(out));
    });
    assert.match(res, /400 Bad Request/);
  } finally { await s.close(); }
});
