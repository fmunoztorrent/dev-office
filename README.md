# Dev Team Office

Una oficina en pixel art, al estilo AI Town, que muestra en vivo lo que hace un agente de código. En vez de un pueblo hay un **equipo de desarrollo**, y cada persona representa un tipo de subtarea del agente.

**El juego es el frontend; el agente es el backend.** La oficina dibuja lo que reportan Claude Code, Pi u OpenCode y les manda tareas y pipelines. No ejecuta nada: el trabajo, los gates y los cambios de modelo los hace cada agente, en su propia sesión, con su integración.

| Personaje | Rol | Qué del agente representa |
|---|---|---|
| Sofía | Product Owner | El prompt del usuario (nueva tarea), preguntas al usuario, historias de usuario |
| Valentina | Analista de negocio | Exploración, `WebSearch`/`WebFetch`, lectura de docs `.md`, subagentes `Explore` |
| Marco | Manager | Tablero de todos (`TodoWrite`/`TaskCreate`), entrega subtareas, pide tu aprobación, compactación |
| Tomás | Tech Lead / arquitecto | Lint, git, búsquedas en el código, planes (`Plan`), reviews, ayuda cuando algo falla |
| Andrés | QA | Archivos de test, `npm test`/`jest`/`pytest`/`playwright`…; si un test falla, le lleva el bug 🐞 al último dev que tocó código |
| Diego | Backend | Edición de código de servidor, migraciones, comandos de shell |
| Lucía | Frontend | `.tsx/.vue/.css/...`, `components/`, `pages/`, dev servers |
| Camila | Diseñadora | `.svg/.png`, `design/`, tokens, MCP de Figma |

Lo que se ve en la oficina:

- **Pizarra kanban** en la pared con los todos del agente (por hacer / en curso / hecho) y una barra de progreso.
- **Nuevo prompt:** la PO va a la pizarra a presentar la tarea y la analista se suma.
- **Subagente (`Task`/`Agent`):** el manager camina con una tarjeta hasta el escritorio de quien corresponde y le deja una carpeta mientras dure la subtarea.
- **Uso de herramientas:** el personaje teclea, su monitor muestra código y saltan glifos. El rack de servidores parpadea cuando trabaja backend.
- **Error:** el personaje se sacude con chispas rojas y el Tech Lead se acerca a ayudar.
- **Permiso pendiente:** el manager levanta la mano y aparece un banner naranja.
- **`Stop`:** confeti y todo el equipo celebra en la mesa de reuniones.
- **Sin actividad:** de vez en cuando alguien va por café.

## Instalación (macOS)

Elige una de estas dos formas:

```bash
# A) Con Node ≥ 22.13 (trae SQLite): deja el comando `dev-team-office` en tu PATH
npm install
npm link

# B) Binario independiente, no necesita Node (requiere Deno para compilarlo)
npm install
npm run build                       # → dist/dev-team-office (arm64, ~80 MB)
mkdir -p ~/.local/bin && cp dist/dev-team-office ~/.local/bin/
```

Para Mac con Intel: `npm run build:mac-x64`.

Después, integra tus agentes (copia la extensión de Pi, el plugin de OpenCode, el hook de Claude Code y la librería común que usan los tres):

```bash
dev-team-office install          # o: install pi | opencode | claude
```

Claude Code necesita un paso más: copiar la sección `hooks` que te indica el comando a tu `~/.claude/settings.json`.

## Uso

```bash
dev-team-office            # abre la oficina en la terminal y levanta la API
dev-team-office serve      # sólo la API, sin interfaz (para dejarla en segundo plano)
dev-team-office watch      # otra terminal mirando la misma oficina
dev-team-office status     # ¿está corriendo? versión, puerto y socket
dev-team-office demo --pi  # reproduce una sesión de ejemplo
dev-team-office send phase --role qa --phase red --text "2 tests fallan"
dev-team-office task "Agrega paginación" --agent pi    # tarea para el agente
dev-team-office tasks                                  # estado de las tareas
dev-team-office install                                # integra Pi, OpenCode y Claude Code
dev-team-office agents add ~/Workspace/Errementari --agent claude   # registra un agente
dev-team-office agents                                 # los agentes y los pipelines de su harness
dev-team-office prompt errementari-claude-code "el SSE no reconecta" --pipeline errementari:bugfix
```

Si ya hay una oficina corriendo, `dev-team-office` se conecta a ella en vez de fallar. Puedes tener varias terminales mirando la misma.

**Teclas:** `t` (o clic en la pizarra) nuevo encargo · `c` (o clic en ⚙) ajustes · `x` cancelar · `q` salir · `tab`/flechas o clic para elegir personaje · `m` mensaje al equipo · `s` saludar · `d`/`p` demos · `r` reiniciar · `esc` soltar.

**Requisitos de la terminal:** al menos 60×18 (se ve bien desde 120×36). Con *truecolor* se ve mejor: iTerm2, Ghostty, WezTerm, Kitty, la terminal de VS Code y la de Claude lo tienen. En las demás se usan 256 colores; se fuerza con `--color truecolor|256`.

La misma oficina se puede ver en el navegador en `http://127.0.0.1:4317`.

## Agentes: cada uno con su harness engineering

Un **agente** es una ruta completa más el CLI que la atiende (Claude Code, OpenCode o Pi). Se registra en **⚙ › Agentes** (o con `dev-team-office agents add`) y se guarda en la base SQLite de la oficina. Lo que trae esa ruta es del agente: su orquestador, sus subagentes, sus comandos, sus pipelines. La oficina lo **detecta** y, al mandarle un prompt, arranca **ese** pipeline:

| Lo que trae la ruta | Pipelines que ofrece | Cómo se arranca |
|---|---|---|
| [Errementari](https://github.com/fmunoztorrent/errementari) (`.errementari.json`) | `/task` (clasifica solo), feature, bugfix, chore, debug | `/task <prompt>` (`/task bug: …`, `/task chore: …`): el agente `pipeline` lo pasa por spec → architect → qa → backend/frontend → qa → close |
| Comandos de Claude Code (`.claude/commands/*.md`) | `/<comando>` | `claude -p "/<comando> <prompt>"` |
| Comandos de OpenCode (`opencode.json`, `.opencode/command/`) | `/<comando>` | `opencode run --command <comando> "<prompt>"` |
| Prompts de Pi (`.pi/prompts`, `~/.pi/agent/prompts`, p. ej. los de gentle-pi) | `/<prompt>` | `pi -p "/<prompt> <prompt>"` |
| Pipelines de Dev Team Office (`.devteam/pipelines`) | `Pipeline · <nombre>` | Los corre una sesión abierta, dentro de sí misma ([docs/pipelines.md](docs/pipelines.md)) |
| Cualquier ruta | Prompt directo | El prompt tal cual, para el agente por defecto del harness |

**A dónde va el prompt:**

- **Sesión abierta en esa ruta.**
  - Pi y OpenCode lo reciben al instante: Pi expande el `/comando` y OpenCode lo corre con `session.command`.
  - Claude Code lo recibe en su hook `Stop`, con el comando expandido.
- **Sesión nueva.** La oficina abre el CLI del agente en su ruta, sin shell y con el prompt como un único argumento. Los hooks y plugins del agente reportan todo a la oficina.

Cuando el orquestador delega, el personaje que se mueve es el de ese subagente:

- **Errementari:** spec → analista, architect → Tech Lead, qa → QA, backend → backend, pipeline → manager.
- **gentle-pi:** `subagent_run`, con sdd-* y review-*.

## Encargos: haz clic en la pizarra

Al hacer clic en la pizarra de la oficina, en la terminal o en la web (en la terminal también con `t`), se abre el diálogo **Nuevo encargo**. Ahí eliges:

- **Agente:** los registrados y las sesiones abiertas.
- **Pipeline:** las entradas que trae su harness (ver arriba).
- **Sesión:** una abierta en esa ruta, o una nueva.
- **El prompt**, en una nota adhesiva.

Antes de enviar, el diálogo muestra las etapas del pipeline y qué personaje hace cada una. Con **✉ Enviar prompt** en ⚙ › Agentes se abre con ese agente ya elegido.

Los pipelines de `.devteam/pipelines/*.json` los corre la sesión del agente, etapa por etapa:

| Agente | Cómo corre las etapas |
|---|---|
| **Pi** | Un mensaje por etapa en la misma sesión; cambia de modelo con `setModel` en cada etapa |
| **OpenCode** | Un `session.prompt` por etapa, con el modelo y el agente de la etapa |
| **Claude Code** | El hook `Stop` encadena las etapas en la sesión. Una etapa que pide **otro** modelo corre como `claude -p --model …` (un hook no puede cambiar el modelo de la sesión) |

Formato completo en [docs/pipelines.md](docs/pipelines.md) y un ejemplo en [`examples/tienda`](examples/tienda).

### Tareas directas

| Destino | Cómo llega |
|---|---|
| **Pi** con sesión abierta | Al instante. La extensión llama `pi.sendUserMessage()`, y si Pi está ocupado queda como follow-up |
| **OpenCode** con sesión abierta | Al instante. El plugin la envía con `client.session.prompt()`; sin sesión conocida, la escribe en el prompt del TUI |
| **Claude Code** (sesión existente) | En cola. La entrega su hook `Stop` cuando Claude termina el turno en curso, y Claude sigue con ella. Claude Code no permite inyectar mensajes en una sesión interactiva desde fuera: si la sesión está esperando tu mensaje, la tarea llega al terminar el siguiente turno |
| **Sesión nueva** de un agente registrado | La oficina abre `claude -p`, `opencode run` o `pi -p` en su ruta. Sus hooks o plugins reportan el trabajo como en cualquier sesión |

`claude -p` lanzado así usa `--permission-mode acceptEdits` (edita archivos sin preguntar y deniega lo demás que necesite permiso), salvo que el agente tenga sus propios argumentos en ⚙ › Agentes › Avanzado.

Desde la CLI: `dev-team-office task "Agrega paginación" --agent pi` para una tarea directa. Sin argumentos muestra a quién se le puede enviar.

## ⚙ Ajustes

El engranaje del panel (web) o de la cabecera (terminal, también con `c`):

| Pestaña | Qué hay |
|---|---|
| Agentes | El mantenedor: agregar (ruta completa + CLI; detecta su harness al escribirla), editar, eliminar y ✉ enviarle un prompt. También las sesiones abiertas sin registrar |
| Personajes | Nombre, cargo, colores (camisa, pantalón, pelo, piel), pelo largo, barba y lentes de cada personaje |

Todo se guarda en una base **SQLite**: `~/.dev-team-office/office.db`, o la ruta de `DEV_TEAM_OFFICE_DB`. Usa `node:sqlite`, así que no hay dependencias nativas, y el archivo tiene permisos `0600`. Tiene tres tablas:

- `agents`: los agentes registrados;
- `settings`: la apariencia;
- `prompts`: el historial de lo que les mandaste y cómo terminó.

Si existía un `~/.dev-team-office/config.json` de versiones anteriores, se importa la primera vez.

Todo se valida antes de escribir, se aplica en caliente y un sitio web ajeno no puede cambiar nada.

## API de integración

Cualquier proceso puede enviarle eventos a la oficina y escucharla:

- **HTTP/JSON** en `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state`, `POST /v1/commands`.
- **WebSocket** en `ws://127.0.0.1:4317/v1/ws`: estado en vivo y envío de eventos, con `ack` opcional.
- **Socket Unix** en `~/.dev-team-office/office.sock`: la misma API, accesible sólo para tu usuario.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/mi-agente \
  -d '{"session":"s1","kind":"task","text":"Migrar a Postgres"}'
```

El protocolo completo (eventos, mensajes WebSocket, ejemplos en Python y Node, y por qué no gRPC) está en [docs/api.md](docs/api.md).

## Integraciones

`dev-team-office install` deja todo en su sitio. Las tres integraciones usan la misma librería ([`integrations/common/devteam.mjs`](integrations/common/devteam.mjs)), que se instala en `~/.dev-team-office/lib/`: lee `.devteam/`, arma el prompt de cada etapa, corre los gates, aplica los bucles y reporta todo a la oficina. La oficina es opcional: si está apagada, los agentes siguen igual.

### Claude Code (hooks)

`dev-team-office install claude` copia [`hook.mjs`](integrations/claude-code/hook.mjs) a `~/.dev-team-office/claude-code/` y genera allí un `settings.json` con la ruta correcta. Copia su sección `hooks` en `~/.claude/settings.json` (global) o en `.claude/settings.json` (proyecto). La plantilla es [`settings.example.json`](integrations/claude-code/settings.example.json).

El hook reenvía cada evento (por el socket Unix si existe y, si no, por HTTP), anuncia el proyecto y, en el `Stop`, entrega tareas y ejecuta los pipelines. Nunca escribe nada en stdout salvo la decisión del `Stop`, y siempre sale con 0. Para otra URL o socket, usa `DEV_TEAM_OFFICE_URL` o `DEV_TEAM_OFFICE_SOCKET`.

Las tareas paralelas se identifican por `tool_use_id`/`agent_id`, así que cada una cae en su personaje y no se duplican.

### OpenCode

`dev-team-office install opencode` copia [`dev-team-office.js`](integrations/opencode/dev-team-office.js) a `~/.config/opencode/plugin/`.

### Pi

`dev-team-office install pi` copia la extensión a `~/.pi/agent/extensions/` y el skill a `~/.agents/skills/`.

- **Extensión** ([`dev-team-office.ts`](integrations/pi/dev-team-office.ts)): reporta el prompt, las herramientas y el fin del agente; recibe tareas y pipelines; lanza sesiones nuevas cuando la oficina se lo pide.
- **Skill** ([`skills/dev-team-office`](integrations/pi/skills/dev-team-office/SKILL.md)): Pi declara qué rol tiene el turno y en qué fase está, por ejemplo `arquitecto → qa RED → backend implementa → qa GREEN → review → po acepta`. Cada traspaso se anima en la oficina, y las herramientas se atribuyen al rol de turno. El catálogo de eventos y los flujos están en [docs/eventos-por-rol.md](docs/eventos-por-rol.md).

### Otros agentes

Usa el formato genérico por WebSocket o por `POST /v1/events/<nombre>` (ver [docs/api.md](docs/api.md)). Para recibir pipelines, impleméntalo como las demás integraciones con `PipelineRun` de la librería común (protocolo en [docs/pipelines.md](docs/pipelines.md#por-api)).

## Estructura

```
bin/dev-team-office.js  el ejecutable: subcomandos open, serve, watch, status, demo, send, task, install
bin/install.js          instala las integraciones de cada agente
server/server.js        API HTTP + WebSocket en TCP y socket Unix
server/adapters.js      payload nativo → formato genérico
server/office.js        estado: sesiones, todos, subagentes, turnos, bitácora
server/roles.js         qué personaje representa cada herramienta/archivo/comando
server/tasks.js         tareas hacia los agentes: registro, cola, entrega y sesiones nuevas de un agente registrado
server/pipeline.js      pipelines: relay entre la pizarra y la sesión de agente que los ejecuta
server/store.js         la base SQLite: agentes registrados, ajustes e historial de prompts
server/registry.js      los agentes (registrados + sesiones abiertas), lo que trae su harness y a dónde va un prompt
server/demo.js          sesiones simuladas (Claude Code y flujo TDD de Pi)
public/sim.js           la simulación (personajes, rutas, reacciones); la comparten terminal y navegador
public/targets.js       a quién se le puede mandar una tarea (terminal y navegador)
public/brief.js         el diálogo de la pizarra (terminal y navegador)
public/settings-ui.js   ⚙ Ajustes en la web
tui/settings.js         ⚙ Ajustes en la terminal
examples/tienda/        proyecto de ejemplo con equipo, pipelines y agentes
tui/                    la oficina en la terminal: framebuffer de medios bloques, vista, teclado y ratón
public/game.js          la oficina en canvas, para el navegador
integrations/common/    la librería del lado del agente: proyecto, pipelines, gates (la usan las tres)
integrations/           Claude Code (hook), OpenCode (plugin), Pi (extensión + skill)
docs/                   API y propuesta de eventos por rol
test/                   node --test (incluye un agente de mentira: test/fixtures/fake-agent.mjs)
```

Para cambiar quién hace qué, edita las reglas de [`server/roles.js`](server/roles.js).
