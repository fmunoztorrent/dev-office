// What is seen through the glass wall: the sky by time and date (sun, moon with its phase, stars,
// sunrise and sunset by season), the weather (clouds, rain, snow, fog, storm with lightning) and
// the city with its park, which changes color with the season.
//
// Used by both renderers: outdoor() returns a list of rectangles [x, y, w, h, color, alpha,
// fixed] in world coordinates, and each one draws them its own way (the canvas as is; the terminal
// scaled to its pixels). The server uses fromOpenMeteo() to translate the real weather.
//
// Dates can be Date or ZonedDate (clock.js): the office's time in its time zone.

import { zoned } from './clock.js';

const DAY_MS = 86_400_000;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hoursOf = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
const dayOfYear = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY_MS);
// the sunrise or sunset time: hours of the day, or an instant (epoch ms) converted to the hour
// of `date`'s zone
const toHours = (v, date) => (v > 48 ? hoursOf(zoned(v, date?.tz)) : v);

// ------------------------------------------------------------------ fecha

const SOUTH_TZ = /^(America\/(Santiago|Punta_Arenas|Argentina|Buenos_Aires|Cordoba|Mendoza|Montevideo|Asuncion|Sao_Paulo|La_Paz|Lima)|Australia\/|Pacific\/(Auckland|Chatham|Fiji|Tahiti|Easter)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone)|Antarctica\/|Indian\/(Mauritius|Reunion))/;
export function localZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
/** Southern hemisphere: by latitude if known; otherwise, by the team's time zone. */
export function isSouth(lat, tz = localZone()) { return Number.isFinite(lat) ? lat < 0 : SOUTH_TZ.test(tz); }

/** The season by date and hemisphere. */
export function season(date = new Date(), south = isSouth()) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const north = md >= 1221 || md < 320 ? 'winter' : md < 621 ? 'spring' : md < 923 ? 'summer' : 'autumn';
  return south ? { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[north] : north;
}

/** Moon phase: 0 = new, 0.5 = full (synodic months since a known new moon). */
export function moonPhase(date = new Date()) {
  const p = ((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

const isDst = (d) => {
  const at = (ms) => (d.offsetAt ? d.offsetAt(ms) : new Date(ms).getTimezoneOffset());
  const jan = at(Date.UTC(d.getFullYear(), 0, 1)), jul = at(Date.UTC(d.getFullYear(), 6, 1));
  return d.getTimezoneOffset() < Math.max(jan, jul);
};
/** Sunrise and sunset (local hours) approximated from latitude, longitude and the day of the year. */
export function sunTimes(date = new Date(), { lat, lon } = {}) {
  const phi = ((Number.isFinite(lat) ? lat : isSouth(lat, date.tz || localZone()) ? -33.5 : 40) * Math.PI) / 180;
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear(date))) / 365);
  const half = (Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl)))) * 12) / Math.PI + 0.13; // + refraction
  const noon = Number.isFinite(lon) ? 12 - date.getTimezoneOffset() / 60 - lon / 15 : 12.3 + (isDst(date) ? 1 : 0);
  return { sunrise: noon - half, sunset: noon + half };
}

// ------------------------------------------------------------------ the place

// Where an office is (its city), as stored: a name ("Valparaíso", looked up in the geocoder),
// coordinates ("-33.45,-70.65") or both, the way the city picker saves it:
// "Concepción, Región del Biobío (-36.8270, -73.0498)".
const PLACE_RX = /^\s*(?:(.*?)\s*\(\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;
const PLACE_MAX = 80;

/** The stored text → { name, lat?, lon? } (null if empty). */
export function parsePlace(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const m = PLACE_RX.exec(s);
  if (!m) return { name: s };
  const lat = Number(m[2]), lon = Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { name: s };
  return { name: (m[1] || '').trim(), lat, lon };
}

/** { name, lat, lon } → the text that is stored (it always fits in 80 characters). */
export function placeLocation({ name = '', lat, lon }) {
  const at = ` (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`;
  return `${String(name).trim().slice(0, PLACE_MAX - at.length)}${at}`;
}

// ------------------------------------------------------------------ clima

// Each weather's name is in the languages (i18n: weather.<type>).
export const WEATHER = {
  clear: { icon: '☀️', night: '🌙' },
  partly: { icon: '🌤️', night: '☁️' },
  cloudy: { icon: '☁️' },
  fog: { icon: '🌫️' },
  drizzle: { icon: '🌦️' },
  rain: { icon: '🌧️' },
  snow: { icon: '❄️' },
  storm: { icon: '⛈️' },
};
const CLOUDS = { clear: 0.05, partly: 0.4, cloudy: 0.95, fog: 0.8, drizzle: 0.85, rain: 0.95, snow: 0.95, storm: 1 };
const PRECIP = { drizzle: 0.3, rain: 0.7, snow: 0.6, storm: 1 };
export const WET = new Set(['drizzle', 'rain', 'storm']);
export const weatherIcon = (w, night = 0) => (night > 0.5 && WEATHER[w?.kind]?.night) || WEATHER[w?.kind]?.icon || '☀️';

/** WMO code (the one Open-Meteo uses) → the weather type the office draws. */
export function weatherKind(code) {
  if (code == null || code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

/** The api.open-meteo.com/v1/forecast response (current + daily sunrise/sunset) → the office's weather. */
export function fromOpenMeteo(data, place = {}) {
  const c = data?.current;
  if (!c || c.weather_code == null) return null;
  const kind = weatherKind(c.weather_code);
  // the hours come in the place's zone: they are stored as instants to draw them in local time
  const at = (s) => (s ? Date.parse(`${s}:00Z`) - (data.utc_offset_seconds || 0) * 1000 : undefined);
  const mm = Number(c.precipitation) || 0;
  return {
    kind,
    code: c.weather_code,
    clouds: Number.isFinite(c.cloud_cover) ? c.cloud_cover / 100 : CLOUDS[kind],
    precip: PRECIP[kind] ? Math.min(1, Math.max(PRECIP[kind] * 0.6, mm / 4)) : 0,
    wind: Number(c.wind_speed_10m) || 0,
    temp: Number(c.temperature_2m),
    sunrise: at(data.daily?.sunrise?.[0]),
    sunset: at(data.daily?.sunset?.[0]),
    lat: data.latitude,
    lon: data.longitude,
    place: place.name || '',
    source: 'open-meteo',
  };
}

const SEASON_SKIES = {
  summer: [['clear', 0.55], ['partly', 0.3], ['cloudy', 0.1], ['storm', 0.05]],
  spring: [['clear', 0.35], ['partly', 0.35], ['cloudy', 0.15], ['drizzle', 0.1], ['rain', 0.05]],
  autumn: [['clear', 0.25], ['partly', 0.3], ['cloudy', 0.2], ['fog', 0.1], ['rain', 0.15]],
  winter: [['clear', 0.2], ['partly', 0.2], ['cloudy', 0.2], ['fog', 0.1], ['rain', 0.2], ['snow', 0.05], ['storm', 0.05]],
};
/**
 * Offline (or with DEV_TEAM_OFFICE_WEATHER=off) the office makes up the weather: it changes every
 * three hours, with the season's probabilities. It always gives the same result for the same hour.
 */
export function simulatedWeather(date = new Date(), place = {}) {
  const s = season(date, isSouth(place.lat, date.tz || localZone()));
  const block = Math.floor(date.getTime() / (3 * 3_600_000));
  const r = hash(block), r2 = hash(block + 7.3);
  let acc = 0, kind = 'clear';
  for (const [k, p] of SEASON_SKIES[s]) { acc += p; if (r < acc) { kind = k; break; } }
  const base = { summer: 27, spring: 19, autumn: 15, winter: 9 }[s];
  let temp = Math.round(base + 6 * Math.sin(((hoursOf(date) - 9) / 24) * 2 * Math.PI) - (PRECIP[kind] ? 4 : 0) + (r2 - 0.5) * 4);
  if (kind === 'snow') temp = Math.min(temp, 1);
  const sun = sunTimes(date, place);
  return { kind, clouds: CLOUDS[kind], precip: PRECIP[kind] || 0, wind: Math.round(4 + r2 * 22), temp, ...sun, lat: place.lat, lon: place.lon, place: place.place || '', source: 'simulado' };
}

// ------------------------------------------------------------------ luz

/**
 * The light by real time and weather.
 *   night: 0 by day, 1 at night · dusk: sunset/sunrise · alt: the sun's altitude (1 at noon,
 *   negative at night) · gloom: how grey the day is.
 * At night the office keeps its lights on, so it does not get dark: `shade` only cools the color
 * a little (multiplies each RGB channel); at sunset a warm tone comes in and on a grey day it dims
 * a little.
 */
export function daylight(date = new Date(), weather = null) {
  const h = hoursOf(date);
  const sun = weather && Number.isFinite(weather.sunrise) && Number.isFinite(weather.sunset)
    ? { sunrise: toHours(weather.sunrise, date), sunset: toHours(weather.sunset, date) } : sunTimes(date, weather || {});
  const rise = sun.sunrise, set = sun.sunset;
  const ramp = (a, b) => Math.min(1, Math.max(0, (h - a) / (b - a)));
  const night = h < (rise + set) / 2 ? 1 - ramp(rise - 0.6, rise + 0.6) : ramp(set - 0.4, set + 0.9);
  const dusk = Math.max(0, 1 - Math.abs(h - set) / 1.3, 1 - Math.abs(h - rise));
  const dayLen = set - rise;
  const alt = h >= rise && h <= set ? Math.sin((Math.PI * (h - rise)) / dayLen) : -Math.sin((Math.PI * ((h - set + 24) % 24)) / (24 - dayLen));
  const gloom = weather ? Math.min(1, (weather.clouds ?? 0) * 0.55 + (weather.precip ?? 0) * 0.35 + (weather.kind === 'fog' ? 0.2 : 0)) : 0;
  const g = gloom * (1 - night);
  const shade = [1 - 0.16 * night - 0.05 * g, 1 - 0.13 * night - 0.03 * dusk - 0.04 * g, 1 - 0.04 * night - 0.08 * dusk - 0.01 * g];
  return { night, dusk, alt, gloom, shade, sunrise: rise, sunset: set, hour: h };
}

// Lightning: in each 5.2 s window one may strike (half of the time).
const STRIKE_EVERY = 5200;
export function strikeStart(k) { return hash(k * 1.37 + 0.5) < 0.5 ? k * STRIKE_EVERY + hash(k * 2.11 + 0.9) * 3600 : null; }
/** Is there lightning at this instant? flash goes from 0 to 1 (a double flash, like real ones). */
export function lightning(now, weather) {
  if (weather?.kind !== 'storm') return { flash: 0 };
  const k = Math.floor(now / STRIKE_EVERY);
  for (const kk of [k, k - 1]) {
    const s = strikeStart(kk);
    if (s == null || now < s || now - s >= 280) continue;
    const dt = now - s;
    return { flash: dt < 50 ? 1 : dt < 110 ? 0.3 : dt < 160 ? 0.85 : Math.max(0, 1 - (dt - 160) / 120), x: hash(kk * 3.7 + 0.2), k: kk };
  }
  return { flash: 0 };
}

// ------------------------------------------------------------------ the landscape

const mixc = (a, b, t) => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ch = (s) => { const x = (a >> s) & 255; return Math.round(x + (((b >> s) & 255) - x) * t); };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
export const colorHex = (c) => `#${(c | 0x1000000).toString(16).slice(1)}`;

// the sky's color (top, horizon) by the sun's altitude
const SKY = [
  [-1, 0x070b22, 0x141c40], [-0.25, 0x0b1030, 0x1f2a55], [-0.08, 0x2a2f66, 0x8a5d8a], [0, 0x3d4f8f, 0xf09a6e],
  [0.12, 0x4f7fc0, 0xffc58e], [0.3, 0x4a92d8, 0xb4dcf2], [1, 0x3a86d4, 0xa6d4f0],
];
function skyColors(alt) {
  for (let i = 1; i < SKY.length; i++) {
    const [a1, t1, b1] = SKY[i];
    if (alt <= a1) {
      const [a0, t0, b0] = SKY[i - 1];
      const t = (alt - a0) / (a1 - a0);
      return [mixc(t0, t1, t), mixc(b0, b1, t)];
    }
  }
  return [SKY.at(-1)[1], SKY.at(-1)[2]];
}

const TREE_COLORS = {
  spring: [[0x62b85a, 0x7fd16f]], summer: [[0x3e9a4c, 0x56b25d], [0x358a44, 0x4ea657]],
  autumn: [[0xd9822b, 0xeaa04a], [0xc4562b, 0xd9733f], [0xe2b13c, 0xf0c95e]], winter: [],
};
const GRASS = { spring: 0x6fae55, summer: 0x84a84a, autumn: 0x8f9a4a, winter: 0x7d8a6a };
const SNOWLINE = { winter: 0.55, autumn: 0.3, spring: 0.32, summer: 0.12 }; // how much of the hills has snow
const BUILDING = [0x6f86a8, 0x7d92b0, 0x5f7698, 0x8a9cb8, 0x687d9e];
const CARS = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703, 0x2b2d42];

// What does not change (hills, buildings, trees, stars): generated once per width.
const layouts = new Map();
function layout(x0, x1) {
  const key = `${x0}:${x1}`;
  if (layouts.has(key)) return layouts.get(key);
  let seed = 20261016;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mountains = [];
  for (let x = x0; x < x1; x += 2) {
    const u = x / 704;
    const h = 24 + 10 * Math.sin(u * 11 + 1.3) + 7 * Math.sin(u * 29 + 0.4) + 4 * Math.sin(u * 61 + 2) + 9 * Math.max(0, Math.sin(u * 7 - 0.8));
    mountains.push([x, Math.max(10, Math.min(48, h))]);
  }
  const buildings = [];
  for (let x = x0 - 6; x < x1;) {
    const w = 12 + Math.floor(rnd() * 22);
    const tall = rnd() < 0.18;
    const h = tall ? 40 + Math.floor(rnd() * 22) : 12 + Math.floor(rnd() * 24);
    buildings.push({ x, w, h, c: BUILDING[Math.floor(rnd() * BUILDING.length)], seed: rnd() * 1000, antenna: tall && rnd() < 0.7 });
    x += w + Math.floor(rnd() * 5);
  }
  const trees = [];
  for (let x = x0 + 12; x < x1 - 6; x += 30 + Math.floor(rnd() * 34)) trees.push({ x, r: 7 + Math.floor(rnd() * 4), tone: rnd(), seed: rnd() * 100 });
  const stars = Array.from({ length: 46 }, () => ({ x: x0 + rnd() * (x1 - x0), y: rnd(), p: rnd() * 6 }));
  const lamps = [];
  for (let x = x0 + 50; x < x1; x += 150) lamps.push(x);
  const out = { mountains, buildings, trees, stars, lamps };
  layouts.set(key, out);
  return out;
}

/**
 * What flies in the sky at second `t` (always the same for the same moment and weather): birds by day,
 * a plane now and then (its contrail by day, its lights at night), a hot-air balloon on a calm clear day,
 * bats at dusk, and shooting stars and a satellite on a clear night. Nothing flies in the rain, a storm
 * or fog. Each one: { kind, x, y, dir, … } in the band [top, low] of the landscape [x0, x1].
 */
export function skyLife({ t, light: L, weather: w, x0, x1, top, low, lod = 'full' }) {
  const out = [];
  const W = x1 - x0, span = Math.max(1, low - top);
  const less = lod === 'low';
  const calm = !WET.has(w.kind) && w.kind !== 'storm' && w.kind !== 'fog';
  if (!calm) return out;
  /** A crossing of `period` seconds that happens in some of its turns: its progress (0–1) and its turn, or null. */
  const crossing = (period, chance, salt) => {
    const turn = Math.floor(t / period), u = (t / period) % 1;
    return hash(turn * 3.71 + salt) < chance ? { turn, u } : null;
  };
  // birds: flocks in a V (by day and at dusk), their wings beating
  if (L.night < 0.55) {
    for (let f = 0; f < (less ? 1 : 3); f++) {
      const c = crossing(34 + f * 17, 0.7, f * 5.3);
      if (!c) continue;
      const dir = hash(c.turn + f * 1.9) < 0.5 ? 1 : -1;
      const fx = dir > 0 ? x0 - 30 + c.u * (W + 60) : x1 + 30 - c.u * (W + 60);
      const fy = top + 6 + hash(c.turn * 1.3 + f) * span * 0.65 + Math.sin(t * 0.8 + f) * 2;
      const n = 3 + Math.floor(hash(c.turn + f * 2.3) * 5);
      for (let i = 0; i < n; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        out.push({ kind: 'bird', x: Math.round(fx - dir * row * 6), y: Math.round(fy + side * row * 3), dir, flap: Math.floor(t * 5 + i * 1.7) % 2 });
      }
    }
  }
  // a plane, high and slow: a contrail by day, its lights at night (it still flies over the clouds)
  const plane = crossing(70, 0.55, 9.1);
  if (plane) {
    const dir = hash(plane.turn + 4.4) < 0.5 ? 1 : -1;
    out.push({ kind: 'plane', x: Math.round(dir > 0 ? x0 - 20 + plane.u * (W + 40) : x1 + 20 - plane.u * (W + 40)), y: Math.round(top + 4 + hash(plane.turn * 2.7) * span * 0.25), dir, night: L.night > 0.4, blink: Math.floor(t * 1.6) % 2 });
  }
  // a hot-air balloon on a calm clear day, drifting with the wind
  if (!less && L.night < 0.3 && w.clouds < 0.6 && w.wind < 18) {
    const b = crossing(240, 0.5, 2.2);
    if (b) out.push({ kind: 'balloon', x: Math.round(x0 - 16 + b.u * (W + 32)), y: Math.round(top + span * (0.25 + 0.3 * hash(b.turn + 7)) + Math.sin(t * 0.4) * 3), hue: Math.floor(hash(b.turn + 1.1) * 3) });
  }
  // bats at dusk, flitting near the rooftops
  if (L.dusk > 0.2 && L.night > 0.25 && L.night < 0.85) {
    for (let i = 0; i < (less ? 1 : 3); i++) {
      const cx = x0 + hash(i + 0.31) * W, cy = low - 14 - hash(i + 0.77) * span * 0.35;
      out.push({ kind: 'bat', x: Math.round(cx + Math.sin(t * 1.3 + i * 2) * 26 + Math.sin(t * 3.1 + i) * 6), y: Math.round(cy + Math.cos(t * 2.3 + i) * 8), flap: Math.floor(t * 9 + i) % 2 });
    }
  }
  // on a clear night: a shooting star now and then, and a satellite crossing slowly
  if (L.night > 0.6 && w.clouds < 0.5) {
    const k = Math.floor(t / 9), u = (t % 9) / 0.9; // it lasts the first 0.9 s of its 9
    if (u < 1 && hash(k * 1.77 + 0.3) < 0.45) {
      const sx = x0 + 20 + hash(k + 0.6) * (W - 40), sy = top + 4 + hash(k + 0.9) * span * 0.4;
      const dir = hash(k + 0.2) < 0.5 ? 1 : -1;
      out.push({ kind: 'meteor', x: Math.round(sx + dir * u * 34), y: Math.round(sy + u * 14), dir, fade: 1 - u });
    }
    const s = crossing(150, 0.6, 5.5);
    if (s) out.push({ kind: 'satellite', x: Math.round(x0 + s.u * W), y: Math.round(top + 6 + hash(s.turn + 3.3) * span * 0.3) });
  }
  return out;
}

/**
 * The landscape behind the glass, back to front, and the glass on top (frames, reflections,
 * drops, fogging). All clipped to the rectangle [x0, x1] × [top, bottom].
 * @param lod 'full' (browser) or 'low' (terminal: fewer small details)
 * @param glass false: only the landscape, without the glass (the top-down view's backdrop)
 * @param arc   how high above the horizon the sun climbs at noon (the moon, a little less)
 * @returns {{ shapes: Array<[x, y, w, h, color, alpha, fixed]>, flash: number }}
 */
export function outdoor({ date = new Date(), weather, light, now = 0, x0 = 0, x1 = 704, top = 6, bottom = 108, lod = 'full', glass = true, arc = 66 } = {}) {
  const w = weather || simulatedWeather(date);
  const L = light || daylight(date, w);
  const low = lod === 'low';
  const W = x1 - x0, HZ = bottom - 22; // horizon: the base of the hills
  const out = [];
  // fixed: in the terminal it is drawn even if it is smaller than a pixel (rain, stars, drops)
  const R = (x, y, ww, hh, c, a = 1, fixed = false) => {
    const xa = Math.max(x0, x), xb = Math.min(x1, x + ww), ya = Math.max(top, y), yb = Math.min(bottom, y + hh);
    if (xb > xa && yb > ya && a > 0.01) out.push([xa, ya, xb - xa, yb - ya, c, Math.min(1, a), fixed]);
  };
  const disc = (cx, cy, r, c, a = 1) => {
    for (let dy = -r; dy <= r; dy++) { const hw = Math.round(Math.sqrt(r * r - dy * dy)); R(cx - hw, cy + dy, hw * 2 + 1, 1, c, a); }
  };
  const lay = layout(x0, x1);
  const south = isSouth(w.lat, date.tz || localZone());
  const sea = season(date, south);
  const t = now / 1000;
  const fog = w.kind === 'fog';
  const snowing = w.kind === 'snow';
  const snowy = snowing || (sea === 'winter' && w.temp <= 0);

  // the sky, in bands (pixel art), greyer on a cloudy day
  let [skyTop, skyBot] = skyColors(L.alt);
  const grey = [mixc(0x7c8796, 0x161a28, L.night), mixc(0xb3bcc7, 0x252b3c, L.night)];
  const overcast = Math.min(1, L.gloom * 0.85 + (w.kind === 'storm' ? 0.15 : 0));
  skyTop = mixc(skyTop, mixc(grey[0], 0x4a5160, w.kind === 'storm' ? 0.6 : 0), overcast);
  skyBot = mixc(skyBot, grey[1], overcast);
  const band = 4;
  for (let y = top; y < HZ + 6; y += band) R(x0, y, W, band, mixc(skyTop, skyBot, (y - top) / (HZ - top)));

  // stars (if it is not cloudy)
  const starA = L.night * (1 - Math.min(1, w.clouds * 1.2));
  if (starA > 0.05) {
    for (const s of low ? lay.stars.slice(0, 18) : lay.stars) {
      R(s.x, top + s.y * (HZ - top - 30), 1, 1, 0xfffbe8, starA * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + s.p))), true);
    }
  }

  // the sun crosses from left to right and sets behind the hills
  const vis = 1 - Math.min(0.92, w.clouds * 0.9) - (fog ? 0.3 : 0);
  if (L.alt > -0.08 && vis > 0) {
    const k = Math.min(1, Math.max(0, (L.hour - L.sunrise) / (L.sunset - L.sunrise)));
    const sx = x0 + 16 + k * (W - 32), sy = HZ - 4 - Math.max(0, L.alt) * arc;
    const col = mixc(0xffb46b, 0xfff6d8, Math.min(1, L.alt * 3));
    if (!low) { disc(sx, sy, 22, 0xffe6a8, 0.05 * vis); disc(sx, sy, 14, 0xffe6a8, 0.09 * vis); }
    disc(sx, sy, 6, col, Math.min(1, vis + 0.15));
  }
  // the moon, with its phase (in the southern hemisphere it is lit from the other side)
  if (L.night > 0.3) {
    const nightLen = 24 - (L.sunset - L.sunrise);
    const k = (((L.hour - L.sunset + 24) % 24) / nightLen);
    const mx = x0 + 30 + Math.min(1, k) * (W - 60), my = HZ - 12 - Math.sin(Math.PI * Math.min(1, k)) * (arc - 8);
    const p = moonPhase(date), r = 5;
    const a = Math.min(1, L.night) * Math.max(0.15, 1 - w.clouds * 0.85);
    if (!low) disc(mx, my, 12, 0xdfe6ff, 0.05 * a);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r * 0.8) continue;
      const xn = (south ? -dx : dx) / r, yn = dy / r, edge = Math.cos(2 * Math.PI * p) * Math.sqrt(Math.max(0, 1 - yn * yn));
      const lit = p < 0.5 ? xn > edge : xn < -edge;
      R(mx + dx, my + dy, 1, 1, lit ? 0xf3efdc : 0x3a4466, lit ? a : a * 0.35, true);
    }
  }

  // hills in the background (with snow on the peaks: more in winter or if it is snowing)
  const haze = (c, k) => mixc(lit(c), skyBot, k);
  function lit(c) {
    let x = mixc(c, 0x0e1430, 0.78 * L.night);
    x = mixc(x, 0xff9a6a, 0.14 * L.dusk * (1 - 0.5 * L.night));
    return mixc(x, grey[1], 0.3 * L.gloom);
  }
  const far = fog ? 0.8 : 0.35;
  const rock = haze(0x8396b8, far), snowC = haze(0xeef3fb, far);
  const snowline = snowing ? 0.7 : SNOWLINE[sea];
  for (const [x, h] of lay.mountains) {
    R(x, HZ - h, 2, h + 2, rock);
    const cap = Math.max(0, h - 48 * (1 - snowline));
    if (cap > 0) R(x, HZ - h, 2, Math.min(h, cap), snowC);
  }

  // clouds drifting with the wind (on an overcast day, also a ceiling of clouds)
  const cloudC = mixc(mixc(mixc(0xffffff, 0xc4cad3, L.gloom), 0x6f7685, w.kind === 'storm' ? 0.7 : 0), 0xffb7a0, 0.3 * L.dusk * (1 - L.night));
  const cloudCol = mixc(cloudC, 0x2a3150, 0.8 * L.night);
  if (w.clouds >= 0.7) {
    const deep = 12 + w.clouds * 12;
    R(x0, top, W, deep, cloudCol, 0.6 * w.clouds);
    for (let x = x0 - ((t * (2 + w.wind * 0.1)) % 24); x < x1 + 24; x += 24) disc(Math.round(x), Math.round(top + deep), 9, cloudCol, 0.55 * w.clouds);
  }
  const nClouds = Math.round(w.clouds * (low ? 4 : 7));
  const speed = 3 + w.wind * 0.25;
  for (let i = 0; i < nClouds; i++) {
    const span = W + 90;
    const cx = Math.round(x0 - 45 + ((hash(i + 0.1) * span + t * speed * (0.6 + hash(i + 0.5) * 0.6)) % span));
    const cy = Math.round(top + 8 + hash(i + 0.7) * 30);
    const s = 0.8 + hash(i + 0.9) * 0.6;
    disc(cx - Math.round(8 * s), cy, Math.round(6 * s), cloudCol, 0.9);
    disc(cx, cy - Math.round(4 * s), Math.round(8 * s), cloudCol, 0.9);
    disc(cx + Math.round(9 * s), cy - 1, Math.round(6 * s), cloudCol, 0.9);
    R(cx - Math.round(14 * s), cy, Math.round(30 * s), Math.round(5 * s), cloudCol, 0.9);
  }

  // life in the sky (skyLife): what flies over the hills, in front of the clouds
  const sil = mixc(0x3b4252, 0x0e1222, L.night); // a silhouette against the sky
  for (const f of skyLife({ t, light: L, weather: w, x0, x1, top, low: HZ - 10, lod })) {
    const { x, y } = f;
    if (f.kind === 'bird') {
      R(x, y, 1, 1, sil, 0.9);
      for (const s of [-1, 1]) f.flap ? (R(x + s, y - 1, 1, 1, sil, 0.9), R(x + 2 * s, y - 2, 1, 1, sil, 0.9)) : (R(x + s, y, 1, 1, sil, 0.9), R(x + 2 * s, y + 1, 1, 1, sil, 0.9));
    } else if (f.kind === 'plane') {
      if (f.night) {
        R(x, y, 1, 1, 0xf4f7ff, f.blink ? 1 : 0.25, true);
        R(x - f.dir * 2, y, 1, 1, 0xff3b3b, 0.9, true);
        R(x + f.dir, y + 1, 1, 1, 0x4dff8a, 0.8, true);
      } else {
        for (let k = 0; k < 12; k++) R(x - f.dir * (5 + k * 3), y, 3, 1, 0xffffff, 0.32 * (1 - k / 12)); // its contrail
        R(x - 3, y, 7, 1, lit(0xe9eef5));
        R(x - f.dir * 3, y - 1, 1, 1, lit(0xc9d1dc));
        R(x, y + 1, 2, 1, lit(0xc9d1dc));
      }
    } else if (f.kind === 'balloon') {
      const c = [0xe63946, 0xffb703, 0x2a9d8f][f.hue];
      disc(x, y, 5, lit(c));
      R(x - 1, y - 5, 3, 10, lit(0xf1faee), 0.85); // its stripe
      R(x - 3, y + 4, 1, 4, lit(0x5a4636)); R(x + 3, y + 4, 1, 4, lit(0x5a4636));
      R(x - 2, y + 8, 5, 3, lit(0x8c5a33));
    } else if (f.kind === 'bat') {
      R(x, y, 1, 1, 0x14161f, 0.95);
      if (f.flap) { R(x - 1, y - 1, 1, 1, 0x14161f, 0.95); R(x + 1, y - 1, 1, 1, 0x14161f, 0.95); } else R(x - 2, y, 5, 1, 0x14161f, 0.95);
    } else if (f.kind === 'meteor') {
      for (let k = 0; k < 9; k++) R(Math.round(x - f.dir * k * 1.6), Math.round(y - k * 0.6), 1, 1, k ? 0xfff3c8 : 0xffffff, f.fade * (1 - k / 9), true);
    } else if (f.kind === 'satellite') R(x, y, 1, 1, 0xeef2ff, 0.75, true);
  }

  // the city: buildings with windows (at night, some lit)
  const base = bottom - 12;
  for (const b of lay.buildings) {
    const body = haze(b.c, fog ? 0.5 : 0.12);
    R(b.x, base - b.h, b.w, b.h, body);
    R(b.x, base - b.h, b.w, 1, mixc(body, 0xffffff, 0.12));
    if (snowy) R(b.x, base - b.h - 1, b.w, 2, lit(0xf2f5fa));
    if (b.antenna) {
      R(b.x + Math.floor(b.w / 2), base - b.h - 7, 1, 7, body);
      if (L.night > 0.4 && Math.floor(t * 1.2 + b.seed) % 2) R(b.x + Math.floor(b.w / 2), base - b.h - 8, 1, 1, 0xff3b3b, 1, true);
    }
    if (low && L.night < 0.4) continue;
    const phase = Math.floor(t / 20);
    for (let wy = base - b.h + 3; wy < base - 3; wy += 6) {
      for (let wx = b.x + 2; wx < b.x + b.w - 2; wx += 5) {
        const id = b.seed + wx * 0.37 + wy * 1.91;
        if (L.night > 0.4) {
          const on = hash(id + (hash(id) < 0.1 ? phase : 0)) < 0.32;
          if (on) R(wx, wy, 2, 3, 0xffd98a, 0.85 * L.night, low);
        } else R(wx, wy, 2, 3, mixc(body, 0xd6e6f5, 0.3));
      }
    }
  }

  // the street with cars (at night, street lamps and car lights)
  const roadY = base;
  R(x0, roadY, W, 5, lit(0x50555f));
  for (let x = x0; x < x1; x += 16) R(x, roadY + 2, 6, 1, lit(0xd8d8c0), 0.7);
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 ? 1 : -1, span = W + 40, sp = 26 + hash(i + 3.3) * 22;
    const pos = (((hash(i + 1.7) * span + dir * t * sp) % span) + span) % span;
    const cx = Math.round(x0 - 20 + pos), cy = roadY + (dir > 0 ? 0 : 2);
    R(cx, cy, 12, 3, lit(CARS[i % CARS.length]));
    R(cx + 3, cy - 2, 6, 2, lit(mixc(CARS[i % CARS.length], 0x223040, 0.5)));
    if (L.night > 0.3) {
      const front = dir > 0 ? cx + 12 : cx - 1;
      R(front, cy + 1, 1, 1, 0xfff3c8, 1, true);
      if (!low) R(dir > 0 ? front + 1 : front - 8, cy + 1, 8, 1, 0xfff3c8, 0.18 * L.night);
      R(dir > 0 ? cx - 1 : cx + 12, cy + 1, 1, 1, 0xff3b3b, 1, true);
    }
  }
  for (const lx of lay.lamps) {
    R(lx, roadY - 14, 1, 14, lit(0x2b2f3a));
    R(lx - 1, roadY - 15, 4, 2, L.night > 0.4 ? 0xffe2a0 : lit(0x3a3f4a));
    if (L.night > 0.4 && !low) disc(lx + 1, roadY - 12, 7, 0xffe2a0, 0.1 * L.night);
  }

  // the park: grass and trees that change with the season (in winter, leafless)
  R(x0, roadY + 5, W, bottom - roadY - 5, lit(snowy ? 0xf2f5fa : GRASS[sea]));
  const palette = TREE_COLORS[sea];
  const sway = Math.min(2, w.wind / 15);
  for (const tr of lay.trees) {
    const i = tr.seed, tx = tr.x, ty = bottom - 2;
    R(tx, ty - 10, 2, 10, lit(0x5a4030));
    const dx = Math.round(Math.sin(t * 1.4 + i) * sway);
    if (!palette.length) { // invierno: ramas desnudas
      for (const [bx, by, bh] of [[-4, -16, 6], [3, -17, 7], [-1, -20, 6], [-6, -13, 3], [5, -13, 3]]) R(tx + bx + dx, ty + by, 1, bh, lit(0x5a4636));
      if (snowy) for (const [bx, by] of [[-4, -17], [3, -18], [-1, -21]]) R(tx + bx + dx - 1, ty + by, 3, 1, lit(0xf2f5fa));
      continue;
    }
    const [leaf, light] = palette[Math.floor(tr.tone * palette.length)];
    const cx = tx + 1 + dx, cy = ty - 10 - tr.r + 3;
    disc(cx, cy, tr.r, lit(leaf));
    disc(cx - 2, cy - 2, Math.max(2, tr.r - 4), lit(light));
    if (sea === 'spring') for (let k = 0; k < 6; k++) R(cx - tr.r + 2 + Math.floor(hash(i + k) * (tr.r * 2 - 3)), cy - tr.r + 2 + Math.floor(hash(i + k + 9) * (tr.r * 2 - 3)), 1, 1, lit(0xf6a9c9), 1, low);
    if (snowy) R(cx - tr.r + 2, cy - tr.r, tr.r * 2 - 3, 2, lit(0xf2f5fa));
  }
  // leaves falling in autumn, petals in spring
  if ((sea === 'autumn' || sea === 'spring') && !WET.has(w.kind) && !low) {
    for (let i = 0; i < 8; i++) {
      const span = bottom - top - 40, fall = (hash(i + 4.4) * span + t * (8 + hash(i) * 6)) % span;
      const lx = x0 + ((hash(i + 2.2) * W + t * (6 + w.wind * 0.3) + Math.sin(t + i) * 4) % W);
      R(lx, top + 40 + fall, 2, 1, sea === 'autumn' ? lit([0xd9822b, 0xc4562b, 0xe2b13c][i % 3]) : lit(0xf6a9c9), 0.9);
    }
  }

  // fog: bands that hide what is far away
  if (fog) {
    const fc = mixc(0xd9dde3, 0x3a4056, L.night);
    for (let k = 0; k < 4; k++) R(x0, HZ - 30 + k * 12, W, 12, fc, 0.14 + 0.05 * k);
    for (let i = 0; i < 5; i++) { const fx = x0 + ((hash(i + 6) * W + t * 4) % W) - 40; R(fx, HZ - 8 + i * 4, 90, 3, fc, 0.25); }
  }
  // rain and snow
  if (WET.has(w.kind)) {
    const n = Math.round(w.precip * (low ? 45 : 130)), sp = w.kind === 'storm' ? 330 : w.kind === 'drizzle' ? 170 : 250;
    const slant = Math.min(1.2, w.wind / 30), span = bottom - top;
    const rc = mixc(0xc9d9ee, 0x7f8db0, L.night);
    for (let i = 0; i < n; i++) {
      const y = top + ((hash(i * 7.7) * span + t * sp) % span);
      const x = x0 + ((((hash(i * 3.1) * W - (y - top) * slant) % W) + W) % W);
      R(x, y, 1, w.kind === 'drizzle' ? 3 : 5, rc, w.kind === 'drizzle' ? 0.35 : 0.45, true);
    }
    if (!low) for (let i = 0; i < 10; i++) if (hash(i + Math.floor(t * 6)) < 0.5) R(x0 + hash(i * 9.1 + Math.floor(t * 6)) * W, bottom - 7, 2, 1, rc, 0.5);
  }
  if (snowing) {
    const n = Math.round(w.precip * (low ? 30 : 90)), span = bottom - top;
    for (let i = 0; i < n; i++) {
      const y = top + ((hash(i * 5.3) * span + t * (14 + hash(i) * 12)) % span);
      const x = x0 + ((((hash(i * 2.9) * W + Math.sin(t * 1.3 + i) * 5 + t * w.wind * 0.4) % W) + W) % W);
      R(x, y, i % 3 ? 1 : 2, i % 3 ? 1 : 2, 0xffffff, 0.9, true);
    }
  }
  // lightning: the bolt, and the whole landscape lights up for an instant
  const bolt = lightning(now, w);
  if (bolt.flash > 0) {
    let bx = x0 + 40 + bolt.x * (W - 80);
    for (let y = top + 8; y < HZ; y += 7) { R(bx, y, 2, 7, 0xf4f7ff, bolt.flash, true); bx += Math.round((hash(bolt.k + y) - 0.5) * 8); }
    R(x0, top, W, bottom - top, 0xdfe8ff, 0.32 * bolt.flash);
  }

  // ---- the glass: a very slight tint, diagonal reflections, drops and fogging
  if (glass) {
    R(x0, top, W, bottom - top, 0x9fc6e6, 0.05);
    if (L.night > 0.05) R(x0, top, W, bottom - top, 0x1a2036, 0.12 * L.night); // at night it reflects the interior a little
    const panes = [];
    for (let px = x0; px < x1; px += 88) panes.push(px);
    if (!low) {
      for (const px of panes) {
        const a = 0.04 + 0.03 * L.night;
        for (let k = 0; k * 8 < bottom - top; k++) { R(px + 12 + k * 3, top + k * 8, 9, 8, 0xffffff, a); R(px + 30 + k * 3, top + k * 8, 3, 8, 0xffffff, a * 0.8); }
        if (L.night > 0.2) disc(px + 44, top + 9, 3, 0xffe9c0, 0.22 * L.night); // the ceiling lamps, reflected
      }
    }
    if (WET.has(w.kind)) {
      const span = bottom - top;
      for (let i = 0; i < (low ? 10 : 28); i++) {
        const x = x0 + hash(i * 5.3 + 1) * W, sp = 5 + hash(i * 1.9) * 14, len = 3 + Math.floor(hash(i * 4.1) * 7);
        const y = top + ((hash(i * 2.1) * span + t * sp) % span);
        R(x, y - len, 1, len, 0xe2efff, 0.22, true);
        R(x, y, 2, 2, 0xf2f8ff, 0.5, true);
      }
    }
    if (Number.isFinite(w.temp) && w.temp <= 6) R(x0, bottom - 16, W, 16, 0xe8eef5, Math.min(0.16, 0.07 + (6 - w.temp) * 0.01)); // fogging
    // the aluminum frames
    for (const px of [...panes, x1]) { R(px - 2, top, 4, bottom - top, 0x39415a); R(px - 2, top, 1, bottom - top, 0x59627c); }
  }

  return { shapes: out, flash: bolt.flash };
}
