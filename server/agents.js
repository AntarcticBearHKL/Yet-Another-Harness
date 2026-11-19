'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  MANAGER_AGENT,
  ROLE_SUBAGENTS,
  DEFAULT_AGENT_ID,
  DEFAULT_WORKER_AGENT_ID,
} = require('../src/agent-defaults');

function cloneAgent(agent) {
  return {
    ...agent,
    tools: Array.isArray(agent.tools) ? [...agent.tools] : agent.tools,
    builtin: true,
  };
}

function builtinAgents() {
  return [MANAGER_AGENT, ...ROLE_SUBAGENTS].map(cloneAgent);
}

function loadAgents() {
  return builtinAgents();
}

function saveAgents(file) {
  const agents = builtinAgents();
  const payload = agents.map(({ builtin, ...agent }) => agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ agents: payload }, null, 2),
    'utf8'
  );
  fs.renameSync(temp, file);
  return builtinAgents();
}

function getAgent(file, id) {
  const key = String(id || '').trim();
  const agents = builtinAgents();
  if (!key) {
    return agents.find((agent) => agent.id === DEFAULT_AGENT_ID) || agents[0];
  }
  return (
    agents.find((agent) => agent.id === key) ||
    agents.find((agent) => agent.name === key) ||
    agents.find(
      (agent) => agent.name.toLowerCase() === key.toLowerCase()
    ) ||
    null
  );
}

function getSubagent(file, id) {
  const key = String(id || '').trim();
  const agents = builtinAgents();
  if (!key) {
    return agents.find((agent) => agent.id === DEFAULT_WORKER_AGENT_ID) || null;
  }
  const byId = agents.find((agent) => agent.id === key);
  if (byId) return byId;
  return (
    agents.find(
      (agent) =>
        agent.kind === 'subagent' &&
        (agent.name === key ||
          agent.name.toLowerCase() === key.toLowerCase())
    ) || null
  );
}

module.exports = {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKER_AGENT_ID,
  loadAgents,
  saveAgents,
  getAgent,
  getSubagent,
};
