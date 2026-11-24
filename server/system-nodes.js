'use strict';

const crypto = require('node:crypto');
const {
  DEFAULT_WORKER_AGENT_ID,
  LEAD_ENGINEER_AGENT_ID,
  ROLE_WORKER_AGENT_MAP,
} = require('../src/agent-defaults');
const { normalizeQuestions } = require('../src/tools/agent');
const backgroundTools = require('../src/tools/process');

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
  lead: '主工程师',
  general: '程序员',
};

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
    roleName ? `Worker role: ${roleName}` : '',
    '',
    task.description || '(no description)',
  ];
  if (task.acceptance) {
    lines.push('', `Acceptance: ${task.acceptance}`);
  }
  if (task.testPlan) {
    lines.push('', `Test plan: ${task.testPlan}`);
  }
  if (task.reviewNote) {
    lines.push('', `Lead review rejected the previous attempt: ${task.reviewNote}`);
  }
  if (task.testVerdict === 'fail' && task.testReport) {
    lines.push('', '# Tester feedback');
    if (task.testReport.summary) lines.push(task.testReport.summary);
    const failures = Array.isArray(task.testReport.failures)
      ? task.testReport.failures
      : [];
    for (const failure of failures) lines.push(`- ${failure}`);
  }
  if (Array.isArray(task.keyPoints) && task.keyPoints.length > 0) {
    lines.push('', 'Notes:');
    for (const point of task.keyPoints) {
      if (point?.text) lines.push(`- ${point.text}`);
    }
  }
  lines.push(
    '',
    'Work only in your assigned Git worktree and branch. Do not merge or switch the integration branch; the architect merges your branch after review.',
    'When the task is complete, call task_finish with summary, how, files, commands, tests and artifacts. The task then moves to Testing for independent verification.',
    'If the tester returns failures, fix them on the same branch and call task_finish again.',
    'If you need approval or an answer before continuing, call task_block with kind approval or question. The task becomes blocked, the user sees who sent it, and the orchestrator resumes this conversation after it is resolved.',
    `taskId: ${task.id}`
  );
  return lines.filter((line) => line !== null).join('\n');
}

function designPrompt(design, goal, answersText = '') {
  const lines = [
    `Mission: ${goal || design.title}`,
    'You are the 主工程师 and technical architect. Do not implement product code.',
    '',
    '# 设计案',
    design.title,
    '',
    design.description || design.title,
    design.acceptance ? `\nAcceptance: ${design.acceptance}` : '',
    answersText ? `\n# 已确认的需求\n${answersText}` : '',
    '',
    'First ask only the technical questions the product design cannot answer: call task_block with kind "question" and concrete questions about interfaces, data, edge cases, compatibility, performance, security and test strategy.',
    'After the answers are confirmed, call architecture_write to publish the technical architecture. Include the chosen approach, modules, interfaces, data, security, performance, test strategy, risks and rollback.',
    'Then call backlog_add with independent tasks. Every task must have a clear title, description, role, acceptance criteria and testPlan. Use dependsOn only for real dependencies.',
    'When the architecture and Backlog tasks are written, call task_finish for the design task with a summary of the decomposition.',
    `designTaskId: ${design.id}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function testPrompt(task, goal) {
  const lines = [
    `Mission: ${goal || task.title}`,
    'You are the 测试员. Verify the implementation independently; do not change product code unless the task explicitly asks for it.',
    '',
    `Task: ${task.title}`,
    task.description || '(no description)',
    task.acceptance ? `\nAcceptance: ${task.acceptance}` : '',
    task.testPlan ? `\nTest plan: ${task.testPlan}` : '',
    '',
    '# Implementation',
  ];
  const branches = Array.isArray(task.gitBranches) ? task.gitBranches : [];
  for (const branch of branches) {
    lines.push(`- ${branch.branch}${branch.worktree ? ` (${branch.worktree})` : ''}`);
  }
  if (task.result?.summary) {
    lines.push('', `Engineer summary: ${task.result.summary}`);
  }
  lines.push(
    '',
    'The implementation branch is checked out in the test worktree provided to you. Run the relevant tests and commands, inspect the code, and try the acceptance criteria.',
    'You may add or adjust test files. Do not merge or switch the integration branch.',
    'Call test_report with verdict pass or fail, summary, cases, commands, evidence and failures. Pass moves the task to Verified; fail returns it to the original engineer.',
    `taskId: ${task.id}`
  );
  return lines.filter(Boolean).join('\n');
}

function leadReviewPrompt(tasks, goal) {
  const lines = [
    `Mission: ${goal || 'Mission'}`,
    'You are the 主工程师 and technical architect. Review the Verified tasks below, check the code, acceptance criteria and test report, and merge the implementation and test branches.',
    '',
  ];
  tasks.forEach((task, index) => {
    lines.push(`## ${index + 1}. ${task.title}`);
    lines.push(`- taskId: ${task.id}`);
    if (task.acceptance) lines.push(`- acceptance: ${task.acceptance}`);
    const result = task.result || {};
    if (result.summary) lines.push(`- summary: ${result.summary}`);
    const test = task.testReport || {};
    if (task.testVerdict) lines.push(`- testVerdict: ${task.testVerdict}`);
    if (test.summary) lines.push(`- testSummary: ${test.summary}`);
    if (Array.isArray(test.failures) && test.failures.length > 0) {
      lines.push(`- testFailures: ${test.failures.join('; ')}`);
    }
    const branches = [
      ...(Array.isArray(task.gitBranches) ? task.gitBranches : []),
      ...(Array.isArray(task.testBranches) ? task.testBranches : []),
    ];
    if (branches.length > 0) {
      lines.push(
        `- branches: ${branches.map((branch) => branch.branch).join(', ')}`
      );
    }
    lines.push('');
  });
  lines.push(
    'For each task, inspect the relevant code, the test report, and run tests or builds with shell when useful.',
    'If it meets the design, acceptance criteria and test report, call task_merge with its taskId. The tool merges the implementation and test branches and moves the task to Merged.',
    'If it is incomplete or incorrect, call task_reject with a concrete reason; it returns to Backlog.',
    'Do not modify product code. Do not call task_merge without checking.'
  );
  return lines.join('\n');
}

function reportPrompt(goal, tasks, report = null) {
  const lines = [
    `Mission: ${goal || 'Mission'}`,
    'You are the product manager. The mission is complete enough to report. Write the final report for the user with report_write.',
    '',
    '# Tasks',
  ];
  for (const task of tasks) {
    if (task.kind === 'design') continue;
    lines.push(`## ${task.title}`);
    lines.push(`- status: ${task.column}`);
    lines.push(`- role: ${task.role || 'general'}`);
    if (task.result?.summary) lines.push(`- result: ${task.result.summary}`);
    if (task.testVerdict) lines.push(`- test: ${task.testVerdict}`);
    if (task.testReport?.summary) {
      lines.push(`- test summary: ${task.testReport.summary}`);
    }
    lines.push('');
  }
  lines.push(
    'Write for a non-technical reader. Use short sections, concrete examples and before/after behavior. Say what the user asked for, what now works, how to try it, what was verified, what is not done, and what comes next. Keep file paths and commands out of the main narrative; put them in technicalDetails.',
    'Call report_write once with the final content. Do not modify code or tasks.',
    `reportId: ${report?.id || ''}`
  );
  return lines.join('\n');
}

function buildReportMarkdown(goal, tasks) {
  const statusLabel = (column) => {
    if (column === 'design') return '设计案';
    if (column === 'merged') return '已合并';
    if (column === 'verified') return '测试通过，待合并';
    if (column === 'finished') return '待测试';
    if (column === 'blocked') return '阻塞';
    if (column === 'progress') return '进行中';
    return '待处理';
  };
  const lines = [
    `# ${goal || '任务报告'}`,
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
    const test = task.testReport && typeof task.testReport === 'object'
      ? task.testReport
      : null;
    if (test) {
      lines.push(
        '',
        '### 独立测试',
        `- 结论：${task.testVerdict === 'pass' ? '通过' : '未通过'}`
      );
      if (test.summary) lines.push('', test.summary);
      const cases = Array.isArray(test.cases) ? test.cases : [];
      if (cases.length > 0) {
        lines.push(
          '',
          ...cases.map((item) => {
            if (item && typeof item === 'object') {
              return `- ${item.name || 'case'}: ${item.status || 'unknown'}`;
            }
            return `- ${item}`;
          })
        );
      }
      const failures = Array.isArray(test.failures) ? test.failures : [];
      if (failures.length > 0) {
        lines.push('', '失败：', ...failures.map((item) => `- ${item}`));
      }
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

function buildHumanReportMarkdown(input = {}) {
  const lines = [`# ${text(input.title || '完成报告', 200)}`, ''];
  const section = (heading, body) => {
    if (body) lines.push(`## ${heading}`, '', body, '');
  };
  const list = (heading, values) => {
    const items = strings(values, 50);
    if (items.length > 0) {
      lines.push(`## ${heading}`, '', ...items.map((item) => `- ${item}`), '');
    }
  };
  section('一句话', text(input.summary || '', 4000));
  section('你之前要什么', text(input.requested || '', 4000));
  list('现在能做什么', input.changes);
  list('例子', input.examples);
  const howToTry = strings(input.howToTry, 30);
  if (howToTry.length > 0) {
    lines.push(
      '## 怎么试',
      '',
      ...howToTry.map((item, index) => `${index + 1}. ${item}`),
      ''
    );
  }
  list('验证了什么', input.verification);
  list('还没做 / 已知问题', input.notDone);
  list('下一步', input.nextSteps);
  const technical = text(input.technicalDetails || '', 12000).trim();
  if (technical) {
    lines.push(
      '## 技术细节',
      '',
      '<details>',
      '<summary>展开查看</summary>',
      '',
      technical,
      '',
      '</details>',
      ''
    );
  }
  return lines.join('\n').trim();
}

function reportCounts(tasks) {
  const workTasks = tasks.filter((task) => task.kind !== 'design');
  return {
    total: workTasks.length,
    design: tasks.filter((task) => task.kind === 'design').length,
    finished: workTasks.filter((task) => task.column === 'finished').length,
    verified: workTasks.filter((task) => task.column === 'verified').length,
    merged: workTasks.filter((task) => task.column === 'merged').length,
    blocked: workTasks.filter((task) => task.column === 'blocked').length,
    active: workTasks.filter(
      (task) =>
        task.column === 'progress' ||
        task.column === 'backlog' ||
        task.column === 'finished' ||
        task.column === 'verified'
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
  ensureWorktree,
  prepareTestWorktree,
  commitWorktree,
  branchSummary,
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
      3,
      Math.min(12, Math.round(Number(manager?.nodeConfig?.engineerCount) || 3))
    );
  }

  function workerAgentForRole(role) {
    const key = String(role || 'general').toLowerCase();
    const id =
      key === 'lead'
        ? LEAD_ENGINEER_AGENT_ID
        : ROLE_WORKER_AGENT_MAP[key] || DEFAULT_WORKER_AGENT_ID;
    const agent = getAgent?.(id);
    if (!agent || agent.kind !== 'subagent') {
      throw new Error(`worker profile not found: ${id}`);
    }
    return agent;
  }

  function leadAgent() {
    return workerAgentForRole('lead');
  }

  async function ensureManagerEngineers(manager) {
    const count = managerEngineerCount(manager);
    let engineers = store
      .listWorkNodesMeta(manager.id)
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
    const leadAgentConfig = leadAgent();
    for (const engineer of engineers) {
      const index = Number(engineer.nodeConfig?.engineerIndex) || 0;
      if (index === 1) {
        const needsUpdate =
          engineer.title !== '主工程师' ||
          engineer.agentId !== leadAgentConfig.id ||
          engineer.nodeConfig?.lead !== true;
        if (needsUpdate) {
          const updated = store.updateSessionNode(engineer.id, {
            title: '主工程师',
            agentId: leadAgentConfig.id,
            nodeConfig: {
              ...(engineer.nodeConfig || {}),
              lead: true,
              tools: [...(leadAgentConfig.tools || [])],
            },
          });
          if (updated) Object.assign(engineer, updated);
          notify?.({ managerId: manager.id, nodeId: engineer.id });
        }
        continue;
      }
      if (index >= 2) {
        const workerNumber = Math.max(1, index - 1);
        const workerTitle = `工程师 ${workerNumber}`;
        const currentTitle = String(engineer.title || '').trim();
        const separator = currentTitle.indexOf(' · ');
        const baseTitle =
          separator >= 0 ? currentTitle.slice(0, separator) : currentTitle;
        if (!baseTitle || /^工程师\s*\d+$/.test(baseTitle)) {
          const suffix =
            separator >= 0 ? currentTitle.slice(separator) : '';
          const nextTitle = `${workerTitle}${suffix}`.slice(0, 120);
          if (nextTitle !== currentTitle) {
            const updated = store.updateSessionNode(engineer.id, {
              title: nextTitle,
            });
            if (updated) Object.assign(engineer, updated);
            notify?.({ managerId: manager.id, nodeId: engineer.id });
          }
        }
      }
      if (
        index >= 2 &&
        typeof ensureWorktree === 'function' &&
        !(Array.isArray(engineer.nodeConfig?.branches) &&
          engineer.nodeConfig.branches.length > 0) &&
        !runner.activeRunForSession?.(engineer.id)
      ) {
        try {
          const updated = ensureWorktree(manager, engineer);
          if (updated) Object.assign(engineer, updated);
        } catch (worktreeError) {
          console.error('ensure engineer worktree failed', worktreeError);
        }
      }
    }
    const extras = store
      .listWorkNodesMeta(manager.id)
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
    const workerCount = Math.max(1, engineerCount - 1);
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
          workerCount,
          wipLimit: workerCount,
          retryLimit: 2,
          boardIds: [],
          lastScanAt: 0,
          steps: [
            {
              at: Date.now(),
              message: `调度器已启动，1 个主工程师和 ${workerCount} 个工程师待命`,
            },
          ],
        },
      });
    } else if (
      Number(node.payload?.engineerCount) !== engineerCount ||
      Number(node.payload?.workerCount) !== workerCount ||
      Number(node.payload?.wipLimit) !== workerCount
    ) {
      node = updateNode(node.id, {
        payload: {
          ...(node.payload || {}),
          engineerCount,
          workerCount,
          wipLimit: workerCount,
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
          counts: {
            total: 0,
            design: 0,
            backlog: 0,
            progress: 0,
            blocked: 0,
            finished: 0,
            verified: 0,
            merged: 0,
          },
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
      const workTasks = tasks.filter((task) => task.kind !== 'design');
      const counts = {
        total: workTasks.length,
        design: tasks.filter((task) => task.kind === 'design').length,
        backlog: workTasks.filter((task) => task.column === 'backlog').length,
        progress: workTasks.filter((task) => task.column === 'progress').length,
        blocked: workTasks.filter((task) => task.column === 'blocked').length,
        finished: workTasks.filter((task) => task.column === 'finished').length,
        verified: workTasks.filter((task) => task.column === 'verified').length,
        merged: workTasks.filter((task) => task.column === 'merged').length,
      };
      const boardId = snapshot.board?.id || null;
      const boardLabel = snapshot.board?.label || '';
      const current = node.payload?.counts || {};
      const same =
        node.payload?.boardId === boardId &&
        node.payload?.boardLabel === boardLabel &&
        current.total === counts.total &&
        current.design === counts.design &&
        current.backlog === counts.backlog &&
        current.progress === counts.progress &&
        current.blocked === counts.blocked &&
        current.finished === counts.finished &&
        current.verified === counts.verified &&
        current.merged === counts.merged;
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

  function ensureBackgroundNode(manager) {
    let node = findNode(manager.id, 'background');
    if (!node) {
      node = createNode({
        managerId: manager.id,
        type: 'background',
        status: 'idle',
        title: '后台',
        payload: {
          projectId: manager.projectId,
          jobs: [],
          running: 0,
          createdAt: Date.now(),
        },
      });
    }
    return node;
  }

  function refreshBackgroundNode(manager) {
    const node = ensureBackgroundNode(manager);
    const jobs = backgroundTools.listJobs(manager.projectId);
    const running = jobs.filter((job) => job.running).length;
    const signature = JSON.stringify(
      jobs.map((job) => [
        job.id,
        job.status,
        job.running,
        job.endedAt,
        job.note,
        job.creatorSessionId,
        job.creatorTitle,
        job.command,
        job.cwd,
      ])
    );
    const status = running > 0 ? 'running' : 'idle';
    if (node.payload?.signature === signature && node.status === status) {
      return node;
    }
    return updateNode(node.id, {
      status,
      payload: {
        ...(node.payload || {}),
        projectId: manager.projectId,
        jobs,
        running,
        signature,
        updatedAt: Date.now(),
      },
    });
  }

  function ensureReport(manager, boardId, goal, taskIds = []) {
    let taskTitles = [];
    try {
      const agile = getAgileStore(manager.id);
      const wanted = new Set(taskIds);
      taskTitles = agile
        .listTasks(boardId)
        .filter((task) => wanted.has(task.id))
        .map((task) => task.title);
    } catch {
      taskTitles = [];
    }
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
          taskTitles,
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
        payload: {
          ...(node.payload || {}),
          goal,
          taskIds: [...taskIds],
          taskTitles,
        },
      });
    } else if (taskIds.length > 0) {
      const currentIds = Array.isArray(node.payload?.taskIds)
        ? node.payload.taskIds
        : [];
      const currentTitles = Array.isArray(node.payload?.taskTitles)
        ? node.payload.taskTitles
        : [];
      const same =
        currentIds.length === taskIds.length &&
        currentIds.every((id, index) => id === taskIds[index]);
      const titlesSame =
        currentTitles.length === taskTitles.length &&
        currentTitles.every((title, index) => title === taskTitles[index]);
      if (!same || !titlesSame) {
        node = updateNode(node.id, {
          payload: {
            ...(node.payload || {}),
            taskIds: [...taskIds],
            taskTitles,
          },
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
    const report = refreshReport(
      ensureReport(manager, boardId, goal, taskIds),
      boardId,
      goal
    );
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

  function refreshReportForBoard(managerId, boardId, goal = null) {
    const manager = managerSession(managerId);
    if (!manager) return null;
    let report = findNode(
      manager.id,
      'report',
      (item) => item.missionId === boardId
    );
    if (!report) {
      let tasks = [];
      try {
        tasks = getAgileStore(manager.id).listTasks(boardId);
      } catch {
        tasks = [];
      }
      report = ensureReport(
        manager,
        boardId,
        goal || 'Mission',
        tasks.map((task) => task.id)
      );
    }
    return refreshReport(report, boardId, goal || report?.payload?.goal || null);
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
      counts.total > 0 && counts.merged + counts.blocked === counts.total;
    const nextGoal = goal || node.payload?.goal || 'Mission';
    const humanReport = String(node.payload?.humanReport || '').trim();
    const reportMarkdown = humanReport || buildReportMarkdown(nextGoal, tasks);
    const status = terminal ? 'ready' : 'collecting';
    const updated = updateNode(node.id, {
      status,
      payload: {
        ...(node.payload || {}),
        boardId,
        goal: nextGoal,
        taskIds: tasks.map((task) => task.id),
        taskTitles: tasks.map((task) => task.title),
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
      if (
        (task.kind === 'design' && task.designState === 'done') ||
        task.column === 'blocked' ||
        task.column === 'finished' ||
        task.column === 'merged'
      ) {
        return;
      }
      const workerActor = {
        type: 'agent',
        id: task.claimedBy || session.id,
      };
      agile.updateTask(taskId, {
        workNodeId: task.kind === 'design' ? '' : session.id,
        attempts: (Number(task.attempts) || 0) + 1,
        designState: task.kind === 'design' ? 'pending' : task.designState,
        actor: workerActor,
      });
      if (task.kind !== 'design') {
        agile.moveTask(taskId, 'blocked', {
          actor: workerActor,
        });
      }
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

  function commitSessionChanges(session, task) {
    const directories = Array.isArray(session.nodeConfig?.directories)
      ? session.nodeConfig.directories
      : [];
    if (directories.length > 0 && typeof commitWorktree === 'function') {
      try {
        commitWorktree(directories, `yah: ${task.title}`);
      } catch (commitError) {
        console.error('commit worker changes failed', commitError);
      }
    }
    const branches = Array.isArray(session.nodeConfig?.branches)
      ? session.nodeConfig.branches
      : [];
    return {
      branches,
      labels:
        typeof branchSummary === 'function'
          ? branchSummary(branches)
          : branches.map((branch) => branch.branch).filter(Boolean),
    };
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
    const isDesign = task.kind === 'design';
    if (
      task.result &&
      (isDesign
        ? task.designState === 'done'
        : task.column === 'finished' || task.column === 'verified')
    ) {
      return { ok: true, duplicate: true, taskId, reportId: task.reportId || null };
    }
    const status = ['done', 'failed', 'blocked'].includes(input.status)
      ? input.status
      : 'done';
    const committed = isDesign
      ? { branches: [], labels: [] }
      : commitSessionChanges(session, task);
    const result = {
      status,
      summary: text(input.summary || input.text || '', 4000),
      how: strings(input.how, 80),
      files: strings(input.files, 200),
      commands: strings(input.commands, 200),
      tests: Array.isArray(input.tests) ? input.tests.slice(0, 100) : [],
      artifacts: strings(input.artifacts, 200),
      branches:
        committed.labels.length > 0
          ? committed.labels
          : strings(input.branches, 100),
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
      gitBranches: committed.branches,
      attempts: (Number(task.attempts) || 0) + 1,
      testVerdict: '',
      testReport: null,
      testState: 'pending',
      testNodeId: '',
      testedBy: '',
      testedAt: null,
      testBranches: [],
      reviewNote: '',
      actor: workerActor,
    });
    if (isDesign) {
      agile.updateTask(taskId, {
        designState: status === 'done' ? 'done' : 'blocked',
        finishedAt: new Date().toISOString(),
        actor: workerActor,
      });
    } else if (status === 'done') {
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

  function submitTestResult(session, input = {}) {
    if (!session || session.nodeRole !== 'work' || !session.managerId) {
      throw new Error('test_report can only be called by a work node');
    }
    const agile = getAgileStore(session.managerId);
    const taskId = String(
      input.taskId || session.nodeConfig?.taskId || ''
    ).trim();
    if (!taskId) throw new Error('test_report requires a taskId');
    const task = agile.getTask(taskId);
    if (!task || task.kind === 'design') {
      throw new Error('test_report requires an implementation task');
    }
    if (task.column !== 'finished') {
      throw new Error('test_report requires a task in Testing');
    }
    if (task.testNodeId && task.testNodeId !== session.id) {
      throw new Error('test_report can only be called by the assigned tester');
    }
    const verdict = String(input.verdict || '').trim().toLowerCase();
    if (verdict !== 'pass' && verdict !== 'fail') {
      throw new Error('test_report verdict must be pass or fail');
    }
    const committed = commitSessionChanges(session, task);
    const testReport = {
      verdict,
      summary: text(input.summary || '', 4000),
      cases: Array.isArray(input.cases) ? input.cases.slice(0, 100) : [],
      commands: strings(input.commands, 200),
      evidence: strings(input.evidence, 200),
      failures: strings(input.failures, 100),
      notes: text(input.notes || '', 4000),
      testedBy: session.id,
      testedAt: new Date().toISOString(),
    };
    const actor = { type: 'agent', id: session.id };
    agile.updateTask(taskId, {
      testVerdict: verdict,
      testReport,
      testBranches: committed.branches,
      testState: verdict === 'pass' ? 'passed' : 'failed',
      testNodeId: session.id,
      testedBy: session.id,
      testedAt: testReport.testedAt,
      actor,
    });
    if (verdict === 'pass') {
      agile.moveTask(taskId, 'verified', { actor });
      agile.updateTask(taskId, {
        reviewState: 'pending',
        reviewNote: '',
        actor,
      });
    } else {
      agile.moveTask(taskId, 'backlog', { actor });
      agile.updateTask(taskId, {
        reviewState: null,
        reviewNote: `测试未通过：${testReport.summary || 'see test report'}`,
        isRework: true,
        actor,
      });
    }
    const report = reportNodeForTask({
      ...task,
      managerId: session.managerId,
    });
    if (report) {
      appendStep(
        report,
        `测试${verdict === 'pass' ? '通过' : '未通过'}：${task.title}`,
        {
          kind: 'test',
          taskId: task.id,
          verdict,
        }
      );
      refreshReport(report, task.boardId, report.payload?.goal || null);
    }
    return {
      ok: true,
      taskId,
      verdict,
      column: verdict === 'pass' ? 'verified' : 'backlog',
      reportId: report?.id || null,
    };
  }

  function writeHumanReport(manager, input = {}) {
    if (!manager || manager.nodeRole !== 'manager') {
      throw new Error('report_write can only be called by a manager node');
    }
    const agile = getAgileStore(manager.id);
    const state = agile.state();
    const boardId = state.activeBoardId;
    let report = findNode(
      manager.id,
      'report',
      (item) => item.missionId === boardId
    );
    if (!report) {
      report = ensureReport(
        manager,
        boardId,
        text(input.title || state.board?.goal || 'Mission', 200),
        []
      );
    }
    const markdown = buildHumanReportMarkdown(input);
    const updated = updateNode(report.id, {
      status: 'ready',
      payload: {
        ...(report.payload || {}),
        humanReport: markdown,
        reportMarkdown: markdown,
        reportGeneratedAt: Date.now(),
        reportGeneratedBy: manager.id,
        reportState: 'done',
      },
    });
    appendStep(updated, '人话报告已生成', { kind: 'report' });
    return {
      ok: true,
      reportId: updated.id,
      title: text(input.title || '', 200),
      reportMarkdown: markdown,
    };
  }

  function findWorkTask(session, agile) {
    const directId = String(session.nodeConfig?.taskId || '').trim();
    if (directId) {
      try {
        const direct = agile.getTask(directId);
        if (
          direct &&
          (direct.workNodeId === session.id || direct.testNodeId === session.id)
        ) {
          return direct;
        }
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
            (item.workNodeId === session.id &&
              (item.column === 'progress' ||
                item.column === 'blocked' ||
                (item.kind === 'design' && item.column === 'design'))) ||
            (item.testNodeId === session.id &&
              (item.column === 'finished' || item.column === 'blocked'))
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
    if (freshTask.kind === 'design') {
      if (freshTask.designState === 'done') {
        throw new Error('design is already completed');
      }
      if (freshTask.designState === 'blocked') {
        throw new Error('design is already blocked');
      }
    } else {
      if (
        freshTask.column === 'finished' &&
        freshTask.testNodeId !== session.id
      ) {
        throw new Error('task is already finished');
      }
      if (freshTask.column === 'blocked') {
        throw new Error('task is already blocked');
      }
    }
    if (
      freshTask.workNodeId &&
      freshTask.workNodeId !== session.id &&
      freshTask.testNodeId !== session.id
    ) {
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
    const isTester = Boolean(
      task.kind !== 'design' &&
        task.testNodeId &&
        node.sessionId === task.testNodeId
    );
    const finishTool = isTester ? 'test_report with verdict pass or fail' : 'task_finish';
    const lines = [
      '[Task resumed]',
      `Task: ${task.title}`,
      task.acceptance ? `Acceptance: ${task.acceptance}` : '',
      task.kind === 'design' && task.description
        ? `\n# 设计案\n${task.description}`
        : '',
    ];
    if (outcome.kind === 'approval') {
      lines.push(
        outcome.approved ? 'Approval: approved' : 'Approval: denied',
        outcome.reason ? `Reason: ${outcome.reason}` : '',
        `Continue the task. If you still need approval or an answer, call task_block again. When done, call ${finishTool}.`
      );
    } else {
      if (outcome.timedOut) {
        lines.push(
          'Questionnaire: no answer before the timer expired.',
          `Continue with your best judgment. When done, call ${finishTool}.`
        );
      } else if (outcome.cancelled) {
        lines.push(
          'Questionnaire: dismissed without an answer.',
          `Continue with your best judgment. When done, call ${finishTool}.`
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
          `Continue the task with these answers. If you still need input, call task_block again. When done, call ${finishTool}.`
        );
      }
    }
    if (task.kind === 'design') {
      lines.push(
        'You are the architect. After confirming the requirements, call architecture_write, then backlog_add to create the Backlog tasks, then call task_finish on this design task.'
      );
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
    const isDesign = task?.kind === 'design';
    if (
      !task ||
      (isDesign
        ? task.designState !== 'blocked'
        : task.column !== 'blocked')
    ) {
      return { resumed: false };
    }
    if (task.blockedNodeId && task.blockedNodeId !== current.id) {
      return { resumed: false };
    }
    const worker = current.sessionId
      ? store.getSession(current.sessionId)
      : task.workNodeId
        ? store.getSession(task.workNodeId)
        : null;
    const orchestrator = findNode(manager.id, 'orchestrator');
    const report = reportNodeForTask({ ...task, managerId: manager.id });
    const resolvedOutcome = outcome || blockedOutcomeFromNode(current);
    const isTester = Boolean(
      !isDesign && task.testNodeId && current.sessionId === task.testNodeId
    );
    if (!worker || worker.archivedAt) {
      const releaseActor = {
        type: 'agent',
        id: task.claimedBy || manager.id,
      };
      if (isTester) {
        agile.moveTask(task.id, 'finished', { actor: releaseActor });
        agile.updateTask(task.id, {
          testState: 'pending',
          testNodeId: '',
          blockedReason: '',
          blockedBy: '',
          blockedKind: '',
          blockedNodeId: '',
          actor: releaseActor,
        });
      } else {
        if (!isDesign) {
          agile.moveTask(task.id, 'backlog', {
            actor: releaseActor,
          });
          agile.releaseTask(task.id, releaseActor);
        }
        agile.updateTask(task.id, {
          designState: isDesign ? 'pending' : task.designState,
          workNodeId: '',
          blockedReason: '',
          blockedBy: '',
          blockedKind: '',
          blockedNodeId: '',
          actor: releaseActor,
        });
      }
      appendStep(
        orchestrator,
        isDesign
          ? `解除阻塞：${task.title} → 设计案（主工程师不可用）`
          : isTester
            ? `解除阻塞：${task.title} → Testing（测试员不可用）`
            : `解除阻塞：${task.title} → Backlog（原工程师不可用）`,
        {
          kind: 'unblock',
          taskId: task.id,
        }
      );
      if (report) refreshReport(report, task.boardId, report.payload?.goal || null);
      return { resumed: false, requeued: true, taskId: task.id };
    }
    const workerActor = { type: 'agent', id: task.claimedBy || worker.id };
    const agent = isDesign
      ? leadAgent()
      : isTester
        ? workerAgentForRole('tester')
        : workerAgentForRole(task.role);
    if (isDesign) {
      // Start the resumed run first; the orchestrator must not dispatch a
      // second design run in the window before the run is registered.
    } else if (isTester) {
      agile.moveTask(task.id, 'finished', { actor: workerActor });
      agile.updateTask(task.id, {
        testState: 'testing',
        blockedReason: '',
        blockedBy: '',
        blockedKind: '',
        blockedNodeId: '',
        actor: workerActor,
      });
    } else {
      agile.moveTask(task.id, 'progress', { actor: workerActor });
    }
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
      if (isDesign) {
        agile.updateTask(task.id, {
          designState: 'working',
          blockedReason: '',
          blockedBy: '',
          blockedKind: '',
          blockedNodeId: '',
          actor: workerActor,
        });
      }
    } catch (runError) {
      if (isTester) {
        agile.moveTask(task.id, 'finished', { actor: workerActor });
      } else if (!isDesign) {
        agile.moveTask(task.id, 'backlog', { actor: workerActor });
        agile.releaseTask(task.id, workerActor);
      }
      agile.updateTask(task.id, {
        designState: isDesign ? 'pending' : task.designState,
        workNodeId: isDesign ? '' : task.workNodeId,
        blockedReason: '',
        blockedBy: '',
        blockedKind: '',
        blockedNodeId: '',
        actor: workerActor,
      });
      appendStep(
        orchestrator,
        isDesign
          ? `恢复失败，设计案回到待处理：${task.title}`
          : `恢复失败，任务回到 Backlog：${task.title}`,
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
      if (task.kind !== 'design') {
        agile.moveTask(taskId, 'blocked', { actor: workerActor });
      }
      agile.updateTask(taskId, {
        designState: task.kind === 'design' ? 'blocked' : task.designState,
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
            if (
              task.kind === 'design' ||
              task.column === 'blocked' ||
              task.column === 'finished' ||
              task.column === 'verified' ||
              task.column === 'merged'
            ) {
              return;
            }
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
    const engineers = await ensureManagerEngineers(manager);
    const lead =
      engineers.find(
        (engineer) => Number(engineer.nodeConfig?.engineerIndex) === 1
      ) || null;
    const workers = engineers.filter(
      (engineer) => Number(engineer.nodeConfig?.engineerIndex) >= 2
    );
    let leadBusy = Boolean(lead && runner.activeRunForSession?.(lead.id));
    for (const boardId of boardIds) {
      let tasks;
      try {
        tasks = agile.listTasks(boardId);
      } catch {
        continue;
      }
      if (tasks.length === 0) continue;
      for (const task of tasks) {
        const isDesign = task.kind === 'design';
        const blocked = isDesign
          ? task.designState === 'blocked'
          : task.column === 'blocked';
        if (!blocked || !task.blockedNodeId) continue;
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
        const workTasks = tasks.filter((task) => task.kind !== 'design');
        const counts = {
          design: tasks.filter((task) => task.kind === 'design').length,
          backlog: workTasks.filter((task) => task.column === 'backlog').length,
          progress: workTasks.filter((task) => task.column === 'progress').length,
          blocked: workTasks.filter((task) => task.column === 'blocked').length,
          finished: workTasks.filter((task) => task.column === 'finished').length,
          verified: workTasks.filter((task) => task.column === 'verified').length,
          merged: workTasks.filter((task) => task.column === 'merged').length,
        };
        const goal = payload.goals?.[boardId] || boardId;
        const updated = appendStep(
          orchestrator,
          `扫描 ${goal}：设计 ${counts.design} · Backlog ${counts.backlog} · 进行 ${counts.progress} · 阻塞 ${counts.blocked} · 待测试 ${counts.finished} · 待合并 ${counts.verified} · 已合并 ${counts.merged}`,
          { kind: 'scan' }
        );
        updateNode(updated.id, {
          payload: { ...(updated.payload || {}), lastScanAt: now },
        });
        payload.lastScanAt = now;
      }
      for (const task of tasks) {
        if (task.kind === 'design') continue;
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
      const goal = payload.goals?.[boardId] || tasks[0]?.title || 'Mission';
      const report = ensureReport(
        manager,
        boardId,
        goal,
        tasks.filter((task) => task.kind !== 'design').map((task) => task.id)
      );

      // Lead engineer: turn the design into confirmed requirements and tasks.
      if (!leadBusy && lead) {
        const designTask = tasks.find(
          (task) =>
            task.kind === 'design' &&
            task.column === 'design' &&
            task.autoDispatch !== false &&
            task.designState !== 'done' &&
            task.designState !== 'blocked'
        );
        if (designTask) {
          try {
            agile.updateTask(designTask.id, {
              workNodeId: lead.id,
              assignee: lead.id,
              claimedBy: lead.id,
              claimedAt: new Date().toISOString(),
              designState: 'working',
              reportId: report.id,
              attempts: (Number(designTask.attempts) || 0) + 1,
              actor: { type: 'agent', id: lead.id },
            });
            const agent = leadAgent();
            store.updateSessionNode(lead.id, {
              agentId: agent.id,
              title: '主工程师',
              nodeConfig: {
                ...(lead.nodeConfig || {}),
                lead: true,
                task: designTask.title,
                taskId: designTask.id,
                reportId: report.id,
                reviewTaskIds: [],
                tools: [...(agent.tools || [])],
              },
            });
            notify?.({ managerId: manager.id, nodeId: lead.id });
            const currentLead = store.getSession(lead.id);
            watchWorkNode(currentLead, report.id);
            runner.startRun({
              sessionId: lead.id,
              text: designPrompt(designTask, goal),
              runId: crypto.randomUUID(),
              agentConfig: agent,
              reasoningEffort: store.loadSettings().reasoningEffort,
            });
            leadBusy = true;
            appendStep(
              orchestrator,
              `设计案交给主工程师：${designTask.title}`,
              { kind: 'dispatch', taskId: designTask.id }
            );
          } catch (designError) {
            console.error('design dispatch failed', designError);
            agile.updateTask(designTask.id, {
              designState: 'pending',
              claimedBy: '',
              workNodeId: '',
              actor: { type: 'agent', id: orchestrator.id },
            });
            appendStep(
              orchestrator,
              `设计案派发失败：${designTask.title} · ${designError.message}`,
              { kind: 'error', taskId: designTask.id }
            );
          }
        }
      }

      // Testers: verify Finished implementation tasks independently.
      const testTasks = tasks.filter(
        (task) =>
          task.kind !== 'design' &&
          task.column === 'finished' &&
          task.autoDispatch !== false
      );
      for (const task of testTasks) {
        if (
          task.testState === 'testing' &&
          task.testNodeId &&
          !runner.activeRunForSession?.(task.testNodeId)
        ) {
          try {
            agile.updateTask(task.id, {
              testState: 'pending',
              testNodeId: '',
              claimedBy: '',
              actor: { type: 'agent', id: orchestrator.id },
            });
          } catch {
            /* ignore stale test reset failure */
          }
        }
      }
      const testable = testTasks.filter(
        (task) => task.testState !== 'testing'
      );
      if (testable.length > 0) {
        const idleTesters = workers.filter(
          (engineer) => !runner.activeRunForSession?.(engineer.id)
        );
        let testerIndex = 0;
        for (const task of testable) {
          const tester = idleTesters.find(
            (engineer, index) =>
              index >= testerIndex && engineer.id !== task.workNodeId
          );
          if (!tester) {
            appendStep(orchestrator, `等待独立测试员验证：${task.title}`, {
              kind: 'scan',
              taskId: task.id,
            });
            break;
          }
          testerIndex = idleTesters.indexOf(tester) + 1;
          try {
            const attempt = (Number(task.testAttempts) || 0) + 1;
            const prepared =
              typeof prepareTestWorktree === 'function'
                ? prepareTestWorktree({
                    branches: task.gitBranches,
                    sessionId: tester.id,
                    label: task.title,
                    attempt,
                  })
                : { directories: [], branches: [] };
            const testDirectories =
              prepared.directories.length > 0
                ? prepared.directories
                : (Array.isArray(task.gitBranches) ? task.gitBranches : [])
                    .map((branch) => branch.worktree)
                    .filter(Boolean);
            const testBranches =
              prepared.branches.length > 0
                ? prepared.branches
                : (Array.isArray(task.gitBranches) ? task.gitBranches : []).map(
                    (branch) => ({ ...branch })
                  );
            if (testDirectories.length === 0) {
              appendStep(
                orchestrator,
                `无法准备测试工作区：${task.title}`,
                { kind: 'error', taskId: task.id }
              );
              continue;
            }
            const agent = workerAgentForRole('tester');
            const testerBaseTitle = String(
              tester.title || `工程师 ${tester.nodeConfig?.engineerIndex || 2}`
            ).split(' · ')[0];
            store.updateSessionNode(tester.id, {
              agentId: agent.id,
              title: `测试员 · ${task.title}`.slice(0, 120),
              nodeConfig: {
                ...(tester.nodeConfig || {}),
                task: task.title,
                taskId: task.id,
                reportId: report.id,
                reviewTaskIds: [],
                testTask: true,
                directories: testDirectories,
                branches: testBranches,
                tools: [...(agent.tools || [])],
              },
            });
            agile.updateTask(task.id, {
              testNodeId: tester.id,
              testState: 'testing',
              testAttempts: attempt,
              claimedBy: tester.id,
              claimedAt: new Date().toISOString(),
              reviewState: 'testing',
              actor: { type: 'agent', id: tester.id },
            });
            notify?.({ managerId: manager.id, nodeId: tester.id });
            const currentTester = store.getSession(tester.id);
            watchWorkNode(currentTester, report.id);
            runner.startRun({
              sessionId: tester.id,
              text: testPrompt(
                { ...task, testAttempts: attempt },
                report?.payload?.goal || 'Mission'
              ),
              runId: crypto.randomUUID(),
              agentConfig: agent,
              reasoningEffort: store.loadSettings().reasoningEffort,
            });
            appendStep(
              orchestrator,
              `测试派单：${task.title} → ${testerBaseTitle}`,
              { kind: 'test', taskId: task.id }
            );
          } catch (testError) {
            console.error('test dispatch failed', testError);
            try {
              agile.updateTask(task.id, {
                testState: 'pending',
                testNodeId: '',
                claimedBy: '',
                actor: { type: 'agent', id: orchestrator.id },
              });
            } catch {
              /* ignore test reset failure */
            }
            appendStep(
              orchestrator,
              `测试派发失败：${task.title} · ${testError.message}`,
              { kind: 'error', taskId: task.id }
            );
          }
        }
      }

      // Lead engineer: review Verified tasks and merge their branches.
      if (!leadBusy && lead) {
        const reviewing = tasks.filter(
          (task) =>
            task.kind !== 'design' &&
            task.column === 'verified' &&
            task.reviewState === 'reviewing'
        );
        if (reviewing.length > 0) {
          reviewing.forEach((task) => {
            try {
              agile.updateTask(task.id, {
                reviewState: 'pending',
                reviewLeadId: '',
                reviewStartedAt: null,
                actor: { type: 'agent', id: orchestrator.id },
              });
            } catch {
              /* ignore review reset failure */
            }
          });
        }
        const finished = tasks.filter(
          (task) =>
            task.kind !== 'design' &&
            task.column === 'verified' &&
            (!task.reviewState ||
              task.reviewState === 'pending' ||
              task.reviewState === 'reviewing')
        );
        if (finished.length > 0) {
          try {
            finished.forEach((task) => {
              agile.updateTask(task.id, {
                reviewState: 'reviewing',
                reviewLeadId: lead.id,
                reviewStartedAt: new Date().toISOString(),
                actor: { type: 'agent', id: lead.id },
              });
            });
            const agent = leadAgent();
            store.updateSessionNode(lead.id, {
              agentId: agent.id,
              title: '主工程师',
              nodeConfig: {
                ...(lead.nodeConfig || {}),
                lead: true,
                task: '',
                taskId: null,
                reportId: report.id,
                reviewTaskIds: finished.map((task) => task.id),
                tools: [...(agent.tools || [])],
              },
            });
            notify?.({ managerId: manager.id, nodeId: lead.id });
            const currentLead = store.getSession(lead.id);
            watchWorkNode(currentLead, report.id);
            runner.startRun({
              sessionId: lead.id,
              text: leadReviewPrompt(finished, goal),
              runId: crypto.randomUUID(),
              agentConfig: agent,
              reasoningEffort: store.loadSettings().reasoningEffort,
            });
            leadBusy = true;
            appendStep(
              orchestrator,
              `待主工程师检查并合并：${finished.length} 个任务`,
              { kind: 'review' }
            );
          } catch (reviewError) {
            finished.forEach((task) => {
              try {
                agile.updateTask(task.id, {
                  reviewState: 'pending',
                  reviewLeadId: '',
                  reviewStartedAt: null,
                  actor: { type: 'agent', id: orchestrator.id },
                });
              } catch {
                /* ignore review reset failure */
              }
            });
            appendStep(
              orchestrator,
              `主工程师检查启动失败：${reviewError.message}`,
              { kind: 'error' }
            );
          }
        }
      }

      // Manager: write the final plain-language report after the mission settles.
      const countsNow = reportCounts(tasks);
      const terminal =
        countsNow.total > 0 &&
        countsNow.merged + countsNow.blocked === countsNow.total;
      if (terminal && report && !report.payload?.humanReport) {
        const reportState = String(report.payload?.reportState || '');
        const startedAt = Number(report.payload?.reportStartedAt) || 0;
        const stale =
          reportState === 'writing' &&
          Date.now() - startedAt > 5 * 60 * 1000;
        if (
          (reportState !== 'writing' || stale) &&
          !runner.activeRunForSession?.(manager.id)
        ) {
          try {
            const agent = getAgent?.('manager');
            updateNode(report.id, {
              payload: {
                ...(report.payload || {}),
                reportState: 'writing',
                reportStartedAt: Date.now(),
              },
            });
            runner.startRun({
              sessionId: manager.id,
              text: reportPrompt(goal, tasks, report),
              runId: crypto.randomUUID(),
              agentConfig: agent,
              reasoningEffort: store.loadSettings().reasoningEffort,
            });
            appendStep(orchestrator, `生成人话报告：${goal}`, {
              kind: 'report',
            });
          } catch (reportError) {
            console.error('report dispatch failed', reportError);
            appendStep(
              orchestrator,
              `人话报告生成失败：${reportError.message}`,
              { kind: 'error' }
            );
          }
        }
      }

      // Worker engineers: implement Backlog tasks only.
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const eligible = tasks
        .filter((task) => task.kind !== 'design')
        .filter((task) => task.column === 'backlog')
        .filter((task) => task.autoDispatch !== false)
        .filter((task) =>
          (Array.isArray(task.dependsOn) ? task.dependsOn : []).every(
            (id) => byId.get(id)?.column === 'merged'
          )
        )
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));
      if (eligible.length === 0) continue;
      const idleWorkers = workers.filter(
        (engineer) => !runner.activeRunForSession?.(engineer.id)
      );
      if (idleWorkers.length === 0) {
        appendStep(orchestrator, '工程师都在忙，等待空闲', { kind: 'scan' });
        continue;
      }
      const usedWorkers = new Set();
      for (const task of eligible) {
        let engineer = null;
        if (task.workNodeId) {
          engineer =
            idleWorkers.find(
              (item) => item.id === task.workNodeId && !usedWorkers.has(item.id)
            ) || null;
          if (!engineer) {
            appendStep(
              orchestrator,
              `等待原工程师返工：${task.title}`,
              { kind: 'scan', taskId: task.id }
            );
            continue;
          }
        } else {
          engineer =
            idleWorkers.find((item) => !usedWorkers.has(item.id)) || null;
          if (!engineer) {
            appendStep(
              orchestrator,
              `${idleWorkers.length} 个工程师都在忙，等待空闲`,
              { kind: 'scan' }
            );
            break;
          }
        }
        usedWorkers.add(engineer.id);
        try {
          agile.claimTask(task.id, engineer.id);
          agile.moveTask(task.id, 'progress', {
            actor: { type: 'agent', id: engineer.id },
          });
          const role = String(task.role || 'general');
          const roleName = roleMap[role] || role || '程序员';
          const agent = workerAgentForRole(role);
          const engineerBaseTitle = String(
            engineer.title || `工程师 ${engineer.nodeConfig?.engineerIndex || 2}`
          ).split(' · ')[0];
          store.updateSessionNode(engineer.id, {
            agentId: agent.id,
            title: `${engineerBaseTitle} · ${task.title}`.slice(0, 120),
            nodeConfig: {
              ...(engineer.nodeConfig || {}),
              task: task.title,
              taskId: task.id,
              reportId: report.id,
              reviewTaskIds: [],
              tools: agent.tools,
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
      const managers = store.listManagerSessions();
      for (const manager of managers) {
        refreshAgileNode(manager);
        refreshBackgroundNode(manager);
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
    if (node.type === 'background') {
      if (name !== 'stop') {
        throw new Error(`unknown background action: ${name}`);
      }
      const manager = managerSession(node.managerId);
      if (!manager) throw new Error('manager not found');
      const jobId = String(input.jobId || input.id || '').trim();
      if (!jobId) throw new Error('jobId is required');
      const job = backgroundTools.cancelJob(jobId, manager.projectId);
      if (!job) throw new Error('background task not found');
      const updated = refreshBackgroundNode(manager);
      return appendStep(
        updated,
        `后台服务已停止：${job.note || job.id}`,
        { kind: 'control', jobId: job.id }
      );
    }
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
    ensureBackgroundNode,
    refreshBackgroundNode,
    ensureReport,
    ensureMission,
    refreshReportForBoard,
    submitWorkResult,
    submitTestResult,
    writeHumanReport,
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
  testPrompt,
  reportPrompt,
  buildReportMarkdown,
  buildHumanReportMarkdown,
  reportCounts,
};
