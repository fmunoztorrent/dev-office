// Side questions ("btw"): from the game (or `dev-team-office btw "…"`) you ask the agent on duty
// something about the domain, the team or the office — in practice they are the same — without
// interrupting its work. It is Claude Code's /btw brought to every harness:
//
//   1. the office's agent on duty: the session that worked most recently (its CLI and its folder)
//      or, if there is none, the office's registered agent;
//   2. its CLI answers in a forked session that is not saved (claude --fork-session, opencode
//      --fork, pi --fork) or, if it cannot fork, in a new one with what the team is doing;
//      always read-only;
//   3. the question and the answer show up in the game (a character answers it) and in the log,
//      and are saved in the database (asks table).

import { EventEmitter } from 'node:events';
import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs';
import { askCommand } from '../integrations/common/devteam.mjs';
import { t, getLanguage, LANGUAGES } from '../public/i18n.js';
import { clip } from './roles.js';
import { MAIN_OFFICE } from './store.js';
import { realDir } from './paths.js';
import { childEnv } from './tasks.js';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const SOURCE_HARNESS = { 'claude-code': 'claude-code', claude: 'claude-code', codex: 'codex', opencode: 'opencode', pi: 'pi' };
const FORKABLE = new Set(['claude-code', 'opencode']); // the ones that expose a session id their CLI understands
const ANSWER_MAX = 1500;
const RECENT_MS = 12 * 3600_000;
let seq = 0;

export class AskDesk extends EventEmitter {
  /**
   * @param company  the offices (server/company.js)
   * @param store    the database (asks)
   * @param spawn    for the tests: (exe, argv, opts) → ChildProcess
   */
  constructor({ company, store, spawn = spawnChild, timeoutMs = 180_000, officeUrl = () => null } = {}) {
    super();
    this.company = company;
    this.store = store;
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.officeUrl = officeUrl;
    this.running = new Map(); // oficina → pregunta en curso
  }

  /** An office's agent on duty: { harness, session?, cwd, agentId?, name } | null */
  onDuty(officeId) {
    const office = this.company.get(officeId);
    let best = null;
    for (const s of office?.sessions?.values() || []) {
      const harness = SOURCE_HARNESS[s.source];
      if (s.id === 'office' || !harness || !s.cwd || Date.now() - s.lastAt > RECENT_MS) continue;
      if (!best || s.lastAt > best.lastAt) best = s;
    }
    if (best) {
      const harness = SOURCE_HARNESS[best.source];
      const agent = this.store.listAgents().find((a) => a.harness === harness && realDir(a.path) === realDir(best.cwd));
      return { harness, session: FORKABLE.has(harness) ? best.id : null, cwd: best.cwd, agentId: agent?.id || null, bin: agent?.bin, turn: best.turn, title: best.title, name: agent?.name || null };
    }
    const agents = this.store.listAgents().filter((a) => (a.office || MAIN_OFFICE) === officeId && fs.existsSync(a.path));
    const a = agents[0];
    return a ? { harness: a.harness, session: null, cwd: a.path, agentId: a.id, bin: a.bin, turn: null, title: '', name: a.name } : null;
  }

  /** What the team is doing, in a few lines, so a new session has context. */
  #context(officeId, duty) {
    const info = this.company.info(officeId);
    const office = this.company.get(officeId);
    const lines = [t('btw.ctxOffice', { office: info?.name || officeId })];
    if (duty.title) lines.push(t('btw.ctxTask', { task: clip(duty.title, 200) }));
    if (duty.turn) lines.push(t('btw.ctxTurn', { role: t(`team.titles.${duty.turn}`) }));
    const recent = (office?.log || []).filter((e) => e.text && e.session !== 'office').slice(-8).map((e) => `- ${clip(e.text, 120)}`);
    if (recent.length) lines.push(t('btw.ctxRecent'), ...recent);
    return lines.join('\n');
  }

  #prompt(question, officeId, duty) {
    return [
      t('btw.promptHead'),
      duty.session ? '' : this.#context(officeId, duty),
      t('btw.promptQuestion', { question }),
      t('btw.promptRules', { lang: LANGUAGES[getLanguage()] || 'English' }),
    ].filter(Boolean).join('\n\n');
  }

  #emit(officeId, phase, ask, role, text) {
    this.company.ingest('generic', { kind: 'btw', session: 'office', office: officeId, phase, role, askId: ask.id, agent: ask.agent, from: ask.from, text });
  }

  list(office, limit = 20) { return this.store.listAsks({ office, limit }); }

  /**
   * Asks the question. Returns right away { ok, ask } (the answer arrives later, via 'change' and
   * the office's events); `done` is a promise that resolves with the answered question.
   */
  ask({ text, office = MAIN_OFFICE, from } = {}) {
    const question = String(text ?? '').trim().replace(/^\/?btw\b[:,]?\s*/i, '').trim();
    if (!question) return { ok: false, error: t('btw.empty') };
    const officeId = this.company.has(office) ? office : MAIN_OFFICE;
    if (this.running.has(officeId)) return { ok: false, error: t('btw.busy') };
    const duty = this.onDuty(officeId);
    if (!duty) return { ok: false, error: t('btw.noAgent') };
    const cmd = askCommand(duty.harness, { question: this.#prompt(clip(question, 600), officeId, duty), session: duty.session, bin: duty.bin });
    if (cmd.error) return { ok: false, error: cmd.code === 'missing' ? t('err.notInstalled', { bin: cmd.bin }) : cmd.error };

    const role = duty.turn || 'po';
    const ask = {
      id: `btw-${Date.now().toString(36)}-${++seq}`, office: officeId, agent: duty.harness, agentId: duty.agentId, session: duty.session, cwd: duty.cwd,
      question: clip(question, 600), answer: null, status: 'asking', error: null, from: clip(from || t('events.you'), 30), forked: !!cmd.forked, role, createdAt: Date.now(),
    };
    this.running.set(officeId, ask);
    this.store.saveAsk(ask);
    this.#emit(officeId, 'ask', ask, role, ask.question);
    this.emit('change', ask);

    const done = new Promise((resolve) => {
      let out = '';
      let err = '';
      let child;
      const finish = (status, answer, error) => {
        if (ask.status !== 'asking') return;
        clearTimeout(timer);
        Object.assign(ask, { status, answer: answer ? clip(answer, ANSWER_MAX) : null, error: error ? clip(error, 300) : null, updatedAt: Date.now() });
        this.running.delete(officeId);
        this.store.saveAsk(ask);
        if (status === 'answered') this.#emit(officeId, 'answer', ask, role, ask.answer);
        else this.#emit(officeId, 'failed', ask, role, ask.error);
        this.emit('change', ask);
        resolve(ask);
      };
      const timer = setTimeout(() => { try { child?.kill('SIGTERM'); } catch { /* already finished */ } finish('failed', null, t('btw.timeout')); }, this.timeoutMs);
      timer.unref?.();
      try {
        const url = this.officeUrl();
        child = this.spawn(cmd.exe, cmd.argv, {
          cwd: duty.cwd, stdio: ['ignore', 'pipe', 'pipe'],
          env: childEnv({ DEV_TEAM_OFFICE_BTW: '1', DEV_TEAM_OFFICE_LAUNCHED: '1', ...(url ? { DEV_TEAM_OFFICE_URL: url } : {}) }),
        });
      } catch (e) { finish('failed', null, e.message); return; }
      child.stdout?.on('data', (d) => { if (out.length < 64_000) out += d; });
      child.stderr?.on('data', (d) => { if (err.length < 8000) err += d; });
      child.on('error', (e) => finish('failed', null, e.message));
      child.on('close', (code) => {
        const answer = out.replace(ANSI, '').replace(/\r/g, '').trim();
        if (code === 0 && answer) finish('answered', answer);
        else finish('failed', null, err.replace(ANSI, '').trim().split('\n').filter(Boolean).slice(-3).join(' · ') || t('btw.noAnswer', { code }));
      });
    });
    return { ok: true, ask, done };
  }
}

