# Contributing

**English** · [Español](CONTRIBUTING.es.md)

Thanks for wanting to improve Dev Team Office. This guide explains how to set up the environment, how to test, and what a change is expected to bring. The code rules are in [docs/conventions.md](docs/conventions.md).

## The environment

You need **Node.js ≥ 22.13**. The project has no runtime dependencies; `npm install` only installs `ws`, which the tests use.

```bash
git clone https://github.com/fmunoztorrent/dev-office
cd dev-office
npm install
npm test
```

To run the office from source without touching your installation:

```bash
DEV_TEAM_OFFICE_DB=/tmp/dto-dev.db DEV_TEAM_OFFICE_WEATHER=off node bin/dev-team-office.js --port 4320 --no-socket
```

To see the game with activity and no real agent, combine the office with the fake agent:

```bash
PORT=4320 DEV_TEAM_OFFICE_DB=/tmp/dto-demo.db DEV_TEAM_OFFICE_WEATHER=off node server/index.js &
node test/fixtures/fake-agent.mjs --url http://127.0.0.1:4320 --delay 450
```

And open `http://127.0.0.1:4320`. `dev-team-office demo --pi --port 4320` runs the TDD demo.

## How to test a change

1. **The tests:** `npm test`. They must all pass (CI runs them on macOS and Linux, with Node 22 and 24).
2. **The game (browser):** if you touched `public/`, check it in the browser with the demo office, in both views (front and top-down, with `v`), in English and in Spanish.
3. **The terminal:** if you touched `tui/`, try it in a real terminal, small (60×18) and large.
4. **With real agents:** if you touched an integration, try it with the real agent, but isolated:
   - a temporary `HOME` under `/tmp`, with the agent's minimal configuration;
   - a port other than 4317;
   - if you use herdr, a named session (`herdr --session dto-test server`).

   Never use your real configuration or your default herdr session. When done, delete the environment, unlinking symlinks first.

## What a change is expected to bring

- **One topic per change**, with its test. Tests go in `test/<topic>.test.js` and their names are Spanish sentences that say what is expected.
- **No new runtime dependencies.** If one is really needed, explain why in the PR.
- **UI texts in both languages** (`public/locales/en.js` and `es.js`, with the same keys and the same `{variables}`).
- **Up-to-date documentation, in both languages:** each English document (`README.md`, `CONTRIBUTING.md`, `docs/<name>.md`) has its Spanish version next to it (`.es.md`); a change to one goes into the other too. Also the CLI help (`cli.help`), if users see the change.
- **Code comments in English.**
- **Integrations never break their agent:** with the office off they do nothing, always with a time limit and without writing to the agent's output.
- **The commit message** with a conventional prefix: `feat(herdr): …`, `fix(office): …`, `docs: …`.

## The most common changes

| I want… | Where |
|---|---|
| Another character to handle a tool or a file | [`server/roles.js`](server/roles.js) and `TEXT_RULES` in [`integrations/common/devteam.mjs`](integrations/common/devteam.mjs) |
| To connect another agent | [docs/connect-a-harness.md](docs/connect-a-harness.md): adapter, integration, `setup` |
| A new event | [`server/office.js`](server/office.js) (`#enrich`), the simulation ([`public/sim.js`](public/sim.js)) and [docs/api.md](docs/api.md) |
| Something new in the office (furniture, a reaction) | [`public/sim.js`](public/sim.js) for the logic and [`public/game.js`](public/game.js) to draw it in both views (the top-down one uses [`public/iso.js`](public/iso.js)). The terminal is in [`tui/view.js`](tui/view.js) |
| A setting | [`server/store.js`](server/store.js), [`public/settings-ui.js`](public/settings-ui.js), [`tui/settings.js`](tui/settings.js) and `dev-team-office config` |
| An MCP tool | [`server/mcp.js`](server/mcp.js) and [docs/mcp.md](docs/mcp.md) |
| A new team pack | `teams/<pack>/` (a `team.json` and one agent per role, in Pi's format); [`bin/team.js`](bin/team.js) translates it to each harness |

## Releasing

1. Update [`CHANGELOG.md`](CHANGELOG.md) with the new version.
2. Bump the version in `package.json` (and `npm install --package-lock-only`), `server/server.js` and `.claude-plugin/plugin.json`; `test/release.test.js` checks they match.
3. Tag it (`git tag v<version>`) and create the GitHub release.

## Reporting a problem

Open an issue with:

- what you did and what you expected;
- what happened, with the output of `dev-team-office doctor`;
- your Node and agent versions.

If it is a game bug, a screenshot and which view you were in help. Security issues go through [SECURITY.md](SECURITY.md), not public issues.
