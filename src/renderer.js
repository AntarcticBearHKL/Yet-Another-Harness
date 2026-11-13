'use strict';

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const NO_KEY_HINT =
  'No OpenCode Go API key yet. Hold Tab and open Settings to paste your key.';

const api = window.yah;
const $ = (id) => document.getElementById(id);

const dom = {
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  switcher: $('switcher'),
  switcherList: $('switcher-list'),
  switcherNew: $('switcher-new'),
  switcherSettings: $('switcher-settings'),
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
  openCardKey: null,
  peekKey: null,
  peekKeys: new Set(),
  renderedOpenKeys: new Set(),
  renderedSessionId: null,
  renderVersion: 0,
  lastWheelNav: 0,
  spaceHeld: false,
  pointerX: 0,
  pointerY: 0,
  peekPointerX: 0,
  peekPointerY: 0,
  tabHeld: false,
  streaming: false,
  requestId: null,
  streamMessage: null,
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
    dom.input.placeholder = 'Hold Tab to create a chat';
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
  card.classList.toggle('collapsed', !expanded);
  const body = card.querySelector('.card-body-wrap');
  if (body) body.inert = !expanded;
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
    card.classList.toggle(
      'peek-target',
      state.spaceHeld && card.dataset.cardKey === state.peekKey
    );
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

function peekOpenKeys() {
  return new Set(state.peekKeys);
}

function makeCard(opts) {
  const card = el('div', `message-card ${opts.kind}`);
  card.dataset.cardKey = opts.key;
  card.classList.add('collapsed');

  const head = el('div', 'card-head');
  head.append(el('span', 'card-dot'));
  head.append(el('span', 'card-title', opts.title));
  head.append(el('span', 'card-meta', opts.meta || ''));
  if (opts.badge) {
    const badge = el('span', 'card-badge', opts.badge.text);
    if (opts.badge.error) badge.classList.add('error');
    head.append(badge);
  }

  card.title = opts.onInspect
    ? 'Hold Space to peek · double-click to view raw request body'
    : 'Hold Space to peek';

  if (typeof opts.onInspect === 'function') {
    card.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      opts.onInspect();
    });
  }

  const bodyWrap = el('div', 'card-body-wrap');
  bodyWrap.inert = true;
  const body = el('div', 'card-body');
  const inner = el('div', 'card-body-inner');
  body.append(inner);
  bodyWrap.append(body);
  card.append(head, bodyWrap);

  return { card, head, body: inner, bodyWrap };
}

function textCard({ key, kind, title, meta, text, streaming, onInspect }) {
  const { card, body } = makeCard({ key, kind, title, meta, onInspect });
  if (text) body.append(el('div', 'card-text', text));
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

function renderToolCard(step, msg, key) {
  const call = step.kind === 'call';
  const { card, body } = makeCard({
    key,
    kind: call ? 'tool-call' : 'tool-result',
    title: call ? '工具调用' : '工具返回',
    meta: step.name || 'tool',
    badge: call
      ? null
      : { text: step.ok === false ? 'error' : 'ok', error: step.ok === false },
    onInspect: () => inspectStep(msg, step),
  });
  if (!call && step.ok === false) card.classList.add('error');

  const raw = call ? step.arguments : step.output;
  const structured = parseStructured(raw);
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
    return stepCardKey(index, steps.length - 1);
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

function renderAgentMessage(msg, msgIndex) {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  const rich = isRichTrace(steps);
  const streaming = state.streaming && msg === state.streamMessage;

  if (!rich) {
    // 旧消息或普通回复：一个卡片，旧的工具过程行显示在文字上方
    const { card, body } = makeCard({
      key: agentCardKey(msgIndex),
      kind: 'agent',
      title: '对话',
      meta: 'response',
      onInspect: () => {
        openRawRequest(requestAt(msg, 0), rawRoundLabel(0));
      },
    });
    for (const step of steps) {
      if (step.kind !== 'status') continue;
      const line = el('div', 'card-status-line', step.label);
      if (step.ok === false) line.classList.add('error');
      body.append(line);
    }
    if (msg.text) body.append(el('div', 'card-text', msg.text));
    if (streaming) card.classList.add('streaming');
    appendRow(card);
    return;
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'text' || step.kind === 'thinking') {
      if (!step.text && !(streaming && i === steps.length - 1)) continue;
      const thinking = step.kind === 'thinking';
      appendRow(
        textCard({
          key: stepCardKey(msgIndex, i),
          kind: thinking ? 'thinking' : 'agent',
          title: thinking ? '思考' : '对话',
          meta: thinking ? 'thinking' : 'response',
          text: step.text,
          streaming: streaming && i === steps.length - 1,
          onInspect: () => inspectStep(msg, step),
        })
      );
    } else if (step.kind === 'call' || step.kind === 'result') {
      appendRow(renderToolCard(step, msg, stepCardKey(msgIndex, i)));
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
  const stick = !state.peekKey && (state.forceScroll || isNearBottom());
  state.forceScroll = false;

  dom.messages.replaceChildren();
  if (!session) {
    state.openCardKey = null;
    state.peekKey = null;
    state.peekKeys.clear();
    state.spaceHeld = false;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = null;
    dom.messages.append(el('div', 'empty', 'No chats yet. Hold Tab to create one.'));
    return;
  }
  if (session.msgs.length === 0) {
    state.openCardKey = null;
    state.peekKey = null;
    state.peekKeys.clear();
    state.spaceHeld = false;
    state.renderedOpenKeys = new Set();
    state.renderedSessionId = sessionId;
    dom.messages.append(el('div', 'empty', 'No messages yet. Type below.'));
    return;
  }

  session.msgs.forEach((msg, index) => {
    if (msg.role === 'Agent') {
      renderAgentMessage(msg, index);
      return;
    }

    appendRow(
      textCard({
        key: messageCardKey(index),
        kind: 'user',
        title: '对话',
        meta: 'prompt',
        text: msg.text,
        onInspect: () => inspectUserMessage(msg),
      })
    );
  });

  const autoKey = autoCardKey();
  state.openCardKey = autoKey;
  const cards = [...dom.messages.querySelectorAll('.message-card')];
  const cardKeys = new Set(cards.map((card) => card.dataset.cardKey));

  for (const key of [...state.peekKeys]) {
    if (!cardKeys.has(key)) state.peekKeys.delete(key);
  }
  if (state.peekKey && !cardKeys.has(state.peekKey)) {
    state.peekKey = null;
  }

  const targetKeys =
    state.peekKeys.size > 0 ? new Set(state.peekKeys) : openKeySet(autoKey);
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
        const latest =
          state.peekKeys.size > 0
            ? peekOpenKeys()
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
    if (state.peekKey) return;
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

function cancelTabHold() {
  state.tabHeld = false;
}

function cardAtPointer() {
  const element = document.elementFromPoint(state.pointerX, state.pointerY);
  if (!(element instanceof Element)) return null;
  return element.closest('.message-card');
}

function applyPeekKeysKeepingScroll() {
  const top = dom.messages.scrollTop;
  applyOpenKeys(peekOpenKeys());
  if (dom.messages.scrollTop !== top) dom.messages.scrollTop = top;
}

function startSpacePeek(card) {
  const key = card && card.dataset.cardKey;
  if (!key) return;
  state.spaceHeld = true;
  state.peekKey = key;
  state.peekKeys.add(key);

  // 保留当前展开的条目，预览期间只增加内容高度，不折叠已有内容，
  // 这样滚动条不会因为 maxScroll 变小而被浏览器夹回去。
  if (state.openCardKey) state.peekKeys.add(state.openCardKey);

  state.peekPointerX = state.pointerX;
  state.peekPointerY = state.pointerY;
  applyPeekKeysKeepingScroll();
}

function endSpacePeek() {
  if (!state.spaceHeld && state.peekKeys.size === 0) return;
  state.spaceHeld = false;
  state.peekKey = null;
  state.peekKeys.clear();
  const top = dom.messages.scrollTop;
  applyOpenKeys(openKeySet(state.openCardKey));
  if (dom.messages.scrollTop !== top) dom.messages.scrollTop = top;
}

function handlePointerMove(event) {
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  if (!state.spaceHeld) return;

  if (
    Math.abs(state.pointerX - state.peekPointerX) < 6 &&
    Math.abs(state.pointerY - state.peekPointerY) < 6
  ) {
    return;
  }

  const card = cardAtPointer();
  const key = card && card.dataset.cardKey;
  if (!key || key === state.peekKey) return;

  state.peekKey = key;
  state.peekKeys.add(key);

  state.peekPointerX = state.pointerX;
  state.peekPointerY = state.pointerY;
  applyPeekKeysKeepingScroll();
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
  state.peekKey = null;
  state.peekKeys.clear();
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

function openSwitcher() {
  if (!dom.settingsOverlay.classList.contains('hidden')) return;
  endSpacePeek();
  state.switcherOpen = true;
  state.switcherIndex = state.current;
  state.pendingDelete = -1;
  dom.input.blur();
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
  dom.input.focus();
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
  endSpacePeek();
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
  endSpacePeek();
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
  endSpacePeek();
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
  endSpacePeek();

  const session = currentSession();
  if (!session) return;
  session.msgs.push({ role: 'User', text, request: null, steps: [] });
  const agent = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
  session.msgs.push(agent);

  state.streamMessage = agent;
  state.forceScroll = true;
  dom.input.value = '';
  updateSendState();

  if (!state.settings.apiKey.trim()) {
    agent.text = NO_KEY_HINT;
    agent.request = null; // 本地提示不算模型历史
    agent.steps = [{ kind: 'status', label: 'local note (no API key)', ok: false }];
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
    chatId: session.id,
    apiKey: state.settings.apiKey,
    system: session.system || '',
    history,
  });
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
  if (state.peekKey || state.peekKeys.size > 0) {
    applyPeekKeysKeepingScroll();
  } else {
    applyOpenKey(state.openCardKey);
  }

  updateSendState();
  saveChatsSoon();
  if (state.switcherOpen) renderSwitcher();

  if (!state.peekKey && stick) {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }
}

function openRawRequest(body, label) {
  endSpacePeek();
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
  endSpacePeek();
  applySettings();
  dom.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsOverlay.classList.add('hidden');
  saveSettingsNow();
}

/* ---------------------------------------------------------------- window drag */
const DRAG_EXCLUDE =
  'button, a, input, textarea, select, label, [contenteditable="true"], .switch-card';

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
  const overlay = target.closest('.overlay');
  if (overlay && overlay !== dom.switcher) return;
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
  // 整体禁用鼠标右键菜单与框选；有弹窗时右键等于关闭
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
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
    }
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
      if (state.switcherOpen) return;
      if (event.repeat || state.tabHeld) return;

      endSpacePeek();
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
        selectSession(state.switcherIndex);
      }
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      if (event.repeat || state.spaceHeld) return;
      const active = document.activeElement;
      const target = event.target;
      const inEditable =
        (target instanceof Element &&
          target.closest(
            'input, textarea, [contenteditable="true"]'
          )) ||
        (active instanceof Element &&
          active.closest(
            'input, textarea, [contenteditable="true"]'
          ));
      if (inEditable) {
        const emptyComposer = active === dom.input && dom.input.value === '';
        if (!emptyComposer) return;
      }
      if (
        target instanceof Element &&
        target.closest('button, a, select')
      ) {
        return;
      }
      if (
        active instanceof Element &&
        active.closest('button, a, select')
      ) {
        return;
      }
      const card = cardAtPointer();
      if (!card) return;
      event.preventDefault();
      startSpacePeek(card);
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Tab') {
      if (!state.tabHeld) return;
      cancelTabHold();
      if (!dom.settingsOverlay.classList.contains('hidden')) return;
      event.preventDefault();
      if (state.switcherOpen) closeSwitcher();
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      if (!state.spaceHeld) return;
      event.preventDefault();
      endSpacePeek();
    }
  });

  document.addEventListener('mousemove', handlePointerMove);
  document.addEventListener('mousedown', (event) => {
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  });

  window.addEventListener('blur', () => {
    cancelTabHold();
    endSpacePeek();
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
      if (state.spaceHeld) return;

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
    textNode.textContent = last.text;
    card.classList.add('streaming');

    const stick = isNearBottom();
    state.forceScroll = false;
    state.openCardKey = key;
    if (state.peekKey) {
      applyPeekKeysKeepingScroll();
    } else if (
      state.renderedOpenKeys.size !== 1 ||
      !state.renderedOpenKeys.has(key)
    ) {
      applyOpenKey(key);
    }
    if (stick && !state.peekKey) {
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
      api.saveChatsSync({
        sessions: state.sessions,
        current: state.current,
        seq: state.seq,
      });
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
