# Integraciones

[English](integrations.md) · **Español**

Cómo le habla cada agente a la oficina, qué le instala `dev-team-office setup` y las entradas para cualquier otro programa. Para sumar un harness que la oficina todavía no conoce, ver [conectar un harness](connect-a-harness.es.md).

## Qué conecta `setup`

`dev-team-office setup` detecta los agentes por su comando o por su carpeta de configuración y a cada uno le deja lo suyo. Respeta lo que ya tenías (agrega sus entradas al lado de las tuyas, respalda cada archivo que toca en `<archivo>.dev-team-office.bak`, conserva los comentarios de un `opencode.jsonc`), es idempotente y `uninstall` quita exactamente lo que agregó.

| Agente | En vivo (lo que hace, en la oficina) | Servidor MCP | Skills |
|---|---|---|---|
| Claude Code | hooks en `~/.claude/settings.json` | `claude mcp add-json --scope user` (o `~/.claude.json`) | `~/.claude/skills/` |
| Codex | hooks en `~/.codex/hooks.json` (confía en ellos una vez con `/hooks`) | `[mcp_servers.dev-team-office]` en `~/.codex/config.toml` | `~/.agents/skills/` |
| OpenCode | plugin en `~/.config/opencode/plugins/` | `mcp` en `opencode.json(c)` | `~/.agents/skills/` |
| Pi | extensión en `~/.pi/agent/extensions/` (también reporta lo que hacen sus subagentes) | `~/.pi/agent/mcp.json` (Pi ≥ 1.0 o pi-mcp-adapter) | `~/.agents/skills/` |
| Gemini CLI | — | `mcpServers` en `~/.gemini/settings.json` | — |
| Cursor | — | `mcpServers` en `~/.cursor/mcp.json` | — |

**Las skills de la oficina van al paso de la oficina.** Cada una se instala con una marca de la versión que la puso (`.dev-team-office.json` en su carpeta), así que cada `setup`, y por eso cada `update`, la reemplaza entera (un archivo que la versión nueva dejó de traer no se queda), quita las que la oficina ya no trae y `doctor` avisa de una de otra versión. Una carpeta con el mismo nombre que no es de la oficina nunca se toca (setup lo dice). **Con el plugin de Claude Code**, las skills vienen dentro del plugin: `setup` y `update` le piden a la CLI de Claude Code que refresque su marketplace y actualice el plugin (`claude plugin marketplace update dev-office`, `claude plugin update dev-team-office@dev-office`; reinicia Claude Code para usarlo), quitan las copias sueltas que dejó un setup anterior en `~/.claude/skills`, y si la CLI no está te dicen esos dos comandos.

Los hooks y el MCP apuntan a un lanzador estable (`~/.dev-team-office/bin/dev-team-office`) que recuerda qué Node usar, así funcionan también desde apps de escritorio con un PATH mínimo. Un hook nunca rompe a su agente: si la oficina está apagada, no hace nada. `--only codex,claude` conecta sólo esos; `--dry-run` muestra lo que haría.


Para conectar cualquier otro harness (o entender el contrato de roles), ver [docs/connect-a-harness.es.md](connect-a-harness.es.md). El servidor MCP está en [docs/mcp.es.md](mcp.es.md).

## El servidor MCP

`dev-team-office mcp` (lo registra `setup`) le da a todo agente con MCP las herramientas de la oficina: `join_office` (todo en un paso), `register_project`, `send_task`, `send_directive` y `map_impact`, `get_architecture`, `declare_resource`, `search_knowledge`, `daily`, `loop_report`… Cada una, con sus parámetros: [mcp.es.md](mcp.es.md).

## Por agente

`dev-team-office setup` deja todo en su sitio y conectado (ver [Qué conecta `setup`](#qué-conecta-setup)). Las integraciones usan la misma librería ([`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs)), que se instala en `~/.dev-team-office/lib/`: lee `.devteam/`, arma el prompt de cada etapa, corre los gates, aplica los bucles y reporta todo a la oficina. La oficina es opcional: si está apagada, los agentes siguen igual.

### Claude Code (hooks)

`setup` copia [`hook.mjs`](../integrations/claude-code/hook.mjs) a `~/.dev-team-office/claude-code/` y agrega sus hooks a `~/.claude/settings.json`, junto a los tuyos (la plantilla es [`settings.example.json`](../integrations/claude-code/settings.example.json)). Como **plugin** ([`.claude-plugin/`](../.claude-plugin/plugin.json)) trae lo mismo, más el MCP y los skills; si están las dos cosas, el hook del plugin se calla para no duplicar eventos.

El hook reenvía cada evento (por el socket Unix si existe y, si no, por HTTP) con su oficina y su pane de herdr si los tiene, anuncia el proyecto y, en el `Stop`, entrega tareas y ejecuta los pipelines. Nunca escribe nada en stdout salvo la decisión del `Stop`, y siempre sale con 0. Para otra URL o socket, usa `DEV_TEAM_OFFICE_URL` o `DEV_TEAM_OFFICE_SOCKET`.

Las tareas paralelas se identifican por `tool_use_id`/`agent_id`, así que cada una cae en su personaje y no se duplican.

### Codex (hooks)

`setup` copia [`hook.mjs`](../integrations/codex/hook.mjs) a `~/.dev-team-office/codex/` y lo agrega a `~/.codex/hooks.json` para todos los eventos (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart/Stop`, `Stop`…). La oficina traduce las herramientas de Codex: `shell` → comando, `apply_patch` → edición del archivo, `update_plan` → la pizarra. Codex pide confiar una vez en los hooks nuevos (`/hooks`). Sus agentes en TOML (`.codex/agents/*.toml`) declaran su rol con `role = "backend"`.

### OpenCode

`setup` copia [`dev-team-office.js`](../integrations/opencode/dev-team-office.js) a `~/.config/opencode/plugins/` y registra el MCP en su `opencode.json(c)`.

### Pi

`setup` copia la extensión a `~/.pi/agent/extensions/` y los skills a `~/.agents/skills/` (el mismo lugar que leen Codex y OpenCode).

- **Extensión** ([`dev-team-office.ts`](../integrations/pi/dev-team-office.ts)): al abrir `pi` levanta la oficina si no está corriendo y registra el proyecto (`/office` a pedido); reporta el prompt, las herramientas y el fin del agente; recibe tareas y pipelines.
- **Subagentes** (gentle-pi, pi-subagents): cada uno es otro `pi` con la misma extensión. Reporta a la sesión del padre y su trabajo lo hace el personaje de su `role:` (por ejemplo, todo lo que hace `ex-qa` lo hace QA, en RED o GREEN según su etiqueta). La lista `todo` de gentle-pi va a la pizarra.
- **Skill** ([`skills/dev-team-office`](../skills/dev-team-office/SKILL.md), para cualquier harness): el agente declara qué rol tiene el turno y en qué fase está, por ejemplo `arquitecto → qa RED → backend implementa → qa GREEN → review → analyst acepta`. Cada traspaso se anima en la oficina, y las herramientas se atribuyen al rol de turno. El catálogo de eventos y los flujos están en [docs/events-by-role.es.md](events-by-role.es.md).

### Otros agentes

Usa el formato genérico por WebSocket o por `POST /v1/events/<nombre>` (ver [docs/api.es.md](api.es.md)). Para recibir pipelines, impleméntalo como las demás integraciones con `PipelineRun` de la librería común (protocolo en [docs/pipelines.es.md](pipelines.es.md#por-api)).

## API de integración

Cualquier proceso puede enviarle eventos a la oficina y escucharla:

- **HTTP/JSON** en `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state?office=`, `GET /v1/weather`, `GET|POST /v1/offices`, `GET|PUT /v1/settings`, `GET|PUT /v1/characters/<role>`, `PUT /v1/projects/instructions`, `GET|POST /v1/panes`, `GET /v1/services`, `POST /v1/commands`.
- **WebSocket** en `ws://127.0.0.1:4317/v1/ws`: estado en vivo y envío de eventos, con `ack` opcional.
- **Socket Unix** en `~/.dev-team-office/office.sock`: la misma API, accesible sólo para tu usuario.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/mi-agente \
  -d '{"session":"s1","kind":"task","text":"Migrar a Postgres"}'
```

El protocolo completo (eventos, mensajes WebSocket, ejemplos en Python y Node, y por qué no gRPC) está en [docs/api.es.md](api.es.md).
