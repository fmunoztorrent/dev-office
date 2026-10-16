// La pared de vidrio (public/sky.js): la estación, la luna, el sol, el clima y el paisaje.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { season, moonPhase, sunTimes, weatherKind, fromOpenMeteo, simulatedWeather, daylight, outdoor, lightning, isSouth } from '../public/sky.js';

test('la estación depende de la fecha y del hemisferio', () => {
  const oct = new Date(2026, 9, 16), jan = new Date(2026, 0, 10), jul = new Date(2026, 6, 10), may = new Date(2026, 4, 5);
  assert.equal(season(oct, true), 'spring');   // octubre en Santiago: primavera
  assert.equal(season(oct, false), 'autumn');  // y en Madrid, otoño
  assert.equal(season(jan, true), 'summer');
  assert.equal(season(jul, true), 'winter');
  assert.equal(season(may, false), 'spring');
  assert.ok(isSouth(-33.4) && !isSouth(40.4));
  assert.ok(isSouth(undefined, 'America/Santiago') && !isSouth(undefined, 'Europe/Madrid'));
});

test('la fase de la luna sigue al mes sinódico', () => {
  const near = (a, b, tol = 0.03) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b)) < tol;
  assert.ok(near(moonPhase(new Date(Date.UTC(2024, 0, 11, 11, 57))), 0), 'luna nueva del 11-01-2024');
  assert.ok(near(moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54))), 0.5), 'luna llena del 25-01-2024');
});

test('el sol: días más largos en verano, y la luz según la hora', () => {
  const place = { lat: -33.45, lon: -70.65 };
  const len = (d) => { const s = sunTimes(d, place); return s.sunset - s.sunrise; };
  assert.ok(len(new Date(2026, 11, 21)) > 14 && len(new Date(2026, 5, 21)) < 10.5, 'en Santiago, 14 h de sol en diciembre y menos de 10,5 en junio');
  const w = { kind: 'clear', clouds: 0, precip: 0, sunrise: 7, sunset: 20 };
  const at = (h) => daylight(new Date(2026, 9, 16, h, 0), w);
  assert.equal(at(2).night, 1);
  assert.ok(at(2).alt < 0);
  assert.equal(at(13).night, 0);
  assert.ok(at(13).alt > 0.9 && at(13).dusk === 0);
  assert.ok(at(20).dusk > 0.9, 'a las 20:00 es el atardecer');
  // de noche no se oscurece la oficina: sólo se enfría un poco el color
  assert.ok(at(2).shade.every((k) => k > 0.8));
  // un día gris apaga un poco la luz
  assert.ok(daylight(new Date(2026, 9, 16, 13), { ...w, kind: 'rain', clouds: 1, precip: 0.7 }).shade[0] < at(13).shade[0]);
});

test('el clima de Open-Meteo se traduce al de la oficina', () => {
  assert.equal(weatherKind(0), 'clear');
  assert.equal(weatherKind(2), 'partly');
  assert.equal(weatherKind(3), 'cloudy');
  assert.equal(weatherKind(45), 'fog');
  assert.equal(weatherKind(53), 'drizzle');
  assert.equal(weatherKind(63), 'rain');
  assert.equal(weatherKind(81), 'rain');
  assert.equal(weatherKind(73), 'snow');
  assert.equal(weatherKind(95), 'storm');
  const w = fromOpenMeteo({
    latitude: -33.43, longitude: -70.64, utc_offset_seconds: -10800, timezone: 'America/Santiago',
    current: { time: '2026-10-16T01:30', temperature_2m: 13.5, weather_code: 61, cloud_cover: 100, precipitation: 1.2, wind_speed_10m: 12, is_day: 0 },
    daily: { time: ['2026-10-16'], sunrise: ['2026-10-16T07:00'], sunset: ['2026-10-16T19:56'] },
  }, { name: 'Santiago' });
  assert.equal(w.kind, 'rain');
  assert.equal(w.temp, 13.5);
  assert.equal(w.clouds, 1);
  assert.ok(w.precip > 0.3);
  assert.equal(w.place, 'Santiago');
  assert.equal(w.sunrise, Date.UTC(2026, 9, 16, 10, 0), 'las 07:00 de Santiago son las 10:00 UTC');
  assert.equal(fromOpenMeteo({}), null);
});

test('sin conexión, el clima se inventa según la estación (y siempre igual para la misma hora)', () => {
  const d = new Date(2026, 9, 16, 10);
  assert.deepEqual(simulatedWeather(d, { lat: -33.4 }), simulatedWeather(d, { lat: -33.4 }));
  const kinds = (month, lat) => new Set(Array.from({ length: 240 }, (_, i) => simulatedWeather(new Date(2026, month, 1, i * 3), { lat }).kind));
  assert.ok(!kinds(0, -33.4).has('snow'), 'en el verano de Santiago no nieva');
  assert.ok(kinds(6, -33.4).has('rain'), 'en invierno llueve');
  assert.ok(kinds(6, -33.4).size >= 4, 'y el clima va cambiando');
});

test('el paisaje: todo dentro del vidrio, con lluvia, nieve o relámpagos según el clima', () => {
  const date = new Date(2026, 9, 16, 12);
  const box = { x0: 0, x1: 704, top: 6, bottom: 108 };
  const scene = (kind, extra = {}) => outdoor({ date, now: 12_345, ...box, weather: { kind, clouds: 0.9, precip: 0.8, wind: 10, temp: 8, lat: -33.4, sunrise: 7, sunset: 20, ...extra } }).shapes;
  const clear = scene('clear', { clouds: 0.05, precip: 0, temp: 20 });
  for (const [x, y, w, h] of clear) assert.ok(x >= box.x0 && x + w <= box.x1 && y >= box.top && y + h <= box.bottom, 'no se sale del vidrio');
  const rainy = (s) => s.filter(([, , w, h, , , keep]) => keep && w === 1 && h === 5).length;
  assert.equal(rainy(clear), 0);
  assert.ok(rainy(scene('rain')) > 50, 'llueve');
  const flakes = (s) => s.filter(([, , w, h, c]) => c === 0xffffff && w <= 2 && h <= 2).length;
  assert.ok(flakes(scene('snow', { temp: -1 })) > 30, 'nieva');
  // con tormenta, a veces cae un rayo
  let flashes = 0;
  for (let now = 0; now < 60_000; now += 40) if (lightning(now, { kind: 'storm' }).flash > 0.5) flashes++;
  assert.ok(flashes > 3);
  assert.equal(lightning(1000, { kind: 'clear' }).flash, 0);
});
