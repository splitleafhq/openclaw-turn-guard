# Verification

## Checked

- **Unit tests** (`npm test`, synthetic data, temp folders, no network) cover:
  - two briefs on one topic in one second; a name collision; a 10,000-character round trip; an unwritable folder; a path-like topic; empty and oversized text; the path prefix; agent gating;
  - the 17th lookup blocked, a second run unaffected, a repeated tool call id, other agents and tools, missing run id, `agent_end` reset, 6-hour eviction;
  - an unbacked claim logged, a backed one not, a failed backing call, a run error, log mode 0600, an unwritable log, the missing grant.
- **Typecheck** against the OpenClaw 2026.10.5 plugin SDK; lint with oxlint.
- The tests call the handlers through a stand-in for the plugin API. They do not run OpenClaw's plugin loader or a gateway.

## Unverified on a live gateway

Nothing below has been run. Each is an assumption.

1. **A plugin tool runs in the gateway process for a sandboxed agent.** `docs/plugins/building-plugins.md` says execution calls the registered implementation; it does not say where a sandboxed agent's plugin tool runs. The brief folder write depends on it.
2. **A plugin tool needs an entry in the sandbox tool allow list.** `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md` documents that gate for MCP tools and lists `group:plugins`; plugin tools are not named in that passage.
3. **`before_tool_call` fires for `web_search` and `web_fetch`.** The docs say the hook gates tool calls and list `web_fetch` and `web_search` as tool names in an example; they do not say a core tool is exempt or not.
4. **`runId` is present on `before_tool_call`.** `docs/plugins/hooks/tool-policy.md` marks `event.runId` optional; `ctx.runId` and `ctx.sessionKey` are also optional. The fallbacks are in the README.
5. **`agent_end` per run or per attempt.** `docs/plugins/hooks/prompt-and-session.md` says it fires "after the turn". A sibling plugin's notes record that it ends an attempt, so a retried run would restart its count; this is not confirmed here.
6. **`toolCallId` is present and stable** across the hook and any retry of one call.
7. **`agent_end` event shape.** `messages` is an array of objects with `role` and either string content or text blocks. The type (`PluginHookAgentEndEvent`) says `messages: unknown[]`, so the reader accepts both shapes and ignores the rest.
8. **`after_tool_call` fires with `error` set on a failed call**, and with `runId`.
9. **A tool descriptor with a plain JSON-schema `parameters` object is accepted** (the typecheck passes; the loader was not run).
10. **The manifest's `required: ["briefsDir"]`** makes OpenClaw reject an entry without it; how that failure surfaces was not observed.
11. **Time zone of the file name.** UTC by choice; the request did not say.
