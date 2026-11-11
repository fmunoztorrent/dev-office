// Before a brief goes to work: the analyst checks it has everything needed to be done end to end on
// its own. The project's agent reads it (read-only, like a btw: it changes nothing and does not start)
// together with the project's and department's instructions, and answers READY or up to 3 questions
// that only you (the PO) can answer. With questions, the analyst brings them to you; your answers go
// with the brief. Without them (or if the review fails or takes too long), it goes straight to work:
// the point is autonomy, and asking is only for what would change the result.
//
//   review(msg)  → { ok, clarify }   (a 'run' message from the whiteboard, the terminal or the CLI)
//   answer(id, { answers } | { skip: true })
//
// Each clarification: { id, office, target, name, text, status: reviewing | asking | sent | cancelled,
// questions: [..], answers: [..], createdAt }. Its changes are emitted as 'change'.

import { EventEmitter } from 'node:events';
import { spawn as spawnChild } from 'node:child_process';
import { askCommand } from '../integrations/common/devteam.mjs';
import { t, getLanguage, LANGUAGES } from '../public/i18n.js';
import { clip } from './roles.js';
import { childEnv } from './tasks.js';
import { guideFor, guideText, autonomyOf } from './guides.js';
import { contextBlock } from './rag.js';
import { MAIN_OFFICE } from './store.js';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const QUESTIONS_MAX = 3;
let seq = 0;

/** What the reviewer answered: [] (ready) or its questions (lines starting with "Q:" or "P:"). */
export function parseReview(output) {
  const text = String(output || '').replace(ANSI, '').replace(/\r/g, '');
  const questions = text.split('\n').map((l) => l.trim().match(/^(?:[-*\d.)\s]*)(?:Q|P|Pregunta|Question)\s*[:：]\s*(.+)$/i)?.[1]?.trim()).filter(Boolean);
  if (questions.length) return questions.slice(0, QUESTIONS_MAX).map((q) => clip(q, 300));
  return [];
}

/** The brief with what you clarified (or, if you left it to the team, that they decide). */
export function clarified(text, { questions = [], answers = [], skip = false } = {}) {
  if (skip || !questions.length) return skip ? `${text}\n\n${t('clarify.skipped')}` : text;
  const lines = questions.map((q, i) => `- ${t('clarify.q')} ${q}\n  ${t('clarify.a')} ${String(answers[i] || '').trim() || t('clarify.noAnswer')}`);
  return `${text}\n\n${t('clarify.heading')}\n${lines.join('\n')}`;
}

export class ClarifyDesk extends EventEmitter {
  /**
   * @param registry  the agents (server/registry.js): who serves the brief, and run() to send it
   * @param store     instructions and settings
   * @param company   the offices (the analyst's events)
   * @param spawn     for the tests
   */
  constructor({ registry, store, company, spawn = spawnChild, timeoutMs = 120_000 } = {}) {
    super();
    Object.assign(this, { registry, store, company, spawn, timeoutMs });
    this.items = new Map();
  }

  /** Is the review on? (⚙ › General › Autonomy) */
  get enabled() { return this.store?.getPrefs?.().autonomy?.clarify !== false; }
  /** For a department: its own autonomy level, or the company's. */
  enabledFor(office) { return autonomyOf(this.store, office).clarify; }

  list(office) { return [...this.items.values()].filter((c) => !office || c.office === office).map((c) => this.#public(c)); }
  #public(c) { const { msg, ...rest } = c; return { ...rest }; }

  /**
   * A brief for an agent: reviewed first if it should be, otherwise it goes straight to work.
   * Returns what registry.run returns, or { ok, clarify } while it is being reviewed.
   */
  review(msg = {}) {
    const text = String(msg.text ?? '').trim();
    const target = this.registry.targets().find((x) => x.id === msg.target);
    // without text, or for something the registry does not know, it goes as it is (the registry says why)
    if (msg.clarified || !text || !target || !this.enabledFor(target.office)) return this.registry.run(msg);
    const harness = (msg.session && target.sessions?.find((s) => s.session === msg.session)?.agent) || target.harness;
    const guide = [guideText(guideFor(this.store, target.path, target.office)), this.store?.listKnowledge ? contextBlock(this.store, text, { office: target.office, project: target.path }) : ''].filter(Boolean).join('\n');
    const question = [
      t('clarify.promptHead'),
      t('clarify.promptProject', { name: target.name, dir: target.path }),
      guide,
      t('clarify.promptBrief', { text: clip(text, 3000) }),
      t('clarify.promptRules', { lang: LANGUAGES[getLanguage()] || 'English', n: QUESTIONS_MAX }),
    ].filter(Boolean).join('\n\n');
    const cmd = askCommand(harness, { question, bin: target.bin || undefined });
    if (cmd.error) return this.registry.run(msg); // nobody can review it: it goes as it is

    const c = { id: `c${Date.now().toString(36)}${++seq}`, office: target.office || MAIN_OFFICE, target: target.id, name: target.name, text, status: 'reviewing', questions: [], answers: [], createdAt: Date.now(), msg: { ...msg, text } };
    this.items.set(c.id, c);
    while (this.items.size > 30) this.items.delete(this.items.keys().next().value);
    this.#event(c, 'review');
    this.emit('change', this.#public(c));

    let out = '';
    let child;
    const finish = (output) => {
      clearTimeout(timer);
      if (c.status !== 'reviewing') return;
      c.questions = parseReview(output);
      if (!c.questions.length) return this.#send(c);
      c.status = 'asking';
      this.#event(c, 'ask');
      this.emit('change', this.#public(c));
    };
    const timer = setTimeout(() => { try { child?.kill('SIGTERM'); } catch { /* done */ } finish(''); }, this.timeoutMs);
    timer.unref?.();
    try {
      child = this.spawn(cmd.exe, cmd.argv, { cwd: target.path, stdio: ['ignore', 'pipe', 'ignore'], env: childEnv({ DEV_TEAM_OFFICE_BTW: '1', DEV_TEAM_OFFICE_LAUNCHED: '1' }) });
      child.stdout?.on('data', (d) => { if (out.length < 32_000) out += d; });
      child.on('error', () => finish(''));
      child.on('close', (code) => finish(code === 0 ? out : ''));
    } catch { finish(''); }
    return { ok: true, clarify: this.#public(c) };
  }

  /** Your answers to the analyst's questions (or skip: let the team decide). The brief goes to work. */
  answer(id, { answers = [], skip = false } = {}) {
    const c = this.items.get(String(id));
    if (!c) return { ok: false, status: 404, error: t('clarify.unknown') };
    if (c.status !== 'asking') return { ok: false, error: t('clarify.notAsking') };
    c.answers = c.questions.map((_, i) => clip(String(answers[i] ?? ''), 1000));
    return this.#send(c, { skip: !!skip || c.answers.every((a) => !a.trim()) });
  }

  cancel(id) {
    const c = this.items.get(String(id));
    if (!c || !['reviewing', 'asking'].includes(c.status)) return { ok: false, error: t('clarify.notAsking') };
    c.status = 'cancelled';
    this.#event(c, 'cancelled');
    this.emit('change', this.#public(c));
    return { ok: true };
  }

  #send(c, { skip = false } = {}) {
    const text = clarified(c.text, { questions: c.questions, answers: c.answers, skip });
    const out = this.registry.run({ ...c.msg, text, clarified: true });
    c.status = out.ok ? 'sent' : 'failed';
    c.error = out.ok ? null : out.error;
    this.#event(c, out.ok ? 'sent' : 'failed');
    this.emit('change', this.#public(c));
    this.emit('sent', { clarify: this.#public(c), out });
    return { ...out, clarify: this.#public(c) };
  }

  /** The analyst in the game: she reviews the brief, brings you its questions, and hands it over. */
  #event(c, phase) {
    const text = phase === 'ask' ? c.questions.join(' · ') : phase === 'failed' ? c.error || '' : c.text;
    this.company?.ingest('generic', { kind: 'clarify', session: 'office', office: c.office, phase, clarifyId: c.id, text: clip(text, 600), n: c.questions.length, project: c.name });
  }
}
