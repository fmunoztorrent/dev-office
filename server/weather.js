// The weather outside, for the office's glass wall: Open-Meteo (free, no API key).
//
// The location is the office's city (⚙ › General › City, or each office's), DEV_TEAM_OFFICE_LOCATION
// (a city, "Valparaíso", or coordinates, "-33.45,-70.65") or, if unset, the city of the team's time
// zone (America/Santiago → Santiago). Only that is sent: the city's name to locate it and its
// coordinates to ask for the weather. With DEV_TEAM_OFFICE_WEATHER=off nothing is queried and the
// office makes up a weather by season (the same happens offline). findPlaces() is the city picker's
// search: the cities of one country whose name starts with what was typed.

import { EventEmitter } from 'node:events';
import { fromOpenMeteo, localZone, parsePlace, placeLocation } from '../public/sky.js';
import { t, getLanguage } from '../public/i18n.js';

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

export class Weather extends EventEmitter {
  /**
   * @param location  city or "lat,lon" (by default DEV_TEAM_OFFICE_LOCATION or the time zone's)
   * @param enabled   false: queries nothing (the default, unless DEV_TEAM_OFFICE_WEATHER=off)
   * @param fetch     for the tests
   * @param every     how often it updates (ms)
   * @param place     the place's name when `location` is coordinates (e.g. the time zone's city)
   */
  constructor({ location = process.env.DEV_TEAM_OFFICE_LOCATION, enabled = process.env.DEV_TEAM_OFFICE_WEATHER !== 'off', fetch = globalThis.fetch, timezone = localZone(), every = 15 * 60_000, retry = 3 * 60_000, log = () => {}, place = '' } = {}) {
    super();
    Object.assign(this, { location, enabled: enabled && typeof fetch === 'function', fetchFn: fetch, timezone, every, retry, log, placeName: place || '' });
    this.current = null;
    this.place = null;
    this.timer = null;
    this.failures = 0;
  }

  start() {
    if (!this.enabled || this.timer) return this;
    const loop = async () => {
      await this.refresh();
      this.timer = setTimeout(loop, this.failures ? this.retry : this.every);
      this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
    return this;
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async getJson(url) {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Where the office is: direct coordinates or the city looked up in the geocoder. */
  async locate() {
    const own = parsePlace(this.location);
    if (Number.isFinite(own?.lat)) return { lat: own.lat, lon: own.lon, name: own.name || this.placeName };
    const name = (own?.name || this.timezone.split('/').pop() || '').replace(/_/g, ' ').trim();
    if (!name) throw new Error(t('weatherMsg.noLocation'));
    const q = new URLSearchParams({ name, count: '5', language: getLanguage(), format: 'json' });
    const hits = (await this.getJson(`${GEOCODING}?${q}`)).results || [];
    // if there are several with that name, the one in our time zone
    const hit = hits.find((h) => h.timezone === this.timezone) || hits[0];
    if (!hit) throw new Error(t('weatherMsg.notFound', { name }));
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
  }

  async refresh() {
    try {
      this.place ??= await this.locate();
      const q = new URLSearchParams({
        latitude: String(this.place.lat), longitude: String(this.place.lon),
        current: 'temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,is_day',
        daily: 'sunrise,sunset', timezone: 'auto', forecast_days: '1',
      });
      const w = fromOpenMeteo(await this.getJson(`${FORECAST}?${q}`), this.place);
      if (!w) throw new Error(t('weatherMsg.noData'));
      const changed = JSON.stringify(w) !== JSON.stringify(this.current);
      this.current = w;
      this.failures = 0;
      if (changed) this.emit('change', w);
    } catch (err) {
      if (this.failures++ === 0) this.log(t('weatherMsg.unavailable', { error: err.message }));
    }
    return this.current;
  }
}

/**
 * The cities of a country whose name starts with `q` (Open-Meteo's geocoder), for the city picker.
 * @param country  ISO 3166-1 alpha-2 code (the time zone's country); without it, any country
 * @returns [{ name, region, country, lat, lon, label, location }] (`location`: the text that is stored)
 */
export async function findPlaces(q, { country, lang = getLanguage(), fetch = globalThis.fetch, count = 8 } = {}) {
  const name = String(q ?? '').trim();
  if (name.length < 2 || typeof fetch !== 'function') return [];
  const params = new URLSearchParams({ name, count: String(count), language: lang, format: 'json', ...(country ? { countryCode: country } : {}) });
  const res = await fetch(`${GEOCODING}?${params}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()).results || [])
    .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude) && (!country || h.country_code === country))
    .map((h) => {
      const label = [h.name, h.admin1 && h.admin1 !== h.name ? h.admin1 : null].filter(Boolean).join(', ');
      return { name: h.name, region: h.admin1 || '', country: h.country_code || '', lat: h.latitude, lon: h.longitude, label, location: placeLocation({ name: label, lat: h.latitude, lon: h.longitude }) };
    });
}
