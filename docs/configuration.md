# Configuration

Set under `plugins.entries.turn-guard.config`. The manifest schema (`openclaw.plugin.json`) is the source of truth.

| Key | Default | Meaning |
| --- | --- | --- |
| `briefsDir` | none, required | Host folder `publish_brief` writes to. Created if missing. Without it the tool is not registered. |
| `publishedPathPrefix` | host path | The folder as the reader of the returned path sees it. |
| `publishAgents` | `["research"]` | Agent ids that get `publish_brief`, compared after OpenClaw's agent-id normalization (`"Research Agent"` matches `research-agent`). |
| `maxBriefChars` | `60000` | Longest accepted brief, in characters. |

The default agent ids are the documented defaults only; the code names no agent anywhere else.
