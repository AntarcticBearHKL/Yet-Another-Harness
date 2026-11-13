'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('../store');

const DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'yah'
);
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function loadTasks() {
  const data = readJson(TASKS_FILE, { tasks: [] });
  return Array.isArray(data.tasks) ? data.tasks : [];
}

function saveTasks(tasks) {
  writeJson(TASKS_FILE, { tasks });
}

function loadGoals() {
  const data = readJson(GOALS_FILE, { goals: [] });
  return Array.isArray(data.goals) ? data.goals : [];
}

function saveGoals(goals) {
  writeJson(GOALS_FILE, { goals });
}

function loadTeams() {
  const data = readJson(TEAMS_FILE, { teams: [] });
  return Array.isArray(data.teams) ? data.teams : [];
}

function saveTeams(teams) {
  writeJson(TEAMS_FILE, { teams });
}

function chats() {
  return store.loadChats();
}

function findSession(sessionId) {
  const data = chats();
  const id = String(sessionId || '').trim();
  if (id) return data.sessions.find((session) => session.id === id) || null;
  return data.sessions[data.current] || null;
}

function sessionList() {
  const data = chats();
  return data.sessions
    .map(
      (session, index) =>
        `${index === data.current ? '*' : ' '} ${session.id}  ${session.title}  (${session.msgs.length} messages)`
    )
    .join('\n');
}

function sessionRead(args) {
  const session = findSession(args.sessionID || args.sessionId);
  if (!session) return 'tool error: session not found';
  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 30));
  const page = session.msgs.slice(offset, offset + limit);
  const body = page
    .map((msg, index) => {
      const role = String(msg.role || '').toUpperCase();
      const text = String(msg.text || '').trim();
      return `--- ${offset + index} ${role} ---\n${text || '(empty)'}`;
    })
    .join('\n\n');
  return `${session.title} (${session.id})\n${body}${
    offset + page.length < session.msgs.length
      ? `\n\n… truncated; use offset=${offset + page.length}`
      : ''
  }`;
}

function sessionSearch(args) {
  const query = String(args.query || '').trim();
  if (!query) return 'tool error: session_search requires "query"';
  const needle = query.toLowerCase();
  const data = chats();
  const hits = [];
  for (const session of data.sessions) {
    for (let index = 0; index < session.msgs.length; index += 1) {
      const msg = session.msgs[index];
      const text = String(msg.text || '');
      if (!text.toLowerCase().includes(needle)) continue;
      const at = text.toLowerCase().indexOf(needle);
      hits.push(
        `${session.title} (${session.id}) #${index} ${msg.role}\n  …${text
          .slice(Math.max(0, at - 80), at + 160)
          .replace(/\s+/g, ' ')}…`
      );
      if (hits.length >= 20) break;
    }
    if (hits.length >= 20) break;
  }
  return hits.length ? hits.join('\n\n') : `No matches for "${query}".`;
}

function sessionInfo(args) {
  const session = findSession(args.sessionID || args.sessionId);
  if (!session) return 'tool error: session not found';
  const project = chats().projects.find((item) => item.id === session.projectId);
  return JSON.stringify(
    {
      id: session.id,
      title: session.title,
      project: project?.name || session.projectId,
      messages: session.msgs.length,
      mcpDisabled: session.mcpDisabled || [],
      foldState: session.foldState || null,
      pendingQueue: session.pendingQueue || [],
    },
    null,
    2
  );
}

function taskCreate(args) {
  const subject = String(args.subject || '').trim();
  if (!subject) return 'tool error: task_create requires "subject"';
  const tasks = loadTasks();
  const task = {
    id: `task-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    subject,
    description: String(args.description || ''),
    status: String(args.status || 'pending'),
    priority: String(args.priority || 'medium'),
    depends_on: Array.isArray(args.depends_on) ? args.depends_on.map(String) : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.push(task);
  saveTasks(tasks);
  return JSON.stringify(task, null, 2);
}

function taskGet(args) {
  const task = loadTasks().find((item) => item.id === args.id);
  return task ? JSON.stringify(task, null, 2) : `tool error: no task "${args.id}"`;
}

function taskList(args) {
  let tasks = loadTasks();
  if (args.status) tasks = tasks.filter((task) => task.status === args.status);
  if (tasks.length === 0) return 'No tasks.';
  return tasks
    .map(
      (task) =>
        `${task.id}  [${task.status}]  ${task.priority}  ${task.subject}${
          task.depends_on.length ? `  deps=${task.depends_on.join(',')}` : ''
        }`
    )
    .join('\n');
}

function taskUpdate(args) {
  const tasks = loadTasks();
  const task = tasks.find((item) => item.id === args.id);
  if (!task) return `tool error: no task "${args.id}"`;
  for (const key of ['subject', 'description', 'status', 'priority']) {
    if (args[key] !== undefined) task[key] = String(args[key]);
  }
  if (Array.isArray(args.depends_on)) task.depends_on = args.depends_on.map(String);
  task.updatedAt = Date.now();
  saveTasks(tasks);
  return JSON.stringify(task, null, 2);
}

function createGoal(args) {
  const objective = String(args.objective || '').trim();
  if (!objective) return 'tool error: create_goal requires "objective"';
  const goals = loadGoals();
  const goal = {
    id: `goal-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    objective,
    status: String(args.status || 'active'),
    progress: String(args.progress || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  goals.push(goal);
  saveGoals(goals);
  return JSON.stringify(goal, null, 2);
}

function updateGoal(args) {
  const goals = loadGoals();
  const goal = goals.find((item) => item.id === args.id);
  if (!goal) return `tool error: no goal "${args.id}"`;
  for (const key of ['objective', 'status', 'progress']) {
    if (args[key] !== undefined) goal[key] = String(args[key]);
  }
  goal.updatedAt = Date.now();
  saveGoals(goals);
  return JSON.stringify(goal, null, 2);
}

function getGoal(args) {
  const goals = loadGoals();
  const goal = args.id
    ? goals.find((item) => item.id === args.id)
    : goals[goals.length - 1];
  return goal ? JSON.stringify(goal, null, 2) : 'No goals.';
}

function findTeam(name) {
  const key = String(name || '').trim();
  return loadTeams().find((team) => team.id === key || team.name === key) || null;
}

function teamCreate(args) {
  const name = String(args.name || '').trim();
  if (!name) return 'tool error: team_create requires "name"';
  const teams = loadTeams();
  if (teams.some((team) => team.name === name)) {
    return `tool error: team "${name}" already exists`;
  }
  const members = Array.isArray(args.members)
    ? args.members.map((member) => ({
        id: String(member.id || member.name || ''),
        name: String(member.name || member.id || ''),
        role: String(member.role || 'member'),
        status: 'active',
      }))
    : [];
  const team = {
    id: `team-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    name,
    members,
    messages: [],
    tasks: [],
    createdAt: Date.now(),
  };
  teams.push(team);
  saveTeams(teams);
  return JSON.stringify(team, null, 2);
}

function teamDelete(args) {
  const team = findTeam(args.name || args.team);
  if (!team) return `tool error: no team "${args.name || args.team}"`;
  saveTeams(loadTeams().filter((item) => item.id !== team.id));
  return `Deleted team ${team.name}`;
}

function teamList() {
  const teams = loadTeams();
  return teams.length
    ? teams.map((team) => `${team.id}  ${team.name}  (${team.members.length} members, ${team.tasks.length} tasks)`).join('\n')
    : 'No teams.';
}

function teamStatus(args) {
  const team = findTeam(args.name || args.team);
  if (!team) return `tool error: no team "${args.name || args.team}"`;
  return JSON.stringify(team, null, 2);
}

function teamSendMessage(args) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  team.messages.push({
    from: String(args.from || 'lead'),
    to: String(args.to || 'all'),
    text: String(args.message || args.text || ''),
    at: Date.now(),
  });
  saveTeams(loadTeams().map((item) => (item.id === team.id ? team : item)));
  return `Message sent in ${team.name}`;
}

function teamTaskCreate(args) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  const task = {
    id: `team-task-${Date.now().toString(36)}`,
    subject: String(args.subject || args.description || ''),
    description: String(args.description || ''),
    assignee: String(args.assignee || ''),
    status: String(args.status || 'pending'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  team.tasks.push(task);
  saveTeams(loadTeams().map((item) => (item.id === team.id ? team : item)));
  return JSON.stringify(task, null, 2);
}

function teamTaskList(args) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  return team.tasks.length
    ? team.tasks.map((task) => `${task.id}  [${task.status}]  ${task.assignee || '-'}  ${task.subject}`).join('\n')
    : 'No team tasks.';
}

function teamTaskUpdate(args) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  const task = team.tasks.find((item) => item.id === args.id);
  if (!task) return `tool error: no team task "${args.id}"`;
  for (const key of ['subject', 'description', 'assignee', 'status']) {
    if (args[key] !== undefined) task[key] = String(args[key]);
  }
  task.updatedAt = Date.now();
  saveTeams(loadTeams().map((item) => (item.id === team.id ? team : item)));
  return JSON.stringify(task, null, 2);
}

function teamTaskGet(args) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  const task = team.tasks.find((item) => item.id === args.id);
  return task ? JSON.stringify(task, null, 2) : `tool error: no team task "${args.id}"`;
}

function teamMemberStatus(args, status) {
  const team = findTeam(args.team || args.name);
  if (!team) return `tool error: no team "${args.team || args.name}"`;
  const member = team.members.find(
    (item) => item.id === args.member || item.name === args.member
  );
  if (!member) return `tool error: no team member "${args.member}"`;
  member.status = status;
  saveTeams(loadTeams().map((item) => (item.id === team.id ? team : item)));
  return `${member.name}: ${status}`;
}

module.exports = {
  sessionList,
  sessionRead,
  sessionSearch,
  sessionInfo,
  taskCreate,
  taskGet,
  taskList,
  taskUpdate,
  createGoal,
  updateGoal,
  getGoal,
  teamCreate,
  teamDelete,
  teamList,
  teamStatus,
  teamSendMessage,
  teamTaskCreate,
  teamTaskList,
  teamTaskUpdate,
  teamTaskGet,
  teamShutdownRequest: (args) => teamMemberStatus(args, 'shutdown-requested'),
  teamApproveShutdown: (args) => teamMemberStatus(args, 'shutdown'),
  teamRejectShutdown: (args) => teamMemberStatus(args, 'active'),
};
