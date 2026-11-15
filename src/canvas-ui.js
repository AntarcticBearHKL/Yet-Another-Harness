'use strict';

const canvasDom = {
  overlay: document.getElementById('canvas'),
  workspaces: document.getElementById('canvas-workspaces'),
  addWorkspace: document.getElementById('canvas-add-workspace'),
  close: document.getElementById('canvas-close'),
  stage: document.getElementById('canvas-stage'),
  grid: document.getElementById('canvas-grid'),
  world: document.getElementById('canvas-world'),
  wires: document.getElementById('canvas-wires'),
  nodes: document.getElementById('canvas-nodes'),
  empty: document.getElementById('canvas-empty'),
  zoomIn: document.getElementById('canvas-zoom-in'),
  zoomOut: document.getElementById('canvas-zoom-out'),
  zoomLabel: document.getElementById('canvas-zoom-label'),
  fit: document.getElementById('canvas-fit'),
};

const CANVAS_NODE_WIDTH = 280;
const CANVAS_NODE_HEIGHT = 170;
const CANVAS_GRID_SIZE = 24;
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

const canvasState = {
  open: false,
  loaded: false,
  loading: false,
  view: { x: 0, y: 0, k: 1 },
  nodes: {},
  wires: [],
  selectedId: null,
  selectedProjectId: null,
  drag: null,
  pan: null,
  saveTimer: null,
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
  const index = state.projects.findIndex(
    (item) => item.id === project?.id
  );
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

function canvasSessionStatus(session) {
  if (session.subagent) {
    return { label: '子代理', tone: 'subagent' };
  }
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

function renderCanvasSidebar() {
  if (!canvasDom.workspaces) return;
  canvasDom.workspaces.replaceChildren();
  const projects = Array.isArray(state.projects) ? state.projects : [];
  if (projects.length === 0) {
    canvasDom.workspaces.append(
      el('div', 'canvas-sidebar-empty', '还没有工作区，点 + 新建一个。')
    );
    return;
  }
  projects.forEach((project) => {
    const row = el('div', 'canvas-workspace');
    row.draggable = true;
    row.dataset.projectId = project.id;
    row.style.setProperty(
      '--canvas-workspace-color',
      canvasWorkspaceColor(project)
    );
    if (canvasState.selectedProjectId === project.id) {
      row.classList.add('selected');
    }
    row.append(el('span', 'canvas-workspace-dot'));
    const copy = el('div', 'canvas-workspace-copy');
    copy.append(
      el('span', 'canvas-workspace-name', project.name || '未命名工作区')
    );
    const directoryCount = Array.isArray(project.directories)
      ? project.directories.length
      : 0;
    copy.append(
      el(
        'span',
        'canvas-workspace-meta',
        `${directoryCount} 个目录 · ${canvasWorkspaceSessionCount(
          project.id
        )} 个对话`
      )
    );
    row.append(copy);
    const actions = el('div', 'canvas-workspace-actions');
    const edit = el('button', 'canvas-workspace-action', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      openProjectDialog('edit', project.id);
    });
    const remove = el('button', 'canvas-workspace-action danger', '×');
    remove.type = 'button';
    remove.title = '删除工作区';
    remove.setAttribute('aria-label', `删除工作区 ${project.name || ''}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      openConfirm({
        text: `删除工作区「${project.name || '未命名'}」以及里面的 ${canvasWorkspaceSessionCount(
          project.id
        )} 个对话？不可恢复。`,
        action: () => deleteProject(project.id),
      });
    });
    actions.append(edit, remove);
    row.append(actions);
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      canvasState.selectedProjectId =
        canvasState.selectedProjectId === project.id ? null : project.id;
      renderCanvas();
    });
    row.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', project.id);
      event.dataTransfer.setData('application/x-yah-workspace', project.id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
    });
    canvasDom.workspaces.append(row);
  });
}

function renderCanvasNodes() {
  if (!canvasDom.nodes) return;
  canvasDom.nodes.replaceChildren();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  for (const session of sessions) {
    const node = canvasState.nodes[session.id];
    if (!node) continue;
    const project = canvasWorkspaceFor(session);
    const nodeEl = el('div', 'canvas-node');
    nodeEl.dataset.sessionId = session.id;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.width = `${node.width}px`;
    nodeEl.style.height = `${node.height}px`;
    nodeEl.style.setProperty(
      '--canvas-workspace-color',
      canvasWorkspaceColor(project)
    );
    if (canvasState.selectedId === session.id) {
      nodeEl.classList.add('selected');
    }
    if (
      canvasState.selectedProjectId &&
      session.projectId !== canvasState.selectedProjectId
    ) {
      nodeEl.classList.add('dimmed');
    }
    const head = el('div', 'canvas-node-head');
    head.append(el('span', 'canvas-node-dot'));
    head.append(
      el(
        'span',
        'canvas-node-workspace',
        project?.name || '未归属工作区'
      )
    );
    const status = canvasSessionStatus(session);
    head.append(
      el('span', `canvas-node-status ${status.tone}`, status.label)
    );
    nodeEl.append(head);
    nodeEl.append(
      el('div', 'canvas-node-title', session.title || '未命名对话')
    );
    const body = el('div', 'canvas-node-body');
    body.append(
      el('span', 'canvas-node-preview', canvasSessionPreview(session))
    );
    nodeEl.append(body);
    const foot = el('div', 'canvas-node-foot');
    foot.append(el('span', 'canvas-node-agent', canvasAgentName(session)));
    foot.append(el('span', '', '·'));
    foot.append(
      el(
        'span',
        '',
        `${Array.isArray(session.msgs) ? session.msgs.length : 0} 条`
      )
    );
    nodeEl.append(foot);
    nodeEl.title = session.title || '未命名对话';
    nodeEl.addEventListener('pointerdown', (event) => {
      startCanvasNodeDrag(event, session, nodeEl, node);
    });
    nodeEl.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      if (canvasState.suppressClick) {
        canvasState.suppressClick = false;
        return;
      }
      canvasState.selectedId = session.id;
      for (const item of canvasDom.nodes.querySelectorAll(
        '.canvas-node.selected'
      )) {
        item.classList.remove('selected');
      }
      nodeEl.classList.add('selected');
    });
    nodeEl.addEventListener('dblclick', (event) => {
      event.preventDefault();
      openCanvasSession(session.id);
    });
    canvasDom.nodes.append(nodeEl);
  }
}

function renderCanvasWires() {
  if (!canvasDom.wires) return;
  canvasDom.wires.replaceChildren();
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  for (const session of sessions) {
    if (!session.subagent) continue;
    const node = canvasState.nodes[session.id];
    const parentId = session.parentSessionId || node?.parentSessionId;
    if (!node || !parentId) continue;
    const parent = canvasState.nodes[parentId];
    if (!parent) continue;
    const x1 = parent.x + parent.width;
    const y1 = parent.y + parent.height / 2;
    const x2 = node.x;
    const y2 = node.y + node.height / 2;
    const bend = Math.max(48, Math.abs(x2 - x1) * 0.42);
    const path = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    );
    path.setAttribute(
      'd',
      `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
    );
    path.setAttribute('class', 'subagent');
    canvasDom.wires.append(path);
  }
}

function applyCanvasView() {
  const view = canvasState.view;
  if (canvasDom.world) {
    canvasDom.world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`;
  }
  if (canvasDom.grid) {
    const size = CANVAS_GRID_SIZE * view.k;
    canvasDom.grid.style.backgroundSize = `${size}px ${size}px`;
    canvasDom.grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
  }
  if (canvasDom.zoomLabel) {
    canvasDom.zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
  }
}

function renderCanvas() {
  renderCanvasSidebar();
  renderCanvasNodes();
  renderCanvasWires();
  applyCanvasView();
  if (canvasDom.empty) {
    const hasNodes = (state.sessions || []).some(
      (session) => canvasState.nodes[session.id]
    );
    canvasDom.empty.classList.toggle('hidden', hasNodes);
  }
}

function ensureCanvasNodes() {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const ids = new Set(sessions.map((session) => session.id));
  let dirty = false;
  for (const id of Object.keys(canvasState.nodes)) {
    if (!ids.has(id)) {
      delete canvasState.nodes[id];
      dirty = true;
    }
  }
  const projectOrder = new Map(
    (state.projects || []).map((project, index) => [project.id, index])
  );
  const rowCounts = new Map();
  for (const session of sessions) {
    let node = canvasState.nodes[session.id];
    if (!node) {
      const parentId = session.parentSessionId;
      const parent = parentId ? canvasState.nodes[parentId] : null;
      if (parent) {
        const childCount = Object.values(canvasState.nodes).filter(
          (item) => item?.parentSessionId === parentId
        ).length;
        node = {
          x: parent.x + 320,
          y: parent.y + 60 + childCount * 190,
          width: CANVAS_NODE_WIDTH,
          height: CANVAS_NODE_HEIGHT,
          parentSessionId: parentId,
        };
      } else {
        const projectIndex = projectOrder.get(session.projectId) ?? 0;
        const row = rowCounts.get(session.projectId) || 0;
        rowCounts.set(session.projectId, row + 1);
        node = {
          x: 80 + projectIndex * 360,
          y: 80 + row * 210,
          width: CANVAS_NODE_WIDTH,
          height: CANVAS_NODE_HEIGHT,
          parentSessionId: null,
        };
      }
      canvasState.nodes[session.id] = node;
      dirty = true;
    }
    if (
      session.subagent &&
      !session.parentSessionId &&
      !node.parentSessionId
    ) {
      const sessionIndex = sessions.indexOf(session);
      for (let i = sessionIndex - 1; i >= 0; i -= 1) {
        if (!sessions[i].subagent) {
          session.parentSessionId = sessions[i].id;
          node.parentSessionId = sessions[i].id;
          dirty = true;
          break;
        }
      }
    }
    if (
      session.parentSessionId &&
      node.parentSessionId !== session.parentSessionId
    ) {
      node.parentSessionId = session.parentSessionId;
      dirty = true;
    }
    if (!session.parentSessionId && node.parentSessionId) {
      session.parentSessionId = node.parentSessionId;
    }
  }
  if (dirty) scheduleCanvasSave();
}

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
        wires: canvasState.wires,
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
  canvasState.wires = Array.isArray(data?.wires) ? data.wires : [];
  const hadNodes = Object.keys(canvasState.nodes).length > 0;
  canvasState.loaded = true;
  canvasState.loading = false;
  ensureCanvasNodes();
  renderCanvas();
  if (!hadNodes) {
    fitCanvas({ save: false });
    scheduleCanvasSave();
  }
}

function fitCanvas({ save = true } = {}) {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const nodes = sessions
    .map((session) => canvasState.nodes[session.id])
    .filter(Boolean);
  if (nodes.length === 0) {
    canvasState.view = { x: 0, y: 0, k: 1 };
    applyCanvasView();
    if (save) scheduleCanvasSave();
    return;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const rect = canvasDom.stage?.getBoundingClientRect();
  const width = Math.max(1, rect?.width || 800);
  const height = Math.max(1, rect?.height || 600);
  const pad = 80;
  const k = canvasClamp(
    Math.min(
      (width - pad * 2) / Math.max(1, maxX - minX),
      (height - pad * 2) / Math.max(1, maxY - minY)
    ),
    CANVAS_MIN_ZOOM,
    1.4
  );
  canvasState.view = {
    k,
    x: (width - (maxX - minX) * k) / 2 - minX * k,
    y: (height - (maxY - minY) * k) / 2 - minY * k,
  };
  applyCanvasView();
  if (save) scheduleCanvasSave();
}

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

function startCanvasNodeDrag(event, session, nodeEl, node) {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('button')) return;
  event.stopPropagation();
  canvasState.drag = {
    sessionId: session.id,
    nodeEl,
    node,
    startX: event.clientX,
    startY: event.clientY,
    originX: node.x,
    originY: node.y,
    moved: false,
    pointerId: event.pointerId,
  };
  canvasState.selectedId = session.id;
  for (const item of canvasDom.nodes.querySelectorAll('.canvas-node.selected')) {
    item.classList.remove('selected');
  }
  nodeEl.classList.add('selected');
  try {
    nodeEl.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function onCanvasPointerMove(event) {
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
    drag.node.x = drag.originX + dx;
    drag.node.y = drag.originY + dy;
    drag.nodeEl.style.left = `${drag.node.x}px`;
    drag.nodeEl.style.top = `${drag.node.y}px`;
    renderCanvasWires();
    event.preventDefault();
    return;
  }
  if (canvasState.pan) {
    const pan = canvasState.pan;
    canvasState.view.x = pan.viewX + (event.clientX - pan.startX);
    canvasState.view.y = pan.viewY + (event.clientY - pan.startY);
    applyCanvasView();
    scheduleCanvasSave();
    event.preventDefault();
  }
}

function onCanvasPointerUp() {
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
      drag.nodeEl.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    canvasState.drag = null;
  }
  if (canvasState.pan) {
    canvasState.pan = null;
    canvasDom.stage?.classList.remove('panning');
    scheduleCanvasSave();
  }
}

function openCanvasSession(sessionId) {
  const index = state.sessions.findIndex(
    (session) => session.id === sessionId
  );
  if (index < 0) return;
  closeCanvas();
  selectSession(index);
  openComposer();
}

function createCanvasConversation(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  closeCanvas();
  newSession(project.id);
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
    ensureCanvasNodes();
    renderCanvas();
  }
}

function closeCanvas() {
  if (!canvasDom.overlay) return;
  canvasState.open = false;
  canvasDom.overlay.classList.add('hidden');
  canvasDom.overlay.setAttribute('aria-hidden', 'true');
  canvasState.drag = null;
  canvasState.pan = null;
  canvasDom.stage?.classList.remove('panning');
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
  ensureCanvasNodes();
  renderCanvas();
}

function bindCanvasEvents() {
  canvasDom.close?.addEventListener('click', closeCanvas);
  document.getElementById('canvas-agile')?.addEventListener('click', () => {
    closeCanvas();
    window.openAgile?.();
  });
  document.getElementById('canvas-settings')?.addEventListener('click', () => {
    closeCanvas();
    openSettings();
  });
  canvasDom.addWorkspace?.addEventListener('click', () => {
    openProjectDialog('new');
  });
  canvasDom.zoomIn?.addEventListener('click', () => zoomCanvas(1.2));
  canvasDom.zoomOut?.addEventListener('click', () => zoomCanvas(1 / 1.2));
  canvasDom.fit?.addEventListener('click', () => fitCanvas());

  canvasDom.stage?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest('.canvas-node, .canvas-dock, button')
    ) {
      return;
    }
    canvasState.pan = {
      startX: event.clientX,
      startY: event.clientY,
      viewX: canvasState.view.x,
      viewY: canvasState.view.y,
    };
    canvasState.selectedId = null;
    for (const item of canvasDom.nodes.querySelectorAll(
      '.canvas-node.selected'
    )) {
      item.classList.remove('selected');
    }
    canvasDom.stage.classList.add('panning');
    try {
      canvasDom.stage.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  });

  canvasDom.stage?.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvasDom.stage.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomCanvas(factor, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false }
  );

  canvasDom.stage?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvasDom.stage.classList.add('drop-target');
  });
  canvasDom.stage?.addEventListener('dragleave', (event) => {
    if (
      event.relatedTarget instanceof Node &&
      canvasDom.stage.contains(event.relatedTarget)
    ) {
      return;
    }
    canvasDom.stage.classList.remove('drop-target');
  });
  canvasDom.stage?.addEventListener('drop', (event) => {
    event.preventDefault();
    canvasDom.stage.classList.remove('drop-target');
    const projectId =
      event.dataTransfer?.getData('application/x-yah-workspace') ||
      event.dataTransfer?.getData('text/plain');
    if (projectId) createCanvasConversation(projectId);
  });

  document.addEventListener('pointermove', onCanvasPointerMove, true);
  document.addEventListener('pointerup', onCanvasPointerUp, true);
  document.addEventListener('pointercancel', onCanvasPointerUp, true);
}

window.openCanvas = openCanvas;
window.closeCanvas = closeCanvas;
window.canvasOverlayOpen = canvasOverlayOpen;
window.refreshCanvas = refreshCanvas;

bindCanvasEvents();

api.onSubagentStarted((payload) => {
  if (!payload?.sessionId) return;
  const parent = payload.parentSessionId
    ? canvasState.nodes[payload.parentSessionId]
    : null;
  if (parent && !canvasState.nodes[payload.sessionId]) {
    const childCount = Object.values(canvasState.nodes).filter(
      (item) => item?.parentSessionId === payload.parentSessionId
    ).length;
    canvasState.nodes[payload.sessionId] = {
      x: parent.x + 320,
      y: parent.y + 60 + childCount * 190,
      width: CANVAS_NODE_WIDTH,
      height: CANVAS_NODE_HEIGHT,
      parentSessionId: payload.parentSessionId,
    };
    scheduleCanvasSave();
  }
  const session = state.sessions.find(
    (item) => item.id === payload.sessionId
  );
  if (session && payload.parentSessionId) {
    session.parentSessionId = payload.parentSessionId;
  }
  if (canvasOverlayOpen()) {
    ensureCanvasNodes();
    renderCanvas();
  }
});

api.onSubagentComplete(() => {
  if (canvasOverlayOpen()) {
    ensureCanvasNodes();
    renderCanvas();
  }
});

