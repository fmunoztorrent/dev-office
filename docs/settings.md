# Settings

**English** · [Español](settings.es.md)

Everything you set up in the office lives in one place: the **settings area**. Open it with **⚙** (top right of the game) or `c`; `Esc` or **← Back to the office** returns. It is a page of its own, not a dialog over the game, and it has an address: `http://127.0.0.1:4317/#settings/<section>` opens a section directly, and the browser's back button works.

<img src="../.github/assets/settings.png" alt="The settings area: the menu of sections on the left and the Infrastructure section open, with each resource and who uses it" width="860">

- **The menu** on the left groups the sections. On a phone it becomes a picker at the top.
- **The search** (top right) finds a section by its name, by what it is for or by the words of what it holds ("kafka", "tokens", "herdr"); Enter goes to the first one.
- **Changes apply as you make them**, and the office uses them at once. Only **Characters** and **Models**, which you edit as a draft, have a **Save** button at the bottom.
- The terminal game has its own, smaller settings (`c`), on the same data: the everyday ones (language, zone and city, weather, the log, auto-compaction, herdr, the default model profile), the departments, the repositories and the characters. Its General tab gives this area's address for the rest.

## The sections

| Group | Section | What is there |
|---|---|---|
| The office | **General** | The language (English or Spanish: it changes everything live, in the browser, the terminal and the log), the company's time zone (type a city, a region or a country) and its city (for the weather, the sun and the moon), and whether the weather is real or simulated |
| | **The game** | The view (front, or isometric top-down), the style of its people (pixel art, or anime: a team of women), office life in the log, and this browser's sound and system notification when an agent waits for you |
| The company | **Company** | The company's standards (the CTO's: they go on top of every brief, before the department's and the repository's instructions) and its capacity: how many briefs a department takes at once from a directive |
| | **Departments** | Each department with its instructions, its autonomy, its time zone and city, and its repositories (＋ a new one, or bring an existing one in); 👁 watch it, 🗺 see it on the map |
| | **Repositories** | Every department's repositories: add one (its full path, the agent that serves it and its department; the harness it brings is detected as you type), its instructions, its components (declare one with its folder), ✉ send it a prompt. Also the open sessions nobody registered |
| Architecture | **Map** | The [architecture map](company.md#the-architecture-map): everything related, from a component up to the whole company, and its review |
| | **Projects** | Each product with its artifacts (a repository, or a component of one), their kinds, what each one uses and the order a change goes in; its team (a department, or one of its own) and its instructions. **↻ Propose kinds and dependencies** fills them in |
| | **Infrastructure** | The declared resources with who uses each one and how (link and unlink in place), what the repositories name and nobody declared yet (**Declare**), each repository's stack, and the form |
| The agents | **Autonomy** | Whether the analyst reviews each brief before it becomes work, and whether the agents work to the end without stopping to ask. Each department can have its own level |
| | **Context** | Auto-compaction: on or off, and the limit (in thousands of tokens, or a share of the window; 400k tokens by default) |
| | **Models** | The model profiles: which model each role uses, for which harnesses, and the default profile |
| | **Intelligence** | The model the office leans on to judge (today, an order's impact): none, one of your agents (read-only), the Claude API, an OpenAI-compatible API or Ollama, and **🧪 Try it**. It warns when something is missing (the key, the model, the agent's CLI) before you try. Keys go in the environment, never in the database |
| | **Archive** | Whether the archive's passages go on top of every brief, the search by meaning (embeddings, with Ollama or OpenAI) and the index (**↻ Index it again**) |
| | **Terminal** | herdr: open the agent in a pane, each subagent in its own pane, which way panes open, and which agent opens at start |
| The people | **Characters** | Each character of the office you are watching: name, title, sex, personality, style (how they answer you), colors, long hair, beard and glasses. **⬇ Export / ⬆ Import** a character as a JSON file |
| | **Experts** | The subject matter experts: each one tied to a skill, with what they know about, their look and their quick actions |
| Yours | **Mine** | Your private skills (installed in your personal folder of each agent, never in a repository) and your own tools (scripts your agents see as the MCP tool `my_<name>`). Agents cannot create them: only you |
| System | **Backup** | **⬇ Export / ⬆ Import** your settings as a JSON file (also `dev-team-office settings export\|import`), and where the database is |
| | **About** | The version that is running, its address, where it keeps its data, the docs and the game's keys |

**What a settings file carries:** the general settings, the departments with their instructions, autonomy and characters, the repositories with their instructions and components, the projects, the infrastructure, your skills and tools, and the experts. Not the history, the loops or the archive. Importing merges piece by piece: what the file brings replaces what is here, the rest stays, and what cannot be brought (a repository whose folder is not on this machine) is listed.

## From the command line

`dev-team-office config` lists every general setting with its value; `dev-team-office config <key> <value>` changes one (from a terminal, also with the office running: it applies at once). On and off are `on`/`off`.

| Key | Values |
|---|---|
| `lang` · `theme` | `en`\|`es` · `pixel`\|`anime` |
| `timezone` · `city` | an IANA zone or `system` · a city of that zone's country, or `zone` (the zone's city) |
| `weather` · `log.life` | `on`\|`off`: the real weather · office life in the terminal log |
| `view.office` · `view.mode` · `view.floor` | the department you watch · `flat`\|`iso` · `office`\|`exec`\|`archive` |
| `standards` · `capacity` | the company's standards (`-` empties them) · briefs a department takes at once from a directive (1–20) |
| `autonomy.clarify` · `autonomy.autonomous` | `on`\|`off`: the analyst reviews each brief first · the agents work to the end without stopping to ask |
| `compact.auto` · `compact.at` | `on`\|`off` · the limit: tokens (`400k`) or a share of the window (`80%`) |
| `archive.push` · `archive.embeddings` · `archive.model` · `archive.url` | `on`\|`off` · `off`\|`ollama`\|`openai` · the embeddings' model and address |
| `intelligence.provider` · `.harness` · `.model` · `.url` · `.timeout` | `off`\|`agent`\|`anthropic`\|`openai`\|`ollama` · the agent whose CLI it uses · its model · its address · seconds (10–600) |
| `herdr.launch` · `herdr.subagents` · `herdr.direction` · `herdr.startAgent` | `on`\|`off` · `on`\|`off` · `right`\|`down` · `auto`\|`none`\|a repository's id |

`dev-team-office departments`, `agents`, `character`, `architecture` and `settings export|import` cover the rest. Every command: [the full CLI](usage.md#the-full-cli).

## Environment variables

Everything above is kept in the database. These are read from the environment, when the office starts:

| Variable | What for |
|---|---|
| `DEV_TEAM_OFFICE_PORT` · `DEV_TEAM_OFFICE_HOST` | The HTTP and WebSocket port (4317) and interface (`127.0.0.1`); also `--port`, `--host` |
| `DEV_TEAM_OFFICE_SOCKET` | The Unix socket the integrations use (`~/.dev-team-office/office.sock`) |
| `DEV_TEAM_OFFICE_DB` | The database file (`~/.dev-team-office/office.db`) |
| `DEV_TEAM_OFFICE_LANG` | The language until one is saved in ⚙ (`en`, `es`) |
| `DEV_TEAM_OFFICE_WEATHER=off` · `DEV_TEAM_OFFICE_LOCATION` | No real weather (nor the city search) · the city or `lat,lon` of the weather when ⚙ sets none (otherwise the zone's city) |
| `DEV_TEAM_OFFICE_MODEL_KEY` | The key of the model in ⚙ › Intelligence (or `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |
| `DEV_TEAM_OFFICE_EMBED_KEY` | The key of the search by meaning with OpenAI (or `OPENAI_API_KEY`) |
| `DEV_TEAM_OFFICE_CLAUDE_BIN` | Which `claude` the office launches |
| `DEV_TEAM_OFFICE_URL` · `DEV_TEAM_OFFICE_OFFICE` | For an integration or a command: the office's address, and the department its events go to |
| `DEV_TEAM_OFFICE_AUTOSTART=0` | Pi's extension does not start the office when a session opens (only `/office`) |
| `DEV_TEAM_OFFICE_SETUP_CLI=0` | `setup` does not call the agents' CLIs (Claude Code's plugin update) |

The installer has its own: [installation](installation.md#2-install). The office sets a few for the agents it launches (`DEV_TEAM_OFFICE_LAUNCHED`, `DEV_TEAM_OFFICE_SESSION`, `DEV_TEAM_OFFICE_BTW`…, and `PW_TEST_REPORTER` for the [E2E tests](e2e.md)): they are not for you to set.

## Where everything is kept

**Everything "local" comes from the time zone:** the date and time (the clock, lunch, day and night), the **country** and the city (from the IANA zone table, offline: `America/Santiago` → Chile, Santiago, −33.45, −70.67) and, with those coordinates, **the weather**. By default, the system's zone.

Everything is saved in an **SQLite** database (also from the CLI: `dev-team-office config`, `dev-team-office offices`): `~/.dev-team-office/office.db`, or the path in `DEV_TEAM_OFFICE_DB`. It uses `node:sqlite`, so there are no native dependencies, and the file has `0600` permissions. Its main tables:

- `offices`: the company's departments (offices), with their instructions and autonomy;
- `agents`: the registered repositories (each with its agent and department);
- `projects`: each project folder's instructions;
- `components`: the components declared in each repository;
- `settings`: the general settings (`prefs`: language, style, time zone and city, weather, view, model profiles, autonomy, standards, capacity, archive, auto-compaction, intelligence and herdr) and each department's characters;
- `prompts`: the history of what you sent them and how it ended;
- `asks`: the side questions (btw) and their answers;
- `directives`: the executive floor's orders and how each part went;
- `knowledge` (with `knowledge_chunks`, `knowledge_fts` and `knowledge_gaps`): the archive, its passages for the search, and the searches that found nothing;
- `mine`: your private skills and your own tools;
- `systems`: the projects and their artifacts;
- `loops`: the projects' loops, their criteria and how each step goes;
- `experts`: the subject matter experts and their skills;
- `resources`: the infrastructure on the map (where it lives and which repositories use it).

Databases from earlier versions migrate by themselves (the main office is added). `DEV_TEAM_OFFICE_LANG=es` picks the language until one has been saved.

If a `~/.dev-team-office/config.json` from earlier versions existed, it is imported the first time.

Everything is validated before writing, applied live, and a foreign website cannot change anything.
