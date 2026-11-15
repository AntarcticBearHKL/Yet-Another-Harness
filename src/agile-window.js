'use strict';

const api = window.yah;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function requestJson(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { ...(options.headers || {}) },
  };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      data?.error || `request failed (${response.status})`
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

let confirmAction = null;

function openConfirm({ text, action }) {
  const overlay = document.getElementById('confirm-overlay');
  const textNode = document.getElementById('confirm-text');
  if (!overlay || !textNode) return;
  textNode.textContent = String(text || '');
  confirmAction = action;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
  confirmAction = null;
  const overlay = document.getElementById('confirm-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

function runConfirm() {
  const action = confirmAction;
  closeConfirm();
  if (typeof action === 'function') action();
}

document.getElementById('confirm-cancel')?.addEventListener('click', closeConfirm);
document.getElementById('confirm-ok')?.addEventListener('click', runConfirm);
document.getElementById('confirm-overlay')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeConfirm();
});

function confirmOpen() {
  const overlay = document.getElementById('confirm-overlay');
  return Boolean(overlay && !overlay.classList.contains('hidden'));
}

let windowDrag = null;
let dragPoint = null;
let dragFrame = 0;

const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .agile-task, .agile-column, .agile-tasks, .agile-groups, .agile-note, .overlay';

function onWindowDragStart(event) {
  if (!api?.dragStart || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DRAG_EXCLUDE)) return;
  if (!target.closest('.agile-head, .agile-sidebar-head, .agile-sidebar')) return;
  windowDrag = { x: event.screenX, y: event.screenY };
  api.dragStart({ x: event.screenX, y: event.screenY });
}

function onWindowDragMove(event) {
  if (!windowDrag) return;
  dragPoint = { x: event.screenX, y: event.screenY };
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    if (!windowDrag || !dragPoint) return;
    api.dragMove(dragPoint);
  });
}

function onWindowDragEnd() {
  if (!windowDrag) return;
  windowDrag = null;
  dragPoint = null;
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  api.dragEnd();
}

document.addEventListener('mousedown', onWindowDragStart);
document.addEventListener('mousemove', onWindowDragMove);
document.addEventListener('mouseup', onWindowDragEnd);
window.addEventListener('blur', onWindowDragEnd);

async function syncMaximized() {
  if (!api?.isMaximized) return;
  try {
    const maximized = await api.isMaximized();
    document.body.classList.toggle('maximized', maximized);
  } catch {
    /* ignore */
  }
}

document.getElementById('agile-win-min')?.addEventListener('click', () => {
  api?.minimize?.();
});
document.getElementById('agile-win-max')?.addEventListener('click', () => {
  api?.maximize?.();
  setTimeout(syncMaximized, 120);
});
document.getElementById('agile-win-close')?.addEventListener('click', () => {
  api?.close?.();
});
document.querySelector('.agile-head')?.addEventListener('dblclick', (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(DRAG_EXCLUDE)) return;
  api?.maximize?.();
  setTimeout(syncMaximized, 120);
});
window.addEventListener('resize', syncMaximized);

document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    if (confirmOpen()) {
      event.preventDefault();
      closeConfirm();
      return;
    }
    window.handleAgileEscape?.();
    return;
  }
  if (event.key !== ' ') return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]')
  ) {
    return;
  }
  if (confirmOpen()) {
    event.preventDefault();
    runConfirm();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) window.refreshAgileIfChanged?.();
});

window.openAgile?.();
syncMaximized();
setInterval(() => window.refreshAgileIfChanged?.(), 3000);
