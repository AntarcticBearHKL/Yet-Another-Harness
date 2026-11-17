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
let askPopover = null;
let viewerToast = null;
let viewerToastTimer = 0;
let contentScrollHandler = null;

const ANNOTATION_KEY = 'yah.viewer.annotations.v1';
let annotationStore = loadAnnotations();

const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .annotation-popover, .ask-popover, .viewer-selection-action, .viewer-selection-actions';

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
  const viewer = target.closest('.code-viewer, .pdf-viewer, .html-viewer');
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

function showSelectionAction(rect, actions) {
  closeSelectionAction();
  const bar = el('div', 'viewer-selection-actions');
  for (const action of actions || []) {
    const button = el(
      'button',
      `viewer-selection-action${action.primary ? ' primary' : ''}`,
      action.label
    );
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.onClick?.();
    });
    bar.append(button);
  }
  document.body.append(bar);
  const width = bar.offsetWidth || 120;
  const height = bar.offsetHeight || 28;
  let left = rect.right + 10;
  if (left + width > window.innerWidth - 12) {
    left = rect.left - width - 10;
  }
  left = clamp(left, 12, window.innerWidth - width - 12);
  const top = clamp(rect.top - 2, 12, window.innerHeight - height - 12);
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
  selectionAction = bar;
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
  closeAskPopover();
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

/* --------------------------------- ask AI -------------------------------- */

function closeAskPopover() {
  askPopover?.remove();
  askPopover = null;
}

function positionAskPopover(popover, rect) {
  const width = popover.offsetWidth || 320;
  const height = popover.offsetHeight || 220;
  let left = rect.right + 12;
  if (left + width > window.innerWidth - 12) {
    left = rect.left - width - 12;
  }
  left = clamp(left, 12, window.innerWidth - width - 12);
  let top = rect.top - 4;
  if (top < 52) top = rect.bottom + 10;
  if (top + height > window.innerHeight - 12) {
    top = window.innerHeight - height - 12;
  }
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

function openAskPopover({
  rect,
  label,
  presets = [],
  placeholder = '你想问什么？例如：这段代码的核心逻辑是什么？',
  onSubmit,
}) {
  closeSelectionAction();
  closeAnnotationPopover();
  closeAskPopover();
  const popover = el('div', 'ask-popover');
  const head = el('div', 'ask-head');
  head.append(el('span', 'ask-kicker', 'ASK AI'));
  if (label) head.append(el('span', 'ask-label', label));
  const presetRow = el('div', 'ask-presets');
  const input = el('textarea', 'ask-input');
  input.rows = 3;
  input.placeholder = placeholder;
  const actions = el('div', 'ask-actions');
  const cancel = el('button', 'ask-cancel', '取消');
  cancel.type = 'button';
  const send = el('button', 'ask-send', '发送给 AI');
  send.type = 'button';
  send.disabled = true;

  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    onSubmit?.(value);
    closeAskPopover();
  };

  for (const preset of presets) {
    const chip = el('button', 'ask-preset', preset);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      input.value = preset;
      submit();
    });
    presetRow.append(chip);
  }

  input.addEventListener('input', () => {
    send.disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  send.addEventListener('click', submit);
  cancel.addEventListener('click', closeAskPopover);
  actions.append(cancel, send);
  popover.append(head);
  if (presets.length > 0) popover.append(presetRow);
  popover.append(input, actions);
  document.body.append(popover);
  askPopover = popover;
  positionAskPopover(popover, rect);
  requestAnimationFrame(() => input.focus());
}

function showViewerToast(message) {
  if (!viewerToast) {
    viewerToast = el('div', 'viewer-toast');
    document.body.append(viewerToast);
  }
  viewerToast.textContent = String(message || '');
  viewerToast.classList.add('show');
  clearTimeout(viewerToastTimer);
  viewerToastTimer = setTimeout(() => {
    viewerToast?.classList.remove('show');
  }, 2400);
}

async function askViewer(prompt, label = '') {
  const text = String(prompt || '').trim();
  if (!text) return;
  try {
    const ok = await api.askViewer?.({
      prompt: text,
      label,
      sessionId: currentPayload?.sessionId || null,
    });
    showViewerToast(ok ? '已发送到对话' : '没有可用的对话窗口');
  } catch {
    showViewerToast('发送失败');
  }
}

function baseName(file) {
  return String(file || '').split(/[\\/]/).pop() || String(file || '');
}

function languageLabel(language) {
  if (language === 'python') return 'Python';
  if (language === 'javascript') return 'JavaScript';
  if (language === 'typescript') return 'TypeScript';
  if (language === 'jsx') return 'JSX';
  if (language === 'tsx') return 'TSX';
  return language || '代码';
}

/* -------------------------------- code view ------------------------------- */

const HTML_BASE_STYLE = `<style>
@font-face { font-family: "YAH Rounded"; src: url("/assets/fonts/ResourceHanRoundedCN-Regular.ttf") format("truetype"); font-style: normal; font-weight: 400; font-display: swap; }
@font-face { font-family: "YAH Rounded"; src: url("/assets/fonts/ResourceHanRoundedCN-Bold.ttf") format("truetype"); font-style: normal; font-weight: 700; font-display: swap; }
:root {
  color-scheme: light;
  --background: #fbf6ef;
  --surface-card: rgba(255, 252, 247, 0.56);
  --surface-row: rgba(252, 246, 238, 0.40);
  --text: #2b211a;
  --text-soft: #4a3a2e;
  --dim: #6f5d4f;
  --faint: #9a8878;
  --line: rgba(74, 54, 40, 0.14);
  --hover: rgba(74, 54, 40, 0.06);
  --selected: rgba(185, 111, 61, 0.14);
  --accent: #b96f3d;
  --accent-soft: #d28a55;
  --accent-deep: #94522a;
  --radius: 12px;
  --font: "YAH Rounded", "Resource Han Rounded CN", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
  --mono: "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  padding: 34px 38px 60px;
  background: var(--background);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4 {
  margin: 1.2em 0 0.55em;
  color: var(--text);
  line-height: 1.3;
  letter-spacing: -0.01em;
}
h1 { font-size: 28px; font-weight: 700; }
h2 { font-size: 22px; font-weight: 700; }
h3 { font-size: 18px; font-weight: 700; }
p { margin: 0.7em 0; }
a {
  color: var(--accent-deep);
  text-decoration: none;
  border-bottom: 1px solid rgba(185, 111, 61, 0.3);
}
a:hover { color: var(--accent); border-bottom-color: var(--accent); }
strong { color: var(--text); }
code, pre { font-family: var(--mono); }
code {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(74, 54, 40, 0.04);
  font-size: 0.88em;
}
pre {
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(74, 54, 40, 0.035);
  line-height: 1.6;
  overflow: auto;
}
pre code { padding: 0; border: 0; background: none; }
blockquote {
  margin: 1em 0;
  padding: 0.2em 0 0.2em 16px;
  border-left: 2px solid var(--accent-soft);
  color: var(--dim);
}
table {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  font-size: 0.94em;
}
th, td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  background: rgba(74, 54, 40, 0.03);
  color: var(--text-soft);
  font-weight: 700;
}
hr { margin: 1.4em 0; border: 0; border-top: 1px solid var(--line); }
img { max-width: 100%; height: auto; border-radius: 8px; }
::selection { background: rgba(185, 111, 61, 0.24); }
.yah-card {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.yah-muted { color: var(--faint); }
</style>`;

function buildHtmlDocument(value) {
  const source = String(value ?? '').trim();
  const base = HTML_BASE_STYLE;
  if (!source) {
    return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body><p class="yah-muted">Empty HTML</p></body></html>`;
  }
  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${base}</head>`);
  }
  if (/<body[\s>]/i.test(source)) {
    return source.replace(
      /<body([^>]*)>/i,
      `<head><meta charset="utf-8">${base}</head><body$1>`
    );
  }
  if (/<html[\s>]/i.test(source)) {
    return source.replace(
      /<html([^>]*)>/i,
      `<html$1><head><meta charset="utf-8">${base}</head>`
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${source}</body></html>`;
}

function renderHtmlViewer(payload) {
  const title = String(payload?.title || 'HTML');
  const viewer = el('div', 'viewer html-viewer');
  const head = makeViewerHead(title, 'HTML');
  const frame = document.createElement('iframe');
  frame.className = 'html-frame';
  frame.title = title;
  frame.setAttribute(
    'sandbox',
    'allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock'
  );
  frame.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = buildHtmlDocument(payload?.html ?? payload?.text);
  viewer.append(head, frame);
  content.append(viewer);
}

function renderCodeViewer(payload) {
  const file = String(payload?.path || '');
  const text = String(payload?.text ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const language =
    languageFor(file) ||
    window.YAHCodeParse?.detectLanguage(file, text) ||
    '';
  const analysis =
    window.YAHCodeParse?.analyzeCode(text, language) || {
      symbols: [],
      imports: [],
      foldRanges: [],
    };
  const highlighted = highlightCode(text, language);
  const htmlLines = splitHighlightedLines(highlighted);
  const viewer = el('div', 'viewer code-viewer');
  const metaParts = [`${lines.length} 行`];
  if (language) metaParts.push(language);
  if (analysis.symbols.length) {
    metaParts.push(`${analysis.symbols.length} 个符号`);
  }

  const outlineButton = el('button', 'viewer-action', '大纲');
  outlineButton.type = 'button';
  outlineButton.setAttribute('aria-pressed', 'false');
  const askButton = el('button', 'viewer-action primary', '问 AI');
  askButton.type = 'button';
  const head = makeViewerHead(file, metaParts.join(' · '), [
    outlineButton,
    askButton,
  ]);
  const body = el('div', 'code-body');
  const lineWrap = el('div', 'code-lines');
  const lineEls = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    const lineEl = el('div', 'code-line');
    lineEl.dataset.line = String(number);
    const num = el('span', 'code-num', String(number));
    const fold = el('span', 'code-fold');
    const code = el('span', 'code-text');
    code.innerHTML = htmlLines[index] || ' ';
    lineEl.append(num, fold, code);
    lineEl.addEventListener('click', (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.code-note-pin, .code-fold-toggle, .code-fold-summary')
      ) {
        return;
      }
      selectCodeLines(number, event.shiftKey);
    });
    lineEls.push(lineEl);
    lineWrap.append(lineEl);
  });
  body.append(lineWrap);
  viewer.append(head, body);

  const outline = buildCodeOutline(analysis, (symbol) => {
    revealCodeRange(symbol.startLine, symbol.endLine);
  });
  if (outline) viewer.append(outline);
  content.append(viewer);

  codeView = {
    file,
    language,
    lines,
    lineEls,
    analysis,
    outline,
    folded: new Set(),
    foldMap: new Map(),
    anchor: null,
    start: null,
    end: null,
  };
  setupCodeFolds(analysis);

  const showOutline = Boolean(outline) && window.innerWidth >= 980;
  viewer.classList.toggle('outline-hidden', !showOutline);
  outlineButton.setAttribute('aria-pressed', String(showOutline));
  outlineButton.disabled = !outline;
  outlineButton.addEventListener('click', () => {
    const hidden = viewer.classList.toggle('outline-hidden');
    outlineButton.setAttribute('aria-pressed', String(!hidden));
  });
  askButton.addEventListener('click', () => openCodeAskForFile(askButton));

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
    unfoldForLine(focusStart);
    unfoldForLine(focusEnd);
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

function outlineIcon(kind) {
  if (kind === 'class') return 'C';
  if (kind === 'method') return 'M';
  if (kind === 'function') return 'F';
  if (kind === 'type') return 'T';
  if (kind === 'enum') return 'E';
  if (kind === 'namespace') return 'N';
  if (kind === 'import') return 'I';
  return '•';
}

function buildCodeOutline(analysis, onSelect) {
  const symbols = Array.isArray(analysis?.symbols) ? analysis.symbols : [];
  const imports = Array.isArray(analysis?.imports) ? analysis.imports : [];
  if (symbols.length === 0 && imports.length === 0) return null;

  const aside = el('aside', 'code-outline');
  const head = el('div', 'code-outline-head');
  head.append(el('span', 'code-outline-title', 'OUTLINE'));
  head.append(
    el(
      'span',
      'code-outline-count',
      symbols.length ? `${symbols.length} SYMBOLS` : `${imports.length} IMPORTS`
    )
  );
  const list = el('div', 'code-outline-list');

  const addItem = (symbol) => {
    const item = el('button', 'code-outline-item');
    item.type = 'button';
    item.style.setProperty('--depth', String(symbol.depth || 0));
    item.append(
      el('span', `code-outline-icon ${symbol.kind}`, outlineIcon(symbol.kind))
    );
    item.append(el('span', 'code-outline-name', symbol.name));
    item.append(
      el('span', 'code-outline-line', `L${symbol.line || symbol.startLine}`)
    );
    item.setAttribute(
      'aria-label',
      `${symbol.kind} ${symbol.name}，第 ${symbol.line || symbol.startLine} 行`
    );
    item.addEventListener('click', () => onSelect?.(symbol));
    list.append(item);
  };

  if (imports.length > 0) {
    list.append(el('div', 'code-outline-group', 'IMPORTS'));
    imports.forEach(addItem);
  }
  if (symbols.length > 0) {
    list.append(el('div', 'code-outline-group', 'SYMBOLS'));
    symbols.forEach(addItem);
  }
  aside.append(head, list);
  return aside;
}

function setupCodeFolds(analysis) {
  if (!codeView) return;
  const ranges = Array.isArray(analysis?.foldRanges) ? analysis.foldRanges : [];
  for (const range of ranges) {
    if (!range || range.endLine <= range.startLine) continue;
    codeView.foldMap.set(range.startLine, range.endLine);
    const line = codeView.lineEls[range.startLine - 1];
    const cell = line?.querySelector('.code-fold');
    if (!cell) continue;
    const button = el('button', 'code-fold-toggle');
    button.type = 'button';
    button.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
    button.setAttribute(
      'aria-label',
      `折叠第 ${range.startLine} 到 ${range.endLine} 行`
    );
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCodeFold(range.startLine);
    });
    cell.append(button);
  }
  applyCodeFolds();
}

function toggleCodeFold(startLine) {
  if (!codeView?.foldMap.has(startLine)) return;
  if (codeView.folded.has(startLine)) codeView.folded.delete(startLine);
  else codeView.folded.add(startLine);
  applyCodeFolds();
}

function applyCodeFolds() {
  if (!codeView) return;
  codeView.lineEls.forEach((line) => {
    line.querySelectorAll('.code-fold-summary').forEach((node) => node.remove());
  });
  codeView.lineEls.forEach((lineEl, index) => {
    const number = index + 1;
    let hidden = false;
    for (const start of codeView.folded) {
      const end = codeView.foldMap.get(start);
      if (end && number > start && number <= end) {
        hidden = true;
        break;
      }
    }
    lineEl.classList.toggle('fold-hidden', hidden);
    const folded = codeView.folded.has(number);
    lineEl.classList.toggle('folded', folded);
    const toggle = lineEl.querySelector('.code-fold-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!folded));
      toggle.classList.toggle('open', !folded);
    }
    if (folded) {
      const end = codeView.foldMap.get(number);
      if (end) {
        const summary = el(
          'button',
          'code-fold-summary',
          `⋯ ${end - number} 行`
        );
        summary.type = 'button';
        summary.setAttribute('aria-label', `展开第 ${number} 到 ${end} 行`);
        summary.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleCodeFold(number);
        });
        const code = lineEl.querySelector('.code-text');
        if (code) lineEl.insertBefore(summary, code);
        else lineEl.append(summary);
      }
    }
  });
}

function unfoldForLine(lineNumber) {
  if (!codeView) return;
  let changed = false;
  for (const start of [...codeView.folded]) {
    const end = codeView.foldMap.get(start);
    if (end && lineNumber > start && lineNumber <= end) {
      codeView.folded.delete(start);
      changed = true;
    }
  }
  if (changed) applyCodeFolds();
}

function revealCodeRange(startLine, endLine) {
  if (!codeView) return;
  unfoldForLine(startLine);
  unfoldForLine(endLine);
  const start = clamp(Number(startLine) || 1, 1, codeView.lines.length);
  const end = clamp(Number(endLine) || start, start, codeView.lines.length);
  for (let i = start; i <= end; i += 1) {
    const line = codeView.lineEls[i - 1];
    if (!line) continue;
    line.classList.remove('jump');
    void line.offsetWidth;
    line.classList.add('jump');
    setTimeout(() => line.classList.remove('jump'), 1300);
  }
  codeView.lineEls[start - 1]?.scrollIntoView({
    block: 'center',
    behavior: 'smooth',
  });
}

function codeScopeForRange(startLine, endLine) {
  const symbols = codeView?.analysis?.symbols || [];
  let best = null;
  for (const symbol of symbols) {
    if (symbol.startLine > startLine || symbol.endLine < endLine) continue;
    if (!best || symbol.startLine >= best.startLine) best = symbol;
  }
  return best;
}

function codeSelectionPrompt(startLine, endLine, question) {
  if (!codeView) return String(question || '');
  const maxLines = 240;
  const selected = codeView.lines.slice(startLine - 1, endLine);
  const shown = selected.slice(0, maxLines);
  const excerpt = shown
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
  const scope = codeScopeForRange(startLine, endLine);
  const scopeLine = scope
    ? `\n所在${scope.kind === 'class' ? '类' : scope.kind === 'method' ? '方法' : '函数'}：${scope.name}（L${scope.startLine}-L${scope.endLine}）`
    : '';
  const truncated =
    selected.length > maxLines
      ? `\n（代码较长，只附上前 ${maxLines} 行；其余可读取文件。）`
      : '';
  return [
    `请帮我理解下面这段 ${languageLabel(codeView.language)} 代码。`,
    '',
    `文件：${codeView.file}`,
    `行号：L${startLine}-L${endLine}${scopeLine}`,
    `语言：${codeView.language || 'unknown'}`,
    '',
    '选中代码（行号: 内容）：',
    '```' + (codeView.language || ''),
    excerpt,
    '```',
    truncated,
    '',
    `我的问题：${String(question || '').trim()}`,
    '',
    '如果需要更多上下文，请读取上面的文件。',
  ].join('\n');
}

function codeFilePrompt(question) {
  if (!codeView) return String(question || '');
  const outline = (codeView.analysis?.symbols || [])
    .slice(0, 40)
    .map(
      (symbol) =>
        `- ${symbol.kind} ${symbol.name} L${symbol.startLine}-L${symbol.endLine}`
    )
    .join('\n');
  return [
    '请带我读这个文件。',
    '',
    `文件：${codeView.file}`,
    `语言：${codeView.language || 'unknown'}`,
    `行数：${codeView.lines.length}`,
    outline ? `已解析结构：\n${outline}` : '',
    '',
    `我的问题：${String(question || '').trim()}`,
    '',
    '请先概括文件结构，再按我的问题讲解关键逻辑；需要时读取上面的文件。',
  ].join('\n');
}

function openCodeAskForRange(rect, startLine, endLine) {
  if (!codeView) return;
  const label = `${baseName(codeView.file)} · L${startLine}-L${endLine}`;
  openAskPopover({
    rect,
    label,
    presets: ['解释这段', '逐行讲解', '找问题', '重构建议'],
    onSubmit: (question) =>
      askViewer(codeSelectionPrompt(startLine, endLine, question), label),
  });
}

function openCodeAskForFile(anchor) {
  if (!codeView) return;
  const rect = anchor.getBoundingClientRect();
  const label = baseName(codeView.file);
  openAskPopover({
    rect,
    label,
    presets: ['带我读这个文件', '解释整体结构', '找风险', '总结关键逻辑'],
    placeholder: '你想让我先看哪一部分？',
    onSubmit: (question) => askViewer(codeFilePrompt(question), label),
  });
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
  const start = codeView.start;
  const end = codeView.end;
  showSelectionAction(rect, [
    {
      label: '问 AI',
      primary: true,
      onClick: () => openCodeAskForRange(rect, start, end),
    },
    {
      label: '注释',
      onClick: () => {
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
      },
    },
  ]);
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

function makeViewerHead(pathText, metaText, actions = []) {
  const head = el('header', 'viewer-head');
  const pathEl = el('div', 'viewer-path', pathText || 'FILE');
  pathEl.title = pathText || '';
  const meta = el('div', 'viewer-meta', metaText || '');
  const right = el('div', 'viewer-head-right');
  right.append(meta);
  for (const action of actions) right.append(action);
  head.append(pathEl, right);
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
  const askPage = el('button', 'viewer-action primary', '问这一页');
  askPage.type = 'button';
  askPage.addEventListener('click', () => {
    if (!pdfState) return;
    const page = pdfState.focusPage;
    if (!pdfPageText(page)) {
      showViewerToast('这一页还在渲染，请稍后再试');
      return;
    }
    const label = `${baseName(pdfState.file)} · 第 ${page} 页`;
    openAskPopover({
      rect: askPage.getBoundingClientRect(),
      label,
      presets: ['总结这一页', '解释核心论点', '翻译成中文', '带我读这一页'],
      onSubmit: (question) =>
        askViewer(pdfPagePrompt(page, question), label),
    });
  });
  meta.append(pageInfo, zoomOut, zoomLabel, zoomIn, askPage);
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
    const pageRect = pageEl.getBoundingClientRect();
    const anchor = {
      x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
      y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
      w: clamp(rect.width / pageRect.width, 0, 1),
      h: clamp(rect.height / pageRect.height, 0, 1),
    };
    const pageNumber = Number(pageEl.dataset.page) || 1;
    const selectedText = selection.toString().trim();
    const quote = selectedText.slice(0, 160);
    const label = `${baseName(pdfState.file)} · 第 ${pageNumber} 页`;
    showSelectionAction(rect, [
      {
        label: '问 AI',
        primary: true,
        onClick: () => {
          openAskPopover({
            rect,
            label,
            presets: [
              '解释这段',
              '这段在论证什么',
              '翻译成中文',
              '带我读这一页',
            ],
            onSubmit: (question) =>
              askViewer(
                pdfSelectionPrompt(pageNumber, selectedText, question),
                label
              ),
          });
        },
      },
      {
        label: '注释',
        onClick: () => {
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
        },
      },
    ]);
  }, 0);
}

function pdfPageText(pageNumber) {
  if (!pdfState) return '';
  const meta = pdfState.pagesMeta[pageNumber - 1];
  const layer = meta?.textLayer;
  if (!layer) return '';
  return [...layer.querySelectorAll('span')]
    .map((span) => span.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfSelectionPrompt(pageNumber, selectedText, question) {
  if (!pdfState) return String(question || '');
  const pageText = pdfPageText(pageNumber);
  return [
    '请带我读这篇论文的这一段。',
    '',
    `文件：${pdfState.file}`,
    `页码：第 ${pageNumber} 页`,
    '',
    `选中文本：\n"""${String(selectedText || '').slice(0, 4000)}"""`,
    pageText
      ? `\n本页文本（供上下文）：\n"""${pageText.slice(0, 7000)}"""`
      : '',
    '',
    `我的问题：${String(question || '').trim()}`,
  ].join('\n');
}

function pdfPagePrompt(pageNumber, question) {
  if (!pdfState) return String(question || '');
  const pageText = pdfPageText(pageNumber);
  return [
    '请带我读这篇论文的这一页。',
    '',
    `文件：${pdfState.file}`,
    `页码：第 ${pageNumber} 页`,
    pageText ? `\n本页文本：\n"""${pageText.slice(0, 8000)}"""` : '',
    '',
    `我的问题：${String(question || '').trim()}`,
  ].join('\n');
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
  closeAskPopover();
  if (viewerToast) viewerToast.classList.remove('show');
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
  if (currentKind === 'html') {
    content.classList.add('html-mode');
    renderHtmlViewer(payload);
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
    if (askPopover) {
      closeAskPopover();
      return;
    }
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
  if (askPopover) {
    closeAskPopover();
    return;
  }
  if (annotationPopover) {
    closeAnnotationPopover();
    return;
  }
  if (selectionAction) {
    closeSelectionAction();
    return;
  }
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
  const target = event.target;
  if (askPopover && !(target instanceof Node && askPopover.contains(target))) {
    closeAskPopover();
  }
  if (!annotationPopover) return;
  if (target instanceof Node && annotationPopover.contains(target)) {
    return;
  }
  if (
    target instanceof Element &&
    target.closest(
      '.code-note-pin, .pdf-note-pin, .viewer-selection-action, .viewer-selection-actions'
    )
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
