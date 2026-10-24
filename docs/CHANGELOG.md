# Changelog

## Unreleased

First version, built and tested against OpenClaw 2026.10.5.

- **`publish_brief`:** writes a brief to `briefsDir` under a name built in code, exclusive create, and returns the path the reader sees.
- **Budget:** `web_search` and `web_fetch` counted together per run; past the budget the call is blocked with a message to publish from notes.
- **SDK helpers:** TypeBox parameter schema, `textResult` results (`status: failed` on errors), and `root().create` / `root().append` from `openclaw/plugin-sdk/security-runtime` for file writes. The log file is set to 0600 on create only; an existing file keeps its mode.
- **Turn log (needs `allowConversationAccess`):** JSON lines for unbacked "I sent it" claims and for run errors. Logs only.
