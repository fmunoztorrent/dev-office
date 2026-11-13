# AGENTS.md

Guía para los agentes de código que trabajan **en este repositorio**: Codex, OpenCode, Pi, Gemini CLI, Cursor, Claude Code. Para usar la oficina con tu agente, ver el [README](README.md) (en inglés) o el [README.es.md](README.es.md) (en español).

## Qué es

Dev Team Office es una oficina en pixel art que muestra en vivo lo que hacen los agentes de código. Cada subagente es un personaje de un equipo de desarrollo. **El juego es el frontend y el agente es el backend:** la oficina dibuja lo que reportan los hooks, plugins y extensiones de cada agente, y les manda tareas. Nunca ejecuta trabajo por su cuenta.

- **Node.js ≥ 22.13**, módulos ES y **cero dependencias en tiempo de ejecución**: `node:sqlite`, un WebSocket propio y el `WebSocket` global de Node.
- **Interfaces:**
  - el juego en el navegador (canvas, con vista frontal o cenital isométrica);
  - el juego en la terminal (medios bloques);
  - la bitácora de la terminal;
  - el monitor de actividad (dentro de herdr);
  - el visor de un subagente (`follow`).
- **Integraciones:** hooks de Claude Code y Codex, plugin de OpenCode, extensión de Pi, un servidor MCP (stdio) y skills.

## Mapa

| Ruta | Qué hay |
|---|---|
| `bin/dev-team-office.js` | La CLI: `open` (la bitácora, o el monitor dentro de herdr), `monitor`, `game`, `serve`, `join`, `follow`, `pane`, `setup`, `doctor`, `mcp`… |
| `bin/setup.js` | Conecta cada agente (hooks, MCP, skills, lanzador), `doctor` y `uninstall` |
| `server/server.js` | La API HTTP + WebSocket (TCP y socket Unix) y el cableado de todo |
| `server/office.js` | El estado de una oficina: sesiones, subagentes (con `subId`), turnos, la pizarra y la bitácora |
| `server/company.js` | Las oficinas de la empresa y a cuál va cada evento |
| `server/adapters.js` | El payload de cada agente → el formato genérico |
| `server/roles.js` · `server/humanize.js` | Qué personaje hace cada herramienta, archivo o comando, y qué hace dicho en palabras («Corriendo los tests»: nunca el comando) |
| `server/tasks.js` · `server/pipeline.js` · `server/registry.js` | Las tareas, los pipelines y los agentes registrados |
| `server/prompts.js` | Lo que un agente te pregunta en su pantalla (un permiso, elegir una opción): se lee de su pane de herdr y tu respuesta se aprieta ahí |
| `server/services.js` | Los servicios que los agentes dejan corriendo en segundo plano: de dónde salen, si siguen vivos (`lsof`) y sus logs |
| `server/herdr.js` · `server/subpanes.js` | herdr: un agente por pane, y un pane por subagente |
| `server/mcp.js` | El servidor MCP: `join_office`, `register_project`, `report_activity`, `send_task`… y el prompt `join` |
| `server/store.js` | La base SQLite: oficinas, agentes, ajustes (`prefs`), apariencia, historial, directivas y el archivo (`knowledge`) |
| `server/clarify.js` | La autonomía: antes de que un encargo pase a trabajo, la analista se lo da a revisar al agente del proyecto (sólo lectura) y te trae sólo las preguntas que cambiarían el resultado |
| `server/guides.js` | Los estándares de la empresa (los del CTO), las indicaciones de cada departamento (una oficina) y de cada proyecto (su carpeta): van arriba de cada encargo, pipeline, directiva y pregunta, bajo la línea 📁. Y la autonomía de cada departamento (`autonomyOf`) |
| `server/rag.js` · `server/chunks.js` · `server/ingest.js` | El archivo como RAG: cargar documentos (su texto legible), cortarlos en fragmentos, buscarlos por palabras (FTS5) y por significado (embeddings opcionales), el glosario, los vacíos y el bloque «📚 Del archivo» arriba de cada encargo |
| `server/directives.js` · `server/archive.js` | Los dos pisos compartidos: la dirección (una directiva = un encargo por proyecto, a varias oficinas) y el archivo (notas, decisiones, documentos, actas, skills y conectores; instala skills y conectores en cada proyecto) |
| `server/standup.js` | La daily: cada mañana (9:30 de la oficina) o cuando la pidas (🗣, `d`, `dev-team-office daily`, MCP `daily`), lo que hizo cada personaje desde la daily anterior según la bitácora real, y en qué está ahora; el juego los junta en la mesa y el acta va al archivo |
| `server/components.js` | El mapa de la empresa (departamentos → proyectos → componentes: detectados de la carpeta y declarados) y el impacto de un pedido de la dirección: lo que nombra, y lo que no está en el mapa para preguntarlo |
| `server/compact.js` · `public/compact.js` | La autocompactación: pasado tu tope (`prefs.compact`, 400k tokens por defecto), la oficina le pide al agente que compacte: por WebSocket a la extensión que `can` compact (Pi, OpenCode), `/compact` en su pane de herdr cuando termina su turno, o un aviso en la bitácora; y los Claude Code que abre llevan el tope en su entorno |
| `server/systems.js` | Los sistemas (un producto: «Pagos» = su core, su BFF y su front): sus artefactos (un repo registrado o un componente de uno) con su tipo (detectado de la carpeta) y lo que usa cada uno; el orden en que va un cambio (`orderParts`), a quién alcanza (`consumersOf`) y la línea 🧩 del encargo |
| `server/mine.js` | Lo tuyo (⚙ › Mío): skills privadas instaladas en tus carpetas personales de cada agente (nunca en un repo) y tus herramientas (scripts que el MCP ofrece como `my_<nombre>` y corre en la carpeta del agente) |
| `server/settings-io.js` | Tus ajustes como archivo JSON: qué es del usuario (ajustes, departamentos con sus personajes, proyectos con sus indicaciones y componentes) y cómo se importa (mezcla, pieza por pieza) |
| `public/sim.js` | La simulación (personajes, rutas, vida de la oficina). La comparten el navegador y la terminal |
| `public/game.js` · `public/iso.js` | El juego en canvas: la vista frontal y la cenital (cámara isométrica) |
| `public/floors.js` · `public/floors-ui.js` | Los pisos de la dirección y del archivo: sus escenas (con el mismo dibujo del juego) y sus diálogos |
| `tui/` | La terminal: `app.js`/`view.js` (el juego), `console.js` (la bitácora), `monitor.js` (el monitor), `follow.js` (un subagente), `settings.js` |
| `integrations/` | Lo que corre del lado del agente, más la librería común `integrations/common/devteam.mjs` (detección de proyectos y subagentes, pipelines, gates) |
| `public/character.js` | Un personaje como JSON, para compartirlo (exportar e importar): nombre, sexo, personalidad, estilo y aspecto |
| `public/models.js` | Los perfiles de modelos (Anthropic, OpenCode y los que se agreguen): qué modelo usa cada rol |
| `public/board-ui.js` | La pizarra expandida: las tareas como post-its |
| `public/locales/{en,es}.js` | Todos los textos de la interfaz |
| `docs/` | API, MCP, instalación, uso, convenciones, eventos por rol, pipelines, cómo conectar un harness |
| `test/` | `node --test`, con fixtures (`fake-agent.mjs`, `fake-claude.mjs`…) |
| `scripts/dev-session.sh` | El flujo real, aislado, para probar como un usuario: instala el checkout en un `HOME` en `/tmp`, con un agente real y su sesión de herdr |
| `scripts/install-check.mjs` | Las pruebas de instalación: un usuario nuevo por agente (Claude Code, Pi, OpenCode), del instalador al `uninstall`; `--container` en un Linux limpio |

## Comandos

```bash
npm test                                   # todos los tests (deben pasar siempre)
node --test test/office.test.js            # un archivo
node bin/dev-team-office.js --help         # la CLI desde el código
PORT=4320 DEV_TEAM_OFFICE_DB=/tmp/dto-demo.db DEV_TEAM_OFFICE_WEATHER=off node server/index.js   # oficina de prueba
node test/fixtures/fake-agent.mjs --url http://127.0.0.1:4320 --delay 450                         # un agente de mentira
scripts/dev-session.sh up --agent pi       # el flujo real, aislado (ver «Probar como un usuario»)
node scripts/install-check.mjs             # la instalación de un usuario nuevo, con cada agente (--container: Linux limpio)
```

## Reglas

1. **No toques la instalación real del usuario.**
   - Los tests y las pruebas usan una base `:memory:` o temporal, `port: 0` (o uno distinto de 4317), `socket: null` (o uno temporal) y `weather: false`.
   - Nunca uses `~/.dev-team-office/office.db`, `~/.claude`, `~/.pi`, `~/.codex` ni `~/.config/opencode` de verdad.
2. **Los agentes reales y herdr se prueban aislados**, con `scripts/dev-session.sh`.
   - Un `HOME` temporal en `/tmp`, un puerto propio y `herdr --session <nombre>`; nunca la sesión de herdr por defecto.
   - Al terminar se borra todo (`scripts/dev-session.sh down`), desenlazando antes los enlaces simbólicos.
3. **Cero dependencias nuevas** en tiempo de ejecución.
4. **Los textos de la interfaz van en los dos idiomas:** `public/locales/en.js` y `es.js`, con las mismas claves y `{variables}`; `test/i18n.test.js` lo comprueba.
5. **Los comentarios del código van en inglés.** Cada archivo abre con un comentario que dice qué es.
   - La documentación va en los dos idiomas: cada documento en inglés (`README.md`, `CONTRIBUTING.md`, `docs/<nombre>.md`) tiene al lado su versión en español (`.es.md`), y un cambio en uno va también en el otro.
   - `AGENTS.md` y `CLAUDE.md` van en español.
6. **Una integración nunca rompe a su agente:** tope de tiempo, sin errores hacia el agente, y los hooks salen con 0.
7. **Cada cambio de comportamiento trae su test**, y su documentación si lo ve el usuario (en los dos idiomas: README, `docs/`; y `cli.help`).
8. **Un cambio visible en el juego se revisa en el navegador**, en las dos vistas (`v` las alterna).
9. **Un cambio que vea el usuario se prueba como lo usaría un usuario**, en el flujo real (abajo). Los tests y la oficina de prueba con el agente de mentira sirven para iterar, pero no bastan.

## Probar como un usuario

Un cambio que vea el usuario no está listo hasta probarlo en el flujo real: la oficina instalada como la instala un usuario, una terminal de verdad con herdr, un agente real y el juego en el navegador. [`scripts/dev-session.sh`](scripts/dev-session.sh) lo arma siempre igual y aislado:

1. **Crearlo:** `scripts/dev-session.sh up --agent pi` (se puede repetir `--agent`: `pi`, `opencode`, `codex`, `claude`). Deja en `/tmp/dto-dev`:
   - un `HOME` temporal con los logins del agente enlazados;
   - este checkout instalado con `install.sh` + `setup`;
   - un proyecto de prueba (`tienda`);
   - la sesión de herdr `dto-dev` y la oficina en el puerto 4390.
2. **Abrirlo en una terminal de verdad**, con lo que imprime `scripts/dev-session.sh herdr`, a la vista del usuario.
3. **Usarlo como un usuario:**
   - `dev-team-office` en un pane (el monitor; abre al agente registrado);
   - el agente en otro (`pi`, y `/office`);
   - el juego en `http://127.0.0.1:4390`;
   - trabajo de verdad, pedido desde la pizarra o desde el agente.
4. **Mirar y manejar herdr desde fuera:** `scripts/dev-session.sh h pane list`, `h pane read <pane>`, `h pane send-text`, `h pane send-keys`, y `scripts/dev-session.sh status`.
5. **Después de cada cambio:** `scripts/dev-session.sh update`, y reinicia la oficina en su pane (`q`, y otra vez `dev-team-office`).
6. **Al terminar:** `scripts/dev-session.sh down`. Detiene herdr y la oficina, quita los enlaces y borra todo.

Si un agente no puede trabajar (sin créditos, una API key vencida), se dice y se prueba con uno que sí pueda. No se reemplaza en silencio por eventos de mentira.

Más detalle en [docs/conventions.es.md](docs/conventions.es.md) y [CONTRIBUTING.es.md](CONTRIBUTING.es.md). Para publicar una versión: la sección «Releasing» de [CONTRIBUTING.md](CONTRIBUTING.md) y el [CHANGELOG](CHANGELOG.md).

## Cosas que no son obvias

- **macOS:** `/tmp` es `/private/tmp`. Las rutas se comparan con `insideDir`/`realDir` (`server/paths.js`), nunca como texto.
- **Los subagentes de Pi** (gentle-pi) son otros procesos `pi` con la misma extensión.
  - Reportan a la sesión del padre con `child: <pid>` (la marca es `DEV_TEAM_OFFICE_PI_PID`).
  - La oficina los asocia por la tarea que recibieron.
  - Sus `session_start`, `turn_end` y `todos` no son de la sesión del padre.
- **La PO es el usuario** (da las órdenes y decide qué se hace).
  - Un agente nunca la juega: `agentRole` (`server/roles.js` e `integrations/common/devteam.mjs`) convierte en `analyst` el `po` que declare un agente, un subagente o una etapa.
  - Lo que hace el usuario es de la PO (`task`, `dispatch`, la pregunta de un `btw`), y las preguntas y permisos del agente van a su escritorio.
  - En la simulación cotorrea, pero no decide nada sola: no lleva ideas al backlog ni contesta alcances.
- **Cada subagente es alguien nuevo** en la simulación (`sim.ghosts`): un extra translúcido de su rol que llega por el ascensor (`ELEVATOR`) y se sienta en un escritorio propio, que existe mientras él está (`HOT_DESKS` son los lugares). Los eventos con `subId` son suyos, no del personaje fijo del rol.
- **DevOps/SRE y seguridad son especialistas de visita** (`VISITOR_ROLES`): roles de verdad (`devops`, `security`, con sus alias), pero sin escritorio ni personaje fijo.
  - El servidor los cuenta (`office.roles`) y los asigna por comando, archivo, herramienta MCP o descripción (`server/roles.js`, `TEXT_RULES`).
  - En el juego, el trabajo de su sesión principal los hace subir por el ascensor (`specialist()` en `public/sim.js`, con la clave `visit:<sesión>:<rol>`). Son un `ghost` con `specialist: true`: se dibujan sólidos, siempre la misma persona (`VISITORS`, personalizable en ⚙ › Personajes), y se van al terminar el turno.
  - Para el aspecto de cualquier rol, usa `personOf(role)` o `defaultLook(role)`, nunca `TEAM[role]`, que sólo tiene a los ocho del equipo.
  - `provisionTeam` sólo le da `ex-devops` y `ex-security` a un proyecto cuyo equipo es el de la oficina.
- **El mundo va de `x = LEFT` (negativo) a `W`:** la oficina es `x ≥ 0`; a su izquierda, el pasillo (`HALL`) y el baño (`BATHROOM`). La vista frontal dibuja con el mundo corrido (`FLAT` en `game.js`), la terminal resta `LEFT` al convertir, y la ruta (`route` en `sim.js`) pasa por las puertas: nadie cruza una pared.
- **Un encargo lleva su alcance delante:** una línea que empieza con `📁` (`server/tasks.js`, `scoped`): sólo la carpeta del proyecto y sólo lo pedido. Debajo van el modo autónomo y las indicaciones de su departamento y de su proyecto (líneas `📋 …` y `│ …`, `server/guides.js`), y lo que sabe el archivo (`📚 …`, `server/rag.js`). La oficina saca esa cabecera del título de la pizarra (`unguided`); a OpenCode el alcance además le llega como regla (`fenced`).
- **Una directiva no sale sin su mapa de impacto** (`DirectiveDesk.plan`, `server/components.js`): se lee de las palabras del pedido, sin modelo.
  - Lo que nombra y no está en el mapa (`unknown`) bloquea el envío (`409 needsAnswers`) hasta que haya una respuesta por cada cosa (`answers`: `exists`, `create`, `department`, `ignore`); `ask: false` se lo salta.
  - Lo contestado queda declarado en la tabla `components`.
  - La detección de nombres (`namedParts`) privilegia la precisión: si el pedido pregunta tonteras, hay que ajustarla allí, con su test en `test/impact.test.js`.
  - **En los tests, un agente registrado que reciba una directiva tiene que tener un `bin` que no exista** (o el falso de `test/fixtures`): si no, se lanza el agente real.
- **El contexto** llega como evento `context` (o el campo `context` de cualquier evento): sólo actualiza `session.context`, no va a la bitácora ni mueve a nadie.
  - **Pi avisa del fin de un mensaje antes de guardarlo en la sesión:** en `message_end`, `getContextUsage()` va un mensaje atrasado. Por eso la extensión usa el `usage` de la respuesta misma, y el conteo de Pi recién en `turn_end`/`agent_end`.
  - **Después de compactar** no se sabe cuánto ocupa hasta la próxima respuesta: un `compact` marca `context.compacted` y el hook de Claude Code no informa el uso de antes de la marca `compact_boundary` del transcript. En OpenCode, el mensaje-resumen de una compactación (`summary`) no cuenta.
  - **Compactar lo hace el agente, nunca la oficina,** y nunca en medio de una respuesta: la extensión espera a quedar libre (Pi: `agent_settled`; OpenCode: `session.idle`), y en herdr se escribe `/compact` sólo al terminar el turno (`Compactor` lleva la cuenta de qué sesión está libre).
- **Los sistemas** (`server/systems.js`, tabla `systems`, las partes como JSON) están entre el departamento y el repo.
  - Un repo tiene **un** departamento dueño (`agents.office_id`: a ese piso van sus eventos), pero puede ser artefacto de sistemas de otros departamentos (compartido). No hagas que un repo esté en dos departamentos: rompe el ruteo de eventos.
  - **El orden lo hace `DirectiveDesk`:** una parte espera (`waiting`, con `after`) a las partes que usa; al partir, `#briefOf` le antepone el traspaso de ellas (`handoff` por MCP, o el final de `task.output`) y le da sus carpetas para leer (`reads` → la línea 📁 con `task.scopeReads`). Si una falla, las que la usan se cancelan. `#follow` actualiza primero las partes en curso y después despacha las que esperan, hasta que nada se mueva.
  - **El tipo de artefacto** decide el personaje sólo para lo que ninguna regla reclama (`roleForPath`/`roleForCommand` con `kind`, desde `company.kindFor`): las reglas propias del archivo (tests → QA, Dockerfile → DevOps…) siempre ganan.
  - Un encargo a un sistema desde la pizarra es el destino `system:<id>` (`systemTargets` en `public/brief.js`): el servidor lo convierte en una directiva (`case 'run'`), sin la revisión de la analista.
- **El badge** (`ev.badge`, `badgeFor` en `server/humanize.js`) es un ícono y una o dos palabras, nunca el comando. La simulación lo guarda en `actor.tag` y lo borra cuando termina el turno de esa sesión; el de un subagente va en su recién llegado, no en el personaje de su rol.
- **Lo tuyo nunca toca tu HOME real en un test:** `Mine` (y `startServer({ mine: { home } })`, `importSettings(store, raw, { mine })`) recibe el `home`. La oficina de prueba del navegador también se levanta con un `HOME` temporal si vas a guardar skills. Los agentes no pueden crear skills ni herramientas tuyas por MCP, a propósito: una skill privada corre en todas tus sesiones.
- **Los roles de los subagentes** salen de, en este orden:
  1. su `role:`;
  2. su nombre (`SUBAGENT_ROLES`);
  3. su descripción (`TEXT_RULES`).

  Los del proyecto ganan sobre los globales. Cada sesión los aprende de su carpeta (`company.rolesFor`).
- **Dentro de herdr** (`HERDR_ENV=1`):
  - `dev-team-office` abre el **monitor**, no el juego;
  - cada `subagent_start` abre un pane con `follow` (`server/subpanes.js`);
  - los panes toman el tamaño del cliente de herdr conectado.
- **La vista del juego** (`prefs.view.mode`: `flat` por defecto, o `iso`) se guarda en los ajustes. La cenital reutiliza el dibujo de la frontal con transformaciones afines (`iso.js`): `floor`, `front` y `billboard`.
- **El servidor MCP** contesta en inglés (es para agentes). `join_office` es idempotente.
- **El equipo de la oficina** (`teams/example`, en el formato de Pi) se traduce al de cada harness en `bin/team.js` (`RENDERERS`). `join` instala en el proyecto los roles que no cubre ningún subagente del harness (`provisionTeam`), sin pisar archivos; el servidor lo expone en `POST /v1/agents/<id>/team` (para el `/office` de Pi) y las sesiones abiertas en esa carpeta lo aprenden (`company.learnRoles`).
