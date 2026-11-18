'use strict';

const crypto = require('node:crypto');
const store = require('../store');
const { mergedDefinitions } = require('./definitions');
const { DEFAULT_SYSTEM_PROMPT } = store;
const { AGENT_AGENT_ID } = require('../agent-defaults');

let providers = {
  canvasStore: null,
  runner: null,
  listAgents: null,
  getAgent: null,
  skillService: null,
  mcpManager: null,
  notify: null,
};

const WORKNODE_WIDTH = 300;
const WORKNODE_HEIGHT = 220;
const MANAGER_WIDTH = 300;
const MANAGER_HEIGHT = 150;
const WORKNODE_GAP_X = 36;
const WORKNODE_GAP_Y = 34;
const WORKNODE_COLUMNS = 2;
const WORKNODE_TOOL_PREFIX = 'worknode_';

function configure(next = {}) {
  providers = { ...providers, ...next };
}

function error(message) {
  return `tool error: ${message}`;
}

function asText(value) {
  return String(value ?? '').trim();
}

function normalizeId(value) {
  return asText(value);
}

function managerFor(context) {
  const sessionId = normalizeId(context?.sessionId);
  if (!sessionId) return null;
  const session = store.getSession(sessionId);
  if (!session || session.nodeRole !== 'manager') return null;
  return session;
}

function workNodeFor(manager, id) {
  const session = store.getSession(normalizeId(id));
  if (!session || session.managerId !== manager.id) return null;
  return session;
}

function isRunning(sessionId) {
  return Boolean(providers.runner?.activeRunForSession?.(sessionId));
}

function nodeStatus(session) {
  if (!session) return 'missing';
  if (isRunning(session.id)) return 'running';
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  const last = messages[messages.length - 1];
  if (!last) return 'idle';
  if (last.role === 'User') return 'waiting';
  if (last.role === 'Agent') {
    if (last.error) return 'error';
    return String(last.text || '').trim() ? 'done' : 'idle';
  }
  return 'idle';
}

function toolDefinitions() {
  return mergedDefinitions().map((definition) => {
    const fn = definition.function || {};
    return {
      name: String(fn.name || ''),
      description: String(fn.description || '').slice(0, 220),
    };
  });
}

function allMcpServers() {
  try {
    const servers = providers.mcpManager?.allServers?.();
    if (Array.isArray(servers)) return servers;
  } catch {
    /* ignore */
  }
  return [];
}

function mcpDisabledFor(selected) {
  if (!Array.isArray(selected)) return null;
  const wanted = new Set(selected.map(String));
  return allMcpServers()
    .map((server) => String(server.id || server.name || ''))
    .filter(Boolean)
    .filter((id) => !wanted.has(id));
}

function isManagerAgent(agent) {
  return Array.isArray(agent?.tools) && agent.tools.some((name) => String(name).startsWith(WORKNODE_TOOL_PREFIX));
}

function resolveAgent(agentId) {
  const id = normalizeId(agentId);
  if (!id) return null;
  const agent = providers.getAgent?.(id);
  return agent && agent.id ? agent : null;
}

function normalizeToolsForAgent(agent, requested) {
  const allNames = toolDefinitions()
    .map((tool) => tool.name)
    .filter(Boolean)
    .filter((name) => !name.startsWith(WORKNODE_TOOL_PREFIX));
  const agentAllowed = Array.isArray(agent.tools)
    ? agent.tools.map(String)
    : null;
  const base = agentAllowed
    ? allNames.filter((name) => agentAllowed.includes(name))
    : allNames;
  if (!Array.isArray(requested)) return base;
  const wanted = new Set(requested.map(String));
  return base.filter((name) => wanted.has(name));
}

function normalizeSkills(requested) {
  if (!Array.isArray(requested)) return null;
  const available = new Set(
    (providers.skillService?.list?.({}) || []).map((skill) => String(skill.id))
  );
  return [...new Set(requested.map(String))].filter((id) => available.has(id));
}

function managerDirectories(manager) {
  const config = manager.nodeConfig || {};
  return Array.isArray(config.directories) ? config.directories : [];
}

function managerFiles(manager) {
  const config = manager.nodeConfig || {};
  return Array.isArray(config.files) ? config.files : [];
}

function canvasState() {
  try {
    const state = providers.canvasStore?.state?.();
    if (!state || typeof state !== 'object') return null;
    if (!state.nodes || typeof state.nodes !== 'object') state.nodes = {};
    return state;
  } catch {
    return null;
  }
}

function overlaps(left, right) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function freeWorkNodePosition(state, startX, startY, width, height) {
  const others = Object.entries(state.nodes || {})
    .filter(([, node]) => node && typeof node === 'object')
    .map(([, node]) => ({
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      width: Number(node.width) || WORKNODE_WIDTH,
      height: Number(node.height) || WORKNODE_HEIGHT,
    }));
  let x = startX;
  let y = startY;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = { x, y, width, height };
    if (!others.some((other) => overlaps(candidate, other))) {
      return { x, y };
    }
    y += 40;
  }
  return { x, y };
}

function placeWorkNode(manager, workNode, { reposition = false } = {}) {
  if (!providers.canvasStore) return null;
  const state = canvasState();
  if (!state) return null;
  if (state.nodes[workNode.id] && !reposition) {
    return state.nodes[workNode.id];
  }
  const managerNode = state.nodes[manager.id] || {
    x: 80,
    y: 80,
    width: MANAGER_WIDTH,
    height: MANAGER_HEIGHT,
  };
  const siblings = store.listWorkNodes(manager.id);
  const index = Math.max(0, siblings.length - 1);
  const column = index % WORKNODE_COLUMNS;
  const row = Math.floor(index / WORKNODE_COLUMNS);
  const startX =
    (Number(managerNode.x) || 0) +
    column * (WORKNODE_WIDTH + WORKNODE_GAP_X);
  const startY =
    (Number(managerNode.y) || 0) +
    (Number(managerNode.height) || MANAGER_HEIGHT) +
    WORKNODE_GAP_Y +
    row * (WORKNODE_HEIGHT + WORKNODE_GAP_Y);
  const spot = freeWorkNodePosition(
    state,
    startX,
    startY,
    WORKNODE_WIDTH,
    WORKNODE_HEIGHT
  );
  const node = {
    x: spot.x,
    y: spot.y,
    width: WORKNODE_WIDTH,
    height: WORKNODE_HEIGHT,
    parentSessionId: null,
  };
  state.nodes[workNode.id] = node;
  state.frames = [];
  providers.canvasStore.save(state);
  return node;
}

function ensureCanvasNode(manager, workNode) {
  return placeWorkNode(manager, workNode);
}

function notify(payload = {}) {
  try {
    providers.notify?.({
      type: 'worknodes.changed',
      ...payload,
    });
  } catch {
    /* ignore notification failures */
  }
}

async function startWorkNode(workNode, task) {
  const text = asText(task);
  if (!text) return { started: false, error: 'task is empty' };
  if (isRunning(workNode.id)) {
    return { started: false, error: 'work node is already running' };
  }
  const agent = resolveAgent(workNode.agentId);
  if (!agent) {
    return { started: false, error: `agent not found: ${workNode.agentId}` };
  }
  let skillsText = '';
  const skillIds = Array.isArray(workNode.nodeConfig?.skills)
    ? workNode.nodeConfig.skills
    : [];
  if (skillIds.length > 0) {
    try {
      const resolved = providers.skillService?.resolveMany
        ? await providers.skillService.resolveMany(
            skillIds.map((id) => ({ id })),
            workNode.mcpDisabled || []
          )
        : null;
      skillsText = String(resolved?.text || '');
    } catch (skillError) {
      console.error('work node skill resolve failed', skillError);
    }
  }
  try {
    providers.runner.startRun({
      sessionId: workNode.id,
      text,
      runId: crypto.randomUUID(),
      skillsText,
      agentConfig: agent,
      reasoningEffort: store.loadSettings().reasoningEffort,
    });
    return { started: true };
  } catch (runError) {
    return { started: false, error: runError.message || String(runError) };
  }
}

async function worknodeCreate(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can create work nodes');
  const title = asText(args.title) || 'Work node';
  const task = asText(args.task);
  const agent = resolveAgent(args.agentId || AGENT_AGENT_ID);
  if (!agent) {
    return error(
      `agent not found: ${args.agentId || AGENT_AGENT_ID}. Choose an Agent profile.`
    );
  }
  if (agent.kind !== 'agent') {
    return error('work nodes require an Agent profile');
  }
  if (isManagerAgent(agent)) {
    return error('manager Agents cannot run as work nodes');
  }
  const tools = normalizeToolsForAgent(agent, args.tools);
  const skills = normalizeSkills(args.skills);
  const mcpDisabled = mcpDisabledFor(args.mcp) || [];
  const nodeConfig = {
    kind: 'work',
    directories: managerDirectories(manager),
    files: managerFiles(manager),
    task,
    tools,
    skills,
    mcp: Array.isArray(args.mcp) ? args.mcp.map(String) : null,
  };
  const id = crypto.randomUUID();
  store.createSession({
    id,
    title: title.slice(0, 120),
    system: DEFAULT_SYSTEM_PROMPT,
    agentId: agent.id,
    projectId: manager.projectId,
    nodeRole: 'work',
    managerId: manager.id,
    nodeConfig,
    mcpDisabled: mcpDisabled || [],
    pendingQueue: [],
  });
  const workNode = store.getSession(id);
  try {
    ensureCanvasNode(manager, workNode);
  } catch (canvasError) {
    console.error('work node canvas placement failed', canvasError);
  }
  let started = null;
  if (args.start !== false && task) {
    started = await startWorkNode(workNode, task);
  }
  notify({ managerId: manager.id, nodeId: id });
  return JSON.stringify(
    {
      ok: true,
      id,
      title: workNode.title,
      agent: agent.name,
      tools: tools.length,
      skills: Array.isArray(skills) ? skills.length : null,
      mcpDisabled: mcpDisabled || [],
      status: nodeStatus(store.getSession(id)),
      started,
    },
    null,
    2
  );
}

function worknodeClose(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can close work nodes');
  const workNode = workNodeFor(manager, args.id);
  if (!workNode) return error(`work node not found: ${args.id || '(missing)'}`);

  const ids = store.sessionSubtreeIds(workNode.id);
  const stoppedIds = [];
  for (const id of ids) {
    const runId = providers.runner?.activeRunForSession?.(id);
    if (runId && providers.runner?.cancelRun?.(runId)) stoppedIds.push(id);
  }
  for (const id of ids) {
    store.archiveSession(id, 'closed');
  }

  try {
    const state = canvasState();
    if (state?.nodes) {
      let removed = false;
      for (const id of ids) {
        if (state.nodes[id]) {
          delete state.nodes[id];
          removed = true;
        }
      }
      if (removed) providers.canvasStore.save(state);
    }
  } catch (canvasError) {
    console.error('work node canvas removal failed', canvasError);
  }

  notify({ managerId: manager.id, nodeId: workNode.id });
  return JSON.stringify(
    {
      ok: true,
      id: workNode.id,
      title: workNode.title,
      closed: true,
      stopped: stoppedIds.length > 0,
      stoppedIds,
    },
    null,
    2
  );
}

module.exports = {
  configure,
  worknodeCreate,
  worknodeClose,
};
