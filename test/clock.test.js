// The office's time: its time zone gives the date, the time, the country, the daylight, lunch and
// the weather (public/clock.js, sky.js and sim.js).
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoned, zoneInfo, zoneOffset, validZone, countryName, clockText } from '../public/clock.js';
import { daylight, sunTimes, simulatedWeather, season } from '../public/sky.js';
import { createSim } from '../public/sim.js';

const AT = Date.UTC(2026, 9, 16, 15, 30); // 16-10-2026 15:30 UTC

test('ZonedDate: la misma hora, en cada zona', () => {
  const scl = zoned(AT, 'America/Santiago'), tyo = zoned(AT, 'Asia/Tokyo'), mad = zoned(AT, 'Europe/Madrid');
  assert.deepEqual([scl.getHours(), scl.getMinutes(), scl.getDate()], [12, 30, 16]); // verano: UTC-3
  assert.deepEqual([tyo.getHours(), tyo.getDate(), tyo.getDay()], [0, 17, 6]); // it is already Saturday in Tokyo
  assert.equal(mad.getHours(), 17);
  assert.equal(scl.getTimezoneOffset(), 180);
  assert.equal(tyo.getTimezoneOffset(), -540);
  assert.equal(zoneOffset(Date.UTC(2026, 6, 1), 'America/Santiago'), 240, 'en invierno, UTC-4');
  assert.equal(clockText(AT, 'Asia/Tokyo'), '00:30');
  assert.ok(validZone('Europe/Madrid') && !validZone('Marte/Olympus') && !validZone(''));
});

test('de la zona: el país y la ciudad (sin conexión), y el nombre del país en el idioma del juego', () => {
  assert.deepEqual(zoneInfo('America/Santiago'), { tz: 'America/Santiago', country: 'CL', lat: -33.45, lon: -70.67, city: 'Santiago' });
  assert.equal(zoneInfo('America/Argentina/Buenos_Aires').city, 'Buenos Aires');
  assert.equal(countryName('CL', 'es'), 'Chile');
  assert.equal(countryName('JP', 'en'), 'Japan');
  assert.equal(zoneInfo('UTC').country, null);
});

test('la luz y la estación siguen la hora y el hemisferio de la oficina', () => {
  const night = daylight(zoned(AT, 'Asia/Tokyo'));           // half past midnight in Tokyo
  const day = daylight(zoned(AT, 'America/Santiago'));       // half past noon in Santiago
  assert.equal(night.night, 1);
  assert.equal(day.night, 0);
  assert.equal(season(zoned(AT, 'Asia/Tokyo'), false), 'autumn');
  // sunrise and sunset use the zone's offset (not the system's)
  const s = sunTimes(zoned(AT, 'Asia/Tokyo'), { lat: 35.65, lon: 139.74 });
  assert.ok(s.sunrise > 5 && s.sunrise < 6.5 && s.sunset > 16.5 && s.sunset < 18, JSON.stringify(s));
  // the simulated weather of the zone's city (southern hemisphere: spring in October)
  assert.ok(simulatedWeather(zoned(AT, 'America/Santiago'), { lat: -33.45 }).temp < 40);
  // the real sunrise (an instant) is converted to the zone's time
  const w = { kind: 'clear', clouds: 0, precip: 0, sunrise: Date.UTC(2026, 9, 16, 10, 0), sunset: Date.UTC(2026, 9, 16, 22, 56) };
  const l = daylight(zoned(AT, 'America/Santiago'), w);
  assert.equal(l.sunrise, 7);
  assert.ok(Math.abs(l.sunset - (19 + 56 / 60)) < 0.01);
});

test('el almuerzo es a las 13:00 de la oficina, no del sistema', () => {
  // 13:05 in Tokyo is 04:05 UTC
  const lunchInTokyo = Date.UTC(2026, 9, 16, 4, 5);
  let now = 0;
  const run = (sim, s) => { for (let i = 0; i < s * 20; i++) { now += 50; sim.step(0.05, now); } };
  const tokyo = createSim({ clock: () => now, random: () => 0.5, wall: () => lunchInTokyo, zone: 'Asia/Tokyo' });
  const lima = createSim({ clock: () => now, random: () => 0.5, wall: () => lunchInTokyo, zone: 'America/Lima' });
  run(tokyo, 2); run(lima, 2);
  assert.ok(tokyo.lunch, 'en Tokio es hora de almorzar');
  assert.ok(!lima.lunch, 'en Lima son las 23:05');
  assert.equal(tokyo.date().getHours(), 13);
  // and an office's zone can be changed on the fly
  lima.setZone('Asia/Tokyo');
  run(lima, 2);
  assert.ok(lima.lunch);
  assert.equal(lima.zone, 'Asia/Tokyo');
});
