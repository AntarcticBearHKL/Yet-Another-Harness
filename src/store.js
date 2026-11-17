'use strict';

// 会话 / 设置的落盘。数据目录由 main.js 通过 init() 指定，默认
// %APPDATA%\yah；第一次启动会尝试从旧的 Rust 版
// %APPDATA%\miniharness 迁移 chats.json / settings.json。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { normalizeGoal } = require('./goal');
const { normalizeCompaction } = require('./compaction');
const attachments = require('./attachments');
const { DEFAULT_AGENT_ID } = require('./agent-defaults');
const {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} = require('./reasoning');

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const CHATS_DB = 'chats.db';
const SCHEMA_VERSION = 18;

let dataDir = null;
let legacyDir = null;
let db = null;

function init(app) {
  close();
  dataDir = app.getPath('userData');
  const appData = process.env.APPDATA || app.getPath('appData');
  legacyDir = path.join(appData, 'miniharness');
  fs.mkdirSync(dataDir, { recursive: true });
}

function file(name) {
  return path.join(dataDir, name);
}

function legacyFile(name) {
  return path.join(legacyDir, name);
}

function defaultSettings() {
  return {
    apiKey: '',
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    window: null,
  };
}

function defaultChats() {
  // 允许没有项目和会话：删光后保持空状态，不自动补默认项目
  return {
    projects: [],
    sessions: [],
    current: 0,
    seq: 0,
  };
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;

  const legacyWindow = raw.window;
  let window = null;
  if (legacyWindow && typeof legacyWindow === 'object') {
    const width = Number(legacyWindow.width ?? legacyWindow.w);
    const height = Number(legacyWindow.height ?? legacyWindow.h);
    const x = Number(legacyWindow.x);
    const y = Number(legacyWindow.y);
    if ([width, height, x, y].every(Number.isFinite)) {
      window = { x, y, width, height };
    }
  }

  return {
    apiKey: String(raw.apiKey ?? raw.api_key ?? ''),
    reasoningEffort: normalizeReasoningEffort(raw.reasoningEffort),
    window,
  };
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'agent' || value === 'assistant') return 'Agent';
  if (value === 'compact') return 'Compact';
  return 'User';
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  const kind = String(step.kind ?? '');
  const round = Number.isInteger(step.round) ? step.round : 0;
  const metrics =
    step.metrics && typeof step.metrics === 'object' ? step.metrics : null;
  if (kind === 'text') {
    const text = String(step.text ?? '');
    return text
      ? { kind: 'text', text, round, ...(metrics ? { metrics } : {}) }
      : null;
  }
  if (kind === 'thinking') {
    const text = String(step.text ?? '');
    return text
      ? { kind: 'thinking', text, round, ...(metrics ? { metrics } : {}) }
      : null;
  }
  if (kind === 'call') {
    const name = String(step.name ?? '');
    return name
      ? {
          kind: 'call',
          name,
          arguments: String(step.arguments ?? ''),
          round,
          ...(metrics ? { metrics } : {}),
        }
      : null;
  }
  if (kind === 'result') {
    const name = String(step.name ?? '');
    return name
      ? {
          kind: 'result',
          name,
          output: String(step.output ?? ''),
          ok: step.ok !== false,
          round,
          ...(metrics ? { metrics } : {}),
        }
      : null;
  }
  if (kind === 'compact') {
    return {
      kind: 'compact',
      label: String(step.label ?? 'auto'),
      text: String(step.text ?? ''),
      name: String(step.name ?? ''),
      ok: step.ok !== false,
      round,
      ...(metrics ? { metrics } : {}),
    };
  }
  if (kind === 'goal') {
    return {
      kind: 'goal',
      label: String(step.label ?? 'continue'),
      text: String(step.text ?? ''),
      name: String(step.name ?? ''),
      ok: step.ok !== false,
      round,
      ...(metrics ? { metrics } : {}),
    };
  }
  const label = String(step.label ?? '');
  return label ? { kind: 'status', label, ok: step.ok !== false } : null;
}

function normalizeFoldState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const viewMode =
    raw.viewMode === 'questions' ||
    raw.viewMode === 'replies' ||
    raw.viewMode === 'processes'
      ? raw.viewMode
      : null;
  const openKey =
    typeof raw.openKey === 'string' && raw.openKey.trim()
      ? raw.openKey.trim()
      : null;
  const collapsedProcessKeys = Array.isArray(raw.collapsedProcessKeys)
    ? [...new Set(raw.collapsedProcessKeys.map(String).filter(Boolean))]
    : [];
  const contextCollapsed = Array.isArray(raw.contextCollapsed)
    ? [...new Set(raw.contextCollapsed.map(String).filter(Boolean))]
    : [];
  const contextFoldVersion =
    Number(raw.contextFoldVersion) === 2 ? 2 : 1;
  return {
    openKey,
    collapsedProcessKeys,
    contextCollapsed,
    viewMode,
    contextFoldVersion,
  };
}

function normalizeQueueSkill(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const name = String(raw.name ?? id).trim() || id;
  const args = {};
  if (raw.arguments && typeof raw.arguments === 'object') {
    for (const [key, value] of Object.entries(raw.arguments)) {
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (text) args[String(key)] = text;
    }
  }
  return { id, name, arguments: args };
}

function normalizePendingQueue(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) out.push({ text, skills: [], agentId: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text ?? '').trim();
    const images = attachments.normalizeImages(item.images);
    if (!text && images.length === 0) continue;
    const skills = Array.isArray(item.skills)
      ? item.skills.map(normalizeQueueSkill).filter(Boolean).slice(0, 5)
      : [];
    const entry = {
      text,
      skills,
      agentId: String(item.agentId || '').trim(),
    };
    if (images.length > 0) entry.images = images;
    if (item.kind === 'compact') entry.kind = 'compact';
    if (item.background === true) entry.background = true;
    if (item.subagent === true) entry.subagent = true;
    if (item.jobId) entry.jobId = String(item.jobId);
    if (item.subagentSessionId) {
      entry.subagentSessionId = String(item.subagentSessionId);
    }
    if (item.note) entry.note = String(item.note).slice(0, 300);
    out.push(entry);
  }
  return out.slice(0, 100);
}

function normalizeDirectories(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    const text = String(value || '').trim();
    if (!text) continue;
    const resolved = path.resolve(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeNodeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'manager' ? 'manager' : raw.kind === 'work' ? 'work' : '';
  if (!kind) return null;
  const text = (value, limit = 4000) => String(value || '').slice(0, limit);
  const list = (value, limit = 200) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
      const textValue = String(item || '').trim();
      if (!textValue || seen.has(textValue)) continue;
      seen.add(textValue);
      out.push(textValue);
      if (out.length >= limit) break;
    }
    return out;
  };
  const tools = Array.isArray(raw.tools) ? list(raw.tools) : null;
  const skills = Array.isArray(raw.skills) ? list(raw.skills) : null;
  const mcp = Array.isArray(raw.mcp) ? list(raw.mcp) : null;
  return {
    kind,
    directories: normalizeDirectories(raw.directories),
    files: list(raw.files, 100),
    task: text(raw.task),
    tools,
    skills,
    mcp,
  };
}

function normalizeProjects(raw) {
  const projects = [];
  const seen = new Set();
  if (Array.isArray(raw)) {
    for (const [index, project] of raw.entries()) {
      if (!project || typeof project !== 'object') continue;
      const id = String(project.id || crypto.randomUUID());
      if (seen.has(id)) continue;
      seen.add(id);
      projects.push({
        id,
        name: String(project.name || `Project ${index + 1}`),
        directories: normalizeDirectories(project.directories),
      });
    }
  }
  return projects;
}

function normalizeChats(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) {
    return defaultChats();
  }

  const projects = normalizeProjects(raw.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const fallbackProjectId = projects[0]?.id || null;

  const sessions = raw.sessions
    .filter((session) => session && typeof session === 'object')
    .map((session, index) => {
      const msgs = Array.isArray(session.msgs)
        ? session.msgs
            .filter((msg) => msg && typeof msg === 'object')
            .map((msg) => {
              const role = normalizeRole(msg.role);
              const images = attachments.normalizeImages(msg.images);
              const normalized = {
                role,
                text: String(msg.text ?? ''),
                // 旧文件可能是 pretty JSON；新文件只存空字符串当"真的发过请求"的标记
                request:
                  msg.request === undefined || msg.request === null
                    ? null
                    : String(msg.request),
                // 工具循环的完整过程（调用参数 + 返回内容，只用于展示，不发给模型）
                steps: Array.isArray(msg.steps)
                  ? msg.steps.map(normalizeStep).filter(Boolean)
                  : [],
                // 每一轮实际发给模型的原始请求 body（用于双击查看）
                requests: Array.isArray(msg.requests)
                  ? msg.requests.map((body) =>
                      body && typeof body === 'object' ? body : null
                    )
                  : [],
                // token 用量和每轮性能指标
                usage:
                  msg.usage && typeof msg.usage === 'object'
                    ? msg.usage
                    : null,
              };
              if (images.length > 0) normalized.images = images;
              return normalized;
            })
        : [];

      const projectId = projectIds.has(String(session.projectId))
        ? String(session.projectId)
        : fallbackProjectId;
      const managerId = session.managerId
        ? String(session.managerId)
        : null;
      const nodeRole =
        session.nodeRole === 'manager'
          ? 'manager'
          : session.nodeRole === 'work' || managerId
            ? 'work'
            : null;

      return {
        id: String(session.id || crypto.randomUUID()),
        title: String(session.title || `Chat ${index + 1}`),
        system: String(session.system ?? DEFAULT_SYSTEM_PROMPT),
        agentsMd:
          typeof session.agentsMd === 'string' ? session.agentsMd : null,
        agentId: String(session.agentId || DEFAULT_AGENT_ID),
        projectId,
        frozen: session.frozen === true || session.frozen === 1,
        subagent: session.subagent === true || session.subagent === 1,
        parentSessionId: session.parentSessionId
          ? String(session.parentSessionId)
          : null,
        nodeRole,
        managerId,
        nodeConfig: normalizeNodeConfig(session.nodeConfig),
        mcpDisabled: Array.isArray(session.mcpDisabled)
          ? session.mcpDisabled.map(String).filter(Boolean)
          : [],
        foldState: normalizeFoldState(session.foldState),
        pendingQueue: normalizePendingQueue(session.pendingQueue),
        goal: normalizeGoal(session.goal),
        compaction: normalizeCompaction(session.compaction),
        msgs,
      };
    });

  if (sessions.length === 0) {
    return {
      projects,
      sessions: [],
      current: 0,
      seq: 0,
    };
  }

  const current = Math.min(
    sessions.length - 1,
    Math.max(0, Number.isInteger(raw.current) ? raw.current : 0)
  );

  return {
    projects,
    sessions,
    current,
    seq: Math.max(
      sessions.length,
      Number.isInteger(raw.seq) ? raw.seq : sessions.length
    ),
  };
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    // Windows 上目标文件被占用时 rename 可能失败，退化成覆盖写
    fs.copyFileSync(tmp, filePath);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadSettings() {
  const current = file('settings.json');
  if (fs.existsSync(current)) {
    try {
      return normalizeSettings(readJson(current));
    } catch {
      try {
        fs.renameSync(current, `${current}.corrupt`);
      } catch {
        /* ignore */
      }
    }
  }

  if (legacyDir) {
    const legacy = legacyFile('settings.json');
    if (fs.existsSync(legacy)) {
      try {
        const migrated = normalizeSettings(readJson(legacy));
        atomicWrite(current, migrated);
        return migrated;
      } catch {
        /* ignore */
      }
    }
  }
  return defaultSettings();
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  atomicWrite(file('settings.json'), normalized);
  return normalized;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directories TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  system TEXT NOT NULL,
  agents_md TEXT,
  agent_id TEXT,
  project_id TEXT,
  mcp_disabled TEXT,
  fold_state TEXT,
  pending_queue TEXT,
  goal TEXT,
  compaction TEXT,
  frozen INTEGER NOT NULL DEFAULT 0,
  subagent INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT,
  node_role TEXT,
  manager_id TEXT,
  node_config TEXT,
  archived_at INTEGER,
  archived_status TEXT,
  sort_order INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  request TEXT,
  usage TEXT,
  images TEXT,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS steps (
  session_id TEXT NOT NULL,
  message_seq INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  name TEXT,
  arguments TEXT,
  output TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  metrics TEXT,
  PRIMARY KEY (session_id, message_seq, seq),
  FOREIGN KEY (session_id, message_seq)
    REFERENCES messages(session_id, seq) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requests (
  session_id TEXT NOT NULL,
  message_seq INTEGER NOT NULL,
  round INTEGER NOT NULL,
  body BLOB NOT NULL,
  PRIMARY KEY (session_id, message_seq, round),
  FOREIGN KEY (session_id, message_seq)
    REFERENCES messages(session_id, seq) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS archive_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  note TEXT,
  command TEXT,
  cwd TEXT,
  status TEXT,
  exit_code INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  output TEXT,
  stderr TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_session_id TEXT,
  title_seq INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO app_state (id, current_session_id, title_seq)
VALUES (1, NULL, 0);

CREATE INDEX IF NOT EXISTS idx_sessions_order ON sessions(sort_order);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(sort_order);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_steps_message ON steps(session_id, message_seq, seq);
CREATE INDEX IF NOT EXISTS idx_requests_message ON requests(session_id, message_seq, round);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_archive_jobs_session ON archive_jobs(session_id, ended_at);
`;

function close() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* ignore */
  }
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
}

function ensureSchema(database) {
  const row = database.prepare('PRAGMA user_version').get();
  const version = Number(row && row.user_version) || 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `chats.db schema version ${version} is newer than supported ${SCHEMA_VERSION}`
    );
  }
  if (version >= SCHEMA_VERSION) return;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(SCHEMA_SQL);

    // v1 -> v2: add project_id to existing sessions and create a default project.
    const columns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!columns.some((column) => column.name === 'project_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT');
    }

    // v4 -> v5: per-session disabled MCP server ids.
    if (!columns.some((column) => column.name === 'mcp_disabled')) {
      database.exec('ALTER TABLE sessions ADD COLUMN mcp_disabled TEXT');
    }

    // v5 -> v6: per-step timing metrics.
    const stepColumns = database.prepare('PRAGMA table_info(steps)').all();
    if (!stepColumns.some((column) => column.name === 'metrics')) {
      database.exec('ALTER TABLE steps ADD COLUMN metrics TEXT');
    }

    // v6 -> v7: per-session fold state (open card, collapsed process groups, view mode).
    const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!sessionColumns.some((column) => column.name === 'fold_state')) {
      database.exec('ALTER TABLE sessions ADD COLUMN fold_state TEXT');
    }

    // v7 -> v8: per-session queued prompts.
    if (!sessionColumns.some((column) => column.name === 'pending_queue')) {
      database.exec('ALTER TABLE sessions ADD COLUMN pending_queue TEXT');
    }

    // v8 -> v9: per-session selected agent.
    if (!sessionColumns.some((column) => column.name === 'agent_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN agent_id TEXT');
    }

    // v3 -> v4: token usage attached to agent messages.
    const messageColumns = database.prepare('PRAGMA table_info(messages)').all();
    if (!messageColumns.some((column) => column.name === 'usage')) {
      database.exec('ALTER TABLE messages ADD COLUMN usage TEXT');
    }

    // v14 -> v15: image references attached to user messages.
    if (!messageColumns.some((column) => column.name === 'images')) {
      database.exec('ALTER TABLE messages ADD COLUMN images TEXT');
    }

    // v9 -> v10: project development directories.
    const projectColumns = database.prepare('PRAGMA table_info(projects)').all();
    if (!projectColumns.some((column) => column.name === 'directories')) {
      database.exec('ALTER TABLE projects ADD COLUMN directories TEXT');
    }

    // v10 -> v11: session goal state and context compaction checkpoint.
    const goalColumns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!goalColumns.some((column) => column.name === 'goal')) {
      database.exec('ALTER TABLE sessions ADD COLUMN goal TEXT');
    }
    if (!goalColumns.some((column) => column.name === 'compaction')) {
      database.exec('ALTER TABLE sessions ADD COLUMN compaction TEXT');
    }

    // v11 -> v12: AGENTS.md snapshot loaded once when a conversation starts.
    const agentsColumns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!agentsColumns.some((column) => column.name === 'agents_md')) {
      database.exec('ALTER TABLE sessions ADD COLUMN agents_md TEXT');
    }

    // v12 -> v13: frozen sessions after a manual compaction fork.
    const frozenColumns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!frozenColumns.some((column) => column.name === 'frozen')) {
      database.exec(
        'ALTER TABLE sessions ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0'
      );
    }

    // v13 -> v14: read-only subagent conversations.
    const subagentColumns = database
      .prepare('PRAGMA table_info(sessions)')
      .all();
    if (!subagentColumns.some((column) => column.name === 'subagent')) {
      database.exec(
        'ALTER TABLE sessions ADD COLUMN subagent INTEGER NOT NULL DEFAULT 0'
      );
    }

    // v15 -> v16: stable parent links for subagent canvas groups.
    const parentColumns = database
      .prepare('PRAGMA table_info(sessions)')
      .all();
    if (!parentColumns.some((column) => column.name === 'parent_session_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT');
    }

    // v16 -> v17: archived subagent conversations and finished background tasks.
    if (!parentColumns.some((column) => column.name === 'archived_at')) {
      database.exec('ALTER TABLE sessions ADD COLUMN archived_at INTEGER');
    }
    if (!parentColumns.some((column) => column.name === 'archived_status')) {
      database.exec('ALTER TABLE sessions ADD COLUMN archived_status TEXT');
    }

    // v17 -> v18: manager / work node roles and per-node assignment config.
    const nodeColumns = database.prepare('PRAGMA table_info(sessions)').all();
    if (!nodeColumns.some((column) => column.name === 'node_role')) {
      database.exec('ALTER TABLE sessions ADD COLUMN node_role TEXT');
    }
    if (!nodeColumns.some((column) => column.name === 'manager_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN manager_id TEXT');
    }
    if (!nodeColumns.some((column) => column.name === 'node_config')) {
      database.exec('ALTER TABLE sessions ADD COLUMN node_config TEXT');
    }
    database
      .prepare(
        "UPDATE sessions SET archived_at = COALESCE(archived_at, updated_at), archived_status = COALESCE(archived_status, 'done') WHERE subagent = 1 AND archived_at IS NULL"
      )
      .run();

    const fallbackProject = database
      .prepare('SELECT id FROM projects ORDER BY sort_order ASC LIMIT 1')
      .get();
    if (fallbackProject) {
      database
        .prepare(
          "UPDATE sessions SET project_id = ? WHERE project_id IS NULL OR project_id = ''"
        )
        .run(fallbackProject.id);
    }

    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

function backfillParentSessionIds(database) {
  try {
    const canvasFile = file('canvas.json');
    if (!fs.existsSync(canvasFile)) return;
    const canvas = JSON.parse(fs.readFileSync(canvasFile, 'utf8'));
    const nodes = canvas && canvas.nodes;
    if (!nodes || typeof nodes !== 'object') return;
    const ids = new Set(
      database
        .prepare('SELECT id FROM sessions')
        .all()
        .map((row) => row.id)
    );
    const update = database.prepare(
      "UPDATE sessions SET parent_session_id = ? WHERE id = ? AND subagent = 1 AND (parent_session_id IS NULL OR parent_session_id = '')"
    );
    for (const [id, node] of Object.entries(nodes)) {
      const parent = node && node.parentSessionId
        ? String(node.parentSessionId)
        : '';
      if (!parent || parent === id) continue;
      if (!ids.has(parent) || !ids.has(String(id))) continue;
      update.run(parent, String(id));
    }
  } catch {
    /* canvas links are optional */
  }
}

function openDb() {
  if (db) return db;
  const database = new DatabaseSync(file(CHATS_DB));
  try {
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec('PRAGMA synchronous = NORMAL;');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec('PRAGMA busy_timeout = 5000;');
    ensureSchema(database);
    backfillParentSessionIds(database);
    db = database;
    return db;
  } catch (error) {
    try {
      database.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function sessionCount() {
  return Number(openDb().prepare('SELECT COUNT(*) AS n FROM sessions').get().n) || 0;
}

function hashSession(session) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        title: session.title,
        system: session.system,
        agentId: session.agentId || DEFAULT_AGENT_ID,
        projectId: session.projectId,
        subagent: session.subagent === true,
        parentSessionId: session.parentSessionId || null,
        nodeRole: session.nodeRole || null,
        managerId: session.managerId || null,
        nodeConfig: normalizeNodeConfig(session.nodeConfig),
        mcpDisabled: session.mcpDisabled || [],
        msgs: session.msgs,
      })
    )
    .digest('hex');
}

function readChats() {
  const database = openDb();
  const projectRows = database
    .prepare('SELECT id, name, directories FROM projects ORDER BY sort_order ASC')
    .all();
  const projects = projectRows.map((row) => {
    let directories = [];
    try {
      directories = normalizeDirectories(JSON.parse(row.directories || '[]'));
    } catch {
      directories = [];
    }
    return { id: row.id, name: row.name, directories };
  });
  const projectIds = new Set(projects.map((project) => project.id));

  const sessionRows = database
    .prepare(
      'SELECT id, title, system, agents_md, agent_id, project_id, frozen, subagent, parent_session_id, node_role, manager_id, node_config, archived_at, archived_status, mcp_disabled, fold_state, pending_queue, goal, compaction FROM sessions ORDER BY sort_order ASC'
    )
    .all();
  if (sessionRows.length === 0) {
    return {
      projects,
      sessions: [],
      current: 0,
      seq: 0,
    };
  }

  const messageRows = database
    .prepare(
      'SELECT session_id, seq, role, text, request, usage, images FROM messages ORDER BY session_id, seq'
    )
    .all();
  const stepRows = database
    .prepare(
      `SELECT session_id, message_seq, seq, kind, round, text, name, arguments, output, ok, label, metrics
       FROM steps ORDER BY session_id, message_seq, seq`
    )
    .all();
  const requestRows = database
    .prepare(
      `SELECT session_id, message_seq, round, body
       FROM requests ORDER BY session_id, message_seq, round`
    )
    .all();

  const bySession = new Map(
    sessionRows.map((row) => {
      let mcpDisabled = [];
      if (row.mcp_disabled) {
        try {
          const parsed = JSON.parse(row.mcp_disabled);
          if (Array.isArray(parsed)) {
            mcpDisabled = parsed.map(String).filter(Boolean);
          }
        } catch {
          /* ignore malformed mcp_disabled */
        }
      }
      let foldState = null;
      if (row.fold_state) {
        try {
          foldState = normalizeFoldState(JSON.parse(row.fold_state));
        } catch {
          /* ignore malformed fold_state */
        }
      }
      let pendingQueue = [];
      if (row.pending_queue) {
        try {
          pendingQueue = normalizePendingQueue(JSON.parse(row.pending_queue));
        } catch {
          /* ignore malformed pending_queue */
        }
      }
      let goal = null;
      if (row.goal) {
        try {
          goal = normalizeGoal(JSON.parse(row.goal));
        } catch {
          goal = null;
        }
      }
      let compaction = null;
      if (row.compaction) {
        try {
          compaction = normalizeCompaction(JSON.parse(row.compaction));
        } catch {
          compaction = null;
        }
      }
      let nodeConfig = null;
      if (row.node_config) {
        try {
          nodeConfig = normalizeNodeConfig(JSON.parse(row.node_config));
        } catch {
          nodeConfig = null;
        }
      }
      const managerId = row.manager_id ? String(row.manager_id) : null;
      const nodeRole =
        row.node_role === 'manager'
          ? 'manager'
          : row.node_role === 'work' || managerId
            ? 'work'
            : null;
      return [
        row.id,
        {
          id: row.id,
          title: row.title,
          system: row.system,
          agentsMd:
            row.agents_md === null || row.agents_md === undefined
              ? null
              : String(row.agents_md),
          agentId: row.agent_id || DEFAULT_AGENT_ID,
          projectId: projectIds.has(row.project_id)
            ? row.project_id
            : projects[0]?.id || null,
          frozen: Boolean(row.frozen),
          subagent: Boolean(row.subagent),
          parentSessionId: row.parent_session_id
            ? String(row.parent_session_id)
            : null,
          nodeRole,
          managerId,
          nodeConfig,
          archivedAt:
            row.archived_at === null || row.archived_at === undefined
              ? null
              : Number(row.archived_at),
          archivedStatus: row.archived_status
            ? String(row.archived_status)
            : null,
          mcpDisabled,
          foldState,
          pendingQueue,
          goal,
          compaction,
          msgs: [],
        },
      ];
    })
  );
  const messageByKey = new Map();

  for (const row of messageRows) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    const msg = {
      role: normalizeRole(row.role),
      text: String(row.text ?? ''),
      request: row.request === null ? null : String(row.request),
      steps: [],
      requests: [],
    };
    if (row.usage) {
      try {
        const usage = JSON.parse(row.usage);
        if (usage && typeof usage === 'object') msg.usage = usage;
      } catch {
        /* ignore malformed usage */
      }
    }
    if (row.images) {
      try {
        const images = JSON.parse(row.images);
        const normalized = attachments.normalizeImages(images);
        if (normalized.length > 0) msg.images = normalized;
      } catch {
        /* ignore malformed images */
      }
    }
    session.msgs.push(msg);
    messageByKey.set(`${row.session_id}\u0000${row.seq}`, msg);
  }

  for (const row of stepRows) {
    const msg = messageByKey.get(
      `${row.session_id}\u0000${row.message_seq}`
    );
    if (!msg) continue;
    const round = Number(row.round) || 0;
    let metrics = null;
    if (row.metrics) {
      try {
        const parsed = JSON.parse(row.metrics);
        if (parsed && typeof parsed === 'object') metrics = parsed;
      } catch {
        /* ignore malformed step metrics */
      }
    }
    if (row.kind === 'text') {
      msg.steps.push({
        kind: 'text',
        text: String(row.text ?? ''),
        round,
        ...(metrics ? { metrics } : {}),
      });
    } else if (row.kind === 'thinking') {
      msg.steps.push({
        kind: 'thinking',
        text: String(row.text ?? ''),
        round,
        ...(metrics ? { metrics } : {}),
      });
    } else if (row.kind === 'call') {
      msg.steps.push({
        kind: 'call',
        name: String(row.name ?? ''),
        arguments: String(row.arguments ?? ''),
        round,
        ...(metrics ? { metrics } : {}),
      });
    } else if (row.kind === 'result') {
      msg.steps.push({
        kind: 'result',
        name: String(row.name ?? ''),
        output: String(row.output ?? ''),
        ok: Boolean(row.ok),
        round,
        ...(metrics ? { metrics } : {}),
      });
    } else if (row.kind === 'status') {
      msg.steps.push({
        kind: 'status',
        label: String(row.label ?? ''),
        ok: Boolean(row.ok),
      });
    } else if (row.kind === 'compact') {
      msg.steps.push({
        kind: 'compact',
        label: String(row.label ?? 'auto'),
        text: String(row.text ?? ''),
        name: String(row.name ?? ''),
        ok: Boolean(row.ok),
        ...(metrics ? { metrics } : {}),
      });
    } else if (row.kind === 'goal') {
      msg.steps.push({
        kind: 'goal',
        label: String(row.label ?? 'continue'),
        text: String(row.text ?? ''),
        name: String(row.name ?? ''),
        ok: Boolean(row.ok),
        ...(metrics ? { metrics } : {}),
      });
    }
  }

  for (const row of requestRows) {
    const msg = messageByKey.get(
      `${row.session_id}\u0000${row.message_seq}`
    );
    if (!msg) continue;
    try {
      msg.requests[Number(row.round) || 0] = JSON.parse(
        zlib.gunzipSync(row.body).toString('utf8')
      );
    } catch {
      /* skip unreadable raw request */
    }
  }

  const state =
    database
      .prepare('SELECT current_session_id, title_seq FROM app_state WHERE id = 1')
      .get() || {};

  let current = 0;
  if (state.current_session_id) {
    const index = sessionRows.findIndex(
      (row) => row.id === state.current_session_id
    );
    if (index >= 0) current = index;
  }

  return {
    projects,
    sessions: sessionRows.map((row) => bySession.get(row.id)),
    current,
    seq: Math.max(sessionRows.length, Number(state.title_seq) || 0),
  };
}

function writeChats(chats) {
  const normalized = normalizeChats(chats);
  const database = openDb();

  const existing = new Map(
    database
      .prepare('SELECT id, content_hash FROM sessions')
      .all()
      .map((row) => [row.id, row.content_hash])
  );
  const protectedSubagents = new Set(
    database
      .prepare('SELECT id FROM sessions WHERE subagent = 1')
      .all()
      .map((row) => row.id)
  );

  const upsertSession = database.prepare(
    `INSERT INTO sessions (id, title, system, agents_md, agent_id, project_id, frozen, subagent, parent_session_id, node_role, manager_id, node_config, mcp_disabled, fold_state, pending_queue, goal, compaction, sort_order, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       system = excluded.system,
       agents_md = excluded.agents_md,
       agent_id = excluded.agent_id,
       project_id = excluded.project_id,
       frozen = MAX(frozen, excluded.frozen),
       subagent = MAX(subagent, excluded.subagent),
       parent_session_id = excluded.parent_session_id,
       node_role = excluded.node_role,
       manager_id = excluded.manager_id,
       node_config = excluded.node_config,
       mcp_disabled = excluded.mcp_disabled,
       fold_state = excluded.fold_state,
       pending_queue = excluded.pending_queue,
       goal = excluded.goal,
       compaction = excluded.compaction,
       sort_order = excluded.sort_order,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`
  );
  const upsertProject = database.prepare(
    `INSERT INTO projects (id, name, directories, sort_order)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       directories = excluded.directories,
       sort_order = excluded.sort_order`
  );
  const deleteProject = database.prepare('DELETE FROM projects WHERE id = ?');
  const existingProjects = new Set(
    database
      .prepare('SELECT id FROM projects')
      .all()
      .map((row) => row.id)
  );
  const deleteMessages = database.prepare(
    'DELETE FROM messages WHERE session_id = ?'
  );
  const insertMessage = database.prepare(
    'INSERT INTO messages (session_id, seq, role, text, request, usage, images) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertStep = database.prepare(
    `INSERT INTO steps
       (session_id, message_seq, seq, kind, round, text, name, arguments, output, ok, label, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRequest = database.prepare(
    'INSERT INTO requests (session_id, message_seq, round, body) VALUES (?, ?, ?, ?)'
  );
  const deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?');
  const updateState = database.prepare(
    'UPDATE app_state SET current_session_id = ?, title_seq = ? WHERE id = 1'
  );

  const incoming = new Set();
  const incomingProjects = new Set();
  const now = Date.now();

  database.exec('BEGIN IMMEDIATE');
  try {
    normalized.projects.forEach((project, order) => {
      incomingProjects.add(project.id);
      upsertProject.run(
        project.id,
        project.name,
        JSON.stringify(project.directories || []),
        order
      );
    });

    normalized.sessions.forEach((session, order) => {
      incoming.add(session.id);
      const hash = hashSession(session);
      upsertSession.run(
        session.id,
        session.title,
        session.system,
        session.agentsMd === null || session.agentsMd === undefined
          ? null
          : String(session.agentsMd),
        session.agentId || DEFAULT_AGENT_ID,
        session.projectId,
        session.frozen ? 1 : 0,
        session.subagent ? 1 : 0,
        session.parentSessionId || null,
        session.nodeRole || null,
        session.managerId || null,
        session.nodeConfig ? JSON.stringify(session.nodeConfig) : null,
        JSON.stringify(session.mcpDisabled || []),
        session.foldState ? JSON.stringify(session.foldState) : null,
        JSON.stringify(session.pendingQueue || []),
        session.goal ? JSON.stringify(session.goal) : null,
        session.compaction ? JSON.stringify(session.compaction) : null,
        order,
        hash,
        now
      );
      if (existing.get(session.id) === hash) return;
      // 结构保存只带标题/项目等信息时，不要清空 runner 写入的消息。
      if (existing.has(session.id) && session.msgs.length === 0) return;

      deleteMessages.run(session.id);
      session.msgs.forEach((msg, messageSeq) => {
        insertMessage.run(
          session.id,
          messageSeq,
          msg.role,
          msg.text,
          msg.request,
          msg.usage ? JSON.stringify(msg.usage) : null,
          Array.isArray(msg.images) && msg.images.length > 0
            ? JSON.stringify(msg.images)
            : null
        );
        (msg.steps || []).forEach((step, stepSeq) => {
          insertStep.run(
            session.id,
            messageSeq,
            stepSeq,
            step.kind,
            Number.isInteger(step.round) ? step.round : 0,
            step.text ?? null,
            step.name ?? null,
            step.arguments ?? null,
            step.output ?? null,
            step.ok === false ? 0 : 1,
            step.label ?? null,
            step.metrics ? JSON.stringify(step.metrics) : null
          );
        });
        (msg.requests || []).forEach((body, round) => {
          if (!body) return;
          insertRequest.run(
            session.id,
            messageSeq,
            round,
            zlib.gzipSync(Buffer.from(JSON.stringify(body), 'utf8'))
          );
        });
      });
    });

    for (const id of existing.keys()) {
      if (!incoming.has(id) && !protectedSubagents.has(id)) {
        deleteSession.run(id);
      }
    }
    for (const id of existingProjects) {
      if (!incomingProjects.has(id)) deleteProject.run(id);
    }

    const current = normalized.sessions[normalized.current];
    updateState.run(current ? current.id : null, normalized.seq);
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }

  return normalized;
}

function importLegacyChats() {
  const candidates = [
    { path: file('chats.json'), rename: true },
    { path: legacyFile('chats.json'), rename: false },
  ];

  for (const candidate of candidates) {
    if (!candidate.path || !fs.existsSync(candidate.path)) continue;

    let data;
    try {
      data = normalizeChats(readJson(candidate.path));
    } catch {
      if (candidate.rename) {
        try {
          fs.renameSync(candidate.path, `${candidate.path}.corrupt`);
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    if (data.sessions.length === 0) continue;
    if (data.projects.length === 0) {
      const project = {
        id: 'project-legacy',
        name: 'Project 1',
        directories: [],
      };
      data.projects.push(project);
      for (const session of data.sessions) session.projectId = project.id;
    }
    writeChats(data);
    if (candidate.rename) {
      fs.renameSync(candidate.path, `${candidate.path}.pre-sqlite`);
    }
    return;
  }
}

function loadChats() {
  openDb();
  if (sessionCount() === 0) importLegacyChats();
  return readChats();
}

function saveChats(chats) {
  return writeChats(chats);
}

function metadataHash(session) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        title: session.title,
        system: session.system,
        agentId: session.agentId || DEFAULT_AGENT_ID,
        projectId: session.projectId,
        subagent: session.subagent === true,
        parentSessionId: session.parentSessionId || null,
        nodeRole: session.nodeRole || null,
        managerId: session.managerId || null,
        nodeConfig: normalizeNodeConfig(session.nodeConfig),
        mcpDisabled: session.mcpDisabled || [],
      })
    )
    .digest('hex');
}

/**
 * 只保存项目 / 会话的结构，不碰消息内容。
 * 消息由 agent runner 增量写入，避免多个客户端用整份状态互相覆盖。
 */
function saveStructure(chats) {
  const preserveCurrent = Boolean(chats && chats.preserveCurrent);
  const normalized = normalizeChats(chats);
  const database = openDb();
  const existingSessionCount =
    Number(
      database.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n
    ) || 0;
  if (
    existingSessionCount > 0 &&
    normalized.sessions.length === 0 &&
    chats?.allowEmpty !== true
  ) {
    const error = new Error(
      'refusing to replace existing sessions with an empty structure'
    );
    error.status = 409;
    throw error;
  }

  const upsertProject = database.prepare(
    `INSERT INTO projects (id, name, directories, sort_order)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       directories = excluded.directories,
       sort_order = excluded.sort_order`
  );
  const upsertSession = database.prepare(
    `INSERT INTO sessions (id, title, system, agent_id, project_id, frozen, subagent, parent_session_id, node_role, manager_id, node_config, mcp_disabled, fold_state, pending_queue, sort_order, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       system = excluded.system,
       agent_id = excluded.agent_id,
       project_id = excluded.project_id,
       frozen = MAX(frozen, excluded.frozen),
       subagent = MAX(subagent, excluded.subagent),
       parent_session_id = excluded.parent_session_id,
       node_role = excluded.node_role,
       manager_id = excluded.manager_id,
       node_config = excluded.node_config,
       mcp_disabled = excluded.mcp_disabled,
       fold_state = excluded.fold_state,
       pending_queue = excluded.pending_queue,
       sort_order = excluded.sort_order,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`
  );
  const updateState = database.prepare(
    'UPDATE app_state SET current_session_id = ?, title_seq = ? WHERE id = 1'
  );
  const updateSeq = database.prepare(
    'UPDATE app_state SET title_seq = ? WHERE id = 1'
  );
  const deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteProject = database.prepare('DELETE FROM projects WHERE id = ?');
  const existingSessions = new Set(
    database
      .prepare('SELECT id FROM sessions')
      .all()
      .map((row) => row.id)
  );
  const protectedSubagents = new Set(
    database
      .prepare('SELECT id FROM sessions WHERE subagent = 1')
      .all()
      .map((row) => row.id)
  );
  const existingProjects = new Set(
    database
      .prepare('SELECT id FROM projects')
      .all()
      .map((row) => row.id)
  );
  const existingProjectDirectories = new Map(
    database
      .prepare('SELECT id, directories FROM projects')
      .all()
      .map((row) => [row.id, row.directories])
  );

  for (const project of normalized.projects) {
    if (project.directories.length > 0) continue;
    const error = new Error('项目至少需要一个工作目录');
    error.status = 400;
    if (!existingProjectDirectories.has(project.id)) throw error;
    let previous = [];
    try {
      previous = JSON.parse(existingProjectDirectories.get(project.id) || '[]');
    } catch {
      previous = [];
    }
    if (Array.isArray(previous) && previous.length > 0) throw error;
  }

  const now = Date.now();
  const incomingSessions = new Set();
  const incomingProjects = new Set();

  database.exec('BEGIN IMMEDIATE');
  try {
    normalized.projects.forEach((project, order) => {
      incomingProjects.add(project.id);
      upsertProject.run(
        project.id,
        project.name,
        JSON.stringify(project.directories || []),
        order
      );
    });

    normalized.sessions.forEach((session, order) => {
      incomingSessions.add(session.id);
      upsertSession.run(
        session.id,
        session.title,
        session.system,
        session.agentId || DEFAULT_AGENT_ID,
        session.projectId,
        session.frozen ? 1 : 0,
        session.subagent ? 1 : 0,
        session.parentSessionId || null,
        session.nodeRole || null,
        session.managerId || null,
        session.nodeConfig ? JSON.stringify(session.nodeConfig) : null,
        JSON.stringify(session.mcpDisabled || []),
        session.foldState ? JSON.stringify(session.foldState) : null,
        JSON.stringify(session.pendingQueue || []),
        order,
        metadataHash(session),
        now
      );
    });

    if (chats?.allowDeleteSessions === true) {
      for (const id of existingSessions) {
        if (!incomingSessions.has(id) && !protectedSubagents.has(id)) {
          deleteSession.run(id);
        }
      }
    }
    for (const id of existingProjects) {
      if (!incomingProjects.has(id)) deleteProject.run(id);
    }

    const current = normalized.sessions[normalized.current];
    if (preserveCurrent) {
      updateSeq.run(normalized.seq);
    } else {
      updateState.run(current ? current.id : null, normalized.seq);
    }
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }

  return normalized;
}

function deleteSession(sessionId) {
  openDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function sessionSubtreeIds(sessionId) {
  const root = String(sessionId || '');
  if (!root) return [];
  const database = openDb();
  const rows = database
    .prepare('SELECT id, parent_session_id FROM sessions')
    .all();
  const children = new Map();
  for (const row of rows) {
    const parent = row.parent_session_id ? String(row.parent_session_id) : '';
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(String(row.id));
  }
  const ids = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    for (const child of children.get(id) || []) queue.push(child);
  }
  return ids;
}

function archiveSubagent(sessionId, status = 'done') {
  const id = String(sessionId || '');
  if (!id) return false;
  const now = Date.now();
  const result = openDb()
    .prepare(
      "UPDATE sessions SET archived_at = COALESCE(archived_at, ?), archived_status = ?, updated_at = ? WHERE id = ? AND subagent = 1"
    )
    .run(now, String(status || 'done'), now, id);
  return Number(result.changes) > 0;
}

function archiveUnfinishedSubagents() {
  const now = Date.now();
  const result = openDb()
    .prepare(
      `UPDATE sessions
       SET archived_at = ?, archived_status = 'interrupted', updated_at = ?
       WHERE subagent = 1
         AND archived_at IS NULL
         AND id NOT IN (
           SELECT session_id FROM runs WHERE status IN ('running', 'queued')
         )`
    )
    .run(now, now);
  return Number(result.changes) || 0;
}

function archiveBackgroundJob(sessionId, job) {
  const id = String(job?.id || '');
  const owner = String(job?.sessionId || sessionId || '');
  if (!id || !owner) return null;
  const now = Date.now();
  try {
    openDb()
      .prepare(
        `INSERT INTO archive_jobs
           (id, session_id, note, command, cwd, status, exit_code, started_at, ended_at, output, stderr, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           note = excluded.note,
           command = excluded.command,
           cwd = excluded.cwd,
           status = excluded.status,
           exit_code = excluded.exit_code,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           output = excluded.output,
           stderr = excluded.stderr,
           truncated = excluded.truncated`
      )
      .run(
        id,
        owner,
        String(job?.note || ''),
        String(job?.command || ''),
        String(job?.cwd || ''),
        String(job?.status || 'done'),
        Number.isInteger(job?.exitCode) ? job.exitCode : null,
        Number(job?.startedAt) || now,
        Number(job?.endedAt) || now,
        String(job?.output || ''),
        String(job?.stderr || ''),
        job?.truncated ? 1 : 0,
        now
      );
    return id;
  } catch (error) {
    console.error('archive background job failed', error);
    return null;
  }
}

function listArchivedJobs(sessionIds) {
  const ids = [...new Set((sessionIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return openDb()
    .prepare(
      `SELECT id, session_id, note, command, cwd, status, exit_code, started_at, ended_at, truncated,
              substr(output, -600) AS output_preview,
              substr(stderr, -300) AS stderr_preview
       FROM archive_jobs
       WHERE session_id IN (${placeholders})
       ORDER BY ended_at DESC`
    )
    .all(...ids)
    .map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      note: row.note ? String(row.note) : '',
      command: row.command ? String(row.command) : '',
      cwd: row.cwd ? String(row.cwd) : '',
      status: row.status ? String(row.status) : 'done',
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      startedAt: row.started_at === null ? null : Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      truncated: Boolean(row.truncated),
      outputPreview: row.output_preview ? String(row.output_preview) : '',
      stderrPreview: row.stderr_preview ? String(row.stderr_preview) : '',
    }));
}

function getArchivedJob(jobId) {
  const id = String(jobId || '');
  if (!id) return null;
  const row = openDb()
    .prepare(
      `SELECT id, session_id, note, command, cwd, status, exit_code, started_at, ended_at, output, stderr, truncated
       FROM archive_jobs WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    note: row.note ? String(row.note) : '',
    command: row.command ? String(row.command) : '',
    cwd: row.cwd ? String(row.cwd) : '',
    status: row.status ? String(row.status) : 'done',
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    endedAt: row.ended_at === null ? null : Number(row.ended_at),
    output: row.output ? String(row.output) : '',
    stderr: row.stderr ? String(row.stderr) : '',
    truncated: Boolean(row.truncated),
  };
}

function deleteSessionsTree(sessionId) {
  const ids = sessionSubtreeIds(sessionId);
  if (ids.length === 0) return [];
  const database = openDb();
  const placeholders = ids.map(() => '?').join(',');
  database
    .prepare(`DELETE FROM archive_jobs WHERE session_id IN (${placeholders})`)
    .run(...ids);
  database
    .prepare(`DELETE FROM runs WHERE session_id IN (${placeholders})`)
    .run(...ids);
  database
    .prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`)
    .run(...ids);
  return ids;
}

function updateSessionGoal(sessionId, goal) {
  const database = openDb();
  const normalized = goal === null || goal === undefined ? null : normalizeGoal(goal);
  database
    .prepare('UPDATE sessions SET goal = ?, updated_at = ? WHERE id = ?')
    .run(normalized ? JSON.stringify(normalized) : null, Date.now(), sessionId);
  return normalized;
}

function updateSessionCompaction(sessionId, compaction) {
  const database = openDb();
  const normalized =
    compaction === null || compaction === undefined
      ? null
      : normalizeCompaction(compaction);
  database
    .prepare('UPDATE sessions SET compaction = ?, updated_at = ? WHERE id = ?')
    .run(
      normalized ? JSON.stringify(normalized) : null,
      Date.now(),
      sessionId
    );
  return normalized;
}

function updateSessionAgentsMd(sessionId, text) {
  const database = openDb();
  const value = text === null || text === undefined ? null : String(text);
  database
    .prepare('UPDATE sessions SET agents_md = ?, updated_at = ? WHERE id = ?')
    .run(value, Date.now(), sessionId);
  return value;
}

function appendMessage(sessionId, role, text, request, usage = null, images = null) {
  const database = openDb();
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(seq) + 1, 0) AS seq FROM messages WHERE session_id = ?'
    )
    .get(sessionId);
  const seq = Number(row?.seq) || 0;
  const normalizedImages = attachments.normalizeImages(images);
  database
    .prepare(
      'INSERT INTO messages (session_id, seq, role, text, request, usage, images) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      sessionId,
      seq,
      normalizeRole(role),
      String(text ?? ''),
      request === undefined ? null : request,
      usage && typeof usage === 'object' ? JSON.stringify(usage) : null,
      normalizedImages.length > 0 ? JSON.stringify(normalizedImages) : null
    );
  database
    .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
  return seq;
}

function createSession(session) {
  const database = openDb();
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(sort_order) + 1, 0) AS sort_order FROM sessions'
    )
    .get();
  const order = Number(row?.sort_order) || 0;
  const id = String(session?.id || crypto.randomUUID());
  const source = session && typeof session === 'object' ? session : {};
  const mcpDisabled = Array.isArray(source.mcpDisabled)
    ? source.mcpDisabled.map(String).filter(Boolean)
    : [];
  const compaction = source.compaction
    ? normalizeCompaction(source.compaction)
    : null;
  const pendingQueue = normalizePendingQueue(source.pendingQueue);
  const frozen = source.frozen === true || source.frozen === 1;
  const subagent = source.subagent === true || source.subagent === 1;
  const managerId = source.managerId ? String(source.managerId) : null;
  const nodeRole =
    source.nodeRole === 'manager'
      ? 'manager'
      : source.nodeRole === 'work' || managerId
        ? 'work'
        : null;
  const nodeConfig = normalizeNodeConfig(source.nodeConfig);
  const hash = metadataHash({
    title: source.title,
    system: source.system,
    agentId: source.agentId,
    projectId: source.projectId,
    subagent,
    parentSessionId: source.parentSessionId || null,
    nodeRole,
    managerId,
    nodeConfig,
    mcpDisabled,
  });
  database
    .prepare(
      `INSERT INTO sessions
         (id, title, system, agents_md, agent_id, project_id, frozen, subagent, parent_session_id, node_role, manager_id, node_config, mcp_disabled,
          fold_state, pending_queue, goal, compaction, sort_order, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      String(source.title || 'Chat'),
      String(source.system ?? DEFAULT_SYSTEM_PROMPT),
      source.agentsMd === null || source.agentsMd === undefined
        ? null
        : String(source.agentsMd),
      String(source.agentId || DEFAULT_AGENT_ID),
      source.projectId || null,
      frozen ? 1 : 0,
      subagent ? 1 : 0,
      source.parentSessionId || null,
      nodeRole,
      managerId,
      nodeConfig ? JSON.stringify(nodeConfig) : null,
      JSON.stringify(mcpDisabled),
      null,
      JSON.stringify(pendingQueue),
      null,
      compaction ? JSON.stringify(compaction) : null,
      order,
      hash,
      Date.now()
    );
  return id;
}

function getSession(sessionId) {
  const chats = loadChats();
  return (
    chats.sessions.find(
      (session) => session.id === String(sessionId || '')
    ) || null
  );
}

function nextSessionTitle(base) {
  const chats = loadChats();
  let max = 0;
  for (const session of chats.sessions) {
    const match = String(session.title || '').match(/^#(\d+)-/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const cleaned = String(base || '')
    .replace(/^#\d+-/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `#${max + 1}-${cleaned || 'Chat'}`;
}

function forkSession(sourceId, options = {}) {
  const chats = loadChats();
  const source = chats.sessions.find(
    (session) => session.id === String(sourceId || '')
  );
  if (!source) {
    const error = new Error('session not found');
    error.status = 404;
    throw error;
  }
  const id = crypto.randomUUID();
  createSession({
    id,
    title: String(options.title || source.title || 'Chat'),
    system: source.system,
    agentsMd: source.agentsMd,
    agentId: source.agentId,
    projectId: options.projectId || source.projectId,
    frozen: options.frozen === true,
    subagent: options.subagent === true,
    parentSessionId:
      options.parentSessionId !== undefined
        ? options.parentSessionId
        : source.parentSessionId || null,
    mcpDisabled: Array.isArray(options.mcpDisabled)
      ? options.mcpDisabled
      : source.mcpDisabled,
    nodeRole:
      options.nodeRole !== undefined ? options.nodeRole : source.nodeRole,
    managerId:
      options.managerId !== undefined ? options.managerId : source.managerId,
    nodeConfig:
      options.nodeConfig !== undefined ? options.nodeConfig : source.nodeConfig,
    compaction: options.compaction === false ? null : source.compaction,
    pendingQueue: [],
  });
  if (options.copyMessages !== false) {
    let messages = source.msgs;
    if (
      options.dropTrailingAgent &&
      messages[messages.length - 1]?.role === 'Agent'
    ) {
      messages = messages.slice(0, -1);
    }
    for (const msg of messages) {
      const seq = appendMessage(id, msg.role, msg.text, msg.request, msg.usage);
      updateMessage(id, seq, msg);
    }
  }
  return getSession(id);
}

function setSessionFrozen(sessionId, frozen) {
  openDb()
    .prepare('UPDATE sessions SET frozen = ?, updated_at = ? WHERE id = ?')
    .run(frozen ? 1 : 0, Date.now(), sessionId);
  return Boolean(frozen);
}

function setCurrentSession(sessionId) {
  openDb()
    .prepare('UPDATE app_state SET current_session_id = ? WHERE id = 1')
    .run(sessionId || null);
  return sessionId || null;
}

function updateSessionNode(sessionId, patch = {}) {
  const current = getSession(sessionId);
  if (!current) {
    const error = new Error('session not found');
    error.status = 404;
    throw error;
  }
  const next = { ...current, ...patch };
  const managerId =
    patch.managerId !== undefined
      ? patch.managerId
        ? String(patch.managerId)
        : null
      : current.managerId || null;
  const nodeRole =
    patch.nodeRole !== undefined
      ? patch.nodeRole === 'manager' || patch.nodeRole === 'work'
        ? patch.nodeRole
        : null
      : current.nodeRole || null;
  const nodeConfig =
    patch.nodeConfig !== undefined
      ? normalizeNodeConfig(patch.nodeConfig)
      : current.nodeConfig;
  const mcpDisabled =
    patch.mcpDisabled !== undefined
      ? Array.isArray(patch.mcpDisabled)
        ? patch.mcpDisabled.map(String).filter(Boolean)
        : []
      : current.mcpDisabled || [];
  openDb()
    .prepare(
      `UPDATE sessions
       SET title = ?, agent_id = ?, project_id = ?, node_role = ?, manager_id = ?, node_config = ?, mcp_disabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      String(next.title || 'Chat'),
      String(next.agentId || DEFAULT_AGENT_ID),
      next.projectId || null,
      nodeRole,
      managerId,
      nodeConfig ? JSON.stringify(nodeConfig) : null,
      JSON.stringify(mcpDisabled),
      Date.now(),
      sessionId
    );
  return getSession(sessionId);
}

function listWorkNodes(managerId) {
  const id = String(managerId || '').trim();
  if (!id) return [];
  return loadChats().sessions.filter(
    (session) => session.managerId === id && session.nodeRole !== 'manager'
  );
}

function detachWorkNodes(managerId) {
  const id = String(managerId || '').trim();
  if (!id) return 0;
  const result = openDb()
    .prepare(
      'UPDATE sessions SET manager_id = NULL, updated_at = ? WHERE manager_id = ?'
    )
    .run(Date.now(), id);
  return Number(result.changes) || 0;
}

function updateSessionPendingQueue(sessionId, queue) {
  const normalized = normalizePendingQueue(queue);
  openDb()
    .prepare('UPDATE sessions SET pending_queue = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(normalized), Date.now(), sessionId);
  return normalized;
}

function updateMessage(sessionId, seq, msg) {
  const database = openDb();
  const steps = Array.isArray(msg?.steps)
    ? msg.steps.map(normalizeStep).filter(Boolean)
    : [];
  const requests = Array.isArray(msg?.requests) ? msg.requests : [];
  const usage =
    msg?.usage && typeof msg.usage === 'object'
      ? JSON.stringify(msg.usage)
      : null;
  const images = attachments.normalizeImages(msg?.images);

  const update = database.prepare(
    'UPDATE messages SET text = ?, request = ?, usage = ?, images = ? WHERE session_id = ? AND seq = ?'
  );
  const deleteSteps = database.prepare(
    'DELETE FROM steps WHERE session_id = ? AND message_seq = ?'
  );
  const insertStep = database.prepare(
    `INSERT INTO steps
       (session_id, message_seq, seq, kind, round, text, name, arguments, output, ok, label, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const deleteRequests = database.prepare(
    'DELETE FROM requests WHERE session_id = ? AND message_seq = ?'
  );
  const insertRequest = database.prepare(
    'INSERT INTO requests (session_id, message_seq, round, body) VALUES (?, ?, ?, ?)'
  );
  const touch = database.prepare(
    'UPDATE sessions SET updated_at = ? WHERE id = ?'
  );

  database.exec('BEGIN IMMEDIATE');
  try {
    update.run(
      String(msg?.text ?? ''),
      msg?.request === undefined ? null : msg.request,
      usage,
      images.length > 0 ? JSON.stringify(images) : null,
      sessionId,
      seq
    );

    deleteSteps.run(sessionId, seq);
    steps.forEach((step, index) => {
      insertStep.run(
        sessionId,
        seq,
        index,
        step.kind,
        Number.isInteger(step.round) ? step.round : 0,
        step.text ?? null,
        step.name ?? null,
        step.arguments ?? null,
        step.output ?? null,
        step.ok === false ? 0 : 1,
        step.label ?? null,
        step.metrics ? JSON.stringify(step.metrics) : null
      );
    });

    deleteRequests.run(sessionId, seq);
    requests.forEach((body, round) => {
      if (!body) return;
      insertRequest.run(
        sessionId,
        seq,
        round,
        zlib.gzipSync(Buffer.from(JSON.stringify(body), 'utf8'))
      );
    });

    touch.run(Date.now(), sessionId);
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function appendEvent(sessionId, runId, type, payload) {
  const database = openDb();
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(seq) + 1, 1) AS seq FROM events WHERE session_id = ?'
    )
    .get(sessionId);
  const seq = Number(row?.seq) || 0;
  const createdAt = Date.now();
  database
    .prepare(
      `INSERT INTO events (session_id, seq, run_id, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      seq,
      runId ?? null,
      String(type),
      JSON.stringify(payload ?? {}),
      createdAt
    );
  return {
    sessionId,
    seq,
    runId: runId ?? null,
    type: String(type),
    payload: payload ?? {},
    createdAt,
  };
}

function listEvents(sessionId, afterSeq = 0) {
  const rows = openDb()
    .prepare(
      `SELECT seq, run_id, type, payload, created_at
       FROM events
       WHERE session_id = ? AND seq > ?
       ORDER BY seq ASC`
    )
    .all(sessionId, Number(afterSeq) || 0);

  return rows.map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      /* ignore corrupt event payload */
    }
    return {
      sessionId,
      seq: Number(row.seq),
      runId: row.run_id,
      type: row.type,
      payload,
      createdAt: Number(row.created_at),
    };
  });
}

function lastEventSeq(sessionId) {
  const row = openDb()
    .prepare(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session_id = ?'
    )
    .get(sessionId);
  return Number(row?.seq) || 0;
}

function createRun(runId, sessionId, status = 'running') {
  const startedAt = Date.now();
  openDb()
    .prepare(
      'INSERT INTO runs (id, session_id, status, started_at) VALUES (?, ?, ?, ?)'
    )
    .run(runId, sessionId, status, startedAt);
  return { id: runId, sessionId, status, startedAt };
}

function updateRun(runId, status, error = null) {
  openDb()
    .prepare(
      'UPDATE runs SET status = ?, ended_at = ?, error = ? WHERE id = ?'
    )
    .run(status, Date.now(), error, runId);
}

function activeRunForSession(sessionId) {
  return (
    openDb()
      .prepare(
        `SELECT id, status FROM runs
         WHERE session_id = ? AND status IN ('running', 'queued')
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(sessionId) || null
  );
}

function listActiveRuns() {
  return openDb()
    .prepare(
      `SELECT id, session_id, status FROM runs
       WHERE status IN ('running', 'queued')
       ORDER BY started_at ASC`
    )
    .all()
    .map((row) => ({
      runId: String(row.id),
      sessionId: String(row.session_id),
      status: String(row.status || 'running'),
    }));
}

function interruptRuns() {
  openDb()
    .prepare(
      `UPDATE runs SET status = 'interrupted', ended_at = ?
       WHERE status IN ('running', 'queued')`
    )
    .run(Date.now());
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  init,
  close,
  defaultSettings,
  defaultChats,
  normalizeSettings,
  normalizeChats,
  loadSettings,
  saveSettings,
  loadChats,
  saveChats,
  saveStructure,
  deleteSession,
  sessionSubtreeIds,
  archiveSubagent,
  archiveUnfinishedSubagents,
  archiveBackgroundJob,
  listArchivedJobs,
  getArchivedJob,
  deleteSessionsTree,
  appendMessage,
  createSession,
  getSession,
  updateSessionNode,
  listWorkNodes,
  detachWorkNodes,
  nextSessionTitle,
  forkSession,
  setSessionFrozen,
  setCurrentSession,
  updateSessionPendingQueue,
  updateMessage,
  updateSessionGoal,
  updateSessionCompaction,
  updateSessionAgentsMd,
  appendEvent,
  listEvents,
  lastEventSeq,
  createRun,
  updateRun,
  activeRunForSession,
  listActiveRuns,
  interruptRuns,
};
