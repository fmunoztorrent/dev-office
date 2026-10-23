#!/bin/sh
# Dev Team Office — installer.
#
#   curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh
#
# Downloads the office to ~/.dev-team-office/app (no npm install: it has no dependencies), puts the
# `dev-team-office` command in ~/.local/bin and runs `dev-team-office setup`, which connects every
# coding agent it finds (Claude Code, Codex, OpenCode, Pi, Gemini, Cursor): hooks, MCP server, skills.
# Run it again to update. Your data (~/.dev-team-office/office.db) is never touched.
#
# Environment:
#   DEV_TEAM_OFFICE_REPO     owner/repo on GitHub        (default fmunoztorrent/dev-office)
#   DEV_TEAM_OFFICE_REF      branch or tag               (default main)
#   DEV_TEAM_OFFICE_SOURCE   a local folder or .tar.gz to install instead of downloading
#   DEV_TEAM_OFFICE_HOME     where it lives              (default ~/.dev-team-office)
#   DEV_TEAM_OFFICE_BIN_DIR  where the command goes      (default ~/.local/bin)
#   DEV_TEAM_OFFICE_NO_SETUP=1  only install, do not connect the agents

set -eu

REPO="${DEV_TEAM_OFFICE_REPO:-fmunoztorrent/dev-office}"
REF="${DEV_TEAM_OFFICE_REF:-main}"
DTO_HOME="${DEV_TEAM_OFFICE_HOME:-$HOME/.dev-team-office}"
APP="$DTO_HOME/app"

say() { printf '%s\n' "$*"; }
die() { printf 'dev-team-office: %s\n' "$*" >&2; exit 1; }

# --- Node.js >= 22.13 (it brings SQLite and WebSocket: nothing else to install)
command -v node >/dev/null 2>&1 || die "Node.js >= 22.13 is required: https://nodejs.org (or: brew install node · nvm install 22)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node.js $(node -v) is too old: 22.13 or newer is required (https://nodejs.org)"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t dto)
trap 'rm -rf "$TMP"' EXIT INT TERM

# --- the files
if [ -n "${DEV_TEAM_OFFICE_SOURCE:-}" ]; then
  SRC="$DEV_TEAM_OFFICE_SOURCE"
  if [ -d "$SRC" ]; then
    mkdir -p "$TMP/src"
    (cd "$SRC" && tar -cf - --exclude ./node_modules --exclude ./.git --exclude ./dist --exclude ./.claude .) | (cd "$TMP/src" && tar -xf -)
  else
    mkdir -p "$TMP/x" && tar -xzf "$SRC" -C "$TMP/x"
    mv "$TMP/x"/* "$TMP/src"
  fi
else
  URL="https://codeload.github.com/$REPO/tar.gz/$REF"
  say "Downloading $REPO@$REF…"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$URL" -o "$TMP/app.tgz" || die "could not download $URL"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$TMP/app.tgz" "$URL" || die "could not download $URL"
  else die "curl or wget is required"; fi
  mkdir -p "$TMP/x" && tar -xzf "$TMP/app.tgz" -C "$TMP/x"
  mv "$TMP/x"/* "$TMP/src"
fi
[ -f "$TMP/src/bin/dev-team-office.js" ] || die "that does not look like Dev Team Office (no bin/dev-team-office.js)"

# --- in place (the old copy goes away only when the new one is ready)
mkdir -p "$DTO_HOME"
rm -rf "$APP.new"
mv "$TMP/src" "$APP.new"
rm -rf "$APP"
mv "$APP.new" "$APP"
chmod +x "$APP/bin/dev-team-office.js"
VERSION=$(node -p "require('$APP/package.json').version")
say "Dev Team Office $VERSION installed at $APP"

# --- connect the agents (and the `dev-team-office` command)
if [ "${DEV_TEAM_OFFICE_NO_SETUP:-}" = 1 ]; then
  say "Next: $APP/bin/dev-team-office.js setup"
  exit 0
fi
DEV_TEAM_OFFICE_FROM_INSTALLER=1 node "$APP/bin/dev-team-office.js" setup
