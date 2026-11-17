# Security policy

**English** · [Español](SECURITY.es.md)

Dev Team Office listens only on `127.0.0.1` and on a Unix socket readable only by your user (`0600`). Routes that change anything reject requests from other websites (Host and Origin checks), and the database file has `0600` permissions.

## What leaves your machine

Nothing, except what you turn on:

| What | Where it goes | How to turn it off |
|---|---|---|
| The weather and the search of a city | [Open-Meteo](https://open-meteo.com) (free, no key) | ⚙ › General › real weather, or `DEV_TEAM_OFFICE_WEATHER=off` |
| The office's model, if you choose one (⚙ › Intelligence) | The Claude API, an OpenAI-compatible API or your local Ollama; or one of your own agents | It is off unless you choose one |
| The archive's search by meaning, if you turn it on (⚙ › Archive) | Your local Ollama, or the OpenAI API | It is off unless you turn it on |

API keys are read from the environment (`DEV_TEAM_OFFICE_MODEL_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and never stored in the database. Your agents talk to their own providers, as always; the office does not see their traffic.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead: **Security › Report a vulnerability** on [fmunoztorrent/dev-office](https://github.com/fmunoztorrent/dev-office/security/advisories/new). You will get an answer within a few days.

Only the latest release is supported.
