// A small ZIP reader, with no dependencies (node:zlib inflates): enough to open a Playwright trace
// (trace.zip) and take its frames and its events. Stored and deflated entries; no encryption, no ZIP64.

import zlib from 'node:zlib';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** The entries of a ZIP buffer: Map(name → { method, size, compressed, offset }). Throws if it is not a ZIP. */
export function zipEntries(buf) {
  // the end of the central directory: in the last 64 KB (its comment may be up to that long)
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === EOCD) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    out.set(name, { method, size, compressed, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** An entry's content (a Buffer), or null if it is not there. */
export function zipRead(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (buf.readUInt32LE(e.offset) !== LOCAL) throw new Error('bad zip entry');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.compressed);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`zip method ${e.method}`);
}
