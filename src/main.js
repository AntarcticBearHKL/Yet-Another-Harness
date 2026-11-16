'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} = require('electron');

app.setName('YAH - Yet Another Harness');

// 独立数据目录 %APPDATA%\yah；首次升级时从旧的 Electron 目录复制。
const appData = app.getPath('appData');
const userData = path.join(appData, 'yah');
const previousUserData = path.join(appData, 'miniharness-electron');
if (!fs.existsSync(userData) && fs.existsSync(previousUserData)) {
  fs.cpSync(previousUserData, userData, { recursive: true });
}
app.setPath('userData', userData);
app.setAppUserModelId('com.yah.harness');
nativeTheme.themeSource = 'light';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

const LOCAL_PORT = Number(process.env.YAH_LOCAL_PORT) || 3789;
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const WINDOW_STATE_FILE = path.join(userData, 'window.json');
const AGILE_WINDOW_STATE_FILE = path.join(userData, 'agile-window.json');

let mainWindow = null;
let agileWindow = null;
let backendProcess = null;
let saveBoundsTimer = null;
let saveAgileBoundsTimer = null;
const contentWindows = new Map();
const chatWindows = new Map();
let dragState = null;
let resizeState = null;

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(bounds) {
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(
      WINDOW_STATE_FILE,
      `${JSON.stringify(bounds, null, 2)}\n`,
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

function clampBounds(bounds, options = {}) {
  const display = bounds
    ? screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
    : screen.getPrimaryDisplay();
  const area = display.workArea;

  const minWidth = Math.min(options.minWidth || 900, area.width);
  const minHeight = Math.min(options.minHeight || 520, area.height);
  const width = Math.max(
    minWidth,
    Math.min(area.width, Number(bounds?.width) || options.width || 1120)
  );
  const height = Math.max(
    minHeight,
    Math.min(area.height, Number(bounds?.height) || options.height || 740)
  );

  const requestedX =
    bounds && Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : area.x;
  const requestedY =
    bounds && Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : area.y;

  const x = bounds
    ? Math.max(area.x, Math.min(area.x + area.width - width, requestedX))
    : Math.round(area.x + (area.width - width) / 2);
  const y = bounds
    ? Math.max(area.y, Math.min(area.y + area.height - height, requestedY))
    : Math.round(area.y + (area.height - height) / 2);

  return { x, y, width, height };
}

function scheduleBoundsSave() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveBounds, 300);
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  saveWindowState(mainWindow.getBounds());
}

function prepareContentPayload(payload) {
  const next = { ...(payload || {}) };
  const kind = String(next.kind || 'text');
  if (kind !== 'code' && kind !== 'pdf' && kind !== 'html') return next;
  const filePath = path.resolve(String(next.path || ''));
  next.path = filePath;
  next.title = String(next.title || path.basename(filePath) || 'YAH');
  next.key = String(next.key || `${kind}:${filePath}`);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    if (kind === 'code') {
      if (stat.size > 4 * 1024 * 1024) {
        throw new Error('code file is larger than 4 MB');
      }
      const buffer = fs.readFileSync(filePath);
      if (buffer.subarray(0, 8192).includes(0)) {
        throw new Error('code file looks binary');
      }
      next.text = buffer.toString('utf8');
    } else if (kind === 'html') {
      if (stat.size > 2 * 1024 * 1024) {
        throw new Error('HTML is larger than 2 MB');
      }
      next.html = fs.readFileSync(filePath, 'utf8');
    } else {
      if (stat.size > 80 * 1024 * 1024) {
        throw new Error('PDF is larger than 80 MB');
      }
      const buffer = fs.readFileSync(filePath);
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error('file is not a PDF');
      }
      next.data = buffer.toString('base64');
    }
  } catch (error) {
    next.error = error.message;
  }
  return next;
}

function openContentWindow(payload) {
  payload = prepareContentPayload(payload);
  const key = String(payload?.key || '');
  const title = String(payload?.title || 'YAH - Content');
  const kind = String(payload?.kind || 'text');

  if (key) {
    for (const entry of contentWindows.values()) {
      if (entry.key !== key || entry.win.isDestroyed()) continue;
      entry.payload = payload;
      entry.win.setTitle(title);
      if (!entry.win.webContents.isLoading()) {
        entry.win.webContents.send('content:init', payload);
      }
      entry.win.show();
      entry.win.focus();
      return entry.win.id;
    }
  }

  const win = new BrowserWindow({
    width:
      kind === 'pdf' ? 1180 : kind === 'code' || kind === 'html' ? 1100 : 940,
    height:
      kind === 'pdf' ? 900 : kind === 'code' || kind === 'html' ? 820 : 760,
    minWidth:
      kind === 'pdf' || kind === 'code' || kind === 'html' ? 720 : 520,
    minHeight:
      kind === 'pdf' || kind === 'code' || kind === 'html' ? 520 : 360,
    title,
    icon: path.join(__dirname, '..', 'assets', 'yah.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: true,
    hasShadow: false,
    show: false,
    resizable: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  const webContentsId = win.webContents.id;
  const entry = { win, key, payload };
  contentWindows.set(webContentsId, entry);

  win.loadURL(`${LOCAL_URL}/content.html?shell=electron`);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('content:init', entry.payload);
  });
  win.on('closed', () => {
    contentWindows.delete(webContentsId);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  return win.id;
}

function openChatWindow(sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const compose = options && options.compose === true;
  const existing = chatWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    if (compose) {
      const send = () => {
        if (!existing.isDestroyed()) {
          existing.webContents.send('chat:compose');
        }
      };
      if (existing.webContents.isLoading()) {
        existing.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    }
    return existing.id;
  }

  const win = new BrowserWindow({
    width: 1040,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    title: 'YAH - Chat',
    icon: path.join(__dirname, '..', 'assets', 'yah.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: true,
    hasShadow: false,
    show: false,
    resizable: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  chatWindows.set(id, win);
  win.loadURL(
    `${LOCAL_URL}/?chat=1&sessionId=${encodeURIComponent(id)}&shell=electron${
      compose ? '&compose=1' : ''
    }`
  );
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    if (chatWindows.get(id) === win) chatWindows.delete(id);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  return win.id;
}

function loadAgileWindowState() {
  try {
    return JSON.parse(fs.readFileSync(AGILE_WINDOW_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAgileWindowState(bounds) {
  try {
    fs.mkdirSync(path.dirname(AGILE_WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(
      AGILE_WINDOW_STATE_FILE,
      `${JSON.stringify(bounds, null, 2)}\n`,
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

function scheduleAgileBoundsSave() {
  clearTimeout(saveAgileBoundsTimer);
  saveAgileBoundsTimer = setTimeout(saveAgileBounds, 300);
}

function saveAgileBounds() {
  if (!agileWindow || agileWindow.isDestroyed()) return;
  saveAgileWindowState(agileWindow.getBounds());
}

function openAgileWindow() {
  if (agileWindow && !agileWindow.isDestroyed()) {
    if (agileWindow.isMinimized()) agileWindow.restore();
    agileWindow.show();
    agileWindow.focus();
    return agileWindow.id;
  }

  const bounds = clampBounds(loadAgileWindowState(), {
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
  });

  agileWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 560,
    title: 'YAH - Agile',
    icon: path.join(__dirname, '..', 'assets', 'yah.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: true,
    hasShadow: false,
    show: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  agileWindow.loadURL(`${LOCAL_URL}/agile.html?shell=electron`);
  agileWindow.once('ready-to-show', () => {
    if (agileWindow && !agileWindow.isDestroyed()) agileWindow.show();
  });
  agileWindow.on('resize', scheduleAgileBoundsSave);
  agileWindow.on('move', scheduleAgileBoundsSave);
  agileWindow.on('resized', saveAgileBounds);
  agileWindow.on('moved', saveAgileBounds);
  agileWindow.on('close', saveAgileBounds);
  agileWindow.on('closed', () => {
    agileWindow = null;
  });
  agileWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  agileWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  return agileWindow.id;
}

async function backendHealthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`${LOCAL_URL}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBackend() {
  if (await backendHealthy()) return;

  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  backendProcess = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      YAH_DATA_DIR: process.env.YAH_DATA_DIR || userData,
      YAH_LOCAL_PORT: String(LOCAL_PORT),
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  backendProcess.on('error', (error) => {
    console.error('backend spawn failed', error);
  });

  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await backendHealthy()) return;
    if (backendProcess.exitCode !== null) break;
  }
  throw new Error('本地后端没有启动成功');
}

function createWindow() {
  const bounds = clampBounds(loadWindowState());

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 520,
    title: 'YAH - Yet Another Harness',
    icon: path.join(__dirname, '..', 'assets', 'yah.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: true,
    hasShadow: false,
    show: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(`${LOCAL_URL}/?shell=electron`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (agileWindow && !agileWindow.isDestroyed()) agileWindow.close();
    agileWindow = null;
    for (const entry of [...contentWindows.values()]) {
      if (!entry.win.isDestroyed()) entry.win.close();
    }
    contentWindows.clear();
  });

  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    try {
      await ensureBackend();
    } catch (error) {
      dialog.showErrorBox('YAH', error.message || String(error));
      app.quit();
      return;
    }

    createWindow();

    ipcMain.on('window:minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      (win || mainWindow)?.minimize();
    });
    ipcMain.on('window:maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const target = win || mainWindow;
      if (!target) return;
      if (target.isMaximized()) target.unmaximize();
      else target.maximize();
    });
    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      (win || mainWindow)?.close();
    });
    ipcMain.handle('content:open', (_event, payload) =>
      openContentWindow(payload)
    );
    ipcMain.handle('viewer:ask', (_event, payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      if (sessionId) {
        openChatWindow(sessionId);
        const win = chatWindows.get(sessionId);
        if (win && !win.isDestroyed()) {
          const send = () => {
            if (!win.isDestroyed()) win.webContents.send('viewer:ask', payload);
          };
          if (win.webContents.isLoading()) {
            win.webContents.once('did-finish-load', send);
          } else {
            send();
          }
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          return true;
        }
      }
      const win = mainWindow;
      if (!win || win.isDestroyed()) return false;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('viewer:ask', payload);
      return true;
    });
    ipcMain.handle('agile:open', () => openAgileWindow());
    ipcMain.handle('chat:open', (_event, sessionId, options) =>
      openChatWindow(sessionId, options)
    );
    ipcMain.on('content:update', (_event, payload) => {
      const key = String(payload?.key || '');
      if (!key) return;
      for (const entry of contentWindows.values()) {
        if (entry.key !== key || entry.win.isDestroyed()) continue;
        entry.win.webContents.send('content:update', payload);
      }
    });
    ipcMain.on('window:drag-start', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) {
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      dragState = {
        win,
        cursorX: cursor.x,
        cursorY: cursor.y,
        bounds: win.getBounds(),
      };
    });
    ipcMain.on('window:drag-move', (event) => {
      if (!dragState || dragState.win.isDestroyed()) return;
      if (dragState.win !== BrowserWindow.fromWebContents(event.sender)) return;
      const cursor = screen.getCursorScreenPoint();
      dragState.win.setPosition(
        Math.round(dragState.bounds.x + cursor.x - dragState.cursorX),
        Math.round(dragState.bounds.y + cursor.y - dragState.cursorY)
      );
    });
    ipcMain.on('window:drag-end', (event) => {
      if (!dragState) return;
      if (dragState.win !== BrowserWindow.fromWebContents(event.sender)) return;
      dragState = null;
    });
    ipcMain.on('window:resize-start', (event, payload) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) {
        return;
      }
      const direction = String(payload?.direction || '');
      if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(direction)) return;
      resizeState = {
        win,
        direction,
        cursor: screen.getCursorScreenPoint(),
        bounds: win.getBounds(),
      };
    });
    ipcMain.on('window:resize-move', (event) => {
      if (!resizeState || resizeState.win.isDestroyed()) return;
      if (resizeState.win !== BrowserWindow.fromWebContents(event.sender)) return;

      const { bounds, direction } = resizeState;
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - resizeState.cursor.x;
      const dy = cursor.y - resizeState.cursor.y;
      const [minWidth, minHeight] = resizeState.win.getMinimumSize();
      let { x, y, width, height } = bounds;

      if (direction.includes('e')) width = bounds.width + dx;
      if (direction.includes('s')) height = bounds.height + dy;
      if (direction.includes('w')) {
        width = bounds.width - dx;
        x = bounds.x + dx;
      }
      if (direction.includes('n')) {
        height = bounds.height - dy;
        y = bounds.y + dy;
      }
      if (width < minWidth) {
        if (direction.includes('w')) x = bounds.x + bounds.width - minWidth;
        width = minWidth;
      }
      if (height < minHeight) {
        if (direction.includes('n')) y = bounds.y + bounds.height - minHeight;
        height = minHeight;
      }

      resizeState.win.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
    });
    ipcMain.on('window:resize-end', (event) => {
      if (!resizeState) return;
      if (resizeState.win !== BrowserWindow.fromWebContents(event.sender)) return;
      resizeState = null;
    });
    ipcMain.handle('window:is-maximized', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return win?.isMaximized() ?? false;
    });
    ipcMain.handle('app:version', () => app.getVersion());
    ipcMain.handle('dialog:pick-directories', async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    });
    ipcMain.handle('fs:is-directory', (_event, target) => {
      try {
        return fs.statSync(String(target || '')).isDirectory();
      } catch {
        return false;
      }
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length !== 0) return;
      try {
        await ensureBackend();
        createWindow();
      } catch (error) {
        console.error('activate failed', error);
      }
    });

    app.on('will-quit', () => {
      if (backendProcess && process.env.YAH_STOP_SERVER_ON_QUIT === '1') {
        try {
          backendProcess.kill();
        } catch {
          /* ignore */
        }
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    clearTimeout(saveBoundsTimer);
    clearTimeout(saveAgileBoundsTimer);
    saveBounds();
    saveAgileBounds();
  });
}
