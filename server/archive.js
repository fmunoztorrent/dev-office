// The archive floor: the company's knowledge, shared by every office and every agent.
//
//   - Notes, decisions, docs and minutes: any agent searches and adds to them through the MCP server
//     (search_knowledge, get_knowledge, save_knowledge), and you do it from the game.
//   - Skills: installed in a project in its agent's format (Claude Code's .claude/skills, the shared
//     .agents/skills of Pi, OpenCode and Codex), without stepping on a skill that is not the archive's.
//   - Connectors: MCP servers that bring outside information (an issue tracker, the docs, a
//     database). Installed in the project's MCP config of its agent; each agent asks you to trust them.
//
// The office keeps and hands out what it knows; writing a skill or a connector from a description is
// an agent's job: `generate` sends it the brief and the agent saves the result with save_knowledge.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { t as tr } from '../public/i18n.js';

const SKILL_MARK = 'dev-team-office archive';
const EXCERPT = 240;
/** Where each agent reads a project's skills. */
export const SKILL_DIR = { 'claude-code': '.claude/skills', opencode: '.agents/skills', pi: '.agents/skills', codex: '.agents/skills' };
/** Where each agent reads a project's MCP servers. */
export const MCP_FILE = { 'claude-code': '.mcp.json', pi: '.pi/mcp.json', opencode: 'opencode.json', codex: '.codex/config.toml' };

/** A skill's SKILL.md: its name and description, the archive's mark and its instructions. */
export function skillFile(entry) {
  return `---\nname: ${entry.name}\ndescription: ${JSON.stringify(entry.title)}\n---\n\n<!-- ${SKILL_MARK}: ${entry.name} -->\n\n${String(entry.body || '').trim()}\n`;
}

const readJson = (file) => {
  if (!fs.existsSync(file)) return { data: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? { data, exists: true } : { error: true };
  } catch { return { error: true }; }
};
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Installs a skill in a project: { ok, action: created | updated | same, file } or { ok: false, reason, file }. */
export function installSkill(entry, { dir, harness }) {
  const base = SKILL_DIR[harness];
  if (!base) return { ok: false, reason: 'harness' };
  const file = path.join(dir, base, entry.name, 'SKILL.md');
  const text = skillFile(entry);
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (cur === text) return { ok: true, action: 'same', file };
  if (cur !== null && !cur.includes(SKILL_MARK)) return { ok: false, reason: 'exists', file }; // the project's own
  writeFile(file, text);
  return { ok: true, action: cur === null ? 'created' : 'updated', file };
}

/** A connector as each agent writes it in its MCP config. */
export function connectorEntry(entry, harness) {
  const { url, command, args = [] } = entry.config || {};
  if (harness === 'opencode') return url ? { type: 'remote', url, enabled: true } : { type: 'local', command: [command, ...args], enabled: true };
  if (harness === 'claude-code') return url ? { type: 'http', url } : { command, args };
  return url ? { url } : { command, args };
}

const tomlStr = (s) => JSON.stringify(String(s));
function codexTable(entry) {
  const { url, command, args = [] } = entry.config || {};
  return `[mcp_servers.${entry.name}]\n${url ? `url = ${tomlStr(url)}\n` : `command = ${tomlStr(command)}\nargs = [${args.map(tomlStr).join(', ')}]\n`}`;
}

/** Installs a connector in a project's MCP config: the same answer as installSkill. */
export function installConnector(entry, { dir, harness }) {
  const rel = MCP_FILE[harness];
  if (!rel) return { ok: false, reason: 'harness' };
  const file = path.join(dir, rel);
  if (harness === 'codex') {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const table = codexTable(entry);
    if (cur.includes(table)) return { ok: true, action: 'same', file };
    if (new RegExp(`^\\[mcp_servers\\.${entry.name}\\]`, 'm').test(cur)) return { ok: false, reason: 'exists', file };
    writeFile(file, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${cur ? '\n' : ''}${table}`);
    return { ok: true, action: cur ? 'updated' : 'created', file };
  }
  // OpenCode with an opencode.jsonc (comments): it is added by hand, so they are not lost
  if (harness === 'opencode' && !fs.existsSync(file) && fs.existsSync(path.join(dir, 'opencode.jsonc'))) return { ok: false, reason: 'manual', file: path.join(dir, 'opencode.jsonc') };
  const { data, exists, error } = readJson(file);
  if (error) return { ok: false, reason: 'invalid', file };
  const key = harness === 'opencode' ? 'mcp' : 'mcpServers';
  const want = connectorEntry(entry, harness);
  const have = data[key]?.[entry.name];
  if (have && same(have, want)) return { ok: true, action: 'same', file };
  if (have) return { ok: false, reason: 'exists', file };
  const next = { ...(harness === 'opencode' && !exists ? { $schema: 'https://opencode.ai/config.json' } : {}), ...data, [key]: { ...(data[key] || {}), [entry.name]: want } };
  writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, action: exists ? 'updated' : 'created', file };
}

export class Archive extends EventEmitter {
  /**
   * @param store     the database (server/store.js): the archive's entries
   * @param registry  the agents (server/registry.js): where skills and connectors are installed, and
   *                  who writes one from a description
   */
  constructor({ store, registry }) {
    super();
    this.store = store;
    this.registry = registry;
  }

  /** An entry without its whole body (the list): its first lines. */
  static summary(e) {
    const { body, ...rest } = e;
    const text = String(body || '').replace(/\s+/g, ' ').trim();
    return { ...rest, excerpt: text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text, size: String(body || '').length };
  }

  list(opts = {}) { return this.store.listKnowledge(opts).map(Archive.summary); }
  counts() { return this.store.knowledgeCounts(); }
  snapshot() { return { counts: this.counts(), recent: this.list({ limit: 40 }) }; }

  /** An entry, whole. `touch`: an agent read it (one more use). */
  get(id, { touch = false } = {}) {
    const e = this.store.getKnowledge(id);
    if (e && touch) { this.store.touchKnowledge(e.id); e.uses++; }
    return e;
  }

  /** Saves an entry (with `id`, it changes that one). */
  save(input = {}, { source } = {}) {
    const body = { ...input, ...(source && !input.source ? { source } : {}) };
    const out = input.id ? this.store.updateKnowledge(input.id, body) : this.store.createKnowledge(body);
    if (!out.ok) return out;
    this.emit('saved', out.entry, out.created);
    this.emit('change');
    return out;
  }

  remove(id) {
    const e = this.store.getKnowledge(id);
    const out = this.store.deleteKnowledge(id);
    if (out.ok) { this.emit('removed', e); this.emit('change'); }
    return out;
  }

  /**
   * Installs a skill or a connector in the projects of some registered agents (their ids).
   * Returns { ok, results: [{ target, name, harness, ok, action | reason, file }] }.
   */
  install(id, targets = []) {
    const e = this.store.getKnowledge(id);
    if (!e) return { ok: false, status: 404, error: tr('err.unknownKnowledge') };
    if (!['skill', 'connector'].includes(e.kind)) return { ok: false, error: tr('err.notInstallable') };
    const agents = this.store.listAgents();
    const ids = [...new Set((Array.isArray(targets) ? targets : [targets]).map(String))];
    if (!ids.length) return { ok: false, error: tr('err.pickProjects') };
    const results = [];
    for (const tid of ids) {
      const a = agents.find((x) => x.id === tid);
      if (!a) { results.push({ target: tid, ok: false, reason: 'unknown' }); continue; }
      let r;
      try { r = (e.kind === 'skill' ? installSkill : installConnector)(e, { dir: a.path, harness: a.harness }); } catch (err) { r = { ok: false, reason: 'error', error: err.message }; }
      results.push({ target: a.id, name: a.name, harness: a.harness, office: a.office, ...r, ...(r.file ? { rel: path.relative(a.path, r.file) } : {}) });
      if (r.ok && r.action !== 'same') this.registry?.forget?.(a.path);
    }
    this.emit('installed', e, results);
    return { ok: results.some((r) => r.ok), results, ...(results.some((r) => r.ok) ? {} : { error: tr('err.installFailed') }) };
  }

  /**
   * Asks an agent to write a skill, a connector or a note for the archive from a description: it gets
   * the brief and saves the result with the MCP tool save_knowledge.
   */
  generate({ kind = 'skill', text, target, from } = {}) {
    const what = String(text ?? '').trim();
    if (!what) return { ok: false, error: tr('err.promptEmpty') };
    if (!['skill', 'connector', 'note', 'doc'].includes(kind)) return { ok: false, error: tr('err.knowledgeKind', { kinds: 'skill, connector, note, doc' }) };
    if (!target) return { ok: false, error: tr('err.targetUnknown') };
    const brief = tr(`archive.generate.${kind}`, { text: what });
    const out = this.registry.run({ target, entry: 'prompt', text: brief, title: `📚 ${tr(`knowledgeKind.${kind}`)}: ${what}`.slice(0, 300), from: from || tr('archive.from') });
    if (out.ok) this.emit('generate', { kind, text: what, target });
    return out;
  }
}
