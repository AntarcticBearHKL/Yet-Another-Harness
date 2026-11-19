'use strict';

const store = require('../store');

let providers = {
  getAgileStore: null,
  systemNodeService: null,
};

function configure(next = {}) {
  providers = { ...providers, ...next };
}

function text(value) {
  return String(value ?? '').trim();
}

function error(message) {
  return `tool error: ${message}`;
}

function managerFor(context) {
  const sessionId = text(context?.sessionId);
  if (!sessionId) return null;
  const session = store.getSession(sessionId);
  if (!session || session.nodeRole !== 'manager') return null;
  return session;
}

function workSessionFor(context) {
  const sessionId = text(context?.sessionId);
  if (!sessionId) return null;
  const session = store.getSession(sessionId);
  if (!session || session.nodeRole !== 'work') return null;
  return session;
}

function agileFor(manager) {
  if (typeof providers.getAgileStore !== 'function') {
    throw new Error('Agile store is not configured');
  }
  return providers.getAgileStore(manager.id);
}

function normalizeTasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = text(item.title);
      if (!title) return null;
      return {
        title: title.slice(0, 200),
        description: text(item.description),
        role: text(item.role) || 'programmer',
        acceptance: text(item.acceptance),
      };
    })
    .filter(Boolean);
}

function taskView(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    role: task.role,
    acceptance: task.acceptance,
    column: task.column,
    assignee: task.assignee || null,
    workNodeId: task.workNodeId || null,
    blockedReason: task.blockedReason || null,
    blockedBy: task.blockedBy || null,
    blockedKind: task.blockedKind || null,
    result: task.result
      ? {
          status: task.result.status || null,
          summary: task.result.summary || '',
        }
      : null,
  };
}

function backlogList(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can list backlog');
  let agile;
  try {
    agile = agileFor(manager);
  } catch (listError) {
    return error(listError.message);
  }
  let iterations = [];
  try {
    iterations = agile.listRoadmap().iterations || [];
  } catch {
    iterations = [];
  }
  const wanted = text(args.iterationId || args.boardId);
  const activeIterationId =
    wanted ||
    iterations.find((iteration) => iteration.isActive)?.id ||
    iterations.at(-1)?.id ||
    '';
  let tasks = [];
  if (activeIterationId) {
    try {
      tasks = agile.snapshot(activeIterationId).tasks || [];
    } catch {
      tasks = [];
    }
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      activeIterationId,
      iterations,
      tasks: tasks.map(taskView),
    },
    null,
    2
  );
}

function iterationAdd(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can add an iteration');
  let agile;
  try {
    agile = agileFor(manager);
  } catch (iterationError) {
    return error(iterationError.message);
  }
  let board;
  try {
    board = agile.createBoard();
  } catch (createError) {
    return error(`failed to create iteration: ${createError.message}`);
  }
  const goal = text(args.goal || args.name) || board.label || 'Iteration';
  let mission = null;
  try {
    mission = providers.systemNodeService?.ensureMission(
      manager,
      board.id,
      goal,
      []
    );
  } catch (missionError) {
    console.error('iteration mission setup failed', missionError);
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      iterationId: board.id,
      label: board.label,
      goal,
      orchestratorId: mission?.orchestrator?.id || null,
      reportId: mission?.report?.id || null,
    },
    null,
    2
  );
}

async function backlogAdd(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can add backlog tasks');
  const items = normalizeTasks(args.tasks);
  if (items.length === 0) {
    return error('backlog_add requires at least one task');
  }
  let agile;
  try {
    agile = agileFor(manager);
  } catch (addError) {
    return error(addError.message);
  }
  let iterationId = text(args.iterationId || args.boardId);
  if (!iterationId) {
    try {
      const iterations = agile.listRoadmap().iterations || [];
      iterationId =
        iterations.find((iteration) => iteration.isActive)?.id ||
        iterations.at(-1)?.id ||
        '';
    } catch {
      iterationId = '';
    }
  }
  if (!iterationId) {
    try {
      iterationId = agile.createBoard().id;
    } catch (createError) {
      return error(`failed to create iteration: ${createError.message}`);
    }
  }
  const goal = text(args.goal) || 'Mission';
  const created = [];
  try {
    for (const item of items) {
      created.push(
        agile.createTask({
          boardId: iterationId,
          column: 'backlog',
          title: item.title,
          description: item.description,
          role: item.role,
          acceptance: item.acceptance,
          autoDispatch: true,
          actor: { type: 'agent', id: manager.id },
        })
      );
    }
  } catch (createError) {
    return error(`failed to create backlog tasks: ${createError.message}`);
  }
  let mission = null;
  try {
    mission = providers.systemNodeService?.ensureMission(
      manager,
      iterationId,
      goal,
      created.map((task) => task.id)
    );
  } catch (missionError) {
    console.error('backlog mission setup failed', missionError);
  }
  try {
    await providers.systemNodeService?.tick?.();
  } catch (tickError) {
    console.error('backlog dispatch tick failed', tickError);
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      iterationId,
      goal,
      tasks: created.map(taskView),
      orchestratorId: mission?.orchestrator?.id || null,
      reportId: mission?.report?.id || null,
    },
    null,
    2
  );
}

function taskBlock(args = {}, context = null) {
  const session = workSessionFor(context || args.context);
  if (!session) return error('task_block can only be called by a work node');
  if (!providers.systemNodeService?.blockTask) {
    return error('system node service is not configured');
  }
  try {
    const result = providers.systemNodeService.blockTask(session, args);
    return JSON.stringify(
      {
        ...result,
        message:
          'Task blocked. Stop working now; the orchestrator will resume this conversation after the approval or questionnaire is resolved.',
      },
      null,
      2
    );
  } catch (blockError) {
    return error(blockError.message);
  }
}

function taskFinish(args = {}, context = null) {
  const session = workSessionFor(context || args.context);
  if (!session) return error('task_finish can only be called by a work node');
  if (!providers.systemNodeService?.submitWorkResult) {
    return error('system node service is not configured');
  }
  try {
    const result = providers.systemNodeService.submitWorkResult(session, {
      ...args,
      status: 'done',
    });
    return JSON.stringify(result, null, 2);
  } catch (finishError) {
    return error(finishError.message);
  }
}

module.exports = {
  configure,
  backlogList,
  backlogAdd,
  iterationAdd,
  taskBlock,
  taskFinish,
};
