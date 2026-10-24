# Changelog

## Unreleased

First version, built and tested against OpenClaw 2026.10.5.

- **`publish_brief`:** writes a brief to `briefsDir` under a name built in code, exclusive create, and returns the path the reader sees.
- **Budget:** `web_search` and `web_fetch` counted together per run; past the budget the call is blocked with a message to publish from notes.
- **Turn log (needs `allowConversationAccess`):** JSON lines for unbacked "I sent it" claims and for run errors. Logs only.
