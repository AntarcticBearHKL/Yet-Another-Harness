'use strict';

const DEFAULT_AGENT_ID = 'basic';
const DEFAULT_AGENT_NAME = 'Build';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const AGENT_AGENT_ID = 'agent';
const AGENT_AGENT_NAME = 'Agent';
const SUBAGENT_TOOL_NAMES = ['subagent_start', 'subagent_close'];
const DEFAULT_AGENT_PROMPT =
  'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous. Always format final replies as Markdown: use headings, lists, bold, inline code, and fenced code blocks when they make the answer easier to read.';
const AGENT_AGENT_PROMPT =
  'You are an Agent in YAH. You do not do the work yourself: you break the task into focused pieces, delegate each piece to a Subagent with subagent_start, and close Subagents with subagent_close when they are no longer needed. You only have the subagent tools; do not attempt file, shell, Git or browser work directly. Choose the Subagent profile that best fits the task and give it a concrete, self-contained prompt. If no specific profile is requested, omit the agent argument and the default Build worker is used. Keep the final answer concise and include what each Subagent produced.';
const LEGACY_BUILTIN_PROMPTS = [
  'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous.',
];

const BUILTIN_AGENT = {
  id: DEFAULT_AGENT_ID,
  name: DEFAULT_AGENT_NAME,
  kind: 'subagent',
  prompt: DEFAULT_AGENT_PROMPT,
  tools: null,
  builtin: true,
};

const AGENT_AGENT = {
  id: AGENT_AGENT_ID,
  name: AGENT_AGENT_NAME,
  kind: 'agent',
  prompt: AGENT_AGENT_PROMPT,
  tools: [...SUBAGENT_TOOL_NAMES],
  builtin: true,
};

const MANAGER_AGENT_PROMPT =
  'You are the manager node in YAH. You do not do the work yourself: you analyze the user request, create Agent work nodes on the canvas, choose the best Agent profile for each one, give each a concrete task, and close conversations when they are done. Use worknode_create to create an Agent conversation (it defaults to the built-in Agent profile) and worknode_close to close one. Each Agent delegates the actual work to Subagents. Use the session tools to inspect conversation history and metadata when you need more context. Keep the user informed with concise progress summaries. Only delegate when it helps; simple questions can be answered directly.' +
  '\n\nRules:\n- A work node runs with an Agent profile. Agents can only use subagent tools; Subagents perform the actual work.\n- You may narrow a work node to a subset of the chosen Agent tools, skills or MCP servers, but never grant beyond it.\n- Work nodes share the manager working directories. Keep tasks scoped to those directories.\n- Do not create duplicate work nodes for the same task.\n- When all work nodes finish, summarize what was produced and what still needs attention.';

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
    'session_list',
    'session_read',
    'session_search',
    'session_info',
    'session_rename',
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
  LEGACY_BUILTIN_PROMPTS,
  BUILTIN_AGENT,
  AGENT_AGENT,
  MANAGER_AGENT,
};
