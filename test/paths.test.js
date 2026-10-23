// Folders by their real path (on macOS /tmp is /private/tmp) and the environment of what the office launches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realDir, insideDir } from '../server/paths.js';
import { childEnv } from '../server/tasks.js';
import { Company } from '../server/company.js';
import { openStore } from '../server/store.js';

test('realDir: sigue los enlaces, también de carpetas que todavía no existen', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-paths-'));
  const real = fs.realpathSync(base);
  fs.mkdirSync(path.join(base, 'proyecto'));
  fs.symlinkSync(path.join(base, 'proyecto'), path.join(base, 'atajo'));
  assert.equal(realDir(path.join(base, 'atajo')), path.join(real, 'proyecto'));
  assert.equal(realDir(path.join(base, 'atajo', 'src', 'nuevo')), path.join(real, 'proyecto', 'src', 'nuevo'));
  assert.equal(realDir(`${path.join(base, 'proyecto')}/`), path.join(real, 'proyecto'));
  assert.ok(insideDir(path.join(base, 'atajo', 'src'), path.join(real, 'proyecto')));
  assert.ok(!insideDir(path.join(base, 'proyecto-2'), path.join(base, 'proyecto')));

  // an event with the path through the link goes to the office of the agent registered with the real path
  const store = openStore(':memory:');
  store.createOffice({ name: 'Pagos' });
  store.createAgent({ path: path.join(real, 'proyecto'), harness: 'codex', office: 'pagos' });
  const company = new Company({ store });
  company.ingest('codex', { session_id: 's', cwd: path.join(base, 'atajo'), hook_event_name: 'SessionStart' });
  assert.equal(company.officeOfSession('s'), 'pagos');
});

test('lo que lanza la oficina encuentra Node aunque no esté en su PATH', () => {
  const saved = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  try {
    const env = childEnv({ X: '1' });
    assert.equal(env.X, '1');
    assert.deepEqual(env.PATH.split(path.delimiter), ['/usr/bin', '/bin', path.dirname(process.execPath)]);
    process.env.PATH = `${path.dirname(process.execPath)}:/bin`;
    assert.equal(childEnv().PATH, process.env.PATH, 'si ya está, no se repite');
  } finally { process.env.PATH = saved; }
});
