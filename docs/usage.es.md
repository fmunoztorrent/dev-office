# Guía de uso

[English](usage.md) · **Español**

Esta guía cubre el día a día con la oficina. Si todavía no la instalas, empieza por [installation.es.md](installation.es.md).

## La idea

**El juego es el frontend y el agente es el backend.** Los agentes de código (Pi, Claude Code, OpenCode, Codex) hacen el trabajo y le cuentan a la oficina lo que hacen, con sus hooks, plugins o extensión. La oficina lo dibuja: cada subagente es un personaje del equipo (producto, análisis, manager, tech lead, QA, backend, frontend, diseño). También les manda tareas y pipelines. Nunca ejecuta trabajo por su cuenta.

## Las tres formas de mirar

| Dónde | Qué ves | Cómo |
|---|---|---|
| **El monitor** (terminal, dentro de herdr) | Cuántos agentes, subagentes, panes y tareas hay; cada agente con su tarea y en qué está, sus subagentes debajo, quién del equipo trabaja y la bitácora | `dev-team-office` dentro de herdr, o `dev-team-office monitor` en cualquier terminal |
| **El juego en el navegador** | La oficina en pixel art, a pantalla completa, con la **vista frontal** (la de siempre) o la **cenital isométrica** | `http://127.0.0.1:4317` (`o` desde el monitor o la bitácora) |
| **El juego en la terminal** | La misma oficina, en medios bloques de colores | `g` desde el monitor o la bitácora; fuera de herdr, también `dev-team-office game` |

Fuera de herdr, `dev-team-office` muestra la **bitácora**: una línea por cada cosa que pasa. `g` abre el juego ahí mismo y `o` lo abre en el navegador.

### El monitor

```
▣ DEV TEAM OFFICE 0.6.0  🏢 Oficina principal  http://127.0.0.1:4317  herdr w1:p1  12:04:31
  ● 2 agente(s) activo(s)   🤖 1 subagente(s) corriendo   👥 3 del equipo trabajando   🪟 3 pane(s)   📨 1 tarea(s) en curso
─ AGENTES ───────────────────────────────────────────────────────────────
 ● Pi · tienda          en curso    Agrega discount() al carrito     ▸ Andrés: $ npm test      12s
   └ 🧪 Andrés     ex-qa          🔴 RED: tests de discount         ▸ $ npm test              8s
 ✋ Claude · api        esperándote Arregla el login                 ▸ Marco: necesita tu permiso
  EQUIPO  Andrés en rojo · Diego trabajando · Marco esperando
─ BITÁCORA ──────────────────────────────────────────────────────────────
  12:04:22  Andrés     🤖 RED: tests de discount
  12:04:25  Andrés     ✖ Falló: $ npm test · …
  o navegador · g juego · ←→ oficina · q cerrar la oficina
```

Teclas: `o` abre el juego en el navegador, `g` lo abre en la terminal (`q` vuelve al monitor), `←`/`→` cambian de oficina y `q` sale. Si el monitor levantó la oficina, `q` también la cierra.

Cuando un agente deja un servicio corriendo en segundo plano (un servidor de desarrollo, un watcher…), una sección **SERVICIOS** los lista, numerados: `1`–`9` abren el log de ese servicio en un pane de herdr debajo del de su agente (`tail -F`), y `l` el más nuevo que esté corriendo.

Cuando un agente te pregunta algo, una sección **TE ESPERAN** lo muestra arriba: `r` lista sus opciones, `1`–`9` responden, `x` cancela la pregunta y `esc` vuelve (ver [Cuando un agente te pregunta algo](#cuando-un-agente-te-pregunta-algo)).

«Del equipo trabajando» cuenta trabajo de verdad: los anuncios (una tarea repartida, un pane que se
abre o se cierra) no lo mueven.

### Las vistas del juego (navegador)

- **Frontal:** la de siempre y la vista por defecto. La pared de vidrio y la ciudad quedan al fondo y el piso hacia ti.
- **Cenital (isométrica):** la misma oficina vista desde arriba y en diagonal:
  - el piso en rombo, la pared del ventanal y una pared lateral;
  - los muebles como volúmenes;
  - las personas de pie, cada una delante o detrás de lo que corresponda;
  - la oficina es el último piso de una torre de vidrio, en tonos apagados para que la oficina destaque (de noche, con algunas ventanas encendidas), y detrás de la torre está el mismo paisaje que se ve por las ventanas: cielo, sol o luna, clima y ciudad.

Para cambiar de vista: el botón ◇ (arriba a la derecha), la tecla `v` o **⚙ › General › Vista de la oficina**. La elección queda en los ajustes y todas las ventanas la siguen. El juego en la terminal usa siempre la frontal.

En las dos vistas (y en el juego de la terminal):

- **Las burbujas dicen qué hace cada uno en palabras** («Corriendo los tests», «Leyendo cart.js»), nunca el comando. El visor `follow` de un subagente muestra además el comando, atenuado, debajo de las palabras.
- **Cada subagente es alguien nuevo:** un extra translúcido de su rol (otro nombre, la misma camisa) que llega en el ascensor, al final del pasillo, recibe un escritorio propio en la fila de adelante (aparece con él y se va con él; pasados siete, en la mesa de reuniones), hace el trabajo del subagente y se va al terminar. La placa de su escritorio dice quién es y para qué proyecto vino.
- **La pizarra con tickets** se expande al hacerle clic: las tareas como post-its en tres columnas. En la terminal, `t` o Enter ahí abre un encargo nuevo.
- **La barra de contexto** (navegador, pequeña, junto al clima): cuánto contexto le queda al agente de la sesión enfocada, o al último que lo informa.

## Pedirle algo al equipo

| Desde | Cómo |
|---|---|
| El juego | Clic en la pizarra (con tickets primero los expande como post-its: ahí, **✚ Nuevo encargo**), o `t`. Eliges el agente (agrupados por proyecto), el pipeline de su harness, la sesión, el perfil de modelos y escribes el prompt |
| La terminal | `dev-team-office task "Agrega paginación" --agent pi`, o `dev-team-office prompt <id> "…" --pipeline <entrada>` |
| Tu agente | Directo en su sesión: la oficina lo ve igual |
| Otro agente (MCP) | La herramienta `send_task` |

Cada encargo va con su alcance delante (una línea que empieza con 📁): el agente trabaja sólo dentro de la carpeta de su proyecto y sólo en lo que se pidió. Esa línea no es parte del pedido: el título de la pizarra es sólo lo que escribiste. A OpenCode además le llega como regla de verdad (los archivos fuera de la carpeta se le niegan).

**Perfiles de modelos** (⚙ › Modelos): un perfil dice qué modelo usa cada rol. Vienen listos el de Anthropic (Sonnet; Opus para el arquitecto, Haiku para QA) y el de OpenCode (sus modelos gratuitos), y **✚ Nuevo perfil** agrega los tuyos. Por defecto cada agente usa su modelo; el perfil elegido en el encargo (o el por defecto de ⚙ › Modelos) se usa al abrir una **sesión nueva** (el agente arranca con el modelo del perfil) y en las etapas de un pipeline que no fijan modelo (cada una, el de su rol). Una sesión abierta sigue con su modelo.

La tarea llega así:

- **A una sesión abierta:** Pi y OpenCode la reciben al instante. Claude Code la recibe al terminar su turno.
- **Sin sesión abierta:**
  - Dentro de herdr, el agente se abre en un pane nuevo con el prompt.
  - Fuera de herdr, corre en segundo plano.

En un pane, la oficina **confirma que el agente arrancó su turno** (se lo pregunta a herdr). Si no
arranca, espera a que el agente quede libre y lo reintenta una sola vez. Si el pane recién abierto ya
está ocupado (`agent_pane_busy`, lo estás usando vos), la oficina lo deja como está —no lo cierra,
deja de seguirlo— y abre otro, pocas veces: tres intentos en total. Solo cuando eso también falla la
tarea queda **fallida** con el motivo —`el agente no arrancó su turno en el pane w3:p9 (herdr:
agent_prompt_stalled | agent_pane_busy)`— en vez de quedar «en curso» para siempre.

## herdr: un pane por agente y por subagente

Dentro de herdr:

- tu agente se abre en un pane al lado del monitor (⚙ › General › «Agente al abrir»);
- cada **subagente** que lanza se abre en **su propio pane**, debajo del agente. Ahí ves:
  - quién es (su personaje) y su tarea;
  - cada herramienta que usa y la salida de sus comandos;
  - la fase (🔴 RED / 🟢 GREEN) y, al final, su informe.

  Los que corren a la vez quedan uno al lado del otro. Cada pane se cierra solo unos segundos después de que su subagente termina.
- el agente puede abrir más panes para sus actividades: `dev-team-office pane --role qa -- npm test -- --watch`.

El subagente lo sigue corriendo su harness; el pane sólo lo **muestra**, con `dev-team-office follow`. Se apaga en ⚙ › General › «Cada subagente en su pane», o con `dev-team-office config herdr.subagents off`.

## Cuando un agente te pregunta algo

Un agente puede detenerse a preguntarte: un permiso («Allow?»), elegir entre opciones, una pregunta. Dentro de herdr respondes sin ir a su pane:

- **En el juego (navegador):** el chip **✋** arriba a la izquierda («Pi te pregunta») abre la pregunta, con un botón por opción. También `r`, o un clic en la PO (tú) o en el manager mientras espera con la mano levantada. `1`–`9` eligen, y «Cancelar la pregunta» aprieta Esc.
- **En el monitor:** la sección **TE ESPERAN**. `r` lista las opciones, `1`–`9` responden, `x` cancela y `esc` vuelve.

Tu respuesta se aprieta en el pane del agente, como si estuvieras ahí: las flechas hasta la opción, y Enter. Si la pregunta cambió o ya se respondió en el pane, no se aprieta nada y la oficina muestra lo que dice la pantalla ahora. La oficina lee las preguntas de la pantalla (los permisos de Claude Code, las preguntas de Pi y de OpenCode, el «Allow?» de una extensión), así que sirve con cualquier agente. Fuera de herdr no puede ver las pantallas de los agentes: respondes en la terminal del agente.

## Sumar proyectos y equipos

- **`join`** suma un proyecto en un solo paso: levanta la oficina, registra la raíz del repo con su agente y te dice qué personaje hace cada subagente. Está como prompt MCP (`/mcp__dev-team-office__join`), como herramienta MCP (`join_office`), en Pi (`/office`) y en la terminal (`dev-team-office join`).
  - Si al agente **le faltan roles** (o no trae subagentes), le completa el equipo con el de la oficina (arquitecto, explorador, backend, frontend y QA) en el proyecto, en su formato: `.claude/agents`, `.opencode/agents`, `.pi/agents` o `.codex/agents`. Claude Code (si esa carpeta no existía) y OpenCode tienen que reiniciarse para verlos; Pi los usa desde el próximo subagente. Detalle en [installation.es.md](installation.es.md#si-tu-agente-no-trae-equipo).
  - `--team <pack>` elige otro pack y `--no-team` no deja ninguno.
- **⚙ › Agentes** (o `dev-team-office agents add <ruta> --agent <cli>`) es el mantenedor: ruta completa, CLI y oficina.
- **Una oficina, varios proyectos:** registra un agente por carpeta de proyecto (`api-pagos` con Claude Code, `bff-web` con Pi…). El encargo los agrupa por proyecto, cada uno trabaja sólo dentro de su carpeta, la lista de sesiones dice de qué proyecto es cada una y, cuando hay más de uno activo, cada línea de la bitácora lleva su proyecto.
- **Oficinas:** una empresa puede tener varias (equipos o dominios), cada una con su zona horaria, su ciudad (su clima) y sus personajes. Se crean en ⚙ › Oficinas o con `dev-team-office offices add "Pagos" --timezone Europe/Madrid`.
- **Team packs:** `dev-team-office team install example --agent <pi|claude|opencode|codex> --project .` deja un subagente por rol, en el formato de ese agente.

## btw: una pregunta al margen

`btw ¿quién está con los tests?` (en la línea de comandos de la terminal del juego, `b` en el juego de la terminal, o `dev-team-office btw "…"`) le pregunta al agente de turno sin interrumpir su trabajo. Una pregunta escrita a un personaje elegido (que termine en `?` o empiece con `¿`) va al agente del proyecto y la tarea en que trabaja ese personaje, y te la contesta él.

## La CLI, completa

| Comando | Para qué |
|---|---|
| `dev-team-office` | Levanta la oficina. Dentro de herdr abre el monitor (`--no-monitor`: la bitácora); fuera, la bitácora |
| `dev-team-office monitor` | El monitor de actividad (de la oficina que corre, o levanta una) |
| `dev-team-office game` | Fuera de herdr entra directo al juego en la terminal; dentro de herdr abre el monitor (el juego, con `g`) |
| `dev-team-office serve` | Sólo la API y la bitácora, sin teclas (en segundo plano) |
| `dev-team-office start` · `stop` · `restart` | Inicia la oficina en segundo plano (su bitácora en `~/.dev-team-office/office.log`), detiene la que esté corriendo (en segundo plano o en una terminal) o la reinicia con el código instalado |
| `dev-team-office watch` | Otra terminal mirando el juego de la misma oficina |
| `dev-team-office status` | ¿Corre? Versión, puerto y socket |
| `dev-team-office join [ruta] [--agent <cli>] [--office <oficina>] [--team <pack>\|--no-team] [--open]` | Suma un proyecto al juego y le completa el equipo con el de la oficina (ver arriba) |
| `dev-team-office agents` · `agents add` · `agents rm` | El mantenedor de agentes |
| `dev-team-office offices` · `offices add` · `offices set` · `offices rm` | Las oficinas |
| `dev-team-office task` · `tasks` · `prompt` | Mandar trabajo y ver cómo va |
| `dev-team-office pane … -- <comando>` | Dentro de herdr: una actividad en otro pane |
| `dev-team-office follow --session <s> --sub <id>` | Lo que hace un subagente, en vivo (la oficina lo abre sola en su pane) |
| `dev-team-office btw "…"` | Una pregunta al margen |
| `dev-team-office send <kind> …` | Manda un evento a mano (para probar) |
| `dev-team-office demo [--pi]` | Una sesión de ejemplo |
| `dev-team-office config [clave] [valor]` | Los ajustes: `lang`, `timezone`, `city <ciudad>\|zone`, `weather`, `herdr.*`, `log.life`, `view.office`, `view.mode flat\|iso` |
| `dev-team-office team …` | Los team packs |
| `dev-team-office setup` · `doctor` · `update` · `uninstall` | La instalación |
| `dev-team-office mcp` | El servidor MCP (stdio; lo registra `setup`) |

## Teclas

| Dónde | Teclas |
|---|---|
| Monitor | `o` navegador · `g` juego · `←→` oficina · `r` responder la pregunta del agente · `1`–`9`/`l` los logs de un servicio · `q` salir |
| Bitácora | `g` juego · `o` navegador · `h` ayuda · `q` cerrar |
| Juego (terminal) | `t` encargo · clic en la pizarra: sus tareas (con tickets) o un encargo · `c` ajustes · `o` oficina · `a` actividad · `tab`/flechas elegir · `m` mensaje · `b` btw · `s` saludar · `x` cancelar · `l` servicios (o clic en el rack) · `d`/`p` demos · `r` reiniciar · `q` volver |
| Juego (navegador) | `t` encargo · `c` ajustes · `o` oficina · `a` terminal de actividad · `f` pantalla completa · `v` vista frontal o cenital · `l` servicios (o clic en el rack) · `r` responder la pregunta del agente (o el chip ✋) · `esc` cerrar |
