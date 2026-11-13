'use strict';

(() => {
  const shell = window.yah;
  if (!shell?.resizeStart) return;

  const DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
  const CURSORS = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  };

  let active = null;
  let pending = null;
  let frame = 0;

  const layer = document.createElement('div');
  layer.id = 'resize-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (const direction of DIRECTIONS) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${direction}`;
    handle.dataset.direction = direction;
    layer.append(handle);
  }
  document.body.append(layer);

  function queue(point) {
    pending = point;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!active || !pending) return;
      shell.resizeMove(pending);
    });
  }

  // 阻止 resize 手柄上的 mousedown 冒泡到窗口拖动逻辑。
  layer.addEventListener('mousedown', (event) => {
    if (event.target.closest('.resize-handle')) event.stopPropagation();
  });

  layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const handle = event.target.closest('.resize-handle');
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    active = handle.dataset.direction;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    document.body.style.cursor = CURSORS[active] || '';
    shell.resizeStart({
      direction: active,
      x: event.screenX,
      y: event.screenY,
    });
  });

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!active) return;
      if (event.buttons === 0) {
        endResize();
        return;
      }
      event.preventDefault();
      queue({ x: event.screenX, y: event.screenY });
    },
    true
  );

  function endResize() {
    if (!active) return;
    if (pending) shell.resizeMove(pending);
    active = null;
    pending = null;
    cancelAnimationFrame(frame);
    frame = 0;
    document.body.classList.remove('resizing');
    document.body.style.cursor = '';
    shell.resizeEnd();
  }

  document.addEventListener('pointerup', endResize, true);
  document.addEventListener('pointercancel', endResize, true);
  window.addEventListener('blur', endResize);
})();
