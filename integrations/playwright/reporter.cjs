// Dev Team Office's Playwright reporter: it tells the office, live, what the end-to-end tests are doing
// (each test, each step: navigate, click, fill, expect…, and how each test ended, with its trace, video
// and screenshots), so the office shows them on its e2e screen. It is added to the project's own
// reporters, never instead of them: Playwright loads it from $PW_TEST_REPORTER, which the office's
// integrations set in each agent's environment (and `dev-team-office e2e <command>` too).
//
// It never gets in the way of the tests: no dependencies, it prints nothing, events go in batches and
// in order, every request has a short limit, and if the office does not answer it stops trying.
//
// The office: $DEV_TEAM_OFFICE_URL, or http://127.0.0.1:4317.

'use strict';

const http = require('node:http');
const path = require('node:path');

const BATCH_MS = 250;
const TIMEOUT_MS = 1500;
// the steps worth showing: the browser's actions, the checks and the test's own steps (not the
// fixtures' and hooks' plumbing)
const SHOWN = new Set(['pw:api', 'expect', 'test.step']);
const ANSI = /\x1b\[[0-9;]*m/g;
const clip = (s, n) => { const x = String(s ?? '').replace(ANSI, ''); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

class DevTeamOfficeReporter {
  constructor(options = {}) {
    const url = new URL(options.url || process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317');
    this.url = url;
    this.run = `${Date.now().toString(36)}-${process.pid}`;
    this.cwd = process.cwd();
    this.queue = [];
    this.timer = null;
    this.sending = Promise.resolve();
    this.dead = false;
  }

  printsToStdio() { return false; }

  onBegin(config, suite) {
    // run from inside the config's folder: its outputs (test-results) are in the config's folder
    const conf = config.configFile ? path.dirname(config.configFile) : '';
    if (conf && `${this.cwd}${path.sep}`.startsWith(`${conf}${path.sep}`)) this.cwd = conf;
    const projects = (config.projects || []).map((p) => ({ name: p.name || '', outputDir: p.outputDir || '', trace: typeof p.use?.trace === 'string' ? p.use.trace : p.use?.trace?.mode || 'off', video: typeof p.use?.video === 'string' ? p.use.video : p.use?.video?.mode || 'off' }));
    this.push({ type: 'begin', rootDir: config.rootDir || this.cwd, version: config.version || '', workers: config.workers || 1, total: suite.allTests().length, projects });
  }

  onTestBegin(test, result) {
    this.push({ type: 'test', test: test.id, title: clip(test.title, 200), file: test.location ? path.relative(this.cwd, test.location.file) : '', line: test.location?.line || 0, project: test.parent?.project?.()?.name || '', retry: result.retry || 0 });
  }

  onStepEnd(test, result, step) {
    if (!SHOWN.has(step.category)) return;
    // the plumbing's steps (inside a fixture or a hook) are not the test's
    for (let p = step.parent; p; p = p.parent) if (p.category === 'hook' || p.category === 'fixture') return;
    let depth = 0;
    for (let p = step.parent; p; p = p.parent) depth++;
    this.push({ type: 'step', test: test.id, title: clip(step.title, 160), category: step.category, depth, at: step.startTime ? +step.startTime : Date.now(), duration: step.duration || 0, line: step.location?.line || 0, error: step.error ? clip(step.error.message, 600) : '' });
  }

  onTestEnd(test, result) {
    const attachments = (result.attachments || []).filter((a) => a.path).map((a) => ({ name: a.name, contentType: a.contentType || '', path: a.path }));
    this.push({ type: 'testEnd', test: test.id, status: result.status, expected: test.expectedStatus, duration: result.duration || 0, retry: result.retry || 0, error: result.error ? clip(result.error.message, 1200) : '', attachments });
  }

  onEnd(result) {
    this.push({ type: 'end', status: result.status, duration: result.duration || 0 });
    // the last batch, before the runner exits (never longer than the limit)
    return Promise.race([this.flush(), new Promise((r) => setTimeout(r, TIMEOUT_MS + 500))]);
  }

  push(event) {
    if (this.dead) return;
    this.queue.push(event);
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this.flush(); }, BATCH_MS); this.timer.unref?.(); }
  }

  /** Sends what is queued, after what was being sent (in order). */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const events = this.queue.splice(0);
    if (!events.length || this.dead) return this.sending;
    this.sending = this.sending.then(() => this.post({ run: this.run, cwd: this.cwd, pid: process.pid, events }));
    return this.sending;
  }

  post(body) {
    if (this.dead) return Promise.resolve();
    return new Promise((resolve) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: this.url.hostname, port: this.url.port || 80, path: '/v1/e2e', method: 'POST', timeout: TIMEOUT_MS,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      }, (res) => { res.resume(); res.on('end', resolve); });
      // the office is not running (or not there): it stops trying, quietly
      req.on('error', () => { this.dead = true; resolve(); });
      req.on('timeout', () => { req.destroy(); this.dead = true; resolve(); });
      req.end(data);
    });
  }
}

module.exports = DevTeamOfficeReporter;
