// The retro: called from the meeting table's rug (or the API), about the last task the project was given.
// The office suggests learnings from what that task said (its output and how it ended: no model is
// asked), you write or correct them, and the ones you keep go to the archive as knowledge, so the next
// briefs bring them (server/rag.js). With no learnings nothing is saved.
import { t } from '../public/i18n.js';

// a line that tells something learned, warned or decided (in either language)
const LEARN_RX = /(aprend|lecci[oó]n|learn|lesson|\bnota\b|\bnote\b|\bojo\b|importante|important|gotcha|cuidado|careful|warning|advertencia|⚠|\btip\b|decid|decision|resulta que|turns out)/i;
const LINES_MAX = 12;

/** The last task given to that office (the live ones first, then the history): { id, text, status, agent, detail, output } or null. */
export function lastTask({ hub, store, office }) {
  const live = (hub?.snapshot?.(office)?.tasks || []).filter((x) => x.text);
  const t0 = live.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (t0) {
    const full = hub.get?.(t0.id);
    return { id: t0.id, text: t0.text, status: t0.status, agent: t0.agent, detail: t0.detail || '', output: (full?.output || t0.output || []).map(String) };
  }
  const p = store?.listPrompts?.({ limit: 1 })?.[0];
  return p ? { id: p.id, text: p.text, status: p.status, agent: p.agent, detail: p.detail || '', output: [] } : null;
}

/** What the office suggests as learnings from a task: lines of its output that tell one, and how it failed. */
export function suggestLearnings(task) {
  if (!task) return [];
  const out = [];
  const add = (s) => { const x = String(s || '').replace(/^\s*[-*•>]+\s*/, '').trim(); if (x.length > 8 && x.length < 300 && !out.includes(x)) out.push(x); };
  for (const line of (task.output || []).flatMap((x) => String(x).split('\n'))) if (LEARN_RX.test(line)) add(line);
  if (task.status === 'failed' && task.detail) add(t('retro.failed', { detail: task.detail }));
  return out.slice(0, LINES_MAX);
}

/** The learnings you wrote, one per line ("- " bullets or not), without the empty ones. */
export function learningsOf(text) {
  return String(text || '').split('\n').map((l) => l.replace(/^\s*[-*•]+\s*/, '').trim()).filter(Boolean).slice(0, 40);
}

/**
 * Saves a retro: its learnings go to the archive (a note tagged retro), when there are any.
 * @returns {{ ok, saved: number, entry? }}
 */
export function saveRetro({ archive, office, officeName, task, learnings, from }) {
  const lines = learningsOf(learnings);
  if (!lines.length) return { ok: true, saved: 0 };
  const title = t('retro.title', { task: String(task?.text || t('retro.noTask')).slice(0, 80), office: officeName || office });
  const body = [task?.text ? t('retro.about', { task: task.text }) : '', '', ...lines.map((l) => `- ${l}`)].join('\n').trim();
  const out = archive.save({ kind: 'note', title, body, office, tags: ['retro', t('retro.tag')] }, { source: from || t('retro.source') });
  return out.ok ? { ok: true, saved: lines.length, entry: out.entry } : out;
}
