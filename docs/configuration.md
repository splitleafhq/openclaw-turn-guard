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

Off unless `queue.agents` names an agent. It needs `plugins.entries.turn-guard.hooks.allowConversationAccess: true`: without it OpenClaw blocks the `before_agent_run` and `agent_end` hooks, no run is ever seen, and every turn holds its agent for `startGraceMs`.

| Key | Default | Meaning |
| --- | --- | --- |
| `queue.agents` | `[]` | Agent ids that answer one inbound turn at a time, compared after OpenClaw's agent-id normalization. |
| `queue.maxWaitMs` | `240000` | Longest a turn waits. Past it the sender gets `busyText`. At most 270000: OpenClaw aborts an inbound message not adopted within 300000 ms of its claim, and the busy reply has to go out before that. |
| `queue.maxWaiting` | none | Most turns waiting per agent; a turn arriving at a full line gets `busyText` at once. Unset: no limit, and `maxWaitMs` still bounds every wait. |
| `queue.startGraceMs` | `60000` | How long a turn that was let through may take to start a run before the agent is freed. Covers commands and claimed or aborted turns, which start none. Too short, and a run that waited for a gateway slot starts beside the next turn. |
| `queue.maxRunMs` | `900000` | A run that reports no end frees the agent after this long. Set it above the agent's longest run. |
| `queue.rest` | none | Optional pause after a busy stretch; all three parts or none. |
| `queue.rest.afterBusyShare` | | Busy means the agent's runs filled more than this share of `windowMs`. |
| `queue.rest.windowMs` | | Window the share is measured over. |
| `queue.rest.pauseMs` | | Pause before the next turn while busy. A waiting turn still starts a second before its `maxWaitMs`. |
| `queue.busyText` | a short "ask again" line | Reply to a turn that is not queued or waited too long. Sent without a model call. |

The numeric defaults are this plugin's choices, not OpenClaw conventions: `maxWaitMs` and `startGraceMs` follow from the limits in [how-it-works.md](how-it-works.md); `rest` and `maxWaiting` have no default because nothing fixes a right value.

```json
{
  "plugins": {
    "entries": {
      "turn-guard": {
        "hooks": { "allowConversationAccess": true },
        "config": {
          "briefsDir": "/srv/briefs",
          "queue": { "agents": ["companions"], "rest": { "afterBusyShare": 0.5, "windowMs": 600000, "pauseMs": 60000 } }
        }
      }
    }
  }
}
```
