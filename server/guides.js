// The instructions to work with a project: the company's standards (the CTO's, for every project),
// its department's (the office it belongs to) and its own (its folder's), like a ChatGPT or Claude
// project's. They go at the top of every brief, pipeline, directive and question that reaches that
// project's agent, right under the 📁 scope line:
//
//   📁 Work only inside ~/shop: …
//   📋 The company's standards (the CTO's):
//   │ Conventional commits. Every endpoint documented in OpenAPI.
//   📋 Instructions of the department «Payments»:
//   │ Every amount in cents. Never log card numbers.
//   📋 Instructions of the project «shop»:
//   │ pnpm, not npm. Tests: pnpm test.
//
//   <the brief>
//
// The office takes that header out of the board's title (office.js).
//
// Each department also says how much it works on its own (autonomyOf): guided, balanced or
// autonomous; or, without its own, the company's ⚙ › General › Autonomy.

import path from 'node:path';
import { insideDir, realDir } from './paths.js';
import { t } from '../public/i18n.js';
import { AUTONOMY_LEVELS } from './store.js';
import { artifactLine } from './systems.js';

export const GUIDE_MARK = '📋 ';
export const GUIDE_LINE = '│';

/**
 * For a folder (and, if it is not a registered project's, the office it works for): the company's
 * standards, its project (the deepest registered folder containing it, or the folder itself) and its
 * department. { company: { text } | null, project: { name, path, text } | null,
 * department: { id, name, text } | null, office: the department's id | null }
 */
export function guideFor(store, dir, office = null) {
  if (!store) return { company: null, project: null, department: null, office };
  const projects = dir ? store.listAgents().filter((a) => insideDir(dir, a.path)).sort((a, b) => b.path.length - a.path.length) : [];
  const registered = projects[0] || null;
  const folder = registered?.path || (dir ? realDir(dir) : null);
  const own = folder ? store.getProjectInstructions(folder) : '';
  const dept = store.getOffice?.(registered?.office || office || '') || null;
  const standards = store.getPrefs?.().standards || '';
  // the systems it is an artifact of (server/systems.js): their instructions, and what the artifact is in each
  const systems = folder ? (store.systemsOf?.(dir || folder) || []).map(({ system, parts }) => ({ id: system.id, name: system.name, text: system.instructions || '', lines: parts.map((p) => artifactLine(system, p)) })) : [];
  return {
    company: standards ? { text: standards } : null,
    office: dept?.id || registered?.office || office || null,
    project: own ? { name: registered?.name || path.basename(folder), path: folder, text: own } : null,
    department: dept?.instructions ? { id: dept.id, name: dept.name || t('offices.main'), text: dept.instructions } : null,
    systems,
  };
}

/** The header lines for a guide ('' if there are no instructions). */
export function guideText(g) {
  const block = (title, text) => [`${GUIDE_MARK}${title}`, ...String(text).split('\n').map((l) => `${GUIDE_LINE} ${l}`.trimEnd())];
  return [
    ...(g?.company ? block(t('guide.company'), g.company.text) : []),
    ...(g?.department ? block(t('guide.department', { name: g.department.name }), g.department.text) : []),
    ...(g?.systems || []).flatMap((s) => [...s.lines, ...(s.text ? block(t('guide.system', { name: s.name }), s.text) : [])]),
    ...(g?.project ? block(t('guide.project', { name: g.project.name }), g.project.text) : []),
  ].join('\n');
}

const LEVELS = { guided: { clarify: true, autonomous: false }, balanced: { clarify: true, autonomous: true }, autonomous: { clarify: false, autonomous: true } };

/**
 * How much a department works on its own: its level (guided: the analyst reviews each brief and the
 * agent asks when in doubt; balanced: it reviews and the agent works to the end; autonomous: no review)
 * or, without one, the company's. { clarify, autonomous, level: its own level | null }
 */
export function autonomyOf(store, officeId) {
  const level = officeId ? store?.getOffice?.(officeId)?.autonomy : null;
  if (AUTONOMY_LEVELS.includes(level)) return { ...LEVELS[level], level };
  const a = store?.getPrefs?.().autonomy || {};
  return { clarify: a.clarify !== false, autonomous: a.autonomous !== false, level: null };
}

/** Takes the office's header (the 📁 scope, the 📋 instructions, the 📚 archive) out of a brief: what is left is the task. */
export const unguided = (text) => (/^(📁 |📋 |📚 |🧩 )/.test(text) ? text.replace(/^(?:(?:📁 |📋 |📚 |🧩 |│)[^\n]*\n)+\n*/, '') : text);
