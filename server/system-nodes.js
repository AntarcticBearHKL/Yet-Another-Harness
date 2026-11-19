'use strict';

const crypto = require('node:crypto');
const { AGENT_AGENT_ID } = require('../src/agent-defaults');
const { normalizeQuestions } = require('../src/tools/agent');

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

function taskPrompt(task, goal, roleName = '') {
  const lines = [
    `Mission: ${goal || task.title}`,
    `Task: ${task.title}`,
    task.role ? `Role: ${task.role}` : '',
    roleName ? `Delegate to Subagent: ${roleName}` : '',
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
    'When the task is complete, call task_finish with summary, how, files, commands, tests, artifacts, branches, blockers and followUps.',
    'If you need approval or an answer before continuing, call task_block with kind approval or question. The task becomes blocked, the user sees who sent it, and the orchestrator resumes this conversation after it is resolved.',
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
    if (Array.isArray(result.branches) && result.branches.length > 0) {
      lines.push(
        '',
        '### Git 分支',
        ...result.branches.map((item) => `- ${item}`)
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
  canvasStore,
  getAgileStore,
  createWorkNode,
  createEngineer,
  closeEngineer,
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

  function appendStep(node, message, extra = {}) {
    if (!node?.id) return node;
    const current = store.getSystemNode(node.id);
    if (!current) return node;
    const steps = Array.isArray(current.payload?.steps)
      ? current.payload.steps
      : [];
    steps.push({
      at: Date.now(),
      message: String(message || ''),
      ...extra,
    });
    return updateNode(current.id, {
      payload: {
        ...(current.payload || {}),
        steps: steps.slice(-100),
      },
    });
  }

  function managerSession(managerId) {
    const session = store.getSession(managerId);
    return session && session.nodeRole === 'manager' ? session : null;
  }

  function managerEngineerCount(manager) {
    return Math.max(
      1,
      Math.min(12, Math.round(Number(manager?.nodeConfig?.engineerCount) || 1))
    );
  }

  async function ensureManagerEngineers(manager) {
    const count = managerEngineerCount(manager);
    let engineers = store
      .listWorkNodes(manager.id)
      .filter(
        (session) =>
          session.nodeConfig?.engineer === true && !session.archivedAt
      )
      .sort(
        (left, right) =>
          (Number(left.nodeConfig?.engineerIndex) || 0) -
          (Number(right.nodeConfig?.engineerIndex) || 0)
      );
    for (let index = 1; index <= count; index += 1) {
      if (
        engineers.some(
          (session) => Number(session.nodeConfig?.engineerIndex) === index
        )
      ) {
        continue;
      }
      if (typeof createEngineer !== 'function') break;
      try {
        const created = await createEngineer(manager, index);
        if (created?.workNode) engineers.push(created.workNode);
      } catch (engineerError) {
        throw new Error(`create engineer failed: ${engineerError.message}`);
      }
    }
    engineers = engineers
      .filter(
        (session) =>
          Number(session.nodeConfig?.engineerIndex) <= count
      )
      .sort(
        (left, right) =>
          (Number(left.nodeConfig?.engineerIndex) || 0) -
          (Number(right.nodeConfig?.engineerIndex) || 0)
      );
    const engineerAgent = getAgent?.(AGENT_AGENT_ID);
    if (Array.isArray(engineerAgent?.tools)) {
      const nextTools = engineerAgent.tools.map(String);
      for (const engineer of engineers) {
        const current = store.getSession(engineer.id) || engineer;
        const currentTools = Array.isArray(current.nodeConfig?.tools)
          ? current.nodeConfig.tools.map(String)
          : null;
        if (
          !currentTools ||
          currentTools.length !== nextTools.length ||
          currentTools.some((name, index) => name !== nextTools[index])
        ) {
          store.updateSessionNode(engineer.id, {
            nodeConfig: {
              ...(current.nodeConfig || {}),
              tools: nextTools,
            },
          });
        }
      }
    }
    const extras = store
      .listWorkNodes(manager.id)
      .filter(
        (session) =>
          session.nodeConfig?.engineer === true &&
          !session.archivedAt &&
          Number(session.nodeConfig?.engineerIndex) > count &&
          !runner.activeRunForSession?.(session.id)
      );
    for (const extra of extras) {
      if (typeof closeEngineer !== 'function') break;
      try {
        await closeEngineer(manager, extra.id);
      } catch (closeError) {
        console.error('retire engineer failed', closeError);
      }
    }
    return engineers;
  }

  function ensureOrchestrator(manager) {
    const engineerCount = managerEngineerCount(manager);
    let node = findNode(manager.id, 'orchestrator');
    if (!node) {
      node = createNode({
        managerId: manager.id,
        type: 'orchestrator',
        status: 'running',
        title: '调度器',
        payload: {
          roleMap: { ...DEFAULT_ROLE_MAP },
          engineerCount,
          wipLimit: engineerCount,
          retryLimit: 2,
          boardIds: [],
          lastScanAt: 0,
          steps: [
            {
              at: Date.now(),
              message: `调度器已启动，${engineerCount} 个工程师待命`,
            },
          ],
        },
      });
    } else if (
      Number(node.payload?.engineerCount) !== engineerCount ||
      Number(node.payload?.wipLimit) !== engineerCount
    ) {
      node = updateNode(node.id, {
        payload: {
          ...(node.payload || {}),
          engineerCount,
          wipLimit: engineerCount,
        },
      });
    }
    return node;
  }

  function ensureAgileNode(manager) {
    let node = findNode(manager.id, 'agile');
    if (!node) {
      node = createNode({
        managerId: manager.id,
        type: 'agile',
        status: 'running',
        title: 'Agile',
        payload: {
          boardId: null,
          boardLabel: '',
          counts: { total: 0, backlog: 0, progress: 0, blocked: 0, finished: 0 },
          steps: [
            {
              at: Date.now(),
              message: 'Agile 管理 node 已就绪',
            },
          ],
        },
      });
    }
    return node;
  }

  function refreshAgileNode(manager) {
    let node = ensureAgileNode(manager);
    try {
      const agile = getAgileStore(manager.id);
      const snapshot = agile.snapshot();
      const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
      const counts = {
        total: tasks.length,
        backlog: tasks.filter((task) => task.column === 'backlog').length,
        progress: tasks.filter((task) => task.column === 'progress').length,
        blocked: tasks.filter((task) => task.column === 'blocked').length,
        finished: tasks.filter((task) => task.column === 'finished').length,
      };
      const boardId = snapshot.board?.id || null;
      const boardLabel = snapshot.board?.label || '';
      const current = node.payload?.counts || {};
      const same =
        node.payload?.boardId === boardId &&
        node.payload?.boardLabel === boardLabel &&
        current.total === counts.total &&
        current.backlog === counts.backlog &&
        current.progress === counts.progress &&
        current.blocked === counts.blocked &&
        current.finished === counts.finished;
      if (!same) {
        node = updateNode(node.id, {
          status: 'running',
          payload: {
            ...(node.payload || {}),
            boardId,
            boardLabel,
            counts,
          },
        });
      }
    } catch {
      /* Agile node stays with its last snapshot if the store is unavailable */
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
          steps: [
            {
              at: Date.now(),
              message: `Report Hub 已创建：${goal || taskIds.length + ' 个任务'}`,
            },
          ],
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
      const currentIds = Array.isArray(node.payload?.taskIds)
        ? node.payload.taskIds
        : [];
      const same =
        currentIds.length === taskIds.length &&
        currentIds.every((id, index) => id === taskIds[index]);
      if (!same) {
        node = updateNode(node.id, {
          payload: { ...(node.payload || {}), taskIds: [...taskIds] },
        });
      }
    }
    return node;
  }

  function ensureMission(manager, boardId, goal, taskIds = []) {
    let orchestrator = ensureOrchestrator(manager);
    if (orchestrator.status === 'closed') {
      orchestrator = updateNode(orchestrator.id, { status: 'running' });
      orchestrator = appendStep(orchestrator, '调度器已重新启动', {
        kind: 'control',
      });
    }
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
    appendStep(orchestrator, `Mission 已写入 Agile：${goal || boardId}`);
    const agileNode = refreshAgileNode(manager);
    appendStep(agileNode, `Mission 已写入：${goal || boardId}`, {
      kind: 'dispatch',
    });
    const report = ensureReport(manager, boardId, goal, taskIds);
    return { orchestrator, report, agile: agileNode };
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
    const updated = updateNode(node.id, {
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
    if (terminal && node.status !== 'ready') {
      return appendStep(updated, '报告已生成或更新，等待阅读', {
        kind: 'report',
      });
    }
    return updated;
  }

  function markWorkNodeFailed(session, reason) {
    const taskId = session?.nodeConfig?.taskId;
    if (!taskId || !session?.managerId) return;
    try {
      const agile = getAgileStore(session.managerId);
      const task = agile.getTask(taskId);
      if (task.column === 'blocked' || task.column === 'finished') return;
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
      appendStep(report, `任务失败：${task.title}`, {
        kind: 'error',
        taskId: task.id,
      });
      refreshReport(report, task.boardId, report?.payload?.goal || null);
    } catch (error) {
      console.error('mark work node failed', error);
    }
  }

  function submitWorkResult(session, input = {}) {
    if (!session || session.nodeRole !== 'work' || !session.managerId) {
      throw new Error('task_finish can only be called by a work node');
    }
    const agile = getAgileStore(session.managerId);
    const found = findWorkTask(session, agile);
    const taskId = String(input.taskId || found?.id || '').trim();
    if (!taskId) throw new Error('task_finish requires a taskId');
    const task = found?.id === taskId ? found : agile.getTask(taskId);
    if (!task) throw new Error('task not found');
    rememberWorkTask(session, task);
    if (task.column === 'blocked') {
      throw new Error('task is blocked; wait for the orchestrator to resume it');
    }
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
      branches: strings(input.branches, 100),
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
    if (report) {
      appendStep(report, `收到任务结果：${task.title}（${status}）`, {
        kind: 'result',
        taskId: task.id,
      });
      refreshReport(report, task.boardId, report.payload?.goal || null);
    }
    return { ok: true, taskId, status, reportId: report?.id || null };
  }

  function findWorkTask(session, agile) {
    const directId = String(session.nodeConfig?.taskId || '').trim();
    if (directId) {
      try {
        const direct = agile.getTask(directId);
        if (direct && direct.workNodeId === session.id) return direct;
      } catch {
        /* fall through to the workNodeId lookup */
      }
    }
    try {
      const iterations = agile.listRoadmap().iterations || [];
      for (const iteration of iterations) {
        const tasks = agile.snapshot(iteration.id).tasks || [];
        const task = tasks.find(
          (item) =>
            item.workNodeId === session.id &&
            (item.column === 'progress' || item.column === 'blocked')
        );
        if (task) return task;
      }
    } catch {
      /* keep the stored task if the Agile store is unavailable */
    }
    return null;
  }

  function rememberWorkTask(session, task) {
    if (!task) return;
    if (
      session.nodeConfig?.taskId === task.id &&
      session.nodeConfig?.task === task.title
    ) {
      return;
    }
    store.updateSessionNode(session.id, {
      nodeConfig: {
        ...(session.nodeConfig || {}),
        task: task.title,
        taskId: task.id,
        reportId: task.reportId || session.nodeConfig?.reportId || null,
      },
    });
  }

  function workTaskFor(session, input = {}) {
    if (!session || session.nodeRole !== 'work' || !session.managerId) {
      throw new Error('task_block can only be called by a work node');
    }
    const agile = getAgileStore(session.managerId);
    const task = findWorkTask(session, agile);
    const taskId = String(input.taskId || task?.id || '').trim();
    if (!taskId) throw new Error('task_block requires a taskId');
    const freshTask = task?.id === taskId ? task : agile.getTask(taskId);
    if (!freshTask) throw new Error('task not found');
    if (freshTask.column === 'finished') {
      throw new Error('task is already finished');
    }
    if (freshTask.column === 'blocked') {
      throw new Error('task is already blocked');
    }
    if (freshTask.workNodeId && freshTask.workNodeId !== session.id) {
      throw new Error('task is assigned to another worker');
    }
    rememberWorkTask(session, freshTask);
    return { agile, task: freshTask, taskId };
  }

  function blockedOutcomeFromNode(node) {
    if (node.type === 'approval') {
      return {
        kind: 'approval',
        approved: node.status === 'approved',
        reason:
          String(node.payload?.decision || '') ||
          (node.status === 'approved' ? 'approved' : 'denied'),
      };
    }
    return {
      kind: 'question',
      answers: Array.isArray(node.payload?.answers)
        ? node.payload.answers
        : [],
      cancelled: node.status === 'dismissed',
      timedOut: node.status === 'expired',
    };
  }

  function resumePrompt(task, node, outcome) {
    const lines = [
      '[Task resumed]',
      `Task: ${task.title}`,
      task.acceptance ? `Acceptance: ${task.acceptance}` : '',
    ];
    if (outcome.kind === 'approval') {
      lines.push(
        outcome.approved ? 'Approval: approved' : 'Approval: denied',
        outcome.reason ? `Reason: ${outcome.reason}` : '',
        'Continue the task. If you still need approval or an answer, call task_block again. When done, call task_finish.'
      );
    } else {
      if (outcome.timedOut) {
        lines.push(
          'Questionnaire: no answer before the timer expired.',
          'Continue with your best judgment. When done, call task_finish.'
        );
      } else if (outcome.cancelled) {
        lines.push(
          'Questionnaire: dismissed without an answer.',
          'Continue with your best judgment. When done, call task_finish.'
        );
      } else {
        const questions = Array.isArray(node.payload?.questions)
          ? node.payload.questions
          : [];
        lines.push('Questionnaire answers:');
        questions.forEach((question, index) => {
          const values = Array.isArray(outcome.answers?.[index])
            ? outcome.answers[index].map(String).filter(Boolean)
            : [];
          lines.push(
            `- ${question.question || `Question ${index + 1}`}: ${
              values.length ? values.join(', ') : 'Unanswered'
            }`
          );
        });
        lines.push(
          'Continue the task with these answers. If you still need input, call task_block again. When done, call task_finish.'
        );
      }
    }
    return lines.filter(Boolean).join('\n');
  }

  function resumeBlockedTask(node, outcome = null) {
    const current = store.getSystemNode(node?.id);
    if (!current || !current.taskId) return { resumed: false };
    const manager = managerSession(current.managerId);
    if (!manager) return { resumed: false };
    const agile = getAgileStore(manager.id);
    const task = agile.getTask(current.taskId);
    if (!task || task.column !== 'blocked') return { resumed: false };
    if (task.blockedNodeId && task.blockedNodeId !== current.id) {
      return { resumed: false };
    }
    const worker = task.workNodeId
      ? store.getSession(task.workNodeId)
      : current.sessionId
        ? store.getSession(current.sessionId)
        : null;
    const orchestrator = findNode(manager.id, 'orchestrator');
    const report = reportNodeForTask({ ...task, managerId: manager.id });
    const resolvedOutcome = outcome || blockedOutcomeFromNode(current);
    if (!worker || worker.archivedAt) {
      const releaseActor = {
        type: 'agent',
        id: task.claimedBy || manager.id,
      };
      agile.moveTask(task.id, 'backlog', {
        actor: releaseActor,
      });
      agile.releaseTask(task.id, releaseActor);
      agile.updateTask(task.id, {
        workNodeId: '',
        blockedReason: '',
        blockedBy: '',
        blockedKind: '',
        blockedNodeId: '',
        actor: releaseActor,
      });
      appendStep(orchestrator, `解除阻塞：${task.title} → Backlog（原工程师不可用）`, {
        kind: 'unblock',
        taskId: task.id,
      });
      if (report) refreshReport(report, task.boardId, report.payload?.goal || null);
      return { resumed: false, requeued: true, taskId: task.id };
    }
    const workerActor = { type: 'agent', id: task.claimedBy || worker.id };
    const agent = getAgent?.(AGENT_AGENT_ID);
    if (!agent || agent.kind !== 'agent') {
      throw new Error('project coordinator Agent profile not found');
    }
    agile.moveTask(task.id, 'progress', { actor: workerActor });
    const runId = crypto.randomUUID();
    watchWorkNode(worker, report?.id || null);
    try {
      runner.startRun({
        sessionId: worker.id,
        text: resumePrompt(task, current, resolvedOutcome),
        runId,
        agentConfig: agent,
        reasoningEffort: store.loadSettings().reasoningEffort,
      });
    } catch (runError) {
      agile.moveTask(task.id, 'backlog', { actor: workerActor });
      agile.releaseTask(task.id, workerActor);
      agile.updateTask(task.id, {
        workNodeId: '',
        blockedReason: '',
        blockedBy: '',
        blockedKind: '',
        blockedNodeId: '',
        actor: workerActor,
      });
      appendStep(
        orchestrator,
        `恢复失败，任务回到 Backlog：${task.title}`,
        { kind: 'error', taskId: task.id }
      );
      return { resumed: false, requeued: true, error: runError.message };
    }
    appendStep(
      orchestrator,
      `解除阻塞：${task.title} → ${worker.title || worker.id}`,
      { kind: 'unblock', taskId: task.id }
    );
    if (report) {
      appendStep(report, `任务恢复：${task.title}`, {
        kind: 'unblock',
        taskId: task.id,
      });
      refreshReport(report, task.boardId, report.payload?.goal || null);
    }
    return {
      resumed: true,
      taskId: task.id,
      workerId: worker.id,
      runId,
    };
  }

  function blockTask(session, input = {}) {
    const kind = String(input.kind || '').trim().toLowerCase();
    if (kind !== 'approval' && kind !== 'question') {
      throw new Error('task_block requires kind "approval" or "question"');
    }
    const reason = text(input.reason || '', 2000);
    if (!reason) throw new Error('task_block requires a reason');
    const { agile, task, taskId } = workTaskFor(session, input);
    const manager = managerSession(session.managerId);
    if (!manager) throw new Error('manager not found');
    const blockedBy = {
      sessionId: session.id,
      title: session.title || 'worker',
    };
    let node;
    if (kind === 'approval') {
      const action = text(input.action || input.tool || 'approval', 120);
      node = createNode({
        managerId: manager.id,
        type: 'approval',
        status: 'pending',
        title: `审批 · ${action}`,
        taskId,
        sessionId: session.id,
        payload: {
          approvalId: `block-${crypto.randomUUID()}`,
          tool: action,
          path: text(input.path || '', 500),
          reason,
          blockedBy,
          blockedTask: true,
          sourceTitle: session.title || '',
          requestedAt: Date.now(),
          steps: [
            {
              at: Date.now(),
              message: `${blockedBy.title} 因任务阻塞发起审批：${reason}`,
            },
          ],
        },
      });
    } else {
      const questions = normalizeQuestions({ questions: input.questions });
      const mode = input.mode === 'timed' ? 'timed' : 'blocking';
      const timeoutSeconds =
        mode === 'timed'
          ? Math.max(
              5,
              Math.min(600, Math.round(Number(input.timeoutSeconds) || 60))
            )
          : 0;
      node = createNode({
        managerId: manager.id,
        type: 'questionnaire',
        status: 'pending',
        title: '问卷',
        taskId,
        sessionId: session.id,
        payload: {
          questionId: `block-${crypto.randomUUID()}`,
          questions,
          mode,
          timeoutSeconds,
          reason,
          blockedBy,
          blockedTask: true,
          sourceTitle: session.title || '',
          requestedAt: Date.now(),
          steps: [
            {
              at: Date.now(),
              message: `${blockedBy.title} 因任务阻塞发起问卷：${reason}`,
            },
          ],
        },
      });
      if (mode === 'timed' && timeoutSeconds > 0) {
        const timeout = setTimeout(() => {
          questionTimers.delete(node.id);
          const current = store.getSystemNode(node.id);
          if (current?.status !== 'pending') return;
          const updated = updateNode(node.id, { status: 'expired' });
          try {
            resumeBlockedTask(updated, blockedOutcomeFromNode(updated));
          } catch (resumeError) {
            console.error('resume expired blocked task failed', resumeError);
          }
        }, (timeoutSeconds + 3) * 1000);
        timeout.unref?.();
        questionTimers.set(node.id, timeout);
      }
    }
    const workerActor = { type: 'agent', id: task.claimedBy || session.id };
    try {
      agile.moveTask(taskId, 'blocked', { actor: workerActor });
      agile.updateTask(taskId, {
        blockedReason: reason,
        blockedBy: session.id,
        blockedKind: kind,
        blockedNodeId: node.id,
        actor: workerActor,
      });
    } catch (blockError) {
      try {
        updateNode(node.id, { status: 'expired' });
      } catch {
        /* ignore cleanup failure */
      }
      throw blockError;
    }
    const orchestrator = findNode(manager.id, 'orchestrator');
    appendStep(
      orchestrator,
      `任务阻塞：${task.title} → ${kind === 'approval' ? '审批' : '问卷'}（${blockedBy.title}）`,
      { kind: 'blocked', taskId }
    );
    const report = reportNodeForTask({ ...task, managerId: manager.id });
    if (report) {
      appendStep(report, `任务阻塞：${task.title}（${blockedBy.title}）`, {
        kind: 'blocked',
        taskId,
      });
      refreshReport(report, task.boardId, report.payload?.goal || null);
    }
    return {
      ok: true,
      taskId,
      nodeId: node.id,
      kind,
      status: 'blocked',
      blockedBy: blockedBy.title,
    };
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
        blockedBy: {
          sessionId: session.id,
          title: session.title || 'worker',
        },
        requestedAt: Date.now(),
        sourceTitle: session.title || '',
        steps: [
          {
            at: Date.now(),
            message: `请求审批：${String(payload.tool || 'action')}${
              payload.path ? ` · ${payload.path}` : ''
            }`,
          },
        ],
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
        blockedBy: {
          sessionId: session.id,
          title: session.title || 'worker',
        },
        requestedAt: Date.now(),
        sourceTitle: session.title || '',
        steps: [
          {
            at: Date.now(),
            message: `已发送 ${Array.isArray(payload.questions) ? payload.questions.length : 0} 个问题`,
          },
        ],
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
      const updated = store.getSystemNode(node.id);
      appendStep(
        updated,
        payload.approved === true ? '审批已通过' : '审批已拒绝',
        { kind: 'decision' }
      );
      if (updated?.payload?.blockedTask) {
        try {
          resumeBlockedTask(updated, {
            kind: 'approval',
            approved: payload.approved === true,
            reason: String(payload.reason || ''),
          });
        } catch (resumeError) {
          console.error('resume approved task failed', resumeError);
        }
      }
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
      const updated = store.getSystemNode(node.id);
      appendStep(
        updated,
        payload.cancelled === true
          ? '问卷已关闭'
          : payload.timedOut === true
            ? '问卷已过期'
            : '问卷已回答',
        { kind: 'decision' }
      );
      if (updated?.payload?.blockedTask) {
        try {
          resumeBlockedTask(updated, {
            kind: 'question',
            answers: Array.isArray(payload.answers) ? payload.answers : [],
            cancelled: payload.cancelled === true,
            timedOut: payload.timedOut === true,
          });
        } catch (resumeError) {
          console.error('resume answered task failed', resumeError);
        }
      }
    }
  }

  function watchWorkNode(session, reportId = null) {
    if (!session?.id || watched.has(session.id)) return;
    const unsubscribe = runner.subscribe(session.id, (event) => {
      if (!event) return;
      const current = store.getSession(session.id) || session;
      if (event.type === 'tool.approval') {
        createApprovalNode(current, event.payload);
      } else if (event.type === 'tool.question') {
        createQuestionNode(current, event.payload);
      } else if (event.type === 'tool.approval.resolved') {
        updateApprovalNode(event.payload);
      } else if (event.type === 'tool.question.resolved') {
        updateQuestionNode(event.payload);
      } else if (event.type === 'run.done') {
        const taskId = current.nodeConfig?.taskId;
        const summary = String(event.payload?.text || '').trim();
        if (taskId && summary) {
          try {
            const agile = getAgileStore(current.managerId);
            const task = agile.getTask(taskId);
            if (task.column === 'blocked' || task.column === 'finished') return;
            submitWorkResult(current, {
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
        markWorkNodeFailed(current, event.payload?.error || 'run failed');
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
    for (const boardId of boardIds) {
      let tasks;
      try {
        tasks = agile.listTasks(boardId);
      } catch {
        continue;
      }
      if (tasks.length === 0) continue;
      for (const task of tasks) {
        if (task.column !== 'blocked' || !task.blockedNodeId) continue;
        const node = store.getSystemNode(task.blockedNodeId);
        if (!node) continue;
        if (
          !['approved', 'denied', 'answered', 'dismissed', 'expired'].includes(
            node.status
          )
        ) {
          continue;
        }
        try {
          resumeBlockedTask(node, blockedOutcomeFromNode(node));
        } catch (resumeError) {
          console.error('resume blocked task from tick failed', resumeError);
        }
      }
      const now = Date.now();
      if (now - (Number(payload.lastScanAt) || 0) >= 10000) {
        const counts = {
          backlog: tasks.filter((task) => task.column === 'backlog').length,
          progress: tasks.filter((task) => task.column === 'progress').length,
          blocked: tasks.filter((task) => task.column === 'blocked').length,
          finished: tasks.filter((task) => task.column === 'finished').length,
        };
        const goal = payload.goals?.[boardId] || boardId;
        const updated = appendStep(
          orchestrator,
          `扫描 ${goal}：Backlog ${counts.backlog} · 进行 ${counts.progress} · 阻塞 ${counts.blocked} · 完成 ${counts.finished}`,
          { kind: 'scan' }
        );
        updateNode(updated.id, {
          payload: { ...(updated.payload || {}), lastScanAt: now },
        });
        payload.lastScanAt = now;
      }
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
      );
      const engineers = await ensureManagerEngineers(manager);
      if (engineers.length === 0) {
        appendStep(orchestrator, '没有可用的工程师 node', {
          kind: 'error',
        });
        continue;
      }
      const idleEngineers = engineers.filter(
        (engineer) => !runner.activeRunForSession?.(engineer.id)
      );
      let engineerIndex = 0;
      for (const task of eligible) {
        if (engineerIndex >= idleEngineers.length) {
          appendStep(
            orchestrator,
            `${idleEngineers.length} 个工程师都在忙，等待空闲`,
            { kind: 'scan' }
          );
          break;
        }
        const engineer = idleEngineers[engineerIndex];
        try {
          agile.claimTask(task.id, engineer.id);
          agile.moveTask(task.id, 'progress', {
            actor: { type: 'agent', id: engineer.id },
          });
          const role = String(task.role || 'general');
          const roleName = roleMap[role] || role || '通用';
          const agent = getAgent?.(AGENT_AGENT_ID);
          if (!agent || agent.kind !== 'agent') {
            throw new Error('project coordinator Agent profile not found');
          }
          const engineerBaseTitle = String(
            engineer.title || `工程师 ${engineerIndex + 1}`
          ).split(' · ')[0];
          store.updateSessionNode(engineer.id, {
            title: `${engineerBaseTitle} · ${task.title}`.slice(0, 120),
            nodeConfig: {
              ...(engineer.nodeConfig || {}),
              task: task.title,
              taskId: task.id,
              reportId: report.id,
            },
          });
          notify?.({ managerId: manager.id, nodeId: engineer.id });
          const currentEngineer = store.getSession(engineer.id);
          watchWorkNode(currentEngineer, report.id);
          runner.startRun({
            sessionId: engineer.id,
            text: taskPrompt(
              task,
              report?.payload?.goal || 'Mission',
              roleName
            ),
            runId: crypto.randomUUID(),
            agentConfig: agent,
            reasoningEffort: store.loadSettings().reasoningEffort,
          });
          agile.updateTask(task.id, {
            workNodeId: engineer.id,
            reportId: report.id,
            attempts: (Number(task.attempts) || 0) + 1,
            actor: { type: 'agent', id: engineer.id },
          });
          engineerIndex += 1;
          appendStep(
            orchestrator,
            `派活：${task.title} → ${engineerBaseTitle} → ${roleName}`,
            { kind: 'dispatch', taskId: task.id }
          );
        } catch (error) {
          const failureActor = {
            type: 'agent',
            id: task.claimedBy || orchestrator.id,
          };
          try {
            agile.moveTask(task.id, 'blocked', {
              actor: failureActor,
            });
            agile.setBlockedReason(
              task.id,
              `调度失败: ${error.message}`,
              failureActor
            );
          } catch {
            /* ignore failure recovery */
          }
          appendStep(
            orchestrator,
            `任务阻塞：${task.title} · ${error.message}`,
            { kind: 'error', taskId: task.id }
          );
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
        refreshAgileNode(manager);
        const orchestrator = ensureOrchestrator(manager);
        try {
          await ensureManagerEngineers(manager);
        } catch (engineerError) {
          console.error('ensure engineers failed', engineerError);
          appendStep(
            orchestrator,
            `工程师 node 创建失败：${engineerError.message}`,
            { kind: 'error' }
          );
        }
        if (!orchestrator || orchestrator.status !== 'running') continue;
        try {
          await tickManager(manager, orchestrator);
          refreshAgileNode(manager);
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
        const updated = updateNode(node.id, {
          status: 'read',
          payload: { ...(node.payload || {}), readAt: Date.now() },
        });
        return appendStep(updated, '报告已阅读', { kind: 'read' });
      }
      if (name === 'archive') {
        const updated = updateNode(node.id, { status: 'archived' });
        return appendStep(updated, '报告已归档', { kind: 'archive' });
      }
      if (name === 'delete' || name === 'remove') {
        const manager = managerSession(node.managerId);
        if (manager) {
          try {
            const agile = getAgileStore(manager.id);
            const tasks = agile.listTasks(node.missionId || null);
            for (const task of tasks) {
              if (task.reportId !== node.id) continue;
              agile.updateTask(task.id, {
                reportId: '',
                actor: { type: 'human', id: null },
              });
            }
          } catch (error) {
            console.error('detach deleted report from tasks failed', error);
          }
        }
        try {
          const state = canvasStore?.state();
          if (state?.nodes?.[node.id]) {
            delete state.nodes[node.id];
            canvasStore.save(state);
          }
        } catch (error) {
          console.error('remove deleted report canvas node failed', error);
        }
        const deleted = store.deleteSystemNode(node.id);
        publish(node.managerId, node.id);
        return { ok: true, deleted, id: node.id, type: node.type };
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
      const blockedTask = node.payload?.blockedTask === true;
      const ok = blockedTask
        ? true
        : runner.resolveApproval(node.payload?.approvalId, approved);
      const updated = updateNode(node.id, {
        status: ok ? (approved ? 'approved' : 'denied') : 'expired',
        payload: {
          ...(node.payload || {}),
          decidedAt: Date.now(),
          decision: ok ? (approved ? 'approved' : 'denied') : 'not pending',
        },
      });
      if (blockedTask) {
        try {
          resumeBlockedTask(updated, {
            kind: 'approval',
            approved,
            reason: approved ? 'approved' : 'denied',
          });
        } catch (resumeError) {
          console.error('resume blocked approval failed', resumeError);
        }
      }
      return updated;
    }
    if (node.type === 'questionnaire') {
      if (name === 'answer' || name === 'dismiss') {
        const answers = name === 'dismiss' ? [] : input.answers;
        const blockedTask = node.payload?.blockedTask === true;
        const ok = blockedTask
          ? true
          : runner.resolveQuestions(node.payload?.questionId, {
              answers: Array.isArray(answers) ? answers : [],
              cancelled: name === 'dismiss',
            });
        const updated = updateNode(node.id, {
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
        if (blockedTask) {
          try {
            resumeBlockedTask(updated, {
              kind: 'question',
              answers: Array.isArray(answers) ? answers : [],
              cancelled: name === 'dismiss',
              timedOut: false,
            });
          } catch (resumeError) {
            console.error('resume blocked question failed', resumeError);
          }
        }
        return updated;
      }
      throw new Error(`unknown questionnaire action: ${name}`);
    }
    if (node.type === 'orchestrator') {
      if (name === 'pause' || name === 'resume') {
        const updated = updateNode(node.id, {
          status: name === 'pause' ? 'paused' : 'running',
        });
        return appendStep(
          updated,
          name === 'pause' ? '调度器已暂停' : '调度器已恢复',
          { kind: 'control' }
        );
      }
      if (name === 'close') {
        const updated = updateNode(node.id, { status: 'closed' });
        return appendStep(updated, '调度器已关闭', { kind: 'control' });
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
    blockTask,
    resumeBlockedTask,
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
