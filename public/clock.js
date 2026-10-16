// La hora de la oficina: cada oficina tiene su zona horaria (⚙ › Oficinas; por defecto la del
// sistema). De la zona salen la fecha y la hora que se ven (el reloj, el almuerzo, el día y la
// noche), el país y la ciudad, y con ella el clima de afuera.
//
// ZonedDate se porta como un Date (getHours, getMonth, getTimezoneOffset…) pero en la zona que se
// le pide, así sky.js y sim.js no necesitan saber de zonas.

import { ZONES } from './zones.js';

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    formatters.set(tz, f);
  }
  return f;
}
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** La zona horaria del sistema (la del navegador o la del servidor). */
export function systemZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }

/** ¿Es una zona horaria IANA válida? */
export function validZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Todas las zonas que conoce el entorno (para elegir en ⚙). */
export function allZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return Object.keys(ZONES).sort(); }
}

/** Minutos que hay que sumarle a la hora de la zona para llegar a UTC (como Date#getTimezoneOffset). */
export function zoneOffset(ms, tz) {
  const p = parts(ms, tz);
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / -60000);
}

function parts(ms, tz) {
  const out = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) out[type] = value;
  return { y: Number(out.year), mo: Number(out.month) - 1, d: Number(out.day), h: Number(out.hour) % 24, mi: Number(out.minute), s: Number(out.second), dow: WEEKDAY[out.weekday] ?? 0 };
}

export class ZonedDate {
  /** @param tz zona IANA; sin zona, la del sistema */
  constructor(ms = Date.now(), tz = null) {
    this.ms = Number(ms);
    this.tz = validZone(tz) ? tz : null;
    if (this.tz) this.p = parts(this.ms, this.tz);
    else {
      const d = new Date(this.ms);
      this.p = { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), dow: d.getDay() };
    }
  }
  getTime() { return this.ms; }
  valueOf() { return this.ms; }
  getFullYear() { return this.p.y; }
  getMonth() { return this.p.mo; }
  getDate() { return this.p.d; }
  getDay() { return this.p.dow; }
  getHours() { return this.p.h; }
  getMinutes() { return this.p.mi; }
  getSeconds() { return this.p.s; }
  getMilliseconds() { return ((this.ms % 1000) + 1000) % 1000; }
  getTimezoneOffset() { return this.tz ? zoneOffset(this.ms, this.tz) : new Date(this.ms).getTimezoneOffset(); }
  /** El desfase (como getTimezoneOffset) de otro instante, en la misma zona. */
  offsetAt(ms) { return this.tz ? zoneOffset(ms, this.tz) : new Date(ms).getTimezoneOffset(); }
}

/** La fecha y hora de ahora en la zona. */
export const zoned = (ms = Date.now(), tz = null) => new ZonedDate(ms, tz);

/**
 * Lo que se sabe de una zona sin conexión: el país (ISO), las coordenadas de su ciudad principal
 * y el nombre de esa ciudad. { tz, country, lat, lon, city }
 */
export function zoneInfo(tz) {
  const z = ZONES[tz];
  const city = String(tz || '').split('/').pop().replace(/_/g, ' ');
  return z ? { tz, country: z[0], lat: z[1], lon: z[2], city } : { tz, country: null, lat: undefined, lon: undefined, city };
}

/** El nombre del país en el idioma que se pide (Intl.DisplayNames), o el código. */
export function countryName(code, lang = 'en') {
  if (!code) return '';
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
}

/** "HH:MM" (o "HH:MM:SS") en la zona. */
export function clockText(ms, tz, { seconds = false } = {}) {
  const d = zoned(ms, tz), pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
}
