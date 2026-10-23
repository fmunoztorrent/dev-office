# Pipelines: encargos con varias etapas

[English](pipelines.md) · **Español**

> **¿Tu proyecto ya trae su pipeline?** Si usas un harness como [Errementari](https://github.com/fmunoztorrent/errementari) (`/task` → spec → architect → qa → backend → qa → close), comandos de Claude/OpenCode o prompts de Pi, no necesitas nada de esto: registra la ruta en ⚙ › Agentes y el prompt arranca el pipeline de tu harness (ver el README, «Agentes»). Este documento es para definir pipelines propios en `.devteam/`.

Al hacer clic en la pizarra de la oficina se abre el diálogo **Nuevo encargo**. Desde ahí se manda una tarea directa a un agente, o se arranca un **pipeline**: una tarea que pasa por varias etapas, cada una en manos de un personaje del equipo, con su propio agente y su propio modelo. Lo que hace el agente por dentro se ve en el juego.

En la terminal el diálogo se abre con un clic en la pizarra o con `t`. Se usa con `tab` o `↑↓` para cambiar de campo, `◂▸` para cambiar la opción y `Enter` para enviar.

## El juego es el frontend, el agente es el backend

La oficina **no ejecuta nada**: no lanza procesos, no corre gates y no lee `.devteam/`. Todo eso lo hace el agente, con su integración:

1. Al conectarse, cada agente **anuncia** su proyecto y los pipelines que puede correr:
   - Pi y OpenCode, por WebSocket al registrarse;
   - Claude Code, desde su hook (`SessionStart`, `UserPromptSubmit`).
2. En el diálogo eliges el pipeline y **la sesión** que lo va a correr (las que lo anunciaron).
3. La oficina le pide el pipeline a esa sesión. El agente lee su `.devteam/`, lo ejecuta **dentro de su propia sesión**, etapa por etapa, y reporta cada fase, herramienta, gate y resultado. La oficina lo dibuja.

La lógica (orden, prompts de cada etapa, gates, bucles) está en una sola librería que usan las tres integraciones: [`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs). Se instala con:

```bash
dev-team-office install          # o: install pi | opencode | claude
```

## Dónde se define

Todo vive en el proyecto, junto a la configuración de cada harness:

```
mi-proyecto/
  .devteam/
    team.json                 quién es quién: rol → agente y modelo
    pipelines/
      feature-tdd.json        un archivo por pipeline
  .pi/agents/*.md             agentes de Pi (los mismos de su extensión subagent)
  .claude/agents/*.md         agentes de Claude Code
  .opencode/agents/*.md       agentes de OpenCode
```

Hay un ejemplo completo en [`examples/tienda`](../examples/tienda). El agente vuelve a leer `.devteam/` cada vez que arranca un pipeline, así que un cambio en los archivos se usa en el siguiente encargo. **⚙ Ajustes › Agentes** muestra lo que anuncia cada agente conectado.

## `team.json`

```jsonc
{
  "name": "Tienda",
  "harness": "pi",                          // harness por defecto para buscar agentes: pi | claude-code | opencode
  "roles": {                                // po, analyst, manager, tl, qa, backend, frontend, designer
    "tl": { "agent": "architect", "model": "anthropic/claude-opus-5-5" },
    "qa": { "agent": "tester", "model": "anthropic/claude-haiku-5-5" },
    "backend": { "agent": "backend-dev" }
  },
  "harnessOptions": {
    "claude-code": { "args": ["--permission-mode", "acceptEdits"], "bin": "/ruta/a/claude" }
  }
}
```

Los roles aceptan alias como `arquitecto`, `tester` o `ux`. `harnessOptions["claude-code"]` se usa en las etapas que Claude Code corre como proceso hijo (ver abajo).

## Un pipeline

```jsonc
{
  "name": "Feature con TDD",
  "description": "Arquitecto → QA en rojo → backend → QA en verde → review",
  "stages": [
    { "id": "diseno", "name": "Diseño técnico", "role": "tl", "phase": "arquitectura",
      "prompt": "Diseña cómo resolver: {{task}}. Deja el plan en docs/plan.md." },
    { "id": "red", "role": "qa", "phase": "red", "needs": ["diseno"],
      "check": { "run": "npm test", "expect": "fail" } },
    { "id": "impl", "role": "backend", "phase": "implementa", "needs": ["red"] },
    { "id": "green", "role": "qa", "phase": "green", "needs": ["impl"],
      "check": { "run": "npm test", "expect": "pass" },
      "onFail": { "goto": "impl", "max": 2 } },
    { "id": "review", "role": "tl", "phase": "review", "needs": ["green"],
      "harness": "claude-code", "agent": "code-reviewer", "model": "opus" }
  ]
}
```

| Campo de la etapa | Qué hace |
|---|---|
| `id`, `name` | Identificador y nombre visible |
| `role` | El personaje que la hace. Las herramientas del agente se le atribuyen a él mientras dura la etapa |
| `phase` | La fase del flujo por roles: arquitectura, red, green, implementa, review… (ver [events-by-role.es.md](events-by-role.es.md)) |
| `agent` | Un agente de `.pi/agents`, `.claude/agents` u `.opencode/agents`: su prompt de sistema se usa como la persona de la etapa |
| `model`, `thinking` | Modelo de la etapa. Sobrescriben lo de `team.json` y lo del archivo del agente. `"model": false` deja el de la sesión |
| `harness` | En qué carpeta buscar primero el agente. La etapa corre en el agente que recibió el pipeline |
| `needs` | Etapas que deben terminar antes. Las etapas corren **una a la vez**, en la sesión del agente, en un orden que respeta `needs` |
| `prompt` | Instrucción de la etapa. Variables: `{{task}}`, `{{previous}}` (resultados de las etapas de `needs`), `{{failure}}` (por qué falló el intento anterior), `{{<id>.output}}`, `{{project}}`. Si falta, se arma a partir del rol, la fase y la tarea |
| `check` | Gate al terminar la etapa: `run` es un comando de shell que el agente corre en el proyecto y `expect` dice si debe `pass` o `fail` (RED). `timeout` va en segundos |
| `onFail` | Si la etapa o su gate fallan, vuelve a `goto` (esa etapa y todo lo que depende de ella) hasta `max` veces, con la falla en `{{failure}}` |

Los `check` son comandos del propio proyecto, con la misma confianza que un script de `package.json`. El diálogo los muestra antes de arrancar. El "resumen" de una etapa es la última respuesta del agente en ese turno; es lo que reciben las etapas siguientes.

## Cómo lo corre cada agente

| Agente | Etapas | Cambio de modelo |
|---|---|---|
| **Pi** (extensión) | Cada etapa es un mensaje en la misma sesión (`sendUserMessage`); la siguiente empieza cuando Pi termina el turno (`agent_settled`) | `pi.setModel()` por etapa; al terminar vuelve al modelo con el que estaba |
| **OpenCode** (plugin) | Cada etapa es un `client.session.prompt` en la sesión | El `model` de cada prompt (`proveedor/modelo`) y su `agent` si es de OpenCode |
| **Claude Code** (hook) | Cada etapa es una continuación de la sesión: el hook `Stop` responde `{"decision":"block","reason":"<prompt de la etapa>"}` | Los hooks no pueden cambiar el modelo de la sesión: una etapa que pide **otro** modelo corre como `claude -p --model … [--agent …]` y su resultado vuelve al pipeline. Las que no piden modelo, o piden el de la sesión, siguen en la sesión |

En Claude Code el pipeline avanza en cada `Stop`: el estado se guarda en `~/.dev-team-office/claude-runs/<sesión>.json`. Un pipeline pedido desde la oficina se entrega cuando Claude termina el turno en curso; cancelar se aplica en el siguiente evento del hook. Configura el `Stop` con un `timeout` largo (el ejemplo usa 3600 s), porque ahí corren los gates y las etapas con otro modelo.

Para delegar en subagentes (por ejemplo, la extensión `subagent` de Pi), escribe el `prompt` de la etapa pidiéndolo y pon `"model": false` para que la sesión orqueste con su modelo. Ver `examples/tienda/.devteam/pipelines/subagentes-pi.json`. La oficina sabe qué subagente es qué rol, así que cuando Pi llama a `subagent` con `{ agent: "tester" }` el que se mueve es QA.

## Por API

```bash
curl -s localhost:4317/v1/projects                      # lo que anuncian los agentes, con quién puede correr cada pipeline
curl -s localhost:4317/v1/pipelines -H 'content-type: application/json' \
  -d '{"session":"pi-1234","pipeline":"feature-tdd","task":"Cancelar pedidos"}'
curl -s -X POST localhost:4317/v1/pipelines/p1/cancel
```

Sin `session`, la oficina se lo pide a la primera sesión que tenga ese pipeline (con `agent` puedes elegir el tipo). Por WebSocket: `{ "type": "pipeline_start", session?, agent?, pipeline, task, ref? }` y `{ "type": "pipeline_cancel", id }`. El estado llega como `{ "type": "pipelines", runs, projects }`.

Del lado del agente, el protocolo es:

| Mensaje | Dirección | Qué es |
|---|---|---|
| `{ type: "register", agent, session, cwd, can: ["task","pipeline","launch"], project }` | agente → oficina (WS) | Se presenta y anuncia su proyecto (`catalogEntry` de la librería) |
| `POST /v1/agents/announce { agent, session, cwd, project }` | hook → oficina | Lo mismo, para Claude Code (sin conexión permanente) |
| `{ type: "pipeline", id, session, pipeline, task }` | oficina → agente | Corre ese pipeline de tu `.devteam/` |
| `{ type: "pipeline_cancel", id }` | oficina → agente | Cancélalo |
| `{ type: "pipeline_update", id, status, detail, stages }` · `POST /v1/pipelines/:id/update` | agente → oficina | Estado para el panel |
| `POST /v1/events/<agente>` | agente → oficina | Lo que pasa: `phase`, `tool_start`, `tool_end`, `stage_end`, `todos`, `agent_roles`, `done`… |
