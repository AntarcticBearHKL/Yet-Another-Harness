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

function normalizeTasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const title = text(item.title);
      if (!title) return null;
      return {
        index,
        title: title.slice(0, 200),
        description: text(item.description),
        role: text(item.role) || 'general',
        acceptance: text(item.acceptance),
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.map(String).filter(Boolean)
          : [],
        autoDispatch: item.autoDispatch !== false,
      };
    })
    .filter(Boolean);
}

async function missionDispatch(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can dispatch a mission');
  if (typeof providers.getAgileStore !== 'function') {
    return error('Agile store is not configured');
  }
  if (!providers.systemNodeService) {
    return error('system node service is not configured');
  }
  const goal = text(args.goal) || text(args.title);
  if (!goal) return error('mission_dispatch requires a goal');
  const items = normalizeTasks(args.tasks);
  if (items.length === 0) return error('mission_dispatch requires at least one task');
  let agile;
  try {
    agile = providers.getAgileStore(manager.id);
  } catch (dispatchError) {
    return error(dispatchError.message);
  }
  let boardId = text(args.boardId);
  try {
    if (boardId) {
      agile.snapshot(boardId);
    } else {
      boardId = agile.createBoard().id;
    }
  } catch (boardError) {
    return error(`Agile board unavailable: ${boardError.message}`);
  }
  const created = [];
  try {
    for (const item of items) {
      created.push(
        agile.createTask({
          boardId,
          column: 'backlog',
          title: item.title,
          description: item.description,
          role: item.role,
          acceptance: item.acceptance,
          autoDispatch: item.autoDispatch && args.autoDispatch !== false,
          actor: { type: 'agent', id: manager.id },
        })
      );
    }
  } catch (createError) {
    return error(`failed to create Agile tasks: ${createError.message}`);
  }
  const byIndex = new Map(created.map((task, index) => [index, task.id]));
  const byTitle = new Map(created.map((task) => [task.title, task.id]));
  const byId = new Map(created.map((task) => [task.id, task.id]));
  for (const [index, item] of items.entries()) {
    const dependsOn = [];
    for (const dependency of item.dependsOn) {
      const value = text(dependency);
      if (!value) continue;
      if (byId.has(value)) dependsOn.push(value);
      else if (byTitle.has(value)) dependsOn.push(byTitle.get(value));
      else if (/^\d+$/.test(value) && byIndex.has(Number(value))) {
        dependsOn.push(byIndex.get(Number(value)));
      }
    }
    if (dependsOn.length > 0) {
      try {
        agile.updateTask(created[index].id, {
          dependsOn,
          actor: { type: 'agent', id: manager.id },
        });
      } catch {
        /* keep the task even if dependency resolution fails */
      }
    }
  }
  const mission = providers.systemNodeService.ensureMission(
    manager,
    boardId,
    goal,
    created.map((task) => task.id)
  );
  try {
    await providers.systemNodeService.tick();
  } catch (tickError) {
    console.error('mission dispatch tick failed', tickError);
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      boardId,
      goal,
      taskIds: created.map((task) => task.id),
      tasks: created.map((task) => ({
        id: task.id,
        title: task.title,
        role: task.role,
      })),
      orchestratorId: mission.orchestrator?.id || null,
      reportId: mission.report?.id || null,
      agileId: mission.agile?.id || null,
    },
    null,
    2
  );
}

function worknodeResult(args = {}, context = null) {
  const sessionId = text(context?.sessionId);
  if (!sessionId) return error('worknode_result requires a session context');
  const session = store.getSession(sessionId);
  if (!session || session.nodeRole !== 'work') {
    return error('worknode_result can only be called by a work node');
  }
  if (!providers.systemNodeService) {
    return error('system node service is not configured');
  }
  try {
    const result = providers.systemNodeService.submitWorkResult(session, args);
    return JSON.stringify(result, null, 2);
  } catch (submitError) {
    return error(submitError.message);
  }
}

function missionStatus(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can inspect a mission');
  if (typeof providers.getAgileStore !== 'function') {
    return error('Agile store is not configured');
  }
  if (!providers.systemNodeService) {
    return error('system node service is not configured');
  }
  const nodes = providers.systemNodeService.list(manager.id);
  const orchestrator = nodes.find((node) => node.type === 'orchestrator');
  const wanted = text(args.boardId);
  const boardIds = wanted
    ? [wanted]
    : Array.isArray(orchestrator?.payload?.boardIds)
      ? orchestrator.payload.boardIds
      : [];
  if (boardIds.length === 0) {
    return JSON.stringify(
      {
        ok: true,
        managerId: manager.id,
        orchestrator: orchestrator
          ? {
              id: orchestrator.id,
              status: orchestrator.status,
              steps: orchestrator.payload?.steps || [],
            }
          : null,
        missions: [],
      },
      null,
      2
    );
  }
  let agile;
  try {
    agile = providers.getAgileStore(manager.id);
  } catch (statusError) {
    return error(statusError.message);
  }
  const missions = [];
  for (const boardId of boardIds) {
    try {
      const snapshot = agile.snapshot(boardId);
      const tasks = snapshot.tasks || [];
      const report = nodes.find(
        (node) => node.type === 'report' && node.missionId === boardId
      );
      missions.push({
        boardId,
        goal: report?.payload?.goal || snapshot.board?.goal || '',
        board: snapshot.board,
        counts: {
          total: tasks.length,
          backlog: tasks.filter((task) => task.column === 'backlog').length,
          progress: tasks.filter((task) => task.column === 'progress').length,
          blocked: tasks.filter((task) => task.column === 'blocked').length,
          finished: tasks.filter((task) => task.column === 'finished').length,
        },
        report: report
          ? {
              id: report.id,
              status: report.status,
              counts: report.payload?.counts || null,
            }
          : null,
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          role: task.role,
          column: task.column,
          workNodeId: task.workNodeId || null,
          dependsOn: task.dependsOn || [],
          result: task.result ? task.result.status : null,
        })),
      });
    } catch {
      /* skip a board that no longer exists */
    }
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      orchestrator: orchestrator
        ? {
            id: orchestrator.id,
            status: orchestrator.status,
            steps: orchestrator.payload?.steps || [],
          }
        : null,
      missions,
    },
    null,
    2
  );
}

function missionReport(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can read a mission report');
  if (!providers.systemNodeService) {
    return error('system node service is not configured');
  }
  const boardId = text(args.boardId);
  const reports = providers.systemNodeService
    .list(manager.id)
    .filter((node) => node.type === 'report')
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const report = boardId
    ? reports.find((node) => node.missionId === boardId)
    : reports[0];
  if (!report) return error('report not found');
  return JSON.stringify(
    {
      ok: true,
      id: report.id,
      boardId: report.missionId,
      title: report.title,
      status: report.status,
      counts: report.payload?.counts || null,
      goal: report.payload?.goal || '',
      reportMarkdown: report.payload?.reportMarkdown || '',
      steps: report.payload?.steps || [],
    },
    null,
    2
  );
}

module.exports = {
  configure,
  missionDispatch,
  missionStatus,
  missionReport,
  worknodeResult,
};
