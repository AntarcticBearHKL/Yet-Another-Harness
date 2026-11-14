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

const DEFAULT_SYSTEM_PROMPT =
  'You are YAH - Yet Another Harness, a terse terminal coding assistant. Answer in plain text.';
const CHATS_DB = 'chats.db';
const SCHEMA_VERSION = 11;
const DEFAULT_PROJECT = { id: 'project-default', name: 'Project 1', directories: [] };

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
    window: null,
  };
}

function defaultChats() {
  // 允许没有会话：删光后保持空状态，不自动补一个空对话
  return {
    projects: [{ ...DEFAULT_PROJECT }],
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
    window,
  };
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  return value === 'agent' || value === 'assistant' ? 'Agent' : 'User';
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
  return { openKey, collapsedProcessKeys, viewMode };
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
    if (!text) continue;
    const skills = Array.isArray(item.skills)
      ? item.skills.map(normalizeQueueSkill).filter(Boolean).slice(0, 5)
      : [];
    out.push({
      text,
      skills,
      agentId: String(item.agentId || '').trim(),
    });
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
  if (projects.length === 0) {
    projects.push({ ...DEFAULT_PROJECT, directories: [] });
  }
  return projects;
}

function normalizeChats(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) {
    return defaultChats();
  }

  const projects = normalizeProjects(raw.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const fallbackProjectId = projects[0].id;

  const sessions = raw.sessions
    .filter((session) => session && typeof session === 'object')
    .map((session, index) => {
      const msgs = Array.isArray(session.msgs)
        ? session.msgs
            .filter((msg) => msg && typeof msg === 'object')
            .map((msg) => {
              const role = normalizeRole(msg.role);
              return {
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
            })
        : [];

      const projectId = projectIds.has(String(session.projectId))
        ? String(session.projectId)
        : fallbackProjectId;

      return {
        id: String(session.id || crypto.randomUUID()),
        title: String(session.title || `Chat ${index + 1}`),
        system: String(session.system ?? DEFAULT_SYSTEM_PROMPT),
        agentId: String(session.agentId || ''),
        projectId,
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
  agent_id TEXT,
  project_id TEXT,
  mcp_disabled TEXT,
  fold_state TEXT,
  pending_queue TEXT,
  goal TEXT,
  compaction TEXT,
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

    const projectCount =
      Number(database.prepare('SELECT COUNT(*) AS n FROM projects').get().n) || 0;
    if (projectCount === 0) {
      database
        .prepare('INSERT INTO projects (id, name, sort_order) VALUES (?, ?, 0)')
        .run(DEFAULT_PROJECT.id, DEFAULT_PROJECT.name);
    }
    const fallbackProject = database
      .prepare('SELECT id FROM projects ORDER BY sort_order ASC LIMIT 1')
      .get();
    database
      .prepare(
        "UPDATE sessions SET project_id = ? WHERE project_id IS NULL OR project_id = ''"
      )
      .run(fallbackProject.id);

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

function openDb() {
  if (db) return db;
  const database = new DatabaseSync(file(CHATS_DB));
  try {
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec('PRAGMA synchronous = NORMAL;');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec('PRAGMA busy_timeout = 5000;');
    ensureSchema(database);
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
        agentId: session.agentId || '',
        projectId: session.projectId,
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
  const projects = projectRows.length
    ? projectRows.map((row) => {
        let directories = [];
        try {
          directories = normalizeDirectories(JSON.parse(row.directories || '[]'));
        } catch {
          directories = [];
        }
        return { id: row.id, name: row.name, directories };
      })
    : [{ ...DEFAULT_PROJECT, directories: [] }];
  const projectIds = new Set(projects.map((project) => project.id));

  const sessionRows = database
    .prepare(
      'SELECT id, title, system, agent_id, project_id, mcp_disabled, fold_state, pending_queue, goal, compaction FROM sessions ORDER BY sort_order ASC'
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
      'SELECT session_id, seq, role, text, request, usage FROM messages ORDER BY session_id, seq'
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
      return [
        row.id,
        {
          id: row.id,
          title: row.title,
          system: row.system,
          agentId: row.agent_id || '',
          projectId: projectIds.has(row.project_id)
            ? row.project_id
            : projects[0].id,
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

  const upsertSession = database.prepare(
    `INSERT INTO sessions (id, title, system, agent_id, project_id, mcp_disabled, fold_state, pending_queue, goal, compaction, sort_order, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       system = excluded.system,
       agent_id = excluded.agent_id,
       project_id = excluded.project_id,
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
    'INSERT INTO messages (session_id, seq, role, text, request, usage) VALUES (?, ?, ?, ?, ?, ?)'
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
        session.agentId || '',
        session.projectId,
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
          msg.usage ? JSON.stringify(msg.usage) : null
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
      if (!incoming.has(id)) deleteSession.run(id);
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
        agentId: session.agentId || '',
        projectId: session.projectId,
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
  const normalized = normalizeChats(chats);
  const database = openDb();

  const upsertProject = database.prepare(
    `INSERT INTO projects (id, name, directories, sort_order)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       directories = excluded.directories,
       sort_order = excluded.sort_order`
  );
  const upsertSession = database.prepare(
    `INSERT INTO sessions (id, title, system, agent_id, project_id, mcp_disabled, fold_state, pending_queue, sort_order, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       system = excluded.system,
       agent_id = excluded.agent_id,
       project_id = excluded.project_id,
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
  const deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteProject = database.prepare('DELETE FROM projects WHERE id = ?');
  const existingSessions = new Set(
    database
      .prepare('SELECT id FROM sessions')
      .all()
      .map((row) => row.id)
  );
  const existingProjects = new Set(
    database
      .prepare('SELECT id FROM projects')
      .all()
      .map((row) => row.id)
  );

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
        session.agentId || '',
        session.projectId,
        JSON.stringify(session.mcpDisabled || []),
        session.foldState ? JSON.stringify(session.foldState) : null,
        JSON.stringify(session.pendingQueue || []),
        order,
        metadataHash(session),
        now
      );
    });

    for (const id of existingSessions) {
      if (!incomingSessions.has(id)) deleteSession.run(id);
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

function deleteSession(sessionId) {
  openDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
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

function appendMessage(sessionId, role, text, request) {
  const database = openDb();
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(seq) + 1, 0) AS seq FROM messages WHERE session_id = ?'
    )
    .get(sessionId);
  const seq = Number(row?.seq) || 0;
  database
    .prepare(
      'INSERT INTO messages (session_id, seq, role, text, request, usage) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      sessionId,
      seq,
      normalizeRole(role),
      String(text ?? ''),
      request === undefined ? null : request,
      null
    );
  database
    .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
  return seq;
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

  const update = database.prepare(
    'UPDATE messages SET text = ?, request = ?, usage = ? WHERE session_id = ? AND seq = ?'
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
  appendMessage,
  updateMessage,
  updateSessionGoal,
  updateSessionCompaction,
  appendEvent,
  listEvents,
  lastEventSeq,
  createRun,
  updateRun,
  activeRunForSession,
  interruptRuns,
};
