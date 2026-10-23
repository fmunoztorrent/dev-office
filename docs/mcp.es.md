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
| `register_project` | `path?`, `harness?`, `name?`, `office?` | Registra la carpeta con el CLI que la atiende. `harness` por defecto es el del cliente (por su `clientInfo.name`); `office` se busca por id o nombre y se crea si no existe. Idempotente |
| `list_projects` | `office?` | Los proyectos registrados |
| `update_project` | `id`, `name?`, `path?`, `harness?`, `office?` | Cambia un proyecto |
| `remove_project` | `id` | Lo quita del registro (no toca sus archivos) |
| `list_offices` | — | Las oficinas (equipos o dominios) |
| `create_office` | `name`, `timezone?`, `location?` | Una oficina nueva, con su zona IANA (hora, luz y clima) |
| `report_activity` | `kind`, `text?`, `role?`, `phase?`, `from?`, `todos?`, `roles?`, `cwd?` | `task` · `phase` · `phase_end` · `todos` · `waiting` · `error` · `turn_end` · `done` · `chat` · `agent_roles`. Sin oficina no falla: devuelve `delivered: false` |
| `send_task` | `project` (id o ruta), `text`, `entry?`, `newSession?` | Le manda un prompt al agente de un proyecto registrado, por una entrada de su harness |
| `open_pane` | `command?` \| `agent?` + `prompt?`, `role?`, `title?`, `direction?` | Dentro de herdr: abre un pane con una actividad y se lo cuenta a la oficina |
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
