// Loading documents into the archive: their readable text (what you read in the archive, and what is
// cut into chunks and indexed). No dependencies:
//   - Markdown, text, CSV, JSON, YAML, code: as they are.
//   - HTML (a file or a URL): to readable text, its headings as Markdown headings.
//   - PDF and Word (.docx, .odt, .rtf, .epub): with `pdftotext` or `pandoc` if the machine has them;
//     otherwise it says so (an agent can convert it: ✨ Ask an agent).
//
// fromFile({ name, text?, base64? }) and fromUrl(url) → { ok, title, text, origin } or { ok: false, code, error }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { which } from '../integrations/common/devteam.mjs';
import { t } from '../public/i18n.js';

const MAX = 5 * 1024 * 1024; // what is read of a file or a page
const TEXT = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'log', 'ini', 'toml', 'sql', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'php', 'sh', 'css', 'scss', 'graphql', 'proto']);
const HTML = new Set(['html', 'htm']);
const PANDOC = new Set(['docx', 'odt', 'rtf', 'epub']);
const fail = (code, vars) => ({ ok: false, code, error: t(`ingest.${code}`, vars) });
const ext = (name) => String(name || '').toLowerCase().split('.').pop();
const titleOf = (name) => path.basename(String(name || ''), path.extname(String(name || ''))).replace(/[-_]+/g, ' ').trim();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };
/** HTML → readable text: its headings as Markdown ones, its lists as "- ", without scripts or styles. */
export function htmlToText(html) {
  let s = String(html || '');
  const title = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, x) => `\n\n${'#'.repeat(Number(n))} ${x.replace(/<[^>]+>/g, '').trim()}\n\n`);
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|pre)>/gi, '\n\n').replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
  s = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: title.replace(/\s+/g, ' '), text: s };
}

/** A binary document to text with an external converter (null if it is not installed or fails). */
function convert(buffer, kind) {
  const tool = kind === 'pdf' ? which('pdftotext') : which('pandoc');
  if (!tool) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-ingest-'));
  try {
    const src = path.join(dir, `doc.${kind}`);
    fs.writeFileSync(src, buffer);
    const r = kind === 'pdf'
      ? spawnSync(tool, ['-layout', '-enc', 'UTF-8', src, '-'], { encoding: 'utf8', timeout: 60_000, maxBuffer: MAX * 2 })
      : spawnSync(tool, [src, '-t', 'gfm', '--wrap=none'], { encoding: 'utf8', timeout: 60_000, maxBuffer: MAX * 2 });
    return r.status === 0 ? String(r.stdout || '').replace(/\f/g, '\n\n').trim() : null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** A file you loaded: its readable text. `text` for text formats, `base64` for the rest. */
export function fromFile({ name, text, base64 } = {}) {
  const e = ext(name);
  const buf = base64 !== undefined ? Buffer.from(String(base64), 'base64') : Buffer.from(String(text ?? ''), 'utf8');
  if (buf.length > MAX) return fail('tooBig', { mb: MAX / 1024 / 1024 });
  let out;
  if (TEXT.has(e) || (!e && text !== undefined)) { const s = buf.toString('utf8'); out = { title: s.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1] || titleOf(name), text: s }; }
  else if (HTML.has(e)) { const h = htmlToText(buf.toString('utf8')); out = { title: h.title || titleOf(name), text: h.text }; }
  else if (e === 'pdf' || PANDOC.has(e)) {
    const converted = convert(buf, e);
    if (converted === null) return fail('convert', { tool: e === 'pdf' ? 'pdftotext (poppler)' : 'pandoc', name });
    out = { title: titleOf(name), text: converted };
  } else return fail('format', { ext: e || '?' });
  if (!out.text.trim()) return fail('empty', { name });
  return { ok: true, title: out.title || name, text: out.text, origin: String(name || '').slice(0, 300) };
}

/** A web page (or a document by its URL): downloaded and turned into readable text. */
export async function fromUrl(url, { fetch: fetchFn = globalThis.fetch } = {}) {
  if (!/^https?:\/\/[^\s]+$/i.test(String(url || ''))) return fail('url');
  let r;
  try { r = await fetchFn(url, { signal: AbortSignal.timeout?.(20_000), headers: { 'user-agent': 'dev-team-office' } }); } catch (err) { return fail('fetch', { error: err.message }); }
  if (!r.ok) return fail('fetch', { error: `HTTP ${r.status}` });
  const type = String(r.headers.get('content-type') || '');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) return fail('tooBig', { mb: MAX / 1024 / 1024 });
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || new URL(url).hostname;
  if (/pdf/.test(type) || ext(name) === 'pdf') { const out = fromFile({ name: name.endsWith('.pdf') ? name : `${name}.pdf`, base64: buf.toString('base64') }); return out.ok ? { ...out, origin: url } : out; }
  if (/html/.test(type) || HTML.has(ext(name))) {
    const h = htmlToText(buf.toString('utf8'));
    return h.text ? { ok: true, title: h.title || name, text: h.text, origin: url } : fail('empty', { name: url });
  }
  const text = buf.toString('utf8');
  return text.trim() ? { ok: true, title: titleOf(name) || url, text, origin: url } : fail('empty', { name: url });
}
