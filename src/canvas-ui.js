'use strict';

const canvasDom = {
  overlay: document.getElementById('canvas'),
  stage: document.getElementById('canvas-stage'),
  grid: document.getElementById('canvas-grid'),
  world: document.getElementById('canvas-world'),
  zoomLayer: document.getElementById('canvas-zoom'),
  nodes: document.getElementById('canvas-nodes'),
  empty: document.getElementById('canvas-empty'),
  zoomIndicator: document.getElementById('canvas-zoom-indicator'),
  page: document.getElementById('canvas-workspaces-page'),
  workspaces: document.getElementById('canvas-workspaces'),
  addWorkspace: document.getElementById('canvas-add-workspace'),
};

const CANVAS_GROUP_WIDTH = 280;
const CANVAS_GROUP_HEIGHT = 60;
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
  selectedId: null,
  selectedChildId: null,
  drag: null,
  pan: null,
  workspaceDrag: null,
  backgroundBySession: {},
  backgroundFetched: {},
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
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
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
        x: 80 + col * 360,
        y: 80 + row * 300,
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

function canvasGroupWidth(children, jobs) {
  return (
    CANVAS_GROUP_WIDTH +
    (children.length > 0 ? 16 : 0) +
    (jobs.length > 0 ? 8 : 0)
  );
}

function canvasGroupJobs(root, children) {
  const jobs = [];
  for (const session of [root, ...children]) {
    const list = canvasState.backgroundBySession[session.id];
    if (Array.isArray(list)) jobs.push(...list);
  }
  return jobs.sort((left, right) => {
    const leftRunning = left.status === 'running' ? 0 : 1;
    const rightRunning = right.status === 'running' ? 0 : 1;
    if (leftRunning !== rightRunning) return leftRunning - rightRunning;
    return (right.startedAt || 0) - (left.startedAt || 0);
  });
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
  if (canvasState.drag || canvasState.workspaceDrag) return;
  renderCanvas();
}

/* -------------------------------- 组渲染 -------------------------------- */

function buildCanvasDot(tone) {
  return el('span', `canvas-dot ${tone}`);
}

function buildCanvasChild(child, root) {
  const childEl = el('div', 'canvas-child');
  childEl.dataset.sessionId = child.id;
  if (canvasState.selectedChildId === child.id) {
    childEl.classList.add('selected');
  }
  childEl.append(buildCanvasDot(canvasConversationStatus(child).tone));
  if (child.subagent) {
    childEl.append(el('span', 'canvas-child-arrow', '↳'));
  }
  childEl.append(
    el('span', 'canvas-child-title', child.title || '未命名对话')
  );
  childEl.title = child.title || '未命名对话';

  childEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (canvasState.suppressClick) {
      canvasState.suppressClick = false;
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
  row.append(buildCanvasDot(status));
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

function buildCanvasGroup(root, children, jobs, node) {
  const groupEl = el('article', 'canvas-group');
  groupEl.dataset.sessionId = root.id;
  if (canvasState.selectedId === root.id) {
    groupEl.classList.add('selected');
  }

  const head = el('header', 'canvas-group-head');
  head.append(buildCanvasDot(canvasConversationStatus(root).tone));
  head.append(
    el('span', 'canvas-group-title', root.title || '未命名对话')
  );
  const add = el('button', 'canvas-group-add', '+');
  add.type = 'button';
  add.title = '在组内新建对话';
  add.setAttribute('aria-label', '在组内新建对话');
  add.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    createCanvasChildSession(root.id);
  });
  head.append(add);
  groupEl.append(head);

  if (children.length > 0 || jobs.length > 0) {
    const rows = el('div', 'canvas-group-rows');
    children.forEach((child) => {
      rows.append(buildCanvasChild(child, root));
    });
    if (children.length > 0 && jobs.length > 0) {
      rows.append(el('div', 'canvas-group-divider'));
    }
    jobs.forEach((job) => {
      rows.append(buildCanvasTask(job));
    });
    groupEl.append(rows);
  }

  groupEl.title = root.title || '未命名对话';
  groupEl.addEventListener('pointerdown', (event) => {
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
  const measured = [];
  for (const root of roots) {
    const node = canvasState.nodes[root.id];
    if (!node) continue;
    const children = childrenByRoot.get(root.id) || [];
    const jobs = canvasGroupJobs(root, children);
    const groupEl = buildCanvasGroup(root, children, jobs, node);
    groupEl.style.left = `${node.x}px`;
    groupEl.style.top = `${node.y}px`;
    groupEl.style.width = `${canvasGroupWidth(children, jobs)}px`;
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
    }
  }
  if (dirty) scheduleCanvasSave();
}

function applyCanvasView() {
  const view = canvasState.view;
  const layoutZoom = view.k >= 1;
  if (canvasDom.zoomLayer) {
    canvasDom.zoomLayer.style.zoom = layoutZoom ? String(view.k) : '1';
  }
  if (canvasDom.world) {
    const translate = `translate3d(${view.x}px, ${view.y}px, 0)`;
    canvasDom.world.style.transform = layoutZoom
      ? translate
      : `${translate} scale(${view.k})`;
  }
  if (canvasDom.grid) {
    canvasDom.grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
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

function canvasSelectGroup(rootId, childId = null) {
  canvasState.selectedId = rootId;
  canvasState.selectedChildId = childId;
  for (const group of canvasDom.nodes.querySelectorAll('.canvas-group')) {
    group.classList.toggle(
      'selected',
      group.dataset.sessionId === rootId
    );
  }
  for (const child of canvasDom.nodes.querySelectorAll('.canvas-child')) {
    child.classList.toggle(
      'selected',
      child.dataset.sessionId === childId
    );
  }
}

function canvasClearSelection() {
  canvasState.selectedId = null;
  canvasState.selectedChildId = null;
  for (const item of canvasDom.nodes.querySelectorAll(
    '.canvas-group.selected, .canvas-child.selected'
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

function canvasGroupAtPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  return target.closest('.canvas-group');
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
    targetGroupId: null,
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
  const group = canvasGroupAtPoint(drag.x, drag.y);
  drag.targetGroupId = group?.dataset.sessionId || null;
  for (const item of canvasDom.nodes.querySelectorAll('.canvas-group')) {
    item.classList.toggle(
      'drop-into',
      item.dataset.sessionId === drag.targetGroupId
    );
  }
  canvasDom.stage?.classList.toggle(
    'drop-target',
    !drag.targetGroupId && pointInStage(drag.x, drag.y)
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
  for (const item of canvasDom.nodes.querySelectorAll('.canvas-group')) {
    item.classList.remove('drop-into');
  }
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
          groupId: drag.targetGroupId,
        }
      : null;
  endWorkspaceDrag();
  if (drop) {
    createCanvasConversationAt(
      drop.projectId,
      drop.x,
      drop.y,
      drop.groupId
    );
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
    pointerId: event.pointerId,
  };
  canvasSelectGroup(root.id, null);
  try {
    groupEl.setPointerCapture(event.pointerId);
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
    drag.groupEl.style.left = `${drag.node.x}px`;
    drag.groupEl.style.top = `${drag.node.y}px`;
    event.preventDefault();
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
      drag.groupEl.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    canvasState.drag = null;
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

function createCanvasChildSession(rootId, projectId = null) {
  const root = state.sessions.find((session) => session.id === rootId);
  if (!root) return null;
  const session = createCanvasSession(
    projectId || root.projectId,
    root.id
  );
  if (!session) return null;
  canvasState.selectedId = root.id;
  canvasState.selectedChildId = session.id;
  renderCanvas();
  revealCanvasChild(session.id);
  scheduleCanvasSave();
  return session;
}

function revealCanvasChild(sessionId) {
  const child = canvasDom.nodes?.querySelector(
    `[data-session-id="${sessionId}"]`
  );
  const stage = canvasDom.stage;
  if (!child || !stage) return;
  const stageRect = stage.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const pad = 28;
  let dx = 0;
  let dy = 0;
  if (childRect.right > stageRect.right - pad) {
    dx = stageRect.right - pad - childRect.right;
  } else if (childRect.left < stageRect.left + pad) {
    dx = stageRect.left + pad - childRect.left;
  }
  if (childRect.bottom > stageRect.bottom - pad) {
    dy = stageRect.bottom - pad - childRect.bottom;
  } else if (childRect.top < stageRect.top + pad) {
    dy = stageRect.top + pad - childRect.top;
  }
  if (dx !== 0 || dy !== 0) {
    canvasState.view.x += dx;
    canvasState.view.y += dy;
    applyCanvasView();
  }
}

function createCanvasConversationAt(
  projectId,
  clientX,
  clientY,
  groupId = null
) {
  if (groupId) {
    const root = state.sessions.find((session) => session.id === groupId);
    if (root) {
      createCanvasChildSession(root.id, projectId);
      return;
    }
  }
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

function openCanvasNodeMenu(sessionId, x, y) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
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
  if (isRoot) {
    items.push({
      label: '在组内新建对话',
      icon: '<path d="M12 5v14M5 12h14"/>',
      action: () => createCanvasChildSession(root.id),
    });
  }
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
  if (canvasState.drag || canvasState.workspaceDrag) return;
  renderCanvas();
  if (canvasState.pageOpen) renderWorkspacePage();
  void loadCanvasBackground();
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
    // 中键拖拽平移画布视角；Electron 里左键留给窗口和 node 拖动
    const allowPan = event.button === 1 || (event.button === 0 && !api.isElectron);
    if (!allowPan) return;
    if (
      event.target instanceof Element &&
      (event.target.closest(
        '.canvas-workspaces-page, .canvas-zoom-indicator'
      ) ||
        (event.button === 0 && event.target.closest('button')))
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
    canvasClearSelection();
    canvasDom.stage.classList.add('panning');
    try {
      canvasDom.stage.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  });

  canvasDom.stage?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  canvasDom.stage?.addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.canvas-group, .canvas-workspaces-page, button')
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
window.openCanvasNodeMenu = openCanvasNodeMenu;
window.openCanvasWorkspaceMenu = openCanvasWorkspaceMenu;

bindCanvasEvents();

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
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
    scheduleCanvasSave();
  }
});

api.onSubagentComplete(() => {
  if (
    canvasOverlayOpen() &&
    !canvasState.drag &&
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
    !canvasState.workspaceDrag
  ) {
    renderCanvas();
  }
});
