'use strict';

let store = null;

function configure(next) {
  store = next;
}

function getStore() {
  if (!store) throw new Error('Agile store is not configured');
  return store;
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

function agileListGroups() {
  return json(getStore().listGroups());
}

function agileCreateGroup(args = {}) {
  return json(getStore().createGroup(args.name));
}

function agileRenameGroup(args = {}) {
  return json(getStore().renameGroup(args.groupId, args.name));
}

function agileDeleteGroup(args = {}) {
  return json({ deleted: getStore().deleteGroup(args.groupId) });
}

function agileListBoards() {
  return json(getStore().listBoards());
}

function agileGetBoard(args = {}) {
  return json(getStore().snapshot(args.boardId));
}

function agileCreateBoard(args = {}) {
  return json(getStore().createBoard(args.groupId));
}

function agileUpdateBoard(args = {}) {
  return json(
    getStore().updateBoard(args.boardId, {
      startDate: args.startDate,
      endDate: args.endDate,
      goal: args.goal,
    })
  );
}

function agileDeleteBoard(args = {}) {
  return json({ deleted: getStore().deleteBoard(args.boardId) });
}

function agileAssignBoardToGroup(args = {}) {
  return json(getStore().assignBoardToGroup(args.boardId, args.groupId));
}

function agileListTasks(args = {}) {
  return json(
    getStore().listTasks(args.boardId, {
      column: args.column,
      search: args.search,
      claimedBy: args.claimedBy,
      needsDigest: args.needsDigest,
      ready: args.ready,
    })
  );
}

function agileGetTask(args = {}) {
  return json(getStore().getTask(args.taskId));
}

function agileCreateTask(args = {}) {
  return json(
    getStore().createTask({
      boardId: args.boardId,
      column: 'backlog',
      title: args.title,
      description: args.description,
      assignee: args.assignee,
      actor: actorFor(args),
    })
  );
}

function agileCreateTasks(args = {}) {
  return json(
    getStore().createTasks({
      boardId: args.boardId,
      tasks: args.tasks,
      actor: actorFor(args),
    })
  );
}

function agileUpdateTask(args = {}) {
  return json(
    getStore().updateTask(args.taskId, {
      title: args.title,
      description: args.description,
      assignee: args.assignee,
      blockedReason: args.blockedReason,
      actor: actorFor(args),
    })
  );
}

function agileMoveTask(args = {}) {
  return json(
    getStore().moveTask(args.taskId, args.column, {
      position: args.position,
      actor: actorFor(args),
    })
  );
}

function agileMoveTasks(args = {}) {
  return json(
    getStore().moveTasks(args.taskIds, args.column, {
      position: args.position,
      actor: actorFor(args),
    })
  );
}

function agileDeleteTask(args = {}) {
  return json({
    deleted: getStore().deleteTask(args.taskId, {
      actor: actorFor(args),
    }),
  });
}

function agileSetBlockedReason(args = {}) {
  return json(
    getStore().setBlockedReason(args.taskId, args.reason, actorFor(args))
  );
}

function agileClaimTask(args = {}) {
  return json(getStore().claimTask(args.taskId, args.agent));
}

function agileReleaseTask(args = {}) {
  return json(getStore().releaseTask(args.taskId, actorFor(args)));
}

function agileHeartbeatTask(args = {}) {
  return json(getStore().heartbeatTask(args.taskId, actorFor(args)));
}

function agileClaimNext(args = {}) {
  return json(getStore().claimNext(args.boardId, args.agent));
}

function agileDigestNotes(args = {}) {
  return json(
    getStore().digestNotes(args.taskId, args.pointIds, actorFor(args))
  );
}

function agileUndigestNotes(args = {}) {
  return json(
    getStore().undigestNotes(args.taskId, args.pointIds, actorFor(args))
  );
}

function agileListColumns() {
  return json(
    getStore()
      .snapshot()
      .columns
  );
}

function agileGetBoardSnapshot(args = {}) {
  return json(getStore().snapshot(args.boardId));
}

function agileGetSettings(args = {}) {
  return json(getStore().getSettings(args.boardId));
}

function agileUpdateSettings(args = {}) {
  return json(
    getStore().updateSettings(args.boardId, args.fields || args)
  );
}

function agileListEvents(args = {}) {
  return json(getStore().listEvents(args.limit));
}

async function agileWaitForEvent(args = {}) {
  const event = await getStore().waitForEvent({
    since: args.since,
    timeoutMs: args.timeoutMs,
    type: args.type,
    boardId: args.boardId,
  });
  if (!event) {
    return json({
      timedOut: true,
      seq: getStore().listEvents(1)[0]?.seq || 0,
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

function agileListRoadmap() {
  return json(getStore().listRoadmap());
}

function agileListSkills() {
  return json(getStore().listSkills());
}

function agileGetSkill(args = {}) {
  const skill = getStore().getSkill(args.skill || args.skillId || args.name);
  if (!skill) throw new Error('Skill not found');
  return json(skill);
}

function agileCreateSkill(args = {}) {
  return json(
    getStore().createSkill({
      name: args.name,
      description: args.description,
      content: args.content,
    })
  );
}

function agileUpdateSkill(args = {}) {
  return json(
    getStore().updateSkill(args.skillId, {
      name: args.name,
      description: args.description,
      content: args.content,
    })
  );
}

function agileDeleteSkill(args = {}) {
  return json({ deleted: getStore().deleteSkill(args.skillId) });
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
