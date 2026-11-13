'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_AGENTS = 50;
const MAX_NAME = 80;
const MAX_PROMPT = 20_000;
const MAX_TOOLS = 200;

function normalizeTools(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const tools = [];
  for (const item of raw) {
    const name = String(item || '').trim();
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

function loadAgents(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeAgents(data?.agents);
  } catch {
    return [];
  }
}

function saveAgents(file, agents) {
  const normalized = normalizeAgents(agents);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ agents: normalized }, null, 2),
    'utf8'
  );
  fs.renameSync(temp, file);
  return normalized;
}

function getAgent(file, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return loadAgents(file).find((agent) => agent.id === key) || null;
}

module.exports = {
  normalizeAgents,
  loadAgents,
  saveAgents,
  getAgent,
};
