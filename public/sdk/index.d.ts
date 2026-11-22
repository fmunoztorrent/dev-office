// The renderer SDK's interfaces (public/sdk/index.js): what the game hands a renderer (the host and, every
// frame, the scene) and what a renderer gives back (its drawing, what is at a point, where the world lands
// on its canvas). The scene and the world are the contract's version 1 (SCENE_VERSION); a field is added
// without changing it, one that changes meaning bumps it. test/sdk.test.js checks these fields against
// what buildScene really produces, so this file never drifts from the game.

// ---------------------------------------------------------------- the world (it does not move)

/** A rectangle of floor, in world units (x left → right, y back wall → front). */
export interface Room { id: 'office' | 'cafe' | 'dining' | 'hall' | 'bathroom'; x0: number; x1: number; y0: number; y1: number }

/** A door: in a wall along y (`x`, from y0 to y1), along x (`y`, from x0 to x1) or on the back wall (`wall: 'back'`). */
export interface Door { id: string; between: [string, string]; x?: number; y?: number; x0?: number; x1?: number; y0?: number; y1?: number; wall?: 'back' }

/** The back wall's glass: the city, the sky and the weather behind it. */
export interface WindowPane { id: string; wall: 'back'; x0: number; x1: number; top: number; bottom: number }

/** What clicking a prop does (see actionOf). */
export type PropAction = 'select' | 'board' | 'services' | 'lift' | 'rug';

/** A piece of furniture: the middle of its footprint on the floor (x, y), its footprint (w × d) and its height (h). */
export interface Prop {
  id: string;
  kind: 'desk' | 'hotdesk' | 'whiteboard' | 'clock' | 'alarm' | 'sign' | 'tv' | 'sofa' | 'rack' | 'extinguisher' | 'table' | 'rug'
    | 'plant' | 'counter' | 'fridge' | 'espresso' | 'planter' | 'stall' | 'sink' | 'cooler' | 'elevator';
  x: number; y: number; w: number; d: number; h: number;
  /** What clicking it does; none: it is only furniture. */
  action?: PropAction;
  /** A desk's character (its role). */
  owner?: string;
  /** What is on a desk (`prop` of the character's card). */
  prop?: string | null;
  /** A hot desk's or a stall's number. */
  index?: number;
  /** On a wall (the clock, the sign), from height `top` in the front view's pixels; on the ceiling (the alarm). */
  wall?: 'back'; top?: number; ceiling?: boolean;
  /** The whiteboard's writable part: in the front view's pixels (`face`) and in the world (`surface`: the plane y, heights z0..z1). */
  face?: { x: number; y: number; w: number; h: number };
  surface?: { x0: number; x1: number; y: number; z0: number; z1: number };
  /** The TV's screen; the sofa's and the dining table's seats; a table's shape; the sink's mirror. */
  screen?: { w: number; h: number };
  seats?: Array<{ x: number; y: number; row?: string }>;
  shape?: 'oval' | 'round';
  mirror?: boolean;
}

export interface World {
  /** `perMeter` world units make a meter; the walls' and a person's height. */
  units: { perMeter: number; wallHeight: number; personHeight: number };
  /** The floor plane: from the bathroom (x0 < 0) to the dining room (x1), from the back wall (y0) to the front (y1). */
  bounds: { x0: number; x1: number; y0: number; y1: number };
  rooms: Room[];
  doors: Door[];
  windows: WindowPane[];
  props: Prop[];
  /** Where people go: the whiteboard, the coffee, the meeting table, next to the sofa, the elevator. */
  spots: Record<'board' | 'coffee' | 'table' | 'sofa' | 'elevator', { x: number; y: number }>;
}

// ---------------------------------------------------------------- the scene (one frame)

export type Pose = 'stand' | 'walk' | 'sit' | 'perch' | 'back' | 'hidden';
export type ActorState = 'idle' | 'working' | 'thinking' | 'talking' | 'blocked' | 'waiting' | 'done' | 'coffee' | 'red' | 'alarm' | string;

/** A person, as a renderer needs them. */
export interface Actor {
  id: string;
  /** team: a character of the team; newcomer: a subagent; visitor: a visiting specialist (DevOps, security); expert: an SME. */
  kind: 'team' | 'newcomer' | 'visitor' | 'expert';
  role: string;
  pose: Pose;
  /** Their card: name, title and look (colors #rrggbb), what is on their desk and their chair. */
  cfg: {
    name?: string; title?: string; sex?: 'f' | 'm'; shirt?: string; pants?: string; hair?: string; skin?: string;
    long: boolean; beard: boolean; glasses: boolean; prop: string | null; seat: { x: number; y: number } | null;
  };
  /** Where their feet are (seated: their chair), in world units. */
  x: number; y: number;
  /** -1 looking left, 1 right; whether they walk sideways. */
  face: number; sideways: boolean;
  walking: boolean; walkT: number; seated: boolean; perch: boolean; back: boolean; hidden: boolean;
  /** This frame's step while walking. */
  gait: { frame: number; reach: number; lift: number; bob: number; swing: number } | null;
  state: ActorState;
  text: string;
  /** The last time they did real work (scene.t's clock). */
  taskAt: number;
  jumpUntil: number; shakeUntil: number; dance: boolean; handUp: boolean;
  /** true: a card; 'ext': the extinguisher. */
  carry: boolean | 'ext';
  food: string | null;
  diningSeat: { x: number; y: number; row?: string } | null;
  /** What they say, what their agent is doing and that badge if it is current (🎓 pci-dss, ✏️ cart.js). */
  bubble: { text: string; until: number; [k: string]: unknown } | null;
  tag: { text: string; until: number } | null;
  badge: string | null;
  dream: { kind: string; start: number; until: number; [k: string]: unknown } | null;
  /** How many subagents they have assigned. */
  subagents: number;
  ghost: boolean; specialist: boolean; expert: string | null;
  /** How visible (0–1). */
  fade: number;
  leaving: boolean; gone: boolean;
  /** Their hot desk (-1: the meeting table). */
  desk: number;
  project: string; session: string | null;
}

/** What is at a point of the canvas: a person of the scene or a prop of the world. */
export type Target = { person: string } | { prop: string };

/** What the game does with a target (actionOf). */
export type Action =
  | { type: 'select'; person: string }
  | { type: 'board' } | { type: 'services' } | { type: 'lift' } | { type: 'rug' };

export interface Scene {
  /** The contract's version (SCENE_VERSION). */
  v: number;
  /** The simulation's clock (ms): the time base of every `until`. */
  t: number;
  /** The floor being watched: 'office' is this scene; 'exec' and 'archive' are drawn by the game's own canvas. */
  floor: 'office' | 'exec' | 'archive';
  world: World;
  /** The office's date and time, in its time zone (Date-like). */
  date: Date;
  zone: string | null;
  weather: { kind: string; temp?: number; [k: string]: unknown } | null;
  /** The light the sky gives: `night` 0 (day) .. 1 (night). */
  light: { night: number; [k: string]: unknown };
  season: 'winter' | 'spring' | 'summer' | 'autumn';
  /** The team, by role (po, analyst, manager, tl, qa, backend, frontend, designer). */
  team: Record<string, Actor>;
  /** Whoever came: newcomers, visiting specialists and experts. */
  visitors: Actor[];
  /** Who is on duty and in which phase (▶ RED over their head). */
  turn: { role: string | null; phase: string | null };
  board: { title: string; todos: Array<{ id?: string; content: string; status: string }>; status?: string; source?: string };
  banner: { text: string; tone?: string; until?: number } | null;
  fire: { phase: string; [k: string]: unknown } | null;
  /** Where the extinguisher is: on its stand ('floor') or in someone's hands ('carried'). */
  extinguisher: 'floor' | 'carried';
  /** How hot the rack runs (0–1.3). */
  heat: number;
  bath: { stalls: Array<string | null>; doorAt: number[] };
  /** When the elevator's doors last opened and the floor it shows. */
  elevator: { doorAt: number; floor: number | string };
  particles: Array<{ x: number; y: number; kind: string; color?: string; vx?: number; vy?: number; life?: number; [k: string]: unknown }>;
  lunch: boolean;
  /** The latest thing that happened, in words (the TV's ticker). */
  news: string;
  /** The services the agents left running (the rack's lights). */
  services: Array<{ id: string; status: string; name: string }>;
  /** The viewer's: who is selected, who is under the pointer (or whose desk) and what is (if clicking it does something). */
  selected: string | null;
  hover: string | null;
  hovered: Target | null;
}

// ---------------------------------------------------------------- a renderer

/** What a renderer is created with. */
export interface Host {
  /** The SDK's version. */
  sdk: number;
  /** Its own canvas (ask it for '2d', 'webgl2'…), laid over the game's. */
  canvas: HTMLCanvasElement;
  /** The canvas's size on the page (CSS pixels) and the screen's pixel ratio. */
  width: number; height: number; pixelRatio: number;
  /** The view to start in: one of the renderer's `views`. */
  view: string;
  /** The graphic theme: 'pixel' or 'anime' (how the people look: their cfg, and animeStyle in public/anime.js). */
  theme: string;
  world: World;
  [extra: string]: unknown;
}

/** A renderer at work. Only draw is required. */
export interface RendererInstance {
  /** Draws a frame: the scene of that frame, and nothing else (it only reads it). */
  draw(scene: Scene): void;
  /** The canvas changed size (CSS pixels and pixel ratio). Without it, the host sizes the canvas to width × ratio. */
  resize?(width: number, height: number, pixelRatio: number): void;
  /** What is at a point of the canvas (fractions 0..1 of its width and height). Without it, the SDK works it out from project or toWorld. */
  pick?(fx: number, fy: number): Target | null;
  /** Where a point of the world (x, y on the floor, z up) lands on the canvas, in fractions; null if it is not in sight. */
  project?(x: number, y: number, z?: number): { x: number; y: number } | null;
  /** The point of the floor under a point of the canvas (fractions); null if the floor is not there. */
  toWorld?(fx: number, fy: number): { x: number; y: number } | null;
  /** Changes the view (one of the spec's `views`; the game's `v` key). */
  setView?(view: string): void;
  /** Changes the theme ('pixel' or 'anime'). */
  setTheme?(theme: string): void;
  /** It is no longer used: free what it holds. */
  dispose?(): void;
}

/** A renderer: what registerRenderer gets. */
export interface RendererSpec {
  /** Lowercase letters, digits and dashes: the game opens with ?renderer=<id>. */
  id: string;
  label?: string;
  /** The SDK it was written for (1). */
  sdk?: number;
  /** The views it has (the first is its default); the game's are 'flat' and 'iso'. */
  views?: string[];
  create(host: Host): RendererInstance;
}

export interface Renderer extends Required<Pick<RendererSpec, 'id' | 'label' | 'sdk' | 'views' | 'create'>> { builtIn: boolean }

// ---------------------------------------------------------------- the SDK's functions

export const SDK_VERSION: number;
export const SCENE_VERSION: number;
export const WORLD: Readonly<World>;
export const INSTANCE_METHODS: ReadonlyArray<keyof RendererInstance>;
export const PERSON: Readonly<{ height: number; reach: number }>;
export const INTERACTIVE: ReadonlyArray<Prop>;

export function defineRenderer(spec: RendererSpec): Renderer;
export function registerRenderer(spec: RendererSpec): Renderer;
export function getRenderer(id: string): Renderer | null;
export function listRenderers(): Array<{ id: string; label: string; views: string[]; builtIn: boolean }>;
export function unregisterRenderer(id: string): boolean;
export function createHost(canvas: HTMLCanvasElement, options?: Partial<Omit<Host, 'sdk' | 'canvas' | 'world'>>): Host;
export function createRenderer(spec: RendererSpec | Renderer, host: Host): RendererInstance;

export function peopleOf(scene: Scene): Actor[];
export function personIn(scene: Scene, id: string): Actor | null;
export function propOf(id: string): Prop | null;
export function isTarget(t: unknown, scene?: Scene | null): t is Target;
export function actionOf(target: Target | null): Action | null;
export function pickAt(scene: Scene, x: number, y: number): Target | null;
export function pickByProjection(scene: Scene, project: NonNullable<RendererInstance['project']>, fx: number, fy: number): Target | null;
export function pickWith(instance: RendererInstance, scene: Scene, fx: number, fy: number): Target | null;
export function boxOnScreen(
  project: NonNullable<RendererInstance['project']>,
  box: Pick<Prop, 'x' | 'y' | 'w' | 'd' | 'h'> & { z?: number } | { x0: number; x1: number; y0: number; y1: number; z0?: number; z1?: number },
): { x: number; y: number; w: number; h: number } | null;
