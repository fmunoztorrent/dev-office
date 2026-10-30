// What a release needs: one version everywhere (package, server, Claude Code plugin), a license and
// a changelog entry for that version, so what gets distributed is consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../server/server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('la versión es la misma en el paquete, el servidor y el plugin de Claude Code', () => {
  const { version } = json('package.json');
  assert.equal(VERSION, version);
  assert.equal(json('.claude-plugin/plugin.json').version, version);
  assert.equal(json('package-lock.json').version, version);
});

test('el paquete declara su licencia, la trae y el changelog tiene la versión actual', () => {
  const pkg = json('package.json');
  assert.equal(pkg.license, 'MIT');
  assert.match(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'), /^MIT License/);
  assert.match(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\]`, 'm'));
});

// macOS's /bin/sh (bash 3.2) with LANG=en_US.UTF-8 reads a "…" glued to a variable as part of its
// name: `$REF…` is "unbound variable" and the one-line install stops. Every shell script uses ${VAR}
// before anything that is not ASCII.
test('los scripts de shell no pegan una variable a un carácter que no es ASCII (el sh de macOS se cae)', () => {
  const scripts = ['install.sh', ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.sh')).map((f) => `scripts/${f}`)];
  for (const f of scripts) {
    const bad = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(l));
    assert.deepEqual(bad, [], `${f}: usa \${VAR} en ${bad.map(([n]) => `la línea ${n}`).join(', ')}`);
  }
});

test('install.sh instala una copia, y si no termina lo dice y sale con error (nunca parece un éxito)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-installsh-'));
  const env = { PATH: process.env.PATH, HOME: home, LANG: 'en_US.UTF-8', DEV_TEAM_OFFICE_NO_SETUP: '1' };
  const sh = (source) => spawnSync('sh', [path.join(ROOT, 'install.sh')], { env: { ...env, DEV_TEAM_OFFICE_SOURCE: source }, encoding: 'utf8' });
  try {
    const ok = sh(ROOT);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(fs.existsSync(path.join(home, '.dev-team-office', 'app', 'bin', 'dev-team-office.js')));
    const bad = sh(path.join(home, 'no-existe.tar.gz'));
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /the install did not finish/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
