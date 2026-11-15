'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { guardPath } = require('./guard');

const DEFAULT_PORT = 9222;
const MAX_PORT_TRIES = 30;
const MAX_TEXT = 20_000;
const MAX_HTML = 50_000;
const MAX_EVAL = 20_000;
const MAX_LOG = 300;
const MAX_REQUESTS = 300;
const CDP_TIMEOUT = 15_000;
const STATE_FILE = path.join(os.tmpdir(), 'yah-browser-state.json');

const ACTIONS = new Set([
  'launch',
  'open',
  'tabs',
  'activate',
  'read',
  'screenshot',
  'click',
  'type',
  'press',
  'eval',
  'wait',
  'console',
  'network',
  'devtools',
  'navigate',
  'back',
  'forward',
  'reload',
  'stop',
  'close',
  'status',
]);

const state = {
  port: 0,
  version: null,
  exe: '',
  profile: '',
  channel: '',
  pid: null,
  lastTargetId: '',
};

const clients = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function json(value) {
  return JSON.stringify(value);
}

function isChromeVersion(version) {
  if (!version || typeof version !== 'object') return false;
  const browser = String(version.Browser || '');
  const ua = String(version['User-Agent'] || '');
  if (/Electron/i.test(ua)) return false;
  return /^(Chrome|HeadlessChrome|Edg|Microsoft Edge)\//i.test(browser);
}

function normalizeUrl(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return options.allowBlank ? 'about:blank' : '';
  if (/^(https?|file|about|devtools|chrome|edge|view-source|data):/i.test(raw)) {
    return raw;
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return pathToFileURL(path.resolve(raw)).href;
  }
  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    return pathToFileURL(raw).href;
  }
  if (/^[\w.-]+:\d+(\/|$)/.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}

function localAppData() {
  return (
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share'))
  );
}

function chromeCandidates(channel) {
  const local = localAppData();
  const chrome = [
    process.env.YAH_CHROME_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ];
  return (channel === 'edge' ? [...edge, ...chrome] : [...chrome, ...edge]).filter(
    Boolean
  );
}

function findChrome(channel = 'chrome') {
  for (const candidate of chromeCandidates(channel)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  const commands =
    channel === 'edge'
      ? ['msedge.exe', 'msedge', 'microsoft-edge']
      : ['chrome.exe', 'chrome', 'google-chrome', 'chromium'];
  for (const command of commands) {
    try {
      const out = execFileSync(
        process.platform === 'win32' ? 'where.exe' : 'which',
        [command],
        { encoding: 'utf8', timeout: 2000, windowsHide: true }
      );
      const found = String(out).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (found && fs.existsSync(found)) return found;
    } catch {
      /* ignore */
    }
  }
  throw new Error(
    `Chrome/Edge was not found. Set YAH_CHROME_PATH or pass channel "chrome"/"edge". ` +
      `Tried: ${chromeCandidates(channel).join(', ')}`
  );
}

function resolveProfile(value) {
  const base = path.join(localAppData(), 'YAH', 'chrome-profile');
  const raw = String(value || '').trim();
  let dir;
  if (!raw) {
    dir = base;
  } else if (raw.toLowerCase() === 'temp') {
    dir = path.join(os.tmpdir(), 'yah-chrome-profile');
  } else if (path.isAbsolute(raw)) {
    dir = raw;
  } else {
    dir = path.join(path.dirname(base), 'chrome-profiles', raw.replace(/[^\w.-]+/g, '-'));
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildLaunchArgs(port, profile, options = {}) {
  const width = clamp(integer(options.width, 1440), 640, 3840);
  const height = clamp(integer(options.height, 960), 480, 2160);
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-features=Translate,MediaRouter',
    '--disable-popup-blocking',
    `--window-size=${width},${height}`,
    '--new-window',
  ];
  if (options.headless) args.push('--headless=new');
  if (options.devtools) args.push('--auto-open-devtools-for-tabs');
  args.push(options.url || 'about:blank');
  return args;
}

function loadSavedState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (data && Number.isFinite(Number(data.port)) && Number(data.port) > 0) {
      state.port = Number(data.port);
      state.profile = String(data.profile || '');
      state.exe = String(data.exe || '');
      state.channel = String(data.channel || '');
    }
  } catch {
    /* no saved state */
  }
}

function saveState() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          port: state.port,
          profile: state.profile,
          exe: state.exe,
          channel: state.channel,
          pid: state.pid,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    /* best effort */
  }
}

function clearState() {
  state.port = 0;
  state.version = null;
  state.exe = '';
  state.profile = '';
  state.channel = '';
  state.pid = null;
  state.lastTargetId = '';
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    /* ignore */
  }
}

async function fetchJson(port, pathname, timeout = 3000, init = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function probe(port) {
  if (!port) return null;
  try {
    const version = await fetchJson(port, '/json/version', 1200);
    return isChromeVersion(version) ? version : null;
  } catch {
    return null;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function waitForChrome(port, timeout = 20_000, spawnError = null) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (spawnError?.value) throw spawnError.value;
    const version = await probe(port);
    if (version) return version;
    await sleep(250);
  }
  return null;
}

async function waitForChromeGone(port, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const version = await probe(port);
    if (!version) return true;
    await sleep(200);
  }
  return false;
}

async function launchChrome(args, port, initialUrl) {
  const channel = String(args.channel || 'chrome').toLowerCase() === 'edge' ? 'edge' : 'chrome';
  const exe = findChrome(channel);
  const profile = resolveProfile(args.profile);
  const spawnError = { value: null };
  const child = spawn(exe, buildLaunchArgs(port, profile, { ...args, url: initialUrl }), {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.once('error', (error) => {
    spawnError.value = error;
  });
  child.unref();
  const version = await waitForChrome(port, 20_000, spawnError);
  if (!version) {
    throw new Error(
      `Chrome did not expose its debugging endpoint on 127.0.0.1:${port}. ` +
        `Profile: ${profile}. ${spawnError.value ? spawnError.value.message : ''}`
    );
  }
  state.port = port;
  state.version = version;
  state.exe = exe;
  state.profile = profile;
  state.channel = channel;
  state.pid = child.pid || null;
  state.lastTargetId = '';
  saveState();
  return { port, version, exe, profile, channel, launched: true, initialUrl };
}

function adoptPort(port, version) {
  state.port = port;
  state.version = version;
  state.pid = null;
  saveState();
}

async function ensureChrome(args = {}, options = {}) {
  const initialUrl = options.url ? normalizeUrl(options.url, { allowBlank: true }) : null;
  if (state.port) {
    const version = await probe(state.port);
    if (version) {
      state.version = version;
      return { port: state.port, version, launched: false, initialUrl: null };
    }
    state.port = 0;
  }
  const requested = integer(args.port, 0);
  if (requested) {
    const version = await probe(requested);
    if (version) {
      adoptPort(requested, version);
      return { port: requested, version, launched: false, initialUrl: null };
    }
    if (!(await portFree(requested))) {
      throw new Error(`port ${requested} is already in use by another program`);
    }
    return launchChrome(args, requested, initialUrl);
  }
  const defaultVersion = await probe(DEFAULT_PORT);
  if (defaultVersion) {
    adoptPort(DEFAULT_PORT, defaultVersion);
    return { port: DEFAULT_PORT, version: defaultVersion, launched: false, initialUrl: null };
  }
  let port = DEFAULT_PORT;
  while (port < DEFAULT_PORT + MAX_PORT_TRIES && !(await portFree(port))) port += 1;
  if (port >= DEFAULT_PORT + MAX_PORT_TRIES) {
    throw new Error('could not find a free port for Chrome remote debugging');
  }
  return launchChrome(args, port, initialUrl);
}

async function runningPort(args = {}) {
  const candidates = [state.port, integer(args.port, 0), DEFAULT_PORT].filter(Boolean);
  for (const port of [...new Set(candidates)]) {
    const version = await probe(port);
    if (version) {
      if (state.port !== port) adoptPort(port, version);
      state.version = version;
      return port;
    }
  }
  if (state.port) state.port = 0;
  return 0;
}

async function requirePort(args = {}) {
  const port = await runningPort(args);
  if (!port) {
    throw new Error(
      'Chrome is not running with remote debugging. Call the chrome tool with action "launch" or "open" first.'
    );
  }
  return port;
}

function isDevtoolsUrl(url) {
  const value = String(url || '');
  return value.startsWith('devtools://') || value.includes('/devtools/inspector.html');
}

async function listTabs(port) {
  const list = await fetchJson(port, '/json/list', 4000);
  if (!Array.isArray(list)) return [];
  return list
    .filter((tab) => tab && tab.type === 'page' && tab.webSocketDebuggerUrl)
    .map((tab) => ({
      id: String(tab.id || ''),
      title: String(tab.title || ''),
      url: String(tab.url || ''),
      type: String(tab.type || 'page'),
      devtools: isDevtoolsUrl(tab.url),
      webSocketDebuggerUrl: String(tab.webSocketDebuggerUrl || ''),
    }));
}

function publicTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    devtools: Boolean(tab.devtools),
    active: tab.id === state.lastTargetId,
  };
}

async function findTabById(port, id) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const tabs = await listTabs(port);
    const tab = tabs.find((item) => item.id === id);
    if (tab) return tab;
    await sleep(120);
  }
  return null;
}

class CdpClient {
  constructor(wsUrl) {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('WebSocket is unavailable; Node 22 or newer is required');
    }
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    this.ws = new globalThis.WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('CDP websocket open timeout'));
      }, 8000);
      this.ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      this.ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`CDP websocket error: ${wsUrl}`));
        },
        { once: true }
      );
    });
    this.ws.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.id) {
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        clearTimeout(entry.timer);
        if (data.error) {
          entry.reject(
            new Error(`${entry.method}: ${data.error.message || 'CDP error'}`)
          );
        } else {
          entry.resolve(data.result || {});
        }
        return;
      }
      if (data.method) this.emit(data.method, data.params || {});
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
      this.emit('close', {});
    });
  }

  static async open(wsUrl) {
    const client = new CdpClient(wsUrl);
    await client.ready;
    return client;
  }

  on(method, handler) {
    const set = this.handlers.get(method) || new Set();
    set.add(handler);
    this.handlers.set(method, set);
    return () => set.delete(handler);
  }

  emit(method, params) {
    const set = this.handlers.get(method);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(params);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  send(method, params = {}, timeout = CDP_TIMEOUT) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: CDP timeout after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function consoleArgText(arg) {
  if (!arg || typeof arg !== 'object') return String(arg ?? '');
  if (Object.prototype.hasOwnProperty.call(arg, 'value')) {
    const value = arg.value;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (arg.unserializableValue) return String(arg.unserializableValue);
  if (arg.description) return String(arg.description);
  if (arg.preview) {
    return `[${arg.preview.type || arg.type || 'object'}] ${arg.preview.description || ''}`.trim();
  }
  return String(arg.type || '');
}

function addConsole(entry, item) {
  if (entry.console.length >= MAX_LOG) entry.console.shift();
  entry.console.push(item);
}

function exceptionText(details) {
  if (!details) return 'evaluation failed';
  return (
    String(details.exception?.description || '').trim() ||
    String(details.text || '').trim() ||
    'evaluation failed'
  );
}

async function getClient(port, tab) {
  let target = tab;
  if (!target.webSocketDebuggerUrl) {
    const tabs = await listTabs(port);
    target = tabs.find((item) => item.id === tab.id) || target;
  }
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`tab ${target.id} has no debugging endpoint`);
  }
  const existing = clients.get(target.id);
  if (existing && !existing.client.closed) {
    existing.tab = target;
    return existing;
  }
  if (existing) {
    existing.client.close();
    clients.delete(target.id);
  }
  const client = await CdpClient.open(target.webSocketDebuggerUrl);
  const entry = {
    client,
    tab: target,
    console: [],
    requests: new Map(),
    attachedAt: Date.now(),
  };
  clients.set(target.id, entry);
  client.on('Runtime.consoleAPICalled', (params) => {
    const text = (params.args || []).map(consoleArgText).join(' ');
    const frame = params.stackTrace?.callFrames?.[0] || {};
    addConsole(entry, {
      kind: 'console',
      level: String(params.type || 'log'),
      text,
      url: String(frame.url || ''),
      line: Number(frame.lineNumber || 0),
      time: Date.now(),
    });
  });
  client.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {};
    addConsole(entry, {
      kind: 'exception',
      level: 'error',
      text: exceptionText(details),
      url: String(details.url || ''),
      line: Number(details.lineNumber || 0),
      time: Date.now(),
    });
  });
  client.on('Log.entryAdded', (params) => {
    const item = params.entry || {};
    addConsole(entry, {
      kind: 'log',
      level: String(item.level || 'info'),
      text: String(item.text || ''),
      url: String(item.url || ''),
      line: Number(item.lineNumber || 0),
      time: Date.now(),
    });
  });
  client.on('Network.requestWillBeSent', (params) => {
    if (!params.request) return;
    entry.requests.set(params.requestId, {
      requestId: params.requestId,
      method: String(params.request.method || 'GET'),
      url: String(params.request.url || ''),
      type: String(params.type || ''),
      status: null,
      mimeType: '',
      startedAt: Date.now(),
      durationMs: null,
      failed: false,
      error: '',
    });
    while (entry.requests.size > MAX_REQUESTS) {
      entry.requests.delete(entry.requests.keys().next().value);
    }
  });
  client.on('Network.responseReceived', (params) => {
    const item = entry.requests.get(params.requestId);
    if (!item || !params.response) return;
    item.status = Number(params.response.status || 0) || null;
    item.mimeType = String(params.response.mimeType || '');
  });
  client.on('Network.loadingFinished', (params) => {
    const item = entry.requests.get(params.requestId);
    if (!item) return;
    item.durationMs = Date.now() - item.startedAt;
  });
  client.on('Network.loadingFailed', (params) => {
    const item = entry.requests.get(params.requestId);
    if (!item) return;
    item.failed = true;
    item.error = String(params.errorText || 'failed');
    item.durationMs = Date.now() - item.startedAt;
  });
  client.on('close', () => {
    if (clients.get(target.id) === entry) clients.delete(target.id);
  });
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Page.enable'),
  ]);
  await Promise.allSettled([
    client.send('Log.enable'),
    client.send('Network.enable'),
  ]);
  return entry;
}

async function chooseTab(port, tabId) {
  const tabs = await listTabs(port);
  let tab = null;
  if (tabId) {
    const value = String(tabId);
    tab =
      tabs.find((item) => item.id === value) ||
      tabs.find((item) => item.id.startsWith(value)) ||
      tabs.find(
        (item) =>
          item.url.includes(value) || item.title.includes(value)
      ) ||
      null;
    if (!tab) throw new Error(`tab not found: ${value}`);
  } else if (state.lastTargetId) {
    tab = tabs.find((item) => item.id === state.lastTargetId) || null;
  }
  if (!tab) tab = tabs.find((item) => !item.devtools) || tabs[0] || null;
  if (!tab) {
    const created = await createTarget(port, 'about:blank', false);
    tab = created;
  }
  state.lastTargetId = tab.id;
  return tab;
}

async function firstTab(port) {
  const tabs = await listTabs(port);
  return tabs.find((item) => !item.devtools) || tabs[0] || null;
}

async function createTarget(port, url, newWindow = false) {
  const targetUrl = normalizeUrl(url, { allowBlank: true });
  if (newWindow) {
    const version = await fetchJson(port, '/json/version', 4000);
    const browser = await CdpClient.open(version.webSocketDebuggerUrl);
    try {
      const result = await browser.send('Target.createTarget', {
        url: targetUrl,
        newWindow: true,
      });
      const found = await findTabById(port, result.targetId);
      return (
        found || {
          id: result.targetId,
          title: '',
          url: targetUrl,
          type: 'page',
          devtools: isDevtoolsUrl(targetUrl),
          webSocketDebuggerUrl: '',
        }
      );
    } finally {
      browser.close();
    }
  }
  try {
    const created = await fetchJson(
      port,
      `/json/new?${encodeURIComponent(targetUrl)}`,
      8000,
      { method: 'PUT' }
    );
    if (created?.id) {
      const found = await findTabById(port, created.id);
      return (
        found || {
          id: created.id,
          title: String(created.title || ''),
          url: String(created.url || targetUrl),
          type: 'page',
          devtools: isDevtoolsUrl(created.url || targetUrl),
          webSocketDebuggerUrl: String(created.webSocketDebuggerUrl || ''),
        }
      );
    }
  } catch {
    /* fall through to Target.createTarget */
  }
  const version = await fetchJson(port, '/json/version', 4000);
  const browser = await CdpClient.open(version.webSocketDebuggerUrl);
  try {
    const result = await browser.send('Target.createTarget', {
      url: targetUrl,
      newWindow: false,
    });
    const found = await findTabById(port, result.targetId);
    return (
      found || {
        id: result.targetId,
        title: '',
        url: targetUrl,
        type: 'page',
        devtools: isDevtoolsUrl(targetUrl),
        webSocketDebuggerUrl: '',
      }
    );
  } finally {
    browser.close();
  }
}

async function activateTarget(port, id) {
  try {
    await fetchJson(port, `/json/activate/${encodeURIComponent(id)}`, 3000);
  } catch {
    /* ignore */
  }
}

async function pageState(client) {
  try {
    const result = await client.send('Runtime.evaluate', {
      expression:
        '({ title: document.title, url: location.href, readyState: document.readyState })',
      returnByValue: true,
    });
    return result.result?.value || {};
  } catch {
    return {};
  }
}

async function waitForReady(client, timeoutMs = 10_000) {
  const startedAt = Date.now();
  const deadline = startedAt + clamp(timeoutMs, 500, 60_000);
  while (Date.now() < deadline) {
    const current = await pageState(client);
    if (current.readyState === 'complete') {
      return { loaded: true, elapsedMs: Date.now() - startedAt, state: current };
    }
    await sleep(150);
  }
  return {
    loaded: false,
    elapsedMs: Date.now() - startedAt,
    state: await pageState(client),
  };
}

async function evaluate(client, expression, options = {}) {
  const response = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      ...options,
    },
    clamp(integer(options.timeoutMs, CDP_TIMEOUT), 1000, 60_000)
  );
  if (response.exceptionDetails) {
    return { ok: false, exception: exceptionText(response.exceptionDetails) };
  }
  const remote = response.result || {};
  return {
    ok: true,
    value: remote.value,
    type: remote.type,
    description: remote.description,
    unserializableValue: remote.unserializableValue,
  };
}

function keyDefinition(key) {
  const value = String(key || '');
  const named = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    Home: { key: 'Home', code: 'Home', keyCode: 36 },
    End: { key: 'End', code: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    F5: { key: 'F5', code: 'F5', keyCode: 116 },
    F12: { key: 'F12', code: 'F12', keyCode: 123 },
  };
  if (named[value]) return named[value];
  if (value.length === 1) {
    const upper = value.toUpperCase();
    let code = '';
    if (/[A-Z]/.test(upper)) code = `Key${upper}`;
    else if (/[0-9]/.test(upper)) code = `Digit${upper}`;
    return {
      key: value,
      code,
      keyCode: upper.charCodeAt(0),
      text: value,
    };
  }
  return { key: value, code: value, keyCode: 0 };
}

function modifierMask(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[+,\s]+/);
  let mask = 0;
  for (const item of list) {
    const key = String(item || '').toLowerCase();
    if (key === 'alt') mask |= 1;
    else if (key === 'ctrl' || key === 'control') mask |= 2;
    else if (key === 'meta' || key === 'cmd' || key === 'command') mask |= 4;
    else if (key === 'shift') mask |= 8;
  }
  return mask;
}

async function pressKey(client, key, modifiers = []) {
  const info = keyDefinition(key);
  const mask = modifierMask(modifiers);
  const base = {
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    modifiers: mask,
  };
  const text = info.text && !mask ? info.text : undefined;
  await client.send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown',
    ...base,
    ...(text ? { text, unmodifiedText: text } : {}),
  });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function openDevtools(port, tab, args = {}) {
  const devtoolsUrl =
    `http://127.0.0.1:${port}/devtools/inspector.html` +
    `?ws=127.0.0.1:${port}/devtools/page/${encodeURIComponent(tab.id)}`;
  const newWindow = args.newWindow !== false;
  try {
    const created = await createTarget(port, devtoolsUrl, newWindow);
    await activateTarget(port, created.id);
    return {
      opened: true,
      devtoolsUrl,
      windowTargetId: created.id,
      newWindow,
    };
  } catch (error) {
    return {
      opened: false,
      devtoolsUrl,
      error: String(error.message || error),
    };
  }
}

async function launchAction(args) {
  const url = args.url ? normalizeUrl(args.url, { allowBlank: true }) : null;
  const ensured = await ensureChrome(args);
  let tab = null;
  if (ensured.launched) {
    tab = await firstTab(ensured.port);
  } else if (url) {
    tab = await createTarget(ensured.port, 'about:blank', args.newWindow === true);
  } else {
    tab = await firstTab(ensured.port);
  }
  if (!tab) tab = await createTarget(ensured.port, 'about:blank', false);
  state.lastTargetId = tab.id;
  let ready = null;
  let entry = null;
  if (url) {
    entry = await getClient(ensured.port, tab);
    if (url !== 'about:blank') {
      await entry.client.send('Page.navigate', { url });
    }
    ready = await waitForReady(entry.client, integer(args.timeoutMs, 10_000));
    if (ready.state) {
      tab = {
        ...tab,
        title: ready.state.title || tab.title,
        url: ready.state.url || tab.url,
      };
    }
  }
  let devtools = null;
  if (args.devtools && !ensured.launched) {
    devtools = await openDevtools(ensured.port, tab, args);
  }
  const tabs = await listTabs(ensured.port);
  return json({
    ok: true,
    action: 'launch',
    browser: ensured.version?.Browser || state.version?.Browser || '',
    port: ensured.port,
    profile: state.profile || ensured.profile || null,
    pid: state.pid,
    launched: ensured.launched,
    tab: publicTab(tab),
    loaded: ready ? ready.loaded : null,
    state: ready ? ready.state : entry ? await pageState(entry.client) : null,
    devtools: devtools || (args.devtools ? { opened: true, auto: true } : null),
    tabs: tabs.map(publicTab),
  });
}

async function openAction(args) {
  const url = normalizeUrl(args.url, { allowBlank: true }) || 'about:blank';
  const ensured = await ensureChrome(args);
  let tab = null;
  if (ensured.launched) {
    tab = await firstTab(ensured.port);
  }
  if (!tab) {
    tab = await createTarget(ensured.port, 'about:blank', args.newWindow === true);
  }
  state.lastTargetId = tab.id;
  const entry = await getClient(ensured.port, tab);
  if (url !== 'about:blank') {
    await entry.client.send('Page.navigate', { url });
  }
  const ready =
    args.waitForLoad === false
      ? null
      : await waitForReady(entry.client, integer(args.timeoutMs, 10_000));
  if (ready?.state) {
    tab = {
      ...tab,
      title: ready.state.title || tab.title,
      url: ready.state.url || tab.url,
    };
  }
  let devtools = null;
  if (args.devtools && !ensured.launched) {
    devtools = await openDevtools(ensured.port, tab, args);
  }
  const tabs = await listTabs(ensured.port);
  return json({
    ok: true,
    action: 'open',
    port: ensured.port,
    launched: ensured.launched,
    tab: publicTab(tab),
    loaded: ready ? ready.loaded : null,
    state: ready ? ready.state : await pageState(entry.client),
    devtools: devtools || (args.devtools ? { opened: true, auto: true } : null),
    tabs: tabs.map(publicTab),
  });
}

async function tabsAction(args) {
  const port = await runningPort(args);
  if (!port) {
    return json({ ok: true, running: false, tabs: [] });
  }
  const tabs = await listTabs(port);
  return json({
    ok: true,
    running: true,
    browser: state.version?.Browser || '',
    port,
    active: state.lastTargetId || null,
    tabs: tabs.map(publicTab),
  });
}

async function activateAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  await activateTarget(port, tab.id);
  state.lastTargetId = tab.id;
  return json({ ok: true, action: 'activate', tab: publicTab(tab) });
}

async function readAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const mode = ['text', 'html', 'summary', 'links', 'forms'].includes(args.mode)
    ? args.mode
    : 'text';
  const maxChars = clamp(integer(args.maxChars, mode === 'html' ? MAX_HTML : MAX_TEXT), 500, 100_000);
  const selector = String(args.selector || '').trim();
  const expression = `(() => {
    try {
      const opts = ${JSON.stringify({ mode, maxChars, selector })};
      const root = opts.selector
        ? document.querySelector(opts.selector)
        : (document.body || document.documentElement);
      if (!root) return { ok: false, error: 'selector not found: ' + opts.selector };
      const title = document.title || '';
      const url = location.href;
      const readyState = document.readyState;
      if (opts.mode === 'html') {
        const html = root.outerHTML || '';
        return { ok: true, title, url, readyState, html: html.slice(0, opts.maxChars), length: html.length, truncated: html.length > opts.maxChars };
      }
      if (opts.mode === 'links') {
        const links = [...root.querySelectorAll('a[href]')].slice(0, 200).map((a) => ({
          text: (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
          href: a.href,
        }));
        return { ok: true, title, url, readyState, links };
      }
      if (opts.mode === 'forms') {
        const fields = [...root.querySelectorAll('input,textarea,select,button')].slice(0, 200).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          id: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          value: el.tagName === 'INPUT' && (el.type === 'password' || el.type === 'hidden')
            ? ''
            : ('value' in el ? String(el.value).slice(0, 200) : ''),
          text: el.tagName === 'BUTTON' ? (el.innerText || '').trim().slice(0, 120) : '',
          disabled: Boolean(el.disabled),
        }));
        return { ok: true, title, url, readyState, fields };
      }
      if (opts.mode === 'summary') {
        const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 100).map((h) => ({
          level: Number(h.tagName.slice(1)),
          text: (h.innerText || h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200),
        }));
        return {
          ok: true, title, url, readyState, headings,
          links: root.querySelectorAll('a[href]').length,
          buttons: root.querySelectorAll('button,[role="button"]').length,
          inputs: root.querySelectorAll('input,textarea,select').length,
          forms: root.querySelectorAll('form').length,
          textLength: (root.innerText || '').length,
        };
      }
      const text = (root.innerText || root.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      return { ok: true, title, url, readyState, text: text.slice(0, opts.maxChars), length: text.length, truncated: text.length > opts.maxChars };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  })()`;
  const result = await evaluate(entry.client, expression);
  if (!result.ok) {
    return json({ ok: false, action: 'read', tab: publicTab(tab), error: result.exception });
  }
  const value = result.value || {};
  if (value.ok === false) {
    return json({ ok: false, action: 'read', tab: publicTab(tab), error: value.error });
  }
  const errors = entry.console
    .filter((item) => item.level === 'error' || item.kind === 'exception')
    .slice(-5)
    .map((item) => ({
      level: item.level,
      text: String(item.text || '').slice(0, 1000),
      url: item.url,
      line: item.line,
    }));
  return json({
    ok: true,
    action: 'read',
    tab: publicTab(tab),
    mode,
    ...value,
    consoleErrors: errors,
  });
}

async function screenshotAction(args, context) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const format = String(args.format || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const fullPage = args.fullPage === true;
  const selector = String(args.selector || '').trim();
  let clip = null;
  if (selector) {
    const rect = await evaluate(
      entry.client,
      `(() => {
        try {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, error: 'selector not found' };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return { ok: true, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`
    );
    if (!rect.ok || !rect.value?.ok) {
      return json({
        ok: false,
        action: 'screenshot',
        tab: publicTab(tab),
        error: rect.value?.error || rect.exception || 'selector not found',
      });
    }
    const value = rect.value;
    if (value.width < 1 || value.height < 1) {
      return json({ ok: false, action: 'screenshot', tab: publicTab(tab), error: 'element has no visible size' });
    }
    clip = {
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      scale: 1,
    };
  } else if (fullPage) {
    const metrics = await entry.client.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize || {};
    clip = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.ceil(size.width || 1)),
      height: Math.max(1, Math.ceil(size.height || 1)),
      scale: 1,
    };
  }
  const result = await entry.client.send('Page.captureScreenshot', {
    format,
    fromSurface: true,
    captureBeyondViewport: Boolean(fullPage || clip),
    ...(format === 'jpeg' ? { quality: clamp(integer(args.quality, 82), 1, 100) } : {}),
    ...(clip ? { clip } : {}),
  });
  if (!result.data) throw new Error('screenshot returned no data');
  const dir = path.join(os.tmpdir(), 'yah-browser');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let output = String(args.path || '').trim();
  const explicitPath = Boolean(output);
  if (output) {
    output = path.resolve(output);
    if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
      output = path.join(output, `shot-${stamp}.${ext}`);
    } else if (output.endsWith(path.sep) || output.endsWith('/')) {
      fs.mkdirSync(output, { recursive: true });
      output = path.join(output, `shot-${stamp}.${ext}`);
    }
  } else {
    output = path.join(dir, `shot-${stamp}.${ext}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (explicitPath) await guardPath(output, context, { tool: 'chrome' });
  const buffer = Buffer.from(result.data, 'base64');
  fs.writeFileSync(output, buffer);
  const current = await pageState(entry.client);
  return json({
    ok: true,
    action: 'screenshot',
    tab: publicTab(tab),
    path: output,
    bytes: buffer.length,
    format,
    fullPage,
    selector: selector || null,
    state: current,
  });
}

async function clickAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const selector = String(args.selector || '').trim();
  const hasPoint = args.x !== undefined && args.y !== undefined;
  if (!selector && !hasPoint) {
    return json({ ok: false, action: 'click', tab: publicTab(tab), error: 'click requires selector or x/y' });
  }
  let point = hasPoint
    ? { x: Number(args.x), y: Number(args.y), tag: 'point', text: '' }
    : null;
  if (selector) {
    const rect = await evaluate(
      entry.client,
      `(() => {
        try {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, error: 'selector not found' };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return {
            ok: true,
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            width: r.width,
            height: r.height,
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
          };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`
    );
    if (!rect.ok || !rect.value?.ok) {
      return json({ ok: false, action: 'click', tab: publicTab(tab), error: rect.value?.error || rect.exception || 'selector not found' });
    }
    if (rect.value.width < 1 || rect.value.height < 1) {
      return json({ ok: false, action: 'click', tab: publicTab(tab), error: 'element has no visible size' });
    }
    point = rect.value;
  }
  const button = ['left', 'right', 'middle'].includes(args.button)
    ? args.button
    : 'left';
  const count = clamp(integer(args.clickCount, 1), 1, 3);
  const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
  await entry.client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  });
  for (let index = 1; index <= count; index += 1) {
    await entry.client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button,
      buttons,
      clickCount: index,
    });
    await entry.client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button,
      buttons: 0,
      clickCount: index,
    });
    if (index < count) await sleep(50);
  }
  await sleep(clamp(integer(args.waitMs, 300), 0, 5000));
  return json({
    ok: true,
    action: 'click',
    tab: publicTab(tab),
    clicked: {
      x: Math.round(point.x),
      y: Math.round(point.y),
      tag: point.tag,
      text: point.text,
      button,
      count,
    },
    state: await pageState(entry.client),
  });
}

async function typeAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const selector = String(args.selector || '').trim();
  const text = String(args.text ?? '');
  const clear = args.clear === true;
  const submit = args.submit === true;
  if (selector) {
    const focused = await evaluate(
      entry.client,
      `(() => {
        try {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, error: 'selector not found' };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus();
          return {
            ok: true,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            name: el.getAttribute('name') || '',
            id: el.id || '',
          };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`
    );
    if (!focused.ok || !focused.value?.ok) {
      return json({ ok: false, action: 'type', tab: publicTab(tab), error: focused.value?.error || focused.exception || 'selector not found' });
    }
  }
  if (clear) {
    await pressKey(entry.client, 'a', [process.platform === 'darwin' ? 'meta' : 'ctrl']);
    await pressKey(entry.client, 'Backspace');
  }
  if (text) {
    await entry.client.send('Input.insertText', { text });
  }
  if (submit) {
    await pressKey(entry.client, 'Enter');
  }
  await sleep(clamp(integer(args.waitMs, 200), 0, 3000));
  const active = await evaluate(
    entry.client,
    `(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        value: 'value' in el ? String(el.value).slice(0, 500) : (el.innerText || '').slice(0, 500),
      };
    })()`
  );
  return json({
    ok: true,
    action: 'type',
    tab: publicTab(tab),
    text,
    cleared: clear,
    submitted: submit,
    focused: active.value || null,
    state: await pageState(entry.client),
  });
}

async function pressAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const key = String(args.key || '').trim();
  if (!key) {
    return json({ ok: false, action: 'press', tab: publicTab(tab), error: 'press requires key' });
  }
  await pressKey(entry.client, key, args.modifiers || []);
  await sleep(clamp(integer(args.waitMs, 150), 0, 3000));
  return json({
    ok: true,
    action: 'press',
    tab: publicTab(tab),
    key,
    modifiers: args.modifiers || [],
    state: await pageState(entry.client),
  });
}

async function evalAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const expression = String(args.expression || '').trim();
  if (!expression) {
    return json({ ok: false, action: 'eval', tab: publicTab(tab), error: 'eval requires expression' });
  }
  const maxChars = clamp(integer(args.maxChars, MAX_EVAL), 500, 200_000);
  const result = await evaluate(entry.client, expression, {
    awaitPromise: args.awaitPromise !== false,
  });
  if (!result.ok) {
    return json({
      ok: false,
      action: 'eval',
      tab: publicTab(tab),
      exception: result.exception,
      state: await pageState(entry.client),
    });
  }
  let value = result.value;
  if (value === undefined) {
    value = result.type === 'undefined' ? null : result.description || result.unserializableValue || null;
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  const truncated = String(serialized ?? '').length > maxChars;
  return json({
    ok: true,
    action: 'eval',
    tab: publicTab(tab),
    type: result.type || typeof value,
    result: truncated ? String(serialized).slice(0, maxChars) : value,
    truncated,
    state: await pageState(entry.client),
  });
}

async function waitAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  let mode = String(args.waitFor || '').trim();
  if (!mode) {
    if (args.selector) mode = 'selector';
    else if (args.text) mode = 'text';
    else if (args.url) mode = 'url';
  }
  if (!['selector', 'text', 'url'].includes(mode)) {
    return json({
      ok: false,
      action: 'wait',
      tab: publicTab(tab),
      error: 'wait requires selector, text or url (or waitFor)',
    });
  }
  const value = String(args.selector || args.text || args.url || '');
  if (!value) {
    return json({ ok: false, action: 'wait', tab: publicTab(tab), error: `wait requires ${mode}` });
  }
  const waitState = ['attached', 'visible', 'hidden'].includes(args.state)
    ? args.state
    : mode === 'selector'
      ? 'visible'
      : 'attached';
  const timeoutMs = clamp(integer(args.timeoutMs, 5000), 100, 60_000);
  const startedAt = Date.now();
  const expression = `(() => {
    try {
      const mode = ${JSON.stringify(mode)};
      const value = ${JSON.stringify(value)};
      const waitState = ${JSON.stringify(waitState)};
      if (mode === 'url') return location.href.includes(value);
      if (mode === 'text') return Boolean(document.body && document.body.innerText.includes(value));
      const el = document.querySelector(value);
      if (!el) return false;
      if (waitState === 'attached') return true;
      const visible = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
      return waitState === 'hidden' ? !visible : visible;
    } catch {
      return false;
    }
  })()`;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(entry.client, expression);
    if (result.ok && result.value === true) {
      return json({
        ok: true,
        action: 'wait',
        tab: publicTab(tab),
        matched: true,
        mode,
        value,
        waitState,
        elapsedMs: Date.now() - startedAt,
        state: await pageState(entry.client),
      });
    }
    await sleep(150);
  }
  return json({
    ok: false,
    action: 'wait',
    tab: publicTab(tab),
    matched: false,
    timeout: true,
    mode,
    value,
    waitState,
    elapsedMs: Date.now() - startedAt,
    state: await pageState(entry.client),
  });
}

async function consoleAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const level = String(args.level || 'all').toLowerCase() === 'warn'
    ? 'warning'
    : String(args.level || 'all').toLowerCase();
  let items = entry.console.slice();
  if (level !== 'all') {
    items = items.filter(
      (item) => item.level === level || (level === 'error' && item.kind === 'exception')
    );
  }
  const limit = clamp(integer(args.limit, 50), 1, 200);
  const total = items.length;
  items = items.slice(-limit);
  if (args.clear === true) entry.console.length = 0;
  return json({
    ok: true,
    action: 'console',
    tab: publicTab(tab),
    level,
    total,
    entries: items,
    attachedAt: new Date(entry.attachedAt).toISOString(),
    note:
      'Console output is captured while YAH is attached to this tab. Reload the page after opening it to capture earlier startup messages.',
  });
}

async function networkAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const filter = String(args.filter || '').trim().toLowerCase();
  let items = [...entry.requests.values()];
  if (filter) {
    items = items.filter((item) => item.url.toLowerCase().includes(filter));
  }
  items.sort((a, b) => a.startedAt - b.startedAt);
  const total = items.length;
  const limit = clamp(integer(args.limit, 50), 1, 200);
  items = items.slice(-limit).map((item) => ({
    method: item.method,
    url: item.url,
    type: item.type,
    status: item.status,
    mimeType: item.mimeType,
    durationMs: item.durationMs,
    failed: item.failed,
    error: item.error,
  }));
  if (args.clear === true) entry.requests.clear();
  return json({
    ok: true,
    action: 'network',
    tab: publicTab(tab),
    filter: filter || null,
    total,
    requests: items,
    attachedAt: new Date(entry.attachedAt).toISOString(),
  });
}

async function devtoolsAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const devtools = await openDevtools(port, tab, args);
  return json({
    ok: devtools.opened,
    action: 'devtools',
    tab: publicTab(tab),
    ...devtools,
  });
}

async function navigateAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const url = normalizeUrl(args.url, { allowBlank: true });
  if (!url) {
    return json({ ok: false, action: 'navigate', tab: publicTab(tab), error: 'navigate requires url' });
  }
  const entry = await getClient(port, tab);
  await entry.client.send('Page.navigate', { url });
  const ready = await waitForReady(entry.client, integer(args.timeoutMs, 10_000));
  return json({
    ok: true,
    action: 'navigate',
    tab: publicTab(tab),
    url,
    loaded: ready.loaded,
    state: ready.state,
  });
}

async function historyAction(args, direction) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  const history = await entry.client.send('Page.getNavigationHistory');
  const entries = history.entries || [];
  const nextIndex = history.currentIndex + (direction === 'back' ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= entries.length) {
    return json({
      ok: false,
      action: direction,
      tab: publicTab(tab),
      error: `cannot go ${direction}`,
      state: await pageState(entry.client),
    });
  }
  await entry.client.send('Page.navigateToHistoryEntry', {
    entryId: entries[nextIndex].id,
  });
  const ready = await waitForReady(entry.client, integer(args.timeoutMs, 10_000));
  return json({
    ok: true,
    action: direction,
    tab: publicTab(tab),
    loaded: ready.loaded,
    state: ready.state,
  });
}

async function reloadAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  await entry.client.send('Page.reload', { ignoreCache: args.ignoreCache === true });
  const ready = await waitForReady(entry.client, integer(args.timeoutMs, 10_000));
  return json({
    ok: true,
    action: 'reload',
    tab: publicTab(tab),
    loaded: ready.loaded,
    state: ready.state,
  });
}

async function stopAction(args) {
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  const entry = await getClient(port, tab);
  await entry.client.send('Page.stopLoading');
  return json({
    ok: true,
    action: 'stop',
    tab: publicTab(tab),
    state: await pageState(entry.client),
  });
}

async function closeAction(args) {
  const target = String(args.target || 'tab').toLowerCase();
  if (target === 'browser') {
    const port = await runningPort(args);
    if (!port) return json({ ok: true, action: 'close', target: 'browser', running: false });
    let closed = false;
    try {
      const version = await fetchJson(port, '/json/version', 4000);
      const browser = await CdpClient.open(version.webSocketDebuggerUrl);
      try {
        await browser.send('Browser.close', {}, 5000);
        closed = true;
      } finally {
        browser.close();
      }
    } catch {
      closed = false;
    }
    if (!closed && state.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 5000,
          });
        } else {
          process.kill(state.pid, 'SIGTERM');
        }
        closed = true;
      } catch {
        closed = false;
      }
    }
    const gone = await waitForChromeGone(port, 6000);
    for (const entry of clients.values()) entry.client.close();
    clients.clear();
    clearState();
    return json({
      ok: closed,
      action: 'close',
      target: 'browser',
      port,
      closed,
      stopped: gone,
    });
  }
  const port = await requirePort(args);
  const tab = await chooseTab(port, args.tabId);
  await fetchJson(port, `/json/close/${encodeURIComponent(tab.id)}`, 5000);
  const entry = clients.get(tab.id);
  if (entry) {
    entry.client.close();
    clients.delete(tab.id);
  }
  if (state.lastTargetId === tab.id) state.lastTargetId = '';
  return json({ ok: true, action: 'close', target: 'tab', tab: publicTab(tab) });
}

async function statusAction(args) {
  const port = await runningPort(args);
  if (!port) {
    return json({
      ok: true,
      running: false,
      port: state.port || integer(args.port, DEFAULT_PORT),
      profile: state.profile || null,
      chrome: state.exe || null,
      tabs: [],
    });
  }
  const tabs = await listTabs(port);
  return json({
    ok: true,
    running: true,
    browser: state.version?.Browser || '',
    userAgent: state.version?.['User-Agent'] || '',
    port,
    profile: state.profile || null,
    chrome: state.exe || null,
    pid: state.pid,
    active: state.lastTargetId || null,
    tabs: tabs.map(publicTab),
  });
}

async function chromeTool(args = {}, context = null) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    throw new Error(
      `unknown chrome action "${action}". Use one of: ${[...ACTIONS].join(', ')}`
    );
  }
  switch (action) {
    case 'launch':
      return launchAction(args);
    case 'open':
      return openAction(args);
    case 'tabs':
      return tabsAction(args);
    case 'activate':
      return activateAction(args);
    case 'read':
      return readAction(args);
    case 'screenshot':
      return screenshotAction(args, context);
    case 'click':
      return clickAction(args);
    case 'type':
      return typeAction(args);
    case 'press':
      return pressAction(args);
    case 'eval':
      return evalAction(args);
    case 'wait':
      return waitAction(args);
    case 'console':
      return consoleAction(args);
    case 'network':
      return networkAction(args);
    case 'devtools':
      return devtoolsAction(args);
    case 'navigate':
      return navigateAction(args);
    case 'back':
      return historyAction(args, 'back');
    case 'forward':
      return historyAction(args, 'forward');
    case 'reload':
      return reloadAction(args);
    case 'stop':
      return stopAction(args);
    case 'close':
      return closeAction(args);
    case 'status':
      return statusAction(args);
    default:
      throw new Error(`unknown chrome action: ${action}`);
  }
}

loadSavedState();

module.exports = {
  chromeTool,
  normalizeUrl,
  findChrome,
  buildLaunchArgs,
  keyDefinition,
  isChromeVersion,
  _state: state,
};
