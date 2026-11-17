// The sections of the settings area (settings-ui.js), in the menu's order: [group, [sections…]]. Their
// names, what each one is for and the words the search finds them by are in the locales (settings.groups,
// settings.nav, settings.desc, settings.words). A section's address is #settings/<id>.

export const SETTINGS_GROUPS = [
  ['office', ['general', 'game']],
  ['company', ['company', 'offices', 'repos']],
  ['architecture', ['architecture', 'projects', 'infra']],
  ['agents', ['autonomy', 'context', 'models', 'intelligence', 'archive', 'terminal']],
  ['people', ['look', 'experts']],
  ['yours', ['mine']],
  ['system', ['backup', 'about']],
];
export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap(([, ids]) => ids);
