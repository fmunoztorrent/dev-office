// The end-to-end tests, watched: what a Playwright run is doing, from the reporter the office adds to
// it (integrations/playwright/reporter.cjs). Live, each test and each of its steps (navigate, click,
// fill, expect…); when a test ends, its trace (trace.zip: the browser's frames, each action with its
// locator, where it clicked, the error), its video and its screenshots, copied before the next run
// clears them. The web view shows it on its e2e screen (public/e2e-ui.js), and QA does it in the game.
//
// The office still runs nothing: the agent runs its tests; the reporter only tells. It reads only files
// inside the folder where the tests run, and keeps the last few runs in its own folder.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../public/i18n.js';
import { clip } from './roles.js';
import { insideDir, realDir } from './paths.js';
import { zipEntries, zipRead } from './zip.js';

const RUNS_MAX = 6;
const TESTS_MAX = 500;
const STEPS_MAX = 400;
const FRAMES_MAX = 240;
const ACTIONS_MAX = 300;
const VIDEO_MAX = 80 * 1024 * 1024;
const SHOT_MAX = 12 * 1024 * 1024;
const STALE_MS = 10 * 60_000;
const ANSI = /\x1b\[[0-9;]*m/g;
const SHOWN = new Set(['pw:api', 'expect', 'test.step']);
const safeId = (s) => /^[\w.-]{1,80}$/.test(String(s ?? ''));
// each run's folder carries this mark: the desk only ever deletes folders it made
const MARK = '.dev-team-office-e2e';
const text = (s, n) => clip(String(s ?? '').replace(ANSI, ''), n);

// ---------------------------------------------------------------- the trace

/**
 * What a Playwright trace (trace.zip) says: { frames: [{ t, name, w, h }], actions: [{ id, title,
 * subtitle, category, depth, start, end, error, point }], start, end }, its times in the trace's own
 * clock (ms). Each frame is an entry of the zip (`name`). Older traces without the runner's steps
 * (test.trace) give the browser's calls instead.
 */
export function parseTrace(buf) {
  const entries = zipEntries(buf);
  const lines = (name) => { const b = zipRead(buf, entries, name); return b ? b.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []; };
  const libs = [...entries.keys()].filter((n) => /(^|\/)(\d+-)?trace\.trace$/.test(n) && n !== 'test.trace');
  const frames = [], calls = new Map(), points = new Map();
  const libActions = [];
  for (const name of libs) {
    for (const e of lines(name)) {
      if (e.type === 'screencast-frame') {
        const file = e.file || (e.sha1 ? `resources/${e.sha1}` : null);
        if (file && entries.has(file)) frames.push({ t: +e.timestamp || 0, name: file, w: e.width || 0, h: e.height || 0 });
      } else if (e.type === 'before') {
        calls.set(e.callId, e.stepId || null);
        libActions.push({ id: e.callId, title: e.title || e.apiName || `${e.method || ''}`, subtitle: e.params?.selector || e.params?.url || '', category: 'pw:api', depth: 0, start: +e.startTime || 0, end: +e.startTime || 0, error: '', point: null });
      } else if (e.type === 'after') {
        const a = libActions.find((x) => x.id === e.callId);
        if (a) { a.end = +e.endTime || a.start; if (e.error) a.error = text(e.error.message || e.error.error?.message, 800); }
      } else if (e.type === 'input' && (e.point || e.box)) {
        const p = e.point || { x: e.box.x + e.box.width / 2, y: e.box.y + e.box.height / 2 };
        points.set(e.callId, { x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
  }
  let actions;
  const steps = lines('test.trace');
  if (steps.some((e) => e.type === 'before')) {
    const by = new Map();
    for (const e of steps) {
      if (e.type === 'before') by.set(e.callId, { id: e.callId, title: text(e.title || e.method, 160), subtitle: text(e.subtitle || e.params?.locator || e.params?.selector || '', 160), category: e.method || '', parent: e.parentId || null, start: +e.startTime || 0, end: +e.startTime || 0, error: '', point: null });
      else if (e.type === 'after' && by.has(e.callId)) { const a = by.get(e.callId); a.end = +e.endTime || a.start; if (e.error) a.error = text(e.error.message, 800); }
    }
    // where the browser's call of each step clicked or typed
    for (const [call, stepId] of calls) if (stepId && by.has(stepId) && points.has(call)) by.get(stepId).point = points.get(call);
    const hidden = (a) => { for (let p = a; p; p = by.get(p.parent)) if (p.category === 'hook' || p.category === 'fixture') return true; return false; };
    const depth = (a) => { let d = 0; for (let p = by.get(a.parent); p; p = by.get(p.parent)) d++; return d; };
    actions = [...by.values()].filter((a) => SHOWN.has(a.category) && !hidden(a)).map(({ parent, ...a }) => ({ ...a, depth: depth({ parent }) }));
  } else {
    actions = libActions.filter((a) => a.title).map((a) => ({ ...a, point: points.get(a.id) || null }));
  }
  actions.sort((a, b) => a.start - b.start);
  frames.sort((a, b) => a.t - b.t);
  // a long test: its frames, thinned evenly (the first and the last stay)
  let kept = frames;
  if (frames.length > FRAMES_MAX) { const k = (frames.length - 1) / (FRAMES_MAX - 1); kept = Array.from({ length: FRAMES_MAX }, (_, i) => frames[Math.round(i * k)]); }
  const times = [...kept.map((f) => f.t), ...actions.flatMap((a) => [a.start, a.end])].filter((x) => x > 0);
  return { frames: kept, actions: actions.slice(0, ACTIONS_MAX), start: times.length ? Math.min(...times) : 0, end: times.length ? Math.max(...times) : 0, read: (name) => zipRead(buf, entries, name) };
}

// ---------------------------------------------------------------- the command

/**
 * `dev-team-office e2e -- <command>`: the command, with the trace on when it is Playwright's own
 * (`npx playwright test …`, `pnpm exec playwright test`…) and it says nothing about it, so each test
 * leaves its frames. A script (`npm run e2e`) goes as it is: its config decides.
 */
export function e2eCommand(cmd = []) {
  const argv = cmd.map(String);
  const at = argv.findIndex((a, i) => /(^|[\\/])playwright([\\/]cli\.js|\.cmd|\.js)?$/.test(a) && argv[i + 1] === 'test');
  if (at < 0 || argv.some((a) => a === '--trace' || a.startsWith('--trace='))) return argv;
  return [...argv, '--trace=on'];
}

// ---------------------------------------------------------------- the desk

export class E2EDesk extends EventEmitter {
  /**
   * @param store    the registered projects (whose folder a run is in)
   * @param company  the offices: QA does the run in the game
   * @param dir      where it keeps the runs' frames, videos and screenshots (a temporary folder if not given)
   */
  constructor({ store, company, dir = null, now = () => Date.now() } = {}) {
    super();
    Object.assign(this, { store, company, now });
    this.temp = !dir;
    this.dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'dto-e2e-'));
    fs.mkdirSync(this.dir, { recursive: true });
    // the runs live in memory: what an earlier office left in its folder belongs to no run any more
    // (only its own folders, the ones with its mark)
    for (const e of fs.readdirSync(this.dir, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith('run-')) this.#rm(path.join(this.dir, e.name));
    this.runs = new Map();
    this.timer = null;
  }

  /** What the reporter says: { run, cwd, events: [{ type: begin | test | step | testEnd | end, … }] }. */
  receive({ run: id, cwd, events } = {}) {
    if (!safeId(id) || !cwd || !path.isAbsolute(String(cwd)) || !Array.isArray(events)) return { ok: false, error: t('e2e.bad') };
    let run = this.runs.get(id);
    if (!run) {
      const dir = realDir(String(cwd));
      const agent = (this.store?.listAgents?.() || []).filter((a) => insideDir(dir, a.path)).sort((a, b) => b.path.length - a.path.length)[0];
      run = { id, cwd: dir, project: agent?.name || path.basename(dir), office: agent?.office || null, status: 'running', startedAt: this.now(), endedAt: null, total: 0, version: '', trace: 'off', video: 'off', tests: new Map(), seq: 0, at: this.now(), work: Promise.resolve() };
      this.runs.set(id, run);
      while (this.runs.size > RUNS_MAX) this.remove(this.runs.keys().next().value);
    }
    run.at = this.now();
    for (const e of events.slice(0, 2000)) this.#event(run, e);
    this.#changed();
    return { ok: true };
  }

  #event(run, e) {
    if (e.type === 'begin') {
      Object.assign(run, { total: Math.min(TESTS_MAX, +e.total || 0), version: text(e.version, 20), trace: e.projects?.[0]?.trace || 'off', video: e.projects?.[0]?.video || 'off' });
      this.#say(run, 'start', t('e2e.log.start', { n: run.total, project: run.project }));
      return;
    }
    if (e.type === 'end') {
      Object.assign(run, { status: ['passed', 'failed', 'interrupted', 'timedout'].includes(e.status) ? e.status : 'failed', endedAt: this.now() });
      run.work = run.work.then(() => {
        const c = this.#counts(run);
        this.#say(run, 'end', t('e2e.log.end', { passed: c.passed, failed: c.failed, s: Math.round((+e.duration || 0) / 1000) }), run.status === 'passed');
        this.#changed();
      });
      return;
    }
    if (!e.test || typeof e.test !== 'string') return;
    let test = run.tests.get(e.test);
    if (e.type === 'test') {
      if (!test) {
        if (run.tests.size >= TESTS_MAX) return;
        test = { idx: ++run.seq, id: e.test, title: '', file: '', line: 0, project: '', retry: 0, status: 'running', startedAt: this.now(), duration: 0, error: '', steps: [], actions: [], frames: [], start: 0, end: 0, video: false, shots: 0 };
        run.tests.set(e.test, test);
      }
      // a retry starts over
      Object.assign(test, { title: text(e.title, 200), file: text(e.file, 200), line: +e.line || 0, project: text(e.project, 60), retry: +e.retry || 0, status: 'running', startedAt: this.now(), steps: [], error: '' });
      return;
    }
    if (!test) return;
    if (e.type === 'step') {
      if (test.steps.length < STEPS_MAX) test.steps.push({ title: text(e.title, 160), category: text(e.category, 20), depth: Math.min(6, +e.depth || 0), at: +e.at || this.now(), duration: +e.duration || 0, line: +e.line || 0, error: text(e.error, 600) });
      return;
    }
    if (e.type === 'testEnd') {
      Object.assign(test, { status: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(e.status) ? e.status : 'failed', duration: +e.duration || 0, error: text(e.error, 1200) });
      const failed = test.status === 'failed' || test.status === 'timedOut';
      // its trace, video and screenshots: read now (the next run clears them), one test after the other
      const files = (Array.isArray(e.attachments) ? e.attachments : []).slice(0, 12);
      run.work = run.work.then(() => this.#attachments(run, test, files)).catch(() => {}).then(() => this.#changed());
      if (failed) this.#say(run, 'fail', t('e2e.log.fail', { title: test.title }), false);
    }
  }

  /** A test's files: only inside the folder where the tests run; the trace becomes frames and actions. */
  async #attachments(run, test, files) {
    const dir = path.join(this.#home(run), String(test.idx));
    let shots = 0;
    for (const a of files) {
      const file = String(a?.path || '');
      if (!path.isAbsolute(file) || !insideDir(file, run.cwd)) continue;
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (!st?.isFile()) continue;
      const type = String(a.contentType || '');
      try {
        if (a.name === 'trace' || /\.zip$/i.test(file)) {
          if (st.size > VIDEO_MAX) continue;
          const tr = parseTrace(fs.readFileSync(file));
          fs.mkdirSync(dir, { recursive: true });
          test.frames = tr.frames.map((f, i) => { fs.writeFileSync(path.join(dir, `f${i}.jpg`), tr.read(f.name)); return { t: f.t, w: f.w, h: f.h }; });
          Object.assign(test, { actions: tr.actions, start: tr.start, end: tr.end });
        } else if (type.startsWith('video/') && st.size <= VIDEO_MAX) {
          fs.mkdirSync(dir, { recursive: true });
          await fs.promises.copyFile(file, path.join(dir, 'video.webm'));
          test.video = true;
        } else if (type.startsWith('image/') && st.size <= SHOT_MAX && shots < 5) {
          fs.mkdirSync(dir, { recursive: true });
          await fs.promises.copyFile(file, path.join(dir, `shot${shots}.png`));
          shots++;
        }
      } catch { /* a broken file is left out: the rest of the test still shows */ }
    }
    test.shots = shots;
  }

  /** A run's folder (made with its mark when `make`). */
  #home(run, make = true) {
    const dir = path.join(this.dir, `run-${run.id}`);
    if (make && !fs.existsSync(path.join(dir, MARK))) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, MARK), ''); }
    return dir;
  }

  /** Deletes a run's folder, only if the desk made it. */
  #rm(dir) {
    try { if (fs.existsSync(path.join(dir, MARK))) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left as it is */ }
  }

  #counts(run) {
    const c = { passed: 0, failed: 0, skipped: 0, running: 0 };
    for (const x of run.tests.values()) {
      if (x.status === 'running') c.running++;
      else if (x.status === 'passed') c.passed++;
      else if (x.status === 'skipped') c.skipped++;
      else c.failed++;
    }
    return c;
  }

  #url(run, test, what, i) { return `/v1/e2e/${encodeURIComponent(run.id)}/${test.idx}/${what}${i === undefined ? '' : `/${i}`}`; }

  #summary(run) {
    // a run that stopped telling without its end (the runner was killed) is not running any more
    if (run.status === 'running' && this.now() - run.at > STALE_MS) Object.assign(run, { status: 'interrupted', endedAt: run.at });
    const tests = [...run.tests.values()];
    const live = tests.filter((x) => x.status === 'running').at(-1);
    // the mini screen's picture: the newest test with a movie (its trace's frames, or its video); once
    // the run ended, the newest one that failed (where it failed)
    const movie = (x) => x.frames.length || x.video;
    const bad = (x) => x.status === 'failed' || x.status === 'timedOut';
    const shown = (run.status !== 'running' && [...tests].reverse().find((x) => bad(x) && movie(x))) || [...tests].reverse().find(movie);
    return {
      id: run.id, project: run.project, office: run.office, cwd: run.cwd, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, total: run.total || tests.length,
      counts: this.#counts(run), trace: run.trace, video: run.video,
      current: live ? { test: live.idx, title: live.title, step: live.steps.at(-1)?.title || '' } : null,
      last: shown ? { test: shown.idx, title: shown.title, ...(shown.frames.length ? { frame: this.#url(run, shown, 'frame', shown.frames.length - 1) } : { video: this.#url(run, shown, 'video') }) } : null,
    };
  }

  /** The runs, the newest first (summaries: what the mini screen shows). */
  list() { return [...this.runs.values()].reverse().map((r) => this.#summary(r)); }

  /** A run with its tests: their steps, the trace's actions and frames (URLs), video and screenshots. */
  get(id) {
    const run = this.runs.get(String(id));
    if (!run) return null;
    return {
      ...this.#summary(run),
      tests: [...run.tests.values()].map((x) => ({
        idx: x.idx, title: x.title, file: x.file, line: x.line, project: x.project, retry: x.retry, status: x.status, duration: x.duration, error: x.error,
        steps: x.steps, actions: x.actions, start: x.start, end: x.end,
        frames: x.frames.map((f, i) => ({ t: f.t, w: f.w, h: f.h, url: this.#url(run, x, 'frame', i) })),
        video: x.video ? this.#url(run, x, 'video') : null,
        shots: Array.from({ length: x.shots }, (_, i) => this.#url(run, x, 'shot', i)),
      })),
    };
  }

  /** A file of a run's test: { path, type } or null (`what`: frame, video or shot). */
  file(id, idx, what, i = 0) {
    const run = this.runs.get(String(id));
    const test = run && [...run.tests.values()].find((x) => x.idx === Number(idx));
    if (!test || !Number.isInteger(+i) || +i < 0) return null;
    const name = what === 'frame' ? `f${+i}.jpg` : what === 'video' ? 'video.webm' : what === 'shot' ? `shot${+i}.png` : null;
    const file = name && path.join(this.#home(run, false), String(test.idx), name);
    if (!file || !fs.existsSync(file)) return null;
    return { path: file, type: what === 'frame' ? 'image/jpeg' : what === 'video' ? 'video/webm' : 'image/png' };
  }

  /** Forgets a run (and its files). */
  remove(id) {
    const run = this.runs.get(String(id));
    if (!run) return { ok: false, status: 404, error: t('e2e.unknown') };
    this.runs.delete(run.id);
    this.#rm(path.join(this.dir, `run-${run.id}`));
    this.#changed();
    return { ok: true };
  }

  /** QA runs the tests in the game: when they start, when one fails and when they end. */
  #say(run, phase, msg, ok = true) {
    try { this.company?.ingest('generic', { kind: 'e2e', session: 'office', ...(run.office ? { office: run.office } : {}), cwd: run.cwd, phase, ok, text: msg, project: run.project }); } catch { /* the game cannot break the run */ }
  }

  #changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.emit('change', this.list()); }, 250);
    this.timer.unref?.();
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    if (this.temp) fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
