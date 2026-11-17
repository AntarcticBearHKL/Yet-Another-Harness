'use strict';

const agileDom = {
  overlay: document.getElementById('agile'),
  iterations: document.getElementById('agile-iterations'),
  iteration: document.getElementById('agile-iteration'),
  boardMeta: document.getElementById('agile-board-meta'),
  board: document.getElementById('agile-board'),
  search: document.getElementById('agile-search'),
  toast: document.getElementById('agile-toast'),
  addIteration: document.getElementById('agile-add-iteration'),
  boardDetails: document.getElementById('agile-board-details'),
  taskModal: document.getElementById('agile-task-modal'),
  taskKicker: document.getElementById('agile-task-kicker'),
  taskModalTitle: document.getElementById('agile-task-modal-title'),
  taskTitle: document.getElementById('agile-task-title'),
  taskDescription: document.getElementById('agile-task-description'),
  taskReadonlyNote: document.getElementById('agile-task-readonly-note'),
  taskNotes: document.getElementById('agile-task-notes'),
  notesState: document.getElementById('agile-notes-state'),
  noteAdd: document.getElementById('agile-note-add'),
  noteInput: document.getElementById('agile-note-input'),
  noteSubmit: document.getElementById('agile-note-submit'),
  noteLock: document.getElementById('agile-note-lock'),
  taskInfo: document.getElementById('agile-task-info'),
  taskDelete: document.getElementById('agile-task-delete'),
  taskCancel: document.getElementById('agile-task-cancel'),
  taskSave: document.getElementById('agile-task-save'),
  taskClose: document.getElementById('agile-task-close'),
  boardModal: document.getElementById('agile-board-modal'),
  boardStart: document.getElementById('agile-board-start'),
  boardEnd: document.getElementById('agile-board-end'),
  boardGoal: document.getElementById('agile-board-goal'),
  boardSave: document.getElementById('agile-board-save'),
  boardCancel: document.getElementById('agile-board-cancel'),
  boardClose: document.getElementById('agile-board-close'),
};

const agileState = {
  open: false,
  data: null,
  loading: false,
  search: '',
  managerId: (() => {
    try {
      return new URLSearchParams(location.search).get('managerId') || '';
    } catch {
      return '';
    }
  })(),
  taskId: null,
  taskDraft: null,
  boardPan: null,
  request: 0,
  toastTimer: null,
};

function agileManagerQuery() {
  return agileState.managerId
    ? `managerId=${encodeURIComponent(agileState.managerId)}`
    : '';
}

function agileToast(message, tone = '') {
  if (!agileDom.toast) return;
  agileDom.toast.textContent = String(message || '');
  agileDom.toast.classList.toggle('error', tone === 'error');
  agileDom.toast.classList.remove('hidden');
  clearTimeout(agileState.toastTimer);
  agileState.toastTimer = setTimeout(() => {
    agileDom.toast.classList.add('hidden');
  }, 3200);
}

function agileDate(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const locale = agileState.data?.settings?.locale || 'zh-CN';
  const options = withTime
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function agileIterationRow(board, activeId, isLast) {
  const row = el('div', 'agile-iteration-row');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  if (board.id === activeId) row.classList.add('active');
  row.append(el('span', 'agile-iteration-label', board.label));
  row.append(el('span', 'agile-iteration-count', String(board.taskCount)));
  if (isLast) {
    const del = el('button', 'agile-iteration-delete', '×');
    del.type = 'button';
    del.title = '删除迭代';
    del.setAttribute('aria-label', `删除 ${board.label}`);
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      openConfirm({
        text: `删除「${board.label}」和里面的所有任务？不可恢复。`,
        action: () =>
          void agileAction('delete_board', { boardId: board.id }),
      });
    });
    row.append(del);
  }
  const select = () => {
    if (board.id === agileState.data?.activeBoardId) return;
    void agileAction('select_board', { boardId: board.id });
  };
  row.addEventListener('click', select);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  });
  return row;
}

function renderAgileSidebar() {
  if (!agileDom.iterations) return;
  agileDom.iterations.replaceChildren();
  const iterations = agileState.data?.iterations || [];
  iterations.forEach((board, index) => {
    agileDom.iterations.append(
      agileIterationRow(
        board,
        agileState.data?.activeBoardId,
        index === iterations.length - 1
      )
    );
  });
  requestAnimationFrame(() => {
    agileDom.iterations
      ?.querySelector('.agile-iteration-row.active')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function agileTaskMatches(task) {
  const needle = agileState.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    String(task.title || '').toLowerCase().includes(needle) ||
    String(task.description || '').toLowerCase().includes(needle)
  );
}

function agileTaskCard(task) {
  const card = el('div', 'agile-task');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `任务：${task.title}`);
  card.append(el('div', 'agile-task-title', task.title));
  if (task.description) {
    card.append(el('div', 'agile-task-desc', task.description));
  }
  const foot = el('div', 'agile-task-foot');
  if (task.needsDigest) {
    foot.append(el('span', 'agile-signal digest', '待归并'));
  }
  if (task.isRework) {
    foot.append(el('span', 'agile-signal rework', '返工'));
  }
  if (task.claimedBy) {
    foot.append(el('span', 'agile-task-meta', `@${task.claimedBy}`));
  }
  if (task.blockedReason) {
    foot.append(el('span', 'agile-signal rework', '阻塞'));
  }
  const undigested = (task.keyPoints || []).filter((point) => !point.digestedAt).length;
  if (undigested > 0) {
    foot.append(el('span', 'agile-task-meta', `${undigested} 条新备注`));
  } else if ((task.keyPoints || []).length > 0) {
    foot.append(
      el('span', 'agile-task-meta', `${task.keyPoints.length} 条备注`)
    );
  }
  if (foot.childNodes.length) card.append(foot);
  const open = () => openAgileTask(task.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function renderAgileBoard() {
  if (!agileDom.board) return;
  agileDom.board.replaceChildren();
  const data = agileState.data;
  if (!data) {
    agileDom.board.append(el('div', 'agile-empty', '加载中…'));
    return;
  }
  const tasks = data.tasks || [];
  for (const column of data.columns || []) {
    const allColumnTasks = tasks.filter((task) => task.column === column.id);
    const columnTasks = allColumnTasks.filter(agileTaskMatches);
    const section = el('article', 'agile-column');
    section.style.setProperty('--agile-column-color', column.color);
    const head = el('header', 'agile-column-head');
    head.append(el('span', 'agile-column-dot'));
    head.append(el('span', 'agile-column-name', column.name));
    const count = el('span', 'agile-column-count', String(allColumnTasks.length));
    count.title = column.hint || '';
    head.append(count);
    if (column.id === 'human') {
      const add = el('button', 'agile-column-add', '+');
      add.type = 'button';
      add.title = '新建任务';
      add.setAttribute('aria-label', '在 Human In The Loop 新建任务');
      add.addEventListener('click', () => openAgileTask(null, 'human'));
      head.append(add);
    }
    section.append(head);
    const list = el('div', 'agile-tasks');
    if (columnTasks.length === 0) {
      list.append(el('div', 'agile-empty', '还没有任务'));
    } else {
      for (const task of columnTasks) list.append(agileTaskCard(task));
    }
    section.append(list);
    agileDom.board.append(section);
  }
}

function renderAgileHead() {
  const data = agileState.data;
  if (!data) return;
  if (agileDom.iteration) agileDom.iteration.textContent = data.board.label;
  if (agileDom.boardMeta) {
    const parts = [];
    if (data.board.startDate || data.board.endDate) {
      parts.push(
        `${data.board.startDate || '…'} → ${data.board.endDate || '…'}`
      );
    }
    if (data.board.goal) parts.push(data.board.goal);
    parts.push('Agent 移动卡片 · 人写备注');
    agileDom.boardMeta.textContent = parts.join(' · ');
  }
  if (agileDom.search && agileDom.search.value !== agileState.search) {
    agileDom.search.value = agileState.search;
  }
}

function renderAgile() {
  renderAgileHead();
  renderAgileSidebar();
  renderAgileBoard();
}

async function loadAgile(boardId = '') {
  const request = ++agileState.request;
  agileState.loading = true;
  if (!agileState.data) renderAgileBoard();
  try {
    const params = [];
    if (boardId) params.push(`boardId=${encodeURIComponent(boardId)}`);
    const managerQuery = agileManagerQuery();
    if (managerQuery) params.push(managerQuery);
    const query = params.length ? `?${params.join('&')}` : '';
    const data = await requestJson(`/api/agile${query}`);
    if (request !== agileState.request) return;
    agileState.data = data;
    agileState.loading = false;
    renderAgile();
  } catch (error) {
    agileState.loading = false;
    agileToast(`加载 Agile 失败：${error.message}`, 'error');
  }
}

async function agileAction(action, payload = {}) {
  try {
    const data = await requestJson('/api/agile', {
      method: 'POST',
      body: {
        action,
        managerId: agileState.managerId || undefined,
        ...payload,
      },
    });
    if (data?.state) {
      agileState.data = data.state;
      renderAgile();
      if (agileDom.taskModal && !agileDom.taskModal.classList.contains('hidden')) {
        renderAgileTaskModal();
      }
    }
    return data?.result ?? null;
  } catch (error) {
    agileToast(error.message, 'error');
    return null;
  }
}

function agileTask() {
  if (!agileState.data) return null;
  if (agileState.taskId) {
    return (
      agileState.data.tasks.find((task) => task.id === agileState.taskId) ||
      null
    );
  }
  return agileState.taskDraft;
}

function openAgileTask(taskId, draftColumn = 'human') {
  const task = taskId
    ? agileState.data?.tasks.find((item) => item.id === taskId)
    : null;
  agileState.taskId = task ? task.id : null;
  agileState.taskDraft = task
    ? null
    : {
        id: null,
        column: draftColumn,
        title: '',
        description: '',
        keyPoints: [],
        needsDigest: false,
        isRework: false,
        claimedBy: '',
        claimedAt: null,
        blockedReason: '',
        blockedAt: null,
        assignee: '',
        updatedAt: null,
        createdAt: null,
      };
  renderAgileTaskModal();
  agileDom.taskModal.classList.remove('hidden');
  agileDom.taskModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => agileDom.taskTitle?.focus());
}

function closeAgileTask() {
  agileState.taskId = null;
  agileState.taskDraft = null;
  if (!agileDom.taskModal) return;
  agileDom.taskModal.classList.add('hidden');
  agileDom.taskModal.setAttribute('aria-hidden', 'true');
}

function renderAgileTaskModal() {
  const task = agileTask();
  if (!task || !agileDom.taskModal) return;
  const column = agileState.data?.columns.find(
    (item) => item.id === task.column
  );
  const columnName = column?.name || task.column;
  const editable = task.column === 'human';
  const inProgress = task.column === 'progress';
  if (agileDom.taskKicker) {
    agileDom.taskKicker.textContent = columnName.toUpperCase();
  }
  if (agileDom.taskModalTitle) {
    agileDom.taskModalTitle.textContent = task.title || '新任务';
  }
  if (agileDom.taskTitle) {
    agileDom.taskTitle.value = task.title || '';
    agileDom.taskTitle.readOnly = !editable;
  }
  if (agileDom.taskDescription) {
    agileDom.taskDescription.value = task.description || '';
    agileDom.taskDescription.readOnly = !editable;
  }
  if (agileDom.taskReadonlyNote) {
    if (inProgress) {
      agileDom.taskReadonlyNote.textContent =
        'In Progress 的任务由 Agent 处理，标题、描述和备注都只读。';
      agileDom.taskReadonlyNote.classList.remove('hidden');
    } else if (!editable) {
      agileDom.taskReadonlyNote.textContent =
        '只有 Human In The Loop 的任务可以编辑标题和描述；备注仍可添加。';
      agileDom.taskReadonlyNote.classList.remove('hidden');
    } else {
      agileDom.taskReadonlyNote.classList.add('hidden');
    }
  }
  const notes = Array.isArray(task.keyPoints) ? task.keyPoints : [];
  if (agileDom.taskNotes) {
    agileDom.taskNotes.replaceChildren();
    if (notes.length === 0) {
      agileDom.taskNotes.append(
        el('div', 'agile-empty', task.id ? '还没有备注' : '保存任务后可以添加备注')
      );
    } else {
      for (const note of notes) {
        const row = el('div', `agile-note${note.digestedAt ? ' digested' : ''}`);
        row.append(el('span', 'agile-note-text', note.text));
        row.append(
          el(
            'span',
            'agile-note-state',
            note.digestedAt ? '已归并' : '待归并'
          )
        );
        if (!note.digestedAt && !inProgress) {
          const del = el('button', 'agile-note-delete', '×');
          del.type = 'button';
          del.title = '删除备注';
          del.setAttribute('aria-label', '删除备注');
          del.addEventListener('click', () => {
            void agileAction('delete_note', {
              taskId: task.id,
              noteId: note.id,
            });
          });
          row.append(del);
        }
        agileDom.taskNotes.append(row);
      }
    }
  }
  if (agileDom.notesState) {
    const pending = notes.filter((note) => !note.digestedAt).length;
    agileDom.notesState.textContent = notes.length
      ? `${pending} 待归并 · 共 ${notes.length} 条`
      : '没有备注';
  }
  if (agileDom.noteAdd) {
    agileDom.noteAdd.classList.toggle('hidden', !task.id || inProgress);
  }
  if (agileDom.noteLock) {
    agileDom.noteLock.textContent = inProgress
      ? '备注在 In Progress 期间只读，Agent 交回任务后才能修改。'
      : '';
    agileDom.noteLock.classList.toggle('hidden', !inProgress);
  }
  if (agileDom.taskInfo) {
    const info = [];
    info.push(`状态：${columnName}`);
    if (task.assignee) info.push(`Assignee：${task.assignee}`);
    info.push(`认领：${task.claimedBy || '未认领'}`);
    if (task.claimedAt) info.push(`认领时间：${agileDate(task.claimedAt, true)}`);
    if (task.blockedReason) info.push(`阻塞原因：${task.blockedReason}`);
    if (task.updatedAt) {
      info.push(`更新：${agileDate(task.updatedAt, true)}`);
    }
    if (task.isRework) info.push('返工任务：人添加备注后从 Finished 回到 Backlog');
    agileDom.taskInfo.replaceChildren();
    for (const line of info) {
      agileDom.taskInfo.append(el('div', '', line));
    }
  }
  if (agileDom.taskDelete) {
    agileDom.taskDelete.classList.toggle(
      'hidden',
      !task.id || task.column === 'finished'
    );
  }
  if (agileDom.taskSave) {
    agileDom.taskSave.classList.toggle('hidden', !editable);
  }
}

function openAgileBoardDetails() {
  const board = agileState.data?.board;
  if (!board) return;
  agileDom.boardStart.value = board.startDate || '';
  agileDom.boardEnd.value = board.endDate || '';
  agileDom.boardGoal.value = board.goal || '';
  agileDom.boardModal.classList.remove('hidden');
  agileDom.boardModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => agileDom.boardGoal?.focus());
}

function closeAgileBoardDetails() {
  agileDom.boardModal.classList.add('hidden');
  agileDom.boardModal.setAttribute('aria-hidden', 'true');
}

function openAgile(managerId) {
  if (!agileDom.overlay) return;
  if (typeof closeComposer === 'function') closeComposer();
  if (managerId !== undefined) {
    const next = String(managerId || '').trim();
    if (next !== agileState.managerId) {
      agileState.managerId = next;
      agileState.data = null;
      agileState.taskId = null;
      agileState.taskDraft = null;
    }
  }
  agileState.open = true;
  agileDom.overlay.classList.remove('hidden');
  agileDom.overlay.setAttribute('aria-hidden', 'false');
  void loadAgile();
}

function closeAgile() {
  if (!agileDom.overlay) return;
  if (document.body.classList.contains('agile-window') && window.yah?.close) {
    window.yah.close();
    return;
  }
  closeAgileTask();
  closeAgileBoardDetails();
  agileState.open = false;
  agileDom.overlay.classList.add('hidden');
  agileDom.overlay.setAttribute('aria-hidden', 'true');
}

function agileOverlayOpen() {
  return agileState.open && !agileDom.overlay.classList.contains('hidden');
}

function handleAgileEscape() {
  if (agileDom.boardModal && !agileDom.boardModal.classList.contains('hidden')) {
    closeAgileBoardDetails();
    return;
  }
  if (agileDom.taskModal && !agileDom.taskModal.classList.contains('hidden')) {
    closeAgileTask();
  }
}

async function saveAgileTask() {
  const task = agileTask();
  if (!task) return;
  const title = agileDom.taskTitle.value.trim();
  if (!title) {
    agileToast('任务标题不能为空', 'error');
    return;
  }
  if (!task.id) {
    const result = await agileAction('create_task', {
      boardId: agileState.data?.board?.id,
      title,
      description: agileDom.taskDescription.value,
    });
    if (result) closeAgileTask();
    return;
  }
  const result = await agileAction('update_task', {
    taskId: task.id,
    title,
    description: agileDom.taskDescription.value,
  });
  if (result) closeAgileTask();
}

async function addAgileNote() {
  const task = agileTask();
  if (!task?.id) {
    agileToast('先保存任务，再添加备注', 'error');
    return;
  }
  const text = agileDom.noteInput.value.trim();
  if (!text) return;
  const result = await agileAction('add_note', {
    taskId: task.id,
    text,
  });
  if (result) {
    agileDom.noteInput.value = '';
    renderAgileTaskModal();
  }
}

function deleteAgileTask() {
  const task = agileTask();
  if (!task?.id) return;
  openConfirm({
    text: `删除任务「${task.title}」？不可恢复。`,
    action: async () => {
      const result = await agileAction('delete_task', { taskId: task.id });
      if (result) closeAgileTask();
    },
  });
}

function startAgileBoardPan(event) {
  if (event.button !== 0 || !agileDom.board) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'button, a, input, textarea, select, .agile-task, .agile-note, .overlay'
    )
  ) {
    return;
  }
  agileState.boardPan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    scrollLeft: agileDom.board.scrollLeft,
    moved: false,
  };
  agileDom.board.classList.add('panning');
  try {
    agileDom.board.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function moveAgileBoardPan(event) {
  const pan = agileState.boardPan;
  if (!pan || !agileDom.board) return;
  const dx = event.clientX - pan.startX;
  if (!pan.moved && Math.abs(dx) < 4) return;
  pan.moved = true;
  agileDom.board.scrollLeft = pan.scrollLeft - dx;
  event.preventDefault();
}

function endAgileBoardPan() {
  if (!agileState.boardPan) return;
  agileState.boardPan = null;
  agileDom.board?.classList.remove('panning');
}

function bindAgileEvents() {
  agileDom.addIteration?.addEventListener('click', () => {
    void agileAction('create_board', {});
  });
  agileDom.boardDetails?.addEventListener('click', openAgileBoardDetails);
  agileDom.search?.addEventListener('input', () => {
    agileState.search = agileDom.search.value;
    renderAgileBoard();
  });
  agileDom.board?.addEventListener('pointerdown', startAgileBoardPan);
  agileDom.board?.addEventListener('pointermove', moveAgileBoardPan);
  agileDom.board?.addEventListener('pointerup', endAgileBoardPan);
  agileDom.board?.addEventListener('pointercancel', endAgileBoardPan);
  agileDom.board?.addEventListener('lostpointercapture', endAgileBoardPan);
  agileDom.board?.addEventListener('dragstart', (event) => {
    event.preventDefault();
  });
  agileDom.taskClose?.addEventListener('click', closeAgileTask);
  agileDom.taskCancel?.addEventListener('click', closeAgileTask);
  agileDom.taskSave?.addEventListener('click', () => void saveAgileTask());
  agileDom.taskDelete?.addEventListener('click', deleteAgileTask);
  agileDom.noteSubmit?.addEventListener('click', () => void addAgileNote());
  agileDom.noteInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addAgileNote();
    }
  });
  agileDom.taskModal?.addEventListener('click', (event) => {
    if (event.target === agileDom.taskModal) closeAgileTask();
  });
  agileDom.boardClose?.addEventListener('click', closeAgileBoardDetails);
  agileDom.boardCancel?.addEventListener('click', closeAgileBoardDetails);
  agileDom.boardSave?.addEventListener('click', async () => {
    const result = await agileAction('update_board', {
      boardId: agileState.data?.board?.id,
      startDate: agileDom.boardStart.value,
      endDate: agileDom.boardEnd.value,
      goal: agileDom.boardGoal.value,
    });
    if (result) closeAgileBoardDetails();
  });
  agileDom.boardModal?.addEventListener('click', (event) => {
    if (event.target === agileDom.boardModal) closeAgileBoardDetails();
  });
}

function anyAgileModalOpen() {
  return [agileDom.taskModal, agileDom.boardModal].some(
    (modal) => modal && !modal.classList.contains('hidden')
  );
}

async function refreshAgileIfChanged() {
  if (!agileState.data || document.hidden || agileState.loading) return;
  if (anyAgileModalOpen()) return;
  const confirm = document.getElementById('confirm-overlay');
  if (confirm && !confirm.classList.contains('hidden')) return;
  try {
    const managerQuery = agileManagerQuery();
    const data = await requestJson(
      managerQuery ? `/api/agile?${managerQuery}` : '/api/agile'
    );
    if (!data || data.seq === agileState.data.seq) return;
    agileState.data = data;
    renderAgile();
  } catch {
    /* ignore */
  }
}

window.openAgile = openAgile;
window.closeAgile = closeAgile;
window.agileOverlayOpen = agileOverlayOpen;
window.handleAgileEscape = handleAgileEscape;
window.refreshAgileIfChanged = refreshAgileIfChanged;

bindAgileEvents();
