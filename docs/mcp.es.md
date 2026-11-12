# El servidor MCP

[English](mcp.md) · **Español**

`dev-team-office mcp` es un servidor [MCP](https://modelcontextprotocol.io) por stdio (JSON-RPC 2.0, un
mensaje por línea; versiones del protocolo 2024-11-05 a 2025-11-25). Le da a cualquier agente con MCP
las herramientas para trabajar con la oficina sin conocer su API: registrar proyectos, ver qué trae
cada uno, contar en qué fase está y mandarle trabajo a otro agente.

`dev-team-office setup` lo registra solo en Claude Code, Codex, OpenCode, Pi, Gemini CLI y Cursor. Esta
página sirve para entender qué hace y para registrarlo a mano en otro cliente.

## Herramientas

| Herramienta | Argumentos | Qué hace |
|---|---|---|
| `join_office` | `path?`, `office?`, `name?`, `harness?`, `open?`, `team?` | **Todo en un paso** para sumar un proyecto al juego: levanta la oficina si no corre, registra la raíz del repo (la carpeta con `.git` que contiene `path`) con el agente que llama, le enseña a su sesión qué subagente es qué personaje y devuelve la URL y el equipo (`team`: cada subagente con su `role`, su personaje y cómo se dedujo: `declared`, `name` o `description`). Los roles del pack `team` (por defecto `example`; `none`: ninguno) que no cubre ningún subagente del agente (ni en el proyecto ni en su carpeta de usuario) se instalan en el proyecto, en su formato, y lo cuenta en `given` (`{ team, dir, files, agents, whole, fresh }`; `whole`: no tenía ninguno; `fresh`: la carpeta de agentes no existía). Idempotente |
| `office_status` | — | ¿Está corriendo? URL, versión, oficinas, proyectos registrados y sesiones abiertas |
| `office_start` | `open?` | La levanta en segundo plano si no está (`dev-team-office serve`, bitácora en `~/.dev-team-office/office.log`) y devuelve la URL; con `open`, abre el navegador |
| `detect_project` | `path?` | Qué trae una carpeta: harnesses, entradas (pipelines, comandos, prompts) y el rol de cada subagente (`roles`, `roleIssues`) |
| `register_project` | `path?`, `harness?`, `name?`, `office?`, `instructions?` | Registra la carpeta con el CLI que la atiende. `harness` por defecto es el del cliente (por su `clientInfo.name`); `office` se busca por id o nombre y se crea si no existe. Idempotente |
| `list_projects` | `office?` | Los proyectos registrados |
| `update_project` | `id`, `name?`, `path?`, `harness?`, `office?`, `instructions?` | Cambia un proyecto; sus `instructions` (cómo trabajar con él) van arriba de cada encargo, pipeline y pregunta a su carpeta |
| `remove_project` | `id` | Lo quita del registro (no toca sus archivos) |
| `list_offices` | — | Los departamentos (oficinas: equipos o dominios), con sus indicaciones |
| `create_office` | `name`, `timezone?`, `location?`, `instructions?` | Un departamento nuevo, con su zona IANA (hora, luz y clima) y cómo se trabaja ahí |
| `update_office` | `id`, `name?`, `timezone?`, `location?`, `instructions?`, `autonomy?` | El mantenedor de departamentos: cambia un departamento (`autonomy`: `guided`, `balanced`, `autonomous`, o vacía para la de la empresa) |
| `get_instructions` | `path?` | Cómo trabajar con la carpeta de un proyecto: las indicaciones de su departamento y las suyas (las mismas que van arriba de cada encargo) |
| `report_activity` | `kind`, `text?`, `role?`, `phase?`, `from?`, `todos?`, `roles?`, `cwd?` | `task` · `phase` · `phase_end` · `todos` · `waiting` · `error` · `turn_end` · `done` · `chat` · `agent_roles`. Sin oficina no falla: devuelve `delivered: false` |
| `send_task` | `project` (id o ruta), `text`, `entry?`, `newSession?` | Le manda un prompt al agente de un proyecto registrado, por una entrada de su harness |
| `open_pane` | `command?` \| `agent?` + `prompt?`, `role?`, `title?`, `direction?` | Dentro de herdr: abre un pane con una actividad y se lo cuenta a la oficina |
| `map_impact` | `text`, `offices?`, `projects?` | Antes de una directiva: los departamentos, proyectos y componentes que toca un pedido (por lo que nombra, más los que elijas), y lo que nombra que no está en el mapa. Sólo lectura |
| `send_directive` | `text`, `title?`, `offices?` (ids o nombres, o `["all"]`), `projects?` (ids o rutas), `answers?` | **La dirección:** una orden para varias oficinas o proyectos. Va a los proyectos que encuentra su mapa de impacto (y a los elegidos). Si nombra algo que no está en el mapa («el servicio de notificaciones»), no sale: la herramienta lista las preguntas, el agente se las hace al usuario y la vuelve a llamar con `answers: [{ name, action: exists \| create \| department \| ignore, project?, path?, department? }]`. El agente de cada proyecto recibe un encargo con su parte (empieza con 🏛) y los componentes que toca (y los nuevos que hay que crear); la oficina sigue cada parte y, cuando terminan todas, archiva el acta. Un departamento que todavía no existe es un error que dice cómo crearlo (`create_office`) |
| `list_directives` | — | Las últimas directivas, cómo va cada proyecto y qué hace cada oficina ahora |
| `daily` | `office?`, `all?` | La daily a pedido, para contarle al usuario lo último: qué hizo cada personaje desde la daily anterior, en qué está ahora, qué lo espera y qué sigue abierto (en el idioma de la oficina). Junta al equipo en la mesa y guarda el acta; `all`: todos los departamentos |
| `search_knowledge` | `query?`, `kind?`, `limit?` | **El archivo (su base de conocimiento):** con una pregunta, los fragmentos que la contestan (del proyecto del agente, de su departamento y de la empresa), cada uno con un id como `[k12§3]` para citarlo, y los términos del glosario que tocan; una pregunta sin respuesta queda como vacío. Sin pregunta (o con `kind`), las entradas. Funciona también con la oficina apagada (sólo por palabras) |
| `get_knowledge` | `id` (o una cita como `k12§3`) o `name` | Una entrada entera |
| `get_knowledge` | `id` \| `name` + `kind?` | Una entrada completa (una skill o un conector también por su nombre). Cuenta como una lectura |
| `save_knowledge` | `kind`, `title`, `body?`, `name?`, `tags?`, `office?`, `command?` + `args?` \| `url?`, `id?` | Guarda una nota, decisión, documento, skill (`name`, `title`: qué hace y cuándo usarla, `body`: sus instrucciones) o conector (`name`, `command`/`args` o `url`; sin secretos). El mismo `name` (o el `id`) la actualiza. Funciona también con la oficina apagada |
| `list_teams` · `install_team` | `team`, `harness`, `project?` | Los team packs (un subagente por rol), para Pi, Claude Code, OpenCode o Codex |

Los resultados son texto: una línea para leer y, debajo, el JSON con los datos.

**¿Qué sesión?** `report_activity` no necesita el id de la sesión: el evento lleva la carpeta (`cwd`) y
la oficina lo junta con la sesión más reciente de esa carpeta (la que reporta su hook). Si el entorno
trae `DEV_TEAM_OFFICE_SESSION` o `CLAUDE_CODE_SESSION_ID`, se usa ese. `DEV_TEAM_OFFICE_OFFICE` fija la
oficina.

**Con la oficina apagada**, `register_project`, `create_office` y compañía escriben en la base SQLite
(`~/.dev-team-office/office.db`); al abrir la oficina, ahí están.

## Prompts

| Prompt | Argumentos | Qué hace |
|---|---|---|
| `join` | `office?` | Le pide al agente que llame a `join_office` y te muestre la URL, el proyecto y el equipo. En Claude Code es el comando `/mcp__dev-team-office__join`; en otros clientes, el que muestre sus prompts |

Lo mismo desde la terminal: `dev-team-office join [ruta] [--agent <cli>] [--office <oficina>] [--team <pack>|--no-team] [--open]`. En Pi, `/office`.

## Registrarlo a mano

`setup` usa un lanzador estable que recuerda qué Node usar: `~/.dev-team-office/bin/dev-team-office`.
Con eso, en cualquier cliente el servidor es `<lanzador> mcp`.

**Claude Code**

```bash
claude mcp add --scope user dev-team-office -- ~/.dev-team-office/bin/dev-team-office mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.dev-team-office]
command = "/Users/tu-usuario/.dev-team-office/bin/dev-team-office"
args = ["mcp"]
startup_timeout_sec = 20
```

**OpenCode** (`~/.config/opencode/opencode.json`)

```json
{ "mcp": { "dev-team-office": { "type": "local", "command": ["/Users/tu-usuario/.dev-team-office/bin/dev-team-office", "mcp"], "enabled": true } } }
```

**Pi** (`~/.pi/agent/mcp.json`: el MCP propio de Pi 1.x y pi-mcp-adapter leen el mismo archivo), **Gemini CLI** (`~/.gemini/settings.json`), **Cursor** (`~/.cursor/mcp.json`), **Claude Desktop** y otros con `mcpServers`:

```json
{ "mcpServers": { "dev-team-office": { "command": "/Users/tu-usuario/.dev-team-office/bin/dev-team-office", "args": ["mcp"] } } }
```

Como **plugin de Claude Code** no hace falta nada: el plugin trae el servidor (`node ${CLAUDE_PLUGIN_ROOT}/bin/dev-team-office.js mcp`).

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DEV_TEAM_OFFICE_URL` | La oficina (por defecto `http://127.0.0.1:4317`) |
| `DEV_TEAM_OFFICE_SOCKET` | Su socket Unix (por defecto `~/.dev-team-office/office.sock`; se prueba primero) |
| `DEV_TEAM_OFFICE_DB` | La base, cuando la oficina está apagada |
| `DEV_TEAM_OFFICE_OFFICE` | La oficina a la que van los reportes |
| `DEV_TEAM_OFFICE_PORT` | El puerto con que `office_start` la levanta |
