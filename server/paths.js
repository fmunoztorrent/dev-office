// Compare folders by their real path: on macOS /tmp is /private/tmp, and an agent may report either
// (or a link to its project). It is memoized so the disk is not touched on every event.
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

// the real path of the closest existing ancestor, plus what is missing (a folder that does not exist yet)
function resolveReal(p) {
  const rest = [];
  for (let cur = path.resolve(p); ;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** The real path of a folder (no links, no trailing slash). */
export function realDir(p) {
  if (!p) return p;
  const key = String(p).replace(/\/+$/, '') || '/';
  let v = cache.get(key);
  if (v === undefined) {
    v = resolveReal(key);
    if (cache.size > 1000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Is `dir` inside `root` (or the same)? By real paths. */
export function insideDir(dir, root) {
  if (!dir || !root) return false;
  const d = realDir(dir), r = realDir(root);
  return d === r || d.startsWith(`${r}${path.sep}`);
}
