'use strict';

// 会话 / 设置的落盘。数据目录由 main.js 通过 init() 指定，默认
// %APPDATA%\miniharness-electron；第一次启动会尝试从旧的 Rust 版
// %APPDATA%\miniharness 迁移 chats.json / settings.json。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SYSTEM_PROMPT =
  'You are miniharness, a terse terminal coding assistant. Answer in plain text.';

let dataDir = null;
let legacyDir = null;

function init(app) {
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
    sidebarCollapsed: false,
    window: null,
  };
}

function defaultChats() {
  // 允许没有会话：删光后保持空状态，不自动补一个空对话
  return {
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
    sidebarCollapsed: raw.sidebarCollapsed === true,
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
  if (kind === 'text') {
    const text = String(step.text ?? '');
    return text ? { kind: 'text', text } : null;
  }
  if (kind === 'call') {
    const name = String(step.name ?? '');
    return name
      ? { kind: 'call', name, arguments: String(step.arguments ?? '') }
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
        }
      : null;
  }
  const label = String(step.label ?? '');
  return label ? { kind: 'status', label, ok: step.ok !== false } : null;
}

function normalizeChats(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) {
    return defaultChats();
  }

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
              };
            })
        : [];

      return {
        id: String(session.id || crypto.randomUUID()),
        title: String(session.title || `Chat ${index + 1}`),
        system: String(session.system ?? DEFAULT_SYSTEM_PROMPT),
        msgs,
      };
    });

  if (sessions.length === 0) {
    return { sessions: [], current: 0, seq: 0 };
  }

  const current = Math.min(
    sessions.length - 1,
    Math.max(0, Number.isInteger(raw.current) ? raw.current : 0)
  );

  return {
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

function loadChats() {
  const current = file('chats.json');
  if (fs.existsSync(current)) {
    try {
      return normalizeChats(readJson(current));
    } catch {
      try {
        fs.renameSync(current, `${current}.corrupt`);
      } catch {
        /* ignore */
      }
    }
  }

  if (legacyDir) {
    const legacy = legacyFile('chats.json');
    if (fs.existsSync(legacy)) {
      try {
        const migrated = normalizeChats(readJson(legacy));
        atomicWrite(current, migrated);
        return migrated;
      } catch {
        /* ignore */
      }
    }
  }
  return defaultChats();
}

function saveChats(chats) {
  const normalized = normalizeChats(chats);
  atomicWrite(file('chats.json'), normalized);
  return normalized;
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  init,
  defaultSettings,
  defaultChats,
  normalizeSettings,
  normalizeChats,
  loadSettings,
  saveSettings,
  loadChats,
  saveChats,
};
