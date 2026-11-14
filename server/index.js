'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const store = require('../src/store');
const tools = require('../src/tools');
const deepseek = require('../src/deepseek');
const runner = require('./runner');
const usage = require('./usage');
const { McpManager } = require('./mcp/manager');
const { createSkillService } = require('./skills');
const { loadAgents, saveAgents, getAgent } = require('./agents');
const { ensureAgentsMd, readAgentsMd } = require('./context');
const { normalizeGoal } = require('../src/goal');

const ROOT = path.resolve(__dirname, '..');
const APP_DATA =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DATA_DIR = path.resolve(
  process.env.YAH_DATA_DIR || path.join(APP_DATA, 'yah')
);
const STATIC_DIR = path.resolve(process.env.YAH_STATIC_DIR || path.join(ROOT, 'src'));
const ASSETS_DIR = path.join(ROOT, 'assets');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const HOST = '127.0.0.1';
const LOCAL_PORT = Number(process.env.YAH_LOCAL_PORT) || 3789;
const REMOTE_PORT = Number(process.env.YAH_REMOTE_PORT) || 3790;
const REMOTE_USER = process.env.YAH_REMOTE_USER || 'yah';
const REMOTE_PASSWORD = process.env.YAH_REMOTE_PASSWORD || '';
const LAN_HOST = '0.0.0.0';
const LAN_PORT = Number(process.env.YAH_LAN_PORT) || 3791;
const LAN_USER = process.env.YAH_LAN_USER || 'yah';
const LAN_ENABLED = process.env.YAH_LAN !== '0';
const LAN_PASSWORD = loadLanPassword();
const PID_FILE = path.join(DATA_DIR, 'server.pid');

const mcpManager = new McpManager({
  dataDir: DATA_DIR,
  version: require('../package.json').version,
});
const skillService = createSkillService({
  root: ROOT,
  dataDir: DATA_DIR,
  mcpManager,
});
tools.configure({ skillService, mcpManager });

let pidWritten = false;

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/resize.css', 'resize.css'],
  ['/resize.js', 'resize.js'],
  ['/renderer.js', 'renderer.js'],
  ['/mcp-ui.js', 'mcp-ui.js'],
  ['/content.html', 'content.html'],
  ['/content.css', 'content.css'],
  ['/content.js', 'content.js'],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json')) {
      reject(Object.assign(new Error('expected application/json'), { status: 415 }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        req.destroy();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function loadLanPassword() {
  const fromEnv = String(process.env.YAH_LAN_PASSWORD || '').trim();
  if (fromEnv) return fromEnv;
  const file = path.join(DATA_DIR, 'lan.json');
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved?.password) return String(saved.password);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const password = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(file, `${JSON.stringify({ password }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return password;
  } catch (error) {
    console.error('load LAN password failed', error);
    return crypto.randomBytes(9).toString('base64url');
  }
}

function getLanAddresses() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (
        /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|Bluetooth|Tailscale|ZeroTier|Docker/i.test(
          name
        )
      ) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  const rank = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  return [...new Set(addresses)].sort((a, b) => rank(a) - rank(b));
}

function authorized(req, auth) {
  if (!auth?.password) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const index = decoded.indexOf(':');
  if (index < 0) return false;
  return (
    timingSafeEqual(decoded.slice(0, index), auth.user) &&
    timingSafeEqual(decoded.slice(index + 1), auth.password)
  );
}

function settingsView() {
  const settings = store.loadSettings();
  const hasApiKey = Boolean(
    String(process.env.OPENCODE_API_KEY || settings.apiKey || '').trim()
  );
  return { hasApiKey, apiKey: '' };
}

async function respondPairing(res) {
  const addresses = LAN_ENABLED ? getLanAddresses() : [];
  const host = addresses[0] || '';
  const enabled = Boolean(LAN_ENABLED && host);
  const url = enabled
    ? `yah://pair?host=${encodeURIComponent(host)}&port=${LAN_PORT}&user=${encodeURIComponent(
        LAN_USER
      )}&password=${encodeURIComponent(LAN_PASSWORD)}`
    : '';
  let qr = '';
  if (url) {
    try {
      qr = await QRCode.toDataURL(url, {
        margin: 1,
        width: 320,
        color: { dark: '#2b211a', light: '#fff8f0' },
      });
    } catch (error) {
      console.error('generate pairing QR failed', error);
    }
  }
  sendJson(res, 200, {
    enabled,
    host,
    port: LAN_PORT,
    user: LAN_USER,
    password: LAN_PASSWORD,
    addresses,
    url,
    qr,
  });
}

function titleFallback(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return 'New chat';
  return line.length > 28 ? `${line.slice(0, 27)}…` : line;
}

function cleanTitle(raw, text) {
  const cleaned = String(raw || '')
    .replace(/\r?\n/g, ' ')
    .replace(/^title\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’#*\s]+|["'“”‘’#*\s]+$/g, '')
    .replace(/[。.!?！？；;：:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return titleFallback(text);
  return cleaned.length > 40 ? `${cleaned.slice(0, 39)}…` : cleaned;
}

async function generateChatTitle(text, sessionId) {
  const apiKey = String(
    process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
  ).trim();
  if (!apiKey) return titleFallback(text);

  const messages = [
    {
      role: 'system',
      content:
        'You name chat conversations. Reply with only a short title, no quotes, no markdown, no trailing punctuation. Use the same language as the user. Keep it under 24 Chinese characters or 8 English words.',
    },
    { role: 'user', content: `First user message:\n${text}` },
  ];

  try {
    const result = await deepseek.streamChat({
      apiKey,
      sessionId,
      signal: AbortSignal.timeout(20_000),
      body: { model: deepseek.MODEL, messages, stream: true },
    });
    return cleanTitle(result.content, text);
  } catch (error) {
    console.error('generate title failed', error);
    return titleFallback(text);
  }
}

function sessionMcpDisabled(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return [];
  const chats = store.loadChats();
  const session = chats.sessions.find((item) => item.id === id);
  return Array.isArray(session?.mcpDisabled) ? session.mcpDisabled : [];
}

function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, pid: process.pid });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    sendJson(res, 200, settingsView());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/usage') {
    const apiKey = String(
      process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
    ).trim();
    usage
      .getUsage(apiKey)
      .then((data) => sendJson(res, 200, data))
      .catch((error) =>
        sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/settings') {
    readJson(req)
      .then((body) => {
        const current = store.loadSettings();
        if (body?.clearApiKey) {
          store.saveSettings({ ...current, apiKey: '' });
        } else if (typeof body?.apiKey === 'string' && body.apiKey.trim()) {
          store.saveSettings({ ...current, apiKey: body.apiKey.trim() });
        }
        sendJson(res, 200, settingsView());
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/chats') {
    const chats = store.loadChats();
    for (const session of chats.sessions) {
      ensureAgentsMd(session, chats);
    }
    sendJson(res, 200, chats);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents-md') {
    const projectId = String(url.searchParams.get('projectId') || '');
    const chats = store.loadChats();
    const project = chats.projects.find((item) => item.id === projectId);
    sendJson(res, 200, {
      text: readAgentsMd(project?.directories || []),
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/chats') {
    readJson(req)
      .then((body) => {
        store.saveStructure(body);
        sendJson(res, 200, { ok: true });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/goals') {
    readJson(req)
      .then((body) => {
        const sessionId = String(body?.sessionId || '').trim();
        if (!sessionId) {
          sendJson(res, 400, { error: 'sessionId is required' });
          return;
        }
        const goal =
          body?.goal === null || body?.goal === undefined
            ? null
            : normalizeGoal(body.goal);
        if (body?.goal && !goal) {
          sendJson(res, 400, { error: 'goal objective is required' });
          return;
        }
        const saved = store.updateSessionGoal(sessionId, goal);
        sendJson(res, 200, { ok: true, goal: saved });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/compact') {
    readJson(req)
      .then(async (body) => {
        const result = await runner.compactSession(body?.sessionId);
        sendJson(res, 200, result);
      })
      .catch((error) => {
        const status =
          error.code === 'busy'
            ? 409
            : error.code === 'not_found'
              ? 404
              : error.code === 'no_key'
                ? 400
                : 400;
        sendJson(res, status, { error: error.message, code: error.code });
      });
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
    const sessionId = decodeURIComponent(
      pathname.slice('/api/sessions/'.length)
    );
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    runner.cancelSessionRuns([sessionId]);
    store.deleteSession(sessionId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/skills') {
    const sessionId = String(url.searchParams.get('sessionId') || '');
    let disabled = sessionMcpDisabled(sessionId);
    const rawDisabled = url.searchParams.get('disabled');
    if (rawDisabled) {
      try {
        const parsed = JSON.parse(rawDisabled);
        if (Array.isArray(parsed)) disabled = parsed.map(String);
      } catch {
        /* ignore malformed disabled list */
      }
    }
    void mcpManager.ensureConnections();
    sendJson(res, 200, {
      skills: skillService.list({ mcpDisabled: disabled }),
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/skills/resolve') {
    readJson(req)
      .then(async (body) => {
        const sessionId = String(body?.sessionId || '');
        const result = await skillService.resolveMany(
          body?.skills,
          sessionMcpDisabled(sessionId)
        );
        sendJson(res, 200, { ok: true, ...result });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/send') {
    readJson(req)
      .then(async (body) => {
        const sessionId = String(body?.chatId || '');
        const resolved = await skillService.resolveMany(
          body?.skills,
          sessionMcpDisabled(sessionId)
        );
        const agent = getAgent(AGENTS_FILE, body?.agentId);
        const result = runner.startRun({
          sessionId,
          text: String(body?.text || ''),
          runId: String(body?.requestId || ''),
          skillsText: resolved.text,
          agentConfig: agent,
        });
        sendJson(res, 200, result);
      })
      .catch((error) => {
        const status =
          error.code === 'busy'
            ? 409
            : error.code === 'not_found'
              ? 404
              : 400;
        sendJson(res, status, { error: error.message, code: error.code });
      });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/title') {
    readJson(req)
      .then(async (body) => {
        const text = String(body?.text || '').trim();
        if (!text) {
          sendJson(res, 400, { error: 'text is required' });
          return;
        }
        const title = await generateChatTitle(
          text,
          String(body?.chatId || '')
        );
        sendJson(res, 200, { title });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/cancel') {
    readJson(req)
      .then((body) => {
        const cancelled = runner.cancelRun(body?.runId);
        sendJson(res, 200, { cancelled });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/approvals/')) {
    const approvalId = decodeURIComponent(
      pathname.slice('/api/approvals/'.length)
    );
    readJson(req)
      .then((body) => {
        const ok = runner.resolveApproval(
          approvalId,
          body?.approved === true
        );
        sendJson(res, ok ? 200 : 404, { ok });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/pairing') {
    void respondPairing(res);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents') {
    sendJson(res, 200, { agents: loadAgents(AGENTS_FILE) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/agents') {
    readJson(req)
      .then((body) => {
        const agents = saveAgents(AGENTS_FILE, body?.agents);
        sendJson(res, 200, { ok: true, agents });
      })
      .catch((error) =>
        sendJson(res, error.status || 400, { error: error.message })
      );
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/catalog') {
    void mcpManager.ensureConnections();
    const allTools = tools.definitions();
    const catalogTools = allTools.filter(
      (definition) =>
        !String(definition.function?.name || '').startsWith('mcp__')
    );
    sendJson(res, 200, {
      tools: catalogTools,
      agentTools: allTools.map((definition) => ({
        name: definition.function?.name || '',
        description: definition.function?.description || '',
      })),
      skills: skillService.list({}),
      mcp: mcpManager.catalogEntries(),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mcp/state') {
    void mcpManager.ensureConnections();
    sendJson(res, 200, mcpManager.getState());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mcp/events') {
    openMcpEventStream(req, res);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mcp/reload') {
    mcpManager
      .reload()
      .then((state) => sendJson(res, 200, state))
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mcp/servers') {
    readJson(req)
      .then((body) => {
        if (typeof body?.json === 'string' && body.json.trim()) {
          sendJson(res, 200, mcpManager.importServers(body.json));
          return;
        }
        const input = body?.server && typeof body.server === 'object'
          ? body.server
          : body;
        sendJson(res, 200, mcpManager.addServer(input));
      })
      .catch((error) => sendJson(res, error.status || 400, { error: error.message }));
    return true;
  }

  const mcpMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)(?:\/(.+))?$/);
  if (mcpMatch) {
    let serverId = '';
    try {
      serverId = decodeURIComponent(mcpMatch[1]);
    } catch {
      sendJson(res, 400, { error: 'bad server id' });
      return true;
    }
    const action = mcpMatch[2] || '';
    const method = req.method;

    if (method === 'GET' && !action) {
      const snapshot = mcpManager.snapshot(serverId);
      if (!snapshot) {
        sendJson(res, 404, { error: 'MCP 服务器不存在' });
        return true;
      }
      sendJson(res, 200, snapshot);
      return true;
    }

    if (method === 'PUT' && !action) {
      readJson(req)
        .then((body) => {
          const input = body?.server && typeof body.server === 'object'
            ? body.server
            : body;
          sendJson(res, 200, mcpManager.updateServer(serverId, input));
        })
        .catch((error) => sendJson(res, error.status || 400, { error: error.message }));
      return true;
    }

    if (method === 'DELETE' && !action) {
      try {
        sendJson(res, 200, mcpManager.removeServer(serverId));
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return true;
    }

    if (method === 'POST' && action === 'reconnect') {
      mcpManager
        .reconnect(serverId)
        .then((snapshot) => sendJson(res, 200, snapshot))
        .catch((error) => sendJson(res, 400, { error: error.message }));
      return true;
    }

    if (method === 'POST' && action === 'refresh') {
      mcpManager
        .refresh(serverId)
        .then((payload) => sendJson(res, 200, payload))
        .catch((error) => sendJson(res, 400, { error: error.message }));
      return true;
    }

    if (method === 'POST' && action === 'tools/call') {
      readJson(req)
        .then(async (body) => {
          const name = String(body?.name || '');
          const args =
            body?.arguments && typeof body.arguments === 'object'
              ? body.arguments
              : {};
          if (!name) throw new Error('tool name is required');
          const result = await mcpManager.callTool(serverId, name, args);
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
      return true;
    }

    if (method === 'POST' && action === 'resources/read') {
      readJson(req)
        .then(async (body) => {
          const uri = String(body?.uri || '').trim();
          if (!uri) throw new Error('resource uri is required');
          const result = await mcpManager.readResource(serverId, uri);
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
      return true;
    }

    if (method === 'POST' && action === 'prompts/get') {
      readJson(req)
        .then(async (body) => {
          const name = String(body?.name || '').trim();
          const args =
            body?.arguments && typeof body.arguments === 'object'
              ? body.arguments
              : {};
          if (!name) throw new Error('prompt name is required');
          const result = await mcpManager.getPrompt(serverId, name, args);
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
      return true;
    }

    if (method === 'POST' && action === 'logs/clear') {
      sendJson(res, 200, mcpManager.clearLogs(serverId));
      return true;
    }

    sendJson(res, 404, { error: 'not found' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/runs/active') {
    const sessionId = String(url.searchParams.get('sessionId') || '');
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    sendJson(res, 200, {
      runId: runner.activeRunForSession(sessionId) || null,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/events/last') {
    const sessionId = String(url.searchParams.get('sessionId') || '');
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    sendJson(res, 200, { seq: store.lastEventSeq(sessionId) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    const sessionId = String(url.searchParams.get('sessionId') || '');
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    const after =
      Number(url.searchParams.get('after')) ||
      Number(req.headers['last-event-id']) ||
      0;
    openEventStream(req, res, sessionId, after);
    return true;
  }

  return false;
}

function openEventStream(req, res, sessionId, after) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  let lastSeq = Number(after) || 0;
  let replaying = true;
  let closed = false;
  const buffered = [];

  const sendEvent = (event) => {
    if (closed || event.seq <= lastSeq) return;
    const data = {
      seq: event.seq,
      type: event.type,
      requestId: event.runId,
      ...event.payload,
    };
    res.write(`id: ${event.seq}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    lastSeq = event.seq;
  };

  const unsubscribe = runner.subscribe(sessionId, (event) => {
    if (replaying) {
      buffered.push(event);
      return;
    }
    sendEvent(event);
  });

  try {
    for (const event of store.listEvents(sessionId, lastSeq)) {
      sendEvent(event);
    }
  } catch (error) {
    console.error('event replay failed', error);
  }
  replaying = false;
  for (const event of buffered) sendEvent(event);

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function openMcpEventStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  let closed = false;
  const send = (event) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: 'state', state: mcpManager.getState() });
  const unsubscribe = mcpManager.subscribe(send);

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad path');
    return;
  }
  let filePath = null;

  if (STATIC_FILES.has(pathname)) {
    filePath = path.join(STATIC_DIR, STATIC_FILES.get(pathname));
  } else if (pathname.startsWith('/assets/')) {
    const relative = pathname.slice('/assets/'.length);
    const candidate = path.resolve(ASSETS_DIR, relative);
    if (candidate.startsWith(`${ASSETS_DIR}${path.sep}`)) {
      filePath = candidate;
    }
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
}

function makeServer({ auth = null } = {}) {
  return http.createServer((req, res) => {
    if (auth && !authorized(req, auth)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="YAH", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('authentication required');
      return;
    }

    let url;
    try {
      url = new URL(req.url, `http://${HOST}`);
    } catch {
      sendJson(res, 400, { error: 'bad url' });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (handleApi(req, res, url)) return;
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    serveStatic(req, res, url);
  });
}

let remoteServer = null;
let lanServer = null;
const localServer = makeServer();

function startRemote() {
  if (!REMOTE_PASSWORD) {
    console.log('YAH remote disabled (set YAH_REMOTE_PASSWORD to enable)');
    return;
  }
  remoteServer = makeServer({
    auth: { user: REMOTE_USER, password: REMOTE_PASSWORD },
  });
  remoteServer.on('error', (error) => {
    console.error('remote server error', error);
  });
  remoteServer.listen(REMOTE_PORT, HOST, () => {
    console.log(`YAH remote: http://${HOST}:${REMOTE_PORT}`);
  });
}

function startLan() {
  if (!LAN_ENABLED) {
    console.log('YAH LAN disabled (YAH_LAN=0)');
    return;
  }
  lanServer = makeServer({
    auth: { user: LAN_USER, password: LAN_PASSWORD },
  });
  lanServer.on('error', (error) => {
    console.error('LAN server error', error);
  });
  lanServer.listen(LAN_PORT, LAN_HOST, () => {
    console.log(`YAH LAN: http://${LAN_HOST}:${LAN_PORT}`);
  });
}

localServer.on('error', (error) => {
  console.error('local server error', error);
  process.exitCode = 1;
});

localServer.listen(LOCAL_PORT, HOST, () => {
  store.init({
    getPath: (name) => (name === 'userData' ? DATA_DIR : APP_DATA),
  });
  store.loadChats();
  store.interruptRuns();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  pidWritten = true;
  mcpManager.start();
  console.log(`YAH local: http://${HOST}:${LOCAL_PORT}`);
  startRemote();
  startLan();
});

function shutdown() {
  mcpManager.closeAll();
  try {
    if (remoteServer) remoteServer.close();
  } catch {
    /* ignore */
  }
  try {
    if (lanServer) lanServer.close();
  } catch {
    /* ignore */
  }
  try {
    localServer.close();
  } catch {
    /* ignore */
  }
  store.close();
  if (pidWritten) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (!pidWritten) return;
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
});
