#!/bin/sh
# The real user flow, isolated, for developing Dev Team Office: this checkout installed the way a
# user installs it (install.sh + setup), in a temporary HOME, with a test project and its own herdr
# session. Every change a user would see is checked there, by hand, the way a user would use it
# (AGENTS.md, "Probar como un usuario").
#
#   scripts/dev-session.sh up [--agent pi] [--port 4390] [--lang es]
#                                   creates it, installs this checkout and connects the agents
#   scripts/dev-session.sh herdr    prints the command that opens its herdr (run it in a real terminal)
#   scripts/dev-session.sh update   installs this checkout again, after a change (then restart the office)
#   scripts/dev-session.sh h <args> herdr --session <its session> <args>: pane list, pane read, send-keys…
#   scripts/dev-session.sh run <cmd> runs a command with its environment, in its project
#   scripts/dev-session.sh status   its office and its herdr panes
#   scripts/dev-session.sh down     stops its herdr and its office and deletes everything
#
# --agent can be repeated (pi, opencode, codex, claude): their logins are linked into the temporary
# HOME (symlinks to your real files, removed before deleting it). --name <n> (or DTO_DEV_NAME) keeps
# several apart: /tmp/dto-<n> and the herdr session dto-<n>; the default is "dev".
# Nothing else of your real HOME is touched: not your office, not your agents' configuration.

set -eu

say() { printf '%s\n' "$*"; }
die() { printf 'dev-session: %s\n' "$*" >&2; exit 1; }

REPO=$(cd "$(dirname "$0")/.." && pwd)
REAL_HOME=$HOME
NAME=${DTO_DEV_NAME:-dev}
PORT=4390
LANG_UI=es
AGENTS=""
CMD=${1:-help}
[ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --lang) LANG_UI=$2; shift 2 ;;
    --agent) AGENTS="$AGENTS $2"; shift 2 ;;
    *) break ;;
  esac
done
case "$NAME" in *[!a-z0-9-]* | '') die "--name: only lowercase letters, digits and dashes" ;; esac
E=/tmp/dto-$NAME
H=$E/home
SESSION=dto-$NAME
PROJECT=$E/tienda
[ -f "$E/env.sh" ] && PORT=$(. "$E/env.sh" && printf '%s' "$DEV_TEAM_OFFICE_PORT")

need() { [ -f "$E/env.sh" ] || die "there is no session $NAME ($E): scripts/dev-session.sh up --name $NAME"; }
# Puts a CLI on the session's PATH without bringing your real dev-team-office along: if its folder
# has one (~/.local/bin often does), the CLI is linked into $E/bin instead of adding the folder.
add_tool() {
  b=$(command -v "$1" 2>/dev/null) || return 0
  add_dir "$(dirname "$b")" || ln -sf "$b" "$E/bin/$1"
}
add_dir() {
  [ -d "$1" ] || return 0
  [ -e "$1/dev-team-office" ] && return 1
  case ":$P:" in *":$1:"*) ;; *) P="$P:$1" ;; esac
}

# An agent's login, linked into the temporary HOME (or copied, for the files the agent rewrites).
link_login() {
  case "$1" in
    pi)
      mkdir -p "$H/.pi/agent"
      for f in auth.json npm; do [ -e "$REAL_HOME/.pi/agent/$f" ] && ln -s "$REAL_HOME/.pi/agent/$f" "$H/.pi/agent/$f"; done
      for f in models-store.json settings.json; do [ -f "$REAL_HOME/.pi/agent/$f" ] && cp "$REAL_HOME/.pi/agent/$f" "$H/.pi/agent/$f"; done
      ;;
    opencode)
      mkdir -p "$H/.local/share/opencode"
      [ -f "$REAL_HOME/.local/share/opencode/auth.json" ] && ln -s "$REAL_HOME/.local/share/opencode/auth.json" "$H/.local/share/opencode/auth.json"
      ;;
    codex)
      mkdir -p "$H/.codex"
      [ -f "$REAL_HOME/.codex/auth.json" ] && ln -s "$REAL_HOME/.codex/auth.json" "$H/.codex/auth.json"
      ;;
    claude) say "  claude: log in inside its pane (/login); its login is not linked" ;;
    *) die "--agent: pi, opencode, codex or claude" ;;
  esac
  return 0
}

install_checkout() {
  (. "$E/env.sh" && DEV_TEAM_OFFICE_SOURCE="$REPO" sh "$REPO/install.sh") 2>&1 | sed 's/^/  /'
}

case "$CMD" in
  up)
    [ -e "$E" ] && die "$E already exists: scripts/dev-session.sh update (or down; macOS may have emptied it)"
    command -v herdr >/dev/null 2>&1 || die "herdr is required: https://herdr.dev"
    command -v node >/dev/null 2>&1 || die "Node.js >= 22.13 is required"
    [ -n "$AGENTS" ] || AGENTS=pi
    mkdir -p "$H/.config/herdr" "$PROJECT" "$E/bin"
    printf 'onboarding = false\n' > "$H/.config/herdr/config.toml"
    for a in $AGENTS; do link_login "$a"; done
    # PATH: the command the installer leaves (~/.local/bin), node, the agents' CLIs, herdr and the system
    P="$H/.local/bin:$E/bin"
    for t in node $AGENTS herdr; do add_tool "$t"; done
    for d in /opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do add_dir "$d" || true; done
    cat > "$E/env.sh" <<EOF
# The environment of the dev session $NAME (scripts/dev-session.sh): source it before anything else.
export HOME=$H
export PATH=$P
export DEV_TEAM_OFFICE_PORT=$PORT
export DEV_TEAM_OFFICE_URL=http://127.0.0.1:$PORT
export DEV_TEAM_OFFICE_WEATHER=off
export DEV_TEAM_OFFICE_LANG=$LANG_UI
export DTO_DEV_SESSION=$SESSION
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME PI_CODING_AGENT_DIR DEV_TEAM_OFFICE_SOCKET DEV_TEAM_OFFICE_DB CLAUDE_CODE_SESSION_ID CLAUDECODE CLAUDE_CODE_ENTRYPOINT HERDR_ENV HERDR_PANE_ID HERDR_WORKSPACE_ID
EOF
    # a small project to ask the agents for real work
    (
      cd "$PROJECT"
      git init -q
      printf '{ "name": "tienda", "type": "module", "private": true, "scripts": { "test": "node --test" } }\n' > package.json
      mkdir -p src test
      printf '// The shop cart. Prices are in cents (integers).\nexport function subtotal(items) {\n  return items.reduce((sum, it) => sum + it.price * it.qty, 0);\n}\n' > src/cart.js
      printf "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { subtotal } from '../src/cart.js';\n\ntest('subtotal', () => {\n  assert.equal(subtotal([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600);\n});\n" > test/cart.test.js
      printf '# tienda\n\nA test project for Dev Team Office. Tests: `npm test`. Prices in cents.\n' > README.md
      git add -A && git -c user.name=dev -c user.email=dev@localhost commit -qm 'tienda'
    )
    say "Installing this checkout in $H (as a user would)…"
    install_checkout
    say ""
    say "Ready: $E (office on port $PORT, herdr session $SESSION)."
    say "Open it in a real terminal (in Claude Code, the Terminal panel):"
    say "  . $E/env.sh && cd $PROJECT && herdr --session $SESSION"
    say "Then use it as a user: your agent in a pane, dev-team-office in another, http://127.0.0.1:$PORT in the browser."
    ;;
  herdr)
    need
    say ". $E/env.sh && cd $PROJECT && herdr --session $SESSION"
    ;;
  update)
    need
    say "Installing this checkout again in ${H}…"
    install_checkout
    say "A running office of this install restarts by itself when the version changes; if not: dev-team-office restart (or q and dev-team-office in its pane)."
    ;;
  h)
    need
    . "$E/env.sh"
    exec herdr --session "$SESSION" "$@"
    ;;
  run)
    need
    . "$E/env.sh"
    cd "$PROJECT"
    exec "$@"
    ;;
  status)
    need
    . "$E/env.sh"
    say "$E · port $PORT · herdr session $SESSION"
    dev-team-office status 2>&1 | sed 's/^/  /' || true
    herdr --session "$SESSION" pane list 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        try { for (const p of JSON.parse(s).result.panes) console.log(`  ${p.pane_id} ${p.agent || "-"} ${p.agent_status || ""} ${p.cwd || ""}`); }
        catch { console.log("  herdr: not running"); }
      });' || true
    ;;
  down)
    [ -d "$E" ] || { say "There is no $E."; exit 0; }
    case "$E" in /tmp/dto-*) ;; *) die "refusing to delete $E" ;; esac
    # (macOS empties /tmp of files unused for 3 days: env.sh may be gone)
    [ -f "$E/env.sh" ] && { (. "$E/env.sh" && herdr --session "$SESSION" server stop >/dev/null 2>&1) || true; }
    pids=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
    # the links to your real logins go first, so deleting never follows them
    find "$E" -type l -exec rm -f {} +
    rm -rf "$E"
    say "Deleted $E (herdr session $SESSION stopped)."
    ;;
  help | -h | --help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command: $CMD (scripts/dev-session.sh help)" ;;
esac
