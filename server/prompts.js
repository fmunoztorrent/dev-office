// What an agent is asking you on its screen (a permission, a question, a choice), and the keys that
// answer it from the office.
//
// Inside herdr the office reads each agent's pane (`herdr pane read`). When the bottom of the screen
// shows a selector, it is a question for you, whatever the agent: Claude Code's permissions, Pi's or
// OpenCode's questions, an extension's "Allow?". A selector is a cursor (→ ❯ ›) on one of several
// options, plus the agent's "↑↓ … enter" hint or numbered options. Answering presses the same keys
// you would in that pane: the arrows up to the option, then Enter (or Esc to cancel).
// Outside herdr the office cannot reach the agent's terminal: it only tells you, from the events.

import { EventEmitter } from 'node:events';
import { clip } from './roles.js';

const CURSOR = /^(\s*)([→❯›▸▶➜])\s+(\S.*)$/;
const HINT = /(↑\s*\/?\s*↓|arrow).{0,40}(enter|select)|\benter\b.{0,12}\b(select|confirm|submit|choose)|\besc(ape)?\b.{0,24}\bcancel/i;
const RULE = /^[\s─━═▔▁╭╮╰╯┌┐└┘┏┓┗┛-]{8,}$/; // a separator (or a box's top or bottom border)
const SHELL = /^[\w.-]+@[\w.-]+[\s:].*?[%$#] \S/;   // the shell's prompt that started the agent (user@host dir % claude)
const TAIL = 30;                                // the dialog is at the bottom of the screen

const indent = (l) => l.length - l.trimStart().length;
// a box's side borders become spaces, so the columns of what is inside do not move
const clean = (l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s*[│┃║]\s*$/, '').replace(/^(\s*)[│┃║▎▏]/, '$1 ').replace(/\s+$/, '');

/**
 * The selector at the bottom of a screen, or null:
 *   { question, options: [{ label, detail }], cursor }   (cursor: the option the agent has marked)
 */
export function parsePrompt(screen) {
  const lines = String(screen || '').split('\n').map(clean).slice(-TAIL);
  let hint = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (HINT.test(lines[i])) { hint = i; break; }
  const stop = hint >= 0 ? hint : lines.length;
  let cur = -1;
  for (let i = stop - 1; i >= 0; i--) if (CURSOR.test(lines[i])) { cur = i; break; }
  if (cur < 0) return null;
  const m = CURSOR.exec(lines[cur]);
  const col = lines[cur].indexOf(m[3]);
  const isOption = (i) => i === cur || (indent(lines[i]) === col && lines[i].trim() !== '');
  // the first option: the topmost one above the cursor, without crossing a blank line or a rule
  let first = cur;
  for (let i = cur - 1; i >= 0 && lines[i].trim() && !RULE.test(lines[i]); i--) if (isOption(i)) first = i;
  // the options and what each one says under it, down to a blank line, a rule or the hint
  const options = [];
  for (let i = first; i < stop; i++) {
    const l = lines[i];
    if (!l.trim() || RULE.test(l)) break;
    if (isOption(i)) options.push({ label: i === cur ? m[3] : l.trim(), detail: [], line: i });
    else options.at(-1)?.detail.push(l.trim());
  }
  if (options.length < 2) return null;
  const numbered = options.every((o) => /^\d+[.)]\s/.test(o.label));
  if (hint < 0 && !numbered) return null; // a list without the agent's hint is not a question
  // the question: what is above the options, up to a rule or the shell's prompt (its paragraphs: blank lines between them)
  const question = [];
  const paras = [[]];
  for (let i = first - 1; i >= 0 && !RULE.test(lines[i]) && !SHELL.test(lines[i].trim()) && question.length < 12; i--) {
    if (!lines[i].trim()) { if (paras[0].length) paras.unshift([]); continue; }
    question.unshift(lines[i].trim());
    paras[0].unshift(lines[i].trim());
  }
  const text = paras.filter((x) => x.length).map((x) => x.join(' '));
  return {
    question: question.join('\n').slice(0, 600),
    // in one line: the first paragraph (what it is about) and the last one (what it asks)
    summary: clip(text.length > 1 ? `${text[0]} … ${text.at(-1)}` : text[0] || '', 160),
    options: options.slice(0, 9).map((o) => ({ label: clip(o.label.replace(/^\d+[.)]\s+/, ''), 120), detail: clip(o.detail.join(' '), 240) })),
    cursor: options.findIndex((o) => o.line === cur),
  };
}

/** The keys that choose option `index`: the arrows from the marked one, and Enter (herdr's names). */
export function keysFor(prompt, index) {
  if (!prompt || !Number.isInteger(index) || index < 0 || index >= prompt.options.length) return null;
  const d = index - prompt.cursor;
  return [...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'), 'enter'];
}

/** The same question (the cursor may have moved)? */
export const samePrompt = (a, b) => !!a && !!b && a.question === b.question && a.options.map((o) => o.label).join('\n') === b.options.map((o) => o.label).join('\n');

export class PromptHub extends EventEmitter {
  /**
   * @param herdr     the herdr client: read(pane) and keys(pane, keys)
   * @param officeOf  (pane, cwd) => the office the agent of that pane belongs to
   */
  constructor({ herdr = null, officeOf = () => null, now = () => Date.now() } = {}) {
    super();
    Object.assign(this, { herdr, officeOf, now });
    this.prompts = new Map(); // pane → prompt
    this.rev = 0;             // each new question gets its own: an answer names the one it saw
  }

  /** One herdr round: what each agent pane shows ([{ pane, agent, cwd, text }]). */
  round(screens = []) {
    const seen = new Set();
    const changed = new Set();
    for (const s of screens) {
      seen.add(s.pane);
      const p = parsePrompt(s.text);
      const had = this.prompts.get(s.pane);
      if (!p) { if (had) { this.prompts.delete(s.pane); changed.add(had.office); } continue; }
      if (had && samePrompt(had, p)) { if (had.cursor !== p.cursor) { had.cursor = p.cursor; changed.add(had.office); } continue; }
      const prompt = { id: `q-${s.pane}`, rev: ++this.rev, pane: s.pane, agent: s.agent || null, cwd: s.cwd || null, office: this.officeOf(s.pane, s.cwd), ...p, since: this.now() };
      this.prompts.set(s.pane, prompt);
      changed.add(prompt.office);
      this.emit('new', prompt);
    }
    for (const [pane, p] of this.prompts) if (!seen.has(pane)) { this.prompts.delete(pane); changed.add(p.office); }
    for (const o of changed) this.emit('change', o);
  }

  get(id) { return [...this.prompts.values()].find((p) => p.id === id) || null; }

  /** What the agents of an office are asking (the oldest first). */
  list(office) { return [...this.prompts.values()].filter((p) => !office || p.office === office).sort((a, b) => a.since - b.since); }

  /**
   * Answers in the agent's pane: `option` (its index) or `cancel` (Esc), for the question `rev` you
   * saw. Before pressing anything it reads the screen again: if that question is no longer there,
   * nothing is pressed.
   */
  async answer(id, { rev, option, cancel = false } = {}) {
    const p = this.get(id);
    if (!p) return { ok: false, status: 404 };
    if (rev !== undefined && Number(rev) !== p.rev) return { ok: false, status: 409, reason: 'changed' };
    if (!this.herdr) return { ok: false, status: 409, reason: 'noHerdr' };
    const now = parsePrompt(await this.herdr.read(p.pane));
    if (!samePrompt(now, p)) {
      // it was answered in the pane, or it is another question: the office shows what is there now
      if (now) this.prompts.set(p.pane, { ...p, ...now, rev: ++this.rev, since: this.now() });
      else this.prompts.delete(p.pane);
      this.emit('change', p.office);
      return { ok: false, status: 409, reason: 'changed' };
    }
    const keys = cancel ? ['esc'] : keysFor(now, Number(option));
    if (!keys) return { ok: false, status: 400, reason: 'option' };
    await this.herdr.keys(p.pane, keys);
    this.prompts.delete(p.pane);
    this.emit('change', p.office);
    return { ok: true, pane: p.pane, keys, answer: cancel ? null : now.options[Number(option)].label };
  }
}
