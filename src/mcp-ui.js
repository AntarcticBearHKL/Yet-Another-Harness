'use strict';

// MCP workspace: server list, tools / resources / prompts / logs / overview,
// manual calls and "insert into conversation". Loaded after renderer.js so it
// can reuse el(), jsonView(), openComposer(), state and the API helpers.

const mcpDom = {
  overlay: document.getElementById('mcp-overlay'),
  close: document.getElementById('mcp-close'),
  serverList: document.getElementById('mcp-server-list'),
  add: document.getElementById('mcp-add'),
  empty: document.getElementById('mcp-empty'),
  detail: document.getElementById('mcp-detail'),
  title: document.getElementById('mcp-title'),
  status: document.getElementById('mcp-status'),
  transport: document.getElementById('mcp-transport'),
  error: document.getElementById('mcp-error'),
  tabs: document.getElementById('mcp-tabs'),
  tabBody: document.getElementById('mcp-tab-body'),
  refresh: document.getElementById('mcp-refresh'),
  reconnect: document.getElementById('mcp-reconnect'),
  edit: document.getElementById('mcp-edit'),
  remove: document.getElementById('mcp-delete'),
  toast: document.getElementById('mcp-toast'),
  formOverlay: document.getElementById('mcp-form-overlay'),
  formTitle: document.getElementById('mcp-form-title'),
  formSubtitle: document.getElementById('mcp-form-subtitle'),
  formClose: document.getElementById('mcp-form-close'),
  formCancel: document.getElementById('mcp-form-cancel'),
  formSave: document.getElementById('mcp-form-save'),
  formError: document.getElementById('mcp-form-error'),
  formModeForm: document.getElementById('mcp-form-mode-form'),
  formModeJson: document.getElementById('mcp-form-mode-json'),
  formFields: document.getElementById('mcp-form-fields'),
  formJsonWrap: document.getElementById('mcp-form-json-wrap'),
  formJson: document.getElementById('mcp-form-json'),
  formName: document.getElementById('mcp-form-name'),
  formTransport: document.getElementById('mcp-form-transport'),
  formStdio: document.getElementById('mcp-form-stdio'),
  formRemote: document.getElementById('mcp-form-remote'),
  formCommand: document.getElementById('mcp-form-command'),
  formArgs: document.getElementById('mcp-form-args'),
  formCwd: document.getElementById('mcp-form-cwd'),
  formEnv: document.getElementById('mcp-form-env'),
  formUrl: document.getElementById('mcp-form-url'),
  formHeaders: document.getElementById('mcp-form-headers'),
};

const mcpState = {
  open: false,
  servers: [],
  selectedId: null,
  detail: null,
  tab: 'tools',
  loadingState: false,
  loadingDetail: false,
  events: null,
  refreshTimer: null,
  toastTimer: null,
  deleteTimer: null,
  deleteArmed: false,
  formOpen: false,
  formMode: 'form',
  formEditId: null,
  formTransport: 'stdio',
  formSaving: false,
  toolName: null,
  toolMode: 'form',
  toolValues: {},
  toolJson: '{}',
  toolResult: null,
  toolError: '',
  toolRunning: false,
  toolConfirm: false,
  resourceUri: null,
  resourceTemplate: null,
  resourceTemplateUri: '',
  resourceResult: null,
  resourceError: '',
  resourceLoading: false,
  promptName: null,
  promptArgs: {},
  promptResult: null,
  promptError: '',
  promptLoading: false,
  logs: [],
  logFilter: 'all',
  logSearch: '',
  searchTools: '',
  searchResources: '',
  searchPrompts: '',
};

const MCP_SELECTED_KEY = 'yah:mcp:selected';
const MCP_STATUS_LABEL = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接失败',
  disabled: '已禁用',
};

/* ------------------------------------------------------------------ utils */

function mcpEl(tag, className, text) {
  return el(tag, className, text);
}

function mcpButton(label, className, onClick) {
  const button = mcpEl('button', className, label);
  button.type = 'button';
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function mcpStatusLabel(status) {
  return MCP_STATUS_LABEL[status] || status || '未知';
}

function mcpStatusDot(status) {
  const dot = mcpEl('span', `mcp-dot ${status || 'idle'}`);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function mcpTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false });
  } catch {
    return '';
  }
}

function mcpRelative(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

async function mcpCopy(text) {
  const value = String(text ?? '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    mcpToast('已复制');
  } catch {
    mcpToast('复制失败');
  }
}

function mcpToast(message, tone = 'info') {
  if (!mcpDom.toast) return;
  mcpDom.toast.textContent = message;
  mcpDom.toast.className = `mcp-toast ${tone}`;
  mcpDom.toast.classList.remove('hidden');
  clearTimeout(mcpState.toastTimer);
  mcpState.toastTimer = setTimeout(() => {
    mcpDom.toast.classList.add('hidden');
  }, 2600);
}

function mcpShowError(message, notice = false) {
  if (!mcpDom.error) return;
  mcpDom.error.textContent = message;
  mcpDom.error.classList.toggle('hidden', !message);
  mcpDom.error.classList.toggle('notice', Boolean(message && notice));
}

function mcpJsonView(value) {
  return jsonView(value);
}

function mcpDetails(summary, content, open = false) {
  const details = mcpEl('details', 'mcp-details');
  details.open = open;
  const head = mcpEl('summary', 'mcp-details-head', summary);
  details.append(head, content);
  return details;
}

function mcpParseKeyValueLines(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function mcpFormatKeyValues(map) {
  return Object.entries(map || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function mcpCountLabel(count, singular) {
  return `${count} ${singular}`;
}

/* ---------------------------------------------------------------- open/close */

function mcpOverlayOpen() {
  return mcpState.open;
}

function openMcp() {
  if (typeof closeRingMenu === 'function') closeRingMenu();
  if (typeof closeCatalog === 'function') closeCatalog();
  if (typeof closeComposer === 'function') closeComposer();
  if (typeof closeSettings === 'function') closeSettings();
  mcpState.open = true;
  mcpDom.overlay.classList.remove('hidden');
  mcpDom.overlay.setAttribute('aria-hidden', 'false');
  mcpConnectEvents();
  void mcpRefreshState();
}

function closeMcp() {
  if (!mcpState.open) return;
  if (mcpState.formOpen) {
    mcpCloseForm();
    return;
  }
  mcpState.open = false;
  mcpState.deleteArmed = false;
  clearTimeout(mcpState.deleteTimer);
  mcpDisconnectEvents();
  mcpDom.overlay.classList.add('hidden');
  mcpDom.overlay.setAttribute('aria-hidden', 'true');
  window.loadMcpServers?.(true);
}

/* ------------------------------------------------------------------- events */

function mcpConnectEvents() {
  if (mcpState.events) return;
  const source = new EventSource('/api/mcp/events');
  mcpState.events = source;
  source.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    mcpHandleEvent(data);
  };
  source.onerror = () => {
    /* EventSource reconnects automatically */
  };
}

function mcpDisconnectEvents() {
  if (!mcpState.events) return;
  mcpState.events.close();
  mcpState.events = null;
}

function mcpScheduleStateRefresh() {
  clearTimeout(mcpState.refreshTimer);
  mcpState.refreshTimer = setTimeout(() => {
    mcpState.refreshTimer = null;
    void mcpRefreshState({ silent: true });
  }, 220);
}

function mcpHandleEvent(event) {
  if (!event || !event.type) return;
  if (event.type === 'state' && event.state) {
    mcpState.servers = event.state.servers || [];
    mcpRenderServerList();
    mcpRenderHeader();
    return;
  }
  if (event.type === 'status') {
    const server = mcpState.servers.find((item) => item.id === event.serverId);
    if (server) {
      server.status = event.status;
      server.error = event.error || undefined;
    }
    mcpRenderServerList();
    mcpRenderHeader();
    if (event.serverId === mcpState.selectedId && event.status === 'connected') {
      void mcpLoadDetail(mcpState.selectedId);
    }
    return;
  }
  if (event.type === 'capabilities') {
    if (event.serverId === mcpState.selectedId) {
      mcpScheduleStateRefresh();
    }
    return;
  }
  if (event.type === 'log') {
    if (event.serverId !== mcpState.selectedId) return;
    mcpState.logs.push(event.entry);
    if (mcpState.logs.length > 800) {
      mcpState.logs.splice(0, mcpState.logs.length - 800);
    }
    if (mcpState.tab === 'logs') {
      mcpRenderLogList();
      mcpRenderTabs();
    }
    return;
  }
  if (event.type === 'logs.cleared') {
    if (event.serverId !== mcpState.selectedId) return;
    mcpState.logs = [];
    if (mcpState.tab === 'logs') mcpRenderLogsTab();
    return;
  }
  if (event.type === 'notification') {
    if (event.serverId === mcpState.selectedId) {
      mcpScheduleStateRefresh();
    }
  }
}

/* ------------------------------------------------------------------- state */

async function mcpRefreshState(options = {}) {
  if (mcpState.loadingState) return;
  mcpState.loadingState = true;
  try {
    const data = await requestJson('/api/mcp/state');
    mcpState.servers = data.servers || [];
    const saved = localStorage.getItem(MCP_SELECTED_KEY);
    const exists = (id) => mcpState.servers.some((server) => server.id === id);
    if (!mcpState.selectedId || !exists(mcpState.selectedId)) {
      mcpState.selectedId = exists(saved)
        ? saved
        : mcpState.servers[0]?.id || null;
    }
    mcpRenderServerList();
    mcpRenderHeader();
    if (mcpState.selectedId) {
      await mcpLoadDetail(mcpState.selectedId);
    } else {
      mcpState.detail = null;
      mcpDom.detail.classList.add('hidden');
      mcpDom.empty.classList.remove('hidden');
    }
  } catch (error) {
    if (!options.silent) mcpToast(error.message, 'error');
  } finally {
    mcpState.loadingState = false;
  }
}

async function mcpLoadDetail(id, options = {}) {
  if (!id) return;
  mcpState.loadingDetail = true;
  try {
    const detail = await requestJson(
      `/api/mcp/servers/${encodeURIComponent(id)}`
    );
    if (mcpState.selectedId !== id) return;
    mcpState.detail = detail;
    mcpState.logs = Array.isArray(detail.logs) ? detail.logs.slice(-800) : [];
    if (mcpState.tab === 'tools') {
      const tools = detail.tools || [];
      if (!tools.some((tool) => tool.name === mcpState.toolName)) {
        mcpState.toolName = tools[0]?.name || null;
        mcpResetToolState();
      }
    }
    if (mcpState.tab === 'resources') {
      const resources = detail.resources || [];
      if (
        mcpState.resourceUri &&
        !resources.some((resource) => resource.uri === mcpState.resourceUri)
      ) {
        mcpState.resourceUri = null;
      }
    }
    if (mcpState.tab === 'prompts') {
      const prompts = detail.prompts || [];
      if (!prompts.some((prompt) => prompt.name === mcpState.promptName)) {
        mcpState.promptName = prompts[0]?.name || null;
        mcpState.promptArgs = {};
        mcpState.promptResult = null;
        mcpState.promptError = '';
      }
    }
    mcpRenderServerList();
    mcpRenderHeader();
    mcpRenderDetail();
  } catch (error) {
    if (!options.silent) mcpToast(error.message, 'error');
  } finally {
    mcpState.loadingDetail = false;
  }
}

function mcpSelectServer(id) {
  if (!id || id === mcpState.selectedId) return;
  mcpState.selectedId = id;
  localStorage.setItem(MCP_SELECTED_KEY, id);
  mcpState.detail = null;
  mcpState.toolName = null;
  mcpState.toolResult = null;
  mcpState.toolError = '';
  mcpState.resourceUri = null;
  mcpState.resourceTemplate = null;
  mcpState.resourceResult = null;
  mcpState.resourceError = '';
  mcpState.promptName = null;
  mcpState.promptArgs = {};
  mcpState.promptResult = null;
  mcpState.promptError = '';
  mcpState.logs = [];
  mcpState.deleteArmed = false;
  clearTimeout(mcpState.deleteTimer);
  mcpRenderServerList();
  mcpRenderHeader();
  mcpDom.detail.classList.add('hidden');
  mcpDom.empty.classList.add('hidden');
  void mcpLoadDetail(id);
}

function mcpSelectedServer() {
  return (
    mcpState.servers.find((server) => server.id === mcpState.selectedId) ||
    null
  );
}

/* ---------------------------------------------------------------- rendering */

function mcpRenderServerList() {
  if (!mcpDom.serverList) return;
  mcpDom.serverList.replaceChildren();
  const servers = [...mcpState.servers].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
  if (servers.length === 0) return;
  for (const server of servers) {
    const row = mcpEl('button', 'mcp-server-row');
    row.type = 'button';
    row.classList.toggle('selected', server.id === mcpState.selectedId);
    row.classList.toggle('has-error', server.status === 'error');
    const dot = mcpStatusDot(server.status);
    const body = mcpEl('span', 'mcp-server-body');
    body.append(mcpEl('span', 'mcp-server-name', server.name));
    const meta = [
      server.transport.toUpperCase(),
      server.source === 'opencode' ? 'OpenCode' : '',
      server.enabled === false ? '已禁用' : '',
      server.status === 'error' ? '连接失败' : '',
      server.status === 'connecting' ? '连接中' : '',
      server.status === 'connected' ? `${server.toolCount} 工具` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    body.append(mcpEl('span', 'mcp-server-meta', meta));
    row.append(dot, body);
    row.addEventListener('click', () => mcpSelectServer(server.id));
    mcpDom.serverList.append(row);
  }
}

function mcpRenderHeader() {
  const server = mcpSelectedServer();
  if (!server) {
    mcpDom.detail.classList.add('hidden');
    mcpDom.empty.classList.remove('hidden');
    mcpDom.empty.textContent =
      mcpState.servers.length === 0
        ? '还没有 MCP 服务器。点击左下角添加。'
        : '选择一个 MCP 服务器。';
    return;
  }
  mcpDom.empty.classList.add('hidden');
  mcpDom.detail.classList.remove('hidden');
  mcpDom.title.textContent = server.name;
  mcpDom.status.textContent = mcpStatusLabel(server.status);
  mcpDom.status.className = `mcp-status ${server.status || 'idle'}`;
  mcpDom.transport.textContent = `${server.transport.toUpperCase()}${
    server.source === 'opencode' ? ' · OPENCODE' : ''
  }`;
  const inherited = server.source === 'opencode';
  const disabled = server.enabled === false;
  if (disabled) {
    mcpShowError(
      '这个服务器在 OpenCode 配置中已禁用。启用后 YAH 会自动连接。',
      true
    );
  } else {
    mcpShowError(server.error || '');
  }
  mcpDom.refresh.disabled = server.status !== 'connected' || disabled;
  mcpDom.reconnect.disabled = server.status === 'connecting' || disabled;
  mcpDom.edit.classList.toggle('hidden', inherited);
  mcpDom.edit.disabled = inherited;
  mcpDom.remove.classList.toggle('hidden', inherited);
  mcpDom.remove.disabled = inherited;
  mcpDom.remove.textContent = mcpState.deleteArmed ? '确认删除' : '删除';
  mcpDom.remove.classList.toggle('danger-solid', mcpState.deleteArmed);
  mcpRenderTabs();
}

function mcpRenderTabs() {
  if (!mcpDom.tabs) return;
  const counts = {
    tools: mcpState.detail?.tools?.length || 0,
    resources:
      (mcpState.detail?.resources?.length || 0) +
      (mcpState.detail?.resourceTemplates?.length || 0),
    prompts: mcpState.detail?.prompts?.length || 0,
    logs: mcpState.logs.length,
    overview: 0,
  };
  for (const button of mcpDom.tabs.querySelectorAll('button[data-tab]')) {
    const tab = button.dataset.tab;
    button.classList.toggle('active', tab === mcpState.tab);
    const count = button.querySelector('.mcp-tab-count');
    if (count) {
      count.textContent = counts[tab] ? String(counts[tab]) : '';
    }
  }
}

function mcpRenderDetail() {
  if (!mcpState.detail) return;
  const previous = mcpDom.tabBody.querySelector('.mcp-detail-pane');
  const scrollTop = previous ? previous.scrollTop : 0;
  mcpDom.tabBody.replaceChildren();
  if (mcpState.tab === 'tools') mcpRenderToolsTab();
  else if (mcpState.tab === 'resources') mcpRenderResourcesTab();
  else if (mcpState.tab === 'prompts') mcpRenderPromptsTab();
  else if (mcpState.tab === 'logs') mcpRenderLogsTab();
  else mcpRenderOverviewTab();
  mcpRenderTabs();
  const next = mcpDom.tabBody.querySelector('.mcp-detail-pane');
  if (next && scrollTop) next.scrollTop = scrollTop;
}

/* ------------------------------------------------------------------- tools */

function mcpResetToolState() {
  const tool = mcpSelectedTool();
  mcpState.toolMode = 'form';
  mcpState.toolValues = mcpInitialValues(tool?.inputSchema);
  mcpState.toolJson = '{}';
  mcpState.toolResult = null;
  mcpState.toolError = '';
  mcpState.toolRunning = false;
  mcpState.toolConfirm = false;
}

function mcpSelectedTool() {
  return (
    (mcpState.detail?.tools || []).find(
      (tool) => tool.name === mcpState.toolName
    ) || null
  );
}

function mcpFilteredTools() {
  const tools = mcpState.detail?.tools || [];
  const needle = mcpState.searchTools.trim().toLowerCase();
  if (!needle) return tools;
  return tools.filter((tool) =>
    [tool.name, tool.title, tool.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  );
}

function mcpRenderToolsTab() {
  const tools = mcpState.detail?.tools || [];
  if (
    !mcpState.toolName ||
    !tools.some((tool) => tool.name === mcpState.toolName)
  ) {
    mcpState.toolName = tools[0]?.name || null;
    mcpResetToolState();
  }
  const wrap = mcpEl('div', 'mcp-split');
  const listPane = mcpEl('aside', 'mcp-list-pane');
  const searchWrap = mcpEl('div', 'mcp-search');
  const search = mcpEl('input', 'mcp-search-input');
  search.type = 'search';
  search.placeholder = '搜索工具…';
  search.value = mcpState.searchTools;
  search.spellcheck = false;
  search.addEventListener('input', () => {
    mcpState.searchTools = search.value;
    mcpRenderToolList();
  });
  searchWrap.append(search);
  listPane.append(searchWrap);
  const list = mcpEl('div', 'mcp-list');
  list.id = 'mcp-tool-list';
  listPane.append(list);
  wrap.append(listPane);

  const detailPane = mcpEl('section', 'mcp-detail-pane');
  detailPane.id = 'mcp-tool-detail';
  wrap.append(detailPane);
  mcpDom.tabBody.append(wrap);

  mcpRenderToolList();
  mcpRenderToolDetail();
}

function mcpRenderToolList() {
  const list = document.getElementById('mcp-tool-list');
  if (!list) return;
  list.replaceChildren();
  const tools = mcpFilteredTools();
  if (tools.length === 0) {
    list.append(
      mcpEl(
        'div',
        'mcp-list-empty',
        (mcpState.detail?.tools || []).length
          ? '没有匹配的工具'
          : '这个服务器没有暴露工具'
      )
    );
    return;
  }
  for (const tool of tools) {
    const row = mcpEl('button', 'mcp-list-item');
    row.type = 'button';
    row.classList.toggle('selected', tool.name === mcpState.toolName);
    row.append(mcpEl('span', 'mcp-list-name', tool.title || tool.name));
    if (tool.title) row.append(mcpEl('code', 'mcp-list-code', tool.name));
    if (tool.description) {
      row.append(mcpEl('span', 'mcp-list-desc', tool.description));
    }
    row.addEventListener('click', () => {
      if (mcpState.toolName === tool.name) return;
      mcpState.toolName = tool.name;
      mcpResetToolState();
      mcpRenderToolList();
      mcpRenderToolDetail();
    });
    list.append(row);
  }
}

function mcpRenderToolDetail() {
  const pane = document.getElementById('mcp-tool-detail');
  if (!pane) return;
  pane.replaceChildren();
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.status !== 'connected') {
    pane.append(
      mcpConnectGate(
        server.enabled === false
          ? '这个服务器在 OpenCode 配置中已禁用。'
          : '连接后可以查看并调用工具',
        server.enabled === false ? null : '重连'
      )
    );
    return;
  }
  const tool = mcpSelectedTool();
  if (!tool) {
    pane.append(mcpEl('div', 'mcp-pane-empty', '选择左侧的工具'));
    return;
  }

  const head = mcpEl('div', 'mcp-pane-head');
  const titleWrap = mcpEl('div', 'mcp-pane-title');
  titleWrap.append(mcpEl('h3', '', tool.title || tool.name));
  if (tool.title) titleWrap.append(mcpEl('code', 'mcp-code-label', tool.name));
  if (tool.description) {
    titleWrap.append(mcpEl('p', 'mcp-pane-desc', tool.description));
  }
  const badges = mcpEl('div', 'mcp-badges');
  if (tool.annotations?.readOnlyHint) {
    badges.append(mcpEl('span', 'mcp-badge success', '只读'));
  }
  if (tool.annotations?.destructiveHint) {
    badges.append(mcpEl('span', 'mcp-badge danger', '破坏性'));
  }
  if (badges.childNodes.length) titleWrap.append(badges);
  head.append(titleWrap);

  const actions = mcpEl('div', 'mcp-pane-actions');
  actions.append(
    mcpButton('插入到对话', 'pill compact', () => mcpInsertTool(tool))
  );
  actions.append(
    mcpButton('复制调用名', 'pill compact', () =>
      mcpCopy(tool.exposedName || mcpExposedName(server, tool))
    )
  );
  head.append(actions);
  pane.append(head);

  pane.append(
    mcpDetails(
      'Schema',
      mcpJsonView(tool.inputSchema || { type: 'object', properties: {} })
    )
  );

  const card = mcpEl('div', 'mcp-panel');
  const cardHead = mcpEl('div', 'mcp-panel-head');
  cardHead.append(mcpEl('span', 'mcp-section-kicker', '参数'));
  const modes = mcpEl('div', 'segmented');
  const formButton = mcpButton('表单', 'pill compact', () =>
    mcpSwitchToolMode('form')
  );
  const jsonButton = mcpButton('JSON', 'pill compact', () =>
    mcpSwitchToolMode('json')
  );
  formButton.setAttribute(
    'aria-pressed',
    mcpState.toolMode === 'form' ? 'true' : 'false'
  );
  jsonButton.setAttribute(
    'aria-pressed',
    mcpState.toolMode === 'json' ? 'true' : 'false'
  );
  modes.append(formButton, jsonButton);
  cardHead.append(modes);
  card.append(cardHead);

  if (mcpState.toolMode === 'json') {
    card.append(mcpJsonEditor());
  } else {
    card.append(mcpSchemaForm(tool.inputSchema));
  }

  if (mcpState.toolError) {
    card.append(mcpEl('div', 'mcp-inline-error', mcpState.toolError));
  }

  if (tool.annotations?.destructiveHint) {
    card.append(
      mcpEl(
        'div',
        'mcp-warning',
        mcpState.toolConfirm
          ? '这个工具被标记为破坏性操作，再点一次「确认运行」才会执行。'
          : '这个工具被标记为破坏性操作。'
      )
    );
  }

  const runBar = mcpEl('div', 'mcp-run-bar');
  const runButton = mcpButton(
    mcpState.toolRunning
      ? '运行中…'
      : mcpState.toolConfirm
        ? '确认运行'
        : '运行工具',
    'pill primary mcp-run',
    () => void mcpRunTool()
  );
  runButton.disabled = mcpState.toolRunning;
  runBar.append(runButton);
  card.append(runBar);
  pane.append(card);

  if (mcpState.toolResult) {
    pane.append(
      mcpResultCard({
        response: mcpState.toolResult,
        method: 'tools/call',
        label: tool.name,
        onInsert: () => mcpInsertToolResult(tool, mcpState.toolResult),
      })
    );
  }
}

function mcpConnectGate(message, actionLabel) {
  const gate = mcpEl('div', 'mcp-gate');
  gate.append(mcpEl('h3', '', '服务器未连接'));
  gate.append(mcpEl('p', '', message));
  if (actionLabel) {
    gate.append(
      mcpButton(actionLabel, 'pill primary', () => void mcpReconnect())
    );
  }
  return gate;
}

function mcpSwitchToolMode(mode) {
  if (mcpState.toolMode === mode) return;
  const tool = mcpSelectedTool();
  if (!tool) return;
  if (mode === 'json') {
    mcpState.toolJson = JSON.stringify(
      mcpLooseArguments(tool.inputSchema, mcpState.toolValues),
      null,
      2
    );
    mcpState.toolError = '';
    mcpState.toolMode = 'json';
    mcpRenderToolDetail();
    return;
  }
  try {
    const parsed = JSON.parse(mcpState.toolJson || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('参数必须是 JSON 对象');
    }
    mcpState.toolValues = mcpJsonToValues(tool.inputSchema, parsed);
    mcpState.toolError = '';
    mcpState.toolMode = 'form';
    mcpRenderToolDetail();
  } catch (error) {
    mcpState.toolError = error.message;
    mcpRenderToolDetail();
  }
}

function mcpJsonEditor() {
  const wrap = mcpEl('div', 'mcp-json-editor');
  const textarea = mcpEl('textarea', 'mcp-textarea');
  textarea.rows = Math.min(18, Math.max(8, mcpState.toolJson.split('\n').length + 1));
  textarea.spellcheck = false;
  textarea.value = mcpState.toolJson;
  textarea.addEventListener('input', () => {
    mcpState.toolJson = textarea.value;
    const hint = wrap.querySelector('.mcp-json-hint');
    if (hint) {
      const valid = mcpIsJsonObject(textarea.value);
      hint.textContent = valid ? '合法 JSON' : 'JSON 无效';
      hint.classList.toggle('bad', !valid);
    }
  });
  wrap.append(textarea);
  const foot = mcpEl('div', 'mcp-json-foot');
  const hint = mcpEl(
    'span',
    `mcp-json-hint ${mcpIsJsonObject(mcpState.toolJson) ? '' : 'bad'}`,
    mcpIsJsonObject(mcpState.toolJson) ? '合法 JSON' : 'JSON 无效'
  );
  foot.append(hint);
  foot.append(
    mcpButton('格式化', 'mcp-text-button', () => {
      try {
        const parsed = JSON.parse(mcpState.toolJson || '{}');
        mcpState.toolJson = JSON.stringify(parsed, null, 2);
        mcpState.toolError = '';
      } catch (error) {
        mcpState.toolError = error.message;
      }
      mcpRenderToolDetail();
    })
  );
  wrap.append(foot);
  return wrap;
}

function mcpIsJsonObject(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ JSON schemas */

function mcpEffectiveSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  const nonNull = variants.filter((item) => item && item.type !== 'null');
  if (variants.length && nonNull.length === 1) {
    const variant = nonNull[0];
    const type = String(variant.type || '');
    if (
      ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(
        type
      ) ||
      variant.properties ||
      variant.items ||
      variant.enum
    ) {
      return {
        ...schema,
        ...variant,
        title: schema.title ?? variant.title,
        description: schema.description ?? variant.description,
        default: schema.default !== undefined ? schema.default : variant.default,
      };
    }
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    if (types.length === 1) return { ...schema, type: types[0] };
  }
  return schema;
}

function mcpSchemaProperties(schema) {
  if (!schema || !schema.properties) return [];
  return Object.entries(schema.properties).filter(
    ([, value]) => value && typeof value === 'object'
  );
}

function mcpIsComplexSchema(schema) {
  const effective = mcpEffectiveSchema(schema);
  return (
    effective.type === 'object' ||
    effective.type === 'array' ||
    Boolean(effective.properties) ||
    Boolean(effective.items) ||
    Array.isArray(schema?.anyOf) ||
    Array.isArray(schema?.oneOf) ||
    Array.isArray(schema?.allOf) ||
    Array.isArray(schema?.type)
  );
}

function mcpInitialValues(schema, existing) {
  const values = {};
  for (const [name, property] of mcpSchemaProperties(schema)) {
    const effective = mcpEffectiveSchema(property);
    const source =
      existing && Object.prototype.hasOwnProperty.call(existing, name)
        ? existing[name]
        : undefined;
    if (source !== undefined && source !== null) {
      if (typeof source === 'boolean') values[name] = source;
      else if (typeof source === 'object') values[name] = JSON.stringify(source, null, 2);
      else values[name] = String(source);
      continue;
    }
    if (effective.default !== undefined && effective.default !== null) {
      if (typeof effective.default === 'boolean') values[name] = effective.default;
      else if (typeof effective.default === 'object') {
        values[name] = JSON.stringify(effective.default, null, 2);
      } else {
        values[name] = String(effective.default);
      }
    } else if (effective.type === 'boolean') {
      values[name] = false;
    } else {
      values[name] = '';
    }
  }
  return values;
}

function mcpJsonToValues(schema, parsed) {
  return mcpInitialValues(schema, parsed);
}

function mcpBuildArguments(schema, values) {
  const args = {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [name, property] of mcpSchemaProperties(schema)) {
    const effective = mcpEffectiveSchema(property);
    const raw = values[name];
    if (raw === undefined) {
      if (required.has(name)) throw new Error(`"${name}" 是必填参数`);
      continue;
    }
    if (effective.type === 'boolean') {
      if (raw === true) args[name] = true;
      else if (required.has(name) || effective.default === false) args[name] = false;
      continue;
    }
    if (typeof raw === 'string' ? raw.trim() === '' : raw == null) {
      if (required.has(name)) throw new Error(`"${name}" 是必填参数`);
      continue;
    }
    if (Array.isArray(effective.enum)) {
      const text = String(raw);
      const match = effective.enum.find((item) => String(item) === text);
      if (match === undefined) throw new Error(`"${name}" 不在允许的取值内`);
      args[name] = match;
      continue;
    }
    const text = String(raw);
    if (effective.type === 'integer' || effective.type === 'number') {
      const number = Number(text);
      if (!Number.isFinite(number)) throw new Error(`"${name}" 必须是数字`);
      if (effective.type === 'integer' && !Number.isInteger(number)) {
        throw new Error(`"${name}" 必须是整数`);
      }
      args[name] = number;
      continue;
    }
    if (mcpIsComplexSchema(property)) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`"${name}" 不是合法 JSON：${error.message}`);
      }
      args[name] = parsed;
      continue;
    }
    args[name] = text;
  }
  return args;
}

function mcpLooseArguments(schema, values) {
  const args = {};
  for (const [name, property] of mcpSchemaProperties(schema)) {
    const effective = mcpEffectiveSchema(property);
    const raw = values[name];
    if (raw === undefined) continue;
    if (effective.type === 'boolean') {
      if (raw === true || effective.default === false) args[name] = raw;
      continue;
    }
    if (typeof raw === 'string' && raw.trim() === '') continue;
    const text = String(raw);
    if (Array.isArray(effective.enum)) {
      const match = effective.enum.find((item) => String(item) === text);
      args[name] = match ?? text;
      continue;
    }
    if (effective.type === 'integer' || effective.type === 'number') {
      const number = Number(text);
      if (Number.isFinite(number)) args[name] = number;
      continue;
    }
    if (mcpIsComplexSchema(property)) {
      try {
        args[name] = JSON.parse(text);
      } catch {
        /* preview ignores invalid JSON */
      }
      continue;
    }
    args[name] = text;
  }
  return args;
}

function mcpDisplayLabel(name, property) {
  const title = typeof property?.title === 'string' ? property.title.trim() : '';
  if (title && title.toLowerCase() !== name.toLowerCase()) return title;
  const spaced = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.toLowerCase() === 'id'
        ? 'ID'
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

function mcpSchemaForm(schema) {
  const form = mcpEl('div', 'mcp-form-grid');
  const properties = mcpSchemaProperties(schema);
  if (properties.length === 0) {
    form.append(mcpEl('div', 'mcp-no-args', '这个工具没有参数。'));
    return form;
  }
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [name, property] of properties) {
    const effective = mcpEffectiveSchema(property);
    const complex = mcpIsComplexSchema(property);
    const field = mcpEl('div', `mcp-field${complex ? ' full' : ''}`);
    const label = mcpEl('span', 'mcp-label');
    label.append(document.createTextNode(mcpDisplayLabel(name, effective)));
    if (required.has(name)) {
      label.append(mcpEl('span', 'mcp-required', 'required'));
    }
    if (mcpDisplayLabel(name, effective).toLowerCase() !== name.toLowerCase()) {
      label.append(mcpEl('code', 'mcp-label-code', name));
    }
    field.append(label);

    const value = mcpState.toolValues[name];
    if (Array.isArray(effective.enum)) {
      const select = mcpEl('select', 'mcp-select');
      const empty = mcpEl('option', '', '选择…');
      empty.value = '';
      select.append(empty);
      for (const item of effective.enum) {
        const option = mcpEl('option', '', String(item));
        option.value = String(item);
        select.append(option);
      }
      select.value = typeof value === 'string' ? value : '';
      select.addEventListener('change', () => {
        mcpState.toolValues[name] = select.value;
      });
      field.append(select);
    } else if (effective.type === 'boolean') {
      const button = mcpEl('button', 'mcp-boolean');
      button.type = 'button';
      button.setAttribute('aria-pressed', value === true ? 'true' : 'false');
      button.classList.toggle('on', value === true);
      const track = mcpEl('span', 'mcp-boolean-track');
      track.append(mcpEl('span', 'mcp-boolean-knob'));
      const text = mcpEl('span', 'mcp-boolean-text', value === true ? 'true' : 'false');
      button.append(track, text);
      button.addEventListener('click', () => {
        const next = mcpState.toolValues[name] !== true;
        mcpState.toolValues[name] = next;
        button.classList.toggle('on', next);
        button.setAttribute('aria-pressed', next ? 'true' : 'false');
        text.textContent = next ? 'true' : 'false';
      });
      field.append(button);
    } else if (complex) {
      const textarea = mcpEl('textarea', 'mcp-textarea');
      textarea.rows = 4;
      textarea.spellcheck = false;
      textarea.placeholder =
        effective.type === 'array' ? '[\n  …\n]' : '{\n  …\n}';
      textarea.value = typeof value === 'string' ? value : '';
      textarea.addEventListener('input', () => {
        mcpState.toolValues[name] = textarea.value;
      });
      field.append(textarea);
    } else if (effective.type === 'integer' || effective.type === 'number') {
      const input = mcpEl('input', 'mcp-input');
      input.type = 'number';
      input.step = effective.type === 'integer' ? '1' : 'any';
      if (Number.isFinite(effective.minimum)) input.min = String(effective.minimum);
      if (Number.isFinite(effective.maximum)) input.max = String(effective.maximum);
      input.value = typeof value === 'string' ? value : '';
      input.placeholder =
        effective.default !== undefined ? String(effective.default) : '0';
      input.addEventListener('input', () => {
        mcpState.toolValues[name] = input.value;
      });
      field.append(input);
    } else {
      const input = mcpEl('input', 'mcp-input');
      input.type = effective.format === 'uri' ? 'url' : 'text';
      input.spellcheck = false;
      input.value = typeof value === 'string' ? value : '';
      input.placeholder =
        effective.default !== undefined
          ? String(effective.default)
          : effective.format || '';
      input.addEventListener('input', () => {
        mcpState.toolValues[name] = input.value;
      });
      field.append(input);
    }
    if (property.description || effective.description) {
      field.append(
        mcpEl(
          'span',
          'mcp-field-desc',
          property.description || effective.description
        )
      );
    }
    form.append(field);
  }
  return form;
}

async function mcpRunTool() {
  const server = mcpSelectedServer();
  const tool = mcpSelectedTool();
  if (!server || !tool || mcpState.toolRunning) return;
  if (tool.annotations?.destructiveHint && !mcpState.toolConfirm) {
    mcpState.toolConfirm = true;
    mcpState.toolError = '';
    mcpRenderToolDetail();
    return;
  }
  mcpState.toolConfirm = false;
  mcpState.toolError = '';
  let args;
  try {
    if (mcpState.toolMode === 'json') {
      const parsed = JSON.parse(mcpState.toolJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('参数必须是 JSON 对象');
      }
      args = parsed;
    } else {
      args = mcpBuildArguments(tool.inputSchema, mcpState.toolValues);
    }
  } catch (error) {
    mcpState.toolError = error.message;
    mcpRenderToolDetail();
    return;
  }
  mcpState.toolRunning = true;
  mcpState.toolResult = null;
  mcpRenderToolDetail();
  try {
    const response = await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/tools/call`,
      { method: 'POST', body: { name: tool.name, arguments: args } }
    );
    mcpState.toolResult = response;
    if (!response.ok) mcpState.toolError = response.error || '工具调用失败';
  } catch (error) {
    mcpState.toolError = error.message;
  } finally {
    mcpState.toolRunning = false;
    mcpRenderToolDetail();
  }
}

/* --------------------------------------------------------------- resources */

function mcpFilteredResources() {
  const resources = mcpState.detail?.resources || [];
  const templates = mcpState.detail?.resourceTemplates || [];
  const needle = mcpState.searchResources.trim().toLowerCase();
  const match = (item) =>
    [item.uri, item.name, item.title, item.description, item.mimeType, item.uriTemplate]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  return {
    resources: needle ? resources.filter(match) : resources,
    templates: needle ? templates.filter(match) : templates,
  };
}

function mcpRenderResourcesTab() {
  const wrap = mcpEl('div', 'mcp-split');
  const listPane = mcpEl('aside', 'mcp-list-pane');
  const searchWrap = mcpEl('div', 'mcp-search');
  const search = mcpEl('input', 'mcp-search-input');
  search.type = 'search';
  search.placeholder = '搜索资源…';
  search.value = mcpState.searchResources;
  search.spellcheck = false;
  search.addEventListener('input', () => {
    mcpState.searchResources = search.value;
    mcpRenderResourceList();
  });
  searchWrap.append(search);
  listPane.append(searchWrap);
  const list = mcpEl('div', 'mcp-list');
  list.id = 'mcp-resource-list';
  listPane.append(list);
  wrap.append(listPane);

  const detailPane = mcpEl('section', 'mcp-detail-pane');
  detailPane.id = 'mcp-resource-detail';
  wrap.append(detailPane);
  mcpDom.tabBody.append(wrap);

  mcpRenderResourceList();
  mcpRenderResourceDetail();
}

function mcpRenderResourceList() {
  const list = document.getElementById('mcp-resource-list');
  if (!list) return;
  list.replaceChildren();
  const { resources, templates } = mcpFilteredResources();
  if (resources.length === 0 && templates.length === 0) {
    list.append(
      mcpEl(
        'div',
        'mcp-list-empty',
        (mcpState.detail?.resources || []).length ||
          (mcpState.detail?.resourceTemplates || []).length
          ? '没有匹配的资源'
          : '这个服务器没有暴露资源'
      )
    );
    return;
  }
  for (const resource of resources) {
    const row = mcpEl('button', 'mcp-list-item');
    row.type = 'button';
    row.classList.toggle('selected', resource.uri === mcpState.resourceUri);
    row.append(mcpEl('span', 'mcp-list-name', resource.title || resource.name || resource.uri));
    row.append(mcpEl('code', 'mcp-list-code', resource.uri));
    const meta = [resource.mimeType, resource.size ? `${resource.size} B` : '']
      .filter(Boolean)
      .join(' · ');
    if (meta) row.append(mcpEl('span', 'mcp-list-desc', meta));
    row.addEventListener('click', () => {
      mcpState.resourceTemplate = null;
      mcpState.resourceTemplateUri = '';
      void mcpReadResource(resource.uri);
    });
    list.append(row);
  }
  if (templates.length) {
    list.append(mcpEl('div', 'mcp-list-group', '模板'));
    for (const template of templates) {
      const row = mcpEl('button', 'mcp-list-item template');
      row.type = 'button';
      row.classList.toggle(
        'selected',
        mcpState.resourceTemplate?.uriTemplate === template.uriTemplate
      );
      row.append(
        mcpEl('span', 'mcp-list-name', template.title || template.name)
      );
      row.append(mcpEl('code', 'mcp-list-code', template.uriTemplate));
      if (template.description) {
        row.append(mcpEl('span', 'mcp-list-desc', template.description));
      }
      row.addEventListener('click', () => mcpOpenTemplate(template));
      list.append(row);
    }
  }
}

function mcpOpenTemplate(template) {
  mcpState.resourceTemplate = template;
  mcpState.resourceTemplateUri = template.uriTemplate || '';
  mcpState.resourceUri = null;
  mcpState.resourceResult = null;
  mcpState.resourceError = '';
  mcpRenderResourceList();
  mcpRenderResourceDetail();
}

function mcpRenderResourceDetail() {
  const pane = document.getElementById('mcp-resource-detail');
  if (!pane) return;
  pane.replaceChildren();
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.status !== 'connected') {
    pane.append(
      mcpConnectGate(
        server.enabled === false
          ? '这个服务器在 OpenCode 配置中已禁用。'
          : '连接后可以读取资源',
        server.enabled === false ? null : '重连'
      )
    );
    return;
  }

  if (mcpState.resourceTemplate) {
    const template = mcpState.resourceTemplate;
    const head = mcpEl('div', 'mcp-pane-head');
    const titleWrap = mcpEl('div', 'mcp-pane-title');
    titleWrap.append(mcpEl('h3', '', template.title || template.name));
    titleWrap.append(mcpEl('code', 'mcp-code-label', template.uriTemplate));
    if (template.description) {
      titleWrap.append(mcpEl('p', 'mcp-pane-desc', template.description));
    }
    head.append(titleWrap);
    pane.append(head);

    const card = mcpEl('div', 'mcp-panel');
    card.append(mcpEl('span', 'mcp-section-kicker', '资源 URI'));
    const input = mcpEl('input', 'mcp-input');
    input.value = mcpState.resourceTemplateUri;
    input.spellcheck = false;
    input.addEventListener('input', () => {
      mcpState.resourceTemplateUri = input.value;
    });
    card.append(input);
    const bar = mcpEl('div', 'mcp-run-bar');
    const button = mcpButton(
      mcpState.resourceLoading ? '读取中…' : '读取资源',
      'pill primary',
      () => void mcpReadResource(mcpState.resourceTemplateUri)
    );
    button.disabled = mcpState.resourceLoading;
    bar.append(button);
    card.append(bar);
    if (mcpState.resourceError) {
      card.append(mcpEl('div', 'mcp-inline-error', mcpState.resourceError));
    }
    pane.append(card);
    if (mcpState.resourceResult) {
      pane.append(
        mcpResultCard({
          response: mcpState.resourceResult,
          method: 'resources/read',
          label: mcpState.resourceResult.uri || '',
          onInsert: () =>
            mcpInsertResource(
              mcpState.resourceResult.uri || '',
              mcpState.resourceResult
            ),
          kind: 'resource',
        })
      );
    }
    return;
  }

  const resource = (mcpState.detail?.resources || []).find(
    (item) => item.uri === mcpState.resourceUri
  );
  if (!resource && !mcpState.resourceResult) {
    pane.append(mcpEl('div', 'mcp-pane-empty', '选择左侧的资源'));
    return;
  }

  const head = mcpEl('div', 'mcp-pane-head');
  const titleWrap = mcpEl('div', 'mcp-pane-title');
  titleWrap.append(
    mcpEl('h3', '', resource?.title || resource?.name || mcpState.resourceUri || 'Resource')
  );
  titleWrap.append(mcpEl('code', 'mcp-code-label', mcpState.resourceUri || ''));
  if (resource?.description) {
    titleWrap.append(mcpEl('p', 'mcp-pane-desc', resource.description));
  }
  head.append(titleWrap);
  const actions = mcpEl('div', 'mcp-pane-actions');
  actions.append(
    mcpButton('重新读取', 'pill compact', () =>
      void mcpReadResource(mcpState.resourceUri)
    )
  );
  head.append(actions);
  pane.append(head);

  if (mcpState.resourceLoading) {
    pane.append(mcpEl('div', 'mcp-loading', '读取中…'));
  }
  if (mcpState.resourceError) {
    pane.append(mcpEl('div', 'mcp-inline-error', mcpState.resourceError));
  }
  if (mcpState.resourceResult) {
    pane.append(
      mcpResultCard({
        response: mcpState.resourceResult,
        method: 'resources/read',
        label: mcpState.resourceResult.uri || mcpState.resourceUri || '',
        onInsert: () =>
          mcpInsertResource(
            mcpState.resourceResult.uri || mcpState.resourceUri || '',
            mcpState.resourceResult
          ),
        kind: 'resource',
      })
    );
  }
}

async function mcpReadResource(uri) {
  const server = mcpSelectedServer();
  const target = String(uri || '').trim();
  if (!server || !target || mcpState.resourceLoading) return;
  mcpState.resourceUri = target;
  mcpState.resourceLoading = true;
  mcpState.resourceError = '';
  mcpState.resourceResult = null;
  mcpRenderResourceList();
  mcpRenderResourceDetail();
  try {
    const response = await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/resources/read`,
      { method: 'POST', body: { uri: target } }
    );
    mcpState.resourceResult = response;
    if (!response.ok) mcpState.resourceError = response.error || '读取失败';
  } catch (error) {
    mcpState.resourceError = error.message;
  } finally {
    mcpState.resourceLoading = false;
    mcpRenderResourceDetail();
  }
}

/* ----------------------------------------------------------------- prompts */

function mcpFilteredPrompts() {
  const prompts = mcpState.detail?.prompts || [];
  const needle = mcpState.searchPrompts.trim().toLowerCase();
  if (!needle) return prompts;
  return prompts.filter((prompt) =>
    [prompt.name, prompt.title, prompt.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  );
}

function mcpRenderPromptsTab() {
  const prompts = mcpState.detail?.prompts || [];
  if (
    !mcpState.promptName ||
    !prompts.some((prompt) => prompt.name === mcpState.promptName)
  ) {
    mcpState.promptName = prompts[0]?.name || null;
    mcpState.promptArgs = {};
    mcpState.promptResult = null;
    mcpState.promptError = '';
  }
  const wrap = mcpEl('div', 'mcp-split');
  const listPane = mcpEl('aside', 'mcp-list-pane');
  const searchWrap = mcpEl('div', 'mcp-search');
  const search = mcpEl('input', 'mcp-search-input');
  search.type = 'search';
  search.placeholder = '搜索提示词…';
  search.value = mcpState.searchPrompts;
  search.spellcheck = false;
  search.addEventListener('input', () => {
    mcpState.searchPrompts = search.value;
    mcpRenderPromptList();
  });
  searchWrap.append(search);
  listPane.append(searchWrap);
  const list = mcpEl('div', 'mcp-list');
  list.id = 'mcp-prompt-list';
  listPane.append(list);
  wrap.append(listPane);

  const detailPane = mcpEl('section', 'mcp-detail-pane');
  detailPane.id = 'mcp-prompt-detail';
  wrap.append(detailPane);
  mcpDom.tabBody.append(wrap);

  mcpRenderPromptList();
  mcpRenderPromptDetail();
}

function mcpRenderPromptList() {
  const list = document.getElementById('mcp-prompt-list');
  if (!list) return;
  list.replaceChildren();
  const prompts = mcpFilteredPrompts();
  if (prompts.length === 0) {
    list.append(
      mcpEl(
        'div',
        'mcp-list-empty',
        (mcpState.detail?.prompts || []).length
          ? '没有匹配的提示词'
          : '这个服务器没有暴露提示词'
      )
    );
    return;
  }
  for (const prompt of prompts) {
    const row = mcpEl('button', 'mcp-list-item');
    row.type = 'button';
    row.classList.toggle('selected', prompt.name === mcpState.promptName);
    row.append(mcpEl('span', 'mcp-list-name', prompt.title || prompt.name));
    if (prompt.title) row.append(mcpEl('code', 'mcp-list-code', prompt.name));
    if (prompt.description) {
      row.append(mcpEl('span', 'mcp-list-desc', prompt.description));
    }
    row.addEventListener('click', () => {
      if (mcpState.promptName === prompt.name) return;
      mcpState.promptName = prompt.name;
      mcpState.promptArgs = {};
      mcpState.promptResult = null;
      mcpState.promptError = '';
      mcpRenderPromptList();
      mcpRenderPromptDetail();
    });
    list.append(row);
  }
}

function mcpSelectedPrompt() {
  return (
    (mcpState.detail?.prompts || []).find(
      (prompt) => prompt.name === mcpState.promptName
    ) || null
  );
}

function mcpRenderPromptDetail() {
  const pane = document.getElementById('mcp-prompt-detail');
  if (!pane) return;
  pane.replaceChildren();
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.status !== 'connected') {
    pane.append(
      mcpConnectGate(
        server.enabled === false
          ? '这个服务器在 OpenCode 配置中已禁用。'
          : '连接后可以获取提示词',
        server.enabled === false ? null : '重连'
      )
    );
    return;
  }
  const prompt = mcpSelectedPrompt();
  if (!prompt) {
    pane.append(mcpEl('div', 'mcp-pane-empty', '选择左侧的提示词'));
    return;
  }

  const head = mcpEl('div', 'mcp-pane-head');
  const titleWrap = mcpEl('div', 'mcp-pane-title');
  titleWrap.append(mcpEl('h3', '', prompt.title || prompt.name));
  if (prompt.title) titleWrap.append(mcpEl('code', 'mcp-code-label', prompt.name));
  if (prompt.description) {
    titleWrap.append(mcpEl('p', 'mcp-pane-desc', prompt.description));
  }
  head.append(titleWrap);
  pane.append(head);

  const card = mcpEl('div', 'mcp-panel');
  card.append(mcpEl('span', 'mcp-section-kicker', '参数'));
  const args = Array.isArray(prompt.arguments) ? prompt.arguments : [];
  if (args.length === 0) {
    card.append(mcpEl('div', 'mcp-no-args', '这个提示词没有参数。'));
  } else {
    const grid = mcpEl('div', 'mcp-form-grid');
    for (const argument of args) {
      const field = mcpEl('div', 'mcp-field');
      const label = mcpEl('span', 'mcp-label');
      label.append(document.createTextNode(argument.name));
      if (argument.required) label.append(mcpEl('span', 'mcp-required', 'required'));
      field.append(label);
      const input = mcpEl('input', 'mcp-input');
      input.value = mcpState.promptArgs[argument.name] || '';
      input.placeholder = argument.description || '';
      input.addEventListener('input', () => {
        mcpState.promptArgs[argument.name] = input.value;
      });
      field.append(input);
      if (argument.description) {
        field.append(mcpEl('span', 'mcp-field-desc', argument.description));
      }
      grid.append(field);
    }
    card.append(grid);
  }
  if (mcpState.promptError) {
    card.append(mcpEl('div', 'mcp-inline-error', mcpState.promptError));
  }
  const bar = mcpEl('div', 'mcp-run-bar');
  const button = mcpButton(
    mcpState.promptLoading ? '获取中…' : '获取提示词',
    'pill primary',
    () => void mcpGetPrompt()
  );
  button.disabled = mcpState.promptLoading;
  bar.append(button);
  card.append(bar);
  pane.append(card);

  if (mcpState.promptResult) {
    pane.append(
      mcpResultCard({
        response: mcpState.promptResult,
        method: 'prompts/get',
        label: prompt.name,
        onInsert: () =>
          mcpInsertPrompt(prompt, mcpState.promptResult),
        kind: 'prompt',
      })
    );
  }
}

async function mcpGetPrompt() {
  const server = mcpSelectedServer();
  const prompt = mcpSelectedPrompt();
  if (!server || !prompt || mcpState.promptLoading) return;
  const args = {};
  for (const [key, value] of Object.entries(mcpState.promptArgs)) {
    if (String(value).trim()) args[key] = String(value);
  }
  for (const argument of prompt.arguments || []) {
    if (argument.required && !args[argument.name]) {
      mcpState.promptError = `"${argument.name}" 是必填参数`;
      mcpRenderPromptDetail();
      return;
    }
  }
  mcpState.promptLoading = true;
  mcpState.promptError = '';
  mcpState.promptResult = null;
  mcpRenderPromptDetail();
  try {
    const response = await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/prompts/get`,
      { method: 'POST', body: { name: prompt.name, arguments: args } }
    );
    mcpState.promptResult = response;
    if (!response.ok) mcpState.promptError = response.error || '获取失败';
  } catch (error) {
    mcpState.promptError = error.message;
  } finally {
    mcpState.promptLoading = false;
    mcpRenderPromptDetail();
  }
}

/* -------------------------------------------------------------------- logs */

function mcpFilteredLogs() {
  const needle = mcpState.logSearch.trim().toLowerCase();
  return mcpState.logs.filter((entry) => {
    if (mcpState.logFilter !== 'all' && entry.stream !== mcpState.logFilter) {
      return false;
    }
    if (needle && !String(entry.text).toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
}

function mcpRenderLogsTab() {
  const wrap = mcpEl('div', 'mcp-logs');
  const bar = mcpEl('div', 'mcp-logs-bar');
  const filters = mcpEl('div', 'mcp-log-filters');
  const options = [
    ['all', '全部'],
    ['protocol', '协议'],
    ['stderr', 'stderr'],
    ['stdout', 'stdout'],
    ['info', 'info'],
  ];
  for (const [value, label] of options) {
    const button = mcpButton(label, 'mcp-log-filter', () => {
      mcpState.logFilter = value;
      mcpRenderLogsTab();
    });
    button.classList.toggle('active', mcpState.logFilter === value);
    filters.append(button);
  }
  bar.append(filters);

  const searchWrap = mcpEl('div', 'mcp-search mcp-log-search');
  const search = mcpEl('input', 'mcp-search-input');
  search.type = 'search';
  search.placeholder = '搜索日志…';
  search.value = mcpState.logSearch;
  search.spellcheck = false;
  search.addEventListener('input', () => {
    mcpState.logSearch = search.value;
    mcpRenderLogList();
  });
  searchWrap.append(search);
  bar.append(searchWrap);

  const actions = mcpEl('div', 'mcp-log-actions');
  actions.append(
    mcpEl('span', 'mcp-log-count', `${mcpFilteredLogs().length} 行`)
  );
  actions.append(
    mcpButton('复制', 'pill compact', () =>
      mcpCopy(
        mcpFilteredLogs()
          .map(
            (entry) =>
              `[${mcpTime(entry.ts)}] [${entry.stream}] ${entry.text}`
          )
          .join('\n')
      )
    )
  );
  actions.append(
    mcpButton('清空', 'pill compact', () => void mcpClearLogs())
  );
  bar.append(actions);
  wrap.append(bar);

  const list = mcpEl('div', 'mcp-log-list');
  list.id = 'mcp-log-list';
  wrap.append(list);
  mcpDom.tabBody.append(wrap);
  mcpRenderLogList();
}

function mcpRenderLogList() {
  const list = document.getElementById('mcp-log-list');
  if (!list) return;
  const atBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren();
  const logs = mcpFilteredLogs();
  if (logs.length === 0) {
    list.append(
      mcpEl(
        'div',
        'mcp-list-empty',
        mcpState.logs.length ? '没有匹配的日志' : '还没有日志。连接服务器后会出现协议与进程输出。'
      )
    );
    return;
  }
  for (const entry of logs) {
    const line = mcpEl('div', `mcp-log-line ${entry.stream}`);
    line.append(mcpEl('span', 'mcp-log-time', mcpTime(entry.ts)));
    line.append(mcpEl('span', `mcp-log-stream ${entry.stream}`, entry.stream));
    line.append(mcpEl('span', 'mcp-log-text', entry.text));
    list.append(line);
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}

async function mcpClearLogs() {
  const server = mcpSelectedServer();
  if (!server) return;
  try {
    await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/logs/clear`,
      { method: 'POST', body: {} }
    );
    mcpState.logs = [];
    mcpRenderLogsTab();
    mcpRenderTabs();
  } catch (error) {
    mcpToast(error.message, 'error');
  }
}

/* ---------------------------------------------------------------- overview */

function mcpRenderOverviewTab() {
  const detail = mcpState.detail;
  if (!detail) return;
  const pane = mcpEl('section', 'mcp-detail-pane mcp-overview');
  pane.id = 'mcp-overview-pane';

  const grid = mcpEl('div', 'mcp-overview-grid');
  grid.append(mcpInfoCard('服务器', [
    ['名称', detail.serverInfo?.name || detail.name],
    ['版本', detail.serverInfo?.version || '—'],
    ['协议', detail.protocolVersion || '—'],
    ['状态', mcpStatusLabel(detail.status)],
    ['连接时间', detail.connectedAt ? mcpRelative(detail.connectedAt) : '—'],
  ]));
  grid.append(
    mcpInfoCard('能力', [
      ['工具', String(detail.tools?.length || 0)],
      ['资源', String(detail.resources?.length || 0)],
      ['资源模板', String(detail.resourceTemplates?.length || 0)],
      ['提示词', String(detail.prompts?.length || 0)],
    ])
  );
  pane.append(grid);

  const capabilities = detail.capabilities || {};
  const capCard = mcpEl('div', 'mcp-panel');
  capCard.append(mcpEl('span', 'mcp-section-kicker', 'Capabilities'));
  if (Object.keys(capabilities).length === 0) {
    capCard.append(mcpEl('div', 'mcp-muted', '服务器没有报告能力。'));
  } else {
    const list = mcpEl('div', 'mcp-cap-list');
    for (const [name, value] of Object.entries(capabilities)) {
      const row = mcpEl('div', 'mcp-cap-row');
      row.append(mcpEl('span', '', name));
      row.append(
        mcpEl(
          'span',
          `mcp-badge ${value ? 'success' : 'neutral'}`,
          value ? '支持' : '关闭'
        )
      );
      list.append(row);
    }
    capCard.append(list);
  }
  pane.append(capCard);

  const configCard = mcpEl('div', 'mcp-panel');
  configCard.append(mcpEl('span', 'mcp-section-kicker', '配置'));
  const configList = mcpEl('div', 'mcp-config-list');
  const rows = [
    [
      '来源',
      detail.source === 'opencode' ? 'OpenCode' : '本机 mcp.json',
    ],
    [
      '配置文件',
      detail.sourcePath || (detail.source === 'opencode' ? 'OpenCode 配置' : 'mcp.json'),
    ],
    ['传输', detail.transport?.toUpperCase() || '—'],
    ['命令', detail.command ? [detail.command, ...(detail.args || [])].join(' ') : '—'],
    ['工作目录', detail.cwd || '—'],
    ['URL', detail.url || '—'],
    ['环境变量', detail.envKeys?.length ? detail.envKeys.join(', ') : '—'],
    ['Headers', detail.headerKeys?.length ? detail.headerKeys.join(', ') : '—'],
  ];
  for (const [label, value] of rows) {
    const row = mcpEl('div', 'mcp-config-row');
    row.append(mcpEl('span', 'mcp-config-label', label));
    const code = mcpEl('code', 'mcp-config-value', value);
    row.append(code);
    configList.append(row);
  }
  configCard.append(configList);
  pane.append(configCard);

  if (detail.instructions) {
    pane.append(
      mcpDetails(
        '服务器说明',
        mcpEl('pre', 'mcp-instructions', detail.instructions)
      )
    );
  }

  pane.append(
    mcpDetails(
      'Initialize 原始结果',
      mcpJsonView({
        protocolVersion: detail.protocolVersion,
        serverInfo: detail.serverInfo,
        capabilities: detail.capabilities,
        instructions: detail.instructions || undefined,
      })
    )
  );

  mcpDom.tabBody.append(pane);
}

function mcpInfoCard(title, rows) {
  const card = mcpEl('div', 'mcp-panel');
  card.append(mcpEl('span', 'mcp-section-kicker', title));
  const list = mcpEl('div', 'mcp-info-list');
  for (const [label, value] of rows) {
    const row = mcpEl('div', 'mcp-info-row');
    row.append(mcpEl('span', 'mcp-info-label', label));
    row.append(mcpEl('span', 'mcp-info-value', value));
    list.append(row);
  }
  card.append(list);
  return card;
}

/* ----------------------------------------------------------------- results */

function mcpResultCard({ response, method, label, onInsert, kind }) {
  const ok = Boolean(response?.ok) && !response?.result?.isError;
  const card = mcpEl('div', `mcp-result ${ok ? 'success' : 'error'}`);
  const head = mcpEl('div', 'mcp-result-head');
  const title = mcpEl('div', 'mcp-result-title');
  title.append(
    mcpEl('span', `mcp-badge ${ok ? 'success' : 'danger'}`, ok ? '成功' : '失败')
  );
  title.append(mcpEl('code', 'mcp-method', method));
  if (label) title.append(mcpEl('span', 'mcp-result-label', label));
  head.append(title);

  const actions = mcpEl('div', 'mcp-result-actions');
  if (response?.durationMs !== undefined) {
    actions.append(mcpEl('span', 'mcp-duration', `${response.durationMs} ms`));
  }
  if (onInsert) {
    actions.append(mcpButton('插入到对话', 'pill compact', onInsert));
  }
  actions.append(
    mcpButton('复制结果', 'pill compact', () =>
      mcpCopy(response?.text || JSON.stringify(response?.result ?? {}, null, 2))
    )
  );
  head.append(actions);
  card.append(head);

  if (response?.error) {
    card.append(mcpEl('div', 'mcp-inline-error', response.error));
  }
  if (response?.result?.isError) {
    card.append(
      mcpEl('div', 'mcp-inline-error', '服务器把这次结果标记为错误（isError: true）。')
    );
  }

  if (kind === 'resource') {
    const contents = response?.result?.contents;
    if (Array.isArray(contents) && contents.length) {
      card.append(mcpRenderContent(contents.map(mcpResourceContentBlock)));
    } else if (response?.text) {
      card.append(mcpEl('pre', 'mcp-output', response.text));
    }
  } else if (kind === 'prompt') {
    const messages = response?.result?.messages;
    if (Array.isArray(messages) && messages.length) {
      card.append(mcpRenderPromptMessages(messages));
    } else if (response?.text) {
      card.append(mcpEl('pre', 'mcp-output', response.text));
    }
  } else {
    const content = response?.result?.content;
    if (Array.isArray(content) && content.length) {
      card.append(mcpRenderContent(content));
    } else if (response?.text) {
      card.append(mcpEl('pre', 'mcp-output', response.text));
    }
  }

  if (response?.result !== undefined) {
    card.append(
      mcpDetails(
        '原始响应',
        mcpJsonView(response.result),
        false
      )
    );
  }
  return card;
}

function mcpResourceContentBlock(item) {
  if (item && typeof item === 'object') {
    if (typeof item.text === 'string') {
      return { type: 'text', text: item.text };
    }
    if (item.blob) {
      return {
        type: item.mimeType?.startsWith('image/') ? 'image' : 'binary',
        data: item.blob,
        mimeType: item.mimeType || '',
      };
    }
    return { type: 'resource', resource: item };
  }
  return { type: 'text', text: String(item ?? '') };
}

function mcpRenderContent(blocks) {
  const wrap = mcpEl('div', 'mcp-content');
  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      if (block != null) wrap.append(mcpEl('pre', 'mcp-output', String(block)));
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      wrap.append(mcpEl('pre', 'mcp-output', block.text));
      continue;
    }
    if (block.type === 'image' && block.data) {
      const img = mcpEl('img', 'mcp-image');
      img.src = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
      img.alt = block.mimeType || 'image';
      wrap.append(img);
      continue;
    }
    if (block.type === 'audio') {
      wrap.append(mcpEl('div', 'mcp-muted', `音频内容（${block.mimeType || 'audio'}）`));
      continue;
    }
    if (block.type === 'resource_link') {
      wrap.append(
        mcpEl('div', 'mcp-resource-link', `${block.name || 'resource'} · ${block.uri || ''}`)
      );
      continue;
    }
    if (block.type === 'resource') {
      const resource = block.resource || {};
      if (typeof resource.text === 'string') {
        wrap.append(mcpEl('pre', 'mcp-output', resource.text));
      } else if (resource.blob) {
        wrap.append(
          mcpEl(
            'div',
            'mcp-muted',
            `二进制资源（${resource.mimeType || 'unknown'}）`
          )
        );
      } else {
        wrap.append(mcpEl('div', 'mcp-muted', resource.uri || 'resource'));
      }
      continue;
    }
    if (typeof block.text === 'string') {
      wrap.append(mcpEl('pre', 'mcp-output', block.text));
      continue;
    }
    wrap.append(mcpEl('pre', 'mcp-output', JSON.stringify(block, null, 2)));
  }
  if (wrap.childNodes.length === 0) {
    wrap.append(mcpEl('div', 'mcp-muted', '没有内容。'));
  }
  return wrap;
}

function mcpRenderPromptMessages(messages) {
  const wrap = mcpEl('div', 'mcp-prompt-messages');
  messages.forEach((message, index) => {
    const item = mcpEl('div', 'mcp-prompt-message');
    const head = mcpEl('div', 'mcp-prompt-role');
    head.append(
      mcpEl('span', `mcp-role ${message.role || 'user'}`, message.role || 'user')
    );
    head.append(mcpEl('span', 'mcp-muted', `message ${index + 1}`));
    item.append(head);
    const content = Array.isArray(message.content)
      ? message.content
      : [message.content];
    item.append(mcpRenderContent(content));
    wrap.append(item);
  });
  return wrap;
}

/* --------------------------------------------------------------- insertion */

function mcpExposedName(server, tool) {
  const slug = (text, max) =>
    String(text || '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max) || 'tool';
  return `mcp__${slug(server.name, 18)}__${slug(tool.name, 44)}`;
}

function mcpInsertText(text) {
  const value = String(text || '').trim();
  if (!value) return;
  closeMcp();
  if (!currentSession()) {
    const projectId = state.projects[0]?.id;
    if (!projectId) return;
    newSession(projectId);
  }
  const existing = dom.input.value.trim();
  dom.input.value = existing ? `${existing}\n\n${value}` : value;
  dom.input.dispatchEvent(new Event('input', { bubbles: true }));
  openComposer();
}

function mcpInsertTool(tool) {
  const server = mcpSelectedServer();
  if (!server) return;
  const schema = JSON.stringify(tool.inputSchema || {}, null, 2);
  mcpInsertText(
    [
      '[MCP 工具]',
      `服务器: ${server.name}`,
      `工具: ${tool.name}`,
      `调用名: ${tool.exposedName || mcpExposedName(server, tool)}`,
      tool.description ? `说明: ${tool.description}` : '',
      '参数 Schema:',
      schema,
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function mcpInsertToolResult(tool, response) {
  const server = mcpSelectedServer();
  if (!server) return;
  mcpInsertText(
    [
      '[MCP 工具结果]',
      `服务器: ${server.name}`,
      `工具: ${tool.name}`,
      response?.text || '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function mcpInsertResource(uri, response) {
  const server = mcpSelectedServer();
  if (!server) return;
  mcpInsertText(
    [
      '[MCP 资源]',
      `服务器: ${server.name}`,
      `URI: ${uri}`,
      response?.text || '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function mcpInsertPrompt(prompt, response) {
  const server = mcpSelectedServer();
  if (!server) return;
  mcpInsertText(
    [
      '[MCP 提示词]',
      `服务器: ${server.name}`,
      `提示词: ${prompt.name}`,
      response?.text || '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/* ------------------------------------------------------------------- form */

function mcpSetFormTransport(transport) {
  mcpState.formTransport = transport;
  for (const button of mcpDom.formTransport.querySelectorAll('button')) {
    button.setAttribute(
      'aria-pressed',
      button.dataset.transport === transport ? 'true' : 'false'
    );
  }
  mcpDom.formStdio.classList.toggle('hidden', transport !== 'stdio');
  mcpDom.formRemote.classList.toggle('hidden', transport === 'stdio');
}

function mcpSetFormMode(mode) {
  mcpState.formMode = mode;
  mcpDom.formModeForm.setAttribute(
    'aria-pressed',
    mode === 'form' ? 'true' : 'false'
  );
  mcpDom.formModeJson.setAttribute(
    'aria-pressed',
    mode === 'json' ? 'true' : 'false'
  );
  mcpDom.formFields.classList.toggle('hidden', mode !== 'form');
  mcpDom.formJsonWrap.classList.toggle('hidden', mode !== 'json');
}

function mcpResetForm() {
  mcpDom.formName.value = '';
  mcpDom.formCommand.value = '';
  mcpDom.formArgs.value = '';
  mcpDom.formCwd.value = '';
  mcpDom.formEnv.value = '';
  mcpDom.formUrl.value = '';
  mcpDom.formHeaders.value = '';
  mcpDom.formJson.value = '';
  mcpDom.formError.classList.add('hidden');
  mcpDom.formError.textContent = '';
  mcpSetFormTransport('stdio');
  mcpSetFormMode('form');
}

function mcpOpenForm(editId) {
  const server = editId
    ? mcpState.servers.find((item) => item.id === editId)
    : null;
  if (server?.source === 'opencode') {
    mcpToast('来自 OpenCode 的服务器请在 OpenCode 配置中修改');
    return;
  }
  mcpResetForm();
  mcpState.formOpen = true;
  mcpState.formEditId = editId || null;
  mcpState.formSaving = false;
  mcpDom.formTitle.textContent = server ? 'EDIT MCP SERVER' : 'ADD MCP SERVER';
  mcpDom.formSubtitle.textContent = server
    ? server.name
    : '配置会保存在本机的 mcp.json';
  mcpDom.formModeJson.disabled = Boolean(server);
  mcpDom.formModeJson.style.opacity = server ? '0.45' : '';
  if (server) {
    mcpDom.formName.value = server.name;
    mcpSetFormTransport(server.transport || 'stdio');
    mcpDom.formCommand.value = server.command || '';
    mcpDom.formArgs.value = (server.args || []).join('\n');
    mcpDom.formCwd.value = server.cwd || '';
    mcpDom.formEnv.value = mcpFormatKeyValues(server.env || {});
    mcpDom.formUrl.value = server.url || '';
    mcpDom.formHeaders.value = mcpFormatKeyValues(server.headers || {});
  }
  mcpDom.formOverlay.classList.remove('hidden');
  mcpDom.formOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => mcpDom.formName.focus());
}

function mcpCloseForm() {
  if (!mcpState.formOpen) return;
  mcpState.formOpen = false;
  mcpState.formEditId = null;
  mcpDom.formOverlay.classList.add('hidden');
  mcpDom.formOverlay.setAttribute('aria-hidden', 'true');
}

function mcpFormPayload() {
  const transport = mcpState.formTransport;
  return {
    name: mcpDom.formName.value.trim(),
    transport,
    command: transport === 'stdio' ? mcpDom.formCommand.value.trim() : '',
    args:
      transport === 'stdio'
        ? mcpDom.formArgs.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
    cwd: transport === 'stdio' ? mcpDom.formCwd.value.trim() : '',
    env: transport === 'stdio' ? mcpParseKeyValueLines(mcpDom.formEnv.value) : {},
    url: transport === 'stdio' ? '' : mcpDom.formUrl.value.trim(),
    headers:
      transport === 'stdio'
        ? {}
        : mcpParseKeyValueLines(mcpDom.formHeaders.value),
  };
}

async function mcpSaveForm() {
  if (mcpState.formSaving) return;
  mcpState.formSaving = true;
  mcpDom.formError.classList.add('hidden');
  const editId = mcpState.formEditId;
  try {
    let response;
    if (mcpState.formMode === 'json' && !editId) {
      response = await requestJson('/api/mcp/servers', {
        method: 'POST',
        body: { json: mcpDom.formJson.value },
      });
      const added = Array.isArray(response?.added) ? response.added : [];
      mcpCloseForm();
      await mcpRefreshState();
      if (added[0]?.id) mcpSelectServer(added[0].id);
      mcpToast(
        added.length > 1 ? `已添加 ${added.length} 个服务器` : '服务器已添加',
        'success'
      );
      return;
    }
    const payload = mcpFormPayload();
    if (!payload.name) throw new Error('请填写服务器名称');
    if (payload.transport === 'stdio' && !payload.command) {
      throw new Error('STDIO 服务器需要命令');
    }
    if (payload.transport !== 'stdio' && !payload.url) {
      throw new Error('远程服务器需要 URL');
    }
    if (editId) {
      response = await requestJson(
        `/api/mcp/servers/${encodeURIComponent(editId)}`,
        { method: 'PUT', body: payload }
      );
    } else {
      response = await requestJson('/api/mcp/servers', {
        method: 'POST',
        body: payload,
      });
    }
    const server = response?.server || null;
    mcpCloseForm();
    await mcpRefreshState();
    if (server?.id) mcpSelectServer(server.id);
    mcpToast(editId ? '服务器已更新' : '服务器已添加', 'success');
  } catch (error) {
    mcpDom.formError.textContent = error.message;
    mcpDom.formError.classList.remove('hidden');
  } finally {
    mcpState.formSaving = false;
  }
}

/* ----------------------------------------------------------------- actions */

async function mcpReconnect() {
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.enabled === false) {
    mcpToast('这个服务器在 OpenCode 配置中已禁用');
    return;
  }
  mcpToast('正在重连…');
  try {
    await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/reconnect`,
      { method: 'POST', body: {} }
    );
    await mcpRefreshState();
    mcpToast('已重连', 'success');
  } catch (error) {
    mcpToast(error.message, 'error');
  }
}

async function mcpRefreshCapabilities() {
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.enabled === false) {
    mcpToast('这个服务器在 OpenCode 配置中已禁用');
    return;
  }
  try {
    await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}/refresh`,
      { method: 'POST', body: {} }
    );
    await mcpLoadDetail(server.id);
    mcpToast('已刷新', 'success');
  } catch (error) {
    mcpToast(error.message, 'error');
  }
}

async function mcpRemoveServer() {
  const server = mcpSelectedServer();
  if (!server) return;
  if (server.source === 'opencode') {
    mcpToast('来自 OpenCode 的服务器不能在这里删除');
    return;
  }
  if (!mcpState.deleteArmed) {
    mcpState.deleteArmed = true;
    mcpRenderHeader();
    clearTimeout(mcpState.deleteTimer);
    mcpState.deleteTimer = setTimeout(() => {
      mcpState.deleteArmed = false;
      mcpRenderHeader();
    }, 3200);
    return;
  }
  clearTimeout(mcpState.deleteTimer);
  mcpState.deleteArmed = false;
  try {
    await requestJson(
      `/api/mcp/servers/${encodeURIComponent(server.id)}`,
      { method: 'DELETE' }
    );
    mcpState.selectedId = null;
    localStorage.removeItem(MCP_SELECTED_KEY);
    await mcpRefreshState();
    mcpToast('服务器已删除', 'success');
  } catch (error) {
    mcpToast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ wiring */

function mcpBindEvents() {
  mcpDom.close?.addEventListener('click', closeMcp);
  mcpDom.add.addEventListener('click', () => mcpOpenForm(null));
  mcpDom.refresh.addEventListener('click', () => void mcpRefreshCapabilities());
  mcpDom.reconnect.addEventListener('click', () => void mcpReconnect());
  mcpDom.edit.addEventListener('click', () => {
    if (mcpState.selectedId) mcpOpenForm(mcpState.selectedId);
  });
  mcpDom.remove.addEventListener('click', () => void mcpRemoveServer());

  mcpDom.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    const tab = button.dataset.tab;
    if (tab === mcpState.tab) return;
    mcpState.tab = tab;
    mcpRenderTabs();
    mcpRenderDetail();
  });

  mcpDom.formClose?.addEventListener('click', mcpCloseForm);
  mcpDom.formCancel.addEventListener('click', mcpCloseForm);
  mcpDom.formSave.addEventListener('click', () => void mcpSaveForm());
  mcpDom.formModeForm.addEventListener('click', () => mcpSetFormMode('form'));
  mcpDom.formModeJson.addEventListener('click', () => {
    if (mcpDom.formModeJson.disabled) return;
    mcpSetFormMode('json');
  });
  mcpDom.formTransport.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-transport]');
    if (!button) return;
    mcpSetFormTransport(button.dataset.transport);
  });
  mcpDom.formOverlay.addEventListener('click', (event) => {
    if (event.target === mcpDom.formOverlay) mcpCloseForm();
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (!mcpState.open) return;
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMcp();
    },
    true
  );
}

if (mcpDom.overlay) {
  mcpBindEvents();
}
