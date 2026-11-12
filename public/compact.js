// The auto-compaction's limit, shared by the office (server/compact.js) and its context bar (main.js):
// your threshold (⚙ › General) in tokens for an agent's context, and tokens as people say them.

/** 412k, 1.2M: a number of tokens as people say it. */
export const kTokens = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);

/** The limit in tokens for that context ({ used, max }), or null (off, or not below its window). */
export function thresholdOf(prefs, context) {
  const c = prefs?.compact;
  if (!c?.auto || !context?.max) return null;
  const at = c.unit === 'pct' ? Math.round((context.max * c.at) / 100) : c.at;
  return at > 0 && at < context.max ? at : null;
}
