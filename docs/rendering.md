# Rendering: the renderer SDK

The game and what draws it are separate, and they only talk through the **renderer SDK** (`public/sdk/`). The game decides what happens and what a click does; a renderer turns each frame into pixels (or polygons) and says what is at a point of its canvas. Any graphics engine that keeps the contract can draw the office: the game's own pixel art, a top-down plan, a 3D scene in WebGL, or whatever comes next.

```
             the game (public/game.js: the host)
 events ──►  public/sim.js ── buildScene() ──► scene ─────── draw(scene) ──────►  renderer ──► pixels / polygons
             (who moves where,                 (plain data)                       (any engine)
              what happens)    ◄── action ◄── actionOf(target) ◄── target ◄── pick(x, y) · project · toWorld
```

- **The simulation** (`public/sim.js`) decides what happens: who walks where, who sits, who talks, who comes up by the elevator, the fire, lunch, the weather. It knows nothing about pixels.
- **The scene** (`public/scene.js`) is what must be on screen in a frame, as **plain data**: no methods and no references to the simulation's objects. It can be sent over the network, saved or compared in a test.
- **The SDK** (`public/sdk/index.js`, with its types in [`public/sdk/index.d.ts`](../public/sdk/index.d.ts)) is the contract: what a renderer is, what it gets (a host and each frame's scene), what it answers (what is under the pointer, where the world lands on its canvas), and the vocabulary for what can be clicked (targets) and what clicking does (actions).
- **A renderer** draws the scene, and only the scene. It never reads the simulation, and the game never reads a renderer's insides.
- **The host** (`createGame` in `public/game.js`) runs the simulation every frame, builds the scene, hands it to the renderer, and turns the pointer into actions through the SDK. The page (its HUD, its dialogs, the log) stays the same whatever draws.

## The renderers there are

| Id | What it is | How it answers the pointer |
|---|---|---|
| `canvas` | The game's own pixel art (`createCanvasRenderer`, `public/game.js`), in two views: front (`flat`) and isometric top-down (`iso`). Registered with the SDK like any other (`builtIn: true`); it also draws the two shared floors | Its own `pick` (people by their sprite, desks, the whiteboard, the rack, the rug, the elevator), plus `project` and `toWorld` |
| `plan` | The reference (`public/renderers/plan.js`): a plain top-down plan drawn only from the scene. Where a new renderer can start from. `?renderer=plan` | No pick: `project` and `toWorld`, and the SDK finds what is there |
| `blocks` | A 3D one in plain WebGL (`public/renderers/blocks.js`): the world and the people as lit blocks, with two cameras, `orbit` and `top` (the `v` key). `?renderer=blocks` | No pick: `project` (through its camera) and `toWorld` (a ray onto the floor) |

The terminal (`tui/view.js`) draws the same scene into a screen of characters; it is not a canvas renderer, but it follows the same rule: only the scene.

## A renderer

A renderer is a **spec**, registered with `registerRenderer(spec)`:

| Field | What it is |
|---|---|
| `id` | Lowercase letters, digits and dashes. The game draws with it when opened with `?renderer=<id>` |
| `label` | Its name, for people |
| `sdk` | The SDK it was written for (`SDK_VERSION`, now `1`). A newer one is refused with a message |
| `views` | Its views (the first is its default). The game's `v` key goes through them; the canvas's are `flat` and `iso` |
| `create(host)` | Makes an **instance** (below) |

`defineRenderer(spec)` checks a spec and says what is wrong (the id, `create`, the views, the SDK).

### The host

What `create(host)` gets:

| Field | What it is |
|---|---|
| `canvas` | A canvas of its own, laid over the game's (`.renderer-layer`, it does not take the clicks). Ask it for `2d`, `webgl` or `webgl2` |
| `width`, `height`, `pixelRatio` | The canvas's size on the page (CSS pixels) and the screen's pixel ratio. The host sizes the canvas to `width × pixelRatio` by `height × pixelRatio` before `create` |
| `view` | The view to start in: one of its `views` |
| `theme` | `pixel` or `anime`: how the people look (their `cfg`, and `animeStyle` in `public/anime.js`) |
| `world` | `WORLD`: the world that does not move (below) |
| `sdk` | The SDK's version |

### An instance

Only `draw` is required:

| Method | What it does |
|---|---|
| `draw(scene)` | Draws a frame: the scene of that frame, and nothing else. It **only reads** the scene |
| `resize(width, height, pixelRatio)` | The canvas changed size. It can size its canvas as it wants (the pixel art: a multiple of the world, so its pixels stay crisp). Without it, the host sizes the canvas |
| `pick(fx, fy)` | What is at that point of the canvas (fractions 0..1 of its width and height): a **target**, or `null` |
| `project(x, y, z)` | Where a point of the world (`x`, `y` on the floor, `z` up) lands on the canvas, in fractions; `null` if it is out of sight (behind the camera) |
| `toWorld(fx, fy)` | The point of the floor under a point of the canvas: `{ x, y }`, or `null` |
| `setView(view)` | Changes the view (one of its `views`) |
| `setTheme(theme)` | Changes the theme |
| `dispose()` | It is no longer used: free what it holds |

**Lifecycle:** `create(host)` → `resize` whenever the screen changes → `draw(scene)` every frame (while the office is on screen: the shared floors are the canvas's) → `setView` / `setTheme` when the viewer changes them → `dispose` when another renderer takes over. **A renderer that throws while drawing is dropped**, and the game goes back to its own canvas.

## What is under the pointer

The game asks the renderer about the pointer in **fractions** of the canvas, and gets a **target**: what is there, in the world's words.

- `{ person: id }`: a person of the scene (a character of the team, a newcomer, a visiting specialist, an expert);
- `{ prop: id }`: a prop of the world (`WORLD.props`).

`actionOf(target)` turns it into what the game does. The props say it themselves (`prop.action`):

| Target | Action | What the game does |
|---|---|---|
| a person, or a desk (`desk:<role>`) | `{ type: 'select', person }` | Their card (a desk is its owner's) |
| `whiteboard` | `{ type: 'board' }` | The expanded whiteboard, or a new brief |
| `rack` | `{ type: 'services' }` | The services left running |
| `elevator` | `{ type: 'lift' }` | The elevator's panel (the other floors) |
| `rug`, `meeting-table` | `{ type: 'rug' }` | The daily or the retro |

A renderer does not have to work targets out by itself. `pickWith(instance, scene, fx, fy)` (what the game uses) asks it the best way it can answer:

1. its own `pick`, if it has one;
2. otherwise, **by projection** (`pickByProjection`): with its `project`, a person whose silhouette covers the point (the one in front first), or the smallest interactive prop whose volume covers it;
3. otherwise, **on the floor** (`pickAt`): with its `toWorld`, the closest person within reach, or the smallest interactive prop whose footprint covers the point.

Whatever it answers, the game only gets a valid target or `null` (`isTarget`). And with `project` the page can place its own things over the drawing: `game.boardBox()` is where the whiteboard is (`boxOnScreen`), so the expanded whiteboard grows out of it in any renderer.

## Labels over the drawing

What people say and the badges over their heads are placed together, on the screen, so that none covers another: `layoutLabels(items, { bounds, gap, previous })` takes each label's anchor (where its tail points) and size and gives back where it goes. Each one prefers to sit centered just above its anchor; if that place is taken it goes up a row or to the side, the closest free place first, always inside the bounds. With `previous` (each label's offset in the last frame) a label keeps its place while it stays free, so nothing jumps around. The canvas places its bubbles and badges with it, in both views and on the shared floors, and glides a label when it has to move; another renderer can use the same helper with its own `project`.

## Writing a renderer

```js
// public/renderers/mine.js
import { registerRenderer, peopleOf } from '../sdk/index.js';

registerRenderer({
  id: 'mine',
  label: 'Mine',
  sdk: 1,
  views: ['orbit', 'top'],
  create(host) {
    const gl = host.canvas.getContext('webgl');      // or '2d'
    // build the world once, from host.world (rooms, doors, windows, props)
    return {
      draw(scene) {
        // each frame: the people (peopleOf(scene)), the light (scene.light.night), the whiteboard (scene.board)…
      },
      resize(width, height, pixelRatio) { /* size host.canvas and the viewport */ },
      project(x, y, z) { /* world → canvas fractions, through your camera */ },
      toWorld(fx, fy) { /* canvas fractions → the floor point under them */ },
      setView(view) { /* switch the camera */ },
      dispose() { /* free buffers, textures */ },
    };
  },
});
```

1. **Register it** in its own module, and import it from `public/main.js` (as `plan.js` and `blocks.js` are).
2. **Open the game** with `?renderer=mine`. The HUD, the dialogs, the log and the clicks are the game's; your renderer only draws and answers.
3. **Check it** against the contract:

   ```bash
   node scripts/check-renderer.mjs public/renderers/mine.js
   ```

   The conformance kit (`public/sdk/conformance.js`) creates it in each of its views, draws sample scenes (frozen: it fails if the renderer changes them), resizes it, changes its theme and view, asks it what is at points of the canvas, checks that `project`, `toWorld` and what it picks agree (people and the whiteboard are found where it draws them), and disposes it. It runs in Node with a canvas that takes any 2D call; a WebGL renderer is checked in a browser with a real canvas: `checkRenderer(spec, { canvas: () => document.createElement('canvas') })`.

The types (`Scene`, `Actor`, `World`, `Prop`, `Host`, `RendererInstance`, `RendererSpec`, `Target`, `Action`) are in [`public/sdk/index.d.ts`](../public/sdk/index.d.ts); `test/sdk.test.js` checks them against what the game really produces, so they never drift.

## The scene

`buildScene(sim, { now, floor, selected, hover, hovered, services })` → one frame:

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
| `fire`, `extinguisher`, `heat` | The server rack's fire (`{ phase, … }` or `null`), where the extinguisher is (`floor` or `carried`), how hot the rack runs (0–1.3) |
| `bath`, `elevator` | Which stalls are taken (`stalls: [id \| null]`) and when each door opened; when the elevator's doors opened (`doorAt`) and its floor |
| `particles` | Confetti, smoke, foam, drops, emotes: `{ x, y, kind, color, vx, vy, life, … }` |
| `lunch`, `news` | Whether it is lunchtime; the latest thing that happened, in words (the TV's ticker) |
| `services` | The services the agents left running (`{ id, status, name }`): the rack's lights |
| `selected`, `hover`, `hovered` | The viewer's: who is selected (the green diamond), who is under the pointer (or whose desk), and what is under it if clicking it does something (a target: the whiteboard and the rack light up) |

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

`WORLD` (also `scene.world` and `host.world`) is frozen and does not change between frames:

| Field | What it is |
|---|---|
| `units` | `perMeter` (36 world units are a meter), `wallHeight` and `personHeight` (≈ 63 units: about 1.7 m) |
| `bounds` | `{ x0, x1, y0, y1 }`: the floor plane, from the bathroom on the left (`x0 < 0`) to the dining room (`x1`), from the back wall (`y0`) to the front (`y1`) |
| `rooms` | `office`, `cafe`, `dining`, `hall`, `bathroom`: rectangles of floor |
| `doors` | The office's (to the hall), the bathroom's, the dining room's and the elevator's (on the back wall) |
| `windows` | The back wall's glass: the city, the sky and the weather behind it |
| `props` | The furniture: `{ id, kind, x, y, w, d, h, action?, … }` — the middle of its footprint on the floor, its footprint, its height and, if clicking it does something, its `action`. A desk per character (`owner`), the hot desks (`index`), the whiteboard (`face`: its writable part in the front view's pixels; `surface`: the same in the world, the plane `y` from height `z0` to `z1`), the clock, the alarm, the sign, the TV, the sofa (`seats`), the rack, the extinguisher, the meeting table and its rug, the living room's rug, the plants, the café's counter, fridge and espresso machine, the high table, the dining table (`seats`), the planters, the stalls, the sink, the water cooler and the elevator |
| `spots` | Where people go: `board`, `coffee`, `table`, `sofa`, `elevator` |

**Coordinates:** the floor is `x` (left → right) by `y` (back → front), in world units; height (`z`) goes up from the floor. A 3D renderer maps them to its own space, for example `X = x`, `Y = z`, `Z = y` (as `blocks.js` does), dividing by `perMeter` to work in meters.

## Versions

- **`SDK_VERSION`** (now `1`): the shape of a spec, the host and an instance. A renderer says which one it was written for (`sdk`); an optional method can be added without changing it.
- **`SCENE_VERSION`** (now `1`): the scene's and the world's fields. A field is added without changing it; one that changes meaning bumps it (and `docs/rendering.md` and `index.d.ts` with it).

## Themes

How the people look is a theme (`prefs.theme`, public/themes.js): the pixel art one, or the anime one, whose actors the front and top-down views draw with vector strokes (`public/anime.js`, `drawAnime(ctx, actor, now, { x, y })`, about `ANIME_HEIGHT` tall). A theme changes nothing in the scene but who its actors are (their `cfg`: the anime cast, all women) and how a renderer draws them: it arrives as `host.theme` and `setTheme`, and a 3D renderer can read the same `cfg` and `animeStyle(role, cfg)` (hair style, outfit, eyes) to dress its models.

## What is left out

- The two shared floors (the executive one and the archive, `public/floors.js`) still draw from their own model: they are not in the scene yet, and the game's canvas draws them whatever renderer draws the office.
- The text and the HUD (the log, the dialogs, the context bar) are the page's, not a renderer's.
