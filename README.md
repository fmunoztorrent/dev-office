# Dev Team Office

Una oficina en pixel art, al estilo AI Town, que muestra en vivo lo que hace un agente de código. En vez de un pueblo hay un **equipo de desarrollo**, y cada persona representa un tipo de subtarea del agente:

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
# A) Con Node ≥ 20: deja el comando `dev-team-office` en tu PATH
npm install
npm link

# B) Binario independiente, no necesita Node (requiere Deno para compilarlo)
npm install
npm run build                       # → dist/dev-team-office (arm64, ~80 MB)
mkdir -p ~/.local/bin && cp dist/dev-team-office ~/.local/bin/
```

Para Mac con Intel: `npm run build:mac-x64`.

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
```

Si ya hay una oficina corriendo, `dev-team-office` se conecta a ella en vez de fallar. Puedes tener varias terminales mirando la misma.

**Teclas:** `t` tarea al agente · `x` cancelar tarea · `q` salir · `tab`/flechas o clic para elegir personaje · `m` mensaje al equipo · `s` saludar · `d`/`p` demos · `r` reiniciar · `esc` soltar.

**Requisitos de la terminal:** al menos 60×18 (se ve bien desde 120×36). Con *truecolor* se ve mejor: iTerm2, Ghostty, WezTerm, Kitty, la terminal de VS Code y la de Claude lo tienen. En las demás se usan 256 colores; se fuerza con `--color truecolor|256`.

La misma oficina se puede ver en el navegador en `http://127.0.0.1:4317`.

## Enviar tareas a tus agentes

Desde la oficina también se le puede pedir trabajo al agente:

- **En la terminal:** `t` abre el compositor, `tab` elige el destino y `Enter` envía. `x` cancela la última tarea en curso.
- **En la web:** el formulario "Tarea para un agente".
- **Desde la CLI:** `dev-team-office task "Agrega paginación" --agent pi`. Sin argumentos muestra a quién se le puede enviar.

| Destino | Cómo llega |
|---|---|
| **Pi** con sesión abierta | Al instante. La extensión llama `pi.sendUserMessage()`, y si Pi está ocupado queda como follow-up |
| **OpenCode** con sesión abierta | Al instante. El plugin la envía con `client.session.prompt()`; sin sesión conocida, la escribe en el prompt del TUI |
| **Claude Code** (sesión existente) | En cola. La entrega su hook `Stop` cuando Claude termina el turno en curso, y Claude sigue con ella. Claude Code no permite inyectar mensajes en una sesión interactiva desde fuera: si la sesión está esperando tu mensaje, la tarea llega al terminar el siguiente turno |
| **Nuevo Claude / OpenCode / Pi** | La oficina lanza `claude -p`, `opencode run` o `pi -p` en el directorio por defecto. Sus hooks o plugins reportan el trabajo como en cualquier sesión |

Para recibir tareas, Pi y OpenCode necesitan la extensión o el plugin actualizados (ver Integraciones). Claude Code necesita el hook `Stop` del `settings.example.json`.

Ten en cuenta que `claude -p` lanzado por la oficina usa `--permission-mode acceptEdits`: edita archivos sin preguntar y deniega lo demás que necesite permiso. Para cambiarlo, o para fijar el directorio de trabajo, usa `~/.dev-team-office/config.json` (ver [docs/api.md](docs/api.md#tareas-para-los-agentes)).

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

### Claude Code (hooks)

1. Copia el bloque `hooks` de [`integrations/claude-code/settings.example.json`](integrations/claude-code/settings.example.json) en `~/.claude/settings.json` (global) o en `.claude/settings.json` (proyecto).
2. Reemplaza `/ABSOLUTE/PATH/TO/` por la ruta real de este repo.

[`hook.sh`](integrations/claude-code/hook.sh) reenvía el JSON del hook con `curl`: por el socket Unix si existe y, si no, por HTTP. Siempre sale con 0, así que si la oficina está apagada Claude Code sigue igual. Para otra URL o socket, usa `DEV_TEAM_OFFICE_URL` o `DEV_TEAM_OFFICE_SOCKET`.

Las tareas paralelas se identifican por `tool_use_id`/`agent_id`, así que cada una cae en su personaje y no se duplican.

### OpenCode

Copia [`integrations/opencode/dev-team-office.js`](integrations/opencode/dev-team-office.js) a `.opencode/plugin/` o `~/.config/opencode/plugin/`.

### Pi

```bash
mkdir -p ~/.agents/skills ~/.pi/agent/extensions
cp integrations/pi/dev-team-office.ts ~/.pi/agent/extensions/
cp -r integrations/pi/skills/dev-team-office ~/.agents/skills/
```

- **Extensión** ([`dev-team-office.ts`](integrations/pi/dev-team-office.ts)): reporta sola el prompt, las herramientas y el fin del agente.
- **Skill** ([`skills/dev-team-office`](integrations/pi/skills/dev-team-office/SKILL.md)): Pi declara qué rol tiene el turno y en qué fase está, por ejemplo `arquitecto → qa RED → backend implementa → qa GREEN → review → po acepta`. Cada traspaso se anima en la oficina, y las herramientas se atribuyen al rol de turno. El catálogo de eventos y los flujos están en [docs/eventos-por-rol.md](docs/eventos-por-rol.md).

### Otros agentes

Usa el formato genérico por WebSocket o por `POST /v1/events/<nombre>` (ver [docs/api.md](docs/api.md)). Para traducir un formato nativo en el servidor (como se hace con Claude Code), agrega un adaptador en [`server/adapters.js`](server/adapters.js).

## Estructura

```
bin/dev-team-office.js  el ejecutable: subcomandos open, serve, watch, status, demo, send
server/server.js        API HTTP + WebSocket en TCP y socket Unix
server/adapters.js      payload nativo → formato genérico
server/office.js        estado: sesiones, todos, subagentes, turnos, bitácora
server/roles.js         qué personaje representa cada herramienta/archivo/comando
server/tasks.js         tareas hacia los agentes: registro, cola, entrega y ejecuciones lanzadas
server/demo.js          sesiones simuladas (Claude Code y flujo TDD de Pi)
public/sim.js           la simulación (personajes, rutas, reacciones); la comparten terminal y navegador
public/targets.js       a quién se le puede mandar una tarea (terminal y navegador)
tui/                    la oficina en la terminal: framebuffer de medios bloques, vista, teclado y ratón
public/game.js          la oficina en canvas, para el navegador
integrations/           Claude Code, OpenCode, Pi (extensión + skill)
docs/                   API y propuesta de eventos por rol
test/                   node --test
```

Para cambiar quién hace qué, edita las reglas de [`server/roles.js`](server/roles.js).
