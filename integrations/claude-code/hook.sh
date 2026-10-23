#!/usr/bin/env sh
# Compatibility: the real hook is hook.mjs (it runs on Claude Code's side). It never fails.
exec node "$(dirname "$0")/hook.mjs" 2>/dev/null || exit 0
