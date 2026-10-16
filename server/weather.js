// El clima de afuera, para la pared de vidrio de la oficina: Open-Meteo (gratis y sin API key).
//
// La ubicación sale de DEV_TEAM_OFFICE_LOCATION (una ciudad, "Valparaíso", o coordenadas,
// "-33.45,-70.65") o, si no está, de la ciudad de la zona horaria del equipo
// (America/Santiago → Santiago). Sólo se manda eso: el nombre de la ciudad para ubicarla y sus
// coordenadas para pedir el clima. Con DEV_TEAM_OFFICE_WEATHER=off no se consulta nada y la
// oficina inventa un clima según la estación (lo mismo pasa sin conexión).

import { EventEmitter } from 'node:events';
import { fromOpenMeteo, localZone } from '../public/sky.js';
import { t, getLanguage } from '../public/i18n.js';

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export class Weather extends EventEmitter {
  /**
   * @param location  ciudad o "lat,lon" (por defecto DEV_TEAM_OFFICE_LOCATION o la de la zona horaria)
   * @param enabled   false: no consulta nada (por defecto, salvo DEV_TEAM_OFFICE_WEATHER=off)
   * @param fetch     para los tests
   * @param every     cada cuánto se actualiza (ms)
   * @param place     el nombre del lugar cuando `location` son coordenadas (p. ej. la ciudad de la zona horaria)
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

  /** Dónde está la oficina: coordenadas directas o la ciudad buscada en el geocodificador. */
  async locate() {
    const m = COORDS.exec(this.location || '');
    if (m) return { lat: Number(m[1]), lon: Number(m[2]), name: this.placeName };
    const name = (this.location || this.timezone.split('/').pop() || '').replace(/_/g, ' ').trim();
    if (!name) throw new Error(t('weatherMsg.noLocation'));
    const q = new URLSearchParams({ name, count: '5', language: getLanguage(), format: 'json' });
    const hits = (await this.getJson(`${GEOCODING}?${q}`)).results || [];
    // si hay varias con ese nombre, la de nuestra zona horaria
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
