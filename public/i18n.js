// The game's languages: English (the default) and Spanish. The language is an office setting
// (⚙ › General, saved in the SQLite database) shared by the server, the terminal and the web.
//
//   t('ui.live')                      → "live" / "en vivo"
//   t('sim.lunch.banner', { h: 13 })  → with {variables}
//   ta('sim.gossip.po')               → a list (phrases to pick at random)
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

/** Changes the language (whoever listens with onLanguage is told). An unknown one → English. */
export function setLanguage(l) {
  const next = isLanguage(l) ? l : DEFAULT_LANGUAGE;
  if (next === lang) return lang;
  lang = next;
  for (const fn of listeners) { try { fn(lang); } catch { /* one listener does not break the others */ } }
  return lang;
}
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The text of `key` in the current language (if missing, the English one; if that is missing too, the key). */
export function t(key, vars) {
  const v = lookup(DICTS[lang], key) ?? lookup(en, key);
  if (typeof v === 'string') return fill(v, vars);
  if (typeof v === 'function') return v(vars || {});
  return v === undefined ? key : String(v);
}

/** A list of phrases (or an object) in the current language. With vars, its {variables} are filled in. */
export function ta(key, vars) {
  const v = lookup(DICTS[lang], key) ?? lookup(en, key);
  if (Array.isArray(v)) return vars ? v.map((s) => fill(s, vars)) : v;
  return v ?? [];
}

/** Does the key exist? (in the current language or in English) */
export const has = (key) => (lookup(DICTS[lang], key) ?? lookup(en, key)) !== undefined;

/** "A, B y C" / "A, B and C" */
export function listOf(items) {
  const xs = items.filter(Boolean).map(String);
  try { return new Intl.ListFormat(lang, { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); }
}

/** The time "HH:MM" in the given language and zone (for logs). */
export function timeOf(ms, tz, { seconds = false } = {}) {
  try {
    return new Date(ms).toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...(tz ? { timeZone: tz } : {}) });
  } catch { return new Date(ms).toLocaleTimeString(lang, { hour12: false, hour: '2-digit', minute: '2-digit' }); }
}
