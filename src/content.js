'use strict';

const api = window.yah;
const content = document.getElementById('content');
const closeButton = document.getElementById('content-close');

let currentKey = null;
let currentKind = 'text';

let windowDrag = null;
let dragPoint = null;
let dragFrame = 0;

const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"]';

async function syncMaximized() {
  const maximized = await api.isMaximized();
  document.body.classList.toggle('maximized', maximized);
}

function onWindowDragStart(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DRAG_EXCLUDE)) return;
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

function isTextHeading(block) {
  const line = block.split('\n', 1)[0].trim();
  return (
    /^[一二三四五六七八九十百千零〇]+、/.test(line) ||
    /^（[一二三四五六七八九十百千零〇]+）/.test(line)
  );
}

function renderTextBlocks(container, text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const blocks = normalized ? normalized.split(/\n{2,}/) : [];
  container.replaceChildren();
  if (blocks.length === 0) {
    container.append(
      Object.assign(document.createElement('div'), {
        className: 'content-empty',
        textContent: '还没有内容',
      })
    );
    return;
  }
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const [firstLine, ...rest] = block.split('\n');
    if (isTextHeading(block)) {
      const heading = document.createElement('div');
      heading.className = 'text-block text-heading';
      heading.textContent = firstLine.trim();
      container.append(heading);
      const remainder = rest.join('\n').trim();
      if (remainder) {
        const body = document.createElement('div');
        body.className = 'text-block';
        body.textContent = remainder;
        container.append(body);
      }
    } else {
      const node = document.createElement('div');
      node.className = 'text-block';
      node.textContent = block;
      container.append(node);
    }
  }
}

function render(payload) {
  currentKey = payload?.key || null;
  currentKind = payload?.kind || 'text';
  const title = String(payload?.title || 'CONTENT');
  document.title = `YAH - ${title}`;

  const inner = document.createElement('div');
  inner.className = 'content-inner';
  if (currentKind === 'tool' || payload?.json != null) {
    const pre = document.createElement('pre');
    pre.className = 'tool-json';
    pre.textContent =
      payload?.json != null
        ? JSON.stringify(payload.json, null, 2)
        : String(payload?.text ?? '');
    inner.append(pre);
  } else {
    renderTextBlocks(inner, payload?.text);
  }
  content.replaceChildren(inner);
  content.scrollTop = 0;
}

function updateText(text) {
  if (currentKind === 'tool') return;
  const inner = content.querySelector('.content-inner');
  if (!inner) return;
  const previousTop = content.scrollTop;
  const atBottom =
    content.scrollHeight - content.scrollTop - content.clientHeight < 40;
  renderTextBlocks(inner, text);
  if (atBottom) {
    content.scrollTop = content.scrollHeight;
  } else {
    content.scrollTop = previousTop;
  }
}

api.onContentInit((payload) => {
  render(payload);
});

api.onContentUpdate((payload) => {
  if (!payload || payload.key !== currentKey) return;
  if (typeof payload.text !== 'string') return;
  updateText(payload.text);
});

closeButton?.addEventListener('click', () => api.close());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') event.preventDefault();
  if (event.key === 'Escape') api.close();
});
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api.close();
});

// 禁止原生 hover tooltip
document.addEventListener(
  'mouseover',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const titled = target.closest('[title]');
    if (titled) titled.removeAttribute('title');
  },
  true
);

// 禁用 Chromium 默认的中键拖拽/自动滚动
document.addEventListener(
  'mousedown',
  (event) => {
    if (event.button === 1) event.preventDefault();
  },
  true
);

// 和主窗口一致：按住左键在任意非交互区域拖动窗口
document.addEventListener('mousedown', onWindowDragStart);
document.addEventListener('mousemove', onWindowDragMove);
document.addEventListener('mouseup', onWindowDragEnd);
window.addEventListener('blur', onWindowDragEnd);
window.addEventListener('resize', syncMaximized);
syncMaximized();

// 右键直接关闭全文窗口
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api.close();
});
