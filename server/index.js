// `npm start`: the office without the terminal interface (API + web view in the browser).
import os from 'node:os';
import path from 'node:path';
import { startServer, DEFAULT_PORT, DEFAULT_HOST } from './server.js';
import { t } from '../public/i18n.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || DEFAULT_HOST;

try {
  // your Claude Code settings: the office keeps your auto-compaction threshold there (server/compact.js)
  const claudeSettings = path.join(os.homedir(), '.claude', 'settings.json');
  const server = await startServer({ port, host, log: console.log, claudeSettings });
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(t('cli.portBusy', { port }));
    console.error('PORT=4318 npm start');
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
