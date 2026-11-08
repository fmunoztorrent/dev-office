// The whiteboard, expanded: when it has tickets, clicking it grows it over the office and shows the
// agent's tasks as post-its in three columns (to do, doing, done), live. From there a new brief is
// one click away. Without tickets, the click goes straight to the brief, as before.

import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const COLS = ['pending', 'in_progress', 'completed'];
const TILT = [-2.2, 1.4, -0.8, 2, -1.6, 0.6, 1.8, -2.6]; // each post-it a little crooked, always the same

/**
 * @param getBoard   () => { title, todos: [{ content, status, activeForm? }] } (the simulation's board)
 * @param boardRect  () => the whiteboard's rectangle on the page (DOMRect-like) or null: it grows from there
 * @param onBrief    () => opens the new brief dialog
 */
export function createBoardView({ getBoard = () => ({ todos: [] }), boardRect = () => null, onBrief = () => {} }) {
  const dialog = $('board-view');
  const card = dialog.querySelector('.bv-board');
  let timer = null;
  let shown = '';

  $('bv-close').onclick = () => dialog.close();
  $('bv-brief').onclick = () => { dialog.close(); onBrief(); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { clearInterval(timer); timer = null; });

  const hasTickets = () => (getBoard()?.todos || []).length > 0;

  function open() {
    if (!dialog.open) dialog.showModal();
    shown = '';
    render();
    grow();
    clearInterval(timer);
    timer = setInterval(render, 1000); // the tasks keep moving while it is open
  }

  // The expanded whiteboard comes out of the small one: from its place and size, to the center.
  function grow() {
    const from = boardRect();
    const to = card.getBoundingClientRect();
    card.classList.remove('bv-grow');
    if (from && to.width) {
      card.style.setProperty('--bv-dx', `${from.left + from.width / 2 - (to.left + to.width / 2)}px`);
      card.style.setProperty('--bv-dy', `${from.top + from.height / 2 - (to.top + to.height / 2)}px`);
      card.style.setProperty('--bv-s', String(Math.max(0.15, Math.min(1, from.width / to.width))));
    }
    void card.offsetWidth; // restarts the animation
    card.classList.add('bv-grow');
  }

  function render() {
    const board = getBoard() || { todos: [] };
    const todos = board.todos || [];
    const key = JSON.stringify([board.title, todos]);
    if (key === shown) return;
    shown = key;
    $('bv-title').textContent = board.title ? t('scene.taskTitle', { title: board.title }) : t('board.untitled');
    const done = todos.filter((x) => x.status === 'completed').length;
    $('bv-progress').textContent = todos.length ? t('board.progress', { done, total: todos.length }) : '';
    $('bv-empty').hidden = todos.length > 0;
    for (const col of COLS) {
      const items = todos.map((x, i) => ({ ...x, i })).filter((x) => (COLS.includes(x.status) ? x.status : 'pending') === col);
      const ul = dialog.querySelector(`.bv-col[data-col="${col}"] ul`);
      ul.replaceChildren(...items.map((x) => {
        const li = document.createElement('li');
        li.className = `bv-postit bv-${col}`;
        li.style.setProperty('--tilt', `${TILT[x.i % TILT.length]}deg`);
        const text = col === 'in_progress' && x.activeForm ? x.activeForm : x.content;
        li.textContent = text;
        li.title = text;
        return li;
      }));
      dialog.querySelector(`.bv-col[data-col="${col}"] .bv-count`).textContent = items.length ? String(items.length) : '';
    }
  }

  return { open, hasTickets, refresh() { if (dialog.open) render(); }, get isOpen() { return dialog.open; } };
}
