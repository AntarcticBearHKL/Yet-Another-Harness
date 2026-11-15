'use strict';

const api = window.yah;
const content = document.getElementById('content');
const closeButton = document.getElementById('content-close');

let currentKey = null;
let currentKind = 'text';
let currentPayload = null;

let windowDrag = null;
let dragPoint = null;
let dragFrame = 0;

let viewerToken = 0;
let codeView = null;
let pdfState = null;
let selectionAction = null;
let annotationPopover = null;
let contentScrollHandler = null;

const ANNOTATION_KEY = 'yah.viewer.annotations.v1';
let annotationStore = loadAnnotations();

const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .annotation-popover, .viewer-selection-action';

const LANG_BY_EXT = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadAnnotations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ANNOTATION_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistAnnotations() {
  try {
    localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotationStore));
  } catch {
    /* ignore */
  }
}

function fileAnnotations(file) {
  const list = annotationStore[file];
  return Array.isArray(list) ? list : [];
}

function setFileAnnotations(file, list) {
  if (list.length === 0) delete annotationStore[file];
  else annotationStore[file] = list;
  persistAnnotations();
}

function addAnnotation(annotation) {
  const list = fileAnnotations(annotation.file).slice();
  list.push(annotation);
  setFileAnnotations(annotation.file, list);
  return annotation;
}

function updateAnnotation(file, id, note) {
  const list = fileAnnotations(file).map((item) =>
    item.id === id ? { ...item, note, updatedAt: Date.now() } : item
  );
  setFileAnnotations(file, list);
}

function deleteAnnotation(file, id) {
  setFileAnnotations(
    file,
    fileAnnotations(file).filter((item) => item.id !== id)
  );
}

function annotationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function languageFor(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return LANG_BY_EXT[ext] || '';
}

function highlightCode(text, language) {
  if (
    window.Prism &&
    language &&
    Prism.languages &&
    Prism.languages[language]
  ) {
    try {
      return Prism.highlight(text, Prism.languages[language], language);
    } catch {
      /* fall through */
    }
  }
  return escapeHtml(text);
}

function splitHighlightedLines(html) {
  const lines = [];
  const stack = [];
  let current = '';
  const tokens = String(html).split(/(\n|<span[^>]*>|<\/span>)/g);
  for (const token of tokens) {
    if (token === '\n') {
      lines.push(
        current +
          stack
            .slice()
            .reverse()
            .map(() => '</span>')
            .join('')
      );
      current = stack.join('');
    } else if (/^<span[^>]*>$/.test(token)) {
      stack.push(token);
      current += token;
    } else if (token === '</span>') {
      stack.pop();
      current += token;
    } else {
      current += token;
    }
  }
  lines.push(current);
  return lines;
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ----------------------------- window chrome ----------------------------- */

async function syncMaximized() {
  const maximized = await api.isMaximized();
  document.body.classList.toggle('maximized', maximized);
}

function onWindowDragStart(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DRAG_EXCLUDE)) return;
  const viewer = target.closest('.code-viewer, .pdf-viewer');
  if (viewer && !target.closest('.viewer-head')) return;
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

/* ------------------------------ shared notes ------------------------------ */

function closeSelectionAction() {
  selectionAction?.remove();
  selectionAction = null;
}

function showSelectionAction(rect, onClick) {
  closeSelectionAction();
  const button = el('button', 'viewer-selection-action', '注释');
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  document.body.append(button);
  const width = button.offsetWidth || 48;
  const height = button.offsetHeight || 28;
  const left = clamp(rect.right + 10, 12, window.innerWidth - width - 12);
  const top = clamp(rect.top - 2, 12, window.innerHeight - height - 12);
  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  selectionAction = button;
}

function closeAnnotationPopover() {
  annotationPopover?.remove();
  annotationPopover = null;
}

function positionAnnotationPopover(popover, rect) {
  const width = popover.offsetWidth || 280;
  const height = popover.offsetHeight || 180;
  let left = rect.right + 14;
  if (left + width > window.innerWidth - 12) {
    left = rect.left - width - 14;
  }
  left = clamp(left, 12, window.innerWidth - width - 12);
  const top = clamp(rect.top - 4, 12, window.innerHeight - height - 12);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function openAnnotationPopover({
  rect,
  note = '',
  quote = '',
  onSave,
  onDelete,
}) {
  closeSelectionAction();
  closeAnnotationPopover();
  const popover = el('div', 'annotation-popover');
  const head = el('div', 'annotation-head');
  head.append(el('span', 'annotation-kicker', 'ANNOTATION'));
  if (quote) head.append(el('span', 'annotation-quote', quote));
  const input = el('textarea', 'annotation-input');
  input.value = note;
  input.placeholder = '写点注释…';
  const actions = el('div', 'annotation-actions');
  const save = el('button', 'annotation-save', '保存');
  save.type = 'button';
  save.disabled = !note.trim();
  const cancel = el('button', 'annotation-cancel', '取消');
  cancel.type = 'button';
  actions.append(cancel);
  if (onDelete) {
    const remove = el('button', 'annotation-delete', '删除');
    remove.type = 'button';
    actions.append(remove);
    remove.addEventListener('click', () => {
      onDelete();
      closeAnnotationPopover();
    });
  }
  actions.append(save);
  popover.append(head, input, actions);
  document.body.append(popover);
  annotationPopover = popover;
  positionAnnotationPopover(popover, rect);
  input.addEventListener('input', () => {
    save.disabled = !input.value.trim();
  });
  save.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    onSave?.(value);
    closeAnnotationPopover();
  });
  cancel.addEventListener('click', closeAnnotationPopover);
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/* -------------------------------- code view ------------------------------- */

function renderCodeViewer(payload) {
  const file = String(payload?.path || '');
  const text = String(payload?.text ?? '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const language = languageFor(file);
  const highlighted = highlightCode(text, language);
  const htmlLines = splitHighlightedLines(highlighted);
  const viewer = el('div', 'viewer code-viewer');
  const metaParts = [`${lines.length} 行`];
  if (language) metaParts.push(language);
  const head = makeViewerHead(file, metaParts.join(' · '));
  const body = el('div', 'code-body');
  const lineWrap = el('div', 'code-lines');
  const lineEls = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    const lineEl = el('div', 'code-line');
    lineEl.dataset.line = String(number);
    const num = el('span', 'code-num', String(number));
    const code = el('span', 'code-text');
    code.innerHTML = htmlLines[index] || ' ';
    lineEl.append(num, code);
    lineEl.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.code-note-pin')) {
        return;
      }
      selectCodeLines(number, event.shiftKey);
    });
    lineEls.push(lineEl);
    lineWrap.append(lineEl);
  });
  body.append(lineWrap);
  viewer.append(head, body);
  content.append(viewer);
  codeView = { file, lineEls, anchor: null, start: null, end: null };

  const focusStart = Number.isFinite(Number(payload?.line))
    ? clamp(Math.round(Number(payload.line)), 1, lines.length)
    : null;
  const focusEnd =
    focusStart === null
      ? null
      : clamp(
          Number.isFinite(Number(payload?.end_line))
            ? Math.round(Number(payload.end_line))
            : focusStart,
          focusStart,
          lines.length
        );
  if (focusStart !== null) {
    for (let i = focusStart; i <= focusEnd; i += 1) {
      lineEls[i - 1]?.classList.add('focus');
    }
    const meta = head.querySelector('.viewer-meta');
    if (meta) {
      meta.textContent = `${meta.textContent} · L${focusStart}${
        focusEnd > focusStart ? `–${focusEnd}` : ''
      }`;
    }
    requestAnimationFrame(() => {
      lineEls[focusStart - 1]?.scrollIntoView({ block: 'center' });
    });
  }
  refreshCodePins();
  contentScrollHandler = closeSelectionAction;
  content.addEventListener('scroll', contentScrollHandler, { passive: true });
}

function selectCodeLines(line, extend) {
  if (!codeView) return;
  if (extend && codeView.anchor !== null) {
    codeView.start = Math.min(codeView.anchor, line);
    codeView.end = Math.max(codeView.anchor, line);
  } else {
    codeView.anchor = line;
    codeView.start = line;
    codeView.end = line;
  }
  codeView.lineEls.forEach((item, index) => {
    const number = index + 1;
    item.classList.toggle(
      'selected',
      number >= codeView.start && number <= codeView.end
    );
  });
  const first = codeView.lineEls[codeView.start - 1];
  if (!first) return;
  const rect = first.getBoundingClientRect();
  showSelectionAction(rect, () => {
    const start = codeView.start;
    const end = codeView.end;
    openAnnotationPopover({
      rect,
      quote: `L${start}${end > start ? `–${end}` : ''}`,
      onSave: (note) => {
        addAnnotation({
          id: annotationId(),
          kind: 'code',
          file: codeView.file,
          startLine: start,
          endLine: end,
          note,
          createdAt: Date.now(),
        });
        refreshCodePins();
        closeSelectionAction();
      },
    });
  });
}

function refreshCodePins() {
  if (!codeView) return;
  codeView.lineEls.forEach((line) => {
    line.querySelectorAll('.code-note-pin').forEach((pin) => pin.remove());
  });
  const annotations = fileAnnotations(codeView.file).filter(
    (item) => item.kind === 'code'
  );
  for (const annotation of annotations) {
    const line = codeView.lineEls[annotation.startLine - 1];
    if (!line) continue;
    const pin = el('button', 'code-note-pin');
    pin.type = 'button';
    pin.title = annotation.note;
    pin.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = pin.getBoundingClientRect();
      openAnnotationPopover({
        rect,
        note: annotation.note,
        quote: `L${annotation.startLine}${
          annotation.endLine > annotation.startLine
            ? `–${annotation.endLine}`
            : ''
        }`,
        onSave: (note) => {
          updateAnnotation(codeView.file, annotation.id, note);
          refreshCodePins();
        },
        onDelete: () => {
          deleteAnnotation(codeView.file, annotation.id);
          refreshCodePins();
        },
      });
    });
    line.append(pin);
  }
}

/* --------------------------------- pdf view -------------------------------- */

function makeViewerHead(pathText, metaText) {
  const head = el('header', 'viewer-head');
  const pathEl = el('div', 'viewer-path', pathText || 'FILE');
  pathEl.title = pathText || '';
  const meta = el('div', 'viewer-meta', metaText || '');
  head.append(pathEl, meta);
  return head;
}

function updatePdfMeta() {
  if (!pdfState) return;
  const meta = pdfState.head.querySelector('.viewer-meta');
  if (!meta) return;
  meta.replaceChildren();
  const pageInfo = el(
    'span',
    'pdf-page-info',
    `${pdfState.focusPage} / ${pdfState.doc.numPages}`
  );
  const zoomOut = el('button', 'pdf-zoom', '−');
  zoomOut.type = 'button';
  zoomOut.setAttribute('aria-label', '缩小 PDF');
  const zoomLabel = el('span', 'pdf-zoom-label', `${Math.round(pdfState.zoom * 100)}%`);
  const zoomIn = el('button', 'pdf-zoom', '+');
  zoomIn.type = 'button';
  zoomIn.setAttribute('aria-label', '放大 PDF');
  zoomOut.addEventListener('click', () => applyPdfZoom(-0.15));
  zoomIn.addEventListener('click', () => applyPdfZoom(0.15));
  meta.append(pageInfo, zoomOut, zoomLabel, zoomIn);
}

async function renderPdfViewer(payload) {
  const token = ++viewerToken;
  const file = String(payload?.path || '');
  const viewer = el('div', 'viewer pdf-viewer');
  const head = makeViewerHead(file, '加载中…');
  const pages = el('div', 'pdf-pages');
  viewer.append(head, pages);
  content.append(viewer);
  const query = String(payload?.query || '').trim();
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    if (token !== viewerToken) return;
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({
      data: base64ToBytes(payload?.data),
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      wasmUrl: '/vendor/pdfjs/wasm/',
      iccUrl: '/vendor/pdfjs/iccs/',
    }).promise;
    if (token !== viewerToken) {
      await doc.destroy();
      return;
    }
    const pagesMeta = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const pageEl = el('div', 'pdf-page');
      pageEl.dataset.page = String(pageNumber);
      pagesMeta.push({
        pageNumber,
        baseViewport,
        el: pageEl,
        rendered: false,
        rendering: false,
        textLayer: null,
        scale: 1,
      });
    }
    if (token !== viewerToken) {
      await doc.destroy();
      return;
    }
    pdfState = {
      token,
      file,
      pdfjs,
      doc,
      viewer,
      head,
      pagesEl: pages,
      pagesMeta,
      zoom: 1,
      focusPage: 1,
      query,
      queryScrolled: false,
      observer: null,
    };
    buildPdfPlaceholders();
    setupPdfObserver();
    focusPdfPage(Number(payload?.page) || 1);
  } catch (error) {
    if (token !== viewerToken) return;
    head.querySelector('.viewer-meta').textContent = '打开失败';
    pages.append(
      el('div', 'viewer-error', String(error?.message || error))
    );
  }
}

function buildPdfPlaceholders() {
  if (!pdfState) return;
  const available = Math.max(
    280,
    (pdfState.viewer.clientWidth || 720) - 64
  );
  pdfState.pagesEl.replaceChildren();
  pdfState.pagesMeta.forEach((meta) => {
    const scale = clamp(
      (available / meta.baseViewport.width) * pdfState.zoom,
      0.4,
      3
    );
    meta.scale = scale;
    meta.rendered = false;
    meta.rendering = false;
    meta.textLayer = null;
    const pageEl = el('div', 'pdf-page');
    pageEl.dataset.page = String(meta.pageNumber);
    pageEl.style.width = `${Math.round(meta.baseViewport.width * scale)}px`;
    pageEl.style.height = `${Math.round(meta.baseViewport.height * scale)}px`;
    pageEl.style.setProperty('--scale-factor', String(scale));
    meta.el = pageEl;
    pdfState.pagesEl.append(pageEl);
  });
  pdfState.pagesMeta.forEach((meta) => {
    if (meta.pageNumber === pdfState.focusPage) {
      meta.el.classList.add('focus');
    }
  });
}

function setupPdfObserver() {
  if (!pdfState) return;
  pdfState.observer?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const meta = pdfState?.pagesMeta.find(
          (item) => item.el === entry.target
        );
        if (meta) void renderPdfPage(meta);
      }
    },
    { root: content, rootMargin: '600px 0px' }
  );
  pdfState.pagesMeta.forEach((meta) => observer.observe(meta.el));
  pdfState.observer = observer;
}

async function renderPdfPage(meta) {
  if (!pdfState || meta.rendered || meta.rendering) return;
  meta.rendering = true;
  try {
    const page = await pdfState.doc.getPage(meta.pageNumber);
    if (!pdfState || pdfState.token !== viewerToken) return;
    const viewport = page.getViewport({ scale: meta.scale });
    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d', { alpha: false });
    await page.render({
      canvasContext: context,
      viewport,
      transform:
        outputScale !== 1
          ? [outputScale, 0, 0, outputScale, 0, 0]
          : null,
    }).promise;
    if (!pdfState || pdfState.token !== viewerToken) return;
    const textLayerDiv = el('div', 'textLayer');
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    meta.el.append(canvas, textLayerDiv);
    const textContent = await page.getTextContent();
    const textLayer = new pdfState.pdfjs.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
    meta.textLayer = textLayerDiv;
    meta.rendered = true;
    meta.rendering = false;
    meta.el.append(
      el('span', 'pdf-page-label', String(meta.pageNumber))
    );
    applyPdfQuery(meta);
    renderPdfPins(meta);
  } catch (error) {
    meta.rendering = false;
    if (meta.el && !meta.el.querySelector('.viewer-error')) {
      meta.el.append(
        el('div', 'viewer-error', String(error?.message || error))
      );
    }
  }
}

function applyPdfQuery(meta) {
  if (!pdfState?.query || !meta.textLayer) return;
  const needle = pdfState.query.toLowerCase();
  const spans = [...meta.textLayer.querySelectorAll('span')];
  let first = null;
  for (const span of spans) {
    if (!span.textContent.toLowerCase().includes(needle)) continue;
    span.classList.add('pdf-hit');
    if (!first) first = span;
  }
  if (first && !pdfState.queryScrolled) {
    pdfState.queryScrolled = true;
    requestAnimationFrame(() => first.scrollIntoView({ block: 'center' }));
  }
}

function focusPdfPage(pageNumber) {
  if (!pdfState) return;
  const page = clamp(
    Math.round(Number(pageNumber) || 1),
    1,
    pdfState.pagesMeta.length
  );
  pdfState.focusPage = page;
  pdfState.pagesMeta.forEach((meta) => {
    meta.el.classList.toggle('focus', meta.pageNumber === page);
  });
  const target = pdfState.pagesMeta[page - 1];
  target?.el.scrollIntoView({ block: 'start' });
  if (target) void renderPdfPage(target);
  updatePdfMeta();
}

function applyPdfZoom(delta) {
  if (!pdfState) return;
  const next = clamp(
    Math.round((pdfState.zoom + delta) * 100) / 100,
    0.5,
    2.5
  );
  if (next === pdfState.zoom) return;
  pdfState.zoom = next;
  pdfState.queryScrolled = false;
  buildPdfPlaceholders();
  setupPdfObserver();
  focusPdfPage(pdfState.focusPage);
}

function renderPdfPins(meta) {
  if (!pdfState) return;
  meta.el.querySelectorAll('.pdf-note-pin').forEach((pin) => pin.remove());
  const annotations = fileAnnotations(pdfState.file).filter(
    (item) => item.kind === 'pdf' && item.page === meta.pageNumber
  );
  for (const annotation of annotations) {
    const pin = el('button', 'pdf-note-pin');
    pin.type = 'button';
    pin.title = annotation.note;
    pin.style.left = `${clamp(annotation.rect.x, 0, 1) * 100}%`;
    pin.style.top = `${clamp(annotation.rect.y, 0, 1) * 100}%`;
    pin.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = pin.getBoundingClientRect();
      openAnnotationPopover({
        rect,
        note: annotation.note,
        quote: annotation.text || `第 ${annotation.page} 页`,
        onSave: (note) => {
          updateAnnotation(pdfState.file, annotation.id, note);
          renderPdfPins(meta);
        },
        onDelete: () => {
          deleteAnnotation(pdfState.file, annotation.id);
          renderPdfPins(meta);
        },
      });
    });
    meta.el.append(pin);
  }
}

function handlePdfSelection() {
  if (currentKind !== 'pdf' || !pdfState) return;
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const pageEl = node?.closest?.('.pdf-page');
    if (!pageEl) return;
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    showSelectionAction(rect, () => {
      const pageRect = pageEl.getBoundingClientRect();
      const anchor = {
        x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        w: clamp(rect.width / pageRect.width, 0, 1),
        h: clamp(rect.height / pageRect.height, 0, 1),
      };
      const pageNumber = Number(pageEl.dataset.page) || 1;
      const quote = selection.toString().trim().slice(0, 160);
      openAnnotationPopover({
        rect,
        quote: quote || `第 ${pageNumber} 页`,
        onSave: (note) => {
          addAnnotation({
            id: annotationId(),
            kind: 'pdf',
            file: pdfState.file,
            page: pageNumber,
            text: quote,
            rect: anchor,
            note,
            createdAt: Date.now(),
          });
          const meta = pdfState.pagesMeta[pageNumber - 1];
          if (meta) renderPdfPins(meta);
          closeSelectionAction();
        },
      });
    });
  }, 0);
}

/* ------------------------------ text rendering ----------------------------- */

function isTextHeading(block) {
  const line = block.split('\n', 1)[0].trim();
  return (
    /^[一二三四五六七八九十百千零〇]+[、.]/.test(line) ||
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

function cleanupViewer() {
  viewerToken += 1;
  closeSelectionAction();
  closeAnnotationPopover();
  if (contentScrollHandler) {
    content.removeEventListener('scroll', contentScrollHandler);
    contentScrollHandler = null;
  }
  if (pdfState?.observer) pdfState.observer.disconnect();
  if (pdfState?.doc) void pdfState.doc.destroy();
  pdfState = null;
  codeView = null;
}

function render(payload) {
  cleanupViewer();
  currentKey = payload?.key || null;
  currentKind = payload?.kind || 'text';
  currentPayload = payload || {};
  const title = String(payload?.title || 'CONTENT');
  document.title = `YAH - ${title}`;
  content.className = 'content';
  content.scrollTop = 0;

  if (payload?.error) {
    content.append(el('div', 'viewer-error', String(payload.error)));
    return;
  }

  if (currentKind === 'code') {
    content.classList.add('code-mode');
    renderCodeViewer(payload);
    return;
  }
  if (currentKind === 'pdf') {
    content.classList.add('pdf-mode');
    void renderPdfViewer(payload);
    return;
  }

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
  if (currentKind !== 'text') return;
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

/* --------------------------------- events --------------------------------- */

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
  if (event.key === 'Escape') {
    if (annotationPopover) {
      closeAnnotationPopover();
      return;
    }
    if (selectionAction) {
      closeSelectionAction();
      return;
    }
    api.close();
  }
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

// 禁用 Chromium 默认的中键拖动自动滚动
document.addEventListener(
  'mousedown',
  (event) => {
    if (event.button === 1) event.preventDefault();
  },
  true
);

document.addEventListener('mousedown', (event) => {
  if (!annotationPopover) return;
  if (event.target instanceof Node && annotationPopover.contains(event.target)) {
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest('.code-note-pin, .pdf-note-pin, .viewer-selection-action')
  ) {
    return;
  }
  closeAnnotationPopover();
});

document.addEventListener('mouseup', handlePdfSelection);

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
