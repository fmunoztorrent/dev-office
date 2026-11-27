// What you can do with someone from their sheet, by who they are and what they are doing: questions
// they can answer (one click asks them) and places to go. Someone of the team who is not working has
// nothing to tell you: no actions (the sheet only shows what they did last). No DOM here.

// Who you ask about the project whatever they are doing (server/asks.js, ADVISORS).
export const ADVISORS = new Set(['analyst', 'tl', 'manager']);

/**
 * The actions of someone's sheet, in order: { ask: 'doing' } is a question (its text is ui.act.<key>),
 * { go: 'board' | 'daily' | 'architecture' } a place, { go: 'route', to, key } another character's sheet.
 * `idle`: they are not doing anything now. `present(role)`: is that character in the office?
 */
export function sheetActions(id, { idle = false, present = () => true } = {}) {
  if (!id) return [];
  if (id === 'po') {
    const routes = [['business', 'analyst'], ['tech', 'tl'], ['now', 'manager']].filter(([, r]) => present(r)).map(([key, to]) => ({ go: 'route', to, key }));
    return [{ go: 'board' }, ...routes, { go: 'daily' }];
  }
  if (id === 'manager') return [{ ask: 'teamHow' }, { ask: 'blocked' }, { go: 'daily' }];
  if (id === 'analyst') return [{ ask: 'problem' }, { ask: 'undefined' }, { go: 'board' }];
  if (id === 'tl') return [{ ask: 'built' }, { ask: 'risks' }, { go: 'architecture' }];
  if (idle) return [];
  return [{ ask: 'doing' }, { ask: 'left' }];
}
