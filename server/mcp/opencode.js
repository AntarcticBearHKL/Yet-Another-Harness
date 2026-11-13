'use strict';

// Discover MCP servers from OpenCode config layers. YAH keeps its own
// custom servers in mcp.json and merges these inherited servers on top,
// so edits in OpenCode show up without copying files around.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeServer } = require('./config');

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      } else if (ch === '\n') {
        out += ch;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonc(text) {
  const clean = stripTrailingCommas(
    stripJsonComments(String(text || '').replace(/^\uFEFF/, ''))
  );
  return JSON.parse(clean);
}

function looksLikeServer(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value.command || value.url || value.serverUrl || value.type || value.transport)
  );
}

function extractServerEntries(config) {
  const entries = [];
  const push = (name, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    entries.push({ name: String(name || ''), raw });
  };
  const mcp = config && typeof config.mcp === 'object' ? config.mcp : null;
  if (mcp) {
    if (mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)) {
      for (const [name, raw] of Object.entries(mcp.servers)) push(name, raw);
    } else {
      for (const [name, raw] of Object.entries(mcp)) {
        if (name === 'servers') continue;
        if (looksLikeServer(raw)) push(name, raw);
      }
    }
  }
  if (entries.length === 0 && config && typeof config.mcpServers === 'object') {
    for (const [name, raw] of Object.entries(config.mcpServers)) push(name, raw);
  }
  if (entries.length === 0 && config && typeof config.servers === 'object') {
    if (Array.isArray(config.servers)) {
      for (const raw of config.servers) {
        if (raw && typeof raw === 'object') push(raw.name || raw.title || '', raw);
      }
    } else {
      for (const [name, raw] of Object.entries(config.servers)) push(name, raw);
    }
  }
  return entries.filter((entry) => entry.name);
}

function detectWorkspace() {
  const explicit =
    process.env.YAH_MCP_WORKSPACE || process.env.MCP_VIEWER_WORKSPACE;
  if (explicit) return path.resolve(explicit);
  try {
    const settingsPath = path.join(
      os.homedir(),
      '.config',
      'openchamber',
      'settings.json'
    );
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const projects = Array.isArray(settings.projects) ? settings.projects : [];
    const active = projects.find(
      (project) => project && project.id === settings.activeProjectId
    );
    if (active?.path) return path.resolve(active.path);
    if (typeof settings.lastDirectory === 'string' && settings.lastDirectory.trim()) {
      return path.resolve(settings.lastDirectory);
    }
  } catch {
    /* OpenChamber is optional. */
  }
  return process.cwd();
}

function opencodeConfigDir() {
  const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), '.config'), 'opencode');
}

function ancestors(directory) {
  const folders = [];
  let current = path.resolve(directory);
  while (true) {
    folders.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return folders.reverse();
}

function openChamberManagedSources() {
  const instances = path.join(
    os.homedir(),
    '.config',
    'openchamber',
    'run',
    'instances'
  );
  try {
    return fs
      .readdirSync(instances, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(instances, entry.name, 'opencode.managed.json')
      )
      .filter((file) => fs.existsSync(file))
      .sort((left, right) => fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs);
  } catch {
    return [];
  }
}

function layeredSources(workspace) {
  const globalDir = opencodeConfigDir();
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const sources = [
    { path: path.join(globalDir, 'opencode.json'), kind: 'opencode-global' },
    { path: path.join(globalDir, 'opencode.jsonc'), kind: 'opencode-global' },
    { path: path.join(appData, 'opencode', 'opencode.json'), kind: 'opencode-appdata' },
    { path: path.join(appData, 'opencode', 'opencode.jsonc'), kind: 'opencode-appdata' },
    {
      path: path.join(localAppData, 'opencode', 'opencode.json'),
      kind: 'opencode-local',
    },
    {
      path: path.join(localAppData, 'opencode', 'opencode.jsonc'),
      kind: 'opencode-local',
    },
  ];
  const custom = process.env.OPENCODE_CONFIG?.trim();
  if (custom) {
    sources.push({ path: path.resolve(custom), kind: 'opencode-custom' });
  }
  for (const file of openChamberManagedSources()) {
    sources.push({ path: file, kind: 'opencode-managed' });
  }
  for (const folder of ancestors(workspace)) {
    sources.push({
      path: path.join(folder, 'opencode.json'),
      kind: 'opencode-project',
    });
    sources.push({
      path: path.join(folder, 'opencode.jsonc'),
      kind: 'opencode-project',
    });
    sources.push({
      path: path.join(folder, '.opencode', 'opencode.json'),
      kind: 'opencode-project',
    });
    sources.push({
      path: path.join(folder, '.opencode', 'opencode.jsonc'),
      kind: 'opencode-project',
    });
  }
  const seen = new Set();
  return sources.filter((source) => {
    const key = path.resolve(source.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSource(source) {
  if (!fs.existsSync(source.path)) {
    return {
      path: source.path,
      kind: source.kind,
      exists: false,
      serverCount: 0,
      servers: [],
    };
  }
  try {
    const data = parseJsonc(fs.readFileSync(source.path, 'utf8'));
    const entries = extractServerEntries(data);
    const servers = [];
    for (const entry of entries) {
      const server = normalizeServer(
        { ...entry.raw, name: entry.name },
        { id: `opencode:${entry.name}` }
      );
      if (!server) continue;
      server.name = entry.name;
      server.source = 'opencode';
      server.sourcePath = source.path;
      server.sourceKind = source.kind;
      server.enabled =
        entry.raw.enabled !== false && entry.raw.disabled !== true;
      servers.push(server);
    }
    return {
      path: source.path,
      kind: source.kind,
      exists: true,
      serverCount: servers.length,
      servers,
    };
  } catch (error) {
    return {
      path: source.path,
      kind: source.kind,
      exists: true,
      serverCount: 0,
      servers: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectOpenCodeServers() {
  const workspace = detectWorkspace();
  const sources = [];
  const merged = new Map();
  for (const layer of layeredSources(workspace)) {
    const parsed = readSource(layer);
    sources.push({
      path: parsed.path,
      kind: parsed.kind,
      exists: parsed.exists,
      serverCount: parsed.serverCount,
      error: parsed.error,
    });
    for (const server of parsed.servers) {
      merged.set(server.name, server);
    }
  }
  const primaryPath =
    [...sources]
      .reverse()
      .find((source) => source.exists && source.serverCount > 0)?.path || null;
  return {
    workspace,
    sources,
    primaryPath,
    servers: [...merged.values()],
    error:
      merged.size === 0
        ? '没有在 OpenCode 配置里找到 MCP 服务器。'
        : undefined,
  };
}

module.exports = {
  collectOpenCodeServers,
  detectWorkspace,
  extractServerEntries,
  layeredSources,
  parseJsonc,
  stripJsonComments,
  stripTrailingCommas,
  _test: {
    extractServerEntries,
    parseJsonc,
    stripJsonComments,
    stripTrailingCommas,
  },
};
