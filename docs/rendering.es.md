# Dibujo: el SDK de renderers

El juego y lo que lo dibuja están separados, y sólo se hablan a través del **SDK de renderers** (`public/sdk/`). El juego decide lo que pasa y qué hace un clic; un renderer convierte cada cuadro en píxeles (o polígonos) y dice qué hay en un punto de su canvas. Cualquier motor gráfico que cumpla el contrato puede dibujar la oficina: el pixel art del juego, un plano visto desde arriba, una escena 3D en WebGL o lo que venga.

```
             el juego (public/game.js: el anfitrión)
 eventos ──► public/sim.js ── buildScene() ──► escena ────── draw(escena) ──────►  renderer ──► píxeles / polígonos
             (quién se mueve adónde,           (datos planos)                     (cualquier motor)
              qué pasa)        ◄── acción ◄── actionOf(objetivo) ◄── objetivo ◄── pick(x, y) · project · toWorld
```

- **La simulación** (`public/sim.js`) decide lo que pasa: quién camina adónde, quién se sienta, quién habla, quién sube por el ascensor, el incendio, el almuerzo, el clima. No sabe nada de píxeles.
- **La escena** (`public/scene.js`) es lo que tiene que estar en pantalla en un cuadro, como **datos planos**: sin métodos y sin referencias a los objetos de la simulación. Se puede mandar por la red, guardar o comparar en un test.
- **El SDK** (`public/sdk/index.js`, con sus tipos en [`public/sdk/index.d.ts`](../public/sdk/index.d.ts)) es el contrato: qué es un renderer, qué recibe (un anfitrión y la escena de cada cuadro), qué contesta (qué hay bajo el puntero, dónde cae el mundo en su canvas) y el vocabulario de lo que se puede apuntar (objetivos) y de lo que hace un clic (acciones).
- **Un renderer** dibuja la escena, y sólo la escena. Nunca lee la simulación, y el juego nunca lee las tripas de un renderer.
- **El anfitrión** (`createGame` en `public/game.js`) corre la simulación en cada cuadro, arma la escena, se la entrega al renderer y convierte el puntero en acciones a través del SDK. La página (su HUD, sus diálogos, la bitácora) es la misma dibuje quien dibuje.

## Los renderers que hay

| Id | Qué es | Cómo contesta al puntero |
|---|---|---|
| `canvas` | El pixel art del juego (`createCanvasRenderer`, `public/game.js`), en dos vistas: frontal (`flat`) y cenital isométrica (`iso`). Registrado en el SDK como cualquier otro (`builtIn: true`); también dibuja los dos pisos compartidos | Su propio `pick` (la gente por su sprite, los escritorios, la pizarra, el rack, la alfombra, el ascensor), y además `project` y `toWorld` |
| `plan` | El de referencia (`public/renderers/plan.js`): un plano simple visto desde arriba, dibujado sólo con la escena. Desde donde puede partir un renderer nuevo. `?renderer=plan` | Sin pick: `project` y `toWorld`, y el SDK encuentra lo que hay |
| `blocks` | Uno en 3D con WebGL puro (`public/renderers/blocks.js`): el mundo y la gente como bloques iluminados, con dos cámaras, `orbit` y `top` (la tecla `v`). `?renderer=blocks` | Sin pick: `project` (con su cámara) y `toWorld` (un rayo hasta el piso) |

La terminal (`tui/view.js`) dibuja la misma escena en una pantalla de caracteres; no es un renderer de canvas, pero sigue la misma regla: sólo la escena.

## Un renderer

Un renderer es una **spec**, registrada con `registerRenderer(spec)`:

| Campo | Qué es |
|---|---|
| `id` | Minúsculas, dígitos y guiones. El juego dibuja con él si se abre con `?renderer=<id>` |
| `label` | Su nombre, para la gente |
| `sdk` | El SDK para el que fue escrito (`SDK_VERSION`, hoy `1`). Uno más nuevo se rechaza con un mensaje |
| `views` | Sus vistas (la primera es la de por defecto). La tecla `v` del juego las recorre; las del canvas son `flat` e `iso` |
| `create(host)` | Crea una **instancia** (abajo) |

`defineRenderer(spec)` revisa una spec y dice qué está mal (el id, `create`, las vistas, el SDK).

### El anfitrión

Lo que recibe `create(host)`:

| Campo | Qué es |
|---|---|
| `canvas` | Un canvas propio, puesto sobre el del juego (`.renderer-layer`, no recibe los clics). Pídele `2d`, `webgl` o `webgl2` |
| `width`, `height`, `pixelRatio` | El tamaño del canvas en la página (píxeles CSS) y la densidad de la pantalla. El anfitrión deja el canvas de `width × pixelRatio` por `height × pixelRatio` antes de `create` |
| `view` | La vista con la que parte: una de sus `views` |
| `theme` | `pixel` o `anime`: cómo se ve la gente (su `cfg`, y `animeStyle` en `public/anime.js`) |
| `world` | `WORLD`: el mundo que no se mueve (abajo) |
| `sdk` | La versión del SDK |

### Una instancia

Sólo `draw` es obligatorio:

| Método | Qué hace |
|---|---|
| `draw(scene)` | Dibuja un cuadro: la escena de ese cuadro, y nada más. **Sólo lee** la escena |
| `resize(width, height, pixelRatio)` | El canvas cambió de tamaño. Puede dejar su canvas del tamaño que quiera (el pixel art: un múltiplo del mundo, para que sus píxeles queden nítidos). Sin él, el anfitrión ajusta el canvas |
| `pick(fx, fy)` | Qué hay en ese punto del canvas (fracciones 0..1 de su ancho y su alto): un **objetivo**, o `null` |
| `project(x, y, z)` | Dónde cae en el canvas un punto del mundo (`x`, `y` en el piso, `z` hacia arriba), en fracciones; `null` si no se ve (detrás de la cámara) |
| `toWorld(fx, fy)` | El punto del piso bajo un punto del canvas: `{ x, y }`, o `null` |
| `setView(view)` | Cambia la vista (una de sus `views`) |
| `setTheme(theme)` | Cambia el tema |
| `dispose()` | Ya no se usa: libera lo que tenga |

**Ciclo de vida:** `create(host)` → `resize` cada vez que cambia la pantalla → `draw(scene)` en cada cuadro (mientras se ve la oficina: los pisos compartidos son del canvas) → `setView` / `setTheme` cuando quien mira los cambia → `dispose` cuando otro renderer toma su lugar. **Un renderer que falla al dibujar se descarta**, y el juego vuelve a su propio canvas.

## Qué hay bajo el puntero

El juego le pregunta al renderer por el puntero en **fracciones** del canvas, y recibe un **objetivo**: lo que hay ahí, en palabras del mundo.

- `{ person: id }`: una persona de la escena (un personaje del equipo, alguien nuevo, un especialista de visita, un experto);
- `{ prop: id }`: un mueble del mundo (`WORLD.props`).

`actionOf(objetivo)` lo convierte en lo que hace el juego. Los muebles lo dicen ellos mismos (`prop.action`):

| Objetivo | Acción | Qué hace el juego |
|---|---|---|
| una persona, o un escritorio (`desk:<rol>`) | `{ type: 'select', person }` | Su ficha (un escritorio es de su dueño) |
| `whiteboard` | `{ type: 'board' }` | La pizarra expandida, o un encargo nuevo |
| `rack` | `{ type: 'services' }` | Los servicios que quedaron corriendo |
| `elevator` | `{ type: 'lift' }` | El panel del ascensor (los otros pisos) |
| `rug`, `meeting-table` | `{ type: 'rug' }` | La daily o la retro |

Un renderer no tiene que calcular los objetivos solo. `pickWith(instancia, escena, fx, fy)` (lo que usa el juego) le pregunta de la mejor forma en que puede contestar:

1. su propio `pick`, si lo tiene;
2. si no, **por proyección** (`pickByProjection`): con su `project`, una persona cuya silueta cubre el punto (la de adelante primero), o el mueble interactivo más chico cuyo volumen lo cubre;
3. si no, **en el piso** (`pickAt`): con su `toWorld`, la persona más cercana a su alcance, o el mueble interactivo más chico cuya huella cubre el punto.

Conteste lo que conteste, el juego sólo recibe un objetivo válido o `null` (`isTarget`). Y con `project` la página puede poner sus cosas sobre el dibujo: `game.boardBox()` es dónde está la pizarra (`boxOnScreen`), así que la pizarra expandida sale desde ahí en cualquier renderer.

## Etiquetas sobre el dibujo

Lo que dice la gente y los badges sobre sus cabezas se ubican juntos, en la pantalla, para que ninguno tape a otro: `layoutLabels(items, { bounds, gap, previous })` recibe el ancla de cada etiqueta (adonde apunta su cola) y su tamaño, y devuelve dónde va. Cada una prefiere quedar centrada justo encima de su ancla; si ese lugar está ocupado sube una fila o se corre, el lugar libre más cercano primero, siempre dentro de los bordes. Con `previous` (dónde estaba cada etiqueta en el cuadro anterior) una etiqueta conserva su lugar mientras siga libre, así que nada salta. El canvas ubica con él sus burbujas y sus badges, en las dos vistas y en los pisos compartidos, y desliza una etiqueta cuando tiene que moverse; otro renderer puede usar la misma ayuda con su propio `project`.

## Escribir un renderer

```js
// public/renderers/mio.js
import { registerRenderer, peopleOf } from '../sdk/index.js';

registerRenderer({
  id: 'mio',
  label: 'Mío',
  sdk: 1,
  views: ['orbit', 'top'],
  create(host) {
    const gl = host.canvas.getContext('webgl');      // o '2d'
    // arma el mundo una vez, desde host.world (salas, puertas, ventanas, muebles)
    return {
      draw(scene) {
        // cada cuadro: la gente (peopleOf(scene)), la luz (scene.light.night), la pizarra (scene.board)…
      },
      resize(width, height, pixelRatio) { /* ajusta host.canvas y el viewport */ },
      project(x, y, z) { /* mundo → fracciones del canvas, con tu cámara */ },
      toWorld(fx, fy) { /* fracciones del canvas → el punto del piso bajo ellas */ },
      setView(view) { /* cambia la cámara */ },
      dispose() { /* libera buffers, texturas */ },
    };
  },
});
```

1. **Regístralo** en su propio módulo, e impórtalo desde `public/main.js` (como `plan.js` y `blocks.js`).
2. **Abre el juego** con `?renderer=mio`. El HUD, los diálogos, la bitácora y los clics son del juego; tu renderer sólo dibuja y contesta.
3. **Revísalo** contra el contrato:

   ```bash
   node scripts/check-renderer.mjs public/renderers/mio.js
   ```

   El kit de conformidad (`public/sdk/conformance.js`) lo crea en cada una de sus vistas, dibuja escenas de ejemplo (congeladas: falla si el renderer las cambia), le cambia el tamaño, el tema y la vista, le pregunta qué hay en puntos del canvas, comprueba que `project`, `toWorld` y lo que apunta estén de acuerdo (encuentra a la gente y la pizarra donde las dibuja) y lo descarta. Corre en Node con un canvas que acepta cualquier llamada 2D; uno en WebGL se revisa en un navegador con un canvas de verdad: `checkRenderer(spec, { canvas: () => document.createElement('canvas') })`.

Los tipos (`Scene`, `Actor`, `World`, `Prop`, `Host`, `RendererInstance`, `RendererSpec`, `Target`, `Action`) están en [`public/sdk/index.d.ts`](../public/sdk/index.d.ts); `test/sdk.test.js` los compara con lo que el juego produce de verdad, para que nunca se desfasen.

## La escena

`buildScene(sim, { now, floor, selected, hover, hovered, services })` → un cuadro:

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
| `banner` | El cartel de abajo: `{ text, tone, until }` o `null` |
| `fire`, `extinguisher`, `heat` | El incendio del rack (`{ phase, … }` o `null`), dónde está el extintor (`floor` o `carried`), qué tan caliente está el rack (0–1,3) |
| `bath`, `elevator` | Qué cubículos están ocupados (`stalls: [id \| null]`) y cuándo se abrió cada puerta; cuándo se abrieron las puertas del ascensor (`doorAt`) y su piso |
| `particles` | Confeti, humo, espuma, gotas, emotes: `{ x, y, kind, color, vx, vy, life, … }` |
| `lunch`, `news` | Si es la hora de almuerzo; lo último que pasó, en palabras (el ticker de la tele) |
| `services` | Los servicios que los agentes dejaron corriendo (`{ id, status, name }`): las luces del rack |
| `selected`, `hover`, `hovered` | Los de quien mira: a quién eligió (el rombo verde), quién está bajo el puntero (o de quién es el escritorio) y qué hay bajo él si un clic hace algo (un objetivo: la pizarra y el rack se iluminan) |

### Un actor

| Campo | Qué es |
|---|---|
| `id`, `role`, `kind` | Quién: `kind` es `team`, `newcomer`, `visitor` o `expert` |
| `cfg` | Su ficha: `name`, `title`, `sex`, `shirt`, `pants`, `hair`, `skin` (colores `#rrggbb`), `long`, `beard`, `glasses`, `prop` (lo que tiene en su escritorio) y `seat` (su silla: `{ x, y }`) |
| `x`, `y` | Dónde están sus pies, en el piso (sentado: su silla) |
| `pose` | `stand`, `walk`, `sit`, `perch` (en una silla que no es la suya: el almuerzo), `back` (de espaldas: en el sillón) o `hidden` (en el baño) |
| `face`, `sideways` | Hacia dónde mira (`-1` izquierda, `1` derecha) y si camina de lado |
| `walking`, `walkT`, `gait` | El detalle del paso: su tiempo y el paso de este cuadro (`{ frame, reach, lift, bob, swing }`, o `null`) |
| `seated`, `perch`, `back`, `hidden` | Las marcas de la pose (los renderers 2D las usan tal cual; `pose` las resume) |
| `state`, `text` | Qué está haciendo (`idle`, `working`, `thinking`, `talking`, `blocked`, `waiting`, `done`, `coffee`, `red`, `alarm`) y en palabras |
| `taskAt` | La última vez que hizo trabajo de verdad (su pantalla sigue encendida un rato) |
| `jumpUntil`, `shakeUntil`, `dance`, `handUp` | Un salto, un temblor, un baile (esperando el baño), una mano arriba (tiene una pregunta para ti) |
| `carry`, `food`, `diningSeat` | Qué lleva (`true`: una tarjeta; `'ext'`: el extintor), qué come, dónde almuerza |
| `bubble`, `tag`, `badge` | Lo que dice (`{ text, until, … }`), lo que está haciendo su agente (`{ text, until }`) y ese badge si está vigente (`🎓 pci-dss`, `✏️ cart.js`) |
| `dream`, `subagents` | Lo que imagina (`{ kind, start, until }`), cuántos subagentes tiene asignados |
| `ghost`, `specialist`, `expert`, `fade`, `leaving`, `gone`, `desk`, `project`, `session` | Para los que van y vienen: qué tan visibles (`fade` 0–1), si son una persona (`specialist`), qué experto (`expert`: su id), su escritorio libre (`-1`: la mesa de reuniones), el proyecto y la sesión por los que vinieron |

## El mundo

`WORLD` (también `scene.world` y `host.world`) está congelado y no cambia entre cuadros:

| Campo | Qué es |
|---|---|
| `units` | `perMeter` (36 unidades del mundo son un metro), `wallHeight` y `personHeight` (≈ 63 unidades: alrededor de 1,7 m) |
| `bounds` | `{ x0, x1, y0, y1 }`: el plano del piso, desde el baño a la izquierda (`x0 < 0`) hasta el comedor (`x1`), desde la pared del fondo (`y0`) hasta el frente (`y1`) |
| `rooms` | `office`, `cafe`, `dining`, `hall`, `bathroom`: rectángulos de piso |
| `doors` | La de la oficina (al pasillo), la del baño, la del comedor y la del ascensor (en la pared del fondo) |
| `windows` | El vidrio de la pared del fondo: la ciudad, el cielo y el clima detrás |
| `props` | Los muebles: `{ id, kind, x, y, w, d, h, action?, … }` — el centro de su huella en el piso, su huella, su altura y, si un clic hace algo, su `action`. Un escritorio por personaje (`owner`), los escritorios libres (`index`), la pizarra (`face`: la parte donde se escribe en píxeles de la vista frontal; `surface`: lo mismo en el mundo, el plano `y` desde la altura `z0` hasta `z1`), el reloj, la alarma, el letrero, la tele, el sillón (`seats`), el rack, el extintor, la mesa de reuniones y su alfombra, la alfombra del living, las plantas, el mesón, el refrigerador y la cafetera del café, la mesa alta, la mesa del comedor (`seats`), las jardineras, los cubículos, el lavamanos, el dispensador de agua y el ascensor |
| `spots` | Adónde va la gente: `board`, `coffee`, `table`, `sofa`, `elevator` |

**Coordenadas:** el piso es `x` (izquierda → derecha) por `y` (fondo → frente), en unidades del mundo; la altura (`z`) sube desde el piso. Un renderer en 3D las lleva a su propio espacio, por ejemplo `X = x`, `Y = z`, `Z = y` (como `blocks.js`), dividiendo por `perMeter` para trabajar en metros.

## Versiones

- **`SDK_VERSION`** (hoy `1`): la forma de una spec, del anfitrión y de una instancia. Un renderer dice para cuál fue escrito (`sdk`); un método opcional se puede agregar sin cambiarla.
- **`SCENE_VERSION`** (hoy `1`): los campos de la escena y del mundo. Agregar un campo no la cambia; uno que cambia de significado la sube (y con ella `docs/rendering.md` e `index.d.ts`).

## Los temas

Cómo se ve la gente es un tema (`prefs.theme`, public/themes.js): el de pixel art, o el anime, cuyos actores las vistas frontal y cenital dibujan con trazos vectoriales (`public/anime.js`, `drawAnime(ctx, actor, now, { x, y })`, de unos `ANIME_HEIGHT` de alto). Un tema no cambia nada de la escena salvo quiénes son sus actores (su `cfg`: el elenco anime, todas mujeres) y cómo los dibuja un renderer: le llega como `host.theme` y `setTheme`, y uno en 3D puede leer el mismo `cfg` y `animeStyle(rol, cfg)` (peinado, ropa, ojos) para vestir a sus modelos.

## Lo que queda fuera

- Los dos pisos compartidos (la dirección y el archivo, `public/floors.js`) todavía se dibujan desde su propio modelo: aún no están en la escena, y el canvas del juego los dibuja sea cual sea el renderer de la oficina.
- El texto y el HUD (la bitácora, los diálogos, la barra de contexto) son de la página, no de un renderer.
