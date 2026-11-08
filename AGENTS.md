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
| `server/services.js` | Los servicios que los agentes dejan corriendo en segundo plano: de dónde salen, si siguen vivos (`lsof`) y sus logs |
| `server/herdr.js` · `server/subpanes.js` | herdr: un agente por pane, y un pane por subagente |
| `server/mcp.js` | El servidor MCP: `join_office`, `register_project`, `report_activity`, `send_task`… y el prompt `join` |
| `server/store.js` | La base SQLite: oficinas, agentes, ajustes (`prefs`), apariencia e historial |
| `public/sim.js` | La simulación (personajes, rutas, vida de la oficina). La comparten el navegador y la terminal |
| `public/game.js` · `public/iso.js` | El juego en canvas: la vista frontal y la cenital (cámara isométrica) |
| `tui/` | La terminal: `app.js`/`view.js` (el juego), `console.js` (la bitácora), `monitor.js` (el monitor), `follow.js` (un subagente), `settings.js` |
| `integrations/` | Lo que corre del lado del agente, más la librería común `integrations/common/devteam.mjs` (detección de proyectos y subagentes, pipelines, gates) |
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
- **Cada subagente es alguien nuevo** en la simulación (`sim.ghosts`): un extra translúcido de su rol en un puesto temporal (`HOT_DESKS`). Los eventos con `subId` son suyos, no del personaje fijo del rol.
- **Un encargo lleva su alcance delante:** una línea que empieza con `📁` (`server/tasks.js`, `scoped`): sólo la carpeta del proyecto y sólo lo pedido. La oficina la saca del título de la pizarra; a OpenCode además le llega como regla (`fenced`).
- **El contexto** llega como evento `context` (o el campo `context` de cualquier evento): sólo actualiza `session.context`, no va a la bitácora ni mueve a nadie.
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
