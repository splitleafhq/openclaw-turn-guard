# How it works

OpenClaw 2026.10.5 for `publish_brief`. The queue's claims about OpenClaw come from reading 2026.11.2; what was run on a gateway is in [verification.md](verification.md).

| Hook or API | Use |
| --- | --- |
| `registerTool` (factory) | `publish_brief`; the factory returns `null` unless the agent is in `publishAgents`. |
| `before_dispatch` | The queue: a turn for a listed agent waits here for the agent's one slot. |
| `before_agent_run` | The queue: a run of the session holding the slot is under way. |
| `agent_end` | The queue: that run ended, so the next waiting turn starts. |

## The queue

OpenClaw caps parallel runs only gateway-wide (`agents.defaults.maxConcurrent`, `docs/concepts/queue.md`); it has no cap per agent. Each session already runs one turn at a time, but an agent with many sessions (one per chat thread) runs them side by side.

1. `before_dispatch` reads the agent from the turn's session key (`parseAgentSessionKey`). An agent not in `queue.agents` passes straight through.
2. The first turn takes the slot and returns unhandled, so normal dispatch answers it.
3. A turn that finds the slot taken waits inside the hook, in arrival order. A claim hook has no runner timeout (`docs/plugins/hooks/reference.md`), and the message stays in OpenClaw's durable ingress queue while it waits.
4. `before_agent_run` for the holding session marks its run as under way; `agent_end` for that run frees the slot, and the first waiting turn returns unhandled.

What the slot follows is a run, not a message, because several things break the "one message, one run, one end" picture:

- **A turn that starts no run.** `before_dispatch` runs before command handling (`dist/dispatch-from-config-*.mjs`), so a command, another plugin's claim or an aborted turn takes the slot and never reaches `agent_end`. A holder that shows no run within `startGraceMs` loses the slot.
- **A follow-up in the holding session** passes through, since OpenClaw's session lane orders it. If one passed during the run, the slot is kept after `agent_end` for `startGraceMs`, for the follow-up's own run.
- **Retries.** OpenClaw reports `agent_end` per attempt (`dist/builtin-openclaw-*.mjs`, `completeEmbeddedAttemptAfterTurn`). After a failed attempt the slot is kept for `startGraceMs`; a retry's `before_agent_run` keeps it, and no retry frees it.
- **A late end.** An `agent_end` whose run id differs from the run holding the slot is ignored, so a run that outlived `maxRunMs` cannot free the session's next one.

Limits, and why:

- **A wait ends at `maxWaitMs` with `busyText`.** OpenClaw aborts an inbound message not adopted within 300 s of its claim and applies the channel's retry policy (`DEFAULT_INGRESS_ADOPTION_STALL_MS`, `dist/ingress-drain-*.mjs`). Holding after adoption (in `reply_dispatch`, after `turnAdoption.adopt()`) does not lift the limit: stuck-session recovery aborted such a turn at about 370 s on a live gateway. So no hold point a plugin has outlasts five to six minutes, and `maxWaitMs` leaves room for the busy reply to go out first.
- **The busy reply is `{ handled: true, text }`**, which OpenClaw sends as a final reply without a model call.
- **A redelivered message replaces its earlier place** (matched by `messageId`) and keeps its deadline.
- **The rest** applies after a run ends with the agent's runs filling more than `afterBusyShare` of the last `windowMs`: the next turn, waiting or newly arrived, starts `pauseMs` later, but never later than a second before a waiting turn's deadline.
- **State is in memory.** A gateway restart empties the line; messages that were waiting are still in OpenClaw's ingress queue.

Known gaps:

- **A waiter OpenClaw aborts stays in line.** The hook gets no abort signal, so the plugin grants it the slot when its turn comes; with no run, the slot frees after `startGraceMs`.
- **A heartbeat or other run in the holding session** between the grant and the turn's own run is taken for that run; its end frees the slot and the turn's run can start beside the next one.
- **A run that waits longer than `startGraceMs` for a gateway slot** (`agents.defaults.maxConcurrent`) loses the agent's slot before it starts.
- **After a plugin reload**, turns held by the old instance still return: at their deadline with `busyText`, or when the old instance's grace expires, beside whatever the new instance is running.
