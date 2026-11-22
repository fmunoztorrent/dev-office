// A 3D renderer of the office, in plain WebGL (no library): the example of another graphics engine plugged
// in through the renderer SDK (public/sdk/index.js). The world's rooms, walls and furniture (scene.world)
// become lit blocks built once; every frame the people become blocks too (legs, body, head and hair in
// their colors), with the light of the hour. It has two cameras, `orbit` (a perspective from the front
// that sways slowly) and `top` (from above), and no pick of its own: it says where the world lands on its
// canvas (project) and where the pointer is on the floor (toWorld), and the SDK finds what is there, so the
// game's clicks (people, the whiteboard, the rack, the rug, the elevator) work as in the pixel-art views.
// Open the game with `?renderer=blocks`.
//
// World → GL: X = x, Y = height (z), Z = y (depth, towards the front), in world units.

import { registerRenderer, peopleOf } from '../sdk/index.js';

const COLOR = {
  desk: '#a0703f', hotdesk: '#b48450', whiteboard: '#f4f6f8', clock: '#e9ecef', alarm: '#d62828', sign: '#1b1f33', tv: '#23263a',
  sofa: '#2c5470', rack: '#3a3f58', extinguisher: '#d62828', table: '#8c5a33', rug: '#7f6a8c', plant: '#2a9d8f', counter: '#6d4c41',
  fridge: '#cfd8dc', espresso: '#455a64', planter: '#52796f', stall: '#adb5bd', sink: '#e0e0e0', cooler: '#90caf9', elevator: '#8d99ae',
};
const ROOM = { office: '#e9ecef', cafe: '#d7b98e', dining: '#efe1c6', hall: '#5c677d', bathroom: '#dfe7ef' };
const rgb = (hex) => { const n = parseInt(String(hex || '#8d99ae').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

const VS = `
attribute vec3 pos; attribute vec3 nor; attribute vec3 col;
uniform mat4 vp; uniform float night;
varying vec3 v;
void main() {
  vec3 sun = normalize(vec3(-0.45, 0.85, 0.55));
  float lit = 0.5 + 0.5 * max(dot(nor, sun), 0.0);
  v = col * lit * mix(1.0, 0.42, night) + vec3(0.02, 0.03, 0.08) * night;
  gl_Position = vp * vec4(pos, 1.0);
}`;
const FS = `precision mediump float; varying vec3 v; void main() { gl_FragColor = vec4(v, 1.0); }`;

// ---------------------------------------------------------------- 4×4 matrices (column-major, like GL)

const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const perspective = (fov, aspect, near, far) => {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
};
const lookAt = (eye, at, up = [0, 1, 0]) => {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
};
const invert = (m) => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
};
const transform = (m, [x, y, z, w = 1]) => [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w);

/** A block of the world (x0..x1 × y0..y1 on the floor, z0..z1 up) as 36 vertices: position, normal, color. */
function block(out, x0, x1, y0, y1, z0, z1, color) {
  const c = rgb(color);
  const face = (n, pts) => { for (const i of [0, 1, 2, 0, 2, 3]) out.push(...pts[i], ...n, ...c); };
  // (GL: X = x, Y = z, Z = y)
  face([0, 1, 0], [[x0, z1, y0], [x0, z1, y1], [x1, z1, y1], [x1, z1, y0]]);
  face([0, -1, 0], [[x0, z0, y0], [x1, z0, y0], [x1, z0, y1], [x0, z0, y1]]);
  face([0, 0, 1], [[x0, z0, y1], [x1, z0, y1], [x1, z1, y1], [x0, z1, y1]]);
  face([0, 0, -1], [[x1, z0, y0], [x0, z0, y0], [x0, z1, y0], [x1, z1, y0]]);
  face([1, 0, 0], [[x1, z0, y1], [x1, z0, y0], [x1, z1, y0], [x1, z1, y1]]);
  face([-1, 0, 0], [[x0, z0, y0], [x0, z0, y1], [x0, z1, y1], [x0, z1, y0]]);
}

/** The world that does not move, as blocks: the rooms' floors, the back wall with its glass, the furniture. */
function worldBlocks(world) {
  const out = [];
  const { bounds, units } = world;
  for (const r of world.rooms) block(out, r.x0, r.x1, r.y0, r.y1, -4, 0, ROOM[r.id] || '#ced4da');
  const back = Math.min(...world.rooms.map((r) => r.y0));
  block(out, bounds.x0, bounds.x1, back - 6, back, 0, units.wallHeight, '#3a4060');
  for (const g of world.windows) block(out, g.x0, g.x1, back - 7, back - 5, 14, units.wallHeight - 10, '#8ecae6');
  for (const p of world.props) {
    let z0 = 0, z1 = Math.max(1, p.h), y0 = p.y - p.d / 2, y1 = p.y + p.d / 2;
    // on the back wall (the clock, the sign): at their height on it; on the ceiling (the alarm)
    if (p.wall === 'back') { z1 = units.wallHeight - (p.top || 0); z0 = z1 - p.h; y0 = back; y1 = back + 3; }
    if (p.ceiling) { z0 = units.wallHeight - p.h; z1 = units.wallHeight; y0 = back; y1 = back + p.d; }
    block(out, p.x - p.w / 2, p.x + p.w / 2, y0, y1, z0, z1, COLOR[p.kind]);
  }
  return out;
}

/** A person as blocks: legs, body, head, hair (and over the selected one, a green diamond). */
function personBlocks(out, a, selected, t) {
  const c = a.cfg || {}, sit = a.seated || a.perch;
  const bob = a.walking ? Math.abs(Math.sin(t / 90)) * 2 : 0;
  const x = a.x, y = a.y, base = (sit ? 12 : 0) + bob;
  if (!sit) block(out, x - 6, x + 6, y - 4, y + 4, 0, 22 + bob, c.pants || '#3d405b');
  block(out, x - 9, x + 9, y - 5, y + 5, base + 20, base + 44, c.shirt || '#8d99ae');
  block(out, x - 7, x + 7, y - 6, y + 6, base + 44, base + 58, c.skin || '#f1c27d');
  block(out, x - 7.5, x + 7.5, y - 6.5, y + (c.long ? 7 : 2), base + 56, base + 62, c.hair || '#2b2d42');
  if (a.id === selected) block(out, x - 3, x + 3, y - 3, y + 3, base + 74, base + 80, '#06d6a0');
}

registerRenderer({
  id: 'blocks',
  label: '3D (WebGL)',
  sdk: 1,
  views: ['orbit', 'top'],
  create(host) {
    const { canvas, world } = host;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('the blocks renderer needs WebGL');
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    const loc = { pos: gl.getAttribLocation(program, 'pos'), nor: gl.getAttribLocation(program, 'nor'), col: gl.getAttribLocation(program, 'col'), vp: gl.getUniformLocation(program, 'vp'), night: gl.getUniformLocation(program, 'night') };
    const stat = gl.createBuffer(), live = gl.createBuffer();
    const still = new Float32Array(worldBlocks(world));
    gl.bindBuffer(gl.ARRAY_BUFFER, stat);
    gl.bufferData(gl.ARRAY_BUFFER, still, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);

    let view = host.view === 'top' ? 'top' : 'orbit';
    let vp = null, inv = null;
    const { bounds } = world;
    const center = [(bounds.x0 + bounds.x1) / 2, 0, (bounds.y0 + bounds.y1) / 2 + 40];
    /** The camera of this moment (the orbit sways a little: the scene's clock). */
    function camera(t) {
      const aspect = canvas.width / Math.max(1, canvas.height);
      const eye = view === 'top'
        ? [center[0], 1450, center[2] + 260]
        : [center[0] + Math.sin(t / 9000) * 260, 760, center[2] + 1050];
      vp = mul(perspective(0.78, aspect, 20, 6000), lookAt(eye, center));
      inv = invert(vp);
    }
    camera(0);
    const draw = (buffer, count) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = 9 * 4;
      for (const [k, off] of [['pos', 0], ['nor', 12], ['col', 24]]) { gl.enableVertexAttribArray(loc[k]); gl.vertexAttribPointer(loc[k], 3, gl.FLOAT, false, stride, off); }
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };

    return {
      draw(scene) {
        camera(scene.t);
        const night = Math.max(0, Math.min(1, scene.light?.night ?? 0));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.55 - 0.5 * night, 0.72 - 0.64 * night, 0.86 - 0.7 * night, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniformMatrix4fv(loc.vp, false, new Float32Array(vp));
        gl.uniform1f(loc.night, night);
        draw(stat, still.length / 9);
        const people = [];
        for (const a of peopleOf(scene)) if (a.pose !== 'hidden' && !a.gone && a.fade > 0.3) personBlocks(people, a, scene.selected, scene.t);
        if (people.length) {
          gl.bindBuffer(gl.ARRAY_BUFFER, live);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(people), gl.DYNAMIC_DRAW);
          draw(live, people.length / 9);
        }
      },
      resize(width, height, pixelRatio) {
        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
      },
      // where a point of the world lands on the canvas: through the camera (null behind it)
      project(x, y, z = 0) {
        const [cx, cy, , cw] = transform(vp, [x, z, y, 1]);
        if (cw <= 0) return null;
        return { x: (cx / cw + 1) / 2, y: (1 - cy / cw) / 2 };
      },
      // the point of the floor under the pointer: the ray through it, where it meets the floor
      toWorld(fx, fy) {
        if (!inv) return null;
        const nx = fx * 2 - 1, ny = 1 - fy * 2;
        const near = transform(inv, [nx, ny, -1, 1]), far = transform(inv, [nx, ny, 1, 1]);
        const p = near.map((v) => v / near[3]), q = far.map((v) => v / far[3]);
        const k = p[1] / (p[1] - q[1]);
        if (!Number.isFinite(k) || k < 0) return null;
        return { x: p[0] + (q[0] - p[0]) * k, y: p[2] + (q[2] - p[2]) * k };
      },
      setView(v) { view = v === 'top' ? 'top' : 'orbit'; },
      dispose() { gl.deleteBuffer(stat); gl.deleteBuffer(live); gl.deleteProgram(program); },
    };
  },
});
