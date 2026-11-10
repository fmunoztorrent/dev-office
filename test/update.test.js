// Offline tests for the self-update path: install.sh picks the highest version tag, never downgrades
// an auto-resolved install, and `update` re-downloads the installer. A stub curl answers the GitHub
// endpoints, tarballs are built in temp dirs, and everything runs against a fake HOME — no network
// and no real HOME. The DEV_TEAM_OFFICE_SESSION / DEV_TEAM_OFFICE_PI_PID vars are not forwarded.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_SH = path.join(ROOT, 'install.sh');
const APP = path.join('.dev-team-office', 'app');
const REPO_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const tmpDirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const readJson = (base, rel) => JSON.parse(fs.readFileSync(path.join(base, rel), 'utf8'));
const version = (home) => readJson(home, path.join(APP, 'package.json')).version;
const marker = (home) => path.join(home, APP, 'marker');

// The stub curl: a `#!/usr/bin/env node` script first on PATH. It appends each argv to STUB_LOG and
// answers three URL shapes from the environment (tags JSON, codeload tarballs, any install.sh).
const CURL_STUB = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  'const args = process.argv.slice(2);',
  "if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + '\\n');",
  "const url = args.find((a) => a.startsWith('http://') || a.startsWith('https://'));",
  "const oi = args.indexOf('-o');",
  'const out = oi >= 0 ? args[oi + 1] : null;',
  "const emit = (data) => (out ? fs.writeFileSync(out, data) : process.stdout.write(data));",
  "if (process.env.STUB_HTTP2 === 'fail' && !args.includes('--http1.1')) {",
  "  process.stderr.write('curl: (16) Error in the HTTP2 framing layer\\n');",
  '  process.exit(16);',
  '}',
  "if (url && url.includes('api.github.com') && url.includes('/tags')) {",
  '  if (process.env.STUB_TAGS === undefined) process.exit(22);',
  '  emit(process.env.STUB_TAGS);',
  '  process.exit(0);',
  '}',
  "if (url && url.includes('codeload.github.com') && url.includes('/tar.gz/')) {",
  "  const ref = url.slice(url.lastIndexOf('/') + 1);",
  "  const src = process.env.STUB_DIR + '/' + ref + '.tgz';",
  "  if (!fs.existsSync(src)) process.exit(22);",
  '  emit(fs.readFileSync(src));',
  '  process.exit(0);',
  '}',
  "if (url && url.includes('install.sh')) {",
  '  emit(fs.readFileSync(process.env.STUB_INSTALL_SH));',
  '  process.exit(0);',
  '}',
  'process.exit(22);',
  '',
].join('\n');

function setupStub() {
  const dir = tmp('dto-stub-');
  write(path.join(dir, 'curl'), CURL_STUB);
  fs.chmodSync(path.join(dir, 'curl'), 0o755);
  return dir;
}

// A tarball with a single top-level dir holding bin/dev-team-office.js and package.json {version}.
function makeTarball(dir, name, version) {
  const top = 'dev-office-' + version;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-tar-'));
  try {
    write(path.join(base, top, 'bin', 'dev-team-office.js'), '#!/usr/bin/env node\n// stub app\n');
    write(path.join(base, top, 'package.json'), JSON.stringify({ name: 'dev-team-office', version }));
    const r = spawnSync('tar', ['-czf', path.join(dir, name), '-C', base, top]);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// A fake installed app at the given version, plus a marker file that survives only if it is not replaced.
function fakeHome(version) {
  const home = tmp('dto-home-');
  write(path.join(home, APP, 'package.json'), JSON.stringify({ name: 'dev-team-office', version }));
  write(marker(home), 'keep me\n');
  return home;
}

function makeEnv(home, stub, extra = {}) {
  return {
    PATH: stub + ':' + process.env.PATH,
    HOME: home,
    LANG: 'en_US.UTF-8',
    DEV_TEAM_OFFICE_NO_SETUP: '1',
    STUB_LOG: path.join(stub, 'curl.log'),
    STUB_DIR: stub,
    STUB_INSTALL_SH: INSTALL_SH,
    ...extra,
  };
}

const runInstall = (home, stub, extra = {}) => spawnSync('sh', [INSTALL_SH], { env: makeEnv(home, stub, extra), encoding: 'utf8' });
const runUpdate = (home, stub, extra = {}) => spawnSync('node', [path.join(home, APP, 'bin', 'dev-team-office.js'), 'update'], { env: makeEnv(home, stub, extra), encoding: 'utf8' });

const curlCalls = (stub) => {
  const file = path.join(stub, 'curl.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('instala la etiqueta de versión más alta comparando por número, e ignora prereleases y nombres que no son semver', () => {
  const stub = setupStub();
  makeTarball(stub, 'v0.10.0.tgz', '0.10.0');
  const home = tmp('dto-home-'); // fresh install: no app yet
  const tags = JSON.stringify([{ name: 'v0.6.0' }, { name: 'v0.7.0' }, { name: 'v0.9.1' }, { name: 'v0.10.0' }, { name: 'v1.0.0-rc.1' }, { name: 'foo' }]);
  const r = runInstall(home, stub, { STUB_TAGS: tags });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(version(home), '0.10.0');
  assert.ok(fs.existsSync(path.join(home, APP, 'bin', 'dev-team-office.js')));
});

test('no baja de versión: con una versión instalada más nueva avisa, la deja intacta y no consulta releases/latest', () => {
  const stub = setupStub();
  makeTarball(stub, 'v0.6.0.tgz', '0.6.0');
  const home = fakeHome('0.7.0');
  const r = runInstall(home, stub, { STUB_TAGS: JSON.stringify([{ name: 'v0.6.0' }]) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not downgrading/);
  assert.equal(version(home), '0.7.0');
  assert.ok(fs.existsSync(marker(home)));
  const raw = fs.readFileSync(path.join(stub, 'curl.log'), 'utf8');
  assert.ok(!raw.includes('releases/latest'), raw);
});

test('si la API de tags falla y main es más viejo que lo instalado, tampoco baja de versión', () => {
  const stub = setupStub();
  makeTarball(stub, 'main.tgz', '0.6.0');
  const home = fakeHome('0.7.0');
  const r = runInstall(home, stub, {}); // no STUB_TAGS: the tags call fails, install.sh falls back to main
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not downgrading/);
  assert.equal(version(home), '0.7.0');
  assert.ok(fs.existsSync(marker(home)));
});

test('con DEV_TEAM_OFFICE_REF explícito instala esa versión aunque sea más vieja que la instalada', () => {
  const stub = setupStub();
  makeTarball(stub, 'v0.6.0.tgz', '0.6.0');
  const home = fakeHome('0.7.0');
  const r = runInstall(home, stub, { DEV_TEAM_OFFICE_REF: 'v0.6.0' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(version(home), '0.6.0');
  assert.ok(!fs.existsSync(marker(home))); // the app was replaced, the marker is gone
});

test('si HTTP/2 falla reintenta con --http1.1 y la instalación se completa', () => {
  const stub = setupStub();
  makeTarball(stub, 'v0.9.0.tgz', '0.9.0');
  const home = tmp('dto-home-');
  const r = runInstall(home, stub, { STUB_TAGS: JSON.stringify([{ name: 'v0.9.0' }]), STUB_HTTP2: 'fail' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(version(home), '0.9.0');
  const calls = curlCalls(stub);
  const retry = calls.findIndex((a) => a.includes('--http1.1'));
  assert.ok(retry > 0, 'no hubo un reintento con --http1.1');
  assert.ok(calls.slice(0, retry).some((a) => !a.includes('--http1.1')), 'no hubo una llamada previa sin --http1.1');
});

test('con DEV_TEAM_OFFICE_UPDATE_FROM igual al target avisa y no reinstala; sin él, la misma versión sí reinstala', () => {
  const tags = JSON.stringify([{ name: 'v0.7.0' }]);
  // UPDATE_FROM == target: "already the latest", the installed copy (marker) stays.
  const stub1 = setupStub();
  makeTarball(stub1, 'v0.7.0.tgz', '0.7.0');
  const home1 = fakeHome('0.7.0');
  const r1 = runInstall(home1, stub1, { STUB_TAGS: tags, DEV_TEAM_OFFICE_UPDATE_FROM: '0.7.0' });
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /already the latest/);
  assert.ok(fs.existsSync(marker(home1)));
  // Without UPDATE_FROM the guard only blocks a downgrade, so the same version reinstalls.
  const stub2 = setupStub();
  makeTarball(stub2, 'v0.7.0.tgz', '0.7.0');
  const home2 = fakeHome('0.7.0');
  const r2 = runInstall(home2, stub2, { STUB_TAGS: tags });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(version(home2), '0.7.0');
  assert.ok(!fs.existsSync(marker(home2)));
});

test('update de punta a punta: vuelve a bajar el instalador y no baja de versión si el target es más viejo', () => {
  const stub = setupStub();
  makeTarball(stub, 'v0.0.1.tgz', '0.0.1');
  const home = tmp('dto-home-');
  const first = runInstall(home, stub, { DEV_TEAM_OFFICE_SOURCE: ROOT }); // a repo copy, as release.test.js installs it
  assert.equal(first.status, 0, first.stderr);
  const r = runUpdate(home, stub, {
    DEV_TEAM_OFFICE_INSTALLER: 'https://raw.githubusercontent.com/x/install.sh',
    STUB_HTTP2: 'fail',
    STUB_TAGS: JSON.stringify([{ name: 'v0.0.1' }]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not downgrading/);
  assert.equal(version(home), REPO_VERSION); // the running copy is unchanged
  const installer = curlCalls(stub).filter((a) => a.some((x) => String(x).includes('install.sh')));
  assert.ok(installer.some((a) => a.includes('--http1.1')), 'el instalador no se bajó con --http1.1');
  assert.ok(installer.some((a) => !a.includes('--http1.1')), 'no hubo un primer intento sin --http1.1');
});

test('update de punta a punta: avisa cuando el target es la misma versión que la instalada', () => {
  const stub = setupStub();
  makeTarball(stub, `v${REPO_VERSION}.tgz`, REPO_VERSION);
  const home = tmp('dto-home-');
  const first = runInstall(home, stub, { DEV_TEAM_OFFICE_SOURCE: ROOT });
  assert.equal(first.status, 0, first.stderr);
  const r = runUpdate(home, stub, {
    DEV_TEAM_OFFICE_INSTALLER: 'https://raw.githubusercontent.com/x/install.sh',
    STUB_TAGS: JSON.stringify([{ name: `v${REPO_VERSION}` }]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already the latest/);
  assert.equal(version(home), REPO_VERSION);
});
