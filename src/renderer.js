'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const DEFAULT_AGENT_ID = 'sub-programmer';
const DEFAULT_AGENT_NAME = '程序员';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const EFFORT_LEVELS = ['low', 'high', 'max'];
const DEFAULT_EFFORT = 'high';
const NO_KEY_HINT = 'No API key. Open Settings to add one.';
// DeepSeek V4.1 Flash (OpenCode Go) context window.
const CONTEXT_WINDOW_TOKENS = 1_000_000;

const shell = window.yah || null;
const $ = (id) => document.getElementById(id);

const dom = {
  messages: $('messages'),
  composer: $('composer'),
  input: $('input'),
  agentPicker: $('agent-picker'),
  agentPickerButton: $('agent-picker-button'),
  agentPickerValue: $('agent-picker-value'),
  agentMenu: $('agent-menu'),
  actionMenu: $('action-menu'),
  questionDock: $('question-dock'),
  questionProgress: $('question-dock-progress'),
  questionTimer: $('question-dock-timer'),
  questionTimerValue: $('question-dock-timer-value'),
  questionTimerProgress: $('question-dock-timer-progress'),
  questionBody: $('question-dock-body'),
  questionClose: $('question-dock-close'),
  questionBack: $('question-dock-back'),
  questionNext: $('question-dock-next'),
  composerContext: $('composer-context'),
  composerBox: $('composer-box'),
  composerTokens: $('composer-tokens'),
  composerImages: $('composer-images'),
  composerDrop: $('composer-drop'),
  composerNotice: $('composer-notice'),
  skillPopup: $('skill-popup'),
  skillArgsOverlay: $('skill-args-overlay'),
  skillArgsDesc: $('skill-args-desc'),
  skillArgsFields: $('skill-args-fields'),
  skillArgsError: $('skill-args-error'),
  skillArgsCancel: $('skill-args-cancel'),
  skillArgsAttach: $('skill-args-attach'),
  switcher: $('switcher'),
  switcherList: $('switcher-list'),
  projectList: $('project-list'),
  settingsOverlay: $('settings-overlay'),
  rawOverlay: $('raw-overlay'),
  renameOverlay: $('rename-overlay'),
  renameInput: $('rename-input'),
  renameCancel: $('rename-cancel'),
  renameSave: $('rename-save'),
  confirmOverlay: $('confirm-overlay'),
  confirmText: $('confirm-text'),
  confirmCancel: $('confirm-cancel'),
  confirmOk: $('confirm-ok'),
  projectOverlay: $('project-overlay'),
  managerComposer: $('manager-composer'),
  managerComposerTitle: $('manager-composer-title'),
  managerName: $('manager-name'),
  managerEngineerField: $('manager-engineer-field'),
  managerEngineerCount: $('manager-engineer-count'),
  managerFixedAgent: $('manager-fixed-agent'),
  managerDrop: $('manager-drop'),
  managerDropEmpty: $('manager-drop-empty'),
  managerDropChips: $('manager-drop-chips'),
  managerComposerError: $('manager-composer-error'),
  projectName: $('project-name'),
  projectDrop: $('project-drop'),
  projectDirs: $('project-dirs'),
  projectError: $('project-error'),
  projectCancel: $('project-cancel'),
  projectSave: $('project-save'),
  approvalOverlay: $('approval-overlay'),
  approvalTool: $('approval-tool'),
  approvalPath: $('approval-path'),
  approvalDirs: $('approval-dirs'),
  approvalDeny: $('approval-deny'),
  approvalAllow: $('approval-allow'),
  goalOverlay: $('goal-overlay'),
  goalObjective: $('goal-objective'),
  goalBudget: $('goal-budget'),
  goalError: $('goal-error'),
  goalCancel: $('goal-cancel'),
  goalStart: $('goal-start'),
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
  webContentBody: $('web-content-body'),
  webContentClose: $('web-content-close'),
  composerEffortRail: $('composer-effort-rail'),
  composerEffortLevel: $('composer-effort-level'),
  modelPicker: $('model-picker'),
  modelPickerButton: $('model-picker-button'),
  modelPickerValue: $('model-picker-value'),
  modelMenu: $('model-menu'),
  gatewayState: $('gateway-state'),
  gatewayRoutes: $('gateway-routes'),
  gatewayModelList: $('gateway-model-list'),
  gatewayModelCount: $('gateway-model-count'),
  gatewayModelLabel: $('gateway-model-label'),
  gatewayModelProvider: $('gateway-model-provider'),
  gatewayModelId: $('gateway-model-id'),
  gatewayModelAdd: $('gateway-model-add'),
  gatewaySave: $('gateway-save'),
  gatewaySaveState: $('gateway-save-state'),
  llmConfigFile: $('llm-config-file'),
  mcpConfig: $('mcp-config'),
  mcpConfigSummary: $('mcp-config-summary'),
  mcpConfigGrid: $('mcp-config-grid'),
  backgroundBadge: $('background-badge'),
  backgroundBadgeCount: $('background-badge-count'),
  backgroundOverlay: $('background-overlay'),
  backgroundSummary: $('background-summary'),
  backgroundList: $('background-list'),
  backgroundClose: $('background-close'),
};

const state = {
  sessions: [],
  projects: [],
  current: 0,
  seq: 1,
  settings: {
    apiKey: '',
    hasApiKey: false,
    reasoningEffort: DEFAULT_EFFORT,
    sessionModels: {},
  },
  models: [],
  llmConfigFile: '',
  gatewayRoutes: {},
  gatewayDefaultModel: '',
  gatewayTasks: [],
  gatewayDraft: null,
  gatewaySaving: false,
  modelMenuIndex: 0,
  switcherOpen: false,
  switcherIndex: 0,
  switcherProjectId: null,
  composerOpen: false,
  effortDragging: false,
  openCardKey: null,
  renderedOpenKeys: new Set(),
  renderedSessionId: null,
  collapsedProcessKeys: new Set(),
  contextCollapsed: new Set(['role', 'system', 'safety', 'agents']),
  contextGroupCollapsed: true,
  viewMode: 'questions',
  chatWindow: false,
  homeWindow: false,
  panelWindow: false,
  archiveWindow: false,
  chatCompact: false,
  chatTurnIndex: -1,
  chatNav: null,
  chatNavSignature: '',
  chatNavTimer: null,
  foldRestored: false,
  foldSessionId: null,
  renderVersion: 0,
  lastWheelNav: 0,
  tabHeld: false,
  streaming: false,
  requestId: null,
  streamMessage: null,
  compactStatus: null,
  liveReplyViewer: null,
  pendingDelete: -1,
  deleteTimer: null,
  pendingQueueDelete: null,
  queueDeleteTimer: null,
  saveTimer: null,
  settingsTimer: null,
  composerNoticeTimer: null,
  forceScroll: true,
  followBottom: true,
  autoScrolling: false,
  autoScrollTimer: null,
  ringOpen: false,
  ringIndex: -1,
  ringSuppress: false,
  ringMoved: false,
  ringConfirmIndex: -1,
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
  background: {
    sessionId: null,
    jobs: [],
    loading: false,
    fetchedAt: 0,
  },
  backgroundPollTimer: null,
  systemInfo: {
    key: '',
    loading: false,
    text: '',
    error: '',
    request: 0,
  },
  skills: [],
  skillsLoading: false,
  skillsSessionId: null,
  skillsFetchedAt: 0,
  agents: [],
  agentsLoading: false,
  agentsFetchedAt: 0,
  agentToolGroup: null,
  agentMenuOpen: false,
  agentMenuIndex: -1,
  attachedSkills: [],
  attachedImages: [],
  skillArgsTarget: null,
  slashOpen: false,
  slashIndex: 0,
  slashSkills: [],
  slashDismissed: false,
  approvalQueue: [],
  activeApproval: null,
  handledApprovals: new Set(),
  goalDialog: null,
  goalSaving: false,
  questionQueue: [],
  activeQuestion: null,
  questionTimer: null,
  questionHeartbeatAt: 0,
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
let backgroundEvents = null;

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

function connectBackgroundEvents() {
  if (backgroundEvents) return;
  const source = new EventSource('/api/background/events');
  backgroundEvents = source;
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
  if (webContentKind === 'image') {
    const figure = el('figure', 'web-content-image-wrap');
    const image = document.createElement('img');
    image.className = 'web-content-image';
    image.src = String(payload?.dataUrl || '');
    image.alt = String(payload?.name || '图片');
    image.draggable = false;
    figure.append(image);
    const width = Number(payload?.width) || 0;
    const height = Number(payload?.height) || 0;
    const caption = [
      String(payload?.name || '').trim(),
      width && height ? `${width} × ${height}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (caption) {
      figure.append(el('figcaption', 'web-content-image-caption', caption));
    }
    dom.webContentBody.append(figure);
    return;
  }
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
  renderMarkdownContent(dom.webContentBody, payload?.text);
}

function openWebContent(payload) {
  if (!dom.webContent) return Promise.resolve();
  closeRingMenu();
  state.ringSuppress = false;
  webContentKey = payload?.key || null;
  webContentKind = payload?.kind || 'text';
  renderWebContent(payload);
  dom.webContentBody.scrollTop = 0;
  dom.webContent.classList.toggle('image-mode', webContentKind === 'image');
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
  renderMarkdownContent(dom.webContentBody, payload.text);
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
  dom.webContent.classList.remove('image-mode');
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
  openAgileWindow: (managerId) => shell?.openAgileWindow?.(managerId),
  openSystemNodeWindow: (nodeId) => shell?.openSystemNodeWindow?.(nodeId),
  openConfigWindow: (kind) => shell?.openConfigWindow?.(kind),
  openArchiveWindow: (sessionId) => shell?.openArchiveWindow?.(sessionId),
  openChatWindow: (sessionId, options) =>
    shell?.openChatWindow?.(sessionId, options),
  getPathForFile: (file) =>
    shell?.getPathForFile?.(file) || String(file?.path || ''),
  pickDirectories: () => shell?.pickDirectories?.() ?? Promise.resolve([]),
  isDirectory: (target) =>
    shell?.isDirectory?.(target) ?? Promise.resolve(false),

  loadSettings: () => requestJson('/api/settings'),
  saveSettings: (settings) =>
    requestJson('/api/settings', { method: 'PUT', body: settings }),
  loadLlmConfig: () => requestJson('/api/llm-config'),
  saveLlmConfig: (config) =>
    requestJson('/api/llm-config', { method: 'PUT', body: config }),
  loadChats: () => requestJson('/api/chats'),
  loadSession: (sessionId) =>
    requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`),
  forkSession: (sessionId, options = {}) =>
    requestJson('/api/sessions/fork', {
      method: 'POST',
      body: { sessionId, ...options },
    }),
  saveChats: (chats) =>
    requestJson('/api/chats', { method: 'POST', body: chats }),
  loadAgents: () => requestJson('/api/agents'),
  loadProjectAgentsMd: (projectId) =>
    requestJson(
      `/api/agents-md?projectId=${encodeURIComponent(projectId)}`
    ),
  loadSystemInfo: (sessionId) =>
    requestJson(
      `/api/system-info?sessionId=${encodeURIComponent(sessionId)}`
    ),
  resolveApproval: (id, approved) =>
    requestJson(`/api/approvals/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { approved },
    }),
  answerQuestion: (id, payload) =>
    requestJson(`/api/questions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: payload,
    }),
  heartbeatQuestion: (id) =>
    requestJson(`/api/questions/${encodeURIComponent(id)}/heartbeat`, {
      method: 'POST',
    }),
  compactChat: (sessionId, queue = []) =>
    requestJson('/api/compact', {
      method: 'POST',
      body: { sessionId, queue },
    }),
  activeRun: (sessionId) =>
    requestJson(
      `/api/runs/active?sessionId=${encodeURIComponent(sessionId)}`
    ),
  cancelRun: (runId) =>
    requestJson('/api/cancel', {
      method: 'POST',
      body: { runId },
    }),
  loadActiveRuns: () => requestJson('/api/runs'),
  saveGoal: (sessionId, goal) =>
    requestJson('/api/goals', {
      method: 'POST',
      body: { sessionId, goal },
    }),
  clearSession: (id) =>
    requestJson('/api/sessions/clear', {
      method: 'POST',
      body: { sessionId: id },
    }),
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
  loadArchive: (sessionId) =>
    requestJson(`/api/archive?sessionId=${encodeURIComponent(sessionId)}`),
  loadArchiveJob: (sessionId, jobId) =>
    requestJson(
      `/api/archive/job?sessionId=${encodeURIComponent(
        sessionId
      )}&id=${encodeURIComponent(jobId)}`
    ),
  loadBackground: (sessionId) =>
    requestJson(
      `/api/background?sessionId=${encodeURIComponent(sessionId)}`
    ),
  stopBackground: (sessionId, id) =>
    requestJson('/api/background/stop', {
      method: 'POST',
      body: { sessionId, id },
    }),
  stopProjectBackground: (projectId) =>
    requestJson('/api/background/stop-project', {
      method: 'POST',
      body: { projectId },
    }),
  loadSkills: (sessionId, mcpDisabled = []) =>
    requestJson(
      `/api/skills?sessionId=${encodeURIComponent(
        sessionId
      )}&disabled=${encodeURIComponent(JSON.stringify(mcpDisabled))}`
    ),

  openContent: (payload) => openWebContent(payload),
  openContentViewer: (payload) => shell?.openContent?.(payload) ?? Promise.resolve(),
  updateContent: (payload) => updateWebContent(payload),
  onContentInit: (callback) => shell?.onContentInit?.(callback) ?? (() => {}),
  onContentUpdate: (callback) =>
    shell?.onContentUpdate?.(callback) ?? (() => {}),
  onViewerAsk: (callback) => shell?.onViewerAsk?.(callback) ?? (() => {}),
  onChatCompose: (callback) => shell?.onChatCompose?.(callback) ?? (() => {}),

  onChatDelta: (callback) => subscribeEvent('assistant.delta', callback),
  onChatRequest: (callback) => subscribeEvent('request.body', callback),
  onChatUsage: (callback) => subscribeEvent('usage', callback),
  onChatTiming: (callback) => subscribeEvent('assistant.timing', callback),
  onChatToolCall: (callback) => subscribeEvent('tool.call', callback),
  onChatToolResult: (callback) => subscribeEvent('tool.result', callback),
  onToolApproval: (callback) => subscribeEvent('tool.approval', callback),
  onToolQuestion: (callback) => subscribeEvent('tool.question', callback),
  onBackgroundUpdate: (callback) =>
    subscribeEvent('background.update', callback),
  onBackgroundComplete: (callback) =>
    subscribeEvent('background.complete', callback),
  onSubagentStarted: (callback) =>
    subscribeEvent('subagent.started', callback),
  onSubagentComplete: (callback) =>
    subscribeEvent('subagent.complete', callback),
  onGoalCheck: (callback) => subscribeEvent('goal.check', callback),
  onGoalUpdated: (callback) => subscribeEvent('goal.updated', callback),
  onWorknodesChanged: (callback) =>
    subscribeEvent('worknodes.changed', callback),
  onSystemNodesChanged: (callback) =>
    subscribeEvent('systemnodes.changed', callback),
  onCompaction: (callback) => subscribeEvent('compaction.done', callback),
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
let composerDragDepth = 0;
let canvasSpaceHeld = false;
let suppressNextCardClick = false;
let turnFlashTimer = 0;
let effortLabelTimer = 0;
let cardAnchorFrame = 0;
let toolTimer = 0;
let renameTarget = null;
let confirmAction = null;
let projectDialog = null;

function currentSession() {
  return state.sessions[state.current];
}

function openSessionWindow(sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  if (api.isElectron && api.openChatWindow) {
    Promise.resolve(api.openChatWindow(id, options)).catch((error) =>
      console.error('open chat window failed', error)
    );
    return true;
  }
  const index = state.sessions.findIndex((session) => session.id === id);
  if (index >= 0) selectSession(index);
  return false;
}

function ensureProjects() {
  if (!Array.isArray(state.projects)) state.projects = [];
  const ids = new Set(state.projects.map((project) => project.id));
  for (const session of state.sessions) {
    if (!ids.has(session.projectId)) {
      session.projectId = state.projects[0]?.id || null;
    }
  }
  if (!state.switcherProjectId || !ids.has(state.switcherProjectId)) {
    state.switcherProjectId =
      currentSession()?.projectId || state.projects[0]?.id || null;
  }
}

let managerComposerState = null;

function managerComposerDefaultProjectName() {
  const count = state.sessions.filter(
    (session) => session.nodeRole === 'manager'
  ).length;
  return `项目 ${count + 1}`;
}

function managerAgentDisplayName() {
  const agent = state.agents.find(
    (item) => item.id === MANAGER_AGENT_ID
  );
  return agent?.name || MANAGER_AGENT_NAME;
}

function renderManagerComposerDirs() {
  if (!dom.managerDropChips) return;
  dom.managerDropChips.replaceChildren();
  const dirs = managerComposerState?.directories || [];
  dom.managerDropEmpty?.classList.toggle('hidden', dirs.length > 0);
  dirs.forEach((directory) => {
    const row = el('div', 'manager-drop-chip');
    const label = el('span', '', directory);
    label.title = directory;
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除文件夹');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!managerComposerState) return;
      managerComposerState.directories =
        managerComposerState.directories.filter(
          (item) => item !== directory
        );
      renderManagerComposerDirs();
    });
    row.append(label, remove);
    dom.managerDropChips.append(row);
  });
}

function openManagerComposer(managerId = null) {
  if (!dom.managerComposer || !window.canvasOverlayOpen?.()) return;
  if (state.homeWindow && !managerId) {
    const existing = state.sessions.find(
      (session) => session.nodeRole === 'manager' && !session.archivedAt
    );
    if (existing) managerId = existing.id;
  }
  const manager =
    managerId
      ? state.sessions.find(
          (session) =>
            session.id === managerId && session.nodeRole === 'manager'
        )
      : null;
  const managerProject = manager
    ? state.projects.find((item) => item.id === manager.projectId)
    : null;
  managerComposerState = {
    editingId: manager?.id || null,
    directories: manager
      ? Array.isArray(manager.nodeConfig?.directories)
        ? [...manager.nodeConfig.directories]
        : [...(state.projects.find((p) => p.id === manager.projectId)
            ?.directories || [])]
      : [],
    engineerCount: manager
      ? Math.max(3, Number(manager.nodeConfig?.engineerCount) || 3)
      : 3,
  };
  if (dom.managerComposerError) dom.managerComposerError.hidden = true;
  if (dom.managerComposerTitle) {
    dom.managerComposerTitle.textContent = manager
      ? '配置管理 node'
      : '新建管理 node';
  }
  if (dom.managerName) {
    dom.managerName.value = manager
      ? managerProject?.name || '项目'
      : managerComposerDefaultProjectName();
  }
  if (dom.managerEngineerCount) {
    dom.managerEngineerCount.value = String(
      managerComposerState.engineerCount
    );
  }
  if (dom.managerEngineerField) {
    dom.managerEngineerField.classList.toggle('hidden', !manager);
  }
  if (dom.managerFixedAgent) {
    dom.managerFixedAgent.textContent = `${managerAgentDisplayName()} · 管理类`;
  }
  renderManagerComposerDirs();
  dom.managerComposer.classList.remove('hidden');
  dom.managerComposer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    dom.managerName?.focus();
    dom.managerName?.select();
  });
}

function closeManagerComposer() {
  if (!dom.managerComposer) return;
  managerComposerState = null;
  if (dom.managerName && document.activeElement === dom.managerName) {
    dom.managerName.blur();
  }
  dom.managerComposer.classList.add('hidden');
  dom.managerComposer.setAttribute('aria-hidden', 'true');
}

async function addManagerComposerDirectories(paths) {
  if (!managerComposerState) return;
  for (const raw of paths) {
    const target = String(raw || '').trim();
    if (!target) continue;
    let isDir = false;
    try {
      isDir = await api.isDirectory(target);
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    if (!managerComposerState.directories.includes(target)) {
      managerComposerState.directories.push(target);
    }
  }
  renderManagerComposerDirs();
}


async function createManagerFromComposer() {
  if (!managerComposerState) return;
  const projectName =
    String(dom.managerName?.value || '').trim() ||
    managerComposerDefaultProjectName();
  const agentId = MANAGER_AGENT_ID;
  const directories = managerComposerState.directories.slice();
  const editingId = managerComposerState.editingId;
  const engineerCount = editingId
    ? Math.max(
        3,
        Math.min(12, Math.round(Number(dom.managerEngineerCount?.value) || 3))
      )
    : 3;
  if (directories.length === 0) {
    if (dom.managerComposerError) {
      dom.managerComposerError.textContent = '先拖入至少一个文件夹';
      dom.managerComposerError.hidden = false;
    }
    return;
  }
  if (dom.managerComposerError) dom.managerComposerError.hidden = true;
  if (editingId) {
    const manager = state.sessions.find(
      (session) => session.id === editingId && session.nodeRole === 'manager'
    );
    if (!manager) {
      closeManagerComposer();
      return;
    }
    manager.title = 'Manager';
    manager.agentId = MANAGER_AGENT_ID;
    manager.nodeConfig = {
      ...(manager.nodeConfig || {}),
      kind: 'manager',
      directories,
      files: [],
      engineerCount,
    };
    const project = state.projects.find(
      (item) => item.id === manager.projectId
    );
    if (project) {
      project.name = projectName;
      project.directories = directories.slice();
    }
    await saveChatsNow();
    closeManagerComposer();
    window.refreshCanvas?.();
    await window.reloadCanvas?.();
    return;
  }
  const projectId = makeId();
  state.projects.push({
    id: projectId,
    name: projectName,
    directories: directories.slice(),
  });
  const id = makeId();
  const session = {
    id,
    title: 'Manager',
    system: DEFAULT_SYSTEM_PROMPT,
    agentsMd: null,
    agentId,
    projectId,
    frozen: false,
    subagent: false,
    parentSessionId: null,
    nodeRole: 'manager',
    managerId: null,
    nodeConfig: {
      kind: 'manager',
      directories,
      files: [],
      engineerCount,
    },
    mcpDisabled: [],
    foldState: null,
    pendingQueue: [],
    msgs: [],
  };
  state.sessions.push(session);
  state.current = state.sessions.length - 1;
  state.switcherProjectId = projectId;
  await saveChatsNow();
  closeManagerComposer();
  window.createCanvasManagerNode?.(id);
  openSessionWindow(id, { compose: true });
}

function sessionsInProject(projectId = state.switcherProjectId) {
  return state.sessions.filter(
    (session) => session.projectId === projectId && !session.archivedAt
  );
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
      agentId: session.agentId || DEFAULT_AGENT_ID,
      projectId: session.projectId,
      frozen: session.frozen === true,
      subagent: session.subagent === true,
      parentSessionId: session.parentSessionId || null,
      nodeRole: session.nodeRole || null,
      managerId: session.managerId || null,
      nodeConfig: session.nodeConfig || null,
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
    preserveCurrent: state.chatWindow === true,
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
  return {
    ...(key ? { apiKey: key } : {}),
    reasoningEffort: currentEffort(),
    sessionModels: state.settings.sessionModels || {},
  };
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

function normalizeEffort(value) {
  const effort = String(value || '').trim().toLowerCase();
  return EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
}

function currentEffort() {
  return normalizeEffort(state.settings.reasoningEffort);
}

function setComposerEffortLabel(effort) {
  const node = dom.composerEffortLevel;
  if (!node) return;
  const text = String(effort || '').toUpperCase();
  if (node.textContent === text) return;
  node.classList.add('changing');
  clearTimeout(effortLabelTimer);
  effortLabelTimer = setTimeout(() => {
    node.textContent = text;
    node.classList.remove('changing');
  }, 90);
}

function renderComposerEffort() {
  if (!dom.composerEffortRail) return;
  const effort = currentEffort();
  const index = EFFORT_LEVELS.indexOf(effort);
  const ratio = index / (EFFORT_LEVELS.length - 1);
  dom.composerEffortRail.style.setProperty('--effort-ratio', String(ratio));
  dom.composerEffortRail.setAttribute('aria-valuenow', String(index));
  dom.composerEffortRail.setAttribute('aria-valuetext', effort);
  setComposerEffortLabel(effort);
}

function setComposerEffort(value) {
  const effort = normalizeEffort(value);
  if (currentEffort() !== effort) {
    state.settings.reasoningEffort = effort;
    saveSettingsSoon();
  }
  renderComposerEffort();
}

function composerEffortRatioFromPointer(event) {
  const rail = dom.composerEffortRail;
  if (!rail) return 0.5;
  const rect = rail.getBoundingClientRect();
  const travel = Math.max(1, rect.width);
  return Math.min(
    1,
    Math.max(0, (event.clientX - rect.left) / travel)
  );
}

function previewComposerEffort(event) {
  const rail = dom.composerEffortRail;
  if (!rail) return;
  const ratio = composerEffortRatioFromPointer(event);
  rail.classList.add('dragging');
  rail.style.setProperty('--effort-ratio', String(ratio));
  const index = Math.min(
    EFFORT_LEVELS.length - 1,
    Math.round(ratio * (EFFORT_LEVELS.length - 1))
  );
  const effort = EFFORT_LEVELS[index];
  rail.setAttribute('aria-valuenow', String(index));
  rail.setAttribute('aria-valuetext', effort);
  setComposerEffortLabel(effort);
  if (currentEffort() !== effort) {
    state.settings.reasoningEffort = effort;
    saveSettingsSoon();
  }
}

function applySettings() {
  const s = state.settings;
  const hasKey = Boolean(s.hasApiKey);
  dom.apiKeyState.textContent = hasKey ? 'set' : 'not set';
  dom.apiKey.placeholder = hasKey ? '输入新 key' : '';
  if (document.activeElement !== dom.apiKey) {
    dom.apiKey.value = '';
  }
  renderComposerEffort();
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
  dom.input.placeholder = state.streaming ? '输入排队消息…' : '输入消息，拖入或粘贴图片…';
  updateSendState();
}

function isAtBottom() {
  return (
    dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight <
    2
  );
}

function scrollMessagesTo(top, { smooth = false } = {}) {
  if (!dom.messages) return;
  state.autoScrolling = true;
  clearTimeout(state.autoScrollTimer);
  if (smooth) {
    dom.messages.scrollTo({ top, behavior: 'smooth' });
  } else {
    dom.messages.scrollTop = top;
  }
  state.autoScrollTimer = setTimeout(() => {
    state.autoScrolling = false;
  }, smooth ? 1200 : 80);
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
  const compactOpen =
    state.chatWindow &&
    state.chatCompact &&
    (card.classList.contains('prompt-card') ||
      card.classList.contains('answer-card'));
  if (body) body.inert = compactOpen ? false : !expanded;
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
  for (const card of cards) {
    if (
      card.classList.contains('streaming') &&
      card.querySelector('.card-waiting')
    ) {
      keys.add(card.dataset.cardKey);
      continue;
    }
    if (!card.classList.contains('answer-card')) continue;
    if (
      state.viewMode === 'replies' ||
      state.viewMode === 'processes' ||
      (state.viewMode === 'questions' && card.classList.contains('streaming'))
    ) {
      keys.add(card.dataset.cardKey);
    }
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
  state.collapsedProcessKeys = new Set(fold?.collapsedProcessKeys || []);
  state.contextCollapsed = new Set(
    fold?.contextFoldVersion === 3 && Array.isArray(fold.contextCollapsed)
      ? fold.contextCollapsed
      : ['role', 'system', 'safety', 'agents']
  );
  state.contextGroupCollapsed = fold?.contextGroupCollapsed !== false;
  state.openCardKey = fold?.openKey || null;
  state.foldRestored = Boolean(fold);
}

function captureFoldState() {
  return {
    openKey: state.viewMode ? null : state.openCardKey || null,
    collapsedProcessKeys: [...state.collapsedProcessKeys],
    contextCollapsed: [...state.contextCollapsed],
    contextFoldVersion: 3,
    contextGroupCollapsed: state.contextGroupCollapsed,
    viewMode: state.viewMode || null,
  };
}

function persistFoldState() {
  if (state.homeWindow) return;
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

function usageRound(usage) {
  const rounds = usage?.rounds;
  if (rounds && typeof rounds === 'object') {
    let best = null;
    for (const round of Object.values(rounds)) {
      if (!round || typeof round !== 'object') continue;
      const hit = Math.max(0, Number(round.hit) || 0);
      const miss = Math.max(0, Number(round.miss) || 0);
      const output = Math.max(0, Number(round.output) || 0);
      const total = hit + miss + output;
      if (!best || total > best.total) {
        best = { hit, miss, output, total };
      }
    }
    if (best) return best;
  }
  if (!usage || typeof usage !== 'object') return null;
  return {
    hit: Math.max(0, Number(usage.hit) || 0),
    miss: Math.max(0, Number(usage.miss) || 0),
    output: Math.max(0, Number(usage.output) || 0),
  };
}

function usageText(usage) {
  const round = usageRound(usage);
  if (!round) return '';
  const input = round.hit + round.miss;
  const hitPercent = input > 0 ? Math.round((round.hit / input) * 100) : 0;
  return `${compactTokens(input)} / ${hitPercent}% / ${compactTokens(round.output)}`;
}

function contextTokensForMessage(msg) {
  const round = usageRound(msg?.usage);
  if (!round) return 0;
  return round.hit + round.miss + round.output;
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

let previewClickTimer = 0;

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
    if (opts.preview && !opts.alwaysOpen) {
      const previewInline = el('span', 'card-preview-inline', opts.preview);
      previewInline.addEventListener('click', (event) => {
        event.stopPropagation();
        if (suppressNextCardClick) {
          suppressNextCardClick = false;
          return;
        }
        if (event.detail > 1) return;
        clearTimeout(previewClickTimer);
        previewClickTimer = setTimeout(() => {
          previewClickTimer = 0;
          toggleCard(opts.key);
        }, 240);
      });
      previewInline.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(previewClickTimer);
        previewClickTimer = 0;
        if (event.ctrlKey && typeof opts.onInspect === 'function') {
          opts.onInspect();
          return;
        }
        opts.onFullContent?.();
      });
      head.append(previewInline);
    }
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
      const round = usageRound(opts.usage);
      if (round) {
        const input = round.hit + round.miss;
        const hitPercent = input > 0 ? Math.round((round.hit / input) * 100) : 0;
        const totalHit = Math.max(0, Number(opts.usage.hit) || 0);
        const totalMiss = Math.max(0, Number(opts.usage.miss) || 0);
        const totalInput = totalHit + totalMiss;
        const totalPercent =
          totalInput > 0 ? Math.round((totalHit / totalInput) * 100) : 0;
        usage.setAttribute(
          'aria-label',
          `当前上下文 输入 ${input} · 缓存命中 ${round.hit} (${hitPercent}%) · 输出 ${
            round.output
          }；全部轮次 输入 ${totalInput} · 缓存命中 ${totalHit} (${totalPercent}%) · 输出 ${
            Number(opts.usage.output) || 0
          }`
        );
      }
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
      clearTimeout(previewClickTimer);
      previewClickTimer = 0;
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

  const bodyWrap = el('div', 'card-body-wrap');
  bodyWrap.inert = !opts.alwaysOpen;
  if (
    state.chatWindow &&
    state.chatCompact &&
    (opts.kind === 'user' || opts.primary)
  ) {
    bodyWrap.inert = false;
  }
  const body = el('div', 'card-body');
  const inner = el('div', 'card-body-inner');
  body.append(inner);
  bodyWrap.append(body);
  if (head) card.append(head);
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

function renderMarkdownContent(container, text) {
  const root = el('div', 'md-body');
  renderMarkdownBlocks(root, String(text ?? ''));
  container.replaceChildren(root);
}

function mdSafeHref(value) {
  const url = String(value || '').trim();
  return /^(https?:|mailto:|#)/i.test(url) ? url : '';
}

function mdInline(text) {
  const source = String(text ?? '');
  const nodes = [];
  const pattern =
    /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|\[([^\]\n]+)\]\(([^)\n]+)\))/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) {
      nodes.push(document.createTextNode(source.slice(last, match.index)));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(el('code', 'md-code-inline', token.slice(1, -1)));
    } else if (token.startsWith('***')) {
      const strong = el('strong');
      const em = el('em');
      em.append(...mdInline(token.slice(3, -3)));
      strong.append(em);
      nodes.push(strong);
    } else if (token.startsWith('**')) {
      const strong = el('strong');
      strong.append(...mdInline(token.slice(2, -2)));
      nodes.push(strong);
    } else if (token.startsWith('*')) {
      const em = el('em');
      em.append(...mdInline(token.slice(1, -1)));
      nodes.push(em);
    } else if (token.startsWith('~~')) {
      const del = el('del');
      del.append(...mdInline(token.slice(2, -2)));
      nodes.push(del);
    } else if (token.startsWith('[')) {
      const label = match[2] || '';
      const href = mdSafeHref(match[3] || '');
      if (href) {
        const link = el('a', 'md-link');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.append(...mdInline(label));
        nodes.push(link);
      } else {
        nodes.push(document.createTextNode(label || token));
      }
    }
    last = match.index + token.length;
  }
  if (last < source.length) {
    nodes.push(document.createTextNode(source.slice(last)));
  }
  return nodes;
}

function mdSplitRow(line) {
  let value = String(line || '').trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function mdIsTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|') || !lines[index + 1].includes('-')) {
    return false;
  }
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(
    lines[index + 1].trim()
  );
}

function mdListMatch(line) {
  const match = String(line || '').match(
    /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
  );
  if (!match) return null;
  return {
    indent: match[1].length,
    ordered: /^\d/.test(match[2]),
    content: match[3],
  };
}

function mdParseList(lines, start) {
  const first = mdListMatch(lines[start]);
  const list = el(
    first.ordered ? 'ol' : 'ul',
    `md-list ${first.ordered ? 'md-ordered' : 'md-unordered'}`
  );
  let index = start;
  while (index < lines.length) {
    const item = mdListMatch(lines[index]);
    if (
      !item ||
      item.indent !== first.indent ||
      item.ordered !== first.ordered
    ) {
      break;
    }
    const li = el('li', 'md-list-item');
    let content = item.content;
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      li.classList.add('md-task');
      const box = el(
        'span',
        `md-task-box${task[1].trim() ? ' checked' : ''}`
      );
      li.append(box);
      content = task[2];
    }
    let cursor = index + 1;
    const extra = [];
    let nested = null;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (!next.trim()) break;
      const nextItem = mdListMatch(next);
      if (nextItem && nextItem.indent <= first.indent) break;
      if (!/^\s+/.test(next)) break;
      if (nextItem && nextItem.indent > first.indent) {
        nested = mdParseList(lines, cursor);
        break;
      }
      extra.push(next.trim());
      cursor += 1;
    }
    li.append(
      ...mdInline(
        content + (extra.length ? ` ${extra.join(' ')}` : '')
      )
    );
    if (nested) {
      li.append(nested.node);
      index = nested.next;
    } else {
      index = cursor;
    }
    list.append(li);
  }
  return { node: list, next: index };
}

function mdParseTable(lines, start) {
  const header = mdSplitRow(lines[start]);
  const separator = mdSplitRow(lines[start + 1]);
  const aligns = separator.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const table = el('table', 'md-table');
  const thead = el('thead');
  const headRow = el('tr');
  header.forEach((cell, index) => {
    const th = el(
      'th',
      aligns[index] ? `md-align-${aligns[index]}` : ''
    );
    th.append(...mdInline(cell));
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  let index = start + 2;
  while (
    index < lines.length &&
    lines[index].trim() &&
    lines[index].includes('|')
  ) {
    const cells = mdSplitRow(lines[index]);
    const row = el('tr');
    for (let column = 0; column < header.length; column += 1) {
      const td = el(
        'td',
        aligns[column] ? `md-align-${aligns[column]}` : ''
      );
      td.append(...mdInline(cells[column] || ''));
      row.append(td);
    }
    tbody.append(row);
    index += 1;
  }
  table.append(tbody);
  return { node: table, next: index };
}

function mdParseCodeFence(lines, start) {
  const match = lines[start].match(
    /^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/
  );
  const fence = match[1];
  const language = match[2] || '';
  const body = [];
  let index = start + 1;
  while (index < lines.length) {
    if (lines[index].trim().startsWith(fence)) {
      index += 1;
      break;
    }
    body.push(lines[index]);
    index += 1;
  }
  const wrap = el('div', 'md-code-block');
  const head = el('div', 'md-code-head');
  head.append(el('span', 'md-code-lang', language || 'code'));
  const copy = el('button', 'md-copy', '复制');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(body.join('\n'));
      copy.textContent = '已复制';
      setTimeout(() => {
        copy.textContent = '复制';
      }, 1200);
    } catch {
      copy.textContent = '复制失败';
    }
  });
  head.append(copy);
  const pre = el('pre', 'md-pre');
  const code = el('code', 'md-code', body.join('\n'));
  if (language) code.classList.add(`language-${language}`);
  pre.append(code);
  wrap.append(head, pre);
  return { node: wrap, next: index };
}

function mdIsBlockStart(lines, index) {
  const line = lines[index];
  if (!line.trim()) return true;
  if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (mdListMatch(line)) return true;
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
  return mdIsTableStart(lines, index);
}

function renderMarkdownBlocks(container, text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      const code = mdParseCodeFence(lines, index);
      container.append(code.node);
      index = code.next;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const node = el(`h${level}`, `md-heading md-h${level}`);
      node.append(...mdInline(heading[2]));
      container.append(node);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      container.append(el('hr', 'md-hr'));
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      const quote = el('blockquote', 'md-quote');
      renderMarkdownBlocks(quote, quoteLines.join('\n'));
      container.append(quote);
      continue;
    }

    if (mdIsTableStart(lines, index)) {
      const table = mdParseTable(lines, index);
      container.append(table.node);
      index = table.next;
      continue;
    }

    if (mdListMatch(line)) {
      const list = mdParseList(lines, index);
      container.append(list.node);
      index = list.next;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !mdIsBlockStart(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    const p = el('p', 'md-p');
    paragraph.forEach((row, rowIndex) => {
      if (rowIndex > 0) p.append(el('br'));
      p.append(...mdInline(row));
    });
    container.append(p);
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

function liveReplyKey() {
  const sessionId = currentSession()?.id || 'session';
  return `live:${sessionId}`;
}

function liveReplyText(msg) {
  if (!msg) return '';
  const block = latestCompactBlock(
    msg,
    state.streaming && msg === state.streamMessage
  );
  return String(block.text || '');
}

function openLiveReplyViewer(msg, msgIndex) {
  if (!msg || msgIndex < 0) return;
  const key = liveReplyKey();
  state.liveReplyViewer = {
    key,
    sessionId: currentSession()?.id || '',
    msgIndex,
  };
  openFullContent({
    key,
    title: '回复 · Markdown',
    kind: 'text',
    text: liveReplyText(msg),
  });
}

function syncLiveReplyViewer(msg, msgIndex) {
  if (!msg || msgIndex < 0) return;
  const key = liveReplyKey();
  if (state.liveReplyViewer?.key !== key) return;
  if (state.liveReplyViewer.msgIndex !== msgIndex) return;
  api.updateContent({ key, text: liveReplyText(msg) });
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
  } else if (streaming) {
    body.append(el('div', 'card-text card-waiting'));
  }
  if (streaming) card.classList.add('streaming');
  return card;
}

function promptImages(images) {
  const row = el('div', 'prompt-images');
  for (const image of Array.isArray(images) ? images : []) {
    const source = image?.url || image?.dataUrl;
    if (!source) continue;
    const button = el('button', 'prompt-image');
    button.type = 'button';
    button.title = image.name || '图片';
    button.setAttribute('aria-label', `查看图片 ${image.name || ''}`.trim());
    const node = document.createElement('img');
    node.src = source;
    node.alt = image.name || '图片';
    node.loading = 'lazy';
    node.draggable = false;
    button.append(node);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openImagePreview(image);
    });
    row.append(button);
  }
  return row;
}

function promptCard({ key, text, images = [], onInspect }) {
  const imageList = Array.isArray(images) ? images : [];
  const { card, body } = makeCard({
    key,
    kind: 'user',
    title: '提问',
    meta: '',
    preview: previewLine(text),
    onInspect,
    onFullContent: () =>
      openFullContent({
        key,
        title: '提问',
        kind: 'text',
        text:
          textFromCard(card) ||
          (imageList.length ? `${imageList.length} 张图片` : ''),
      }),
  });
  card.classList.add('prompt-card');
  if (imageList.length > 0) {
    const head = card.querySelector('.card-head');
    if (head) {
      const thumbs = el('span', 'card-image-thumbs');
      imageList.slice(0, 3).forEach((image) => {
        const source = image?.url || image?.dataUrl;
        if (!source) return;
        const thumb = document.createElement('img');
        thumb.className = 'card-image-thumb';
        thumb.src = source;
        thumb.alt = image.name || '图片';
        thumb.title = image.name || '图片';
        thumb.addEventListener('click', (event) => {
          event.stopPropagation();
          openImagePreview(image);
        });
        thumbs.append(thumb);
      });
      if (imageList.length > 3) {
        thumbs.append(
          el('span', 'card-image-more', `+${imageList.length - 3}`)
        );
      }
      const preview = head.querySelector('.card-preview-inline');
      if (preview) preview.after(thumbs);
      else {
        const tail = head.querySelector('.card-tail');
        if (tail) tail.before(thumbs);
        else head.append(thumbs);
      }
    }
    body.append(promptImages(imageList));
  }
  if (String(text ?? '').trim()) {
    const textNode = el('div', 'card-text prompt-text');
    renderTextContent(textNode, text);
    body.append(textNode);
  }
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

function dropWaitingThinking(msg, round) {
  if (!msg || !Array.isArray(msg.steps)) return;
  const stepRound = Number.isInteger(round) ? round : 0;
  msg.steps = msg.steps.filter(
    (step) =>
      !(
        step.placeholder === true &&
        step.kind === 'thinking' &&
        step.round === stepRound &&
        !String(step.text || '').trim()
      )
  );
}

function ensureWaitingThinking(msg, round) {
  if (!msg) return false;
  if (!Array.isArray(msg.steps)) msg.steps = [];
  const stepRound = Number.isInteger(round) ? round : 0;
  const hasContent = msg.steps.some(
    (step) =>
      (step.kind === 'thinking' || step.kind === 'text') &&
      step.round === stepRound
  );
  if (hasContent) return false;
  msg.steps.push({
    kind: 'thinking',
    text: '',
    round: stepRound,
    placeholder: true,
  });
  return true;
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

function preambleTextIndexes(steps) {
  const preamble = new Set();
  steps.forEach((step, index) => {
    if (step.kind !== 'text') return;
    const hasCallInRound = steps
      .slice(index + 1)
      .some((next) => next.kind === 'call' && next.round === step.round);
    if (hasCallInRound) preamble.add(index);
  });
  return preamble;
}

function finalTextIndex(steps, preamble = preambleTextIndexes(steps)) {
  let last = -1;
  steps.forEach((step, index) => {
    if (step.kind === 'text' && !preamble.has(index)) last = index;
  });
  return last;
}

function lastCardKey(session) {
  if (!session || session.msgs.length === 0) return null;
  const index = session.msgs.length - 1;
  const msg = session.msgs[index];
  if (msg.role !== 'Agent') return messageCardKey(index);

  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  if (isRichTrace(steps) && steps.length > 0) {
    const lastTextIndex = finalTextIndex(steps);
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

function renderCompactionBlock(step, key) {
  const mode =
    step.label === 'running'
      ? 'running'
      : step.label === 'failed'
        ? 'failed'
        : 'done';
  const block = el('div', `compact-block mode-${mode}`);
  if (key) block.dataset.cardKey = key;
  const head = el('div', 'compact-head');
  head.append(el('span', 'compact-dot'));
  head.append(el('span', 'compact-title', 'CONTEXT COMPACTED'));
  head.append(
    el(
      'span',
      `compact-badge ${step.label || 'auto'}`,
      step.label === 'running' ? 'running' : step.label || 'auto'
    )
  );
  const before = Number(step.metrics?.beforeTokens) || 0;
  const after = Number(step.metrics?.afterTokens) || 0;
  if (before || after) {
    head.append(
      el(
        'span',
        'compact-meta',
        `${compactTokens(before)} → ${compactTokens(after)}`
      )
    );
  }
  block.append(head);
  if (step.text) {
    if (step.label === 'running' || step.label === 'failed') {
      block.append(el('div', 'compact-text', step.text));
    } else {
      const details = el('details', 'compact-details');
      const summary = el('summary', '', '查看摘要');
      const pre = el('pre', 'compact-summary', step.text);
      details.append(summary, pre);
      block.append(details);
    }
  }
  return block;
}

function renderCompactMessage(msg, key) {
  const metrics =
    msg?.usage && typeof msg.usage === 'object' ? msg.usage : {};
  const block = renderCompactionBlock(
    {
      kind: 'compact',
      label: metrics.auto ? 'auto' : 'manual',
      text: String(msg?.text || ''),
      name: metrics.auto ? 'auto' : 'manual',
      ok: true,
      metrics,
    },
    key
  );
  block.classList.add('compact-message');
  return block;
}

function renderCompactStatus(status) {
  const block = renderCompactionBlock(
    {
      kind: 'compact',
      label: status.label || 'running',
      text: status.text || '',
      name: status.label || 'running',
      ok: status.label !== 'failed',
      metrics: status.metrics || {},
    },
    null
  );
  block.classList.add('compact-message');
  return block;
}

function renderGoalCheckBlock(step) {
  const verdict = step.label || 'continue';
  const block = el('div', `goal-check-block verdict-${verdict}`);
  const head = el('div', 'goal-check-head');
  head.append(el('span', 'goal-check-dot'));
  head.append(el('span', 'goal-check-title', 'GOAL CHECK'));
  head.append(el('span', 'goal-check-badge', verdict));
  const turn = Number(step.metrics?.turn) || 0;
  const tokens = Number(step.metrics?.tokensUsed) || 0;
  if (turn || tokens) {
    head.append(
      el(
        'span',
        'goal-check-meta',
        `turn ${turn}${tokens ? ` · ${compactTokens(tokens)} tokens` : ''}`
      )
    );
  }
  block.append(head);
  if (step.metrics?.objective) {
    block.append(
      el('div', 'goal-check-objective', `目标：${step.metrics.objective}`)
    );
  }
  const scores = step.metrics?.scores;
  if (scores && typeof scores === 'object') {
    const row = el('div', 'goal-check-scores');
    for (const id of ['all_done', 'remaining', 'needs_user']) {
      const yes = Number(scores[id]) >= 0.5;
      row.append(
        el(
          'span',
          `goal-check-score ${yes ? 'yes' : 'no'}`,
          `${yes ? '✓' : '✗'} ${id}`
        )
      );
    }
    block.append(row);
  }
  if (step.text) block.append(el('div', 'goal-check-reason', step.text));
  return block;
}

function appendSpecialSteps(msg, msgIndex, container) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  steps.forEach((step, index) => {
    if (!step) return;
    if (step.kind === 'compact') {
      container.append(
        renderCompactionBlock(step, stepCardKey(msgIndex, index))
      );
    } else if (step.kind === 'goal') {
      container.append(renderGoalCheckBlock(step));
    }
  });
}

function latestCompactBlock(msg, streaming) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  let fallback = null;
  let waiting = null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step) continue;
    const isLast = index === steps.length - 1;
    if (step.kind === 'thinking' || step.kind === 'text') {
      const text = String(step.text || '');
      if (text) {
        return {
          index,
          kind: step.kind,
          title: step.kind === 'thinking' ? '思考' : '回复',
          text,
          streaming: streaming && isLast,
        };
      }
      if (!waiting && (step.placeholder || (streaming && isLast))) {
        waiting = {
          index,
          kind: step.kind,
          title: step.kind === 'thinking' ? '思考' : '回复',
          text: '',
          streaming: Boolean(streaming),
        };
      }
      continue;
    }
    if (step.kind === 'call') {
      return {
        index,
        kind: 'call',
        title: '工具调用',
        text: [step.name, step.arguments].filter(Boolean).join('\n'),
        streaming: streaming && isLast,
      };
    }
    if (step.kind === 'result') {
      return {
        index,
        kind: 'result',
        title: step.ok === false ? '工具失败' : '工具结果',
        text: [step.name, step.output].filter(Boolean).join('\n'),
        streaming: false,
      };
    }
    if (step.kind === 'status') {
      if (!fallback && step.label) {
        fallback = {
          index,
          kind: 'status',
          title: '状态',
          text: String(step.label),
          streaming: false,
        };
      }
      continue;
    }
    if (step.kind === 'compact' || step.kind === 'goal') {
      if (!fallback) {
        fallback = {
          index,
          kind: step.kind,
          title: step.kind === 'compact' ? '上下文压缩' : '目标检查',
          text: String(step.text || step.label || ''),
          streaming: false,
        };
      }
    }
  }
  const text = String(msg.text || '');
  if (text) {
    return { index: -1, kind: 'text', title: '回复', text, streaming: false };
  }
  if (waiting) return waiting;
  if (fallback) return fallback;
  return {
    index: -1,
    kind: 'text',
    title: '回复',
    text: '',
    streaming: Boolean(streaming),
  };
}

function renderCompactAgentMessage(msg, msgIndex, container, streaming) {
  const block = latestCompactBlock(msg, streaming);
  const key =
    block.index >= 0
      ? stepCardKey(msgIndex, block.index)
      : agentCardKey(msgIndex);
  const card = textCard({
    key,
    kind: block.kind === 'thinking' ? 'thinking' : 'agent',
    title: block.title,
    meta: '',
    text: block.text,
    streaming: block.streaming,
    primary: true,
    onInspect:
      block.index >= 0 ? () => inspectStep(msg, msg.steps[block.index]) : null,
  });
  card.classList.add('compact-latest', `compact-${block.kind}`);
  card.addEventListener(
    'dblclick',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, textarea')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openLiveReplyViewer(msg, msgIndex);
    },
    true
  );
  appendRow(card, {}, container);
}

function renderAgentMessage(msg, msgIndex, container) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  const rich = isRichTrace(steps);
  const streaming = state.streaming && msg === state.streamMessage;

  if (state.chatWindow && state.chatCompact) {
    renderCompactAgentMessage(msg, msgIndex, container, streaming);
    return;
  }

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
    appendSpecialSteps(msg, msgIndex, container);
    return;
  }

  const preambleText = preambleTextIndexes(steps);
  const lastTextIndex = finalTextIndex(steps, preambleText);
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
    // While waiting for the first token there is no reply card yet. Keep the
    // process group open so the thinking placeholder (and its blinking cursor)
    // stays visible even in questions/replies view or a previously collapsed
    // process group.
    const forceProcessOpen = streaming && lastTextIndex < 0;
    const collapsed = forceProcessOpen
      ? false
      : modeCollapsed === null
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
      const thinking = step.kind === 'thinking' || preambleText.has(index);
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
  appendSpecialSteps(msg, msgIndex, container);
}

function mcpBlockServerEnabled(session, server) {
  if (server.enabled === false) return false;
  const disabled = Array.isArray(session.mcpDisabled)
    ? session.mcpDisabled
    : [];
  if (disabled.includes('*')) return false;
  return !disabled.includes(server.id);
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

function backgroundStatusLabel(status) {
  if (status === 'running') return '运行中';
  if (status === 'done') return '完成';
  if (status === 'error') return '失败';
  if (status === 'timeout') return '超时';
  if (status === 'cancelled') return '已停止';
  return status || '未知';
}

function backgroundElapsed(job) {
  const start = Number(job?.startedAt) || 0;
  const end =
    Number(job?.endedAt) ||
    (job?.status === 'running' ? Date.now() : start);
  return formatDuration(Math.max(0, end - start));
}

function renderBackgroundBadge() {
  if (!dom.backgroundBadge) return;
  const session = currentSession();
  if (!session || state.background.sessionId !== session.id) {
    dom.backgroundBadge.classList.add('hidden');
    return;
  }
  const jobs = state.background.jobs;
  const running = jobs.filter((job) => job.status === 'running').length;
  dom.backgroundBadge.classList.toggle('hidden', jobs.length === 0);
  dom.backgroundBadge.classList.toggle('running', running > 0);
  if (dom.backgroundBadgeCount) {
    dom.backgroundBadgeCount.textContent = String(running);
  }
  dom.backgroundBadge.setAttribute(
    'aria-label',
    `后台任务：${running} 个运行中，共 ${jobs.length} 个`
  );
  dom.backgroundBadge.setAttribute(
    'aria-expanded',
    dom.backgroundOverlay &&
      !dom.backgroundOverlay.classList.contains('hidden')
      ? 'true'
      : 'false'
  );
}

function backgroundOutputPreview(job) {
  const output = String(job?.outputPreview || '').trimEnd();
  const stderr = String(job?.stderrPreview || '').trimEnd();
  if (output && stderr) {
    return `--- stdout ---\n${output}\n\n--- stderr ---\n${stderr}`;
  }
  if (output) return output;
  if (stderr) return stderr;
  return '';
}

function renderBackgroundJob(job) {
  const card = el('div', 'background-card');
  const head = el('div', 'background-card-head');
  head.append(
    el('div', 'background-note', job.note || '未命名后台任务')
  );
  head.append(
    el(
      'span',
      `background-status ${job.status || 'running'}`,
      backgroundStatusLabel(job.status)
    )
  );
  card.append(head);
  card.append(el('div', 'background-command', job.command || ''));
  const meta = [
    backgroundElapsed(job),
    job.exitCode !== null && job.exitCode !== undefined
      ? `exit ${job.exitCode}`
      : '',
    job.cwd || '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (meta) card.append(el('div', 'background-meta', meta));
  if (job.status === 'running') {
    const actions = el('div', 'background-actions');
    const stop = el('button', 'pill compact', '停止');
    stop.type = 'button';
    stop.addEventListener('click', () => void stopBackgroundJob(job));
    actions.append(stop);
    card.append(actions);
  }
  const preview = backgroundOutputPreview(job);
  if (preview) {
    const details = el('details', 'background-output');
    details.append(el('summary', '', '输出'));
    details.append(el('pre', '', preview));
    card.append(details);
  }
  return card;
}

function renderBackgroundPanel() {
  if (
    !dom.backgroundOverlay ||
    dom.backgroundOverlay.classList.contains('hidden')
  ) {
    return;
  }
  const jobs = state.background.jobs;
  const running = jobs.filter((job) => job.status === 'running').length;
  if (dom.backgroundSummary) {
    dom.backgroundSummary.textContent = jobs.length
      ? `${running} 个运行中 · 共 ${jobs.length} 个`
      : '还没有后台任务';
  }
  if (!dom.backgroundList) return;
  dom.backgroundList.replaceChildren();
  if (jobs.length === 0) {
    dom.backgroundList.append(
      el('div', 'background-empty', '还没有后台任务')
    );
    return;
  }
  for (const job of jobs) {
    dom.backgroundList.append(renderBackgroundJob(job));
  }
}

function openBackgroundPanel() {
  if (!dom.backgroundOverlay) return;
  dom.backgroundOverlay.classList.remove('hidden');
  dom.backgroundOverlay.setAttribute('aria-hidden', 'false');
  dom.backgroundBadge?.setAttribute('aria-expanded', 'true');
  renderBackgroundPanel();
  void loadBackgroundJobs(currentSession()?.id, true);
}

function closeBackgroundPanel() {
  if (!dom.backgroundOverlay) return;
  dom.backgroundOverlay.classList.add('hidden');
  dom.backgroundOverlay.setAttribute('aria-hidden', 'true');
  dom.backgroundBadge?.setAttribute('aria-expanded', 'false');
}

function scheduleBackgroundPoll() {
  clearTimeout(state.backgroundPollTimer);
  state.backgroundPollTimer = null;
  if (!state.background.jobs.some((job) => job.status === 'running')) return;
  state.backgroundPollTimer = setTimeout(() => {
    void loadBackgroundJobs(currentSession()?.id, true);
  }, 3000);
}

async function loadBackgroundJobs(sessionId = currentSession()?.id, force = false) {
  const id = String(sessionId || '');
  if (!id) {
    state.background = {
      sessionId: null,
      jobs: [],
      loading: false,
      fetchedAt: 0,
    };
    renderBackgroundBadge();
    return;
  }
  if (
    !force &&
    state.background.sessionId === id &&
    Date.now() - state.background.fetchedAt < 4000
  ) {
    return;
  }
  state.background.loading = true;
  try {
    const data = await api.loadBackground(id);
    if (currentSession()?.id !== id) return;
    state.background = {
      sessionId: id,
      jobs: Array.isArray(data?.jobs) ? data.jobs : [],
      loading: false,
      fetchedAt: Date.now(),
    };
    renderBackgroundBadge();
    renderBackgroundPanel();
    scheduleBackgroundPoll();
  } catch (error) {
    console.error('load background jobs failed', error);
    state.background.loading = false;
  }
}

function mergeBackgroundJob(job) {
  if (!job?.id) return;
  const sessionId = String(job.sessionId || '');
  if (!sessionId || sessionId !== currentSession()?.id) return;
  if (state.background.sessionId !== sessionId) {
    state.background = {
      sessionId,
      jobs: [],
      loading: false,
      fetchedAt: Date.now(),
    };
  }
  const index = state.background.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    state.background.jobs[index] = {
      ...state.background.jobs[index],
      ...job,
    };
  } else {
    state.background.jobs.push(job);
  }
  renderBackgroundBadge();
  renderBackgroundPanel();
  scheduleBackgroundPoll();
}

async function stopBackgroundJob(job) {
  const session = currentSession();
  if (!session || !job?.id) return;
  try {
    const data = await api.stopBackground(session.id, job.id);
    if (data?.job) mergeBackgroundJob(data.job);
    else void loadBackgroundJobs(session.id, true);
  } catch (error) {
    console.error('stop background job failed', error);
  }
}

function handleBackgroundUpdate(payload) {
  if (!payload?.id) return;
  mergeBackgroundJob(payload);
}

function handleBackgroundComplete(payload) {
  if (!payload?.id) return;
  mergeBackgroundJob(payload);
}

async function resumeBackgroundQueue(session) {
  if (!session || session.frozen || session.subagent) return;
  if (isCompacting(session)) return;
  if (
    !Array.isArray(session.pendingQueue) ||
    session.pendingQueue.length === 0
  ) {
    return;
  }
  if (session !== currentSession()) return;
  if (state.streaming) {
    let active = false;
    try {
      const data = await api.activeRun(session.id);
      active = Boolean(data?.runId);
    } catch {
      active = false;
    }
    if (active) return;
    state.streaming = false;
    state.requestId = null;
    state.streamMessage = null;
    renderAll();
  }
  const first = session.pendingQueue[0];
  if (
    first &&
    typeof first === 'object' &&
    (first.background === true || first.subagent === true)
  ) {
    processNextQueuedPrompt(session);
  }
}

function handleSubagentStarted(payload) {
  if (!payload?.sessionId) return;
  if (state.sessions.some((session) => session.id === payload.sessionId)) {
    return;
  }
  const parent = state.sessions.find(
    (session) => session.id === payload.parentSessionId
  );
  const session = {
    id: payload.sessionId,
    title: payload.title || 'Subagent',
    system: parent?.system || DEFAULT_SYSTEM_PROMPT,
    agentsMd: parent?.agentsMd || null,
    agentId: parent?.agentId || DEFAULT_AGENT_ID,
    projectId: parent?.projectId || null,
    frozen: true,
    subagent: true,
    parentSessionId: payload.parentSessionId || null,
    mcpDisabled: parent?.mcpDisabled || [],
    foldState: null,
    pendingQueue: [],
    msgs: [],
    subagentRunId: payload.runId || null,
  };
  const parentIndex = parent ? state.sessions.indexOf(parent) : -1;
  const insertAt =
    parentIndex >= 0 ? parentIndex + 1 : state.sessions.length;
  state.sessions.splice(insertAt, 0, session);
  if (insertAt <= state.current) state.current += 1;
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();
  window.refreshCanvas?.();
}

function handleSubagentComplete(payload) {
  if (!payload?.sessionId) return;
  const parent = state.sessions.find(
    (session) => session.id === payload.parentSessionId
  );
  if (!parent || parent.frozen || parent.subagent) return;
  const item = payload.queueItem;
  if (!item?.text) return;
  const queue = Array.isArray(parent.pendingQueue)
    ? parent.pendingQueue
    : (parent.pendingQueue = []);
  if (
    queue.some(
      (entry) => entry?.subagentSessionId === payload.sessionId
    )
  ) {
    return;
  }
  queue.push({
    text: item.text,
    skills: [],
    agentId: item.agentId || parent.agentId || DEFAULT_AGENT_ID,
    subagent: true,
    subagentSessionId: payload.sessionId,
    note: item.note || payload.title || '',
  });
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
  if (!state.homeWindow && parent === currentSession()) {
    void resumeBackgroundQueue(parent);
  }
  window.refreshCanvas?.();
}

function buildMcpSummary(session, onClick) {
  const block = el('div', 'context-block mcp-summary');
  const head = el('button', 'context-head');
  head.type = 'button';
  head.setAttribute(
    'aria-label',
    `MCP ${mcpSummaryText(session)}，点击配置`
  );
  head.append(el('span', 'context-dot'));
  head.append(el('span', 'context-title', 'MCP'));
  head.append(el('span', 'mcp-summary-count', mcpSummaryText(session)));
  head.addEventListener('click', onClick);
  block.append(head);
  return block;
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
        state.mcpServersLoading ? '加载中…' : '还没有 MCP 服务器'
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
          Array.isArray(session.mcpDisabled) &&
            session.mcpDisabled.includes('*')
            ? state.mcpServers.map((item) => item.id)
            : Array.isArray(session.mcpDisabled)
              ? session.mcpDisabled
              : []
        );
        if (disabled.has(server.id)) disabled.delete(server.id);
        else disabled.add(server.id);
        session.mcpDisabled = [...disabled].filter((id) => id !== '*');
        void saveChatsNow().finally(() => void loadSkills(true));
        renderMcpConfig();
        renderMcpSummary(session);
        if (state.composerOpen) renderComposerContext();
      });
    }
    dom.mcpConfigGrid.append(button);
  }
}

function agentForSession(session) {
  const agentId = String(session?.agentId || DEFAULT_AGENT_ID);
  return (
    state.agents.find((agent) => agent.id === agentId) ||
    state.agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ||
    null
  );
}

function systemPromptText(session) {
  const value = String(session?.system || '').trim();
  if (!value || value === DEFAULT_SYSTEM_PROMPT) return '';
  return value;
}

function agentPromptText(session) {
  return String(agentForSession(session)?.prompt || '').trim();
}

function systemInfoKey(session) {
  const project = state.projects.find((item) => item.id === session?.projectId);
  return `${session?.id || ''}|${projectDirectories(project).join('\u0000')}`;
}

function systemInfoText(session) {
  const cache = state.systemInfo;
  if (cache.key !== systemInfoKey(session)) return 'LOADING…';
  if (cache.text) return cache.text;
  if (cache.error) return `SYSTEMINFO unavailable: ${cache.error}`;
  return 'LOADING…';
}

function ensureSystemInfo(session) {
  if (!session) return;
  const key = systemInfoKey(session);
  const cache = state.systemInfo;
  if (cache.key === key && (cache.loading || cache.text || cache.error)) return;
  const request = cache.request + 1;
  state.systemInfo = { key, loading: true, text: '', error: '', request };
  api
    .loadSystemInfo(session.id)
    .then((data) => {
      if (state.systemInfo.request !== request) return;
      const text = String(data?.text || '').trim();
      state.systemInfo = {
        key,
        loading: false,
        text,
        error: text ? '' : 'no data',
        request,
      };
      refreshContextBlocks();
    })
    .catch((error) => {
      if (state.systemInfo.request !== request) return;
      state.systemInfo = {
        key,
        loading: false,
        text: '',
        error: error instanceof Error ? error.message : String(error),
        request,
      };
      refreshContextBlocks();
    });
}

function contextBlock(title, text, key) {
  const value = String(text || '').trim();
  const empty = !value;
  const collapsed = !empty && state.contextCollapsed.has(key);
  const block = el('div', 'context-block');
  if (empty) block.classList.add('empty');
  if (collapsed) block.classList.add('collapsed');
  const head = el(empty ? 'div' : 'button', 'context-head');
  if (!empty) head.type = 'button';
  head.setAttribute('aria-expanded', String(!empty && !collapsed));
  if (empty) head.setAttribute('aria-disabled', 'true');
  head.append(el('span', 'context-dot'));
  head.append(el('span', 'context-title', title));
  if (empty) head.append(el('span', 'context-meta', 'EMPTY'));
  block.append(head);
  if (empty) return block;
  const body = el('div', 'context-body');
  body.setAttribute('aria-hidden', String(collapsed));
  const clip = el('div', 'context-body-clip');
  const inner = el('div', 'context-body-inner');
  inner.append(el('pre', 'context-text', value));
  clip.append(inner);
  body.append(clip);
  block.append(body);
  head.addEventListener('click', () => {
    const nextCollapsed = block.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!nextCollapsed));
    body.setAttribute('aria-hidden', String(nextCollapsed));
    if (nextCollapsed) state.contextCollapsed.add(key);
    else state.contextCollapsed.delete(key);
    persistFoldState();
  });
  return block;
}

function nodeRoleText(session) {
  if (!session) return '';
  if (session.nodeRole === 'manager') {
    const team = state.sessions.filter(
      (item) => item.managerId === session.id && !item.archivedAt
    );
    const dirs = Array.isArray(session.nodeConfig?.directories)
      ? session.nodeConfig.directories
      : [];
    const files = Array.isArray(session.nodeConfig?.files)
      ? session.nodeConfig.files
      : [];
    return [
      `Agent: ${agentForSession(session)?.name || session.agentId}`,
      `目录: ${dirs.join(' · ') || '无'}`,
      `文件: ${files.join(' · ') || '无'}`,
      `工作 node: ${team.length}`,
      '在对话里拆任务，工作 node 由它创建和分配。',
    ].join('\n');
  }
  if (session.nodeRole === 'work') {
    const manager = state.sessions.find(
      (item) => item.id === session.managerId
    );
    const config = session.nodeConfig || {};
    return [
      `管理 node: ${manager?.title || session.managerId || '未归属'}`,
      `Agent: ${agentForSession(session)?.name || session.agentId}`,
      `任务: ${config.task || '未设置'}`,
      `工具: ${Array.isArray(config.tools) ? config.tools.length : '跟随 Agent'}`,
      `Skill: ${Array.isArray(config.skills) ? config.skills.length : '跟随 Agent'}`,
      `MCP 关闭: ${(session.mcpDisabled || []).join(', ') || '无'}`,
    ].join('\n');
  }
  return '';
}

function buildContextGroup(blocks) {
  const collapsed = state.contextGroupCollapsed;
  const group = el('div', 'context-group');
  if (collapsed) group.classList.add('collapsed');
  const head = el('button', 'context-group-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(!collapsed));
  head.setAttribute('aria-label', '上下文');
  head.append(el('span', 'context-group-dot'));
  head.append(el('span', 'context-group-title', 'CONTEXT'));
  head.append(el('span', 'context-group-count', String(blocks.length)));
  const chevron = el('span', 'context-group-chevron');
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  head.append(chevron);
  const body = el('div', 'context-group-body');
  body.append(...blocks);
  head.addEventListener('click', () => {
    const nextCollapsed = group.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!nextCollapsed));
    state.contextGroupCollapsed = nextCollapsed;
    persistFoldState();
  });
  group.append(head, body);
  return group;
}

function buildContextStack(session) {
  const stack = el('div', 'context-stack');
  renderMcpSummary(session, stack);
  const roleText = nodeRoleText(session);
  if (roleText) {
    stack.append(
      contextBlock(
        session.nodeRole === 'manager' ? 'MANAGER' : 'WORK NODE',
        roleText,
        'role'
      )
    );
  }
  stack.append(
    buildContextGroup([
      contextBlock('SYSTEM PROMPT', systemPromptText(session), 'system'),
      contextBlock('AGENT PROMPT', agentPromptText(session), 'agent'),
      contextBlock('SYSTEMINFO', systemInfoText(session), 'systeminfo'),
      contextBlock('SAFETY PROMPT', session?.safetyPrompt, 'safety'),
      contextBlock('AGENTS.MD', session.agentsMd, 'agents'),
    ])
  );
  return stack;
}

function renderContextBlocks(session, container) {
  ensureSystemInfo(session);
  container.append(buildContextStack(session));
}

function refreshContextBlocks() {
  const session = currentSession();
  if (!session) return;
  const existing = dom.messages.querySelector('.context-stack');
  if (!existing) return;
  ensureSystemInfo(session);
  existing.replaceWith(buildContextStack(session));
}

function setupChatWindow() {
  if (!state.chatWindow || state.chatNav) return;
  document.body.classList.add('chat-window');
  const nav = el('nav', 'chat-turn-nav');
  nav.setAttribute('aria-label', '对话跳转');
  document.body.append(nav);
  state.chatNav = nav;
  dom.messages.addEventListener(
    'scroll',
    () => {
      if (!state.chatWindow) return;
      requestAnimationFrame(updateChatTurnActive);
    },
    { passive: true }
  );
  dom.webContent?.addEventListener('click', (event) => {
    if (document.body.classList.contains('canvas-window-dragging')) return;
    if (event.target === dom.webContent) closeWebContent();
  });
  state.viewMode = 'questions';
  setChatCompact(true, { preserveTurn: false });
}

function setChatCompact(compact, { preserveTurn = true } = {}) {
  if (!state.chatWindow) return;
  const activeTurn = Number.isInteger(state.chatTurnIndex)
    ? state.chatTurnIndex
    : -1;
  state.chatCompact = Boolean(compact);
  document.body.classList.toggle('chat-compact', state.chatCompact);
  for (const card of dom.messages.querySelectorAll(
    '.message-card.prompt-card, .message-card.answer-card'
  )) {
    const wrap = card.querySelector('.card-body-wrap');
    if (!wrap) continue;
    wrap.inert = state.chatCompact
      ? false
      : card.classList.contains('collapsed');
  }
  renderMessages({ animate: false });
  requestAnimationFrame(() => {
    updateChatTurnActive();
    if (preserveTurn && activeTurn >= 0) pinChatTurn(activeTurn);
  });
}

const CHAT_TURN_BASE_WIDTH = 26;
const CHAT_TURN_PEAK_EXTRA = 24;
const CHAT_TURN_BUMP_SIGMA = 1.15;

function scheduleChatTurnNav() {
  if (!state.chatWindow) return;
  clearTimeout(state.chatNavTimer);
  state.chatNavTimer = setTimeout(() => {
    state.chatNavTimer = null;
    renderChatTurnNav();
  }, 60);
}

function renderChatTurnNav() {
  if (!state.chatWindow || !state.chatNav) return;
  const session = currentSession();
  document.title = `YAH - ${session?.title || 'Chat'}`;

  const turns = [...dom.messages.querySelectorAll('.turn')].filter((turn) =>
    turn.querySelector('.prompt-card')
  );
  const turnText = (turn) => {
    const card = turn.querySelector('.prompt-card');
    const text = String(card?.querySelector('.card-text')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
    const count = card?.querySelectorAll('.prompt-image').length || 0;
    return count ? `${count} 张图片` : '';
  };
  const signature = turns.map(turnText).join('\u0000');
  if (signature !== state.chatNavSignature) {
    state.chatNavSignature = signature;
    state.chatNav.replaceChildren();
    state.chatNav.classList.toggle('empty', turns.length === 0);
    if (turns.length > 0) {
      const texts = turns.map(turnText);
      turns.forEach((turn, index) => {
        const text = texts[index];
        const bar = el('button', 'chat-turn-bar');
        bar.type = 'button';
        bar.title = `第 ${index + 1} 轮 · ${text.slice(0, 90)}`;
        bar.setAttribute(
          'aria-label',
          `跳到第 ${index + 1} 轮对话`
        );
        bar.style.setProperty('--bar-width', `${CHAT_TURN_BASE_WIDTH}px`);
        bar.addEventListener('click', () => scrollChatTurn(index));
        state.chatNav.append(bar);
      });
    }
  }
  updateChatTurnActive();
}

function updateChatTurnActive() {
  if (!state.chatWindow || !state.chatNav) return;
  const turns = [...dom.messages.querySelectorAll('.turn')].filter((turn) =>
    turn.querySelector('.prompt-card')
  );
  const bars = [...state.chatNav.querySelectorAll('.chat-turn-bar')];
  if (turns.length === 0 || bars.length === 0) {
    state.chatTurnIndex = -1;
    return;
  }
  const top = dom.messages.getBoundingClientRect().top;
  let active = 0;
  const atBottom =
    dom.messages.scrollHeight -
      dom.messages.scrollTop -
      dom.messages.clientHeight <
    32;
  if (atBottom) {
    active = turns.length - 1;
  } else {
    turns.forEach((turn, index) => {
      const turnTop = turn.getBoundingClientRect().top - top;
      if (turnTop <= 84) active = index;
    });
  }
  state.chatTurnIndex = active;
  bars.forEach((bar, index) => {
    const distance = Math.abs(index - active);
    const factor = Math.exp(
      -(distance * distance) /
        (2 * CHAT_TURN_BUMP_SIGMA * CHAT_TURN_BUMP_SIGMA)
    );
    const width = Math.round(
      CHAT_TURN_BASE_WIDTH + CHAT_TURN_PEAK_EXTRA * factor
    );
    bar.style.setProperty('--bar-width', `${width}px`);
    bar.classList.toggle('active', index === active);
  });
}

function scrollChatTurn(index) {
  const turns = [...dom.messages.querySelectorAll('.turn')].filter((turn) =>
    turn.querySelector('.prompt-card')
  );
  const turn = turns[index];
  if (!turn) return;
  const container = dom.messages;
  const top =
    turn.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  state.followBottom = false;
  state.forceScroll = false;
  container.scrollTop = Math.max(0, top - 18);
  updateChatTurnActive();
}

function pinChatTurn(index, duration = 360) {
  const started = performance.now();
  const step = () => {
    scrollChatTurn(index);
    if (performance.now() - started < duration) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

function renderMessages({ animate = true } = {}) {
  if (state.chatWindow) scheduleChatTurnNav();
  const session = currentSession();
  const sessionId = session ? session.id : null;
  const version = ++state.renderVersion;
  const changed = state.renderedSessionId !== sessionId;
  const previousKeys = changed
    ? new Set()
    : new Set(state.renderedOpenKeys);
  const prevTop = dom.messages.scrollTop;
  const stick = state.forceScroll || state.followBottom;
  state.forceScroll = false;

  dom.messages.replaceChildren();
  if (session) {
    renderContextBlocks(session, dom.messages);
  }
  if (!session) {
    state.openCardKey = null;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = null;
    dom.messages.append(
      el(
        'div',
        'empty',
        state.projects.length === 0 ? '还没有项目' : '还没有对话'
      )
    );
    return;
  }
  if (session.msgs.length === 0) {
    state.openCardKey = null;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = sessionId;
    dom.messages.append(
      el(
        'div',
        'empty',
        session.subagent
          ? '子代理对话 · 只读'
          : session.frozen
            ? '对话已冻结'
            : '还没有消息'
      )
    );
    return;
  }

  let currentTurn = null;
  session.msgs.forEach((msg, index) => {
    if (msg.role === 'Compact') {
      currentTurn = null;
      const turn = el('section', 'turn compact-turn');
      turn.append(renderCompactMessage(msg, `compact:${index}`));
      dom.messages.append(turn);
      return;
    }
    if (msg.role === 'User') {
      currentTurn = el('section', 'turn');
      dom.messages.append(currentTurn);
      appendRow(
        promptCard({
          key: messageCardKey(index),
          text: msg.text,
          images: msg.images,
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

  if (state.compactStatus?.sessionId === session.id) {
    const turn = el('section', 'turn compact-turn');
    turn.append(renderCompactStatus(state.compactStatus));
    dom.messages.append(turn);
  }
  if (session.frozen) {
    dom.messages.append(
      el(
        'div',
        'frozen-note',
        session.subagent ? '子代理对话 · 只读' : '对话已冻结'
      )
    );
  }

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

  if (state.streaming && state.streamMessage) {
    const liveIndex = session.msgs.indexOf(state.streamMessage);
    if (liveIndex >= 0) syncLiveReplyViewer(state.streamMessage, liveIndex);
  }

  requestAnimationFrame(() => {
    if (state.renderVersion !== version) return;
    stickStreamingText(
      dom.messages.querySelector('.message-card.streaming')
    );
    if (stick) scrollMessagesTo(dom.messages.scrollHeight);
    else dom.messages.scrollTop = prevTop;
  });
}

function renderSwitcher() {
  ensureProjects();
  const project =
    state.projects.find((item) => item.id === state.switcherProjectId) ||
    state.projects[0] ||
    null;
  state.switcherProjectId = project?.id || null;
  const sessions = project ? sessionsInProject(project.id) : [];

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
  if (!project) {
    state.switcherIndex = 0;
    dom.switcherList.append(
      el('div', 'switcher-empty', '先创建一个项目')
    );
    return;
  }
  if (sessions.length === 0) {
    state.switcherIndex = 0;
    dom.switcherList.append(
      el('div', 'switcher-empty', '还没有对话')
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
    if (session.frozen) {
      top.append(
        el('span', 'switch-frozen', session.subagent ? '子代理' : '冻结')
      );
    }

    card.dataset.index = String(localIndex);
    card.dataset.sessionId = session.id;
    card.addEventListener('click', () => selectSession(globalIndex));
    card.addEventListener('mouseenter', () => highlightSwitcher(localIndex));

    card.append(top);
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
  if (state.homeWindow) return;
  const session = currentSession();
  if (
    state.composerOpen ||
    !session ||
    session.frozen ||
    session.subagent ||
    isCompacting(session)
  ) {
    return;
  }
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (!dom.rawOverlay.classList.contains('hidden')) return;
  if (state.switcherOpen) return;
  if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) return;

  state.composerOpen = true;
  dom.composer.inert = false;
  dom.composer.setAttribute('aria-hidden', 'false');
  dom.composer.classList.add('open');
  dom.input.placeholder = state.streaming ? '输入排队消息…' : '输入消息，拖入或粘贴图片…';
  renderComposerImages();
  renderComposerContext();
  renderComposerSkills();
  updateSendState();
  void loadSkills(true);
  void loadAgents(true);
  requestAnimationFrame(() => {
    if (!state.composerOpen) return;
    dom.input.focus();
    const end = dom.input.value.length;
    dom.input.setSelectionRange(end, end);
  });
}

function closeComposer() {
  closeAgentMenu();
  closeModelMenu();
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
    session?.projectId || state.projects[0]?.id || null;
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
  } else {
    const session = state.sessions.find((item) => item.id === id);
    if (!session || session.nodeRole === 'manager') return;
    current = session.title;
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
  window.refreshCanvas?.();
}

function projectDirectories(project) {
  return Array.isArray(project?.directories) ? project.directories : [];
}

function showProjectError(message) {
  if (!dom.projectError) return;
  dom.projectError.textContent = message;
  dom.projectError.classList.toggle('hidden', !message);
}

function renderProjectDialogDirs() {
  if (!dom.projectDirs) return;
  dom.projectDirs.replaceChildren();
  const dirs = projectDialog?.directories || [];
  dom.projectDirs.hidden = dirs.length === 0;
  if (dirs.length > 0) {
    dirs.forEach((dir, index) => {
      const row = el('div', 'project-dir');
      row.append(el('span', 'project-dir-path', dir));
      const remove = el('button', 'project-dir-remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', '移除目录');
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener('click', () => {
        if (!projectDialog) return;
        projectDialog.directories.splice(index, 1);
        renderProjectDialogDirs();
      });
      row.append(remove);
      dom.projectDirs.append(row);
    });
  }
  dom.projectSave.disabled =
    !projectDialog ||
    !String(projectDialog.name || '').trim() ||
    dirs.length === 0;
}

function openProjectDialog(mode = 'new', projectId = null) {
  if (!dom.projectOverlay) return;
  const editing = mode === 'edit';
  const project = editing
    ? state.projects.find((item) => item.id === projectId)
    : null;
  if (editing && !project) return;
  projectDialog = {
    mode: editing ? 'edit' : 'new',
    projectId: editing ? project.id : null,
    name: editing ? project.name : `Project ${state.projects.length + 1}`,
    directories: editing ? [...projectDirectories(project)] : [],
  };
  dom.projectName.value = projectDialog.name;
  dom.projectSave.textContent = editing ? 'Save' : 'Create';
  showProjectError('');
  renderProjectDialogDirs();
  dom.projectOverlay.classList.remove('hidden');
  dom.projectOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    dom.projectName.focus();
    dom.projectName.setSelectionRange(0, dom.projectName.value.length);
  });
}

function closeProjectDialog() {
  if (!dom.projectOverlay) return;
  projectDialog = null;
  dom.projectOverlay.classList.add('hidden');
  dom.projectOverlay.setAttribute('aria-hidden', 'true');
}

async function addProjectDirectory(target) {
  const raw = String(target || '').trim();
  if (!raw || !projectDialog) return;
  const isDir = await api.isDirectory(raw);
  if (!isDir) {
    showProjectError(`不是文件夹：${raw}`);
    return;
  }
  if (
    projectDialog.directories.some(
      (dir) => dir.toLowerCase() === raw.toLowerCase()
    )
  ) {
    return;
  }
  projectDialog.directories.push(raw);
  showProjectError('');
  renderProjectDialogDirs();
}

function saveProjectDialog() {
  if (!projectDialog) return;
  const name = String(projectDialog.name || '').trim();
  if (!name) {
    showProjectError('填写项目名称');
    return;
  }
  if (projectDialog.directories.length === 0) {
    showProjectError('至少选择一个目录');
    return;
  }
  if (projectDialog.mode === 'edit') {
    const project = state.projects.find(
      (item) => item.id === projectDialog.projectId
    );
    if (!project) {
      closeProjectDialog();
      return;
    }
    project.name = name;
    project.directories = [...projectDialog.directories];
  } else {
    const project = {
      id: makeId(),
      name,
      directories: [...projectDialog.directories],
    };
    state.projects.push(project);
    state.switcherProjectId = project.id;
  }
  closeProjectDialog();
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();
  renderAll();
}

function showNextToolApproval() {
  if (!dom.approvalOverlay) return;
  if (state.activeApproval) return;
  const next = state.approvalQueue.shift();
  if (!next) {
    state.activeApproval = null;
    dom.approvalOverlay.classList.add('hidden');
    dom.approvalOverlay.setAttribute('aria-hidden', 'true');
    return;
  }
  state.activeApproval = next;
  dom.approvalTool.textContent = next.tool || 'file';
  dom.approvalPath.textContent = next.path || '';
  dom.approvalDirs.replaceChildren();
  const dirs = Array.isArray(next.allowedDirs) ? next.allowedDirs : [];
  if (dirs.length === 0) {
    dom.approvalDirs.append(
      el('div', 'approval-dir', '还没有开发目录')
    );
  } else {
    for (const dir of dirs) {
      dom.approvalDirs.append(el('div', 'approval-dir', dir));
    }
  }
  dom.approvalOverlay.classList.remove('hidden');
  dom.approvalOverlay.setAttribute('aria-hidden', 'false');
}

function enqueueToolApproval(payload) {
  if (!payload?.id) return;
  if (state.handledApprovals.has(payload.id)) return;
  if (state.activeApproval?.id === payload.id) return;
  if (state.approvalQueue.some((item) => item.id === payload.id)) return;
  state.approvalQueue.push(payload);
  if (!state.activeApproval) showNextToolApproval();
}

function markApprovalHandled(approvalId) {
  state.handledApprovals.add(approvalId);
  if (state.handledApprovals.size <= 500) return;
  const oldest = state.handledApprovals.values().next().value;
  state.handledApprovals.delete(oldest);
}

async function resolveToolApproval(approved) {
  const current = state.activeApproval;
  if (!current) return;
  state.activeApproval = null;
  dom.approvalOverlay.classList.add('hidden');
  dom.approvalOverlay.setAttribute('aria-hidden', 'true');
  let settled = false;
  try {
    await api.resolveApproval(current.id, approved);
    settled = true;
  } catch (error) {
    console.error('resolve approval failed', error);
    // 404 means the run already moved past this approval.
    settled = error?.status === 404;
  }
  if (settled) {
    markApprovalHandled(current.id);
  } else {
    // Keep the dialog available so the user can retry instead of
    // leaving the run waiting on an approval nobody can answer.
    enqueueToolApproval(current);
  }
  if (!state.activeApproval) showNextToolApproval();
}

function clearToolApprovals() {
  for (const item of state.approvalQueue) markApprovalHandled(item.id);
  if (state.activeApproval) markApprovalHandled(state.activeApproval.id);
  state.approvalQueue = [];
  state.activeApproval = null;
  if (!dom.approvalOverlay) return;
  dom.approvalOverlay.classList.add('hidden');
  dom.approvalOverlay.setAttribute('aria-hidden', 'true');
}

function stripRecommended(label) {
  return String(label || '').replace(
    /\s*(?:\(\s*recommended\s*\)|（\s*推荐\s*）)\s*$/i,
    ''
  );
}

function isRecommended(label) {
  return /(?:\(\s*recommended\s*\)|（\s*推荐\s*）)\s*$/i.test(
    String(label || '')
  );
}

function questionDraft(question) {
  return {
    selected: [],
    custom: '',
    customActive: Array.isArray(question.options)
      ? question.options.length === 0
      : true,
  };
}

function questionHasAnswer(draft) {
  if (!draft) return false;
  return (
    (Array.isArray(draft.selected) && draft.selected.length > 0) ||
    String(draft.custom || '').trim().length > 0
  );
}

function clearQuestionTimer() {
  if (state.questionTimer) {
    clearInterval(state.questionTimer);
    state.questionTimer = null;
  }
}

function questionRemainingMs(active) {
  if (!active || active.mode !== 'timed' || !active.deadline) return 0;
  return Math.max(0, active.deadline - Date.now());
}

function renderQuestionTimer() {
  const active = state.activeQuestion;
  const timed =
    active?.mode === 'timed' && Number(active.timeoutSeconds) > 0;
  if (dom.questionTimer) {
    dom.questionTimer.classList.toggle('hidden', !timed);
    dom.questionTimer.classList.toggle(
      'urgent',
      timed && questionRemainingMs(active) <= 10_000
    );
  }
  if (!timed) {
    if (dom.questionTimerValue) dom.questionTimerValue.textContent = '';
    if (dom.questionTimerProgress) {
      dom.questionTimerProgress.style.strokeDashoffset = '100';
    }
    return;
  }
  const total = active.timeoutSeconds * 1000;
  const remaining = questionRemainingMs(active);
  const ratio = Math.max(0, Math.min(1, remaining / total));
  if (dom.questionTimerValue) {
    dom.questionTimerValue.textContent = `${Math.ceil(remaining / 1000)}s`;
  }
  if (dom.questionTimerProgress) {
    dom.questionTimerProgress.style.strokeDashoffset = String(
      100 * (1 - ratio)
    );
  }
}

function startQuestionTimer() {
  clearQuestionTimer();
  const active = state.activeQuestion;
  if (!active || active.mode !== 'timed' || !active.timeoutSeconds) {
    renderQuestionTimer();
    return;
  }
  active.deadline = Date.now() + active.timeoutSeconds * 1000;
  renderQuestionTimer();
  state.questionTimer = setInterval(() => {
    const current = state.activeQuestion;
    if (!current || current !== active) {
      clearQuestionTimer();
      return;
    }
    renderQuestionTimer();
    if (Date.now() >= current.deadline) {
      clearQuestionTimer();
      void submitQuestion({ auto: true });
    }
  }, 200);
}

function resetQuestionCountdown() {
  const active = state.activeQuestion;
  if (!active || active.responding || active.mode !== 'timed') return;
  if (!active.timeoutSeconds) return;
  active.deadline = Date.now() + active.timeoutSeconds * 1000;
  renderQuestionTimer();
  const now = Date.now();
  if (now - state.questionHeartbeatAt < 400) return;
  state.questionHeartbeatAt = now;
  api.heartbeatQuestion(active.id).catch(() => {});
}

function hideQuestionDock() {
  clearQuestionTimer();
  if (!dom.questionDock) return;
  dom.questionDock.classList.add('hidden');
  dom.questionDock.setAttribute('aria-hidden', 'true');
}

function clearQuestionDock() {
  state.questionQueue = [];
  state.activeQuestion = null;
  hideQuestionDock();
}

function cancelQuestionDock() {
  const active = state.activeQuestion;
  const queued = [...state.questionQueue];
  state.questionQueue = [];
  state.activeQuestion = null;
  hideQuestionDock();
  if (active) {
    api.answerQuestion(active.id, { cancelled: true }).catch(() => {});
  }
  for (const item of queued) {
    api.answerQuestion(item.id, { cancelled: true }).catch(() => {});
  }
}

function showNextQuestion() {
  if (state.activeQuestion) return;
  const next = state.questionQueue.shift();
  if (!next) {
    state.activeQuestion = null;
    hideQuestionDock();
    return;
  }
  state.activeQuestion = {
    id: next.id,
    questions: Array.isArray(next.questions) ? next.questions : [],
    index: 0,
    drafts: (Array.isArray(next.questions) ? next.questions : []).map(
      questionDraft
    ),
    mode: next.mode === 'timed' ? 'timed' : 'blocking',
    timeoutSeconds:
      next.mode === 'timed' ? Number(next.timeoutSeconds) || 0 : 0,
    deadline: 0,
    responding: false,
    error: '',
  };
  state.questionHeartbeatAt = 0;
  dom.questionDock.classList.remove('hidden');
  dom.questionDock.setAttribute('aria-hidden', 'false');
  renderQuestionDock();
  startQuestionTimer();
}

function enqueueQuestion(payload) {
  if (!payload?.id || !Array.isArray(payload.questions)) return;
  if (payload.questions.length === 0) return;
  if (state.activeQuestion?.id === payload.id) return;
  if (state.questionQueue.some((item) => item.id === payload.id)) return;
  state.questionQueue.push(payload);
  if (!state.activeQuestion) showNextQuestion();
}

function renderQuestionProgress(active) {
  if (!dom.questionProgress) return;
  dom.questionProgress.replaceChildren();
  active.questions.forEach((question, index) => {
    const dot = el('span', 'question-progress-dot');
    if (index === active.index) dot.classList.add('current');
    if (questionHasAnswer(active.drafts[index])) dot.classList.add('answered');
    dom.questionProgress.append(dot);
  });
}

function toggleQuestionOption(index, label, multiple) {
  const active = state.activeQuestion;
  if (!active) return;
  const draft = active.drafts[index];
  if (!draft) return;
  if (multiple) {
    const at = draft.selected.indexOf(label);
    if (at >= 0) draft.selected.splice(at, 1);
    else draft.selected.push(label);
  } else {
    draft.selected = [label];
    draft.customActive = false;
    draft.custom = '';
  }
  renderQuestionDock();
}

function updateQuestionFooter() {
  const active = state.activeQuestion;
  if (!active) return;
  const question = active.questions[active.index];
  const draft = active.drafts[active.index];
  const last = active.index === active.questions.length - 1;
  if (dom.questionBack) {
    dom.questionBack.classList.toggle('hidden', active.index === 0);
    dom.questionBack.disabled = active.responding;
  }
  if (dom.questionNext) {
    dom.questionNext.textContent = active.responding
      ? '提交中…'
      : last
        ? '提交'
        : '下一步';
    dom.questionNext.disabled =
      active.responding || !questionHasAnswer(draft);
  }
  renderQuestionProgress(active);
}

function renderQuestionDock() {
  const active = state.activeQuestion;
  if (!active || !dom.questionBody) return;
  const question = active.questions[active.index];
  const draft = active.drafts[active.index];
  if (!question || !draft) return;
  dom.questionBody.replaceChildren();

  const head = el('div', 'question-head');
  if (question.header) {
    head.append(el('div', 'question-header', question.header));
  }
  head.append(el('div', 'question-text', question.question));
  dom.questionBody.append(head);

  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length > 0) {
    const list = el('div', 'question-options');
    for (const option of options) {
      const selected = draft.selected.includes(option.label);
      const button = el('button', 'question-option');
      button.type = 'button';
      if (selected) button.classList.add('selected');
      const control = el(
        'span',
        `question-control ${question.multiple ? 'checkbox' : 'radio'}`
      );
      if (selected) control.classList.add('checked');
      control.append(el('span', 'question-control-dot'));
      const body = el('div', 'question-option-text');
      const labelRow = el('div', 'question-option-label-row');
      labelRow.append(
        el('span', 'question-option-label', stripRecommended(option.label))
      );
      if (isRecommended(option.label)) {
        labelRow.append(el('span', 'question-recommended', '推荐'));
      }
      body.append(labelRow);
      if (option.description) {
        body.append(el('div', 'question-option-desc', option.description));
      }
      button.append(control, body);
      button.addEventListener('click', () =>
        toggleQuestionOption(
          active.index,
          option.label,
          question.multiple === true
        )
      );
      list.append(button);
    }

    const customButton = el('button', 'question-option question-custom-row');
    customButton.type = 'button';
    if (draft.customActive) customButton.classList.add('selected');
    const customControl = el(
      'span',
      `question-control ${question.multiple ? 'checkbox' : 'radio'}`
    );
    if (draft.customActive) customControl.classList.add('checked');
    customControl.append(el('span', 'question-control-dot'));
    const customText = el('div', 'question-option-text');
    customText.append(el('div', 'question-option-label', '其他（自己输入）'));
    customButton.append(customControl, customText);
    customButton.addEventListener('click', () => {
      draft.customActive = !draft.customActive;
      if (!draft.customActive) draft.custom = '';
      else if (question.multiple !== true) draft.selected = [];
      renderQuestionDock();
    });
    list.append(customButton);
    dom.questionBody.append(list);
  }

  if (draft.customActive || options.length === 0) {
    const input = el('textarea', 'question-custom-input');
    input.rows = 2;
    input.placeholder = '输入你的答案…';
    input.value = draft.custom;
    input.addEventListener('input', () => {
      draft.custom = input.value;
      updateQuestionFooter();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submitQuestion();
      }
    });
    dom.questionBody.append(input);
    requestAnimationFrame(() => input.focus());
  }

  if (active.error) {
    dom.questionBody.append(el('div', 'question-error', active.error));
  }
  updateQuestionFooter();
}

async function submitQuestion({ auto = false } = {}) {
  const active = state.activeQuestion;
  if (!active || active.responding) return;
  const answers = active.questions.map((question, index) => {
    const draft = active.drafts[index];
    const values = [...(draft?.selected || [])];
    const custom = String(draft?.custom || '').trim();
    if (custom) values.push(custom);
    return values;
  });
  if (!auto && answers.some((values) => values.length === 0)) {
    active.error = '还有问题未回答';
    renderQuestionDock();
    return;
  }
  active.responding = true;
  active.error = '';
  clearQuestionTimer();
  updateQuestionFooter();
  try {
    await api.answerQuestion(active.id, { answers, timedOut: auto });
    state.activeQuestion = null;
    hideQuestionDock();
    showNextQuestion();
  } catch (error) {
    if (auto) {
      state.activeQuestion = null;
      hideQuestionDock();
      showNextQuestion();
      return;
    }
    active.responding = false;
    active.error = `提交失败：${error.message}`;
    renderQuestionDock();
    startQuestionTimer();
  }
}

async function dismissQuestion() {
  const active = state.activeQuestion;
  if (!active) return;
  state.activeQuestion = null;
  hideQuestionDock();
  try {
    await api.answerQuestion(active.id, { cancelled: true });
  } catch {
    /* the run may already be gone */
  }
  showNextQuestion();
}

function isTextEntryTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"]'
      )
    )
  );
}

function visibleDialog(node) {
  return Boolean(node) && !node.classList.contains('hidden');
}

function dialogConfirmButton() {
  if (visibleDialog(dom.confirmOverlay)) return dom.confirmOk;
  if (visibleDialog(dom.renameOverlay)) return dom.renameSave;
  if (visibleDialog(dom.approvalOverlay)) return dom.approvalAllow;
  if (visibleDialog(dom.projectOverlay)) return dom.projectSave;
  if (visibleDialog(dom.goalOverlay)) return dom.goalStart;
  if (visibleDialog(dom.skillArgsOverlay)) return dom.skillArgsAttach;
  if (visibleDialog(document.getElementById('mcp-form-overlay'))) {
    return document.getElementById('mcp-form-save');
  }
  if (visibleDialog(dom.settingsOverlay)) {
    return document.getElementById('done-settings');
  }
  return null;
}

// Space confirms the active dialog instead of requiring a click. Text fields
// keep their normal Space behavior, and controls that already handled Space
// (such as the project directory drop zone) keep priority.
function handleDialogConfirmSpace(event) {
  if (event.code !== 'Space' && event.key !== ' ') return false;
  if (
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  ) {
    return false;
  }
  if (
    isTextEntryTarget(event.target) ||
    isTextEntryTarget(document.activeElement)
  ) {
    return false;
  }
  const button = dialogConfirmButton();
  if (
    !button ||
    button.disabled ||
    button.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }
  event.preventDefault();
  button.click();
  return true;
}

function openConfirm({ text, action }) {
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
      count ? `和 ${count} 个对话` : ''
    }？不可恢复。`,
    action: () => deleteProject(projectId),
  });
}

function deleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  const removedSessions = state.sessions.filter(
    (session) => session.projectId === projectId
  );
  const currentId = currentSession()?.id;
  state.projects = state.projects.filter((item) => item.id !== projectId);
  state.sessions = state.sessions.filter(
    (session) => session.projectId !== projectId
  );
  api
    .stopProjectBackground(projectId)
    .catch((error) => console.error('stop project background failed', error));
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
  saveChatsNow();
  renderAll();
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
  if (state.homeWindow && api.isElectron && api.openChatWindow) {
    closeSwitcher();
    openSessionWindow(session.id);
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
  if (state.homeWindow && api.isElectron && api.openChatWindow) {
    closeSwitcher();
    openSessionWindow(state.sessions[index].id);
    return;
  }
  if (state.activeQuestion || state.questionQueue.length) cancelQuestionDock();
  closeAgentMenu();
  state.current = index;
  state.viewMode = 'questions';
  applyFoldState(state.sessions[index]);
  resetComposerSkills();
  state.switcherProjectId = state.sessions[index].projectId;
  state.forceScroll = true;
  state.followBottom = true;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  saveChatsSoon();
  closeSwitcher();
  renderAll();
  const session = currentSession();
  if (session) {
    if (session.subagent) closeComposer();
    void resumeBackgroundQueue(session);
    if (session.subagent) {
      void refreshChats(session.id);
    }
  }
  persistFoldState();
}

function createChatFromSwitcher() {
  const projectId = state.switcherProjectId;
  closeSwitcher();
  if (!projectId) {
    newProject();
    return;
  }
  newSession(projectId);
}

function newProject() {
  ensureProjects();
  openProjectDialog('new');
}

function renderAll() {
  if (state.homeWindow) {
    if (state.switcherOpen) renderSwitcher();
    window.refreshCanvas?.();
    return;
  }
  if (state.switcherOpen) renderSwitcher();
  renderMessages();
  if (state.composerOpen) {
    renderComposerImages();
    renderComposerContext();
    renderComposerSkills();
  }
  updateControls();
  renderAgentPicker();
  connectChatEvents(currentSession()?.id || null);
  window.refreshCanvas?.();
}

function composerCanSend() {
  const session = currentSession();
  const imagesReady = state.attachedImages.every(
    (image) => !image.uploading && Boolean(image.url)
  );
  return Boolean(
    session &&
      session.frozen !== true &&
      session.subagent !== true &&
      imagesReady &&
      (dom.input.value.trim() !== '' ||
        state.attachedSkills.length > 0 ||
        state.attachedImages.length > 0)
  );
}

function updateSendState() {
  dom.composerBox?.classList.toggle('ready', composerCanSend());
}

function syncDraftTitle() {
  if (!state.composerOpen) return;
  const session = currentSession();
  if (!session || session.msgs.length > 0) return;
  if (/^#\d+-/.test(String(session.title || ''))) return;
  const draft = dom.input.value.replace(/\s+/g, ' ').trim();
  const title = draft ? draft.slice(0, 60) : '';
  if (session.title === title) return;
  session.title = title;
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();
}

function newSession(projectId) {
  if (state.activeQuestion || state.questionQueue.length) cancelQuestionDock();
  closeAgentMenu();
  ensureProjects();
  if (state.sessions.length === 0) state.seq = 0;
  state.seq += 1;
  const targetProjectId =
    state.projects.find((project) => project.id === projectId)?.id ||
    state.projects.find(
      (project) => project.id === currentSession()?.projectId
    )?.id ||
    state.projects[0]?.id ||
    null;
  if (!targetProjectId) {
    newProject();
    return;
  }
  const siblings = state.sessions.filter(
    (item) => item.projectId === targetProjectId
  );
  const previous = siblings[siblings.length - 1];
  const session = {
    id: makeId(),
    title: `Chat ${state.seq}`,
    system: DEFAULT_SYSTEM_PROMPT,
    agentsMd: null,
    agentId: previous?.agentId || DEFAULT_AGENT_ID,
    projectId: targetProjectId,
    mcpDisabled: ['*'],
    foldState: null,
    pendingQueue: [],
    msgs: [],
  };
  state.sessions.push(session);
  state.current = state.sessions.length - 1;
  state.viewMode = 'questions';
  if (!state.homeWindow) applyFoldState(session);
  resetComposerSkills();
  state.forceScroll = true;
  state.followBottom = true;
  state.switcherProjectId = targetProjectId;
  dom.input.value = '';
  if (state.homeWindow) {
    saveChatsNow()
      .then(() => openSessionWindow(session.id, { compose: true }))
      .catch((error) => console.error('open new chat failed', error));
    void api
      .loadProjectAgentsMd(targetProjectId)
      .then((data) => {
        if (!state.sessions.includes(session)) return;
        session.agentsMd = String(data?.text || '');
        saveChatsSoon();
      })
      .catch(() => {});
    renderAll();
    return;
  }
  updateSendState();
  saveChatsSoon();
  renderAll();
  void api.loadProjectAgentsMd(targetProjectId).then((data) => {
    if (!state.sessions.includes(session)) return;
    session.agentsMd = String(data?.text || '');
    renderMessages();
  }).catch(() => {});
  persistFoldState();
  openComposer();
}

async function forkCurrentSession(session, args = '') {
  if (!session || session.frozen || session.subagent) return;
  if (
    state.streaming &&
    state.streamMessage &&
    session.msgs.includes(state.streamMessage)
  ) {
    return;
  }
  const name = String(args || '').trim();
  try {
    const data = await api.forkSession(session.id, { name });
    const forked = data?.session;
    if (!forked) return;
    const sourceIndex = state.sessions.findIndex(
      (item) => item.id === session.id
    );
    const insertAt =
      sourceIndex >= 0 ? sourceIndex + 1 : state.sessions.length;
    state.sessions.splice(insertAt, 0, forked);
    state.current = insertAt;
    state.seq += 1;
    state.viewMode = 'questions';
    applyFoldState(forked);
    resetComposerSkills();
    state.forceScroll = true;
    state.followBottom = true;
    saveChatsSoon();
    renderAll();
    state.composerOpen = false;
    openComposer();
  } catch (error) {
    console.error('fork session failed', error);
  }
}

async function clearCurrentSession(session) {
  if (!session || session.frozen || session.subagent) return;
  try {
    await api.clearSession(session.id);
    session.msgs = [];
    session.pendingQueue = [];
    session.goal = null;
    session.compaction = null;
    session.foldState = null;
    session.title = '';
    state.streaming = false;
    state.streamMessage = null;
    state.requestId = null;
    state.openCardKey = null;
    state.viewMode = 'questions';
    state.forceScroll = true;
    state.followBottom = true;
    state.foldRestored = false;
    resetComposerSkills();
    clearAttachedImages();
    dom.input.value = '';
    saveChatsSoon();
    renderAll();
    if (state.composerOpen) renderComposerContext();
    window.refreshCanvas?.();
    dom.input.focus();
  } catch (error) {
    console.error('clear session failed', error);
  }
}

function deleteSessionById(sessionId) {
  const target = state.sessions.find(
    (session) => session.id === String(sessionId || '')
  );
  if (
    target?.nodeConfig?.engineer === true &&
    Number(target.nodeConfig?.engineerIndex) <= 2
  ) {
    return;
  }
  const ids = new Set([String(sessionId || '')]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of state.sessions) {
      if (
        !ids.has(session.id) &&
        session.parentSessionId &&
        ids.has(session.parentSessionId)
      ) {
        ids.add(session.id);
        changed = true;
      }
    }
  }
  const ordered = [...ids].reverse();
  for (const id of ordered) {
    const index = state.sessions.findIndex((session) => session.id === id);
    if (index >= 0) deleteSession(index);
  }
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
  state.followBottom = true;
  applyFoldState(currentSession());
  resetComposerSkills();
  saveChatsNow();
  renderAll();
}

async function startPrompt(
  session,
  text,
  { clearInput = false, skills = [], agentId = '', images = [] } = {}
) {
  const imageList = Array.isArray(images) ? images : [];
  if (
    !session ||
    session.frozen ||
    session.subagent ||
    (!text && imageList.length === 0)
  ) {
    return;
  }
  const effectiveAgentId = agentLocked(session)
    ? session.agentId || DEFAULT_AGENT_ID
    : agentId || session.agentId || DEFAULT_AGENT_ID;
  session.agentId = effectiveAgentId;
  state.foldRestored = false;
  state.foldSessionId = session.id;
  session.msgs.push({
    role: 'User',
    text,
    images: imageList,
    request: null,
    steps: [],
  });
  const agent = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
  session.msgs.push(agent);

  state.streamMessage = agent;
  state.forceScroll = true;
  state.followBottom = true;
  if (clearInput) dom.input.value = '';
  updateSendState();

  if (!state.settings.hasApiKey && state.models.length === 0) {
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
  ensureWaitingThinking(agent, 0);
  renderAll();

  try {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await api.saveChats(structurePayload());
    await api.sendChat({
      requestId,
      chatId: session.id,
      text,
      images: imageList,
      skills,
      agentId: effectiveAgentId,
      reasoningEffort: currentEffort(),
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

function isCompacting(session) {
  return (
    state.compactStatus?.sessionId === session?.id &&
    state.compactStatus.label === 'running'
  );
}

async function sessionBusy(session) {
  if (!session) return true;
  if (state.streaming || isCompacting(session)) return true;
  try {
    const active = await api.activeRun(session.id);
    return Boolean(active?.runId);
  } catch {
    return false;
  }
}

function compactQueueItem(agentId) {
  return {
    kind: 'compact',
    text: '压缩上下文',
    skills: [],
    agentId: agentId || DEFAULT_AGENT_ID,
  };
}

function compactSkillDescriptor() {
  return (
    state.skills.find((skill) => skill.command === 'compact') || {
      id: 'system:compact',
      name: 'compact',
      source: '系统',
      sourceKind: 'system',
      category: '系统',
      command: 'compact',
      arguments: {},
    }
  );
}

async function queueOrRunCompact(session, agentId) {
  const item = compactQueueItem(agentId);
  const queue = Array.isArray(session.pendingQueue)
    ? session.pendingQueue
    : (session.pendingQueue = []);
  const busy = await sessionBusy(session);
  if (busy || queue.length > 0) {
    queue.push(item);
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    if (!busy) processNextQueuedPrompt(session);
    return;
  }
  await runCompactFlow(session);
}

async function sendMessage() {
  const session = currentSession();
  if (!session || session.frozen || session.subagent) return;
  const command = parseSlashCommand(dom.input.value);
  const agentId = session.agentId || DEFAULT_AGENT_ID;
  if (command) {
    if (command.command === 'compact') {
      dom.input.value = '';
      state.slashDismissed = false;
      updateSendState();
      renderSlashPopup();
      clearAttachedSkills();
      await queueOrRunCompact(session, agentId);
      return;
    }
    if (command.command === 'goal') {
      dom.input.value = '';
      state.slashDismissed = false;
      updateSendState();
      renderSlashPopup();
      if (command.args) await startGoalFromObjective(session, command.args);
      else openGoalDialog();
      return;
    }
    if (command.command === 'fork') {
      dom.input.value = '';
      state.slashDismissed = false;
      updateSendState();
      renderSlashPopup();
      clearAttachedSkills();
      await forkCurrentSession(session, command.args);
      return;
    }
    if (command.command === 'clear') {
      dom.input.value = '';
      state.slashDismissed = false;
      updateSendState();
      renderSlashPopup();
      clearAttachedSkills();
      clearAttachedImages();
      await clearCurrentSession(session);
      return;
    }
    if (command.skill) {
      if (
        Array.isArray(command.skill.arguments) &&
        command.skill.arguments.length > 0 &&
        !command.args
      ) {
        dom.input.value = '';
        state.slashDismissed = false;
        updateSendState();
        renderSlashPopup();
        openSkillArgs(command.skill);
        return;
      }
      if (!state.attachedSkills.some((item) => item.id === command.skill.id)) {
        attachSkill(command.skill, {});
      }
      dom.input.value = command.args || `/${command.skill.name}`;
      state.slashDismissed = false;
      updateSendState();
      renderSlashPopup();
    }
  }
  const skills = state.attachedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    arguments: { ...(skill.arguments || {}) },
    command: skill.command || '',
  }));
  const images = composerImagesForSend();
  if (
    skills.some(
      (skill) => skill.command === 'compact' || skill.id === 'system:compact'
    )
  ) {
    dom.input.value = '';
    state.slashDismissed = false;
    clearAttachedSkills();
    await queueOrRunCompact(session, agentId);
    return;
  }
  const inputText = dom.input.value.trim();
  const text =
    inputText || (skills.length ? `/${skills[0].name}` : '');
  if (!text && images.length === 0) return;

  const busy = await sessionBusy(session);
  const queue = Array.isArray(session.pendingQueue)
    ? session.pendingQueue
    : (session.pendingQueue = []);
  if (busy || queue.length > 0) {
    queue.push({ text, images, skills, agentId });
    dom.input.value = '';
    state.slashDismissed = false;
    clearAttachedSkills();
    clearAttachedImages();
    updateSendState();
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    if (!busy) processNextQueuedPrompt(session);
    return;
  }

  closeComposer();
  state.slashDismissed = false;
  clearAttachedSkills();
  clearAttachedImages();
  await startPrompt(session, text, {
    clearInput: true,
    skills,
    agentId,
    images,
  });
}

async function sendViewerPrompt(prompt, sessionId = '') {
  let session = currentSession();
  if (sessionId && session?.id !== sessionId) {
    const index = state.sessions.findIndex((item) => item.id === sessionId);
    if (index >= 0) {
      selectSession(index);
      session = currentSession();
    }
  }
  if (!session || session.frozen || session.subagent) return;
  const text = String(prompt || '').trim();
  if (!text) return;
  const agentId = session.agentId || DEFAULT_AGENT_ID;
  const busy = await sessionBusy(session);
  const queue = Array.isArray(session.pendingQueue)
    ? session.pendingQueue
    : (session.pendingQueue = []);
  if (busy || queue.length > 0) {
    queue.push({ text, images: [], skills: [], agentId });
    closeComposer();
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    if (!busy) processNextQueuedPrompt(session);
    return;
  }
  closeComposer();
  await startPrompt(session, text, { agentId });
}

function handleViewerAsk(payload) {
  const text = String(payload?.prompt || '').trim();
  if (!text) return;
  void sendViewerPrompt(text, String(payload?.sessionId || ''));
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
  const images =
    item && typeof item === 'object' && Array.isArray(item.images)
      ? item.images
      : [];
  const row = el('div', 'queue-row');
  row.draggable = true;

  const handle = el('span', 'queue-drag');
  handle.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg>';
  row.append(handle);
  row.append(
    el('span', 'queue-text', text || (images.length ? '图片消息' : ''))
  );
  if (images.length) {
    row.append(el('span', 'queue-image-count', `图片 ${images.length}`));
  }
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
    )
  );
  const armed = state.pendingQueueDelete === item;
  const remove = queueActionButton(
    'remove',
    armed ? '确认删除排队消息' : '删除排队消息',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    () => armQueuedPromptDelete(session, item)
  );
  remove.classList.toggle('armed', armed);
  remove.append(el('span', 'queue-action-label', '确认删除'));
  actions.append(remove);
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
    box.append(el('div', 'composer-queue-empty', '队列为空'));
    return box;
  }
  queue.forEach((item, index) => {
    box.append(renderQueueRow(session, item, index));
  });
  return box;
}

function renderComposerContext() {
  if (!dom.composerContext) return;
  renderComposerEffort();
  renderAgentPicker();
  renderModelPicker();
  const session = currentSession();
  if (!session) {
    dom.composerContext.replaceChildren();
    return;
  }
  const children = [];
  const goalStrip = renderGoalStrip(session);
  if (goalStrip) children.push(goalStrip);
  if (session.msgs.length === 0) {
    children.push(buildMcpSummary(session, () => openMcpConfig(session.id)));
  } else {
    const queue = Array.isArray(session.pendingQueue)
      ? session.pendingQueue
      : [];
    if (state.streaming || isCompacting(session) || queue.length > 0) {
      children.push(renderComposerQueue(session));
    }
  }
  dom.composerContext.replaceChildren(...children);
}

function agentMenuEntries() {
  const agents =
    state.agents.length > 0
      ? state.agents
      : [{ id: DEFAULT_AGENT_ID, name: DEFAULT_AGENT_NAME }];
  return agents
    .filter((agent) => agent.id !== MANAGER_AGENT_ID)
    .map((agent) => ({
      id: agent.id || DEFAULT_AGENT_ID,
      name: agent.name || DEFAULT_AGENT_NAME,
    }));
}

function updateAgentMenuActive() {
  if (!dom.agentMenu) return;
  const items = [...dom.agentMenu.querySelectorAll('.agent-menu-item')];
  items.forEach((item, index) => {
    item.classList.toggle('active', index === state.agentMenuIndex);
  });
}

function renderAgentMenu() {
  if (!dom.agentMenu) return;
  const session = currentSession();
  const current = String(session?.agentId || DEFAULT_AGENT_ID);
  const entries = agentMenuEntries();
  if (state.agentMenuIndex < 0 || state.agentMenuIndex >= entries.length) {
    state.agentMenuIndex = Math.max(
      0,
      entries.findIndex((entry) => entry.id === current)
    );
  }
  dom.agentMenu.replaceChildren();
  entries.forEach((entry, index) => {
    const item = el('button', 'agent-menu-item');
    item.type = 'button';
    item.dataset.agentId = entry.id;
    item.setAttribute('role', 'option');
    if (entry.id === current) {
      item.classList.add('selected');
      item.setAttribute('aria-selected', 'true');
    }
    if (index === state.agentMenuIndex) item.classList.add('active');
    item.append(el('span', 'agent-menu-item-dot'));
    item.append(el('span', 'agent-menu-item-name', entry.name));
    if (entry.id === current) {
      item.append(el('span', 'agent-menu-item-check', '✓'));
    }
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('mouseenter', () => {
      state.agentMenuIndex = index;
      updateAgentMenuActive();
    });
    item.addEventListener('click', () => selectAgent(entry.id));
    dom.agentMenu.append(item);
  });
}

function positionAgentMenu() {
  if (!dom.agentMenu || !dom.agentPickerButton) return;
  const rect = dom.agentPickerButton.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  dom.agentMenu.style.left = '0px';
  dom.agentMenu.style.top = '0px';
  dom.agentMenu.style.bottom = 'auto';
  const width = dom.agentMenu.offsetWidth;
  const height = dom.agentMenu.offsetHeight;
  const left = Math.max(
    margin,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - margin
    )
  );
  const above = rect.top - height - gap;
  dom.agentMenu.style.left = `${Math.round(left)}px`;
  if (above >= margin) {
    dom.agentMenu.style.top = `${Math.round(above)}px`;
    return;
  }
  const below = Math.min(
    rect.bottom + gap,
    window.innerHeight - height - margin
  );
  dom.agentMenu.style.top = `${Math.round(Math.max(margin, below))}px`;
}

function closeAgentMenu() {
  if (!state.agentMenuOpen) return;
  state.agentMenuOpen = false;
  state.agentMenuIndex = -1;
  dom.agentMenu?.classList.add('hidden');
  dom.agentPickerButton?.setAttribute('aria-expanded', 'false');
  dom.agentPicker?.classList.remove('open');
}

function closeModelMenu() {
  dom.modelMenu?.classList.add('hidden');
  dom.modelPickerButton?.setAttribute('aria-expanded', 'false');
}

const GATEWAY_TASK_LABELS = {
  chat: '对话',
  manager: 'Manager',
  lead: '主工程师',
  research: '信息收集',
  programmer: '程序员',
  tester: '测试员',
  writer: '文档',
  reviewer: '审查',
};

const TASK_BY_AGENT = {
  manager: 'manager',
  'sub-lead': 'lead',
  lead: 'lead',
  'sub-research': 'research',
  research: 'research',
  'sub-programmer': 'programmer',
  programmer: 'programmer',
  code: 'programmer',
  implement: 'programmer',
  general: 'programmer',
  'sub-tester': 'tester',
  tester: 'tester',
  test: 'tester',
  'sub-writer': 'writer',
  writer: 'writer',
  docs: 'writer',
  'sub-reviewer': 'reviewer',
  reviewer: 'reviewer',
  review: 'reviewer',
};

function sessionTask(session) {
  return TASK_BY_AGENT[session?.agentId] || 'chat';
}

function exposedModelForSession(session = currentSession()) {
  const models = Array.isArray(state.models) ? state.models : [];
  if (models.length === 0) return null;
  const chosen = session
    ? state.settings.sessionModels?.[session.id]
    : null;
  if (chosen?.id) {
    const match = models.find((model) => model.id === chosen.id);
    if (match) return match;
  }
  const routedId = state.gatewayRoutes[sessionTask(session)];
  const routed = routedId
    ? models.find((model) => model.id === routedId)
    : null;
  if (routed) return routed;
  const fallback = state.gatewayDefaultModel
    ? models.find((model) => model.id === state.gatewayDefaultModel)
    : null;
  return fallback || models[0];
}

function renderModelPicker() {
  if (!dom.modelPickerValue || !dom.modelMenu) return;
  const models = Array.isArray(state.models) ? state.models : [];
  const session = currentSession();
  const current = exposedModelForSession(session);
  if (!session || models.length === 0) {
    dom.modelPickerValue.textContent = '默认';
    dom.modelMenu.replaceChildren();
    const empty = el('div', 'model-menu-empty', '还没有配置模型');
    dom.modelMenu.append(empty);
    dom.modelPickerButton?.setAttribute('aria-expanded', 'false');
    return;
  }
  dom.modelPickerValue.textContent = current?.label || current?.id || '默认';
  dom.modelMenu.replaceChildren();
  models.forEach((model, index) => {
    const item = el('button', 'model-menu-item');
    item.type = 'button';
    item.dataset.modelId = model.id;
    item.setAttribute('role', 'option');
    if (model.id === current?.id) {
      item.classList.add('selected');
      item.setAttribute('aria-selected', 'true');
    }
    if (index === state.modelMenuIndex) item.classList.add('active');
    item.append(el('span', 'model-menu-item-label', model.label || model.id));
    if (model.description) item.title = model.description;
    const check = el('span', 'model-menu-check');
    check.setAttribute('aria-hidden', 'true');
    check.textContent = model.id === current?.id ? '✓' : '';
    item.append(check);
    item.addEventListener('click', () => {
      state.settings.sessionModels = {
        ...(state.settings.sessionModels || {}),
        [session.id]: {
          id: model.id,
          label: model.label || model.id,
          provider: model.provider || '',
        },
      };
      state.modelMenuIndex = index;
      saveSettingsSoon();
      closeModelMenu();
      renderModelPicker();
    });
    dom.modelMenu.append(item);
  });
}

function applyLlmConfig(data) {
  state.llmConfigFile = String(data?.configFile || '');
  state.models = Array.isArray(data?.models) ? data.models : [];
  state.gatewayRoutes =
    data?.routes && typeof data.routes === 'object' ? data.routes : {};
  state.gatewayDefaultModel = String(data?.defaultModel || '');
  state.gatewayTasks = Array.isArray(data?.tasks) ? data.tasks : [];
  state.gatewayDraft = {
    models: state.models.map((model) => ({ ...model })),
    routes: { ...state.gatewayRoutes },
    defaultModel: state.gatewayDefaultModel,
  };
  const exposedIds = new Set(state.models.map((model) => model.id));
  let pruned = false;
  for (const [sessionId, chosen] of Object.entries(
    state.settings.sessionModels || {}
  )) {
    if (!chosen?.id || exposedIds.has(chosen.id)) continue;
    delete state.settings.sessionModels[sessionId];
    pruned = true;
  }
  if (pruned) saveSettingsSoon();
  const current = exposedModelForSession();
  const index = state.models.findIndex((model) => model.id === current?.id);
  state.modelMenuIndex = index >= 0 ? index : 0;
  renderModelPicker();
  renderGatewaySettings();
}

async function loadLlmConfig() {
  try {
    applyLlmConfig(await api.loadLlmConfig());
  } catch {
    state.llmConfigFile = '';
    state.models = [];
    state.gatewayRoutes = {};
    state.gatewayDefaultModel = '';
    state.gatewayTasks = [];
    state.gatewayDraft = null;
    state.modelMenuIndex = 0;
    renderModelPicker();
    renderGatewaySettings();
  }
}

function renderGatewaySettings() {
  if (!dom.gatewayRoutes || !dom.gatewayModelList) return;
  const draft = state.gatewayDraft;
  const models = Array.isArray(draft?.models) ? draft.models : [];
  const tasks =
    Array.isArray(state.gatewayTasks) && state.gatewayTasks.length > 0
      ? state.gatewayTasks
      : Object.keys(GATEWAY_TASK_LABELS);
  if (dom.gatewayState) {
    dom.gatewayState.textContent = draft
      ? `${models.length} 个模型`
      : '未配置';
  }
  if (dom.llmConfigFile) {
    dom.llmConfigFile.textContent = state.llmConfigFile
      ? `配置文件：${state.llmConfigFile}`
      : '';
  }
  dom.gatewayRoutes.replaceChildren();
  if (!draft) {
    dom.gatewayRoutes.append(
      el('div', 'model-menu-empty', '无法读取模型配置')
    );
  } else if (models.length === 0) {
    dom.gatewayRoutes.append(
      el('div', 'model-menu-empty', '还没有暴露模型，添加一个即可')
    );
  } else {
    for (const task of tasks) {
      const row = el('div', 'gateway-route-row');
      row.append(
        el('span', 'gateway-route-label', GATEWAY_TASK_LABELS[task] || task)
      );
      const select = el('select', 'text-input gateway-route-select');
      select.dataset.task = task;
      const inherit = el('option', '', '跟随默认');
      inherit.value = '';
      select.append(inherit);
      for (const model of models) {
        const option = el('option', '', model.label || model.id);
        option.value = model.id;
        select.append(option);
      }
      select.value = draft.routes[task] || '';
      select.addEventListener('change', () => {
        if (select.value) draft.routes[task] = select.value;
        else delete draft.routes[task];
      });
      row.append(select);
      dom.gatewayRoutes.append(row);
    }
  }

  dom.gatewayModelList.replaceChildren();
  if (dom.gatewayModelCount) {
    dom.gatewayModelCount.textContent = draft ? `${models.length}` : '';
  }
  for (const model of models) {
    const row = el('div', 'gateway-model-row');
    const copy = el('div', 'gateway-model-copy');
    copy.append(el('span', 'gateway-model-name', model.label || model.id));
    copy.append(
      el('span', 'gateway-model-id', `${model.provider}/${model.model}`)
    );
    row.append(copy);
    const remove = el('button', 'gateway-model-remove', '×');
    remove.type = 'button';
    remove.title = '移除模型';
    remove.addEventListener('click', () => {
      draft.models = draft.models.filter((item) => item.id !== model.id);
      if (draft.defaultModel === model.id) {
        draft.defaultModel = draft.models[0]?.id || '';
      }
      for (const [task, modelId] of Object.entries(draft.routes)) {
        if (modelId === model.id) delete draft.routes[task];
      }
      renderGatewaySettings();
    });
    row.append(remove);
    dom.gatewayModelList.append(row);
  }
  if (dom.gatewaySave) {
    dom.gatewaySave.disabled = !draft || state.gatewaySaving;
  }
}

function addGatewayModel() {
  const draft = state.gatewayDraft;
  if (!draft || !dom.gatewayModelLabel) return;
  const label = dom.gatewayModelLabel.value.trim();
  const provider = dom.gatewayModelProvider.value.trim();
  const model = dom.gatewayModelId.value.trim();
  if (!label || !provider || !model) {
    if (dom.gatewaySaveState) {
      dom.gatewaySaveState.textContent = '需要显示名、provider 和模型 ID';
    }
    return;
  }
  const id = `${provider}/${model}`;
  const existing = draft.models.find((item) => item.id === id);
  if (existing) {
    existing.label = label;
    existing.provider = provider;
    existing.model = model;
  } else {
    draft.models.push({
      id,
      label,
      description: '',
      provider,
      model,
      tasks: [],
    });
  }
  if (!draft.defaultModel) draft.defaultModel = id;
  dom.gatewayModelLabel.value = '';
  dom.gatewayModelProvider.value = '';
  dom.gatewayModelId.value = '';
  if (dom.gatewaySaveState) dom.gatewaySaveState.textContent = '';
  renderGatewaySettings();
}

async function saveGatewayConfig() {
  if (state.gatewaySaving || !state.gatewayDraft) return;
  const draft = state.gatewayDraft;
  state.gatewaySaving = true;
  if (dom.gatewaySaveState) dom.gatewaySaveState.textContent = '保存中…';
  renderGatewaySettings();
  try {
    const data = await api.saveLlmConfig({
      models: draft.models,
      routes: draft.routes,
      defaultModel: draft.defaultModel,
    });
    applyLlmConfig(data);
    if (dom.gatewaySaveState) dom.gatewaySaveState.textContent = '已保存';
  } catch (error) {
    if (dom.gatewaySaveState) {
      dom.gatewaySaveState.textContent = `保存失败: ${error.message}`;
    }
  } finally {
    state.gatewaySaving = false;
    renderGatewaySettings();
  }
}

function toggleModelMenu() {
  if (!dom.modelMenu || !dom.modelPickerButton) return;
  if (!dom.modelMenu.classList.contains('hidden')) {
    closeModelMenu();
    return;
  }
  if (state.models.length === 0) void loadLlmConfig();
  renderModelPicker();
  closeAgentMenu();
  dom.modelMenu.classList.remove('hidden');
  dom.modelPickerButton.setAttribute('aria-expanded', 'true');
}

function openAgentMenu() {
  if (!dom.agentMenu || !dom.agentPickerButton) return;
  const session = currentSession();
  if (!session || agentLocked(session)) return;
  closeModelMenu();
  if (state.agentMenuOpen) {
    closeAgentMenu();
    return;
  }
  const current = String(session.agentId || DEFAULT_AGENT_ID);
  const entries = agentMenuEntries();
  state.agentMenuOpen = true;
  state.agentMenuIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === current)
  );
  dom.agentMenu.classList.remove('hidden');
  dom.agentPickerButton.setAttribute('aria-expanded', 'true');
  dom.agentPicker?.classList.add('open');
  renderAgentMenu();
  positionAgentMenu();
}

function selectAgent(agentId) {
  const session = currentSession();
  if (!session || agentLocked(session)) return;
  session.agentId = String(agentId || DEFAULT_AGENT_ID);
  saveChatsSoon();
  renderAgentPicker();
  refreshContextBlocks();
  closeAgentMenu();
  if (state.composerOpen) dom.input.focus();
}

function moveAgentMenu(delta) {
  if (!state.agentMenuOpen) {
    openAgentMenu();
    return;
  }
  const entries = agentMenuEntries();
  if (entries.length === 0) return;
  state.agentMenuIndex =
    (state.agentMenuIndex + delta + entries.length) % entries.length;
  updateAgentMenuActive();
}

function agentLocked(session) {
  return Boolean(
    session &&
      (session.nodeRole === 'manager' ||
        session.nodeRole === 'work' ||
        (Array.isArray(session.msgs) && session.msgs.length > 0))
  );
}

function renderAgentPicker() {
  const session = currentSession();
  if (session && !session.agentId) {
    session.agentId = DEFAULT_AGENT_ID;
    saveChatsSoon();
  }
  const current = String(session?.agentId || DEFAULT_AGENT_ID);
  const known = state.agents.find((agent) => agent.id === current);
  const fallback = state.agents.find(
    (agent) => agent.id === DEFAULT_AGENT_ID
  );
  const name = (known || fallback)?.name || DEFAULT_AGENT_NAME;
  const locked = agentLocked(session);
  if (dom.agentPickerValue) {
    dom.agentPickerValue.textContent = name;
  }
  if (dom.agentPickerButton) {
    dom.agentPickerButton.disabled = !session || locked;
    dom.agentPickerButton.title = locked
      ? '对话开始后不能更换 Agent'
      : '';
    dom.agentPickerButton.setAttribute(
      'aria-label',
      locked ? `Agent locked: ${name}` : 'Select agent'
    );
  }
  dom.agentPicker?.classList.toggle('locked', Boolean(session && locked));
  if (locked && state.agentMenuOpen) closeAgentMenu();
  if (
    session &&
    current &&
    state.agentsFetchedAt &&
    !state.agentsLoading &&
    !known
  ) {
    session.agentId = DEFAULT_AGENT_ID;
    saveChatsSoon();
    if (dom.agentPickerValue) {
      dom.agentPickerValue.textContent = DEFAULT_AGENT_NAME;
    }
  }
  if (state.agentMenuOpen) {
    renderAgentMenu();
    positionAgentMenu();
  }
}

async function loadAgents(force = false) {
  if (state.agentsLoading) return;
  if (
    !force &&
    state.agentsFetchedAt &&
    Date.now() - state.agentsFetchedAt < 15_000
  ) {
    renderAgentPicker();
    return;
  }
  state.agentsLoading = true;
  try {
    const data = await api.loadAgents();
    state.agents = Array.isArray(data?.agents) ? data.agents : [];
    state.agentsFetchedAt = Date.now();
    refreshContextBlocks();
  } catch (error) {
    console.error('load agents failed', error);
  } finally {
    state.agentsLoading = false;
    renderAgentPicker();
  }
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

const MAX_COMPOSER_IMAGES = 8;
const MAX_IMAGE_FILE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_DATA_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const IMAGE_EXTENSION_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function imageMime(file) {
  const type = String(file?.type || '').toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.has(type)) return type;
  const ext = String(file?.name || '')
    .split('.')
    .pop()
    .toLowerCase();
  return IMAGE_EXTENSION_TYPES[ext] || '';
}

function isSupportedImageFile(file) {
  return Boolean(file && imageMime(file));
}

function hasFileDrag(event) {
  return Array.from(event?.dataTransfer?.types || []).includes('Files');
}

function imageBytesFromDataUrl(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return 0;
  const base64 = String(dataUrl).slice(comma + 1).replace(/\s+/g, '');
  return Math.round((base64.length * 3) / 4);
}

function formatImageBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      /* fall back to an <img> decode */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('无法解码这张图片'));
      node.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function prepareImageFile(file) {
  const mime = imageMime(file);
  if (!mime) {
    throw new Error('只支持 PNG / JPG / WebP / GIF 图片');
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('图片太大，单张最大 24MB');
  }
  const decoded = await decodeImageFile(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new Error('无法解码这张图片');
    }
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height)
    );
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    if (scale === 1 && mime !== 'image/gif') {
      const original = await readFileAsDataUrl(file);
      if (imageBytesFromDataUrl(original) <= MAX_IMAGE_DATA_BYTES) {
        return { dataUrl: original, mime, width, height, size: file.size };
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理这张图片');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, width, height);

    let outputMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    let flattened = false;
    const flattenForJpeg = () => {
      if (flattened) return;
      flattened = true;
      context.save();
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.restore();
    };
    if (outputMime === 'image/jpeg') flattenForJpeg();
    let dataUrl = canvas.toDataURL(
      outputMime,
      outputMime === 'image/jpeg' ? 0.88 : undefined
    );
    if (
      outputMime === 'image/png' &&
      imageBytesFromDataUrl(dataUrl) > MAX_IMAGE_DATA_BYTES
    ) {
      outputMime = 'image/jpeg';
      flattenForJpeg();
      dataUrl = canvas.toDataURL(outputMime, 0.9);
    }
    if (imageBytesFromDataUrl(dataUrl) > MAX_IMAGE_DATA_BYTES) {
      outputMime = 'image/jpeg';
      flattenForJpeg();
      dataUrl = canvas.toDataURL(outputMime, 0.72);
    }
    const size = imageBytesFromDataUrl(dataUrl);
    if (size > MAX_IMAGE_DATA_BYTES) {
      throw new Error('图片压缩后仍然太大');
    }
    return { dataUrl, mime: outputMime, width, height, size };
  } finally {
    decoded.close?.();
  }
}

async function uploadComposerImage(prepared, file) {
  const saved = await requestJson('/api/attachments', {
    method: 'POST',
    body: {
      dataUrl: prepared.dataUrl,
      name: file.name || 'image',
      mime: prepared.mime,
      width: prepared.width,
      height: prepared.height,
    },
  });
  if (!saved?.id || !saved?.url) throw new Error('图片上传失败');
  return {
    id: saved.id,
    url: saved.url,
    mime: saved.mime || prepared.mime,
    name: saved.name || file.name || 'image',
    width: saved.width || prepared.width,
    height: saved.height || prepared.height,
    size: saved.size || prepared.size,
  };
}

function renderComposerImages() {
  if (!dom.composerImages) return;
  const images = state.attachedImages;
  dom.composerImages.replaceChildren();
  dom.composerImages.classList.toggle('hidden', images.length === 0);
  images.forEach((image) => {
    const tile = el('div', 'composer-image');
    if (image.uploading) tile.classList.add('uploading');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute(
      'aria-label',
      `${image.name}${image.size ? ` · ${formatImageBytes(image.size)}` : ''}`
    );
    tile.title = `${image.name}${image.size ? ` · ${formatImageBytes(image.size)}` : ''}`;

    const source = image.previewUrl || image.url || image.dataUrl;
    if (source) {
      const node = document.createElement('img');
      node.src = source;
      node.alt = image.name;
      node.draggable = false;
      tile.append(node);
    } else {
      tile.append(el('span', 'composer-image-placeholder'));
    }

    if (image.uploading) {
      tile.append(el('span', 'composer-image-spinner'));
    }

    const remove = el('button', 'composer-image-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除 ${image.name}`);
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeComposerImage(image);
    });
    tile.append(remove);

    const open = () => {
      if (image.uploading) return;
      openImagePreview(image);
    };
    tile.addEventListener('click', (event) => {
      if (event.target.closest('.composer-image-remove')) return;
      open();
    });
    tile.addEventListener('keydown', (event) => {
      if (event.target.closest('.composer-image-remove')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
    dom.composerImages.append(tile);
  });
}

async function addComposerImages(files) {
  const incoming = [...(files || [])].filter(Boolean);
  if (incoming.length === 0) return;

  const room = MAX_COMPOSER_IMAGES - state.attachedImages.length;
  if (room <= 0) {
    showComposerNotice(`最多 ${MAX_COMPOSER_IMAGES} 张图片`);
    return;
  }

  const supported = incoming.filter(isSupportedImageFile);
  if (supported.length === 0) {
    showComposerNotice('只支持 PNG / JPG / WebP / GIF 图片');
    return;
  }
  if (supported.length < incoming.length) {
    showComposerNotice('已忽略非图片文件');
  }
  if (supported.length > room) {
    showComposerNotice(`最多 ${MAX_COMPOSER_IMAGES} 张图片`);
  }

  for (const file of supported.slice(0, room)) {
    const temp = {
      id: makeId(),
      name: file.name || 'image',
      mime: imageMime(file),
      width: 0,
      height: 0,
      size: file.size,
      previewUrl: '',
      uploading: true,
      cancelled: false,
    };
    state.attachedImages.push(temp);
    renderComposerImages();
    updateSendState();

    try {
      const prepared = await prepareImageFile(file);
      if (temp.cancelled) continue;
      temp.previewUrl = prepared.dataUrl;
      temp.mime = prepared.mime;
      temp.width = prepared.width;
      temp.height = prepared.height;
      temp.size = prepared.size;
      renderComposerImages();

      const saved = await uploadComposerImage(prepared, file);
      if (temp.cancelled) continue;
      Object.assign(temp, saved);
      temp.uploading = false;
      delete temp.previewUrl;
    } catch (error) {
      if (!temp.cancelled) {
        state.attachedImages = state.attachedImages.filter(
          (image) => image !== temp
        );
        showComposerNotice(error.message || '添加图片失败');
      }
    }
    renderComposerImages();
    updateSendState();
  }
}

function removeComposerImage(image) {
  image.cancelled = true;
  state.attachedImages = state.attachedImages.filter((item) => item !== image);
  renderComposerImages();
  updateSendState();
}

function clearAttachedImages() {
  if (state.attachedImages.length === 0) return;
  state.attachedImages.forEach((image) => {
    image.cancelled = true;
  });
  state.attachedImages = [];
  renderComposerImages();
  updateSendState();
}

function composerImagesForSend() {
  return state.attachedImages
    .filter((image) => !image.uploading && image.url)
    .map((image) => ({
      id: image.id || '',
      url: image.url,
      mime: image.mime,
      name: image.name,
      width: image.width,
      height: image.height,
      size: image.size,
    }));
}

function showComposerNotice(message) {
  if (!dom.composerNotice) return;
  dom.composerNotice.textContent = String(message || '');
  dom.composerNotice.classList.add('show');
  clearTimeout(state.composerNoticeTimer);
  state.composerNoticeTimer = setTimeout(() => {
    dom.composerNotice.classList.remove('show');
  }, 2800);
}

function openImagePreview(image) {
  const source = image?.previewUrl || image?.url || image?.dataUrl;
  if (!source) return;
  openWebContent({
    key: `image:${image.id || image.name || 'image'}`,
    kind: 'image',
    name: image.name || '图片',
    dataUrl: source,
    width: image.width || 0,
    height: image.height || 0,
  });
}

function caretPointInTextarea(textarea) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.top = '-9999px';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.textAlign = style.textAlign;
  mirror.textContent = textarea.value.slice(
    0,
    textarea.selectionStart ?? textarea.value.length
  );
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  return {
    left: markerRect.left - mirrorRect.left - textarea.scrollLeft,
    top: markerRect.top - mirrorRect.top - textarea.scrollTop,
    lineHeight,
  };
}

function positionSlashPopup() {
  if (!dom.skillPopup || !dom.composerBox || !dom.input) return;
  if (dom.skillPopup.classList.contains('hidden')) return;
  const caret = caretPointInTextarea(dom.input);
  const box = dom.composerBox;
  const popupWidth = Math.min(320, Math.max(200, box.clientWidth - 24));
  dom.skillPopup.style.width = `${popupWidth}px`;
  const maxLeft = Math.max(12, box.clientWidth - popupWidth - 12);
  const left = Math.max(
    12,
    Math.min(maxLeft, dom.input.offsetLeft + caret.left)
  );
  let top = dom.input.offsetTop + caret.top + caret.lineHeight + 4;
  dom.skillPopup.style.left = `${left}px`;
  dom.skillPopup.style.top = `${top}px`;
  const rect = dom.skillPopup.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 12) {
    const above = dom.input.offsetTop + caret.top - rect.height - 4;
    dom.skillPopup.style.top = `${Math.max(12, above)}px`;
  }
}

function renderSlashPopup() {
  if (!dom.skillPopup) return;
  const exact = state.composerOpen ? exactSlashSkill() : null;
  if (exact) {
    state.slashOpen = false;
    state.slashSkills = [];
    state.slashIndex = 0;
    dom.skillPopup.classList.add('hidden');
    dom.skillPopup.replaceChildren();
    return;
  }
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
    positionSlashPopup();
    return;
  }
  skills.forEach((skill, index) => {
    const item = el('button', 'skill-popup-item');
    item.type = 'button';
    if (index === state.slashIndex) item.classList.add('selected');
    item.append(el('span', 'skill-popup-name', skill.name || skill.id));
    if (skill.command) {
      item.append(el('span', 'skill-popup-command', '命令'));
    }
    item.append(el('span', 'skill-popup-source', skillSourceLabel(skill)));
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => chooseSlashSkill(skill));
    dom.skillPopup.append(item);
  });
  positionSlashPopup();
}

function moveSlashSelection(delta) {
  if (!state.slashOpen || state.slashSkills.length === 0) return;
  const count = state.slashSkills.length;
  state.slashIndex = (state.slashIndex + delta + count) % count;
  renderSlashPopup();
}

function chooseSlashSkill(skill) {
  if (!skill) return;
  const command = parseSlashCommand(dom.input.value);
  state.slashOpen = false;
  state.slashIndex = 0;
  state.slashDismissed = false;
  dom.input.value = '';
  updateSendState();
  if (skill.command === 'compact') {
    attachSkill(skill, {});
    renderComposerSkills();
    return;
  }
  if (skill.command) {
    executeSystemSkill(
      skill,
      command?.command === skill.command ? command.args : ''
    );
    renderComposerSkills();
    return;
  }
  selectSkill(skill);
  renderComposerSkills();
}

function selectSkill(skill) {
  if (!skill) return;
  if (skill.command === 'compact') {
    attachSkill(skill, {});
    return;
  }
  if (skill.command) {
    executeSystemSkill(skill, '');
    return;
  }
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
    command: skill.command || '',
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
  state.attachedImages = [];
  state.skills = [];
  state.skillsSessionId = null;
  state.skillsFetchedAt = 0;
  state.slashOpen = false;
  state.slashIndex = 0;
  state.slashSkills = [];
  state.slashDismissed = false;
  state.pendingQueueDelete = null;
  clearTimeout(state.queueDeleteTimer);
  renderComposerImages();
  renderComposerSkills();
  updateSendState();
}

function lastAgentMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'Agent') return index;
  }
  return -1;
}

function ensureLastAgentMessage(session) {
  const index = lastAgentMessageIndex(session.msgs);
  if (index >= 0) {
    const message = session.msgs[index];
    if (!Array.isArray(message.steps)) message.steps = [];
    return message;
  }
  const message = {
    role: 'Agent',
    text: '',
    request: '',
    steps: [],
    requests: [],
  };
  session.msgs.push(message);
  return message;
}

function stepKey(step) {
  return [
    step?.kind || '',
    step?.metrics?.at || step?.metrics?.createdAt || '',
    step?.label || '',
    String(step?.text || '').slice(0, 80),
  ].join('|');
}

function appendStepOnce(message, step) {
  if (!message || !step) return;
  if (!Array.isArray(message.steps)) message.steps = [];
  const key = stepKey(step);
  if (message.steps.some((entry) => stepKey(entry) === key)) return;
  message.steps.push(step);
}

function matchSlashSkill(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('/')) return null;
  const body = text.slice(1);
  const lower = body.toLowerCase();
  let best = null;
  for (const skill of state.skills) {
    const idSuffix = String(skill.id || '').split(':').pop();
    for (const key of [skill.name, skill.id, idSuffix]) {
      const normalized = String(key || '').toLowerCase();
      if (!normalized) continue;
      if (lower === normalized || lower.startsWith(`${normalized} `)) {
        if (!best || normalized.length > best.length) {
          best = { skill, length: normalized.length };
        }
      }
    }
  }
  if (!best) return null;
  return {
    skill: best.skill,
    args: body.slice(best.length).trim(),
  };
}

function exactSlashSkill() {
  return matchSlashSkill(dom.input.value)?.skill || null;
}

function parseSlashCommand(value) {
  const text = String(value || '').trim();
  const compact = text.match(/^\/compact\b([\s\S]*)$/i);
  if (compact) {
    return {
      command: 'compact',
      skill:
        state.skills.find((skill) => skill.command === 'compact') || null,
      args: compact[1].trim(),
    };
  }
  const goal = text.match(/^\/goal\b([\s\S]*)$/i);
  if (goal) {
    return {
      command: 'goal',
      skill: state.skills.find((skill) => skill.command === 'goal') || null,
      args: goal[1].trim(),
    };
  }
  const fork = text.match(/^\/fork\b([\s\S]*)$/i);
  if (fork) {
    return {
      command: 'fork',
      skill: state.skills.find((skill) => skill.command === 'fork') || null,
      args: fork[1].trim(),
    };
  }
  const clear = text.match(/^\/clear\b([\s\S]*)$/i);
  if (clear) {
    return {
      command: 'clear',
      skill: state.skills.find((skill) => skill.command === 'clear') || null,
      args: '',
    };
  }
  const match = matchSlashSkill(text);
  if (!match) return null;
  return {
    command: match.skill.command || '',
    skill: match.skill,
    args: match.args,
  };
}

function showGoalError(message) {
  if (!dom.goalError) return;
  dom.goalError.textContent = message || '';
  dom.goalError.classList.toggle('hidden', !message);
}

function openGoalDialog(prefill = '') {
  if (!dom.goalOverlay) return;
  state.goalDialog = { objective: String(prefill || '') };
  dom.goalObjective.value = state.goalDialog.objective;
  dom.goalBudget.value = '';
  dom.goalStart.disabled = false;
  showGoalError('');
  dom.goalOverlay.classList.remove('hidden');
  dom.goalOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    dom.goalObjective.focus();
    dom.goalObjective.setSelectionRange(
      dom.goalObjective.value.length,
      dom.goalObjective.value.length
    );
  });
}

function closeGoalDialog() {
  if (!dom.goalOverlay) return;
  state.goalDialog = null;
  state.goalSaving = false;
  dom.goalOverlay.classList.add('hidden');
  dom.goalOverlay.setAttribute('aria-hidden', 'true');
}

async function startGoalFromObjective(session, objective, tokenBudget = 0) {
  if (!session) return false;
  if (state.streaming) {
    showGoalError('生成中，稍后再试');
    const message = ensureLastAgentMessage(session);
    appendStepOnce(message, {
      kind: 'status',
      label: '生成中，稍后再试',
      ok: false,
    });
    renderAll();
    return false;
  }
  const text = String(objective || '').trim();
  if (!text) {
    showGoalError('填写目标');
    return false;
  }
  const budget = Number(tokenBudget) || 0;
  if (budget > 0 && budget < 1000) {
    showGoalError('至少 1000，留空不限');
    return false;
  }
  const now = Date.now();
  const goal = {
    id: makeId(),
    objective: text,
    status: 'active',
    tokenBudget: budget > 0 ? Math.floor(budget) : null,
    tokensUsed: 0,
    turnsUsed: 0,
    maxTurns: 20,
    auditFailStreak: 0,
    statusReason: '',
    createdAt: now,
    updatedAt: now,
    lastCheck: null,
  };
  state.goalSaving = true;
  if (dom.goalStart) dom.goalStart.disabled = true;
  try {
    const data = await api.saveGoal(session.id, goal);
    session.goal = data?.goal || goal;
    closeGoalDialog();
    renderAll();
    if (!state.streaming) {
      await startPrompt(session, text, { clearInput: true });
    }
    return true;
  } catch (error) {
    showGoalError(`启动失败：${error.message}`);
    state.goalSaving = false;
    if (dom.goalStart) dom.goalStart.disabled = false;
    return false;
  }
}

async function updateGoalState(session, patch) {
  if (!session?.goal) return null;
  const next = { ...session.goal, ...patch, updatedAt: Date.now() };
  try {
    const data = await api.saveGoal(session.id, next);
    session.goal = data?.goal || next;
    renderAll();
    return session.goal;
  } catch (error) {
    console.error('update goal failed', error);
    return session.goal;
  }
}

async function pauseGoal(session) {
  await updateGoalState(session, {
    status: 'paused',
    statusReason: 'paused by user',
  });
}

async function resumeGoal(session) {
  if (!session?.goal) return;
  const goal = await updateGoalState(session, {
    status: 'active',
    statusReason: 'resumed',
  });
  if (goal && !state.streaming) {
    await startPrompt(
      session,
      'Continue working toward the active session goal.',
      { clearInput: true }
    );
  }
}

async function clearGoal(session) {
  if (!session?.goal) return;
  try {
    await api.saveGoal(session.id, null);
  } catch (error) {
    console.error('clear goal failed', error);
    return;
  }
  session.goal = null;
  renderAll();
}

function renderGoalStrip(session) {
  const goal = session?.goal;
  if (!goal) return null;
  const strip = el('div', `goal-strip status-${goal.status}`);
  const main = el('div', 'goal-strip-main');
  main.append(el('span', 'goal-strip-label', 'GOAL'));
  main.append(el('span', 'goal-strip-objective', goal.objective));
  strip.append(main);
  const meta = el('div', 'goal-strip-meta');
  const parts = [goal.status];
  parts.push(`turn ${goal.turnsUsed || 0}/${goal.maxTurns || 20}`);
  parts.push(
    `${compactTokens(goal.tokensUsed || 0)}${
      goal.tokenBudget ? ` / ${compactTokens(goal.tokenBudget)}` : ''
    }`
  );
  if (goal.statusReason) parts.push(goal.statusReason);
  meta.textContent = parts.join(' · ');
  strip.append(meta);
  const actions = el('div', 'goal-strip-actions');
  if (goal.status === 'active') {
    const pause = el('button', 'goal-strip-button', '暂停');
    pause.type = 'button';
    pause.addEventListener('click', () => void pauseGoal(session));
    actions.append(pause);
  } else if (
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'budgetLimited'
  ) {
    const resume = el('button', 'goal-strip-button', '继续');
    resume.type = 'button';
    resume.addEventListener('click', () => void resumeGoal(session));
    actions.append(resume);
  }
  const clear = el('button', 'goal-strip-clear', '×');
  clear.type = 'button';
  clear.setAttribute('aria-label', '清除目标');
  clear.addEventListener('click', () => {
    openConfirm({
      title: 'CLEAR GOAL',
      text: '清除当前目标？',
      action: () => void clearGoal(session),
    });
  });
  actions.append(clear);
  strip.append(actions);
  return strip;
}

async function runCompactFlow(session) {
  if (!session || session.frozen) return;
  if (state.streaming) {
    await queueOrRunCompact(session, session.agentId || DEFAULT_AGENT_ID);
    return;
  }
  closeComposer();
  state.compactStatus = {
    sessionId: session.id,
    label: 'running',
    text: '压缩中…',
    metrics: { at: Date.now() },
  };
  renderAll();
  try {
    const queue = Array.isArray(session.pendingQueue)
      ? [...session.pendingQueue]
      : [];
    await api.compactChat(session.id, queue);
    state.compactStatus = null;
    state.openCardKey = null;
    state.viewMode = 'questions';
    state.forceScroll = true;
    state.followBottom = true;
    state.foldRestored = false;
    closeComposer();
    await refreshChats();
    const next = currentSession();
    if (
      next &&
      !next.frozen &&
      !state.streaming &&
      Array.isArray(next.pendingQueue) &&
      next.pendingQueue.length > 0
    ) {
      processNextQueuedPrompt(next);
    }
  } catch (error) {
    state.compactStatus = {
      sessionId: session.id,
      label: 'failed',
      text: String(error.message || '压缩失败'),
      metrics: {},
    };
    renderAll();
  }
}

function executeSystemSkill(skill, args = '') {
  const session = currentSession();
  if (!session) return;
  if (skill?.command === 'compact') {
    void queueOrRunCompact(session, session.agentId || DEFAULT_AGENT_ID);
    return;
  }
  if (skill?.command === 'goal') {
    const objective = String(args || '').trim();
    if (objective) {
      void startGoalFromObjective(session, objective);
      return;
    }
    openGoalDialog();
    return;
  }
  if (skill?.command === 'fork') {
    void forkCurrentSession(session, args);
    return;
  }
  if (skill?.command === 'clear') {
    void clearCurrentSession(session);
  }
}

function openSkillArgs(skill) {
  if (!skill || !dom.skillArgsOverlay) return;
  state.skillArgsTarget = { skill, values: {} };
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
      dom.skillArgsError.textContent = `填写 ${argument.name}`;
      dom.skillArgsError.classList.remove('hidden');
      return;
    }
    if (value) values[argument.name] = value;
  }
  attachSkill(target.skill, values);
  closeSkillArgs();
}

function clearPendingQueueDelete(item) {
  if (state.pendingQueueDelete !== item) return;
  state.pendingQueueDelete = null;
  clearTimeout(state.queueDeleteTimer);
}

function armQueuedPromptDelete(session, item) {
  if (!Array.isArray(session.pendingQueue)) return;
  const index = session.pendingQueue.indexOf(item);
  if (index < 0) return;
  if (state.pendingQueueDelete === item) {
    clearPendingQueueDelete(item);
    removeQueuedPrompt(session, index);
    return;
  }
  state.pendingQueueDelete = item;
  clearTimeout(state.queueDeleteTimer);
  state.queueDeleteTimer = setTimeout(() => {
    state.pendingQueueDelete = null;
    if (state.composerOpen) renderComposerContext();
  }, 3200);
  if (state.composerOpen) renderComposerContext();
}

function removeQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  const [removed] = session.pendingQueue.splice(index, 1);
  clearPendingQueueDelete(removed);
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
}

function editQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  const [item] = session.pendingQueue.splice(index, 1);
  if (!item) return;
  clearPendingQueueDelete(item);
  if (!agentLocked(session)) {
    session.agentId =
      (item && typeof item === 'object' && item.agentId) ||
      DEFAULT_AGENT_ID;
  }
  saveChatsSoon();
  if (!state.composerOpen) openComposer();
  if (item && typeof item === 'object' && item.kind === 'compact') {
    const skill = compactSkillDescriptor();
    state.attachedImages = [];
    renderComposerImages();
    state.attachedSkills = [
      {
        id: skill.id,
        name: skill.name,
        source: skill.source || '',
        sourceKind: skill.sourceKind || '',
        serverName: skill.serverName || '',
        category: skill.category || '',
        command: 'compact',
        arguments: {},
      },
    ];
    dom.input.value = '';
    updateSendState();
    renderAgentPicker();
    if (state.composerOpen) renderComposerContext();
    renderComposerSkills();
    requestAnimationFrame(() => dom.input.focus());
    return;
  }
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  const images =
    item && typeof item === 'object' && Array.isArray(item.images)
      ? item.images
      : [];
  state.attachedImages = images.map((image) => ({
    ...image,
    uploading: false,
  }));
  renderComposerImages();
  state.attachedSkills = skills.map((skill) => {
    const known = state.skills.find((entry) => entry.id === skill.id);
    return {
      id: skill.id,
      name: skill.name || known?.name || skill.id,
      source: known?.source || '',
      sourceKind: known?.sourceKind || '',
      serverName: known?.serverName || '',
      category: known?.category || '',
      command: skill.command || known?.command || '',
      arguments: { ...(skill.arguments || {}) },
    };
  });
  dom.input.value = text;
  updateSendState();
  renderAgentPicker();
  if (state.composerOpen) renderComposerContext();
  renderComposerSkills();
  requestAnimationFrame(() => {
    dom.input.focus();
    const end = dom.input.value.length;
    dom.input.setSelectionRange(end, end);
  });
}

async function sendQueuedPrompt(session, index) {
  if (!Array.isArray(session.pendingQueue)) return;
  const [item] = session.pendingQueue.splice(index, 1);
  if (!item) return;
  clearPendingQueueDelete(item);
  const busy = session.frozen ? true : await sessionBusy(session);
  if (busy) {
    session.pendingQueue.unshift(item);
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    return;
  }
  if (item.kind === 'compact') {
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    void runCompactFlow(session);
    return;
  }
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  const images =
    item && typeof item === 'object' && Array.isArray(item.images)
      ? item.images
      : [];
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
  void startPrompt(session, text, {
    skills,
    images,
    agentId: item.agentId || session.agentId || DEFAULT_AGENT_ID,
  });
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
  if (!session || state.streaming || session.frozen) return;
  if (isCompacting(session)) return;
  if (
    !Array.isArray(session.pendingQueue) ||
    session.pendingQueue.length === 0
  ) {
    return;
  }
  if (session !== currentSession()) return;
  const item = session.pendingQueue.shift();
  if (!item) return;
  clearPendingQueueDelete(item);
  if (item.kind === 'compact') {
    saveChatsSoon();
    if (state.composerOpen) renderComposerContext();
    void runCompactFlow(session);
    return;
  }
  const text = typeof item === 'string' ? item : item.text || '';
  const skills =
    item && typeof item === 'object' && Array.isArray(item.skills)
      ? item.skills
      : [];
  const images =
    item && typeof item === 'object' && Array.isArray(item.images)
      ? item.images
      : [];
  saveChatsSoon();
  if (state.composerOpen) renderComposerContext();
  void startPrompt(session, text, {
    skills,
    images,
    agentId: item.agentId || session.agentId || DEFAULT_AGENT_ID,
  });
}

async function refreshChats(preferredSessionId = null) {
  try {
    const chats = await api.loadChats();
    const previousId = currentSession()?.id;
    const currentId = preferredSessionId || previousId;
    state.projects = chats.projects || [];
    state.sessions = chats.sessions || [];
    state.seq = chats.seq;
    const index = currentId
      ? state.sessions.findIndex((session) => session.id === currentId)
      : -1;
    state.current = index >= 0 ? index : chats.current;
    ensureProjects();
    applyFoldState(currentSession());
    if (currentId !== previousId) {
      resetComposerSkills();
      state.compactStatus = null;
    }
    renderAll();
  } catch (error) {
    console.error('refresh chats failed', error);
  }
}

async function adoptExternalRun(requestId) {
  if (!requestId || state.streaming) return;
  await refreshChats();
  const session = currentSession();
  if (!session) return;
  let active = null;
  try {
    active = await api.activeRun(session.id);
  } catch {
    active = null;
  }
  if (active?.runId !== requestId) {
    state.streaming = false;
    state.requestId = null;
    renderAll();
    return;
  }
  const index = lastAgentMessageIndex(session.msgs);
  if (index < 0) return;
  state.streamMessage = session.msgs[index];
  state.streaming = true;
  state.requestId = requestId;
  state.forceScroll = true;
  state.followBottom = true;
  state.openCardKey = autoCardKey();
  renderAll();
}

function finishStream() {
  clearToolApprovals();
  clearQuestionDock();
  const finishedMessage = state.streamMessage;
  const finishedSession = state.streamMessage
    ? state.sessions.find((session) =>
        session.msgs.includes(state.streamMessage)
      )
    : currentSession();
  let removedPlaceholder = false;
  if (finishedMessage && Array.isArray(finishedMessage.steps)) {
    const steps = finishedMessage.steps.filter(
      (step) =>
        !(
          step.placeholder === true &&
          step.kind === 'thinking' &&
          !String(step.text || '').trim()
        )
    );
    removedPlaceholder = steps.length !== finishedMessage.steps.length;
    finishedMessage.steps = steps;
  }
  if (finishedMessage && finishedSession) {
    const liveIndex = finishedSession.msgs.indexOf(finishedMessage);
    if (liveIndex >= 0) syncLiveReplyViewer(finishedMessage, liveIndex);
  }
  const stick = state.followBottom;
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
  if (removedPlaceholder || state.viewMode) {
    renderMessages();
  } else {
    state.openCardKey = autoCardKey();
    applyOpenKey(state.openCardKey);
  }
  persistFoldState();

  updateControls();
  if (state.composerOpen) renderComposerContext();
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();

  if (stick) {
    requestAnimationFrame(() => {
      scrollMessagesTo(dom.messages.scrollHeight);
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
        '没有原始请求'
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
        : '没有可用地址';
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
    dom.pairingPassword.textContent = '后端未启动';
  }
}

function openSettings() {
  closeComposer();
  applySettings();
  renderGatewaySettings();
  dom.settingsOverlay.classList.remove('hidden');
  void loadLlmConfig();
  void loadPairing();
}

function closeSettings() {
  dom.settingsOverlay.classList.add('hidden');
  saveSettingsNow();
}

/* ---------------------------------------------------------------- window drag */
const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .switch-card, .composer-box, .agent-menu, .action-menu, .usage-card, .question-dock, .canvas-manager, .canvas-manager-panel, .canvas-system-node, .manager-composer, .manager-composer-content, #web-content';

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

function isWebContentTextTarget(target) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'img, figure, .web-content-image-wrap, .web-content-image'
    )
  ) {
    return false;
  }
  const textRoot = target.closest(
    '.md-body, .text-block, .code-line, .code-text, pre, code, table, blockquote, .web-content-image-caption'
  );
  return Boolean(textRoot && String(textRoot.textContent || '').trim());
}

function onWindowDragStart(event) {
  if (!api.isElectron) return;
  if (event.button !== 0 && event.button !== 1) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const webContentTarget = target.closest('#web-content');
  const webContentText = webContentTarget
    ? isWebContentTextTarget(target)
    : false;
  const webContentDrag = Boolean(webContentTarget && !webContentText);
  if (webContentDrag) {
    if (
      target.closest(
        'button, a, input, textarea, select, [contenteditable="true"]'
      )
    ) {
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
  } else if (target.closest(DRAG_EXCLUDE)) {
    return;
  }
  const canvasOverlay = target.closest('#canvas');
  const overlay = target.closest('.overlay');
  if (overlay && overlay !== dom.switcher && overlay !== canvasOverlay) return;
  if (canvasOverlay) {
    // 画布首页和 Tab 工作区页的空白处都可以用左键直接拖动窗口。
    if (event.button !== 0 || event.shiftKey) return;
    const workspacePage = target.closest('.canvas-workspaces-page');
    const excluded = workspacePage
      ? '.canvas-workspace, button, input, textarea, select, [contenteditable="true"]'
      : '.canvas-group, .canvas-child, .canvas-manager, .canvas-manager-panel, .canvas-system-node, .canvas-frame, .canvas-zoom-indicator, .manager-composer, .manager-composer-content, button, input, textarea, select, [contenteditable="true"]';
    if (target.closest(excluded)) return;
  } else if (event.button !== 0) {
    return;
  }
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (target instanceof HTMLElement && hitsScrollbar(target, event)) return;
  if (event.button === 1) event.preventDefault();

  const isCardHead = Boolean(
    target.closest('.card-head')
  );
  const isComposerScrim = Boolean(
    state.composerOpen &&
      target.closest('#composer') &&
      !target.closest('.composer-box')
  );
  const needsThreshold = isCardHead || isComposerScrim || webContentDrag;
  suppressNextCardClick = false;
  windowDrag = {
    x: event.screenX,
    y: event.screenY,
    started: !needsThreshold,
    isCardHead,
    isComposerScrim,
    isWebContentDrag: webContentDrag,
  };
  dragFromComposer = Boolean(
    state.composerOpen && target.closest('#composer')
  );
  if (!needsThreshold) {
    document.body.classList.add('window-dragging');
    window.getSelection()?.removeAllRanges();
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
    document.body.classList.add('window-dragging');
    window.getSelection()?.removeAllRanges();
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
  const wasWebContentDrag = windowDrag.isWebContentDrag;
  const started = windowDrag.started;
  const refocusComposer =
    dragFromComposer && state.composerOpen && started;
  dragFromComposer = false;
  windowDrag = null;
  dragPoint = null;
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  document.body.classList.remove('window-dragging');
  if (started) api.dragEnd();
  if (wasWebContentDrag && started) {
    document.body.classList.add('canvas-window-dragging');
    setTimeout(() => {
      document.body.classList.remove('canvas-window-dragging');
    }, 150);
  }
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

function openConfigPage(kind) {
  const key = String(kind || '').trim();
  if (api.isElectron && api.openConfigWindow) {
    Promise.resolve(api.openConfigWindow(key)).catch((error) =>
      console.error('open config window failed', error)
    );
    return;
  }
  if (key === 'mcp') window.openMcp?.();
  else openCatalog(key);
}

function openArchiveWindowForSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return;
  if (api.isElectron && api.openArchiveWindow) {
    Promise.resolve(api.openArchiveWindow(id)).catch((error) =>
      console.error('open archive window failed', error)
    );
  }
}

window.openArchiveWindowForSession = openArchiveWindowForSession;

const RING_ITEMS = [
  {
    label: 'Agent',
    icon: '<path d="M12 3a3 3 0 0 1 3 3v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a3 3 0 0 1 3-3Z"/><path d="M9 12h.01M15 12h.01M9 16h6"/>',
    action: () => openConfigPage('agents'),
  },
  {
    label: 'Tool',
    icon: '<path d="M14.5 6.5a3.5 3.5 0 0 0-4.9 4.9L4 17v3h3l5.6-5.6a3.5 3.5 0 0 0 4.9-4.9l-2.1 2.1-2.1-2.1 2.1-2.1Z"/>',
    action: () => openConfigPage('tools'),
  },
  {
    label: 'Skill',
    icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    action: () => openConfigPage('skills'),
  },
  {
    label: 'MCP',
    icon: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5"/>',
    action: () => openConfigPage('mcp'),
  },
];

const RING_ICONS = {
  rename:
    '<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>',
  trash:
    '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  agile:
    '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z"/>',
  archive:
    '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
  minimize: '<path d="M4 12h16"/>',
  maximize: '<path d="M5 5h14v14H5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

let ringCenterPoint = { x: 0, y: 0 };
let ringOpenPoint = { x: 0, y: 0 };
let ringSegments = [];
let ringLabels = [];
let ringUsagePanel = null;
let ringUsageRows = [];
let ringItems = RING_ITEMS;
let ringCatcher = null;
let actionMenuUsageCard = null;
let actionMenuItems = [];
let actionMenuPress = null;
let lastActionMenuAt = 0;

function buildActionMenuUsageCard() {
  const panel = el('div', 'ring-usage-panel usage-card');
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
  ringUsagePanel = panel;
  return panel;
}

function closeActionMenu() {
  actionMenuItems = [];
  actionMenuUsageCard = null;
  ringUsagePanel = null;
  ringUsageRows = [];
  state.ringOpen = false;
  if (!dom.actionMenu) return;
  dom.actionMenu.classList.add('hidden');
  dom.actionMenu.setAttribute('aria-hidden', 'true');
  dom.actionMenu.replaceChildren();
}

function cancelActionMenuPress() {
  actionMenuPress = null;
  closeActionMenu();
}

function closeRightClickOverlay() {
  if (dom.approvalOverlay && !dom.approvalOverlay.classList.contains('hidden')) {
    resolveToolApproval(false);
    return true;
  }
  if (dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')) {
    closeGoalDialog();
    return true;
  }
  if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) {
    closeMcpConfig();
    return true;
  }
  if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
    closeWebContent();
    return true;
  }
  if (!dom.renameOverlay.classList.contains('hidden')) {
    closeRename();
    return true;
  }
  if (!dom.confirmOverlay.classList.contains('hidden')) {
    closeConfirm();
    return true;
  }
  if (dom.projectOverlay && !dom.projectOverlay.classList.contains('hidden')) {
    closeProjectDialog();
    return true;
  }
  if (
    dom.skillArgsOverlay &&
    !dom.skillArgsOverlay.classList.contains('hidden')
  ) {
    closeSkillArgs();
    return true;
  }
  if (window.mcpOverlayOpen?.()) {
    window.closeMcp?.();
    return true;
  }
  if (state.catalogOpen) {
    closeCatalog();
    return true;
  }
  if (!dom.rawOverlay.classList.contains('hidden')) {
    closeRawRequest();
    return true;
  }
  if (!dom.settingsOverlay.classList.contains('hidden')) {
    closeSettings();
    return true;
  }
  if (state.composerOpen) {
    closeComposer();
    return true;
  }
  return false;
}

function positionActionMenu(menu, x, y) {
  const margin = 12;
  const gap = 14;
  const rect = menu.getBoundingClientRect();
  let left = x + gap;
  if (left + rect.width > window.innerWidth - margin) {
    left = x - rect.width - gap;
  }
  if (left < margin) left = margin;
  if (left + rect.width > window.innerWidth - margin) {
    left = window.innerWidth - rect.width - margin;
  }
  let top = y - rect.height / 2;
  top = Math.max(
    margin,
    Math.min(top, window.innerHeight - rect.height - margin)
  );
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function runActionMenuItem(item) {
  if (!item) return;
  if (item.confirm) {
    openConfirm({
      text: item.confirmText || `删除「${item.label}」？`,
      action: () => {
        if (typeof item.action === 'function') item.action();
      },
    });
    return;
  }
  if (typeof item.action === 'function') item.action();
}

function updateActionMenuHover(x, y) {
  if (!dom.actionMenu || !state.ringOpen) return;
  const hovered = document.elementFromPoint(x, y);
  const button =
    hovered instanceof Element
      ? hovered.closest('#action-menu .action-menu-item')
      : null;
  for (const item of dom.actionMenu.querySelectorAll(
    '.action-menu-item.active'
  )) {
    if (item !== button) item.classList.remove('active');
  }
  if (button) button.classList.add('active');
}

function openActionMenu({ x, y, items, usage = false }) {
  if (!dom.actionMenu) return;
  lastActionMenuAt = Date.now();
  closeActionMenu();
  const menu = dom.actionMenu;
  actionMenuItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (actionMenuItems.length === 0) return;
  if (usage) {
    actionMenuUsageCard = buildActionMenuUsageCard();
    menu.append(actionMenuUsageCard);
  }
  const column = el('div', 'action-menu-column');
  actionMenuItems.forEach((item, index) => {
    const button = el('button', 'action-menu-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.actionIndex = String(index);
    if (item.confirm || item.danger) button.classList.add('danger');
    if (item.icon) {
      const icon = el('span', 'action-menu-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>`;
      button.append(icon);
    }
    button.append(el('span', 'action-menu-label', item.label || ''));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const targetItem = actionMenuItems[index];
      closeActionMenu();
      lastActionMenuAt = Date.now();
      if (targetItem) runActionMenuItem(targetItem);
    });
    column.append(button);
  });
  menu.append(column);
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  menu.style.left = '0px';
  menu.style.top = '0px';
  state.ringOpen = true;
  positionActionMenu(menu, x, y);
  if (usage) {
    renderUsageCards();
    void loadUsage();
  }
}

function onActionMenuMove(event) {
  if (!actionMenuPress) return;
  actionMenuPress.x = event.clientX;
  actionMenuPress.y = event.clientY;
  if (state.ringOpen) updateActionMenuHover(event.clientX, event.clientY);
}

function startActionMenuPress(event) {
  if (event.button !== 2) return;
  if (state.systemNodeWindow) return;
  if (state.panelWindow || state.archiveWindow) return;
  if (state.chatWindow) return;
  if (
    event.target instanceof Element &&
    event.target.closest('#action-menu, .usage-card')
  ) {
    return;
  }
  if (dom.questionDock && !dom.questionDock.classList.contains('hidden')) {
    return;
  }
  if (closeRightClickOverlay()) {
    lastActionMenuAt = Date.now();
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.manager-composer')) return;
  const systemNodeTarget = target?.closest('.canvas-system-node');
  if (systemNodeTarget?.dataset.nodeId) {
    event.preventDefault();
    if (actionMenuPress) cancelActionMenuPress();
    actionMenuPress = {
      target,
      x: event.clientX,
      y: event.clientY,
      systemNode: true,
    };
    window.openSystemNodeMenuById?.(
      systemNodeTarget.dataset.nodeId,
      event.clientX,
      event.clientY
    );
    lastActionMenuAt = Date.now();
    return;
  }
  const canvasOpen = Boolean(window.canvasOverlayOpen?.());
  const switcherOpen =
    state.switcherOpen || dom.switcher.classList.contains('open');
  const frameTarget = canvasOpen ? target?.closest('.canvas-frame') : null;
  const nodeTarget = canvasOpen
    ? target?.closest('.canvas-group, .canvas-child, .canvas-manager, .canvas-manager-panel, .canvas-system-node')
    : null;
  const workspaceTarget = canvasOpen
    ? target?.closest('.canvas-workspace')
    : null;
  let menuKind = 'main';
  let canvasSessionId = null;
  let canvasWorkspaceId = null;
  let canvasFrameId = null;
  if (frameTarget?.dataset.frameId) {
    menuKind = 'canvas-frame';
    canvasFrameId = frameTarget.dataset.frameId;
  } else if (nodeTarget?.dataset.sessionId) {
    menuKind = 'canvas-node';
    canvasSessionId = nodeTarget.dataset.sessionId;
  } else if (workspaceTarget?.dataset.projectId) {
    menuKind = 'canvas-workspace';
    canvasWorkspaceId = workspaceTarget.dataset.projectId;
  } else if (canvasOpen && target?.closest('.canvas-workspaces-page')) {
    menuKind = 'window';
  } else if (!canvasOpen && switcherOpen) {
    menuKind = 'switcher';
  }
  event.preventDefault();
  if (actionMenuPress) cancelActionMenuPress();
  if (state.ringOpen) {
    closeActionMenu();
    lastActionMenuAt = Date.now();
    return;
  }
  const press = {
    target,
    x: event.clientX,
    y: event.clientY,
    menuKind,
    canvasSessionId,
    canvasWorkspaceId,
    canvasFrameId,
  };
  actionMenuPress = press;
  openActionMenuForPress(press);
}

function openActionMenuForPress(press) {
  if (!press) return;
  if (press.menuKind === 'canvas-frame' && press.canvasFrameId) {
    window.openCanvasFrameMenu?.(press.canvasFrameId, press.x, press.y);
    return;
  }
  if (press.menuKind === 'canvas-node' && press.canvasSessionId) {
    window.openCanvasNodeMenu?.(press.canvasSessionId, press.x, press.y);
    return;
  }
  if (press.menuKind === 'canvas-workspace' && press.canvasWorkspaceId) {
    window.openCanvasWorkspaceMenu?.(
      press.canvasWorkspaceId,
      press.x,
      press.y
    );
    return;
  }
  if (press.menuKind === 'window' || press.menuKind === 'switcher') {
    openSwitcherActionMenu(press.target, press.x, press.y);
    return;
  }
  openMainActionMenu(press.x, press.y);
}

function endActionMenuPress(event) {
  if (event.button !== 2) return;
  const press = actionMenuPress;
  if (!press) return;
  actionMenuPress = null;
  if (press.systemNode) return;
  if (!state.ringOpen) return;
  const hovered = document.elementFromPoint(event.clientX, event.clientY);
  const active =
    hovered instanceof Element
      ? hovered.closest('#action-menu .action-menu-item')
      : null;
  if (!active) {
    closeActionMenu();
    lastActionMenuAt = Date.now();
    return;
  }
  const index = Number(active.dataset.actionIndex);
  const item = index >= 0 ? actionMenuItems[index] : null;
  closeActionMenu();
  lastActionMenuAt = Date.now();
  if (item) runActionMenuItem(item);
}

function openMainActionMenu(x, y) {
  const items = [...RING_ITEMS];
  openActionMenu({
    x,
    y,
    usage: true,
    items,
  });
}

function openSwitcherActionMenu(target, x, y) {
  const projectRow = target?.closest('.project-row, .project-row-wrap');
  if (projectRow?.dataset.projectId) {
    const projectId = projectRow.dataset.projectId;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    openActionMenu({
      x,
      y,
      items: [
        {
          label: '改名',
          icon: RING_ICONS.rename,
          action: () => openRename('project', projectId),
        },
        {
          label: '配置目录',
          icon: RING_ICONS.folder,
          action: () => openProjectDialog('edit', projectId),
        },
        {
          label: '删除',
          icon: RING_ICONS.trash,
          action: () => deleteProject(projectId),
          confirm: true,
          confirmText: `删除「${project.name}」和所有对话？不可恢复。`,
        },
      ],
    });
    return;
  }

  const card = target?.closest('.switch-card');
  if (card?.dataset.sessionId) {
    const sessionId = card.dataset.sessionId;
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const items = [];
    if (session.nodeRole !== 'manager') {
      items.push({
        label: '改名',
        icon: RING_ICONS.rename,
        action: () => openRename('session', sessionId),
      });
    }
    items.push({
      label: '删除',
      icon: RING_ICONS.trash,
      action: () => deleteSessionById(sessionId),
      confirm: true,
      confirmText: `删除「${session.title}」？不可恢复。`,
    });
    openActionMenu({ x, y, items });
    return;
  }

  const items = [
    {
      label: '设置',
      icon: RING_ICONS.settings,
      action: () => {
        closeSwitcher();
        openSettings();
      },
    },
  ];
  if (api.isElectron) {
    items.push(
      {
        label: '最小化',
        icon: RING_ICONS.minimize,
        action: () => api.minimize(),
      },
      {
        label: '放大',
        icon: RING_ICONS.maximize,
        action: () => api.maximize(),
      },
      {
        label: '关闭',
        icon: RING_ICONS.close,
        action: () => api.close(),
        danger: true,
      }
    );
  }
  openActionMenu({ x, y, items });
}

function handleContextMenu(event) {
  event.preventDefault();
}

function handleRightClickBack() {
  if (Date.now() - lastActionMenuAt < 450) return;
  if (state.systemNodeWindow) {
    window.closeSystemNodeWindow?.();
    return;
  }
  if (document.querySelector('.system-node-page')) {
    window.closeSystemNodeWindow?.();
    return;
  }
  if (state.archiveWindow) {
    api.close();
    return;
  }
  if (state.ringOpen) {
    closeActionMenu();
    return;
  }

  if (dom.questionDock && !dom.questionDock.classList.contains('hidden')) {
    void dismissQuestion();
    return;
  }
  if (dom.webContent && !dom.webContent.classList.contains('hidden')) {
    closeWebContent();
    return;
  }
  if (state.composerOpen) {
    closeComposer();
    return;
  }
  if (dom.approvalOverlay && !dom.approvalOverlay.classList.contains('hidden')) {
    void resolveToolApproval(false);
    return;
  }
  if (!dom.renameOverlay.classList.contains('hidden')) {
    closeRename();
    return;
  }
  if (!dom.confirmOverlay.classList.contains('hidden')) {
    closeConfirm();
    return;
  }
  if (dom.projectOverlay && !dom.projectOverlay.classList.contains('hidden')) {
    closeProjectDialog();
    return;
  }
  if (dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')) {
    closeGoalDialog();
    return;
  }
  if (dom.skillArgsOverlay && !dom.skillArgsOverlay.classList.contains('hidden')) {
    closeSkillArgs();
    return;
  }
  if (!dom.settingsOverlay.classList.contains('hidden')) {
    closeSettings();
    return;
  }
  if (
    dom.backgroundOverlay &&
    !dom.backgroundOverlay.classList.contains('hidden')
  ) {
    closeBackgroundPanel();
    return;
  }
  if (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden')) {
    closeMcpConfig();
    return;
  }
  if (state.switcherOpen) {
    closeSwitcher();
    return;
  }
  if (state.catalogOpen) {
    closeCatalog();
    return;
  }
  if (window.mcpOverlayOpen?.()) {
    window.closeMcp?.();
    return;
  }
  if (!dom.rawOverlay.classList.contains('hidden')) {
    closeRawRequest();
    return;
  }
  if (state.chatWindow) {
    api.close();
    return;
  }
  if (window.canvasOverlayOpen?.()) {
    window.closeCanvas?.();
    return;
  }
  if (window.agileOverlayOpen?.()) {
    window.closeAgile?.();
    return;
  }
}

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
    if (item.confirm || item.danger) {
      path.classList.add('danger');
      label.classList.add('danger');
    }
    dom.ringMenu.append(label);
    ringLabels.push(label);
  });

  if (options.usage === false) return;

  const usageLayer = el('div', 'ring-usage-layer');
  const panel = el('div', 'ring-usage-panel');
  const panelPoint = ringPolar(RING_USAGE_RADIUS, -90);
  panel.style.left = `${panelPoint.x}px`;
  panel.style.top = `${panelPoint.y}px`;
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

function setRingItemLabel(index, text, danger) {
  const label = ringLabels[index];
  const segment = ringSegments[index];
  if (!label) return;
  const textNode = label.querySelector('span');
  if (textNode) textNode.textContent = text;
  label.classList.toggle('danger', Boolean(danger));
  if (segment) segment.classList.toggle('danger', Boolean(danger));
}

function activateRingItem(index) {
  const item = index >= 0 ? ringItems[index] : null;
  if (!item) {
    closeRingMenu();
    return;
  }
  if (state.ringConfirmIndex >= 0 && state.ringConfirmIndex !== index) {
    const previous = ringItems[state.ringConfirmIndex];
    if (previous) {
      setRingItemLabel(state.ringConfirmIndex, previous.label, false);
    }
    state.ringConfirmIndex = -1;
  }
  if (item.confirm && state.ringConfirmIndex !== index) {
    state.ringConfirmIndex = index;
    setRingItemLabel(index, '确认删除', true);
    return;
  }
  closeRingMenu();
  if (typeof item.action === 'function') item.action();
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
  ringOpenPoint = { x, y };
  dom.ringMenu.style.left = `${cx}px`;
  dom.ringMenu.style.top = `${cy}px`;
  state.ringOpen = true;
  state.ringMoved = false;
  state.ringConfirmIndex = -1;
  state.ringSuppress = true;
  updateRingSelection(-1);
  ensureRingCatcher();
  document.body.classList.add('ring-open');
  dom.ringMenu.setAttribute('aria-hidden', 'false');
  dom.ringMenu.classList.add('open');
  if (options.usage !== false) void loadUsage();
}

function ensureRingCatcher() {
  if (ringCatcher) return;
  ringCatcher = el('div', 'ring-catcher');
  ringCatcher.addEventListener('mousedown', (event) => {
    if (event.button === 2) return;
    event.stopPropagation();
  });
  ringCatcher.addEventListener('mouseup', (event) => {
    if (event.button === 2) return;
    event.stopPropagation();
  });
  ringCatcher.addEventListener('click', (event) => {
    if (event.button !== 0 || !state.ringOpen) return;
    event.preventDefault();
    event.stopPropagation();
    const index = ringIndexForPoint(event.clientX, event.clientY);
    if (index < 0) {
      closeRingMenu();
      return;
    }
    activateRingItem(index);
  });
  document.body.append(ringCatcher);
}

function removeRingCatcher() {
  if (!ringCatcher) return;
  ringCatcher.remove();
  ringCatcher = null;
}

function closeRingMenu() {
  closeActionMenu();
}

function updateRingFromPointer(event) {
  if (!state.ringOpen) return;
  if (
    !state.ringMoved &&
    Math.hypot(
      event.clientX - ringOpenPoint.x,
      event.clientY - ringOpenPoint.y
    ) > 6
  ) {
    state.ringMoved = true;
  }
  updateRingSelection(ringIndexForPoint(event.clientX, event.clientY));
}

function openSwitcherRingMenu(event) {
  const target = event.target instanceof Element ? event.target : null;
  const projectRow = target?.closest('.project-row, .project-row-wrap');
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
          label: '配置目录',
          icon: RING_ICONS.folder,
          action: () => openProjectDialog('edit', projectId),
        },
        {
          label: '删除',
          icon: RING_ICONS.trash,
          action: () => deleteProject(projectId),
          confirm: true,
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
          label: '删除',
          icon: RING_ICONS.trash,
          action: () => deleteSessionById(sessionId),
          confirm: true,
        },
      ],
      { usage: false }
    );
    return;
  }

  const items = [
    {
      label: '设置',
      icon: RING_ICONS.settings,
      action: () => {
        closeSwitcher();
        openSettings();
      },
    },
  ];
  if (api.isElectron) {
    items.push(
      {
        label: '最小化',
        icon: RING_ICONS.minimize,
        action: () => api.minimize(),
      },
      {
        label: '放大',
        icon: RING_ICONS.maximize,
        action: () => api.maximize(),
      },
      {
        label: '关闭',
        icon: RING_ICONS.close,
        action: () => api.close(),
        danger: true,
      }
    );
  }
  openRingMenu(event.clientX, event.clientY, items, { usage: false });
}

function onRightMouseDown(event) {
  if (event.button !== 2) return;
  if (window.canvasOverlayOpen?.()) return;
  closeAgentMenu();
  if (dom.approvalOverlay && !dom.approvalOverlay.classList.contains('hidden')) {
    state.ringSuppress = true;
    return;
  }
  if (dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')) {
    closeGoalDialog();
    state.ringSuppress = true;
    return;
  }
  if (
    dom.backgroundOverlay &&
    !dom.backgroundOverlay.classList.contains('hidden')
  ) {
    closeBackgroundPanel();
    state.ringSuppress = true;
    return;
  }

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
  if (dom.projectOverlay && !dom.projectOverlay.classList.contains('hidden')) {
    closeProjectDialog();
    state.ringSuppress = true;
    return;
  }
  if (dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')) {
    closeGoalDialog();
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
  if (window.agileOverlayOpen?.()) {
    window.closeAgile?.();
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
  if (index < 0) {
    closeRingMenu();
    return;
  }
  activateRingItem(index);
}

const CATALOG_EMPTY = {
  tools: '还没有工具',
  skills: '还没有 Skill',
  mcp: '还没有 MCP',
};
function skillCatalogGroups(data) {
  const system = [];
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
    } else if (skill.sourceKind === 'system') {
      const entry = system.find((item) => item.id === 'local:系统');
      if (entry) entry.count += 1;
      else system.push({ id: 'local:系统', label: '系统', count: 1 });
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
  return { system, locals, servers };
}

function ensureCatalogSelection(data, page) {
  if (page === 'agents') {
    const exists = state.agents.some(
      (agent) => `agent:${agent.id}` === state.catalogKind
    );
    if (!exists) {
      state.catalogKind = state.agents[0]
        ? `agent:${state.agents[0].id}`
        : 'agent:none';
    }
    return;
  }
  if (page === 'skills') {
    const { system, locals, servers } = skillCatalogGroups(data);
    const all = [...system, ...locals, ...servers];
    if (!all.some((item) => item.id === state.catalogKind)) {
      state.catalogKind = all[0]?.id || 'local:系统';
    }
    return;
  }
  if (!state.catalogKind?.startsWith('tool:')) return;
  const counts = toolCountsByGroup(data?.tools);
  const groupId = state.catalogKind.slice(5);
  if ((counts.get(groupId) || 0) > 0) return;
  const first = TOOL_GROUPS.find(
    (group) => !group.hidden && (counts.get(group.id) || 0) > 0
  );
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
  if (state.panelWindow && api.isElectron) api.close();
}

function catalogCategoryButton(item, selectedKind) {
  const button = el('button', 'catalog-category');
  button.type = 'button';
  button.dataset.kind = item.id;
  if (item.id === selectedKind) button.classList.add('selected');
  button.append(el('span', 'catalog-category-name', item.label));
  if (item.count !== null && item.count !== undefined) {
    button.append(el('span', 'catalog-category-count', String(item.count)));
  }
  button.addEventListener('click', () => selectCatalogKind(item.id));
  return button;
}

function renderCatalogCategories(data, selectedKind, page) {
  dom.catalogCategories.replaceChildren();

  if (page === 'skills') {
    const { system, locals, servers } = skillCatalogGroups(data);
    const items = [
      ...system,
      ...locals,
      ...servers.map((item) => ({
        ...item,
        label: `MCP · ${item.label}`,
      })),
    ];
    if (items.length === 0) {
      items.push({ id: 'local:内置', label: '内置', count: 0 });
    }
    const section = el('div', 'catalog-section');
    for (const item of items) {
      section.append(catalogCategoryButton(item, selectedKind));
    }
    dom.catalogCategories.append(section);
    return;
  }

  if (page === 'agents') {
    const management = state.agents.filter(
      (agent) => agent.id === MANAGER_AGENT_ID
    );
    const agents = state.agents.filter(
      (agent) => agent.id !== MANAGER_AGENT_ID && agent.kind === 'agent'
    );
    const subagents = state.agents.filter(
      (agent) => agent.id !== MANAGER_AGENT_ID && agent.kind !== 'agent'
    );
    if (management.length > 0) {
      const managementSection = el(
        'div',
        'catalog-section catalog-agent-section'
      );
      managementSection.append(
        el('div', 'catalog-section-label', '管理')
      );
      for (const agent of management) {
        managementSection.append(
          catalogCategoryButton(
            { id: `agent:${agent.id}`, label: agent.name, count: null },
            selectedKind
          )
        );
      }
      dom.catalogCategories.append(managementSection);
    }
    for (const [label, kind, entries] of [
      ['Agent', 'agent', agents],
      ['Subagent', 'subagent', subagents],
    ]) {
      if (entries.length === 0) continue;
      const section = el('div', 'catalog-section catalog-agent-section');
      section.append(el('div', 'catalog-section-label', label));
      for (const agent of entries) {
        section.append(
          catalogCategoryButton(
            { id: `agent:${agent.id}`, label: agent.name, count: null },
            selectedKind
          )
        );
      }
      dom.catalogCategories.append(section);
    }
    return;
  }

  let items;
  if (page === 'tools') {
    const toolCounts = toolCountsByGroup(data?.tools);
    items = TOOL_GROUPS.filter((group) => !group.hidden)
      .map((group) => ({
        id: `tool:${group.id}`,
        label: group.label,
        count: toolCounts.get(group.id) || 0,
      }))
      .filter((item) => item.count > 0);
    const otherCount = toolCounts.get('other') || 0;
    if (otherCount > 0) {
      items.push({ id: 'tool:other', label: '画布', count: otherCount });
    }
    if (items.length === 0) {
      items.push({ id: 'tool:other', label: '画布', count: 0 });
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

function catalogChevron() {
  const chevron = el('span', 'catalog-tool-chevron');
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  return chevron;
}

function bindCatalogCardToggle(item, head) {
  head.addEventListener('click', () => {
    const wasOpen = item.classList.contains('open');
    for (const other of dom.catalogList.querySelectorAll(
      '.catalog-tool-item.open'
    )) {
      other.classList.remove('open');
      other
        .querySelector('.catalog-tool-head')
        ?.setAttribute('aria-expanded', 'false');
    }
    if (wasOpen) return;
    item.classList.add('open');
    head.setAttribute('aria-expanded', 'true');
  });
}

function renderCatalogSkillItem(entry) {
  const item = el('div', 'catalog-item catalog-tool-item');
  const args = Array.isArray(entry.arguments) ? entry.arguments : [];
  const hasDetails = Boolean(
    entry.description || entry.instruction || args.length
  );
  const parts = [];
  const category = skillCategory(entry);
  const source = entry.sourceKind === 'mcp' ? 'MCP' : entry.source || '';
  if (category) parts.push(category);
  if (source && source !== category) parts.push(source);
  if (entry.readOnly) parts.push('只读');
  if (entry.command) parts.push('系统命令');
  if (args.length > 0) parts.push(`${args.length} 参数`);

  const head = el('button', 'catalog-tool-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.append(el('span', 'catalog-tool-dot'));
  head.append(el('span', 'catalog-tool-name', entry.name || 'Skill'));
  if (parts.length > 0) {
    head.append(el('span', 'catalog-tool-meta', parts.join(' · ')));
  }
  if (hasDetails) head.append(catalogChevron());
  item.append(head);
  if (!hasDetails) return item;

  const body = el('div', 'catalog-tool-body');
  const clip = el('div', 'catalog-tool-clip');
  const inner = el('div', 'catalog-tool-inner');
  if (entry.description) {
    inner.append(el('div', 'catalog-desc', entry.description));
  }
  if (entry.instruction) {
    const block = el('div', 'catalog-skill-instruction-block');
    block.append(el('div', 'catalog-skill-label', '固定指令'));
    block.append(el('pre', 'catalog-skill-instruction', entry.instruction));
    inner.append(block);
  }
  if (args.length > 0) {
    const params = el('div', 'catalog-params');
    for (const argument of args) {
      const row = el('div', 'catalog-param');
      const paramHead = el('div', 'catalog-param-head');
      paramHead.append(
        el('span', 'catalog-param-name', argument.name || 'argument')
      );
      if (argument.required) {
        paramHead.append(el('span', 'catalog-param-required', '必填'));
      }
      row.append(paramHead);
      if (argument.description) {
        row.append(el('div', 'catalog-param-desc', argument.description));
      }
      params.append(row);
    }
    inner.append(params);
  }
  clip.append(inner);
  body.append(clip);
  item.append(body);
  bindCatalogCardToggle(item, head);
  return item;
}

function renderCatalogToolItem(entry) {
  const fn = entry.function || entry;
  const toolName = fn.name || 'tool';
  const displayDescription =
    window.toolDisplayDescription?.(toolName, fn.description) || '';
  const item = el('div', 'catalog-item catalog-tool-item');
  const properties = fn.parameters?.properties || {};
  const required = new Set(fn.parameters?.required || []);
  const names = Object.keys(properties);
  const hasDetails = Boolean(displayDescription) || names.length > 0;
  const meta = names.length
    ? `${names.length} 参数${required.size ? ` · ${required.size} 必填` : ''}`
    : '无参数';
  const head = el('button', 'catalog-tool-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.title = toolName;
  head.append(el('span', 'catalog-tool-dot'));
  head.append(el('span', 'catalog-tool-name', toolName));
  head.append(el('span', 'catalog-tool-meta', meta));
  if (hasDetails) head.append(catalogChevron());
  item.append(head);
  if (!hasDetails) return item;

  const body = el('div', 'catalog-tool-body');
  const clip = el('div', 'catalog-tool-clip');
  const inner = el('div', 'catalog-tool-inner');
  if (displayDescription) {
    inner.append(el('div', 'catalog-desc', displayDescription));
  }
  if (names.length > 0) {
    const params = el('div', 'catalog-params');
    for (const paramName of names) {
      const schema = properties[paramName] || {};
      const description =
        window.toolParamDescription?.(toolName, paramName) || '';
      const row = el('div', 'catalog-param');
      const paramHead = el('div', 'catalog-param-head');
      paramHead.append(el('span', 'catalog-param-name', paramName));
      if (schema.type) {
        paramHead.append(
          el(
            'span',
            'catalog-param-type',
            window.toolTypeLabel?.(schema.type) || schema.type
          )
        );
      }
      if (required.has(paramName)) {
        paramHead.append(el('span', 'catalog-param-required', '必填'));
      }
      row.append(paramHead);
      if (description) {
        row.append(el('div', 'catalog-param-desc', description));
      }
      params.append(row);
    }
    inner.append(params);
  }
  clip.append(inner);
  body.append(clip);
  item.append(body);
  bindCatalogCardToggle(item, head);
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
  const group = TOOL_GROUPS.find((item) => item.id === groupId);
  if (group?.hidden) {
    dom.catalogList.append(el('div', 'catalog-empty', CATALOG_EMPTY.tools));
    return;
  }
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
          entry.readOnly ? '只读' : '',
          entry.command ? '系统命令' : '',
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
  if (entry.instruction) {
    const details = el('details', 'catalog-instruction');
    details.append(el('summary', '', '固定指令（只读）'));
    details.append(el('pre', 'catalog-instruction-text', entry.instruction));
    item.append(details);
  }
  return item;
}

function renderCatalogList(kind, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    dom.catalogList.append(
      el('div', 'catalog-empty', CATALOG_EMPTY[kind] || '还没有内容')
    );
    return;
  }

  if (kind === 'skills') {
    for (const entry of entries) {
      dom.catalogList.append(renderCatalogSkillItem(entry));
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
    const entries = (state.catalogData?.skills || []).filter((skill) =>
      category === '系统'
        ? skill.sourceKind === 'system'
        : skill.sourceKind !== 'mcp' &&
          skill.sourceKind !== 'system' &&
          skillCategory(skill) === category
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
  if (kind?.startsWith('agent:')) {
    renderAgentEditor(kind.slice('agent:'.length));
    return;
  }
  renderCatalogList(
    kind,
    kind === 'skills' ? state.catalogData?.skills : state.catalogData?.mcp
  );
}

function agentToolGroups(allTools) {
  const groups = [];
  for (const group of TOOL_GROUPS) {
    const tools = allTools.filter((entry) => {
      const fn = entry.function || entry;
      return toolGroupFor(fn).id === group.id;
    });
    if (tools.length > 0) {
      groups.push({ id: group.id, label: group.label, tools });
    }
  }
  const other = allTools.filter((entry) => {
    const fn = entry.function || entry;
    return toolGroupFor(fn).id === 'other';
  });
  if (other.length > 0) {
    groups.push({ id: 'other', label: '画布', tools: other });
  }
  return groups;
}

function renderAgentToolsEditor(agent, allTools, options = {}) {
  const readOnly = options.readOnly === true;
  const field = el('div', 'agent-field');
  field.append(el('div', 'agent-field-label', '工具权限'));

  const allNames = allTools.map((tool) => tool.name).filter(Boolean);
  const known = new Set(allNames);
  const selected = new Set(
    Array.isArray(agent.tools)
      ? agent.tools.map(String).filter((name) => known.has(name))
      : allNames
  );
  const groups = agentToolGroups(allTools);
  if (!groups.some((group) => group.id === state.agentToolGroup)) {
    state.agentToolGroup = groups[0]?.id || null;
  }

  const layout = el('div', 'agent-tools-layout');
  if (readOnly) layout.classList.add('readonly');
  const side = el('div', 'agent-tools-side');
  const sideList = el('div', 'agent-tools-side-list');
  const main = el('div', 'agent-tools-main');

  const lockCheckbox = (checkbox) => {
    if (!readOnly) return;
    checkbox.tabIndex = -1;
    checkbox.addEventListener('click', (event) => event.preventDefault());
    checkbox.addEventListener('keydown', (event) => event.preventDefault());
  };

  const head = el('div', 'agent-tools-head');
  const allLabel = el('label', 'agent-toggle');
  const allCheckbox = document.createElement('input');
  allCheckbox.type = 'checkbox';
  lockCheckbox(allCheckbox);
  allLabel.append(allCheckbox);
  allLabel.append(el('span', 'agent-toggle-label', '允许所有工具'));
  head.append(allLabel);
  side.append(head, sideList);

  const search = el('input', 'agent-tools-search');
  search.type = 'search';
  search.placeholder = '搜索工具…';
  main.append(search);

  const list = el('div', 'agent-tools');
  main.append(list);

  const categoryRows = new Map();
  const toolCheckboxes = new Map();

  const groupSelectedCount = (group) =>
    group.tools.reduce(
      (total, tool) => total + (selected.has(tool.name) ? 1 : 0),
      0
    );

  const applySearch = () => {
    const query = search.value.trim().toLowerCase();
    for (const row of list.querySelectorAll('.agent-tool-row')) {
      row.classList.toggle(
        'hidden',
        Boolean(query) && !row.dataset.search.includes(query)
      );
    }
  };

  const updateState = () => {
    const active = selected.size;
    allCheckbox.checked = allNames.length > 0 && active === allNames.length;
    allCheckbox.indeterminate = active > 0 && active < allNames.length;
    for (const group of groups) {
      const entry = categoryRows.get(group.id);
      if (!entry) continue;
      const groupCount = groupSelectedCount(group);
      entry.checkbox.checked = groupCount === group.tools.length;
      entry.checkbox.indeterminate =
        groupCount > 0 && groupCount < group.tools.length;
      entry.row.classList.toggle(
        'selected',
        state.agentToolGroup === group.id
      );
    }
    for (const [name, checkbox] of toolCheckboxes) {
      checkbox.checked = selected.has(name);
    }
  };

  const renderList = () => {
    list.replaceChildren();
    toolCheckboxes.clear();
    const group = groups.find((item) => item.id === state.agentToolGroup);
    const tools = group?.tools || [];
    if (tools.length === 0) {
      list.append(el('div', 'agent-tools-empty', '没有工具'));
      return;
    }
    for (const tool of tools) {
      const row = el('label', 'agent-tool-row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      lockCheckbox(checkbox);
      checkbox.checked = selected.has(tool.name);
      if (!readOnly) {
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(tool.name);
          else selected.delete(tool.name);
          updateState();
        });
      }
      const displayName = tool.name;
      const displayDescription =
        window.toolDisplayDescription?.(tool.name, tool.description) || '';
      const body = el('span', 'agent-tool-body');
      const nameNode = el('span', 'agent-tool-name', displayName);
      nameNode.title = tool.name;
      body.append(nameNode);
      if (displayDescription) {
        body.append(el('span', 'agent-tool-desc', displayDescription));
      }
      row.append(checkbox, body);
      row.dataset.search =
        `${displayName} ${displayDescription} ${tool.name} ${tool.description || ''}`.toLowerCase();
      list.append(row);
      toolCheckboxes.set(tool.name, checkbox);
    }
    applySearch();
  };

  for (const group of groups) {
    const row = el('div', 'agent-tools-category');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    lockCheckbox(checkbox);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    if (!readOnly) {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          for (const tool of group.tools) selected.add(tool.name);
        } else {
          for (const tool of group.tools) selected.delete(tool.name);
        }
        updateState();
      });
    }
    row.append(checkbox);
    const name = el('button', 'agent-tools-category-name', group.label);
    name.type = 'button';
    name.title = group.label;
    row.append(name);
    const select = () => {
      state.agentToolGroup = group.id;
      renderList();
      updateState();
    };
    row.addEventListener('click', (event) => {
      if (event.target === checkbox) return;
      select();
    });
    sideList.append(row);
    categoryRows.set(group.id, { row, checkbox });
  }

  allCheckbox.addEventListener('change', () => {
    if (readOnly) return;
    if (allCheckbox.checked) {
      for (const name of allNames) selected.add(name);
    } else {
      selected.clear();
    }
    updateState();
  });

  search.addEventListener('input', applySearch);

  layout.append(side, main);
  field.append(layout);
  renderList();
  updateState();
  return field;
}

function renderAgentEditor(agentId) {
  dom.catalogList.replaceChildren();
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) {
    dom.catalogList.append(
      el(
        'div',
        'catalog-empty',
        '还没有 Agent'
      )
    );
    return;
  }
  const allTools = (
    Array.isArray(state.catalogData?.agentTools)
      ? state.catalogData.agentTools
      : []
  ).filter((tool) => {
    const fn = tool.function || tool;
    return !String(fn.name || '').startsWith('mcp__');
  });
  const readOnly = true;
  const editor = el('div', 'agent-editor');
  const head = el('div', 'agent-editor-head');
  const name = el('div', 'agent-name-input agent-name-static', agent.name);
  head.append(name);
  editor.append(head);

  const promptField = el('div', 'agent-field');
  promptField.append(el('div', 'agent-field-label', '提示词'));
  const prompt = el('textarea', 'agent-prompt agent-prompt-static');
  prompt.rows = 8;
  prompt.placeholder = '会注入 system prompt';
  prompt.value = agent.prompt || '';
  prompt.readOnly = true;
  prompt.tabIndex = -1;
  promptField.append(prompt);
  editor.append(promptField);

  const allowedTools = allTools;
  editor.append(renderAgentToolsEditor(agent, allowedTools, { readOnly }));
  dom.catalogList.append(editor);
}

async function openCatalog(kind) {
  closeAgentMenu();
  closeRingMenu();
  const page =
    kind === 'skills' || kind === 'mcp' || kind === 'agents' ? kind : 'tools';
  const label =
    page === 'skills'
      ? 'Skill'
      : page === 'mcp'
        ? 'MCP'
        : page === 'agents'
          ? 'Agent'
          : 'Tool';
  dom.catalog.setAttribute('aria-label', label);
  if (state.panelWindow) document.title = `YAH - ${label}`;
  state.catalogOpen = true;
  state.catalogKind =
    page === 'tools'
      ? 'tool:search'
      : page === 'skills'
        ? 'local:系统'
        : page === 'agents'
          ? 'agent:none'
          : 'mcp';
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
    if (page === 'agents') {
      const agentData = await api.loadAgents();
      if (!state.catalogOpen || request !== state.catalogRequest) return;
      state.agents = Array.isArray(agentData?.agents) ? agentData.agents : [];
      state.agentsFetchedAt = Date.now();
      renderAgentPicker();
    }
    ensureCatalogSelection(data, page);
    renderCatalogCategories(data, state.catalogKind, page);
    renderCatalogContent(state.catalogKind);
  } catch (error) {
    console.error('load catalog failed', error);
    if (!state.catalogOpen || request !== state.catalogRequest) return;
    dom.catalogCategories.replaceChildren();
    dom.catalogList.replaceChildren(
      el('div', 'catalog-empty', '加载失败')
    );
  }
}

function bindEvents() {
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
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('selectstart', (event) => {
    const target =
      event.target instanceof Element
        ? event.target
        : event.target?.parentElement;
    if (target && target.closest('input, textarea, #web-content')) {
      return;
    }
    event.preventDefault();
  });

  document.addEventListener('mousedown', startActionMenuPress, true);
  document.addEventListener('mousemove', onActionMenuMove, true);
  document.addEventListener('mouseup', endActionMenuPress, true);
  document.addEventListener(
    'mouseup',
    (event) => {
      if (event.button !== 2) return;
      handleRightClickBack();
    },
    true
  );
  document.addEventListener('mousedown', onWindowDragStart);
  document.addEventListener('mousemove', onWindowDragMove);
  document.addEventListener('mouseup', onWindowDragEnd);
  window.addEventListener('blur', onWindowDragEnd);

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (!window.canvasOverlayOpen?.()) return;
      if (event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (dom.managerComposer && !dom.managerComposer.classList.contains('hidden')) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'button, input, textarea, select, [contenteditable="true"]'
        )
      ) {
        return;
      }
      if (
        dialogConfirmButton() ||
        state.switcherOpen ||
        state.catalogOpen ||
        state.ringOpen ||
        state.composerOpen ||
        !dom.rawOverlay.classList.contains('hidden') ||
        !dom.questionDock.classList.contains('hidden') ||
        (dom.backgroundOverlay &&
          !dom.backgroundOverlay.classList.contains('hidden')) ||
        (dom.mcpConfig && !dom.mcpConfig.classList.contains('hidden'))
      ) {
        return;
      }
      event.preventDefault();
      openManagerComposer();
    },
    true
  );

  document.addEventListener(
    'keyup',
    (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      canvasSpaceHeld = false;
      document.body.classList.remove('canvas-space');
    },
    true
  );

  window.addEventListener('blur', () => {
    canvasSpaceHeld = false;
    document.body.classList.remove('canvas-space');
  });
  window.canvasSpaceHeld = () => canvasSpaceHeld;
  window.openSessionWindow = openSessionWindow;
  window.openManagerComposer = openManagerComposer;
  window.closeManagerComposer = closeManagerComposer;
  window.refreshChats = refreshChats;
  window.flushChats = saveChatsNow;

  window.addEventListener('resize', syncMaximized);
  syncMaximized();

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!state.ringOpen) return;
      if (actionMenuPress) return;
      if (
        event.target instanceof Element &&
        event.target.closest('#action-menu, .usage-card')
      ) {
        return;
      }
      closeActionMenu();
    },
    true
  );
  window.addEventListener('blur', cancelActionMenuPress);
  window.addEventListener('blur', closeAgentMenu);
  window.addEventListener('resize', cancelActionMenuPress);
  document.addEventListener(
    'scroll',
    (event) => {
      if (!state.ringOpen && !actionMenuPress) return;
      if (
        event.target instanceof Element &&
        event.target.closest('#action-menu')
      ) {
        return;
      }
      cancelActionMenuPress();
    },
    true
  );

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

  dom.projectCancel?.addEventListener('click', closeProjectDialog);
  dom.projectSave?.addEventListener('click', saveProjectDialog);
  dom.projectOverlay?.addEventListener('click', (event) => {
    if (event.target === dom.projectOverlay) closeProjectDialog();
  });
  dom.goalCancel?.addEventListener('click', closeGoalDialog);
  dom.goalStart?.addEventListener('click', async () => {
    const session = currentSession();
    if (!session || state.goalSaving) return;
    await startGoalFromObjective(
      session,
      dom.goalObjective.value,
      dom.goalBudget.value
    );
  });
  dom.goalOverlay?.addEventListener('click', (event) => {
    if (event.target === dom.goalOverlay) closeGoalDialog();
  });
  dom.goalObjective?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      dom.goalStart?.click();
    }
  });
  dom.projectName?.addEventListener('input', () => {
    if (!projectDialog) return;
    projectDialog.name = dom.projectName.value;
    dom.projectSave.disabled =
      !projectDialog.name.trim() || projectDialog.directories.length === 0;
  });
  dom.projectDrop?.addEventListener('click', async () => {
    const paths = await api.pickDirectories();
    for (const path of paths) await addProjectDirectory(path);
  });
  dom.projectDrop?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dom.projectDrop.click();
    }
  });
  dom.projectDrop?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dom.projectDrop.classList.add('dragging');
  });
  dom.projectDrop?.addEventListener('dragleave', () => {
    dom.projectDrop.classList.remove('dragging');
  });
  dom.managerComposer?.addEventListener('click', (event) => {
    if (event.target === dom.managerComposer) closeManagerComposer();
  });
  dom.managerComposer?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeManagerComposer();
  });
  dom.managerComposer?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      closeManagerComposer();
      return;
    }
    if (
      (event.code === 'Space' || event.key === ' ') &&
      !event.isComposing &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const nameInput = dom.managerName;
      const nameFocused =
        nameInput &&
        (event.target === nameInput || document.activeElement === nameInput);
      if (nameFocused) {
        if (!String(nameInput.value || '').trim()) {
          event.preventDefault();
          event.stopPropagation();
          closeManagerComposer();
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!String(nameInput?.value || '').trim()) {
        closeManagerComposer();
      }
      return;
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, select, textarea')
      ) {
        return;
      }
      event.preventDefault();
      void createManagerFromComposer();
    }
  });
  dom.managerDrop?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dom.managerDrop.classList.add('dragging');
  });
  dom.managerDrop?.addEventListener('dragleave', () => {
    dom.managerDrop.classList.remove('dragging');
  });
  dom.managerDrop?.addEventListener('drop', async (event) => {
    event.preventDefault();
    dom.managerDrop.classList.remove('dragging');
    const files = [...(event.dataTransfer?.files || [])];
    const paths = files
      .map((file) => api.getPathForFile(file))
      .filter(Boolean);
    await addManagerComposerDirectories(paths);
  });
  dom.managerDrop?.addEventListener('click', async () => {
    const paths = await api.pickDirectories();
    await addManagerComposerDirectories(paths);
  });
  dom.projectDrop?.addEventListener('drop', async (event) => {
    event.preventDefault();
    dom.projectDrop.classList.remove('dragging');
    const files = [...(event.dataTransfer?.files || [])];
    for (const file of files) {
      const path = api.getPathForFile(file);
      if (path) await addProjectDirectory(path);
    }
  });

  dom.approvalDeny?.addEventListener('click', () => resolveToolApproval(false));
  dom.approvalAllow?.addEventListener('click', () => resolveToolApproval(true));
  dom.questionClose?.addEventListener('click', () => void dismissQuestion());
  dom.questionBack?.addEventListener('click', () => {
    const active = state.activeQuestion;
    if (!active || active.index === 0) return;
    active.index -= 1;
    active.error = '';
    renderQuestionDock();
  });
  dom.questionNext?.addEventListener('click', () => {
    const active = state.activeQuestion;
    if (!active) return;
    if (active.index >= active.questions.length - 1) {
      void submitQuestion();
      return;
    }
    active.index += 1;
    active.error = '';
    renderQuestionDock();
  });
  if (dom.questionDock) {
    const resetQuestionInteraction = () => resetQuestionCountdown();
    dom.questionDock.addEventListener(
      'pointerdown',
      resetQuestionInteraction
    );
    dom.questionDock.addEventListener('keydown', resetQuestionInteraction);
    dom.questionDock.addEventListener('input', resetQuestionInteraction);
    dom.questionDock.addEventListener('change', resetQuestionInteraction);
    dom.questionDock.addEventListener('focusin', resetQuestionInteraction);
    dom.questionDock.addEventListener('wheel', resetQuestionInteraction, {
      passive: true,
    });
  }
  dom.backgroundBadge?.addEventListener('click', () => {
    if (dom.backgroundOverlay.classList.contains('hidden')) {
      openBackgroundPanel();
    } else {
      closeBackgroundPanel();
    }
  });
  dom.backgroundClose?.addEventListener('click', closeBackgroundPanel);
  dom.backgroundOverlay?.addEventListener('click', (event) => {
    if (event.target === dom.backgroundOverlay) closeBackgroundPanel();
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

  if (dom.composerEffortRail) {
    dom.composerEffortRail.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      state.effortDragging = true;
      try {
        dom.composerEffortRail.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      previewComposerEffort(event);
    });
    dom.composerEffortRail.addEventListener('pointermove', (event) => {
      if (!state.effortDragging) return;
      previewComposerEffort(event);
    });
    const endEffortDrag = (event, updateFromPointer = true) => {
      if (!state.effortDragging) return;
      if (updateFromPointer) previewComposerEffort(event);
      state.effortDragging = false;
      dom.composerEffortRail.classList.remove('dragging');
      try {
        dom.composerEffortRail.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      renderComposerEffort();
    };
    dom.composerEffortRail.addEventListener('pointerup', (event) =>
      endEffortDrag(event, true)
    );
    dom.composerEffortRail.addEventListener('pointercancel', (event) =>
      endEffortDrag(event, false)
    );
    dom.composerEffortRail.addEventListener('keydown', (event) => {
      const index = EFFORT_LEVELS.indexOf(currentEffort());
      let next = index;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = EFFORT_LEVELS.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      next = Math.min(EFFORT_LEVELS.length - 1, Math.max(0, next));
      setComposerEffort(EFFORT_LEVELS[next]);
    });
  }
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
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (!composerCanSend()) return;
      event.preventDefault();
      void sendMessage();
    }
  });

  const repositionSlashPopup = () => {
    if (state.slashOpen) positionSlashPopup();
  };
  dom.input.addEventListener('keyup', repositionSlashPopup);
  dom.input.addEventListener('click', repositionSlashPopup);
  dom.input.addEventListener('select', repositionSlashPopup);
  dom.input.addEventListener('scroll', repositionSlashPopup);
  window.addEventListener('resize', repositionSlashPopup);

  const clearComposerDrag = () => {
    composerDragDepth = 0;
    dom.composerBox?.classList.remove('drag-over');
    dom.composerDrop?.setAttribute('aria-hidden', 'true');
  };

  dom.composer?.addEventListener('dragenter', (event) => {
    if (!state.composerOpen || !hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepth += 1;
    dom.composerBox?.classList.add('drag-over');
    dom.composerDrop?.setAttribute('aria-hidden', 'false');
  });

  dom.composer?.addEventListener('dragover', (event) => {
    if (!state.composerOpen || !hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dom.composerBox?.classList.add('drag-over');
    dom.composerDrop?.setAttribute('aria-hidden', 'false');
  });

  dom.composer?.addEventListener('dragleave', (event) => {
    if (!state.composerOpen || !hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepth = Math.max(0, composerDragDepth - 1);
    if (composerDragDepth === 0) clearComposerDrag();
  });

  dom.composer?.addEventListener('drop', (event) => {
    if (!state.composerOpen || !hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    clearComposerDrag();
    const files = [...(event.dataTransfer?.files || [])];
    void addComposerImages(files);
  });

  dom.composer?.addEventListener('dragend', clearComposerDrag);

  document.addEventListener('dragover', (event) => {
    if (state.composerOpen && hasFileDrag(event)) event.preventDefault();
  });

  document.addEventListener('drop', (event) => {
    if (state.composerOpen && hasFileDrag(event)) {
      event.preventDefault();
      clearComposerDrag();
    }
  });

  document.addEventListener('dragend', clearComposerDrag);
  window.addEventListener('blur', clearComposerDrag);

  document.addEventListener('paste', (event) => {
    if (!state.composerOpen) return;
    if (dom.webContent && !dom.webContent.classList.contains('hidden')) return;
    const data = event.clipboardData;
    if (!data) return;
    const files = [];
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && isSupportedImageFile(file)) files.push(file);
    }
    if (files.length === 0) {
      for (const file of Array.from(data.files || [])) {
        if (isSupportedImageFile(file)) files.push(file);
      }
    }
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void addComposerImages(files);
  });

  dom.agentPickerButton?.addEventListener('click', () => {
    if (state.agentMenuOpen) closeAgentMenu();
    else openAgentMenu();
  });
  dom.modelPickerButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleModelMenu();
  });
  dom.modelMenu?.addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.model-menu-item')
    ) {
      closeModelMenu();
    }
  });
  document.addEventListener(
    'mousedown',
    (event) => {
      if (!dom.modelMenu || dom.modelMenu.classList.contains('hidden')) return;
      if (
        event.target instanceof Element &&
        event.target.closest('#model-picker')
      ) {
        return;
      }
      closeModelMenu();
    },
    true
  );
  window.addEventListener('resize', closeModelMenu);
  const agentPickerKeydown = (event) => {
    if (event.isComposing) return;
    if (agentLocked(currentSession())) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!state.agentMenuOpen) openAgentMenu();
      else moveAgentMenu(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!state.agentMenuOpen) {
        openAgentMenu();
        return;
      }
      const entry = agentMenuEntries()[state.agentMenuIndex];
      if (entry) selectAgent(entry.id);
      return;
    }
    if (event.key === 'Escape' && state.agentMenuOpen) {
      event.preventDefault();
      closeAgentMenu();
    }
  };
  dom.agentPickerButton?.addEventListener('keydown', agentPickerKeydown);
  dom.agentMenu?.addEventListener('keydown', agentPickerKeydown);
  document.addEventListener(
    'mousedown',
    (event) => {
      if (!state.agentMenuOpen) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('#agent-picker, #agent-menu')
      ) {
        return;
      }
      closeAgentMenu();
    },
    true
  );
  window.addEventListener('resize', closeAgentMenu);
  document.addEventListener(
    'scroll',
    (event) => {
      if (!state.agentMenuOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest('#agent-menu')) return;
      closeAgentMenu();
    },
    true
  );

  $('win-min')?.addEventListener('click', () => api.minimize());
  $('win-max')?.addEventListener('click', () => api.maximize());
  $('win-close')?.addEventListener('click', () => api.close());

  dom.apiKey.addEventListener('input', () => {
    state.settings.apiKey = dom.apiKey.value;
    if (dom.apiKey.value.trim()) state.settings.hasApiKey = true;
    dom.apiKeyState.textContent = state.settings.hasApiKey ? 'set' : 'not set';
    saveSettingsSoon();
  });

  dom.gatewayModelAdd?.addEventListener('click', addGatewayModel);
  dom.gatewaySave?.addEventListener('click', () => {
    void saveGatewayConfig();
  });
  dom.gatewayModelId?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addGatewayModel();
    }
  });

  $('reset-settings').addEventListener('click', () => {
    state.settings = {
      apiKey: '',
      hasApiKey: false,
      reasoningEffort: currentEffort(),
      sessionModels: {},
    };
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
    if (handleDialogConfirmSpace(event)) return;
    if (state.chatWindow) {
      const webOpen =
        dom.webContent && !dom.webContent.classList.contains('hidden');
      if (webOpen) {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          closeWebContent();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          return;
        }
        return;
      }
      if (
        event.key === 'Tab' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        if (!event.repeat) setChatCompact(!state.chatCompact);
        return;
      }
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        if (state.composerOpen) closeComposer();
        else api.close();
        return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('button, a, .composer-image')
        ) {
          return;
        }
        if (!state.composerOpen) {
          event.preventDefault();
          if (!event.repeat) openComposer();
          return;
        }
        // With the composer open, let the normal Space handling below run.
      } else if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === '1' || event.key === '2' || event.key === '3')
      ) {
        // Let the Ctrl+1/2/3 view preset handler below run.
      } else if (state.composerOpen) {
        return;
      } else {
        return;
      }
    }
    if (state.agentMenuOpen && event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      closeAgentMenu();
      return;
    }
    if (
      dom.questionDock &&
      !dom.questionDock.classList.contains('hidden')
    ) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        void dismissQuestion();
        return;
      }
      if (
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) &&
        !event.isComposing
      ) {
        event.preventDefault();
        void submitQuestion();
        return;
      }
      const inDock =
        event.target instanceof Element &&
        Boolean(event.target.closest('#question-dock'));
      if (
        !inDock &&
        (event.key === 'Tab' || event.code === 'Space' || event.key === ' ')
      ) {
        event.preventDefault();
      }
      return;
    }
    if (
      dom.approvalOverlay &&
      !dom.approvalOverlay.classList.contains('hidden')
    ) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        resolveToolApproval(false);
      }
      return;
    }
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
    if (dom.projectOverlay && !dom.projectOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeProjectDialog();
      }
      return;
    }
    if (dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeGoalDialog();
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
    if (visibleDialog(document.getElementById('mcp-form-overlay'))) {
      return;
    }
    if (
      dom.backgroundOverlay &&
      !dom.backgroundOverlay.classList.contains('hidden')
    ) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeBackgroundPanel();
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
    if (window.agileOverlayOpen?.()) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        window.handleAgileEscape?.();
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
      if (event.repeat) return;
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

    if (dom.managerComposer && !dom.managerComposer.classList.contains('hidden')) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeManagerComposer();
      }
      return;
    }

    if (window.canvasOverlayOpen?.()) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        window.closeCanvas?.();
        return;
      }
      return;
    }

    if (event.key === 'Tab') {
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
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
          target.closest('button, a, .composer-image')
        ) {
          return;
        }
        const empty =
          !dom.input.value.trim() &&
          state.attachedSkills.length === 0 &&
          state.attachedImages.length === 0;
        if (empty) {
          event.preventDefault();
          closeComposer();
          return;
        }
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
    if (event.key === 'Tab' && window.canvasOverlayOpen?.()) {
      const dialogOpen =
        !dom.settingsOverlay.classList.contains('hidden') ||
        (dom.projectOverlay &&
          !dom.projectOverlay.classList.contains('hidden')) ||
        (dom.renameOverlay &&
          !dom.renameOverlay.classList.contains('hidden')) ||
        (dom.confirmOverlay &&
          !dom.confirmOverlay.classList.contains('hidden'));
      if (dialogOpen) return;
      event.preventDefault();
      cancelActionMenuPress();
      window.canvasTabReleased?.();
      return;
    }
    if (event.key === 'Tab') {
      if (!state.tabHeld) return;
      cancelTabHold();
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      if (state.ringOpen) {
        closeSwitcher();
        return;
      }
      if (state.switcherOpen) commitSwitcherSelection();
    }
  });

  window.addEventListener('blur', () => {
    cancelTabHold();
    if (state.switcherOpen) closeSwitcher();
    if (window.canvasOverlayOpen?.()) window.cancelCanvasPage?.();
  });

  document.addEventListener(
    'wheel',
    (event) => {
      const blocked = () =>
        !dom.rawOverlay.classList.contains('hidden') ||
        !dom.settingsOverlay.classList.contains('hidden') ||
        Boolean(
          dom.approvalOverlay &&
            !dom.approvalOverlay.classList.contains('hidden')
        ) ||
        Boolean(
          dom.projectOverlay &&
            !dom.projectOverlay.classList.contains('hidden')
        ) ||
        Boolean(
          dom.goalOverlay && !dom.goalOverlay.classList.contains('hidden')
        ) ||
        Boolean(
          dom.backgroundOverlay &&
            !dom.backgroundOverlay.classList.contains('hidden')
        ) ||
        Boolean(window.agileOverlayOpen?.()) ||
        Boolean(window.canvasOverlayOpen?.()) ||
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
        if (delta < 0) {
          state.followBottom = false;
          scrollMessagesTo(0, { smooth: true });
        } else {
          state.followBottom = true;
          scrollMessagesTo(dom.messages.scrollHeight, { smooth: true });
        }
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

  dom.messages.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.shiftKey) return;
      const delta = event.deltaY || event.deltaX;
      if (delta === 0) return;
      if (delta < 0) {
        state.followBottom = false;
        state.autoScrolling = false;
        clearTimeout(state.autoScrollTimer);
        dom.messages.scrollTo({
          top: dom.messages.scrollTop,
          behavior: 'auto',
        });
        return;
      }
      if (isAtBottom()) state.followBottom = true;
    },
    { passive: true }
  );

  dom.messages.addEventListener(
    'scroll',
    () => {
      if (state.autoScrolling) return;
      state.followBottom = isAtBottom();
    },
    { passive: true }
  );

  dom.messages.addEventListener('scrollend', () => {
    state.autoScrolling = false;
  });

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
      if (last.placeholder) delete last.placeholder;
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
    textNode.classList.remove('card-waiting');
    api.updateContent({ key, text: last.text });
    card.classList.add('streaming');
    updateCardClip(card);
    stickStreamingText(card);
    syncLiveReplyViewer(msg, messageIndex);

    const stick = state.followBottom;
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
        scrollMessagesTo(dom.messages.scrollHeight);
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
    const waiting = ensureWaitingThinking(msg, index);
    saveChatsSoon();
    if (!waiting) return;
    const session = currentSession();
    if (!session || !session.msgs.includes(msg)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
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

  api.onViewerAsk(handleViewerAsk);
  api.onChatCompose(() => {
    if (state.chatWindow) openComposer();
  });

  api.onChatToolResult(({ requestId, name, output, ok, round, startedAt, durationMs }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    const stepRound = Number.isInteger(round) ? round : 0;
    dropWaitingThinking(state.streamMessage, stepRound + 1);
    state.streamMessage.steps.push({
      kind: 'result',
      name: String(name || 'tool'),
      output: String(output ?? ''),
      ok: ok !== false,
      round: stepRound,
      metrics: {
        startedAt: Number.isFinite(Number(startedAt))
          ? Number(startedAt)
          : undefined,
        durationMs: Number.isFinite(Number(durationMs))
          ? Number(durationMs)
          : undefined,
      },
    });
    if (name === 'code_view' || name === 'pdf_view' || name === 'html_view') {
      try {
        const view = JSON.parse(String(output ?? ''));
        if (view?.ok) {
          Promise.resolve(api.openContentViewer?.(view)).catch((error) =>
            console.error('open viewer failed', error)
          );
        }
      } catch {
        /* not a viewer payload */
      }
    }
    // The next model request starts right after a tool result. Show its
    // waiting thinking block immediately instead of leaving the tool card
    // as the last visible line until the first token arrives.
    ensureWaitingThinking(state.streamMessage, stepRound + 1);
    saveChatsSoon();

    const session = currentSession();
    if (!session || !session.msgs.includes(state.streamMessage)) return;
    state.openCardKey = autoCardKey();
    renderMessages();
  });

  api.onRunStarted(({ requestId }) => {
    if (!requestId || requestId === state.requestId) return;
    if (state.streaming) return;
    // Replayed events arrive right after run.started; accept their
    // approvals before the async adoption below finishes.
    state.requestId = requestId;
    void adoptExternalRun(requestId);
  });

  api.onGoalCheck(({ messageSeq, step, goal }) => {
    const session = currentSession();
    if (!session || !step) return;
    const message =
      Number.isInteger(messageSeq) && session.msgs[messageSeq]?.role === 'Agent'
        ? session.msgs[messageSeq]
        : ensureLastAgentMessage(session);
    appendStepOnce(message, step);
    if (goal) session.goal = goal;
    state.openCardKey = autoCardKey();
    renderAll();
  });

  api.onGoalUpdated(({ goal }) => {
    const session = currentSession();
    if (!session) return;
    session.goal = goal || null;
    if (state.composerOpen) renderComposerContext();
  });

  api.onCompaction(({ messageSeq, step, compaction, auto }) => {
    if (auto === false) return;
    const session = currentSession();
    if (!session || !step) return;
    const message =
      Number.isInteger(messageSeq) && session.msgs[messageSeq]?.role === 'Agent'
        ? session.msgs[messageSeq]
        : ensureLastAgentMessage(session);
    appendStepOnce(message, step);
    if (compaction) session.compaction = compaction;
    state.openCardKey = autoCardKey();
    renderAll();
  });

  api.onToolApproval(({ requestId, id, tool, path, allowedDirs }) => {
    if (requestId !== state.requestId) return;
    enqueueToolApproval({ id, tool, path, allowedDirs });
  });

  api.onToolQuestion(({ requestId, id, questions, mode, timeoutSeconds }) => {
    if (requestId !== state.requestId) return;
    enqueueQuestion({ id, questions, mode, timeoutSeconds });
  });

  api.onBackgroundUpdate((payload) => handleBackgroundUpdate(payload));
  api.onBackgroundComplete((payload) => handleBackgroundComplete(payload));
  api.onSubagentStarted((payload) => handleSubagentStarted(payload));
  api.onSubagentComplete((payload) => handleSubagentComplete(payload));

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
    state.projects = [];
    state.sessions = [];
    state.current = 0;
    state.seq = 0;
  }

  // 兜底：旧文件缺 system 字段时补默认值
  state.sessions.forEach((session) => {
    if (typeof session.system !== 'string') {
      session.system = DEFAULT_SYSTEM_PROMPT;
    }
    if (!session.agentId) session.agentId = DEFAULT_AGENT_ID;
  });
  ensureProjects();
  const params = new URLSearchParams(location.search);
  const panelKind = String(params.get('panel') || '').trim();
  const archiveSessionId = String(params.get('archive') || '').trim();
  const systemNodeId = String(params.get('systemNode') || '').trim();
  if (archiveSessionId) {
    state.archiveWindow = true;
    document.body.classList.add('archive-window');
    document.title = 'YAH - Archived';
  } else if (panelKind) {
    state.panelWindow = true;
    document.body.classList.add('panel-window');
    const panelLabels = {
      agents: 'Agent',
      tools: 'tool',
      skills: 'Skill',
      mcp: 'MCP',
    };
    document.title = `YAH - ${panelLabels[panelKind] || 'Config'}`;
  } else if (params.get('chat') === '1') {
    state.chatWindow = true;
    document.body.classList.add('chat-window');
    const sessionId = params.get('sessionId') || '';
    const index = state.sessions.findIndex(
      (session) => session.id === sessionId
    );
    if (index >= 0) state.current = index;
    setupChatWindow();
  } else if (api.isElectron && !systemNodeId) {
    state.homeWindow = true;
    document.body.classList.add('home-window');
  }
  if (state.chatWindow) applyFoldState(currentSession());

  bindEvents();
  if (!state.archiveWindow) connectBackgroundEvents();
  applySettings();
  void loadLlmConfig();
  await loadAgents();
  if (systemNodeId) {
    state.systemNodeWindow = true;
    document.body.classList.add('system-node-window');
    document.title = 'YAH - Node';
    setTimeout(() => window.openSystemNodePage?.(systemNodeId), 0);
    return;
  }
  if (state.archiveWindow) {
    setTimeout(() => window.openArchivePage?.(archiveSessionId), 0);
    return;
  }
  if (state.panelWindow) {
    setTimeout(() => {
      if (panelKind === 'mcp') window.openMcp?.();
      else openCatalog(panelKind);
    }, 0);
    return;
  }
  renderAll();
  if (state.chatWindow && params.get('compose') === '1') {
    openComposer();
  }
  if (state.chatWindow) {
    const bootSession = currentSession();
    if (bootSession) {
      void resumeBackgroundQueue(bootSession);
    }
    persistFoldState();
  }
  updateSendState();
  void loadUsage();
  void loadMcpServers();
  if (state.homeWindow) {
    setTimeout(() => window.openCanvas?.(), 0);
  }
  if (params.get('canvas') === '1') {
    setTimeout(() => window.openCanvas?.(), 0);
  }
}

boot();
