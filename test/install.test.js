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

test('install([pi]): copia la librería, el skill genérico y la extensión, y lo cuenta', () => {
  fs.rmSync(CONFIG_SKILL, { recursive: true, force: true }); // clean state, independent of the order
  const res = install(['pi']);
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(LIB));
  assert.ok(fs.existsSync(path.join(HOME, '.pi', 'agent', 'extensions', 'dev-team-office.ts')));
  assert.ok(fs.existsSync(path.join(CONFIG_SKILL, 'SKILL.md')));
  // lines announces the configuration skill (by its path, not by the translated text)
  assert.ok(res.lines.some((l) => l.includes('dev-team-office-config')), res.lines.join('\n'));
});

test('install([pi]): si el skill genérico no se puede copiar, avisa por una línea y sigue igual', () => {
  // prep: the destination is a FILE, so copy()'s mkdir fails and the try/catch has to act
  fs.rmSync(CONFIG_SKILL, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(CONFIG_SKILL), { recursive: true });
  fs.writeFileSync(CONFIG_SKILL, 'no soy un directorio\n');
  fs.rmSync(LIB, { force: true }); // to check that the shared copy goes through despite the failure
  const res = install(['pi']);
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(LIB));
  // the warning is recognized by structure: the installer's same template with {error} interpolated
  const [prefix, suffix] = t('install.configSkillFail').split('{error}');
  assert.ok(res.lines.some((l) => l.startsWith(prefix) && l.endsWith(suffix)), res.lines.join('\n'));
});
