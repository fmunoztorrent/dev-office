#!/usr/bin/env node
// Claude Code hook → Dev Team Office. Claude Code is the BACKEND: everything runs here; the
// office only sends requests and draws what happens.
//
// Configuration: see integrations/claude-code/settings.example.json (every event calls this
// file with `node`). It receives the hook's JSON on stdin.
//
// - Forwards every event to the office.
// - SessionStart / UserPromptSubmit: announces the project and its pipelines (.devteam/).
// - Stop: if a pipeline is running in this session, the stage that just finished is closed
//   (its summary is the transcript's last reply), its gate runs and the next one is decided.
//   If it has to continue, it prints {"decision":"block","reason":"<stage prompt>"}
//   and Claude continues in the same session. A stage that asks for a model different from the
//   session's runs as `claude -p --model …` (hooks cannot change the session's model) and its result
//   goes back to the pipeline. It also delivers tasks and pipelines the office has queued; a task
//   that is a command of your harness (Errementari's /task…) arrives expanded.
//
// It never breaks Claude: on any error it prints nothing and exits with 0. stdout only carries the
// Stop decision (in UserPromptSubmit/SessionStart text on stdout would become context).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOCK = process.env.DEV_TEAM_OFFICE_SOCKET || path.join(os.homedir(), '.dev-team-office', 'office.sock');
const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const RUNS = path.join(os.homedir(), '.dev-team-office', 'claude-runs');
// This session's office (team), if the office opened it, and its herdr pane: so the office
// knows which team it belongs to and which pane holds it.
const WHERE = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { devteam_office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { herdr_pane: process.env.HERDR_PANE_ID } : {}),
};
const OFFICE_OF = { ...(WHERE.devteam_office ? { office: WHERE.devteam_office } : {}), ...(WHERE.herdr_pane ? { pane: WHERE.herdr_pane } : {}) };

async function loadLib() {
  const candidates = [process.env.DEV_TEAM_OFFICE_LIB, path.join(here, '..', 'common', 'devteam.mjs'), path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs')];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// Events are sent without waiting but in order (they tell a story: phase → tools → end);
// before exiting it waits for all of them to arrive.
let chain = Promise.resolve();

/** POST to the office: through the Unix socket if it exists (only your user), otherwise over HTTP. */
function post(route, body, timeoutMs = 2000) {
  return (chain = chain.then(() => postNow(route, body, timeoutMs)));
}

function postNow(route, body, timeoutMs) {
  const data = JSON.stringify(body);
  if (fs.existsSync(SOCK)) {
    return new Promise((resolve) => {
      const req = http.request({ socketPath: SOCK, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: timeoutMs }, (res) => {
        let out = '';
        res.on('data', (d) => { out += d; });
        res.on('end', () => { try { resolve(JSON.parse(out || '{}')); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end(data);
    });
  }
  return fetch(`${URL_BASE}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data, signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => r.json()).catch(() => null);
}

const readStdin = () => new Promise((resolve) => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => resolve(s));
});

// Installed twice (as a plugin and with `dev-team-office setup` in ~/.claude/settings.json), the
// plugin's hook stays quiet: each event arrives only once.
function duplicatedByPlugin() {
  if (!process.argv.includes('--plugin')) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    return JSON.stringify(settings.hooks || {}).includes('dev-team-office');
  } catch { return false; }
}

async function main() {
  // a side question (btw) launched by the office: it is not the team's work, it is not reported
  if (process.env.DEV_TEAM_OFFICE_BTW || duplicatedByPlugin()) return;
  const input = JSON.parse((await readStdin()) || '{}');
  const event = input.hook_event_name;
  // A stage running as a child `claude -p` reports its tools as the session that launched it;
  // its start, its prompt and its end are not the session's (the pipeline accounts for them).
  const child = !!process.env.DEV_TEAM_OFFICE_SESSION_ALIAS;
  const session = process.env.DEV_TEAM_OFFICE_SESSION_ALIAS || input.session_id;
  if (!session || (child && ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].includes(event))) return;
  const stateFile = path.join(RUNS, `${String(session).replace(/[^\w-]/g, '_')}.json`);
  // with a pipeline in progress, Stop closes a stage: it is not "done"
  const stage = event === 'Stop' && fs.existsSync(stateFile);
  const directive = (await post('/v1/hooks/claude-code', { ...input, ...WHERE, session_id: session, ...(stage ? { devteam_stage: true } : {}) })) || {};
  if (child) return;

  const lib = await loadLib();
  if (!lib) return;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    const project = lib.loadProject(input.cwd);
    if (project.hasConfig) await post('/v1/agents/announce', { agent: 'claude-code', session, cwd: input.cwd, project: lib.catalogEntry(project), ...OFFICE_OF });
    return;
  }
  if (event !== 'Stop') return;

  const report = (e) => post('/v1/events/generic', { source: 'claude-code', session, cwd: input.cwd, ...OFFICE_OF, ...e });
  const onStatus = (st) => post(`/v1/pipelines/${encodeURIComponent(st.id)}/update`, st);
  const save = (run) => { fs.mkdirSync(RUNS, { recursive: true, mode: 0o700 }); fs.writeFileSync(stateFile, JSON.stringify(run.toJSON()), { mode: 0o600 }); };
  const clear = () => fs.rmSync(stateFile, { force: true });

  let run = null;
  try { run = lib.PipelineRun.restore(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { report, onStatus }); } catch { /* no pipeline in progress */ }
  if (run && directive.cancel?.includes(run.id)) { run.cancel(); clear(); return; }

  let step = null;
  if (run) {
    step = await run.advance(lib.lastAssistantText(input.transcript_path));
  } else if (directive.pipeline) {
    const project = lib.loadProject(input.cwd);
    const pipeline = project.pipelines.find((p) => p.id === directive.pipeline.pipeline);
    if (!pipeline) { await onStatus({ id: directive.pipeline.id, status: 'failed', detail: `no hay un pipeline "${directive.pipeline.pipeline}" en ${project.dir}/.devteam/` }); return; }
    run = new lib.PipelineRun({ id: directive.pipeline.id, project, pipeline, task: directive.pipeline.task, report, onStatus });
    step = run.start();
  }

  // Stages with another model: `claude -p --model …` (the session cannot change model). The ones
  // that ask for no model, or for the one the session already has, stay in the session.
  const team = run ? lib.loadProject(run.project.dir).team : {};
  const opts = team.harnessOptions?.['claude-code'] || {};
  const sessionModel = lib.lastAssistantModel(input.transcript_path);
  while (step?.action === 'prompt' && step.stage.model && !lib.sameModel(step.stage.model, sessionModel)) {
    const res = await lib.claudeChild({
      prompt: step.prompt, model: step.stage.model, agent: step.stage.native && step.stage.harness === 'claude-code' ? step.stage.agent : undefined,
      cwd: run.project.dir, bin: opts.bin, args: opts.args,
      env: { DEV_TEAM_OFFICE_SESSION_ALIAS: session, DEV_TEAM_OFFICE_URL: URL_BASE },
    });
    step = res.ok ? await run.advance(res.output) : run.fail(`claude -p --model ${step.stage.model}: ${res.output}`);
  }

  if (step?.action === 'prompt') {
    save(run);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: step.prompt }));
  } else if (run) {
    clear(); // finished or failed: Claude stops normally
  } else if (directive.task) {
    // a command of your harness (e.g. Errementari's /task): Stop cannot run it, so it hands Claude
    // its expanded content, as if you had typed it
    const { command, args, text } = directive.task;
    const body = (command && lib.expandClaudeCommand(input.cwd, command, args ?? '')) || text;
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `Nueva tarea enviada por el usuario desde Dev Team Office${command ? ` (/${command})` : ''}. Hazla ahora:\n\n${body}` }));
  }
}

main().catch(() => {}).then(() => chain).finally(() => process.exit(0));
