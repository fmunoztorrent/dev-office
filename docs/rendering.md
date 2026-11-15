# Rendering: the scene and its renderers

The game and what draws it are two separate layers:

```
events ─► public/sim.js ─► buildScene() ─► scene ─► renderer ─► pixels / characters / polygons
          (what happens)   public/scene.js  (data)   canvas 2D (front, top-down) · terminal · plan · a 3D one…
```

- **The simulation** (`public/sim.js`) decides what happens: who walks where, who sits, who talks, who comes up by the elevator, the fire, lunch, the weather. It knows nothing about pixels.
- **The scene** (`public/scene.js`) is what the simulation says must be on screen in a frame, as **plain data**: no methods and no references to the simulation's objects. It can be sent over the network, saved or compared in a test.
- **A renderer** draws a scene, and only the scene. The browser's canvas (front view `flat` and isometric top-down `iso`, `public/game.js`) and the terminal (`tui/view.js`) are renderers of the same scene; `test/scene.test.js` checks they do not read the simulation.

There is no 3D renderer: the game is ready for one. This page is the contract it would draw from.

## The scene

`buildScene(sim, { now, floor, selected, hover, services })` → one frame:

| Field | What it is |
|---|---|
| `v` | The contract's version (`SCENE_VERSION`, now `1`). A field is added without changing it; one that changes meaning bumps it |
| `t` | The simulation's clock (ms): the time base of everything with an `until` (bubbles, jumps, dreams, badges) |
| `floor` | The floor being watched: `office` (this scene), `exec` or `archive` (those two still draw from their own model, `public/floors.js`) |
| `world` | The world that does not move (below). The same object every frame |
| `date`, `zone` | The office's date and time, in its time zone (a Date-like object) |
| `weather`, `light`, `season` | The weather outside (`{ kind, temp, … }`), the light it gives (`{ night, … }`, from `daylight()`) and the season |
| `team` | The team, by role (`po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`): one **actor** each |
| `visitors` | Whoever came: newcomers (a subagent), visiting specialists (DevOps, security) and experts (SME). Actors too |
| `turn` | `{ role, phase }`: who is on duty and in which phase (▶ RED over their head) |
| `board` | The whiteboard: `{ title, todos: [{ id, content, status }], status, source }` |
| `banner` | The banner at the bottom: `{ text, tone, until }` or `null` |
| `fire`, `extinguisher`, `heat` | The server rack's fire (`{ phase, … }` or `null`), where the extinguisher is, how hot the rack runs (0–1.3) |
| `bath`, `elevator` | Which stalls are taken (`stalls: [id \| null]`) and when each door opened; when the elevator's doors opened (`doorAt`) and its floor |
| `particles` | Confetti, smoke, foam, drops, emotes: `{ x, y, kind, color, vx, vy, life, … }` |
| `lunch`, `news` | Whether it is lunchtime; the latest thing that happened, in words (the TV's ticker) |
| `services` | The services the agents left running (`{ id, status, name }`): the rack's lights |
| `selected`, `hover` | The viewer's: who is selected (the green diamond) and who is under the pointer |

### An actor

| Field | What it is |
|---|---|
| `id`, `role`, `kind` | Who: `kind` is `team`, `newcomer`, `visitor` or `expert` |
| `cfg` | Their card: `name`, `title`, `sex`, `shirt`, `pants`, `hair`, `skin` (colors `#rrggbb`), `long`, `beard`, `glasses`, `prop` (what is on their desk) and `seat` (their chair: `{ x, y }`) |
| `x`, `y` | Where their feet are, on the floor (seated: their chair) |
| `pose` | `stand`, `walk`, `sit`, `perch` (on a chair that is not theirs: lunch), `back` (from behind: on the sofa) or `hidden` (in the bathroom) |
| `face`, `sideways` | Which way they look (`-1` left, `1` right) and whether they walk sideways |
| `walking`, `walkT`, `gait` | The walk's details: its time and this frame's step (`{ frame, reach, lift, bob, swing }`, or `null`) |
| `seated`, `perch`, `back`, `hidden` | The pose's flags (the 2D renderers use them as they are; `pose` sums them up) |
| `state`, `text` | What they are doing (`idle`, `working`, `thinking`, `talking`, `blocked`, `waiting`, `done`, `coffee`, `red`, `alarm`) and in words |
| `taskAt` | The last time they did real work (their screen stays on a while) |
| `jumpUntil`, `shakeUntil`, `dance`, `handUp` | A jump, shaking, dancing (waiting for the bathroom), a hand up (they have a question for you) |
| `carry`, `food`, `diningSeat` | What they carry (`true`: a card; `'ext'`: the extinguisher), what they eat, where they have lunch |
| `bubble`, `tag`, `badge` | What they say (`{ text, until, … }`), what their agent is doing (`{ text, until }`) and that badge if it is current (`🎓 pci-dss`, `✏️ cart.js`) |
| `dream`, `subagents` | What they imagine (`{ kind, start, until }`), how many subagents they have assigned |
| `ghost`, `specialist`, `expert`, `fade`, `leaving`, `gone`, `desk`, `project`, `session` | For the ones who come and go: how visible (`fade` 0–1), whether they are a person (`specialist`), which expert (`expert`: their id), their hot desk (`-1`: the meeting table), the project and session they came for |

## The world

`WORLD` (also `scene.world`) is frozen and does not change between frames:

| Field | What it is |
|---|---|
| `units` | `perMeter` (36 world units are a meter: a person is about 1.7 m) and `wallHeight` |
| `bounds` | `{ x0, x1, y0, y1 }`: the floor plane, from the bathroom on the left (`x0 < 0`) to the dining room (`x1`), from the back wall (`y0`) to the front (`y1`) |
| `rooms` | `office`, `cafe`, `dining`, `hall`, `bathroom`: rectangles of floor |
| `doors` | The office's (to the hall), the bathroom's, the dining room's and the elevator's (on the back wall) |
| `windows` | The back wall's glass: the city, the sky and the weather behind it |
| `props` | The furniture: `{ id, kind, x, y, w, d, h, … }` — the middle of its footprint on the floor, its footprint and its height. A desk per character (`owner`), the hot desks (`index`), the whiteboard (`face`: its writable part), the clock, the alarm, the sign, the TV, the sofa (`seats`), the rack, the extinguisher, the meeting table, the plants, the café's counter, fridge and espresso machine, the high table, the dining table (`seats`), the planters, the stalls, the sink, the water cooler and the elevator |
| `spots` | Where people go: `board`, `coffee`, `table`, `sofa`, `elevator` |

**Coordinates:** the floor is `x` (left → right) by `y` (back → front), in world units. A 3D renderer maps them to its own space, for example `X = x`, `Z = y`, `Y` = height (`h`, `wallHeight`, a person's ≈ 63 units), dividing by `perMeter` to work in meters.

## Writing a renderer

A renderer is `{ id, label, create(canvas, options) → instance }`, registered in `public/renderers.js`:

```js
import { registerRenderer } from './renderers.js';
import { peopleOf } from './scene.js';

registerRenderer({
  id: 'three',
  label: '3D',
  create(canvas) {
    // a canvas of its own: ask it for WebGL; build the world once from scene.world
    return {
      draw(scene) { /* each frame: place peopleOf(scene) and draw */ },
      resize(width, height) { /* the canvas changed size */ },
      pick(fx, fy) { /* what is at that point (fractions 0..1): { person: id } | { what: 'board' } | null */ },
      dispose() {},
    };
  },
});
```

Import it from `public/main.js` (as `public/renderers/plan.js` is) and open the game with `?renderer=three`. The game keeps its HUD, its dialogs and its clicks: it copies the renderer's canvas onto its own every frame and asks it what is under the pointer (`pick`).

**`public/renderers/plan.js`** is the reference: a plain top-down plan of the office drawn only from the scene — the rooms, doors and furniture of `world`, each person as a dot of their shirt's color with their name, what they say and their badge, the whiteboard's task and the time of day. Open the game with `?renderer=plan`. A new renderer can start from it.

## Themes

How the people look is a theme (`prefs.theme`, public/themes.js): the pixel art one, or the anime one, whose actors the front and top-down views draw with vector strokes (`public/anime.js`, `drawAnime(ctx, actor, now, { x, y })`, about `ANIME_HEIGHT` tall). A theme changes nothing in the scene but who its actors are (their `cfg`: the anime cast, all women) and how a renderer draws them: a 3D renderer can read the same `cfg` and `animeStyle(role, cfg)` (hair style, outfit, eyes) to dress its models.

## What is left out

- The two shared floors (the executive one and the archive, `public/floors.js`) still draw from their own model: they are not in the scene yet.
- The text and the HUD (the log, the dialogs, the context bar) are the page's, not a renderer's.
