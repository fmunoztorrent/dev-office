// The user's settings as a JSON file: export them (to keep them, share them or take them to another
// machine) and import them. What is the user's, and goes in the file:
//
//   prefs        the general settings: language, time zone and city, weather, herdr, the log, how the
//                game looks (front or top-down), the model profiles, the autonomy, the company's
//                standards, the capacity and the archive's search
//   departments  each office: name, time zone, city, instructions, autonomy and its characters (the
//                looks, names and ways of being customized in ⚙ › Characters)
//   projects     the registered agents (folder, harness, executable, arguments, department) with their
//                instructions and the components you declared (the map the directives use); and the
//                instructions of folders that are not registered
//   systems      the products or business projects (server/systems.js): their team, instructions and artifacts
//   mine         what is yours (⚙ › Mine): your private skills and your own tools (server/mine.js)
//   skills       your other skills with their files (server/skill-bundle.js): the ones in your agents'
//                personal folders and the ones your experts use from a project. On import you choose
//                where they go: your personal folders, some repositories, or nowhere
//   experts      the subject matter experts (server/experts.js): who knows each skill, and how they look
//   resources    the infrastructure on the map (server/resources.js): queues, topics, databases, APIs…,
//                where each one lives and which project folders use it
//
// What is not: what belongs to the game (the default team, the map, the phases, which character does
// each tool) and what is history or content rather than a setting (the log, the briefs, the directives,
// the dailies, the questions and the archive: that one exports each document by itself). Nor where you
// are looking right now (the floor and the office being watched). No secret is ever stored in the
// settings (the embeddings' key comes from the environment), so none travels.
//
// Importing merges: what the file brings replaces what is here, and what it does not bring stays.
// A department's characters are left as the file has them. A project whose folder does not exist on
// this machine is skipped, and said so.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MAIN_OFFICE, DEFAULT_PREFS } from './store.js';
import { realDir } from './paths.js';
import { t } from '../public/i18n.js';
import { Mine, mineSkillFile, personalSkillDirs } from './mine.js';
import { collectSkills, installSkills, repoSkillDir } from './skill-bundle.js';

export const SETTINGS_KIND = 'dev-team-office/settings';
export const SETTINGS_VERSION = 2;
// the general settings that are the user's (not where they are looking right now)
const PREF_KEYS = Object.keys(DEFAULT_PREFS);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Everything that is the user's, as a JSON-ready object. */
export function exportSettings(store, { app = '', home = null, skills: withSkills = true } = {}) {
  const p = store.getPrefs();
  const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, structuredClone(p[k])]));
  prefs.view = { mode: p.view.mode }; // only how the game looks: not the floor or office being watched
  const agents = store.listAgents();
  // the areas, and each project (an office, kept under its old name in the file) with its area and its people
  const areas = (store.listAreas?.() || []).map((a) => ({ id: a.id, name: a.name, instructions: a.instructions || '' }));
  const departments = store.listOffices().map((o) => ({
    id: o.id, name: o.name, area: o.area, timezone: o.timezone, location: o.location, instructions: o.instructions || '', autonomy: o.autonomy,
    characters: store.getAppearance(o.id) || {},
  }));
  const declared = store.listComponents?.() || [];
  const projects = agents.map((a) => {
    const components = declared.filter((c) => c.project === realDir(a.path)).map((c) => ({ name: c.name, path: c.path, ...(c.description ? { description: c.description } : {}) }));
    return {
      name: a.name, path: a.path, harness: a.harness, ...(a.bin ? { bin: a.bin } : {}), ...(a.args ? { args: a.args } : {}),
      department: a.office, ...(a.kind ? { kind: a.kind } : {}), instructions: a.instructions || '', ...(components.length ? { components } : {}),
    };
  });
  const registered = new Set(agents.map((a) => a.path));
  const instructions = (store.listProjectInstructions?.() || []).filter((x) => !registered.has(x.path));
  const mine = (kind) => (store.listMine?.(kind) || []).map((e) => ({ name: e.name, title: e.title, body: e.body, enabled: e.enabled, ...(e.config ? { config: e.config } : {}) }));
  // what each repository uses of another, by their folders
  const pathOf = new Map(agents.map((a) => [a.id, a.path]));
  const relations = (store.listRelations?.() || []).filter((r) => pathOf.has(r.from) && pathOf.has(r.to))
    .map((r) => ({ from: pathOf.get(r.from), to: pathOf.get(r.to), how: r.how, ...(r.note ? { note: r.note } : {}), ...(r.source !== 'you' ? { source: r.source, evidence: r.evidence } : {}) }));
  const experts = (store.listExperts?.() || []).map(({ skill, topic, look, actions }) => ({ skill, ...(topic ? { topic } : {}), ...(Array.isArray(actions) && actions.length ? { actions } : {}), look }));
  const resources = (store.listResources?.() || []).map(({ kind, name, tech, location, state, notes, links }) => ({ kind, name, ...(tech ? { tech } : {}), ...(location ? { location } : {}), ...(state !== 'exists' ? { state } : {}), ...(notes ? { notes } : {}), ...(links.length ? { links } : {}) }));
  // your skills with their files (only with your HOME: a test never reads the real one)
  const skills = withSkills && (home || store) ? collectSkills({ store, home }) : [];
  return { kind: SETTINGS_KIND, version: SETTINGS_VERSION, app, exportedAt: new Date().toISOString(), prefs, areas, departments, projects, relations, instructions, mine: { skills: mine('skill'), tools: mine('tool') }, skills, experts, resources };
}

/** Is it a settings file? Returns { ok, data } or { ok: false, error } (said in the game's language). */
export function parseSettings(raw) {
  let data = raw;
  const no = (why) => ({ ok: false, error: t(`err.settingsFile.${why}`) });
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch { return no('json'); } }
  if (!isObj(data) || data.kind !== SETTINGS_KIND) return no('kind');
  if (!Number.isInteger(data.version) || data.version > SETTINGS_VERSION) return no('version');
  return { ok: true, data };
}

/**
 * Applies a settings file. Each piece is checked on its own (like the forms do): what fails is reported
 * and the rest is applied. Returns { ok, applied: { prefs, departments, characters, projects,
 * instructions }, skipped: [{ what, error }], lang? } (lang: it changed the language).
 */
/**
 * @param skills  where the file's skills go: { to: 'global' (your personal folders, the default) | 'repos'
 *                (the registered repositories in `repos`: ids or folders) | 'none', repos: [] }
 */
export function importSettings(store, raw, { mine: yours = new Mine({ store }), skills: where = { to: 'global' } } = {}) {
  const parsed = parseSettings(raw);
  if (!parsed.ok) return parsed;
  const d = parsed.data;
  const applied = { prefs: 0, areas: 0, departments: 0, characters: 0, projects: 0, relations: 0, components: 0, instructions: 0, systems: 0, skills: 0, tools: 0, experts: 0, resources: 0, installed: 0 };
  const to = ['global', 'repos', 'none'].includes(where?.to) ? where.to : 'global';
  const installed = [];
  const skipped = [];
  const skip = (what, error) => skipped.push({ what, error: String(error || '') });

  // the areas first: the projects name them
  const areaIds = new Map(); // the file's id → the id here
  for (const a of Array.isArray(d.areas) ? d.areas : []) {
    if (!isObj(a) || !a.id) continue;
    const here = a.id === 'general' ? store.findArea('general') : store.getArea(a.id) || (a.name ? store.findArea(a.name) : null);
    const out = here ? store.updateArea(here.id, { name: here.id === 'general' ? here.name : a.name, instructions: a.instructions ?? '' }) : store.createArea({ name: a.name, instructions: a.instructions ?? '' });
    if (!out.ok) { skip(t('settingsIo.area', { name: a.name || a.id }), out.error); continue; }
    applied.areas++;
    areaIds.set(a.id, out.area.id);
  }
  // then the projects (the departments of before): the prefs and the repositories may name them
  const ids = new Map(); // the file's id → the id here
  for (const o of Array.isArray(d.departments) ? d.departments : []) {
    if (!isObj(o) || !o.id) continue;
    const area = o.area ? areaIds.get(o.area) || (store.findArea(o.area)?.id) || undefined : undefined;
    const fields = { name: o.name, timezone: o.timezone ?? null, location: o.location ?? null, instructions: o.instructions ?? '', autonomy: o.autonomy ?? null, ...(area ? { area } : {}) };
    const here = store.getOffice(o.id) || (o.name ? store.findOffice(o.name) : null);
    const out = here ? store.updateOffice(here.id, o.id === MAIN_OFFICE ? { ...fields, name: o.name ?? here.name } : fields) : store.createOffice({ id: o.id, ...fields });
    if (!out.ok) { skip(t('settingsIo.department', { name: o.name || o.id }), out.error); continue; }
    applied.departments++;
    ids.set(o.id, out.office.id);
    if (isObj(o.characters)) {
      // the file's characters, as they are: the ones it does not customize go back to the original
      const now = store.getAppearance(out.office.id) || {};
      const patch = { ...Object.fromEntries(Object.keys(now).map((r) => [r, null])), ...o.characters };
      const r = store.setAppearance(patch, out.office.id);
      if (r.ok) applied.characters += Object.keys(o.characters).length; else skip(t('settingsIo.characters', { name: o.name || o.id }), r.error);
    }
  }

  // the general settings: one key at a time, so a bad one does not take the others down
  if (isObj(d.prefs)) {
    for (const [k, v] of Object.entries(d.prefs)) {
      if (!PREF_KEYS.includes(k)) { skip(t('settingsIo.pref', { key: k }), t('err.pref', { key: k })); continue; }
      let value = v;
      if (k === 'view') value = isObj(v) && v.mode ? { mode: v.mode } : null;
      if (k === 'herdr' && isObj(v) && v.startAgent && !['auto', 'none'].includes(v.startAgent) && !store.getAgent(v.startAgent)) value = { ...v, startAgent: 'auto' }; // that agent is not here
      if (value === null) continue;
      const out = store.setPrefs({ [k]: value });
      if (out.ok) applied.prefs++; else skip(t('settingsIo.pref', { key: k }), out.error);
    }
  }

  // the projects: the ones whose folder exists here
  const mine = store.listAgents();
  for (const a of Array.isArray(d.projects) ? d.projects : []) {
    if (!isObj(a) || !a.path) continue;
    const dir = String(a.path).replace(/^~(?=$|\/)/, os.homedir());
    if (!path.isAbsolute(dir) || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) { skip(t('settingsIo.project', { name: a.name || a.path }), t('err.pathNotFound', { path: a.path })); continue; }
    const office = ids.get(a.department) || (store.getOffice(a.department) ? a.department : MAIN_OFFICE);
    const fields = { name: a.name, path: dir, harness: a.harness, office, instructions: a.instructions ?? '', ...(a.kind !== undefined ? { kind: a.kind } : {}), ...(a.bin !== undefined ? { bin: a.bin } : {}), ...(a.args !== undefined ? { args: a.args } : {}) };
    const here = mine.find((x) => x.path === realDir(dir) && x.harness === (a.harness === 'claude' ? 'claude-code' : a.harness));
    const out = here ? store.updateAgent(here.id, fields) : store.createAgent(fields);
    if (!out.ok) { skip(t('settingsIo.project', { name: a.name || a.path }), out.error); continue; }
    applied.projects++;
    // its components (the ones declared: the detected ones come from its folder)
    for (const c of Array.isArray(a.components) ? a.components : []) {
      if (!isObj(c)) continue;
      const r = store.addComponent({ project: out.agent.path, name: c.name, path: c.path || '', description: c.description || '' });
      if (r.ok) applied.components++; else skip(t('settingsIo.component', { name: c.name || '?', project: a.name || a.path }), r.error);
    }
  }
  // the instructions of folders that are not registered projects
  for (const x of Array.isArray(d.instructions) ? d.instructions : []) {
    if (!isObj(x) || !x.path) continue;
    const out = store.setProjectInstructions(x.path, x.instructions ?? '');
    if (out.ok) applied.instructions++; else skip(t('settingsIo.instructions', { path: x.path }), out.error);
  }
  // what each repository uses of another: both folders have to be here
  const byPath = (p) => store.listAgents().find((x) => x.path === realDir(String(p || '').replace(/^~(?=$|\/)/, os.homedir())));
  for (const r of Array.isArray(d.relations) ? d.relations : []) {
    if (!isObj(r)) continue;
    const from = byPath(r.from), to = byPath(r.to);
    if (!from || !to) { skip(t('settingsIo.relation', { from: r.from || '?', to: r.to || '?' }), t('err.pathNotFound', { path: !from ? r.from : r.to })); continue; }
    const out = store.saveRelation({ from: from.id, to: to.id, how: r.how, note: r.note ?? '', source: r.source, evidence: r.evidence ?? '' });
    if (out.ok) applied.relations++; else skip(t('settingsIo.relation', { from: from.name, to: to.name }), out.error);
  }
  // the systems of a file from an earlier version: each one becomes a project and its relations
  const here = store.listAgents();
  for (const s of Array.isArray(d.systems) ? d.systems : []) {
    if (!isObj(s) || !s.name) continue;
    const kept = [], lost = [];
    for (const p of Array.isArray(s.parts) ? s.parts : []) {
      if (!isObj(p)) continue;
      const dir = String(p.project || '').replace(/^~(?=$|\/)/, os.homedir());
      const a = here.find((x) => x.path === realDir(dir));
      if (a) kept.push({ ...p, project: a.path }); else lost.push(p.name || p.project);
    }
    const names = new Set(kept.map((p) => p.name));
    const parts = kept.map((p) => ({ ...p, uses: (Array.isArray(p.uses) ? p.uses : []).filter((u) => names.has(u)) }));
    const office = ids.get(s.department) || (store.getOffice(s.department) ? s.department : MAIN_OFFICE);
    const out = store.saveSystem({ name: s.name, office, instructions: s.instructions ?? '', parts });
    if (!out.ok) { skip(t('settingsIo.system', { name: s.name }), out.error); continue; }
    applied.systems++;
    if (lost.length) skip(t('settingsIo.systemParts', { name: s.name, parts: lost.join(', ') }), t('err.pathNotFound', { path: lost.join(', ') }));
  }
  // what is yours: your skills (installed in your personal folders) and your tools, by name
  const bundled = [];
  if (isObj(d.mine)) {
    for (const [kind, list] of [['skill', d.mine.skills], ['tool', d.mine.tools]]) {
      for (const e of Array.isArray(list) ? list : []) {
        if (!isObj(e)) continue;
        // a private skill goes to your personal folders only when you said so (global); otherwise it is kept
        // in ⚙ › Mine, off, and (repos) its SKILL.md goes to the repositories with the others
        const had = kind === 'skill' ? (store.listMine?.('skill') || []).find((x) => x.name === e.name) : null;
        const enabled = e.enabled !== false && (kind === 'tool' || to === 'global' || !!had?.enabled);
        const out = yours.save({ kind, name: e.name, title: e.title, body: e.body, enabled, ...(kind === 'tool' ? { config: e.config } : {}) });
        if (out.ok && kind === 'skill' && to === 'repos') bundled.push({ name: out.entry.name, files: { 'SKILL.md': mineSkillFile(out.entry) } });
        if (out.ok) applied[`${kind}s`]++; else skip(t(`settingsIo.${kind}`, { name: e.name || '?' }), out.error);
      }
    }
  }
  // the experts: by their skill (the one there was for that skill is updated)
  for (const x of Array.isArray(d.experts) ? d.experts : []) {
    if (!isObj(x)) continue;
    const out = store.saveExpert({ skill: x.skill, topic: x.topic ?? '', look: isObj(x.look) ? x.look : {}, actions: Array.isArray(x.actions) ? x.actions : [] });
    if (out.ok) applied.experts++; else skip(t('settingsIo.expert', { skill: x.skill || '?' }), out.error);
  }
  // the infrastructure: by its kind and name; a link to a folder that is not on this machine is left out
  for (const x of Array.isArray(d.resources) ? d.resources : []) {
    if (!isObj(x)) continue;
    const links = (Array.isArray(x.links) ? x.links : []).filter((l) => isObj(l) && typeof l.project === 'string' && fs.existsSync(l.project));
    const out = store.saveResource({ kind: x.kind, name: x.name, tech: x.tech ?? '', location: x.location ?? '', state: x.state || 'exists', notes: x.notes ?? '', links });
    if (out.ok) applied.resources++; else skip(t('settingsIo.resource', { name: x.name || '?' }), out.error);
  }
  // your other skills, with their files: where you said (never over one that is there and is not the same)
  const files = (Array.isArray(d.skills) ? d.skills : []).filter((x) => isObj(x));
  if (to !== 'none' && (files.length || bundled.length)) {
    let dirs = [];
    // your personal folders: only with a HOME that was given (never the default one by accident)
    if (to === 'global') dirs = yours.home ? personalSkillDirs(yours.home).map((x) => ({ dir: x.dir, label: x.dir })) : [];
    else {
      const wanted = new Set((Array.isArray(where.repos) ? where.repos : []).map(String));
      dirs = store.listAgents().filter((a) => wanted.has(a.id) || wanted.has(a.path) || wanted.has(realDir(a.path) || '')).map((a) => ({ dir: repoSkillDir(a), label: a.name }));
      if (!dirs.length) skip(t('settingsIo.skillsWhere'), t('err.skillsNoRepos'));
    }
    for (const r of installSkills([...files, ...bundled], dirs)) {
      if (r.ok) { if (r.action !== 'same') applied.installed++; installed.push(r); }
      else skip(t('settingsIo.skillIn', { name: r.name, where: r.label }), t(`err.skillInstall.${r.reason}`));
    }
  }
  return { ok: true, applied, skipped, installed, lang: isObj(d.prefs) && d.prefs.lang ? store.getPrefs().lang : undefined };
}
