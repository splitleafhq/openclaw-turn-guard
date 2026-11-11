# How it works

OpenClaw 2026.10.5 for `publish_brief`; the queue was read and run against 2026.11.2.

| Hook or API | Use |
| --- | --- |
| `registerTool` (factory) | `publish_brief`; the factory returns `null` unless the agent is in `publishAgents`. |
| `before_dispatch` | The queue: a turn for a listed agent waits here for the agent's one slot. |
| `agent_end` | The queue: the run that held the slot ended, so the next waiting turn starts. |

## The queue

OpenClaw caps parallel runs only gateway-wide (`agents.defaults.maxConcurrent`, `docs/concepts/queue.md`); it has no cap per agent. Each session already runs one turn at a time, but an agent with many sessions (one per chat thread) runs them side by side.

1. `before_dispatch` reads the agent from the turn's session key (`parseAgentSessionKey`). An agent not in `queue.agents` passes straight through.
2. The first turn takes the slot and returns unhandled, so normal dispatch answers it.
3. A turn that finds the slot taken waits inside the hook, in arrival order. A claim hook has no runner timeout (`docs/plugins/hooks/reference.md`), and the message stays in OpenClaw's durable ingress queue while it waits.
4. `agent_end` for the session that holds the slot frees it, and the first waiting turn returns unhandled.
5. A turn from the session that already holds the slot passes through: OpenClaw's own session lane orders it.

Limits, and why:

- **A wait ends at `maxWaitMs` with `busyText`.** OpenClaw aborts an inbound message that is not adopted within 300 s and applies the channel's retry policy (`DEFAULT_INGRESS_ADOPTION_STALL_MS`, `dist/ingress-drain-*.mjs`). Holding after adoption (in `reply_dispatch`, after `turnAdoption.adopt()`) does not lift the limit: stuck-session recovery aborts the turn at about 370 s. So no hold point a plugin has outlasts five to six minutes.
- **The busy reply is `{ handled: true, text }`**, which OpenClaw sends as a final reply without a model call.
- **A redelivered message replaces its earlier place** (matched by `messageId`), so a retry is not answered twice.
- **`maxHoldMs` is the backstop** for a turn that never starts a run and so never reaches `agent_end`: a command, another plugin's claim, an aborted admission.
- **The rest** slows the line only while the agent has been busy: after a turn ends, if its turns filled more than `busyShare` of the last `busyWindowMs`, the next one waits `restMs`.
- **State is in memory.** A plugin reload or gateway restart empties the line; waiting messages are still in OpenClaw's ingress queue and are redelivered.
