// Lo que se ve por la pared de vidrio: el cielo según la hora y la fecha (sol, luna con su fase,
// estrellas, amanecer y atardecer según la estación), el clima (nubes, lluvia, nieve, neblina,
// tormenta con relámpagos) y la ciudad con su parque, que cambia de color con la estación.
//
// Lo usan los dos renderers: outdoor() devuelve una lista de rectángulos [x, y, w, h, color, alpha,
// fijo] en coordenadas del mundo, y cada uno los dibuja a su manera (el canvas tal cual; la terminal
// escalados a sus píxeles). El servidor usa fromOpenMeteo() para traducir el clima real.
//
// Las fechas pueden ser Date o ZonedDate (clock.js): la hora de la oficina en su zona horaria.

import { zoned } from './clock.js';

const DAY_MS = 86_400_000;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hoursOf = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
const dayOfYear = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY_MS);
// la hora del amanecer o atardecer: horas del día, o un instante (ms de época) que se pasa a la hora
// de la zona de `date`
const toHours = (v, date) => (v > 48 ? hoursOf(zoned(v, date?.tz)) : v);

// ------------------------------------------------------------------ fecha

const SOUTH_TZ = /^(America\/(Santiago|Punta_Arenas|Argentina|Buenos_Aires|Cordoba|Mendoza|Montevideo|Asuncion|Sao_Paulo|La_Paz|Lima)|Australia\/|Pacific\/(Auckland|Chatham|Fiji|Tahiti|Easter)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone)|Antarctica\/|Indian\/(Mauritius|Reunion))/;
export function localZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
/** Hemisferio sur: por la latitud si se conoce; si no, por la zona horaria del equipo. */
export function isSouth(lat, tz = localZone()) { return Number.isFinite(lat) ? lat < 0 : SOUTH_TZ.test(tz); }

/** La estación del año según la fecha y el hemisferio. */
export function season(date = new Date(), south = isSouth()) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const north = md >= 1221 || md < 320 ? 'winter' : md < 621 ? 'spring' : md < 923 ? 'summer' : 'autumn';
  return south ? { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[north] : north;
}

/** Fase de la luna: 0 = nueva, 0.5 = llena (meses sinódicos desde una luna nueva conocida). */
export function moonPhase(date = new Date()) {
  const p = ((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

const isDst = (d) => {
  const at = (ms) => (d.offsetAt ? d.offsetAt(ms) : new Date(ms).getTimezoneOffset());
  const jan = at(Date.UTC(d.getFullYear(), 0, 1)), jul = at(Date.UTC(d.getFullYear(), 6, 1));
  return d.getTimezoneOffset() < Math.max(jan, jul);
};
/** Amanecer y atardecer (horas locales) aproximados por la latitud, la longitud y el día del año. */
export function sunTimes(date = new Date(), { lat, lon } = {}) {
  const phi = ((Number.isFinite(lat) ? lat : isSouth(lat, date.tz || localZone()) ? -33.5 : 40) * Math.PI) / 180;
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear(date))) / 365);
  const half = (Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl)))) * 12) / Math.PI + 0.13; // + refracción
  const noon = Number.isFinite(lon) ? 12 - date.getTimezoneOffset() / 60 - lon / 15 : 12.3 + (isDst(date) ? 1 : 0);
  return { sunrise: noon - half, sunset: noon + half };
}

// ------------------------------------------------------------------ clima

// El nombre de cada clima está en los idiomas (i18n: weather.<tipo>).
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

/** Código WMO (el que usa Open-Meteo) → el tipo de clima que dibuja la oficina. */
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

/** La respuesta de api.open-meteo.com/v1/forecast (current + daily sunrise/sunset) → el clima de la oficina. */
export function fromOpenMeteo(data, place = {}) {
  const c = data?.current;
  if (!c || c.weather_code == null) return null;
  const kind = weatherKind(c.weather_code);
  // las horas vienen en la zona del lugar: se guardan como instantes para dibujarlas en la hora local
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
 * Sin conexión (o con DEV_TEAM_OFFICE_WEATHER=off) la oficina inventa el clima: cambia cada tres
 * horas, con las probabilidades de la estación. Siempre da lo mismo para la misma hora.
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
 * La luz según la hora real y el clima.
 *   night: 0 de día, 1 de noche · dusk: atardecer/amanecer · alt: altura del sol (1 al mediodía,
 *   negativa de noche) · gloom: qué tan gris está el día.
 * De noche la oficina sigue con las luces prendidas, así que no se oscurece: `shade` sólo enfría un
 * poco el color (multiplica cada canal RGB); al atardecer entra un tono tibio y con el día gris se
 * apaga un poco.
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

// Los relámpagos: en cada ventana de 5,2 s puede caer uno (la mitad de las veces).
const STRIKE_EVERY = 5200;
export function strikeStart(k) { return hash(k * 1.37 + 0.5) < 0.5 ? k * STRIKE_EVERY + hash(k * 2.11 + 0.9) * 3600 : null; }
/** ¿Hay un relámpago en este instante? flash va de 0 a 1 (doble destello, como los de verdad). */
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

// ------------------------------------------------------------------ el paisaje

const mixc = (a, b, t) => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ch = (s) => { const x = (a >> s) & 255; return Math.round(x + (((b >> s) & 255) - x) * t); };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
export const colorHex = (c) => `#${(c | 0x1000000).toString(16).slice(1)}`;

// el color del cielo (arriba, horizonte) según la altura del sol
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
const SNOWLINE = { winter: 0.55, autumn: 0.3, spring: 0.32, summer: 0.12 }; // cuánto de los cerros tiene nieve
const BUILDING = [0x6f86a8, 0x7d92b0, 0x5f7698, 0x8a9cb8, 0x687d9e];
const CARS = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703, 0x2b2d42];

// Lo que no cambia (cerros, edificios, árboles, estrellas): se genera una vez por ancho.
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
 * El paisaje detrás del vidrio, de atrás hacia adelante, y el vidrio encima (marcos, reflejos,
 * gotas, empañado). Todo recortado al rectángulo [x0, x1] × [top, bottom].
 * @param lod 'full' (navegador) o 'low' (terminal: menos detalles chicos)
 * @returns {{ shapes: Array<[x, y, w, h, color, alpha, fijo]>, flash: number }}
 */
export function outdoor({ date = new Date(), weather, light, now = 0, x0 = 0, x1 = 704, top = 6, bottom = 108, lod = 'full' } = {}) {
  const w = weather || simulatedWeather(date);
  const L = light || daylight(date, w);
  const low = lod === 'low';
  const W = x1 - x0, HZ = bottom - 22; // horizonte: la base de los cerros
  const out = [];
  // fijo: en la terminal se dibuja aunque mida menos de un píxel (lluvia, estrellas, gotas)
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

  // el cielo, en franjas (pixel art), más gris con el día nublado
  let [skyTop, skyBot] = skyColors(L.alt);
  const grey = [mixc(0x7c8796, 0x161a28, L.night), mixc(0xb3bcc7, 0x252b3c, L.night)];
  const overcast = Math.min(1, L.gloom * 0.85 + (w.kind === 'storm' ? 0.15 : 0));
  skyTop = mixc(skyTop, mixc(grey[0], 0x4a5160, w.kind === 'storm' ? 0.6 : 0), overcast);
  skyBot = mixc(skyBot, grey[1], overcast);
  const band = 4;
  for (let y = top; y < HZ + 6; y += band) R(x0, y, W, band, mixc(skyTop, skyBot, (y - top) / (HZ - top)));

  // estrellas (si no está nublado)
  const starA = L.night * (1 - Math.min(1, w.clouds * 1.2));
  if (starA > 0.05) {
    for (const s of low ? lay.stars.slice(0, 18) : lay.stars) {
      R(s.x, top + s.y * (HZ - top - 30), 1, 1, 0xfffbe8, starA * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + s.p))), true);
    }
  }

  // el sol cruza de izquierda a derecha y se esconde detrás de los cerros
  const vis = 1 - Math.min(0.92, w.clouds * 0.9) - (fog ? 0.3 : 0);
  if (L.alt > -0.08 && vis > 0) {
    const k = Math.min(1, Math.max(0, (L.hour - L.sunrise) / (L.sunset - L.sunrise)));
    const sx = x0 + 16 + k * (W - 32), sy = HZ - 4 - Math.max(0, L.alt) * 66;
    const col = mixc(0xffb46b, 0xfff6d8, Math.min(1, L.alt * 3));
    if (!low) { disc(sx, sy, 22, 0xffe6a8, 0.05 * vis); disc(sx, sy, 14, 0xffe6a8, 0.09 * vis); }
    disc(sx, sy, 6, col, Math.min(1, vis + 0.15));
  }
  // la luna, con su fase (en el hemisferio sur se ilumina del otro lado)
  if (L.night > 0.3) {
    const nightLen = 24 - (L.sunset - L.sunrise);
    const k = (((L.hour - L.sunset + 24) % 24) / nightLen);
    const mx = x0 + 30 + Math.min(1, k) * (W - 60), my = HZ - 12 - Math.sin(Math.PI * Math.min(1, k)) * 58;
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

  // cerros al fondo (con nieve en las cumbres: más en invierno o si está nevando)
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

  // nubes que pasan con el viento (en un día cubierto, además un techo de nubes)
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

  // la ciudad: edificios con ventanas (de noche, prendidas algunas)
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

  // la calle con autos (de noche, faroles y luces de los autos)
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

  // el parque: pasto y árboles que cambian con la estación (en invierno, sin hojas)
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
  // hojas que caen en otoño, pétalos en primavera
  if ((sea === 'autumn' || sea === 'spring') && !WET.has(w.kind) && !low) {
    for (let i = 0; i < 8; i++) {
      const span = bottom - top - 40, fall = (hash(i + 4.4) * span + t * (8 + hash(i) * 6)) % span;
      const lx = x0 + ((hash(i + 2.2) * W + t * (6 + w.wind * 0.3) + Math.sin(t + i) * 4) % W);
      R(lx, top + 40 + fall, 2, 1, sea === 'autumn' ? lit([0xd9822b, 0xc4562b, 0xe2b13c][i % 3]) : lit(0xf6a9c9), 0.9);
    }
  }

  // neblina: franjas que tapan lo de lejos
  if (fog) {
    const fc = mixc(0xd9dde3, 0x3a4056, L.night);
    for (let k = 0; k < 4; k++) R(x0, HZ - 30 + k * 12, W, 12, fc, 0.14 + 0.05 * k);
    for (let i = 0; i < 5; i++) { const fx = x0 + ((hash(i + 6) * W + t * 4) % W) - 40; R(fx, HZ - 8 + i * 4, 90, 3, fc, 0.25); }
  }
  // lluvia y nieve
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
  // relámpago: el rayo y todo el paisaje se ilumina un instante
  const bolt = lightning(now, w);
  if (bolt.flash > 0) {
    let bx = x0 + 40 + bolt.x * (W - 80);
    for (let y = top + 8; y < HZ; y += 7) { R(bx, y, 2, 7, 0xf4f7ff, bolt.flash, true); bx += Math.round((hash(bolt.k + y) - 0.5) * 8); }
    R(x0, top, W, bottom - top, 0xdfe8ff, 0.32 * bolt.flash);
  }

  // ---- el vidrio: un tinte muy leve, reflejos en diagonal, gotas y empañado
  R(x0, top, W, bottom - top, 0x9fc6e6, 0.05);
  if (L.night > 0.05) R(x0, top, W, bottom - top, 0x1a2036, 0.12 * L.night); // de noche refleja un poco el interior
  const panes = [];
  for (let px = x0; px < x1; px += 88) panes.push(px);
  if (!low) {
    for (const px of panes) {
      const a = 0.04 + 0.03 * L.night;
      for (let k = 0; k * 8 < bottom - top; k++) { R(px + 12 + k * 3, top + k * 8, 9, 8, 0xffffff, a); R(px + 30 + k * 3, top + k * 8, 3, 8, 0xffffff, a * 0.8); }
      if (L.night > 0.2) disc(px + 44, top + 9, 3, 0xffe9c0, 0.22 * L.night); // las lámparas del techo, reflejadas
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
  if (Number.isFinite(w.temp) && w.temp <= 6) R(x0, bottom - 16, W, 16, 0xe8eef5, Math.min(0.16, 0.07 + (6 - w.temp) * 0.01)); // empañado
  // los marcos de aluminio
  for (const px of [...panes, x1]) { R(px - 2, top, 4, bottom - top, 0x39415a); R(px - 2, top, 1, bottom - top, 0x59627c); }

  return { shapes: out, flash: bolt.flash };
}
