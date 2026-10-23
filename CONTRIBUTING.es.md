# Cómo contribuir

[English](CONTRIBUTING.md) · **Español**

Gracias por querer mejorar Dev Team Office. Esta guía explica cómo armar el entorno, cómo probar y qué se espera de un cambio. Las reglas del código están en [docs/conventions.es.md](docs/conventions.es.md).

## El entorno

Necesitas **Node.js ≥ 22.13**. El proyecto no tiene dependencias de ejecución; `npm install` sólo instala `ws`, que se usa en los tests.

```bash
git clone https://github.com/fmunoztorrent/dev-office
cd dev-office
npm install
npm test
```

Para correr la oficina desde el código sin tocar tu instalación:

```bash
DEV_TEAM_OFFICE_DB=/tmp/dto-dev.db DEV_TEAM_OFFICE_WEATHER=off node bin/dev-team-office.js --port 4320 --no-socket
```

Para ver el juego con actividad sin un agente de verdad, combina la oficina con el agente de mentira:

```bash
PORT=4320 DEV_TEAM_OFFICE_DB=/tmp/dto-demo.db DEV_TEAM_OFFICE_WEATHER=off node server/index.js &
node test/fixtures/fake-agent.mjs --url http://127.0.0.1:4320 --delay 450
```

Y abre `http://127.0.0.1:4320`. Con `dev-team-office demo --pi --port 4320` corre la demo TDD.

## Cómo probar un cambio

1. **Los tests:** `npm test`. Todos deben pasar.
2. **El juego (navegador):** si tocaste `public/`, revísalo en el navegador con la oficina de demo, en las dos vistas (frontal y cenital, con `v`), en español y en inglés.
3. **La terminal:** si tocaste `tui/`, pruébalo en una terminal real, chica (60×18) y grande.
4. **Con agentes reales:** si tocaste una integración, pruébala con el agente de verdad, pero aislado:
   - un `HOME` temporal en `/tmp`, con la configuración mínima del agente;
   - un puerto distinto de 4317;
   - si usas herdr, una sesión con nombre propio (`herdr --session dto-prueba server`).

   Nunca uses tu configuración real ni tu sesión de herdr por defecto. Al terminar, borra el entorno, desenlazando antes los enlaces simbólicos.

## Qué se espera de un cambio

- **Un tema por cambio**, con su test. Los tests van en `test/<tema>.test.js` y sus nombres son frases en español que dicen qué se espera.
- **Sin dependencias nuevas de ejecución.** Si de verdad hace falta una, explica por qué en el PR.
- **Los textos de la interfaz en los dos idiomas** (`public/locales/en.js` y `es.js`, con las mismas claves y las mismas `{variables}`).
- **La documentación al día, en los dos idiomas:** cada documento en inglés (`README.md`, `CONTRIBUTING.md`, `docs/<nombre>.md`) tiene su versión en español al lado (`.es.md`); un cambio en uno va también en el otro. También la ayuda de la CLI (`cli.help`), si cambia lo que ve el usuario.
- **Los comentarios del código, en inglés.**
- **Las integraciones no rompen al agente:** con la oficina apagada no hacen nada, siempre con un tope de tiempo y sin escribir en la salida del agente.
- **El mensaje del commit** con prefijo convencional: `feat(herdr): …`, `fix(office): …`, `docs: …`.

## Lo más común

| Quiero… | Dónde |
|---|---|
| Que una herramienta o un archivo lo haga otro personaje | [`server/roles.js`](server/roles.js) y `TEXT_RULES` en [`integrations/common/devteam.mjs`](integrations/common/devteam.mjs) |
| Conectar otro agente | [docs/connect-a-harness.es.md](docs/connect-a-harness.es.md): adaptador, integración, `setup` |
| Un evento nuevo | [`server/office.js`](server/office.js) (`#enrich`), la simulación ([`public/sim.js`](public/sim.js)) y [docs/api.es.md](docs/api.es.md) |
| Algo nuevo en la oficina (un mueble, una reacción) | [`public/sim.js`](public/sim.js) para la lógica y [`public/game.js`](public/game.js) para dibujarlo en las dos vistas (la cenital usa [`public/iso.js`](public/iso.js)). La terminal está en [`tui/view.js`](tui/view.js) |
| Un ajuste | [`server/store.js`](server/store.js), [`public/settings-ui.js`](public/settings-ui.js), [`tui/settings.js`](tui/settings.js) y `dev-team-office config` |
| Una herramienta MCP | [`server/mcp.js`](server/mcp.js) y [docs/mcp.es.md](docs/mcp.es.md) |

## Reportar un problema

Abre un issue con:

- qué hiciste y qué esperabas;
- qué pasó, con la salida de `dev-team-office doctor`;
- las versiones de Node y de tu agente.

Si es un error del juego, ayuda una captura y saber en qué vista estabas.
