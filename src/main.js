'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} = require('electron');

const store = require('./store');
const deepseek = require('./deepseek');

// 独立的数据目录，避免和旧的 Rust 版 %APPDATA%\miniharness 互相覆盖；
// 第一次启动由 store 从旧目录迁移 chats.json / settings.json。
app.setPath('userData', path.join(app.getPath('appData'), 'miniharness-electron'));
app.setAppUserModelId('com.miniharness.electron');
// 系统 acrylic/边框也跟随浅色，避免深色材质透出来
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

let mainWindow = null;
let settings = null;
let saveBoundsTimer = null;
const activeChats = new Set();
let dragState = null;

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
  if (!mainWindow || mainWindow.isDestroyed() || !settings) return;
  const bounds = mainWindow.getBounds();
  settings = {
    ...settings,
    window: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
  try {
    store.saveSettings(settings);
  } catch {
    /* ignore */
  }
}

function createWindow() {
  settings = store.loadSettings();
  const bounds = clampBounds(settings.window);

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 520,
    title: 'MINIHARNESS',
    icon: path.join(__dirname, '..', 'assets', 'miniharness.ico'),
    frame: false,
    // 透明窗口 + CSS 圆角：不依赖系统 acrylic/setShape，缩放时不会出现
    // 灰色框，圆角外也不会露出方角的背景材质。
    // 不透明 acrylic + Windows 11 原生圆角：没有透明窗口的方角黑底，
    // 也不需要 setShape（setShape 会在缩放时拖影）。
    transparent: false,
    backgroundColor: '#f9f1e7',
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : 'none',
    roundedCorners: true,
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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  // Windows 上 resize/move 会连续触发；resized/moved 是拖拽结束后的最终值
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
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

async function runChat(sender, payload) {
  const requestId = payload?.requestId;
  if (!requestId || sender.isDestroyed()) return;
  if (activeChats.has(sender.id)) {
    sender.send('chat:error', { requestId, error: 'another request is still running' });
    return;
  }

  activeChats.add(sender.id);
  const controller = new AbortController();
  const send = (channel, data) => {
    if (!sender.isDestroyed()) sender.send(channel, { requestId, ...data });
  };

  try {
    const text = await deepseek.runAgent({
      apiKey: payload.apiKey,
      system: payload.system,
      history: payload.history,
      signal: controller.signal,
      onDelta: (delta) => send('chat:delta', { text: delta }),
      onToolCall: (call) => send('chat:tool-call', call),
      onToolResult: (result) => send('chat:tool-result', result),
    });
    send('chat:done', { text });
  } catch (error) {
    send('chat:error', {
      error: controller.signal.aborted
        ? 'request cancelled'
        : error?.message || String(error),
    });
  } finally {
    activeChats.delete(sender.id);
  }
}

if (gotLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    store.init(app);
    createWindow();

    ipcMain.handle('settings:load', () => settings);
    ipcMain.handle('settings:save', (_event, next) => {
      // 窗口 bounds 由主进程维护，渲染进程传来的旧 window 不覆盖它
      settings = store.saveSettings({
        ...settings,
        ...next,
        window: settings.window,
      });
      return settings;
    });

    ipcMain.handle('chats:load', () => store.loadChats());
    ipcMain.handle('chats:save', (_event, data) => store.saveChats(data));

    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on('window:close', () => mainWindow?.close());
    ipcMain.on('window:drag-start', (event, point) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) {
        return;
      }
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      dragState = {
        win,
        cursorX: point.x,
        cursorY: point.y,
        bounds: win.getBounds(),
      };
    });
    ipcMain.on('window:drag-move', (event, point) => {
      if (!dragState || dragState.win.isDestroyed()) return;
      if (dragState.win !== BrowserWindow.fromWebContents(event.sender)) return;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      dragState.win.setPosition(
        Math.round(dragState.bounds.x + point.x - dragState.cursorX),
        Math.round(dragState.bounds.y + point.y - dragState.cursorY)
      );
    });
    ipcMain.on('window:drag-end', (event) => {
      if (!dragState) return;
      if (dragState.win !== BrowserWindow.fromWebContents(event.sender)) return;
      dragState = null;
    });
    ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
    ipcMain.handle('app:version', () => app.getVersion());

    ipcMain.on('chat:send', (event, payload) => {
      runChat(event.sender, payload);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
