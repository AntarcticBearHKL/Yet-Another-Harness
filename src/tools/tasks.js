'use strict';

const store = require('../store');

let providers = {
  getAgileStore: null,
  systemNodeService: null,
  mergeTaskBranches: null,
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

function isLeadEngineer(session) {
  return (
    session?.nodeRole === 'work' &&
    Number(session.nodeConfig?.engineerIndex) === 1
  );
}

function planningFor(context) {
  const session = workSessionFor(context);
  if (!session) {
    const manager = managerFor(context);
    return manager ? { manager, lead: null } : null;
  }
  if (!isLeadEngineer(session) || !session.managerId) return null;
  const manager = store.getSession(session.managerId);
  if (!manager || manager.nodeRole !== 'manager') return null;
  return { manager, lead: session };
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
        testPlan: text(item.testPlan),
        dependsOn: Array.isArray(item.dependsOn)
          ? [...new Set(item.dependsOn.map((id) => text(id)).filter(Boolean))].slice(
              0,
              50
            )
          : [],
      };
    })
    .filter(Boolean);
}

function normalizeStringList(raw, limit = 40) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
}

function taskView(task) {
  const branches = (list) =>
    Array.isArray(list)
      ? list.map((branch) => ({
          repo: branch.repo,
          branch: branch.branch,
          baseBranch: branch.baseBranch || '',
          worktree: branch.worktree || '',
        }))
      : [];
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    role: task.role,
    acceptance: task.acceptance,
    testPlan: task.testPlan || '',
    dependsOn: Array.isArray(task.dependsOn) ? [...task.dependsOn] : [],
    column: task.column,
    designId: task.designId || null,
    designState: task.designState || null,
    reviewState: task.reviewState || null,
    reviewNote: task.reviewNote || null,
    assignee: task.assignee || null,
    workNodeId: task.workNodeId || null,
    branches: branches(task.gitBranches),
    testBranches: branches(task.testBranches),
    testVerdict: task.testVerdict || null,
    testReport: task.testReport || null,
    testState: task.testState || null,
    testedBy: task.testedBy || null,
    testedAt: task.testedAt || null,
    testAttempts: Number(task.testAttempts) || 0,
    blockedReason: task.blockedReason || null,
    blockedBy: task.blockedBy || null,
    blockedKind: task.blockedKind || null,
    result: task.result
      ? {
          status: task.result.status || null,
          summary: task.result.summary || '',
          branches: Array.isArray(task.result.branches)
            ? task.result.branches
            : [],
        }
      : null,
  };
}

function iterationIdFor(agile, wanted = '') {
  const direct = text(wanted);
  if (direct) return direct;
  try {
    const iterations = agile.listRoadmap().iterations || [];
    return (
      iterations.find((iteration) => iteration.isActive)?.id ||
      iterations.at(-1)?.id ||
      ''
    );
  } catch {
    return '';
  }
}

function designMarkdown(args = {}) {
  const sections = [];
  const intro = text(args.description || args.spec);
  if (intro) sections.push(intro);
  const goal = text(args.goal);
  if (goal) sections.push(`## 目标\n${goal}`);
  const scope = text(args.scope);
  if (scope) sections.push(`## 范围\n${scope}`);
  const requirements = normalizeStringList(args.requirements, 60);
  if (requirements.length > 0) {
    sections.push(`## 需求\n${requirements.map((item) => `- ${item}`).join('\n')}`);
  }
  const constraints = normalizeStringList(args.constraints, 40);
  if (constraints.length > 0) {
    sections.push(`## 约束\n${constraints.map((item) => `- ${item}`).join('\n')}`);
  }
  const outOfScope = normalizeStringList(args.outOfScope, 40);
  if (outOfScope.length > 0) {
    sections.push(
      `## 非目标\n${outOfScope.map((item) => `- ${item}`).join('\n')}`
    );
  }
  const answers = normalizeStringList(args.answers, 40);
  if (answers.length > 0) {
    sections.push(
      `## 用户确认\n${answers.map((item) => `- ${item}`).join('\n')}`
    );
  }
  const openQuestions = normalizeStringList(args.openQuestions, 40);
  if (openQuestions.length > 0) {
    sections.push(
      `## 待确认问题\n${openQuestions.map((item) => `- ${item}`).join('\n')}`
    );
  }
  return sections.join('\n\n').slice(0, 20000);
}

function sectionText(markdown, heading) {
  const text = String(markdown || '');
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const after = start + marker.length;
  const next = text.indexOf('\n## ', after);
  return text.slice(after, next < 0 ? text.length : next).trim();
}

function replaceSection(markdown, heading, body) {
  const text = String(markdown || '').trimEnd();
  const block = `## ${heading}\n\n${String(body || '').trim()}`;
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return text ? `${text}\n\n${block}` : block;
  const after = start + marker.length;
  const next = text.indexOf('\n## ', after);
  const before = text.slice(0, start).trimEnd();
  const rest = next < 0 ? '' : text.slice(next).trimStart();
  return [before, block, rest].filter(Boolean).join('\n\n');
}

function architectureMarkdown(args = {}) {
  const sections = [];
  const summary = text(args.summary || args.description);
  if (summary) sections.push(`### 方案概述\n${summary}`);
  const list = (heading, items, limit = 40) => {
    const values = normalizeStringList(items, limit);
    if (values.length > 0) {
      sections.push(`### ${heading}\n${values.map((item) => `- ${item}`).join('\n')}`);
    }
  };
  list('模块与职责', args.modules);
  list('接口与调用流程', args.interfaces);
  list('数据与存储', args.data);
  list('安全与权限', args.security);
  list('性能与扩展', args.performance);
  list('测试策略', args.testStrategy);
  list('风险与回滚', args.risks);
  list('备选方案', args.alternatives);
  return sections.join('\n\n').slice(0, 16000);
}

async function designWrite(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('design_write can only be called by a product manager node');
  let agile;
  try {
    agile = agileFor(manager);
  } catch (designError) {
    return error(designError.message);
  }
  let iterationId = iterationIdFor(agile, args.iterationId || args.boardId);
  if (!iterationId) {
    try {
      iterationId = agile.createBoard().id;
    } catch (createError) {
      return error(`failed to create iteration: ${createError.message}`);
    }
  }
  const title = text(args.title) || text(args.goal) || '需求清单';
  const markdown = designMarkdown(args);
  if (!markdown) {
    return error('design_write requires a goal, description or requirements');
  }
  const acceptance = text(args.acceptance);
  let design;
  try {
    const existingId = text(args.designId);
    if (existingId) {
      const current = agile.getTask(existingId);
      if (current.kind !== 'design') {
        return error('designId does not point to a design task');
      }
      const technical = sectionText(current.description, '技术方案');
      const description = technical
        ? replaceSection(markdown, '技术方案', technical)
        : markdown;
      design = agile.updateTask(existingId, {
        title,
        description,
        acceptance,
        designState: 'pending',
        workNodeId: '',
        claimedBy: '',
        blockedReason: '',
        blockedBy: '',
        blockedKind: '',
        blockedNodeId: '',
        actor: { type: 'agent', id: manager.id },
      });
    } else {
      design = agile.createTask({
        boardId: iterationId,
        column: 'design',
        kind: 'design',
        designState: 'pending',
        title,
        description: markdown,
        acceptance,
        role: 'lead',
        autoDispatch: true,
        actor: { type: 'agent', id: manager.id },
      });
    }
  } catch (designError) {
    return error(`failed to write design: ${designError.message}`);
  }
  let mission = null;
  try {
    mission = providers.systemNodeService?.ensureMission(
      manager,
      iterationId,
      text(args.goal) || title,
      [design.id]
    );
  } catch (missionError) {
    console.error('design mission setup failed', missionError);
  }
  try {
    await providers.systemNodeService?.tick?.();
  } catch (tickError) {
    console.error('design dispatch tick failed', tickError);
  }
  return JSON.stringify(
    {
      ok: true,
      managerId: manager.id,
      iterationId,
      design: taskView(design),
      orchestratorId: mission?.orchestrator?.id || null,
      reportId: mission?.report?.id || null,
    },
    null,
    2
  );
}

function architectureWrite(args = {}, context = null) {
  const planner = planningFor(context || args.context);
  if (!planner?.lead) {
    return error('architecture_write can only be called by the architect');
  }
  const { manager, lead } = planner;
  let agile;
  try {
    agile = agileFor(manager);
  } catch (architectureError) {
    return error(architectureError.message);
  }
  const designId =
    text(args.designId) || text(lead?.nodeConfig?.taskId);
  if (!designId) return error('architecture_write requires a design task');
  let design;
  try {
    design = agile.getTask(designId);
  } catch {
    return error('design task not found');
  }
  if (design.kind !== 'design') {
    return error('architecture_write requires a design task');
  }
  const body = architectureMarkdown(args);
  if (!body) return error('architecture_write requires a summary');
  try {
    const description = replaceSection(
      design.description,
      '技术方案',
      body
    );
    const updated = agile.updateTask(design.id, {
      description,
      designState: 'working',
      actor: { type: 'agent', id: lead.id },
    });
    return JSON.stringify(
      {
        ok: true,
        designId: updated.id,
        title: updated.title,
        architecture: body,
      },
      null,
      2
    );
  } catch (architectureError) {
    return error(`failed to write architecture: ${architectureError.message}`);
  }
}

function backlogList(args = {}, context = null) {
  const planner = planningFor(context || args.context);
  if (!planner) {
    return error('backlog_list can only be called by the product manager or architect');
  }
  const { manager } = planner;
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
      leadId: planner.lead?.id || null,
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
  if (!manager) return error('only a product manager node can add an iteration');
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
  const planner = planningFor(context || args.context);
  if (!planner?.lead) {
    return error('backlog_add can only be called by the architect');
  }
  const { manager, lead } = planner;
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
  const designId = text(args.designId) || text(lead?.nodeConfig?.taskId);
  let design = null;
  if (designId) {
    try {
      design = agile.getTask(designId);
      if (design.kind !== 'design') design = null;
    } catch {
      design = null;
    }
  }
  let iterationId = text(
    args.iterationId || args.boardId || design?.boardId
  );
  if (!iterationId) {
    iterationId = iterationIdFor(agile);
  }
  if (!iterationId) {
    try {
      iterationId = agile.createBoard().id;
    } catch (createError) {
      return error(`failed to create iteration: ${createError.message}`);
    }
  }
  const actor = {
    type: 'agent',
    id: lead?.id || manager.id,
  };
  const created = [];
  try {
    for (const item of items) {
      created.push(
        agile.createTask({
          boardId: iterationId,
          column: 'backlog',
          kind: 'task',
          designId: design?.id || '',
          title: item.title,
          description: item.description,
          role: item.role,
          acceptance: item.acceptance,
          testPlan: item.testPlan,
          dependsOn: item.dependsOn,
          autoDispatch: true,
          actor,
        })
      );
    }
  } catch (createError) {
    return error(`failed to create backlog tasks: ${createError.message}`);
  }
  if (design) {
    try {
      agile.updateTask(design.id, {
        designState: 'working',
        actor,
      });
    } catch (designError) {
      console.error('design task update failed', designError);
    }
  }
  const goal = text(args.goal) || design?.title || 'Mission';
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
      leadId: lead?.id || null,
      designId: design?.id || null,
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

async function taskMerge(args = {}, context = null) {
  const lead = workSessionFor(context || args.context);
  if (!isLeadEngineer(lead)) {
    return error('task_merge can only be called by the architect');
  }
  if (typeof providers.mergeTaskBranches !== 'function') {
    return error('git merge service is not configured');
  }
  const manager = store.getSession(lead.managerId);
  if (!manager || manager.nodeRole !== 'manager') {
    return error('product manager not found');
  }
  let agile;
  try {
    agile = agileFor(manager);
  } catch (mergeError) {
    return error(mergeError.message);
  }
  const taskId = text(args.taskId);
  if (!taskId) return error('task_merge requires a taskId');
  let task;
  try {
    task = agile.getTask(taskId);
  } catch {
    return error('task not found');
  }
  if (task.kind === 'design') {
    return error('design tasks are not merged');
  }
  if (task.column !== 'verified') {
    return error('task_merge requires a task in Verified');
  }
  if (task.testVerdict !== 'pass') {
    return error('task_merge requires a passed test report');
  }
  const branches = [
    ...(Array.isArray(task.gitBranches) ? task.gitBranches : []),
    ...(Array.isArray(task.testBranches) ? task.testBranches : []),
  ].filter(
    (branch, index, list) =>
      branch &&
      branch.branch &&
      list.findIndex(
        (item) => item.branch === branch.branch && item.repo === branch.repo
      ) === index
  );
  if (branches.length === 0) {
    return error('task has no Git branches to merge');
  }
  let merged;
  try {
    merged = await providers.mergeTaskBranches(branches, {
      message: `merge: ${task.title}${
        text(args.summary) ? ` - ${text(args.summary).slice(0, 120)}` : ''
      }`,
    });
  } catch (mergeError) {
    return error(`git merge failed: ${mergeError.message}`);
  }
  if (!merged?.ok) {
    const reason = (merged?.errors || [])
      .map((item) => item.message || item)
      .filter(Boolean)
      .join('; ');
    return error(`git merge failed: ${reason || 'unknown error'}`);
  }
  const actor = { type: 'agent', id: lead.id };
  let updated;
  try {
    agile.moveTask(task.id, 'merged', { actor });
    updated = agile.updateTask(task.id, {
      mergedBy: lead.id,
      reviewLeadId: lead.id,
      reviewStartedAt: null,
      reviewState: 'merged',
      reviewNote: '',
      actor,
    });
  } catch (moveError) {
    return error(`failed to mark task merged: ${moveError.message}`);
  }
  try {
    providers.systemNodeService?.refreshReportForBoard?.(
      manager.id,
      task.boardId,
      null
    );
    await providers.systemNodeService?.tick?.();
  } catch (tickError) {
    console.error('merge dispatch tick failed', tickError);
  }
  return JSON.stringify(
    {
      ok: true,
      task: taskView(updated),
      merged: merged.results,
    },
    null,
    2
  );
}

function taskReject(args = {}, context = null) {
  const lead = workSessionFor(context || args.context);
  if (!isLeadEngineer(lead)) {
    return error('task_reject can only be called by the architect');
  }
  const manager = store.getSession(lead.managerId);
  if (!manager || manager.nodeRole !== 'manager') {
    return error('product manager not found');
  }
  let agile;
  try {
    agile = agileFor(manager);
  } catch (rejectError) {
    return error(rejectError.message);
  }
  const taskId = text(args.taskId);
  if (!taskId) return error('task_reject requires a taskId');
  const reason = text(args.reason);
  if (!reason) return error('task_reject requires a reason');
  let task;
  try {
    task = agile.getTask(taskId);
  } catch {
    return error('task not found');
  }
  if (task.column !== 'verified') {
    return error('task_reject requires a task in Verified');
  }
  const actor = { type: 'agent', id: lead.id };
  try {
    agile.moveTask(task.id, 'backlog', { actor });
    agile.updateTask(task.id, {
      reviewState: null,
      reviewLeadId: '',
      reviewStartedAt: null,
      reviewNote: reason,
      isRework: true,
      testState: 'rework',
      actor,
    });
  } catch (rejectError) {
    return error(`failed to reject task: ${rejectError.message}`);
  }
  try {
    providers.systemNodeService?.refreshReportForBoard?.(
      manager.id,
      task.boardId,
      null
    );
    providers.systemNodeService?.tick?.();
  } catch (tickError) {
    console.error('reject dispatch tick failed', tickError);
  }
  return JSON.stringify(
    {
      ok: true,
      taskId: task.id,
      column: 'backlog',
      reason,
    },
    null,
    2
  );
}

function testReport(args = {}, context = null) {
  const session = workSessionFor(context || args.context);
  if (!session) return error('test_report can only be called by a work node');
  const verdict = text(args.verdict).toLowerCase();
  if (verdict !== 'pass' && verdict !== 'fail') {
    return error('test_report verdict must be pass or fail');
  }
  if (!text(args.summary)) {
    return error('test_report requires a summary');
  }
  if (!providers.systemNodeService?.submitTestResult) {
    return error('system node service is not configured');
  }
  try {
    const result = providers.systemNodeService.submitTestResult(session, {
      ...args,
      verdict,
    });
    return JSON.stringify(result, null, 2);
  } catch (testError) {
    return error(testError.message);
  }
}

function reportWrite(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('report_write can only be called by a product manager node');
  if (!text(args.summary)) {
    return error('report_write requires a summary');
  }
  if (!providers.systemNodeService?.writeHumanReport) {
    return error('system node service is not configured');
  }
  try {
    const result = providers.systemNodeService.writeHumanReport(manager, args);
    return JSON.stringify(result, null, 2);
  } catch (reportError) {
    return error(reportError.message);
  }
}

module.exports = {
  configure,
  designWrite,
  architectureWrite,
  backlogList,
  backlogAdd,
  iterationAdd,
  taskBlock,
  taskFinish,
  testReport,
  taskMerge,
  taskReject,
  reportWrite,
};
