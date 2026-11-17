'use strict';

const DEFAULT_AGENT_ID = 'basic';
const DEFAULT_AGENT_NAME = 'Build';
const MANAGER_AGENT_ID = 'manager';
const MANAGER_AGENT_NAME = 'Manager';
const DEFAULT_AGENT_PROMPT =
  'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous. Always format final replies as Markdown: use headings, lists, bold, inline code, and fenced code blocks when they make the answer easier to read.';
const LEGACY_BUILTIN_PROMPTS = [
  'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous.',
];

const BUILTIN_AGENT = {
  id: DEFAULT_AGENT_ID,
  name: DEFAULT_AGENT_NAME,
  prompt: DEFAULT_AGENT_PROMPT,
  tools: null,
  builtin: true,
};

const MANAGER_AGENT_PROMPT =
  'You are the manager node in YAH. You do not do the work yourself: you analyze the user request, split it into independent work nodes, choose the best Agent for each work node, give each one a concrete task, and monitor progress. Use worknode_options to see available Agents, tools, skills, MCP servers and unowned conversations. Use worknode_create to create and optionally start a work node, or worknode_adopt to take an existing conversation into your team. Use worknode_status and worknode_read to check progress and results, worknode_message to send a follow-up, worknode_stop to stop one, and team_layout to arrange the canvas. Keep the user informed with concise progress summaries. Only delegate when it helps; simple questions can be answered directly.' +
  '\n\nRules:\n- A work node always runs with an Agent. The Agent is the permission upper bound.\n- You may narrow a work node to a subset of the chosen Agent tools, skills or MCP servers, but never grant beyond it.\n- Work nodes share the manager working directories. Keep tasks scoped to those directories.\n- Do not create duplicate work nodes for the same task.\n- When all work nodes finish, summarize what was produced and what still needs attention.';

const MANAGER_AGENT = {
  id: MANAGER_AGENT_ID,
  name: MANAGER_AGENT_NAME,
  prompt: MANAGER_AGENT_PROMPT,
  tools: [
    'worknode_options',
    'worknode_list',
    'worknode_create',
    'worknode_adopt',
    'worknode_update',
    'worknode_start',
    'worknode_status',
    'worknode_read',
    'worknode_message',
    'worknode_stop',
    'team_layout',
    'question',
    'read',
    'glob',
    'grep',
    'skill',
    'websearch',
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
  LEGACY_BUILTIN_PROMPTS,
  BUILTIN_AGENT,
  MANAGER_AGENT,
};
