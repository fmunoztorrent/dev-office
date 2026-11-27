#!/usr/bin/env node
// Mimics an agent's CLI answering a side question (btw): `claude -p …`, `pi -p …`…
//   FAKE_BTW_LOG=file      one JSON line per invocation ({ args, cwd, btw, launched })
//   FAKE_BTW_FAIL=1        ends with an error (and something on stderr)
//   FAKE_BTW_FAIL=provider like Pi with an extension that warns: warnings first, then the provider's error
//   FAKE_BTW_SLOW=ms       takes a while to answer
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_BTW_LOG) fs.appendFileSync(process.env.FAKE_BTW_LOG, `${JSON.stringify({ args, cwd: process.cwd(), btw: process.env.DEV_TEAM_OFFICE_BTW, launched: process.env.DEV_TEAM_OFFICE_LAUNCHED })}\n`);
if (process.env.FAKE_BTW_FAIL === 'provider') {
  process.stderr.write('Warning: Extension package "/home/x/.pi/agent/npm/node_modules/some-ext/package.json": Host-provided extension packages must be declared in peerDependencies with a "*" range, not dependencies: typebox. Installed copies can bypass the extension loader and create duplicate runtime modules.\n');
  process.stderr.write('(node:4242) ExperimentalWarning: SQLite is an experimental feature\n');
  process.stderr.write('401: {"type":"authentication_error","code":"api_key_expired","message":"This API key has expired."}\n');
  process.exit(1);
}
if (process.env.FAKE_BTW_FAIL) {
  process.stderr.write('Error: no session found\n');
  process.exit(2);
}
setTimeout(() => process.stdout.write('\x1b[1mEl equipo\x1b[0m está cobrando con QR.\n'), Number(process.env.FAKE_BTW_SLOW) || 0);
