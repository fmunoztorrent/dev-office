// Terminal framebuffer: a pixel layer (2 per cell, with "▀" and foreground/background
// colors) and a text layer on top. flush() only rewrites the cells that changed.

const ESC = '\x1b[';

export function detectColorMode(env = process.env) {
  const ct = (env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  if (['iTerm.app', 'WezTerm', 'ghostty', 'vscode', 'Hyper', 'Tabby', 'WarpTerminal', 'rio'].includes(env.TERM_PROGRAM)) return 'truecolor';
  if (/kitty|ghostty|alacritty|direct|wezterm|foot/.test(env.TERM || '')) return 'truecolor';
  return '256';
}

const hexCache = new Map();
/** '#rrggbb' | '#rgb' → 0xRRGGBB */
export function hex(c) {
  let v = hexCache.get(c);
  if (v === undefined) {
    let h = c.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    v = parseInt(h.slice(0, 6), 16);
    hexCache.set(c, v);
  }
  return v;
}

export function mix(a, b, t) {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const cache256 = new Map();
function to256(rgb) {
  let v = cache256.get(rgb);
  if (v !== undefined) return v;
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  const q = (x) => (x < 48 ? 0 : x < 115 ? 1 : Math.floor((x - 35) / 40));
  const lv = [0, 95, 135, 175, 215, 255];
  const [qr, qg, qb] = [q(r), q(g), q(b)];
  const cube = 16 + 36 * qr + 6 * qg + qb;
  const dc = (lv[qr] - r) ** 2 + (lv[qg] - g) ** 2 + (lv[qb] - b) ** 2;
  const avg = (r + g + b) / 3;
  const gi = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const gv = 8 + gi * 10;
  const dg = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  v = dg < dc ? 232 + gi : cube;
  cache256.set(rgb, v);
  return v;
}

// Emoji and symbols that terminals draw with two columns.
const WIDE_BMP = new Set([0x231a, 0x231b, 0x23e9, 0x23ea, 0x23eb, 0x23ec, 0x23f0, 0x23f3, 0x25fd, 0x25fe, 0x2614, 0x2615,
  0x267f, 0x2693, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5,
  0x26fa, 0x26fd, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797,
  0x27b0, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55]);
for (let cp = 0x2648; cp <= 0x2653; cp++) WIDE_BMP.add(cp);

export function charWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return -1; // control: dropped
  if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d || cp === 0x200b || (cp >= 0x300 && cp <= 0x36f)) return 0;
  if (cp >= 0x1f000 && cp <= 0x1faff) return 2;
  if (WIDE_BMP.has(cp)) return 2;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) return 2;
  return 1;
}

/** Terminal-safe text: no control sequences (the text comes from external processes). */
export function clean(text) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    const w = charWidth(ch.codePointAt(0));
    if (w > 0) out += ch;
    else if (w < 0 && (ch === '\n' || ch === '\t')) out += ' ';
  }
  return out;
}

export function strWidth(text) {
  let w = 0;
  for (const ch of text) w += Math.max(0, charWidth(ch.codePointAt(0)));
  return w;
}

/** Trims to `max` columns, with "…" if it does not fit. */
export function fit(text, max) {
  text = clean(text);
  if (max <= 0) return '';
  if (strWidth(text) <= max) return text;
  let out = '', w = 0;
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch; w += cw;
  }
  return out + '…';
}

/** Splits a text into lines of `max` columns (at most `maxLines`). */
export function wrap(text, max, maxLines = 99) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (strWidth(test) > max && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) { lines[maxLines - 1] = fit(`${lines[maxLines - 1]} ${words.slice(i).join(' ')}`, max); return lines; }
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(l, max));
}

export class Screen {
  constructor({ colorMode = 'truecolor' } = {}) {
    this.mode = colorMode;
    this.cols = 0;
    this.rows = 0;
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.px = new Int32Array(n * 2);
    this.tch = new Array(n).fill(null);
    this.tfg = new Int32Array(n);
    this.tbg = new Int32Array(n);
    this.prev = new Array(n).fill(null);
    this.full = true;
  }

  clear(color) {
    this.px.fill(color);
    this.tch.fill(null);
  }

  pset(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows * 2) return;
    this.px[y * this.cols + x] = c;
  }

  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.cols, (x + w) | 0), y1 = Math.min(this.rows * 2, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.cols + x0, yy * this.cols + Math.max(x0, x1));
  }

  /** Removes the text from the cells a pixel rectangle covers (occlusion). */
  clearText(x, y, w, h) {
    for (let r = Math.floor(y / 2); r <= Math.floor((y + h - 1) / 2); r++) {
      for (let c = x; c < x + w; c++) if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.tch[r * this.cols + c] = null;
    }
  }

  /** Writes text at (col, row). bg = -1 lets the background pixels show through. Returns the columns used. */
  text(col, row, str, fg, bg = -1, maxCols = Infinity) {
    if (row < 0 || row >= this.rows) return 0;
    let c = col;
    const end = Math.min(this.cols, col + maxCols);
    for (const ch of clean(str)) {
      const w = charWidth(ch.codePointAt(0));
      if (c + w > end) break;
      if (c >= 0) {
        const i = row * this.cols + c;
        // Do not leave half a wide character hanging on either side.
        if (this.tch[i] === '' && c > 0) this.tch[i - 1] = null;
        if (w === 1 && this.tch[i + 1] === '') this.tch[i + 1] = null;
        this.tch[i] = ch; this.tfg[i] = fg; this.tbg[i] = bg;
        if (w === 2) { this.tch[i + 1] = ''; this.tfg[i + 1] = fg; this.tbg[i + 1] = bg; }
      }
      c += w;
    }
    return c - col;
  }

  fill(col, row, w, bg) {
    for (let c = col; c < col + w; c++) this.text(c, row, ' ', bg, bg);
  }

  #color(fg, bg) {
    if (this.mode === 'truecolor') {
      return `${ESC}38;2;${(fg >> 16) & 255};${(fg >> 8) & 255};${fg & 255};48;2;${(bg >> 16) & 255};${(bg >> 8) & 255};${bg & 255}m`;
    }
    return `${ESC}38;5;${to256(fg)};48;5;${to256(bg)}m`;
  }

  /** Returns the sequences that bring the terminal to the current frame. */
  flush() {
    const { cols, rows, px, tch, tfg, tbg, prev } = this;
    let out = this.full ? `${ESC}0m${ESC}2J` : '';
    let cursor = -1, lastFg = -2, lastBg = -2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const top = px[(2 * r) * cols + c], bot = px[(2 * r + 1) * cols + c];
        let ch, fg, bg;
        if (tch[i] !== null) {
          ch = tch[i]; fg = tfg[i]; bg = tbg[i] >= 0 ? tbg[i] : bot;
        } else if (top === bot) {
          ch = ' '; fg = top; bg = top;
        } else {
          ch = '▀'; fg = top; bg = bot;
        }
        const key = `${ch}\u0000${fg}\u0000${bg}`;
        if (!this.full && prev[i] === key) continue;
        prev[i] = key;
        if (ch === '') continue; // second column of a wide character
        if (cursor !== i) out += `${ESC}${r + 1};${c + 1}H`;
        if (fg !== lastFg || bg !== lastBg) { out += this.#color(fg, bg); lastFg = fg; lastBg = bg; }
        out += ch;
        cursor = i + Math.max(1, charWidth(ch.codePointAt(0)));
        if (cursor % cols === 0) cursor = -1; // at the end of the line the cursor position is not reliable
      }
    }
    this.full = false;
    return out;
  }
}
