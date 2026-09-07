# Security

## 数据说明

阅读档案保存在当前浏览器或桌面应用的本地存储中，两者不会自动共享。桌面数据目录为 `%APPDATA%/ReadingArchive`，连接配置位于该目录的 `.env.local`；浏览器版配置位于项目目录的 `.env.local`。密钥目前以明文保存，请勿分享整个数据目录。

微信读书同步会请求对应服务。可选 AI 问答会向 OpenAI 发送用户的问题和最多 12 条检索来源片段；本地检索与摘要不需要该服务。本地优先不等于完全离线或外部服务零留存。

请定期导出 JSON。清理浏览器站点数据、删除应用数据目录或“恢复示例数据”可能导致档案丢失。默认卸载保留桌面数据，不代表已有额外备份。

Reading Archive is local-first. Never commit `.env.local`, real API keys, or exported personal reading archives.

## Secrets

- Copy `.env.example` to `.env.local` for local configuration.
- `WEREAD_API_KEY` and `OPENAI_API_KEY` are read only by the local Node.js server.
- The browser cannot request `.env.local`; the static server uses an explicit public-file allowlist.
- Personal JSON and Markdown exports are ignored by Git by default.

If a key is committed accidentally, revoke it at the provider first, then remove it from Git history before publishing again.
