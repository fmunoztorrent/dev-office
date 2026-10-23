// The Claude Code hook (integrations/claude-code/hook.mjs) end to end: Claude Code is the backend
// and runs the pipeline in its session, chaining stages with the Stop hook; a stage that asks for
// another model runs as `claude -p --model` (here, a fake one).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';
import { errementariProject } from './fixtures/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'integrations', 'claude-code', 'hook.mjs');
const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');
const call = (base, method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-hook-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-hook-proj-'));
  fs.mkdirSync(path.join(project, '.devteam', 'pipelines'), { recursive: true });
  fs.writeFileSync(path.join(project, '.devteam', 'team.json'), JSON.stringify({ name: 'Hookeado' }));
  fs.writeFileSync(path.join(project, '.devteam', 'pipelines', 'mini.json'), JSON.stringify({
    name: 'Mini', stages: [
      { id: 'plan', name: 'Plan', role: 'tl', phase: 'arquitectura' },                                  // in the session
      { id: 'impl', name: 'Implementación', role: 'backend', model: 'sonnet', needs: ['plan'], check: { run: 'true' } }, // another model: claude -p
      { id: 'review', name: 'Review', role: 'tl', phase: 'review', model: 'opus', needs: ['impl'] },    // the session's: in the session
    ],
  }));
  return { home, project, transcript: path.join(home, 'transcript.jsonl'), log: path.join(home, 'claude.log') };
}

/** Runs the hook as Claude Code would: JSON on stdin, decision on stdout. */
function hook(ctx, base, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, HOME: ctx.home, DEV_TEAM_OFFICE_URL: base, DEV_TEAM_OFFICE_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_LOG: ctx.log },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(JSON.stringify({ session_id: 'c1', cwd: ctx.project, transcript_path: ctx.transcript, ...input }));
  });
}
const say = (ctx, text) => fs.appendFileSync(ctx.transcript, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }] } })}\n`);

test('Claude Code ejecuta el pipeline en su sesión: Stop → siguiente etapa; otro modelo → claude -p', async () => {
  const ctx = setup();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const base = server.url;
  try {
    // on start, the hook announces the project (and prints nothing: it would be context for Claude)
    let r = await hook(ctx, base, { hook_event_name: 'SessionStart', source: 'startup' });
    assert.deepEqual(r, { code: 0, out: '' });
    const [project] = server.pipelines.projects();
    assert.equal(project.name, 'Hookeado');
    assert.deepEqual(project.pipelines[0].hosts, [{ agent: 'claude-code', session: 'c1', live: false }]);

    // the office asks for it; it stays queued until Claude ends its turn
    const { run } = await call(base, 'POST', '/v1/pipelines', { session: 'c1', pipeline: 'mini', task: 'Exportar CSV' });
    assert.equal(run.status, 'queued');
    say(ctx, 'Hola, ¿en qué te ayudo?');
    r = await hook(ctx, base, { hook_event_name: 'Stop', stop_hook_active: false });
    let out = JSON.parse(r.out);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /^\[Dev Team Office · etapa 1\/3\]/);
    assert.match(out.reason, /Exportar CSV/);
    assert.equal(server.pipelines.snapshot().runs[0].status, 'running');
    assert.ok(fs.existsSync(path.join(ctx.home, '.dev-team-office', 'claude-runs', 'c1.json')));

    // Claude did stage 1 in its session; on stopping, stage 2 (sonnet) runs as a child and stage 3
    // (opus, the session's model) goes back to the session
    say(ctx, 'Plan: columna export en /reports');
    r = await hook(ctx, base, { hook_event_name: 'Stop', stop_hook_active: true });
    out = JSON.parse(r.out);
    assert.match(out.reason, /^\[Dev Team Office · etapa 3\/3\]/);
    assert.match(out.reason, /hecho con sonnet/); // the child's summary reaches the next stage
    const child = JSON.parse(fs.readFileSync(ctx.log, 'utf8').trim());
    assert.equal(child.model, 'sonnet');
    assert.equal(child.alias, 'c1'); // its tools show up in the session that launched it
    assert.match(child.prompt, /Plan: columna export en \/reports/);

    say(ctx, 'Review: todo bien');
    r = await hook(ctx, base, { hook_event_name: 'Stop', stop_hook_active: true });
    assert.deepEqual(r, { code: 0, out: '' }); // finished: Claude stops
    const done = server.pipelines.snapshot().runs[0];
    assert.equal(done.status, 'done');
    assert.deepEqual(done.stages.map((s) => s.status), ['done', 'done', 'done']);
    assert.equal(fs.existsSync(path.join(ctx.home, '.dev-team-office', 'claude-runs', 'c1.json')), false);
    // the office drew each phase and the gate (a Bash by the backend)
    const s = server.office.sessionSummary('c1');
    assert.deepEqual(s.flow.map((f) => `${f.role}:${f.phase}`), ['tl:arquitectura', 'backend:implementa', 'tl:review']);
    assert.equal(s.status, 'done');
  } finally {
    await server.close();
  }
});

test('cancelar desde la oficina: el hook lo recoge en el siguiente Stop; y sin oficina nunca molesta', async () => {
  const ctx = setup();
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const base = server.url;
  try {
    await hook(ctx, base, { hook_event_name: 'UserPromptSubmit', prompt: 'hola' });
    const { run } = await call(base, 'POST', '/v1/pipelines', { session: 'c1', pipeline: 'mini', task: 'X' });
    say(ctx, 'ok');
    assert.equal(JSON.parse((await hook(ctx, base, { hook_event_name: 'Stop' })).out).decision, 'block');
    await call(base, 'POST', `/v1/pipelines/${run.id}/cancel`);
    say(ctx, 'plan');
    const r = await hook(ctx, base, { hook_event_name: 'Stop', stop_hook_active: true });
    assert.deepEqual(r, { code: 0, out: '' });
    assert.equal(server.pipelines.snapshot().runs[0].status, 'cancelled');

    // a direct task also arrives at Stop
    await call(base, 'POST', '/v1/tasks', { agent: 'claude-code', session: 'c1', text: 'Escribe los tests del login' });
    const t = JSON.parse((await hook(ctx, base, { hook_event_name: 'Stop' })).out);
    assert.match(t.reason, /Escribe los tests del login/);
  } finally {
    await server.close();
  }
  // office stopped: it exits 0 and prints nothing
  assert.deepEqual(await hook(ctx, 'http://127.0.0.1:9', { hook_event_name: 'Stop' }), { code: 0, out: '' });
});

test('a una sesión de Claude ya abierta, el /task de Errementari le llega expandido en el Stop', async () => {
  const ctx = { ...setup(), project: errementariProject() };
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false });
  const base = server.url;
  try {
    await hook(ctx, base, { hook_event_name: 'SessionStart', source: 'startup' }); // the session announces its path
    const { agent } = await call(base, 'POST', '/v1/agents', { path: ctx.project, harness: 'claude-code' });
    const r = await call(base, 'POST', `/v1/agents/${agent.id}/prompt`, { entry: 'errementari:feature', text: 'Login con Google', session: 'c1' });
    assert.equal(r.task.status, 'queued', r.error);
    const out = JSON.parse((await hook(ctx, base, { hook_event_name: 'Stop' })).out);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /\(\/task\)/);
    assert.match(out.reason, /Classify and run the corresponding pipeline for:\n\nfeature: Login con Google/);
  } finally {
    await server.close();
  }
});
