const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const { openDouban } = require('./douban.cjs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir } = require('node:fs/promises');

// Keep both Chromium storage and connection settings outside the install directory.
app.setPath('userData', join(app.getPath('appData'), 'ReadingArchive'));
let window;
let server;
const origin = 'http://127.0.0.1:4174'; // Stable origin preserves localStorage across launches.
const allowedExternal = new Set(['weread.qq.com', 'platform.openai.com']);
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && allowedExternal.has(parsed.hostname)) {
      shell.openExternal(url).catch(() => {});
    }
  } catch {}
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    const dataDir = app.getPath('userData');
    await mkdir(dataDir, { recursive: true });
    const token = randomBytes(32).toString('hex');
    process.env.PORT = '4174';
    process.env.READING_ARCHIVE_ROOT = app.getAppPath();
    process.env.READING_ARCHIVE_DATA_DIR = dataDir;
    process.env.READING_ARCHIVE_DESKTOP_TOKEN = token;
    const backend = await import(pathToFileURL(join(app.getAppPath(), 'server.mjs')).href);
    server = backend.server;
    await backend.ready;
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'X-Reading-Archive-Token': token } });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '阅读档案', submenu: [
        { label: '豆瓣连接验证（实验）', click: openDouban },
        { label: '打开数据目录', click: () => shell.openPath(dataDir) },
        { label: '迁移旧版数据', click: () => dialog.showMessageBox(window, { type: 'info', title: '导入旧档案', message: '先在原浏览器版本点击“导出 JSON”，再在桌面版“导入”页面选择该文件并确认预览。', detail: '升级不会清除桌面版数据。请定期导出备份。微信读书与 AI 连接需要在桌面版重新配置。' }) },
        { type: 'separator' }, { role: 'quit', label: '退出' }
      ] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '显示', submenu: [{ role: 'reload', label: '刷新' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] }
    ]));
    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 600, show: false, title: 'Reading Archive', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); }
    });
    window.on('closed', () => { window = null; });
    await window.loadURL(origin);
    window.show();
  }).catch(error => {
    dialog.showErrorBox('Reading Archive 无法启动', error.code === 'EADDRINUSE' ? '端口 4174 被其他程序占用。请关闭占用程序后重新打开应用。为保护已有档案，应用不会自动切换数据地址。' : '启动失败，请重试。错误：' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { server?.close(); server?.closeAllConnections(); });
}
