// La base SQLite de la oficina (server/store.js): mantenedor de agentes, ajustes e historial.
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

  // la misma ruta con el mismo CLI no se repite; con otro CLI sí
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
    // abrirla de nuevo no vuelve a importar ni pierde nada
    fs.writeFileSync(legacy, JSON.stringify({ agents: [{ path: project, harness: 'opencode' }] }));
    store = openStore(file);
    assert.equal(store.listAgents().length, 1);
    store.close();
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    db.close();
    assert.ok(fs.existsSync(legacy)); // el config.json viejo no se borra
  } finally {
    delete process.env.DEV_TEAM_OFFICE_CONFIG;
  }
});
