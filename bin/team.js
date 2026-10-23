// `dev-team-office team install <team> --agent <cli> [--project <path>]`: installs a *team pack* (a
// team's agents) into a harness's agents folder. The repo root is derived from this file, not from
// process.cwd(), so it works from any directory.
//
// A team pack lives in teams/<team>/: team.json (descriptor: name, description, roles) and
// agents/*.md (one agent per role, in Pi's format: frontmatter with name, role, description,
// thinking, tools + the system prompt). Each harness's renderer translates it to its format:
//   - Pi: as is;
//   - Claude Code: .claude/agents/<name>.md with its tools (Read, Grep, Glob…) and `effort`;
//   - OpenCode: .opencode/agents/<name>.md with `mode: subagent` and `permission` (the read-only part);
//   - Codex: .codex/agents/<name>.toml with `developer_instructions` and the role in a comment.
// All of them keep the `role:` the office reads to know which character each subagent is.
//
// provisionTeam() is what `join` uses: it leaves in the project the office team's subagents whose
// roles the agent does not have (all of them, if it brings none).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESSES, harnessId, parseAgentFile, detectHarness } from '../integrations/common/devteam.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAMS = path.join(ROOT, 'teams');
/** The team the office gives an agent that does not bring its own. */
export const DEFAULT_PACK = 'example';

// Pi's tools → Claude Code's
const CLAUDE_TOOLS = { read: 'Read', write: 'Write', edit: 'Edit', bash: 'Bash', grep: 'Grep', find: 'Glob', ls: 'Glob' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
// YAML: a double-quoted string (JSON is one); so a `:` in the description does not break the frontmatter
const yamlStr = (s) => JSON.stringify(String(s ?? ''));
const tomlStr = (s) => JSON.stringify(String(s ?? ''));
// multi-line TOML: literal ('''…''', no escapes) unless the text contains '''
const tomlBlock = (s) => (s.includes("'''") ? `"""\n${s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}\n"""` : `'''\n${s}\n'''`);

const frontmatter = (fields) => `---\n${fields.filter(Boolean).join('\n')}\n---\n`;

/**
 * A renderer receives the pack's agent already parsed (`parseAgentFile`, with its `meta`) and its text,
 * and returns { file, text }: the file name in the harness's folder and its content.
 */
export const RENDERERS = {
  pi: ({ file, content }) => ({ file, text: content }),

  'claude-code': ({ agent }) => {
    const tools = agent.tools ? [...new Set(agent.tools.map((x) => CLAUDE_TOOLS[String(x).toLowerCase()]).filter(Boolean))] : null;
    const effort = EFFORTS.includes(agent.meta?.thinking) ? agent.meta.thinking : null;
    return {
      file: `${agent.name}.md`,
      text: `${frontmatter([
        `name: ${agent.name}`,
        `description: ${yamlStr(agent.description)}`,
        agent.role && `role: ${agent.role}`,
        tools?.length && `tools: ${tools.join(', ')}`,
        agent.model && `model: ${agent.model}`,
        effort && `effort: ${effort}`,
      ])}\n${agent.prompt}\n`,
    };
  },

  opencode: ({ agent }) => {
    const has = (t) => !agent.tools || agent.tools.map((x) => String(x).toLowerCase()).includes(t);
    const deny = [!has('write') && !has('edit') && '  edit: deny', !has('bash') && '  bash: deny'].filter(Boolean);
    return {
      // in OpenCode the agent's name is the file's name
      file: `${agent.name}.md`,
      text: `${frontmatter([
        `description: ${yamlStr(agent.description)}`,
        'mode: subagent',
        agent.role && `role: ${agent.role}`,
        agent.model?.includes('/') && `model: ${agent.model}`,
        deny.length && `permission:\n${deny.join('\n')}`,
      ])}\n${agent.prompt}\n`,
    };
  },

  codex: ({ agent }) => {
    const effort = EFFORTS.includes(agent.meta?.thinking) ? agent.meta.thinking : null;
    return {
      file: `${agent.name}.toml`,
      text: [
        // the role goes as a comment: Codex does not know it and the office reads it anyway (parseAgentToml)
        agent.role && `# dev-team-office role: ${agent.role}`,
        `name = ${tomlStr(agent.name)}`,
        `description = ${tomlStr(agent.description)}`,
        agent.model && `model = ${tomlStr(agent.model)}`,
        effort && `model_reasoning_effort = ${tomlStr(effort)}`,
        `developer_instructions = ${tomlBlock(agent.prompt)}`,
      ].filter(Boolean).join('\n') + '\n',
    };
  },
};

const readTeam = (root, team) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, team, 'team.json'), 'utf8')); } catch { return null; }
};

/**
 * Lists the available team packs. A missing or broken team.json is skipped without breaking.
 * `from` lists from an EXTERNAL root; without it the bundled `teams/` is used.
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
    const json = readTeam(root, dir);
    if (json) teams.push({ id: dir, name: json.name, description: json.description, roles: json.roles });
  }
  return teams;
}

/**
 * Installs a team pack. Returns { ok: true, lines, dir, files, kept, agents } or { ok: false, error }.
 * `project` truthy → 'project' scope, otherwise → 'user' scope.
 * `from` installs from an EXTERNAL root; without it the bundled `teams/` is used.
 * With `overwrite: false` it does not overwrite an existing file with other content (it goes in `kept`).
 * With `roles`, only the pack's agents that declare one of those roles.
 */
export function installTeam({ team, harness, project, from, overwrite = true, roles } = {}) {
  const id = harnessId(harness);
  if (!id) return { ok: false, error: 'unknown harness' };
  if (!RENDERERS[id]) return { ok: false, error: 'not supported yet' };

  // dirs() evaluates os.homedir() only here (lazy). We pass a string so path.join does not break.
  const dirs = HARNESSES[id].dirs(project || '');
  const dir = dirs.find(([, scope]) => scope === (project ? 'project' : 'user'))[0];

  const root = from ? path.resolve(from) : TEAMS;
  const teamDir = path.join(root, team);
  if (!fs.existsSync(path.join(teamDir, 'team.json'))) return { ok: false, error: 'unknown team' };

  const agentsDir = path.join(teamDir, 'agents');
  const sources = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
  const lines = [];
  const files = [];
  const kept = [];
  const agents = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const file of sources) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const agent = parseAgentFile(content, file);
    if (roles && !roles.includes(agent.role)) continue;
    const out = RENDERERS[id]({ file, content, agent });
    const to = path.join(dir, out.file);
    let before = null;
    try { before = fs.readFileSync(to, 'utf8'); } catch { /* no estaba */ }
    if (!overwrite && before !== null && before !== out.text) {
      kept.push(to);
      lines.push(`${file} -> ${to} (already there: kept)`);
      continue;
    }
    fs.writeFileSync(to, out.text);
    files.push(to);
    agents.push({ name: agent.name, role: agent.role });
    lines.push(`${file} -> ${to}`);
  }
  return { ok: true, lines, dir, files, kept, agents };
}

/**
 * Completes an agent's team with the office's: the pack roles that no subagent of that harness
 * covers (neither in `dir`, its project, nor in its user folder) are installed in the project.
 * If it brings none, it gets the whole pack.
 * Returns { installed: true, team, dir, files, agents, whole, fresh } (whole: it had none;
 * fresh: the agents folder did not exist) or { installed: false, reason, have? } with reason
 * 'has-team' (it already covers every role of the pack) | 'unknown harness' | the pack's error.
 */
export function provisionTeam({ dir, harness, team = DEFAULT_PACK, from } = {}) {
  const id = harnessId(harness);
  if (!id) return { installed: false, reason: 'unknown harness' };
  const root = from ? path.resolve(from) : TEAMS;
  const pack = readTeam(root, team);
  if (!pack) return { installed: false, reason: 'unknown team' };
  const have = detectHarness(dir).subagents.filter((x) => x.harness === id && x.role);
  const covered = new Set(have.map((x) => x.role));
  const missing = Object.keys(pack.roles || {}).filter((r) => !covered.has(r));
  if (!missing.length) return { installed: false, reason: 'has-team', have: have.length };
  const [agentsDir] = HARNESSES[id].dirs(dir).find(([, scope]) => scope === 'project');
  const fresh = !fs.existsSync(agentsDir);
  const out = installTeam({ team, harness: id, project: dir, from, overwrite: false, roles: missing });
  if (!out.ok) return { installed: false, reason: out.error };
  // the missing ones were already there under that name (with other content): they are not overwritten
  if (!out.files.length) return { installed: false, reason: 'kept', kept: out.kept };
  return { installed: true, team: pack.name || team, dir: out.dir, files: out.files, kept: out.kept, agents: out.agents, whole: !have.length, fresh };
}
