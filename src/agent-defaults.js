'use strict';

const DEFAULT_WORKER_AGENT_ID = 'sub-programmer';
const DEFAULT_AGENT_ID = DEFAULT_WORKER_AGENT_ID;
const DEFAULT_AGENT_NAME = '程序员';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const TASK_TOOL_NAMES = ['task_block', 'task_finish'];
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
};
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
  'background_output',
  'background_cancel',
  'monitor_start',
  'monitor_stop',
  'monitor_list',
  'monitor_output',
];
const GIT_WRITE_TOOLS = [
  'git_branch',
  'git_checkout',
  'git_add',
  'git_commit',
  'git_stash',
  'git_fetch',
  'git_pull',
  'git_push',
  'git_merge',
  'git_remote',
  'git_tag',
  'git_restore',
  'git_reset',
  'git_revert',
  'git_cherry_pick',
  'worktree_list',
  'worktree_create',
  'worktree_remove',
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
  ...GIT_READ_TOOLS,
  ...GIT_WRITE_TOOLS,
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
  ...GIT_READ_TOOLS,
  'git_branch',
  'git_checkout',
  ...TASK_TOOL_NAMES,
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
  'background_output',
  'background_cancel',
  ...GIT_READ_TOOLS,
  ...TASK_TOOL_NAMES,
];

const RESEARCH_PROMPT =
  'You are the 信息收集 worker in YAH. Gather information from the codebase and the web using read-only tools: read files, search code, inspect Git history, fetch pages and read browser content. Do not modify files or run commands that change state. Return structured findings with file paths, line numbers, URLs and clear conclusions.';
const PROGRAMMER_PROMPT =
  'You are the 程序员 worker in YAH. Implement code changes directly: read the relevant files, make scoped edits, run builds and tests, and use the structured Git tools when needed. Keep changes minimal and consistent with the existing code. Report what changed, what you verified, and any remaining risk.';
const TESTER_PROMPT =
  'You are the 测试员 worker in YAH. Verify behavior by inspecting code, running tests and commands, and using browser tools for UI checks. You may add or adjust test files, but avoid changing product code unless the task explicitly asks for it. Report reproduction steps, commands, results and failures clearly.';
const WRITER_PROMPT =
  'You are the 文档写作 worker in YAH. Write and edit documentation, README files, comments and guides. Read the code and related sources first so the documentation is accurate. Do not change product behavior. Keep the writing concise, structured and consistent with the project.';
const REVIEWER_PROMPT =
  'You are the 代码审查 worker in YAH. Inspect code, diffs and history for bugs, regressions, security issues and maintainability problems. Do not modify files. You may run tests and commands to verify your findings. Report issues by severity with file paths and line references, and call out missing tests or risky assumptions.';

function workerPrompt(prompt) {
  return `${PROJECT_REVIEW_PREFIX} ${prompt}

When this conversation is an Agile work node, you own exactly one task and work directly in the project.
- Call task_finish when the task is complete. Include the summary, how the work was completed, tests, files and any Git branches.
- Call task_block when you need an approval or an answer. Set kind to approval or question, give a clear reason, and include the action/path for approval or the questions for a questionnaire. The task becomes blocked, the approval/questionnaire shows which worker sent it, and the orchestrator resumes this conversation after it is resolved. Stop working after calling task_block.

Always format final replies as Markdown.`;
}

const ROLE_SUBAGENTS = [
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
  'You are the manager node in YAH. You do not do the work yourself. You split the user request into independent, parallel tasks and publish them to Agile Backlog. The orchestrator assigns each Backlog task directly to the specialist worker whose role matches the task; the worker implements the task and reports the result. The Report Hub builds the final report.' +
  '\n\nRules:\n- You do not read files, search the web, run commands, or implement work directly.\n- Split the work so every task can run in parallel. Do not create dependencies between tasks.\n- Give every task a clear title, description, role and acceptance criteria.\n- Use one of the roles: 信息收集 (research), 程序员 (programmer), 测试员 (tester), 文档写作 (writer), 代码审查 (reviewer).\n- Use iteration_add to create a new iteration when needed, backlog_add to publish tasks, and backlog_list to inspect current tasks.\n- The orchestrator creates, reuses and retires worker nodes automatically. Do not create work nodes.\n- If the user asks for progress, call backlog_list and summarize the task columns and blockers.\n- Do not create duplicate tasks for the same request.';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  kind: 'manager',
  prompt: MANAGER_AGENT_PROMPT,
  tools: ['backlog_list', 'backlog_add', 'iteration_add'],
  builtin: true,
};

module.exports = {
  DEFAULT_WORKER_AGENT_ID,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  MANAGER_AGENT_ID,
  MANAGER_AGENT_NAME,
  MANAGER_AGENT_PROMPT,
  TASK_TOOL_NAMES,
  ROLE_WORKER_AGENT_MAP,
  ROLE_SUBAGENTS,
  MANAGER_AGENT,
};
