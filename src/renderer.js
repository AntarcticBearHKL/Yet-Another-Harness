'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are miniharness, a terse terminal coding assistant. Answer in plain text.';
const NO_KEY_HINT =
  'No DeepSeek API key yet. Open Settings at the bottom of the sidebar and paste your key to start chatting.';

const api = window.miniharness;
const $ = (id) => document.getElementById(id);

const dom = {
  sidebar: $('sidebar'),
  toggleSidebar: $('toggle-sidebar'),
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  sessionList: $('session-list'),
  settingsOverlay: $('settings-overlay'),
  transparency: $('transparency'),
  transparencyValue: $('transparency-value'),
  apiKey: $('api-key'),
  apiKeyState: $('api-key-state'),
};

const state = {
  sessions: [],
  current: 0,
  seq: 1,
  settings: {
    transparency: 25,
    blur: 100,
    apiKey: '',
    sidebarCollapsed: false,
  },
  sidebarCollapsed: false,
  streaming: false,
  requestId: null,
  streamMessage: null,
  pendingDelete: -1,
  deleteTimer: null,
  saveTimer: null,
  settingsTimer: null,
  forceScroll: true,
};

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
  const { transparency, apiKey, sidebarCollapsed } = state.settings;
  return { transparency, apiKey, sidebarCollapsed };
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
  document.documentElement.style.setProperty(
    '--tint-alpha',
    String(Math.max(0, Math.min(1, 1 - s.transparency / 100)))
  );
  dom.transparency.value = String(s.transparency);
  dom.transparencyValue.textContent = `${Math.round(s.transparency)}%`;

  dom.apiKeyState.textContent = s.apiKey ? 'set' : 'not set';
  if (document.activeElement !== dom.apiKey) {
    dom.apiKey.value = s.apiKey;
  }
  applySidebar();
}

function applySidebar() {
  state.sidebarCollapsed = state.settings.sidebarCollapsed === true;
  dom.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  dom.toggleSidebar.setAttribute(
    'aria-expanded',
    String(!state.sidebarCollapsed)
  );
  dom.toggleSidebar.title = state.sidebarCollapsed
    ? 'Expand sidebar'
    : 'Collapse sidebar';
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

function renderMessages() {
  const session = currentSession();
  const stick = state.forceScroll || isNearBottom();
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
    const row = el('div', 'msg');
    const bubble = el(
      'div',
      `bubble ${msg.role === 'Agent' ? 'agent' : 'user'}`
    );

    if (Array.isArray(msg.steps) && msg.steps.length > 0) {
      const steps = el('div', 'bubble-steps');
      for (const step of msg.steps) {
        const line = el('div', 'bubble-step', step.label);
        if (step.ok === false) line.classList.add('error');
        steps.append(line);
      }
      bubble.append(steps);
    }

    if (msg.text) {
      bubble.append(el('div', 'bubble-text', msg.text));
    }

    if (state.streaming && msg === state.streamMessage) {
      bubble.classList.add('streaming');
    }
    row.append(bubble);
    dom.messages.append(row);
  }

  if (stick) {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }
}

function renderSessions() {
  dom.sessionList.replaceChildren();

  state.sessions.forEach((session, index) => {
    const row = el('div', 'session-row');
    if (index === state.current) row.classList.add('active');

    const title = el('span', 'session-title', session.title);
    const count = el('span', 'session-count', String(session.msgs.length));
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

    row.append(title, count, trash);
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
  state.forceScroll = true;
  dom.input.value = '';
  updateSendState();

  if (!state.settings.apiKey.trim()) {
    agent.text = NO_KEY_HINT;
    agent.request = null; // 本地提示不算模型历史
    agent.steps = [{ label: 'local note (no API key)', ok: false }];
    state.streamMessage = null;
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

function bindEvents() {
  // 整体禁用鼠标右键菜单与框选；只有输入控件保留文本选择
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  document.addEventListener('selectstart', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea')) return;
    event.preventDefault();
  });

  dom.toggleSidebar.addEventListener('click', () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    applySidebar();
    saveSettingsSoon();
  });

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

  dom.transparency.addEventListener('input', () => {
    state.settings.transparency = Number(dom.transparency.value);
    applySettings();
    saveSettingsSoon();
  });
  dom.apiKey.addEventListener('input', () => {
    state.settings.apiKey = dom.apiKey.value;
    dom.apiKeyState.textContent = state.settings.apiKey ? 'set' : 'not set';
    saveSettingsSoon();
  });

  $('reset-settings').addEventListener('click', () => {
    state.settings = {
      transparency: 25,
      blur: 100,
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
    state.streamMessage.text += text;
    state.forceScroll = true;
    renderMessages();
  });

  api.onChatTool(({ requestId, label, ok }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!Array.isArray(state.streamMessage.steps)) {
      state.streamMessage.steps = [];
    }
    state.streamMessage.steps.push({
      label: String(label || 'tool'),
      ok: ok !== false,
    });
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
      if (state.streamMessage.text.trim()) {
        state.streamMessage.text += `\n\n[request failed] ${error}`;
      } else {
        state.streamMessage.text = `[request failed] ${error}`;
      }
      state.streamMessage.request = null;
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
