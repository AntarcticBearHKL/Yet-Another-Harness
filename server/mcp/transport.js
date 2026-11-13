'use strict';

// MCP transports: STDIO child process, Streamable HTTP and legacy SSE.
// The STDIO spawner resolves Windows .cmd/.bat shims (npx, uv, etc.)
// without pulling in an external dependency.

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT = 180_000;

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function windowsExtensions() {
  return String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCommand(command, cwd) {
  const raw = String(command || '').trim();
  if (!raw) return raw;
  const hasSeparator = /[\\/]/.test(raw);
  if (hasSeparator || path.isAbsolute(raw)) {
    const base = path.isAbsolute(raw)
      ? raw
      : path.resolve(cwd || process.cwd(), raw);
    if (process.platform === 'win32' && !path.extname(base)) {
      for (const ext of windowsExtensions()) {
        if (isFile(`${base}${ext}`)) return `${base}${ext}`;
      }
    }
    return base;
  }

  const dirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const extensions =
    process.platform === 'win32' ? windowsExtensions() : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${raw}${ext}`);
      if (isFile(candidate)) return candidate;
    }
    const exact = path.join(dir, raw);
    if (isFile(exact)) return exact;
  }
  return raw;
}

const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(value) {
  return String(value).replace(META_CHARS, '^$1');
}

function escapeArgument(value, doubleEscapeMetaChars) {
  let arg = `${value}`;
  // Backslashes before a quote: double them and escape the quote.
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  // Backslashes at the end: double them before the closing quote.
  arg = arg.replace(/(?=(\\+?)?)\1$/, '$1$1');
  arg = `"${arg}"`;
  arg = arg.replace(META_CHARS, '^$1');
  if (doubleEscapeMetaChars) arg = arg.replace(META_CHARS, '^$1');
  return arg;
}

function spawnCommand(command, args, options) {
  const resolved = resolveCommand(command, options.cwd);
  const isBatch =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  if (!isBatch) return spawn(resolved, args, options);

  const comspec = process.env.ComSpec || process.env.comspec || 'cmd.exe';
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(
    resolved
  );
  const line = [
    escapeCommand(resolved),
    ...args.map((arg) => escapeArgument(arg, doubleEscape)),
  ].join(' ');
  return spawn(comspec, ['/d', '/s', '/c', `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

function splitLines(buffer, chunk) {
  const text = buffer + chunk.toString('utf8');
  const lines = text.split(/\r?\n/);
  return { lines: lines.slice(0, -1), rest: lines[lines.length - 1] };
}

class StdioTransport extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.child = null;
    this.closed = false;
    this.stderrBuffer = '';
  }

  async start() {
    if (!this.server.command) {
      throw new Error('STDIO server has no command');
    }
    const args = Array.isArray(this.server.args) ? this.server.args : [];
    const env = { ...process.env, ...(this.server.env || {}) };
    const child = spawnCommand(this.server.command, args, {
      cwd: this.server.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.on('error', (error) => {
      if (this.closed) return;
      this.emit('log', 'stderr', `Failed to start process: ${error.message}`);
      this.finish(error);
    });
    child.on('exit', (code, signal) => {
      if (this.closed) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.emit('log', 'info', `Process exited (${reason})`);
      this.finish(new Error(`MCP process exited (${reason})`));
    });
    child.stdin.on('error', (error) => {
      if (!this.closed) this.emit('log', 'stderr', `stdin: ${error.message}`);
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        this.emit('log', 'stdout', trimmed);
        return;
      }
      for (const item of Array.isArray(message) ? message : [message]) {
        this.emit('message', item);
      }
    });

    child.stderr.on('data', (chunk) => {
      const { lines, rest } = splitLines(this.stderrBuffer, chunk);
      this.stderrBuffer = rest;
      for (const line of lines) {
        if (line.trim()) this.emit('log', 'stderr', line);
      }
    });

    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.removeListener('error', onError);
        resolve();
      };
      const onError = (error) => {
        child.removeListener('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  send(message) {
    if (!this.child || this.closed || !this.child.stdin.writable) {
      throw new Error('STDIO transport is not writable');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  finish(error) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', error || null);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    const pid = child.pid;
    if (pid && process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      });
    } else {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 800).unref?.();
      } catch {
        /* ignore */
      }
    }
    this.emit('close', null);
  }
}

function parseSseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

class HttpTransport extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.sessionId = '';
    this.protocolVersion = '';
    this.controllers = new Set();
    this.closed = false;
    this.listenStarted = false;
    this.listenController = null;
  }

  async start() {
    let parsed;
    try {
      parsed = new URL(this.server.url);
    } catch {
      throw new Error(`Invalid MCP URL: ${this.server.url}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('MCP URL must use http or https');
    }
  }

  headers() {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.server.headers || {}),
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) {
      headers['mcp-protocol-version'] = this.protocolVersion;
    }
    return headers;
  }

  async send(message) {
    if (this.closed) throw new Error('HTTP transport is closed');
    const isRequest = message.id !== undefined && message.id !== null;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new Error('Request timed out')),
      isRequest ? DEFAULT_TIMEOUT : 30_000
    );
    try {
      const response = await fetch(this.server.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId) this.sessionId = sessionId;
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status}${body ? `: ${body.slice(0, 800)}` : ''}`
        );
      }
      if (response.status === 202 || response.status === 204) return;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await this.readSse(
          response,
          controller,
          isRequest ? message.id : undefined
        );
        return;
      }
      const text = await response.text();
      if (!text.trim()) return;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response: ${text.slice(0, 500)}`);
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        this.emit('message', item);
      }
    } catch (error) {
      if (this.closed) return;
      if (error && error.name === 'AbortError') {
        if (!isRequest) return;
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  startListening() {
    if (this.listenStarted || this.closed) return;
    this.listenStarted = true;
    const controller = new AbortController();
    this.listenController = controller;
    const headers = this.headers();
    delete headers['content-type'];
    headers.accept = 'text/event-stream';
    void (async () => {
      try {
        const response = await fetch(this.server.url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 404 && response.status !== 405) {
            this.emit(
              'log',
              'stderr',
              `Standalone SSE listener: HTTP ${response.status}`
            );
          }
          return;
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) return;
        await this.readSse(response, controller);
      } catch (error) {
        if (!this.closed && error && error.name !== 'AbortError') {
          this.emit(
            'log',
            'stderr',
            `Standalone SSE listener: ${error.message}`
          );
        }
      }
    })();
  }

  async readSse(response, controller, stopId) {
    if (!response.body) throw new Error('MCP server returned an empty SSE stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event || event.event === 'ping') continue;
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            this.emit('log', 'stdout', event.data);
            continue;
          }
          for (const item of Array.isArray(message) ? message : [message]) {
            this.emit('message', item);
            if (
              stopId !== undefined &&
              item &&
              String(item.id) === String(stopId)
            ) {
              controller.abort();
              return;
            }
          }
        }
      }
    } catch (error) {
      if (this.closed || (error && error.name === 'AbortError')) return;
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.controllers) {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    }
    this.controllers.clear();
    try {
      this.listenController?.abort();
    } catch {
      /* ignore */
    }
    this.emit('close', null);
  }
}

class SseTransport extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.endpoint = '';
    this.controller = new AbortController();
    this.closed = false;
    this.endpointPromise = null;
    this.resolveEndpoint = null;
  }

  async start() {
    let parsed;
    try {
      parsed = new URL(this.server.url);
    } catch {
      throw new Error(`Invalid MCP URL: ${this.server.url}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('MCP URL must use http or https');
    }
    this.endpointPromise = new Promise((resolve) => {
      this.resolveEndpoint = resolve;
    });
    const headers = {
      accept: 'text/event-stream',
      ...(this.server.headers || {}),
    };
    const response = await fetch(this.server.url, {
      headers,
      signal: this.controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while opening SSE stream`);
    }
    if (!response.body) throw new Error('MCP server returned an empty SSE stream');
    void this.readLoop(response);
    const timeout = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out waiting for SSE endpoint event')),
        20_000
      ).unref?.();
    });
    await Promise.race([this.endpointPromise, timeout]);
  }

  async readLoop(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event || event.event === 'ping') continue;
          if (event.event === 'endpoint') {
            this.endpoint = new URL(event.data, this.server.url).toString();
            this.resolveEndpoint?.(this.endpoint);
            continue;
          }
          try {
            const message = JSON.parse(event.data);
            for (const item of Array.isArray(message) ? message : [message]) {
              this.emit('message', item);
            }
          } catch {
            this.emit('log', 'stdout', event.data);
          }
        }
      }
    } catch (error) {
      if (!this.closed && error && error.name !== 'AbortError') {
        this.emit('log', 'stderr', `SSE stream: ${error.message}`);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      if (!this.closed) this.emit('close', new Error('SSE stream ended'));
    }
  }

  async send(message) {
    if (!this.endpoint) throw new Error('SSE endpoint is not ready');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.server.headers || {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}${body ? `: ${body.slice(0, 800)}` : ''}`
      );
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.emit('close', null);
  }
}

function createTransport(server) {
  if (server.transport === 'stdio') return new StdioTransport(server);
  if (server.transport === 'sse') return new SseTransport(server);
  return new HttpTransport(server);
}

module.exports = {
  createTransport,
  StdioTransport,
  HttpTransport,
  SseTransport,
  resolveCommand,
  spawnCommand,
  parseSseBlock,
};
