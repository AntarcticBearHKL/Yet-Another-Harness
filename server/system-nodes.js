'use strict';

const crypto = require('node:crypto');

const DEFAULT_ROLE_MAP = {
  research: '信息收集',
  programmer: '程序员',
  code: '程序员',
  implement: '程序员',
  tester: '测试员',
  test: '测试员',
  writer: '文档写作',
  docs: '文档写作',
  reviewer: '代码审查',
  review: '代码审查',
  general: '通用',
};

const TERMINAL_COLUMNS = new Set(['finished', 'blocked']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function strings(value, limit = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function text(value, limit = 4000) {
  return String(value || '').slice(0, limit);
}

function systemNodeId() {
  return `sys-${crypto.randomUUID()}`;
}

function taskPrompt(task, goal) {
  const lines = [
    `Mission: ${goal || task.title}`,
    `Task: ${task.title}`,
    task.role ? `Role: ${task.role}` : '',
    '',
    task.description || '(no description)',
  ];
  if (task.acceptance) {
    lines.push('', `Acceptance: ${task.acceptance}`);
  }
  if (Array.isArray(task.keyPoints) && task.keyPoints.length > 0) {
    lines.push('', 'Notes:');
    for (const point of task.keyPoints) {
      if (point?.text) lines.push(`- ${point.text}`);
    }
  }
  lines.push(
    '',
    'When the task is complete, call worknode_result with taskId, status, summary, how, files, commands, tests, artifacts, blockers and followUps.',
    `taskId: ${task.id}`
  );
  return lines.filter((line) => line !== null).join('\n');
}

function buildReportMarkdown(goal, tasks) {
  const total = tasks.length;
  const finished = tasks.filter((task) => task.column === 'finished').length;
  const blocked = tasks.filter((task) => task.column === 'blocked').length;
  const statusLabel = (column) => {
    if (column === 'finished') return '完成';
    if (column === 'blocked') return '阻塞';
    if (column === 'progress') return '进行中';
    return '待处理';
  };
  const lines = [
    `# ${goal || '任务报告'}`,
    '',
    `状态：${finished}/${total} 完成，${blocked} 阻塞。`,
    '',
  ];
  for (const [index, task] of tasks.entries()) {
    lines.push(`## ${index + 1}. ${task.title}`);
    lines.push(`- 角色：${task.role || 'general'}`);
    lines.push(`- 状态：${statusLabel(task.column)}`);
    if (task.acceptance) lines.push(`- 验收标准：${task.acceptance}`);
    const result = task.result && typeof task.result === 'object' ? task.result : {};
    if (result.summary) {
      lines.push('', `### 摘要`, '', result.summary);
    }
    if (Array.isArray(result.how) && result.how.length > 0) {
      lines.push('', '### 如何完成', ...result.how.map((item) => `- ${item}`));
    }
    if (Array.isArray(result.files) && result.files.length > 0) {
      lines.push('', '### 变更文件', ...result.files.map((item) => `- ${item}`));
    }
    if (Array.isArray(result.commands) && result.commands.length > 0) {
      lines.push(
        '',
        '### 执行命令',
        ...result.commands.map((item) => `- \`${item}\``)
      );
    }
    if (Array.isArray(result.tests) && result.tests.length > 0) {
      lines.push(
        '',
        '### 测试',
        ...result.tests.map((item) => {
          if (item && typeof item === 'object') {
            return `- ${item.name || 'test'}: ${item.status || 'unknown'}`;
          }
          return `- ${item}`;
        })
      );
    }
    if (Array.isArray(result.artifacts) && result.artifacts.length > 0) {
      lines.push(
        '',
        '### 产物',
        ...result.artifacts.map((item) => `- ${item}`)
      );
    }
    if (Array.isArray(result.blockers) && result.blockers.length > 0) {
      lines.push(
        '',
        '### 阻塞',
        ...result.blockers.map((item) => `- ${item}`)
      );
    }
    if (task.blockedReason) {
      lines.push('', `阻塞原因：${task.blockedReason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function reportCounts(tasks) {
  return {
    total: tasks.length,
    finished: tasks.filter((task) => task.column === 'finished').length,
    blocked: tasks.filter((task) => task.column === 'blocked').length,
    active: tasks.filter(
      (task) => task.column === 'progress' || task.column === 'backlog'
    ).length,
  };
}

function createSystemNodeService({
  store,
  runner,
  getAgileStore,
  createWorkNode,
  getAgent,
  notify,
} = {}) {
  const watched = new Map();
  const questionTimers = new Map();
  let timer = null;
  let ticking = false;
  let started = false;

  function publish(managerId, nodeId = null) {
    try {
      notify?.({
        type: 'systemnodes.changed',
        managerId,
        nodeId,
      });
    } catch {
      /* ignore notification failures */
    }
  }

  function createNode(input = {}) {
    const node = store.createSystemNode({
      id: input.id || systemNodeId(),
      managerId: input.managerId,
      type: input.type,
      status: input.status || 'idle',
      title: input.title || input.type,
      missionId: input.missionId || null,
      taskId: input.taskId || null,
      sessionId: input.sessionId || null,
      payload: input.payload || {},
    });
    publish(node.managerId, node.id);
    return node;
  }

  function updateNode(id, patch = {}) {
    const node = store.updateSystemNode(id, patch);
    if (node) publish(node.managerId, node.id);
    return node;
  }

  function findNode(managerId, type, predicate = null) {
    return (
      store
        .listSystemNodes(managerId)
        .find(
          (node) =>
            node.type === type &&
            (!predicate || predicate(node))
        ) || null
    );
  }

  function managerSession(managerId) {
    const session = store.getSession(managerId);
    return session && session.nodeRole === 'manager' ? session : null;
  }

  function ensureOrchestrator(manager) {
    let node = findNode(manager.id, 'orchestrator');
    if (!node) {
      node = createNode({
        managerId: manager.id,
        type: 'orchestrator',
        status: 'running',
        title: '调度器',
        payload: {
          roleMap: { ...DEFAULT_ROLE_MAP },
          wipLimit: 2,
          retryLimit: 2,
          boardIds: [],
        },
      });
    }
    return node;
  }

  function ensureReport(manager, boardId, goal, taskIds = []) {
    let node = findNode(
      manager.id,
      'report',
      (item) => item.missionId === boardId
    );
    if (!node) {
      node = createNode({
        managerId: manager.id,
        type: 'report',
        status: 'collecting',
        title: `报告 · ${goal || 'Mission'}`,
        missionId: boardId,
        payload: {
          boardId,
          goal: goal || 'Mission',
          taskIds: [...taskIds],
          counts: { total: taskIds.length, finished: 0, blocked: 0, active: 0 },
          reportMarkdown: '',
        },
      });
    } else if (
      goal &&
      !node.payload?.goal
    ) {
      node = updateNode(node.id, {
        title: `报告 · ${goal}`,
        payload: { ...(node.payload || {}), goal, taskIds: [...taskIds] },
      });
    } else if (taskIds.length > 0) {
      node = updateNode(node.id, {
        payload: { ...(node.payload || {}), taskIds: [...taskIds] },
      });
    }
    return node;
  }

  function ensureMission(manager, boardId, goal, taskIds = []) {
    let orchestrator = ensureOrchestrator(manager);
    const boardIds = Array.isArray(orchestrator.payload?.boardIds)
      ? [...orchestrator.payload.boardIds]
      : [];
    const goals = {
      ...(orchestrator.payload?.goals || {}),
      ...(boardId && goal ? { [boardId]: goal } : {}),
    };
    if (boardId && !boardIds.includes(boardId)) {
      boardIds.push(boardId);
    }
    orchestrator = updateNode(orchestrator.id, {
      payload: { ...(orchestrator.payload || {}), boardIds, goals },
    });
    const report = ensureReport(manager, boardId, goal, taskIds);
    return { orchestrator, report };
  }

  function reportNodeForTask(task) {
    if (task.reportId) {
      const direct = store.getSystemNode(task.reportId);
      if (direct && direct.type === 'report') return direct;
    }
    const manager = managerSession(task.managerId);
    if (!manager) return null;
    let node = findNode(
      manager.id,
      'report',
      (item) => item.missionId === task.boardId
    );
    if (!node) {
      const existing = store
        .listSystemNodes(manager.id)
        .find((item) => item.type === 'report');
      if (existing && existing.missionId === task.boardId) return existing;
      const agile = getAgileStore(manager.id);
      const tasks = agile.listTasks(task.boardId);
      node = ensureReport(manager, task.boardId, task.title, tasks.map((item) => item.id));
    }
    return node;
  }

  function refreshReport(node, boardId, goal = null) {
    if (!node) return null;
    const manager = managerSession(node.managerId);
    if (!manager) return node;
    let tasks = [];
    try {
      const agile = getAgileStore(manager.id);
      tasks = agile.listTasks(boardId);
    } catch {
      tasks = [];
    }
    const counts = reportCounts(tasks);
    const terminal =
      counts.total > 0 && counts.finished + counts.blocked === counts.total;
    const nextGoal = goal || node.payload?.goal || 'Mission';
    const reportMarkdown = buildReportMarkdown(nextGoal, tasks);
    const status = terminal ? 'ready' : 'collecting';
    return updateNode(node.id, {
      status,
      payload: {
        ...(node.payload || {}),
        boardId,
        goal: nextGoal,
        taskIds: tasks.map((task) => task.id),
        counts,
        reportMarkdown,
        generatedAt: terminal ? Date.now() : null,
      },
    });
  }

  function markWorkNodeFailed(session, reason) {
    const taskId = session?.nodeConfig?.taskId;
    if (!taskId || !session?.managerId) return;
    try {
      const agile = getAgileStore(session.managerId);
      const task = agile.getTask(taskId);
      const workerActor = {
        type: 'agent',
        id: task.claimedBy || session.id,
      };
      agile.updateTask(taskId, {
        workNodeId: session.id,
        attempts: (Number(task.attempts) || 0) + 1,
        actor: workerActor,
      });
      agile.moveTask(taskId, 'blocked', {
        actor: workerActor,
      });
      agile.setBlockedReason(
        taskId,
        text(reason || 'work node failed', 2000),
        workerActor
      );
      const report = reportNodeForTask({ ...task, managerId: session.managerId });
      refreshReport(report, task.boardId, report?.payload?.goal || null);
    } catch (error) {
      console.error('mark work node failed', error);
    }
  }

  function submitWorkResult(session, input = {}) {
    if (!session || session.nodeRole !== 'work' || !session.managerId) {
      throw new Error('worknode_result can only be called by a work node');
    }
    const taskId = String(input.taskId || session.nodeConfig?.taskId || '').trim();
    if (!taskId) throw new Error('worknode_result requires a taskId');
    const agile = getAgileStore(session.managerId);
    const task = agile.getTask(taskId);
    if (task.result && task.column === 'finished') {
      return { ok: true, duplicate: true, taskId, reportId: task.reportId || null };
    }
    const status = ['done', 'failed', 'blocked'].includes(input.status)
      ? input.status
      : 'done';
    const result = {
      status,
      summary: text(input.summary || input.text || '', 4000),
      how: strings(input.how, 80),
      files: strings(input.files, 200),
      commands: strings(input.commands, 200),
      tests: Array.isArray(input.tests) ? input.tests.slice(0, 100) : [],
      artifacts: strings(input.artifacts, 200),
      blockers: strings(input.blockers, 80),
      followUps: strings(input.followUps, 80),
      durationMs: Number(input.durationMs) || 0,
      auto: input.auto === true,
      submittedAt: Date.now(),
    };
    let report = reportNodeForTask({
      ...task,
      managerId: session.managerId,
    });
    const workerActor = {
      type: 'agent',
      id: task.claimedBy || session.id,
    };
    agile.updateTask(taskId, {
      result,
      workNodeId: session.id,
      reportId: report?.id || '',
      attempts: (Number(task.attempts) || 0) + 1,
      actor: workerActor,
    });
    if (status === 'done') {
      agile.moveTask(taskId, 'finished', {
        actor: workerActor,
      });
    } else {
      agile.moveTask(taskId, 'blocked', {
        actor: workerActor,
      });
      agile.setBlockedReason(
        taskId,
        text(result.summary || result.blockers.join('; ') || 'work failed', 2000),
        workerActor
      );
    }
    report = reportNodeForTask({ ...task, managerId: session.managerId, reportId: report?.id });
    if (report) refreshReport(report, task.boardId, report.payload?.goal || null);
    return { ok: true, taskId, status, reportId: report?.id || null };
  }

  function createApprovalNode(session, payload = {}) {
    if (!session?.managerId) return null;
    const manager = managerSession(session.managerId);
    if (!manager) return null;
    const approvalId = String(payload.id || '').trim();
    if (!approvalId) return null;
    const existing = findNode(
      manager.id,
      'approval',
      (node) => node.payload?.approvalId === approvalId
    );
    if (existing) return existing;
    return createNode({
      managerId: manager.id,
      type: 'approval',
      status: 'pending',
      title: `审批 · ${payload.tool || 'action'}`,
      taskId: session.nodeConfig?.taskId || null,
      sessionId: session.id,
      payload: {
        approvalId,
        tool: String(payload.tool || 'action'),
        path: String(payload.path || ''),
        allowedDirs: strings(payload.allowedDirs, 50),
        requestedAt: Date.now(),
        sourceTitle: session.title || '',
      },
    });
  }

  function createQuestionNode(session, payload = {}) {
    if (!session?.managerId) return null;
    const manager = managerSession(session.managerId);
    if (!manager) return null;
    const questionId = String(payload.id || '').trim();
    if (!questionId) return null;
    const existing = findNode(
      manager.id,
      'questionnaire',
      (node) => node.payload?.questionId === questionId
    );
    if (existing) return existing;
    const mode = payload.mode === 'timed' ? 'timed' : 'blocking';
    const timeoutSeconds = Number(payload.timeoutSeconds) || 0;
    const node = createNode({
      managerId: manager.id,
      type: 'questionnaire',
      status: 'pending',
      title: '问卷',
      taskId: session.nodeConfig?.taskId || null,
      sessionId: session.id,
      payload: {
        questionId,
        questions: Array.isArray(payload.questions) ? payload.questions : [],
        mode,
        timeoutSeconds,
        requestedAt: Date.now(),
        sourceTitle: session.title || '',
      },
    });
    if (mode === 'timed' && timeoutSeconds > 0) {
      const timerKey = node.id;
      const timeout = setTimeout(() => {
        questionTimers.delete(timerKey);
        const current = store.getSystemNode(node.id);
        if (current?.status !== 'pending') return;
        updateNode(node.id, { status: 'expired' });
      }, (timeoutSeconds + 3) * 1000);
      timeout.unref?.();
      questionTimers.set(timerKey, timeout);
    }
    return node;
  }

  function updateApprovalNode(payload = {}) {
    const approvalId = String(payload.id || '').trim();
    if (!approvalId) return;
    for (const node of store.listSystemNodes()) {
      if (node.type !== 'approval') continue;
      if (node.payload?.approvalId !== approvalId) continue;
      updateNode(node.id, {
        status: payload.approved === true ? 'approved' : 'denied',
        payload: {
          ...(node.payload || {}),
          decidedAt: Date.now(),
          reason: String(payload.reason || ''),
        },
      });
    }
  }

  function updateQuestionNode(payload = {}) {
    const questionId = String(payload.id || '').trim();
    if (!questionId) return;
    for (const node of store.listSystemNodes()) {
      if (node.type !== 'questionnaire') continue;
      if (node.payload?.questionId !== questionId) continue;
      const timer = questionTimers.get(node.id);
      if (timer) {
        clearTimeout(timer);
        questionTimers.delete(node.id);
      }
      updateNode(node.id, {
        status: payload.cancelled === true
          ? 'dismissed'
          : payload.timedOut === true
            ? 'expired'
            : 'answered',
        payload: {
          ...(node.payload || {}),
          answers: Array.isArray(payload.answers) ? payload.answers : [],
          answeredAt: Date.now(),
          timedOut: payload.timedOut === true,
        },
      });
    }
  }

  function watchWorkNode(session, reportId = null) {
    if (!session?.id || watched.has(session.id)) return;
    const unsubscribe = runner.subscribe(session.id, (event) => {
      if (!event) return;
      if (event.type === 'tool.approval') {
        createApprovalNode(session, event.payload);
      } else if (event.type === 'tool.question') {
        createQuestionNode(session, event.payload);
      } else if (event.type === 'tool.approval.resolved') {
        updateApprovalNode(event.payload);
      } else if (event.type === 'tool.question.resolved') {
        updateQuestionNode(event.payload);
      } else if (event.type === 'run.done') {
        const taskId = session.nodeConfig?.taskId;
        const summary = String(event.payload?.text || '').trim();
        if (taskId && summary) {
          try {
            submitWorkResult(session, {
              taskId,
              status: 'done',
              summary,
              auto: true,
            });
          } catch (error) {
            console.error('auto submit work result failed', error);
          }
        }
      } else if (event.type === 'run.error') {
        markWorkNodeFailed(session, event.payload?.error || 'run failed');
      }
    });
    watched.set(session.id, unsubscribe);
  }

  function unwatchWorkNode(sessionId) {
    const key = String(sessionId || '').trim();
    const unsubscribe = watched.get(key);
    if (!unsubscribe) return;
    try {
      unsubscribe();
    } catch {
      /* ignore */
    }
    watched.delete(key);
  }

  async function tickManager(manager, orchestrator) {
    const payload = orchestrator.payload || {};
    const boardIds = Array.isArray(payload.boardIds) ? payload.boardIds : [];
    if (boardIds.length === 0) return;
    const agile = getAgileStore(manager.id);
    const roleMap = payload.roleMap || DEFAULT_ROLE_MAP;
    const wipLimit = Math.max(1, Number(payload.wipLimit) || 2);
    for (const boardId of boardIds) {
      let tasks;
      try {
        tasks = agile.listTasks(boardId);
      } catch {
        continue;
      }
      if (tasks.length === 0) continue;
      let active = tasks.filter((task) => task.column === 'progress').length;
      for (const task of tasks) {
        if (task.column !== 'progress') continue;
        if (task.workNodeId) continue;
        try {
          agile.moveTask(task.id, 'backlog', {
            actor: { type: 'agent', id: orchestrator.id },
          });
          agile.releaseTask(task.id, {
            type: 'agent',
            id: orchestrator.id,
          });
        } catch {
          /* ignore recovery failure */
        }
      }
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const eligible = tasks
        .filter((task) => task.column === 'backlog')
        .filter((task) => task.autoDispatch !== false)
        .filter((task) => !task.needsDigest)
        .filter((task) =>
          (Array.isArray(task.dependsOn) ? task.dependsOn : []).every(
            (id) => byId.get(id)?.column === 'finished'
          )
        )
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));
      if (eligible.length === 0) continue;
      const report = ensureReport(
        manager,
        boardId,
        payload.goals?.[boardId] || tasks[0]?.title || 'Mission',
        tasks.map((task) => task.id)
      );      for (const task of eligible) {
        if (active >= wipLimit) break;
        try {
          agile.claimTask(task.id, orchestrator.id);
          agile.moveTask(task.id, 'progress', {
            actor: { type: 'agent', id: orchestrator.id },
          });
          const role = String(task.role || 'general');
          const agentName = roleMap[role] || role || '通用';
          const agent = getAgent?.(agentName);
          if (!agent || agent.kind !== 'agent') {
            throw new Error(`Agent profile not found: ${agentName}`);
          }
          const created = await createWorkNode(manager, {
            title: task.title,
            task: taskPrompt(task, report?.payload?.goal || 'Mission'),
            agentId: agentName,
            taskId: task.id,
            reportId: report.id,
            start: true,
          });
          if (!created?.ok) throw new Error(created?.error || 'work node creation failed');
          agile.updateTask(task.id, {
            workNodeId: created.id,
            reportId: report.id,
            attempts: (Number(task.attempts) || 0) + 1,
            actor: { type: 'agent', id: orchestrator.id },
          });
          watchWorkNode(created.workNode, report.id);
          active += 1;
        } catch (error) {
          try {
            agile.moveTask(task.id, 'blocked', {
              actor: { type: 'agent', id: orchestrator.id },
            });
            agile.setBlockedReason(
              task.id,
              `调度失败: ${error.message}`,
              { type: 'agent', id: orchestrator.id }
            );
          } catch {
            /* ignore failure recovery */
          }
          refreshReport(report, boardId, report?.payload?.goal || 'Mission');
        }
      }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const managers = store
        .loadChats()
        .sessions.filter(
          (session) => session.nodeRole === 'manager' && !session.archivedAt
        );
      for (const manager of managers) {
        const orchestrator = findNode(manager.id, 'orchestrator');
        if (!orchestrator || orchestrator.status !== 'running') continue;
        try {
          await tickManager(manager, orchestrator);
        } catch (error) {
          console.error('orchestrator tick failed', error);
        }
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (started) return;
    started = true;
    timer = setInterval(() => void tick(), 1500);
    timer.unref?.();
    void tick();
  }

  function stop() {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    for (const unsubscribe of watched.values()) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    watched.clear();
    for (const handle of questionTimers.values()) {
      clearTimeout(handle);
    }
    questionTimers.clear();
  }

  function action(nodeId, actionName, input = {}) {
    const node = store.getSystemNode(nodeId);
    if (!node) throw new Error('system node not found');
    const name = String(actionName || '').trim();
    if (node.type === 'report') {
      if (name === 'read') {
        return updateNode(node.id, {
          status: 'read',
          payload: { ...(node.payload || {}), readAt: Date.now() },
        });
      }
      if (name === 'archive') {
        return updateNode(node.id, { status: 'archived' });
      }
      if (name === 'build') {
        return refreshReport(node, node.missionId, node.payload?.goal);
      }
      throw new Error(`unknown report action: ${name}`);
    }
    if (node.type === 'approval') {
      if (name !== 'approve' && name !== 'deny') {
        throw new Error(`unknown approval action: ${name}`);
      }
      const approved = name === 'approve';
      const ok = runner.resolveApproval(node.payload?.approvalId, approved);
      return updateNode(node.id, {
        status: ok ? (approved ? 'approved' : 'denied') : 'expired',
        payload: {
          ...(node.payload || {}),
          decidedAt: Date.now(),
          reason: ok ? (approved ? 'approved' : 'denied') : 'not pending',
        },
      });
    }
    if (node.type === 'questionnaire') {
      if (name === 'answer' || name === 'dismiss') {
        const answers = name === 'dismiss' ? [] : input.answers;
        const ok = runner.resolveQuestions(node.payload?.questionId, {
          answers: Array.isArray(answers) ? answers : [],
          cancelled: name === 'dismiss',
        });
        return updateNode(node.id, {
          status: ok
            ? name === 'dismiss'
              ? 'dismissed'
              : 'answered'
            : 'expired',
          payload: {
            ...(node.payload || {}),
            answers: Array.isArray(answers) ? answers : [],
            answeredAt: Date.now(),
          },
        });
      }
      throw new Error(`unknown questionnaire action: ${name}`);
    }
    if (node.type === 'orchestrator') {
      if (name === 'pause' || name === 'resume') {
        return updateNode(node.id, {
          status: name === 'pause' ? 'paused' : 'running',
        });
      }
      throw new Error(`unknown orchestrator action: ${name}`);
    }
    throw new Error(`system node has no actions: ${node.type}`);
  }

  function list(managerId = '') {
    return store.listSystemNodes(managerId);
  }

  return {
    createNode,
    updateNode,
    list,
    ensureOrchestrator,
    ensureReport,
    ensureMission,
    submitWorkResult,
    watchWorkNode,
    unwatchWorkNode,
    action,
    tick,
    start,
    stop,
  };
}

module.exports = {
  createSystemNodeService,
  DEFAULT_ROLE_MAP,
  taskPrompt,
  buildReportMarkdown,
  reportCounts,
};
