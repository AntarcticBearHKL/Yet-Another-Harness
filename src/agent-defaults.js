'use strict';

const DEFAULT_AGENT_ID = 'basic';
const DEFAULT_AGENT_NAME = 'Build';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const AGENT_AGENT_ID = 'agent';
const AGENT_AGENT_NAME = '项目协调';
const SUBAGENT_TOOL_NAMES = ['subagent_start', 'subagent_close'];
const WORK_RESULT_TOOL = 'worknode_result';
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
const ALL_WORK_TOOLS = [
  'read',
  'write',
  'shell',
  'webfetch',
  'websearch',
  'patch',
  'systeminfo',
  'mouse',
  'code_view',
  'pdf_view',
  'html_view',
  'chrome',
  'question',
  'glob',
  'grep',
  'edit',
  ...BACKGROUND_TOOLS,
  ...GIT_READ_TOOLS,
  ...GIT_WRITE_TOOLS,
];

const RESEARCH_TOOLS = [
  ...FILE_READ_TOOLS,
  'websearch',
  'webfetch',
  'systeminfo',
  'question',
  'code_view',
  'pdf_view',
  'html_view',
  'chrome',
  ...GIT_READ_TOOLS,
];
const PROGRAMMER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'patch',
  'shell',
  'systeminfo',
  'question',
  'code_view',
  'html_view',
  'chrome',
  ...BACKGROUND_TOOLS,
  ...GIT_READ_TOOLS,
  ...GIT_WRITE_TOOLS,
];
const TESTER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'shell',
  'systeminfo',
  'question',
  'code_view',
  'html_view',
  'chrome',
  ...BACKGROUND_TOOLS,
  ...GIT_READ_TOOLS,
  'git_branch',
  'git_checkout',
];
const WRITER_TOOLS = [
  'read',
  'write',
  'edit',
  ...FILE_READ_TOOLS.filter((name) => name !== 'read'),
  'websearch',
  'webfetch',
  'systeminfo',
  'question',
  'code_view',
  'html_view',
  'pdf_view',
];
const REVIEWER_TOOLS = [
  ...FILE_READ_TOOLS,
  'websearch',
  'webfetch',
  'systeminfo',
  'question',
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
];

const DEFAULT_AGENT_PROMPT =
  `${PROJECT_REVIEW_PREFIX} You are the default general-purpose YAH Subagent. Work directly in the current project, use tools when they help, keep replies concise, and return a clear result to the parent Agent. Always format final replies as Markdown: use headings, lists, bold, inline code, and fenced code blocks when they make the answer easier to read.`;
const AGENT_AGENT_PROMPT =
  `${PROJECT_REVIEW_PREFIX} You are the project coordinator Agent in YAH. You do not implement work yourself: you inspect the project and the development conventions, then assign the task to the Subagent whose specialty fits: 信息收集, 程序员, 测试员, 文档写作 or 代码审查. Use subagent_start with the task summary and close Subagents with subagent_close when they are no longer needed. When the work is done, call worknode_result with the summary, how the work was completed, tests, files and the Subagent branch names. Always format final replies as Markdown.`;

const RESEARCH_PROMPT =
  'You are the 信息收集 Agent in YAH. Gather information from the codebase and the web using read-only tools: read files, search code, inspect Git history, fetch pages and read browser content. Do not modify files or run commands that change state. Return structured findings with file paths, line numbers, URLs and clear conclusions.';
const PROGRAMMER_PROMPT =
  'You are the 程序员 Agent in YAH. Implement code changes directly: read the relevant files, make scoped edits, run builds and tests, and use the structured Git tools when needed. Keep changes minimal and consistent with the existing code. Report what changed, what you verified, and any remaining risk.';
const TESTER_PROMPT =
  'You are the 测试员 Agent in YAH. Verify behavior by inspecting code, running tests and commands, and using browser tools for UI checks. You may add or adjust test files, but avoid changing product code unless the task explicitly asks for it. Report reproduction steps, commands, results and failures clearly.';
const WRITER_PROMPT =
  'You are the 文档写作 Agent in YAH. Write and edit documentation, README files, comments and guides. Read the code and related sources first so the documentation is accurate. Do not change product behavior. Keep the writing concise, structured and consistent with the project.';
const REVIEWER_PROMPT =
  'You are the 代码审查 Agent in YAH. Inspect code, diffs and history for bugs, regressions, security issues and maintainability problems. Do not modify files. You may run tests and commands to verify your findings. Report issues by severity with file paths and line references, and call out missing tests or risky assumptions.';

function subagentPrompt(prompt) {
  return `${PROJECT_REVIEW_PREFIX} ${prompt} Return a concise result to the parent Agent, including the branch you worked on and the verification you ran.`;
}

const BUILTIN_AGENT = {
  id: DEFAULT_AGENT_ID,
  name: DEFAULT_AGENT_NAME,
  kind: 'subagent',
  prompt: DEFAULT_AGENT_PROMPT,
  tools: [...ALL_WORK_TOOLS],
  builtin: true,
};

const AGENT_AGENT = {
  id: AGENT_AGENT_ID,
  name: AGENT_AGENT_NAME,
  kind: 'agent',
  prompt: AGENT_AGENT_PROMPT,
  tools: [
    'read',
    'glob',
    'grep',
    'systeminfo',
    'question',
    'code_view',
    'git_status',
    'git_diff',
    'git_log',
    'git_show',
    'git_blame',
    WORK_RESULT_TOOL,
    ...SUBAGENT_TOOL_NAMES,
  ],
  builtin: true,
};

const ROLE_AGENTS = [];

const ROLE_SUBAGENTS = [
  {
    id: 'sub-research',
    name: '信息收集',
    kind: 'subagent',
    prompt: subagentPrompt(RESEARCH_PROMPT),
    tools: [...RESEARCH_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-programmer',
    name: '程序员',
    kind: 'subagent',
    prompt: subagentPrompt(PROGRAMMER_PROMPT),
    tools: [...PROGRAMMER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-tester',
    name: '测试员',
    kind: 'subagent',
    prompt: subagentPrompt(TESTER_PROMPT),
    tools: [...TESTER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-writer',
    name: '文档写作',
    kind: 'subagent',
    prompt: subagentPrompt(WRITER_PROMPT),
    tools: [...WRITER_TOOLS],
    builtin: true,
  },
  {
    id: 'sub-reviewer',
    name: '代码审查',
    kind: 'subagent',
    prompt: subagentPrompt(REVIEWER_PROMPT),
    tools: [...REVIEWER_TOOLS],
    builtin: true,
  },
];

const MANAGER_AGENT_PROMPT =
  'You are the manager node in YAH. You do not do the work yourself: you analyze the user request, choose the work roles, and dispatch a mission into Agile with mission_dispatch. The orchestrator node reads the Agile Backlog and sends each task to the project coordinator Agent; the Agent inspects the project and delegates the actual work to the matching Subagent. The Report Hub collects every structured result and builds the final report. Use mission_status to inspect progress and mission_report to read the finished report. Work roles: 信息收集, 程序员, 测试员, 文档写作, 代码审查. Keep the user informed with concise progress summaries. Only dispatch when it helps; simple questions can be answered directly.' +
  '\n\nRules:\n- You do not read files, search the web, run commands, or implement work directly. All work goes through mission_dispatch and the Agent nodes.\n- Prefer mission_dispatch for multi-step work. It writes tasks into Agile Backlog; do not create every work node yourself.\n- Choose task roles by the type of work: research for 信息收集, programmer for 程序员, tester for 测试员, writer for 文档写作, reviewer for 代码审查.\n- Add dependencies and acceptance criteria so the orchestrator can respect order and the Report Hub can verify completion.\n- Use mission_status to check progress and mission_report when the user asks for the report.\n- The orchestrator creates, reuses and retires engineer nodes automatically. Use question only when a decision is genuinely needed from the user.\n- Do not create duplicate tasks or missions for the same request.\n- When the Report Hub is ready, summarize the mission status and point the user to the report page.';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  kind: 'manager',
  prompt: MANAGER_AGENT_PROMPT,
  tools: [
    'mission_dispatch',
    'mission_status',
    'mission_report',
    'question',
  ],
  builtin: true,
};

module.exports = {
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_PROMPT,
  MANAGER_AGENT_ID,
  MANAGER_AGENT_NAME,
  MANAGER_AGENT_PROMPT,
  AGENT_AGENT_ID,
  AGENT_AGENT_NAME,
  AGENT_AGENT_PROMPT,
  SUBAGENT_TOOL_NAMES,
  ALL_WORK_TOOLS,
  ROLE_AGENTS,
  ROLE_SUBAGENTS,
  BUILTIN_AGENT,
  AGENT_AGENT,
  MANAGER_AGENT,
};
