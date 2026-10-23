// Dependency-free WebSocket (RFC 6455): the office is downloaded and run with Node, without `npm install`.
//
//   Server: new WebSocketServer({ maxPayload }) + handleUpgrade(req, socket, head, cb), like `ws`.
//           Each connection: send(text), close(), terminate(), readyState and the events
//           'message' (text), 'close' and 'error'.
//   Client: connect(url) wraps Node's global WebSocket (≥ 22) with the same shape: on('open'),
//           on('message', text), on('close'), on('error'), send, close and readyState.
//
// Only what the office needs: text frames (and binary ones, delivered as text), fragmentation,
// ping/pong and close. No extensions (permessage-deflate): the browser adapts on its own.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP = { cont: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };
export const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

/** The Sec-WebSocket-Accept value for a Sec-WebSocket-Key. */
export const acceptKey = (key) => crypto.createHash('sha1').update(`${key}${GUID}`).digest('base64');

/** A server frame (unmasked). */
export function frame(opcode, payload = Buffer.alloc(0), fin = true) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const n = data.length;
  const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (n < 126) head[1] = n;
  else if (n < 65536) { head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}

class Connection extends EventEmitter {
  constructor(socket, { maxPayload }) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = OPEN;
    this.buf = Buffer.alloc(0);
    this.parts = null; // fragments of a message in progress
    this.partsLen = 0;
    socket.setNoDelay?.(true);
    socket.on('data', (chunk) => this.#read(chunk));
    socket.on('error', (err) => { this.emit('error', err); this.#closed(); });
    socket.on('close', () => this.#closed());
    socket.on('end', () => this.#closed());
  }

  send(data, cb) {
    if (this.readyState !== OPEN) { cb?.(new Error('not open')); return; }
    this.socket.write(frame(OP.text, Buffer.from(String(data))), cb);
  }

  ping(data = '') { if (this.readyState === OPEN) this.socket.write(frame(OP.ping, Buffer.from(String(data)))); }

  close(code = 1000, reason = '') {
    if (this.readyState >= CLOSING) return;
    this.readyState = CLOSING;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.socket.end(frame(OP.close, body));
    // if the other side does not answer the close, it is cut anyway
    setTimeout(() => this.terminate(), 2000).unref?.();
  }

  terminate() { this.socket.destroy(); this.#closed(); }

  #closed() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit('close');
  }

  #fail(code) { this.close(code); this.buf = Buffer.alloc(0); }

  #read(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.readyState === OPEN || this.readyState === CLOSING) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.#fail(1009);
        len = Number(big); off = 10;
      }
      // the client always masks (RFC 6455 §5.1)
      if (!masked) return this.#fail(1002);
      if (len > this.maxPayload || this.partsLen + len > this.maxPayload) return this.#fail(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.#frame(fin, opcode, payload);
    }
  }

  #frame(fin, opcode, payload) {
    if (opcode === OP.ping) { if (this.readyState === OPEN) this.socket.write(frame(OP.pong, payload)); return; }
    if (opcode === OP.pong) { this.emit('pong', payload); return; }
    if (opcode === OP.close) {
      if (this.readyState === OPEN) {
        this.readyState = CLOSING;
        this.socket.end(frame(OP.close, payload.subarray(0, 2)));
      } else this.socket.end();
      return;
    }
    if (opcode === OP.text || opcode === OP.binary) {
      if (this.parts) return this.#fail(1002); // a new message while another is half-way
      if (fin) { this.emit('message', payload.toString('utf8')); return; }
      this.parts = [payload]; this.partsLen = payload.length;
      return;
    }
    if (opcode === OP.cont) {
      if (!this.parts) return this.#fail(1002);
      this.parts.push(payload); this.partsLen += payload.length;
      if (fin) {
        const all = Buffer.concat(this.parts);
        this.parts = null; this.partsLen = 0;
        this.emit('message', all.toString('utf8'));
      }
      return;
    }
    this.#fail(1002); // opcode reservado
  }
}

export class WebSocketServer extends EventEmitter {
  constructor({ maxPayload = 1 << 20 } = {}) {
    super();
    this.maxPayload = maxPayload;
    this.clients = new Set();
  }

  /** Completes the handshake of a node:http 'upgrade' and hands the connection to cb. */
  handleUpgrade(req, socket, head, cb) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const version = req.headers['sec-websocket-version'];
    if (req.method !== 'GET' || upgrade !== 'websocket' || !key || !/^[A-Za-z0-9+/]{22}==$/.test(key) || (version && version !== '13')) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '', '',
    ].join('\r\n'));
    const ws = new Connection(socket, { maxPayload: this.maxPayload });
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => {}); // a client that drops does not bring the office down
    cb(ws);
    if (head?.length) ws.socket.emit('data', head); // what arrived along with the handshake, now with listeners
  }
}

/**
 * Client: Node's global WebSocket with the shape of `ws` (on/once/send/close/readyState).
 * Messages arrive as text.
 */
export function connect(url) {
  const em = new EventEmitter();
  const sock = new globalThis.WebSocket(url);
  em.on('error', () => {}); // as in `ws`, an error without a listener does not bring the process down
  sock.addEventListener('open', () => em.emit('open'));
  sock.addEventListener('message', (e) => em.emit('message', typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')));
  sock.addEventListener('close', (e) => em.emit('close', e.code, e.reason));
  sock.addEventListener('error', (e) => em.emit('error', e.error || new Error(e.message || 'websocket error')));
  return Object.assign(em, {
    get readyState() { return sock.readyState; },
    send(data, cb) {
      try { sock.send(data); cb?.(); } catch (err) { if (cb) cb(err); else em.emit('error', err); }
    },
    close(code, reason) { try { sock.close(code, reason); } catch { /* already closed */ } },
  });
}
