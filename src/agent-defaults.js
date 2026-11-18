'use strict';

const DEFAULT_AGENT_ID = 'basic';
const DEFAULT_AGENT_NAME = 'Build';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const AGENT_AGENT_ID = 'agent';
const AGENT_AGENT_NAME = '通用';
const SUBAGENT_TOOL_NAMES = ['subagent_start', 'subagent_close'];

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
  'You are the default general-purpose YAH Subagent. Work directly in the current project, use tools when they help, keep replies concise, and return a clear result to the parent Agent. Always format final replies as Markdown: use headings, lists, bold, inline code, and fenced code blocks when they make the answer easier to read.';
const AGENT_AGENT_PROMPT =
  'You are the general Agent in YAH. Work directly in the current project with the full work toolset, and keep replies concise. You may delegate focused parts of the task to Subagents with subagent_start and close them with subagent_close when they are no longer needed. Choose the Subagent profile that best fits each delegated piece and give it a concrete, self-contained prompt. Always format final replies as Markdown: use headings, lists, bold, inline code, and fenced code blocks when they make the answer easier to read.';

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

function agentPrompt(prompt) {
  return `${prompt} You may delegate focused subtasks to Subagents with subagent_start and close them with subagent_close when they are no longer needed.`;
}

function subagentPrompt(prompt) {
  return `${prompt} Return a concise result to the parent Agent.`;
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
  tools: [...ALL_WORK_TOOLS, ...SUBAGENT_TOOL_NAMES],
  builtin: true,
};

const ROLE_AGENTS = [
  {
    id: 'research',
    name: '信息收集',
    kind: 'agent',
    prompt: agentPrompt(RESEARCH_PROMPT),
    tools: [...RESEARCH_TOOLS, ...SUBAGENT_TOOL_NAMES],
    builtin: true,
  },
  {
    id: 'programmer',
    name: '程序员',
    kind: 'agent',
    prompt: agentPrompt(PROGRAMMER_PROMPT),
    tools: [...PROGRAMMER_TOOLS, ...SUBAGENT_TOOL_NAMES],
    builtin: true,
  },
  {
    id: 'tester',
    name: '测试员',
    kind: 'agent',
    prompt: agentPrompt(TESTER_PROMPT),
    tools: [...TESTER_TOOLS, ...SUBAGENT_TOOL_NAMES],
    builtin: true,
  },
  {
    id: 'writer',
    name: '文档写作',
    kind: 'agent',
    prompt: agentPrompt(WRITER_PROMPT),
    tools: [...WRITER_TOOLS, ...SUBAGENT_TOOL_NAMES],
    builtin: true,
  },
  {
    id: 'reviewer',
    name: '代码审查',
    kind: 'agent',
    prompt: agentPrompt(REVIEWER_PROMPT),
    tools: [...REVIEWER_TOOLS, ...SUBAGENT_TOOL_NAMES],
    builtin: true,
  },
];

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
  'You are the manager node in YAH. You analyze the user request, choose the Agent profile that best matches the work, create Agent work nodes on the canvas, give each a concrete task, and close conversations when they are done. Use worknode_create to create an Agent conversation and worknode_close to close one. Available Agent profiles: 通用 (full work toolset), 信息收集, 程序员, 测试员, 文档写作, 代码审查. Agents work directly with their role tools and may delegate focused parts to Subagents. Use the Agile tools to plan and track work when the request calls for it. Keep the user informed with concise progress summaries. Only delegate when it helps; simple questions can be answered directly.' +
  '\n\nRules:\n- Choose the Agent profile by the type of work, not by convenience. Use 信息收集 for research, 程序员 for implementation, 测试员 for verification, 文档写作 for documentation and 代码审查 for review.\n- A work node runs with one Agent profile. Do not assign an Agent profile to a Subagent-only task.\n- You may narrow a work node to a subset of the chosen Agent tools, skills or MCP servers, but never grant beyond it.\n- Work nodes share the manager working directories. Keep tasks scoped to those directories.\n- Do not create duplicate work nodes for the same task.\n- When all work nodes finish, summarize what was produced and what still needs attention.';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  kind: 'manager',
  prompt: MANAGER_AGENT_PROMPT,
  tools: [
    'worknode_create',
    'worknode_close',
    'agile_list_boards',
    'agile_get_board',
    'agile_create_board',
    'agile_delete_board',
    'agile_list_tasks',
    'agile_get_task',
    'agile_create_task',
    'agile_create_tasks',
    'agile_update_task',
    'agile_move_task',
    'agile_move_tasks',
    'agile_delete_task',
    'agile_set_blocked_reason',
    'agile_claim_task',
    'agile_release_task',
    'agile_heartbeat_task',
    'agile_claim_next',
    'agile_digest_notes',
    'agile_undigest_notes',
    'agile_list_columns',
    'agile_get_board_snapshot',
    'agile_list_events',
    'agile_wait_for_event',
    'agile_list_roadmap',
    'agile_list_skills',
    'agile_get_skill',
    'agile_create_skill',
    'agile_update_skill',
    'agile_delete_skill',
    'question',
    'read',
    'glob',
    'grep',
    'systeminfo',
    'websearch',
    'webfetch',
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
