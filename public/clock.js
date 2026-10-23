// The office's time: each office has its time zone (⚙ › Offices; the system's by default). The
// zone gives the date and time shown (the clock, lunch, day and night), the country and the city,
// and with it the weather outside.
//
// ZonedDate behaves like a Date (getHours, getMonth, getTimezoneOffset…) but in the requested zone,
// so sky.js and sim.js do not need to know about zones.

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

/** The system's time zone (the browser's or the server's). */
export function systemZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }

/** Is it a valid IANA time zone? */
export function validZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Every zone the environment knows (to choose from in ⚙). */
export function allZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return Object.keys(ZONES).sort(); }
}

/** Minutes to add to the zone's time to get UTC (like Date#getTimezoneOffset). */
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
  /** @param tz IANA zone; without a zone, the system's */
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
  /** The offset (like getTimezoneOffset) of another instant, in the same zone. */
  offsetAt(ms) { return this.tz ? zoneOffset(ms, this.tz) : new Date(ms).getTimezoneOffset(); }
}

/** The current date and time in the zone. */
export const zoned = (ms = Date.now(), tz = null) => new ZonedDate(ms, tz);

/**
 * What is known about a zone offline: the country (ISO), the coordinates of its main city
 * and that city's name. { tz, country, lat, lon, city }
 */
export function zoneInfo(tz) {
  const z = ZONES[tz];
  const city = String(tz || '').split('/').pop().replace(/_/g, ' ');
  return z ? { tz, country: z[0], lat: z[1], lon: z[2], city } : { tz, country: null, lat: undefined, lon: undefined, city };
}

/** The country's name in the requested language (Intl.DisplayNames), or the code. */
export function countryName(code, lang = 'en') {
  if (!code) return '';
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
}

/** "HH:MM" (or "HH:MM:SS") in the zone. */
export function clockText(ms, tz, { seconds = false } = {}) {
  const d = zoned(ms, tz), pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
}
