# Hacer el trabajo

[English](work.md) · **Español**

La oficina es el frontend y los agentes son el backend: esta guía cuenta todas las formas de darles trabajo, desde un encargo de una línea hasta un pedido para la empresa entera, y cuánto hacen por su cuenta. Para mirar el trabajo mientras pasa, ver la [guía de uso](usage.es.md); para la empresa por la que viajan estos pedidos, [la empresa](company.es.md).

## Encargos: haz clic en la pizarra

Al hacer clic en la pizarra de la oficina, en la terminal o en la web (en la terminal también con `t`), se abre el diálogo **Nuevo encargo**. Ahí eliges:

- **Agente:** los registrados y las sesiones abiertas, **agrupados por repositorio** (una oficina puede tener varios: unos cuantos backends y sus BFF, una app web…).
- **Pipeline:** las entradas que trae su harness (ver arriba).
- **Sesión:** una abierta en esa ruta, o una nueva.
- **Modelos:** el modelo del agente, o un **perfil de modelos** (⚙ › Modelos: los de Anthropic y OpenCode vienen listos, y puedes agregar los tuyos). Una sesión nueva arranca con el modelo del perfil; las etapas de un pipeline que no fijan uno toman el de su rol.
- **El prompt**, en una nota adhesiva.

El encargo va con su alcance delante: el agente trabaja **sólo dentro de la carpeta de su repositorio**, y sólo en lo que se pidió (a OpenCode además le llega como regla: leer o cambiar archivos fuera de la carpeta se le niega). El skill **stay-focused**, que instala `setup`, le dice lo mismo a cualquier agente.

**Una sesión de Claude Code que la oficina abre en segundo plano** (`claude -p`, cuando no hay una sesión de ese repositorio abierta y no está dentro de herdr) no tiene a nadie que apruebe un permiso, así que la oficina le da dos, y sólo dos:

- **las herramientas MCP de la propia oficina que piden sus encargos:** `handoff`, `loop_report`, `declare_resource`, `report_activity`, el archivo (`search_knowledge`, `get_knowledge`, `save_knowledge`) y leer el mapa (`get_architecture`, `get_instructions`, `list_systems`…). Nunca las que mandan trabajo o cambian la empresa (`send_task`, `send_directive`, `register_project`, `open_pane`, `run_my_tool`…): esas quedan para ti;
- **leer las carpetas que su encargo le deja leer** (los artefactos que usa el suyo, en un proyecto): sólo leer, nunca escribir ahí.

Lo demás es como diga su modo de permisos (`acceptEdits` por defecto: edita archivos dentro de su carpeta). Un repositorio registrado con sus propios argumentos para su agente (⚙ › Repositorios, o `args` en la API) los mantiene, y recibe estos dos encima.

Antes de enviar, el diálogo muestra las etapas del pipeline y qué personaje hace cada una. Con **✉ Enviar prompt** en ⚙ › Repositorios se abre con ese agente ya elegido.

**🗺 Impacto** dimensiona el encargo antes de que salga, como una directiva: el árbol de los repos que toca (⤢ el grafo), el análisis del modelo si hay uno, y las preguntas sobre lo que no está en el mapa. Tus respuestas quedan en el mapa al enviarlo, y lo que dicen va arriba del encargo. Si también toca otros repos, **🏛 Hacerlo directiva** lo lleva a la dirección con el texto ya escrito.

Los pipelines de `.devteam/pipelines/*.json` los corre la sesión del agente, etapa por etapa:

| Agente | Cómo corre las etapas |
|---|---|
| **Pi** | Un mensaje por etapa en la misma sesión; cambia de modelo con `setModel` en cada etapa |
| **OpenCode** | Un `session.prompt` por etapa, con el modelo y el agente de la etapa |
| **Claude Code** | El hook `Stop` encadena las etapas en la sesión. Una etapa que pide **otro** modelo corre como `claude -p --model …` (un hook no puede cambiar el modelo de la sesión) |

Formato completo en [docs/pipelines.es.md](pipelines.es.md) y un ejemplo en [`examples/tienda`](../examples/tienda).

### Tareas directas

| Destino | Cómo llega |
|---|---|
| **Pi** con sesión abierta | Al instante. La extensión llama `pi.sendUserMessage()`, y si Pi está ocupado queda como follow-up |
| **OpenCode** con sesión abierta | Al instante. El plugin la envía con `client.session.prompt()`; sin sesión conocida, la escribe en el prompt del TUI |
| **Claude Code** (sesión existente) | En cola. La entrega su hook `Stop` cuando Claude termina el turno en curso, y Claude sigue con ella. Claude Code no permite inyectar mensajes en una sesión interactiva desde fuera: si la sesión está esperando tu mensaje, la tarea llega al terminar el siguiente turno |
| **Sesión nueva** de un agente registrado | Dentro de herdr, en un pane nuevo (interactivo). Fuera, la oficina abre `claude -p`, `opencode run` o `pi -p` en su ruta. Sus hooks o plugins reportan el trabajo como en cualquier sesión |

`claude -p` lanzado así usa `--permission-mode acceptEdits` (edita archivos sin preguntar y deniega lo demás que necesite permiso), salvo que el agente tenga sus propios argumentos en ⚙ › Repositorios › Avanzado.

Desde la CLI: `dev-team-office task "Agrega paginación" --agent pi` para una tarea directa. Sin argumentos muestra a quién se le puede enviar.

## Autonomía: tú encargas, el equipo hace el resto

La oficina busca que tú encargues y el equipo llegue solo al objetivo:

- **Primero, la analista revisa el encargo.** Antes de que pase a trabajo, Valentina se lo da a leer al agente del repositorio (en sólo lectura: no cambia nada ni empieza) con las indicaciones del repositorio y del departamento. Si se puede hacer bien con lo que hay, pasa directo a trabajo. Si falta algo que sólo tú sabes y que cambiaría el resultado (el alcance, los criterios de aceptación, una decisión de negocio), te trae **hasta 3 preguntas**: va a tu escritorio con la mano en alto. Contestas lo que puedas (lo que dejes vacío lo decide el equipo), o **Que decida el equipo**; tus respuestas van con el encargo. Si la revisión falla o tarda demasiado, el encargo va tal cual.
- **Después, modo autónomo.** Cada encargo lleva una línea que le pide al agente trabajarlo hasta terminar por su cuenta (planificar, implementar, probar y verificar, con subagentes si conviene) y preguntar sólo lo que únicamente tú puedes responder, con su herramienta de preguntas; si no, tomar supuestos razonables y anotarlos. Los pipelines ya trabajan así.
- Las dos se cambian en **⚙ › Autonomía**, y cada departamento puede tener su propio nivel (⚙ › Departamentos).

**Cuando un agente te espera, lo ves.** Un agente que te pregunta algo (el `AskUserQuestion` de Claude Code, el `question` de Pi y OpenCode), un permiso que necesita, una pregunta en su pantalla dentro de herdr, o las preguntas de la analista: arriba late un cartel amarillo grande, en todos los pisos, con quién te espera, para qué y hace cuánto, y el borde de la pantalla se ilumina. El título de la pestaña dice `✋ (n)`. **Responder** abre las preguntas (o la pregunta dentro de herdr); fuera de herdr, contestas en la terminal del agente. Se queda hasta que contestas. Si quieres (⚙ › El juego, en cada navegador), con un sonido y una notificación del sistema. El juego de la terminal lo muestra como una franja que late arriba de la escena. Cuando te espera más de uno, **Ver las n** abre la **bandeja**: todo lo que te espera en una lista, lo más antiguo primero, cada cosa con su botón.

**La daily.** Cada mañana (desde las 9:30 en la zona horaria de cada oficina, la primera vez que la oficina está corriendo ese día y si pasó algo el día anterior) el equipo se junta en la mesa de reuniones y cada personaje cuenta lo que hizo su agente en las últimas 24 horas, desde la bitácora real: en qué trabajó, cuántos pasos y cuántas veces se trabó. Marco cierra con lo que te espera y lo que sigue abierto. Su **acta** va al archivo (actas, con la etiqueta `daily`). Es el resumen de la oficina: no se le pregunta a ningún modelo. **🗣 La daily a pedido, para saber lo último:** el botón 🗣 abajo a la izquierda (o `d`, o el panel 📋 Trabajo) la llama cuando quieras, y la lees en un diálogo: qué hizo cada uno **desde la daily anterior** (la primera vez, las últimas 24 horas), en qué está ahora, qué te espera y qué sigue abierto. En la dirección (o el archivo) es **la daily de la empresa**: la de todos los departamentos. En la terminal, `d` en la bitácora o `dev-team-office daily [--all]`; tu agente te la cuenta con `daily` (MCP).

## Dos pisos más: la dirección y el archivo

El edificio de la empresa tiene, además de sus oficinas, dos pisos que comparten todas. Sube o baja con el selector de **arriba a la izquierda** (`o`, o `RePág`/`AvPág`), o **con el ascensor**: al hacerle clic, en cualquier piso y en las dos vistas, se abre su panel con un botón por piso, y te lleva al que aprietes. En la vista cenital todos los pisos tienen la misma planta: la sala y, a su izquierda, el pasillo con el ascensor del edificio y el baño.

**🏛 La dirección**, arriba: los directivos, que presides tú (con tu aspecto de PO). Ahí das **directivas**: una orden para varios departamentos o repositorios a la vez («que todas las APIs expongan `/health`», «actualicen el logger en todos lados»). Haz clic en el **tablero de directivas** (o `t` ahí), escribe la orden y elige las oficinas (todos sus proyectos) o los proyectos uno por uno. La oficina le manda al agente de cada proyecto un encargo con su parte (a una sesión abierta suya o a una nueva, como cualquier encargo) y el piso sigue cómo va cada parte; puedes detenerla. La **pantalla** de la empresa muestra qué hace cada oficina (quién trabaja, quién te espera, cuántos encargos) y su **salud**, como barra de vida: verde, amarilla o roja (parpadeando) según sus errores de la última hora, el contexto que les queda a sus agentes y cuánto hace que te espera, con el motivo al lado (`⚠5/h`, `ctx 12%`). Cuando una directiva termina, su **acta** va al archivo. Los agentes también las dan: `send_directive` (MCP).

La orden le llega a **operaciones** (el COO), que la reparte entre los departamentos. **Si el departamento al que va todavía no existe**, créalo ahí mismo en el diálogo (＋ Nuevo departamento): operaciones toma nota de lo que le falta (sus repositorios, su personal y sus indicaciones), que le das en ⚙ › Departamentos. Operaciones **no satura a un departamento**: toma a lo más su **capacidad** de encargos abiertos a la vez (3 por defecto, en ⚙ › Departamentos, contando los que ya tenía); el resto de las partes espera turno y sale en cuanto termina uno.

**Antes de que salga, operaciones mapea su impacto.** Escribe la orden y aprieta **🗺 Ver el impacto**: quedan marcados los departamentos, repositorios y **componentes** que nombra (un departamento por su nombre lleva todos sus proyectos; cada proyecto muestra por qué está y los componentes que toca, 🧩), junto con los que hayas elegido. Los componentes de un proyecto se detectan de su carpeta (sus workspaces en `package.json` o `pnpm-workspace.yaml`; si no, `apps/`, `packages/`, `services/`…) y puedes declarar más en ⚙ › Departamentos (＋ Componente, con su carpeta). **Si la orden nombra algo que no está en el mapa** («el servicio de notificaciones», «la app móvil», `billing-api`), pregunta antes de que salga: ¿existe (en qué proyecto y carpeta), hay que crearlo (en qué proyecto), es un departamento nuevo, o no es un componente? Lo que contestes queda en el mapa, y el encargo de cada proyecto dice los componentes que toca y los nuevos que hay que crear. Revisa a quién va y aprieta **▶ ¡Que lo hagan!**. Por defecto se lee de las palabras de la orden, sin preguntarle a ningún modelo; los agentes hacen lo mismo con `map_impact` y `send_directive` (MCP), que devuelve las preguntas para el usuario.

### Dimensionar un pedido: su árbol, su grafo y lo que no está en el mapa

- **El árbol de los repos que toca.** Bajo el mapa, una caja por repositorio, bajo su departamento (y lo que no está en el mapa, aparte, en rojo punteado). **Pasa el puntero sobre una caja** (o llega a ella con el teclado) y una burbuja dice cómo lo toca: por qué está, cómo (las palabras del modelo, si hay uno), su impacto (alto, medio, bajo: la barra a su izquierda), los componentes que toca, la infraestructura que usa y cómo, su stack, su sistema (qué usa y quién lo usa) y su carpeta.
- **⤢ Ver el detalle** abre **el grafo**: el pedido, cada repo que toca, los que usan y los que los usan (web → bff → core), sus componentes, la infraestructura y lo que todavía no se sabe, en capas de izquierda a derecha en el sentido en que unas cosas llegan a otras. Pasa el puntero sobre un nodo y se ilumina lo que alcanza y lo que lo alcanza; acerca con − ＋ y *Ajustar*.
- **La infraestructura cuenta.** Colas, tópicos, bases de datos, cachés, buckets, servicios de otros equipos, APIs de terceros, schedulers y repositorios que la oficina no tiene (⚙ › Infraestructura). Lo que usa cada repo **se detecta de su carpeta** (sus dependencias en `package.json`, `requirements.txt`, `pyproject.toml` o `go.mod`, las imágenes de su `docker-compose` y lo que su Terraform declara con nombre: un `aws_sqs_queue "refunds"`). Un pedido que nombra una cola, un tópico, una tabla, un bucket, un cron o la API de un proveedor («el evento `refund.created`», «la cola de reembolsos», «la API de Stripe», «un cron que limpie las sesiones») llega a los proyectos que la usan; una tecnología sola («Redis») no, la usan demasiados.
- **Lo que nombra y no está en el mapa se pregunta antes de que salga.** Un componente: ¿existe en un repositorio (y en qué carpeta)? ¿es **un repositorio aparte** (una carpeta, que se registra como repositorio; o una URL, que queda anotada como un repo que la oficina no tiene)? ¿es **un repositorio nuevo** (la carpeta se crea vacía y se registra, y su encargo dice que lo arme desde cero)? ¿hay que crearlo en un proyecto? ¿es infraestructura, después de todo? ¿un departamento nuevo? Una pieza de infraestructura: **¿ya existe, y dónde** (una cuenta, un cluster, una URL; y qué proyecto la usa, y cómo)? **¿O hay que crearla, y quién?** (el encargo de ese proyecto dice que la cree, y que ya creada la declare con la herramienta MCP `declare_resource`). No se aplica nada hasta que todas las respuestas sirven; lo que contestes queda en el mapa.
- **🧠 Inteligencia: un modelo que eliges** (⚙ › Inteligencia). Sin él, sólo cuentan las palabras. Con él, después del mapa por palabras llega su análisis: cómo toca cada repo, los repos que las palabras no vieron, la infraestructura que necesita y sus propias preguntas (en azul), con las relaciones entre todo para el grafo. Puede ser **uno de tus agentes** (Claude Code, Codex, OpenCode o Pi: su CLI en sólo lectura, en una carpeta neutra, con su propio login y, si quieres, otro de sus modelos), **la API de Claude** (Anthropic), **una API compatible con OpenAI** (OpenAI, OpenRouter, LM Studio…) u **Ollama** en tu máquina. Las claves van en variables de entorno, nunca en la base (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o `DEV_TEAM_OFFICE_MODEL_KEY`). El modelo sólo lee y contesta: no cambia nada. 🧪 *Probar* le pregunta algo mínimo.
- **Cada encargo lleva su parte:** los componentes que toca (🧩), lo que tiene que crear (🆕), la infraestructura que toca y cómo (🗄), los repos que la oficina no tiene (🔗) y el análisis del modelo sobre él (🧠).

El diálogo de directivas muestra también **la empresa**: la salud de cada departamento ahora, su autonomía y cómo fluyeron sus encargos en los últimos 7 días (cuántos, cuántos sin fallar y la mediana de lo que tardan de enviados a hechos).

El piso de la dirección está vestido para eso: parquet de nogal, una alfombra persa bajo la mesa del directorio, cortinas de terciopelo en el ventanal, una araña de cristal (cálida de noche, como los apliques de bronce y las lámparas de banquero), sillas de cuero, una biblioteca, un globo terráqueo, un busto de mármol y un aparador con el servicio de café.

**📚 El archivo**, en el subsuelo: lo que sabe la empresa, compartido por todas las oficinas y todos los agentes. Está cavado en la tierra, y la tierra tiene sus **fósiles**: amonites, trilobites, peces, un helecho, conchas, huesos y, al fondo, un dinosaurio entero (alrededor de la sala, en las dos vistas).

- **La base de conocimiento de la empresa (un RAG):** notas, decisiones, documentos, el **glosario** (cada término con su definición y sus sinónimos) y las actas de las directivas. **📥 Cargar** trae archivos (Markdown, texto, CSV, JSON, HTML; PDF y Word con `pdftotext` o `pandoc` en la máquina), arrastrados o elegidos, o una dirección web; cada uno puede ser para toda la empresa, un departamento o un proyecto, y vigente hasta una fecha.
  - **Tú lo lees como documento** (Markdown con formato, ⬇ .md para bajarlo): el texto legible se guarda tal cual.
  - **Los agentes lo reciben como índice:** cada entrada se corta en fragmentos por sus títulos, se indexa por palabras (sin acentos, sin internet) y, si lo enciendes en ⚙ › Archivo, también por significado (embeddings de Ollama local o de una API compatible con OpenAI, guardados junto a cada fragmento). *Cómo se indexó* muestra sus fragmentos.
  - **A pedido:** `search_knowledge` (MCP) devuelve los fragmentos que contestan una pregunta, del repositorio del agente, de su departamento y de la empresa, cada uno con un id como `[k12§3]` para citarlo, y los términos del glosario que tocan.
  - **Arriba de cada encargo y pregunta:** un bloque «📚 Del archivo» con los términos del glosario que menciona y los fragmentos más relevantes (se puede apagar).
  - **🕳 Vacíos:** lo que los agentes buscaron y no encontraron (o encontraron sólo en parte). Contéstalo (una nota, un documento, un término) y la próxima vez lo encuentran.
- **Skills:** se escriben una vez y se instalan en los repositorios que elijas, en el formato de cada agente (`.claude/skills/` para Claude Code, `.agents/skills/` para Pi, OpenCode y Codex). Nunca se pisa una skill propia del proyecto con el mismo nombre.
- **Conectores:** servidores MCP que traen información de afuera (el gestor de issues, la documentación, una base de datos), con su comando o su URL. Se instalan en la config MCP de cada repositorio (`.mcp.json`, `.pi/mcp.json`, `opencode.json`, `.codex/config.toml`) sin tocar lo demás; cada agente te pide confiar en ellos la primera vez. Nunca escribas un secreto en uno.
- **✨ Pedírsela a un agente:** describe la skill, el conector o el documento que necesitas y elige un agente: lo escribe y lo guarda en el archivo con `save_knowledge`.

Haz clic en las estanterías, el rack de skills o el panel de conectores para abrirlo (o `t` ahí). El monitor de la terminal muestra las directivas en curso y cuántas entradas guarda el archivo; su bitácora cuenta lo que pasa en los dos pisos.

## Loops: un repositorio paso a paso, con criterios de éxito

Un **loop** trabaja un repositorio con una lista de pasos, solo, y pasa al siguiente paso únicamente cuando el actual **cumple sus criterios de éxito**. Se abre con el chip 🔁 del HUD, con `i` o con 🔁 Loops en el diálogo de trabajo (`w`):

- **su repositorio** (uno registrado), **su intervalo** (mira cada **5 minutos** por defecto; de 1 a 1440) y **sus intentos** por paso (5 por defecto);
- **los criterios del loop**, que cada paso debe cumplir («los tests pasan»), y **cada paso** con qué hacer y sus propios criterios («POST /login devuelve un JWT»). Un criterio puede llevar el comando que lo prueba (`texto :: npm test`). Los criterios y los pasos se pueden agregar mientras corre.

Cada intervalo **mira su repositorio**: si está **trabajando** (el encargo del paso sigue abierto, o una sesión en su carpeta va a mitad de turno — la tuya también: el loop no te interrumpe) o el agente **te está preguntando algo**, sólo espera. **Libre**, avanza: el paso que no ha ido, va (a una sesión abierta del proyecto, o a una nueva); el que fue se revisa contra sus criterios. Todos cumplidos: el paso queda hecho y va el siguiente. Uno sin cumplir: el mismo paso vuelve con lo que falta (❌). Sin reportar: se le pide al agente que los verifique. Si el proyecto trabaja o está libre se ve en vivo en el diálogo, con la cuenta regresiva de la próxima mirada.

El agente reporta cada criterio con la herramienta MCP **`loop_report`** (o, una sesión lanzada en segundo plano, con una línea por criterio al final de su respuesta: `✅ 1`, `❌ 2 — por qué`). Tú puedes marcar uno (✓ / ✗): tu marca queda sobre lo que diga el agente. Tras sus intentos sin cumplirlos, el paso **te espera** (✋ en el chip): ↻ reintentarlo, ⏭ saltarlo o ✎ cambiarlo. Cuando se cumple el último paso, el acta del loop va al archivo. La oficina nunca corre las verificaciones: las hace el agente. API en [docs/api.es.md](api.es.md#loops-un-proyecto-paso-a-paso).
