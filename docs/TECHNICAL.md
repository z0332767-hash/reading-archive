# 开发与构建

[返回首页](../README.md)

## 浏览器版

Node.js 20 或以上可直接运行本地服务：

```bash
git clone https://github.com/z0332767-hash/reading-archive.git
cd reading-archive
npm start
```

打开 `http://localhost:4173`。Windows 也可双击 `start-reading-archive.bat`，此方式仍需 Node.js。

## 桌面版

建议 Node.js 22，安装开发依赖后运行：

```bash
npm ci
npm run desktop
```

Windows x64 打包运行 `npm run build:win`。Electron 包含运行环境，electron-builder 生成 NSIS 安装程序。打包使用明确文件名单，不包含本地密钥、私人导出和聊天附件。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `app.js` / `index.html` / `styles.css` | 界面、交互与显示偏好 |
| `core.mjs` | 规范化、合并去重、备份和回顾选择 |
| `search.mjs` / `map.mjs` | 检索、显式标签关系与时间线 |
| `server.mjs` | 静态资源白名单、配置与服务转发 |
| `weread.mjs` | 接口适配、分页和字段映射 |
| `openai-provider.mjs` | 可选 AI 请求和引用过滤 |
| `desktop/main.cjs` | 单实例、窗口、数据目录与本地服务生命周期 |

## 验证与分发

```bash
npm run check
node --check desktop/main.cjs
```

0.7.0 的 31 项测试已在本地与 Windows CI 通过，覆盖数据合并、备份、回顾、检索、主题、接口适配和桌面服务隔离。不等同于安装、升级、UI 和真实账号同步的完整实机验收。

main 推送触发 Windows installer，产物保留 30 天。首版无签名、自动更新或持久 Releases 分发。公开推广前需确定下载可见性、代码许可证，并完成实机验收。

完整导入格式见 [`sample-import.json`](../sample-import.json)。书籍状态支持 `reading`、`finished`、`wishlist`。导入前查看合并预览，重复导入去重不等同于双向同步。

浏览器版使用对应站点 localStorage；桌面版使用应用 Chromium 的本地存储。桌面服务监听本机 4174，要求每次启动生成的会话凭据；窗口启用隔离、沙箱，禁用 Node 集成。

OpenAI 配置写入本地 `.env.local`。问题与最多 12 条来源片段发送给 OpenAI；请求设置 `store: false`，不应据此承诺外部服务完全不留存任何数据。
