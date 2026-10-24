# openclaw-turn-guard

An [OpenClaw](https://docs.openclaw.ai) plugin (id `turn-guard`) with two parts for a research agent and the agents around it:

1. **`publish_brief` tool.** Saves a finished brief to a host folder and returns the path the reader sees.
2. **Turn log.** Logs, never blocks, a final answer that claims "I sent it" with no matching tool call, and runs that ended in an error.

**Status:** built and unit-tested against OpenClaw 2026.10.5. Not installed anywhere, not published. What a live gateway still has to confirm is in [docs/verification.md](docs/verification.md).

## What it does

### 1. `publish_brief({ topic, text })`

Runs in the gateway process and writes `text` to `<briefsDir>/<YYYY-MM-DD>-<HHMMSS>-<6 hex>-<slug>.md` (UTC, mode 0644, folder created 0755). The file is created through OpenClaw's `root().create` (exclusive, atomic), so nothing is overwritten and a symlink at the name is refused. The slug is the topic lowercased to `[a-z0-9-]`, at most 40 characters, `brief` if nothing is left. The caller never supplies a path.

- Empty text, or text over `maxBriefChars` (60,000), returns an error result.
- A write failure returns an error result with a short message, not a throw.
- The result text is `publishedPathPrefix/<file name>`, the path as the consumer (for example a sandboxed reader) sees the folder. Without the prefix it is the host path.
- Only agents in `publishAgents` (default `["research"]`) get the tool: the factory returns `null` for the rest.

Docs relied on: tool registration and the matching `contracts.tools` entry, `docs/plugins/building-plugins.md` (Register tools); a factory may return `null`, same section.

### 2. Turn log

`agent_end` handler, registered only when the operator sets `plugins.entries.turn-guard.hooks.allowConversationAccess: true` (without the grant OpenClaw blocks the hook for a non-bundled plugin; `docs/plugins/hooks/reference.md`, conversation access). Without it the plugin warns once and skips this part. `agent_end` fires once per attempt, so a run retried after compaction is checked at each attempt, with every tool call of the run so far.

A line is written for:
- **unbacked-claim:** the last assistant message claims a done action: first person (`I sent`, `I've gone ahead and queued`), passive without an agent (`has been sent`, `is queued`, not `was sent by …`) or a bare verb opening a sentence (`Queued.`, `Message sent.`), for sent, queued, dispatched, scheduled, posted, forwarded, delivered or submitted. It is logged when the run has no successful call of a tool that can back that verb (`sent`: `message`, `sessions_send`, `conversations_send`, `publish_brief`; `scheduled`: `automations`, the name hooks use for `cron`; and so on, see `BACKING_TOOLS` in `src/audit.ts`). Tool calls come from `after_tool_call`. A heuristic: its precision is unmeasured.
- **run-error:** the attempt ended with an error string. An abort, yield or timeout ends with no error and is not logged.

Each line holds the time, agent id, session key, run id, the matched phrase (at most 120 characters around it) or the error (at most 300), and the tool names with ok or error. No transcripts. The file is `logFile`, default `<state dir>/logs/turn-guard.jsonl`, with the state dir from `api.runtime.state.resolveStateDir` (`docs/plugins/sdk-runtime/state-and-system.md`), mode 0600.

## Install (not yet done)

From a checkout, with the gateway owner's approval. The shape of the config change:

```json5
{
  plugins: {
    load: { paths: ["/path/to/openclaw-turn-guard"] },
    allow: ["turn-guard"],
    entries: {
      "turn-guard": {
        enabled: true,
        hooks: { allowConversationAccess: true },
        config: {
          briefsDir: "/host/path/to/briefs",
          publishedPathPrefix: "/path/the/reader/sees/briefs"
        }
      }
    }
  },
  agents: {
    entries: {
      research: {
        tools: {
          allow: ["...existing entries", "publish_brief"],
          sandbox: { tools: { allow: ["...existing entries", "publish_brief"] } }
        }
      }
    }
  }
}
```

Plugin tools are opt-in through `tools.allow` (`docs/plugins/building-plugins.md`). A sandboxed agent has a second allow gate, `tools.sandbox.tools`, which the sandbox page documents for MCP tools and says `group:plugins` covers plugin-owned tools (`docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`); that a plugin tool needs the entry is unverified. Keys are `agents.entries.<id>.tools.allow` and `agents.entries.<id>.tools.sandbox.tools.allow` (same page, line 69 and the tool-policy list); the global `tools.sandbox.tools.allow` also works. Add `publish_brief` to the agent's existing lists rather than replacing them.

## Configuration

See [docs/configuration.md](docs/configuration.md).

## Development

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
```

[docs/how-it-works.md](docs/how-it-works.md), [docs/verification.md](docs/verification.md), [docs/CHANGELOG.md](docs/CHANGELOG.md).
