// The office's SQLite database (server/store.js): agents maintainer, settings and history.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dto-store-'));

test('agentes: crear, validar, no repetir, editar y eliminar', () => {
  const store = openStore(':memory:');
  const dir = tmp();
  let r = store.createAgent({ path: dir, harness: 'claude' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.agent.name, r.agent.path, r.agent.harness], [path.basename(dir), dir, 'claude-code']);
  assert.match(r.agent.id, /-claude-code$/);
  const id = r.agent.id;

  // the same path with the same CLI is not repeated; with another CLI it is
  assert.match(store.createAgent({ path: dir, harness: 'claude-code' }).error, /ya está registrado/);
  assert.equal(store.createAgent({ path: dir, harness: 'opencode', name: 'Otro' }).ok, true);

  for (const [bad, rx] of [
    [{ path: 'relativa', harness: 'pi' }, /ruta completa/],
    [{ path: '/no/existe/nunca', harness: 'pi' }, /no existe/],
    [{ path: dir, harness: 'emacs' }, /elige el agente/],
    [{ harness: 'pi' }, /falta la ruta/],
    [{ path: dir, harness: 'pi', args: [1, 2] }, /args/],
  ]) assert.match(store.createAgent(bad).error, rx, JSON.stringify(bad));

  r = store.updateAgent(id, { name: 'Errementari', args: '--permission-mode auto', bin: '/opt/claude' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.agent.id, r.agent.name, r.agent.args, r.agent.bin, r.agent.harness], [id, 'Errementari', ['--permission-mode', 'auto'], '/opt/claude', 'claude-code']);
  assert.equal(store.updateAgent('nada', {}).status, 404);
  assert.deepEqual(store.listAgents().map((a) => a.name), ['Errementari', 'Otro']);
  assert.equal(store.deleteAgent(id).ok, true);
  assert.equal(store.deleteAgent(id).ok, false);
  assert.deepEqual(store.listAgents().map((a) => a.name), ['Otro']);
});

test('apariencia e historial de prompts', () => {
  const store = openStore(':memory:');
  assert.deepEqual(store.getAppearance(), {});
  assert.equal(store.setAppearance({ arquitecto: { name: 'Tito', shirt: '#AA0000' } }).ok, true);
  assert.deepEqual(store.getAppearance(), { tl: { name: 'Tito', shirt: '#aa0000' } });
  assert.match(store.setAppearance({ qa: { shirt: 'rojo' } }).error, /color/);
  assert.equal(store.setAppearance({ tl: null }).ok, true);
  assert.deepEqual(store.getAppearance(), {});

  store.savePrompt({ id: 'b-t1', agentId: 'erre', agent: 'claude-code', entry: 'errementari:feature', text: 'Login', mode: 'launch', status: 'running' });
  store.savePrompt({ id: 'b-t1', agentId: 'erre', agent: 'claude-code', text: 'Login', status: 'done', detail: 'terminada' });
  store.savePrompt({ id: 'b-t2', agentId: 'otro', agent: 'pi', text: 'X', status: 'sent' });
  const [p] = store.listPrompts({ agentId: 'erre' });
  assert.deepEqual([p.text, p.entry, p.status, p.detail, p.mode], ['Login', 'errementari:feature', 'done', 'terminada', 'launch']);
  assert.equal(store.listPrompts().length, 2);
});

test('en disco: permisos 0600, migraciones y lo que había en config.json', () => {
  const dir = tmp();
  const file = path.join(dir, 'office.db');
  const project = tmp();
  const legacy = path.join(dir, 'config.json');
  fs.writeFileSync(legacy, JSON.stringify({ appearance: { qa: { name: 'Andrea' } }, agents: [{ path: project, harness: 'pi', name: 'Viejo' }] }));
  process.env.DEV_TEAM_OFFICE_CONFIG = legacy;
  try {
    let store = openStore(file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(store.getAppearance(), { qa: { name: 'Andrea' } });
    assert.deepEqual(store.listAgents().map((a) => [a.name, a.harness]), [['Viejo', 'pi']]);
    store.close();
    // opening it again does not import again or lose anything
    fs.writeFileSync(legacy, JSON.stringify({ agents: [{ path: project, harness: 'opencode' }] }));
    store = openStore(file);
    assert.equal(store.listAgents().length, 1);
    store.close();
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    db.close();
    assert.ok(fs.existsSync(legacy)); // the old config.json is not deleted
  } finally {
    delete process.env.DEV_TEAM_OFFICE_CONFIG;
  }
});

test('migración 3: una base de la versión 2 conserva sus agentes, admite Codex y guarda las preguntas btw', () => {
  const dir = tmp();
  const file = path.join(dir, 'office.db');
  const project = tmp();
  // a database like the one version 0.4 left (user_version 2, the CHECK without codex)
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, harness TEXT NOT NULL CHECK (harness IN ('claude-code', 'opencode', 'pi')), bin TEXT, args TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (path, harness));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE prompts (id TEXT PRIMARY KEY, agent_id TEXT, agent TEXT NOT NULL, entry TEXT, text TEXT NOT NULL, session TEXT, mode TEXT NOT NULL, cwd TEXT, status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE offices (id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT, location TEXT, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO offices VALUES ('main', '', NULL, NULL, 0, 1, 1), ('pagos', 'Pagos', 'Europe/Madrid', NULL, 1, 1, 1);
    ALTER TABLE agents ADD COLUMN office_id TEXT NOT NULL DEFAULT 'main';
    PRAGMA user_version = 2;`);
  old.prepare("INSERT INTO agents (id, name, path, harness, created_at, updated_at, office_id) VALUES ('web-pi', 'Web', ?, 'pi', 1, 2, 'pagos')").run(project);
  old.close();

  const store = openStore(file);
  try {
    assert.deepEqual(store.listAgents().map((a) => [a.id, a.harness, a.office, a.path]), [['web-pi', 'pi', 'pagos', project]]);
    const codex = store.createAgent({ path: project, harness: 'codex' });
    assert.equal(codex.ok, true, codex.error);
    assert.equal(codex.agent.harness, 'codex');
    store.saveAsk({ id: 'q1', office: 'pagos', agent: 'codex', question: '¿Qué hace el equipo?', status: 'asking' });
    store.saveAsk({ id: 'q1', office: 'pagos', agent: 'codex', question: '¿Qué hace el equipo?', answer: 'Cobros con QR', status: 'answered' });
    assert.deepEqual(store.listAsks({ office: 'pagos' }).map((q) => [q.id, q.status, q.answer]), [['q1', 'answered', 'Cobros con QR']]);
    assert.deepEqual(store.listAsks({ office: 'main' }), []);
  } finally { store.close(); }
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  db.close();
});

test('la vista de la oficina: la frontal de siempre por defecto, y la cenital (isométrica) a elección', () => {
  const store = openStore(':memory:');
  assert.equal(store.getPrefs().view.mode, 'flat');
  assert.equal(store.setPrefs({ view: { mode: 'iso' } }).prefs.view.mode, 'iso');
  assert.equal(store.getPrefs().view.office, 'main', 'cambiar la vista no cambia la oficina que se mira');
  assert.equal(store.setPrefs({ view: { mode: '3d' } }).ok, false);
  assert.equal(store.getPrefs().view.mode, 'iso');
  store.close();
});
