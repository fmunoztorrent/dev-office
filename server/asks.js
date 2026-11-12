// Side questions ("btw"): from the game (or `dev-team-office btw "…"`) you ask the agent on duty
// something about the domain, the team or the office — in practice they are the same — without
// interrupting its work. It is Claude Code's /btw brought to every harness:
//
//   1. who answers: the session you chose, or the one the character you asked is working in (its
//      project and its task), or else the office's agent on duty: the session that worked most
//      recently (its CLI and its folder) or, if there is none, the office's registered agent;
//   2. its CLI answers in a forked session that is not saved (claude --fork-session, opencode
//      --fork, pi --fork) or, if it cannot fork, in a new one with what that session is doing
//      (its project, its task, its plan, its latest steps); always read-only, and as the
//      character asked;
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
import { defaultLook } from '../public/sim.js';
import { guideFor, guideText } from './guides.js';
import { contextBlock } from './rag.js';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const SOURCE_HARNESS = { 'claude-code': 'claude-code', claude: 'claude-code', codex: 'codex', opencode: 'opencode', pi: 'pi' };
const FORKABLE = new Set(['claude-code', 'opencode']); // the ones that expose a session id their CLI understands
const ANSWER_MAX = 4000; // an explanatory or teacher answer is longer
const RECENT_MS = 12 * 3600_000;
let seq = 0;

export class AskDesk extends EventEmitter {
  #subs;
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
    this.#subs = new Map();   // question → the newcomer (subagent) asked, who answers it in the game
  }

  /**
   * Who answers in an office: { harness, session?, sessionId, cwd, agentId?, name } | null.
   * `session`: the one chosen; `role`: the character asked, answered from the session it is working
   * in (or the latest one where it did something). Without either, the agent on duty.
   */
  onDuty(officeId, { session, role } = {}) {
    const office = this.company.get(officeId);
    const usable = (s) => !!s && s.id !== 'office' && !!SOURCE_HARNESS[s.source] && !!s.cwd;
    let best = session ? office?.sessions?.get(session) : null;
    if (!usable(best) && role) {
      best = office?.sessions?.get(office.roles?.[role]?.session);
      if (!usable(best)) {
        const ev = [...(office?.log || [])].reverse().find((e) => e.role === role && e.kind !== 'btw' && usable(office.sessions.get(e.session)));
        best = ev ? office.sessions.get(ev.session) : null;
      }
    }
    if (!usable(best)) {
      best = null;
      for (const s of office?.sessions?.values() || []) {
        if (!usable(s) || Date.now() - s.lastAt > RECENT_MS) continue;
        if (!best || s.lastAt > best.lastAt) best = s;
      }
    }
    if (best) {
      const harness = SOURCE_HARNESS[best.source];
      const agent = this.store.listAgents().find((a) => a.harness === harness && realDir(a.path) === realDir(best.cwd));
      return { harness, session: FORKABLE.has(harness) ? best.id : null, sessionId: best.id, cwd: best.cwd, agentId: agent?.id || null, bin: agent?.bin, turn: best.turn, title: best.title, name: agent?.name || null };
    }
    const agents = this.store.listAgents().filter((a) => (a.office || MAIN_OFFICE) === officeId && fs.existsSync(a.path));
    const a = agents[0];
    return a ? { harness: a.harness, session: null, sessionId: null, cwd: a.path, agentId: a.id, bin: a.bin, turn: null, title: '', name: a.name } : null;
  }

  /** The character asked, with the office's names and their way of being: "Diego (Backend, focused)". */
  #who(officeId, role) {
    const look = this.store.getAppearance?.(officeId)?.[role] || {};
    const g = look.sex || defaultLook(role)?.sex;
    const way = look.personality || defaultLook(role)?.personality;
    const title = look.title || t(`team.titles.${role}`, { g });
    return `${look.name || defaultLook(role)?.name || role} (${[title, way && t(`settings.look.traits.${way}`, { g })].filter(Boolean).join(', ')})`;
  }

  /**
   * What the answer is about: the project and, when its CLI cannot fork the session (it does not
   * know what it was doing), the session's task, plan, subagents and latest steps.
   */
  #context(officeId, duty, role, forked) {
    const info = this.company.info(officeId);
    const office = this.company.get(officeId);
    const s = duty.sessionId ? office?.sessions?.get(duty.sessionId) : null;
    const lines = [t('btw.ctxOffice', { office: info?.name || officeId })];
    if (duty.cwd) lines.push(t('btw.ctxProject', { project: duty.cwd.split('/').filter(Boolean).pop() || duty.cwd, dir: duty.cwd }));
    if (role) lines.push(t('btw.ctxRole', { who: this.#who(officeId, role) }));
    // how to work with this project and its department (their instructions)
    const guide = guideText(guideFor(this.store, duty.cwd, officeId));
    if (guide) lines.push(guide);
    // what the archive knows about the question (with its ids, to cite them)
    const archive = this.store?.listKnowledge ? contextBlock(this.store, this.#question || '', { office: officeId, project: duty.cwd || null }) : '';
    if (archive) lines.push(archive);
    if (forked) return lines.join('\n');
    if (duty.title) lines.push(t('btw.ctxTask', { task: clip(duty.title, 200) }));
    if (duty.turn) lines.push(t('btw.ctxTurn', { role: t(`team.titles.${duty.turn}`) }));
    const todos = (s?.todos || []).slice(0, 12);
    if (todos.length) lines.push(t('btw.ctxPlan'), ...todos.map((x) => `- [${x.status === 'completed' ? 'x' : x.status === 'in_progress' ? '~' : ' '}] ${clip(x.content || x.text || '', 120)}`));
    const subs = (s?.subagents || []).filter((x) => x.open && (!role || x.role === role));
    if (subs.length) lines.push(t('btw.ctxSubagents'), ...subs.slice(0, 5).map((x) => `- ${clip(x.desc || x.agentType || '', 120)}${x.task ? `: ${clip(x.task.replace(/\s+/g, ' '), 200)}` : ''}`));
    // its latest steps (the character's, if it did any): not those of other projects
    const mine = (office?.log || []).filter((e) => e.text && e.kind !== 'btw' && (!s || e.session === s.id));
    const own = role ? mine.filter((e) => e.role === role) : [];
    const recent = (own.length >= 3 ? own : mine).slice(-8).map((e) => `- ${clip(e.text, 120)}`);
    if (recent.length) lines.push(t('btw.ctxRecent'), ...recent);
    return lines.join('\n');
  }

  /** How the character asked answers (⚙ › Characters › Style): normal, concise, explanatory, teacher or formal. */
  #style(officeId, role) {
    const style = (role && (this.store.getAppearance?.(officeId)?.[role]?.style || defaultLook(role)?.style)) || 'normal';
    return style === 'normal' ? 'promptRules' : `rules.${style}`;
  }

  #question = '';
  #prompt(question, officeId, duty, role, forked) {
    this.#question = question;
    return [
      t('btw.promptHead'),
      this.#context(officeId, duty, role, forked),
      t('btw.promptQuestion', { question }),
      t(`btw.${this.#style(officeId, role)}`, { lang: LANGUAGES[getLanguage()] || 'English' }),
    ].filter(Boolean).join('\n\n');
  }

  #emit(officeId, phase, ask, role, text) {
    this.company.ingest('generic', { kind: 'btw', session: 'office', office: officeId, phase, role, askId: ask.id, agent: ask.agent, from: ask.from, text, ...(this.#subs.get(ask.id) ? { subId: this.#subs.get(ask.id) } : {}) });
  }

  list(office, limit = 20) { return this.store.listAsks({ office, limit }); }

  /**
   * Asks the question. Returns right away { ok, ask } (the answer arrives later, via 'change' and
   * the office's events); `done` is a promise that resolves with the answered question.
   */
  ask({ text, office = MAIN_OFFICE, from, session, role, subId } = {}) {
    const question = String(text ?? '').trim().replace(/^\/?btw\b[:,]?\s*/i, '').trim();
    if (!question) return { ok: false, error: t('btw.empty') };
    const officeId = this.company.has(office) ? office : MAIN_OFFICE;
    if (this.running.has(officeId)) return { ok: false, error: t('btw.busy') };
    const asked = defaultLook(role) && role !== 'po' ? role : null; // you are the PO: you do not ask yourself
    const duty = this.onDuty(officeId, { session: typeof session === 'string' ? session : undefined, role: asked });
    if (!duty) return { ok: false, error: t('btw.noAgent') };
    const prompt = (forked) => this.#prompt(clip(question, 600), officeId, duty, asked, forked);
    let cmd = askCommand(duty.harness, { question: prompt(true), session: duty.session, bin: duty.bin });
    if (!cmd.error && !cmd.forked) cmd = askCommand(duty.harness, { question: prompt(false), session: duty.session, bin: duty.bin });
    if (cmd.error) return { ok: false, error: cmd.code === 'missing' ? t('err.notInstalled', { bin: cmd.bin }) : cmd.error };

    role = asked || duty.turn || 'tl'; // who answers you (you, the PO, are the one asking)
    const ask = {
      id: `btw-${Date.now().toString(36)}-${++seq}`, office: officeId, agent: duty.harness, agentId: duty.agentId, session: duty.session, cwd: duty.cwd,
      question: clip(question, 600), answer: null, status: 'asking', error: null, from: clip(from || t('events.you'), 30), forked: !!cmd.forked, role, createdAt: Date.now(),
    };
    this.running.set(officeId, ask);
    this.store.saveAsk(ask);
    if (subId) this.#subs.set(ask.id, String(subId));
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
        this.#subs.delete(ask.id);
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

