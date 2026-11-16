// The e2e screen (server/e2e.js): the end-to-end tests an agent is running, watched from the office.
//
//   mini      a small monitor over the game (bottom right) while a run goes and a while after: its
//             latest frame, the test and the step going now, how many passed and failed. A click (or
//             `e`) expands it.
//   expanded  the run: its tests on one side; on the other, the chosen test's movie (the frames of the
//             browser under test, from its trace) with each action marked on the timeline and listed
//             below (click one to jump to it), where it clicked, its error, its video and screenshots.
//             While a test runs its steps arrive live; its movie, when it ends. It follows the run on
//             its own until you pick a test.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const U = (k, v) => t(`e2e.ui.${k}`, v);
const SHOW_MS = 15 * 60_000;
const ICON = { passed: '✓', failed: '✗', timedOut: '⏱', skipped: '↷', interrupted: '■', running: '◌' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return e;
}
const secs = (ms) => `${(Math.max(0, ms) / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/**
 * @param send  the WebSocket (unused for now: everything comes over HTTP and the 'e2e' messages)
 */
export function createE2E() {
  const dialog = $('e2e');
  const mini = $('e2e-mini');
  const st = { runs: [], dismissed: new Set(), run: null, detail: null, test: null, follow: true, pos: 0, playing: false, speed: 1, raf: 0, last: 0, view: 'movie', loading: false };

  // ------------------------------------------------ the mini screen

  /** The mini screen's picture: the last frame, or the video (the same element while it is the same one: it keeps playing). */
  function miniPicture(r) {
    const src = r.last?.frame || r.last?.video;
    if (!src) return el('span', { class: 'e2e-mini-empty' }, r.status === 'running' ? U('waitingFrames') : U('noFrames'));
    const had = mini.querySelector('.e2e-mini-screen > img, .e2e-mini-screen > video');
    if (had?.getAttribute('src') === src) return had;
    if (r.last.frame) return el('img', { src, alt: r.last.title });
    return el('video', { src, muted: true, autoplay: true, loop: true, playsinline: true, 'aria-label': r.last.title });
  }

  function renderMini() {
    const r = st.runs.find((x) => !st.dismissed.has(x.id) && (x.status === 'running' || Date.now() - (x.endedAt || x.startedAt) < SHOW_MS));
    mini.hidden = !r;
    if (!r) return;
    const c = r.counts;
    mini.dataset.status = r.status;
    mini.replaceChildren(
      el('div', { class: 'e2e-mini-head' },
        el('b', {}, `🎭 ${U('title')}`), el('span', { class: 'e2e-proj' }, r.project),
        el('span', { class: `e2e-pill ${r.status}` }, U(`status.${r.status}`)),
        el('button', { type: 'button', class: 'e2e-x', 'aria-label': U('dismiss'), onclick: (e) => { e.stopPropagation(); st.dismissed.add(r.id); renderMini(); } }, '✕')),
      el('div', { class: 'e2e-mini-screen' }, miniPicture(r),
        r.status === 'running' ? el('span', { class: 'e2e-live' }, `● ${U('live')}`) : null),
      el('div', { class: 'e2e-mini-now' }, r.current ? [el('b', {}, r.current.title), r.current.step ? ` › ${r.current.step}` : ''] : U(r.status === 'passed' ? 'allPassed' : 'ended', { n: c.failed })),
      el('div', { class: 'e2e-mini-counts' },
        el('span', { class: 'ok' }, `✓ ${c.passed}`), el('span', { class: 'bad' }, `✗ ${c.failed}`),
        c.running ? el('span', {}, `◌ ${c.running}`) : null, el('span', { class: 'dim' }, `/ ${r.total}`)));
    mini.title = U('expand');
  }
  mini.onclick = () => open();
  mini.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };

  // ------------------------------------------------ the expanded screen

  async function open(id) {
    const r = st.runs.find((x) => x.id === id) || st.runs.find((x) => !st.dismissed.has(x.id)) || st.runs[0];
    if (!r) return;
    if (st.run !== r.id) Object.assign(st, { run: r.id, test: null, follow: true, pos: 0, detail: null });
    if (!dialog.open) dialog.showModal();
    await load();
  }
  $('e2e-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => stop());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  async function load() {
    if (!st.run || st.loading) return;
    st.loading = true;
    try {
      const out = await fetch(`/v1/e2e/${encodeURIComponent(st.run)}`).then((r) => r.json()).catch(() => null);
      if (!out?.ok) return;
      const before = current();
      st.detail = out.run;
      // following the run: the newest test with its movie (or the one going, while none has one)
      if (st.follow) {
        const withMovie = [...st.detail.tests].reverse().find((x) => x.frames.length || x.video);
        const going = st.detail.tests.find((x) => x.status === 'running');
        const pick = withMovie || going || st.detail.tests.at(-1);
        if (pick && pick.idx !== st.test) { st.test = pick.idx; st.pos = pick.start || 0; if (pick.frames.length) play(); }
      }
      const now = current();
      if (now && before && now.idx === before.idx && !before.frames.length && now.frames.length) { st.pos = now.start; play(); }
      render();
    } finally { st.loading = false; }
  }

  const current = () => st.detail?.tests.find((x) => x.idx === st.test) || null;

  function render() {
    const d = st.detail;
    if (!d) return;
    $('e2e-runs').replaceChildren(...st.runs.map((r) => el('option', { value: r.id, selected: r.id === st.run }, `${r.project} · ${new Date(r.startedAt).toLocaleTimeString()} · ${U(`status.${r.status}`)}`)));
    $('e2e-runs').onchange = (e) => open(e.target.value);
    const c = d.counts;
    $('e2e-sum').replaceChildren(el('span', { class: `e2e-pill ${d.status}` }, U(`status.${d.status}`)), ` ✓ ${c.passed} · ✗ ${c.failed}${c.running ? ` · ◌ ${c.running}` : ''} / ${d.total}`);
    $('e2e-tests').replaceChildren(...d.tests.map((x) => el('li', {},
      el('button', { type: 'button', class: `e2e-test ${x.status}${x.idx === st.test ? ' sel' : ''}`, onclick: () => { st.follow = false; st.test = x.idx; st.pos = x.start || 0; stop(); render(); if (x.frames.length) play(); } },
        el('span', { class: 'e2e-ico' }, ICON[x.status] || '·'),
        el('span', { class: 'e2e-name' }, x.title, el('small', {}, `${x.file}${x.line ? `:${x.line}` : ''}${x.retry ? ` · ${U('retry', { n: x.retry })}` : ''}`)),
        el('span', { class: 'e2e-dur' }, x.status === 'running' ? '…' : secs(x.duration))))));
    $('e2e-follow').hidden = st.follow;
    renderTest();
  }

  function renderTest() {
    const x = current();
    const box = $('e2e-view');
    if (!x) { box.replaceChildren(el('p', { class: 'fl-empty' }, U('none'))); return; }
    const movie = x.frames.length > 0;
    const tabs = el('div', { class: 'e2e-tabs' },
      movie ? el('button', { type: 'button', 'aria-pressed': String(st.view === 'movie'), onclick: () => { st.view = 'movie'; renderTest(); } }, `🎞 ${U('movie')}`) : null,
      x.video ? el('button', { type: 'button', 'aria-pressed': String(st.view === 'video' || !movie), onclick: () => { st.view = 'video'; stop(); renderTest(); } }, `🎬 ${U('video')}`) : null);
    const view = x.video && (st.view === 'video' || !movie) ? 'video' : 'movie';
    let screen;
    if (view === 'video') screen = el('div', { class: 'e2e-screen' }, el('video', { src: x.video, controls: true, autoplay: true, muted: true, playsInline: true }));
    // the screen takes the page's shape, so a click's dot (in the page's pixels) lands where it was
    else if (movie) screen = el('div', { class: 'e2e-screen', id: 'e2e-screen', style: `--ar:${(x.frames[0].w || 16) / (x.frames[0].h || 9)}` }, el('img', { id: 'e2e-frame', alt: x.title }), el('span', { class: 'e2e-dot', id: 'e2e-dot', hidden: true }), el('span', { class: 'e2e-caption', id: 'e2e-caption' }));
    else screen = el('div', { class: 'e2e-screen empty' }, el('p', {}, x.status === 'running' ? U('runningNoMovie') : U('noMovie')), x.status === 'running' ? el('span', { class: 'e2e-live' }, `● ${U('live')}`) : null);
    const controls = view === 'movie' && movie ? el('div', { class: 'e2e-controls' },
      el('button', { type: 'button', 'aria-label': U('restart'), onclick: () => { st.pos = x.start; drawAt(); } }, '⏮'),
      el('button', { type: 'button', id: 'e2e-play', 'aria-label': U('play'), onclick: () => (st.playing ? stop() : play()) }, st.playing ? '⏸' : '▶'),
      el('div', { class: 'e2e-track' },
        el('input', { type: 'range', id: 'e2e-seek', min: x.start, max: Math.max(x.end, x.start + 1), step: 1, value: st.pos, 'aria-label': U('seek'), oninput: (e) => { stop(); st.pos = +e.target.value; drawAt(); } }),
        el('div', { class: 'e2e-marks' }, x.actions.map((a) => el('span', { class: `e2e-mark${a.error ? ' bad' : ''}`, title: `${a.title} ${a.subtitle}`, style: `left:${((a.start - x.start) / Math.max(1, x.end - x.start)) * 100}%` })))),
      el('span', { class: 'e2e-time', id: 'e2e-time' }),
      el('select', { 'aria-label': U('speed'), onchange: (e) => { st.speed = +e.target.value; } }, [0.5, 1, 2, 4].map((v) => el('option', { value: v, selected: v === st.speed }, `${v}×`)))) : null;
    // the steps: the trace's actions when there is a trace, otherwise what the reporter told live
    const rows = x.actions.length
      ? x.actions.map((a, i) => el('li', { class: `e2e-step${a.error ? ' bad' : ''}`, 'data-i': i, style: `--d:${a.depth}`, onclick: () => { if (!movie) return; stop(); st.view = 'movie'; st.pos = a.start; drawAt(); } },
        el('span', { class: 'e2e-at' }, secs(a.start - x.start)), el('b', {}, a.title), a.subtitle ? el('code', {}, a.subtitle) : null, el('span', { class: 'e2e-dur' }, `${Math.round(a.end - a.start)} ms`), a.error ? el('pre', {}, a.error) : null))
      : x.steps.map((s) => el('li', { class: `e2e-step${s.error ? ' bad' : ''}`, style: `--d:${s.depth}` }, el('b', {}, s.title), el('span', { class: 'e2e-dur' }, `${s.duration} ms`), s.error ? el('pre', {}, s.error) : null));
    const hint = !movie && !x.video && x.status !== 'running' && st.detail.trace === 'off' ? el('p', { class: 'hint' }, U('traceHint')) : null;
    // the test's error, unless one of its steps already shows it
    const stepError = x.actions.some((a) => a.error) || x.steps.some((s) => s.error);
    box.replaceChildren(...[
      // the screen and its controls stay in sight while the steps scroll under them
      el('div', { class: 'e2e-stage' },
        el('header', { class: 'e2e-test-head' }, el('b', {}, `${ICON[x.status] || ''} ${x.title}`), el('span', { class: 'fl-dim' }, `${x.file}${x.line ? `:${x.line}` : ''} · ${x.status === 'running' ? U('status.running') : secs(x.duration)}`), tabs),
        screen, controls),
      hint,
      x.error && !stepError ? el('pre', { class: 'e2e-error' }, x.error) : null,
      x.shots.length ? el('div', { class: 'e2e-shots' }, el('span', { class: 'fl-label' }, U('shots')), x.shots.map((u) => el('a', { href: u, target: '_blank', rel: 'noopener' }, el('img', { src: u, alt: U('shot') })))) : null,
      el('ol', { class: 'e2e-steps', id: 'e2e-steps' }, rows.length ? rows : el('li', { class: 'fl-empty' }, U('noSteps')))].filter(Boolean));
    if (view === 'movie' && movie) drawAt();
  }

  // ------------------------------------------------ the movie

  /** The frame and the action at the player's position: the image, the click's dot, the timeline. */
  function drawAt() {
    const x = current();
    const img = $('e2e-frame');
    if (!x || !img || !x.frames.length) return;
    st.pos = Math.max(x.start, Math.min(x.end, st.pos));
    let f = x.frames[0];
    for (const fr of x.frames) if (fr.t <= st.pos) f = fr; else break;
    if (img.dataset.url !== f.url) { img.src = f.url; img.dataset.url = f.url; }
    const action = [...x.actions].reverse().find((a) => a.start <= st.pos) || null;
    const dot = $('e2e-dot');
    if (dot) {
      const p = action?.point && st.pos - action.start < Math.max(700, action.end - action.start + 400) ? action.point : null;
      dot.hidden = !p;
      if (p && f.w && f.h) { dot.style.left = `${(p.x / f.w) * 100}%`; dot.style.top = `${(p.y / f.h) * 100}%`; }
    }
    const cap = $('e2e-caption');
    if (cap) cap.textContent = action ? `${action.title}${action.subtitle ? ` · ${action.subtitle}` : ''}` : '';
    const seek = $('e2e-seek');
    if (seek) seek.value = st.pos;
    const time = $('e2e-time');
    if (time) time.textContent = `${secs(st.pos - x.start)} / ${secs(x.end - x.start)}`;
    const i = action ? x.actions.indexOf(action) : -1;
    for (const li of $('e2e-steps')?.children || []) li.classList.toggle('now', Number(li.dataset.i) === i);
    const play = $('e2e-play');
    if (play) play.textContent = st.playing ? '⏸' : '▶';
  }

  function play() {
    const x = current();
    if (!x?.frames.length) return;
    if (st.pos >= x.end) st.pos = x.start;
    st.playing = true;
    st.last = performance.now();
    cancelAnimationFrame(st.raf);
    const tick = (now) => {
      if (!st.playing) return;
      const y = current();
      if (!y) return stop();
      st.pos += (now - st.last) * st.speed;
      st.last = now;
      if (st.pos >= y.end) { st.pos = y.end; st.playing = false; }
      drawAt();
      if (st.playing) st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    drawAt();
  }
  function stop() { st.playing = false; cancelAnimationFrame(st.raf); drawAt(); }

  $('e2e-follow').onclick = () => { st.follow = true; st.test = null; load(); };

  return {
    /** The runs changed (a snapshot or the 'e2e' message): the mini screen, and the open run. */
    update(runs = []) {
      st.runs = runs;
      renderMini();
      if (dialog.open && st.run) load();
    },
    open,
    /** Is there a run to look at? (for the `e` key) */
    get any() { return st.runs.length > 0; },
  };
}
