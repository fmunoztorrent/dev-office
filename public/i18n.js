// Idiomas del juego: inglés (por defecto) y español. El idioma es un ajuste de la oficina
// (⚙ › General, guardado en la base SQLite) y lo comparten el servidor, la terminal y la web.
//
//   t('ui.live')                      → "live" / "en vivo"
//   t('sim.lunch.banner', { h: 13 })  → con {variables}
//   ta('sim.gossip.po')               → una lista (frases para elegir al azar)
//   listOf(['Ana', 'Leo', 'Sol'])     → "Ana, Leo and Sol" / "Ana, Leo y Sol"

import en from './locales/en.js';
import es from './locales/es.js';

export const LANGUAGES = { en: 'English', es: 'Español' };
export const DEFAULT_LANGUAGE = 'en';
const DICTS = { en, es };

let lang = DEFAULT_LANGUAGE;
const listeners = new Set();

const lookup = (dict, key) => {
  let v = dict;
  for (const k of key.split('.')) { if (v == null) return undefined; v = v[k]; }
  return v;
};
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))) : s);

export const isLanguage = (l) => Object.hasOwn(DICTS, l);
export const getLanguage = () => lang;

/** Cambia el idioma (los que escuchan con onLanguage se enteran). Uno desconocido → inglés. */
export function setLanguage(l) {
  const next = isLanguage(l) ? l : DEFAULT_LANGUAGE;
  if (next === lang) return lang;
  lang = next;
  for (const fn of listeners) { try { fn(lang); } catch { /* un oyente no rompe a los demás */ } }
  return lang;
}
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** El texto de `key` en el idioma actual (si falta, el inglés; si tampoco, la clave). */
export function t(key, vars) {
  const v = lookup(DICTS[lang], key) ?? lookup(en, key);
  if (typeof v === 'string') return fill(v, vars);
  if (typeof v === 'function') return v(vars || {});
  return v === undefined ? key : String(v);
}

/** Una lista de frases (o un objeto) del idioma actual. Con vars, se completan sus {variables}. */
export function ta(key, vars) {
  const v = lookup(DICTS[lang], key) ?? lookup(en, key);
  if (Array.isArray(v)) return vars ? v.map((s) => fill(s, vars)) : v;
  return v ?? [];
}

/** ¿Existe la clave? (en el idioma actual o en inglés) */
export const has = (key) => (lookup(DICTS[lang], key) ?? lookup(en, key)) !== undefined;

/** "A, B y C" / "A, B and C" */
export function listOf(items) {
  const xs = items.filter(Boolean).map(String);
  try { return new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); }
}

/** La hora "HH:MM" en el idioma y la zona dados (para bitácoras). */
export function timeOf(ms, tz, { seconds = false } = {}) {
  try {
    return new Date(ms).toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...(tz ? { timeZone: tz } : {}) });
  } catch { return new Date(ms).toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit' }); }
}
