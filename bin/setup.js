// `dev-team-office setup`: gets everything ready in one go, with no manual steps. It detects which agents
// are on the machine (Pi, Claude Code, OpenCode, Codex, Gemini, Cursor) and gives each one:
//   - its integration (extension, plugin or hook) so the office sees what it does, live;
//   - the office's MCP server (register projects, report phases, send tasks…);
//   - the skills (how to work with the office and how to declare the roles of its subagents).
// Plus a stable launcher (~/.dev-team-office/bin/dev-team-office) that the hooks and the MCP point to.
//
// It is idempotent (running it again updates), backs up every config file it touches
// (<file>.dev-team-office.bak), and `uninstall` undoes exactly what it did. `doctor` checks it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t } from '../public/i18n.js';
import { which, piAgentDir } from '../integrations/common/devteam.mjs';
import { install, claudeHooks } from './install.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MARK = 'dev-team-office';
// what the agent reads from the server before connecting (Pi puts it in its system prompt)
const MCP_DESCRIPTION = 'Dev Team Office: register projects, report which role and phase of the team you are in, send tasks to other agents';
const SKILLS = ['dev-team-office', 'dev-team-office-config'];
const APP_FILES = ['bin', 'server', 'tui', 'public', 'integrations', 'skills', 'teams', 'docs', 'package.json', 'README.md', 'install.sh', '.claude-plugin'];

// Everything is computed when called (not on import): the tests change $HOME.
const home = () => os.homedir();
const piDir = () => piAgentDir();
const officeDir = () => path.join(home(), '.dev-team-office');
const tilde = (p) => (p && p.startsWith(home()) ? `~${p.slice(home().length)}` : p);
const exists = (p) => fs.existsSync(p);
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------- config files

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }

/** JSON with comments and trailing commas (JSONC): for reading, never for writing. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let str = false;
  while (i < text.length) {
    const c = text[i];
    if (str) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function backup(file) {
  if (exists(file)) fs.copyFileSync(file, `${file}.${MARK}.bak`);
}

/** Writes without leaving a half-written file (and backs up the previous one). */
function writeFile(file, text, { dry, mode } = {}) {
  if (dry) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

/** Reads a JSON config: {} if it does not exist; an error if it exists and is broken (it is not overwritten). */
function readJson(file) {
  const text = readText(file);
  if (text === null || !text.trim()) return { data: {} };
  try { return { data: parseJsonc(text), text }; } catch (err) { return { error: t('setup.badJson', { file: tilde(file), error: err.message }) }; }
}

const writeJson = (file, data, opts) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`, opts);

// ---------------------------------------------------------------- hooks (Claude Code and Codex)

const isOurHook = (h) => typeof h?.command === 'string' && /dev-team-office/.test(h.command) && /hook/.test(h.command);

/** Removes our hooks from a `hooks` object (the others stay as they were). */
function withoutOurHooks(hooks = {}) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = groups.map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurHook(h)) } : g)).filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}

const hasOurHooks = (hooks = {}) => Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((g) => g?.hooks?.some?.(isOurHook)));

const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'PreCompact', 'Stop', 'Interrupt', 'SessionEnd'];

function codexHooks(command) {
  const out = {};
  for (const event of CODEX_EVENTS) out[event] = [{ hooks: [{ type: 'command', command, timeout: 10 }] }];
  return out;
}

function mergeHooks(file, fresh, ctx) {
  const { data, error } = readJson(file);
  if (error) return { ok: false, line: error };
  const hooks = withoutOurHooks(data.hooks);
  for (const [event, groups] of Object.entries(fresh)) hooks[event] = [...(hooks[event] || []), ...groups];
  writeJson(file, { ...data, hooks }, ctx);
  return { ok: true };
}

function unmergeHooks(file, ctx) {
  const { data, error } = readJson(file);
  if (error || !data.hooks || !hasOurHooks(data.hooks)) return false;
  const hooks = withoutOurHooks(data.hooks);
  const next = { ...data };
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  writeJson(file, next, ctx);
  return true;
}

const hooksIn = (file) => { const { data } = readJson(file); return !!data && hasOurHooks(data.hooks); };

// ---------------------------------------------------------------- MCP in each client

/** `mcpServers` in a JSON file (Claude Code ~/.claude.json, Gemini, Cursor). */
function jsonMcp(file, entry) {
  return {
    apply(ctx) {
      const { data, error } = readJson(file);
      if (error) return { ok: false, line: error };
      writeJson(file, { ...data, mcpServers: { ...(data.mcpServers || {}), [MARK]: entry(ctx) } }, ctx);
      return { ok: true };
    },
    remove(ctx) {
      const { data, error } = readJson(file);
      if (error || !data.mcpServers?.[MARK]) return false;
      const { [MARK]: _, ...rest } = data.mcpServers;
      writeJson(file, { ...data, mcpServers: rest }, ctx);
      return true;
    },
    check: () => !!readJson(file).data?.mcpServers?.[MARK],
  };
}

/** A [mcp_servers.dev-team-office] table in Codex's config.toml (the rest of the file untouched). */
const TOML_HEAD = `[mcp_servers.${MARK}]`;
function withoutTomlTable(text) {
  const lines = text.split('\n');
  const out = [];
  let skip = false;
  for (const line of lines) {
    const head = line.trim().match(/^\[([^\]]+)\]/);
    if (head) skip = head[1] === `mcp_servers.${MARK}` || head[1].startsWith(`mcp_servers.${MARK}.`);
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
const tomlStr = (s) => JSON.stringify(String(s));
function codexMcp(file) {
  return {
    apply(ctx) {
      const text = readText(file) || '';
      const table = `${TOML_HEAD}\ncommand = ${tomlStr(ctx.shim)}\nargs = ["mcp"]\nstartup_timeout_sec = 20\n`;
      const base = withoutTomlTable(text).trimEnd();
      writeFile(file, `${base ? `${base}\n\n` : ''}${table}`, ctx);
      return { ok: true };
    },
    remove(ctx) {
      const text = readText(file);
      if (!text || !text.includes(TOML_HEAD)) return false;
      writeFile(file, `${withoutTomlTable(text).trimEnd()}\n`, ctx);
      return true;
    },
    check: () => (readText(file) || '').includes(TOML_HEAD),
  };
}

/** OpenCode: `mcp` in opencode.json(c). A .jsonc with comments is edited as text, without losing them. */
function opencodeFile() {
  const dir = path.join(home(), '.config', 'opencode');
  const json = path.join(dir, 'opencode.json');
  const jsonc = path.join(dir, 'opencode.jsonc');
  return exists(json) || !exists(jsonc) ? json : jsonc;
}
const opencodeEntry = (ctx) => ({ type: 'local', command: [ctx.shim, 'mcp'], enabled: true });
function opencodeMcp() {
  return {
    apply(ctx) {
      const file = opencodeFile();
      const text = readText(file);
      if (text === null || !text.trim()) {
        writeJson(file, { $schema: 'https://opencode.ai/config.json', mcp: { [MARK]: opencodeEntry(ctx) } }, ctx);
        return { ok: true };
      }
      let data;
      try { data = parseJsonc(text); } catch (err) { return { ok: false, line: t('setup.badJson', { file: tilde(file), error: err.message }) }; }
      if (!/\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
        writeJson(file, { ...data, mcp: { ...(data.mcp || {}), [MARK]: opencodeEntry(ctx) } }, ctx);
        return { ok: true };
      }
      // with comments: only our entry is inserted (or replaced)
      const entry = JSON.stringify(opencodeEntry(ctx));
      let next = removeJsoncEntry(text);
      const parsed = parseJsonc(next);
      if (!parsed.mcp) next = next.replace(/\{/, `{\n  "mcp": { "${MARK}": ${entry} },`);
      else {
        const m = next.match(/"mcp"\s*:\s*\{/);
        if (!m) return { ok: false, line: t('setup.manualMcp', { file: tilde(file) }) };
        const empty = !Object.keys(parsed.mcp).length;
        const at = m.index + m[0].length;
        next = `${next.slice(0, at)}\n    "${MARK}": ${entry}${empty ? '' : ','}${next.slice(at)}`;
      }
      try { if (!parseJsonc(next).mcp?.[MARK]) throw new Error('?'); } catch { return { ok: false, line: t('setup.manualMcp', { file: tilde(file) }) }; }
      writeFile(file, next, ctx);
      return { ok: true };
    },
    remove(ctx) {
      const file = opencodeFile();
      const text = readText(file);
      if (!text) return false;
      let data;
      try { data = parseJsonc(text); } catch { return false; }
      if (!data.mcp?.[MARK]) return false;
      writeFile(file, removeJsoncEntry(text), ctx);
      return true;
    },
    check: () => { try { return !!parseJsonc(readText(opencodeFile()) || '{}').mcp?.[MARK]; } catch { return false; } },
  };
}
function removeJsoncEntry(text) {
  return text
    .replace(new RegExp(`\\s*"${MARK}"\\s*:\\s*\\{[^{}]*\\}\\s*,`), '')
    .replace(new RegExp(`,?\\s*"${MARK}"\\s*:\\s*\\{[^{}]*\\}`), '');
}

// ---------------------------------------------------------------- skills and files

function copyDir(from, to, ctx) {
  if (ctx.dry) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f);
    if (fs.statSync(src).isDirectory()) copyDir(src, path.join(to, f), ctx);
    else fs.copyFileSync(src, path.join(to, f));
  }
}

function skillsAt(dir) {
  return {
    apply(ctx) { for (const s of SKILLS) copyDir(path.join(ROOT, 'skills', s), path.join(dir, s), ctx); return { ok: true }; },
    remove(ctx) {
      let any = false;
      for (const s of SKILLS) if (exists(path.join(dir, s, 'SKILL.md'))) { any = true; if (!ctx.dry) fs.rmSync(path.join(dir, s), { recursive: true, force: true }); }
      return any;
    },
    check: () => SKILLS.every((s) => exists(path.join(dir, s, 'SKILL.md'))),
  };
}

function fileStep(file) {
  return {
    remove(ctx) { if (!exists(file)) return false; if (!ctx.dry) fs.rmSync(file, { force: true }); return true; },
    check: () => exists(file),
  };
}

// ---------------------------------------------------------------- the agents

/** Is Dev Team Office installed as a Claude Code plugin? (then it brings hooks, MCP and skills) */
export function claudePluginInstalled() {
  const data = readJson(path.join(home(), '.claude', 'plugins', 'installed_plugins.json')).data || {};
  return JSON.stringify(data.plugins || data).includes(`"${MARK}@`);
}

/** How to register the MCP in Claude Code: with its CLI if available (the official way), otherwise in ~/.claude.json. */
function claudeMcp() {
  const file = path.join(home(), '.claude.json');
  const viaFile = jsonMcp(file, (ctx) => ({ type: 'stdio', command: ctx.shim, args: ['mcp'], env: {} }));
  return {
    apply(ctx) {
      const bin = ctx.cli && which('claude');
      if (!bin) return viaFile.apply(ctx);
      if (ctx.dry) return { ok: true };
      try { ctx.run(bin, ['mcp', 'remove', '--scope', 'user', MARK]); } catch { /* no estaba */ }
      try {
        ctx.run(bin, ['mcp', 'add-json', '--scope', 'user', MARK, JSON.stringify({ type: 'stdio', command: ctx.shim, args: ['mcp'] })]);
        return { ok: true };
      } catch { return viaFile.apply(ctx); }
    },
    remove(ctx) {
      const bin = ctx.cli && which('claude');
      if (bin && !ctx.dry && viaFile.check()) { try { ctx.run(bin, ['mcp', 'remove', '--scope', 'user', MARK]); return true; } catch { /* a mano */ } }
      return viaFile.remove(ctx);
    },
    check: viaFile.check,
  };
}

export const AGENTS = {
  pi: {
    label: 'Pi',
    found: () => !!which('pi') || exists(path.join(home(), '.pi')),
    files: ['pi'],
    steps: () => ({
      integration: fileStep(path.join(piDir(), 'extensions', 'dev-team-office.ts')),
      // Pi's own MCP (1.x) and pi-mcp-adapter read the same file
      mcp: jsonMcp(path.join(piDir(), 'mcp.json'), (ctx) => ({ command: ctx.shim, args: ['mcp'], description: MCP_DESCRIPTION })),
      skills: skillsAt(path.join(home(), '.agents', 'skills')),
    }),
    notes: () => [t('setup.piMcp')],
  },
  'claude-code': {
    label: 'Claude Code',
    found: () => !!which('claude') || exists(path.join(home(), '.claude')),
    files: ['claude'],
    plugin: claudePluginInstalled,
    steps: () => {
      const settings = path.join(home(), '.claude', 'settings.json');
      return {
        integration: fileStep(path.join(officeDir(), 'claude-code', 'hook.mjs')),
        hooks: {
          apply: (ctx) => mergeHooks(settings, claudeHooks(`${sq(ctx.shim)} hook claude-code`), ctx),
          remove: (ctx) => unmergeHooks(settings, ctx),
          check: () => hooksIn(settings),
        },
        mcp: claudeMcp(),
        skills: skillsAt(path.join(home(), '.claude', 'skills')),
      };
    },
  },
  opencode: {
    label: 'OpenCode',
    found: () => !!which('opencode') || exists(path.join(home(), '.config', 'opencode')),
    files: ['opencode'],
    steps: () => ({
      integration: { remove: (ctx) => ['plugin', 'plugins'].some((d) => fileStep(path.join(home(), '.config', 'opencode', d, 'dev-team-office.js')).remove(ctx)), check: () => ['plugin', 'plugins'].some((d) => exists(path.join(home(), '.config', 'opencode', d, 'dev-team-office.js'))) },
      mcp: opencodeMcp(),
      skills: skillsAt(path.join(home(), '.agents', 'skills')),
    }),
  },
  codex: {
    label: 'Codex',
    found: () => !!which('codex') || exists(path.join(home(), '.codex')),
    files: ['codex'],
    steps: () => {
      const hooks = path.join(home(), '.codex', 'hooks.json');
      return {
        integration: fileStep(path.join(officeDir(), 'codex', 'hook.mjs')),
        hooks: {
          apply: (ctx) => mergeHooks(hooks, codexHooks(`${sq(ctx.shim)} hook codex`), ctx),
          remove: (ctx) => unmergeHooks(hooks, ctx),
          check: () => hooksIn(hooks),
        },
        mcp: codexMcp(path.join(home(), '.codex', 'config.toml')),
        skills: skillsAt(path.join(home(), '.agents', 'skills')),
      };
    },
    notes: () => [t('setup.codexTrust')],
  },
  gemini: {
    label: 'Gemini CLI',
    found: () => !!which('gemini') || exists(path.join(home(), '.gemini')),
    files: [],
    steps: () => ({ mcp: jsonMcp(path.join(home(), '.gemini', 'settings.json'), (ctx) => ({ command: ctx.shim, args: ['mcp'] })) }),
  },
  cursor: {
    label: 'Cursor',
    found: () => exists(path.join(home(), '.cursor')),
    files: [],
    steps: () => ({ mcp: jsonMcp(path.join(home(), '.cursor', 'mcp.json'), (ctx) => ({ command: ctx.shim, args: ['mcp'] })) }),
  },
};
const ALIASES = { claude: 'claude-code', open: 'opencode', 'gemini-cli': 'gemini' };
export const agentId = (n) => (AGENTS[n] ? n : ALIASES[n] || null);

// ---------------------------------------------------------------- the launcher

/** Is it running from a transient copy (npx, a temp folder)? Then a stable copy is installed. */
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
export const ephemeral = (root = ROOT) => /[\\/]_npx[\\/]/.test(root) || real(root).startsWith(`${real(os.tmpdir())}${path.sep}`);

export const shimPath = () => path.join(officeDir(), 'bin', 'dev-team-office');

function shimText(root) {
  return `#!/bin/sh
# Dev Team Office — escrito por \`dev-team-office setup\` (lo usan los hooks y el MCP de tus agentes).
NODE=${sq(process.execPath)}
[ -x "$NODE" ] || NODE=$(command -v node)
if [ "$1" = hook ]; then
  # un hook nunca rompe al agente: sin Node, no hace nada
  [ -n "$NODE" ] || exit 0
  exec "$NODE" ${sq(officeDir())}/"$2"/hook.mjs
fi
[ -n "$NODE" ] || { echo "dev-team-office: Node.js >= 22.13 is required (https://nodejs.org)" >&2; exit 1; }
exec "$NODE" ${sq(path.join(root, 'bin', 'dev-team-office.js'))} "$@"
`;
}

/** Copies the app to ~/.dev-team-office/app (when running from npx or a temp folder). */
function installApp(ctx) {
  const to = path.join(officeDir(), 'app');
  if (path.resolve(ROOT) === path.resolve(to)) return to;
  if (!ctx.dry) {
    fs.rmSync(to, { recursive: true, force: true });
    for (const f of APP_FILES) {
      const src = path.join(ROOT, f);
      if (!exists(src)) continue;
      if (fs.statSync(src).isDirectory()) copyDir(src, path.join(to, f), ctx);
      else { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(src, path.join(to, f)); }
    }
  }
  return to;
}

/** The stable launcher and, if `dev-team-office` is not on the PATH, a link in ~/.local/bin. */
function ensureLauncher(ctx) {
  const lines = [];
  const root = ephemeral() ? installApp(ctx) : ROOT;
  if (root !== ROOT) lines.push(t('setup.appCopied', { path: tilde(root) }));
  const shim = shimPath();
  writeFile(shim, shimText(root), { dry: ctx.dry, mode: 0o755 });
  if (!ctx.dry) fs.chmodSync(shim, 0o755);
  lines.push(t('setup.launcher', { path: tilde(shim) }));
  // the one on the PATH, not counting npx's transient one (the one running now)
  const onPath = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'dev-team-office')).find((f) => !ephemeral(f) && (() => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } })());
  const binDir = process.env.DEV_TEAM_OFFICE_BIN_DIR || path.join(home(), '.local', 'bin');
  const link = path.join(binDir, 'dev-team-office');
  // the command in ~/.local/bin: if there is no other one on the PATH, or if the one there is ours (it is renewed)
  const ours = !onPath || real(onPath) === real(shim) || path.resolve(onPath) === path.resolve(link) || !!process.env.DEV_TEAM_OFFICE_BIN_DIR;
  if (!ours) lines.push(t('setup.otherOnPath', { path: tilde(onPath) }));
  else {
    if (!ctx.dry) {
      fs.mkdirSync(binDir, { recursive: true });
      try { fs.rmSync(link, { force: true }); fs.symlinkSync(shim, link); } catch { fs.copyFileSync(shim, link); }
    }
    const inPath = (process.env.PATH || '').split(path.delimiter).includes(binDir);
    lines.push(t(inPath ? 'setup.linked' : 'setup.linkedNotInPath', { path: tilde(link), dir: binDir.startsWith(home()) ? `$HOME${binDir.slice(home().length)}` : binDir }));
  }
  return { shim, root, lines };
}

// ---------------------------------------------------------------- setup · uninstall · doctor

const runCli = (bin, argv) => execFileSync(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });

/** The agents on the machine (or the ones requested with `only`). */
export function detect(only) {
  const ids = only?.length ? only.map(agentId) : Object.keys(AGENTS);
  return ids.filter(Boolean).map((id) => ({ id, label: AGENTS[id].label, found: !!only?.length || AGENTS[id].found() }));
}

/**
 * Installs and connects. opts: { only: ['claude', 'codex'…], dry, cli (use `claude mcp`, yes by default), run }
 * Returns { ok, lines, agents: [{ id, label, done: [...], failed: [...] }] }
 */
export function setup({ only = [], dry = false, cli = process.env.DEV_TEAM_OFFICE_SETUP_CLI !== '0', run = runCli } = {}) {
  const unknown = only.filter((n) => !agentId(n));
  if (unknown.length) return { ok: false, error: t('setup.unknown', { names: unknown.join(', '), known: Object.keys(AGENTS).join(', ') }) };
  const found = detect(only).filter((a) => a.found);
  const lines = [];
  const launcher = ensureLauncher({ dry });
  lines.push(...launcher.lines);
  const ctx = { dry, cli, run, shim: launcher.shim, root: launcher.root };

  // each integration's files (extension, plugin, hook) + the shared library + the shared skills
  const files = [...new Set(found.filter((a) => !AGENTS[a.id].plugin?.()).flatMap((a) => AGENTS[a.id].files))];
  if (!dry) {
    const out = install(files, { all: false });
    if (out.ok) lines.push(...out.lines);
  }

  const report = [];
  for (const a of found) {
    const def = AGENTS[a.id];
    const done = [];
    const failed = [];
    if (def.plugin?.()) {
      report.push({ ...a, done: ['plugin'], failed, plugin: true });
      lines.push(t('setup.agentLine', { agent: def.label, what: t('setup.viaPlugin') }));
      continue;
    }
    for (const [name, step] of Object.entries(def.steps())) {
      if (!step.apply) { if (step.check()) done.push(name); continue; }
      try {
        const r = step.apply(ctx);
        if (r?.ok === false) { failed.push(name); if (r.line) lines.push(`  ✖ ${r.line}`); } else done.push(name);
      } catch (err) { failed.push(name); lines.push(`  ✖ ${def.label} · ${name}: ${err.message}`); }
    }
    report.push({ ...a, done, failed });
    lines.push(t('setup.agentLine', { agent: def.label, what: done.map((d) => t(`setup.part.${d}`)).join(' · ') || '—' }));
    for (const n of def.notes?.() || []) lines.push(`    ${n}`);
  }
  if (!found.length) lines.push(t('setup.noAgents'));
  return { ok: true, dry, lines, agents: report, shim: launcher.shim, root: launcher.root };
}

/** Undoes setup. With `purge` it also deletes the database (projects, offices, settings). */
export function uninstall({ only = [], dry = false, purge = false, cli = process.env.DEV_TEAM_OFFICE_SETUP_CLI !== '0', run = runCli } = {}) {
  const ctx = { dry, cli, run, shim: shimPath() };
  const ids = only.length ? only.map(agentId).filter(Boolean) : Object.keys(AGENTS);
  const lines = [];
  for (const id of ids) {
    const def = AGENTS[id];
    const removed = [];
    for (const [name, step] of Object.entries(def.steps())) { try { if (step.remove(ctx)) removed.push(name); } catch { /* sigue */ } }
    if (removed.length) lines.push(t('setup.removedLine', { agent: def.label, what: removed.map((d) => t(`setup.part.${d}`)).join(' · ') }));
  }
  if (!only.length) {
    const shared = path.join(home(), '.agents', 'skills');
    for (const s of SKILLS) if (exists(path.join(shared, s))) { if (!dry) fs.rmSync(path.join(shared, s), { recursive: true, force: true }); lines.push(t('setup.removedPath', { path: tilde(path.join(shared, s)) })); }
    const link = path.join(process.env.DEV_TEAM_OFFICE_BIN_DIR || path.join(home(), '.local', 'bin'), 'dev-team-office');
    try { if (fs.readlinkSync(link) === shimPath()) { if (!dry) fs.rmSync(link); lines.push(t('setup.removedPath', { path: tilde(link) })); } } catch { /* not ours */ }
    for (const p of ['bin', 'lib', 'claude-code', 'codex', 'app', ...(purge ? ['office.db', 'office.db-wal', 'office.db-shm', 'office.log', 'claude-runs'] : [])]) {
      const full = path.join(officeDir(), p);
      if (exists(full)) { if (!dry) fs.rmSync(full, { recursive: true, force: true }); lines.push(t('setup.removedPath', { path: tilde(full) })); }
    }
    if (!purge) lines.push(t('setup.keptData', { path: tilde(officeDir()) }));
  }
  if (!lines.length) lines.push(t('setup.nothing'));
  return { ok: true, dry, lines };
}

/** Checks the installation: Node, the launcher, the office and each agent. */
export async function doctor({ base = 'http://127.0.0.1:4317' } = {}) {
  const checks = [];
  const add = (ok, text, fix) => checks.push({ ok, text, ...(fix && !ok ? { fix } : {}) });
  const [maj, min] = process.versions.node.split('.').map(Number);
  add(maj > 22 || (maj === 22 && min >= 13), t('doctor.node', { v: process.versions.node }), t('doctor.nodeFix'));
  add(exists(shimPath()), t('doctor.launcher', { path: tilde(shimPath()) }), 'dev-team-office setup');
  const onPath = which('dev-team-office');
  add(!!onPath, onPath ? t('doctor.onPath', { path: tilde(onPath) }) : t('doctor.notOnPath'), t('doctor.pathFix', { dir: '~/.local/bin' }));
  let health = null;
  try { health = await (await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch { /* apagada */ }
  add(health?.name === MARK, health?.name === MARK ? t('doctor.running', { url: health.url, version: health.version }) : t('doctor.stopped', { url: base }), 'dev-team-office');
  checks[checks.length - 1].optional = true; // stopped is not an error: it opens with `dev-team-office`
  add(!!which('herdr'), which('herdr') ? t('doctor.herdr') : t('doctor.noHerdr'));
  checks[checks.length - 1].optional = true;
  const agents = detect().filter((a) => a.found);
  for (const a of agents) {
    const def = AGENTS[a.id];
    if (def.plugin?.()) { add(true, t('doctor.agent', { agent: def.label, what: t('setup.viaPlugin') })); continue; }
    const parts = Object.entries(def.steps()).map(([name, step]) => [name, step.check()]);
    const missing = parts.filter(([, ok]) => !ok).map(([n]) => t(`setup.part.${n}`));
    add(!missing.length, t('doctor.agent', { agent: def.label, what: parts.map(([n, ok]) => `${ok ? '✓' : '✗'} ${t(`setup.part.${n}`)}`).join('  ') }), `dev-team-office setup --only ${a.id}`);
  }
  if (!agents.length) checks.push({ ok: false, optional: true, text: t('setup.noAgents') });
  return { ok: checks.every((c) => c.ok || c.optional), checks };
}

export const ROOT_DIR = ROOT;
