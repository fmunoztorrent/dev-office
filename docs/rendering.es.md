# Dibujo: la escena y sus renderers

El juego y lo que lo dibuja son dos capas separadas:

```
eventos ─► public/sim.js ─► buildScene() ─► escena ─► renderer ─► píxeles / caracteres / polígonos
           (lo que pasa)    public/scene.js  (datos)   canvas 2D (frontal, cenital) · terminal · plano · uno en 3D…
```

- **La simulación** (`public/sim.js`) decide lo que pasa: quién camina adónde, quién se sienta, quién habla, quién sube por el ascensor, el incendio, el almuerzo, el clima. No sabe nada de píxeles.
- **La escena** (`public/scene.js`) es lo que la simulación dice que tiene que estar en pantalla en un cuadro, como **datos planos**: sin métodos y sin referencias a los objetos de la simulación. Se puede mandar por la red, guardar o comparar en un test.
- **Un renderer** dibuja una escena, y sólo la escena. El canvas del navegador (vista frontal `flat` y cenital isométrica `iso`, `public/game.js`) y la terminal (`tui/view.js`) son renderers de la misma escena; `test/scene.test.js` comprueba que no leen la simulación.

No hay un renderer en 3D: el juego está listo para uno. Esta página es el contrato con el que dibujaría.

## La escena

`buildScene(sim, { now, floor, selected, hover, services })` → un cuadro:

| Campo | Qué es |
|---|---|
| `v` | La versión del contrato (`SCENE_VERSION`, hoy `1`). Agregar un campo no la cambia; uno que cambia de significado la sube |
| `t` | El reloj de la simulación (ms): la base de tiempo de todo lo que tiene `until` (burbujas, saltos, sueños, badges) |
| `floor` | El piso que se mira: `office` (esta escena), `exec` o `archive` (esos dos todavía se dibujan desde su propio modelo, `public/floors.js`) |
| `world` | El mundo que no se mueve (abajo). El mismo objeto en cada cuadro |
| `date`, `zone` | La fecha y la hora de la oficina, en su zona horaria (un objeto parecido a Date) |
| `weather`, `light`, `season` | El clima de afuera (`{ kind, temp, … }`), la luz que da (`{ night, … }`, de `daylight()`) y la estación |
| `team` | El equipo, por rol (`po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`): un **actor** cada uno |
| `visitors` | Los que llegaron: alguien nuevo (un subagente), los especialistas de visita (DevOps, seguridad) y los expertos (SME). También actores |
| `turn` | `{ role, phase }`: quién está de turno y en qué fase (▶ RED sobre su cabeza) |
| `board` | La pizarra: `{ title, todos: [{ id, content, status }], status, source }` |
| `banner` | El letrero de abajo: `{ text, tone, until }` o `null` |
| `fire`, `extinguisher`, `heat` | El incendio del rack (`{ phase, … }` o `null`), dónde está el extintor, qué tan caliente va el rack (0–1,3) |
| `bath`, `elevator` | Qué cubículos están ocupados (`stalls: [id \| null]`) y cuándo se abrió cada puerta; cuándo se abrieron las puertas del ascensor (`doorAt`) y su piso |
| `particles` | Confeti, humo, espuma, gotas, emotes: `{ x, y, kind, color, vx, vy, life, … }` |
| `lunch`, `news` | Si es la hora de almuerzo; lo último que pasó, en palabras (la cinta de la tele) |
| `services` | Los servicios que dejaron corriendo los agentes (`{ id, status, name }`): las luces del rack |
| `selected`, `hover` | Del que mira: a quién eligió (el rombo verde) y quién está bajo el puntero |

### Un actor

| Campo | Qué es |
|---|---|
| `id`, `role`, `kind` | Quién: `kind` es `team`, `newcomer`, `visitor` o `expert` |
| `cfg` | Su ficha: `name`, `title`, `sex`, `shirt`, `pants`, `hair`, `skin` (colores `#rrggbb`), `long`, `beard`, `glasses`, `prop` (lo que tiene en su escritorio) y `seat` (su silla: `{ x, y }`) |
| `x`, `y` | Dónde tiene los pies, en el piso (sentado: su silla) |
| `pose` | `stand`, `walk`, `sit`, `perch` (en una silla que no es la suya: almorzando), `back` (de espaldas: en el sillón) o `hidden` (en el baño) |
| `face`, `sideways` | Hacia dónde mira (`-1` izquierda, `1` derecha) y si camina de lado |
| `walking`, `walkT`, `gait` | Los detalles de la caminata: su tiempo y el paso de este cuadro (`{ frame, reach, lift, bob, swing }`, o `null`) |
| `seated`, `perch`, `back`, `hidden` | Las marcas de la pose (los renderers 2D las usan tal cual; `pose` las resume) |
| `state`, `text` | Qué está haciendo (`idle`, `working`, `thinking`, `talking`, `blocked`, `waiting`, `done`, `coffee`, `red`, `alarm`) y en palabras |
| `taskAt` | La última vez que hizo trabajo de verdad (su pantalla queda encendida un rato) |
| `jumpUntil`, `shakeUntil`, `dance`, `handUp` | Un salto, temblar, bailar (esperando el baño), la mano arriba (tiene una pregunta para ti) |
| `carry`, `food`, `diningSeat` | Lo que lleva (`true`: una tarjeta; `'ext'`: el extintor), lo que come, dónde almuerza |
| `bubble`, `tag`, `badge` | Lo que dice (`{ text, until, … }`), lo que hace su agente (`{ text, until }`) y ese badge si está vigente (`🎓 pci-dss`, `✏️ cart.js`) |
| `dream`, `subagents` | Lo que imagina (`{ kind, start, until }`), cuántos subagentes tiene asignados |
| `ghost`, `specialist`, `expert`, `fade`, `leaving`, `gone`, `desk`, `project`, `session` | De los que van y vienen: qué tan visible (`fade` 0–1), si es una persona (`specialist`), qué experto (`expert`: su id), su escritorio libre (`-1`: la mesa de reuniones), el proyecto y la sesión por los que vino |

## El mundo

`WORLD` (también `scene.world`) está congelado y no cambia entre cuadros:

| Campo | Qué es |
|---|---|
| `units` | `perMeter` (36 unidades del mundo son un metro: una persona mide unos 1,7 m) y `wallHeight` |
| `bounds` | `{ x0, x1, y0, y1 }`: el plano del piso, desde el baño a la izquierda (`x0 < 0`) hasta el comedor (`x1`), desde la pared del fondo (`y0`) hasta el frente (`y1`) |
| `rooms` | `office`, `cafe`, `dining`, `hall`, `bathroom`: rectángulos de piso |
| `doors` | La de la oficina (al pasillo), la del baño, la del comedor y la del ascensor (en la pared del fondo) |
| `windows` | El vidrio de la pared del fondo: la ciudad, el cielo y el clima detrás |
| `props` | Los muebles: `{ id, kind, x, y, w, d, h, … }` — el centro de su huella en el piso, su huella y su altura. Un escritorio por personaje (`owner`), los escritorios libres (`index`), la pizarra (`face`: la parte donde se escribe), el reloj, la alarma, el letrero, la tele, el sillón (`seats`), el rack, el extintor, la mesa de reuniones, las plantas, el mesón, el refrigerador y la cafetera del café, la mesa alta, la mesa del comedor (`seats`), las jardineras, los cubículos, el lavamanos, el dispensador de agua y el ascensor |
| `spots` | Adónde va la gente: `board`, `coffee`, `table`, `sofa`, `elevator` |

**Coordenadas:** el piso es `x` (izquierda → derecha) por `y` (fondo → frente), en unidades del mundo. Un renderer en 3D las lleva a su propio espacio, por ejemplo `X = x`, `Z = y`, `Y` = altura (`h`, `wallHeight`, la de una persona ≈ 63 unidades), dividiendo por `perMeter` para trabajar en metros.

## Escribir un renderer

Un renderer es `{ id, label, create(canvas, options) → instancia }`, registrado en `public/renderers.js`:

```js
import { registerRenderer } from './renderers.js';
import { peopleOf } from './scene.js';

registerRenderer({
  id: 'three',
  label: '3D',
  create(canvas) {
    // un canvas propio: pídele WebGL; arma el mundo una vez, desde scene.world
    return {
      draw(scene) { /* cada cuadro: ubicar peopleOf(scene) y dibujar */ },
      resize(width, height) { /* el canvas cambió de tamaño */ },
      pick(fx, fy) { /* qué hay en ese punto (fracciones 0..1): { person: id } | { what: 'board' } | null */ },
      dispose() {},
    };
  },
});
```

Impórtalo desde `public/main.js` (como `public/renderers/plan.js`) y abre el juego con `?renderer=three`. El juego conserva su HUD, sus diálogos y sus clics: copia el canvas del renderer sobre el suyo en cada cuadro y le pregunta qué hay bajo el puntero (`pick`).

**`public/renderers/plan.js`** es el de referencia: un plano simple de la oficina, visto desde arriba, dibujado sólo con la escena — las salas, puertas y muebles de `world`, cada persona como un punto del color de su camisa con su nombre, lo que dice y su badge, la tarea de la pizarra y la hora del día. Abre el juego con `?renderer=plan`. Un renderer nuevo puede partir de ahí.

## Lo que queda fuera

- Los dos pisos compartidos (la dirección y el archivo, `public/floors.js`) todavía se dibujan desde su propio modelo: aún no están en la escena.
- El texto y el HUD (la bitácora, los diálogos, la barra de contexto) son de la página, no de un renderer.
