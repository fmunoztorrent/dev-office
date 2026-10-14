---
name: dev-team-office
description: Reporta a Dev Team Office (una oficina pixel-art en vivo) qué rol del equipo tiene el turno y en qué fase está — PO, analista, manager, arquitecto/tech lead, QA (RED/GREEN), backend, frontend, diseñadora. Úsalo en cualquier tarea de desarrollo con etapas (feature, bug, refactor, TDD, spike) para emitir un evento cada vez que cambies de rol o de fase.
---

# Dev Team Office: eventos por rol

Trabajas como un equipo completo. Cada vez que pases de un "sombrero" a otro (por ejemplo, de arquitecto a QA escribiendo un test en rojo, a backend implementando, a QA en verde), avísalo a la oficina. Ahí un personaje toma el turno, recibe la tarjeta del anterior y anima lo que estás haciendo.

El script `office-event.mjs` está en la misma carpeta que este `SKILL.md`. Ejecútalo con `node <carpeta-del-skill>/office-event.mjs …`.

```bash
node <carpeta-del-skill>/office-event.mjs phase <rol> <fase> "detalle corto"
```

## Reglas

1. **Al empezar** la tarea, envía `task` con el pedido resumido en una línea.
2. **Antes de trabajar como un rol**, envía `phase <rol> <fase> "detalle"`. Hazlo sólo cuando cambien el rol o la fase, no en cada herramienta: la extensión de Pi ya reporta lecturas, ediciones y comandos, y mientras dura tu fase los atribuye al rol de turno.
3. **Detalle** de 80 caracteres como máximo, concreto: archivo, endpoint, cantidad de tests. Ejemplos: `"POST /orders valida stock"`, `"3 tests fallan: checkout.spec.ts"`.
4. **TDD:** envía `qa red` *después* de escribir el test y comprobar que falla. Si en RED el test pasa, el test no prueba nada: corrígelo antes de seguir. Envía `qa green` sólo con la suite en verde e incluye el conteo (`"14/14"`).
5. **Bloqueos:** `phase <rol> bloqueado "motivo"`. Si necesitas al usuario, usa `wait "pregunta"` y después pregúntale.
6. **Al terminar**, envía `done "resumen"`.
7. Si el script dice que la oficina no está disponible, **sigue trabajando normalmente**. Nunca reintentes ni cambies tu plan por esto.
8. `--from <rol>` es opcional. Por defecto el traspaso viene del rol que tenía el turno.

## Roles y fases

| Rol (`<rol>`) | Personaje | Lo usas cuando… | Fases |
|---|---|---|---|
| `po` | Product Owner | defines qué y para qué; aceptas el resultado | `historia`, `criterios`, `prioriza`, `acepta`, `rechaza` |
| `analyst` | Analista de negocio | entiendes el dominio, lees docs y código existente, investigas | `analiza`, `investiga`, `requisitos` |
| `manager` | Manager | divides el trabajo, coordinas, publicas | `planifica`, `asigna`, `desbloquea`, `release` |
| `tl` | Arquitecto / Tech Lead | decides el diseño técnico, revisas código | `arquitectura`, `adr`, `review`, `aprueba`, `cambios`, `refactor` |
| `qa` | QA | defines casos, escribes tests, los corres | `plan-pruebas`, `red`, `green`, `regresion`, `bug`, `verifica` |
| `backend` | Backend | servidor, API, datos, migraciones | `implementa`, `fix`, `refactor`, `migracion` |
| `frontend` | Frontend | componentes, páginas, estilos | `implementa`, `fix`, `refactor` |
| `designer` | Diseñadora | flujos UX, UI, tokens, revisión visual | `ux`, `ui`, `revision-visual` |

Cualquier rol puede usar `bloqueado`. También se aceptan alias en inglés (`implement`, `approve`, `architecture`…) y `arquitecto` como alias de `tl`.

## Flujos de referencia

Elige el que mejor encaje y sáltate los pasos que no apliquen. Cada flecha es un `phase`.

**Feature backend con TDD**
`po criterios` → `analyst analiza` → `tl arquitectura` → `qa red` → `backend implementa` → `qa green` → `backend refactor` → `qa green` → `tl review` → `tl aprueba` → `po acepta`

**Feature con interfaz**
`po historia` → `designer ux` → `designer ui` → `qa red` → `frontend implementa` → `qa green` → `designer revision-visual` → `tl review` → `po acepta`

**Full-stack**
`tl arquitectura` → `manager planifica` → `qa red` (API) → `backend implementa` → `qa green` → `qa red` (UI) → `frontend implementa` → `qa green` → `qa regresion` → `tl review` → `po acepta`

**Bug**
`qa bug` (reproducir) → `qa red` (test que lo captura) → `backend fix` (o `frontend fix`) → `qa green` → `qa regresion` → `tl review`

**Refactor**
`tl arquitectura` → `qa green` (línea base) → `backend refactor` → `qa green` → `tl review`

**Spike / investigación**
`analyst investiga` → `tl adr` → `po prioriza`

Si el review pide cambios: `tl cambios "…"` → `backend fix` → `qa green` → `tl review` → `tl aprueba`.

## Ejemplo completo

```bash
O=<carpeta-del-skill>/office-event.mjs
node $O task "Endpoint para cancelar pedidos"
node $O phase po criterios "Sólo pedidos sin despachar; devuelve 409 si no"
node $O phase tl arquitectura "Nuevo estado CANCELLED + POST /orders/:id/cancel"
# … escribes orders.cancel.test.ts y lo corres: falla …
node $O phase qa red "2 tests fallan: orders.cancel.test.ts"
node $O phase backend implementa "OrderService.cancel + ruta"
# … corres los tests: pasan …
node $O phase qa green "2/2 + suite 48/48"
node $O phase tl review "orders/service.ts, routes.ts"
node $O phase tl aprueba
node $O phase po acepta "Cumple los criterios"
node $O done "Cancelación de pedidos lista"
```
