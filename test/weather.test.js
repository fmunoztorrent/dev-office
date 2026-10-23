// The weather outside (server/weather.js): Open-Meteo with a fake fetch, without going to the network.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { Weather } from '../server/weather.js';
import { startServer } from '../server/server.js';

const FORECAST = (code = 3, temp = 13.5) => ({
  latitude: -33.43, longitude: -70.64, utc_offset_seconds: -10800, timezone: 'America/Santiago',
  current: { time: '2026-10-16T01:30', temperature_2m: temp, weather_code: code, cloud_cover: 100, precipitation: 0, wind_speed_10m: 3, is_day: 0 },
  daily: { time: ['2026-10-16'], sunrise: ['2026-10-16T07:00'], sunset: ['2026-10-16T19:56'] },
});

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    const body = routes[u.hostname]?.(u);
    if (body instanceof Error) throw body;
    return { ok: !!body, status: body ? 200 : 500, json: async () => body };
  };
  return { fetch, calls };
}

test('ubica la ciudad de la zona horaria (la de esa zona, si hay varias) y trae el clima', async () => {
  const { fetch, calls } = fakeFetch({
    'geocoding-api.open-meteo.com': (u) => ({ results: [
      { name: 'Santiago de Compostela', latitude: 42.88, longitude: -8.54, timezone: 'Europe/Madrid' },
      { name: 'Santiago de Chile', latitude: -33.45, longitude: -70.65, timezone: 'America/Santiago', q: u.searchParams.get('name') },
    ] }),
    'api.open-meteo.com': () => FORECAST(61),
  });
  const w = new Weather({ fetch, timezone: 'America/Santiago', location: '', enabled: true });
  const changes = [];
  w.on('change', (x) => changes.push(x));
  const out = await w.refresh();
  assert.equal(new URL(calls[0]).searchParams.get('name'), 'Santiago', 'sólo manda el nombre de la ciudad');
  assert.equal(new URL(calls[1]).searchParams.get('latitude'), '-33.45', 'la de Chile, no la de España');
  assert.equal(out.kind, 'rain');
  assert.equal(out.place, 'Santiago de Chile');
  assert.equal(changes.length, 1);
  // the second time it does not geocode again, and if nothing changed it does not notify
  await w.refresh();
  assert.equal(calls.filter((c) => c.includes('geocoding')).length, 1);
  assert.equal(changes.length, 1);
});

test('con coordenadas no geocodifica; sin red se queda con lo último y avisa una sola vez', async () => {
  let down = false;
  const { fetch, calls } = fakeFetch({ 'api.open-meteo.com': () => (down ? new Error('sin red') : FORECAST(0, 21)) });
  const logs = [];
  const w = new Weather({ fetch, location: '-33.45, -70.65', enabled: true, log: (m) => logs.push(m) });
  assert.equal((await w.refresh()).kind, 'clear');
  assert.ok(calls.every((c) => !c.includes('geocoding')));
  down = true;
  await w.refresh();
  await w.refresh();
  assert.equal(w.current.temp, 21, 'se queda con el último clima');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /simulado/);
});

test('apagado (DEV_TEAM_OFFICE_WEATHER=off) no consulta nada', async () => {
  const { fetch, calls } = fakeFetch({});
  const w = new Weather({ fetch, enabled: false }).start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 0);
  w.stop();
});

test('la oficina comparte el clima: en el estado y en vivo por WebSocket', async () => {
  let code = 3;
  const { fetch } = fakeFetch({ 'api.open-meteo.com': () => FORECAST(code) });
  const weather = new Weather({ fetch, location: '-33.45,-70.65', enabled: true, every: 60_000 });
  const server = await startServer({ port: 0, socket: null, db: ':memory:', weather });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/v1/ws');
  const live = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'weather') live.push(m.weather); });
  try {
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 50));
    const state = await (await globalThis.fetch(`${server.url}/v1/state`)).json();
    assert.equal(state.weather.kind, 'cloudy');
    code = 71;
    await weather.refresh();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(live.at(-1).kind, 'snow');
    assert.equal((await (await globalThis.fetch(`${server.url}/v1/weather`)).json()).weather.kind, 'snow');
  } finally {
    ws.close();
    await server.close();
  }
});
