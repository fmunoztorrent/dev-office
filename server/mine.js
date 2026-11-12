// What is yours (⚙ › Mine), not the company's: your private skills and your own tools.
//
//   - Skills: installed in your personal folder of each agent (Claude Code's ~/.claude/skills; the
//     ~/.agents/skills that Pi, OpenCode and Codex read), never in a project: they do not reach a repo,
//     the archive or the briefs. Turning one off (or deleting it) takes it out of there. A skill there that
//     is not the office's (without its mark) is never stepped on.
//   - Tools: small programs of yours (a script in sh, bash, node or python3) for your agents to use: the
//     office's MCP server offers each one as a tool (my_<name>) and runs it where the agent works, with its
//     parameters as arguments ($1, $2… / argv) and as TOOL_<NAME> variables. The agent runs it, not the office.
//
// Both travel in your settings file (server/settings-io.js). Agents cannot write them (no MCP tool saves
// one): what runs for every session of yours is only yours to define.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILL_MARK = 'dev-team-office · mine';
const OUTPUT_MAX = 20_000;

/** Where your agents read your personal skills (only those of the agents on this machine). */
export function personalSkillDirs(home = os.homedir()) {
  const has = (...p) => fs.existsSync(path.join(home, ...p));
  return [
    has('.claude') ? { agents: ['claude-code'], dir: path.join(home, '.claude', 'skills') } : null,
    has('.pi') || has('.config', 'opencode') || has('.codex') || has('.agents') ? { agents: ['pi', 'opencode', 'codex'], dir: path.join(home, '.agents', 'skills') } : null,
  ].filter(Boolean);
}

/** A private skill's SKILL.md: its name and description, the office's mark and its instructions. */
export function mineSkillFile(entry) {
  return `---\nname: ${entry.name}\ndescription: ${JSON.stringify(entry.title)}\n---\n\n<!-- ${SKILL_MARK}: ${entry.name} -->\n\n${String(entry.body || '').trim()}\n`;
}

const ours = (file) => { try { return fs.readFileSync(file, 'utf8').includes(SKILL_MARK); } catch { return false; } };

/** Puts a skill in your personal folders: [{ dir, agents, ok, action | reason, file }]. */
export function installMine(entry, home = os.homedir()) {
  return personalSkillDirs(home).map(({ dir, agents }) => {
    const file = path.join(dir, entry.name, 'SKILL.md');
    const text = mineSkillFile(entry);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cur === text) return { dir, agents, ok: true, action: 'same', file };
    if (cur !== null && !cur.includes(SKILL_MARK)) return { dir, agents, ok: false, reason: 'exists', file }; // yours, but not the office's
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    } catch (err) { return { dir, agents, ok: false, reason: 'error', error: err.message, file }; }
    return { dir, agents, ok: true, action: cur === null ? 'created' : 'updated', file };
  });
}

/** Takes a skill out of your personal folders (only what the office put there). */
export function uninstallMine(name, home = os.homedir()) {
  const out = [];
  for (const { dir } of personalSkillDirs(home)) {
    const folder = path.join(dir, name);
    const file = path.join(folder, 'SKILL.md');
    if (!ours(file)) continue;
    fs.rmSync(file, { force: true });
    try { if (!fs.readdirSync(folder).length) fs.rmdirSync(folder); } catch { /* not empty, or gone */ }
    out.push(file);
  }
  return out;
}

/** The MCP tool that offers one of your tools: my_<name>, with its parameters (all text). */
export function toolSpec(entry) {
  const params = entry.config?.params || [];
  return {
    name: `my_${entry.name.replace(/-/g, '_')}`,
    title: entry.name,
    description: `${entry.title} — the user's own tool (defined in Dev Team Office › Mine; ${entry.config?.run || 'sh'}). It runs in your working folder.`,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(params.map((p) => [p.name, { type: 'string', ...(p.description ? { description: p.description } : {}) }])),
      ...(params.some((p) => p.required) ? { required: params.filter((p) => p.required).map((p) => p.name) } : {}),
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  };
}

/** The tool whose MCP name (my_<name>) or own name is that one. */
export const toolNamed = (tools, name) => {
  const key = String(name || '').replace(/^my_/, '').replace(/_/g, '-').toLowerCase();
  return tools.find((x) => x.name === key) || null;
};

const INTERPRETER = {
  sh: (script, args) => ['/bin/sh', ['-c', script, 'tool', ...args]],
  bash: (script, args) => ['bash', ['-c', script, 'tool', ...args]],
  node: (script, args) => [process.execPath, ['-e', script, ...args]],
  python3: (script, args) => ['python3', ['-c', script, ...args]],
};

/**
 * Runs one of your tools: its script with its runtime, in `cwd`, with the parameters in order as arguments
 * and as TOOL_<NAME> variables, until it ends or its time runs out. Returns { code, output, timedOut }.
 */
export function runTool(entry, args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const c = entry.config || {};
  const params = c.params || [];
  const missing = params.filter((p) => p.required && (args[p.name] === undefined || args[p.name] === null || args[p.name] === ''));
  // (said in English: the agent reads it)
  if (missing.length) return Promise.resolve({ code: null, output: `missing parameters: ${missing.map((p) => p.name).join(', ')}`, timedOut: false, invalid: true });
  const values = params.map((p) => (args[p.name] === undefined || args[p.name] === null ? '' : String(args[p.name])));
  const vars = Object.fromEntries(params.map((p, i) => [`TOOL_${p.name.toUpperCase()}`, values[i]]));
  const [exe, argv] = (INTERPRETER[c.run] || INTERPRETER.sh)(entry.body, values);
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let child;
    const add = (d) => { output += d; if (output.length > OUTPUT_MAX * 2) output = output.slice(-OUTPUT_MAX); };
    try {
      child = spawn(exe, argv, { cwd, env: { ...env, ...vars, DEV_TEAM_OFFICE_TOOL: entry.name }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (err) { resolve({ code: null, output: err.message, timedOut: false }); return; }
    const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, (c.timeout || 60) * 1000);
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, output: `${output}${err.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output: output.length > OUTPUT_MAX ? `…${output.slice(-OUTPUT_MAX)}` : output, timedOut }); });
  });
}

/** Yours: saving a skill installs it in your personal folders, turning it off or deleting it takes it out. */
export class Mine {
  constructor({ store, home = os.homedir() }) {
    this.store = store;
    this.home = home;
  }

  list() { return { skills: this.store.listMine('skill'), tools: this.store.listMine('tool'), dirs: personalSkillDirs(this.home) }; }

  /** Saves one (by its id, or by its kind and name): a skill goes to your folders (or out, off). */
  save(input = {}) {
    const out = this.store.saveMine(input);
    if (!out.ok) return out;
    const e = out.entry;
    let installed = [];
    if (e.kind === 'skill') {
      if (out.was && out.was.name !== e.name) uninstallMine(out.was.name, this.home);
      if (e.enabled) installed = installMine(e, this.home);
      else uninstallMine(e.name, this.home);
    }
    return { ...out, installed };
  }

  remove(id) {
    const out = this.store.deleteMine(id);
    if (out.ok && out.entry.kind === 'skill') uninstallMine(out.entry.name, this.home);
    return out;
  }
}
