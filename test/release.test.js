// What a release needs: one version everywhere (package, server, Claude Code plugin), a license and
// a changelog entry for that version, so what gets distributed is consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
