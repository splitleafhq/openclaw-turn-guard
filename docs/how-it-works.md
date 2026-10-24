# How it works

OpenClaw 2026.10.5.

| Hook or API | Use |
| --- | --- |
| `registerTool` (factory) | `publish_brief`; the factory returns `null` unless the agent is in `publishAgents`. |
| `after_tool_call` | Records each tool name and whether it errored, per run, for the claim check. |
| `agent_end` | Checks the final answer and the attempt's error and appends log lines. Fires per attempt, so it keeps the run's tool records. Registered only with `allowConversationAccess`. |

## State

All in memory: a map of tool records keyed by run id, dropping every entry idle over 6 hours on each call. Tool records keep at most 200 calls per run. A gateway restart empties it.

## Claim check

Three shapes, for sent, queued, dispatched, scheduled, posted, forwarded, delivered or submitted: first person (`I sent`, `we've already queued`, `I went ahead and posted`), passive without an agent (`has been sent`, `is queued`; not `was sent by …`), and a bare verb opening a sentence (`Queued.`, `Message sent.`). Future tense (`I'll send`) and third person (`Regis sent it`) do not match. It is a heuristic and only logs: a false positive costs a log line. The patterns are in `src/audit.ts`.

## Log lines

One JSON object per line, appended; `kind` is `unbacked-claim` or `run-error`. A run with both writes two lines.
