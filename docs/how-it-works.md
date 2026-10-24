# How it works

OpenClaw 2026.10.5.

| Hook or API | Use |
| --- | --- |
| `registerTool` (factory) | `publish_brief`; the factory returns `null` unless the agent is in `publishAgents`. |
| `before_tool_call` | Counts budgeted tools per run and returns `{ block: true, blockReason }` past the budget. Never throws. |
| `after_tool_call` | Records each tool name and whether it errored, per run, for the claim check. |
| `agent_end` | Checks the final answer and the attempt's error and appends log lines. Fires per attempt; it resets nothing. Registered only with `allowConversationAccess`. |

## State

All in memory: a map of budget counters and a map of tool records, each keyed by run id. Both drop every entry idle over 6 hours on each call. Tool records keep at most 200 calls per run. A gateway restart empties both.

## Claim check

`I`/`we`, an optional `'ve` or `have`, an optional `just`/`already`/`now`/`successfully`, then `sent`, `queued`, `dispatched`, `scheduled` or `posted`. Future tense (`I'll send`), third person (`Regis sent it`) and passive (`was sent`) do not match. It is a heuristic and only logs: a false positive costs a log line.

## Log lines

One JSON object per line, appended; `kind` is `unbacked-claim` or `run-error`. A run with both writes two lines.
