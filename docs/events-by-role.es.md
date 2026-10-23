# Propuesta: eventos por rol para el agente de turno (Pi)

[English](events-by-role.md) · **Español**

Un agente como Pi trabaja solo, pero sigue un flujo de equipo: piensa como arquitecto, escribe un test que falla como QA, implementa como backend, vuelve a QA para verlo en verde, revisa como tech lead… Esta propuesta le da a ese flujo **eventos explícitos**, para que la oficina muestre quién tiene el turno y en qué fase está.

## Dos fuentes de eventos

| Fuente | Qué reporta | Cómo |
|---|---|---|
| Extensión `integrations/pi/dev-team-office.ts` | Lo mecánico: prompt, cada herramienta (inicio/fin, error), compactación, fin del agente | Automática, con hooks de Pi (`before_agent_start`, `tool_call`, `tool_result`, `agent_end`…) |
| Skill `skills/dev-team-office` | Lo semántico: qué **rol** tiene el turno y en qué **fase** está | El modelo ejecuta `office-event.mjs` al cambiar de rol o de fase |

Las dos comparten la sesión a través de `DEV_TEAM_OFFICE_SESSION`: la define la extensión y la heredan los comandos que lanza Pi. Así, cuando el skill declara `backend implementa`, las ediciones que la extensión reporta después se le atribuyen a Diego (backend), sin deducirlo del nombre del archivo.

## Contrato del evento `phase`

```jsonc
// POST /event/pi   ó   WS { "type": "event", "source": "pi", "payload": … }
{
  "session": "pi-1234",
  "kind": "phase",
  "role": "qa",            // po | analyst | manager | tl | qa | backend | frontend | designer (+ alias: arquitecto, tester, ux…)
  "phase": "red",          // ver catálogo; acepta alias en inglés (implement, approve, architecture…)
  "text": "2 tests fallan: orders.cancel.test.ts",
  "from": "tl"             // opcional; por defecto, el rol que tenía el turno
}
```

Eventos complementarios del mismo skill:

| Evento | Uso |
|---|---|
| `{ kind: "phase_end", text }` | Cierra el turno: las herramientas vuelven a atribuirse por heurística |
| `{ kind: "task", text }` | El pedido del usuario (se descarta si la extensión ya lo envió en los últimos 30 s) |
| `{ kind: "todos", todos: [...] }` | Tablero kanban |
| `{ kind: "waiting", text }` | Necesita al usuario: el manager levanta la mano y aparece un banner |
| `{ kind: "done", text }` | Fin; se descarta el duplicado si la extensión ya lo envió en los últimos 15 s |

Qué hace el servidor con una fase:

- `session.turn` y `session.phase` pasan a ser el rol y la fase del evento.
- Los `tool_start`/`tool_end` siguientes sin `role` explícito se atribuyen a `session.turn` y llevan `phase`.
- `session.flow` acumula los pasos (máximo 40); el panel lateral los muestra como línea de tiempo.
- En fase `red`, un `tool_end` fallido **no cuenta como error**, porque es lo que se espera en TDD.
- Las llamadas a `office-event.mjs` que reporta la extensión se ignoran para que no aparezcan como trabajo de backend.

## Catálogo de fases

| Rol | Fase | Significado | En la oficina |
|---|---|---|---|
| `po` | `historia` | Escribe la historia de usuario | Va a la pizarra y la presenta |
| `po` | `criterios` | Define los criterios de aceptación | Pizarra |
| `po` | `prioriza` | Ordena el backlog | Pizarra |
| `po` | `acepta` | Acepta el incremento | Salta ✅ con confeti |
| `po` | `rechaza` | No cumple los criterios | Se sacude, burbuja naranja ❌ |
| `analyst` | `analiza` | Entiende el dominio y el código existente | Piensa 🧐 |
| `analyst` | `investiga` | Busca en docs o en la web | Trabaja 🔎 |
| `analyst` | `requisitos` | Documenta los requisitos | Pizarra |
| `manager` | `planifica` | Divide el trabajo | Pizarra |
| `manager` | `asigna` | Reparte el trabajo | Trabaja 📨 |
| `manager` | `desbloquea` | Resuelve un impedimento | Va al escritorio del bloqueado y lo libera |
| `manager` | `release` | Publica | 🚀 todo el equipo celebra en la mesa |
| `tl` | `arquitectura` | Diseño técnico | Pizarra 🏛️ |
| `tl` | `adr` | Registra una decisión | Pizarra |
| `tl` | `review` | Revisa código | Va al escritorio del último dev 🔍 |
| `tl` | `aprueba` | Aprueba el review | Salta 👍 |
| `tl` | `cambios` | Pide cambios | Burbuja naranja ✋ |
| `tl` | `refactor` | Refactor transversal | Trabaja ♻️ |
| `qa` | `plan-pruebas` | Define los casos de prueba | Piensa 🧪 |
| `qa` | `red` | Escribe un test que falla (TDD) | Etiqueta y monitor en rojo 🔴; el fallo esperado no es un bug |
| `qa` | `green` | La suite pasa | Checks verdes y confeti 🟢 |
| `qa` | `regresion` | Corre la suite completa | Trabaja |
| `qa` | `bug` | Reporta un bug | Va al escritorio del dev con 🐞 |
| `qa` | `verifica` | Verificación manual o e2e | Trabaja 🔬 |
| `backend` / `frontend` | `implementa` | Implementa | Teclea; se ve código en el monitor |
| `backend` / `frontend` | `fix` | Corrige | Trabaja 🔧 |
| `backend` / `frontend` | `refactor` | Refactoriza en verde | Trabaja ♻️ |
| `backend` | `migracion` | Migra datos | Trabaja; el rack de servidores parpadea |
| `designer` | `ux` | Flujos y wireframes | Trabaja ✏️ |
| `designer` | `ui` | UI visual y tokens | Trabaja 🎨 |
| `designer` | `revision-visual` | Revisa lo implementado | Va al escritorio de frontend 👀 |
| cualquiera | `bloqueado` | No puede avanzar | ⛔ y el manager se acerca |

Una fase desconocida no se descarta: se muestra como trabajo genérico con su nombre en mayúsculas.

**Traspaso.** Si el rol cambia y el nuevo trabaja en su escritorio, quien tenía el turno camina hasta allí con una tarjeta ("Diego, te toca: Implementa"). Si la fase lleva al nuevo rol a la pizarra o a otro escritorio, el anterior sólo lo anuncia con una burbuja.

## Flujos de referencia

```
Feature backend TDD   po criterios → analyst analiza → tl arquitectura → qa red → backend implementa
                      → qa green → backend refactor → qa green → tl review → tl aprueba → po acepta

Feature con UI        po historia → designer ux → designer ui → qa red → frontend implementa → qa green
                      → designer revision-visual → tl review → po acepta

Full-stack            tl arquitectura → manager planifica → qa red → backend implementa → qa green
                      → qa red → frontend implementa → qa green → qa regresion → tl review → po acepta

Bug                   qa bug → qa red → backend fix → qa green → qa regresion → tl review

Refactor              tl arquitectura → qa green (línea base) → backend refactor → qa green → tl review

Spike                 analyst investiga → tl adr → po prioriza

Review con cambios    tl review → tl cambios → backend fix → qa green → tl review → tl aprueba
```

Para verlo sin Pi: `dev-team-office demo --pi`, la tecla `p` en la oficina o el botón **▶ Demo TDD (Pi)** en la vista web.

## Instalación en Pi

```bash
dev-team-office setup --only pi
```

(A mano: `cp -r skills/dev-team-office ~/.agents/skills/` y `cp integrations/pi/dev-team-office.ts ~/.pi/agent/extensions/`.) El mismo skill sirve a Codex, OpenCode y Claude Code: `setup` lo deja donde cada uno lo lee.

`~/.agents/skills/` es la ubicación estándar de Agent Skills que Pi lee. Para un solo proyecto, usa `.agents/skills/` en la raíz del repo.

Pi detecta el skill solo por su descripción. También se puede forzar con `/skill:dev-team-office`. Tras copiarlo con Pi abierto, usa `/reload`.

## Decisiones y límites

- **El modelo decide los cambios de rol y la extensión sólo observa.** Pi no tiene subagentes nativos, así que el rol de turno no se puede deducir de forma fiable: lo declara el modelo, que es quien sabe qué sombrero lleva puesto.
- **Un evento por cambio de fase, no por herramienta.** Así el costo en tokens es mínimo (un comando corto por fase) y la extensión cubre el detalle.
- **El script nunca bloquea al agente.** Si la oficina está apagada, imprime un aviso y sale con 0. Sólo sale con 2 por un error de uso, para que el modelo corrija la llamada.
- **Sin la extensión, el skill funciona igual** (sesión `pi` por defecto), pero las herramientas no se verán en la oficina.
