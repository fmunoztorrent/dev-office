import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { loadProject } from '../server/project.js';
import { parseAgentFile } from '../server/harness/agents.js';
import pi from '../server/harness/pi.js';
import claude from '../server/harness/claude.js';
import opencode from '../server/harness/opencode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_PI = path.join(here, 'fixtures', 'fake-pi.mjs');
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timeout');
};

/** Copia examples/tienda a un directorio temporal y la apunta al pi de mentira. */
function tempProject({ pipelines } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-proj-'));
  fs.cpSync(path.join(here, '..', 'examples', 'tienda'), dir, { recursive: true });
  const teamFile = path.join(dir, '.devteam', 'team.json');
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  team.harnessOptions = { pi: { bin: FAKE_PI } };
  fs.writeFileSync(teamFile, JSON.stringify(team));
  for (const [id, p] of Object.entries(pipelines || {})) fs.writeFileSync(path.join(dir, '.devteam', 'pipelines', `${id}.json`), JSON.stringify(p));
  return dir;
}

test('frontmatter de agentes (Pi, Claude, OpenCode)', () => {
  const a = parseAgentFile('---\nname: tester\ndescription: "QA"\nmodel: anthropic/claude-haiku-5-5\ntools:\n  - read\n  - bash\n---\nEres QA.', '/x/tester.md');
  assert.deepEqual([a.name, a.description, a.model, a.tools, a.prompt], ['tester', 'QA', 'anthropic/claude-haiku-5-5', ['read', 'bash'], 'Eres QA.']);
  assert.equal(parseAgentFile('Sin frontmatter', '/x/solo.md').name, 'solo');
});

test('cada harness traduce su salida JSON a eventos de la oficina', () => {
  const p = pi.createParser();
  assert.deepEqual(p.line({ type: 'tool_execution_start', toolCallId: '1', toolName: 'edit', args: { path: 'a.ts' } })[0], { kind: 'tool_start', tool: 'edit', toolUseId: '1', input: { path: 'a.ts' } });
  assert.equal(p.line({ type: 'tool_execution_end', toolCallId: '1', toolName: 'edit', isError: true })[0].ok, false);
  p.line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'listo' }] } });
  assert.equal(p.output(), 'listo');

  const c = claude.createParser();
  assert.equal(c.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } })[0].tool, 'Bash');
  assert.deepEqual(c.line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true }] } })[0], { kind: 'tool_end', tool: 'Bash', toolUseId: 't', input: { command: 'npm test' }, ok: false, parentToolUseId: undefined });
  c.line({ type: 'result', result: 'resumen' });
  assert.equal(c.output(), 'resumen');

  const o = opencode.createParser();
  const evs = o.line({ type: 'tool_use', part: { id: 'x', tool: 'edit', state: { status: 'error', input: { filePath: 'b.ts' } } } });
  assert.deepEqual(evs.map((e) => [e.kind, e.ok]), [['tool_start', undefined], ['tool_end', false]]);

  // cómo se lanza cada etapa
  assert.deepEqual(pi.command({ prompt: 'P', model: 'm', tools: ['read'], systemPromptFile: '/t.md' }), ['--mode', 'json', '-p', '--no-session', '--model', 'm', '--tools', 'read', '--append-system-prompt', '/t.md', 'P']);
  assert.deepEqual(claude.command({ prompt: 'P', model: 'opus', agent: 'rev', native: true, extraArgs: claude.defaultArgs }), ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'opus', '--agent', 'rev', '--permission-mode', 'acceptEdits', 'P']);
  assert.deepEqual(opencode.command({ prompt: 'P', model: 'a/b', agent: 'x', native: false, agentPrompt: 'Eres X' }).at(-1), 'Eres X\n\n---\n\nP');
});

test('valida dependencias, ciclos y bucles del pipeline', () => {
  const dir = tempProject({ pipelines: { roto: { stages: [{ id: 'a', role: 'qa', needs: ['b'] }, { id: 'b', role: 'arquitecto', needs: ['a'], onFail: { goto: 'zz' } }] } } });
  const p = loadProject(dir).pipelines.find((x) => x.id === 'roto');
  assert.equal(p.stages[1].role, 'tl'); // alias
  assert.ok(p.issues.some((i) => i.includes('ciclo')));
  assert.ok(p.issues.some((i) => i.includes('zz')));
});

test('la oficina orquesta: etapas con su agente y modelo, contexto entre etapas, gate y bucle', async () => {
  const dir = tempProject({
    pipelines: {
      prueba: {
        name: 'Prueba', strategy: 'office', stages: [
          { id: 'diseno', name: 'Diseño', role: 'tl', phase: 'arquitectura' },
          { id: 'red', name: 'Rojo', role: 'qa', phase: 'red', needs: ['diseno'], check: { run: 'exit 1', expect: 'fail' } },
          { id: 'impl', name: 'Impl', role: 'backend', phase: 'implementa', needs: ['red'] },
          // el gate falla la primera vez y pasa la segunda: vuelve a impl una vez
          { id: 'green', name: 'Verde', role: 'qa', phase: 'green', needs: ['impl'], check: { run: 'n=$(cat .n 2>/dev/null || echo 0); echo $((n+1)) > .n; echo "falla $n"; [ "$n" -ge 1 ]' }, onFail: { goto: 'impl', max: 2 } },
        ],
      },
    },
  });
  const log = path.join(dir, 'calls.jsonl');
  process.env.FAKE_PI_LOG = log;
  const server = await startServer({ port: 0, socket: null, config: {} });
  try {
    const res = await fetch(`${server.url}/v1/pipelines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, pipeline: 'prueba', task: 'Cancelar pedidos' }) }).then((r) => r.json());
    assert.equal(res.ok, true, res.error);
    const run = await until(() => server.pipelines.snapshot().runs.find((r) => r.status !== 'running'));
    assert.equal(run.status, 'done', run.detail);
    assert.deepEqual(run.stages.map((s) => [s.id, s.status, s.attempts]), [['diseno', 'done', 1], ['red', 'done', 1], ['impl', 'done', 2], ['green', 'done', 2]]);

    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 6);
    assert.equal(calls[0].model, 'anthropic/claude-opus-5-5'); // de team.json (tl → architect)
    assert.match(calls[0].systemPrompt, /arquitecto del equipo/); // system prompt del agente de .pi/agents
    assert.equal(calls[1].tools, 'read,grep,find,ls,write,edit,bash');
    assert.match(calls[2].prompt, /Resultados de las etapas anteriores[\s\S]*QA: listo/); // impl ve el resultado de red
    assert.match(calls[4].prompt, /El intento anterior no pasó[\s\S]*falla 0/); // impl, segunda vez, con la falla del gate

    // lo que pasó adentro, en la oficina: fases en orden y herramientas con el rol de su etapa
    const evs = server.office.log.filter((e) => e.session === run.session);
    assert.deepEqual(evs.filter((e) => e.kind === 'phase').map((e) => `${e.role}:${e.phase}`), ['tl:arquitectura', 'qa:red', 'backend:implementa', 'qa:green', 'backend:implementa', 'qa:green']);
    assert.ok(evs.some((e) => e.kind === 'tool_start' && e.role === 'backend' && /feature\.js/.test(e.text)));
    assert.equal(server.office.sessionSummary(run.session).errors, 1); // sólo el gate verde que falló (el rojo esperado no cuenta)
    assert.ok(server.office.sessionSummary(run.session).todos.every((t) => t.status === 'completed'));
  } finally {
    delete process.env.FAKE_PI_LOG;
    await server.close();
  }
});

test('el agente orquesta: el pipeline compilado llega a la sesión de Pi y sus subagentes caen en su rol', async () => {
  const dir = tempProject();
  const server = await startServer({ port: 0, socket: null, config: {} });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'task') { got.push(m); ws.send(JSON.stringify({ type: 'task_update', id: m.id, status: 'accepted' })); } });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', agent: 'pi', session: 'pi-7', cwd: dir }));
  await until(() => server.hub.snapshot().agents.length);
  try {
    const res = server.pipelines.start({ dir, pipeline: 'subagentes-pi', task: 'Agregar cupones', target: { agent: 'pi', session: 'pi-7' } });
    assert.equal(res.ok, true, res.error);
    await until(() => got.length);
    assert.match(got[0].text, /herramienta `subagent` con \{ agent: "tester"/);
    assert.match(got[0].text, /Gate: ejecuta `npm test`; debe fallar/);
    assert.equal(server.office.sessionSummary('pi-7').title, 'Feature con subagentes de Pi: Agregar cupones');

    // Pi llama a su herramienta `subagent` con el agente tester → el personaje es QA
    const post = (e) => fetch(`${server.url}/v1/events/pi`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 'pi-7', ...e }) });
    await post({ kind: 'tool_start', tool: 'subagent', toolUseId: 's1', input: { agent: 'tester', task: 'tests en rojo' } });
    const ev = server.office.log.at(-1);
    assert.deepEqual([ev.kind, ev.role], ['subagent_start', 'qa']);
    await until(() => server.pipelines.snapshot().runs[0].stages.find((s) => s.id === 'red').status === 'running');
  } finally {
    ws.close();
    await server.close();
  }
});

test('no se duplican eventos: lo que reporta un hook desde una etapa cuya salida ya se lee, se descarta', async () => {
  const dir = tempProject({ pipelines: { lento: { stages: [{ id: 'a', role: 'backend' }] } } });
  process.env.FAKE_PI_DELAY = '200';
  const server = await startServer({ port: 0, socket: null, config: {} });
  try {
    server.pipelines.start({ dir, pipeline: 'lento', task: 'x' });
    await until(() => server.pipelines.isStreamed('p1-a-1'));
    const r = await fetch(`${server.url}/v1/events/pi`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 'otra', kind: 'tool_start', tool: 'edit', run: 'p1-a-1' }) }).then((x) => x.json());
    assert.equal(r.accepted, 0);
    await until(() => server.pipelines.snapshot().runs[0].status === 'done');
  } finally {
    delete process.env.FAKE_PI_DELAY;
    await server.close();
  }
});
