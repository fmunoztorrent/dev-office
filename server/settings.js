// ⚙ Ajustes de la oficina. La oficina es el frontend: sólo guarda lo que es suyo, la apariencia
// de los personajes (~/.dev-team-office/config.json). La configuración de los agentes (equipo,
// modelos, pipelines en <proyecto>/.devteam/) es del agente: la oficina sólo la muestra tal
// como cada agente la anuncia.
//
// Todo se valida antes de escribir: un error devuelve { ok: false, error } y no toca el archivo.

import fs from 'node:fs';
import path from 'node:path';
import { configFile, loadConfig } from './tasks.js';
import { normRole } from './roles.js';

const COLOR_RX = /^#[0-9a-f]{6}$/i;
const APPEARANCE = { name: 'text', title: 'text', shirt: 'color', pants: 'color', hair: 'color', skin: 'color', long: 'bool', beard: 'bool', glasses: 'bool' };

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file); // atómico: nunca queda un archivo a medio escribir
}

export function readOfficeSettings() {
  const raw = loadConfig();
  return { file: configFile(), appearance: raw.appearance || {} };
}

/** patch: { appearance: { rol: { name, title, shirt, pants, hair, skin, long, beard, glasses } | null } } (null = original) */
export function writeOfficeSettings(patch = {}) {
  try {
    const raw = loadConfig();
    const next = { ...raw };
    if (patch.appearance !== undefined) {
      const appearance = { ...(raw.appearance || {}) };
      for (const [key, look] of Object.entries(patch.appearance || {})) {
        const role = normRole(key) || fail(`rol desconocido: ${key}`);
        if (look === null) { delete appearance[role]; continue; }
        const clean = {};
        for (const [k, v] of Object.entries(look || {})) {
          const type = APPEARANCE[k] || fail(`${role}: no se puede cambiar "${k}"`);
          if (type === 'color') { if (!COLOR_RX.test(String(v))) fail(`${role}.${k}: usa un color como #3f73f0`); clean[k] = String(v).toLowerCase(); }
          else if (type === 'bool') clean[k] = !!v;
          else {
            const t = String(v ?? '').trim();
            if (!t) fail(`${role}.${k} no puede quedar vacío`);
            clean[k] = t.slice(0, k === 'name' ? 20 : 30);
          }
        }
        if (Object.keys(clean).length) appearance[role] = clean; else delete appearance[role];
      }
      if (Object.keys(appearance).length) next.appearance = appearance; else delete next.appearance;
    }
    // Restos de versiones anteriores: eran configuración de agentes, ya no de la oficina.
    delete next.launchers;
    delete next.projects;
    delete next.cwd;
    writeJson(configFile(), next);
    return { ok: true, config: next, settings: readOfficeSettings() };
  } catch (err) {
    return { ok: false, error: err instanceof Invalid ? err.message : `no se pudo guardar: ${err.message}` };
  }
}
