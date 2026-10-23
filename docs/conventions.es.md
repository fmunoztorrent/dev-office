# Convenciones

[English](conventions.md) · **Español**

Estas son las reglas del código de Dev Team Office. Las sigue quien contribuya y también los agentes que trabajan en el repositorio ([AGENTS.md](../AGENTS.md)).

## Principios

1. **El juego es el frontend; el agente es el backend.** La oficina dibuja lo que reportan los agentes y les manda tareas, pero nunca ejecuta trabajo por su cuenta. Los pipelines, los gates y los cambios de modelo corren del lado del agente ([`integrations/`](../integrations)).
2. **Una integración nunca rompe a su agente.** Si la oficina está apagada, el hook, el plugin o la extensión no hacen nada:
   - todo con un tope de tiempo y sin errores hacia el agente;
   - los hooks siempre salen con código 0.
3. **Cero dependencias en tiempo de ejecución.** Sólo Node ≥ 22.13: `node:sqlite` para la base, el WebSocket propio ([`server/ws.js`](../server/ws.js)) y el `WebSocket` global de Node como cliente. `ws` es sólo de desarrollo, para probar el servidor contra otro cliente.
4. **Lo local es privado.** El servidor escucha en `127.0.0.1` y en un socket Unix `0600`; las rutas que cambian algo rechazan a un sitio web ajeno. Sólo se consulta el clima a Open-Meteo, y se puede apagar.
5. **La misma simulación en todas partes.** [`public/sim.js`](../public/sim.js) es la lógica de la oficina. La usan el navegador ([`public/game.js`](../public/game.js), con la vista frontal y la cenital) y la terminal ([`tui/`](../tui)). El reloj, la hora y el azar se pueden inyectar.

## Lenguaje y estilo

- **Los comentarios del código van en inglés.** Los identificadores van en inglés o en español, igual que el código que los rodea.
- **La documentación va en los dos idiomas.** Cada documento en inglés (`README.md`, `CONTRIBUTING.md`, `docs/<nombre>.md`) tiene al lado su versión en español (`README.es.md`, `CONTRIBUTING.es.md`, `docs/<nombre>.es.md`); un cambio en uno va también en el otro. `AGENTS.md` y `CLAUDE.md` van en español.
- **Cada archivo empieza con un comentario** que dice qué es y cómo encaja. Las funciones no triviales llevan JSDoc corto (`/** … */`) con lo que no se ve en la firma.
- **Módulos ES** (`"type": "module"`) e `import` de `node:*` para lo de Node.
- **Funciones chicas y nombres que se lean.** Nada de abstracciones por si acaso: una función que se usa en un solo lugar vive junto a ese lugar.
- **Los textos de la interfaz no van en el código:** van en [`public/locales/en.js`](../public/locales/en.js) y [`es.js`](../public/locales/es.js) y se leen con `t('clave', { variables })`.
  - Los dos idiomas tienen las mismas claves y las mismas `{variables}`; un test lo comprueba.
  - El inglés es el idioma por defecto.
- **Las respuestas de la API y del MCP van en inglés** cuando son para máquinas o para otros agentes. Los mensajes para personas usan `t()`.

## Estructura

| Carpeta | Qué va ahí |
|---|---|
| `bin/` | El ejecutable (`dev-team-office`) y `setup`/`install`/`team` |
| `server/` | El servidor: API HTTP y WebSocket, oficinas, eventos, roles, tareas, pipelines, herdr, MCP y la base |
| `public/` | El juego en el navegador, y lo que comparte con la terminal (`sim.js`, `sky.js`, `clock.js`, `i18n.js`, `iso.js`) |
| `tui/` | La terminal: el juego, la bitácora, el monitor, los ajustes y el visor de un subagente |
| `integrations/` | Lo que corre del lado de cada agente (hooks de Claude Code y Codex, plugin de OpenCode, extensión de Pi) y su librería común |
| `skills/` | Los skills, para cualquier harness |
| `teams/` | Los team packs |
| `docs/` | La documentación |
| `test/` | Los tests (`node --test`) y sus fixtures |

Para agregar algo:

- **Una herramienta o un archivo que lo haga otro personaje:** las reglas de [`server/roles.js`](../server/roles.js) y `TEXT_RULES` en [`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs).
- **Un agente nuevo:**
  1. su adaptador en [`server/adapters.js`](../server/adapters.js) (o el formato genérico);
  2. su integración en `integrations/`;
  3. su paso en [`bin/setup.js`](../bin/setup.js);
  4. su guía en [`connect-a-harness.es.md`](connect-a-harness.es.md).
- **Un ajuste:**
  1. el valor por defecto y la validación en [`server/store.js`](../server/store.js);
  2. la interfaz en [`public/settings-ui.js`](../public/settings-ui.js) y [`tui/settings.js`](../tui/settings.js);
  3. la clave en `dev-team-office config`;
  4. los textos en los dos idiomas.

## Eventos y roles

- Todo lo que entra a la oficina se traduce al **formato genérico** ([`api.es.md`](api.es.md#formato-genérico-de-un-evento)).
- **Ocho roles:** `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`.
- Un subagente declara el suyo con `role:` en su archivo. Si no lo declara, se deduce de su nombre y después de su descripción ([`connect-a-harness.es.md`](connect-a-harness.es.md)).
- Un rol declarado que no existe **no** se reemplaza en silencio: queda fuera y se reporta.
- **Lo que hace un subagente lleva su `subId`.**
  - Los subagentes que son su propio proceso (Pi) reportan a la sesión del padre con `child`.
  - En Claude Code, las herramientas de un subagente traen su `agent_id`.

## Tests

```bash
npm test
```

- **`node --test`** y nada más. Cada archivo es `test/<tema>.test.js` y los nombres de los tests son frases en español que dicen qué se espera.
- Los tests que comprueban textos importan primero [`test/es.js`](../test/es.js), que fija el español.
- **Nunca se toca la instalación real:**
  - La base es `:memory:`, o un archivo en un directorio temporal (`DEV_TEAM_OFFICE_DB`, `HOME` temporal).
  - El servidor se levanta con `port: 0`, `socket: null` (o uno temporal) y `weather: false`.
  - herdr va con una CLI de mentira (`new Herdr({ run })`); los agentes, con los fixtures de `test/fixtures/` (`fake-agent.mjs`, `fake-claude.mjs`…).
- **Pruebas de verdad** (con Pi, Claude Code o herdr reales):
  - sólo en un `HOME` aislado en `/tmp`, con un puerto que no sea 4317 y una sesión de herdr con nombre propio (`herdr --session <nombre>`);
  - nunca en la sesión de herdr por defecto ni en la configuración real del usuario;
  - al terminar se borra todo, desenlazando antes los enlaces simbólicos.
- Un cambio visible en el juego se revisa en el navegador con la oficina de demo (una base aislada y un agente de mentira), no sólo con tests.

## Commits y cambios

- Los mensajes llevan un prefijo convencional, en español o en inglés: `feat(office): …`, `fix(herdr): …`, `docs: …`, `test: …`, `chore: …`.
- Cada cambio de comportamiento trae su test, y su documentación si cambia lo que ve el usuario: los dos README, `docs/` o el texto de ayuda de la CLI (`cli.help` en los dos idiomas).
- Cada versión actualiza [`CHANGELOG.md`](../CHANGELOG.md) y la versión de `package.json`, `server/server.js` y `.claude-plugin/plugin.json` (`test/release.test.js` comprueba que coincidan).
- `.claude/` es local de cada quien y no se versiona.
