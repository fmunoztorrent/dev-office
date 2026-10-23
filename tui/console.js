// The console: what the terminal shows when the office is launched (`dev-team-office`). A log that
// runs with the activity of the agents of every office and what the office does (tasks,
// pipelines, herdr panes, weather, settings). From there:
//   g  opens the game in this same terminal (q goes back to the log)
//   o  opens it in the browser (the URL the server serves)
//   h  repeats the help · q (or ctrl+c) closes the office
// Without an interactive terminal (in the background, `serve`) only the log is written, without colors.

import { spawn } from 'node:child_process';
import { DEFAULT_TEAM, phaseInfo } from '../public/sim.js';
import { t, timeOf, LANGUAGES } from '../public/i18n.js';
import { weatherIcon } from '../public/sky.js';
import { clean } from './screen.js';
import { AGENT_NAME } from '../public/targets.js';

const DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const rgb = (hexStr) => { const n = parseInt(String(hexStr).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const NOISY = new Set(['todos', 'poke', 'pane_state']);

/**
 * An office event as a log line: { text, tone, speaker? } (speaker: who talks, if it is not a
 * character), or null if it does not go in the log. Shared by the log and the monitor.
 */
export function activityLine(ev) {
  if (NOISY.has(ev.kind) || (ev.kind === 'tool_end' && ev.ok)) return null;
  const speaker = ev.kind === 'chat' || (ev.kind === 'btw' && ev.phase === 'ask') ? ev.from : undefined;
  let text = ev.text || ev.kind;
  let tone;
  switch (ev.kind) {
    case 'phase': { const ph = phaseInfo(ev.phase); text = `${ph.icon} ${ph.label}${ev.text ? `: ${ev.text}` : ''}`; break; }
    case 'phase_end': text = t('events.turnEnd', { text: ev.text ? `: ${ev.text}` : '' }); tone = 'dim'; break;
    case 'tool_end': text = `✖ ${ev.text}`; tone = ev.phase === 'red' ? 'warn' : 'err'; break;
    case 'error': text = `✖ ${ev.text}`; tone = 'err'; break;
    case 'subagent_start': text = `🤖 ${ev.text}`; break;
    case 'subagent_end': text = `✔ ${ev.text}`; tone = 'ok'; break;
    case 'stage_end': text = `${ev.ok ? '✔' : '✖'} ${ev.text}`; tone = ev.ok ? 'ok' : 'err'; break;
    case 'pane_open': text = `🪟 ${ev.pane} · ${ev.text}`; break;
    case 'pane_close': text = `🪟 ${ev.pane} · ${ev.text} ✔`; tone = 'dim'; break;
    case 'dispatch': text = `📨 ${ev.text}`; break;
    case 'waiting': text = `✋ ${ev.text}`; tone = 'err'; break;
    case 'done': text = `🎉 ${ev.text}`; tone = 'ok'; break;
    case 'task': text = `📝 ${ev.text}`; break;
    case 'btw':
      text = ev.phase === 'ask' ? `❓ btw: ${ev.text}` : ev.phase === 'answer' ? `💡 ${ev.text}` : `✖ btw: ${ev.text}`;
      tone = ev.phase === 'failed' ? 'err' : ev.phase === 'answer' ? 'ok' : undefined;
      break;
    default: break;
  }
  return { text, tone, speaker };
}

/** Opens a URL in the system's browser (without waiting). */
export function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); return true; } catch { return false; }
}

/**
 * The log: hooks into the server's events and writes a line for each thing that happens.
 * @param color  with ANSI colors (a terminal) or plain text (a log file)
 */
export function createLog({ server, write, color = true, colorMode = '256' }) {
  const paint = (hexStr) => {
    if (!color) return '';
    const [r, g, b] = rgb(hexStr);
    if (colorMode === 'truecolor') return `\x1b[38;2;${r};${g};${b}m`;
    const q = (v) => Math.round((v / 255) * 5);
    return `\x1b[38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
  };
  const c = (code) => (color ? code : '');
  const offices = () => server.company.list();
  const officeName = (id) => offices().find((o) => o.id === id)?.name || id;
  const zone = (id) => offices().find((o) => o.id === (id || 'main'))?.timezone;
  const person = (office, role) => {
    const look = { ...DEFAULT_TEAM[role], ...(server.store.getAppearance(office)?.[role] || {}) };
    return look.name ? { name: look.name, shirt: look.shirt } : null;
  };

  /** A line: time · [office] · who · what. */
  function line({ ts = Date.now(), office, who, shirt, text, tone }) {
    const parts = [`${c(DIM)}${timeOf(ts, zone(office), { seconds: true })}${c(RESET)}`];
    if (office && offices().length > 1) parts.push(`${paint('#ffd166')}🏢 ${officeName(office)}${c(RESET)}`);
    if (who) parts.push(`${shirt ? paint(shirt) : ''}${c(BOLD)}${who}${c(RESET)}`);
    const body = clean(String(text ?? ''));
    parts.push(tone === 'err' ? `${paint('#ef476f')}${body}${c(RESET)}` : tone === 'warn' ? `${paint('#ffd166')}${body}${c(RESET)}` : tone === 'dim' ? `${c(DIM)}${body}${c(RESET)}` : tone === 'ok' ? `${paint('#06d6a0')}${body}${c(RESET)}` : body);
    write(`${parts.join('  ')}\n`);
  }

  // ---- the agents' activity ----
  function onActivity(office, ev) {
    const a = activityLine(ev);
    if (!a) return;
    const p = ev.role ? person(office, ev.role) : null;
    line({ ts: ev.ts, office, who: a.speaker ?? (p?.name || t('events.office')), shirt: a.speaker ? null : p?.shirt, text: a.text, tone: a.tone });
  }

  // ---- tasks and pipelines: only when their state changes ----
  const taskSeen = new Map(), runSeen = new Map();
  function onTasks() {
    for (const task of server.hub.snapshot().tasks) {
      const key = `${task.status}|${task.detail}`;
      if (taskSeen.get(task.id) === key) continue;
      taskSeen.set(task.id, key);
      line({ office: task.office, who: AGENT_NAME[task.agent] || task.agent, text: t('console.task', { text: task.text, status: t(`taskStatus.${task.status}`), detail: task.detail ? ` · ${task.detail}` : '' }), tone: task.status === 'failed' ? 'err' : task.status === 'done' ? 'ok' : undefined });
    }
  }
  function onPipelines() {
    for (const run of server.pipelines.snapshot().runs) {
      const key = `${run.status}|${run.stages.map((s) => s.status).join(',')}`;
      if (runSeen.get(run.id) === key) continue;
      runSeen.set(run.id, key);
      const now = run.stages.find((s) => s.status === 'running');
      line({ office: run.office, who: AGENT_NAME[run.agent] || run.agent, text: t('console.run', { name: run.pipeline.name, status: t(`runStatus.${run.status}`), stage: now ? ` · ${now.name}` : '' }), tone: run.status === 'failed' ? 'err' : run.status === 'done' ? 'ok' : undefined });
    }
  }

  // ---- the rest: the server, the weather, the settings, the offices ----
  const weatherSeen = new Map();
  const onLog = (entry) => line({ ...entry, tone: 'dim' });
  const onWeather = (office, w) => {
    if (!w || weatherSeen.get(office) === w.kind) return;
    weatherSeen.set(office, w.kind);
    line({ office, text: t('console.weather', { icon: weatherIcon(w), office: officeName(office), label: t(`weather.${w.kind}`), temp: Number.isFinite(w.temp) ? `, ${Math.round(w.temp)}°` : '' }), tone: 'dim' });
  };
  let lang = server.store.getPrefs().lang;
  const onPrefs = (p) => { if (p.lang !== lang) { lang = p.lang; line({ text: t('console.lang', { lang: LANGUAGES[lang] }), tone: 'dim' }); } };
  let known = new Map(offices().map((o) => [o.id, o]));
  const onOffices = (list) => {
    for (const o of list) if (!known.has(o.id)) line({ ts: Date.now(), text: t('console.officeAdded', { name: o.name, tz: o.timezone }) });
    for (const [id, o] of known) if (!list.some((x) => x.id === id)) line({ text: t('console.officeRemoved', { name: o.name }), tone: 'dim' });
    known = new Map(list.map((o) => [o.id, o]));
  };

  server.bus.on('activity', onActivity);
  server.hub.on('change', onTasks);
  server.pipelines.on('change', onPipelines);
  server.bus.on('log', onLog);
  server.bus.on('weather', onWeather);
  server.bus.on('prefs', onPrefs);
  server.bus.on('offices', onOffices);
  return {
    line,
    close() {
      server.bus.off('activity', onActivity);
      server.hub.off('change', onTasks);
      server.pipelines.off('change', onPipelines);
      server.bus.off('log', onLog);
      server.bus.off('weather', onWeather);
      server.bus.off('prefs', onPrefs);
      server.bus.off('offices', onOffices);
    },
  };
}

/**
 * The interactive console. Resolves when the user closes the office (q or ctrl+c).
 * @param onGame       () => Promise: opens the game in the terminal; the log waits and then goes on
 * @param notes        lines the server said on startup
 * @param startInGame  goes straight into the game (`dev-team-office game`)
 */
export function runConsole({ server, stdin = process.stdin, stdout = process.stdout, colorMode = '256', onGame, notes = [], version = '', startInGame = false }) {
  return new Promise((resolve) => {
    const tty = !!(stdin.isTTY && stdout.isTTY);
    let paused = null; // while the game takes the screen, the lines are kept
    const write = (s) => { if (paused) { paused.push(s); if (paused.length > 500) paused.shift(); } else stdout.write(s); };
    const log = createLog({ server, write, color: tty, colorMode });
    const B = tty ? BOLD : '', D = tty ? DIM : '', R = tty ? RESET : '', Y = tty ? '\x1b[33m' : '';

    function banner() {
      const herdr = server.herdr?.available ? t('console.herdrOn', { pane: server.herdr.pane || '?' }) : t('console.herdrOff');
      stdout.write([
        '',
        `${Y}${B}▣ DEV TEAM OFFICE${R} ${D}${version}${R}`,
        `  ${B}${t('console.web').padEnd(8)}${R}${server.url}   ${D}${t('console.webHint')}${R}`,
        `  ${B}${t('console.game').padEnd(8)}${R}${t('console.gameHint')}`,
        `  ${B}${'herdr'.padEnd(8)}${R}${herdr}`,
        `  ${B}${t('console.keys').padEnd(8)}${R}${t('console.keysLine')}`,
        `${D}${t('console.logStart')}${R}`,
        '',
      ].join('\n'));
    }

    function onKey(data) {
      for (const k of String(data)) {
        if (k === '\x03' || k === 'q' || k === 'Q') return quit();
        if (k === 'g' || k === 'G' || k === '\r') return game();
        if (k === 'o' || k === 'O') { log.line({ text: t('console.opening', { url: server.url }), tone: 'dim' }); openBrowser(server.url); }
        if (k === 'h' || k === 'H' || k === '?') banner();
      }
    }
    function listen() {
      if (!tty) return;
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      stdin.on('data', onKey);
      stdin.resume();
    }
    function unlisten() {
      if (!tty) return;
      stdin.off('data', onKey);
      stdin.setRawMode(false);
    }

    async function game() {
      if (!onGame || paused) return;
      unlisten();
      paused = [];
      try { await onGame(); } finally {
        const lines = paused;
        paused = null;
        stdout.write(`${D}${t('console.back', { n: lines.length })}${R}\n`);
        for (const s of lines.slice(-200)) stdout.write(s);
        listen();
      }
    }

    let done = false;
    function quit() {
      if (done) return;
      done = true;
      unlisten();
      stdin.pause();
      log.line({ text: t('console.bye'), tone: 'dim' });
      log.close();
      resolve();
    }

    if (tty) banner();
    for (const n of notes) log.line({ text: n, tone: 'dim' });
    listen();
    if (startInGame && tty) setImmediate(game);
    for (const sig of ['SIGTERM', 'SIGHUP']) process.once(sig, quit);
    if (!tty) process.once('SIGINT', quit);
  });
}
