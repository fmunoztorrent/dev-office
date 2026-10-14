# API de integración

Cualquier proceso (hooks de un agente, plugins, scripts, otra app) puede enviarle eventos a la oficina y leer su estado.

| Transporte | Dirección | Para qué |
|---|---|---|
| HTTP/JSON | `http://127.0.0.1:4317/v1/…` | Enviar eventos desde cualquier lenguaje o desde `curl` |
| WebSocket | `ws://127.0.0.1:4317/v1/ws` | Recibir el estado en vivo y enviar eventos o comandos por el mismo canal |
| Socket Unix | `~/.dev-team-office/office.sock` | La misma API HTTP y WebSocket, sin puerto TCP y accesible sólo para tu usuario |

El puerto se cambia con `--port` o `$DEV_TEAM_OFFICE_PORT`; el socket, con `--socket` o `$DEV_TEAM_OFFICE_SOCKET`.

## Por qué HTTP + WebSocket y no gRPC

- **Quien produce eventos son hooks de shell y plugins JS.** Un hook de Claude Code es un comando: con HTTP basta un `curl`, mientras que gRPC exige un cliente generado desde `.proto` o una herramienta aparte como `grpcurl`.
- **El streaming que hace falta es en un solo sentido y pequeño:** el servidor empuja eventos a los visores. WebSocket lo cubre, funciona en el navegador (la vista web lo usa) y existe en cualquier lenguaje.
- **Es local.** No hay red entre servicios que justifique HTTP/2, protobuf ni contratos generados. El esquema JSON de abajo es el contrato, versionado con el prefijo `/v1`.
- **El socket Unix es la vía idiomática de IPC local en macOS:** permisos de archivo (`0600`), sin choques de puertos, y `curl --unix-socket` lo soporta.

## Endpoints

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/health` | | `{ ok, name, version, pid, uptime, url, socket }` |
| `GET` | `/v1/state` | | `{ sessions, roles, log }` |
| `POST` | `/v1/events/<source>` | Un evento o un array de eventos | `{ ok, accepted, ids }` |
| `POST` | `/v1/events?source=<source>` | Igual que la anterior | Igual |
| `POST` | `/v1/messages` | Un mensaje del protocolo WebSocket (`chat`, `poke`, `command`, `event`) | `{ ok, … }` |
| `POST` | `/v1/commands` | `{ action: "demo" \| "demo-pi" \| "stop-demo" \| "reset", speed? }` | `{ ok }` |
| `GET` | `/v1/ws` | Upgrade a WebSocket | Ver abajo |

`<source>` dice cómo interpretar el cuerpo:

- **`claude-code`:** el JSON nativo que los hooks de Claude Code reciben por stdin. Se puede enviar tal cual.
- **Cualquier otro nombre** (`pi`, `opencode`, `mi-agente`…): el formato genérico, y el nombre aparece como origen en la bitácora.

Las rutas antiguas (`POST /event/<source>`, `GET /api/state`, `/ws`) siguen funcionando.

## Tareas para los agentes

La oficina también funciona al revés: puedes mandarle una tarea al agente.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/tasks` | | `{ tasks, agents, launchers, defaultCwd }` |
| `POST` | `/v1/tasks` | `{ text, agent, session?, mode?: "session" \| "launch", cwd? }` | `{ ok, task }` o `{ ok: false, error }` |
| `POST` | `/v1/tasks/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/hooks/claude-code` | JSON del hook | Lo que el hook debe escribir en stdout (casi siempre vacío) |

`agent` es `pi`, `opencode` o `claude-code`. Cómo llega la tarea en cada caso:

| `mode` | Pi / OpenCode | Claude Code |
|---|---|---|
| `session` (por defecto) | Inmediata a la sesión conectada. Pi la recibe con `pi.sendUserMessage` (como follow-up si está ocupado) y OpenCode con `client.session.prompt` | En cola. Cuando Claude termina su turno, el hook `Stop` responde `{"decision":"block","reason":"<tarea>"}` y Claude sigue con ella. Si la sesión está esperando tu mensaje, la entrega ocurre al terminar el siguiente turno |
| `launch` | `opencode run "<tarea>"` / `pi -p "<tarea>"` en `cwd` | `claude -p "<tarea>" --permission-mode acceptEdits` en `cwd` |

Estados de una tarea: `queued` → `sent` → `running` → `done`, `failed` o `cancelled`. Las ejecuciones lanzadas guardan sus últimas líneas de salida en `output`.

Los comandos de lanzamiento y el directorio por defecto se cambian en `~/.dev-team-office/config.json`. La tarea se pasa como un único argumento (`{task}`) sin shell, así que su texto nunca se interpreta como comando:

```json
{
  "cwd": "~/Workspace/mi-proyecto",
  "launchers": {
    "claude-code": ["claude", "-p", "{task}", "--permission-mode", "auto"],
    "pi": ["pi", "-p", "{task}"]
  }
}
```

### Protocolo para agentes (plugins y extensiones)

Un agente que quiere recibir tareas abre `ws://127.0.0.1:4317/v1/ws` y se registra:

```jsonc
→ { "type": "register", "agent": "pi", "session": "pi-1234", "cwd": "/ruta", "pid": 1234 }
   // se puede repetir cuando cambia de sesión
← { "type": "task", "id": "t3", "text": "Agrega paginación", "session": "pi-1234" }
→ { "type": "task_update", "id": "t3", "status": "accepted" }
   // también done | failed (con error)
```

Una conexión registrada no recibe la difusión de eventos de la oficina, sólo sus tareas. Desde un visor, `{ "type": "task", text, agent, session?, mode?, cwd?, ref? }` crea una tarea; con `ref`, el servidor responde con un `ack`.

## Formato genérico de un evento

```jsonc
{
  "session": "id-de-sesion",          // agrupa los eventos de una misma tarea
  "kind": "tool_start",
  "tool": "Edit",                     // tool_start / tool_end
  "input": { "file_path": "src/App.tsx" },  // decide el personaje: file_path | filePath | path | command
  "text": "texto libre",
  "ok": true,                         // tool_end: false si falló
  "role": "frontend",                 // opcional: fuerza el personaje
  "phase": "red",                     // kind: phase
  "from": "tl",                       // kind: phase, opcional
  "todos": [{ "content": "…", "status": "pending|in_progress|completed" }],
  "toolUseId": "…", "agentId": "…", "agentType": "Explore",
  "cwd": "/ruta/del/proyecto"
}
```

| `kind` | Qué representa | En la oficina |
|---|---|---|
| `session_start` / `session_end` | Abre o cierra una sesión del agente | El manager saluda o se despide |
| `task` | El pedido del usuario | La PO lo presenta en la pizarra |
| `thinking` | El modelo está pensando | El rol de turno piensa 💭 |
| `tool_start` / `tool_end` | Una herramienta empieza o termina | El rol que corresponde trabaja; si falla, aparece el bug o la ayuda del TL |
| `subagent_start` / `subagent_end` | Una subtarea delegada | El manager lleva la tarjeta; luego "✔ Listo" |
| `todos` | La lista de tareas del agente | El kanban de la pizarra |
| `phase` / `phase_end` | Un rol toma o suelta el turno (ver [eventos-por-rol.md](eventos-por-rol.md)) | Etiqueta ▶FASE y traspaso de tarjeta |
| `dispatch` | Tarea enviada desde la oficina (la emite el servidor) | La PO lleva la tarjeta a la pizarra |
| `waiting` | El agente espera al usuario | Banner naranja; el manager levanta la mano |
| `error` | Error general | El personaje se bloquea |
| `compact` | Compactación de contexto | El manager ordena notas |
| `done` | Fin de la tarea | Celebración en la mesa |

Roles: `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`. También se aceptan alias como `arquitecto`, `tester` o `ux`.

## Protocolo WebSocket

Al conectar, el servidor envía:

```jsonc
{ "type": "hello", "name": "dev-team-office", "version": "0.3.0", … }
{ "type": "snapshot", "state": { "sessions": [...], "roles": {...}, "log": [...] } }
```

Luego, por cada evento:

```jsonc
{ "type": "event", "event": { "id", "ts", "kind", "role", "text", "session", "source", "ok", "phase"?, "from"? }, "session": { …resumen… } }
```

Tras un `reset` llega un `snapshot` nuevo.

El cliente puede enviar:

```jsonc
{ "type": "event", "source": "mi-agente", "payload": { …evento… }, "id": 1 }
{ "type": "chat", "text": "¡Buen trabajo!", "role": "qa", "from": "Fabián" }
{ "type": "poke", "role": "backend" }
{ "type": "command", "action": "demo" | "demo-pi" | "stop-demo" | "reset" }
```

Si el mensaje trae `id`, el servidor responde `{ "type": "ack", "id", "ok", "accepted"? }`. Así un cliente puede confirmar que su evento entró.

## Ejemplos

```bash
# HTTP
curl -s localhost:4317/v1/events/mi-agente -H 'content-type: application/json' \
  -d '{"session":"s1","kind":"phase","role":"qa","phase":"red","text":"2 tests fallan"}'

# Socket Unix
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/state

# Desde la propia CLI
dev-team-office send tool_start --tool Edit --file src/components/Nav.tsx --source mi-agente
dev-team-office send chat --text "¡Vamos equipo!"
```

```python
# Python, sólo biblioteca estándar
import json, urllib.request
req = urllib.request.Request("http://127.0.0.1:4317/v1/events/mi-agente",
    data=json.dumps({"session": "py", "kind": "task", "text": "Migrar a Postgres"}).encode(),
    headers={"content-type": "application/json"})
print(urllib.request.urlopen(req).read())
```

```js
// Node: escuchar todo lo que pasa en la oficina
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:4317/v1/ws');
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'event') console.log(m.event.role, m.event.kind, m.event.text);
});
```

## Seguridad

- **Sólo localhost.** Por defecto escucha en `127.0.0.1`. `--host 0.0.0.0` la expone en la red y queda bajo tu responsabilidad.
- **Navegadores.** Se rechazan las peticiones y conexiones WebSocket con un `Origin` de otro sitio y los `Host` que no son locales (DNS rebinding). Así una página web abierta no puede leer lo que hace tu agente ni inyectar eventos. Los clientes que no son navegadores (curl, hooks, plugins) no envían `Origin` y no se ven afectados.
- **Socket Unix.** Se crea con permisos `0600` dentro de `~/.dev-team-office/` (`0700`).
- **Terminal.** La interfaz de terminal elimina los caracteres de control del texto de los eventos, así que un evento no puede inyectar secuencias de escape.
- **Tamaño.** Un cuerpo puede pesar como máximo 16 MB, porque `PostToolUse` de Claude Code incluye la salida completa de la herramienta.
