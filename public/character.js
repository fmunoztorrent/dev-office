// A character as a JSON file, to share it: who they are (name, title, sex), how they behave
// (personality), how they answer you (style) and how they look. Used by ⚙ › Characters (export and
// import buttons), the CLI (`dev-team-office character export|import`) and the API
// (GET/PUT /v1/characters/<role>).
//
//   { "kind": "dev-team-office/character", "version": 1, "role": "qa", "name": "Andrés",
//     "sex": "m", "personality": "anxious", "style": "teacher", "shirt": "#8ac926", … }

import { APPEARANCE_KEYS, defaultLook, PERSONALITIES, SEXES, STYLES } from './sim.js';

export const CHARACTER_KIND = 'dev-team-office/character';
const COLORS = new Set(['shirt', 'pants', 'hair', 'skin']);
const FLAGS = new Set(['long', 'beard', 'glasses']);

/** The character of `role` with that look, as an object ready to save as JSON. The title goes only if it was customized. */
export function exportCharacter(role, look = {}) {
  const out = { kind: CHARACTER_KIND, version: 1, role };
  for (const k of APPEARANCE_KEYS) {
    const v = look[k] ?? defaultLook(role)?.[k];
    if (k === 'title' && (!v || v === defaultLook(role)?.title)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Reads a shared character (an object or its JSON text). Only the known keys, each checked:
 * { ok: true, role, look } (role: the one it was exported from, if known) or { ok: false, error },
 * where error is 'json' (it is not JSON) or 'kind' (it is not a character).
 */
export function parseCharacter(input) {
  let c = input;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return { ok: false, error: 'json' }; } }
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.kind !== CHARACTER_KIND) return { ok: false, error: 'kind' };
  const look = {};
  for (const k of APPEARANCE_KEYS) {
    const v = c[k];
    if (v === undefined || v === null) continue;
    if (COLORS.has(k)) { if (/^#[0-9a-f]{6}$/i.test(String(v))) look[k] = String(v).toLowerCase(); }
    else if (FLAGS.has(k)) look[k] = !!v;
    else if (k === 'sex') { if (SEXES.includes(v)) look[k] = v; }
    else if (k === 'personality') { if (Object.hasOwn(PERSONALITIES, v)) look[k] = v; }
    else if (k === 'style') { if (STYLES.includes(v)) look[k] = v; }
    else if (typeof v === 'string' && v.trim()) look[k] = v.trim().slice(0, k === 'name' ? 20 : 30);
  }
  return { ok: true, role: defaultLook(c.role) ? c.role : null, look };
}

/** What of `look` differs from the role's original (what is saved as its appearance). */
export function changedLook(role, look) {
  return Object.fromEntries(APPEARANCE_KEYS.filter((k) => look[k] !== undefined && look[k] !== defaultLook(role)?.[k]).map((k) => [k, look[k]]));
}

/** A file name for a character: "andres-qa.json". */
export const characterFile = (role, name) => `${String(name || role).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || role}-${role}.json`;
