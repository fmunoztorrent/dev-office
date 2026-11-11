// Cuts a document's readable text into the chunks the archive indexes (server/rag.js): by its
// Markdown headings and paragraphs, about 1000 characters each with a little overlap, and each one
// keeps the path of headings it is under ("Returns › Deadlines") so it still makes sense on its own.

const TARGET = 1000;  // characters per chunk, roughly
const OVERLAP = 150;  // what a chunk repeats of the previous one (when a section is cut in several)
const HARD_MAX = 1600;

/** [{ heading, text }]: the chunks of `body` (the title is the first heading when there is none). */
export function chunkText(body, title = '') {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const path = [];
  const sections = []; // { heading, text }
  let cur = { heading: '', lines: [] };
  const flush = () => { const text = cur.lines.join('\n').trim(); if (text) sections.push({ heading: cur.heading, text }); };
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = h[2].trim();
      cur = { heading: path.filter(Boolean).join(' › '), lines: [] };
    } else cur.lines.push(line);
  }
  flush();
  if (!sections.length && String(title).trim()) return [{ heading: '', text: String(title).trim() }];

  const out = [];
  for (const sec of sections) {
    if (sec.text.length <= TARGET * 1.3) { out.push(sec); continue; }
    // a long section: by paragraphs (and a very long paragraph, by sentences), with overlap
    const parts = sec.text.split(/\n{2,}/).flatMap((p) => (p.length > HARD_MAX ? p.match(/[^.!?\n]+[.!?]*\s*|\n/g) || [p] : [p]));
    let buf = '';
    for (const p of parts) {
      if (buf && buf.length + p.length + 2 > TARGET) {
        out.push({ heading: sec.heading, text: buf.trim() });
        buf = `${tail(buf)} ${p}`;
      } else buf = buf ? `${buf}\n\n${p}` : p;
      while (buf.length > HARD_MAX) { out.push({ heading: sec.heading, text: buf.slice(0, TARGET).trim() }); buf = buf.slice(TARGET - OVERLAP); }
    }
    if (buf.trim()) out.push({ heading: sec.heading, text: buf.trim() });
  }
  return out;
}

/** The end of a chunk to start the next one with (from a word boundary). */
function tail(text) {
  const t = text.slice(-OVERLAP);
  const i = t.indexOf(' ');
  return (i > 0 ? t.slice(i + 1) : t).trim();
}
