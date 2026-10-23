# Security policy

Dev Team Office listens only on `127.0.0.1` and on a Unix socket readable only by your user (`0600`); routes that change anything reject requests from other websites (Host and Origin checks). The only outbound request is the weather (Open-Meteo), which can be turned off with `DEV_TEAM_OFFICE_WEATHER=off`.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead: **Security › Report a vulnerability** on [fmunoztorrent/dev-office](https://github.com/fmunoztorrent/dev-office/security/advisories/new). You will get an answer within a few days.

Only the latest release is supported.
