// The browser's modules (public/): many are only loaded by the page, never by a test, so a typo in one
// would reach the browser unnoticed. Each one has to parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const files = fs.readdirSync(pub, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join(pub, f));

test('cada módulo del navegador se puede leer (sin errores de sintaxis)', () => {
  assert.ok(files.length > 20);
  const bad = files.map((f) => [f, spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })]).filter(([, r]) => r.status !== 0).map(([f, r]) => `${path.relative(pub, f)}\n${r.stderr.split('\n').slice(0, 5).join('\n')}`);
  assert.deepEqual(bad, []);
});
