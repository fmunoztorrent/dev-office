# Política de seguridad

[English](SECURITY.md) · **Español**

Dev Team Office escucha sólo en `127.0.0.1` y en un socket Unix que sólo tu usuario puede leer (`0600`). Las rutas que cambian algo rechazan las peticiones de otros sitios web (revisan Host y Origin), y el archivo de la base tiene permisos `0600`.

## Qué sale de tu máquina

Nada, salvo lo que enciendas:

| Qué | A dónde va | Cómo apagarlo |
|---|---|---|
| El clima y la búsqueda de una ciudad | [Open-Meteo](https://open-meteo.com) (gratis, sin clave) | ⚙ › General › clima real, o `DEV_TEAM_OFFICE_WEATHER=off` |
| El modelo de la oficina, si eliges uno (⚙ › Inteligencia) | La API de Claude, una API compatible con OpenAI o tu Ollama local; o uno de tus propios agentes | Está apagado si no eliges uno |
| La búsqueda por significado del archivo, si la enciendes (⚙ › Archivo) | Tu Ollama local, o la API de OpenAI | Está apagada si no la enciendes |

Las claves de API se leen del entorno (`DEV_TEAM_OFFICE_MODEL_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) y nunca se guardan en la base. Tus agentes hablan con sus propios proveedores, como siempre; la oficina no ve ese tráfico.

## Reportar una vulnerabilidad

Por favor no abras un issue público. Usa el reporte privado de GitHub: **Security › Report a vulnerability** en [fmunoztorrent/dev-office](https://github.com/fmunoztorrent/dev-office/security/advisories/new). Tendrás una respuesta en pocos días.

Sólo la última versión tiene soporte.
