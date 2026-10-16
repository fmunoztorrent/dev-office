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

## Agentes (el mantenedor) y prompts

Un agente es una ruta completa + el CLI que la atiende (`claude-code`, `opencode` o `pi`). Se guarda en la base SQLite de la oficina (`~/.dev-team-office/office.db`). Lo que trae su ruta (Errementari, comandos, prompts, `.devteam/`) se detecta en cada consulta: son sus `entries`, las entradas por las que un prompt arranca el pipeline de su harness.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/agents` | | `{ agents }`: los registrados y las sesiones abiertas sin registrar (`registered: false`) |
| `POST` | `/v1/agents/detect` | `{ path }` | `{ exists, name, harnesses, kinds, entries }`: lo que hay en esa ruta, sin guardar nada |
| `POST` | `/v1/agents` | `{ path, harness, name?, bin?, args? }` | `201 { ok, agent }` |
| `GET` | `/v1/agents/<id>` | | `{ agent, prompts }`: con su historial |
| `PUT` | `/v1/agents/<id>` | lo que cambie: `{ path?, harness?, name?, bin?, args? }` | `{ ok, agent }` |
| `DELETE` | `/v1/agents/<id>` | | `{ ok }` (su carpeta no se toca) |
| `POST` | `/v1/agents/<id>/prompt` | `{ text, entry?, session? }` | `{ ok, task }` o `{ ok, run }` |
| `POST` | `/v1/run` | `{ target, entry?, text, session? }` | Igual, para cualquier agente de `/v1/agents` (también una sesión sin registrar: `session:<id>`) |
| `GET` | `/v1/prompts?agent=<id>&limit=` | | `{ prompts }`: el historial |

Cada agente de `/v1/agents` trae:

```jsonc
{
  "id": "errementari-claude-code", "name": "Errementari", "path": "/Users/yo/Workspace/Errementari", "harness": "claude-code",
  "registered": true, "exists": true, "available": true,          // available: su CLI está en el PATH
  "kinds": ["Errementari 2.1.0"],                                  // qué harness engineering detectó
  "entries": [                                                     // por dónde se arranca su pipeline
    { "id": "prompt", "label": "Prompt directo" },
    { "id": "errementari:bugfix", "label": "Errementari · bugfix", "command": "task", "prefix": "bug: ",
      "stages": [{ "role": "analyst", "phase": "analiza", "name": "Triage + SPDD Analysis + Canvas", "agent": "spec" }, …] },
    { "id": "devteam:feature-tdd", "label": "Pipeline · Feature con TDD", "needsSession": true, "stages": [...] }
  ],
  "sessions": [{ "session": "pi-1234", "agent": "pi", "live": true, "label": "Pi · sesión abierta" }],
  "roles": { "spec": "analyst", "architect": "tl", "qa": "qa", "pipeline": "manager" }
}
```

`session` en un prompt: el id de una sesión abierta en esa ruta, `null` para forzar una sesión nueva, u omitido (la abierta si hay; si no, una nueva). Una entrada `devteam:*` necesita una sesión abierta. Por WebSocket: `{ "type": "run", target, entry, text, session?, ref? }`.

`bin` y `args` (el ejecutable y sus argumentos para las sesiones nuevas) sólo se definen en el agente registrado: `POST /v1/tasks` no los acepta.

## Pipelines de `.devteam/`

La oficina es el frontend: los pipelines de `.devteam/` los corre la sesión del agente, dentro de sí misma.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/projects` | | `{ projects }`: por directorio, con sus pipelines y las sesiones (`hosts`) que pueden correr cada uno |
| `POST` | `/v1/agents/announce` | `{ agent, session, cwd, project }` | `{ ok }`. Lo usa el hook de Claude Code; Pi y OpenCode anuncian al registrarse por WebSocket |
| `GET` | `/v1/pipelines` | | `{ runs, projects }`: estado de cada ejecución y de sus etapas |
| `POST` | `/v1/pipelines` | `{ pipeline, task, session?, agent? }` | `{ ok, run }` |
| `POST` | `/v1/pipelines/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/pipelines/<id>/update` | `{ status, detail?, stages? }` (lo envía el agente) | `{ ok }` |

Formato y protocolo con los agentes: [pipelines.md](pipelines.md).

## ⚙ Ajustes

| Método | Ruta | Cuerpo |
|---|---|---|
| `GET` | `/v1/settings` | Responde `{ office: { file, appearance } }` (`file`: la base SQLite) |
| `PUT` | `/v1/settings` | `{ appearance: { rol: { name?, title?, shirt?, pants?, hair?, skin?, long?, beard?, glasses? } \| null } }` |

- **Validación:** todo se valida antes de escribir. Si hay un error, la respuesta es `400 { error }` y no se toca nada.
- **En vivo:** al cambiar la apariencia el servidor difunde `{ type: "appearance", appearance }`, y al cambiar los agentes o las sesiones `{ type: "targets", targets }`.

## Tareas para los agentes

La oficina también funciona al revés: puedes mandarle una tarea al agente.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/tasks` | | `{ tasks, agents, launchers, defaultCwd }` (`launchers[].available`: hay un agente conectado que puede lanzar) |
| `POST` | `/v1/tasks` | `{ text, agent, session?, mode?: "session" \| "launch", cwd? }` | `{ ok, task }` o `{ ok: false, error }` |
| `POST` | `/v1/tasks/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/hooks/claude-code` | JSON del hook | Lo que la oficina tiene para esa sesión: `{ task?: { id, text }, pipeline?: { id, pipeline, task }, cancel?: [id] }`. Qué hacer con eso lo decide el hook ([`hook.mjs`](../integrations/claude-code/hook.mjs)) |

`agent` es `pi`, `opencode` o `claude-code`. Cómo llega la tarea en cada caso:

| `mode` | Pi / OpenCode | Claude Code |
|---|---|---|
| `session` (por defecto) | Inmediata a la sesión conectada. Pi la recibe con `pi.sendUserMessage` (como follow-up si está ocupado) y OpenCode con `client.session.prompt` | En cola. Cuando Claude termina su turno, el hook `Stop` responde `{"decision":"block","reason":"<tarea>"}` y Claude sigue con ella. Si la sesión está esperando tu mensaje, la entrega ocurre al terminar el siguiente turno |
| `launch` | La oficina abre `opencode run "<tarea>"` / `pi -p "<tarea>"` en `cwd` | La oficina abre `claude -p "<tarea>" --permission-mode acceptEdits` en `cwd` |

Estados de una tarea: `queued` → `sent` → `running` → `done`, `failed` o `cancelled`. La tarea se pasa como un único argumento, sin shell, así que su texto nunca se interpreta como comando.

### Protocolo para agentes (plugins y extensiones)

Un agente que quiere recibir tareas abre `ws://127.0.0.1:4317/v1/ws` y se registra:

```jsonc
→ { "type": "register", "agent": "pi", "session": "pi-1234", "cwd": "/ruta", "pid": 1234,
    "can": ["task", "pipeline"], "project": { "dir", "name", "pipelines": [...] } }
   // se puede repetir cuando cambia de sesión
← { "type": "task", "id": "t3", "text": "Agrega paginación", "session": "pi-1234" }
→ { "type": "task_update", "id": "t3", "status": "accepted" }
   // también done | failed (con error)
← { "type": "task", "id": "t4", "text": "/task bug: …", "command": "task", "args": "bug: …" }
   // un comando del harness: Pi lo expande, OpenCode lo corre con session.command
← { "type": "pipeline", "id": "p1", "session": "pi-1234", "pipeline": "feature-tdd", "task": "…" }
→ { "type": "pipeline_update", "id": "p1", "status": "running", "stages": [...] }
← { "type": "pipeline_cancel", "id": "p1" }
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
