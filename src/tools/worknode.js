'use strict';

const crypto = require('node:crypto');
const store = require('../store');
const { mergedDefinitions } = require('./definitions');
const { DEFAULT_SYSTEM_PROMPT } = store;

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
const WORKNODE_ORCHESTRATION_TOOL = 'team_layout';

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

function preview(value, limit = 220) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
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

function lastAgentText(session) {
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'Agent') {
      return String(messages[index].text || '');
    }
  }
  return '';
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
    .filter(
      (name) =>
        !name.startsWith(WORKNODE_TOOL_PREFIX) &&
        name !== WORKNODE_ORCHESTRATION_TOOL
    );
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

function worknodeOptions() {
  const agents = (providers.listAgents?.() || [])
    .filter((agent) => !isManagerAgent(agent))
    .map((agent) => ({
    id: agent.id,
    name: agent.name,
    tools: Array.isArray(agent.tools) ? agent.tools : null,
  }));
  const tools = toolDefinitions().filter(
    (tool) =>
      tool.name &&
      !tool.name.startsWith(WORKNODE_TOOL_PREFIX) &&
      tool.name !== WORKNODE_ORCHESTRATION_TOOL
  );
  const skills = (providers.skillService?.list?.({}) || []).map((skill) => ({
    id: skill.id,
    name: skill.name,
    source: skill.source || '',
    sourceKind: skill.sourceKind || '',
  }));
  const mcp = allMcpServers().map((server) => ({
    id: server.id || server.name,
    name: server.name || server.id,
    enabled: server.enabled !== false,
    status: server.status || '',
  }));
  const availableWorknodes = store
    .loadChats()
    .sessions.filter(
      (session) =>
        session.nodeRole !== 'manager' &&
        !session.subagent &&
        !session.managerId &&
        !session.archivedAt
    )
    .slice(0, 100)
    .map((session) => ({
      id: session.id,
      title: session.title,
      agent: session.agentId,
      projectId: session.projectId,
    }));
  return JSON.stringify(
    { agents, tools, skills, mcp, availableWorknodes },
    null,
    2
  );
}

function worknodeList(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can list work nodes');
  const includeArchived = args.includeArchived === true;
  const sessions = store.listWorkNodes(manager.id).filter(
    (session) => includeArchived || !session.archivedAt
  );
  return JSON.stringify(
    sessions.map((session) => ({
      id: session.id,
      title: session.title,
      agent: session.agentId,
      task: session.nodeConfig?.task || '',
      status: nodeStatus(session),
      running: isRunning(session.id),
      archived: Boolean(session.archivedAt),
      lastOutput: preview(lastAgentText(session)),
    })),
    null,
    2
  );
}

async function worknodeCreate(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can create work nodes');
  const title = asText(args.title) || 'Work node';
  const task = asText(args.task);
  const agent = resolveAgent(args.agentId);
  if (!agent) {
    return error(
      `agent not found: ${args.agentId || '(missing)'}. Call worknode_options first.`
    );
  }
  if (isManagerAgent(agent)) {
    return error('manager Agents cannot run as work nodes');
  }
  const tools = normalizeToolsForAgent(agent, args.tools);
  const skills = normalizeSkills(args.skills);
  const mcpDisabled = mcpDisabledFor(args.mcp);
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

function worknodeAdopt(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can adopt work nodes');
  const id = normalizeId(args.id);
  const session = store.getSession(id);
  if (!session) return error(`conversation not found: ${id || '(missing)'}`);
  if (session.nodeRole === 'manager' || session.subagent) {
    return error('only a root conversation can become a work node');
  }
  if (session.archivedAt) return error('archived conversations cannot be adopted');
  if (session.managerId && session.managerId !== manager.id) {
    return error('conversation already belongs to another manager');
  }
  if (session.managerId === manager.id) {
    return JSON.stringify({ ok: true, id, alreadyOwned: true }, null, 2);
  }
  const prior = session.nodeConfig || {};
  const lastUser = (Array.isArray(session.msgs) ? session.msgs : [])
    .filter((message) => message.role === 'User')
    .at(-1);
  store.updateSessionNode(id, {
    nodeRole: 'work',
    managerId: manager.id,
    nodeConfig: {
      ...prior,
      kind: 'work',
      directories: managerDirectories(manager),
      files: managerFiles(manager),
      task: prior.task || String(lastUser?.text || '').slice(0, 4000),
      tools: Array.isArray(prior.tools) ? prior.tools : null,
      skills: Array.isArray(prior.skills) ? prior.skills : null,
      mcp: Array.isArray(prior.mcp) ? prior.mcp : null,
    },
  });
  const workNode = store.getSession(id);
  try {
    placeWorkNode(manager, workNode, { reposition: true });
  } catch (canvasError) {
    console.error('adopt canvas placement failed', canvasError);
  }
  notify({ managerId: manager.id, nodeId: id });
  return JSON.stringify(
    {
      ok: true,
      id,
      title: workNode.title,
      agent: workNode.agentId,
      status: nodeStatus(workNode),
    },
    null,
    2
  );
}

function worknodeUpdate(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can update work nodes');
  const workNode = workNodeFor(manager, args.id);
  if (!workNode) return error(`work node not found: ${args.id || '(missing)'}`);
  if (isRunning(workNode.id)) {
    return error('work node is running; stop it before changing its assignment');
  }
  const nextAgent = args.agentId ? resolveAgent(args.agentId) : resolveAgent(workNode.agentId);
  if (!nextAgent) return error(`agent not found: ${args.agentId}`);
  if (isManagerAgent(nextAgent)) {
    return error('manager Agents cannot run as work nodes');
  }
  const nextConfig = {
    ...(workNode.nodeConfig || {}),
    kind: 'work',
    directories: managerDirectories(manager),
    files: managerFiles(manager),
  };
  if (args.task !== undefined) nextConfig.task = asText(args.task);
  if (args.tools !== undefined) {
    nextConfig.tools = normalizeToolsForAgent(nextAgent, args.tools);
  }
  if (args.skills !== undefined) nextConfig.skills = normalizeSkills(args.skills);
  if (args.mcp !== undefined) {
    nextConfig.mcp = Array.isArray(args.mcp) ? args.mcp.map(String) : null;
  }
  const patch = {
    agentId: nextAgent.id,
    nodeConfig: nextConfig,
  };
  if (args.mcp !== undefined) {
    patch.mcpDisabled = mcpDisabledFor(args.mcp) || [];
  }
  store.updateSessionNode(workNode.id, patch);
  notify({ managerId: manager.id, nodeId: workNode.id });
  return JSON.stringify(
    {
      ok: true,
      id: workNode.id,
      agent: nextAgent.name,
      task: nextConfig.task || '',
      tools: Array.isArray(nextConfig.tools) ? nextConfig.tools.length : null,
      skills: Array.isArray(nextConfig.skills) ? nextConfig.skills.length : null,
    },
    null,
    2
  );
}

async function worknodeStart(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can start work nodes');
  const workNode = workNodeFor(manager, args.id);
  if (!workNode) return error(`work node not found: ${args.id || '(missing)'}`);
  const task = asText(args.task) || String(workNode.nodeConfig?.task || '');
  if (!task) return error('work node has no task');
  const result = await startWorkNode(workNode, task);
  notify({ managerId: manager.id, nodeId: workNode.id });
  return JSON.stringify(
    {
      ok: result.started === true,
      id: workNode.id,
      status: nodeStatus(store.getSession(workNode.id)),
      ...result,
    },
    null,
    2
  );
}

function worknodeStatus(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can inspect work nodes');
  if (args.id) {
    const workNode = workNodeFor(manager, args.id);
    if (!workNode) return error(`work node not found: ${args.id}`);
    return JSON.stringify(
      {
        id: workNode.id,
        title: workNode.title,
        agent: workNode.agentId,
        task: workNode.nodeConfig?.task || '',
        status: nodeStatus(workNode),
        running: isRunning(workNode.id),
        lastOutput: preview(lastAgentText(workNode), 1200),
      },
      null,
      2
    );
  }
  const sessions = store.listWorkNodes(manager.id);
  return JSON.stringify(
    sessions.map((session) => ({
      id: session.id,
      title: session.title,
      agent: session.agentId,
      status: nodeStatus(session),
      running: isRunning(session.id),
      lastOutput: preview(lastAgentText(session)),
    })),
    null,
    2
  );
}

function worknodeRead(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can read work nodes');
  const workNode = workNodeFor(manager, args.id);
  if (!workNode) return error(`work node not found: ${args.id || '(missing)'}`);
  const messages = Array.isArray(workNode.msgs) ? workNode.msgs : [];
  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Math.min(60, Math.max(1, Number(args.limit) || 20));
  const slice = messages.slice(offset, offset + limit);
  return JSON.stringify(
    {
      id: workNode.id,
      title: workNode.title,
      total: messages.length,
      messages: slice.map((message) => ({
        role: message.role,
        text: String(message.text || '').slice(0, 4000),
      })),
    },
    null,
    2
  );
}

async function worknodeMessage(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can message work nodes');
  const workNode = workNodeFor(manager, args.id);
  if (!workNode) return error(`work node not found: ${args.id || '(missing)'}`);
  const text = asText(args.text);
  if (!text) return error('text is required');
  if (isRunning(workNode.id)) return error('work node is already running');
  const result = await startWorkNode(workNode, text);
  notify({ managerId: manager.id, nodeId: workNode.id });
  return JSON.stringify(
    {
      ok: result.started === true,
      id: workNode.id,
      ...result,
    },
    null,
    2
  );
}

function worknodeStop(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can stop work nodes');
  const targets = args.id
    ? [workNodeFor(manager, args.id)].filter(Boolean)
    : store.listWorkNodes(manager.id);
  if (args.id && targets.length === 0) {
    return error(`work node not found: ${args.id}`);
  }
  const stopped = [];
  for (const session of targets) {
    const runId = providers.runner?.activeRunForSession?.(session.id);
    if (runId && providers.runner?.cancelRun?.(runId)) {
      stopped.push(session.id);
    }
  }
  notify({ managerId: manager.id });
  return JSON.stringify({ ok: true, stopped }, null, 2);
}

function teamLayout(args = {}, context = null) {
  const manager = managerFor(context || args.context);
  if (!manager) return error('only a manager node can arrange its team');
  if (!providers.canvasStore) return error('canvas store is not available');
  const state = canvasState();
  if (!state) return error('canvas state is not available');
  const managerNode = state.nodes[manager.id] || {
    x: 80,
    y: 80,
    width: MANAGER_WIDTH,
    height: MANAGER_HEIGHT,
  };
  const sessions = store.listWorkNodes(manager.id).filter(
    (session) => !session.archivedAt
  );
  sessions.forEach((session, index) => {
    const column = index % WORKNODE_COLUMNS;
    const row = Math.floor(index / WORKNODE_COLUMNS);
    const x =
      (Number(managerNode.x) || 0) +
      column * (WORKNODE_WIDTH + WORKNODE_GAP_X);
    const y =
      (Number(managerNode.y) || 0) +
      (Number(managerNode.height) || MANAGER_HEIGHT) +
      WORKNODE_GAP_Y +
      row * (WORKNODE_HEIGHT + WORKNODE_GAP_Y);
    const node = state.nodes[session.id] || {
      width: WORKNODE_WIDTH,
      height: WORKNODE_HEIGHT,
      parentSessionId: null,
    };
    node.x = x;
    node.y = y;
    node.parentSessionId = null;
    state.nodes[session.id] = node;
  });
  state.frames = [];
  providers.canvasStore.save(state);
  notify({ managerId: manager.id });
  return JSON.stringify({ ok: true, placed: sessions.length }, null, 2);
}

function worknodeOptionsTool() {
  return worknodeOptions();
}

module.exports = {
  configure,
  worknodeOptions: worknodeOptionsTool,
  worknodeList,
  worknodeCreate,
  worknodeAdopt,
  worknodeUpdate,
  worknodeStart,
  worknodeStatus,
  worknodeRead,
  worknodeMessage,
  worknodeStop,
  teamLayout,
};
