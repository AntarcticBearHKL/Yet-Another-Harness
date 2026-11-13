'use strict';

// Minimal MCP client: JSON-RPC peer + initialize handshake + capability cache.
// Ported from MCPFox's client so YAH speaks the same protocol version and
// methods.

const { EventEmitter } = require('node:events');
const { createTransport } = require('./transport');

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const MAX_LOGS = 800;

function truncate(value, length = 1400) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

class JsonRpcPeer extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = transport;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (message) => this.handleMessage(message);
    this.onClose = (error) => this.close(error);
    transport.on('message', this.onMessage);
    transport.on('close', this.onClose);
  }

  sendRaw(message) {
    try {
      const sent = this.transport.send(message);
      if (sent && typeof sent.catch === 'function') {
        sent.catch(() => {
          /* ignored */
        });
      }
    } catch {
      /* ignored */
    }
  }

  request(method, params, timeoutMs = 60_000) {
    if (this.closed) {
      return Promise.reject(new Error('MCP connection is closed'));
    }
    const id = this.nextId++;
    this.emit('protocol', `→ ${method} #${id} ${truncate(params ?? {})}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `${method} timed out after ${Math.round(timeoutMs / 1000)}s`
          )
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        const sent = this.transport.send({
          jsonrpc: '2.0',
          id,
          method,
          params: params ?? {},
        });
        if (sent && typeof sent.catch === 'function') {
          sent.catch((error) => {
            const pending = this.pending.get(id);
            if (!pending) return;
            this.pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(error);
          });
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (this.closed) throw new Error('MCP connection is closed');
    this.emit(
      'protocol',
      `→ ${method} ${params === undefined ? '' : truncate(params)}`.trim()
    );
    const message = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    return this.transport.send(message);
  }

  respond(id, result) {
    try {
      const sent = this.transport.send({ jsonrpc: '2.0', id, result });
      if (sent && typeof sent.catch === 'function') {
        sent.catch(() => {
          /* ignored */
        });
      }
    } catch {
      /* ignored */
    }
  }

  respondError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    try {
      const sent = this.transport.send({ jsonrpc: '2.0', id, error });
      if (sent && typeof sent.catch === 'function') {
        sent.catch(() => {
          /* ignored */
        });
      }
    } catch {
      /* ignored */
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (
      message.id !== undefined &&
      message.id !== null &&
      ('result' in message || 'error' in message)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        this.emit(
          'protocol',
          `← error #${message.id} ${message.error.message || ''}`
        );
        const error = new Error(message.error.message || 'MCP request failed');
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        this.emit('protocol', `← result #${message.id}`);
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method && message.id !== undefined && message.id !== null) {
      this.emit('protocol', `← request ${message.method} #${message.id}`);
      this.emit('server-request', message);
      if (message.method === 'ping') {
        this.respond(message.id, {});
      } else if (message.method === 'roots/list') {
        this.respond(message.id, { roots: [] });
      } else if (message.method === 'elicitation/create') {
        this.respond(message.id, { action: 'decline' });
      } else if (message.method === 'sampling/createMessage') {
        this.respondError(
          message.id,
          -32601,
          'Sampling is not supported by YAH'
        );
      } else {
        this.respondError(
          message.id,
          -32601,
          `Unsupported server request: ${message.method}`
        );
      }
      return;
    }
    if (message.method) {
      this.emit('protocol', `← notification ${message.method}`);
      this.emit('notification', message.method, message.params);
    }
  }

  close(error) {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error || new Error('MCP connection closed'));
      this.pending.delete(id);
    }
    this.emit('close', error || null);
  }
}

async function listAll(peer, method, key, timeoutMs = 45_000) {
  const items = [];
  let cursor;
  let pages = 0;
  do {
    const params = cursor ? { cursor } : {};
    const result = await peer.request(method, params, timeoutMs);
    const page = result && Array.isArray(result[key]) ? result[key] : [];
    items.push(...page);
    cursor =
      result && typeof result.nextCursor === 'string'
        ? result.nextCursor
        : undefined;
    pages += 1;
  } while (cursor && pages < 100);
  return items;
}

class McpClient extends EventEmitter {
  constructor(server, options = {}) {
    super();
    this.server = server;
    this.version = options.version || '0.3.0';
    this.transport = null;
    this.peer = null;
    this.status = 'idle';
    this.protocolVersion = '';
    this.serverInfo = null;
    this.capabilities = {};
    this.instructions = '';
    this.tools = [];
    this.resources = [];
    this.resourceTemplates = [];
    this.prompts = [];
    this.logs = [];
    this.logSeq = 0;
    this.connectedAt = 0;
    this.closing = false;
  }

  addLog(stream, text) {
    const entry = {
      id: `log-${Date.now().toString(36)}-${this.logSeq++}`,
      ts: Date.now(),
      stream,
      text: String(text ?? ''),
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_LOGS);
    }
    this.emit('log', entry);
  }

  clearLogs() {
    this.logs = [];
  }

  setStatus(status, error) {
    this.status = status;
    this.emit('status', status, error);
  }

  async connect() {
    if (this.status === 'connected') return this.snapshot();
    if (this.status === 'connecting') throw new Error('Already connecting');
    this.closing = false;
    this.setStatus('connecting');
    this.addLog(
      'info',
      `Starting ${this.server.transport.toUpperCase()} transport`
    );
    const transport = createTransport(this.server);
    this.transport = transport;
    transport.on('log', (stream, text) => this.addLog(stream, text));
    const peer = new JsonRpcPeer(transport);
    this.peer = peer;
    peer.on('protocol', (text) => this.addLog('protocol', text));
    peer.on('notification', (method, params) => {
      this.emit('notification', method, params);
      if (
        method === 'notifications/tools/list_changed' ||
        method === 'notifications/resources/list_changed' ||
        method === 'notifications/prompts/list_changed'
      ) {
        void this.refreshCapabilities().catch((error) =>
          this.addLog('stderr', `Refresh failed: ${error.message}`)
        );
      }
    });
    peer.on('server-request', (message) => {
      this.addLog(
        'info',
        `Server request ${message.method} answered by YAH`
      );
    });
    peer.on('close', (error) => {
      if (this.closing) return;
      if (this.status === 'connected') {
        this.addLog('stderr', error ? error.message : 'Connection closed');
        this.setStatus(
          'error',
          error ? error.message : 'Connection closed'
        );
      }
    });

    try {
      await transport.start();
      const initialize = await peer.request(
        'initialize',
        {
          protocolVersion: DEFAULT_PROTOCOL_VERSION,
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: 'YAH', version: this.version },
        },
        30_000
      );
      if (!initialize || typeof initialize !== 'object') {
        throw new Error('Invalid initialize response');
      }
      this.protocolVersion =
        initialize.protocolVersion || DEFAULT_PROTOCOL_VERSION;
      if (transport.protocolVersion !== undefined) {
        transport.protocolVersion = this.protocolVersion;
      }
      this.serverInfo = initialize.serverInfo || {
        name: this.server.name,
        version: 'unknown',
      };
      this.capabilities = initialize.capabilities || {};
      this.instructions =
        typeof initialize.instructions === 'string'
          ? initialize.instructions
          : '';
      await peer.notify('notifications/initialized');
      if (typeof transport.startListening === 'function') {
        transport.startListening();
      }
      this.connectedAt = Date.now();
      this.setStatus('connected');
      await this.refreshCapabilities();
      return this.snapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addLog('stderr', `Connection failed: ${message}`);
      this.setStatus('error', message);
      try {
        transport.close();
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  async refreshCapabilities() {
    if (!this.peer || this.status !== 'connected') {
      throw new Error('MCP server is not connected');
    }
    try {
      this.tools = await listAll(this.peer, 'tools/list', 'tools');
    } catch (error) {
      this.tools = [];
      this.addLog('stderr', `tools/list failed: ${error.message}`);
    }
    if (this.capabilities && this.capabilities.resources) {
      try {
        this.resources = await listAll(
          this.peer,
          'resources/list',
          'resources'
        );
      } catch (error) {
        this.resources = [];
        this.addLog('stderr', `resources/list failed: ${error.message}`);
      }
      try {
        this.resourceTemplates = await listAll(
          this.peer,
          'resources/templates/list',
          'resourceTemplates'
        );
      } catch (error) {
        this.resourceTemplates = [];
        this.addLog(
          'stderr',
          `resources/templates/list failed: ${error.message}`
        );
      }
    } else {
      this.resources = [];
      this.resourceTemplates = [];
    }
    if (this.capabilities && this.capabilities.prompts) {
      try {
        this.prompts = await listAll(this.peer, 'prompts/list', 'prompts');
      } catch (error) {
        this.prompts = [];
        this.addLog('stderr', `prompts/list failed: ${error.message}`);
      }
    } else {
      this.prompts = [];
    }
    const payload = {
      tools: this.tools,
      resources: this.resources,
      resourceTemplates: this.resourceTemplates,
      prompts: this.prompts,
    };
    this.emit('capabilities', payload);
    return payload;
  }

  async callTool(name, args) {
    if (!this.peer || this.status !== 'connected') {
      return {
        ok: false,
        durationMs: 0,
        error: 'MCP server is not connected',
        request: { method: 'tools/call', params: { name, arguments: args } },
      };
    }
    const request = {
      method: 'tools/call',
      params: { name, arguments: args },
    };
    const started = Date.now();
    try {
      const result = await this.peer.request(
        'tools/call',
        { name, arguments: args },
        300_000
      );
      return { ok: true, durationMs: Date.now() - started, result, request };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        request,
      };
    }
  }

  async readResource(uri) {
    const started = Date.now();
    try {
      const result = await this.peer.request(
        'resources/read',
        { uri },
        120_000
      );
      return { ok: true, durationMs: Date.now() - started, result, uri };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        uri,
      };
    }
  }

  async getPrompt(name, args) {
    const started = Date.now();
    try {
      const result = await this.peer.request(
        'prompts/get',
        { name, arguments: args },
        120_000
      );
      return { ok: true, durationMs: Date.now() - started, result, name };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        name,
      };
    }
  }

  snapshot() {
    return {
      server: this.server,
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo,
      capabilities: this.capabilities,
      instructions: this.instructions,
      tools: this.tools,
      resources: this.resources,
      resourceTemplates: this.resourceTemplates,
      prompts: this.prompts,
      connectedAt: this.connectedAt,
      logs: this.logs.slice(-300),
    };
  }

  close() {
    this.closing = true;
    try {
      this.transport?.close();
    } catch {
      /* ignore */
    }
    this.setStatus('idle');
    this.transport = null;
    this.peer = null;
  }
}

module.exports = {
  McpClient,
  JsonRpcPeer,
  DEFAULT_PROTOCOL_VERSION,
  MAX_LOGS,
};
