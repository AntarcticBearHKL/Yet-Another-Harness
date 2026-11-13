'use strict';

// MCP server configuration store. Everything lives in
// %APPDATA%\yah\mcp.json, next to chats.db and settings.json.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG_FILE = 'mcp.json';

function stringMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key || '').trim();
    if (!name) continue;
    out[name] = String(value ?? '');
  }
  return out;
}

function normalizeTransport(raw, command, url) {
  const value = String(raw || '').trim().toLowerCase();
  if (['local', 'stdio', 'process'].includes(value)) return 'stdio';
  if (
    ['remote', 'http', 'streamable-http', 'streamablehttp', 'streamable_http'].includes(
      value
    )
  ) {
    return 'http';
  }
  if (value === 'sse' || value === 'legacy-sse') return 'sse';
  if (command) return 'stdio';
  if (url) return 'http';
  return 'stdio';
}

function normalizeServer(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let command = raw.command;
  let args = [];
  if (Array.isArray(command)) {
    const parts = command.map((item) => String(item ?? '')).filter(Boolean);
    command = parts.shift() || '';
    args = parts;
  } else {
    command = typeof command === 'string' ? command.trim() : '';
  }
  if (Array.isArray(raw.args)) {
    args = raw.args.map((item) => String(item ?? '')).filter(Boolean);
  } else if (typeof raw.args === 'string' && raw.args.trim()) {
    args = raw.args.trim().split(/\s+/);
  }

  const url = String(raw.url || raw.serverUrl || raw.endpoint || '').trim();
  const transport = normalizeTransport(raw.transport || raw.type, command, url);

  if (transport === 'stdio' && !command) return null;
  if (transport !== 'stdio' && !url) return null;
  if (url && !/^https?:\/\//i.test(url)) return null;

  const name = String(raw.name || raw.title || '').trim();
  if (!name) return null;

  const id =
    String(options.id || raw.id || '').trim() ||
    `mcp-${crypto.randomUUID()}`;

  return {
    id,
    name,
    transport,
    command: transport === 'stdio' ? command : '',
    args: transport === 'stdio' ? args : [],
    cwd: String(raw.cwd || raw.workingDirectory || '').trim(),
    env: stringMap(raw.env || raw.environment),
    url: transport === 'stdio' ? '' : url,
    headers: stringMap(raw.headers),
  };
}

function looksLikeServer(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value.command || value.url || value.serverUrl || value.type || value.transport)
  );
}

function deriveName(raw) {
  const explicit = String(raw.name || raw.title || '').trim();
  if (explicit) return explicit;
  const command = raw.command;
  if (Array.isArray(command) && command.length) {
    return path.basename(String(command[0])) || 'mcp-server';
  }
  if (typeof command === 'string' && command.trim()) {
    return path.basename(command.trim()) || 'mcp-server';
  }
  const url = String(raw.url || raw.serverUrl || '').trim();
  if (url) {
    try {
      return new URL(url).hostname || 'mcp-server';
    } catch {
      /* ignore */
    }
  }
  return 'mcp-server';
}

function uniqueName(name, used) {
  const base = String(name || 'mcp-server').trim() || 'mcp-server';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  const next = `${base} ${index}`;
  used.add(next);
  return next;
}

function parseConfigText(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  const entries = [];
  const push = (name, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    entries.push({ name: String(name || deriveName(raw)), raw });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === 'object') push(deriveName(item), item);
    }
  } else if (data && typeof data === 'object') {
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, raw] of Object.entries(data.mcpServers)) push(name, raw);
    } else if (
      data.mcp &&
      typeof data.mcp === 'object' &&
      data.mcp.servers &&
      typeof data.mcp.servers === 'object'
    ) {
      for (const [name, raw] of Object.entries(data.mcp.servers)) push(name, raw);
    } else if (data.mcp && typeof data.mcp === 'object') {
      for (const [name, raw] of Object.entries(data.mcp)) {
        if (name === 'servers') continue;
        if (looksLikeServer(raw)) push(name, raw);
      }
    } else if (data.servers) {
      if (Array.isArray(data.servers)) {
        for (const item of data.servers) {
          if (item && typeof item === 'object') push(deriveName(item), item);
        }
      } else if (typeof data.servers === 'object') {
        for (const [name, raw] of Object.entries(data.servers)) push(name, raw);
      }
    } else if (looksLikeServer(data)) {
      push(deriveName(data), data);
    }
  }

  if (entries.length === 0) {
    throw new Error('没有找到 MCP 服务器配置');
  }

  const used = new Set();
  const servers = [];
  for (const entry of entries) {
    const server = normalizeServer({ ...entry.raw, name: entry.name });
    if (!server) continue;
    server.name = uniqueName(server.name, used);
    servers.push(server);
  }
  if (servers.length === 0) {
    throw new Error('配置里的服务器缺少 command 或 url');
  }
  return servers;
}

class McpConfigStore {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, CONFIG_FILE);
    this.data = { servers: [] };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const raw = Array.isArray(parsed?.servers) ? parsed.servers : [];
      const used = new Set();
      const servers = [];
      for (const item of raw) {
        const server = normalizeServer(item, { id: item?.id });
        if (!server) continue;
        server.name = uniqueName(server.name, used);
        servers.push(server);
      }
      this.data = { servers };
    } catch {
      this.data = { servers: [] };
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.copyFileSync(tmp, this.file);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  list() {
    return this.data.servers.map((server) => ({ ...server }));
  }

  find(id) {
    return this.data.servers.find((server) => server.id === id) || null;
  }

  add(raw) {
    const server = normalizeServer(raw);
    if (!server) throw new Error('服务器配置不完整，需要 command 或 url');
    if (this.data.servers.some((item) => item.name === server.name)) {
      throw new Error(`已经存在同名服务器：${server.name}`);
    }
    this.data.servers.push(server);
    this.save();
    return server;
  }

  update(id, raw) {
    const index = this.data.servers.findIndex((server) => server.id === id);
    if (index < 0) throw new Error('服务器不存在');
    const server = normalizeServer(raw, { id });
    if (!server) throw new Error('服务器配置不完整，需要 command 或 url');
    if (
      this.data.servers.some(
        (item) => item.id !== id && item.name === server.name
      )
    ) {
      throw new Error(`已经存在同名服务器：${server.name}`);
    }
    this.data.servers[index] = server;
    this.save();
    return server;
  }

  remove(id) {
    const before = this.data.servers.length;
    this.data.servers = this.data.servers.filter((server) => server.id !== id);
    if (this.data.servers.length === before) return false;
    this.save();
    return true;
  }

  addMany(rawServers) {
    const used = new Set(this.data.servers.map((server) => server.name));
    const added = [];
    for (const raw of rawServers) {
      const server = normalizeServer(raw);
      if (!server) continue;
      server.name = uniqueName(server.name, used);
      this.data.servers.push(server);
      added.push(server);
    }
    if (added.length) this.save();
    return added;
  }
}

module.exports = {
  CONFIG_FILE,
  McpConfigStore,
  normalizeServer,
  parseConfigText,
  stringMap,
  uniqueName,
};
