// Generates public/zones.js from zone.tab (IANA): for each time zone, its country and the coordinates
// of its main city. So the office knows, offline, which country it is in and where.
//   node scripts/gen-zones.mjs [/usr/share/zoneinfo/zone.tab]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2] || '/usr/share/zoneinfo/zone.tab';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'zones.js');
// ±DDMM[SS]±DDDMM[SS] (ISO 6709) → grados
const coord = (s, deg) => {
  const sign = s[0] === '-' ? -1 : 1;
  const d = Number(s.slice(1, 1 + deg)), m = Number(s.slice(1 + deg, 3 + deg)), sec = Number(s.slice(3 + deg) || 0);
  return Math.round(sign * (d + m / 60 + sec / 3600) * 100) / 100;
};
const rows = [];
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cc, at, tz] = line.split('\t');
  const m = /^([+-]\d{4,6})([+-]\d{5,7})$/.exec(at);
  if (!m) continue;
  rows.push(`  '${tz}': ['${cc}', ${coord(m[1], 2)}, ${coord(m[2], 3)}],`);
}
rows.sort();
fs.writeFileSync(out, `// Generado por scripts/gen-zones.mjs desde zone.tab (IANA): zona horaria → [país ISO, lat, lon]
// de su ciudad principal. No editar a mano.
export const ZONES = {
${rows.join('\n')}
};
`);
console.log(`${rows.length} zonas → ${out}`);
