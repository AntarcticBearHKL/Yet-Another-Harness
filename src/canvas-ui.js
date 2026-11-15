'use strict';

const canvasDom = {
  overlay: document.getElementById('canvas'),
  stage: document.getElementById('canvas-stage'),
  grid: document.getElementById('canvas-grid'),
  world: document.getElementById('canvas-world'),
  zoomLayer: document.getElementById('canvas-zoom'),
  wires: document.getElementById('canvas-wires'),
  nodes: document.getElementById('canvas-nodes'),
  empty: document.getElementById('canvas-empty'),
  zoomIndicator: document.getElementById('canvas-zoom-indicator'),
  page: document.getElementById('canvas-workspaces-page'),
  workspaces: document.getElementById('canvas-workspaces'),
  addWorkspace: document.getElementById('canvas-add-workspace'),
  close: document.getElementById('canvas-close'),
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
const CANVAS_FOLDER_ICON =
  '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>';

const canvasState = {
  open: false,
  loaded: false,
  loading: false,
  pageOpen: false,
  view: { x: 0, y: 0, k: 1 },
  nodes: {},
  wires: [],
  selectedId: null,
  drag: null,
  pan: null,
  workspaceDrag: null,
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

/* ------------------------------ 工作区管理页 ------------------------------ */

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
        '还没有工作区。点右上角「+ 新建工作区」绑定一个开发目录。'
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
    const actions = el('div', 'canvas-workspace-actions');
    const edit = el('button', 'canvas-workspace-action', '编辑');
    edit.type = 'button';
    edit.title = '编辑工作区';
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
      confirmDeleteProject(project.id);
    });
    actions.append(edit, remove);
    head.append(actions);
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
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      startWorkspaceDrag(event, project);
    });
    card.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }
      openProjectDialog('edit', project.id);
    });

    canvasDom.workspaces.append(card);
  });
}

function showWorkspacePage() {
  if (!canvasDom.page) return;
  renderWorkspacePage();
  canvasDom.page.classList.remove('hidden');
  canvasDom.page.classList.remove('dragging');
  canvasState.pageOpen = true;
  requestAnimationFrame(() => {
    if (!canvasState.pageOpen) return;
    canvasDom.page.classList.add('open');
  });
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
  canvasDom.stage?.classList.toggle(
    'drop-target',
    pointInStage(drag.x, drag.y)
  );
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
      ? { projectId: drag.projectId, x: drag.x, y: drag.y }
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

/* --------------------------------- 画布 --------------------------------- */

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
    const head = el('div', 'canvas-node-head');
    head.append(el('span', 'canvas-node-dot'));
    head.append(
      el('span', 'canvas-node-workspace', project?.name || '未归属工作区')
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
    nodeEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      canvasState.selectedId = session.id;
      for (const item of canvasDom.nodes.querySelectorAll(
        '.canvas-node.selected'
      )) {
        item.classList.remove('selected');
      }
      nodeEl.classList.add('selected');
      openActionMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: '打开',
            icon: '<path d="M5 12h14M13 6l6 6-6 6"/>',
            action: () => openCanvasSession(session.id),
          },
          {
            label: '改名',
            icon: RING_ICONS.rename,
            action: () => openRename('session', session.id),
          },
          {
            label: '删除',
            icon: RING_ICONS.trash,
            danger: true,
            action: () =>
              openConfirm({
                text: `删除对话「${
                  session.title || '未命名'
                }」？不可恢复。`,
                action: () => deleteSessionById(session.id),
              }),
          },
        ],
      });
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
    canvasDom.world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0)`;
  }
  if (canvasDom.zoomLayer) {
    canvasDom.zoomLayer.style.zoom = String(view.k);
  }
  if (canvasDom.grid) {
    canvasDom.grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
  }
  if (canvasDom.zoomIndicator) {
    canvasDom.zoomIndicator.textContent = `${Math.round(view.k * 100)}%`;
  }
}

function renderCanvas() {
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
  canvasState.loaded = true;
  canvasState.loading = false;
  ensureCanvasNodes();
  renderCanvas();
  if (canvasState.pageOpen) renderWorkspacePage();
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

function flashZoomIndicator() {
  if (!canvasDom.zoomIndicator) return;
  canvasDom.zoomIndicator.textContent = `${Math.round(
    canvasState.view.k * 100
  )}%`;
  canvasDom.zoomIndicator.classList.add('visible');
  clearTimeout(canvasState.zoomTimer);
  canvasState.zoomTimer = setTimeout(() => {
    canvasDom.zoomIndicator?.classList.remove('visible');
  }, 520);
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
  if (canvasState.workspaceDrag) {
    updateWorkspaceDrag(event);
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
  if (canvasState.workspaceDrag) {
    finishWorkspaceDrag();
    return;
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

/* ------------------------------- 会话与开关 ------------------------------- */

function openCanvasSession(sessionId) {
  const index = state.sessions.findIndex(
    (session) => session.id === sessionId
  );
  if (index < 0) return;
  const session = state.sessions[index];
  closeCanvas();
  selectSession(index);
  if (!session.subagent) openComposer();
}

function createCanvasSession(projectId) {
  ensureProjects();
  const target =
    state.projects.find((project) => project.id === projectId) ||
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
    system: DEFAULT_SYSTEM_PROMPT,
    agentsMd: null,
    agentId: previous?.agentId || DEFAULT_AGENT_ID,
    projectId: target.id,
    mcpDisabled: ['*'],
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
    x: Math.round(worldX - CANVAS_NODE_WIDTH / 2),
    y: Math.round(worldY - CANVAS_NODE_HEIGHT / 2),
    width: CANVAS_NODE_WIDTH,
    height: CANVAS_NODE_HEIGHT,
    parentSessionId: null,
  };
  canvasState.selectedId = session.id;
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
    ensureCanvasNodes();
    renderCanvas();
  }
}

function openCanvasWorkspaces() {
  openCanvas();
  showWorkspacePage();
}

function closeCanvas() {
  if (!canvasDom.overlay) return;
  canvasState.open = false;
  canvasState.pageOpen = false;
  endWorkspaceDrag();
  clearTimeout(canvasState.pageTimer);
  canvasDom.page?.classList.add('hidden');
  canvasDom.page?.classList.remove('open');
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
  if (canvasState.pageOpen) renderWorkspacePage();
}

/* --------------------------------- 事件 --------------------------------- */

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

  canvasDom.stage?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        '.canvas-workspaces-page, .canvas-zoom-indicator, button'
      )
    ) {
      return;
    }
    if (
      event.button === 0 &&
      event.target instanceof Element &&
      event.target.closest('.canvas-node')
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

  canvasDom.stage?.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('.canvas-node')) {
      return;
    }
    event.preventDefault();
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
