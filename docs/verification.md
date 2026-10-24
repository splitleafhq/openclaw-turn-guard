# Verification

## Checked

- **Unit tests** (`npm test`, synthetic data, temp folders, no network) cover:
  - two briefs on one topic in one second; a name collision; a symlink at the chosen name; no temporary file left behind; a 10,000-character round trip; an unwritable folder; a path-like topic; empty and oversized text; the path prefix; agent gating;
  - the 17th lookup blocked, a second run unaffected, a repeated call, a reused call id with other arguments, other agents and tools, a missing run id, the count kept across attempts, agent ids in any case, 6-hour eviction;
  - an unbacked claim logged, a backed one not, a failed backing call, `automations` backing a scheduled claim, tools from an earlier attempt, a run error, an abort not logged, the claim phrasings, log mode 0600, an unwritable log, the missing grant.
- **Typecheck** against the OpenClaw 2026.10.5 plugin SDK; lint with oxlint.
- The tests call the handlers through a stand-in for the plugin API. They do not run OpenClaw's plugin loader or a gateway.

## Checked by reading OpenClaw 2026.10.5's code, not run

An adversarial review read the installed `dist/` (2026-10-24). Not run on a gateway.

1. **Plugin tools run in the gateway process.** `docs/plugins/architecture.md` says native plugins run in-process; the sandbox feeds only the file and exec bridges, and no path sends a plugin tool's `execute` into the container. So the brief lands in the host `briefsDir`. The "no container path" part is from absence.
2. **The sandbox gate needs the tool by name.** An explicit `tools.sandbox.tools.allow` replaces the default list, which names neither `publish_brief` nor the web tools. `optional: true` means the tool loads only when an allow list names it, its plugin id or `group:plugins`.
3. **`before_tool_call` wraps every tool, core web tools included.** `{ block: true, blockReason }` returns a normal tool result whose text is the reason. A throw or a 15 s timeout fails closed, so the handler catches everything. A provider's native web search is not a local tool and is never counted; neither is `x_search`, which `budgetTools` does not name.
4. **`runId` and `toolCallId`** are set on `before_tool_call` and `after_tool_call` when present; `agent_end` has `ctx.runId`, not `event.runId`.
5. **`agent_end` fires per attempt.** A context-overflow retry (up to 3) re-enters with the same `runId`. It does not fire when a finalize revision is pending.
6. **Hooks report `cron` as `automations`** (`TOOL_NAME_ALIASES`).
7. **`after_tool_call` is not awaited**, so in theory `agent_end` can run before the last tool record lands. Unlikely: the claim comes in a model turn after the tool result.

## Unverified

1. **`toolCallId` uniqueness.** No guarantee was found at execution time; the call key adds the tool and a hash of its arguments.
2. **`agent_end` message shape.** `messages` is typed `unknown[]`; the reader accepts string content and text blocks and ignores the rest.
3. **A plugin refresh mid-run.** If OpenClaw registers the plugin again during a run, the in-memory counts start over.
4. **How the manifest's `required: ["briefsDir"]` failure surfaces.**
5. **Time zone of the file name.** UTC by choice.
