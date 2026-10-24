# Configuration

Set under `plugins.entries.turn-guard.config`. The manifest schema (`openclaw.plugin.json`) is the source of truth.

| Key | Default | Meaning |
| --- | --- | --- |
| `briefsDir` | none, required | Host folder `publish_brief` writes to. Created if missing. Without it the tool is not registered. |
| `publishedPathPrefix` | host path | The folder as the reader of the returned path sees it. |
| `publishAgents` | `["research"]` | Agent ids that get `publish_brief`. |
| `maxBriefChars` | `60000` | Longest accepted brief, in characters. |
| `logFile` | `<state dir>/logs/turn-guard.jsonl` | Log of unbacked claims and run errors, mode 0600. Needs `hooks.allowConversationAccess`. |

The default agent ids are the documented defaults only; the code names no agent anywhere else.

`plugins.entries.turn-guard.hooks.allowConversationAccess: true` is a separate operator setting, outside `config`. Without it the turn log is off; `publish_brief` works either way.
