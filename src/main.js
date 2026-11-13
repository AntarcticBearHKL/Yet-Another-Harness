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

let mainWindow = null;
let backendProcess = null;
let saveBoundsTimer = null;
const contentWindows = new Map();
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

function clampBounds(bounds) {
  const display = bounds
    ? screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
    : screen.getPrimaryDisplay();
  const area = display.workArea;

  const minWidth = Math.min(900, area.width);
  const minHeight = Math.min(520, area.height);
  const width = Math.max(
    minWidth,
    Math.min(area.width, Number(bounds?.width) || 1120)
  );
  const height = Math.max(
    minHeight,
    Math.min(area.height, Number(bounds?.height) || 740)
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

function openContentWindow(payload) {
  const key = String(payload?.key || '');
  const title = String(payload?.title || 'YAH - Content');

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
    width: 940,
    height: 760,
    minWidth: 520,
    minHeight: 360,
    title,
    icon: path.join(__dirname, '..', 'assets', 'yah.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: true,
    hasShadow: true,
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

  win.loadFile(path.join(__dirname, 'content.html'));
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
    hasShadow: true,
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

    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      (win || mainWindow)?.close();
    });
    ipcMain.handle('content:open', (_event, payload) =>
      openContentWindow(payload)
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
    saveBounds();
  });
}
