# herdr: el agente en un pane, y cada subagente en el suyo

[English](herdr.md) · **Español**

Lo que hace la oficina cuando corre dentro de herdr. La versión corta está en la [guía de uso](usage.es.md#herdr-un-pane-por-agente-y-por-subagente).

El flujo completo, dentro de herdr:

1. Abres herdr en tu proyecto.
2. Escribes `dev-team-office`: levanta el servidor, muestra el **monitor de actividad** (no el juego) y abre a tu agente (Pi, Claude Code…) en un pane a la derecha.
3. Le pides algo a tu agente en su pane, o desde el juego en el navegador (`o` en el monitor; `t` o clic en la pizarra). El agente lo trabaja en su pane y **cada subagente que lanza se abre en su propio pane**, debajo del agente: ahí se ve en vivo quién es (su personaje), su tarea, cada herramienta, la salida de sus comandos y, al final, su informe. Los que corren a la vez quedan uno al lado del otro, y cada pane se cierra solo unos segundos después de que su subagente termina. Y cuando el subagente nunca dice que terminó —su harness puede perder ese final, con un pane que se va antes de que registre el resultado— la oficina no lo espera: un pane que ya no está, o un subagente cuyo proceso propio terminó, está terminado, así que lo cierra y lo saca del equipo (la bitácora lo dice).

El subagente lo sigue corriendo su harness (gentle-pi, el Task de Claude Code, los de OpenCode): el pane lo **muestra** con `dev-team-office follow`, no lo ejecuta. Se apaga en **⚙ › Terminal › Cada subagente en su pane** (o `dev-team-office config herdr.subagents off`).

Si lanzas la oficina **dentro de herdr** (`HERDR_ENV=1`), el agente no corre en segundo plano:

- **Al abrir la oficina**, el agente se abre en un **pane nuevo** junto al de la oficina (sin quitarte el foco), con su etiqueta (`🏢 Pagos · Claude Code · tienda`). ¿Cuál? El de `--agent` o el de **⚙ › Terminal › Agente al abrir**: en automático, el agente registrado de la carpeta donde lanzaste la oficina, o el CLI que esa carpeta trae configurado (o el primero instalado). `--no-launch` no abre ninguno.
- **Las sesiones nuevas** (un prompt desde la pizarra sin sesión abierta) también se abren en un pane, interactivas: el agente recibe el prompt ahí y la tarea termina cuando su turno termina. Se apaga en ⚙ › Terminal.
- **El agente orquesta lo suyo desde su pane** —subagentes, pipelines de su harness— y **puede abrir más panes** para otras actividades: tests en modo watch, un servidor, un build u otro agente con su propio prompt, con `dev-team-office pane` (el skill de Pi lo explica) o con el propio `herdr`. Eso es del agente, no de la oficina; la oficina lo **entiende**: cada pane es una actividad de la que se encarga alguien del equipo (los tests, QA; el servidor de desarrollo, frontend; otro agente, según su rol) mientras siga abierto. Los panes que un agente abre en la carpeta de su proyecto la oficina los adopta sola; si se bloquea un agente en su pane, el manager levanta la mano.
- **Cuando un agente te pregunta algo** en su pantalla (un permiso, «Allow?», elegir entre opciones), la oficina lo lee de su pane: aparece el **chip ✋** en el juego («Pi te pregunta») y el monitor lo lista en **TE ESPERAN**. Respondes ahí con un clic (o `r`): la oficina aprieta las mismas teclas que apretarías tú en el pane del agente.

```bash
dev-team-office pane --role qa --title "tests en watch" -- npm test -- --watch
dev-team-office pane --agent claude --role tl --title review -- "Revisa el diff y reporta sólo lo accionable"
```

Fuera de herdr todo funciona como antes (los agentes nuevos corren en segundo plano). La oficina habla con herdr sólo por su CLI (`herdr pane split|run|list|rename|read|send-keys`, `herdr agent start|prompt`).
