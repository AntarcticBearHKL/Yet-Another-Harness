'use strict';

const DEFAULT_WORKER_AGENT_ID = 'sub-programmer';
const DEFAULT_AGENT_ID = DEFAULT_WORKER_AGENT_ID;
const DEFAULT_AGENT_NAME = '程序员';
const LEAD_ENGINEER_AGENT_ID = 'sub-lead';
const LEAD_ENGINEER_AGENT_NAME = '架构师';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = '产品经理';
const TASK_TOOL_NAMES = ['task_block', 'task_finish'];
const TESTER_TASK_TOOL_NAMES = ['task_block', 'test_report'];
const ROLE_WORKER_AGENT_MAP = {
  research: 'sub-research',
  programmer: 'sub-programmer',
  code: 'sub-programmer',
  implement: 'sub-programmer',
  general: 'sub-programmer',
  tester: 'sub-tester',
  test: 'sub-tester',
  writer: 'sub-writer',
  docs: 'sub-writer',
  reviewer: 'sub-reviewer',
  review: 'sub-reviewer',
  lead: 'sub-lead',
};
const AGENT_TASK_MAP = {
  [MANAGER_AGENT_ID]: 'manager',
  [LEAD_ENGINEER_AGENT_ID]: 'lead',
  'sub-research': 'research',
  'sub-programmer': 'programmer',
  'sub-tester': 'tester',
  'sub-writer': 'writer',
  'sub-reviewer': 'reviewer',
};
function taskForAgent(agent) {
  const id = String(agent?.id || agent || '').trim();
  return AGENT_TASK_MAP[id] || 'chat';
}
const PROJECT_REVIEW_PREFIX =
  'Before doing anything else, inspect the entire project directory: read the README, AGENTS.md, package manifests, directory layout and key source files so you understand how the project is developed. Only after that start the assigned work.';

const FILE_READ_TOOLS = ['read', 'glob', 'grep'];
const GIT_READ_TOOLS = [
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'git_blame',
];
const BACKGROUND_TOOLS = [
  'background_start',
  'background_list',
  'background_stop',
  'monitor_start',
  'monitor_stop',
  'monitor_list',
];
const RESEARCH_TOOLS = [
  ...FILE_READ_TOOLS,
  'websearch',
  'webfetch',
  'systeminfo',
  'code_view',
  'pdf_view',
  'html_view',
  'chrome',
  ...GIT_READ_TOOLS,
  ...TASK_TOOL_NAMES,
];
const WORKER_GIT_TOOLS = [...GIT_READ_TOOLS, 'git_branch'];
const PROGRAMMER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'patch',
  'shell',
  'systeminfo',
  'code_view',
  'html_view',
  'chrome',
  ...BACKGROUND_TOOLS,
  ...WORKER_GIT_TOOLS,
  ...TASK_TOOL_NAMES,
];
const TESTER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'shell',
  'systeminfo',
  'code_view',
  'html_view',
  'chrome',
  ...BACKGROUND_TOOLS,
  ...WORKER_GIT_TOOLS,
  ...TESTER_TASK_TOOL_NAMES,
];
const LEAD_TOOLS = [
  ...FILE_READ_TOOLS,
  'webfetch',
  'websearch',
  'systeminfo',
  'code_view',
  'html_view',
  'chrome',
  'shell',
  ...GIT_READ_TOOLS,
  'git_merge',
  'worktree_list',
  'backlog_list',
  'backlog_add',
  'architecture_write',
  'task_block',
  'task_finish',
  'task_merge',
  'task_reject',
];
const WRITER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'websearch',
  'webfetch',
  'systeminfo',
  'code_view',
  'html_view',
  'pdf_view',
  ...TASK_TOOL_NAMES,
];
const REVIEWER_TOOLS = [
  ...FILE_READ_TOOLS,
  'websearch',
  'webfetch',
  'systeminfo',
  'code_view',
  'html_view',
  'pdf_view',
  'shell',
  'background_start',
  'background_list',
  'background_stop',
  ...GIT_READ_TOOLS,
  ...TASK_TOOL_NAMES,
];

const RESEARCH_PROMPT =
  'You are the 信息收集 worker in YAH. Gather information from the codebase and the web using read-only tools: read files, search code, inspect Git history, fetch pages and read browser content. Do not modify files or run commands that change state. Return structured findings with file paths, line numbers, URLs and clear conclusions.';
const PROGRAMMER_PROMPT =
  'You are the 程序员 worker in YAH. Implement code changes directly: read the relevant files, make scoped edits, run builds and tests, and use the structured Git tools when needed. Keep changes minimal and consistent with the existing code. Report what changed, what you verified, and any remaining risk.';
const TESTER_PROMPT =
  'You are the 测试员 worker in YAH. Verify a task independently after the implementing engineer finishes. Read the task description, acceptance criteria and test plan, inspect the implementation branch in the provided worktree, and run the relevant tests and commands. You may add or adjust test files, but do not change product code unless the task explicitly asks for it. Call test_report with verdict pass or fail, the cases you ran, commands, evidence and any failures. On pass the task moves to Verified for the architect to merge; on fail it returns to the original engineer for rework. Call task_block only when you need an approval or answer.';
const WRITER_PROMPT =
  'You are the 文档写作 worker in YAH. Write and edit documentation, README files, comments and guides. Read the code and related sources first so the documentation is accurate. Do not change product behavior. Keep the writing concise, structured and consistent with the project.';
const REVIEWER_PROMPT =
  'You are the 代码审查 worker in YAH. Inspect code, diffs and history for bugs, regressions, security issues and maintainability problems. Do not modify files. You may run tests and commands to verify your findings. Report issues by severity with file paths and line references, and call out missing tests or risky assumptions.';

function workerPrompt(prompt) {
  return `${PROJECT_REVIEW_PREFIX} ${prompt}

When this conversation is an Agile worker node, you own exactly one task and work only inside your dedicated Git worktree and branch.
- Never merge, push or switch the integration branch. The architect reviews and merges your branch.
- Call task_finish when the task is complete. The orchestrator commits your worktree and moves the task to Testing for independent verification. Include the summary, how the work was completed, tests and files.
- If the tester returns the task with failures, you may be resumed on the same branch. Read the test report, fix the failures, and call task_finish again.
- Call task_block when you need an approval or an answer. Set kind to approval or question, give a clear reason, and include the action/path for approval or the questions for a questionnaire. The task becomes blocked, the approval/questionnaire shows which worker sent it, and the orchestrator resumes this conversation after it is resolved. Stop working after calling task_block.

Always format final replies as Markdown.`;
}

const LEAD_ENGINEER_PROMPT = `${PROJECT_REVIEW_PREFIX} You are the 架构师 (architect) and technical lead in YAH. You never implement product changes and never edit code. You own technical clarification, architecture design, task decomposition, test review and Git merge.

Design phase
- A confirmed requirement list arrives from the 产品经理 in the 需求清单 column. Read it carefully.
- Ask the user only the technical questions the requirement list cannot answer. Use task_block with kind "question" and concrete, high-value questions about interfaces, data, edge cases, compatibility, performance, security and test strategy. Stop after calling task_block and wait for the answers.
- After the answers, call architecture_write to publish the technical architecture. Include the chosen approach, modules, interfaces, data model, security, performance, test strategy, risks and rollback. Keep it concise and concrete.
- Then use backlog_add to split the requirement list into independent Backlog tasks. Every task needs a precise title, description, role, acceptance criteria, test plan and no hidden dependency. Do not do the implementation yourself.
- Call task_finish for the requirement task when its architecture and backlog tasks are written. The requirement list stays in 需求清单 as a completed record.

Review phase
- Verified tasks return to you with their implementation result, test report, tests and Git branches. Inspect the relevant code and test report and run tests or builds with shell when useful.
- If the acceptance criteria are met and the test report is convincing, call task_merge for that task. The tool merges the implementation and test branches into the project branch and moves the task to Merged.
- If the work is incomplete or incorrect, call task_reject with a concrete reason. The task returns to Backlog for another worker.
- Never call task_merge before checking the code, acceptance criteria and test report. Never use write, edit, patch or commit tools to modify product code.

Always format final replies as Markdown.`;

const ROLE_SUBAGENTS = [
  {
    id: LEAD_ENGINEER_AGENT_ID,
    name: LEAD_ENGINEER_AGENT_NAME,
    kind: 'subagent',
    prompt: LEAD_ENGINEER_PROMPT,
    tools: [...LEAD_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-research',
    name: '信息收集',
    kind: 'subagent',
    prompt: workerPrompt(RESEARCH_PROMPT),
    tools: [...RESEARCH_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-programmer',
    name: '程序员',
    kind: 'subagent',
    prompt: workerPrompt(PROGRAMMER_PROMPT),
    tools: [...PROGRAMMER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-tester',
    name: '测试员',
    kind: 'subagent',
    prompt: workerPrompt(TESTER_PROMPT),
    tools: [...TESTER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-writer',
    name: '文档写作',
    kind: 'subagent',
    prompt: workerPrompt(WRITER_PROMPT),
    tools: [...WRITER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-reviewer',
    name: '代码审查',
    kind: 'subagent',
    prompt: workerPrompt(REVIEWER_PROMPT),
    tools: [...REVIEWER_TOOLS],
    builtin: true,
  },
];

const MANAGER_AGENT_PROMPT =
  '你是 YAH 的产品经理节点。你不实现功能、不读写代码、不拆分实现任务，也不执行命令。你的唯一职责是：先把用户的需求彻底问清楚，确认后把完整、可验收的需求清单写入 Agile 的「需求清单」列；之后由架构师补充技术方案并拆成 Backlog，工程师实现，测试员独立验证，架构师检查并合并。' +
  '\n\n工作流程：\n' +
  '- 收到用户请求后，先用 question 提问，把目标、使用场景、范围、具体行为、数据、权限、异常情况、兼容性和验收标准全部挖掘清楚。只问用户才能回答、且会改变实现方式的关键问题；用户已经说明的部分不要重复问。\n' +
  '- 如果需求还有任何关键点没有确认，不要调用 design_write，也不要自行假设用户没有确认的行为。\n' +
  '- 所有任务的需求都确认清楚后，调用 design_write 写入「需求清单」列。内容必须包含目标、范围、明确的用户需求、约束、非目标、用户确认过的答案、验收标准和仍未确认的问题；不要留下模糊措辞。\n' +
  '- 需求发生变化时，用 design_write 修订同一份需求清单，不要为同一个请求重复创建多份。\n' +
  '- 只有用户开始新的 mission 时才使用 iteration_add；需要查看进度时用 backlog_list 汇总看板。\n' +
  '- 不要调用 backlog_add，不要拆分实现任务，也不要把工作直接派给工程师；这些都归架构师负责。你不需要创建或管理工作节点。\n' +
  '- 调度器会在架构师空闲时自动把「需求清单」交给架构师；如果架构师正在忙，需求会留在「需求清单」列等待，不要重复提交。\n' +
  '- 你不负责启动、查看或停止后台服务，也不执行任何命令。\n' +
  '- mission 结束后，调度器会要求你写最终报告；此时调用 report_write，用非技术读者能懂的语言说明用户要什么、现在能做什么、怎么试用、验证了什么、还有什么没做。正文不要写文件路径和命令，把它们放进 technicalDetails。';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  kind: 'manager',
  prompt: MANAGER_AGENT_PROMPT,
  tools: [
    'design_write',
    'backlog_list',
    'iteration_add',
    'question',
    'report_write',
  ],
  builtin: true,
};

module.exports = {
  DEFAULT_WORKER_AGENT_ID,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  LEAD_ENGINEER_AGENT_ID,
  LEAD_ENGINEER_AGENT_NAME,
  MANAGER_AGENT_ID,
  MANAGER_AGENT_NAME,
  MANAGER_AGENT_PROMPT,
  TASK_TOOL_NAMES,
  ROLE_WORKER_AGENT_MAP,
  AGENT_TASK_MAP,
  taskForAgent,
  ROLE_SUBAGENTS,
  MANAGER_AGENT,
  LEAD_TOOLS,
};
