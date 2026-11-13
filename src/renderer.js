'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const DEFAULT_PROJECT = { id: 'project-default', name: 'Project 1' };
const NO_KEY_HINT =
  'No OpenCode Go API key yet. Hold Tab and open Settings to paste your key.';

const shell = window.yah || null;
const $ = (id) => document.getElementById(id);

const dom = {
  messages: $('messages'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  switcher: $('switcher'),
  switcherList: $('switcher-list'),
  switcherNew: $('switcher-new'),
  switcherSettings: $('switcher-settings'),
  projectList: $('project-list'),
  projectNew: $('project-new'),
  settingsOverlay: $('settings-overlay'),
  rawOverlay: $('raw-overlay'),
  rawBody: $('raw-body'),
  rawMeta: $('raw-meta'),
  apiKey: $('api-key'),
  apiKeyState: $('api-key-state'),
  ringMenu: $('ring-menu'),
  ringSvg: $('ring-svg'),
  catalog: $('catalog'),
  catalogTitle: $('catalog-title'),
  catalogList: $('catalog-list'),
  catalogClose: $('catalog-close'),
  webContent: $('web-content'),
  webContentTitle: $('web-content-title'),
  webContentBody: $('web-content-body'),
  webContentClose: $('web-content-close'),
};

const state = {
  sessions: [],
  projects: [],
  current: 0,
  seq: 1,
  settings: {
    apiKey: '',
    hasApiKey: false,
  },
  switcherOpen: false,
  switcherIndex: 0,
  switcherProjectId: null,
  composerOpen: false,
  openCardKey: null,
  renderedOpenKeys: new Set(),
  renderedSessionId: null,
  renderVersion: 0,
  lastWheelNav: 0,
  tabHeld: false,
  streaming: false,
  requestId: null,
  streamMessage: null,
  pendingDelete: -1,
  deleteTimer: null,
  saveTimer: null,
  settingsTimer: null,
  forceScroll: true,
  ringOpen: false,
  ringIndex: -1,
  ringSuppress: false,
  catalogOpen: false,
  catalogKind: null,
};

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
    error.code = data?.code;
    throw error;
  }
  return data;
}

const eventHandlers = new Map();
let chatEvents = null;
let chatEventsSessionId = null;

function subscribeEvent(type, callback) {
  if (!eventHandlers.has(type)) eventHandlers.set(type, new Set());
  eventHandlers.get(type).add(callback);
  return () => eventHandlers.get(type)?.delete(callback);
}

function dispatchEvent(type, data) {
  const handlers = eventHandlers.get(type);
  if (!handlers) return;
  for (const callback of [...handlers]) {
    try {
      callback(data);
    } catch (error) {
      console.error('event handler failed', type, error);
    }
  }
}

function closeChatEvents() {
  if (chatEvents) {
    chatEvents.close();
    chatEvents = null;
  }
  chatEventsSessionId = null;
}

function connectChatEvents(sessionId) {
  if (!sessionId) {
    closeChatEvents();
    return;
  }
  if (chatEvents && chatEventsSessionId === sessionId) return;
  closeChatEvents();
  chatEventsSessionId = sessionId;
  const source = new EventSource(
    `/api/events?sessionId=${encodeURIComponent(sessionId)}`
  );
  chatEvents = source;
  source.onmessage = (event) => {
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data?.type) dispatchEvent(data.type, data);
  };
  source.onerror = () => {
    /* EventSource reconnects automatically */
  };
}

let webContentKey = null;
let webContentKind = 'text';

function renderWebContent(payload) {
  if (!dom.webContentBody) return;
  dom.webContentBody.replaceChildren();
  if (webContentKind === 'tool' || payload?.json != null) {
    const pre = el('pre', 'tool-text');
    pre.textContent =
      payload?.json != null
        ? JSON.stringify(payload.json, null, 2)
        : String(payload?.text ?? '');
    dom.webContentBody.append(pre);
    return;
  }
  if (!String(payload?.text ?? '').trim()) {
    dom.webContentBody.append(
      el('div', 'web-content-empty', '还没有内容')
    );
    return;
  }
  renderTextContent(dom.webContentBody, payload?.text);
}

function openWebContent(payload) {
  if (!dom.webContent) return Promise.resolve();
  webContentKey = payload?.key || null;
  webContentKind = payload?.kind || 'text';
  dom.webContentTitle.textContent = payload?.title || 'CONTENT';
  renderWebContent(payload);
  dom.webContentBody.scrollTop = 0;
  dom.webContent.classList.remove('hidden');
  dom.webContent.setAttribute('aria-hidden', 'false');
  return Promise.resolve();
}

function updateWebContent(payload) {
  if (!payload || payload.key !== webContentKey) return;
  if (typeof payload.text !== 'string') return;
  if (webContentKind === 'tool') return;
  const previousTop = dom.webContentBody.scrollTop;
  const atBottom =
    dom.webContentBody.scrollHeight -
      dom.webContentBody.scrollTop -
      dom.webContentBody.clientHeight <
    40;
  renderTextContent(dom.webContentBody, payload.text);
  if (atBottom) {
    dom.webContentBody.scrollTop = dom.webContentBody.scrollHeight;
  } else {
    dom.webContentBody.scrollTop = previousTop;
  }
}

function closeWebContent() {
  if (!dom.webContent) return;
  webContentKey = null;
  dom.webContent.classList.add('hidden');
  dom.webContent.setAttribute('aria-hidden', 'true');
}

const api = {
  isElectron: Boolean(shell),
  platform: shell?.platform || 'web',
  version: () => shell?.version?.() ?? Promise.resolve('web'),
  minimize: () => shell?.minimize?.(),
  maximize: () => shell?.maximize?.(),
  close: () => shell?.close?.(),
  dragStart: (point) => shell?.dragStart?.(point),
  dragMove: (point) => shell?.dragMove?.(point),
  dragEnd: () => shell?.dragEnd?.(),
  isMaximized: () => shell?.isMaximized?.() ?? Promise.resolve(false),

  loadSettings: () => requestJson('/api/settings'),
  saveSettings: (settings) =>
    requestJson('/api/settings', { method: 'PUT', body: settings }),
  loadChats: () => requestJson('/api/chats'),
  saveChats: (chats) =>
    requestJson('/api/chats', { method: 'POST', body: chats }),
  deleteSession: (id) =>
    requestJson(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  saveChatsSync: (chats) => {
    const body = JSON.stringify(chats);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/chats',
        new Blob([body], { type: 'application/json' })
      );
      return;
    }
    fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  },
  sendChat: (payload) =>
    requestJson('/api/send', { method: 'POST', body: payload }),
  loadCatalog: () => requestJson('/api/catalog'),

  openContent: (payload) =>
    shell ? shell.openContent(payload) : openWebContent(payload),
  updateContent: (payload) => {
    if (shell) shell.updateContent(payload);
    else updateWebContent(payload);
  },
  onContentInit: (callback) => shell?.onContentInit?.(callback) ?? (() => {}),
  onContentUpdate: (callback) =>
    shell?.onContentUpdate?.(callback) ?? (() => {}),

  onChatDelta: (callback) => subscribeEvent('assistant.delta', callback),
  onChatRequest: (callback) => subscribeEvent('request.body', callback),
  onChatToolCall: (callback) => subscribeEvent('tool.call', callback),
  onChatToolResult: (callback) => subscribeEvent('tool.result', callback),
  onChatDone: (callback) => subscribeEvent('run.done', callback),
  onChatError: (callback) => subscribeEvent('run.error', callback),
  onRunStarted: (callback) => subscribeEvent('run.started', callback),
};

if (!api.isElectron) {
  document.body.classList.add('web');
}

let windowDrag = null;
let dragPoint = null;
let dragFrame = 0;
let dragFromComposer = false;
let suppressNextCardClick = false;

function currentSession() {
  return state.sessions[state.current];
}

function ensureProjects() {
  if (!Array.isArray(state.projects)) state.projects = [];
  if (state.projects.length === 0) {
    state.projects = [{ ...DEFAULT_PROJECT }];
  }
  const ids = new Set(state.projects.map((project) => project.id));
  for (const session of state.sessions) {
    if (!ids.has(session.projectId)) {
      session.projectId = state.projects[0].id;
    }
  }
  if (!state.switcherProjectId || !ids.has(state.switcherProjectId)) {
    state.switcherProjectId =
      currentSession()?.projectId || state.projects[0].id;
  }
}

function sessionsInProject(projectId = state.switcherProjectId) {
  return state.sessions.filter((session) => session.projectId === projectId);
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function structurePayload() {
  return {
    projects: state.projects,
    sessions: state.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      system: session.system,
      projectId: session.projectId,
      msgs: [],
    })),
    current: state.current,
    seq: state.seq,
  };
}

function saveChatsNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  api
    .saveChats(structurePayload())
    .catch((error) => console.error('save chats failed', error));
}

function saveChatsSoon() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveChatsNow, 250);
}

function settingsPayload() {
  const key = String(state.settings.apiKey || '').trim();
  return key ? { apiKey: key } : {};
}

function saveSettingsNow() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = null;
  api
    .saveSettings(settingsPayload())
    .catch((error) => console.error('save settings failed', error));
}

function saveSettingsSoon() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(saveSettingsNow, 300);
}

function applySettings() {
  const s = state.settings;
  const hasKey = Boolean(s.hasApiKey);
  dom.apiKeyState.textContent = hasKey ? 'set' : 'not set';
  dom.apiKey.placeholder = hasKey ? '已设置，输入新 key 可替换' : '';
  if (document.activeElement !== dom.apiKey) {
    dom.apiKey.value = '';
  }
}

function updateControls() {
  const session = currentSession();
  if (!session) {
    dom.input.disabled = true;
    dom.input.placeholder = 'Hold Tab to create a chat';
    updateSendState();
    return;
  }

  dom.input.disabled = false;
  dom.input.placeholder = '输入新对话…';
  updateSendState();
}

function isNearBottom() {
  return (
    dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight <
    80
  );
}

function appendRow(card, options = {}, container = dom.messages) {
  const row = el('div', 'msg');
  if (options.process) row.classList.add('process-row');
  if (card.classList.contains('answer-card')) row.classList.add('answer-row');
  row.append(card);
  container.append(row);
}

function messageCardKey(index) {
  return `m:${index}`;
}

function agentCardKey(index) {
  return `a:${index}`;
}

function stepCardKey(messageIndex, stepIndex) {
  return `s:${messageIndex}:${stepIndex}`;
}

function cardByKey(key) {
  if (!key) return null;
  for (const card of dom.messages.querySelectorAll('.message-card')) {
    if (card.dataset.cardKey === key) return card;
  }
  return null;
}

function setCardExpanded(card, expanded) {
  if (card.classList.contains('always-open')) expanded = true;
  card.classList.toggle('collapsed', !expanded);
  const body = card.querySelector('.card-body-wrap');
  if (body) body.inert = !expanded;
  const head = card.querySelector('.card-head');
  if (head) head.setAttribute('aria-expanded', String(expanded));
  requestAnimationFrame(() => updateCardClip(card));
}

function updateCardClip(card) {
  if (!card) return;
  const scroller = card.querySelector('.card-text, .json-view, .tool-text');
  if (!scroller) return;
  const clipped = scroller.scrollHeight > scroller.clientHeight + 1;
  scroller.classList.toggle('is-clipped', clipped);
}

function openKeySet(key) {
  const set = new Set();
  if (key) set.add(key);
  return set;
}

function sameOpenKeys(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

function applyOpenKeys(keys, { instant = false } = {}) {
  const set = keys instanceof Set ? new Set(keys) : openKeySet(keys);
  const cards = [...dom.messages.querySelectorAll('.message-card')];

  if (instant) {
    for (const card of cards) card.classList.add('no-anim');
  }
  for (const card of cards) {
    setCardExpanded(card, set.has(card.dataset.cardKey));
  }
  if (instant) {
    requestAnimationFrame(() => {
      for (const card of cards) card.classList.remove('no-anim');
    });
  }

  state.renderedOpenKeys = set;
}

function applyOpenKey(key, opts) {
  applyOpenKeys(openKeySet(key), opts);
}

function toggleCard(key) {
  const card = cardByKey(key);
  if (!card) return;
  if (card.classList.contains('always-open')) return;

  if (!card.classList.contains('collapsed')) {
    state.openCardKey = null;
    applyOpenKey(null);
    return;
  }

  state.openCardKey = key;
  applyOpenKey(key);
}

function previewLine(text) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (/^```/.test(line)) continue;
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/[*_`]/g, '')
      .trim();
    if (line) return line;
  }
  return '';
}

function previewFromRaw(raw, structured) {
  if (structured) {
    try {
      const compact = JSON.stringify(structured);
      return compact.length > 200 ? `${compact.slice(0, 199)}…` : compact;
    } catch {
      /* fall through */
    }
  }
  return previewLine(raw);
}

function makeCard(opts) {
  const card = el('div', `message-card ${opts.kind}`);
  card.dataset.cardKey = opts.key;
  if (opts.primary) card.classList.add('answer-card');
  if (opts.process) card.classList.add('process-card');
  if (opts.alwaysOpen) card.classList.add('always-open');
  if (opts.headless) card.classList.add('headless');
  if (!opts.alwaysOpen) card.classList.add('collapsed');

  let head = null;
  if (!opts.headless) {
    head = el('div', 'card-head');
    head.append(el('span', 'card-dot'));
    if (!opts.minimalHead) {
      head.append(el('span', 'card-title', opts.title || ''));
    }
    head.append(el('span', 'card-meta', opts.meta || ''));
    if (opts.badge) {
      const badge = el('span', 'card-badge', opts.badge.text);
      if (opts.badge.error) badge.classList.add('error');
      head.append(badge);
    }

    card.title = opts.onFullContent
      ? 'Click header to expand/collapse · double-click content for full view · Ctrl+double-click for raw request'
      : 'Click header to expand/collapse';

    head.addEventListener('click', (event) => {
      if (suppressNextCardClick) {
        suppressNextCardClick = false;
        return;
      }
      if (event.detail > 1) return;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, textarea')
      ) {
        return;
      }
      toggleCard(opts.key);
    });
  }

  let previewWrap = null;
  if (opts.preview && !opts.alwaysOpen && !opts.headless) {
    previewWrap = el('div', 'card-preview-wrap');
    const preview = el('div', 'card-preview');
    const previewText = el('span', 'card-preview-text', opts.preview);
    previewText.title = opts.preview;
    preview.append(previewText);
    previewWrap.append(preview);
    previewWrap.addEventListener('click', (event) => {
      if (suppressNextCardClick) {
        suppressNextCardClick = false;
        return;
      }
      if (event.detail > 1) return;
      toggleCard(opts.key);
    });
    previewWrap.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey && typeof opts.onInspect === 'function') {
        opts.onInspect();
        return;
      }
      opts.onFullContent?.();
    });
  }

  const bodyWrap = el('div', 'card-body-wrap');
  bodyWrap.inert = !opts.alwaysOpen;
  const body = el('div', 'card-body');
  const inner = el('div', 'card-body-inner');
  body.append(inner);
  bodyWrap.append(body);
  if (head) card.append(head);
  if (previewWrap) card.append(previewWrap);
  card.append(bodyWrap);

  bodyWrap.addEventListener('dblclick', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea')
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey && typeof opts.onInspect === 'function') {
      opts.onInspect();
      return;
    }
    opts.onFullContent?.();
  });

  return { card, head, body: inner, bodyWrap };
}

function isTextHeading(block) {
  const line = block.split('\n', 1)[0].trim();
  return (
    /^[一二三四五六七八九十百千零〇]+、/.test(line) ||
    /^（[一二三四五六七八九十百千零〇]+）/.test(line)
  );
}

function renderTextContent(container, text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const blocks = normalized ? normalized.split(/\n{2,}/) : [];
  container.replaceChildren();
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const [firstLine, ...rest] = block.split('\n');
    if (isTextHeading(block)) {
      container.append(
        el('div', 'text-block text-heading', firstLine.trim())
      );
      const remainder = rest.join('\n').trim();
      if (remainder) container.append(el('div', 'text-block', remainder));
    } else {
      container.append(el('div', 'text-block', block));
    }
  }
}

function textFromCard(card) {
  const node = card.querySelector('.card-text');
  if (!node) return '';
  const blocks = [...node.querySelectorAll('.text-block')];
  if (blocks.length === 0) return node.textContent;
  return blocks.map((block) => block.textContent).join('\n\n');
}

function openFullContent(payload) {
  api.openContent(payload).catch((error) => {
    console.error('open content window failed', error);
  });
}

function textCard({
  key,
  kind,
  title,
  meta,
  text,
  streaming,
  onInspect,
  primary,
  minimalHead,
  process,
}) {
  const { card, body } = makeCard({
    key,
    kind,
    title,
    meta,
    preview: previewLine(text),
    onInspect,
    primary,
    minimalHead,
    process,
    onFullContent: () =>
      openFullContent({
        key,
        title: [title, meta].filter(Boolean).join(' · ') || '回答',
        kind: 'text',
        text: textFromCard(card),
      }),
  });
  if (text) {
    const textNode = el('div', 'card-text');
    renderTextContent(textNode, text);
    body.append(textNode);
  }
  if (streaming) card.classList.add('streaming');
  return card;
}

function promptCard({ key, text, onInspect }) {
  const { card, body } = makeCard({
    key,
    kind: 'user',
    title: '',
    meta: '',
    onInspect,
    headless: true,
    alwaysOpen: true,
    onFullContent: () =>
      openFullContent({
        key,
        title: 'prompt',
        kind: 'text',
        text: textFromCard(card),
      }),
  });
  card.classList.add('prompt-card');
  const textNode = el('div', 'card-text prompt-text');
  renderTextContent(textNode, text);
  body.append(textNode);
  return card;
}

function parseStructured(text) {
  const raw = String(text ?? '').trim();
  if (!raw || (raw[0] !== '{' && raw[0] !== '[')) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function jsonValueSpan(value) {
  if (value === null) return el('span', 'json-null', 'null');
  if (typeof value === 'string') {
    return el('span', 'json-string', JSON.stringify(value));
  }
  if (typeof value === 'number') {
    return el('span', 'json-number', String(value));
  }
  if (typeof value === 'boolean') {
    return el('span', 'json-boolean', String(value));
  }
  return el('span', 'json-string', String(value));
}

function jsonPrimitiveRow(value, key, comma) {
  const row = el('div', 'json-row');
  row.append(el('span', 'json-spacer'));
  if (key !== null) {
    row.append(
      el(
        'span',
        typeof key === 'number' ? 'json-index' : 'json-key',
        String(key)
      )
    );
    row.append(el('span', 'json-punct', ': '));
  }
  row.append(jsonValueSpan(value));
  if (comma) row.append(el('span', 'json-punct', ','));
  return row;
}

function jsonBranch(value, key, comma) {
  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [index, item])
    : Object.entries(value);

  const node = el('div', 'json-node');
  const head = el('div', 'json-row');
  const toggle = el('button', 'json-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  head.append(toggle);
  if (key !== null) {
    head.append(el('span', 'json-key', String(key)));
    head.append(el('span', 'json-punct', ': '));
  }
  head.append(el('span', 'json-punct', isArray ? '[' : '{'));
  head.append(el('span', 'json-count', String(entries.length)));
  node.append(head);

  const children = el('div', 'json-children');
  entries.forEach(([childKey, childValue], index) => {
    const last = index === entries.length - 1;
    if (childValue !== null && typeof childValue === 'object') {
      children.append(jsonBranch(childValue, childKey, !last));
    } else {
      children.append(jsonPrimitiveRow(childValue, childKey, !last));
    }
  });
  node.append(children);

  const close = el('div', 'json-row');
  close.append(el('span', 'json-spacer'));
  close.append(el('span', 'json-punct', isArray ? ']' : '}'));
  if (comma) close.append(el('span', 'json-punct', ','));
  node.append(close);

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    node.classList.toggle('json-collapsed');
    toggle.setAttribute(
      'aria-expanded',
      String(!node.classList.contains('json-collapsed'))
    );
  });

  return node;
}

function jsonView(value) {
  const view = el('div', 'json-view');
  if (value !== null && typeof value === 'object') {
    view.append(jsonBranch(value, null, false));
  } else {
    view.append(jsonPrimitiveRow(value, null, false));
  }
  return view;
}

function rawRoundLabel(round) {
  return `OpenCode Go · round ${round + 1} · POST /chat/completions`;
}

function requestAt(msg, round) {
  if (!msg || !Array.isArray(msg.requests)) return null;
  return msg.requests[round] || null;
}

function inspectStep(msg, step) {
  let round = Number.isInteger(step?.round) ? step.round : 0;
  if (step && step.kind === 'result') round += 1;
  openRawRequest(requestAt(msg, round), rawRoundLabel(round));
}

function nextAgentForUser(msg) {
  const session = currentSession();
  if (!session) return null;
  const index = session.msgs.indexOf(msg);
  if (index < 0) return null;
  for (let i = index + 1; i < session.msgs.length; i += 1) {
    if (session.msgs[i].role === 'Agent') return session.msgs[i];
  }
  return null;
}

function inspectUserMessage(msg) {
  const agent = nextAgentForUser(msg);
  openRawRequest(
    agent ? requestAt(agent, 0) : null,
    rawRoundLabel(0)
  );
}

function renderToolCard(step, msg, key) {
  const call = step.kind === 'call';
  const raw = call ? step.arguments : step.output;
  const structured = parseStructured(raw);
  const { card, body } = makeCard({
    key,
    kind: call ? 'tool-call' : 'tool-result',
    title: call ? '工具调用' : '工具返回',
    meta: step.name || 'tool',
    preview: previewFromRaw(raw, structured),
    badge: call
      ? null
      : { text: step.ok === false ? 'error' : 'ok', error: step.ok === false },
    onInspect: () => inspectStep(msg, step),
    process: true,
    onFullContent: () =>
      openFullContent({
        key,
        title: `${call ? '工具调用' : '工具返回'} · ${step.name || 'tool'}`,
        kind: 'tool',
        text: String(raw ?? ''),
        json: structured,
      }),
  });
  if (!call && step.ok === false) card.classList.add('error');

  if (structured) {
    body.append(jsonView(structured));
  } else {
    body.append(el('pre', 'tool-text', String(raw ?? '')));
  }
  return card;
}

function isRichTrace(steps) {
  return steps.some(
    (step) =>
      step.kind === 'text' ||
      step.kind === 'thinking' ||
      step.kind === 'call' ||
      step.kind === 'result'
  );
}

function lastCardKey(session) {
  if (!session || session.msgs.length === 0) return null;
  const index = session.msgs.length - 1;
  const msg = session.msgs[index];
  if (msg.role !== 'Agent') return messageCardKey(index);

  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  if (isRichTrace(steps) && steps.length > 0) {
    const lastTextIndex = steps.reduce(
      (last, step, stepIndex) => (step.kind === 'text' ? stepIndex : last),
      -1
    );
    return stepCardKey(
      index,
      lastTextIndex >= 0 ? lastTextIndex : steps.length - 1
    );
  }
  return agentCardKey(index);
}

function streamingAutoKey() {
  const session = currentSession();
  if (!session || !state.streaming || !state.streamMessage) return null;

  const index = session.msgs.indexOf(state.streamMessage);
  if (index < 0) return null;

  const steps = Array.isArray(state.streamMessage.steps)
    ? state.streamMessage.steps
    : [];
  if (steps.length > 0) return stepCardKey(index, steps.length - 1);

  // 还没有第一个 token：先展开用户刚发的那条消息
  if (!state.streamMessage.text) {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (session.msgs[i].role === 'User') return messageCardKey(i);
    }
  }
  return agentCardKey(index);
}

function autoCardKey() {
  return streamingAutoKey() || lastCardKey(currentSession());
}

function renderAgentMessage(msg, msgIndex, container) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  const rich = isRichTrace(steps);
  const streaming = state.streaming && msg === state.streamMessage;

  if (!rich) {
    // 旧消息或普通回复：一个卡片，旧的工具过程行显示在文字上方
    const { card, body } = makeCard({
      key: agentCardKey(msgIndex),
      kind: 'agent',
      title: '回答',
      meta: 'response',
      preview: previewLine(msg.text),
      primary: true,
      minimalHead: true,
      onInspect: () => {
        openRawRequest(requestAt(msg, 0), rawRoundLabel(0));
      },
      onFullContent: () =>
        openFullContent({
          key: agentCardKey(msgIndex),
          title: '回答 · response',
          kind: 'text',
          text: msg.text,
        }),
    });
    for (const step of steps) {
      if (step.kind !== 'status') continue;
      const line = el('div', 'card-status-line', step.label);
      if (step.ok === false) line.classList.add('error');
      body.append(line);
    }
    if (msg.text) {
      const textNode = el('div', 'card-text');
      renderTextContent(textNode, msg.text);
      body.append(textNode);
    }
    if (streaming) card.classList.add('streaming');
    appendRow(card, {}, container);
    return;
  }

  const lastTextIndex = steps.reduce(
    (last, step, index) => (step.kind === 'text' ? index : last),
    -1
  );

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'text' || step.kind === 'thinking') {
      if (!step.text && !(streaming && i === steps.length - 1)) continue;
      const thinking = step.kind === 'thinking';
      const primary = !thinking && i === lastTextIndex;
      appendRow(
        textCard({
          key: stepCardKey(msgIndex, i),
          kind: thinking ? 'thinking' : 'agent',
          title: thinking ? '思考' : primary ? '回答' : '过程',
          meta: thinking ? 'thinking' : primary ? 'response' : 'text',
          text: step.text,
          streaming: streaming && i === steps.length - 1,
          onInspect: () => inspectStep(msg, step),
          primary,
          minimalHead: primary,
          process: !primary,
        }),
        { process: !primary },
        container
      );
    } else if (step.kind === 'call' || step.kind === 'result') {
      appendRow(
        renderToolCard(step, msg, stepCardKey(msgIndex, i)),
        { process: true },
        container
      );
    }
  }
}

function renderMessages({ animate = true } = {}) {
  const session = currentSession();
  const sessionId = session ? session.id : null;
  const version = ++state.renderVersion;
  const changed = state.renderedSessionId !== sessionId;
  const previousKeys = changed
    ? new Set()
    : new Set(state.renderedOpenKeys);
  const prevTop = dom.messages.scrollTop;
  const stick = state.forceScroll || isNearBottom();
  state.forceScroll = false;

  dom.messages.replaceChildren();
  if (!session) {
    state.openCardKey = null;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = null;
    dom.messages.append(el('div', 'empty', '还没有对话，按住 Tab 新建'));
    return;
  }
  if (session.msgs.length === 0) {
    state.openCardKey = null;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = sessionId;
    dom.messages.append(el('div', 'empty', '还没有消息，按 Space 输入'));
    return;
  }

  let currentTurn = null;
  session.msgs.forEach((msg, index) => {
    if (msg.role === 'User') {
      currentTurn = el('section', 'turn');
      dom.messages.append(currentTurn);
      appendRow(
        promptCard({
          key: messageCardKey(index),
          text: msg.text,
          onInspect: () => inspectUserMessage(msg),
        }),
        {},
        currentTurn
      );
      return;
    }

    if (!currentTurn) {
      currentTurn = el('section', 'turn');
      dom.messages.append(currentTurn);
    }
    renderAgentMessage(msg, index, currentTurn);
  });

  const autoKey = autoCardKey();
  state.openCardKey = autoKey;
  const cards = [...dom.messages.querySelectorAll('.message-card')];
  const cardKeys = new Set(cards.map((card) => card.dataset.cardKey));

  const targetKeys = openKeySet(autoKey);
  for (const key of [...targetKeys]) {
    if (!cardKeys.has(key)) targetKeys.delete(key);
  }
  state.renderedSessionId = sessionId;

  if (changed || !animate) {
    applyOpenKeys(targetKeys, { instant: true });
  } else {
    for (const card of cards) {
      setCardExpanded(card, previousKeys.has(card.dataset.cardKey));
    }
    void dom.messages.offsetHeight;
    if (!sameOpenKeys(previousKeys, targetKeys)) {
      requestAnimationFrame(() => {
        if (state.renderVersion !== version) return;
        const latest = openKeySet(state.openCardKey);
        const keys = new Set();
        for (const key of latest) {
          if (cardKeys.has(key)) keys.add(key);
        }
        applyOpenKeys(keys);
      });
    } else {
      state.renderedOpenKeys = targetKeys;
    }
  }

  requestAnimationFrame(() => {
    if (state.renderVersion !== version) return;
    if (stick) dom.messages.scrollTop = dom.messages.scrollHeight;
    else dom.messages.scrollTop = prevTop;
  });
}

function renderSwitcher() {
  ensureProjects();
  const project =
    state.projects.find((item) => item.id === state.switcherProjectId) ||
    state.projects[0];
  state.switcherProjectId = project.id;
  const sessions = sessionsInProject(project.id);

  const selectProject = (projectId) => {
    if (state.switcherProjectId === projectId) return;
    state.switcherProjectId = projectId;
    const next = sessionsInProject(projectId);
    const current = currentSession();
    state.switcherIndex = Math.max(0, next.indexOf(current));
    state.pendingDelete = -1;
    clearTimeout(state.deleteTimer);
    renderSwitcher();
  };

  dom.projectList.replaceChildren();
  state.projects.forEach((item) => {
    const row = el('button', 'project-row');
    row.type = 'button';
    if (item.id === project.id) row.classList.add('selected');
    row.append(el('span', 'project-name', item.name));
    row.addEventListener('click', () => selectProject(item.id));
    row.addEventListener('mouseenter', () => selectProject(item.id));
    dom.projectList.append(row);
  });

  dom.switcherList.replaceChildren();
  if (sessions.length === 0) {
    state.switcherIndex = 0;
    dom.switcherList.append(el('div', 'switcher-empty', '还没有对话'));
    return;
  }

  state.switcherIndex = Math.max(
    0,
    Math.min(state.switcherIndex, sessions.length - 1)
  );

  sessions.forEach((session, localIndex) => {
    const globalIndex = state.sessions.indexOf(session);
    const card = el('div', 'switch-card');
    if (globalIndex === state.current) card.classList.add('current');
    if (localIndex === state.switcherIndex) card.classList.add('selected');

    const top = el('div', 'switch-top');
    top.append(el('span', 'switch-title', session.title || `Chat ${localIndex + 1}`));

    const trash = el('button', 'trash switch-trash');
    trash.type = 'button';
    trash.title = 'Delete chat';
    trash.setAttribute('aria-label', 'Delete chat');
    if (state.pendingDelete === localIndex) trash.classList.add('armed');
    trash.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20M9 6V4H15V6M6 6L7 20H17L18 6M10 10V17M14 10V17"/></svg>';

    card.addEventListener('click', () => selectSession(globalIndex));
    top.addEventListener('mouseenter', () => selectSession(globalIndex));

    trash.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.pendingDelete === localIndex) {
        state.pendingDelete = -1;
        clearTimeout(state.deleteTimer);
        deleteSession(globalIndex);
        return;
      }
      state.pendingDelete = localIndex;
      clearTimeout(state.deleteTimer);
      state.deleteTimer = setTimeout(() => {
        state.pendingDelete = -1;
        renderSwitcher();
      }, 3000);
      renderSwitcher();
    });

    card.append(top, trash);
    dom.switcherList.append(card);
  });

  if (state.switcherOpen) {
    const selected = dom.switcherList.querySelector('.switch-card.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }
}

function cancelTabHold() {
  state.tabHeld = false;
}

function scrollCardToTop(card, offset = 48) {
  const container = dom.messages;
  const containerRect = container.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  container.scrollTop += cardRect.top - containerRect.top - offset;
}

function navigateBlock(direction, { selector = null } = {}) {
  const allCards = [...dom.messages.querySelectorAll('.message-card')];
  if (allCards.length === 0) return;

  const cards = selector
    ? allCards.filter((card) => card.matches(selector))
    : allCards;
  if (cards.length === 0) return;

  let currentKey = state.openCardKey;
  if (!currentKey) {
    for (const key of state.renderedOpenKeys) {
      currentKey = key;
      break;
    }
  }

  const allIndex = allCards.findIndex(
    (card) => card.dataset.cardKey === currentKey
  );
  const filteredIndex = cards.findIndex(
    (card) => card.dataset.cardKey === currentKey
  );

  let targetIndex;
  if (filteredIndex >= 0) {
    targetIndex = filteredIndex + direction;
  } else if (allIndex >= 0) {
    if (direction > 0) {
      // 当前展开的不是目标类型：取它后面的第一个
      targetIndex = cards.findIndex(
        (card) => allCards.indexOf(card) > allIndex
      );
    } else {
      // 当前展开的不是目标类型：取它前面的最后一个
      targetIndex = -1;
      for (let i = 0; i < cards.length; i += 1) {
        if (allCards.indexOf(cards[i]) < allIndex) targetIndex = i;
      }
    }
  } else {
    targetIndex = direction > 0 ? 0 : cards.length - 1;
  }

  if (targetIndex < 0 || targetIndex >= cards.length) return;

  const target = cards[targetIndex];
  const targetKey = target.dataset.cardKey;
  state.openCardKey = targetKey;

  // 先瞬间折叠所有块，把目标块定位到固定高度后立刻展开
  for (const card of allCards) {
    card.classList.add('no-anim');
    setCardExpanded(card, false);
  }
  void dom.messages.offsetHeight;
  scrollCardToTop(target);
  applyOpenKey(targetKey, { instant: true });
}

function openComposer() {
  if (state.composerOpen || !currentSession()) return;
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (!dom.rawOverlay.classList.contains('hidden')) return;
  if (state.switcherOpen) return;

  state.composerOpen = true;
  dom.composer.inert = false;
  dom.composer.setAttribute('aria-hidden', 'false');
  dom.composer.classList.add('open');
  requestAnimationFrame(() => {
    if (!state.composerOpen) return;
    dom.input.focus();
    const end = dom.input.value.length;
    dom.input.setSelectionRange(end, end);
  });
}

function closeComposer() {
  if (!state.composerOpen) return;
  state.composerOpen = false;
  dom.composer.classList.remove('open');
  dom.composer.inert = true;
  dom.composer.setAttribute('aria-hidden', 'true');
  dom.input.blur();
}

function openSwitcher() {
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  closeComposer();
  ensureProjects();
  const session = currentSession();
  state.switcherOpen = true;
  state.switcherProjectId =
    session?.projectId || state.projects[0].id;
  state.switcherIndex = Math.max(
    0,
    sessionsInProject(state.switcherProjectId).findIndex(
      (item) => item === session
    )
  );
  state.pendingDelete = -1;
  renderSwitcher();
  dom.switcher.inert = false;
  dom.switcher.setAttribute('aria-hidden', 'false');
  dom.switcher.classList.add('open');
}

function closeSwitcher() {
  if (!state.switcherOpen) return;
  state.switcherOpen = false;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  cancelTabHold();
  dom.switcher.classList.remove('open');
  dom.switcher.inert = true;
  dom.switcher.setAttribute('aria-hidden', 'true');
}

function moveSwitcher(delta) {
  const sessions = sessionsInProject(state.switcherProjectId);
  if (sessions.length === 0) return;
  state.switcherIndex =
    (state.switcherIndex + delta + sessions.length) % sessions.length;
  renderSwitcher();
}

function selectSession(index) {
  if (index < 0 || index >= state.sessions.length) return;
  state.current = index;
  state.switcherProjectId = state.sessions[index].projectId;
  state.forceScroll = true;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  saveChatsSoon();
  closeSwitcher();
  renderAll();
}

function createChatFromSwitcher() {
  const projectId = state.switcherProjectId;
  closeSwitcher();
  newSession(projectId);
}

function newProject() {
  ensureProjects();
  const project = {
    id: makeId(),
    name: `Project ${state.projects.length + 1}`,
  };
  state.projects.push(project);
  state.switcherProjectId = project.id;
  state.switcherIndex = 0;
  saveChatsSoon();
  renderSwitcher();
}

function renderAll() {
  if (state.switcherOpen) renderSwitcher();
  renderMessages();
  updateControls();
  connectChatEvents(currentSession()?.id || null);
}

function updateSendState() {
  dom.send.disabled =
    !currentSession() || state.streaming || dom.input.value.trim() === '';
}

function newSession(projectId) {
  ensureProjects();
  if (state.sessions.length === 0) state.seq = 0;
  state.seq += 1;
  const targetProjectId =
    state.projects.find((project) => project.id === projectId)?.id ||
    currentSession()?.projectId ||
    state.projects[0].id;
  state.sessions.push({
    id: makeId(),
    title: `Chat ${state.seq}`,
    system: DEFAULT_SYSTEM_PROMPT,
    projectId: targetProjectId,
    msgs: [],
  });
  state.current = state.sessions.length - 1;
  state.forceScroll = true;
  state.switcherProjectId = targetProjectId;
  dom.input.value = '';
  updateSendState();
  saveChatsSoon();
  renderAll();
  openComposer();
}

function deleteSession(index) {
  if (index < 0 || index >= state.sessions.length) return;
  const removed = state.sessions[index];
  if (
    state.streaming &&
    state.streamMessage &&
    removed.msgs.includes(state.streamMessage)
  ) {
    state.streaming = false;
    state.requestId = null;
    state.streamMessage = null;
  }
  state.sessions.splice(index, 1);
  if (removed) {
    api.deleteSession(removed.id).catch((error) => {
      console.error('delete session failed', error);
    });
  }

  if (state.sessions.length === 0) {
    // 删光就保持空状态，不自动补一个新对话
    state.current = 0;
    state.seq = 0;
  } else {
    if (index < state.current) state.current -= 1;
    state.current = Math.min(state.current, state.sessions.length - 1);
  }

  state.pendingDelete = -1;
  state.forceScroll = true;
  saveChatsSoon();
  renderAll();
}

async function sendMessage() {
  if (state.streaming) return;
  const text = dom.input.value.trim();
  if (!text) return;
  closeComposer();

  const session = currentSession();
  if (!session) return;
  session.msgs.push({ role: 'User', text, request: null, steps: [] });
  const agent = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
  session.msgs.push(agent);

  state.streamMessage = agent;
  state.forceScroll = true;
  dom.input.value = '';
  updateSendState();

  if (!state.settings.hasApiKey) {
    agent.text = NO_KEY_HINT;
    agent.request = null;
    agent.steps = [
      { kind: 'status', label: 'local note (no API key)', ok: false },
    ];
    state.streamMessage = null;
    state.streaming = false;
    saveChatsSoon();
    renderAll();
    return;
  }

  const requestId = makeId();
  state.streaming = true;
  state.requestId = requestId;
  renderAll();

  try {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await api.saveChats(structurePayload());
    await api.sendChat({
      requestId,
      chatId: session.id,
      text,
    });
  } catch (error) {
    if (state.requestId !== requestId) return;
    const note = `[request failed] ${error.message}`;
    if (agent.text.trim()) agent.text += `\n\n${note}`;
    else agent.text = note;
    agent.steps.push({ kind: 'status', label: note, ok: false });
    agent.request = null;
    finishStream();
  }
}

async function refreshChats() {
  try {
    const chats = await api.loadChats();
    const currentId = currentSession()?.id;
    state.projects = chats.projects || [];
    state.sessions = chats.sessions || [];
    state.seq = chats.seq;
    const index = currentId
      ? state.sessions.findIndex((session) => session.id === currentId)
      : -1;
    state.current = index >= 0 ? index : chats.current;
    ensureProjects();
    renderAll();
  } catch (error) {
    console.error('refresh chats failed', error);
  }
}

function finishStream() {
  const stick = isNearBottom();
  state.streaming = false;
  state.requestId = null;
  state.streamMessage = null;
  state.forceScroll = false;

  dom.messages
    .querySelectorAll('.message-card.streaming')
    .forEach((card) => card.classList.remove('streaming'));

  state.openCardKey = autoCardKey();
  applyOpenKey(state.openCardKey);

  updateSendState();
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();

  if (stick) {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }
}

function openRawRequest(body, label) {
  dom.rawMeta.textContent = label || '';
  dom.rawBody.replaceChildren();
  if (body && typeof body === 'object') {
    dom.rawBody.append(jsonView(body));
  } else {
    dom.rawBody.append(
      el(
        'div',
        'raw-empty',
        '没有可显示的原始请求'
      )
    );
  }
  closeComposer();
  dom.rawOverlay.classList.remove('hidden');
}

function closeRawRequest() {
  dom.rawOverlay.classList.add('hidden');
}

function openSettings() {
  closeComposer();
  applySettings();
  dom.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsOverlay.classList.add('hidden');
  saveSettingsNow();
}

/* ---------------------------------------------------------------- window drag */
const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .switch-card, .composer-box';

function hitsScrollbar(target, event) {
  if (target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return (
    event.clientX >= rect.left + target.clientWidth - 1 ||
    event.clientY >= rect.top + target.clientHeight - 1
  );
}

async function syncMaximized() {
  if (!api.isElectron) return;
  const maximized = await api.isMaximized();
  document.body.classList.toggle('maximized', maximized);
}

function onWindowDragStart(event) {
  if (!api.isElectron) return;
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DRAG_EXCLUDE)) return;
  const overlay = target.closest('.overlay');
  if (overlay && overlay !== dom.switcher) return;
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (target instanceof HTMLElement && hitsScrollbar(target, event)) return;

  const isCardHead = Boolean(
    target.closest('.card-head, .card-preview-wrap')
  );
  suppressNextCardClick = false;
  windowDrag = {
    x: event.screenX,
    y: event.screenY,
    started: !isCardHead,
    isCardHead,
  };
  dragFromComposer = Boolean(
    state.composerOpen && target.closest('#composer')
  );
  if (!isCardHead) {
    api.dragStart({ x: event.screenX, y: event.screenY });
  }
}

function onWindowDragMove(event) {
  if (!windowDrag) return;
  if (event.buttons === 0) {
    onWindowDragEnd();
    return;
  }

  if (!windowDrag.started) {
    const dx = event.screenX - windowDrag.x;
    const dy = event.screenY - windowDrag.y;
    if (Math.hypot(dx, dy) < 4) return;
    windowDrag.started = true;
    if (windowDrag.isCardHead) suppressNextCardClick = true;
    api.dragStart({ x: windowDrag.x, y: windowDrag.y });
  }

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
  const wasCardHead = windowDrag.isCardHead;
  const started = windowDrag.started;
  const refocusComposer = dragFromComposer && state.composerOpen;
  dragFromComposer = false;
  windowDrag = null;
  dragPoint = null;
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  if (started) api.dragEnd();
  if (wasCardHead && started) {
    setTimeout(() => {
      suppressNextCardClick = false;
    }, 300);
  }
  if (refocusComposer) {
    requestAnimationFrame(() => {
      if (!state.composerOpen || !document.hasFocus()) return;
      dom.input.focus();
      const end = dom.input.value.length;
      dom.input.setSelectionRange(end, end);
    });
  }
}

const RING_MID = 150;
const RING_SIZE = 300;
const RING_OUTER = 118;
const RING_INNER = 64;
const RING_LABEL_RADIUS = 91;
const RING_DEAD_ZONE = 34;
const RING_GAP = 3;

const RING_ITEMS = [
  {
    label: '工具',
    icon: '<path d="M14.5 6.5a3.5 3.5 0 0 0-4.9 4.9L4 17v3h3l5.6-5.6a3.5 3.5 0 0 0 4.9-4.9l-2.1 2.1-2.1-2.1 2.1-2.1Z"/>',
    action: () => openCatalog('tools'),
  },
  {
    label: 'Skill',
    icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    action: () => openCatalog('skills'),
  },
  {
    label: 'MCP',
    icon: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5"/>',
    action: () => openCatalog('mcp'),
  },
];

let ringCenterPoint = { x: 0, y: 0 };
let ringSegments = [];
let ringLabels = [];

function ringPolar(radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: RING_MID + radius * Math.cos(rad),
    y: RING_MID + radius * Math.sin(rad),
  };
}

function ringSectorPath(inner, outer, startAngle, endAngle) {
  const a = ringPolar(outer, startAngle);
  const b = ringPolar(outer, endAngle);
  const c = ringPolar(inner, endAngle);
  const d = ringPolar(inner, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${a.x} ${a.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y}`,
    'Z',
  ].join(' ');
}

function buildRingMenu() {
  const svgNS = 'http://www.w3.org/2000/svg';
  dom.ringSvg.replaceChildren();
  for (const label of ringLabels) label.remove();
  ringSegments = [];
  ringLabels = [];

  const step = 360 / RING_ITEMS.length;
  RING_ITEMS.forEach((item, index) => {
    const midAngle = -90 + index * step;
    const start = midAngle - step / 2 + RING_GAP / 2;
    const end = midAngle + step / 2 - RING_GAP / 2;

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'ring-seg');
    path.setAttribute('d', ringSectorPath(RING_INNER, RING_OUTER, start, end));
    dom.ringSvg.append(path);
    ringSegments.push(path);

    const label = el('div', 'ring-label');
    label.innerHTML = `<svg class="ring-icon" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>`;
    const point = ringPolar(RING_LABEL_RADIUS, midAngle);
    label.style.left = `${point.x}px`;
    label.style.top = `${point.y}px`;
    dom.ringMenu.append(label);
    ringLabels.push(label);
  });
}

function updateRingSelection(index) {
  state.ringIndex = index;
  ringSegments.forEach((segment, i) =>
    segment.classList.toggle('selected', i === index)
  );
  ringLabels.forEach((label, i) =>
    label.classList.toggle('selected', i === index)
  );
}

function ringIndexForPoint(x, y) {
  const dx = x - ringCenterPoint.x;
  const dy = y - ringCenterPoint.y;
  if (Math.hypot(dx, dy) < RING_DEAD_ZONE) return -1;

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const step = 360 / RING_ITEMS.length;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < RING_ITEMS.length; i += 1) {
    const midAngle = -90 + i * step;
    const diff = Math.abs((((angle - midAngle) % 360) + 540) % 360 - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function openRingMenu(x, y) {
  if (state.ringOpen) closeRingMenu();

  const half = RING_SIZE / 2;
  const margin = 6;
  const cx = Math.min(
    window.innerWidth - half - margin,
    Math.max(half + margin, x)
  );
  const cy = Math.min(
    window.innerHeight - half - margin,
    Math.max(half + margin, y)
  );

  ringCenterPoint = { x: cx, y: cy };
  dom.ringMenu.style.left = `${cx}px`;
  dom.ringMenu.style.top = `${cy}px`;
  state.ringOpen = true;
  state.ringSuppress = true;
  updateRingSelection(-1);
  document.body.classList.add('ring-open');
  dom.ringMenu.setAttribute('aria-hidden', 'false');
  dom.ringMenu.classList.add('open');
}

function closeRingMenu() {
  if (!state.ringOpen) return;
  state.ringOpen = false;
  updateRingSelection(-1);
  document.body.classList.remove('ring-open');
  dom.ringMenu.classList.remove('open');
  dom.ringMenu.setAttribute('aria-hidden', 'true');
}

function updateRingFromPointer(event) {
  if (!state.ringOpen) return;
  updateRingSelection(ringIndexForPoint(event.clientX, event.clientY));
}

function onRightMouseDown(event) {
  if (event.button !== 2) return;

  if (state.catalogOpen) {
    closeCatalog();
    state.ringSuppress = true;
    return;
  }
  if (!dom.rawOverlay.classList.contains('hidden')) {
    closeRawRequest();
    state.ringSuppress = true;
    return;
  }
  if (!dom.settingsOverlay.classList.contains('hidden')) {
    closeSettings();
    state.ringSuppress = true;
    return;
  }
  if (state.switcherOpen) {
    closeSwitcher();
    state.ringSuppress = true;
    return;
  }
  if (state.composerOpen) {
    closeComposer();
    state.ringSuppress = true;
    return;
  }

  openRingMenu(event.clientX, event.clientY);
}

function onRightMouseUp(event) {
  if (event.button !== 2 || !state.ringOpen) return;
  const index = ringIndexForPoint(event.clientX, event.clientY);
  closeRingMenu();
  if (index < 0) return;
  const action = RING_ITEMS[index].action;
  requestAnimationFrame(() => action());
}

const CATALOG_TITLES = { tools: '工具', skills: 'Skill', mcp: 'MCP' };
const CATALOG_EMPTY = {
  skills: '还没有安装 Skill。',
  mcp: '还没有连接 MCP。',
};

function closeCatalog() {
  if (!state.catalogOpen) return;
  state.catalogOpen = false;
  state.catalogKind = null;
  dom.catalog.classList.add('hidden');
  dom.catalog.setAttribute('aria-hidden', 'true');
}

function renderCatalogTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    dom.catalogList.append(el('div', 'catalog-empty', '还没有可用工具。'));
    return;
  }

  for (const entry of tools) {
    const fn = entry.function || entry;
    const item = el('div', 'catalog-item');
    item.append(el('div', 'catalog-name', fn.name || 'tool'));
    if (fn.description) {
      item.append(el('div', 'catalog-desc', fn.description));
    }

    const properties = fn.parameters?.properties || {};
    const required = new Set(fn.parameters?.required || []);
    const names = Object.keys(properties);
    if (names.length > 0) {
      const params = el('div', 'catalog-params');
      for (const paramName of names) {
        const schema = properties[paramName] || {};
        const row = el('div', 'catalog-param');
        const head = el('div', 'catalog-param-head');
        head.append(el('span', 'catalog-param-name', paramName));
        if (schema.type) {
          head.append(el('span', 'catalog-param-type', schema.type));
        }
        if (required.has(paramName)) {
          head.append(el('span', 'catalog-param-required', 'required'));
        }
        row.append(head);
        if (schema.description) {
          row.append(el('div', 'catalog-param-desc', schema.description));
        }
        params.append(row);
      }
      item.append(params);
    }
    dom.catalogList.append(item);
  }
}

function renderCatalogList(kind, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    dom.catalogList.append(
      el('div', 'catalog-empty', CATALOG_EMPTY[kind] || '还没有内容。')
    );
    return;
  }

  for (const entry of entries) {
    const item = el('div', 'catalog-item');
    item.append(el('div', 'catalog-name', entry.name || kind));
    if (entry.description) {
      item.append(el('div', 'catalog-desc', entry.description));
    }
    const meta = [entry.source, entry.transport, entry.status]
      .filter(Boolean)
      .join(' · ');
    if (meta) item.append(el('div', 'catalog-meta', meta));
    dom.catalogList.append(item);
  }
}

async function openCatalog(kind) {
  closeRingMenu();
  state.catalogOpen = true;
  state.catalogKind = kind;
  dom.catalogTitle.textContent = CATALOG_TITLES[kind] || kind;
  dom.catalogList.replaceChildren(
    el('div', 'catalog-empty', '加载中…')
  );
  dom.catalog.classList.remove('hidden');
  dom.catalog.setAttribute('aria-hidden', 'false');

  try {
    const data = await api.loadCatalog();
    if (!state.catalogOpen || state.catalogKind !== kind) return;
    dom.catalogList.replaceChildren();
    if (kind === 'tools') {
      renderCatalogTools(data?.tools);
    } else {
      renderCatalogList(kind, kind === 'skills' ? data?.skills : data?.mcp);
    }
  } catch (error) {
    console.error('load catalog failed', error);
    if (!state.catalogOpen || state.catalogKind !== kind) return;
    dom.catalogList.replaceChildren(
      el('div', 'catalog-empty', '加载失败。')
    );
  }
}

function bindEvents() {
  buildRingMenu();

  // 整体禁用鼠标右键菜单与框选；有弹窗时右键等于关闭
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (state.ringSuppress) {
      state.ringSuppress = false;
      return;
    }
    if (state.ringOpen) return;
    if (state.catalogOpen) {
      closeCatalog();
      return;
    }
    if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
      closeWebContent();
      return;
    }
    if (!dom.rawOverlay.classList.contains('hidden')) {
      closeRawRequest();
      return;
    }
    if (!dom.settingsOverlay.classList.contains('hidden')) {
      closeSettings();
      return;
    }
    if (state.switcherOpen) {
      closeSwitcher();
      return;
    }
    if (state.composerOpen) closeComposer();
  });
  document.addEventListener('selectstart', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea')) return;
    event.preventDefault();
  });

  document.addEventListener('mousedown', onWindowDragStart);
  document.addEventListener('mousemove', onWindowDragMove);
  document.addEventListener('mouseup', onWindowDragEnd);
  window.addEventListener('blur', onWindowDragEnd);
  window.addEventListener('resize', syncMaximized);
  syncMaximized();

  document.addEventListener('mousedown', onRightMouseDown);
  document.addEventListener('mousemove', updateRingFromPointer);
  document.addEventListener('mouseup', onRightMouseUp);
  window.addEventListener('blur', closeRingMenu);

  dom.switcherNew.addEventListener('click', createChatFromSwitcher);
  dom.projectNew.addEventListener('click', newProject);
  dom.switcherSettings.addEventListener('click', () => {
    closeSwitcher();
    openSettings();
  });

  $('close-settings').addEventListener('click', closeSettings);
  $('done-settings').addEventListener('click', closeSettings);
  $('close-raw').addEventListener('click', closeRawRequest);
  dom.catalogClose.addEventListener('click', closeCatalog);
  dom.webContentClose?.addEventListener('click', closeWebContent);
  dom.rawOverlay.addEventListener('click', (event) => {
    if (event.target === dom.rawOverlay) closeRawRequest();
  });

  $('mobile-compose')?.addEventListener('click', openComposer);
  dom.send.addEventListener('click', sendMessage);
  dom.input.addEventListener('input', updateSendState);
  dom.input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  $('win-min').addEventListener('click', () => api.minimize());
  $('win-max').addEventListener('click', () => api.maximize());
  $('win-close').addEventListener('click', () => api.close());

  dom.apiKey.addEventListener('input', () => {
    state.settings.apiKey = dom.apiKey.value;
    if (dom.apiKey.value.trim()) state.settings.hasApiKey = true;
    dom.apiKeyState.textContent = state.settings.hasApiKey ? 'set' : 'not set';
    saveSettingsSoon();
  });

  $('reset-settings').addEventListener('click', () => {
    state.settings = { apiKey: '', hasApiKey: false };
    applySettings();
    api
      .saveSettings({ clearApiKey: true })
      .catch((error) => console.error('clear api key failed', error));
  });

  document.addEventListener('keydown', (event) => {
    if (state.ringOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRingMenu();
      }
      return;
    }

    if (state.catalogOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCatalog();
      }
      return;
    }

    if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWebContent();
      }
      return;
    }

    if (!dom.rawOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRawRequest();
      }
      return;
    }

    if (state.composerOpen) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeComposer();
      }
      return;
    }

    if (event.key === 'Tab') {
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      if (state.switcherOpen) return;
      if (event.repeat || state.tabHeld) return;

      state.tabHeld = true;
      openSwitcher();
      return;
    }

    if (!dom.settingsOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape') closeSettings();
      return;
    }

    if (state.switcherOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSwitcher();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSwitcher(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSwitcher(-1);
        return;
      }

      if (event.key === 'Enter') {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('button, input, textarea')
        ) {
          return;
        }
        event.preventDefault();
        const session = sessionsInProject(state.switcherProjectId)[
          state.switcherIndex
        ];
        if (session) selectSession(state.sessions.indexOf(session));
      }
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      const active = document.activeElement;
      const inEditable =
        (target instanceof Element &&
          target.closest('input, textarea, [contenteditable="true"]')) ||
        (active instanceof Element &&
          active.closest('input, textarea, [contenteditable="true"]'));
      const onControl =
        (target instanceof Element && target.closest('button, a, select')) ||
        (active instanceof Element && active.closest('button, a, select'));
      if (inEditable || onControl) return;
      event.preventDefault();
      openComposer();
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Tab') {
      if (!state.tabHeld) return;
      cancelTabHold();
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      if (state.switcherOpen) closeSwitcher();
    }
  });

  window.addEventListener('blur', () => {
    cancelTabHold();
    if (state.switcherOpen) closeSwitcher();
  });

  document.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.shiftKey) return;

      // Ctrl+wheel / Shift+wheel 始终拦截，避免页面缩放或横向滚动
      event.preventDefault();
      if (!dom.rawOverlay.classList.contains('hidden')) return;
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      if (state.switcherOpen) return;
      if (state.composerOpen) return;

      const delta = event.deltaY || event.deltaX;
      if (delta === 0) return;

      const now = Date.now();
      if (now - state.lastWheelNav < 25) return;
      state.lastWheelNav = now;

      const direction = delta > 0 ? 1 : -1;
      if (event.ctrlKey) {
        navigateBlock(direction);
      } else {
        // Shift+wheel：只在用户 prompt 条目之间切换
        navigateBlock(direction, { selector: '.message-card.user' });
      }
    },
    { passive: false }
  );

  // 点击遮罩空白处关闭；面板本身阻止冒泡
  dom.settingsOverlay.addEventListener('click', (event) => {
    if (event.target !== dom.settingsOverlay) return;
    closeSettings();
  });

  api.onChatDelta(({ requestId, text, round, reasoning }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    const msg = state.streamMessage;
    const isReasoning = Boolean(reasoning);
    if (!isReasoning) msg.text += text;
    if (!Array.isArray(msg.steps)) msg.steps = [];

    const stepRound = Number.isInteger(round) ? round : 0;
    const stepKind = isReasoning ? 'thinking' : 'text';
    const last = msg.steps[msg.steps.length - 1];
    let newStep = false;
    if (last && last.kind === stepKind && last.round === stepRound) {
      last.text += text;
    } else {
      msg.steps.push({ kind: stepKind, text, round: stepRound });
      newStep = true;
    }

    const session = currentSession();
    const messageIndex = session ? session.msgs.indexOf(msg) : -1;
    if (messageIndex < 0) return;

    const stepIndex = msg.steps.length - 1;
    const key = stepCardKey(messageIndex, stepIndex);

    if (newStep) {
      state.openCardKey = key;
      renderMessages();
      return;
    }

    const card = cardByKey(key);
    if (!card) {
      state.openCardKey = key;
      renderMessages();
      return;
    }

    let textNode = card.querySelector('.card-text');
    if (!textNode) {
      textNode = el('div', 'card-text');
      const body = card.querySelector('.card-body-inner');
      if (body) body.append(textNode);
    }
    renderTextContent(textNode, last.text);
    api.updateContent({ key, text: last.text });
    updateCardClip(card);
    card.classList.add('streaming');

    const stick = isNearBottom();
    state.forceScroll = false;
    state.openCardKey = key;
    if (
      state.renderedOpenKeys.size !== 1 ||
      !state.renderedOpenKeys.has(key)
    ) {
      applyOpenKey(key);
    }
    if (stick) {
      requestAnimationFrame(() => {
        dom.messages.scrollTop = dom.messages.scrollHeight;
      });
    }
  });

  api.onChatRequest(({ requestId, round, body }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!body || typeof body !== 'object') return;
    const msg = state.streamMessage;
    if (!Array.isArray(msg.requests)) msg.requests = [];
    const index = Number.isInteger(round) ? round : 0;
    msg.requests[index] = body;
    saveChatsSoon();
  });

  api.onChatToolCall(({ requestId, name, arguments: args, round }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      kind: 'call',
      name: String(name || 'tool'),
      arguments: String(args ?? ''),
      round: Number.isInteger(round) ? round : 0,
    });
    saveChatsSoon();

    const session = currentSession();
    if (!session || !session.msgs.includes(state.streamMessage)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
  });

  api.onChatToolResult(({ requestId, name, output, ok, round }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      kind: 'result',
      name: String(name || 'tool'),
      output: String(output ?? ''),
      ok: ok !== false,
      round: Number.isInteger(round) ? round : 0,
    });
    saveChatsSoon();

    const session = currentSession();
    if (!session || !session.msgs.includes(state.streamMessage)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
  });

  api.onRunStarted(({ requestId }) => {
    if (!requestId || requestId === state.requestId) return;
    if (state.streaming) return;
    refreshChats();
  });

  api.onChatDone(({ requestId, text }) => {
    if (requestId !== state.requestId) {
      refreshChats();
      return;
    }
    if (state.streamMessage && typeof text === 'string') {
      state.streamMessage.text = text;
    }
    finishStream();
  });

  api.onChatError(({ requestId, error }) => {
    if (requestId !== state.requestId) {
      refreshChats();
      return;
    }
    if (state.streamMessage) {
      const msg = state.streamMessage;
      const note = `[request failed] ${error}`;
      if (msg.text.trim()) {
        msg.text += `\n\n${note}`;
      } else {
        msg.text = note;
      }
      if (Array.isArray(msg.steps) && msg.steps.length > 0) {
        msg.steps.push({ kind: 'text', text: note, round: 0 });
      }
      msg.request = null;

      const session = currentSession();
      if (session && session.msgs.includes(msg)) {
        state.openCardKey = autoCardKey();
        renderMessages();
      }
    }
    finishStream();
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(state.saveTimer);
    clearTimeout(state.settingsTimer);
    try {
      api.saveChatsSync(structurePayload());
    } catch (error) {
      console.error('save chats on close failed', error);
    }
    api.saveSettings(settingsPayload());
  });
}

async function boot() {
  try {
    const [settings, chats] = await Promise.all([
      api.loadSettings(),
      api.loadChats(),
    ]);
    state.settings = settings;
    state.projects = chats.projects || [];
    state.sessions = chats.sessions;
    state.current = chats.current;
    state.seq = chats.seq;
  } catch (error) {
    console.error('load failed', error);
    state.projects = [{ ...DEFAULT_PROJECT }];
    state.sessions = [
      {
        id: makeId(),
        title: 'Chat 1',
        system: DEFAULT_SYSTEM_PROMPT,
        projectId: DEFAULT_PROJECT.id,
        msgs: [],
      },
    ];
    state.current = 0;
    state.seq = 1;
  }

  // 兜底：旧文件缺 system 字段时补默认值
  state.sessions.forEach((session) => {
    if (typeof session.system !== 'string') {
      session.system = DEFAULT_SYSTEM_PROMPT;
    }
  });
  ensureProjects();

  bindEvents();
  applySettings();
  renderAll();
  updateSendState();
}

boot();
