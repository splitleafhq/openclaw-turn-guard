# Changelog

## Unreleased

- **A relative `briefsDir` is refused:** it resolved against the gateway's cwd and the tool returned a relative path the reader agent could not open; `~/...` made a literal `~` folder. A `briefsDir` that is not absolute now leaves `publish_brief` unregistered with a warning, as an unset one does.
- `publishAgents` ids are matched after OpenClaw's `normalizeAgentIdStrict` (`openclaw/plugin-sdk/routing`), not only lowercased: `" research"` or `"Research Agent"` no longer leaves the tool missing.
- Ships compiled `dist/`: an install runs npm without scripts, so it can't build one. `openclaw.runtimeExtensions` points at `./dist/index.js`, which OpenClaw loads from a copy or a load path. CI checks `dist/` matches a fresh build.
- **Removed the turn log:** the `agent_end` and `after_tool_call` hooks, `logFile` and the need for `hooks.allowConversationAccess`. It logged only and blocked nothing; of its claims, one was a false positive.

First version, built and tested against OpenClaw 2026.10.5.

- **`publish_brief`:** writes a brief to `briefsDir` under a name built in code, exclusive create, and returns the path the reader sees.
- **SDK helpers:** TypeBox parameter schema, `textResult` results (`status: failed` on errors), and `root().create` / `root().append` from `openclaw/plugin-sdk/security-runtime` for file writes. The log file is set to 0600 on create only; an existing file keeps its mode.
- **Turn log (needs `allowConversationAccess`):** JSON lines for unbacked "I sent it" claims and for run errors. Logs only.
