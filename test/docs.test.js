// The documentation holds together: every relative link and image points to a file that exists (and
// every #anchor to a heading of that file, as GitHub names them), every English document has its
// Spanish version next to it with the same headings, and the docs' index lists every guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f) => path.relative(ROOT, f);
const mdIn = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, dir, f));
const DOCS = [...mdIn('.'), ...mdIn('docs'), ...mdIn('.github'), ...mdIn('.github/ISSUE_TEMPLATE')];
// the root's documents for people, each one in both languages (AGENTS.md and CLAUDE.md are for agents, in Spanish)
const PAIRED_ROOT = ['README', 'CONTRIBUTING', 'SECURITY', 'CODE_OF_CONDUCT', 'SUPPORT'];

/** The text without its code: fenced blocks and inline code are not links. */
const prose = (md) => md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');

/** The anchors GitHub gives a document's headings (github-slugger): lowercase, no punctuation, spaces → hyphens, repeated ones numbered. */
function anchors(md) {
  const seen = new Map();
  const out = new Set();
  // the headings outside code blocks; inline code keeps its text (GitHub drops only the backticks)
  for (const line of md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

/** Every relative link and image of a document: [{ target, anchor }]. */
function links(md) {
  const text = prose(md);
  const out = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/<(?:img|a)\b[^>]*?\s(?:src|href)="([^"]+)"/g)) out.push(m[1]);
  return out.filter((u) => !/^(https?:|mailto:)/.test(u)).map((u) => {
    const [target, anchor = null] = u.split('#');
    return { target: decodeURIComponent(target), anchor: anchor === null ? null : decodeURIComponent(anchor) };
  });
}

test('las anclas son las que arma GitHub', () => {
  assert.deepEqual([...anchors('# Dev Team Office\n## ⚙ Settings\n### What `setup` connects\n## btw: a side question\n## Dimensionar un pedido: su árbol\n## Notes\n## Notes\n```\n# not a heading\n```')],
    ['dev-team-office', '-settings', 'what-setup-connects', 'btw-a-side-question', 'dimensionar-un-pedido-su-árbol', 'notes', 'notes-1']);
});

test('cada enlace e imagen relativos apuntan a un archivo que existe, y cada #ancla a un título de él', () => {
  const broken = [];
  for (const file of DOCS) {
    const md = fs.readFileSync(file, 'utf8');
    for (const { target, anchor } of links(md)) {
      const dest = target ? path.resolve(path.dirname(file), target) : file;
      if (!fs.existsSync(dest)) { broken.push(`${rel(file)} → ${target}`); continue; }
      if (anchor && dest.endsWith('.md') && !anchors(fs.readFileSync(dest, 'utf8')).has(anchor)) broken.push(`${rel(file)} → ${target || ''}#${anchor}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('cada documento en inglés tiene al lado su versión en español, con los mismos títulos', () => {
  const english = [...PAIRED_ROOT.map((n) => path.join(ROOT, `${n}.md`)), ...mdIn('docs').filter((f) => !f.endsWith('.es.md'))];
  for (const en of english) {
    const es = en.replace(/\.md$/, '.es.md');
    assert.ok(fs.existsSync(en), `${rel(en)} is missing`);
    assert.ok(fs.existsSync(es), `${rel(es)} is missing`);
    const levels = (f) => prose(fs.readFileSync(f, 'utf8')).split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.match(/^#+/)[0].length).join('');
    assert.equal(levels(es), levels(en), `${rel(es)} does not follow the headings of ${rel(en)}`);
  }
  for (const es of mdIn('docs').filter((f) => f.endsWith('.es.md'))) assert.ok(fs.existsSync(es.replace(/\.es\.md$/, '.md')), `${rel(es)} has no English version`);
});

test('el índice de docs/ lista cada guía, en cada idioma', () => {
  for (const [index, suffix] of [['docs/README.md', ''], ['docs/README.es.md', '.es']]) {
    const listed = new Set(links(fs.readFileSync(path.join(ROOT, index), 'utf8')).map((l) => l.target));
    const guides = mdIn('docs').map((f) => path.basename(f)).filter((n) => !n.startsWith('README') && (suffix ? n.endsWith('.es.md') : !n.endsWith('.es.md')));
    assert.deepEqual(guides.filter((g) => !listed.has(g)), [], index);
  }
});
