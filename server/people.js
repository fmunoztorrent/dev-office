// How the team's people answer you (deterministic: no model decides who or what):
//   - the tech lead knows which repositories you are talking about (their names, or their project's)
//     and answers with them in front: what each one is, what it uses and who uses it;
//   - the manager takes an order and sends it right away to the project's repository you named (or
//     the project's only one): no review by the analyst, the agents get to work;
//   - the PM (the analyst) answers about the product, never about the code.
// The answers themselves come from each repository's agent (server/asks.js); this is what goes with them.
import { detectKind } from './systems.js';
import { t } from '../public/i18n.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Does `text` name `name` as a word (also with spaces instead of - and _)? */
const names = (text, name) => {
  const n = fold(name).trim();
  if (n.length < 3) return false;
  const forms = [...new Set([n, n.replace(/[-_.]+/g, ' ')])];
  return forms.some((f) => new RegExp(`(^|[^a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text));
};

/**
 * The registered repositories a text talks about: by their name, or by their project's name (all of its
 * repositories, only when none is named by its own). Only those of `office` when given.
 */
export function namedRepos(store, text, { office = null } = {}) {
  const q = fold(text);
  const agents = store.listAgents().filter((a) => !office || a.office === office);
  const byName = agents.filter((a) => names(q, a.name));
  // a repository named by its own name wins: "loyalty core" is not all of Loyalty
  if (byName.length) return byName;
  const projects = (store.listOffices?.() || []).filter((o) => o.name && names(q, o.name)).map((o) => o.id);
  const byProject = agents.filter((a) => projects.includes(a.office));
  return byProject;
}

/** What the tech lead knows of a repository, in a few lines: what it is, what it uses and who uses it. */
export function repoBrief(store, a) {
  const all = store.listAgents();
  const nameOf = (id) => all.find((x) => x.id === id)?.name || id;
  const rels = store.listRelations?.() || [];
  const uses = rels.filter((r) => r.from === a.id).map((r) => `${nameOf(r.to)} (${t(`arch.how.${r.how}`)})`);
  const usedBy = rels.filter((r) => r.to === a.id).map((r) => nameOf(r.from));
  const project = store.getOffice?.(a.office)?.name || a.office;
  const lines = [t('people.repo', { name: a.name, kind: t(`system.kinds.${a.kind || detectKind(a.path)}`), project, path: a.path })];
  if (uses.length) lines.push(t('people.uses', { list: uses.join(', ') }));
  if (usedBy.length) lines.push(t('people.usedBy', { list: usedBy.join(', ') }));
  const first = String(a.instructions || '').split('\n').find((l) => l.trim());
  if (first) lines.push(t('people.instructions', { text: first.trim().slice(0, 200) }));
  return lines.join('\n');
}

/** The tech lead's block for a question: the repositories it names, each one briefly ('' if none). */
export function techLeadContext(store, question, { office = null } = {}) {
  const repos = namedRepos(store, question, { office }).slice(0, 5);
  if (!repos.length) return '';
  return [t('people.named', { n: repos.length }), ...repos.map((a) => repoBrief(store, a))].join('\n');
}

/**
 * Where an order to the manager goes: the repository it names (in this office first), or the office's
 * only one, or the one with a live session. { target } or { error } when it cannot be told.
 */
export function orderTarget(store, registry, text, office) {
  const targets = registry.targets().filter((x) => x.registered);
  const here = targets.filter((x) => (x.office || 'main') === office);
  const named = namedRepos(store, text, { office }).map((a) => a.id).concat(namedRepos(store, text).map((a) => a.id));
  const hit = named.find((id) => targets.some((x) => x.id === id));
  if (hit) return { target: targets.find((x) => x.id === hit) };
  if (here.length === 1) return { target: here[0] };
  const live = here.filter((x) => x.sessions?.some((s) => s.live));
  if (live.length === 1) return { target: live[0] };
  return { error: here.length ? t('people.whichRepo', { list: here.map((x) => x.name).join(', ') }) : t('people.noRepo') };
}
