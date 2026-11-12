// Auto-compaction (server/compact.js): past your limit (⚙ › General, 400k tokens by default or a share of
// the window) the office asks the agent to compact its context, each one its own way: the extension that
// can (Pi, OpenCode), `/compact` in its herdr pane when its turn ends, or a line in the log for you.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/server.js';
import { Compactor, thresholdOf, claudeCompactEnv } from '../server/compact.js';
import { openStore } from '../server/store.js';

test('el tope: en tokens o en % de la ventana, y nunca uno que no cabe en ella', () => {
  const on = (at, unit = 'tokens') => ({ compact: { auto: true, at, unit } });
  assert.equal(thresholdOf(on(400_000), { used: 1, max: 1_000_000 }), 400_000);
  assert.equal(thresholdOf(on(400_000), { used: 1, max: 200_000 }), null, 'una ventana de 200k: compacta el propio agente');
  assert.equal(thresholdOf(on(80, 'pct'), { used: 1, max: 200_000 }), 160_000);
  assert.equal(thresholdOf({ compact: { auto: false, at: 400_000, unit: 'tokens' } }, { used: 1, max: 1_000_000 }), null);
  assert.deepEqual(claudeCompactEnv(on(400_000)), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000' });
  assert.deepEqual(claudeCompactEnv(on(80, 'pct')), { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' });
  assert.deepEqual(claudeCompactEnv({ compact: { auto: false } }), {});
});

test('el ajuste: por defecto 400k tokens; se valida y cambiar de unidad trae su valor por defecto', () => {
  const store = openStore(':memory:');
  try {
    assert.deepEqual(store.getPrefs().compact, { auto: true, at: 400_000, unit: 'tokens' });
    assert.equal(store.setPrefs({ compact: { at: 250_400 } }).prefs.compact.at, 250_000, 'en miles');
    assert.deepEqual(store.setPrefs({ compact: { unit: 'pct' } }).prefs.compact, { auto: true, at: 80, unit: 'pct' });
    assert.equal(store.setPrefs({ compact: { at: 120 } }).ok, false, 'más del 99 %');
    assert.equal(store.setPrefs({ compact: { unit: 'tokens', at: 5 } }).ok, false, 'menos de 10k');
    assert.equal(store.setPrefs({ compact: { auto: 'sí' } }).ok, false);
    assert.equal(store.setPrefs({ compact: { auto: false } }).prefs.compact.auto, false);
  } finally { store.close(); }
});

/** A Compactor with fakes: the connected agents, herdr and the company's log. */
function rig({ conns = [], pane = null, prefs = { compact: { auto: true, at: 400_000, unit: 'tokens' } } } = {}) {
  const said = [], typed = [];
  const c = new Compactor({
    prefs: () => prefs,
    hub: { liveAgents: () => conns },
    herdr: { available: true, prompt: async (p, text) => { typed.push([p, text]); } },
    company: { paneOfSession: () => pane, ingest: (_src, e) => said.push(e) },
  });
  const s = (used, extra = {}) => ({ id: 's1', context: { used, max: 1_000_000, at: Date.now() }, ...extra });
  return { c, said, typed, s };
}

test('un agente que sabe compactar recibe el pedido apenas pasa el tope, una sola vez', () => {
  const sent = [];
  const { c, said, s } = rig({ conns: [{ sessions: new Set(['s1']), can: ['task', 'compact'], send: (m) => sent.push(m) }] });
  assert.equal(c.onEvent('main', { kind: 'tool_end' }, s(390_000)), null, 'bajo el tope');
  assert.equal(c.onEvent('main', { kind: 'context' }, s(410_000)), 'agent');
  assert.deepEqual(sent, [{ type: 'compact', session: 's1', used: 410_000, at: 400_000 }]);
  assert.equal(said[0].kind, 'autocompact');
  assert.equal(said[0].via, 'agent');
  assert.match(said[0].text, /410k \(tope 400k\)/);
  assert.equal(c.onEvent('main', { kind: 'context' }, s(420_000)), null, 'ya se lo pidió');
  // it compacted: the next time it goes past the limit, it is asked again
  c.onEvent('main', { kind: 'compact' }, s(420_000, { context: { used: 420_000, max: 1_000_000, compacted: Date.now() } }));
  assert.equal(c.onEvent('main', { kind: 'context' }, s(30_000)), null);
  assert.equal(c.onEvent('main', { kind: 'context' }, s(405_000)), 'agent');
  assert.equal(sent.length, 2);
});

test('en un pane de herdr se escribe /compact, pero sólo cuando termina su turno', () => {
  const { c, typed, said, s } = rig({ pane: 'p7' });
  assert.equal(c.onEvent('main', { kind: 'tool_start' }, s(450_000)), null, 'trabajando: espera');
  assert.deepEqual(typed, []);
  assert.equal(c.onEvent('main', { kind: 'turn_end' }, s(450_000)), 'pane');
  assert.deepEqual(typed, [['p7', '/compact']]);
  assert.equal(said[0].via, 'pane');
});

test('sin canal ni pane (Claude Code en su terminal): la bitácora te avisa una vez', () => {
  const { c, said, s } = rig();
  assert.equal(c.onEvent('main', { kind: 'turn_end' }, s(500_000)), 'manual');
  assert.match(said[0].text, /escribe \/compact/);
  assert.equal(c.onEvent('main', { kind: 'turn_end' }, s(520_000)), null, 'no insiste');
  // apagado: nada
  const off = rig({ prefs: { compact: { auto: false, at: 400_000, unit: 'tokens' } } });
  assert.equal(off.c.onEvent('main', { kind: 'turn_end' }, off.s(900_000)), null);
  // los eventos de un subagente no cuentan (su contexto es suyo)
  const sub = rig();
  assert.equal(sub.c.onEvent('main', { kind: 'turn_end', subId: 'x' }, sub.s(900_000)), null);
});

test('de punta a punta: Pi conectado pasa el tope, la oficina se lo pide y la bitácora lo cuenta; al compactar, la barra lo dice', async () => {
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather: false, places: false });
  try {
    const sent = [];
    server.hub.register({ id: 'c1', send: (m) => sent.push(m) }, { agent: 'pi', session: 'pi-1', cwd: '/tmp/tienda', can: ['task', 'pipeline', 'compact'] });
    server.company.ingest('pi', { session: 'pi-1', cwd: '/tmp/tienda', kind: 'context', context: { used: 120_000, max: 1_000_000 } });
    assert.deepEqual(sent, []);
    server.company.ingest('pi', { session: 'pi-1', cwd: '/tmp/tienda', kind: 'context', context: { used: 401_000, max: 1_000_000 } });
    assert.deepEqual(sent, [{ type: 'compact', session: 'pi-1', used: 401_000, at: 400_000 }]);
    const office = server.company.get('main');
    const line = office.log.find((e) => e.kind === 'autocompact');
    assert.equal(line.role, 'manager');
    assert.match(line.text, /401k \(tope 400k\): le pido al agente que lo compacte/);
    // Pi compacts: the bar says so until its next answer
    server.company.ingest('pi', { session: 'pi-1', cwd: '/tmp/tienda', kind: 'compact' });
    assert.ok(office.sessionSummary('pi-1').context.compacted);
    server.company.ingest('pi', { session: 'pi-1', cwd: '/tmp/tienda', kind: 'context', context: { used: 40_000, max: 1_000_000 } });
    assert.equal(office.sessionSummary('pi-1').context.compacted, undefined);
    assert.equal(office.sessionSummary('pi-1').context.used, 40_000);
  } finally { await server.close(); }
});
