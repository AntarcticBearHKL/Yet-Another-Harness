'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are miniharness, a terse terminal coding assistant. Answer in plain text.';
const NO_KEY_HINT =
  'No OpenCode Go API key yet. Press Tab and open Settings to paste your key.';

const api = window.miniharness;
const $ = (id) => document.getElementById(id);

const dom = {
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  switcher: $('switcher'),
  switcherList: $('switcher-list'),
  switcherNew: $('switcher-new'),
  switcherSettings: $('switcher-settings'),
  switcherClose: $('switcher-close'),
  settingsOverlay: $('settings-overlay'),
  rawOverlay: $('raw-overlay'),
  rawBody: $('raw-body'),
  rawMeta: $('raw-meta'),
  apiKey: $('api-key'),
  apiKeyState: $('api-key-state'),
};

const state = {
  sessions: [],
  current: 0,
  seq: 1,
  settings: {
    apiKey: '',
  },
  switcherOpen: false,
  switcherIndex: 0,
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
  const { apiKey } = state.settings;
  return { apiKey };
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
}

function updateControls() {
  const session = currentSession();
  if (!session) {
    dom.input.disabled = true;
    dom.input.placeholder = 'Press Tab to create a chat';
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
    const collapsed = card.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
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

  if (typeof opts.onInspect === 'function') {
    card.title = 'Double-click to view raw request body';
    card.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      opts.onInspect();
    });
  }

  card.append(head);
  return card;
}

function textCard({
  kind,
  title,
  meta,
  text,
  collapsed,
  onToggle,
  streaming,
  onInspect,
}) {
  const card = makeCard({ kind, title, meta, collapsed, onToggle, onInspect });
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

function renderToolCard(step, msg) {
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
    onInspect: () => inspectStep(msg, step),
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
      onInspect: () => {
        openRawRequest(requestAt(msg, 0), rawRoundLabel(0));
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
          onInspect: () => inspectStep(msg, step),
        })
      );
    } else if (step.kind === 'call' || step.kind === 'result') {
      appendRow(renderToolCard(step, msg));
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
    dom.messages.append(el('div', 'empty', 'No chats yet. Press Tab to create one.'));
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
        onInspect: () => inspectUserMessage(msg),
      })
    );
  }

  requestAnimationFrame(() => {
    if (stick) dom.messages.scrollTop = dom.messages.scrollHeight;
    else dom.messages.scrollTop = prevTop;
  });
}

function sessionPreview(session) {
  for (let i = session.msgs.length - 1; i >= 0; i -= 1) {
    const text = String(session.msgs[i].text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.slice(0, 140);
  }
  return 'No messages yet';
}

function renderSwitcher() {
  dom.switcherList.replaceChildren();

  if (state.sessions.length === 0) {
    dom.switcherList.append(
      el('div', 'switcher-empty', 'No chats yet. Click New chat to start one.')
    );
    return;
  }

  state.switcherIndex = Math.max(
    0,
    Math.min(state.switcherIndex, state.sessions.length - 1)
  );

  state.sessions.forEach((session, index) => {
    const card = el('div', 'switch-card');
    if (index === state.current) card.classList.add('current');
    if (index === state.switcherIndex) card.classList.add('selected');

    const top = el('div', 'switch-top');
    top.append(el('span', 'switch-title', session.title || `Chat ${index + 1}`));
    if (index === state.current) {
      top.append(el('span', 'switch-badge', 'CURRENT'));
    }

    const preview = el('div', 'switch-preview', sessionPreview(session));
    const trash = el('button', 'trash switch-trash');
    trash.type = 'button';
    trash.title = 'Delete chat';
    trash.setAttribute('aria-label', 'Delete chat');
    if (state.pendingDelete === index) trash.classList.add('armed');
    trash.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20M9 6V4H15V6M6 6L7 20H17L18 6M10 10V17M14 10V17"/></svg>';

    card.addEventListener('click', () => selectSession(index));
    card.addEventListener('mouseenter', () => {
      if (state.switcherIndex === index) return;
      state.switcherIndex = index;
      dom.switcherList
        .querySelectorAll('.switch-card')
        .forEach((node, i) => node.classList.toggle('selected', i === index));
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
        renderSwitcher();
      }, 3000);
      renderSwitcher();
    });

    card.append(top, preview, trash);
    dom.switcherList.append(card);
  });

  if (state.switcherOpen) {
    const selected = dom.switcherList.querySelector('.switch-card.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }
}

function openSwitcher() {
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  state.switcherOpen = true;
  state.switcherIndex = state.current;
  state.pendingDelete = -1;
  dom.switcher.classList.remove('hidden');
  dom.input.blur();
  renderSwitcher();
}

function closeSwitcher() {
  if (!state.switcherOpen) return;
  state.switcherOpen = false;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  dom.switcher.classList.add('hidden');
  dom.input.focus();
}

function toggleSwitcher() {
  if (state.switcherOpen) closeSwitcher();
  else openSwitcher();
}

function moveSwitcher(delta) {
  if (state.sessions.length === 0) return;
  state.switcherIndex =
    (state.switcherIndex + delta + state.sessions.length) %
    state.sessions.length;
  renderSwitcher();
}

function selectSession(index) {
  if (index < 0 || index >= state.sessions.length) return;
  state.current = index;
  state.forceScroll = true;
  state.pendingDelete = -1;
  clearTimeout(state.deleteTimer);
  saveChatsSoon();
  closeSwitcher();
  renderAll();
}

function createChatFromSwitcher() {
  closeSwitcher();
  newSession();
}

function renderAll() {
  if (state.switcherOpen) renderSwitcher();
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
    id: makeId(),
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
  const agent = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
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
    chatId: session.id,
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
        'No raw request body recorded for this card. Capture starts with new messages.'
      )
    );
  }
  dom.input.blur();
  dom.rawOverlay.classList.remove('hidden');
}

function closeRawRequest() {
  dom.rawOverlay.classList.add('hidden');
  dom.input.focus();
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
  'button, a, input, textarea, select, label, [contenteditable="true"], .card-head, .overlay';

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

  dom.switcherNew.addEventListener('click', createChatFromSwitcher);
  dom.switcherSettings.addEventListener('click', () => {
    closeSwitcher();
    openSettings();
  });
  dom.switcherClose.addEventListener('click', closeSwitcher);

  $('close-settings').addEventListener('click', closeSettings);
  $('done-settings').addEventListener('click', closeSettings);
  $('close-raw').addEventListener('click', closeRawRequest);
  dom.rawOverlay.addEventListener('click', (event) => {
    if (event.target === dom.rawOverlay) closeRawRequest();
  });

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
    state.settings = { apiKey: '' };
    applySettings();
    saveSettingsSoon();
  });

  document.addEventListener('keydown', (event) => {
    if (!dom.rawOverlay.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRawRequest();
      }
      return;
    }

    if (event.key === 'Tab') {
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      toggleSwitcher();
      return;
    }

    if (!state.switcherOpen) {
      if (
        event.key === 'Escape' &&
        !dom.settingsOverlay.classList.contains('hidden')
      ) {
        closeSettings();
      }
      return;
    }

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
      if (target instanceof Element && target.closest('button, input, textarea')) {
        return;
      }
      event.preventDefault();
      selectSession(state.switcherIndex);
    }
  });

  // 点击遮罩空白处关闭；面板本身阻止冒泡
  dom.settingsOverlay.addEventListener('click', (event) => {
    if (event.target !== dom.settingsOverlay) return;
    closeSettings();
  });

  api.onChatDelta(({ requestId, text, round }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    const msg = state.streamMessage;
    msg.text += text;
    if (!Array.isArray(msg.steps)) msg.steps = [];

    const stepRound = Number.isInteger(round) ? round : 0;
    const last = msg.steps[msg.steps.length - 1];
    if (
      state.textOpen &&
      last &&
      last.kind === 'text' &&
      last.round === stepRound
    ) {
      last.text += text;
    } else {
      msg.steps.push({ kind: 'text', text, round: stepRound });
      state.textOpen = true;
    }

    state.forceScroll = true;
    renderMessages();
  });

  api.onChatRequest(({ requestId, round, body }) => {
    if (requestId !== state.requestId || !state.streamMessage) return;
    if (!body || typeof body !== 'object') return;
    const msg = state.streamMessage;
    if (!Array.isArray(msg.requests)) msg.requests = [];
    const index = Number.isInteger(round) ? round : 0;
    msg.requests[index] = body;
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
    state.textOpen = false;
    state.forceScroll = true;
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
      {
        id: makeId(),
        title: 'Chat 1',
        system: DEFAULT_SYSTEM_PROMPT,
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

  bindEvents();
  applySettings();
  renderAll();
  updateSendState();
  dom.input.focus();
}

boot();
