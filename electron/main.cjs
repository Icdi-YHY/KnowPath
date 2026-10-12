/**
 * 知径 KnowPath · Electron 主进程
 * 生产环境下用内置的本地静态服务器托管 dist/，让渲染进程处于正常的 http 源，
 * 从而与 Web 版拥有完全一致的网络 / CORS 行为（避免 file:// 源导致的接口调用问题）。
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { serveStatic } = require('./static-server.cjs');

const isDev = !app.isPackaged;
const DEV_URL = process.env.KNOWPATH_DEV_URL || 'http://localhost:5173';
const DIST_DIR = path.join(__dirname, '..', 'dist');
// 由于交叉打包时无法用 rcedit 写入 exe 资源，改为在运行时指定窗口/任务栏图标
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

let mainWindow = null;
let staticServer = null;

async function createWindow() {
  Menu.setApplicationMenu(null);

  let target = DEV_URL;
  if (!isDev) {
    staticServer = await serveStatic(DIST_DIR);
    target = `http://127.0.0.1:${staticServer.port}/`;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#070b16',
    autoHideMenuBar: true,
    title: '知径 KnowPath',
    ...(process.platform === 'win32' && fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(target);
  console.log(`[knowpath] 已加载 ${target}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  staticServer?.close();
  if (process.platform !== 'darwin') app.quit();
});
