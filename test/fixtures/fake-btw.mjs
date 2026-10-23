#!/usr/bin/env node
// Mimics an agent's CLI answering a side question (btw): `claude -p …`, `pi -p …`…
//   FAKE_BTW_LOG=file      one JSON line per invocation ({ args, cwd, btw, launched })
//   FAKE_BTW_FAIL=1        ends with an error (and something on stderr)
//   FAKE_BTW_SLOW=ms       takes a while to answer
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_BTW_LOG) fs.appendFileSync(process.env.FAKE_BTW_LOG, `${JSON.stringify({ args, cwd: process.cwd(), btw: process.env.DEV_TEAM_OFFICE_BTW, launched: process.env.DEV_TEAM_OFFICE_LAUNCHED })}\n`);
if (process.env.FAKE_BTW_FAIL) {
  process.stderr.write('Error: no session found\n');
  process.exit(2);
}
setTimeout(() => process.stdout.write('\x1b[1mEl equipo\x1b[0m está cobrando con QR.\n'), Number(process.env.FAKE_BTW_SLOW) || 0);
