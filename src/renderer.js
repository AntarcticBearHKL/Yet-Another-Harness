'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const DEFAULT_PROJECT = { id: 'project-default', name: 'Project 1' };
const NO_KEY_HINT =
  'No OpenCode Go API key yet. Hold Tab and open Settings to paste your key.';
// DeepSeek V4.1 Flash (OpenCode Go) context window.
const CONTEXT_WINDOW_TOKENS = 1_000_000;

const shell = window.yah || null;
const $ = (id) => document.getElementById(id);

const dom = {
  messages: $('messages'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  composerContext: $('composer-context'),
  composerBox: $('composer-box'),
  composerTokens: $('composer-tokens'),
  skillPopup: $('skill-popup'),
  skillArgsOverlay: $('skill-args-overlay'),
  skillArgsTitle: $('skill-args-title'),
  skillArgsDesc: $('skill-args-desc'),
  skillArgsFields: $('skill-args-fields'),
  skillArgsError: $('skill-args-error'),
  skillArgsCancel: $('skill-args-cancel'),
  skillArgsAttach: $('skill-args-attach'),
  switcher: $('switcher'),
  switcherList: $('switcher-list'),
  switcherSettings: $('switcher-settings'),
  projectList: $('project-list'),
  settingsOverlay: $('settings-overlay'),
  rawOverlay: $('raw-overlay'),
  renameOverlay: $('rename-overlay'),
  renameTitle: $('rename-title'),
  renameInput: $('rename-input'),
  renameCancel: $('rename-cancel'),
  renameSave: $('rename-save'),
  confirmOverlay: $('confirm-overlay'),
  confirmTitle: $('confirm-title'),
  confirmText: $('confirm-text'),
  confirmCancel: $('confirm-cancel'),
  confirmOk: $('confirm-ok'),
  rawBody: $('raw-body'),
  rawMeta: $('raw-meta'),
  apiKey: $('api-key'),
  apiKeyState: $('api-key-state'),
  pairingQr: $('pairing-qr'),
  pairingState: $('pairing-state'),
  pairingAddress: $('pairing-address'),
  pairingPassword: $('pairing-password'),
  ringMenu: $('ring-menu'),
  ringSvg: $('ring-svg'),
  catalog: $('catalog'),
  catalogCategories: $('catalog-categories'),
  catalogList: $('catalog-list'),
  catalogClose: $('catalog-close'),
  webContent: $('web-content'),
  webContentTitle: $('web-content-title'),
  webContentBody: $('web-content-body'),
  webContentClose: $('web-content-close'),
  mcpConfig: $('mcp-config'),
  mcpConfigSummary: $('mcp-config-summary'),
  mcpConfigGrid: $('mcp-config-grid'),
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
  collapsedProcessKeys: new Set(),
  viewMode: null,
  foldRestored: false,
  foldSessionId: null,
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
  catalogData: null,
  catalogRequest: 0,
  usage: {
    data: null,
    loading: false,
    error: '',
    fetchedAt: 0,
  },
  mcpServers: [],
  mcpServersLoading: false,
  mcpServersFetchedAt: 0,
  mcpConfigSessionId: null,
  skills: [],
  skillsLoading: false,
  skillsSessionId: null,
  skillsFetchedAt: 0,
  attachedSkills: [],
  skillArgsTarget: null,
  slashOpen: false,
  slashIndex: 0,
  slashSkills: [],
  slashDismissed: false,
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
  closeRingMenu();
  state.ringSuppress = false;
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
  closeRingMenu();
  state.ringSuppress = false;
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
  generateTitle: (payload) =>
    requestJson('/api/title', { method: 'POST', body: payload }),
  loadCatalog: () => requestJson('/api/catalog'),
  loadSkills: (sessionId, mcpDisabled = []) =>
    requestJson(
      `/api/skills?sessionId=${encodeURIComponent(
        sessionId
      )}&disabled=${encodeURIComponent(JSON.stringify(mcpDisabled))}`
    ),

  openContent: (payload) => openWebContent(payload),
  updateContent: (payload) => updateWebContent(payload),
  onContentInit: (callback) => shell?.onContentInit?.(callback) ?? (() => {}),
  onContentUpdate: (callback) =>
    shell?.onContentUpdate?.(callback) ?? (() => {}),

  onChatDelta: (callback) => subscribeEvent('assistant.delta', callback),
  onChatRequest: (callback) => subscribeEvent('request.body', callback),
  onChatUsage: (callback) => subscribeEvent('usage', callback),
  onChatTiming: (callback) => subscribeEvent('assistant.timing', callback),
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
let turnFlashTimer = 0;
let cardAnchorFrame = 0;
let toolTimer = 0;
let renameTarget = null;
let confirmAction = null;

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
      mcpDisabled: Array.isArray(session.mcpDisabled)
        ? session.mcpDisabled
        : [],
      foldState: session.foldState || null,
      pendingQueue: Array.isArray(session.pendingQueue)
        ? session.pendingQueue
        : [],
      msgs: [],
    })),
    current: state.current,
    seq: state.seq,
  };
}

function saveChatsNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  return api
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
  dom.input.placeholder = state.streaming
    ? '输入排队消息…'
    : '输入新对话…';
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

function stickStreamingText(card) {
  if (!card || !card.classList.contains('streaming')) return;
  const text = card.querySelector('.card-text');
  if (!text) return;
  text.scrollTop = text.scrollHeight;
}

function updateCardClip(card) {
  if (!card) return;
  const scroller = card.querySelector('.card-text, .json-view, .tool-text');
  if (!scroller) return;
  const clipped = scroller.scrollHeight > scroller.clientHeight + 1;
  scroller.classList.toggle('is-clipped', clipped);
  if (card.classList.contains('streaming')) stickStreamingText(card);
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

function viewModeOpenKeys(cards) {
  const keys = new Set();
  if (state.viewMode !== 'replies' && state.viewMode !== 'processes') {
    return keys;
  }
  for (const card of cards) {
    if (card.classList.contains('answer-card')) keys.add(card.dataset.cardKey);
  }
  return keys;
}

function setViewMode(mode) {
  // 再按一次同一个快捷键回到普通模式
  state.viewMode = state.viewMode === mode ? null : mode;
  state.openCardKey = null;
  state.foldRestored = true;
  state.foldSessionId = currentSession()?.id || state.foldSessionId;
  renderAll();
  persistFoldState();
}

function applyFoldState(session) {
  const fold = session?.foldState || null;
  state.foldSessionId = session?.id || null;
  state.viewMode = fold?.viewMode || null;
  state.collapsedProcessKeys = new Set(fold?.collapsedProcessKeys || []);
  state.openCardKey = fold?.openKey || null;
  state.foldRestored = Boolean(fold);
}

function captureFoldState() {
  return {
    openKey: state.viewMode ? null : state.openCardKey || null,
    collapsedProcessKeys: [...state.collapsedProcessKeys],
    viewMode: state.viewMode || null,
  };
}

function persistFoldState() {
  const session = currentSession();
  if (!session) return;
  if (state.foldSessionId && state.foldSessionId !== session.id) return;
  session.foldState = captureFoldState();
  saveChatsSoon();
}

function anchorCardTitle(element, targetTop, duration = 360) {
  cancelAnimationFrame(cardAnchorFrame);
  cardAnchorFrame = 0;
  if (!element || !element.isConnected) return;
  const started = performance.now();
  const step = (now) => {
    if (!element.isConnected) {
      cardAnchorFrame = 0;
      return;
    }
    const delta = element.getBoundingClientRect().top - targetTop;
    if (Math.abs(delta) > 0.5) {
      dom.messages.scrollTop += delta;
    }
    if (now - started < duration) {
      cardAnchorFrame = requestAnimationFrame(step);
    } else {
      cardAnchorFrame = 0;
    }
  };
  cardAnchorFrame = requestAnimationFrame(step);
}

function toggleCard(key) {
  const card = cardByKey(key);
  if (!card) return;
  if (card.classList.contains('always-open')) return;
  state.viewMode = null;
  state.foldRestored = true;
  state.foldSessionId = currentSession()?.id || state.foldSessionId;

  if (!card.classList.contains('collapsed')) {
    state.openCardKey = null;
    applyOpenKey(null);
    persistFoldState();
    return;
  }

  const head = card.querySelector('.card-head') || card;
  const anchorTop = head.getBoundingClientRect().top;
  state.openCardKey = key;
  applyOpenKey(key);
  anchorCardTitle(head, anchorTop);
  persistFoldState();
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

function compactTokens(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (number >= 1000) {
    return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(number);
}

function usageText(usage) {
  if (!usage) return '';
  return `${compactTokens(usage.hit)} / ${compactTokens(
    usage.miss
  )} / ${compactTokens(usage.output)}`;
}

function contextTokensForMessage(msg) {
  const usage = msg?.usage;
  if (!usage || typeof usage !== 'object') return 0;
  const rounds = usage.rounds;
  if (rounds && typeof rounds === 'object') {
    const roundKeys = Object.keys(rounds)
      .map((key) => Number(key))
      .filter((key) => Number.isInteger(key))
      .sort((a, b) => a - b);
    for (let i = roundKeys.length - 1; i >= 0; i -= 1) {
      const round = rounds[roundKeys[i]] || {};
      const prompt = Number(round.hit || 0) + Number(round.miss || 0);
      const output = Number(round.output || 0);
      if (prompt + output > 0) return prompt + output;
    }
  }
  const total =
    Number(usage.hit || 0) +
    Number(usage.miss || 0) +
    Number(usage.output || 0);
  return total > 0 ? total : 0;
}

function contextBadge(msg) {
  const tokens = contextTokensForMessage(msg);
  if (!tokens) return null;
  const percent = Math.min(100, (tokens / CONTEXT_WINDOW_TOKENS) * 100);
  const text =
    percent > 0 && percent < 0.1
      ? '<0.1%'
      : percent < 10
        ? `${percent.toFixed(1)}%`
        : `${Math.round(percent)}%`;
  const label = el('span', 'turn-context', text);
  label.setAttribute(
    'aria-label',
    `上下文 ${compactTokens(tokens)} / ${compactTokens(
      CONTEXT_WINDOW_TOKENS
    )} · ${text}`
  );
  return label;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function formatLatency(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatTps(tps) {
  const value = Number(tps);
  if (!Number.isFinite(value) || value < 0) return '';
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} tok/s`;
}

function formatLlmTiming(metrics, thinking) {
  if (!metrics) return '';
  const first = thinking
    ? metrics.firstThinkingMs
    : metrics.firstContentMs;
  const tps = thinking ? metrics.thinkingTps : metrics.outputTps;
  const parts = [];
  if (Number.isFinite(Number(first))) {
    parts.push(`首 token ${formatLatency(first)}`);
  }
  if (Number.isFinite(Number(tps))) {
    parts.push(formatTps(tps));
  }
  return parts.join(' · ');
}

function updateToolTimers() {
  const nodes = [
    ...document.querySelectorAll('.card-timing[data-started-at]'),
  ];
  if (nodes.length === 0) {
    clearInterval(toolTimer);
    toolTimer = 0;
    return;
  }
  const now = Date.now();
  for (const node of nodes) {
    const started = Number(node.dataset.startedAt) || 0;
    if (!started) continue;
    node.textContent = `运行中 ${formatDuration(now - started)}`;
  }
}

function startToolTimer() {
  if (toolTimer) return;
  toolTimer = setInterval(updateToolTimers, 100);
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
    const tail = el('div', 'card-tail');
    if (opts.timing) {
      const timingText =
        typeof opts.timing === 'string'
          ? opts.timing
          : opts.timing.text || '';
      const startedAt =
        typeof opts.timing === 'object' ? opts.timing.startedAt : null;
      if (timingText || startedAt) {
        const timing = el('span', 'card-timing', timingText);
        if (startedAt) {
          timing.dataset.startedAt = String(startedAt);
          startToolTimer();
        }
        tail.append(timing);
      }
    }
    if (opts.usage) {
      const usage = el('span', 'card-usage', usageText(opts.usage));
      usage.setAttribute(
        'aria-label',
        `输入命中 ${Number(opts.usage.hit) || 0} · 输入未命中 ${
          Number(opts.usage.miss) || 0
        } · 输出 ${Number(opts.usage.output) || 0}`
      );
      tail.append(usage);
    }
    if (opts.badge) {
      const badge = el(
        'span',
        `card-badge ${opts.badge.error ? 'error' : 'ok'}`
      );
      badge.append(el('span', 'card-badge-dot'));
      badge.append(el('span', 'card-badge-text', opts.badge.text));
      tail.append(badge);
    }
    if (tail.childElementCount > 0) head.append(tail);

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
  usage,
  timing,
}) {
  const { card, body } = makeCard({
    key,
    kind,
    title,
    meta,
    preview: previewLine(text),
    usage,
    timing,
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

function pairToolSteps(steps) {
  const resultForCall = new Map();
  const pairedResults = new Set();
  if (!Array.isArray(steps)) return { resultForCall, pairedResults };
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || step.kind !== 'call') continue;
    for (let j = i + 1; j < steps.length; j += 1) {
      const candidate = steps[j];
      if (!candidate || candidate.kind !== 'result') continue;
      if (pairedResults.has(j)) continue;
      if (candidate.round !== step.round) continue;
      if (candidate.name !== step.name) continue;
      resultForCall.set(i, j);
      pairedResults.add(j);
      break;
    }
  }
  return { resultForCall, pairedResults };
}

function lastRenderableStepIndex(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return -1;
  const { pairedResults } = pairToolSteps(steps);
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i]?.kind === 'result' && pairedResults.has(i)) continue;
    return i;
  }
  return steps.length - 1;
}

function combinedToolJson(name, callStep, resultStep) {
  const payload = { name };
  if (callStep) {
    payload.arguments =
      parseStructured(callStep.arguments) ?? String(callStep.arguments ?? '');
  }
  if (resultStep) {
    payload.ok = resultStep.ok !== false;
    payload.result =
      parseStructured(resultStep.output) ?? String(resultStep.output ?? '');
  }
  return payload;
}

function combinedToolText(name, callStep, resultStep) {
  const parts = [];
  if (callStep) {
    parts.push(`# ${name} · 调用参数\n${callStep.arguments || ''}`);
  }
  if (resultStep) {
    parts.push(`# ${name} · 返回结果\n${resultStep.output || ''}`);
  }
  return parts.join('\n\n');
}

function renderToolCard(callStep, resultStep, msg, key, options = {}) {
  const call = callStep && callStep.kind === 'call' ? callStep : null;
  const result =
    resultStep && resultStep.kind === 'result' ? resultStep : null;
  const live = options.live === true;
  const stepForInspect = call || result;
  const name = call?.name || result?.name || 'tool';
  const isMcp = String(name).startsWith('mcp__');
  const displayName = isMcp
    ? String(name)
        .slice(5)
        .split('__')
        .filter(Boolean)
        .join(' · ') || name
    : name;
  const callMetrics = call?.metrics || null;
  const resultMetrics = result?.metrics || null;
  const startedAt = Number.isFinite(Number(callMetrics?.startedAt))
    ? Number(callMetrics.startedAt)
    : null;
  const durationMs = Number.isFinite(Number(resultMetrics?.durationMs))
    ? Number(resultMetrics.durationMs)
    : null;
  const timing =
    durationMs !== null
      ? `耗时 ${formatDuration(durationMs)}`
      : live && startedAt
        ? {
            text: `运行中 ${formatDuration(Date.now() - startedAt)}`,
            startedAt,
          }
        : '';
  const argsRaw = call?.arguments ?? '';
  const resultRaw = result?.output ?? '';
  const argsStructured = parseStructured(argsRaw);
  const resultStructured = parseStructured(resultRaw);
  const running = Boolean(call && !result);
  const ok = result ? result.ok !== false : true;
  const title = isMcp
    ? call
      ? 'MCP 调用'
      : 'MCP 返回'
    : call
      ? '工具调用'
      : '工具返回';
  const previewRaw = result ? resultRaw : argsRaw;
  const previewStructured = result ? resultStructured : argsStructured;
  const preview = running
    ? `运行中… ${previewFromRaw(argsRaw, argsStructured)}`
    : previewFromRaw(previewRaw, previewStructured);
  const { card, body } = makeCard({
    key,
    kind: call ? 'tool-call' : 'tool-result',
    title,
    meta: displayName,
    preview,
    timing,
    badge: result
      ? { text: ok ? 'ok' : 'error', error: !ok }
      : null,
    onInspect: () => inspectStep(msg, stepForInspect),
    process: true,
    onFullContent: () =>
      openFullContent({
        key,
        title: `${title} · ${displayName}`,
        kind: 'tool',
        text: combinedToolText(displayName, call, result),
        json: combinedToolJson(displayName, call, result),
      }),
  });
  if (result && result.ok === false) card.classList.add('error');

  if (call) {
    body.append(el('div', 'tool-section-label', '调用参数'));
    if (argsStructured) {
      body.append(jsonView(argsStructured));
    } else {
      body.append(el('pre', 'tool-text', String(argsRaw ?? '')));
    }
  }
  if (result) {
    body.append(
      el(
        'div',
        'tool-section-label',
        result.ok === false ? '返回结果 · 错误' : '返回结果'
      )
    );
    if (resultStructured) {
      body.append(jsonView(resultStructured));
    } else {
      body.append(el('pre', 'tool-text', String(resultRaw ?? '')));
    }
  } else if (call) {
    body.append(el('div', 'tool-running', '等待工具返回…'));
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
    if (lastTextIndex >= 0) return stepCardKey(index, lastTextIndex);
    const lastStep = lastRenderableStepIndex(steps);
    return stepCardKey(index, lastStep >= 0 ? lastStep : steps.length - 1);
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
  if (steps.length > 0) {
    const lastStep = lastRenderableStepIndex(steps);
    return stepCardKey(index, lastStep >= 0 ? lastStep : steps.length - 1);
  }

  // 还没有第一个 token：展开空的回复卡片，显示等待光标
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
      title: '回复',
      meta: '',
      preview: previewLine(msg.text),
      usage: msg.usage,
      primary: true,
      minimalHead: false,
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
    if (streaming && !msg.text) {
      // 已发送但还没有第一个 token：展开回复卡片并显示闪烁光标
      body.append(el('div', 'card-text card-waiting'));
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
  const { resultForCall, pairedResults } = pairToolSteps(steps);

  const isVisibleProcessStep = (step, index) => {
    if (step.kind === 'status') return false;
    if (index === lastTextIndex) return false;
    if (step.kind === 'text' || step.kind === 'thinking') {
      return Boolean(step.text) || (streaming && index === steps.length - 1);
    }
    if (step.kind === 'call') return true;
    if (step.kind === 'result') return !pairedResults.has(index);
    return false;
  };

  const processCount = steps.reduce(
    (count, step, index) =>
      count + (isVisibleProcessStep(step, index) ? 1 : 0),
    0
  );
  const processErrorCount = steps.filter(
    (step) => step.kind === 'result' && step.ok === false
  ).length;

  let processBody = null;
  if (processCount > 0) {
    const processKey = `p:${msgIndex}`;
    const group = el('div', 'process-group');
    group.dataset.processKey = processKey;
    const modeCollapsed =
      state.viewMode === 'questions' || state.viewMode === 'replies'
        ? true
        : state.viewMode === 'processes'
          ? false
          : null;
    const collapsed =
      modeCollapsed === null
        ? state.collapsedProcessKeys.has(processKey)
        : modeCollapsed;
    if (collapsed) group.classList.add('collapsed');
    const head = el('button', 'process-group-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.append(el('span', 'process-group-dot'));
    head.append(el('span', 'process-group-label', '过程'));
    head.append(el('span', 'process-group-count', String(processCount)));
    if (processErrorCount > 0) {
      const errorChip = el('span', 'process-group-error');
      errorChip.append(el('span', 'process-group-error-dot'));
      errorChip.append(el('span', '', `${processErrorCount} error`));
      head.append(errorChip);
    }
    const chevron = el('span', 'process-group-chevron');
    chevron.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    head.append(chevron);
    head.addEventListener('click', () => {
      if (state.viewMode) {
        state.collapsedProcessKeys = new Set(
          [...dom.messages.querySelectorAll('.process-group.collapsed')]
            .map((item) => item.dataset.processKey)
            .filter(Boolean)
        );
      }
      state.viewMode = null;
      state.foldRestored = true;
      state.foldSessionId = currentSession()?.id || state.foldSessionId;
      const nextCollapsed = group.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      if (nextCollapsed) state.collapsedProcessKeys.add(processKey);
      else state.collapsedProcessKeys.delete(processKey);
      persistFoldState();
    });
    processBody = el('div', 'process-group-body');
    group.append(head, processBody);
    container.append(group);
  }

  const appendProcessStep = (step, index, target) => {
    if (step.kind === 'text' || step.kind === 'thinking') {
      const thinking = step.kind === 'thinking';
      const metrics = msg.usage?.rounds?.[step.round] || null;
      appendRow(
        textCard({
          key: stepCardKey(msgIndex, index),
          kind: thinking ? 'thinking' : 'agent',
          title: thinking ? '思考' : '过程',
          meta: '',
          text: step.text,
          usage: null,
          timing: formatLlmTiming(metrics, thinking),
          streaming: streaming && index === steps.length - 1,
          onInspect: () => inspectStep(msg, step),
          primary: false,
          minimalHead: false,
          process: true,
        }),
        { process: true },
        target
      );
      return;
    }
    if (step.kind === 'call') {
      const resultIndex = resultForCall.get(index);
      const resultStep =
        resultIndex === undefined ? null : steps[resultIndex];
      appendRow(
        renderToolCard(
          step,
          resultStep,
          msg,
          stepCardKey(msgIndex, index),
          { live: streaming && msg === state.streamMessage }
        ),
        { process: true },
        target
      );
      return;
    }
    if (step.kind === 'result') {
      if (pairedResults.has(index)) return;
      appendRow(
        renderToolCard(null, step, msg, stepCardKey(msgIndex, index)),
        { process: true },
        target
      );
    }
  };

  for (let i = 0; i < steps.length; i += 1) {
    if (!isVisibleProcessStep(steps[i], i)) continue;
    appendProcessStep(steps[i], i, processBody || container);
  }

  if (lastTextIndex >= 0) {
    const step = steps[lastTextIndex];
    if (step.text || (streaming && lastTextIndex === steps.length - 1)) {
      const metrics = msg.usage?.rounds?.[step.round] || null;
      appendRow(
        textCard({
          key: stepCardKey(msgIndex, lastTextIndex),
          kind: 'agent',
          title: '回复',
          meta: '',
          text: step.text,
          usage: msg.usage,
          timing: formatLlmTiming(metrics, false),
          streaming: streaming && lastTextIndex === steps.length - 1,
          onInspect: () => inspectStep(msg, step),
          primary: true,
          minimalHead: false,
          process: false,
        }),
        {},
        container
      );
    }
  }
}

function mcpBlockServerEnabled(session, server) {
  if (server.enabled === false) return false;
  return !(Array.isArray(session.mcpDisabled)
    ? session.mcpDisabled
    : []
  ).includes(server.id);
}

async function loadMcpServers(force = false) {
  if (state.mcpServersLoading) return;
  if (
    !force &&
    state.mcpServers.length &&
    Date.now() - state.mcpServersFetchedAt < 30_000
  ) {
    return;
  }
  state.mcpServersLoading = true;
  try {
    const data = await requestJson('/api/mcp/state');
    state.mcpServers = Array.isArray(data?.servers) ? data.servers : [];
    state.mcpServersFetchedAt = Date.now();
  } catch (error) {
    console.error('load MCP servers failed', error);
  } finally {
    state.mcpServersLoading = false;
    const session = currentSession();
    if (session) renderMcpSummary(session);
    if (state.composerOpen) renderComposerContext();
    if (state.mcpConfigSessionId) renderMcpConfig();
    if (state.composerOpen) void loadSkills(true);
  }
}

function mcpEnabledCount(session) {
  return state.mcpServers.filter((server) =>
    mcpBlockServerEnabled(session, server)
  ).length;
}

function mcpSummaryText(session) {
  const total = state.mcpServers.length;
  if (!total) return state.mcpServersLoading ? '加载中' : '0/0';
  return `${mcpEnabledCount(session)}/${total}`;
}

function buildMcpSummary(session, onClick) {
  const button = el('button', 'mcp-summary');
  button.type = 'button';
  button.setAttribute(
    'aria-label',
    `MCP ${mcpSummaryText(session)}，点击配置`
  );
  button.append(el('span', 'mcp-summary-dot'));
  button.append(el('span', 'mcp-summary-label', 'MCP'));
  button.append(el('span', 'mcp-summary-count', mcpSummaryText(session)));
  button.addEventListener('click', onClick);
  return button;
}

function renderMcpSummary(session, container = dom.messages) {
  if (!session || !container || session !== currentSession()) return;
  const existing = container.querySelector('.mcp-summary');
  const summary = buildMcpSummary(session, () => openMcpConfig(session.id));
  if (existing) existing.replaceWith(summary);
  else container.prepend(summary);
}

function openMcpConfig(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session || !dom.mcpConfig) return;
  state.mcpConfigSessionId = sessionId;
  dom.mcpConfig.classList.remove('hidden');
  dom.mcpConfig.setAttribute('aria-hidden', 'false');
  renderMcpConfig();
  void loadMcpServers(true);
}

function closeMcpConfig() {
  if (!dom.mcpConfig) return;
  state.mcpConfigSessionId = null;
  dom.mcpConfig.classList.add('hidden');
  dom.mcpConfig.setAttribute('aria-hidden', 'true');
}

function renderMcpConfig() {
  if (!dom.mcpConfigGrid) return;
  const session = state.sessions.find(
    (item) => item.id === state.mcpConfigSessionId
  );
  if (!session) {
    closeMcpConfig();
    return;
  }
  const total = state.mcpServers.length;
  dom.mcpConfigSummary.textContent = total
    ? `${mcpEnabledCount(session)}/${total} 开启`
    : state.mcpServersLoading
      ? '加载中…'
      : '没有 MCP 服务器';
  dom.mcpConfigGrid.replaceChildren();
  if (total === 0) {
    dom.mcpConfigGrid.append(
      el(
        'div',
        'mcp-config-empty',
        state.mcpServersLoading ? '正在加载 MCP 服务器…' : '还没有 MCP 服务器'
      )
    );
    return;
  }
  for (const server of state.mcpServers) {
    const enabled = mcpBlockServerEnabled(session, server);
    const button = el('button', 'mcp-server-button');
    button.type = 'button';
    button.classList.toggle('on', enabled);
    button.classList.toggle('off', !enabled);
    button.classList.toggle('disabled', server.enabled === false);
    button.disabled = server.enabled === false;
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const head = el('span', 'mcp-server-button-head');
    head.append(
      el(
        'span',
        `mcp-server-dot ${
          server.enabled === false ? 'disabled' : server.status || 'idle'
        }`
      )
    );
    head.append(el('span', 'mcp-server-name', server.name));
    head.append(
      el(
        'span',
        'mcp-server-state',
        server.enabled === false ? '已禁用' : enabled ? '开启' : '关闭'
      )
    );
    button.append(head);
    const meta = [
      String(server.transport || '').toUpperCase(),
      server.source === 'opencode' ? 'OpenCode' : '自定义',
      `${server.toolCount || 0} 工具`,
    ]
      .filter(Boolean)
      .join(' · ');
    button.append(el('span', 'mcp-server-meta', meta));
    if (server.enabled !== false) {
      button.addEventListener('click', () => {
        const disabled = new Set(
          Array.isArray(session.mcpDisabled) ? session.mcpDisabled : []
        );
        if (disabled.has(server.id)) disabled.delete(server.id);
        else disabled.add(server.id);
        session.mcpDisabled = [...disabled];
        void saveChatsNow().finally(() => void loadSkills(true));
        renderMcpConfig();
        renderMcpSummary(session);
        if (state.composerOpen) renderComposerContext();
      });
    }
    dom.mcpConfigGrid.append(button);
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
  if (session) renderMcpSummary(session, dom.messages);
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
    const badge = contextBadge(msg);
    if (badge) {
      currentTurn.querySelector('.turn-context')?.remove();
      currentTurn.classList.add('has-context');
      currentTurn.append(badge);
    }
  });

  let autoKey = null;
  if (state.viewMode) {
    autoKey = null;
  } else if (state.foldRestored) {
    autoKey = state.openCardKey;
  } else {
    autoKey = autoCardKey();
    state.openCardKey = autoKey;
  }
  const cards = [...dom.messages.querySelectorAll('.message-card')];
  const cardKeys = new Set(cards.map((card) => card.dataset.cardKey));
  if (state.foldRestored && autoKey && !cardKeys.has(autoKey)) {
    autoKey = autoCardKey();
    state.openCardKey = autoKey;
  }
  state.openCardKey = autoKey;

  const targetKeys = state.viewMode
    ? viewModeOpenKeys(cards)
    : openKeySet(autoKey);
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
        const latest = state.viewMode
          ? targetKeys
          : openKeySet(state.openCardKey);
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
    stickStreamingText(
      dom.messages.querySelector('.message-card.streaming')
    );
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
    row.dataset.projectId = item.id;
    if (item.id === project.id) row.classList.add('selected');
    row.append(el('span', 'project-name', item.name));
    row.addEventListener('click', () => selectProject(item.id));
    row.addEventListener('mouseenter', () => selectProject(item.id));
    dom.projectList.append(row);
  });

  const addProject = el('button', 'project-add', '+');
  addProject.type = 'button';
  addProject.setAttribute('aria-label', 'New project');
  addProject.addEventListener('click', newProject);
  dom.projectList.append(addProject);

  dom.switcherList.replaceChildren();
  if (sessions.length === 0) {
    state.switcherIndex = 0;
    dom.switcherList.append(
      el('div', 'switcher-empty', '还没有对话，按空格新建')
    );
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
    trash.setAttribute('aria-label', 'Delete chat');
    if (state.pendingDelete === localIndex) trash.classList.add('armed');
    trash.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20M9 6V4H15V6M6 6L7 20H17L18 6M10 10V17M14 10V17"/></svg>';

    card.dataset.index = String(localIndex);
    card.dataset.sessionId = session.id;
    card.addEventListener('click', () => selectSession(globalIndex));
    card.addEventListener('mouseenter', () => highlightSwitcher(localIndex));

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

function turnAtViewportTop(turns) {
  const containerTop = dom.messages.getBoundingClientRect().top + 48;
  let index = 0;
  for (let i = 0; i < turns.length; i += 1) {
    index = i;
    if (turns[i].getBoundingClientRect().bottom > containerTop) break;
  }
  return index;
}

function scrollTurnToTop(turn, offset = 48) {
  const container = dom.messages;
  const containerRect = container.getBoundingClientRect();
  const turnRect = turn.getBoundingClientRect();
  container.scrollTop += turnRect.top - containerRect.top - offset;
}

function flashTurnTitle(turn) {
  const prompt = turn.querySelector('.message-card.prompt-card');
  if (!prompt) return;
  prompt.classList.remove('turn-flash');
  void prompt.offsetWidth;
  prompt.classList.add('turn-flash');
  clearTimeout(turnFlashTimer);
  turnFlashTimer = setTimeout(() => {
    prompt.classList.remove('turn-flash');
  }, 950);
}

function navigateTurn(direction) {
  const turns = [...dom.messages.querySelectorAll('.turn')];
  if (turns.length === 0) return;
  const current = turnAtViewportTop(turns);
  const target = current + direction;
  if (target < 0 || target >= turns.length) return;
  scrollTurnToTop(turns[target]);
  flashTurnTitle(turns[target]);
}

function openComposer() {
  if (state.composerOpen || !currentSession()) return;
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (!dom.rawOverlay.classList.contains('hidden')) return;
  if (state.switcherOpen) return;
  if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) return;

  state.composerOpen = true;
  dom.composer.inert = false;
  dom.composer.setAttribute('aria-hidden', 'false');
  dom.composer.classList.add('open');
  dom.input.placeholder = state.streaming
    ? '输入排队消息…'
    : '输入新对话…';
  renderComposerContext();
  renderComposerSkills();
  void loadSkills(true);
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
  closeRingMenu();
  state.ringSuppress = false;
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

function openRename(kind, id) {
  let current = '';
  if (kind === 'project') {
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    current = project.name;
    dom.renameTitle.textContent = 'RENAME PROJECT';
  } else {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    current = session.title;
    dom.renameTitle.textContent = 'RENAME CHAT';
  }
  renameTarget = { kind, id };
  dom.renameInput.value = current;
  dom.renameOverlay.classList.remove('hidden');
  dom.renameOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    dom.renameInput.focus();
    dom.renameInput.select();
  });
}

function closeRename() {
  renameTarget = null;
  dom.renameOverlay.classList.add('hidden');
  dom.renameOverlay.setAttribute('aria-hidden', 'true');
}

function saveRename() {
  if (!renameTarget) {
    closeRename();
    return;
  }
  const value = dom.renameInput.value.trim();
  if (!value) {
    dom.renameInput.focus();
    return;
  }
  const { kind, id } = renameTarget;
  if (kind === 'project') {
    const project = state.projects.find((item) => item.id === id);
    if (project) project.name = value;
  } else {
    const session = state.sessions.find((item) => item.id === id);
    if (session) session.title = value;
  }
  saveChatsSoon();
  closeRename();
  if (state.switcherOpen) renderSwitcher();
}

function openConfirm({ title, text, action }) {
  dom.confirmTitle.textContent = title;
  dom.confirmText.textContent = text;
  confirmAction = action;
  dom.confirmOverlay.classList.remove('hidden');
  dom.confirmOverlay.setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
  confirmAction = null;
  dom.confirmOverlay.classList.add('hidden');
  dom.confirmOverlay.setAttribute('aria-hidden', 'true');
}

function runConfirm() {
  const action = confirmAction;
  closeConfirm();
  if (typeof action === 'function') action();
}

function confirmDeleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const count = state.sessions.filter(
    (session) => session.projectId === projectId
  ).length;
  openConfirm({
    title: 'DELETE PROJECT',
    text: `删除「${project.name}」${
      count ? `及其中 ${count} 个对话` : ''
    }？删除后不可恢复。`,
    action: () => deleteProject(projectId),
  });
}

function deleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const removedSessions = state.sessions.filter(
    (session) => session.projectId === projectId
  );
  const currentId = currentSession()?.id;
  state.projects = state.projects.filter((item) => item.id !== projectId);
  state.sessions = state.sessions.filter(
    (session) => session.projectId !== projectId
  );
  for (const session of removedSessions) {
    api
      .deleteSession(session.id)
      .catch((error) => console.error('delete session failed', error));
  }
  ensureProjects();
  const remaining = state.sessions.findIndex(
    (session) => session.id === currentId
  );
  state.current = remaining >= 0 ? remaining : 0;
  state.switcherProjectId = state.projects[0]?.id || null;
  state.switcherIndex = 0;
  state.pendingDelete = -1;
  applyFoldState(currentSession());
  resetComposerSkills();
  saveChatsSoon();
  renderAll();
}

function openMcpConfigForSession(sessionId) {
  const index = state.sessions.findIndex(
    (session) => session.id === sessionId
  );
  if (index < 0) return;
  selectSession(index);
  openMcpConfig(sessionId);
}

function highlightSwitcher(index) {
  if (!state.switcherOpen) return;
  const sessions = sessionsInProject(state.switcherProjectId);
  if (index < 0 || index >= sessions.length) return;
  state.switcherIndex = index;
  const cards = [...dom.switcherList.querySelectorAll('.switch-card')];
  cards.forEach((card, cardIndex) => {
    card.classList.toggle('selected', cardIndex === index);
  });
  const selected = cards[index];
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function moveSwitcher(delta) {
  const sessions = sessionsInProject(state.switcherProjectId);
  if (sessions.length === 0) return;
  highlightSwitcher(
    (state.switcherIndex + delta + sessions.length) % sessions.length
  );
}

function commitSwitcherSelection() {
  const sessions = sessionsInProject(state.switcherProjectId);
  const session = sessions[state.switcherIndex];
  if (!session) {
    closeSwitcher();
    return;
  }
  if (session === currentSession()) {
    closeSwitcher();
    return;
  }
  selectSession(state.sessions.indexOf(session));
}

function selectSession(index) {
  if (index < 0 || index >= state.sessions.length) return;
  state.current = index;
  applyFoldState(state.sessions[index]);
  resetComposerSkills();
  state.switcherProjectId = state.sessions[index].projectId;
  state.forceScroll = true;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  saveChatsSoon();
  closeSwitcher();
  renderAll();
  persistFoldState();
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
  if (state.composerOpen) {
    renderComposerContext();
    renderComposerSkills();
  }
  updateControls();
  connectChatEvents(currentSession()?.id || null);
}

function updateSendState() {
  dom.send.disabled =
    !currentSession() ||
    (dom.input.value.trim() === '' && state.attachedSkills.length === 0);
}

function syncDraftTitle() {
  if (!state.composerOpen) return;
  const session = currentSession();
  if (!session || session.msgs.length > 0) return;
  const draft = dom.input.value.replace(/\s+/g, ' ').trim();
  const title = draft ? draft.slice(0, 60) : '';
  if (session.title === title) return;
  session.title = title;
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();
}

function newSession(projectId) {
  ensureProjects();
  if (state.sessions.length === 0) state.seq = 0;
  state.seq += 1;
  const targetProjectId =
    state.projects.find((project) => project.id === projectId)?.id ||
    currentSession()?.projectId ||
    state.projects[0].id;
  const siblings = state.sessions.filter(
    (item) => item.projectId === targetProjectId
  );
  const previous = siblings[siblings.length - 1];
  const session = {
    id: makeId(),
    title: `Chat ${state.seq}`,
    system: DEFAULT_SYSTEM_PROMPT,
    projectId: targetProjectId,
    mcpDisabled: Array.isArray(previous?.mcpDisabled)
      ? [...previous.mcpDisabled]
      : [],
    foldState: null,
    pendingQueue: [],
    msgs: [],
  };
  state.sessions.push(session);
  state.current = state.sessions.length - 1;
  applyFoldState(session);
  resetComposerSkills();
  state.forceScroll = true;
  state.switcherProjectId = targetProjectId;
  dom.input.value = '';
  updateSendState();
  saveChatsSoon();
  renderAll();
  persistFoldState();
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
  applyFoldState(currentSession());
  resetComposerSkills();
  saveChatsSoon();
  renderAll();
}

async function requestSessionTitle(session, text) {
  try {
    const result = await api.generateTitle({ chatId: session.id, text });
    const title = String(result?.title || '').trim();
    if (!title) return;
    const current = state.sessions.find((item) => item.id === session.id);
    if (!current) return;
    current.title = title;
    saveChatsSoon();
    if (state.switcherOpen) renderSwitcher();
  } catch (error) {
    console.error('generate chat title failed', error);
  }
}

async function startPrompt(
  session,
  text,
  { clearInput = false, skills = [] } = {}
) {
  if (!session || !text) return;
  state.viewMode = null;
  state.foldRestored = false;
  state.foldSessionId = session.id;
  const firstMessage = session.msgs.length === 0;
  session.msgs.push({ role: 'User', text, request: null, steps: [] });
  const agent = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
  session.msgs.push(agent);

  state.streamMessage = agent;
  state.forceScroll = true;
  if (clearInput) dom.input.value = '';
  updateSendState();
  if (firstMessage) requestSessionTitle(session, text);

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
      skills,
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

async function sendMessage() {
  const session = currentSession();
  if (!session) return;
  const skills = state.attachedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    arguments: { ...(skill.arguments || {}) },
  }));
  const inputText = dom.input.value.trim();
  const text =
    inputText || (skills.length ? `/${skills[0].name}` : '');
  if (!text) return;

  if (
    state.streaming ||
    (Array.isArray(session.pendingQueue) && session.pendingQueue.length > 0)
  ) {
    if (!Array.isArray(session.pendingQueue)) session.pendingQueue = [];
    session.pendingQueue.push({ text, skills });
    dom.input.value = '';
    state.slashDismissed = false;
    clearAttachedSkills();
    updateSendState();
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    if (!state.streaming) processNextQueuedPrompt(session);
    return;
  }

  closeComposer();
  state.slashDismissed = false;
  clearAttachedSkills();
  await startPrompt(session, text, { clearInput: true, skills });
}

function queueActionButton(kind, label, svg, onClick) {
  const button = el('button', `queue-action ${kind}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = svg;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderQueueRow(session, item, index) {
  const text = typeof item === 'string' ? item : item?.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  const row = el('div', 'queue-row');
  row.draggable = true;

  const handle = el('span', 'queue-drag');
  handle.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg>';
  row.append(handle);
  row.append(el('span', 'queue-text', text));
  if (skills.length) {
    row.append(
      el(
        'span',
        'queue-skill-names',
        skills.map((skill) => skill.name).filter(Boolean).join(' · ')
      )
    );
  }

  const actions = el('div', 'queue-actions');
  actions.append(
    queueActionButton(
      'edit',
      '编辑排队消息',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
      () => editQueuedPrompt(session, index)
    ),
    queueActionButton(
      'send',
      '发送排队消息',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7z"/></svg>',
      () => sendQueuedPrompt(session, index)
    ),
    queueActionButton(
      'remove',
      '删除排队消息',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      () => removeQueuedPrompt(session, index)
    )
  );
  row.append(actions);

  row.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.queue-drag')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
  });
  row.addEventListener('dragover', (event) => {
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-before', 'drop-after');
  });
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.remove('drop-before', 'drop-after');
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(from)) return;
    let to = index + (after ? 1 : 0);
    if (from < to) to -= 1;
    moveQueuedPrompt(session, from, to);
  });
  return row;
}

function renderComposerQueue(session) {
  const box = el('div', 'composer-queue');
  const queue = Array.isArray(session.pendingQueue)
    ? session.pendingQueue
    : [];
  if (queue.length === 0) {
    box.append(el('div', 'composer-queue-empty', '暂无待处理消息'));
    return box;
  }
  queue.forEach((item, index) => {
    box.append(renderQueueRow(session, item, index));
  });
  return box;
}

function renderComposerContext() {
  if (!dom.composerContext) return;
  const session = currentSession();
  if (!session) {
    dom.composerContext.replaceChildren();
    return;
  }
  if (session.msgs.length === 0) {
    dom.composerContext.replaceChildren(
      buildMcpSummary(session, () => openMcpConfig(session.id))
    );
    return;
  }
  dom.composerContext.replaceChildren(renderComposerQueue(session));
}

function skillCategory(skill) {
  if (skill?.sourceKind === 'mcp') return skill.serverName || 'MCP';
  const category = String(skill?.category || '').trim();
  if (category) return category;
  return skill?.sourceKind === 'user' ? '系统' : '内置';
}

function skillSourceLabel(skill) {
  return skillCategory(skill);
}

function skillScore(skill, tokens) {
  const name = String(skill?.name || '').toLowerCase();
  const description = String(skill?.description || '').toLowerCase();
  const keywords = (Array.isArray(skill?.keywords) ? skill.keywords : [])
    .join(' ')
    .toLowerCase();
  const source =
    `${skill?.serverName || ''} ${skill?.source || ''}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (name.includes(token)) score += 5;
    if (keywords.includes(token)) score += 3;
    if (description.includes(token)) score += 1;
    if (source.includes(token)) score += 1;
  }
  return score;
}

function slashQuery() {
  const value = dom.input.value;
  if (!value.startsWith('/')) return null;
  return value.slice(1);
}

function filteredSlashSkills() {
  const query = slashQuery();
  if (query === null) return [];
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const available = state.skills.filter(
    (skill) => !state.attachedSkills.some((item) => item.id === skill.id)
  );
  if (tokens.length === 0) return available.slice(0, 8);
  return available
    .map((skill) => ({ skill, score: skillScore(skill, tokens) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.skill.name || '').localeCompare(String(b.skill.name || ''))
    )
    .slice(0, 8)
    .map((item) => item.skill);
}

async function loadSkills(force = false) {
  const session = currentSession();
  if (!session) {
    state.skills = [];
    state.skillsSessionId = null;
    renderComposerSkills();
    return;
  }
  if (state.skillsLoading) return;
  if (
    !force &&
    state.skillsSessionId === session.id &&
    Date.now() - state.skillsFetchedAt < 15_000
  ) {
    renderComposerSkills();
    return;
  }
  state.skillsLoading = true;
  renderComposerSkills();
  try {
    const data = await api.loadSkills(
      session.id,
      Array.isArray(session.mcpDisabled) ? session.mcpDisabled : []
    );
    if (currentSession()?.id !== session.id) return;
    state.skills = Array.isArray(data?.skills) ? data.skills : [];
    state.skillsSessionId = session.id;
    state.skillsFetchedAt = Date.now();
  } catch (error) {
    console.error('load skills failed', error);
    if (currentSession()?.id === session.id) state.skills = [];
  } finally {
    state.skillsLoading = false;
    if (currentSession()?.id === session.id) renderComposerSkills();
  }
}

function renderComposerSkills() {
  renderComposerTokens();
  renderSlashPopup();
}

function renderComposerTokens() {
  if (!dom.composerTokens) return;
  const attached = state.attachedSkills;
  dom.composerTokens.replaceChildren();
  dom.composerTokens.classList.toggle('hidden', attached.length === 0);
  dom.composerBox?.classList.toggle('skill-mode', attached.length > 0);
  attached.forEach((skill, index) => {
    const token = el('span', 'skill-token');
    token.append(el('span', 'skill-token-slash', '/'));
    token.append(el('span', 'skill-token-name', skill.name));
    token.append(el('span', 'skill-token-source', skillSourceLabel(skill)));
    const remove = el('button', 'skill-token-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除 Skill');
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeAttachedSkill(index);
    });
    token.append(remove);
    dom.composerTokens.append(token);
  });
}

function renderSlashPopup() {
  if (!dom.skillPopup) return;
  const query = state.composerOpen ? slashQuery() : null;
  if (query === null || state.slashDismissed) {
    state.slashOpen = false;
    state.slashSkills = [];
    state.slashIndex = 0;
    dom.skillPopup.classList.add('hidden');
    dom.skillPopup.replaceChildren();
    return;
  }
  const skills = filteredSlashSkills();
  state.slashOpen = true;
  state.slashSkills = skills;
  if (state.slashIndex >= skills.length) {
    state.slashIndex = Math.max(0, skills.length - 1);
  }
  dom.skillPopup.classList.remove('hidden');
  dom.skillPopup.replaceChildren();
  if (skills.length === 0) {
    dom.skillPopup.append(
      el(
        'div',
        'skill-popup-empty',
        state.skillsLoading ? '加载 Skill…' : '没有匹配的 Skill'
      )
    );
    return;
  }
  skills.forEach((skill, index) => {
    const item = el('button', 'skill-popup-item');
    item.type = 'button';
    if (index === state.slashIndex) item.classList.add('selected');
    item.append(el('span', 'skill-popup-name', skill.name || skill.id));
    item.append(el('span', 'skill-popup-source', skillSourceLabel(skill)));
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => chooseSlashSkill(skill));
    dom.skillPopup.append(item);
  });
}

function moveSlashSelection(delta) {
  if (!state.slashOpen || state.slashSkills.length === 0) return;
  const count = state.slashSkills.length;
  state.slashIndex = (state.slashIndex + delta + count) % count;
  renderSlashPopup();
}

function chooseSlashSkill(skill) {
  if (!skill) return;
  state.slashOpen = false;
  state.slashIndex = 0;
  state.slashDismissed = false;
  dom.input.value = '';
  updateSendState();
  selectSkill(skill);
  renderComposerSkills();
}

function selectSkill(skill) {
  if (!skill) return;
  const args = Array.isArray(skill.arguments) ? skill.arguments : [];
  if (args.length > 0) {
    openSkillArgs(skill);
    return;
  }
  attachSkill(skill, {});
}

function attachSkill(skill, args = {}) {
  if (!skill?.id) return;
  if (state.attachedSkills.some((item) => item.id === skill.id)) return;
  if (state.attachedSkills.length >= 5) return;
  state.attachedSkills.push({
    id: skill.id,
    name: skill.name || skill.id,
    source: skill.source || '',
    sourceKind: skill.sourceKind || '',
    serverName: skill.serverName || '',
    category: skill.category || '',
    arguments: { ...args },
  });
  renderComposerSkills();
  updateSendState();
  if (state.composerOpen) dom.input.focus();
}

function removeAttachedSkill(index) {
  if (index < 0 || index >= state.attachedSkills.length) return;
  state.attachedSkills.splice(index, 1);
  renderComposerSkills();
  updateSendState();
  if (state.composerOpen) dom.input.focus();
}

function clearAttachedSkills() {
  if (state.attachedSkills.length === 0) return;
  state.attachedSkills = [];
  renderComposerSkills();
  updateSendState();
}

function resetComposerSkills() {
  state.attachedSkills = [];
  state.skills = [];
  state.skillsSessionId = null;
  state.skillsFetchedAt = 0;
  state.slashOpen = false;
  state.slashIndex = 0;
  state.slashSkills = [];
  state.slashDismissed = false;
  renderComposerSkills();
  updateSendState();
}

function openSkillArgs(skill) {
  if (!skill || !dom.skillArgsOverlay) return;
  state.skillArgsTarget = { skill, values: {} };
  dom.skillArgsTitle.textContent = `SKILL · ${skill.name}`;
  dom.skillArgsDesc.textContent = skill.description || '';
  dom.skillArgsFields.replaceChildren();
  for (const argument of skill.arguments || []) {
    const field = el('label', 'skill-args-field');
    const label = el('span', 'skill-args-field-label', argument.name);
    if (argument.required) label.append(el('span', 'req', '*'));
    field.append(label);
    const input = el('input', 'text-input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = argument.description || '';
    input.addEventListener('input', () => {
      if (state.skillArgsTarget) {
        state.skillArgsTarget.values[argument.name] = input.value;
      }
    });
    field.append(input);
    if (argument.description) {
      field.append(el('span', 'skill-args-field-desc', argument.description));
    }
    dom.skillArgsFields.append(field);
  }
  dom.skillArgsError.textContent = '';
  dom.skillArgsError.classList.add('hidden');
  dom.skillArgsOverlay.classList.remove('hidden');
  dom.skillArgsOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    if (!state.skillArgsTarget) return;
    dom.skillArgsFields.querySelector('input')?.focus();
  });
}

function closeSkillArgs() {
  if (!dom.skillArgsOverlay) return;
  state.skillArgsTarget = null;
  dom.skillArgsOverlay.classList.add('hidden');
  dom.skillArgsOverlay.setAttribute('aria-hidden', 'true');
}

function attachSkillArgs() {
  const target = state.skillArgsTarget;
  if (!target) return;
  const values = {};
  for (const argument of target.skill.arguments || []) {
    const value = String(target.values[argument.name] ?? '').trim();
    if (argument.required && !value) {
      dom.skillArgsError.textContent = `请填写 ${argument.name}`;
      dom.skillArgsError.classList.remove('hidden');
      return;
    }
    if (value) values[argument.name] = value;
  }
  attachSkill(target.skill, values);
  closeSkillArgs();
}

function removeQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  session.pendingQueue.splice(index, 1);
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
}

function editQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  const [item] = session.pendingQueue.splice(index, 1);
  if (!item) return;
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  saveChatsSoon();
  if (!state.composerOpen) openComposer();
  state.attachedSkills = skills.map((skill) => {
    const known = state.skills.find((entry) => entry.id === skill.id);
    return {
      id: skill.id,
      name: skill.name || known?.name || skill.id,
      source: known?.source || '',
      sourceKind: known?.sourceKind || '',
      serverName: known?.serverName || '',
      category: known?.category || '',
      arguments: { ...(skill.arguments || {}) },
    };
  });
  dom.input.value = text;
  updateSendState();
  if (state.composerOpen) renderComposerContext();
  renderComposerSkills();
  requestAnimationFrame(() => {
    dom.input.focus();
    const end = dom.input.value.length;
    dom.input.setSelectionRange(end, end);
  });
}

function sendQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  const [item] = session.pendingQueue.splice(index, 1);
  if (!item) return;
  if (state.streaming) {
    session.pendingQueue.unshift(item);
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    return;
  }
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
  void startPrompt(session, text, { skills });
}

function moveQueuedPrompt(session, from, to) {
  if (!Array.isArray(session.pendingQueue)) return;
  if (from === to || from < 0 || from >= session.pendingQueue.length) return;
  const [item] = session.pendingQueue.splice(from, 1);
  if (!item) return;
  const target = Math.max(0, Math.min(to, session.pendingQueue.length));
  session.pendingQueue.splice(target, 0, item);
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
}

function processNextQueuedPrompt(session) {
  if (!session || state.streaming) return;
  if (
    !Array.isArray(session.pendingQueue) ||
    session.pendingQueue.length === 0
  ) {
    return;
  }
  if (session !== currentSession()) return;
  const item = session.pendingQueue.shift();
  if (!item) return;
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
  void startPrompt(session, text, { skills });
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
    applyFoldState(currentSession());
    renderAll();
  } catch (error) {
    console.error('refresh chats failed', error);
  }
}

function finishStream() {
  const finishedSession = state.streamMessage
    ? state.sessions.find((session) =>
        session.msgs.includes(state.streamMessage)
      )
    : currentSession();
  const stick = isNearBottom();
  state.streaming = false;
  state.requestId = null;
  state.streamMessage = null;
  state.forceScroll = false;

  dom.messages
    .querySelectorAll('.message-card.streaming')
    .forEach((card) => card.classList.remove('streaming'));
  dom.messages.querySelectorAll('.card-text').forEach((text) => {
    text.scrollTop = 0;
  });

  state.foldRestored = true;
  state.foldSessionId = currentSession()?.id || state.foldSessionId;
  if (state.viewMode) {
    renderMessages();
  } else {
    state.openCardKey = autoCardKey();
    applyOpenKey(state.openCardKey);
  }
  persistFoldState();

  updateSendState();
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();

  if (stick) {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }
  processNextQueuedPrompt(finishedSession);
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

async function loadPairing() {
  if (!dom.pairingQr) return;
  dom.pairingState.textContent = '加载中…';
  dom.pairingQr.removeAttribute('src');
  dom.pairingAddress.textContent = '—';
  dom.pairingPassword.textContent = '—';
  try {
    const data = await requestJson('/api/pairing');
    if (!data?.enabled || !data.qr) {
      dom.pairingState.textContent = '未开启';
      dom.pairingAddress.textContent = data?.host
        ? `${data.host}:${data.port}`
        : '没有可用的局域网地址';
      dom.pairingPassword.textContent = '设置 YAH_LAN=1 并重启后端';
      return;
    }
    dom.pairingQr.src = data.qr;
    dom.pairingState.textContent = '已开启';
    dom.pairingAddress.textContent = `${data.host}:${data.port}`;
    dom.pairingPassword.textContent = `密码 ${data.password}`;
  } catch (error) {
    dom.pairingState.textContent = '加载失败';
    dom.pairingAddress.textContent = error.message || String(error);
    dom.pairingPassword.textContent = '确认后端已启动';
  }
}

function openSettings() {
  closeComposer();
  applySettings();
  dom.settingsOverlay.classList.remove('hidden');
  void loadPairing();
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
  const isComposerScrim = Boolean(
    state.composerOpen &&
      target.closest('#composer') &&
      !target.closest('.composer-box')
  );
  const needsThreshold = isCardHead || isComposerScrim;
  suppressNextCardClick = false;
  windowDrag = {
    x: event.screenX,
    y: event.screenY,
    started: !needsThreshold,
    isCardHead,
    isComposerScrim,
  };
  dragFromComposer = Boolean(
    state.composerOpen && target.closest('#composer')
  );
  if (!needsThreshold) {
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
  const wasComposerScrim = windowDrag.isComposerScrim;
  const started = windowDrag.started;
  const refocusComposer =
    dragFromComposer && state.composerOpen && started;
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
  if (wasComposerScrim && !started) {
    closeComposer();
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
const RING_SELECT_RADIUS = RING_OUTER + 60;
const RING_USAGE_RADIUS = 225;
const RING_VISUAL_HALF_W = 170;
const RING_VISUAL_HALF_H = 330;

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
    action: () => openMcp(),
  },
];

const RING_ICONS = {
  rename:
    '<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>',
  trash:
    '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/>',
  mcp: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5"/>',
  minimize: '<path d="M4 12h16"/>',
  maximize: '<path d="M5 5h14v14H5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

let ringCenterPoint = { x: 0, y: 0 };
let ringSegments = [];
let ringLabels = [];
let ringUsagePanel = null;
let ringUsageRows = [];
let ringItems = RING_ITEMS;

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

function formatUsageReset(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `${time} 重置`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time} 重置`;
}

function usageErrorText(error) {
  if (!error) return '暂无数据';
  const text = String(error);
  if (text === 'no_api_key') return '未设置 API key';
  if (text.startsWith('HTTP 401') || text.startsWith('HTTP 403')) {
    return 'API key 无效';
  }
  return '获取失败';
}

function renderUsageCards() {
  if (!ringUsageRows.length) return;
  const data = state.usage.data;
  const loading = state.usage.loading;
  const error = state.usage.error;
  if (ringUsagePanel) {
    ringUsagePanel.classList.toggle('loading', loading && !data);
  }
  for (const entry of ringUsageRows) {
    const meter = data ? data[entry.key] : null;
    entry.row.classList.toggle('limited', Boolean(meter?.limited));
    if (meter) {
      const percent = Math.max(
        0,
        Math.min(100, Number(meter.percent) || 0)
      );
      entry.percent.textContent = `${Math.round(percent)}%`;
      entry.fill.style.width = `${percent}%`;
      entry.reset.textContent = meter.limited
        ? `已限流 · ${formatUsageReset(meter.resetsAt)}`
        : formatUsageReset(meter.resetsAt);
    } else {
      entry.percent.textContent = loading ? '…' : '—';
      entry.fill.style.width = '0%';
      entry.reset.textContent = loading ? '加载中…' : usageErrorText(error);
    }
  }
}

async function loadUsage(force = false) {
  const now = Date.now();
  if (state.usage.loading) return;
  if (
    !force &&
    state.usage.data &&
    now - state.usage.fetchedAt < 60_000
  ) {
    renderUsageCards();
    return;
  }
  state.usage.loading = true;
  state.usage.error = '';
  renderUsageCards();
  try {
    const data = await requestJson('/api/usage');
    if (data?.ok) {
      state.usage.data = data.usage;
      state.usage.fetchedAt = Date.now();
      state.usage.error = '';
    } else if (!state.usage.data) {
      state.usage.error = data?.error || 'usage_unavailable';
    }
  } catch (error) {
    if (!state.usage.data) {
      state.usage.error = error.message || 'usage_unavailable';
    }
  } finally {
    state.usage.loading = false;
    renderUsageCards();
  }
}

function buildRingMenu(items = RING_ITEMS, options = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  dom.ringSvg.replaceChildren();
  for (const label of ringLabels) label.remove();
  ringSegments = [];
  ringLabels = [];
  dom.ringMenu.querySelectorAll('.ring-usage-layer').forEach((node) => node.remove());
  ringUsagePanel = null;
  ringUsageRows = [];

  const step = 360 / items.length;
  items.forEach((item, index) => {
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

  if (options.usage === false) return;

  const usageLayer = el('div', 'ring-usage-layer');
  const panel = el('div', 'ring-usage-panel');
  const panelPoint = ringPolar(RING_USAGE_RADIUS, -90);
  panel.style.left = `${panelPoint.x}px`;
  panel.style.top = `${panelPoint.y}px`;
  panel.append(el('div', 'ring-usage-title', 'usage'));
  const usageItems = [
    { key: 'rolling', label: '5 小时' },
    { key: 'weekly', label: '本周' },
    { key: 'monthly', label: '本月' },
  ];
  ringUsageRows = [];
  for (const item of usageItems) {
    const row = el('div', 'ring-usage-row');
    const head = el('div', 'ring-usage-head');
    head.append(el('span', 'ring-usage-label', item.label));
    const percent = el('span', 'ring-usage-percent', '—');
    head.append(percent);
    const bar = el('div', 'ring-usage-bar');
    const fill = el('div', 'ring-usage-bar-fill');
    bar.append(fill);
    const reset = el('div', 'ring-usage-reset', '加载中…');
    row.append(head, bar, reset);
    panel.append(row);
    ringUsageRows.push({
      key: item.key,
      row,
      percent,
      fill,
      reset,
    });
  }
  usageLayer.append(panel);
  dom.ringMenu.append(usageLayer);
  ringUsagePanel = panel;
  renderUsageCards();
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
  const distance = Math.hypot(dx, dy);
  if (distance < RING_DEAD_ZONE || distance > RING_SELECT_RADIUS) return -1;

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const step = 360 / ringItems.length;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < ringItems.length; i += 1) {
    const midAngle = -90 + i * step;
    const diff = Math.abs((((angle - midAngle) % 360) + 540) % 360 - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function openRingMenu(x, y, items = RING_ITEMS, options = {}) {
  if (state.ringOpen) closeRingMenu();

  ringItems = items;
  buildRingMenu(items, options);

  const halfW = options.usage === false ? 170 : RING_VISUAL_HALF_W;
  const halfH = options.usage === false ? 170 : RING_VISUAL_HALF_H;
  const margin = 6;
  const cx = Math.min(
    window.innerWidth - halfW - margin,
    Math.max(halfW + margin, x)
  );
  const cy = Math.min(
    window.innerHeight - halfH - margin,
    Math.max(halfH + margin, y)
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
  if (options.usage !== false) void loadUsage();
}

function closeRingMenu() {
  if (!state.ringOpen) return;
  state.ringOpen = false;
  ringItems = RING_ITEMS;
  updateRingSelection(-1);
  document.body.classList.remove('ring-open');
  dom.ringMenu.classList.remove('open');
  dom.ringMenu.setAttribute('aria-hidden', 'true');
}

function updateRingFromPointer(event) {
  if (!state.ringOpen) return;
  updateRingSelection(ringIndexForPoint(event.clientX, event.clientY));
}

function openSwitcherRingMenu(event) {
  const target = event.target instanceof Element ? event.target : null;
  const projectRow = target?.closest('.project-row');
  if (projectRow?.dataset.projectId) {
    const projectId = projectRow.dataset.projectId;
    if (!state.projects.some((project) => project.id === projectId)) return;
    openRingMenu(
      event.clientX,
      event.clientY,
      [
        {
          label: '改名',
          icon: RING_ICONS.rename,
          action: () => openRename('project', projectId),
        },
        {
          label: '删除',
          icon: RING_ICONS.trash,
          action: () => confirmDeleteProject(projectId),
        },
      ],
      { usage: false }
    );
    return;
  }

  const card = target?.closest('.switch-card');
  if (card?.dataset.sessionId) {
    const sessionId = card.dataset.sessionId;
    if (!state.sessions.some((session) => session.id === sessionId)) return;
    openRingMenu(
      event.clientX,
      event.clientY,
      [
        {
          label: '改名',
          icon: RING_ICONS.rename,
          action: () => openRename('session', sessionId),
        },
        {
          label: '配置 MCP',
          icon: RING_ICONS.mcp,
          action: () => openMcpConfigForSession(sessionId),
        },
      ],
      { usage: false }
    );
    return;
  }

  if (!api.isElectron) return;
  openRingMenu(
    event.clientX,
    event.clientY,
    [
      {
        label: '最小化',
        icon: RING_ICONS.minimize,
        action: () => api.minimize(),
      },
      {
        label: '最大化',
        icon: RING_ICONS.maximize,
        action: () => api.maximize(),
      },
      {
        label: '关闭',
        icon: RING_ICONS.close,
        action: () => api.close(),
      },
    ],
    { usage: false }
  );
}

function onRightMouseDown(event) {
  if (event.button !== 2) return;

  const switcherOpen =
    state.switcherOpen || dom.switcher.classList.contains('open');

  if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) {
    closeRingMenu();
    closeMcpConfig();
    state.ringSuppress = true;
    return;
  }
  if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
    closeRingMenu();
    closeWebContent();
    state.ringSuppress = true;
    return;
  }
  if (state.ringOpen) {
    closeRingMenu();
    if (!switcherOpen) {
      state.ringSuppress = true;
      return;
    }
  }
  if (!dom.renameOverlay.classList.contains('hidden')) {
    closeRename();
    state.ringSuppress = true;
    return;
  }
  if (!dom.confirmOverlay.classList.contains('hidden')) {
    closeConfirm();
    state.ringSuppress = true;
    return;
  }
  if (dom.skillArgsOverlay && !dom.skillArgsOverlay.classList.contains('hidden')) {
    closeSkillArgs();
    state.ringSuppress = true;
    return;
  }
  if (window.mcpOverlayOpen?.()) {
    window.closeMcp?.();
    state.ringSuppress = true;
    return;
  }
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
  if (switcherOpen) {
    openSwitcherRingMenu(event);
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
  const item = index >= 0 ? ringItems[index] : null;
  closeRingMenu();
  if (!item || typeof item.action !== 'function') return;
  requestAnimationFrame(() => item.action());
}

const CATALOG_EMPTY = {
  tools: '还没有可用工具。',
  skills: '还没有安装 Skill。',
  mcp: '还没有连接 MCP。',
};
const TOOL_GROUPS = [
  {
    id: 'search',
    label: '搜索',
    pattern: /search|web|browse|fetch|http|url/i,
  },
  {
    id: 'file',
    label: '文件',
    pattern: /file|read|write|edit|list|glob|grep|directory|path|patch/i,
  },
  {
    id: 'system',
    label: '系统',
    pattern: /shell|exec|command|process|terminal|system|bash|background|monitor/i,
  },
  {
    id: 'agent',
    label: '代理',
    pattern: /agent|task|subagent|skill|mcp|team|goal|question|model|worktree|look_at/i,
  },
  {
    id: 'session',
    label: '会话',
    pattern: /session/i,
  },
];

const TOOL_GROUP_BY_NAME = new Map([
  ['read', 'file'],
  ['read_file', 'file'],
  ['write', 'file'],
  ['edit', 'file'],
  ['hashline_edit', 'file'],
  ['glob', 'file'],
  ['grep', 'file'],
  ['patch', 'file'],
  ['websearch', 'search'],
  ['web_search', 'search'],
  ['webfetch', 'search'],
  ['shell', 'system'],
  ['interactive_bash', 'system'],
  ['background_output', 'system'],
  ['background_cancel', 'system'],
  ['monitor_start', 'system'],
  ['monitor_stop', 'system'],
  ['monitor_list', 'system'],
  ['monitor_output', 'system'],
  ['skill', 'agent'],
  ['skill_mcp', 'agent'],
  ['task', 'agent'],
  ['subagent', 'agent'],
  ['call_omo_agent', 'agent'],
  ['delegate_task', 'agent'],
  ['task_create', 'agent'],
  ['task_get', 'agent'],
  ['task_list', 'agent'],
  ['task_update', 'agent'],
  ['team_list', 'agent'],
  ['team_task_list', 'agent'],
  ['look_at', 'agent'],
  ['question', 'agent'],
  ['models', 'agent'],
  ['worktree_list', 'agent'],
  ['worktree_create', 'agent'],
  ['worktree_remove', 'agent'],
  ['list_mcp_resources', 'agent'],
  ['read_mcp_resource', 'agent'],
  ['session_list', 'session'],
  ['session_read', 'session'],
  ['session_search', 'session'],
  ['session_info', 'session'],
  ['session_rename', 'session'],
]);

function toolGroupFor(fn) {
  const name = String(fn?.name || '');
  const description = String(fn?.description || '');
  const explicit = TOOL_GROUP_BY_NAME.get(name);
  if (explicit) {
    return TOOL_GROUPS.find((group) => group.id === explicit);
  }
  return (
    TOOL_GROUPS.find((group) => group.pattern.test(name)) ||
    TOOL_GROUPS.find((group) => group.pattern.test(description)) || {
      id: 'other',
      label: '其他',
    }
  );
}

function toolCountsByGroup(tools) {
  const counts = new Map();
  if (!Array.isArray(tools)) return counts;
  for (const entry of tools) {
    const fn = entry.function || entry;
    const group = toolGroupFor(fn);
    counts.set(group.id, (counts.get(group.id) || 0) + 1);
  }
  return counts;
}

function skillCatalogGroups(data) {
  const locals = [];
  const servers = [];
  const localMap = new Map();
  const serverMap = new Map();
  for (const skill of Array.isArray(data?.skills) ? data.skills : []) {
    if (skill.sourceKind === 'mcp') {
      const key = String(skill.serverId || skill.serverName || 'MCP');
      if (!serverMap.has(key)) {
        const entry = {
          id: `server:${key}`,
          label: skill.serverName || 'MCP',
          count: 0,
        };
        serverMap.set(key, entry);
        servers.push(entry);
      }
      serverMap.get(key).count += 1;
    } else {
      const category = skillCategory(skill);
      if (!localMap.has(category)) {
        const entry = { id: `local:${category}`, label: category, count: 0 };
        localMap.set(category, entry);
        locals.push(entry);
      }
      localMap.get(category).count += 1;
    }
  }
  return { locals, servers };
}

function ensureCatalogSelection(data, page) {
  if (page === 'skills') {
    const { locals, servers } = skillCatalogGroups(data);
    const all = [...locals, ...servers];
    if (!all.some((item) => item.id === state.catalogKind)) {
      state.catalogKind = all[0]?.id || 'local:内置';
    }
    return;
  }
  if (!state.catalogKind?.startsWith('tool:')) return;
  const counts = toolCountsByGroup(data?.tools);
  const groupId = state.catalogKind.slice(5);
  if ((counts.get(groupId) || 0) > 0) return;
  const first = TOOL_GROUPS.find((group) => (counts.get(group.id) || 0) > 0);
  state.catalogKind = first ? `tool:${first.id}` : 'tool:other';
}

function closeCatalog() {
  if (!state.catalogOpen) return;
  state.catalogOpen = false;
  state.catalogKind = null;
  state.catalogData = null;
  state.catalogRequest += 1;
  dom.catalog.classList.add('hidden');
  dom.catalog.setAttribute('aria-hidden', 'true');
}

function catalogCategoryButton(item, selectedKind) {
  const button = el('button', 'catalog-category');
  button.type = 'button';
  button.dataset.kind = item.id;
  if (item.id === selectedKind) button.classList.add('selected');
  button.append(el('span', 'catalog-category-name', item.label));
  button.append(el('span', 'catalog-category-count', String(item.count)));
  button.addEventListener('click', () => selectCatalogKind(item.id));
  return button;
}

function renderCatalogCategories(data, selectedKind, page) {
  dom.catalogCategories.replaceChildren();

  if (page === 'skills') {
    const { locals, servers } = skillCatalogGroups(data);
    const localSection = el('div', 'catalog-section');
    localSection.append(el('div', 'catalog-section-label', 'Skill'));
    if (locals.length === 0) {
      localSection.append(
        catalogCategoryButton(
          { id: 'local:内置', label: '内置', count: 0 },
          selectedKind
        )
      );
    } else {
      for (const item of locals) {
        localSection.append(catalogCategoryButton(item, selectedKind));
      }
    }
    dom.catalogCategories.append(localSection);
    if (servers.length > 0) {
      const serverSection = el('div', 'catalog-section');
      serverSection.append(el('div', 'catalog-section-label', 'MCP'));
      for (const item of servers) {
        serverSection.append(catalogCategoryButton(item, selectedKind));
      }
      dom.catalogCategories.append(serverSection);
    }
    return;
  }

  let items;
  if (page === 'tools') {
    const toolCounts = toolCountsByGroup(data?.tools);
    items = TOOL_GROUPS.map((group) => ({
      id: `tool:${group.id}`,
      label: group.label,
      count: toolCounts.get(group.id) || 0,
    })).filter((item) => item.count > 0);
    const otherCount = toolCounts.get('other') || 0;
    if (otherCount > 0) {
      items.push({ id: 'tool:other', label: '其他', count: otherCount });
    }
    if (items.length === 0) {
      items.push({ id: 'tool:other', label: '其他', count: 0 });
    }
  } else {
    items = [
      {
        id: 'mcp',
        label: 'MCP',
        count: Array.isArray(data?.mcp) ? data.mcp.length : 0,
      },
    ];
  }

  const wrapper = el('div', 'catalog-section');
  for (const item of items) {
    wrapper.append(catalogCategoryButton(item, selectedKind));
  }
  dom.catalogCategories.append(wrapper);
}

function selectCatalogKind(kind) {
  if (!state.catalogOpen || state.catalogKind === kind) return;
  state.catalogKind = kind;
  for (const button of dom.catalogCategories.querySelectorAll(
    '.catalog-category'
  )) {
    button.classList.toggle('selected', button.dataset.kind === kind);
  }
  renderCatalogContent(kind);
  dom.catalogList.scrollTop = 0;
}

function renderCatalogToolItem(entry) {
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
  return item;
}

function appendCatalogGroup(label, entries, renderItem) {
  const section = el('div', 'catalog-group');
  const head = el('div', 'catalog-group-head');
  head.append(el('span', 'catalog-group-name', label));
  head.append(el('span', 'catalog-group-count', String(entries.length)));
  section.append(head);
  for (const entry of entries) section.append(renderItem(entry));
  dom.catalogList.append(section);
}

function renderCatalogToolGroup(groupId) {
  const tools = (state.catalogData?.tools || []).filter((entry) => {
    const fn = entry.function || entry;
    return toolGroupFor(fn).id === groupId;
  });
  if (tools.length === 0) {
    dom.catalogList.append(el('div', 'catalog-empty', CATALOG_EMPTY.tools));
    return;
  }
  for (const entry of tools) {
    dom.catalogList.append(renderCatalogToolItem(entry));
  }
}

function renderCatalogEntryItem(kind, entry) {
  const item = el('div', 'catalog-item');
  item.append(el('div', 'catalog-name', entry.name || kind));
  if (entry.description) {
    item.append(el('div', 'catalog-desc', entry.description));
  }
  const meta =
    kind === 'skills'
      ? [
          skillCategory(entry),
          entry.sourceKind === 'mcp' ? 'MCP' : '',
          Array.isArray(entry.arguments) && entry.arguments.length
            ? `${entry.arguments.length} 个参数`
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : [entry.source, entry.transport, entry.status]
          .filter(Boolean)
          .join(' · ');
  if (meta) item.append(el('div', 'catalog-meta', meta));
  return item;
}

function renderCatalogList(kind, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    dom.catalogList.append(
      el('div', 'catalog-empty', CATALOG_EMPTY[kind] || '还没有内容。')
    );
    return;
  }

  if (kind === 'skills') {
    for (const entry of entries) {
      dom.catalogList.append(renderCatalogEntryItem(kind, entry));
    }
    return;
  }

  const groups = new Map();
  for (const entry of entries) {
    const label = entry.transport || entry.status || '全部';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  }
  const showHeadings = groups.size > 1 || !groups.has('全部');
  for (const [label, groupEntries] of groups) {
    if (!showHeadings) {
      for (const entry of groupEntries) {
        dom.catalogList.append(renderCatalogEntryItem(kind, entry));
      }
      continue;
    }
    appendCatalogGroup(label, groupEntries, (entry) =>
      renderCatalogEntryItem(kind, entry)
    );
  }
}

function renderCatalogContent(kind) {
  dom.catalogList.replaceChildren();
  if (kind?.startsWith('tool:')) {
    renderCatalogToolGroup(kind.slice(5));
    return;
  }
  if (kind?.startsWith('local:')) {
    const category = kind.slice('local:'.length);
    const entries = (state.catalogData?.skills || []).filter(
      (skill) =>
        skill.sourceKind !== 'mcp' && skillCategory(skill) === category
    );
    renderCatalogList('skills', entries);
    return;
  }
  if (kind?.startsWith('server:')) {
    const key = kind.slice('server:'.length);
    const entries = (state.catalogData?.skills || []).filter(
      (skill) =>
        skill.sourceKind === 'mcp' &&
        String(skill.serverId || skill.serverName || 'MCP') === key
    );
    renderCatalogList('skills', entries);
    return;
  }
  renderCatalogList(
    kind,
    kind === 'skills' ? state.catalogData?.skills : state.catalogData?.mcp
  );
}

async function openCatalog(kind) {
  closeRingMenu();
  const page = kind === 'skills' || kind === 'mcp' ? kind : 'tools';
  dom.catalog.setAttribute(
    'aria-label',
    page === 'skills' ? 'Skill' : page === 'mcp' ? 'MCP' : '工具'
  );
  state.catalogOpen = true;
  state.catalogKind =
    page === 'tools' ? 'tool:search' : page === 'skills' ? 'local:内置' : 'mcp';
  state.catalogData = null;
  const request = ++state.catalogRequest;
  dom.catalog.classList.remove('single');
  dom.catalogCategories.replaceChildren();
  dom.catalogList.replaceChildren(
    el('div', 'catalog-empty', '加载中…')
  );
  dom.catalog.classList.remove('hidden');
  dom.catalog.setAttribute('aria-hidden', 'false');

  try {
    const data = await api.loadCatalog();
    if (!state.catalogOpen || request !== state.catalogRequest) return;
    state.catalogData = data;
    ensureCatalogSelection(data, page);
    renderCatalogCategories(data, state.catalogKind, page);
    renderCatalogContent(state.catalogKind);
  } catch (error) {
    console.error('load catalog failed', error);
    if (!state.catalogOpen || request !== state.catalogRequest) return;
    dom.catalogCategories.replaceChildren();
    dom.catalogList.replaceChildren(
      el('div', 'catalog-empty', '加载失败。')
    );
  }
}

function bindEvents() {
  buildRingMenu();

  // 禁止原生 hover tooltip：进入元素时清掉残留的 title
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

  // 整体禁用鼠标右键菜单与框选；有弹窗时右键等于关闭
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (state.ringSuppress) {
      state.ringSuppress = false;
      return;
    }
    if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) {
      closeRingMenu();
      closeMcpConfig();
      return;
    }
    if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
      closeRingMenu();
      closeWebContent();
      return;
    }
    if (state.ringOpen) return;
    if (!dom.renameOverlay.classList.contains('hidden')) {
      closeRename();
      return;
    }
    if (!dom.confirmOverlay.classList.contains('hidden')) {
      closeConfirm();
      return;
    }
    if (dom.skillArgsOverlay && !dom.skillArgsOverlay.classList.contains('hidden')) {
      closeSkillArgs();
      return;
    }
    if (window.mcpOverlayOpen?.()) {
      window.closeMcp?.();
      return;
    }
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
    if (state.switcherOpen || dom.switcher.classList.contains('open')) {
      return;
    }
    if (state.composerOpen) closeComposer();
  }, true);
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

  document.addEventListener('mousedown', onRightMouseDown, true);
  document.addEventListener('mousemove', updateRingFromPointer);
  document.addEventListener('mouseup', onRightMouseUp, true);
  window.addEventListener('blur', closeRingMenu);

  dom.switcherSettings.addEventListener('click', () => {
    closeSwitcher();
    openSettings();
  });

  $('close-settings')?.addEventListener('click', closeSettings);
  $('done-settings').addEventListener('click', closeSettings);
  $('close-raw')?.addEventListener('click', closeRawRequest);
  dom.catalogClose?.addEventListener('click', closeCatalog);
  dom.webContentClose?.addEventListener('click', closeWebContent);

  dom.renameCancel.addEventListener('click', closeRename);
  dom.renameSave.addEventListener('click', saveRename);
  dom.renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRename();
    }
  });
  dom.renameOverlay.addEventListener('click', (event) => {
    if (event.target === dom.renameOverlay) closeRename();
  });
  dom.confirmCancel.addEventListener('click', closeConfirm);
  dom.confirmOk.addEventListener('click', runConfirm);
  dom.confirmOverlay.addEventListener('click', (event) => {
    if (event.target === dom.confirmOverlay) closeConfirm();
  });
  dom.rawOverlay.addEventListener('click', (event) => {
    if (event.target === dom.rawOverlay) closeRawRequest();
  });
  dom.mcpConfig?.addEventListener('click', (event) => {
    if (event.target === dom.mcpConfig) closeMcpConfig();
  });
  dom.skillArgsCancel?.addEventListener('click', closeSkillArgs);
  dom.skillArgsAttach?.addEventListener('click', attachSkillArgs);
  dom.skillArgsOverlay?.addEventListener('click', (event) => {
    if (event.target === dom.skillArgsOverlay) closeSkillArgs();
  });

  $('mobile-compose')?.addEventListener('click', openComposer);
  dom.send.addEventListener('click', sendMessage);
  dom.input.addEventListener('input', () => {
    state.slashDismissed = false;
    state.slashIndex = 0;
    updateSendState();
    syncDraftTitle();
    renderComposerSkills();
  });
  dom.input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (state.slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashSelection(-1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        if (state.slashSkills.length > 0) {
          event.preventDefault();
          chooseSlashSkill(state.slashSkills[state.slashIndex]);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        state.slashDismissed = true;
        renderSlashPopup();
        return;
      }
    }
    if (
      event.key === 'Backspace' &&
      dom.input.value === '' &&
      state.attachedSkills.length > 0
    ) {
      event.preventDefault();
      removeAttachedSkill(state.attachedSkills.length - 1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  $('win-min')?.addEventListener('click', () => api.minimize());
  $('win-max')?.addEventListener('click', () => api.maximize());
  $('win-close')?.addEventListener('click', () => api.close());

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

  // 全局屏蔽原生 Tab 焦点切换；Tab 只用于 YAH 自己的工作区
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab') event.preventDefault();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (!dom.renameOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeRename();
      }
      return;
    }
    if (!dom.confirmOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeConfirm();
      }
      return;
    }
    if (dom.skillArgsOverlay && !dom.skillArgsOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeSkillArgs();
      }
      return;
    }
    if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeMcpConfig();
      }
      return;
    }
    if (window.mcpOverlayOpen?.()) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        window.closeMcp?.();
      }
      return;
    }

    if (state.ringOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRingMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      closeRingMenu();
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
        return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        if (event.repeat || event.isComposing) return;
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('input, textarea, [contenteditable="true"]')
        ) {
          return;
        }
        event.preventDefault();
        dom.input.focus();
        return;
      }
      return;
    }

    if (event.key === 'Tab') {
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
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

      if (event.code === 'Space' || event.key === ' ') {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('button, input, textarea')
        ) {
          return;
        }
        event.preventDefault();
        if (!event.repeat) createChatFromSwitcher();
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

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === '1' || event.key === '2' || event.key === '3')
    ) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      setViewMode(
        event.key === '1'
          ? 'questions'
          : event.key === '2'
            ? 'replies'
            : 'processes'
      );
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
      if (inEditable) return;
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
      if (state.switcherOpen) commitSwitcherSelection();
    }
  });

  window.addEventListener('blur', () => {
    cancelTabHold();
    if (state.switcherOpen) closeSwitcher();
  });

  document.addEventListener(
    'wheel',
    (event) => {
      const blocked = () =>
        !dom.rawOverlay.classList.contains('hidden') ||
        !dom.settingsOverlay.classList.contains('hidden') ||
        state.switcherOpen ||
        state.composerOpen ||
        state.catalogOpen ||
        state.ringOpen ||
        Boolean(dom.webContent && !dom.webContent.classList.contains('hidden'));

      if (event.shiftKey && !event.ctrlKey) {
        if (blocked()) return;
        const delta = event.deltaY || event.deltaX;
        if (delta === 0) return;
        event.preventDefault();
        dom.messages.scrollTo({
          top: delta < 0 ? 0 : dom.messages.scrollHeight,
          behavior: 'smooth',
        });
        return;
      }

      if (!event.ctrlKey) return;

      // Ctrl+wheel 按对话回合导航
      event.preventDefault();
      if (blocked()) return;

      const delta = event.deltaY || event.deltaX;
      if (delta === 0) return;

      const now = Date.now();
      if (now - state.lastWheelNav < 25) return;
      state.lastWheelNav = now;

      navigateTurn(delta > 0 ? 1 : -1);
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
    card.classList.add('streaming');
    updateCardClip(card);
    stickStreamingText(card);

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

  api.onChatUsage(({ requestId, usage }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!usage || typeof usage !== 'object') return;
    state.streamMessage.usage = usage;
    const session = currentSession();
    if (!session || !session.msgs.includes(state.streamMessage)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
  });

  api.onChatTiming(({ requestId, round, channel, firstTokenMs }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    const msg = state.streamMessage;
    if (!msg.usage || typeof msg.usage !== 'object') {
      msg.usage = { hit: 0, miss: 0, output: 0, rounds: {} };
    }
    if (!msg.usage.rounds || typeof msg.usage.rounds !== 'object') {
      msg.usage.rounds = {};
    }
    const metrics = { ...(msg.usage.rounds[round] || {}) };
    if (channel === 'thinking') metrics.firstThinkingMs = firstTokenMs;
    else metrics.firstContentMs = firstTokenMs;
    msg.usage.rounds[round] = metrics;

    const session = currentSession();
    if (!session || !session.msgs.includes(msg)) return;
    const stepKind = channel === 'thinking' ? 'thinking' : 'text';
    const stepIndex = (msg.steps || []).findIndex(
      (step) => step.kind === stepKind && step.round === round
    );
    if (stepIndex < 0) return;
    const card = cardByKey(
      stepCardKey(session.msgs.indexOf(msg), stepIndex)
    );
    const timingNode = card?.querySelector('.card-timing');
    if (timingNode) {
      timingNode.textContent = formatLlmTiming(
        metrics,
        channel === 'thinking'
      );
    }
  });

  api.onChatToolCall(({ requestId, name, arguments: args, round, startedAt }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      kind: 'call',
      name: String(name || 'tool'),
      arguments: String(args ?? ''),
      round: Number.isInteger(round) ? round : 0,
      metrics: Number.isFinite(Number(startedAt))
        ? { startedAt: Number(startedAt) }
        : null,
    });
    saveChatsSoon();

    const session = currentSession();
    if (!session || !session.msgs.includes(state.streamMessage)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
  });

  api.onChatToolResult(({ requestId, name, output, ok, round, startedAt, durationMs }) => {
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
      metrics: {
        startedAt: Number.isFinite(Number(startedAt))
          ? Number(startedAt)
          : undefined,
        durationMs: Number.isFinite(Number(durationMs))
          ? Number(durationMs)
          : undefined,
      },
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

  api.onChatDone(({ requestId, text, usage }) => {
    if (requestId !== state.requestId) {
      refreshChats();
      return;
    }
    if (state.streamMessage) {
      if (typeof text === 'string') state.streamMessage.text = text;
      if (usage && typeof usage === 'object') {
        state.streamMessage.usage = usage;
      }
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
        mcpDisabled: [],
        foldState: null,
        pendingQueue: [],
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
  applyFoldState(currentSession());

  bindEvents();
  applySettings();
  renderAll();
  persistFoldState();
  updateSendState();
  void loadUsage();
  void loadMcpServers();
}

boot();
