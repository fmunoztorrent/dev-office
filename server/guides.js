// The instructions to work with a project: its department's (the office it belongs to) and its own
// (its folder's), like a ChatGPT or Claude project's. They go at the top of every brief, pipeline,
// directive and question that reaches that project's agent, right under the 📁 scope line:
//
//   📁 Work only inside ~/shop: …
//   📋 Instructions of the department «Payments»:
//   │ Every amount in cents. Never log card numbers.
//   📋 Instructions of the project «shop»:
//   │ pnpm, not npm. Tests: pnpm test.
//
//   <the brief>
//
// The office takes that header out of the board's title (office.js).

import path from 'node:path';
import { insideDir, realDir } from './paths.js';
import { t } from '../public/i18n.js';

export const GUIDE_MARK = '📋 ';
export const GUIDE_LINE = '│';

/**
 * For a folder (and, if it is not a registered project's, the office it works for): its project
 * (the deepest registered folder containing it, or the folder itself) and its department.
 * { project: { name, path, text } | null, department: { id, name, text } | null }
 */
export function guideFor(store, dir, office = null) {
  if (!store) return { project: null, department: null };
  const projects = dir ? store.listAgents().filter((a) => insideDir(dir, a.path)).sort((a, b) => b.path.length - a.path.length) : [];
  const registered = projects[0] || null;
  const folder = registered?.path || (dir ? realDir(dir) : null);
  const own = folder ? store.getProjectInstructions(folder) : '';
  const dept = store.getOffice?.(registered?.office || office || '') || null;
  return {
    project: own ? { name: registered?.name || path.basename(folder), path: folder, text: own } : null,
    department: dept?.instructions ? { id: dept.id, name: dept.name || t('offices.main'), text: dept.instructions } : null,
  };
}

/** The header lines for a guide ('' if there are no instructions). */
export function guideText(g) {
  const block = (title, text) => [`${GUIDE_MARK}${title}`, ...String(text).split('\n').map((l) => `${GUIDE_LINE} ${l}`.trimEnd())];
  return [
    ...(g?.department ? block(t('guide.department', { name: g.department.name }), g.department.text) : []),
    ...(g?.project ? block(t('guide.project', { name: g.project.name }), g.project.text) : []),
  ].join('\n');
}

/** Takes the office's header (the 📁 scope and the 📋 instructions) out of a brief: what is left is the task. */
export const unguided = (text) => (/^(📁 |📋 )/.test(text) ? text.replace(/^(?:(?:📁 |📋 |│)[^\n]*\n)+\n*/, '') : text);
