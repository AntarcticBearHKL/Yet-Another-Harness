'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const store = require('../src/store');
const tools = require('../src/tools');
const runner = require('./runner');

const ROOT = path.resolve(__dirname, '..');
const APP_DATA =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DATA_DIR = path.resolve(
  process.env.YAH_DATA_DIR || path.join(APP_DATA, 'yah')
);
const STATIC_DIR = path.resolve(process.env.YAH_STATIC_DIR || path.join(ROOT, 'src'));
const ASSETS_DIR = path.join(ROOT, 'assets');
const HOST = '127.0.0.1';
const LOCAL_PORT = Number(process.env.YAH_LOCAL_PORT) || 3789;
const REMOTE_PORT = Number(process.env.YAH_REMOTE_PORT) || 3790;
const REMOTE_USER = process.env.YAH_REMOTE_USER || 'yah';
const REMOTE_PASSWORD = process.env.YAH_REMOTE_PASSWORD || '';
const PID_FILE = path.join(DATA_DIR, 'server.pid');

let pidWritten = false;

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/renderer.js', 'renderer.js'],
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

function authorized(req) {
  if (!REMOTE_PASSWORD) return false;
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
    timingSafeEqual(decoded.slice(0, index), REMOTE_USER) &&
    timingSafeEqual(decoded.slice(index + 1), REMOTE_PASSWORD)
  );
}

function settingsView() {
  const settings = store.loadSettings();
  const hasApiKey = Boolean(
    String(process.env.OPENCODE_API_KEY || settings.apiKey || '').trim()
  );
  return { hasApiKey, apiKey: '' };
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
    sendJson(res, 200, store.loadChats());
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

  if (req.method === 'POST' && pathname === '/api/send') {
    readJson(req)
      .then((body) => {
        const result = runner.startRun({
          sessionId: String(body?.chatId || ''),
          text: String(body?.text || ''),
          runId: String(body?.requestId || ''),
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

  if (req.method === 'GET' && pathname === '/api/catalog') {
    sendJson(res, 200, {
      tools: tools.definitions(),
      skills: [],
      mcp: [],
    });
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

function makeServer({ remote }) {
  return http.createServer((req, res) => {
    if (remote && !authorized(req)) {
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
const localServer = makeServer({ remote: false });

function startRemote() {
  if (!REMOTE_PASSWORD) {
    console.log('YAH remote disabled (set YAH_REMOTE_PASSWORD to enable)');
    return;
  }
  remoteServer = makeServer({ remote: true });
  remoteServer.on('error', (error) => {
    console.error('remote server error', error);
  });
  remoteServer.listen(REMOTE_PORT, HOST, () => {
    console.log(`YAH remote: http://${HOST}:${REMOTE_PORT}`);
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
  console.log(`YAH local: http://${HOST}:${LOCAL_PORT}`);
  startRemote();
});

function shutdown() {
  try {
    if (remoteServer) remoteServer.close();
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
