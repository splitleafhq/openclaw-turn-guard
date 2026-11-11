# Configuration

Set under `plugins.entries.turn-guard.config`. The manifest schema (`openclaw.plugin.json`) is the source of truth.

| Key | Default | Meaning |
| --- | --- | --- |
| `briefsDir` | none, required | Absolute host folder `publish_brief` writes to. Created if missing. Unset or relative (including `~/...`): the tool is not registered and a warning is logged. |
| `publishedPathPrefix` | host path | The folder as the reader of the returned path sees it. |
| `publishAgents` | `["research"]` | Agent ids that get `publish_brief`, compared after OpenClaw's agent-id normalization (`"Research Agent"` matches `research-agent`). |
| `maxBriefChars` | `60000` | Longest accepted brief, in characters. |

The default agent ids are the documented defaults only; the code names no agent anywhere else.

## One-at-a-time agents (`queue`)

Off unless `queue.agents` names an agent. It needs `plugins.entries.turn-guard.hooks.allowConversationAccess: true`: without it OpenClaw blocks the `agent_end` hook and every turn holds its agent until `maxHoldMs`.

| Key | Default | Meaning |
| --- | --- | --- |
| `queue.agents` | `[]` | Agent ids that answer one inbound turn at a time, compared after OpenClaw's agent-id normalization. |
| `queue.maxWaitMs` | `270000` | Longest a turn waits. Past it the sender gets `busyText`. Kept under the 300000 ms after which OpenClaw aborts an inbound message that has not started. |
| `queue.maxWaiting` | `4` | Most turns waiting per agent. A turn arriving at a full line gets `busyText` at once. |
| `queue.maxHoldMs` | `300000` | A turn that never reports its end frees the agent after this long. |
| `queue.restMs` | `60000` | Pause before the next waiting turn while the agent has been busy. |
| `queue.busyShare` | `0.5` | Busy means the agent's turns filled more than this share of `busyWindowMs`. `1` turns the rest off. |
| `queue.busyWindowMs` | `600000` | Window `busyShare` is measured over. |
| `queue.busyText` | a short "ask again" line | Reply to a turn that is not queued or waited too long. Sent without a model call. |

```json
{
  "plugins": {
    "entries": {
      "turn-guard": {
        "hooks": { "allowConversationAccess": true },
        "config": { "briefsDir": "/srv/briefs", "queue": { "agents": ["companions"] } }
      }
    }
  }
}
```
