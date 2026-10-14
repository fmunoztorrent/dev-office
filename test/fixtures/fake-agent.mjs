#!/usr/bin/env node
// Un agente de mentira que se comporta como la extensión de Pi: se conecta a la oficina, anuncia
// su proyecto y ejecuta los pipelines con la librería común (integrations/common/devteam.mjs).
// Cada etapa "trabaja" un poco (lee y escribe un archivo) y devuelve un resumen. Sirve para los
// tests y para ver la oficina en acción sin un agente real:
//
//   node test/fixtures/fake-agent.mjs [--url http://127.0.0.1:4317] [--dir examples/tienda] [--delay 600]
//
// Los gates se simulan (RED falla, el resto pasa) salvo con --real-gates.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as lib from '../../integrations/common/devteam.mjs';

const FILES = { tl: 'docs/plan.md', qa: 'tests/feature.test.js', backend: 'src/server/feature.js', frontend: 'src/components/Feature.tsx', designer: 'design/feature.fig', po: 'docs/historia.md', analyst: 'docs/analisis.md', manager: 'docs/plan-de-trabajo.md' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startFakeAgent({ url, dir, agent = 'pi', session = `${agent}-fake`, delay = 0, gates = 'fake', can = ['task', 'pipeline', 'launch'] }) {
  const project = lib.loadProject(dir);
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/v1/ws`);
  const received = [];
  const runs = new Map();
  const wsSend = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const report = lib.inOrder((e) => fetch(`${url}/v1/events/${agent}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, cwd: project.dir, ...e }) }).catch(() => {}));

  async function work(stage, n) {
    const file = FILES[stage.role] || 'README.md';
    for (const [i, [tool, input]] of [['read', { path: 'README.md' }], ['write', { path: file }]].entries()) {
      const id = `${stage.id}-${n}-${i}`;
      await report({ kind: 'tool_start', tool, toolUseId: id, input });
      await sleep(delay);
      await report({ kind: 'tool_end', tool, toolUseId: id, input, ok: true });
    }
    return `${stage.name}: listo, toqué ${file}`;
  }

  async function runPipeline(msg) {
    const pipeline = project.pipelines.find((p) => p.id === msg.pipeline);
    const update = (st) => wsSend({ type: 'pipeline_update', id: msg.id, ...st });
    if (!pipeline) return update({ status: 'failed', detail: `no hay un pipeline "${msg.pipeline}"` });
    const exec = gates === 'real' ? lib.runGate : async (_cmd, _cwd) => ({ passed: run.currentStage?.check?.expect === 'pass', tail: 'simulado' });
    const run = new lib.PipelineRun({ id: msg.id, project, pipeline, task: msg.task, report, onStatus: update, exec });
    runs.set(msg.id, run);
    let step = run.start();
    let n = 0;
    while (step.action === 'prompt' && run.status === 'running') {
      received.push({ type: 'stage', id: step.stage.id, prompt: step.prompt, model: step.stage.model });
      const output = await work(step.stage, ++n);
      if (run.status !== 'running') break;
      step = await run.advance(output);
    }
    if (step.action === 'done') await report({ kind: 'done', text: `Pipeline «${pipeline.name}» terminado` });
  }

  ws.on('open', () => wsSend({ type: 'register', agent, session, cwd: project.dir, pid: process.pid, can, project: lib.catalogEntry(project) }));
  ws.on('message', (d) => {
    const msg = JSON.parse(d);
    if (['task', 'pipeline', 'pipeline_cancel', 'launch'].includes(msg.type)) received.push(msg);
    if (msg.type === 'task') wsSend({ type: 'task_update', id: msg.id, status: 'accepted' });
    if (msg.type === 'pipeline') runPipeline(msg);
    if (msg.type === 'pipeline_cancel') runs.get(msg.id)?.cancel();
    if (msg.type === 'launch') wsSend({ type: 'task_update', id: msg.id, status: 'accepted', detail: 'sesión nueva (de mentira)' });
  });
  ws.on('error', () => {});
  return {
    received,
    ready: new Promise((r) => ws.on('open', r)),
    send: wsSend,
    close: () => new Promise((r) => { if (ws.readyState === 3) return r(); ws.once('close', r); ws.close(); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const a = startFakeAgent({
    url: arg('url', process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317'),
    dir: path.resolve(arg('dir', path.join(here, '..', '..', 'examples', 'tienda'))),
    agent: arg('agent', 'pi'),
    delay: Number(arg('delay', 600)),
    gates: process.argv.includes('--real-gates') ? 'real' : 'fake',
  });
  a.ready.then(() => console.log('agente de mentira conectado'));
}
