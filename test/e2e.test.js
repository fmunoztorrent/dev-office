// The end-to-end tests, watched (server/e2e.js, server/zip.js, integrations/playwright/reporter.cjs): the
// reporter tells the office what a Playwright run does, live; each test's trace becomes its frames and
// its actions (with where it clicked); only files inside the run's folder are read; QA does it in the game.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { zipEntries, zipRead } from '../server/zip.js';
import { parseTrace, e2eCommand, E2EDesk } from '../server/e2e.js';
import { startServer } from '../server/server.js';
import { e2eEnv, e2eReporter } from '../integrations/common/devteam.mjs';

const require = createRequire(import.meta.url);
const Reporter = require('../integrations/playwright/reporter.cjs');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dto-e2e-test-')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** A small ZIP writer: each entry stored (method 0) or deflated (8), as Playwright writes them. */
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [i, [name, content]] of Object.entries(files).entries()) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const deflate = i % 2 === 0;
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const jsonl = (xs) => xs.map((x) => JSON.stringify(x)).join('\n');

/** A trace like Playwright's: the runner's steps (test.trace) and the browser's (0-trace.trace), with frames. */
function trace({ fail = false } = {}) {
  const steps = [
    { type: 'before', callId: 'hook@1', method: 'hook', title: 'Before Hooks', startTime: 1000 },
    { type: 'before', callId: 'fixture@2', parentId: 'hook@1', method: 'fixture', title: 'Fixture "page"', startTime: 1001 },
    { type: 'before', callId: 'pw:api@3', parentId: 'fixture@2', method: 'pw:api', title: 'Create page', startTime: 1002 },
    { type: 'after', callId: 'pw:api@3', endTime: 1010 },
    { type: 'after', callId: 'fixture@2', endTime: 1011 },
    { type: 'after', callId: 'hook@1', endTime: 1012 },
    { type: 'before', callId: 'pw:api@4', method: 'pw:api', title: 'Navigate to "/login"', startTime: 1100 },
    { type: 'after', callId: 'pw:api@4', endTime: 1200 },
    { type: 'before', callId: 'test.step@5', method: 'test.step', title: 'entrar', startTime: 1210 },
    { type: 'before', callId: 'pw:api@6', parentId: 'test.step@5', method: 'pw:api', title: 'Click', params: { locator: "getByRole('button', { name: 'Entrar' })" }, startTime: 1220 },
    { type: 'after', callId: 'pw:api@6', endTime: 1300 },
    { type: 'after', callId: 'test.step@5', endTime: 1301 },
    { type: 'before', callId: 'expect@7', method: 'expect', title: 'Expect "toHaveText"', params: { locator: '#hola' }, startTime: 1310 },
    { type: 'after', callId: 'expect@7', endTime: 1400, ...(fail ? { error: { message: '\x1b[31mexpected "Hola"\x1b[39m' } } : {}) },
  ];
  const lib = [
    { type: 'screencast-frame', file: 'screencast/page@a-1100.jpeg', timestamp: 1100, width: 800, height: 450 },
    { type: 'before', callId: 'call@1', stepId: 'pw:api@6', title: 'click', startTime: 1220 },
    { type: 'input', callId: 'call@1', point: { x: 120.4, y: 33.6 } },
    { type: 'after', callId: 'call@1', endTime: 1300 },
    { type: 'screencast-frame', file: 'screencast/page@a-1250.jpeg', timestamp: 1250, width: 800, height: 450 },
    { type: 'screencast-frame', file: 'screencast/page@a-missing.jpeg', timestamp: 1260, width: 800, height: 450 },
  ];
  return zip({ 'test.trace': jsonl(steps), '0-trace.trace': jsonl(lib), 'screencast/page@a-1100.jpeg': JPEG, 'screencast/page@a-1250.jpeg': JPEG });
}

test('el lector de zip abre entradas guardadas y comprimidas, y dice si no es un zip', () => {
  const buf = zip({ 'a.txt': 'hola', 'b/c.json': '{"x":1}' });
  const entries = zipEntries(buf);
  assert.deepEqual([...entries.keys()], ['a.txt', 'b/c.json']);
  assert.equal(zipRead(buf, entries, 'a.txt').toString(), 'hola');
  assert.equal(zipRead(buf, entries, 'b/c.json').toString(), '{"x":1}');
  assert.equal(zipRead(buf, entries, 'nada'), null);
  assert.throws(() => zipEntries(Buffer.from('no soy un zip, sólo texto suelto')), /not a zip/);
});

test('una traza da sus cuadros y las acciones de la prueba (no las de los fixtures), con dónde hizo clic y el error', () => {
  const tr = parseTrace(trace({ fail: true }));
  assert.deepEqual(tr.frames.map((f) => [f.t, f.w, f.h]), [[1100, 800, 450], [1250, 800, 450]], 'el cuadro que no está en el zip no cuenta');
  assert.deepEqual(tr.read(tr.frames[0].name), JPEG);
  assert.deepEqual(tr.actions.map((a) => [a.title, a.category, a.depth]), [['Navigate to "/login"', 'pw:api', 0], ['entrar', 'test.step', 0], ['Click', 'pw:api', 1], ['Expect "toHaveText"', 'expect', 0]]);
  const click = tr.actions.find((a) => a.title === 'Click');
  assert.deepEqual(click.point, { x: 120, y: 34 });
  assert.match(click.subtitle, /Entrar/);
  assert.equal(tr.actions.at(-1).error, 'expected "Hola"', 'sin los colores de la terminal');
  assert.deepEqual([tr.start, tr.end], [1100, 1400]);
});

test('una traza sin los pasos del runner muestra las llamadas del navegador', () => {
  const lib = [
    { type: 'before', callId: 'c1', title: 'page.goto', params: { url: 'http://x/' }, startTime: 10 },
    { type: 'after', callId: 'c1', endTime: 20 },
    { type: 'before', callId: 'c2', title: 'locator.click', params: { selector: '#ok' }, startTime: 30 },
    { type: 'input', callId: 'c2', box: { x: 10, y: 20, width: 40, height: 10 } },
    { type: 'after', callId: 'c2', endTime: 40, error: { message: 'Timeout' } },
  ];
  const tr = parseTrace(zip({ 'trace.trace': jsonl(lib) }));
  assert.deepEqual(tr.actions.map((a) => [a.title, a.subtitle, a.error]), [['page.goto', 'http://x/', ''], ['locator.click', '#ok', 'Timeout']]);
  assert.deepEqual(tr.actions[1].point, { x: 30, y: 25 });
});

test('dev-team-office e2e: el comando de Playwright va con la traza encendida, salvo que diga otra cosa; un script va como es', () => {
  assert.deepEqual(e2eCommand(['npx', 'playwright', 'test', 'tests/login.spec.ts']), ['npx', 'playwright', 'test', 'tests/login.spec.ts', '--trace=on']);
  assert.deepEqual(e2eCommand(['pnpm', 'exec', 'playwright', 'test']), ['pnpm', 'exec', 'playwright', 'test', '--trace=on']);
  assert.deepEqual(e2eCommand(['node_modules/.bin/playwright', 'test']), ['node_modules/.bin/playwright', 'test', '--trace=on']);
  assert.deepEqual(e2eCommand(['node', 'node_modules/playwright/cli.js', 'test']), ['node', 'node_modules/playwright/cli.js', 'test', '--trace=on']);
  assert.deepEqual(e2eCommand(['npx', 'playwright', 'test', '--trace=retain-on-failure']), ['npx', 'playwright', 'test', '--trace=retain-on-failure']);
  assert.deepEqual(e2eCommand(['npx', 'playwright', 'test', '--trace', 'off']), ['npx', 'playwright', 'test', '--trace', 'off']);
  assert.deepEqual(e2eCommand(['npm', 'run', 'e2e']), ['npm', 'run', 'e2e']);
  assert.deepEqual(e2eCommand(['npx', 'playwright', 'show-report']), ['npx', 'playwright', 'show-report']);
});

test('los agentes reciben el reporter en su entorno, salvo que ya tengan uno', () => {
  const reporter = e2eReporter();
  assert.ok(reporter && fs.existsSync(reporter));
  assert.deepEqual(e2eEnv({}), { PW_TEST_REPORTER: reporter });
  assert.deepEqual(e2eEnv({ PW_TEST_REPORTER: '/otro/reporter.js' }), {});
});

/** The reporter's calls for a run of two tests: one passes; the other fails, with its trace and a screenshot. */
async function playRun(reporter, dir, { outside } = {}) {
  const results = path.join(dir, 'test-results');
  fs.mkdirSync(path.join(results, 'b'), { recursive: true });
  fs.writeFileSync(path.join(results, 'b', 'trace.zip'), trace({ fail: true }));
  fs.writeFileSync(path.join(results, 'b', 'fallo.png'), JPEG);
  const project = { name: 'chromium', project: () => ({ name: 'chromium' }) };
  const t1 = { id: 't1', title: 'entra', location: { file: path.join(dir, 'tests/login.spec.js'), line: 3 }, parent: project, expectedStatus: 'passed' };
  const t2 = { id: 't2', title: 'saluda', location: { file: path.join(dir, 'tests/login.spec.js'), line: 12 }, parent: project, expectedStatus: 'passed' };
  reporter.onBegin({ rootDir: dir, version: '1.63.0', workers: 1, projects: [{ name: 'chromium', outputDir: results, use: { trace: 'on' } }] }, { allTests: () => [t1, t2] });
  reporter.onTestBegin(t1, { retry: 0 });
  const fixture = { category: 'fixture', title: 'page' };
  reporter.onStepEnd(t1, {}, { category: 'pw:api', title: 'Create page', parent: fixture });
  reporter.onStepEnd(t1, {}, { category: 'pw:api', title: 'Navigate to "/login"', startTime: new Date(), duration: 80, location: { line: 4 } });
  const step = { category: 'test.step', title: 'entrar' };
  reporter.onStepEnd(t1, {}, { category: 'pw:api', title: 'Click', parent: step, duration: 30 });
  reporter.onStepEnd(t1, {}, step);
  reporter.onTestEnd(t1, { status: 'passed', duration: 300, retry: 0, attachments: [] });
  reporter.onTestBegin(t2, { retry: 0 });
  reporter.onStepEnd(t2, {}, { category: 'expect', title: 'Expect "toHaveText"', error: { message: '\x1b[31mexpected "Hola"\x1b[39m' } });
  reporter.onTestEnd(t2, { status: 'failed', duration: 500, retry: 0, error: { message: 'expected "Hola"' }, attachments: [
    { name: 'trace', contentType: 'application/zip', path: path.join(results, 'b', 'trace.zip') },
    { name: 'screenshot', contentType: 'image/png', path: path.join(results, 'b', 'fallo.png') },
    { name: 'screenshot', contentType: 'image/png', path: outside },
    { name: 'stdout', contentType: 'text/plain', body: 'hola' },
  ] });
  await reporter.onEnd({ status: 'failed', duration: 1234 });
}

test('el reporter le cuenta a la oficina la corrida en vivo; la oficina guarda la película de cada prueba, sólo de la carpeta de la corrida', async () => {
  const dir = tmp();
  const outside = path.join(tmp(), 'secreto.png');
  fs.writeFileSync(outside, JPEG);
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false, standup: { every: 0 }, loops: { autostart: false } });
  const port = new URL(server.url).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
  const pushed = [];
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.type === 'e2e') pushed.push(x.runs); };
  await new Promise((r) => { ws.onopen = r; });
  try {
    server.store.createAgent({ path: dir, harness: 'claude-code', name: 'tienda', bin: '/nonexistent/claude' });
    const reporter = new Reporter({ url: server.url });
    reporter.cwd = dir;
    await playRun(reporter, dir, { outside });
    await wait(400);

    const list = await (await fetch(`${server.url}/v1/e2e`)).json();
    assert.equal(list.runs.length, 1);
    const [summary] = list.runs;
    assert.equal(summary.project, 'tienda');
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.counts, { passed: 1, failed: 1, skipped: 0, running: 0 });
    assert.equal(summary.trace, 'on');
    assert.match(summary.last.frame, /\/v1\/e2e\/.+\/2\/frame\/1$/, 'la mini pantalla muestra el último cuadro de la última prueba con película');
    assert.ok(pushed.length && pushed.at(-1)[0].status === 'failed', 'la pantalla se entera por WebSocket');

    const { run } = await (await fetch(`${server.url}/v1/e2e/${summary.id}`)).json();
    const [a, b] = run.tests;
    assert.deepEqual([a.title, a.file, a.line, a.status], ['entra', 'tests/login.spec.js', 3, 'passed']);
    assert.deepEqual(a.steps.map((s) => [s.title, s.depth]), [['Navigate to "/login"', 0], ['Click', 1], ['entrar', 0]], 'sin los pasos de los fixtures');
    assert.equal(b.status, 'failed');
    assert.equal(b.steps[0].error, 'expected "Hola"');
    assert.equal(b.frames.length, 2);
    assert.equal(b.actions.find((x) => x.title === 'Click').point.x, 120);
    assert.equal(b.shots.length, 1, 'la captura de fuera de la carpeta no se lee');

    const frame = await fetch(`${server.url}${b.frames[0].url}`);
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await frame.arrayBuffer()), JPEG);
    assert.equal((await fetch(`${server.url}${b.shots[0]}`)).status, 200);
    assert.equal((await fetch(`${server.url}/v1/e2e/${summary.id}/2/shot/1`)).status, 404);
    assert.equal((await fetch(`${server.url}/v1/e2e/${summary.id}/2/frame/x`)).status, 404);
    assert.equal((await fetch(`${server.url}/v1/e2e/nada`)).status, 404);

    // QA hizo la corrida en el juego: empezó, una falló, terminó
    const log = server.office.snapshot().log.filter((e) => e.kind === 'e2e');
    assert.deepEqual(log.map((e) => [e.phase, e.role]), [['start', 'qa'], ['fail', 'qa'], ['end', 'qa']]);
    assert.match(log[0].text, /2 prueba\(s\) e2e de tienda/);
    assert.match(log[1].text, /saluda/);
    assert.match(log[2].text, /1 ✓ · 1 ✗/);

    assert.equal((await fetch(`${server.url}/v1/e2e/${summary.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await fetch(`${server.url}/v1/e2e`)).json()).runs, []);
    assert.equal((await fetch(`${server.url}${b.frames[0].url}`)).status, 404);
  } finally {
    ws.close();
    await server.close();
  }
});

test('el reporter no le estorba a las pruebas si la oficina no está', async () => {
  const reporter = new Reporter({ url: 'http://127.0.0.1:9' });
  const dir = tmp();
  reporter.cwd = dir;
  const t0 = Date.now();
  await playRun(reporter, dir, { outside: '/nonexistent.png' });
  assert.ok(Date.now() - t0 < 2500);
  assert.equal(reporter.dead, true);
  assert.equal(reporter.printsToStdio(), false);
});

test('la mesa: datos raros no entran, las corridas viejas se olvidan, y una corrida callada queda interrumpida', () => {
  let now = 1_000_000;
  const desk = new E2EDesk({ now: () => now });
  try {
    const dir = tmp();
    assert.equal(desk.receive({ run: '../x', cwd: dir, events: [] }).ok, false);
    assert.equal(desk.receive({ run: 'r1', cwd: 'relativo', events: [] }).ok, false);
    assert.equal(desk.receive({ run: 'r1', cwd: dir, events: 'no' }).ok, false);
    for (let i = 1; i <= 8; i++) desk.receive({ run: `r${i}`, cwd: dir, events: [{ type: 'begin', total: 1 }, { type: 'test', test: 'a', title: 'x' }, { type: 'step', test: 'nadie', title: 'y' }] });
    const runs = desk.list();
    assert.equal(runs.length, 6, 'sólo las últimas seis');
    assert.equal(runs[0].id, 'r8');
    assert.equal(runs[0].project, path.basename(dir), 'sin proyecto registrado, el nombre de la carpeta');
    assert.deepEqual(runs[0].current, { test: 1, title: 'x', step: '' });
    now += 11 * 60_000;
    assert.equal(desk.list()[0].status, 'interrupted');
    assert.equal(desk.remove('r1').ok, false);
  } finally {
    desk.close();
  }
  assert.equal(fs.existsSync(desk.dir), false, 'su carpeta temporal se borra');
});

test('al abrir, la mesa borra lo que dejó una oficina anterior en su carpeta, y sólo lo que ella hizo', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'run-viejo', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-viejo', '.dev-team-office-e2e'), '');
  fs.writeFileSync(path.join(dir, 'run-viejo', '1', 'f0.jpg'), JPEG);
  fs.mkdirSync(path.join(dir, 'run-ajeno'));
  fs.writeFileSync(path.join(dir, 'run-ajeno', 'mio.txt'), 'no es de la oficina');
  fs.mkdirSync(path.join(dir, 'proyecto'));
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'tampoco');
  const desk = new E2EDesk({ dir });
  // a run named like a folder that is not the desk's: forgetting it leaves that folder alone
  for (const id of ['proyecto', 'ajeno', 'a', 'b', 'c', 'd', 'e']) desk.receive({ run: id, cwd: dir, events: [{ type: 'test', test: 'x', title: 'x' }] });
  desk.remove('ajeno');
  desk.close();
  assert.deepEqual(fs.readdirSync(dir).sort(), ['nota.txt', 'proyecto', 'run-ajeno']);
  assert.ok(fs.existsSync(path.join(dir, 'run-ajeno', 'mio.txt')));
});

test('sin traza, la mini pantalla muestra el video; al terminar con fallas, el de la prueba que falló', async () => {
  const dir = tmp();
  const desk = new E2EDesk({});
  try {
    for (const n of ['a', 'b']) { fs.mkdirSync(path.join(dir, n)); fs.writeFileSync(path.join(dir, n, 'video.webm'), `video ${n}`); }
    const video = (n) => [{ name: 'video', contentType: 'video/webm', path: path.join(dir, n, 'video.webm') }];
    desk.receive({ run: 'v1', cwd: dir, events: [
      { type: 'begin', total: 2, projects: [{ trace: 'off', video: 'on' }] },
      { type: 'test', test: 'a', title: 'falla' }, { type: 'testEnd', test: 'a', status: 'failed', attachments: video('a') },
      { type: 'test', test: 'b', title: 'pasa' }, { type: 'testEnd', test: 'b', status: 'passed', attachments: video('b') },
    ] });
    await wait(50);
    assert.deepEqual(desk.list()[0].last, { test: 2, title: 'pasa', video: '/v1/e2e/v1/2/video' }, 'mientras corre, la última');
    desk.receive({ run: 'v1', cwd: dir, events: [{ type: 'end', status: 'failed' }] });
    await wait(50);
    assert.deepEqual(desk.list()[0].last, { test: 1, title: 'falla', video: '/v1/e2e/v1/1/video' });
    assert.equal(fs.readFileSync(desk.file('v1', 1, 'video').path, 'utf8'), 'video a');
  } finally {
    desk.close();
  }
});
