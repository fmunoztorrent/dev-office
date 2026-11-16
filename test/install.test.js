// bin/install.js: puts the integrations in place. It computes its paths from os.homedir() when it is
// IMPORTED, so this test gives it a fake HOME BEFORE the dynamic import and never touches the real
// home. Importing it does not run the CLI: it only defines install() (the binary calls it separately).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL_HOME = process.env.HOME;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-install-'));
process.env.HOME = HOME; // os.homedir() honors $HOME (darwin/linux): isolates the install from the real home

// Isolation ASSERTED, not assumed: install.js freezes `const HOME = os.homedir()` on import, so if
// this equality does not hold the test would silently write to the REAL home. And it is a
// platform-bound contract: package.json declares "os": ["darwin", "linux"], the only engines where
// os.homedir() looks at $HOME. It is deliberately NOT skipped on unsupported platforms: a skip that
// passes silently is worse than this failure, which is the only thing that reveals isolation does not hold here.
assert.equal(os.homedir(), HOME, 'os.homedir() ignoró $HOME: el aislamiento del install no rige en esta plataforma');

const { install } = await import('../bin/install.js');
const { t } = await import('../public/i18n.js');

const CONFIG_SKILL = path.join(HOME, '.agents', 'skills', 'dev-team-office-config');
const LIB = path.join(HOME, '.dev-team-office', 'lib', 'devteam.mjs');

after(() => {
  process.env.HOME = REAL_HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
});

test('install([pi]): copia la librería, el reporter y la extensión; los skills son de setup (bin/skills.js)', () => {
  fs.rmSync(CONFIG_SKILL, { recursive: true, force: true });
  const res = install(['pi']);
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(LIB));
  assert.ok(fs.existsSync(path.join(HOME, '.pi', 'agent', 'extensions', 'dev-team-office.ts')));
  // the Playwright reporter, next to the library: the e2e tests of every agent show in the office
  assert.ok(fs.existsSync(path.join(HOME, '.dev-team-office', 'lib', 'playwright-reporter.cjs')));
  assert.equal(fs.existsSync(CONFIG_SKILL), false, 'una sola copia de los skills: la de setup, por agente');
  assert.ok(res.lines.some((l) => l.includes(t('install.lib', { path: '' }).trim())), res.lines.join('\n'));
});
