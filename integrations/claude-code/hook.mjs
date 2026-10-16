#!/usr/bin/env node
// Hook de Claude Code → Dev Team Office. Claude Code es el BACKEND: aquí se ejecuta todo; la
// oficina sólo envía pedidos y dibuja lo que pasa.
//
// Configuración: ver integrations/claude-code/settings.example.json (todos los eventos llaman a
// este archivo con `node`). Recibe el JSON del hook por stdin.
//
// - Reenvía cada evento a la oficina.
// - SessionStart / UserPromptSubmit: anuncia el proyecto y sus pipelines (.devteam/).
// - Stop: si hay un pipeline corriendo en esta sesión, la etapa que acaba de terminar se cierra
//   (su resumen es la última respuesta del transcript), se corre su gate y se decide la
//   siguiente. Si hay que seguir, imprime {"decision":"block","reason":"<prompt de la etapa>"}
//   y Claude continúa en la misma sesión. Una etapa que pide un modelo distinto al de la sesión corre como
//   `claude -p --model …` (los hooks no pueden cambiar el modelo de la sesión) y su resultado
//   vuelve al pipeline. También entrega tareas y pipelines que la oficina tenga en cola; una tarea
//   que es un comando de tu harness (/task de Errementari…) llega expandida.
//
// Nunca rompe a Claude: ante cualquier error no imprime nada y sale con 0. stdout sólo lleva la
// decisión de Stop (en UserPromptSubmit/SessionStart el texto en stdout se volvería contexto).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOCK = process.env.DEV_TEAM_OFFICE_SOCKET || path.join(os.homedir(), '.dev-team-office', 'office.sock');
const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
const RUNS = path.join(os.homedir(), '.dev-team-office', 'claude-runs');

async function loadLib() {
  const candidates = [process.env.DEV_TEAM_OFFICE_LIB, path.join(here, '..', 'common', 'devteam.mjs'), path.join(os.homedir(), '.dev-team-office', 'lib', 'devteam.mjs')];
  for (const c of candidates) if (c && fs.existsSync(c)) return import(pathToFileURL(c).href);
  return null;
}

// Los eventos se mandan sin esperar pero en orden (cuentan una historia: fase → herramientas →
// fin); antes de salir se espera a que lleguen todos.
let chain = Promise.resolve();

/** POST a la oficina: por el socket Unix si existe (sólo tu usuario), si no por HTTP. */
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

async function main() {
  const input = JSON.parse((await readStdin()) || '{}');
  const event = input.hook_event_name;
  // Una etapa que corre como `claude -p` hijo reporta sus herramientas como la sesión que la
  // lanzó; su inicio, su prompt y su fin no son de la sesión (los cuenta el pipeline).
  const child = !!process.env.DEV_TEAM_OFFICE_SESSION_ALIAS;
  const session = process.env.DEV_TEAM_OFFICE_SESSION_ALIAS || input.session_id;
  if (!session || (child && ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].includes(event))) return;
  const stateFile = path.join(RUNS, `${String(session).replace(/[^\w-]/g, '_')}.json`);
  // con un pipeline en curso, el Stop cierra una etapa: no es "listo"
  const stage = event === 'Stop' && fs.existsSync(stateFile);
  const directive = (await post('/v1/hooks/claude-code', { ...input, session_id: session, ...(stage ? { devteam_stage: true } : {}) })) || {};
  if (child) return;

  const lib = await loadLib();
  if (!lib) return;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    const project = lib.loadProject(input.cwd);
    if (project.hasConfig) await post('/v1/agents/announce', { agent: 'claude-code', session, cwd: input.cwd, project: lib.catalogEntry(project) });
    return;
  }
  if (event !== 'Stop') return;

  const report = (e) => post('/v1/events/generic', { source: 'claude-code', session, cwd: input.cwd, ...e });
  const onStatus = (st) => post(`/v1/pipelines/${encodeURIComponent(st.id)}/update`, st);
  const save = (run) => { fs.mkdirSync(RUNS, { recursive: true, mode: 0o700 }); fs.writeFileSync(stateFile, JSON.stringify(run.toJSON()), { mode: 0o600 }); };
  const clear = () => fs.rmSync(stateFile, { force: true });

  let run = null;
  try { run = lib.PipelineRun.restore(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { report, onStatus }); } catch { /* sin pipeline en curso */ }
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

  // Etapas con otro modelo: `claude -p --model …` (la sesión no puede cambiar de modelo). Las
  // que no piden modelo, o piden el que ya tiene la sesión, siguen en la sesión.
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
    clear(); // terminó o falló: Claude se detiene normalmente
  } else if (directive.task) {
    // un comando de tu harness (p. ej. /task de Errementari): el Stop no puede ejecutarlo, así que
    // le pasa a Claude su contenido expandido, como si lo hubieras escrito
    const { command, args, text } = directive.task;
    const body = (command && lib.expandClaudeCommand(input.cwd, command, args ?? '')) || text;
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `Nueva tarea enviada por el usuario desde Dev Team Office${command ? ` (/${command})` : ''}. Hazla ahora:\n\n${body}` }));
  }
}

main().catch(() => {}).then(() => chain).finally(() => process.exit(0));
