'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are miniharness, a terse terminal coding assistant. Answer in plain text.';
const NO_KEY_HINT =
  'No DeepSeek API key yet. Open Settings at the bottom of the sidebar and paste your key to start chatting.';

const api = window.miniharness;
const $ = (id) => document.getElementById(id);

const dom = {
  sidebar: $('sidebar'),
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  sessionList: $('session-list'),
  settingsOverlay: $('settings-overlay'),
  apiKey: $('api-key'),
  apiKeyState: $('api-key-state'),
};

const state = {
  sessions: [],
  current: 0,
  seq: 1,
  settings: {
    apiKey: '',
    sidebarCollapsed: false,
  },
  sidebarCollapsed: false,
  streaming: false,
  requestId: null,
  streamMessage: null,
  textOpen: false,
  pendingDelete: -1,
  deleteTimer: null,
  saveTimer: null,
  settingsTimer: null,
  forceScroll: true,
};

let windowDrag = null;
let dragPoint = null;
let dragFrame = 0;

function currentSession() {
  return state.sessions[state.current];
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

function saveChatsNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  api
    .saveChats({
      sessions: state.sessions,
      current: state.current,
      seq: state.seq,
    })
    .catch((error) => console.error('save chats failed', error));
}

function saveChatsSoon() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveChatsNow, 250);
}

function settingsPayload() {
  const { apiKey, sidebarCollapsed } = state.settings;
  return { apiKey, sidebarCollapsed };
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
  dom.apiKeyState.textContent = s.apiKey ? 'set' : 'not set';
  if (document.activeElement !== dom.apiKey) {
    dom.apiKey.value = s.apiKey;
  }
  applySidebar();
}

function applySidebar() {
  state.sidebarCollapsed = state.settings.sidebarCollapsed === true;
  dom.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
}

function toggleSidebar() {
  state.settings.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebar();
  saveSettingsSoon();
}

function updateControls() {
  const session = currentSession();
  if (!session) {
    dom.input.disabled = true;
    dom.input.placeholder = 'Create a chat first';
    updateSendState();
    return;
  }

  dom.input.disabled = false;
  dom.input.placeholder = '';
  updateSendState();
}

function isNearBottom() {
  return (
    dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight <
    80
  );
}

function appendRow(card) {
  const row = el('div', 'msg');
  row.append(card);
  dom.messages.append(row);
}

function makeCard(opts) {
  const card = el('div', `message-card ${opts.kind}`);
  if (opts.collapsed) card.classList.add('collapsed');

  const head = el('div', 'card-head');
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', String(!opts.collapsed));
  head.append(el('span', 'card-dot'));
  head.append(el('span', 'card-title', opts.title));
  head.append(el('span', 'card-meta', opts.meta || ''));
  if (opts.badge) {
    const badge = el('span', 'card-badge', opts.badge.text);
    if (opts.badge.error) badge.classList.add('error');
    head.append(badge);
  }
  const chevron = el('span', 'card-chevron');
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  head.append(chevron);

  const toggle = () => {
    opts.onToggle();
    renderMessages();
  };
  head.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });
  head.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });

  card.append(head);
  return card;
}

function textCard({ kind, title, meta, text, collapsed, onToggle, streaming }) {
  const card = makeCard({ kind, title, meta, collapsed, onToggle });
  const body = el('div', 'card-body');
  if (text) body.append(el('div', 'card-text', text));
  card.append(body);
  if (streaming) card.classList.add('streaming');
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

function renderToolCard(step) {
  const call = step.kind === 'call';
  const card = makeCard({
    kind: call ? 'tool-call' : 'tool-result',
    title: call ? '工具调用' : '工具返回',
    meta: step.name || 'tool',
    badge: call
      ? null
      : { text: step.ok === false ? 'error' : 'ok', error: step.ok === false },
    collapsed: step.collapsed === true,
    onToggle: () => {
      step.collapsed = step.collapsed !== true;
    },
  });
  if (!call && step.ok === false) card.classList.add('error');

  const body = el('div', 'card-body');
  const raw = call ? step.arguments : step.output;
  const structured = parseStructured(raw);
  if (structured) {
    body.append(jsonView(structured));
  } else {
    body.append(el('pre', 'tool-text', String(raw ?? '')));
  }
  card.append(body);
  return card;
}

function renderAgentMessage(msg) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  const rich = steps.some(
    (step) =>
      step.kind === 'text' || step.kind === 'call' || step.kind === 'result'
  );
  const streaming = state.streaming && msg === state.streamMessage;

  if (!rich) {
    // 旧消息或普通回复：一个卡片，旧的工具过程行显示在文字上方
    const card = makeCard({
      kind: 'agent',
      title: '对话',
      meta: '助手',
      collapsed: msg.collapsed === true,
      onToggle: () => {
        msg.collapsed = msg.collapsed !== true;
      },
    });
    const body = el('div', 'card-body');
    for (const step of steps) {
      if (step.kind !== 'status') continue;
      const line = el('div', 'card-status-line', step.label);
      if (step.ok === false) line.classList.add('error');
      body.append(line);
    }
    if (msg.text) body.append(el('div', 'card-text', msg.text));
    card.append(body);
    if (streaming) card.classList.add('streaming');
    appendRow(card);
    return;
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'text') {
      if (!step.text && !(streaming && i === steps.length - 1)) continue;
      appendRow(
        textCard({
          kind: 'agent',
          title: '对话',
          meta: '助手',
          text: step.text,
          collapsed: step.collapsed === true,
          onToggle: () => {
            step.collapsed = step.collapsed !== true;
          },
          streaming: streaming && i === steps.length - 1,
        })
      );
    } else if (step.kind === 'call' || step.kind === 'result') {
      appendRow(renderToolCard(step));
    }
  }
}

function renderMessages() {
  const session = currentSession();
  const stick = state.forceScroll || isNearBottom();
  const prevTop = dom.messages.scrollTop;
  state.forceScroll = false;

  dom.messages.replaceChildren();
  if (!session) {
    dom.messages.append(el('div', 'empty', 'No chats yet. Click New chat.'));
    return;
  }
  if (session.msgs.length === 0) {
    dom.messages.append(el('div', 'empty', 'No messages yet. Type below.'));
    return;
  }

  for (const msg of session.msgs) {
    if (msg.role === 'Agent') {
      renderAgentMessage(msg);
      continue;
    }

    appendRow(
      textCard({
        kind: 'user',
        title: '对话',
        meta: '你',
        text: msg.text,
        collapsed: msg.collapsed === true,
        onToggle: () => {
          msg.collapsed = msg.collapsed !== true;
        },
      })
    );
  }

  requestAnimationFrame(() => {
    if (stick) dom.messages.scrollTop = dom.messages.scrollHeight;
    else dom.messages.scrollTop = prevTop;
  });
}

function renderSessions() {
  dom.sessionList.replaceChildren();

  state.sessions.forEach((session, index) => {
    const row = el('div', 'session-row');
    if (index === state.current) row.classList.add('active');

    const title = el('span', 'session-title', session.title);
    const trash = el('button', 'trash');
    trash.type = 'button';
    trash.title = 'Delete chat';
    trash.setAttribute('aria-label', 'Delete chat');
    if (state.pendingDelete === index) trash.classList.add('armed');
    trash.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20M9 6V4H15V6M6 6L7 20H17L18 6M10 10V17M14 10V17"/></svg>';

    row.addEventListener('click', () => {
      if (state.streaming) {
        /* 允许切换查看，流仍指向原会话 */
      }
      state.pendingDelete = -1;
      clearTimeout(state.deleteTimer);
      state.current = index;
      state.forceScroll = true;
      saveChatsSoon();
      renderAll();
    });

    trash.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.pendingDelete === index) {
        state.pendingDelete = -1;
        clearTimeout(state.deleteTimer);
        deleteSession(index);
        return;
      }
      state.pendingDelete = index;
      clearTimeout(state.deleteTimer);
      state.deleteTimer = setTimeout(() => {
        state.pendingDelete = -1;
        renderSessions();
      }, 4000);
      renderSessions();
    });

    row.append(title, trash);
    dom.sessionList.append(row);
  });
}

function renderAll() {
  renderSessions();
  renderMessages();
  updateControls();
}

function updateSendState() {
  dom.send.disabled =
    !currentSession() || state.streaming || dom.input.value.trim() === '';
}

function newSession() {
  if (state.sessions.length === 0) state.seq = 0;
  state.seq += 1;
  state.sessions.push({
    title: `Chat ${state.seq}`,
    system: DEFAULT_SYSTEM_PROMPT,
    msgs: [],
  });
  state.current = state.sessions.length - 1;
  state.forceScroll = true;
  saveChatsSoon();
  renderAll();
  dom.input.focus();
}

function deleteSession(index) {
  if (index < 0 || index >= state.sessions.length) return;
  state.sessions.splice(index, 1);

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

function sendMessage() {
  if (state.streaming) return;
  const text = dom.input.value.trim();
  if (!text) return;

  const session = currentSession();
  if (!session) return;
  session.msgs.push({ role: 'User', text, request: null, steps: [] });
  const agent = { role: 'Agent', text: '', request: '', steps: [] };
  session.msgs.push(agent);

  state.streamMessage = agent;
  state.textOpen = false;
  state.forceScroll = true;
  dom.input.value = '';
  updateSendState();

  if (!state.settings.apiKey.trim()) {
    agent.text = NO_KEY_HINT;
    agent.request = null; // 本地提示不算模型历史
    agent.steps = [{ kind: 'status', label: 'local note (no API key)', ok: false }];
    state.streamMessage = null;
    state.textOpen = false;
    state.streaming = false;
    saveChatsSoon();
    renderAll();
    return;
  }

  state.streaming = true;
  state.requestId = makeId();
  renderAll();

  const history = session.msgs.slice(0, -1); // 不把空的助手占位发出去
  api.sendChat({
    requestId: state.requestId,
    apiKey: state.settings.apiKey,
    system: session.system || '',
    history,
  });
}

function finishStream() {
  state.streaming = false;
  state.requestId = null;
  state.streamMessage = null;
  state.textOpen = false;
  state.forceScroll = true;
  updateSendState();
  saveChatsSoon();
  renderAll();
}

function openSettings() {
  applySettings();
  dom.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsOverlay.classList.add('hidden');
  saveSettingsNow();
}

/* ---------------------------------------------------------------- window drag */
const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .session-row, .card-head, .overlay';

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

function onWindowDragStart(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DRAG_EXCLUDE)) return;
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  if (target instanceof HTMLElement && hitsScrollbar(target, event)) return;

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

function bindEvents() {
  // 整体禁用鼠标右键菜单与框选；只有输入控件保留文本选择
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (dom.settingsOverlay.classList.contains('hidden')) toggleSidebar();
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

  $('new-session').addEventListener('click', newSession);
  $('open-settings').addEventListener('click', openSettings);
  $('close-settings').addEventListener('click', closeSettings);
  $('done-settings').addEventListener('click', closeSettings);

  dom.send.addEventListener('click', sendMessage);
  dom.input.addEventListener('input', updateSendState);
  dom.input.addEventListener('keydown', (event) => {
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
    dom.apiKeyState.textContent = state.settings.apiKey ? 'set' : 'not set';
    saveSettingsSoon();
  });

  $('reset-settings').addEventListener('click', () => {
    state.settings = {
      apiKey: '',
      sidebarCollapsed: state.settings.sidebarCollapsed === true,
    };
    applySettings();
    saveSettingsSoon();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dom.settingsOverlay.classList.contains('hidden')) closeSettings();
  });

  // 点击遮罩空白处关闭；面板本身阻止冒泡
  dom.settingsOverlay.addEventListener('click', (event) => {
    if (event.target !== dom.settingsOverlay) return;
    closeSettings();
  });

  api.onChatDelta(({ requestId, text }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    const msg = state.streamMessage;
    msg.text += text;
    if (!Array.isArray(msg.steps)) msg.steps = [];

    const last = msg.steps[msg.steps.length - 1];
    if (state.textOpen && last && last.kind === 'text') {
      last.text += text;
    } else {
      msg.steps.push({ kind: 'text', text });
      state.textOpen = true;
    }

    state.forceScroll = true;
    renderMessages();
  });

  api.onChatToolCall(({ requestId, name, arguments: args }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      kind: 'call',
      name: String(name || 'tool'),
      arguments: String(args ?? ''),
    });
    state.textOpen = false;
    state.forceScroll = true;
    renderMessages();
  });

  api.onChatToolResult(({ requestId, name, output, ok }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      kind: 'result',
      name: String(name || 'tool'),
      output: String(output ?? ''),
      ok: ok !== false,
    });
    state.textOpen = false;
    state.forceScroll = true;
    renderMessages();
  });

  api.onChatDone(({ requestId, text }) => {
    if (requestId !== state.requestId) return;
    if (state.streamMessage && typeof text === 'string') {
      state.streamMessage.text = text;
    }
    finishStream();
  });

  api.onChatError(({ requestId, error }) => {
    if (requestId !== state.requestId) return;
    if (state.streamMessage) {
      const msg = state.streamMessage;
      const note = `[request failed] ${error}`;
      if (msg.text.trim()) {
        msg.text += `\n\n${note}`;
      } else {
        msg.text = note;
      }
      if (Array.isArray(msg.steps) && msg.steps.length > 0) {
        msg.steps.push({ kind: 'text', text: note });
      }
      msg.request = null;
    }
    finishStream();
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(state.saveTimer);
    clearTimeout(state.settingsTimer);
    api.saveChats({
      sessions: state.sessions,
      current: state.current,
      seq: state.seq,
    });
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
    state.sessions = chats.sessions;
    state.current = chats.current;
    state.seq = chats.seq;
  } catch (error) {
    console.error('load failed', error);
    state.sessions = [
      { title: 'Chat 1', system: DEFAULT_SYSTEM_PROMPT, msgs: [] },
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

  bindEvents();
  applySettings();
  renderAll();
  updateSendState();
  dom.input.focus();
}

boot();
