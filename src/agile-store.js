'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLUMNS = [
  {
    id: 'backlog',
    name: 'Backlog',
    order: 1,
    color: '#5b8def',
    hint: 'Agent 提出的待办',
  },
  {
    id: 'human',
    name: 'Human In The Loop',
    order: 2,
    color: '#9a7bea',
    hint: '人手动添加任务的唯一入口',
  },
  {
    id: 'progress',
    name: 'In Progress',
    order: 3,
    color: '#d69a4a',
    hint: 'Agent 正在处理，表单只读',
  },
  {
    id: 'blocked',
    name: 'Blocked',
    order: 4,
    color: '#d46b5f',
    hint: '需要人决定或资源冲突',
  },
  {
    id: 'finished',
    name: 'Finished',
    order: 5,
    color: '#6f9b68',
    hint: '已完成',
    done: true,
  },
];

const COLUMN_BY_ID = new Map(COLUMNS.map((column) => [column.id, column]));
const COLUMN_BY_NAME = new Map(
  COLUMNS.map((column) => [column.name.toLowerCase(), column.id])
);
const COLUMN_ALIASES = new Map([
  ['todo', 'backlog'],
  ['inprogress', 'progress'],
  ['in-progress', 'progress'],
  ['done', 'finished'],
  ['human in the loop', 'human'],
]);

function normalizeColumn(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'backlog';
  const lower = raw.toLowerCase();
  if (COLUMN_BY_ID.has(lower)) return lower;
  if (COLUMN_BY_NAME.has(lower)) return COLUMN_BY_NAME.get(lower);
  if (COLUMN_ALIASES.has(lower)) return COLUMN_ALIASES.get(lower);
  throw new Error(
    `Unknown column "${raw}". Use one of: ${COLUMNS.map((c) => c.id).join(', ')}`
  );
}

function columnName(id) {
  return COLUMN_BY_ID.get(id)?.name || id;
}

function iterationLabel(index) {
  return `Iteration ${index + 1}`;
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, limit = 500) {
  return String(value ?? '')
    .trim()
    .slice(0, limit);
}

function normalizeWipLimit(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), 999);
}

function normalizeWipLimits(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const column of COLUMNS) {
    if (column.done) continue;
    const value = normalizeWipLimit(source[column.id]);
    if (value) out[column.id] = value;
  }
  return out;
}

function defaultSettings() {
  return {
    showChangeDate: true,
    locale: 'zh-CN',
    wipLimits: {},
  };
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    showChangeDate: source.showChangeDate !== false,
    locale: normalizeText(source.locale, 20) || 'zh-CN',
    wipLimits: normalizeWipLimits(source.wipLimits),
  };
}

function normalizeKeyPoints(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((point) => {
      const text = normalizeText(point?.text, 300);
      if (!text) return null;
      return {
        id: String(point.id || id('kp')),
        text,
        createdAt: String(point.createdAt || nowIso()),
        digestedAt: point.digestedAt ? String(point.digestedAt) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let column = 'backlog';
  try {
    column = normalizeColumn(raw.column);
  } catch {
    column = 'backlog';
  }
  const keyPoints = normalizeKeyPoints(raw.keyPoints);
  const needsDigest =
    raw.needsDigest === true ||
    keyPoints.some((point) => !point.digestedAt);
  const taskId = String(raw.id || id('tsk'));
  return {
    id: taskId,
    boardId: String(raw.boardId || ''),
    column,
    title: normalizeText(raw.title || raw.text, 200) || 'Untitled task',
    description: normalizeText(raw.description, 20000),
    assignee: normalizeText(raw.assignee, 120),
    keyPoints,
    needsDigest,
    isRework: raw.isRework === true,
    claimedBy: normalizeText(raw.claimedBy, 120),
    claimedAt: raw.claimedAt ? String(raw.claimedAt) : null,
    blockedReason: normalizeText(raw.blockedReason, 2000),
    blockedAt: raw.blockedAt ? String(raw.blockedAt) : null,
    columnHistory: Array.isArray(raw.columnHistory)
      ? raw.columnHistory
          .map((entry) => ({
            column: (() => {
              try {
                return normalizeColumn(entry?.column);
              } catch {
                return 'backlog';
              }
            })(),
            at: String(entry?.at || nowIso()),
          }))
          .slice(-200)
      : [{ column, at: nowIso() }],
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 1,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    lastActivityAt: String(
      raw.lastActivityAt || raw.updatedAt || raw.createdAt || nowIso()
    ),
    doneDate: column === 'finished'
      ? String(raw.doneDate || raw.updatedAt || nowIso())
      : null,
  };
}

function normalizeBoard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: String(raw.id || id('brd')),
    groupId: String(raw.groupId || ''),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 1,
    startDate: normalizeText(raw.startDate, 20),
    endDate: normalizeText(raw.endDate, 20),
    goal: normalizeText(raw.goal, 300),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: String(raw.id || id('grp')),
    name: normalizeText(raw.name, 60) || 'Group',
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 1,
    collapsed: raw.collapsed === true,
    prefixCollapsed: raw.prefixCollapsed === true,
    createdAt: String(raw.createdAt || nowIso()),
  };
}

function normalizeSkill(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = normalizeText(raw.name, 80);
  if (!name) return null;
  return {
    id: String(raw.id || id('skl')),
    name,
    description: normalizeText(raw.description, 300),
    content: normalizeText(raw.content, 20000),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

function createAgileStore(file) {
  let data = null;

  function emptyData() {
    const groupId = id('grp');
    const boardId = id('brd');
    const createdAt = nowIso();
    return {
      version: 1,
      seq: 0,
      activeBoardId: boardId,
      groups: [
        {
          id: groupId,
          name: 'Group 1',
          order: 1,
          collapsed: false,
          prefixCollapsed: false,
          createdAt,
        },
      ],
      boards: [
        {
          id: boardId,
          groupId,
          order: 1,
          startDate: '',
          endDate: '',
          goal: '',
          createdAt,
          updatedAt: createdAt,
        },
      ],
      tasks: [],
      settings: {
        [boardId]: defaultSettings(),
      },
      skills: [
        {
          id: id('skl'),
          name: 'OpenAgile',
          description: 'How to work the five-column board with the human.',
          content: [
            '# OpenAgile',
            '',
            '- Five fixed columns: Backlog, Human In The Loop, In Progress, Blocked, Finished.',
            '- Agent-created work starts in Backlog. The human adds tasks only in Human In The Loop.',
            '- The task description belongs to the agent. Notes (keyPoints) belong to the human.',
            '- Call agile_digest_notes before claiming a task or moving it into In Progress when it has undigested notes.',
            '- Use agile_move_task to advance work; the human cannot drag cards.',
            '- Add a blocked reason when work cannot continue and needs a human decision.',
          ].join('\n'),
          createdAt,
          updatedAt: createdAt,
        },
      ],
      events: [],
    };
  }

  function ensureDefaults(target) {
    if (!Array.isArray(target.groups) || target.groups.length === 0) {
      const group = normalizeGroup({ name: 'Group 1', order: 1 });
      target.groups = [group];
    }
    target.groups = target.groups
      .map(normalizeGroup)
      .filter(Boolean)
      .sort((left, right) => left.order - right.order);
    target.groups.forEach((group, index) => {
      group.order = index + 1;
    });
    if (!Array.isArray(target.boards) || target.boards.length === 0) {
      const group = target.groups[target.groups.length - 1];
      const board = normalizeBoard({
        groupId: group.id,
        order: 1,
      });
      target.boards = [board];
      target.settings = {
        ...(target.settings || {}),
        [board.id]: defaultSettings(),
      };
    }
    const groupIds = new Set(target.groups.map((group) => group.id));
    target.boards = target.boards
      .map(normalizeBoard)
      .filter(Boolean)
      .map((board) => {
        if (!groupIds.has(board.groupId)) {
          board.groupId = target.groups[target.groups.length - 1].id;
        }
        return board;
      });
    target.boards.sort((left, right) => {
      const leftGroup = target.groups.find((group) => group.id === left.groupId);
      const rightGroup = target.groups.find((group) => group.id === right.groupId);
      const groupDiff = (leftGroup?.order || 0) - (rightGroup?.order || 0);
      return groupDiff || left.order - right.order;
    });
    const counters = new Map();
    for (const board of target.boards) {
      const next = (counters.get(board.groupId) || 0) + 1;
      counters.set(board.groupId, next);
      board.order = next;
    }
    const boardIds = new Set(target.boards.map((board) => board.id));
    target.tasks = (Array.isArray(target.tasks) ? target.tasks : [])
      .map(normalizeTask)
      .filter((task) => task && boardIds.has(task.boardId));
    for (const task of target.tasks) {
      if (!target.settings?.[task.boardId]) {
        target.settings = target.settings || {};
        target.settings[task.boardId] = defaultSettings();
      }
    }
    target.settings = target.settings && typeof target.settings === 'object'
      ? target.settings
      : {};
    for (const board of target.boards) {
      target.settings[board.id] = normalizeSettings(target.settings[board.id]);
    }
    target.skills = (Array.isArray(target.skills) ? target.skills : [])
      .map(normalizeSkill)
      .filter(Boolean);
    target.events = Array.isArray(target.events) ? target.events.slice(-1000) : [];
    target.seq = Number(target.seq) || target.events.length || 0;
    if (!boardIds.has(target.activeBoardId)) {
      target.activeBoardId = target.boards[0]?.id || null;
    }
    return target;
  }

  function persist() {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, file);
  }

  function load() {
    if (data) return data;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = ensureDefaults(raw && typeof raw === 'object' ? raw : emptyData());
    } catch {
      data = emptyData();
      persist();
    }
    return data;
  }

  function boardById(boardId) {
    load();
    const idValue = String(boardId || data.activeBoardId || '');
    return data.boards.find((board) => board.id === idValue) || null;
  }

  function taskById(taskId) {
    load();
    return data.tasks.find((task) => task.id === String(taskId || '')) || null;
  }

  function recordEvent(type, payload, boardId = null, actor = null) {
    data.seq += 1;
    data.events.push({
      id: id('evt'),
      seq: data.seq,
      type,
      at: nowIso(),
      boardId,
      actor: actor && typeof actor === 'object' ? actor : null,
      payload: payload && typeof payload === 'object' ? payload : {},
    });
    if (data.events.length > 1000) data.events = data.events.slice(-1000);
  }

  function boardSummary(board, index) {
    const tasks = data.tasks.filter((task) => task.boardId === board.id);
    const finished = tasks.filter((task) => task.column === 'finished').length;
    return {
      id: board.id,
      groupId: board.groupId,
      label: iterationLabel(index),
      startDate: board.startDate,
      endDate: board.endDate,
      goal: board.goal,
      taskCount: tasks.length,
      finishedCount: finished,
      unfinishedCount: tasks.length - finished,
      allFinished: tasks.length > 0 && finished === tasks.length,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    };
  }

  function groupSummaries() {
    return data.groups.map((group) => {
      const boards = data.boards
        .filter((board) => board.groupId === group.id)
        .sort((left, right) => left.order - right.order)
        .map((board, index) => boardSummary(board, index));
      return {
        id: group.id,
        name: group.name,
        order: group.order,
        collapsed: group.collapsed,
        prefixCollapsed: group.prefixCollapsed,
        boards,
      };
    });
  }

  function activeBoard() {
    return boardById(data.activeBoardId) || data.boards[0] || null;
  }

  function boardTasks(boardId) {
    return data.tasks
      .filter((task) => task.boardId === boardId)
      .sort((left, right) => {
        const leftColumn = COLUMN_BY_ID.get(left.column)?.order || 0;
        const rightColumn = COLUMN_BY_ID.get(right.column)?.order || 0;
        return leftColumn - rightColumn || left.order - right.order;
      });
  }

  function taskView(task) {
    const claimExpired =
      Boolean(task.claimedBy) &&
      Date.now() - new Date(task.lastActivityAt).getTime() > 5 * 60 * 1000;
    return {
      ...clone(task),
      columnName: columnName(task.column),
      claimExpired,
      undigestedCount: task.keyPoints.filter((point) => !point.digestedAt).length,
    };
  }

  function state(boardId = null) {
    load();
    const board = boardId ? boardById(boardId) : activeBoard();
    if (!board) throw new Error('No agile board exists');
    const settings = normalizeSettings(data.settings[board.id]);
    return {
      activeBoardId: board.id,
      groups: groupSummaries(),
      board: boardSummary(
        board,
        data.boards
          .filter((item) => item.groupId === board.groupId)
          .sort((left, right) => left.order - right.order)
          .findIndex((item) => item.id === board.id)
      ),
      tasks: boardTasks(board.id).map(taskView),
      settings,
      skills: data.skills.map((skill) => ({ ...skill })),
      columns: COLUMNS.map((column) => ({
        ...column,
        wipLimit: settings.wipLimits[column.id] || 0,
      })),
      seq: data.seq,
      events: data.events.slice(-40).map((event) => ({ ...event })),
    };
  }

  function createGroup(name) {
    load();
    const groupName = normalizeText(name, 60);
    if (!groupName) throw new Error('Group name is required');
    const group = normalizeGroup({
      name: groupName,
      order: data.groups.length + 1,
    });
    data.groups.push(group);
    recordEvent('group.created', { name: group.name }, null, {
      type: 'human',
      id: null,
    });
    persist();
    return group;
  }

  function renameGroup(groupId, name) {
    load();
    const group = data.groups.find((item) => item.id === String(groupId));
    if (!group) throw new Error('Group not found');
    const next = normalizeText(name, 60);
    if (!next) throw new Error('Group name is required');
    group.name = next;
    recordEvent('group.renamed', { groupId: group.id, name: next }, null, {
      type: 'human',
      id: null,
    });
    persist();
    return group;
  }

  function updateGroup(groupId, patch = {}) {
    load();
    const group = data.groups.find((item) => item.id === String(groupId));
    if (!group) throw new Error('Group not found');
    if (typeof patch.name === 'string') group.name = normalizeText(patch.name, 60) || group.name;
    if (typeof patch.collapsed === 'boolean') group.collapsed = patch.collapsed;
    if (typeof patch.prefixCollapsed === 'boolean') {
      group.prefixCollapsed = patch.prefixCollapsed;
    }
    recordEvent('group.updated', { groupId: group.id, ...patch }, null, {
      type: 'human',
      id: null,
    });
    persist();
    return group;
  }

  function deleteGroup(groupId) {
    load();
    const group = data.groups.find((item) => item.id === String(groupId));
    if (!group) throw new Error('Group not found');
    const boards = data.boards.filter((board) => board.groupId === group.id);
    const boardIds = new Set(boards.map((board) => board.id));
    data.tasks = data.tasks.filter((task) => !boardIds.has(task.boardId));
    for (const board of boards) delete data.settings[board.id];
    data.boards = data.boards.filter((board) => !boardIds.has(board.id));
    data.groups = data.groups.filter((item) => item.id !== group.id);
    ensureDefaults(data);
    recordEvent('group.deleted', { groupId: group.id, name: group.name }, null, {
      type: 'human',
      id: null,
    });
    persist();
    return true;
  }

  function createBoard(groupId = null) {
    load();
    const group =
      data.groups.find((item) => item.id === String(groupId || '')) ||
      data.groups[data.groups.length - 1];
    if (!group) throw new Error('Create a group first');
    const order =
      data.boards.filter((board) => board.groupId === group.id).length + 1;
    const board = normalizeBoard({ groupId: group.id, order });
    data.boards.push(board);
    data.settings[board.id] = defaultSettings();
    data.activeBoardId = board.id;
    recordEvent('board.created', { boardId: board.id, groupId: group.id }, board.id, {
      type: 'human',
      id: null,
    });
    persist();
    return boardSummary(
      board,
      data.boards
        .filter((item) => item.groupId === group.id)
        .sort((left, right) => left.order - right.order)
        .findIndex((item) => item.id === board.id)
    );
  }

  function updateBoard(boardId, patch = {}) {
    load();
    const board = boardById(boardId);
    if (!board) throw new Error('Board not found');
    if (typeof patch.startDate === 'string') board.startDate = normalizeText(patch.startDate, 20);
    if (typeof patch.endDate === 'string') board.endDate = normalizeText(patch.endDate, 20);
    if (typeof patch.goal === 'string') board.goal = normalizeText(patch.goal, 300);
    board.updatedAt = nowIso();
    recordEvent('board.updated', { boardId: board.id, ...patch }, board.id, {
      type: 'human',
      id: null,
    });
    persist();
    return boardSummary(
      board,
      data.boards
        .filter((item) => item.groupId === board.groupId)
        .sort((left, right) => left.order - right.order)
        .findIndex((item) => item.id === board.id)
    );
  }

  function deleteBoard(boardId) {
    load();
    const board = boardById(boardId);
    if (!board) throw new Error('Board not found');
    const siblings = data.boards
      .filter((item) => item.groupId === board.groupId)
      .sort((left, right) => left.order - right.order);
    if (siblings[siblings.length - 1]?.id !== board.id) {
      throw new Error(
        'Only the last iteration in a group can be deleted; earlier iterations are kept.'
      );
    }
    data.tasks = data.tasks.filter((task) => task.boardId !== board.id);
    delete data.settings[board.id];
    data.boards = data.boards.filter((item) => item.id !== board.id);
    ensureDefaults(data);
    recordEvent('board.deleted', { boardId: board.id }, board.id, {
      type: 'human',
      id: null,
    });
    persist();
    return true;
  }

  function assignBoardToGroup(boardId, groupId) {
    load();
    const board = boardById(boardId);
    if (!board) throw new Error('Board not found');
    const group = data.groups.find((item) => item.id === String(groupId || ''));
    if (!group) throw new Error('Group not found');
    const from = board.groupId;
    if (from === group.id) {
      return boardSummary(
        board,
        data.boards
          .filter((item) => item.groupId === group.id)
          .sort((left, right) => left.order - right.order)
          .findIndex((item) => item.id === board.id)
      );
    }
    board.groupId = group.id;
    board.order =
      data.boards.filter((item) => item.groupId === group.id && item.id !== board.id)
        .length + 1;
    board.updatedAt = nowIso();
    for (const groupIdValue of [from, group.id]) {
      data.boards
        .filter((item) => item.groupId === groupIdValue)
        .sort((left, right) => left.order - right.order)
        .forEach((item, index) => {
          item.order = index + 1;
        });
    }
    recordEvent(
      'board.group.assigned',
      { boardId: board.id, groupId: group.id },
      board.id,
      { type: 'human', id: null }
    );
    persist();
    return boardSummary(
      board,
      data.boards
        .filter((item) => item.groupId === group.id)
        .sort((left, right) => left.order - right.order)
        .findIndex((item) => item.id === board.id)
    );
  }

  function selectBoard(boardId) {
    load();
    const board = boardById(boardId);
    if (!board) throw new Error('Board not found');
    data.activeBoardId = board.id;
    persist();
    return board.id;
  }

  function normalizeActor(actor) {
    if (!actor || typeof actor !== 'object') {
      return { type: 'human', id: null };
    }
    return {
      type: String(actor.type || 'agent').slice(0, 40),
      id: actor.id ? String(actor.id).slice(0, 120) : null,
    };
  }

  function requireBoard(boardId) {
    const board = boardById(boardId);
    if (!board) throw new Error(`Board not found: ${boardId || ''}`);
    return board;
  }

  function createTask(args = {}) {
    load();
    const board = requireBoard(args.boardId || data.activeBoardId);
    const title = normalizeText(args.title, 200);
    if (!title) throw new Error('Task title is required');
    const column = normalizeColumn(args.column || 'backlog');
    const order =
      data.tasks
        .filter((task) => task.boardId === board.id && task.column === column)
        .reduce((max, task) => Math.max(max, task.order), 0) + 1;
    const task = normalizeTask({
      boardId: board.id,
      column,
      title,
      description: args.description,
      assignee: args.assignee,
      order,
      columnHistory: [{ column, at: nowIso() }],
    });
    data.tasks.push(task);
    recordEvent(
      'task.created',
      { taskId: task.id, column, title: task.title },
      board.id,
      normalizeActor(args.actor)
    );
    persist();
    return taskView(task);
  }

  function createTasks(args = {}) {
    load();
    const board = requireBoard(args.boardId || data.activeBoardId);
    const items = Array.isArray(args.tasks) ? args.tasks : [];
    if (items.length === 0) throw new Error('tasks must not be empty');
    for (const [index, item] of items.entries()) {
      if (!normalizeText(item?.title, 200)) {
        throw new Error(`tasks[${index}].title is required`);
      }
    }
    const created = [];
    for (const item of items) {
      created.push(
        createTask({ ...item, column: 'backlog', boardId: board.id, actor: args.actor })
      );
    }
    return created;
  }

  function assertClaimAvailable(task, actor) {
    if (!task.claimedBy) return;
    if (task.claimedBy === actor.id) return;
    const expired =
      Date.now() - new Date(task.lastActivityAt).getTime() > 5 * 60 * 1000;
    if (!expired) {
      throw new Error(
        `Task is claimed by ${task.claimedBy}; wait for release or expiry`
      );
    }
  }

  function updateTask(taskId, patch = {}) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    const actor = normalizeActor(patch.actor);
    if (actor.type !== 'human') assertClaimAvailable(task, actor);
    if (typeof patch.title === 'string') {
      const title = normalizeText(patch.title, 200);
      if (!title) throw new Error('Task title is required');
      task.title = title;
    }
    if (typeof patch.description === 'string') {
      task.description = normalizeText(patch.description, 20000);
    }
    if (typeof patch.assignee === 'string') {
      task.assignee = normalizeText(patch.assignee, 120);
    }
    if (typeof patch.blockedReason === 'string') {
      task.blockedReason = normalizeText(patch.blockedReason, 2000);
      task.blockedAt = task.blockedReason ? nowIso() : null;
    }
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent('task.updated', { taskId: task.id, fields: patch }, task.boardId, actor);
    persist();
    return taskView(task);
  }

  function reorderColumn(boardId, column) {
    const tasks = data.tasks
      .filter((task) => task.boardId === boardId && task.column === column)
      .sort((left, right) => left.order - right.order);
    tasks.forEach((task, index) => {
      task.order = index + 1;
    });
  }

  function moveTask(taskId, columnValue, options = {}) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    const actor = normalizeActor(options.actor);
    assertClaimAvailable(task, actor);
    const column = normalizeColumn(columnValue);
    if (column === 'progress' && task.needsDigest) {
      throw new Error(
        'Task has undigested notes. Call agile_digest_notes before moving it into In Progress.'
      );
    }
    const from = task.column;
    if (from === column && options.position === undefined) {
      return taskView(task);
    }
    task.column = column;
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    if (column === 'progress' && !task.claimedBy) {
      task.claimedBy = actor.id || 'agent';
      task.claimedAt = task.updatedAt;
      if (!task.assignee) task.assignee = task.claimedBy;
    }
    if (column === 'backlog' || column === 'human' || column === 'finished') {
      task.claimedBy = '';
      task.claimedAt = null;
    }
    if (column === 'finished') {
      task.doneDate = task.updatedAt;
    } else {
      task.doneDate = null;
    }
    if (column === 'blocked') {
      task.blockedAt = task.blockedAt || task.updatedAt;
    }
    task.columnHistory.push({ column, at: task.updatedAt });
    if (task.columnHistory.length > 200) task.columnHistory = task.columnHistory.slice(-200);
    const siblings = data.tasks
      .filter(
        (item) =>
          item.boardId === task.boardId &&
          item.column === column &&
          item.id !== task.id
      )
      .sort((left, right) => left.order - right.order);
    const position = Number(options.position);
    const insertAt = Number.isInteger(position)
      ? Math.max(0, Math.min(siblings.length, position))
      : siblings.length;
    siblings.splice(insertAt, 0, task);
    siblings.forEach((item, index) => {
      item.order = index + 1;
    });
    reorderColumn(task.boardId, from);
    recordEvent(
      'task.moved',
      { taskId: task.id, from, to: column },
      task.boardId,
      actor
    );
    persist();
    return taskView(task);
  }

  function moveTasks(taskIds, columnValue, options = {}) {
    load();
    const ids = Array.isArray(taskIds) ? taskIds.map(String) : [];
    if (ids.length === 0) throw new Error('taskIds must be a non-empty array');
    for (const [index, taskId] of ids.entries()) {
      if (!taskById(taskId)) {
        throw new Error(`taskIds[${index}]: Task not found: ${taskId}`);
      }
    }
    return ids.map((taskId) =>
      moveTask(taskId, columnValue, {
        actor: options.actor,
        position: options.position,
      })
    );
  }

  function deleteTask(taskId, options = {}) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.column === 'finished') {
      throw new Error('Finished tasks cannot be deleted');
    }
    const actor = normalizeActor(options.actor);
    if (actor.type !== 'human') assertClaimAvailable(task, actor);
    data.tasks = data.tasks.filter((item) => item.id !== task.id);
    recordEvent('task.deleted', { taskId: task.id }, task.boardId, actor);
    persist();
    return true;
  }

  function addNote(taskId, text) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    const value = normalizeText(text, 300);
    if (!value) throw new Error('Note text is required');
    if (task.column === 'progress') {
      throw new Error('Notes are read-only while a task is In Progress');
    }
    if (task.column === 'finished') {
      task.column = 'backlog';
      task.order =
        data.tasks
          .filter(
            (item) =>
              item.boardId === task.boardId &&
              item.column === 'backlog' &&
              item.id !== task.id
          )
          .reduce((max, item) => Math.max(max, item.order), 0) + 1;
      task.isRework = true;
      task.doneDate = null;
      task.columnHistory.push({ column: 'backlog', at: nowIso() });
      recordEvent(
        'task.moved',
        { taskId: task.id, from: 'finished', to: 'backlog', reason: 'note' },
        task.boardId,
        { type: 'human', id: null }
      );
    }
    task.keyPoints.push({
      id: id('kp'),
      text: value,
      createdAt: nowIso(),
      digestedAt: null,
    });
    task.needsDigest = true;
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent(
      'task.updated',
      { taskId: task.id, noteAdded: true },
      task.boardId,
      { type: 'human', id: null }
    );
    persist();
    return taskView(task);
  }

  function deleteNote(taskId, noteId) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.column === 'progress') {
      throw new Error('Notes are read-only while a task is In Progress');
    }
    const note = task.keyPoints.find((point) => point.id === String(noteId));
    if (!note) throw new Error('Note not found');
    if (note.digestedAt) throw new Error('Digested notes are read-only');
    task.keyPoints = task.keyPoints.filter((point) => point.id !== note.id);
    task.needsDigest = task.keyPoints.some((point) => !point.digestedAt);
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent(
      'task.updated',
      { taskId: task.id, noteDeleted: note.id },
      task.boardId,
      { type: 'human', id: null }
    );
    persist();
    return taskView(task);
  }

  function digestNotes(taskId, pointIds = null, actor = null) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    const wanted = Array.isArray(pointIds) ? new Set(pointIds.map(String)) : null;
    const at = nowIso();
    for (const point of task.keyPoints) {
      if (point.digestedAt) continue;
      if (wanted && !wanted.has(point.id)) continue;
      point.digestedAt = at;
    }
    task.needsDigest = task.keyPoints.some((point) => !point.digestedAt);
    if (!task.needsDigest) task.isRework = false;
    task.updatedAt = at;
    task.lastActivityAt = at;
    recordEvent('task.updated', { taskId: task.id, digested: true }, task.boardId, normalizeActor(actor));
    persist();
    return taskView(task);
  }

  function undigestNotes(taskId, pointIds = null, actor = null) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    const wanted = Array.isArray(pointIds) ? new Set(pointIds.map(String)) : null;
    for (const point of task.keyPoints) {
      if (wanted && !wanted.has(point.id)) continue;
      point.digestedAt = null;
    }
    task.needsDigest = task.keyPoints.some((point) => !point.digestedAt);
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent('task.updated', { taskId: task.id, undigested: true }, task.boardId, normalizeActor(actor));
    persist();
    return taskView(task);
  }

  function claimTask(taskId, agent = 'agent') {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.needsDigest) {
      throw new Error('Task has undigested notes. Digest them before claiming.');
    }
    const actor = { type: 'agent', id: normalizeText(agent, 120) || 'agent' };
    const previousHolder = task.claimedBy;
    assertClaimAvailable(task, actor);
    const renewed = previousHolder === actor.id;
    task.claimedBy = actor.id;
    task.claimedAt = nowIso();
    if (!task.assignee) task.assignee = actor.id;
    task.lastActivityAt = task.claimedAt;
    task.updatedAt = task.claimedAt;
    recordEvent('task.claimed', { taskId: task.id, agent: actor.id }, task.boardId, actor);
    persist();
    return {
      ...taskView(task),
      renewed,
      ...(previousHolder && !renewed
        ? { tookOver: true, previousHolder }
        : {}),
    };
  }

  function releaseTask(taskId, actor = null) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    task.claimedBy = '';
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent('task.released', { taskId: task.id }, task.boardId, normalizeActor(actor));
    persist();
    return taskView(task);
  }

  function heartbeatTask(taskId, actor = null) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.column !== 'progress' || !task.claimedBy) {
      throw new Error('Heartbeat requires a claimed task in In Progress');
    }
    task.lastActivityAt = nowIso();
    task.updatedAt = task.lastActivityAt;
    recordEvent('task.heartbeat', { taskId: task.id }, task.boardId, normalizeActor(actor));
    persist();
    return taskView(task);
  }

  function claimNext(boardId = null, agent = 'agent') {
    load();
    const board = requireBoard(boardId || data.activeBoardId);
    const actor = { type: 'agent', id: normalizeText(agent, 120) || 'agent' };
    const ready = data.tasks
      .filter(
        (task) =>
          task.boardId === board.id &&
          (task.column === 'backlog' || task.column === 'human') &&
          !task.needsDigest
      )
      .sort((left, right) => {
        const leftOrder = COLUMN_BY_ID.get(left.column)?.order || 0;
        const rightOrder = COLUMN_BY_ID.get(right.column)?.order || 0;
        return leftOrder - rightOrder || left.order - right.order;
      })
      .find((task) => {
        if (!task.claimedBy) return true;
        return Date.now() - new Date(task.lastActivityAt).getTime() > 5 * 60 * 1000;
      });
    if (!ready) return { claimed: false, task: null };
    return { claimed: true, task: claimTask(ready.id, actor.id) };
  }

  function setBlockedReason(taskId, reason, actor = null) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    task.blockedReason = normalizeText(reason, 2000);
    task.blockedAt = task.blockedReason ? nowIso() : null;
    task.updatedAt = nowIso();
    task.lastActivityAt = task.updatedAt;
    recordEvent('task.updated', { taskId: task.id, blockedReason: task.blockedReason }, task.boardId, normalizeActor(actor));
    persist();
    return taskView(task);
  }

  function listTasks(boardId = null, filters = {}) {
    load();
    const board = requireBoard(boardId || data.activeBoardId);
    let tasks = data.tasks.filter((task) => task.boardId === board.id);
    if (filters.column) {
      const column = normalizeColumn(filters.column);
      tasks = tasks.filter((task) => task.column === column);
    }
    if (filters.search) {
      const needle = String(filters.search).toLowerCase();
      tasks = tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(needle) ||
          task.description.toLowerCase().includes(needle)
      );
    }
    if (typeof filters.claimedBy === 'string') {
      tasks = tasks.filter((task) => task.claimedBy === filters.claimedBy);
    }
    if (typeof filters.needsDigest === 'boolean') {
      tasks = tasks.filter((task) => task.needsDigest === filters.needsDigest);
    }
    if (filters.ready === true) {
      tasks = tasks.filter(
        (task) =>
          (task.column === 'backlog' || task.column === 'human') &&
          !task.needsDigest &&
          (!task.claimedBy ||
            Date.now() - new Date(task.lastActivityAt).getTime() > 5 * 60 * 1000)
      );
    }
    return tasks
      .sort((left, right) => {
        const leftColumn = COLUMN_BY_ID.get(left.column)?.order || 0;
        const rightColumn = COLUMN_BY_ID.get(right.column)?.order || 0;
        return leftColumn - rightColumn || left.order - right.order;
      })
      .map(taskView);
  }

  function getTask(taskId) {
    load();
    const task = taskById(taskId);
    if (!task) throw new Error('Task not found');
    return taskView(task);
  }

  function listRoadmap() {
    load();
    const groups = groupSummaries();
    let activeFound = false;
    return {
      groups: groups.map((group) => ({
        ...group,
        boards: group.boards.map((board) => {
          const isActive = !activeFound && !board.allFinished;
          if (isActive) activeFound = true;
          return { ...board, isActive };
        }),
      })),
    };
  }

  function getSettings(boardId = null) {
    load();
    const board = requireBoard(boardId || data.activeBoardId);
    return normalizeSettings(data.settings[board.id]);
  }

  function updateSettings(boardId, fields = {}) {
    load();
    const board = requireBoard(boardId || data.activeBoardId);
    const current = normalizeSettings(data.settings[board.id]);
    const next = normalizeSettings({
      ...current,
      ...fields,
      wipLimits: {
        ...current.wipLimits,
        ...(fields?.wipLimits && typeof fields.wipLimits === 'object'
          ? fields.wipLimits
          : {}),
      },
    });
    data.settings[board.id] = next;
    recordEvent('settings.updated', { boardId: board.id, fields }, board.id, {
      type: 'human',
      id: null,
    });
    persist();
    return next;
  }

  function listSkills() {
    load();
    return data.skills.map((skill) => ({ ...skill }));
  }

  function getSkill(value) {
    load();
    const needle = String(value || '').trim().toLowerCase();
    return (
      data.skills.find((skill) => skill.id.toLowerCase() === needle) ||
      data.skills.find((skill) => skill.name.toLowerCase() === needle) ||
      null
    );
  }

  function createSkill(args = {}) {
    load();
    const name = normalizeText(args.name, 80);
    if (!name) throw new Error('Skill name is required');
    const skill = normalizeSkill({
      name,
      description: args.description,
      content: args.content,
    });
    data.skills.push(skill);
    recordEvent('skill.created', { skillId: skill.id, name: skill.name }, null, {
      type: 'human',
      id: null,
    });
    persist();
    return skill;
  }

  function updateSkill(skillId, patch = {}) {
    load();
    const skill = data.skills.find((item) => item.id === String(skillId));
    if (!skill) throw new Error('Skill not found');
    if (typeof patch.name === 'string') skill.name = normalizeText(patch.name, 80) || skill.name;
    if (typeof patch.description === 'string') skill.description = normalizeText(patch.description, 300);
    if (typeof patch.content === 'string') skill.content = normalizeText(patch.content, 20000);
    skill.updatedAt = nowIso();
    recordEvent('skill.updated', { skillId: skill.id }, null, { type: 'human', id: null });
    persist();
    return skill;
  }

  function deleteSkill(skillId) {
    load();
    const skill = data.skills.find((item) => item.id === String(skillId));
    if (!skill) throw new Error('Skill not found');
    data.skills = data.skills.filter((item) => item.id !== skill.id);
    recordEvent('skill.deleted', { skillId: skill.id }, null, { type: 'human', id: null });
    persist();
    return true;
  }

  function snapshot(boardId = null) {
    load();
    const board = requireBoard(boardId || data.activeBoardId);
    return {
      board: boardSummary(
        board,
        data.boards
          .filter((item) => item.groupId === board.groupId)
          .sort((left, right) => left.order - right.order)
          .findIndex((item) => item.id === board.id)
      ),
      boards: data.boards.map((item) => ({ ...item })),
      columns: COLUMNS.map((column) => ({
        ...column,
        wipLimit: normalizeSettings(data.settings[board.id]).wipLimits[column.id] || 0,
      })),
      tasks: boardTasks(board.id).map(taskView),
      settings: normalizeSettings(data.settings[board.id]),
      seq: data.seq,
    };
  }

  function listEvents(limit = 100) {
    load();
    const count = Math.max(1, Math.min(1000, Number(limit) || 100));
    return data.events.slice(-count).map((event) => ({ ...event }));
  }

  async function waitForEvent(options = {}) {
    load();
    const since = Number(options.since) || 0;
    const timeout = Math.max(
      1,
      Math.min(30000, Number(options.timeoutMs) || 15000)
    );
    const wantedType = String(options.type || '');
    const wantedBoard = String(options.boardId || '');
    const matches = (event) =>
      event.seq > since &&
      (!wantedType || event.type === wantedType) &&
      (!wantedBoard || event.boardId === wantedBoard);
    const existing = data.events.find(matches);
    if (existing) return { ...existing };
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const found = data.events.find(matches);
      if (found) return { ...found };
    }
    return null;
  }

  return {
    file,
    load,
    state,
    snapshot,
    listTasks,
    getTask,
    createTask,
    createTasks,
    updateTask,
    moveTask,
    moveTasks,
    deleteTask,
    addNote,
    deleteNote,
    digestNotes,
    undigestNotes,
    claimTask,
    releaseTask,
    heartbeatTask,
    claimNext,
    setBlockedReason,
    listGroups: () => {
      load();
      return groupSummaries();
    },
    createGroup,
    renameGroup,
    updateGroup,
    deleteGroup,
    listBoards: () => {
      load();
      return data.boards.map((board) => {
        const group = data.boards
          .filter((item) => item.groupId === board.groupId)
          .sort((left, right) => left.order - right.order);
        return boardSummary(
          board,
          group.findIndex((item) => item.id === board.id)
        );
      });
    },
    createBoard,
    updateBoard,
    deleteBoard,
    assignBoardToGroup,
    selectBoard,
    listRoadmap,
    getSettings,
    updateSettings,
    listSkills,
    getSkill,
    createSkill,
    updateSkill,
    deleteSkill,
    listEvents,
    waitForEvent,
  };
}

module.exports = {
  createAgileStore,
  COLUMNS,
  normalizeColumn,
  columnName,
  iterationLabel,
};
