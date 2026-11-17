// The game's graphic themes (⚙ › The game › Style, prefs.theme): how its people look. Shared by the
// web view, the terminal and the server (their names, in the log and the texts).
//
//   pixel   the pixel-art team (the default): its cast is the one in sim.js (TEAM, VISITORS)
//   anime   a team of women drawn in the style of Japanese anime (public/anime.js): all of them adult
//           professionals, with their own names, hair styles and outfits. No men in it: whoever was
//           one in a customized look is drawn and named as a woman here. Each theme keeps its own
//           customizations (⚙ › Characters edits the cast of the theme in use).
//
// What a cast entry says that the pixel one does not: `hairstyle` (long, hime, ponytail, twintails, bob,
// short, bun, side, braid, wavy), `outfit` (blazer, blouse, suit, offshoulder, crop, turtleneck, jacket,
// sweater) and `eyes` (the iris' color). A look may carry them too (they win).

export const THEMES = ['pixel', 'anime'];
export const HAIRSTYLES = ['long', 'hime', 'ponytail', 'twintails', 'bob', 'short', 'bun', 'side', 'braid', 'wavy'];
export const OUTFITS = ['blazer', 'blouse', 'suit', 'offshoulder', 'crop', 'turtleneck', 'jacket', 'sweater'];

const f = (name, look) => ({ name, sex: 'f', beard: false, ...look });

/** The anime team: one per role (the PO is you). */
export const ANIME_TEAM = {
  designer: f('Hana', { personality: 'dreamer', style: 'normal', shirt: '#c9a3f5', pants: '#3a2f45', hair: '#b39ddb', skin: '#fbe3d4', long: true, glasses: false, hairstyle: 'twintails', outfit: 'offshoulder', eyes: '#8e5bd6' }),
  po: f('Sakura', { personality: 'chatty', style: 'normal', shirt: '#f2f2f7', pants: '#2b2d42', hair: '#f4a7c0', skin: '#fde5d8', long: true, glasses: false, hairstyle: 'long', outfit: 'blazer', eyes: '#d6537e' }),
  analyst: f('Mei', { personality: 'chatty', style: 'normal', shirt: '#f6c453', pants: '#2f3b52', hair: '#2d2147', skin: '#f5d6c0', long: true, glasses: true, hairstyle: 'ponytail', outfit: 'blouse', eyes: '#5b4fbf' }),
  manager: f('Kaori', { personality: 'chatty', style: 'normal', shirt: '#2d3a5c', pants: '#1f2333', hair: '#8c1c2c', skin: '#f2cdb4', long: true, glasses: false, hairstyle: 'bun', outfit: 'suit', eyes: '#b3263b' }),
  frontend: f('Akane', { personality: 'focused', style: 'normal', shirt: '#ff7a45', pants: '#2d3a4f', hair: '#ff8a3d', skin: '#fce0cc', long: false, glasses: false, hairstyle: 'bob', outfit: 'crop', eyes: '#e0602a' }),
  backend: f('Yuki', { personality: 'focused', style: 'normal', shirt: '#3b3f63', pants: '#1c1c28', hair: '#e8e8f2', skin: '#f7e4da', long: true, glasses: false, hairstyle: 'hime', outfit: 'turtleneck', eyes: '#5ab4e8' }),
  qa: f('Nanami', { personality: 'anxious', style: 'normal', shirt: '#8ac926', pants: '#2b3a2e', hair: '#2ec4b6', skin: '#f3d2bc', long: true, glasses: true, hairstyle: 'side', outfit: 'crop', eyes: '#1a8f84' }),
  tl: f('Rin', { personality: 'calm', style: 'normal', shirt: '#22a68e', pants: '#1d2330', hair: '#1d3557', skin: '#e8b994', long: false, glasses: false, hairstyle: 'short', outfit: 'jacket', eyes: '#3a6ea5' }),
};
/** The visiting specialists and the default expert, in the anime cast. */
export const ANIME_VISITORS = {
  devops: f('Natsuki', { personality: 'calm', style: 'normal', shirt: '#118ab2', pants: '#26313a', hair: '#f7d070', skin: '#d9a273', long: true, glasses: false, hairstyle: 'ponytail', outfit: 'jacket', eyes: '#2a9d8f' }),
  security: f('Hikari', { personality: 'focused', style: 'normal', shirt: '#22223a', pants: '#14141f', hair: '#151515', skin: '#f0d3c0', long: true, glasses: true, hairstyle: 'wavy', outfit: 'suit', eyes: '#c0392b' }),
};
export const ANIME_EXPERT = f('Mio', { personality: 'calm', style: 'teacher', shirt: '#8e7dbe', pants: '#2b2d42', hair: '#7a4a2a', skin: '#f3d2bc', long: true, glasses: true, hairstyle: 'braid', outfit: 'sweater', eyes: '#7a4a2a' });
/** The people of the shared floors (floors.js), in the anime cast: the executive floor and the archive. */
export const ANIME_FLOORS = {
  coo: f('Ayame', { shirt: '#264653', pants: '#1d2a33', hair: '#3b2a5c', skin: '#f2cdb4', long: true, hairstyle: 'bun', outfit: 'suit', eyes: '#6a4c93' }),
  cto: f('Kyoko', { shirt: '#3a86ff', pants: '#222b3a', hair: '#1b1b2f', skin: '#c98e62', long: true, glasses: true, hairstyle: 'hime', outfit: 'turtleneck', eyes: '#3a86ff' }),
  assistant: f('Emi', { shirt: '#e9c46a', pants: '#3a3a48', hair: '#f28482', skin: '#fde2d0', long: true, hairstyle: 'twintails', outfit: 'blouse', eyes: '#e05a6a' }),
  archivist: f('Haruka', { shirt: '#9b5de5', pants: '#2e2a3d', hair: '#d9d9e6', skin: '#f0c8a8', long: true, glasses: true, hairstyle: 'braid', outfit: 'sweater', eyes: '#7b5ea7' }),
  skills: f('Momo', { shirt: '#06a77d', pants: '#22302b', hair: '#ff9ec7', skin: '#f6d8c4', long: false, hairstyle: 'bob', outfit: 'crop', eyes: '#e0607e' }),
  connectors: f('Sora', { shirt: '#f15bb5', pants: '#2b2d42', hair: '#4cc9f0', skin: '#8d5a3b', long: true, hairstyle: 'side', outfit: 'jacket', eyes: '#4cc9f0' }),
};

const hash = (s) => [...String(s ?? '')].reduce((h, ch) => ((h * 31) + ch.charCodeAt(0)) >>> 0, 7);

/**
 * How a person is drawn in the anime theme: { hairstyle, outfit, eyes }. From their cast entry (by role or
 * by the floor person's id), otherwise chosen from their id (a newcomer, an expert): always the same one.
 * A short-haired look without a cast style gets a short style.
 */
export function animeStyle(id, cfg = {}) {
  const cast = ANIME_TEAM[id] || ANIME_VISITORS[id] || ANIME_FLOORS[id] || (id === 'sme' ? ANIME_EXPERT : null);
  const h = hash(id);
  const shortOnes = ['bob', 'short'];
  const longOnes = HAIRSTYLES.filter((x) => !shortOnes.includes(x));
  // a look may say its own hair style and outfit; otherwise its cast entry's, or a fixed one from its id
  if (HAIRSTYLES.includes(cfg.hairstyle) && OUTFITS.includes(cfg.outfit)) return { hairstyle: cfg.hairstyle, outfit: cfg.outfit, eyes: cfg.eyes || cast?.eyes || null };
  let hairstyle = HAIRSTYLES.includes(cfg.hairstyle) ? cfg.hairstyle : cast?.hairstyle || (cfg.long === false ? shortOnes[h % 2] : longOnes[h % longOnes.length]);
  // the look says short hair, and the style is a long one (or the other way round): the look wins
  if (cfg.long === false && !shortOnes.includes(hairstyle)) hairstyle = shortOnes[h % 2];
  if (cfg.long === true && shortOnes.includes(hairstyle)) hairstyle = longOnes[h % longOnes.length];
  const outfit = OUTFITS.includes(cfg.outfit) ? cfg.outfit : cast?.outfit || OUTFITS[(h >>> 3) % OUTFITS.length];
  return { hairstyle, outfit, eyes: cfg.eyes || cast?.eyes || null };
}
