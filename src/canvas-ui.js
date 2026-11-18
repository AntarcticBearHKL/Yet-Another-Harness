'use strict';

const canvasDom = {
  overlay: document.getElementById('canvas'),
  stage: document.getElementById('canvas-stage'),
  grid: document.getElementById('canvas-grid'),
  world: document.getElementById('canvas-world'),
  zoomLayer: document.getElementById('canvas-zoom'),
  frames: document.getElementById('canvas-frames'),
  nodes: document.getElementById('canvas-nodes'),
  marquee: document.getElementById('canvas-marquee'),
  empty: document.getElementById('canvas-empty'),
  zoomIndicator: document.getElementById('canvas-zoom-indicator'),
  page: document.getElementById('canvas-workspaces-page'),
  workspaces: document.getElementById('canvas-workspaces'),
  addWorkspace: document.getElementById('canvas-add-workspace'),
};

const CANVAS_GROUP_WIDTH = 300;
const CANVAS_GROUP_HEIGHT = 120;
const CANVAS_MANAGER_CARD_SIZE = 180;
const CANVAS_MANAGER_GROUP_WIDTH = 620;
const CANVAS_MANAGER_GROUP_HEIGHT = 420;
const CANVAS_MANAGER_GROUP_PADDING = 20;
const CANVAS_FRAME_PADDING = 32;
const CANVAS_MIN_ZOOM = 0.2;
const CANVAS_MAX_ZOOM = 3;
const CANVAS_WORKSPACE_COLORS = [
  '#b96f3d',
  '#6f8a5c',
  '#8a6f9e',
  '#5d7f9e',
  '#b08a4a',
  '#a66f74',
];
const CANVAS_FOLDER_ICON =
  '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>';
const CANVAS_MANAGER_ICON =
  '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="2.6"/>';

const canvasState = {
  open: false,
  loaded: false,
  loading: false,
  pageOpen: false,
  view: { x: 0, y: 0, k: 1 },
  nodes: {},
  frames: [],
  systemNodes: [],
  selectedId: null,
  selectedChildId: null,
  selectedIds: new Set(),
  drag: null,
  managerDrag: null,
  frameDrag: null,
  marquee: null,
  pan: null,
  workspaceDrag: null,
  backgroundBySession: {},
  backgroundFetched: {},
  running: new Set(),
  runsTimer: null,
  runsRequest: 0,
  runsDirty: false,
  pendingWorknodes: false,
  saveTimer: null,
  pageTimer: null,
  zoomTimer: null,
  request: 0,
  suppressClick: false,
};

function canvasNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canvasClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function canvasNormalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    x: canvasNumber(source.x, 0),
    y: canvasNumber(source.y, 0),
    k: canvasClamp(canvasNumber(source.k, 1), CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM),
  };
}

function canvasWorkspaceFor(session) {
  return (
    state.projects.find((project) => project.id === session?.projectId) || null
  );
}

function canvasWorkspaceColor(project) {
  const index = state.projects.findIndex((item) => item.id === project?.id);
  return CANVAS_WORKSPACE_COLORS[
    Math.max(0, index) % CANVAS_WORKSPACE_COLORS.length
  ];
}

function canvasWorkspaceSessionCount(projectId) {
  return state.sessions.filter((session) => session.projectId === projectId)
    .length;
}

function canvasAgentName(session) {
  const agent = state.agents.find(
    (item) => item.id === (session?.agentId || DEFAULT_AGENT_ID)
  );
  return agent?.name || session?.agentId || 'Build';
}

function canvasConversationStatus(session) {
  if (!session) return { label: '空白', tone: 'idle' };
  if (session === currentSession() && state.streaming) {
    return { label: '运行中', tone: 'running' };
  }
  if (session.goal?.status === 'active') {
    return { label: '目标中', tone: 'running' };
  }
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  const last = messages[messages.length - 1];
  if (!last) return { label: '空白', tone: 'idle' };
  if (last.role === 'Agent' && String(last.text || '').trim()) {
    return { label: '完成', tone: 'done' };
  }
  if (last.role === 'User') return { label: '等待', tone: 'idle' };
  return { label: '进行中', tone: 'running' };
}

function canvasPreviewText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canvasSessionPreview(session) {
  if (
    session === currentSession() &&
    state.streaming &&
    state.streamMessage
  ) {
    const currentText = String(state.streamMessage.text || '').trim();
    if (currentText) return canvasPreviewText(currentText);
    const steps = Array.isArray(state.streamMessage.steps)
      ? state.streamMessage.steps
      : [];
    const lastStep = [...steps]
      .reverse()
      .find((step) => String(step.text || '').trim());
    if (lastStep) return canvasPreviewText(lastStep.text);
  }
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  const last = [...messages]
    .reverse()
    .find((message) => String(message.text || '').trim());
  return canvasPreviewText(last?.text) || '还没有消息';
}

/* ------------------------------- 分组模型 ------------------------------- */

function canvasGroupIndex() {
  const sessions = Array.isArray(state.sessions)
    ? state.sessions.filter((session) => !session.archivedAt)
    : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  let dirty = false;
  for (const session of sessions) {
    if (session.parentSessionId) continue;
    const storedParent = canvasState.nodes[session.id]?.parentSessionId;
    if (storedParent && byId.has(storedParent)) {
      session.parentSessionId = storedParent;
      continue;
    }
    if (!session.subagent) continue;
    const index = sessions.indexOf(session);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (!sessions[i].subagent) {
        session.parentSessionId = sessions[i].id;
        dirty = true;
        break;
      }
    }
  }
  const rootFor = (session) => {
    let current = session;
    const seen = new Set();
    while (
      current?.parentSessionId &&
      byId.has(current.parentSessionId) &&
      !seen.has(current.id)
    ) {
      seen.add(current.id);
      current = byId.get(current.parentSessionId);
    }
    return current || session;
  };
  const roots = [];
  const childrenByRoot = new Map();
  for (const session of sessions) {
    const root = rootFor(session);
    if (root.id === session.id) {
      roots.push(session);
    } else {
      let list = childrenByRoot.get(root.id);
      if (!list) {
        list = [];
        childrenByRoot.set(root.id, list);
      }
      list.push(session);
    }
  }
  return { sessions, roots, childrenByRoot, rootFor, dirty };
}

function ensureCanvasGroups() {
  const index = canvasGroupIndex();
  const { sessions, roots } = index;
  const ids = new Set(sessions.map((session) => session.id));
  let dirty = index.dirty;
  if (canvasState.frames.length > 0) {
    canvasState.frames = [];
    dirty = true;
  }
  for (const id of Object.keys(canvasState.nodes)) {
    if (!ids.has(id)) {
      delete canvasState.nodes[id];
      dirty = true;
    }
  }
  for (const session of sessions) {
    if (!session.parentSessionId) continue;
    let node = canvasState.nodes[session.id];
    if (!node) {
      node = canvasState.nodes[session.id] = {
        x: 0,
        y: 0,
        width: CANVAS_GROUP_WIDTH,
        height: CANVAS_GROUP_HEIGHT,
        parentSessionId: session.parentSessionId,
      };
      dirty = true;
    } else if (node.parentSessionId !== session.parentSessionId) {
      node.parentSessionId = session.parentSessionId;
      dirty = true;
    }
  }
  let rootIndex = 0;
  for (const root of roots) {
    let node = canvasState.nodes[root.id];
    if (!node) {
      const col = rootIndex % 3;
      const row = Math.floor(rootIndex / 3);
      node = canvasState.nodes[root.id] = {
        x: 80 + col * 480,
        y: 80 + row * 360,
        width: CANVAS_GROUP_WIDTH,
        height: CANVAS_GROUP_HEIGHT,
        parentSessionId: null,
      };
      dirty = true;
    } else if (node.parentSessionId) {
      node.parentSessionId = null;
      dirty = true;
    }
    rootIndex += 1;
  }
  if (dirty) scheduleCanvasSave();
  return index;
}

function canvasGroupSessionIds(rootId) {
  const index = canvasGroupIndex();
  return index.sessions
    .filter((session) => index.rootFor(session).id === rootId)
    .map((session) => session.id);
}

function canvasGroupJobs(root, children) {
  const jobs = [];
  for (const session of [root, ...children]) {
    const list = canvasState.backgroundBySession[session.id];
    if (Array.isArray(list)) jobs.push(...list);
  }
  return jobs
    .filter((job) => job.status === 'running')
    .sort((left, right) => {
      const leftRunning = left.status === 'running' ? 0 : 1;
      const rightRunning = right.status === 'running' ? 0 : 1;
      if (leftRunning !== rightRunning) return leftRunning - rightRunning;
      return (right.startedAt || 0) - (left.startedAt || 0);
    });
}

/* -------------------------------- 分组框 -------------------------------- */

function canvasFrameBounds(frame) {
  const nodes = frame.nodeIds
    .map((id) => canvasState.nodes[id])
    .filter(Boolean);
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    x: minX - CANVAS_FRAME_PADDING,
    y: minY - CANVAS_FRAME_PADDING,
    width: maxX - minX + CANVAS_FRAME_PADDING * 2,
    height: maxY - minY + CANVAS_FRAME_PADDING * 2,
  };
}

function buildCanvasFrame(frame) {
  const bounds = canvasFrameBounds(frame);
  if (!bounds) return null;
  const frameEl = el('div', 'canvas-frame');
  frameEl.dataset.frameId = frame.id;
  frameEl.style.left = `${bounds.x}px`;
  frameEl.style.top = `${bounds.y}px`;
  frameEl.style.width = `${bounds.width}px`;
  frameEl.style.height = `${bounds.height}px`;

  const label = el('div', 'canvas-frame-label');
  label.append(el('span', 'canvas-frame-dot'));
  label.append(el('span', 'canvas-frame-title', 'GROUP'));
  label.append(el('span', 'canvas-frame-count', String(frame.nodeIds.length)));
  frameEl.append(label);

  frameEl.addEventListener('pointerdown', (event) =>
    startCanvasFrameDrag(event, frame, frameEl)
  );
  frameEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  return frameEl;
}

function renderCanvasFrames() {
  if (!canvasDom.frames) return;
  const valid = new Set(
    [...canvasDom.nodes.querySelectorAll('.canvas-group')]
      .map((group) => group.dataset.sessionId)
      .filter(Boolean)
  );
  let changed = false;
  const next = [];
  for (const frame of canvasState.frames) {
    const nodeIds = frame.nodeIds.filter((id) => valid.has(id));
    if (nodeIds.length !== frame.nodeIds.length) changed = true;
    if (nodeIds.length === 0) {
      changed = true;
      continue;
    }
    frame.nodeIds = nodeIds;
    next.push(frame);
  }
  canvasState.frames = next;
  canvasDom.frames.replaceChildren();
  for (const frame of canvasState.frames) {
    const frameEl = buildCanvasFrame(frame);
    if (frameEl) canvasDom.frames.append(frameEl);
  }
  if (changed) scheduleCanvasSave();
}

function updateCanvasFrameElements() {
  if (!canvasDom.frames) return;
  for (const frame of canvasState.frames) {
    const frameEl = canvasDom.frames.querySelector(
      `[data-frame-id="${frame.id}"]`
    );
    if (!frameEl) continue;
    const bounds = canvasFrameBounds(frame);
    if (!bounds) continue;
    frameEl.style.left = `${bounds.x}px`;
    frameEl.style.top = `${bounds.y}px`;
    frameEl.style.width = `${bounds.width}px`;
    frameEl.style.height = `${bounds.height}px`;
  }
}

function createCanvasFrameFromSelection() {
  const ids = new Set(canvasSelectedNodeIds());
  if (ids.size < 2) return;
  let frame = { nodeIds: [...ids] };
  let bounds = canvasFrameBounds(frame);
  if (!bounds) return;
  let changed = true;
  while (changed) {
    changed = false;
    for (const root of canvasGroupIndex().roots) {
      if (ids.has(root.id)) continue;
      const node = canvasState.nodes[root.id];
      if (!node) continue;
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      if (
        centerX >= bounds.x &&
        centerX <= bounds.x + bounds.width &&
        centerY >= bounds.y &&
        centerY <= bounds.y + bounds.height
      ) {
        ids.add(root.id);
        changed = true;
      }
    }
    if (changed) {
      frame = { nodeIds: [...ids] };
      bounds = canvasFrameBounds(frame);
    }
  }
  for (const existing of canvasState.frames) {
    existing.nodeIds = existing.nodeIds.filter((id) => !ids.has(id));
  }
  canvasState.frames = canvasState.frames.filter(
    (existing) => existing.nodeIds.length > 0
  );
  const id = `frame-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  canvasState.frames.push({ id, nodeIds: [...ids] });
  renderCanvasFrames();
  scheduleCanvasSave();
  canvasClearSelection();
}

function removeCanvasFrame(frameId) {
  const next = canvasState.frames.filter((frame) => frame.id !== frameId);
  if (next.length === canvasState.frames.length) return;
  canvasState.frames = next;
  renderCanvasFrames();
  scheduleCanvasSave();
}

function openCanvasFrameMenu(frameId, x, y) {
  const frame = canvasState.frames.find((item) => item.id === frameId);
  if (!frame) return;
  openActionMenu({
    x,
    y,
    items: [
      {
        label: 'Ungroup',
        icon: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8l8 8M16 8l-8 8"/>',
        action: () => removeCanvasFrame(frameId),
      },
    ],
  });
}

function startCanvasFrameDrag(event, frame, frameEl) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const nodes = [];
  for (const id of frame.nodeIds) {
    const node = canvasState.nodes[id];
    if (!node) continue;
    const groupEl = canvasDom.nodes.querySelector(
      `.canvas-group[data-session-id="${CSS.escape(id)}"]`
    );
    if (!groupEl) continue;
    nodes.push({
      node,
      groupEl,
      originX: node.x,
      originY: node.y,
    });
  }
  if (nodes.length === 0) return;
  canvasState.frameDrag = {
    frame,
    frameEl,
    nodes,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    pointerId: event.pointerId,
  };
  frameEl.classList.add('dragging');
  try {
    frameEl.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  event.preventDefault();
}

/* -------------------------------- 框选 ---------------------------------- */

function renderCanvasMarquee(marquee) {
  if (!canvasDom.marquee) return;
  const left = Math.min(marquee.startX, marquee.currentX);
  const top = Math.min(marquee.startY, marquee.currentY);
  const width = Math.abs(marquee.currentX - marquee.startX);
  const height = Math.abs(marquee.currentY - marquee.startY);
  canvasDom.marquee.style.left = `${left}px`;
  canvasDom.marquee.style.top = `${top}px`;
  canvasDom.marquee.style.width = `${width}px`;
  canvasDom.marquee.style.height = `${height}px`;
  canvasDom.marquee.classList.remove('hidden');
}

function updateCanvasMarqueeSelection(marquee) {
  if (!canvasDom.stage) return;
  const stageRect = canvasDom.stage.getBoundingClientRect();
  const left = stageRect.left + Math.min(marquee.startX, marquee.currentX);
  const top = stageRect.top + Math.min(marquee.startY, marquee.currentY);
  const right = stageRect.left + Math.max(marquee.startX, marquee.currentX);
  const bottom = stageRect.top + Math.max(marquee.startY, marquee.currentY);
  const selected = new Set(marquee.additive ? marquee.base : []);
  for (const group of canvasDom.nodes.querySelectorAll('.canvas-group')) {
    const rect = group.getBoundingClientRect();
    const intersects =
      rect.left < right &&
      rect.right > left &&
      rect.top < bottom &&
      rect.bottom > top;
    if (intersects && group.dataset.sessionId) {
      selected.add(group.dataset.sessionId);
    }
  }
  canvasState.selectedIds = selected;
  canvasState.selectedId = selected.size === 1 ? [...selected][0] : null;
  canvasState.selectedChildId = null;
  canvasApplySelection();
}

function startCanvasMarquee(event) {
  if (!canvasDom.stage) return;
  const rect = canvasDom.stage.getBoundingClientRect();
  const startX = event.clientX - rect.left;
  const startY = event.clientY - rect.top;
  canvasState.marquee = {
    startX,
    startY,
    currentX: startX,
    currentY: startY,
    moved: false,
    pointerId: event.pointerId,
    additive: event.shiftKey,
    base: event.shiftKey ? new Set(canvasState.selectedIds) : new Set(),
  };
  if (!event.shiftKey) canvasClearSelection();
  canvasDom.stage.classList.add('marquee');
  try {
    canvasDom.stage.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  event.preventDefault();
}

function updateCanvasMarquee(event) {
  const marquee = canvasState.marquee;
  if (!marquee || !canvasDom.stage) return;
  const rect = canvasDom.stage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (
    !marquee.moved &&
    Math.abs(x - marquee.startX) + Math.abs(y - marquee.startY) < 3
  ) {
    return;
  }
  marquee.moved = true;
  marquee.currentX = x;
  marquee.currentY = y;
  renderCanvasMarquee(marquee);
  updateCanvasMarqueeSelection(marquee);
  event.preventDefault();
}

function finishCanvasMarquee() {
  const marquee = canvasState.marquee;
  if (!marquee) return;
  if (marquee.moved) {
    canvasState.suppressClick = true;
    setTimeout(() => {
      canvasState.suppressClick = false;
    }, 80);
  }
  canvasState.marquee = null;
  canvasDom.marquee?.classList.add('hidden');
  canvasDom.stage?.classList.remove('marquee');
  try {
    canvasDom.stage?.releasePointerCapture(marquee.pointerId);
  } catch {
    /* ignore */
  }
}

/* ------------------------------- 后台任务 ------------------------------- */

function canvasJobSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    sessionId: job.sessionId,
    note: job.note,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

function mergeCanvasBackgroundJob(job) {
  const summary = canvasJobSummary(job);
  const sessionId = String(summary?.sessionId || '');
  if (!sessionId || !summary?.id) return;
  const list = Array.isArray(canvasState.backgroundBySession[sessionId])
    ? canvasState.backgroundBySession[sessionId]
    : [];
  const index = list.findIndex((item) => item.id === summary.id);
  if (index >= 0) list[index] = { ...list[index], ...summary };
  else list.push(summary);
  canvasState.backgroundBySession[sessionId] = list;
  canvasState.backgroundFetched[sessionId] = Date.now();
}

async function loadCanvasBackground({ force = false } = {}) {
  if (!canvasOverlayOpen()) return;
  const index = canvasGroupIndex();
  const now = Date.now();
  const targets = index.sessions
    .map((session) => session.id)
    .filter((id) => {
      const list = canvasState.backgroundBySession[id];
      if (!Array.isArray(list)) return true;
      const fetchedAt = canvasState.backgroundFetched[id] || 0;
      const running = list.some((job) => job.status === 'running');
      return force || (running && now - fetchedAt > 3000);
    });
  if (targets.length === 0) return;
  for (const id of targets) canvasState.backgroundFetched[id] = now;
  await Promise.allSettled(
    targets.map(async (id) => {
      try {
        const data = await api.loadBackground(id);
        canvasState.backgroundBySession[id] = Array.isArray(data?.jobs)
          ? data.jobs.map(canvasJobSummary).filter(Boolean)
          : [];
      } catch {
        canvasState.backgroundBySession[id] =
          canvasState.backgroundBySession[id] || [];
      }
    })
  );
  if (!canvasOverlayOpen()) return;
  if (
    canvasState.drag ||
    canvasState.frameDrag ||
    canvasState.marquee ||
    canvasState.workspaceDrag
  ) {
    return;
  }
  renderCanvas();
}

async function loadCanvasRuns() {
  if (!canvasOverlayOpen()) return;
  const request = ++canvasState.runsRequest;
  try {
    const data = await api.loadActiveRuns();
    if (request !== canvasState.runsRequest) return;
    const next = new Set(
      (Array.isArray(data?.runs) ? data.runs : [])
        .map((run) => String(run?.sessionId || ''))
        .filter(Boolean)
    );
    const changed =
      next.size !== canvasState.running.size ||
      [...next].some((id) => !canvasState.running.has(id));
    canvasState.running = next;
    if (changed) canvasState.runsDirty = true;
    if (
      canvasState.runsDirty &&
      canvasOverlayOpen() &&
      !canvasState.drag &&
      !canvasState.managerDrag &&
      !canvasState.frameDrag &&
      !canvasState.marquee &&
      !canvasState.workspaceDrag
    ) {
      canvasState.runsDirty = false;
      renderCanvas();
    }
  } catch {
    /* ignore polling failures */
  }
}

function scheduleCanvasRunsPoll() {
  if (!canvasOverlayOpen()) return;
  if (canvasState.runsTimer) return;
  canvasState.runsTimer = setTimeout(async () => {
    canvasState.runsTimer = null;
    if (!canvasOverlayOpen()) return;
    if (!document.hidden) await loadCanvasRuns();
    scheduleCanvasRunsPoll();
  }, 1500);
}

/* -------------------------------- 组渲染 -------------------------------- */

function buildCanvasChild(child, root) {
  const childEl = el('div', 'canvas-child');
  childEl.dataset.sessionId = child.id;
  if (
    canvasState.selectedIds.size <= 1 &&
    canvasState.selectedChildId === child.id
  ) {
    childEl.classList.add('selected');
  }
  childEl.append(
    el('span', 'canvas-child-title', child.title || '未命名对话')
  );
  const arrow = el('span', 'canvas-child-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  childEl.append(arrow);
  childEl.title = child.title || '未命名对话';

  childEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
      return;
    }
    if (event.shiftKey) {
      canvasToggleGroupSelection(root.id);
      return;
    }
    canvasSelectGroup(root.id, child.id);
  });
  childEl.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openCanvasSession(child.id);
  });
  childEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  return childEl;
}

function buildCanvasTask(job) {
  const row = el('div', 'canvas-task');
  const status =
    job?.status === 'exited'
      ? job?.exitCode === 0
        ? 'done'
        : 'blocked'
      : job?.status === 'running'
        ? 'running'
        : job?.status === 'error' || job?.status === 'timeout'
          ? 'blocked'
          : 'idle';
  row.classList.add(status);
  const note = String(job?.note || job?.command || '后台任务').trim();
  row.append(el('span', 'canvas-task-note', note));
  const command = String(job?.command || '').trim();
  const statusLabel =
    job?.status === 'exited'
      ? job?.exitCode === 0
        ? '完成'
        : '失败'
      : typeof backgroundStatusLabel === 'function'
        ? backgroundStatusLabel(job?.status)
        : job?.status || '运行中';
  if (statusLabel) {
    row.append(el('span', `canvas-task-status ${status}`, statusLabel));
  }
  const elapsed =
    typeof backgroundElapsed === 'function' ? backgroundElapsed(job) : '';
  row.title = [
    note,
    command && command !== note ? command : '',
    statusLabel,
    elapsed,
  ]
    .filter(Boolean)
    .join(' · ');
  return row;
}

function buildCanvasColumn(title, rows) {
  const column = el('section', 'canvas-column');
  const head = el('div', 'canvas-column-head');
  head.append(el('span', 'canvas-column-title', title));
  const list = el('div', 'canvas-column-list');
  if (rows.length > 0) {
    rows.forEach((row) => list.append(row));
  } else {
    list.append(el('div', 'canvas-column-empty', '无'));
  }
  column.append(head, list);
  return column;
}

function canvasNodeStatus(session) {
  if (!session) return { label: '空闲', tone: 'idle' };
  if (canvasState.running.has(session.id)) {
    return { label: '运行中', tone: 'running' };
  }
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  const last = messages[messages.length - 1];
  if (!last) return { label: '空闲', tone: 'idle' };
  if (last.role === 'User') return { label: '等待', tone: 'idle' };
  if (last.role === 'Agent' && String(last.text || '').trim()) {
    return { label: '完成', tone: 'done' };
  }
  return { label: '空闲', tone: 'idle' };
}

function canvasManagerTeam(manager, sessions = state.sessions) {
  return sessions.filter(
    (session) =>
      session &&
      session.managerId === manager.id &&
      session.nodeRole !== 'manager' &&
      !session.subagent &&
      !session.archivedAt
  );
}

function openManagerAgile(managerId) {
  const id = String(managerId || '').trim();
  if (!id) return;
  if (window.yah?.openAgileWindow) {
    void window.yah.openAgileWindow(id);
    return;
  }
  window.openAgile?.(id);
}

function buildCanvasManagerPanel(manager, team, node) {
  const panelEl = el('article', 'canvas-manager-panel');
  panelEl.dataset.sessionId = manager.id;
  if (canvasState.selectedIds.has(manager.id)) {
    panelEl.classList.add('selected');
  }
  const running = [manager, ...team].some((session) =>
    canvasState.running.has(session.id)
  );
  if (running) panelEl.classList.add('running');

  const head = el('header', 'canvas-manager-panel-head');
  const icon = el('span', 'canvas-manager-panel-icon');
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CANVAS_MANAGER_ICON}</svg>`;
  head.append(icon);
  head.append(
    el('span', 'canvas-manager-panel-title', manager.title || 'Manager')
  );
  panelEl.append(head);

  const done = team.filter(
    (session) => canvasNodeStatus(session).tone === 'done'
  ).length;
  const runningCount = team.filter((session) =>
    canvasState.running.has(session.id)
  ).length;
  const meta = el('div', 'canvas-manager-meta');
  meta.append(
    el(
      'span',
      '',
      `${team.length} 个 work node · ${runningCount} 运行 · ${done} 完成`
    )
  );
  panelEl.append(meta);

  const progress = el('div', 'canvas-manager-progress');
  const fill = el('span');
  fill.style.width = `${team.length ? Math.round((done / team.length) * 100) : 0}%`;
  progress.append(fill);
  panelEl.append(progress);

  const foot = el('div', 'canvas-manager-foot');
  foot.append(el('span', '', '双击打开 · 拖动整组'));
  panelEl.append(foot);

  panelEl.title = manager.title || 'Manager';
  panelEl.addEventListener('pointerdown', (event) => {
    startCanvasManagerDrag(event, manager, panelEl, node, team);
  });
  panelEl.addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button')
    ) {
      return;
    }
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
      return;
    }
    if (event.shiftKey) {
      canvasToggleGroupSelection(manager.id);
      return;
    }
    canvasSelectGroup(manager.id, null);
  });
  panelEl.addEventListener('dblclick', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button')
    ) {
      return;
    }
    event.preventDefault();
    openCanvasSession(manager.id);
  });
  panelEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  return panelEl;
}

function canvasSystemNodeStatus(node) {
  const status = String(node?.status || '');
  if (node?.type === 'agile') {
    return { label: '运行中', tone: 'running' };
  }
  if (node?.type === 'orchestrator') {
    if (status === 'running') return { label: '运行中', tone: 'running' };
    if (status === 'paused') return { label: '已暂停', tone: 'idle' };
    return { label: status || '空闲', tone: 'error' };
  }
  if (node?.type === 'report') {
    const counts = node.payload?.counts || {};
    if (status === 'ready') return { label: '待阅读', tone: 'done' };
    if (status === 'read') return { label: '已阅读', tone: 'idle' };
    if (status === 'archived') return { label: '已归档', tone: 'idle' };
    return {
      label: `收集中 ${counts.finished || 0}/${counts.total || 0}`,
      tone: 'running',
    };
  }
  if (node?.type === 'approval') {
    if (status === 'pending') return { label: '待批准', tone: 'waiting' };
    if (status === 'approved') return { label: '已批准', tone: 'done' };
    if (status === 'denied') return { label: '已拒绝', tone: 'error' };
    if (status === 'expired') return { label: '已过期', tone: 'idle' };
    return { label: status || '审批', tone: 'idle' };
  }
  if (node?.type === 'questionnaire') {
    if (status === 'pending') return { label: '待回答', tone: 'waiting' };
    if (status === 'answered') return { label: '已回答', tone: 'done' };
    if (status === 'dismissed') return { label: '已关闭', tone: 'idle' };
    if (status === 'expired') return { label: '已过期', tone: 'idle' };
    return { label: status || '问卷', tone: 'idle' };
  }
  return { label: status || '系统', tone: 'idle' };
}

function canvasSystemNodeType(node) {
  if (node?.type === 'agile') return 'Agile';
  if (node?.type === 'orchestrator') return '调度器';
  if (node?.type === 'report') return 'Report Hub';
  if (node?.type === 'approval') return '审批';
  if (node?.type === 'questionnaire') return '问卷';
  return '系统';
}

function canvasSystemNodeSummary(node) {
  if (node?.type === 'agile') {
    const counts = node.payload?.counts || {};
    const label = node.payload?.boardLabel || 'Agile';
    return `${label} · Backlog ${counts.backlog || 0} · 进行 ${counts.progress || 0} · 阻塞 ${counts.blocked || 0} · 完成 ${counts.finished || 0}`;
  }
  if (node?.type === 'orchestrator') {
    const payload = node.payload || {};
    const boards = Array.isArray(payload.boardIds) ? payload.boardIds.length : 0;
    return boards
      ? `${boards} 个 mission · Actor 按角色分发`
      : '等待 Manager 下达 mission';
  }
  if (node?.type === 'report') {
    const counts = node.payload?.counts || {};
    return `${counts.finished || 0}/${counts.total || 0} 完成 · ${
      counts.blocked || 0
    } 阻塞`;
  }
  if (node?.type === 'approval') {
    const payload = node.payload || {};
    return payload.path || payload.tool || '等待批准';
  }
  if (node?.type === 'questionnaire') {
    const questions = Array.isArray(node.payload?.questions)
      ? node.payload.questions
      : [];
    return questions[0]?.question || '等待回答';
  }
  return '';
}

async function systemNodeAction(nodeId, action, payload = {}) {
  try {
    await requestJson(`/api/system-nodes/${encodeURIComponent(nodeId)}/action`, {
      method: 'POST',
      body: { action, ...payload },
    });
    await reloadCanvas();
    return true;
  } catch (error) {
    console.error('system node action failed', error);
    return false;
  }
}

function closeSystemNodeModal() {
  document.querySelector('.system-node-overlay')?.remove();
}

function systemNodeButton(label, action) {
  const button = el('button', 'system-node-action', label);
  button.type = 'button';
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void action();
  });
  return button;
}

function systemNodeSteps(node) {
  const steps = Array.isArray(node?.payload?.steps)
    ? node.payload.steps
    : [];
  if (steps.length === 0) return null;
  const section = el('section', 'system-node-steps-section');
  section.append(el('div', 'system-node-section-label', '执行步骤'));
  const list = el('div', 'system-node-steps');
  for (const step of steps.slice(-100)) {
    const row = el('div', 'system-node-step');
    row.append(el('span', `system-node-step-dot ${step.kind || ''}`));
    const body = el('div', 'system-node-step-body');
    body.append(el('div', 'system-node-step-message', step.message || ''));
    const meta = [];
    if (step.at) meta.push(new Date(step.at).toLocaleTimeString());
    if (step.taskId) meta.push(step.taskId);
    if (meta.length) {
      body.append(el('div', 'system-node-step-meta', meta.join(' · ')));
    }
    row.append(body);
    list.append(row);
  }
  section.append(list);
  return section;
}

function openSystemNode(nodeId) {
  const node = canvasState.systemNodes.find((item) => item.id === nodeId);
  if (!node) return;
  closeSystemNodeModal();
  const overlay = el('div', 'system-node-overlay');
  const card = el('div', 'system-node-modal');
  const head = el('header', 'system-node-modal-head');
  head.append(el('div', 'system-node-modal-kicker', canvasSystemNodeType(node)));
  head.append(el('h3', 'system-node-modal-title', node.title || '系统 node'));
  const close = el('button', 'system-node-close', '×');
  close.type = 'button';
  close.addEventListener('click', closeSystemNodeModal);
  head.append(close);
  card.append(head);
  const status = canvasSystemNodeStatus(node);
  const meta = el('div', 'system-node-modal-meta');
  meta.append(el('span', `system-node-state ${status.tone}`, status.label));
  if (node.missionId) meta.append(el('span', '', `Mission ${node.missionId}`));
  card.append(meta);
  const steps = systemNodeSteps(node);
  if (steps) card.append(steps);

  if (node.type === 'agile') {
    const counts = node.payload?.counts || {};
    const info = el('div', 'system-node-fields');
    for (const [label, value] of [
      ['迭代', node.payload?.boardLabel || '—'],
      ['Backlog', String(counts.backlog || 0)],
      ['In Progress', String(counts.progress || 0)],
      ['Blocked', String(counts.blocked || 0)],
      ['Finished', String(counts.finished || 0)],
    ]) {
      const row = el('div', 'system-node-field');
      row.append(el('span', 'system-node-field-label', label));
      row.append(el('span', 'system-node-field-value', value));
      info.append(row);
    }
    card.append(info);
    const foot = el('div', 'system-node-modal-actions');
    foot.append(
      systemNodeButton('打开 Agile 面板', async () => {
        openManagerAgile(node.managerId);
      })
    );
    foot.append(systemNodeButton('关闭', async () => closeSystemNodeModal()));
    card.append(foot);
  } else if (node.type === 'report') {
    const counts = node.payload?.counts || {};
    const summary = el('div', 'system-node-fields');
    for (const [label, value] of [
      ['目标', node.payload?.goal],
      ['任务', `${counts.finished || 0}/${counts.total || 0} 完成`],
      ['阻塞', String(counts.blocked || 0)],
    ]) {
      if (!value) continue;
      const row = el('div', 'system-node-field');
      row.append(el('span', 'system-node-field-label', label));
      row.append(el('span', 'system-node-field-value', String(value)));
      summary.append(row);
    }
    card.append(summary);
    const body = el('div', 'system-node-report system-node-report-rendered');
    const markdown =
      node.payload?.reportMarkdown ||
      '报告还在收集中。任务完成后会自动生成。';
    if (typeof window.renderMarkdownContent === 'function') {
      window.renderMarkdownContent(body, markdown);
    } else {
      body.textContent = markdown;
    }
    card.append(body);
    const foot = el('div', 'system-node-modal-actions');
    if (node.status === 'ready') {
      foot.append(
        systemNodeButton('标记已读', async () => {
          await systemNodeAction(node.id, 'read');
          closeSystemNodeModal();
        })
      );
    }
    foot.append(systemNodeButton('关闭', async () => closeSystemNodeModal()));
    card.append(foot);
  } else if (node.type === 'approval') {
    const payload = node.payload || {};
    const info = el('div', 'system-node-fields');
    for (const [label, value] of [
      ['工具', payload.tool],
      ['路径', payload.path],
      ['允许目录', Array.isArray(payload.allowedDirs) ? payload.allowedDirs.join(' · ') : ''],
      ['来源', payload.sourceTitle],
      ['原因', payload.reason],
    ]) {
      if (!value) continue;
      const row = el('div', 'system-node-field');
      row.append(el('span', 'system-node-field-label', label));
      row.append(el('span', 'system-node-field-value', String(value)));
      info.append(row);
    }
    card.append(info);
    if (node.status === 'pending') {
      const foot = el('div', 'system-node-modal-actions');
      foot.append(
        systemNodeButton('允许', async () => {
          await systemNodeAction(node.id, 'approve');
          closeSystemNodeModal();
        })
      );
      foot.append(
        systemNodeButton('拒绝', async () => {
          await systemNodeAction(node.id, 'deny');
          closeSystemNodeModal();
        })
      );
      card.append(foot);
    }
  } else if (node.type === 'questionnaire') {
    const payload = node.payload || {};
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const form = el('div', 'system-node-questionnaire');
    const controls = [];
    for (const [index, question] of questions.entries()) {
      const field = el('div', 'system-node-question');
      field.append(el('div', 'system-node-question-title', question.question));
      const options = Array.isArray(question.options) ? question.options : [];
      if (options.length > 0) {
        const group = el('div', 'system-node-options');
        for (const option of options) {
          const label = el('label', 'system-node-option');
          const input = document.createElement('input');
          input.type = question.multiple ? 'checkbox' : 'radio';
          input.name = `system-node-q-${index}`;
          input.value = option.label;
          label.append(input, el('span', '', option.label));
          if (option.description) {
            label.append(el('span', 'system-node-option-desc', option.description));
          }
          group.append(label);
        }
        field.append(group);
        controls.push({ index, kind: 'options', group, multiple: question.multiple });
      } else {
        const input = el('textarea', 'system-node-input');
        input.rows = 3;
        field.append(input);
        controls.push({ index, kind: 'text', input });
      }
      form.append(field);
    }
    card.append(form);
    if (node.status === 'pending') {
      const foot = el('div', 'system-node-modal-actions');
      foot.append(
        systemNodeButton('提交回答', async () => {
          const answers = [];
          for (const control of controls) {
            if (control.kind === 'text') {
              answers[control.index] = [control.input.value.trim()].filter(Boolean);
            } else {
              answers[control.index] = [
                ...control.group.querySelectorAll('input:checked'),
              ].map((input) => input.value);
            }
          }
          await systemNodeAction(node.id, 'answer', { answers });
          closeSystemNodeModal();
        })
      );
      foot.append(systemNodeButton('关闭', async () => closeSystemNodeModal()));
      card.append(foot);
    }
  } else if (node.type === 'orchestrator') {
    const payload = node.payload || {};
    const info = el('div', 'system-node-fields');
    const roleMap = payload.roleMap || {};
    for (const [label, value] of [
      ['Mission', String(Array.isArray(payload.boardIds) ? payload.boardIds.length : 0)],
      ['WIP', String(payload.wipLimit || 2)],
      ['角色映射', Object.entries(roleMap).map(([role, name]) => `${role}→${name}`).join(' · ')],
    ]) {
      if (!value) continue;
      const row = el('div', 'system-node-field');
      row.append(el('span', 'system-node-field-label', label));
      row.append(el('span', 'system-node-field-value', String(value)));
      info.append(row);
    }
    card.append(info);
    const foot = el('div', 'system-node-modal-actions');
    foot.append(systemNodeButton('关闭', async () => closeSystemNodeModal()));
    card.append(foot);
  }
  overlay.append(card);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeSystemNodeModal();
  });
  document.body.append(overlay);
}

function buildCanvasSystemNode(node) {
  const status = canvasSystemNodeStatus(node);
  const article = el(
    'article',
    `canvas-system-node type-${node.type} status-${node.status}`
  );
  const head = el('header', 'canvas-system-node-head');
  head.append(el('span', `canvas-system-node-state ${status.tone}`));
  head.append(el('span', 'canvas-system-node-type', canvasSystemNodeType(node)));
  head.append(el('span', 'canvas-system-node-status', status.label));
  article.append(head);
  article.append(el('div', 'canvas-system-node-title', node.title || '系统 node'));
  const summary = canvasSystemNodeSummary(node);
  if (summary) article.append(el('div', 'canvas-system-node-summary', summary));
  const actions = el('div', 'canvas-system-node-actions');
  if (node.type === 'agile') {
    actions.append(
      systemNodeButton('打开 Agile', async () => {
        openManagerAgile(node.managerId);
      })
    );
  } else if (node.type === 'approval' && node.status === 'pending') {
    actions.append(
      systemNodeButton('允许', async () => {
        await systemNodeAction(node.id, 'approve');
      })
    );
    actions.append(
      systemNodeButton('拒绝', async () => {
        await systemNodeAction(node.id, 'deny');
      })
    );
  } else if (node.type === 'questionnaire' && node.status === 'pending') {
    actions.append(
      systemNodeButton('回答', async () => openSystemNode(node.id))
    );
  } else if (node.type === 'report' && node.status !== 'collecting') {
    actions.append(
      systemNodeButton('打开报告', async () => openSystemNode(node.id))
    );
  } else {
    actions.append(
      systemNodeButton('查看', async () => openSystemNode(node.id))
    );
  }
  article.append(actions);
  article.addEventListener('pointerdown', (event) => event.stopPropagation());
  article.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openSystemNode(node.id);
  });
  return article;
}

function canvasSystemNodesFor(managerId) {
  const order = {
    agile: 0,
    orchestrator: 1,
    report: 2,
    approval: 3,
    questionnaire: 4,
  };
  return canvasState.systemNodes
    .filter((node) => node.managerId === managerId)
    .filter((node) => node.status !== 'archived')
    .slice()
    .sort((left, right) => {
      const leftOrder = order[left.type] ?? 9;
      const rightOrder = order[right.type] ?? 9;
      return leftOrder - rightOrder || (left.createdAt || 0) - (right.createdAt || 0);
    });
}

function buildCanvasManagerGroup(manager, team, node) {
  const groupEl = el('div', 'canvas-manager-group');
  groupEl.dataset.sessionId = manager.id;
  groupEl.style.left = `${(Number(node.x) || 0) - CANVAS_MANAGER_GROUP_PADDING}px`;
  groupEl.style.top = `${(Number(node.y) || 0) - CANVAS_MANAGER_GROUP_PADDING}px`;
  groupEl.style.width = `${CANVAS_MANAGER_GROUP_WIDTH}px`;
  groupEl.style.height = `${CANVAS_MANAGER_GROUP_HEIGHT}px`;
  groupEl.addEventListener('pointerdown', (event) => {
    const managerCard = canvasDom.nodes?.querySelector(
      `.canvas-manager-panel[data-session-id="${CSS.escape(manager.id)}"]`
    );
    startCanvasManagerDrag(
      event,
      manager,
      managerCard || groupEl,
      node,
      team,
      groupEl
    );
  });
  const systemNodes = canvasSystemNodesFor(manager.id);
  if (systemNodes.length > 0) {
    const lane = el('div', 'canvas-system-lane');
    lane.addEventListener('pointerdown', (event) => event.stopPropagation());
    lane.addEventListener('click', (event) => event.stopPropagation());
    for (const systemNode of systemNodes) {
      lane.append(buildCanvasSystemNode(systemNode));
    }
    groupEl.append(lane);
  }
  return groupEl;
}

function buildCanvasManager(manager, team, node) {
  const managerEl = el('article', 'canvas-manager');
  managerEl.dataset.sessionId = manager.id;
  if (canvasState.selectedIds.has(manager.id)) {
    managerEl.classList.add('selected');
  }
  const running = [manager, ...team].some((session) =>
    canvasState.running.has(session.id)
  );
  if (running) managerEl.classList.add('running');

  const head = el('header', 'canvas-manager-head');
  const icon = el('span', 'canvas-manager-icon');
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CANVAS_MANAGER_ICON}</svg>`;
  head.append(icon);
  head.append(
    el(
      'span',
      'canvas-manager-kicker',
      running ? 'MANAGER · 编排中' : 'MANAGER · 空闲'
    )
  );
  head.append(
    el('span', 'canvas-manager-agent', canvasAgentName(manager))
  );
  managerEl.append(head);

  managerEl.append(
    el('div', 'canvas-manager-title', manager.title || 'Manager')
  );

  const done = team.filter((session) => {
    const status = canvasNodeStatus(session);
    return status.tone === 'done';
  }).length;
  const runningCount = team.filter((session) =>
    canvasState.running.has(session.id)
  ).length;
  const meta = el('div', 'canvas-manager-meta');
  meta.append(
    el(
      'span',
      '',
      `${team.length} 个工作 node · ${runningCount} 运行 · ${done} 完成`
    )
  );
  managerEl.append(meta);

  const progress = el('div', 'canvas-manager-progress');
  const fill = el('span');
  fill.style.width = `${team.length ? Math.round((done / team.length) * 100) : 0}%`;
  progress.append(fill);
  managerEl.append(progress);

  const teamList = el('div', 'canvas-manager-team');
  if (team.length === 0) {
    teamList.append(
      el('div', 'canvas-manager-empty', '还没有工作 node · 在对话里让它创建')
    );
  } else {
    team.slice(0, 3).forEach((session) => {
      const status = canvasNodeStatus(session);
      const row = el('div', 'canvas-manager-row');
      row.append(el('span', `dot ${status.tone}`));
      row.append(
        el(
          'span',
          'canvas-manager-row-title',
          session.title || '工作 node'
        )
      );
      row.append(el('span', 'canvas-manager-row-state', status.label));
      teamList.append(row);
    });
    if (team.length > 3) {
      teamList.append(
        el('div', 'canvas-manager-empty', `还有 ${team.length - 3} 个…`)
      );
    }
  }
  managerEl.append(teamList);

  const foot = el('div', 'canvas-manager-foot');
  foot.append(
    el('span', '', '双击打开对话 · 拖动整队')
  );
  managerEl.append(foot);

  managerEl.title = `${manager.title || 'Manager'} · ${canvasAgentName(manager)}`;
  managerEl.addEventListener('pointerdown', (event) => {
    startCanvasManagerDrag(event, manager, managerEl, node, team);
  });
  managerEl.addEventListener('click', (event) => {
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
      return;
    }
    if (event.button !== 0) return;
    if (event.shiftKey) {
      canvasToggleGroupSelection(manager.id);
      return;
    }
    canvasSelectGroup(manager.id, null);
  });
  managerEl.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openCanvasSession(manager.id);
  });
  return managerEl;
}

function buildCanvasGroup(root, children, jobs, node) {
  const groupEl = el('article', 'canvas-group');
  groupEl.dataset.sessionId = root.id;
  if (canvasState.selectedIds.has(root.id)) {
    groupEl.classList.add('selected');
  }
  const running = [root, ...children].some((session) =>
    canvasState.running.has(session.id)
  );
  if (running) groupEl.classList.add('running');

  const manager = root.managerId
    ? state.sessions.find((session) => session.id === root.managerId)
    : null;
  const managerName = manager?.title || '';
  const head = el('header', 'canvas-group-head');
  const heading = el('div', 'canvas-group-heading');
  heading.append(
    el('span', 'canvas-group-title', root.title || '未命名对话')
  );
  const subline = el('div', 'canvas-group-subline');
  subline.append(
    el('span', 'canvas-group-agent', canvasAgentName(root))
  );
  subline.append(
    el(
      'span',
      'canvas-group-manager',
      root.nodeRole === 'manager'
        ? '管理 node'
        : managerName
          ? `所属 ${managerName}`
          : '未归属'
    )
  );
  heading.append(subline);
  head.append(heading);
  groupEl.append(head);

  const columns = el('div', 'canvas-group-columns');
  const activeChildren = children.filter((child) => !child.archivedAt);
  columns.append(
    buildCanvasColumn(
      'SUBAGENTS',
      activeChildren.map((child) => buildCanvasChild(child, root))
    ),
    buildCanvasColumn(
      'BACKGROUND',
      jobs.map((job) => buildCanvasTask(job))
    )
  );
  groupEl.append(columns);

  groupEl.title = `${managerName || '未归属'} · ${root.title || '未命名对话'}`;
  groupEl.addEventListener('pointerdown', (event) => {
    if (root.nodeRole === 'manager') {
      startCanvasManagerDrag(
        event,
        root,
        groupEl,
        node,
        canvasManagerTeam(root)
      );
      return;
    }
    startCanvasGroupDrag(event, root, groupEl, node);
  });
  groupEl.addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.canvas-child, button')
    ) {
      return;
    }
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
      return;
    }
    if (event.shiftKey) {
      canvasToggleGroupSelection(root.id);
      return;
    }
    canvasSelectGroup(root.id, null);
  });
  groupEl.addEventListener('dblclick', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.canvas-child, button')
    ) {
      return;
    }
    event.preventDefault();
    openCanvasSession(root.id);
  });
  groupEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  return groupEl;
}

function renderCanvasNodes(index) {
  if (!canvasDom.nodes) return;
  canvasDom.nodes.replaceChildren();
  const { roots, childrenByRoot } = index;
  let dirty = false;
  let resized = false;
  const measured = [];
  const managers = roots.filter((root) => root.nodeRole === 'manager');
  const regularRoots = roots.filter((root) => root.nodeRole !== 'manager');
  for (const manager of managers) {
    const node = canvasState.nodes[manager.id];
    if (!node) continue;
    const team = canvasManagerTeam(manager, index.sessions);
    const groupBackdrop = buildCanvasManagerGroup(manager, team, node);
    canvasDom.nodes.append(groupBackdrop);
    const cardEl = buildCanvasManagerPanel(manager, team, node);
    cardEl.style.left = `${node.x}px`;
    cardEl.style.top = `${node.y}px`;
    cardEl.style.width = `${CANVAS_MANAGER_CARD_SIZE}px`;
    cardEl.style.height = `${CANVAS_MANAGER_CARD_SIZE}px`;
    canvasDom.nodes.append(cardEl);
    measured.push({ groupEl: cardEl, node });
  }
  for (const root of regularRoots) {
    const node = canvasState.nodes[root.id];
    if (!node) continue;
    const children = childrenByRoot.get(root.id) || [];
    const jobs = canvasGroupJobs(root, children);
    const groupEl = buildCanvasGroup(root, children, jobs, node);
    groupEl.style.left = `${node.x}px`;
    groupEl.style.top = `${node.y}px`;
    groupEl.style.width = `${CANVAS_GROUP_WIDTH}px`;
    canvasDom.nodes.append(groupEl);
    measured.push({ groupEl, node });
  }
  for (const item of measured) {
    const width = item.groupEl.offsetWidth;
    const height = item.groupEl.offsetHeight;
    if (item.node.width !== width || item.node.height !== height) {
      item.node.width = width;
      item.node.height = height;
      dirty = true;
      resized = true;
    }
  }

  if (resized) {
    const gap = 24;
    const placed = [];
    const ordered = measured
      .slice()
      .sort((left, right) => left.node.y - right.node.y || left.node.x - right.node.x);
    for (const item of ordered) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const other of placed) {
          const overlapsX =
            item.node.x < other.node.x + other.node.width &&
            other.node.x < item.node.x + item.node.width;
          const overlapsY =
            item.node.y < other.node.y + other.node.height &&
            other.node.y < item.node.y + item.node.height;
          if (!overlapsX || !overlapsY) continue;
          item.node.y = other.node.y + other.node.height + gap;
          item.groupEl.style.top = `${item.node.y}px`;
          moved = true;
          dirty = true;
        }
      }
      placed.push(item);
    }
  }
  if (dirty) scheduleCanvasSave();
}

function applyCanvasView() {
  const view = canvasState.view;
  const x = Math.round(view.x);
  const y = Math.round(view.y);
  if (canvasDom.zoomLayer) {
    canvasDom.zoomLayer.style.zoom = String(view.k);
  }
  if (canvasDom.world) {
    canvasDom.world.style.transform = `translate(${x}px, ${y}px)`;
  }
  if (canvasDom.grid) {
    canvasDom.grid.style.backgroundPosition = `${x}px ${y}px`;
  }
  if (canvasDom.zoomIndicator) {
    canvasDom.zoomIndicator.textContent = `${Math.round(view.k * 100)}%`;
  }
}

function renderCanvas() {
  const index = ensureCanvasGroups();
  renderCanvasNodes(index);
  applyCanvasView();
  if (canvasDom.empty) {
    canvasDom.empty.classList.toggle('hidden', index.roots.length > 0);
  }
}

function canvasApplySelection() {
  const ids = canvasState.selectedIds;
  for (const group of canvasDom.nodes.querySelectorAll(
    '.canvas-group, .canvas-manager, .canvas-manager-panel'
  )) {
    group.classList.toggle(
      'selected',
      ids.has(group.dataset.sessionId)
    );
  }
  for (const child of canvasDom.nodes.querySelectorAll('.canvas-child')) {
    child.classList.toggle(
      'selected',
      ids.size <= 1 &&
        child.dataset.sessionId === canvasState.selectedChildId
    );
  }
}

function canvasSelectGroup(rootId, childId = null) {
  canvasState.selectedId = rootId;
  canvasState.selectedChildId = childId;
  canvasState.selectedIds = new Set(rootId ? [rootId] : []);
  canvasApplySelection();
}

function canvasToggleGroupSelection(rootId) {
  const ids = new Set(canvasState.selectedIds);
  if (ids.size === 0 && canvasState.selectedId) {
    ids.add(canvasState.selectedId);
  }
  if (ids.has(rootId)) ids.delete(rootId);
  else ids.add(rootId);
  canvasState.selectedIds = ids;
  canvasState.selectedId = ids.size === 1 ? [...ids][0] : null;
  canvasState.selectedChildId = null;
  canvasApplySelection();
}

function canvasSelectedNodeIds() {
  return [...canvasState.selectedIds].filter((id) =>
    Boolean(canvasState.nodes[id])
  );
}

function canvasClearSelection() {
  canvasState.selectedId = null;
  canvasState.selectedChildId = null;
  canvasState.selectedIds = new Set();
  for (const item of canvasDom.nodes.querySelectorAll(
    '.canvas-group.selected, .canvas-child.selected, .canvas-manager.selected, .canvas-manager-panel.selected'
  )) {
    item.classList.remove('selected');
  }
}

/* ------------------------------- 工作区页 ------------------------------- */

function renderWorkspacePage() {
  if (!canvasDom.workspaces) return;
  if (canvasState.workspaceDrag?.active) return;
  canvasDom.workspaces.replaceChildren();
  const projects = Array.isArray(state.projects) ? state.projects : [];
  if (projects.length === 0) {
    canvasDom.workspaces.append(
      el(
        'div',
        'canvas-workspaces-empty',
        '还没有工作区。点右上角「+ 新建」绑定一个开发目录。'
      )
    );
    return;
  }
  projects.forEach((project) => {
    const card = el('article', 'canvas-workspace');
    card.dataset.projectId = project.id;
    card.style.setProperty(
      '--canvas-workspace-color',
      canvasWorkspaceColor(project)
    );

    const head = el('header', 'canvas-workspace-head');
    head.append(el('span', 'canvas-workspace-dot'));
    head.append(
      el('span', 'canvas-workspace-name', project.name || '未命名工作区')
    );
    card.append(head);

    const directories = Array.isArray(project.directories)
      ? project.directories
      : [];
    card.append(
      el(
        'div',
        'canvas-workspace-meta',
        `${directories.length} 个目录 · ${canvasWorkspaceSessionCount(
          project.id
        )} 个对话`
      )
    );

    const dirs = el('div', 'canvas-workspace-dirs');
    directories.slice(0, 2).forEach((directory) => {
      const row = el('div', 'canvas-workspace-dir');
      const icon = el('span', 'canvas-workspace-dir-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CANVAS_FOLDER_ICON}</svg>`;
      row.append(icon, el('span', '', directory));
      row.title = directory;
      dirs.append(row);
    });
    if (directories.length > 2) {
      dirs.append(
        el(
          'div',
          'canvas-workspace-dir-more',
          `+${directories.length - 2} 个目录`
        )
      );
    }
    card.append(dirs);

    const foot = el('footer', 'canvas-workspace-foot');
    foot.append(el('span', '', '拖到画布开始对话'));
    foot.append(el('span', 'canvas-workspace-grip', '⠿'));
    card.append(foot);

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      startWorkspaceDrag(event, project);
    });
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
    card.title = project.name || '未命名工作区';
    canvasDom.workspaces.append(card);
  });
}

function showWorkspacePage() {
  if (!canvasDom.page) return;
  renderWorkspacePage();
  canvasDom.page.classList.remove('hidden');
  canvasDom.page.classList.remove('dragging');
  canvasState.pageOpen = true;
  // 强制一次 reflow，避免后台窗口里 requestAnimationFrame 被节流导致页面一直透明
  void canvasDom.page.offsetWidth;
  canvasDom.page.classList.add('open');
}

function hideWorkspacePage() {
  if (!canvasDom.page) return;
  canvasState.pageOpen = false;
  canvasDom.page.classList.remove('open');
  clearTimeout(canvasState.pageTimer);
  canvasState.pageTimer = setTimeout(() => {
    if (canvasState.pageOpen) return;
    canvasDom.page.classList.add('hidden');
    canvasDom.page.classList.remove('dragging');
  }, 200);
}

function canvasWorkspacePageOpen() {
  return Boolean(
    canvasState.pageOpen &&
      canvasDom.page &&
      !canvasDom.page.classList.contains('hidden')
  );
}

function pointInStage(clientX, clientY) {
  const rect = canvasDom.stage?.getBoundingClientRect();
  if (!rect) return false;
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function startWorkspaceDrag(event, project) {
  if (!canvasDom.stage) return;
  event.preventDefault();
  canvasState.workspaceDrag = {
    projectId: project.id,
    projectName: project.name || '未命名工作区',
    color: canvasWorkspaceColor(project),
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    card: event.currentTarget,
    ghost: null,
  };
}

function updateWorkspaceDrag(event) {
  const drag = canvasState.workspaceDrag;
  if (!drag) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.active) {
    const distance =
      Math.abs(event.clientX - drag.startX) +
      Math.abs(event.clientY - drag.startY);
    if (distance < 5) return;
    drag.active = true;
    canvasDom.page?.classList.add('dragging');
    drag.card?.classList.add('dragging');
    const ghost = el('div', 'canvas-drag-ghost');
    ghost.style.setProperty('--canvas-workspace-color', drag.color);
    ghost.append(el('span', 'canvas-drag-ghost-dot'));
    const copy = el('div', 'canvas-drag-ghost-copy');
    copy.append(el('span', 'canvas-drag-ghost-name', drag.projectName));
    copy.append(el('span', 'canvas-drag-ghost-hint', '松开放到画布'));
    ghost.append(copy);
    document.body.append(ghost);
    drag.ghost = ghost;
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${drag.x}px`;
    drag.ghost.style.top = `${drag.y}px`;
  }
  canvasDom.stage?.classList.toggle('drop-target', pointInStage(drag.x, drag.y));
}

function endWorkspaceDrag() {
  const drag = canvasState.workspaceDrag;
  canvasState.workspaceDrag = null;
  if (!drag) return;
  drag.ghost?.remove();
  drag.card?.classList.remove('dragging');
  canvasDom.page?.classList.remove('dragging');
  canvasDom.stage?.classList.remove('drop-target');
}

function finishWorkspaceDrag() {
  const drag = canvasState.workspaceDrag;
  if (!drag) return;
  const drop =
    drag.active && pointInStage(drag.x, drag.y)
      ? {
          projectId: drag.projectId,
          x: drag.x,
          y: drag.y,
        }
      : null;
  endWorkspaceDrag();
  if (drop) {
    createCanvasConversationAt(drop.projectId, drop.x, drop.y);
    hideWorkspacePage();
  }
}

function canvasTabReleased() {
  if (canvasState.workspaceDrag) {
    finishWorkspaceDrag();
  }
  hideWorkspacePage();
}

function cancelCanvasPage() {
  endWorkspaceDrag();
  hideWorkspacePage();
}

/* --------------------------------- 缩放 --------------------------------- */

function zoomCanvas(factor, clientX, clientY) {
  const rect = canvasDom.stage?.getBoundingClientRect();
  const px = canvasNumber(clientX, (rect?.width || 800) / 2);
  const py = canvasNumber(clientY, (rect?.height || 600) / 2);
  const view = canvasState.view;
  const next = canvasClamp(view.k * factor, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM);
  if (next === view.k) return;
  const worldX = (px - view.x) / view.k;
  const worldY = (py - view.y) / view.k;
  view.k = next;
  view.x = px - worldX * next;
  view.y = py - worldY * next;
  applyCanvasView();
  scheduleCanvasSave();
}

function flashZoomIndicator() {
  if (!canvasDom.zoomIndicator) return;
  canvasDom.zoomIndicator.textContent = `${Math.round(
    canvasState.view.k * 100
  )}%`;
  canvasDom.zoomIndicator.classList.add('visible');
  clearTimeout(canvasState.zoomTimer);
  canvasState.zoomTimer = setTimeout(() => {
    canvasDom.zoomIndicator?.classList.remove('visible');
  }, 480);
}

/* --------------------------------- 拖拽 --------------------------------- */

function startCanvasManagerDrag(
  event,
  manager,
  managerEl,
  node,
  team = [],
  groupBackdrop = null
) {
  if (event.button !== 0) return;
  if (
    event.target instanceof Element &&
    event.target.closest('button, a, input, textarea, select')
  ) {
    return;
  }
  event.stopPropagation();
  const backdrop =
    groupBackdrop ||
    canvasDom.nodes?.querySelector(
      `.canvas-manager-group[data-session-id="${CSS.escape(manager.id)}"]`
    ) ||
    null;
  const items = [{ node, el: managerEl }];
  for (const session of team) {
    const teamNode = canvasState.nodes[session.id];
    if (!teamNode) continue;
    const teamEl = canvasDom.nodes.querySelector(
      `.canvas-group[data-session-id="${CSS.escape(session.id)}"]`
    );
    if (!teamEl) continue;
    items.push({ node: teamNode, el: teamEl });
  }
  canvasState.managerDrag = {
    manager,
    managerEl,
    groupBackdrop: backdrop,
    items,
    startX: event.clientX,
    startY: event.clientY,
    origins: items.map((item) => ({
      item,
      x: item.node.x,
      y: item.node.y,
    })),
    moved: false,
    pointerId: event.pointerId,
  };
  backdrop?.classList.add('dragging');
  try {
    managerEl.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  canvasSelectGroup(manager.id, null);
}

function startCanvasGroupDrag(event, root, groupEl, node) {
  if (event.button !== 0) return;
  if (
    event.target instanceof Element &&
    event.target.closest('button')
  ) {
    return;
  }
  event.stopPropagation();
  canvasState.drag = {
    sessionId: root.id,
    groupEl,
    node,
    startX: event.clientX,
    startY: event.clientY,
    originX: node.x,
    originY: node.y,
    moved: false,
    captured: false,
    pointerId: event.pointerId,
  };
  if (!event.shiftKey) {
    canvasSelectGroup(root.id, null);
  }
}

function onCanvasPointerMove(event) {
  if (canvasState.workspaceDrag) {
    updateWorkspaceDrag(event);
    event.preventDefault();
    return;
  }
  if (canvasState.managerDrag) {
    const drag = canvasState.managerDrag;
    const dx = (event.clientX - drag.startX) / canvasState.view.k;
    const dy = (event.clientY - drag.startY) / canvasState.view.k;
    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) +
        Math.abs(event.clientY - drag.startY) <
        4
    ) {
      return;
    }
    drag.moved = true;
    for (const origin of drag.origins) {
      origin.item.node.x = origin.x + dx;
      origin.item.node.y = origin.y + dy;
      origin.item.el.style.left = `${origin.item.node.x}px`;
      origin.item.el.style.top = `${origin.item.node.y}px`;
    }
    if (drag.groupBackdrop) {
      drag.groupBackdrop.style.left = `${(Number(drag.items[0].node.x) || 0) - CANVAS_MANAGER_GROUP_PADDING}px`;
      drag.groupBackdrop.style.top = `${(Number(drag.items[0].node.y) || 0) - CANVAS_MANAGER_GROUP_PADDING}px`;
    }
    event.preventDefault();
    return;
  }
  if (canvasState.frameDrag) {
    const drag = canvasState.frameDrag;
    const dx = (event.clientX - drag.startX) / canvasState.view.k;
    const dy = (event.clientY - drag.startY) / canvasState.view.k;
    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) +
        Math.abs(event.clientY - drag.startY) <
        4
    ) {
      return;
    }
    drag.moved = true;
    for (const item of drag.nodes) {
      item.node.x = item.originX + dx;
      item.node.y = item.originY + dy;
      item.groupEl.style.left = `${item.node.x}px`;
      item.groupEl.style.top = `${item.node.y}px`;
    }
    updateCanvasFrameElements();
    event.preventDefault();
    return;
  }
  if (canvasState.drag) {
    const drag = canvasState.drag;
    const dx = (event.clientX - drag.startX) / canvasState.view.k;
    const dy = (event.clientY - drag.startY) / canvasState.view.k;
    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) +
        Math.abs(event.clientY - drag.startY) <
        4
    ) {
      return;
    }
    drag.moved = true;
    if (!drag.captured) {
      drag.captured = true;
      try {
        drag.groupEl.setPointerCapture(drag.pointerId);
      } catch {
        /* ignore */
      }
    }
    drag.node.x = drag.originX + dx;
    drag.node.y = drag.originY + dy;
    drag.groupEl.style.left = `${drag.node.x}px`;
    drag.groupEl.style.top = `${drag.node.y}px`;
    updateCanvasFrameElements();
    event.preventDefault();
    return;
  }
  if (canvasState.marquee) {
    updateCanvasMarquee(event);
    return;
  }
  if (canvasState.pan) {
    const pan = canvasState.pan;
    if (
      !pan.moved &&
      Math.abs(event.clientX - pan.startX) +
        Math.abs(event.clientY - pan.startY) >
        3
    ) {
      pan.moved = true;
    }
    canvasState.view.x = pan.viewX + (event.clientX - pan.startX);
    canvasState.view.y = pan.viewY + (event.clientY - pan.startY);
    applyCanvasView();
    scheduleCanvasSave();
    event.preventDefault();
  }
}

function onCanvasPointerUp() {
  const finishWorknodesSync = () => {
    if (canvasState.pendingWorknodes) void syncWorknodes();
  };
  if (canvasState.workspaceDrag) {
    finishWorkspaceDrag();
    finishWorknodesSync();
    return;
  }
  if (canvasState.managerDrag) {
    const drag = canvasState.managerDrag;
    if (drag.moved) {
      canvasState.suppressClick = true;
      setTimeout(() => {
        canvasState.suppressClick = false;
      }, 80);
      scheduleCanvasSave();
    }
    try {
      drag.managerEl.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    drag.groupBackdrop?.classList.remove('dragging');
    canvasState.managerDrag = null;
  }
  if (canvasState.frameDrag) {
    const drag = canvasState.frameDrag;
    if (drag.moved) {
      canvasState.suppressClick = true;
      setTimeout(() => {
        canvasState.suppressClick = false;
      }, 80);
      scheduleCanvasSave();
    }
    try {
      drag.frameEl.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    drag.frameEl.classList.remove('dragging');
    canvasState.frameDrag = null;
  }
  if (canvasState.drag) {
    const drag = canvasState.drag;
    if (drag.moved) {
      canvasState.suppressClick = true;
      setTimeout(() => {
        canvasState.suppressClick = false;
      }, 80);
      scheduleCanvasSave();
    }
    try {
      if (drag.captured) {
        drag.groupEl.releasePointerCapture(drag.pointerId);
      }
    } catch {
      /* ignore */
    }
    canvasState.drag = null;
  }
  if (canvasState.marquee) {
    finishCanvasMarquee();
  }
  if (canvasState.pan) {
    const pan = canvasState.pan;
    if (pan.moved) {
      canvasState.suppressClick = true;
      setTimeout(() => {
        canvasState.suppressClick = false;
      }, 80);
    }
    canvasState.pan = null;
    canvasDom.stage?.classList.remove('panning');
    scheduleCanvasSave();
  }
  finishWorknodesSync();
}

/* ------------------------------- 会话与开关 ------------------------------- */

function openCanvasSession(sessionId) {
  const index = state.sessions.findIndex(
    (session) => session.id === sessionId
  );
  if (index < 0) return;
  const session = state.sessions[index];
  if (api.isElectron && api.openChatWindow) {
    Promise.resolve(api.openChatWindow(session.id)).catch((error) =>
      console.error('open chat window failed', error)
    );
    return;
  }
  closeCanvas();
  selectSession(index);
  if (!session.subagent) openComposer();
}

function createCanvasSession(projectId, parentSessionId = null) {
  ensureProjects();
  const parent = parentSessionId
    ? state.sessions.find((session) => session.id === parentSessionId)
    : null;
  const target =
    state.projects.find((project) => project.id === projectId) ||
    (parent
      ? state.projects.find((project) => project.id === parent.projectId)
      : null) ||
    state.projects[0] ||
    null;
  if (!target) return null;
  if (state.sessions.length === 0) state.seq = 0;
  state.seq += 1;
  const siblings = state.sessions.filter(
    (session) => session.projectId === target.id
  );
  const previous = siblings[siblings.length - 1];
  const session = {
    id: makeId(),
    title: `Chat ${state.seq}`,
    system: parent?.system || DEFAULT_SYSTEM_PROMPT,
    agentsMd: parent?.agentsMd || null,
    agentId: previous?.agentId || parent?.agentId || DEFAULT_AGENT_ID,
    projectId: target.id,
    parentSessionId: parentSessionId || null,
    mcpDisabled: Array.isArray(parent?.mcpDisabled)
      ? [...parent.mcpDisabled]
      : ['*'],
    foldState: null,
    pendingQueue: [],
    msgs: [],
  };
  state.sessions.push(session);
  state.switcherProjectId = target.id;
  saveChatsSoon();
  return session;
}

function createCanvasConversationAt(projectId, clientX, clientY) {
  if (!canvasDom.stage) return;
  const rect = canvasDom.stage.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const worldX = (px - canvasState.view.x) / canvasState.view.k;
  const worldY = (py - canvasState.view.y) / canvasState.view.k;
  const session = createCanvasSession(projectId);
  if (!session) return;
  canvasState.nodes[session.id] = {
    x: Math.round(worldX - CANVAS_GROUP_WIDTH / 2),
    y: Math.round(worldY - CANVAS_GROUP_HEIGHT / 2),
    width: CANVAS_GROUP_WIDTH,
    height: CANVAS_GROUP_HEIGHT,
    parentSessionId: null,
  };
  canvasState.selectedId = session.id;
  canvasState.selectedChildId = null;
  canvasState.selectedIds = new Set([session.id]);
  renderCanvas();
  const node = canvasState.nodes[session.id];
  const groupEl = canvasDom.nodes.querySelector(
    `[data-session-id="${session.id}"]`
  );
  if (node && groupEl) {
    const offsetX = (groupEl.offsetWidth - CANVAS_GROUP_WIDTH) / 2;
    const offsetY = (groupEl.offsetHeight - CANVAS_GROUP_HEIGHT) / 2;
    if (offsetX !== 0 || offsetY !== 0) {
      node.x -= offsetX;
      node.y -= offsetY;
      groupEl.style.left = `${node.x}px`;
      groupEl.style.top = `${node.y}px`;
    }
  }
  scheduleCanvasSave();
  if (api.isElectron && api.openChatWindow) {
    const ready = window.flushChats ? window.flushChats() : Promise.resolve();
    Promise.resolve(ready)
      .then(() => window.openSessionWindow?.(session.id, { compose: true }))
      .catch((error) => console.error('open new chat failed', error));
  }
}

function deleteCanvasGroup(rootId) {
  const ids = canvasGroupSessionIds(rootId);
  if (ids.length === 0) return;
  const ordered = ids.filter((id) => id !== rootId).concat(rootId);
  for (const id of ordered) {
    deleteSessionById(id);
  }
  scheduleCanvasSave();
}

function managerTeamSessions(managerId) {
  return state.sessions.filter(
    (session) =>
      session &&
      session.managerId === managerId &&
      session.nodeRole !== 'manager' &&
      !session.archivedAt
  );
}

function layoutManagerTeam(managerId) {
  const managerNode = canvasState.nodes[managerId];
  if (!managerNode) return;
  managerTeamSessions(managerId).forEach((session, index) => {
    const node = canvasState.nodes[session.id];
    if (!node) return;
    const column = index % 2;
    const row = Math.floor(index / 2);
    node.x =
      (Number(managerNode.x) || 0) +
      column * (CANVAS_GROUP_WIDTH + 36);
    node.y =
      (Number(managerNode.y) || 0) +
      Math.max(
        Number(managerNode.height) || 0,
        CANVAS_MANAGER_GROUP_HEIGHT
      ) +
      34 +
      row * (220 + 36);
  });
  renderCanvas();
  scheduleCanvasSave();
}

async function stopManagerTeam(managerId) {
  const ids = [
    managerId,
    ...managerTeamSessions(managerId).map((session) => session.id),
  ];
  for (const id of ids) {
    try {
      const active = await api.activeRun(id);
      if (active?.runId) await api.cancelRun(active.runId);
    } catch {
      /* ignore individual stop failures */
    }
  }
}

function deleteManagerNode(managerId) {
  const manager = state.sessions.find(
    (session) => session.id === managerId
  );
  if (!manager) return;
  openConfirm({
    text: '删除这个管理 node？它创建的工作 node 会保留为未归属，不会被删除。',
    action: async () => {
      for (const session of state.sessions) {
        if (session.managerId === managerId) {
          session.managerId = null;
        }
      }
      await window.flushChats?.();
      try {
        await api.deleteSession(managerId);
      } catch (error) {
        console.error('delete manager failed', error);
      }
      state.sessions = state.sessions.filter(
        (session) => session.id !== managerId
      );
      delete canvasState.nodes[managerId];
      if (canvasState.selectedId === managerId) canvasClearSelection();
      renderCanvas();
      scheduleCanvasSave();
      await window.refreshChats?.();
      await reloadCanvas();
    },
  });
}

function openCanvasNodeMenu(sessionId, x, y) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  if (session.nodeRole === 'manager') {
    openActionMenu({
      x,
      y,
      items: [
        {
          label: '打开对话',
          icon: '<path d="M5 12h14M13 6l6 6-6 6"/>',
          action: () => openCanvasSession(session.id),
        },
        {
          label: '配置',
          icon: RING_ICONS.settings,
          action: () => window.openManagerComposer?.(session.id),
        },
        {
          label: '自动整理',
          icon: RING_ICONS.folder,
          action: () => layoutManagerTeam(session.id),
        },
        {
          label: '停止全部',
          icon: RING_ICONS.close,
          action: () => void stopManagerTeam(session.id),
        },
        {
          label: '删除管理 node',
          icon: RING_ICONS.trash,
          danger: true,
          confirm: true,
          action: () => deleteManagerNode(session.id),
        },
      ],
    });
    return;
  }
  const index = canvasGroupIndex();
  const root = index.rootFor(session);
  const isRoot = root.id === session.id;
  const groupIds = canvasGroupSessionIds(root.id);
  const items = [
    {
      label: '打开',
      icon: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      action: () => openCanvasSession(session.id),
    },
  ];
  if (session.managerId) {
    items.push({
      label: '打开管理 node',
      icon: RING_ICONS.settings,
      action: () => openCanvasSession(session.managerId),
    });
  }
  items.push({
    label: '归档',
    icon: RING_ICONS.archive,
    action: () => window.openArchiveWindowForSession?.(session.id),
  });
  items.push({
    label: '改名',
    icon: RING_ICONS.rename,
    action: () => openRename('session', session.id),
  });
  items.push({
    label: '删除',
    icon: RING_ICONS.trash,
    danger: true,
    action: () => {
      if (isRoot && groupIds.length > 1) {
        openConfirm({
          text: `删除这个组和里面的 ${groupIds.length} 个对话？不可恢复。`,
          action: () => deleteCanvasGroup(root.id),
        });
        return;
      }
      openConfirm({
        text: `删除对话「${
          session.title || '未命名'
        }」？不可恢复。`,
        action: () => deleteSessionById(session.id),
      });
    },
  });
  openActionMenu({ x, y, items });
}

function openCanvasWorkspaceMenu(projectId, x, y) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  openActionMenu({
    x,
    y,
    items: [
      {
        label: '编辑',
        icon: RING_ICONS.rename,
        action: () => openProjectDialog('edit', projectId),
      },
      {
        label: '删除',
        icon: RING_ICONS.trash,
        danger: true,
        action: () => confirmDeleteProject(projectId),
      },
    ],
  });
}

function createCanvasManagerNode(sessionId) {
  if (!canvasDom.stage || !sessionId) return;
  if (canvasState.nodes[sessionId]) {
    canvasSelectGroup(sessionId, null);
    return;
  }
  const rect = canvasDom.stage.getBoundingClientRect();
  const width = CANVAS_GROUP_WIDTH;
  const height = CANVAS_GROUP_HEIGHT;
  const viewX = (rect.width / 2 - canvasState.view.x) / canvasState.view.k;
  const viewY = (rect.height / 2 - canvasState.view.y) / canvasState.view.k;
  let x = viewX - width / 2;
  let y = viewY - height / 2;
  const others = Object.values(canvasState.nodes).filter(
    (node) => node && typeof node === 'object'
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const overlaps = others.some(
      (node) =>
        x < node.x + node.width &&
        node.x < x + width &&
        y < node.y + node.height &&
        node.y < y + height
    );
    if (!overlaps) break;
    y += 40;
  }
  canvasState.nodes[sessionId] = {
    x,
    y,
    width,
    height,
    parentSessionId: null,
  };
  canvasSelectGroup(sessionId, null);
  renderCanvas();
  scheduleCanvasSave();
}

function openCanvas() {
  if (!canvasDom.overlay) return;
  if (typeof closeComposer === 'function') closeComposer();
  canvasState.open = true;
  canvasDom.overlay.classList.remove('hidden');
  canvasDom.overlay.setAttribute('aria-hidden', 'false');
  if (!canvasState.loaded) {
    void loadCanvas();
  } else {
    renderCanvas();
  }
  void loadCanvasBackground();
  void loadCanvasRuns();
  scheduleCanvasRunsPoll();
}

function openCanvasWorkspaces() {
  openCanvas();
}

function closeCanvas() {
  if (state.homeWindow) return;
  if (!canvasDom.overlay) return;
  closeSystemNodeModal();
  canvasState.open = false;
  canvasState.pageOpen = false;
  canvasState.runsRequest += 1;
  clearTimeout(canvasState.runsTimer);
  canvasState.runsTimer = null;
  endWorkspaceDrag();
  clearTimeout(canvasState.pageTimer);
  canvasDom.page?.classList.add('hidden');
  canvasDom.page?.classList.remove('open');
  canvasDom.overlay.classList.add('hidden');
  canvasDom.overlay.setAttribute('aria-hidden', 'true');
  canvasState.drag = null;
  canvasState.managerDrag = null;
  canvasState.frameDrag = null;
  canvasState.marquee = null;
  canvasState.pan = null;
  canvasDom.marquee?.classList.add('hidden');
  canvasDom.frames
    ?.querySelectorAll('.canvas-frame.dragging')
    .forEach((frame) => frame.classList.remove('dragging'));
  canvasDom.stage?.classList.remove('marquee');
  canvasDom.stage?.classList.remove('panning');
  document.body.classList.remove('canvas-space');
  document.body.classList.remove('canvas-window-dragging');
  canvasDom.stage?.classList.remove('drop-target');
  void saveCanvasNow();
}

function canvasOverlayOpen() {
  return Boolean(
    canvasState.open &&
      canvasDom.overlay &&
      !canvasDom.overlay.classList.contains('hidden')
  );
}

function refreshCanvas() {
  if (!canvasOverlayOpen()) return;
  if (
    canvasState.drag ||
    canvasState.frameDrag ||
    canvasState.marquee ||
    canvasState.workspaceDrag
  ) {
    return;
  }
  renderCanvas();
  void loadCanvasBackground();
  void loadCanvasRuns();
  scheduleCanvasRunsPoll();
}

async function reloadCanvas() {
  if (!canvasOverlayOpen()) return;
  try {
    const data = await requestJson('/api/canvas');
    clearTimeout(canvasState.saveTimer);
    canvasState.saveTimer = null;
    canvasState.view = canvasNormalizeView(data?.view);
    canvasState.nodes =
      data?.nodes && typeof data.nodes === 'object' ? data.nodes : {};
    canvasState.frames = [];
    canvasState.systemNodes = Array.isArray(data?.systemNodes)
      ? data.systemNodes
      : [];
    canvasState.loaded = true;
    renderCanvas();
    clearTimeout(canvasState.saveTimer);
    canvasState.saveTimer = null;
    applyCanvasView();
  } catch (error) {
    console.error('reload canvas failed', error);
  }
}

/* --------------------------------- 存储 --------------------------------- */

function scheduleCanvasSave() {
  clearTimeout(canvasState.saveTimer);
  canvasState.saveTimer = setTimeout(saveCanvasNow, 350);
}

async function saveCanvasNow() {
  clearTimeout(canvasState.saveTimer);
  canvasState.saveTimer = null;
  if (!canvasState.loaded) return;
  try {
    await requestJson('/api/canvas', {
      method: 'POST',
      body: {
        view: canvasState.view,
        nodes: canvasState.nodes,
        frames: canvasState.frames,
        wires: [],
      },
    });
  } catch (error) {
    console.error('save canvas failed', error);
  }
}

async function loadCanvas() {
  const request = ++canvasState.request;
  canvasState.loading = true;
  let data = null;
  try {
    data = await requestJson('/api/canvas');
  } catch (error) {
    console.error('load canvas failed', error);
  }
  if (request !== canvasState.request) return;
  canvasState.view = canvasNormalizeView(data?.view);
  canvasState.nodes =
    data?.nodes && typeof data.nodes === 'object'
      ? { ...data.nodes }
      : {};
  canvasState.systemNodes = Array.isArray(data?.systemNodes)
    ? data.systemNodes
    : [];
  canvasState.frames = Array.isArray(data?.frames)
    ? data.frames
        .map((frame) => {
          if (!frame || typeof frame !== 'object') return null;
          const id = String(frame.id || '').trim();
          const nodeIds = Array.isArray(frame.nodeIds)
            ? [...new Set(frame.nodeIds.map(String).filter(Boolean))]
            : [];
          return id && nodeIds.length > 0 ? { id, nodeIds } : null;
        })
        .filter(Boolean)
    : [];
  canvasState.loaded = true;
  canvasState.loading = false;
  renderCanvas();
  void loadCanvasBackground();
}

/* --------------------------------- 事件 --------------------------------- */

function bindCanvasEvents() {
  canvasDom.addWorkspace?.addEventListener('click', () => {
    openProjectDialog('new');
  });

  canvasDom.stage?.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '.canvas-workspaces-page, .canvas-zoom-indicator, button'
        )
      ) {
        return;
      }
      canvasState.pan = {
        startX: event.clientX,
        startY: event.clientY,
        viewX: canvasState.view.x,
        viewY: canvasState.view.y,
        moved: false,
      };
      canvasDom.stage.classList.add('panning');
      try {
        canvasDom.stage.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if (window.canvasSpaceHeld?.()) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        '.canvas-group, .canvas-manager, .canvas-manager-panel, .canvas-manager-group, .canvas-frame, .manager-composer, .canvas-workspaces-page, .canvas-zoom-indicator, button'
      )
    ) {
      return;
    }
    if (event.shiftKey) startCanvasMarquee(event);
  });

  canvasDom.stage?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  canvasDom.stage?.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
      return;
    }
    if (document.body.classList.contains('canvas-window-dragging')) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('.canvas-group, .canvas-manager, .canvas-manager-panel, .canvas-manager-group, .canvas-frame, .manager-composer, .canvas-workspaces-page, button')
    ) {
      return;
    }
    canvasClearSelection();
  });

  canvasDom.stage?.addEventListener(
    'wheel',
    (event) => {
      if (canvasState.pageOpen) return;
      event.preventDefault();
      const rect = canvasDom.stage.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomCanvas(factor, event.clientX - rect.left, event.clientY - rect.top);
      flashZoomIndicator();
    },
    { passive: false }
  );

  document.addEventListener('pointermove', onCanvasPointerMove, true);
  document.addEventListener('pointerup', onCanvasPointerUp, true);
  document.addEventListener('pointercancel', onCanvasPointerUp, true);
}

window.openCanvas = openCanvas;
window.openCanvasWorkspaces = openCanvasWorkspaces;
window.closeCanvas = closeCanvas;
window.canvasOverlayOpen = canvasOverlayOpen;
window.canvasWorkspacePageOpen = canvasWorkspacePageOpen;
window.canvasTabReleased = canvasTabReleased;
window.cancelCanvasPage = cancelCanvasPage;
window.refreshCanvas = refreshCanvas;
window.reloadCanvas = reloadCanvas;
window.createCanvasManagerNode = createCanvasManagerNode;
window.openCanvasNodeMenu = openCanvasNodeMenu;
window.openCanvasFrameMenu = openCanvasFrameMenu;
window.openCanvasWorkspaceMenu = openCanvasWorkspaceMenu;

bindCanvasEvents();

async function syncWorknodes() {
  if (!canvasOverlayOpen()) return;
  if (
    canvasState.drag ||
    canvasState.managerDrag ||
    canvasState.frameDrag ||
    canvasState.marquee ||
    canvasState.pan ||
    canvasState.workspaceDrag
  ) {
    canvasState.pendingWorknodes = true;
    return;
  }
  canvasState.pendingWorknodes = false;
  await window.refreshChats?.();
  await window.reloadCanvas?.();
}

api.onWorknodesChanged?.(() => {
  void syncWorknodes();
});

api.onSystemNodesChanged?.(() => {
  if (!canvasOverlayOpen()) return;
  void reloadCanvas();
});

api.onSubagentStarted((payload) => {
  if (!payload?.sessionId) return;
  const session = state.sessions.find(
    (item) => item.id === payload.sessionId
  );
  if (session && payload.parentSessionId) {
    session.parentSessionId = payload.parentSessionId;
  }
  if (
    canvasOverlayOpen() &&
    !canvasState.drag &&
    !canvasState.managerDrag &&
    !canvasState.frameDrag &&
    !canvasState.marquee &&
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
    scheduleCanvasSave();
  }
});

api.onSubagentComplete((payload) => {
  const session = payload?.sessionId
    ? state.sessions.find((item) => item.id === payload.sessionId)
    : null;
  if (session) {
    session.archivedAt = payload?.endedAt || Date.now();
    session.archivedStatus = payload?.status || 'done';
  }
  if (
    canvasOverlayOpen() &&
    !canvasState.drag &&
    !canvasState.managerDrag &&
    !canvasState.frameDrag &&
    !canvasState.marquee &&
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
    scheduleCanvasSave();
  }
});

api.onBackgroundUpdate((payload) => {
  if (!payload?.sessionId) return;
  mergeCanvasBackgroundJob(payload);
  if (
    canvasOverlayOpen() &&
    !canvasState.drag &&
    !canvasState.managerDrag &&
    !canvasState.frameDrag &&
    !canvasState.marquee &&
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
  }
});

api.onBackgroundComplete((payload) => {
  if (!payload?.sessionId) return;
  mergeCanvasBackgroundJob(payload);
  if (
    canvasOverlayOpen() &&
    !canvasState.drag &&
    !canvasState.managerDrag &&
    !canvasState.frameDrag &&
    !canvasState.marquee &&
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
  }
});
