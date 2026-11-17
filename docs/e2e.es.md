# Pruebas E2E: míralas mientras corren

[English](e2e.md) · **Español**

Cuando un agente corre pruebas de **Playwright**, aparece una **pantallita** en la esquina de abajo a la derecha del juego: el proyecto, cómo va la corrida (✓ pasaron, ✗ fallaron, ◌ corriendo, de cuántas), la prueba y el paso en que va (*agregar al carrito › Click*) y el último cuadro del navegador, con **EN VIVO** mientras corre. QA lo hace en el juego: anuncia la corrida, se sacude cuando una prueba falla y celebra (o se traba) al terminar. Haz clic en la pantalla (o aprieta `e`) y se **expande**:

- **las pruebas de la corrida**, cada una con cómo terminó y cuánto tardó; sigue a la que corre hasta que eliges otra (▶ Seguir en vivo te devuelve);
- **su película**, sacada de su traza: los cuadros del navegador, con **un punto donde hizo clic o escribió**, la leyenda de la acción (`Click · getByRole('button', { name: 'Pagar' })`), una línea de tiempo con una marca por acción (roja, la que falló), reproducir o pausar y la velocidad;
- **sus pasos** (navegar, llenar, clic, expect, tus `test.step`), con su tiempo y **el error donde ocurrió**; haz clic en uno para ir a ese momento;
- **su video** y **sus capturas**, cuando la configuración los graba.

No hay nada que configurar: `setup` instala el reporter de Playwright de la oficina y la sesión de cada agente lo recibe (`$PW_TEST_REPORTER`, que Playwright agrega **junto a** los reporters del proyecto, nunca en su lugar). Nunca les estorba a las pruebas: no imprime nada, y si la oficina no está corriendo deja de intentarlo. La película necesita la traza: corre `npx playwright test --trace=on`, o **`dev-team-office e2e -- npx playwright test`**, que la enciende por ti (un script como `npm run e2e` va como es: decide su configuración). La oficina sólo lee archivos dentro de la carpeta donde corren las pruebas, los copia antes de que la próxima corrida los borre y guarda las últimas 6 corridas. Otros runners (Cypress, Selenium) todavía no se miran. La API, en [docs/api.es.md](api.es.md#pruebas-e2e-miradas).

El comando (`dev-team-office e2e -- <comando>`) y el resto de la CLI están en la [guía de uso](usage.es.md#la-cli-completa).
