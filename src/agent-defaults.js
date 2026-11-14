'use strict';

const DEFAULT_AGENT_ID = 'basic';
const DEFAULT_AGENT_NAME = '基础 Agent';
const DEFAULT_AGENT_PROMPT =
  'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous.';

const BUILTIN_AGENT = {
  id: DEFAULT_AGENT_ID,
  name: DEFAULT_AGENT_NAME,
  prompt: DEFAULT_AGENT_PROMPT,
  tools: null,
  builtin: true,
};

module.exports = {
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_PROMPT,
  BUILTIN_AGENT,
};
