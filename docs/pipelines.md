# Pipelines: encargos con varias etapas

Al hacer clic en la pizarra de la oficina se abre el diálogo **Nuevo encargo**. Desde ahí se manda una tarea directa a un agente, o se arranca un **pipeline**: una tarea que pasa por varias etapas, cada una en manos de un personaje del equipo con su propio agente y su propio modelo. Lo que hace cada agente por dentro se ve en el juego.

En la terminal el diálogo se abre con un clic en la pizarra o con `t`. Se usa con `tab` o `↑↓` para cambiar de campo, `◂▸` para cambiar la opción y `Enter` para enviar.

## Dónde se define

Todo vive en el proyecto, junto a la configuración de cada harness:

```
mi-proyecto/
  .devteam/
    team.json                 quién es quién: rol → agente, modelo y harness
    pipelines/
      feature-tdd.json        un archivo por pipeline
  .pi/agents/*.md             agentes de Pi (los mismos de su extensión subagent)
  .claude/agents/*.md         agentes de Claude Code
  .opencode/agents/*.md       agentes de OpenCode
```

Hay un ejemplo completo en [`examples/tienda`](../examples/tienda).

Todo esto también se edita desde **⚙ Ajustes**: la pestaña *Proyecto* para el equipo y la pestaña *Pipelines* para los pipelines, que se validan antes de guardar.

## `team.json`

```jsonc
{
  "name": "Tienda",
  "harness": "pi",                          // harness por defecto: pi | claude-code | opencode
  "roles": {                                // po, analyst, manager, tl, qa, backend, frontend, designer
    "tl": { "agent": "architect", "model": "anthropic/claude-opus-5-5" },
    "qa": { "agent": "tester", "model": "anthropic/claude-haiku-5-5" },
    "backend": { "agent": "backend-dev", "harness": "pi" }
  },
  "orchestrator": { "harness": "pi" },      // quién orquesta en la estrategia "agent"
  "maxParallel": 3,                         // etapas a la vez
  "harnessOptions": {
    "claude-code": { "args": ["--permission-mode", "acceptEdits"] },
    "pi": { "bin": "/ruta/a/pi" }           // si no está en el PATH
  }
}
```

Los roles aceptan alias como `arquitecto`, `tester` o `ux`.

## Un pipeline

```jsonc
{
  "name": "Feature con TDD",
  "description": "Arquitecto → QA en rojo → backend → QA en verde → review",
  "strategy": "office",                     // office | agent (ver abajo)
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
| `role` | El personaje que la hace. Las herramientas del agente se le atribuyen a él |
| `phase` | La fase del flujo por roles: arquitectura, red, green, implementa, review… (ver [eventos-por-rol.md](eventos-por-rol.md)) |
| `agent`, `model`, `harness`, `thinking`, `tools` | Sobrescriben lo de `team.json` y lo del archivo del agente |
| `needs` | Etapas que deben terminar antes. Las que no dependen entre sí corren en paralelo |
| `prompt` | Instrucción de la etapa. Variables: `{{task}}`, `{{previous}}` (resultados de las etapas de `needs`), `{{failure}}` (por qué falló el intento anterior), `{{<id>.output}}`, `{{project}}`. Si falta, se arma una instrucción a partir del rol, la fase y la tarea |
| `check` | Gate al terminar la etapa: `run` es un comando de shell que corre en el proyecto y `expect` dice si debe `pass` o `fail` (RED). `timeout` va en segundos |
| `onFail` | Si la etapa o su gate fallan, vuelve a `goto` (esa etapa y todo lo que depende de ella) hasta `max` veces, con la falla en `{{failure}}` |

Los `check` son comandos del propio proyecto, con la misma confianza que un script de `package.json`. El diálogo los muestra antes de arrancar.

## Quién orquesta

### `"strategy": "office"`: la oficina

La oficina corre cada etapa como un proceso del harness, con el agente y el modelo de esa etapa:

| Harness | Comando por etapa |
|---|---|
| Pi | `pi --mode json -p --no-session --model … --tools … --append-system-prompt <prompt del agente> "<instrucción>"` |
| Claude Code | `claude -p --output-format stream-json --verbose --model … --agent <agente> <permisos> "<instrucción>"` |
| OpenCode | `opencode run --format json --model … --agent <agente> "<instrucción>"` |

La oficina lee la salida JSON de cada proceso y la convierte en eventos del juego:

- cada herramienta (leer, editar, ejecutar), atribuida al personaje de la etapa;
- los subagentes que lance el agente, en el personaje de su rol;
- los errores.

Entre etapas pasa el resumen final de cada una. Los gates y los bucles los aplica la oficina. El tablero muestra las etapas como tarjetas (por hacer, en curso, hecho) y el panel lateral muestra el estado de cada una.

Si además tienes instalada la extensión de Pi, el plugin de OpenCode o el hook de Claude Code, lo que reportan desde una etapa se descarta porque la oficina ya lee esa salida. Así no se duplica nada.

### `"strategy": "agent"`: el agente

La oficina compila el pipeline en una instrucción (etapas, dependencias, subagente y modelo de cada una, gates) y se la manda al orquestador: a una sesión abierta, o lanzando una nueva. El orquestador delega cada etapa en sus subagentes:

- **Pi:** la herramienta `subagent` de su extensión, con los agentes de `.pi/agents/`, cada uno con el modelo de su archivo.
- **Claude Code:** la herramienta `Task` con `subagent_type`.
- **OpenCode:** sus subagentes (`@agente`).

La oficina sabe qué subagente es qué rol, así que cuando Pi llama a `subagent` con `{ agent: "tester" }` el que se mueve es QA. Las etapas se marcan como en curso o terminadas a medida que aparecen sus subagentes.

## Por API

```bash
curl -s localhost:4317/v1/projects                      # proyectos conocidos y sus pipelines
curl -s localhost:4317/v1/pipelines -H 'content-type: application/json' \
  -d '{"dir":"/ruta/mi-proyecto","pipeline":"feature-tdd","task":"Cancelar pedidos"}'
curl -s -X POST localhost:4317/v1/pipelines/p1/cancel
```

Por WebSocket: `{ "type": "pipeline_start", dir, pipeline, task, strategy?, target?, ref? }` y `{ "type": "pipeline_cancel", id }`. El estado llega como `{ "type": "pipelines", runs }`.

La oficina ofrece los proyectos que conoce:

- los de **⚙ Ajustes › Oficina**;
- los que pasas con `--project <dir>`;
- su propio directorio de trabajo;
- el directorio de cada sesión de agente conectada.
