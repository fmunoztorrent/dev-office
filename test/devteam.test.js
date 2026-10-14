// La parte del AGENTE (integrations/common/devteam.mjs): proyecto, pipelines y su ejecución
// dentro de la sesión. La oficina no participa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../integrations/common/devteam.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, '..', 'examples', 'tienda');
const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dto-lib-'));

test('frontmatter de agentes (Pi, Claude, OpenCode)', () => {
  const a = lib.parseAgentFile('---\nname: tester\ndescription: "Escribe tests"\nmodel: anthropic/claude-haiku-5-5\ntools:\n  - read\n  - bash\n---\nEres QA.\n', 'tester.md');
  assert.deepEqual([a.name, a.description, a.model, a.tools, a.prompt], ['tester', 'Escribe tests', 'anthropic/claude-haiku-5-5', ['read', 'bash'], 'Eres QA.']);
  assert.equal(lib.parseAgentFile('sin frontmatter', '/x/revisor.md').name, 'revisor');
});

test('el proyecto de ejemplo: equipo, agentes de cada harness y pipelines resueltos', () => {
  const p = lib.loadProject(EXAMPLE);
  assert.equal(p.name, 'Tienda (ejemplo)');
  assert.deepEqual(p.errors, []);
  const tdd = p.pipelines.find((x) => x.id === 'feature-tdd');
  assert.deepEqual(tdd.issues, []);
  const [diseno, , , , review] = tdd.stages;
  assert.equal(diseno.agent, 'architect');
  assert.equal(diseno.model, 'anthropic/claude-opus-5-5'); // del rol en team.json
  assert.match(diseno.agentPrompt, /\S/); // la persona sale de .pi/agents/architect.md
  assert.deepEqual([review.harness, review.agent, review.native, review.model], ['claude-code', 'code-reviewer', true, 'opus']);
  // "model": false = el modelo de la sesión
  assert.ok(p.pipelines.find((x) => x.id === 'subagentes-pi').stages.every((s) => s.model === null));
  // lo que se anuncia a la oficina no lleva prompts ni personas
  const entry = lib.catalogEntry(p);
  assert.equal(entry.pipelines.length, 3);
  assert.equal(JSON.stringify(entry).includes('agentPrompt'), false);
});

test('valida dependencias, ciclos, roles y bucles', () => {
  const { issues } = lib.resolvePipeline('x', { stages: [
    { id: 'a', role: 'tl', needs: ['c'] }, { id: 'b', role: 'mago', needs: ['a'] }, { id: 'c', role: 'qa', needs: ['b'], onFail: { goto: 'zz' } }, { id: 'd', needs: ['nada'] },
  ] });
  assert.ok(issues.some((i) => /ciclo/.test(i)));
  assert.ok(issues.some((i) => /rol desconocido "mago"/.test(i)));
  assert.ok(issues.some((i) => /onFail.goto "zz" no existe/.test(i)));
  assert.ok(issues.some((i) => /depende de "nada"/.test(i)));
  assert.ok(issues.every((i) => typeof i === 'string'));
  assert.deepEqual(lib.resolvePipeline('y', { stages: [] }).issues, ['el pipeline no tiene etapas']);
});

/** Corre un pipeline como lo haría un agente: cada etapa devuelve outputs[id] (o "<id> ok"). */
async function drive(pipelineRaw, { outputs = {}, gates = {}, onPrompt } = {}) {
  const pipeline = lib.resolvePipeline('p', pipelineRaw);
  const events = [], statuses = [], prompts = [];
  let gateCalls = 0;
  const exec = async (cmd) => { gateCalls++; const g = gates[cmd]; return { passed: typeof g === 'function' ? g(gateCalls) : !!g, tail: `salida de ${cmd}` }; };
  const run = new lib.PipelineRun({ id: 'r1', project: { dir: os.tmpdir(), name: 'Demo' }, pipeline, task: 'Cupones', report: (e) => events.push(e), onStatus: (s) => statuses.push(s), exec });
  let step = run.start();
  while (step.action === 'prompt') {
    prompts.push({ id: step.stage.id, prompt: step.prompt });
    onPrompt?.(run, step);
    if (run.status !== 'running') break;
    step = await run.advance(outputs[step.stage.id] ?? `${step.stage.id} ok`);
  }
  return { run, step, events, statuses, prompts };
}

test('PipelineRun: orden por dependencias, contexto entre etapas y fases para la oficina', async () => {
  const { step, events, prompts, statuses } = await drive({ name: 'Demo', stages: [
    { id: 'plan', name: 'Plan', role: 'tl', phase: 'arquitectura', agent: 'architect' },
    { id: 'api', name: 'API', role: 'backend', needs: ['plan'], prompt: 'Implementa {{task}} según:\n{{plan.output}}' },
    { id: 'qa', name: 'QA', role: 'qa', phase: 'verifica', needs: ['api'] },
  ] }, { outputs: { plan: 'usar tabla coupons' } });
  assert.equal(step.action, 'done');
  assert.deepEqual(prompts.map((p) => p.id), ['plan', 'api', 'qa']);
  assert.match(prompts[0].prompt, /^\[Dev Team Office · etapa 1\/3\]/);
  assert.match(prompts[1].prompt, /Implementa Cupones según:\nusar tabla coupons/);
  assert.match(prompts[2].prompt, /### API \(Backend\)\napi ok/); // lo de la etapa anterior
  // la oficina ve: la tarea, quién es cada subagente, cada fase con su traspaso y el final
  assert.deepEqual(events.filter((e) => e.kind === 'phase').map((e) => [e.role, e.phase, e.from]), [['tl', 'arquitectura', undefined], ['backend', 'implementa', 'tl'], ['qa', 'verifica', 'backend']]);
  assert.deepEqual(events.find((e) => e.kind === 'agent_roles').roles, { architect: 'tl' });
  assert.equal(events.at(-1).kind, 'done'); // el final va último (después del tablero)
  assert.deepEqual(statuses.at(-1).stages.map((s) => s.status), ['done', 'done', 'done']);
  assert.equal(statuses.at(-1).status, 'done');
});

test('PipelineRun: RED debe fallar, GREEN debe pasar y si no vuelve a implementar', async () => {
  const { step, prompts, events, run } = await drive({ name: 'TDD', stages: [
    { id: 'red', role: 'qa', phase: 'red', check: { run: 'npm test', expect: 'fail' } },
    { id: 'impl', role: 'backend', needs: ['red'] },
    { id: 'green', role: 'qa', phase: 'green', needs: ['impl'], check: { run: 'npm test', expect: 'pass' }, onFail: { goto: 'impl', max: 2 } },
  ] }, { gates: { 'npm test': (n) => n >= 3 } }); // 1º (RED) falla bien, 2º (GREEN) falla, 3º pasa
  assert.equal(step.action, 'done');
  assert.deepEqual(prompts.map((p) => p.id), ['red', 'impl', 'green', 'impl', 'green']);
  assert.match(prompts[3].prompt, /El intento anterior no pasó\. Corrige esto:\n`npm test` falló:\nsalida de npm test/);
  assert.match(prompts[0].prompt, /debe FALLAR/);
  assert.deepEqual(events.filter((e) => e.kind === 'stage_end').map((e) => e.ok), [true, true, false, true, true]);
  assert.equal(run.stage('impl').attempts, 2);
  // el gate se ve como un Bash del rol de turno
  assert.ok(events.some((e) => e.kind === 'tool_start' && e.tool === 'Bash' && e.role === 'qa'));
});

test('PipelineRun: sin más reintentos falla; un RED que pasa no sirve; cancelar detiene todo', async () => {
  let r = await drive({ stages: [
    { id: 'impl', role: 'backend' },
    { id: 'green', role: 'qa', needs: ['impl'], check: { run: 't', expect: 'pass' }, onFail: { goto: 'impl', max: 1 } },
  ] }, { gates: { t: false } });
  assert.equal(r.step.action, 'failed');
  assert.match(r.step.reason, /falló/);
  assert.equal(r.statuses.at(-1).status, 'failed');

  r = await drive({ stages: [{ id: 'red', role: 'qa', check: { run: 't', expect: 'fail' } }] }, { gates: { t: true } });
  assert.match(r.step.reason, /pasó, y en esta etapa debía fallar/);

  r = await drive({ stages: [{ id: 'a', role: 'tl' }, { id: 'b', role: 'backend', needs: ['a'] }] }, { onPrompt: (run) => run.cancel() });
  assert.equal(r.run.status, 'cancelled');
  assert.deepEqual(r.run.stages.map((s) => s.status), ['cancelled', 'skipped']);
  assert.match(r.events.at(-1).text, /cancelado/);

  r = await drive({ stages: [{ id: 'a', needs: ['a'] }] });
  assert.equal(r.step.action, 'failed'); // un pipeline con errores no arranca
  assert.equal(r.prompts.length, 0);
});

test('PipelineRun se guarda y se retoma (el hook de Claude vive un proceso por evento)', async () => {
  const pipeline = lib.resolvePipeline('p', { stages: [{ id: 'a', role: 'tl' }, { id: 'b', role: 'backend', needs: ['a'] }] });
  const run = new lib.PipelineRun({ id: 'r9', project: { dir: '/x', name: 'X' }, pipeline, task: 'T' });
  run.start();
  const state = JSON.parse(JSON.stringify(run.toJSON()));
  const again = lib.PipelineRun.restore(state, {});
  const step = await again.advance('A listo');
  assert.equal(step.stage.id, 'b');
  assert.match(step.prompt, /A listo/);
  assert.equal((await again.advance('B listo')).action, 'done');
});

test('transcript de Claude: última respuesta y modelo; ¿la etapa pide el mismo modelo?', () => {
  const file = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(file, [
    { type: 'user', message: { content: 'hola' } },
    { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Plan listo' }, { type: 'tool_use', id: 'x' }] } },
    { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'tool_use', id: 'y' }] } },
  ].map((x) => JSON.stringify(x)).join('\n'));
  assert.equal(lib.lastAssistantText(file), 'Plan listo');
  assert.equal(lib.lastAssistantModel(file), 'claude-opus-5-5');
  assert.equal(lib.lastAssistantText('/no/existe'), '');
  assert.ok(lib.sameModel('opus', 'claude-opus-5-5'));
  assert.ok(lib.sameModel('anthropic/claude-opus-5-5', 'claude-opus-5-5'));
  assert.ok(!lib.sameModel('sonnet', 'claude-opus-5-5'));
  assert.ok(!lib.sameModel('opus', ''));
});

test('claudeChild: etapa con otro modelo como `claude -p --model`, sin el prefijo del proveedor', async () => {
  const log = path.join(tmp(), 'claude.log');
  process.env.FAKE_CLAUDE_LOG = log;
  try {
    const res = await lib.claudeChild({ prompt: 'Revisa', model: 'anthropic/claude-sonnet-5-5', agent: 'code-reviewer', cwd: os.tmpdir(), bin: FAKE_CLAUDE, env: { DEV_TEAM_OFFICE_SESSION_ALIAS: 'c1' } });
    assert.deepEqual(res, { ok: true, output: 'hecho con claude-sonnet-5-5 como code-reviewer' });
    const call = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.deepEqual([call.model, call.agent, call.alias, call.prompt], ['claude-sonnet-5-5', 'code-reviewer', 'c1', 'Revisa']);
    assert.ok(call.args.includes('acceptEdits'));
    process.env.FAKE_CLAUDE_FAIL = '1';
    const bad = await lib.claudeChild({ prompt: 'x', model: 'opus', cwd: os.tmpdir(), bin: FAKE_CLAUDE });
    assert.equal(bad.ok, false);
    assert.match(bad.output, /algo salió mal/);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
    delete process.env.FAKE_CLAUDE_FAIL;
  }
});

test('launchAgent: la tarea viaja como un solo argumento, sin shell, y la sesión nueva es otra', async () => {
  const bin = tmp();
  const out = path.join(bin, 'out.json');
  fs.writeFileSync(path.join(bin, 'pi'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), launched: process.env.DEV_TEAM_OFFICE_LAUNCHED, session: process.env.DEV_TEAM_OFFICE_SESSION || null }));\n`, { mode: 0o755 });
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${PATH}`;
  process.env.DEV_TEAM_OFFICE_SESSION = 'pi-padre';
  try {
    const evil = 'hola"; touch /tmp/pwned-dto; echo "$(whoami)';
    const r = lib.launchAgent({ harness: 'pi', task: evil, cwd: bin });
    assert.equal(r.ok, true, r.error);
    const code = await new Promise((res) => r.child.on('exit', res));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { argv: ['-p', evil], launched: '1', session: null });
    assert.equal(fs.existsSync('/tmp/pwned-dto'), false);
    assert.match(lib.launchAgent({ harness: 'pi', task: 'x', cwd: '/no/existe' }).error, /no existe/);
    assert.match(lib.launchAgent({ harness: 'emacs', task: 'x' }).error, /no sé lanzar/);
  } finally {
    process.env.PATH = PATH;
    delete process.env.DEV_TEAM_OFFICE_SESSION;
  }
});
