// Model profiles: which model each role of the team uses, by profile. Two come with the office
// (Anthropic's and OpenCode's free ones) and more can be added in ⚙ › Models. A profile is used when
// a brief opens a new session (the agent starts with its `default` model) and by a pipeline's stages
// that do not set a model of their own (each one, its role's). Shared by the server, the web and the
// terminal.

export const MODEL_ROLES = ['default', 'manager', 'tl', 'analyst', 'backend', 'frontend', 'qa', 'designer'];
export const PROFILE_HARNESSES = ['claude-code', 'pi', 'opencode', 'codex'];

export const DEFAULT_PROFILES = {
  anthropic: {
    label: 'Anthropic',
    harnesses: ['claude-code', 'pi', 'opencode'],
    roles: { default: 'anthropic/claude-sonnet-5-5', tl: 'anthropic/claude-opus-5-5', qa: 'anthropic/claude-haiku-5-5' },
  },
  opencode: {
    label: 'OpenCode',
    harnesses: ['opencode'],
    roles: { default: 'opencode/big-pickle', tl: 'opencode/deepseek-v4.1-flash-free', qa: 'opencode/glm-5.3-flash-free' },
  },
};
// active: the profile a brief uses unless another one is picked; null: each agent's own model
export const DEFAULT_MODELS = { active: null, profiles: DEFAULT_PROFILES };

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const MODEL = /^[\w.:@[\]/-]{1,80}$/;

/** A role's model in a profile (or the profile's default). null: the agent's own. */
export const profileModel = (profile, role) => (profile ? profile.roles?.[role] || profile.roles?.default || null : null);

/** The profiles an agent can use (the ones made for its harness), as [id, profile]. */
export function profilesFor(models, harness) {
  return Object.entries(models?.profiles || {}).filter(([, p]) => !harness || !p.harnesses?.length || p.harnesses.includes(harness));
}

/**
 * Checks and cleans what comes in ({ active, profiles }). Returns { ok, models } or { ok: false, error }
 * with the key that is wrong.
 */
export function normalizeModels(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'models' };
  const profiles = {};
  for (const [id, p] of Object.entries(input.profiles || {})) {
    if (!ID.test(id) || !p || typeof p !== 'object') return { ok: false, error: `models.profiles.${id}` };
    const roles = {};
    for (const [role, model] of Object.entries(p.roles || {})) {
      if (!MODEL_ROLES.includes(role)) return { ok: false, error: `models.profiles.${id}.roles.${role}` };
      const m = String(model ?? '').trim();
      if (!m) continue;
      if (!MODEL.test(m)) return { ok: false, error: `models.profiles.${id}.roles.${role}` };
      roles[role] = m;
    }
    if (!roles.default) return { ok: false, error: `models.profiles.${id}.roles.default` };
    const harnesses = Array.isArray(p.harnesses) ? p.harnesses.filter((h) => PROFILE_HARNESSES.includes(h)) : [];
    profiles[id] = { label: String(p.label || id).trim().slice(0, 30) || id, harnesses, roles };
  }
  if (!Object.keys(profiles).length) return { ok: false, error: 'models.profiles' };
  const active = input.active && input.active !== 'none' && profiles[input.active] ? input.active : null;
  return { ok: true, models: { active, profiles } };
}
