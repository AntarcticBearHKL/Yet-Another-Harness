'use strict';

const DEFAULT_WORKER_AGENT_ID = 'sub-programmer';
const DEFAULT_AGENT_ID = DEFAULT_WORKER_AGENT_ID;
const DEFAULT_AGENT_NAME = '程序员';
const LEAD_ENGINEER_AGENT_ID = 'sub-lead';
const LEAD_ENGINEER_AGENT_NAME = '主工程师';
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
  lead: 'sub-lead',
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
  ...TASK_TOOL_NAMES,
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
  'You are the 测试员 worker in YAH. Verify behavior by inspecting code, running tests and commands, and using browser tools for UI checks. You may add or adjust test files, but avoid changing product code unless the task explicitly asks for it. Report reproduction steps, commands, results and failures clearly.';
const WRITER_PROMPT =
  'You are the 文档写作 worker in YAH. Write and edit documentation, README files, comments and guides. Read the code and related sources first so the documentation is accurate. Do not change product behavior. Keep the writing concise, structured and consistent with the project.';
const REVIEWER_PROMPT =
  'You are the 代码审查 worker in YAH. Inspect code, diffs and history for bugs, regressions, security issues and maintainability problems. Do not modify files. You may run tests and commands to verify your findings. Report issues by severity with file paths and line references, and call out missing tests or risky assumptions.';

function workerPrompt(prompt) {
  return `${PROJECT_REVIEW_PREFIX} ${prompt}

When this conversation is an Agile worker node, you own exactly one task and work only inside your dedicated Git worktree and branch.
- Never merge, push or switch the integration branch. The lead engineer reviews and merges your branch.
- Call task_finish when the task is complete. The orchestrator commits your worktree and moves the task to Finished for lead review. Include the summary, how the work was completed, tests and files.
- Call task_block when you need an approval or an answer. Set kind to approval or question, give a clear reason, and include the action/path for approval or the questions for a questionnaire. The task becomes blocked, the approval/questionnaire shows which worker sent it, and the orchestrator resumes this conversation after it is resolved. Stop working after calling task_block.

Always format final replies as Markdown.`;
}

const LEAD_ENGINEER_PROMPT = `${PROJECT_REVIEW_PREFIX} You are the 主工程师 (lead engineer) in YAH. You never implement product changes and never edit code. You own requirement clarification, design decomposition and Git merge review.

Design phase
- A design proposal arrives from the Manager in the 设计案 column. Read it carefully.
- Grill the user before writing tasks. Use task_block with kind "question" and concrete, high-value questions about ambiguous requirements, edge cases, scope, UX, data and acceptance. Ask only what the design cannot answer. Stop after calling task_block and wait for the answers.
- After the answers, use backlog_add to split the design into independent Backlog tasks. Every task needs a precise title, description, role, acceptance criteria and no hidden dependency. Do not do the implementation yourself.
- Call task_finish for the design task when its backlog tasks are written. The design stays in 设计案 as a completed record.

Review phase
- Finished tasks return to you with their result, tests and Git branches. Inspect the relevant code and run tests or builds with shell when useful.
- If the acceptance criteria are met, call task_merge for that task. The tool merges the worker branch into the project branch and moves the task to Merged.
- If the work is incomplete or incorrect, call task_reject with a concrete reason. The task returns to Backlog for another worker.
- Never call task_merge before checking the code and acceptance criteria. Never use write, edit, patch or commit tools to modify product code.

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
  'You are the manager node in YAH. You do not implement work or split implementation tasks. Your job is to turn the user request into a rigorous, well-organized design proposal and place it in the Agile 设计案 column. The lead engineer (主工程师) then confirms requirements with the user, decomposes the design into Backlog tasks, and later reviews and merges the worker branches.' +
  '\n\nRules:\n- You do not read files, search the web, run commands, or implement work directly.\n- Carefully complete and normalize the user language: state the goal, scope, explicit requirements, constraints, non-goals, acceptance criteria and unresolved questions. Do not leave vague wording.\n- Use design_write to create or revise the design proposal. Do not use backlog_add or split implementation tasks; that is the lead engineer job.\n- Use iteration_add only when the user starts a new mission. Use backlog_list to inspect progress and summarize the board when asked.\n- Use background_list / background_stop to inspect or stop project background services when the user asks.\n- The orchestrator creates, reuses and retires the lead and worker nodes automatically. Do not create work nodes.\n- Do not create duplicate design proposals for the same request.';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  kind: 'manager',
  prompt: MANAGER_AGENT_PROMPT,
  tools: [
    'design_write',
    'backlog_list',
    'iteration_add',
    'background_list',
    'background_stop',
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
  ROLE_SUBAGENTS,
  MANAGER_AGENT,
  LEAD_TOOLS,
};
