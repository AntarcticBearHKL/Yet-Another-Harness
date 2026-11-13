'use strict';

const api = window.yah;
const content = document.getElementById('content');
const titleEl = document.getElementById('content-title');
const closeButton = document.getElementById('content-close');

let currentKey = null;
let currentKind = 'text';

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
        className: 'text-block',
        textContent: 'No content yet.',
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
  titleEl.textContent = title;

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

closeButton.addEventListener('click', () => api.close());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.close();
});
