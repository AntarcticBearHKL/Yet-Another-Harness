'use strict';

let store = null;
let resolveStore = null;

function configure(next) {
  if (typeof next === 'function') {
    resolveStore = next;
    store = null;
    return;
  }
  resolveStore = null;
  store = next || null;
}

function getStore(context = null) {
  if (resolveStore) {
    const resolved = resolveStore(context);
    if (resolved) return resolved;
  }
  if (store) return store;
  throw new Error('Agile store is not configured');
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function actorFor(args) {
  return {
    type: 'agent',
    id: String(args?.agent || args?.agentId || 'yah-agent').trim() || 'yah-agent',
  };
}

function agileListGroups(args = {}, context = null) {
  return json(getStore(context).listGroups());
}

function agileCreateGroup(args = {}, context = null) {
  return json(getStore(context).createGroup(args.name));
}

function agileRenameGroup(args = {}, context = null) {
  return json(getStore(context).renameGroup(args.groupId, args.name));
}

function agileDeleteGroup(args = {}, context = null) {
  return json({ deleted: getStore(context).deleteGroup(args.groupId) });
}

function agileListBoards(args = {}, context = null) {
  return json(getStore(context).listBoards());
}

function agileGetBoard(args = {}, context = null) {
  return json(getStore(context).snapshot(args.boardId));
}

function agileCreateBoard(args = {}, context = null) {
  return json(getStore(context).createBoard(args.groupId));
}

function agileUpdateBoard(args = {}, context = null) {
  return json(
    getStore(context).updateBoard(args.boardId, {
      startDate: args.startDate,
      endDate: args.endDate,
      goal: args.goal,
    })
  );
}

function agileDeleteBoard(args = {}, context = null) {
  return json({ deleted: getStore(context).deleteBoard(args.boardId) });
}

function agileAssignBoardToGroup(args = {}, context = null) {
  return json(getStore(context).assignBoardToGroup(args.boardId, args.groupId));
}

function agileListTasks(args = {}, context = null) {
  return json(
    getStore(context).listTasks(args.boardId, {
      column: args.column,
      search: args.search,
      claimedBy: args.claimedBy,
      needsDigest: args.needsDigest,
      ready: args.ready,
    })
  );
}

function agileGetTask(args = {}, context = null) {
  return json(getStore(context).getTask(args.taskId));
}

function agileCreateTask(args = {}, context = null) {
  return json(
    getStore(context).createTask({
      boardId: args.boardId,
      column: 'backlog',
      title: args.title,
      description: args.description,
      assignee: args.assignee,
      actor: actorFor(args),
    })
  );
}

function agileCreateTasks(args = {}, context = null) {
  return json(
    getStore(context).createTasks({
      boardId: args.boardId,
      tasks: args.tasks,
      actor: actorFor(args),
    })
  );
}

function agileUpdateTask(args = {}, context = null) {
  return json(
    getStore(context).updateTask(args.taskId, {
      title: args.title,
      description: args.description,
      assignee: args.assignee,
      blockedReason: args.blockedReason,
      actor: actorFor(args),
    })
  );
}

function agileMoveTask(args = {}, context = null) {
  return json(
    getStore(context).moveTask(args.taskId, args.column, {
      position: args.position,
      actor: actorFor(args),
    })
  );
}

function agileMoveTasks(args = {}, context = null) {
  return json(
    getStore(context).moveTasks(args.taskIds, args.column, {
      position: args.position,
      actor: actorFor(args),
    })
  );
}

function agileDeleteTask(args = {}, context = null) {
  return json({
    deleted: getStore(context).deleteTask(args.taskId, {
      actor: actorFor(args),
    }),
  });
}

function agileSetBlockedReason(args = {}, context = null) {
  return json(
    getStore(context).setBlockedReason(args.taskId, args.reason, actorFor(args))
  );
}

function agileClaimTask(args = {}, context = null) {
  return json(getStore(context).claimTask(args.taskId, args.agent));
}

function agileReleaseTask(args = {}, context = null) {
  return json(getStore(context).releaseTask(args.taskId, actorFor(args)));
}

function agileHeartbeatTask(args = {}, context = null) {
  return json(getStore(context).heartbeatTask(args.taskId, actorFor(args)));
}

function agileClaimNext(args = {}, context = null) {
  return json(getStore(context).claimNext(args.boardId, args.agent));
}

function agileDigestNotes(args = {}, context = null) {
  return json(
    getStore(context).digestNotes(args.taskId, args.pointIds, actorFor(args))
  );
}

function agileUndigestNotes(args = {}, context = null) {
  return json(
    getStore(context).undigestNotes(args.taskId, args.pointIds, actorFor(args))
  );
}

function agileListColumns(args = {}, context = null) {
  return json(
    getStore(context)
      .snapshot()
      .columns
  );
}

function agileGetBoardSnapshot(args = {}, context = null) {
  return json(getStore(context).snapshot(args.boardId));
}

function agileGetSettings(args = {}, context = null) {
  return json(getStore(context).getSettings(args.boardId));
}

function agileUpdateSettings(args = {}, context = null) {
  return json(
    getStore(context).updateSettings(args.boardId, args.fields || args)
  );
}

function agileListEvents(args = {}, context = null) {
  return json(getStore(context).listEvents(args.limit));
}

async function agileWaitForEvent(args = {}, context = null) {
  const event = await getStore(context).waitForEvent({
    since: args.since,
    timeoutMs: args.timeoutMs,
    type: args.type,
    boardId: args.boardId,
  });
  if (!event) {
    return json({
      timedOut: true,
      seq: getStore(context).listEvents(1)[0]?.seq || 0,
      since: Number(args.since) || 0,
    });
  }
  return json({
    timedOut: false,
    seq: event.seq,
    since: Number(args.since) || 0,
    event,
  });
}

function agileListRoadmap(args = {}, context = null) {
  return json(getStore(context).listRoadmap());
}

function agileListSkills(args = {}, context = null) {
  return json(getStore(context).listSkills());
}

function agileGetSkill(args = {}, context = null) {
  const skill = getStore(context).getSkill(args.skill || args.skillId || args.name);
  if (!skill) throw new Error('Skill not found');
  return json(skill);
}

function agileCreateSkill(args = {}, context = null) {
  return json(
    getStore(context).createSkill({
      name: args.name,
      description: args.description,
      content: args.content,
    })
  );
}

function agileUpdateSkill(args = {}, context = null) {
  return json(
    getStore(context).updateSkill(args.skillId, {
      name: args.name,
      description: args.description,
      content: args.content,
    })
  );
}

function agileDeleteSkill(args = {}, context = null) {
  return json({ deleted: getStore(context).deleteSkill(args.skillId) });
}

module.exports = {
  configure,
  agileListGroups,
  agileCreateGroup,
  agileRenameGroup,
  agileDeleteGroup,
  agileListBoards,
  agileGetBoard,
  agileCreateBoard,
  agileUpdateBoard,
  agileDeleteBoard,
  agileAssignBoardToGroup,
  agileListTasks,
  agileGetTask,
  agileCreateTask,
  agileCreateTasks,
  agileUpdateTask,
  agileMoveTask,
  agileMoveTasks,
  agileDeleteTask,
  agileSetBlockedReason,
  agileClaimTask,
  agileReleaseTask,
  agileHeartbeatTask,
  agileClaimNext,
  agileDigestNotes,
  agileUndigestNotes,
  agileListColumns,
  agileGetBoardSnapshot,
  agileGetSettings,
  agileUpdateSettings,
  agileListEvents,
  agileWaitForEvent,
  agileListRoadmap,
  agileListSkills,
  agileGetSkill,
  agileCreateSkill,
  agileUpdateSkill,
  agileDeleteSkill,
};
