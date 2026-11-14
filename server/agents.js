'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  DEFAULT_AGENT_ID,
  BUILTIN_AGENT,
  LEGACY_BUILTIN_PROMPTS,
} = require('../src/agent-defaults');

const MAX_AGENTS = 50;
const MAX_NAME = 80;
const MAX_PROMPT = 20_000;
const MAX_TOOLS = 200;

const TOOL_ALIASES = {
  web_search: 'websearch',
};

function normalizeTools(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const tools = [];
  for (const item of raw) {
    const rawName = String(item || '').trim();
    const name = TOOL_ALIASES[rawName] || rawName;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tools.push(name);
    if (tools.length >= MAX_TOOLS) break;
  }
  return tools;
}

function normalizeAgent(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || crypto.randomUUID()).trim();
  if (!id) return null;
  const fallbackName = `Agent ${index + 1}`;
  const name =
    String(raw.name || fallbackName).trim().slice(0, MAX_NAME) || fallbackName;
  const prompt = String(raw.prompt || '').slice(0, MAX_PROMPT);
  return {
    id,
    name,
    prompt,
    tools: normalizeTools(raw.tools),
  };
}

function normalizeAgents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const agents = [];
  for (const [index, item] of list.entries()) {
    const agent = normalizeAgent(item, index);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    agents.push(agent);
    if (agents.length >= MAX_AGENTS) break;
  }
  return agents;
}

function builtinAgent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const prompt = String(source.prompt || '');
  const useDefaultPrompt =
    !prompt.trim() || LEGACY_BUILTIN_PROMPTS.includes(prompt.trim());
  return {
    ...BUILTIN_AGENT,
    ...source,
    id: DEFAULT_AGENT_ID,
    prompt: useDefaultPrompt ? BUILTIN_AGENT.prompt : prompt,
    builtin: true,
  };
}

function loadAgents(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const normalized = normalizeAgents(data?.agents);
    const stored = normalized.find(
      (agent) => agent.id === DEFAULT_AGENT_ID
    );
    const custom = normalized.filter(
      (agent) => agent.id !== DEFAULT_AGENT_ID
    );
    return [builtinAgent(stored), ...custom];
  } catch {
    return [BUILTIN_AGENT];
  }
}

function saveAgents(file, agents) {
  const normalized = normalizeAgents(agents);
  const stored = normalized.find((agent) => agent.id === DEFAULT_AGENT_ID);
  const custom = normalized.filter(
    (agent) => agent.id !== DEFAULT_AGENT_ID
  );
  const output = [builtinAgent(stored), ...custom];
  const payload = output.map(({ builtin, ...agent }) => agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ agents: payload }, null, 2),
    'utf8'
  );
  fs.renameSync(temp, file);
  return output;
}

function getAgent(file, id) {
  const key = String(id || '').trim();
  if (!key || key === DEFAULT_AGENT_ID) {
    return loadAgents(file)[0] || BUILTIN_AGENT;
  }
  return loadAgents(file).find((agent) => agent.id === key) || null;
}

module.exports = {
  BUILTIN_AGENT,
  DEFAULT_AGENT_ID,
  normalizeAgents,
  loadAgents,
  saveAgents,
  getAgent,
};
