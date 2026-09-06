# Security

Reading Archive is local-first. Never commit `.env.local`, real API keys, or exported personal reading archives.

## Secrets

- Copy `.env.example` to `.env.local` for local configuration.
- `WEREAD_API_KEY` and `OPENAI_API_KEY` are read only by the local Node.js server.
- The browser cannot request `.env.local`; the static server uses an explicit public-file allowlist.
- Personal JSON and Markdown exports are ignored by Git by default.

If a key is committed accidentally, revoke it at the provider first, then remove it from Git history before publishing again.
