const { BrowserWindow, Menu, dialog } = require('electron');
const { writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

function allowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ['movie.douban.com', 'www.douban.com', 'accounts.douban.com'].includes(u.hostname); } catch { return false; }
}
function collection(url) {
  try { const u = new URL(url); return u.origin === 'https://movie.douban.com' && /^\/people\/[^/]+\/collect\/?$/.test(u.pathname); } catch { return false; }
}
// Runs only on the visible collection page. No cookies, scripts or account settings are exported.
function readPage() {
  const text = (el) => el?.textContent?.trim() || '';
  const items = [...document.querySelectorAll('.grid-view .item')].map(el => {
    const a = el.querySelector('li.title a');
    const id = a?.href.match(/\/subject\/(\d+)\//)?.[1];
    const rating = el.querySelector('[class*="rating"]')?.className.match(/rating([1-5])-t/)?.[1];
    return { source: 'douban', subjectId: id || '', recordId: el.getAttribute('data-cid') || '', title: text(a).replace(/\s+/g, ' '), url: id ? `https://movie.douban.com/subject/${id}/` : '', rating: rating ? Number(rating) : null, markedAt: text(el.querySelector('.date')), comment: text(el.querySelector('.comment')), tagsText: text(el.querySelector('.tags')), status: 'watched' };
  });
  return { items, next: document.querySelector('.paginator .next a')?.href || '', totalPages: Number(document.querySelector('[data-total-page]')?.getAttribute('data-total-page')) || null };
}
let current;
function openDouban() {
  if (current && !current.isDestroyed()) { current.focus(); return; }
  const win = current = new BrowserWindow({ width: 1100, height: 850, title: '豆瓣连接验证 · 登录后打开自己的看过列表', webPreferences: { partition: `douban-test-${randomUUID()}`, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  let busy = false;
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  const guard = (event, url) => { if (!allowed(url)) event.preventDefault(); };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.setWindowOpenHandler(({ url }) => { if (allowed(url)) win.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  const notify = (message, detail = '') => { if (!win.isDestroyed()) return dialog.showMessageBox(win, { message, detail }); };
  async function validate() {
    if (busy) return;
    busy = true;
    try {
      const start = new URL(win.webContents.getURL());
      if (!collection(start.href)) throw new Error('请先登录豆瓣，打开你自己的“看过”列表，再点击验证。');
      const pages = [];
      for (let index = 0; index < 2; index++) {
        const url = new URL(win.webContents.getURL());
        if (!collection(url.href) || url.pathname !== start.pathname) throw new Error('页面跳转或登录状态发生变化，请在窗口中确认后重试。');
        const page = await win.webContents.executeJavaScript(`(${readPage.toString()})()`);
        if (!page.items.length || page.items.some(item => !item.subjectId || !item.title)) throw new Error('未识别到完整的观看记录。可能需要登录、完成验证，或页面格式已变化；本次未保存。');
        pages.push(page);
        if (index === 1 || !page.next) break;
        const next = new URL(page.next);
        if (!collection(next.href) || next.pathname !== start.pathname || Number(next.searchParams.get('start')) <= Number(url.searchParams.get('start'))) throw new Error('分页链接不符合预期，已停止。');
        await new Promise(resolve => setTimeout(resolve, 1800));
        if (win.isDestroyed()) return;
        await Promise.race([win.loadURL(next.href), new Promise((_, reject) => setTimeout(() => reject(new Error('加载超时，请检查本机网络后重试。')), 20000))]);
      }
      const records = [...new Map(pages.flatMap(p => p.items).map(x => [x.subjectId, x])).values()];
      const choice = await dialog.showMessageBox(win, { message: `已读取 ${pages.length} 页、${records.length} 条记录`, detail: `其中 ${records.filter(x => x.comment).length} 条含短评。此次最多验证两页，不代表完整同步，也没有写入阅读档案。可保存本地验证样本，供后续影视导入使用。`, buttons: ['完成', '保存验证样本'], defaultId: 0, cancelId: 0 });
      if (choice.response === 1) {
        const path = await dialog.showSaveDialog(win, { defaultPath: 'douban-validation.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!path.canceled && path.filePath) await writeFile(path.filePath, JSON.stringify({ format: 'douban-validation-v1', partial: true, pagesRead: pages.length, totalPages: pages[0].totalPages, records }, null, 2), { mode: 0o600 });
      }
    } catch (error) { await notify('验证未完成', error.message); }
    finally { busy = false; }
  }
  win.setMenu(Menu.buildFromTemplate([{ label: '豆瓣验证', submenu: [
    { label: '1. 打开我的看过列表', click: () => { if (!busy) win.loadURL('https://movie.douban.com/mine?status=collect').catch(() => notify('页面未打开，请检查本机网络。')); } },
    { label: '2. 验证当前页与下一页', click: validate },
    { label: '关闭并结束登录会话', click: () => win.close() }
  ] }]));
  win.on('closed', () => { current = null; ses.clearStorageData().catch(() => {}); });
  win.loadURL('https://movie.douban.com/mine?status=collect').catch(() => notify('豆瓣未打开', '请检查本机网络；如果使用代理，可尝试在直连网络下重新打开验证窗口。'));
}
module.exports = { openDouban, allowed, collection, readPage };
