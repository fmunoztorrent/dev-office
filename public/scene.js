// The scene: the layer between what the game decides (public/sim.js: who is where, what they do, what
// happens in the office) and what a graphics engine draws. Each frame, `buildScene(sim)` turns the
// simulation into plain data (no methods, no references to the simulation's objects: it could go over
// the network or be saved) and every renderer draws only from it:
//
//   - the canvas one in the browser (public/game.js), front view (`flat`) or isometric top-down (`iso`);
//   - the terminal one (tui/view.js), with half blocks;
//   - the reference one (public/renderers/plan.js): a plain top-down plan, to check the contract and to
//     start a new renderer from (open the game with `?renderer=plan`);
//   - whatever comes next (a 3D one): it registers itself with the renderer SDK (public/sdk/index.js) and
//     reads the same scene.
//
// Coordinates: the floor plane is x (left → right, LEFT..W) by y (back wall → front, 0..H), in world units
// (WORLD.units.perMeter of them make a meter); height goes up from the floor. A person's (x, y) is where
// their feet are; seated, it is their chair. Times (bubbles, jumps, dreams) are in the simulation's clock,
// the same as `scene.t`.
//
// The contract is versioned (SCENE_VERSION): a field is added without breaking anyone; one that changes
// meaning gets a new version. Its types are in public/sdk/index.d.ts and docs/rendering.md describes it.

import {
  W, H, LEFT, TEAM, BOARD, EASEL, CLOCK, GLASS, TV, SOFA, RACK, EXTINGUISHER, SPOT, PLANTS, HOT_DESKS, HALL, OFFICE_DOOR,
  ELEVATOR, BATHROOM, CAFE, DINING, DINING_SEATS, PARTITION, ALARM, SIGN, daylight, gait,
} from './sim.js';
// (the props' `action` is what clicking them does: the SDK's actionOf, public/sdk/index.js)
import { season } from './sky.js';

export const SCENE_VERSION = 1;

/** A person, as a renderer needs them: who, how they look, where, in what pose and what shows over them. */
function actorOf(a, kind) {
  const c = a.cfg || {};
  const pose = a.hidden ? 'hidden' : a.back ? 'back' : a.walking ? 'walk' : a.seated ? 'sit' : a.perch ? 'perch' : 'stand';
  return {
    id: a.id, kind, role: a.role || a.id, pose,
    // the character's card: name, title, look and their desk
    cfg: {
      name: c.name, title: c.title, sex: c.sex, shirt: c.shirt, pants: c.pants, hair: c.hair, skin: c.skin,
      long: !!c.long, beard: !!c.beard, glasses: !!c.glasses, prop: c.prop || null, seat: c.seat ? { x: c.seat.x, y: c.seat.y } : null,
    },
    x: a.x, y: a.y, face: a.face || 1, sideways: a.sideways !== false,
    // the pose's details (the 2D renderers use them as they are; `pose` sums them up)
    walking: !!a.walking, walkT: a.walkT || 0, seated: !!a.seated, perch: !!a.perch, back: !!a.back, hidden: !!a.hidden,
    gait: a.walking ? gait(a) : null,
    state: a.state, text: a.text || '', taskAt: a.taskAt ?? -Infinity,
    // what they do with their body: a jump (until), shaking (until), dancing (waiting for the bathroom), a hand up
    jumpUntil: a.jumpUntil || 0, shakeUntil: a.shakeUntil || 0, dance: !!a.dance, handUp: !!a.handUp,
    carry: a.carry || false, food: a.food || null, diningSeat: a.diningSeat ? { ...a.diningSeat } : null,
    // over their head: what they say, what their agent is doing (the badge), what they imagine
    bubble: a.bubble ? { ...a.bubble } : null, tag: a.tag ? { text: a.tag.text, until: a.tag.until } : null, badge: a.badge || null,
    dream: a.dream ? { ...a.dream } : null, subagents: a.badges?.size || 0,
    // the ones who come and go (newcomers, visiting specialists, experts): how visible, their desk, why they came
    ghost: !!a.ghost, specialist: !!a.specialist, expert: a.expert || null, fade: a.ghost ? a.fade : 1,
    leaving: !!a.leaving, gone: !!a.gone, desk: a.ghost ? a.desk : -1, project: a.project || '', session: a.session || null,
  };
}

const box = (id, kind, x, y, w, d, h, extra = {}) => ({ id, kind, x, y, w, d, h, ...extra });

/**
 * The world that does not move: its rooms, walls, doors, windows, furniture and the named spots people
 * walk to. Each prop: { id, kind, x, y (the middle of its footprint, on the floor), w, d (its footprint),
 * h (its height) }, in world units, and `action` if clicking it does something (select its owner, the
 * whiteboard, the services, the elevator, the rug).
 */
export const WORLD = Object.freeze({
  units: { perMeter: 36, wallHeight: 122, personHeight: 63 },
  bounds: { x0: LEFT, x1: W, y0: 0, y1: H },
  rooms: [
    { id: 'office', x0: 0, x1: CAFE.x - 6, y0: 122, y1: H },
    { id: 'cafe', x0: CAFE.x - 6, x1: W, y0: 122, y1: DINING.top },
    { id: 'dining', x0: CAFE.x - 6, x1: W, y0: DINING.top + 14, y1: H },
    { id: 'hall', x0: HALL.x0, x1: HALL.x1, y0: 122, y1: H },
    { id: 'bathroom', x0: BATHROOM.x0, x1: BATHROOM.x1, y0: 122, y1: BATHROOM.front },
  ],
  doors: [
    { id: 'office', between: ['hall', 'office'], x: HALL.x1 + 4, y0: OFFICE_DOOR.y0, y1: OFFICE_DOOR.y1 },
    { id: 'bathroom', between: ['bathroom', 'hall'], x: BATHROOM.x1 + 4, y0: BATHROOM.door.y0, y1: BATHROOM.door.y1 },
    { id: 'dining', between: ['cafe', 'dining'], y: DINING.top + 7, x0: DINING.door.x0, x1: DINING.door.x1 },
    { id: 'elevator', between: ['hall', 'lift'], wall: 'back', x0: ELEVATOR.x, x1: ELEVATOR.x + ELEVATOR.w },
  ],
  // the back wall is glass: the city, the sky and the weather behind it
  windows: [{ id: 'glass', wall: 'back', x0: GLASS.x0, x1: GLASS.x1, top: GLASS.top, bottom: GLASS.bottom }],
  props: [
    ...Object.entries(TEAM).map(([role, c]) => box(`desk:${role}`, 'desk', c.seat.x, c.seat.y + 6, 100, 30, 26, { owner: role, prop: c.prop || null, action: 'select' })),
    ...HOT_DESKS.map((s, i) => box(`hotdesk:${i}`, 'hotdesk', s.x, s.y + 4, 72, 26, 22, { index: i })),
    // (its writable part: `face` in the front view's pixels, `surface` in the world: the plane y, from height z0 to z1)
    box('whiteboard', 'whiteboard', BOARD.x + BOARD.w / 2, EASEL.feet, BOARD.w, 12, EASEL.feet - EASEL.top, {
      face: { x: BOARD.x, y: BOARD.y, w: BOARD.w, h: BOARD.h },
      surface: { x0: BOARD.x, x1: BOARD.x + BOARD.w, y: EASEL.feet, z0: EASEL.feet - BOARD.y - BOARD.h, z1: EASEL.feet - BOARD.y },
      action: 'board',
    }),
    box('clock', 'clock', CLOCK.x + CLOCK.w / 2, 0, CLOCK.w, 4, CLOCK.h, { wall: 'back', top: CLOCK.y }),
    box('alarm', 'alarm', ALARM.x, 0, 12, 12, 12, { ceiling: true }),
    box('sign', 'sign', SIGN.x, 0, 90, 2, 24, { wall: 'back', top: SIGN.y }),
    box('tv', 'tv', TV.x, TV.feet, TV.w, 14, TV.h + 40, { screen: { w: TV.w, h: TV.h } }),
    box('sofa', 'sofa', SOFA.x, SOFA.y + 10, 144, 40, 30, { seats: SOFA.seats.map((x) => ({ x, y: SOFA.y })) }),
    box('rack', 'rack', RACK.x + RACK.w / 2, RACK.y + RACK.h, RACK.w, 30, RACK.h, { action: 'services' }),
    box('extinguisher', 'extinguisher', EXTINGUISHER.x, EXTINGUISHER.y, 10, 10, 28),
    box('meeting-table', 'table', SPOT.table.x, SPOT.table.y, 168, 52, 24, { shape: 'oval', action: 'rug' }),
    // the rugs, flat on the floor: the meeting table's (the daily and the retro are called from it) and the living room's
    box('rug', 'rug', SPOT.table.x, SPOT.table.y + 11, 260, 126, 0, { action: 'rug' }),
    box('living-rug', 'rug', SOFA.x, (TV.feet + 586) / 2, 192, 606 - TV.feet, 0),
    ...PLANTS.map(([x, y], i) => box(`plant:${i}`, 'plant', x, y, 24, 24, 40)),
    box('counter', 'counter', CAFE.counter.x + CAFE.counter.w / 2, CAFE.counter.top + 16, CAFE.counter.w, 32, 34),
    box('fridge', 'fridge', CAFE.fridge.x + CAFE.fridge.w / 2, CAFE.fridge.y + CAFE.fridge.h, CAFE.fridge.w, 24, CAFE.fridge.h),
    box('espresso', 'espresso', CAFE.espresso.x + CAFE.espresso.w / 2, CAFE.counter.top, CAFE.espresso.w, 20, 22),
    box('bistro', 'table', CAFE.bistro.x, CAFE.bistro.y, 44, 44, 40, { shape: 'round' }),
    box('dining-table', 'table', DINING.table.x, DINING.table.y + 24, DINING.table.w, 48, 24, { seats: [...DINING_SEATS.back, ...DINING_SEATS.front].map(({ x, y, row }) => ({ x, y, row })) }),
    ...PARTITION.map(([y0, y1], i) => box(`planter:${i}`, 'planter', CAFE.x - 6, (y0 + y1) / 2, 10, y1 - y0, 30)),
    ...BATHROOM.stalls.map((s, i) => box(`stall:${i}`, 'stall', s.x, 140, s.w, 60, 100, { index: i })),
    box('sink', 'sink', BATHROOM.sink.x, BATHROOM.sink.y, BATHROOM.sink.w, 20, 34, { mirror: true }),
    box('cooler', 'cooler', -212, 476, 16, 16, 44),
    box('elevator', 'elevator', ELEVATOR.x + ELEVATOR.w / 2, 122, ELEVATOR.w, 6, 110, { action: 'lift' }),
  ],
  // where people go: the whiteboard, the coffee, the meeting table, next to the sofa, the elevator
  spots: { ...Object.fromEntries(Object.entries(SPOT).map(([k, v]) => [k, { x: v.x, y: v.y }])), elevator: { ...ELEVATOR.spot } },
});

/**
 * The scene of a frame: everything a renderer needs to draw the office being watched, as plain data.
 * @param sim     the simulation (public/sim.js)
 * @param now     the simulation's clock, now (ms)
 * @param floor   the floor being watched: 'office' (this one), 'exec' or 'archive' (those draw their own: floors.js)
 * @param extra   what the viewer adds: who is selected and hovered, what is under the pointer (a target of the
 *                SDK: { person } or { prop }), the services left running (the rack)
 */
export function buildScene(sim, { now = 0, floor = 'office', selected = null, hover = null, hovered = null, services = [] } = {}) {
  const date = sim.date();
  const weather = sim.weather;
  const team = Object.fromEntries(Object.entries(sim.agents).map(([id, a]) => [id, actorOf(a, 'team')]));
  const visitors = sim.ghosts.map((g) => actorOf(g, g.expert ? 'expert' : g.specialist ? 'visitor' : 'newcomer'));
  const bath = sim.bath;
  return {
    v: SCENE_VERSION,
    t: now,
    floor,
    world: WORLD,
    // the outside: the office's date and time (its zone), the weather, the light it gives and the season
    date, zone: sim.zone, weather, light: daylight(date, weather), season: season(date),
    // the people: the team (by role, at their desks) and whoever came (newcomers, specialists, experts)
    team, visitors,
    // who is on duty, and in which phase (▶ RED over their head)
    turn: { role: sim.turn || null, phase: sim.turnPhase || null },
    // the office's things that change
    board: sim.board ? { ...sim.board, todos: [...(sim.board.todos || [])] } : { title: '', todos: [] },
    banner: sim.banner ? { ...sim.banner } : null,
    fire: sim.fire ? { ...sim.fire } : null, extinguisher: sim.extinguisher, heat: sim.heat || 0,
    bath: { stalls: [...bath.stalls], doorAt: [...bath.doorAt] },
    elevator: { ...sim.elevator },
    particles: sim.particles.map((p) => ({ ...p })),
    lunch: !!sim.lunch,
    // the latest thing that happened in the office, in words (the TV's ticker when there is no task)
    news: sim.journal.at(-1)?.text || '',
    services: (services || []).map((s) => ({ id: s.id, status: s.status, name: s.name || '' })),
    // the viewer's: who is selected (the green diamond), who is under the pointer (or whose desk) and what is
    // hovered: { person } or { prop } (the whiteboard and the rack light up)
    selected, hover, hovered: hovered ? { ...hovered } : null,
  };
}

/** Everyone in the scene, to draw people without caring who is who. */
export const peopleOf = (scene) => [...Object.values(scene.team), ...scene.visitors];

/** A person of the scene by id: a team character or someone who came (and has not left yet). */
export const personIn = (scene, id) => scene.team[id] || scene.visitors.find((g) => g.id === id && !g.gone) || null;
