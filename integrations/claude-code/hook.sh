#!/usr/bin/env sh
# Compatibilidad: el hook de verdad es hook.mjs (corre del lado de Claude Code). Nunca falla.
exec node "$(dirname "$0")/hook.mjs" 2>/dev/null || exit 0
