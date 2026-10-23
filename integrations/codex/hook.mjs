#!/usr/bin/env node
// Codex hook → Dev Team Office. Codex calls this file on every event of its lifecycle
// (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart/Stop, Stop…) with the event's
// JSON on stdin; here it is only forwarded to the office, which draws it.
//
// It is installed by `dev-team-office setup` (or `install codex`): it lives in ~/.codex/hooks.json.
// Codex asks you to review and trust new hooks once: in Codex, `/hooks`.
//
// It never breaks Codex: it prints nothing on stdout, never blocks, and exits with 0 on any error.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const SOCK = process.env.DEV_TEAM_OFFICE_SOCKET || path.join(os.homedir(), '.dev-team-office', 'office.sock');
const URL_BASE = (process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317').replace(/\/$/, '');
// this session's office (team), if the office opened it, and its herdr pane
const WHERE = {
  ...(process.env.DEV_TEAM_OFFICE_OFFICE ? { devteam_office: process.env.DEV_TEAM_OFFICE_OFFICE } : {}),
  ...(process.env.HERDR_PANE_ID ? { herdr_pane: process.env.HERDR_PANE_ID } : {}),
};

function post(route, body, timeoutMs = 1500) {
  const data = JSON.stringify(body);
  if (fs.existsSync(SOCK)) {
    return new Promise((resolve) => {
      const req = http.request({ socketPath: SOCK, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: timeoutMs }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end(data);
    });
  }
  return fetch(`${URL_BASE}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data, signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => r.arrayBuffer()).catch(() => {});
}

const readStdin = () => new Promise((resolve) => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => resolve(s));
  process.stdin.on('error', () => resolve(s));
});

async function main() {
  // a side question (btw) launched by the office: it is not the team's work, it is not reported
  if (process.env.DEV_TEAM_OFFICE_BTW) return;
  const input = JSON.parse((await readStdin()) || '{}');
  if (!input.session_id || !input.hook_event_name) return;
  // the reply text and large results are of no use to the office: they are not sent
  const { transcript_path, last_assistant_message, tool_response, ...rest } = input;
  const ok = tool_response && typeof tool_response === 'object' ? { tool_response: { success: tool_response.success, is_error: tool_response.is_error, error: typeof tool_response.error === 'string' ? tool_response.error.slice(0, 300) : undefined } } : {};
  await post('/v1/events/codex', { ...rest, ...ok, ...WHERE });
}

main().catch(() => {}).finally(() => process.exit(0));
