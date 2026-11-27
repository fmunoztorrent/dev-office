# herdr: the agent in a pane, and each subagent in its own

**English** · [Español](herdr.es.md)

What the office does when it runs inside herdr. The short version is in the [usage guide](usage.md#herdr-one-pane-per-agent-and-per-subagent).

The full flow, inside herdr:

1. You open herdr in your project.
2. You type `dev-team-office`: it starts the server, shows the **activity monitor** (not the game) and opens your agent (Pi, Claude Code…) in a pane on the right.
3. You ask your agent for something in its pane, or from the game in the browser (`o` in the monitor; `t` or click the whiteboard). The agent works on it in its pane and **each subagent it launches opens in its own pane**, below the agent: there you see live who it is (its character), its task, each tool, its commands' output and, at the end, its report. The ones running at the same time sit side by side, and each pane closes by itself a few seconds after its subagent finishes. And when the subagent never says it finished — its harness can lose that end, with a pane that goes away before the result is recorded — the office does not wait for it: a pane that is no longer there, or a subagent whose own process ended, is over, so it closes it and takes it off the team (the log says so).

The subagent is still run by its harness (gentle-pi, Claude Code's Task, OpenCode's): the pane **shows** it with `dev-team-office follow`, it does not run it. Turn it off in **⚙ › Terminal › Each subagent in its pane** (or `dev-team-office config herdr.subagents off`).

If you launch the office **inside herdr** (`HERDR_ENV=1`), the agent does not run in the background:

- **When the office opens**, the agent opens in a **new pane** next to the office's (without taking your focus), with its label (`🏢 Payments · Claude Code · shop`). Which one? The one from `--agent` or from **⚙ › Terminal › Agent on open**: on automatic, the registered agent of the folder where you launched the office, or the CLI that folder has configured (or the first one installed). `--no-launch` opens none. If that agent is already open in a pane of this workspace, in its folder (you restarted the office), the office follows that pane instead of opening another.
- **New sessions** (a prompt from the whiteboard without an open session) also open in a pane, interactive: the agent gets the prompt there and the task ends when its turn ends. Turn it off in ⚙ › Terminal.
- **The agent orchestrates its own work from its pane** —subagents, its harness's pipelines— and **may open more panes** for other activities: tests in watch mode, a server, a build or another agent with its own prompt, with `dev-team-office pane` (Pi's skill explains it) or with `herdr` itself. That belongs to the agent, not to the office; the office **understands** it: each pane is an activity someone on the team takes care of (tests, QA; the dev server, frontend; another agent, by its role) while it stays open. Panes an agent opens in its project's folder are adopted by the office automatically; if an agent gets blocked in its pane, the manager raises a hand.
- **When an agent asks you something** on its screen (a permission, "Allow?", a choice between options), the office reads it from its pane: the **✋ chip** shows up in the game ("Pi is asking you") and the monitor lists it under **WAITING FOR YOU**. Answer there with a click (or `r`): the office presses the same keys you would in the agent's pane.

```bash
dev-team-office pane --role qa --title "tests in watch" -- npm test -- --watch
dev-team-office pane --agent claude --role tl --title review -- "Review the diff and report only what is actionable"
```

Outside herdr everything works as before (new agents run in the background). The office talks to herdr only through its CLI (`herdr pane split|run|list|rename|read|send-keys`, `herdr agent start|prompt`).
