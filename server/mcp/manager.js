'use strict';

const { EventEmitter } = require('node:events');
const { McpConfigStore, parseConfigText } = require('./config');
const { McpClient } = require('./client');
const {
  formatToolResult,
  formatResourceResult,
  formatPromptResult,
} = require('./format');
const registry = require('../../src/mcp-registry');

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

class McpManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.version = options.version || '0.3.0';
    this.store = new McpConfigStore(options.dataDir);
    this.clients = new Map();
    this.errors = new Map();
    this.connecting = new Map();
    this.retryTimers = new Map();
    this.retryCount = new Map();
    this.attemptedAt = new Map();
    this.stopped = false;
    this.subscribers = new Set();
    registry.setProvider({
      list: () => this.toolList(),
      callTool: (id, name, args) => this.callTool(id, name, args),
    });
  }

  start() {
    this.stopped = false;
    void this.connectAll();
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  broadcast(event) {
    for (const fn of [...this.subscribers]) {
      try {
        fn(event);
      } catch (error) {
        console.error('mcp subscriber failed', error);
      }
    }
  }

  emitState() {
    this.broadcast({ type: 'state', state: this.getState() });
  }

  getState() {
    return {
      servers: this.store.list().map((server) => this.summary(server)),
      configPath: this.store.file,
      version: this.version,
    };
  }

  summary(server) {
    const client = this.clients.get(server.id);
    const connected = client && client.status === 'connected';
    const status = client
      ? client.status
      : this.errors.has(server.id)
        ? 'error'
        : 'idle';
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      url: server.url,
      env: server.env,
      headers: server.headers,
      envKeys: Object.keys(server.env || {}),
      headerKeys: Object.keys(server.headers || {}),
      status,
      error: this.errors.get(server.id) || undefined,
      toolCount: connected ? client.tools.length : 0,
      resourceCount: connected
        ? client.resources.length + client.resourceTemplates.length
        : 0,
      promptCount: connected ? client.prompts.length : 0,
      connectedAt: connected ? client.connectedAt : 0,
      protocolVersion: connected ? client.protocolVersion : '',
      serverInfo: connected ? client.serverInfo : null,
    };
  }

  snapshot(id) {
    const server = this.store.find(id);
    if (!server) return null;
    const client = this.clients.get(id);
    const base = this.summary(server);
    if (!client) {
      return {
        ...base,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        capabilities: {},
        instructions: '',
        logs: [],
      };
    }
    const snapshot = client.snapshot();
    const exposed = new Map(
      registry
        .buildEntries()
        .map((entry) => [`${entry.serverId}\u0000${entry.toolName}`, entry.name])
    );
    return {
      ...base,
      ...snapshot,
      server: { ...server },
      tools: snapshot.tools.map((tool) => ({
        ...tool,
        exposedName:
          exposed.get(`${server.id}\u0000${tool.name}`) ||
          registry.exposedName(server.name, tool.name),
      })),
      resources: snapshot.resources,
      resourceTemplates: snapshot.resourceTemplates,
      prompts: snapshot.prompts,
      logs: snapshot.logs,
    };
  }

  toolList() {
    const out = [];
    for (const server of this.store.list()) {
      const client = this.clients.get(server.id);
      if (!client || client.status !== 'connected') continue;
      for (const tool of client.tools) {
        out.push({
          serverId: server.id,
          serverName: server.name,
          tool,
        });
      }
    }
    return out;
  }

  catalogEntries() {
    return this.store.list().map((server) => {
      const summary = this.summary(server);
      return {
        name: server.name,
        description:
          server.transport === 'stdio'
            ? [server.command, ...(server.args || [])].join(' ')
            : server.url,
        source: 'MCP',
        transport: server.transport,
        status: summary.status,
        toolCount: summary.toolCount,
        resourceCount: summary.resourceCount,
        promptCount: summary.promptCount,
      };
    });
  }

  attach(client) {
    const serverId = client.server.id;
    client.on('log', (entry) => {
      this.broadcast({ type: 'log', serverId, entry });
    });
    client.on('notification', (method, params) => {
      this.broadcast({ type: 'notification', serverId, method, params });
    });
    client.on('status', (status, error) => {
      if (status === 'error' && error) this.errors.set(serverId, error);
      if (status === 'connected') {
        this.errors.delete(serverId);
        this.retryCount.delete(serverId);
        const timer = this.retryTimers.get(serverId);
        if (timer) {
          clearTimeout(timer);
          this.retryTimers.delete(serverId);
        }
      }
      this.broadcast({ type: 'status', serverId, status, error });
      this.emitState();
    });
    client.on('capabilities', (payload) => {
      this.broadcast({ type: 'capabilities', serverId, ...payload });
      this.emitState();
    });
  }

  scheduleRetry(id) {
    if (this.stopped || !this.store.find(id)) return;
    const current = this.retryTimers.get(id);
    if (current) clearTimeout(current);
    const attempts = this.retryCount.get(id) || 0;
    this.retryCount.set(id, attempts + 1);
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempts, 4));
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      if (this.stopped || !this.store.find(id)) return;
      this.connect(id).catch(() => {
        /* retry is scheduled by connect() */
      });
    }, delay);
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  async connect(id) {
    const server = this.store.find(id);
    if (!server) throw new Error('MCP 服务器不存在');
    const existing = this.clients.get(id);
    if (existing && existing.status === 'connected') {
      return this.snapshot(id);
    }
    if (this.connecting.has(id)) return this.connecting.get(id);

    if (existing) {
      try {
        existing.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(id);
    }

    const client = new McpClient(server, { version: this.version });
    this.clients.set(id, client);
    this.attach(client);
    this.attemptedAt.set(id, Date.now());

    const promise = client
      .connect()
      .then(() => {
        this.errors.delete(id);
        this.emitState();
        return this.snapshot(id);
      })
      .catch((error) => {
        this.errors.set(id, errorMessage(error));
        this.emitState();
        this.scheduleRetry(id);
        throw error;
      })
      .finally(() => {
        this.connecting.delete(id);
      });
    this.connecting.set(id, promise);
    return promise;
  }

  async reconnect(id) {
    const client = this.clients.get(id);
    if (client) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(id);
    }
    this.errors.delete(id);
    this.retryCount.delete(id);
    const timer = this.retryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
    return this.connect(id);
  }

  async ensureConnections() {
    if (this.stopped) return;
    const now = Date.now();
    for (const server of this.store.list()) {
      const client = this.clients.get(server.id);
      if (client && (client.status === 'connected' || client.status === 'connecting')) {
        continue;
      }
      if (this.connecting.has(server.id)) continue;
      const last = this.attemptedAt.get(server.id) || 0;
      if (now - last < 8_000) continue;
      this.connect(server.id).catch(() => {
        /* status and retry handled inside connect */
      });
    }
  }

  async connectAll() {
    const servers = this.store.list();
    await Promise.allSettled(
      servers.map((server) =>
        this.connect(server.id).catch(() => undefined)
      )
    );
  }

  async refresh(id) {
    const client = this.clients.get(id);
    if (!client || client.status !== 'connected') {
      await this.connect(id);
    }
    const active = this.clients.get(id);
    if (!active || active.status !== 'connected') {
      throw new Error('MCP 服务器未连接');
    }
    const payload = await active.refreshCapabilities();
    this.emitState();
    return { ...payload, server: this.summary(this.store.find(id)) };
  }

  async reload() {
    const previous = new Map(
      this.store.list().map((server) => [server.id, server])
    );
    this.store.load();
    const next = new Map(
      this.store.list().map((server) => [server.id, server])
    );
    for (const [id, client] of this.clients) {
      const server = next.get(id);
      const before = previous.get(id);
      const changed =
        !server ||
        !before ||
        JSON.stringify(server) !== JSON.stringify(before);
      if (!changed) continue;
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(id);
      this.errors.delete(id);
      this.retryCount.delete(id);
      const timer = this.retryTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(id);
      }
    }
    this.emitState();
    await this.connectAll();
    return this.getState();
  }

  async callTool(id, name, args) {
    const client = await this.requireClient(id);
    const response = await client.callTool(name, args);
    return {
      ...response,
      text: formatToolResult(response),
    };
  }

  async readResource(id, uri) {
    const client = await this.requireClient(id);
    const response = await client.readResource(uri);
    return {
      ...response,
      text: formatResourceResult(response),
    };
  }

  async getPrompt(id, name, args) {
    const client = await this.requireClient(id);
    const response = await client.getPrompt(name, args);
    return {
      ...response,
      text: formatPromptResult(response),
    };
  }

  async requireClient(id) {
    let client = this.clients.get(id);
    if (!client || client.status !== 'connected') {
      await this.connect(id).catch(() => undefined);
      client = this.clients.get(id);
    }
    if (!client || client.status !== 'connected') {
      throw new Error('MCP 服务器未连接');
    }
    return client;
  }

  addServer(input) {
    const server = this.store.add(input);
    this.emitState();
    this.connect(server.id).catch(() => undefined);
    return { server: this.summary(server), state: this.getState() };
  }

  importServers(text) {
    const servers = parseConfigText(text);
    const added = this.store.addMany(servers);
    this.emitState();
    for (const server of added) {
      this.connect(server.id).catch(() => undefined);
    }
    return {
      added: added.map((server) => this.summary(server)),
      state: this.getState(),
    };
  }

  updateServer(id, input) {
    const server = this.store.update(id, input);
    const client = this.clients.get(id);
    if (client) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(id);
    }
    this.errors.delete(id);
    this.retryCount.delete(id);
    const timer = this.retryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
    this.emitState();
    this.connect(server.id).catch(() => undefined);
    return { server: this.summary(server), state: this.getState() };
  }

  removeServer(id) {
    const server = this.store.find(id);
    if (!server) throw new Error('MCP 服务器不存在');
    const client = this.clients.get(id);
    if (client) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(id);
    }
    this.errors.delete(id);
    this.retryCount.delete(id);
    const timer = this.retryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
    this.store.remove(id);
    this.emitState();
    return this.getState();
  }

  clearLogs(id) {
    const client = this.clients.get(id);
    if (client) client.clearLogs();
    this.broadcast({ type: 'logs.cleared', serverId: id });
    return { ok: true };
  }

  closeAll() {
    this.stopped = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.connecting.clear();
  }
}

module.exports = { McpManager };
