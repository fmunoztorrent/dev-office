---
name: dev-team-office-config
description: Conecta un harness de agentes (Pi, Claude Code, OpenCode o cualquiera con archivos de agente en markdown) a Dev Team Office. Úsalo cuando el usuario pida instalar la oficina para un equipo o harness nuevo, configurarla, o hacer que los personajes de la oficina reflejen los subagentes del harness (declarar el `role:` de cada agente). También cuando los subagentes caigan siempre en el mismo personaje.
---

# Dev Team Office: conectar un harness

La oficina es genérica: administra cualquier harness y nunca necesita saber cómo se llaman sus
agentes. Este skill explica el contrato de roles y el procedimiento para declarar, en el harness,
qué rol del equipo representa cada agente. Es autocontenido: se instala lejos de este repo y no
referencia rutas del repo, sólo el contrato y la librería instalada.

## Cuándo usarla

- El usuario quiere **conectar o configurar** un harness con la oficina.
- Quiere **instalar la oficina** para un equipo o harness nuevo.
- Quiere que los **personajes reflejen los subagentes** del harness.
- Los subagentes de un harness caen siempre en el **mismo personaje** (síntoma de un mapa de roles vacío).

## El contrato: 8 roles y un `role:` opcional

La oficina conoce **exactamente 8 roles**:

`po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`

Un harness declara su propio mapeo con un campo **opcional `role:`** en el frontmatter YAML de cada
archivo de agente. Ese campo es la única superficie de integración: la oficina nunca ve los nombres
del harness.

```yaml
---
name: power-sync
description: Sincroniza el estado del backend con el frontend
role: backend
---
```

Los nombres del harness **nunca** se hardcodean en la oficina; si algún nombre propio aparece en el
código de la oficina, es un error.

La **guía canónica** *Conectar cualquier harness a la oficina* —en el repo de la oficina— es la
fuente de verdad del contrato completo: la lista de alias que acepta cada rol, la precedencia
detallada y qué pasa con una declaración vacía o rota. Este skill es el procedimiento operativo y no
repite esa semántica, para que no puedan derivar: si el contrato cambia, se actualiza primero la guía
y este skill sólo la referencia.

## El procedimiento

### 1. Ubica los archivos de agente del harness

La oficina sólo escanea los directorios que conoce, por harness y en dos ámbitos: **proyecto**
(`<proyecto>/…`) y **usuario** (`~/…`). Si el agente no está en uno de estos directorios, la oficina
no lo ve.

| Harness | Proyecto | Usuario |
|---|---|---|
| Pi | `<proyecto>/.pi/agents/` | `~/.pi/agent/agents/` |
| Claude Code | `<proyecto>/.claude/agents/` | `~/.claude/agents/` |
| OpenCode | `<proyecto>/.opencode/agents/` | `~/.config/opencode/agents/` |

Sólo se leen archivos `.md`. Si el mismo nombre aparece en proyecto y usuario, gana el de
**proyecto**. Un harness distinto a los de la tabla sólo sirve si expone sus archivos en uno de
estos directorios.

### 2. Declara el rol de cada agente

Para cada archivo, decide a cuál de los 8 roles corresponde. Infiere del **nombre** y de la
**descripción** del agente; si sigue siendo genuinamente ambiguo, **pregúntale al usuario** en vez
de adivinar. Después agrega `role: <rol>` **dentro** del frontmatter existente:

```yaml
---
name: power-sync
description: Sincroniza el estado del backend con el frontend
role: backend          # <- la línea que agregas; deja el resto intacto
tools: Read, Grep, Bash
---
```

Dos reglas duras para esa edición:

- **`tools` (y claves similares) deben seguir siendo escalares separados por comas.** Una lista
  YAML (`- Read`) rompe el cargador de agentes de Pi.
- **Nunca renombres ni borres claves existentes.** Sólo agregas `role:`.

### 3. Asegúrate de que la oficina pueda verlos

Si el harness guarda sus agentes en su propio repo y nunca los expone en un directorio escaneado,
el mapa de roles sale **vacío** y cada subagente cae en el personaje por defecto. Si el harness tiene
su propio paso de sync/install, córrelo para copiar los agentes a un directorio escaneado. Hazlo
antes de dar la configuración por terminada.

### 4. Instala el lado de la oficina

```bash
dev-team-office install <pi|opencode|claude>
```

Esto deja la librería común, la extensión/plugin/hook del harness y los skills. En **Claude Code**
queda un paso manual: copiar la sección `hooks` del snippet que imprime el comando a
`~/.claude/settings.json` (o al `.claude/settings.json` del proyecto).

### 5. Verifica

Corre el chequeo determinista de la sección **Verificación**.

## La regla de precedencia

**Un `role:` declarado GANA sobre cualquier heurística.** Sin declaración, la oficina adivina por el
texto de la tarea y por el **nombre** del agente, y si no acierta cae al default **`tl`**. La guía
canónica *Conectar cualquier harness a la oficina* explica por qué declarar es lo que vuelve el mapeo
explícito, autoritativo e inmune a renombres.

## Verificación

Mira el `role:` que la oficina va a leer en cada archivo de agente. El comando toma el directorio de
agentes como parámetro (nunca una ruta de usuario hardcodeada):

```bash
# Pasa el directorio de agentes de tu harness (aquí, el de proyecto de Pi como ejemplo).
AGENTS="${1:-$(git rev-parse --show-toplevel)/.pi/agents}"

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[1];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
  const fm = (fs.readFileSync(path.join(dir, f), "utf8").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
  const role = (fm.match(/^role\s*:\s*(.+)$/m) || [])[1];
  console.log(f.padEnd(28), role ? role.trim() : "(sin role)");
}
' "$AGENTS"
```

Debe listar un rol para cada agente que te importe. Un `(sin role)` es un subagente que caerá en la
heurística.

Chequeo de precedencia con un nombre neutro (`power-sync`). La librería instalada es la fuente
autoritativa del mapeo:

```bash
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const { roleOfAgent } = await import(pathToFileURL(process.env.HOME + "/.dev-team-office/lib/devteam.mjs"));
const resolve = (name, declared) => roleOfAgent(name, declared) || "tl"; // "tl" es el default de la oficina
console.log("power-sync sin declarar  :", resolve("power-sync"));            // -> tl
console.log("power-sync role backend :", resolve("power-sync", "backend"));  // -> backend
'
```

Con el mapa vacío el nombre no descriptivo resuelve a **`tl`**; con `role: backend` resuelve a
**`backend`**. Ésa es la diferencia que produce declarar el rol.

## Gotchas

- El instalador **no** instala los archivos de agente del harness: sólo las piezas de la oficina.
  Los agentes son tuyos y viven donde vive el harness.
- La librería y la extensión instaladas son **copias**. Si editas el repo de la oficina, vuelve a
  correr `dev-team-office install <harness>` para refrescarlas.
- Una sesión **headless** (sin TTY, p. ej. `pi -p`) nunca se registra por WebSocket, pero sus
  eventos sí llegan a la oficina.
- `agent_roles` responde **`200 {ok:true, accepted:0}`**: no es un evento que se dibuja, se
  **aprende**. Ese `accepted:0` es correcto.
