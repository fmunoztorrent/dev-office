#!/usr/bin/env node
// Mimics `claude -p --output-format json …` (a stage with another model launched by the Claude Code hook).
//   FAKE_CLAUDE_LOG=file      one JSON line per invocation ({ args, prompt, model, agent, alias })
//   FAKE_CLAUDE_FAIL=1        ends with an error
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prompt = args.at(-1);
if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, prompt, model: flag('--model'), agent: flag('--agent'), alias: process.env.DEV_TEAM_OFFICE_SESSION_ALIAS, cwd: process.cwd(), launched: process.env.DEV_TEAM_OFFICE_LAUNCHED })}\n`);
}
if (process.env.FAKE_CLAUDE_FAIL) {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'algo salió mal' }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `hecho con ${flag('--model')}${flag('--agent') ? ` como ${flag('--agent')}` : ''}` }));
