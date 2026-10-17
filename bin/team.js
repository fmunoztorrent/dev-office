// `dev-team-office team install <team> <harness> [project]`: instala un *team pack* (los agentes
// de un equipo del dominio) en el directorio de agentes de un harness. La raíz del repo se deriva
// de este archivo, no de process.cwd(), para que funcione desde cualquier directorio.
//
// Un team pack vive en teams/<team>/: team.json (descriptor: name, description, roles) y
// agents/*.md (un archivo de agente por rol). El renderer de cada harness decide CÓMO se escriben
// esos archivos; hoy sólo Pi está implementado (escribe verbatim, sin tocar el frontmatter).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESSES, harnessId } from '../integrations/common/devteam.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAMS = path.join(ROOT, 'teams');

// Renderers por harness. `pi` es el único implementado a propósito: claude-code y opencode quedan
// ausentes hasta que exista su formato de agente, y por eso `installTeam` los reporta como
// "not supported yet" en vez de escribir algo incorrecto.
export const RENDERERS = {
  pi: ({ file, content, dir }) => {
    fs.mkdirSync(dir, { recursive: true });
    const to = path.join(dir, file);
    fs.writeFileSync(to, content);
    return to;
  },
};

/**
 * Lista los team packs disponibles. Un team.json ausente o roto se saltea sin romper.
 * `from` permite listar desde una raíz EXTERNA; sin él se usa el `teams/` empotrado.
 */
export function listTeams(from) {
  const root = from ? path.resolve(from) : TEAMS;
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const teams = [];
  for (const dir of entries) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(root, dir, 'team.json'), 'utf8'));
      teams.push({ name: json.name, description: json.description, roles: json.roles });
    } catch {
      // team.json ausente, ilegible o malformado: se saltea.
    }
  }
  return teams;
}

/**
 * Instala un team pack. Devuelve { ok: true, lines } o { ok: false, error }.
 * `project` truthy → scope 'project', si no → scope 'user'.
 * `from` permite instalar desde una raíz EXTERNA; sin él se usa el `teams/` empotrado.
 */
export function installTeam({ team, harness, project, from } = {}) {
  const id = harnessId(harness);
  if (!id) return { ok: false, error: 'unknown harness' };
  if (!RENDERERS[id]) return { ok: false, error: 'not supported yet' };

  // dirs() evalúa os.homedir() recién acá (lazy). Pasamos una cadena para no romper path.join.
  const dirs = HARNESSES[id].dirs(project || '');
  const dir = dirs[project ? 0 : 1][0];

  const root = from ? path.resolve(from) : TEAMS;
  const teamDir = path.join(root, team);
  if (!fs.existsSync(path.join(teamDir, 'team.json'))) return { ok: false, error: 'unknown team' };

  const agentsDir = path.join(teamDir, 'agents');
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const lines = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const to = RENDERERS[id]({ file, content, dir });
    lines.push(`${file} -> ${to}`);
  }
  return { ok: true, lines };
}
