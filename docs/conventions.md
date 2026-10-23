# Conventions

**English** · [Español](conventions.es.md)

These are Dev Team Office's code rules. Contributors follow them, and so do the agents that work on the repository ([AGENTS.md](../AGENTS.md)).

## Principles

1. **The game is the frontend; the agent is the backend.** The office draws what the agents report and sends them tasks, but it never runs work on its own. Pipelines, gates and model switches run on the agent's side ([`integrations/`](../integrations)).
2. **An integration never breaks its agent.** If the office is off, the hook, plugin or extension does nothing:
   - everything has a time limit and no errors reach the agent;
   - hooks always exit with code 0.
3. **Zero runtime dependencies.** Only Node ≥ 22.13: `node:sqlite` for the database, our own WebSocket ([`server/ws.js`](../server/ws.js)) and Node's global `WebSocket` as the client. `ws` is a dev dependency only, to test the server against another client.
4. **Local stays private.** The server listens on `127.0.0.1` and on a `0600` Unix socket; routes that change anything reject foreign websites. The only outbound request is the weather (Open-Meteo), and it can be turned off.
5. **The same simulation everywhere.** [`public/sim.js`](../public/sim.js) is the office's logic. It is used by the browser ([`public/game.js`](../public/game.js), with the front and top-down views) and by the terminal ([`tui/`](../tui)). The clock, the time of day and the randomness can be injected.

## Language and style

- **Code comments are in English.** Identifiers are in English or Spanish, like the surrounding code.
- **Documentation is in both languages.** Each document in English (`README.md`, `CONTRIBUTING.md`, `docs/<name>.md`) has its Spanish version next to it (`README.es.md`, `CONTRIBUTING.es.md`, `docs/<name>.es.md`); a change to one goes into the other too. `AGENTS.md` and `CLAUDE.md` are in Spanish.
- **Every file starts with a comment** that says what it is and how it fits. Non-trivial functions carry a short JSDoc (`/** … */`) with what the signature does not show.
- **ES modules** (`"type": "module"`) and `import` from `node:*` for Node built-ins.
- **Small functions and readable names.** No just-in-case abstractions: a function used in one place lives next to that place.
- **UI texts are not in the code:** they live in [`public/locales/en.js`](../public/locales/en.js) and [`es.js`](../public/locales/es.js) and are read with `t('key', { variables })`.
  - Both languages have the same keys and the same `{variables}`; a test checks it.
  - English is the default language.
- **API and MCP responses are in English** when they are for machines or other agents. Messages for people use `t()`.

## Layout

| Folder | What goes there |
|---|---|
| `bin/` | The executable (`dev-team-office`) and `setup`/`install`/`team` |
| `server/` | The server: HTTP and WebSocket API, offices, events, roles, tasks, pipelines, herdr, MCP and the database |
| `public/` | The browser game, and what it shares with the terminal (`sim.js`, `sky.js`, `clock.js`, `i18n.js`, `iso.js`) |
| `tui/` | The terminal: the game, the log, the monitor, the settings and the subagent viewer |
| `integrations/` | What runs on each agent's side (Claude Code and Codex hooks, OpenCode plugin, Pi extension) and its shared library |
| `skills/` | The skills, for any harness |
| `teams/` | The team packs |
| `docs/` | The documentation |
| `test/` | The tests (`node --test`) and their fixtures |

To add something:

- **A tool or a file that another character should handle:** the rules in [`server/roles.js`](../server/roles.js) and `TEXT_RULES` in [`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs).
- **A new agent:**
  1. its adapter in [`server/adapters.js`](../server/adapters.js) (or the generic format);
  2. its integration in `integrations/`;
  3. its step in [`bin/setup.js`](../bin/setup.js);
  4. its guide in [`connect-a-harness.md`](connect-a-harness.md).
- **A setting:**
  1. the default and the validation in [`server/store.js`](../server/store.js);
  2. the UI in [`public/settings-ui.js`](../public/settings-ui.js) and [`tui/settings.js`](../tui/settings.js);
  3. the key in `dev-team-office config`;
  4. the texts in both languages.

## Events and roles

- Everything that enters the office is translated into the **generic format** ([`api.md`](api.md#generic-event-format)).
- **Eight roles:** `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`.
- A subagent declares its own with `role:` in its file. If it does not, it is inferred from its name and then from its description ([`connect-a-harness.md`](connect-a-harness.md)).
- A declared role that does not exist is **not** silently replaced: it is left out and reported.
- **Everything a subagent does carries its `subId`.**
  - Subagents that are their own process (Pi) report to the parent's session with `child`; so do OpenCode's child sessions.
  - In Claude Code, a subagent's tools carry its `agent_id`.

## Tests

```bash
npm test
```

- **`node --test`** and nothing else. Each file is `test/<topic>.test.js`, and test names are Spanish sentences that say what is expected.
- Tests that check texts import [`test/es.js`](../test/es.js) first, which sets Spanish.
- **The real installation is never touched:**
  - The database is `:memory:`, or a file in a temporary directory (`DEV_TEAM_OFFICE_DB`, a temporary `HOME`).
  - The server starts with `port: 0`, `socket: null` (or a temporary one) and `weather: false`.
  - herdr uses a fake CLI (`new Herdr({ run })`); agents, the fixtures in `test/fixtures/` (`fake-agent.mjs`, `fake-claude.mjs`…).
- **Real-world tests** (with real Pi, Claude Code or herdr):
  - only in an isolated `HOME` under `/tmp`, on a port other than 4317 and with a named herdr session (`herdr --session <name>`);
  - never in the default herdr session or the user's real configuration;
  - when done, everything is deleted, unlinking symlinks first.
- A change visible in the game is checked in the browser with the demo office (an isolated database and a fake agent), not only with tests.

## Commits and changes

- Messages carry a conventional prefix, in English or Spanish: `feat(office): …`, `fix(herdr): …`, `docs: …`, `test: …`, `chore: …`.
- Every behavior change comes with its test, and its documentation if users see it: both READMEs, `docs/` (both languages) or the CLI help text (`cli.help` in both languages).
- Each release updates [`CHANGELOG.md`](../CHANGELOG.md) and the version in `package.json`, `server/server.js` and `.claude-plugin/plugin.json` (`test/release.test.js` checks they match).
- `.claude/` is local to each person and is not committed.
