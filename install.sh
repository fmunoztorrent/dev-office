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
#   DEV_TEAM_OFFICE_REF      branch or tag               (default: the newest version: the highest version tag,
#                            vX.Y.Z, or main if its version is newer — a release not tagged yet — or the tags
#                            cannot be looked up)
#                            an auto-resolved version never downgrades an installed newer one
#   DEV_TEAM_OFFICE_SOURCE   a local folder or .tar.gz to install instead of downloading
#   DEV_TEAM_OFFICE_HOME     where it lives              (default ~/.dev-team-office)
#   DEV_TEAM_OFFICE_BIN_DIR  where the command goes      (default ~/.local/bin)
#   DEV_TEAM_OFFICE_NO_SETUP=1  only install, do not connect the agents
#   DEV_TEAM_OFFICE_MODIFY_PATH=1|0  add ~/.local/bin to your shell's PATH without asking (1) or never (0)

set -eu

REPO="${DEV_TEAM_OFFICE_REPO:-fmunoztorrent/dev-office}"
REF="${DEV_TEAM_OFFICE_REF:-}"
DTO_HOME="${DEV_TEAM_OFFICE_HOME:-$HOME/.dev-team-office}"
APP="$DTO_HOME/app"
AUTO_REF=0

say() { printf '%s\n' "$*"; }
# curl with retries; on failure (e.g. exit 16, HTTP/2 framing errors) once more over HTTP/1.1.
fetch() { curl -fsSL --retry 3 --retry-delay 1 "$@" || curl -fsSL --http1.1 --retry 3 --retry-delay 1 "$@"; }
# The highest version tag (vX.Y.Z), compared numerically per segment (0.10.0 > 0.9.1). Fails if none.
latest_tag() {
  command -v curl >/dev/null 2>&1 || return 1
  fetch "https://api.github.com/repos/${REPO}/tags?per_page=100" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).map(x=>x.name).filter(n=>/^v\d+\.\d+\.\d+$/.test(n)).sort((a,b)=>{const p=a.slice(1).split("."),q=b.slice(1).split(".");for(let i=0;i<3;i++)if(p[i]-q[i])return p[i]-q[i];return 0});if(!t.length)throw 0;process.stdout.write(t[t.length-1])}catch{process.exit(1)}})'
}
# The version on main (its package.json), to see if there is a release newer than the tags. Fails if it cannot be read.
main_version() {
  command -v curl >/dev/null 2>&1 || return 1
  fetch "https://raw.githubusercontent.com/${REPO}/main/package.json" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).version;if(!/^\d+\.\d+\.\d+/.test(v))throw 0;process.stdout.write(v)}catch{process.exit(1)}})'
}
# Prints gt, eq or lt: version $1 compared with $2, numerically per segment (0.10.0 > 0.9.1).
vcmp() { node -p 'const p=v=>String(v).replace(/^v/,"").split("-")[0].split(".").map(n=>parseInt(n,10)||0);const a=p(process.argv[1]),b=p(process.argv[2]);let r="eq";for(let i=0;i<3&&r==="eq";i++)if((a[i]||0)!==(b[i]||0))r=(a[i]||0)>(b[i]||0)?"gt":"lt";r' "$1" "$2"; }
die() { printf 'dev-team-office: %s\n' "$*" >&2; exit 1; }

# --- Node.js >= 22.13 (it brings SQLite and WebSocket: nothing else to install)
command -v node >/dev/null 2>&1 || die "Node.js >= 22.13 is required: https://nodejs.org (or: brew install node · nvm install 22)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node.js $(node -v) is too old: 22.13 or newer is required (https://nodejs.org)"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t dto)
# A failure must never look like success: macOS's sh can stop on an error and still exit with 0.
# Leaving before the end says so, and exits with 1.
FINISHED=0
trap 'rm -rf "$TMP"; [ "$FINISHED" = 1 ] || { printf "dev-team-office: the install did not finish\n" >&2; exit 1; }' EXIT INT TERM

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
  # AUTO_REF=1: nobody chose a version, so the downgrade guard below applies.
  # Nobody chose: the newest one. The highest tag, unless main already carries a newer version (a
  # release whose tag is not there yet); without tags, main.
  if [ -z "$REF" ]; then
    AUTO_REF=1
    TAG=$(latest_tag) || TAG=""
    MAIN_VERSION=$(main_version) || MAIN_VERSION=""
    if [ -z "$TAG" ]; then REF=main
    elif [ -n "$MAIN_VERSION" ] && [ "$(vcmp "$MAIN_VERSION" "$TAG")" = gt ]; then REF=main
    else REF=$TAG; fi
  fi
  URL="https://codeload.github.com/${REPO}/tar.gz/${REF}"
  say "Downloading ${REPO}@${REF}…"
  if command -v curl >/dev/null 2>&1; then fetch "$URL" -o "$TMP/app.tgz" || die "could not download $URL"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$TMP/app.tgz" "$URL" || die "could not download $URL"
  else die "curl or wget is required"; fi
  mkdir -p "$TMP/x" && tar -xzf "$TMP/app.tgz" -C "$TMP/x"
  mv "$TMP/x"/* "$TMP/src"
fi
[ -f "$TMP/src/bin/dev-team-office.js" ] || die "that does not look like Dev Team Office (no bin/dev-team-office.js)"

# --- downgrade guard: an auto-resolved version never replaces a newer installed one
if [ "$AUTO_REF" = 1 ]; then
  CURRENT="${DEV_TEAM_OFFICE_UPDATE_FROM:-}"
  [ -n "$CURRENT" ] || { [ -f "$APP/package.json" ] && CURRENT=$(node -p 'require(process.argv[1]).version' "$APP/package.json" 2>/dev/null) || CURRENT=""; }
  if [ -n "$CURRENT" ]; then
    NEW=$(node -p 'require(process.argv[1]).version' "$TMP/src/package.json")
    # Prints gt, eq or lt: CURRENT compared with NEW, numerically per segment.
    CMP=$(vcmp "$CURRENT" "$NEW")
    if [ "$CMP" = gt ]; then
      say "Dev Team Office ${CURRENT} is newer than ${NEW}: not downgrading (set DEV_TEAM_OFFICE_REF=v${NEW} to install it anyway)"
      FINISHED=1
      exit 0
    fi
    if [ "$CMP" = eq ] && [ -n "${DEV_TEAM_OFFICE_UPDATE_FROM:-}" ]; then
      say "Dev Team Office ${CURRENT} is already the latest version"
      FINISHED=1
      exit 0
    fi
  fi
fi

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
# An office left running from this install keeps its old code: restart it with the new one.
node "$APP/bin/dev-team-office.js" restart --if-outdated 2>/dev/null || true

if [ "${DEV_TEAM_OFFICE_NO_SETUP:-}" = 1 ]; then
  say "Next: $APP/bin/dev-team-office.js setup"
  FINISHED=1
  exit 0
fi
DEV_TEAM_OFFICE_FROM_INSTALLER=1 node "$APP/bin/dev-team-office.js" setup
FINISHED=1
