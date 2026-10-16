// El sprite de un personaje, de pie y quieto (el mismo de la oficina, game.js), para retratos:
// la ficha del seleccionado y ⚙ Ajustes › Personajes.
export function drawSprite(canvas, c, { P = 4, bg = '#c9b48a' } = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = 16 * P; canvas.height = 25 * P;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ox = 8 * P, oy = 24 * P;
  const px = (gx, gy, gw, gh, col) => { ctx.fillStyle = col; ctx.fillRect(ox + gx * P, oy + gy * P, gw * P, gh * P); };
  px(-3, -6, 2, 6, c.pants); px(1, -6, 2, 6, c.pants); px(-3, -1, 2, 1, '#222'); px(1, -1, 2, 1, '#222');
  px(-4, -13, 8, 7, c.shirt); px(-6, -13, 2, 6, c.shirt); px(-6, -7, 2, 1, c.skin); px(4, -13, 2, 6, c.shirt); px(4, -7, 2, 1, c.skin);
  px(-1, -14, 2, 1, c.skin); px(-3, -20, 6, 6, c.skin);
  px(-3, -21, 6, 2, c.hair); px(-4, -20, 1, 3, c.hair); px(3, -20, 1, 3, c.hair);
  if (c.long) { px(-4, -18, 1, 5, c.hair); px(3, -18, 1, 5, c.hair); }
  if (c.beard) px(-3, -15, 6, 1, c.hair);
  if (c.glasses) px(-3, -18, 6, 1, '#cfe8ff');
  px(-2, -18, 1, 1, '#1a1a1a'); px(1, -18, 1, 1, '#1a1a1a');
  if (c.glasses) px(-3, -19, 6, 1, '#2b2b2b');
  px(-1, -16, 2, 1, '#7a2e2e');
}
