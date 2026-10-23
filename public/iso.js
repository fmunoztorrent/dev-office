// The office's isometric (2:1) camera. The world is the same as in sim.js (x across, y in depth
// from the back wall, at y = BACK); the camera looks at it from the front-right corner: the floor
// is a rhombus, x goes down to the right and depth goes down to the left. Heights (z) are in the
// same pixels the flat view uses to draw upwards.
//
// Everything the flat view draws is reused with an affine canvas transform:
//   floor(z)            a horizontal plane at height z (the floor, a table top)
//   front(D, G, lift)   a vertical plane parallel to the back wall, at depth D: what the flat view
//                       draws standing on line G (facing us) lands on that plane, raised by `lift`
//                       (the wall, the front of a desk, the whiteboard)
//   billboard(...)      a sprite facing the camera, standing on a point of the floor (the people)
// Matrices are [a, b, c, d, e, f] like ctx.setTransform's.

export const BACK = 126;        // the line where the back wall meets the floor
export const WALL_H = 126;      // the height of the walls (the flat view's)

export function isoCamera({ k = 0.6, kz = 0.6, sprite = 2 / 3, ox = 334, oy = 114, back = BACK } = {}) {
  /** A world point (x, y on the floor; z upwards) on the screen. */
  const proj = (x, y, z = 0) => [ox + (x - (y - back)) * k, oy + (x + (y - back)) * 0.5 * k - z * kz];
  const floor = (z = 0) => [k, 0.5 * k, -k, 0.5 * k, ox + back * k, oy - back * 0.5 * k - z * kz];
  const front = (D, G = D, lift = 0) => {
    const [x0, y0] = proj(0, D, lift);
    return [k, 0.5 * k, 0, kz, x0, y0 - G * kz];
  };
  /** The sprite the flat view draws with its feet at (fx, fy), standing at (x, y, z) and at scale s. */
  const billboard = (fx, fy, x, y, z = 0, s = sprite) => {
    const [X, Y] = proj(x, y, z);
    return [s, 0, 0, s, X - fx * s, Y - fy * s];
  };
  /** Depth for sorting: what is further forward (lower on screen) is drawn later. */
  const depth = (x, y) => x + y;
  return { k, kz, sprite, ox, oy, back, proj, floor, front, billboard, depth };
}

/** Applies a matrix to a point. */
export function apply([a, b, c, d, e, f], x, y) {
  return [a * x + c * y + e, b * x + d * y + f];
}

/** The point (of the flat view) that a matrix maps to (X, Y) on the screen. */
export function unapply([a, b, c, d, e, f], X, Y) {
  const det = a * d - b * c;
  const x = X - e, y = Y - f;
  return [(d * x - c * y) / det, (a * y - b * x) / det];
}

/** Multiplies: first m, then the canvas scale. */
export const scaled = (m, s) => m.map((v) => v * s);
