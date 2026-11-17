# Ajustes

[English](settings.md) · **Español**

Todo lo que configuras en la oficina vive en un solo lugar: el **área de ajustes**. Se abre con **⚙** (arriba a la derecha del juego) o con `c`; `Esc` o **← Volver a la oficina** te devuelve. Es una página propia, no un diálogo sobre el juego, y tiene dirección: `http://127.0.0.1:4317/#settings/<sección>` abre una sección directo, y el botón atrás del navegador funciona.

<img src="../.github/assets/settings.png" alt="El área de ajustes: el menú de secciones a la izquierda y la sección Infraestructura abierta, con cada recurso y quién lo usa" width="860">

- **El menú** de la izquierda agrupa las secciones. En un teléfono se vuelve un selector arriba.
- **El buscador** (arriba a la derecha) encuentra una sección por su nombre, por para qué es o por las palabras de lo que tiene («kafka», «tokens», «herdr»); Enter va a la primera.
- **Los cambios se aplican apenas los haces** y la oficina los usa al tiro. Sólo **Personajes** y **Modelos**, que se editan como borrador, tienen el botón **Guardar** abajo.
- El juego en la terminal tiene sus propios ajustes, más chicos (`c`), sobre los mismos datos: los de todos los días (idioma, zona y ciudad, clima, la bitácora, la autocompactación, herdr, el perfil de modelos por defecto), los departamentos, los repositorios y los personajes. Su pestaña General da la dirección de esta área para lo demás.

## Las secciones

| Grupo | Sección | Qué hay |
|---|---|---|
| La oficina | **General** | El idioma (inglés o español: lo cambia todo en vivo, en el navegador, la terminal y la bitácora), la zona horaria de la empresa (escribe una ciudad, una región o un país) y su ciudad (para el clima, el sol y la luna), y si el clima es el real o simulado |
| | **El juego** | La vista (frontal, o cenital isométrica), el estilo de su gente (pixel art, o anime: un equipo de mujeres), la vida de la oficina en la bitácora, y el sonido y la notificación del sistema de este navegador cuando un agente te espera |
| La empresa | **Empresa** | Los estándares de la empresa (los del CTO: van arriba de cada encargo, antes de las indicaciones del departamento y del repositorio) y su capacidad: cuántos encargos de una directiva toma un departamento a la vez |
| | **Departamentos** | Cada departamento con sus indicaciones, su autonomía, su zona horaria y su ciudad, y sus repositorios (＋ uno nuevo, o traer uno que ya existe); 👁 mirarlo, 🗺 verlo en el mapa |
| | **Repositorios** | Los repositorios de todos los departamentos: agregar uno (su ruta completa, el agente que lo atiende y su departamento; el harness que trae se detecta mientras escribes), sus indicaciones, sus componentes (declara uno con su carpeta), ✉ mandarle un prompt. También las sesiones abiertas que nadie registró |
| Arquitectura | **Mapa** | El [mapa de la arquitectura](company.es.md#el-mapa-de-la-arquitectura): todo relacionado, desde un componente hasta la empresa entera, y su revisión |
| | **Proyectos** | Cada producto con sus artefactos (un repositorio, o un componente de uno), sus tipos, lo que usa cada uno y el orden en que va un cambio; su equipo (un departamento, o uno propio) y sus indicaciones. **↻ Proponer tipos y dependencias** los completa |
| | **Infraestructura** | Los recursos declarados con quién usa cada uno y cómo (vincular y desvincular ahí mismo), lo que nombran los repositorios y nadie declaró todavía (**Declarar**), el stack de cada repositorio, y el formulario |
| Los agentes | **Autonomía** | Si la analista revisa cada encargo antes de que pase a trabajo, y si los agentes trabajan hasta el final sin detenerse a preguntar. Cada departamento puede tener su propio nivel |
| | **Contexto** | La autocompactación: encendida o apagada, y el tope (en miles de tokens, o una parte de la ventana; 400k tokens por defecto) |
| | **Modelos** | Los perfiles de modelos: qué modelo usa cada rol, para qué harnesses, y el perfil por defecto |
| | **Inteligencia** | El modelo en que se apoya la oficina para juzgar (hoy, el impacto de un pedido): ninguno, uno de tus agentes (en sólo lectura), la API de Claude, una API compatible con OpenAI u Ollama, y **🧪 Probar**. Avisa si falta algo (la clave, el modelo, la CLI del agente) antes de probar. Las claves van en el entorno, nunca en la base |
| | **Archivo** | Si los fragmentos del archivo van arriba de cada encargo, la búsqueda por significado (embeddings, con Ollama u OpenAI) y el índice (**↻ Indexarlo de nuevo**) |
| | **Terminal** | herdr: abrir el agente en un pane, cada subagente en el suyo, hacia dónde se abren los panes y qué agente se abre al partir |
| La gente | **Personajes** | Cada personaje de la oficina que estás mirando: nombre, cargo, sexo, personalidad, estilo (cómo te contesta), colores, pelo largo, barba y lentes. **⬇ Exportar / ⬆ Importar** un personaje como archivo JSON |
| | **Expertos** | Los expertos (SME): cada uno asociado a una skill, con de qué sabe, su aspecto y sus acciones rápidas |
| Lo tuyo | **Mío** | Tus skills privadas (instaladas en tu carpeta personal de cada agente, nunca en un repositorio) y tus herramientas (scripts que tus agentes ven como la herramienta MCP `my_<nombre>`). Los agentes no pueden crearlas: sólo tú |
| Sistema | **Respaldo** | **⬇ Exportar / ⬆ Importar** tus ajustes como archivo JSON (también `dev-team-office settings export\|import`), y dónde está la base |
| | **Acerca de** | La versión que está corriendo, su dirección, dónde guarda sus datos, la documentación y las teclas del juego |

**Qué lleva un archivo de ajustes:** los ajustes generales, los departamentos con sus indicaciones, autonomía y personajes, los repositorios con sus indicaciones y componentes, los proyectos, la infraestructura, tus skills y herramientas, y los expertos. No el historial, los loops ni el archivo. Importar mezcla pieza por pieza: lo que trae el archivo reemplaza lo de aquí, lo demás se queda, y lo que no se pudo traer (un repositorio cuya carpeta no está en esta máquina) se lista.

## Desde la línea de comandos

`dev-team-office config` lista cada ajuste general con su valor; `dev-team-office config <clave> <valor>` cambia uno (desde una terminal, también con la oficina corriendo: se aplica al tiro). Encendido y apagado son `on`/`off`.

| Clave | Valores |
|---|---|
| `lang` · `theme` | `en`\|`es` · `pixel`\|`anime` |
| `timezone` · `city` | una zona IANA o `system` · una ciudad del país de esa zona, o `zone` (la ciudad de la zona) |
| `weather` · `log.life` | `on`\|`off`: el clima real · la vida de la oficina en la bitácora de la terminal |
| `view.office` · `view.mode` · `view.floor` | el departamento que miras · `flat`\|`iso` · `office`\|`exec`\|`archive` |
| `standards` · `capacity` | los estándares de la empresa (`-` los vacía) · encargos que toma a la vez un departamento de una directiva (1–20) |
| `autonomy.clarify` · `autonomy.autonomous` | `on`\|`off`: la analista revisa cada encargo primero · los agentes trabajan hasta el final sin detenerse a preguntar |
| `compact.auto` · `compact.at` | `on`\|`off` · el tope: tokens (`400k`) o una parte de la ventana (`80%`) |
| `archive.push` · `archive.embeddings` · `archive.model` · `archive.url` | `on`\|`off` · `off`\|`ollama`\|`openai` · el modelo y la dirección de los embeddings |
| `intelligence.provider` · `.harness` · `.model` · `.url` · `.timeout` | `off`\|`agent`\|`anthropic`\|`openai`\|`ollama` · el agente cuya CLI usa · su modelo · su dirección · segundos (10–600) |
| `herdr.launch` · `herdr.subagents` · `herdr.direction` · `herdr.startAgent` | `on`\|`off` · `on`\|`off` · `right`\|`down` · `auto`\|`none`\|el id de un repositorio |

`dev-team-office departments`, `agents`, `character`, `architecture` y `settings export|import` cubren el resto. Todos los comandos: [la CLI completa](usage.es.md#la-cli-completa).

## Variables de entorno

Todo lo de arriba se guarda en la base. Estas se leen del entorno, al partir la oficina:

| Variable | Para qué |
|---|---|
| `DEV_TEAM_OFFICE_PORT` · `DEV_TEAM_OFFICE_HOST` | El puerto HTTP y WebSocket (4317) y la interfaz (`127.0.0.1`); también `--port`, `--host` |
| `DEV_TEAM_OFFICE_SOCKET` | El socket Unix que usan las integraciones (`~/.dev-team-office/office.sock`) |
| `DEV_TEAM_OFFICE_DB` | El archivo de la base (`~/.dev-team-office/office.db`) |
| `DEV_TEAM_OFFICE_LANG` | El idioma mientras no se guarde uno en ⚙ (`en`, `es`) |
| `DEV_TEAM_OFFICE_WEATHER=off` · `DEV_TEAM_OFFICE_LOCATION` | Sin clima real (ni la búsqueda de ciudades) · la ciudad o `lat,lon` del clima cuando ⚙ no pone una (si no, la ciudad de la zona) |
| `DEV_TEAM_OFFICE_MODEL_KEY` | La clave del modelo de ⚙ › Inteligencia (o `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |
| `DEV_TEAM_OFFICE_EMBED_KEY` | La clave de la búsqueda por significado con OpenAI (o `OPENAI_API_KEY`) |
| `DEV_TEAM_OFFICE_CLAUDE_BIN` | Qué `claude` lanza la oficina |
| `DEV_TEAM_OFFICE_URL` · `DEV_TEAM_OFFICE_OFFICE` | Para una integración o un comando: la dirección de la oficina, y el departamento al que van sus eventos |
| `DEV_TEAM_OFFICE_AUTOSTART=0` | La extensión de Pi no levanta la oficina al abrir una sesión (sólo `/office`) |
| `DEV_TEAM_OFFICE_SETUP_CLI=0` | `setup` no llama a las CLIs de los agentes (la actualización del plugin de Claude Code) |

El instalador tiene las suyas: [instalación](installation.es.md#2-instalar). La oficina pone algunas a los agentes que lanza (`DEV_TEAM_OFFICE_LAUNCHED`, `DEV_TEAM_OFFICE_SESSION`, `DEV_TEAM_OFFICE_BTW`…, y `PW_TEST_REPORTER` para las [pruebas E2E](e2e.es.md)): no son para que las pongas tú.

## Dónde se guarda todo

**De la zona horaria sale todo lo "local":** la fecha y la hora (el reloj, el almuerzo, el día y la noche), el **país** y la ciudad (de la tabla de zonas IANA, sin conexión: `America/Santiago` → Chile, Santiago, −33.45, −70.67) y, con esas coordenadas, **el clima**. Por defecto, la zona del sistema.

Todo se guarda en una base **SQLite** (también desde la CLI: `dev-team-office config`, `dev-team-office offices`): `~/.dev-team-office/office.db`, o la ruta de `DEV_TEAM_OFFICE_DB`. Usa `node:sqlite`, así que no hay dependencias nativas, y el archivo tiene permisos `0600`. Sus tablas principales:

- `offices`: los departamentos (oficinas) de la empresa, con sus indicaciones y su autonomía;
- `agents`: los repositorios registrados (cada uno con su agente y departamento);
- `projects`: las indicaciones de la carpeta de cada proyecto;
- `components`: los componentes declarados de cada repositorio;
- `settings`: los ajustes generales (`prefs`: idioma, estilo, zona horaria y ciudad, clima, vista, perfiles de modelos, autonomía, estándares, capacidad, archivo, autocompactación, inteligencia y herdr) y los personajes de cada departamento;
- `prompts`: el historial de lo que les mandaste y cómo terminó;
- `asks`: las preguntas al paso (btw) y sus respuestas;
- `directives`: las órdenes del piso de la dirección y cómo fue cada parte;
- `knowledge` (con `knowledge_chunks`, `knowledge_fts` y `knowledge_gaps`): el archivo, sus fragmentos para la búsqueda y las búsquedas que no encontraron nada;
- `mine`: tus skills privadas y tus herramientas;
- `systems`: los proyectos y sus artefactos;
- `loops`: los loops de los proyectos, sus criterios y cómo va cada paso;
- `experts`: los expertos y sus skills;
- `resources`: la infraestructura en el mapa (dónde vive y qué repositorios la usan).

Las bases de versiones anteriores se migran solas (se agrega la oficina principal). `DEV_TEAM_OFFICE_LANG=es` elige el idioma mientras no se haya guardado uno.

Si existía un `~/.dev-team-office/config.json` de versiones anteriores, se importa la primera vez.

Todo se valida antes de escribir, se aplica en caliente y un sitio web ajeno no puede cambiar nada.
