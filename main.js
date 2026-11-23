const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut,
  dialog, nativeImage, screen, shell
} = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* ---------- 数据目录 ---------- */
const APP_DIR = path.join(app.getPath('appData'), 'DeskTodo');
const PROFILE_DIR = path.join(APP_DIR, 'profile'); // Chromium 缓存与运行态，和 tasks.json 分开放
try {
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });
} catch (e) { /* 目录不可建时退回默认 */ }
app.setPath('userData', PROFILE_DIR);
const STORE_FILE = path.join(APP_DIR, 'tasks.json');

const DEFAULTS = {
  version: 1,
  tasks: [],
  settings: {
    theme: 'light',
    autostart: false,
    collapsed: false,
    bounds: null
  }
};

let store = { ...DEFAULTS, tasks: [], settings: { ...DEFAULTS.settings } };
let win = null;
let tray = null;
let isQuitting = false;
let saveBoundsTimer = null;

/* ---------- 读写 ---------- */
function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      version: 1,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) }
    };
  } catch (e) {
    return { ...DEFAULTS, tasks: [], settings: { ...DEFAULTS.settings } };
  }
}

function ensureDir() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
}

function dailyBackup() {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_FILE)) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const target = path.join(APP_DIR, `backup-${stamp}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(STORE_FILE, target);
    // 只保留 7 天
    const files = fs.readdirSync(APP_DIR).filter(f => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f));
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    files.forEach(f => {
      const m = f.match(/backup-(\d{4})-(\d{2})-(\d{2})\.json/);
      const ts = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime();
      if (ts < cutoff) {
        try { fs.unlinkSync(path.join(APP_DIR, f)); } catch (_) {}
      }
    });
  } catch (e) {
    console.error('backup failed', e);
  }
}

function writeStore() {
  try {
    ensureDir();
    dailyBackup();
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
    return true;
  } catch (e) {
    console.error('write failed', e);
    return false;
  }
}

/* ---------- 窗口 ---------- */
const SIZE_EXPANDED = { width: 320, height: 420 };
const SIZE_COLLAPSED = { width: 220, height: 60 };

function clampBounds(b) {
  const width = b.width || SIZE_EXPANDED.width;
  const height = b.height || SIZE_EXPANDED.height;
  const ref = (typeof b.x === 'number' && typeof b.y === 'number')
    ? screen.getDisplayMatching({ x: b.x, y: b.y, width, height }).workArea
    : screen.getPrimaryDisplay().workArea;
  let x = b.x;
  let y = b.y;
  if (typeof x !== 'number' || typeof y !== 'number') {
    x = ref.x + ref.width - width - 24;
    y = ref.y + 72;
  }
  x = Math.min(Math.max(x, ref.x), ref.x + ref.width - width);
  y = Math.min(Math.max(y, ref.y), ref.y + ref.height - height);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function currentSize(collapsed) {
  return collapsed ? SIZE_COLLAPSED : SIZE_EXPANDED;
}

function createWindow() {
  const collapsed = !!store.settings.collapsed;
  const size = currentSize(collapsed);
  const base = store.settings.bounds || {};
  const bounds = clampBounds({ ...base, ...size });

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    show: false,
    hasShadow: false,
    title: '待办',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  win.on('moved', () => {
    if (!win) return;
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      const b = win.getBounds();
      store.settings.bounds = { x: b.x, y: b.y };
      writeStore();
    }, 400);
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/* ---------- 托盘 ---------- */
function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('待办');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });
}

/* ---------- 开机自启（写 HKCU Run，开发/打包都稳定） ---------- */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'DeskTodo';

function applyAutostart(enabled) {
  try {
    if (enabled) {
      const exe = process.execPath;
      const appArgs = app.isPackaged ? '' : ` "${path.resolve(__dirname)}"`;
      execFileSync('reg.exe',
        ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `"${exe}"${appArgs}`, '/f'],
        { windowsHide: true });
    } else {
      execFileSync('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { windowsHide: true });
    }
  } catch (e) {
    console.error('autostart failed', e && e.message);
  }
}

/* ---------- IPC ---------- */
ipcMain.handle('store:load', () => ({ ...store, settings: { ...store.settings, collapsed: !!store.settings.collapsed } }));

ipcMain.handle('store:save', (e, payload) => {
  if (!payload || !Array.isArray(payload.tasks)) return { ok: false };
  store.tasks = payload.tasks;
  if (payload.settings) {
    const s = payload.settings;
    if (s.theme) store.settings.theme = s.theme;
    if (typeof s.autostart === 'boolean' && s.autostart !== store.settings.autostart) {
      store.settings.autostart = s.autostart;
      applyAutostart(s.autostart);
    }
  }
  const ok = writeStore();
  return { ok };
});

ipcMain.handle('win:collapse', (e, collapsed) => {
  if (!win) return false;
  const size = currentSize(!!collapsed);
  const cur = win.getBounds();
  const b = clampBounds({ x: cur.x, y: cur.y, ...size });
  win.setBounds(b, false);
  store.settings.collapsed = !!collapsed;
  store.settings.bounds = { x: b.x, y: b.y };
  writeStore();
  return true;
});

ipcMain.handle('win:hide', () => { if (win) win.hide(); return true; });
ipcMain.handle('win:quit', () => { isQuitting = true; app.quit(); return true; });

ipcMain.handle('store:export', async () => {
  const d = new Date();
  const name = `待办备份-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const res = await dialog.showSaveDialog(win, {
    title: '导出待办数据',
    defaultPath: path.join(app.getPath('desktop'), name),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(store, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('store:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入待办数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false };
  try {
    const data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    if (!Array.isArray(data.tasks)) return { ok: false, error: '文件里没有 tasks 数组' };
    store.tasks = data.tasks;
    if (data.settings && data.settings.theme) store.settings.theme = data.settings.theme;
    writeStore();
    if (win) win.webContents.send('store:reloaded', store);
    return { ok: true, count: data.tasks.length };
  } catch (e) {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
});

ipcMain.handle('app:autostart', (e, enabled) => {
  store.settings.autostart = !!enabled;
  applyAutostart(!!enabled);
  writeStore();
  return true;
});

ipcMain.handle('app:reveal-data', () => {
  ensureDir();
  shell.openPath(APP_DIR);
  return true;
});

/* ---------- 生命周期 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    store = readStore();
    createWindow();
    createTray();
    globalShortcut.register('Control+Alt+T', toggleWindow);
    if (store.settings.autostart) applyAutostart(true);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    // 交给托盘与显式退出控制，不回退默认行为
  });

  app.on('activate', () => {
    if (win) { win.show(); win.focus(); }
  });
}
