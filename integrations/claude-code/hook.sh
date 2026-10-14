#!/usr/bin/env sh
# Reenvía el JSON que Claude Code pasa a sus hooks (stdin) a Dev Team Office y escribe en
# stdout lo que la oficina responda. Casi siempre es vacío (no cambia nada); en el hook Stop
# puede ser {"decision":"block","reason":"…"} con una tarea enviada desde la oficina, y
# Claude la hace antes de detenerse.
#
# Usa el socket Unix si existe (sólo accesible por tu usuario) y si no, HTTP en localhost.
# Nunca bloquea ni falla: si la oficina no está corriendo, no imprime nada y sale con 0.
SOCK="${DEV_TEAM_OFFICE_SOCKET:-$HOME/.dev-team-office/office.sock}"
OFFICE_URL="${DEV_TEAM_OFFICE_URL:-http://127.0.0.1:4317}"
ROUTE="/v1/hooks/claude-code"
# Si la oficina lanzó este Claude, se lo decimos para unir la ejecución con su sesión.
[ -n "$DEV_TEAM_OFFICE_RUN" ] && ROUTE="$ROUTE?run=$DEV_TEAM_OFFICE_RUN"
if [ -S "$SOCK" ]; then
  set -- --unix-socket "$SOCK" "http://localhost$ROUTE"
else
  set -- "$OFFICE_URL$ROUTE"
fi
curl -s --fail --connect-timeout 0.3 --max-time 2 \
  -H 'content-type: application/json' --data-binary @- "$@" 2>/dev/null
exit 0
