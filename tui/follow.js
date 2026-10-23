// A subagent's pane: `dev-team-office follow --session <s> --sub <id>`. Inside herdr the office opens
// it by itself when an agent launches a subagent (server/subpanes.js) and closes it when it finishes.
// It hooks into the office and shows only that subagent's activity: who it is and its task, each
// tool (with its commands' output), its phases and, at the end, its report.

import { DEFAULT_TEAM, phaseInfo } from '../public/sim.js';
import { t, timeOf } from '../public/i18n.js';
import { fit } from './screen.js';
import { ROLE_ICON } from '../server/subpanes.js';

const ESC = '\x1b[';
const RESET = `${ESC}0m`, BOLD = `${ESC}1m`, DIM = `${ESC}2m`;
const TONE = { err: '#ef476f', ok: '#06d6a0', warn: '#ffd166', info: '#8ecae6' };
const rgb = (hex) => { const n = parseInt(String(hex || '#ffffff').replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** What is shown of a subagent: its events are passed through `push`, which returns lines. */
export function createFollow({ session, sub, color = true, colorMode = '256', width = () => 100, zone } = {}) {
  const paint = (hex) => {
    if (!color) return '';
    const [r, g, b] = rgb(hex);
    if (colorMode === 'truecolor') return `${ESC}38;2;${r};${g};${b}m`;
    const q = (v) => Math.round((v / 255) * 5);
    return `${ESC}38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
  };
  const c = (code) => (color ? code : '');
  const st = { started: null, ended: null, role: null, attributed: false, thought: false, appearance: {}, zone };
  const cols = () => Math.max(20, (width() || 100) - 2);
  const when = (ts) => `${c(DIM)}${timeOf(ts || Date.now(), st.zone, { seconds: true })}${c(RESET)}`;
  const block = (text, tone = DIM) => String(text).split('\n').map((l) => `  ${c(tone)}│ ${fit(l, cols() - 4)}${c(RESET)}`);

  /** Does it belong to this subagent? By its id; if the harness does not say, by its character while it runs. */
  function mine(ev) {
    if (!ev || ev.session !== session) return false;
    if (ev.subId) return ev.subId === sub;
    return !!st.started && !st.ended && !st.attributed && ev.role === st.role && ['tool_start', 'tool_end', 'phase', 'waiting', 'error'].includes(ev.kind);
  }

  function header(ev) {
    const look = { ...DEFAULT_TEAM[ev.role], ...(st.appearance?.[ev.role] || {}) };
    const who = [look.name, look.title].filter(Boolean).join(' · ');
    const out = [`${paint(look.shirt)}${c(BOLD)}${ROLE_ICON[ev.role] || '🤖'} ${who || ev.role}${c(RESET)}${ev.agentType ? `  ${c(DIM)}${ev.agentType}${c(RESET)}` : ''}`];
    if (ev.text) out.push(`${c(BOLD)}${fit(ev.text, cols())}${c(RESET)}`);
    if (ev.phase) { const ph = phaseInfo(ev.phase); out.push(`${ph.icon} ${ph.label}`); }
    if (ev.task) out.push(...block(ev.task));
    out.push(`${c(DIM)}${'─'.repeat(Math.min(cols(), 60))}${c(RESET)}`);
    return out;
  }

  const took = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

  /** An office event → the lines it adds (none if it is not this subagent's). */
  function push(ev) {
    if (!mine(ev)) return [];
    if (ev.kind === 'subagent_start') {
      if (st.started) return [];
      st.started = ev.ts || Date.now();
      st.role = ev.role;
      return header(ev);
    }
    if (!st.started) { st.started = ev.ts || Date.now(); st.role = ev.role; }
    if (ev.subId && ev.kind !== 'subagent_end') st.attributed = true;
    const line = (icon, text, tone) => `${when(ev.ts)}  ${icon} ${tone ? paint(TONE[tone]) : ''}${fit(text, cols() - 14)}${tone ? c(RESET) : ''}`;
    const out = [];
    switch (ev.kind) {
      case 'thinking': if (!st.thought) out.push(line('💭', t('follow.thinking'), null)); st.thought = true; break;
      case 'tool_start': out.push(line('▸', ev.text || ev.tool)); break;
      case 'tool_end':
        if (!ev.ok) out.push(line('✖', ev.phase === 'red' ? `${ev.text} · ${t('follow.red')}` : ev.text, ev.phase === 'red' ? 'warn' : 'err'));
        if (ev.output) out.push(...block(ev.output));
        break;
      case 'phase': { const ph = phaseInfo(ev.phase); out.push(line(ph.icon, `${ph.label}${ev.text ? `: ${ev.text}` : ''}`, 'info')); break; }
      case 'waiting': out.push(line('✋', ev.text, 'warn')); break;
      case 'error': out.push(line('✖', ev.text, 'err')); break;
      case 'subagent_end':
        if (st.ended) return [];
        st.ended = ev.ts || Date.now();
        out.push(line('✔', t('follow.done', { time: took(st.ended - st.started) }), 'ok'));
        if (ev.output) out.push(...block(ev.output, ''));
        break;
      default: return [];
    }
    return out;
  }

  return {
    push,
    state: st,
    /** The office's initial state: its appearance, its zone and what the subagent already did. */
    snapshot(state) {
      st.appearance = state?.appearance || {};
      st.zone ||= state?.office?.timezone;
      const out = [];
      for (const ev of state?.log || []) out.push(...push(ev));
      return out;
    },
  };
}

/**
 * The viewer, in the terminal: connects over WebSocket to the office watching that session and writes
 * the lines as they arrive. It does not end by itself: the office (closing the pane) or the user closes it.
 */
export function runFollow({ url, office, session, sub, write = (s) => process.stdout.write(s), color = !!process.stdout.isTTY, colorMode, width = () => process.stdout.columns }) {
  const view = createFollow({ session, sub, color, colorMode, width });
  const emit = (lines) => { if (lines.length) write(`${lines.join('\n')}\n`); };
  const wsUrl = `${url.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/ws${office ? `?office=${encodeURIComponent(office)}` : ''}`;
  let ws = null, shown = false, offline = false, closed = false, retry = null;
  if (color) write(`${ESC}2J${ESC}H`); // the pane opens with the command typed in: clear it
  write(`${DIM}${t('follow.waiting')}${RESET}\n`);
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => { offline = false; });
    ws.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'snapshot' && !shown) { shown = true; emit(view.snapshot(msg.state)); }
      if (msg.type === 'appearance') view.state.appearance = msg.appearance || {};
      if (msg.type === 'event') {
        const ended = view.state.ended;
        emit(view.push(msg.event));
        if (!ended && view.state.ended) write(`${DIM}${t('follow.closes')}${RESET}\n`);
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      if (closed) return;
      if (!offline) write(`${DIM}${t('follow.offline')}${RESET}\n`);
      offline = true;
      retry = setTimeout(connect, 2000);
    });
    ws.addEventListener('error', () => {});
  };
  connect();
  return { view, close() { closed = true; clearTimeout(retry); ws?.close(); } };
}
